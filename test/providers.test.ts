// test/providers.test.ts — Unit tests for model registration logic
import { describe, it, beforeEach, afterEach } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let agentDir: string;
let savedAgentDir: string | undefined;
beforeEach(async () => {
  savedAgentDir = process.env.PI_CODING_AGENT_DIR;
  agentDir = await mkdtemp(join(tmpdir(), "intelli-providers-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
});
afterEach(async () => {
  if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
  await rm(agentDir, { recursive: true, force: true });
});
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

describe("configuration preservation", () => {
  for (const contents of [
    '{"providers":{"private":{"apiKey":"SECRET"}},',
    "null",
    "[]",
    '{"providers":[]}',
    '{"providers":{"openrouter":{"models":{}}}}',
    '{"providers":{"custom":null}}',
  ]) {
    it(`preserves invalid input (${contents.length} characters)`, async () => {
      const path = join(agentDir, "models.json");
      await writeFile(path, contents);
      await assert.rejects(ensureCustomModels(), (error: Error) => {
        assert.match(error.message, /Invalid models.json/);
        assert.doesNotMatch(error.message, /SECRET/);
        return true;
      });
      assert.equal(await readFile(path, "utf8"), contents);
      assert.deepEqual(await readdir(agentDir), ["models.json"]);
    });
  }
  it("preserves unrelated providers and custom model definitions across concurrent starts", async () => {
    const path = join(agentDir, "models.json");
    const custom = { id: "perplexity/sonar", name: "My override" };
    await writeFile(
      path,
      JSON.stringify({
        extra: true,
        providers: { custom: { apiKey: "fixture" }, openrouter: { models: [custom] } },
      }),
    );
    const added = await Promise.all([ensureCustomModels(), ensureCustomModels()]);
    assert.equal(added.flat().length, 2);
    const result = JSON.parse(await readFile(path, "utf8"));
    assert.equal(result.extra, true);
    assert.deepEqual(result.providers.custom, { apiKey: "fixture" });
    assert.deepEqual(result.providers.openrouter.models[0], custom);
    assert.equal(result.providers.openrouter.models.length, 3);
    assert.deepEqual(await readdir(agentDir), ["models.json"]);
  });
  it("does not replace an unreadable directory with a file", async () => {
    await mkdir(join(agentDir, "models.json"));
    await assert.rejects(ensureCustomModels(), /Cannot read models.json/);
    assert.ok((await lstat(join(agentDir, "models.json"))).isDirectory());
  });
  it("preserves valid symlinks and rejects dangling symlinks", async () => {
    const target = join(agentDir, "target.json");
    const path = join(agentDir, "models.json");
    await symlink(target, path);
    await assert.rejects(ensureCustomModels(), /dangling symlink/);
    assert.ok((await lstat(path)).isSymbolicLink());
    await writeFile(target, "{}");
    await ensureCustomModels();
    assert.ok((await lstat(path)).isSymbolicLink());
    assert.equal(JSON.parse(await readFile(target, "utf8")).providers.openrouter.models.length, 3);
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

  it("registers perplexity/sonar-pro-search (alternative search model)", () => {
    const sps = REQUIRED_MODELS.find((m) => m.id === "perplexity/sonar-pro-search");
    assert.ok(sps, "perplexity/sonar-pro-search should be defined");
    assert.strictEqual(sps!.cost.input, 3.0);
    assert.strictEqual(sps!.cost.output, 15.0);
    assert.strictEqual(sps!.contextWindow, 200000);
  });
});

describe("REQUIRED_MODELS structure", () => {
  it("models.json has the expected perplexity models after ensureCustomModels", async () => {
    await ensureCustomModels();

    const modelsPath = join(agentDir, "models.json");
    const raw = await readFile(modelsPath, "utf-8");
    const config = JSON.parse(raw);

    const openrouterModels = config?.providers?.openrouter?.models ?? [];
    const ids = openrouterModels.map((m: any) => m.id);

    assert.ok(ids.includes("perplexity/sonar"), "Missing perplexity/sonar model");
    assert.ok(ids.includes("perplexity/sonar-pro"), "Missing perplexity/sonar-pro model");
  });
});
