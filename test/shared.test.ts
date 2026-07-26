// test/shared.test.ts — Unit tests for src/tools/shared.ts builders.
//
// These builders were extracted from inline code in the four tools during
// the v0.12.1 simplification. The tests lock the exact structure the LLM
// prompts and tool results had at extraction time, so later edits to a
// builder fail loudly here instead of silently changing prompt text.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  appendDomainFilter,
  buildExtractionMessage,
  buildCollationMessage,
  formatCacheAppendix,
} from "../src/tools/shared.js";
import { TRUNCATED_MARKER, truncateContent } from "../src/util.js";
import type { ExtractResult } from "../src/types.js";

describe("appendDomainFilter", () => {
  it("returns the query unchanged when no domains are given", () => {
    assert.strictEqual(appendDomainFilter("q"), "q");
    assert.strictEqual(appendDomainFilter("q", []), "q");
    assert.strictEqual(appendDomainFilter("q", undefined), "q");
  });

  it("appends a single site filter", () => {
    assert.strictEqual(appendDomainFilter("q", ["docs.python.org"]), "q site:docs.python.org");
  });

  it("joins multiple domains with OR site:", () => {
    assert.strictEqual(appendDomainFilter("q", ["a.com", "b.com"]), "q site:a.com OR site:b.com");
  });
});

describe("truncateContent", () => {
  it("returns content unchanged at or under the cap", () => {
    assert.strictEqual(truncateContent("abc", 3), "abc");
    assert.strictEqual(truncateContent("abc", 10), "abc");
  });

  it("slices over-cap content and appends the unified marker", () => {
    const out = truncateContent("x".repeat(100), 50);
    assert.strictEqual(out, "x".repeat(50) + TRUNCATED_MARKER);
  });
});

describe("buildExtractionMessage", () => {
  it("wraps content and query, omitting Focus when not given", () => {
    const msg = buildExtractionMessage("PAGE", "the query", undefined, 1000);
    assert.strictEqual(
      msg,
      "Web page content:\n---\nPAGE\n---\n\nExtract information relevant to: the query\n",
    );
  });

  it("includes the Focus line when focusPrompt is given", () => {
    const msg = buildExtractionMessage("PAGE", "the query", "only APIs", 1000);
    assert.ok(msg.endsWith("\nFocus: only APIs\n"));
  });

  it("truncates content beyond maxChars with the unified marker", () => {
    const msg = buildExtractionMessage("y".repeat(200), "q", undefined, 100);
    assert.ok(msg.includes("y".repeat(100) + TRUNCATED_MARKER));
    assert.ok(!msg.includes("y".repeat(101)));
  });
});

function makeExt(url: string, title: string): ExtractResult {
  return {
    url,
    title,
    extraction: `EXTRACTED:${url}`,
    sourceType: "official docs",
    currentness: "current",
    status: "success",
  };
}

describe("buildCollationMessage", () => {
  it("includes query, cache path, and per-source blocks with file references", () => {
    const msg = buildCollationMessage(
      "the query",
      ".search/2026-01-01-slug-hash",
      "SEARCH SUMMARY",
      [makeExt("https://example.com/a", "Page A"), makeExt("https://other.org/b", "Page B")],
    );
    assert.ok(msg.startsWith("Original query: the query\n"));
    assert.ok(msg.includes("Cache path: .search/2026-01-01-slug-hash/\n\n"));
    assert.ok(msg.includes("Search summary (from Sonar):\nSEARCH SUMMARY\n\n"));
    assert.ok(msg.includes("--- Source 1: https://example.com/a ---\n"));
    assert.ok(msg.includes("Title: Page A\n"));
    assert.ok(msg.includes("Type: official docs\n"));
    assert.ok(
      msg.includes("Extraction file: .search/2026-01-01-slug-hash/extractions/01-example-com.md\n"),
    );
    assert.ok(
      msg.includes("Full page file: .search/2026-01-01-slug-hash/sources/01-example-com.md\n"),
    );
    assert.ok(msg.includes("--- Source 2: https://other.org/b ---\n"));
    assert.ok(
      msg.includes("Extraction file: .search/2026-01-01-slug-hash/extractions/02-other-org.md\n"),
    );
    assert.ok(msg.includes("\nEXTRACTED:https://example.com/a\n\n"));
  });

  it("omits the search summary section when not given", () => {
    const msg = buildCollationMessage("q", ".search/x", undefined, [
      makeExt("https://a.com/", "t"),
    ]);
    assert.ok(!msg.includes("Search summary"));
  });
});

describe("formatCacheAppendix", () => {
  it("lists cache path, report, source counts, and read hints", () => {
    const out = formatCacheAppendix(".search/slug", 3, 2);
    assert.ok(out.startsWith("\n\n---\n"));
    assert.ok(out.includes("**Cache**: `.search/slug/`\n"));
    assert.ok(out.includes("**Report**: `.search/slug/report.md`\n"));
    assert.ok(out.includes("**Sources**: 3 succeeded, 2 failed\n"));
    assert.ok(out.includes("- Read the extraction: `read .search/slug/extractions/01-*.md`\n"));
    assert.ok(out.includes("- Read the full page: `read .search/slug/sources/01-*.md`\n"));
  });
});
