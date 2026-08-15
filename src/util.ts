// src/util.ts — Shared utilities
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Create a properly-typed text content object for tool results.
 */
export function textContent(text: string): { type: "text"; text: string } {
  return { type: "text" as const, text };
}

/** Extract a human-readable message from an unknown thrown value. */
export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Log a non-fatal pipeline diagnostic with the extension prefix. When `err`
 * is given it is passed through as a second console argument (preserving the
 * stack), matching the previous inline call sites.
 */
export function logErr(msg: string, err?: unknown): void {
  if (err !== undefined) console.error(`[pi-intelli-search] ${msg}`, err);
  else console.error(`[pi-intelli-search] ${msg}`);
}

/** Unified marker appended whenever page content is truncated to a char cap. */
export const TRUNCATED_MARKER = "\n\n[TRUNCATED]";

/** Truncate `content` to `maxChars`, appending the unified truncation marker. */
export function truncateContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + TRUNCATED_MARKER;
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
export type RetryDecision = { retry: true; retryAfterMs?: number } | { retry: false };

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
 * Run `fn` with `console.error` and `console.warn` selectively muzzled.
 *
 * Some dependencies (notably _Defuddle_) print unrecoverable internal errors
 * to `console.error` from inside their own try/catch, then return a degraded
 * result instead of throwing. The log, including the full captured stack, is
 * noise that reaches the user's terminal even though the caller handles the
 * degradation. Swallowing those logs during the call keeps the experience
 * clean.
 *
 * Defuddle also logs fully benign warnings via `console.warn` (for example
 * `'Failed to parse URL:'` when its metadata extractor joins duplicate
 * schema.org `url` values into an invalid composite). These carry the full
 * stack too and are pure noise: the caller recovers nothing because nothing
 * is wrong. They are muzzled through the separate `warn` channel.
 *
 * Only logs whose first argument matches one of the channel's tags are
 * swallowed (matched by identity against Defuddle's tags, so a plain string
 * like `'[pi-intelli-search]'` is never caught up). Everything else is passed
 * straight through to the real console method, so unrelated output during the
 * call window is still surfaced. Both console methods are always restored in
 * a `finally`, including on throw.
 *
 * Returns `{ value, muzzled, warned }`. `muzzled` is true when at least one
 * matching `console.error` log was swallowed, which lets the caller detect
 * the degraded path and route to its own fallback instead of consuming the
 * dependency's degraded output. `warned` is true when a matching
 * `console.warn` log was swallowed; it is informational only and must not
 * drive fallback behaviour, because the warn channel is benign.
 */
export async function withMuzzledConsole<T>(
  fn: () => Promise<T>,
  muzzleTags: {
    error?: ReadonlyArray<unknown>;
    warn?: ReadonlyArray<unknown>;
  },
): Promise<{ value: T; muzzled: boolean; warned: boolean }> {
  const errorTags = muzzleTags.error ?? [];
  const warnTags = muzzleTags.warn ?? [];
  if (errorTags.length === 0 && warnTags.length === 0) {
    return { value: await fn(), muzzled: false, warned: false };
  }
  const originalError = console.error;
  const originalWarn = console.warn;
  let muzzled = false;
  let warned = false;
  try {
    if (errorTags.length > 0) {
      console.error = (...args: unknown[]) => {
        if (errorTags.includes(args[0])) {
          muzzled = true;
          return;
        }
        originalError(...args);
      };
    }
    if (warnTags.length > 0) {
      console.warn = (...args: unknown[]) => {
        if (warnTags.includes(args[0])) {
          warned = true;
          return;
        }
        originalWarn(...args);
      };
    }
    const value = await fn();
    return { value, muzzled, warned };
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }
}

/**
 * Create a minimum-interval gate. Each call to the returned function resolves
 * no sooner than `minIntervalMs` after the previous call started, spacing out
 * otherwise-concurrent requests (e.g. the extract fan-out). `minIntervalMs <= 0`
 * makes the gate a no-op. The gate is abortable via the passed signal.
 */
export function createRateLimiter(minIntervalMs: number): (signal?: AbortSignal) => Promise<void> {
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
 *
 * Two-pass extraction:
 * 1. Markdown links: `[title](url)` — the canonical format the search prompt
 *    requests. Handles balanced single-level parentheses in URLs (Wikipedia
 *    disambiguation, MSDN parameterised paths).
 * 2. Bare URLs: `https?://...` standing outside markdown link syntax. These
 *    appear when the search model returns synthesised prose with inline URLs
 *    (for example, `**https://fal.ai/models/...**`) instead of markdown
 *    links. The second pass skips URLs already captured by pass 1.
 * 3. Protocol-less domains: `github.com/owner/repo` and similar source
 *    references. A degraded search response may omit `https://` despite the
 *    citation instruction; normalise only domain-shaped text, never prose.
 *
 * In all passes, URLs never contain whitespace, so a space ends the match.
 */
export function extractSourceUrls(text: string): Array<{ url: string; title: string }> {
  const urls: Array<{ url: string; title: string }> = [];
  const seen = new Set<string>();

  // Pass 1: markdown links [title](url)
  const linkPattern = /\[([^\]]*)\]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))*)\)/g;
  for (const m of text.matchAll(linkPattern)) {
    const url = m[2];
    if (!seen.has(url)) {
      seen.add(url);
      urls.push({ url, title: m[1] });
    }
  }

  // Pass 2: bare https?:// URLs that were not already inside a markdown link.
  // This catches URLs embedded in bold, italics, inline code, bullet lists,
  // or plain prose — formats common in degraded search responses where the
  // model synthesises an answer without markdown citations.
  //
  // The regex matches a protocol://host[/path[?query][#fragment]] sequence.
  // It stops at whitespace and common delimiters (backtick, double quote,
  // angle brackets, braces, asterisks, parentheses). Underscores are
  // allowed (common in URL paths like `/Foo_bar`).
  // Balanced paren groups in URLs (Wikipedia `/Foo_(disambiguation)`, MSDN
  // `...format(v=net-8.0)`) are matched via the explicit balanced-paren
  // alternative, not via the general character class.
  const barePattern = /(https?:\/\/(?:[^\s<>"{}*()|\\^`\[\]]|\([^()\s]*\))+)/g;
  for (const m of text.matchAll(barePattern)) {
    // Strip trailing punctuation that is not part of the URL: period, comma,
    // semicolon, colon, or exclamation mark.
    const url = m[1].replace(/[.,;:!]+$/, "");
    if (!seen.has(url)) {
      seen.add(url);
      // Derive a title from the URL: use the path's last segment (minus
      // extension), or the hostname as fallback.
      try {
        const u = new URL(url);
        const parts = u.pathname.split("/").filter(Boolean);
        const title =
          parts.length > 0 ? parts[parts.length - 1].replace(/\.[^.]+$/, "") : u.hostname;
        urls.push({ url, title });
      } catch {
        // Malformed URL that passed the regex: skip.
      }
    }
  }

  // Pass 3: protocol-less domain/path references. This recovers citations
  // such as `github.com/microsoft/TypeScript/releases` when a model omitted
  // https://. Require a real dotted hostname and reject text preceded by @
  // (email addresses) or :// (already handled by the absolute-URL pass).
  // Track absolute URL spans as well: an internal dotted token such as
  // `net-8.0` in a query parameter must not become a second source.
  const absoluteSpans: Array<{ start: number; end: number }> = [];
  const absoluteSpanPattern = /https?:\/\/\S+/g;
  for (const m of text.matchAll(absoluteSpanPattern)) {
    absoluteSpans.push({ start: m.index, end: m.index + m[0].length });
  }
  const domainPattern =
    /(?<!:\/\/)(?<![A-Za-z0-9@._-])((?:www\.)?(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}(?:\/[^\s<>"{}*()|\\`\[\]]*)?)/g;
  for (const m of text.matchAll(domainPattern)) {
    if (absoluteSpans.some(({ start, end }) => m.index >= start && m.index < end)) continue;
    const domainReference = m[1].replace(/[.,;:!]+$/, "");
    const url = `https://${domainReference}`;
    if (seen.has(url)) continue;
    try {
      const u = new URL(url);
      seen.add(url);
      const parts = u.pathname.split("/").filter(Boolean);
      const title = parts.length > 0 ? parts[parts.length - 1].replace(/\.[^.]+$/, "") : u.hostname;
      urls.push({ url, title });
    } catch {
      // Defensive: the domain-shaped match should form a valid URL.
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
