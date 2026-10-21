// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Check } from "typebox/value";
import { search, extract, collate, CoreOperationFailure } from "../src/core/index.js";
import { createOperationRuntime } from "../src/core/operation-runtime.js";
import { createRunStore } from "../src/core/run-store.js";
import { createPolicyHooks, runModelWithPolicy } from "../src/core/llm.js";
import { standaloneOutputSchemas, collateOutputSchema } from "../src/core/output-schemas.js";
import { coreContext } from "./helpers/core-context.js";
import type {
  Clock,
  Context,
  CoreResult,
  FetchClient,
  ModelRequest,
  ModelCallScope,
  OperationServices,
  RunStore,
  Progress,
} from "../src/core/contracts.js";

async function fixture(
  t: { after(fn: () => Promise<void>): void },
  options: {
    fail?: boolean;
    cleanupFail?: boolean;
    preflightFail?: boolean;
    held?: (signal: AbortSignal) => Promise<void>;
  } = {},
) {
  await mkdir(resolve(".tmp"), { recursive: true });
  const root = await mkdtemp(join(resolve(".tmp"), "public-core-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const original = coreContext(root).context;
  let now = 0;
  let cleanups = 0;
  const calls: Array<ModelRequest & { scope: ModelCallScope }> = [];
  const events: Progress[] = [];
  const clock: Clock = {
    monotonicMs: () => now,
    utcIso: () => "2026-10-21T00:00:00.000Z",
    schedule() {
      throw new Error("Unexpected timer");
    },
    async sleep() {},
  };
  const runtime = createOperationRuntime({
    clock,
    generation: 0,
    modelConcurrency: 5,
    criticalReserve: 1,
    fetchConcurrency: 1,
    minRequestIntervalMs: 0,
    createFetch: () => ({}) as FetchClient,
    createRuns: () => {
      const store = createRunStore({
        workspaceRoot: root,
        cacheRoot: original.paths.cacheRoot,
        displayRoot: original.paths.cacheDisplayRoot,
        clock,
        randomId: () => "abcdef1234567890",
        onDiagnostic() {},
      });
      return {
        ...store,
        async settle() {
          cleanups++;
          await store.settle();
          now += 5;
          if (options.cleanupFail) throw new Error("cleanup fixture failed");
        },
      };
    },
  });
  const make = (services: OperationServices): Context => ({
    settings: original.settings,
    identity: original.identity,
    paths: original.paths,
    logger: original.logger,
    services,
    models: {
      async preflight(bindings) {
        return options.preflightFail ? [...bindings] : [];
      },
      async complete(request) {
        calls.push(request);
        assert.equal(request.scope.operation, services.operation);
        assert.equal(request.scope.ledger, services.ledger);
        return runModelWithPolicy(
          async (control) => {
            control.observe({
              tokens: {
                inputTotal: 3,
                inputUncached: 3,
                outputTotal: 2,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 5,
              },
              cost: { total: 0.1 },
              source: "provider-response",
              costBasis: "reported",
            });
            await options.held?.(control.signal);
            if (options.fail) throw new Error("provider fixture failed");
            const text =
              request.scope.role === "search"
                ? "Answer [Doc](https://example.org/doc)"
                : request.scope.role === "extract"
                  ? "Source type: official docs. Useful extracted facts."
                  : "Combined useful facts [S2].";
            return { value: { text, citations: [] } };
          },
          { model: request.model, signal: request.signal },
          createPolicyHooks(services, request.scope, original.logger, () => 0),
        );
      },
    },
  });
  t.after(() => runtime.close());
  let sequence = 0;
  const run = (execute: (context: Context) => Promise<CoreResult>, signal?: AbortSignal) =>
    runtime.run(
      { operationId: `public-${++sequence}`, signal, onProgress: (event) => events.push(event) },
      (services) => execute(make(services)),
    );
  return { root, runtime, make, run, calls, events, cleanups: () => cleanups };
}
const input = { url: "supplied-label", title: "Title", content: "RAW_PAGE_SENTINEL", query: "Q" };
const supplied = {
  query: "Q",
  extractions: [
    {
      url: "failed-label",
      title: "Failed",
      extraction: "",
      status: "failed",
      sourceType: "unknown",
    },
    {
      url: "useful-label",
      title: "Useful",
      extraction: "Useful facts",
      status: "success",
      sourceType: "official",
    },
  ],
  fullPages: [{ url: "useful-label", title: "Useful", content: "RAW_PAGE_SENTINEL" }],
};

test("public operations use scoped policy, schemas and writer-inclusive settlement (T15/T17/T20)", async (t) => {
  const f = await fixture(t);
  const results = [
    await f.run((ctx) => search({ query: "Q" }, ctx)),
    await f.run((ctx) => extract(input, ctx)),
    await f.run((ctx) => collate(supplied, ctx)),
  ];
  for (const [i, result] of results.entries()) {
    const schema =
      i === 2
        ? collateOutputSchema
        : standaloneOutputSchemas[i === 0 ? "intelli_search" : "intelli_extract"];
    assert(Check(schema, result.data));
    assert.equal(result.text, result.data.text);
    assert.deepEqual(result.details, result.data.details);
    assert.equal(result.outcome, result.data.outcome);
    assert.equal(result.data.accounting.attempts, 1);
    assert.equal(result.data.accounting.costComplete, true);
    assert.equal(result.usage.totalTokens, 5);
    assert.equal(result.data.timing.allWorkSettledMs, 5);
    assert(!JSON.stringify(result).includes("RAW_PAGE_SENTINEL"));
  }
  assert.equal(f.cleanups(), 3, "core and runtime share writer settlement, not two cleanup calls");
  assert.equal(f.runtime.coordinator.snapshot().activeOperations, 0);
  assert.equal(results[2].data.cache.status, "committed");
  const data = results[2].data;
  if (data.cache.status === "committed") {
    const manifest = JSON.parse(
      await readFile(join(f.root, data.cache.reportPath, "../run.json"), "utf8"),
    );
    assert.deepEqual(manifest.evidenceSourceIds, ["S2"]);
  }
  assert.deepEqual(
    f.calls.map((call) => call.scope.role),
    ["search", "extract", "collate"],
  );
  assert.equal(results[2].data.counts.fetched, 0);
  assert.deepEqual(
    results[2].data.sources.map((source) => source.id),
    ["S1", "S2"],
  );
  assert(f.events.every((event) => event.operationId.startsWith("public-")));
});

test("public operational failures retain partial accounting after cleanup (T17)", async (t) => {
  const f = await fixture(t, { fail: true });
  await assert.rejects(
    f.run((ctx) => extract(input, ctx)),
    (error: unknown) => {
      assert(error instanceof CoreOperationFailure);
      assert.equal(error.data.outcome, "error");
      assert.equal(error.data.sources[0].state, "extract-failed");
      assert.equal(error.data.accounting.attempts, 1);
      assert.equal(error.data.attempts[0].state, "failed");
      assert.equal(error.usage.totalTokens, 5);
      assert.equal(error.data.timing.allWorkSettledMs, 5);
      assert(Check(standaloneOutputSchemas.intelli_extract, error.data));
      return true;
    },
  );
  assert.equal(f.cleanups(), 1);
});

test("public zero-input collate is an inspectable zero-attempt error; configuration remains ordinary", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.run((ctx) => collate({ query: "Q", extractions: [] }, ctx)),
    (error: unknown) => {
      assert(error instanceof CoreOperationFailure);
      assert.equal(error.data.accounting.attempts, 0);
      assert.equal(error.data.counts.used, 0);
      assert.match(error.message, /at least one/);
      return true;
    },
  );
  const missing = await fixture(t, { preflightFail: true });
  await assert.rejects(
    missing.run((ctx) => search({ query: "Q" }, ctx)),
    (error: unknown) => {
      assert(error instanceof Error && !(error instanceof CoreOperationFailure));
      assert.match(error.message, /model unavailable/);
      return true;
    },
  );
  assert.equal(missing.calls.length, 0);
});

test("public cleanup failure preserves useful extracted data", async (t) => {
  const f = await fixture(t, { cleanupFail: true });
  await assert.rejects(
    f.run((ctx) => extract(input, ctx)),
    (error: unknown) => {
      assert(error instanceof CoreOperationFailure);
      assert.equal(error.data.outcome, "error");
      assert.equal(error.data.counts.used, 1);
      assert.match(String(error.data.details.extraction), /Useful/);
      assert.match(error.message, /cleanup fixture failed/);
      return true;
    },
  );
  assert.equal(f.cleanups(), 1);
});

test("public caller cancellation drains policy and marks delivery unknown", async (t) => {
  const controller = new AbortController();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const f = await fixture(t, {
    held: (signal) =>
      new Promise<void>((_resolve, reject) => {
        started();
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("Cancelled", "AbortError")),
          { once: true },
        );
      }),
  });
  const result = f.run((ctx) => extract(input, ctx), controller.signal);
  await ready;
  controller.abort();
  await assert.rejects(result, (error: unknown) => {
    assert(error instanceof CoreOperationFailure);
    assert.equal(error.data.outcome, "aborted");
    assert.equal(error.data.accounting.parentDelivery, "unknown");
    assert.equal(error.data.sources[0].state, "cancelled");
    return true;
  });
  assert.equal(f.runtime.coordinator.snapshot().activeOperations, 0);
  assert.equal(f.cleanups(), 1);
});

test("runtime invalidates a cached writer settlement when a later store wave starts", async (t) => {
  const f = await fixture(t);
  await f.runtime.run({ operationId: "settlement-waves" }, async (services) => {
    await services.runs.settle();
    await services.runs.candidates(undefined, "Q", services.operation.signal);
    await services.runs.settle();
  });
  assert.equal(f.cleanups(), 2, "later store work is not hidden by the earlier settled promise");
  assert.equal(f.runtime.coordinator.snapshot().activeOperations, 0);
});

test("public Context rejects duplicate authorities before inference", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.run((ctx) =>
      search({ query: "Q" }, { ...ctx, signal: ctx.services.operation.signal } as Context),
    ),
    /must not contain signal/,
  );
  assert.equal(f.calls.length, 0);
});
