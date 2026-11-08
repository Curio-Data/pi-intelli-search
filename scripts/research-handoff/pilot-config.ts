// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// rh-v5 pilot constants. Separate from config.ts so the historical rh-v4
// configuration, budgets and schedule remain byte-for-byte unchanged.
// Every value here is transcribed from docs/experiments/research-handoff/PILOT-PROTOCOL.md
// (revision rh-v5-pilot-1) and the owner decision; tests assert their agreement.

import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ResearchParams } from "../../src/core/contracts.js";
import type { ResearchSettings } from "../../src/core/types.js";
import type { Arm, PilotRevision } from "./contracts.js";
import type { SourcePolicy } from "./source-selection.js";
import { studySettings, studyParams } from "./config.js";

const REPO = resolve(fileURLToPath(new URL("../../", import.meta.url)));
export const PILOT_PROTOCOL_REVISION = "rh-v5-pilot-1" as const;
export const PILOT_PROTOCOL_PATH = join(REPO, "docs/experiments/research-handoff/PILOT-PROTOCOL.md");
export const PILOT_SCOPE = "research-handoff-pilot-rh-v5" as const;
export const OWNER_DECISION_PATH = join(REPO, "evidence/agents/20261105T173919Z-handoff-resume/owner-decision.json");
/** Immutable owner-decision digest recorded at implementation entry. */
export const OWNER_DECISION_SHA256 = "e1c62950e919e69f6d94e1076b5f38b4643bd6cc11aa728bde7e487f9ebd8f79";
export const PILOT_SERIES_ROOT = join(REPO, "evidence/benchmarks/research-handoff/20261105T173919Z-rh-v5-pilot");

export const PILOT_PROFILE = {
  extractionMaxTokens: 16_000,
  collationMaxTokens: 16_000,
  llmTimeoutMs: 300_000,
  extractionConcurrency: 2,
  maxUrls: 6,
  logicalMainRequests: 4,
  downstreamAttemptsPerCall: 3,
  workerCeilingMs: 1_800_000,
} as const;
export const PILOT_OPERATION_LIMITS = {
  commonCaptures: 1,
  chargeQualifications: 1,
  subscriptionObserverConversations: 2,
  paidEndToEndConversations: 2,
  replacementConversations: 0,
  recaptures: 0,
  measuredSprintConversations: 0,
} as const;
export const PILOT_BUDGET = {
  totalNanoUsd: 10_000_000_000,
  captureNanoUsd: 810_000_000,
  qualificationNanoUsd: 1_010_000_000,
  baselinePilotNanoUsd: 4_090_000_000,
  candidatePilotNanoUsd: 4_090_000_000,
  /** 127,072 input + 2,000 output tokens at USD 0.000001, plus a USD 0.005 search fee. */
  sonarAttemptNanoUsd: 134_072_000,
  /** 1,048,576 input tokens at USD 0.0000003 plus 16,000 output tokens at USD 0.0000012. */
  m3AttemptNanoUsd: 333_772_800,
} as const;
export const PILOT_MIN_GAP_MS = 30_000;
/** Candidate initial-script Codemode options frozen by PILOT-PROTOCOL.md: display headroom only, no deadline. */
export const PILOT_CODEMODE_MAX_OUTPUT_TOKENS = 100_000;

/** Complete resolved research settings frozen by PILOT-PROTOCOL.md. */
export function pilotSettings(): ResearchSettings {
  return {
    ...studySettings(),
    extractionMaxTokens: PILOT_PROFILE.extractionMaxTokens,
    collationMaxTokens: PILOT_PROFILE.collationMaxTokens,
    llmTimeoutMs: PILOT_PROFILE.llmTimeoutMs,
  };
}
export function pilotParams(): ResearchParams { return studyParams(); }

/** Exact protocol paragraphs (Task and Routes; Gate Sequence step 3). */
export const PILOT_PARAGRAPHS = {
  paidOpening: "Research the following task using the provided research operation, then answer in at most 600 words with source citations and the saved report reference.",
  observerOpening: "This is a synthetic observer qualification, not factual research. Make the required handoff once, then briefly acknowledge its returned summary and saved report reference. Do not answer the research question substantively.",
  baselineRoute: "Make one direct intelli_research call using the exact parameters below.",
  candidateRoute: "Make one initial Codemode call. Write your own script that awaits tools.intelli_research once using the exact parameters below and returns its complete text once, unchanged. Set the initial script's max_output_tokens option to 100000 and leave timeout_ms unset.",
  baselineRecovery: "Do not perform additional research calls. Use the returned summary directly; read saved evidence only if it is insufficient. Later evidence-only read calls are permitted but must not invoke research again. Preserve material failures and truncation caveats.",
  candidateRecovery: "Do not perform additional research calls. Use the returned summary directly; read saved evidence only if it is insufficient. Later evidence-only Codemode calls are permitted but must not invoke research again. Preserve material failures and truncation caveats.",
} as const;

/** Observer diagnostics and synthetic proofs use the observer opening; paid pilots use the paid opening. */
export function pilotTaskPrompt(arm: Arm, params: ResearchParams, opening: "paid" | "observer"): string {
  return [
    opening === "paid" ? PILOT_PARAGRAPHS.paidOpening : PILOT_PARAGRAPHS.observerOpening,
    arm === "baseline" ? PILOT_PARAGRAPHS.baselineRoute : PILOT_PARAGRAPHS.candidateRoute,
    arm === "baseline" ? PILOT_PARAGRAPHS.baselineRecovery : PILOT_PARAGRAPHS.candidateRecovery,
    "Research parameters:", JSON.stringify(params, null, 2),
  ].join("\n\n");
}

/** Frozen dual-rubric topic identities (PILOT-PROTOCOL.md, Frozen Assessment Criteria). */
export const PILOT_TOPICS = [
  "supported-mechanism-and-maturity",
  "prerequisites-and-setup",
  "configuration-and-code",
  "agent-integration",
  "limitations-and-failure-modes",
  "applicability-and-evidence-access",
] as const;
export type PilotTopic = typeof PILOT_TOPICS[number];
export const PILOT_RUBRICS = ["fidelity", "taskUsefulness"] as const;

/** The only operation slots this decision authorises. Each is claimed once, permanently. */
export const PILOT_SLOTS = [
  "observer-baseline", "observer-candidate", "financial-admission",
  "capture", "charge-qualification", "pilot-baseline", "pilot-candidate",
  /** rh-v7 only: the credential-free import of a retained, settled corpus in place of a capture. */
  "corpus-import",
] as const;
export type PilotSlot = typeof PILOT_SLOTS[number];
/** rh-v8 scheduled conversation slots, such as `pair-03-candidate`, validated against the frozen schedule pattern. */
export type SuiteSlot = `pair-${string}`;
export type AnyPilotSlot = PilotSlot | SuiteSlot;
export function pilotRunId(root: string, kind: "observer" | "pilot", arm: Arm): string {
  return `${resolve(root).split(/[\\/]/).at(-1)}-${kind}-${arm}`;
}
export function pilotAllocationFor(arm: Arm): number {
  return arm === "baseline" ? PILOT_BUDGET.baselinePilotNanoUsd : PILOT_BUDGET.candidatePilotNanoUsd;
}

// ---------------------------------------------------------------------------
// Pilot definitions: one shared mechanism, one frozen definition per series
// ---------------------------------------------------------------------------

export type PilotProfile = { readonly [K in keyof typeof PILOT_PROFILE]: number };
export type PilotOperationLimits = { readonly [K in keyof typeof PILOT_OPERATION_LIMITS]: number };
export type PilotBudget = { readonly [K in keyof typeof PILOT_BUDGET]: number };
/**
 * Everything that distinguishes one bounded pilot series from another. The
 * shared runner, authority, settlement and analysis read only these fields,
 * so rh-v5 keeps its exact historical values and rh-v6 declares its own.
 */
export interface PilotDefinition {
  revision: PilotRevision;
  scope: string;
  protocolPath: string;
  ownerDecisionPath: string;
  ownerDecisionSha256: string;
  seriesRoot: string;
  profile: PilotProfile;
  operationLimits: PilotOperationLimits;
  budget: PilotBudget;
  /** Present only for a series whose capture derives its sources (rh-v6), or that reuses such a corpus (rh-v7). */
  sourcePolicy?: SourcePolicy;
  settings(): ResearchSettings;
  params(): ResearchParams;
  /**
   * rh-v7 only. The series imports this retained corpus byte for byte instead of
   * capturing one; the capture operation is refused and its allowance is zero.
   */
  corpusReuse?: CorpusReuse;
  /**
   * rh-v7 only. The candidate needs the baseline's passed machine checks and
   * known charges, not its answer gate; both answers are graded after the pair.
   */
  gradingAfterPair?: true;
  /** Earlier series roots this definition must never bind, beyond the closed rh-v5 root. */
  closedRoots?: readonly string[];
  /** Cumulative accounting carried from settled earlier series (rh-v7, rh-v8). */
  cumulative?: CumulativeAccounting;
  /**
   * rh-v8 only. A multi-pair schedule whose conversations each reserve this allowance in
   * turn against the shared cumulative ceiling; the single-pair pilot slots are unused.
   */
  suite?: SuiteDefinition;
}
/** Supplied only by a verified study plan (study-plan.ts); never a source constant. */
export interface SuiteDefinition {
  pairs: number;
  parallelPairs: number;
  conversationReservationNanoUsd: number;
  planPath: string;
  planSha256: string;
}
export interface CorpusReuse {
  /** Retained frozen-input file of the source series. */
  path: string;
  /** SHA-256 of that file's bytes. */
  sha256: string;
  /** The corpus `digest` field. */
  digest: string;
  sourceSeries: PilotRevision;
  sourceRoot: string;
}
export interface PriorSettlement { path: string; sha256: string; reportedNanoUsd: number }
export interface CumulativeAccounting {
  combinedCeilingNanoUsd: number;
  priorReportedNanoUsd: number;
  priorSettlements: readonly PriorSettlement[];
}
export const RH5_PILOT: PilotDefinition = Object.freeze({
  revision: PILOT_PROTOCOL_REVISION, scope: PILOT_SCOPE, protocolPath: PILOT_PROTOCOL_PATH,
  ownerDecisionPath: OWNER_DECISION_PATH, ownerDecisionSha256: OWNER_DECISION_SHA256, seriesRoot: PILOT_SERIES_ROOT,
  profile: PILOT_PROFILE, operationLimits: PILOT_OPERATION_LIMITS, budget: PILOT_BUDGET,
  settings: pilotSettings, params: pilotParams,
});
export function pilotAllocation(definition: PilotDefinition, arm: Arm): number {
  return arm === "baseline" ? definition.budget.baselinePilotNanoUsd : definition.budget.candidatePilotNanoUsd;
}
