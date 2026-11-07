// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
// Budget-retry schedule: how many attempts, which caps, and how long each
// attempt may take. Drives the shared engine through the same adapter
// context both packages use, with a scripted model.

import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { research } from "../src/core/index.js";
import { budgetCaps, attemptTimeoutMs, MAX_TIMEOUT_MULTIPLE } from "../src/core/output-budget.js";
import { MAX_OUTPUT_TOKENS } from "../src/core/defaults.js";
import { coreContext } from "./helpers/core-context.js";

async function workspace(t: { after(fn: () => Promise<void>): void }) {
  const root = resolve(".tmp");
  await mkdir(root, { recursive: true });
  const path = await mkdtemp(join(root, "budget-retry-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

/** A collate model that spends every budget it is given. */
function alwaysExhausted(
  context: ReturnType<typeof coreContext>["context"],
  caps: Array<number | undefined>,
  timeouts: Array<number | undefined> = [],
) {
  const complete = context.models.complete;
  context.models.complete = async (request) => {
    if (request.model.model !== "collate") return complete(request);
    caps.push(request.maxTokens);
    timeouts.push(request.timeoutMs);
    return { text: "", citations: [], finishReason: "length" as const };
  };
}

it("caps the attempt schedule at the shared 128,000-token ceiling without repeating a cap", () => {
  assert.deepEqual(budgetCaps(8000, 2), [8000, 16_000, 32_000]);
  assert.deepEqual(budgetCaps(8000, 0), [8000]);
  // N9: a cap of 100,000 retries at the ceiling, not at 200,000.
  assert.deepEqual(budgetCaps(100_000, 2), [100_000, MAX_OUTPUT_TOKENS]);
  // A cap already at the ceiling cannot grow, so no retry is issued.
  assert.deepEqual(budgetCaps(MAX_OUTPUT_TOKENS, 2), [MAX_OUTPUT_TOKENS]);
  assert.deepEqual(budgetCaps(MAX_OUTPUT_TOKENS + 50_000, 2), [MAX_OUTPUT_TOKENS]);
});

it("scales an attempt's timeout with its cap, bounded at four times the configured timeout", () => {
  const base = 120_000;
  assert.equal(attemptTimeoutMs(base, 8000, 8000), base);
  assert.equal(attemptTimeoutMs(base, 8000, 16_000), 240_000);
  assert.equal(attemptTimeoutMs(base, 8000, 32_000), 480_000);
  // Growth beyond four times the configured timeout is not granted.
  assert.equal(attemptTimeoutMs(base, 8000, 64_000), base * MAX_TIMEOUT_MULTIPLE);
  // A clamp at the ceiling scales by the real ratio: 128,000 / 100,000.
  assert.equal(attemptTimeoutMs(100, 100_000, 128_000), 128);
});

it("issues no budget retry when outputBudgetRetries is 0", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { outputBudgetRetries: 0 });
  const caps: Array<number | undefined> = [];
  alwaysExhausted(context, caps);
  const result = await research({ query: "no budget retry" }, context, dependencies);
  assert.deepEqual(caps, [100]);
  assert.equal(result.outcome, "collate-failed");
  assert.match(result.text, /budget retries are disabled \(outputBudgetRetries is 0\)/);
});

it("issues exactly one retry when outputBudgetRetries is 1", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { outputBudgetRetries: 1 });
  const caps: Array<number | undefined> = [];
  alwaysExhausted(context, caps);
  const result = await research({ query: "one budget retry" }, context, dependencies);
  assert.deepEqual(caps, [100, 200]);
  assert.equal(result.outcome, "collate-failed");
  assert.match(result.text, /after one retry up to 200 tokens/);
});

it("issues two retries by default, doubling the cap each time", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root);
  assert.equal(context.settings.outputBudgetRetries, 2);
  const caps: Array<number | undefined> = [];
  alwaysExhausted(context, caps);
  const result = await research({ query: "two budget retries" }, context, dependencies);
  assert.deepEqual(caps, [100, 200, 400]);
  assert.equal(result.outcome, "collate-failed");
  assert.match(result.text, /after 2 retries up to 400 tokens/);
});

it("clamps a 100,000-token retry to the 128,000-token ceiling and says so", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { collationMaxTokens: 100_000 });
  const caps: Array<number | undefined> = [];
  const timeouts: Array<number | undefined> = [];
  alwaysExhausted(context, caps, timeouts);
  const result = await research({ query: "clamped retry" }, context, dependencies);
  assert.deepEqual(caps, [100_000, MAX_OUTPUT_TOKENS]);
  // The attempt allowed 128,000 tokens gets 1.28 times the base timeout.
  assert.deepEqual(timeouts, [100, 128]);
  assert.equal(result.outcome, "collate-failed");
  assert.match(result.text, /after one retry up to 128000 tokens/);
});

it("issues no retry when the configured cap is already the ceiling", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { collationMaxTokens: MAX_OUTPUT_TOKENS });
  const caps: Array<number | undefined> = [];
  alwaysExhausted(context, caps);
  const result = await research({ query: "at the ceiling" }, context, dependencies);
  assert.deepEqual(caps, [MAX_OUTPUT_TOKENS]);
  assert.equal(result.outcome, "collate-failed");
  assert.match(result.text, /already at the 128000-token maximum/);
});

it("scales each attempt's timeout through the schedule and caps growth at 4x", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, {
    collationMaxTokens: 10_000,
    outputBudgetRetries: 3,
    llmTimeoutMs: 100,
  });
  const caps: Array<number | undefined> = [];
  const timeouts: Array<number | undefined> = [];
  alwaysExhausted(context, caps, timeouts);
  await research({ query: "timeout schedule" }, context, dependencies);
  assert.deepEqual(caps, [10_000, 20_000, 40_000, 80_000]);
  assert.deepEqual(timeouts, [100, 200, 400, 400]);
});

it("runs every configured collation retry when each attempt is truncated but usable", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root);
  const complete = context.models.complete;
  const caps: Array<number | undefined> = [];
  context.models.complete = async (request) => {
    if (request.model.model !== "collate") return complete(request);
    caps.push(request.maxTokens);
    return request.maxTokens === 400
      ? { text: "Complete synthesis [S1].", citations: [] }
      : { text: `Truncated at ${request.maxTokens} [S1].`, citations: [], finishReason: "length" as const };
  };
  const result = await research({ query: "every retry for truncated text" }, context, dependencies);
  assert.deepEqual(caps, [100, 200, 400], "the configured third attempt must run");
  assert.match(result.text, /Complete synthesis \[S1\]/);
  assert.doesNotMatch(result.text, /reached its cap/);
});

it("keeps the longest usable synthesis when every configured attempt is truncated", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root);
  const complete = context.models.complete;
  const caps: Array<number | undefined> = [];
  context.models.complete = async (request) => {
    if (request.model.model !== "collate") return complete(request);
    caps.push(request.maxTokens);
    const text =
      request.maxTokens === 100
        ? "Short [S1]."
        : request.maxTokens === 200
          ? "A longer truncated synthesis [S1]."
          : "The longest truncated synthesis of all three [S1].";
    return { text, citations: [], finishReason: "length" as const };
  };
  const result = await research({ query: "all attempts truncated" }, context, dependencies);
  assert.deepEqual(caps, [100, 200, 400]);
  assert.match(result.text, /The longest truncated synthesis of all three/);
  assert.doesNotMatch(result.text, /A longer truncated synthesis/);
  assert.match(result.text, /Collation output reached its cap/);
});

it("reports the effective cap when a configured cap exceeds the ceiling", async (t) => {
  const root = await workspace(t);
  // Unreachable through either adapter's validation: a defensive case only.
  const { context, dependencies } = coreContext(root, { collationMaxTokens: 200_000 });
  const caps: Array<number | undefined> = [];
  alwaysExhausted(context, caps);
  const result = await research({ query: "configured cap above ceiling" }, context, dependencies);
  assert.deepEqual(caps, [MAX_OUTPUT_TOKENS]);
  assert.match(result.text, /Output cap of 128000 tokens reached/);
  assert.doesNotMatch(result.text, /200000 tokens reached/);
});

it("records the retry count that was actually used for collation", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { outputBudgetRetries: 2 });
  // Empty at the first two caps, then a usable answer at 400.
  const complete = context.models.complete;
  let calls = 0;
  context.models.complete = async (request) => {
    if (request.model.model !== "collate") return complete(request);
    calls += 1;
    return calls < 3
      ? { text: "", citations: [], finishReason: "length" as const }
      : { text: "Summary [S1].", citations: [] };
  };
  const result = await research({ query: "retry count telemetry" }, context, dependencies);
  assert.equal(result.outcome, "completed");
  assert.equal(calls, 3);
  const meta = JSON.parse(
    await readFile(join(root, result.details.cachePath as string, "meta.json"), "utf8"),
  );
  assert.equal(meta.stages.collate.budgetRetried, true);
  assert.equal(meta.stages.collate.budgetRetries, 2);
});
