// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Exact paired-query statistics (common METHOD "Judging and Analysis", C32).
//
// The query is the analysis unit. estimatePairedQueries receives explicit
// expected query IDs and repeat numbers, rejects duplicate arm/query/repeat
// cells, averages the evaluable paired repeats within each query, reports the
// equal-query mean difference and the exponentiated equal-query mean log
// ratio of positive query means, lists queries with absent/invalid/unknown
// paired cells as missing, and lists nonpositive query means separately as
// undefinedRatioQueries which make the ratio (and its interval) unavailable
// rather than inventing a saving; difference endpoints retain zero-valued
// pairs. bootstrapPairedQueries resamples query pairs together (query
// clusters, never individual judge calls or pages) with the recorded seed,
// requested draws and confidence, and returns no interval with fewer than two
// evaluable query clusters.

import type { PairedEstimate, QueryPair, QuerySample } from "./contracts.js";

type Endpoint = "mainInputUncached" | "qualityJudge1" | "qualityJudge2" | "returnedMs" | "reportedPipelineUsd";

export class DuplicateCellError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateCellError";
  }
}

export class InvalidPopulationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPopulationError";
  }
}

/** Maximum seed: mulberry32 operates on the unsigned 32-bit range, so larger seeds would alias smaller ones. */
export const MAX_SEED = 0xffffffff;

function validatePopulation(population: { readonly queryIds: readonly string[]; readonly repeats: readonly number[] }): void {
  if (!Array.isArray(population.queryIds) || population.queryIds.length === 0) {
    throw new InvalidPopulationError("population.queryIds must be a nonempty array");
  }
  const seenQueries = new Set<string>();
  for (const queryId of population.queryIds) {
    if (typeof queryId !== "string" || queryId === "") {
      throw new InvalidPopulationError(`population query id must be a nonempty string, got ${JSON.stringify(queryId)}`);
    }
    if (seenQueries.has(queryId)) {
      throw new DuplicateCellError(`Duplicate population query id "${queryId}": the analysis unit would be double-weighted`);
    }
    seenQueries.add(queryId);
  }
  if (!Array.isArray(population.repeats) || population.repeats.length === 0) {
    throw new InvalidPopulationError("population.repeats must be a nonempty array");
  }
  const seenRepeats = new Set<number>();
  for (const repeat of population.repeats) {
    if (typeof repeat !== "number" || !Number.isInteger(repeat) || repeat < 1) {
      throw new InvalidPopulationError(`population repeat must be a positive integer, got ${JSON.stringify(repeat)}`);
    }
    if (seenRepeats.has(repeat)) {
      throw new DuplicateCellError(`Duplicate population repeat ${repeat}: paired cells would be double-weighted`);
    }
    seenRepeats.add(repeat);
  }
}

function validateSeed(seed: number): void {
  if (typeof seed !== "number" || !Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) {
    throw new InvalidPopulationError(`seed must be an integer in [0, ${MAX_SEED}] so the echoed seed is the seed used, got ${JSON.stringify(seed)}`);
  }
}

function cellValue(sample: QuerySample, endpoint: Endpoint): number | null {
  if (!sample.valid) return null;
  const value = sample[endpoint];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mean(values: readonly number[]): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/**
 * Exact paired-query estimate. `population` names the expected query IDs and
 * repeat numbers; samples outside the population are ignored, and duplicate
 * (arm, queryId, repeat) cells are rejected. Queries with at least one
 * absent/invalid/unknown expected paired cell are listed in missingQueries
 * (fully unusable queries included); their evaluable repeats still contribute
 * pairs, because complete-case results remain diagnostic while the missing
 * population is reported.
 */
export function estimatePairedQueries(
  samples: readonly QuerySample[],
  control: string,
  treatment: string,
  endpoint: Endpoint,
  population: { readonly queryIds: readonly string[]; readonly repeats: readonly number[] },
): PairedEstimate {
  validatePopulation(population);
  const cells = new Map<string, QuerySample>();
  for (const sample of samples) {
    if (sample.arm !== control && sample.arm !== treatment) continue;
    const key = `${sample.arm}\u0000${sample.queryId}\u0000${sample.repeat}`;
    if (cells.has(key)) {
      throw new DuplicateCellError(
        `Duplicate paired cell arm=${sample.arm} query=${sample.queryId} repeat=${sample.repeat}`,
      );
    }
    cells.set(key, sample);
  }

  const expectedQueryIds = [...population.queryIds];
  const expectedRepeats = [...population.repeats];
  const pairs: QueryPair[] = [];
  const missingQueries: string[] = [];
  const undefinedRatioQueries: string[] = [];

  for (const queryId of expectedQueryIds) {
    let pairedControl: number[] = [];
    let pairedTreatment: number[] = [];
    let missingCell = false;
    for (const repeat of expectedRepeats) {
      const controlSample = cells.get(`${control}\u0000${queryId}\u0000${repeat}`);
      const treatmentSample = cells.get(`${treatment}\u0000${queryId}\u0000${repeat}`);
      const controlValue = controlSample === undefined ? null : cellValue(controlSample, endpoint);
      const treatmentValue = treatmentSample === undefined ? null : cellValue(treatmentSample, endpoint);
      if (controlValue === null || treatmentValue === null) {
        missingCell = true; // absent, invalid or unknown paired cell
        continue;
      }
      pairedControl.push(controlValue);
      pairedTreatment.push(treatmentValue);
    }
    if (missingCell) missingQueries.push(queryId);
    if (pairedControl.length === 0) continue;
    const controlMeanValue = mean(pairedControl);
    const treatmentMeanValue = mean(pairedTreatment);
    pairs.push({
      queryId,
      controlMean: controlMeanValue,
      treatmentMean: treatmentMeanValue,
      pairedRepeats: pairedControl.length,
    });
    if (!(controlMeanValue > 0) || !(treatmentMeanValue > 0)) {
      // Nonpositive query means are listed separately; they do not remove the
      // query's zero-valued pairs from the difference endpoint.
      undefinedRatioQueries.push(queryId);
    }
  }

  const difference = pairs.length > 0 ? mean(pairs.map((pair) => pair.treatmentMean - pair.controlMean)) : null;
  const ratio =
    pairs.length > 0 && undefinedRatioQueries.length === 0
      ? Math.exp(mean(pairs.map((pair) => Math.log(pair.treatmentMean) - Math.log(pair.controlMean))))
      : null;

  return { pairs, missingQueries, undefinedRatioQueries, ratio, difference };
}

/**
 * Deterministic seeded PRNG (mulberry32). Recorded in the interval result via
 * the caller-supplied seed so every draw sequence is reproducible.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sorted: readonly number[], quantile: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const position = quantile * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

/** The expected paired population an estimate was computed against. */
export interface ExpectedPopulation {
  readonly queryIds: readonly string[];
  readonly repeats: readonly number[];
}

/**
 * True when every expected query/repeat cell produced a valid pair, so the
 * prespecified PRIMARY inference is available for the given metric. Metric
 * rules follow the common METHOD (revision P0-2): `undefinedRatioQueries`
 * (nonpositive query means) make the RATIO endpoint and its interval
 * unavailable, "not an invented saving; valid difference endpoints still
 * retain those zero-valued pairs". So for `"difference"` a complete
 * population with a zero query mean keeps its primary interval, while for
 * `"log-ratio"` it does not. An incomplete population (any missing cell, any
 * expected query absent from the pairs, any partial-repeat query) makes the
 * primary claim unavailable for BOTH metrics; complete-case estimates remain
 * diagnostic only and must be labelled as such by the caller.
 */
export function primaryAvailable(
  estimate: PairedEstimate,
  population: ExpectedPopulation,
  metric: "log-ratio" | "difference",
): boolean {
  validatePopulation(population);
  if (estimate.missingQueries.length > 0) return false;
  if (metric === "log-ratio" && estimate.undefinedRatioQueries.length > 0) return false;
  const expectedRepeats = population.repeats.length;
  const pairsByQuery = new Map(estimate.pairs.map((pair) => [pair.queryId, pair]));
  for (const queryId of population.queryIds) {
    const pair = pairsByQuery.get(queryId);
    if (pair === undefined) return false;
    if (pair.pairedRepeats !== expectedRepeats) return false;
  }
  return true;
}

/**
 * Query-clustered bootstrap over the paired estimate. Resamples whole query
 * pairs together; the metric selects log-ratio (undefined when any query mean
 * is nonpositive) or difference statistics. Returns null bounds when fewer
 * than two evaluable query clusters exist: a degenerate small sample is not
 * power evidence.
 *
 * Primary-inference guard: when `population` is supplied and the estimate's
 * prespecified valid-pair population is incomplete for the requested metric
 * (see {@link primaryAvailable}; zero query means block only the log-ratio
 * metric), the interval bounds are returned as null unless the caller
 * explicitly passes `diagnostic: true`, labelling the run a complete-case
 * diagnostic rather than a primary inference. Without a `population`, the
 * interval is always a complete-case diagnostic; callers making primary
 * claims must supply the population.
 */
export function bootstrapPairedQueries(
  estimate: PairedEstimate,
  options: {
    readonly seed: number;
    readonly draws: number;
    readonly confidence: number;
    readonly metric: "log-ratio" | "difference";
    /** Expected analysis population; supplies the primary-availability guard. */
    readonly population?: ExpectedPopulation;
    /** Explicitly labels this bootstrap a complete-case diagnostic. */
    readonly diagnostic?: boolean;
  },
): { readonly lower: number | null; readonly upper: number | null; readonly draws: number; readonly seed: number } {
  const { seed, draws, confidence, metric } = options;
  if (!Number.isInteger(draws) || draws < 1) throw new Error("draws must be a positive integer");
  if (!(confidence > 0 && confidence < 1)) throw new Error("confidence must lie strictly between 0 and 1");
  validateSeed(seed);
  if (options.population !== undefined && !options.diagnostic && !primaryAvailable(estimate, options.population, metric)) {
    // The primary inference is unavailable with an incomplete population;
    // null bounds make the unavailability explicit instead of silently
    // substituting a complete-case interval.
    return { lower: null, upper: null, draws, seed };
  }
  if (estimate.pairs.length < 2) return { lower: null, upper: null, draws, seed };
  if (metric === "log-ratio" && estimate.undefinedRatioQueries.length > 0) {
    // The ratio and its interval are unavailable when any query mean is
    // nonpositive; an invented saving or a fabricated bound is forbidden.
    return { lower: null, upper: null, draws, seed };
  }

  const clusters =
    metric === "log-ratio"
      ? estimate.pairs.map((pair) => Math.log(pair.treatmentMean) - Math.log(pair.controlMean))
      : estimate.pairs.map((pair) => pair.treatmentMean - pair.controlMean);

  const random = mulberry32(seed);
  const statistics: number[] = [];
  for (let draw = 0; draw < draws; draw += 1) {
    let sum = 0;
    for (let i = 0; i < clusters.length; i += 1) {
      const index = Math.floor(random() * clusters.length);
      const clamped = Math.min(index, clusters.length - 1);
      sum += clusters[clamped]!;
    }
    statistics.push(sum / clusters.length);
  }
  statistics.sort((a, b) => a - b);
  const alpha = (1 - confidence) / 2;
  return { lower: percentile(statistics, alpha), upper: percentile(statistics, 1 - alpha), draws, seed };
}
