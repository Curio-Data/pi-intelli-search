// test/util.test.ts — Unit tests for shared utilities
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { textContent, getAgentDir } from "../src/util.js";

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
