// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { resolveWorkspacePaths } from "../../src/core/paths.js";
import type { OperationContext, ModelRequest } from "../../src/core/contracts.js";
import type { ResearchSettings } from "../../src/core/types.js";
import type { ResearchDependencies } from "../../src/core/operations/research.js";

export function coreContext(workspace: string, overrides: Partial<ResearchSettings> = {}) {
  const requests: ModelRequest[] = [];
  const diagnostics: string[] = [];
  const context: OperationContext = {
    settings: {
      searchModel: { provider: "fixture", model: "search" },
      extractModel: { provider: "fixture", model: "extract" },
      collateModel: { provider: "fixture", model: "collate" },
      searchWebSearch: { enabled: false },
      defaultUrls: 2,
      maxUrls: 3,
      cacheDir: ".search",
      extractMaxChars: 100,
      fetchTimeoutMs: 100,
      fetchConcurrency: 2,
      extractionConcurrency: 2,
      extractionMaxTokens: 100,
      collationMaxTokens: 100,
      browserFingerprint: "chrome_145",
      disableLlmsFullDiscovery: true,
      disableTelemetry: false,
      llmTimeoutMs: 100,
      llmRetryAttempts: 1,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0,
      searchRetryAttempts: 2,
      minRequestIntervalMs: 0,
      ...overrides,
    },
    models: {
      preflight: async () => [],
      complete: async (request) => {
        requests.push(request);
        const text =
          request.model.model === "search"
            ? "Answer. [One](https://one.example/page) [Two](https://two.example/page)"
            : request.model.model === "extract"
              ? "official docs, current\nExtracted."
              : "Summary.";
        return { text, citations: [] };
      },
    },
    paths: resolveWorkspacePaths(workspace, overrides.cacheDir ?? ".search"),
    identity: {
      name: "@curio-data/mcp-intelli-search",
      version: "fixture-version",
      adapter: "mcp",
    },
    logger: {
      error: (message) => {
        diagnostics.push(message);
      },
      warn: (message) => {
        diagnostics.push(message);
      },
    },
  };
  const dependencies: ResearchDependencies = {
    fetchPages: async (urls) =>
      urls.map((url) => ({
        url,
        title: url,
        content: "Page body",
        status: "success",
        source: "markdown",
      })),
    downloadLlmsFullToCache: async () => {
      throw new Error("Unexpected documentation request");
    },
  };
  return { context, requests, dependencies, diagnostics };
}
