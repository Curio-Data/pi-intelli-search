// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type { ResearchSettings } from "./types.js";

/**
 * Lower bound of an output-token cap (`extractionMaxTokens`,
 * `collationMaxTokens`). Single source for the native settings validator and
 * the standalone configuration schema.
 */
export const MIN_OUTPUT_TOKENS = 16;

/**
 * Largest output-token cap the settings accept, and the ceiling a budget
 * retry may reach. Single source for the retry loop (shared core) and the
 * standalone configuration schema; the native loader validates against it
 * too.
 */
export const MAX_OUTPUT_TOKENS = 128_000;

/**
 * Every integer tuning range, in one table: the native settings validator and
 * the standalone configuration schema both read it, so a bound cannot drift
 * between the adapters. Ordered as the README settings table is; `as const
 * satisfies` keeps each entry a two-number tuple for destructuring.
 */
export const TUNING_RANGES = {
  defaultUrls: [1, 100],
  maxUrls: [1, 100],
  extractMaxChars: [1, 2_000_000],
  fetchTimeoutMs: [1, 600_000],
  fetchConcurrency: [1, 32],
  extractionConcurrency: [1, 32],
  extractionMaxTokens: [MIN_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS],
  collationMaxTokens: [MIN_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS],
  outputBudgetRetries: [0, 5],
  collationInputBudgetTokens: [10_000, 1_000_000],
  collationSourceMaxTokens: [256, MAX_OUTPUT_TOKENS],
  llmTimeoutMs: [1, 600_000],
  llmRetryAttempts: [1, 10],
  retryBaseDelayMs: [0, 120_000],
  retryMaxDelayMs: [0, 120_000],
  searchRetryAttempts: [1, 10],
  minRequestIntervalMs: [0, 120_000],
} as const satisfies Record<string, readonly [number, number]>;

/** Shared tuning only. Adapters own model selection and credential discovery. */
export function tuningDefaults(): Omit<
  ResearchSettings,
  "searchModel" | "extractModel" | "collateModel"
> {
  return {
    searchWebSearch: { enabled: false, engine: "auto", maxResults: 8, reasoning: "minimal" },
    defaultUrls: 10,
    maxUrls: 20,
    cacheDir: ".search",
    // Page cut-off for the text handed to one extraction. Raised from
    // 150,000 in 0.22.0: long documentation pages were cut before the
    // sections that answered the query, and the extraction model, not this
    // limit, is what bounds the output. What reaches collation is bounded
    // separately by the collation input budget and the per-source text cap.
    extractMaxChars: 400_000,
    fetchTimeoutMs: 20_000,
    fetchConcurrency: 4,
    extractionConcurrency: 4,
    // The completion cap covers hidden reasoning tokens on reasoning models
    // (the default MiniMax M3 reasons for thousands of tokens before any
    // visible text, and a budget-exhausted call returns empty output with
    // finish_reason "length"). 8,000 cleared the failure in live probes
    // (2026-11-02 investigation and reviews); the reasoning tail is route-
    // and page-dependent, so telemetry records residual exhaustion
    // (evidence/2026-11-02-extract-failure-agentskills-io).
    extractionMaxTokens: 8000,
    collationMaxTokens: 8000,
    // Budget retries: an output cap spent before any visible text is
    // retried, doubling the cap each time up to MAX_OUTPUT_TOKENS. 2 gives
    // 8,000, 16,000 then 32,000; 0 disables the retry. Only a failed call
    // retries.
    outputBudgetRetries: 2,
    // Collation input budget in tokens: what every extraction, its header
    // and the synthesis must fit inside the collation model's context. The
    // default follows the owner's confirmed sizing (2026-11-07): 256,000
    // context, minus ≈3,000 for prompts and the search summary, minus 32,000
    // reserved for a synthesis at the largest retried cap, leaving ≈221,000
    // for extractions. Trimming starts only when the extractions actually
    // exceed it, so the budget is a ceiling, not a target.
    collationInputBudgetTokens: 221_000,
    // Per-extraction ceiling on the text sent to collation, independent of
    // the extraction's output cap: a retry's larger reasoning allowance must
    // not let one page take the collation budget. 32,000 tokens (≈128,000
    // characters) is the largest cap two retries can reach, so the owner's
    // confirmed worst case (≈6 extractions each filling the 32,000-token
    // retried cap) flows whole inside the 221,000-token budget, and the cap
    // only binds when extractionMaxTokens is raised above it.
    collationSourceMaxTokens: 32_000,
    browserFingerprint: "chrome_145",
    disableLlmsFullDiscovery: false,
    disableTelemetry: false,
    // Scaled with extractionMaxTokens in 0.20.0: an 8,000-token completion at
    // the observed ≈95-104 tokens/s takes 77-84s, so the previous 90s default
    // could abort exactly the calls the raised cap was meant to rescue.
    llmTimeoutMs: 120_000,
    llmRetryAttempts: 3,
    retryBaseDelayMs: 1500,
    retryMaxDelayMs: 20_000,
    searchRetryAttempts: 2,
    minRequestIntervalMs: 0,
    httpProxy: undefined,
  };
}
