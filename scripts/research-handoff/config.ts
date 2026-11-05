// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { tuningDefaults } from "../../src/core/defaults.js";
import type { ResearchParams } from "../../src/core/contracts.js";
import type { ResearchSettings } from "../../src/core/types.js";
import type { Arm, Phase } from "./contracts.js";

export const HOST_PATH = "/home/miah0x41/.pi/agent/install/releases/1.5.0/node_modules/@earendil-works/pi-coding-agent";
export const HOST_VERSION = "1.5.0";
export const BASELINE_COMMIT = "d2ec50611ede2f5d46c062b7e568b13203015c22";
export const PROTOCOL_REVISION = "rh-v4";
export const PRIMARY_METRIC = "cumulativeTotalTokens" as const;
export const FINANCIAL_APPROVAL_SCOPE = "continue-without-programme-ledger-rh-v4" as const;
export const MAIN_MODEL = { provider: "openai-codex", model: "gpt-6.1-sol" } as const;
export const QUERY = "When running Pi Durable on Cloudflare, how do I enable outbound email with Cloudflare native services?";
export const FOCUS = "Identify the current supported end-to-end setup, prerequisites, configuration, code, agent integration points, limitations, and failure modes needed to answer the question. Preserve exact names, APIs, and version or maturity information found in the sources. Distinguish documented instructions from inference.";
export const MAIN_LIMITS = { logicalRequests: 4, providerAttempts: 3, reasoning: "low", transport: "sse", cacheRetention: "none" } as const;
export const BUDGET = {
  captureNanoUsd: 810_000_000,
  runNanoUsd: 1_200_000_000,
  costQualificationNanoUsd: 1_000_000_000,
  batchNanoUsd: 25_810_000_000,
  sonarAttemptNanoUsd: 134_072_000,
  extractAttemptNanoUsd: 324_172_800,
  collateAttemptNanoUsd: 319_372_800,
} as const;
export function studySettings(): ResearchSettings {
  return {
    ...tuningDefaults(),
    searchModel: { provider: "openrouter", model: "perplexity/sonar" },
    extractModel: { provider: "openrouter", model: "minimax/minimax-m3" },
    collateModel: { provider: "openrouter", model: "minimax/minimax-m3" },
    defaultUrls: 6, maxUrls: 6, cacheDir: ".search", disableLlmsFullDiscovery: true,
    // Six pages at the default concurrency of four can exceed the per-run
    // reservation envelope before their charges settle. Apply two workers
    // symmetrically; the effect on live research output is unmeasured.
    extractionConcurrency: 2,
  };
}
export function studyParams(): ResearchParams {
  return { query: QUERY, focusPrompt: FOCUS, domains: ["developers.cloudflare.com", "pi.dev"], maxUrls: 6 };
}
export function taskPrompt(arm: Arm, params: ResearchParams = studyParams(), phase: Phase = "measured"): string {
  const route = arm === "baseline"
    ? "Make one direct intelli_research call using the exact parameters below."
    : "Make one Codemode call. Write your own script that awaits tools.intelli_research once using the exact parameters below and returns its complete text once, unchanged.";
  return [
    phase === "diagnostic"
      ? "This is a synthetic observer qualification, not factual research. Make the required handoff once, then briefly acknowledge its returned summary and saved report reference. Do not answer the research question substantively."
      : "Research the following task using the provided research operation, then answer in at most 600 words with source citations and the saved report reference.",
    route,
    phase === "diagnostic"
      ? "Do not make additional research calls or read evidence files. The downstream evidence is deliberately synthetic. Preserve any reported failure or truncation status."
      : "Do not perform additional research calls. Use the returned summary directly; read saved evidence only if it is insufficient. Preserve material failures and truncation caveats.",
    "Research parameters:", JSON.stringify(params, null, 2),
  ].join("\n\n");
}
export function pairedSchedule(): Array<{ pair: number; arm: Arm }> {
  return Array.from({ length: 10 }, (_, i) => {
    const arms: Arm[] = i % 2 === 0 ? ["baseline", "candidate"] : ["candidate", "baseline"];
    return arms.map(arm => ({ pair: i + 1, arm }));
  }).flat();
}
