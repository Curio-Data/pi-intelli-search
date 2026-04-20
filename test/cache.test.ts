// test/cache.test.ts — Unit tests for cache utilities
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeCachePath, domainSlug } from "../src/cache.js";

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
