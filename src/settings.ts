// src/settings.ts — Load settings from pi settings files (with in-memory cache)
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ModelConfig, ResearchSettings } from "./types.js";
import { getAgentDir } from "./util.js";

const DEFAULT_SETTINGS: ResearchSettings = {
  searchModel: { provider: "openrouter", model: "perplexity/sonar" },
  extractModel: { provider: "openrouter", model: "minimax/minimax-m2.7" },
  collateModel: { provider: "openrouter", model: "minimax/minimax-m2.7" },
  maxUrls: 8,
  cacheDir: ".search",
  extractMaxChars: 150_000,
  fetchTimeoutMs: 20_000,
  fetchConcurrency: 4,
  extractionMaxTokens: 3000,
  collationMaxTokens: 4000,
  llmsFullSites: {},
  browserFingerprint: "chrome_145",
};

/** In-memory cache — invalidated on session_start / reload. */
let cachedSettings: ResearchSettings | null = null;

/** Called by index.ts on session_start to invalidate stale settings. */
export function invalidateSettingsCache(): void {
  cachedSettings = null;
}

/**
 * Read a settings.json file and extract overrides, supporting both
 * the nested `pi-intelli-search` namespace (preferred) and flat
 * `intelli*`-prefixed keys (deprecated, fallback).
 */
function extractOverrides(parsed: Record<string, unknown>): Partial<ResearchSettings> {
  const overrides: Partial<ResearchSettings> = {};

  // Nested namespace (preferred)
  const ns = parsed["pi-intelli-search"] as Record<string, unknown> | undefined;
  if (ns) {
    if (ns.searchModel) overrides.searchModel = ns.searchModel as ResearchSettings["searchModel"];
    if (ns.extractModel) overrides.extractModel = ns.extractModel as ResearchSettings["extractModel"];
    if (ns.collateModel) overrides.collateModel = ns.collateModel as ResearchSettings["collateModel"];
    if (ns.maxUrls != null) overrides.maxUrls = ns.maxUrls as number;
    if (ns.cacheDir) overrides.cacheDir = ns.cacheDir as string;
    if (ns.extractMaxChars != null) overrides.extractMaxChars = ns.extractMaxChars as number;
    if (ns.fetchTimeoutMs != null) overrides.fetchTimeoutMs = ns.fetchTimeoutMs as number;
    if (ns.fetchConcurrency != null) overrides.fetchConcurrency = ns.fetchConcurrency as number;
    if (ns.extractionMaxTokens != null) overrides.extractionMaxTokens = ns.extractionMaxTokens as number;
    if (ns.collationMaxTokens != null) overrides.collationMaxTokens = ns.collationMaxTokens as number;
    if (ns.llmsFullSites) overrides.llmsFullSites = ns.llmsFullSites as ResearchSettings["llmsFullSites"];
    if (ns.browserFingerprint) overrides.browserFingerprint = ns.browserFingerprint as string;
  }

  // Flat intelli* keys (deprecated fallback — nested namespace wins when both present)
  if (parsed.intelliSearchModel && !overrides.searchModel) overrides.searchModel = parsed.intelliSearchModel as ResearchSettings["searchModel"];
  if (parsed.intelliExtractModel && !overrides.extractModel) overrides.extractModel = parsed.intelliExtractModel as ResearchSettings["extractModel"];
  if (parsed.intelliCollateModel && !overrides.collateModel) overrides.collateModel = parsed.intelliCollateModel as ResearchSettings["collateModel"];
  if (parsed.intelliMaxUrls != null && overrides.maxUrls == null) overrides.maxUrls = parsed.intelliMaxUrls as number;
  if (parsed.intelliCacheDir && !overrides.cacheDir) overrides.cacheDir = parsed.intelliCacheDir as string;
  if (parsed.intelliExtractMaxChars != null && overrides.extractMaxChars == null) overrides.extractMaxChars = parsed.intelliExtractMaxChars as number;
  if (parsed.intelliFetchTimeoutMs != null && overrides.fetchTimeoutMs == null) overrides.fetchTimeoutMs = parsed.intelliFetchTimeoutMs as number;
  if (parsed.intelliFetchConcurrency != null && overrides.fetchConcurrency == null) overrides.fetchConcurrency = parsed.intelliFetchConcurrency as number;
  if (parsed.intelliExtractionMaxTokens != null && overrides.extractionMaxTokens == null) overrides.extractionMaxTokens = parsed.intelliExtractionMaxTokens as number;
  if (parsed.intelliCollationMaxTokens != null && overrides.collationMaxTokens == null) overrides.collationMaxTokens = parsed.intelliCollationMaxTokens as number;
  if (parsed.intelliLlmsFullSites && !overrides.llmsFullSites) overrides.llmsFullSites = parsed.intelliLlmsFullSites as ResearchSettings["llmsFullSites"];
  if (parsed.intelliBrowserFingerprint && !overrides.browserFingerprint) overrides.browserFingerprint = parsed.intelliBrowserFingerprint as string;

  return overrides;
}

/**
 * Check whether any settings file contains flat intelli*-prefixed keys.
 * Used to decide whether to show a deprecation notice on upgrade.
 */
export async function hasFlatKeys(cwd: string): Promise<boolean> {
  const agentDir = getAgentDir();
  for (const dir of [agentDir, join(cwd, ".pi")]) {
    try {
      const raw = await readFile(join(dir, "settings.json"), "utf-8");
      const parsed = JSON.parse(raw);
      // Check for any intelli-prefixed key
      for (const key of Object.keys(parsed)) {
        if (key.startsWith("intelli")) return true;
      }
    } catch {
      // File doesn't exist or is invalid — skip
    }
  }
  return false;
}

export async function loadSettings(cwd: string): Promise<ResearchSettings> {
  if (cachedSettings) return cachedSettings;

  const overrides: Partial<ResearchSettings> = {};

  // Try global settings first, then project-local
  const agentDir = getAgentDir();
  for (const dir of [agentDir, join(cwd, ".pi")]) {
    try {
      const raw = await readFile(join(dir, "settings.json"), "utf-8");
      const parsed = JSON.parse(raw);
      const dirOverrides = extractOverrides(parsed);
      Object.assign(overrides, dirOverrides);
    } catch {
      // File doesn't exist or is invalid — skip
    }
  }

  cachedSettings = { ...DEFAULT_SETTINGS, ...overrides };
  return cachedSettings;
}

export function resolveModelConfig(settings: ResearchSettings, role: "search" | "extract" | "collate"): ModelConfig {
  switch (role) {
    case "search": return settings.searchModel;
    case "extract": return settings.extractModel;
    case "collate": return settings.collateModel;
  }
}
