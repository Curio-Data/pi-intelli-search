// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Check } from "typebox/value";
import {
  research,
  operationOutputSchemas,
  compactOutputSchema,
  CoreOperationFailure,
} from "../src/core/index.js";
import { observeOperationDiagnostic } from "../src/core/operation-diagnostics.js";
import { compactResult } from "../src/core/compact-result.js";
import { createOperationRuntime } from "../src/core/operation-runtime.js";
import { createFetchClient } from "../src/core/fetch-client.js";
import { createRunStore } from "../src/core/run-store.js";
import { createSystemClock } from "../src/core/clock.js";
import { parseExecutionSettings } from "../src/core/execution-settings.js";
import { createPolicyHooks, runModelWithPolicy } from "../src/core/llm.js";
import { coreContext } from "./helpers/core-context.js";
import { markdownPage } from "./helpers/page-fixtures.js";
import type {
  Clock,
  Context,
  CoreResult,
  ModelCallScope,
  ModelRequest,
  OperationServices,
  PageTransport,
  Progress,
  ResearchExecutionSettings,
  RunStore,
} from "../src/core/contracts.js";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
class ManualClock implements Clock {
  now = 0;
  timers = new Set<{ at: number; callback: () => void }>();
  monotonicMs = () => this.now;
  utcIso = () => new Date(Date.UTC(2026, 9, 22) + this.now).toISOString();
  schedule(delay: number, callback: () => void) {
    const timer = { at: this.now + delay, callback };
    this.timers.add(timer);
    return () => {
      this.timers.delete(timer);
    };
  }
  async sleep() {}
  set(now: number, deliver = true) {
    this.now = now;
    if (deliver)
      for (const timer of [...this.timers].sort((a, b) => a.at - b.at)) {
        if (this.timers.has(timer) && timer.at <= now) {
          this.timers.delete(timer);
          timer.callback();
        }
      }
  }
}
type ScopedRequest = ModelRequest & { scope: ModelCallScope };
async function fixture(
  t: { after(fn: () => Promise<void>): void },
  options: {
    execution?: Partial<ResearchExecutionSettings>;
    urls?: string[];
    transport?: PageTransport;
    clock?: Clock;
    search?: (request: ScopedRequest, signal: AbortSignal) => Promise<string>;
    extract?: (request: ScopedRequest, signal: AbortSignal) => Promise<string>;
    collate?: (request: ScopedRequest, signal: AbortSignal) => Promise<string>;
    store?: (store: RunStore) => RunStore;
    settings?: Parameters<typeof coreContext>[1];
  } = {},
) {
  await mkdir(resolve(".tmp"), { recursive: true });
  const root = await mkdtemp(join(resolve(".tmp"), "research-result-"));
  const clock = options.clock ?? createSystemClock();
  const legacy = coreContext(root, {
    disableTelemetry: true,
    fetchTimeoutMs: 10_000,
    llmTimeoutMs: 10_000,
    ...options.settings,
  }).context;
  const execution = parseExecutionSettings(options.execution);
  const settings = { ...legacy.settings, execution };
  const requests: ScopedRequest[] = [];
  const events: Progress[] = [];
  const storeEvents: string[] = [];
  let nonce = 0;
  const runtime = createOperationRuntime({
    clock,
    generation: 1,
    modelConcurrency: execution.modelConcurrency,
    criticalReserve: 1,
    fetchConcurrency: execution.aggregateFetchConcurrency,
    minRequestIntervalMs: 0,
    createFetch: (operation) =>
      createFetchClient({
        operation,
        clock,
        transport: options.transport ?? markdownPage("# Docs\n\nRAW_PAGE_SENTINEL"),
        browser: "chrome_145",
        timeoutMs: 10_000,
        concurrency: settings.fetchConcurrency,
        maxChars: execution.fetchMaxChars,
        maxResponseBytes: execution.fetchMaxResponseBytes,
        docsMaxResponseBytes: execution.docsMaxResponseBytes,
      }),
    createRuns: () => {
      const store = createRunStore({
        workspaceRoot: root,
        cacheRoot: legacy.paths.cacheRoot,
        displayRoot: legacy.paths.cacheDisplayRoot,
        clock,
        randomId: () => `${++nonce}`.padStart(32, "0"),
        onDiagnostic() {},
      });
      const observed: RunStore = {
        ...store,
        commit(...args) {
          storeEvents.push("commit");
          return store.commit(...args);
        },
        recordAccounting(...args) {
          storeEvents.push("accounting");
          return store.recordAccounting(...args);
        },
        candidates(...args) {
          storeEvents.push("suggestions");
          return store.candidates(...args);
        },
        settle() {
          storeEvents.push("settle");
          return store.settle();
        },
      };
      return options.store?.(observed) ?? observed;
    },
  });
  t.after(async () => {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  });
  const make = (services: OperationServices): Context => ({
    settings,
    paths: legacy.paths,
    identity: legacy.identity,
    logger: legacy.logger,
    services,
    models: {
      async preflight() {
        return [];
      },
      async complete(request) {
        requests.push(request);
        return runModelWithPolicy(
          async (control) => {
            control.observe({
              tokens: {
                inputTotal: 10,
                inputUncached: 10,
                outputTotal: 2,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 12,
              },
              cost: { total: 0.01 },
              source: "provider-response",
              costBasis: "reported",
            });
            let text: string;
            if (request.scope.role === "search")
              text = await (options.search?.(request, control.signal) ??
                Promise.resolve(
                  (options.urls ?? ["https://example.org/one", "https://example.org/two"])
                    .map((url, i) => `[Page ${i}](${url})`)
                    .join(" "),
                ));
            else if (request.scope.role === "extract")
              text = await (options.extract?.(request, control.signal) ??
                Promise.resolve("Official docs, current.\nExtracted facts"));
            else if (request.scope.role === "collate")
              text = await (options.collate?.(request, control.signal) ??
                Promise.resolve(`Answer [${JSON.parse(request.userMessage).sources[0].id}]`));
            else text = "[]";
            return { value: { text, citations: [] } };
          },
          {
            model: request.model,
            signal: request.signal,
            retry: request.retry,
            timeoutMs: request.timeoutMs,
          },
          createPolicyHooks(services, request.scope, legacy.logger, () => 0),
        );
      },
    },
  });
  let number = 0;
  const run = (signal?: AbortSignal) =>
    runtime.run(
      { operationId: `research-${++number}`, signal, onProgress: (event) => events.push(event) },
      (services) =>
        research(
          { query: "Q", maxUrls: 100, domains: ["example.org"], focusPrompt: "Facts" },
          make(services),
        ),
    );
  return { root, runtime, run, requests, events, storeEvents, clock, settings };
}

test("research compact projection preserves frozen legacy payloads and worst-case Unicode/error/degraded envelopes (T18)", async (t) => {
  const f = await fixture(t);
  const base = (await f.run()).data;
  for (const scenario of ["research", "no-links", "fetch-failed", "extraction-failed"] as const) {
    const frozen = JSON.parse(
      await readFile(resolve(`test/fixtures/native-contract/${scenario}.json`), "utf8"),
    ).result;
    const legacy: Pick<CoreResult, "outcome" | "text" | "details"> = {
      outcome: scenario === "research" ? "completed" : scenario,
      text: frozen.content.map((part: { text: string }) => part.text).join("\n"),
      details: frozen.details,
    };
    const compact = compactResult({ ...base, ...legacy });
    assert(Check(compactOutputSchema, compact));
    assert.equal(compact.text, legacy.text);
    assert.deepEqual(compact.details, legacy.details);
    assert(
      Buffer.byteLength(JSON.stringify(compact)) - Buffer.byteLength(JSON.stringify(legacy)) <=
        8192,
    );
  }
  for (const outcome of [
    "completed",
    "no-links",
    "fetch-failed",
    "extraction-failed",
    "error",
    "aborted",
  ] as const) {
    for (const path of ["界".repeat(1364), "\\".repeat(4096), "p".repeat(4094), "p".repeat(4095)]) {
      const legacy = {
        outcome,
        text: "完整答案 é".repeat(10_000),
        details: { cachePath: path, urlsSearched: 100, pagesFetched: 100, pagesFailed: 100 },
      };
      const data = {
        ...base,
        ...legacy,
        operationId: "界".repeat(42),
        counts: Object.fromEntries(
          Object.keys(base.counts).map((key) => [key, Number.MAX_SAFE_INTEGER]),
        ) as unknown as typeof base.counts,
        timing: { ...base.timing, elapsedMs: Number.MAX_VALUE },
        accounting: {
          ...base.accounting,
          attempts: Number.MAX_SAFE_INTEGER,
          missingAttempts: Number.MAX_SAFE_INTEGER,
          reportedCost: { total: Number.MAX_VALUE },
          estimatedCost: { total: Number.MAX_VALUE },
        },
        cache: {
          status: "committed" as const,
          reportPath: path,
          index: "unavailable" as const,
          runId: "not-exposed",
        },
      };
      const compact = compactResult(data);
      assert(Check(compactOutputSchema, compact));
      assert.equal(compact.text, legacy.text);
      assert.deepEqual(compact.details, legacy.details);
      assert(
        Buffer.byteLength(JSON.stringify(compact)) - Buffer.byteLength(JSON.stringify(legacy)) <=
          8192,
      );
      assert.equal(
        compact.meta.reportPath,
        Buffer.byteLength(JSON.stringify(path)) <= 4096 ? path : undefined,
      );
      assert(!("sources" in compact) && !("attempts" in compact));
    }
  }
  // Actual operational failures, not just constructed projection envelopes.
  const failed = await fixture(t, {
    search: async () => {
      throw new Error("Permanent failure");
    },
  });
  const error = await failed.run().then(
    () => undefined,
    (error: unknown) => error,
  );
  assert(error instanceof CoreOperationFailure);
  const compact = compactResult(error.data);
  assert.equal(compact.outcome, "error");
  assert.equal(compact.text, error.data.text);
  assert.deepEqual(compact.details, error.data.details);
  assert(Check(compactOutputSchema, compact));
});

for (const pageExecution of ["streaming", "barrier"] as const) {
  test(`${pageExecution}: public research publishes verified frozen evidence and all-five schemas (T07/T17/T19/T22)`, async (t) => {
    const f = await fixture(t, {
      execution: { pageExecution },
      urls: [
        "https://user:password@example.org/private",
        "https://example.org/one",
        "https://example.org/two",
        "https://example.org/one",
      ],
    });
    const result = await f.run();
    assert(Check(operationOutputSchemas.intelli_research, result.data));
    assert(!Check(operationOutputSchemas.intelli_research, { ...result.data, unexpected: true }));
    assert(
      !Check(operationOutputSchemas.intelli_research, {
        ...result.data,
        sources: [{ ...result.data.sources[0], content: "RAW_PAGE_SENTINEL" }],
      }),
    );
    assert.deepEqual(Object.keys(operationOutputSchemas).sort(), [
      "intelli_collate",
      "intelli_extract",
      "intelli_fetch",
      "intelli_research",
      "intelli_search",
    ]);
    assert.equal(result.outcome, "completed");
    assert.deepEqual(Object.keys(result.details).sort(), [
      "cachePath",
      "pagesFailed",
      "pagesFetched",
      "urlsSearched",
    ]);
    const compact = compactResult(result.data);
    assert(Check(compactOutputSchema, compact));
    assert.equal(compact.text, result.text);
    const legacy = {
      outcome: result.outcome,
      text: result.text,
      details: {
        cachePath: result.details.cachePath,
        urlsSearched: result.details.urlsSearched,
        pagesFetched: result.details.pagesFetched,
        pagesFailed: result.details.pagesFailed,
      },
    };
    assert(
      Buffer.byteLength(JSON.stringify(compact)) - Buffer.byteLength(JSON.stringify(legacy)) <=
        8_192,
    );
    assert.deepEqual(
      result.data.sources.map((source) => [source.id, source.state]),
      [
        ["S1", "used"],
        ["S2", "used"],
      ],
    );
    assert.equal(result.data.counts.fetched, 2);
    assert.equal(result.data.counts.used, 2);
    assert.equal(result.data.counts.effectivePageConcurrency, 2);
    assert(!JSON.stringify(result.data).includes("RAW_PAGE_SENTINEL"));
    assert(!JSON.stringify(result.data).includes("password"));
    assert.equal(result.data.cache.status, "committed");
    if (result.data.cache.status !== "committed") return;
    const path = join(f.root, result.details.cachePath as string);
    const manifest = JSON.parse(await readFile(join(path, "run.json"), "utf8"));
    assert.deepEqual(manifest.evidenceSourceIds, ["S1", "S2"]);
    assert.deepEqual(manifest.provenance.domains, ["example.org"]);
    assert.equal(manifest.provenance.focusPrompt, "Facts");
    assert.equal(
      await readFile(join(path, "sources/P1.md"), "utf8"),
      "# Docs\n\nRAW_PAGE_SENTINEL",
    );
    const accounting = JSON.parse(await readFile(join(path, "accounting.json"), "utf8"));
    assert.deepEqual(accounting.attempts, result.data.attempts);
    assert.equal(accounting.summary.attempts, result.data.accounting.attempts);
    assert(f.storeEvents.indexOf("commit") < f.storeEvents.indexOf("suggestions"));
    assert(f.storeEvents.indexOf("suggestions") < f.storeEvents.indexOf("accounting"));
    assert.deepEqual(await readdir(join(f.root, ".search/.staging")), []);
    const collation = f.requests.find((request) => request.scope.role === "collate")!;
    assert(!collation.userMessage.includes(".search"));
    assert(!collation.userMessage.includes("RAW_PAGE_SENTINEL"));
    assert.deepEqual(
      JSON.parse(collation.userMessage).sources.map((source: { id: string }) => source.id),
      manifest.evidenceSourceIds,
    );
    assert.equal(result.data.accounting.attempts, 4);
    assert.equal(result.data.accounting.reportedCost.total, 0.04);
    assert.equal(result.usage.totalTokens, 48);
    assert(f.events.some((event) => event.workStage === "extract"));
    assert(f.events.every((event, i) => !i || event.pct >= f.events[i - 1].pct));
    assert.equal(f.events.at(-1)?.pct, 100);
    assert.equal(f.runtime.coordinator.snapshot().activeOperations, 0);
  });
}

for (const kind of ["no-links", "fetch-failed", "extraction-failed", "empty"] as const) {
  test(`${kind}: common finalisation preserves settled accounting without publishing a report`, async (t) => {
    const f = await fixture(t, {
      urls: kind === "no-links" ? [] : undefined,
      transport:
        kind === "fetch-failed"
          ? async (url) => ({ url, status: 503, headers: new Headers(), body: null })
          : undefined,
      extract:
        kind === "extraction-failed"
          ? async () => {
              throw new Error("permanent fixture failure");
            }
          : kind === "empty"
            ? async () => " \n"
            : undefined,
    });
    const result = await f.run();
    assert(Check(operationOutputSchemas.intelli_research, result.data));
    assert.equal(result.outcome, kind === "empty" ? "extraction-failed" : kind);
    assert.equal(result.data.counts.used, 0);
    assert.equal(result.data.cache.status, "not-requested");
    assert.equal(result.details.cachePath, "");
    assert(!f.storeEvents.includes("commit"));
    assert(!f.requests.some((request) => request.scope.role === "collate"));
    assert(f.storeEvents.includes("settle"));
    assert.equal(f.runtime.coordinator.snapshot().activeOperations, 0);
    assert.equal(f.events.at(-1)?.pct, 100);
  });
}

test("sparse candidate IDs and empty evidence are identical in prompt, manifest and returned inventory", async (t) => {
  const f = await fixture(t, {
    extract: async (request) => (request.scope.pageId === "S1" ? " " : "Official docs\nFacts"),
  });
  const result = await f.run();
  assert.equal(result.data.sources[0].state, "empty");
  assert.equal(result.data.sources[1].state, "used");
  const request = f.requests.find((request) => request.scope.role === "collate")!;
  assert.deepEqual(
    JSON.parse(request.userMessage).sources.map((source: { id: string }) => source.id),
    ["S2"],
  );
  assert.match(result.text, /Answer \[S2\]/);
});

for (const failure of ["allocate", "commit", "index", "accounting"] as const) {
  test(`${failure} failure preserves useful summary and advertises only committed paths (T24)`, async (t) => {
    const f = await fixture(t, {
      store: (store) => ({
        ...store,
        ...(failure === "allocate"
          ? {
              allocate: async () => ({
                status: "unavailable" as const,
                diagnostic: { code: "JOURNAL_INVALID", message: "Preserve allocation history" },
              }),
            }
          : {}),
        ...(failure === "commit"
          ? {
              commit: async () => ({
                status: "unavailable" as const,
                diagnostic: { code: "INVALID_ARTIFACTS", message: "Report unavailable" },
              }),
            }
          : {}),
        ...(failure === "index" ? { updateIndex: async () => "unavailable" as const } : {}),
        ...(failure === "accounting"
          ? {
              recordAccounting: async () => ({
                status: "unavailable" as const,
                diagnostic: { code: "INVALID_ACCOUNTING", message: "Accounting unavailable" },
              }),
            }
          : {}),
      }),
    });
    const result = await f.run();
    assert.equal(result.outcome, "completed");
    assert.match(result.text, /Answer/);
    assert(Check(operationOutputSchemas.intelli_research, result.data));
    if (failure === "allocate" || failure === "commit") {
      assert.equal(result.data.cache.status, "unavailable");
      assert(!result.data.sources.some((source) => source.fullPagePath || source.extractionPath));
      assert.equal(result.details.cachePath, "");
    } else {
      assert.equal(result.data.cache.status, "committed");
      if (result.data.cache.status === "committed") {
        if (failure === "index") assert.equal(result.data.cache.index, "unavailable");
        else assert.equal(result.data.cache.accountingPath, undefined);
      }
    }
    assert.equal(result.data.accounting.attempts, 4);
  });
}

test("ceiling cutoff preserves started extraction as late, cancels queued pages and drains before publication (T08/T09)", async (t) => {
  const clock = new ManualClock();
  const secondStarted = deferred();
  const firstDone = deferred();
  const late = deferred<string>();
  let lateSignal: AbortSignal | undefined;
  const collationStarted = deferred();
  const finishCollation = deferred();
  const f = await fixture(t, {
    settings: { disableTelemetry: false },
    clock,
    execution: {
      deadline: { enabled: true, quorum: 1, factor: 1, floorMs: 0, ceilingMs: 100, minSources: 1 },
    },
    extract: async (request, signal) => {
      if (request.scope.pageId === "S1") {
        await firstDone.promise;
        return "Official docs\nFirst facts";
      }
      lateSignal = signal;
      secondStarted.resolve();
      return late.promise;
    },
    collate: async () => {
      collationStarted.resolve();
      await finishCollation.promise;
      return "Answer [S1]";
    },
  });
  const pending = f.run();
  await secondStarted.promise;
  clock.set(10);
  firstDone.resolve();
  // A terminal progress witness, not an arbitrary number of microtasks.
  const firstSettled = deferred();
  const emit = f.events.push.bind(f.events);
  f.events.push = (...events) => {
    const n = emit(...events);
    if (events.some((event) => event.pageId === "S1" && event.message.includes("settled")))
      firstSettled.resolve();
    return n;
  };
  await firstSettled.promise;
  clock.set(100);
  await collationStarted.promise;
  assert.equal(lateSignal?.aborted, false, "cutoff cannot abort active extraction");
  late.resolve("Official docs\nLate facts");
  const lateSettled = deferred();
  const emit2 = f.events.push.bind(f.events);
  f.events.push = (...events) => {
    const n = emit2(...events);
    if (events.some((event) => event.pageId === "S2" && event.message.includes("settled")))
      lateSettled.resolve();
    return n;
  };
  await lateSettled.promise;
  finishCollation.resolve();
  const result = await pending;
  assert.equal(result.data.deadline.reason, "ceiling");
  assert.equal(result.data.deadline.minimumMet, true);
  assert.equal(result.data.timing.cutoffMs, 100);
  assert.equal(result.data.counts.used, 1);
  assert.equal(result.data.counts.late, 1);
  assert.equal(result.data.counts.extracted, 2);
  assert.equal(result.data.sources[1].state, "late");
  assert.equal(result.data.sources[1].fullPagePath, undefined);
  const path = join(f.root, result.details.cachePath as string);
  const manifest = JSON.parse(await readFile(join(path, "run.json"), "utf8"));
  const meta = JSON.parse(await readFile(join(path, "meta.json"), "utf8"));
  assert.equal(meta.pageDeadline.timebase, "runtime-monotonic-ms");
  assert.equal(meta.pageDeadline.ceilingAtMs, 100);
  assert.equal(meta.pageDeadline.frozenAtMs, 100);
  assert.deepEqual(Object.keys(result.details).sort(), [
    "cachePath",
    "pagesFailed",
    "pagesFetched",
    "urlsSearched",
  ]);
  assert.deepEqual(Object.keys(meta.stages.fetch.winners), ["markdown"]);
  assert.deepEqual(manifest.evidenceSourceIds, ["S1"]);
  assert.equal(manifest.sources[1].extractionPath, "late/S2.md");
  assert.equal(clock.timers.size, 0);
  assert(f.events.every((event, index) => !index || event.pct >= f.events[index - 1].pct));
});

test("abort during a long success-path drain does not wait out the optional budget", async (t) => {
  const clock = new ManualClock();
  const extractionStarted = deferred();
  const cancelled = deferred();
  const f = await fixture(t, {
    clock,
    execution: {
      lateDrainMs: 30_000,
      deadline: { enabled: true, quorum: 1, factor: 1, floorMs: 0, ceilingMs: 100, minSources: 1 },
    },
    extract: async (_request, signal) => {
      extractionStarted.resolve();
      await new Promise<void>((resolve) =>
        signal.addEventListener(
          "abort",
          () => {
            cancelled.resolve();
            resolve();
          },
          { once: true },
        ),
      );
      signal.throwIfAborted();
      return "unreachable";
    },
  });
  const controller = new AbortController();
  const pending = f.run(controller.signal).catch((error) => error);
  await extractionStarted.promise;
  clock.set(100);
  // Wait until the drain timer is owned before cancelling, without advancing time.
  const scheduled = deferred();
  const schedule = clock.schedule.bind(clock);
  clock.schedule = (ms, callback) => {
    const cancel = schedule(ms, callback);
    if (ms === 30_000) scheduled.resolve();
    return cancel;
  };
  await scheduled.promise;
  controller.abort();
  await cancelled.promise;
  const error = await pending;
  assert(error instanceof CoreOperationFailure);
  assert.equal(error.data.outcome, "aborted");
  assert.equal(error.data.accounting.parentDelivery, "unknown");
  assert.equal(clock.now, 100);
  assert.equal(clock.timers.size, 0);
  assert.equal(f.runtime.coordinator.snapshot().activeOperations, 0);
});

for (const pageExecution of ["streaming", "barrier"] as const) {
  test(`${pageExecution}: spool admission and bounded extraction preserve the full-fetch control (T19)`, async (t) => {
    const entered = deferred();
    const release = deferred();
    const fetched = new Set<string>();
    let active = 0;
    let peak = 0;
    let first = true;
    const f = await fixture(t, {
      execution: { pageExecution },
      settings: { maxUrls: 10, fetchConcurrency: 2, extractionConcurrency: 1 },
      urls: Array.from({ length: 5 }, (_, i) => `https://example.org/${i}`),
      transport: async (url, request) => {
        fetched.add(url);
        return markdownPage()(url, request);
      },
      extract: async () => {
        active++;
        peak = Math.max(peak, active);
        if (first) {
          first = false;
          entered.resolve();
          await release.promise;
        }
        active--;
        return "Official docs\nFacts";
      },
    });
    const pending = f.run();
    await entered.promise;
    try {
      const directories = await readdir(join(f.root, ".search/.staging"));
      assert.equal(directories.length, 1);
      const spools = await readdir(join(f.root, ".search/.staging", directories[0]));
      if (pageExecution === "barrier") {
        assert.equal(fetched.size, 5, "all logical fetches finish before first extraction");
        assert.equal(spools.length, 5, "disk population is N, separately from retained-body slots");
      } else {
        assert(fetched.size <= 2, "streaming cannot admit beyond the retained-page limit");
        assert(spools.length <= 2);
      }
      assert.equal(peak, 1);
    } finally {
      release.resolve();
    }
    const result = await pending;
    assert.equal(result.data.counts.candidates, 5);
    assert.equal(result.data.counts.used, 5);
    assert.equal(peak, 1);
  });
}

test("a page retry after cutoff is rejected while critical collation remains eligible (T09/T11)", async (t) => {
  const clock = new ManualClock();
  const secondStarted = deferred();
  const firstRelease = deferred();
  const secondRelease = deferred();
  const firstSettled = deferred();
  let attempts = 0;
  const f = await fixture(t, {
    clock,
    settings: { llmRetryAttempts: 2 },
    execution: {
      deadline: { enabled: true, quorum: 1, factor: 1, floorMs: 0, ceilingMs: 100, minSources: 1 },
    },
    extract: async (request) => {
      if (request.scope.pageId === "S1") {
        await firstRelease.promise;
        return "Official docs\nFacts";
      }
      attempts++;
      secondStarted.resolve();
      await secondRelease.promise;
      throw new Error("503 retryable fixture");
    },
    collate: async () => {
      secondRelease.resolve();
      return "Answer [S1]";
    },
  });
  const push = f.events.push.bind(f.events);
  f.events.push = (...events) => {
    const n = push(...events);
    if (events.some((event) => event.pageId === "S1" && event.message.includes("settled")))
      firstSettled.resolve();
    return n;
  };
  const pending = f.run();
  await secondStarted.promise;
  firstRelease.resolve();
  await firstSettled.promise;
  clock.set(100);
  const result = await pending;
  assert.equal(result.outcome, "completed");
  assert.equal(attempts, 1);
  assert.equal(result.data.attempts.filter((item) => item.pageId === "S2").length, 1);
  assert.equal(result.data.counts.used, 1);
  assert.equal(clock.timers.size, 0);
});

test("pre-commit diagnostics remain combined after successful publication", async (t) => {
  const f = await fixture(t, {
    store: (store) => ({
      ...store,
      async allocate(input) {
        observeOperationDiagnostic({ code: "FIRST", message: "First diagnostic" });
        observeOperationDiagnostic({ code: "SECOND", message: "Second diagnostic" });
        return store.allocate(input);
      },
    }),
  });
  const result = await f.run();
  assert.equal(result.data.cache.status, "committed");
  if (result.data.cache.status === "committed") {
    assert.match(result.data.cache.diagnostic!.message, /FIRST: First diagnostic/);
    assert.match(result.data.cache.diagnostic!.message, /SECOND: Second diagnostic/);
  }
});

test("degraded research deliberately includes the common suggestion finalisation and its accounting", async (t) => {
  const f = await fixture(t, {
    urls: [],
    store: (store) => ({
      ...store,
      candidates: async () => [
        {
          query: "prior",
          reportPath: ".search/.intelli-v1/runs/prior/report.md",
          namespace: "v1",
          startedUtc: "2026-10-21T00:00:00.000Z",
          compatibilityKey: "verified-service-fixture",
        },
      ],
    }),
  });
  const result = await f.run();
  assert.equal(result.outcome, "no-links");
  assert.deepEqual(
    result.data.attempts.map((attempt) => attempt.role),
    ["search", "search", "suggest"],
  );
  assert.equal(result.data.accounting.attempts, 3);
  assert.equal(result.data.accounting.reportedCost.total, 0.03);
  assert.equal(result.data.cache.status, "not-requested");
});

test("an invalid consumed extraction limit rejects before inference rather than queuing forever (T03)", async (t) => {
  for (const extractionConcurrency of [0, -1, 1.5, NaN]) {
    const f = await fixture(t, { settings: { extractionConcurrency } });
    await assert.rejects(f.run(), /tuning.extractionConcurrency must be a positive integer/);
    assert.equal(f.requests.length, 0);
    assert.equal(f.runtime.coordinator.snapshot().activeOperations, 0);
  }
});

for (const role of ["search", "extract", "collate"] as const) {
  test(`abort during ${role} drains the scoped model and preserves partial failure data (T04/T17)`, async (t) => {
    const entered = deferred();
    const stop = async (_request: ScopedRequest, signal: AbortSignal) => {
      entered.resolve();
      if (!signal.aborted)
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      signal.throwIfAborted();
      return "Unreachable";
    };
    const f = await fixture(t, {
      search: role === "search" ? stop : undefined,
      extract: role === "extract" ? stop : undefined,
      collate: role === "collate" ? stop : undefined,
    });
    const controller = new AbortController();
    const pending = f.run(controller.signal).catch((error: unknown) => error);
    await entered.promise;
    controller.abort();
    const error = await pending;
    assert(error instanceof CoreOperationFailure);
    {
      assert(Check(operationOutputSchemas.intelli_research, error.data));
      assert.equal(error.data.outcome, "aborted");
      assert.equal(error.data.accounting.parentDelivery, "unknown");
      assert.equal(error.data.cache.status === "committed", false);
    }
    assert.equal(f.runtime.coordinator.snapshot().activeOperations, 0);
    assert.equal(f.runtime.coordinator.snapshot().activeFetches, 0);
    assert.notEqual(f.events.at(-1)?.pct, 100);
  });
}
