// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { asJson, requestSha256 } from "../scripts/benchmarks/canonical.js";
import { createFixtureRecorder, createReplayStore, ReplayMissError } from "../scripts/benchmarks/replay-store.js";
import {
  createModelTransportReplay,
  createPageTransportReplay,
  modelFixtureRequest,
} from "../scripts/benchmarks/transport-replay.js";
import type { PageTransportRequest } from "../src/core/execution-contracts.js";
import { forbidNetwork } from "../scripts/benchmarks/testing.js";

// N1 (verbatim from the binding report): a transport-replay implementation
// must never invoke `options.fetch` or any network primitive. It must replay
// citations only through recorded `onProviderStreamEvent` chunks, or through
// a declared non-network tee seam if floor-host replay is ever required.

const SCENARIO = "transport-unit";
const MODEL = { provider: "fixture-openrouter", id: "perplexity/sonar" } as unknown as Model<Api>;

function userContext(text: string): Context {
  return {
    systemPrompt: "You are the synthetic search stage.",
    messages: [{ role: "user", content: [{ type: "text", text }], timestamp: 1733234401000 }],
  };
}

const SEARCH_PATCH = (payload: Record<string, unknown>): Record<string, unknown> => ({
  ...payload,
  plugins: [{ name: "web_search" }],
});

function poisonFetch(): { fetch: never; restore: () => void } {
  const original = globalThis.fetch;
  const poisoned = (() => {
    throw new Error("options.fetch/globalThis.fetch invoked during replay (N1 violation)");
  }) as typeof globalThis.fetch;
  globalThis.fetch = poisoned;
  return { fetch: undefined as never, restore: () => { globalThis.fetch = original; } };
}

function poisonRegistry(): { streamSimple: () => never } {
  return {
    streamSimple: () => {
      throw new Error("live registry invoked during replay (no live fallback)");
    },
  };
}

async function textOf(message: AssistantMessage): Promise<string> {
  return message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("");
}

describe("model transport replay", () => {
  it("replays a recorded response with usage, citations and delay", async () => {
    const guard = forbidNetwork({ fail: (message) => assert.fail(message) });
    const poisoned = poisonFetch();
    try {
      const recorder = createFixtureRecorder({ boundary: "model", scenario: SCENARIO });
      recorder.record("research.search", {
        model: { provider: MODEL.provider, model: MODEL.id },
        role: "search",
        systemPrompt: "You are the synthetic search stage.",
        userMessage: "fixture query",
        maxTokens: 2048,
        reasoning: "low",
        effectivePayloadPatch: { plugins: [{ name: "web_search" }] },
      }, {
        response: {
          text: "answer",
          providerStreamEvents: [{ type: "url_citation", url: "https://example.com/a", index: 0 }],
          responseId: "gen-1",
        },
        usage: {
          tokens: { inputTotal: 1100, inputUncached: 300, outputTotal: 100, cacheRead: 800 },
          cost: { total: 0.001 },
          source: "provider-response",
          costBasis: "reported",
        },
        delayMs: 1,
      });
      const store = createReplayStore({ fixtures: recorder.records(), scenario: SCENARIO });
      const replay = createModelTransportReplay({ store, scenario: SCENARIO, operationNode: "research.search", role: "search" });
      const citations: unknown[] = [];
      const options: SimpleStreamOptions = {
        onPayload: SEARCH_PATCH as SimpleStreamOptions["onPayload"],
        onProviderStreamEvent: (data) => { citations.push(data); },
        maxTokens: 2048,
        reasoning: "low",
      };
      const message = await replay(poisonRegistry() as never, MODEL, userContext("fixture query"), options);
      assert.equal(await textOf(message), "answer");
      assert.equal(message.stopReason, "stop");
      assert.equal(message.responseId, "gen-1");
      assert.equal(message.usage.input, 300);
      assert.equal(message.usage.input + message.usage.cacheRead, 1100);
      assert.deepEqual(citations, [{ type: "url_citation", url: "https://example.com/a", index: 0 }]);
      assert.equal(guard.calls(), 0);
      assert.equal(store.misses().length, 0);
    } finally {
      poisoned.restore();
      guard.restore();
    }
  });

  it("consumes one fixture occurrence per actual transport attempt across retries", async () => {
    const recorder = createFixtureRecorder({ boundary: "model", scenario: SCENARIO });
    const request = {
      model: { provider: MODEL.provider, model: MODEL.id },
      role: "extract",
      systemPrompt: "sys",
      userMessage: "extract s1",
      maxTokens: null,
      reasoning: null,
      effectivePayloadPatch: null,
    };
    recorder.record("page.extract/S1", request, {
      error: { kind: "rate-limit", message: "429 Too Many Requests" },
      delayMs: 0,
    });
    recorder.record("page.extract/S1", request, {
      response: { text: "extracted" },
      usage: { tokens: { inputTotal: 10, outputTotal: 5 }, source: "provider-response", costBasis: "reported" },
      delayMs: 0,
    });
    const store = createReplayStore({ fixtures: recorder.records(), scenario: SCENARIO });
    const replay = createModelTransportReplay({ store, scenario: SCENARIO, operationNode: "page.extract/S1", role: "extract" });
    const context: Context = { systemPrompt: "sys", messages: [{ role: "user", content: "extract s1", timestamp: 1 }] };
    // Attempt 1: the real policy would classify this as retryable.
    const first = await replay(poisonRegistry() as never, MODEL, context, undefined);
    assert.equal(first.stopReason, "error");
    assert.equal(first.errorMessage, "429 Too Many Requests");
    // Attempt 2 (retry): occurrence 2 succeeds.
    const second = await replay(poisonRegistry() as never, MODEL, context, undefined);
    assert.equal(second.stopReason, "stop");
    assert.equal(await textOf(second), "extracted");
    // Attempt 3 would exceed the recorded sequence and must fail closed.
    await assert.rejects(
      () => replay(poisonRegistry() as never, MODEL, context, undefined),
      (error: unknown) => error instanceof ReplayMissError && error.reason === "not-found",
    );
    assert.equal(store.consumed().length, 2);
    // The recorded miss invalidates the replay block.
    assert.throws(() => store.assertValid(), ReplayMissError);
  });

  it("treats a different effective payload patch as a different request", async () => {
    const recorder = createFixtureRecorder({ boundary: "model", scenario: SCENARIO });
    const request = {
      model: { provider: MODEL.provider, model: MODEL.id },
      role: "search",
      systemPrompt: "sys",
      userMessage: "q",
      maxTokens: null,
      reasoning: "low",
      effectivePayloadPatch: { plugins: [{ name: "web_search" }] },
    };
    recorder.record("research.search", request, { response: { text: "ok" }, delayMs: 0 });
    const store = createReplayStore({ fixtures: recorder.records(), scenario: SCENARIO });
    const replay = createModelTransportReplay({ store, scenario: SCENARIO, operationNode: "research.search", role: "search" });
    const context: Context = { systemPrompt: "sys", messages: [{ role: "user", content: "q", timestamp: 1 }] };
    // A patch that does not apply returns the payload untouched; the
    // effective patch is then null and the request identity differs.
    const identityChangingPatch = (payload: Record<string, unknown>) => ({ ...payload, plugins: [{ name: "other" }] });
    await assert.rejects(
      () =>
        replay(
          poisonRegistry() as never,
          MODEL,
          context,
          { reasoning: "low", onPayload: identityChangingPatch as SimpleStreamOptions["onPayload"] },
        ),
      (error: unknown) => error instanceof ReplayMissError,
    );
  });

  it("honours cancellation during the recorded delay", async () => {
    const recorder = createFixtureRecorder({ boundary: "model", scenario: SCENARIO });
    recorder.record("slow.node", {
      model: { provider: MODEL.provider, model: MODEL.id },
      role: "collate",
      systemPrompt: "sys",
      userMessage: "slow",
      maxTokens: null,
      reasoning: null,
      effectivePayloadPatch: null,
    }, { response: { text: "late" }, delayMs: 5000 });
    const store = createReplayStore({ fixtures: recorder.records(), scenario: SCENARIO });
    const replay = createModelTransportReplay({ store, scenario: SCENARIO, operationNode: "slow.node", role: "collate" });
    const context: Context = { systemPrompt: "sys", messages: [{ role: "user", content: "slow", timestamp: 1 }] };
    const controller = new AbortController();
    const options: SimpleStreamOptions = { signal: controller.signal };
    const pending = replay(poisonRegistry() as never, MODEL, context, options);
    setTimeout(() => controller.abort(), 5);
    await assert.rejects(() => pending, (error: unknown) => (error as Error).name === "AbortError");
  });

  it("builds the exact fixture request from model, context and stream options", async () => {
    const context = userContext("exact request");
    const request = await modelFixtureRequest(MODEL, "search", context, {
      maxTokens: 99,
      reasoning: "low",
      onPayload: SEARCH_PATCH as SimpleStreamOptions["onPayload"],
    });
    assert.equal(request.model.provider, MODEL.provider);
    assert.equal(request.role, "search");
    assert.equal(request.systemPrompt, "You are the synthetic search stage.");
    assert.equal(request.userMessage, "exact request");
    assert.equal(request.maxTokens, 99);
    assert.equal(request.reasoning, "low");
    assert.deepEqual(request.effectivePayloadPatch, { plugins: [{ name: "web_search" }] });
    // Hash stability: the same inputs produce the same fixture identity.
    const again = await modelFixtureRequest(MODEL, "search", userContext("exact request"), {
      maxTokens: 99,
      reasoning: "low",
      onPayload: SEARCH_PATCH as SimpleStreamOptions["onPayload"],
    });
    assert.equal(requestSha256(asJson(again)), requestSha256(asJson(request)));
  });
});

describe("page transport replay below the FetchClient", () => {
  const BROWSER = "chrome-124";
  function pageRequest(overrides: Partial<PageTransportRequest> = {}): PageTransportRequest {
    return {
      method: "GET",
      headers: { accept: "text/html" },
      browser: BROWSER,
      signal: new AbortController().signal,
      ...overrides,
    };
  }

  function recordedFetchStore() {
    const recorder = createFixtureRecorder({ boundary: "fetch", scenario: SCENARIO });
    const request = {
      url: "https://example.com/page",
      method: "GET",
      accept: "text/html",
      browser: BROWSER,
      proxyConfigured: false,
      maxResponseBytes: 8388608,
    };
    recorder.record("page.fetch/html", request, {
      response: { status: 200, headers: { "Content-Type": "text/html" }, bodyText: "<html>body</html>" },
      delayMs: 0,
    });
    recorder.record("page.fetch/html", request, {
      error: { kind: "network", message: "connection reset" },
      delayMs: 0,
    });
    return { recorder, request };
  }

  it("returns a chunked incremental body stream, not a buffered whole response", async () => {
    const guard = forbidNetwork({ fail: (message) => assert.fail(message) });
    try {
      const body = "x".repeat(40 * 1024); // spans multiple 16 KiB chunks
      const recorder = createFixtureRecorder({ boundary: "fetch", scenario: SCENARIO });
      recorder.record("page.fetch/big", {
        url: "https://example.com/big",
        method: "GET",
        accept: "text/html",
        browser: BROWSER,
        proxyConfigured: false,
        maxResponseBytes: 8388608,
      }, { response: { status: 200, headers: { "Content-Type": "text/html" }, bodyText: body }, delayMs: 0 });
      const store = createReplayStore({ fixtures: recorder.records(), scenario: SCENARIO });
      const transport = createPageTransportReplay({
        store,
        scenario: SCENARIO,
        operationNode: "page.fetch/big",
        maxResponseBytes: 8388608,
      });
      const response = await transport("https://example.com/big", pageRequest());
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "text/html");
      assert.ok(response.body, "body stream must exist");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      assert.equal(chunks.length, 3); // 16k + 16k + 8k: incremental reads
      const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
      assert.equal(total, body.length);
      assert.equal(guard.calls(), 0);
    } finally {
      guard.restore();
    }
  });

  it("retries consume distinct occurrences and replay error fixtures reject", async () => {
    const { recorder, request } = recordedFetchStore();
    const store = createReplayStore({ fixtures: recorder.records(), scenario: SCENARIO });
    const transport = createPageTransportReplay({
      store,
      scenario: SCENARIO,
      operationNode: "page.fetch/html",
      maxResponseBytes: 8388608,
    });
    const first = await transport("https://example.com/page", pageRequest());
    assert.equal(first.status, 200);
    await assert.rejects(
      () => transport("https://example.com/page", pageRequest()),
      (error: unknown) => (error as Error).message === "connection reset",
    );
    await assert.rejects(
      () => transport("https://example.com/page", pageRequest()),
      (error: unknown) => error instanceof ReplayMissError,
    );
    assert.equal(requestSha256(request).length, 64);
  });

  it("includes the configured byte bound and accept header in request identity", async () => {
    const { recorder } = recordedFetchStore();
    const store = createReplayStore({ fixtures: recorder.records(), scenario: SCENARIO });
    const transport = createPageTransportReplay({
      store,
      scenario: SCENARIO,
      operationNode: "page.fetch/html",
      maxResponseBytes: 8388608,
    });
    await assert.rejects(
      () => transport("https://example.com/page", pageRequest({ headers: { accept: "text/markdown" } })),
      (error: unknown) => error instanceof ReplayMissError,
    );
    const transportWithDifferentBound = createPageTransportReplay({
      store,
      scenario: SCENARIO,
      operationNode: "page.fetch/html",
      maxResponseBytes: 65536,
    });
    await assert.rejects(
      () => transportWithDifferentBound("https://example.com/page", pageRequest()),
      (error: unknown) => error instanceof ReplayMissError,
    );
  });

  it("cancels a mid-read body through the request signal", async () => {
    const guard = forbidNetwork({ fail: (message) => assert.fail(message) });
    try {
      const body = "y".repeat(64 * 1024);
      const recorder = createFixtureRecorder({ boundary: "fetch", scenario: SCENARIO });
      recorder.record("page.fetch/cancel", {
        url: "https://example.com/cancel",
        method: "GET",
        accept: "text/html",
        browser: BROWSER,
        proxyConfigured: false,
        maxResponseBytes: 8388608,
      }, { response: { status: 200, bodyText: body }, delayMs: 0 });
      const store = createReplayStore({ fixtures: recorder.records(), scenario: SCENARIO });
      const transport = createPageTransportReplay({
        store,
        scenario: SCENARIO,
        operationNode: "page.fetch/cancel",
        maxResponseBytes: 8388608,
      });
      const controller = new AbortController();
      const response = await transport("https://example.com/cancel", pageRequest({ signal: controller.signal }));
      const reader = response.body!.getReader();
      await reader.read();
      controller.abort();
      // Buffered chunks may still deliver; the stream must eventually reject
      // with AbortError instead of completing normally.
      await assert.rejects(
        async () => {
          for (;;) await reader.read();
        },
        (error: unknown) => (error as Error).name === "AbortError",
      );
      assert.equal(guard.calls(), 0);
    } finally {
      guard.restore();
    }
  });
});
