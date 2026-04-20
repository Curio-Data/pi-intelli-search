// src/settings.ts — Load settings from pi settings files
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
};

export async function loadSettings(
  cwd: string,
): Promise<ResearchSettings> {
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
    } catch {
      // File doesn't exist or is invalid — skip
    }
  }

  return { ...DEFAULT_SETTINGS, ...overrides };
}

export function resolveModelConfig(settings: ResearchSettings, role: "search" | "extract" | "collate"): ModelConfig {
  switch (role) {
    case "search": return settings.searchModel;
    case "extract": return settings.extractModel;
    case "collate": return settings.collateModel;
  }
}
