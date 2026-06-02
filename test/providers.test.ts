// test/providers.test.ts — Unit tests for model registration logic
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ensureCustomModels, REQUIRED_MODELS } from "../src/providers.js";

describe("ensureCustomModels", () => {
  it("is an async function", () => {
    assert.strictEqual(typeof ensureCustomModels, "function");
  });

  it("returns an array of model IDs", async () => {
    const result = await ensureCustomModels();
    assert.ok(Array.isArray(result));
    for (const id of result) {
      assert.ok(typeof id === "string");
    }
  });

  it("is idempotent — second call returns empty array", async () => {
    await ensureCustomModels(); // Ensure models exist
    const result = await ensureCustomModels();
    assert.deepStrictEqual(result, []);
  });
});

describe("REQUIRED_MODELS pricing", () => {
  // Verified against https://openrouter.ai/perplexity/sonar (2026):
  // standard Sonar is $1/$1 per 1M tokens; Sonar Pro is $3/$15.
  it("prices perplexity/sonar at $1 in / $1 out per 1M tokens", () => {
    const sonar = REQUIRED_MODELS.find((m) => m.id === "perplexity/sonar");
    assert.ok(sonar, "perplexity/sonar should be defined");
    assert.strictEqual(sonar!.cost.input, 1.0);
    assert.strictEqual(sonar!.cost.output, 1.0);
  });

  it("prices perplexity/sonar-pro at $3 in / $15 out per 1M tokens", () => {
    const pro = REQUIRED_MODELS.find((m) => m.id === "perplexity/sonar-pro");
    assert.ok(pro, "perplexity/sonar-pro should be defined");
    assert.strictEqual(pro!.cost.input, 3.0);
    assert.strictEqual(pro!.cost.output, 15.0);
  });
});

describe("REQUIRED_MODELS structure", () => {
  it("models.json has the expected perplexity models after ensureCustomModels", async () => {
    await ensureCustomModels();

    const { homedir } = await import("node:os");
    const { join } = await import("node:path");
    const { readFile } = await import("node:fs/promises");

    const modelsPath = join(homedir(), ".pi", "agent", "models.json");
    const raw = await readFile(modelsPath, "utf-8");
    const config = JSON.parse(raw);

    const openrouterModels = config?.providers?.openrouter?.models ?? [];
    const ids = openrouterModels.map((m: any) => m.id);

    assert.ok(ids.includes("perplexity/sonar"), "Missing perplexity/sonar model");
    assert.ok(ids.includes("perplexity/sonar-pro"), "Missing perplexity/sonar-pro model");
  });
});
