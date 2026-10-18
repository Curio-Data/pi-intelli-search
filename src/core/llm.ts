// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type {
  AttemptControl,
  ModelCallScope,
  OperationLogger,
  OperationServices,
  PolicyHooks,
  PolicyRequest,
} from "./contracts.js";
import { AdmissionError, runAdmittedAttempt } from "./execution-coordinator.js";
import {
  AttemptTimeoutError,
  callWithAbortTimeout,
  errMsg,
  isRetryableMessage,
  parseRetryAfterMs,
  throwIfAborted,
  withRetry,
} from "./util.js";

export type ModelServices = Pick<
  OperationServices,
  "operation" | "coordinator" | "ledger" | "clock"
>;

/** Adapters use the operation's authorities, never request-owned replacements. */
export function createPolicyHooks(
  services: ModelServices,
  scope: ModelCallScope,
  logger: OperationLogger,
  random: () => number,
): PolicyHooks {
  if (scope.operation !== services.operation || scope.ledger !== services.ledger)
    throw new TypeError("Model call scope must use the operation services lease and ledger");
  return { scope, coordinator: services.coordinator, clock: services.clock, logger, random };
}

/** Transport adapters report error-bearing responses without importing host response types. */
export interface ModelAttemptResult<T> {
  value: T;
  error?: string;
}

export interface AttemptHints {
  retryAfterMs?: number;
}

/** Sole transport retry/timeout owner. Adapters must disable underlying SDK retries. */
export function runModelWithPolicy<T>(
  attempt: (control: AttemptControl) => Promise<ModelAttemptResult<T>>,
  request: PolicyRequest,
  hooks: PolicyHooks,
): Promise<T>;
/** Preserved for utility/catalogue calls; registered inference uses scoped hooks. */
export function runModelWithPolicy<T>(
  attempt: (signal: AbortSignal | undefined, hints: AttemptHints) => Promise<ModelAttemptResult<T>>,
  request: PolicyRequest,
  logger: OperationLogger,
  testing?: { sleep?: (ms: number, signal?: AbortSignal) => Promise<void>; random?: () => number },
): Promise<T>;
export function runModelWithPolicy<T>(
  attempt:
    | ((control: AttemptControl) => Promise<ModelAttemptResult<T>>)
    | ((signal: AbortSignal | undefined, hints: AttemptHints) => Promise<ModelAttemptResult<T>>),
  request: PolicyRequest,
  hooksOrLogger: PolicyHooks | OperationLogger,
  testing?: { sleep?: (ms: number, signal?: AbortSignal) => Promise<void>; random?: () => number },
): Promise<T> {
  const hooks = "scope" in hooksOrLogger ? hooksOrLogger : undefined;
  const logger = hooks ? hooks.logger : (hooksOrLogger as OperationLogger);
  if (!hooks) {
    return runPolicy(attempt as LegacyAttempt<T>, request, logger, testing);
  }

  // Register the whole invocation before starting it. In particular, releasing
  // an attempt permit must not let settle() abandon an owned backoff wait.
  let start!: () => void;
  const task = new Promise<T>((resolve, reject) => {
    start = () => {
      runPolicy(
        attempt as ScopedAttempt<T>,
        request,
        logger,
        {
          sleep: (ms, signal) => hooks.clock.sleep(ms, signal),
          random: hooks.random,
        },
        hooks,
      ).then(resolve, reject);
    };
  });
  try {
    const tracked = hooks.scope.operation.track(task);
    start();
    return tracked;
  } catch (error) {
    // A closed lease cannot register work. Nothing (including a timer) started.
    return Promise.reject(error);
  }
}

type LegacyAttempt<T> = (
  signal: AbortSignal | undefined,
  hints: AttemptHints,
) => Promise<ModelAttemptResult<T>>;
type ScopedAttempt<T> = (control: AttemptControl) => Promise<ModelAttemptResult<T>>;

async function runPolicy<T>(
  attempt: LegacyAttempt<T> | ScopedAttempt<T>,
  request: PolicyRequest,
  logger: OperationLogger,
  testing?: { sleep?: (ms: number, signal?: AbortSignal) => Promise<void>; random?: () => number },
  hooks?: PolicyHooks,
): Promise<T> {
  const { model, retry, timeoutMs } = request;
  const signal = hooks
    ? request.signal
      ? AbortSignal.any([hooks.scope.operation.signal, request.signal])
      : hooks.scope.operation.signal
    : request.signal;
  const label = `${model.provider}/${model.model}`;
  let timedOut = false;
  let hints: AttemptHints = {};
  let admissionRejected = false;
  const timeoutError = () =>
    new Error(
      `LLM call timed out (${label}) after ${timeoutMs}ms ` +
        `per attempt across ${retry?.attempts ?? 1} attempt(s). The provider may be rate limiting or overloaded.`,
    );
  let response: ModelAttemptResult<T>;
  try {
    response = await withRetry(
      async (attemptNumber) => {
        timedOut = false;
        hints = {};
        if (hooks) {
          // Reacquire on every retry. The helper starts the timeout only after
          // dispatch and finishes the ledger/releases the permit before return.
          admissionRejected = true;
          const admitted = await runAdmittedAttempt(
            hooks,
            request,
            attemptNumber,
            attempt as ScopedAttempt<T>,
          );
          admissionRejected = false;
          timedOut = admitted.state === "timed-out";
          hints.retryAfterMs = admitted.retryAfterMs;
          if (admitted.state === "aborted") throw new DOMException("Aborted", "AbortError");
          if ("thrown" in admitted.outcome) throw admitted.outcome.thrown;
          return admitted.outcome;
        }
        try {
          const result = await callWithAbortTimeout(
            (attemptSignal) => (attempt as LegacyAttempt<T>)(attemptSignal, hints),
            timeoutMs,
            signal,
          );
          timedOut = result.timedOut;
          return result.value;
        } catch (error) {
          timedOut = error instanceof AttemptTimeoutError;
          throw error;
        }
      },
      (result, error) => {
        if (signal?.aborted || admissionRejected || error instanceof AdmissionError)
          return { retry: false };
        if (timedOut) return { retry: true };
        const message = error ? errMsg(error) : result?.error;
        return isRetryableMessage(message)
          ? { retry: true, retryAfterMs: parseRetryAfterMs(message) ?? hints.retryAfterMs }
          : { retry: false };
      },
      {
        attempts: retry?.attempts ?? 1,
        baseDelayMs: retry?.baseDelayMs ?? 1000,
        maxDelayMs: retry?.maxDelayMs ?? 20_000,
        signal,
        ...testing,
        onRetry: ({ attempt, delayMs, reason }) => {
          // Retry notices go to the caller's injected channel when present
          // (native tools wire it to stage progress); the logger fallback
          // suits stderr-based hosts such as the MCP server.
          const message =
            `${label}: ${timedOut ? "timeout" : reason} on attempt ${attempt}, ` +
            `retrying in ${Math.round(delayMs)}ms`;
          if (request.onRetryNotice) request.onRetryNotice(message);
          else logger.error(message);
        },
      },
    );
  } catch (error) {
    throwIfAborted(signal);
    if (timedOut) throw timeoutError();
    throw error;
  }
  throwIfAborted(signal);
  if (timedOut) throw timeoutError();
  if (response.error !== undefined)
    throw new Error(`LLM call failed (${label}): ${response.error}`);
  return response.value;
}
