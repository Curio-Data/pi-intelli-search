// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Batch research, independent mode (docs/proposals/BATCH-RESEARCH.md Phase 2).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { basename, join, resolve } from "node:path";
import { research } from "../src/core/index.js";
import {
  ResearchArgumentError,
  validateResearchParams,
} from "../src/core/operations/batch-research.js";
import type { ResearchDependencies } from "../src/core/operations/research.js";
import { makeBatchCachePath, makeCachePath } from "../src/core/cache.js";
import type {
  ModelRequest,
  OperationContext,
  OperationProgress,
  ResearchParams,
} from "../src/core/contracts.js";
import { coreContext } from "./helpers/core-context.js";

async function workspace(t: { after(fn: () => Promise<void>): void }) {
  const root = resolve(".tmp");
  await mkdir(root, { recursive: true });
  const path = await mkdtemp(join(root, "batch-research-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

const exists = (path: string) => stat(path).then(() => true, () => false);

describe("validateResearchParams", () => {
  const settings = { maxBatchEntries: 3 };
  const invalid = (params: ResearchParams, pattern: RegExp) =>
    assert.throws(() => validateResearchParams(params, settings), (error: unknown) => {
      assert.ok(error instanceof ResearchArgumentError);
      assert.match(error.message, pattern);
      return true;
    });

  it("passes a single query through unchanged", () => {
    assert.deepEqual(
      validateResearchParams({ query: "one", maxUrls: 3, focusPrompt: "f" }, settings),
      { kind: "single", query: { query: "one", maxUrls: 3, focusPrompt: "f" } },
    );
  });

  it("requires exactly one of query and queries", () => {
    invalid({}, /query is required/);
    invalid(
      { query: "a", queries: [{ query: "b" }, { query: "c" }], batchMode: "independent" },
      /not both/,
    );
  });

  it("requires batchMode with queries and only with queries", () => {
    invalid({ queries: [{ query: "a" }, { query: "b" }] }, /batchMode is required/);
    invalid({ query: "a", batchMode: "independent" }, /only with queries/);
    invalid(
      { queries: [{ query: "a" }, { query: "b" }], batchMode: "parallel" as never },
      /must be "independent" or "expansion"/,
    );
  });

  it("rejects expansion until the merged report exists", () => {
    invalid({ queries: [{ query: "a" }, { query: "b" }], batchMode: "expansion" }, /not available yet/);
  });

  it("bounds the entry count by settings", () => {
    invalid({ queries: [{ query: "a" }], batchMode: "independent" }, /at least two/);
    invalid(
      { queries: ["a", "b", "c", "d"].map((query) => ({ query })), batchMode: "independent" },
      /4 entries; settings.maxBatchEntries allows at most 3/,
    );
  });

  it("rejects empty, repeated and invalid entries", () => {
    invalid({ queries: [{ query: "a" }, { query: "  " }], batchMode: "independent" }, /queries\[1\]\.query must not be empty/);
    invalid({ queries: [{ query: "a" }, { query: " a " }], batchMode: "independent" }, /repeats an earlier entry/);
    invalid(
      { queries: [{ query: "a" }, { query: "b", maxUrls: 2.5 }], batchMode: "independent" },
      /queries\[1\]\.maxUrls must be a positive integer/,
    );
    invalid(
      { queries: [{ query: "a" }, { query: "b" }], batchMode: "independent", maxUrls: 0 },
      /queries\[0\]\.maxUrls/,
    );
  });

  it("applies top-level defaults to entries that do not set their own", () => {
    const validated = validateResearchParams(
      {
        queries: [{ query: "a" }, { query: "b", maxUrls: 5, focusPrompt: "own", domains: ["b.example"] }],
        batchMode: "independent",
        maxUrls: 2,
        focusPrompt: "shared",
        domains: ["docs.example"],
      },
      settings,
    );
    assert.deepEqual(validated, {
      kind: "batch",
      mode: "independent",
      entries: [
        { query: "a", focusPrompt: "shared", maxUrls: 2, domains: ["docs.example"] },
        { query: "b", focusPrompt: "own", maxUrls: 5, domains: ["b.example"] },
      ],
    });
  });

  it("rejects a bad batch before any model call", async (t) => {
    const root = await workspace(t);
    const { context, requests, dependencies } = coreContext(root);
    let preflights = 0;
    context.models.preflight = async () => {
      preflights++;
      return [];
    };
    await assert.rejects(
      research({ queries: [{ query: "a" }, { query: "a" }], batchMode: "independent" }, context, dependencies),
      ResearchArgumentError,
    );
    assert.equal(preflights, 0);
    assert.equal(requests.length, 0);
  });
});

/**
 * A fixture whose search returns three pages per entry, tagged by the query's
 * first word, and which tracks in-flight search and extraction calls.
 */
function batchFixture(root: string, overrides: Parameters<typeof coreContext>[1] = {}) {
  const base = coreContext(root, { defaultUrls: 3, maxUrls: 3, ...overrides });
  const stats = { searchActive: 0, searchPeak: 0, extractActive: 0, extractPeak: 0, preflights: 0 };
  const judged: ModelRequest[] = [];
  const extractions: ModelRequest[] = [];
  const progress: OperationProgress[] = [];
  const pause = () => new Promise((r) => setTimeout(r, 5));
  const models: OperationContext["models"] = {
    preflight: async () => {
      stats.preflights++;
      return [];
    },
    complete: async (request) => {
      if (request.userMessage.startsWith("Current query:")) {
        judged.push(request);
        return { text: "[]", citations: [] };
      }
      if (request.model.model === "search") {
        stats.searchActive++;
        stats.searchPeak = Math.max(stats.searchPeak, stats.searchActive);
        await pause();
        stats.searchActive--;
        const tag = request.userMessage.match(/\b(alpha|beta|gamma|delta|earlier)\b/)?.[1] ?? "x";
        if (/nolinks/.test(request.userMessage)) return { text: "No links.", citations: [] };
        return {
          text: [1, 2, 3].map((n) => `[P${n}](https://${tag}${n}.example/page)`).join(" "),
          citations: [],
        };
      }
      if (request.model.model === "extract") {
        extractions.push(request);
        stats.extractActive++;
        stats.extractPeak = Math.max(stats.extractPeak, stats.extractActive);
        await pause();
        stats.extractActive--;
        return { text: "official docs, current\nExtracted.", citations: [] };
      }
      return { text: "Summary.", citations: [] };
    },
  };
  const context: OperationContext = {
    ...base.context,
    models,
    onProgress: (event) => {
      progress.push(event);
    },
  };
  return { ...base, context, stats, judged, extractions, progress };
}

describe("independent batch research", () => {
  it("runs each entry in its own folder and returns one section per query", async (t) => {
    const root = await workspace(t);
    // An earlier search gives the batch's single judge call a candidate.
    const earlier = coreContext(root);
    await research({ query: "earlier topic" }, earlier.context, earlier.dependencies);
    const f = batchFixture(root, { batchConcurrency: 2, batchExtractionConcurrency: 2 });
    const queries = ["alpha topic", "beta topic", "gamma nolinks topic"];
    const result = await research(
      { queries: queries.map((query) => ({ query })), batchMode: "independent", focusPrompt: "shared" },
      f.context,
      f.dependencies,
    );

    // One preflight for the batch; the cap holds for entries and extractions.
    assert.equal(f.stats.preflights, 1);
    assert.equal(f.stats.searchPeak, 2, "batchConcurrency bounds the entries running at once");
    assert.equal(f.stats.extractPeak, 2, "the batch-wide pool bounds extraction calls");

    // Sections in caller order; the degraded entry is its own section.
    assert.equal(result.outcome, "completed");
    assert.match(result.text, /^Batch research, independent mode: 3 queries, 2 completed, 1 did not/);
    const sections = [...result.text.matchAll(/^# Query (\d) of 3: (.+)$/gm)].map((m) => m[2]);
    assert.deepEqual(sections, queries);
    assert.match(result.text, /Search returned no links for query: "gamma nolinks topic"/);
    const batch = result.details.batch as {
      id: string;
      outcome: string;
      cachePath: string;
      entries: Array<{ position: number; outcome: string; details?: { cachePath?: string } }>;
    };
    assert.equal(batch.outcome, "partial");
    assert.deepEqual(batch.entries.map((e) => e.outcome), ["completed", "completed", "no-links"]);

    // Every entry's extraction prompts carried the shared focusPrompt.
    assert.equal(f.extractions.length, 6);
    assert.ok(f.extractions.every((r) => r.userMessage.includes("Focus: shared")));
    // Cache suggestion ran once, over the joined queries, excluding the members.
    assert.equal(f.judged.length, 1);
    assert.match(f.judged[0].userMessage, /Current query: "alpha topic; beta topic; gamma nolinks topic"/);
    assert.match(f.judged[0].userMessage, /earlier topic/);
    for (const query of queries)
      assert.ok(!f.judged[0].userMessage.includes(`"${query}" (slug`), `${query} is a member, not a candidate`);

    // The batch folder holds the manifest and the batch record.
    const batchPath = join(root, batch.cachePath);
    assert.equal(
      basename(batchPath),
      basename(makeBatchCachePath("independent", queries, root, f.context.paths.cacheRoot)),
    );
    assert.match(basename(batchPath), /^\d{4}-\d\d-\d\d-batch-alpha-topic-[0-9a-f]{6}$/);
    const manifest = JSON.parse(await readFile(join(batchPath, "manifest.json"), "utf8"));
    assert.equal(manifest.id, batch.id);
    assert.equal(manifest.mode, "independent");
    assert.deepEqual(
      manifest.entries.map((e: { query: string; focusPrompt: string; outcome: string }) => [e.query, e.focusPrompt, e.outcome]),
      [
        ["alpha topic", "shared", "completed"],
        ["beta topic", "shared", "completed"],
        ["gamma nolinks topic", "shared", "no-links"],
      ],
    );
    assert.equal(manifest.entries[0].cachePath, batch.entries[0].details?.cachePath);
    assert.equal(manifest.entries[2].cachePath, undefined);
    const record = JSON.parse(await readFile(join(batchPath, "batch-meta.json"), "utf8"));
    assert.equal(record.kind, "batch");
    assert.equal(record.schemaVersion, 1);
    assert.equal(record.outcome, "partial");
    assert.equal(record.size, 3);
    assert.equal(record.concurrency, 2);
    assert.equal(record.extractionPool, 2);
    assert.equal(record.packageName, f.context.identity.name);
    assert.deepEqual(record.entries.map((e: { outcome: string }) => e.outcome), ["completed", "completed", "no-links"]);
    assert.equal(record.cacheSuggest.ran, true);
    // The batch folder has no report and no index entry in independent mode.
    assert.equal(await exists(join(batchPath, "report.md")), false);
    const index = JSON.parse(await readFile(join(f.context.paths.cacheRoot, ".index.json"), "utf8"));
    assert.ok(!index.searches.some((e: { slug: string }) => e.slug === basename(batchPath)));

    // Each entry's sidecar names its batch and lists its fetched pages.
    const meta = JSON.parse(await readFile(join(root, batch.entries[1].details!.cachePath!, "meta.json"), "utf8"));
    assert.deepEqual(meta.batch, { id: batch.id, mode: "independent", size: 3, position: 2 });
    assert.deepEqual(meta.stages.fetch.urls, [1, 2, 3].map((n) => `https://beta${n}.example/page`));
    assert.equal(meta.stages.cacheSuggest.ran, false);

    // Progress names the entry it came from.
    assert.ok(f.progress.some((p) => p.message.startsWith("[3/3] ")));
    assert.ok(f.progress.some((p) => p.message === "3 of 3 queries finished"));
  });

  it("rotates the batch folder when the same batch repeats on one date", async (t) => {
    const root = await workspace(t);
    const params: ResearchParams = {
      queries: [{ query: "alpha topic" }, { query: "beta topic" }],
      batchMode: "independent",
    };
    const first = batchFixture(root);
    const one = await research(params, first.context, first.dependencies);
    const second = batchFixture(root);
    const two = await research(params, second.context, second.dependencies);
    const path = join(root, (two.details.batch as { cachePath: string }).cachePath);
    assert.equal(path, join(root, (one.details.batch as { cachePath: string }).cachePath));
    const archived = JSON.parse(await readFile(`${path}.1/manifest.json`, "utf8"));
    const current = JSON.parse(await readFile(join(path, "manifest.json"), "utf8"));
    assert.equal(archived.id, (one.details.batch as { id: string }).id);
    assert.equal(current.id, (two.details.batch as { id: string }).id);
    // Each member's own folder rotated by the single-query rule, and the
    // manifest records the live folder the second batch wrote.
    const member = makeCachePath("alpha topic", root, first.context.paths.cacheRoot);
    assert.ok(await exists(`${member}.1/report.md`));
    assert.equal(join(root, current.entries[0].cachePath), member);
  });

  it("writes the manifest but no batch record when telemetry is disabled", async (t) => {
    const root = await workspace(t);
    const f = batchFixture(root, { disableTelemetry: true });
    const result = await research(
      { queries: [{ query: "alpha topic" }, { query: "beta topic" }], batchMode: "independent" },
      f.context,
      f.dependencies,
    );
    const path = join(root, (result.details.batch as { cachePath: string }).cachePath);
    assert.deepEqual((await readdir(path)).filter((n) => !n.startsWith(".")).sort(), ["manifest.json"]);
  });

  it("keeps a thrown entry as its own failure section", async (t) => {
    const root = await workspace(t);
    const f = batchFixture(root);
    const dependencies: ResearchDependencies = {
      ...f.dependencies,
      fetchPages: async (urls, ...rest) => {
        if (urls.some((u) => u.includes("beta"))) throw new Error("fetch layer exploded");
        return f.dependencies.fetchPages(urls, ...rest);
      },
    };
    const result = await research(
      { queries: [{ query: "alpha topic" }, { query: "beta topic" }], batchMode: "independent" },
      f.context,
      dependencies,
    );
    assert.equal(result.outcome, "completed");
    assert.match(result.text, /# Query 2 of 2: beta topic\n\nResearch failed for this query: fetch layer exploded/);
    const batch = result.details.batch as { outcome: string; entries: Array<{ outcome: string; error?: string }> };
    assert.equal(batch.outcome, "partial");
    assert.deepEqual(batch.entries[1], { position: 2, query: "beta topic", outcome: "error", error: "fetch layer exploded" });
  });

  it("throws when every entry throws", async (t) => {
    const root = await workspace(t);
    const f = batchFixture(root);
    const dependencies: ResearchDependencies = {
      ...f.dependencies,
      fetchPages: async () => {
        throw new Error("offline");
      },
    };
    await assert.rejects(
      research({ queries: [{ query: "alpha topic" }, { query: "beta topic" }], batchMode: "independent" }, f.context, dependencies),
      /Every batch entry failed\. \[1\] offline \[2\] offline/,
    );
  });

  it("cancels every entry when the signal aborts", async (t) => {
    const root = await workspace(t);
    const f = batchFixture(root, { batchConcurrency: 1 });
    const controller = new AbortController();
    const models: OperationContext["models"] = {
      ...f.context.models,
      complete: async (request) => {
        if (request.model.model === "extract") controller.abort();
        return f.context.models.complete(request);
      },
    };
    await assert.rejects(
      research(
        { queries: [{ query: "alpha topic" }, { query: "beta topic" }], batchMode: "independent" },
        { ...f.context, models, signal: controller.signal },
        f.dependencies,
      ),
      { name: "AbortError" },
    );
    // The second entry never started its search.
    assert.equal(f.stats.searchPeak, 1);
    assert.equal(await exists(makeCachePath("beta topic", root, f.context.paths.cacheRoot)), false);
  });

  it("is reported by scripts/analyze-sessions.sh, with page overlap from the entries", async (t) => {
    const root = await workspace(t);
    const f = batchFixture(root);
    // Both entries share one page, so the overlap line has something to count.
    const models: OperationContext["models"] = {
      ...f.context.models,
      complete: async (request) =>
        request.model.model === "search"
          ? {
              text: `[Own](https://${request.userMessage.includes("alpha") ? "a" : "b"}.example/page) [Shared](https://shared.example/page)`,
              citations: [],
            }
          : f.context.models.complete(request),
    };
    await research(
      { queries: [{ query: "alpha topic" }, { query: "beta topic" }], batchMode: "independent" },
      { ...f.context, models },
      f.dependencies,
    );
    const sessions = join(root, "sessions");
    await mkdir(sessions, { recursive: true });
    const run = spawnSync("bash", [resolve("scripts/analyze-sessions.sh"), sessions], {
      cwd: root,
      env: { ...process.env, SEARCH_ROOTS: root, TMPDIR: root },
      encoding: "utf8",
      timeout: 30000,
    });
    assert.equal(run.status, 0, run.stderr + run.stdout);
    const section = run.stdout.slice(run.stdout.indexOf("## 10. Batch research"));
    assert.match(section, /batch records: 1/);
    assert.match(section, /independent: 1/);
    assert.match(section, /completed: 1/);
    assert.match(section, /^ {2}2: 1$/m);
    assert.match(section, /completed: 2/);
    assert.match(section, /1 URL\(s\) fetched by two or more entries; 4 page fetches in all/);
  });
});
