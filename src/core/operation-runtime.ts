// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type {
  CoordinatorOptions,
  Diagnostic,
  ExecutionCoordinator,
  FetchClient,
  OperationLease,
  OperationServices,
  Progress,
  RunStore,
} from "./contracts.js";
import { AdmissionError, createExecutionCoordinator } from "./execution-coordinator.js";
import { createAttemptLedger } from "./usage.js";

/** Factories are operation-local. No persistence implementation is selected here. */
export interface OperationRuntimeOptions extends CoordinatorOptions {
  readonly createFetch: (operation: OperationLease) => FetchClient;
  readonly createRuns: (operation: OperationLease) => RunStore;
}

export interface OperationInvocation {
  readonly operationId: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (event: Progress) => void;
  /** Operation-owned UI-safe diagnostic sink, also usable during generation close. */
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void;
}

export interface OperationRuntime {
  readonly generation: number;
  readonly coordinator: ExecutionCoordinator;
  /** The body owns the complete stage chain, including late drain/finalisation. */
  run<T>(
    invocation: OperationInvocation,
    execute: (services: OperationServices) => Promise<T>,
  ): Promise<T>;
  /** Synchronously stops admissions; resolves only after operation-owned cleanup. */
  close(reason?: string): Promise<void>;
}

/**
 * One adapter generation, with one coordinator/clock and a fresh ledger/store per
 * operation. Construction starts no task, timer, transport or persistence work.
 */
export function createOperationRuntime(options: OperationRuntimeOptions): OperationRuntime {
  // Capture settings/factories now, not through the caller's mutable options later.
  const captured = { ...options };
  const coordinator = createExecutionCoordinator(captured);
  let closed = false;
  let closing: Promise<void> | undefined;

  return Object.freeze({
    generation: captured.generation,
    coordinator,
    async run<T>(
      invocation: OperationInvocation,
      execute: (services: OperationServices) => Promise<T>,
    ): Promise<T> {
      // begin precedes factories, preflight and all asynchronous operation work.
      const { operationId, signal, onProgress, onDiagnostic } = invocation;
      const operation = coordinator.begin(operationId, signal);
      let releaseParent!: () => void;
      const parent = new Promise<void>((resolve) => {
        releaseParent = resolve;
      });
      operation.track(parent);
      let runs: RunStore | undefined;
      let delivering = true;
      let failed = false;
      const abortFailure = () => operationAbort(signal?.aborted ? signal : operation.signal);
      const canDeliver = () => !closed && !coordinator.snapshot().closed && delivering;
      const diagnose = (code: string, error: unknown) => {
        // Diagnostics belong to the operation record, not a widget generation.
        // Adapters must provide a sink that remains safe during runtime close.
        if (!delivering) return;
        try {
          onDiagnostic?.({ code, message: error instanceof Error ? error.message : String(error) });
        } catch {
          // Diagnostic delivery cannot replace an operation result either.
        }
      };
      try {
        const ledger = createAttemptLedger();
        // Capture the store before the other factory so a later factory failure
        // still awaits its cleanup. Factories must not start detached work.
        runs = memoizedSettlement(captured.createRuns(operation));
        const services: OperationServices = Object.freeze({
          operation,
          coordinator,
          ledger,
          clock: captured.clock,
          runs,
          fetch: captured.createFetch(operation),
          ...(onProgress
            ? {
                onProgress: (event: Progress) => {
                  if (!canDeliver() || event.operationId !== operation.id) return;
                  try {
                    onProgress(event);
                  } catch (error) {
                    diagnose("PROGRESS_DELIVERY_FAILED", error);
                  }
                },
              }
            : {}),
        });
        if (operation.signal.aborted) throw abortFailure();
        const result = await execute(services);
        if (operation.signal.aborted) throw abortFailure();
        return result;
      } catch (error) {
        failed = true;
        operation.abort("Operation failed");
        throw error;
      } finally {
        // The parent keeps close()/settle() from deregistering the lease between
        // stages or while filesystem cleanup is in progress. Never race a timeout
        // against cleanup: an uncooperative dependency blocks replacement.
        try {
          await runs?.settle();
        } catch (error) {
          diagnose("OPERATION_CLEANUP_FAILED", error);
          const primaryFailed = failed;
          failed = true;
          operation.abort("Operation cleanup failed");
          // Preserve the original failure object, including future partial data.
          if (!primaryFailed) throw error;
        } finally {
          releaseParent();
          await operation.settle();
          delivering = false;
          // A throw here deliberately replaces a pending success return when
          // cancellation arrived during cleanup, but never hides a body failure.
          if (!failed && operation.signal.aborted) throw abortFailure();
        }
      }
    },
    close(reason?: string) {
      if (!closing) {
        closed = true;
        closing = coordinator.close(reason);
      }
      return closing;
    },
  });
}

/** Public operations may settle their writers before the outer lifetime drains.
 * Reuse that settlement unless new store work starts; never cache across waves.
 */
function memoizedSettlement(store: RunStore): RunStore {
  let settled: Promise<void> | undefined;
  return {
    allocate(input) {
      settled = undefined;
      return store.allocate(input);
    },
    commit(reservation, artifacts, signal) {
      settled = undefined;
      return store.commit(reservation, artifacts, signal);
    },
    updateIndex(run, query, signal) {
      settled = undefined;
      return store.updateIndex(run, query, signal);
    },
    recordAccounting(run, records, summary, signal) {
      settled = undefined;
      return store.recordAccounting(run, records, summary, signal);
    },
    candidates(current, query, signal) {
      settled = undefined;
      return store.candidates(current, query, signal);
    },
    settle() {
      return (settled ??= Promise.resolve().then(() => store.settle()));
    },
  };
}

export interface RuntimeGenerations {
  /**
   * Stops the captured old generation immediately. New calls wait through the
   * complete replacement chain, with their own cancellation signal.
   */
  replace(options: OperationRuntimeOptions): Promise<OperationRuntime>;
  run<T>(
    invocation: OperationInvocation,
    execute: (services: OperationServices) => Promise<T>,
  ): Promise<T>;
  /** Terminal factory/process disposal, not a captured session-shutdown hook. */
  close(reason?: string): Promise<void>;
}

/** Native factories own this gate in a closure; MCP can own one runtime directly. */
export function createRuntimeGenerations(): RuntimeGenerations {
  let current: OperationRuntime | undefined;
  let gate: GenerationGate | undefined;
  let lastGeneration = -1;
  let requested = 0;
  let terminal = false;
  let closing: Promise<void> | undefined;

  return Object.freeze({
    replace(options: OperationRuntimeOptions) {
      if (terminal)
        return handledRejection(new AdmissionError("CLOSED", "Runtime factory disposed"));
      if (!Number.isSafeInteger(options.generation) || options.generation <= lastGeneration)
        return handledRejection(new RangeError("Runtime generations must increase monotonically"));
      const captured = { ...options };
      const request = ++requested;
      lastGeneration = captured.generation;
      // close() stops admission synchronously, including when an earlier queued
      // replacement has not yet completed. Observe rejection through the gate.
      const stopped = current?.close("Runtime replaced");
      const previous = gate;
      const pending = (async () => {
        // A failed initial construction is recoverable. A failed close is not:
        // never enable a successor without proof that the predecessor drained.
        if (previous) await previous.promise.catch(() => undefined);
        await stopped;
        await current?.close("Runtime replaced");
        if (terminal) throw new AdmissionError("CLOSED", "Runtime factory disposed");
        current = createOperationRuntime(captured);
        // A queued, superseded generation is never enabled, even for callers
        // holding its lifecycle handle rather than using the latest-call gate.
        if (request !== requested) await current.close("Superseded runtime generation");
        return current;
      })();
      gate = makeGenerationGate(pending);
      return pending;
    },
    async run<T>(
      invocation: OperationInvocation,
      execute: (services: OperationServices) => Promise<T>,
    ): Promise<T> {
      invocation = { ...invocation };
      for (;;) {
        if (terminal) throw new AdmissionError("CLOSED", "Runtime factory disposed");
        const observed = gate;
        if (!observed) throw new AdmissionError("CLOSED", "No runtime generation is enabled");
        let runtime: OperationRuntime;
        try {
          runtime = await waitForGeneration(observed, invocation.signal);
        } catch (error) {
          if (invocation.signal?.aborted) throw operationAbort(invocation.signal);
          if (observed !== gate) continue;
          throw error;
        }
        // Another replacement may have been requested during the await. Its gate
        // owns admission now, even when the superseded construction failed.
        if (observed !== gate) continue;
        if (invocation.signal?.aborted) throw operationAbort(invocation.signal);
        if (terminal) throw new AdmissionError("CLOSED", "Runtime factory disposed");
        return runtime.run(invocation, execute);
      }
    },
    close(reason?: string) {
      if (!closing) {
        terminal = true;
        const stopped = current?.close(reason);
        closing = (async () => {
          await stopped;
          await gate?.promise.catch(() => undefined);
          await current?.close(reason);
        })();
      }
      return closing;
    },
  });
}

type GenerationOutcome = { readonly runtime: OperationRuntime } | { readonly error: unknown };
interface GenerationGate {
  readonly promise: Promise<OperationRuntime>;
  readonly waiters: Set<(outcome: GenerationOutcome) => void>;
  outcome?: GenerationOutcome;
}

function makeGenerationGate(promise: Promise<OperationRuntime>): GenerationGate {
  const gate: GenerationGate = { promise, waiters: new Set() };
  const finish = (outcome: GenerationOutcome) => {
    gate.outcome = outcome;
    const waiters = [...gate.waiters];
    gate.waiters.clear();
    for (const waiter of waiters) waiter(outcome);
  };
  // One runtime-owned handler, not one irrevocable promise reaction per caller.
  void promise.then(
    (runtime) => finish({ runtime }),
    (error: unknown) => finish({ error }),
  );
  return gate;
}

/** A cancelled waiter removes both its listener and callback from shared drain. */
function waitForGeneration(gate: GenerationGate, signal?: AbortSignal): Promise<OperationRuntime> {
  if (signal?.aborted) return Promise.reject(operationAbort(signal));
  return new Promise((resolve, reject) => {
    const finish = (outcome: GenerationOutcome) => {
      gate.waiters.delete(finish);
      signal?.removeEventListener("abort", onAbort);
      if ("error" in outcome) reject(outcome.error);
      else resolve(outcome.runtime);
    };
    const onAbort = () => finish({ error: operationAbort(signal!) });
    if (gate.outcome) finish(gate.outcome);
    else {
      gate.waiters.add(finish);
      signal?.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function handledRejection(error: Error): Promise<never> {
  const rejected = Promise.reject<never>(error);
  void rejected.catch(() => {});
  return rejected;
}

function operationAbort(signal: AbortSignal): AdmissionError {
  const reason: unknown = signal.reason;
  const message =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : "Operation aborted";
  const error = new AdmissionError("ABORTED", message);
  error.cause = reason;
  return error;
}
