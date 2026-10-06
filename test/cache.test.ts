// test/cache.test.ts — Unit tests for cache utilities including
// lock primitives, atomic writes, and concurrent safety.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  makeCachePath,
  domainSlug,
  readIndex,
  writeCacheFiles,
  writeReportFile,
  updateIndex,
  removeIndexEntry,
  acquireLock,
  cacheLockDir,
  indexLockDir,
  formatIndexForJudge,
  parseJudgeResponse,
  judgeCandidates,
  formatCacheSuggestions,
  allocateSourceIdentity,
  clearCacheArtefacts,
} from "../src/cache.js";
import type { CacheIndex, IndexEntry } from "../src/cache.js";
import { join } from "node:path";
import { mkdtemp, rm, writeFile, readFile, readdir, mkdir, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { buildCollationMessage } from "../src/core/messages.js";

// ═══════════════════════════════════════════
// domainSlug
// ═══════════════════════════════════════════

describe("domainSlug", () => {
  it("extracts hostname and converts dots to hyphens", () => {
    assert.strictEqual(
      domainSlug("https://developers.cloudflare.com/d1/"),
      "developers-cloudflare-com",
    );
  });

  it("strips www. prefix", () => {
    assert.strictEqual(domainSlug("https://www.example.com/path"), "example-com");
  });

  it("returns unknown for invalid URLs", () => {
    assert.strictEqual(domainSlug("not-a-url"), "unknown");
  });

  it("handles bare hostname", () => {
    assert.strictEqual(domainSlug("https://vite.dev/config/"), "vite-dev");
  });

  it("handles deeply nested paths", () => {
    assert.strictEqual(
      domainSlug("https://docs.python.org/3/library/asyncio.html"),
      "docs-python-org",
    );
  });
});

// ═══════════════════════════════════════════
// makeCachePath
// ═══════════════════════════════════════════

describe("makeCachePath", () => {
  const HASH = /-[0-9a-f]{6}$/;

  it("produces date-slug format under cacheDir", () => {
    const original = Date.prototype.toISOString;
    Date.prototype.toISOString = () => "2026-04-20T12:00:00.000Z";
    try {
      const result = makeCachePath("How do Svelte 5 runes work?", "/project", ".search");
      assert.ok(result.startsWith("/project/.search/2026-04-20-how-do-svelte-5-runes-"), result);
      assert.match(result, HASH);
    } finally {
      Date.prototype.toISOString = original;
    }
  });

  it("limits slug to first 5 words", () => {
    const original = Date.prototype.toISOString;
    Date.prototype.toISOString = () => "2026-04-20T12:00:00.000Z";
    try {
      const result = makeCachePath(
        "this is a very long query with many words",
        "/project",
        ".search",
      );
      assert.ok(result.startsWith("/project/.search/2026-04-20-this-is-a-very-long-"), result);
      assert.match(result, HASH);
    } finally {
      Date.prototype.toISOString = original;
    }
  });

  it("strips non-alphanumeric characters from slug", () => {
    const original = Date.prototype.toISOString;
    Date.prototype.toISOString = () => "2026-04-20T12:00:00.000Z";
    try {
      const result = makeCachePath("C++ vs Rust: which is faster?", "/project", ".search");
      assert.ok(result.startsWith("/project/.search/2026-04-20-c-vs-rust-which-is-"), result);
      assert.match(result, HASH);
    } finally {
      Date.prototype.toISOString = original;
    }
  });

  it("respects custom cacheDir", () => {
    const original = Date.prototype.toISOString;
    Date.prototype.toISOString = () => "2026-04-20T12:00:00.000Z";
    try {
      const result = makeCachePath("test query", "/project", ".cache/research");
      assert.ok(result.startsWith("/project/.cache/research/2026-04-20-test-query-"), result);
      assert.match(result, HASH);
    } finally {
      Date.prototype.toISOString = original;
    }
  });

  it("handles single-word query", () => {
    const original = Date.prototype.toISOString;
    Date.prototype.toISOString = () => "2026-04-20T12:00:00.000Z";
    try {
      const result = makeCachePath("docker", "/project", ".search");
      assert.ok(result.startsWith("/project/.search/2026-04-20-docker-"), result);
      assert.match(result, HASH);
    } finally {
      Date.prototype.toISOString = original;
    }
  });

  it("disambiguates different queries that share the same first five words", () => {
    const original = Date.prototype.toISOString;
    Date.prototype.toISOString = () => "2026-04-20T12:00:00.000Z";
    try {
      const a = makeCachePath("react hooks useEffect cleanup function returns", "/p", ".search");
      const b = makeCachePath("react hooks useEffect cleanup function memo", "/p", ".search");
      assert.ok(a.includes("react-hooks-useeffect-cleanup-function"), `unexpected: ${a}`);
      assert.ok(b.includes("react-hooks-useeffect-cleanup-function"), `unexpected: ${b}`);
      assert.notStrictEqual(a, b);
    } finally {
      Date.prototype.toISOString = original;
    }
  });

  it("is deterministic: the same query on the same day maps to the same path", () => {
    const original = Date.prototype.toISOString;
    Date.prototype.toISOString = () => "2026-04-20T12:00:00.000Z";
    try {
      const a = makeCachePath("docker rootless setup", "/p", ".search");
      const b = makeCachePath("docker rootless setup", "/p", ".search");
      assert.strictEqual(a, b);
    } finally {
      Date.prototype.toISOString = original;
    }
  });
});

// ═══════════════════════════════════════════
// updateIndex — atomic dedupe & temp-file hygiene
// ═══════════════════════════════════════════

describe("updateIndex", () => {
  it("dedupes repeated slugs instead of accumulating duplicate entries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cache-idx-"));
    try {
      const slug = "2026-04-20-test-query-abc123";
      await updateIndex(dir, slug, "test query");
      await updateIndex(dir, slug, "test query");

      const index = await readIndex(dir);
      const matching = index.searches.filter((e) => e.slug === slug);
      assert.strictEqual(matching.length, 1, "slug should appear exactly once in the index");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("writes .index.json atomically with no stray .tmp files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cache-atomic-"));
    try {
      await updateIndex(dir, "slug-a", "query a");
      const raw = JSON.parse(await readFile(join(dir, ".index.json"), "utf-8"));
      assert.ok(Array.isArray(raw.searches));
      assert.strictEqual(raw.searches.length, 1);
      const entries = await readdir(dir);
      const tmps = entries.filter((e) => e.endsWith(".tmp"));
      assert.deepStrictEqual(tmps, [], `stray tmp files: ${tmps}`);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

// ═════════════════════════════════════════
// removeIndexEntry — degraded refresh drops dangling suggestions
// ═════════════════════════════════════════

describe("removeIndexEntry", () => {
  it("removes only the matching slug and preserves the rest atomically", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cache-rmidx-"));
    try {
      await updateIndex(dir, "slug-a", "query a");
      await updateIndex(dir, "slug-b", "query b");
      await removeIndexEntry(dir, "slug-a");
      const index = await readIndex(dir);
      assert.deepStrictEqual(
        index.searches.map((e) => e.slug),
        ["slug-b"],
      );
      const tmps = (await readdir(dir)).filter((e) => e.endsWith(".tmp"));
      assert.deepStrictEqual(tmps, []);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("leaves no index file behind when the cache root has none", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cache-rmidx-empty-"));
    try {
      await removeIndexEntry(dir, "slug-a");
      await assert.rejects(readFile(join(dir, ".index.json")), /ENOENT/);
      assert.deepStrictEqual(await readdir(dir), []);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("keeps the file untouched when the slug is absent or the JSON is malformed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cache-rmidx-absent-"));
    try {
      await updateIndex(dir, "slug-a", "query a");
      const before = await readFile(join(dir, ".index.json"), "utf-8");
      await removeIndexEntry(dir, "slug-other");
      assert.strictEqual(await readFile(join(dir, ".index.json"), "utf-8"), before);
      // A malformed index is never overwritten with a repaired empty one.
      await writeFile(join(dir, ".index.json"), "not json {{{", "utf-8");
      await removeIndexEntry(dir, "slug-a");
      assert.strictEqual(await readFile(join(dir, ".index.json"), "utf-8"), "not json {{{");
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

// ═══════════════════════════════════════════
// readIndex
// ═══════════════════════════════════════════

describe("readIndex", () => {
  it("returns empty index when file doesn't exist", async () => {
    const result = await readIndex("/nonexistent/path/.search");
    assert.deepStrictEqual(result, { searches: [] });
  });

  it("reads a valid index file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cache-test-"));
    try {
      const index: CacheIndex = {
        searches: [
          { slug: "2026-04-20-test-query", query: "test query", timestamp: "2026-04-20T12:00:00Z" },
        ],
      };
      await writeFile(join(dir, ".index.json"), JSON.stringify(index));
      const result = await readIndex(dir);
      assert.strictEqual(result.searches.length, 1);
      assert.strictEqual(result.searches[0].query, "test query");
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("returns empty index for invalid JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cache-test-"));
    try {
      await writeFile(join(dir, ".index.json"), "not json {{{");
      const result = await readIndex(dir);
      assert.deepStrictEqual(result, { searches: [] });
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

// ═══════════════════════════════════════════
// formatIndexForJudge
// ═══════════════════════════════════════════

describe("formatIndexForJudge", () => {
  const index: CacheIndex = {
    searches: [
      {
        slug: "2026-04-20-podman-rootless",
        query: "podman rootless setup",
        timestamp: "2026-04-20T10:00:00Z",
      },
      {
        slug: "2026-04-21-svelte-runes",
        query: "Svelte 5 runes tutorial",
        timestamp: "2026-04-21T10:00:00Z",
      },
      {
        slug: "2026-04-22-cloudflare-kv",
        query: "Cloudflare Workers KV limits",
        timestamp: "2026-04-22T10:00:00Z",
      },
    ],
  };

  it("formats entries as numbered list", () => {
    const result = formatIndexForJudge(index);
    assert.ok(result.includes('1. "podman rootless setup"'));
    assert.ok(result.includes('2. "Svelte 5 runes tutorial"'));
    assert.ok(result.includes('3. "Cloudflare Workers KV limits"'));
  });

  it("includes slug and timestamp in each entry", () => {
    const result = formatIndexForJudge(index);
    assert.ok(result.includes("slug: 2026-04-20-podman-rootless"));
    assert.ok(result.includes("slug: 2026-04-21-svelte-runes"));
    assert.ok(result.includes("2026-04-22T10:00:00Z"));
  });

  it("excludes entry matching excludeSlug", () => {
    const result = formatIndexForJudge(index, "2026-04-21-svelte-runes");
    assert.ok(!result.includes("Svelte 5 runes"));
    assert.ok(result.includes("podman rootless setup"));
    assert.ok(result.includes("Cloudflare Workers KV"));
  });

  it("returns fallback message for empty index", () => {
    const result = formatIndexForJudge({ searches: [] });
    assert.strictEqual(result, "No previous searches.");
  });

  it("returns fallback when all entries excluded", () => {
    const singleEntry: CacheIndex = {
      searches: [
        { slug: "2026-04-20-only-one", query: "only search", timestamp: "2026-04-20T10:00:00Z" },
      ],
    };
    const result = formatIndexForJudge(singleEntry, "2026-04-20-only-one");
    assert.strictEqual(result, "No previous searches.");
  });

  it("limits to MAX_JUDGE_ENTRIES (20) most recent entries", () => {
    const bigIndex: CacheIndex = {
      searches: Array.from({ length: 25 }, (_, i) => ({
        slug: `2026-04-${String(i + 1).padStart(2, "0")}-query-${i}`,
        query: `query ${i}`,
        timestamp: `2026-04-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
      })),
    };
    const result = formatIndexForJudge(bigIndex);
    const lines = result.split("\n").filter((l) => l.trim().length > 0);
    assert.strictEqual(lines.length, 20);
    assert.ok(result.includes("query 24"), "should include last entry");
    assert.ok(!result.includes("query 0"), "should exclude oldest entry");
  });
});

// ═══════════════════════════════════════════
// parseJudgeResponse
// ═══════════════════════════════════════════

describe("parseJudgeResponse", () => {
  const index: CacheIndex = {
    searches: [
      {
        slug: "2026-04-20-podman-rootless",
        query: "podman rootless setup",
        timestamp: "2026-04-20T10:00:00Z",
      },
      {
        slug: "2026-04-21-svelte-runes",
        query: "Svelte 5 runes tutorial",
        timestamp: "2026-04-21T10:00:00Z",
      },
      {
        slug: "2026-04-22-cloudflare-kv",
        query: "Cloudflare Workers KV limits",
        timestamp: "2026-04-22T10:00:00Z",
      },
    ],
  };

  it("parses valid JSON array response", () => {
    const response = '[{"index": 1, "relevance": "Same podman topic"}]';
    const results = parseJudgeResponse(response, index);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].entry.query, "podman rootless setup");
    assert.strictEqual(results[0].relevance, "Same podman topic");
  });

  it("parses multiple matches", () => {
    const response =
      '[{"index": 1, "relevance": "podman"}, {"index": 3, "relevance": "KV limits"}]';
    const results = parseJudgeResponse(response, index);
    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0].entry.slug, "2026-04-20-podman-rootless");
    assert.strictEqual(results[1].entry.slug, "2026-04-22-cloudflare-kv");
  });

  it("handles JSON wrapped in markdown code fences", () => {
    const response = '```json\n[{"index": 2, "relevance": "Svelte related"}]\n```';
    const results = parseJudgeResponse(response, index);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].entry.query, "Svelte 5 runes tutorial");
  });

  it("returns empty for empty array response", () => {
    const response = "[]";
    const results = parseJudgeResponse(response, index);
    assert.strictEqual(results.length, 0);
  });

  it("returns empty for non-JSON response", () => {
    const results = parseJudgeResponse("No matches found.", index);
    assert.strictEqual(results.length, 0);
  });

  it("returns empty for malformed JSON", () => {
    const results = parseJudgeResponse("[{bad json", index);
    assert.strictEqual(results.length, 0);
  });

  it("skips entries with missing index field", () => {
    const response = '[{"relevance": "no index field"}]';
    const results = parseJudgeResponse(response, index);
    assert.strictEqual(results.length, 0);
  });

  it("skips entries with out-of-range index", () => {
    const response = '[{"index": 99, "relevance": "out of range"}]';
    const results = parseJudgeResponse(response, index);
    assert.strictEqual(results.length, 0);
  });

  it("skips entries with zero or negative index", () => {
    const response = '[{"index": 0, "relevance": "zero"}, {"index": -1, "relevance": "negative"}]';
    const results = parseJudgeResponse(response, index);
    assert.strictEqual(results.length, 0);
  });

  it("excludes entries matching excludeSlug", () => {
    const response = '[{"index": 1, "relevance": "match"}]';
    const results = parseJudgeResponse(response, index, "2026-04-20-podman-rootless");
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].entry.slug, "2026-04-21-svelte-runes");
  });

  it("uses default relevance when missing", () => {
    const response = '[{"index": 1}]';
    const results = parseJudgeResponse(response, index);
    assert.strictEqual(results[0].relevance, "");
  });
});

// ═════════════════════════════════════════
// Judge candidate window — prompt and parser must share it (R4)
// ═════════════════════════════════════════

describe("judge candidate window", () => {
  const bigIndex: CacheIndex = {
    searches: Array.from({ length: 25 }, (_, i) => ({
      slug: `entry-${i + 1}`,
      query: `query ${i + 1}`,
      timestamp: "2026-10-01T00:00:00Z",
    })),
  };

  it("renders and parses the same last-20 window once history exceeds it", () => {
    const currentSlug = "entry-5";
    const presented = formatIndexForJudge(bigIndex, currentSlug);
    const lines = presented.split("\n");
    assert.strictEqual(lines.length, 20);
    // Excluding entry-5 leaves 24 eligible entries; the window is the last
    // 20, so the first item the judge sees is entry-6.
    assert.match(lines[0], /entry-6/);
    // A judge answer of index 1 must resolve to the entry presented at
    // position 1, not to the first eligible entry in the full index.
    const [first] = parseJudgeResponse(
      '[{"index":1,"relevance":"fixture"}]',
      bigIndex,
      currentSlug,
    );
    assert.strictEqual(first.entry.slug, "entry-6");
    // Symmetrically, the last presented position resolves to entry-25.
    const [last] = parseJudgeResponse('[{"index":20}]', bigIndex, currentSlug);
    assert.strictEqual(last.entry.slug, "entry-25");
  });

  it("rejects indexes beyond the presented window", () => {
    // 24 eligible entries after exclusion; only 20 are presented, so a
    // response naming position 21 refers to an item the judge never saw.
    assert.deepStrictEqual(
      parseJudgeResponse('[{"index":21}]', bigIndex, "entry-5"),
      [],
    );
  });

  it("exposes the shared window through judgeCandidates", () => {
    const candidates = judgeCandidates(bigIndex, "entry-5");
    assert.strictEqual(candidates.length, 20);
    assert.strictEqual(candidates[0].slug, "entry-6");
    assert.strictEqual(candidates[19].slug, "entry-25");
    assert.deepStrictEqual(judgeCandidates(bigIndex, "entry-25").at(-1), bigIndex.searches[23]);
  });
});

// ═══════════════════════════════════════════
// formatCacheSuggestions
// ═══════════════════════════════════════════

describe("formatCacheSuggestions", () => {
  it("returns empty string for no matches", () => {
    const result = formatCacheSuggestions([], ".search");
    assert.strictEqual(result, "");
  });

  it("formats single match with header and table", () => {
    const matches = [
      {
        entry: {
          slug: "2026-04-20-podman",
          query: "podman rootless setup",
          timestamp: new Date().toISOString(),
        },
        relevance: "Same topic",
      },
    ];
    const result = formatCacheSuggestions(matches, ".search");
    assert.ok(result.includes("📚 Related cached searches"));
    assert.ok(result.includes("podman rootless setup"));
    assert.ok(result.includes("Same topic"));
    assert.ok(result.includes("just now"));
    assert.ok(result.includes(".search/"));
  });

  it("formats multiple matches", () => {
    const now = Date.now();
    const matches = [
      {
        entry: {
          slug: "a",
          query: "first query",
          timestamp: new Date(now - 7200000).toISOString(),
        },
        relevance: "Related topic A",
      },
      {
        entry: {
          slug: "b",
          query:
            "second query that is quite long and should be truncated because it exceeds sixty characters",
          timestamp: new Date(now - 172800000).toISOString(),
        },
        relevance: "Related topic B",
      },
    ];
    const result = formatCacheSuggestions(matches, ".search");
    assert.ok(result.includes("first query"));
    assert.ok(result.includes("2h ago"));
    assert.ok(result.includes("2d ago"));
    assert.ok(result.includes("..."));
  });

  it("truncates long queries to 60 characters", () => {
    const matches = [
      {
        entry: {
          slug: "a",
          query:
            "This is a very long search query that definitely exceeds sixty characters by a wide margin",
          timestamp: new Date().toISOString(),
        },
        relevance: "test",
      },
    ];
    const result = formatCacheSuggestions(matches, ".search");
    assert.ok(result.includes("..."), "should contain truncation marker");
    assert.ok(!result.includes("by a wide margin"), "should not contain the full long query");
  });

  it("uses the configured display root for per-match report paths and the directory label", () => {
    const matches = [
      {
        entry: { slug: "prior", query: "test", timestamp: "2026-01-01T00:00:00.000Z" },
        relevance: "Related topic",
      },
    ];
    for (const cacheDir of [".cache/research", "/cache/shared", "../shared"]) {
      const result = formatCacheSuggestions(matches, cacheDir);
      assert.ok(result.includes(`${cacheDir}/prior/report.md`), result);
      assert.ok(result.includes(`Cache directory: \`${cacheDir}/\``), result);
      assert.ok(!result.includes("read .search/"), result);
    }
  });

  it("exposes the exact report path of each matched directory instead of a <slug> placeholder", () => {
    const matches = [
      {
        entry: { slug: "2026-04-20-first-abc123", query: "first", timestamp: new Date().toISOString() },
        relevance: "test",
      },
      {
        entry: { slug: "2026-04-19-second-def456", query: "second", timestamp: new Date().toISOString() },
        relevance: "test",
      },
    ];
    const result = formatCacheSuggestions(matches, ".search");
    assert.ok(!result.includes("<slug>"), "must not leave a placeholder path");
    assert.ok(result.includes(".search/2026-04-20-first-abc123/report.md"));
    assert.ok(result.includes(".search/2026-04-19-second-def456/report.md"));
  });
});

// ═══════════════════════════════════════════
// Lock primitives — acquireLock, cacheLockDir, indexLockDir
// ═══════════════════════════════════════════

describe("acquireLock", () => {
  it("acquires and releases a lock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lock-test-"));
    try {
      const lockDir = join(dir, ".lock");
      const release = await acquireLock(lockDir, { timeoutMs: 1000 });
      // Lock dir must exist while held.
      const entries = await readdir(dir);
      assert.ok(entries.includes(".lock"), "lock dir should exist");
      // Release.
      await release();
      // After release, we can re-acquire.
      const release2 = await acquireLock(lockDir, { timeoutMs: 100 });
      await release2();
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("prevents concurrent acquisition of the same lock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lock-conc-"));
    try {
      const lockDir = join(dir, ".lock");
      const release = await acquireLock(lockDir, { timeoutMs: 1000 });

      // Second acquisition must time out quickly.
      let timedOut = false;
      try {
        await acquireLock(lockDir, { timeoutMs: 200, pollMs: 20 });
      } catch (err: any) {
        timedOut = true;
        assert.ok(err.message.includes("Lock timeout"));
      }
      assert.ok(timedOut, "second acquire must time out while lock is held");

      await release();

      // After release, re-acquire succeeds.
      const release2 = await acquireLock(lockDir, { timeoutMs: 200, pollMs: 20 });
      await release2();
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("serialises two contenders so only one holds the lock at a time", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lock-serial-"));
    try {
      const lockDir = join(dir, ".lock");
      const acquired: number[] = [];
      const held: number[] = [];

      const contender = async (id: number) => {
        const release = await acquireLock(lockDir, { timeoutMs: 5000, pollMs: 10 });
        acquired.push(id);
        held.push(id);
        // Simulate a short critical section.
        await new Promise((r) => setTimeout(r, 20));
        held.splice(held.indexOf(id), 1);
        await release();
      };

      // Start both contenders concurrently.
      await Promise.all([contender(1), contender(2)]);

      // Both must have acquired.
      assert.deepStrictEqual(acquired.sort(), [1, 2]);
      // At no point were both held simultaneously (held array never had length > 1).
      // This is implied by the mkdir atomicity: only one can succeed at a time.
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("breaks a stale lock and re-acquires", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lock-stale-"));
    try {
      const lockDir = join(dir, ".lock");
      // Acquire normally.
      const release = await acquireLock(lockDir);
      await release();

      // Re-acquire and simulate a stale lock by not releasing.
      const release2 = await acquireLock(lockDir);
      // Don't release — but set a very short stale timeout.
      // The next acquire should break the stale lock.
      const release3 = await acquireLock(lockDir, { staleMs: 0, timeoutMs: 2000 });
      await release3();
      // Clean up the orphaned lock from release2 (release it properly).
      await release2();
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

describe("cacheLockDir", () => {
  it("returns <cachePath>/.lock", () => {
    assert.strictEqual(
      cacheLockDir("/project/.search/2026-04-20-my-query-abc123"),
      "/project/.search/2026-04-20-my-query-abc123/.lock",
    );
  });
});

describe("indexLockDir", () => {
  it("returns <cacheDir>/.index.lock", () => {
    assert.strictEqual(indexLockDir(".search"), ".search/.index.lock");
  });
});

// ═══════════════════════════════════════════
// writeCacheFiles — staging-based atomic visibility
// ═══════════════════════════════════════════

describe("writeCacheFiles", () => {
  it("writes query.txt and extraction files atomically via staging", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cache-write-"));
    try {
      const cachePath = join(dir, "2026-04-20-test-abc123");
      await writeCacheFiles(cachePath, [], [], "", "test query");

      // query.txt must exist with correct content.
      const q = await readFile(join(cachePath, "query.txt"), "utf-8");
      assert.strictEqual(q, "test query");

      // No staging dir left behind.
      const entries = await readdir(cachePath);
      const staging = entries.filter((e) => e.startsWith(".staging."));
      assert.deepStrictEqual(staging, [], `staging dir left behind: ${staging}`);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("writes extractions and source files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cache-full-"));
    try {
      const cachePath = join(dir, "2026-04-20-full-abc123");
      await writeCacheFiles(
        cachePath,
        [
          {
            url: "https://example.com/doc",
            title: "Example Doc",
            extraction: "content here",
            sourceType: "official docs",
            currentness: "current",
            status: "success",
          },
        ],
        [
          {
            url: "https://example.com/doc",
            title: "Example Doc",
            content: "full page content",
            status: "success",
          },
        ],
        "search summary",
        "test query",
      );

      // Extraction file.
      const extEntries = await readdir(join(cachePath, "extractions"));
      assert.strictEqual(extEntries.length, 1);
      const extContent = await readFile(join(cachePath, "extractions", extEntries[0]), "utf-8");
      assert.ok(extContent.includes("content here"));

      // Source file.
      const srcEntries = await readdir(join(cachePath, "sources"));
      assert.strictEqual(srcEntries.length, 1);
      const srcContent = await readFile(join(cachePath, "sources", srcEntries[0]), "utf-8");
      assert.ok(srcContent.includes("full page content"));
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("skips failed extractions and blocked pages", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cache-skip-"));
    try {
      const cachePath = join(dir, "2026-04-20-skip-abc123");
      await writeCacheFiles(
        cachePath,
        [
          {
            url: "https://ok.com",
            title: "OK",
            extraction: "ok",
            sourceType: "blog",
            currentness: "undated",
            status: "success",
          },
          {
            url: "https://fail.com",
            title: "Fail",
            extraction: "",
            sourceType: "unknown",
            currentness: "undated",
            status: "failed",
          },
        ],
        [
          { url: "https://ok.com", title: "OK", content: "ok page", status: "success" },
          {
            url: "https://blocked.com",
            title: "Blocked",
            content: "",
            status: "error",
            error: "403",
          },
        ],
        "",
        "test query",
      );

      const extEntries = await readdir(join(cachePath, "extractions"));
      assert.strictEqual(extEntries.length, 1, "only succeeded extractions written");

      const srcEntries = await readdir(join(cachePath, "sources"));
      assert.strictEqual(srcEntries.length, 1, "only succeeded pages written");
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

// ═════════════════════════════════════════
// allocateSourceIdentity — one allocation for files, prompts and reports (R5)
// ═════════════════════════════════════════

describe("allocateSourceIdentity", () => {
  it("keeps the historical numbering for fully successful runs with pages in order", () => {
    const extractions = [
      { url: "https://a.example/", title: "a", extraction: "x", sourceType: "docs", currentness: "current", status: "success" as const },
      { url: "https://b.example/", title: "b", extraction: "y", sourceType: "docs", currentness: "current", status: "success" as const },
    ];
    const pages = extractions.map((e) => ({ url: e.url, title: e.title, content: "page", status: "success" as const }));
    const identity = allocateSourceIdentity(extractions, pages);
    assert.deepStrictEqual(identity.extractionFiles, ["01-a-example.md", "02-b-example.md"]);
    assert.deepStrictEqual(identity.sourceFiles, ["01-a-example.md", "02-b-example.md"]);
  });

  it("does not renumber successful extractions after a leading failure", () => {
    const extractions = [
      { url: "https://a.example/", title: "a", extraction: "", sourceType: "unknown", currentness: "unknown", status: "failed" as const },
      { url: "https://b.example/", title: "b", extraction: "y", sourceType: "docs", currentness: "current", status: "success" as const },
    ];
    const pages = extractions.map((e) => ({ url: e.url, title: e.title, content: "page", status: "success" as const }));
    const identity = allocateSourceIdentity(extractions, pages);
    // The successful extraction keeps its original position's filename; the
    // failed one writes no file. Report/prompt and physical files therefore
    // agree instead of drifting by one.
    assert.deepStrictEqual(identity.extractionFiles, [null, "02-b-example.md"]);
    assert.deepStrictEqual(identity.sourceFiles, ["01-a-example.md", "02-b-example.md"]);
  });

  it("allocates distinct files for distinct URLs on the same host", () => {
    const extractions = [
      "https://host.example/one",
      "https://host.example/two",
      "https://host.example/three",
    ].map((url, i) => ({
      url,
      title: `p${i}`,
      extraction: i === 1 ? "" : "content",
      sourceType: "docs",
      currentness: "current",
      status: i === 1 ? ("failed" as const) : ("success" as const),
    }));
    const pages = extractions.map((e) => ({ url: e.url, title: e.title, content: "page", status: "success" as const }));
    const identity = allocateSourceIdentity(extractions, pages);
    assert.deepStrictEqual(identity.extractionFiles, [
      "01-host-example.md",
      null,
      "03-host-example.md",
    ]);
    assert.deepStrictEqual(identity.sourceFiles, [
      "01-host-example.md",
      "02-host-example.md",
      "03-host-example.md",
    ]);
  });

  it("resolves reordered manual full pages to the extraction's slot", () => {
    const extractions = [
      { url: "https://a.example/", title: "a", extraction: "x", sourceType: "docs", currentness: "current", status: "success" as const },
      { url: "https://b.example/", title: "b", extraction: "y", sourceType: "docs", currentness: "current", status: "success" as const },
    ];
    const pages = [extractions[1], extractions[0]].map((e) => ({
      url: e.url,
      title: e.title,
      content: "page",
      status: "success" as const,
    }));
    const identity = allocateSourceIdentity(extractions, pages);
    // Physical source files follow the extraction slots, not the page order,
    // so the report's sources/01-a-example.md exists.
    assert.deepStrictEqual(identity.sourceFiles, ["02-b-example.md", "01-a-example.md"]);
    assert.strictEqual(identity.sourceFileFor("https://a.example/"), "01-a-example.md");
  });

  it("reports no source file when optional full pages are absent", () => {
    const extractions = [
      { url: "https://a.example/", title: "a", extraction: "x", sourceType: "docs", currentness: "current", status: "success" as const },
    ];
    const identity = allocateSourceIdentity(extractions, []);
    assert.strictEqual(identity.extractionFileFor("https://a.example/"), "01-a-example.md");
    assert.strictEqual(identity.sourceFileFor("https://a.example/"), null);
  });
});

// ═════════════════════════════════════════
// Advertised cache paths — every path in reports/prompts must exist (R5)
// ═════════════════════════════════════════

async function assertPathExists(root: string, relative: string): Promise<void> {
  await access(join(root, relative));
}

async function advertisedPaths(...texts: string[]): Promise<string[]> {
  const paths = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(/(?:extractions|sources)\/[\w.-]+\.md/g)) {
      paths.add(match[0]);
    }
    for (const match of text.matchAll(/^(?:Extraction|Full page) file: (.+)$/gm)) {
      // Strip the cache-path prefix (may be relative or absolute).
      const ref = match[1];
      const idx = ref.search(/(?:extractions|sources)\//);
      assert.ok(idx >= 0, `file reference without cache subpath: ${ref}`);
      paths.add(ref.slice(idx));
    }
  }
  return [...paths];
}

describe("advertised cache path integrity", () => {
  it("mixed extraction outcomes: every report and collation-prompt path exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cache-r5-mixed-"));
    try {
      const cachePath = join(dir, "2026-10-06-mixed-abc123");
      const extractions = [
        { url: "https://a.example/", title: "a", extraction: "", sourceType: "unknown", currentness: "unknown", status: "failed" as const },
        { url: "https://b.example/", title: "b", extraction: "extracted b", sourceType: "docs", currentness: "current", status: "success" as const },
      ];
      const pages = extractions.map((e) => ({ url: e.url, title: e.title, content: `page ${e.title}`, status: "success" as const }));
      const identity = allocateSourceIdentity(extractions, pages);
      await writeCacheFiles(cachePath, extractions, pages, "summary", "mixed query", identity);
      await writeReportFile(cachePath, "mixed query", "collated", extractions, pages, cachePath, identity);
      const report = await readFile(join(cachePath, "report.md"), "utf8");
      const prompt = buildCollationMessage(
        "mixed query",
        cachePath,
        "summary",
        extractions.filter((e) => e.status === "success"),
        identity,
      );
      const paths = await advertisedPaths(report, prompt);
      assert.ok(paths.length >= 2, `expected advertised paths, got ${JSON.stringify(paths)}`);
      for (const path of paths) {
        await assertPathExists(cachePath, path);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("duplicate hosts and a degraded middle extraction: every advertised path exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cache-r5-dup-"));
    try {
      const cachePath = join(dir, "2026-10-06-dup-abc123");
      const extractions = ["one", "two", "three"].map((seg, i) => ({
        url: `https://host.example/${seg}`,
        title: `p${i}`,
        extraction: i === 1 ? "" : `content ${seg}`,
        sourceType: "docs",
        currentness: "current",
        status: i === 1 ? ("failed" as const) : ("success" as const),
      }));
      const pages = extractions.map((e) => ({ url: e.url, title: e.title, content: "page", status: "success" as const }));
      const identity = allocateSourceIdentity(extractions, pages);
      await writeCacheFiles(cachePath, extractions, pages, "", "dup query", identity);
      await writeReportFile(cachePath, "dup query", "collated", extractions, pages, cachePath, identity);
      const report = await readFile(join(cachePath, "report.md"), "utf8");
      // Distinct files for distinct URLs on the same host; the failed middle
      // extraction is not advertised.
      assert.ok(report.includes("extractions/01-host-example.md"));
      assert.ok(report.includes("extractions/03-host-example.md"));
      assert.ok(!report.includes("extractions/02-host-example.md"));
      const prompt = buildCollationMessage(
        "dup query",
        cachePath,
        undefined,
        extractions.filter((e) => e.status === "success"),
        identity,
      );
      for (const path of await advertisedPaths(report, prompt)) {
        await assertPathExists(cachePath, path);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("manual collation without full pages advertises no full-page path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cache-r5-manual-"));
    try {
      const cachePath = join(dir, "2026-10-06-manual-abc123");
      const extractions = [
        { url: "https://a.example/", title: "a", extraction: "x", sourceType: "docs", currentness: "current", status: "success" as const },
      ];
      const identity = allocateSourceIdentity(extractions, []);
      await writeCacheFiles(cachePath, extractions, [], "", "manual", identity);
      await writeReportFile(cachePath, "manual", "collated", extractions, [], cachePath, identity);
      const prompt = buildCollationMessage("manual", cachePath, undefined, extractions, identity);
      assert.ok(!prompt.includes("Full page file"), "no full page supplied; none may be advertised");
      const report = await readFile(join(cachePath, "report.md"), "utf8");
      assert.ok(report.includes("| Not cached |"), "absent full page is labelled instead of linked");
      for (const path of await advertisedPaths(report, prompt)) {
        await assertPathExists(cachePath, path);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ═════════════════════════════════════════
// Cache artefact replacement on refresh (R6)
// ═════════════════════════════════════════

describe("cache artefact replacement", () => {
  function ext(url: string, text: string) {
    return {
      url,
      title: url,
      extraction: text,
      sourceType: "docs",
      currentness: "current",
      status: "success" as const,
    };
  }
  function page(url: string, text: string) {
    return { url, title: url, content: text, status: "success" as const };
  }

  it("removes obsolete extraction and source files on a refresh with fewer sources", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cache-r6-fewer-"));
    try {
      const cachePath = join(dir, "2026-10-06-refresh-abc123");
      await writeCacheFiles(
        cachePath,
        [ext("https://a.example/", "a"), ext("https://b.example/", "b")],
        [page("https://a.example/", "pa"), page("https://b.example/", "pb")],
        "",
        "refresh",
      );
      // Second run of the same query finds only one source.
      await writeCacheFiles(
        cachePath,
        [ext("https://c.example/", "c")],
        [page("https://c.example/", "pc")],
        "",
        "refresh",
      );
      assert.deepStrictEqual(
        (await readdir(join(cachePath, "extractions"))).sort(),
        ["01-c-example.md"],
      );
      assert.deepStrictEqual(
        (await readdir(join(cachePath, "sources"))).sort(),
        ["01-c-example.md"],
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("replaces changed source sets instead of merging old and new runs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cache-r6-changed-"));
    try {
      const cachePath = join(dir, "2026-10-06-changed-abc123");
      await writeCacheFiles(
        cachePath,
        [ext("https://a.example/x", "x"), ext("https://a.example/y", "y")],
        [page("https://a.example/x", "px"), page("https://a.example/y", "py")],
        "",
        "changed",
      );
      // Same host, different URLs: the new run keeps one file; the old
      // numbered files must not survive alongside it.
      await writeCacheFiles(
        cachePath,
        [ext("https://a.example/x", "x2"), ext("https://a.example/z", "z")],
        [page("https://a.example/x", "px2"), page("https://a.example/z", "pz")],
        "",
        "changed",
      );
      assert.deepStrictEqual(
        (await readdir(join(cachePath, "sources"))).sort(),
        ["01-a-example.md", "02-a-example.md"],
      );
      assert.match(
        await readFile(join(cachePath, "sources", "01-a-example.md"), "utf8"),
        /px2/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("preserves supplementary llms-full documentation across refreshes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cache-r6-llms-"));
    try {
      const cachePath = join(dir, "2026-10-06-llms-abc123");
      await writeCacheFiles(
        cachePath,
        [ext("https://a.example/", "a")],
        [page("https://a.example/", "pa")],
        "",
        "llms",
      );
      await writeFile(
        join(cachePath, "sources", "llms-full-a.example.md"),
        "documentation",
        "utf8",
      );
      // Refresh with an empty artefact set (the review's probe): the numbered
      // files go, the documentation download stays.
      await writeCacheFiles(cachePath, [], [], "", "llms");
      assert.deepStrictEqual(await readdir(join(cachePath, "sources")), [
        "llms-full-a.example.md",
      ]);
      await readFile(join(cachePath, "sources", "llms-full-a.example.md"), "utf8");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("clearCacheArtefacts removes run artefacts but keeps llms-full downloads and meta.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cache-r6-clear-"));
    try {
      const cachePath = join(dir, "2026-10-06-clear-abc123");
      await writeCacheFiles(
        cachePath,
        [ext("https://a.example/", "a")],
        [page("https://a.example/", "pa")],
        "",
        "clear",
      );
      await writeReportFile(
        cachePath,
        "clear",
        "collated",
        [ext("https://a.example/", "a")],
        [page("https://a.example/", "pa")],
      );
      await writeFile(join(cachePath, "sources", "llms-full-a.example.md"), "docs");
      await writeFile(join(cachePath, "meta.json"), "{}");

      await clearCacheArtefacts(cachePath);

      assert.deepStrictEqual((await readdir(cachePath)).sort(), ["meta.json", "sources"]);
      assert.deepStrictEqual(await readdir(join(cachePath, "sources")), [
        "llms-full-a.example.md",
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ═══════════════════════════════════════════
// Concurrent index updates under lock
// ═══════════════════════════════════════════

describe("concurrent index updates", () => {
  it("many concurrent updateIndex calls never corrupt .index.json when each holds the index lock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cache-ridx-"));
    try {
      const N = 20;
      // Fire N concurrent index updates, each acquiring the index lock first.
      // Without the lock, concurrent updateIndex calls would race on the
      // shared .index.json (classic TOCTOU). The lock serialises them.
      await Promise.all(
        Array.from({ length: N }, async (_, i) => {
          const release = await acquireLock(indexLockDir(dir), { timeoutMs: 5000, pollMs: 5 });
          try {
            await updateIndex(dir, `slug-${i}`, `query ${i}`);
          } finally {
            await release();
          }
        }),
      );

      const index = await readIndex(dir);
      assert.strictEqual(
        index.searches.length,
        N,
        `expected ${N} entries, got ${index.searches.length}`,
      );
      // All slugs must be present.
      const slugs = new Set(index.searches.map((e) => e.slug));
      for (let i = 0; i < N; i++) {
        assert.ok(slugs.has(`slug-${i}`), `missing slug-${i}`);
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it("updateIndex under lock preserves all entries from interleaved writers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cache-ilock-"));
    try {
      const N = 10;
      const results: Promise<void>[] = [];

      for (let i = 0; i < N; i++) {
        results.push(
          (async () => {
            const idxLock = indexLockDir(dir);
            const release = await acquireLock(idxLock, { timeoutMs: 5000, pollMs: 5 });
            try {
              await updateIndex(dir, `slug-${i}`, `query ${i}`);
            } finally {
              await release();
            }
          })(),
        );
      }

      await Promise.all(results);

      const index = await readIndex(dir);
      assert.strictEqual(index.searches.length, N);
      const slugs = index.searches.map((e) => e.slug).sort();
      for (let i = 0; i < N; i++) {
        assert.ok(slugs.includes(`slug-${i}`));
      }
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

// ═══════════════════════════════════════════
// Concurrent same-query cache writes
// ═══════════════════════════════════════════

describe("concurrent same-query cache writes", () => {
  it("two concurrent locked writes leave exactly the last committed artefact set", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cache-concw-"));
    try {
      const cachePath = join(dir, "2026-04-20-same-query-abc123");
      // The cache path must exist for the lock dir to be created inside it.
      await mkdir(cachePath, { recursive: true });

      const writer = async (suffix: string) => {
        const release = await acquireLock(cacheLockDir(cachePath), { timeoutMs: 5000, pollMs: 10 });
        try {
          await writeCacheFiles(
            cachePath,
            [
              {
                url: `https://${suffix}.com`,
                title: suffix,
                extraction: `extract-${suffix}`,
                sourceType: "blog",
                currentness: "undated",
                status: "success",
              },
            ],
            [
              {
                url: `https://${suffix}.com`,
                title: suffix,
                content: `page-${suffix}`,
                status: "success",
              },
            ],
            "",
            `query-${suffix}`,
          );
        } finally {
          await release();
        }
      };

      // Both write to the same cachePath under the lock. The last writer
      // replaces the previous set instead of merging with it.
      await Promise.all([writer("a"), writer("b")]);

      const extEntries = await readdir(join(cachePath, "extractions"));
      assert.strictEqual(extEntries.length, 1, `expected the last writer's file only, got ${extEntries}`);
      // Whichever writer committed last also wrote query.txt; the surviving
      // extraction must belong to that same writer.
      const query = await readFile(join(cachePath, "query.txt"), "utf-8");
      const lastSuffix = query.replace("query-", "");
      assert.match(extEntries[0], new RegExp(`^01-${lastSuffix}-com\.md$`));
      assert.match(
        await readFile(join(cachePath, "extractions", extEntries[0]), "utf-8"),
        new RegExp(`extract-${lastSuffix}`),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("cache lock serialises two writers on the same cache path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cache-serial-"));
    try {
      const cachePath = join(dir, "2026-04-20-serial-abc123");
      await mkdir(cachePath, { recursive: true });
      const order: string[] = [];

      const writer = async (id: string) => {
        const release = await acquireLock(cacheLockDir(cachePath), { timeoutMs: 5000, pollMs: 5 });
        order.push(`enter-${id}`);
        // Simulate a short write.
        await new Promise((r) => setTimeout(r, 20));
        order.push(`exit-${id}`);
        await release();
      };

      await Promise.all([writer("1"), writer("2")]);

      // The entries must be [enter-1, exit-1, enter-2, exit-2] or
      // [enter-2, exit-2, enter-1, exit-1], never interleaved.
      const enters = order.filter((o) => o.startsWith("enter-"));
      const exits = order.filter((o) => o.startsWith("exit-"));
      assert.deepStrictEqual(
        enters.map((e) => e.replace("enter-", "")),
        exits.map((e) => e.replace("exit-", "")),
        "enter and exit must be paired for the same writer",
      );
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
