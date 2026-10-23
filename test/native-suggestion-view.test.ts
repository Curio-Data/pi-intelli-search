// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CommittedRun, IndexCandidate, RunReservation, RunStore } from "../src/core/contracts.js";
import { createExecutionCoordinator } from "../src/core/execution-coordinator.js";
import { createSystemClock } from "../src/core/clock.js";
import { captureNativeInjection, type NativeSuggestionReadView } from "../src/native-injection.js";
import { withNativeSuggestionReadView } from "../src/native-suggestion-view.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const reservation: RunReservation = {
  namespaceId: "namespace", runId: "run", sequence: 1,
  startedUtc: "2026-10-23T00:00:00.000Z", compatibilityKey: "key",
  physicalPath: "/owned/cache/run", displayPath: ".search/run",
};
const run: CommittedRun = { reservation, files: [], manifestSha256: "a".repeat(64) };
const row = (query: string): IndexCandidate => ({ query, reportPath: `.search/${query}/report.md`, namespace: "v1", startedUtc: reservation.startedUtc, compatibilityKey: query, admissionSequence: 1 });
function fixture(overrides: Partial<RunStore> = {}, controllerOverrides: Partial<NativeSuggestionReadView> = {}) {
  const coordinator = createExecutionCoordinator({
    generation: 1, clock: createSystemClock(), modelConcurrency: 5, criticalReserve: 1,
    fetchConcurrency: 4, minRequestIntervalMs: 0,
  });
  const operation = coordinator.begin("view-operation");
  const notifications: string[] = [];
  const store: RunStore = {
    allocate: async () => ({ status: "allocated", reservation }),
    commit: async () => ({ status: "committed", run }),
    updateIndex: async () => "updated",
    recordAccounting: async () => ({ status: "unavailable", diagnostic: { code: "TEST", message: "unused" } }),
    candidates: async () => [row("a"), row("b")],
    settle: async () => {},
    ...overrides,
  };
  const controller: NativeSuggestionReadView = {
    allocated: () => { notifications.push("allocated"); },
    indexed: () => { notifications.push("indexed"); },
    unavailable: ({ phase }) => { notifications.push(phase); },
    candidates: async ({ readVerified }) => readVerified(),
    ...controllerOverrides,
  };
  const view = withNativeSuggestionReadView(store, controller, operation);
  const finish = async () => { await view.settle(); await operation.settle(); await coordinator.close(); };
  return { view, operation, coordinator, notifications, finish };
}

describe("F7 native verified suggestion read seam", () => {
  it("captures every nested function identity and rejects unknown or incomplete controllers", () => {
    const original: NativeSuggestionReadView = { allocated() {}, indexed() {}, unavailable() {}, candidates: async ({ readVerified }) => readVerified() };
    const captured = captureNativeInjection({ suggestionReadView: original });
    const callback = captured.suggestionReadView!.candidates;
    Object.assign(original, { candidates: async () => { throw new Error("mutated"); } });
    assert.equal(captured.suggestionReadView!.candidates, callback);
    assert(Object.isFrozen(captured.suggestionReadView));
    for (const invalid of [null, {}, { ...original, writer() {} }, { ...original, indexed: 3 }])
      assert.throws(() => captureNativeInjection({ suggestionReadView: invalid } as never), /suggestion read view/);
  });

  it("notifies indexed only after the actual index write settles and protects notification data", async () => {
    const index = deferred<"updated">();
    const f = fixture({ updateIndex: () => index.promise }, {
      allocated: (input) => {
        assert(Object.isFrozen(input));
        assert(Object.isFrozen(input.reservation));
        assert.notEqual(input.reservation, reservation);
      },
      indexed: (input) => {
        assert(Object.isFrozen(input.run));
        assert(Object.isFrozen(input.run.files));
        f.notifications.push("indexed");
      },
    });
    await f.view.allocate({ operationId: f.operation.id, query: "q", startedUtc: reservation.startedUtc, signal: f.operation.signal });
    const committed = await f.view.commit(reservation, [], f.operation.signal);
    assert.equal(committed.status, "committed");
    const updating = f.view.updateIndex(run, "q", f.operation.signal);
    await Promise.resolve();
    assert.deepEqual(f.notifications, []);
    index.resolve("updated");
    assert.equal(await updating, "updated");
    assert.deepEqual(f.notifications, ["indexed"]);
    await f.finish();
  });

  it("permits ordered immutable reference projection but rejects invented, duplicate and unread selections", async () => {
    for (const kind of ["valid", "foreign", "duplicate", "unread"] as const) {
      const f = fixture({}, { candidates: async ({ readVerified }) => {
        if (kind === "unread") return [];
        const rows = await readVerified();
        assert(Object.isFrozen(rows));
        assert(Object.isFrozen(rows[0]));
        if (kind === "foreign") return [{ ...rows[0]! }];
        if (kind === "duplicate") return [rows[0]!, rows[0]!];
        return [rows[1]!, rows[0]!];
      } });
      const selecting = f.view.candidates(undefined, "q", f.operation.signal);
      if (kind === "valid") assert.deepEqual((await selecting).map((item) => item.query), ["b", "a"]);
      else await assert.rejects(selecting, /actual verified read|foreign or duplicate/);
      await f.finish();
    }
  });

  it("accepts an actually read empty view and rejects references from an earlier read", async () => {
    const empty = fixture({ candidates: async () => [] });
    assert.deepEqual(await empty.view.candidates(undefined, "q", empty.operation.signal), []);
    await empty.finish();
    const f = fixture({}, { candidates: async ({ readVerified }) => {
      const earlier = await readVerified();
      await readVerified();
      return earlier;
    } });
    await assert.rejects(f.view.candidates(undefined, "q", f.operation.signal), /foreign/);
    await f.finish();
  });

  it("drains an unawaited real read and rejects late retained callbacks without starting more work", async () => {
    const entered = deferred<void>();
    const released = deferred<readonly IndexCandidate[]>();
    let reads = 0;
    let lateRead!: () => Promise<readonly IndexCandidate[]>;
    const f = fixture({ candidates: () => { reads++; entered.resolve(); return released.promise; } }, {
      candidates: async ({ readVerified }) => { lateRead = readVerified; void readVerified().catch(() => {}); return []; },
    });
    let finished = false;
    const selection = f.view.candidates(undefined, "q", f.operation.signal);
    const rejected = assert.rejects(selection, /before its reads settled/).then(() => { finished = true; });
    await entered.promise;
    await Promise.resolve();
    assert.equal(finished, false);
    const closing = f.view.settle();
    released.resolve([row("a")]);
    await rejected;
    await closing;
    await assert.rejects(lateRead(), /scope is closed/);
    assert.equal(reads, 1);
    await f.finish();
  });

  it("owns cancellation through a visibility wait and leaves no active lease or model permit", async () => {
    const entered = deferred<void>();
    let listeners = 0;
    const f = fixture({}, { candidates: async ({ signal }) => {
      await new Promise<void>((_resolve, reject) => {
        listeners++;
        signal.addEventListener("abort", () => { listeners--; reject(signal.reason); }, { once: true });
        entered.resolve();
      });
      return [];
    } });
    // A caller's independent signal cannot bypass operation cancellation.
    const rejected = assert.rejects(f.view.candidates(undefined, "q", new AbortController().signal));
    await entered.promise;
    assert.equal(f.coordinator.snapshot().activeModels, 0);
    f.operation.abort("stop view");
    await rejected;
    await f.finish();
    assert.equal(listeners, 0);
    assert.equal(f.coordinator.snapshot().activeOperations, 0);
  });

  it("contains notification exceptions without changing write results and poisons later reads", async () => {
    let invalid = false;
    const f = fixture({}, { indexed: () => { invalid = true; throw new Error("observer fault"); } });
    await f.view.allocate({ operationId: f.operation.id, query: "q", startedUtc: reservation.startedUtc, signal: f.operation.signal });
    assert.equal((await f.view.commit(reservation, [], f.operation.signal)).status, "committed");
    assert.equal(await f.view.updateIndex(run, "q", f.operation.signal), "updated");
    assert(invalid, "controller marks external block invalid before rethrowing");
    await assert.rejects(f.view.candidates(reservation, "q", f.operation.signal), /notification failed/);
    await f.finish();
  });

  it("reports producer failure phases and allocated-without-index settlement once", async () => {
    const unavailable = { status: "unavailable" as const, diagnostic: { code: "TEST", message: "test" } };
    const f = fixture({ commit: async () => unavailable });
    await f.view.allocate({ operationId: f.operation.id, query: "q", startedUtc: reservation.startedUtc, signal: f.operation.signal });
    assert.equal(await f.view.commit(reservation, [], f.operation.signal), unavailable);
    await f.view.settle(); await f.view.settle();
    assert.deepEqual(f.notifications, ["allocated", "commit", "operation"]);
    await f.finish();
    const g = fixture({ updateIndex: async () => "unavailable" });
    await g.view.allocate({ operationId: g.operation.id, query: "q", startedUtc: reservation.startedUtc, signal: g.operation.signal });
    await g.view.commit(reservation, [], g.operation.signal);
    await g.view.updateIndex(run, "q", g.operation.signal);
    await g.finish();
    assert.deepEqual(g.notifications, ["allocated", "index", "operation"]);
  });

  it("starts no read or controller work when operation ownership is already settled", async () => {
    let calls = 0;
    const f = fixture({ candidates: async () => { calls++; return []; } }, {
      candidates: async ({ readVerified }) => { calls++; return readVerified(); },
    });
    await f.operation.settle();
    assert.throws(() => f.view.candidates(undefined, "q", f.operation.signal), /closed|settled/i);
    await Promise.resolve();
    assert.equal(calls, 0);
    await f.coordinator.close();
  });

  it("preserves primary allocation errors even if the failure observer throws", async () => {
    const primary = new Error("allocation failed");
    const f = fixture({ allocate: async () => { throw primary; } }, { unavailable: () => { throw new Error("observer"); } });
    await assert.rejects(f.view.allocate({ operationId: f.operation.id, query: "q", startedUtc: reservation.startedUtc, signal: f.operation.signal }), (error) => error === primary);
    await f.finish();
  });
});
