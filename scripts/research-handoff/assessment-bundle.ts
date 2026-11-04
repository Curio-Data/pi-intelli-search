// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AdequacyAssessment, RunRecord } from "./contracts.js";
import { digestObject, digestFile } from "./storage.js";

export interface AssessmentBundle {
  schemaVersion: 1;
  assessments: Array<{ runId: string; recordSha256: string; reviewEvidenceSha256: string; assessment: AdequacyAssessment }>;
}
/** Join later assessments in memory. Raw records remain immutable and independently reproducible. */
export async function applyAssessmentBundle(records: RunRecord[], path: string): Promise<RunRecord[]> {
  const bundle = JSON.parse(await readFile(path, "utf8")) as AssessmentBundle;
  if (bundle.schemaVersion !== 1 || !Array.isArray(bundle.assessments)) throw new Error("Invalid assessment bundle");
  const byId = new Map<string, RunRecord>();
  for (const record of records) {
    if (byId.has(record.manifest.runId)) throw new Error("Ambiguous run identity in assessment input");
    byId.set(record.manifest.runId, record);
  }
  const grades = new Map<string, AdequacyAssessment>();
  for (const entry of bundle.assessments) {
    const record = byId.get(entry.runId);
    if (!record || record.analysisError || entry.recordSha256 !== digestObject(record) || grades.has(entry.runId)) {
      throw new Error(`Assessment does not identify one intact retained record: ${entry.runId}`);
    }
    const review = entry.assessment?.review;
    if (!review?.evidencePath || !(await stat(resolve(dirname(path), review.evidencePath))).isFile()
      || await digestFile(resolve(dirname(path), review.evidencePath)) !== entry.reviewEvidenceSha256) {
      throw new Error(`Independent assessment review evidence is missing: ${entry.runId}`);
    }
    grades.set(entry.runId, structuredClone(entry.assessment));
  }
  return records.map(record => grades.has(record.manifest.runId)
    ? { ...record, adequacy: grades.get(record.manifest.runId) } : record);
}
