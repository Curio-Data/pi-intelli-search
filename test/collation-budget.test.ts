// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
// Collation input budget: the trimming plan, the notice that says what was
// trimmed, and the proof that saved extractions are never altered.

import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { collate, research } from "../src/core/index.js";
import {
  COLLATION_HEADER_TOKENS_PER_SOURCE,
  MIN_COLLATION_SOURCE_CHARS,
  planCollationBudget,
} from "../src/core/collation-budget.js";
import type { ExtractResult } from "../src/core/types.js";
import { coreContext } from "./helpers/core-context.js";

async function workspace(t: { after(fn: () => Promise<void>): void }) {
  const root = resolve(".tmp");
  await mkdir(root, { recursive: true });
  const path = await mkdtemp(join(root, "collation-budget-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

/** Body text of exactly `chars` characters, split into readable lines. */
function body(chars: number): string {
  const line = "Evidence sentence for the collation budget test.\n";
  let out = "official docs, current\n";
  while (out.length + line.length <= chars) out += line;
  return out + "x".repeat(Math.max(0, chars - out.length));
}

it("leaves every extraction alone when the total fits the budget", () => {
  const plan = planCollationBudget(
    [
      { url: "https://one.example", text: "a".repeat(1000) },
      { url: "https://two.example", text: "b".repeat(2000) },
    ],
    { budgetTokens: 10_000, sourceMaxTokens: 8000 },
  );
  assert.equal(plan.overBudget, false);
  assert.deepEqual(plan.trims, []);
  assert.equal(plan.charsBefore, 3000);
  assert.equal(plan.charsAfter, 3000);
  assert.deepEqual(
    plan.sources.map((source) => source.text.length),
    [1000, 2000],
  );
});

it("caps one extraction's visible text without touching the others", () => {
  const plan = planCollationBudget(
    [
      { url: "https://one.example", text: "a".repeat(10_000) },
      { url: "https://two.example", text: "b".repeat(1_000) },
    ],
    { budgetTokens: 200_000, sourceMaxTokens: 1_000 },
  );
  assert.deepEqual(
    plan.trims.map((trim) => [trim.url, trim.action, trim.keptChars]),
    [["https://one.example", "trimmed", 4_000]],
  );
  assert.equal(plan.sources[1].text.length, 1_000);
  assert.equal(plan.overBudget, false);
});

it("trims the longest extraction down to a fair share when the total exceeds the budget", () => {
  // Budget leaves 10,000 characters for text after two 100-token headers.
  const budgetTokens = (10_000 + 2 * COLLATION_HEADER_TOKENS_PER_SOURCE * 4) / 4;
  const plan = planCollationBudget(
    [
      { url: "https://cited.example", text: "a".repeat(8_000) },
      { url: "https://guess.example", text: "b".repeat(4_000), inferred: true },
    ],
    { budgetTokens, sourceMaxTokens: 8000 },
  );
  assert.equal(plan.overBudget, true);
  // The cited source is longer and still keeps the fair share of 5,000.
  assert.deepEqual(
    plan.trims.map((trim) => [trim.url, trim.keptChars]),
    [["https://cited.example", 5_000]],
  );
  assert.equal(plan.sources[1].text.length, 4_000, "the inferred source fits the fair share");
  assert.equal(plan.charsAfter, 9_000);
});

it("takes the trim from an inferred reference before a longer cited source", () => {
  // 10,000 characters for text after three headers, so the fair share is
  // 3,333. A length-first order would trim the 8,000-character cited source
  // and stop, leaving the inferred source at 3,500; the stated rank order
  // trims the inferred source to the share first, then the cited one.
  const budgetTokens = (10_000 + 3 * COLLATION_HEADER_TOKENS_PER_SOURCE * 4) / 4;
  const plan = planCollationBudget(
    [
      { url: "https://cited-long.example", text: "a".repeat(8_000) },
      { url: "https://guess.example", text: "b".repeat(3_500), inferred: true },
      { url: "https://cited-short.example", text: "c".repeat(2_000) },
    ],
    { budgetTokens, sourceMaxTokens: 8000 },
  );
  assert.deepEqual(
    plan.trims.map((trim) => [trim.url, trim.action, trim.keptChars]),
    [
      ["https://cited-long.example", "trimmed", 3_333],
      ["https://guess.example", "trimmed", 3_333],
    ],
  );
  // The short cited source is below the fair share and keeps its text.
  assert.equal(plan.sources[2].text.length, 2_000);
  assert.ok(plan.charsAfter <= 10_000);
});

it("leaves whole sources out, lowest-ranked first, when a fair share is too small", () => {
  // Four sources, headers alone consume 1,600 characters of a 2,800 budget.
  // The inferred source sits second, so an implementation that simply drops
  // the last source would drop a cited one and fail this test.
  const plan = planCollationBudget(
    [
      { url: "https://cited-one.example", text: "a".repeat(3_000) },
      { url: "https://guess.example", text: "d".repeat(3_000), inferred: true },
      { url: "https://cited-two.example", text: "b".repeat(3_000) },
      { url: "https://cited-three.example", text: "c".repeat(3_000) },
    ],
    { budgetTokens: 700, sourceMaxTokens: 8000 },
  );
  assert.equal(plan.overBudget, true);
  assert.deepEqual(
    plan.trims.filter((trim) => trim.action === "dropped").map((trim) => trim.url),
    ["https://guess.example"],
  );
  const kept = plan.sources.filter((source) => source.text.length > 0);
  assert.equal(kept.length, 3);
  for (const source of kept) assert.ok(source.text.length <= 400);
  assert.ok(MIN_COLLATION_SOURCE_CHARS > 0);
});

it("sends nothing and says so when the budget cannot cover one header", () => {
  const plan = planCollationBudget(
    [
      { url: "https://one.example", text: "a".repeat(500) },
      { url: "https://two.example", text: "b".repeat(500) },
    ],
    { budgetTokens: 10, sourceMaxTokens: 8000 },
  );
  assert.equal(plan.budgetUnusable, true);
  assert.equal(plan.charsAfter, 0);
  assert.deepEqual(
    plan.trims.map((trim) => trim.action),
    ["dropped", "dropped"],
  );
});

/** Drive a research run whose two extractions produce `extractChars` each. */
async function researchWithExtractions(
  root: string,
  extractChars: number,
  overrides: Parameters<typeof coreContext>[1],
) {
  const base = coreContext(root, overrides);
  const complete = base.context.models.complete;
  let extractCalls = 0;
  base.context.models.complete = async (request) => {
    if (request.model.model !== "extract") return complete(request);
    extractCalls += 1;
    return { text: body(extractChars), citations: [] };
  };
  const result = await research({ query: "collation budget run" }, base.context, base.dependencies);
  return { ...base, result, extractCalls };
}

it("sends the whole extraction text and says nothing when the run is under budget", async (t) => {
  const root = await workspace(t);
  const { result } = await researchWithExtractions(root, 1_200, {
    collationInputBudgetTokens: 10_000,
  });
  assert.equal(result.outcome, "completed");
  assert.doesNotMatch(result.text, /Collation input trimmed/);
  const cachePath = join(root, result.details.cachePath as string);
  const report = await readFile(join(cachePath, "report.md"), "utf8");
  assert.doesNotMatch(report, /Collation input trimmed/);
  const meta = JSON.parse(await readFile(join(cachePath, "meta.json"), "utf8"));
  assert.equal(meta.stages.collate.inputBudget, undefined);
});

it("trims a run just over the budget and names the untrimmed extraction files", async (t) => {
  const root = await workspace(t);
  const { result, requests } = await researchWithExtractions(root, 21_000, {
    collationInputBudgetTokens: 10_000,
  });
  assert.equal(result.outcome, "completed");
  // The model itself received the trimmed text, not only a notice about it.
  const collateRequest = requests.filter((r) => r.model.model === "collate").at(-1);
  const sent = JSON.parse(collateRequest!.userMessage) as {
    sources: Array<{ extraction: string }>;
  };
  const sentChars = sent.sources.reduce((total, source) => total + source.extraction.length, 0);
  assert.ok(sentChars <= 39_200, `sent ${sentChars} characters to collation`);
  assert.match(result.text, /\*\*Collation input trimmed\*\*: 2 of 2 extraction/);
  assert.match(result.text, /Trimmed to a fair share of the budget \(2\):/);
  assert.match(result.text, /full extraction: `extractions\/01-/);
  assert.match(result.text, /Raise collationInputBudgetTokens/);
  const cachePath = join(root, result.details.cachePath as string);
  const report = await readFile(join(cachePath, "report.md"), "utf8");
  assert.match(report, /\*\*Collation input trimmed\*\*/);
  // Saved extractions are never reduced: only the prompt was.
  const extractionFiles = (await readdir(join(cachePath, "extractions"))).sort();
  assert.equal(extractionFiles.length, 2);
  const saved = await readFile(join(cachePath, "extractions", extractionFiles[0]), "utf8");
  assert.ok(saved.length > 21_000, "the saved extraction holds the whole text");
  const meta = JSON.parse(await readFile(join(cachePath, "meta.json"), "utf8"));
  assert.deepEqual(meta.stages.collate.inputBudget, {
    budgetTokens: 10_000,
    sources: 2,
    trimmed: 2,
    dropped: 0,
    charsBefore: 42_000,
    charsAfter: meta.stages.collate.inputBudget.charsAfter,
  });
  assert.ok(meta.stages.collate.inputBudget.charsAfter <= 40_000);
});

it("completes and reports the trim when every extraction fills its cap after retries", async (t) => {
  const root = await workspace(t);
  const base = coreContext(root, {
    extractionMaxTokens: 100,
    outputBudgetRetries: 2,
    collationInputBudgetTokens: 10_000,
  });
  const complete = base.context.models.complete;
  const caps: Array<number | undefined> = [];
  // Every page spends its first two caps and then produces a full answer at
  // the third, so the extraction text is the cap's worth of visible output.
  // Deterministic per attempt, whatever order the fan-out runs in: the first
  // two caps produce nothing, the third produces a cap-filling extraction.
  base.context.models.complete = async (request) => {
    if (request.model.model !== "extract") return complete(request);
    caps.push(request.maxTokens);
    return request.maxTokens === 400
      ? { text: body(60_000), citations: [], usage: { output: 400 } }
      : { text: "", citations: [], finishReason: "length" as const };
  };
  const result = await research({ query: "every extraction at its cap" }, base.context, base.dependencies);
  assert.equal(result.outcome, "completed");
  assert.ok(caps.includes(400), "the third attempt ran at twice the retried cap");
  assert.match(result.text, /\*\*Collation input trimmed\*\*/);
  assert.match(result.text, /left out|Trimmed to a fair share/);
  const meta = JSON.parse(
    await readFile(join(root, result.details.cachePath as string, "meta.json"), "utf8"),
  );
  assert.equal(meta.stages.collate.inputBudget.trimmed, 2);
  assert.ok(meta.stages.collate.inputBudget.charsAfter < meta.stages.collate.inputBudget.charsBefore);
});

it("enforces the same budget for manual collation and keeps the supplied extractions whole", async (t) => {
  const root = await workspace(t);
  const { context, requests } = coreContext(root, { collationInputBudgetTokens: 10_000 });
  const extractions: ExtractResult[] = [
    {
      url: "https://one.example",
      title: "One",
      extraction: body(21_000),
      sourceType: "docs",
      currentness: "current",
      status: "success",
    },
    {
      url: "https://two.example",
      title: "Two",
      extraction: body(21_000),
      sourceType: "docs",
      currentness: "current",
      status: "success",
    },
  ];
  const result = await collate({ query: "manual budget", extractions }, context);
  assert.match(result.text, /\*\*Collation input trimmed\*\*/);
  // The prompt itself was reduced, not just the notice added.
  const collateRequest = requests.filter((r) => r.model.model === "collate").at(-1);
  const sent = JSON.parse(collateRequest!.userMessage) as {
    sources: Array<{ extraction: string }>;
  };
  const sentChars = sent.sources.reduce((total, source) => total + source.extraction.length, 0);
  assert.ok(sentChars <= 39_200, `sent ${sentChars} characters to collation`);
  assert.match(result.text, /full extraction: `extractions\/01-/);
  const cachePath = join(root, result.details.cachePath as string);
  const extractionFiles = (await readdir(join(cachePath, "extractions"))).sort();
  const saved = await readFile(join(cachePath, "extractions", extractionFiles[0]), "utf8");
  assert.ok(saved.length > 21_000, "manual collation saves the whole extraction");
});
