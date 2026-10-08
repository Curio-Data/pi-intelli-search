// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// src/llm.ts — LLM calling utilities using pi native auth
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  type Api,
  type AssistantMessage,
  type Context,
  type Message,
  type Model,
  type SimpleStreamOptions,
  type ThinkingLevel,
} from "@earendil-works/pi-ai";
import type { ModelConfig } from "./types.js";
import type { ModelRetryConfig, ModelUsage } from "./core/contracts.js";
import type { AnnotationSink } from "./annotations.js";
import {
  createAnnotationSink,
  harvestChunkAnnotations,
  settleAnnotationSink,
  wrapFetchForAnnotations,
} from "./annotations.js";
import { runModelWithPolicy } from "./core/llm.js";

/**
 * The `Pi` >= 0.86 model registry (facade method added in `Pi` 0.86.0, #8964).
 *
 * `Pi` 0.86 normalised the pi-ai provider stream contract: Provider.streamSimple()
 * now requires a branded TranscriptContext whose system prompt lives in a leading
 * system message (produced only by pi-ai's normalizeContext()). A raw Context
 * passed straight to a provider compiles fine on older typings but the provider
 * silently drops the systemPrompt field. The registry's streamSimple() accepts a
 * raw Context, normalises it, resolves auth, and applies the auth baseUrl
 * override internally. Since 0.17.0 the peer floor is `Pi` >= 0.86.0, so the
 * facade is the one and only dispatch path; the legacy manual provider
 * transport that mirrored ModelRuntime.prepareRequest is gone. pi-ai 1.0.0
 * formalised the normalisation contract in the type system: the Provider
 * interface declares streamSimple(model, context: TranscriptContext, ...),
 * which makes a direct provider call type-incorrect as well as lossy.
 * Structural subset of `Pi`'s ModelRegistry.
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
 * Single transport: `ctx.modelRegistry.streamSimple(model, context, options)`,
 * the facade introduced for extension model calls in `Pi` 0.86.0 and required
 * by the peer floor. It normalises the context (folding systemPrompt into the
 * transcript), resolves auth, and applies the baseUrl override internally.
 *
 * The deprecated @earendil-works/pi-ai/compat entrypoint is not imported
 * anywhere: upstream documents it as deleted with the ModelManager migration,
 * and test/compat-guard.test.ts enforces that.
 */
export const __harness: {
  /** Facade transport: the registry object (method call, not detached). */
  registryStreamSimple: (
    registry: ModelRegistryFacade,
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions,
  ) => Promise<AssistantMessage>;
} = {
  registryStreamSimple: (registry, model, context, options) =>
    registry.streamSimple(model, context, options).result(),
};

/** Transport-level retry config for a single {@link callLlm} call. */
export type LlmRetryConfig = ModelRetryConfig;

/**
 * Call an LLM via pi's model registry facade, the single supported transport
 * on the `Pi` >= 0.86 peer floor. The facade normalises the context (the
 * systemPrompt is folded into the transcript before a provider sees it),
 * resolves auth, and applies the auth baseUrl override.
 *
 * Uses pi's native auth system (auth.json, env vars, OAuth) and carries the
 * provider-neutral reasoning parameter, which is required for reasoning
 * models (MiniMax M3 and others).
 *
 * Transient failures (HTTP 429, 5xx, network/timeout) are retried with
 * full-jitter exponential backoff, honouring any Retry-After hint in the
 * provider error. Retry is owned by the shared model policy, not the SDK
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
    /**
     * Retry notifications. Wired by the caller into a UI-safe channel
     * (stage progress); never console-logged, because raw stderr bypasses
     * the Pi TUI layout. Dropped when omitted.
     */
    onRetryNotice?: (message: string) => void;
    /** Successful provider usage, retained by the host-neutral adapter. */
    onUsage?: (usage: ModelUsage) => void;
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

  // 2b. The registry facade (`Pi` >= 0.86.0) is the required dispatch point:
  //     it normalises the context (a raw Context handed straight to a provider
  //     silently drops the systemPrompt on every `Pi` >= 0.86), resolves auth,
  //     and applies the auth baseUrl override internally. There is no provider
  //     fallback; a host without the facade is below the peer floor and gets a
  //     clear version error instead of a TypeError.
  const registry = ctx.modelRegistry as unknown as ModelRegistryFacade | undefined;
  if (typeof registry?.streamSimple !== "function") {
    throw new Error(
      `ctx.modelRegistry.streamSimple() is unavailable; pi-intelli-search >= 0.17.0 requires Pi >= 0.86. ` +
        `Update Pi, or stay on pi-intelli-search 0.16.x.`,
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

  // 4. Call via pi-ai: provider.streamSimple() sends the provider-neutral
  //    reasoning parameter, normalised per API (required by MiniMax M3 etc.).
  //
  //    Retry is owned by runModelWithPolicy, not by the SDK: maxRetries is forced
  //    to 0 so the SDK's own (Retry-After-blind, non-abortable) retries don't
  //    compound with ours and amplify load. Since Pi 0.76.0 the SDK default is
  //    also 0, so this force is defensive: it keeps these tools aligned even if
  //    a user raises retry.provider.maxRetries globally. onResponse only OBSERVES — it must
  //    not throw, because a throw propagates out of the stream and would
  //    bypass the retry loop. On the OpenRouter path a 429 never arrives here as
  //    a 2xx anyway; it surfaces as stopReason "error" with the status in
  //    errorMessage, which the classifier below inspects. The capture is kept
  //    for the rare 2xx-then-429-header case and non-OpenRouter providers.
  const context: Context = { systemPrompt, messages };
  const response = await runModelWithPolicy(
    async (signal, hints) => {
      // Each attempt has its own sink. Late reads from a failed attempt cannot
      // contaminate successful citations even when an old clone is still settling.
      const annotations = options?.annotations ? createAnnotationSink() : undefined;
      if (options?.annotations) options.annotations.citations.length = 0;
      const annotationFetch = annotations
        ? wrapFetchForAnnotations(globalThis.fetch.bind(globalThis), annotations)
        : undefined;
      const streamOptions: SimpleStreamOptions = {
        apiKey: auth.apiKey,
        headers: auth.headers,
        env: auth.env,
        ...(signal ? { signal } : {}),
        ...(annotationFetch ? { fetch: annotationFetch } : {}),
        // Supported citation channel (pi-ai >= 1.0): the OpenAI Completions
        // adapter, which serves OpenRouter, invokes this for every parsed SSE
        // chunk before normalisation. Hosts on pi-ai < 1.0 ignore the option,
        // which is why the fetch wrapper above stays as the fallback channel;
        // both feed the same per-attempt sink and dedupe by URL.
        ...(annotations
          ? {
              onProviderStreamEvent: (data: unknown) => {
                harvestChunkAnnotations(data, annotations);
              },
            }
          : {}),
        maxTokens: options?.maxTokens,
        reasoning: options?.reasoning ?? "low",
        ...(options?.payloadPatch
          ? {
              onPayload: (payload: unknown) =>
                options.payloadPatch!(payload as Record<string, unknown>),
            }
          : {}),
        maxRetries: 0,
        onResponse: (res) => {
          if (res.status === 429 || res.status >= 500) {
            const ra = res.headers["retry-after"];
            const secs = ra ? Number(ra) : NaN;
            hints.retryAfterMs = Number.isFinite(secs) ? secs * 1000 : undefined;
          }
        },
      };
      const value = await __harness.registryStreamSimple(registry, model, context, streamOptions);
      if (value.stopReason === "error")
        return { value, error: value.errorMessage ?? "unknown error" };
      if (annotations) {
        await settleAnnotationSink(annotations);
        options!.annotations!.citations.push(...annotations.citations);
      }
      return { value };
    },
    {
      model: config,
      signal: options?.signal,
      retry: options?.retry,
      timeoutMs: options?.timeoutMs,
      onRetryNotice: options?.onRetryNotice,
    },
    // The native logger is deliberately silent: the model client always
    // supplies onRetryNotice, and any residual logger fallback must not
    // write to the console because raw stderr bypasses the Pi TUI layout
    // instead of going through the renderer. Configuration errors are
    // thrown to the tool layer; session-start notices use ctx.ui.notify.
    { error: () => {}, warn: () => {} },
  );

  if (response.usage) options?.onUsage?.(response.usage);
  return response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}
