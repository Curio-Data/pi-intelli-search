// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
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
/** No credential or host-file discovery. Workspace must already exist. */
export async function parseConfig(value: unknown, workspace: string): Promise<StandaloneConfig> {
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
  if (!isAbsolute(text(workspace, "workspace")))
    throw new Error("workspace must be an explicit absolute directory");
  let canonical: string;
  try {
    canonical = await realpath(workspace);
    if (!(await stat(canonical)).isDirectory()) throw new Error();
  } catch {
    throw new Error("workspace must be an existing readable directory");
  }
  return freeze({ workspace: canonical, apiKeyEnv, settings });
}
export async function loadConfig(path: string, workspace: string): Promise<StandaloneConfig> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error("Cannot read configuration: provide an explicit readable JSON file");
  }
  return parseConfig(value, workspace);
}
