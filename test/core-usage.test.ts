// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AttemptIdentity, ModelUsage, UsageObservation } from "../src/core/contracts.js";
import {
  TOKEN_FIELDS,
  createAttemptLedger,
  hostCostBasis,
  normalizeMcpUsage,
  normalizeNativeUsage,
} from "../src/core/usage.js";

const model = { provider: "fixture", model: "m" };

function id(attempt: number, callId = "call-1"): AttemptIdentity {
  return { operationId: "op", callId, attempt, model, role: "extract", pageId: "S1" };
}

function reported(total: number, tokens: UsageObservation["tokens"] = {}): UsageObservation {
  return { tokens, cost: { total }, source: "provider-response", costBasis: "reported" };
}

function catalogue(total: number, tokens: UsageObservation["tokens"] = {}): UsageObservation {
  return { tokens, cost: { total, input: total / 2, output: total / 2 }, source: "sdk-normalized", costBasis: "catalogue" };
}

describe("C16 attempt ledger (T16 library portion)", () => {
  it("keeps the latest cumulative snapshot per attempt instead of summing updates", () => {
    const ledger = createAttemptLedger();
    ledger.start(id(1), 0, 0);
    ledger.observe(id(1), { tokens: { inputTotal: 100, outputTotal: 3 }, source: "provider-response", costBasis: "unknown" });
    ledger.observe(id(1), { tokens: { inputTotal: 100, outputTotal: 9 }, source: "provider-response", costBasis: "unknown" });
    // A later snapshot without cost keeps the earlier cost and its basis.
    ledger.observe(id(1), reported(0.02, { reasoning: 4 }));
    ledger.observe(id(1), { tokens: { outputTotal: 12 }, source: "provider-response", costBasis: "unknown" });
    ledger.finish(id(1), "succeeded", 10);
    const [record] = ledger.records();
    assert.deepEqual(record.observation, {
      tokens: { inputTotal: 100, outputTotal: 12, reasoning: 4 },
      cost: { total: 0.02 },
      source: "provider-response",
      costBasis: "reported",
    });
    assert.equal(ledger.summary().tokens.outputTotal, 12);
  });

  it("finish is idempotent, conflicting terminal updates and invalid lifecycle calls reject", () => {
    const ledger = createAttemptLedger();
    assert.throws(() => ledger.observe(id(1), reported(1)), /not started/);
    assert.throws(() => ledger.finish(id(1), "failed", 1), /not started/);
    ledger.start(id(1), 0, 0);
    assert.throws(() => ledger.start(id(1), 0, 0), /already started/);
    assert.throws(() => ledger.observe({ ...id(1), role: "search" }, reported(1)), /conflicting/);
    assert.throws(() => ledger.observe(id(1), { tokens: { inputTotal: -1 }, source: "provider-response", costBasis: "unknown" }), TypeError);
    assert.throws(() => ledger.observe(id(1), { tokens: { inputTotal: Number.NaN }, source: "provider-response", costBasis: "unknown" }), TypeError);
    ledger.finish(id(1), "failed", 5);
    ledger.finish(id(1), "failed", 9);
    assert.equal(ledger.records()[0].settledAtMs, 5);
    assert.throws(() => ledger.finish(id(1), "succeeded", 9), /already finished/);
    assert.throws(() => ledger.observe(id(1), reported(1)), /finished/);
    assert.throws(() => ledger.start(id(0), 0, 0), RangeError);
    assert.equal(ledger.records().length, 1);
  });

  it("records one terminal record per dispatched attempt for success, error, empty, retry, timeout and abort", () => {
    const ledger = createAttemptLedger();
    const cases = [
      ["succeeded", { outputTotal: 10 }],
      ["failed", { inputTotal: 50, outputTotal: 0 }],
      ["succeeded", { inputTotal: 50, outputTotal: 0 }],
      ["timed-out", undefined],
      ["aborted", undefined],
    ] as const;
    cases.forEach(([state, tokens], index) => {
      ledger.start(id(index + 1), index * 10, index);
      if (tokens) ledger.observe(id(index + 1), { tokens, source: "provider-response", costBasis: "unknown" });
      ledger.finish(id(index + 1), state, index * 10 + 5);
    });
    assert.deepEqual(ledger.records().map((record) => [record.attempt, record.state, record.queueMs]), [
      [1, "succeeded", 0], [2, "failed", 1], [3, "succeeded", 2], [4, "timed-out", 3], [5, "aborted", 4],
    ]);
    const summary = ledger.summary();
    assert.deepEqual([summary.attempts, summary.observedAttempts, summary.missingAttempts], [5, 3, 2]);
    // Known subtotals are reported with masks, not as complete sums.
    assert.equal(summary.tokens.inputTotal, 100);
    assert.equal(summary.tokens.outputTotal, 10);
    assert.equal(summary.tokens.cacheRead, undefined);
    assert.deepEqual(summary.missingTokenFields, [...TOKEN_FIELDS]);
    assert.equal(summary.costComplete, false);
    assert.equal(summary.parentDelivery, "unknown");
    assert.equal(ledger.summary("unavailable-after-parent-cancel").parentDelivery, "unavailable-after-parent-cancel");
  });

  it("counts in-flight attempts as dispatched but only lists settled records", () => {
    const ledger = createAttemptLedger();
    ledger.start(id(1), 0, 0);
    assert.equal(ledger.records().length, 0);
    assert.deepEqual([ledger.summary().attempts, ledger.summary().missingAttempts], [1, 1]);
  });

  it("separates reported and catalogue cost; only reported totals for every attempt are complete", () => {
    const allReported = createAttemptLedger();
    for (const n of [1, 2]) {
      allReported.start(id(n), 0, 0);
      allReported.observe(id(n), reported(0.01 * n, { inputUncached: 10, outputTotal: 2 }));
      allReported.finish(id(n), "succeeded", 1);
    }
    assert.equal(allReported.summary().costComplete, true);
    assert.ok(Math.abs(allReported.summary().reportedCost.total! - 0.03) < 1e-12);
    assert.deepEqual(allReported.summary().estimatedCost, {});

    const estimated = createAttemptLedger();
    estimated.start(id(1), 0, 0);
    estimated.observe(id(1), catalogue(0.04));
    estimated.finish(id(1), "succeeded", 1);
    assert.equal(estimated.summary().costComplete, false, "catalogue estimates alone are never complete");
    assert.deepEqual(estimated.summary().estimatedCost, { total: 0.04, input: 0.02, output: 0.02 });
    assert.equal(hostCostBasis(estimated.summary()), "catalogue");
    assert.equal(estimated.hostUsage().cost.total, 0.04);

    const mixed = createAttemptLedger();
    mixed.start(id(1), 0, 0);
    mixed.observe(id(1), reported(0.5));
    mixed.finish(id(1), "succeeded", 1);
    mixed.start(id(2), 0, 0);
    mixed.observe(id(2), catalogue(0.25));
    mixed.finish(id(2), "succeeded", 1);
    const summary = mixed.summary();
    assert.deepEqual([summary.reportedCost.total, summary.estimatedCost.total, summary.costComplete], [0.5, 0.25, false]);
    // Host cost uses the reported subtotal and never adds the estimate to it.
    assert.equal(hostCostBasis(summary), "reported");
    assert.deepEqual(mixed.hostUsage().cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.5 });

    const empty = createAttemptLedger();
    assert.equal(empty.summary().costComplete, true, "no dispatched attempt has no unknown charge");
    assert.deepEqual(empty.summary().missingTokenFields, []);
    assert.equal(hostCostBasis(empty.summary()), "none");
  });

  it("projects numeric host usage from uncached components with zero placeholders only for unknown fields", () => {
    const ledger = createAttemptLedger();
    ledger.start(id(1), 0, 0);
    ledger.observe(id(1), { tokens: { inputTotal: 1000, inputUncached: 700, outputTotal: 50, cacheRead: 200, cacheWrite: 100, reasoning: 20, totalTokens: 1050 }, source: "sdk-normalized", costBasis: "unknown" });
    ledger.finish(id(1), "succeeded", 1);
    ledger.start(id(2), 0, 0);
    // Opaque prompt total with unknown cache subset: no uncached input is invented.
    ledger.observe(id(2), reported(0.1, { inputTotal: 400, outputTotal: 10 }));
    ledger.finish(id(2), "failed", 1);
    ledger.start(id(3), 0, 0);
    ledger.finish(id(3), "aborted", 1);
    assert.deepEqual(ledger.hostUsage(), {
      input: 700,
      output: 60,
      cacheRead: 200,
      cacheWrite: 100,
      // Reported 1,050 is kept as-is; the second attempt contributes its known prompt and output totals.
      totalTokens: 1460,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.1 },
    });
    const summary = ledger.summary();
    assert.ok(summary.missingTokenFields.includes("inputUncached"));
    assert.equal(summary.missingAttempts, 1);
    assert.equal(summary.tokens.reasoning, 20, "reasoning stays a subset of output");
    assert.equal(summary.tokens.outputTotal, 60);
  });
});

describe("P1 review regressions: host total and cost provenance (C16)", () => {
  function hostTotal(tokens: UsageObservation["tokens"]): number {
    const ledger = createAttemptLedger();
    ledger.start(id(1), 0, 0);
    ledger.observe(id(1), { tokens, source: "provider-response", costBasis: "unknown" });
    ledger.finish(id(1), "succeeded", 1);
    return ledger.hostUsage().totalTokens;
  }

  it("uses a known prompt total without adding its cache components again", () => {
    assert.equal(hostTotal({ inputTotal: 400, outputTotal: 10 }), 410);
    assert.equal(hostTotal({ inputTotal: 1000, cacheRead: 200, cacheWrite: 100, outputTotal: 50 }), 1050);
    assert.equal(hostTotal({ inputTotal: 1000, inputUncached: 700, cacheRead: 200, cacheWrite: 100, outputTotal: 50 }), 1050);
    // Unknown output is a zero placeholder, disclosed by the mask.
    assert.equal(hostTotal({ inputTotal: 400 }), 400);
    // Without a prompt total, the known host components are summed.
    assert.equal(hostTotal({ inputUncached: 700, cacheRead: 200, cacheWrite: 100, outputTotal: 50 }), 1050);
    // A reported total always wins.
    assert.equal(hostTotal({ inputTotal: 400, outputTotal: 10, totalTokens: 415 }), 415);
  });

  it("a cost with unknown provenance stays on its record and is counted as neither reported nor catalogue", () => {
    const ledger = createAttemptLedger();
    ledger.start(id(1), 0, 0);
    ledger.observe(id(1), { tokens: {}, cost: { total: 0.3 }, source: "sdk-normalized", costBasis: "unknown" });
    ledger.finish(id(1), "succeeded", 1);
    assert.deepEqual(ledger.records()[0].observation?.cost, { total: 0.3 });
    assert.equal(ledger.records()[0].observation?.costBasis, "unknown");
    const summary = ledger.summary();
    assert.deepEqual([summary.reportedCost, summary.estimatedCost, summary.costComplete], [{}, {}, false]);
    assert.equal(hostCostBasis(summary), "none");
    assert.equal(ledger.hostUsage().cost.total, 0);
  });
});

describe("C16 adapter normalisation (T16 library portion)", () => {
  // The same provider response as native pi-ai and standalone OpenRouter report it.
  // pi-ai openai-completions parseChunkUsage: input = prompt - cacheRead - cacheWrite.
  const native: ModelUsage = {
    input: 700, output: 50, cacheRead: 200, cacheWrite: 100, reasoning: 20, totalTokens: 1050,
    cost: { input: 0.0007, output: 0.0001, cacheRead: 0.00002, cacheWrite: 0.0001, total: 0.00092 },
  };
  // packages/mcp/src/providers/openrouter.ts usage(): input = prompt_tokens.
  const mcp: ModelUsage = { input: 1000, output: 50, cacheRead: 200, cacheWrite: 100, reasoning: 20, totalTokens: 1050, totalCost: 0.0011 };

  // Hand-built arithmetic fixtures. The real MCP adapter does not yet capture
  // cache_write_tokens, so this is not evidence of native/MCP adapter parity (T16).
  it("hand-built native and standalone fixtures normalise to the same canonical tokens", () => {
    const a = normalizeNativeUsage(native);
    const b = normalizeMcpUsage(mcp, "gen-1");
    const canonical = { inputTotal: 1000, inputUncached: 700, outputTotal: 50, cacheRead: 200, cacheWrite: 100, reasoning: 20, totalTokens: 1050 };
    assert.deepEqual(a.tokens, canonical);
    assert.deepEqual(b.tokens, canonical);
    assert.deepEqual([a.source, a.costBasis], ["sdk-normalized", "catalogue"]);
    assert.deepEqual([b.source, b.costBasis, b.providerRequestId], ["provider-response", "reported", "gen-1"]);
    assert.deepEqual(b.cost, { total: 0.0011 });
    assert.deepEqual(a.cost, native.cost);
  });

  it("an unknown cache subset cannot establish uncached input", () => {
    const withoutWrite = normalizeMcpUsage({ input: 1000, cacheRead: 200, output: 5 });
    assert.equal(withoutWrite.tokens.inputTotal, 1000);
    assert.equal(withoutWrite.tokens.inputUncached, undefined);
    const withoutRead = normalizeMcpUsage({ input: 1000, cacheWrite: 0 });
    assert.equal(withoutRead.tokens.inputUncached, undefined);
    assert.equal(normalizeMcpUsage({ input: 1000, cacheRead: 0, cacheWrite: 0 }).tokens.inputUncached, 1000);
    assert.equal(normalizeNativeUsage({ input: 700, output: 1 }).tokens.inputTotal, undefined);
    assert.equal(normalizeNativeUsage({ input: 700, output: 1 }).tokens.inputUncached, 700);
  });

  it("current standalone adapter output without a cache-write count leaves uncached input unknown", () => {
    // Shape of packages/mcp/src/providers/openrouter.ts usage(): no cacheWrite field.
    const observed = normalizeMcpUsage({ input: 1000, output: 50, totalTokens: 1050, totalCost: 0.001, cacheRead: 200, reasoning: 20 });
    assert.equal(observed.tokens.inputUncached, undefined);
    assert.equal(observed.tokens.cacheWrite, undefined);
    const ledger = createAttemptLedger();
    ledger.start(id(1), 0, 0);
    ledger.observe(id(1), observed);
    ledger.finish(id(1), "succeeded", 1);
    assert.ok(ledger.summary().missingTokenFields.includes("inputUncached"));
    assert.ok(ledger.summary().missingTokenFields.includes("cacheWrite"));
    assert.equal(ledger.hostUsage().input, 0, "a disclosed zero placeholder, not a measurement");
  });

  it("disjoint cache counters leave uncached input unknown instead of clamping to zero", () => {
    const observed = normalizeMcpUsage({ input: 100, cacheRead: 150, cacheWrite: 0, output: 5 });
    assert.equal(observed.tokens.inputUncached, undefined);
    assert.equal(observed.tokens.inputTotal, 100);
    assert.equal(normalizeMcpUsage({ input: 100, cacheRead: 100, cacheWrite: 0 }).tokens.inputUncached, 0);
  });

  it("keeps cacheWrite1h as a subset, preserves totals and leaves absent cost unknown", () => {
    const observed = normalizeNativeUsage({ input: 10, output: 2, cacheRead: 0, cacheWrite: 30, cacheWrite1h: 20, totalTokens: 42 });
    assert.deepEqual(observed.tokens, { inputTotal: 40, inputUncached: 10, outputTotal: 2, cacheRead: 0, cacheWrite: 30, cacheWrite1h: 20, totalTokens: 42 });
    assert.equal(observed.costBasis, "unknown");
    assert.equal(observed.cost, undefined);
    // A bare native total has no established provenance.
    assert.equal(normalizeNativeUsage({ input: 1, totalCost: 0.5 }).costBasis, "unknown");
    assert.equal(normalizeMcpUsage({ output: 3 }).costBasis, "unknown");
    const ledger = createAttemptLedger();
    ledger.start(id(1), 0, 0);
    ledger.observe(id(1), observed);
    ledger.finish(id(1), "succeeded", 1);
    assert.equal(ledger.hostUsage().cacheWrite, 30, "the 1h subset is not added again");
    assert.equal(ledger.hostUsage().totalTokens, 42);
  });

  it("hand-built equivalent fixtures produce equivalent ledger summaries apart from cost basis", () => {
    const summaries = [normalizeNativeUsage(native), normalizeMcpUsage(mcp)].map((observation) => {
      const ledger = createAttemptLedger();
      ledger.start(id(1), 0, 0);
      ledger.observe(id(1), observation);
      ledger.finish(id(1), "succeeded", 1);
      return { summary: ledger.summary("available"), host: ledger.hostUsage() };
    });
    assert.deepEqual(summaries[0].summary.tokens, summaries[1].summary.tokens);
    assert.deepEqual(summaries[0].summary.missingTokenFields, ["cacheWrite1h"]);
    assert.deepEqual(summaries[1].summary.missingTokenFields, ["cacheWrite1h"]);
    assert.deepEqual({ ...summaries[0].host, cost: undefined }, { ...summaries[1].host, cost: undefined });
    assert.deepEqual([summaries[0].summary.costComplete, summaries[1].summary.costComplete], [false, true]);
  });
});
