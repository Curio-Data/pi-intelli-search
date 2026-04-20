// test/settings.test.ts — Unit tests for settings loading
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveModelConfig } from "../src/settings.js";
import type { ResearchSettings } from "../src/types.js";

const baseSettings: ResearchSettings = {
  searchModel: { provider: "openrouter", model: "perplexity/sonar" },
  extractModel: { provider: "minimax", model: "MiniMax-M2.7" },
  collateModel: { provider: "minimax", model: "MiniMax-M2.7" },
  maxUrls: 8,
  cacheDir: ".search",
  extractMaxChars: 150_000,
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
