// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// test/config-recipes.test.ts: README Configuration Recipes, checked deterministically
//
// Each recipe's settings block is read from README.md itself, so a recipe that
// drifts from the loader (a misspelt key, an out-of-range value, a missing
// required model key) fails here. The effective settings are then checked key
// by key, and the recipes whose value lies in pipeline behaviour (page caps,
// extract input cap) are run through the shared engine with fixture models.
// Live provider coverage of the highest-risk recipes is in
// test/e2e/10_config_recipes.sh.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { invalidateSettingsCache, loadSettings, takeSettingsWarnings } from "../src/settings.js";
import { research } from "../src/core/index.js";
import type { ResearchSettings } from "../src/core/types.js";
import { coreContext } from "./helpers/core-context.js";

const README = readFileSync(resolve("README.md"), "utf-8");

/** Recipe number -> its first jsonc block (undefined for a recipe with none). */
function readRecipes(): Map<number, Record<string, unknown> | undefined> {
  const recipes = new Map<number, Record<string, unknown> | undefined>();
  const sections = README.split(/^### Recipe (\d+): .*$/m);
  for (let i = 1; i < sections.length; i += 2) {
    const body = sections[i + 1].split(/^##? /m)[0];
    const block = body.match(/^```jsonc\n([\s\S]*?)^```$/m);
    recipes.set(Number(sections[i]), block ? JSON.parse(block[1]) : undefined);
  }
  return recipes;
}

const RECIPES = readRecipes();

function namespace(recipe: Record<string, unknown> | undefined): Record<string, unknown> {
  return (recipe?.["pi-intelli-search"] ?? {}) as Record<string, unknown>;
}

/** Load effective settings from an isolated agent dir (and optional project dir). */
async function effective(options: {
  global?: unknown;
  project?: unknown;
  trusted?: boolean;
}): Promise<ResearchSettings> {
  const root = mkdtempSync(join(tmpdir(), "pi-intelli-recipes-"));
  const agent = join(root, "agent");
  const cwd = join(root, "cwd");
  mkdirSync(agent, { recursive: true });
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  if (options.global !== undefined) writeFileSync(join(agent, "settings.json"), JSON.stringify(options.global));
  if (options.project !== undefined) {
    writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify(options.project));
  }
  const saved = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agent;
  try {
    invalidateSettingsCache();
    takeSettingsWarnings();
    return await loadSettings({ cwd, projectTrusted: options.trusted ?? false });
  } finally {
    if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = saved;
    invalidateSettingsCache();
    rmSync(root, { recursive: true, force: true });
  }
}

/** Assert every recipe key took effect and every other key kept its default. */
function assertApplied(
  label: string,
  actual: ResearchSettings,
  defaults: ResearchSettings,
  keys: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(keys)) {
    assert.deepEqual((actual as unknown as Record<string, unknown>)[key], value, `${label}: ${key} applied`);
  }
  for (const key of Object.keys(defaults) as Array<keyof ResearchSettings>) {
    if (key in keys) continue;
    assert.deepEqual(actual[key], defaults[key], `${label}: ${key} keeps its default`);
  }
  assert.deepEqual(takeSettingsWarnings(), [], `${label}: no settings warning`);
}

describe("README Configuration Recipes: settings resolution", () => {
  it("finds all ten recipes, with a settings block for every recipe except Zero Configuration", () => {
    assert.deepEqual([...RECIPES.keys()], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(RECIPES.get(1), undefined);
    for (let n = 2; n <= 10; n++) {
      assert.ok(Object.keys(namespace(RECIPES.get(n))).length > 0, `recipe ${n} has keys`);
      assert.deepEqual(Object.keys(RECIPES.get(n) ?? {}), ["pi-intelli-search"], `recipe ${n} uses the nested namespace only`);
    }
  });

  it("applies each global recipe exactly, leaving unspecified keys at their defaults", async () => {
    const defaults = await effective({});
    for (const n of [2, 3, 4, 5, 6, 7, 9, 10]) {
      const recipe = RECIPES.get(n);
      assertApplied(`recipe ${n}`, await effective({ global: recipe }), defaults, namespace(recipe));
    }
  });

  it("applies the per-project override only in a trusted project, over a global file", async () => {
    const recipe = RECIPES.get(8);
    const global = { "pi-intelli-search": { maxUrls: 7 } };
    const defaults = await effective({});
    const globalOnly = await effective({ global });
    const untrusted = await effective({ global, project: recipe, trusted: false });
    const trusted = await effective({ global, project: recipe, trusted: true });
    assert.deepEqual(untrusted, globalOnly, "untrusted project settings are ignored");
    assertApplied("recipe 8 trusted", trusted, { ...defaults, maxUrls: 7 }, namespace(recipe));
  });
});

describe("README Configuration Recipes: pipeline effect", () => {
  async function workspace(t: { after(fn: () => Promise<void>): void }) {
    const root = resolve(".tmp");
    await mkdir(root, { recursive: true });
    const path = await mkdtemp(join(root, "config-recipes-"));
    t.after(() => rm(path, { recursive: true, force: true }));
    return path;
  }

  /**
   * Engine context carrying a recipe's effective settings as the loader
   * resolves them. Fixture models replace the configured ones, documentation
   * discovery stays off and the request throttle is disabled: neither is the
   * behaviour under test, and the settings tests above prove they apply.
   */
  async function recipeContext(root: string, n: number) {
    const {
      searchModel: _search,
      extractModel: _extract,
      collateModel: _collate,
      ...settings
    } = await effective({ global: RECIPES.get(n) });
    const base = coreContext(root, {
      ...settings,
      disableLlmsFullDiscovery: true,
      minRequestIntervalMs: 0,
    });
    const links = Array.from({ length: 30 }, (_, i) => `[Page ${i}](https://site${i}.example/page)`).join(" ");
    const complete = base.context.models.complete;
    base.context.models.complete = async (request) =>
      request.model.model === "search" ? { text: `Answer. ${links}`, citations: [] } : complete(request);
    const fetched: string[][] = [];
    const fetchPages = base.dependencies.fetchPages;
    base.dependencies.fetchPages = async (urls, ...rest) => {
      fetched.push(urls);
      return fetchPages(urls, ...rest);
    };
    return { ...base, fetched };
  }

  for (const [n, defaultUrls, maxUrls] of [
    [4, 8, 16],
    [7, 5, 20],
  ] as const) {
    it(`recipe ${n} fetches ${defaultUrls} pages by default and clamps a larger request to ${maxUrls}`, async (t) => {
      const root = await workspace(t);
      const byDefault = await recipeContext(root, n);
      await research({ query: `recipe ${n} default` }, byDefault.context, byDefault.dependencies);
      assert.equal(byDefault.fetched[0].length, defaultUrls);
      const clamped = await recipeContext(root, n);
      await research({ query: `recipe ${n} clamp`, maxUrls: 50 }, clamped.context, clamped.dependencies);
      assert.equal(clamped.fetched[0].length, maxUrls);
    });
  }

  it("recipe 10 cuts each page at 150,000 characters before extraction", async (t) => {
    const root = await workspace(t);
    const ctx = await recipeContext(root, 10);
    const marker = "AFTER-THE-CAP";
    ctx.dependencies.fetchPages = async (urls) =>
      urls.map((url) => ({
        url,
        title: url,
        content: `${"a".repeat(150_000)}${marker}`,
        status: "success" as const,
        source: "markdown" as const,
      }));
    await research({ query: "recipe 10 cap", maxUrls: 1 }, ctx.context, ctx.dependencies);
    const extracts = ctx.requests.filter((request) => request.model.model === "extract");
    assert.ok(extracts.length > 0, "an extraction ran");
    for (const request of extracts) {
      assert.doesNotMatch(request.userMessage, new RegExp(marker), "text past the cap never reaches the model");
      assert.match(request.userMessage, /a{1000}/, "the page itself was sent");
    }
  });
});
