// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type { ModelUsage, UsageObservation } from "./core/contracts.js";
import { normalizeMcpUsage, normalizeNativeUsage } from "./core/usage.js";

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const numeric = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Per-attempt raw presence capture, separate from the SDK's zero-filled usage. */
export function createNativeUsageCapture() {
  let raw: ModelUsage | undefined;
  let providerRequestId: string | undefined;
  return {
    chunk(value: unknown): void {
      const event = record(value);
      if (!event.usage || typeof event.usage !== "object" || Array.isArray(event.usage)) return;
      const usage = record(event.usage);
      const snapshot: ModelUsage = {};
      for (const [key, value] of Object.entries({
        input: usage.prompt_tokens,
        output: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        totalCost: usage.cost,
        cacheRead:
          record(usage.prompt_tokens_details).cached_tokens ??
          usage.prompt_cache_hit_tokens ??
          usage.cached_tokens,
        cacheWrite: record(usage.prompt_tokens_details).cache_write_tokens,
        reasoning: record(usage.completion_tokens_details).reasoning_tokens,
      })) {
        if (numeric(value)) Object.assign(snapshot, { [key]: value });
      }
      // Other APIs also emit top-level usage objects in different shapes.
      // Do not let those suppress the conservative SDK fallback.
      if (Object.keys(snapshot).length) {
        raw = snapshot;
        providerRequestId = typeof event.id === "string" ? event.id : undefined;
      }
    },
    observation(sdk: ModelUsage | undefined): UsageObservation | undefined {
      if (raw) {
        if (!Object.keys(raw).length) return undefined;
        // OpenAI-style wire input is the total prompt, unlike SDK uncached input.
        const reported = normalizeMcpUsage(raw, providerRequestId);
        if (reported.cost) return reported;
        const estimate = sdk ? normalizeNativeUsage(sdk).cost : undefined;
        return {
          ...reported,
          ...(estimate ? { cost: estimate } : {}),
          costBasis: estimate ? "catalogue" : "unknown",
        };
      }
      if (!sdk) return undefined;

      // Older hosts and other provider event shapes cannot prove whether an
      // SDK zero was reported or merely initialised. Keep only positive fields
      // whose SDK meaning is not a total assembled from missing components.
      // Uncached input is safe only when both cache subsets are positively known.
      const partial: ModelUsage = {};
      for (const key of [
        "output",
        "cacheRead",
        "cacheWrite",
        "cacheWrite1h",
        "reasoning",
      ] as const) {
        const value = sdk[key];
        if (numeric(value) && value > 0) partial[key] = value;
      }
      if (
        numeric(sdk.input) &&
        sdk.input > 0 &&
        partial.cacheRead !== undefined &&
        partial.cacheWrite !== undefined
      )
        partial.input = sdk.input;
      if (!Object.keys(partial).length) return undefined;
      if (sdk.cost) partial.cost = sdk.cost;
      return normalizeNativeUsage(partial);
    },
  };
}
