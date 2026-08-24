// src/llm.ts — LLM calling utilities using pi native auth
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  type Api,
  type AssistantMessage,
  type Context,
  type Message,
  type Model,
  type Provider,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ModelConfig } from "./types.js";
import {
  withRetry,
  isRetryableMessage,
  parseRetryAfterMs,
  callWithAbortTimeout,
  errMsg,
} from "./util.js";

/**
 * Narrow injectable seam for deterministic callLlm tests.
 *
 * The transport is the provider's streamSimple() (the pi-ai root API), the
 * same primitive Pi's own ModelRuntime dispatches to. The deprecated
 * @earendil-works/pi-ai/compat entrypoint is not imported anywhere: upstream
 * documents it as deleted with the ModelManager migration, and test/
 * compat-guard.test.ts enforces that.
 */
export const __harness: {
  streamSimple: (
    provider: Provider,
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions,
  ) => Promise<AssistantMessage>;
} = {
  streamSimple: (provider, model, context, options) =>
    provider.streamSimple(model, context, options).result(),
};

/** Transport-level retry config for a single {@link callLlm} call. */
export interface LlmRetryConfig {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

/**
 * Call an LLM via pi's model registry + the provider's streamSimple()
 * (pi-ai root API, reached through ctx.modelRegistry.getProvider()).
 * Uses pi's native auth system (auth.json, env vars, OAuth).
 * streamSimple() carries the provider-neutral reasoning parameter, which
 * is required for reasoning models (MiniMax M2.7 and others).
 *
 * Transient failures (HTTP 429, 5xx, network/timeout) are retried with
 * full-jitter exponential backoff, honouring any Retry-After hint in the
 * provider error. Retry is owned here rather than by the underlying SDK
 * (maxRetries is forced to 0) so the two layers don't compound and so we can
 * honour Retry-After and the AbortSignal. Since Pi 0.76.0 the SDK default is
 * also 0 (retry.provider.maxRetries), so the forced 0 is now defensive rather
 * than a divergence: it keeps these tools aligned regardless of a user's global
 * retry settings. A non-retryable error, or a retryable one that survives all
 * attempts, surfaces as an actionable thrown error.
 */
export async function callLlm(
  ctx: ExtensionContext,
  config: ModelConfig,
  systemPrompt: string,
  userMessage: string,
  options?: {
    maxTokens?: number;
    signal?: AbortSignal;
    retry?: LlmRetryConfig;
    timeoutMs?: number;
  },
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

  // 2b. Resolve the provider. This is the same composed Provider object
  //     (models.json overlays included) that Pi's own ModelRuntime dispatches
  //     to. modelRegistry.getProvider() exists since Pi 0.81.1; on older
  //     versions surface a clear version error instead of a TypeError.
  if (typeof ctx.modelRegistry.getProvider !== "function") {
    throw new Error(
      `modelRegistry.getProvider() is unavailable; pi-intelli-search >= 0.12.5 requires Pi >= 0.81.1. ` +
        `Update Pi, or stay on pi-intelli-search 0.12.4.`,
    );
  }
  const provider: Provider | undefined = ctx.modelRegistry.getProvider(config.provider);
  if (!provider || typeof provider.streamSimple !== "function") {
    throw new Error(
      `No API provider registered for ${config.provider} (needed by ${config.provider}/${config.model}). ` +
        `Check ~/.pi/agent/models.json or provider registration.`,
    );
  }
  // 2c. Mirror ModelRuntime.prepareRequest: apply the auth-resolved baseUrl
  //     as a per-request model override (proxy endpoints, custom gateways).
  const requestModel: Model<Api> = auth.baseUrl ? { ...model, baseUrl: auth.baseUrl } : model;

  // 3. Build messages
  const messages: Message[] = [
    {
      role: "user",
      content: [{ type: "text", text: userMessage }],
      timestamp: Date.now(),
    },
  ];

  // 4. Call via pi-ai: provider.streamSimple() sends the provider-neutral
  //    reasoning parameter, normalised per API (required by MiniMax M2.7 etc.).
  //
  //    Retry is owned by withRetry below, not by the SDK: maxRetries is forced
  //    to 0 so the SDK's own (Retry-After-blind, non-abortable) retries don't
  //    compound with ours and amplify load. Since Pi 0.76.0 the SDK default is
  //    also 0, so this force is defensive: it keeps these tools aligned even if
  //    a user raises retry.provider.maxRetries globally. onResponse only OBSERVES — it must
  //    not throw, because a throw propagates out of the stream and would
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
      //
      // The stream may resolve or throw on abort depending on the
      // provider path — the try/catch ensures lastAttemptTimedOut is set
      // correctly either way so the classifier can distinguish a retryable
      // timeout from a genuine (non-retryable) error.
      try {
        const { value, timedOut } = await callWithAbortTimeout(
          (signal) =>
            __harness.streamSimple(
              provider,
              requestModel,
              { systemPrompt, messages },
              {
                apiKey: auth.apiKey,
                headers: auth.headers,
                env: auth.env,
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
      } catch (err) {
        // When our timer abort causes the stream to throw instead of
        // resolve, lastAttemptTimedOut is still false. Infer it from signal
        // state: if userSignal is NOT aborted, the most likely cause is our
        // timeout. This lets the classifier issue a retry.
        if (!userSignal?.aborted) {
          lastAttemptTimedOut = true;
        }
        throw err;
      }
    },
    (result, error) => {
      if (userSignal?.aborted) return { retry: false }; // genuine user cancel
      if (lastAttemptTimedOut) return { retry: true }; // our timeout fired
      if (error) {
        const m = errMsg(error);
        return isRetryableMessage(m)
          ? { retry: true, retryAfterMs: parseRetryAfterMs(m) ?? onResponseRetryAfterMs }
          : { retry: false };
      }
      if (result?.stopReason === "error" && isRetryableMessage(result.errorMessage)) {
        return {
          retry: true,
          retryAfterMs: parseRetryAfterMs(result.errorMessage) ?? onResponseRetryAfterMs,
        };
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
  // User cancel: surface as AbortError rather than a misleading failure.
  if (userSignal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
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
