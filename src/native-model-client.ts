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
 * Near-miss hint for a model missing from the registry: other model ids under
 * the same provider, so a typo is visible at a glance. The extension-facing
 * ModelRegistry facade is narrower than the internal ModelRuntime: it exposes
 * getModelsOfType("chat", provider) from `Pi` 0.99 and getAll() (filtered here
 * by model.provider) on older hosts in the supported range. ModelRuntime's
 * getAllModels()/getModels() are not reachable from an extension context, and
 * when neither facade method is available the hint is empty and the bare
 * binding line remains.
 */
export function describeModelCatalog(
  ctx: ExtensionContext,
  provider: string,
  excludeModel: string,
): string {
  const registry = ctx.modelRegistry as unknown as {
    getModelsOfType?: (
      type: "chat",
      provider?: string,
    ) => ReadonlyArray<{ id: string; provider: string }>;
    getAll?: () => ReadonlyArray<{ id: string; provider: string }>;
  };
  try {
    let models: ReadonlyArray<{ id: string; provider: string }> | undefined;
    if (typeof registry.getModelsOfType === "function") {
      models = registry.getModelsOfType("chat", provider);
    } else if (typeof registry.getAll === "function") {
      models = registry.getAll().filter((m) => m.provider === provider);
    }
    if (!models || models.length === 0) return "";
    const ids = models
      .map((m) => m.id)
      .filter((id) => id !== excludeModel)
      .sort();
    if (ids.length === 0) return "";
    const shown = ids.slice(0, 8).join(", ");
    const extra = ids.length > 8 ? ` (+${ids.length - 8} more)` : "";
    return `  Available ${provider} models: ${shown}${extra}`;
  } catch {
    // Catalog reads are diagnostics only; never fail the error path itself.
    return "";
  }
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
