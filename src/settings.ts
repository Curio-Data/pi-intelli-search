// src/settings.ts — Load settings from pi settings files (with in-memory cache)
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ModelConfig, ResearchSettings } from "./types.js";
import { getAgentDir } from "./util.js";

const DEFAULT_SETTINGS: ResearchSettings = {
  searchModel: { provider: "openrouter", model: "perplexity/sonar" },
  extractModel: { provider: "openrouter", model: "minimax/minimax-m2.7" },
  collateModel: { provider: "openrouter", model: "minimax/minimax-m2.7" },
  defaultUrls: 8,
  maxUrls: 16,
  cacheDir: ".search",
  extractMaxChars: 150_000,
  fetchTimeoutMs: 20_000,
  fetchConcurrency: 4,
  extractionMaxTokens: 3000,
  collationMaxTokens: 4000,
  llmsFullSites: {},
  browserFingerprint: "chrome_145",
};

/**
 * Default model configs that changed between versions.
 * When a user upgrades and their model config matches a previous
 * version's default, we swap it to the current default.
 *
 * Each entry records the defaults that were ACTIVE for that version.
 * The version key is the release that INTRODUCED those defaults.
 *
 * Example: 0.7.0 used minimax/MiniMax-M2.7. 0.8.0 switched to
 * openrouter/minimax/minimax-m2.7. A user upgrading from 0.7.0
 * whose extractModel still says minimax/MiniMax-M2.7 gets migrated
 * to the 0.8.0 default.
 */
const DEFAULT_HISTORY: Record<string, {
  extractModel?: ModelConfig;
  collateModel?: ModelConfig;
  searchModel?: ModelConfig;
}> = {
  // Every entry MUST include every model role, even when unchanged from
  // prior versions. Migration skips roles missing from either old or new
  // defaults, so a gap in one entry silently strands upgrades that route
  // through it.
  "0.7.0": {
    // Defaults active in 0.7.0: pre-OpenRouter-consolidation
    extractModel: { provider: "minimax", model: "MiniMax-M2.7" },
    collateModel: { provider: "minimax", model: "MiniMax-M2.7" },
    searchModel: { provider: "openrouter", model: "perplexity/sonar" },
  },
  "0.8.0": {
    // Defaults active in 0.8.0: OpenRouter for all stages
    extractModel: { provider: "openrouter", model: "minimax/minimax-m2.7" },
    collateModel: { provider: "openrouter", model: "minimax/minimax-m2.7" },
    searchModel: { provider: "openrouter", model: "perplexity/sonar" },
    // maxUrls is now a hard cap (was a default pre-0.8.0).
    // defaultUrls is the new agent fallback.
  },
};

/** In-memory cache: invalidated on session_start / reload. */
let cachedSettings: ResearchSettings | null = null;

/**
 * Migration context set by index.ts on session_start when a version
 * change is detected. loadSettings() applies this migration in-memory
 * so tools always get the migrated defaults. Cleared after consumption.
 */
let pendingMigration: { previousVersion: string; currentVersion: string } | null = null;

/** Called by index.ts on session_start to invalidate stale settings. */
export function invalidateSettingsCache(): void {
  cachedSettings = null;
}

/**
 * Set the migration context for the current session.
 * Called by index.ts when a version upgrade is detected.
 * loadSettings() applies the migration to in-memory settings.
 */
export function setMigrationContext(previousVersion: string, currentVersion: string): void {
  pendingMigration = { previousVersion, currentVersion };
}

/**
 * Clear the migration context. Used in tests to reset state
 * between scenarios.
 */
export function clearMigrationContext(): void {
  pendingMigration = null;
}

/**
 * Migrate user settings when upgrading from a previous version.
 *
 * For each model role (search, extract, collate), compares the user's
 * current setting against the previous version's default. If they match
 * exactly, the user never customized that role: auto-migrate to the
 * current default. If they differ, the user customized: leave alone.
 *
 * Migration is in-memory only: it does NOT write to settings.json.
 * Users are notified of changes and can make them permanent.
 *
 * @param previousVersion The version the user is upgrading FROM
 * @param currentVersion  The version the user is upgrading TO
 * @param userSettings    The user's current ResearchSettings
 * @returns Migration changes (human-readable) and migrated settings
 */
export function migrateDefaults(
  previousVersion: string,
  currentVersion: string,
  userSettings: ResearchSettings,
): { changes: string[]; settings: ResearchSettings } {
  const changes: string[] = [];
  const settings = { ...userSettings };

  const oldDefaults = DEFAULT_HISTORY[previousVersion];
  const newDefaults = DEFAULT_HISTORY[currentVersion];

  if (!oldDefaults || !newDefaults) return { changes, settings };

  const roles: Array<{
    key: "searchModel" | "extractModel" | "collateModel";
    label: string;
  }> = [
    { key: "extractModel", label: "extract" },
    { key: "collateModel", label: "collate" },
    { key: "searchModel", label: "search" },
  ];

  for (const { key, label } of roles) {
    const oldDefault = oldDefaults[key];
    const newDefault = newDefaults[key];
    if (!oldDefault || !newDefault) continue;

    // Only migrate if the defaults actually changed between versions
    if (
      oldDefault.provider === newDefault.provider &&
      oldDefault.model === newDefault.model
    ) continue;

    const userSetting = settings[key];
    if (
      userSetting.provider === oldDefault.provider &&
      userSetting.model === oldDefault.model
    ) {
      // User was using the old default: migrate to new default
      (settings as Record<string, unknown>)[key] = { ...newDefault };
      changes.push(
        `${label}: ${oldDefault.provider}/${oldDefault.model} → ${newDefault.provider}/${newDefault.model}`,
      );
    }
  }

  return { changes, settings };
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
    if (ns.defaultUrls != null) overrides.defaultUrls = ns.defaultUrls as number;
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

  // Flat intelli* keys (deprecated fallback: nested namespace wins when both present).
  // intelliMaxUrls maps to maxUrls (the cap), matching what users always assumed it did.
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
      // File doesn't exist or is invalid: skip
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
      // File doesn't exist or is invalid: skip
    }
  }

  // Note: overrides use shallow Object.assign. Today every key in
  // ResearchSettings is either a scalar or a complete ModelConfig
  // object, so partial nested overrides don't arise. A future field
  // that is a non-trivial nested object would need deep merging.
  cachedSettings = { ...DEFAULT_SETTINGS, ...overrides };

  // Apply default migration in-memory when upgrading between versions.
  // If the user's model config matches a previous version's default,
  // swap it to the current default. Migration is in-memory only;
  // users must update settings.json to make it permanent.
  if (pendingMigration) {
    const { settings: migrated } = migrateDefaults(
      pendingMigration.previousVersion,
      pendingMigration.currentVersion,
      cachedSettings,
    );
    cachedSettings = migrated;
    pendingMigration = null;
  }

  return cachedSettings;
}

export function resolveModelConfig(settings: ResearchSettings, role: "search" | "extract" | "collate"): ModelConfig {
  switch (role) {
    case "search": return settings.searchModel;
    case "extract": return settings.extractModel;
    case "collate": return settings.collateModel;
  }
}
