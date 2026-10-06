// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { Check } from "typebox/value";
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
  OperationProgress,
  OperationResult,
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
}
export interface ExecuteOptions {
  signal?: AbortSignal;
  onProgress?: (progress: OperationProgress) => void;
}
/** Direct engine boundary for Phase 3. Protocol scheduling is a separate adapter. */
export async function createRuntime(config: StandaloneConfig, options: RuntimeOptions = {}) {
  const paths = await workspacePaths(config.workspace, config.settings.cacheDir);
  const env = { ...(options.env ?? process.env) };
  const secret = env[config.apiKeyEnv];
  const redact = (message: string) => (secret ? message.split(secret).join("[REDACTED]") : message);
  const sink = options.logger ?? stderrLogger;
  const logger: OperationLogger = {
    error: (message) => sink.error(redact(message)),
    warn: (message) => sink.warn(redact(message)),
  };
  return {
    identity,
    paths,
    async execute<Name extends keyof OperationInputs>(
      name: Name,
      params: OperationInputs[Name],
      execution: ExecuteOptions = {},
    ): Promise<OperationResult> {
      let category: StandaloneErrorCode = "INVALID_ARGUMENTS";
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
        throwIfAborted(execution.signal);
        category = "WORKSPACE";
        await assertWorkspaceSafe(paths, execution.signal);
        // Per-operation credentials/catalogue/citation state, never a shared mutable host context.
        const models = createOpenRouterClient(config, {
          fetch: options.fetch,
          env,
          logger,
          signal: execution.signal,
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
        category = "CONFIGURATION";
        const missing = await models.preflight(bindings);
        if (missing.length)
          throw new Error(
            `Configured model unavailable for role(s): ${missing.map((item) => item.role).join(", ")}`,
          );
        throwIfAborted(execution.signal);
        category = "WORKSPACE";
        await assertWorkspaceSafe(paths, execution.signal);
        category = "OPERATION";
        const context: OperationContext = {
          settings,
          models,
          paths,
          identity,
          logger,
          ...execution,
        };
        const result = await withStandaloneStdout(logger, async () => {
          switch (name) {
            case "intelli_search":
              return search(params as OperationInputs["intelli_search"], context);
            case "intelli_extract":
              return extract(params as OperationInputs["intelli_extract"], context);
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
                /(^- Read (?:the extraction|the full page): )`read ([^`]+)`/gm,
                "$1`$2` (use the host's file-reading capability)",
              )
              .replace(
                /Read a report with `read ([^`]+)`/g,
                "Read `$1` with the host's file-reading capability",
              ),
          ),
        };
      } catch (error) {
        if (execution.signal?.aborted) throw new StandaloneError("CANCELLED", "Operation aborted");
        throw new StandaloneError(
          error instanceof StandaloneError ? error.code : category,
          redact(error instanceof Error ? error.message : "Standalone operation failed"),
        );
      }
    },
  };
}
