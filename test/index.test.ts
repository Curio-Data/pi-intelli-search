// test/index.test.ts — Unit tests for extension entry point
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("extension module structure", () => {
  it("exports a default function", async () => {
    const mod = await import("../src/index.js");
    assert.strictEqual(typeof mod.default, "function");
  });
});

describe("registerProvider integration", () => {
  it("calls registerProvider with perplexity models", async () => {
    const recordedProviders: Array<{ name: string; config: any }> = [];

    const mockPi = {
      registerTool() {},
      registerProvider(name: string, config: any) {
        recordedProviders.push({ name, config });
      },
      on() {},
    };

    const mod = await import("../src/index.js");
    mod.default(mockPi);

    assert.strictEqual(recordedProviders.length, 1);
    assert.strictEqual(recordedProviders[0].name, "openrouter");

    const models = recordedProviders[0].config.models;
    assert.ok(Array.isArray(models));
    assert.strictEqual(models.length, 2);

    const ids = models.map((m: any) => m.id);
    assert.ok(ids.includes("perplexity/sonar"));
    assert.ok(ids.includes("perplexity/sonar-pro"));

    // Verify model structure
    for (const model of models) {
      assert.ok(model.id, "model has id");
      assert.ok(model.name, "model has name");
      assert.strictEqual(typeof model.reasoning, "boolean", "model has reasoning flag");
      assert.ok(Array.isArray(model.input), "model has input array");
      assert.ok(model.cost, "model has cost");
      assert.ok(model.contextWindow, "model has contextWindow");
      assert.ok(model.maxTokens, "model has maxTokens");
    }
  });

  it("subscribes to session_start for settings invalidation", async () => {
    const recordedEvents: string[] = [];

    const mockPi = {
      registerTool() {},
      registerProvider() {},
      on(event: string) {
        recordedEvents.push(event);
      },
    };

    const mod = await import("../src/index.js");
    mod.default(mockPi);

    assert.ok(recordedEvents.includes("session_start"), "should subscribe to session_start");
  });

  it("registers all 4 tools", async () => {
    const recordedTools: string[] = [];

    const mockPi = {
      registerTool(tool: any) {
        recordedTools.push(tool.name);
      },
      registerProvider() {},
      on() {},
    };

    const mod = await import("../src/index.js");
    mod.default(mockPi);

    assert.deepStrictEqual(recordedTools.sort(), [
      "web_collate",
      "web_extract",
      "web_research",
      "web_search",
    ]);
  });
});
