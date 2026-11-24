// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Batch research, independent mode (docs/proposals/BATCH-RESEARCH.md Phase 2).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { basename, join, resolve } from "node:path";
import { research } from "../src/core/index.js";
import {
  ResearchArgumentError,
  validateResearchParams,
} from "../src/core/operations/batch-research.js";
import type { ResearchDependencies, ResearchSynthesis } from "../src/core/operations/research.js";
import {
  buildBatchEvidence,
  countSectionItems,
  memberSummary,
  renumberCitations,
} from "../src/core/operations/batch-merge.js";
import { SUPER_COLLATION_SYSTEM_PROMPT } from "../src/core/prompts.js";
import { SOURCE_ASSESSMENT_PREAMBLE } from "../src/core/provenance.js";
import { allocateSourceIdentity } from "../src/core/cache.js";
import type { ExtractResult } from "../src/core/types.js";
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

  it("accepts both batch modes", () => {
    for (const batchMode of ["expansion", "independent"] as const)
      assert.equal(validateResearchParams({ queries: [{ query: "a" }, { query: "b" }], batchMode }, settings).kind, "batch");
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
    const merges = [{ outcome: "completed", durationMs: 20, inputChars: 50, outputChars: 10 }, { outcome: "completed", durationMs: 0, inputChars: 30 }, { outcome: "skipped", durationMs: 0 }, undefined];
    for (const [i, merge] of merges.entries()) {
      const dir = join(f.context.paths.cacheRoot, `merge-${i}`);
      await mkdir(dir);
      await writeFile(join(dir, "batch-meta.json"), JSON.stringify({ kind: "batch", mode: "expansion", outcome: "completed", size: 2, durationMs: 20, entries: [{ durationMs: 10, outcome: "completed" }], merge }));
    }
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
    assert.match(section, /batch records: 5/);
    assert.match(section, /durationMs: n=2, mean=10; inputChars: n=2, mean=40; outputChars: n=1, mean=10/);
    assert.match(section, /skipped: 1/);
    assert.match(section, /unrecorded: 1/);
    assert.match(section, /independent: 1/);
    assert.match(section, /completed: 5/);
    assert.match(section, /^ {2}2: 5$/m);
    assert.match(section, /completed: 2/);
    assert.match(section, /1 URL\(s\) fetched by two or more entries; 4 page fetches in all/);
  });

  it("skips batch records without entries in scripts/analyze-sessions.sh", async (t) => {
    const root = await workspace(t);
    // Batch-shaped records with no per-entry data, beside one complete record.
    const records = [
      {
        dir: "2026-11-17-batch-independent-fake",
        record: { kind: "batch", mode: "independent", outcome: "completed", size: 2, durationMs: 50 },
      },
      {
        dir: "2026-11-17-batch-expansion-fake",
        record: { kind: "batch", mode: "expansion", outcome: "completed", size: 2, durationMs: 50, entries: [] },
      },
      {
        dir: "2026-11-24-batch-complete",
        record: {
          kind: "batch",
          mode: "independent",
          outcome: "completed",
          size: 2,
          durationMs: 30_000,
          concurrency: 2,
          extractionPool: 8,
          entries: [
            { position: 1, outcome: "completed", durationMs: 20_000 },
            { position: 2, outcome: "completed", durationMs: 30_000 },
          ],
        },
      },
    ];
    for (const { dir, record } of records) {
      await mkdir(join(root, ".search", dir), { recursive: true });
      await writeFile(join(root, ".search", dir, "batch-meta.json"), JSON.stringify(record));
    }
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
    assert.match(section, /excluded batch records without entries: 2/);
    assert.match(section, /30s total, slowest entry 30s, 2 at once, pool 8/);
    assert.doesNotMatch(section, /Cannot iterate over null/);
    assert.doesNotMatch(section, /jq: error/);
  });
});

describe("batch merge evidence", () => {
  it("rewrites only citation groups, expanding ranges", () => {
    const map = new Map([[1, 4], [2, 2], [3, 9]]);
    assert.equal(
      renumberCitations("A [S1] B [S1, S2] C [S1–S3] D [S3](https://x.example) Amazon S3 [note] [S7]", map, ["", "", "https://x.example"]),
      "A [S4] B [S2, S4] C [S2, S4, S9] D [S9](https://x.example) Amazon S3 [note] [S7]",
    );
  });

  it("preserves code, escaped brackets and non-citation link labels", () => {
    const map = new Map([[1, 4], [2, 8]]);
    const literal = "`[S1]` and ``a ` tick [S2]``\n\n~~~\n[S1]\n~~~\n\n    [S1]\n\n\\[S1] [S1](https://other.example) ![S2](img)";
    assert.equal(renumberCitations(`${literal} [S1–S2]`, map), `${literal} [S4, S8]`);
    assert.equal(renumberCitations("[S1-S500] [S2-S1]", map), "[S1-S500] [S4, S8]");
  });

  it("keeps a link label's own page first so the label still names its target", () => {
    const map = new Map([[1, 4], [2, 2]]);
    assert.equal(
      renumberCitations("[S1, S2](https://one.example)", map, ["https://one.example", "https://two.example"]),
      "[S4, S2](https://one.example)",
    );
  });

  it("preserves code inside a block quote, renumbering the prose after it", () => {
    const map = new Map([[1, 4]]);
    const quoted = "> ~~~\n> [S1]\n> ~~~";
    assert.equal(renumberCitations(`${quoted}\n\nActual [S1]`, map), `${quoted}\n\nActual [S4]`);
    assert.equal(renumberCitations("> ```\n> [S1]\n\nOutside [S1]", map), "> ```\n> [S1]\n\nOutside [S4]");
  });

  it("takes the summary between its heading and the generated inventory", () => {
    assert.equal(memberSummary(`## Summary\n\nBody [S1].\n\n${SOURCE_ASSESSMENT_PREAMBLE}| ID |`), "Body [S1].");
  });

  it("numbers sources across members once per URL and rewrites each summary", () => {
    const ext = (url: string, extraction = "text"): ExtractResult => ({
      url, title: "", extraction, sourceType: "docs", currentness: "", status: "success",
    });
    const synthesis = (cachePath: string, extractions: ExtractResult[], summary: string): ResearchSynthesis => ({
      collation: `## Summary\n\n${summary}\n\n${SOURCE_ASSESSMENT_PREAMBLE}| ID |`,
      extractions,
      identity: allocateSourceIdentity(extractions, extractions.map((e) => ({ url: e.url, title: "", content: "x", status: "success" }))),
      cachePath,
      physicalCachePath: cachePath,
    });
    const evidence = buildBatchEvidence([
      { position: 1, query: "q1", synthesis: synthesis(".search/a", [ext("https://a.example"), ext("https://shared.example")], "A [S1][S2].") },
      // An empty extraction takes no identifier, as in finalizeCollation().
      { position: 2, query: "q2", synthesis: synthesis(".search/b", [ext("https://empty.example", " "), ext("https://shared.example"), ext("https://b.example")], "B [S1, S2].") },
    ]);
    assert.deepEqual(evidence.sources.map((s) => [s.id, s.url, s.extractions.map((e) => e.position)]), [
      [1, "https://a.example", [1]],
      [2, "https://shared.example", [1, 2]],
      [3, "https://b.example", [2]],
    ]);
    assert.equal(evidence.sourcesBeforeDedup, 4);
    assert.deepEqual(evidence.runs.map((r) => r.summary), ["A [S1][S2].", "B [S2, S3]."]);
    assert.match(evidence.sources[1].extractions[1].extractionPath ?? "", /^\.search\/b\/extractions\//);
  });

  it("counts list items under a heading, ignoring None found", () => {
    const text = "## Findings\n- a\n## Contradictions\n- S1 says X; S2 says Y.\n- two\n\n## Gaps\n- None found.\n";
    assert.equal(countSectionItems(text, /contradiction/i), 2);
    assert.equal(countSectionItems(text, /\bgaps?\b/i), 0);
    assert.equal(countSectionItems(text, /absent/i), 0);
    const sample = "```md\n## Gaps\n- sample one\n- sample two\n```\n\n## Gaps\n\n- real gap\n";
    assert.equal(countSectionItems(sample, /\bgaps?\b/i), 1);
  });
});

describe("expansion batch research", () => {
  /** Members cite [S1][S2]; both share one page, so the merge dedupes it. */
  function expansionFixture(root: string, mergeText: (userMessage: string) => string) {
    const f = batchFixture(root);
    const merges: ModelRequest[] = [];
    const models: OperationContext["models"] = {
      ...f.context.models,
      complete: async (request) => {
        if (request.systemPrompt === SUPER_COLLATION_SYSTEM_PROMPT) {
          merges.push(request);
          return { text: mergeText(request.userMessage), citations: [] };
        }
        if (request.model.model === "search") {
          const own = request.userMessage.includes("alpha") ? "a" : request.userMessage.includes("beta") ? "b" : "c";
          if (/nolinks/.test(request.userMessage)) return { text: "No links.", citations: [] };
          return { text: `[Own](https://${own}.example/page) [Shared](https://shared.example/page)`, citations: [] };
        }
        if (request.model.model === "collate") return { text: "Finding [S1][S2].", citations: [] };
        return f.context.models.complete(request);
      },
    };
    return { ...f, context: { ...f.context, models }, merges };
  }
  const params = (queries: string[]): ResearchParams => ({
    queries: queries.map((query) => ({ query })),
    batchMode: "expansion",
  });

  it("merges the summaries into one report with a batch-wide inventory", async (t) => {
    const root = await workspace(t);
    const f = expansionFixture(
      root,
      () => "Merged finding [S1, S2] and [S3].\n\n## Contradictions\n\n- S1 says X; S3 says Y.\n\n## Gaps\n\nNone found.",
    );
    const result = await research(params(["alpha topic", "beta topic"]), f.context, f.dependencies);

    // One merge call, with the members' citations renumbered and deduplicated.
    assert.equal(f.merges.length, 1);
    const input = JSON.parse(f.merges[0].userMessage);
    assert.deepEqual(input.sources, [
      { id: "S1", url: "https://a.example/page" },
      { id: "S2", url: "https://shared.example/page" },
      { id: "S3", url: "https://b.example/page" },
    ]);
    assert.deepEqual(input.queries.map((q: { query: string; summary: string }) => [q.query, q.summary]), [
      ["alpha topic", "Finding [S1][S2]."],
      ["beta topic", "Finding [S3][S2]."],
    ]);

    assert.equal(result.outcome, "completed");
    assert.match(result.text, /^Batch research, expansion mode: 2 queries, 2 completed\. The merged report covers 2 of them\./);
    assert.match(result.text, /## Summary\n\nMerged finding \[S1, S2\] and \[S3\]\./);
    assert.match(result.text, /\| S2 \| https:\/\/shared\.example\/page \| official docs \| 1, 2 \| .+\/extractions\/02-shared-example\.md/);
    // A shared page lists each query's own extraction, which used that query's focus.
    assert.match(result.text, /\| S2 \|[^\n]*\| Query 1: [^|;]+\/extractions\/[^|;]+; Query 2: [^|;]+\/extractions\/[^|;]+ \|/);
    assert.match(result.text, /## Per-Query Reports\n\n1\. alpha topic: `.+\/report\.md`\n2\. beta topic: `.+\/report\.md`/);
    assert.doesNotMatch(result.text, /# Query 1 of 2/, "the per-query sections are replaced by the merged report");

    const batch = result.details.batch as { cachePath: string; merge: { outcome: string; reportPath: string } };
    assert.equal(batch.merge.outcome, "completed");
    const path = join(root, batch.cachePath);
    const report = await readFile(join(path, "report.md"), "utf8");
    assert.match(report, /^# Merged research: 2 queries\n/);
    assert.match(report, /Merged finding/);
    const index = JSON.parse(await readFile(join(f.context.paths.cacheRoot, ".index.json"), "utf8"));
    assert.ok(index.searches.some((e: { slug: string; query: string }) =>
      e.slug === basename(path) && e.query === "Batch: alpha topic; beta topic"));
    const record = JSON.parse(await readFile(join(path, "batch-meta.json"), "utf8"));
    assert.equal(record.merge.outcome, "completed");
    assert.equal(record.merge.entries, 2);
    assert.equal(record.merge.sources, 3);
    assert.equal(record.merge.sourcesBeforeDedup, 4);
    assert.equal(record.merge.contradictions, 1);
    assert.equal(record.merge.gaps, 0);
    assert.ok(record.merge.inputChars > SUPER_COLLATION_SYSTEM_PROMPT.length);
  });

  it("shows capped summaries and saved failure reports in a partial merge", async (t) => {
    const root = await workspace(t);
    const f = expansionFixture(root, () => "Merged finding [S1].");
    const complete = f.context.models.complete;
    const context = { ...f.context, settings: { ...f.context.settings, outputBudgetRetries: 0 } };
    f.context.models.complete = async (request) => {
      if (request.model.model === "collate" && request.userMessage.includes("gamma topic") && request.systemPrompt !== SUPER_COLLATION_SYSTEM_PROMPT) throw new Error("collation unavailable");
      const result = await complete(request);
      return request.model.model === "collate" ? { ...result, finishReason: "length" } : result;
    };
    const result = await research(params(["alpha topic", "beta topic", "gamma topic"]), context, f.dependencies);
    assert.match(result.text, /merged report reached its output cap/i);
    assert.match(result.text, /alpha topic: `[^`]+` \(summary reached its output cap\)/);
    assert.ok(JSON.parse(f.merges[0].userMessage).queries.every((q: { summaryTruncated?: boolean }) => q.summaryTruncated === true));
    const path = result.text.match(/gamma topic: not merged, collate-failed \(failure report: `([^`]+)`\)/)?.[1];
    assert.ok(path && await exists(join(root, path)));
    assert.doesNotMatch(result.text, /each query's own report is complete/);
  });

  it("falls back to per-query sections when every merge candidate is rejected", async (t) => {
    const root = await workspace(t);
    const f = expansionFixture(root, () => "Merged [S9].");
    const result = await research(params(["alpha topic", "beta topic"]), f.context, f.dependencies);
    assert.equal(result.outcome, "completed");
    assert.match(result.text, /> ⚠ No merged report: the merge failed \(Collation provenance validation failed: unknown or omitted source ID/);
    assert.match(result.text, /rejected-synthesis\.json/);
    assert.match(result.text, /# Query 1 of 2: alpha topic/);
    const batch = result.details.batch as { cachePath: string; merge: { outcome: string } };
    assert.equal(batch.merge.outcome, "rejected");
    const path = join(root, batch.cachePath);
    assert.equal(await exists(join(path, "report.md")), false);
    const rejected = JSON.parse(await readFile(join(path, "rejected-synthesis.json"), "utf8"));
    assert.equal(rejected.accepted, false);
    assert.equal(rejected.candidates[0].text, "Merged [S9].");
    const record = JSON.parse(await readFile(join(path, "batch-meta.json"), "utf8"));
    assert.equal(record.merge.outcome, "rejected");
    const index = JSON.parse(await readFile(join(f.context.paths.cacheRoot, ".index.json"), "utf8"));
    assert.ok(!index.searches.some((e: { slug: string }) => e.slug === basename(path)));
  });

  it("rejects a merged prose URL that no extraction supplied", async (t) => {
    const root = await workspace(t);
    const f = expansionFixture(root, () => "See https://invented.example/page [S1].");
    const result = await research(params(["alpha topic", "beta topic"]), f.context, f.dependencies);
    assert.match(result.text, /a prose URL is absent from the supplied evidence/);
  });

  it("skips the merge, before any call, when its input exceeds the collation input budget", async (t) => {
    const root = await workspace(t);
    const f = expansionFixture(root, () => "unused");
    // Large enough for each member's own collation, too small for the merge prompt.
    const budget = 400;
    assert.ok(SUPER_COLLATION_SYSTEM_PROMPT.length / 4 > budget);
    const context = { ...f.context, settings: { ...f.context.settings, collationInputBudgetTokens: budget } };
    const result = await research(params(["alpha topic", "beta topic"]), context, f.dependencies);
    assert.equal(f.merges.length, 0);
    assert.match(result.text, /No merged report: the merge was skipped \(the merge input \(≈\d+ tokens\) exceeds collationInputBudgetTokens \(400\)/);
    assert.match(result.text, /# Query 2 of 2: beta topic/);
    const batch = result.details.batch as { merge: { outcome: string } };
    assert.equal(batch.merge.outcome, "skipped");
  });

  it("reports a non-decreasing batch percentage while entries interleave", async (t) => {
    const root = await workspace(t);
    const f = expansionFixture(root, () => "Merged finding [S1].");
    const seen: number[] = [];
    const context = { ...f.context, onProgress: (event: OperationProgress) => seen.push(event.pct) };
    await research(params(["alpha topic", "beta topic", "gamma topic"]), context, f.dependencies);
    assert.ok(seen.length > 3);
    assert.ok(seen.every((pct, i) => i === 0 || pct >= seen[i - 1]), `percentages went back: ${seen.join(",")}`);
    assert.ok(seen.at(-1)! >= 90);
  });

  it("skips the merge when fewer than two queries complete", async (t) => {
    const root = await workspace(t);
    const f = expansionFixture(root, () => "unused");
    const result = await research(params(["alpha topic", "gamma nolinks topic"]), f.context, f.dependencies);
    assert.equal(f.merges.length, 0);
    assert.match(result.text, /No merged report: the merged report needs at least two completed queries, and 1 completed/);
    const batch = result.details.batch as { cachePath: string; merge: { outcome: string } };
    assert.equal(batch.merge.outcome, "skipped");
    const record = JSON.parse(await readFile(join(root, batch.cachePath, "batch-meta.json"), "utf8"));
    assert.equal(record.merge.outcome, "skipped");
  });
});
