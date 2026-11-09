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
import { OutputBudgetExhaustedError } from "../src/core/util.js";
import { budgetCaps, attemptTimeoutMs, retryCeiling, MAX_TIMEOUT_MULTIPLE } from "../src/core/output-budget.js";
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
  assert.match(result.text, /Raise outputBudgetRetries or collationMaxTokens, or re-run\./);
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

it("uses a valid shorter synthesis after two longer candidates fail provenance", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root);
  const complete = context.models.complete;
  const caps: Array<number | undefined> = [];
  // The reviewer's exact scenario: the two longest candidates cite unknown
  // sources, so only the shortest, valid one can be committed.
  context.models.complete = async (request) => {
    if (request.model.model !== "collate") return complete(request);
    caps.push(request.maxTokens);
    const text =
      request.maxTokens === 100
        ? "The longest truncated synthesis is invalid and cites unknown [S99]."
        : request.maxTokens === 200
          ? "The second longest and also invalid [S98]."
          : "Valid [S1].";
    return { text, citations: [], finishReason: "length" as const };
  };
  const result = await research({ query: "three candidates" }, context, dependencies);
  assert.deepEqual(caps, [100, 200, 400]);
  assert.equal(result.outcome, "completed");
  assert.match(result.text, /\bValid \[S1\]/);
  assert.doesNotMatch(result.text, /Collation Failed/);
  assert.doesNotMatch(result.text, /\[S99\]|\[S98\]/);
  const report = await readFile(join(root, result.details.cachePath as string, "report.md"), "utf8");
  assert.match(report, /\bValid \[S1\]/);
  assert.doesNotMatch(report, /\[S99\]|\[S98\]/);
  assert.match(result.text, /cap \(400 tokens/);
});

it("retains truncated candidates when a completed retry fails provenance", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root);
  const complete = context.models.complete;
  context.models.complete = async (request) => {
    if (request.model.model !== "collate") return complete(request);
    return {
      text: request.maxTokens === 100 ? "Valid [S1]." : "Longer invalid synthesis [S99].",
      citations: [],
      finishReason: request.maxTokens === 400 ? "stop" as const : "length" as const,
    };
  };
  const result = await research({ query: "invalid completed retry" }, context, dependencies);
  assert.equal(result.outcome, "completed");
  assert.match(result.text, /Valid \[S1\]/);
  assert.doesNotMatch(result.text, /\[S99\]/);
  assert.match(result.text, /cap \(100 tokens/);
});

it("prefers the shorter completed synthesis over a longer truncated synthesis", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root);
  const complete = context.models.complete;
  const caps: Array<number | undefined> = [];
  context.models.complete = async (request) => {
    if (request.model.model !== "collate") return complete(request);
    caps.push(request.maxTokens);
    return request.maxTokens === 100
      ? { text: "A much longer but truncated synthesis with useful evidence [S1].", citations: [], finishReason: "length" as const }
      : { text: "Complete [S1].", citations: [], finishReason: "stop" as const };
  };
  const result = await research({ query: "prefer complete synthesis" }, context, dependencies);
  assert.deepEqual(caps, [100, 200], "a completed response still stops further model calls");
  assert.equal(result.outcome, "completed");
  const cachePath = join(root, result.details.cachePath as string);
  const report = await readFile(join(cachePath, "report.md"), "utf8");
  for (const output of [result.text, report]) {
    assert.match(output, /Complete \[S1\]\./);
    assert.doesNotMatch(output, /A much longer but truncated synthesis|Collation output reached its cap/);
  }
  const meta = JSON.parse(await readFile(join(cachePath, "meta.json"), "utf8"));
  assert.equal(meta.stages.collate.truncated, undefined);
  assert.equal(meta.stages.collate.summaryChars, "Complete [S1].".length);
});

it("reports a provenance failure when every candidate is invalid", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root);
  const complete = context.models.complete;
  // No valid candidate exists: fallback must not bypass validation.
  context.models.complete = async (request) => {
    if (request.model.model !== "collate") return complete(request);
    return {
      text: `Longer invalid synthesis citing S9${request.maxTokens} [S9${request.maxTokens}].`,
      citations: [],
      finishReason: "length" as const,
    };
  };
  const result = await research({ query: "no valid candidate" }, context, dependencies);
  assert.equal(result.outcome, "collate-failed");
  assert.match(result.text, /provenance validation failed/);
});

for (const hasCompleted of [false, true]) {
  it(`preserves the first-ranked provenance error when all ${hasCompleted ? "mixed" : "truncated"} candidates fail`, async (t) => {
    const root = await workspace(t);
    const { context, dependencies } = coreContext(root);
    const complete = context.models.complete;
    const caps: Array<number | undefined> = [];
    const unknown = "Bad [S99].";
    const absentUrl = "The longest invalid synthesis. ".repeat(5) + "https://absent.example/page";
    const cacheReference = "An invalid cache reference: `extractions/01-invented.md`.";
    const texts = hasCompleted ? [cacheReference, absentUrl, unknown] : [unknown, absentUrl, cacheReference];
    context.models.complete = async (request) => {
      if (request.model.model !== "collate") return complete(request);
      caps.push(request.maxTokens);
      return {
        text: texts[caps.length - 1],
        citations: [],
        finishReason: hasCompleted && caps.length === 3 ? "stop" as const : "length" as const,
      };
    };
    const result = await research({ query: "first-ranked failure" }, context, dependencies);
    assert.deepEqual(caps, [100, 200, 400]);
    assert.equal(result.outcome, "collate-failed");
    const report = await readFile(join(root, result.details.cachePath as string, "report.md"), "utf8");
    const firstReason = hasCompleted ? "unknown or omitted source ID" : "a prose URL is absent from the supplied evidence";
    const otherReason = hasCompleted ? /a prose URL is absent|generated a cache-file reference/ : /unknown or omitted source ID|generated a cache-file reference/;
    for (const output of [result.text, report]) {
      assert.ok(output.includes(`Collation provenance validation failed: ${firstReason}`));
      assert.doesNotMatch(output, otherReason);
    }
  });
}

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

it("lowers the retry ceiling to the model's advertised output limit without lowering the configured cap", () => {
  assert.equal(retryCeiling(8000, undefined), MAX_OUTPUT_TOKENS);
  assert.equal(retryCeiling(8000, 65_536), 65_536);
  assert.equal(retryCeiling(8000, 500_000), MAX_OUTPUT_TOKENS);
  // A configured cap at or above the limit keeps its value and gets no retry.
  assert.equal(retryCeiling(70_000, 65_536), 70_000);
  assert.deepEqual(budgetCaps(70_000, 2, retryCeiling(70_000, 65_536)), [70_000]);
  // Invalid limits are ignored.
  for (const bad of [0, -1, 1.5, Number.NaN]) assert.equal(retryCeiling(8000, bad), MAX_OUTPUT_TOKENS);
  // The Gemini 3.7 Flash case: 32,000 doubles to 64,000; 65,536 would add
  // under a quarter, so no third call is made.
  assert.deepEqual(budgetCaps(32_000, 2, retryCeiling(32_000, 65_536)), [32_000, 64_000]);
  // A host-default limit of 16,384 stops after 16,000 instead of retrying at 16,384.
  assert.deepEqual(budgetCaps(8000, 2, retryCeiling(8000, 16_384)), [8000, 16_000]);
  // A clamp that still grows the cap by a quarter or more is issued.
  assert.deepEqual(budgetCaps(8000, 2, retryCeiling(8000, 20_000)), [8000, 16_000, 20_000]);
});

it("never requests more than the model's advertised output limit on a budget retry", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { outputBudgetRetries: 2 });
  const caps: Array<number | undefined> = [];
  alwaysExhausted(context, caps);
  context.models.outputLimit = (model) => (model.model === "collate" ? 150 : undefined);
  const result = await research({ query: "model output limit" }, context, dependencies);
  assert.deepEqual(caps, [100, 150]);
  assert.equal(result.outcome, "collate-failed");
  assert.match(result.text, /Model limit \(150\) stops retries: change model or re-run\./);
  assert.doesNotMatch(result.text, /Raise collationMaxTokens/);
});

it("explains that no retry is possible when the configured cap already meets the model limit", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { outputBudgetRetries: 2 });
  const caps: Array<number | undefined> = [];
  alwaysExhausted(context, caps);
  context.models.outputLimit = () => 100;
  const result = await research({ query: "limit already reached" }, context, dependencies);
  assert.deepEqual(caps, [100]);
  assert.match(result.text, /No visible text within the 100-token cap; the model's output limit of 100 tokens is at or below the cap, so no larger retry was made\. Choose a model that reasons less, or re-run\./);
});

it("falls back to the shared ceiling when the output-limit lookup throws", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { outputBudgetRetries: 2 });
  const caps: Array<number | undefined> = [];
  alwaysExhausted(context, caps);
  context.models.outputLimit = () => {
    throw new Error("registry unavailable");
  };
  await research({ query: "limit lookup throws" }, context, dependencies);
  assert.deepEqual(caps, [100, 200, 400]);
});

it("keeps the raise advice when the model limit did not bound the schedule", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { outputBudgetRetries: 2 });
  const caps: Array<number | undefined> = [];
  alwaysExhausted(context, caps);
  context.models.outputLimit = () => 100_000;
  const result = await research({ query: "limit far above schedule" }, context, dependencies);
  assert.deepEqual(caps, [100, 200, 400]);
  assert.match(result.text, /Raise collationMaxTokens/);
  assert.doesNotMatch(result.text, /output limit/);
});

it("attributes a skipped near-duplicate retry to the model limit, never claiming the cap meets it", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { outputBudgetRetries: 2 });
  const caps: Array<number | undefined> = [];
  alwaysExhausted(context, caps);
  // Configured 100, limit 110: the only retry would add 10%, so none is made.
  context.models.outputLimit = () => 110;
  const result = await research({ query: "limit just above cap" }, context, dependencies);
  assert.deepEqual(caps, [100]);
  assert.match(result.text, /the model's output limit \(110 tokens\) allows a retry under 25% larger, so none ran\. Change model, or re-run\./);
  assert.doesNotMatch(result.text, /at or below the cap|undefined/);
});

it("attributes a skipped near-duplicate retry to the shared maximum when no model limit is known", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { outputBudgetRetries: 2, collationMaxTokens: 110_000 });
  const caps: Array<number | undefined> = [];
  alwaysExhausted(context, caps);
  const result = await research({ query: "cap near the maximum" }, context, dependencies);
  assert.deepEqual(caps, [110_000]);
  assert.match(result.text, new RegExp(`the ${MAX_OUTPUT_TOKENS}-token maximum allows a retry under 25% larger, so none ran\\. Set collationMaxTokens to ${MAX_OUTPUT_TOKENS}`));
  assert.doesNotMatch(result.text, /change model/);
  assert.doesNotMatch(result.text, /model's output limit of undefined/);
});

it("does not advise raising the cap when the last retry already used the shared maximum", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { outputBudgetRetries: 2, collationMaxTokens: 100_000 });
  const caps: Array<number | undefined> = [];
  alwaysExhausted(context, caps);
  const result = await research({ query: "last retry at maximum" }, context, dependencies);
  assert.deepEqual(caps, [100_000, MAX_OUTPUT_TOKENS]);
  assert.match(result.text, new RegExp(`${MAX_OUTPUT_TOKENS} is the maximum; choose a model that reasons less, or re-run\\.`));
  assert.doesNotMatch(result.text, /Raise collationMaxTokens|change model/);
});

it("treats a model limit equal to the shared maximum as the maximum, not as a model to replace", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { outputBudgetRetries: 2, collationMaxTokens: 100_000 });
  const caps: Array<number | undefined> = [];
  alwaysExhausted(context, caps);
  context.models.outputLimit = () => MAX_OUTPUT_TOKENS;
  const result = await research({ query: "limit equals maximum" }, context, dependencies);
  assert.deepEqual(caps, [100_000, MAX_OUTPUT_TOKENS]);
  assert.match(result.text, new RegExp(`${MAX_OUTPUT_TOKENS} is the maximum`));
  assert.doesNotMatch(result.text, /change model/);
});

it("ignores an invalid model limit in the messages as well as the schedule", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { outputBudgetRetries: 2, collationMaxTokens: 110_000 });
  const caps: Array<number | undefined> = [];
  alwaysExhausted(context, caps);
  context.models.outputLimit = () => 0;
  const result = await research({ query: "zero limit" }, context, dependencies);
  assert.deepEqual(caps, [110_000]);
  assert.doesNotMatch(result.text, /\(0 tokens|output limit/);
});

it("keeps the token counts in a limit-bounded reason despite the 300-character cut", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { outputBudgetRetries: 2, collationMaxTokens: 8000 });
  const complete = context.models.complete;
  context.models.complete = async (request) => {
    if (request.model.model !== "collate") return complete(request);
    const cap = request.maxTokens ?? 0;
    return {
      text: "",
      citations: [],
      finishReason: "length" as const,
      usage: { output: cap, reasoning: cap - 50 },
    };
  };
  context.models.outputLimit = () => 16_384;
  const result = await research({ query: "counts survive the cut" }, context, dependencies);
  assert.equal(result.outcome, "collate-failed");
  assert.match(result.text, /16000 output tokens, 15950 hidden reasoning/);
  assert.match(result.text, /Model limit \(16384\) stops retries: change model or re-run\./);
});

it("names the retry count, not a model limit, when the limit did not shorten the schedule", async (t) => {
  const root = await workspace(t);
  // 100, 200, 400 with or without a 600 limit, and 600 leaves room for a
  // worthwhile retry: the count ran out, not the limit.
  const { context, dependencies } = coreContext(root, { outputBudgetRetries: 2 });
  const caps: Array<number | undefined> = [];
  alwaysExhausted(context, caps);
  context.models.outputLimit = () => 600;
  const result = await research({ query: "count ran out" }, context, dependencies);
  assert.deepEqual(caps, [100, 200, 400]);
  assert.match(result.text, /Raise collationMaxTokens/);
  assert.doesNotMatch(result.text, /stops retries/);
});

it("offers one attempt at the limit when no limit up to the maximum could allow a retry", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { outputBudgetRetries: 2, collationMaxTokens: 110_000 });
  const caps: Array<number | undefined> = [];
  alwaysExhausted(context, caps);
  context.models.outputLimit = () => 120_000;
  const result = await research({ query: "cap above 102400 with limit" }, context, dependencies);
  assert.deepEqual(caps, [110_000]);
  assert.match(result.text, /Set collationMaxTokens to 120000 for one attempt at the limit, or change model\./);
  assert.doesNotMatch(result.text, /raise the model's limit/);
});

it("does not imply that enabling retries helps when one retry would not be issued", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { outputBudgetRetries: 0 });
  const caps: Array<number | undefined> = [];
  alwaysExhausted(context, caps);
  // Limit 110 over a cap of 100: a retry would be under 25% larger.
  context.models.outputLimit = () => 110;
  const result = await research({ query: "retries off near the limit" }, context, dependencies);
  assert.deepEqual(caps, [100]);
  assert.doesNotMatch(result.text, /budget retries are disabled/);
  assert.match(result.text, /the model's output limit \(110 tokens\) allows a retry under 25% larger/);
});

it("puts adapter text after the remedy so the cut cannot remove the advice", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { outputBudgetRetries: 1 });
  const complete = context.models.complete;
  context.models.complete = async (request) => {
    if (request.model.model !== "collate") return complete(request);
    throw new OutputBudgetExhaustedError(`Provider stopped at the cap. ${"Long adapter detail. ".repeat(20)}`);
  };
  const result = await research({ query: "adapter text without counts" }, context, dependencies);
  assert.equal(result.outcome, "collate-failed");
  assert.match(result.text, /Raise collationMaxTokens, choose a model that reasons less for this stage, or re-run\. Adapter diagnostic:/);
});

it("names the model limit when it leaves no room for a worthwhile retry", async (t) => {
  const root = await workspace(t);
  // 100, 200, 400 against a 410 limit: no setting can buy more than 410.
  const { context, dependencies } = coreContext(root, { outputBudgetRetries: 2 });
  const caps: Array<number | undefined> = [];
  alwaysExhausted(context, caps);
  context.models.outputLimit = () => 410;
  const result = await research({ query: "limit leaves no room" }, context, dependencies);
  assert.deepEqual(caps, [100, 200, 400]);
  assert.match(result.text, /Model limit \(410\) stops retries/);
  assert.doesNotMatch(result.text, /Raise collationMaxTokens/);
});

it("gives the native adapter a models.json remedy for a recorded limit", async (t) => {
  const root = await workspace(t);
  const base = coreContext(root, { outputBudgetRetries: 2 });
  const context = { ...base.context, identity: { ...base.context.identity, adapter: "pi" as const } };
  const caps: Array<number | undefined> = [];
  alwaysExhausted(context, caps);
  context.models.outputLimit = () => 150;
  const multi = await research({ query: "native limit remedy" }, context, base.dependencies);
  assert.deepEqual(caps, [100, 150]);
  assert.match(multi.text, /stops retries: change model or raise maxTokens in models\.json\./);
  caps.length = 0;
  context.models.outputLimit = () => 100;
  const single = await research({ query: "native limit at cap" }, context, base.dependencies);
  assert.deepEqual(caps, [100]);
  assert.match(single.text, /at or below the cap, so no larger retry was made\. Change model, or raise its maxTokens in models\.json if the provider allows more\./);
});
