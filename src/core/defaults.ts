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
    extractionMaxTokens: 3000,
    collationMaxTokens: 4000,
    browserFingerprint: "chrome_145",
    disableLlmsFullDiscovery: false,
    disableTelemetry: false,
    llmTimeoutMs: 90_000,
    llmRetryAttempts: 3,
    retryBaseDelayMs: 1500,
    retryMaxDelayMs: 20_000,
    searchRetryAttempts: 2,
    minRequestIntervalMs: 0,
    httpProxy: undefined,
  };
}
