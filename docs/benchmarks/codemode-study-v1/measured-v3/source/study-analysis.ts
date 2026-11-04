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
import { CLASS_DEFINITIONS, EXPOSURE_CHANNELS, exposureRecordProblem, MINIMUM_SPAN_CHARACTERS, type ExposureChannel, type ExposureDiagnostics, type RunContextExposure } from "./study-context-exposure.js";

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
  /** Additive and descriptive. Absent from datasets exported before the measure existed. */
  readonly contextExposure?: RunContextExposure;
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
    /** Why visibility was granted or withheld. Absent from datasets exported before the field existed. */
    readonly humanCalibrationReason?: string;
    /** Hash of the corpus-revision binding, present only when a binding admitted the scores. */
    readonly calibrationBindingSha256?: string;
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

function validateContextExposure(run: StudyAnalysisRun): void {
  if (run.contextExposure === undefined) return;
  const problem = exposureRecordProblem(run.contextExposure);
  if (problem) throw new Error(`Invalid context exposure for ${run.runId}: ${problem}`);
}

/** Means under two rules are not one mean. A dataset holds one exposure method or it is refused. */
function validateExposureMethods(runs: readonly StudyAnalysisRun[]): void {
  const methods = new Set(runs.flatMap((run) => (run.contextExposure ? [JSON.stringify(run.contextExposure.method)] : [])));
  if (methods.size > 1) throw new Error(`Refusing to pool context exposure under ${methods.size} different methods`);
}

const exposureMean = (values: readonly number[]): number | null => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
function exposureMedian(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Short runs below this length are reported separately, because coincidence is plausible there. */
const NEAR_MINIMUM_CHARACTERS = 64;
const shortRunsNearMinimum = (record: RunContextExposure): number => record.spans.filter((span) => span.class === "quotation" && span.characters < NEAR_MINIMUM_CHARACTERS).reduce((sum, span) => sum + span.characters, 0);
/** Page text placed before its page was delivered: on the wire, and deliberately not counted. */
const skippedBeforeDelivery = (record: RunContextExposure): number => record.diagnostics.gateSkipped.laterInRequest + record.diagnostics.gateSkipped.laterRequest;

/** Per-arm description. Means and medians use complete records only; the counts show what they omit. */
function summariseExposureRuns(runs: readonly StudyAnalysisRun[]) {
  const records = runs.flatMap((run) => (run.contextExposure ? [run.contextExposure] : []));
  const complete = records.filter((record) => record.status === "complete");
  const describe = (read: (record: RunContextExposure) => number) => {
    const values = complete.map(read);
    return { mean: exposureMean(values), median: exposureMedian(values) };
  };
  const describeWithTotal = (read: (record: RunContextExposure) => number) => ({ ...describe(read), total: complete.length ? complete.reduce((sum, record) => sum + read(record), 0) : null });
  const requestTotal = (row: RunContextExposure["perRequest"][number]) => row.wholePage + row.quotation;
  const diagnostics: Record<string, number> = {};
  const addDiagnostics = (prefix: string, values: Readonly<Record<string, number>>) => { for (const [key, value] of Object.entries(values)) diagnostics[`${prefix}.${key}`] = (diagnostics[`${prefix}.${key}`] ?? 0) + value; };
  for (const record of records) {
    const { gateSkipped, unscannedRole, excluded, urlSubstitutedSources }: ExposureDiagnostics = record.diagnostics;
    addDiagnostics("gateSkipped", gateSkipped);
    addDiagnostics("unscannedRole", unscannedRole);
    addDiagnostics("excluded", excluded);
    addDiagnostics("resolution", { urlSubstitutedSources });
  }
  return {
    runs: runs.length,
    completeRuns: complete.length,
    incompleteRuns: records.filter((record) => record.status === "incomplete").length,
    unavailableRuns: records.filter((record) => record.status === "unavailable").length + runs.length - records.length,
    rawPageCharacters: describe((record) => record.rawPageCharacters!),
    wholePageCharacters: describe((record) => record.wholePageCharacters!),
    quotationCharacters: describe((record) => record.quotationCharacters!),
    /** Largest single request in each run: page material present at once, not repeated across turns. */
    peakRequestCharacters: describe((record) => Math.max(0, ...record.perRequest.map(requestTotal))),
    meanRequestCharacters: describe((record) => (record.requests ? record.rawPageCharacters! / record.requests : 0)),
    requests: describe((record) => record.requests),
    /** Part of the short-run class that sits close to the minimum, where coincidence is plausible. */
    shortRunsBelow64Characters: describeWithTotal(shortRunsNearMinimum),
    /** Not part of any total above. */
    skippedBeforeDeliveryCharacters: describeWithTotal(skippedBeforeDelivery),
    channelMeans: Object.fromEntries(EXPOSURE_CHANNELS.map((channel: ExposureChannel) => [channel, {
      wholePage: exposureMean(complete.map((record) => record.channels[channel].wholePage)),
      quotation: exposureMean(complete.map((record) => record.channels[channel].quotation)),
    }])),
    /** Sums over every record that has diagnostics, whatever its status. */
    diagnosticTotals: diagnostics,
  };
}

const EXPOSURE_INTERPRETATION = {
  scope: "Descriptive only. Not an endpoint and no input to any claim assessment. No quotation claim is authorised; final owner review of publication wording is pending.",
  cumulativeRequests: "rawPageCharacters is a sum over requests, and each request re-sends earlier history, so it grows with the number of requests as well as with page volume. Arms can differ in request count. Read it beside peakRequestCharacters and meanRequestCharacters.",
  replaySignal: "Replay exposure is largely set by the fixture: where the same recorded result reaches both arms, the figure can match by construction. Replay figures carry limited arm signal and are not comparable with live figures.",
  classes: "wholePageCharacters and quotationCharacters are compatibility field names for two size classes that sum to the total. Their definitions and limits are in definitions and methods. The limits were chosen post hoc, after retained data was inspected.",
  missingData: "Incomplete and unavailable runs are excluded from means and medians, never counted as zero.",
  deliveryGate: "An item counts against a page only when a call naming that page's URL has its output at or before the item in the same request. The gate holds per URL, not per retrieval: once one such call has delivered, all captured text for that URL can match. Page text placed earlier, such as a search answer sharing wording with a page fetched later, is not counted. skippedBeforeDeliveryCharacters and the skipped_before_delivery_characters columns report it, and it is in no total.",
  shortRunFloor: `Runs just above the ${MINIMUM_SPAN_CHARACTERS}-character minimum can be coincidental shared wording. shortRunsBelow64Characters and the short_run_below_64_characters columns show the part of the short-run class below 64 characters. Inspect those spans before treating short runs as deliberate quotations; no coincidence correction is applied.`,
  comparedRuns: "The runs table lists every run in the dataset. Only rows with compared true enter the means, medians, totals and CSV: other partitions, fixture captures, synthetic driver runs, reruns and single-arm runs are false, so summing the table gives a different population. diagnosticTotals also includes incomplete and unavailable compared records, while the skipped and below-64 figures use complete records only.",
  units: "Totals, spans, gateSkipped and unscannedRole are original page characters. excluded.urlOnly and excluded.promptEcho are positions in the canonicalised request item, so they must not be added to page characters. urlSubstitutedSources and the nonNfc diagnostics are counts of entries, not characters.",
  limits: `Exact runs below ${MINIMUM_SPAN_CHARACTERS} characters are not counted, so paraphrase and shorter fragments are invisible. The frozen study settings cap fetched and extracted page text at 16,000 characters, so a whole-page run may be a partial page. Encrypted reasoning items are not inspectable. A tool outside the measured catalogue makes a run incomplete. Text in a different Unicode form from its page is partly undercounted.`,
} as const;

/** Measured magnitudes per population, which are never pooled. Same complete compared runs as the CSV. */
function exposureMagnitudes(compared: readonly StudyAnalysisRun[]): string {
  return (["replay", "live"] as const).map((population) => {
    const records = compared.filter((run) => run.population === population && run.contextExposure?.status === "complete").map((run) => run.contextExposure!);
    if (records.length === 0) return `${population}: no compared complete runs.`;
    const add = (read: (record: RunContextExposure) => number) => records.reduce((sum, record) => sum + read(record), 0);
    return `${population}: over ${records.length} compared complete runs, ${add(shortRunsNearMinimum)} of ${add((record) => record.quotationCharacters!)} short-run characters sit in runs below ${NEAR_MINIMUM_CHARACTERS} characters, and ${add(skippedBeforeDelivery)} page characters sit in items placed before delivery and are not counted.`;
  }).join(" ");
}

/** Offline description of the frozen measure. It feeds no endpoint, interval or claim. */
function summariseContextExposure(dataset: StudyDataset, partition: string) {
  const isCompared = (run: StudyAnalysisRun) => run.partition === partition && run.purpose !== "fixture-capture" && run.purpose !== "synthetic-driver-integration" && !run.rerunOf && run.arm !== "only";
  const compared = dataset.runs.filter(isCompared);
  const arms = (runs: readonly StudyAnalysisRun[]) => Object.fromEntries(["off", "on"].map((arm) => [arm, summariseExposureRuns(runs.filter((run) => run.arm === arm))]));
  return {
    measure: "rawPageCharacters",
    interpretation: { ...EXPOSURE_INTERPRETATION, magnitudes: exposureMagnitudes(compared) },
    definitions: { rawPageCharacters: "Retrieved page characters in actual main-model requests, counted per request.", wholePageCharacters: CLASS_DEFINITIONS.wholePage, quotationCharacters: CLASS_DEFINITIONS.quotation },
    labels: { wholePageCharacters: "whole-page or long-run exposure", quotationCharacters: "short-run exposure (short exact page-text runs)" },
    methods: [...new Set(dataset.runs.flatMap((run) => (run.contextExposure ? [JSON.stringify(run.contextExposure.method)] : [])))].sort().map((method) => JSON.parse(method) as RunContextExposure["method"]),
    populations: Object.fromEntries((["replay", "live"] as const).map((population) => {
      const runs = compared.filter((run) => run.population === population);
      const workflows = [...new Set(runs.map((run) => run.workflow))].sort();
      return [population, { arms: arms(runs), workflows: Object.fromEntries(workflows.map((workflow) => [workflow, arms(runs.filter((run) => run.workflow === workflow))])) }];
    })),
    /** Every run in the dataset. Only rows with `compared: true` enter the summaries above. */
    runs: dataset.runs.map((run) => ({ runId: run.runId, compared: isCompared(run), queryId: run.queryId, repeat: run.repeat, population: run.population, partition: run.partition, purpose: run.purpose ?? "comparative-task", workflow: run.workflow, arm: run.arm, status: run.contextExposure?.status ?? "unavailable", rawPageCharacters: run.contextExposure?.rawPageCharacters ?? null, wholePageCharacters: run.contextExposure?.wholePageCharacters ?? null, quotationCharacters: run.contextExposure?.quotationCharacters ?? null, observedRawPageCharacters: run.contextExposure?.observed.rawPageCharacters ?? null, requests: run.contextExposure?.requests ?? null, issues: run.contextExposure?.issues ?? ["No exposure record in this dataset"], notices: run.contextExposure?.notices ?? [] })),
  };
}

export function analyseStudy(dataset: StudyDataset) {
  if (dataset.schemaVersion !== 1 || !dataset.design || !Array.isArray(dataset.runs)) throw new Error("Unsupported study dataset");
  const partition = dataset.design.analysisPartition ?? "measured-series";
  if (!["development", "pilot", "measured-series"].includes(partition)) throw new Error("Invalid analysis partition");
  validateExposureMethods(dataset.runs);
  const ids = new Set<string>();
  for (const run of dataset.runs) {
    validateRunObservation(run);
    validateContextExposure(run);
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
    // Omitted for older datasets, so their regenerated analysis keeps its exact bytes.
    ...(dataset.runs.some((run) => run.contextExposure) ? { contextExposure: summariseContextExposure(dataset, partition) } : {}),
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
  if (analysis.contextExposure) {
    const exposureColumns = {
      population: "replay or live", workflow: "workflow, or all", arm: "off or on", runs: "compared runs", complete_runs: "runs in the means and medians", incomplete_runs: "excluded, not zero", unavailable_runs: "excluded, not zero",
      raw_page_characters: "page characters summed over all requests in a run", whole_page_or_long_run_characters: "the JSON field wholePageCharacters", short_run_characters: "the JSON field quotationCharacters: short exact page-text runs",
      peak_request_characters: "largest single request in a run", mean_request_characters: "run total divided by its requests", requests: "requests per run",
      short_run_below_64_characters: "the part of short_run_characters in runs below 64 characters, where coincidence is plausible", skipped_before_delivery_characters: "page characters in items placed before their page was delivered; not counted in any other column",
    };
    const measures = [["raw_page_characters", "rawPageCharacters"], ["whole_page_or_long_run_characters", "wholePageCharacters"], ["short_run_characters", "quotationCharacters"], ["peak_request_characters", "peakRequestCharacters"], ["mean_request_characters", "meanRequestCharacters"], ["requests", "requests"]] as const;
    const totalled = [["short_run_below_64_characters", "shortRunsBelow64Characters"], ["skipped_before_delivery_characters", "skippedBeforeDeliveryCharacters"]] as const;
    const exposure = [["population", "workflow", "arm", "runs", "complete_runs", "incomplete_runs", "unavailable_runs", ...measures.flatMap(([column]) => [`${column}_mean`, `${column}_median`]), ...totalled.flatMap(([column]) => [`${column}_mean`, `${column}_median`, `${column}_total`])].join(",")];
    const row = (population: string, workflow: string, arm: string, summary: ReturnType<typeof summariseExposureRuns>) => exposure.push([population, workflow, arm, summary.runs, summary.completeRuns, summary.incompleteRuns, summary.unavailableRuns, ...measures.flatMap(([, field]) => [summary[field].mean ?? "", summary[field].median ?? ""]), ...totalled.flatMap(([, field]) => [summary[field].mean ?? "", summary[field].median ?? "", summary[field].total ?? ""])].join(","));
    for (const [population, summary] of Object.entries(analysis.contextExposure.populations)) {
      for (const [arm, values] of Object.entries(summary.arms)) row(population, "all", arm, values);
      for (const [workflow, arms] of Object.entries(summary.workflows)) for (const [arm, values] of Object.entries(arms)) row(population, workflow, arm, values);
    }
    await writeFile(join(output, "context-exposure.csv"), exposure.join("\n") + "\n");
    // A sibling file, so that the CSV stays a plain table that any parser can read.
    await writeFile(join(output, "context-exposure-method.json"), JSON.stringify({ csv: "context-exposure.csv", datasetSha256: sha256Text(bytes), unit: "UTF-16 code units of original page text; interpretation.units names the diagnostics in other units", columns: exposureColumns, medianColumns: "Each measure has a _mean and a _median column over complete runs; the two diagnostic measures also have a _total over the same runs", methods: analysis.contextExposure.methods, definitions: analysis.contextExposure.definitions, labels: analysis.contextExposure.labels, interpretation: analysis.contextExposure.interpretation }, null, 2) + "\n");
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 4) throw new Error("Usage: node --import tsx scripts/benchmarks/study-analysis.ts DATASET OUTPUT_DIRECTORY");
  await reproduceAnalysis(resolve(process.argv[2]), resolve(process.argv[3]));
}
