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
import type { StandaloneConfig } from "./config.js";
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
      "end-to-end research, use intelli_research.",
    schema: collateSchema,
    annotations: {
      title: "Intelli Collate",
      readOnlyHint: false,
      destructiveHint: false,
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
      "charges.",
    schema: researchSchema,
    annotations: {
      title: "Intelli Research",
      readOnlyHint: false,
      destructiveHint: false,
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

function successResult(result: OperationResult): CallToolResult {
  return {
    content: [{ type: "text", text: result.text }],
    structuredContent: { outcome: result.outcome, details: result.details },
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
  runtime: Runtime,
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
            runtime
              .execute(tool.name, args as OperationInputs[OperationName], {
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
              })
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
  config: StandaloneConfig,
  options: ServeOptions = {},
): Promise<ServeHandle> {
  const protocol = installStdoutGuard();
  const runtime = await createRuntime(config, options);
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
