// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { Tiktoken } from "js-tiktoken/lite";
import o200kBase from "js-tiktoken/ranks/o200k_base";
import {
  AnalysisInputError,
  analysePairs,
  analyseRun,
  estimateTokens,
  renderAnalysisMarkdown,
  serialiseAttribution,
} from "../scripts/research-handoff/analyse.js";
import { assessAdequacy } from "../scripts/research-handoff/adequacy.js";
import type {
  AdequacyAssessment,
  Arm,
  Phase,
  RunRecord,
  RunStatus,
} from "../scripts/research-handoff/contracts.js";

const encoding = new Tiktoken(o200kBase);
const BASELINE_ROUTE = "Make one direct intelli_research call using the exact parameters below.";
const CANDIDATE_ROUTE = "Make one Codemode call and return the research text once.";
const PROMPT = [
  "Research the queue task, then answer with citations and the report reference.",
  BASELINE_ROUTE,
  "Do not perform additional research calls.",
  "Research parameters:",
  '{"query":"queue"}',
].join("\n\n");
const SYSTEM = "Follow the assigned route and preserve diagnostics.";
const RESULT = "## Summary\n\nUseful queue evidence and necessary status.\n\nReport: .search/run/report.md";
const SCRIPT = "const result = await tools.intelli_research({ query: 'queue' }); return result;";
// Captured from the permitted 20261104T132013Z-synthetic-v2 baseline system message.
const INTEGRATED_SECTIONS = {
  preamble: "You are a coding assistant running inside pi, a coding agent harness. Help users inspect files, run commands, and modify code.",
  tools: `<tools>
- intelli_research: intelli_research(query): full search → fetch → extract → collate pipeline with caching
- read: Read file contents

Additional tools may be available.
</tools>`,
  rules: `<rules>
- Use intelli_research when the user needs current web information (docs, APIs, best practices, library updates). For quick factual questions, use intelli_search alone.
- Use maxUrls to control breadth: 3 for targeted, 10 (default) for broad, 16 for exhaustive. The setting caps requests at maxUrls (default 20).
- Always provide focusPrompt to guide extraction. Without it the LLM extracts generically. Translate the user's intent into a specific extraction focus.
- The tool result contains a concise summary — use it directly. Only read .search/ cache files when the summary is insufficient.
- Use domains to target specific sites (e.g., ['docs.python.org']) when the user references a specific documentation source.
- Use read to examine files instead of cat or sed.
- Be concise in your responses
- Show file paths clearly when working with files
</rules>`,
  docs: `<docs>
Pi documentation (read only when the user asks about the harness itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: /home/miah0x41/.pi/agent/install/releases/1.5.0/node_modules/@earendil-works/pi-coding-agent/README.md
- Additional docs: /home/miah0x41/.pi/agent/install/releases/1.5.0/node_modules/@earendil-works/pi-coding-agent/docs
- Examples: /home/miah0x41/.pi/agent/install/releases/1.5.0/node_modules/@earendil-works/pi-coding-agent/examples (extensions, custom tools, SDK)
- When reading pi docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory
- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), packages (docs/packages.md), environment variables (docs/environment-variables.md), MCP servers (docs/mcp.md), codemode scripts and non-LLM models such as classifiers and image models (docs/codemode.md)
- Before implementing harness changes, read the relevant docs and examples in full, following related cross-references.
</docs>`,
  cwd: `<cwd>
/srv/secure/repos/CURIO/.worktrees/pi-intelli-search/research-handoff-runner/evidence/benchmarks/research-handoff/20261104T132013Z-synthetic-v2/runs/20261104T132013Z-synthetic-v2-baseline/workspace
</cwd>`,
} as const;

function tokens(text: string): number {
  return encoding.encode(text, "all", []).length;
}

function withoutEncrypted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutEncrypted);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== "encrypted_content")
    .map(([key, entry]) => [key, withoutEncrypted(entry)]));
}

function adequateAssessment(): AdequacyAssessment {
  return {
    assessor: "synthetic-reviewer",
    criteria: Array.from({ length: 6 }, (_, index) => ({
      id: index + 1,
      pass: true,
      justification: `Synthetic reason ${index + 1}.`,
      sourceRefs: [`S${index + 1}`],
    })),
    materialUnsupportedClaim: false,
    evidenceAccessible: true,
    review: {
      reviewer: "independent-reviewer",
      agrees: true,
      evidencePath: "evidence/review.md",
      rationale: "Independent source-cited agreement with all six grades.",
      sourceRefs: ["S1", "S2", "S3", "S4", "S5", "S6"],
      disagreements: [],
    },
  };
}

interface RecordOptions {
  runId?: string;
  arm?: Arm;
  phase?: Phase;
  pair?: number;
  status?: RunStatus;
  inputTokens?: number;
  outputTokens?: number;
}

function makeRecord(options: RecordOptions = {}): RunRecord {
  const arm = options.arm ?? "baseline";
  const callName = arm === "baseline" ? "intelli_research" : "codemode";
  const visibleResult = arm === "baseline" ? RESULT : `Script completed\nWall time 0.1 seconds\nOutput:\n${RESULT}`;
  const input = arm === "baseline" ? { query: "queue" } : { code: SCRIPT };
  const prompt = arm === "baseline" ? PROMPT : PROMPT.replace(BASELINE_ROUTE, CANDIDATE_ROUTE);
  const declarations = [{ name: callName, description: "Synthetic declaration", parameters: {} }];
  const firstContext = {
    messages: [
      { role: "system", content: SYSTEM, toolsAdded: declarations, timestamp: 1 },
      { role: "user", content: prompt, timestamp: 2 },
    ],
  };
  const reasoning = { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "OPAQUE-REASONING-BYTES" };
  const assistantMessage = {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "not sent as plaintext", thinkingSignature: JSON.stringify(reasoning) },
      { type: "toolCall", id: "call-1", name: callName, arguments: input },
    ],
    api: "openai-codex-responses",
    provider: "openai-codex",
    model: "gpt-6.1-sol",
    usage: { input: 100, output: 20, totalTokens: 120, cacheRead: 40, cacheWrite: 0, cost: { total: 0 } },
    stopReason: "toolUse",
    timestamp: 3,
  };
  const toolResultMessage = {
    role: "toolResult",
    toolCallId: "call-1",
    toolName: callName,
    content: [{ type: "text", text: visibleResult }],
    details: { nested: "session only" },
    nestedCalls: { calls: [], complete: true },
    usage: assistantMessage.usage,
    isError: false,
    timestamp: 4,
  };
  const finalAssistantMessage = {
    ...assistantMessage,
    content: [{ type: "text", text: "Synthetic final answer with .search/run/report.md." }],
    stopReason: "stop",
    timestamp: 5,
  };
  const secondContext = { messages: [...firstContext.messages, assistantMessage, toolResultMessage] };
  const firstPayload = {
    model: "gpt-6.1-sol",
    input: [
      { role: "developer", content: SYSTEM },
      { role: "user", content: [{ type: "input_text", text: prompt }] },
    ],
    tools: declarations,
  };
  const callPayload = arm === "baseline"
    ? { type: "function_call", call_id: "call-1", name: callName, arguments: JSON.stringify(input) }
    : { type: "custom_tool_call", call_id: "call-1", name: callName, input: SCRIPT };
  const outputPayload = arm === "baseline"
    ? { type: "function_call_output", call_id: "call-1", output: visibleResult }
    : { type: "custom_tool_call_output", call_id: "call-1", output: visibleResult };
  const secondPayload = {
    ...firstPayload,
    input: [...firstPayload.input, reasoning, callPayload, outputPayload],
  };
  return {
    manifest: {
      schemaVersion: 1,
      runId: options.runId ?? `${arm}-1`,
      arm,
      phase: options.phase ?? "measured",
      pair: options.pair ?? 1,
      status: options.status ?? "completed",
      startedAt: "2026-11-04T00:00:00Z",
      endedAt: "2026-11-04T00:01:00Z",
      host: { path: "/host/pi", version: "1.5.0", dependencies: {} },
      mainModel: { provider: "openai-codex", model: "gpt-6.1-sol" },
      protocolSha256: "protocol",
      codeSha256: "code",
      corpusSha256: "corpus",
      settingsSha256: "settings",
      promptSha256: "prompt",
    },
    prompt,
    systemPrompt: SYSTEM,
    catalogue: declarations,
    requests: [
      {
        id: "request-0",
        logicalIndex: 0,
        context: firstContext,
        payload: firstPayload,
        attempts: [{
          id: "attempt-0",
          startedAt: "2026-11-04T00:00:00Z",
          endedAt: "2026-11-04T00:00:01Z",
          payload: firstPayload,
          wireEncoding: "synthetic",
          status: "completed",
          usage: {
            input: options.inputTokens ?? 100,
            output: options.outputTokens ?? 20,
            cacheRead: 40,
            cacheWrite: 0,
            reasoning: 5,
            reportedCostUsd: 0,
          },
        }],
        afterToolCall: false,
        finalAnswerProducing: false,
        assistantMessage,
      },
      {
        id: "request-1",
        logicalIndex: 1,
        context: secondContext,
        payload: secondPayload,
        attempts: [{
          id: "attempt-1",
          startedAt: "2026-11-04T00:00:02Z",
          endedAt: "2026-11-04T00:00:03Z",
          payload: secondPayload,
          wireEncoding: "synthetic",
          status: "completed",
          usage: {
            input: options.inputTokens ?? 100,
            output: options.outputTokens ?? 20,
            cacheRead: 40,
            cacheWrite: 0,
            reasoning: 5,
            reportedCostUsd: 0,
          },
        }],
        afterToolCall: true,
        finalAnswerProducing: true,
        assistantMessage: finalAssistantMessage,
      },
    ],
    toolCalls: [
      {
        id: "call-1",
        name: callName,
        input,
        resultText: visibleResult,
        isError: false,
      },
      ...(arm === "candidate" ? [{
        id: "nested-research-1",
        name: "intelli_research",
        parentToolCallId: "call-1",
        input: { query: "queue" },
        resultText: RESULT,
        isError: false,
      }] : []),
    ],
    adapterEvents: [
      { kind: "research-result", data: { outcome: "completed", textSha256: createHash("sha256").update(RESULT).digest("hex") } },
      { kind: "progress", data: { stage: "fetch" } },
      { kind: "model-request", stage: "extract", data: { role: "extract" } },
      { kind: "model-completion", stage: "extract", data: {
        role: "extract",
        usageEstimate: { input: 50, output: 10, cacheRead: 0, cost: { total: 0.001, totalFromProvider: false } },
        usageKind: "sdk-normalised-estimate",
        text: "Extracted text",
        textSha256: "extract-text",
      } },
      { kind: "model-request", stage: "collate", data: { role: "collate" } },
      { kind: "model-completion", stage: "collate", data: {
        role: "collate",
        usageEstimate: { input: 80, output: 20, cacheRead: 0, cost: { total: 0.002, totalFromProvider: false } },
        usageKind: "sdk-normalised-estimate",
        text: "Collation text",
        textSha256: "collate-text",
      } },
    ],
    finalAnswer: "Synthetic final answer with .search/run/report.md.",
    finalMessages: [...secondContext.messages, finalAssistantMessage],
    inputIntegrity: { matched: true, problems: [], complete: true, completenessProblems: [] },
    pipelineOutcome: "completed",
    financialControl: { budgetLimited: false, overrun: false, activeReservations: false },
    evidenceAccess: { readable: true, reportPaths: [".search/run/report.md"], problems: [] },
    conformance: { conforms: true, problems: [] },
    observerCoverage: { verified: true, problems: [] },
    adequacy: adequateAssessment(),
  };
}

function pair(inputTokens = { baseline: 100, candidate: 80 }, pairNumber = 1): RunRecord[] {
  const records = [
    makeRecord({ runId: `baseline-${pairNumber}`, pair: pairNumber, inputTokens: inputTokens.baseline, outputTokens: 0 }),
    makeRecord({ runId: `candidate-${pairNumber}`, arm: "candidate", pair: pairNumber, inputTokens: inputTokens.candidate, outputTokens: 0 }),
  ];
  const order: Arm[] = pairNumber % 2 === 1 ? ["baseline", "candidate"] : ["candidate", "baseline"];
  for (const record of records) {
    const position = (pairNumber - 1) * 2 + order.indexOf(record.manifest.arm);
    const start = Date.UTC(2026, 10, 4) + position * 90_000;
    record.manifest.startedAt = new Date(start).toISOString();
    record.manifest.endedAt = new Date(start + 60_000).toISOString();
  }
  return records;
}

function completeBatch(): RunRecord[] {
  return Array.from({ length: 10 }, (_, index) => pair({ baseline: 100, candidate: 90 }, index + 1)).flat();
}

describe("offline run accounting", () => {
  it("counts attempts once, keeps retries distinct from resumptions and reconciles signed estimates", () => {
    const record = makeRecord();
    record.requests[0].attempts[0].usage = { input: 50, output: 5, cacheRead: 20, reasoning: 2 };
    record.requests[1].attempts[0].usage = { input: 70, output: 7, cacheRead: 30, reasoning: 3 };
    record.requests[1].attempts.push({
      ...record.requests[1].attempts[0],
      id: "attempt-1-retry",
      status: "error",
      usage: { input: 80, output: 8, cacheRead: 35, reasoning: 4 },
    });
    record.toolCalls.push({
      id: "nested-call",
      name: "intelli_extract",
      parentToolCallId: "call-1",
      input: { page: "private" },
      resultText: "Nested result is not a top-level handoff.",
    });

    const row = analyseRun(record);
    assert.equal(row.providerAttemptCount, 3);
    assert.equal(row.requestCount, 2);
    assert.equal(row.handoffs.transportRetryAttempts, 1);
    assert.equal(row.handoffs.topLevelHandoffs, 1);
    assert.equal(row.handoffs.postToolResumptions, 1);
    assert.equal(row.handoffs.finalAnswerResumptions, 1);
    assert.equal(row.handoffs.additionalResumptions, 0);
    assert.equal(row.cumulativeInputTokens, 200);
    assert.equal(row.cumulativeOutputTokens, 20);
    assert.equal(row.cumulativeTotalTokens, 220);
    assert.equal(row.usage.cacheRead.value, 85);
    assert.equal(row.usage.reasoning.value, 9);
    assert.equal(row.usage.total.value, 220, "reasoning and cache components are not added again");
    assert.equal(row.usage.uncachedInput.value, 115);

    for (const request of record.requests) {
      for (const attempt of request.attempts) {
        const attribution = row.attribution.attempts.find(item => item.attemptId === attempt.id);
        assert.ok(attribution);
        const whole = tokens(serialiseAttribution(withoutEncrypted(attempt.payload)));
        assert.equal(attribution.wholeRequestTokens, whole);
        assert.equal(attribution.providerInputTokens, attempt.usage?.input);
        assert.equal(attribution.residual, (attempt.usage?.input ?? 0) - whole);
      }
    }
    assert.ok(row.attribution.attempts.some(item => item.residual !== undefined && item.residual < 0));
    const fragmentSum = Object.values(row.attribution.attempts[1].componentTokens).reduce((sum, value) => sum + value, 0);
    assert.notEqual(fragmentSum, row.attribution.attempts[1].wholeRequestTokens, "fragment estimates are not forced to equal the whole request");
    assert.equal(row.attribution.attempts[1].componentTokenSum, fragmentSum);
    assert.ok((row.attribution.attempts[1].opaqueReasoningBytes ?? 0) > 0);
    assert.ok(row.attribution.attempts[1].componentTokens["common-instructions-query"] > 0);
    assert.ok(row.attribution.attempts[1].componentTokens["arm-declarations-guidance"] > 0);
    assert.ok(row.attribution.attempts[1].componentTokens["arguments-scripts"] > 0);
    assert.ok(row.attribution.attempts[1].componentTokens["useful-result-evidence-status"] > 0);
    assert.equal(row.attribution.attempts[1].componentTokens["necessary-status"], 0);
    assert.equal(row.attribution.usefulToolReturnTokens, tokens(RESULT));
    assert.ok((row.attribution.finalRetainedContextTokens ?? 0) > 0);
    assert.ok((row.attribution.finalRetainedContextTokens ?? 0) < tokens(serialiseAttribution(record.finalMessages)));
    assert.ok((row.attribution.peakLogicalRequestTokens ?? 0)
      <= Math.max(...record.requests.map(request => tokens(serialiseAttribution(request.context)))));
    assert.notEqual(row.attribution.cumulativeLogicalContextTokens, row.attribution.finalRetainedContextTokens);
  });

  it("attributes a generated raw script separately from its later input processing", () => {
    const row = analyseRun(makeRecord({ arm: "candidate", runId: "candidate-script" }));
    assert.equal(row.attribution.generatedRawScriptTokens, tokens(SCRIPT));
    const baseline = makeRecord();
    baseline.toolCalls[0].input = { code: SCRIPT };
    assert.equal(analyseRun(baseline).attribution.generatedRawScriptTokens, 0);
    assert.equal(
      row.attribution.generatedArgumentScriptTokens,
      tokens(serialiseAttribution({ code: SCRIPT })),
    );
    assert.ok(row.attribution.laterInputArgumentScriptTokens > 0);
    assert.ok(row.attribution.logicalInputArgumentScriptTokens > 0);
    assert.equal(row.attribution.finalAnswerTokens, tokens("Synthetic final answer with .search/run/report.md."));
  });

  it("retains partial observed sums without converting missing usage to zero", () => {
    const record = makeRecord();
    record.requests[0].attempts[0].usage = { input: 50 };
    record.requests[1].attempts[0].usage = undefined;
    const row = analyseRun(record);
    assert.equal(row.usage.input.value, undefined);
    assert.equal(row.usage.input.observedValue, 50);
    assert.deepEqual(row.usage.input.missingAttemptIds, ["attempt-1"]);
    assert.equal(row.usage.output.value, undefined);
    assert.equal(row.usage.output.observedValue, 0);
    assert.equal(row.usage.total.value, undefined);
    assert.equal(row.usage.total.observedValue, 50);
    assert.equal(row.usage.cacheRead.complete, false);
    assert.equal(row.usage.cacheRead.value, undefined);

    const result = analysePairs([record, makeRecord({ runId: "candidate-1", arm: "candidate" })]);
    const summary = result.views.primary.find(item => item.metric === "cumulativeTotalTokens");
    assert.equal(summary?.denominator, 0);
    assert.equal(result.pairs[0].metrics.cumulativeTotalTokens.difference, undefined);
  });

  it("rejects duplicate identities and inconsistent logical sequences", () => {
    const duplicateAttempt = makeRecord();
    duplicateAttempt.requests[1].attempts[0].id = "attempt-0";
    assert.throws(() => analyseRun(duplicateAttempt), AnalysisInputError);

    const duplicateRequest = makeRecord();
    duplicateRequest.requests[1].id = "request-0";
    assert.throws(() => analyseRun(duplicateRequest), /Duplicate or empty logical request/);

    const gap = makeRecord();
    gap.requests[1].logicalIndex = 2;
    assert.throws(() => analyseRun(gap), /inconsistent index/);

    const mixedBase = makeRecord();
    mixedBase.requests[0].logicalIndex = 1;
    assert.throws(() => analyseRun(mixedBase), /inconsistent index/);

    const initialResumption = makeRecord();
    initialResumption.requests[0].afterToolCall = true;
    assert.throws(() => analyseRun(initialResumption), /Initial logical request/);

    const duplicateTool = makeRecord();
    duplicateTool.toolCalls.push({ ...duplicateTool.toolCalls[0] });
    assert.throws(() => analyseRun(duplicateTool), /Duplicate or empty tool-call/);

    const duplicateRun = pair();
    duplicateRun[1].manifest.runId = duplicateRun[0].manifest.runId;
    const duplicateResult = analysePairs(duplicateRun);
    assert.equal(duplicateResult.runs.length, 2);
    assert.ok(duplicateResult.runs.every(run => run.analysisError?.includes("Duplicate run identity")));
    assert.equal(duplicateResult.views.primary.find(item => item.metric === "cumulativeTotalTokens")?.denominator, 0);
  });

  it("counts extra handoffs and resumptions without using progress or nested events", () => {
    const record = makeRecord();
    const finalRequest = record.requests[1];
    record.requests[1] = {
      ...finalRequest,
      id: "request-extra-1",
      finalAnswerProducing: false,
    };
    record.requests.push(
      {
        ...finalRequest,
        id: "request-extra-2",
        logicalIndex: 2,
        finalAnswerProducing: false,
        attempts: finalRequest.attempts.map(attempt => ({ ...attempt, id: "attempt-extra-2" })),
      },
      {
        ...finalRequest,
        id: "request-final",
        logicalIndex: 3,
        finalAnswerProducing: true,
        attempts: finalRequest.attempts.map(attempt => ({ ...attempt, id: "attempt-final" })),
      },
    );
    record.toolCalls.push(
      { id: "call-2", name: "read", input: { path: "report.md" } },
      { id: "call-3", name: "intelli_research", input: { query: "extra" }, isError: true, resultText: "Rejected" },
      { id: "nested", name: "intelli_extract", parentToolCallId: "call-1", input: {} },
    );
    record.adapterEvents = Array.from({ length: 20 }, () => ({ kind: "progress", data: {} }));
    const row = analyseRun(record);
    assert.equal(row.requestCount, 4);
    assert.equal(row.handoffs.topLevelHandoffs, 3);
    assert.equal(row.handoffs.extraTopLevelHandoffs, 2);
    assert.equal(row.handoffs.postToolResumptions, 3);
    assert.equal(row.handoffs.finalAnswerResumptions, 1);
    assert.equal(row.handoffs.additionalResumptions, 2);
    assert.equal(row.recordedConforms, true);
    assert.equal(row.observedRouteConforms, false);
    assert.equal(row.conforms, false);
    assert.equal(row.attribution.errorToolReturnTokens, tokens("Rejected"));
  });

  it("rejects an unchanged-topology candidate that silently projects its research return", () => {
    const record = makeRecord({ arm: "candidate" });
    record.toolCalls[0].resultText = "Script completed\nWall time 0.1 seconds\nOutput:\nA shorter substitute";
    const row = analyseRun(record);
    assert.equal(row.observedRouteConforms, true);
    assert.equal(row.returnPreserved, false);
    assert.equal(row.conforms, false);
  });

  it("requires the exact baseline and candidate tool routes, including candidate nesting", () => {
    assert.equal(analyseRun(makeRecord()).observedRouteConforms, true);
    assert.equal(analyseRun(makeRecord({ arm: "candidate" })).observedRouteConforms, true);

    const wrongBaseline = makeRecord();
    wrongBaseline.toolCalls[0].name = "read";
    assert.equal(analyseRun(wrongBaseline).observedRouteConforms, false);

    const missingNestedResearch = makeRecord({ arm: "candidate" });
    missingNestedResearch.toolCalls = missingNestedResearch.toolCalls.filter(call => !call.parentToolCallId);
    assert.equal(analyseRun(missingNestedResearch).observedRouteConforms, false);

    const wrongParent = makeRecord({ arm: "candidate" });
    wrongParent.toolCalls[1].parentToolCallId = "another-call";
    assert.equal(analyseRun(wrongParent).observedRouteConforms, false);

    const extraRead = makeRecord();
    extraRead.toolCalls.push({ id: "read-1", name: "read", input: { path: "report.md" } });
    assert.equal(analyseRun(extraRead).observedRouteConforms, false);

    const toolError = makeRecord({ arm: "candidate" });
    toolError.toolCalls[1].isError = true;
    assert.equal(analyseRun(toolError).observedRouteConforms, false);
  });
});

describe("adequacy", () => {
  it("requires six unique cited criteria and readable evidence", () => {
    const result = assessAdequacy(adequateAssessment());
    assert.equal(result.adequate, true);
    assert.equal(result.uniqueCriteria, true);
    assert.deepEqual(result.problems, []);
  });

  it("rejects duplicate criteria, missing reasons, missing sources and unsupported claims", () => {
    const duplicate = adequateAssessment();
    duplicate.criteria[1].id = 1;
    assert.equal(assessAdequacy(duplicate).adequate, false);
    assert.match(assessAdequacy(duplicate).problems.join(" "), /missing 2.*duplicate 1/);

    const noReason = adequateAssessment();
    noReason.criteria[2].justification = " ";
    assert.equal(assessAdequacy(noReason).reasonsCited, false);

    const noSource = adequateAssessment();
    noSource.criteria[3].sourceRefs = [];
    assert.equal(assessAdequacy(noSource).sourcesCited, false);

    const unsupported = adequateAssessment();
    unsupported.materialUnsupportedClaim = true;
    assert.equal(assessAdequacy(unsupported).adequate, false);

    const unknownUnsupportedClaim = adequateAssessment();
    unknownUnsupportedClaim.materialUnsupportedClaim = undefined as unknown as boolean;
    const unknownClaimResult = assessAdequacy(unknownUnsupportedClaim);
    assert.equal(unknownClaimResult.unsupportedClaimStatusKnown, false);
    assert.equal(unknownClaimResult.adequate, false);

    const missingAssessor = adequateAssessment();
    missingAssessor.assessor = undefined as unknown as string;
    assert.equal(assessAdequacy(missingAssessor).adequate, false);

    const unreadable = adequateAssessment();
    unreadable.evidenceAccessible = false;
    assert.equal(assessAdequacy(unreadable).readableEvidence, false);

    const missing = assessAdequacy(undefined);
    assert.equal(missing.adequate, false);
    assert.deepEqual(missing.criterionIds, []);
  });
});

describe("paired populations", () => {
  it("reports signed differences with mean, median, range and an explicit denominator", () => {
    const records = [
      ...pair({ baseline: 100, candidate: 80 }, 1),
      ...pair({ baseline: 200, candidate: 180 }, 2),
      ...pair({ baseline: 300, candidate: 250 }, 3),
    ];
    const result = analysePairs(records);
    const summary = result.views.primary.find(item => item.metric === "cumulativeTotalTokens");
    assert.equal(summary?.denominator, 3);
    assert.deepEqual(summary?.baseline, { mean: 400, median: 400, range: { minimum: 200, maximum: 600 } });
    assert.deepEqual(summary?.candidate, { mean: 340, median: 360, range: { minimum: 160, maximum: 500 } });
    assert.deepEqual(summary?.difference, { mean: -60, median: -40, range: { minimum: -100, maximum: -40 } });
    assert.equal(result.statusCounts.completed, 6);
    assert.equal(result.positiveClaim.allowed, false);
  });

  it("uses only available pairs for each metric and retains failed and nonconforming rows", () => {
    const records = [
      ...pair({ baseline: 100, candidate: 80 }, 1),
      ...pair({ baseline: 200, candidate: 180 }, 2),
      ...pair({ baseline: 300, candidate: 250 }, 3),
    ];
    records[1].manifest.status = "failed";
    records[1].manifest.endedAt = undefined;
    records[1].requests[1].attempts[0].usage!.output = undefined;
    records[2].manifest.status = "nonconforming";
    records[2].conformance = { conforms: false, problems: ["Extra script."] };
    const result = analysePairs(records);
    const summary = result.views.primary.find(item => item.metric === "cumulativeTotalTokens");
    assert.equal(summary?.denominator, 2);
    assert.deepEqual(summary?.difference, { mean: -70, median: -70, range: { minimum: -100, maximum: -40 } });
    assert.equal(result.statusCounts.failed, 1);
    assert.equal(result.statusCounts.nonconforming, 1);
    assert.equal(result.conformanceCounts.nonconforming, 1);
    assert.equal(result.views.conformingAndAdequate.find(item => item.metric === "cumulativeTotalTokens")?.denominator, 1);
    assert.equal(result.runs.length, 6);
  });

  it("rejects every paired identity mismatch", () => {
    const mismatches: Array<(record: RunRecord) => void> = [
      record => { record.manifest.corpusSha256 = "other-corpus"; },
      record => { record.manifest.protocolSha256 = "other-protocol"; },
      record => { record.manifest.codeSha256 = "other-code"; },
      record => { record.manifest.settingsSha256 = "other-settings"; },
      record => { record.manifest.mainModel = { provider: "other", model: "other" }; },
      record => { record.manifest.host = { path: "/other", version: "0", dependencies: {} }; },
    ];
    for (const mismatch of mismatches) {
      const records = pair();
      mismatch(records[1]);
      const result = analysePairs(records);
      assert.match(result.seriesProblems.join(" "), /mismatched .* identities|Series identity/);
      assert.equal(result.aggregationValid, false);
      assert.equal(result.pairs[0].aggregationValid, false);
      assert.equal(result.pairs[0].metrics.cumulativeTotalTokens.difference, undefined);
      assert.equal(result.views.primary.find(item => item.metric === "cumulativeTotalTokens")?.denominator, 0);
    }
  });

  it("allows the deliberately different per-arm prompt hashes", () => {
    const records = pair();
    records[0].manifest.promptSha256 = "baseline-route-prompt";
    records[1].manifest.promptSha256 = "candidate-route-prompt";
    const result = analysePairs(records);
    assert.equal(result.pairs.length, 1);
    assert.equal(result.views.primary.find(item => item.metric === "cumulativeTotalTokens")?.denominator, 1);
  });

  it("retains but excludes an input-integrity failure from aggregate comparisons", () => {
    const records = pair();
    records[1].inputIntegrity = { matched: false, problems: ["Page digest changed."] };
    const result = analysePairs(records);
    assert.equal(result.pairs.length, 1);
    assert.equal(result.pairs[0].inputIntegrityMatched, false);
    assert.equal(result.pairs[0].metrics.cumulativeTotalTokens.difference, undefined);
    assert.equal(result.views.primary.find(item => item.metric === "cumulativeTotalTokens")?.denominator, 0);
    assert.equal(result.positiveClaim.allowed, false);
    assert.match(result.runs[1].problems.join(" "), /Page digest changed/);
  });

  it("defaults to measured runs and labels diagnostics and synthetic runs separately", () => {
    const measured = pair()[0];
    const diagnostic = makeRecord({ runId: "diagnostic", phase: "diagnostic", pair: undefined });
    const synthetic = makeRecord({ runId: "synthetic", phase: "synthetic", pair: undefined });
    const primary = analysePairs([measured, diagnostic, synthetic]);
    assert.deepEqual(primary.runs.map(run => run.runId), ["baseline-1"]);
    assert.equal(primary.population.label, "primary-measured");
    assert.deepEqual(primary.population.excluded, { measured: 0, diagnostic: 1, synthetic: 1 });

    const diagnostics = analysePairs([measured, diagnostic, synthetic], { phase: "diagnostic" });
    assert.deepEqual(diagnostics.runs.map(run => run.runId), ["diagnostic"]);
    assert.equal(diagnostics.population.label, "diagnostic-separate");
    assert.equal(diagnostics.positiveClaim.applicable, false);

    const synthetics = analysePairs([measured, diagnostic, synthetic], { phase: "synthetic" });
    assert.deepEqual(synthetics.runs.map(run => run.runId), ["synthetic"]);
    assert.equal(synthetics.population.label, "synthetic-separate");
  });

  it("retains empty not-run and incompletely observed failed rows without pairing their zeros", () => {
    const records = pair();
    const notRun = makeRecord({ runId: "candidate-2", arm: "candidate", pair: 2, status: "not-run" });
    const failed = makeRecord({ runId: "candidate-3", arm: "candidate", pair: 3, status: "failed" });
    for (const [record, problem] of [[notRun, "Not run."], [failed, "Observer trace incomplete."]] as const) {
      record.requests = [];
      record.toolCalls = [];
      record.finalAnswer = "";
      record.finalMessages = [];
      record.adequacy = undefined;
      record.evidenceAccess = { readable: false, reportPaths: [], problems: [problem] };
      record.conformance = { conforms: false, problems: [problem] };
      record.observerCoverage = { verified: false, problems: [problem] };
    }
    records.push(
      makeRecord({ runId: "baseline-2", pair: 2 }),
      notRun,
      makeRecord({ runId: "baseline-3", pair: 3 }),
      failed,
    );
    const result = analysePairs(records);
    assert.equal(result.runs.length, 6);
    assert.equal(result.statusCounts["not-run"], 1);
    assert.equal(result.statusCounts.failed, 1);
    assert.equal(result.pairs.length, 3);
    assert.equal(result.views.primary.find(item => item.metric === "cumulativeTotalTokens")?.denominator, 1);
    assert.equal(result.views.primary.find(item => item.metric === "postToolResumptions")?.denominator, 1);

    for (const [pairIndex, runId] of [[1, "candidate-2"], [2, "candidate-3"]] as const) {
      const row = result.runs.find(run => run.runId === runId);
      assert.equal(row?.observationComplete, false);
      assert.equal(row?.requestCount, 0, "the partial inventory retains its observed zero count");
      assert.equal(row?.handoffs.postToolResumptions, 0);
      for (const metric of [
        "cumulativeTotalTokens",
        "topLevelHandoffs",
        "postToolResumptions",
        "peakLogicalRequestTokens",
        "finalRetainedContextTokens",
        "finalAnswerTokens",
      ] as const) {
        assert.equal(result.pairs[pairIndex].metrics[metric].candidate, undefined);
        assert.equal(result.pairs[pairIndex].metrics[metric].difference, undefined);
      }
    }

    for (const status of ["scheduled", "started", "not-run"] as const) {
      const unfinished = pair();
      unfinished[1].manifest.status = status;
      const unfinishedResult = analysePairs(unfinished);
      assert.equal(unfinishedResult.runs[1].observationComplete, false);
      assert.equal(unfinishedResult.pairs[0].metrics.cumulativeTotalTokens.candidate, undefined);
      assert.equal(unfinishedResult.pairs[0].metrics.postToolResumptions.difference, undefined);
    }
  });
});

describe("positive claim gate", () => {
  it("allows only the frozen primary metric for twenty complete, conforming, adequate measured runs", () => {
    const records = completeBatch();
    // A pair may regress while the frozen gate still evaluates the named mean across all ten pairs.
    records[3].requests.forEach(request => { request.attempts[0].usage!.input = 110; });
    const result = analysePairs(records);
    assert.equal(result.positiveClaim.allowed, true);
    assert.equal(result.positiveClaim.denominator, 10);
    assert.equal(result.positiveClaim.baselineMean, 200);
    assert.equal(result.positiveClaim.candidateMean, 184);
    assert.deepEqual(result.positiveClaim.reasons, []);
    assert.throws(() => analysePairs(records, { positiveClaimMetric: "finalAnswerTokens" } as never), /frozen to cumulativeTotalTokens/);
  });

  it("requires the exact measured pair identities 1 through 10", () => {
    const records = completeBatch();
    for (const record of records) {
      if (record.manifest.pair === 1) record.manifest.pair = 11;
    }
    const result = analysePairs(records);
    assert.equal(result.pairs.length, 10);
    assert.equal(result.positiveClaim.allowed, false);
    assert.match(result.positiveClaim.reasons.join(" "), /pair identities 1 through 10/);
  });

  it("blocks equality, missing metrics, nonconformance and quality failures", () => {
    const equal = completeBatch();
    equal.forEach(record => {
      if (record.manifest.arm === "candidate") {
        record.requests.forEach(request => { request.attempts[0].usage!.input = 100; });
      }
    });
    assert.equal(analysePairs(equal).positiveClaim.allowed, false);

    const missing = completeBatch();
    missing[1].requests[0].attempts[0].usage!.output = undefined;
    const missingResult = analysePairs(missing);
    assert.equal(missingResult.positiveClaim.allowed, false);
    assert.equal(missingResult.positiveClaim.denominator, 9);

    const nonconforming = completeBatch();
    nonconforming[0].conformance = { conforms: false, problems: ["Wrong route."] };
    assert.equal(analysePairs(nonconforming).positiveClaim.allowed, false);

    const inadequate = completeBatch();
    inadequate[0].adequacy!.criteria[0].pass = false;
    assert.equal(analysePairs(inadequate).positiveClaim.allowed, false);

    const unreadable = completeBatch();
    unreadable[0].evidenceAccess = { readable: false, reportPaths: [], problems: ["Missing report."] };
    assert.equal(analysePairs(unreadable).positiveClaim.allowed, false);

    const unobserved = completeBatch();
    unobserved[0].observerCoverage = { verified: false, problems: ["Missing attempt."] };
    assert.equal(analysePairs(unobserved).positiveClaim.allowed, false);
  });

  it("never permits the positive claim for a separately labelled diagnostic population", () => {
    const records = completeBatch().map(record => {
      record.manifest.phase = "diagnostic";
      return record;
    });
    const result = analysePairs(records, { phase: "diagnostic" });
    assert.equal(result.positiveClaim.applicable, false);
    assert.equal(result.positiveClaim.allowed, false);
  });
});

describe("independent review remediation", () => {
  it("retains every integrated system section and nested tools argument without restoring metadata", () => {
    const record = makeRecord();
    const firstContext = record.requests[0].context as { messages: Array<Record<string, unknown>> };
    firstContext.messages[0] = {
      role: "system",
      content: "",
      sections: INTEGRATED_SECTIONS,
      timestamp: 1793798416230,
      usage: { input: 999, output: 999 },
      details: { sessionOnly: true },
      nestedCalls: { calls: [], complete: true },
    };
    const first = analyseRun(record).attribution.logicalRequests[0];
    const expectedProjection = {
      messages: [
        { role: "system", content: "", sections: INTEGRATED_SECTIONS },
        { role: "user", content: record.prompt },
      ],
    };
    assert.equal(first.wholeRequestTokens, tokens(serialiseAttribution(expectedProjection)));
    const formerLossyProjection = {
      messages: [
        { role: "system", content: "", sections: { tools: INTEGRATED_SECTIONS.tools } },
        { role: "user", content: record.prompt },
      ],
    };
    assert.ok(first.wholeRequestTokens > tokens(serialiseAttribution(formerLossyProjection)));

    const nestedArguments = {
      tools: "argument tools",
      preamble: "argument preamble",
      rules: "argument rules",
      docs: "argument docs",
      cwd: "argument cwd",
    };
    const secondContext = record.requests[1].context as { messages: Array<Record<string, unknown>> };
    const assistant = secondContext.messages[2];
    const content = assistant.content as Array<Record<string, unknown>>;
    content[1].arguments = nestedArguments;
    const second = analyseRun(record).attribution.logicalRequests[1];
    const expectedArgumentTokens = Object.values(nestedArguments).reduce((sum, value) => sum + tokens(value), 0);
    assert.equal(second.componentTokens["arguments-scripts"], expectedArgumentTokens);
  });

  it("separates the frozen route paragraph and leaves mixed system guidance unallocated", () => {
    const baseline = analyseRun(makeRecord()).attribution.logicalRequests[0].componentTokens;
    const candidate = analyseRun(makeRecord({ arm: "candidate" })).attribution.logicalRequests[0].componentTokens;
    assert.ok(baseline["arm-declarations-guidance"] >= tokens(BASELINE_ROUTE));
    assert.ok(candidate["arm-declarations-guidance"] >= tokens(CANDIDATE_ROUTE));
    assert.ok(baseline["common-instructions-query"] >= tokens("Research the queue task"));
    assert.ok(baseline.unallocated >= tokens(SYSTEM));
  });

  it("classifies newly converter-generated logical and Responses records without tokenising ciphertext", async () => {
    const converterPath = "/home/miah0x41/.pi/agent/install/releases/1.5.0/node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js";
    const { convertResponsesMessages } = await import(converterPath) as {
      convertResponsesMessages: (model: unknown, context: unknown, providers: Set<string>, options: unknown) => unknown[];
    };
    for (const arm of ["baseline", "candidate"] as const) {
      const record = makeRecord({ arm });
      const context = record.requests[1].context as { messages: Array<Record<string, unknown>> };
      const assistant = context.messages[2];
      const content = assistant.content as Array<Record<string, unknown>>;
      content[0].thinkingSignature = JSON.stringify({
        type: "reasoning", id: "rs_1", summary: [], encrypted_content: "x".repeat(4000),
      });
      const converted = convertResponsesMessages(
        {
          provider: "openai-codex",
          api: "openai-codex-responses",
          id: "gpt-6.1-sol",
          input: ["text"],
          reasoning: true,
          compat: { supportsDeveloperRole: true },
        },
        context,
        new Set(["openai-codex"]),
        {
          supportsMidConvoSystemMessages: false,
          supportsAdditionalTools: false,
          supportsToolSearch: false,
          grammarToolInputProperties: arm === "candidate" ? new Map([["codemode", "code"]]) : new Map(),
        },
      );
      const types = converted.map(item => (item as { type?: string }).type);
      assert.ok(types.includes(arm === "baseline" ? "function_call" : "custom_tool_call"));
      assert.ok(types.includes(arm === "baseline" ? "function_call_output" : "custom_tool_call_output"));
      record.requests[1].attempts[0].payload = { input: converted };
      const row = analyseRun(record);
      const logical = row.attribution.logicalRequests[1];
      const wire = row.attribution.attempts.find(item => item.requestId === "request-1");
      for (const attribution of [logical, wire]) {
        assert.ok(attribution);
        assert.ok(attribution.componentTokens["arguments-scripts"] > 0);
        assert.ok(attribution.componentTokens["useful-result-evidence-status"] > 0);
        assert.equal(attribution.opaqueReasoningBytes, 4000);
        assert.equal(
          attribution.componentTokenSum,
          Object.values(attribution.componentTokens).reduce((sum, value) => sum + value, 0),
        );
      }
      assert.ok((wire?.wholeRequestTokens ?? 0) < tokens(serialiseAttribution(record.requests[1].attempts[0].payload)));
    }
  });

  it("marks logical requests without attempts and missing cache data as incomplete usage", () => {
    const missingAttempt = makeRecord();
    missingAttempt.requests[1].attempts = [];
    const missingRow = analyseRun(missingAttempt);
    assert.equal(missingRow.usage.logicalRequestsWithoutAttempts, 1);
    assert.equal(missingRow.usage.input.complete, false);
    assert.equal(missingRow.usage.total.value, undefined);
    assert.ok(missingRow.usage.input.missingAttemptIds.includes("logical:request-1"));

    const defaultRow = analyseRun(makeRecord());
    assert.equal(defaultRow.usage.uncachedInput.value, 120);
    const rawResponses = makeRecord();
    rawResponses.requests[0].attempts[0].usage!.input = 110;
    rawResponses.requests[0].attempts[0].usage!.cacheRead = 30;
    rawResponses.requests[0].attempts[0].rawUsage = { input_tokens: 110, input_tokens_details: { cached_tokens: 30 } };
    rawResponses.requests[1].attempts[0].usage!.input = 130;
    rawResponses.requests[1].attempts[0].usage!.cacheRead = 50;
    rawResponses.requests[1].attempts[0].rawUsage = { input_tokens: 130, input_tokens_details: { cached_tokens: 50 } };
    assert.equal(analyseRun(rawResponses).usage.uncachedInput.value, 160);
    (rawResponses.requests[0].attempts[0].rawUsage as { input_tokens_details: { cached_tokens: number } })
      .input_tokens_details.cached_tokens = 111;
    assert.throws(() => analyseRun(rawResponses), /raw cached input above raw total input/);
    const missingCache = makeRecord();
    delete missingCache.requests[1].attempts[0].usage!.cacheRead;
    const cacheRow = analyseRun(missingCache);
    assert.equal(cacheRow.usage.input.value, 200);
    assert.equal(cacheRow.usage.uncachedInput.value, undefined);
    assert.equal(cacheRow.usage.uncachedInput.observedValue, 60);
    assert.equal(cacheRow.usage.uncachedInput.complete, false);

    const invalidCache = makeRecord();
    invalidCache.requests[0].attempts[0].usage!.cacheRead = 101;
    assert.throws(() => analyseRun(invalidCache), /cached input 101 above total input 100/);
    const retained = analysePairs([invalidCache, makeRecord({ arm: "candidate", runId: "candidate-1" })]);
    assert.ok(retained.runs[0].analysisError?.includes("cached input 101 above total input 100"));
    assert.equal(retained.pairs[0].metrics.cumulativeTotalTokens.difference, undefined);
  });

  it("requires independent adequacy review and resolves disagreements only with adjudication", () => {
    const noReview = adequateAssessment();
    delete noReview.review;
    assert.equal(assessAdequacy(noReview).independentReview, false);
    assert.equal(assessAdequacy(noReview).adequate, false);

    const samePerson = adequateAssessment();
    samePerson.review!.reviewer = samePerson.assessor;
    assert.equal(assessAdequacy(samePerson).independentReview, false);

    const disagreement = adequateAssessment();
    disagreement.review!.disagreements = ["Criterion 3 needs another source."];
    assert.equal(assessAdequacy(disagreement).disagreementsResolved, false);
    disagreement.adjudication = "The coordinator and reviewer resolved criterion 3 against S3 and S4.";
    assert.equal(assessAdequacy(disagreement).disagreementsResolved, true);
    assert.equal(assessAdequacy(disagreement).adequate, true);
  });

  it("keeps ordinary provider failures in primary numbers while empty final content stays unknown", () => {
    const records = pair();
    const failed = records[1];
    failed.manifest.status = "failed";
    failed.pipelineOutcome = "failed";
    failed.inputIntegrity.complete = false;
    failed.inputIntegrity.completenessProblems = ["Extraction failed before collation."];
    failed.finalAnswer = "";
    failed.finalMessages = [];
    const row = analyseRun(failed);
    assert.equal(row.attribution.finalAnswerTokens, undefined);
    assert.equal(row.attribution.finalRetainedContextTokens, undefined);

    const result = analysePairs(records);
    assert.equal(result.pairs[0].aggregationValid, true);
    assert.equal(result.views.primary.find(item => item.metric === "cumulativeTotalTokens")?.denominator, 1);
    assert.equal(result.pairs[0].metrics.cumulativeTotalTokens.difference, -40);
    assert.equal(result.pairs[0].metrics.finalAnswerTokens.difference, undefined);
    assert.equal(result.positiveClaim.allowed, false);
  });

  it("retains corrupt and unavailable rows and renders the complete inventory", () => {
    const records = pair();
    records[1].requests[1].attempts[0].id = "attempt-0";
    const broken = { manifest: { ...makeRecord().manifest, runId: "broken-json" } } as RunRecord;
    const unavailable = makeRecord({ runId: "unavailable-record" });
    unavailable.analysisError = "storage.loadInventory: record unavailable";
    const result = analysePairs([...records, broken, unavailable]);
    assert.equal(result.runs.length, 4);
    assert.ok(result.runs.find(run => run.runId === "candidate-1")?.analysisError?.includes("Duplicate or empty provider attempt"));
    assert.ok(result.runs.find(run => run.runId === "broken-json")?.analysisError?.includes("no logical-request array"));
    assert.equal(result.runs.find(run => run.runId === "unavailable-record")?.analysisError, "storage.loadInventory: record unavailable");
    assert.equal(result.runs.find(run => run.runId === "baseline-1")?.analysisError, undefined);
    assert.equal(result.pairs[0].metrics.cumulativeTotalTokens.difference, undefined);

    const markdown = renderAnalysisMarkdown(result);
    assert.ok(markdown.includes("| Run | Pair | Arm | Status | Analysis Error |"));
    assert.ok(markdown.includes("broken-json"));
    assert.ok(markdown.includes("storage.loadInventory: record unavailable"));
    assert.ok(markdown.includes("## Paired Summaries"));
    assert.ok(markdown.includes("uncachedInputTokens"));
  });

  it("derives downstream usage, output, truncation, charges and holds from current journal shapes", () => {
    const record = makeRecord();
    record.adapterEvents = [
      { kind: "model-request", stage: "extract", data: { role: "extract" } },
      { kind: "model-completion", stage: "extract", data: {
        role: "extract", usageEstimate: { input: 60, output: 12, cost: { total: 0.02, totalFromProvider: false } },
        usageKind: "sdk-normalised-estimate", text: "Visible extraction", textSha256: "extract-hash",
      } },
      { kind: "model-request", stage: "collate", data: { role: "collate" } },
      { kind: "model-completion", stage: "collate", data: {
        role: "collate", usageEstimate: { input: 80, output: 20, cost: { total: 0.03, totalFromProvider: false } },
        usageKind: "sdk-normalised-estimate", text: "Visible collation", textSha256: "collate-hash",
      } },
      { kind: "pipeline-attempt", stage: "extract", data: { id: "p1" } },
      { kind: "pipeline-completion", stage: "extract", data: {
        id: "p1",
        rawUsage: {
          prompt_tokens: 60, completion_tokens: 12,
          prompt_tokens_details: { cached_tokens: 6 },
          completion_tokens_details: { reasoning_tokens: 2 }, cost: 0.01,
        },
        sdkUsageEstimate: { input: 60, output: 12, cost: { total: 0.02, totalFromProvider: false } },
        stopReason: "length", content: [{ type: "text", text: "Visible extraction" }],
      } },
      { kind: "pipeline-attempt", stage: "collate", data: { id: "p2" } },
      { kind: "pipeline-completion", stage: "collate", data: {
        id: "p2", rawUsage: { prompt_tokens: 80, completion_tokens: 20 },
        sdkUsageEstimate: { input: 80, output: 20, cost: { total: 0.03, totalFromProvider: false } },
        stopReason: "stop", content: [{ type: "text", text: "Visible collation" }],
      } },
      { kind: "budget-reserved", data: { id: "p1", boundNanoUsd: 100_000_000 } },
      { kind: "budget-settled", data: { id: "p1", boundNanoUsd: 100_000_000, reportedNanoUsd: 40_000_000 } },
      { kind: "budget-reserved", data: { id: "p2", boundNanoUsd: 100_000_000 } },
      { kind: "budget-unknown", data: { id: "p2", heldNanoUsd: 90_000_000 } },
      { kind: "budget-rejected", data: { id: "p3", boundNanoUsd: 100_000_000 } },
    ];
    const row = analyseRun(record);
    assert.equal(row.downstream.providerAttempts, 2);
    assert.equal(row.downstream.usage.input.value, 140);
    assert.equal(row.downstream.usage.output.value, 32);
    assert.equal(row.downstream.usage.total.value, 172);
    assert.equal(row.downstream.byStage.extract.usageSource, "provider-attempts");
    assert.equal(row.downstream.byStage.extract.outputTextBytes, Buffer.byteLength("Visible extraction"));
    assert.equal(row.downstream.byStage.collate.outputTextBytes, Buffer.byteLength("Visible collation"));
    assert.equal(row.downstream.truncatedCompletions, 1);
    assert.equal(row.downstream.reportedChargesNanoUsd, 40_000_000);
    assert.equal(row.downstream.unknownHoldsNanoUsd, 90_000_000);
    assert.equal(row.downstream.activeReservationsNanoUsd, 0);
    assert.equal(row.downstream.budgetRejected, 1);
    assert.equal(row.downstream.sdkEstimatedCostUsd, 0.05, "per-attempt estimates are counted once, not also through logical completion");
    assert.equal(row.financialControl?.budgetLimited, true);

    const logicalOnly = analyseRun(makeRecord());
    assert.equal(logicalOnly.downstream.byStage.extract.usageSource, "logical-completions");
    assert.equal(logicalOnly.downstream.usage.total.value, 160);
    assert.equal(logicalOnly.downstream.byStage.extract.outputTextBytes, Buffer.byteLength("Extracted text"));
    assert.equal(logicalOnly.downstream.byStage.collate.outputTextBytes, Buffer.byteLength("Collation text"));
    assert.equal(logicalOnly.downstream.sdkEstimatedCostUsd, 0.003);
  });

  it("blocks mixed series identities, wrong order, non-frozen gaps and missing affirmative proofs", () => {
    const mixed = completeBatch();
    for (const record of mixed.filter(item => (item.manifest.pair ?? 0) >= 6)) {
      record.manifest.corpusSha256 = "new-corpus";
      record.manifest.codeSha256 = "new-code";
      record.manifest.protocolSha256 = "new-protocol";
    }
    const mixedResult = analysePairs(mixed);
    assert.equal(mixedResult.aggregationValid, false);
    assert.equal(mixedResult.positiveClaim.allowed, false);
    assert.equal(mixedResult.views.primary.find(item => item.metric === "cumulativeTotalTokens")?.denominator, 0);

    const wrongGap = completeBatch();
    wrongGap[1].manifest.startedAt = new Date(Date.parse(wrongGap[0].manifest.endedAt!) + 29_000).toISOString();
    const gapResult = analysePairs(wrongGap);
    assert.equal(gapResult.positiveClaim.allowed, false);
    assert.match(gapResult.scheduleProblems.join(" "), /29000 ms, below the 30000 ms minimum/);

    const wrongOrder = completeBatch();
    wrongOrder[1].manifest.startedAt = new Date(Date.parse(wrongOrder[0].manifest.startedAt!) - 30_000).toISOString();
    wrongOrder[1].manifest.endedAt = new Date(Date.parse(wrongOrder[0].manifest.startedAt!) + 30_000).toISOString();
    const orderResult = analysePairs(wrongOrder);
    assert.equal(orderResult.positiveClaim.allowed, false);
    assert.match(orderResult.scheduleProblems.join(" "), /contrary to the frozen order/);

    const proofFailures: Array<(record: RunRecord) => void> = [
      record => { record.financialControl!.budgetLimited = true; },
      record => { record.financialControl!.overrun = true; },
      record => { record.financialControl!.activeReservations = true; },
      record => { delete record.financialControl; },
      record => { delete record.pipelineOutcome; },
      record => { record.inputIntegrity.complete = false; },
      record => { delete record.adequacy!.review; },
      record => { delete record.requests[0].attempts[0].usage!.cacheRead; },
      record => { record.adapterEvents.push({ kind: "budget-rejected", data: { id: "unmapped", boundNanoUsd: 1 } }); },
    ];
    for (const failProof of proofFailures) {
      const records = completeBatch();
      failProof(records[0]);
      assert.equal(analysePairs(records).positiveClaim.allowed, false);
    }
  });

  it("accepts the minimum gap plus observed process startup overhead", () => {
    const records = completeBatch();
    const ordered = [...records].sort((a, b) => Date.parse(a.manifest.startedAt!) - Date.parse(b.manifest.startedAt!));
    for (const [index, record] of ordered.entries()) {
      record.manifest.startedAt = new Date(Date.parse(record.manifest.startedAt!) + index * 1833).toISOString();
      record.manifest.endedAt = new Date(Date.parse(record.manifest.endedAt!) + index * 1833).toISOString();
    }
    const result = analysePairs(records);
    assert.deepEqual(result.scheduleProblems, []);
    assert.equal(result.positiveClaim.allowed, true);
  });

  it("discloses context regressions outside the frozen primary metric", () => {
    const records = completeBatch();
    for (const record of records.filter(item => item.manifest.arm === "candidate")) {
      const context = record.requests[1].context as { messages: unknown[] };
      context.messages.push({ role: "user", content: "Candidate-only retained context inflation.", timestamp: 99 });
    }
    const result = analysePairs(records);
    assert.equal(result.positiveClaim.allowed, true);
    assert.ok(result.positiveClaim.regressions.includes("peakLogicalRequestTokens"));
  });
});

describe("human analysis summary", () => {
  it("labels metric bases and distinguishes missing observation from failed adequacy", () => {
    const unassessed = makeRecord({ runId: "unassessed-row" });
    delete unassessed.adequacy;
    const incomplete = makeRecord({ runId: "incomplete-row", pair: 2 });
    incomplete.observerCoverage = { verified: false, problems: ["incomplete synthetic observation"] };
    delete incomplete.adequacy;
    const text = renderAnalysisMarkdown(analysePairs([unassessed, incomplete]));
    assert.match(text, /provider-reported tokens/);
    assert.match(text, /js-tiktoken@1\.0\.21\/o200k_base/);
    assert.match(text, /candidate minus baseline/);
    assert.match(text, /UTF-8 bytes/);
    assert.match(text, /USD subtotals/);
    const row = text.split("\n").find(line => line.startsWith("| incomplete-row |"))!;
    assert.ok(row.endsWith("| Not Assessed |"));
    assert.match(row, /\| unknown \| unknown \| unknown \| unknown \| unknown \|/);
    assert.match(text.split("\n").find(line => line.startsWith("| unassessed-row |"))!, /Not Assessed/);
  });
});

describe("deterministic attribution serialisation", () => {
  it("sorts object keys, preserves arrays and verifies local tokenizer round trips", () => {
    assert.equal(serialiseAttribution({ z: 1, a: { d: 4, b: 2 }, skip: undefined }), '{"a":{"b":2,"d":4},"z":1}');
    assert.equal(serialiseAttribution([3, undefined, 1]), '[3,null,1]');
    for (const sample of ["hello world", SCRIPT, "PostgreSQL ✅"]) {
      assert.equal(encoding.decode(encoding.encode(sample, "all", [])), sample);
      assert.equal(estimateTokens(sample), tokens(sample));
    }
  });
});
