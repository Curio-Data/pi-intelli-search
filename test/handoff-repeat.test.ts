// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// rh-v7 single repeat: protocol agreement, owner direction, prior settlements,
// retained-corpus integrity, root and identity refusal, byte-for-byte import
// without recapture, candidate admission after the collected baseline (not its
// gate), grades after the pair, cumulative settlement and unchanged rh-v6
// behaviour. No test dispatches live work, fetches a page or reads credentials.

import assert from "node:assert/strict";
import { test } from "node:test";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RH7_PILOT, RH7_PROTOCOL_PATH, RH7_PROTOCOL_REVISION, RH7_SCOPE, RH7_OWNER_DIRECTION_PATH, RH7_OWNER_DIRECTION_SHA256, RH7_SERIES_ROOT,
  RH7_BUDGET, RH7_CORPUS_REUSE, RH7_PRIOR_SETTLEMENTS, RH7_PRIOR_REPORTED_NANO_USD, RH7_COMBINED_CEILING_NANO_USD,
  pilotDefinitionFor, verifyPriorSettlements, verifyRepeatDirection, verifyReusedCorpus,
} from "../scripts/research-handoff/pilot-repeat.js";
import { RH6_PILOT, RH6_PROTOCOL_PATH, RH6_SCOPE, RH6_PROTOCOL_REVISION, RH6_SERIES_ROOT, RH6_OWNER_DIRECTION_PATH, rh6Params, rh6Settings } from "../scripts/research-handoff/pilot-continuation.js";
import { PILOT_SERIES_ROOT, PILOT_RUBRICS, PILOT_TOPICS, RH5_PILOT, pilotRunId, pilotTaskPrompt } from "../scripts/research-handoff/pilot-config.js";
import { verifyOwnerDecision, verifyPilotImplementation, markPilotDispatch } from "../scripts/research-handoff/pilot-authority.js";
import {
  pilotObserve, pilotAdmit, pilotCapture, pilotImportCorpus, pilotQualify, pilotRun, pilotGate, pilotSettle, syntheticRegistry, assertPilotRates,
  verifyPaidPrerequisites,
} from "../scripts/research-handoff/pilot.js";
import { SYNTHETIC_MODEL_ID, SYNTHETIC_PROVIDER_ID } from "../scripts/research-handoff/host.js";
import { assertLiveEvidenceRoot, executeWorker, REPO_ROOT, type WorkerConfig } from "../scripts/research-handoff/runner.js";
import { digestFile, digestObject, digestText, sourceIdentity, writeNewJson } from "../scripts/research-handoff/storage.js";
import type { PilotSyntheticScenario, RunRecord } from "../scripts/research-handoff/contracts.js";
import type { CatalogueModel } from "../scripts/research-handoff/pilot.js";

const CATALOGUE: { data: CatalogueModel[] } = { data: [
  { id: "perplexity/sonar", context_length: 127072, pricing: { prompt: "0.000001", completion: "0.000001", web_search: "0.005" } },
  { id: "minimax/minimax-m3", context_length: 1048576, pricing: { prompt: "0.0000003", completion: "0.0000012" } }] };

test("rh-v7 constants transcribe the repeat protocol and keep every rh-v6 setting, prompt and rubric paragraph", async () => {
  const text = await readFile(RH7_PROTOCOL_PATH, "utf8");
  assert.match(text, new RegExp(`Revision: \`${RH7_PROTOCOL_REVISION}\``));
  assert.ok(text.includes(RH7_OWNER_DIRECTION_SHA256) && text.includes(RH7_CORPUS_REUSE.sha256) && text.includes(RH7_CORPUS_REUSE.digest));
  assert.ok(text.includes("evidence/benchmarks/research-handoff/20261107T195837Z-rh-v7-once"));
  assert.equal(await digestFile(RH7_OWNER_DIRECTION_PATH), RH7_OWNER_DIRECTION_SHA256);
  assert.equal(digestObject(RH7_PILOT.settings()), digestObject(rh6Settings()));
  assert.deepEqual(RH7_PILOT.params(), rh6Params());
  assert.equal(RH7_PILOT.sourcePolicy, RH6_PILOT.sourcePolicy);
  for (const arm of ["baseline", "candidate"] as const) for (const opening of ["paid", "observer"] as const) {
    assert.equal(pilotTaskPrompt(arm, RH7_PILOT.params(), opening), pilotTaskPrompt(arm, rh6Params(), opening));
  }
  // Rubric definitions, topic table, failure rules and the locked answer gate are byte-identical rh-v6 paragraphs.
  const v6 = (await readFile(RH6_PROTOCOL_PATH, "utf8")).split("## Frozen Assessment Criteria\n\n")[1].split("## Gate Sequence")[0].trim().split("\n\n");
  const copied = [v6[2], v6[3], v6[4], v6[6]];
  assert.match(copied[0], /^Two rubrics apply independently/);
  assert.match(copied[3], /^For each paid answer, two fresh reviewers/);
  const v7 = text.split("## Frozen Assessment Criteria\n\n")[1].split("## Gate Sequence")[0];
  for (const paragraph of copied) assert.ok(v7.includes(paragraph), paragraph.slice(0, 60));
  const identity = v6[8].slice(v6[8].indexOf("Record identity uses"), v6[8].indexOf("Corpus identity"));
  assert.ok(identity.length > 80 && v7.includes(identity));
  assert.ok(v7.includes("`rh7-review-inputs`") && !v7.includes("`rh6-review-inputs`"));
  assert.match(text, /## Operational Cleanliness and Quality/);
  assert.match(text, /A configured retry or quota refusal counts as an incident/);
  assert.equal(RH7_BUDGET.captureNanoUsd + RH7_BUDGET.qualificationNanoUsd + RH7_BUDGET.baselinePilotNanoUsd + RH7_BUDGET.candidatePilotNanoUsd, RH7_BUDGET.totalNanoUsd);
  assert.equal(RH7_PRIOR_SETTLEMENTS.reduce((sum, item) => sum + item.reportedNanoUsd, 0), RH7_PRIOR_REPORTED_NANO_USD);
  assert.ok(RH7_PRIOR_REPORTED_NANO_USD + RH7_BUDGET.totalNanoUsd <= RH7_COMBINED_CEILING_NANO_USD);
  assert.ok(12 * RH7_BUDGET.m3AttemptNanoUsd <= RH7_BUDGET.baselinePilotNanoUsd);
  // The new frozen protocol joins the source identity.
  const files = (await sourceIdentity(REPO_ROOT)).files;
  assert.equal(files["docs/experiments/research-handoff/REPEAT-PROTOCOL.md"], await digestFile(RH7_PROTOCOL_PATH));
  assert.equal(pilotDefinitionFor(RH7_PROTOCOL_REVISION), RH7_PILOT);
  assert.equal(pilotDefinitionFor(RH6_PROTOCOL_REVISION), RH6_PILOT);
  assert.throws(() => pilotDefinitionFor("rh-v8"), /Unknown pilot revision/);
  assert.notEqual(RH7_SERIES_ROOT, RH6_SERIES_ROOT);
});

test("rh-v7 owner direction binds scope, counts, envelope, corpus, grading, both prior settlements and a new root", async () => {
  await assert.doesNotReject(verifyOwnerDecision(RH7_OWNER_DIRECTION_PATH, { definition: RH7_PILOT }));
  await assert.rejects(verifyOwnerDecision(RH7_OWNER_DIRECTION_PATH, { definition: RH6_PILOT }), /recorded digest/);
  await assert.rejects(verifyOwnerDecision(RH6_OWNER_DIRECTION_PATH, { definition: RH7_PILOT }), /recorded digest/);
  const root = await mkdtemp(join(tmpdir(), "handoff-rh7-direction-"));
  try {
    const direction = JSON.parse(await readFile(RH7_OWNER_DIRECTION_PATH, "utf8"));
    const changes = [
      { scope: RH6_SCOPE }, { recordType: "owner-directed-pilot-completion-not-live-acceptance" },
      { designatedSeriesRoot: RH6_SERIES_ROOT }, { designatedSeriesRoot: PILOT_SERIES_ROOT },
      { operationLimits: { ...direction.operationLimits, commonCaptures: 1 } }, { operationLimits: { ...direction.operationLimits, recaptures: 1 } },
      { operationLimits: { ...direction.operationLimits, replacementConversations: 1 } }, { operationLimits: { ...direction.operationLimits, paidEndToEndConversations: 4 } },
      { profile: { ...direction.profile, maxUrls: 6 } },
      { coordinatorAllocationNanoUsd: { ...direction.coordinatorAllocationNanoUsd, commonCapture: 810_000_000 } },
      { coordinatorAllocationNanoUsd: { ...direction.coordinatorAllocationNanoUsd, baselinePilot: 4_100_000_000 } },
      { maximumExperimentEnvelopeNanoUsd: 9_994_300_000 }, { priorReportedNanoUsd: 5_700_000 }, { priorUnknownNanoUsd: 1 },
      { priorSettlements: direction.priorSettlements.slice(1) },
      { priorSettlements: [direction.priorSettlements[0], { ...direction.priorSettlements[1], sha256: "0".repeat(64) }] },
      { reusedCorpus: { ...direction.reusedCorpus, sha256: "0".repeat(64) } }, { reusedCorpus: { ...direction.reusedCorpus, sourceSeries: "rh-v5-pilot-1" } },
      { grading: "baseline-before-candidate" }, { order: ["candidate", "baseline"] }, { approved: false },
    ];
    for (const [index, change] of changes.entries()) {
      const path = join(root, `changed-${index}.json`);
      await writeFile(path, JSON.stringify({ ...direction, designatedSeriesRoot: root, ...change }));
      await assert.rejects(verifyOwnerDecision(path, { definition: RH7_PILOT, designatedRoot: change.designatedSeriesRoot ?? root, ownerDecisionSha256: await digestFile(path) }),
        /does not cover/, JSON.stringify(change));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rh-v7 prior settlements and the retained corpus are verified by bytes, closure, liabilities, digest, settings and derivation", async () => {
  assert.equal(await verifyPriorSettlements(RH7_PRIOR_SETTLEMENTS), RH7_PRIOR_REPORTED_NANO_USD);
  const { frozen, provenance } = await verifyReusedCorpus();
  assert.equal(frozen.digest, RH7_CORPUS_REUSE.digest);
  assert.equal(provenance.selectedPages, 12);
  assert.equal(provenance.sourceFileSha256, RH7_CORPUS_REUSE.sha256);
  assert.equal(provenance.sourceSettlementSha256, RH7_PRIOR_SETTLEMENTS[1].sha256);
  const root = await mkdtemp(join(tmpdir(), "handoff-rh7-integrity-"));
  try {
    // A settlement with changed bytes, or an open or held one, is refused even when its digest is re-recorded.
    const settlement = JSON.parse(await readFile(RH7_PRIOR_SETTLEMENTS[1].path, "utf8"));
    for (const [index, change] of [{ closed: false }, { unknownNanoUsd: 1 }, { activeNanoUsd: 1 }, { overrunNanoUsd: 1 }, { reportedNanoUsd: 1 }].entries()) {
      const path = join(root, `settlement-${index}.json`);
      await writeFile(path, JSON.stringify({ ...settlement, ...change }));
      await assert.rejects(verifyPriorSettlements([{ ...RH7_PRIOR_SETTLEMENTS[1], path, sha256: await digestFile(path) }]), /not closed/, JSON.stringify(change));
    }
    await assert.rejects(verifyPriorSettlements([{ ...RH7_PRIOR_SETTLEMENTS[1], sha256: "0".repeat(64) }]), /bytes changed/);
    // A corpus file with different bytes (same content re-serialised) or a different corpus is refused.
    const reserialised = join(root, "frozen-reserialised.json");
    await writeFile(reserialised, JSON.stringify(frozen));
    await assert.rejects(verifyReusedCorpus({ ...RH7_PILOT, corpusReuse: { ...RH7_CORPUS_REUSE, path: reserialised } }), /file digest/);
    await assert.rejects(verifyReusedCorpus({ ...RH7_PILOT, corpusReuse: { ...RH7_CORPUS_REUSE, path: reserialised, sha256: await digestFile(reserialised), digest: "0".repeat(64) } }), /corpus digest/);
    await assert.rejects(verifyReusedCorpus({ ...RH7_PILOT, settings: () => ({ ...rh6Settings(), maxUrls: 6 }) }), /settings or parameters/);
    await assert.rejects(verifyReusedCorpus({ ...RH7_PILOT, corpusReuse: { ...RH7_CORPUS_REUSE, sourceRoot: root } }), /unreadable|accepted capture/);
    await assert.rejects(verifyReusedCorpus(RH6_PILOT), /does not reuse/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function rh7AuthorityFixture() {
  const root = await mkdtemp(join(tmpdir(), "handoff-rh7-authority-"));
  const direction = JSON.parse(await readFile(RH7_OWNER_DIRECTION_PATH, "utf8"));
  const ownerPath = join(root, "owner-direction.json");
  await writeFile(ownerPath, JSON.stringify({ ...direction, designatedSeriesRoot: root }));
  const ownerSha = await digestFile(ownerPath);
  const technical = join(root, "technical.md"), prose = join(root, "prose.md");
  await writeFile(technical, "technical review\n"); await writeFile(prose, "prose review\n");
  const acceptance = {
    schemaVersion: 1, kind: "pilot-implementation-acceptance", acceptedBy: "coordinator", accepted: true,
    scope: RH7_SCOPE, protocolRevision: RH7_PROTOCOL_REVISION, seriesRoot: root,
    ownerDecisionPath: ownerPath, ownerDecisionSha256: ownerSha, codeSha256: (await sourceIdentity(REPO_ROOT)).digest,
    protocolSha256: await digestFile(RH7_PROTOCOL_PATH), technicalReviewPath: technical, technicalReviewSha256: await digestFile(technical),
    proseReviewPath: prose, proseReviewSha256: await digestFile(prose),
  };
  const acceptancePath = join(root, "implementation-acceptance.json");
  writeNewJson(acceptancePath, acceptance);
  const seams = { definition: RH7_PILOT, designatedRoot: root, ownerDecisionSha256: ownerSha, rootCheck: async () => {} };
  const bound = async (kind: string, extra: Record<string, unknown> = {}) => ({ kind, accepted: true, seriesRoot: root,
    implementationAcceptanceSha256: await digestFile(acceptancePath), ownerDecisionSha256: ownerSha, ...extra });
  return { root, acceptance, acceptancePath, seams, bound };
}

test("rh-v7 authority refuses rh-v6 acceptances, both closed roots, other roots and the real root without its own acceptance", async () => {
  const { root, acceptance, acceptancePath, seams } = await rh7AuthorityFixture();
  try {
    assert.equal((await verifyPilotImplementation(acceptancePath, seams)).definition, RH7_PILOT);
    await assert.rejects(verifyPilotImplementation(acceptancePath, { ...seams, definition: RH6_PILOT }), /Not an accepted rh-v6-pilot-1/);
    const v6 = join(root, "v6-acceptance.json");
    writeNewJson(v6, { ...acceptance, scope: RH6_SCOPE, protocolRevision: RH6_PROTOCOL_REVISION });
    await assert.rejects(verifyPilotImplementation(v6, seams), /Not an accepted rh-v7-once-1/);
    for (const [index, closed] of [RH6_SERIES_ROOT, PILOT_SERIES_ROOT].entries()) {
      const path = join(root, `closed-${index}.json`);
      writeNewJson(path, { ...acceptance, seriesRoot: closed });
      await assert.rejects(verifyPilotImplementation(path, { ...seams, designatedRoot: closed }), /cannot be reopened/);
    }
    await assert.rejects(verifyPilotImplementation(acceptancePath, { definition: RH7_PILOT }), /designated/, "production binds only the real rh-v7 root");
    await assert.rejects(assertLiveEvidenceRoot(RH7_SERIES_ROOT), /rh-v7 repeat root accepts only rh-v7/);
    assert.doesNotThrow(() => assertPilotRates(CATALOGUE, RH7_PILOT), "a zero capture allowance fits a reuse series");
    assert.throws(() => assertPilotRates(CATALOGUE, { ...RH6_PILOT, budget: { ...RH6_PILOT.budget, captureNanoUsd: 0 } }), /allocation arithmetic/, "rh-v6 still needs its capture allowance");
    assert.throws(() => assertPilotRates(CATALOGUE, { ...RH7_PILOT, budget: { ...RH7_BUDGET, captureNanoUsd: 1, totalNanoUsd: RH7_BUDGET.totalNanoUsd + 1 } }), /allocation arithmetic/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("paid prerequisites: rh-v7 needs the import and a collected baseline; rh-v6 still needs its passed baseline gate", async () => {
  const v7 = await rh7AuthorityFixture();
  try {
    const authority = await verifyPilotImplementation(v7.acceptancePath, v7.seams);
    writeNewJson(join(v7.root, "financial-admission-receipt.json"), await v7.bound("pilot-financial-admission"));
    // A capture receipt never stands in for the import.
    await mkdir(join(v7.root, "capture"));
    writeNewJson(join(v7.root, "capture", "outcome.json"), await v7.bound("pilot-capture-outcome", { corpusSha256: RH7_CORPUS_REUSE.digest, sonarReportedCharge: true }));
    await assert.rejects(verifyPaidPrerequisites(authority, "baseline", "unused"), /pilot-corpus-import-outcome is missing/);
    await mkdir(join(v7.root, "corpus-import"));
    await copyFile(RH7_CORPUS_REUSE.path, join(v7.root, "corpus-import", "frozen-inputs.json"));
    writeNewJson(join(v7.root, "corpus-import", "outcome.json"), await v7.bound("pilot-corpus-import-outcome",
      { corpusSha256: RH7_CORPUS_REUSE.digest, frozenFileSha256: RH7_CORPUS_REUSE.sha256, newSearchChargeNanoUsd: 0 }));
    const review = join(v7.root, "review.md");
    await writeFile(review, "review\n");
    const corpus = join(v7.root, "corpus-acceptance.json");
    writeNewJson(corpus, await v7.bound("pilot-corpus-acceptance", { corpusSha256: RH7_CORPUS_REUSE.digest, reviewer: "r", reviewPath: review,
      reviewSha256: await digestFile(review), readableSelectedPages: 12 }));
    await mkdir(join(v7.root, "charge-qualification"));
    writeNewJson(join(v7.root, "charge-qualification", "outcome.json"), await v7.bound("pilot-charge-qualification-outcome", { corpusSha256: RH7_CORPUS_REUSE.digest, m3ReportedCharge: true }));
    assert.equal((await verifyPaidPrerequisites(authority, "baseline", corpus)).corpusSha256, RH7_CORPUS_REUSE.digest);
    await assert.rejects(verifyPaidPrerequisites(authority, "candidate", corpus), /claimed baseline conversation/);
    // Changed imported bytes are refused even when the receipt is intact.
    await writeFile(join(v7.root, "corpus-import", "frozen-inputs.json"), (await readFile(RH7_CORPUS_REUSE.path, "utf8")) + "\n");
    await assert.rejects(verifyPaidPrerequisites(authority, "baseline", corpus), /Imported corpus bytes differ/);
  } finally { await rm(v7.root, { recursive: true, force: true }); }
  // Unchanged rh-v6 rule: the candidate needs the passed baseline gate.
  const root = await mkdtemp(join(tmpdir(), "handoff-rh6-prerequisite-"));
  try {
    const direction = JSON.parse(await readFile(RH6_OWNER_DIRECTION_PATH, "utf8"));
    const ownerPath = join(root, "owner-direction.json");
    await writeFile(ownerPath, JSON.stringify({ ...direction, designatedSeriesRoot: root }));
    const ownerSha = await digestFile(ownerPath), review = join(root, "review.md");
    await writeFile(review, "review\n");
    const acceptancePath = join(root, "implementation-acceptance.json");
    writeNewJson(acceptancePath, { schemaVersion: 1, kind: "pilot-implementation-acceptance", acceptedBy: "coordinator", accepted: true,
      scope: RH6_SCOPE, protocolRevision: RH6_PROTOCOL_REVISION, seriesRoot: root, ownerDecisionPath: ownerPath, ownerDecisionSha256: ownerSha,
      codeSha256: (await sourceIdentity(REPO_ROOT)).digest, protocolSha256: await digestFile(RH6_PROTOCOL_PATH),
      technicalReviewPath: review, technicalReviewSha256: await digestFile(review), proseReviewPath: review, proseReviewSha256: await digestFile(review) });
    const authority = await verifyPilotImplementation(acceptancePath, { definition: RH6_PILOT, designatedRoot: root, ownerDecisionSha256: ownerSha, rootCheck: async () => {} });
    const bound = async (kind: string, extra: Record<string, unknown> = {}) => ({ kind, accepted: true, seriesRoot: root,
      implementationAcceptanceSha256: await digestFile(acceptancePath), ownerDecisionSha256: ownerSha, ...extra });
    writeNewJson(join(root, "financial-admission-receipt.json"), await bound("pilot-financial-admission"));
    await mkdir(join(root, "capture")); await mkdir(join(root, "charge-qualification"));
    writeNewJson(join(root, "capture", "outcome.json"), await bound("pilot-capture-outcome", { corpusSha256: "c".repeat(64), sonarReportedCharge: true }));
    const corpus = join(root, "corpus-acceptance.json");
    writeNewJson(corpus, await bound("pilot-corpus-acceptance", { corpusSha256: "c".repeat(64), reviewer: "r", reviewPath: review, reviewSha256: await digestFile(review), readableSelectedPages: 12 }));
    writeNewJson(join(root, "charge-qualification", "outcome.json"), await bound("pilot-charge-qualification-outcome", { corpusSha256: "c".repeat(64), m3ReportedCharge: true }));
    assert.equal((await verifyPaidPrerequisites(authority, "baseline", corpus)).corpusSha256, "c".repeat(64));
    await assert.rejects(verifyPaidPrerequisites(authority, "candidate", corpus), /pilot-baseline-gate is missing/);
    await assert.rejects(pilotImportCorpus(acceptancePath, { definition: RH6_PILOT, designatedRoot: root, ownerDecisionSha256: ownerSha, rootCheck: async () => {} }), /captures its own corpus/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function lockFor(dir: string, record: RunRecord, corpusSha256: string, rubricSha256: string): Promise<string> {
  const reviews = [];
  for (const reviewer of ["answer-reviewer-1", "answer-reviewer-2"]) {
    const path = join(dir, `${record.manifest.runId}-${reviewer}.json`);
    await writeFile(path, JSON.stringify({ reviewer, runIdSha256: digestText(record.manifest.runId), recordSha256: digestObject(record), answerSha256: digestText(record.finalAnswer),
      corpusSha256, rubricSha256, lockedAt: "2026-11-07T21:00:00Z", materialUnsupportedClaim: false,
      grades: Object.fromEntries(PILOT_RUBRICS.map(rubric => [rubric, Object.fromEntries(PILOT_TOPICS.map(topic => [topic, { pass: true, reasons: "Fixture.", sourceRefs: ["page-1"] }]))])) }));
    reviews.push({ path, sha256: await digestFile(path) });
  }
  const lock = join(dir, `${record.manifest.runId}-lock.json`);
  await writeFile(lock, JSON.stringify({ schemaVersion: 1, kind: "pilot-answer-assessment-lock", runId: record.manifest.runId, reviews }));
  return lock;
}

/** Observation, admission, import, corpus acceptance and qualification for a fixture root, credential-free. */
async function prepareThroughQualification(fixture: Awaited<ReturnType<typeof rh7AuthorityFixture>>, dispatched: WorkerConfig[]) {
  const { root, acceptancePath, seams, bound } = fixture;
  const auth = join(root, "credential-reference-never-read");
  const synthetic = (scenario: PilotSyntheticScenario) => async (cfg: WorkerConfig) => {
    dispatched.push(structuredClone(cfg));
    const { acceptancePath: _a, authPath: _p, ...rest } = cfg;
    const record = await executeWorker({ ...rest, manifest: { ...cfg.manifest, phase: "pilot-synthetic", mainModel: { provider: SYNTHETIC_PROVIDER_ID, model: SYNTHETIC_MODEL_ID } },
      pilot: { ...cfg.pilot!, scenario } });
    // The injected executor alone supplies the paid-phase/dispatch witnesses.
    // Production guards must not be weakened to accommodate a synthetic worker.
    if (cfg.manifest.phase === "pilot") {
      await markPilotDispatch(root, cfg.manifest.arm === "baseline" ? "pilot-baseline" : "pilot-candidate", cfg.manifest.runId);
      record.manifest.phase = "pilot";
      await writeFile(join(cfg.directory, "record.json"), JSON.stringify(record, null, 2));
    }
    return record;
  };
  const common = { ...seams, credentialCheck: async () => {}, wait: async () => {} };
  const observed = await pilotObserve(acceptancePath, auth, { ...common, execute: synthetic("observer-complete") });
  assert.equal(observed.stopped, false, await readFile(observed.outcomePath, "utf8"));
  const diagnostic = join(root, "diagnostic-acceptance.json");
  writeNewJson(diagnostic, await bound("pilot-diagnostic-acceptance", { recoveryPurposeReviewed: true }));
  await assert.rejects(pilotImportCorpus(acceptancePath, common), /pilot-financial-admission is missing/, "import follows financial admission");
  await pilotAdmit(acceptancePath, diagnostic, { ...common, fetchCatalogue: async () => CATALOGUE });
  await assert.rejects(pilotCapture(acceptancePath, auth, common), /capture and recapture are not authorised/);
  await assert.rejects(stat(join(root, "claims", "capture")), /ENOENT/, "a refused capture claims no slot");
  const frozenPath = await pilotImportCorpus(acceptancePath, common);
  await assert.rejects(pilotImportCorpus(acceptancePath, common), /already claimed/);
  const review = join(root, "rh6-corpus-review-citation.md");
  await writeFile(review, "fixture citation of the rh-v6 corpus review\n");
  const corpus = join(root, "corpus-acceptance.json");
  writeNewJson(corpus, await bound("pilot-corpus-acceptance", { corpusSha256: RH7_CORPUS_REUSE.digest, reviewer: "rh6-corpus-reviewer", reviewPath: review,
    reviewSha256: await digestFile(review), readableSelectedPages: 12 }));
  await pilotQualify(acceptancePath, auth, corpus, { ...common, modelRegistry: syntheticRegistry("complete") });
  return { auth, common, synthetic, corpus, frozenPath };
}

test("rh-v7 full path imports the corpus byte for byte, collects the pair before any grade and settles cumulatively, offline", { timeout: 300_000 }, async () => {
  const fixture = await rh7AuthorityFixture();
  const { root, acceptance, acceptancePath } = fixture;
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("network forbidden in this test"); };
  const dispatched: WorkerConfig[] = [];
  try {
    const { auth, common, synthetic, corpus, frozenPath } = await prepareThroughQualification(fixture, dispatched);
    assert.equal(await digestFile(frozenPath), RH7_CORPUS_REUSE.sha256, "imported bytes are the retained bytes");
    const imported = JSON.parse(await readFile(join(root, "corpus-import", "outcome.json"), "utf8"));
    assert.equal(imported.accepted, true);
    assert.equal(imported.newSearchChargeNanoUsd, 0);
    assert.equal(imported.network, false);
    assert.equal(imported.provenance.sourceSeries, RH6_PROTOCOL_REVISION);
    assert.equal(imported.provenance.sourceCaptureOutcomeSha256, await digestFile(join(RH6_SERIES_ROOT, "capture", "outcome.json")));
    assert.equal(JSON.parse(await readFile(join(root, "corpus-import", "budget.json"), "utf8")).limitNanoUsd, 0);

    const baseline = await pilotRun(acceptancePath, auth, "baseline", corpus, { ...common, execute: synthetic("complete") });
    assert.equal(baseline.passed, true);
    assert.equal(dispatched.at(-1)!.pilot!.budgetNanoUsd, RH7_BUDGET.baselinePilotNanoUsd);
    assert.equal(dispatched.at(-1)!.frozenPath, frozenPath);
    const baseRecord = JSON.parse(await readFile(join(root, "runs", baseline.runId, "record.json"), "utf8")) as RunRecord;
    assert.equal(baseRecord.manifest.corpusSha256, RH7_CORPUS_REUSE.digest);
    assert.equal(baseRecord.adapterEvents.filter(event => event.kind === "extract-consumed").length, 12);
    const baseLock = await lockFor(root, baseRecord, RH7_CORPUS_REUSE.digest, acceptance.protocolSha256);
    await assert.rejects(pilotGate(acceptancePath, "baseline", baseLock, common), /Grades follow the pair/);
    const ended = Date.parse(baseRecord.manifest.endedAt!);
    await assert.rejects(pilotRun(acceptancePath, auth, "candidate", corpus, { ...common, execute: synthetic("complete"), now: () => ended + 1_000 }), /30 seconds/);
    await assert.rejects(stat(join(root, "claims", "pilot-candidate")), /ENOENT/, "an early candidate claims no slot");
    // Wrong phase and changed implementation cannot stand in for a paid baseline.
    const basePath = join(root, "runs", baseline.runId, "record.json");
    for (const change of [{ phase: "pilot-synthetic" }, { codeSha256: "changed" }, { protocolSha256: "changed" }]) {
      await writeFile(basePath, JSON.stringify({ ...baseRecord, manifest: { ...baseRecord.manifest, ...change } }));
      await assert.rejects(pilotRun(acceptancePath, auth, "candidate", corpus, { ...common, execute: synthetic("complete"), now: () => ended + 31_000 }), /baseline with passed machine checks/);
      await assert.rejects(stat(join(root, "claims", "pilot-candidate")), /ENOENT/);
    }
    await writeFile(basePath, JSON.stringify(baseRecord, null, 2));
    // No baseline gate exists: the candidate runs on the collected baseline alone.
    const candidate = await pilotRun(acceptancePath, auth, "candidate", corpus, { ...common, execute: synthetic("complete"), now: () => ended + 31_000 });
    assert.equal(candidate.passed, true);
    const claim = JSON.parse(await readFile(join(root, "claims", "pilot-candidate", "claim.json"), "utf8"));
    assert.equal(claim.candidateAdmission.baselineRecordSha256, digestObject(baseRecord));
    assert.equal(claim.candidateAdmission.baselineMachineChecksPassed, true);
    const candRecord = JSON.parse(await readFile(join(root, "runs", candidate.runId, "record.json"), "utf8")) as RunRecord;
    assert.equal(candRecord.manifest.corpusSha256, baseRecord.manifest.corpusSha256);
    assert.equal((await pilotGate(acceptancePath, "baseline", baseLock, common)).passed, true);
    assert.equal((await pilotGate(acceptancePath, "candidate", await lockFor(root, candRecord, RH7_CORPUS_REUSE.digest, acceptance.protocolSha256), common)).passed, true);
    const settlement = JSON.parse(await readFile(await pilotSettle(acceptancePath, common), "utf8"));
    assert.equal(settlement.closed, true);
    assert.equal(settlement.unknownNanoUsd, 0);
    assert.equal(settlement.releasedNanoUsd, RH7_BUDGET.totalNanoUsd - settlement.reportedNanoUsd);
    assert.equal(settlement.cumulative.priorReportedNanoUsd, RH7_PRIOR_REPORTED_NANO_USD);
    assert.equal(settlement.cumulative.cumulativeLiabilityNanoUsd, RH7_PRIOR_REPORTED_NANO_USD + settlement.reportedNanoUsd);
    assert.equal(settlement.cumulative.withinCombinedCeiling, true);
    const review = JSON.parse(await readFile(join(root, "settlement-review.json"), "utf8"));
    assert.deepEqual(review.receipts.find((item: { slot: string }) => item.slot === "corpus-import").budget.knownNanoUsd, 0);
    assert.ok(!review.receipts.some((item: { slot: string }) => item.slot === "capture"));
    assert.deepEqual(dispatched.map(cfg => cfg.manifest.runId), [pilotRunId(root, "observer", "baseline"), pilotRunId(root, "observer", "candidate"),
      pilotRunId(root, "pilot", "baseline"), pilotRunId(root, "pilot", "candidate")]);
    assert.ok(dispatched.every(cfg => cfg.pilot!.revision === RH7_PROTOCOL_REVISION));
    for (const later of [() => pilotImportCorpus(acceptancePath, common), () => pilotRun(acceptancePath, auth, "candidate", corpus, common), () => pilotSettle(acceptancePath, common)]) {
      await assert.rejects(later(), /settled and closed/);
    }
  } finally { globalThis.fetch = savedFetch; await rm(root, { recursive: true, force: true }); }
});

test("rh-v7 candidate refuses a financially unsafe or malformed baseline; the blocked baseline may still be graded", { timeout: 300_000 }, async () => {
  const fixture = await rh7AuthorityFixture();
  const { root, acceptance, acceptancePath } = fixture;
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("network forbidden in this test"); };
  try {
    const { auth, common, synthetic, corpus } = await prepareThroughQualification(fixture, []);
    const baseline = await pilotRun(acceptancePath, auth, "baseline", corpus, { ...common, execute: synthetic("unknown-charge") });
    assert.equal(baseline.passed, false);
    const recordPath = join(root, "runs", baseline.runId, "record.json");
    const record = JSON.parse(await readFile(recordPath, "utf8")) as RunRecord;
    const later = () => Date.parse(record.manifest.endedAt!) + 60_000;
    await assert.rejects(pilotRun(acceptancePath, auth, "candidate", corpus, { ...common, execute: synthetic("complete"), now: later }),
      /passed machine checks and known charges only; failing: .*financial-accounting-known/);
    await assert.rejects(stat(join(root, "claims", "pilot-candidate")), /ENOENT/);
    // The candidate is blocked, so the pair is complete for grading purposes.
    const gate = await pilotGate(acceptancePath, "baseline", await lockFor(root, record, RH7_CORPUS_REUSE.digest, acceptance.protocolSha256), common);
    assert.equal(gate.passed, false, "machine failure still fails the gate");
    // A malformed retained record is refused, never treated as a passed baseline.
    await writeFile(recordPath, "{ not json");
    await assert.rejects(pilotRun(acceptancePath, auth, "candidate", corpus, { ...common, execute: synthetic("complete"), now: later }), /baseline/);
    await assert.rejects(stat(join(root, "claims", "pilot-candidate")), /ENOENT/);
  } finally { globalThis.fetch = savedFetch; await rm(root, { recursive: true, force: true }); }
});

test("historic definitions are unchanged: rh-v5 and rh-v6 capture, gate first and carry no reuse or cumulative fields", () => {
  for (const definition of [RH5_PILOT, RH6_PILOT]) {
    assert.equal(definition.corpusReuse, undefined);
    assert.equal(definition.gradingAfterPair, undefined);
    assert.equal(definition.cumulative, undefined);
    assert.equal(definition.closedRoots, undefined);
  }
  assert.equal(RH6_PILOT.budget.captureNanoUsd, 810_000_000);
  assert.equal(RH6_PILOT.operationLimits.commonCaptures, 1);
  assert.equal(RH7_PILOT.operationLimits.commonCaptures, 0);
});
