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
      if (parsed.webResearchSearchModel) overrides.searchModel = parsed.webResearchSearchModel;
      if (parsed.webResearchExtractModel) overrides.extractModel = parsed.webResearchExtractModel;
      if (parsed.webResearchCollateModel) overrides.collateModel = parsed.webResearchCollateModel;
      if (parsed.webResearchMaxUrls != null) overrides.maxUrls = parsed.webResearchMaxUrls;
      if (parsed.webResearchCacheDir) overrides.cacheDir = parsed.webResearchCacheDir;
      if (parsed.webResearchExtractMaxChars != null) overrides.extractMaxChars = parsed.webResearchExtractMaxChars;
      if (parsed.webResearchFetchTimeoutMs != null) overrides.fetchTimeoutMs = parsed.webResearchFetchTimeoutMs;
      if (parsed.webResearchFetchConcurrency != null) overrides.fetchConcurrency = parsed.webResearchFetchConcurrency;
      if (parsed.webResearchExtractionMaxTokens != null) overrides.extractionMaxTokens = parsed.webResearchExtractionMaxTokens;
      if (parsed.webResearchCollationMaxTokens != null) overrides.collationMaxTokens = parsed.webResearchCollationMaxTokens;
      if (parsed.webResearchLlmsFullSites) overrides.llmsFullSites = parsed.webResearchLlmsFullSites;
      if (parsed.webResearchBrowserFingerprint) overrides.browserFingerprint = parsed.webResearchBrowserFingerprint;
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
