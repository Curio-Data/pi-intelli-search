// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// C08 page-phase deadline state machine. It decides when the evidence snapshot
// freezes; the coordinator owns cutoff, permits, late drain and lease settlement.
import type { Clock, ResearchExecutionSettings } from "./execution-contracts.js";
import { parseExecutionSettings } from "./execution-settings.js";

export type PageDeadlineReason =
  | "disabled"
  | "all-terminal"
  | "adaptive"
  | "minimum"
  | "ceiling"
  | "not-applicable";

export interface PageDeadlineSnapshot {
  /** Terminal pages recorded before freeze, in candidate order. */
  readonly terminalIds: readonly string[];
  /** Nonempty successes recorded before freeze, in candidate order. */
  readonly successIds: readonly string[];
  readonly reason: PageDeadlineReason;
  readonly minimumMet: boolean;
  readonly startedAtMs: number;
  /** Monotonic time at which the freeze transition ran. */
  readonly frozenAtMs: number;
  readonly adaptiveAtMs?: number;
  readonly ceilingAtMs?: number;
}

export interface PageDeadlineOptions {
  readonly clock: Clock;
  readonly policy: ResearchExecutionSettings["deadline"];
  readonly candidateIds: readonly string[];
  /** Notification of an already committed snapshot; a throw is contained, never rethrown. */
  readonly onFreeze: (snapshot: PageDeadlineSnapshot) => void;
  /** Observes an `onFreeze` exception; its own exceptions are also contained. */
  readonly onCallbackError?: (error: unknown) => void;
}

export interface PageDeadline {
  start(): void;
  /** True only when the event was recorded before freeze; not a success verdict. */
  terminal(pageId: string, nonemptySuccess: boolean): boolean;
  snapshot(): PageDeadlineSnapshot | undefined;
  dispose(): void;
}

/**
 * Literal C08 `ceil(n * quorum)` on the binary product. Floating-point products are not
 * snapped: `100 * 0.07` is `7.000000000000001`, so that quorum is 8 pages, not 7.
 */
export function quorumCount(n: number, quorum: number): number {
  return Math.ceil(n * quorum);
}

/** Ordinary median; an even count averages the central pair. */
export function medianMs(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError("median requires at least one value");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Reads each option exactly once, so validation and later use see the same values. */
function captureOptions(options: PageDeadlineOptions): PageDeadlineOptions {
  if (!options || typeof options !== "object") throw new TypeError("page deadline options must be an object");
  const { clock, candidateIds, onFreeze, onCallbackError, policy } = options;
  if (!clock || typeof clock.monotonicMs !== "function" || typeof clock.schedule !== "function")
    throw new TypeError("page deadline clock must provide monotonicMs and schedule");
  if (typeof onFreeze !== "function") throw new TypeError("page deadline onFreeze must be a function");
  if (onCallbackError !== undefined && typeof onCallbackError !== "function")
    throw new TypeError("page deadline onCallbackError must be a function");
  if (!Array.isArray(candidateIds)) throw new TypeError("page deadline candidateIds must be an array");
  const order = Object.freeze([...candidateIds]);
  const seen = new Set<string>();
  for (const id of order) {
    if (typeof id !== "string" || id.length === 0)
      throw new TypeError("page deadline candidate identifiers must be nonempty strings");
    if (seen.has(id)) throw new RangeError(`duplicate page deadline candidate: ${id}`);
    seen.add(id);
  }
  return {
    clock,
    candidateIds: order,
    onFreeze,
    onCallbackError,
    policy: parseExecutionSettings({ deadline: policy }, "pageDeadline").deadline,
  };
}

export function createPageDeadline(options: PageDeadlineOptions): PageDeadline {
  const { clock, candidateIds: order, onFreeze, onCallbackError, policy } = captureOptions(options);
  const index = new Map(order.map((id, position) => [id, position]));
  const n = order.length;
  const required = policy.enabled ? Math.min(policy.minSources, n) : 0;
  const quorum = policy.enabled ? quorumCount(n, policy.quorum) : n;

  const terminalAt = new Map<string, number>();
  const successes = new Set<string>();
  const latencies: number[] = [];
  const cancels: Array<() => void> = [];
  let t0: number | undefined;
  let ceilingAt: number | undefined;
  let adaptiveAt: number | undefined;
  let frozen: PageDeadlineSnapshot | undefined;
  let disposed = false;

  const clearTimers = () => {
    for (const cancel of cancels.splice(0)) cancel();
  };

  const freeze = (reason: PageDeadlineReason): void => {
    const inOrder = (ids: ReadonlySet<string> | ReadonlyMap<string, number>) =>
      Object.freeze(order.filter((id) => ids.has(id)));
    // Commit and clear before notifying, so reentrant calls observe a frozen phase.
    frozen = Object.freeze({
      terminalIds: inOrder(terminalAt),
      successIds: inOrder(successes),
      reason,
      minimumMet: successes.size >= required,
      startedAtMs: t0!,
      frozenAtMs: clock.monotonicMs(),
      ...(adaptiveAt === undefined ? {} : { adaptiveAtMs: adaptiveAt }),
      ...(ceilingAt === undefined ? {} : { ceilingAtMs: ceilingAt }),
    });
    clearTimers();
    // The freeze is already committed: a throwing notification must not escape a timer
    // callback or replace the terminal() verdict, so it goes only to the captured observer.
    try {
      onFreeze(frozen);
    } catch (error) {
      try {
        onCallbackError?.(error);
      } catch {
        // The observer is the last report channel; nothing remains to tell.
      }
    }
  };

  const live = () => frozen === undefined && !disposed;

  // Scheduled cutoffs at or before `now`; adaptive only once the minimum is held.
  const dueCutoff = (now: number): PageDeadlineReason | undefined => {
    if (ceilingAt !== undefined && now >= ceilingAt) return "ceiling";
    if (adaptiveAt !== undefined && now >= adaptiveAt && successes.size >= required) return "adaptive";
    return undefined;
  };

  const onCeiling = () => {
    if (live()) freeze("ceiling");
  };
  const onAdaptive = () => {
    // Below the minimum the phase keeps working; the next qualifying success freezes it.
    if (live() && successes.size >= required) freeze("adaptive");
  };

  const armAdaptive = (now: number): void => {
    if (!policy.enabled || adaptiveAt !== undefined) return;
    if (terminalAt.size < quorum || successes.size === 0) return;
    const start = t0!;
    const raw = now + policy.factor * medianMs(latencies);
    adaptiveAt = Math.min(start + policy.ceilingMs, Math.max(start + policy.floorMs, raw));
    // At the ceiling instant the absolute ceiling governs; no second timer.
    if (adaptiveAt < ceilingAt! && adaptiveAt > now) cancels.push(clock.schedule(adaptiveAt - now, onAdaptive));
  };

  return {
    start() {
      if (disposed) throw new Error("page deadline is disposed");
      if (t0 !== undefined) throw new Error("page deadline already started");
      t0 = clock.monotonicMs();
      if (n === 0) return freeze("not-applicable");
      if (!policy.enabled) return;
      ceilingAt = t0 + policy.ceilingMs;
      cancels.push(clock.schedule(policy.ceilingMs, onCeiling));
    },

    terminal(pageId, nonemptySuccess) {
      if (typeof pageId !== "string" || !index.has(pageId))
        throw new RangeError(`unknown page deadline candidate: ${String(pageId)}`);
      if (typeof nonemptySuccess !== "boolean") throw new TypeError("nonemptySuccess must be boolean");
      if (t0 === undefined) throw new Error("page deadline has not started");
      // Sticky after freeze or dispose: any valid page event, even a repeat, is not accepted.
      if (!live()) return false;
      if (terminalAt.has(pageId)) throw new Error(`duplicate terminal event for page: ${pageId}`);

      const now = clock.monotonicMs();
      // Equal-time scheduled cutoff wins, whatever order timer callbacks arrive in.
      const due = dueCutoff(now);
      if (due) {
        freeze(due);
        return false;
      }

      terminalAt.set(pageId, now);
      if (nonemptySuccess) {
        successes.add(pageId);
        latencies.push(now - t0);
      }

      if (terminalAt.size === n) {
        freeze(policy.enabled ? "all-terminal" : "disabled");
        return true;
      }
      if (!policy.enabled) return true;

      const holding = adaptiveAt !== undefined && now >= adaptiveAt;
      armAdaptive(now);
      if (holding) {
        if (nonemptySuccess && successes.size >= required) freeze("minimum");
      } else if (adaptiveAt !== undefined && now >= adaptiveAt && successes.size >= required) {
        // Freshly armed and already due (zero median at floor): the arming event is included.
        freeze("adaptive");
      }
      return true;
    },

    snapshot() {
      return frozen;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimers();
    },
  };
}
