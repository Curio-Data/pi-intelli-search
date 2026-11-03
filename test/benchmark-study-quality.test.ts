// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applyQualityScores, humanCalibrationApproved, prepareCalibrationPackets, prepareQualityPackets, qualityEvidence, visibleAnswer } from "../scripts/benchmarks/study-quality.js";
import type { StudyAnalysisRun } from "../scripts/benchmarks/study-analysis.js";
import { sha256Text } from "../scripts/benchmarks/canonical.js";

const hash = "a".repeat(64);
const corpusHash = sha256Text(await readFile(join(process.cwd(), "docs/benchmarks/codemode-study-v1/corpus.json"), "utf8"));
const task = { id: "PILOT-01", partition: "pilot", workflow: "single", query: "What is documented?", focusPrompt: "Preserve the limit.", workflowQueries: ["What is documented?"] } as const;
const provenanceFor = (judgeId: string) => ({
  reportedModels: [judgeId === "claude-opus-5-5[1m]" ? "claude-opus-5-5" : judgeId],
  contextWindows: judgeId === "claude-opus-5-5[1m]" ? { "claude-opus-5-5": 1_000_000 } : {},
  sourceCommit: "synthetic", packetSha256: "packet", harnessVersion: "test", attemptNumber: 1,
});

function run(arm: "off" | "on"): StudyAnalysisRun {
  return {
    runId: `pilot-${arm}`, queryId: task.id, experiment: "codemode", arm, repeat: 1, seed: 42, order: arm === "off" ? 1 : 2,
    methodSha256: hash, corpusSha256: hash, fixtureSha256: null, candidateCommit: "synthetic", lockfileSha256: hash,
    host: {}, effectiveSettings: {}, toolCatalogueSha256: hash, promptSha256: hash, status: "completed", replayValidity: "not-replay",
    observerComplete: true, mainUsage: { inputTotal: 100, inputUncached: 100 }, mainUsageComplete: true, mainInputTotalComplete: true,
    pipelineUsage: null, reportedPipelineUsd: 0, estimatedPipelineUsd: null, subscriptionQuota: {}, artifacts: [], returnedMs: 1000,
    qualityJudge1: null, qualityJudge2: null, population: "live", partition: "pilot", workflow: "single", purpose: "comparative-task",
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "study-quality-"));
  const runs = [run("off"), run("on")];
  await writeFile(join(root, "series.json"), JSON.stringify({ design: { tasks: [task], corpusSha256: corpusHash } }));
  await writeFile(join(root, "observations.ndjson"), `${runs.map((item) => JSON.stringify(item)).join("\n")}\n`);
  for (const item of runs) {
    await mkdir(join(root, item.runId), { recursive: true });
    await writeFile(join(root, item.runId, "answers.json"), JSON.stringify([
      { role: "assistant", stopReason: "stop", content: [{ type: "text", text: `The documented limit is ${item.arm === "off" ? "seven" : "nine"}.` }] },
    ]));
    await writeFile(join(root, item.runId, "tool-events.json"), JSON.stringify([
      { type: "tool_execution_end", toolName: "intelli_fetch", result: { details: { intelli: { sources: [{ url: "https://docs.example.test", title: "Limit", content: "The documented limit is seven." }] } } } },
    ]));
  }
  return { root, runs };
}

test("quality packets preserve evidence and blind arm and run identities", async () => {
  const { root, runs } = await fixture();
  try {
    const prepared = await prepareQualityPackets(root, "pilot", { allowDirtyReason: "deterministic synthetic fixture" });
    assert.equal(prepared.packetCount, 1);
    const assignment = JSON.parse(await readFile(join(root, "quality-v1", "assignments.json"), "utf8")).assignments[0];
    const packet = JSON.parse(await readFile(join(root, "quality-v1", "packets", `${assignment.packetId}.json`), "utf8"));
    assert.equal(packet.candidates.length, 2);
    assert.equal(packet.candidates[0].evidence[0].content, "The documented limit is seven.");
    assert(!JSON.stringify(packet).includes("pilot-off"));
    assert(!("arm" in packet.candidates[0]));
    assert.deepEqual([assignment.candidates.A.arm, assignment.candidates.B.arm].sort(), ["off", "on"]);
    const answers = packet.candidates.map((candidate: { answers: { text: string }[] }) => candidate.answers[0].text).sort();
    assert.deepEqual(answers, ["The documented limit is nine.", "The documented limit is seven."]);
    assert.equal(runs.length, 2);
    await assert.rejects(prepareQualityPackets(root, "pilot", { allowDirtyReason: "deterministic synthetic fixture" }), /already exists/);
    const packets = JSON.parse(await readFile(join(root, "quality-v1", "manifest.json"), "utf8")).packets;
    assert.equal(packets.length, 1, "a repeated prepare adds no orphan packets");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("complete judge files map scores back to runs and partial files refuse", async () => {
  const { root, runs } = await fixture();
  try {
    await prepareQualityPackets(root, "pilot", { allowDirtyReason: "deterministic synthetic fixture" });
    const assignment = JSON.parse(await readFile(join(root, "quality-v1", "assignments.json"), "utf8")).assignments[0];
    const score = (overall: number) => ({ overall, coverage: 4, provenance: 4, limitations: 4, usefulness: 4, rationale: "The documented limit is seven.", evidenceQuotes: ["The documented limit is seven."] });
    for (const judge of [1, 2]) {
      const judgeId = judge === 1 ? "claude-opus-5-5[1m]" : "openai-codex/gpt-6.1-sol";
      await mkdir(join(root, "quality-v1", `judge-${judge}`), { recursive: true });
      await writeFile(join(root, "quality-v1", `judge-${judge}`, `${assignment.packetId}.json`), JSON.stringify({
        judgeId, model: judgeId, session: `fresh-judge-${judge}`, packetId: assignment.packetId,
        provenance: provenanceFor(judgeId), A: score(judge === 1 ? 4 : 3), B: score(2),
      }));
    }
    const applied = await applyQualityScores(root, runs);
    assert.deepEqual(applied.judgeCounts, [2, 2]);
    const aRun = applied.runs.find((item) => item.runId === assignment.candidates.A.runId)!;
    const bRun = applied.runs.find((item) => item.runId === assignment.candidates.B.runId)!;
    assert.equal(aRun.qualityJudge1, 4);
    assert.equal(aRun.qualityJudge2, 3);
    assert.equal(bRun.qualityJudge1, 2);
    assert.equal(bRun.qualityJudge2, 2);
    assert.equal(runs[0].qualityJudge1, null, "input observations are not mutated");
    await writeFile(join(root, "quality-v1", "judge-2", `${assignment.packetId}.json`), JSON.stringify({
      judgeId: "openai-codex/gpt-6.1-sol", model: "openai-codex/gpt-6.1-sol", session: "fresh-judge-2", packetId: assignment.packetId,
      provenance: provenanceFor("openai-codex/gpt-6.1-sol"), A: { ...score(4), coverage: 0 }, B: score(2),
    }));
    await assert.rejects(applyQualityScores(root, runs), /critical-criterion/);
    await rm(join(root, "quality-v1", "judge-2", `${assignment.packetId}.json`));
    await assert.rejects(applyQualityScores(root, runs), /every packet/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("follow-up prompts and answer turns stay aligned", async () => {
  const { root } = await fixture();
  try {
    const followup = { ...task, workflow: "followup", domains: ["docs.example.test"], followupPlan: { base: "Explain the base behaviour.", followup: "What changes in version two?" } };
    await writeFile(join(root, "series.json"), JSON.stringify({ design: { tasks: [followup], corpusSha256: corpusHash } }));
    await prepareQualityPackets(root, "pilot", { allowDirtyReason: "deterministic synthetic fixture" });
    const assignment = JSON.parse(await readFile(join(root, "quality-v1", "assignments.json"), "utf8")).assignments[0];
    const packet = JSON.parse(await readFile(join(root, "quality-v1", "packets", `${assignment.packetId}.json`), "utf8"));
    assert.deepEqual(packet.task.turns.map((turn: { question: string }) => turn.question), ["Explain the base behaviour.", "What changes in version two?"]);
    assert.equal(packet.judgePrompt.revision, "judge-prompt-v2");
    assert.equal(packet.rubric.id, "STANDARD-RUBRIC");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("answer order is balanced by workflow and reversed between repeats", async () => {
  const root = await mkdtemp(join(tmpdir(), "study-quality-balance-"));
  try {
    const tasks = ["PILOT-01", "PILOT-02"].map((id) => ({ ...task, id }));
    const runs: StudyAnalysisRun[] = [];
    for (const queryId of tasks.map((item) => item.id)) for (const repeat of [1, 2]) for (const arm of ["off", "on"] as const) {
      const item = { ...run(arm), runId: `${queryId}-${repeat}-${arm}`, queryId, repeat };
      runs.push(item);
      await mkdir(join(root, item.runId), { recursive: true });
      await writeFile(join(root, item.runId, "answers.json"), JSON.stringify([{ role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Answer" }] }]));
      await writeFile(join(root, item.runId, "tool-events.json"), "[]");
    }
    await writeFile(join(root, "series.json"), JSON.stringify({ design: { tasks, corpusSha256: corpusHash } }));
    await writeFile(join(root, "observations.ndjson"), `${runs.map((item) => JSON.stringify(item)).join("\n")}\n`);
    await prepareQualityPackets(root, "pilot", { allowDirtyReason: "deterministic synthetic fixture" });
    const assignments = JSON.parse(await readFile(join(root, "quality-v1", "assignments.json"), "utf8")).assignments;
    assert.equal(assignments.filter((item: { candidates: { A: { arm: string } } }) => item.candidates.A.arm === "off").length, 2);
    for (const queryId of tasks.map((item) => item.id)) {
      const pair = assignments.filter((item: { queryId: string }) => item.queryId === queryId);
      assert.notEqual(pair[0].candidates.A.arm, pair[1].candidates.A.arm);
    }
    const judgeId = "claude-opus-5-5[1m]";
    await mkdir(join(root, "quality-v1", "judge-1"), { recursive: true });
    const score = { overall: 4, coverage: 4, provenance: 4, limitations: 4, usefulness: 4, rationale: "Answer", evidenceQuotes: ["Answer"] };
    for (const assignment of assignments) await writeFile(join(root, "quality-v1", "judge-1", `${assignment.packetId}.json`), JSON.stringify({ judgeId, model: judgeId, session: "reused-session", packetId: assignment.packetId, provenance: provenanceFor(judgeId), A: score, B: score }));
    await assert.rejects(applyQualityScores(root, runs), /reused a session/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("quotation checks use decoded text and retain unmatched flags", async () => {
  const { root, runs } = await fixture();
  try {
    for (const item of runs) await writeFile(join(root, item.runId, "tool-events.json"), JSON.stringify([{ type: "tool_execution_end", toolName: "intelli_fetch", result: { details: { intelli: { sources: [{ content: "const x = \"value\";\nSecond line" }] } } } }]));
    await prepareQualityPackets(root, "pilot", { allowDirtyReason: "deterministic synthetic fixture" });
    const assignment = JSON.parse(await readFile(join(root, "quality-v1", "assignments.json"), "utf8")).assignments[0];
    const judgeId = "claude-opus-5-5[1m]";
    await mkdir(join(root, "quality-v1", "judge-1"), { recursive: true });
    const score = { overall: 4, coverage: 4, provenance: 4, limitations: 4, usefulness: 4, rationale: "Evidence", evidenceQuotes: [] };
    const quoted = { ...score, evidenceQuotes: ["const x = \"value\";\nSecond line", "kind: page", "not present"] };
    await writeFile(join(root, "quality-v1", "judge-1", `${assignment.packetId}.json`), JSON.stringify({ judgeId, model: judgeId, session: "quote-session", packetId: assignment.packetId, provenance: provenanceFor(judgeId), A: quoted, B: quoted }));
    const result = await applyQualityScores(root, runs);
    const record = result.records.find((item) => item.label === "A")!;
    assert.deepEqual(record.score.evidenceQuotes, ["const x = \"value\";\nSecond line"]);
    assert.deepEqual(record.score.unmatchedEvidenceQuotes, ["kind: page", "not present"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("judge-human sanity checks retain relabelled preferences and disagreements", async () => {
  const { root, runs } = await fixture();
  try {
    await prepareQualityPackets(root, "pilot", { allowDirtyReason: "deterministic synthetic fixture" });
    const prepared = await prepareCalibrationPackets(root);
    assert.equal(prepared.packetCount, 4);
    const assignments = JSON.parse(await readFile(join(root, "quality-v1", "calibration", "assignments.json"), "utf8")).assignments;
    for (const judge of [1, 2]) {
      const judgeId = judge === 1 ? "claude-opus-5-5[1m]" : "openai-codex/gpt-6.1-sol";
      await mkdir(join(root, "quality-v1", "calibration", `judge-${judge}`), { recursive: true });
      for (const assignment of assignments) {
        const packet = await readFile(join(root, "quality-v1", "calibration", "packets", `${assignment.caseId}.json`), "utf8");
        const answer = JSON.parse(packet).candidates[0].answer;
        await writeFile(join(root, "quality-v1", "calibration", `judge-${judge}`, `${assignment.caseId}.json`), JSON.stringify({
          caseId: assignment.caseId, judgeId, model: judgeId, session: `calibration-${judge}-${assignment.caseId}`,
          provenance: provenanceFor(judgeId), preference: "A", rationale: "Synthetic sanity-check rationale.", evidenceQuotes: [answer.slice(0, 24)],
        }));
      }
    }
    const result = await applyQualityScores(root, runs);
    assert.equal(result.calibration.length, 4);
    assert(result.calibration.every((row) => row.judges.length === 2 && !row.judgesDisagree));
    assert(result.calibration.every((row) => row.judges.every((judge) => judge.agreesWithHuman === (judge.originalPreference === "A"))));
    assert(result.calibration.some((row) => row.judges[0].originalPreference === "B"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("visible answers, evidence paths and human-label hashes fail closed", async () => {
  assert.equal(visibleAnswer([{ role: "assistant", stopReason: "toolUse", content: [{ type: "text", text: "Narration" }] }, { role: "assistant", stopReason: "stop", content: [{ type: "text", text: " first " }, { type: "text", text: "second" }] }]), "first\n\nsecond");
  const root = await mkdtemp(join(tmpdir(), "study-quality-evidence-"));
  try {
    await mkdir(join(root, ".search"), { recursive: true });
    await writeFile(join(root, ".search", "page.md"), "Captured page");
    const evidence = await qualityEvidence([{ type: "tool_execution_end", result: { details: { intelli: { sources: [{ url: "https://example.test", fullPagePath: ".search/page.md" }] } } } }], root);
    assert.equal(evidence[0].content, "Captured page");
    await assert.rejects(qualityEvidence([{ type: "tool_execution_end", result: { details: { intelli: { sources: [{ fullPagePath: "../escape" }] } } } }], root), /Unsafe/);
    const failed = await qualityEvidence([{ type: "tool_execution_end", toolName: "codemode", result: { isError: true, content: [{ type: "text", text: "script containing intelli_extract" }], details: {} } }], root);
    assert(!JSON.stringify(failed).includes("codemode"));
    assert(!JSON.stringify(failed).includes("intelli_extract"));
    assert.equal(failed[0].title, "Failed operation");
    const decisions = join(root, "decisions.json");
    await writeFile(decisions, JSON.stringify({ reviewedInputs: { corpusJsonSha256: "corpus", calibrationJsonSha256: "calibration" }, decisions: ["CAL-01", "CAL-02", "CAL-03", "CAL-04"].map((id) => ({ id, verdict: "A" })) }));
    assert.equal(await humanCalibrationApproved(decisions, "corpus", "calibration"), true);
    assert.equal(await humanCalibrationApproved(decisions, "changed", "calibration"), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
