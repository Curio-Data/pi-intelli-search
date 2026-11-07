// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Offline administration only. Kept outside the frozen study implementation:
// this prepares typed review copies and a lock, never dispatches or writes a gate.
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { digestFile, digestObject, digestText, writeNewJson } from "./research-handoff/storage.ts";
import { PILOT_TOPICS, PILOT_RUBRICS } from "./research-handoff/pilot-config.ts";
import { assessPilotAnswerGate } from "./research-handoff/pilot-authority.ts";

const text = value => typeof value === "string" && value.trim().length > 0;
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const read = async path => JSON.parse(await readFile(path, "utf8"));

/** Lossless rationale encoding is the only permitted representation change. */
export function validateReview(input, expected, adjudication = false) {
  assert.ok(object(input), "Review must be an object");
  const review = structuredClone(input);
  for (const [key, value] of Object.entries(expected)) assert.equal(review[key], value, `Different ${key}`);
  assert.ok(text(review.reviewer), "Reviewer identity must be a nonempty string");
  assert.ok(text(review.lockedAt) && Number.isFinite(Date.parse(review.lockedAt)), "Invalid lock time");
  assert.equal(typeof review.materialUnsupportedClaim, "boolean", "Unsupported-claim judgement must be boolean");
  assert.ok(object(review.grades), "Missing grade matrix");
  assert.deepEqual(Object.keys(review.grades).sort(), [...PILOT_RUBRICS].sort(), "Different rubrics");
  for (const rubric of PILOT_RUBRICS) {
    assert.ok(object(review.grades[rubric]), `Missing ${rubric}`);
    assert.deepEqual(Object.keys(review.grades[rubric]).sort(), [...PILOT_TOPICS].sort(), "Different topics");
    for (const topic of PILOT_TOPICS) {
      const cell = review.grades[rubric][topic];
      assert.ok(object(cell), `Missing ${rubric}/${topic}`);
      assert.equal(typeof cell.pass, "boolean", `Missing judgement: ${rubric}/${topic}`);
      assert.ok(text(cell.reasons), `Reasons must be text: ${rubric}/${topic}`);
      assert.ok(Array.isArray(cell.sourceRefs) && cell.sourceRefs.length > 0 && cell.sourceRefs.every(text),
        `Source references must be nonempty strings: ${rubric}/${topic}`);
    }
  }
  if (adjudication) {
    assert.equal(typeof review.resolvesAsPass, "boolean", "Missing adjudication verdict");
    assert.ok(text(review.recordedAt) && Number.isFinite(Date.parse(review.recordedAt)), "Invalid adjudication time");
    if (object(review.rationale)) review.rationale = JSON.stringify(review.rationale, null, 2);
    assert.ok(text(review.rationale), "Rationale must be text or a JSON object");
    if (object(input.rationale)) assert.deepEqual(JSON.parse(review.rationale), input.rationale);
  }
  return review;
}

/** Relative input paths resolve from process.cwd(), not from the job file. */
export async function prepareReviews(job, output) {
  assert.ok(Array.isArray(job.reviewPaths) && job.reviewPaths.length === 2, "Exactly two initial reviews required");
  const record = await read(job.recordPath);
  const frozen = await read(job.frozenPath);
  const expected = { runIdSha256: digestText(record.manifest.runId), recordSha256: digestObject(record),
    answerSha256: digestText(record.finalAnswer ?? ""), corpusSha256: frozen.digest, rubricSha256: await digestFile(job.protocolPath) };
  assert.equal(record.manifest.corpusSha256, frozen.digest, "Record and corpus differ");
  assert.equal(record.manifest.protocolSha256, expected.rubricSha256, "Record and rubric differ");
  const paths = [...job.reviewPaths, ...(job.adjudicationPath ? [job.adjudicationPath] : [])];
  const prepared = await Promise.all(paths.map(async (path, index) => {
    const raw = await readFile(path, "utf8");
    const original = JSON.parse(raw);
    return { path: resolve(path), originalSha256: digestText(raw), original,
      value: validateReview(original, expected, index === 2) };
  }));
  assert.notEqual(prepared[0].value.reviewer, prepared[1].value.reviewer, "Initial reviewers must differ");
  if (prepared[2]) {
    assert.ok(prepared.slice(0, 2).every(p => p.value.reviewer !== prepared[2].value.reviewer), "Adjudicator must be fresh");
    assert.ok(prepared.slice(0, 2).every(p => Date.parse(p.value.lockedAt) < Date.parse(prepared[2].value.recordedAt)),
      "Adjudication must follow both locked grades");
  }
  // No output is created until all input types and bindings validate.
  const directory = resolve(output);
  await mkdir(directory); // existing outputs, including partial ones, are never replaced
  const copies = [];
  for (const [index, item] of prepared.entries()) {
    const path = join(directory, index === 2 ? "adjudication.json" : `grade-${index + 1}.json`);
    writeNewJson(path, item.value);
    copies.push({ path, sha256: await digestFile(path) });
    assert.equal(await digestFile(item.path), item.originalSha256, "Original review changed during preparation");
  }
  const lockPath = join(directory, "assessment-lock.json");
  writeNewJson(lockPath, { schemaVersion: 1, kind: "pilot-answer-assessment-lock", runId: record.manifest.runId,
    reviews: copies.slice(0, 2), ...(copies[2] ? { adjudication: copies[2] } : {}) });
  const assessment = await assessPilotAnswerGate(lockPath, record, expected.corpusSha256, expected.rubricSha256);
  const result = { schemaVersion: 1, kind: "offline-review-preflight", lockPath, assessment,
    originals: prepared.map(p => ({ path: p.path, sha256: p.originalSha256 })),
    rationaleNormalised: !!prepared[2] && object(prepared[2].original.rationale),
    gateWritten: false, liveAuthority: false };
  writeNewJson(join(directory, "preflight.json"), result);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [job, output, extra] = process.argv.slice(2);
  if (!job || !output || extra) throw new Error("Usage: node --import tsx scripts/handoff-review-preflight.mjs <job.json> <new-directory>");
  console.log(JSON.stringify(await prepareReviews(await read(job), output), null, 2));
}
