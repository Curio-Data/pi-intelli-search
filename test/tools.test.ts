// test/tools.test.ts — Unit tests for shared tool utilities
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// These functions are duplicated across web-search.ts and web-research.ts
// (and web-extract.ts). We test the logic here; deduplication happens later.

function extractSourceUrls(text: string): Array<{ url: string; title: string }> {
  const urls: Array<{ url: string; title: string }> = [];
  const linkPattern = /\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
  let match;
  while ((match = linkPattern.exec(text)) !== null) {
    const url = match[2];
    if (!urls.some((u) => u.url === url)) {
      urls.push({ url, title: match[1] });
    }
  }
  return urls;
}

function inferSourceType(line: string): string {
  const lower = line.toLowerCase();
  if (lower.includes("official doc")) return "official docs";
  if (lower.includes("api reference")) return "API reference";
  if (lower.includes("tutorial")) return "tutorial";
  if (lower.includes("blog")) return "blog post";
  if (lower.includes("forum") || lower.includes("stackoverflow")) return "forum";
  return "unknown";
}

function inferCurrentness(line: string): string {
  const lower = line.toLowerCase();
  if (lower.includes("current") || lower.includes("up to date")) return "current";
  if (lower.includes("outdated") || lower.includes("old")) return "possibly outdated";
  return "undated";
}

describe("extractSourceUrls", () => {
  it("extracts markdown links with URLs", () => {
    const text = "See [Svelte docs](https://svelte.dev/docs) and [React](https://react.dev).";
    const urls = extractSourceUrls(text);
    assert.deepStrictEqual(urls, [
      { url: "https://svelte.dev/docs", title: "Svelte docs" },
      { url: "https://react.dev", title: "React" },
    ]);
  });

  it("deduplicates identical URLs", () => {
    const text = "[Link](https://example.com) and again [Link](https://example.com)";
    const urls = extractSourceUrls(text);
    assert.strictEqual(urls.length, 1);
    assert.strictEqual(urls[0].url, "https://example.com");
  });

  it("returns empty array for text without links", () => {
    assert.deepStrictEqual(extractSourceUrls("No links here"), []);
  });

  it("handles empty titles", () => {
    const text = "[](https://example.com)";
    const urls = extractSourceUrls(text);
    assert.strictEqual(urls.length, 1);
    assert.strictEqual(urls[0].title, "");
  });

  it("only matches http/https URLs", () => {
    const text = "[ftp](ftp://files.example.com) [http](http://example.com)";
    const urls = extractSourceUrls(text);
    assert.strictEqual(urls.length, 1);
    assert.strictEqual(urls[0].url, "http://example.com");
  });

  it("handles URLs with query params and fragments", () => {
    const text = "[API](https://api.example.com/v2?q=test#section)";
    const urls = extractSourceUrls(text);
    assert.strictEqual(urls[0].url, "https://api.example.com/v2?q=test#section");
  });
});

describe("inferSourceType", () => {
  const cases: Array<{ input: string; expected: string }> = [
    { input: "This is official documentation for...", expected: "official docs" },
    { input: "API reference page covering...", expected: "API reference" },
    { input: "A tutorial on how to...", expected: "tutorial" },
    { input: "Blog post about...", expected: "blog post" },
    { input: "A forum thread discussing...", expected: "forum" },
    { input: "StackOverflow answer about...", expected: "forum" },
    { input: "This page covers various topics", expected: "unknown" },
    { input: "OFFICIAL DOCS about...", expected: "official docs" },
  ];

  for (const { input, expected } of cases) {
    it(`classifies "${input.slice(0, 40)}..." as ${expected}`, () => {
      assert.strictEqual(inferSourceType(input), expected);
    });
  }
});

describe("inferCurrentness", () => {
  const cases: Array<{ input: string; expected: string }> = [
    { input: "Current and up to date documentation", expected: "current" },
    { input: "Up to date as of 2025", expected: "current" },
    { input: "This is outdated material", expected: "possibly outdated" },
    { input: "Old approach from 2020", expected: "possibly outdated" },
    { input: "No date info available", expected: "undated" },
  ];

  for (const { input, expected } of cases) {
    it(`classifies "${input}" as ${expected}`, () => {
      assert.strictEqual(inferCurrentness(input), expected);
    });
  }
});
