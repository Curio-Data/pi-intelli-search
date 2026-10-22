// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { Check } from "typebox/value";
import { randomBytes, randomUUID } from "node:crypto";
import { createOperationRuntime } from "../../../src/core/operation-runtime.js";
import { AdmissionError } from "../../../src/core/execution-coordinator.js";
import { createSystemClock } from "../../../src/core/clock.js";
import {
  createOperationResultBoundary,
  isOperationFailure,
  CoreConfigurationError,
} from "../../../src/core/operation-result.js";
import { redactFullData } from "./redaction.js";
import {
  parseExecutionSettings,
  validateRequestInterval,
} from "../../../src/core/execution-settings.js";
import { createRunStore } from "../../../src/core/run-store.js";
import {
  FetchConfigurationError,
  capturePageFetchFactory,
  capturePageEnvironment,
} from "../../../src/core/page-runtime.js";
import { executionReceipt, type ExecutionReceipt } from "./execution-receipt.js";
import type { TSchema } from "typebox";
import {
  search,
  extract,
  collate,
  research,
  searchSchema,
  extractSchema,
  collateSchema,
  researchSchema,
  throwIfAborted,
} from "../../../src/core/index.js";
import type {
  OperationContext,
  OperationInputs,
  OperationLogger,
  Progress,
  OperationResult,
  OperationServices,
  Clock,
  FullData,
  Diagnostic,
  PageTransport,
} from "../../../src/core/contracts.js";
import type { FetchFunction } from "../../../src/core/annotations.js";
import {
  ConfigurationError,
  loadConfig,
  parseConfig,
  validateDomains,
  type StandaloneConfig,
} from "./config.js";
import { createOpenRouterClient, createOpenRouterCatalogue } from "./providers/openrouter.js";
import { parseAdmission } from "./admission.js";
import { assertWorkspaceSafe, workspacePaths } from "./workspace.js";
import { identity } from "./identity.js";
import { withStandaloneStdout } from "./console.js";
import { StandaloneError, type StandaloneErrorCode } from "./errors.js";

export { loadConfig, parseConfig, identity, StandaloneError, ConfigurationError };
export type { StandaloneConfig };
const schemas = {
  intelli_search: searchSchema,
  intelli_extract: extractSchema,
  intelli_collate: collateSchema,
  intelli_research: researchSchema,
};
/** Derive adapter validation from the canonical contract rather than duplicate it. */
function strict(schema: TSchema): TSchema {
  const clone: Record<string, unknown> = { ...schema };
  if (clone.type === "object") {
    clone.additionalProperties = false;
    clone.properties = Object.fromEntries(
      Object.entries(clone.properties ?? {}).map(([key, value]) => [key, strict(value as TSchema)]),
    );
  }
  if (clone.type === "array") {
    clone.maxItems = 100;
    clone.items = strict(clone.items as TSchema);
  }
  if (clone.type === "string") clone.maxLength = 2_000_000;
  return clone;
}
const inputSchemas = Object.fromEntries(
  Object.entries(schemas).map(([key, schema]) => [key, strict(schema)]),
);
function validate(
  name: keyof OperationInputs,
  params: unknown,
): asserts params is OperationInputs[keyof OperationInputs] {
  if (!Object.hasOwn(inputSchemas, name)) throw new Error("Unknown operation");
  if (!Check(inputSchemas[name], params)) throw new Error("Invalid operation arguments");
  const input = params as OperationInputs[keyof OperationInputs];
  if (!input.query.trim()) throw new Error("query must not be empty");
  if (
    "maxUrls" in input &&
    input.maxUrls !== undefined &&
    (!Number.isSafeInteger(input.maxUrls) || input.maxUrls < 1)
  )
    throw new Error("maxUrls must be a positive integer");
  if (
    "extractions" in input &&
    input.extractions.some((item) => !["success", "failed", "blocked"].includes(item.status))
  )
    throw new Error("extraction status must be success, failed or blocked");
}
const stderrLogger: OperationLogger = {
  error: (message) => {
    process.stderr.write(`[mcp-intelli-search] ${message}\n`);
  },
  warn: (message) => {
    process.stderr.write(`[mcp-intelli-search] ${message}\n`);
  },
};
export interface RuntimeOptions {
  fetch?: FetchFunction;
  env?: Readonly<Record<string, string | undefined>>;
  logger?: OperationLogger;
  pageTransport?: PageTransport;
  /** Deterministic runtime clock; never an operation-owned replacement. */
  clock?: Clock;
  /** Read-only witness after a waiter joins the shared catalogue flight. */
  onCatalogueWaiterJoined?: (activeWaiters: number) => void;
}
export interface ExecuteOptions {
  signal?: AbortSignal;
  onProgress?: (progress: Progress) => void;
}
/** Registered operation lifetime. Protocol admission remains a separate adapter. */
export async function createRuntime(config: StandaloneConfig, options: RuntimeOptions = {}) {
  // Capture the caller's settings once, before constructing the coordinator.
  config = structuredClone(config);
  options = { ...options };
  // Public runtime callers may supply an object without using parseConfig().
  // Revalidate captured execution/pacing before any workspace or provider work.
  const admission = parseAdmission(config.admission);
  const executionSettings = parseExecutionSettings(config.settings.execution, "tuning.execution");
  config = { ...config, settings: { ...config.settings, execution: executionSettings } };
  validateRequestInterval(config.settings.minRequestIntervalMs, "tuning.minRequestIntervalMs");
  const env = { ...(options.env ?? process.env) };
  const pagePolicy = {
    executable: process.execPath,
    environment: capturePageEnvironment(env, config.apiKeyEnv),
  };
  const paths = await workspacePaths(config.workspace, config.settings.cacheDir);
  const secret = env[config.apiKeyEnv];
  const redact = (message: string) => (secret ? message.split(secret).join("[REDACTED]") : message);
  const sink = options.logger ?? stderrLogger;
  const deliver = (level: "error" | "warn", message: string) => {
    try {
      sink[level](redact(message));
    } catch {
      /* A diagnostic cannot replace a result. */
    }
  };
  const logger: OperationLogger = {
    error: (message) => deliver("error", message),
    warn: (message) => deliver("warn", message),
  };
  const clock = options.clock ?? createSystemClock();
  const catalogue = createOpenRouterCatalogue(
    config,
    { fetch: options.fetch, env, logger, onCatalogueWaiterJoined: options.onCatalogueWaiterJoined },
    clock,
  );
  const createFetch = capturePageFetchFactory(
    config.settings,
    clock,
    pagePolicy,
    options.pageTransport,
  );
  const lifetime = createOperationRuntime({
    modelConcurrency: executionSettings.modelConcurrency,
    criticalReserve: executionSettings.criticalReserve,
    fetchConcurrency: executionSettings.aggregateFetchConcurrency,
    minRequestIntervalMs: config.settings.minRequestIntervalMs,
    clock,
    generation: 0,
    createFetch,
    createRuns: (operation) =>
      createRunStore({
        workspaceRoot: paths.workspaceRoot,
        cacheRoot: paths.cacheRoot,
        displayRoot: paths.cacheDisplayRoot,
        clock,
        randomId: () => randomBytes(16).toString("hex"),
        onDiagnostic: (diagnostic) => {
          logger.warn(`${diagnostic.code}: ${diagnostic.message}`);
        },
      }),
  });
  let closed = false;
  let closing: Promise<void> | undefined;
  return {
    identity,
    paths,
    admission,
    close: (reason?: string) => {
      closed = true;
      closing ??= Promise.all([lifetime.close(reason), catalogue.close()]).then(() => undefined);
      return closing;
    },
    async execute<Name extends keyof OperationInputs>(
      name: Name,
      params: OperationInputs[Name],
      execution: ExecuteOptions = {},
    ): Promise<OperationResult & { readonly execution: ExecutionReceipt }> {
      const state: { category: StandaloneErrorCode } = { category: "INVALID_ARGUMENTS" };
      let owned: OperationServices | undefined;
      const boundary = createOperationResultBoundary(
        clock,
        (event) => {
          if (event.event === "retry") logger.error(event.message);
          if (!closed) execution.onProgress?.({ ...event, message: redact(event.message) });
        },
        (diagnostic) => logger.warn(`${diagnostic.code}: ${diagnostic.message}`),
      );
      const operationId = randomUUID();
      const safeText = (text: string) =>
        redact(
          text
            .replace(
              /(^- Read (?:the extraction|the full page|the report): )`read ([^`]+)`/gm,
              "$1`$2` (use the host's file-reading capability)",
            )
            .replace(
              /Read a report with `read ([^`]+)`/g,
              "Read `$1` with the host's file-reading capability",
            ),
        );
      const safeData = (data: FullData): FullData => ({
        ...redactFullData(data, redact),
        text: safeText(data.text),
      });
      try {
        validate(name, params);
        if ("domains" in params && params.domains !== undefined) {
          validateDomains(params.domains, "domains");
          const search = config.settings.searchWebSearch;
          if (
            search.enabled &&
            ["perplexity", "firecrawl"].includes(search.engine ?? "") &&
            search.excludedDomains?.length &&
            params.domains.length
          )
            throw new Error(
              "This search engine cannot combine per-call domains and excludedDomains",
            );
        }
        const result = await lifetime.run(
          {
            operationId,
            signal: execution.signal,
            onProgress: execution.onProgress,
            onDiagnostic: (diagnostic) => logger.warn(`${diagnostic.code}: ${diagnostic.message}`),
          },
          async (services) => {
            owned = services;
            const signal = services.operation.signal;
            throwIfAborted(signal);
            state.category = "WORKSPACE";
            await assertWorkspaceSafe(paths, signal);
            // Per-operation credentials/binding validation/citations; only catalogue loading is shared.
            const models = createOpenRouterClient(config, {
              fetch: options.fetch,
              env,
              logger,
              signal,
              services,
              catalogue,
              random: Math.random,
            });
            const settings = config.settings;
            const bindings =
              name === "intelli_research"
                ? [
                    { role: "search", config: settings.searchModel },
                    { role: "extract", config: settings.extractModel },
                    { role: "collate", config: settings.collateModel },
                  ]
                : [
                    {
                      role: name.slice("intelli_".length),
                      config:
                        name === "intelli_search"
                          ? settings.searchModel
                          : name === "intelli_extract"
                            ? settings.extractModel
                            : settings.collateModel,
                    },
                  ];
            state.category = "CONFIGURATION";
            const missing = await models.preflight(bindings);
            if (missing.length)
              throw new Error(
                `Configured model unavailable for role(s): ${missing.map((item) => item.role).join(", ")}`,
              );
            throwIfAborted(signal);
            state.category = "WORKSPACE";
            await assertWorkspaceSafe(paths, signal);
            state.category = "OPERATION";
            let sequence = 0;
            const started = clock.monotonicMs();
            const context: OperationContext = {
              settings,
              models,
              paths,
              identity,
              logger,
              services,
              signal,
              now: () => clock.monotonicMs(),
              onProgress: (progress) =>
                services.onProgress?.({
                  ...progress,
                  operationId: services.operation.id,
                  sequence: ++sequence,
                  event: "update",
                  state: "running",
                  elapsedMs: clock.monotonicMs() - started,
                }),
            };
            const result = await withStandaloneStdout(logger, async () => {
              switch (name) {
                case "intelli_search":
                  return boundary!.run(() =>
                    search(params as OperationInputs["intelli_search"], boundary!.context(context)),
                  );
                case "intelli_extract":
                  return boundary!.run(() =>
                    extract(
                      params as OperationInputs["intelli_extract"],
                      boundary!.context(context),
                    ),
                  );
                case "intelli_collate":
                  return boundary!.run(() =>
                    collate(
                      params as OperationInputs["intelli_collate"],
                      boundary!.context(context),
                    ),
                  );
                case "intelli_research":
                  return boundary.run(() =>
                    research(
                      params as OperationInputs["intelli_research"],
                      boundary.context(context),
                    ),
                  );
                default:
                  throw new Error("Unknown operation");
              }
            });
            return {
              ...result,
              text: safeText(result.text),
            };
          },
        );
        const full = boundary?.settled();
        const data = full ? safeData(full.data) : undefined;
        return {
          ...result,
          ...(data ? { text: data.text, details: data.details, data, usage: full!.usage } : {}),
          execution: executionReceipt(owned!),
        };
      } catch (error) {
        // The runtime has settled before this boundary reads any ledger state.
        if (error instanceof CoreConfigurationError || error instanceof FetchConfigurationError)
          state.category = "CONFIGURATION";
        const cause =
          isOperationFailure(error) && error.cause instanceof StandaloneError ? error.cause : error;
        const aborted = Boolean(
          execution.signal?.aborted ||
          closed ||
          (isOperationFailure(error) && error.data.outcome === "aborted") ||
          (error instanceof Error &&
            (error.name === "AbortError" ||
              ("code" in error && (error.code === "ABORTED" || error.code === "CLOSED")))),
        );
        const receipt =
          owned && state.category === "OPERATION"
            ? executionReceipt(owned, aborted ? "unknown" : "available")
            : undefined;
        const full = boundary?.settled(
          {
            message: aborted
              ? "Operation aborted"
              : redact(error instanceof Error ? error.message : "Standalone operation failed"),
            aborted,
          },
          aborted ? "unknown" : "available",
        );
        if (aborted)
          throw new StandaloneError(
            "CANCELLED",
            "Operation aborted",
            receipt,
            full ? safeData(full.data) : undefined,
            full?.usage,
          );
        throw new StandaloneError(
          cause instanceof StandaloneError
            ? cause.code
            : error instanceof AdmissionError
              ? "OPERATION"
              : state.category,
          redact(error instanceof Error ? error.message : "Standalone operation failed"),
          receipt,
          full ? safeData(full.data) : undefined,
          full?.usage,
        );
      } finally {
        boundary?.dispose();
      }
    },
  };
}
