// test/settings.test.ts — Unit tests for settings loading
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveModelConfig, loadSettings, invalidateSettingsCache } from "../src/settings.js";
import type { ResearchSettings } from "../src/types.js";

const baseSettings: ResearchSettings = {
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

describe("resolveModelConfig", () => {
  it("returns search model for 'search' role", () => {
    const result = resolveModelConfig(baseSettings, "search");
    assert.deepStrictEqual(result, { provider: "openrouter", model: "perplexity/sonar" });
  });

  it("returns extract model for 'extract' role", () => {
    const result = resolveModelConfig(baseSettings, "extract");
    assert.deepStrictEqual(result, { provider: "minimax", model: "MiniMax-M2.7" });
  });

  it("returns collate model for 'collate' role", () => {
    const result = resolveModelConfig(baseSettings, "collate");
    assert.deepStrictEqual(result, { provider: "minimax", model: "MiniMax-M2.7" });
  });

  it("returns different models when configured differently", () => {
    const custom: ResearchSettings = {
      ...baseSettings,
      searchModel: { provider: "openrouter", model: "perplexity/sonar-pro" },
      extractModel: { provider: "openai", model: "gpt-4o-mini" },
    };
    assert.deepStrictEqual(resolveModelConfig(custom, "search"), {
      provider: "openrouter",
      model: "perplexity/sonar-pro",
    });
    assert.deepStrictEqual(resolveModelConfig(custom, "extract"), {
      provider: "openai",
      model: "gpt-4o-mini",
    });
    // Collate unchanged
    assert.deepStrictEqual(resolveModelConfig(custom, "collate"), {
      provider: "minimax",
      model: "MiniMax-M2.7",
    });
  });
});

describe("loadSettings defaults", () => {
  it("returns all default settings when no overrides exist", async () => {
    // Invalidate cache to force fresh load
    invalidateSettingsCache();
    const settings = await loadSettings("/nonexistent");

    assert.strictEqual(settings.maxUrls, 8);
    assert.strictEqual(settings.cacheDir, ".search");
    assert.strictEqual(settings.extractMaxChars, 150_000);
    assert.strictEqual(settings.fetchTimeoutMs, 20_000);
    assert.strictEqual(settings.fetchConcurrency, 4);
    assert.strictEqual(settings.extractionMaxTokens, 3000);
    assert.strictEqual(settings.collationMaxTokens, 4000);
    assert.deepStrictEqual(settings.llmsFullSites, {});
    assert.strictEqual(settings.browserFingerprint, "chrome_145");
  });
});

describe("settings caching", () => {
  it("returns cached settings on second call", async () => {
    invalidateSettingsCache();
    const first = await loadSettings("/nonexistent");
    const second = await loadSettings("/nonexistent");
    assert.strictEqual(first, second, "Should return the same object reference");
  });

  it("invalidateSettingsCache forces fresh load", async () => {
    invalidateSettingsCache();
    const first = await loadSettings("/nonexistent");
    invalidateSettingsCache();
    const second = await loadSettings("/nonexistent");
    assert.notStrictEqual(first, second, "Should return a new object after invalidation");
  });
});
