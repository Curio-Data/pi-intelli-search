// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { tuningDefaults } from "../../src/core/defaults.js";
import type { ResearchParams } from "../../src/core/contracts.js";
import type { ResearchSettings } from "../../src/core/types.js";
import type { Arm, Phase } from "./contracts.js";

export const HOST_PATH = "/home/miah0x41/.pi/agent/install/releases/1.5.0/node_modules/@earendil-works/pi-coding-agent";
export const HOST_VERSION = "1.5.0";
export const BASELINE_COMMIT = "d2ec50611ede2f5d46c062b7e568b13203015c22";
export const PROTOCOL_REVISION = "rh-v3";
export const PRIMARY_METRIC = "cumulativeTotalTokens" as const;
export const MAIN_MODEL = { provider: "openai-codex", model: "gpt-6.1-sol" } as const;
export const QUERY = "For a PostgreSQL 17 job table with several concurrent workers, explain how FOR UPDATE SKIP LOCKED differs from transaction-level advisory locks, where LISTEN/NOTIFY helps, and what is still needed to avoid lost jobs or duplicate external side effects.";
export const FOCUS = "Explain transaction boundaries, lock lifetime, worker coordination, crash recovery, notification limitations and evidence-backed safeguards for external side effects. Restrict claims to PostgreSQL 17 or explain source-version applicability.";
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
    defaultUrls: 3, maxUrls: 3, cacheDir: ".search", disableLlmsFullDiscovery: true,
  };
}
export function studyParams(): ResearchParams {
  return { query: QUERY, focusPrompt: FOCUS, domains: ["postgresql.org"], maxUrls: 3 };
}
export function taskPrompt(arm: Arm, params: ResearchParams = studyParams(), phase: Phase = "measured"): string {
  const route = arm === "baseline"
    ? "Make one direct intelli_research call using the exact parameters below."
    : "Make one Codemode call. Write your own script that awaits tools.intelli_research once using the exact parameters below and returns its complete text once, unchanged.";
  return [
    phase === "diagnostic"
      ? "This is a synthetic observer qualification, not factual research. Make the required handoff once, then briefly acknowledge its returned summary and saved report reference. Do not try to answer the database question substantively."
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
