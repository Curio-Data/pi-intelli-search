// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Runtime-scoped admission for model attempts and physical fetch chains (C09-C13).
// One instance per adapter runtime; no module state is shared between instances.
import type {
  AdmissionError as AdmissionErrorShape,
  AdmissionTicket,
  AttemptControl,
  AttemptIdentity,
  AttemptRecord,
  CoordinatorOptions,
  CoordinatorSnapshot,
  ExecutionCoordinator,
  FetchScope,
  ModelRole,
  OperationLease,
  Permit,
  PolicyHooks,
  PolicyRequest,
  UsageObservation,
} from "./contracts.js";

export type AdmissionCode = AdmissionErrorShape["code"];

/** Admission rejection. Never a retryable transport failure. */
export class AdmissionError extends Error implements AdmissionErrorShape {
  readonly code: AdmissionCode;
  constructor(code: AdmissionCode, message?: string) {
    super(message ?? `Admission rejected: ${code}`);
    this.name = "AdmissionError";
    this.code = code;
  }
}

/** Hard bounded-ownership ceilings (C10); not throughput settings. */
export const COORDINATOR_LIMITS = Object.freeze({
  maxOperations: 64,
  maxQueuedModels: 512,
  maxQueuedPageModels: 448,
  maxQueuedFetches: 512,
  maxIdentifierBytes: 128,
});

/** Permit with the grant order recorded for fairness evidence (C12). */
export interface CoordinatedPermit extends Permit {
  readonly operationId: string;
  readonly kind: AdmissionTicket["kind"];
  readonly pageId?: string;
  /** Runtime-wide grant order, shared by model and fetch permits. */
  readonly sequence: number;
}

/** Role `extract` is always page-class admission, with or without a page ID (C11). */
export function admissionKind(role: ModelRole): "critical" | "page" {
  return role === "extract" ? "page" : "critical";
}

/** Page attempts may use every slot except the critical reserve (C12). */
export function effectivePageConcurrency(perRunLimit: number, options: Pick<CoordinatorOptions, "modelConcurrency" | "criticalReserve">): number {
  return Math.max(0, Math.min(perRunLimit, options.modelConcurrency - options.criticalReserve));
}

const encoder = new TextEncoder();

/** Operation and call identifiers are generated, bounded, control-free values (C10). */
export function validateIdentifier(value: unknown, label = "identifier"): string {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${label} must be a nonempty string`);
  // C0, DEL and C1 controls, plus line/paragraph separators.
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029)
      throw new TypeError(`${label} contains control characters`);
  }
  if (encoder.encode(value).byteLength > COORDINATOR_LIMITS.maxIdentifierBytes)
    throw new TypeError(`${label} exceeds ${COORDINATOR_LIMITS.maxIdentifierBytes} encoded bytes`);
  return value;
}

function integerIn(value: number, min: number, max: number, label: string): void {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${label} must be an integer in [${min}, ${max}]`);
}

interface Ticket {
  readonly operation: LeaseState;
  readonly kind: AdmissionTicket["kind"];
  readonly pageId?: string;
  readonly signal: AbortSignal;
  readonly enqueuedAtMs: number;
  readonly scopeSignal?: AbortSignal;
  readonly resolve: (permit: CoordinatedPermit) => void;
  readonly reject: (error: AdmissionError) => void;
  readonly onAbort: () => void;
}

interface LeaseState {
  readonly id: string;
  readonly controller: AbortController;
  readonly cutoff: AbortController;
  readonly tasks: Set<Promise<unknown>>;
  readonly queued: Set<Ticket>;
  readonly lease: OperationLease;
  activePermits: number;
  cutoffApplied: boolean;
  deregistered: boolean;
  settling?: Promise<void>;
  removeExternal?: () => void;
  readonly changed: Set<() => void>;
}

/** Waiters of one admission class, served round-robin between operations (C12). */
class ClassQueue {
  private readonly byOperation = new Map<LeaseState, Ticket[]>();
  private readonly order: LeaseState[] = [];
  private next = 0;
  size = 0;

  push(ticket: Ticket): void {
    let list = this.byOperation.get(ticket.operation);
    if (!list) {
      list = [];
      this.byOperation.set(ticket.operation, list);
      this.order.push(ticket.operation);
    }
    list.push(ticket);
    this.size++;
  }

  /** Next ticket after the previously served operation. */
  shift(): Ticket | undefined {
    if (this.size === 0) return undefined;
    if (this.next >= this.order.length) this.next = 0;
    const operation = this.order[this.next];
    const list = this.byOperation.get(operation)!;
    const ticket = list.shift()!;
    this.size--;
    if (list.length === 0) this.drop(operation, this.next);
    else this.next++;
    return ticket;
  }

  remove(ticket: Ticket): boolean {
    const list = this.byOperation.get(ticket.operation);
    const index = list?.indexOf(ticket) ?? -1;
    if (!list || index < 0) return false;
    list.splice(index, 1);
    this.size--;
    if (list.length === 0) this.drop(ticket.operation, this.order.indexOf(ticket.operation));
    return true;
  }

  count(predicate: (ticket: Ticket) => boolean): number {
    let n = 0;
    for (const list of this.byOperation.values()) for (const ticket of list) if (predicate(ticket)) n++;
    return n;
  }

  tickets(): Ticket[] {
    return this.order.flatMap((operation) => [...this.byOperation.get(operation)!]);
  }

  private drop(operation: LeaseState, index: number): void {
    this.byOperation.delete(operation);
    this.order.splice(index, 1);
    // Keep the pointer on the operation that followed the removed one.
    if (index < this.next) this.next--;
  }
}

/** Creates a runtime-owned coordinator. Construction starts no timer or process. */
export function createExecutionCoordinator(options: CoordinatorOptions): ExecutionCoordinator {
  integerIn(options.modelConcurrency, 2, 64, "modelConcurrency");
  if (options.criticalReserve !== 1) throw new RangeError("criticalReserve must be exactly 1");
  integerIn(options.fetchConcurrency, 1, 32, "fetchConcurrency");
  if (!Number.isFinite(options.minRequestIntervalMs) || options.minRequestIntervalMs < 0)
    throw new RangeError("minRequestIntervalMs must be a finite non-negative number");
  if (!Number.isInteger(options.generation) || options.generation < 0)
    throw new RangeError("generation must be a non-negative integer");

  const { clock, modelConcurrency, fetchConcurrency, minRequestIntervalMs, generation } = options;
  const pageCapacity = modelConcurrency - options.criticalReserve;
  const leases = new Map<string, LeaseState>();
  const owned = new WeakMap<OperationLease, LeaseState>();
  const critical = new ClassQueue();
  const pages = new ClassQueue();
  const fetches: Ticket[] = [];
  let activeModels = 0;
  let activePages = 0;
  let activeFetches = 0;
  let sequence = 0;
  // Three critical opportunities, then one page opportunity, while both classes wait.
  let cycle = 0;
  let nextModelStartMs = Number.NEGATIVE_INFINITY;
  let cancelPacing: (() => void) | undefined;
  let closed = false;
  let closing: Promise<void> | undefined;

  function changed(state: LeaseState): void {
    for (const notify of [...state.changed]) notify();
  }

  function drained(state: LeaseState): boolean {
    return state.tasks.size === 0 && state.queued.size === 0 && state.activePermits === 0;
  }

  async function whenDrained(state: LeaseState): Promise<void> {
    while (!drained(state)) {
      await new Promise<void>((resolve) => {
        const notify = () => {
          state.changed.delete(notify);
          resolve();
        };
        state.changed.add(notify);
      });
    }
  }

  function deregister(state: LeaseState): void {
    if (state.deregistered) return;
    state.deregistered = true;
    state.removeExternal?.();
    state.removeExternal = undefined;
    leases.delete(state.id);
  }

  function dequeue(ticket: Ticket): void {
    ticket.signal.removeEventListener("abort", ticket.onAbort);
    ticket.operation.queued.delete(ticket);
  }

  function rejectTicket(ticket: Ticket, error: AdmissionError): void {
    const removed = ticket.kind === "fetch"
      ? removeFetch(ticket)
      : ticket.kind === "page" ? pages.remove(ticket) : critical.remove(ticket);
    if (!removed) return;
    dequeue(ticket);
    ticket.reject(error);
    changed(ticket.operation);
  }

  function removeFetch(ticket: Ticket): boolean {
    const index = fetches.indexOf(ticket);
    if (index < 0) return false;
    fetches.splice(index, 1);
    return true;
  }

  function grant(ticket: Ticket, signal: AbortSignal): CoordinatedPermit {
    dequeue(ticket);
    const state = ticket.operation;
    state.activePermits++;
    const grantedAtMs = clock.monotonicMs();
    let released = false;
    const kind = ticket.kind;
    const permit: CoordinatedPermit = {
      operationId: state.id,
      kind,
      ...(ticket.pageId !== undefined ? { pageId: ticket.pageId } : {}),
      sequence: ++sequence,
      signal,
      grantedAtMs,
      queueMs: grantedAtMs - ticket.enqueuedAtMs,
      release() {
        if (released) return;
        released = true;
        if (kind === "fetch") activeFetches--;
        else {
          activeModels--;
          if (kind === "page") activePages--;
        }
        state.activePermits--;
        pump();
        changed(state);
      },
    };
    return permit;
  }

  function modelSignal(ticket: Ticket): AbortSignal {
    // Page cutoff is deliberately absent: active extraction survives it (C09).
    return AbortSignal.any([ticket.signal, ticket.operation.controller.signal]);
  }

  function fetchSignal(ticket: Ticket): AbortSignal {
    const signals = [ticket.operation.controller.signal];
    if (ticket.scopeSignal) signals.push(ticket.scopeSignal);
    if (ticket.pageId !== undefined) signals.push(ticket.operation.cutoff.signal);
    return AbortSignal.any(signals);
  }

  function pumpFetches(): void {
    while (activeFetches < fetchConcurrency && fetches.length > 0) {
      const ticket = fetches.shift()!;
      activeFetches++;
      ticket.resolve(grant(ticket, fetchSignal(ticket)));
    }
  }

  function pumpModels(): void {
    for (;;) {
      const criticalReady = critical.size > 0 && activeModels < modelConcurrency;
      const pageReady = pages.size > 0 && activeModels < modelConcurrency && activePages < pageCapacity;
      if (!criticalReady && !pageReady) break;
      const now = clock.monotonicMs();
      if (now < nextModelStartMs) {
        // Only pending, admissible work holds a pacing timer (C13).
        if (!cancelPacing) {
          cancelPacing = clock.schedule(nextModelStartMs - now, () => {
            cancelPacing = undefined;
            pump();
          });
        }
        return;
      }
      let queue: ClassQueue;
      if (criticalReady && pageReady) {
        queue = cycle === 3 ? pages : critical;
        cycle = (cycle + 1) % 4;
      } else {
        // A lone eligible class does not bank priority for later.
        queue = criticalReady ? critical : pages;
      }
      const ticket = queue.shift()!;
      cancelPacing?.();
      cancelPacing = undefined;
      activeModels++;
      if (ticket.kind === "page") activePages++;
      // Spacing advances only at an actual dispatch (C13).
      if (minRequestIntervalMs > 0) nextModelStartMs = now + minRequestIntervalMs;
      ticket.resolve(grant(ticket, modelSignal(ticket)));
    }
    clearPacingIfIdle();
  }

  function clearPacingIfIdle(): void {
    if (!cancelPacing) return;
    const admissible =
      (critical.size > 0 && activeModels < modelConcurrency) ||
      (pages.size > 0 && activeModels < modelConcurrency && activePages < pageCapacity);
    if (admissible) return;
    cancelPacing();
    cancelPacing = undefined;
  }

  function pump(): void {
    if (closed) return;
    pumpFetches();
    pumpModels();
  }

  function enqueue(
    state: LeaseState,
    kind: AdmissionTicket["kind"],
    signal: AbortSignal,
    pageId: string | undefined,
    scopeSignal?: AbortSignal,
  ): Promise<CoordinatedPermit> {
    if (closed) return Promise.reject(new AdmissionError("CLOSED", "Coordinator is closed"));
    if (state.deregistered) return Promise.reject(new AdmissionError("CLOSED", `Operation ${state.id} has settled`));
    if (state.controller.signal.aborted || signal.aborted || scopeSignal?.aborted)
      return Promise.reject(new AdmissionError("ABORTED", `Operation ${state.id} was aborted`));
    const pageWork = kind === "page" || (kind === "fetch" && pageId !== undefined);
    if (pageWork && state.cutoffApplied)
      return Promise.reject(new AdmissionError("PAGE_CUTOFF", `Page work for ${state.id} is cut off`));
    if (kind === "fetch") {
      if (fetches.length >= COORDINATOR_LIMITS.maxQueuedFetches)
        return Promise.reject(new AdmissionError("BUSY", "Fetch admission queue is full"));
    } else {
      const queuedModels = critical.size + pages.size;
      const full = queuedModels >= COORDINATOR_LIMITS.maxQueuedModels ||
        (kind === "page" && pages.size >= COORDINATOR_LIMITS.maxQueuedPageModels);
      if (full) return Promise.reject(new AdmissionError("BUSY", "Model admission queue is full"));
    }
    return new Promise<CoordinatedPermit>((resolve, reject) => {
      const ticket: Ticket = {
        operation: state,
        kind,
        ...(pageId !== undefined ? { pageId } : {}),
        signal,
        enqueuedAtMs: clock.monotonicMs(),
        ...(scopeSignal ? { scopeSignal } : {}),
        resolve,
        reject,
        onAbort: () => {
          rejectTicket(ticket, new AdmissionError("ABORTED", `Admission for ${state.id} was cancelled`));
          clearPacingIfIdle();
        },
      };
      signal.addEventListener("abort", ticket.onAbort, { once: true });
      state.queued.add(ticket);
      if (kind === "fetch") fetches.push(ticket);
      else (kind === "page" ? pages : critical).push(ticket);
      pump();
    });
  }

  function rejectQueued(state: LeaseState, error: AdmissionError, predicate: (ticket: Ticket) => boolean = () => true): void {
    for (const ticket of [...state.queued]) if (predicate(ticket)) rejectTicket(ticket, error);
    clearPacingIfIdle();
  }

  function begin(operationId: string, signal?: AbortSignal): OperationLease {
    validateIdentifier(operationId, "operationId");
    if (closed) throw new AdmissionError("CLOSED", "Coordinator is closed");
    if (signal?.aborted) throw new AdmissionError("ABORTED", `Operation ${operationId} was aborted before admission`);
    if (leases.has(operationId)) throw new TypeError(`Operation ${operationId} is already active`);
    if (leases.size >= COORDINATOR_LIMITS.maxOperations)
      throw new AdmissionError("BUSY", `At most ${COORDINATOR_LIMITS.maxOperations} operations may be active`);

    const controller = new AbortController();
    const cutoff = new AbortController();
    const state: LeaseState = {
      id: operationId,
      controller,
      cutoff,
      tasks: new Set(),
      queued: new Set(),
      activePermits: 0,
      cutoffApplied: false,
      deregistered: false,
      changed: new Set(),
      lease: undefined as unknown as OperationLease,
    };

    const abort = (reason?: string) => {
      if (controller.signal.aborted) return;
      const error = new AdmissionError("ABORTED", reason ?? `Operation ${operationId} was aborted`);
      controller.abort(error);
      rejectQueued(state, error);
    };

    const lease: OperationLease = {
      id: operationId,
      generation,
      signal: controller.signal,
      acquireFetch(scope?: FetchScope) {
        try {
          if (scope?.pageId !== undefined) validateIdentifier(scope.pageId, "pageId");
        } catch (error) {
          return Promise.reject(error);
        }
        // A queued ticket also leaves the queue when its own scope (for example discovery) is cancelled.
        const waitSignal = scope?.signal ? AbortSignal.any([controller.signal, scope.signal]) : controller.signal;
        return enqueue(state, "fetch", waitSignal, scope?.pageId, scope?.signal);
      },
      cutoffPages() {
        if (state.cutoffApplied) return;
        state.cutoffApplied = true;
        const error = new AdmissionError("PAGE_CUTOFF", `Page work for ${operationId} is cut off`);
        rejectQueued(state, error, (ticket) => ticket.kind === "page" || (ticket.kind === "fetch" && ticket.pageId !== undefined));
        cutoff.abort(error);
      },
      track<T>(task: Promise<T>): Promise<T> {
        if (state.deregistered) throw new AdmissionError("CLOSED", `Operation ${operationId} has settled`);
        state.tasks.add(task);
        const done = () => {
          state.tasks.delete(task);
          changed(state);
        };
        task.then(done, done);
        return task;
      },
      abort,
      settle() {
        state.settling ??= whenDrained(state).then(() => deregister(state));
        return state.settling;
      },
    };
    Object.assign(state, { lease });

    if (signal) {
      const onExternal = () => abort("Operation signal aborted");
      signal.addEventListener("abort", onExternal, { once: true });
      state.removeExternal = () => signal.removeEventListener("abort", onExternal);
    }
    leases.set(operationId, state);
    owned.set(lease, state);
    return lease;
  }

  function stateOf(operationId: string): LeaseState | undefined {
    return leases.get(operationId);
  }

  const coordinator: ExecutionCoordinator & { owns(lease: OperationLease): boolean } = {
    begin,
    acquireModel(ticket) {
      if (ticket.kind !== "critical" && ticket.kind !== "page")
        return Promise.reject(new TypeError("Model tickets must be critical or page"));
      try {
        if (ticket.pageId !== undefined) validateIdentifier(ticket.pageId, "pageId");
      } catch (error) {
        return Promise.reject(error);
      }
      const state = stateOf(ticket.operationId);
      if (closed) return Promise.reject(new AdmissionError("CLOSED", "Coordinator is closed"));
      if (!state) return Promise.reject(new AdmissionError("CLOSED", `Operation ${ticket.operationId} is not active in this coordinator`));
      return enqueue(state, ticket.kind, ticket.signal, ticket.pageId);
    },
    snapshot(): CoordinatorSnapshot {
      return {
        activeModels,
        activePages,
        activeFetches,
        queuedModels: critical.size + pages.size,
        queuedFetches: fetches.length,
        activeOperations: leases.size,
        closed,
      };
    },
    close(reason?: string) {
      if (closing) return closing;
      closed = true;
      cancelPacing?.();
      cancelPacing = undefined;
      const error = new AdmissionError("CLOSED", reason ?? "Coordinator closed");
      const states = [...leases.values()];
      for (const state of states) {
        rejectQueued(state, error);
        if (!state.controller.signal.aborted) state.controller.abort(error);
      }
      closing = Promise.all(states.map((state) => whenDrained(state).then(() => deregister(state)))).then(() => {});
      return closing;
    },
    owns(lease: OperationLease) {
      const state = owned.get(lease);
      return state !== undefined && !state.deregistered && leases.get(state.id) === state;
    },
  };
  return coordinator;
}

function ownsLease(coordinator: ExecutionCoordinator, lease: OperationLease): boolean {
  const owns = (coordinator as { owns?: (lease: OperationLease) => boolean }).owns;
  return typeof owns === "function" && owns(lease);
}

export interface AdmittedAttemptResult<T> {
  readonly state: AttemptRecord["state"];
  readonly identity: AttemptIdentity;
  readonly queueMs: number;
  readonly retryAfterMs?: number;
  readonly outcome: { readonly value: T; readonly error?: string } | { readonly thrown: unknown };
}

/**
 * Runs one transport attempt under admission, for use by the sole policy retry
 * owner (C11). The permit is released and the ledger record finished before this
 * resolves, so backoff never holds a permit. The attempt timeout starts at dispatch.
 */
export async function runAdmittedAttempt<T>(
  hooks: PolicyHooks,
  request: PolicyRequest,
  attempt: number,
  run: (control: AttemptControl) => Promise<{ readonly value: T; readonly error?: string }>,
): Promise<AdmittedAttemptResult<T>> {
  const { scope, coordinator, clock } = hooks;
  const lease = scope.operation;
  if (!ownsLease(coordinator, lease)) throw new TypeError("Model call scope does not belong to this coordinator");
  validateIdentifier(scope.callId, "callId");
  if (!Number.isInteger(attempt) || attempt < 1) throw new RangeError("attempt must be a positive integer");
  const waitSignal = request.signal ? AbortSignal.any([request.signal, lease.signal]) : lease.signal;
  const permit = await coordinator.acquireModel({
    operationId: lease.id,
    kind: admissionKind(scope.role),
    signal: waitSignal,
    ...(scope.pageId !== undefined ? { pageId: scope.pageId } : {}),
  });
  const identity: AttemptIdentity = {
    operationId: lease.id,
    callId: scope.callId,
    attempt,
    model: { provider: request.model.provider, model: request.model.model },
    role: scope.role,
    ...(scope.pageId !== undefined ? { pageId: scope.pageId } : {}),
  };
  const timeout = new AbortController();
  let timedOut = false;
  let cancelTimer: (() => void) | undefined;
  try {
    scope.ledger.start(identity, permit.grantedAtMs, permit.queueMs);
    if (request.timeoutMs !== undefined && request.timeoutMs > 0) {
      cancelTimer = clock.schedule(request.timeoutMs, () => {
        timedOut = true;
        timeout.abort(new Error("Model attempt timed out"));
      });
    }
    const signals = [permit.signal, timeout.signal];
    if (request.signal) signals.push(request.signal);
    const control: AttemptControl = {
      identity,
      signal: AbortSignal.any(signals),
      observe(observation: UsageObservation) {
        scope.ledger.observe(identity, observation);
      },
    };
    let outcome: AdmittedAttemptResult<T>["outcome"];
    try {
      outcome = await run(control);
    } catch (thrown) {
      outcome = { thrown };
    }
    cancelTimer?.();
    cancelTimer = undefined;
    const cancelled = permit.signal.aborted || request.signal?.aborted === true;
    const state: AttemptRecord["state"] = cancelled
      ? "aborted"
      : timedOut
        ? "timed-out"
        : "thrown" in outcome || outcome.error !== undefined ? "failed" : "succeeded";
    scope.ledger.finish(identity, state, clock.monotonicMs());
    return {
      state,
      identity,
      queueMs: permit.queueMs,
      ...(control.retryAfterMs !== undefined ? { retryAfterMs: control.retryAfterMs } : {}),
      outcome,
    };
  } finally {
    cancelTimer?.();
    permit.release();
  }
}
