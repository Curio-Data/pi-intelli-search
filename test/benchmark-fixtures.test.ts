// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as proofs from "../scripts/benchmarks/contracts.js";
import { requestSha256 } from "../scripts/benchmarks/canonical.js";
import { loadReplayStore } from "../scripts/benchmarks/replay-store.js";

// The compile-time assignability proofs in scripts/benchmarks/contracts.ts
// must each hold `true`; this runtime smoke keeps the linkage visible in test
// runs (drift fails the benchmark typecheck first).
describe("frozen API assignability proofs", () => {
  it("holds every mirrored benchmark type assignable to the frozen declarations", () => {
    const values = Object.entries(proofs).filter(([name]) => name.startsWith("proof"));
    assert.ok(values.length >= 16, `expected at least 16 proofs, found ${values.length}`);
    for (const [name, value] of values) {
      assert.equal(value, true, `proof ${name} must be true`);
    }
  });
});

const MODEL = { provider: "fixture-openrouter", model: "perplexity/sonar" };
const SYSTEM = "You are the synthetic search stage.";

describe("committed synthetic fixture files are consumable", () => {
  it("serves the synthetic model scenario in forced-workflow order", async () => {
    const store = await loadReplayStore("scripts/benchmarks/fixtures/synthetic-codemode-dev-model.json");
    const searchRequest = {
      model: MODEL,
      role: "search",
      systemPrompt: SYSTEM,
      userMessage: "public fixture query about streaming schedulers",
      maxTokens: 2048,
      reasoning: "low",
      effectivePayloadPatch: { plugins: [{ name: "web_search" }] },
    };
    const extractS2 = {
      model: MODEL,
      role: "extract",
      systemPrompt: SYSTEM,
      userMessage: "Extract the scheduling guarantees from source S2.",
      maxTokens: 2048,
      reasoning: "low",
      effectivePayloadPatch: null,
    };
    const search = await store.lookup(
      {
        boundary: "model",
        scenario: "synthetic-codemode-dev",
        operationNode: "research.search",
        requestSha256: requestSha256(searchRequest),
        occurrence: 1,
      },
      searchRequest,
    );
    assert.equal((search.response as { text: string }).text.includes("source one"), true);
    const retry = await store.lookup(
      {
        boundary: "model",
        scenario: "synthetic-codemode-dev",
        operationNode: "research.extract/S2",
        requestSha256: requestSha256(extractS2),
        occurrence: 1,
      },
      extractS2,
    );
    assert.equal(retry.error?.kind, "rate-limit");
    const success = await store.lookup(
      {
        boundary: "model",
        scenario: "synthetic-codemode-dev",
        operationNode: "research.extract/S2",
        requestSha256: requestSha256(extractS2),
        occurrence: 2,
      },
      extractS2,
    );
    assert.equal((success.response as { text: string }).text.includes("Late extractions"), true);
    // Three fixtures consumed; the remaining three (extract/S1, collate,
    // suggest) are skipped, not misses.
    assert.equal(store.consumed().length, 3);
    assert.equal(store.unconsumed().length, 3);
    assert.equal(store.misses().length, 0);
    store.assertValid();
  });

  it("serves the synthetic fetch scenario including the markdown variant", async () => {
    const store = await loadReplayStore("scripts/benchmarks/fixtures/synthetic-codemode-dev-fetch.json");
    const htmlRequest = {
      url: "https://example.com/one",
      method: "GET",
      accept: "text/html,application/xhtml+xml",
      browser: "chrome-124",
      proxyConfigured: false,
      maxResponseBytes: 8388608,
    };
    const html = await store.lookup(
      {
        boundary: "fetch",
        scenario: "synthetic-codemode-dev",
        operationNode: "page.fetch/variant-html",
        requestSha256: requestSha256(htmlRequest),
        occurrence: 1,
      },
      htmlRequest,
    );
    assert.equal((html.response as { status: number }).status, 200);
    const markdownRequest = { ...htmlRequest, accept: "text/markdown" };
    const markdown = await store.lookup(
      {
        boundary: "fetch",
        scenario: "synthetic-codemode-dev",
        operationNode: "page.fetch/variant-markdown",
        requestSha256: requestSha256(markdownRequest),
        occurrence: 1,
      },
      markdownRequest,
    );
    assert.equal((markdown.response as { bodyText: string }).bodyText.startsWith("# Example One"), true);
    assert.equal(store.misses().length, 0);
  });
});
