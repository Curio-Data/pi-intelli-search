// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type { HarvestedCitation } from "./annotations.js";
import type { ModelConfig, ResearchSettings } from "./types.js";
import type { WorkspacePaths } from "./paths.js";

export type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;

export interface PackageIdentity {
  readonly name: string;
  readonly version: string;
  readonly adapter: "pi" | "mcp";
}

export type ResearchStage = "search" | "fetch" | "extract" | "collate" | "cache";

export interface OperationProgress {
  stage: ResearchStage;
  stageIdx: number;
  totalStages: number;
  message: string;
  pct: number;
  subProgress?: { current: number; total: number };
}

export interface SearchParams {
  query: string;
  domains?: string[];
}

export interface ExtractParams {
  url: string;
  title: string;
  content: string;
  query: string;
  focusPrompt?: string;
}

export interface CollateParams {
  // Preserve native permissiveness; standalone validation is a later adapter concern.
  extractions: Array<{
    url: string;
    title: string;
    extraction: string;
    sourceType: string;
    status: string;
  }>;
  query: string;
  searchSummary?: string;
  fullPages?: Array<{ url: string; title: string; content: string }>;
}

export interface ResearchParams extends SearchParams {
  maxUrls?: number;
  focusPrompt?: string;
}

export interface OperationInputs {
  intelli_search: SearchParams;
  intelli_extract: ExtractParams;
  intelli_collate: CollateParams;
  intelli_research: ResearchParams;
}

export type OperationOutcome = "completed" | "no-links" | "fetch-failed" | "extraction-failed";

/** Execution failures throw; degraded research remains a usable result. */
export interface OperationResult<Details = Record<string, unknown>> {
  text: string;
  details: Details;
  outcome: OperationOutcome;
}

export interface ModelBinding {
  role: string;
  config: ModelConfig;
}

export interface ModelRetryConfig {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export type ModelReasoning = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** Provider-reported fields only. Missing usage is not zero usage. */
export interface ModelUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cacheWrite1h?: number;
  reasoning?: number;
  totalTokens?: number;
  /** Provider-reported total when no per-component cost breakdown is supplied. */
  totalCost?: number;
  cost?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

export interface ModelRequest {
  model: ModelConfig;
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  reasoning?: ModelReasoning;
  collectCitations?: boolean;
  /** Adapter-supported customisation; never applied to a different model/provider. */
  payloadPatch?: (payload: Record<string, unknown>) => Record<string, unknown>;
  retry?: ModelRetryConfig;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ModelCompletion {
  text: string;
  citations: HarvestedCitation[];
  usage?: ModelUsage;
}

export interface ModelClient {
  /** Return missing model bindings before paid work. Credential checks remain adapter-owned. */
  preflight(bindings: readonly ModelBinding[]): Promise<ModelBinding[]>;
  /** Adapters invoke the shared model policy exactly once; operations do not retry transport. */
  complete(request: ModelRequest): Promise<ModelCompletion>;
}

/** Implementations must use stderr or a private sink, never protocol stdout. */
export interface OperationLogger {
  error(message: string, error?: unknown): void;
  warn(message: string): void;
}

/** Per-operation values only: no host context or global configuration discovery. */
export interface OperationContext {
  readonly settings: DeepReadonly<ResearchSettings>;
  readonly models: ModelClient;
  readonly paths: WorkspacePaths;
  readonly identity: PackageIdentity;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: OperationProgress) => void;
  readonly logger: OperationLogger;
  readonly now?: () => number;
  readonly random?: () => number;
}

export type Operation<Name extends keyof OperationInputs> = (
  params: OperationInputs[Name],
  context: OperationContext,
) => Promise<OperationResult>;
