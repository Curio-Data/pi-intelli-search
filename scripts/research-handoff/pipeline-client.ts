// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { callLlm, type ModelRegistryFacade } from "../../src/llm.js";
import type { ModelConfig } from "../../src/core/types.js";
import { SEARCH_SYSTEM_PROMPT, EXTRACTION_SYSTEM_PROMPT, COLLATION_SYSTEM_PROMPT } from "../../src/core/prompts.js";
import type { Journal, Stage } from "./contracts.js";
import { AttemptBudget } from "./budget.js";
import { BUDGET } from "./config.js";

function recordObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}
export function providerReportedCost(event: unknown): number | undefined {
  const usage = recordObject(recordObject(event)?.usage);
  const value = usage?.cost;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
function identifyStage(prompt: string, config: ModelConfig): Exclude<Stage, "cache"> {
  const role = prompt === SEARCH_SYSTEM_PROMPT ? "search" : prompt === EXTRACTION_SYSTEM_PROMPT ? "extract"
    : prompt === COLLATION_SYSTEM_PROMPT ? "collate" : undefined;
  const expected = role === "search" ? "perplexity/sonar" : "minimax/minimax-m3";
  if (!role || config.provider !== "openrouter" || config.model !== expected) {
    throw new Error("Unapproved downstream model or prompt");
  }
  return role;
}

/** Preserve the released callLlm policy, observe/reserve each facade attempt below it.
 * No global hook mutation. Raw provider cost is distinct from SDK catalogue estimates.
 */
/** Per-stage caps and reservations. The default is the historical rh-v4 guard, unchanged. */
export interface DownstreamLimits {
  maxTokens: Record<Exclude<Stage, "cache">, number>;
  boundsNanoUsd: Record<Exclude<Stage, "cache">, number>;
  maxAttempts: number;
  /** Pilot only: the dispatched payload must carry exactly the intended cap, not merely at most it. */
  exactWireLimit?: boolean;
  /** Pilot only: the per-attempt application timeout must equal this value. */
  timeoutMs?: number;
}
export const HISTORICAL_DOWNSTREAM_LIMITS: DownstreamLimits = {
  maxTokens: { search: 2000, fetch: 0, extract: 8000, collate: 4000 },
  boundsNanoUsd: { search: BUDGET.sonarAttemptNanoUsd, fetch: 0, extract: BUDGET.extractAttemptNanoUsd, collate: BUDGET.collateAttemptNanoUsd },
  maxAttempts: 3,
};
export function createGuardedCallLlm(options: { runId: string; budget: AttemptBudget; journal: Journal; limits?: DownstreamLimits }): typeof callLlm {
  let sequence = 0;
  const limits = options.limits ?? HISTORICAL_DOWNSTREAM_LIMITS;
  return async (ctx, model, systemPrompt, userMessage, policy) => {
    const stage = identifyStage(systemPrompt, model);
    const maxTokens = limits.maxTokens[stage];
    if (policy?.maxTokens !== maxTokens || (policy.retry?.attempts ?? 1) > limits.maxAttempts
      || (limits.timeoutMs !== undefined && policy.timeoutMs !== limits.timeoutMs)) {
      throw new Error("Downstream policy differs from the accepted cost bound");
    }
    const registry = ctx.modelRegistry as unknown as ModelRegistryFacade;
    const facade = new Proxy(ctx.modelRegistry, {
      get(target, key) {
        if (key !== "streamSimple") {
          const value = Reflect.get(target, key, target) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        }
        return ((resolvedModel, context, streamOptions) => {
          const id = `${options.runId}:pipeline:${++sequence}`;
          const bound = limits.boundsNanoUsd[stage];
          options.budget.reserve(id, bound);
          let reportedCost: number | undefined;
          let rawUsage: unknown;
          options.journal.record({ kind: "pipeline-attempt", stage, data: {
            id, model, systemPrompt, userMessage, maxTokens, reasoning: streamOptions?.reasoning,
          } });
          let stream: ReturnType<ModelRegistryFacade["streamSimple"]>;
          try {
            stream = registry.streamSimple(resolvedModel, context, {
              ...streamOptions,
              maxRetries: 0,
              onPayload: async (payload: unknown, resolved) => {
                const patched = await streamOptions?.onPayload?.(payload, resolved);
                const actual = patched === undefined ? payload : patched;
                const body = recordObject(actual);
                const outputLimit = body?.max_tokens ?? body?.max_completion_tokens;
                if (body?.model !== model.model || typeof outputLimit !== "number" || outputLimit > maxTokens || outputLimit <= 0
                  || (limits.exactWireLimit && outputLimit !== maxTokens)) {
                  throw new Error("Downstream wire payload exceeds the accepted model/output bound");
                }
                options.journal.record({ kind: "pipeline-payload", stage, data: { id, payload: actual } });
                return actual;
              },
              onProviderStreamEvent: (event: unknown) => {
                const usage = recordObject(event)?.usage;
                if (usage !== undefined) rawUsage = structuredClone(usage);
                const cost = providerReportedCost(event);
                if (cost !== undefined) reportedCost = cost;
                streamOptions?.onProviderStreamEvent?.(event, resolvedModel);
              },
            });
          } catch (error) {
            options.budget.settle(id);
            options.journal.record({ kind: "pipeline-error", stage, data: { id, error: String(error) } });
            throw error;
          }
          let resultPromise: ReturnType<typeof stream.result> | undefined;
          return {
            result() {
              resultPromise ??= (async () => {
                let response;
                try { response = await stream.result(); }
                catch (error) {
                  options.budget.settle(id, reportedCost);
                  options.journal.record({ kind: "pipeline-error", stage, data: { id, rawUsage, error: String(error) } });
                  throw error;
                }
                options.budget.settle(id, reportedCost);
                options.journal.record({ kind: "pipeline-completion", stage, data: {
                  id, rawUsage, sdkUsageEstimate: response.usage, stopReason: response.stopReason,
                  error: response.errorMessage, content: response.content,
                } });
                return response;
              })();
              return resultPromise;
            },
          };
        }) satisfies ModelRegistryFacade["streamSimple"];
      },
    });
    return callLlm({ ...ctx, modelRegistry: facade }, model, systemPrompt, userMessage, policy);
  };
}
