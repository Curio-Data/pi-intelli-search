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
  readonly onFreeze: (snapshot: PageDeadlineSnapshot) => void;
}

export interface PageDeadline {
  start(): void;
  /** True only when the event was recorded before freeze; not a success verdict. */
  terminal(pageId: string, nonemptySuccess: boolean): boolean;
  snapshot(): PageDeadlineSnapshot | undefined;
  dispose(): void;
}

/** `ceil(n * quorum)` on the decimal value, so 0.07 * 100 is 7, not 8. */
export function quorumCount(n: number, quorum: number): number {
  if (n === 0) return 0;
  const product = n * quorum;
  const nearest = Math.round(product);
  const count = Math.abs(product - nearest) <= Number.EPSILON * 16 * Math.max(1, n) ? nearest : Math.ceil(product);
  return Math.min(n, Math.max(1, count));
}

/** Ordinary median; an even count averages the central pair. */
export function medianMs(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError("median requires at least one value");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function validateOptions(options: PageDeadlineOptions): ResearchExecutionSettings["deadline"] {
  if (!options || typeof options !== "object") throw new TypeError("page deadline options must be an object");
  const { clock, candidateIds, onFreeze } = options;
  if (!clock || typeof clock.monotonicMs !== "function" || typeof clock.schedule !== "function")
    throw new TypeError("page deadline clock must provide monotonicMs and schedule");
  if (typeof onFreeze !== "function") throw new TypeError("page deadline onFreeze must be a function");
  if (!Array.isArray(candidateIds)) throw new TypeError("page deadline candidateIds must be an array");
  const seen = new Set<string>();
  for (const id of candidateIds) {
    if (typeof id !== "string" || id.length === 0)
      throw new TypeError("page deadline candidate identifiers must be nonempty strings");
    if (seen.has(id)) throw new RangeError(`duplicate page deadline candidate: ${id}`);
    seen.add(id);
  }
  return parseExecutionSettings({ deadline: options.policy }, "pageDeadline").deadline;
}

export function createPageDeadline(options: PageDeadlineOptions): PageDeadline {
  const policy = validateOptions(options);
  const { clock, onFreeze } = options;
  const order = Object.freeze([...options.candidateIds]);
  const index = new Map(order.map((id, position) => [id, position]));
  const n = order.length;
  const required = policy.enabled ? Math.min(policy.minSources, n) : 0;
  const quorum = policy.enabled ? quorumCount(n, policy.quorum) : n;

  const terminalAt = new Map<string, number>();
  const successes = new Set<string>();
  const unrecorded = new Set<string>();
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
    onFreeze(frozen);
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
      if (terminalAt.has(pageId) || unrecorded.has(pageId))
        throw new Error(`duplicate terminal event for page: ${pageId}`);
      if (!live()) {
        unrecorded.add(pageId);
        return false;
      }

      const now = clock.monotonicMs();
      // Equal-time scheduled cutoff wins, whatever order timer callbacks arrive in.
      const due = dueCutoff(now);
      if (due) {
        unrecorded.add(pageId);
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
