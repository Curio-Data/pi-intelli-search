// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type { MainAttempt } from "./contracts.js";

/** Provider item accounting stays separate from the proxy tokeniser. */
export interface ProviderInputAttribution {
  source: "provider-raw-usage";
  available: boolean;
  reconciled: boolean;
  providerInputTokens?: number;
  accountedInputTokens?: number;
  residual?: number;
  declarationInputTokens?: number;
  instructionInputTokens?: number;
  problems: string[];
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}
function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** The retained Responses shape exposes parent item counts and nested content
 * counts for the same input. Only parents enter reconciliation. Unknown shapes
 * remain unknown; no declaration cost is inferred from SDK-initialised zeros.
 */
export function providerInputAttribution(attempt: MainAttempt): ProviderInputAttribution {
  const raw = object(attempt.rawUsage);
  const attribution = object(raw?.attribution);
  const result: ProviderInputAttribution = {
    source: "provider-raw-usage", available: attribution !== undefined,
    reconciled: false, problems: [],
  };
  if (!attribution) return result;
  const items = object(attribution.items), fields = object(attribution.request_fields);
  if (!items || !fields) {
    result.problems.push("Provider attribution lacks parent items or request fields.");
    return result;
  }
  if (count(raw?.input_tokens)) result.providerInputTokens = raw.input_tokens;
  else result.problems.push("Provider attribution lacks a valid input total.");

  let sum = 0;
  for (const [group, entries] of [["items", items], ["request_fields", fields]] as const) {
    for (const [key, value] of Object.entries(entries)) {
      const tokens = object(value)?.input_tokens;
      if (count(tokens)) sum += tokens;
      else result.problems.push(`Provider attribution ${group}.${key} lacks a valid input count.`);
    }
  }
  if (!Number.isSafeInteger(sum)) result.problems.push("Provider attribution sum exceeds integer precision.");
  if (result.problems.length) return result;
  result.accountedInputTokens = sum;
  result.residual = result.providerInputTokens! - sum;
  if (result.residual !== 0) result.problems.push("Provider attribution does not reconcile with its input total.");
  if (attempt.usage?.input !== undefined && attempt.usage.input !== result.providerInputTokens) {
    result.problems.push("Raw and recorded provider input totals differ.");
  }
  result.reconciled = result.problems.length === 0;
  if (!result.reconciled) return result;

  const payload = object(attempt.payload);
  const declarationMessages = Array.isArray(payload?.input)
    ? payload.input.filter(item => object(item)?.type === "additional_tools") : [];
  const declarationItems = Object.entries(items).filter(([id]) => id.startsWith("at_"));
  // Recognise only the observed mapping. A future shape must not look like zero cost.
  if (payload?.tools === undefined && declarationMessages.length > 0 && declarationItems.length === declarationMessages.length
    && declarationMessages.every(item => object(item)?.role === "developer" && Array.isArray(object(item)?.tools))) {
    result.declarationInputTokens = declarationItems.reduce((total, [, value]) => total + (object(value)!.input_tokens as number), 0);
  } else {
    result.problems.push("Provider declaration attribution shape is not recognised.");
  }
  const instructions = object(fields.instructions)?.input_tokens;
  if (typeof payload?.instructions === "string" && count(instructions)) result.instructionInputTokens = instructions;
  return result;
}
