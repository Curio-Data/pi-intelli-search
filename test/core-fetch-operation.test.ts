// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { it } from "node:test";
import { Check } from "typebox/value";
import { fetchPage, FetchOperationFailure } from "../src/core/operations/fetch.js";
import { fetchOutputSchema } from "../src/core/output-schemas.js";
import { createOperationRuntime } from "../src/core/operation-runtime.js";
import { createSystemClock } from "../src/core/clock.js";
import { parseExecutionSettings } from "../src/core/execution-settings.js";
import { coreContext } from "./helpers/core-context.js";
import type {
  Context,
  FetchClient,
  Progress,
  RunStore,
  SourceRecord,
} from "../src/core/contracts.js";

const never = async (): Promise<never> => {
  throw new Error("unexpected persistence/model work");
};
const store: RunStore = {
  allocate: never,
  commit: never,
  updateIndex: never,
  recordAccounting: never,
  candidates: never,
  settle: async () => {},
};
async function run(fetch: FetchClient["fetch"], signal?: AbortSignal) {
  const clock = createSystemClock();
  const progress: Progress[] = [];
  const context = coreContext("/workspace").context;
  const runtime = createOperationRuntime({
    clock,
    generation: 1,
    modelConcurrency: 2,
    criticalReserve: 1,
    fetchConcurrency: 1,
    minRequestIntervalMs: 0,
    createFetch: () => ({ fetch, discover: never }),
    createRuns: () => store,
  });
  try {
    return {
      result: await runtime.run(
        { operationId: "fetch-operation", signal, onProgress: (e) => progress.push(e) },
        (services) =>
          fetchPage(
            { url: "https://example.com" },
            {
              ...context,
              settings: {
                ...context.settings,
                execution: parseExecutionSettings({ modelConcurrency: 2 }),
              },
              services,
              models: { preflight: never, complete: never },
            },
          ),
      ),
      progress,
    };
  } finally {
    await runtime.close();
  }
}
for (const state of ["fetched", "empty", "fetch-failed"] as const)
  it(`fetchPage full schema, honest counts/progress and zero attempts: ${state}`, async () => {
    const page: SourceRecord = {
      id: "S1",
      url: "https://example.com",
      title: "Title",
      state,
      ...(state === "fetch-failed"
        ? { diagnostic: "HTTP_STATUS" }
        : { content: state === "empty" ? "" : "RAW_MARKER", truncated: false }),
    };
    const { result, progress } = await run(async () => ({ page, transferredBytes: 24 }));
    assert(Check(fetchOutputSchema, result.data));
    assert.equal(result.outcome, state === "fetch-failed" ? "fetch-failed" : "completed");
    assert.equal(result.text, result.data.text);
    assert.deepEqual(result.details, result.data.details);
    assert(!result.text.includes("RAW_MARKER"));
    assert(!JSON.stringify(result.details).includes("RAW_MARKER"));
    assert.equal(result.data.counts.used, 0);
    assert.equal(result.data.counts.fetched, state === "fetch-failed" ? 0 : 1);
    assert.equal(result.data.accounting.attempts, 0);
    assert.equal(result.usage.totalTokens, 0);
    assert.deepEqual(
      progress.map((e) => e.event),
      ["start", "end"],
    );
    assert.deepEqual(
      progress.map((e) => e.sequence),
      [1, 2],
    );
    assert.equal(progress[1].pct, 100);
    assert(!Check(fetchOutputSchema, { ...result.data, surprise: true }));
  });
it("fetchPage operational error and caller abort retain schema-valid settled partial data", async () => {
  await assert.rejects(
    run(async () => {
      throw new Error("credential-secret");
    }),
    (error: unknown) => {
      assert(error instanceof FetchOperationFailure);
      assert(Check(fetchOutputSchema, error.data));
      assert.equal(error.data.outcome, "error");
      assert.equal(error.data.accounting.attempts, 0);
      assert(!JSON.stringify(error).includes("credential-secret"));
      return true;
    },
  );
  const controller = new AbortController();
  await assert.rejects(
    run(async () => {
      controller.abort();
      throw undefined;
    }, controller.signal),
    (error: unknown) => {
      assert(error instanceof FetchOperationFailure);
      assert(Check(fetchOutputSchema, error.data));
      assert.equal(error.data.outcome, "aborted");
      assert.equal(error.data.accounting.parentDelivery, "unknown");
      assert.equal(error.data.counts.cancelled, 1);
      assert(error.data.timing.abortToSettledMs !== undefined);
      return true;
    },
  );
});
it("fetchPage rejects unsupported inputs without inventing operation usage", async () => {
  const context = {} as Context;
  await assert.rejects(fetchPage({ url: "file:///private" }, context), TypeError);
  await assert.rejects(fetchPage({ url: "https://example.com", maxChars: 0 }, context), TypeError);
});
