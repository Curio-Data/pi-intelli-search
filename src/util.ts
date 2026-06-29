// src/util.ts — Shared utilities
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Create a properly-typed text content object for tool results.
 */
export function textContent(text: string): { type: "text"; text: string } {
  return { type: "text" as const, text };
}

/**
 * Get the pi agent directory path.
 * Respects PI_CODING_AGENT_DIR for isolated environments (e.g. E2E tests).
 */
export function getAgentDir(): string {
  if (process.env.PI_CODING_AGENT_DIR) {
    return process.env.PI_CODING_AGENT_DIR;
  }
  return join(homedir(), ".pi", "agent");
}

/**
 * Map over `items` running at most `concurrency` tasks concurrently.
 *
 * A bounded worker pool: each worker pulls the next index, runs `fn`, stores
 * the result by index (input order preserved), then fires `onSettled`. This
 * caps how many expensive operations (network fetches, LLM calls) run at once,
 * so a wide result set cannot launch dozens of simultaneous requests and trip
 * provider rate limits.
 *
 * Workers stop pulling new work once `signal` aborts: in-flight tasks finish
 * but no new ones start, and indices that never ran are left `undefined`.
 * `fn` is expected to handle its own errors and resolve to a result; a throw
 * propagates and rejects the returned promise (matching Promise.all).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  opts?: {
    signal?: AbortSignal;
    onSettled?: (item: T, index: number, result: R) => void;
  },
): Promise<Array<R | undefined>> {
  const results: Array<R | undefined> = new Array(items.length).fill(undefined);
  let nextIndex = 0;
  const limit = Math.max(1, Math.min(concurrency, items.length));

  const worker = async () => {
    while (nextIndex < items.length) {
      if (opts?.signal?.aborted) return;
      const index = nextIndex++;
      const result = await fn(items[index], index);
      results[index] = result;
      opts?.onSettled?.(items[index], index, result);
    }
  };

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

/**
 * Sleep for `ms`, rejecting with an AbortError if `signal` aborts first.
 * Clears the timer on abort so it never leaks.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Run `run` with a hard wall-clock timeout, returning whether the timeout
 * fired. A fresh AbortController is aborted after `timeoutMs`, combined with the
 * caller's `userSignal` (so Esc still cancels), and passed to `run`. Unlike an
 * HTTP-client request timeout, this bounds the *entire* operation — including a
 * stalled streaming body that has already returned 200 headers — provided `run`
 * honours the signal it is given.
 *
 * Returns `{ value, timedOut }`. `timedOut` is true only when our timer fired
 * (not when the user aborted). `timeoutMs <= 0`/undefined disables the timeout.
 */
export async function callWithAbortTimeout<T>(
  run: (signal: AbortSignal | undefined) => Promise<T>,
  timeoutMs: number | undefined,
  userSignal?: AbortSignal,
): Promise<{ value: T; timedOut: boolean }> {
  if (!timeoutMs || timeoutMs <= 0) {
    return { value: await run(userSignal), timedOut: false };
  }
  const ac = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ac.abort();
  }, timeoutMs);
  const signal = userSignal ? AbortSignal.any([userSignal, ac.signal]) : ac.signal;
  try {
    const value = await run(signal);
    return { value, timedOut };
  } finally {
    clearTimeout(timer);
  }
}

/** Decision returned by a {@link withRetry} classifier. */
export type RetryDecision =
  | { retry: true; retryAfterMs?: number }
  | { retry: false };

export interface RetryOptions {
  /** Total attempts including the first try (>= 1). */
  attempts: number;
  /** Backoff base in ms. */
  baseDelayMs: number;
  /** Per-attempt delay cap in ms (also clamps any Retry-After hint). */
  maxDelayMs: number;
  signal?: AbortSignal;
  /** Injectable for tests; defaults to {@link sleep}. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Injectable jitter source [0,1); defaults to Math.random. */
  random?: () => number;
  /** Observability hook fired before each backoff wait. */
  onRetry?: (info: { attempt: number; delayMs: number; reason: string }) => void;
}

/**
 * Run `fn` with bounded retries and full-jitter exponential backoff.
 *
 * After each attempt `classify(result, error)` decides whether to retry. A
 * resolved value is passed as `(result, undefined)` so a degraded success (e.g.
 * a pi-ai response with stopReason "error") can be retried without throwing; a
 * thrown error is passed as `(undefined, error)`.
 *
 * Backoff is `random() * min(maxDelayMs, baseDelayMs * 2**(attempt-1))`. A
 * `retryAfterMs` hint from the classifier acts as a floor, still clamped to
 * `maxDelayMs` so a hostile hint cannot stall the caller.
 *
 * On exhaustion the last resolved value is returned (so callers keep their own
 * error handling) or the last error is rethrown. Aborts short-circuit: a fired
 * signal stops further attempts and a sleep in progress rejects.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  classify: (result: T | undefined, error: unknown) => RetryDecision,
  opts: RetryOptions,
): Promise<T> {
  const sleepFn = opts.sleep ?? sleep;
  const rand = opts.random ?? Math.random;
  const attempts = Math.max(1, opts.attempts);

  let lastResult: T | undefined;
  let lastError: unknown;
  let threw = false;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    threw = false;
    try {
      lastResult = await fn(attempt);
    } catch (err) {
      threw = true;
      lastError = err;
    }

    if (opts.signal?.aborted) break;

    const decision = classify(threw ? undefined : lastResult, threw ? lastError : undefined);
    if (!decision.retry || attempt === attempts) break;

    const exp = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** (attempt - 1));
    let delayMs = rand() * exp;
    if (decision.retryAfterMs != null) {
      delayMs = Math.min(Math.max(delayMs, decision.retryAfterMs), opts.maxDelayMs);
    }
    opts.onRetry?.({ attempt, delayMs, reason: threw ? "error" : "degraded" });
    await sleepFn(delayMs, opts.signal);
  }

  if (threw) throw lastError;
  return lastResult as T;
}

// Provider error text that indicates a transient, retryable condition. The
// OpenRouter path surfaces 429/5xx only as an errorMessage string (no status or
// headers post-hoc), so classification is necessarily text-based.
const RETRYABLE_RE =
  /\b(429|rate[ _-]?limited?|too many requests|overloaded|server error|service unavailable|temporarily unavailable|500|502|503|504|timed? ?out|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN)\b/i;

/** True when an error/message looks like a transient, retryable failure. */
export function isRetryableMessage(msg: string | undefined): boolean {
  return !!msg && RETRYABLE_RE.test(msg);
}

/**
 * Best-effort extraction of a Retry-After hint (in ms) from free-form provider
 * error text. Handles "retry after 3s", "retry-after: 12", "try again in 5
 * seconds" and explicit "500ms". Returns undefined when no numeric hint is
 * found, in which case callers fall back to jittered backoff.
 */
export function parseRetryAfterMs(msg: string | undefined): number | undefined {
  if (!msg) return undefined;
  const m =
    msg.match(/retry[\s-]?after[:\s]*?(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|seconds)?/i) ??
    msg.match(/(?:try again|retry) in\s+(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|seconds)?/i);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return undefined;
  return /^ms$/i.test(m[2] ?? "") ? n : n * 1000;
}

/**
 * Run `fn` with `console.error` selectively muzzled.
 *
 * Some dependencies (notably _Defuddle_) print unrecoverable internal errors
 * to `console.error` from inside their own try/catch, then return a degraded
 * result instead of throwing. The log, including the full captured stack, is
 * noise that reaches the user's terminal even though the caller handles the
 * degradation. Swallowing those logs during the call keeps the experience
 * clean.
 *
 * Only logs whose first argument matches one of `muzzledTags` are swallowed
 * (matched by identity against Defuddle's `'Defuddle'` tag, so a plain string
 * like `'[pi-intelli-search]'` is never caught up). Everything else is passed
 * straight through to the real `console.error`, so unrelated errors during the
 * call window are still surfaced. `console.error` is always restored in a
 * `finally`, including on throw.
 *
 * Returns `{ value, muzzled }`. `muzzled` is true when at least one matching
 * log was swallowed, which lets the caller detect the degraded path and route
 * to its own fallback instead of consuming the dependency's degraded output.
 */
export async function withMuzzledConsole<T>(
  fn: () => Promise<T>,
  muzzledTags: ReadonlyArray<unknown>,
): Promise<{ value: T; muzzled: boolean }> {
  if (muzzledTags.length === 0) {
    return { value: await fn(), muzzled: false };
  }
  const original = console.error;
  let muzzled = false;
  try {
    console.error = (...args: unknown[]) => {
      if (muzzledTags.includes(args[0])) {
        muzzled = true;
        return;
      }
      original(...args);
    };
    const value = await fn();
    return { value, muzzled };
  } finally {
    console.error = original;
  }
}

/**
 * Create a minimum-interval gate. Each call to the returned function resolves
 * no sooner than `minIntervalMs` after the previous call started, spacing out
 * otherwise-concurrent requests (e.g. the extract fan-out). `minIntervalMs <= 0`
 * makes the gate a no-op. The gate is abortable via the passed signal.
 */
export function createRateLimiter(
  minIntervalMs: number,
): (signal?: AbortSignal) => Promise<void> {
  let next = 0;
  return async (signal?: AbortSignal) => {
    if (minIntervalMs <= 0) return;
    const now = Date.now();
    const wait = Math.max(0, next - now);
    next = Math.max(now, next) + minIntervalMs;
    if (wait > 0) await sleep(wait, signal);
  };
}

/**
 * Extract source URLs from LLM-generated markdown text.
 * Parses markdown link format: [title](url)
 */
export function extractSourceUrls(text: string): Array<{ url: string; title: string }> {
  const urls: Array<{ url: string; title: string }> = [];
  // Match markdown links [title](url). The URL body allows balanced
  // single-level parentheses so links to pages like Wikipedia disambiguation
  // (`Foo_(disambiguation)`) or MSDN (`...format(v=net-8.0)`) keep their
  // closing paren instead of being truncated at the first `)`. URLs never
  // contain whitespace, so a space ends the match.
  const linkPattern = /\[([^\]]*)\]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))*)\)/g;
  let match;
  while ((match = linkPattern.exec(text)) !== null) {
    const url = match[2];
    if (!urls.some((u) => u.url === url)) {
      urls.push({ url, title: match[1] });
    }
  }
  return urls;
}

/**
 * Infer source type from the first line of an LLM extraction.
 */
export function inferSourceType(line: string): string {
  const lower = line.toLowerCase();
  if (lower.includes("official doc")) return "official docs";
  if (lower.includes("api reference")) return "API reference";
  if (lower.includes("tutorial")) return "tutorial";
  if (lower.includes("blog")) return "blog post";
  if (lower.includes("forum") || lower.includes("stackoverflow")) return "forum";
  return "unknown";
}

/**
 * Infer how current a source appears from the first line of extraction.
 */
export function inferCurrentness(line: string): string {
  const lower = line.toLowerCase();
  if (lower.includes("current") || lower.includes("up to date")) return "current";
  if (lower.includes("outdated") || lower.includes("old")) return "possibly outdated";
  return "undated";
}
