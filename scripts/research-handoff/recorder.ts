// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// Exact main-request recorder for the research-handoff study (Track B).
//
// Counts logical main requests and physical provider attempts at the fetch
// boundary (see host.ts), classifies resumptions, harvests RAW provider
// usage from provider stream events (never SDK zero placeholders), and
// produces the observation half of the coordinator's frozen RunRecord.
// Implements the shared Journal contract so Track A's registration, the host
// observer and an optional durable sink share one append-only event stream.
//
// Lifecycle rules (coordinator review):
// - An attempt stays "started" from before dispatch until a terminal event:
//   the terminal provider usage event (completed), a non-2xx HTTP response,
//   a thrown fetch, or an abort. Header arrival alone is not completion.
// - A payload-hook/wire mismatch or an undecodable body fails closed BEFORE
//   dispatch (WireIntegrityError); the transmission never happens.
// - output() never fabricates settlement: an unsettled session reports
//   status "started" with explicit problems, and only a settled run with a
//   real non-empty final text can be "completed".
// - Every event is forwarded synchronously to the optional durable journal,
//   so a crash retains attempt boundaries and terminal usage events. Full
//   payloads and the assembled record still depend on worker persistence.

import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type {
  AdapterJournal,
  AdapterJournalEvent,
  Arm,
  Journal,
  JournalEvent,
  MainAttempt,
  MainRequest,
  ReportedUsage,
  RunStatus,
  ToolCallRecord,
} from "./contracts.js";
import { canonicalJson, sha256Hex } from "./common-inputs.js";

/** Observation half of the frozen RunRecord; the runner adds the manifest. */
export interface RunObservation {
  prompt: string;
  systemPrompt: string;
  catalogue: unknown;
  requests: MainRequest[];
  toolCalls: ToolCallRecord[];
  adapterEvents: JournalEvent[];
  finalAnswer: string;
  finalMessages: unknown[];
  inputIntegrity: { matched: boolean; problems: string[] };
  evidenceAccess: { readable: boolean; reportPaths: string[]; problems: string[] };
  conformance: { conforms: boolean; problems: string[] };
  observerCoverage: { verified: boolean; problems: string[] };
  error?: string;
}

export interface RecorderOptions {
  runId: string;
  arm: Arm;
  /** Main model identity, e.g. "gpt-6.1-sol" (payload.model). */
  mainModelId: string;
  maxLogicalMainRequests: number;
  maxProviderAttempts: number;
  /** Tool names the protocol allows the main model to call (nested calls excluded). */
  allowedTopLevelTools: readonly string[];
  /** Optional durable sink; every event is written synchronously, before any throw. */
  durable?: Journal;
  /**
   * Historical rh-v4 default "forbidden": any read is nonconformance. The rh-v5 pilot
   * permits evidence recovery; the pilot return check classifies it by call position.
   */
  recoveryPolicy?: "forbidden" | "evidence-permitted";
}

/** Thrown by the dispatch gates BEFORE any transmission. */
export class MainRequestCapError extends Error {
  constructor(public readonly logicalIndex: number, public readonly max: number) {
    super(`main-request cap exceeded: logical request ${logicalIndex} > ${max}`);
    this.name = "MainRequestCapError";
  }
}
export class AttemptCapError extends Error {
  constructor(public readonly logicalIndex: number, public readonly attempt: number, public readonly max: number) {
    super(`provider-attempt cap exceeded: attempt ${attempt} of logical request ${logicalIndex} > ${max}`);
    this.name = "AttemptCapError";
  }
}
/** Fail-closed payload/wire integrity violation: the transmission is refused. */
export class WireIntegrityError extends Error {
  constructor(public readonly attemptId: string, reason: string) {
    super(`refusing dispatch: ${reason}`);
    this.name = "WireIntegrityError";
  }
}

interface InternalAttempt extends MainAttempt {
  logicalIndex: number;
  attemptIndex: number;
  httpStatus?: number;
  wireDigest?: string;
  payloadHookMatched?: boolean;
}
interface InternalRequest extends MainRequest {
  attempts: InternalAttempt[];
  payloadHookDigest?: string;
  assistantStopReason?: string;
  assistantHasToolCalls?: boolean;
  closed: boolean;
}

export interface MainRequestHandle { readonly index: number }

const nowIso = (): string => new Date().toISOString();

function textOfContent(content: unknown): string {
  if (!Array.isArray(content)) return typeof content === "string" ? content : "";
  return content
    .map((block) => (block && typeof block === "object" && (block as { type?: string }).type === "text"
      ? String((block as { text?: unknown }).text ?? "")
      : ""))
    .join("");
}

/** Map RAW provider usage (OpenAI Responses field names) onto ReportedUsage. Raw input already includes cached input. */
function rawUsageToReported(raw: unknown): ReportedUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const reported: ReportedUsage = {};
  if (typeof r.input_tokens === "number") reported.input = r.input_tokens;
  if (typeof r.output_tokens === "number") reported.output = r.output_tokens;
  const inDetails = r.input_tokens_details as Record<string, unknown> | undefined;
  if (typeof inDetails?.cached_tokens === "number") reported.cacheRead = inDetails.cached_tokens;
  if (typeof inDetails?.cache_write_tokens === "number") reported.cacheWrite = inDetails.cache_write_tokens;
  const outDetails = r.output_tokens_details as Record<string, unknown> | undefined;
  if (typeof outDetails?.reasoning_tokens === "number") reported.reasoning = outDetails.reasoning_tokens;
  return Object.keys(reported).length > 0 ? reported : undefined;
}

export class RunRecorder implements AdapterJournal {
  private readonly opts: RecorderOptions;
  private readonly events: JournalEvent[] = [];
  private readonly requests: InternalRequest[] = [];
  private readonly tools: ToolCallRecord[] = [];
  private finalTranscript: unknown[] | null = null;
  private readonly nonconformanceProblems: string[] = [];
  private readonly observerProblems: string[] = [];
  private readonly inputIntegrityProblems: string[] = [];
  private openRequest: InternalRequest | null = null;
  private lastContextMessages: unknown[] | null = null;
  private toolResultSinceRequest = false;
  private promptText = "";
  private systemPromptSnapshot = "";
  private catalogueSnapshot: unknown = undefined;
  private settled = false;
  private settledCalled = false;
  private outcomeInternal: RunStatus = "started";
  private runError: string | undefined;
  private aborted = false;
  researchAdmissions = 0;

  constructor(opts: RecorderOptions) {
    this.opts = opts;
    this.emit({ kind: "observer/run-started", data: { runId: opts.runId, arm: opts.arm } });
  }

  // ---- Journal (shared contract; adapter, observer and durable sink share one stream) ----
  record(event: AdapterJournalEvent): void {
    this.emit(event);
  }

  private emit(event: AdapterJournalEvent): void {
    const enriched: JournalEvent = {
      kind: event.kind,
      data: event.data,
      at: event.at ?? nowIso(),
      runId: event.runId ?? this.opts.runId,
      ...(event.stage !== undefined ? { stage: event.stage } : {}),
    };
    // Durable sink first, synchronously: a later throw must not lose evidence.
    if (this.opts.durable) this.opts.durable.record(enriched);
    this.events.push(enriched);
    if (event.kind === "research-admitted") this.researchAdmissions += 1;
  }

  journal(): AdapterJournal {
    return this;
  }

  // ---- Snapshots and run framing ----
  notePrompt(text: string): void {
    this.promptText = text;
    this.emit({ kind: "observer/prompt", data: { sha256: sha256Hex(text), chars: text.length } });
  }

  noteSystemPromptAndCatalogue(systemPrompt: string, catalogue: unknown): void {
    this.systemPromptSnapshot = systemPrompt;
    this.catalogueSnapshot = catalogue;
    this.emit({
      kind: "observer/catalogue",
      data: { systemPromptSha256: sha256Hex(systemPrompt), systemPromptChars: systemPrompt.length, catalogue },
    });
  }

  noteEnvironment(env: Record<string, unknown>): void {
    this.emit({ kind: "observer/environment", data: env });
  }

  markNonconforming(reason: string): void {
    if (!this.nonconformanceProblems.includes(reason)) this.nonconformanceProblems.push(reason);
    this.emit({ kind: "observer/nonconformance", data: { reason } });
  }

  noteError(error: string): void {
    this.runError ??= error;
  }

  // ---- Dispatch gates (called by the host stream wrapper, before transmission) ----
  beginMainRequest(context: unknown): MainRequestHandle {
    const index = this.requests.length + 1;
    if (index > this.opts.maxLogicalMainRequests) {
      this.emit({
        kind: "observer/main-request-blocked",
        data: { logicalIndex: index, max: this.opts.maxLogicalMainRequests },
      });
      this.markNonconforming(`main-request cap exceeded at logical request ${index}`);
      throw new MainRequestCapError(index, this.opts.maxLogicalMainRequests);
    }
    const request: InternalRequest = {
      id: `main-${this.opts.runId}-${index}`,
      logicalIndex: index,
      context,
      attempts: [],
      afterToolCall: this.toolResultSinceRequest,
      finalAnswerProducing: false,
      assistantMessage: undefined,
      closed: false,
    };
    this.requests.push(request);
    this.openRequest = request;
    this.toolResultSinceRequest = false;
    // The FULL model-visible context of the latest dispatched request: the
    // leading system/declaration prefix preserved here is the only provable
    // source for completing the final retained context.
    this.lastContextMessages = ((context as { messages?: unknown[] } | null)?.messages ?? []).map((message) => structuredClone(message));
    this.emit({
      kind: "observer/main-request",
      data: { logicalIndex: index, afterToolCall: request.afterToolCall, contextSummary: contextSummaryOf(context) },
    });
    return { index };
  }

  /**
   * Record the wire body BEFORE dispatch. Throws WireIntegrityError (without
   * transmitting) when the body is undecodable or disagrees with the payload
   * hook, or when no payload-hook observation exists to compare against.
   */
  noteWireBody(attemptId: string, payload: unknown, wireEncoding: MainAttempt["wireEncoding"]): void {
    const attempt = this.findAttempt(attemptId);
    attempt.wireEncoding = wireEncoding;
    attempt.payload = payload;
    const request = this.requests[attempt.logicalIndex - 1];
    const hookDigest = request?.payloadHookDigest;
    if (payload === undefined) {
      this.observerProblems.push(`attempt ${attempt.id}: wire body undecodable (${wireEncoding})`);
      this.failAttempt(attemptId, "error", `wire body undecodable (${wireEncoding})`);
      throw new WireIntegrityError(attemptId, `attempt ${attempt.id}: wire body undecodable (${wireEncoding})`);
    }
    attempt.wireDigest = sha256Hex(canonicalJson(payload));
    if (hookDigest === undefined) {
      this.observerProblems.push(`attempt ${attempt.id}: wire body without a payload-hook observation`);
      this.failAttempt(attemptId, "error", "wire body without a payload-hook observation");
      throw new WireIntegrityError(attemptId, `attempt ${attempt.id}: no payload-hook observation to compare against`);
    }
    attempt.payloadHookMatched = attempt.wireDigest === hookDigest;
    if (!attempt.payloadHookMatched) {
      this.observerProblems.push(`attempt ${attempt.id}: payload-hook/wire mismatch`);
      this.emit({
        kind: "observer/wire-mismatch",
        data: { attemptId: attempt.id, hookDigest, wireDigest: attempt.wireDigest },
      });
      this.failAttempt(attemptId, "error", "payload-hook/wire mismatch");
      throw new WireIntegrityError(attemptId, `attempt ${attempt.id}: payload-hook/wire mismatch`);
    }
  }

  beginAttempt(logicalIndex: number, wireEncoding: MainAttempt["wireEncoding"]): string {
    const request = this.requests[logicalIndex - 1];
    if (!request) throw new Error(`beginAttempt: no logical request ${logicalIndex}`);
    const attemptIndex = request.attempts.length + 1;
    if (attemptIndex > this.opts.maxProviderAttempts) {
      this.emit({
        kind: "observer/main-attempt-blocked",
        data: { logicalIndex, attemptIndex, max: this.opts.maxProviderAttempts },
      });
      this.markNonconforming(`provider-attempt cap exceeded at attempt ${attemptIndex} of logical request ${logicalIndex}`);
      throw new AttemptCapError(logicalIndex, attemptIndex, this.opts.maxProviderAttempts);
    }
    const attempt: InternalAttempt = {
      id: `attempt-${this.opts.runId}-${logicalIndex}-${attemptIndex}`,
      startedAt: nowIso(),
      payload: undefined,
      wireEncoding,
      status: "started",
      logicalIndex,
      attemptIndex,
    };
    request.attempts.push(attempt);
    this.emit({
      kind: "observer/main-attempt",
      data: { attemptId: attempt.id, logicalIndex, attemptIndex, wireEncoding, phase: "before-dispatch" },
    });
    return attempt.id;
  }

  /** Terminal failure for an in-flight attempt: thrown fetch, abort, non-2xx HTTP. */
  failAttempt(attemptId: string, status: "error" | "aborted", error: string): void {
    const attempt = this.findAttempt(attemptId);
    if (attempt.status !== "started") return;
    attempt.status = status;
    attempt.endedAt = nowIso();
    attempt.error = error;
    this.emit({
      kind: "observer/main-attempt",
      data: { attemptId, phase: "ended", status, error },
    });
  }

  /** Attempt count for a logical request (host cap arithmetic and script indexing). */
  attemptCount(logicalIndex: number): number {
    return this.requests[logicalIndex - 1]?.attempts.length ?? 0;
  }

  // ---- Extension-event side (wired by recorderExtensionFactory) ----
  noteProviderPayload(payload: unknown): void {
    const request = this.openRequest;
    if (!request || request.closed) {
      this.observerProblems.push("before_provider_request observed outside an open main request");
      return;
    }
    request.payload = payload;
    request.payloadHookDigest = sha256Hex(canonicalJson(payload));
    const model = (payload as { model?: unknown } | null)?.model;
    if (model !== undefined && model !== this.opts.mainModelId) {
      this.observerProblems.push(`payload-hook model ${String(model)} !== main model ${this.opts.mainModelId}`);
    }
  }

  noteProviderResponse(status: number): void {
    const attempt = latestAttempt(this.openRequest);
    if (!attempt) {
      this.observerProblems.push(`after_provider_response (status ${status}) without a recorded attempt`);
      return;
    }
    if (attempt.httpStatus !== undefined) {
      this.observerProblems.push(`attempt ${attempt.id}: more than one HTTP response observed`);
      return;
    }
    attempt.httpStatus = status;
  }

  noteProviderStreamEvent(data: unknown): void {
    const event = data as {
      type?: string;
      message?: string;
      error?: { code?: string; message?: string };
      response?: { usage?: unknown; error?: { code?: string; message?: string } };
    } | null;
    if (!event || typeof event.type !== "string") return;
    const attempt = latestAttempt(this.openRequest);
    if (event.type === "response.created") {
      if (!attempt) this.observerProblems.push("response.created without a recorded attempt");
      return;
    }
    const succeeded = event.type === "response.completed" || event.type === "response.incomplete" || event.type === "response.done";
    const failed = event.type === "response.failed" || event.type === "error";
    if (!succeeded && !failed) return;
    if (!attempt) {
      this.observerProblems.push(`${event.type} without a recorded attempt`);
      return;
    }
    if (attempt.status !== "started") {
      this.observerProblems.push(`attempt ${attempt.id}: terminal stream event after attempt already ${attempt.status}`);
      return;
    }
    if (attempt.rawUsage !== undefined) {
      this.observerProblems.push(`attempt ${attempt.id}: duplicate terminal usage event`);
      return;
    }
    const raw = event.response?.usage;
    attempt.rawUsage = raw;
    const reported = rawUsageToReported(raw);
    if (reported) attempt.usage = reported;
    else if (succeeded) this.observerProblems.push(`attempt ${attempt.id}: terminal response carried no usage`);
    const error = failed
      ? event.message ?? event.error?.message ?? event.response?.error?.message
        ?? event.error?.code ?? event.response?.error?.code ?? event.type
      : undefined;
    attempt.status = succeeded ? "completed" : "error";
    attempt.endedAt = nowIso();
    if (error) attempt.error = error;
    this.emit({
      kind: "observer/main-attempt",
      data: { attemptId: attempt.id, phase: "ended", status: attempt.status, usage: reported ?? null, error: error ?? null },
    });
  }

  noteAssistantMessageEnd(message: unknown): void {
    const m = message as {
      role?: string; content?: unknown[]; stopReason?: string; errorMessage?: string;
    } | null;
    const request = this.openRequest;
    if (!request) {
      // Synthetic failure assistant message (for example after a dispatch-cap
      // throw): no open logical request owns it. Keep it as run-level evidence.
      this.emit({
        kind: "observer/assistant-message-outside-request",
        data: { stopReason: m?.stopReason ?? null, errorMessage: m?.errorMessage ?? null },
      });
      if (m?.stopReason === "error" || m?.stopReason === "aborted") {
        if (m.stopReason === "aborted") this.aborted = true;
        this.noteError(m.errorMessage ?? `assistant message ended with ${m.stopReason}`);
      }
      return;
    }
    request.assistantMessage = message;
    request.assistantStopReason = m?.stopReason;
    request.closed = true;
    const content = Array.isArray(m?.content) ? m!.content : [];
    request.assistantHasToolCalls = content.some((b) => (b as { type?: string } | null)?.type === "toolCall");
    if (m?.stopReason === "error" || m?.stopReason === "aborted") {
      if (m.stopReason === "aborted") this.aborted = true;
      this.noteError(m.errorMessage ?? `main request ${request.logicalIndex} ended with ${m.stopReason}`);
    }
    this.emit({
      kind: "observer/main-request",
      data: { logicalIndex: request.logicalIndex, phase: "ended", stopReason: m?.stopReason ?? null },
    });
    this.openRequest = null;
  }

  noteToolExecutionStart(event: { toolCallId: string; toolName: string; args: unknown; parentToolCallId?: string }): void {
    this.tools.push({
      id: event.toolCallId,
      name: event.toolName,
      parentToolCallId: event.parentToolCallId,
      input: event.args,
    });
  }

  noteToolExecutionEnd(event: { toolCallId: string; isError?: boolean; result?: unknown }): void {
    const record = this.tools.find((t) => t.id === event.toolCallId);
    if (record) {
      record.isError = event.isError === true;
      // Nested calls never produce transcript tool-result messages; their text
      // is only visible on the execution-end result.
      const content = (event.result as { content?: unknown } | undefined)?.content;
      if (content !== undefined) record.resultText = textOfContent(content);
    }
  }

  noteToolResultMessage(message: unknown): void {
    const m = message as { toolCallId?: string; content?: unknown; isError?: boolean } | null;
    if (!m?.toolCallId) return;
    const record = this.tools.find((t) => t.id === m.toolCallId);
    if (record) {
      record.resultText = textOfContent(m.content);
      if (m.isError !== undefined) record.isError = m.isError;
    }
    if (!record?.parentToolCallId) this.toolResultSinceRequest = true;
  }

  noteAgentSettled(aborted: boolean): void {
    if (aborted) this.aborted = true;
    this.settle();
  }

  /** Full session transcript (system, user, assistant, tool results) for final-exposure accounting. */
  noteFinalTranscript(messages: unknown[]): void {
    this.finalTranscript = messages;
  }

  /** Host-only: record an input-integrity problem surfaced by Track A evidence checks. */
  noteInputIntegrityProblem(problem: string): void {
    this.inputIntegrityProblems.push(problem);
  }

  /** Host-only: an observer-coverage problem that is not a protocol nonconformance. */
  noteObserverProblem(problem: string): void {
    if (!this.observerProblems.includes(problem)) this.observerProblems.push(problem);
    this.emit({ kind: "observer/observer-problem", data: { problem } });
  }

  /** The full model-visible context of the last dispatched main request, or undefined when none was dispatched. */
  lastMainContextMessages(): readonly unknown[] | undefined {
    return this.lastContextMessages ?? undefined;
  }

  private findAttempt(attemptId: string): InternalAttempt {
    for (const request of this.requests) {
      const attempt = request.attempts.find((a) => a.id === attemptId);
      if (attempt) return attempt;
    }
    throw new Error(`unknown attempt ${attemptId}`);
  }

  // ---- Settle and output ----
  private settle(): void {
    if (this.settled) return;
    this.settled = true;
    this.settledCalled = true;
    // Final-answer producer: a settled assistant message with real text, no
    // tool calls and a non-error stop reason. Empty/error/aborted messages
    // never qualify.
    const producer = [...this.requests].reverse().find((r) => {
      const message = r.assistantMessage as { content?: unknown[]; stopReason?: string } | undefined;
      if (!message || r.assistantHasToolCalls) return false;
      if (r.assistantStopReason !== "stop") return false;
      return textOfContent(message.content).trim().length > 0;
    });
    if (producer) producer.finalAnswerProducing = true;
    // Conformance
    if (this.researchAdmissions > 1) {
      this.nonconformanceProblems.push(`${this.researchAdmissions} research invocations admitted`);
    }
    for (const event of this.events) {
      if (event.kind === "admission-rejected") {
        this.nonconformanceProblems.push("a research invocation was rejected by the admission gate");
      }
    }
    for (const call of this.tools) {
      if (call.name === "read" && this.opts.recoveryPolicy !== "evidence-permitted") {
        this.nonconformanceProblems.push(`evidence read deviates from one-handoff route: ${call.id}`);
      }
      if (!call.parentToolCallId && !this.opts.allowedTopLevelTools.includes(call.name)) {
        this.nonconformanceProblems.push(`unexpected top-level tool call: ${call.name}`);
      }
    }
    if (this.aborted) {
      this.outcomeInternal = this.nonconformanceProblems.length ? "nonconforming" : "failed";
      this.noteError("run aborted");
    } else if (this.nonconformanceProblems.length) {
      this.outcomeInternal = "nonconforming";
    } else if (producer) {
      this.outcomeInternal = "completed";
    } else {
      this.outcomeInternal = "failed";
      this.noteError("no final answer produced");
    }
    // Observer coverage: every logical request observed at the wire, every attempt terminal.
    for (const request of this.requests) {
      if (request.attempts.length === 0) {
        this.observerProblems.push(`logical request ${request.logicalIndex}: no physical attempt observed`);
      }
      for (const attempt of request.attempts) {
        if (attempt.status === "started") {
          this.observerProblems.push(`attempt ${attempt.id}: no terminal status (stream never terminated)`);
        }
      }
    }
    this.emit({
      kind: "observer/agent-settled",
      data: { outcome: this.outcomeInternal, aborted: this.aborted, requests: this.requests.length },
    });
  }

  outcome(): RunStatus {
    return this.outcomeInternal;
  }

  output(): RunObservation {
    if (!this.settledCalled) {
      // Never fabricate settlement: report what happened and why it is incomplete.
      this.settledCalled = true;
      this.observerProblems.push("session never settled before output was requested");
      this.nonconformanceProblems.push("session never settled before output was requested");
      this.outcomeInternal = "nonconforming";
      this.emit({
        kind: "observer/output-without-settlement",
        data: { requests: this.requests.length },
      });
    }
    const requests: MainRequest[] = this.requests.map((r) => ({
      id: r.id,
      logicalIndex: r.logicalIndex,
      context: r.context,
      payload: r.payload,
      attempts: r.attempts.map((a) => ({
        id: a.id,
        startedAt: a.startedAt,
        endedAt: a.endedAt,
        payload: a.payload,
        wireEncoding: a.wireEncoding,
        status: a.status,
        rawUsage: a.rawUsage,
        usage: a.usage,
        ...(a.error !== undefined ? { error: a.error } : {}),
      })),
      afterToolCall: r.afterToolCall,
      finalAnswerProducing: r.finalAnswerProducing,
      ...(r.assistantMessage !== undefined ? { assistantMessage: r.assistantMessage } : {}),
    }));
    const finalAnswerProducer = this.requests.find((r) => r.finalAnswerProducing);
    const finalAnswer = finalAnswerProducer
      ? textOfContent((finalAnswerProducer.assistantMessage as { content?: unknown }).content)
      : "";
    return {
      prompt: this.promptText,
      systemPrompt: this.systemPromptSnapshot,
      catalogue: this.catalogueSnapshot,
      requests,
      toolCalls: this.tools.map((t) => ({ ...t, ...(t.parentToolCallId ? { parentToolCallId: t.parentToolCallId } : {}) })),
      adapterEvents: this.events.map((e) => ({ ...e })),
      finalAnswer,
      finalMessages: this.finalTranscript ?? this.requests.map((r) => r.assistantMessage).filter((m) => m !== undefined),
      inputIntegrity: { matched: this.inputIntegrityProblems.length === 0, problems: [...this.inputIntegrityProblems] },
      evidenceAccess: { readable: false, reportPaths: [], problems: [] },
      conformance: { conforms: this.nonconformanceProblems.length === 0, problems: [...this.nonconformanceProblems] },
      observerCoverage: { verified: this.observerProblems.length === 0, problems: [...this.observerProblems] },
      ...(this.runError !== undefined ? { error: this.runError } : {}),
    };
  }
}

function contextSummaryOf(context: unknown): unknown {
  // The full model-visible context is preserved in MainRequest.context; this
  // summary is only for the journal line, which must stay small.
  const messages = (context as { messages?: unknown[] } | null)?.messages ?? [];
  return { messageCount: messages.length };
}

function latestAttempt(request: InternalRequest | null): InternalAttempt | undefined {
  if (!request || request.attempts.length === 0) return undefined;
  return request.attempts[request.attempts.length - 1];
}

/**
 * Inline extension factory registering the observer hooks. Load FIRST so its
 * handlers run before any other extension's for the same events. Handlers are
 * synchronous and never call ctx.abort (dispatch caps live in the host
 * stream wrapper, which throws before transmission instead).
 */
export function recorderExtensionFactory(recorder: RunRecorder): ExtensionFactory {
  return (pi) => {
    pi.on("before_provider_request", (event) => {
      recorder.noteProviderPayload((event as { payload?: unknown }).payload);
    });
    pi.on("after_provider_response", (event) => {
      recorder.noteProviderResponse((event as { status?: number }).status ?? 0);
    });
    pi.on("provider_stream_event", (event) => {
      recorder.noteProviderStreamEvent((event as { data?: unknown }).data);
    });
    pi.on("message_end", (event) => {
      const message = (event as { message?: { role?: string } }).message;
      if (message?.role === "assistant") recorder.noteAssistantMessageEnd(message);
      else if (message?.role === "toolResult") recorder.noteToolResultMessage(message);
    });
    pi.on("tool_execution_start", (event) => {
      const e = event as { toolCallId: string; toolName: string; args: unknown; parentToolCallId?: string };
      recorder.noteToolExecutionStart(e);
    });
    pi.on("tool_execution_end", (event) => {
      const e = event as { toolCallId: string; isError?: boolean; result?: unknown };
      recorder.noteToolExecutionEnd(e);
    });
  };
}
