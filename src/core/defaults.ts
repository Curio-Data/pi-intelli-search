// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type { ResearchSettings } from "./types.js";

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
    extractMaxChars: 150_000,
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
    collationMaxTokens: 4000,
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
