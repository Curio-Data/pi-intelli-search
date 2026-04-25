// src/settings.ts — Load settings from pi settings files (with in-memory cache)
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ModelConfig, ResearchSettings } from "./types.js";

const DEFAULT_SETTINGS: ResearchSettings = {
  searchModel: { provider: "openrouter", model: "perplexity/sonar" },
  extractModel: { provider: "minimax", model: "MiniMax-M2.7" },
  collateModel: { provider: "minimax", model: "MiniMax-M2.7" },
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

export async function loadSettings(cwd: string): Promise<ResearchSettings> {
  if (cachedSettings) return cachedSettings;

  const overrides: Partial<ResearchSettings> = {};

  // Try global settings first, then project-local
  const agentDir = join(homedir(), ".pi", "agent");
  for (const dir of [agentDir, join(cwd, ".pi")]) {
    try {
      const raw = await readFile(join(dir, "settings.json"), "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed.intelliSearchModel) overrides.searchModel = parsed.intelliSearchModel;
      if (parsed.intelliExtractModel) overrides.extractModel = parsed.intelliExtractModel;
      if (parsed.intelliCollateModel) overrides.collateModel = parsed.intelliCollateModel;
      if (parsed.intelliMaxUrls != null) overrides.maxUrls = parsed.intelliMaxUrls;
      if (parsed.intelliCacheDir) overrides.cacheDir = parsed.intelliCacheDir;
      if (parsed.intelliExtractMaxChars != null) overrides.extractMaxChars = parsed.intelliExtractMaxChars;
      if (parsed.intelliFetchTimeoutMs != null) overrides.fetchTimeoutMs = parsed.intelliFetchTimeoutMs;
      if (parsed.intelliFetchConcurrency != null) overrides.fetchConcurrency = parsed.intelliFetchConcurrency;
      if (parsed.intelliExtractionMaxTokens != null) overrides.extractionMaxTokens = parsed.intelliExtractionMaxTokens;
      if (parsed.intelliCollationMaxTokens != null) overrides.collationMaxTokens = parsed.intelliCollationMaxTokens;
      if (parsed.intelliLlmsFullSites) overrides.llmsFullSites = parsed.intelliLlmsFullSites;
      if (parsed.intelliBrowserFingerprint) overrides.browserFingerprint = parsed.intelliBrowserFingerprint;
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
