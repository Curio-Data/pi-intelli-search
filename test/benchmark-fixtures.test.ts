// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Api, Context, Model } from "@earendil-works/pi-ai";
import * as proofs from "../scripts/benchmarks/contracts.js";
import { fixtureFileSha256FromPath, loadReplayStore } from "../scripts/benchmarks/replay-store.js";
import {
  createModelTransportReplay,
  createPageTransportReplay,
} from "../scripts/benchmarks/transport-replay.js";
import { createAnnotationSink, harvestChunkAnnotations } from "../src/annotations.js";
import { syntheticModelResolver, syntheticPageResolver } from "../scripts/benchmarks/testing.js";
import { forbidNetwork } from "../scripts/benchmarks/testing.js";
import { createNativeUsageCapture } from "../src/native-usage.js";

// The compile-time assignability proofs in scripts/benchmarks/contracts.ts
// must each hold `true`; this runtime smoke keeps the linkage visible in test
// runs (drift fails the benchmark typecheck and the compiler gate test).
describe("frozen API assignability proofs", () => {
  it("holds every mirrored benchmark type and implementation assignable to the frozen declarations", () => {
    const values = Object.entries(proofs).filter(([name]) => name.startsWith("proof"));
    assert.ok(values.length >= 20, `expected at least 20 proofs, found ${values.length}`);
    for (const [name, value] of values) {
      assert.equal(value, true, `proof ${name} must be true`);
    }
  });
});

const MODEL_FIXTURE = "scripts/benchmarks/fixtures/synthetic-codemode-dev-model-v2.json";
const MODEL = { provider: "fixture-openrouter", id: "perplexity/sonar" } as unknown as Model<Api>;

function userContext(systemPrompt: string, text: string): Context {
  return {
    systemPrompt,
    messages: [{ role: "user", content: [{ type: "text", text }], timestamp: 1733234401000 }],
  };
}

describe("whole committed model fixture workflow through one shared instance", () => {
  it("replays search, both extracts (with retry), collate and suggest in forced-workflow order", async () => {
    const guard = forbidNetwork({ fail: (message) => assert.fail(message) });
    try {
      const store = await loadReplayStore(MODEL_FIXTURE);
      const capture = createNativeUsageCapture();
      // ONE shared instance for every stage, as the single frozen
      // NativeTestInjection seam requires.
      const replay = createModelTransportReplay({
        store,
        scenario: "synthetic-codemode-dev",
        resolveNode: syntheticModelResolver(),
      });
      const searchPatch = (payload: Record<string, unknown>) => ({
        ...payload,
        plugins: [{ name: "web_search" }],
      });
      const search = await replay(
        {
          streamSimple: () => {
            throw new Error("live registry");
          },
        } as never,
        MODEL,
        userContext(
          "You are the synthetic search stage.",
          "public fixture query about streaming schedulers",
        ),
        {
          maxTokens: 2048,
          reasoning: "low",
          onPayload: searchPatch as never,
          onProviderStreamEvent: (event) => capture.chunk(event),
        },
      );
      assert.equal(search.stopReason, "stop");
      const searchText = search.content
        .filter((block): block is { type: "text"; text: string } => block.type === "text")
        .map((block) => block.text)
        .join("");
      assert.match(searchText, /source one/);
      assert.equal(
        search.usage.input,
        0,
        "SDK placeholder cannot establish unknown uncached input",
      );
      const observed = capture.observation(search.usage);
      assert.deepEqual(observed, store.records()[0].usage);
      assert.equal(observed?.tokens.inputTotal, 1147);
      assert.equal(observed?.tokens.inputUncached, undefined);

      const extractS1 = await replay(
        {
          streamSimple: () => {
            throw new Error("live registry");
          },
        } as never,
        MODEL,
        userContext(
          "You are the synthetic extraction stage.",
          "Extract the scheduling guarantees from source S1.",
        ),
        { maxTokens: 2048, reasoning: "low" },
      );
      assert.equal(extractS1.stopReason, "stop");

      // S2 retries once: occurrence 1 is the recorded 429, occurrence 2 the
      // recorded success. Same node, same request bytes, distinct occurrences.
      const retry = await replay(
        {
          streamSimple: () => {
            throw new Error("live registry");
          },
        } as never,
        MODEL,
        userContext(
          "You are the synthetic extraction stage.",
          "Extract the scheduling guarantees from source S2.",
        ),
        { maxTokens: 2048, reasoning: "low" },
      );
      assert.equal(retry.stopReason, "error");
      assert.match(retry.errorMessage ?? "", /429/);
      const success = await replay(
        {
          streamSimple: () => {
            throw new Error("live registry");
          },
        } as never,
        MODEL,
        userContext(
          "You are the synthetic extraction stage.",
          "Extract the scheduling guarantees from source S2.",
        ),
        { maxTokens: 2048, reasoning: "low" },
      );
      assert.equal(success.stopReason, "stop");

      const collate = await replay(
        {
          streamSimple: () => {
            throw new Error("live registry");
          },
        } as never,
        MODEL,
        userContext(
          "You are the synthetic collation stage.",
          "Collate S1 and S2 into the synthetic report.",
        ),
        { maxTokens: 2048, reasoning: "low" },
      );
      assert.equal(collate.stopReason, "stop");

      const suggest = await replay(
        {
          streamSimple: () => {
            throw new Error("live registry");
          },
        } as never,
        MODEL,
        userContext(
          "You are the synthetic cache-suggestion stage.",
          "Suggest related cached searches for the synthetic query.",
        ),
        { maxTokens: 2048, reasoning: "low" },
      );
      assert.equal(suggest.stopReason, "stop");

      assert.equal(store.consumed().length, 6);
      assert.equal(store.misses().length, 0);
      store.assertValid();
      assert.equal(guard.calls(), 0);
    } finally {
      guard.restore();
    }
  });

  it("preserves the historical synthetic fixture but refuses its unreachable accounting", async () => {
    const historical = await loadReplayStore(
      "scripts/benchmarks/fixtures/synthetic-codemode-dev-model.json",
    );
    assert.throws(
      () =>
        createModelTransportReplay({
          store: historical,
          scenario: "synthetic-codemode-dev",
          resolveNode: syntheticModelResolver(),
        }),
      /differing paths:.*inputUncached/,
    );
  });

  it("delivers recorded citations the real annotation harvester can parse", async () => {
    const store = await loadReplayStore(MODEL_FIXTURE);
    const searchRecord = store
      .records()
      .find((record) => record.key.operationNode === "research.search");
    assert.ok(searchRecord?.response);
    const events =
      (searchRecord.response as { providerStreamEvents?: unknown[] }).providerStreamEvents ?? [];
    assert.equal(events.length, 2);
    const sink = createAnnotationSink();
    for (const event of events) harvestChunkAnnotations(event, sink);
    assert.deepEqual(
      sink.citations.map((citation) => citation.url),
      ["https://example.com/one", "https://example.com/two"],
    );
  });

  it("replays the recorded 429 provider metadata through onResponse", async () => {
    const store = await loadReplayStore(MODEL_FIXTURE);
    const replay = createModelTransportReplay({
      store,
      scenario: "synthetic-codemode-dev",
      resolveNode: syntheticModelResolver(),
    });
    const seen: Array<{ status: number; retryAfter: string | undefined }> = [];
    const message = await replay(
      {
        streamSimple: () => {
          throw new Error("live registry");
        },
      } as never,
      MODEL,
      userContext(
        "You are the synthetic extraction stage.",
        "Extract the scheduling guarantees from source S2.",
      ),
      {
        maxTokens: 2048,
        reasoning: "low",
        onResponse: (response) => {
          const headers = response.headers as Record<string, string>;
          seen.push({ status: response.status, retryAfter: headers["retry-after"] });
        },
      },
    );
    assert.equal(message.stopReason, "error");
    assert.deepEqual(seen, [{ status: 429, retryAfter: "1" }]);
  });

  it("exposes a verified whole-file digest for fixtureSha256", async () => {
    const digest = await fixtureFileSha256FromPath(MODEL_FIXTURE);
    assert.match(digest, /^[0-9a-f]{64}$/);
    const again = await fixtureFileSha256FromPath(MODEL_FIXTURE);
    assert.equal(digest, again);
  });
});

describe("whole committed fetch fixture workflow through one shared instance", () => {
  it("replays the html variant, markdown variant and discovery probe in workflow order", async () => {
    const guard = forbidNetwork({ fail: (message) => assert.fail(message) });
    try {
      const store = await loadReplayStore(
        "scripts/benchmarks/fixtures/synthetic-codemode-dev-fetch.json",
      );
      // ONE shared page instance below the real FetchClient.
      const transport = createPageTransportReplay({
        store,
        scenario: "synthetic-codemode-dev",
        resolveNode: syntheticPageResolver(),
        maxResponseBytes: 8388608,
      });
      const html = await transport("https://example.com/one", {
        method: "GET",
        headers: { accept: "text/html,application/xhtml+xml" },
        browser: "chrome-124",
        signal: new AbortController().signal,
      });
      assert.equal(html.status, 200);
      const markdown = await transport("https://example.com/one", {
        method: "GET",
        headers: { accept: "text/markdown" },
        browser: "chrome-124",
        signal: new AbortController().signal,
      });
      assert.equal(markdown.status, 200);
      const probe = await transport("https://example.com/llms-full.txt", {
        method: "HEAD",
        headers: { accept: "*/*" },
        browser: "chrome-124",
        signal: new AbortController().signal,
      });
      assert.equal(probe.status, 404);
      assert.equal(store.consumed().length, 3);
      assert.equal(store.misses().length, 0);
      store.assertValid();
      assert.equal(guard.calls(), 0);
    } finally {
      guard.restore();
    }
  });
});
