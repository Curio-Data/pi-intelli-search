// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { createGuardedCallLlm, providerReportedCost } from "../scripts/research-handoff/pipeline-client.js";
import { AttemptBudget } from "../scripts/research-handoff/budget.js";
import type { JournalEvent } from "../scripts/research-handoff/contracts.js";
import { EXTRACTION_SYSTEM_PROMPT } from "../src/core/prompts.js";

function message(error?: string): AssistantMessage {
  return { role: "assistant", content: [{ type: "text", text: "Synthetic evidence." }],
    api: "openai-completions", provider: "openrouter", model: "minimax/minimax-m3",
    usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: error ? "error" : "stop", errorMessage: error, timestamp: 1 };
}
const model = { provider: "openrouter", model: "minimax/minimax-m3" };
const policy = { maxTokens: 8000, retry: { attempts: 3, baseDelayMs: 0, maxDelayMs: 0 } };
function context(perform: (opts?: SimpleStreamOptions) => Promise<AssistantMessage>) {
  const registry = {
    find() { assert.equal(this, registry); return model; },
    async getApiKeyAndHeaders() { assert.equal(this, registry); return { ok: true, apiKey: "synthetic-not-a-secret" }; },
    streamSimple(_m: unknown, _c: unknown, options?: SimpleStreamOptions) {
      assert.equal(this, registry); assert.equal(options?.maxRetries, 0);
      return { result: () => perform(options) };
    },
  };
  return { modelRegistry: registry } as unknown as ExtensionContext;
}

test("handoff raw reported cost never falls back to SDK catalogue estimates", () => {
  assert.equal(providerReportedCost({ usage: { cost: 0.001 } }), 0.001);
  assert.equal(providerReportedCost({ usage: { cost: 0 } }), 0);
  assert.equal(providerReportedCost({ usage: { cost: { total: 0.001 } } }), undefined);
  assert.equal(providerReportedCost({ usage: { cost: -1 } }), undefined);
});

test("handoff native retry attempts are each reserved and settled without global hooks", async () => {
  const events: JournalEvent[] = [], journal = { record: (e: JournalEvent) => { events.push(e); } };
  const budget = new AttemptBudget(1_200_000_000, journal);
  let count = 0;
  const ctx = context(async opts => {
    count++;
    opts?.onProviderStreamEvent?.({ usage: { cost: 0.01 } }, model as unknown as Parameters<NonNullable<SimpleStreamOptions["onProviderStreamEvent"]>>[1]);
    return message(count === 1 ? "503 transient" : undefined);
  });
  const registry = ctx.modelRegistry;
  const guarded = createGuardedCallLlm({ runId: "fixture", budget, journal });
  assert.equal(await guarded(ctx, model, EXTRACTION_SYSTEM_PROMPT, "new source", policy), "Synthetic evidence.");
  assert.equal(ctx.modelRegistry, registry);
  assert.equal(count, 2);
  assert.equal(events.filter(e => e.kind === "pipeline-attempt").length, 2);
  assert.equal(budget.snapshot().knownNanoUsd, 20_000_000);
  assert.equal(budget.snapshot().activeNanoUsd, 0);
});

test("handoff absent provider cost remains a hold despite SDK zero cost", async () => {
  const journal = { record(_e: JournalEvent) {} };
  const budget = new AttemptBudget(1_200_000_000, journal);
  await createGuardedCallLlm({ runId: "unknown", budget, journal })(
    context(async () => message()), model, EXTRACTION_SYSTEM_PROMPT, "fixture", policy,
  );
  assert.equal(budget.snapshot().unknownNanoUsd, 324_172_800);
  assert.equal(budget.snapshot().knownNanoUsd, 0);
});

test("handoff rejects unapproved downstream policy before dispatch", async () => {
  const journal = { record(_e: JournalEvent) {} };
  const budget = new AttemptBudget(1_200_000_000, journal);
  const guarded = createGuardedCallLlm({ runId: "bad", budget, journal });
  const ctx = context(async () => { throw new Error("must not dispatch"); });
  await assert.rejects(guarded(ctx, model, "unrecognised", "fixture", policy), /Unapproved/);
  await assert.rejects(guarded(ctx, model, EXTRACTION_SYSTEM_PROMPT, "fixture", { ...policy, maxTokens: 9000 }), /policy/);
  assert.equal(budget.snapshot().activeNanoUsd, 0);
});
