// src/llm.ts — LLM calling utilities using pi native auth
import { completeSimple } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Message } from "@earendil-works/pi-ai";
import type { ModelConfig } from "./types.js";
import { withRetry, isRetryableMessage, parseRetryAfterMs, callWithAbortTimeout } from "./util.js";

/** Transport-level retry config for a single {@link callLlm} call. */
export interface LlmRetryConfig {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

/**
 * Call an LLM via pi's model registry + pi-ai completeSimple().
 * Uses pi's native auth system (auth.json, env vars, OAuth).
 * Uses completeSimple() which handles reasoning models correctly
 * (required for MiniMax M2.7 and other reasoning models).
 *
 * Transient failures (HTTP 429, 5xx, network/timeout) are retried with
 * full-jitter exponential backoff, honouring any Retry-After hint in the
 * provider error. Retry is owned here rather than by the underlying SDK
 * (maxRetries is forced to 0) so the two layers don't compound and so we can
 * honour Retry-After and the AbortSignal. A non-retryable error, or a retryable
 * one that survives all attempts, surfaces as an actionable thrown error.
 */
export async function callLlm(
  ctx: ExtensionContext,
  config: ModelConfig,
  systemPrompt: string,
  userMessage: string,
  options?: { maxTokens?: number; signal?: AbortSignal; retry?: LlmRetryConfig; timeoutMs?: number },
): Promise<string> {
  // 1. Resolve model from registry
  const model = ctx.modelRegistry.find(config.provider, config.model);
  if (!model) {
    throw new Error(
      `Model not found: ${config.provider}/${config.model}. ` +
        `Available providers may need API keys in auth.json.`,
    );
  }

  // 2. Get API key + headers
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) {
    throw new Error(
      `No API key for ${config.provider}/${config.model}. Run /login or add key to auth.json.`,
    );
  }

  // 3. Build messages
  const messages: Message[] = [
    {
      role: "user",
      content: [{ type: "text", text: userMessage }],
      timestamp: Date.now(),
    },
  ];

  // 4. Call via pi-ai — use completeSimple which sends reasoning params
  //    for reasoning models (required by MiniMax M2.7 etc.).
  //
  //    Retry is owned by withRetry below, not by the SDK: maxRetries is forced
  //    to 0 so the SDK's own (Retry-After-blind, non-abortable) retries don't
  //    compound with ours and amplify load. onResponse only OBSERVES — it must
  //    not throw, because a throw propagates out of completeSimple and would
  //    bypass the retry loop. On the OpenRouter path a 429 never arrives here as
  //    a 2xx anyway; it surfaces as stopReason "error" with the status in
  //    errorMessage, which the classifier below inspects. The capture is kept
  //    for the rare 2xx-then-429-header case and non-OpenRouter providers.
  const retry = options?.retry;
  const userSignal = options?.signal;
  const timeoutMs = options?.timeoutMs;
  let onResponseRetryAfterMs: number | undefined;
  // Tracks whether OUR per-attempt timeout (not a user Esc) aborted the last
  // attempt, so the classifier can retry it and the post-loop check can throw
  // a clear timeout error rather than returning an empty aborted response.
  let lastAttemptTimedOut = false;

  const response = await withRetry(
    async () => {
      onResponseRetryAfterMs = undefined;
      lastAttemptTimedOut = false;

      // Hard per-attempt timeout. The SDK's request timeout does not cover a
      // stalled *streaming* body — under rate limiting a provider can hold the
      // stream open after a 200, hanging the read until the SDK's ~10-minute
      // default. callWithAbortTimeout aborts the whole call (combined with the
      // user's signal so Esc still cancels) and reports whether it timed out.
      const { value, timedOut } = await callWithAbortTimeout(
        (signal) =>
          completeSimple(
            model,
            { systemPrompt, messages },
            {
              apiKey: auth.apiKey,
              headers: auth.headers,
              signal,
              maxTokens: options?.maxTokens,
              reasoning: "low",
              maxRetries: 0,
              onResponse: (res) => {
                if (res.status === 429 || res.status >= 500) {
                  const ra = res.headers["retry-after"];
                  const secs = ra ? Number(ra) : NaN;
                  onResponseRetryAfterMs = Number.isFinite(secs) ? secs * 1000 : undefined;
                }
              },
            },
          ),
        timeoutMs,
        userSignal,
      );
      lastAttemptTimedOut = timedOut;
      return value;
    },
    (result, error) => {
      if (userSignal?.aborted) return { retry: false }; // genuine user cancel
      if (lastAttemptTimedOut) return { retry: true };  // our timeout fired
      if (error) {
        const m = error instanceof Error ? error.message : String(error);
        return isRetryableMessage(m)
          ? { retry: true, retryAfterMs: parseRetryAfterMs(m) ?? onResponseRetryAfterMs }
          : { retry: false };
      }
      if (result?.stopReason === "error" && isRetryableMessage(result.errorMessage)) {
        return { retry: true, retryAfterMs: parseRetryAfterMs(result.errorMessage) ?? onResponseRetryAfterMs };
      }
      return { retry: false };
    },
    {
      attempts: retry?.attempts ?? 1,
      baseDelayMs: retry?.baseDelayMs ?? 1000,
      maxDelayMs: retry?.maxDelayMs ?? 20_000,
      signal: userSignal,
      onRetry: ({ attempt, delayMs, reason }) => {
        // Surface retry activity so a slow run under rate limiting is visible
        // (otherwise backoff looks like a hang). Matches the console.error
        // pattern used elsewhere for non-fatal pipeline diagnostics.
        const why = lastAttemptTimedOut ? "timeout" : reason;
        console.error(
          `[pi-intelli-search] ${config.provider}/${config.model}: ${why} on attempt ${attempt}, ` +
            `retrying in ${Math.round(delayMs)}ms`,
        );
      },
    },
  );

  // 5. Check for errors. A timeout on the final attempt surfaces as an
  //    "aborted" stopReason (our signal fired, not the user's) — turn it into a
  //    clear, actionable error instead of returning empty content.
  if (lastAttemptTimedOut && !userSignal?.aborted) {
    throw new Error(
      `LLM call timed out (${config.provider}/${config.model}) after ${timeoutMs}ms ` +
        `per attempt across ${retry?.attempts ?? 1} attempt(s). The provider may be rate limiting or overloaded.`,
    );
  }
  if (response.stopReason === "error") {
    throw new Error(
      `LLM call failed (${config.provider}/${config.model}): ${response.errorMessage ?? "unknown error"}`,
    );
  }

  // 6. Extract text (skip thinking blocks)
  return response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}
