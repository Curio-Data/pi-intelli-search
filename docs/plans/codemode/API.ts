// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
// P0-1 specification declarations, not a shipped implementation.
import type { TSchema } from "typebox";
import type {
  SearchParams, ExtractParams, CollateParams, ResearchParams,
  ModelBinding, ModelRequest as ExistingModelRequest,
  ModelCompletion as ExistingModelCompletion,
  OperationContext as ExistingOperationContext,
} from "../../../src/core/contracts.js";

export type OperationName = "intelli_search" | "intelli_extract" | "intelli_collate" | "intelli_research" | "intelli_fetch";
export type ModelRole = "search" | "extract" | "collate" | "suggest";
export type Outcome = "completed" | "no-links" | "fetch-failed" | "extraction-failed" | "error" | "aborted";
export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
export interface ModelConfig { readonly provider: string; readonly model: string }
export interface Clock {
  monotonicMs(): number;
  utcIso(): string;
  schedule(delayMs: number, callback: () => void): () => void;
  sleep(delayMs: number, signal?: AbortSignal): Promise<void>;
}
export interface CoordinatorOptions {
  readonly modelConcurrency: number;
  readonly criticalReserve: 1;
  readonly fetchConcurrency: number;
  readonly minRequestIntervalMs: number;
  readonly clock: Clock;
  readonly generation: number;
}
export interface AdmissionTicket {
  readonly operationId: string;
  readonly kind: "critical" | "page" | "fetch";
  readonly signal: AbortSignal;
  readonly pageId?: string;
}
export interface Permit {
  readonly grantedAtMs: number;
  readonly queueMs: number;
  release(): void;
}
export interface CoordinatorSnapshot {
  readonly activeModels: number;
  readonly activePages: number;
  readonly activeFetches: number;
  readonly queuedModels: number;
  readonly queuedFetches: number;
  readonly activeOperations: number;
  readonly closed: boolean;
}
export interface OperationLease {
  readonly id: string;
  readonly generation: number;
  readonly signal: AbortSignal;
  /** Acquires a physical HTTP-chain permit; do not hold an outer page permit. */
  acquireFetch(pageId?: string): Promise<Permit>;
  /** Cancels queued page admissions, not critical calls or already-started extraction. */
  cutoffPages(): void;
  track<T>(task: Promise<T>): Promise<T>;
  abort(reason?: string): void;
  /** Waits for owned work, then deregisters. Does not abandon work on timeout. */
  settle(): Promise<void>;
}
export interface ExecutionCoordinator {
  begin(operationId: string, signal?: AbortSignal): OperationLease;
  acquireModel(ticket: AdmissionTicket & { readonly kind: "critical" | "page" }): Promise<Permit>;
  snapshot(): CoordinatorSnapshot;
  close(reason?: string): Promise<void>;
}
export declare function createExecutionCoordinator(options: CoordinatorOptions): ExecutionCoordinator;

export interface TokenObservation {
  readonly inputTotal?: number;
  readonly inputUncached?: number;
  readonly outputTotal?: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
  readonly cacheWrite1h?: number;
  readonly reasoning?: number;
  readonly totalTokens?: number;
}
export interface CostObservation {
  readonly total?: number;
  readonly input?: number;
  readonly output?: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
}
export interface UsageObservation {
  readonly tokens: TokenObservation;
  readonly cost?: CostObservation;
  readonly source: "provider-response" | "sdk-normalized";
  readonly costBasis: "reported" | "catalogue" | "unknown";
  readonly providerRequestId?: string;
}
export interface AttemptIdentity {
  readonly operationId: string;
  readonly callId: string;
  readonly attempt: number;
  readonly model: ModelConfig;
  readonly role: ModelRole;
  readonly pageId?: string;
}
export interface AttemptRecord extends AttemptIdentity {
  readonly state: "succeeded" | "failed" | "aborted" | "timed-out";
  readonly startedAtMs: number;
  readonly settledAtMs: number;
  readonly queueMs: number;
  readonly observation?: UsageObservation;
}
export interface AccountingSummary {
  readonly attempts: number;
  readonly observedAttempts: number;
  readonly missingAttempts: number;
  readonly tokens: TokenObservation;
  readonly reportedCost: CostObservation;
  readonly estimatedCost: CostObservation;
  readonly missingTokenFields: readonly (keyof TokenObservation)[];
  readonly costComplete: boolean;
  readonly parentDelivery: "available" | "unavailable-after-parent-cancel" | "unknown";
}
export interface NumericHostUsage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly totalTokens: number;
  readonly cost: { readonly input: number; readonly output: number; readonly cacheRead: number; readonly cacheWrite: number; readonly total: number };
}
export interface AttemptLedger {
  start(identity: AttemptIdentity, startedAtMs: number, queueMs: number): void;
  observe(identity: AttemptIdentity, observation: UsageObservation): void;
  finish(identity: AttemptIdentity, state: AttemptRecord["state"], settledAtMs: number): void;
  records(): readonly AttemptRecord[];
  summary(parentDelivery?: AccountingSummary["parentDelivery"]): AccountingSummary;
  hostUsage(): NumericHostUsage;
}
export declare function createAttemptLedger(): AttemptLedger;
export interface ModelCallScope {
  readonly operation: OperationLease;
  readonly callId: string;
  readonly role: ModelRole;
  readonly pageId?: string;
  readonly ledger: AttemptLedger;
}
export interface Logger {
  error(message: string, error?: unknown): void;
  warn(message: string): void;
}
export interface PolicyHooks {
  readonly logger: Logger;
  readonly scope: ModelCallScope;
  readonly coordinator: ExecutionCoordinator;
  readonly clock: Clock;
}
export interface AttemptControl {
  readonly identity: AttemptIdentity;
  readonly signal: AbortSignal;
  observe(observation: UsageObservation): void;
  retryAfterMs?: number;
}
export interface PolicyRequest {
  readonly model: ModelConfig;
  readonly signal?: AbortSignal;
  readonly retry?: { readonly attempts: number; readonly baseDelayMs: number; readonly maxDelayMs: number };
  readonly timeoutMs?: number;
  readonly onRetryNotice?: (message: string) => void;
}
export declare function runModelWithPolicy<T>(
  attempt: (control: AttemptControl) => Promise<{ readonly value: T; readonly error?: string }>,
  request: PolicyRequest,
  hooks: PolicyHooks,
): Promise<T>;

/** Preserved utility/catalogue overload; registered inference clients use scoped hooks. */
export declare function runModelWithPolicy<T>(
  attempt: (signal: AbortSignal | undefined, hints: { retryAfterMs?: number }) => Promise<{ readonly value: T; readonly error?: string }>,
  request: PolicyRequest,
  logger: Logger,
  testing?: { readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>; readonly random?: () => number },
): Promise<T>;

export interface ResearchExecutionSettings {
  readonly pageExecution: "streaming" | "barrier";
  readonly modelConcurrency: number;
  readonly criticalReserve: 1;
  readonly aggregateFetchConcurrency: number;
  readonly lateDrainMs: number;
  readonly deadline: { readonly enabled: false } | {
    readonly enabled: true;
    readonly quorum: number;
    readonly factor: number;
    readonly floorMs: number;
    readonly ceilingMs: number;
    readonly minSources: number;
  };
  readonly fetchMaxResponseBytes: number;
  readonly fetchMaxChars: number;
  readonly docsMaxResponseBytes: number;
}
export interface ProtocolQueueSettings { readonly maxConcurrent: number; readonly maxQueued: number }
export type SourceState = "candidate" | "fetched" | "used" | "late" | "empty" | "fetch-failed" | "extract-failed" | "cancelled";
export interface SourceRecord {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly state: SourceState;
  readonly sourceType?: string;
  readonly extraction?: string;
  readonly content?: string;
  readonly truncated?: boolean;
  readonly extractionPath?: string;
  readonly fullPagePath?: string;
  readonly diagnostic?: string;
}
export interface Counts {
  readonly candidates: number;
  readonly fetched: number;
  readonly extracted: number;
  readonly used: number;
  readonly late: number;
  readonly failed: number;
  readonly cancelled: number;
  readonly effectivePageConcurrency: number;
}
export interface Times {
  readonly startedUtc: string;
  readonly elapsedMs: number;
  readonly summaryReadyMs?: number;
  readonly cutoffMs?: number;
  readonly allWorkSettledMs: number;
  readonly abortToSettledMs?: number;
}
export interface Diagnostic { readonly code: string; readonly message: string }
export type Persistence =
  | { readonly status: "not-requested" }
  | { readonly status: "unavailable"; readonly diagnostic: Diagnostic }
  | { readonly status: "committed"; readonly runId: string; readonly reportPath: string; readonly index: "updated" | "unavailable"; readonly accountingPath?: string; readonly diagnostic?: Diagnostic };
export interface RelatedReport { readonly query: string; readonly reportPath: string; readonly relevance: string; readonly namespace: "v1" | "legacy" }
export interface FullData {
  readonly schemaVersion: 1;
  readonly operation: OperationName;
  readonly operationId: string;
  readonly outcome: Outcome;
  readonly text: string;
  readonly details: Readonly<Record<string, Json>>;
  readonly summary: string;
  readonly sources: readonly SourceRecord[];
  readonly cache: Persistence;
  readonly related: readonly RelatedReport[];
  readonly counts: Counts;
  readonly timing: Times;
  readonly accounting: AccountingSummary;
  readonly attempts: readonly AttemptRecord[];
  readonly deadline: { readonly enabled: boolean; readonly reason: "disabled" | "all-terminal" | "adaptive" | "ceiling" | "not-applicable"; readonly minimumMet: boolean };
}
export interface CoreResult {
  readonly text: string;
  readonly details: Readonly<Record<string, Json>>;
  readonly outcome: Outcome;
  readonly data: FullData;
  readonly usage: NumericHostUsage;
}
export declare const operationOutputSchemas: Readonly<Record<OperationName, TSchema>>;
export declare const compactOutputSchema: TSchema;
export interface OperationFailure extends Error {
  readonly data: FullData;
  readonly usage: NumericHostUsage;
}
export interface CompactData {
  readonly outcome: Outcome;
  readonly text: string;
  readonly details: Readonly<Record<string, Json>>;
  readonly meta: {
    readonly schemaVersion: 1;
    readonly operation: OperationName;
    readonly operationId: string;
    readonly persistence: Persistence["status"];
    readonly reportPath?: string;
    readonly index?: "updated" | "unavailable";
    readonly counts: Counts;
    readonly elapsedMs: number;
    readonly attempts: number;
    readonly missingAttempts: number;
    readonly reportedCost?: number;
    readonly estimatedCost?: number;
    readonly costComplete: boolean;
  };
}
export interface Progress {
  readonly operationId: string;
  readonly sequence: number;
  readonly stage: "search" | "fetch" | "extract" | "collate" | "cache";
  readonly event: "start" | "update" | "retry" | "end";
  readonly state: "running" | "succeeded" | "failed" | "cancelled";
  readonly message: string;
  readonly elapsedMs: number;
  readonly pageId?: string;
  readonly workStage?: "fetch" | "extract";
  readonly counts?: Counts;
  readonly stageIdx: number;
  readonly totalStages: number;
  readonly pct: number;
  readonly subProgress?: { readonly current: number; readonly total: number };
}
export interface FetchParams { readonly url: string; readonly maxChars?: number }
export interface FetchResult { readonly page: SourceRecord; readonly transferredBytes: number }
export interface FetchClient {
  fetch(params: FetchParams, operation: OperationLease): Promise<FetchResult>;
  discover(urls: readonly string[], stagingRoot: string, operation: OperationLease): Promise<readonly SourceRecord[]>;
}
export interface OperationServices {
  readonly operation: OperationLease;
  readonly coordinator: ExecutionCoordinator;
  readonly ledger: AttemptLedger;
  readonly clock: Clock;
  readonly fetch: FetchClient;
  readonly runs: RunStore;
  readonly onProgress?: (event: Progress) => void;
}

export interface RunReservation {
  readonly namespaceId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly startedUtc: string;
  readonly compatibilityKey: string;
  readonly physicalPath: string;
  readonly displayPath: string;
}
export type Allocation = { readonly status: "allocated"; readonly reservation: RunReservation } | { readonly status: "unavailable"; readonly diagnostic: Diagnostic };
export interface AllocateInput {
  readonly operationId: string;
  readonly query: string;
  readonly startedUtc: string;
  readonly signal: AbortSignal;
}
export type Artifact = {
  readonly relativePath: string;
  readonly kind: "report" | "query" | "source" | "extraction" | "late" | "manifest-data";
} & ({ readonly bytes: Uint8Array } | { readonly stagedPath: string });
export interface CommittedRun {
  readonly reservation: RunReservation;
  readonly files: readonly { readonly relativePath: string; readonly sha256: string; readonly bytes: number }[];
  readonly manifestSha256: string;
}
export interface RunStore {
  allocate(input: AllocateInput): Promise<Allocation>;
  /** Files contain deterministic source-ID references, never promised unverified paths. */
  commit(reservation: RunReservation, artifacts: readonly Artifact[], signal: AbortSignal): Promise<CommittedRun>;
  updateIndex(run: CommittedRun, query: string, signal: AbortSignal): Promise<"updated" | "unavailable">;
  recordAccounting(run: CommittedRun, records: readonly AttemptRecord[], summary: AccountingSummary, signal: AbortSignal): Promise<{ readonly status: "recorded"; readonly path: string } | { readonly status: "unavailable"; readonly diagnostic: Diagnostic }>;
  candidates(current: RunReservation | undefined, query: string, signal: AbortSignal): Promise<readonly IndexCandidate[]>;
  /** No deletion of historical or uncommitted run directories. */
  settle(): Promise<void>;
}
export interface IndexCandidate {
  readonly query: string;
  readonly reportPath: string;
  readonly namespace: "v1" | "legacy";
  readonly startedUtc: string;
  readonly compatibilityKey: string;
  readonly admissionSequence?: number;
}
export interface RunStoreOptions {
  readonly workspaceRoot: string;
  readonly cacheRoot: string;
  readonly displayRoot: string;
  readonly clock: Clock;
  readonly randomId: () => string;
  readonly onDiagnostic: (diagnostic: Diagnostic) => void;
}
export declare function createRunStore(options: RunStoreOptions): RunStore;

export interface ScopedModelClient {
  preflight(bindings: readonly ModelBinding[]): Promise<ModelBinding[]>;
  complete(request: ExistingModelRequest & { readonly scope: ModelCallScope }): Promise<ExistingModelCompletion>;
}
export interface Context extends Omit<ExistingOperationContext, "models" | "onProgress"> {
  readonly services: OperationServices;
  readonly models: ScopedModelClient;
  readonly onProgress?: (event: Progress) => void;
}
export declare function search(params: SearchParams, context: Context): Promise<CoreResult>;
export declare function extract(params: ExtractParams, context: Context): Promise<CoreResult>;
export declare function collate(params: CollateParams, context: Context): Promise<CoreResult>;
export declare function research(params: ResearchParams, context: Context): Promise<CoreResult>;
export declare function fetchPage(params: FetchParams, context: Context): Promise<CoreResult>;
export interface EngineOperations {
  readonly search: typeof search;
  readonly extract: typeof extract;
  readonly collate: typeof collate;
  readonly research: typeof research;
  readonly fetchPage: typeof fetchPage;
}
/** Native tool registration accepts this explicit test seam; no mutable global harness. */
export interface NativeTestInjection {
  readonly operations?: Partial<EngineOperations>;
  readonly transformContext?: (context: Context) => Context;
}

export interface ModelFixtureRequest {
  readonly model: ModelConfig;
  readonly role: ModelRole;
  readonly systemPrompt: string;
  readonly userMessage: string;
  readonly maxTokens: number | null;
  readonly reasoning: string | null;
  readonly effectivePayloadPatch: Json | null;
}
export interface FetchFixtureRequest {
  readonly url: string;
  readonly method: "GET" | "HEAD";
  readonly accept: string;
  readonly browser: string;
  readonly proxyConfigured: boolean;
  readonly maxResponseBytes: number;
}
export interface FixtureKey {
  readonly boundary: "model" | "fetch" | "catalogue" | "operation";
  readonly scenario: string;
  readonly operationNode: string;
  readonly requestSha256: string;
  readonly occurrence: number;
}
export interface FixtureRecord {
  readonly key: FixtureKey;
  readonly request: Json;
  readonly response?: Json;
  readonly error?: { readonly kind: string; readonly message: string };
  readonly usage?: UsageObservation;
  readonly delayMs: number;
  readonly contentSha256: string;
}
export interface ReplayStore {
  lookup(key: FixtureKey, request: Json): Promise<FixtureRecord>;
  consumed(): readonly FixtureKey[];
  misses(): readonly FixtureKey[];
  assertValid(): void;
}
export interface RequestCapture {
  readonly sequence: number;
  readonly assistantRequestId: string;
  readonly payload: Json;
  readonly payloadSha256: string;
  readonly toolCatalogueSha256: string;
}
export interface RequestObserver {
  /** Receives only sanitised body/tool data, never authentication headers. */
  capture(record: RequestCapture): void;
  flush(): Promise<void>;
  readonly complete: boolean;
}
export interface ParsedUsage {
  readonly assistantMessages: readonly { readonly id: string; readonly usage: TokenObservation | null }[];
  readonly toolMessages: readonly { readonly toolCallId: string; readonly parentToolCallId?: string; readonly accounting: AccountingSummary | null }[];
  readonly missing: readonly string[];
}
export declare function parseUsageEvents(events: readonly Json[], mode: "json" | "rpc"): ParsedUsage;
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
export interface QueryPair {
  readonly queryId: string;
  readonly controlMean: number;
  readonly treatmentMean: number;
  readonly pairedRepeats: number;
}
export interface PairedEstimate {
  readonly pairs: readonly QueryPair[];
  readonly missingQueries: readonly string[];
  readonly undefinedRatioQueries: readonly string[];
  readonly ratio: number | null;
  readonly difference: number | null;
}
export declare function estimatePairedQueries(samples: readonly QuerySample[], control: string, treatment: string, endpoint: "mainInputUncached" | "qualityJudge1" | "qualityJudge2" | "returnedMs" | "reportedPipelineUsd", population: { readonly queryIds: readonly string[]; readonly repeats: readonly number[] }): PairedEstimate;
export declare function bootstrapPairedQueries(estimate: PairedEstimate, options: { readonly seed: number; readonly draws: number; readonly confidence: number; readonly metric: "log-ratio" | "difference" }): { readonly lower: number | null; readonly upper: number | null; readonly draws: number; readonly seed: number };
export declare function appendRunObservation(root: string, record: RunObservation): Promise<{ readonly path: string; readonly sha256: string }>;

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
