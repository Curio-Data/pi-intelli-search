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
 * Near-miss hint for a model missing from the registry: the same provider's
 * most similar model ids, so a typo is visible at a glance. The extension-facing
 * ModelRegistry facade is narrower than the internal ModelRuntime: it exposes
 * getModelsOfType("chat", provider) from `Pi` 0.99 and getAll() (filtered here
 * by model.provider) on older hosts in the supported range. ModelRuntime's
 * getAllModels()/getModels() are not reachable from an extension context, and
 * when neither facade method is available the hint is empty and the bare
 * binding line remains.
 *
 * Ranking: same-vendor ids first, then ascending edit distance, so the default
 * provider's huge catalogue (OpenRouter holds hundreds of models) surfaces the
 * intended correction (`minimax/minimax-m3x` -> `minimax/minimax-m3`) instead
 * of an alphabetical slice of unrelated vendors.
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
    const ids = models.map((m) => m.id).filter((id) => id !== excludeModel);
    if (ids.length === 0) return "";
    const vendor = excludeModel.split("/")[0];
    const ranked = ids
      .map((id) => ({
        id,
        distance: editDistance(id, excludeModel),
        sameVendor: id.split("/")[0] === vendor ? 0 : 1,
      }))
      .sort((a, b) => a.sameVendor - b.sameVendor || a.distance - b.distance || a.id.localeCompare(b.id))
      .map((entry) => entry.id);
    const shown = ranked.slice(0, 8).join(", ");
    const extra = ranked.length > 8 ? ` (+${ranked.length - 8} more)` : "";
    return `  Available ${provider} models: ${shown}${extra}`;
  } catch {
    // Catalog reads are diagnostics only; never fail the error path itself.
    return "";
  }
}

/** Bounded Levenshtein distance for typo ranking; cheap at catalogue scale. */
function editDistance(a: string, b: string): number {
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
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
