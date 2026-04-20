// test/util.test.ts — Unit tests for shared utilities
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  textContent,
  getAgentDir,
  extractSourceUrls,
  inferSourceType,
  inferCurrentness,
} from "../src/util.js";

describe("textContent", () => {
  it("creates a properly typed text content object", () => {
    const result = textContent("Hello, world!");
    assert.deepStrictEqual(result, { type: "text", text: "Hello, world!" });
  });

  it("handles empty string", () => {
    const result = textContent("");
    assert.deepStrictEqual(result, { type: "text", text: "" });
  });

  it("handles multiline text", () => {
    const text = "Line 1\nLine 2\nLine 3";
    const result = textContent(text);
    assert.strictEqual(result.text, text);
    assert.strictEqual(result.type, "text");
  });
});

describe("getAgentDir", () => {
  it("returns a path ending in .pi/agent", () => {
    const result = getAgentDir();
    assert.ok(result.endsWith(".pi/agent"), `Expected path ending in .pi/agent, got: ${result}`);
  });
});

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
