// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// Deterministic recorder tests: dispatch caps, fetch-boundary attempt
// accounting, fail-closed payload/wire integrity, raw usage harvest,
// resumption classification, durable sink and RunObservation shape. No host,
// no network, no credentials. Regression coverage for the coordinator review
// findings: header arrival is not attempt completion; undecodable/mismatched
// bodies refuse dispatch; unsettled output never fabricates settlement.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RunRecorder,
  MainRequestCapError,
  AttemptCapError,
  WireIntegrityError,
} from "../scripts/research-handoff/recorder.js";
import type { Journal, JournalEvent } from "../scripts/research-handoff/contracts.js";

function makeRecorder(overrides: Partial<ConstructorParameters<typeof RunRecorder>[0]> = {}): RunRecorder {
  return new RunRecorder({
    runId: "unit",
    arm: "baseline",
    mainModelId: "gpt-6.1-sol",
    maxLogicalMainRequests: 4,
    maxProviderAttempts: 3,
    allowedTopLevelTools: ["intelli_research", "read"],
    ...overrides,
  });
}

function assistantMessage(content: unknown[], stopReason = "stop") {
  return { role: "assistant", content, usage: { input: 0, output: 0 }, stopReason, timestamp: 1 };
}

/** A cleanly completed single request: hook, wire, 2xx, terminal usage. */
function completeOneRequest(recorder: RunRecorder, text: string, usage: Record<string, unknown> = { input_tokens: 100, output_tokens: 10 }) {
  const handle = recorder.beginMainRequest({ messages: [] });
  recorder.noteProviderPayload({ model: "gpt-6.1-sol", input: [] });
  const attemptId = recorder.beginAttempt(handle.index, "identity");
  recorder.noteWireBody(attemptId, { model: "gpt-6.1-sol", input: [] }, "identity");
  recorder.noteProviderResponse(200);
  recorder.noteProviderStreamEvent({ type: "response.created", response: { id: "r" } });
  recorder.noteProviderStreamEvent({ type: "response.completed", response: { usage } });
  recorder.noteAssistantMessageEnd(assistantMessage([{ type: "text", text }]));
  return { handle, attemptId };
}

test("allowed recovery reads remain explicit nonconformance, including nested reads", () => {
  for (const parentToolCallId of [undefined, "script-call"]) {
    const recorder = makeRecorder();
    completeOneRequest(recorder, "Initial response");
    recorder.noteToolExecutionStart({ toolCallId: "read-call", toolName: "read", args: { path: "report.md" }, parentToolCallId });
    recorder.noteToolExecutionEnd({ toolCallId: "read-call", isError: false });
    completeOneRequest(recorder, "Final response");
    recorder.noteAgentSettled(false);
    assert.equal(recorder.output().conformance.conforms, false);
    assert.match(recorder.output().conformance.problems.join(" "), /evidence read/);
  }
});

test("logical-request cap throws before the fifth request and marks nonconformance", () => {
  const recorder = makeRecorder();
  for (let index = 1; index <= 4; index += 1) {
    completeOneRequest(recorder, `t${index}`);
  }
  assert.throws(() => recorder.beginMainRequest({}), MainRequestCapError);
  const output = recorder.output();
  assert.equal(output.requests.length, 4);
  assert.equal(output.conformance.conforms, false);
  assert.ok(output.conformance.problems.some((p) => p.includes("main-request cap")));
  const blocked = output.adapterEvents.find((event) => event.kind === "observer/main-request-blocked");
  assert.ok(blocked, "blocked request journalled");
  assert.equal(blocked?.data.logicalIndex, 5);
});

test("provider-attempt cap throws before the fourth physical transmission", () => {
  const recorder = makeRecorder();
  const handle = recorder.beginMainRequest({});
  recorder.beginAttempt(handle.index, "identity");
  recorder.beginAttempt(handle.index, "identity");
  recorder.beginAttempt(handle.index, "identity");
  assert.throws(() => recorder.beginAttempt(handle.index, "identity"), AttemptCapError);
  const output = recorder.output();
  assert.equal(output.requests[0].attempts.length, 3);
  assert.ok(output.conformance.problems.some((p) => p.includes("provider-attempt cap")));
});

test("payload hook and wire body digests must match; mismatch REFUSES dispatch", () => {
  const recorder = makeRecorder();
  const handle = recorder.beginMainRequest({});
  recorder.noteProviderPayload({ model: "gpt-6.1-sol", input: [{ role: "user" }] });
  const attemptId = recorder.beginAttempt(handle.index, "identity");
  assert.throws(
    () => recorder.noteWireBody(attemptId, { model: "gpt-6.1-sol", input: [{ role: "user" }, "extra"] }, "identity"),
    WireIntegrityError,
  );
  const attempt = recorder.output().requests[0].attempts[0];
  assert.equal(attempt.status, "error", "the failed attempt is retained");
  assert.deepEqual(attempt.payload, { model: "gpt-6.1-sol", input: [{ role: "user" }, "extra"] }, "the refused body is retained as evidence");
  const journalMismatch = recorder.output().adapterEvents.find((event) => event.kind === "observer/wire-mismatch");
  assert.ok(journalMismatch, "mismatch journalled with both digests");
});

test("undecodable wire body and missing payload hook both refuse dispatch", () => {
  const undecodable = makeRecorder();
  const handle1 = undecodable.beginMainRequest({});
  undecodable.noteProviderPayload({ model: "gpt-6.1-sol" });
  const a1 = undecodable.beginAttempt(handle1.index, "zstd");
  assert.throws(() => undecodable.noteWireBody(a1, undefined, "zstd"), WireIntegrityError);
  assert.equal(undecodable.output().requests[0].attempts[0].status, "error");

  const noHook = makeRecorder();
  const handle2 = noHook.beginMainRequest({});
  const a2 = noHook.beginAttempt(handle2.index, "identity");
  assert.throws(() => noHook.noteWireBody(a2, { model: "gpt-6.1-sol" }, "identity"), WireIntegrityError);
  assert.ok(noHook.output().observerCoverage.problems.some((p) => p.includes("without a payload-hook observation")));
});

test("matching hook and wire digests pass and the attempt completes on terminal usage only", () => {
  const recorder = makeRecorder();
  const { attemptId } = completeOneRequest(recorder, "done", {
    input_tokens: 1200, output_tokens: 80, total_tokens: 1280,
    input_tokens_details: { cached_tokens: 400 },
    output_tokens_details: { reasoning_tokens: 12 },
  });
  recorder.noteAgentSettled(false);
  const attempt = recorder.output().requests[0].attempts[0];
  assert.equal(attempt.id, attemptId);
  assert.equal(attempt.status, "completed");
  assert.deepEqual(attempt.usage, { input: 1200, output: 80, cacheRead: 400, reasoning: 12 });
  assert.equal((attempt.rawUsage as { input_tokens: number }).input_tokens, 1200);
  const finalOutput = recorder.output();
  assert.equal(finalOutput.observerCoverage.verified, true, JSON.stringify(finalOutput.observerCoverage.problems));
});

test("a 2xx attempt that never terminates is flagged, not silently completed", () => {
  const recorder = makeRecorder();
  const handle = recorder.beginMainRequest({});
  recorder.noteProviderPayload({ model: "gpt-6.1-sol" });
  const attemptId = recorder.beginAttempt(handle.index, "identity");
  recorder.noteWireBody(attemptId, { model: "gpt-6.1-sol" }, "identity");
  recorder.noteProviderResponse(200);
  // headers arrived, stream never terminated, run settles anyway
  recorder.noteAssistantMessageEnd(assistantMessage([{ type: "text", text: "x" }]));
  recorder.noteAgentSettled(false);
  const output = recorder.output();
  assert.equal(output.requests[0].attempts[0].status, "started");
  assert.ok(output.observerCoverage.problems.some((p) => p.includes("no terminal status")));
});

test("missing terminal usage is flagged, not zero-filled", () => {
  const recorder = makeRecorder();
  const handle = recorder.beginMainRequest({});
  recorder.noteProviderPayload({ model: "gpt-6.1-sol" });
  const attemptId = recorder.beginAttempt(handle.index, "identity");
  recorder.noteWireBody(attemptId, { model: "gpt-6.1-sol" }, "identity");
  recorder.noteProviderStreamEvent({ type: "response.completed", response: {} });
  recorder.noteAssistantMessageEnd(assistantMessage([{ type: "text", text: "done" }]));
  recorder.noteAgentSettled(false);
  const problems = recorder.output().observerCoverage.problems;
  assert.ok(problems.some((p) => p.includes("no usage")), "missing usage is flagged");
  assert.equal(recorder.output().requests[0].attempts[0].usage, undefined);
});

test("resumption classification: initial, post-tool, and the final answer producer", () => {
  const recorder = makeRecorder();
  const first = recorder.beginMainRequest({ messages: [] });
  recorder.noteProviderPayload({ model: "gpt-6.1-sol" });
  const a1 = recorder.beginAttempt(first.index, "identity");
  recorder.noteWireBody(a1, { model: "gpt-6.1-sol" }, "identity");
  recorder.noteProviderStreamEvent({ type: "response.completed", response: { usage: { input_tokens: 10, output_tokens: 5 } } });
  recorder.noteAssistantMessageEnd(assistantMessage([
    { type: "toolCall", id: "c1", name: "intelli_research", arguments: {} },
  ]));
  recorder.noteToolExecutionStart({ toolCallId: "c1", toolName: "intelli_research", args: {} });
  recorder.noteToolResultMessage({
    role: "toolResult",
    toolCallId: "c1",
    content: [{ type: "text", text: "report at .search/x" }],
    isError: false,
  });
  const second = recorder.beginMainRequest({ messages: [] });
  recorder.noteProviderPayload({ model: "gpt-6.1-sol" });
  const a2 = recorder.beginAttempt(second.index, "identity");
  recorder.noteWireBody(a2, { model: "gpt-6.1-sol" }, "identity");
  recorder.noteProviderStreamEvent({ type: "response.completed", response: { usage: { input_tokens: 20, output_tokens: 7 } } });
  recorder.noteAssistantMessageEnd(assistantMessage([{ type: "text", text: "final answer" }]));
  recorder.noteAgentSettled(false);
  const output = recorder.output();
  assert.equal(output.requests[0].afterToolCall, false);
  assert.equal(output.requests[1].afterToolCall, true);
  assert.equal(output.requests[1].finalAnswerProducing, true);
  assert.equal(output.requests[0].finalAnswerProducing, false);
  assert.equal(output.finalAnswer, "final answer");
  assert.equal(recorder.outcome(), "completed");
  assert.equal(output.toolCalls[0].resultText, "report at .search/x");
});

test("empty or error assistant messages are never final-answer-producing", () => {
  const recorder = makeRecorder();
  const first = recorder.beginMainRequest({});
  recorder.noteProviderPayload({ model: "gpt-6.1-sol" });
  const a1 = recorder.beginAttempt(first.index, "identity");
  recorder.noteWireBody(a1, { model: "gpt-6.1-sol" }, "identity");
  recorder.noteProviderStreamEvent({ type: "response.completed", response: { usage: { input_tokens: 10, output_tokens: 5 } } });
  recorder.noteAssistantMessageEnd(assistantMessage([{ type: "text", text: "   " }])); // empty text
  const second = recorder.beginMainRequest({});
  recorder.noteProviderPayload({ model: "gpt-6.1-sol" });
  const a2 = recorder.beginAttempt(second.index, "identity");
  recorder.noteWireBody(a2, { model: "gpt-6.1-sol" }, "identity");
  recorder.noteProviderStreamEvent({ type: "response.completed", response: { usage: { input_tokens: 10, output_tokens: 5 } } });
  recorder.noteAssistantMessageEnd(assistantMessage([{ type: "text", text: "broken" }], "error"));
  recorder.noteAgentSettled(false);
  const output = recorder.output();
  assert.equal(output.requests.some((r) => r.finalAnswerProducing), false);
  assert.equal(recorder.outcome(), "failed");
  assert.ok(output.error !== undefined);
});

test("nested tool calls do not set afterToolCall; unexpected top-level tools are nonconforming", () => {
  const recorder = makeRecorder({ allowedTopLevelTools: ["codemode", "intelli_research", "read"] });
  const first = recorder.beginMainRequest({});
  recorder.noteProviderPayload({ model: "gpt-6.1-sol" });
  const attempt = recorder.beginAttempt(first.index, "synthetic");
  recorder.noteWireBody(attempt, { model: "gpt-6.1-sol" }, "synthetic");
  recorder.noteProviderStreamEvent({ type: "response.completed", response: { usage: { input_tokens: 1, output_tokens: 1 } } });
  recorder.noteAssistantMessageEnd(assistantMessage([
    { type: "toolCall", id: "cm1", name: "codemode", arguments: { code: "return 1" } },
  ]));
  recorder.noteToolExecutionStart({ toolCallId: "cm1", toolName: "codemode", args: { code: "return 1" } });
  recorder.noteToolExecutionStart({ toolCallId: "cm1/1", toolName: "intelli_research", args: {}, parentToolCallId: "cm1" });
  recorder.noteToolResultMessage({ role: "toolResult", toolCallId: "cm1/1", content: [{ type: "text", text: "nested" }] });
  recorder.noteToolResultMessage({ role: "toolResult", toolCallId: "cm1", content: [{ type: "text", text: "Script completed" }] });
  const second = recorder.beginMainRequest({});
  recorder.noteProviderPayload({ model: "gpt-6.1-sol" });
  const a2 = recorder.beginAttempt(second.index, "synthetic");
  recorder.noteWireBody(a2, { model: "gpt-6.1-sol" }, "synthetic");
  recorder.noteProviderStreamEvent({ type: "response.completed", response: { usage: { input_tokens: 1, output_tokens: 1 } } });
  recorder.noteAssistantMessageEnd(assistantMessage([{ type: "text", text: "answer" }]));
  recorder.noteToolExecutionStart({ toolCallId: "rogue", toolName: "bash", args: {} });
  recorder.noteAgentSettled(false);
  const output = recorder.output();
  assert.ok(output.toolCalls.some((call) => call.parentToolCallId === "cm1" && call.name === "intelli_research"));
  assert.equal(output.requests[1].afterToolCall, true, "top-level codemode result still marks a resumption");
  assert.ok(output.conformance.problems.some((p) => p.includes("unexpected top-level tool call: bash")));
});

test("journal enrichment, admission counting and rejected research invocations", () => {
  const recorder = makeRecorder();
  recorder.journal().record({ kind: "research-admitted", data: {} });
  recorder.journal().record({ kind: "admission-rejected", data: {} });
  recorder.noteAgentSettled(false);
  const output = recorder.output();
  assert.equal(recorder.researchAdmissions, 1);
  assert.ok(output.conformance.problems.some((p) => p.includes("admission gate")));
  for (const event of output.adapterEvents) {
    assert.ok(typeof event.at === "string" && event.at.length > 0, "journal events carry timestamps");
    assert.equal(event.runId, "unit");
  }
});

test("durable sink receives every event synchronously, including the one that throws", () => {
  const durable: JournalEvent[] = [];
  const durableJournal: Journal = { record: (event) => { durable.push(event); } };
  const recorder = makeRecorder({ durable: durableJournal });
  const handle = recorder.beginMainRequest({});
  recorder.noteProviderPayload({ model: "gpt-6.1-sol", input: [] });
  const attemptId = recorder.beginAttempt(handle.index, "identity");
  assert.throws(() => recorder.noteWireBody(attemptId, { different: true }, "identity"), WireIntegrityError);
  const kinds = durable.map((event) => event.kind);
  assert.ok(kinds.includes("observer/run-started"));
  assert.ok(kinds.includes("observer/main-request"));
  assert.ok(kinds.includes("observer/main-attempt"));
  assert.ok(kinds.includes("observer/wire-mismatch"), "mismatch evidence survives a would-be crash");
  assert.ok(kinds.includes("observer/nonconformance") === false || durable.length >= 4);
});

test("failure assistant message outside a request is retained without inventing coverage", () => {
  const recorder = makeRecorder();
  recorder.noteAssistantMessageEnd(assistantMessage([{ type: "text", text: "" }], "error"));
  recorder.noteAgentSettled(false);
  const output = recorder.output();
  assert.equal(output.observerCoverage.verified, true, JSON.stringify(output.observerCoverage.problems));
  assert.equal(recorder.outcome(), "failed");
  assert.ok(output.error !== undefined);
  const journal = output.adapterEvents.find((event) => event.kind === "observer/assistant-message-outside-request");
  assert.ok(journal, "failure message journalled");
});

test("output without settlement never fabricates a completed run", () => {
  const recorder = makeRecorder();
  completeOneRequest(recorder, "partial but unsettled");
  const output = recorder.output();
  assert.equal(recorder.outcome(), "nonconforming");
  assert.ok(output.conformance.problems.some((p) => p.includes("never settled")));
  assert.ok(output.observerCoverage.problems.some((p) => p.includes("never settled")));
  assert.ok(output.adapterEvents.some((event) => event.kind === "observer/output-without-settlement"));
});

test("aborted runs retain partial records and settle once", () => {
  const recorder = makeRecorder();
  const handle = recorder.beginMainRequest({});
  recorder.noteProviderPayload({ model: "gpt-6.1-sol" });
  const attemptId = recorder.beginAttempt(handle.index, "identity");
  recorder.noteWireBody(attemptId, { model: "gpt-6.1-sol" }, "identity");
  recorder.failAttempt(attemptId, "aborted", "Request was aborted");
  recorder.noteAgentSettled(true);
  recorder.noteAgentSettled(true); // idempotent
  const output = recorder.output();
  assert.equal(recorder.outcome(), "failed");
  assert.equal(output.requests.length, 1);
  assert.equal(output.requests[0].attempts[0].status, "aborted");
  assert.equal(output.adapterEvents.filter((event) => event.kind === "observer/agent-settled").length, 1);
});

test("full context is preserved in MainRequest.context", () => {
  const recorder = makeRecorder();
  const context = { messages: [{ role: "system", content: "sys" }, { role: "user", content: "hi" }] };
  const handle = recorder.beginMainRequest(context);
  recorder.noteProviderPayload({ model: "gpt-6.1-sol" });
  const attemptId = recorder.beginAttempt(handle.index, "identity");
  recorder.noteWireBody(attemptId, { model: "gpt-6.1-sol" }, "identity");
  recorder.noteProviderStreamEvent({ type: "response.completed", response: { usage: { input_tokens: 1, output_tokens: 1 } } });
  recorder.noteAssistantMessageEnd(assistantMessage([{ type: "text", text: "ok" }]));
  recorder.noteAgentSettled(false);
  const stored = recorder.output().requests[0].context as { messages: unknown[] };
  assert.equal(stored.messages.length, 2);
});

test("final transcript snapshot replaces the assistant-only fallback", () => {
  const recorder = makeRecorder();
  completeOneRequest(recorder, "answer");
  recorder.noteAgentSettled(false);
  const before = recorder.output().finalMessages;
  assert.equal(before.length, 1, "fallback keeps the assistant message");
  recorder.noteFinalTranscript([{ role: "system" }, { role: "user" }, { role: "assistant" }, { role: "toolResult" }]);
  assert.equal(recorder.output().finalMessages.length, 4);
});
