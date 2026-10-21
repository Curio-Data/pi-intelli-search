// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { test } from "node:test";
import { Check } from "typebox/value";
import { createOperationRuntime } from "../src/core/operation-runtime.js";
import { createStandaloneResult } from "../src/core/standalone-result.js";
import { compactResult } from "../src/core/compact-result.js";
import { standaloneOutputSchemas, compactOutputSchema } from "../src/core/output-schemas.js";
import { executionDefaults } from "../src/core/execution-settings.js";
import { legacySearch as search } from "../src/core/operations/search.js";
import { legacyExtract as extract } from "../src/core/operations/extract.js";
import { coreContext } from "./helpers/core-context.js";
import type { Clock, FullData, Progress, RunStore, FetchClient } from "../src/core/contracts.js";

async function projected(name: "intelli_search" | "intelli_extract", text?: string) {
  let now = 10;
  const clock: Clock = {
    monotonicMs: () => now,
    utcIso: () => "2026-10-20T00:00:00.000Z",
    schedule() {
      throw new Error("Unexpected timer");
    },
    async sleep() {},
  };
  const events: Progress[] = [];
  const p = createStandaloneResult(
    name,
    { query: "Q", url: "label", title: "Title", content: "RAW_SENTINEL" },
    clock,
    (e) => events.push(e),
  );
  const runtime = createOperationRuntime({
    clock,
    generation: 0,
    modelConcurrency: 5,
    criticalReserve: 1,
    fetchConcurrency: 4,
    minRequestIntervalMs: 0,
    createRuns: () =>
      ({
        async settle() {
          now += 7;
        },
      }) as RunStore,
    createFetch: () => ({}) as FetchClient,
  });
  try {
    const result = await runtime.run({ operationId: "standalone" }, async (services) => {
      const { context } = coreContext(process.cwd(), { execution: executionDefaults() });
      const scoped = { ...context, services, signal: services.operation.signal };
      if (text !== undefined)
        scoped.models = {
          preflight: async () => [],
          complete: async () => ({ text, citations: [] }),
        };
      return p.run(scoped, (ctx) =>
        name === "intelli_search"
          ? search({ query: "Q" }, ctx)
          : extract({ query: "Q", url: "label", title: "Title", content: "RAW_SENTINEL" }, ctx),
      );
    });
    const final = p.settled(result);
    assert.equal(runtime.coordinator.snapshot().activeOperations, 0);
    return { final, events };
  } finally {
    p.dispose();
    await runtime.close();
  }
}

test("registered projection shapes preserve legacy fields, supplied-page counts and settled timing (T12/T17/T20)", async () => {
  for (const name of ["intelli_search", "intelli_extract"] as const) {
    const { final, events } = await projected(name);
    assert(Check(standaloneOutputSchemas[name], final.data));
    assert.equal(final.data.text, final.text);
    assert.deepEqual(final.data.details, final.details);
    assert.equal(final.data.outcome, final.outcome);
    assert.equal(final.data.timing.allWorkSettledMs, 7, "includes runtime store cleanup");
    assert.equal(final.data.counts.fetched, 0);
    assert.equal(final.data.counts.effectivePageConcurrency, 2);
    assert(!JSON.stringify(final).includes("RAW_SENTINEL"));
    assert.deepEqual(
      events.map((e) => [e.sequence, e.event, e.state, e.pct]),
      [
        [1, "start", "running", 0],
        [2, "end", "succeeded", 100],
      ],
    );
    assert(events.every((e) => e.operationId === "standalone" && e.totalStages === 1));
    assert.equal(final.data.counts.used, name === "intelli_extract" ? 1 : 0);
    assert(
      final.data.sources.every(
        (s) => s.state === (name === "intelli_search" ? "candidate" : "used"),
      ),
    );
    assert.equal(Check(standaloneOutputSchemas[name], { ...final.data, surprise: true }), false);
    assert.equal(
      Check(standaloneOutputSchemas[name], {
        ...final.data,
        sources: [{ ...final.data.sources[0], content: "raw" }],
      }),
      false,
    );
  }
  const { final } = await projected("intelli_extract", "   ");
  assert.equal(final.outcome, "completed");
  assert.equal(final.data.sources[0].state, "empty");
  assert.equal(final.data.counts.failed, 1);
  assert.equal(final.data.counts.used, 0);
});

test("compact projection preserves complete answer/details with bounded UTF-8 metadata and encoded paths (T18)", async () => {
  const { final } = await projected("intelli_search");
  const large = Number.MAX_SAFE_INTEGER;
  for (const outcome of [
    "completed",
    "no-links",
    "fetch-failed",
    "extraction-failed",
    "error",
    "aborted",
  ] as const) {
    for (const path of ["界".repeat(1364), "\\".repeat(4096), "p".repeat(4094), "p".repeat(4095)]) {
      const data: FullData = {
        ...final.data,
        operationId: "界".repeat(32),
        outcome,
        text: "完整答案".repeat(10000),
        details: { sources: ["Long unchanged details".repeat(10000)] },
        counts: Object.fromEntries(
          Object.keys(final.data.counts).map((key) => [key, large]),
        ) as unknown as FullData["counts"],
        timing: { ...final.data.timing, elapsedMs: large },
        accounting: {
          ...final.data.accounting,
          attempts: large,
          missingAttempts: large,
          reportedCost: { total: Number.MAX_VALUE },
          estimatedCost: { total: Number.MAX_VALUE },
        },
        cache: { status: "committed", reportPath: path, index: "unavailable", runId: "ignored" },
      };
      const compact = compactResult(data);
      assert(Check(compactOutputSchema, compact));
      const legacy = { outcome, text: data.text, details: data.details };
      const overhead =
        Buffer.byteLength(JSON.stringify(compact)) - Buffer.byteLength(JSON.stringify(legacy));
      assert(overhead <= 8192, `overhead ${overhead}`);
      assert.equal(compact.text, data.text);
      assert.deepEqual(compact.details, data.details);
      assert.equal(
        compact.meta.reportPath,
        Buffer.byteLength(JSON.stringify(path)) <= 4096 ? path : undefined,
      );
      assert(!("sources" in compact) && !("attempts" in compact));
      assert(!JSON.stringify(compact).includes("ignored"));
      assert.equal(Check(compactOutputSchema, { ...compact, sources: [] }), false);
      assert.equal(
        Check(compactOutputSchema, { ...compact, meta: { ...compact.meta, invented: true } }),
        false,
      );
    }
  }
});
