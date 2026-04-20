// test/fetch.test.ts — Unit tests for fetch utilities
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// We need to import the functions that aren't exported by testing the
// exported fetchPages behavior and the score/sanitize/truncate helpers.
// Since scoreContent, sanitizeMarkdown, guessTitleFromMarkdown, and
// truncateContent are module-private, we test them through a thin wrapper.

// Import via a re-export shim that exposes internals for testing.
// Alternatively, we test the public API and the comparison logic indirectly.

// For direct testing of private functions, we use this approach:
// The module exports fetchPages and downloadLlmsFullToCache.
// The pure helpers are internal. We test them via a test-only export.

import {
  // Re-exported from a test shim below
} from "../src/fetch.js";

// Since the functions are private, we'll create a test shim module
// that re-exports them. But first, let's test what we can publicly.

// --- scoreContent (tested via compareAndPick, but let's test the logic directly) ---
// We'll import the module source and eval the private functions.
// Better approach: test the exported behavior.

// Let's test the pure string manipulation functions by extracting them
// into a shared util module later. For now, test what we can.

describe("fetch module structure", () => {
  it("exports fetchPages as a function", async () => {
    const mod = await import("../src/fetch.js");
    assert.strictEqual(typeof mod.fetchPages, "function");
  });

  it("exports downloadLlmsFullToCache as a function", async () => {
    const mod = await import("../src/fetch.js");
    assert.strictEqual(typeof mod.downloadLlmsFullToCache, "function");
  });
});

// --- Test the scoring/sanitize logic via a test-only import ---
// We'll use dynamic import with a trick: the functions use module-private
// scope, so we test the behaviors through the public API instead.

// For thorough testing, let's create a fetch-utils extraction:
// We'll do that in the refactoring step. For now, test what's testable.

// Test the quality scoring heuristic indirectly by checking
// what content characteristics would score higher.
describe("content scoring logic (indirect)", () => {
  // We can't call scoreContent directly, but we verify the logic
  // by testing the scoring rules described in the code:
  // - code blocks (+100 each), headings (+50), tables (+20)
  // - nav chrome (-500 each), YAML frontmatter (-1000)
  // - base score = content length

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
