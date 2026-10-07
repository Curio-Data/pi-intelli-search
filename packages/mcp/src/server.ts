// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import {
  collateSchema,
  extractSchema,
  researchSchema,
  searchSchema,
} from "../../../src/core/index.js";
import type { JsonSchemaType } from "@modelcontextprotocol/server";
import type { OperationInputs, OperationResult } from "../../../src/core/contracts.js";
import { createRuntime, type RuntimeOptions } from "./runtime.js";
import { ConfigurationError, type StandaloneConfig } from "./config.js";
import { StandaloneError, type StandaloneErrorCode } from "./errors.js";
import { identity } from "./identity.js";
import { OperationQueue, defaultQueueLimits, type QueueLimits } from "./queue.js";
import { installStdoutGuard } from "./stdout-guard.js";

type OperationName = keyof OperationInputs;
type Runtime = Awaited<ReturnType<typeof createRuntime>>;

const toolDefinitions: Array<{
  name: OperationName;
  title: string;
  description: string;
  schema: unknown;
  annotations: ToolAnnotations;
}> = [
  {
    name: "intelli_search",
    title: "Intelli Search",
    description:
      "Search the web and return a concise answer with source URLs. " +
      "For multi-page deep research, use intelli_research instead.",
    schema: searchSchema,
    annotations: {
      title: "Intelli Search",
      readOnlyHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: "intelli_extract",
    title: "Intelli Extract",
    description:
      "Extract query-relevant content from a web page, compressing the full " +
      "page to the parts that matter for a given query. Always provide " +
      "focusPrompt to guide extraction; without it the extraction is generic. " +
      "Use this for individual pages you already have; for end-to-end " +
      "research, use intelli_research.",
    schema: extractSchema,
    annotations: {
      title: "Intelli Extract",
      readOnlyHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: "intelli_collate",
    title: "Intelli Collate",
    description:
      "Deduplicate and synthesise multiple per-page extractions into a single " +
      "concise summary. Writes results to the workspace cache for follow-up. " +
      "Use this after extracting multiple pages with intelli_extract; for " +
      "end-to-end research, use intelli_research. Repeating a query on the " +
      "same UTC date attempts to archive its earlier cached report, " +
      "extractions and numbered sources to the lowest free numbered sibling " +
      "folder (.1, then .2 and so on); archiving is best-effort and a " +
      "failure lets the completed run replace files in place, so copy a " +
      "report elsewhere if it must be retained.",
    schema: collateSchema,
    annotations: {
      title: "Intelli Collate",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: "intelli_research",
    title: "Intelli Research",
    description:
      "Search the web, fetch top results, extract relevant content from each " +
      "page, and deduplicate into a concise summary. Writes all results to " +
      "the workspace cache for follow-up; use the returned summary directly " +
      "and read cached pages only when it is insufficient. This is the " +
      "primary research tool; for quick factual lookups, use intelli_search " +
      "instead. Use maxUrls to control breadth: 3 for targeted, 10 (default) " +
      "for broad, 16 for exhaustive. Always provide focusPrompt to guide " +
      "extraction. All operations call external services and incur provider " +
      "charges. Repeating a query on the same UTC date attempts to archive " +
      "its cached report, extractions and numbered sources to the lowest " +
      "free numbered sibling folder (.1, then .2 and so on); archiving is " +
      "best-effort and a failure lets the completed run replace files in " +
      "place, so copy a report elsewhere if it must be retained. A degraded " +
      "repeat preserves the earlier successful report.",
    schema: researchSchema,
    annotations: {
      title: "Intelli Research",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
];

function errorResult(name: string, code: StandaloneErrorCode, message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: `${name} failed (${code}): ${message}` }],
  };
}

/**
 * The complete operation text travels in both representations. Some hosts
 * (Claude Code 2.1.289 observed) give the model only `structuredContent` when
 * it is present, so omitting the text there would hide the answer, summary
 * and related-cache appendix; other hosts read `content`.
 */
export function successResult(result: OperationResult): CallToolResult {
  return {
    content: [{ type: "text", text: result.text }],
    structuredContent: { outcome: result.outcome, text: result.text, details: result.details },
  };
}

/** Rereads an unusable configuration file on each call until it loads. */
export type ConfigLoader = () => Promise<StandaloneConfig>;

const recoveryHint =
  "Create or repair the file, then call the tool again; the server rereads it on each call until it loads";

/**
 * Defers configuration to the first tool call that can load it. A failed
 * load is not cached, so a repaired file takes effect on the next call; a
 * successful load is kept for the life of the process, as at startup.
 */
export function lazyRuntime(load: ConfigLoader, options: RuntimeOptions): () => Promise<Runtime> {
  let ready: Promise<Runtime> | undefined;
  return () => {
    if (!ready) {
      const attempt = load()
        .then((config) => createRuntime(config, options))
        .then(
          (runtime) => {
            process.stderr.write("[mcp-intelli-search] Configuration loaded\n");
            return runtime;
          },
          (error: unknown) => {
            if (error instanceof ConfigurationError)
              throw new StandaloneError("CONFIGURATION", `${error.message}. ${recoveryHint}`);
            throw new StandaloneError(
              "WORKSPACE",
              error instanceof Error ? error.message : "Workspace unavailable",
            );
          },
        );
      ready = attempt;
      attempt.catch(() => {
        if (ready === attempt) ready = undefined;
      });
    }
    return ready;
  };
}

export interface ProtocolServer {
  readonly server: McpServer;
  readonly queue: OperationQueue<CallToolResult>;
  /** Aborts every active and queued operation. */
  readonly shutdown: AbortController;
}

/**
 * Registers the four canonical operations on a fresh server. Registration is
 * deliberately separate from CLI startup and transport wiring for testing.
 */
export function createProtocolServer(
  runtime: Runtime | (() => Promise<Runtime>),
  limits: QueueLimits = defaultQueueLimits,
  onEnqueue?: () => void,
): ProtocolServer {
  const shutdown = new AbortController();
  const queue = new OperationQueue<CallToolResult>(
    limits,
    {
      cancelled: () => errorResult("operation", "CANCELLED", "Operation cancelled"),
      busy: () =>
        errorResult(
          "operation",
          "OPERATION",
          "Server busy: too many queued operations; retry after a running operation completes",
        ),
    },
    onEnqueue,
  );
  const resolveRuntime = typeof runtime === "function" ? runtime : () => Promise.resolve(runtime);
  const server = new McpServer({ name: identity.name, version: identity.version });
  for (const tool of toolDefinitions) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: fromJsonSchema(tool.schema as JsonSchemaType),
        annotations: tool.annotations,
      },
      async (args, ctx) => {
        const token = ctx.mcpReq._meta?.progressToken;
        const signal = AbortSignal.any([ctx.mcpReq.signal, shutdown.signal]);
        const factories = {
          cancelled: () => errorResult(tool.name, "CANCELLED", "Operation cancelled"),
          busy: () =>
            errorResult(
              tool.name,
              "OPERATION",
              "Server busy: too many queued operations; retry after a running operation completes",
            ),
        };
        return queue.submit(
          () =>
            resolveRuntime()
              .then((ready) =>
                ready.execute(tool.name, args as OperationInputs[OperationName], {
                  signal,
                  onProgress:
                    token === undefined
                      ? undefined
                      : (progress) => {
                          void ctx.mcpReq
                            .notify({
                              method: "notifications/progress",
                              params: {
                                progressToken: token,
                                progress: progress.pct,
                                total: 100,
                                message: progress.message,
                              },
                            })
                            .catch(() => {});
                        },
                }),
              )
              .then(
                (result) => successResult(result),
                (error: unknown) => {
                  if (error instanceof StandaloneError)
                    return errorResult(tool.name, error.code, error.message);
                  // Contractually unreachable (the runtime wraps every failure
                  // in a StandaloneError); never forward a raw message.
                  process.stderr.write(
                    `[mcp-intelli-search] unclassified ${tool.name} failure: ${
                      error instanceof Error ? error.message : "unknown"
                    }\n`,
                  );
                  return errorResult(tool.name, "OPERATION", "Operation failed");
                },
              ),
          signal,
          factories,
        );
      },
    );
  }
  return { server, queue, shutdown };
}

export interface ServeOptions extends RuntimeOptions {
  readonly queue?: Partial<QueueLimits>;
  /** Test instrumentation: invoked each time a request enters the queue. */
  readonly onEnqueue?: () => void;
}

export interface ServeHandle {
  /** Initiates shutdown: aborts operations, closes the server and transport. */
  close(): Promise<void>;
  /** Resolves once the connection has closed and work has drained. */
  readonly closed: Promise<void>;
}

/**
 * Serves the protocol over process stdio. The stdout guard is installed here
 * as a backstop; the CLI installs it earlier, before loading this module, so
 * import-time dependency output is also diverted to standard error.
 */
export async function startServer(
  config: StandaloneConfig | ConfigLoader,
  options: ServeOptions = {},
): Promise<ServeHandle> {
  const protocol = installStdoutGuard();
  // Credentials are snapshotted at startup in both modes; a lazily loaded
  // configuration selects its key variable from this snapshot.
  const runtimeOptions: RuntimeOptions = { ...options, env: { ...(options.env ?? process.env) } };
  const runtime =
    typeof config === "function"
      ? lazyRuntime(config, runtimeOptions)
      : await createRuntime(config, runtimeOptions);
  const { server, queue, shutdown } = createProtocolServer(
    runtime,
    {
      ...defaultQueueLimits,
      ...options.queue,
    },
    options.onEnqueue,
  );
  const transport = new StdioServerTransport(process.stdin, protocol);
  let closing: Promise<void> | undefined;
  let notifyClosed: () => void = () => {};
  const closed = new Promise<void>((resolve) => {
    notifyClosed = resolve;
  });
  const close = () => {
    closing ??= (async () => {
      shutdown.abort();
      try {
        await queue.close();
      } catch {
        // Drain is best-effort during shutdown; never stall the close.
      }
      try {
        await server.close();
      } catch {
        // The transport may already be gone (for example after EPIPE).
      }
      // On the EPIPE close path the SDK detaches its stdin consumer, which
      // pauses the stream with an unconsumed end-of-file and pins the event
      // loop. Release the handle so shutdown actually exits the process.
      try {
        process.stdin.destroy();
      } catch {
        // Standard input may already be closed.
      }
      notifyClosed();
    })();
    return closing;
  };
  await server.connect(transport);
  // server.connect() takes ownership of the transport's callbacks; stdin
  // closure reaches us through the protocol-level close notification.
  server.server.onclose = () => void close();
  const hardExit = (signal: NodeJS.Signals) => {
    const timer = setTimeout(() => process.exit(1), 10_000);
    timer.unref();
    void close().then(() => {
      clearTimeout(timer);
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  };
  process.once("SIGINT", () => hardExit("SIGINT"));
  process.once("SIGTERM", () => hardExit("SIGTERM"));
  return { close, closed };
}
