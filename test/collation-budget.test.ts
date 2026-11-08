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
  safeCutLength,
  serializedLength,
} from "../src/core/collation-budget.js";
import { buildCollationMessage, collationSourceOverheadChars } from "../src/core/messages.js";
import { tuningDefaults } from "../src/core/defaults.js";
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
    plan.trims.map((trim) => [trim.url, trim.action, trim.keptChars, trim.sourceCap, trim.budget]),
    [["https://one.example", "trimmed", 4_000, true, false]],
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
    plan.trims.map((trim) => [trim.url, trim.keptChars, trim.sourceCap, trim.budget]),
    [["https://cited.example", 5_000, false, true]],
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
    plan.trims.map((trim) => [trim.url, trim.action, trim.keptChars, trim.sourceCap, trim.budget]),
    [
      ["https://cited-long.example", "trimmed", 3_333, false, true],
      ["https://guess.example", "trimmed", 3_333, false, true],
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

it("sends six cap-filled post-retry extractions whole and trims at seven", () => {
  // The owner's confirmed worst case: every extraction filled the 32,000-token
  // cap left by two retries. Six fit the 221,000-token budget; seven do not.
  const fill = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      url: `https://source-${i + 1}.example`,
      text: "a".repeat(32_000 * 4),
    }));
  // The shipped defaults, not literals: a default that shrinks must fail here.
  const defaults = tuningDefaults();
  const options = {
    budgetTokens: defaults.collationInputBudgetTokens,
    sourceMaxTokens: defaults.collationSourceMaxTokens,
  };
  const six = planCollationBudget(fill(6), options);
  assert.deepEqual(six.trims, [], "six cap-filled extractions fit the budget whole");
  assert.equal(six.overBudget, false);
  assert.equal(six.charsAfter, 6 * 32_000 * 4);

  const seven = planCollationBudget(fill(7), options);
  assert.equal(seven.overBudget, true);
  assert.ok(seven.trims.length > 0);
  assert.ok(seven.trims.every((trim) => trim.budget && !trim.sourceCap));
});

it("records both limits on a source reduced by the cap and the budget", () => {
  // The reviewer's dual-bound case: each source is capped first, then the
  // aggregate budget trims the capped text again.
  const plan = planCollationBudget(
    Array.from({ length: 40 }, (_, i) => ({
      url: `https://s${i}.example/`,
      text: "a".repeat(10_000),
    })),
    { budgetTokens: 10_000, sourceMaxTokens: 256 },
  );
  assert.equal(plan.trims.length, 40);
  assert.ok(
    plan.trims.every((trim) => trim.sourceCap && trim.budget),
    "each source hit the per-source cap and then the input budget",
  );
  assert.ok(plan.trims.every((trim) => trim.keptChars < 1_024));
  // A source can be budget-only: no cap on this one, but no room either.
  const mixed = planCollationBudget(
    [
      { url: "https://big.example/", text: "b".repeat(10_000) },
      { url: "https://small.example/", text: "c".repeat(600) },
    ],
    { budgetTokens: 450, sourceMaxTokens: 256 },
  );
  assert.deepEqual(
    mixed.trims.map((trim) => [trim.url, trim.sourceCap, trim.budget]),
    [
      ["https://big.example/", true, true],
      ["https://small.example/", false, true],
    ],
  );
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
  assert.match(result.text, /Trimmed to a fair share of the input budget \(2\):/);
  assert.match(result.text, /full extraction: `[^`]+\/extractions\/01-/);
  assert.match(result.text, /raise collationInputBudgetTokens/);
  assert.doesNotMatch(result.text, /collationSourceMaxTokens/, "only the budget bound here");
  assert.match(result.text, /Trim order:/, "the fair-share machinery ran");
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

it("names the per-source setting when only the per-source cap trimmed", async (t) => {
  const root = await workspace(t);
  const { result } = await researchWithExtractions(root, 30_000, {
    collationInputBudgetTokens: 1_000_000,
    collationSourceMaxTokens: 1_000,
  });
  assert.equal(result.outcome, "completed");
  assert.match(result.text, /\*\*Collation input trimmed\*\*/);
  assert.match(result.text, /collationSourceMaxTokens/);
  assert.match(result.text, /per-source limit/);
  assert.doesNotMatch(result.text, /raise collationInputBudgetTokens/);
  assert.doesNotMatch(result.text, /exceeded the 1000000-token input budget/);
  assert.doesNotMatch(
    result.text,
    /Trim order:/,
    "the fair-share and drop machinery did not run, so it is not described",
  );
});

it("names both limits when a source is capped and then trimmed to the budget", async (t) => {
  const root = await workspace(t);
  const { context } = coreContext(root, {
    collationInputBudgetTokens: 10_000,
    collationSourceMaxTokens: 256,
    maxUrls: 3,
  });
  const extractions: ExtractResult[] = Array.from({ length: 40 }, (_, i) => ({
    url: `https://source-${i}.example`,
    title: `Source ${i}`,
    extraction: "a".repeat(10_000),
    sourceType: "docs",
    currentness: "current",
    status: "success" as const,
  }));
  const result = await collate({ query: "dual bound", extractions }, context);
  assert.match(result.text, /collationSourceMaxTokens/);
  assert.match(result.text, /collationInputBudgetTokens/);
  assert.match(result.text, /Trimmed by both limits \(40\)/);
  assert.match(result.text, /raise collationSourceMaxTokens/);
  assert.match(result.text, /raise collationInputBudgetTokens/);
  const report = await readFile(join(root, result.details.cachePath as string, "report.md"), "utf8");
  assert.match(report, /collationSourceMaxTokens/);
  assert.match(report, /collationInputBudgetTokens/);
  assert.match(report, /Trimmed by both limits \(40\)/);
  assert.match(report, /full extraction: `[^`]+\/extractions\/01-source-0-example\.md`/);
  const saved = await readFile(join(root, result.details.cachePath as string, "extractions", "01-source-0-example.md"), "utf8");
  assert.ok(saved.includes("a".repeat(10_000)), "the saved extraction remains whole");
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
  assert.match(result.text, /full extraction: `[^`]+\/extractions\/01-/);
  const cachePath = join(root, result.details.cachePath as string);
  const extractionFiles = (await readdir(join(cachePath, "extractions"))).sort();
  const saved = await readFile(join(cachePath, "extractions", extractionFiles[0]), "utf8");
  assert.ok(saved.length > 21_000, "manual collation saves the whole extraction");
});

it("measures text by its JSON-escaped length, as the collation request carries it", () => {
  const corpus = [
    "plain text",
    "line one\nline two\r\n\ttabbed",
    'quotes " and backslashes \\ here',
    "control \u0001\u001f characters",
    "astral 🚀 emoji and é combining",
    "lone \ud800 high and \udc00 low surrogates",
    "",
  ];
  for (const text of corpus) {
    assert.equal(serializedLength(text), JSON.stringify(text).length - 2, JSON.stringify(text));
  }
  // A prefix that ends inside a surrogate pair is charged as a lone surrogate.
  const pair = "a🚀";
  assert.equal(serializedLength(pair, 2), JSON.stringify(pair.slice(0, 2)).length - 2);
});

it("keeps a line-heavy extraction's actual request inside the input budget", () => {
  // 19,500 two-character lines: 39,000 raw characters, 58,500 once escaped.
  const extraction: ExtractResult = {
    url: "https://lines.example/raw.txt",
    title: "Raw lines",
    extraction: "a\n".repeat(19_500),
    sourceType: "code",
    currentness: "current",
    status: "success",
  };
  const budgetTokens = 10_000;
  const plan = planCollationBudget(
    [
      {
        url: extraction.url,
        text: extraction.extraction,
        overheadChars: collationSourceOverheadChars(extraction, 1),
      },
    ],
    { budgetTokens, sourceMaxTokens: 32_000 },
  );
  assert.equal(plan.overBudget, true, "raw length alone would have fitted");
  const sent = buildCollationMessage("q", ".search/run", undefined, [
    { ...extraction, sourceNumber: 1, extraction: plan.sources[0].text },
  ]);
  // Everything but the query and the request wrapper is inside the budget.
  const wrapper = JSON.stringify({ query: "q", sources: [] }, null, 2).length;
  assert.ok(
    sent.length <= budgetTokens * 4 + wrapper,
    `request is ${sent.length} characters for a ${budgetTokens * 4}-character budget`,
  );
});

it("charges a source's measured metadata when it exceeds the fixed header", () => {
  const long: ExtractResult = {
    url: `https://meta.example/${"p".repeat(1_000)}`,
    title: "T".repeat(2_000),
    extraction: "x".repeat(8_000),
    sourceType: "docs",
    currentness: "current",
    status: "success",
  };
  const overhead = collationSourceOverheadChars(long, 1);
  assert.ok(overhead > COLLATION_HEADER_TOKENS_PER_SOURCE * 4);
  const item = { url: long.url, text: long.extraction };
  const budget = { budgetTokens: 2_500, sourceMaxTokens: 32_000 };
  assert.equal(planCollationBudget([item], budget).overBudget, false);
  assert.equal(planCollationBudget([{ ...item, overheadChars: overhead }], budget).overBudget, true);
});

/** An extraction whose second URL lies beyond the per-source cap of 256 tokens. */
const trimmedUrlExtraction =
  "official docs, current\nKept fact from https://kept.example/a\n" +
  "Filler sentence that pads the extraction past its cap.\n".repeat(40) +
  "Trimmed fact from https://trimmed.example/secret\n";

async function researchCiting(root: string, collation: string, telemetry = false) {
  const base = coreContext(root, { collationSourceMaxTokens: 256, disableTelemetry: !telemetry });
  const complete = base.context.models.complete;
  base.context.models.complete = async (request) => {
    if (request.model.model === "extract") return { text: trimmedUrlExtraction, citations: [] };
    if (request.model.model === "collate") {
      await complete(request);
      return { text: collation, citations: [] };
    }
    return complete(request);
  };
  const result = await research({ query: "trimmed citation" }, base.context, base.dependencies);
  const sent = base.requests.filter((r) => r.model.model === "collate").at(-1)!.userMessage;
  return { result, sent };
}

it("rejects a research citation that only the trimmed-away extraction text held", async (t) => {
  const { result, sent } = await researchCiting(
    await workspace(t),
    "A claim [S1] from https://trimmed.example/secret.",
  );
  assert.doesNotMatch(sent, /trimmed\.example/, "the model never received the URL");
  assert.notEqual(result.outcome, "completed");
  assert.doesNotMatch(result.text, /A claim \[S1\] from https:\/\/trimmed\.example/);
});

it("accepts a research citation that the delivered extraction text held", async (t) => {
  const { result } = await researchCiting(
    await workspace(t),
    "A claim [S1] from https://kept.example/a.",
  );
  assert.equal(result.outcome, "completed");
  assert.match(result.text, /Collation input trimmed/);
});

it("rejects a manual-collation citation that only the trimmed-away text held", async (t) => {
  const root = await workspace(t);
  const { context } = coreContext(root, { collationSourceMaxTokens: 256 });
  context.models.complete = async () => ({
    text: "A claim [S1] from https://trimmed.example/secret.",
    citations: [],
  });
  const extractions: ExtractResult[] = [
    {
      url: "https://one.example/page",
      title: "One",
      extraction: trimmedUrlExtraction,
      sourceType: "official docs",
      currentness: "current",
      status: "success",
    },
  ];
  await assert.rejects(
    collate({ query: "manual trimmed citation", extractions }, context),
    /absent from the supplied evidence/,
  );
});

/** Filler lines, then a Markdown link that straddles the 1,024-character cap. */
function straddlingLink(): string {
  let text = "official docs, current\n";
  while (text.length < 960) text += "Filler about tunnel failover behaviour.\n";
  return (
    text +
    "- [Tunnel availability and failover](https://docs.example/tunnels/availability/)\n" +
    "More text after the link that the cap removes.\n".repeat(20)
  );
}

const OPEN_LINK = /!?\[[^\]\n]*(?:\]\([^)\n]*)?$/;

it("never ends a per-source cut inside a Markdown link (round-2 DS-F1)", () => {
  const text = straddlingLink();
  const cap = 256 * 4;
  assert.ok(text.indexOf("](https") < cap && text.indexOf("/availability/)") > cap, "the link straddles the cap");
  const plan = planCollationBudget([{ url: "https://one.example", text }], {
    budgetTokens: 1_000_000,
    sourceMaxTokens: 256,
  });
  const sent = plan.sources[0].text;
  assert.ok(sent.length > 0 && sent.length <= cap);
  assert.doesNotMatch(sent, OPEN_LINK);
  assert.doesNotMatch(sent, /docs\.example|Tunnel availability/);
  assert.equal(plan.trims[0].keptChars, sent.length);
});

it("never ends a budget trim inside a Markdown link", () => {
  // One long line: the last word boundary in the allowance is inside the label.
  const text =
    "official docs, current\n" +
    "word ".repeat(200) +
    "[Tunnel availability and failover guide](https://docs.example/tunnels/availability/) " +
    "tail ".repeat(200);
  const share = text.indexOf("failover guide") + 10;
  const plan = planCollationBudget(
    [
      { url: "https://one.example", text },
      { url: "https://two.example", text: body(share) },
    ],
    {
      budgetTokens: Math.ceil((2 * share + 2 * COLLATION_HEADER_TOKENS_PER_SOURCE * 4) / 4),
      sourceMaxTokens: 100_000,
    },
  );
  assert.ok(plan.trims.some((t) => t.url === "https://one.example" && t.budget));
  assert.doesNotMatch(plan.sources[0].text, OPEN_LINK);
});

it("backs a cut off an open fence, a split URL or an open link, and only shortens", () => {
  const fence = "Intro line one.\nIntro line two.\n```sh\ncurl https://a.example/x\n";
  assert.equal(safeCutLength(fence + "more\n```\n", fence.length), fence.indexOf("```"));
  const url = "Some context before the reference. Read the guide at https://docs.example/a/b/c for details.";
  const inUrl = url.indexOf("/b/");
  assert.equal(safeCutLength(url, inUrl), url.indexOf("https"));
  const link = "Plenty of text before the link here. [Guide](https://x.example/g) after.";
  assert.equal(safeCutLength(link, link.indexOf("x.example")), link.indexOf("[Guide"));
  // One huge token keeps its plain cut instead of being emptied.
  const token = "h".repeat(2000);
  assert.equal(safeCutLength(token, 1000), 1000);
  // Never leaves a lone high surrogate.
  const emoji = "word ".repeat(10) + "\u{1F600}".repeat(5);
  const mid = emoji.length - 3;
  assert.ok(safeCutLength(emoji, mid) <= mid);
  assert.equal(safeCutLength("a b", 99), 99);
});

it("names the rejected URL and keeps the trim on record when trimmed collation fails (DS-F3)", async (t) => {
  const root = await workspace(t);
  const { result } = await researchCiting(
    root,
    "A claim [S1] from https://trimmed.example/secret.",
    true,
  );
  assert.equal(result.outcome, "collate-failed");
  const dir = join(root, result.details.cachePath as string);
  const report = await readFile(join(dir, "report.md"), "utf8");
  for (const output of [result.text, report]) {
    assert.match(output, /absent from the supplied evidence \(https:\/\/trimmed\.example\/secret\)/);
  }
  assert.match(report, /Collation input trimmed/);
  const meta = JSON.parse(await readFile(join(dir, "meta.json"), "utf8"));
  assert.ok(meta.stages.collate.error);
  assert.ok(meta.stages.collate.inputBudget.trimmed >= 1);
});
