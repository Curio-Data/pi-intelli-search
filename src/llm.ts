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
  type ThinkingLevel,
} from "@earendil-works/pi-ai";
import type { ModelConfig } from "./types.js";
import type { AnnotationSink } from "./annotations.js";
import { settleAnnotationSink, wrapFetchForAnnotations } from "./annotations.js";
import {
  withRetry,
  isRetryableMessage,
  parseRetryAfterMs,
  callWithAbortTimeout,
  errMsg,
} from "./util.js";

/**
 * The `Pi` >= 0.86 model registry (facade method added in `Pi` 0.86.0, #8964).
 *
 * `Pi` 0.86 normalised the pi-ai provider stream contract: Provider.streamSimple()
 * now requires a branded TranscriptContext whose system prompt lives in a leading
 * system message (produced only by pi-ai's normalizeContext()). A raw Context
 * passed straight to a provider compiles fine on older typings but the provider
 * silently drops the systemPrompt field. The registry's streamSimple() accepts a
 * raw Context, normalises it, resolves auth, and applies the auth baseUrl
 * override internally — exactly what this file did by hand before, plus
 * normalisation. Structural subset of `Pi`'s ModelRegistry; on `Pi` <= 0.85 the
 * streamSimple property is absent and the legacy provider path below is used
 * instead.
 *
 * The seam carries the REGISTRY OBJECT, not a detached streamSimple function:
 * Pi's implementation reads `this.runtime`, so a detached call throws
 * "Cannot read properties of undefined (reading 'runtime')".
 */
export interface ModelRegistryFacade {
  streamSimple(
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions,
  ): { result(): Promise<AssistantMessage> };
}

/**
 * Narrow injectable seam for deterministic callLlm tests.
 *
 * Two transports, dispatched by feature detection of the registry facade:
 *
 * - Pi >= 0.86: ctx.modelRegistry.streamSimple(model, context, options), the
 *   facade introduced for extension model calls. It normalises the context
 *   (folding systemPrompt into the transcript), resolves auth, and applies the
 *   baseUrl override internally.
 * - Pi 0.81.1-0.85.x: the provider's streamSimple() (the pi-ai root API),
 *   reached through ctx.modelRegistry.getProvider() with auth and the baseUrl
 *   override applied by hand here.
 *
 * The deprecated @earendil-works/pi-ai/compat entrypoint is not imported
 * anywhere: upstream documents it as deleted with the ModelManager migration,
 * and test/compat-guard.test.ts enforces that.
 */
export const __harness: {
  /** Legacy transport (Pi <= 0.85): the composed Provider object. */
  streamSimple: (
    provider: Provider,
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions,
  ) => Promise<AssistantMessage>;
  /** Facade transport (`Pi` >= 0.86): the registry object (method call, not detached). */
  registryStreamSimple: (
    registry: ModelRegistryFacade,
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions,
  ) => Promise<AssistantMessage>;
} = {
  streamSimple: (provider, model, context, options) =>
    provider.streamSimple(model, context, options).result(),
  registryStreamSimple: (registry, model, context, options) =>
    registry.streamSimple(model, context, options).result(),
};

/** Transport-level retry config for a single {@link callLlm} call. */
export interface LlmRetryConfig {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

/**
 * Call an LLM via pi's model registry, dispatched by feature detection:
 *
 * - `Pi` >= 0.86: `ctx.modelRegistry.streamSimple()` (the registry facade).
 *   It normalises the context (the systemPrompt must be folded into the
 *   transcript before a provider sees it), resolves auth, and applies the
 *   auth baseUrl override.
 * - `Pi` 0.81.1-0.85.x: the provider's `streamSimple()` (pi-ai root API,
 *   reached through `ctx.modelRegistry.getProvider()`), with auth and the
 *   baseUrl override applied by hand here.
 *
 * Both paths use pi's native auth system (auth.json, env vars, OAuth) and
 * carry the provider-neutral reasoning parameter, which is required for
 * reasoning models (MiniMax M3 and others).
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
    /**
     * When provided, a wrapped fetch tees each response body and harvests
     * url_citation annotations into this sink (search-grounded models emit
     * many more citations than the prose links they write). Callers merge
     * sink.citations with their text-parsed URLs after the call returns.
     */
    annotations?: AnnotationSink;
    /**
     * Mutate the outgoing provider payload before dispatch (forwarded as
     * the pi-ai onPayload hook). Used by the search stage to attach the
     * OpenRouter openrouter:web_search server tool. Return the payload
     * unchanged when nothing applies.
     */
    payloadPatch?: (payload: Record<string, unknown>) => Record<string, unknown>;
    /** Per-call reasoning override. Default "low" when omitted. */
    reasoning?: ThinkingLevel;
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
  // 2c. Feature-detect the `Pi` >= 0.86 registry facade. On those versions the
  //     facade is the correct dispatch point (it normalises the context before
  //     the provider sees it); on older versions the property is absent and
  //     the manual path below applies the auth-resolved baseUrl as a
  //     per-request model override, mirroring ModelRuntime.prepareRequest
  //     (proxy endpoints, custom gateways).
  const registry86 = ctx.modelRegistry as unknown as ModelRegistryFacade | undefined;
  const useFacade = typeof registry86?.streamSimple === "function";
  const requestModel: Model<Api> =
    !useFacade && auth.baseUrl ? { ...model, baseUrl: auth.baseUrl } : model;

  // 3. Build messages
  const messages: Message[] = [
    {
      role: "user",
      content: [{ type: "text", text: userMessage }],
      timestamp: Date.now(),
    },
  ];

  // 4. Call via pi-ai: provider.streamSimple() sends the provider-neutral
  //    reasoning parameter, normalised per API (required by MiniMax M3 etc.).
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
  // Annotation side channel: wrap fetch once; the sink is cleared at each
  // attempt start so a retry never accumulates citations from failed
  // attempts alongside the successful one.
  const annotationFetch = options?.annotations
    ? wrapFetchForAnnotations(globalThis.fetch.bind(globalThis), options.annotations)
    : undefined;
  let onResponseRetryAfterMs: number | undefined;
  // Tracks whether OUR per-attempt timeout (not a user Esc) aborted the last
  // attempt, so the classifier can retry it and the post-loop check can throw
  // a clear timeout error rather than returning an empty aborted response.
  let lastAttemptTimedOut = false;

  // Per-attempt stream options (the abort signal differs per attempt). Both
  // transports receive the identical option set: the facade merges auth into
  // these itself (same values, same source), the provider path depends on
  // them entirely.
  const buildStreamOptions = (signal: AbortSignal | undefined): SimpleStreamOptions => ({
    apiKey: auth.apiKey,
    headers: auth.headers,
    env: auth.env,
    ...(signal ? { signal } : {}),
    ...(annotationFetch ? { fetch: annotationFetch } : {}),
    maxTokens: options?.maxTokens,
    reasoning: options?.reasoning ?? "low",
    ...(options?.payloadPatch
      ? {
          onPayload: (payload: unknown) =>
            options!.payloadPatch!(payload as Record<string, unknown>),
        }
      : {}),
    maxRetries: 0,
    onResponse: (res) => {
      if (res.status === 429 || res.status >= 500) {
        const ra = res.headers["retry-after"];
        const secs = ra ? Number(ra) : NaN;
        onResponseRetryAfterMs = Number.isFinite(secs) ? secs * 1000 : undefined;
      }
    },
  });
  // The raw Context is passed on both paths: on Pi >= 0.86 the facade folds
  // systemPrompt into the normalised transcript; on Pi <= 0.85 the provider
  // reads the field directly. Either way the system prompt reaches the model.
  const context: Context = { systemPrompt, messages };
  const dispatch = useFacade
    ? (signal: AbortSignal | undefined) =>
        __harness.registryStreamSimple(registry86!, model, context, buildStreamOptions(signal))
    : (signal: AbortSignal | undefined) =>
        __harness.streamSimple(provider, requestModel, context, buildStreamOptions(signal));

  const response = await withRetry(
    async () => {
      onResponseRetryAfterMs = undefined;
      lastAttemptTimedOut = false;
      if (options?.annotations) options.annotations.citations.length = 0;

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
        const { value, timedOut } = await callWithAbortTimeout(dispatch, timeoutMs, userSignal);
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
  // Before returning, give the annotation side channel a bounded moment to
  // finish its background body reads: the teed clone normally completes with
  // the SDK's own read, but callers merge the sink immediately after this
  // returns and would otherwise race the final chunks.
  if (options?.annotations) await settleAnnotationSink(options.annotations);
  return response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}
