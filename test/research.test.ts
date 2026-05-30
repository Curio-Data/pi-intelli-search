// test/research.test.ts — Unit tests for intelli_research tool
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Text } from "@earendil-works/pi-tui";

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

// ── progressUpdate tests ──

describe("progressUpdate", () => {
  // Build a minimal mock theme. renderProgressBar won't reset styles
  // between lines, but for content checks we strip ANSI before asserting.
  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

  const theme = {
    fg(_color: string, text: string) { return text; },
    bold(text: string) { return text; },
  };

  it("returns correct stage index for each of the 5 stages", async () => {
    const { progressUpdate } = await import("../src/tools/intelli-research.js");
    const stages = ["search", "fetch", "extract", "collate", "cache"];
    for (let i = 0; i < stages.length; i++) {
      const update = progressUpdate(stages[i], `Working on ${stages[i]}...`);
      assert.strictEqual(update.details.stageIdx, i, `stageIdx for ${stages[i]} should be ${i}`);
      assert.strictEqual(update.details.totalStages, 5);
    }
  });

  it("LLM content text includes Stage X/5 prefix", async () => {
    const { progressUpdate } = await import("../src/tools/intelli-research.js");
    const update = progressUpdate("extract", "Page 3/8: example.com...");
    const text = update.content[0].text;
    assert.ok(text.includes("Stage 3/5"), `Expected 'Stage 3/5' in: ${text}`);
    assert.ok(text.includes("Page 3/8"), `Expected message in: ${text}`);
  });

  it("message is passed through verbatim with no hardcoded model names", async () => {
    const { progressUpdate } = await import("../src/tools/intelli-research.js");
    // Simulate what the execute() call site does: pass a provider/model string
    const message = "Querying openrouter/perplexity/sonar...";
    const update = progressUpdate("search", message);
    const text = update.content[0].text;
    assert.ok(text.includes(message), `Expected message verbatim in content, got: ${text}`);
    assert.strictEqual(update.details.message, message, "details.message must match verbatim");
    // Regression guard: the message must not contain a different hardcoded model name
    assert.ok(!text.includes("Perplexity Sonar"), "must not hardcode 'Perplexity Sonar'");
  });

  it("calculates correct percentage for each stage", async () => {
    const { progressUpdate } = await import("../src/tools/intelli-research.js");
    const expected = { search: 20, fetch: 40, extract: 60, collate: 80, cache: 100 };
    for (const [stage, pct] of Object.entries(expected)) {
      const update = progressUpdate(stage as any, "test");
      assert.strictEqual(update.details.pct, pct, `${stage} should be ${pct}%`);
    }
  });

  it("includes subProgress when provided", async () => {
    const { progressUpdate } = await import("../src/tools/intelli-research.js");
    const update = progressUpdate("extract", "Page 4/8", { current: 4, total: 8 });
    assert.deepStrictEqual(update.details.subProgress, { current: 4, total: 8 });
  });

  it("omits subProgress when not provided", async () => {
    const { progressUpdate } = await import("../src/tools/intelli-research.js");
    const update = progressUpdate("search", "Querying...");
    assert.strictEqual(update.details.subProgress, undefined);
  });

  it("details always has totalStages of 5", async () => {
    const { progressUpdate } = await import("../src/tools/intelli-research.js");
    for (const stage of ["search", "fetch", "extract", "collate", "cache"]) {
      const update = progressUpdate(stage as any, "x");
      assert.strictEqual(update.details.totalStages, 5);
    }
  });
});

// ── renderProgressBar tests ──

describe("renderProgressBar", () => {
  const theme = {
    fg(_color: string, text: string) { return text; },
    bold(text: string) { return text; },
  };

  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

  function buildDetails(stage: string, message: string, subProgress?: { current: number; total: number }) {
    const stages = ["search", "fetch", "extract", "collate", "cache"];
    const stageIdx = stages.indexOf(stage);
    return {
      stage,
      stageIdx,
      totalStages: 5,
      message,
      pct: Math.round(((stageIdx + 1) / 5) * 100),
      ...(subProgress ? { subProgress } : {}),
    };
  }

  it("returns a Text component", async () => {
    const { renderProgressBar } = await import("../src/tools/intelli-research.js");
    const details = buildDetails("search", "Querying...");
    const result = renderProgressBar(details, theme);
    assert.ok(result instanceof Text, "should return a Text component");
  });

  it("shows ✓ for completed stages, ● for current, ○ for pending", async () => {
    const { renderProgressBar } = await import("../src/tools/intelli-research.js");
    // Stage 3 (extract): search and fetch done, extract current, collate and cache pending
    const details = buildDetails("extract", "Extracting...", { current: 3, total: 8 });
    const result = renderProgressBar(details, theme);
    const lines = result.render(80);
    const output = lines.join("\n");

    assert.ok(output.includes("✓Search"), "should show ✓Search as completed");
    assert.ok(output.includes("✓Fetch"), "should show ✓Fetch as completed");
    assert.ok(output.includes("●Extract"), "should show ●Extract as current");
    assert.ok(output.includes("○Collate"), "should show ○Collate as pending");
    assert.ok(output.includes("○Cache"), "should show ○Cache as pending");
  });

  it("first stage shows no completed pills", async () => {
    const { renderProgressBar } = await import("../src/tools/intelli-research.js");
    const details = buildDetails("search", "Querying...");
    const result = renderProgressBar(details, theme);
    const lines = result.render(80);
    const output = lines.join("\n");

    assert.ok(output.includes("●Search"), "should show ●Search as current");
    assert.ok(!output.includes("✓Search"), "should not show ✓Search (nothing completed yet)");
    assert.ok(output.includes("○Fetch"), "should show ○Fetch as pending");
  });

  it("last stage shows all others completed", async () => {
    const { renderProgressBar } = await import("../src/tools/intelli-research.js");
    const details = buildDetails("cache", "Checking cache...");
    const result = renderProgressBar(details, theme);
    const lines = result.render(80);
    const output = lines.join("\n");

    assert.ok(output.includes("✓Search"), "should show ✓Search");
    assert.ok(output.includes("✓Fetch"), "should show ✓Fetch");
    assert.ok(output.includes("✓Extract"), "should show ✓Extract");
    assert.ok(output.includes("✓Collate"), "should show ✓Collate");
    assert.ok(output.includes("●Cache"), "should show ●Cache as current");
  });

  it("includes sub-progress bar when subProgress is present", async () => {
    const { renderProgressBar } = await import("../src/tools/intelli-research.js");
    const details = buildDetails("extract", "Extracting...", { current: 4, total: 8 });
    const result = renderProgressBar(details, theme);
    const lines = result.render(80);
    const output = lines.join("\n");

    assert.ok(output.includes("╰"), "should show sub-progress tree character");
    assert.ok(output.includes("4/8"), "should show current/total");
  });

  it("omits sub-progress bar when subProgress is absent", async () => {
    const { renderProgressBar } = await import("../src/tools/intelli-research.js");
    const details = buildDetails("collate", "Synthesising...");
    const result = renderProgressBar(details, theme);
    const lines = result.render(80);
    const output = lines.join("\n");

    assert.ok(!output.includes("╰"), "should not show sub-progress tree character");
  });

  it("bar uses █ and ░ characters", async () => {
    const { renderProgressBar } = await import("../src/tools/intelli-research.js");
    const details = buildDetails("fetch", "Fetching...");
    const result = renderProgressBar(details, theme);
    const lines = result.render(80);
    const output = lines.join("\n");

    assert.ok(output.includes("█"), "bar should contain filled blocks");
    assert.ok(output.includes("░"), "bar should contain empty blocks");
  });

  it("shows correct percentage in bar", async () => {
    const { renderProgressBar } = await import("../src/tools/intelli-research.js");
    const cases = [
      { stage: "search", expected: "20%" },
      { stage: "fetch", expected: "40%" },
      { stage: "extract", expected: "60%" },
      { stage: "collate", expected: "80%" },
      { stage: "cache", expected: "100%" },
    ];
    for (const { stage, expected } of cases) {
      const details = buildDetails(stage, "test");
      const result = renderProgressBar(details, theme);
      const lines = result.render(80);
      assert.ok(lines[0].includes(expected), `${stage} bar should show ${expected}, got: ${lines[0]}`);
    }
  });

  it("renders current message below the bar", async () => {
    const { renderProgressBar } = await import("../src/tools/intelli-research.js");
    const details = buildDetails("search", "Querying Perplexity Sonar...");
    const result = renderProgressBar(details, theme);
    const lines = result.render(80);
    const output = lines.join("\n");

    assert.ok(output.includes("Querying Perplexity Sonar..."), "should include the message");
  });
});
