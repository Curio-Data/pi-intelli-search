// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// rh-v5 pilot return, recovery and machine checks (PILOT-PROTOCOL.md, Task and
// Routes; Success, Settlement and Reporting). The historical one-handoff
// return-contract.ts and analyse.ts gates stay unchanged for rh-v4 records.

import { createHash } from "node:crypto";
import type { FrozenInputs, RunRecord, ToolCallRecord } from "./contracts.js";
import { analyseUsage, analyseDownstream, analyseAttribution, validateSequence, validateToolCalls } from "./analyse.js";
import { observedPipelineOutcome } from "./outcome.js";
import { PILOT_CODEMODE_MAX_OUTPUT_TOKENS, PILOT_PROFILE } from "./pilot-config.js";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const HEADER = /^Script completed\nWall time \d+\.\d seconds\nOutput:\n/;

export interface AdditionalWork {
  /** Zero-based position among top-level calls; the initial handoff is position 0. */
  position: number;
  id: string;
  name: string;
  logicalRequest?: number;
  input: unknown;
  isError: boolean;
  nested: Array<{ id: string; name: string; input: unknown; isError: boolean }>;
  purpose: "evidence-read" | "codemode-evidence" | "codemode-without-read" | "unpermitted";
  problems: string[];
}
/** Mirrors pinned @earendil-works/pi-codemode 1.5.0 dist/source.js parseCodemodeSource for the first line only. */
export function initialCodemodeOptions(code: unknown): { options?: Record<string, unknown>; problems: string[] } {
  if (typeof code !== "string") return { problems: ["Initial Codemode input has no code string"] };
  const lines = code.split("\n");
  const first = lines[0].replace(/\r$/, "").trimStart();
  if (lines.slice(1).some(line => line.trimStart().startsWith("// @options:"))) return { problems: ["An @options line is not the first line"] };
  if (!first.startsWith("// @options:")) return { problems: ["Initial script has no @options line"] };
  try {
    const value = JSON.parse(first.slice("// @options:".length).trim()) as unknown;
    if (value === null || typeof value !== "object" || Array.isArray(value)) return { problems: ["@options is not a JSON object"] };
    const options = value as Record<string, unknown>, problems: string[] = [];
    if (options.max_output_tokens !== PILOT_CODEMODE_MAX_OUTPUT_TOKENS) problems.push(`max_output_tokens is ${JSON.stringify(options.max_output_tokens)}, not ${PILOT_CODEMODE_MAX_OUTPUT_TOKENS}`);
    if ("timeout_ms" in options) problems.push("timeout_ms is set; the protocol requires it unset");
    for (const key of Object.keys(options)) if (key !== "max_output_tokens" && key !== "timeout_ms") problems.push(`Unsupported @options field ${key}`);
    return { options, problems };
  } catch (error) { return { problems: [`@options is not valid JSON: ${String(error)}`] }; }
}

export interface PilotReturnCheck {
  /** Candidate only: the initial script's options line, verified independently of the returned text. */
  initialOptions: { applicable: boolean; options?: Record<string, unknown>; problems: string[] };
  initialInvocationConforms: boolean;
  initialProblems: string[];
  /** The complete research text reached the model exactly once in the initial handoff. */
  returnPreserved: boolean;
  returnProblems: string[];
  /** Codemode's output budget cut the research return (distinct from model-side truncation). */
  codemodeOutputTruncated: boolean;
  additionalWork: AdditionalWork[];
  recoveryPermitted: boolean;
  fullTopologyConforms: boolean;
  recoveryLimitReached: boolean;
}

function requestIndexByToolCall(record: Pick<RunRecord, "requests">): Map<string, number> {
  const map = new Map<string, number>();
  for (const request of record.requests) {
    const content = (request.assistantMessage as { content?: unknown[] } | undefined)?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const value = block as { type?: string; id?: string };
      if (value?.type === "toolCall" && typeof value.id === "string") map.set(value.id, request.logicalIndex);
    }
  }
  return map;
}
function isEvidencePath(input: unknown): boolean {
  const path = (input as { path?: unknown } | null)?.path;
  return typeof path === "string" && /(^|[\\/])\.search([\\/]|$)/.test(path) && !path.includes("\0");
}

/** Position-and-purpose classification. Every top-level call after the initial handoff is additional work. */
export function checkPilotReturn(record: Pick<RunRecord, "manifest" | "toolCalls" | "adapterEvents" | "requests">): PilotReturnCheck {
  const initialProblems: string[] = [], returnProblems: string[] = [];
  // Defensive defaults: a malformed record yields failing checks rather than a thrown command (F9).
  record = { ...record, toolCalls: Array.isArray(record.toolCalls) ? record.toolCalls : [],
    adapterEvents: Array.isArray(record.adapterEvents) ? record.adapterEvents : [], requests: Array.isArray(record.requests) ? record.requests : [],
    manifest: record.manifest ?? ({ arm: "unknown" } as unknown as RunRecord["manifest"]) };
  const top = record.toolCalls.filter(call => !call.parentToolCallId);
  const nestedOf = (parent: ToolCallRecord) => record.toolCalls.filter(call => call.parentToolCallId === parent.id);
  const research = record.toolCalls.filter(call => call.name === "intelli_research");
  const results = record.adapterEvents.filter(event => event.kind === "research-result");
  const admissions = record.adapterEvents.filter(event => event.kind === "research-admitted").length;
  const rejected = record.adapterEvents.some(event => event.kind === "admission-rejected");
  const requestOf = requestIndexByToolCall(record);
  const initial = top[0];
  if (research.length !== 1 || admissions !== 1 || rejected) initialProblems.push(`Expected exactly one research invocation; observed ${research.length} call(s), ${admissions} admission(s)${rejected ? " and a rejected repeat" : ""}`);
  if (!initial) initialProblems.push("No top-level handoff was made");
  else if (record.manifest.arm === "baseline") {
    if (initial.name !== "intelli_research") initialProblems.push(`Baseline initial call was ${initial.name}, not a direct intelli_research call`);
  } else {
    const nested = nestedOf(initial);
    if (initial.name !== "codemode") initialProblems.push(`Candidate initial call was ${initial.name}, not codemode`);
    else if (nested.length !== 1 || nested[0].name !== "intelli_research") {
      initialProblems.push(`Candidate initial script made ${nested.map(call => call.name).join(", ") || "no"} nested call(s); exactly one nested intelli_research is required`);
    }
  }
  const handoffResearch = initial && (record.manifest.arm === "baseline" ? (initial.name === "intelli_research" ? initial : undefined)
    : nestedOf(initial).find(call => call.name === "intelli_research"));

  const initialOptions = record.manifest.arm === "candidate" && initial?.name === "codemode"
    ? { applicable: true, ...initialCodemodeOptions((initial.input as { code?: unknown } | null)?.code) }
    : { applicable: record.manifest.arm === "candidate", problems: record.manifest.arm === "candidate" ? ["No initial Codemode script"] : [] };
  let codemodeOutputTruncated = false;
  if (!handoffResearch) returnProblems.push("The initial handoff carries no research call");
  else if (results.length !== 1) returnProblems.push(`Expected one core research result; observed ${results.length}`);
  else {
    const native = handoffResearch.resultText;
    if (typeof native !== "string" || !native || handoffResearch.isError) returnProblems.push("Native research text is absent or errored");
    else {
      if (results[0].data.textSha256 !== sha(native)) returnProblems.push("Observed native research text differs from the core result hash");
      if (record.manifest.arm === "candidate") {
        const visible = initial!.resultText ?? "";
        if (initial!.isError) returnProblems.push("The initial Codemode script failed");
        const header = HEADER.exec(visible);
        if (!header) returnProblems.push("Candidate return has no recognised pinned-host success envelope");
        else {
          const output = visible.slice(header[0].length);
          if (/^Warning: truncated output \(original token count: \d+\)/.test(output)) {
            codemodeOutputTruncated = true;
            returnProblems.push("Codemode's output budget truncated the research return");
          } else if (output !== native && output !== `<console_output>\n${native}\n</console_output>`) {
            returnProblems.push("Candidate did not expose the complete unchanged native text exactly once");
          }
        }
      }
    }
  }

  const additionalWork: AdditionalWork[] = top.slice(1).map((call, index) => {
    const nested = nestedOf(call).map(item => ({ id: item.id, name: item.name, input: item.input, isError: item.isError === true }));
    const problems: string[] = [];
    let purpose: AdditionalWork["purpose"];
    if (call.name === "read") {
      purpose = "evidence-read";
      if (!isEvidencePath(call.input)) problems.push(`Read outside saved evidence: ${JSON.stringify(call.input)}`);
    } else if (call.name === "codemode" && record.manifest.arm === "candidate") {
      const unpermitted = nested.filter(item => item.name !== "read");
      purpose = nested.some(item => item.name === "read") ? "codemode-evidence" : "codemode-without-read";
      if (unpermitted.length) { purpose = "unpermitted"; problems.push(`Later Codemode call reached ${unpermitted.map(item => item.name).join(", ")}`); }
      for (const item of nested) if (item.name === "read" && !isEvidencePath(item.input)) problems.push(`Nested read outside saved evidence: ${JSON.stringify(item.input)}`);
    } else {
      purpose = "unpermitted";
      problems.push(`Unpermitted additional call: ${call.name}`);
    }
    return { position: index + 1, id: call.id, name: call.name, logicalRequest: requestOf.get(call.id), input: call.input,
      isError: call.isError === true, nested, purpose, problems };
  });
  const recoveryPermitted = additionalWork.every(work => work.problems.length === 0);
  const recoveryLimitReached = record.adapterEvents.some(event => event.kind === "observer/main-request-blocked");
  const noToolErrors = record.toolCalls.every(call => call.isError !== true);
  const initialInvocationConforms = initialProblems.length === 0;
  return {
    initialInvocationConforms, initialProblems, initialOptions,
    returnPreserved: returnProblems.length === 0, returnProblems, codemodeOutputTruncated,
    additionalWork, recoveryPermitted,
    fullTopologyConforms: initialInvocationConforms && recoveryPermitted && noToolErrors && !recoveryLimitReached,
    recoveryLimitReached,
  };
}

export type PilotFinancialMode = "known-charges" | "no-charges";
export interface PilotCheck { id: string; pass: boolean; detail: string[] }
export interface PilotMachineResult {
  runId: string;
  arm: string;
  phase: string;
  passed: boolean;
  checks: PilotCheck[];
  returnCheck: PilotReturnCheck;
  observedPipelineOutcome: string;
  recoveryCalls: number;
  analysisError?: string;
  usage?: ReturnType<typeof analyseUsage>;
  downstream?: ReturnType<typeof analyseDownstream>;
  attribution?: ReturnType<typeof analyseAttribution>;
  financial: { knownNanoUsd: number; unknownNanoUsd: number; activeNanoUsd: number; rejected: number; overruns: number };
}

function completionOutput(event: { data: Record<string, unknown> }): number | undefined {
  const value = (event.data.usageEstimate as { output?: unknown } | null | undefined)?.output;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Machine checks for one pilot conversation. Assessment gates are separate (pilot-assessment). */
export function analysePilotRun(record: RunRecord, frozen: Pick<FrozenInputs, "pages">, financialMode: PilotFinancialMode,
  budget?: { knownNanoUsd?: number; unknownNanoUsd?: number; activeNanoUsd?: number }): PilotMachineResult {
  const returnCheck = checkPilotReturn(record);
  const checks: PilotCheck[] = [];
  const add = (id: string, pass: boolean, detail: string[] = []) => checks.push({ id, pass, detail });
  let analysisError: string | undefined;
  let usage: PilotMachineResult["usage"], downstream: PilotMachineResult["downstream"], attribution: PilotMachineResult["attribution"];
  try {
    if (record.analysisError) throw new Error(record.analysisError);
    validateSequence(record.requests); validateToolCalls(record.toolCalls);
    usage = analyseUsage(record.requests); downstream = analyseDownstream(record);
    try { attribution = analyseAttribution(record); } catch { /* proxy estimate only; not a machine gate */ }
  } catch (error) { analysisError = String(error); }
  const events = record.adapterEvents ?? [];
  add("analysable", analysisError === undefined, analysisError ? [analysisError] : []);
  add("single-assigned-research-invocation", returnCheck.initialInvocationConforms, returnCheck.initialProblems);
  // Input equality and execution completeness are reported separately (PILOT-PROTOCOL.md, Capture and Input Equality).
  add("inputs-and-settings-match", record.inputIntegrity?.matched === true, record.inputIntegrity?.problems ?? []);
  add("input-execution-complete", record.inputIntegrity?.complete === true, record.inputIntegrity?.completenessProblems ?? []);
  const usageProblems: string[] = [];
  if (!record.observerCoverage?.verified) usageProblems.push(...(record.observerCoverage?.problems ?? ["Observer coverage unverified"]));
  if (!usage || usage.logicalRequestsWithoutAttempts > 0 || !usage.input.complete || !usage.output.complete) usageProblems.push("Main usage is incomplete");
  add("request-observation-and-usage-complete", usageProblems.length === 0, usageProblems);

  const successPages = frozen.pages.filter(item => item.page.status === "success").length;
  const extracts = events.filter(event => event.kind === "model-completion" && event.stage === "extract");
  const extractProblems: string[] = [];
  if (extracts.length !== successPages) extractProblems.push(`${extracts.length} successful extraction(s) for ${successPages} selected readable source(s)`);
  if (frozen.pages.length !== successPages) extractProblems.push(`${frozen.pages.length - successPages} selected source(s) were not captured successfully`);
  for (const event of extracts) {
    const output = completionOutput(event);
    if (typeof event.data.text !== "string" || !event.data.text.trim()) extractProblems.push("An extraction returned empty text");
    if (output !== undefined && output >= PILOT_PROFILE.extractionMaxTokens) extractProblems.push(`An extraction reached the ${PILOT_PROFILE.extractionMaxTokens}-token cap`);
  }
  if ((downstream?.byStage.extract?.truncatedCompletions ?? 0) > 0) extractProblems.push("A provider extraction completion stopped at its length limit");
  add("every-source-extracted-untruncated", extractProblems.length === 0, extractProblems);

  const collations = events.filter(event => event.kind === "model-completion" && event.stage === "collate");
  const collateProblems: string[] = [];
  if (collations.length !== 1) collateProblems.push(`${collations.length} collation completion(s)`);
  for (const event of collations) {
    const output = completionOutput(event);
    if (typeof event.data.text !== "string" || !event.data.text.trim()) collateProblems.push("Collation returned empty text");
    if (output !== undefined && output >= PILOT_PROFILE.collationMaxTokens) collateProblems.push(`Collation reached the ${PILOT_PROFILE.collationMaxTokens}-token cap`);
  }
  if ((downstream?.byStage.collate?.truncatedCompletions ?? 0) > 0) collateProblems.push("A provider collation completion stopped at its length limit");
  add("collation-nonempty-untruncated", collateProblems.length === 0, collateProblems);

  const judge = events.filter(event => event.kind === "cache-suggest-rejected" || (event.kind === "model-request" && event.stage === "cache"));
  add("no-cache-suggest-judge-call", judge.length === 0, judge.length ? ["A cache-suggest judge call was attempted"] : []);
  const outcome = observedPipelineOutcome(record);
  add("pipeline-completed", outcome === "completed" && !events.some(event => event.kind === "research-error"),
    [`observed outcome ${outcome}`, ...events.filter(event => event.kind === "research-error").map(event => String(event.data.message))]);
  add("candidate-initial-output-option", returnCheck.initialOptions.problems.length === 0, returnCheck.initialOptions.problems);
  add("initial-return-preserved", returnCheck.returnPreserved, returnCheck.returnProblems);
  add("cited-evidence-readable", record.evidenceAccess?.readable === true, record.evidenceAccess?.problems ?? []);
  add("recovery-permitted", returnCheck.recoveryPermitted, returnCheck.additionalWork.flatMap(work => work.problems));
  const answerProblems: string[] = [];
  if (!record.finalAnswer?.trim()) answerProblems.push("No settled final answer");
  if (returnCheck.recoveryLimitReached) answerProblems.push("Main-request limit reached before a settled final answer (recovery-limit observation)");
  if (!record.conformance?.conforms) answerProblems.push(...(record.conformance?.problems ?? []));
  if (record.error) answerProblems.push(record.error);
  add("settled-final-answer-within-bounds", answerProblems.length === 0, answerProblems);

  const sum = (kind: string, field: string) => events.filter(event => event.kind === kind)
    .reduce((total, event) => total + (typeof event.data[field] === "number" ? event.data[field] as number : 0), 0);
  const financial = {
    knownNanoUsd: budget?.knownNanoUsd ?? sum("budget-settled", "reportedNanoUsd"),
    unknownNanoUsd: budget?.unknownNanoUsd ?? sum("budget-unknown", "heldNanoUsd"),
    activeNanoUsd: budget?.activeNanoUsd ?? (record.financialControl?.activeReservations ? 1 : 0),
    rejected: events.filter(event => event.kind === "budget-rejected").length,
    overruns: events.filter(event => event.kind === "budget-overrun").length,
  };
  const financialProblems: string[] = [];
  if (!record.financialControl) financialProblems.push("Financial-control proof is missing");
  if (financial.rejected) financialProblems.push("Attempt admission was refused (monetary limit)");
  if (financial.overruns) financialProblems.push("A provider charge exceeded its reservation");
  if (financial.unknownNanoUsd) financialProblems.push(`Unknown-charge holds retained: ${financial.unknownNanoUsd} nano-USD`);
  if (financial.activeNanoUsd || record.financialControl?.activeReservations) financialProblems.push("Active reservations remain");
  if (financialMode === "no-charges" && events.some(event => event.kind === "pipeline-attempt" || event.kind === "budget-reserved")) {
    financialProblems.push("A chargeable downstream attempt occurred in a no-charge observer conversation");
  }
  add("financial-accounting-known", financialProblems.length === 0, financialProblems);
  return {
    runId: record.manifest?.runId, arm: record.manifest?.arm, phase: record.manifest?.phase,
    passed: checks.every(check => check.pass), checks, returnCheck, observedPipelineOutcome: outcome,
    recoveryCalls: returnCheck.additionalWork.length, ...(analysisError ? { analysisError } : {}),
    usage, downstream, attribution, financial,
  };
}
