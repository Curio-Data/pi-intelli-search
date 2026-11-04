// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyAssessmentBundle, type AssessmentBundle } from "../scripts/research-handoff/assessment-bundle.js";
import { digestFile, digestObject, unavailableRecord, writeNewJson } from "../scripts/research-handoff/storage.js";

test("handoff assessments bind raw records and reviewer evidence without rewriting either", async () => {
  const root = await mkdtemp(join(tmpdir(), "handoff-assessments-"));
  try {
    const record = unavailableRecord("new-synthetic-record", "synthetic", "synthetic fixture");
    delete record.analysisError;
    const rawPath = join(root, "record.json"), reviewPath = join(root, "review.md"), bundlePath = join(root, "assessments.json");
    writeNewJson(rawPath, record); await writeFile(reviewPath, "# Synthetic Review\n");
    const rawBefore = await readFile(rawPath, "utf8");
    const bundle: AssessmentBundle = { schemaVersion: 1, assessments: [{ runId: record.manifest.runId,
      recordSha256: digestObject(record), reviewEvidenceSha256: await digestFile(reviewPath),
      assessment: { assessor: "synthetic-coordinator", criteria: [], materialUnsupportedClaim: true, evidenceAccessible: false,
        review: { reviewer: "synthetic-independent", agrees: true, evidencePath: "review.md", rationale: "Fixture only", sourceRefs: ["fixture-source"] } } }] };
    writeNewJson(bundlePath, bundle);
    const assessed = await applyAssessmentBundle([record], bundlePath);
    assert.equal(record.adequacy, undefined);
    assert.equal(assessed[0].adequacy?.review?.reviewer, "synthetic-independent");
    assert.equal(await readFile(rawPath, "utf8"), rawBefore);
    await writeFile(reviewPath, "Changed review; the bound hash must fail\n");
    await assert.rejects(applyAssessmentBundle([record], bundlePath), /review evidence/);
    const changed = { ...record, finalAnswer: "Different answer" };
    await assert.rejects(applyAssessmentBundle([changed], bundlePath), /intact retained record/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
