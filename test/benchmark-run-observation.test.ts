// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { sha256Text } from "../scripts/benchmarks/canonical.js";
import {
  InvalidRunObservationError,
  appendRunObservation,
  validateRunObservation,
} from "../scripts/benchmarks/run-observation.js";
import { sampleRunObservation, removeDir, scratchDir } from "../scripts/benchmarks/testing.js";

describe("run observation validation", () => {
  it("accepts a structurally valid record", () => {
    assert.doesNotThrow(() => validateRunObservation(sampleRunObservation()));
  });

  it("rejects malformed identity, hashes and outcome fields", () => {
    assert.throws(() => validateRunObservation(sampleRunObservation({ runId: "" })), InvalidRunObservationError);
    assert.throws(() => validateRunObservation(sampleRunObservation({ methodSha256: "nothex" })), InvalidRunObservationError);
    assert.throws(() => validateRunObservation(sampleRunObservation({ status: "great" as never })), InvalidRunObservationError);
    assert.throws(
      () => validateRunObservation(sampleRunObservation({ replayValidity: "maybe" as never })),
      InvalidRunObservationError,
    );
    assert.throws(() => validateRunObservation(sampleRunObservation({ repeat: 0 })), InvalidRunObservationError);
    assert.throws(
      () => validateRunObservation(sampleRunObservation({ artifacts: [{ path: "x", sha256: "zz" }] })),
      InvalidRunObservationError,
    );
  });

  it("allows a null fixture hash only for not-replay runs", () => {
    assert.doesNotThrow(() => validateRunObservation(sampleRunObservation({ fixtureSha256: null })));
    assert.throws(() => validateRunObservation(sampleRunObservation({ fixtureSha256: "bad" })), InvalidRunObservationError);
  });

  it("requires error text for failed/aborted runs and rerunReason with rerunOf (L1)", () => {
    assert.throws(() => validateRunObservation(sampleRunObservation({ status: "failed" })), InvalidRunObservationError);
    assert.throws(() => validateRunObservation(sampleRunObservation({ status: "aborted" })), InvalidRunObservationError);
    assert.doesNotThrow(() => validateRunObservation(sampleRunObservation({ status: "failed", error: "pipeline 429" })));
    assert.throws(
      () => validateRunObservation(sampleRunObservation({ rerunOf: "run-synthetic-1" })),
      InvalidRunObservationError,
    );
    assert.doesNotThrow(() =>
      validateRunObservation(sampleRunObservation({ rerunOf: "run-synthetic-1", rerunReason: "technical: provider 529" })),
    );
  });

  it("bounds the seed to the unsigned 32-bit range (R3)", () => {
    assert.throws(
      () => validateRunObservation(sampleRunObservation({ seed: 2 ** 32 })),
      InvalidRunObservationError,
    );
    assert.doesNotThrow(() => validateRunObservation(sampleRunObservation({ seed: 2 ** 32 - 1 })));
  });
});

describe("appendRunObservation", () => {
  it("appends immutable observations without rewriting history", async () => {
    const dir = await scratchDir("runs");
    try {
      const completed = sampleRunObservation();
      const first = await appendRunObservation(dir, completed);
      assert.equal(first.path, join(dir, "observations.ndjson"));

      const failed = sampleRunObservation({
        runId: "run-synthetic-2",
        status: "failed",
        error: "search stage exhausted retries",
      });
      const rerun = sampleRunObservation({
        runId: "run-synthetic-3",
        rerunOf: "run-synthetic-2",
        rerunReason: "technical: provider 529",
        order: 2,
        repeat: 2,
      });
      await appendRunObservation(dir, failed);
      await appendRunObservation(dir, rerun);

      const text = await readFile(first.path, "utf8");
      const lines = text.trim().split("\n");
      assert.equal(lines.length, 3);
      // The returned digest identifies exactly the appended first line.
      assert.equal(first.sha256, sha256Text(`${lines[0]}\n`));
      const firstAgain = JSON.parse(lines[0]!) as { runId: string; status: string };
      assert.equal(firstAgain.runId, "run-synthetic-1");
      assert.equal(firstAgain.status, "completed");
      const failedAgain = JSON.parse(lines[1]!) as { status: string; error: string };
      assert.equal(failedAgain.status, "failed"); // failures retained, never relabelled
      const rerunAgain = JSON.parse(lines[2]!) as { rerunOf: string; rerunReason: string };
      assert.equal(rerunAgain.rerunOf, "run-synthetic-2");
      // Canonical key order: sorted, stable across appends.
      assert.ok(lines[0]!.startsWith('{"arm"'));
    } finally {
      await removeDir(dir);
    }
  });

  it("rejects a duplicate runId already recorded in the file (L1)", async () => {
    const dir = await scratchDir("runs");
    try {
      await appendRunObservation(dir, sampleRunObservation({ runId: "run-dup" }));
      await assert.rejects(
        () => appendRunObservation(dir, sampleRunObservation({ runId: "run-dup", status: "failed", error: "x" })),
        InvalidRunObservationError,
      );
      // A technical rerun under a NEW runId with rerunOf is the valid path.
      await appendRunObservation(dir, sampleRunObservation({ runId: "run-dup-2", rerunOf: "run-dup", rerunReason: "technical: stall" }));
      const lines = (await readFile(join(dir, "observations.ndjson"), "utf8")).trim().split("\n");
      assert.equal(lines.length, 2);
    } finally {
      await removeDir(dir);
    }
  });

  it("rejects an invalid record before writing anything", async () => {
    const dir = await scratchDir("runs");
    try {
      await assert.rejects(
        () => appendRunObservation(dir, sampleRunObservation({ corpusSha256: "short" })),
        InvalidRunObservationError,
      );
      await assert.rejects(() => readFile(join(dir, "observations.ndjson"), "utf8"), Error);
    } finally {
      await removeDir(dir);
    }
  });
});
