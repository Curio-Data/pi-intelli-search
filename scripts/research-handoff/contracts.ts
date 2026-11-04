// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type {
  DeepReadonly, ModelCompletion, ResearchParams,
} from "../../src/core/contracts.js";
import type { FetchedPage, ModelConfig, ResearchSettings } from "../../src/core/types.js";

/** Coordinator-owned schema. No implementation imports another track's test helpers. */
export const SCHEMA_VERSION = 1 as const;
export type Arm = "baseline" | "candidate";
export type Phase = "synthetic" | "diagnostic" | "measured";
export type RunStatus = "scheduled" | "started" | "completed" | "failed" | "nonconforming" | "not-run";
export type Stage = "search" | "fetch" | "extract" | "collate" | "cache";

export interface FrozenInputs {
  schemaVersion: 1;
  capture: {
    params: ResearchParams;
    searchModel: ModelConfig;
    systemPrompt: string;
    userMessage: string;
    maxTokens: 2000;
    completion: ModelCompletion;
    effectiveMaxUrls: number;
    selectedSources: Array<{ url: string; title: string }>;
    captureAttempts: number;
  };
  pages: Array<{ page: FetchedPage; contentSha256: string }>;
  extractionInputs: Array<{
    url: string;
    systemPromptSha256: string;
    userMessageSha256: string;
  }>;
  settings: DeepReadonly<ResearchSettings>;
  meta: { capturedAt: string; coreCommit: string; protocolRef: string };
  digest: string;
}

/** Append-only recorder envelope; payloads must never contain auth or headers. */
export interface JournalEvent {
  kind: string;
  at?: string;
  runId?: string;
  stage?: Stage;
  data: Record<string, unknown>;
}
export interface Journal { record(event: JournalEvent): void }
export type AdapterJournal = Journal;
export type AdapterJournalEvent = JournalEvent;

/** Normalised provider-reported counts, not SDK-initialised zero placeholders.
 * input includes cached input. output includes reasoning when the provider does.
 */
export interface ReportedUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
  reportedCostUsd?: number;
}
export interface MainAttempt {
  id: string;
  startedAt: string;
  endedAt?: string;
  payload: unknown;
  wireEncoding: "identity" | "zstd" | "synthetic";
  status: "started" | "completed" | "error" | "aborted";
  rawUsage?: unknown;
  usage?: ReportedUsage;
  error?: string;
}
export interface MainRequest {
  id: string;
  logicalIndex: number;
  context: unknown;
  payload?: unknown;
  attempts: MainAttempt[];
  afterToolCall: boolean;
  finalAnswerProducing: boolean;
  assistantMessage?: unknown;
}
export interface ToolCallRecord {
  id: string;
  name: string;
  parentToolCallId?: string;
  input: unknown;
  resultText?: string;
  isError?: boolean;
}
export interface HostIdentity {
  path: string;
  version: string;
  dependencies: Record<string, { path: string; version: string }>;
}
export interface RunManifest {
  schemaVersion: 1;
  runId: string;
  arm: Arm;
  phase: Phase;
  pair?: number;
  status: RunStatus;
  startedAt?: string;
  endedAt?: string;
  host: HostIdentity;
  mainModel: ModelConfig;
  protocolSha256: string;
  codeSha256: string;
  corpusSha256: string;
  settingsSha256: string;
  promptSha256: string;
}
export interface AdequacyAssessment {
  assessor: string;
  criteria: Array<{ id: number; pass: boolean; justification: string; sourceRefs: string[] }>;
  materialUnsupportedClaim: boolean;
  evidenceAccessible: boolean;
  adjudication?: string;
  review?: {
    reviewer: string;
    agrees: boolean;
    evidencePath: string;
    rationale: string;
    sourceRefs: string[];
    disagreements?: string[];
  };
}
export interface RunRecord {
  manifest: RunManifest;
  prompt: string;
  systemPrompt: string;
  catalogue: unknown;
  requests: MainRequest[];
  toolCalls: ToolCallRecord[];
  adapterEvents: JournalEvent[];
  finalAnswer: string;
  finalMessages: unknown[];
  inputIntegrity: { matched: boolean; problems: string[]; complete?: boolean; completenessProblems?: string[] };
  evidenceAccess: { readable: boolean; reportPaths: string[]; problems: string[] };
  conformance: { conforms: boolean; problems: string[] };
  observerCoverage: { verified: boolean; problems: string[] };
  adequacy?: AdequacyAssessment;
  pipelineOutcome?: string;
  financialControl?: { budgetLimited: boolean; overrun: boolean; activeReservations: boolean };
  /** A corrupt or unavailable retained record remains an explicitly unanalysable row. */
  analysisError?: string;
  error?: string;
}

export type AttributionCategory =
  | "common-instructions-query" | "arm-declarations-guidance"
  | "arguments-scripts" | "intermediate-research"
  | "useful-result-evidence-status" | "necessary-status"
  | "error-recovery" | "unallocated";
export interface AttributionEstimate {
  tokenizer: "js-tiktoken@1.0.21/o200k_base";
  componentTokens: Record<AttributionCategory, number>;
  wholeRequestTokens: number;
  componentTokenSum?: number;
  opaqueReasoningBytes?: number;
  providerInputTokens?: number;
  residual?: number;
}
