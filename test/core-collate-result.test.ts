// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Check } from "typebox/value";
import { createCollateResult } from "../src/core/collate-result.js";
import { collateOutputSchema, compactOutputSchema } from "../src/core/output-schemas.js";
import { compactResult } from "../src/core/compact-result.js";
import { createOperationRuntime } from "../src/core/operation-runtime.js";
import { createRunStoreWithHooks, type RunStoreHooks } from "../src/core/run-store.js";
import { createSystemClock } from "../src/core/clock.js";
import { createPolicyHooks, runModelWithPolicy } from "../src/core/llm.js";
import { executionDefaults } from "../src/core/execution-settings.js";
import { AdmissionError } from "../src/core/execution-coordinator.js";
import type {
  CollateParams,
  Diagnostic,
  FetchClient,
  ModelRequest,
  ModelCallScope,
  OperationServices,
  Progress,
  RunStore,
} from "../src/core/contracts.js";
import { coreContext } from "./helpers/core-context.js";
import { suppliedCollation, verifyCollateData } from "./helpers/collate-fixtures.js";

async function fixture(
  options: {
    clock?: import("../src/core/contracts.js").Clock;
    params?: CollateParams;
    hooks?: RunStoreHooks;
    store?: (runs: RunStore) => RunStore;
    beforeRun?: (services: OperationServices) => Promise<void>;
    model?: (request: ModelRequest) => Promise<string>;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "collate-producer-"));
  const clock = options.clock ?? createSystemClock();
  const events: Progress[] = [];
  const diagnostics: Diagnostic[] = [];
  const params = options.params ?? suppliedCollation();
  const p = createCollateResult(
    params,
    clock,
    (event) => events.push(event),
    (d) => diagnostics.push(d),
  );
  const { context } = coreContext(root, { execution: executionDefaults(), disableTelemetry: true });
  const requests: ModelRequest[] = [];
  const runtime = createOperationRuntime({
    clock,
    generation: 0,
    modelConcurrency: 5,
    criticalReserve: 1,
    fetchConcurrency: 4,
    minRequestIntervalMs: 0,
    createFetch: () => ({}) as FetchClient,
    createRuns: () => {
      const runs = createRunStoreWithHooks(
        {
          workspaceRoot: root,
          cacheRoot: context.paths.cacheRoot,
          displayRoot: context.paths.cacheDisplayRoot,
          clock,
          randomId: () => "0123456789abcdef",
          onDiagnostic: (d) => {
            diagnostics.push(d);
            p.diagnostic(d);
          },
        },
        options.hooks ?? {},
      );
      return options.store?.(runs) ?? runs;
    },
  });
  let failure: unknown;
  let result: import("../src/core/contracts.js").OperationResult | undefined;
  const signal = new AbortController();
  const run = async (controller = signal) => {
    try {
      result = await runtime.run(
        { operationId: "collate-producer", signal: controller.signal },
        async (services) => {
          await options.beforeRun?.(services);
          return p.run({
            ...context,
            services,
            signal: services.operation.signal,
            models: {
              preflight: async () => [],
              complete: async (request) => {
                const scope = (request as ModelRequest & { scope: ModelCallScope }).scope;
                assert.equal(scope.operation, services.operation);
                assert.equal(scope.ledger, services.ledger);
                assert.equal(scope.role, "collate");
                requests.push(request);
                return runModelWithPolicy(
                  async (control) => {
                    control.observe({
                      source: "provider-response",
                      costBasis: "reported",
                      tokens: {
                        inputTotal: 9,
                        inputUncached: 6,
                        cacheRead: 2,
                        cacheWrite: 1,
                        outputTotal: 3,
                        totalTokens: 12,
                      },
                      cost: { total: 0.001 },
                    });
                    return {
                      value: {
                        text: await (options.model?.(request) ??
                          Promise.resolve("Facts [S2] and [S4].")),
                        citations: [],
                      },
                    };
                  },
                  { model: request.model, signal: request.signal },
                  createPolicyHooks(services, scope, context.logger, () => 0.5),
                );
              },
            },
          });
        },
      );
    } catch (error) {
      failure = error;
    }
    const data = p.settled(
      result,
      failure
        ? {
            message: failure instanceof Error ? failure.message : String(failure),
            aborted: controller.signal.aborted,
          }
        : undefined,
      controller.signal.aborted ? "unknown" : "available",
    );
    assert(Check(collateOutputSchema, data.data), JSON.stringify(data.data));
    assert(Check(compactOutputSchema, compactResult(data.data)));
    assert.equal(runtime.coordinator.snapshot().activeOperations, 0);
    return { ...data, failure };
  };
  return {
    root,
    p,
    params,
    runtime,
    events,
    diagnostics,
    requests,
    run,
    async cleanup() {
      p.dispose();
      await runtime.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("supplied producer freezes candidate IDs and owns every file before verified publication/accounting (T07/T16/T17/T22)", async () => {
  const f = await fixture({
    model: async (request) => {
      const prompt = JSON.parse(request.userMessage);
      assert.deepEqual(
        prompt.sources.map((s: { id: string }) => s.id),
        ["S2", "S4"],
      );
      assert(
        !request.userMessage.includes("RAW_") && !request.userMessage.includes("SEARCH_SUMMARY"),
      );
      assert(!request.userMessage.includes(".search") && !request.userMessage.includes("password"));
      return "Facts [S2] and [S4].";
    },
  });
  // The registered operation has already captured its input.
  f.params.extractions[1].extraction = "MUTATED";
  try {
    const final = await f.run();
    assert.equal(final.outcome, "completed");
    assert.equal(final.data.text, final.text);
    assert.deepEqual(final.data.details, final.details);
    assert.deepEqual(final.data.counts, {
      candidates: 4,
      fetched: 0,
      extracted: 2,
      used: 2,
      late: 0,
      failed: 2,
      cancelled: 0,
      effectivePageConcurrency: 2,
    });
    assert.deepEqual(
      final.data.sources.map((s) => [s.id, s.state]),
      [
        ["S1", "extract-failed"],
        ["S2", "used"],
        ["S3", "empty"],
        ["S4", "used"],
      ],
    );
    assert(!JSON.stringify(final).includes("RAW_") && !JSON.stringify(final).includes("password"));
    assert(!("extraction" in final.data.sources[1]) && !("content" in final.data.sources[1]));
    const proof = await verifyCollateData(f.root, final.data);
    assert.deepEqual(proof.manifest.evidenceSourceIds, ["S2", "S4"]);
    assert.deepEqual(proof.manifest.provenance.models, {
      collate: { provider: "fixture", model: "collate" },
    });
    assert.equal(proof.manifest.suppliedPages.length, 2);
    assert.equal(proof.manifest.sources[3].fullPagePath, "sources/P1.md");
    assert.equal(proof.manifest.sources[1].fullPagePath, "sources/P3.md");
    assert.equal(await readFile(join(proof.runDir, "extractions/S2.md"), "utf8"), "First fact.");
    assert.equal(await readFile(join(proof.runDir, "sources/P4.md"), "utf8"), "RAW_DUPLICATE_PAGE");
    assert(!JSON.stringify(proof.manifest).includes("RAW_"));
    assert.deepEqual(
      f.events.map((e) => [e.sequence, e.stage, e.event, e.pct]),
      [
        [1, "collate", "start", 0],
        [2, "collate", "end", 50],
        [3, "cache", "start", 50],
        [4, "cache", "end", 100],
      ],
    );
    assert(f.events.every((e) => e.operationId === final.data.operationId));
    assert(final.data.timing.summaryReadyMs! <= final.data.timing.allWorkSettledMs);
    assert.equal(Check(collateOutputSchema, { ...final.data, invented: true }), false);
    assert.equal(
      Check(collateOutputSchema, {
        ...final.data,
        sources: [{ ...final.data.sources[0], content: "raw" }],
      }),
      false,
    );
  } finally {
    await f.cleanup();
  }
});

test("zero usable and duplicate redacted evidence reject before allocation/inference with full zero-attempt data (T17)", async () => {
  for (const extractions of [
    [],
    suppliedCollation().extractions.filter((e) => e.status !== "success"),
    [
      suppliedCollation().extractions[1],
      { ...suppliedCollation().extractions[1], url: "notes/local" },
    ],
    [
      suppliedCollation().extractions[3],
      { ...suppliedCollation().extractions[3], url: "https://other:secret@docs.example/page" },
    ],
  ]) {
    const f = await fixture({ params: { query: "Invalid", extractions } });
    try {
      const final = await f.run();
      assert.equal(final.outcome, "error");
      assert.equal(final.data.accounting.attempts, 0);
      assert.equal(final.data.cache.status, "not-requested");
      assert.equal(f.requests.length, 0);
      assert.deepEqual(await readdir(f.root), []);
      assert.equal(f.events.at(-1)?.state, "failed");
      assert.equal(f.events.at(-1)?.pct, 0);
    } finally {
      await f.cleanup();
    }
  }
});

test("failed citation IDs, sparse ranges and promised cache files reject before publication (T07/T17)", async () => {
  for (const output of [
    "Unsupported claim [S1].",
    "Unsupported range [S2-S4].",
    "Facts [S2]. See `extractions/S2.md`.",
  ]) {
    const f = await fixture({ model: async () => output });
    try {
      const final = await f.run();
      assert.equal(final.outcome, "error");
      assert.match(final.text, /unknown source ID|cache-file reference/);
      assert.equal(final.data.accounting.attempts, 1);
      assert.equal(final.data.cache.status, "not-requested");
      const dirs = await readdir(join(f.root, ".search/.intelli-v1/runs"));
      await assert.rejects(
        readFile(join(f.root, ".search/.intelli-v1/runs", dirs[0], "committed.json")),
        /ENOENT/,
      );
    } finally {
      await f.cleanup();
    }
  }
});

test("persistence faults retain useful completed collation and explicit publication/index/accounting diagnostics (T17/T22/T24)", async () => {
  for (const point of [
    "init-after-identity",
    "before-marker-rename",
    "after-marker-rename",
    "before-index-rename",
    "before-accounting-marker-rename",
    "after-accounting-marker-rename",
  ] as const) {
    const f = await fixture({
      hooks: {
        fault: (at) => {
          if (at === point) throw new Error(`injected ${point}`);
        },
      },
    });
    try {
      const final = await f.run();
      assert.equal(final.outcome, "completed", point);
      assert.match(final.text, /Facts \[S2\]/);
      if (point === "init-after-identity" || point === "before-marker-rename") {
        assert.equal(final.data.cache.status, "unavailable");
        assert(final.data.sources.every((s) => !s.extractionPath && !s.fullPagePath));
        assert(!("cachePath" in final.details));
      } else {
        const proof = await verifyCollateData(f.root, final.data);
        assert.equal(final.data.cache.status, "committed");
        if (final.data.cache.status !== "committed") throw new Error("Not committed");
        assert(final.data.cache.diagnostic);
        if (point === "before-index-rename") assert.equal(final.data.cache.index, "unavailable");
        if (point === "before-accounting-marker-rename") assert.equal(proof.accounting, undefined);
        if (point === "after-marker-rename")
          assert.equal(final.data.cache.diagnostic.code, "MARKER_DURABILITY_UNPROVEN");
        if (point === "after-accounting-marker-rename")
          assert.equal(final.data.cache.diagnostic.code, "ACCOUNTING_DURABILITY_UNPROVEN");
      }
    } finally {
      await f.cleanup();
    }
  }
});

test("invalid producer artefacts/accounting are useful persistence diagnostics, not lost answers (T17/T24)", async () => {
  for (const invalid of ["artifacts", "accounting"] as const) {
    const f = await fixture({
      store: (runs) => ({
        ...runs,
        ...(invalid === "artifacts"
          ? {
              commit: (reservation, artifacts, signal) =>
                runs.commit(
                  reservation,
                  artifacts.map((a) =>
                    a.kind === "manifest-data" ? { ...a, bytes: Buffer.from("{}") } : a,
                  ),
                  signal,
                ),
            }
          : {
              recordAccounting: (run, records, summary, signal) =>
                runs.recordAccounting(run, records, { ...summary, attempts: 999 }, signal),
            }),
      }),
    });
    try {
      const final = await f.run();
      assert.equal(final.outcome, "completed");
      assert.equal(final.data.accounting.attempts, 1);
      const cache = final.data.cache;
      assert(cache.status !== "not-requested");
      assert.equal(
        cache.diagnostic?.code,
        invalid === "artifacts" ? "INVALID_ARTIFACTS" : "INVALID_ACCOUNTING",
      );
      if (invalid === "accounting") await verifyCollateData(f.root, final.data);
    } finally {
      await f.cleanup();
    }
  }
});

test("abort before/after publication preserves only linearised paths and starts no accounting write (T05/T22)", async () => {
  for (const point of ["before-marker-rename", "after-marker-rename"] as const) {
    const controller = new AbortController();
    let accounting = 0;
    const f = await fixture({
      hooks: {
        fault: (at) => {
          if (at === point) controller.abort("stop");
        },
      },
      store: (runs) => ({
        ...runs,
        recordAccounting: (...args) => {
          accounting++;
          return runs.recordAccounting(...args);
        },
      }),
    });
    try {
      const final = await f.run(controller);
      assert.equal(final.outcome, "aborted");
      assert.equal(final.data.accounting.parentDelivery, "unknown");
      assert.equal(final.data.accounting.attempts, 1);
      assert.equal(accounting, 0);
      assert(final.data.timing.abortToSettledMs !== undefined);
      assert.equal(f.events.at(-1)?.pct, 50);
      if (point === "before-marker-rename") {
        assert.equal(final.data.cache.status, "unavailable");
        assert(final.data.sources.every((s) => !s.extractionPath));
      } else await verifyCollateData(f.root, final.data);
    } finally {
      await f.cleanup();
    }
  }
});

test("collate timing includes runtime store settlement on the authoritative clock (T04/T17/T20)", async () => {
  let now = 100;
  const f = await fixture({
    clock: { ...createSystemClock(), monotonicMs: () => now },
    store: (runs) => ({
      ...runs,
      async settle() {
        await runs.settle();
        now += 7;
      },
    }),
  });
  try {
    const final = await f.run();
    assert.equal(final.data.timing.summaryReadyMs, 0);
    assert.equal(final.data.timing.allWorkSettledMs, 7);
    assert.equal(final.data.timing.elapsedMs, 7);
    assert.equal(f.events.at(-1)?.elapsedMs, 7);
  } finally {
    await f.cleanup();
  }
});

test("cleanup failure retains computed summary, verified publication and final accounting (T04/T17)", async () => {
  const f = await fixture({
    store: (runs) => ({
      ...runs,
      async settle() {
        await runs.settle();
        throw new Error("cleanup failed");
      },
    }),
  });
  try {
    const final = await f.run();
    assert.equal(final.outcome, "error");
    assert.match(final.text, /cleanup failed/);
    assert.match(final.data.summary, /Facts/);
    await verifyCollateData(f.root, final.data);
    assert.equal(final.data.accounting.attempts, 1);
    assert.equal(f.events.at(-1)?.pct, 50);
  } finally {
    await f.cleanup();
  }
});

test("real critical queue rejection creates no collate transport attempt (T11/T17)", async () => {
  let release!: () => void;
  let flood: Promise<unknown>[] = [];
  const f = await fixture({
    beforeRun: async (services) => {
      const operation = services.coordinator.begin("flood");
      const held = Array.from({ length: 5 }, () =>
        services.coordinator.acquireModel({
          operationId: operation.id,
          kind: "critical",
          signal: operation.signal,
        }),
      );
      const permits = await Promise.all(held);
      flood = Array.from({ length: 512 }, () =>
        services.coordinator
          .acquireModel({ operationId: operation.id, kind: "critical", signal: operation.signal })
          .catch((e: unknown) => e),
      );
      release = () => {
        operation.abort();
        permits.forEach((p) => p.release());
      };
      // Release this other lease only once the collate ticket has actually failed.
      const closeAfterFailure = services.operation.signal;
      closeAfterFailure.addEventListener("abort", () => release(), { once: true });
      operation.track(
        new Promise<void>((resolve) => {
          closeAfterFailure.addEventListener("abort", () => resolve(), { once: true });
        }),
      );
      void operation.settle();
    },
  });
  try {
    const final = await f.run();
    assert(final.failure instanceof AdmissionError);
    assert.equal(final.failure.code, "BUSY");
    assert.equal(final.data.accounting.attempts, 0);
    assert.equal(f.requests.length, 1, "policy invoked, but transport never admitted");
    assert.deepEqual(final.data.attempts, []);
    await Promise.all(flood);
  } finally {
    release?.();
    await f.cleanup();
  }
});
