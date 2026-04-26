// test/cache.test.ts — Unit tests for cache utilities
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  makeCachePath,
  domainSlug,
  readIndex,
  formatIndexForJudge,
  parseJudgeResponse,
  formatCacheSuggestions,
} from "../src/cache.js";
import type { CacheIndex, IndexEntry } from "../src/cache.js";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
  it("produces date-slug format under cacheDir", () => {
    const original = Date.prototype.toISOString;
    Date.prototype.toISOString = () => "2026-04-20T12:00:00.000Z";

    const result = makeCachePath("How do Svelte 5 runes work?", "/project", ".search");
    assert.strictEqual(result, ".search/2026-04-20-how-do-svelte-5-runes");

    Date.prototype.toISOString = original;
  });

  it("limits slug to first 5 words", () => {
    const original = Date.prototype.toISOString;
    Date.prototype.toISOString = () => "2026-04-20T12:00:00.000Z";

    const result = makeCachePath("this is a very long query with many words", "/project", ".search");
    assert.strictEqual(result, ".search/2026-04-20-this-is-a-very-long");

    Date.prototype.toISOString = original;
  });

  it("strips non-alphanumeric characters from slug", () => {
    const original = Date.prototype.toISOString;
    Date.prototype.toISOString = () => "2026-04-20T12:00:00.000Z";

    const result = makeCachePath("C++ vs Rust: which is faster?", "/project", ".search");
    assert.strictEqual(result, ".search/2026-04-20-c-vs-rust-which-is");

    Date.prototype.toISOString = original;
  });

  it("respects custom cacheDir", () => {
    const original = Date.prototype.toISOString;
    Date.prototype.toISOString = () => "2026-04-20T12:00:00.000Z";

    const result = makeCachePath("test query", "/project", ".cache/research");
    assert.strictEqual(result, ".cache/research/2026-04-20-test-query");

    Date.prototype.toISOString = original;
  });

  it("handles single-word query", () => {
    const original = Date.prototype.toISOString;
    Date.prototype.toISOString = () => "2026-04-20T12:00:00.000Z";

    const result = makeCachePath("docker", "/project", ".search");
    assert.strictEqual(result, ".search/2026-04-20-docker");

    Date.prototype.toISOString = original;
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
    // Should include the most recent entries (indices 5-24)
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
    // Index 1 maps to the first *eligible* entry after exclusion
    // After excluding podman, eligible = [svelte, cloudflare]
    // So index 1 = svelte
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
    // Long query should be truncated
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
    // The original query is >60 chars, so it must be truncated with ...
    assert.ok(result.includes("..."), "should contain truncation marker");
    // The full untruncated query must NOT appear
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
