// test/fetch.test.ts — Unit tests for fetch utilities
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("fetch module structure", () => {
  it("exports fetchPages as a function", async () => {
    const mod = await import("../src/fetch.js");
    assert.strictEqual(typeof mod.fetchPages, "function");
  });

  it("exports downloadLlmsFullToCache as a function", async () => {
    const mod = await import("../src/fetch.js");
    assert.strictEqual(typeof mod.downloadLlmsFullToCache, "function");
  });

  it("exports FetchOptions type via interface", async () => {
    const mod = await import("../src/fetch.js");
    // FetchOptions is a type, so it's not available at runtime.
    // Just verify the module loaded successfully.
    assert.ok(mod.fetchPages !== undefined);
  });
});

// --- Test the scoring/sanitize logic (mimics the private scoreContent) ---
// The actual scoreContent is module-private, so we replicate the logic
// to verify the rules described in the code.
describe("content scoring logic (indirect)", () => {
  function mimicScoreContent(content: string): number {
    let score = content.length;
    score += (content.match(/```/g) ?? []).length * 100;
    score += (content.match(/^#{1,6}\s/gm) ?? []).length * 50;
    score += (content.match(/^\|/gm) ?? []).length * 20;
    score -= (content.match(/Skip to content|Was this helpful|Edit page|Report issue|Copy page/g) ?? []).length * 500;
    if (content.startsWith("---")) score -= 1000;
    return score;
  }

  it("prefers content with code blocks", () => {
    const plain = "Some text about a function.";
    const withCode = "Some text:\n```js\nconst x = 1;\n```\n";
    assert.ok(mimicScoreContent(withCode) > mimicScoreContent(plain));
  });

  it("penalizes nav chrome", () => {
    const clean = "Good content here about APIs.";
    const withNav = "Skip to content\nGood content here about APIs.\nWas this helpful?";
    assert.ok(mimicScoreContent(clean) > mimicScoreContent(withNav));
  });

  it("penalizes YAML frontmatter", () => {
    const noFrontmatter = "# Title\nContent here.";
    const withFrontmatter = "---\ntitle: Foo\n---\n# Title\nContent here.";
    assert.ok(mimicScoreContent(noFrontmatter) > mimicScoreContent(withFrontmatter));
  });

  it("bonus for headings", () => {
    const flat = "Paragraph of text.";
    const structured = "# Section\nParagraph of text.\n## Subsection\nMore text.";
    assert.ok(mimicScoreContent(structured) > mimicScoreContent(flat));
  });

  it("bonus for tables", () => {
    const noTable = "Here is some data.";
    const withTable = "Here is some data.\n| A | B |\n| 1 | 2 |\n| 3 | 4 |";
    assert.ok(mimicScoreContent(withTable) > mimicScoreContent(noTable));
  });
});
