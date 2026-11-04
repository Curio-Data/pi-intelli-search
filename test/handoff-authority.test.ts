// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyPreparationAuthority, admitAcceptedPreparation, prepareCapture, qualifyDownstreamCost, settleAcceptedSeries, assertFixedEnvelopeApproval } from "../scripts/research-handoff/collection.js";
import { assertLiveEvidenceRoot, assertFixedAdmissionIdentity, validateLiveAcceptance, REPO_ROOT, type WorkerConfig } from "../scripts/research-handoff/runner.js";
import { unavailableRecord, writeNewJson, digestFile, sourceIdentity } from "../scripts/research-handoff/storage.js";
import { BUDGET, pairedSchedule } from "../scripts/research-handoff/config.js";

test("handoff unresolved financial authority blocks every metered entry before network or credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "handoff-authority-"));
  const savedFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; throw new Error("unexpected network"); };
  try {
    const path = join(root, "unaccepted.json");
    writeNewJson(path, { schemaVersion: 1, phase: "preparation", acceptedBy: "coordinator", financialMode: "legacy" });
    await assert.rejects(verifyPreparationAuthority(path), /fixed-envelope/);
    await assert.rejects(admitAcceptedPreparation(path), /fixed-envelope/);
    await assert.rejects(prepareCapture(path, "nonexistent-credential-reference"), /fixed-envelope/);
    await assert.rejects(qualifyDownstreamCost(path, "nonexistent-credential-reference", "nonexistent-review"), /fixed-envelope/);
    await assert.rejects(settleAcceptedSeries(path), /fixed-envelope/);
    assert.equal(networkCalls, 0);
  } finally { globalThis.fetch = savedFetch; await rm(root, { recursive: true, force: true }); }
});

test("fixed-envelope approval and admission remain bounded to the exact experiment identities", () => {
  const owner = { schemaVersion: 1, approvedAt: "2026-11-04T00:00:00Z", approvedBy: "owner", approved: true, scope: "continue-without-programme-ledger", maximumExperimentEnvelopeNanoUsd: 25_810_000_000 };
  assert.doesNotThrow(() => assertFixedEnvelopeApproval(owner));
  assert.throws(() => assertFixedEnvelopeApproval({ ...owner, maximumExperimentEnvelopeNanoUsd: 30_000_000_000 }), /bounded no-ledger/);
  assert.throws(() => assertFixedEnvelopeApproval({ ...owner, scope: "unlimited" }), /bounded no-ledger/);
  const admission = { accepted: true, mode: "fixed-envelope", codeSha256: "code", protocolSha256: "protocol", envelopeNanoUsd: 25_810_000_000 };
  assert.doesNotThrow(() => assertFixedAdmissionIdentity(admission, "code", "protocol"));
  assert.throws(() => assertFixedAdmissionIdentity({ ...admission, codeSha256: "other" }, "code", "protocol"), /missing or changed/);
  assert.throws(() => assertFixedAdmissionIdentity({ ...admission, envelopeNanoUsd: 1 }, "code", "protocol"), /missing or changed/);
});

test("fixed-envelope admission, measured acceptance and local close-out integrate without a ledger", async () => {
  const root = await mkdtemp(join(tmpdir(), "handoff-fixed-integration-"));
  const savedFetch = globalThis.fetch;
  const noRootCheck = async () => {};
  try {
    assert.ok(BUDGET.captureNanoUsd + BUDGET.costQualificationNanoUsd + pairedSchedule().length * BUDGET.runNanoUsd <= BUDGET.batchNanoUsd);
    const { digest: codeSha256 } = await sourceIdentity(REPO_ROOT);
    const protocolSha256 = await digestFile(join(REPO_ROOT, "docs/experiments/research-handoff/PROTOCOL.md"));
    const ownerPath = join(root, "owner.json"), technicalPath = join(root, "technical.md"), diagnosticPath = join(root, "diagnostic.json");
    writeNewJson(ownerPath, { schemaVersion: 1, approvedAt: "2026-11-04T00:00:00Z", approvedBy: "owner", approved: true,
      scope: "continue-without-programme-ledger", maximumExperimentEnvelopeNanoUsd: BUDGET.batchNanoUsd });
    writeNewJson(technicalPath, "# Accepted technical review\n");
    writeNewJson(diagnosticPath, { accepted: true, codeSha256, protocolSha256 });
    const acceptancePath = join(root, "preparation.json");
    writeNewJson(acceptancePath, { schemaVersion: 1, phase: "preparation", acceptedBy: "coordinator", seriesRoot: root,
      codeSha256, protocolSha256, technicalReviewPath: technicalPath, technicalReviewSha256: await digestFile(technicalPath),
      financialMode: "fixed-envelope", fixedEnvelopeNanoUsd: BUDGET.batchNanoUsd,
      ownerFinancialApprovalPath: ownerPath, ownerFinancialApprovalSha256: await digestFile(ownerPath), diagnosticAcceptancePath: diagnosticPath });
    globalThis.fetch = async () => new Response(JSON.stringify({ data: [
      { id: "perplexity/sonar", context_length: 127072, pricing: { prompt: "0.000001", completion: "0.000001", web_search: "0.005" } },
      { id: "minimax/minimax-m3", context_length: 1048576, pricing: { prompt: "0.0000003", completion: "0.0000012" } },
    ] }), { status: 200 });
    await admitAcceptedPreparation(acceptancePath, noRootCheck);
    await assert.doesNotReject(verifyPreparationAuthority(acceptancePath, noRootCheck));
    await assert.rejects(admitAcceptedPreparation(acceptancePath, noRootCheck), /EEXIST/);
    const admissionPath = join(root, "financial-admission-receipt.json");
    const costPath = join(root, "cost.json"), corpusPath = join(root, "corpus.json");
    for (const path of [costPath, corpusPath]) writeNewJson(path, { accepted: true, codeSha256, protocolSha256, corpusSha256: "corpus" });
    const runId = "run", livePath = join(root, "live.json");
    writeNewJson(livePath, { schemaVersion: 1, phase: "measured", acceptedBy: "coordinator", seriesRoot: root,
      codeSha256, protocolSha256, corpusSha256: "corpus", runIds: [runId], technicalReviewPath: technicalPath,
      technicalReviewSha256: await digestFile(technicalPath), financialMode: "fixed-envelope",
      financialAdmissionPath: admissionPath, financialAdmissionSha256: await digestFile(admissionPath),
      costQualificationPath: costPath, corpusAcceptancePath: corpusPath });
    const manifest = { ...unavailableRecord(runId, "measured", "fixture").manifest, codeSha256, protocolSha256, corpusSha256: "corpus" };
    const directory = join(root, "runs", runId);
    const cfg: WorkerConfig = { schemaVersion: 1, manifest, directory, workspace: join(directory, "workspace"),
      agentDir: join(directory, "agent"), frozenPath: "unused", acceptancePath: livePath, authPath: "unused" };
    await assert.doesNotReject(validateLiveAcceptance(cfg, noRootCheck));
    await assert.rejects(validateLiveAcceptance(cfg, noRootCheck), /EEXIST/);
    writeNewJson(join(root, "collection-outcome.json"), { stopped: false });
    await mkdir(join(root, "capture"));
    writeNewJson(join(root, "capture", "budget.json"), { limitNanoUsd: BUDGET.captureNanoUsd, knownNanoUsd: 10, unknownNanoUsd: 5, activeNanoUsd: 0 });
    writeNewJson(join(root, "capture", "outcome.json"), { accepted: true });
    await settleAcceptedSeries(acceptancePath, noRootCheck);
    const settlement = JSON.parse(await import("node:fs/promises").then(fs => fs.readFile(join(root, "settlement-receipt.json"), "utf8")));
    assert.equal(settlement.reportedNanoUsd, 10);
    assert.equal(settlement.unknownNanoUsd, 5);
    assert.equal(settlement.releasedNanoUsd, BUDGET.batchNanoUsd - 15);
    assert.equal(settlement.programmeLedgerCreated, false);
  } finally { globalThis.fetch = savedFetch; await rm(root, { recursive: true, force: true }); }
});

test("handoff scratch clones cannot become live evidence roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "handoff-clone-"));
  try { await assert.rejects(assertLiveEvidenceRoot(root)); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test("handoff a raw worker needs explicit live acceptance and credential reference", async () => {
  const manifest = unavailableRecord("unaccepted", "measured", "new fixture").manifest;
  const config = { schemaVersion: 1, manifest, directory: "unused", workspace: "unused", agentDir: "unused", frozenPath: "unused" } as WorkerConfig;
  await assert.rejects(validateLiveAcceptance(config), /requires a recorded acceptance/);
});
