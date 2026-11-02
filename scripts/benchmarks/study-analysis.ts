// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Offline analysis only. Never imports a provider or invokes a model.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { RunObservation, QuerySample } from "./contracts.js";
import { validateRunObservation } from "./run-observation.js";
import { bootstrapPairedQueries, estimatePairedQueries, primaryAvailable } from "./statistics.js";
import { sha256Text } from "./canonical.js";

export type Population = "replay" | "live";
export interface StudyAnalysisRun extends RunObservation {
  readonly population: Population;
  readonly rerunSeries?: string;
  readonly purpose?: "comparative-task" | "fixture-capture" | "synthetic-driver-integration";
  readonly partition: "calibration" | "development" | "pilot" | "measured-series";
  readonly workflow: "single" | "breadth" | "manual" | "followup";
  /** Requires correlated version-2 witnesses and all uncached-input components. */
  readonly mainUsageComplete: boolean;
  /** Independent: correlated total input may exist while cache subsets are absent. */
  readonly mainInputTotalComplete: boolean;
  readonly returnedMs: number | null;
  readonly qualityJudge1: number | null;
  readonly qualityJudge2: number | null;
}
export interface StudyDataset {
  readonly schemaVersion: 1;
  readonly design: {
    readonly methodSha256: string;
    readonly corpusSha256: string;
    readonly candidateCommit: string;
    readonly analysisPartition?: "development" | "pilot" | "measured-series";
    readonly populations: Readonly<Record<Population, { queryIds: readonly string[]; repeats: readonly number[] }>>;
    readonly bootstrapSeed: number;
    readonly bootstrapDraws: number;
    readonly confidence: number;
    readonly humanCalibrationApproved: boolean;
  };
  readonly runs: readonly StudyAnalysisRun[];
}
const endpoints = ["mainInputUncached", "mainInputTotal", "qualityJudge1", "qualityJudge2", "returnedMs", "reportedPipelineUsd"] as const;
function observed(value: unknown, label: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`Invalid ${label}`);
  return value;
}

export function analyseStudy(dataset: StudyDataset) {
  if (dataset.schemaVersion !== 1 || !dataset.design || !Array.isArray(dataset.runs)) throw new Error("Unsupported study dataset");
  const partition = dataset.design.analysisPartition ?? "measured-series";
  if (!["development", "pilot", "measured-series"].includes(partition)) throw new Error("Invalid analysis partition");
  const ids = new Set<string>();
  for (const run of dataset.runs) {
    validateRunObservation(run);
    if (ids.has(run.runId)) throw new Error(`Duplicate run identity: ${run.runId}`);
    ids.add(run.runId);
    if (!["replay", "live"].includes(run.population)) throw new Error("Unknown population");
    if (!["calibration", "development", "pilot", "measured-series"].includes(run.partition)) throw new Error("Unknown partition");
    if (!["off", "on", "only"].includes(run.arm)) throw new Error("Unknown study arm");
    if (!["single", "breadth", "manual", "followup"].includes(run.workflow)) throw new Error("Unknown workflow");
    if (typeof run.mainUsageComplete !== "boolean" || typeof run.mainInputTotalComplete !== "boolean") throw new Error("Missing main usage completeness");
    if (run.partition === partition && (run.methodSha256 !== dataset.design.methodSha256 || run.corpusSha256 !== dataset.design.corpusSha256 || run.candidateCommit !== dataset.design.candidateCommit))
      throw new Error("Measured run differs from frozen design");
    for (const value of [run.returnedMs, run.qualityJudge1, run.qualityJudge2, run.reportedPipelineUsd]) observed(value, "metric");
    if (run.mainUsage) for (const value of Object.values(run.mainUsage)) observed(value, "token component");
  }
  const populations = Object.fromEntries((["replay", "live"] as const).map((population) => {
    const expected = dataset.design.populations[population];
    // Reruns are retained in the inventory, never silently substituted for an
    // original failed observation. A replacement policy needs a design revision.
    const originals = dataset.runs.filter((r) => r.population === population && r.partition === partition && r.purpose !== "fixture-capture" && r.purpose !== "synthetic-driver-integration" && !r.rerunOf && r.arm !== "only");
    for (const run of originals) if (!expected.queryIds.includes(run.queryId) || !expected.repeats.includes(run.repeat)) throw new Error("Unscheduled measured observation");
    const samples: QuerySample[] = originals.map((r) => ({
      queryId: r.queryId, repeat: r.repeat, arm: r.arm,
      valid: r.status === "completed" && r.observerComplete && (population === "replay" ? r.replayValidity === "valid" : r.replayValidity === "not-replay"),
      mainInputUncached: r.mainUsageComplete ? observed(r.mainUsage?.inputUncached, "uncached input") : null,
      qualityJudge1: dataset.design.humanCalibrationApproved ? r.qualityJudge1 : null,
      qualityJudge2: dataset.design.humanCalibrationApproved ? r.qualityJudge2 : null,
      // Replay timing is explicitly not analysed as a production speed endpoint.
      returnedMs: population === "live" ? r.returnedMs : null,
      reportedPipelineUsd: r.reportedPipelineUsd,
    }));
    const metrics = Object.fromEntries(endpoints.map((endpoint) => {
      // Reuse the frozen numerical kernel without changing its historical API.
      // The temporary token slot is never persisted or labelled as uncached data;
      // the output key and independent completeness rule stay mainInputTotal.
      const values = endpoint === "mainInputTotal" ? samples.map((sample, i) => ({
        ...sample,
        mainInputUncached: originals[i].mainInputTotalComplete ? observed(originals[i].mainUsage?.inputTotal, "total input") : null,
      })) : samples;
      const estimate = estimatePairedQueries(values, "off", "on", endpoint === "mainInputTotal" ? "mainInputUncached" : endpoint, expected);
      const metric = endpoint === "mainInputUncached" || endpoint === "mainInputTotal" ? "log-ratio" : "difference";
      const interval = bootstrapPairedQueries(estimate, { seed: dataset.design.bootstrapSeed, draws: dataset.design.bootstrapDraws, confidence: dataset.design.confidence, metric, population: expected });
      return [endpoint, {
        ...estimate, metric,
        intervalScale: metric === "log-ratio" ? "ratio" : "difference",
        completePopulation: primaryAvailable(estimate, expected, metric),
        primaryAvailable: partition === "measured-series" && primaryAvailable(estimate, expected, metric),
        interval: metric === "log-ratio" ? { ...interval, lower: interval.lower === null ? null : Math.exp(interval.lower), upper: interval.upper === null ? null : Math.exp(interval.upper) } : interval,
        interpretation: population === "replay" && endpoint === "returnedMs" ? "Not a live-latency measure" : "Complete-case estimates are diagnostic when primaryAvailable is false",
      }];
    }));
    return [population, {
      expectedRuns: expected.queryIds.length * expected.repeats.length * 2,
      observedOriginalRuns: originals.length,
      outcomes: Object.fromEntries(["completed", "failed", "aborted", "not-started"].map((status) => [status, originals.filter((r) => r.status === status).length])),
      metrics,
    }];
  }));
  return {
    schemaVersion: 1,
    analysisClass: partition === "measured-series" ? "measured-series" : `${partition}: diagnostic only, not confirmatory`,
    design: dataset.design,
    inventory: dataset.runs.map((r) => ({ runId: r.runId, purpose: r.purpose ?? "comparative-task", population: r.population, partition: r.partition, arm: r.arm, status: r.status, rerunOf: r.rerunOf ?? null, mainInputTotal: r.mainInputTotalComplete ? r.mainUsage?.inputTotal ?? null : null, mainUsageComplete: r.mainUsageComplete, mainInputTotalComplete: r.mainInputTotalComplete })),
    populations,
    qualityAvailable: dataset.design.humanCalibrationApproved,
    note: "Reported pipeline cost is not an account-debit audit. Subscription usage is not cash spend. No superiority conclusion follows from token usage alone. The only arm is retained in the inventory but is not analysed in this version.",
  };
}

export async function reproduceAnalysis(input: string, output: string): Promise<void> {
  const bytes = await readFile(input, "utf8");
  const data = JSON.parse(bytes) as StudyDataset;
  const analysis = analyseStudy(data);
  await mkdir(output, { recursive: true });
  // Reproducible derived outputs can be regenerated; raw observations cannot.
  await writeFile(join(output, "analysis.json"), JSON.stringify({ datasetSha256: sha256Text(bytes), ...analysis }, null, 2) + "\n");
  const rows = ["population,endpoint,interval_metric,paired_tasks,missing_tasks,ratio,difference,lower,upper,primary_available"];
  for (const [population, summary] of Object.entries(analysis.populations)) {
    for (const [endpoint, metric] of Object.entries(summary.metrics)) {
      rows.push([population, endpoint, metric.intervalScale, metric.pairs.length, metric.missingQueries.length, metric.ratio ?? "", metric.difference ?? "", metric.interval.lower ?? "", metric.interval.upper ?? "", metric.primaryAvailable].join(","));
    }
  }
  await writeFile(join(output, "effects.csv"), rows.join("\n") + "\n");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 4) throw new Error("Usage: node --import tsx scripts/benchmarks/study-analysis.ts DATASET OUTPUT_DIRECTORY");
  await reproduceAnalysis(resolve(process.argv[2]), resolve(process.argv[3]));
}
