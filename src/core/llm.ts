// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type { ModelRequest, OperationLogger } from "./contracts.js";
import {
  AttemptTimeoutError,
  callWithAbortTimeout,
  errMsg,
  isRetryableMessage,
  parseRetryAfterMs,
  throwIfAborted,
  withRetry,
} from "./util.js";

/** Transport adapters report error-bearing responses without importing host response types. */
export interface ModelAttemptResult<T> {
  value: T;
  error?: string;
}

export interface AttemptHints {
  retryAfterMs?: number;
}

/** Sole transport retry/timeout owner. Adapters must disable underlying SDK retries. */
export async function runModelWithPolicy<T>(
  attempt: (signal: AbortSignal | undefined, hints: AttemptHints) => Promise<ModelAttemptResult<T>>,
  request: Pick<ModelRequest, "model" | "signal" | "retry" | "timeoutMs" | "onRetryNotice">,
  logger: OperationLogger,
  testing?: { sleep?: (ms: number, signal?: AbortSignal) => Promise<void>; random?: () => number },
): Promise<T> {
  const { model, signal, retry, timeoutMs } = request;
  const label = `${model.provider}/${model.model}`;
  let timedOut = false;
  let hints: AttemptHints = {};
  const timeoutError = () =>
    new Error(
      `LLM call timed out (${label}) after ${timeoutMs}ms ` +
        `per attempt across ${retry?.attempts ?? 1} attempt(s). The provider may be rate limiting or overloaded.`,
    );
  let response: ModelAttemptResult<T>;
  try {
    response = await withRetry(
      async () => {
        timedOut = false;
        hints = {};
        try {
          const result = await callWithAbortTimeout(
            (attemptSignal) => attempt(attemptSignal, hints),
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
        if (signal?.aborted) return { retry: false };
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
