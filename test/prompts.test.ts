// test/prompts.test.ts — Snapshot tests for prompt templates
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EXTRACTION_SYSTEM_PROMPT, COLLATION_SYSTEM_PROMPT } from "../src/prompts.js";

describe("EXTRACTION_SYSTEM_PROMPT", () => {
  it("is a non-empty string", () => {
    assert.ok(typeof EXTRACTION_SYSTEM_PROMPT === "string");
    assert.ok(EXTRACTION_SYSTEM_PROMPT.length > 100);
  });

  it("mentions key extraction rules", () => {
    const p = EXTRACTION_SYSTEM_PROMPT;
    assert.ok(p.includes("code blocks"), "should mention code blocks");
    assert.ok(p.includes("API"), "should mention API");
    assert.ok(p.includes("version"), "should mention version");
    assert.ok(p.includes("official doc"), "should mention official docs");
    assert.ok(p.includes("blog"), "should mention blog posts");
    assert.ok(p.includes("forum"), "should mention forums");
    assert.ok(p.includes("3,000"), "should specify output length target");
  });

  it("includes source type adaptation instructions", () => {
    assert.ok(EXTRACTION_SYSTEM_PROMPT.includes("Adapt extraction to the source type"));
  });
});

describe("COLLATION_SYSTEM_PROMPT", () => {
  it("is a non-empty string", () => {
    assert.ok(typeof COLLATION_SYSTEM_PROMPT === "string");
    assert.ok(COLLATION_SYSTEM_PROMPT.length > 100);
  });

  it("mentions key collation rules", () => {
    const p = COLLATION_SYSTEM_PROMPT;
    assert.ok(p.includes("dedup"), "should mention deduplication");
    assert.ok(p.includes("priority"), "should mention source priority");
    assert.ok(p.includes("official doc"), "should reference official docs priority");
    assert.ok(p.includes("contradiction"), "should mention contradiction handling");
  });

  it("requires Summary and Source assessment sections", () => {
    assert.ok(COLLATION_SYSTEM_PROMPT.includes("## Summary"));
    assert.ok(COLLATION_SYSTEM_PROMPT.includes("## Source assessment"));
  });
});

// Snapshot: store the current prompt lengths so we detect accidental changes.
// If prompts are intentionally modified, update these values.
describe("prompt snapshots (length)", () => {
  it("EXTRACTION_SYSTEM_PROMPT length is stable", () => {
    // If this fails, the prompt was modified — update if intentional
    assert.ok(
      EXTRACTION_SYSTEM_PROMPT.length > 1000 && EXTRACTION_SYSTEM_PROMPT.length < 2000,
      `Extraction prompt length ${EXTRACTION_SYSTEM_PROMPT.length} outside expected range 1000-2000`,
    );
  });

  it("COLLATION_SYSTEM_PROMPT length is stable", () => {
    assert.ok(
      COLLATION_SYSTEM_PROMPT.length > 800 && COLLATION_SYSTEM_PROMPT.length < 1800,
      `Collation prompt length ${COLLATION_SYSTEM_PROMPT.length} outside expected range 800-1800`,
    );
  });
});
