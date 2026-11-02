// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Deterministic checks for the study capture and replay wiring. All data here is
// SYNTHETIC: fake registries, fake page transports and invented usage values.
// No test makes a model, provider or web call, and these checks are not
// evidence about a measured run.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { describe, it } from "node:test";
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { CommittedRun, IndexCandidate, RunReservation } from "../src/core/contracts.js";
import { createExecutionCoordinator } from "../src/core/execution-coordinator.js";
import { createSystemClock } from "../src/core/clock.js";
import type { PageTransport, PageTransportResponse } from "../src/core/execution-contracts.js";
import { createFetchClient } from "../src/core/fetch-client.js";
import {
  CACHE_SUGGEST_PROMPT,
  COLLATION_SYSTEM_PROMPT,
  EXTRACTION_SYSTEM_PROMPT,
  SEARCH_SYSTEM_PROMPT,
} from "../src/core/prompts.js";
import { compatibilityKeyFor } from "../src/core/run-format.js";
import { captureNativeInjection, type NativeRegistryFacade, type RegistryStreamSimple } from "../src/native-injection.js";
import { withNativeSuggestionReadView } from "../src/native-suggestion-view.js";
import { createNativeUsageCapture } from "../src/native-usage.js";
import type { ModelFixtureRequest, UsageObservation } from "../scripts/benchmarks/contracts.js";
import { ReplayMissError } from "../scripts/benchmarks/replay-store.js";
import {
  createStudyCapture,
  createStudyReplay,
  loadStudyReplayBundle,
  resolveStudyModelNode,
  studyBundleSha256,
  StudyTransportError,
  verifyStudyReplayBundle,
  type StudyCaptureF7Options,
  type StudyReplayBundle,
} from "../scripts/benchmarks/study-transports.js";
import { forbidNetwork, removeDir, scratchDir } from "../scripts/benchmarks/testing.js";

const MODEL = { provider: "synthetic-openrouter", id: "synthetic/model", api: "synthetic" } as unknown as Model<Api>;
const MAX_BYTES = 65_536;
const FORBIDDEN_REGISTRY = {} as NativeRegistryFacade;
const NETWORK_GUARD = { fail: (message: string) => assert.fail(message) };

const contextOf = (systemPrompt: string, text: string): Context => ({
  systemPrompt,
  messages: [{ role: "user", content: [{ type: "text", text }], timestamp: 1 }],
});

const zeroUsage = (): AssistantMessage["usage"] => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

const assistant = (text: string, overrides: Partial<AssistantMessage> = {}): AssistantMessage => ({
  role: "assistant",
  content: text === "" ? [] : [{ type: "text", text }],
  api: MODEL.api,
  provider: MODEL.provider,
  model: MODEL.id,
  usage: zeroUsage(),
  stopReason: "stop",
  timestamp: 2,
  ...overrides,
});

const WIRE_EVENT = {
  id: "gen-synthetic-1",
  provider: "SyntheticRoute",
  model: "synthetic/routed-model",
  usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, cost: 0.002 },
};

/** Drives a model transport the way src/llm.ts does: one usage capture per attempt. */
async function callModel(
  transport: RegistryStreamSimple,
  systemPrompt: string,
  text: string,
  options: SimpleStreamOptions = {},
): Promise<{ message?: AssistantMessage; thrown?: Error; usage?: UsageObservation; events: unknown[] }> {
  const capture = createNativeUsageCapture();
  const events: unknown[] = [];
  const hooks: SimpleStreamOptions = {
    maxTokens: 500,
    reasoning: "low",
    ...options,
    onProviderStreamEvent: (event: unknown) => {
      events.push(event);
      capture.chunk(event);
    },
  };
  try {
    const message = await transport(FORBIDDEN_REGISTRY, MODEL, contextOf(systemPrompt, text), hooks);
    return { message, usage: capture.observation(message.usage), events };
  } catch (error) {
    return { thrown: error as Error, usage: capture.observation(undefined), events };
  }
}

async function drain(response: PageTransportResponse): Promise<string> {
  if (!response.body) return "";
  return new Response(response.body).text();
}

const pageRequest = (signal = new AbortController().signal, accept = "text/html") => ({
  method: "GET" as const,
  headers: { Accept: accept },
  browser: "chrome_145",
  signal,
});

const pageResponse = (
  url: string,
  chunks: readonly Uint8Array[],
  extra: { status?: number; headers?: Record<string, string>; onCancel?: () => void; failAfter?: Error } = {},
): PageTransportResponse => {
  let index = 0;
  return {
    status: extra.status ?? 200,
    url,
    headers: new Headers({ "content-type": "text/html", "set-cookie": "secret=1", ...extra.headers }),
    body: new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (index < chunks.length) {
            controller.enqueue(chunks[index++]!);
            return;
          }
          if (extra.failAfter) controller.error(extra.failAfter);
          else controller.close();
        },
        cancel() {
          extra.onCancel?.();
        },
      },
      { highWaterMark: 0 },
    ),
  };
};

const text = (value: string) => new TextEncoder().encode(value);

describe("study capture", () => {
  it("records a real-shape attempt with raw usage, routed fields and no extra headers", async () => {
    const before: ModelFixtureRequest[] = [];
    const after: Array<UsageObservation | undefined> = [];
    const capture = createStudyCapture({
      scenario: "synthetic-capture",
      maxResponseBytes: MAX_BYTES,
      beforeModelAttempt: async (request) => {
        before.push(request);
      },
      afterModelAttempt: (observation) => {
        after.push(observation);
      },
      liveRegistryTransport: async (_registry, _model, _context, options) => {
        await options?.onResponse?.({ status: 200, headers: { "retry-after": "1", authorization: "Bearer not-a-key", "x-secret": "s" } }, MODEL);
        await options?.onProviderStreamEvent?.(WIRE_EVENT, MODEL);
        return assistant("search answer", { responseId: "gen-synthetic-1", responseModel: "synthetic/routed-model" });
      },
    });
    const result = await callModel(capture.injection.registryStreamSimple!, SEARCH_SYSTEM_PROMPT, "question", { apiKey: "not-a-key" });
    assert.equal(result.message!.stopReason, "stop");
    assert.equal(before.length, 1);
    assert.equal(before[0]!.role, "search");
    assert.equal(before[0]!.userMessage, "question");
    assert.equal(after.length, 1);
    assert.equal(after[0]!.source, "provider-response");
    assert.equal(after[0]!.tokens.inputTotal, 100);
    assert.equal(after[0]!.tokens.cacheRead, undefined, "unreported cache subset stays absent, not zero");
    const attempt = capture.snapshot().attempts[0]!;
    assert.equal(attempt.outcome, "completed");
    const response = attempt.response as unknown as {
      providerResponse: { headers: Record<string, string> };
      capture: { routed: { provider: string[]; model: string[] }; responseModel: string };
    };
    assert.deepEqual(response.providerResponse.headers, { "retry-after": "1" });
    assert.deepEqual(response.capture.routed, { provider: ["SyntheticRoute"], model: ["synthetic/routed-model"] });
    assert.equal(response.capture.responseModel, "synthetic/routed-model");
    assert.doesNotMatch(JSON.stringify(capture.snapshot()), /not-a-key/);
  });

  it("uses the registry facade by default and accepts both injection modes", async () => {
    let registryCalls = 0;
    const registry = {
      streamSimple: () => {
        registryCalls += 1;
        return { result: async () => assistant("via registry") };
      },
    } as unknown as NativeRegistryFacade;
    const capture = createStudyCapture({ scenario: "synthetic-default", maxResponseBytes: MAX_BYTES });
    const message = await capture.injection.registryStreamSimple!(registry, MODEL, contextOf(SEARCH_SYSTEM_PROMPT, "q"), {});
    assert.equal(registryCalls, 1);
    assert.equal(message.stopReason, "stop");
    assert.equal(captureNativeInjection(capture.injection).mode, "unit");
    const replay = createStudyReplay(capture.exportBundle(), { onInvalid: () => {} });
    assert.equal(captureNativeInjection(replay.injection).mode, "transport-replay");
  });

  it("retains a default page transport rejection without spawning or reaching the network", async () => {
    const capture = createStudyCapture({ scenario: "synthetic-default-page", maxResponseBytes: MAX_BYTES });
    const controller = new AbortController();
    controller.abort(new Error("synthetic cancel"));
    await assert.rejects(capture.injection.pageTransport!("https://example.invalid/a", pageRequest(controller.signal)), /synthetic cancel/);
    const attempt = capture.snapshot().attempts[0]!;
    assert.equal(attempt.outcome, "cancelled");
    assert.equal(attempt.error!.kind, "abort");
  });

  it("refuses an unknown prompt before dispatch and stops further dispatch", async () => {
    let dispatched = 0;
    const faults: Error[] = [];
    const capture = createStudyCapture({
      scenario: "synthetic-unknown-prompt",
      maxResponseBytes: MAX_BYTES,
      onInvalid: (error) => faults.push(error),
      liveRegistryTransport: async () => {
        dispatched += 1;
        return assistant("x");
      },
    });
    const first = await callModel(capture.injection.registryStreamSimple!, "not a canonical prompt", "q");
    assert.ok(first.thrown instanceof ReplayMissError);
    const second = await callModel(capture.injection.registryStreamSimple!, SEARCH_SYSTEM_PROMPT, "q");
    assert.ok(second.thrown);
    assert.equal(dispatched, 0);
    assert.equal(faults.length, 1);
    assert.equal(capture.snapshot().rejectedCalls, 1);
    assert.throws(() => capture.assertComplete(), ReplayMissError);
  });

  it("retains an admission refusal, never dispatches it and invalidates the block", async () => {
    let dispatched = 0;
    const capture = createStudyCapture({
      scenario: "synthetic-refused",
      maxResponseBytes: MAX_BYTES,
      beforeModelAttempt: async () => {
        throw new Error("synthetic budget refusal");
      },
      liveRegistryTransport: async () => {
        dispatched += 1;
        return assistant("x");
      },
    });
    const result = await callModel(capture.injection.registryStreamSimple!, SEARCH_SYSTEM_PROMPT, "q");
    assert.match(result.thrown!.message, /synthetic budget refusal/);
    assert.equal(dispatched, 0);
    const attempt = capture.snapshot().attempts[0]!;
    assert.equal(attempt.state, "refused");
    assert.equal(attempt.occurrence, null);
    assert.equal(capture.fixtureFiles().model.fixtures.length, 0);
    assert.throws(() => capture.assertComplete(), (error: Error) => (error as StudyTransportError).fault === "admission-refused");
  });

  it("assigns occurrences in dispatch order even when identical requests settle in reverse", async () => {
    const gates: Array<() => void> = [];
    const replies = ["first dispatched", "second dispatched"];
    const capture = createStudyCapture({
      scenario: "synthetic-concurrent",
      maxResponseBytes: MAX_BYTES,
      liveRegistryTransport: async () => {
        const reply = replies[gates.length]!;
        await new Promise<void>((resolve) => gates.push(resolve));
        return assistant(reply);
      },
    });
    const transport = capture.injection.registryStreamSimple!;
    const one = callModel(transport, EXTRACTION_SYSTEM_PROMPT, "same page");
    const two = callModel(transport, EXTRACTION_SYSTEM_PROMPT, "same page");
    while (gates.length < 2) await new Promise((resolve) => setImmediate(resolve));
    assert.throws(() => capture.assertComplete(), (error: Error) => (error as StudyTransportError).fault === "capture-incomplete");
    assert.equal(capture.snapshot().pendingAttempts, 2);
    gates[1]!();
    await two;
    gates[0]!();
    await one;
    const bundle = capture.exportBundle();
    const responses = bundle.model.fixtures.map((record) => ({
      occurrence: record.key.occurrence,
      text: (record.response as { text: string }).text,
    }));
    assert.deepEqual(responses, [
      { occurrence: 1, text: "first dispatched" },
      { occurrence: 2, text: "second dispatched" },
    ]);
    const replay = createStudyReplay(bundle, { onInvalid: () => {} });
    const replayedOne = await callModel(replay.injection.registryStreamSimple!, EXTRACTION_SYSTEM_PROMPT, "same page");
    assert.equal(replayedOne.message!.content[0]!.type === "text" && replayedOne.message!.content[0]!.text, "first dispatched");
  });

  it("seals on completion: a late attempt is refused and invalidates", async () => {
    let dispatched = 0;
    const capture = createStudyCapture({
      scenario: "synthetic-seal",
      maxResponseBytes: MAX_BYTES,
      liveRegistryTransport: async () => {
        dispatched += 1;
        return assistant("x");
      },
    });
    await callModel(capture.injection.registryStreamSimple!, SEARCH_SYSTEM_PROMPT, "q");
    capture.assertComplete();
    const late = await callModel(capture.injection.registryStreamSimple!, SEARCH_SYSTEM_PROMPT, "q2");
    assert.equal((late.thrown as StudyTransportError).fault, "capture-sealed");
    assert.equal(dispatched, 1);
    assert.throws(() => capture.exportBundle(), /sealed/);
  });

  it("refuses an empty capture", () => {
    const capture = createStudyCapture({ scenario: "synthetic-empty", maxResponseBytes: MAX_BYTES });
    assert.throws(() => capture.assertComplete(), /no transport attempt/);
  });

  it("keeps the provider result when the spend callback fails, and invalidates the block", async () => {
    const capture = createStudyCapture({
      scenario: "synthetic-spend-fault",
      maxResponseBytes: MAX_BYTES,
      afterModelAttempt: () => {
        throw new Error("synthetic ledger failure");
      },
      liveRegistryTransport: async () => assistant("answer"),
    });
    const result = await callModel(capture.injection.registryStreamSimple!, SEARCH_SYSTEM_PROMPT, "q");
    assert.equal(result.message!.stopReason, "stop");
    assert.throws(() => capture.assertComplete(), (error: Error) => (error as StudyTransportError).fault === "spend-callback-failed");
  });

  it("reports at export time a frozen attempt that replay would refuse, and persists its journal", async () => {
    const root = await scratchDir("study-transports");
    try {
      const capture = createStudyCapture({
        scenario: "synthetic-unqualified",
        maxResponseBytes: MAX_BYTES,
        liveRegistryTransport: async (_registry, _model, _context, options) => {
          // A usage object the native capture does not understand: nothing is observed.
          await options?.onProviderStreamEvent?.({ usage: { unknown_field: 1 } }, MODEL);
          return assistant("answer");
        },
      });
      const result = await callModel(capture.injection.registryStreamSimple!, SEARCH_SYSTEM_PROMPT, "q");
      assert.equal(result.usage, undefined);
      assert.throws(() => capture.assertComplete(), /usage/);
      const manifest = await capture.persist(join(root, "capture"));
      assert.equal(manifest.complete, false);
      assert.equal(manifest.attempts, 1);
    } finally {
      await removeDir(root);
    }
  });

  it("rejects invalid options", () => {
    assert.throws(() => createStudyCapture({ scenario: "", maxResponseBytes: 1 }), StudyTransportError);
    assert.throws(() => createStudyCapture({ scenario: "s", maxResponseBytes: Number.POSITIVE_INFINITY }), StudyTransportError);
    assert.throws(() => createStudyCapture({ scenario: "s", maxResponseBytes: 1.5 }), StudyTransportError);
  });
});

describe("study capture and replay round trip", () => {
  it("replays success, provider failure, thrown failure and usage exactly, without any live path", async () => {
    const network = forbidNetwork(NETWORK_GUARD);
    try {
      const spend: Array<UsageObservation | undefined> = [];
      const replies: Array<(options: SimpleStreamOptions | undefined) => Promise<AssistantMessage>> = [
        // Wire usage with reported cost.
        async (options) => {
          await options?.onProviderStreamEvent?.(WIRE_EVENT, MODEL);
          return assistant("search answer", { responseId: "gen-synthetic-1" });
        },
        // HTTP 429 with no usage at all: the SDK zeros must not become an observation.
        async (options) => {
          await options?.onResponse?.({ status: 429, headers: { "retry-after": "2" } }, MODEL);
          return assistant("", { stopReason: "error", errorMessage: "429 rate limited" });
        },
        // Wire usage without cost: the catalogue estimate comes from the SDK.
        async (options) => {
          await options?.onProviderStreamEvent?.({ id: "gen-2", usage: { prompt_tokens: 40, completion_tokens: 4 } }, MODEL);
          const usage = zeroUsage();
          usage.cost = { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 };
          return assistant("extract answer", { usage });
        },
        // Transport rejection after a partial usage event: raw-only, unknown cost basis.
        async (options) => {
          await options?.onProviderStreamEvent?.({ id: "gen-3", usage: { prompt_tokens: 7 } }, MODEL);
          throw new Error("socket hang up");
        },
        // No wire usage: conservative SDK fallback.
        async () => {
          const usage = zeroUsage();
          usage.output = 9;
          return assistant("collate answer", { usage });
        },
      ];
      let call = 0;
      const capture = createStudyCapture({
        scenario: "synthetic-round-trip",
        maxResponseBytes: MAX_BYTES,
        afterModelAttempt: (observation) => {
          spend.push(observation);
        },
        liveRegistryTransport: (_registry, _model, _context, options) => replies[call++]!(options),
      });
      const script: Array<[string, string]> = [
        [SEARCH_SYSTEM_PROMPT, "question"],
        [EXTRACTION_SYSTEM_PROMPT, "page body"],
        [EXTRACTION_SYSTEM_PROMPT, "page body"],
        [COLLATION_SYSTEM_PROMPT, "extractions"],
        [COLLATION_SYSTEM_PROMPT, "extractions"],
      ];
      const live = [];
      for (const [prompt, message] of script) live.push(await callModel(capture.injection.registryStreamSimple!, prompt, message));
      assert.equal(spend.length, 5, "every dispatched attempt reaches the spend callback");
      assert.equal(spend[1], undefined, "a 429 with no usage stays unobserved");
      assert.equal(spend[3]!.costBasis, "unknown");

      const bundle = capture.exportBundle();
      assert.deepEqual(bundle.attemptCounts.model, { completed: 3, "provider-error": 1, cancelled: 0, throw: 1 });
      assert.equal(bundle.suggestion.mode, "raw-exact");

      const invalid: Error[] = [];
      const replay = createStudyReplay(bundle, { onInvalid: (error) => invalid.push(error) });
      const replayed = [];
      for (const [prompt, message] of script) replayed.push(await callModel(replay.injection.registryStreamSimple!, prompt, message));
      for (const [index, entry] of replayed.entries()) {
        assert.deepEqual(entry.usage, live[index]!.usage, `usage of attempt ${index}`);
        assert.equal(entry.thrown?.message, live[index]!.thrown?.message);
        assert.equal(entry.message?.stopReason, live[index]!.message?.stopReason);
        assert.equal(entry.message?.errorMessage, live[index]!.message?.errorMessage);
      }
      assert.equal(invalid.length, 0);
      const summary = replay.assertComplete();
      assert.deepEqual(summary.consumed, { model: 5, fetch: 0 });
      assert.deepEqual(summary.skipped, []);
      assert.equal(network.calls(), 0);
    } finally {
      network.restore();
    }
  });

  it("fails closed on a request the capture never saw and cancels the run once", async () => {
    const network = forbidNetwork(NETWORK_GUARD);
    try {
      const capture = createStudyCapture({
        scenario: "synthetic-miss",
        maxResponseBytes: MAX_BYTES,
        liveRegistryTransport: async () => assistant("answer"),
      });
      await callModel(capture.injection.registryStreamSimple!, SEARCH_SYSTEM_PROMPT, "recorded question");
      const invalid: Error[] = [];
      const replay = createStudyReplay(capture.exportBundle(), { onInvalid: (error) => invalid.push(error) });
      const miss = await callModel(replay.injection.registryStreamSimple!, SEARCH_SYSTEM_PROMPT, "different question");
      assert.ok(miss.thrown instanceof ReplayMissError);
      const after = await callModel(replay.injection.registryStreamSimple!, SEARCH_SYSTEM_PROMPT, "recorded question");
      assert.equal(after.thrown, miss.thrown, "an invalid block serves nothing further");
      assert.equal(invalid.length, 1);
      assert.throws(() => replay.assertComplete(), ReplayMissError);
      assert.equal(network.calls(), 0);
    } finally {
      network.restore();
    }
  });

  it("does not accept a run that stopped early unless skips are explicitly allowed", async () => {
    const capture = createStudyCapture({
      scenario: "synthetic-early-stop",
      maxResponseBytes: MAX_BYTES,
      liveRegistryTransport: async () => assistant("answer"),
    });
    await callModel(capture.injection.registryStreamSimple!, SEARCH_SYSTEM_PROMPT, "q");
    const replay = createStudyReplay(capture.exportBundle(), { onInvalid: () => {} });
    assert.throws(() => replay.assertComplete(), (error: Error) => (error as StudyTransportError).fault === "replay-incomplete");
    const summary = replay.assertComplete({ allowUnconsumed: true });
    assert.equal(summary.skipped.length, 1);
  });

  it("reproduces a recorded cancellation only when the replayed signal also aborts", async () => {
    const liveAbort = new AbortController();
    const capture = createStudyCapture({
      scenario: "synthetic-cancel",
      maxResponseBytes: MAX_BYTES,
      liveRegistryTransport: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        liveAbort.abort();
        return assistant("partial", { stopReason: "aborted", errorMessage: "Request was aborted" });
      },
    });
    const live = await callModel(capture.injection.registryStreamSimple!, SEARCH_SYSTEM_PROMPT, "q", { signal: liveAbort.signal });
    assert.equal(live.message!.stopReason, "aborted");
    const attempt = capture.snapshot().attempts[0]!;
    assert.equal(attempt.outcome, "cancelled");
    assert.equal(attempt.error!.kind, "cancelled");
    const bundle = capture.exportBundle();
    assert.equal(bundle.attemptCounts.model.cancelled, 1);

    const invalid: Error[] = [];
    const diverged = createStudyReplay(bundle, { onInvalid: (error) => invalid.push(error) });
    const notAborted = await callModel(diverged.injection.registryStreamSimple!, SEARCH_SYSTEM_PROMPT, "q");
    assert.match(notAborted.thrown!.message, /not reproduced/);
    assert.equal(invalid.length, 1);
    assert.throws(() => diverged.assertComplete());

    const matching = createStudyReplay(bundle, { onInvalid: () => assert.fail("a reproduced cancellation is valid") });
    const replayAbort = new AbortController();
    setTimeout(() => replayAbort.abort(), 1);
    const aborted = await callModel(matching.injection.registryStreamSimple!, SEARCH_SYSTEM_PROMPT, "q", { signal: replayAbort.signal });
    assert.equal(aborted.message!.stopReason, "aborted");
    matching.assertComplete();
  });

  it("keeps a thrown attempt under an aborted signal labelled cancelled", async () => {
    const liveAbort = new AbortController();
    liveAbort.abort(new Error("deadline"));
    const capture = createStudyCapture({
      scenario: "synthetic-cancel-throw",
      maxResponseBytes: MAX_BYTES,
      liveRegistryTransport: async () => {
        throw new Error("aborted in transit");
      },
    });
    const result = await callModel(capture.injection.registryStreamSimple!, SEARCH_SYSTEM_PROMPT, "q", { signal: liveAbort.signal });
    assert.match(result.thrown!.message, /aborted in transit/);
    const attempt = capture.snapshot().attempts[0]!;
    assert.equal(attempt.outcome, "cancelled");
    assert.equal(attempt.error!.kind, "throw");
    const invalid: Error[] = [];
    const replay = createStudyReplay(capture.exportBundle(), { onInvalid: (error) => invalid.push(error) });
    const diverged = await callModel(replay.injection.registryStreamSimple!, SEARCH_SYSTEM_PROMPT, "q");
    assert.match(diverged.thrown!.message, /not reproduced/);
    assert.equal(invalid.length, 1);
  });
});

describe("study page capture", () => {
  const URL_A = "https://example.invalid/a";

  it("captures full bytes, retains only client headers and replays them exactly", async () => {
    const network = forbidNetwork(NETWORK_GUARD);
    try {
      const bytes = Uint8Array.from([0xff, 0x00, 0x41, 0xfe]);
      const capture = createStudyCapture({
        scenario: "synthetic-page",
        maxResponseBytes: MAX_BYTES,
        livePageTransport: async (url) => pageResponse(url, [bytes.subarray(0, 2), bytes.subarray(2)], { headers: { "content-length": "4" } }),
      });
      const live = await capture.injection.pageTransport!(URL_A, pageRequest());
      assert.equal(capture.snapshot().attempts[0]!.state, "in-flight", "open until the body settles");
      const liveBytes = new Uint8Array(await new Response(live.body).arrayBuffer());
      assert.deepEqual(liveBytes, bytes);
      const attempt = capture.snapshot().attempts[0]!;
      assert.equal(attempt.outcome, "completed");
      const response = attempt.response as unknown as { headers: Record<string, string>; bodyBase64: string };
      assert.equal(response.headers["set-cookie"], undefined);
      assert.equal(response.headers["content-length"], "4");
      const replay = createStudyReplay(capture.exportBundle(), { onInvalid: () => assert.fail("valid replay") });
      const replayed = await replay.injection.pageTransport!(URL_A, pageRequest());
      assert.deepEqual(new Uint8Array(await new Response(replayed.body).arrayBuffer()), bytes);
      assert.equal(replayed.headers.get("content-type"), "text/html");
      replay.assertComplete();
      assert.equal(network.calls(), 0);
    } finally {
      network.restore();
    }
  });

  it("does not read ahead, and forwards consumer cancellation to the live body", async () => {
    let pulls = 0;
    let cancelled = 0;
    const capture = createStudyCapture({
      scenario: "synthetic-cancel-body",
      maxResponseBytes: MAX_BYTES,
      livePageTransport: async (url) => ({
        status: 404,
        url,
        headers: new Headers({ "content-type": "text/html" }),
        body: new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              pulls += 1;
              controller.enqueue(text("chunk"));
            },
            cancel() {
              cancelled += 1;
            },
          },
          { highWaterMark: 0 },
        ),
      }),
    });
    const response = await capture.injection.pageTransport!(URL_A, pageRequest());
    const reader = response.body!.getReader();
    assert.equal(pulls, 0, "no byte is read before the consumer asks");
    await reader.read();
    assert.equal(pulls, 1);
    await reader.cancel();
    assert.equal(cancelled, 1);
    const attempt = capture.snapshot().attempts[0]!;
    assert.equal(attempt.outcome, "consumer-cancelled");
    assert.equal(attempt.error, undefined);
    const details = (attempt.response as unknown as { capture: { retainedBytes: number } }).capture;
    assert.equal(details.retainedBytes, 5);
  });

  it("settles an aborted body as cancelled with the bytes seen, and replay enforces it", async () => {
    const controller = new AbortController();
    const capture = createStudyCapture({
      scenario: "synthetic-abort-body",
      maxResponseBytes: MAX_BYTES,
      livePageTransport: async (url) => pageResponse(url, [text("part"), text("more")]),
    });
    const response = await capture.injection.pageTransport!(URL_A, pageRequest(controller.signal));
    const reader = response.body!.getReader();
    await reader.read();
    controller.abort(new Error("synthetic deadline"));
    await reader.cancel();
    const attempt = capture.snapshot().attempts[0]!;
    assert.equal(attempt.outcome, "cancelled");
    assert.deepEqual(attempt.error, { kind: "abort", message: "synthetic deadline" });
    assert.equal(
      Buffer.from((attempt.response as unknown as { bodyBase64: string }).bodyBase64, "base64").toString(),
      "part",
    );
    const invalid: Error[] = [];
    const replay = createStudyReplay(capture.exportBundle(), { onInvalid: (error) => invalid.push(error) });
    await assert.rejects(replay.injection.pageTransport!(URL_A, pageRequest()), /not reproduced/);
    assert.equal(invalid.length, 1);
  });

  it("retains a mid-body failure and its partial bytes", async () => {
    const capture = createStudyCapture({
      scenario: "synthetic-body-error",
      maxResponseBytes: MAX_BYTES,
      livePageTransport: async (url) => pageResponse(url, [text("part")], { failAfter: new Error("connection reset") }),
    });
    const response = await capture.injection.pageTransport!(URL_A, pageRequest());
    await assert.rejects(drain(response), /connection reset/);
    const attempt = capture.snapshot().attempts[0]!;
    assert.equal(attempt.outcome, "body-error");
    assert.equal(attempt.error!.kind, "body-error");
    const replay = createStudyReplay(capture.exportBundle(), { onInvalid: () => assert.fail("a recorded failure is valid") });
    await assert.rejects(replay.injection.pageTransport!(URL_A, pageRequest()), /connection reset/);
    replay.assertComplete();
  });

  it("retains a transport rejection", async () => {
    const capture = createStudyCapture({
      scenario: "synthetic-page-throw",
      maxResponseBytes: MAX_BYTES,
      livePageTransport: async () => {
        throw new Error("Page transport request failed");
      },
    });
    await assert.rejects(capture.injection.pageTransport!(URL_A, pageRequest()), /request failed/);
    assert.equal(capture.snapshot().attempts[0]!.outcome, "throw");
    assert.equal(capture.exportBundle().attemptCounts.fetch.throw, 1);
  });

  it("invalidates, without interrupting the consumer, when reading continues past the bound", async () => {
    const big = new Uint8Array(70_000);
    const capture = createStudyCapture({
      scenario: "synthetic-overflow",
      maxResponseBytes: MAX_BYTES,
      livePageTransport: async (url) => pageResponse(url, [big, text("tail")]),
    });
    const response = await capture.injection.pageTransport!(URL_A, pageRequest());
    assert.equal((await new Response(response.body).arrayBuffer()).byteLength, 70_004, "the consumer keeps its own limit authority");
    const attempt = capture.snapshot().attempts[0]!;
    const details = (attempt.response as unknown as { capture: { retainedBytes: number; observedBytes: number; truncatedAtCapture: boolean } }).capture;
    assert.equal(details.retainedBytes, 70_000, "retention stops once the crossing chunk is kept");
    assert.equal(details.observedBytes, 70_004);
    assert.equal(details.truncatedAtCapture, true);
    assert.throws(() => capture.assertComplete(), (error: Error) => (error as StudyTransportError).fault === "capture-overflow");
  });

  it("keeps a whole crossing chunk, so a body ending there stays exact and exportable", async () => {
    const big = new Uint8Array(70_000).fill(0x62);
    const capture = createStudyCapture({
      scenario: "synthetic-crossing-chunk",
      maxResponseBytes: MAX_BYTES,
      livePageTransport: async (url) => pageResponse(url, [big]),
    });
    await drain(await capture.injection.pageTransport!(URL_A, pageRequest()));
    const replay = createStudyReplay(capture.exportBundle(), { onInvalid: () => assert.fail("valid replay") });
    const replayed = await replay.injection.pageTransport!(URL_A, pageRequest());
    assert.deepEqual(new Uint8Array(await new Response(replayed.body).arrayBuffer()), big);
  });

  it("reaches the same bounded outcome through the real fetch client in capture and replay", async () => {
    // A body one chunk over the limit, read by the actual FetchClient.
    const oversized = new Uint8Array(MAX_BYTES).fill(0x61);
    const capture = createStudyCapture({
      scenario: "synthetic-real-client",
      maxResponseBytes: MAX_BYTES,
      livePageTransport: async (url, request) =>
        request.headers["Accept"] === "text/markdown"
          ? pageResponse(url, [text("not found")], { status: 404 })
          : pageResponse(url, [oversized, text("beyond-the-limit")]),
    });
    const run = async (transport: PageTransport) => {
      const clock = createSystemClock();
      const coordinator = createExecutionCoordinator({
        generation: 1,
        clock,
        modelConcurrency: 2,
        criticalReserve: 1,
        fetchConcurrency: 2,
        minRequestIntervalMs: 0,
      });
      const operation = coordinator.begin("synthetic-fetch");
      const client = createFetchClient({
        operation,
        clock,
        transport,
        browser: "chrome_145",
        timeoutMs: 20_000,
        concurrency: 2,
        maxResponseBytes: MAX_BYTES,
        docsMaxResponseBytes: MAX_BYTES,
        maxChars: 500_000,
      });
      const result = await client.fetch({ url: URL_A }, operation);
      await operation.settle();
      await coordinator.close();
      return result;
    };
    const live = await run(capture.injection.pageTransport!);
    assert.equal(live.page.state, "fetch-failed");
    assert.equal(live.page.diagnostic, "RESPONSE_TOO_LARGE");
    const outcomes = capture.snapshot().attempts.map((attempt) => attempt.outcome);
    assert.ok(outcomes.every((outcome) => outcome === "consumer-cancelled" || outcome === "completed"), String(outcomes));
    const invalid: Error[] = [];
    const replay = createStudyReplay(capture.exportBundle(), { onInvalid: (error) => invalid.push(error) });
    const replayed = await run(replay.injection.pageTransport!);
    assert.equal(replayed.page.state, live.page.state);
    assert.equal(replayed.page.diagnostic, live.page.diagnostic);
    assert.deepEqual(invalid, []);
    replay.assertComplete();
  });
});

describe("study bundle integrity", () => {
  const completeBundle = async (): Promise<StudyReplayBundle> => {
    const capture = createStudyCapture({
      scenario: "synthetic-integrity",
      maxResponseBytes: MAX_BYTES,
      liveRegistryTransport: async () => assistant("answer"),
      livePageTransport: async (url) => pageResponse(url, [text("body")]),
    });
    await callModel(capture.injection.registryStreamSimple!, SEARCH_SYSTEM_PROMPT, "q");
    await drain(await capture.injection.pageTransport!("https://example.invalid/a", pageRequest()));
    return capture.exportBundle();
  };

  it("refuses tampered fixtures, digests and suggestion claims", async () => {
    const bundle = await completeBundle();
    verifyStudyReplayBundle(bundle);
    const copy = () => structuredClone(bundle) as unknown as { [key: string]: never };
    const tamper = (change: (value: any) => void): StudyReplayBundle => {
      const value = copy();
      change(value);
      return value as unknown as StudyReplayBundle;
    };
    assert.throws(() => verifyStudyReplayBundle(tamper((v) => { v.model.fixtures[0].response.text = "forged"; })), /contentSha256/);
    assert.throws(() => verifyStudyReplayBundle(tamper((v) => { v.modelSha256 = "0".repeat(64); })), /digest/);
    assert.throws(() => verifyStudyReplayBundle(tamper((v) => { v.scenario = "other"; })), /different scenario/);
    assert.throws(() => verifyStudyReplayBundle(tamper((v) => { v.maxResponseBytes = 70_000; })), /byte bound/);
    assert.throws(() => verifyStudyReplayBundle(tamper((v) => { v.suggestion.reusableAcrossGeneratedPaths = true; })), /cannot claim/);
    assert.throws(() => verifyStudyReplayBundle(tamper((v) => { v.suggestion.mode = "other"; })), /unknown suggestion mode/);
    assert.throws(() => createStudyReplay(tamper((v) => { v.fetchSha256 = "0".repeat(64); }), { onInvalid: () => {} }), /digest/);
  });

  it("requires a cancelling callback and refuses F7 options on a raw bundle", async () => {
    const bundle = await completeBundle();
    assert.throws(() => createStudyReplay(bundle, {} as never), /onInvalid/);
    assert.throws(
      () => createStudyReplay(bundle, { onInvalid: () => {}, f7: { budgetMs: 10, displayRoot: ".search" } }),
      /no F7 artefact/,
    );
  });

  it("persists a complete capture once and reloads it", async () => {
    const root = await scratchDir("study-transports");
    try {
      const capture = createStudyCapture({
        scenario: "synthetic-persist",
        maxResponseBytes: MAX_BYTES,
        liveRegistryTransport: async () => assistant("answer"),
      });
      await callModel(capture.injection.registryStreamSimple!, SEARCH_SYSTEM_PROMPT, "q");
      const target = join(root, "capture");
      const manifest = await capture.persist(target);
      assert.equal(manifest.complete, true);
      const loaded = await loadStudyReplayBundle(join(target, "bundle.json"));
      assert.equal(studyBundleSha256(loaded), manifest.bundleSha256);
      await assert.rejects(capture.persist(target), /EEXIST/, "evidence is never overwritten");
      await assert.rejects(loadStudyReplayBundle(join(target, "missing.json")), StudyTransportError);
    } finally {
      await removeDir(root);
    }
  });

  it("persists the journal of a failed block, with no bundle", async () => {
    const root = await scratchDir("study-transports");
    try {
      const capture = createStudyCapture({
        scenario: "synthetic-persist-failed",
        maxResponseBytes: MAX_BYTES,
        beforeModelAttempt: async () => {
          throw new Error("synthetic refusal");
        },
        liveRegistryTransport: async () => assistant("never"),
      });
      await callModel(capture.injection.registryStreamSimple!, SEARCH_SYSTEM_PROMPT, "q");
      const target = join(root, "capture");
      const manifest = await capture.persist(target);
      assert.equal(manifest.complete, false);
      assert.match(manifest.incompleteReason!, /refused/);
      const journal = JSON.parse(await readFile(join(target, "attempts.json"), "utf8"));
      assert.equal(journal.attempts[0].state, "refused");
      await assert.rejects(readFile(join(target, "bundle.json")), /ENOENT/);
    } finally {
      await removeDir(root);
    }
  });

  it("persists pending attempts as incomplete", async () => {
    const root = await scratchDir("study-transports");
    try {
      const capture = createStudyCapture({
        scenario: "synthetic-persist-pending",
        maxResponseBytes: MAX_BYTES,
        livePageTransport: async (url) => pageResponse(url, [text("x")]),
      });
      await capture.injection.pageTransport!("https://example.invalid/a", pageRequest());
      const manifest = await capture.persist(join(root, "capture"));
      assert.equal(manifest.complete, false);
      assert.equal(manifest.pendingAttempts, 1);
    } finally {
      await removeDir(root);
    }
  });
});

describe("study F7 suggestion wiring", () => {
  const DISPLAY_ROOT = ".search";
  const DATE = "2026-10-23";
  const QUERY_A = "alpha query";
  const QUERY_B = "beta query";
  const WORKFLOW = [
    { node: "research-alpha", query: QUERY_A, occurrence: 1 },
    { node: "research-beta", query: QUERY_B, occurrence: 1 },
  ] as const;
  const BASELINE = [
    {
      query: "prior search",
      reportPath: `${DISPLAY_ROOT}/2026-10-20-prior-search-1a2b3c/report.md`,
      namespace: "legacy" as const,
      startedUtc: "2026-10-20T08:00:00.000Z",
      compatibilityKey: compatibilityKeyFor("prior search", "2026-10-20"),
    },
  ];
  const F7: StudyCaptureF7Options = {
    block: "block-1",
    workflow: WORKFLOW,
    baseline: BASELINE,
    displayRoot: DISPLAY_ROOT,
    initialTreeDigest: "1".repeat(64),
    scheduleManifestSha256: "2".repeat(64),
  };

  const reservation = (query: string, runId: string, sequence: number): RunReservation => ({
    namespaceId: "a".repeat(32),
    runId,
    sequence,
    startedUtc: `${DATE}T09:00:00.000Z`,
    compatibilityKey: compatibilityKeyFor(query, DATE),
    physicalPath: `/cache/.intelli-v1/runs/${runId}`,
    displayPath: `${DISPLAY_ROOT}/.intelli-v1/runs/${runId}`,
  });
  const rowOf = (query: string, value: RunReservation): IndexCandidate => ({
    query,
    reportPath: `${value.displayPath}/report.md`,
    namespace: "v1",
    startedUtc: value.startedUtc,
    compatibilityKey: value.compatibilityKey,
    admissionSequence: value.sequence,
  });
  const runOf = (value: RunReservation): CommittedRun => ({ reservation: value, files: [], manifestSha256: "f".repeat(64) });
  const suggestionMessage = (query: string, view: readonly IndexCandidate[]): string =>
    `Current query: "${query}"\n\nPrevious searches:\n` +
    view
      .map(
        (row, index) =>
          `${index + 1}. "${row.query}" (slug: ${relative(DISPLAY_ROOT, dirname(row.reportPath))}, searched: ${row.startedUtc})`,
      )
      .join("\n");

  /** Runs alpha then beta through the real native wrapper. Beta's view contains alpha's generated path. */
  async function driveBlock(
    injection: { suggestionReadView?: Parameters<typeof withNativeSuggestionReadView>[1]; registryStreamSimple?: RegistryStreamSimple },
    runIds: readonly [string, string],
    witness: (input: { query: string; outcome: "settled" }) => void,
  ) {
    const reservations = new Map([
      [QUERY_A, reservation(QUERY_A, runIds[0], 50)],
      [QUERY_B, reservation(QUERY_B, runIds[1], 51)],
    ]);
    let rows: readonly IndexCandidate[] = [...BASELINE];
    const clock = createSystemClock();
    const coordinator = createExecutionCoordinator({
      generation: 1,
      clock,
      modelConcurrency: 4,
      criticalReserve: 1,
      fetchConcurrency: 2,
      minRequestIntervalMs: 0,
    });
    const store = {
      allocate: async (input: { query: string }) => ({ status: "allocated", reservation: reservations.get(input.query)! }),
      commit: async (value: RunReservation) => ({ status: "committed", run: runOf(value) }),
      updateIndex: async () => "updated",
      recordAccounting: async () => ({ status: "recorded", path: "/accounting" }),
      candidates: async () => rows,
      settle: async () => {},
    } as unknown as Parameters<typeof withNativeSuggestionReadView>[0];
    const results: Array<{ message?: AssistantMessage; thrown?: Error }> = [];
    for (const query of [QUERY_A, QUERY_B]) {
      const operation = coordinator.begin(`op-${query}`);
      const wrapper = withNativeSuggestionReadView(store, injection.suggestionReadView!, operation);
      const allocation = await wrapper.allocate({ operationId: operation.id, query, startedUtc: `${DATE}T09:00:00.000Z`, signal: operation.signal });
      assert.equal(allocation.status, "allocated");
      const reserved = (allocation as { reservation: RunReservation }).reservation;
      await wrapper.commit(reserved, [], operation.signal);
      await wrapper.updateIndex(runOf(reserved), query, operation.signal);
      const view = await wrapper.candidates(reserved, query, operation.signal);
      results.push(await callModel(injection.registryStreamSimple!, CACHE_SUGGEST_PROMPT, suggestionMessage(query, view)));
      rows = [rowOf(query, reserved), ...rows];
      await wrapper.settle();
      await operation.settle();
      witness({ query, outcome: "settled" });
    }
    await coordinator.close();
    return results;
  }

  it("replays suggestion answers across different generated run paths", async () => {
    const asked: string[] = [];
    const capture = createStudyCapture({
      scenario: "synthetic-f7",
      maxResponseBytes: MAX_BYTES,
      f7: F7,
      liveRegistryTransport: async (_registry, _model, context) => {
        const part = context.messages[0]!.content[0] as { text: string };
        asked.push(part.text);
        return assistant(`judged ${asked.length}`);
      },
    });
    assert.equal(capture.suggestionMode, "f7");
    await driveBlock(capture.injection, ["capture-run-alpha", "capture-run-beta"], (input) => capture.reportHostWitness(input));
    assert.match(asked[1]!, /capture-run-alpha/);
    const bundle = capture.exportBundle();
    assert.equal(bundle.suggestion.mode, "f7");
    assert.ok(bundle.model.fixtures.every((record) => record.key.operationNode.endsWith(".suggest")));
    assert.doesNotMatch(JSON.stringify(bundle.model.fixtures.map((record) => record.request)), /capture-run-alpha/);

    const invalid: Error[] = [];
    const replay = createStudyReplay(bundle, {
      onInvalid: (error) => invalid.push(error),
      f7: {
        budgetMs: 2_000,
        displayRoot: DISPLAY_ROOT,
        expectedInitialTreeDigest: F7.initialTreeDigest,
        expectedScheduleManifestSha256: F7.scheduleManifestSha256,
      },
    });
    const results = await driveBlock(replay.injection, ["replay-run-alpha", "replay-run-beta"], (input) => replay.reportHostWitness(input));
    assert.deepEqual(results.map((result) => result.message?.content[0]), [
      { type: "text", text: "judged 1" },
      { type: "text", text: "judged 2" },
    ]);
    assert.deepEqual(invalid, []);
    const summary = replay.assertComplete();
    assert.equal(summary.consumed.model, 2);
  });

  it("fails closed on a changed pinned identity, a missing option and an incomplete F7 block", async () => {
    const capture = createStudyCapture({
      scenario: "synthetic-f7-identity",
      maxResponseBytes: MAX_BYTES,
      f7: F7,
      liveRegistryTransport: async () => assistant("judged"),
    });
    await driveBlock(capture.injection, ["capture-a", "capture-b"], (input) => capture.reportHostWitness(input));
    const bundle = capture.exportBundle();
    assert.throws(() => createStudyReplay(bundle, { onInvalid: () => {} }), /requires f7 replay options/);
    assert.throws(
      () =>
        createStudyReplay(bundle, {
          onInvalid: () => {},
          f7: { budgetMs: 100, displayRoot: DISPLAY_ROOT, expectedInitialTreeDigest: "9".repeat(64) },
        }),
      /initial tree digest changed/,
    );
    const replay = createStudyReplay(bundle, { onInvalid: () => {}, f7: { budgetMs: 100, displayRoot: DISPLAY_ROOT } });
    assert.throws(() => replay.assertComplete({ allowUnconsumed: true }), "F7 completeness is not waived by allowing skips");
  });

  it("does not export an F7 capture whose prescribed block never ran", async () => {
    const capture = createStudyCapture({
      scenario: "synthetic-f7-incomplete",
      maxResponseBytes: MAX_BYTES,
      f7: F7,
      liveRegistryTransport: async () => assistant("answer"),
    });
    await callModel(capture.injection.registryStreamSimple!, SEARCH_SYSTEM_PROMPT, "q");
    assert.throws(() => capture.assertComplete(), /never started/);
  });

  it("freezes a raw suggestion without F7 and fails closed when its generated path changes", async () => {
    const capture = createStudyCapture({
      scenario: "synthetic-raw-suggest",
      maxResponseBytes: MAX_BYTES,
      liveRegistryTransport: async () => assistant("judged"),
    });
    const generated = (run: string) => `Current query: "q"\n\nPrevious searches:\n1. "prior" (slug: .intelli-v1/runs/${run}, searched: 2026-10-23T09:00:00.000Z)`;
    assert.equal(capture.injection.suggestionReadView, undefined);
    await callModel(capture.injection.registryStreamSimple!, CACHE_SUGGEST_PROMPT, generated("run-1"));
    const bundle = capture.exportBundle();
    assert.deepEqual(bundle.suggestion, { mode: "raw-exact", reusableAcrossGeneratedPaths: false, rawSuggestRequests: 1 });
    const exact = createStudyReplay(bundle, { onInvalid: () => assert.fail("exact path is valid") });
    assert.equal((await callModel(exact.injection.registryStreamSimple!, CACHE_SUGGEST_PROMPT, generated("run-1"))).message!.stopReason, "stop");
    exact.assertComplete();
    const invalid: Error[] = [];
    const changed = createStudyReplay(bundle, { onInvalid: (error) => invalid.push(error) });
    const miss = await callModel(changed.injection.registryStreamSimple!, CACHE_SUGGEST_PROMPT, generated("run-2"));
    assert.ok(miss.thrown instanceof ReplayMissError);
    assert.equal(invalid.length, 1);
  });

  it("derives stable identities from exact content and the canonical prompts", () => {
    const base = { model: { provider: "p", model: "m" }, systemPrompt: SEARCH_SYSTEM_PROMPT, userMessage: "q", maxTokens: 1, reasoning: "low", effectivePayloadPatch: null };
    const resolve = (request: typeof base) => resolveStudyModelNode(request, MODEL, contextOf("", ""));
    assert.deepEqual(resolve(base), resolve({ ...base }));
    assert.notDeepEqual(resolve(base), resolve({ ...base, userMessage: "Q" }));
    assert.ok("ambiguous" in resolve({ ...base, systemPrompt: `${SEARCH_SYSTEM_PROMPT} ` }));
  });
});
