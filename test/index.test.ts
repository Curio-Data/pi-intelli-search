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
      "intelli_collate",
      "intelli_extract",
      "intelli_research",
      "intelli_search",
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
    const sessionStartCount = recordedEvents.filter((e) => e === "session_start").length;
    assert.ok(sessionStartCount >= 1, "should have at least one session_start handler");
  });

  it("subscribes to after_provider_response for rate-limit monitoring", async () => {
    const recordedEvents: string[] = [];

    const mockPi = {
      registerTool() {},
      on(event: string) {
        recordedEvents.push(event);
      },
    };

    const mod = await import("../src/index.js");
    mod.default(mockPi);

    assert.ok(
      recordedEvents.includes("after_provider_response"),
      "should subscribe to after_provider_response",
    );
  });

  it("subscribes to tool_execution_start/end for working indicator", async () => {
    const recordedEvents: string[] = [];

    const mockPi = {
      registerTool() {},
      on(event: string) {
        recordedEvents.push(event);
      },
    };

    const mod = await import("../src/index.js");
    mod.default(mockPi);

    assert.ok(
      recordedEvents.includes("tool_execution_start"),
      "should subscribe to tool_execution_start",
    );
    assert.ok(
      recordedEvents.includes("tool_execution_end"),
      "should subscribe to tool_execution_end",
    );
  });
});

describe("after_provider_response handler", () => {
  it("shows rate-limit status on 429 and clears on success", async () => {
    const statuses: Map<string, string | undefined> = new Map();
    let handler: Function | undefined;

    const mockPi = {
      registerTool() {},
      on(event: string, h: Function) {
        if (event === "after_provider_response") handler = h;
      },
    };

    const mod = await import("../src/index.js");
    mod.default(mockPi);

    assert.ok(handler, "handler should be registered");

    const mockCtx = {
      ui: {
        setStatus(key: string, text: string | undefined) {
          if (text === undefined) statuses.delete(key);
          else statuses.set(key, text);
        },
      },
    };

    // 429 should set rate-limit status
    handler!({ status: 429, headers: { "retry-after": "5" } }, mockCtx);
    assert.ok(statuses.has("pi-intelli-search:ratelimit"), "should set rate-limit status");
    assert.ok(
      statuses.get("pi-intelli-search:ratelimit")!.includes("5"),
      "should include retry-after value",
    );

    // 200 should clear rate-limit status
    handler!({ status: 200, headers: {} }, mockCtx);
    assert.ok(!statuses.has("pi-intelli-search:ratelimit"), "should clear rate-limit status on success");
  });

  it("debounces 429 notifications (only one per 30s)", async () => {
    const setStatusCalls: Array<[string, string | undefined]> = [];
    let handler: Function | undefined;

    const mockPi = {
      registerTool() {},
      on(event: string, h: Function) {
        if (event === "after_provider_response") handler = h;
      },
    };

    const mod = await import("../src/index.js");
    mod.default(mockPi);

    const mockCtx = {
      ui: {
        setStatus(key: string, text: string | undefined) {
          setStatusCalls.push([key, text]);
        },
      },
    };

    // Two rapid 429s — only first should set status
    handler!({ status: 429, headers: {} }, mockCtx);
    handler!({ status: 429, headers: {} }, mockCtx);

    const setCalls = setStatusCalls.filter(
      ([key, text]) => key === "pi-intelli-search:ratelimit" && text !== undefined,
    );
    assert.strictEqual(setCalls.length, 1, "should debounce rapid 429s");
  });
});
