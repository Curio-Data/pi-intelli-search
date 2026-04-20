// test/index.test.ts — Unit tests for extension entry point
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("extension module structure", () => {
  it("exports a default function", async () => {
    const mod = await import("../src/index.js");
    assert.strictEqual(typeof mod.default, "function");
  });
});

describe("extension registration", () => {
  it("registers all 4 tools", async () => {
    const recordedTools: string[] = [];

    const mockPi = {
      registerTool(tool: any) {
        recordedTools.push(tool.name);
      },
      on() {},
    };

    const mod = await import("../src/index.js");
    mod.default(mockPi);

    assert.deepStrictEqual(recordedTools.sort(), [
      "web_collate",
      "web_extract",
      "web_research",
      "web_search",
    ]);
  });

  it("subscribes to session_start for model registration and settings invalidation", async () => {
    const recordedEvents: string[] = [];

    const mockPi = {
      registerTool() {},
      on(event: string) {
        recordedEvents.push(event);
      },
    };

    const mod = await import("../src/index.js");
    mod.default(mockPi);

    assert.ok(recordedEvents.includes("session_start"), "should subscribe to session_start");
    // session_start is subscribed once (handlers are additive, so we just check it's present)
    const sessionStartCount = recordedEvents.filter((e) => e === "session_start").length;
    assert.ok(sessionStartCount >= 1, "should have at least one session_start handler");
  });
});
