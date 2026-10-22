// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { asJson } from "../scripts/benchmarks/canonical.js";
import {
  createReplayStore,
  createFixtureRecorder,
  ReplayMissError,
} from "../scripts/benchmarks/replay-store.js";
import {
  createModelTransportReplay,
  createPageTransportReplay,
} from "../scripts/benchmarks/transport-replay.js";
import { mainUsageEvidence, parseUsageEvents } from "../scripts/benchmarks/usage-parser.js";

const model = { provider: "fixture", id: "fixture", api: "openai-completions" } as Model<Api>;

test("resolver and construction ambiguity invalidate the store even before any lookup (M3 F1)", async () => {
  const scenario = "validity";
  const modelStore = createReplayStore({ scenario, fixtures: [] });
  const modelReplay = createModelTransportReplay({
    store: modelStore,
    scenario,
    resolveNode: () => ({ ambiguous: true, detail: "two nodes" }),
  });
  await assert.rejects(
    modelReplay(
      {
        streamSimple() {
          throw new Error("live forbidden");
        },
      } as never,
      model,
      { messages: [] },
    ),
    ReplayMissError,
  );
  assert.equal(modelStore.consumed().length, 0);
  assert.equal(modelStore.invalidations().length, 1);
  assert.throws(() => modelStore.assertValid(), ReplayMissError);
  const pageStore = createReplayStore({ scenario, fixtures: [] });
  const pages = createPageTransportReplay({
    store: pageStore,
    scenario,
    maxResponseBytes: 65536,
    resolveNode: () => ({ ambiguous: true, detail: "two pages" }),
  });
  await assert.rejects(
    pages("https://fixture.invalid", {
      method: "GET",
      headers: {},
      browser: "fixture",
      signal: new AbortController().signal,
    }),
    ReplayMissError,
  );
  assert.equal(pageStore.consumed().length, 0);
  assert.equal(pageStore.invalidations().length, 1);
  assert.throws(() => pageStore.assertValid(), ReplayMissError);
  const recorder = createFixtureRecorder({ scenario, boundary: "model" });
  for (const node of ["one", "two"])
    recorder.record(node, { request: "identical" }, { response: { text: "answer" }, delayMs: 0 });
  const ambiguous = createReplayStore({ scenario, fixtures: recorder.records() });
  assert.throws(
    () =>
      createModelTransportReplay({
        store: ambiguous,
        scenario,
        resolveNode: () => ({ operationNode: "one", role: "search" }),
      }),
    ReplayMissError,
  );
  assert.equal(ambiguous.invalidations().length, 1);
  assert.throws(() => ambiguous.assertValid(), ReplayMissError);
});

test("all-zero SDK main usage stays unknown unless correlated wire-presence evidence confirms observed zero (M3 F2)", () => {
  const message = asJson({
    role: "assistant",
    provider: "fixture",
    model: "main",
    responseId: "a1",
    timestamp: 1,
    content: [],
    stopReason: "stop",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
  });
  const event = asJson({ type: "message_end", message });
  for (const mode of ["json", "rpc"] as const) {
    const absent = parseUsageEvents([event], mode);
    assert.equal(absent.assistantMessages[0].usage, null);
    assert.deepEqual(absent.missing, ["a1"]);
    const observed = parseUsageEvents([event, mainUsageEvidence(message, true)], mode);
    assert.deepEqual(observed.assistantMessages[0].usage, {
      inputTotal: 0,
      inputUncached: 0,
      outputTotal: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
    });
    assert.deepEqual(observed.missing, []);
    const conflict = parseUsageEvents(
      [mainUsageEvidence(message, false), event, mainUsageEvidence(message, true)],
      mode,
    );
    assert.equal(conflict.assistantMessages[0].usage, null);
    assert.deepEqual(conflict.missing, ["a1"]);
    const other = asJson({ role: "assistant", responseId: "other" });
    assert.equal(
      parseUsageEvents([event, mainUsageEvidence(other, true)], mode).assistantMessages[0].usage,
      null,
    );
    const deduped = parseUsageEvents(
      [event, event, mainUsageEvidence(message, true), asJson({ type: "turn_end", message })],
      mode,
    );
    assert.equal(deduped.assistantMessages.length, 1);
  }
});
