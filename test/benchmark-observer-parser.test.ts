// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  ObserverSequenceError,
  captureProviderPayload,
  createRequestObserver,
  sanitiseProviderPayload,
  toolCatalogueSha256,
} from "../scripts/benchmarks/observer.js";
import { parseUsageEvents, tokensFromWireUsage } from "../scripts/benchmarks/usage-parser.js";
import type { Json } from "../scripts/benchmarks/contracts.js";
import { removeDir, scratchDir } from "../scripts/benchmarks/testing.js";

describe("payload sanitisation", () => {
  it("drops sensitive header-like keys anywhere in the payload", () => {
    const sanitised = sanitiseProviderPayload({
      model: "m",
      Authorization: "Bearer secret",
      messages: [{ role: "user", content: "hi", api_key: "sk-1" }],
    }) as { model: string; Authorization: unknown; messages: Array<Record<string, unknown>> };
    assert.equal(sanitised.model, "m");
    assert.deepEqual(sanitised.Authorization, { redacted: "sensitive-key" });
    assert.deepEqual(sanitised.messages[0]?.api_key, { redacted: "sensitive-key" });
    assert.equal(sanitised.messages[0]?.content, "hi");
  });

  it("bounds inline base64/image data with byte markers", () => {
    const big = "A".repeat(1024);
    const sanitised = sanitiseProviderPayload({ image: big, short: "AAA" }) as Record<string, unknown>;
    assert.deepEqual(sanitised.image, { redacted: "inline-bytes", bytes: 1024 });
    assert.equal(sanitised.short, "AAA");
  });

  it("keeps tool declarations exact and hashes them canonically", () => {
    const payload = sanitiseProviderPayload({
      tools: [{ name: "intelli_search", description: "b" }, { name: "bash", description: "a" }],
    });
    // Same array order, different key insertion order inside each tool:
    // canonical hashing is key-order insensitive.
    const other = sanitiseProviderPayload({
      tools: [{ description: "b", name: "intelli_search" }, { description: "a", name: "bash" }],
    });
    assert.equal(toolCatalogueSha256(payload), toolCatalogueSha256(other));
    // Array order is significant: catalogues are not silently sorted.
    const reordered = sanitiseProviderPayload({
      tools: [{ name: "bash", description: "a" }, { name: "intelli_search", description: "b" }],
    });
    assert.notEqual(toolCatalogueSha256(payload), toolCatalogueSha256(reordered));
    assert.notEqual(toolCatalogueSha256(payload), toolCatalogueSha256(sanitiseProviderPayload({})));
  });
});

describe("request observer", () => {
  it("buffers, flushes durably and reports completeness", async () => {
    const dir = await scratchDir("observer");
    try {
      const outPath = join(dir, "requests.ndjson");
      const observer = createRequestObserver({ outPath });
      assert.equal(observer.complete, true);
      const first = captureProviderPayload(observer, { model: "m", messages: [] }, "assistant-1");
      assert.equal(observer.complete, false);
      assert.equal(first.sequence, 1);
      captureProviderPayload(observer, { model: "m", messages: [], tools: [] }, "assistant-2");
      await observer.flush();
      assert.equal(observer.complete, true);
      const text = await readFile(outPath, "utf8");
      const lines = text.trim().split("\n");
      assert.equal(lines.length, 2);
      const parsed = JSON.parse(lines[0]!) as { sequence: number; assistantRequestId: string };
      assert.equal(parsed.sequence, 1);
      assert.equal(parsed.assistantRequestId, "assistant-1");
      // A further capture makes it incomplete again until flushed.
      captureProviderPayload(observer, { model: "m" }, "assistant-3");
      assert.equal(observer.complete, false);
      await observer.flush();
      assert.equal(observer.complete, true);
      assert.equal((await readFile(outPath, "utf8")).trim().split("\n").length, 3);
    } finally {
      await removeDir(dir);
    }
  });

  it("enforces strictly increasing capture sequences", async () => {
    const dir = await scratchDir("observer");
    try {
      const observer = createRequestObserver({ outPath: join(dir, "requests.ndjson") });
      captureProviderPayload(observer, { a: 1 }, "id-1");
      assert.throws(
        () =>
          observer.capture({
            sequence: 1,
            assistantRequestId: "id-1",
            payload: { a: 1 },
            payloadSha256: "0".repeat(64),
            toolCatalogueSha256: "0".repeat(64),
          }),
        ObserverSequenceError,
      );
    } finally {
      await removeDir(dir);
    }
  });

  it("never returns or applies a payload replacement", () => {
    const payload = { model: "m", messages: [{ role: "user", content: "x" }] };
    const sanitised = sanitiseProviderPayload(payload);
    // Sanitisation is evidence preparation: the original object is untouched.
    assert.deepEqual(payload.messages[0]?.content, "x");
    assert.equal(typeof sanitised, "object");
  });
});

function wireUsage(input: number, cacheRead: number, cacheWrite: number, output: number): Json {
  return { input, cacheRead, cacheWrite, output, totalTokens: input + cacheRead + cacheWrite + output } as Json;
}

describe("wire usage mapping", () => {
  it("maps pi-ai Usage into canonical totals with cached subsets separate", () => {
    const tokens = tokensFromWireUsage(wireUsage(300, 800, 100, 90));
    assert.equal(tokens?.inputTotal, 1200); // includes cached prompt tokens
    assert.equal(tokens?.inputUncached, 300);
    assert.equal(tokens?.outputTotal, 90);
    assert.equal(tokens?.cacheRead, 800);
    assert.equal(tokens?.cacheWrite, 100);
    assert.equal(tokens?.totalTokens, 1290); // preserved, not added to components
  });

  it("returns null for absent or non-object usage", () => {
    assert.equal(tokensFromWireUsage(undefined), null);
    assert.equal(tokensFromWireUsage("nope"), null);
    assert.equal(tokensFromWireUsage({}), null);
  });

  it("preserves the reasoning subset flag without adding a total", () => {
    const tokens = tokensFromWireUsage({ input: 10, output: 50, reasoning: 20 });
    assert.equal(tokens?.reasoning, 20);
    assert.equal(tokens?.outputTotal, 50);
  });
});

const assistantEnd = (usage: unknown, extra: Record<string, unknown> = {}): Json =>
  ({
    type: "message_end",
    message: { role: "assistant", content: [], provider: "openrouter", model: "sonar", timestamp: 1, usage: usage as Json, ...extra },
  }) as unknown as Json;

const toolEnd = (toolCallId: string, accounting: unknown, parent?: string): Json =>
  ({
    type: "tool_execution_end",
    toolCallId,
    toolName: "intelli_research",
    ...(parent !== undefined ? { parentToolCallId: parent } : {}),
    result: accounting === null ? { content: [] } : { content: [], structuredContent: { accounting: accounting as Json } },
    isError: false,
  }) as unknown as Json;

const accounting = (attempts: number): Json =>
  ({
  attempts,
  observedAttempts: attempts,
  missingAttempts: 0,
  tokens: { inputTotal: attempts * 100, outputTotal: attempts * 10 },
  reportedCost: { total: 0.001 * attempts },
  estimatedCost: { total: 0.001 * attempts },
  missingTokenFields: [],
  costComplete: true,
  parentDelivery: "available",
  }) as Json;

describe("parseUsageEvents canonical populations", () => {
  it("reads main usage only from assistant message_end events", () => {
    const events: Json[] = [
      { type: "session", version: 3, id: "s1" },
      { type: "turn_start", turnIndex: 0 },
      assistantEnd(wireUsage(100, 0, 0, 40)),
      {
        type: "turn_end",
        turnIndex: 0,
        message: { role: "assistant", content: [], provider: "openrouter", model: "sonar", timestamp: 1, usage: wireUsage(100, 0, 0, 40) },
        toolResults: [],
      },
      {
        type: "agent_end",
        messages: [{ role: "assistant", content: [], provider: "openrouter", model: "sonar", timestamp: 1, usage: wireUsage(100, 0, 0, 40) }],
      },
    ];
    const parsed = parseUsageEvents(events, "json");
    assert.equal(parsed.assistantMessages.length, 1); // turn_end/agent_end never repeat totals
    assert.equal(parsed.assistantMessages[0]?.usage?.inputUncached, 100);
    assert.equal(parsed.missing.length, 0);
  });

  it("counts pipeline usage once per canonical tool result, nested calls included", () => {
    const events: Json[] = [
      toolEnd("call_parent", accounting(1)),
      toolEnd("call_parent/1", accounting(2), "call_parent"),
      toolEnd("call_direct", accounting(3)),
    ];
    const parsed = parseUsageEvents(events, "json");
    assert.equal(parsed.toolMessages.length, 3);
    assert.equal(parsed.toolMessages[0]?.accounting?.attempts, 1);
    assert.equal(parsed.toolMessages[1]?.parentToolCallId, "call_parent");
    assert.equal(parsed.toolMessages[1]?.accounting?.attempts, 2);
    assert.equal(parsed.toolMessages[2]?.accounting?.attempts, 3);
    assert.equal(parsed.missing.length, 0);
  });

  it("deduplicates exact repeated message_end and tool_execution_end events", () => {
    const events: Json[] = [assistantEnd(wireUsage(5, 0, 0, 2)), assistantEnd(wireUsage(5, 0, 0, 2)), toolEnd("c1", accounting(1)), toolEnd("c1", accounting(1))];
    const parsed = parseUsageEvents(events, "json");
    assert.equal(parsed.assistantMessages.length, 1);
    assert.equal(parsed.toolMessages.length, 1);
  });

  it("preserves missing, failed and unknown observations", () => {
    const events: Json[] = [
      assistantEnd(undefined), // missing usage
      { type: "message_end", message: { role: "assistant", content: [], provider: "p", model: "m", timestamp: 2, stopReason: "error", errorMessage: "boom" } },
      toolEnd("no-accounting", null),
      { type: "tool_execution_end", toolCallId: "legacy", toolName: "intelli_search", result: { content: [], details: { intelli: { accounting: accounting(7) } } }, isError: false },
    ];
    const parsed = parseUsageEvents(events, "json");
    assert.equal(parsed.assistantMessages.length, 2);
    assert.equal(parsed.assistantMessages[0]?.usage, null);
    assert.equal(parsed.assistantMessages[1]?.usage, null);
    assert.equal(parsed.toolMessages.length, 2);
    assert.equal(parsed.toolMessages[0]?.accounting, null);
    assert.equal(parsed.toolMessages[1]?.accounting?.attempts, 7); // legacy details.intelli shape
    assert.deepEqual(parsed.missing, [parsed.assistantMessages[0]?.id, parsed.assistantMessages[1]?.id, "no-accounting"]);
  });

  it("skips RPC envelope records in rpc mode and headers in json mode", () => {
    const core: Json[] = [assistantEnd(wireUsage(1, 0, 0, 1)), toolEnd("c1", accounting(1))];
    const rpc = parseUsageEvents(
      [{ type: "response", id: "r1", command: "get_state", success: true } as Json, ...core],
      "rpc",
    );
    assert.equal(rpc.assistantMessages.length, 1);
    assert.equal(rpc.toolMessages.length, 1);
    const json = parseUsageEvents([{ type: "session", version: 3 } as Json, ...core], "json");
    assert.equal(json.assistantMessages.length, 1);
    // The same header is unknown noise in rpc mode but skipped in json mode.
    const rpcHeader = parseUsageEvents([{ type: "session" } as Json, ...core], "rpc");
    assert.equal(rpcHeader.assistantMessages.length, 1);
  });

  it("ignores tool executions without a usable id and non-object events", () => {
    const parsed = parseUsageEvents(
      [{ type: "tool_execution_end", toolCallId: "", result: {} } as Json, "not-an-event", null],
      "json",
    );
    assert.equal(parsed.toolMessages.length, 0);
  });

  it("distinguishes distinct assistant messages that share a responseId-free identity", () => {
    const events: Json[] = [
      assistantEnd(wireUsage(1, 0, 0, 1)),
      assistantEnd(wireUsage(2, 0, 0, 2)), // same provider/model@timestamp: distinct content usage
    ];
    const parsed = parseUsageEvents(events, "json");
    assert.equal(parsed.assistantMessages.length, 2);
    assert.notEqual(parsed.assistantMessages[0]?.id, parsed.assistantMessages[1]?.id);
  });
});
