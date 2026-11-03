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
  readonly toolCatalogueObserved?: boolean;
  readonly rerunSeries?: string;
  readonly purpose?: "comparative-task" | "fixture-capture" | "synthetic-driver-integration";
  readonly partition: "calibration" | "development" | "pilot" | "measured-series";
  readonly workflow: "single" | "breadth" | "manual" | "followup";
  /** Requires correlated version-2 witnesses and all uncached-input components. */
  readonly mainUsageComplete: boolean;
  /** Independent: correlated total input may exist while cache subsets are absent. */
  readonly mainInputTotalComplete: boolean;
  readonly returnedMs: number | null;
  readonly answerDelivered?: boolean;
  readonly validTaskOutcome?: boolean;
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
    readonly populations: Readonly<Record<Population, { queryIds: readonly string[]; repeats: readonly number[]; replayPrimaryQueryIds?: readonly string[]; manualReplayQueryIds?: readonly string[] }>>;
    readonly bootstrapSeed: number;
    readonly bootstrapDraws: number;
    readonly confidence: number;
    readonly qualityLossMargin?: number;
    readonly humanCalibrationApproved: boolean;
  };
  readonly runs: readonly StudyAnalysisRun[];
  readonly quality?: {
    readonly manifestSha256: string;
    readonly judges: readonly string[];
    readonly records: readonly unknown[];
    readonly disagreements: readonly unknown[];
    readonly calibration: readonly unknown[];
  };
  readonly metadataCorrections?: readonly { runId: string; field: string; recorded: string; derived: string; sourceFileSha256: string }[];
}
const endpoints = ["mainInputUncached", "mainInputTotal", "qualityJudge1", "qualityJudge2", "returnedMs", "reportedPipelineUsd"] as const;
export function declaredTaskOutcomeIssues(errors: readonly string[]): boolean {
  return errors.every((error) => /^Operation \S+ ended \S+$/.test(error) || /^StudyBudgetError: (The run's|The run has used|Tool |intelli_research|A model attempt|The study run is stopped)/.test(error));
}

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
    const expectedPopulation = dataset.design.populations[population];
    const expected = population === "replay" ? { ...expectedPopulation, queryIds: expectedPopulation.replayPrimaryQueryIds ?? expectedPopulation.queryIds.filter((id) => !dataset.runs.some((run) => run.queryId === id && run.workflow === "manual")) } : expectedPopulation;
    // Reruns are retained in the inventory, never silently substituted for an
    // original failed observation. A replacement policy needs a design revision.
    const originals = dataset.runs.filter((r) => r.population === population && r.partition === partition && r.purpose !== "fixture-capture" && r.purpose !== "synthetic-driver-integration" && !r.rerunOf && r.arm !== "only");
    for (const run of originals) if (!expectedPopulation.queryIds.includes(run.queryId) || !expectedPopulation.repeats.includes(run.repeat)) throw new Error("Unscheduled measured observation");
    const samples: QuerySample[] = originals.map((r) => ({
      queryId: r.queryId, repeat: r.repeat, arm: r.arm,
      valid: (r.status === "completed" || (r.status === "failed" && r.validTaskOutcome === true)) && r.observerComplete && r.toolCatalogueObserved !== false && (population === "replay" ? r.replayValidity === "valid" : r.replayValidity === "not-replay"),
      mainInputUncached: r.mainUsageComplete ? observed(r.mainUsage?.inputUncached, "uncached input") : null,
      qualityJudge1: dataset.design.humanCalibrationApproved ? r.qualityJudge1 : null,
      qualityJudge2: dataset.design.humanCalibrationApproved ? r.qualityJudge2 : null,
      // Replay timing is explicitly not analysed as a production speed endpoint.
      returnedMs: population === "live" ? r.returnedMs : null,
      reportedPipelineUsd: population === "replay" ? null : r.reportedPipelineUsd,
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
        diagnosticInterval: (() => {
          const diagnostic = bootstrapPairedQueries(estimate, { seed: dataset.design.bootstrapSeed, draws: dataset.design.bootstrapDraws, confidence: dataset.design.confidence, metric, population: expected, diagnostic: true });
          return metric === "log-ratio" ? { ...diagnostic, lower: diagnostic.lower === null ? null : Math.exp(diagnostic.lower), upper: diagnostic.upper === null ? null : Math.exp(diagnostic.upper) } : diagnostic;
        })(),
        interpretation: population === "replay" && endpoint === "returnedMs" ? "Not a live-latency measure" : "Complete-case estimates are diagnostic when primaryAvailable is false",
      }];
    }));
    const qualityState = (endpoint: "qualityJudge1" | "qualityJudge2"): "preserved" | "meaningful-loss" | "insufficient-precision" => {
      const metric = metrics[endpoint];
      if (!metric.primaryAvailable || metric.interval.lower === null || metric.interval.upper === null) return "insufficient-precision";
      const margin = dataset.design.qualityLossMargin ?? 0.5;
      if (metric.interval.lower > -margin) return "preserved";
      return metric.interval.upper < -margin ? "meaningful-loss" : "insufficient-precision";
    };
    const judge1 = qualityState("qualityJudge1");
    const judge2 = qualityState("qualityJudge2");
    const qualityClaim = judge1 === "insufficient-precision" || judge2 === "insufficient-precision" ? "insufficient-precision" : judge1 === "meaningful-loss" || judge2 === "meaningful-loss" ? judge1 !== judge2 ? "judge-conflict" : "meaningful-loss" : "preserved";
    const tokenMetric = metrics.mainInputUncached;
    const rawTokenClaim = !tokenMetric.primaryAvailable || tokenMetric.interval.lower === null || tokenMetric.interval.upper === null ? "unavailable" : tokenMetric.interval.upper < 1 ? "saving" : tokenMetric.interval.lower > 1 ? "increased-input" : "no-demonstrated-effect";
    const tokenClaim = rawTokenClaim === "saving" && qualityClaim !== "preserved" ? "not-established" : rawTokenClaim;
    const claimAssessment = {
      tokenClaim,
      fiftyPercentHypothesis: rawTokenClaim === "saving" && qualityClaim === "preserved" && tokenMetric.interval.upper !== null && tokenMetric.interval.upper <= 0.5 ? "supported" : "not-established",
      qualityClaim,
      overallSavingClaim: tokenClaim === "saving" && qualityClaim === "preserved" ? "supported" : "not-established",
      qualityLossMargin: dataset.design.qualityLossMargin ?? 0.5,
      basis: "Primary confidence bounds only; complete-case diagnostic intervals are not claim evidence",
    };
    const manualQueryIds = population === "replay" ? expectedPopulation.manualReplayQueryIds ?? expectedPopulation.queryIds.filter((id) => dataset.runs.some((run) => run.queryId === id && run.workflow === "manual")) : [];
    const manualExpected = { ...expectedPopulation, queryIds: manualQueryIds };
    const manualSamples = samples.filter((sample) => manualQueryIds.includes(sample.queryId));
    const manualReplay = population === "replay" ? {
      queryIds: manualQueryIds,
      outcomes: originals.filter((run) => run.workflow === "manual").map((run) => ({ runId: run.runId, queryId: run.queryId, repeat: run.repeat, arm: run.arm, status: run.status, replayValidity: run.replayValidity, answerDelivered: run.answerDelivered ?? false, error: run.error ?? null })),
      estimates: manualQueryIds.length === 0 ? {} : Object.fromEntries(["mainInputUncached", "qualityJudge1", "qualityJudge2"].map((endpoint) => [endpoint, { ...estimatePairedQueries(manualSamples, "off", "on", endpoint as "mainInputUncached" | "qualityJudge1" | "qualityJudge2", manualExpected), primaryAvailable: false, interpretation: "Descriptive manual replay reliability; outside the replay primary analysis" }])),
    } : null;
    return [population, {
      expectedRuns: expected.queryIds.length * expected.repeats.length * 2,
      observedOriginalRuns: originals.length,
      manualReplay,
      claimAssessment,
      outcomes: Object.fromEntries(["completed", "failed", "aborted", "not-started"].map((status) => [status, originals.filter((r) => r.status === status).length])),
      metrics,
      qualitySensitivity: Object.fromEntries(([1, 2] as const).map((judge) => {
        const endpoint = judge === 1 ? "qualityJudge1" : "qualityJudge2";
        const values = samples.map((sample) => ({ ...sample, valid: sample[endpoint] !== null }));
        const estimate = estimatePairedQueries(values, "off", "on", endpoint, expected);
        const interval = bootstrapPairedQueries(estimate, { seed: dataset.design.bootstrapSeed, draws: dataset.design.bootstrapDraws, confidence: dataset.design.confidence, metric: "difference", population: expected, diagnostic: true });
        return [endpoint, { ...estimate, interval, interpretation: "Includes scored failed and invalid runs; diagnostic sensitivity only, never a primary endpoint" }];
      })),
    }];
  }));
  return {
    schemaVersion: 1,
    analysisClass: partition === "measured-series" ? "measured-series" : `${partition}: diagnostic only, not confirmatory`,
    design: dataset.design,
    inventory: dataset.runs.map((r) => ({ runId: r.runId, purpose: r.purpose ?? "comparative-task", population: r.population, partition: r.partition, arm: r.arm, status: r.status, rerunOf: r.rerunOf ?? null, mainInputTotal: r.mainInputTotalComplete ? r.mainUsage?.inputTotal ?? null : null, mainUsageComplete: r.mainUsageComplete, mainInputTotalComplete: r.mainInputTotalComplete })),
    populations,
    qualityAvailable: dataset.design.humanCalibrationApproved,
    qualityProvenance: dataset.quality ? { manifestSha256: dataset.quality.manifestSha256, judges: dataset.quality.judges } : null,
    qualityDisagreements: dataset.design.humanCalibrationApproved ? dataset.quality?.disagreements ?? [] : [],
    judgeHumanCalibration: dataset.design.humanCalibrationApproved ? dataset.quality?.calibration ?? [] : [],
    qualityAgreement: dataset.design.humanCalibrationApproved && dataset.quality ? (() => {
      const disagreements = dataset.quality.disagreements as { runId: string; queryId: string; population: string; repeat: number; arm: string; overallDifference: number }[];
      const records = dataset.quality.records as { runId: string; judgeId: string; score: { overall: number; evidenceQuotes: readonly string[]; unmatchedEvidenceQuotes: readonly string[] } }[];
      const calibration = dataset.quality.calibration as { judgesDisagree: boolean; judges: { agreesWithHuman: boolean }[] }[];
      const pairedDirectionDisagreements = [...new Set(disagreements.map((row) => `${row.population}/${row.queryId}`))].flatMap((key) => {
        const [population, queryId] = key.split("/");
        const cells = disagreements.filter((row) => row.population === population && row.queryId === queryId);
        const score = (judgeId: string, arm: string) => {
          const runs = cells.filter((row) => row.arm === arm).map((row) => row.runId);
          const values = records.filter((record) => record.judgeId === judgeId && runs.includes(record.runId)).map((record) => record.score.overall);
          return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
        };
        const judges = [...new Set(records.map((record) => record.judgeId))];
        if (judges.length !== 2) return [];
        const first = score(judges[0], "off");
        const second = score(judges[1], "off");
        const firstOn = score(judges[0], "on");
        const secondOn = score(judges[1], "on");
        if (first === null || second === null || firstOn === null || secondOn === null) return [];
        return [{ population, queryId, difference: first - firstOn - (second - secondOn) }];
      }).filter((row) => Math.abs(row.difference) >= 2);
      const packetDirectionDisagreements = [...new Set(disagreements.map((row) => `${row.population}/${row.queryId}/${row.repeat}`))].flatMap((key) => {
        const [population, queryId, repeatText] = key.split("/");
        const cells = disagreements.filter((row) => row.population === population && row.queryId === queryId && row.repeat === Number(repeatText));
        const judges = [...new Set(records.map((record) => record.judgeId))];
        if (judges.length !== 2) return [];
        const directional = (judgeId: string, arm: string) => {
          const runs = cells.filter((row) => row.arm === arm).map((row) => row.runId);
          const values = records.filter((record) => record.judgeId === judgeId && runs.includes(record.runId)).map((record) => record.score.overall);
          return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
        };
        const firstOff = directional(judges[0], "off");
        const firstOn = directional(judges[0], "on");
        const secondOff = directional(judges[1], "off");
        const secondOn = directional(judges[1], "on");
        if (firstOff === null || firstOn === null || secondOff === null || secondOn === null) return [];
        return [{ population, queryId, repeat: Number(repeatText), difference: firstOff - firstOn - (secondOff - secondOn) }];
      }).filter((row) => Math.abs(row.difference) >= 2);
      return {
        comparedAnswers: disagreements.length,
        exactOverallAgreement: disagreements.filter((row) => row.overallDifference === 0).length,
        withinOneOverallPoint: disagreements.filter((row) => Math.abs(row.overallDifference) <= 1).length,
        maximumAbsoluteOverallDifference: disagreements.length ? Math.max(...disagreements.map((row) => Math.abs(row.overallDifference))) : null,
        inspectionThreshold: 2,
        inspectionRunIds: disagreements.filter((row) => Math.abs(row.overallDifference) >= 2).map((row) => row.runId),
        pairedDirectionDisagreements,
        packetDirectionDisagreements,
        emptyEvidenceQuoteLists: records.filter((record) => record.score.evidenceQuotes.length === 0).length,
        unmatchedEvidenceQuotes: records.reduce((sum, record) => sum + record.score.unmatchedEvidenceQuotes.length, 0),
        calibrationCases: calibration.length,
        calibrationInterJudgeDisagreements: calibration.filter((row) => row.judgesDisagree).length,
        calibrationJudgeHumanDisagreements: calibration.reduce((sum, row) => sum + row.judges.filter((judge) => !judge.agreesWithHuman).length, 0),
      };
    })() : null,
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
  const rows = ["population,endpoint,interval_metric,paired_tasks,missing_tasks,ratio,difference,lower,upper,diagnostic_lower,diagnostic_upper,primary_available"];
  for (const [population, summary] of Object.entries(analysis.populations)) {
    for (const [endpoint, metric] of Object.entries(summary.metrics)) {
      rows.push([population, endpoint, metric.intervalScale, metric.pairs.length, metric.missingQueries.length, metric.ratio ?? "", metric.difference ?? "", metric.interval.lower ?? "", metric.interval.upper ?? "", metric.diagnosticInterval.lower ?? "", metric.diagnosticInterval.upper ?? "", metric.primaryAvailable].join(","));
    }
    for (const [endpoint, metric] of Object.entries(summary.qualitySensitivity)) {
      rows.push([population, `${endpoint}IncludingFailed`, "difference", metric.pairs.length, metric.missingQueries.length, metric.ratio ?? "", metric.difference ?? "", "", "", metric.interval.lower ?? "", metric.interval.upper ?? "", false].join(","));
    }
  }
  await writeFile(join(output, "effects.csv"), rows.join("\n") + "\n");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 4) throw new Error("Usage: node --import tsx scripts/benchmarks/study-analysis.ts DATASET OUTPUT_DIRECTORY");
  await reproduceAnalysis(resolve(process.argv[2]), resolve(process.argv[3]));
}
