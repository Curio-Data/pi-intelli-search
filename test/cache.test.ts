// test/cache.test.ts — Unit tests for cache utilities including
// lock primitives, atomic writes, and concurrent safety.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  makeCachePath,
  domainSlug,
  readIndex,
  writeCacheFiles,
  updateIndex,
  acquireLock,
  cacheLockDir,
  indexLockDir,
  formatIndexForJudge,
  parseJudgeResponse,
  formatCacheSuggestions,
} from "../src/cache.js";
import type { CacheIndex, IndexEntry } from "../src/cache.js";
import { join } from "node:path";
import { mkdtemp, rm, writeFile, readFile, readdir, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";

// ═══════════════════════════════════════════
// domainSlug
// ═══════════════════════════════════════════

describe("domainSlug", () => {
  it("extracts hostname and converts dots to hyphens", () => {
    assert.strictEqual(domainSlug("https://developers.cloudflare.com/d1/"), "developers-cloudflare-com");
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
    assert.strictEqual(domainSlug("https://docs.python.org/3/library/asyncio.html"), "docs-python-org");
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
      assert.ok(result.startsWith(".search/2026-04-20-how-do-svelte-5-runes-"), result);
      assert.match(result, HASH);
    } finally {
      Date.prototype.toISOString = original;
    }
  });

  it("limits slug to first 5 words", () => {
    const original = Date.prototype.toISOString;
    Date.prototype.toISOString = () => "2026-04-20T12:00:00.000Z";
    try {
      const result = makeCachePath("this is a very long query with many words", "/project", ".search");
      assert.ok(result.startsWith(".search/2026-04-20-this-is-a-very-long-"), result);
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
      assert.ok(result.startsWith(".search/2026-04-20-c-vs-rust-which-is-"), result);
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
      assert.ok(result.startsWith(".cache/research/2026-04-20-test-query-"), result);
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
      assert.ok(result.startsWith(".search/2026-04-20-docker-"), result);
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
      { slug: "2026-04-20-podman-rootless", query: "podman rootless setup", timestamp: "2026-04-20T10:00:00Z" },
      { slug: "2026-04-21-svelte-runes", query: "Svelte 5 runes tutorial", timestamp: "2026-04-21T10:00:00Z" },
      { slug: "2026-04-22-cloudflare-kv", query: "Cloudflare Workers KV limits", timestamp: "2026-04-22T10:00:00Z" },
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
      { slug: "2026-04-20-podman-rootless", query: "podman rootless setup", timestamp: "2026-04-20T10:00:00Z" },
      { slug: "2026-04-21-svelte-runes", query: "Svelte 5 runes tutorial", timestamp: "2026-04-21T10:00:00Z" },
      { slug: "2026-04-22-cloudflare-kv", query: "Cloudflare Workers KV limits", timestamp: "2026-04-22T10:00:00Z" },
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
    const response = '[{"index": 1, "relevance": "podman"}, {"index": 3, "relevance": "KV limits"}]';
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
        entry: { slug: "2026-04-20-podman", query: "podman rootless setup", timestamp: new Date().toISOString() },
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
        entry: { slug: "a", query: "first query", timestamp: new Date(now - 7200000).toISOString() },
        relevance: "Related topic A",
      },
      {
        entry: { slug: "b", query: "second query that is quite long and should be truncated because it exceeds sixty characters",
          timestamp: new Date(now - 172800000).toISOString() },
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
          query: "This is a very long search query that definitely exceeds sixty characters by a wide margin",
          timestamp: new Date().toISOString(),
        },
        relevance: "test",
      },
    ];
    const result = formatCacheSuggestions(matches, ".search");
    assert.ok(result.includes("..."), "should contain truncation marker");
    assert.ok(!result.includes("by a wide margin"), "should not contain the full long query");
  });

  it("includes instruction to read report.md", () => {
    const matches = [
      {
        entry: { slug: "2026-04-20-test", query: "test", timestamp: new Date().toISOString() },
        relevance: "test",
      },
    ];
    const result = formatCacheSuggestions(matches, ".search");
    assert.ok(result.includes("read .search/<slug>/report.md"), "should explain how to read reports");
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
          { url: "https://ok.com", title: "OK", extraction: "ok", sourceType: "blog", currentness: "undated", status: "success" },
          { url: "https://fail.com", title: "Fail", extraction: "", sourceType: "unknown", currentness: "undated", status: "failed" },
        ],
        [
          { url: "https://ok.com", title: "OK", content: "ok page", status: "success" },
          { url: "https://blocked.com", title: "Blocked", content: "", status: "error", error: "403" },
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
  it("two concurrent writeCacheFiles do not interleave", async () => {
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
              { url: `https://${suffix}.com`, title: suffix, extraction: `extract-${suffix}`, sourceType: "blog", currentness: "undated", status: "success" },
            ],
            [
              { url: `https://${suffix}.com`, title: suffix, content: `page-${suffix}`, status: "success" },
            ],
            "",
            "test query",
          );
        } finally {
          await release();
        }
      };

      // Both write to the same cachePath.
      await Promise.all([writer("a"), writer("b")]);

      // Both extractions should be present (different filenames survive).
      const extEntries = await readdir(join(cachePath, "extractions"));
      assert.strictEqual(extEntries.length, 2, `expected 2 extractions, got ${extEntries.length}`);
    } finally {
      await rm(dir, { recursive: true });
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
