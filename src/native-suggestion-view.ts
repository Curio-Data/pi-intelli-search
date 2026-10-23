// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type { CommittedRun, IndexCandidate, OperationLease, RunReservation, RunStore } from "./core/contracts.js";
import type { NativeSuggestionReadView } from "./native-injection.js";

export class NativeSuggestionViewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativeSuggestionViewError";
  }
}

const reservationCopy = (reservation: RunReservation): RunReservation => Object.freeze({ ...reservation });
const runCopy = (run: CommittedRun): CommittedRun => Object.freeze({
  ...run,
  reservation: reservationCopy(run.reservation),
  files: Object.freeze(run.files.map((file) => Object.freeze({ ...file }))),
});

/** F7-1 native-only read seam. The production store and all writes remain authoritative. */
export function withNativeSuggestionReadView(
  store: RunStore,
  controller: NativeSuggestionReadView,
  operation: OperationLease,
): RunStore {
  const pending = new Set<Promise<unknown>>();
  let poisoned = false;
  let allocated = false;
  let indexed = false;
  let operationNotice = false;
  let query: string | undefined;
  const own = <T>(start: () => Promise<T>): Promise<T> => {
    let admitted = false;
    const task = Promise.resolve().then(() => {
      if (!admitted) throw new NativeSuggestionViewError("Suggestion read ownership is closed");
      return start();
    });
    let tracked: Promise<T>;
    try {
      tracked = operation.track(task);
      admitted = true;
    } catch (error) {
      void task.catch(() => {});
      throw error;
    }
    pending.add(tracked);
    void tracked.then(() => pending.delete(tracked), () => pending.delete(tracked));
    return tracked;
  };
  const notify = (callback: () => void) => {
    try {
      callback();
    } catch {
      // The benchmark controller also marks its external block invalid before
      // rethrowing. Never let notification faults change an actual write result.
      poisoned = true;
    }
  };
  const unavailable = (phase: Parameters<NativeSuggestionReadView["unavailable"]>[0]["phase"]) => {
    if (query !== undefined)
      notify(() => controller.unavailable(Object.freeze({ operationId: operation.id, query: query!, phase })));
  };
  const assertOpen = (signal: AbortSignal) => {
    if (poisoned) throw new NativeSuggestionViewError("Suggestion read-view notification failed");
    if (operation.signal.aborted) operation.signal.throwIfAborted();
    signal.throwIfAborted();
  };

  return Object.freeze({
    async allocate(input) {
      query = input.query;
      try {
        const result = await store.allocate(input);
        if (result.status === "allocated") {
          allocated = true;
          const reservation = reservationCopy(result.reservation);
          notify(() => controller.allocated(Object.freeze({ operationId: operation.id, query: input.query, reservation })));
        } else unavailable("allocation");
        return result;
      } catch (error) {
        unavailable("allocation");
        throw error;
      }
    },
    async commit(reservation, artifacts, signal) {
      try {
        const result = await store.commit(reservation, artifacts, signal);
        if (result.status === "unavailable") unavailable("commit");
        return result;
      } catch (error) {
        unavailable("commit");
        throw error;
      }
    },
    async updateIndex(run, inputQuery, signal) {
      query ??= inputQuery;
      try {
        const result = await store.updateIndex(run, inputQuery, signal);
        if (result === "updated") {
          indexed = true;
          const copy = runCopy(run);
          notify(() => controller.indexed(Object.freeze({ operationId: operation.id, run: copy })));
        } else unavailable("index");
        return result;
      } catch (error) {
        unavailable("index");
        throw error;
      }
    },
    recordAccounting: (run, records, summary, signal) => store.recordAccounting(run, records, summary, signal),
    candidates(current, inputQuery, callerSignal) {
      query ??= inputQuery;
      const signal = callerSignal === operation.signal ? callerSignal : AbortSignal.any([operation.signal, callerSignal]);
      return own(async () => {
        assertOpen(signal);
        let acceptingReads = true;
        let latest: readonly IndexCandidate[] | undefined;
        const reads = new Set<Promise<readonly IndexCandidate[]>>();
        let outstandingAtReturn = false;
        const readVerified = (): Promise<readonly IndexCandidate[]> => {
          if (!acceptingReads) {
            poisoned = true;
            // No work is started by a callback retained after its owned scope.
            const rejected = Promise.reject<readonly IndexCandidate[]>(new NativeSuggestionViewError("Suggestion read scope is closed"));
            void rejected.catch(() => {});
            return rejected;
          }
          const task = own(async () => {
            assertOpen(signal);
            const rows = await store.candidates(current, inputQuery, signal);
            assertOpen(signal);
            latest = Object.freeze(rows.map((row) => Object.freeze({ ...row })));
            return latest;
          });
          reads.add(task);
          void task.then(() => reads.delete(task), () => reads.delete(task));
          return task;
        };
        let selected: readonly IndexCandidate[];
        try {
          selected = await controller.candidates(Object.freeze({
            operationId: operation.id,
            current: current ? reservationCopy(current) : undefined,
            query: inputQuery,
            signal,
            readVerified,
          }));
        } finally {
          acceptingReads = false;
          outstandingAtReturn = reads.size > 0;
          // Even a badly behaved controller cannot detach an unawaited read.
          await Promise.allSettled([...reads]);
        }
        assertOpen(signal);
        if (outstandingAtReturn)
          throw new NativeSuggestionViewError("Suggestion controller returned before its reads settled");
        if (!Array.isArray(selected) || latest === undefined)
          throw new NativeSuggestionViewError("Suggestion controller must select from an actual verified read");
        const members = new Set(latest);
        const seen = new Set<IndexCandidate>();
        for (const candidate of selected) {
          if (!members.has(candidate) || seen.has(candidate))
            throw new NativeSuggestionViewError("Suggestion controller returned a foreign or duplicate candidate");
          seen.add(candidate);
        }
        return Object.freeze([...selected]);
      });
    },
    async settle() {
      // The native runtime retains its parent lease while this drains. No timer
      // race or cancellation return abandons controller or reader ownership.
      while (pending.size) await Promise.allSettled([...pending]);
      try {
        await store.settle();
      } finally {
        if (allocated && !indexed && !operationNotice) {
          operationNotice = true;
          unavailable("operation");
        }
      }
    },
  } satisfies RunStore);
}
