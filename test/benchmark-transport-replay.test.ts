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
  createRoleInferencer,
  modelFixtureRequest,
  uniqueMatchModelResolver,
  uniqueMatchPageResolver,
  userMessageFromContext,
} from "../scripts/benchmarks/transport-replay.js";
import type { PageTransportRequest } from "../src/core/execution-contracts.js";
import { forbidNetwork } from "../scripts/benchmarks/testing.js";

// N1 (verbatim from the binding report): a transport-replay implementation
// must never invoke `options.fetch` or any network primitive. It must replay
// citations only through recorded `onProviderStreamEvent` chunks, or through
// a declared non-network tee seam if floor-host replay is ever required.

const SCENARIO = "transport-unit";
const MODEL = { provider: "fixture-openrouter", id: "perplexity/sonar" } as unknown as Model<Api>;

// Deterministic content-derived resolver inputs, mirroring how the real
// pipeline distinguishes stages (distinct system prompts per role; page
// identity in the user message).
const PROMPTS = {
  search: "You are the synthetic search stage.",
  extract: "You are a technical content extraction assistant.",
  collate: "You are a research collation assistant.",
  suggest: "You judge search query relevance.",
};
const roleOf = createRoleInferencer(PROMPTS);

function resolveSyntheticNode(request: { systemPrompt: string; userMessage: string }) {
  const role = roleOf(request.systemPrompt);
  if (role === null) return { ambiguous: true as const, detail: `unknown system prompt "${request.systemPrompt}"` };
  if (role === "extract") {
    const match = /source (S\d+)/.exec(request.userMessage);
    if (match === null) return { ambiguous: true as const, detail: "extract request without a source marker" };
    return { operationNode: `research.extract/${match[1]}`, role } as const;
  }
  const nodeByRole: Record<string, string> = {
    search: "research.search",
    collate: "research.collate",
    suggest: "suggest.judge",
  };
  return { operationNode: nodeByRole[role]!, role } as const;
}

function userContext(text: string, systemPrompt = PROMPTS.search): Context {
  return {
    systemPrompt,
    messages: [{ role: "user", content: [{ type: "text", text }], timestamp: 1733234401000 }],
  };
}

const SEARCH_PATCH = (payload: Record<string, unknown>): Record<string, unknown> => ({
  ...payload,
  plugins: [{ name: "web_search" }],
});

function poisonFetch(): { restore: () => void } {
  const original = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("options.fetch/globalThis.fetch invoked during replay (N1 violation)");
  }) as typeof globalThis.fetch;
  return { restore: () => { globalThis.fetch = original; } };
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

describe("model transport replay through one shared instance", () => {
  it("replays a recorded response with usage, citations, response metadata and delay", async () => {
    const guard = forbidNetwork({ fail: (message) => assert.fail(message) });
    const poisoned = poisonFetch();
    try {
      const recorder = createFixtureRecorder({ boundary: "model", scenario: SCENARIO });
      recorder.record("research.search", {
        model: { provider: MODEL.provider, model: MODEL.id },
        role: "search",
        systemPrompt: PROMPTS.search,
        userMessage: "fixture query",
        maxTokens: 2048,
        reasoning: "low",
        effectivePayloadPatch: { plugins: [{ name: "web_search" }] },
      }, {
        response: {
          text: "answer",
          providerStreamEvents: [
            { choices: [{ delta: { annotations: [{ type: "url_citation", url_citation: { url: "https://example.com/a", title: "A" } }] } }] },
          ],
          providerResponse: { status: 200, headers: { "x-request-id": "req-9" } },
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
      const replay = createModelTransportReplay({
        store,
        scenario: SCENARIO,
        resolveNode: (request) => resolveSyntheticNode(request),
      });
      const citations: unknown[] = [];
      const responses: Array<{ status: number; headers: Record<string, string> }> = [];
      const options: SimpleStreamOptions = {
        onPayload: SEARCH_PATCH as SimpleStreamOptions["onPayload"],
        onProviderStreamEvent: (data) => { citations.push(data); },
        onResponse: (response) => { responses.push({ status: response.status, headers: response.headers }); },
        maxTokens: 2048,
        reasoning: "low",
      };
      const message = await replay(poisonRegistry() as never, MODEL, userContext("fixture query"), options);
      assert.equal(await textOf(message), "answer");
      assert.equal(message.stopReason, "stop");
      assert.equal(message.responseId, "gen-1");
      assert.equal(message.usage.input, 300);
      assert.equal(message.usage.input + message.usage.cacheRead, 1100);
      assert.equal(citations.length, 1);
      assert.deepEqual(responses, [{ status: 200, headers: { "x-request-id": "req-9" } }]);
      assert.equal(guard.calls(), 0);
      assert.equal(store.misses().length, 0);
    } finally {
      poisoned.restore();
      guard.restore();
    }
  });

  it("consumes one fixture occurrence per actual transport attempt across retries", async () => {
    const recorder = createFixtureRecorder({ boundary: "model", scenario: SCENARIO });
    recorder.record("research.extract/S1", {
      model: { provider: MODEL.provider, model: MODEL.id },
      role: "extract",
      systemPrompt: PROMPTS.extract,
      userMessage: "details for source S1",
      maxTokens: null,
      reasoning: null,
      effectivePayloadPatch: null,
    }, {
      error: { kind: "rate-limit", message: "429 Too Many Requests" },
      response: { providerResponse: { status: 429, headers: { "retry-after": "1" } } },
      delayMs: 0,
    });
    recorder.record("research.extract/S1", {
      model: { provider: MODEL.provider, model: MODEL.id },
      role: "extract",
      systemPrompt: PROMPTS.extract,
      userMessage: "details for source S1",
      maxTokens: null,
      reasoning: null,
      effectivePayloadPatch: null,
    }, {
      response: { text: "extracted", providerResponse: { status: 200, headers: {} } },
      usage: { tokens: { inputTotal: 10, outputTotal: 5 }, source: "provider-response", costBasis: "reported" },
      delayMs: 0,
    });
    const store = createReplayStore({ fixtures: recorder.records(), scenario: SCENARIO });
    const replay = createModelTransportReplay({
      store,
      scenario: SCENARIO,
      resolveNode: (r) => resolveSyntheticNode(r),
    });
    const context: Context = { systemPrompt: PROMPTS.extract, messages: [{ role: "user", content: "details for source S1", timestamp: 1 }] };
    // Attempt 1: the real policy would classify this as retryable; the
    // recorded 429 metadata reaches onResponse before the error return.
    const statuses: number[] = [];
    const options: SimpleStreamOptions = { onResponse: (response) => { statuses.push(response.status); } };
    const first = await replay(poisonRegistry() as never, MODEL, context, options);
    assert.equal(first.stopReason, "error");
    assert.equal(first.errorMessage, "429 Too Many Requests");
    assert.deepEqual(statuses, [429]);
    // Attempt 2 (retry): occurrence 2 succeeds.
    const second = await replay(poisonRegistry() as never, MODEL, context, options);
    assert.equal(second.stopReason, "stop");
    assert.equal(await textOf(second), "extracted");
    assert.deepEqual(statuses, [429, 200]);
    // Attempt 3 would exceed the recorded sequence and must fail closed.
    await assert.rejects(
      () => replay(poisonRegistry() as never, MODEL, context, options),
      (error: unknown) => error instanceof ReplayMissError && error.reason === "not-found",
    );
    assert.equal(store.consumed().length, 2);
    // The recorded miss invalidates the replay block.
    assert.throws(() => store.assertValid(), ReplayMissError);
  });

  it("resolves an aborted message like the live stream instead of rejecting", async () => {
    const recorder = createFixtureRecorder({ boundary: "model", scenario: SCENARIO });
    recorder.record("research.collate", {
      model: { provider: MODEL.provider, model: MODEL.id },
      role: "collate",
      systemPrompt: PROMPTS.collate,
      userMessage: "slow collation",
      maxTokens: null,
      reasoning: null,
      effectivePayloadPatch: null,
    }, { response: { text: "late" }, delayMs: 5000 });
    const store = createReplayStore({ fixtures: recorder.records(), scenario: SCENARIO });
    const replay = createModelTransportReplay({ store, scenario: SCENARIO, resolveNode: (r) => resolveSyntheticNode(r) });
    const context: Context = { systemPrompt: PROMPTS.collate, messages: [{ role: "user", content: "slow collation", timestamp: 1 }] };
    const controller = new AbortController();
    const options: SimpleStreamOptions = { signal: controller.signal };
    const pending = replay(poisonRegistry() as never, MODEL, context, options);
    setTimeout(() => controller.abort(), 5);
    const message = await pending;
    assert.equal(message.stopReason, "aborted");
    assert.equal(message.content.length, 0);
    // Started-then-cancelled counts as consumed, never as a skipped response.
    assert.equal(store.consumed().length, 1);
    assert.equal(store.unconsumed().length, 0);
  });

  it("stops the block when node derivation is ambiguous, never guessing", async () => {
    const recorder = createFixtureRecorder({ boundary: "model", scenario: SCENARIO });
    const request = {
      model: { provider: MODEL.provider, model: MODEL.id },
      role: "search",
      systemPrompt: PROMPTS.search,
      userMessage: "q",
      maxTokens: null,
      reasoning: null,
      effectivePayloadPatch: null,
    };
    recorder.record("node.a", request, { response: { text: "a" }, delayMs: 0 });
    recorder.record("node.b", request, { response: { text: "b" }, delayMs: 0 });
    const store = createReplayStore({ fixtures: recorder.records(), scenario: SCENARIO });
    // Identical request bytes under two nodes: construction invalidates.
    assert.throws(
      () => createModelTransportReplay({ store, scenario: SCENARIO, resolveNode: (r) => resolveSyntheticNode(r) }),
      (error: unknown) => error instanceof ReplayMissError && error.reason === "ambiguous-node",
    );
    // A resolver that cannot identify a unique node also stops the block.
    const uniqueStore = createReplayStore({
      fixtures: [recorder.records()[0]!],
      scenario: SCENARIO,
    });
    const replay = createModelTransportReplay({
      store: uniqueStore,
      scenario: SCENARIO,
      resolveNode: () => ({ ambiguous: true, detail: "no rule matched" }),
    });
    await assert.rejects(
      () => replay(poisonRegistry() as never, MODEL, userContext("q"), undefined),
      (error: unknown) => error instanceof ReplayMissError && error.reason === "ambiguous-node",
    );
  });

  it("requires exactly one uniqueMatch resolver rule to match", async () => {
    const resolver = uniqueMatchModelResolver([
      { matches: (r) => r.systemPrompt === PROMPTS.search, operationNode: "research.search", role: "search" },
      { matches: (r) => r.userMessage.includes("fixture"), operationNode: "research.search2", role: "search" },
    ]);
    const both = resolver(
      { model: { provider: "p", model: "m" }, systemPrompt: PROMPTS.search, userMessage: "fixture query", maxTokens: null, reasoning: null, effectivePayloadPatch: null },
      MODEL,
      userContext("fixture query"),
    );
    assert.ok("ambiguous" in both && both.ambiguous);
    const none = resolver(
      { model: { provider: "p", model: "m" }, systemPrompt: "unknown", userMessage: "x", maxTokens: null, reasoning: null, effectivePayloadPatch: null },
      MODEL,
      userContext("x"),
    );
    assert.ok("ambiguous" in none && none.ambiguous);
    const one = uniqueMatchModelResolver([
      { matches: (r) => r.systemPrompt === PROMPTS.search, operationNode: "research.search", role: "search" },
    ])(
      { model: { provider: "p", model: "m" }, systemPrompt: PROMPTS.search, userMessage: "q", maxTokens: null, reasoning: null, effectivePayloadPatch: null },
      MODEL,
      userContext("q"),
    );
    assert.deepEqual(one, { operationNode: "research.search", role: "search" });
  });

  it("builds the exact fixture request (without role) from model, context and stream options", async () => {
    const context = userContext("exact request");
    const request = await modelFixtureRequest(MODEL, context, {
      maxTokens: 99,
      reasoning: "low",
      onPayload: SEARCH_PATCH as SimpleStreamOptions["onPayload"],
    });
    assert.equal(request.model.provider, MODEL.provider);
    assert.equal(request.systemPrompt, PROMPTS.search);
    assert.equal(request.userMessage, "exact request");
    assert.equal(request.maxTokens, 99);
    assert.equal(request.reasoning, "low");
    assert.deepEqual(request.effectivePayloadPatch, { plugins: [{ name: "web_search" }] });
    assert.ok(!("role" in request));
    const again = await modelFixtureRequest(MODEL, userContext("exact request"), {
      maxTokens: 99,
      reasoning: "low",
      onPayload: SEARCH_PATCH as SimpleStreamOptions["onPayload"],
    });
    assert.equal(requestSha256(asJson({ ...again, role: "search" })), requestSha256(asJson({ ...request, role: "search" })));
  });

  it("folds non-text blocks to content-hashed markers, not lengths", () => {
    const context: Context = {
      systemPrompt: PROMPTS.search,
      messages: [
        { role: "user", content: [{ type: "text", text: "look" }, { type: "image", data: "AAAA" } as never], timestamp: 1 },
      ],
    };
    const sameLengthDifferentBytes: Context = {
      systemPrompt: PROMPTS.search,
      messages: [
        { role: "user", content: [{ type: "text", text: "look" }, { type: "image", data: "BBBB" } as never], timestamp: 1 },
      ],
    };
    assert.notEqual(userMessageFromContext(context), userMessageFromContext(sameLengthDifferentBytes));
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

  function syntheticPageResolver() {
    return uniqueMatchPageResolver([
      { matches: (r) => r.url.endsWith("/one") && r.method === "GET" && r.accept.includes("markdown"), operationNode: "page.fetch/variant-markdown" },
      { matches: (r) => r.url.endsWith("/one") && r.method === "GET", operationNode: "page.fetch/variant-html" },
      { matches: (r) => r.url.endsWith("/llms-full.txt") && r.method === "HEAD", operationNode: "docs.discovery/probe" },
      { matches: (r) => r.url === "https://example.com/big", operationNode: "page.fetch/big" },
      { matches: (r) => r.url === "https://example.com/cancel", operationNode: "page.fetch/cancel" },
      { matches: (r) => r.url === "https://example.com/page", operationNode: "page.fetch/html" },
    ]);
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
        resolveNode: syntheticPageResolver(),
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
    const { recorder } = recordedFetchStore();
    const store = createReplayStore({ fixtures: recorder.records(), scenario: SCENARIO });
    const transport = createPageTransportReplay({
      store,
      scenario: SCENARIO,
      resolveNode: syntheticPageResolver(),
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
  });

  it("includes the configured byte bound and accept header in request identity", async () => {
    const { recorder } = recordedFetchStore();
    const store = createReplayStore({ fixtures: recorder.records(), scenario: SCENARIO });
    const transport = createPageTransportReplay({
      store,
      scenario: SCENARIO,
      resolveNode: syntheticPageResolver(),
      maxResponseBytes: 8388608,
    });
    await assert.rejects(
      () => transport("https://example.com/page", pageRequest({ headers: { accept: "text/markdown" } })),
      (error: unknown) => error instanceof ReplayMissError,
    );
    const transportWithDifferentBound = createPageTransportReplay({
      store,
      scenario: SCENARIO,
      resolveNode: syntheticPageResolver(),
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
        resolveNode: syntheticPageResolver(),
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

  it("rejects a fixture set with identical fetch requests under two nodes", () => {
    const recorder = createFixtureRecorder({ boundary: "fetch", scenario: SCENARIO });
    const request = {
      url: "https://example.com/twin",
      method: "GET",
      accept: "text/html",
      browser: BROWSER,
      proxyConfigured: false,
      maxResponseBytes: 8388608,
    };
    recorder.record("node.x", request, { response: { status: 200 }, delayMs: 0 });
    recorder.record("node.y", request, { response: { status: 200 }, delayMs: 0 });
    const store = createReplayStore({ fixtures: recorder.records(), scenario: SCENARIO });
    assert.throws(
      () =>
        createPageTransportReplay({
          store,
          scenario: SCENARIO,
          resolveNode: () => ({ operationNode: "node.x" }),
          maxResponseBytes: 8388608,
        }),
      (error: unknown) => error instanceof ReplayMissError && error.reason === "ambiguous-node",
    );
  });
});
