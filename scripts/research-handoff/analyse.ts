// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { Tiktoken } from "js-tiktoken/lite";
import o200kBase from "js-tiktoken/ranks/o200k_base";
import type {
  Arm,
  AttributionCategory,
  AttributionEstimate,
  MainAttempt,
  MainRequest,
  Phase,
  ReportedUsage,
  RunRecord,
  RunStatus,
  ToolCallRecord,
} from "./contracts.js";
import { assessAdequacy, type AdequacyResult } from "./adequacy.js";
import { checkReturnContract } from "./return-contract.js";
import { PRIMARY_METRIC } from "./config.js";
import { providerInputAttribution, type ProviderInputAttribution } from "./provider-attribution.js";
import { observedPipelineOutcome } from "./outcome.js";

export const TOKENIZER_ID = "js-tiktoken@1.0.21/o200k_base" as const;
export const ATTRIBUTION_SERIALISATION = "Logical contexts are first projected to model-visible messages and declarations, excluding SDK usage, timestamps, details and nestedCalls. Responses reasoning ciphertext is excluded and reported as UTF-8 bytes. Complete projected values and non-string fragments then use recursively key-sorted JSON; recorded strings are encoded verbatim; array order is preserved; object properties whose value is undefined are omitted and undefined array entries become null. Each component fragment is encoded independently." as const;

const encoding = new Tiktoken(o200kBase);
const categories: AttributionCategory[] = [
  "common-instructions-query",
  "arm-declarations-guidance",
  "arguments-scripts",
  "intermediate-research",
  "useful-result-evidence-status",
  "necessary-status",
  "error-recovery",
  "unallocated",
];
const categorySet = new Set<string>(categories);

export class AnalysisInputError extends Error {
  override readonly name = "AnalysisInputError";
}

export interface ObservedTotal {
  /** A cumulative value is present only when every attempt supplied the required fields. */
  value?: number;
  /** Sum of the fields actually observed. This is partial when complete is false. */
  observedValue: number;
  complete: boolean;
  missingAttemptIds: string[];
}

export interface UsageAnalysis {
  attempts: number;
  logicalRequestsWithoutAttempts: number;
  attemptsWithAnyUsage: number;
  attemptsWithCompleteInputOutput: number;
  input: ObservedTotal;
  uncachedInput: ObservedTotal;
  output: ObservedTotal;
  total: ObservedTotal;
  cacheRead: ObservedTotal;
  cacheWrite: ObservedTotal;
  reasoning: ObservedTotal;
  reportedCostUsd: ObservedTotal;
}

export interface RequestAttribution extends AttributionEstimate {
  requestId: string;
  attemptId?: string;
  attemptStatus?: MainAttempt["status"];
  /** Whole proxy estimate minus independently tokenised component sum. */
  componentResidual: number;
  providerAttribution?: ProviderInputAttribution;
}

export interface HandoffCounts {
  topLevelHandoffs: number;
  extraTopLevelHandoffs: number;
  postToolResumptions: number;
  finalAnswerRequests: number;
  finalAnswerResumptions: number;
  additionalResumptions: number;
  transportRetryAttempts: number;
}

export interface AttributionAnalysis {
  logicalRequests: RequestAttribution[];
  attempts: RequestAttribution[];
  cumulativeLogicalContextTokens: number;
  cumulativeTransmittedEstimateTokens: number;
  peakLogicalRequestTokens?: number;
  peakTransmittedRequestTokens?: number;
  finalRetainedContextTokens?: number;
  opaqueReasoningBytes: number;
  generatedArgumentScriptTokens: number;
  generatedRawScriptTokens: number;
  logicalInputArgumentScriptTokens: number;
  laterInputArgumentScriptTokens: number;
  usefulToolReturnTokens: number;
  errorToolReturnTokens: number;
  finalAnswerTokens?: number;
  promptTokens: number;
  systemPromptTokens: number;
  catalogueTokens: number;
}

export interface DownstreamStageAnalysis {
  logicalRequests: number;
  logicalCompletions: number;
  providerAttempts: number;
  providerCompletions: number;
  failures: number;
  incompleteLogicalRequests: number;
  truncatedCompletions: number;
  usage: UsageAnalysis;
  usageSource: "provider-attempts" | "logical-completions" | "none";
  /** Serving routes of final logical completions, not all retry attempts. */
  completionRoutes: Record<string, number>;
  unreportedCompletionRoutes: number;
  outputTextBytes?: number;
  outputTextTokens?: number;
  outputSizeComplete: boolean;
  reportedChargesNanoUsd: number;
  unknownHoldsNanoUsd: number;
  activeReservationsNanoUsd: number;
  /** SDK catalogue-derived values are descriptive estimates, never billing evidence. */
  sdkEstimatedCostUsd: number;
}

export interface DownstreamAnalysis {
  byStage: Record<"search" | "extract" | "collate" | "cache", DownstreamStageAnalysis>;
  providerAttempts: number;
  failures: number;
  truncatedCompletions: number;
  usage: UsageAnalysis;
  reportedChargesNanoUsd: number;
  unknownHoldsNanoUsd: number;
  activeReservationsNanoUsd: number;
  sdkEstimatedCostUsd: number;
  budgetRejected: number;
  problems: string[];
}

export interface RunAnalysis {
  runId: string;
  arm: Arm | "unknown";
  phase: Phase;
  pair?: number;
  status: RunStatus | "unknown";
  analysisError?: string;
  inputMatched: boolean;
  inputComplete: boolean;
  pipelineOutcome?: string;
  /** Event-derived diagnostic; the recorded label and frozen eligibility remain intact. */
  observedPipelineOutcome: string;
  initialInvocationConforms: boolean;
  assignedTopologyConforms: boolean;
  recoveryCalls: number;
  financialControl?: { budgetLimited: boolean; overrun: boolean; activeReservations: boolean };
  observerVerified: boolean;
  /** False for an unfinished run or unverified observer coverage, even when partial records contain zeros. */
  observationComplete: boolean;
  recordedConforms: boolean;
  observedRouteConforms: boolean;
  returnPreserved: boolean;
  conforms: boolean;
  evidenceReadable: boolean;
  adequacy: AdequacyResult;
  requestCount: number;
  providerAttemptCount: number;
  handoffs: HandoffCounts;
  usage: UsageAnalysis;
  cumulativeInputTokens?: number;
  cumulativeOutputTokens?: number;
  cumulativeTotalTokens?: number;
  attribution: AttributionAnalysis;
  downstream: DownstreamAnalysis;
  problems: string[];
}

export const PAIR_METRICS = [
  "cumulativeInputTokens",
  "uncachedInputTokens",
  "cumulativeOutputTokens",
  "cumulativeTotalTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "reasoningTokens",
  "reportedCostUsd",
  "topLevelHandoffs",
  "postToolResumptions",
  "finalAnswerResumptions",
  "additionalResumptions",
  "transportRetryAttempts",
  "peakLogicalRequestTokens",
  "finalRetainedContextTokens",
  "generatedRawScriptTokens",
  "laterInputArgumentScriptTokens",
  "usefulToolReturnTokens",
  "finalAnswerTokens",
  "downstreamInputTokens",
  "downstreamOutputTokens",
  "downstreamTotalTokens",
  "downstreamReportedCostUsd",
  "downstreamUnknownHoldUsd",
  "downstreamTruncatedCompletions",
  "downstreamFailures",
  "extractionOutputTextBytes",
  "collationOutputTextBytes",
] as const;
export type PairMetric = typeof PAIR_METRICS[number];

export interface PairMetricValues {
  baseline?: number;
  candidate?: number;
  /** Candidate minus baseline. Present only when both arms are observed. */
  difference?: number;
}

export interface PairAnalysis {
  pair: number;
  baseline?: RunAnalysis;
  candidate?: RunAnalysis;
  inputIntegrityMatched: boolean;
  aggregationValid: boolean;
  identityProblems: string[];
  metrics: Record<PairMetric, PairMetricValues>;
}

export interface Distribution {
  mean?: number;
  median?: number;
  range?: { minimum: number; maximum: number };
}

export interface MetricSummary {
  metric: PairMetric;
  denominator: number;
  baseline: Distribution;
  candidate: Distribution;
  difference: Distribution;
}

export interface PositiveClaimGate {
  applicable: boolean;
  metric: PairMetric;
  allowed: boolean;
  denominator: number;
  baselineMean?: number;
  candidateMean?: number;
  reasons: string[];
  regressions: PairMetric[];
}

export interface PairAnalysisResult {
  population: { phase: Phase; label: string; excluded: Record<Phase, number> };
  runs: RunAnalysis[];
  pairs: PairAnalysis[];
  statusCounts: Record<RunStatus, number>;
  conformanceCounts: { conforming: number; nonconforming: number };
  adequacyCounts: { adequate: number; inadequate: number; unassessed: number };
  views: { primary: MetricSummary[]; conformingAndAdequate: MetricSummary[] };
  aggregationValid: boolean;
  seriesProblems: string[];
  scheduleProblems: string[];
  positiveClaim: PositiveClaimGate;
}

export interface AnalysisOptions {
  /** Defaults to measured. Select another phase explicitly for a separately labelled view. */
  phase?: Phase;
  positiveClaimMetric?: typeof PRIMARY_METRIC;
}

/** Deterministic JSON used for identities, request estimates and non-string fragments. */
export function serialiseAttribution(value: unknown): string {
  const ancestors = new Set<object>();
  const normalise = (item: unknown, inArray = false): unknown => {
    if (item === undefined) return inArray ? null : undefined;
    if (typeof item === "number" && !Number.isFinite(item)) return null;
    if (item === null || typeof item !== "object") return item;
    const object = item as object;
    if (ancestors.has(object)) throw new AnalysisInputError("Attribution input contains a cycle.");
    ancestors.add(object);
    let result: unknown;
    if (Array.isArray(item)) {
      result = item.map(entry => normalise(entry, true));
    } else {
      const output: Record<string, unknown> = {};
      for (const key of Object.keys(item as Record<string, unknown>).sort()) {
        const normalised = normalise((item as Record<string, unknown>)[key]);
        if (normalised !== undefined) output[key] = normalised;
      }
      result = output;
    }
    ancestors.delete(object);
    return result;
  };
  const normalised = normalise(value);
  return normalised === undefined ? "undefined" : JSON.stringify(normalised) ?? "undefined";
}

export function estimateTokens(text: string): number {
  // Special-token-looking source text is accepted explicitly rather than rejected as model syntax.
  return encoding.encode(text, "all", []).length;
}

function emptyComponents(): Record<AttributionCategory, number> {
  return Object.fromEntries(categories.map(category => [category, 0])) as Record<AttributionCategory, number>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fragmentText(value: unknown): string {
  return typeof value === "string" ? value : serialiseAttribution(value);
}

const toolCallTypes = new Set([
  "toolCall", "tool_call", "tool-call", "tool_use", "tool-use",
  "function_call", "function-call", "custom_tool_call",
]);
const toolResultTypes = new Set([
  "tool_result", "tool-result", "function_call_output", "custom_tool_call_output",
]);
const argumentKeys = new Set(["arguments", "input", "args", "parameters", "code", "script"]);
const toolCallKeys = new Set(["tool_calls", "toolCalls", "function_call", "functionCall"]);
const contentKeys = ["content", "text", "value"] as const;
const structuralKeys = new Set([
  "type", "id", "role", "call_id", "toolCallId", "toolName", "name", "status",
]);

class ModelVisibleProjector {
  opaqueReasoningBytes = 0;

  logical(value: unknown, contextEnvelope = false): unknown {
    if (Array.isArray(value)) return value.map(entry => this.logical(entry));
    if (!isObject(value)) return value;
    const role = value.role;
    if (role === "system") {
      return this.pick(value, ["role", "content", "sections", "toolsAdded", "toolsRemoved"], "logical");
    }
    if (role === "user") return this.pick(value, ["role", "content"], "logical");
    if (role === "assistant") {
      const content = Array.isArray(value.content) ? value.content : [];
      return { role, content: content.flatMap(block => {
        const projected = this.assistantBlock(block);
        return projected === undefined ? [] : [projected];
      }) };
    }
    if (role === "toolResult") {
      return this.pick(value, ["role", "toolCallId", "toolName", "content"], "logical");
    }
    const output: Record<string, unknown> = {};
    if (contextEnvelope) {
      // Only a request root is a Context. Nested sections and arguments are not envelopes.
      for (const key of ["messages", "systemPrompt", "tools"]) {
        if (key in value) output[key] = this.logical(value[key]);
      }
      return output;
    }
    // Nested model-visible objects retain every field, including a field named tools.
    for (const [key, entry] of Object.entries(value)) output[key] = this.logical(entry);
    return output;
  }

  wire(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(entry => this.wire(entry));
    if (!isObject(value)) return value;
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === "encrypted_content" && typeof entry === "string") {
        this.opaqueReasoningBytes += Buffer.byteLength(entry, "utf8");
        continue;
      }
      output[key] = this.wire(entry);
    }
    return output;
  }

  private assistantBlock(block: unknown): unknown {
    if (!isObject(block)) return undefined;
    if (block.type === "text") return this.pick(block, ["type", "text"], "logical");
    if (block.type === "toolCall") {
      return this.pick(block, ["type", "id", "name", "arguments", "namespace"], "logical");
    }
    if (block.type !== "thinking") return undefined;
    if (typeof block.thinkingSignature !== "string") return undefined;
    try {
      const reasoning = JSON.parse(block.thinkingSignature) as unknown;
      return this.wire(reasoning);
    } catch {
      if (block.redacted === true) this.opaqueReasoningBytes += Buffer.byteLength(block.thinkingSignature, "utf8");
      return undefined;
    }
  }

  private pick(value: Record<string, unknown>, keys: string[], mode: "logical" | "wire"): Record<string, unknown> {
    const output: Record<string, unknown> = {};
    for (const key of keys) {
      if (key in value) output[key] = mode === "logical" ? this.logical(value[key]) : this.wire(value[key]);
    }
    return output;
  }
}

class RequestAttributor {
  readonly componentTokens = emptyComponents();
  private readonly erroredCallIds = new Set<string>();

  constructor(private readonly record: RunRecord) {
    for (const call of record.toolCalls) {
      if (call.isError) {
        this.erroredCallIds.add(call.id);
        this.erroredCallIds.add(call.id.split("|")[0]);
      }
    }
  }

  visit(value: unknown, category: AttributionCategory = "unallocated"): void {
    if (typeof value === "string") {
      if (category === "unallocated" && value === this.record.prompt) {
        const paragraphs = value.split("\n\n");
        if (paragraphs.length >= 5) {
          // The frozen taskPrompt template places the arm-specific route in paragraph two.
          for (const [index, paragraph] of paragraphs.entries()) {
            const selected = index === 1 ? "arm-declarations-guidance" : "common-instructions-query";
            this.componentTokens[selected] += estimateTokens(paragraph);
          }
          return;
        }
      }
      const selected = category === "unallocated" && value === this.record.prompt
        ? "common-instructions-query" : category;
      this.componentTokens[selected] += estimateTokens(value);
      return;
    }
    if (value === null || typeof value !== "object") {
      this.componentTokens[category] += estimateTokens(fragmentText(value));
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) this.visit(entry, category);
      return;
    }
    if (!isObject(value)) return;

    const explicit = value.attributionCategory;
    if (typeof explicit === "string" && categorySet.has(explicit)) {
      const content = contentKeys.find(key => key in value);
      if (content) {
        this.visit(value[content], explicit as AttributionCategory);
        return;
      }
    }

    const role = value.role;
    if (role === "system" || role === "developer") {
      this.visitMessage(value, "unallocated");
      return;
    }
    if (role === "user") {
      this.visitMessage(value, "unallocated");
      return;
    }
    if (role === "assistant") {
      this.visitAssistant(value);
      return;
    }
    if (role === "tool" || role === "function" || role === "toolResult") {
      this.visitToolResult(value);
      return;
    }
    if (typeof value.type === "string" && toolCallTypes.has(value.type)) {
      this.visitToolCall(value);
      return;
    }
    if (typeof value.type === "string" && toolResultTypes.has(value.type)) {
      this.visitToolResult(value);
      return;
    }

    for (const [key, entry] of Object.entries(value)) {
      if ((key === "tools" || key === "toolCatalogue" || key === "catalogue") && category === "unallocated") {
        this.visitDeclarations(entry);
      } else if ((key === "system" || key === "systemPrompt" || key === "instructions") && category === "unallocated") {
        this.visit(entry, "unallocated");
      } else if (toolCallKeys.has(key)) {
        this.visitToolCall(entry);
      } else if (!structuralKeys.has(key) && key !== "encrypted_content") {
        this.visit(entry, category);
      }
    }
  }

  private visitDeclarations(value: unknown): void {
    // Schemas and identifiers are model-visible too. Do not interpret their
    // role/type/name keys as transcript metadata or tool calls.
    this.componentTokens["arm-declarations-guidance"] += estimateTokens(fragmentText(value));
  }

  private visitMessage(message: Record<string, unknown>, category: AttributionCategory): void {
    for (const key of ["content", "text", "sections"]) {
      if (key in message) this.visitContent(message[key], category);
    }
    for (const key of ["tools", "toolsAdded", "toolsRemoved"]) {
      if (key in message) this.visitDeclarations(message[key]);
    }
  }

  private visitAssistant(message: Record<string, unknown>): void {
    if ("content" in message) this.visitContent(message.content, "unallocated");
    for (const key of toolCallKeys) if (key in message) this.visitToolCall(message[key]);
  }

  private visitContent(value: unknown, category: AttributionCategory): void {
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (isObject(entry) && typeof entry.type === "string" && toolCallTypes.has(entry.type)) {
          this.visitToolCall(entry);
        } else if (isObject(entry) && typeof entry.type === "string" && toolResultTypes.has(entry.type)) {
          this.visitToolResult(entry);
        } else {
          this.visit(entry, category);
        }
      }
      return;
    }
    this.visit(value, category);
  }

  private visitToolCall(call: unknown): void {
    if (Array.isArray(call)) {
      for (const entry of call) this.visitToolCall(entry);
      return;
    }
    if (!isObject(call)) {
      this.visit(call, "arguments-scripts");
      return;
    }
    for (const [key, value] of Object.entries(call)) {
      if (argumentKeys.has(key)) this.visit(value, "arguments-scripts");
      else if (key === "function") this.visitToolCall(value);
    }
  }

  private visitToolResult(result: Record<string, unknown>): void {
    const category = this.hasError(result) ? "error-recovery" : "useful-result-evidence-status";
    for (const key of ["content", "text", "resultText", "result", "output"]) {
      if (key in result) this.visitContent(result[key], category);
    }
  }

  private hasError(value: Record<string, unknown>): boolean {
    const callId = value.toolCallId ?? value.call_id;
    return value.isError === true || value.is_error === true || value.status === "error"
      || (typeof callId === "string" && this.erroredCallIds.has(callId));
  }
}

function estimateRequest(
  value: unknown,
  record: RunRecord,
  requestId: string,
  attempt?: MainAttempt,
): RequestAttribution {
  const projector = new ModelVisibleProjector();
  const projected = attempt ? projector.wire(value) : projector.logical(value, true);
  const attributor = new RequestAttributor(record);
  attributor.visit(projected);
  const wholeRequestTokens = estimateTokens(serialiseAttribution(projected));
  const providerInputTokens = validNonnegative(attempt?.usage?.input) ? attempt?.usage?.input : undefined;
  const componentTokenSum = Object.values(attributor.componentTokens).reduce((sum, count) => sum + count, 0);
  return {
    requestId,
    attemptId: attempt?.id,
    attemptStatus: attempt?.status,
    tokenizer: TOKENIZER_ID,
    componentTokens: attributor.componentTokens,
    componentTokenSum,
    componentResidual: wholeRequestTokens - componentTokenSum,
    ...(attempt ? { providerAttribution: providerInputAttribution(attempt) } : {}),
    opaqueReasoningBytes: projector.opaqueReasoningBytes,
    wholeRequestTokens,
    providerInputTokens,
    residual: providerInputTokens === undefined ? undefined : providerInputTokens - wholeRequestTokens,
  };
}

function validNonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validateUsage(usage: ReportedUsage | undefined, attemptId: string): void {
  if (!usage) return;
  for (const field of ["input", "output", "cacheRead", "cacheWrite", "reasoning", "reportedCostUsd"] as const) {
    const value = usage[field];
    if (value !== undefined && !validNonnegative(value)) {
      throw new AnalysisInputError(`Attempt ${attemptId} has invalid ${field} usage.`);
    }
  }
  if (usage.input !== undefined && usage.cacheRead !== undefined && usage.cacheRead > usage.input) {
    throw new AnalysisInputError(`Attempt ${attemptId} reports cached input ${usage.cacheRead} above total input ${usage.input}.`);
  }
}

function sumField(
  attempts: MainAttempt[],
  select: (usage: ReportedUsage, attempt: MainAttempt) => number | undefined,
): ObservedTotal {
  const missingAttemptIds: string[] = [];
  let observedValue = 0;
  for (const attempt of attempts) {
    const value = select(attempt.usage ?? {}, attempt);
    if (value === undefined) missingAttemptIds.push(attempt.id);
    else observedValue += value;
  }
  return {
    value: attempts.length > 0 && missingAttemptIds.length === 0 ? observedValue : undefined,
    observedValue,
    complete: attempts.length > 0 && missingAttemptIds.length === 0,
    missingAttemptIds,
  };
}

function attemptUncachedInput(attempt: MainAttempt): number | undefined {
  if (isObject(attempt.rawUsage)) {
    const details = isObject(attempt.rawUsage.input_tokens_details) ? attempt.rawUsage.input_tokens_details : undefined;
    if (validNonnegative(attempt.rawUsage.input_tokens) && details && validNonnegative(details.cached_tokens)) {
      if (details.cached_tokens > attempt.rawUsage.input_tokens) {
        throw new AnalysisInputError(`Attempt ${attempt.id} reports raw cached input above raw total input.`);
      }
      return attempt.rawUsage.input_tokens - details.cached_tokens;
    }
  }
  return attempt.usage?.input !== undefined && attempt.usage.cacheRead !== undefined
    ? attempt.usage.input - attempt.usage.cacheRead : undefined;
}

function analyseUsage(requests: MainRequest[]): UsageAnalysis {
  const attempts = requests.flatMap(request => request.attempts);
  const missingLogicalIds = requests.filter(request => request.attempts.length === 0).map(request => `logical:${request.id}`);
  const input = sumField(attempts, usage => usage.input);
  const uncachedInput = sumField(attempts, (_usage, attempt) => attemptUncachedInput(attempt));
  const output = sumField(attempts, usage => usage.output);
  const totalMissing = [...new Set([...input.missingAttemptIds, ...output.missingAttemptIds])];
  const total: ObservedTotal = {
    value: attempts.length > 0 && totalMissing.length === 0 ? input.observedValue + output.observedValue : undefined,
    observedValue: input.observedValue + output.observedValue,
    complete: attempts.length > 0 && totalMissing.length === 0,
    missingAttemptIds: totalMissing,
  };
  const usage: UsageAnalysis = {
    attempts: attempts.length,
    logicalRequestsWithoutAttempts: missingLogicalIds.length,
    attemptsWithAnyUsage: attempts.filter(attempt => attempt.usage && Object.values(attempt.usage).some(value => value !== undefined)).length,
    attemptsWithCompleteInputOutput: attempts.filter(attempt => validNonnegative(attempt.usage?.input) && validNonnegative(attempt.usage?.output)).length,
    input,
    uncachedInput,
    output,
    total,
    cacheRead: sumField(attempts, usage => usage.cacheRead),
    cacheWrite: sumField(attempts, usage => usage.cacheWrite),
    reasoning: sumField(attempts, usage => usage.reasoning),
    reportedCostUsd: sumField(attempts, usage => usage.reportedCostUsd),
  };
  for (const field of ["input", "uncachedInput", "output", "total", "cacheRead", "cacheWrite", "reasoning", "reportedCostUsd"] as const) {
    if (missingLogicalIds.length > 0) {
      usage[field].value = undefined;
      usage[field].complete = false;
      usage[field].missingAttemptIds.push(...missingLogicalIds);
    }
  }
  return usage;
}

function validateSequence(requests: MainRequest[]): void {
  const requestIds = new Set<string>();
  const attemptIds = new Set<string>();
  let finalAnswerRequests = 0;
  for (const [index, request] of requests.entries()) {
    if (!request.id || requestIds.has(request.id)) {
      throw new AnalysisInputError(`Duplicate or empty logical request identity at position ${index}.`);
    }
    requestIds.add(request.id);
    const expected = requests[0]?.logicalIndex === 0 ? index : index + 1;
    if (request.logicalIndex !== expected) {
      throw new AnalysisInputError(`Logical request ${request.id} has inconsistent index ${request.logicalIndex}; expected ${expected}.`);
    }
    if (index === 0 && request.afterToolCall) {
      throw new AnalysisInputError(`Initial logical request ${request.id} cannot follow a tool call.`);
    }
    if (request.finalAnswerProducing) finalAnswerRequests += 1;
    for (const attempt of request.attempts) {
      if (!attempt.id || attemptIds.has(attempt.id)) {
        throw new AnalysisInputError(`Duplicate or empty provider attempt identity ${attempt.id || "at " + request.id}.`);
      }
      attemptIds.add(attempt.id);
      validateUsage(attempt.usage, attempt.id);
    }
  }
  if (finalAnswerRequests > 1) {
    throw new AnalysisInputError("More than one logical request is marked as final-answer-producing.");
  }
}

function validateToolCalls(toolCalls: ToolCallRecord[]): void {
  const ids = new Set<string>();
  for (const call of toolCalls) {
    if (!call.id || ids.has(call.id)) throw new AnalysisInputError(`Duplicate or empty tool-call identity ${call.id || "(empty)"}.`);
    if (call.parentToolCallId === call.id) throw new AnalysisInputError(`Tool call ${call.id} cannot be its own parent.`);
    ids.add(call.id);
  }
}

function rawScript(input: unknown): string | undefined {
  if (typeof input === "string") return input;
  if (!isObject(input)) return undefined;
  for (const key of ["code", "script"]) {
    if (typeof input[key] === "string") return input[key] as string;
  }
  return undefined;
}

type DownstreamStage = "search" | "extract" | "collate" | "cache";
interface DownstreamAttemptState { usage?: ReportedUsage; failed: boolean }
interface DownstreamAccumulator {
  logicalRequests: number;
  logicalCompletions: number;
  logicalUsages: Array<ReportedUsage | undefined>;
  logicalOutputs: Array<string | undefined>;
  attempts: Map<string, DownstreamAttemptState>;
  completions: Set<string>;
  truncated: Set<string>;
  outputTexts: Map<string, string>;
  reportedChargesNanoUsd: number;
  unknownHoldsNanoUsd: number;
  activeReservations: Map<string, number>;
  sdkEstimatedCostUsd: number;
  logicalSdkEstimatedCostUsd: number;
  completionRoutes: Map<string, number>;
  unreportedCompletionRoutes: number;
}

function downstreamAccumulator(): DownstreamAccumulator {
  return {
    logicalRequests: 0,
    logicalCompletions: 0,
    logicalUsages: [],
    logicalOutputs: [],
    attempts: new Map(),
    completions: new Set(),
    truncated: new Set(),
    outputTexts: new Map(),
    reportedChargesNanoUsd: 0,
    unknownHoldsNanoUsd: 0,
    activeReservations: new Map(),
    sdkEstimatedCostUsd: 0,
    logicalSdkEstimatedCostUsd: 0,
    completionRoutes: new Map(),
    unreportedCompletionRoutes: 0,
  };
}

function nonnegativeField(value: unknown): number | undefined {
  return validNonnegative(value) ? value : undefined;
}

function downstreamUsage(raw: unknown): ReportedUsage | undefined {
  if (!isObject(raw)) return undefined;
  const inputDetails = isObject(raw.prompt_tokens_details) ? raw.prompt_tokens_details
    : isObject(raw.input_tokens_details) ? raw.input_tokens_details : {};
  const outputDetails = isObject(raw.completion_tokens_details) ? raw.completion_tokens_details
    : isObject(raw.output_tokens_details) ? raw.output_tokens_details : {};
  const usage: ReportedUsage = {
    input: nonnegativeField(raw.input) ?? nonnegativeField(raw.prompt_tokens) ?? nonnegativeField(raw.input_tokens),
    output: nonnegativeField(raw.output) ?? nonnegativeField(raw.completion_tokens) ?? nonnegativeField(raw.output_tokens),
    cacheRead: nonnegativeField(raw.cacheRead) ?? nonnegativeField(raw.cached_tokens)
      ?? nonnegativeField(inputDetails.cached_tokens),
    cacheWrite: nonnegativeField(raw.cacheWrite) ?? nonnegativeField(raw.cache_write_tokens)
      ?? nonnegativeField(inputDetails.cache_write_tokens),
    reasoning: nonnegativeField(raw.reasoning) ?? nonnegativeField(raw.reasoning_tokens)
      ?? nonnegativeField(outputDetails.reasoning_tokens),
    reportedCostUsd: nonnegativeField(raw.cost),
  };
  return Object.values(usage).some(value => value !== undefined) ? usage : undefined;
}

function sdkEstimate(usage: unknown): number {
  if (!isObject(usage) || !isObject(usage.cost) || usage.cost.totalFromProvider === true) return 0;
  return nonnegativeField(usage.cost.total) ?? 0;
}

function visibleCompletionText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  return content.flatMap(block => {
    if (!isObject(block)) return [];
    if ((block.type === "text" || block.type === "output_text") && typeof block.text === "string") return [block.text];
    return [];
  }).join("\n");
}

function eventStage(event: RunRecord["adapterEvents"][number]): DownstreamStage | undefined {
  return event.stage === "search" || event.stage === "extract" || event.stage === "collate" || event.stage === "cache"
    ? event.stage : undefined;
}

function finishDownstreamStage(accumulator: DownstreamAccumulator): DownstreamStageAnalysis {
  const providerAttempts = [...accumulator.attempts].map(([id, attempt]): MainAttempt => ({
    id,
    startedAt: "",
    payload: undefined,
    wireEncoding: "synthetic",
    status: attempt.failed ? "error" : "completed",
    usage: attempt.usage,
  }));
  const useLogical = providerAttempts.length === 0 && accumulator.logicalCompletions > 0;
  const attempts = useLogical ? accumulator.logicalUsages.map((usage, index): MainAttempt => ({
    id: `logical-${index + 1}`, startedAt: "", payload: undefined, wireEncoding: "synthetic",
    status: "completed", usage,
  })) : providerAttempts;
  const usage = analyseUsage(attempts.length ? [{
    id: "downstream", logicalIndex: 0, context: undefined, attempts,
    afterToolCall: false, finalAnswerProducing: false,
  }] : []);
  const outputSizeComplete = useLogical
    ? accumulator.logicalOutputs.length > 0 && accumulator.logicalOutputs.every(text => text !== undefined)
    : attempts.length > 0 && [...accumulator.attempts.keys()].every(id => accumulator.outputTexts.has(id));
  const outputText = useLogical
    ? accumulator.logicalOutputs.filter((text): text is string => text !== undefined).join("\n")
    : [...accumulator.outputTexts.values()].join("\n");
  return {
    logicalRequests: accumulator.logicalRequests,
    logicalCompletions: accumulator.logicalCompletions,
    providerAttempts: accumulator.attempts.size,
    providerCompletions: accumulator.completions.size,
    failures: [...accumulator.attempts.values()].filter(attempt => attempt.failed).length,
    incompleteLogicalRequests: Math.max(0, accumulator.logicalRequests - accumulator.logicalCompletions),
    truncatedCompletions: accumulator.truncated.size,
    usage,
    usageSource: useLogical ? "logical-completions" : attempts.length > 0 ? "provider-attempts" : "none",
    completionRoutes: Object.fromEntries([...accumulator.completionRoutes].sort(([a], [b]) => a.localeCompare(b))),
    unreportedCompletionRoutes: accumulator.unreportedCompletionRoutes,
    outputTextBytes: outputSizeComplete ? Buffer.byteLength(outputText, "utf8") : undefined,
    outputTextTokens: outputSizeComplete ? estimateTokens(outputText) : undefined,
    outputSizeComplete,
    reportedChargesNanoUsd: accumulator.reportedChargesNanoUsd,
    unknownHoldsNanoUsd: accumulator.unknownHoldsNanoUsd,
    activeReservationsNanoUsd: [...accumulator.activeReservations.values()].reduce((sum, value) => sum + value, 0),
    sdkEstimatedCostUsd: useLogical
      ? accumulator.logicalSdkEstimatedCostUsd : accumulator.sdkEstimatedCostUsd,
  };
}

function analyseDownstream(record: RunRecord): DownstreamAnalysis {
  const byStage: Record<DownstreamStage, DownstreamAccumulator> = {
    search: downstreamAccumulator(), extract: downstreamAccumulator(),
    collate: downstreamAccumulator(), cache: downstreamAccumulator(),
  };
  const problems: string[] = [];
  let budgetRejected = 0;
  const attemptStages = new Map<string, DownstreamStage>();
  for (const event of record.adapterEvents) {
    const stage = eventStage(event);
    if (stage && event.kind === "pipeline-attempt" && typeof event.data.id === "string") {
      attemptStages.set(event.data.id, stage);
    }
  }
  for (const event of record.adapterEvents) {
    const data = event.data;
    const id = typeof data.id === "string" ? data.id : undefined;
    if (event.kind === "budget-rejected") {
      budgetRejected += 1;
      const rejectedStage = id ? attemptStages.get(id) : undefined;
      if (rejectedStage) byStage[rejectedStage].activeReservations.delete(id as string);
      continue;
    }
    const stage = eventStage(event) ?? (id ? attemptStages.get(id) : undefined);
    if (!stage) continue;
    const accumulator = byStage[stage];
    if (event.kind === "model-request") accumulator.logicalRequests += 1;
    if (event.kind === "model-completion") {
      accumulator.logicalCompletions += 1;
      if (typeof data.routeProvider === "string" && data.routeProvider.trim()) {
        accumulator.completionRoutes.set(data.routeProvider, (accumulator.completionRoutes.get(data.routeProvider) ?? 0) + 1);
      } else accumulator.unreportedCompletionRoutes += 1;
      accumulator.logicalUsages.push(downstreamUsage(data.usageEstimate));
      accumulator.logicalOutputs.push(typeof data.text === "string" ? data.text : undefined);
      accumulator.logicalSdkEstimatedCostUsd += sdkEstimate(data.usageEstimate);
    }
    if (event.kind === "pipeline-attempt") {
      if (!id) problems.push(`${stage}: pipeline-attempt has no id.`);
      else if (accumulator.attempts.has(id)) problems.push(`${stage}: duplicate pipeline-attempt ${id}.`);
      else accumulator.attempts.set(id, { failed: false });
    }
    if (event.kind === "pipeline-completion" || event.kind === "pipeline-error") {
      if (!id) {
        problems.push(`${stage}: ${event.kind} has no id.`);
        continue;
      }
      const attempt = accumulator.attempts.get(id) ?? { failed: false };
      accumulator.attempts.set(id, attempt);
      attempt.usage = downstreamUsage(data.rawUsage) ?? downstreamUsage(data.sdkUsageEstimate);
      if (event.kind === "pipeline-error") {
        attempt.failed = true;
      } else {
        accumulator.completions.add(id);
        const text = visibleCompletionText(data.content);
        if (text !== undefined) accumulator.outputTexts.set(id, text);
        if (data.stopReason === "length") accumulator.truncated.add(id);
        if (data.stopReason === "error" || data.stopReason === "aborted"
          || (typeof data.error === "string" && data.error.length > 0)) attempt.failed = true;
        accumulator.sdkEstimatedCostUsd += sdkEstimate(data.sdkUsageEstimate);
      }
    }
    if (event.kind === "budget-reserved" && id) {
      accumulator.activeReservations.set(id, nonnegativeField(data.boundNanoUsd) ?? 0);
    }
    if (event.kind === "budget-settled" && id) {
      const reported = nonnegativeField(data.reportedNanoUsd);
      const bound = nonnegativeField(data.boundNanoUsd);
      if (reported === undefined) problems.push(`${stage}: budget-settled ${id} has no valid reported charge.`);
      else accumulator.reportedChargesNanoUsd += reported;
      if (reported !== undefined && bound !== undefined && reported > bound) {
        problems.push(`${stage}: provider charge exceeded its reservation for ${id}.`);
      }
      accumulator.activeReservations.delete(id);
    }
    if (event.kind === "budget-unknown" && id) {
      accumulator.unknownHoldsNanoUsd += nonnegativeField(data.heldNanoUsd) ?? 0;
      accumulator.activeReservations.delete(id);
    }
  }
  const stages = Object.fromEntries((Object.keys(byStage) as DownstreamStage[]).map(stage =>
    [stage, finishDownstreamStage(byStage[stage])])) as Record<DownstreamStage, DownstreamStageAnalysis>;
  const stageList = Object.values(stages);
  const aggregateUsage: UsageAnalysis = {
    attempts: stageList.reduce((sum, stage) => sum + stage.usage.attempts, 0),
    logicalRequestsWithoutAttempts: stageList.reduce((sum, stage) => sum + stage.usage.logicalRequestsWithoutAttempts, 0),
    attemptsWithAnyUsage: stageList.reduce((sum, stage) => sum + stage.usage.attemptsWithAnyUsage, 0),
    attemptsWithCompleteInputOutput: stageList.reduce((sum, stage) => sum + stage.usage.attemptsWithCompleteInputOutput, 0),
    input: sumField([], () => undefined),
    uncachedInput: sumField([], () => undefined),
    output: sumField([], () => undefined),
    total: sumField([], () => undefined),
    cacheRead: sumField([], () => undefined),
    cacheWrite: sumField([], () => undefined),
    reasoning: sumField([], () => undefined),
    reportedCostUsd: sumField([], () => undefined),
  };
  const usageStages = stageList.filter(stage => stage.usage.attempts > 0);
  for (const field of ["input", "uncachedInput", "output", "total", "cacheRead", "cacheWrite", "reasoning", "reportedCostUsd"] as const) {
    const complete = usageStages.length > 0 && usageStages.every(stage => stage.usage[field].complete);
    const observedValue = stageList.reduce((sum, stage) => sum + stage.usage[field].observedValue, 0);
    aggregateUsage[field] = {
      value: complete ? observedValue : undefined,
      observedValue,
      complete,
      missingAttemptIds: usageStages.flatMap(stage => stage.usage[field].missingAttemptIds),
    };
  }
  return {
    byStage: stages,
    providerAttempts: stageList.reduce((sum, stage) => sum + stage.providerAttempts, 0),
    failures: stageList.reduce((sum, stage) => sum + stage.failures + stage.incompleteLogicalRequests, 0),
    truncatedCompletions: stageList.reduce((sum, stage) => sum + stage.truncatedCompletions, 0),
    usage: aggregateUsage,
    reportedChargesNanoUsd: stageList.reduce((sum, stage) => sum + stage.reportedChargesNanoUsd, 0),
    unknownHoldsNanoUsd: stageList.reduce((sum, stage) => sum + stage.unknownHoldsNanoUsd, 0),
    activeReservationsNanoUsd: stageList.reduce((sum, stage) => sum + stage.activeReservationsNanoUsd, 0),
    sdkEstimatedCostUsd: stageList.reduce((sum, stage) => sum + stage.sdkEstimatedCostUsd, 0),
    budgetRejected,
    problems,
  };
}

function analyseAttribution(record: RunRecord): AttributionAnalysis {
  const logicalRequests = record.requests.map(request => estimateRequest(request.context, record, request.id));
  const attempts = record.requests.flatMap(request =>
    request.attempts.map(attempt => estimateRequest(attempt.payload, record, request.id, attempt)));
  const topLevelCalls = record.toolCalls.filter(call => !call.parentToolCallId);
  const generatedRawScriptTokens = topLevelCalls.reduce((total, call) => {
    const script = call.name === "codemode" ? rawScript(call.input) : undefined;
    return total + (script === undefined ? 0 : estimateTokens(script));
  }, 0);
  const generatedArgumentScriptTokens = topLevelCalls.reduce(
    (total, call) => total + estimateTokens(fragmentText(call.input)), 0);
  const usefulToolReturnTokens = topLevelCalls.reduce(
    (total, call) => total + (!call.isError && call.resultText !== undefined ? estimateTokens(call.resultText) : 0), 0);
  const errorToolReturnTokens = topLevelCalls.reduce(
    (total, call) => total + (call.isError && call.resultText !== undefined ? estimateTokens(call.resultText) : 0), 0);
  const logicalContextSizes = logicalRequests.map(request => request.wholeRequestTokens);
  const transmittedSizes = attempts.map(attempt => attempt.wholeRequestTokens);
  const finalProjector = new ModelVisibleProjector();
  const projectedFinalMessages = finalProjector.logical(record.finalMessages);
  return {
    logicalRequests,
    attempts,
    cumulativeLogicalContextTokens: logicalContextSizes.reduce((sum, value) => sum + value, 0),
    cumulativeTransmittedEstimateTokens: transmittedSizes.reduce((sum, value) => sum + value, 0),
    peakLogicalRequestTokens: logicalContextSizes.length ? Math.max(...logicalContextSizes) : undefined,
    peakTransmittedRequestTokens: transmittedSizes.length ? Math.max(...transmittedSizes) : undefined,
    finalRetainedContextTokens: record.finalMessages.length > 0
      ? estimateTokens(serialiseAttribution(projectedFinalMessages)) : undefined,
    opaqueReasoningBytes: [...logicalRequests, ...attempts].reduce(
      (sum, request) => sum + (request.opaqueReasoningBytes ?? 0), finalProjector.opaqueReasoningBytes),
    generatedArgumentScriptTokens,
    generatedRawScriptTokens,
    logicalInputArgumentScriptTokens: logicalRequests.reduce(
      (sum, request) => sum + request.componentTokens["arguments-scripts"], 0),
    laterInputArgumentScriptTokens: attempts.reduce(
      (sum, attempt) => sum + attempt.componentTokens["arguments-scripts"], 0),
    usefulToolReturnTokens,
    errorToolReturnTokens,
    finalAnswerTokens: record.finalAnswer.length > 0 ? estimateTokens(record.finalAnswer) : undefined,
    promptTokens: estimateTokens(record.prompt),
    systemPromptTokens: estimateTokens(record.systemPrompt),
    catalogueTokens: estimateTokens(serialiseAttribution(record.catalogue)),
  };
}

/** Analyse one retained run without filling absent usage or inferring requests from tool events. */
export function analyseRun(record: RunRecord): RunAnalysis {
  if (!isObject(record) || !isObject(record.manifest) || typeof record.manifest.runId !== "string" || !record.manifest.runId) {
    throw new AnalysisInputError("Run identity is empty or the manifest is invalid.");
  }
  if (record.analysisError) throw new AnalysisInputError(record.analysisError);
  if (!validArm(record.manifest.arm) || !validStatus(record.manifest.status)
    || !["synthetic", "diagnostic", "measured"].includes(record.manifest.phase)) {
    throw new AnalysisInputError(`Run ${record.manifest.runId} has invalid arm, phase or status identity.`);
  }
  for (const field of ["protocolSha256", "codeSha256", "corpusSha256", "settingsSha256", "promptSha256"] as const) {
    if (typeof record.manifest[field] !== "string" || !record.manifest[field]) {
      throw new AnalysisInputError(`Run ${record.manifest.runId} lacks ${field} identity.`);
    }
  }
  if (!isObject(record.manifest.host) || !record.manifest.host.path || !record.manifest.host.version
    || !isObject(record.manifest.mainModel) || !record.manifest.mainModel.provider || !record.manifest.mainModel.model) {
    throw new AnalysisInputError(`Run ${record.manifest.runId} lacks host or main-model identity.`);
  }
  if (!Array.isArray(record.requests)) throw new AnalysisInputError(`Run ${record.manifest.runId} has no logical-request array.`);
  if (!Array.isArray(record.toolCalls)) throw new AnalysisInputError(`Run ${record.manifest.runId} has no tool-call array.`);
  if (!Array.isArray(record.adapterEvents)) throw new AnalysisInputError(`Run ${record.manifest.runId} has no adapter-event array.`);
  if (!Array.isArray(record.finalMessages)) throw new AnalysisInputError(`Run ${record.manifest.runId} has no final-message array.`);
  validateSequence(record.requests);
  validateToolCalls(record.toolCalls);

  const attempts = record.requests.flatMap(request => request.attempts);
  const topLevelHandoffs = record.toolCalls.filter(call => !call.parentToolCallId).length;
  const postToolResumptions = record.requests.filter(request => request.afterToolCall).length;
  const finalAnswerRequests = record.requests.filter(request => request.finalAnswerProducing).length;
  const finalAnswerResumptions = record.requests.filter(
    request => request.afterToolCall && request.finalAnswerProducing).length;
  const usage = analyseUsage(record.requests);
  const downstream = analyseDownstream(record);
  const adequacy = assessAdequacy(record.adequacy);
  const additionalResumptions = Math.max(0, postToolResumptions - finalAnswerResumptions);
  const topLevelCalls = record.toolCalls.filter(call => !call.parentToolCallId);
  const nestedCalls = record.toolCalls.filter(call => call.parentToolCallId);
  const noToolErrors = record.toolCalls.every(call => call.isError !== true);
  const baselineRoute = record.manifest.arm === "baseline"
    && record.toolCalls.length === 1 && topLevelCalls[0]?.name === "intelli_research";
  const candidateRoute = record.manifest.arm === "candidate"
    && record.toolCalls.length === 2 && topLevelCalls.length === 1
    && topLevelCalls[0]?.name === "codemode" && nestedCalls.length === 1
    && nestedCalls[0]?.name === "intelli_research"
    && nestedCalls[0]?.parentToolCallId === topLevelCalls[0]?.id;
  const researchCalls = record.toolCalls.filter(call => call.name === "intelli_research");
  const first = topLevelCalls[0];
  const initialInvocationConforms = researchCalls.length === 1 && (record.manifest.arm === "baseline"
    ? first?.name === "intelli_research" && !researchCalls[0].parentToolCallId
    : first?.name === "codemode" && researchCalls[0].parentToolCallId === first.id);
  const recoveryCalls = record.toolCalls.filter(call => call.name === "read").length;
  const assignedTopologyConforms = (baselineRoute || candidateRoute)
    && postToolResumptions === 1 && finalAnswerResumptions === 1 && additionalResumptions === 0;
  const observedRouteConforms = assignedTopologyConforms && noToolErrors;
  const returnContract = checkReturnContract(record);
  const conforms = record.conformance.conforms && observedRouteConforms && returnContract.preserved;
  const evidenceReadable = record.evidenceAccess.readable
    && record.evidenceAccess.reportPaths.some(path => typeof path === "string" && path.trim().length > 0);
  const derivedOverrun = record.adapterEvents.some(event => event.kind === "budget-settled"
    && nonnegativeField(event.data.reportedNanoUsd) !== undefined
    && nonnegativeField(event.data.boundNanoUsd) !== undefined
    && (event.data.reportedNanoUsd as number) > (event.data.boundNanoUsd as number));
  const financialControl = record.financialControl ? {
    budgetLimited: record.financialControl.budgetLimited || downstream.budgetRejected > 0,
    overrun: record.financialControl.overrun || derivedOverrun,
    activeReservations: record.financialControl.activeReservations || downstream.activeReservationsNanoUsd > 0,
  } : undefined;
  const problems = [
    ...record.inputIntegrity.problems,
    ...(record.inputIntegrity.completenessProblems ?? []),
    ...record.conformance.problems,
    ...record.observerCoverage.problems,
    ...record.evidenceAccess.problems,
    ...adequacy.problems,
    ...downstream.problems,
    ...returnContract.problems,
    ...record.adapterEvents.filter(event => event.kind === "research-error")
      .map(event => typeof event.data.message === "string" ? `Research failure: ${event.data.message}` : "Research failed without a recorded message."),
  ];
  if (!record.inputIntegrity.matched) problems.push("Recorded input integrity did not match.");
  if (record.inputIntegrity.complete !== true) problems.push("Input execution-completeness proof is missing or incomplete.");
  if (record.pipelineOutcome !== "completed") problems.push("The pipeline did not record a completed outcome.");
  if (!financialControl) problems.push("Financial-control proof is missing.");
  if (financialControl?.budgetLimited) problems.push("The run was budget-limited.");
  if (financialControl?.overrun) problems.push("The run recorded a budget overrun.");
  if (financialControl?.activeReservations) problems.push("The run has unresolved active reservations.");
  if (usage.logicalRequestsWithoutAttempts > 0) problems.push("At least one logical request has no observed provider attempt.");
  if (!usage.input.complete || !usage.output.complete) problems.push("Provider input/output usage is incomplete.");
  if (!usage.uncachedInput.complete) problems.push("Uncached input decomposition is incomplete.");
  if (!record.observerCoverage.verified) problems.push("Observer coverage was not verified.");
  if (!record.conformance.conforms) problems.push("The recorder marked the assigned route as nonconforming.");
  if (!observedRouteConforms) problems.push("The trace did not match the assigned tool topology and exactly one final-answer resumption with no extra calls or errors.");
  if (!evidenceReadable) problems.push("No readable saved report path was established.");

  return {
    runId: record.manifest.runId,
    arm: record.manifest.arm,
    phase: record.manifest.phase,
    pair: record.manifest.pair,
    status: record.manifest.status,
    inputMatched: record.inputIntegrity.matched,
    inputComplete: record.inputIntegrity.complete === true,
    pipelineOutcome: record.pipelineOutcome,
    observedPipelineOutcome: observedPipelineOutcome(record),
    initialInvocationConforms,
    assignedTopologyConforms,
    recoveryCalls,
    financialControl,
    observerVerified: record.observerCoverage.verified,
    observationComplete: record.observerCoverage.verified
      && !["scheduled", "started", "not-run"].includes(record.manifest.status),
    recordedConforms: record.conformance.conforms,
    observedRouteConforms,
    returnPreserved: returnContract.preserved,
    conforms,
    evidenceReadable,
    adequacy,
    requestCount: record.requests.length,
    providerAttemptCount: attempts.length,
    handoffs: {
      topLevelHandoffs,
      extraTopLevelHandoffs: Math.max(0, topLevelHandoffs - 1),
      postToolResumptions,
      finalAnswerRequests,
      finalAnswerResumptions,
      additionalResumptions,
      transportRetryAttempts: record.requests.reduce((sum, request) => sum + Math.max(0, request.attempts.length - 1), 0),
    },
    usage,
    cumulativeInputTokens: usage.input.value,
    cumulativeOutputTokens: usage.output.value,
    cumulativeTotalTokens: usage.total.value,
    attribution: analyseAttribution(record),
    downstream,
    problems: [...new Set(problems)],
  };
}

function metricValue(run: RunAnalysis, metric: PairMetric): number | undefined {
  // Partial rows remain visible in the inventory, but missing observation is never a numeric zero.
  if (run.analysisError || !run.observationComplete) return undefined;
  switch (metric) {
    case "cumulativeInputTokens": return run.usage.input.value;
    case "uncachedInputTokens": return run.usage.uncachedInput.value;
    case "cumulativeOutputTokens": return run.usage.output.value;
    case "cumulativeTotalTokens": return run.usage.total.value;
    case "cacheReadTokens": return run.usage.cacheRead.value;
    case "cacheWriteTokens": return run.usage.cacheWrite.value;
    case "reasoningTokens": return run.usage.reasoning.value;
    case "reportedCostUsd": return run.usage.reportedCostUsd.value;
    case "topLevelHandoffs": return run.handoffs.topLevelHandoffs;
    case "postToolResumptions": return run.handoffs.postToolResumptions;
    case "finalAnswerResumptions": return run.handoffs.finalAnswerResumptions;
    case "additionalResumptions": return run.handoffs.additionalResumptions;
    case "transportRetryAttempts": return run.handoffs.transportRetryAttempts;
    case "peakLogicalRequestTokens": return run.attribution.peakLogicalRequestTokens;
    case "finalRetainedContextTokens": return run.attribution.finalRetainedContextTokens;
    case "generatedRawScriptTokens": return run.attribution.generatedRawScriptTokens;
    case "laterInputArgumentScriptTokens": return run.attribution.laterInputArgumentScriptTokens;
    case "usefulToolReturnTokens": return run.attribution.usefulToolReturnTokens;
    case "finalAnswerTokens": return run.attribution.finalAnswerTokens;
    case "downstreamInputTokens": return run.downstream.usage.input.value;
    case "downstreamOutputTokens": return run.downstream.usage.output.value;
    case "downstreamTotalTokens": return run.downstream.usage.total.value;
    case "downstreamReportedCostUsd": return run.downstream.reportedChargesNanoUsd / 1e9;
    case "downstreamUnknownHoldUsd": return run.downstream.unknownHoldsNanoUsd / 1e9;
    case "downstreamTruncatedCompletions": return run.downstream.truncatedCompletions;
    case "downstreamFailures": return run.downstream.failures;
    case "extractionOutputTextBytes": return run.downstream.byStage.extract.outputTextBytes;
    case "collationOutputTextBytes": return run.downstream.byStage.collate.outputTextBytes;
  }
}

function emptyPairMetrics(): Record<PairMetric, PairMetricValues> {
  return Object.fromEntries(PAIR_METRICS.map(metric => [metric, {}])) as Record<PairMetric, PairMetricValues>;
}

function distribution(values: number[]): Distribution {
  if (values.length === 0) return {};
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  const median = ordered.length % 2 === 1
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
  return {
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    median,
    range: { minimum: ordered[0], maximum: ordered[ordered.length - 1] },
  };
}

function summarisePairs(pairs: PairAnalysis[]): MetricSummary[] {
  return PAIR_METRICS.map(metric => {
    const complete = pairs.map(pair => pair.metrics[metric]).filter(values => values.difference !== undefined);
    return {
      metric,
      denominator: complete.length,
      baseline: distribution(complete.map(values => values.baseline as number)),
      candidate: distribution(complete.map(values => values.candidate as number)),
      difference: distribution(complete.map(values => values.difference as number)),
    };
  });
}

function sameIdentity(left: unknown, right: unknown): boolean {
  return serialiseAttribution(left) === serialiseAttribution(right);
}

const identityFields = ["corpusSha256", "protocolSha256", "codeSha256", "settingsSha256", "mainModel", "host", "schemaVersion"] as const;

function pairIdentityProblems(baseline: RunRecord, candidate: RunRecord): string[] {
  const problems: string[] = [];
  for (const field of identityFields) {
    if (!sameIdentity(baseline.manifest[field], candidate.manifest[field])) {
      problems.push(`Pair ${baseline.manifest.pair} has mismatched ${field} identities.`);
    }
  }
  return problems;
}

function validArm(value: unknown): value is Arm {
  return value === "baseline" || value === "candidate";
}

function validStatus(value: unknown): value is RunStatus {
  return ["scheduled", "started", "completed", "failed", "nonconforming", "not-run"].includes(String(value));
}

function invalidRun(record: RunRecord, phase: Phase, error: string, index: number): RunAnalysis {
  const manifest: Partial<RunRecord["manifest"]> = isObject(record) && isObject(record.manifest) ? record.manifest : {};
  const arm = validArm(manifest.arm) ? manifest.arm : "baseline";
  const runId = typeof manifest.runId === "string" && manifest.runId ? manifest.runId : `invalid-run-${index + 1}`;
  const safe: RunRecord = {
    manifest: {
      schemaVersion: 1, runId, arm, phase, status: "failed",
      host: { path: "invalid", version: "invalid", dependencies: {} },
      mainModel: { provider: "invalid", model: "invalid" },
      protocolSha256: "invalid", codeSha256: "invalid", corpusSha256: "invalid", settingsSha256: "invalid", promptSha256: "invalid",
      ...(typeof manifest.pair === "number" ? { pair: manifest.pair } : {}),
    },
    prompt: "", systemPrompt: "", catalogue: null, requests: [], toolCalls: [], adapterEvents: [],
    finalAnswer: "", finalMessages: [],
    inputIntegrity: { matched: false, problems: [], complete: false },
    evidenceAccess: { readable: false, reportPaths: [], problems: [] },
    conformance: { conforms: false, problems: [] },
    observerCoverage: { verified: false, problems: [] },
  };
  const row = analyseRun(safe);
  row.runId = runId;
  row.arm = validArm(manifest.arm) ? manifest.arm : "unknown";
  row.status = validStatus(manifest.status) ? manifest.status : "unknown";
  row.analysisError = error;
  row.observationComplete = false;
  row.problems = [error];
  return row;
}

function recordPhase(record: RunRecord): Phase | undefined {
  if (!isObject(record) || !isObject(record.manifest)) return undefined;
  return record.manifest.phase === "synthetic" || record.manifest.phase === "diagnostic" || record.manifest.phase === "measured"
    ? record.manifest.phase : undefined;
}

function timestampProblems(runs: RunAnalysis[], byRunId: Map<string, RunRecord>, phase: Phase): string[] {
  if (phase !== "measured") return [];
  const problems: string[] = [];
  const ordered: RunRecord[] = [];
  for (let pair = 1; pair <= 10; pair += 1) {
    const arms: Arm[] = pair % 2 === 1 ? ["baseline", "candidate"] : ["candidate", "baseline"];
    for (const arm of arms) {
      const run = runs.find(candidate => candidate.pair === pair && candidate.arm === arm && !candidate.analysisError);
      if (!run) {
        problems.push(`Schedule is missing pair ${pair} ${arm}.`);
        continue;
      }
      const record = byRunId.get(run.runId);
      if (!record) {
        problems.push(`Schedule has no retained manifest for ${run.runId}.`);
        continue;
      }
      ordered.push(record);
    }
  }
  for (const [index, record] of ordered.entries()) {
    const start = Date.parse(record.manifest.startedAt ?? "");
    const end = Date.parse(record.manifest.endedAt ?? "");
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      problems.push(`${record.manifest.runId} lacks a valid startedAt/endedAt interval.`);
    }
    if (index === 0) continue;
    const previous = ordered[index - 1];
    const previousStart = Date.parse(previous.manifest.startedAt ?? "");
    const previousEnd = Date.parse(previous.manifest.endedAt ?? "");
    if (Number.isFinite(start) && Number.isFinite(previousStart) && start < previousStart) {
      problems.push(`${record.manifest.runId} starts before ${previous.manifest.runId}, contrary to the frozen order.`);
    }
    if (Number.isFinite(start) && Number.isFinite(previousEnd) && start - previousEnd < 30_000) {
      problems.push(`Gap before ${record.manifest.runId} is ${start - previousEnd} ms, below the 30000 ms minimum.`);
    }
  }
  return problems;
}

function positiveEligibility(run: RunAnalysis): boolean {
  return !run.analysisError && run.status === "completed" && run.conforms
    && run.inputMatched && run.inputComplete && run.pipelineOutcome === "completed"
    && run.observerVerified && run.observationComplete && run.evidenceReadable && run.adequacy.adequate
    && run.usage.uncachedInput.complete && run.usage.uncachedInput.value !== undefined
    && run.financialControl?.budgetLimited === false && run.financialControl.overrun === false
    && run.financialControl.activeReservations === false;
}

function makePositiveClaimGate(
  phase: Phase,
  runs: RunAnalysis[],
  pairs: PairAnalysis[],
  summaries: MetricSummary[],
  seriesProblems: string[],
  scheduleProblems: string[],
): PositiveClaimGate {
  const reasons: string[] = [];
  if (phase !== "measured") reasons.push("Positive claims apply only to the measured population.");
  reasons.push(...seriesProblems, ...scheduleProblems);
  if (runs.length !== 20) reasons.push(`The complete measured population requires 20 runs; found ${runs.length}.`);
  const expectedPairIds = Array.from({ length: 10 }, (_, index) => index + 1);
  if (pairs.length !== 10 || pairs.some((pair, index) => pair.pair !== expectedPairIds[index])
    || pairs.some(pair => !pair.baseline || !pair.candidate)) {
    reasons.push("The complete measured population requires pair identities 1 through 10 with both arms.");
  }
  const ineligible = runs.filter(run => !positiveEligibility(run));
  if (ineligible.length > 0) {
    reasons.push(`Required completion, input, pipeline, observer, uncached-usage, financial, conformance, independent adequacy or evidence proof failed for: ${ineligible.map(run => run.runId).join(", ")}.`);
  }
  const summary = summaries.find(candidate => candidate.metric === PRIMARY_METRIC) as MetricSummary;
  if (summary.denominator !== 10) {
    reasons.push(`Metric ${PRIMARY_METRIC} is observed in ${summary.denominator} pairs rather than all ten.`);
  }
  const baselineMean = summary.difference.mean === undefined ? undefined : summary.baseline.mean;
  const candidateMean = summary.difference.mean === undefined ? undefined : summary.candidate.mean;
  if (baselineMean !== undefined && candidateMean !== undefined && !(candidateMean < baselineMean)) {
    reasons.push(`Candidate mean ${candidateMean} is not strictly lower than baseline mean ${baselineMean} for ${PRIMARY_METRIC}.`);
  }
  const regressions = summaries.filter(other => other.metric !== PRIMARY_METRIC
    && other.difference.mean !== undefined && other.difference.mean > 0).map(other => other.metric);
  return {
    applicable: phase === "measured",
    metric: PRIMARY_METRIC,
    allowed: reasons.length === 0,
    denominator: summary.denominator,
    baselineMean,
    candidateMean,
    reasons: [...new Set(reasons)],
    regressions,
  };
}

/** Build per-run rows and signed paired summaries for one explicitly labelled population. */
export function analysePairs(records: RunRecord[], options: AnalysisOptions = {}): PairAnalysisResult {
  const phase = options.phase ?? "measured";
  if (options.positiveClaimMetric !== undefined && options.positiveClaimMetric !== PRIMARY_METRIC) {
    throw new AnalysisInputError(`The positive metric is frozen to ${PRIMARY_METRIC}.`);
  }
  const selected = records.map((record, index) => ({ record, index }))
    .filter(({ record }) => recordPhase(record) === undefined || recordPhase(record) === phase);
  const excluded: Record<Phase, number> = { synthetic: 0, diagnostic: 0, measured: 0 };
  for (const record of records) {
    const recordPhaseValue = recordPhase(record);
    if (recordPhaseValue && recordPhaseValue !== phase) excluded[recordPhaseValue] += 1;
  }
  const idCounts = new Map<string, number>();
  for (const { record } of selected) {
    if (isObject(record) && isObject(record.manifest) && typeof record.manifest.runId === "string" && record.manifest.runId) {
      idCounts.set(record.manifest.runId, (idCounts.get(record.manifest.runId) ?? 0) + 1);
    }
  }
  const seriesProblems: string[] = [];
  const runs = selected.map(({ record, index }) => {
    const runId = isObject(record) && isObject(record.manifest) ? record.manifest.runId : undefined;
    if (typeof runId === "string" && (idCounts.get(runId) ?? 0) > 1) {
      return invalidRun(record, phase, `Duplicate run identity ${runId}.`, index);
    }
    if (isObject(record) && typeof record.analysisError === "string" && record.analysisError) {
      return invalidRun(record, phase, record.analysisError, index);
    }
    try {
      return analyseRun(record);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return invalidRun(record, phase, `Analysis failed: ${message}`, index);
    }
  }).sort((left, right) =>
    (left.pair ?? Number.MAX_SAFE_INTEGER) - (right.pair ?? Number.MAX_SAFE_INTEGER)
    || (left.arm === right.arm ? left.runId.localeCompare(right.runId) : left.arm === "baseline" ? -1 : 1));
  const byRunId = new Map<string, RunRecord>();
  for (const { record } of selected) {
    if (isObject(record) && isObject(record.manifest) && typeof record.manifest.runId === "string") {
      byRunId.set(record.manifest.runId, record);
    }
  }
  const invalidate = (run: RunAnalysis, problem: string) => {
    run.analysisError = run.analysisError ? `${run.analysisError} ${problem}` : problem;
    run.observationComplete = false;
    run.problems = [...new Set([...run.problems, problem])];
    seriesProblems.push(problem);
  };
  const pairArmCounts = new Map<string, number>();
  for (const run of runs) {
    if (run.analysisError) continue;
    if (run.pair === undefined) {
      if (phase === "measured") invalidate(run, `Measured run ${run.runId} has no pair identity.`);
      continue;
    }
    if (!Number.isInteger(run.pair) || run.pair < 1) {
      invalidate(run, `Run ${run.runId} has invalid pair ${run.pair}.`);
      continue;
    }
    if (!validArm(run.arm)) {
      invalidate(run, `Run ${run.runId} has no valid arm identity.`);
      continue;
    }
    const key = `${run.pair}:${run.arm}`;
    pairArmCounts.set(key, (pairArmCounts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of pairArmCounts) {
    if (count <= 1) continue;
    const [pairText, arm] = key.split(":");
    for (const run of runs.filter(candidate => candidate.pair === Number(pairText) && candidate.arm === arm && !candidate.analysisError)) {
      invalidate(run, `Pair ${pairText} has duplicate ${arm} rows, including ${run.runId}.`);
    }
  }

  const pairArms = new Map<number, Partial<Record<Arm, RunAnalysis>>>();
  for (const run of runs) {
    if (run.analysisError || run.pair === undefined || !validArm(run.arm)) continue;
    const arms = pairArms.get(run.pair) ?? {};
    arms[run.arm] = run;
    pairArms.set(run.pair, arms);
  }
  const pairs: PairAnalysis[] = [...pairArms.entries()].sort(([left], [right]) => left - right).map(([pair, arms]) => {
    const identityProblems = arms.baseline && arms.candidate
      ? pairIdentityProblems(byRunId.get(arms.baseline.runId) as RunRecord, byRunId.get(arms.candidate.runId) as RunRecord) : [];
    seriesProblems.push(...identityProblems);
    const inputIntegrityMatched = arms.baseline?.inputMatched === true && arms.candidate?.inputMatched === true;
    const aggregationValid = !!arms.baseline && !!arms.candidate && inputIntegrityMatched && identityProblems.length === 0;
    const metrics = emptyPairMetrics();
    for (const metric of PAIR_METRICS) {
      const baseline = arms.baseline ? metricValue(arms.baseline, metric) : undefined;
      const candidate = arms.candidate ? metricValue(arms.candidate, metric) : undefined;
      metrics[metric] = {
        baseline,
        candidate,
        difference: aggregationValid && baseline !== undefined && candidate !== undefined ? candidate - baseline : undefined,
      };
    }
    return {
      pair,
      baseline: arms.baseline,
      candidate: arms.candidate,
      inputIntegrityMatched,
      aggregationValid,
      identityProblems,
      metrics,
    };
  });

  const validRecords = runs.filter(run => !run.analysisError).map(run => byRunId.get(run.runId))
    .filter((record): record is RunRecord => !!record);
  const globalIdentityProblems: string[] = [];
  const reference = validRecords[0];
  if (reference) {
    for (const record of validRecords.slice(1)) {
      for (const field of identityFields) {
        if (!sameIdentity(reference.manifest[field], record.manifest[field])) {
          globalIdentityProblems.push(`Series identity ${field} differs between ${reference.manifest.runId} and ${record.manifest.runId}.`);
        }
      }
    }
  }
  seriesProblems.push(...globalIdentityProblems);
  const aggregationValid = globalIdentityProblems.length === 0;
  const aggregatablePairs = aggregationValid ? pairs.filter(pair => pair.aggregationValid) : [];
  const primary = summarisePairs(aggregatablePairs);
  const conformingPairs = aggregatablePairs.filter(pair => pair.baseline && pair.candidate
    && positiveEligibility(pair.baseline) && positiveEligibility(pair.candidate));
  const scheduleProblems = timestampProblems(runs, byRunId, phase);
  const statusCounts: Record<RunStatus, number> = {
    scheduled: 0, started: 0, completed: 0, failed: 0, nonconforming: 0, "not-run": 0,
  };
  for (const run of runs) if (validStatus(run.status)) statusCounts[run.status] += 1;
  const conformanceCounts = {
    conforming: runs.filter(run => run.conforms).length,
    nonconforming: runs.filter(run => !run.conforms).length,
  };
  const adequacyCounts = {
    adequate: runs.filter(run => run.adequacy.adequate).length,
    inadequate: runs.filter(run => !run.adequacy.adequate && run.adequacy.criterionIds.length > 0).length,
    unassessed: runs.filter(run => run.adequacy.criterionIds.length === 0).length,
  };
  return {
    population: {
      phase,
      label: phase === "measured" ? "primary-measured" : `${phase}-separate`,
      excluded,
    },
    runs,
    pairs,
    statusCounts,
    conformanceCounts,
    adequacyCounts,
    views: { primary, conformingAndAdequate: summarisePairs(conformingPairs) },
    aggregationValid,
    seriesProblems: [...new Set(seriesProblems)],
    scheduleProblems: [...new Set(scheduleProblems)],
    positiveClaim: makePositiveClaimGate(phase, runs, pairs, primary, seriesProblems, scheduleProblems),
  };
}

function markdownCell(value: unknown): string {
  if (value === undefined || value === null || value === "") return "unknown";
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function markdownNumber(value: number | undefined): string {
  return value === undefined ? "unknown" : Number.isInteger(value) ? String(value) : String(Number(value.toFixed(9)));
}

const markdownMetrics: PairMetric[] = [
  "cumulativeTotalTokens",
  "cumulativeInputTokens",
  "uncachedInputTokens",
  "cumulativeOutputTokens",
  "postToolResumptions",
  "peakLogicalRequestTokens",
  "finalRetainedContextTokens",
  "downstreamTotalTokens",
  "downstreamOutputTokens",
  "generatedRawScriptTokens",
  "downstreamReportedCostUsd",
  "extractionOutputTextBytes",
  "collationOutputTextBytes",
];

/** Compact run inventory and paired statistics for the coordinator's offline CLI output. */
export function renderAnalysisMarkdown(result: PairAnalysisResult): string {
  const lines = [
    "# Research Handoff Analysis",
    "",
    `Population: ${result.population.label}. Aggregation valid: ${result.aggregationValid ? "yes" : "no"}.`,
    "",
    "Main cumulative input/output/total are provider-reported tokens. Logical and retained context sizes are proxy estimates, not provider counts.",
    `Estimation uses ${TOKENIZER_ID}; opaque reasoning ciphertext is not counted as plaintext. See analysis.json for component estimates, signed residuals and missingness.`,
    "Downstream tokens use raw usage or the explicitly labelled SDK-normalised fallback in analysis.json. Extraction/collation sizes are UTF-8 bytes. Reported charges are USD subtotals; unknown holds and active reservations are separate, so a subtotal is not necessarily total spend.",
    "All differences are candidate minus baseline. Negative values mean lower candidate values, not an automatic benefit claim. Resumptions are counts.",
    ...(result.population.phase === "synthetic" ? ["Synthetic usage is programmed test data, not measured model processing or savings."] : []),
    "",
    "## Counts",
    "",
    `Status: ${Object.entries(result.statusCounts).map(([name, count]) => `${name}: ${count}`).join("; ")}.`,
    `Conformance: ${Object.entries(result.conformanceCounts).map(([name, count]) => `${name}: ${count}`).join("; ")}.`,
    `Assessment checks: ${Object.entries(result.adequacyCounts).map(([name, count]) => `${name}: ${count}`).join("; ")}. The per-run labels distinguish unassessed or incomplete review from a final pass or fail.`,
    "",
    "## Run Inventory",
    "",
    "| Run | Pair | Arm | Status | Analysis Error | Main Input | Uncached Input | Main Output | Main Total | Resumptions | Pipeline | Adequate |",
    "|---|---:|---|---|---|---:|---:|---:|---:|---:|---|---|",
  ];
  for (const run of result.runs) {
    const observed = !run.analysisError && run.observerVerified && run.observationComplete;
    const resumptions = observed ? run.handoffs.postToolResumptions : undefined;
    const adequacy = run.adequacy.criterionIds.length === 0 ? "Not Assessed"
      : !run.adequacy.uniqueCriteria || !run.adequacy.unsupportedClaimStatusKnown ? "Assessment Incomplete"
      : !run.adequacy.independentReview || !run.adequacy.disagreementsResolved ? "Review Incomplete"
      : run.adequacy.adequate ? "Pass" : "Fail";
    lines.push(`| ${markdownCell(run.runId)} | ${markdownCell(run.pair)} | ${run.arm} | ${run.status} | ${run.analysisError ? markdownCell(run.analysisError) : "None"} | ${markdownNumber(observed ? run.cumulativeInputTokens : undefined)} | ${markdownNumber(observed ? run.usage.uncachedInput.value : undefined)} | ${markdownNumber(observed ? run.cumulativeOutputTokens : undefined)} | ${markdownNumber(observed ? run.cumulativeTotalTokens : undefined)} | ${markdownNumber(resumptions)} | ${markdownCell(run.pipelineOutcome)} | ${adequacy} |`);
  }
  lines.push("", "## Execution Diagnostics", "",
    "Initial invocation checks the first call and unique research invocation independently of later recovery and pipeline success. Assigned topology checks the full one-handoff boundary. Recorded conformance and the historical claim gate are unchanged. Serving routes describe final logical collation completions, not every retry attempt.", "",
    "| Run | Initial Invocation | Recovery Reads | Assigned Topology | Recorded Pipeline | Event-Derived Pipeline | Collation Truncations | Collation Text Bytes | Collation Routes |",
    "|---|---|---:|---|---|---|---:|---:|---|");
  for (const run of result.runs) {
    const collate = run.downstream.byStage.collate;
    const routes = Object.entries(collate.completionRoutes).map(([name, count]) => `${name}: ${count}`);
    if (collate.unreportedCompletionRoutes) routes.push(`unknown: ${collate.unreportedCompletionRoutes}`);
    lines.push(`| ${markdownCell(run.runId)} | ${run.analysisError ? "unknown" : run.initialInvocationConforms ? "Matched" : "Not Matched"} | ${run.analysisError ? "unknown" : run.recoveryCalls} | ${run.analysisError ? "unknown" : run.assignedTopologyConforms ? "Matched" : "Not Matched"} | ${markdownCell(run.pipelineOutcome)} | ${run.analysisError ? "unknown" : run.observedPipelineOutcome} | ${run.analysisError ? "unknown" : collate.truncatedCompletions} | ${markdownNumber(collate.outputTextBytes)} | ${markdownCell(routes.join("; "))} |`);
  }
  lines.push("", "## Provider Input Attribution", "",
    "These are cumulative provider-reported input components, not proxy estimates. Values require complete observed requests and reconciled parent-item counts in every attempt. Unknown attribution never becomes zero. Full proxy components and their signed whole-request gaps remain in analysis.json.", "",
    "| Run | Input Tokens | Declaration Input | Instruction Input |",
    "|---|---:|---:|---:|");
  for (const run of result.runs) {
    const attempts = run.attribution.attempts;
    const component = (field: "declarationInputTokens" | "instructionInputTokens"): number | undefined => {
      if (run.analysisError || !run.observationComplete || run.usage.logicalRequestsWithoutAttempts > 0 || !attempts.length
        || attempts.some(attempt => !attempt.providerAttribution?.reconciled || attempt.providerAttribution[field] === undefined)) return undefined;
      return attempts.reduce((sum, attempt) => sum + attempt.providerAttribution![field]!, 0);
    };
    lines.push(`| ${markdownCell(run.runId)} | ${markdownNumber(run.observationComplete ? run.cumulativeInputTokens : undefined)} | ${markdownNumber(component("declarationInputTokens"))} | ${markdownNumber(component("instructionInputTokens"))} |`);
  }
  const affected = result.runs.filter(run => run.analysisError || run.problems.length > 0);
  if (affected.length > 0) {
    lines.push("", "## Per-Run Limitations", "", "| Run | Reasons |", "|---|---|");
    for (const run of affected) lines.push(`| ${markdownCell(run.runId)} | ${markdownCell([run.analysisError, ...run.problems].filter(Boolean).join("; "))} |`);
  }
  lines.push(
    "",
    "## Paired Summaries",
    "",
    "| Metric | Pairs | Baseline Mean | Candidate Mean | Mean Difference | Median Difference | Difference Range |",
    "|---|---:|---:|---:|---:|---:|---|",
  );
  for (const summary of result.views.primary.filter(item => markdownMetrics.includes(item.metric))) {
    lines.push(`| ${summary.metric} | ${summary.denominator} | ${markdownNumber(summary.baseline.mean)} | ${markdownNumber(summary.candidate.mean)} | ${markdownNumber(summary.difference.mean)} | ${markdownNumber(summary.difference.median)} | ${summary.difference.range ? `${markdownNumber(summary.difference.range.minimum)} to ${markdownNumber(summary.difference.range.maximum)}` : "unknown"} |`);
  }
  lines.push(
    "",
    "## Positive Claim",
    "",
    `Allowed: ${result.positiveClaim.allowed ? "yes" : "no"}. Metric: ${result.positiveClaim.metric}. Denominator: ${result.positiveClaim.denominator}.`,
  );
  if (result.positiveClaim.regressions.length > 0) lines.push(`Regressions: ${result.positiveClaim.regressions.join(", ")}.`);
  if (result.positiveClaim.reasons.length > 0) {
    lines.push("", "### Gate Reasons", "");
    for (const reason of [...new Set(result.positiveClaim.reasons)]) lines.push(`- ${reason}`);
  }
  if (result.seriesProblems.length > 0) {
    lines.push("", "### Series Problems", "");
    for (const problem of result.seriesProblems) lines.push(`- ${problem}`);
  }
  if (result.scheduleProblems.length > 0) {
    lines.push("", "### Schedule Problems", "");
    for (const problem of result.scheduleProblems) lines.push(`- ${problem}`);
  }
  return `${lines.join("\n")}\n`;
}
