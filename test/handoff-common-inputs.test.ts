// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Deterministic Track A tests: frozen-input assembly, structure/digest
// verification, replay adapters (multiset enforcement, one-shot search,
// cache/unknown rejection, fetch order/options) and the final integrity
// assertion. No network, no host session, no paid calls.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assembleFrozenInputs,
  verifyFrozenInputs,
  loadFrozenInputs,
  computeFrozenDigest,
  sha256Hex,
  assertSettingsMatchFrozen,
  assertParamsMatchFrozen,
  assertCorpusAcceptable,
  createFrozenModelClient,
  createFrozenFetchPages,
  createForbidLlmsFull,
  createInputControlLatch,
  settleInputIntegrity,
  diffPaths,
  looseDeepEqual,
  FrozenIntegrityError,
} from "../scripts/research-handoff/common-inputs.js";
import { studySettings, studyParams } from "../scripts/research-handoff/config.js";
import type { FrozenInputs } from "../scripts/research-handoff/contracts.js";
import type { ModelClient, ResearchParams } from "../src/core/contracts.js";
import { SEARCH_SYSTEM_PROMPT, EXTRACTION_SYSTEM_PROMPT, COLLATION_SYSTEM_PROMPT, CACHE_SUGGEST_PROMPT } from "../src/core/prompts.js";
import { buildExtractionMessage } from "../src/core/messages.js";
import {
  buildSyntheticCorpus,
  syntheticPages,
  syntheticSearchCompletion,
  writeFrozenFile,
  arrayJournal,
  fetchOpts,
  SYNTHETIC_CAPTURE_META,
} from "./helpers/handoff-fixtures.js";

const META = { ...SYNTHETIC_CAPTURE_META };

function corpusDir(): string {
  return mkdtempSync(join(tmpdir(), "rh-common-"));
}

function baseRequest(overrides: Partial<Parameters<ModelClient["complete"]>[0]> = {}) {
  return {
    model: studySettings().searchModel,
    systemPrompt: SEARCH_SYSTEM_PROMPT,
    userMessage: "unused",
    ...overrides,
  };
}

test("assembleFrozenInputs recomputes the baseline selection semantics", async () => {
  const pages = syntheticPages(2);
  const completion = {
    // Prose links in a deliberately different order than the citation channel,
    // plus a citation-only URL and a duplicate citation, to exercise the merge.
    text: `See [Beta](${pages[1].url}) first.`,
    citations: [
      { url: pages[0].url, title: "Alpha citation" },
      { url: pages[1].url, title: "Beta duplicate" },
      { url: "https://www.postgresql.org/docs/17/citation-only.html", title: "Citation only" },
    ],
  };
  const frozen = await assembleFrozenInputs({
    params: { ...studyParams(), maxUrls: 2 },
    settings: studySettings(),
    searchCompletion: completion,
    searchAttempts: 1,
    // The runner fetches exactly the merge/cap result, so the pages arrive
    // in the SELECTED order: [Beta, Alpha].
    pages: [pages[1], pages[0]],
    meta: META,
  });
  // merge: prose [Beta], then annotations Alpha, then citation-only, capped at 2.
  assert.deepEqual(
    frozen.capture.selectedSources.map((s) => s.url),
    [pages[1].url, pages[0].url],
  );
  assert.equal(frozen.capture.effectiveMaxUrls, 2);
  assert.equal(frozen.capture.userMessage, `${studyParams().query} site:postgresql.org`);
});

test("assembleFrozenInputs rejects a zero-link capture and misaligned pages", async () => {
  const pages = syntheticPages(1);
  await assert.rejects(
    assembleFrozenInputs({
      params: studyParams(),
      settings: studySettings(),
      searchCompletion: { text: "no links at all", citations: [] },
      searchAttempts: 1,
      pages,
      meta: META,
    }),
    FrozenIntegrityError,
  );
  await assert.rejects(
    assembleFrozenInputs({
      params: studyParams(),
      settings: studySettings(),
      searchCompletion: syntheticSearchCompletion(pages),
      searchAttempts: 1,
      pages: [{ ...pages[0], url: "https://elsewhere.example/x" }],
      meta: META,
    }),
    FrozenIntegrityError,
  );
});

test("digest is canonical: key order and undefined omission do not change it", async () => {
  const { frozen } = await buildSyntheticCorpus();
  verifyFrozenInputs(frozen);
  const { digest, ...core } = frozen;
  assert.equal(digest, computeFrozenDigest(core));
  // Recomputing from a JSON round-trip (which reorders nothing but drops
  // undefined) yields the same digest.
  const roundTripped = JSON.parse(JSON.stringify(frozen)) as FrozenInputs;
  assert.equal(roundTripped.digest, digest);
  // Any single content mutation changes the digest over the mutated core.
  // (The RECORDED contentSha256 stays stale by design: that mismatch is
  // exactly what verifyFrozenInputs catches, not the digest.)
  const mutated: FrozenInputs = structuredClone(frozen);
  mutated.pages[0].page.content += "x";
  assert.equal(mutated.pages[0].contentSha256, frozen.pages[0].contentSha256);
  assert.throws(() => verifyFrozenInputs(mutated), FrozenIntegrityError);
  const { digest: _, ...mutatedCore } = mutated;
  assert.notEqual(computeFrozenDigest(mutatedCore), digest);
  assert.equal(_, digest); // the recorded digest is untouched by the mutation
});

test("verifyFrozenInputs catches structural corruption beyond the digest", async () => {
  const { frozen } = await buildSyntheticCorpus();

  const reordered = structuredClone(frozen);
  [reordered.pages[0], reordered.pages[1]] = [reordered.pages[1], reordered.pages[0]];
  assert.throws(() => verifyFrozenInputs(reordered), FrozenIntegrityError);

  const badHash = structuredClone(frozen);
  badHash.extractionInputs[0].userMessageSha256 = "0".repeat(64);
  assert.throws(() => verifyFrozenInputs(badHash), FrozenIntegrityError);

  const missingSettingsKey = structuredClone(frozen);
  delete (missingSettingsKey.settings as Record<string, unknown>).retryBaseDelayMs;
  assert.throws(() => verifyFrozenInputs(missingSettingsKey), FrozenIntegrityError);

  const extraSettingsKey = structuredClone(frozen);
  (extraSettingsKey.settings as Record<string, unknown>).unexpectedKey = 1;
  assert.throws(() => verifyFrozenInputs(extraSettingsKey), FrozenIntegrityError);

  const staleDigest = structuredClone(frozen);
  staleDigest.pages[0].page.content += "x";
  assert.throws(() => verifyFrozenInputs(staleDigest), FrozenIntegrityError);

  const wrongPrompt = structuredClone(frozen);
  wrongPrompt.capture.systemPrompt = "drifted prompt";
  assert.throws(() => verifyFrozenInputs(wrongPrompt), FrozenIntegrityError);
});

test("loadFrozenInputs verifies structure and digest, then deep-freezes", async () => {
  const dir = corpusDir();
  const path = join(dir, "frozen-inputs.json");

  const { frozen } = await buildSyntheticCorpus();
  writeFileSync(path, JSON.stringify(frozen));
  const loaded = await loadFrozenInputs({ path });
  assert.ok(Object.isFrozen(loaded));
  assert.ok(Object.isFrozen(loaded.capture));
  assert.ok(Object.isFrozen(loaded.pages[0].page));
  assert.throws(() => {
    (loaded.capture as { params: { query: string } }).params.query = "mutated";
  }, TypeError);

  const corrupt = structuredClone(frozen) as FrozenInputs;
  corrupt.digest = "0".repeat(64);
  writeFileSync(path, JSON.stringify(corrupt));
  await assert.rejects(loadFrozenInputs({ path }), FrozenIntegrityError);

  writeFileSync(path, "{not json");
  await assert.rejects(loadFrozenInputs({ path }), FrozenIntegrityError);
});

test("whole-settings equality includes retry delays, timeout and throttle", async () => {
  const { frozen } = await buildSyntheticCorpus();
  const drift: Record<string, unknown> = structuredClone(frozen.settings);
  drift.retryBaseDelayMs = 999;
  assert.throws(
    () => assertSettingsMatchFrozen({ frozen, settings: drift as never }),
    (err: unknown) => {
      assert.ok(err instanceof FrozenIntegrityError);
      assert.equal(err.kind, "settings");
      assert.ok(err.problems.some((p) => p.includes("retryBaseDelayMs")));
      return true;
    },
  );
  // httpProxy absent (JSON round-trip) equals undefined (live default).
  const roundTripped = JSON.parse(JSON.stringify(frozen.settings));
  assertSettingsMatchFrozen({ frozen, settings: roundTripped as never });
  assert.deepEqual(diffPaths(frozen.settings, roundTripped), []);
  assert.ok(looseDeepEqual({ a: 1, b: undefined }, { a: 1 }));
  assert.deepEqual(diffPaths({ a: 1 }, { a: 2 }), ["a"]);
});

test("assertParamsMatchFrozen compares every research parameter", async () => {
  const { frozen } = await buildSyntheticCorpus();
  assertParamsMatchFrozen({ frozen, params: { ...studyParams() } });
  const base = studyParams();
  const variants: ResearchParams[] = [
    { ...base, query: "different query" },
    { ...base, domains: [] },
    { ...base, focusPrompt: undefined },
    { ...base, maxUrls: 5 },
  ];
  for (const params of variants) {
    assert.throws(() => assertParamsMatchFrozen({ frozen, params }), FrozenIntegrityError);
  }
});

test("frozen model client replays the search completion once, as non-charged setup", async () => {
  const { frozen } = await buildSyntheticCorpus();
  const { events, journal } = arrayJournal();
  const delegateCalls: unknown[] = [];
  const delegate: ModelClient = {
    preflight: async () => [],
    complete: async (request) => {
      delegateCalls.push(request);
      return { text: "live", citations: [] };
    },
  };
  const client = createFrozenModelClient({ delegate, frozen, journal, latch: createInputControlLatch() });

  const completion = await client.complete(
    baseRequest({ userMessage: frozen.capture.userMessage, collectCitations: true, maxTokens: 2000 }),
  );
  assert.equal(completion.text, frozen.capture.completion.text);
  assert.deepEqual(completion.citations, []);
  // The replay must be a copy: pipeline mutation cannot corrupt the corpus.
  assert.notEqual(completion, frozen.capture.completion);
  assert.equal(delegateCalls.length, 0);
  const replay = events.find((e) => e.kind === "search-replayed");
  assert.ok(replay);
  assert.equal(replay.data.newCharge, false);
  assert.equal(replay.data.newProviderAttempt, false);
  assert.equal(replay.data.replayed, true);

  await assert.rejects(
    client.complete(baseRequest({ userMessage: frozen.capture.userMessage, collectCitations: true, maxTokens: 2000 })),
    FrozenIntegrityError,
  );
  assert.equal(events.filter((e) => e.kind === "search-replay-exhausted").length, 1);
});

test("frozen model client rejects any search request identity drift", async () => {
  const { frozen } = await buildSyntheticCorpus();
  for (const overrides of [
    { userMessage: "different query" },
    { maxTokens: 999 },
    { model: { provider: "openrouter", model: "perplexity/sonar-pro" } },
    { collectCitations: false },
  ]) {
    const { journal } = arrayJournal();
    const client = createFrozenModelClient({
      delegate: { preflight: async () => [], complete: async () => ({ text: "", citations: [] }) },
      frozen,
      journal,
      latch: createInputControlLatch(),
    });
    await assert.rejects(client.complete(baseRequest(overrides)), FrozenIntegrityError);
  }
});

test("extraction requests are checked against the remaining multiset before delegation", async () => {
  const pages = syntheticPages(2);
  const { frozen } = await buildSyntheticCorpus({ pages });
  const { events, journal } = arrayJournal();
  const delegateCalls: Array<{ userMessage: string }> = [];
  const delegate: ModelClient = {
    preflight: async () => [],
    complete: async (request) => {
      delegateCalls.push({ userMessage: request.userMessage });
      return { text: "synthetic extraction", citations: [] };
    },
  };
  const client = createFrozenModelClient({ delegate, frozen, journal, latch: createInputControlLatch() });

  const expected = frozen.extractionInputs;
  assert.equal(expected.length, 2);

  const first = await client.complete(
    baseRequest({
      model: studySettings().extractModel,
      systemPrompt: EXTRACTION_SYSTEM_PROMPT,
      userMessage: buildExtractionMessage(pages[0].content, studyParams().query, studyParams().focusPrompt, studySettings().extractMaxChars),
    }),
  );
  assert.equal(first.text, "synthetic extraction");
  assert.equal(delegateCalls.length, 1);

  // A second request with a message that is NOT in the expected multiset
  // (and is not the other expected page) is refused BEFORE delegation.
  await assert.rejects(
    client.complete(
      baseRequest({
        model: studySettings().extractModel,
        systemPrompt: EXTRACTION_SYSTEM_PROMPT,
        userMessage: "tampered page content",
      }),
    ),
    FrozenIntegrityError,
  );
  assert.equal(delegateCalls.length, 1);
  assert.equal(events.filter((e) => e.kind === "extract-hash-mismatch").length, 1);
});

test("repeated identical page messages consume the multiset exactly once each", async () => {
  const pages = syntheticPages(2, { duplicateContent: true });
  const { frozen } = await buildSyntheticCorpus({ pages });
  // Two distinct URLs, one identical extraction message hash.
  assert.equal(frozen.extractionInputs.length, 2);
  assert.equal(frozen.extractionInputs[0].userMessageSha256, frozen.extractionInputs[1].userMessageSha256);
  assert.notEqual(frozen.extractionInputs[0].url, frozen.extractionInputs[1].url);

  const { journal } = arrayJournal();
  const delegateCalls: unknown[] = [];
  const client = createFrozenModelClient({
    delegate: {
      preflight: async () => [],
      complete: async (request) => {
        delegateCalls.push(request);
        return { text: "ok", citations: [] };
      },
    },
    frozen,
    journal,
    latch: createInputControlLatch(),
  });
  const message = buildExtractionMessage(pages[0].content, studyParams().query, studyParams().focusPrompt, studySettings().extractMaxChars);
  await client.complete(baseRequest({ model: studySettings().extractModel, systemPrompt: EXTRACTION_SYSTEM_PROMPT, userMessage: message }));
  await client.complete(baseRequest({ model: studySettings().extractModel, systemPrompt: EXTRACTION_SYSTEM_PROMPT, userMessage: message }));
  assert.equal(delegateCalls.length, 2);
  // A third occurrence exceeds the expected multiplicity: refused.
  await assert.rejects(
    client.complete(baseRequest({ model: studySettings().extractModel, systemPrompt: EXTRACTION_SYSTEM_PROMPT, userMessage: message })),
    FrozenIntegrityError,
  );
  assert.equal(delegateCalls.length, 2);
});

test("collation is journaled and delegated; cache suggestion and unknown stages are rejected and latch", async () => {
  const { frozen } = await buildSyntheticCorpus();
  const { events, journal } = arrayJournal();
  const delegateCalls: unknown[] = [];
  const delegate: ModelClient = {
    preflight: async () => [],
    complete: async (request) => {
      delegateCalls.push(request);
      return { text: "collated", citations: [], usage: { input: 10, output: 5 } };
    },
  };
  const client = createFrozenModelClient({ delegate, frozen, journal, latch: createInputControlLatch() });

  const collated = await client.complete(
    baseRequest({ model: studySettings().collateModel, systemPrompt: COLLATION_SYSTEM_PROMPT, userMessage: '{"query":"q"}' }),
  );
  assert.equal(collated.text, "collated");
  const requests = events.filter((e) => e.kind === "model-request");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].data.role, "collate");
  const completions = events.filter((e) => e.kind === "model-completion");
  assert.equal(completions.length, 1);
  // Usage is labelled an SDK-normalised estimate, never reported billing,
  // and the completion text is retained for variation analysis.
  assert.deepEqual(completions[0].data.usageEstimate, { input: 10, output: 5 });
  assert.equal(completions[0].data.usageKind, "sdk-normalised-estimate");
  assert.equal(completions[0].data.text, "collated");
  assert.equal(completions[0].data.textSha256, sha256Hex("collated"));

  // Unknown stage: rejected and LATCHED.
  await assert.rejects(
    client.complete(baseRequest({ systemPrompt: "an unrecognised prompt", userMessage: "x" })),
    FrozenIntegrityError,
  );
  assert.equal(events.filter((e) => e.kind === "stage-unclassified").length, 1);

  // After the latch, even a fully valid extraction request is refused BEFORE
  // any live delegation (F2).
  const validMessage = buildExtractionMessage(
    (frozen.pages[0].page as { content: string }).content,
    frozen.capture.params.query,
    frozen.capture.params.focusPrompt,
    (frozen.settings as ReturnType<typeof studySettings>).extractMaxChars,
  );
  await assert.rejects(
    client.complete(
      baseRequest({ model: studySettings().extractModel, systemPrompt: EXTRACTION_SYSTEM_PROMPT, userMessage: validMessage }),
    ),
    FrozenIntegrityError,
  );
  assert.equal(events.filter((e) => e.kind === "input-control-latched").length, 1);
  assert.equal(delegateCalls.length, 1); // only the collation was ever delegated

  // Cache suggestion on a fresh, unlatched client: rejected and latched.
  const { events: cacheEvents, journal: cacheJournal } = arrayJournal();
  const freshClient = createFrozenModelClient({
    delegate,
    frozen,
    journal: cacheJournal,
    latch: createInputControlLatch(),
  });
  await assert.rejects(
    freshClient.complete(baseRequest({ systemPrompt: CACHE_SUGGEST_PROMPT, userMessage: "judge" })),
    FrozenIntegrityError,
  );
  assert.equal(cacheEvents.filter((e) => e.kind === "cache-suggest-rejected").length, 1);
  await assert.rejects(
    freshClient.complete(baseRequest({ systemPrompt: COLLATION_SYSTEM_PROMPT, userMessage: "later" })),
    FrozenIntegrityError,
  );
  assert.equal(cacheEvents.filter((e) => e.kind === "input-control-latched").length, 1);
});

test("frozen fetch serves ordered clones and rejects order, options and abort deviations", async () => {
  const { frozen, pages } = await buildSyntheticCorpus();
  const { events, journal } = arrayJournal();
  const fetchPages = createFrozenFetchPages({ frozen, journal, latch: createInputControlLatch() });
  const settings = frozen.settings as ReturnType<typeof studySettings>;
  const opts = fetchOpts(settings);

  const served = await fetchPages(pages.map((p) => p.url), undefined, opts);
  assert.equal(served.length, 3);
  assert.deepEqual(
    served.map((p) => p.url),
    pages.map((p) => p.url),
  );
  assert.notEqual(served[0], frozen.pages[0].page); // copy, not reference
  assert.equal(events.filter((e) => e.kind === "fetch-served").length, 1);

  // One serving per execution: a second identical request is rejected as
  // repeated fetch evidence and latches (F15).
  await assert.rejects(fetchPages(pages.map((p) => p.url), undefined, opts), FrozenIntegrityError);
  assert.equal(events.filter((e) => e.kind === "fetch-repeated").length, 1);

  await assert.rejects(fetchPages([...pages.map((p) => p.url)].reverse(), undefined, opts), FrozenIntegrityError);
  await assert.rejects(fetchPages(pages.slice(0, 2).map((p) => p.url), undefined, opts), FrozenIntegrityError);
  assert.equal(events.filter((e) => e.kind === "fetch-mismatch").length, 2);
  await assert.rejects(
    fetchPages(pages.map((p) => p.url), undefined, fetchOpts(settings, { concurrency: 99 })),
    FrozenIntegrityError,
  );
  assert.equal(events.filter((e) => e.kind === "fetch-options-mismatch").length, 1);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fetchPages(pages.map((p) => p.url), controller.signal, opts), { name: "AbortError" });
});

test("documentation discovery is forbidden", async () => {
  const { events, journal } = arrayJournal();
  const forbidden = createForbidLlmsFull({ journal, latch: createInputControlLatch() });
  await assert.rejects(forbidden("https://example.example", "/scratch/x", undefined), FrozenIntegrityError);
  assert.equal(events.filter((e) => e.kind === "llms-full-forbidden").length, 1);
});

test("extraction hashes cover the truncated message, not the raw page", async () => {
  const pages = syntheticPages(1);
  const settings = { ...studySettings(), extractMaxChars: 50 };
  const { frozen } = await buildSyntheticCorpus({ settings, pages });
  const expectedMessage = buildExtractionMessage(pages[0].content, studyParams().query, studyParams().focusPrompt, 50);
  const untruncatedMessage = buildExtractionMessage(pages[0].content, studyParams().query, studyParams().focusPrompt, 150_000);
  assert.ok(pages[0].content.length > 50);
  assert.notEqual(expectedMessage, untruncatedMessage);
  assert.ok(expectedMessage.length < untruncatedMessage.length);
  assert.equal(frozen.extractionInputs[0].userMessageSha256, sha256Hex(expectedMessage));
  assert.notEqual(frozen.extractionInputs[0].userMessageSha256, sha256Hex(pages[0].content));
  verifyFrozenInputs(frozen);
});

test("settleInputIntegrity verifies exact multiset consumption and deviation events", async () => {
  const { frozen, pages } = await buildSyntheticCorpus();
  const { events, journal } = arrayJournal();
  const delegate: ModelClient = {
    preflight: async () => [],
    complete: async () => ({ text: "x", citations: [] }),
  };
  const client = createFrozenModelClient({ delegate, frozen, journal, latch: createInputControlLatch() });
  const fetch = createFrozenFetchPages({ frozen, journal, latch: createInputControlLatch() });

  // Complete the expected exchange for two of the three pages, then settle:
  // one extraction remains unconsumed. That is an execution gap, NOT an
  // input mismatch (F4): matched stays true, complete is false.
  await client.complete(
    baseRequest({
      model: studySettings().searchModel,
      userMessage: frozen.capture.userMessage,
      collectCitations: true,
      maxTokens: 2000,
    }),
  );
  await fetch(pages.map((p) => p.url), undefined, fetchOpts(frozen.settings as ReturnType<typeof studySettings>));
  for (const page of pages.slice(0, 2)) {
    const message = buildExtractionMessage(page.content, studyParams().query, studyParams().focusPrompt, (frozen.settings as ReturnType<typeof studySettings>).extractMaxChars);
    await client.complete(
      baseRequest({ model: studySettings().extractModel, systemPrompt: EXTRACTION_SYSTEM_PROMPT, userMessage: message }),
    );
  }
  let settled = settleInputIntegrity({ frozen, events });
  assert.equal(settled.matched, true);
  assert.deepEqual(settled.problems, []);
  assert.equal(settled.complete, false);
  assert.ok(settled.completenessProblems.some((p) => p.includes("expected 1")));

  // Completing the third extraction and the result event closes the loop.
  const third = pages[2];
  const message = buildExtractionMessage(third.content, studyParams().query, studyParams().focusPrompt, (frozen.settings as ReturnType<typeof studySettings>).extractMaxChars);
  await client.complete(
    baseRequest({ model: studySettings().extractModel, systemPrompt: EXTRACTION_SYSTEM_PROMPT, userMessage: message }),
  );
  events.push({ kind: "research-result", data: { outcome: "completed" } });
  settled = settleInputIntegrity({ frozen, events });
  assert.equal(settled.matched, true);
  assert.equal(settled.complete, true);
  assert.deepEqual(settled.problems, []);
  assert.deepEqual(settled.completenessProblems, []);

  // A deviation event is an input mismatch even with a complete multiset.
  events.push({ kind: "fetch-mismatch", data: {} });
  settled = settleInputIntegrity({ frozen, events });
  assert.equal(settled.matched, false);
  assert.equal(settled.complete, true);

  // A degraded outcome is an execution problem, never an input mismatch.
  const degradedOutcome = events.filter((e) => e.kind !== "research-result" && e.kind !== "fetch-mismatch");
  degradedOutcome.push({ kind: "research-result", data: { outcome: "fetch-failed" } });
  settled = settleInputIntegrity({ frozen, events: degradedOutcome });
  assert.equal(settled.matched, true);
  assert.equal(settled.complete, false);
  assert.ok(settled.completenessProblems.some((p) => p.includes("fetch-failed")));
});

test("written frozen file round-trips through loadFrozenInputs", async () => {
  const { frozen } = await buildSyntheticCorpus();
  const path = writeFrozenFile(frozen);
  const loaded = await loadFrozenInputs({ path });
  assert.equal(loaded.digest, frozen.digest);
  assert.deepEqual(loaded.capture.selectedSources, frozen.capture.selectedSources);
});

test("corpus acceptance floor is separate from replay validity (F10)", async () => {
  // An all-error corpus is a VALID replay fixture (negative parity cases)
  // but is NOT an acceptable study corpus.
  const pages = syntheticPages(3).map((page) => ({
    ...page,
    status: "error" as const,
    error: "synthetic fetch failure (all error)",
  }));
  const completion = {
    text: pages.map((page) => `[${page.title}](${page.url})`).join(" "),
    citations: [],
  };
  const { frozen } = await buildSyntheticCorpus({ pages, searchCompletion: completion });
  verifyFrozenInputs(frozen); // replay-valid
  const path = writeFrozenFile(frozen);
  const loaded = await loadFrozenInputs({ path }); // loads for replay
  assert.equal(loaded.pages.every((entry) => entry.page.status === "error"), true);
  assert.throws(() => assertCorpusAcceptable({ frozen }), FrozenIntegrityError);

  // A corpus with two readable pages meets the protocol floor.
  const mixed = syntheticPages(3).map((page, i) =>
    i === 2 ? { ...page, status: "error" as const, error: "one failure" } : page,
  );
  const { frozen: accepted } = await buildSyntheticCorpus({
    pages: mixed,
    searchCompletion: { text: mixed.map((page) => `[${page.title}](${page.url})`).join(" "), citations: [] },
  });
  assertCorpusAcceptable({ frozen: accepted });
  assert.throws(() => assertCorpusAcceptable({ frozen: accepted, minReadable: 3 }), FrozenIntegrityError);
});

test("re-digested inconsistent corpora are rejected at load (F15)", async () => {
  const { frozen } = await buildSyntheticCorpus();
  const redigest = (mutate: (f: typeof frozen) => void): typeof frozen => {
    const copy = structuredClone(frozen);
    mutate(copy);
    const { digest: _old, ...core } = copy;
    return { ...core, digest: computeFrozenDigest(core) };
  };

  // Consistently reordered sources and pages, re-digested: the selection
  // recompute catches it at load instead of at the fetch boundary.
  const reordered = redigest((f) => {
    f.capture.selectedSources = [...f.capture.selectedSources].reverse();
    f.pages = [...f.pages].reverse();
  });
  assert.throws(() => verifyFrozenInputs(reordered), (err: unknown) => {
    assert.ok(err instanceof FrozenIntegrityError);
    assert.ok(err.problems.some((p) => p.includes("selectedSources")));
    return true;
  });

  // Tampered search userMessage, re-digested: request consistency catches it.
  const tamperedMessage = redigest((f) => {
    f.capture.userMessage = "a different search message";
  });
  assert.throws(() => verifyFrozenInputs(tamperedMessage), (err: unknown) => {
    assert.ok(err instanceof FrozenIntegrityError);
    assert.ok(err.problems.some((p) => p.includes("appendDomainFilter")));
    return true;
  });

  // Search model inconsistent with settings.searchModel, re-digested.
  const tamperedModel = redigest((f) => {
    f.capture.searchModel = { provider: "openrouter", model: "perplexity/sonar-pro" };
  });
  assert.throws(() => verifyFrozenInputs(tamperedModel), (err: unknown) => {
    assert.ok(err instanceof FrozenIntegrityError);
    assert.ok(err.problems.some((p) => p.includes("settings.searchModel")));
    return true;
  });

  // A citation entry that is not an object with a url is rejected.
  const badCitation = redigest((f) => {
    (f.capture.completion.citations as unknown[]).push("not-a-citation");
  });
  assert.throws(() => verifyFrozenInputs(badCitation), FrozenIntegrityError);
});

test("diffPaths distinguishes arrays from objects (F15)", async () => {
  assert.deepEqual(diffPaths([], {}), ["<root>"]);
  assert.deepEqual(diffPaths({}, []), ["<root>"]);
  assert.equal(looseDeepEqual([], {}), false);
  assert.equal(looseDeepEqual([], []), true);
  assert.deepEqual(diffPaths({ a: [] }, { a: {} }), ["a"]);
});
