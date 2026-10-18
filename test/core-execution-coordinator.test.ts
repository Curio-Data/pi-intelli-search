// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { describe, it } from "node:test";
import type {
  Clock,
  CoordinatorOptions,
  ExecutionCoordinator,
  ModelCallScope,
  ModelRole,
  OperationLease,
  Permit,
  PolicyHooks,
} from "../src/core/contracts.js";
import {
  AdmissionError,
  COORDINATOR_LIMITS,
  admissionKind,
  createExecutionCoordinator,
  effectivePageConcurrency,
  runAdmittedAttempt,
  type CoordinatedPermit,
} from "../src/core/execution-coordinator.js";
import { createAttemptLedger } from "../src/core/usage.js";

/** Deterministic monotonic clock; callbacks run only when the test advances time. */
class ManualClock implements Clock {
  now = 0;
  private seq = 0;
  private timers: Array<{ at: number; seq: number; callback: () => void }> = [];

  monotonicMs(): number {
    return this.now;
  }
  utcIso(): string {
    return new Date(Date.UTC(2026, 9, 18) + this.now).toISOString();
  }
  schedule(delayMs: number, callback: () => void): () => void {
    const timer = { at: this.now + Math.max(0, delayMs), seq: ++this.seq, callback };
    this.timers.push(timer);
    return () => {
      this.timers = this.timers.filter((entry) => entry !== timer);
    };
  }
  sleep(delayMs: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      const onAbort = () => {
        cancel();
        reject(signal!.reason);
      };
      const cancel = this.schedule(delayMs, () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      });
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
  get pending(): number {
    return this.timers.length;
  }
  async advance(ms: number): Promise<void> {
    const target = this.now + ms;
    for (;;) {
      await flush();
      const due = this.timers.filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
      if (!due) break;
      this.timers = this.timers.filter((timer) => timer !== due);
      this.now = due.at;
      due.callback();
    }
    this.now = target;
    await flush();
  }
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function setup(overrides: Partial<Omit<CoordinatorOptions, "clock">> = {}) {
  const clock = new ManualClock();
  const coordinator = createExecutionCoordinator({
    modelConcurrency: 3,
    criticalReserve: 1,
    fetchConcurrency: 2,
    minRequestIntervalMs: 0,
    generation: 1,
    ...overrides,
    clock,
  });
  return { clock, coordinator };
}

function model(coordinator: ExecutionCoordinator, lease: OperationLease, kind: "critical" | "page", extra: { pageId?: string; signal?: AbortSignal } = {}) {
  return coordinator.acquireModel({
    operationId: lease.id,
    kind,
    signal: extra.signal ?? lease.signal,
    ...(extra.pageId !== undefined ? { pageId: extra.pageId } : {}),
  }) as Promise<CoordinatedPermit>;
}

/** Tracks settlement without consuming the rejection. */
function watch<T>(promise: Promise<T>) {
  const state: { settled: boolean; value?: T; error?: unknown } = { settled: false };
  promise.then((value) => Object.assign(state, { settled: true, value }), (error) => Object.assign(state, { settled: true, error }));
  return state;
}

async function rejectsWith(promise: Promise<unknown>, code: AdmissionError["code"]): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof AdmissionError && error.code === code);
}

function scopeFor(lease: OperationLease, role: ModelRole, ledger = createAttemptLedger(), pageId?: string): ModelCallScope {
  return { operation: lease, callId: `${role}-call`, role, ledger, ...(pageId !== undefined ? { pageId } : {}) };
}

function hooksFor(coordinator: ExecutionCoordinator, clock: Clock, scope: ModelCallScope): PolicyHooks {
  return { logger: { error() {}, warn() {} }, scope, coordinator, clock, random: () => 0.5 };
}

const fixtureModel = { provider: "fixture", model: "m" };

describe("C10 coordinator lifetime and ceilings (T10)", () => {
  it("validates options and starts no timer at construction or admission", async () => {
    const clock = new ManualClock();
    const base = { modelConcurrency: 5, criticalReserve: 1 as const, fetchConcurrency: 4, minRequestIntervalMs: 0, clock, generation: 0 };
    for (const bad of [{ modelConcurrency: 1 }, { modelConcurrency: 65 }, { modelConcurrency: 2.5 }, { fetchConcurrency: 0 }, { fetchConcurrency: 33 }, { minRequestIntervalMs: -1 }, { generation: -1 }])
      assert.throws(() => createExecutionCoordinator({ ...base, ...bad }), RangeError);
    assert.throws(() => createExecutionCoordinator({ ...base, criticalReserve: 2 as unknown as 1 }), RangeError);
    const coordinator = createExecutionCoordinator({ ...base, minRequestIntervalMs: 1000 });
    const lease = coordinator.begin("op-1");
    assert.equal(clock.pending, 0);
    (await model(coordinator, lease, "critical")).release();
    // Spacing alone creates no timer while nothing waits.
    assert.equal(clock.pending, 0);
    await lease.settle();
    assert.deepEqual(coordinator.snapshot(), { activeModels: 0, activePages: 0, activeFetches: 0, queuedModels: 0, queuedFetches: 0, activeOperations: 0, closed: false });
  });

  it("validates bounded control-free identifiers before admission", async () => {
    const { coordinator } = setup();
    for (const bad of ["", "a\nb", "tab\tid", "del\u007f", "c1\u0085", "sep\u2028", "é".repeat(65)])
      assert.throws(() => coordinator.begin(bad), TypeError, JSON.stringify(bad));
    assert.equal(coordinator.begin("é".repeat(64)).id.length, 64);
    const lease = coordinator.begin("op");
    assert.throws(() => coordinator.begin("op"), TypeError);
    await assert.rejects(model(coordinator, lease, "page", { pageId: "bad\u0000" }), TypeError);
    await assert.rejects(lease.acquireFetch({ pageId: "x".repeat(129) }), TypeError);
    await lease.settle();
    coordinator.begin("op");
    assert.equal(coordinator.snapshot().queuedModels, 0);
  });

  it("rejects the sixty-fifth simultaneous operation and admits again after settlement", async () => {
    const { coordinator } = setup();
    const leases = Array.from({ length: COORDINATOR_LIMITS.maxOperations }, (_, i) => coordinator.begin(`op-${i}`));
    assert.throws(() => coordinator.begin("op-extra"), (error: unknown) => error instanceof AdmissionError && error.code === "BUSY");
    assert.equal(coordinator.snapshot().activeOperations, 64);
    await leases[0].settle();
    assert.equal(coordinator.begin("op-extra").id, "op-extra");
  });

  it("caps queued model tickets at 512 with at most 448 page positions", async () => {
    const { coordinator } = setup({ modelConcurrency: 2 });
    const lease = coordinator.begin("op");
    const held = [await model(coordinator, lease, "critical"), await model(coordinator, lease, "critical")];
    const queued: Array<Promise<unknown>> = [];
    for (let i = 0; i < COORDINATOR_LIMITS.maxQueuedPageModels; i++) queued.push(model(coordinator, lease, "page", { pageId: `p${i}` }));
    await rejectsWith(model(coordinator, lease, "page", { pageId: "overflow" }), "BUSY");
    for (let i = 0; i < 64; i++) queued.push(model(coordinator, lease, "critical"));
    assert.equal(coordinator.snapshot().queuedModels, 512);
    await rejectsWith(model(coordinator, lease, "critical"), "BUSY");
    for (const promise of queued) promise.catch(() => {});
    lease.abort("test teardown");
    held.forEach((permit) => permit.release());
    await lease.settle();
    assert.equal(coordinator.snapshot().queuedModels, 0);
  });

  it("caps queued fetch tickets at 512", async () => {
    const { coordinator } = setup({ fetchConcurrency: 1 });
    const lease = coordinator.begin("op");
    const held = await lease.acquireFetch();
    const queued = Array.from({ length: COORDINATOR_LIMITS.maxQueuedFetches }, () => lease.acquireFetch());
    await rejectsWith(lease.acquireFetch(), "BUSY");
    queued.forEach((promise) => promise.catch(() => {}));
    lease.abort();
    held.release();
    await lease.settle();
  });

  it("rejected admission creates no attempt record", async () => {
    const { clock, coordinator } = setup({ modelConcurrency: 2 });
    const lease = coordinator.begin("op");
    const ledger = createAttemptLedger();
    lease.cutoffPages();
    let ran = false;
    await rejectsWith(
      runAdmittedAttempt(hooksFor(coordinator, clock, scopeFor(lease, "extract", ledger, "S1")), { model: fixtureModel }, 1, async () => {
        ran = true;
        return { value: 1 };
      }),
      "PAGE_CUTOFF",
    );
    assert.equal(ran, false);
    assert.equal(ledger.summary().attempts, 0);
  });

  it("settles owned tasks and permits, then removes its operation listener", async () => {
    const { coordinator } = setup();
    const external = new AbortController();
    const lease = coordinator.begin("op", external.signal);
    assert.equal(getEventListeners(external.signal, "abort").length, 1);
    let finish!: () => void;
    const task = lease.track(new Promise<void>((resolve) => (finish = resolve)));
    const permit = await model(coordinator, lease, "critical");
    const settled = watch(lease.settle());
    assert.equal(lease.settle(), lease.settle());
    await flush();
    assert.equal(settled.settled, false);
    finish();
    await task;
    await flush();
    assert.equal(settled.settled, false, "an unreleased permit is owned work");
    permit.release();
    await flush();
    assert.equal(settled.settled, true);
    assert.equal(getEventListeners(external.signal, "abort").length, 0);
    assert.throws(() => lease.track(Promise.resolve()), (error: unknown) => error instanceof AdmissionError && error.code === "CLOSED");
    await rejectsWith(lease.acquireFetch(), "CLOSED");
    await rejectsWith(model(coordinator, lease, "critical"), "CLOSED");
    // A later external abort cannot reach a settled lease.
    external.abort();
    assert.equal(lease.signal.aborted, false);
  });

  it("close is idempotent, cancels model and fetch permits and waits for their release", async () => {
    const { clock, coordinator } = setup({ minRequestIntervalMs: 100 });
    const lease = coordinator.begin("op");
    const modelPermit = await model(coordinator, lease, "page", { pageId: "S1" });
    const fetchPermit = await lease.acquireFetch({ pageId: "S2" });
    const paced = model(coordinator, lease, "critical");
    assert.equal(clock.pending, 1);
    const first = coordinator.close("runtime shutdown");
    assert.equal(coordinator.close(), first);
    await rejectsWith(paced, "CLOSED");
    assert.equal(clock.pending, 0, "close clears the pacing timer");
    assert.equal(modelPermit.signal.aborted, true);
    assert.equal(fetchPermit.signal.aborted, true);
    assert.equal(lease.signal.aborted, true);
    assert.throws(() => coordinator.begin("op-2"), (error: unknown) => error instanceof AdmissionError && error.code === "CLOSED");
    const closed = watch(first);
    await flush();
    assert.equal(closed.settled, false);
    modelPermit.release();
    fetchPermit.release();
    await flush();
    assert.equal(closed.settled, true);
    assert.deepEqual(coordinator.snapshot(), { activeModels: 0, activePages: 0, activeFetches: 0, queuedModels: 0, queuedFetches: 0, activeOperations: 0, closed: true });
  });

  it("generation replacement has zero active-work overlap and stale leases cannot touch the new coordinator", async () => {
    const clock = new ManualClock();
    const options = { modelConcurrency: 2, criticalReserve: 1 as const, fetchConcurrency: 1, minRequestIntervalMs: 0, clock };
    const intervals: Array<{ generation: number; start: number; end?: number }> = [];
    const old = createExecutionCoordinator({ ...options, generation: 1 });
    const oldLease = old.begin("op");
    const oldPermit = await model(old, oldLease, "critical");
    const oldWork = { generation: 1, start: clock.now } as { generation: number; start: number; end?: number };
    intervals.push(oldWork);
    // The old work honours cancellation but settles only after a delay.
    oldPermit.signal.addEventListener("abort", () => {
      void clock.sleep(30).then(() => {
        oldWork.end = clock.now;
        oldPermit.release();
      });
    });
    const replacement = old.close("session replacement").then(() => {
      const next = createExecutionCoordinator({ ...options, generation: 2 });
      intervals.push({ generation: 2, start: clock.now });
      return next;
    });
    await clock.advance(30);
    const next = await replacement;
    assert.ok(intervals[0].end! <= intervals[1].start, "old generation settled before the new one started");
    // Stale old-generation callbacks are inert against the replacement.
    await rejectsWith(model(next, oldLease, "critical"), "CLOSED");
    await rejectsWith(oldLease.acquireFetch(), "CLOSED");
    oldLease.abort();
    oldLease.cutoffPages();
    await oldLease.settle();
    await old.close();
    const lease = next.begin("op");
    assert.equal(lease.generation, 2);
    assert.equal(lease.signal.aborted, false);
    assert.equal(next.snapshot().activeOperations, 1);
  });
});

describe("C09 sticky cutoff and late work (T09)", () => {
  it("aborts only active page fetches, removes queued page work and keeps extraction and operation signals alive", async () => {
    const { coordinator } = setup({ modelConcurrency: 3, fetchConcurrency: 2 });
    const lease = coordinator.begin("op");
    const extraction = await model(coordinator, lease, "page", { pageId: "S1" });
    const pageFetch = await lease.acquireFetch({ pageId: "S2" });
    const discovery = new AbortController();
    const docs = await lease.acquireFetch({ signal: discovery.signal });
    const queuedPageFetch = lease.acquireFetch({ pageId: "S3" });
    const secondPage = await model(coordinator, lease, "page", { pageId: "S4" });
    const queuedPage = model(coordinator, lease, "page", { pageId: "S5" });
    assert.deepEqual([coordinator.snapshot().queuedModels, coordinator.snapshot().queuedFetches], [1, 1]);

    lease.cutoffPages();
    lease.cutoffPages();
    await rejectsWith(queuedPage, "PAGE_CUTOFF");
    await rejectsWith(queuedPageFetch, "PAGE_CUTOFF");
    assert.equal(pageFetch.signal.aborted, true);
    assert.ok(pageFetch.signal.reason instanceof AdmissionError && pageFetch.signal.reason.code === "PAGE_CUTOFF");
    assert.equal(extraction.signal.aborted, false, "active extraction survives cutoff");
    assert.equal(secondPage.signal.aborted, false);
    assert.equal(docs.signal.aborted, false, "discovery is not page work");
    assert.equal(lease.signal.aborted, false, "collation and commit keep a live operation signal");

    // Later page model/fetch tickets are rejected even for pages that started earlier.
    await rejectsWith(model(coordinator, lease, "page", { pageId: "S1" }), "PAGE_CUTOFF");
    await rejectsWith(lease.acquireFetch({ pageId: "S1" }), "PAGE_CUTOFF");
    // Critical work remains eligible while page slots are held by late extraction.
    const collate = await model(coordinator, lease, "critical");
    assert.equal(coordinator.snapshot().activeModels, 3);

    // Discovery has its own cancellation, independent of the operation.
    discovery.abort();
    assert.equal(docs.signal.aborted, true);
    assert.equal(lease.signal.aborted, false);
    pageFetch.release();
    docs.release();
    const nonPageFetch = await lease.acquireFetch();
    assert.equal(nonPageFetch.signal.aborted, false);

    for (const permit of [extraction, secondPage, collate, nonPageFetch]) permit.release();
    await lease.settle();
  });

  it("a discovery-only cancel removes its queued fetch tickets without aborting the operation", async () => {
    const { coordinator } = setup({ fetchConcurrency: 1 });
    const lease = coordinator.begin("op");
    const held = await lease.acquireFetch({ pageId: "S1" });
    const discovery = new AbortController();
    const queuedDocs = lease.acquireFetch({ signal: discovery.signal });
    const queuedPage = watch(lease.acquireFetch({ pageId: "S2" }));
    discovery.abort();
    await rejectsWith(queuedDocs, "ABORTED");
    assert.equal(lease.signal.aborted, false);
    assert.equal(coordinator.snapshot().queuedFetches, 1);
    held.release();
    await flush();
    assert.equal(queuedPage.settled, true);
    (queuedPage.value as Permit).release();
    await lease.settle();
  });

  it("a late extraction attempt finishes but cannot retry after cutoff", async () => {
    const { clock, coordinator } = setup();
    const lease = coordinator.begin("op");
    const ledger = createAttemptLedger();
    const hooks = hooksFor(coordinator, clock, scopeFor(lease, "extract", ledger, "S1"));
    const first = runAdmittedAttempt(hooks, { model: fixtureModel }, 1, async (control) => {
      lease.cutoffPages();
      assert.equal(control.signal.aborted, false);
      await clock.sleep(10, control.signal);
      return { value: "", error: "503 service unavailable" };
    });
    await clock.advance(10);
    assert.equal((await first).state, "failed");
    await rejectsWith(runAdmittedAttempt(hooks, { model: fixtureModel }, 2, async () => ({ value: "" })), "PAGE_CUTOFF");
    assert.deepEqual(ledger.records().map((record) => [record.attempt, record.state]), [[1, "failed"]]);
  });

  it("operation abort cancels both active model and fetch permits", async () => {
    const { coordinator } = setup();
    const lease = coordinator.begin("op");
    const extraction = await model(coordinator, lease, "page", { pageId: "S1" });
    const docs = await lease.acquireFetch();
    lease.abort("user cancelled");
    assert.equal(extraction.signal.aborted, true);
    assert.equal(docs.signal.aborted, true);
    await rejectsWith(model(coordinator, lease, "critical"), "ABORTED");
    extraction.release();
    docs.release();
    await lease.settle();
  });
});

describe("C12 capacity and fairness (T12)", () => {
  it("page work uses all but the reserve, and the reserve serves critical work while late pages hold every page slot", async () => {
    const { coordinator } = setup({ modelConcurrency: 3 });
    assert.equal(effectivePageConcurrency(4, { modelConcurrency: 5, criticalReserve: 1 }), 4);
    assert.equal(effectivePageConcurrency(8, { modelConcurrency: 5, criticalReserve: 1 }), 4);
    assert.equal(effectivePageConcurrency(2, { modelConcurrency: 5, criticalReserve: 1 }), 2);
    assert.equal(admissionKind("extract"), "page");
    for (const role of ["search", "collate", "suggest"] as const) assert.equal(admissionKind(role), "critical");
    const lease = coordinator.begin("op");
    const late = [await model(coordinator, lease, "page", { pageId: "S1" }), await model(coordinator, lease, "page", { pageId: "S2" })];
    const blocked = watch(model(coordinator, lease, "page", { pageId: "S3" }));
    await flush();
    assert.equal(blocked.settled, false);
    lease.cutoffPages();
    await flush();
    assert.ok(blocked.error instanceof AdmissionError);
    const reserve = await model(coordinator, lease, "critical");
    assert.deepEqual([coordinator.snapshot().activeModels, coordinator.snapshot().activePages], [3, 2]);
    // Late attempts count within modelConcurrency: nothing else fits.
    const waiting = watch(model(coordinator, lease, "critical"));
    await flush();
    assert.equal(waiting.settled, false);
    late[0].release();
    await flush();
    assert.equal(waiting.settled, true);
    for (const permit of [late[1], reserve, waiting.value as Permit]) permit.release();
    await lease.settle();
  });

  it("grants three critical then one page opportunity, without banking for a lone class", async () => {
    const { coordinator } = setup({ modelConcurrency: 2 });
    const lease = coordinator.begin("op");
    const holder = await model(coordinator, lease, "critical");
    const granted: Array<{ label: string; permit: CoordinatedPermit }> = [];
    const queue = (label: string, kind: "critical" | "page") =>
      void model(coordinator, lease, kind, kind === "page" ? { pageId: label } : {}).then((permit) => granted.push({ label, permit }));
    // Each step frees one slot, so exactly one waiter is granted per release.
    async function drive(gate: Permit, total: number): Promise<void> {
      while (granted.length < total) {
        gate.release();
        await flush();
        gate = granted.at(-1)!.permit;
      }
      gate.release();
    }
    let gate = await model(coordinator, lease, "critical");
    // A lone page class is served without moving the cycle.
    queue("p0", "page");
    gate.release();
    await flush();
    gate = granted[0].permit;
    for (const label of ["c1", "c2", "c3", "c4", "c5", "c6"]) queue(label, "critical");
    for (const label of ["p1", "p2", "p3"]) queue(label, "page");
    await drive(gate, 10);
    holder.release();
    assert.deepEqual(granted.map((entry) => entry.label), ["p0", "c1", "c2", "c3", "p1", "c4", "c5", "c6", "p2", "p3"]);
    const sequences = granted.map((entry) => entry.permit.sequence);
    assert.deepEqual(sequences, [...sequences].sort((a, b) => a - b), "permit sequence records grant order");
    await lease.settle();
  });

  it("round-robins between operations inside a class and records queue delay", async () => {
    const { clock, coordinator } = setup({ modelConcurrency: 2 });
    const x = coordinator.begin("op-x");
    const y = coordinator.begin("op-y");
    const holders = [await model(coordinator, x, "critical"), await model(coordinator, x, "critical")];
    const granted: Array<{ label: string; permit: CoordinatedPermit }> = [];
    for (const [lease, label] of [[x, "x1"], [x, "x2"], [x, "x3"], [y, "y1"], [y, "y2"]] as const)
      void model(coordinator, lease, "critical").then((permit) => granted.push({ label, permit }));
    await clock.advance(40);
    holders[0].release();
    await flush();
    let gate = granted[0].permit;
    holders[1].release();
    await flush();
    while (granted.length < 5) {
      gate.release();
      await flush();
      gate = granted.at(-1)!.permit;
    }
    gate.release();
    granted[1].permit.release();
    assert.deepEqual(granted.map((entry) => entry.label), ["x1", "y1", "x2", "y2", "x3"]);
    assert.equal(granted[0].permit.queueMs, 40);
    await Promise.all([x.settle(), y.settle()]);
  });
});

describe("C13 pacing (T13)", () => {
  it("advances spacing only at actual dispatch and holds no permit while a ticket waits for pacing", async () => {
    const { clock, coordinator } = setup({ modelConcurrency: 5, minRequestIntervalMs: 100 });
    const lease = coordinator.begin("op");
    const first = await model(coordinator, lease, "critical");
    assert.equal(first.grantedAtMs, 0);
    const queued = [model(coordinator, lease, "critical"), model(coordinator, lease, "critical"), model(coordinator, lease, "critical")];
    assert.equal(coordinator.snapshot().activeModels, 1, "waiting tickets hold no permit");
    assert.equal(clock.pending, 1, "one pacing timer for all pending work");
    await clock.advance(100);
    await clock.advance(100);
    await clock.advance(100);
    const permits = await Promise.all(queued);
    assert.deepEqual(permits.map((permit) => permit.grantedAtMs), [100, 200, 300]);
    assert.deepEqual(permits.map((permit) => permit.queueMs), [100, 200, 300]);
    assert.equal(clock.pending, 0);
    for (const permit of [first, ...permits]) permit.release();
    await lease.settle();
  });

  it("an aborted or cut-off pacing ticket leaves no timer or future reservation", async () => {
    const { clock, coordinator } = setup({ modelConcurrency: 5, minRequestIntervalMs: 100 });
    const lease = coordinator.begin("op");
    const first = await model(coordinator, lease, "critical");
    const cancel = new AbortController();
    const aborted = model(coordinator, lease, "critical", { signal: cancel.signal });
    const page = model(coordinator, lease, "page", { pageId: "S1" });
    await clock.advance(50);
    cancel.abort();
    await rejectsWith(aborted, "ABORTED");
    assert.equal(getEventListeners(cancel.signal, "abort").length, 0);
    lease.cutoffPages();
    await rejectsWith(page, "PAGE_CUTOFF");
    assert.equal(clock.pending, 0);
    // The earlier queued tickets reserved nothing: the next start is due at 100, not 300.
    await clock.advance(50);
    const next = await model(coordinator, lease, "critical");
    assert.equal(next.grantedAtMs, 100);
    first.release();
    next.release();
    await lease.settle();
  });

  it("cancellation while waiting for capacity leaves no permit, ticket or listener", async () => {
    const { coordinator } = setup({ modelConcurrency: 2 });
    const lease = coordinator.begin("op");
    const held = [await model(coordinator, lease, "critical"), await model(coordinator, lease, "critical")];
    const cancel = new AbortController();
    const waiting = model(coordinator, lease, "critical", { signal: cancel.signal });
    assert.equal(getEventListeners(cancel.signal, "abort").length, 1);
    cancel.abort();
    await rejectsWith(waiting, "ABORTED");
    assert.equal(getEventListeners(cancel.signal, "abort").length, 0);
    assert.deepEqual([coordinator.snapshot().activeModels, coordinator.snapshot().queuedModels], [2, 0]);
    held.forEach((permit) => permit.release());
    await lease.settle();
    assert.equal(coordinator.snapshot().activeModels, 0);
  });

  it("backoff holds no permit, and cancellation during backoff leaves no timer", async () => {
    const { clock, coordinator } = setup({ minRequestIntervalMs: 0 });
    const lease = coordinator.begin("op");
    const ledger = createAttemptLedger();
    const hooks = hooksFor(coordinator, clock, scopeFor(lease, "search", ledger));
    const result = await runAdmittedAttempt(hooks, { model: fixtureModel }, 1, async () => ({ value: "", error: "429 rate limited" }));
    assert.equal(result.state, "failed");
    assert.equal(coordinator.snapshot().activeModels, 0, "released before backoff");
    const backoff = clock.sleep(1000, lease.signal);
    assert.equal(clock.pending, 1);
    lease.abort("cancel during backoff");
    await assert.rejects(backoff);
    assert.equal(clock.pending, 0);
    await rejectsWith(runAdmittedAttempt(hooks, { model: fixtureModel }, 2, async () => ({ value: "" })), "ABORTED");
    assert.equal(ledger.summary().attempts, 1);
    await lease.settle();
  });
});

describe("C11 admitted attempts (T11 library portion)", () => {
  it("starts the attempt timeout at dispatch, not while queued", async () => {
    const { clock, coordinator } = setup({ modelConcurrency: 2 });
    const lease = coordinator.begin("op");
    const held = [await model(coordinator, lease, "critical"), await model(coordinator, lease, "critical")];
    const ledger = createAttemptLedger();
    const pending = runAdmittedAttempt(hooksFor(coordinator, clock, scopeFor(lease, "collate", ledger)), { model: fixtureModel, timeoutMs: 100 }, 1, async (control) => {
      await clock.sleep(50, control.signal);
      return { value: "done" };
    });
    await clock.advance(500);
    held[0].release();
    await clock.advance(50);
    const result = await pending;
    assert.equal(result.state, "succeeded");
    assert.deepEqual(result.outcome, { value: "done" });
    const [record] = ledger.records();
    assert.deepEqual([record.startedAtMs, record.queueMs, record.settledAtMs, record.state], [500, 500, 550, "succeeded"]);
    held[1].release();
    await lease.settle();
  });

  it("a stalled attempt times out after dispatch and records the timeout", async () => {
    const { clock, coordinator } = setup();
    const lease = coordinator.begin("op");
    const ledger = createAttemptLedger();
    const pending = runAdmittedAttempt(hooksFor(coordinator, clock, scopeFor(lease, "search", ledger)), { model: fixtureModel, timeoutMs: 100 }, 1, async (control) => {
      control.observe({ tokens: { inputTotal: 10 }, source: "provider-response", costBasis: "unknown" });
      // Stalled body: settles only when its signal aborts.
      await new Promise((_, reject) => control.signal.addEventListener("abort", () => reject(control.signal.reason)));
      return { value: "never" };
    });
    await clock.advance(100);
    const result = await pending;
    assert.equal(result.state, "timed-out");
    assert.ok("thrown" in result.outcome);
    assert.equal(ledger.records()[0].state, "timed-out");
    assert.equal(ledger.records()[0].observation?.tokens.inputTotal, 10);
    assert.equal(coordinator.snapshot().activeModels, 0);
    assert.equal(clock.pending, 0);
    await lease.settle();
  });

  it("each retry reacquires admission and error-bearing usage is recorded before failure conversion", async () => {
    const { clock, coordinator } = setup();
    const lease = coordinator.begin("op");
    const ledger = createAttemptLedger();
    const hooks = hooksFor(coordinator, clock, scopeFor(lease, "extract", ledger, "S1"));
    const sequences: number[] = [];
    let active = -1;
    const run = (error?: string) => async (control: import("../src/core/contracts.js").AttemptControl) => {
      active = coordinator.snapshot().activePages;
      control.observe({ tokens: { inputTotal: 5, outputTotal: 0 }, source: "provider-response", costBasis: "unknown" });
      control.retryAfterMs = 250;
      return error ? { value: "", error } : { value: "ok" };
    };
    const first = await runAdmittedAttempt(hooks, { model: fixtureModel }, 1, run("503 overloaded"));
    assert.equal(active, 1);
    assert.equal(first.retryAfterMs, 250);
    assert.equal(coordinator.snapshot().activeModels, 0);
    const second = await runAdmittedAttempt(hooks, { model: fixtureModel }, 2, run());
    void sequences;
    assert.deepEqual([first.state, second.state], ["failed", "succeeded"]);
    assert.deepEqual(ledger.records().map((record) => [record.attempt, record.state, record.observation?.tokens.inputTotal]), [[1, "failed", 5], [2, "succeeded", 5]]);
    await lease.settle();
  });

  it("request and operation cancellation take the abort path; foreign scopes are rejected before dispatch", async () => {
    const { clock, coordinator } = setup({ modelConcurrency: 2 });
    const other = setup().coordinator;
    const lease = coordinator.begin("op");
    const ledger = createAttemptLedger();
    await assert.rejects(
      runAdmittedAttempt(hooksFor(other, clock, scopeFor(lease, "search", ledger)), { model: fixtureModel }, 1, async () => ({ value: 1 })),
      TypeError,
    );
    const request = new AbortController();
    const running = runAdmittedAttempt(hooksFor(coordinator, clock, scopeFor(lease, "search", ledger)), { model: fixtureModel, signal: request.signal }, 1, async (control) => {
      await clock.sleep(1000, control.signal);
      return { value: 1 };
    });
    await flush();
    request.abort();
    assert.equal((await running).state, "aborted");
    const queuedRequest = new AbortController();
    const held = [await model(coordinator, lease, "critical"), await model(coordinator, lease, "critical")];
    const queued = runAdmittedAttempt(hooksFor(coordinator, clock, { ...scopeFor(lease, "search", ledger), callId: "queued" }), { model: fixtureModel, signal: queuedRequest.signal }, 1, async () => ({ value: 1 }));
    queuedRequest.abort();
    await rejectsWith(queued, "ABORTED");
    assert.deepEqual(ledger.records().map((record) => record.state), ["aborted"]);
    held.forEach((permit) => permit.release());
    await lease.settle();
  });
});
