// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyseStudy, reproduceAnalysis, type StudyDataset, type StudyAnalysisRun } from "../scripts/benchmarks/study-analysis.js";
import { writeFile } from "node:fs/promises";

const hash = "a".repeat(64);
function dataset(): StudyDataset {
  const runs: StudyAnalysisRun[] = [];
  for (const population of ["replay", "live"] as const) for (const queryId of ["one", "two"]) for (const arm of ["off", "on"]) {
    const tokens = arm === "off" ? 100 : population === "replay" ? 50 : 200;
    runs.push({
      runId: `${population}-${queryId}-${arm}`, queryId, experiment: "codemode", arm, repeat: 1, seed: 42, order: runs.length + 1,
      methodSha256: hash, corpusSha256: hash, fixtureSha256: population === "replay" ? hash : null,
      candidateCommit: "synthetic", lockfileSha256: hash, host: {}, effectiveSettings: {},
      toolCatalogueSha256: hash, promptSha256: hash, status: "completed", replayValidity: population === "replay" ? "valid" : "not-replay",
      observerComplete: true, mainUsage: { inputTotal: tokens + 20, inputUncached: tokens }, pipelineUsage: null,
      reportedPipelineUsd: 0.01, estimatedPipelineUsd: null, subscriptionQuota: {}, artifacts: [],
      population, partition: "measured-series", workflow: "single", mainUsageComplete: true, mainInputTotalComplete: true, returnedMs: arm === "off" ? 1000 : 800,
      qualityJudge1: arm === "off" ? 4 : 3, qualityJudge2: 4,
    });
  }
  return { schemaVersion: 1, design: {
    methodSha256: hash, corpusSha256: hash, candidateCommit: "synthetic", populations: {
      replay: { queryIds: ["one", "two"], repeats: [1] }, live: { queryIds: ["one", "two"], repeats: [1] },
    }, bootstrapSeed: 42, bootstrapDraws: 100, confidence: 0.95, humanCalibrationApproved: true,
  }, runs };
}

test("offline study analysis keeps populations, judges and missing cells separate", () => {
  const data = dataset();
  const analysis = analyseStudy(data);
  assert(Math.abs(analysis.populations.replay.metrics.mainInputUncached.ratio! - 0.5) < 1e-12);
  assert(Math.abs(analysis.populations.live.metrics.mainInputUncached.ratio! - 2) < 1e-12);
  assert.equal(analysis.populations.replay.metrics.mainInputTotal.pairs[0].controlMean, 120);
  assert.equal(analysis.populations.replay.metrics.mainInputTotal.pairs[0].treatmentMean, 70);
  assert.equal(analysis.populations.replay.metrics.mainInputUncached.pairs[0].controlMean, 100);
  assert.equal(analysis.populations.replay.metrics.mainInputUncached.pairs[0].treatmentMean, 50);
  assert.notEqual(analysis.populations.replay.metrics.mainInputTotal.ratio, analysis.populations.replay.metrics.mainInputUncached.ratio);
  assert.equal(analysis.populations.live.metrics.qualityJudge1.difference, -1);
  assert.equal(analysis.populations.live.metrics.qualityJudge2.difference, 0);
  assert.equal(analysis.populations.replay.metrics.returnedMs.interval.lower, null);
  const missing = analyseStudy({ ...data, runs: data.runs.slice(1) });
  assert.equal(missing.populations.replay.metrics.mainInputUncached.primaryAvailable, false);
  assert.equal(missing.populations.replay.metrics.mainInputUncached.interval.lower, null);
  assert.deepEqual(missing.populations.replay.metrics.mainInputUncached.missingQueries, ["one"]);
});
test("failed runs and reruns stay in inventory without replacing the original", () => {
  const data = dataset();
  const original = { ...data.runs[0], status: "failed" as const, error: "synthetic failure" };
  const rerun = { ...data.runs[0], runId: "technical-rerun", rerunOf: original.runId, rerunReason: "diagnostic only" };
  const result = analyseStudy({ ...data, runs: [original, ...data.runs.slice(1), rerun] });
  assert.equal(result.inventory.length, 9);
  assert.equal(result.populations.replay.outcomes.failed, 1);
  assert.equal(result.populations.replay.metrics.mainInputUncached.primaryAvailable, false);
});
test("analysis refuses duplicate identities, mismatched freeze and invalid values", () => {
  const data = dataset();
  assert.throws(() => analyseStudy({ ...data, runs: [...data.runs, data.runs[0]] }), /Duplicate run identity/);
  assert.throws(() => analyseStudy({ ...data, runs: [{ ...data.runs[0], candidateCommit: "other" }] }), /frozen design/);
  assert.throws(() => analyseStudy({ ...data, runs: [{ ...data.runs[0], returnedMs: NaN }] }), /Invalid metric/);
  assert.throws(() => analyseStudy({ ...data, runs: [...data.runs, { ...data.runs[0], runId: "extra-cell" }] }), /Duplicate paired cell/);
});
test("missing wire evidence and unapproved human calibration never become zero or scores", () => {
  const data = dataset();
  const result = analyseStudy({ ...data, design: { ...data.design, humanCalibrationApproved: false }, runs: [{ ...data.runs[0], mainUsageComplete: false }, ...data.runs.slice(1)] });
  assert.equal(result.populations.replay.metrics.mainInputUncached.primaryAvailable, false);
  assert.equal(result.populations.live.metrics.qualityJudge1.difference, null);
  assert.equal(result.inventory[0].mainInputTotal, 120);
  assert.equal(result.populations.replay.metrics.mainInputTotal.primaryAvailable, true);
  const totalMissing = analyseStudy({ ...data, runs: [{ ...data.runs[0], mainInputTotalComplete: false }, ...data.runs.slice(1)] });
  assert.equal(totalMissing.inventory[0].mainInputTotal, null);
  assert.equal(totalMissing.populations.replay.metrics.mainInputTotal.primaryAvailable, false);
});
test("pilot analysis retains captures but excludes them from comparative cells and primary claims", () => {
  const data=dataset();
  const runs=data.runs.map((run)=>({...run,partition:"pilot" as const,purpose:"comparative-task" as const}));
  const capture={...runs[0],runId:"capture-only",purpose:"fixture-capture" as const};
  const result=analyseStudy({...data,design:{...data.design,analysisPartition:"pilot"},runs:[...runs,capture]});
  assert.equal(result.inventory.length,9);
  assert.equal(result.populations.replay.observedOriginalRuns,4);
  assert.equal(result.populations.replay.metrics.mainInputUncached.completePopulation,true);
  assert.equal(result.populations.replay.metrics.mainInputUncached.primaryAvailable,false);
  assert.match(result.analysisClass,/diagnostic only/);
});

test("analysis regenerates byte-identical outputs without a model call", async () => {
  const root = await mkdtemp(join(tmpdir(), "study-analysis-"));
  try {
    const path = join(root, "dataset.json");
    await writeFile(path, JSON.stringify(dataset()));
    await reproduceAnalysis(path, join(root, "a"));
    await reproduceAnalysis(path, join(root, "b"));
    const csv = await readFile(join(root, "a", "effects.csv"), "utf8");
    assert(csv.startsWith("population,endpoint,interval_metric,"));
    assert(csv.includes("replay,mainInputUncached,ratio,"));
    assert(csv.includes("live,qualityJudge1,difference,"));
    for (const file of ["analysis.json", "effects.csv"]) assert.equal(await readFile(join(root, "a", file), "utf8"), await readFile(join(root, "b", file), "utf8"));
  } finally { await rm(root, { recursive: true, force: true }); }
});
