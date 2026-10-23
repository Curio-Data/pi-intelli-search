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
  compactResult,
} from "../../../src/core/index.js";
import type { JsonSchemaType } from "@modelcontextprotocol/server";
import type { FullData, OperationInputs, OperationResult } from "../../../src/core/contracts.js";
import { createRuntime, type RuntimeOptions } from "./runtime.js";
import { ConfigurationError, type StandaloneConfig } from "./config.js";
import { StandaloneError, type StandaloneErrorCode } from "./errors.js";
import { identity } from "./identity.js";
import { OperationQueue, type QueueLimits } from "./queue.js";
import { mergeAdmission, parseAdmission } from "./admission.js";
import { installStdoutGuard } from "./stdout-guard.js";

type OperationName = keyof OperationInputs;
type Runtime = Awaited<ReturnType<typeof createRuntime>>;

// Kept in the MCP adapter: the guidance string is duplicated deliberately
// rather than imported from the native package.
const skillGuidance =
  "Before the first intelli-search call in a session, load the intelli-search " +
  "skill if available (plugins expose it as intelli-search:intelli-search). " +
  "If the host has no such skill, use the tool descriptions without blocking.";

const serverInstructions =
  "Use intelli-search for current web information. " +
  skillGuidance +
  " " +
  "Start with intelli_search for factual questions, latest versions, release " +
  "dates and brief lookups. It returns an answer with sources without the " +
  "multi-page fetch, extraction and collation pipeline. If a search answer " +
  "looks stale or its sources disagree on the current version, try one " +
  "narrower intelli_search targeting official sources before escalating. " +
  "Use intelli_research " +
  "for comparisons, detailed analysis or when a search answer leaves a " +
  "specific evidence gap requiring multiple pages. Do not expand a simple " +
  "lookup into unrequested research. For research, supply a focusPrompt and " +
  "set maxUrls to the smallest useful breadth (3 for targeted research). " +
  "Use the returned summary; read cache files only when it is insufficient.";

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
      "Start here for quick factual questions, latest model or package " +
      "versions, release dates and brief lookups. Returns a grounded answer " +
      "with source URLs without fetching and extracting each page. A request " +
      "for current information or sources alone does not need intelli_research. " +
      "Escalate to intelli_research only for detailed analysis, comparisons " +
      "or a specific evidence gap requiring multiple pages. " +
      skillGuidance,
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
      "research, use intelli_research. " +
      skillGuidance,
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
      "concise summary. " +
      "Use this after extracting multiple pages with intelli_extract; for " +
      "end-to-end research, use intelli_research. A saved report goes into " +
      "a new workspace cache run directory without replacing earlier reports. " +
      "A valid answer is still returned when persistence is unavailable. " +
      skillGuidance,
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
      "Use for multi-page comparisons, detailed analysis or a specific " +
      "evidence gap left by intelli_search. For a quick fact, latest model " +
      "or package version, or release date, call intelli_search first, not " +
      "this tool. Do not expand a simple lookup into unrequested research. " +
      "This longer-running pipeline searches, fetches pages, extracts each " +
      "page and collates the results; it can take minutes and incurs more " +
      "provider calls than intelli_search. " +
      skillGuidance +
      " " +
      "Use the returned summary " +
      "directly and read cached pages only when it is insufficient. " +
      "Use maxUrls to control breadth: 3 for targeted, 10 (default) " +
      "for broad, 16 for exhaustive. Always provide focusPrompt to guide " +
      "extraction. All operations call external services and incur provider " +
      "charges. A saved report goes into a new workspace cache run directory " +
      "without replacing earlier reports. Degraded research saves no report; " +
      "a valid answer is still returned when persistence is unavailable.",
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

export function errorResult(
  name: string,
  code: StandaloneErrorCode,
  message: string,
  data?: FullData,
): CallToolResult {
  const text = `${name} failed (${code}): ${message}`;
  return {
    isError: true,
    content: [{ type: "text", text }],
    ...(data
      ? {
          structuredContent: compactResult({ ...data, text }) as unknown as Record<string, unknown>,
        }
      : {}),
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
    structuredContent: result.data
      ? (compactResult(result.data) as unknown as Record<string, unknown>)
      : { outcome: result.outcome, text: result.text, details: result.details },
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
export interface RuntimeLoader {
  (): Promise<Runtime>;
  close(reason?: string): Promise<void>;
}

export function lazyRuntime(load: ConfigLoader, options: RuntimeOptions): RuntimeLoader {
  let ready: Promise<Runtime> | undefined;
  let stopped = false;
  let activeRuntime: Runtime | undefined;
  let closing: Promise<void> | undefined;
  const resolve = () => {
    if (stopped) return Promise.reject(new StandaloneError("CANCELLED", "Runtime closed"));
    if (!ready) {
      const attempt = load()
        .then((config) => {
          if (stopped) throw new StandaloneError("CANCELLED", "Runtime closed");
          return createRuntime(config, options);
        })
        .then(
          async (runtime) => {
            if (stopped) {
              await runtime.close("Runtime closed during construction");
              throw new StandaloneError("CANCELLED", "Runtime closed");
            }
            activeRuntime = runtime;
            process.stderr.write("[mcp-intelli-search] Configuration loaded\n");
            return runtime;
          },
          (error: unknown) => {
            if (error instanceof StandaloneError) throw error;
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
  return Object.assign(resolve, {
    close(reason?: string) {
      stopped = true;
      const stoppedRuntime = activeRuntime?.close(reason);
      closing ??= (async () => {
        await stoppedRuntime;
        // Do not initialise a never-used runtime merely to close it. A failed
        // load owns no runtime, but an in-flight construction must settle.
        const runtime = await ready?.catch(() => undefined);
        await runtime?.close(reason);
      })();
      return closing;
    },
  });
}

export interface ProtocolServer {
  readonly server: McpServer;
  readonly queue: OperationQueue<CallToolResult>;
  /** Aborts every active and queued operation. */
  readonly shutdown: AbortController;
  /** Stops runtime admissions synchronously, then drains queue and runtime. */
  close(): Promise<void>;
}

/**
 * Registers the four canonical operations on a fresh server. Registration is
 * deliberately separate from CLI startup and transport wiring for testing.
 */
export function createProtocolServer(
  runtime: Runtime | RuntimeLoader,
  limits?: QueueLimits | (() => Promise<QueueLimits>),
  onEnqueue?: () => void,
): ProtocolServer {
  const shutdown = new AbortController();
  const resolveRuntime = typeof runtime === "function" ? runtime : () => Promise.resolve(runtime);
  const queue = new OperationQueue<CallToolResult>(
    limits ??
      (typeof runtime === "function"
        ? () => resolveRuntime().then((ready) => ready.admission)
        : runtime.admission),
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
  const server = new McpServer(
    { name: identity.name, version: identity.version },
    { instructions: serverInstructions },
  );
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
        // MCP requires a strict increase, not merely a non-decreasing display
        // percentage. Repeated stage/retry/end percentages remain local events.
        let lastProgress = -1;
        // Notification writes belong to this request, including terminal progress.
        // Await the chain before publishing its response or releasing queue ownership.
        let notifications: Promise<void> = Promise.resolve();
        const factories = {
          failed: (error: unknown) =>
            error instanceof StandaloneError
              ? errorResult(tool.name, error.code, error.message, error.data)
              : errorResult(tool.name, "OPERATION", "Operation failed"),
          // A settled runtime cancellation can carry final partial accounting.
          // Do not replace that error envelope with a zero-data queue response.
          cancelled: (settled?: CallToolResult) =>
            settled?.isError ? settled : errorResult(tool.name, "CANCELLED", "Operation cancelled"),
          busy: () =>
            errorResult(
              tool.name,
              "OPERATION",
              "Server busy: too many queued operations; retry after a running operation completes",
            ),
        };
        return queue.submit(
          (ownedSignal) =>
            resolveRuntime()
              .then((ready) =>
                ready.execute(tool.name, args as OperationInputs[OperationName], {
                  signal: ownedSignal,
                  onProgress:
                    token === undefined
                      ? undefined
                      : (progress) => {
                          if (progress.pct <= lastProgress) return;
                          lastProgress = progress.pct;
                          notifications = notifications
                            .then(() =>
                              ctx.mcpReq.notify({
                                method: "notifications/progress",
                                params: {
                                  progressToken: token,
                                  progress: progress.pct,
                                  total: 100,
                                  message: progress.message,
                                },
                              }),
                            )
                            .catch(() => {});
                        },
                }),
              )
              .then(
                (result) => successResult(result),
                (error: unknown) => {
                  if (error instanceof StandaloneError)
                    return errorResult(tool.name, error.code, error.message, error.data);
                  // Contractually unreachable (the runtime wraps every failure
                  // in a StandaloneError); never forward a raw message.
                  process.stderr.write(
                    `[mcp-intelli-search] unclassified ${tool.name} failure: ${
                      error instanceof Error ? error.message : "unknown"
                    }\n`,
                  );
                  return errorResult(tool.name, "OPERATION", "Operation failed");
                },
              )
              .finally(async () => {
                await notifications;
              }),
          signal,
          factories,
        );
      },
    );
  }
  let closing: Promise<void> | undefined;
  const close = () => {
    if (!closing) {
      shutdown.abort();
      const runtimeClosing = runtime.close("Protocol server closed");
      // queue.close() also waits for a request resolving a lazy runtime. Neither
      // path may abandon work just because the transport has disappeared.
      closing = Promise.all([runtimeClosing, queue.close()]).then(() => undefined);
    }
    return closing;
  };
  return { server, queue, shutdown, close };
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
  const queueOverrides = options.queue ? Object.freeze({ ...options.queue }) : undefined;
  if (queueOverrides) parseAdmission(queueOverrides);
  // Credentials are snapshotted at startup in both modes; a lazily loaded
  // configuration selects its key variable from this snapshot.
  const runtimeOptions: RuntimeOptions = { ...options, env: { ...(options.env ?? process.env) } };
  const runtime =
    typeof config === "function"
      ? lazyRuntime(config, runtimeOptions)
      : await createRuntime(config, runtimeOptions);
  const { server, close: drain } = createProtocolServer(
    runtime,
    queueOverrides
      ? () =>
          (typeof runtime === "function" ? runtime() : Promise.resolve(runtime)).then((ready) =>
            mergeAdmission(ready.admission, queueOverrides),
          )
      : undefined,
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
      await drain();
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
  try {
    await server.connect(transport);
  } catch (error) {
    await close();
    throw error;
  }
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
