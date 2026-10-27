// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, it } from "node:test";
import { asJson, canonicalJson } from "../scripts/benchmarks/canonical.js";
import {
  createMainUsageEvidenceCollector,
  mainUsageEvidenceV2Json,
  readMainUsageEvidenceV2,
  tokensFromWireEvidence,
  wireMainUsageEvidence,
  type MainUsageEvidenceV2Record,
  type ProviderStreamEventLike,
} from "../scripts/benchmarks/main-usage-evidence.js";
import { mainUsageEvidence, parseUsageEvents } from "../scripts/benchmarks/usage-parser.js";
import type { Json } from "../scripts/benchmarks/contracts.js";

// Wire fixtures model the actual installed SDK shapes, Observed in the
// bundled pi-ai (byte-identical between the installed Pi 1.3.0 host's pi-ai
// 1.3.0 and this worktree's dev pi-ai 1.1.0) on 2026-10-26:
//
// - openai-completions: every parsed ChatCompletionChunk reaches the
//   `provider_stream_event` handler (`for await (const chunk of openaiStream)
//   { await options?.onProviderStreamEvent?.(chunk, model); ... }`); the
//   message `responseId` is the first chunk id (`output.responseId ||=
//   chunk.id`); usage sits on `chunk.usage` (null on non-final chunks) with a
//   `choices[0].usage` fallback, and later usage chunks overwrite earlier
//   ones. Source: dist/api/openai-completions.js.
// - responses family (openai-responses, azure-openai-responses,
//   openai-codex-responses): every raw event reaches the handler
//   (`processResponsesStream`: `await options?.onProviderStreamEvent?.(event,
//   model)`; the codex api replays its mapped events through the same hook in
//   `mapCodexEvents`); `response.created` sets the message responseId and
//   terminal `response.completed`/`failed`/`incomplete` events carry
//   `response.usage`. Source: dist/api/openai-responses-shared.js,
//   dist/api/openai-codex-responses.js.
//
// These are structural SDK-shape fixtures, not live captures: live SSE
// ordering, codex WebSocket delivery and cache-warm interleaving on a real
// host remain unqualified until the granted targeted lane runs.

const PROVIDER = "openrouter";
const COMPLETIONS_API = "openai-completions";

const streamEvent = (data: unknown, api = COMPLETIONS_API, model = "main-m"): ProviderStreamEventLike =>
  ({ type: "provider_stream_event", provider: PROVIDER, api, model, data }) as ProviderStreamEventLike;

/** OpenAI Completions chunk, non-final (usage null, carries a delta). */
function deltaChunk(id: string, text = "x"): Json {
  return asJson({ id, object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: text }, finish_reason: null }], usage: null });
}

/** OpenAI Completions final chunk with the standard usage object. */
function usageChunk(id: string, usage: Record<string, unknown>): Json {
  return asJson({ id, object: "chat.completion.chunk", choices: [], usage });
}

const messageEnd = (message: unknown): { type: "message_end"; message: unknown } => ({
  type: "message_end",
  message,
});

function assistantMessage(responseId: string | undefined, usage: unknown): Record<string, unknown> {
  return {
    role: "assistant",
    content: [{ type: "text", text: "answer" }],
    api: COMPLETIONS_API,
    provider: PROVIDER,
    model: "main-m",
    ...(responseId !== undefined ? { responseId } : {}),
    timestamp: 1,
    usage,
    stopReason: "stop",
  };
}

/** Full SDK-normalised usage (pi-ai zero placeholders for absent wire fields). */
const sdkUsage = (input: number, output: number, cacheRead = 0, cacheWrite = 0): Json =>
  asJson({ input, output, cacheRead, cacheWrite, totalTokens: input + output + cacheRead + cacheWrite });

describe("collector correlation through host-shaped events", () => {
  it("records per-field wire presence for a correlated completions message", () => {
    const collector = createMainUsageEvidenceCollector();
    collector.onBeforeProviderRequest({ type: "before_provider_request", payload: { model: "main-m", messages: [] } });
    collector.onProviderStreamEvent(streamEvent(deltaChunk("resp_1")));
    collector.onProviderStreamEvent(
      streamEvent(
        usageChunk("resp_1", {
          prompt_tokens: 1200,
          prompt_tokens_details: { cached_tokens: 800, cache_write_tokens: 100 },
          completion_tokens: 90,
          completion_tokens_details: { reasoning_tokens: 20 },
          total_tokens: 1290,
          cost: 0.05,
        }),
      ),
    );
    const message = assistantMessage("resp_1", sdkUsage(300, 90, 800, 100));
    collector.onMessageEnd(messageEnd(message));
    const records = collector.records;
    assert.equal(records.length, 1);
    const record = records[0]!;
    assert.equal(record.correlation, "response-id");
    assert.equal(record.responseId, "resp_1");
    assert.equal(record.usageObserved, true);
    assert.equal(record.usageSource, "chunk-usage");
    assert.equal(record.ambiguous, false);
    assert.equal(record.wireCostTotal, 0.05);
    assert.equal(record.requestWindows, 1);
    assert.deepEqual(record.fields, {
      inputTokens: 1200,
      cachedTokens: 800,
      cacheWriteTokens: 100,
      outputTokens: 90,
      reasoningTokens: 20,
      totalTokens: 1290,
    });
    assert.equal(record.messageSha256.length, 64);
    // Parser: wire fields replace the SDK candidate, explicit wire values kept.
    const parsed = parseUsageEvents(
      [asJson(messageEnd(message)), mainUsageEvidenceV2Json(record)],
      "json",
    );
    assert.deepEqual(parsed.assistantMessages[0]!.usage, {
      inputTotal: 1200,
      inputUncached: 300, // max(0, 1200 - 800 - 100), pi-ai arithmetic
      outputTotal: 90,
      cacheRead: 800,
      cacheWrite: 100,
      reasoning: 20,
      totalTokens: 1290, // completions total is derived and matches the wire here
    });
    assert.deepEqual(parsed.missing, []);
  });

  it("keeps an all-zero wire usage as values, not an ambiguous SDK placeholder", () => {
    const collector = createMainUsageEvidenceCollector();
    collector.onProviderStreamEvent(streamEvent(usageChunk("resp_0", { prompt_tokens: 0, completion_tokens: 0 })));
    const message = assistantMessage("resp_0", sdkUsage(0, 0));
    collector.onMessageEnd(messageEnd(message));
    const record = collector.records[0]!;
    assert.equal(record.usageObserved, true);
    assert.deepEqual(record.fields, {
      inputTokens: 0,
      cachedTokens: null,
      cacheWriteTokens: null,
      outputTokens: 0,
      reasoningTokens: null,
      totalTokens: null,
    });
    const parsed = parseUsageEvents([asJson(messageEnd(message)), mainUsageEvidenceV2Json(record)], "json");
    // Explicit wire zeros survive; absent cache subsets stay absent (unknown).
    assert.deepEqual(parsed.assistantMessages[0]!.usage, {
      inputTotal: 0,
      outputTotal: 0,
    });
    assert.deepEqual(parsed.missing, []);
  });

  it("preserves partial wire fields: absent prompt keeps uncached input unknown", () => {
    const collector = createMainUsageEvidenceCollector();
    collector.onProviderStreamEvent(streamEvent(usageChunk("resp_p", { completion_tokens: 40 })));
    collector.onMessageEnd(messageEnd(assistantMessage("resp_p", sdkUsage(0, 40))));
    const record = collector.records[0]!;
    const parsed = parseUsageEvents([asJson(messageEnd(assistantMessage("resp_p", sdkUsage(0, 40)))), mainUsageEvidenceV2Json(record)], "json");
    const usage = parsed.assistantMessages[0]!.usage!;
    assert.equal("inputUncached" in usage, false);
    assert.equal("inputTotal" in usage, false);
    assert.equal(usage.outputTotal, 40);
    assert.equal("totalTokens" in usage, false); // a known output subtotal is not a complete token total
  });

  it("never derives uncached input from absent cache subsets on either API family", () => {
    for (const api of ["openai-completions", "openai-codex-responses"]) {
      for (const [cachedTokens, cacheWriteTokens] of [[null, null], [0, null], [null, 0], [0, 0]] as const) {
        const record = v2Record("a".repeat(64), "partial-cache", true, api,
          api === "openai-completions" ? "chunk-usage" : "response-usage",
          { inputTokens: 100, cachedTokens, cacheWriteTokens, outputTokens: 5, reasoningTokens: null, totalTokens: 105 });
        const usage = tokensFromWireEvidence(record)!;
        assert.equal(usage.inputTotal, 100);
        assert.equal(usage.totalTokens, 105);
        assert.equal(Object.hasOwn(usage, "inputUncached"), cachedTokens !== null && cacheWriteTokens !== null);
        if (cachedTokens !== null && cacheWriteTokens !== null) assert.equal(usage.inputUncached, 100);
      }
    }
  });

  it("does not label component arithmetic as a provider-reported total", () => {
    const record = v2Record("a".repeat(64), "no-total", true, "openai-completions", "chunk-usage",
      { inputTokens: 100, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 5, reasoningTokens: null, totalTokens: null });
    assert.deepEqual(tokensFromWireEvidence(record), { inputTotal: 100, inputUncached: 100, outputTotal: 5, cacheRead: 0, cacheWrite: 0 });
  });

  it("latest cumulative usage removes earlier fields that become absent", () => {
    const collector = createMainUsageEvidenceCollector();
    collector.onProviderStreamEvent(streamEvent(usageChunk("latest", {
      prompt_tokens: 100, completion_tokens: 5,
      prompt_tokens_details: { cached_tokens: 20, cache_write_tokens: 0 }, cost: 0.1,
    })));
    collector.onProviderStreamEvent(streamEvent(usageChunk("latest", { completion_tokens: 7 })));
    collector.onMessageEnd(messageEnd(assistantMessage("latest", sdkUsage(0, 7))));
    const record = collector.records[0]!;
    assert.equal(record.fields!.inputTokens, null);
    assert.equal(record.fields!.cachedTokens, null);
    assert.equal(record.wireCostTotal, null);
    assert.deepEqual(tokensFromWireEvidence(record), { outputTotal: 7 });
  });

  it("reports a correlated response id that completed without any usage object", () => {
    const collector = createMainUsageEvidenceCollector();
    collector.onProviderStreamEvent(streamEvent(deltaChunk("resp_none")));
    const message = assistantMessage("resp_none", sdkUsage(0, 0));
    collector.onMessageEnd(messageEnd(message));
    const record = collector.records[0]!;
    assert.equal(record.correlation, "response-id");
    assert.equal(record.usageObserved, false);
    assert.equal(record.fields, null);
    const parsed = parseUsageEvents([asJson(messageEnd(message)), mainUsageEvidenceV2Json(record)], "json");
    assert.equal(parsed.assistantMessages[0]!.usage, null);
    assert.deepEqual(parsed.missing, ["resp_none"]);
  });

  it("makes no claim when the message carries no responseId or the wire id was never seen", () => {
    const collector = createMainUsageEvidenceCollector();
    collector.onMessageEnd(messageEnd(assistantMessage(undefined, sdkUsage(5, 5))));
    collector.onMessageEnd(messageEnd(assistantMessage("never_seen", sdkUsage(0, 0))));
    const records = collector.records;
    assert.equal(records.length, 2);
    for (const record of records) {
      assert.equal(record.correlation, "none");
      assert.equal(record.usageObserved, null);
      assert.equal(record.fields, null);
    }
    // Parser: no v2 claim leaves the v1/SDK path intact (all-zero stays missing).
    const noId = assistantMessage(undefined, sdkUsage(5, 5));
    const zero = assistantMessage("never_seen", sdkUsage(0, 0));
    const parsed = parseUsageEvents(
      [asJson(messageEnd(noId)), asJson(messageEnd(zero)), ...records.map(mainUsageEvidenceV2Json)],
      "json",
    );
    assert.equal(parsed.assistantMessages[0]!.usage!.inputUncached, 5); // non-zero SDK values kept
    assert.equal(parsed.assistantMessages[1]!.usage, null); // all-zero SDK without a witness
  });

  it("isolates cache-warm and failed-attempt streams from main usage", () => {
    const collector = createMainUsageEvidenceCollector();
    // Warm call: request window and a usage-bearing stream that never finalises a message.
    collector.onBeforeProviderRequest({ type: "before_provider_request", payload: { model: "main-m", max_tokens: 1 } });
    collector.onProviderStreamEvent(streamEvent(usageChunk("warm_1", { prompt_tokens: 1100, completion_tokens: 1 })));
    // Main turn: a failed attempt (usage delivered, stream then errored) and the successful retry.
    collector.onBeforeProviderRequest({ type: "before_provider_request", payload: { model: "main-m" } });
    collector.onProviderStreamEvent(streamEvent(usageChunk("resp_err", { prompt_tokens: 900, completion_tokens: 2 })));
    collector.onProviderStreamEvent(streamEvent(deltaChunk("resp_ok")));
    collector.onProviderStreamEvent(streamEvent(usageChunk("resp_ok", { prompt_tokens: 950, completion_tokens: 30 })));
    const message = assistantMessage("resp_ok", sdkUsage(950, 30));
    collector.onMessageEnd(messageEnd(message));
    const record = collector.records[0]!;
    assert.equal(record.responseId, "resp_ok");
    assert.deepEqual(record.uncorrelatedResponseIds, ["warm_1", "resp_err"]);
    assert.equal(record.uncorrelatedCount, 2);
    // Main usage comes only from the correlated response id.
    const parsed = parseUsageEvents([asJson(messageEnd(message)), mainUsageEvidenceV2Json(record)], "json");
    assert.equal(parsed.assistantMessages[0]!.usage!.inputTotal, 950);
    assert.equal(parsed.assistantMessages[0]!.usage!.outputTotal, 30);
    assert.deepEqual(collector.diagnostics.uncorrelatedResponseIds, ["warm_1", "resp_err"]);
  });

  it("marks id-less usage chunks ambiguous instead of guessing their response", () => {
    const collector = createMainUsageEvidenceCollector();
    collector.onProviderStreamEvent(streamEvent(deltaChunk("resp_a")));
    collector.onProviderStreamEvent(streamEvent(usageChunk("", { prompt_tokens: 100, completion_tokens: 5 }))); // no id
    const message = assistantMessage("resp_a", sdkUsage(0, 0));
    collector.onMessageEnd(messageEnd(message));
    const record = collector.records[0]!;
    assert.equal(record.correlation, "response-id");
    assert.equal(record.ambiguous, true);
    assert.equal(record.usageObserved, null); // no claim
    assert.equal(record.fields, null);
    // Parser: an ambiguous record leaves the SDK path (all-zero stays missing).
    const parsed = parseUsageEvents([asJson(messageEnd(message)), mainUsageEvidenceV2Json(record)], "json");
    assert.equal(parsed.assistantMessages[0]!.usage, null);
  });

  it("fails closed on both messages when one response id finalises two distinct messages", () => {
    const collector = createMainUsageEvidenceCollector();
    collector.onProviderStreamEvent(streamEvent(usageChunk("shared", { prompt_tokens: 100, completion_tokens: 5 })));
    const first = assistantMessage("shared", sdkUsage(100, 5));
    (first.content as Array<Record<string, unknown>>)[0]!.text = "first";
    collector.onMessageEnd(messageEnd(first));
    const second = assistantMessage("shared", sdkUsage(0, 0));
    (second.content as Array<Record<string, unknown>>)[0]!.text = "second";
    second.timestamp = 2;
    collector.onMessageEnd(messageEnd(second));
    const records = collector.records;
    assert.equal(records.length, 3); // first claim, conflict marker for first, ambiguous second
    const parsed = parseUsageEvents(
      [asJson(messageEnd(first)), asJson(messageEnd(second)), ...records.map(mainUsageEvidenceV2Json)],
      "json",
    );
    // The first message's claiming record and conflict marker disagree: fold -> conflict -> null.
    assert.equal(parsed.assistantMessages[0]!.usage, null);
    // The second message gets an ambiguous no-claim record: SDK path, all-zero -> missing.
    assert.equal(parsed.assistantMessages[1]!.usage, null);
  });

  it("ignores exact duplicate finalisations of the same message", () => {
    const collector = createMainUsageEvidenceCollector();
    collector.onProviderStreamEvent(streamEvent(usageChunk("resp_d", { prompt_tokens: 10, completion_tokens: 1 })));
    const message = assistantMessage("resp_d", sdkUsage(10, 1));
    collector.onMessageEnd(messageEnd(message));
    collector.onMessageEnd(messageEnd(message));
    assert.equal(collector.records.length, 1);
  });

  it("extracts the Moonshot-style choice-usage fallback", () => {
    const collector = createMainUsageEvidenceCollector();
    collector.onProviderStreamEvent(
      streamEvent(
        asJson({ id: "resp_m", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop", usage: { prompt_tokens: 50, completion_tokens: 5 } }], usage: null }),
      ),
    );
    collector.onMessageEnd(messageEnd(assistantMessage("resp_m", sdkUsage(50, 5))));
    const record = collector.records[0]!;
    assert.equal(record.usageSource, "choice-usage");
    assert.equal(record.fields!.inputTokens, 50);
    assert.equal(record.fields!.outputTokens, 5);
  });

  it("follows the cached-token spelling precedence observed in pi-ai", () => {
    const collector = createMainUsageEvidenceCollector();
    // details.cached_tokens wins even when prompt_cache_hit_tokens is also present.
    collector.onProviderStreamEvent(
      streamEvent(usageChunk("resp_c", { prompt_tokens: 200, prompt_tokens_details: { cached_tokens: 40 }, prompt_cache_hit_tokens: 60, completion_tokens: 5 })),
    );
    collector.onMessageEnd(messageEnd(assistantMessage("resp_c", sdkUsage(160, 5, 40))));
    const record = collector.records[0]!;
    assert.equal(record.fields!.cachedTokens, 40);
    // Without the details spelling, prompt_cache_hit_tokens is read; then cached_tokens.
    const collector2 = createMainUsageEvidenceCollector();
    collector2.onProviderStreamEvent(streamEvent(usageChunk("resp_c2", { prompt_tokens: 200, prompt_cache_hit_tokens: 70, cached_tokens: 90, completion_tokens: 5 })));
    collector2.onMessageEnd(messageEnd(assistantMessage("resp_c2", sdkUsage(130, 5, 70))));
    assert.equal(collector2.records[0]!.fields!.cachedTokens, 70);
    const collector3 = createMainUsageEvidenceCollector();
    collector3.onProviderStreamEvent(streamEvent(usageChunk("resp_c3", { prompt_tokens: 200, cached_tokens: 90, completion_tokens: 5 })));
    collector3.onMessageEnd(messageEnd(assistantMessage("resp_c3", sdkUsage(110, 5, 90))));
    assert.equal(collector3.records[0]!.fields!.cachedTokens, 90);
  });

  it("keeps later usage chunks overwriting earlier ones, mirroring pi-ai", () => {
    const collector = createMainUsageEvidenceCollector();
    collector.onProviderStreamEvent(streamEvent(usageChunk("resp_w", { prompt_tokens: 100, completion_tokens: 5 })));
    collector.onProviderStreamEvent(streamEvent(usageChunk("resp_w", { prompt_tokens: 150, completion_tokens: 6 })));
    collector.onMessageEnd(messageEnd(assistantMessage("resp_w", sdkUsage(150, 6))));
    const fields = collector.records[0]!.fields!;
    assert.equal(fields.inputTokens, 150);
    assert.equal(fields.outputTokens, 6);
  });
});

describe("responses-family wire shapes", () => {
  const responsesEvent = (data: unknown): ProviderStreamEventLike =>
    streamEvent(data, "openai-codex-responses");

  it("correlates response.created id with response.completed usage", () => {
    const collector = createMainUsageEvidenceCollector();
    collector.onProviderStreamEvent(responsesEvent(asJson({ type: "response.created", response: { id: "resp_9" } })));
    collector.onProviderStreamEvent(responsesEvent(asJson({ type: "response.output_text.delta", delta: "hi" })));
    collector.onProviderStreamEvent(
      responsesEvent(
        asJson({
          type: "response.completed",
          response: {
            id: "resp_9",
            usage: {
              input_tokens: 500,
              input_tokens_details: { cached_tokens: 200, cache_write_tokens: 50 },
              output_tokens: 40,
              output_tokens_details: { reasoning_tokens: 5 },
              total_tokens: 790,
            },
          },
        }),
      ),
    );
    const message = assistantMessage("resp_9", sdkUsage(250, 40, 200, 50));
    (message as Record<string, unknown>).api = "openai-codex-responses";
    collector.onMessageEnd(messageEnd(message));
    const record = collector.records[0]!;
    assert.equal(record.usageSource, "response-usage");
    assert.deepEqual(record.fields, {
      inputTokens: 500,
      cachedTokens: 200,
      cacheWriteTokens: 50,
      outputTokens: 40,
      reasoningTokens: 5,
      totalTokens: 790,
    });
    const parsed = parseUsageEvents([asJson(messageEnd(message)), mainUsageEvidenceV2Json(record)], "json");
    assert.deepEqual(parsed.assistantMessages[0]!.usage, {
      inputTotal: 500,
      inputUncached: 250, // max(0, 500 - 200 - 50)
      outputTotal: 40,
      cacheRead: 200,
      cacheWrite: 50,
      reasoning: 5,
      totalTokens: 790, // responses family keeps the wire total
    });
  });

  it("keeps usage observed on a response.failed terminal event", () => {
    const collector = createMainUsageEvidenceCollector();
    collector.onProviderStreamEvent(responsesEvent(asJson({ type: "response.created", response: { id: "resp_f" } })));
    collector.onProviderStreamEvent(
      responsesEvent(asJson({ type: "response.failed", response: { id: "resp_f", usage: { input_tokens: 20, output_tokens: 3 } } })),
    );
    const failed = assistantMessage("resp_f", sdkUsage(0, 0));
    failed.stopReason = "error";
    failed.errorMessage = "boom";
    collector.onMessageEnd(messageEnd(failed));
    const record = collector.records[0]!;
    assert.equal(record.usageObserved, true);
    const parsed = parseUsageEvents([asJson(messageEnd(failed)), mainUsageEvidenceV2Json(record)], "json");
    // The failed message keeps its honestly observed wire usage instead of the SDK zeros.
    assert.equal(parsed.assistantMessages[0]!.usage!.inputTotal, 20);
    assert.equal(parsed.assistantMessages[0]!.usage!.outputTotal, 3);
    assert.deepEqual(parsed.missing, []);
  });

  it("counts unsupported apis without making any field claim", () => {
    const collector = createMainUsageEvidenceCollector();
    collector.onProviderStreamEvent(streamEvent(asJson({ type: "message_start", message: { id: "msg_1", usage: { input_tokens: 9 } } }), "anthropic-messages"));
    collector.onProviderStreamEvent(streamEvent(asJson({ type: "message_delta", usage: { output_tokens: 4 } }), "anthropic-messages"));
    const message = assistantMessage("msg_1", sdkUsage(0, 0));
    collector.onMessageEnd(messageEnd(message));
    const record = collector.records[0]!;
    assert.equal(record.correlation, "none");
    assert.equal(record.usageObserved, null);
    assert.equal(collector.diagnostics.unsupportedApiEvents, 2);
    const parsed = parseUsageEvents([asJson(messageEnd(message)), mainUsageEvidenceV2Json(record)], "json");
    assert.equal(parsed.assistantMessages[0]!.usage, null); // SDK zeros stay ambiguous
  });
});

describe("read-only request observer and record safety", () => {
  it("never returns a payload replacement and never mutates the payload", () => {
    const collector = createMainUsageEvidenceCollector();
    const payload = { model: "main-m", messages: [{ role: "user", content: "secret-free" }], Authorization: "Bearer should-not-be-recorded" };
    const before = canonicalJson(payload);
    const result = collector.onBeforeProviderRequest({ type: "before_provider_request", payload });
    assert.equal(result, undefined);
    assert.equal(canonicalJson(payload), before);
  });

  it("keeps provider headers, credentials and message content out of records", () => {
    const collector = createMainUsageEvidenceCollector();
    collector.onBeforeProviderRequest({ type: "before_provider_request", payload: { model: "m", Authorization: "Bearer sk-secret", api_key: "sk-2" } });
    collector.onProviderStreamEvent(streamEvent(deltaChunk("resp_s", "user content must not leak")));
    collector.onProviderStreamEvent(streamEvent(usageChunk("resp_s", { prompt_tokens: 1, completion_tokens: 1 })));
    const message = assistantMessage("resp_s", sdkUsage(1, 1));
    collector.onMessageEnd(messageEnd(message));
    const serialised = collector.records.map((record) => canonicalJson(record)).join("\n");
    assert.ok(!serialised.includes("sk-secret"), "credentials must not appear in records");
    assert.ok(!serialised.includes("sk-2"), "api keys must not appear in records");
    assert.ok(!serialised.includes("user content must not leak"), "message content must not appear in records");
    assert.ok(!serialised.includes("Authorization"), "header names must not appear in records");
    // Whitelist projection: every record key is a declared evidence key.
    const allowed = new Set([
      "type", "schemaVersion", "messageSha256", "responseId", "correlation", "usageObserved",
      "api", "usageSource", "fields", "wireCostTotal", "ambiguous", "uncorrelatedResponseIds",
      "uncorrelatedCount", "requestWindows",
    ]);
    for (const record of collector.records) {
      for (const key of Object.keys(record)) assert.ok(allowed.has(key), `unexpected record key ${key}`);
    }
  });

  it("wires through an ExtensionAPI-like surface and unsubscribes cleanly", () => {
    const collector = createMainUsageEvidenceCollector();
    const registered: string[] = [];
    const pi = {
      on(event: string, _handler: (event: never) => unknown): () => void {
        registered.push(event);
        return () => undefined;
      },
    };
    const unsubscribers = wireMainUsageEvidence(pi as never, collector);
    assert.equal(unsubscribers.length, 3);
    assert.deepEqual(registered.sort(), ["before_provider_request", "message_end", "provider_stream_event"]);
  });
});

describe("v2 record validation and mapping", () => {
  it("round-trips emitted records through readMainUsageEvidenceV2", () => {
    const collector = createMainUsageEvidenceCollector();
    collector.onProviderStreamEvent(streamEvent(usageChunk("resp_r", { prompt_tokens: 7, completion_tokens: 2 })));
    collector.onMessageEnd(messageEnd(assistantMessage("resp_r", sdkUsage(7, 2))));
    for (const record of collector.records) {
      const json = mainUsageEvidenceV2Json(record);
      const read = readMainUsageEvidenceV2(json);
      assert.notEqual(read, null);
      assert.deepEqual(read, record);
    }
  });

  it("rejects malformed v2 records so the parser falls back to the SDK path", () => {
    const message = assistantMessage("resp_x", sdkUsage(3, 3));
    const good = createMainUsageEvidenceCollector();
    good.onProviderStreamEvent(streamEvent(usageChunk("resp_x", { prompt_tokens: 3, completion_tokens: 3 })));
    good.onMessageEnd(messageEnd(message));
    const recordJson = mainUsageEvidenceV2Json(good.records[0]!) as Record<string, unknown>;
    const bad: Json[] = [
      asJson({ ...recordJson, messageSha256: "not-a-hash" }),
      asJson({ ...recordJson, usageObserved: "yes" }),
      asJson({ ...recordJson, fields: { inputTokens: -5 }, usageSource: null }),
      asJson({ ...recordJson, usageObserved: true, fields: null }),
      asJson({ ...recordJson, correlation: "none", usageObserved: true }),
      asJson({ ...recordJson, uncorrelatedCount: -1 }),
      asJson({ type: "intelli_benchmark_main_usage", schemaVersion: 3, messageSha256: "0".repeat(64), responseId: null, correlation: "none", usageObserved: null, api: "", usageSource: null, fields: null, wireCostTotal: null, ambiguous: false, uncorrelatedResponseIds: [], uncorrelatedCount: 0, requestWindows: 0 }),
    ];
    for (const candidate of bad) assert.equal(readMainUsageEvidenceV2(candidate), null, canonicalJson(candidate));
    // The parser ignores malformed v2 noise; the non-zero SDK candidate stands.
    const parsed = parseUsageEvents([asJson(messageEnd(message)), ...bad], "json");
    assert.equal(parsed.assistantMessages[0]!.usage!.inputUncached, 3);
  });

  it("preserves a reported total on both API families rather than replacing it with a component sum", () => {
    const completions = readMainUsageEvidenceV2(
      mainUsageEvidenceV2Json({
        ...v2Record("a".repeat(64), "resp_1", true, "openai-completions", "chunk-usage", {
          inputTokens: 1000, cachedTokens: 600, cacheWriteTokens: 100, outputTokens: 50, reasoningTokens: null, totalTokens: 9999,
        }),
        wireCostTotal: 0.01, ambiguous: false, uncorrelatedResponseIds: [], uncorrelatedCount: 0, requestWindows: 1, correlation: "response-id",
      }),
    )!;
    const completionsTokens = tokensFromWireEvidence(completions)!;
    assert.equal(completionsTokens.totalTokens, 9999); // reported total is kept separately from component arithmetic
    const responses = readMainUsageEvidenceV2(
      mainUsageEvidenceV2Json({
        ...v2Record("b".repeat(64), "resp_2", true, "openai-responses", "response-usage", {
          inputTokens: 1000, cachedTokens: 600, cacheWriteTokens: 100, outputTokens: 50, reasoningTokens: null, totalTokens: 1750,
        }),
        wireCostTotal: null, ambiguous: false, uncorrelatedResponseIds: [], uncorrelatedCount: 0, requestWindows: 1, correlation: "response-id",
      }),
    )!;
    assert.equal(tokensFromWireEvidence(responses)!.totalTokens, 1750); // wire total preserved
  });
});

/** Minimal valid v2 record builder for parser-level tests. */
function v2Record(
  messageSha256: string,
  responseId: string | null,
  usageObserved: boolean | null,
  api: string,
  usageSource: MainUsageEvidenceV2Record["usageSource"],
  fields: MainUsageEvidenceV2Record["fields"],
): MainUsageEvidenceV2Record {
  return {
    type: "intelli_benchmark_main_usage",
    schemaVersion: 2,
    messageSha256,
    responseId,
    correlation: responseId === null ? "none" : "response-id",
    usageObserved,
    api,
    usageSource,
    fields,
    wireCostTotal: null,
    ambiguous: false,
    uncorrelatedResponseIds: [],
    uncorrelatedCount: 0,
    requestWindows: 1,
  };
}

describe("parser v1/v2 coexistence", () => {
  const message = assistantMessage("resp_v", sdkUsage(0, 0));
  const messageEndJson = asJson(messageEnd(message));
  const collectorFor = (): MainUsageEvidenceV2Record => {
    const collector = createMainUsageEvidenceCollector();
    collector.onProviderStreamEvent(streamEvent(usageChunk("resp_v", { prompt_tokens: 0, completion_tokens: 0 })));
    collector.onMessageEnd(messageEnd(message));
    return collector.records[0]!;
  };

  it("keeps existing v1 sidecars readable and unchanged in behaviour", () => {
    // v1 alone: observed true keeps the SDK zeros as values.
    const v1 = parseUsageEvents([messageEndJson, mainUsageEvidence(asJson(message), true)], "json");
    assert.equal(v1.assistantMessages[0]!.usage!.inputUncached, 0);
    // v1 false forces null.
    const v1False = parseUsageEvents([messageEndJson, mainUsageEvidence(asJson(message), false)], "json");
    assert.equal(v1False.assistantMessages[0]!.usage, null);
  });

  it("prefers wire fields when v1 agrees, and fails closed when versions disagree", () => {
    const v2 = collectorFor();
    const both = parseUsageEvents([messageEndJson, mainUsageEvidence(asJson(message), true), mainUsageEvidenceV2Json(v2)], "json");
    assert.deepEqual(both.assistantMessages[0]!.usage, { inputTotal: 0, outputTotal: 0 });
    const v1FalseV2True = parseUsageEvents([messageEndJson, mainUsageEvidence(asJson(message), false), mainUsageEvidenceV2Json(v2)], "json");
    assert.equal(v1FalseV2True.assistantMessages[0]!.usage, null); // v1 false wins fail-closed
    const v1TrueV2False = parseUsageEvents(
      [
        messageEndJson,
        mainUsageEvidence(asJson(message), true),
        mainUsageEvidenceV2Json({ ...v2, usageObserved: false, fields: null, usageSource: null }),
      ],
      "json",
    );
    assert.equal(v1TrueV2False.assistantMessages[0]!.usage, null); // contradiction fails closed
  });

  it("folds conflicting v2 records for one message to unobserved", () => {
    const v2 = collectorFor();
    const conflicting = parseUsageEvents(
      [messageEndJson, mainUsageEvidenceV2Json(v2), mainUsageEvidenceV2Json({ ...v2, wireCostTotal: 0.5 })],
      "json",
    );
    assert.equal(conflicting.assistantMessages[0]!.usage, null);
    assert.deepEqual(conflicting.missing, ["resp_v"]);
    // Diagnostic-only differences do not conflict: same claim, different window counts.
    const diagnosticOnly = parseUsageEvents(
      [messageEndJson, mainUsageEvidenceV2Json(v2), mainUsageEvidenceV2Json({ ...v2, requestWindows: 9, uncorrelatedCount: 4 })],
      "json",
    );
    assert.equal(Object.hasOwn(diagnosticOnly.assistantMessages[0]!.usage!, "inputUncached"), false);
  });

  it("asserting records from different API or response identities cannot agree merely because token fields match", () => {
    const v2 = collectorFor();
    for (const changed of [{ ...v2, api: "openai-responses" }, { ...v2, responseId: "foreign-response" }]) {
      for (const records of [[v2, changed], [changed, v2]]) {
        const parsed = parseUsageEvents([messageEndJson, ...records.map(mainUsageEvidenceV2Json)], "json");
        assert.equal(parsed.assistantMessages[0]!.usage, null);
      }
    }
  });

  it("a no-claim record mixed with an asserting record deliberately invalidates that message", () => {
    const v2 = collectorFor();
    const noClaim = { ...v2, usageObserved: null, fields: null, usageSource: null } as const;
    for (const records of [[v2, noClaim], [noClaim, v2]]) {
      const parsed = parseUsageEvents([messageEndJson, ...records.map(mainUsageEvidenceV2Json)], "json");
      assert.equal(parsed.assistantMessages[0]!.usage, null);
      assert.deepEqual(parsed.missing, ["resp_v"]);
    }
  });

  it("ignores evidence keyed to a different message", () => {
    const v2 = collectorFor();
    const other = asJson({ role: "assistant", content: [], provider: "p", model: "m", responseId: "other", timestamp: 9, usage: sdkUsage(2, 2) });
    const parsed = parseUsageEvents([asJson(messageEnd(other)), mainUsageEvidenceV2Json(v2)], "json");
    assert.equal(parsed.assistantMessages[0]!.usage!.inputUncached, 2);
  });
});

// ---------------------------------------------------------------------------
// Actual SDK wiring: the installed pi-ai transport drives the collector.
//
// These tests do not hand-build the chunk objects fed to the collector. They
// drive the actual installed `pi-ai/dist/api/openai-completions.js`
// `streamSimple` (real request serialisation, real SSE parsing, real
// `parseChunkUsage` normalisation, real `responseId` capture) with an
// injected in-process `fetch` that answers from a scripted SSE body. No
// globalThis.fetch call, socket or DNS is made: the fetch function is never
// connected (the same credential-free pattern as the accepted
// test/helpers/native-replay.ts main fixture). The host root defaults to the
// worktree's dev peer and follows NATIVE_REPLAY_PI_HOST for an installed
// host, matching the native-replay host-selection convention. The worktree
// dev pi-ai 1.1.0 and the installed Pi 1.3.0 host's pi-ai 1.3.0 were
// byte-diffed on 2026-10-26: parseChunkUsage, the chunk wiring and
// responses-family finalizeResponse are identical, so the default peer
// exercises the same normalisation the installed host runs.
// ---------------------------------------------------------------------------

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SDK_HOST_ROOT = process.env.NATIVE_REPLAY_PI_HOST || join(REPO_ROOT, "node_modules/@earendil-works/pi-coding-agent");

interface SdkStreamLike extends AsyncIterable<unknown> {
  result(): Promise<Record<string, unknown>>;
}

/** Minimal OpenAI SSE body: a delta chunk, a usage chunk and [DONE]. */
function sseBody(chunks: Record<string, unknown>[]): string {
  return [...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`), "data: [DONE]\n\n"].join("");
}

async function driveCompletionsSdk(
  sse: string,
): Promise<{ captured: unknown[]; message: Record<string, unknown>; fetchCalls: number }> {
  const completions = (await import(
    pathToFileURL(join(dirname(SDK_HOST_ROOT), "pi-ai/dist/api/openai-completions.js")).href
  )) as {
    streamSimple: (
      model: unknown,
      context: unknown,
      options: Record<string, unknown>,
    ) => SdkStreamLike;
  };
  const captured: unknown[] = [];
  let fetchCalls = 0;
  const inProcessFetch = (async () => {
    fetchCalls += 1;
    return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  const model = {
    provider: "fixture-inproc",
    id: "main",
    api: "openai-completions",
    baseUrl: "http://main.fixture.invalid/v1",
    // `input` modalities are required: transformMessages' downgradeUnsupportedImages
    // reads model.input.includes("image") before any request is built.
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 0,
    maxTokens: 4096,
  };
  const stream = completions.streamSimple(model, { messages: [{ role: "user", content: "hello" }] }, {
    apiKey: "fixture-key",
    fetch: inProcessFetch,
    maxRetries: 0,
    onProviderStreamEvent: (data: unknown) => {
      captured.push(data);
    },
  });
  for await (const event of stream) void event; // drain the real event stream
  const message = await stream.result();
  return { captured, message, fetchCalls };
}

describe("actual SDK wiring through the installed pi-ai transport (credential-free)", () => {
  it("harvests real parsed chunks and correlates by the real responseId", async () => {
    const wireUsage = {
      prompt_tokens: 1200,
      prompt_tokens_details: { cached_tokens: 800, cache_write_tokens: 100 },
      completion_tokens: 90,
      completion_tokens_details: { reasoning_tokens: 20 },
      total_tokens: 1290,
    };
    const sse = sseBody([
      { id: "resp_sdk_1", object: "chat.completion.chunk", created: 1, model: "main", choices: [{ index: 0, delta: { role: "assistant", content: "hi" }, finish_reason: null }], usage: null },
      { id: "resp_sdk_1", object: "chat.completion.chunk", created: 1, model: "main", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: wireUsage },
    ]);
    const { captured, message, fetchCalls } = await driveCompletionsSdk(sse);
    assert.equal(fetchCalls, 1); // the injected transport answered; no retry
    assert.ok(captured.length >= 2, "the real stream delivered at least the delta and usage chunks");
    // The real SDK normalisation under test: responseId from the first chunk,
    // uncached input from the pi-ai arithmetic, wire cost computed by calculateCost.
    assert.equal(message["responseId"], "resp_sdk_1");
    const sdkUsage = message["usage"] as Record<string, number>;
    assert.equal(sdkUsage.input, 300); // 1200 - 800 - 100
    assert.equal(sdkUsage.cacheRead, 800);
    assert.equal(sdkUsage.output, 90);
    assert.equal(sdkUsage.reasoning, 20);
    // The captured chunks are the objects the host would hand the session
    // provider_stream_event handler: feed them to the collector unchanged.
    const collector = createMainUsageEvidenceCollector();
    for (const data of captured) {
      collector.onProviderStreamEvent({
        type: "provider_stream_event",
        provider: "fixture-inproc",
        api: "openai-completions",
        model: "main",
        data,
      });
    }
    collector.onMessageEnd({ type: "message_end", message });
    const record = collector.records[0]!;
    assert.equal(record.correlation, "response-id");
    assert.equal(record.responseId, message["responseId"]);
    assert.equal(record.usageObserved, true);
    assert.equal(record.usageSource, "chunk-usage");
    assert.equal(record.fields!.inputTokens, 1200);
    assert.equal(record.fields!.cachedTokens, 800);
    assert.equal(record.fields!.cacheWriteTokens, 100);
    assert.equal(record.fields!.outputTokens, 90);
    assert.equal(record.fields!.reasoningTokens, 20);
    // End to end through the parser with the real SDK message and record.
    const parsed = parseUsageEvents(
      [asJson({ type: "message_end", message }), mainUsageEvidenceV2Json(record)],
      "json",
    );
    assert.deepEqual(parsed.assistantMessages[0]!.usage, {
      inputTotal: 1200,
      inputUncached: 300,
      outputTotal: 90,
      cacheRead: 800,
      cacheWrite: 100,
      reasoning: 20,
      totalTokens: 1290,
    });
    assert.deepEqual(parsed.missing, []);
  });

  it("proves the T31 disambiguation on the real SDK: wire-absent usage is not a zero-token observation", async () => {
    // The scripted provider completes the turn with NO usage object on the
    // wire. The real SDK still finalises the message with zero-placeholder
    // usage; the correlated v2 record must mark the usage unobserved so the
    // parser records missing instead of a zero-token main observation.
    const sse = sseBody([
      { id: "resp_sdk_2", object: "chat.completion.chunk", created: 1, model: "main", choices: [{ index: 0, delta: { role: "assistant", content: "done" }, finish_reason: null }], usage: null },
      { id: "resp_sdk_2", object: "chat.completion.chunk", created: 1, model: "main", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: null },
    ]);
    const { captured, message } = await driveCompletionsSdk(sse);
    assert.equal(message["responseId"], "resp_sdk_2");
    const sdkUsage = message["usage"] as Record<string, number>;
    assert.equal(sdkUsage.input, 0); // placeholder: the SDK initialised zeros
    assert.equal(sdkUsage.output, 0);
    const collector = createMainUsageEvidenceCollector();
    for (const data of captured) {
      collector.onProviderStreamEvent({
        type: "provider_stream_event",
        provider: "fixture-inproc",
        api: "openai-completions",
        model: "main",
        data,
      });
    }
    collector.onMessageEnd({ type: "message_end", message });
    const record = collector.records[0]!;
    assert.equal(record.usageObserved, false); // correlated id, no usage object on the wire
    const parsed = parseUsageEvents(
      [asJson({ type: "message_end", message }), mainUsageEvidenceV2Json(record)],
      "json",
    );
    assert.equal(parsed.assistantMessages[0]!.usage, null);
    assert.deepEqual(parsed.missing, ["resp_sdk_2"]);
  });
});
