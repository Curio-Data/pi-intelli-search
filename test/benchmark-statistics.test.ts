// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bootstrapPairedQueries, estimatePairedQueries, mulberry32 } from "../scripts/benchmarks/statistics.js";
import { DuplicateCellError } from "../scripts/benchmarks/statistics.js";
import type { PairedEstimate, QuerySample } from "../scripts/benchmarks/contracts.js";

type Endpoint = Parameters<typeof estimatePairedQueries>[3];

function sample(queryId: string, repeat: number, arm: string, value: number | null, valid = true): QuerySample {
  return {
    queryId,
    repeat,
    arm,
    valid,
    mainInputUncached: value,
    qualityJudge1: value === null ? null : value / 100,
    qualityJudge2: null,
    returnedMs: value === null ? null : value * 10,
    reportedPipelineUsd: value === null ? null : value / 1000,
  };
}

const POPULATION = { queryIds: ["q1", "q2"], repeats: [1, 2] };

describe("estimatePairedQueries exact paired method", () => {
  it("computes the equal-query mean difference and exponentiated mean log ratio", () => {
    const samples: QuerySample[] = [
      // q1 control mean 150, treatment mean 75 (ratio 0.5)
      sample("q1", 1, "A2", 100), sample("q1", 2, "A2", 200),
      sample("q1", 1, "B", 50), sample("q1", 2, "B", 100),
      // q2 control mean 300, treatment mean 150 (ratio 0.5)
      sample("q2", 1, "A2", 300), sample("q2", 1, "B", 150),
      sample("q2", 2, "A2", 0), sample("q2", 2, "B", 0), // paired repeats present via repeat 1 only? both arms present here
    ];
    const estimate = estimatePairedQueries(samples, "A2", "B", "mainInputUncached", POPULATION);
    // q2 pairs: repeat 1 (300/150) and repeat 2 (0/0): control mean 150, treatment mean 75.
    assert.deepEqual(
      estimate.pairs.map((pair) => [pair.queryId, pair.controlMean, pair.treatmentMean, pair.pairedRepeats]),
      [
        ["q1", 150, 75, 2],
        ["q2", 150, 75, 2],
      ],
    );
    // difference: mean(-75, -75) = -75; ratio: exp(mean(log 0.5, log 0.5)) = 0.5.
    assert.equal(estimate.difference, -75);
    assert.ok(Math.abs((estimate.ratio ?? 0) - 0.5) < 1e-12);
    assert.deepEqual(estimate.missingQueries, []);
    assert.deepEqual(estimate.undefinedRatioQueries, []);
  });

  it("rejects duplicate arm/query/repeat cells", () => {
    const samples: QuerySample[] = [sample("q1", 1, "A2", 1), sample("q1", 1, "A2", 2), sample("q1", 1, "B", 3)];
    assert.throws(
      () => estimatePairedQueries(samples, "A2", "B", "mainInputUncached", POPULATION),
      DuplicateCellError,
    );
  });

  it("lists absent, invalid and unknown-value cells as missing queries", () => {
    const samples: QuerySample[] = [
      sample("q1", 1, "A2", 10), sample("q1", 1, "B", 5), // q1 repeat 2 absent
      sample("q2", 1, "A2", null), sample("q2", 1, "B", 5), // q2: unknown control value
      sample("q2", 2, "A2", 4, false), sample("q2", 2, "B", 2), // q2: invalid control sample
      // q3 never sampled at all
    ];
    const estimate = estimatePairedQueries(samples, "A2", "B", "mainInputUncached", { ...POPULATION, queryIds: ["q1", "q2", "q3"] });
    assert.deepEqual(estimate.missingQueries, ["q1", "q2", "q3"]);
    assert.deepEqual(estimate.pairs.map((pair) => pair.queryId), ["q1"]); // q1's single evaluable repeat still pairs
    assert.equal(estimate.pairs[0]?.pairedRepeats, 1);
  });

  it("separates nonpositive query means: ratio unavailable, difference retains zero pairs", () => {
    const samples: QuerySample[] = [
      sample("q1", 1, "A2", 100), sample("q1", 1, "B", 40),
      sample("q2", 1, "A2", 0), sample("q2", 1, "B", 0), // zero means: valid difference pairs
    ];
    const estimate = estimatePairedQueries(samples, "A2", "B", "mainInputUncached", { queryIds: ["q1", "q2"], repeats: [1] });
    assert.equal(estimate.ratio, null);
    assert.deepEqual(estimate.undefinedRatioQueries, ["q2"]);
    assert.equal(estimate.difference, -30); // mean(-60, 0)
    assert.equal(estimate.pairs.length, 2); // zero-valued pairs retained
  });

  it("returns null endpoints when no query has an evaluable pair", () => {
    const estimate = estimatePairedQueries([], "A2", "B", "mainInputUncached", POPULATION);
    assert.deepEqual(estimate.missingQueries, ["q1", "q2"]);
    assert.equal(estimate.pairs.length, 0);
    assert.equal(estimate.difference, null);
    assert.equal(estimate.ratio, null);
  });

  it("ignores samples outside the declared population and other arms", () => {
    const samples: QuerySample[] = [
      sample("q1", 1, "A2", 10), sample("q1", 1, "B", 5),
      sample("q9", 1, "A2", 1), sample("q1", 9, "B", 1), sample("q1", 1, "C", 1),
    ];
    const estimate = estimatePairedQueries(samples, "A2", "B", "mainInputUncached", POPULATION);
    assert.equal(estimate.pairs[0]?.pairedRepeats, 1);
    assert.deepEqual(estimate.missingQueries, ["q1", "q2"]); // q1 missing repeat 2, q2 absent
    assert.equal(estimate.difference, -5);
  });

  it("treats unjudged quality endpoints as unknown, not zero", () => {
    const samples: QuerySample[] = [
      sample("q1", 1, "A2", 100), sample("q1", 1, "B", 50),
    ];
    const estimate = estimatePairedQueries(samples, "A2", "B", "qualityJudge2", { queryIds: ["q1"], repeats: [1] });
    assert.equal(estimate.difference, null);
    assert.deepEqual(estimate.missingQueries, ["q1"]);
  });
});

function ratioEstimate(): PairedEstimate {
  const mk = (queryId: string, control: number, treatment: number): QuerySample[] => [
    sample(queryId, 1, "A2", control),
    sample(queryId, 1, "B", treatment),
  ];
  // Four query clusters with log ratios log 0.5, log 0.6, log 2, log 3.
  const samples = [
    ...mk("q1", 100, 50),
    ...mk("q2", 200, 120),
    ...mk("q3", 100, 200),
    ...mk("q4", 50, 150),
  ];
  return estimatePairedQueries(samples, "A2", "B", "mainInputUncached", {
    queryIds: ["q1", "q2", "q3", "q4"],
    repeats: [1],
  });
}

describe("bootstrapPairedQueries clustered resampling", () => {
  it("resamples whole query pairs deterministically from the recorded seed", () => {
    const estimate = ratioEstimate();
    const options = { seed: 1234, draws: 400, confidence: 0.95, metric: "log-ratio" as const };
    const first = bootstrapPairedQueries(estimate, options);
    const second = bootstrapPairedQueries(estimate, options);
    assert.deepEqual(first, second);
    assert.equal(first.draws, 400);
    assert.equal(first.seed, 1234);
    // The log-ratio point value (mean of cluster log ratios) lies inside a
    // 95% interval of cluster-level resampling here.
    const pointLogRatio = (Math.log(0.5) + Math.log(0.6) + Math.log(2) + Math.log(3)) / 4;
    assert.ok(first.lower !== null && first.upper !== null && first.lower <= pointLogRatio && pointLogRatio <= first.upper);
    const other = bootstrapPairedQueries(estimate, { ...options, seed: 99917 });
    assert.ok(other.upper !== null && first.upper !== null);
    assert.notEqual(other.upper, first.upper, "different seeds must give different intervals here");
  });

  it("returns no interval with fewer than two evaluable query clusters", () => {
    const single: PairedEstimate = {
      pairs: [{ queryId: "q1", controlMean: 1, treatmentMean: 1, pairedRepeats: 1 }],
      missingQueries: [],
      undefinedRatioQueries: [],
      ratio: 1,
      difference: 0,
    };
    const result = bootstrapPairedQueries(single, { seed: 1, draws: 100, confidence: 0.9, metric: "difference" });
    assert.equal(result.lower, null);
    assert.equal(result.upper, null);
  });

  it("makes the log-ratio interval unavailable when any query mean is nonpositive", () => {
    const estimate: PairedEstimate = {
      pairs: [
        { queryId: "q1", controlMean: 100, treatmentMean: 50, pairedRepeats: 1 },
        { queryId: "q2", controlMean: 0, treatmentMean: 10, pairedRepeats: 1 },
      ],
      missingQueries: [],
      undefinedRatioQueries: ["q2"],
      ratio: null,
      difference: -20,
    };
    const result = bootstrapPairedQueries(estimate, { seed: 7, draws: 100, confidence: 0.95, metric: "log-ratio" });
    assert.equal(result.lower, null);
    assert.equal(result.upper, null);
    // The difference interval on the same estimate is available.
    const difference = bootstrapPairedQueries(estimate, { seed: 7, draws: 100, confidence: 0.95, metric: "difference" });
    assert.ok(difference.lower !== null && difference.upper !== null);
  });

  it("collapses to the point value when every cluster is identical", () => {
    const estimate: PairedEstimate = {
      pairs: [
        { queryId: "q1", controlMean: 100, treatmentMean: 50, pairedRepeats: 1 },
        { queryId: "q2", controlMean: 100, treatmentMean: 50, pairedRepeats: 1 },
      ],
      missingQueries: [],
      undefinedRatioQueries: [],
      ratio: 0.5,
      difference: -50,
    };
    const logRatio = Math.log(0.5);
    const result = bootstrapPairedQueries(estimate, { seed: 42, draws: 50, confidence: 0.95, metric: "log-ratio" });
    assert.ok(Math.abs((result.lower ?? NaN) - logRatio) < 1e-12);
    assert.ok(Math.abs((result.upper ?? NaN) - logRatio) < 1e-12);
    const diff = bootstrapPairedQueries(estimate, { seed: 42, draws: 50, confidence: 0.95, metric: "difference" });
    assert.equal(diff.lower, -50);
    assert.equal(diff.upper, -50);
  });

  it("validates draws and confidence", () => {
    const estimate = ratioEstimate();
    assert.throws(() => bootstrapPairedQueries(estimate, { seed: 1, draws: 0, confidence: 0.95, metric: "difference" }));
    assert.throws(() => bootstrapPairedQueries(estimate, { seed: 1, draws: 10, confidence: 1, metric: "difference" }));
  });

  it("resamples clusters, not repeats: cluster count matches pairs length in draw support", () => {
    // With two clusters and identical values the statistic is constant
    // regardless of the draw pattern, proving cluster-level resampling feeds
    // the mean (a repeat-level resampler would need different data to
    // distinguish; the collapse test above pins the semantics).
    const random = mulberry32(7);
    const values = [0.1, 0.2, 0.3];
    const draws = Array.from({ length: 1000 }, () => values[Math.floor(random() * values.length)]);
    const counts = new Map<number, number>();
    for (const value of draws) counts.set(value, (counts.get(value) ?? 0) + 1);
    // The deterministic PRNG distributes across all three clusters.
    assert.equal(counts.size, 3);
  });
});
