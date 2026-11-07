// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, writeFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { prepareReviews, validateReview } from "../scripts/handoff-review-preflight.mjs";
import { digestFile, digestObject, digestText } from "../scripts/research-handoff/storage.ts";
import { PILOT_TOPICS, PILOT_RUBRICS } from "../scripts/research-handoff/pilot-config.ts";

const expected = { runIdSha256: "run", recordSha256: "record", answerSha256: "answer", corpusSha256: "corpus", rubricSha256: "rubric" };
function grade(reviewer, pass = true, bindings = expected) {
  return { ...bindings, reviewer, lockedAt: "2026-11-07T10:00:00Z", materialUnsupportedClaim: false,
    grades: Object.fromEntries(PILOT_RUBRICS.map(r => [r, Object.fromEntries(PILOT_TOPICS.map(t => [t,
      { pass, reasons: "Source-cited judgement.", sourceRefs: ["captured-page:1"] }]))])) };
}

test("normalisation is lossless and changes no judgement or input", () => {
  const input = { ...grade("third"), resolvesAsPass: true, recordedAt: "2026-11-07T10:01:00Z",
    rationale: { summary: "narrow pass", disputes: [{ criterion: "setup", reason: "Source establishes it." }] } };
  const original = structuredClone(input);
  const normal = validateReview(input, expected, true);
  assert.deepEqual(input, original);
  assert.deepEqual(JSON.parse(normal.rationale), input.rationale);
  assert.deepEqual({ ...normal, rationale: input.rationale }, input);
});

test("rejects ungraded, wrong-type, missing-source and changed-binding records", () => {
  for (const mutate of [
    g => { g.recordSha256 = "different"; },
    g => { g.materialUnsupportedClaim = null; },
    g => { g.lockedAt = "tomorrow"; },
    g => { g.grades[PILOT_RUBRICS[0]][PILOT_TOPICS[0]].pass = "true"; },
    g => { g.grades[PILOT_RUBRICS[0]][PILOT_TOPICS[0]].reasons = {}; },
    g => { g.grades[PILOT_RUBRICS[0]][PILOT_TOPICS[0]].sourceRefs = [null]; },
    g => { g.grades.extra = {}; },
  ]) {
    const input = grade("first"); mutate(input);
    assert.throws(() => validateReview(input, expected));
  }
});

async function fixture() {
  const scratch = resolve(".tmp/review-preflight-tests"); await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, "case-"));
  const protocolPath = join(directory, "rubric.md"); await writeFile(protocolPath, "Frozen test rubric\n");
  const record = { manifest: { runId: "fixture", corpusSha256: "corpus", protocolSha256: await digestFile(protocolPath) }, finalAnswer: "Answer" };
  const bindings = { runIdSha256: digestText("fixture"), recordSha256: digestObject(record), answerSha256: digestText("Answer"),
    corpusSha256: "corpus", rubricSha256: await digestFile(protocolPath) };
  const save = async (name, value) => { const p = join(directory, name); await writeFile(p, JSON.stringify(value)); return p; };
  const job = { recordPath: await save("record.json", record), frozenPath: await save("frozen.json", { digest: "corpus" }), protocolPath,
    reviewPaths: [await save("first.json", grade("first", true, bindings)), await save("second.json", grade("second", true, bindings))] };
  return { directory, job, bindings, save };
}

test("prepares passing lock without writing a scientific gate or modifying originals", async () => {
  const f = await fixture(); const before = await Promise.all(f.job.reviewPaths.map(digestFile));
  const result = await prepareReviews(f.job, join(f.directory, "prepared"));
  assert.equal(result.assessment.passed, true); assert.equal(result.gateWritten, false); assert.equal(result.liveAuthority, false);
  assert.deepEqual(await Promise.all(f.job.reviewPaths.map(digestFile)), before);
  await assert.rejects(access(join(f.directory, "pilot-baseline-gate.json")));
  await assert.rejects(prepareReviews(f.job, join(f.directory, "prepared")), /EEXIST/);
});

test("two failing reviewers stay failed; no favourable adjudication overrides them", async () => {
  const f = await fixture();
  for (const [i, path] of f.job.reviewPaths.entries()) await writeFile(path, JSON.stringify(grade(`reviewer-${i}`, false, f.bindings)));
  f.job.adjudicationPath = await f.save("adjudication.json", { ...grade("third", true, f.bindings),
    resolvesAsPass: true, recordedAt: "2026-11-07T10:01:00Z", rationale: { summary: "Pass" } });
  const result = await prepareReviews(f.job, join(f.directory, "prepared"));
  assert.equal(result.assessment.passed, false);
  assert.deepEqual(result.assessment.problems, ["Both reviewers failed the answer"]);
});

test("object rationale works through the frozen evaluator after lossless preparation", async () => {
  const f = await fixture();
  await writeFile(f.job.reviewPaths[0], JSON.stringify(grade("first", false, f.bindings)));
  f.job.adjudicationPath = await f.save("adjudication.json", { ...grade("third", true, f.bindings),
    resolvesAsPass: true, recordedAt: "2026-11-07T10:01:00Z", rationale: { summary: "Pass", detail: ["A", "B"] } });
  const hash = await digestFile(f.job.adjudicationPath);
  const result = await prepareReviews(f.job, join(f.directory, "prepared"));
  assert.equal(result.rationaleNormalised, true); assert.equal(result.assessment.passed, true); assert.equal(result.assessment.adjudicated, true);
  assert.equal(await digestFile(f.job.adjudicationPath), hash);
});

test("invalid field types fail before an output directory is created", async () => {
  const f = await fixture(); const bad = JSON.parse(await readFile(f.job.reviewPaths[0], "utf8"));
  bad.reviewer = {}; await writeFile(f.job.reviewPaths[0], JSON.stringify(bad));
  const output = join(f.directory, "prepared"); await assert.rejects(prepareReviews(f.job, output), /Reviewer identity/);
  await assert.rejects(access(output));
});

test("rejects reviewer identity, chronology, rationale and job-binding mistakes before writing", async () => {
  const mutations = [
    async f => { f.job.reviewPaths.pop(); },
    async f => { await writeFile(f.job.reviewPaths[1], JSON.stringify(grade("first", true, f.bindings))); },
    async f => { f.adjudication.reviewer = "first"; },
    async f => { f.adjudication.recordedAt = "2026-11-07T09:59:00Z"; },
    async f => { f.adjudication.rationale = ["not a rationale object"]; },
    async f => { await writeFile(f.job.frozenPath, JSON.stringify({ digest: "different" })); },
  ];
  for (const mutate of mutations) {
    const f = await fixture();
    f.adjudication = { ...grade("third", true, f.bindings), resolvesAsPass: true,
      recordedAt: "2026-11-07T10:01:00Z", rationale: { summary: "Pass" } };
    await mutate(f);
    f.job.adjudicationPath = await f.save("adjudication.json", f.adjudication);
    const output = join(f.directory, "prepared");
    await assert.rejects(prepareReviews(f.job, output));
    await assert.rejects(access(output));
  }
});
