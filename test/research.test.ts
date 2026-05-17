// test/research.test.ts — Unit tests for intelli_research tool
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Minimal mock of the ExtensionContext.modelRegistry shape needed by
// validateModelConfigs(). Using a Partial caster avoids the `as any`
// blanket suppression without pulling in the full Pi SDK type.
type MockModelRegistry = { find: (provider: string, model: string) => unknown };
type MockCtx = { modelRegistry: MockModelRegistry };

describe("validateModelConfigs", () => {
  it("returns empty array when all models exist in registry", async () => {
    const mockCtx: MockCtx = {
      modelRegistry: {
        find(_provider: string, _model: string) {
          return { id: `${_provider}/${_model}`, name: "Test Model" };
        },
      },
    };

    const { validateModelConfigs } = await import("../src/tools/intelli-research.js");
    const result = validateModelConfigs(mockCtx as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext, [
      { role: "search", config: { provider: "openrouter", model: "perplexity/sonar" } },
      { role: "extract", config: { provider: "openrouter", model: "minimax/minimax-m2.7" } },
      { role: "collate", config: { provider: "openrouter", model: "minimax/minimax-m2.7" } },
    ]);

    assert.deepStrictEqual(result, [], "should return empty when all models found");
  });

  it("detects a single misspelled model", async () => {
    const mockCtx: MockCtx = {
      modelRegistry: {
        find(provider: string, model: string) {
          // Only Sonar exists; MiniMax model is misspelled
          if (provider === "openrouter" && model === "perplexity/sonar") {
            return { id: "perplexity/sonar", name: "Sonar" };
          }
          return null;
        },
      },
    };

    const { validateModelConfigs } = await import("../src/tools/intelli-research.js");
    const result = validateModelConfigs(mockCtx as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext, [
      { role: "search", config: { provider: "openrouter", model: "perplexity/sonar" } },
      { role: "extract", config: { provider: "openrouter", model: "minimax/M3.7" } },
      { role: "collate", config: { provider: "openrouter", model: "minimax/M3.7" } },
    ]);

    assert.strictEqual(result.length, 2, "should detect two missing models");
    assert.strictEqual(result[0].role, "extract");
    assert.strictEqual(result[0].config.model, "minimax/M3.7");
    assert.strictEqual(result[1].role, "collate");
    assert.strictEqual(result[1].config.model, "minimax/M3.7");
  });

  it("detects missing model from a different provider", async () => {
    const mockCtx: MockCtx = {
      modelRegistry: {
        find(provider: string, _model: string) {
          // Only openrouter models exist
          return provider === "openrouter"
            ? { id: "test", name: "Test" }
            : null;
        },
      },
    };

    const { validateModelConfigs } = await import("../src/tools/intelli-research.js");
    const result = validateModelConfigs(mockCtx as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext, [
      { role: "search", config: { provider: "openrouter", model: "perplexity/sonar" } },
      { role: "extract", config: { provider: "typo-provider", model: "gpt-4" } },
    ]);

    assert.strictEqual(result.length, 1, "should detect one missing");
    assert.strictEqual(result[0].role, "extract");
    assert.strictEqual(result[0].config.provider, "typo-provider");
  });

  it("returns empty when no configs provided", async () => {
    const mockCtx: MockCtx = {
      modelRegistry: { find() { return null; } },
    };

    const { validateModelConfigs } = await import("../src/tools/intelli-research.js");
    const result = validateModelConfigs(mockCtx as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext, []);

    assert.deepStrictEqual(result, [], "empty configs should yield empty result");
  });
});
