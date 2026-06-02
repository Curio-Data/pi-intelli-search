// test/util.test.ts — Unit tests for shared utilities
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  textContent,
  getAgentDir,
  extractSourceUrls,
  inferSourceType,
  inferCurrentness,
  mapWithConcurrency,
} from "../src/util.js";

const tick = () => new Promise<void>((r) => setTimeout(r, 5));

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

  it("preserves a balanced parenthesis inside the URL (Wikipedia-style)", () => {
    const text = "See [Foo](https://en.wikipedia.org/wiki/Foo_(disambiguation)) here.";
    const urls = extractSourceUrls(text);
    assert.strictEqual(urls.length, 1);
    assert.strictEqual(urls[0].url, "https://en.wikipedia.org/wiki/Foo_(disambiguation)");
  });

  it("preserves multiple parenthetical groups in a URL (MSDN-style)", () => {
    const text = "[Docs](https://learn.microsoft.com/dotnet/api/system.string.format(v=net-8.0))";
    const urls = extractSourceUrls(text);
    assert.strictEqual(urls.length, 1);
    assert.strictEqual(
      urls[0].url,
      "https://learn.microsoft.com/dotnet/api/system.string.format(v=net-8.0)",
    );
  });

  it("does not swallow trailing markdown after a paren-free URL", () => {
    const text = "[React](https://react.dev). Then [Vue](https://vuejs.org).";
    const urls = extractSourceUrls(text);
    assert.deepStrictEqual(urls, [
      { url: "https://react.dev", title: "React" },
      { url: "https://vuejs.org", title: "Vue" },
    ]);
  });
});

describe("mapWithConcurrency", () => {
  it("never exceeds the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 12 }, (_, i) => i);
    await mapWithConcurrency(items, 3, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await tick();
      active--;
      return n;
    });
    assert.ok(peak <= 3, `peak concurrency ${peak} exceeded limit of 3`);
    assert.ok(peak >= 2, `expected real concurrency, peak was only ${peak}`);
  });

  it("preserves input order regardless of completion order", async () => {
    const items = [40, 10, 30, 20];
    // Earlier items resolve later, so completion order differs from input order.
    const results = await mapWithConcurrency(items, 4, async (ms) => {
      await new Promise<void>((r) => setTimeout(r, ms));
      return ms;
    });
    assert.deepStrictEqual(results, [40, 10, 30, 20]);
  });

  it("invokes onSettled exactly once per item with index and result", async () => {
    const items = ["a", "b", "c"];
    const settled: Array<{ item: string; index: number; result: string }> = [];
    await mapWithConcurrency(
      items,
      2,
      async (s, i) => `${s}-${i}`,
      { onSettled: (item, index, result) => settled.push({ item, index, result }) },
    );
    assert.strictEqual(settled.length, 3);
    // Sort by index for a stable assertion (completion order is non-deterministic).
    settled.sort((a, b) => a.index - b.index);
    assert.deepStrictEqual(settled, [
      { item: "a", index: 0, result: "a-0" },
      { item: "b", index: 1, result: "b-1" },
      { item: "c", index: 2, result: "c-2" },
    ]);
  });

  it("stops launching new work once the signal is aborted", async () => {
    const controller = new AbortController();
    let started = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    const results = await mapWithConcurrency(
      items,
      2,
      async (n) => {
        started++;
        if (n === 1) controller.abort(); // abort during the first wave
        await tick();
        return n;
      },
      { signal: controller.signal },
    );
    assert.ok(started < items.length, `expected early stop, but started all ${started}`);
    // Unrun indices are left undefined.
    assert.ok(results.some((r) => r === undefined), "aborted run should leave holes");
  });

  it("handles an empty item list", async () => {
    const results = await mapWithConcurrency([], 4, async (x) => x);
    assert.deepStrictEqual(results, []);
  });

  it("degrades to serial for non-positive concurrency", async () => {
    let active = 0;
    let peak = 0;
    const items = [1, 2, 3];
    await mapWithConcurrency(items, 0, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await tick();
      active--;
      return n;
    });
    assert.strictEqual(peak, 1, "non-positive concurrency should run one at a time");
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
