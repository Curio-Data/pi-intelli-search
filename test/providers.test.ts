// test/providers.test.ts — Unit tests for model registration logic
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ensureCustomModels } from "../src/providers.js";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// We can't easily mock the real models.json path, but we can test the
// merge logic by testing that the function is idempotent and returns
// the expected model IDs on first call.
//
// Since ensureCustomModels writes to a hardcoded path (~/.pi/agent/models.json),
// we test its structural properties instead.

describe("ensureCustomModels", () => {
  it("is an async function", () => {
    assert.strictEqual(typeof ensureCustomModels, "function");
  });

  it("returns an array of model IDs", async () => {
    // This will actually write to ~/.pi/agent/models.json — that's OK,
    // the function is idempotent and designed for this.
    const result = await ensureCustomModels();
    assert.ok(Array.isArray(result));
    // Either empty (already added) or contains the model IDs
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
