// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// P3 benchmark-only contracts. These mirror the frozen P0-2 declarations in
// docs/plans/codemode/API.ts and import shared core types type-only from the
// coordinator's central seam (src/core/execution-contracts.ts). The
// MutuallyAssignable proofs at the bottom of this file fail to compile if the
// mirrored shapes drift from the frozen specification. This module is
// benchmark-only code under scripts/ and is never packaged.

import type {
  AccountingSummary,
  Json,
  ModelConfig,
  ModelRole,
  TokenObservation,
  UsageObservation,
} from "../../src/core/execution-contracts.js";

import type {
  FetchFixtureRequest as FrozenFetchFixtureRequest,
  FixtureKey as FrozenFixtureKey,
  FixtureRecord as FrozenFixtureRecord,
  ModelFixtureRequest as FrozenModelFixtureRequest,
  ParsedUsage as FrozenParsedUsage,
  PairedEstimate as FrozenPairedEstimate,
  QueryPair as FrozenQueryPair,
  QuerySample as FrozenQuerySample,
  ReplayStore as FrozenReplayStore,
  RequestCapture as FrozenRequestCapture,
  RequestObserver as FrozenRequestObserver,
  RunObservation as FrozenRunObservation,
} from "../../docs/plans/codemode/API.js";

export type { AccountingSummary, Json, ModelConfig, ModelRole, TokenObservation, UsageObservation };

/** Fixture request identity for model transport attempts. Mirrors the frozen API. */
export interface ModelFixtureRequest {
  readonly model: ModelConfig;
  readonly role: ModelRole;
  readonly systemPrompt: string;
  readonly userMessage: string;
  readonly maxTokens: number | null;
  readonly reasoning: string | null;
  readonly effectivePayloadPatch: Json | null;
}

/** Fixture request identity for physical page/catalogue transport attempts. Mirrors the frozen API. */
export interface FetchFixtureRequest {
  readonly url: string;
  readonly method: "GET" | "HEAD";
  readonly accept: string;
  readonly browser: string;
  readonly proxyConfigured: boolean;
  readonly maxResponseBytes: number;
}

/** Exact fixture identity. Mirrors the frozen API. */
export interface FixtureKey {
  readonly boundary: "model" | "fetch" | "catalogue" | "operation";
  readonly scenario: string;
  readonly operationNode: string;
  readonly requestSha256: string;
  readonly occurrence: number;
}

/** One frozen transport response. Mirrors the frozen API. */
export interface FixtureRecord {
  readonly key: FixtureKey;
  readonly request: Json;
  readonly response?: Json;
  readonly error?: { readonly kind: string; readonly message: string };
  readonly usage?: UsageObservation;
  readonly delayMs: number;
  readonly contentSha256: string;
}

/**
 * Fail-closed replay lookup. A miss throws ReplayMissError and never falls
 * back to a live transport. Mirrors the frozen API.
 */
export interface ReplayStore {
  lookup(key: FixtureKey, request: Json): Promise<FixtureRecord>;
  consumed(): readonly FixtureKey[];
  misses(): readonly FixtureKey[];
  assertValid(): void;
}

/** Sanitised actual-request capture. Mirrors the frozen API. */
export interface RequestCapture {
  readonly sequence: number;
  readonly assistantRequestId: string;
  readonly payload: Json;
  readonly payloadSha256: string;
  readonly toolCatalogueSha256: string;
}

/** Read-only before_provider_request observer. Mirrors the frozen API. */
export interface RequestObserver {
  /** Receives only sanitised body/tool data, never authentication headers. */
  capture(record: RequestCapture): void;
  flush(): Promise<void>;
  readonly complete: boolean;
}

/** Canonical usage populations parsed from session event streams. Mirrors the frozen API. */
export interface ParsedUsage {
  readonly assistantMessages: readonly { readonly id: string; readonly usage: TokenObservation | null }[];
  readonly toolMessages: readonly {
    readonly toolCallId: string;
    readonly parentToolCallId?: string;
    readonly accounting: AccountingSummary | null;
  }[];
  readonly missing: readonly string[];
}

/** One observed arm execution for one query repeat. Mirrors the frozen API. */
export interface QuerySample {
  readonly queryId: string;
  readonly repeat: number;
  readonly arm: string;
  readonly valid: boolean;
  readonly mainInputUncached: number | null;
  readonly qualityJudge1: number | null;
  readonly qualityJudge2: number | null;
  readonly returnedMs: number | null;
  readonly reportedPipelineUsd: number | null;
}

/** Per-query paired means over evaluable paired repeats. Mirrors the frozen API. */
export interface QueryPair {
  readonly queryId: string;
  readonly controlMean: number;
  readonly treatmentMean: number;
  readonly pairedRepeats: number;
}

/** Query-clustered paired estimate with explicit missingness. Mirrors the frozen API. */
export interface PairedEstimate {
  readonly pairs: readonly QueryPair[];
  readonly missingQueries: readonly string[];
  readonly undefinedRatioQueries: readonly string[];
  readonly ratio: number | null;
  readonly difference: number | null;
}

/** Immutable append-only run observation. Mirrors the frozen API. */
export interface RunObservation {
  readonly runId: string;
  readonly queryId: string;
  readonly experiment: "deadline" | "query-expansion" | "codemode";
  readonly arm: string;
  readonly repeat: number;
  readonly seed: number;
  readonly order: number;
  readonly methodSha256: string;
  readonly corpusSha256: string;
  readonly fixtureSha256: string | null;
  readonly candidateCommit: string;
  readonly lockfileSha256: string;
  readonly host: Readonly<Record<string, Json>>;
  readonly effectiveSettings: Json;
  readonly toolCatalogueSha256: string;
  readonly promptSha256: string;
  readonly status: "completed" | "failed" | "aborted" | "not-started";
  readonly replayValidity: "valid" | "miss" | "not-replay";
  readonly observerComplete: boolean;
  readonly mainUsage: TokenObservation | null;
  readonly pipelineUsage: AccountingSummary | null;
  readonly reportedPipelineUsd: number | null;
  readonly estimatedPipelineUsd: number | null;
  readonly subscriptionQuota: Json;
  readonly artifacts: readonly { readonly path: string; readonly sha256: string }[];
  readonly error?: string;
  readonly rerunOf?: string;
  readonly rerunReason?: string;
}

// ---------------------------------------------------------------------------
// Compile-time assignability proofs against the frozen P0-2 declarations.
// Each constant must type as `true`; drift in either direction is a compile
// error under scripts/benchmarks/tsconfig.json.
// ---------------------------------------------------------------------------

type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

export const proofModelFixtureRequest: MutuallyAssignable<ModelFixtureRequest, FrozenModelFixtureRequest> = true;
export const proofFetchFixtureRequest: MutuallyAssignable<FetchFixtureRequest, FrozenFetchFixtureRequest> = true;
export const proofFixtureKey: MutuallyAssignable<FixtureKey, FrozenFixtureKey> = true;
export const proofFixtureRecord: MutuallyAssignable<FixtureRecord, FrozenFixtureRecord> = true;
export const proofReplayStore: MutuallyAssignable<ReplayStore, FrozenReplayStore> = true;
export const proofRequestCapture: MutuallyAssignable<RequestCapture, FrozenRequestCapture> = true;
export const proofRequestObserver: MutuallyAssignable<RequestObserver, FrozenRequestObserver> = true;
export const proofParsedUsage: MutuallyAssignable<ParsedUsage, FrozenParsedUsage> = true;
export const proofQuerySample: MutuallyAssignable<QuerySample, FrozenQuerySample> = true;
export const proofQueryPair: MutuallyAssignable<QueryPair, FrozenQueryPair> = true;
export const proofPairedEstimate: MutuallyAssignable<PairedEstimate, FrozenPairedEstimate> = true;
export const proofRunObservation: MutuallyAssignable<RunObservation, FrozenRunObservation> = true;

/** Function-signature proofs for the statistics and observation entrypoints. */
export type EstimatePairedQueries = (
  samples: readonly QuerySample[],
  control: string,
  treatment: string,
  endpoint: "mainInputUncached" | "qualityJudge1" | "qualityJudge2" | "returnedMs" | "reportedPipelineUsd",
  population: { readonly queryIds: readonly string[]; readonly repeats: readonly number[] },
) => PairedEstimate;
export type BootstrapPairedQueries = (
  estimate: PairedEstimate,
  options: { readonly seed: number; readonly draws: number; readonly confidence: number; readonly metric: "log-ratio" | "difference" },
) => { readonly lower: number | null; readonly upper: number | null; readonly draws: number; readonly seed: number };
export type ParseUsageEvents = (events: readonly Json[], mode: "json" | "rpc") => ParsedUsage;
export type AppendRunObservation = (
  root: string,
  record: RunObservation,
) => Promise<{ readonly path: string; readonly sha256: string }>;

import type {
  appendRunObservation as frozenAppendRunObservation,
  bootstrapPairedQueries as frozenBootstrapPairedQueries,
  estimatePairedQueries as frozenEstimatePairedQueries,
  parseUsageEvents as frozenParseUsageEvents,
} from "../../docs/plans/codemode/API.js";

export const proofEstimatePairedQueries: MutuallyAssignable<EstimatePairedQueries, typeof frozenEstimatePairedQueries> = true;
export const proofBootstrapPairedQueries: MutuallyAssignable<BootstrapPairedQueries, typeof frozenBootstrapPairedQueries> = true;
export const proofParseUsageEvents: MutuallyAssignable<ParseUsageEvents, typeof frozenParseUsageEvents> = true;
export const proofAppendRunObservation: MutuallyAssignable<AppendRunObservation, typeof frozenAppendRunObservation> = true;

// ---------------------------------------------------------------------------
// Implementation proofs: the actual function implementations must stay
// mutually assignable with the frozen signatures above (not just the locally
// declared function types). Drift in either direction is a compile error.
// ---------------------------------------------------------------------------

import type * as Parsers from "./usage-parser.js";
import type * as Runs from "./run-observation.js";
import type * as Stats from "./statistics.js";

export const proofEstimatePairedQueriesImpl: MutuallyAssignable<typeof Stats.estimatePairedQueries, EstimatePairedQueries> = true;
export const proofBootstrapPairedQueriesImpl: MutuallyAssignable<typeof Stats.bootstrapPairedQueries, BootstrapPairedQueries> = true;
export const proofParseUsageEventsImpl: MutuallyAssignable<typeof Parsers.parseUsageEvents, ParseUsageEvents> = true;
export const proofAppendRunObservationImpl: MutuallyAssignable<typeof Runs.appendRunObservation, AppendRunObservation> = true;
