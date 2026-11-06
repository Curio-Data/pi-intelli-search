// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// rh-v5 pilot path: protocol agreement, authority, claims, guards, return and
// recovery classification, assessment gate, settlement and credential-free
// actual-host cases. No test dispatches live work or reads credentials.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  PILOT_PARAGRAPHS, PILOT_PROTOCOL_PATH, PILOT_PROTOCOL_REVISION, PILOT_SERIES_ROOT, PILOT_TOPICS, PILOT_RUBRICS, PILOT_BUDGET,
  OWNER_DECISION_PATH, OWNER_DECISION_SHA256, pilotParams, pilotSettings, pilotTaskPrompt, pilotRunId,
} from "../scripts/research-handoff/pilot-config.js";
import { taskPrompt, pairedSchedule, studySettings } from "../scripts/research-handoff/config.js";
import {
  verifyOwnerDecision, verifyPilotImplementation, claimPilotSlot, markPilotDispatch, assertPilotSchedule, assessPilotAnswerGate, assessRecoveryPurpose,
} from "../scripts/research-handoff/pilot-authority.js";
import { checkPilotReturn, initialCodemodeOptions } from "../scripts/research-handoff/pilot-analysis.js";
import {
  PILOT_DOWNSTREAM_LIMITS, pilotSyntheticDownstream, assertPilotRates, pilotSettle, runPilotSyntheticSeries, runPilotWorker,
  pilotObserve, pilotAdmit, pilotCapture, pilotQualify, pilotRun, pilotGate, validatePilotWorker, syntheticRegistry,
  assertAllSelectedPagesCaptured, pilotReviewInputs, analysePilotInventory, pilotChecksFor,
} from "../scripts/research-handoff/pilot.js";
import { SYNTHETIC_MODEL_ID, SYNTHETIC_PROVIDER_ID, loadPinnedHost } from "../scripts/research-handoff/host.js";
import { pathToFileURL } from "node:url";
import { loadFrozenInputs } from "../scripts/research-handoff/common-inputs.js";
import { createGuardedCallLlm } from "../scripts/research-handoff/pipeline-client.js";
import { AttemptBudget } from "../scripts/research-handoff/budget.js";
import { assertLiveEvidenceRoot, executeWorker, runWorker, REPO_ROOT, type WorkerConfig } from "../scripts/research-handoff/runner.js";
import { analyseRun } from "../scripts/research-handoff/analyse.js";
import { digestFile, digestObject, digestText, sourceIdentity, unavailableRecord, writeNewJson } from "../scripts/research-handoff/storage.js";
import { EXTRACTION_SYSTEM_PROMPT, COLLATION_SYSTEM_PROMPT } from "../src/core/prompts.js";
import type { JournalEvent, RunRecord, ToolCallRecord } from "../scripts/research-handoff/contracts.js";

const protocolText = () => readFile(PILOT_PROTOCOL_PATH, "utf8");

test("pilot constants transcribe the frozen protocol: revision, digest, paragraphs, parameters and complete settings", async () => {
  const text = await protocolText();
  assert.match(text, new RegExp(`Revision: \`${PILOT_PROTOCOL_REVISION}\``));
  assert.ok(text.includes(OWNER_DECISION_SHA256));
  for (const paragraph of Object.values(PILOT_PARAGRAPHS)) assert.ok(text.includes(`\`${paragraph}\``), paragraph);
  assert.deepEqual(Object.keys(pilotParams()), ["query", "focusPrompt", "domains", "maxUrls"]);
  const block = /The complete resolved research settings are frozen[\s\S]*?```json\n([\s\S]*?)\n```/.exec(text);
  assert.ok(block, "settings block present");
  assert.equal(digestObject(JSON.parse(block[1])), digestObject(JSON.parse(JSON.stringify(pilotSettings()))));
  assert.notEqual(digestObject(pilotSettings()), digestObject(studySettings()), "historical settings stay distinct");
  assert.equal(await digestFile(OWNER_DECISION_PATH), OWNER_DECISION_SHA256);
});

test("pilot prompts are exact, arm-specific and distinct from the historical rh-v4 prompts", () => {
  const params = pilotParams();
  const paid = pilotTaskPrompt("baseline", params, "paid");
  assert.equal(paid, [PILOT_PARAGRAPHS.paidOpening, PILOT_PARAGRAPHS.baselineRoute, PILOT_PARAGRAPHS.baselineRecovery,
    "Research parameters:", JSON.stringify(params, null, 2)].join("\n\n"));
  const candidate = pilotTaskPrompt("candidate", params, "observer");
  assert.ok(candidate.startsWith(PILOT_PARAGRAPHS.observerOpening));
  assert.ok(candidate.includes(PILOT_PARAGRAPHS.candidateRoute) && candidate.includes(PILOT_PARAGRAPHS.candidateRecovery));
  assert.ok(!taskPrompt("baseline").includes("evidence-only"), "historical prompt unchanged");
  assert.notEqual(digestText(taskPrompt("candidate", params, "measured")), digestText(pilotTaskPrompt("candidate", params, "paid")));
});

async function authorityFixture() {
  const root = await mkdtemp(join(tmpdir(), "handoff-pilot-authority-"));
  const decision = JSON.parse(await readFile(OWNER_DECISION_PATH, "utf8"));
  const ownerPath = join(root, "owner-decision.json");
  await writeFile(ownerPath, JSON.stringify({ ...decision, designatedSeriesRoot: root }));
  const ownerSha = await digestFile(ownerPath);
  const technical = join(root, "technical.md"), prose = join(root, "prose.md");
  await writeFile(technical, "technical review\n"); await writeFile(prose, "prose review\n");
  const acceptance = {
    schemaVersion: 1, kind: "pilot-implementation-acceptance", acceptedBy: "coordinator", accepted: true,
    scope: "research-handoff-pilot-rh-v5", protocolRevision: PILOT_PROTOCOL_REVISION, seriesRoot: root,
    ownerDecisionPath: ownerPath, ownerDecisionSha256: ownerSha, codeSha256: (await sourceIdentity(REPO_ROOT)).digest,
    protocolSha256: await digestFile(PILOT_PROTOCOL_PATH), technicalReviewPath: technical, technicalReviewSha256: await digestFile(technical),
    proseReviewPath: prose, proseReviewSha256: await digestFile(prose),
  };
  const acceptancePath = join(root, "implementation-acceptance.json");
  writeNewJson(acceptancePath, acceptance);
  const seams = { designatedRoot: root, ownerDecisionSha256: ownerSha, rootCheck: async () => {} };
  return { root, acceptance, acceptancePath, ownerPath, seams };
}

test("pilot owner decision binds scope, profile, counts, allocation and the designated root", async () => {
  await assert.doesNotReject(verifyOwnerDecision(OWNER_DECISION_PATH));
  const { root, ownerPath, seams } = await authorityFixture();
  try {
    await assert.rejects(verifyOwnerDecision(ownerPath), /recorded digest/);
    const decision = JSON.parse(await readFile(ownerPath, "utf8"));
    for (const change of [{ scope: "continue-without-programme-ledger-rh-v4" }, { designatedSeriesRoot: "/elsewhere" },
      { operationLimits: { ...decision.operationLimits, paidEndToEndConversations: 20 } }, { profile: { ...decision.profile, collationMaxTokens: 4000 } }]) {
      const path = join(root, `changed-${Object.keys(change)[0]}.json`);
      await writeFile(path, JSON.stringify({ ...decision, ...change }));
      await assert.rejects(verifyOwnerDecision(path, { ...seams, ownerDecisionSha256: await digestFile(path) }), /does not cover/);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("pilot implementation acceptance rejects historical receipts, other roots and a second generation", async () => {
  const { root, acceptance, acceptancePath, seams } = await authorityFixture();
  try {
    const verified = await verifyPilotImplementation(acceptancePath, seams);
    assert.equal(verified.root, root);
    await assert.doesNotReject(verifyPilotImplementation(acceptancePath, seams), "same binding is idempotent");
    const historical = join(root, "historical.json");
    writeNewJson(historical, { ...acceptance, kind: undefined, phase: "measured", financialMode: "fixed-envelope" });
    await assert.rejects(verifyPilotImplementation(historical, seams), /historical rh-v4 receipts/);
    const other = join(root, "other-root.json");
    writeNewJson(other, { ...acceptance, seriesRoot: join(root, "other") });
    await assert.rejects(verifyPilotImplementation(other, seams), /other than the designated/);
    const second = join(root, "second.json");
    writeNewJson(second, { ...acceptance, technicalReviewSha256: acceptance.technicalReviewSha256, note: "different bytes" });
    await assert.rejects(verifyPilotImplementation(second, seams), /already bound/);
    await assert.rejects(verifyPilotImplementation(acceptancePath), /designated/, "production rejects a non-designated root");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("pilot claims are permanent, unique and limited to the authorised slots and schedule", async () => {
  const root = await mkdtemp(join(tmpdir(), "handoff-pilot-claims-"));
  try {
    await claimPilotSlot(root, "pilot-baseline", { runId: "run-b" });
    await assert.rejects(claimPilotSlot(root, "pilot-baseline", { runId: "run-b" }), /already claimed/);
    await assert.rejects(claimPilotSlot(root, "pilot-replacement" as never, {}), /Unauthorised/);
    await assert.rejects(markPilotDispatch(root, "pilot-baseline", "other"), /No pilot-baseline claim/);
    await markPilotDispatch(root, "pilot-baseline", "run-b");
    await assert.rejects(markPilotDispatch(root, "pilot-baseline", "run-b"), /already dispatched/);
    const pair = [pilotRunId(root, "pilot", "baseline"), pilotRunId(root, "pilot", "candidate")];
    assert.doesNotThrow(() => assertPilotSchedule(pair, pair));
    assert.throws(() => assertPilotSchedule(pairedSchedule().map((_, index) => `measured-${index}`), pair), /only 2/);
    assert.throws(() => assertPilotSchedule([...pair].reverse(), pair), /baseline-then-candidate/);
    await assert.rejects(assertLiveEvidenceRoot(PILOT_SERIES_ROOT), /historical rh-v4 operations are refused/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("pilot workers and historical workers refuse each other's phases and unauthorised live use", async () => {
  const manifest = { ...unavailableRecord("pilot-x", "pilot", "fixture").manifest, status: "scheduled" as const };
  const cfg = { schemaVersion: 1, manifest, directory: "unused", workspace: "unused", agentDir: "unused", frozenPath: "unused" } as WorkerConfig;
  await assert.rejects(runWorker(cfg), /separate pilot worker/);
  await assert.rejects(runPilotWorker(cfg), /Invalid scheduled pilot worker/);
  const historical = { ...cfg, manifest: { ...manifest, phase: "measured" as const }, pilot: { revision: "rh-v5-pilot-1" as const, budgetNanoUsd: 0, financialMode: "no-charges" as const } };
  await assert.rejects(runPilotWorker(historical), /Invalid scheduled pilot worker/);
  const record = unavailableRecord("pilot-row", "pilot", "fixture");
  delete record.analysisError;
  assert.throws(() => analyseRun(record), /invalid arm, phase or status/, "historical analysis never counts pilot rows");
});

test("pilot downstream guard enforces 16,000-token wire caps, 300-second timeouts and M3 reservations", async () => {
  const events: JournalEvent[] = [];
  const journal = { record: (event: JournalEvent) => { events.push(event); } };
  const budget = new AttemptBudget(PILOT_BUDGET.baselinePilotNanoUsd, journal);
  const guarded = createGuardedCallLlm({ runId: "guard", budget, journal, limits: PILOT_DOWNSTREAM_LIMITS });
  const call = pilotSyntheticDownstream("complete", guarded);
  const ctx = { modelRegistry: {} } as unknown as ExtensionContext;
  const model = { provider: "openrouter", model: "minimax/minimax-m3" };
  const policy = { maxTokens: 16_000, timeoutMs: 300_000, retry: { attempts: 3, baseDelayMs: 0, maxDelayMs: 0 } };
  assert.match(await call(ctx, model, COLLATION_SYSTEM_PROMPT, "user", policy), /Synthetic Summary/);
  assert.equal(events.find(event => event.kind === "budget-reserved")?.data.boundNanoUsd, PILOT_BUDGET.m3AttemptNanoUsd);
  assert.equal((events.find(event => event.kind === "pipeline-payload")?.data.payload as { max_tokens: number }).max_tokens, 16_000);
  await assert.rejects(call(ctx, model, EXTRACTION_SYSTEM_PROMPT, "user", { ...policy, maxTokens: 8000 }), /accepted cost bound/);
  await assert.rejects(call(ctx, model, EXTRACTION_SYSTEM_PROMPT, "user", { ...policy, timeoutMs: 120_000 }), /accepted cost bound/);
  await assert.rejects(call(ctx, model, EXTRACTION_SYSTEM_PROMPT, "user", { ...policy, retry: { ...policy.retry, attempts: 4 } }), /accepted cost bound/);
  const lowWire = createGuardedCallLlm({ runId: "low", budget: new AttemptBudget(PILOT_BUDGET.baselinePilotNanoUsd, journal), journal, limits: PILOT_DOWNSTREAM_LIMITS });
  const lowRegistry = {
    find: () => ({ provider: "openrouter", id: "minimax/minimax-m3" }),
    getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "synthetic" }),
    streamSimple: (m: { id: string }, _c: unknown, options: { onPayload?: (p: unknown, m: unknown) => Promise<unknown> }) => ({
      result: async () => { await options.onPayload?.({ model: m.id, max_tokens: 8000 }, m); throw new Error("unreachable"); } }),
  };
  await assert.rejects(lowWire({ modelRegistry: lowRegistry } as unknown as ExtensionContext, model, COLLATION_SYSTEM_PROMPT, "user", policy),
    /wire payload exceeds/, "an on-wire cap below the intended 16,000 tokens is refused");
  const refused = new AttemptBudget(PILOT_BUDGET.m3AttemptNanoUsd - 1, journal);
  await assert.rejects(pilotSyntheticDownstream("complete", createGuardedCallLlm({ runId: "refused", budget: refused, journal, limits: PILOT_DOWNSTREAM_LIMITS }))(ctx, model, COLLATION_SYSTEM_PROMPT, "user", policy), /admission refused/);
});

function call(id: string, name: string, extra: Partial<ToolCallRecord> = {}): ToolCallRecord { return { id, name, input: {}, ...extra }; }
function returnRecord(arm: "baseline" | "candidate", toolCalls: ToolCallRecord[], native = "Research text") {
  return {
    manifest: { ...unavailableRecord("r", "pilot", "fixture").manifest, arm },
    toolCalls, requests: [],
    adapterEvents: [{ kind: "research-admitted", data: {} }, { kind: "research-result", data: { textSha256: digestText(native) } }],
  } as unknown as RunRecord;
}
test("pilot return check: first call must hand off, complete text once, recovery classified by position and purpose", () => {
  const native = "Research text";
  const header = "Script completed\nWall time 1.2 seconds\nOutput:\n";
  const ok = checkPilotReturn(returnRecord("baseline", [call("a", "intelli_research", { resultText: native }),
    call("b", "read", { input: { path: ".search/x/report.md" } })]));
  assert.equal(ok.returnPreserved && ok.initialInvocationConforms && ok.recoveryPermitted, true);
  assert.equal(ok.additionalWork[0].purpose, "evidence-read");
  const prior = checkPilotReturn(returnRecord("baseline", [call("p", "read", { input: { path: ".search/a" } }), call("a", "intelli_research", { resultText: native })]));
  assert.equal(prior.initialInvocationConforms, false);
  const outside = checkPilotReturn(returnRecord("baseline", [call("a", "intelli_research", { resultText: native }), call("b", "read", { input: { path: "/etc/passwd" } })]));
  assert.equal(outside.recoveryPermitted, false);
  const candidate = (visible: string, more: ToolCallRecord[] = []) => checkPilotReturn(returnRecord("candidate", [
    call("c", "codemode", { resultText: visible }), call("c/1", "intelli_research", { parentToolCallId: "c", resultText: native }), ...more]));
  assert.equal(candidate(header + native).returnPreserved, true);
  assert.equal(candidate(`${header}<console_output>\n${native}\n</console_output>`).returnPreserved, true);
  assert.equal(candidate(header + native + "\n" + native).returnPreserved, false, "duplication rejected");
  assert.equal(candidate(header + "projected summary").returnPreserved, false, "projection rejected");
  const truncated = candidate(`${header}Warning: truncated output (original token count: 20000)\nTotal output lines: 3\n\nhead…tail`);
  assert.equal(truncated.codemodeOutputTruncated, true);
  const later = candidate(header + native, [call("d", "codemode", { resultText: header + "x" })]);
  assert.equal(later.additionalWork[0].purpose, "codemode-without-read");
  assert.equal(later.recoveryPermitted, true);
  const second = candidate(header + native, [call("e", "codemode"), call("e/1", "intelli_research", { parentToolCallId: "e" })]);
  assert.equal(second.initialInvocationConforms, false);
  assert.equal(second.recoveryPermitted, false);
  const extraNested = candidate(header + native, [call("c/2", "read", { parentToolCallId: "c" })]);
  assert.equal(extraNested.initialInvocationConforms, false, "extra script-authored work in the initial handoff");
});

async function gateFixture() {
  const root = await mkdtemp(join(tmpdir(), "handoff-pilot-gate-"));
  const record = unavailableRecord("gate-run", "pilot", "fixture");
  record.finalAnswer = "Answer";
  const base = { runIdSha256: digestText("gate-run"), recordSha256: digestObject(record), answerSha256: digestText("Answer"), corpusSha256: "corpus", rubricSha256: "rubric" };
  const grade = (reviewer: string, failing: string[] = [], extra: Record<string, unknown> = {}) => ({ ...base, reviewer, lockedAt: "2026-11-06T12:00:00Z",
    materialUnsupportedClaim: false,
    grades: Object.fromEntries(PILOT_RUBRICS.map(rubric => [rubric, Object.fromEntries(PILOT_TOPICS.map(topic =>
      [topic, { pass: !failing.includes(`${rubric}/${topic}`), reasons: "Cited.", sourceRefs: ["source-1"] }]))])), ...extra });
  const write = async (name: string, value: unknown) => { const path = join(root, name); await writeFile(path, JSON.stringify(value)); return { path, sha256: await digestFile(path) }; };
  const lock = async (reviews: unknown[], adjudication?: unknown) => {
    const refs = [];
    for (const [index, review] of reviews.entries()) refs.push(await write(`review-${index}-${Math.random()}.json`, review));
    const value = { schemaVersion: 1, kind: "pilot-answer-assessment-lock", runId: "gate-run", reviews: refs,
      ...(adjudication ? { adjudication: await write(`adj-${Math.random()}.json`, adjudication) } : {}) };
    return (await write(`lock-${Math.random()}.json`, value)).path;
  };
  const gate = (path: string) => assessPilotAnswerGate(path, record, "corpus", "rubric");
  return { root, grade, lock, gate, base };
}
test("pilot answer gate compares locked overall verdicts and allows only whole-answer adjudication", async () => {
  const { root, grade, lock, gate } = await gateFixture();
  try {
    assert.equal((await gate(await lock([grade("r1"), grade("r2")]))).passed, true);
    assert.equal((await gate(await lock([grade("r1", ["fidelity/agent-integration"]), grade("r2", ["taskUsefulness/prerequisites-and-setup"])]))).passed, false, "two failing overall verdicts fail even on different topics");
    assert.equal((await gate(await lock([grade("r1"), grade("r2", ["taskUsefulness/configuration-and-code"])]))).passed, false, "unresolved disagreement");
    const adjudication = { ...grade("r3"), recordedAt: "2026-11-06T13:00:00Z", resolvesAsPass: true, rationale: "Source 1 supplies the configuration." };
    assert.equal((await gate(await lock([grade("r1"), grade("r2", ["taskUsefulness/configuration-and-code"])], adjudication))).passed, true);
    assert.equal((await gate(await lock([grade("r1"), grade("r2", ["taskUsefulness/configuration-and-code"])], { ...adjudication, reviewer: "r2" }))).passed, false, "adjudicator must be fresh");
    assert.equal((await gate(await lock([grade("r1"), grade("r2", ["taskUsefulness/configuration-and-code"])], { ...grade("r3", ["taskUsefulness/configuration-and-code"]), recordedAt: "2026-11-06T13:00:00Z", resolvesAsPass: true, rationale: "x" }))).passed, false, "partial adjudication fails");
    assert.equal((await gate(await lock([grade("r1"), grade("r1")]))).passed, false, "same reviewer twice");
    assert.equal((await gate(await lock([grade("r1"), { ...grade("r2"), recordSha256: "other" }]))).passed, false, "binds another record");
    assert.equal((await gate(await lock([grade("r1"), grade("r2", ["taskUsefulness/configuration-and-code"])], { ...adjudication, recordedAt: "not-a-date" }))).passed, false, "unparseable adjudication time");
    assert.equal((await gate(await lock([grade("r1"), { ...grade("r2"), runIdSha256: "gate-run" }]))).passed, false, "plain run name is not the opaque binding");
    const missing = grade("r2"); delete (missing.grades.fidelity as Record<string, unknown>)["agent-integration"];
    assert.equal((await gate(await lock([grade("r1"), missing]))).passed, false, "missing cell fails");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("pilot admission rates are bounded and the allocation arithmetic fits", () => {
  const data: { data: Array<{ id: string; context_length: number; pricing: Record<string, string> }> } = { data: [
    { id: "perplexity/sonar", context_length: 127072, pricing: { prompt: "0.000001", completion: "0.000001", web_search: "0.005" } },
    { id: "minimax/minimax-m3", context_length: 1048576, pricing: { prompt: "0.0000003", completion: "0.0000012" } },
  ] };
  assert.doesNotThrow(() => assertPilotRates(data));
  assert.throws(() => assertPilotRates({ data: [data.data[0], { ...data.data[1], pricing: { prompt: "0.0000004", completion: "0.0000012" } }] }), /cost bounds/);
  assert.throws(() => assertPilotRates({ data: [data.data[0]] }), /cost bounds/);
  assert.equal(PILOT_BUDGET.m3AttemptNanoUsd, 1_048_576 * 300 + 16_000 * 1_200);
  assert.ok(3 * PILOT_BUDGET.m3AttemptNanoUsd <= PILOT_BUDGET.qualificationNanoUsd && 6 * PILOT_BUDGET.sonarAttemptNanoUsd <= PILOT_BUDGET.captureNanoUsd);
});

test("pilot settlement walks only claimed identities and holds a missing receipt at its ceiling", async () => {
  const { root, acceptancePath, seams } = await authorityFixture();
  try {
    await claimPilotSlot(root, "capture", {});
    await mkdir(join(root, "capture"));
    writeNewJson(join(root, "capture", "outcome.json"), { accepted: true });
    writeNewJson(join(root, "capture", "budget.json"), { limitNanoUsd: PILOT_BUDGET.captureNanoUsd, knownNanoUsd: 7, unknownNanoUsd: 3, activeNanoUsd: 0 });
    const runId = pilotRunId(root, "pilot", "baseline");
    await claimPilotSlot(root, "pilot-baseline", { runId });
    await mkdir(join(root, "runs", runId), { recursive: true });
    writeNewJson(join(root, "runs", runId, "record.json"), unavailableRecord(runId, "pilot", "killed worker"));
    const receipt = JSON.parse(await readFile(await pilotSettle(acceptancePath, seams), "utf8"));
    assert.equal(receipt.reportedNanoUsd, 7);
    assert.equal(receipt.unknownNanoUsd, 3 + PILOT_BUDGET.baselinePilotNanoUsd);
    assert.equal(receipt.releasedNanoUsd, PILOT_BUDGET.totalNanoUsd - 10 - PILOT_BUDGET.baselinePilotNanoUsd);
    const review = JSON.parse(await readFile(join(root, "settlement-review.json"), "utf8"));
    assert.deepEqual(review.receipts.filter((item: { claimed: boolean }) => !item.claimed).map((item: { slot: string }) => item.slot),
      ["observer-baseline", "observer-candidate", "charge-qualification", "pilot-candidate"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("pilot actual-host synthetic cases: recovery and long returns pass; truncation and the default display limit fail", { timeout: 180_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "handoff-pilot-synthetic-"));
  try {
    const result = await runPilotSyntheticSeries(join(root, "series"), ["recovery", "truncated", "long-complete", "default-limit-truncated"]);
    assert.equal(result.passed, true, JSON.stringify(result.outcomes, null, 2));
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function lockFor(dir: string, record: RunRecord, corpusSha256: string, rubricSha256: string): Promise<string> {
  const reviews = [];
  for (const reviewer of ["answer-reviewer-1", "answer-reviewer-2"]) {
    const path = join(dir, `${record.manifest.runId}-${reviewer}.json`);
    await writeFile(path, JSON.stringify({ reviewer, runIdSha256: digestText(record.manifest.runId), recordSha256: digestObject(record), answerSha256: digestText(record.finalAnswer),
      corpusSha256, rubricSha256, lockedAt: "2026-11-06T12:00:00Z", materialUnsupportedClaim: false,
      grades: Object.fromEntries(PILOT_RUBRICS.map(rubric => [rubric, Object.fromEntries(PILOT_TOPICS.map(topic => [topic, { pass: true, reasons: "Fixture.", sourceRefs: ["page-1"] }]))])) }));
    reviews.push({ path, sha256: await digestFile(path) });
  }
  const lock = join(dir, `${record.manifest.runId}-lock.json`);
  await writeFile(lock, JSON.stringify({ schemaVersion: 1, kind: "pilot-answer-assessment-lock", runId: record.manifest.runId, reviews }));
  return lock;
}

test("pilot live path integrates end to end under isolated fixture authority, without credentials or network", { timeout: 240_000 }, async () => {
  const { root, acceptance, acceptancePath, seams } = await authorityFixture();
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("network forbidden in this test"); };
  const auth = join(root, "credential-reference-never-read");
  const dispatched: WorkerConfig[] = [];
  const synthetic = (scenario: "observer-complete" | "complete") => async (cfg: WorkerConfig) => {
    dispatched.push(structuredClone(cfg));
    const { acceptancePath: _a, authPath: _p, ...rest } = cfg;
    return executeWorker({ ...rest, manifest: { ...cfg.manifest, phase: "pilot-synthetic", mainModel: { provider: SYNTHETIC_PROVIDER_ID, model: SYNTHETIC_MODEL_ID } },
      pilot: { ...cfg.pilot!, scenario } });
  };
  const common = { ...seams, credentialCheck: async () => {}, wait: async () => {} };
  const bound = async (kind: string, extra: Record<string, unknown> = {}) => ({ kind, accepted: true, seriesRoot: root,
    implementationAcceptanceSha256: await digestFile(acceptancePath), ownerDecisionSha256: acceptance.ownerDecisionSha256, ...extra });
  try {
    const observed = await pilotObserve(acceptancePath, auth, { ...common, execute: synthetic("observer-complete") });
    assert.equal(observed.stopped, false, await readFile(observed.outcomePath, "utf8"));
    await assert.rejects(pilotObserve(acceptancePath, auth, common), /EEXIST|already claimed/);
    await assert.rejects(pilotRun(acceptancePath, auth, "baseline", "none", common), /pilot-financial-admission/);
    const diagnostic = join(root, "diagnostic-acceptance.json");
    writeNewJson(diagnostic, await bound("pilot-diagnostic-acceptance", { recoveryPurposeReviewed: true }));
    const catalogue = { data: [
      { id: "perplexity/sonar", context_length: 127072, pricing: { prompt: "0.000001", completion: "0.000001", web_search: "0.005" } },
      { id: "minimax/minimax-m3", context_length: 1048576, pricing: { prompt: "0.0000003", completion: "0.0000012" } }] };
    await pilotAdmit(acceptancePath, diagnostic, { ...common, fetchCatalogue: async () => catalogue });
    await assert.rejects(pilotAdmit(acceptancePath, diagnostic, { ...common, fetchCatalogue: async () => catalogue }), /already claimed/);
    const registry = syntheticRegistry("complete");
    const pages = async (urls: string[]) => urls.map((url, index) => ({ url, title: `Page ${index + 1}`, status: "success" as const, source: "markdown",
      content: `# Page ${index + 1}\n\nRAW_HANDOFF_SENTINEL_${index + 1}\nSynthetic captured page.` }));
    const frozenPath = await pilotCapture(acceptancePath, auth, { ...common, modelRegistry: registry, fetchPages: pages as never });
    await assert.rejects(pilotCapture(acceptancePath, auth, { ...common, modelRegistry: registry, fetchPages: pages as never }), /already claimed/);
    const frozen = await loadFrozenInputs({ path: frozenPath });
    assert.equal(digestObject(frozen.settings), digestObject(pilotSettings()));
    const review = join(root, "corpus-review.md");
    await writeFile(review, "fixture corpus review\n");
    const corpus = join(root, "corpus-acceptance.json");
    writeNewJson(corpus, await bound("pilot-corpus-acceptance", { corpusSha256: frozen.digest, reviewer: "corpus-reviewer", reviewPath: review,
      reviewSha256: await digestFile(review), readableSelectedPages: 2 }));
    await pilotQualify(acceptancePath, auth, corpus, { ...common, modelRegistry: registry });
    await assert.rejects(pilotRun(acceptancePath, auth, "candidate", corpus, common), /pilot-baseline-gate/);
    const baseline = await pilotRun(acceptancePath, auth, "baseline", corpus, { ...common, execute: synthetic("complete") });
    assert.equal(baseline.passed, true);
    await assert.rejects(pilotRun(acceptancePath, auth, "baseline", corpus, { ...common, execute: synthetic("complete") }), /already claimed/);
    const baseCfg = dispatched.at(-1)!;
    await validatePilotWorker(baseCfg, seams);
    await assert.rejects(validatePilotWorker(baseCfg, seams), /already dispatched/);
    const baseRecord = JSON.parse(await readFile(join(root, "runs", baseline.runId, "record.json"), "utf8")) as RunRecord;
    const gateB = await pilotGate(acceptancePath, "baseline", await lockFor(root, baseRecord, frozen.digest, acceptance.protocolSha256), common);
    assert.equal(gateB.passed, true, await readFile(gateB.path, "utf8"));
    const ended = Date.parse(baseRecord.manifest.endedAt!);
    await assert.rejects(pilotRun(acceptancePath, auth, "candidate", corpus, { ...common, now: () => ended + 1_000 }), /30 seconds/);
    const candidate = await pilotRun(acceptancePath, auth, "candidate", corpus, { ...common, execute: synthetic("complete"), now: () => ended + 31_000 });
    assert.equal(candidate.passed, true);
    const candRecord = JSON.parse(await readFile(join(root, "runs", candidate.runId, "record.json"), "utf8")) as RunRecord;
    assert.equal((await pilotGate(acceptancePath, "candidate", await lockFor(root, candRecord, frozen.digest, acceptance.protocolSha256), common)).passed, true);
    const settlement = JSON.parse(await readFile(await pilotSettle(acceptancePath, common), "utf8"));
    assert.equal(settlement.unknownNanoUsd, 0);
    assert.ok(settlement.reportedNanoUsd > 0 && settlement.reportedNanoUsd < PILOT_BUDGET.totalNanoUsd);
    const reviewed = JSON.parse(await readFile(join(root, "settlement-review.json"), "utf8")) as { receipts: Array<{ slot: string; claimed: boolean }> };
    assert.ok(reviewed.receipts.every(item => item.claimed), "every authorised slot was claimed exactly once");
    assert.deepEqual(dispatched.map(cfg => cfg.manifest.phase), ["pilot-diagnostic", "pilot-diagnostic", "pilot", "pilot"]);
    assert.equal(settlement.closed, true);
    assert.equal(settlement.activeNanoUsd, 0);
    for (const later of [() => pilotObserve(acceptancePath, auth, common), () => pilotAdmit(acceptancePath, diagnostic, common),
      () => pilotCapture(acceptancePath, auth, common), () => pilotQualify(acceptancePath, auth, corpus, common),
      () => pilotRun(acceptancePath, auth, "candidate", corpus, common), () => pilotGate(acceptancePath, "baseline", "x", common),
      () => pilotSettle(acceptancePath, common), () => validatePilotWorker(baseCfg, seams)]) {
      await assert.rejects(later(), /settled and closed/);
    }
    const reviewDir = await pilotReviewInputs(join(root, "runs", candidate.runId, "record.json"), frozenPath, join(root, "review-a"), "answer-A");
    const graderFiles = (await import("node:fs/promises")).readdir(join(reviewDir, "graders"));
    const graderText = (await Promise.all((await graderFiles).map(name => readFile(join(reviewDir, "graders", name), "utf8")))).join("\n");
    assert.ok(!graderText.includes(candidate.runId) && !/candidate|baseline|codemode/i.test(graderText), "grader inputs carry no route-bearing identity or trace");
    const template = JSON.parse(await readFile(join(reviewDir, "graders", "answer-A-grade-template.json"), "utf8"));
    assert.equal(template.runIdSha256, digestText(candidate.runId));
    assert.equal(template.recordSha256, digestObject(candRecord));
    assert.deepEqual(Object.keys(template.grades.fidelity), [...PILOT_TOPICS]);
    assert.ok(Object.values(template.grades.taskUsefulness).every(cell => (cell as { pass: unknown }).pass === null), "skeleton carries no judgement");
    assert.equal(JSON.parse(await readFile(join(reviewDir, "coordinator-mapping.json"), "utf8")).runId, candidate.runId);
    await assert.rejects(pilotReviewInputs(join(root, "runs", candidate.runId, "record.json"), frozenPath, join(root, "review-b"), "candidate-answer"), /neutral/);
  } finally { globalThis.fetch = savedFetch; await rm(root, { recursive: true, force: true }); }
});

test("pilot candidate initial-script options mirror the pinned Codemode parser", async () => {
  const host = await loadPinnedHost();
  const parserPath = join(host.identity.dependencies["@earendil-works/pi-codemode"].path, "dist/source.js");
  const pinned = await import(pathToFileURL(parserPath).href) as {
    parseCodemodeSource(input: string): { options: { maxOutputTokens?: number; timeoutMs?: number } } };
  const good = '// @options: {"max_output_tokens": 100000}\nreturn await tools.intelli_research({});';
  assert.equal(pinned.parseCodemodeSource(good).options.maxOutputTokens, 100_000);
  assert.deepEqual(initialCodemodeOptions(good).problems, []);
  for (const bad of ['return await tools.intelli_research({});', '// @options: {"max_output_tokens": 10000}\nreturn 1;',
    '// @options: {"max_output_tokens": 100000, "timeout_ms": 600000}\nreturn 1;', 'const a = 1;\n// @options: {"max_output_tokens": 100000}\nreturn a;']) {
    assert.ok(initialCodemodeOptions(bad).problems.length > 0, bad);
  }
  assert.ok(PILOT_PARAGRAPHS.candidateRoute.endsWith("Set the initial script's max_output_tokens option to 100000 and leave timeout_ms unset."));
});

test("pilot remediation: partial captures, interrupted stages, no-read Codemode purpose and mixed inventories fail closed", async () => {
  const page = (status: "success" | "failed") => ({ page: { url: `https://x.invalid/${status}`, title: "t", status, content: "c", source: "markdown" }, contentSha256: "x" });
  assert.doesNotThrow(() => assertAllSelectedPagesCaptured({ pages: [page("success"), page("success")] } as never));
  assert.throws(() => assertAllSelectedPagesCaptured({ pages: [page("success"), page("success"), page("failed")] } as never), /every selected page/);

  const { root, acceptance, acceptancePath, seams } = await authorityFixture();
  try {
    const runId = pilotRunId(root, "pilot", "baseline");
    await claimPilotSlot(root, "pilot-baseline", { runId });
    await mkdir(join(root, "claims", "pilot-baseline", "dispatched"));
    await mkdir(join(root, "runs", runId), { recursive: true });
    await assert.rejects(pilotSettle(acceptancePath, seams), /potentially active work/);
    const evidence = join(root, "ps-inspection.txt");
    await writeFile(evidence, "no worker process for this run\n");
    const receipt = join(root, "interruption.json");
    const base = { kind: "pilot-interruption-receipt", accepted: true, seriesRoot: root, implementationAcceptanceSha256: await digestFile(acceptancePath),
      ownerDecisionSha256: acceptance.ownerDecisionSha256, slot: "pilot-baseline", noActiveProcess: true, inspectedAt: "2026-11-06T15:00:00Z",
      rationale: "Worker host rebooted; inspection shows no process.", inspectionEvidencePath: evidence, inspectionEvidenceSha256: await digestFile(evidence) };
    const weak = join(root, "interruption-weak.json");
    writeNewJson(weak, { ...base, rationale: "" });
    await assert.rejects(pilotSettle(acceptancePath, seams, [weak]), /lacks a unique slot, rationale/);
    writeNewJson(receipt, base);
    writeNewJson(join(root, "runs", runId, "budget.json"), { limitNanoUsd: PILOT_BUDGET.baselinePilotNanoUsd, knownNanoUsd: 5, unknownNanoUsd: 0, activeNanoUsd: 0 });
    const settled = JSON.parse(await readFile(await pilotSettle(acceptancePath, seams, [receipt]), "utf8"));
    assert.equal(settled.unknownNanoUsd, PILOT_BUDGET.baselinePilotNanoUsd, "interrupted stage held at its full ceiling, not released from a partial budget");
    assert.equal(settled.reportedNanoUsd, 0);
    assert.equal(settled.releasedNanoUsd, PILOT_BUDGET.totalNanoUsd - PILOT_BUDGET.baselinePilotNanoUsd);
  } finally { await rm(root, { recursive: true, force: true }); }

  const record = unavailableRecord("purpose", "pilot", "fixture");
  const dir = await mkdtemp(join(tmpdir(), "handoff-pilot-purpose-"));
  try {
    const lockBase = { schemaVersion: 1 as const, kind: "pilot-answer-assessment-lock" as const, runId: "purpose", reviews: [] };
    assert.equal((await assessRecoveryPurpose(lockBase, record, [])).passed, true);
    assert.equal((await assessRecoveryPurpose(lockBase, record, ["d"])).passed, false);
    const path = join(dir, "purpose.json");
    await writeFile(path, JSON.stringify({ kind: "pilot-recovery-purpose-review", reviewer: "purpose-reviewer", recordSha256: digestObject(record),
      calls: [{ id: "d", evidenceOnly: true, rationale: "Script only re-read the saved report text.", sourceRefs: ["call d input"] }] }));
    assert.equal((await assessRecoveryPurpose({ ...lockBase, recoveryPurposeReview: { path, sha256: await digestFile(path) } }, record, ["d"])).passed, true);
    assert.equal((await assessRecoveryPurpose({ ...lockBase, recoveryPurposeReview: { path, sha256: await digestFile(path) } }, record, ["d", "e"])).passed, false);

  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("pilot offline inventory rejects duplicates, escapes and mixed inputs; a corrupt record stays an explicit failure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "handoff-pilot-inventory-"));
  try {
    const series = join(dir, "series");
    await runPilotSyntheticSeries(series, ["complete"]);
    const frozenPath = join(series, "frozen-inputs.json");
    const rows = ["runs/series-complete-baseline/record.json", "runs/series-complete-candidate/record.json"];
    const inventory = async (name: string, value: unknown) => { const path = join(series, name); await writeFile(path, JSON.stringify(value)); return path; };
    await analysePilotInventory(await inventory("ok.json", rows), frozenPath, join(dir, "out-ok"), "known-charges");
    const ok = JSON.parse(await readFile(join(dir, "out-ok", "pilot-analysis.json"), "utf8"));
    assert.deepEqual(ok.runs.map((run: { passed: boolean }) => run.passed), [true, true]);
    await assert.rejects(analysePilotInventory(await inventory("dup.json", [rows[0], rows[0]]), frozenPath, join(dir, "o1"), "known-charges"), /repeats/);
    await assert.rejects(analysePilotInventory(await inventory("esc.json", ["../x/record.json"]), frozenPath, join(dir, "o2"), "known-charges"), /escapes/);
    const otherFrozen = join(dir, "other-frozen.json");
    const frozen = JSON.parse(await readFile(frozenPath, "utf8"));
    const { syntheticInputs } = await import("../scripts/research-handoff/fixtures.js");
    writeNewJson(otherFrozen, await syntheticInputs("other-protocol", pilotSettings()));
    assert.notEqual(frozen.digest, JSON.parse(await readFile(otherFrozen, "utf8")).digest);
    await assert.rejects(analysePilotInventory(await inventory("mixed.json", rows), otherFrozen, join(dir, "o3"), "known-charges"), /mixes corpora/);
    const corruptDir = join(series, "runs", "corrupt");
    await mkdir(corruptDir);
    await writeFile(join(corruptDir, "record.json"), "{ not json");
    const corrupt = await pilotChecksFor(corruptDir, frozen, "known-charges");
    assert.equal(corrupt.passed, false);
    assert.match(corrupt.analysisError ?? "", /JSON/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
