// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { Check } from "typebox/value";
import { randomBytes, randomUUID } from "node:crypto";
import { createOperationRuntime } from "../../../src/core/operation-runtime.js";
import { AdmissionError } from "../../../src/core/execution-coordinator.js";
import { createSystemClock } from "../../../src/core/clock.js";
import { createStandaloneResult } from "../../../src/core/standalone-result.js";
import {
  parseExecutionSettings,
  validateRequestInterval,
} from "../../../src/core/execution-settings.js";
import { createRunStore } from "../../../src/core/run-store.js";
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
  FetchClient,
  FullData,
} from "../../../src/core/contracts.js";
import type { ResearchDependencies } from "../../../src/core/operations/research.js";
import type { FetchFunction } from "../../../src/core/annotations.js";
import {
  ConfigurationError,
  loadConfig,
  parseConfig,
  validateDomains,
  type StandaloneConfig,
} from "./config.js";
import { createOpenRouterClient } from "./providers/openrouter.js";
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
  researchDependencies?: ResearchDependencies;
  /** Deterministic runtime clock; never an operation-owned replacement. */
  clock?: Clock;
}
export interface ExecuteOptions {
  signal?: AbortSignal;
  onProgress?: (progress: Progress) => void;
}
/** Registered operation lifetime. Protocol admission remains a separate adapter. */
export async function createRuntime(config: StandaloneConfig, options: RuntimeOptions = {}) {
  // Capture the caller's settings once, before constructing the coordinator.
  config = structuredClone(config);
  options = {
    ...options,
    researchDependencies: options.researchDependencies
      ? { ...options.researchDependencies }
      : undefined,
  };
  // Public runtime callers may supply an object without using parseConfig().
  // Revalidate captured execution/pacing before any workspace or provider work.
  const executionSettings = parseExecutionSettings(config.settings.execution, "tuning.execution");
  config = { ...config, settings: { ...config.settings, execution: executionSettings } };
  validateRequestInterval(config.settings.minRequestIntervalMs, "tuning.minRequestIntervalMs");
  const paths = await workspacePaths(config.workspace, config.settings.cacheDir);
  const env = { ...(options.env ?? process.env) };
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
  // Fetch/persistence production is a later slice. Never silently substitute the
  // unbounded legacy fetch implementation behind the new FetchClient contract.
  const unwiredFetch: FetchClient = Object.freeze({
    async fetch() {
      throw new Error("Coordinated fetch is not installed");
    },
    async discover() {
      throw new Error("Coordinated discovery is not installed");
    },
  });
  const lifetime = createOperationRuntime({
    modelConcurrency: executionSettings.modelConcurrency,
    criticalReserve: executionSettings.criticalReserve,
    fetchConcurrency: executionSettings.aggregateFetchConcurrency,
    minRequestIntervalMs: config.settings.minRequestIntervalMs,
    clock,
    generation: 0,
    createFetch: () => unwiredFetch,
    createRuns: () =>
      createRunStore({
        workspaceRoot: paths.workspaceRoot,
        cacheRoot: paths.cacheRoot,
        displayRoot: paths.cacheDisplayRoot,
        clock,
        randomId: () => randomBytes(16).toString("hex"),
        onDiagnostic: (diagnostic) => logger.warn(`${diagnostic.code}: ${diagnostic.message}`),
      }),
  });
  let closed = false;
  return {
    identity,
    paths,
    close: (reason?: string) => {
      closed = true;
      return lifetime.close(reason);
    },
    async execute<Name extends keyof OperationInputs>(
      name: Name,
      params: OperationInputs[Name],
      execution: ExecuteOptions = {},
    ): Promise<OperationResult & { readonly execution: ExecutionReceipt }> {
      const state: { category: StandaloneErrorCode } = { category: "INVALID_ARGUMENTS" };
      let owned: OperationServices | undefined;
      const projection =
        name === "intelli_search" || name === "intelli_extract"
          ? createStandaloneResult(
              name,
              params,
              clock,
              (event) => {
                if (!closed) execution.onProgress?.({ ...event, message: redact(event.message) });
              },
              (diagnostic) => logger.warn(`${diagnostic.code}: ${diagnostic.message}`),
            )
          : undefined;
      const safeData = (data: FullData): FullData =>
        JSON.parse(
          JSON.stringify(data, (_key, value: unknown) =>
            typeof value === "string" ? redact(value) : value,
          ),
        );
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
            operationId: randomUUID(),
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
            // Per-operation credentials/catalogue/citation state, never a shared mutable host context.
            const models = createOpenRouterClient(config, {
              fetch: options.fetch,
              env,
              logger,
              signal,
              services,
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
                  return projection!.run(context, (scoped) =>
                    search(params as OperationInputs["intelli_search"], scoped),
                  );
                case "intelli_extract":
                  return projection!.run(context, (scoped) =>
                    extract(params as OperationInputs["intelli_extract"], scoped),
                  );
                case "intelli_collate":
                  return collate(params as OperationInputs["intelli_collate"], context);
                case "intelli_research":
                  return research(
                    params as OperationInputs["intelli_research"],
                    context,
                    options.researchDependencies,
                  );
                default:
                  throw new Error("Unknown operation");
              }
            });
            return {
              ...result,
              text: redact(
                result.text
                  .replace(
                    /(^- Read (?:the extraction|the full page|the report): )`read ([^`]+)`/gm,
                    "$1`$2` (use the host's file-reading capability)",
                  )
                  .replace(
                    /Read a report with `read ([^`]+)`/g,
                    "Read `$1` with the host's file-reading capability",
                  ),
              ),
            };
          },
        );
        const full = projection?.settled(result);
        const data = full ? safeData(full.data) : undefined;
        return {
          ...result,
          ...(data ? { text: data.text, details: data.details, data, usage: full!.usage } : {}),
          execution: executionReceipt(owned!),
        };
      } catch (error) {
        // The runtime has settled before this boundary reads any ledger state.
        const receipt =
          owned && state.category === "OPERATION"
            ? executionReceipt(owned, execution.signal?.aborted || closed ? "unknown" : "available")
            : undefined;
        const aborted = Boolean(
          execution.signal?.aborted ||
          closed ||
          (error instanceof AdmissionError && ["ABORTED", "CLOSED"].includes(error.code)),
        );
        const full = projection?.active
          ? projection.settled(
              undefined,
              {
                message: redact(
                  error instanceof Error ? error.message : "Standalone operation failed",
                ),
                aborted,
              },
              aborted ? "unknown" : "available",
            )
          : undefined;
        if (
          execution.signal?.aborted ||
          (error instanceof Error &&
            (error.name === "AbortError" ||
              ("code" in error && (error.code === "ABORTED" || error.code === "CLOSED"))))
        )
          throw new StandaloneError(
            "CANCELLED",
            "Operation aborted",
            receipt,
            full ? safeData(full.data) : undefined,
            full?.usage,
          );
        throw new StandaloneError(
          error instanceof StandaloneError
            ? error.code
            : error instanceof AdmissionError
              ? "OPERATION"
              : state.category,
          redact(error instanceof Error ? error.message : "Standalone operation failed"),
          receipt,
          full ? safeData(full.data) : undefined,
          full?.usage,
        );
      } finally {
        projection?.dispose();
      }
    },
  };
}
