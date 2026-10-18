// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
// Compile-only consumers of P0-1. This is not an executable feature test.
import {
  createExecutionCoordinator, createAttemptLedger, createRunStore,
  runModelWithPolicy, fetchPage, research,
  type Clock, type Context, type CompactData, type CoreResult,
  type NativeTestInjection, type ResearchExecutionSettings,
  type ReplayStore, type RunObservation,
} from "./API.js";

declare const clock: Clock;
declare const context: Context;
declare const replay: ReplayStore;
declare const observation: RunObservation;
const coordinator = createExecutionCoordinator({
  modelConcurrency: 5, criticalReserve: 1, fetchConcurrency: 4,
  minRequestIntervalMs: 0, generation: 1, clock,
});
const operation = coordinator.begin("op-1", new AbortController().signal);
const ledger = createAttemptLedger();
const scope = { operation, ledger, callId: "call-1", role: "extract" as const, pageId: "S1" };
void runModelWithPolicy(async (control) => {
  control.observe({ tokens: { inputTotal: 5, cacheRead: 2, inputUncached: 3, outputTotal: 1 }, source: "provider-response", costBasis: "reported", cost: { total: 0.001 } });
  return { value: "extracted" };
}, { model: { provider: "fixture", model: "extract" }, timeoutMs: 1000 }, { scope, coordinator, clock, logger: { error: () => {}, warn: () => {} } });
const disabled: ResearchExecutionSettings["deadline"] = { enabled: false };
const enabled: ResearchExecutionSettings["deadline"] = { enabled: true, quorum: 0.5, factor: 1, floorMs: 0, ceilingMs: 1000, minSources: 1 };
// @ts-expect-error Enabled policies cannot silently inherit missing numbers.
const incomplete: ResearchExecutionSettings["deadline"] = { enabled: true };
void [disabled, enabled, incomplete];

async function nativeWrapper(): Promise<CoreResult> {
  const result = await fetchPage({ url: "https://example.com/", maxChars: 1000 }, context);
  const text = result.data.sources[0]?.content;
  if (text !== undefined) text.slice(0, 10);
  return result;
}
const injection: NativeTestInjection = { operations: { fetchPage: nativeWrapper }, transformContext: (ctx) => ({ ...ctx, models: { ...ctx.models, complete: async () => ({ text: "fixture", citations: [] }) } }) };
void injection;
void research({ query: "public fixture", maxUrls: 3, focusPrompt: "contracts" }, context);
const runs = createRunStore({ workspaceRoot: ".", cacheRoot: ".search", displayRoot: ".search", clock, randomId: () => "fixture-id", onDiagnostic: () => {} });
async function publication(): Promise<void> {
  const allocated = await runs.allocate({ operationId: "op-1", query: "fixture", startedUtc: clock.utcIso(), signal: operation.signal });
  if (allocated.status === "unavailable") { allocated.diagnostic.code.toLowerCase(); return; }
  const committed = await runs.commit(allocated.reservation, [{ relativePath: "report.md", bytes: new TextEncoder().encode("report"), kind: "report" }], operation.signal);
  await runs.updateIndex(committed, "fixture", operation.signal);
  const candidates = await runs.candidates(allocated.reservation, "fixture", operation.signal);
  candidates[0]?.namespace satisfies "v1" | "legacy" | undefined;
  await runs.settle();
}
void publication;
function compact(result: CoreResult): CompactData {
  return {
    outcome: result.outcome, text: result.text, details: result.details,
    meta: { schemaVersion: 1, operation: result.data.operation, operationId: result.data.operationId, persistence: result.data.cache.status, counts: result.data.counts, elapsedMs: result.data.timing.elapsedMs, attempts: result.data.accounting.attempts, missingAttempts: result.data.accounting.missingAttempts, costComplete: result.data.accounting.costComplete },
  };
}
void compact;
void replay.lookup({ boundary: "model", scenario: "forced-1", operationNode: "search", requestSha256: "a".repeat(64), occurrence: 1 }, { query: "fixture" });
observation.mainUsage?.inputUncached satisfies number | undefined;
