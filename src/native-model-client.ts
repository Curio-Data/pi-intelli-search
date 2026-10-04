// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createAnnotationSink } from "./annotations.js";
import type { ModelBinding, ModelClient, ModelUsage } from "./core/contracts.js";
import { callLlm } from "./llm.js";

/** Existing native preflight semantics: model existence, not credential discovery. */
export function validateModelConfigs(
  ctx: ExtensionContext,
  configs: readonly ModelBinding[],
): ModelBinding[] {
  return configs.filter(({ config }) => !ctx.modelRegistry.find(config.provider, config.model));
}

/**
 * Per-operation adapter. The delegate invokes the shared retry/timeout policy once;
 * no server dependencies, credential stores or alternative provider fallback.
 * Inject a delegate only for deterministic tests (including the legacy harness).
 */
export function createNativeModelClient(
  ctx: ExtensionContext,
  delegate: typeof callLlm = callLlm,
): ModelClient {
  return {
    async preflight(bindings) {
      return validateModelConfigs(ctx, bindings);
    },
    async complete(request) {
      const annotations = request.collectCitations ? createAnnotationSink() : undefined;
      let usage: ModelUsage | undefined;
      const text = await delegate(ctx, request.model, request.systemPrompt, request.userMessage, {
        maxTokens: request.maxTokens,
        signal: request.signal,
        retry: request.retry,
        timeoutMs: request.timeoutMs,
        annotations,
        payloadPatch: request.payloadPatch,
        reasoning: request.reasoning,
        // Always supply a native notice channel rather than depending on
        // the shared policy's logger fallback. Native callLlm also uses a
        // silent logger defensively.
        onRetryNotice: request.onRetryNotice ?? (() => {}),
        onUsage: (reported) => {
          usage = { ...reported, ...(reported.cost ? { cost: { ...reported.cost } } : {}) };
        },
      });
      return {
        text,
        citations: annotations?.citations ?? [],
        ...(usage ? { usage } : {}),
      };
    },
  };
}
