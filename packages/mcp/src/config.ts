// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { tuningDefaults } from "../../../src/core/defaults.js";
import type { DeepReadonly } from "../../../src/core/contracts.js";
import type { ModelConfig, ResearchSettings } from "../../../src/core/types.js";

export interface StandaloneConfig {
  readonly workspace: string;
  readonly apiKeyEnv: string;
  readonly settings: DeepReadonly<ResearchSettings>;
}

export function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error(`${label} contains an unknown key`);
}
function text(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value !== value.trim() ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw new Error(`${label} must be a nonempty, trimmed string without control characters`);
  return value;
}
function integer(value: unknown, min: number, max: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max)
    throw new Error(`${label} must be an integer between ${min} and ${max}`);
  return value as number;
}
function choice<const T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T))
    throw new Error(`${label} has an unsupported value`);
  return value as T;
}
function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean`);
  return value;
}
export function validateCacheDir(value: unknown): string {
  const path = text(value, "tuning.cacheDir");
  if (
    isAbsolute(path) ||
    path.includes("\\") ||
    path.includes(":") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("tuning.cacheDir must be a workspace-relative directory without traversal");
  return path;
}
function model(value: unknown, role: string): ModelConfig {
  const obj = object(value, `models.${role}`);
  keys(obj, ["provider", "model"], `models.${role}`);
  choice(obj.provider, ["openrouter"], `models.${role}.provider`);
  const id = text(obj.model, `models.${role}.model`);
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.:-]+$/.test(id) || id.startsWith("openrouter/"))
    throw new Error(`models.${role}.model must select a concrete provider/model identifier`);
  return { provider: "openrouter", model: id };
}
const ranges: Record<string, readonly [number, number]> = {
  defaultUrls: [1, 100],
  maxUrls: [1, 100],
  extractMaxChars: [1, 2_000_000],
  fetchTimeoutMs: [1, 600_000],
  fetchConcurrency: [1, 32],
  extractionConcurrency: [1, 32],
  extractionMaxTokens: [16, 128_000],
  collationMaxTokens: [16, 128_000],
  llmTimeoutMs: [1, 600_000],
  llmRetryAttempts: [1, 10],
  retryBaseDelayMs: [0, 120_000],
  retryMaxDelayMs: [0, 120_000],
  searchRetryAttempts: [1, 10],
  minRequestIntervalMs: [0, 120_000],
};
export function validateDomains(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    value.some(
      (item) =>
        typeof item !== "string" ||
        !/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(
          item,
        ),
    )
  )
    throw new Error(`${label} must contain hostnames, not URLs`);
  return [...value];
}
function webSearch(value: unknown): ResearchSettings["searchWebSearch"] {
  const obj = object(value, "tuning.searchWebSearch");
  keys(
    obj,
    [
      "enabled",
      "engine",
      "maxResults",
      "searchContextSize",
      "allowedDomains",
      "excludedDomains",
      "reasoning",
    ],
    "tuning.searchWebSearch",
  );
  const result: ResearchSettings["searchWebSearch"] = {
    enabled: bool(obj.enabled, "searchWebSearch.enabled"),
  };
  if (obj.engine !== undefined)
    result.engine = choice(
      obj.engine,
      ["auto", "native", "exa", "parallel", "perplexity", "firecrawl"],
      "searchWebSearch.engine",
    );
  if (obj.maxResults !== undefined)
    result.maxResults = integer(
      obj.maxResults,
      1,
      result.engine === "perplexity" ? 20 : 25,
      "searchWebSearch.maxResults",
    );
  if (obj.searchContextSize !== undefined)
    result.searchContextSize = choice(
      obj.searchContextSize,
      ["low", "medium", "high"],
      "searchWebSearch.searchContextSize",
    );
  if (obj.reasoning !== undefined)
    result.reasoning = choice(
      obj.reasoning,
      ["minimal", "low", "medium", "high"],
      "searchWebSearch.reasoning",
    );
  if (obj.allowedDomains !== undefined)
    result.allowedDomains = validateDomains(obj.allowedDomains, "searchWebSearch.allowedDomains");
  if (obj.excludedDomains !== undefined)
    result.excludedDomains = validateDomains(
      obj.excludedDomains,
      "searchWebSearch.excludedDomains",
    );
  if (
    ["perplexity", "firecrawl"].includes(result.engine ?? "") &&
    result.allowedDomains?.length &&
    result.excludedDomains?.length
  )
    throw new Error("This search engine cannot combine allowed and excluded domains");
  return result;
}
function freeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}
/** Reasons a selected configuration file cannot become a configuration. */
export type ConfigurationErrorReason = "missing" | "unreadable" | "invalid-json" | "invalid";

/**
 * A defect in the selected configuration file itself, as distinct from a
 * launcher defect (absent arguments or an unusable workspace). The message
 * names the file and, for malformed JSON, the position; it never quotes the
 * file body, which may hold a misplaced credential.
 */
export class ConfigurationError extends Error {
  constructor(
    readonly reason: ConfigurationErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "ConfigurationError";
  }
}

/** Line and column (both 1-based) of a character offset. */
function position(source: string, offset: number): { line: number; column: number } {
  const before = source.slice(0, Math.max(0, Math.min(offset, source.length)));
  const lines = before.split("\n");
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

/** Error offset reported by a JSON.parse failure, if any; undefined at end of input. */
function failureOffset(source: string): number | undefined {
  try {
    JSON.parse(source);
    return undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/Unexpected end/.test(message)) return undefined;
    const offset = /at position (\d+)/.exec(message);
    // V8 omits the position from its "Unexpected token" form; -1 marks it.
    if (!offset) return -1;
    const at = Number(offset[1]);
    return at < source.length ? at : undefined;
  }
}

/**
 * Locates a JSON syntax error without echoing the engine message: V8 quotes
 * part of the input in some messages (for example `"abc" is not valid JSON`),
 * and the file may hold a misplaced credential.
 */
function syntaxLocation(source: string): string {
  let offset = failureOffset(source);
  if (offset === -1) {
    // Shortest failing prefix: shorter prefixes are merely incomplete.
    let low = 1;
    let high = source.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (failureOffset(source.slice(0, middle)) === undefined) low = middle + 1;
      else high = middle;
    }
    offset = low - 1;
  }
  if (offset === undefined)
    return `end of input (line ${position(source, source.trimEnd().length).line}); the file is incomplete`;
  const { line, column } = position(source, offset);
  return `line ${line}, column ${column}`;
}

/** Explicit absolute workspace, canonicalised. A launcher defect, never lazily recovered. */
export async function resolveWorkspace(workspace: string): Promise<string> {
  if (!isAbsolute(text(workspace, "workspace")))
    throw new Error("workspace must be an explicit absolute directory");
  let canonical: string;
  try {
    canonical = await realpath(workspace);
    if (!(await stat(canonical)).isDirectory()) throw new Error();
  } catch {
    throw new Error("workspace must be an existing readable directory");
  }
  return canonical;
}

/** No credential or host-file discovery. Workspace must already exist. */
export async function parseConfig(value: unknown, workspace: string): Promise<StandaloneConfig> {
  const { apiKeyEnv, settings } = parseDocument(value);
  return freeze({ workspace: await resolveWorkspace(workspace), apiKeyEnv, settings });
}
function parseDocument(value: unknown): { apiKeyEnv: string; settings: ResearchSettings } {
  const root = object(value, "configuration");
  keys(root, ["providers", "models", "tuning"], "configuration");
  const providers = object(root.providers, "providers");
  keys(providers, ["openrouter"], "providers");
  const provider = object(providers.openrouter, "providers.openrouter");
  keys(provider, ["apiKeyEnv"], "providers.openrouter");
  const apiKeyEnv = text(provider.apiKeyEnv, "providers.openrouter.apiKeyEnv");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv))
    throw new Error("apiKeyEnv must name an environment variable, not contain a credential");
  const models = object(root.models, "models");
  keys(models, ["search", "extract", "collate"], "models");
  const tuning = root.tuning === undefined ? {} : object(root.tuning, "tuning");
  keys(
    tuning,
    [
      ...Object.keys(ranges),
      "cacheDir",
      "browserFingerprint",
      "disableTelemetry",
      "disableLlmsFullDiscovery",
      "searchWebSearch",
    ],
    "tuning",
  );
  const settings: ResearchSettings = {
    ...tuningDefaults(),
    searchModel: model(models.search, "search"),
    extractModel: model(models.extract, "extract"),
    collateModel: model(models.collate, "collate"),
  };
  for (const [key, [min, max]] of Object.entries(ranges)) {
    if (tuning[key] !== undefined)
      Object.assign(settings, { [key]: integer(tuning[key], min, max, `tuning.${key}`) });
  }
  if (tuning.cacheDir !== undefined) settings.cacheDir = validateCacheDir(tuning.cacheDir);
  if (tuning.browserFingerprint !== undefined) {
    // The initial standalone path deliberately supports only the verified shared profile.
    settings.browserFingerprint = choice(
      tuning.browserFingerprint,
      ["chrome_145"],
      "tuning.browserFingerprint",
    );
  }
  for (const key of ["disableTelemetry", "disableLlmsFullDiscovery"] as const)
    if (tuning[key] !== undefined) settings[key] = bool(tuning[key], `tuning.${key}`);
  if (tuning.searchWebSearch !== undefined)
    settings.searchWebSearch = webSearch(tuning.searchWebSearch);
  if (settings.defaultUrls > settings.maxUrls)
    throw new Error("defaultUrls must not exceed maxUrls");
  if (settings.retryBaseDelayMs > settings.retryMaxDelayMs)
    throw new Error("retryBaseDelayMs must not exceed retryMaxDelayMs");
  if (
    !settings.searchWebSearch.enabled &&
    !["perplexity/sonar", "perplexity/sonar-pro", "perplexity/sonar-pro-search"].includes(
      settings.searchModel.model,
    )
  )
    throw new Error(
      "Search requires an explicitly enabled searchWebSearch tool or a supported Sonar search model",
    );
  return { apiKeyEnv, settings };
}
/**
 * Reads and validates the selected file. File defects (missing, unreadable,
 * malformed JSON, invalid contents) throw ConfigurationError; an unusable
 * workspace throws a plain Error.
 */
export async function loadConfig(file: string, workspace: string): Promise<StandaloneConfig> {
  // Absolute and printable, so a tool error names the file to repair.
  const path = resolve(file).replace(/[\x00-\x1f\x7f]/g, "?");
  let source: string;
  try {
    source = await readFile(file, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR")
      throw new ConfigurationError("missing", `Configuration file not found: ${path}`);
    throw new ConfigurationError(
      "unreadable",
      code === "EISDIR"
        ? `Configuration path is a directory, not a file: ${path}`
        : code === "EACCES" || code === "EPERM"
          ? `Configuration file is not readable (permission denied): ${path}`
          : `Cannot read configuration file: ${path}`,
    );
  }
  // Editors on some platforms prepend a byte order mark, which JSON forbids.
  if (source.startsWith("\uFEFF")) source = source.slice(1);
  if (!source.trim())
    throw new ConfigurationError("invalid-json", `Configuration file is empty: ${path}`);
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new ConfigurationError(
      "invalid-json",
      `Configuration file is not valid JSON at ${syntaxLocation(source)}: ${path}`,
    );
  }
  let parsed: ReturnType<typeof parseDocument>;
  try {
    parsed = parseDocument(value);
  } catch (error) {
    throw new ConfigurationError(
      "invalid",
      `Invalid configuration in ${path}: ${error instanceof Error ? error.message : "unknown defect"}`,
    );
  }
  return freeze({
    workspace: await resolveWorkspace(workspace),
    apiKeyEnv: parsed.apiKeyEnv,
    settings: parsed.settings,
  });
}
