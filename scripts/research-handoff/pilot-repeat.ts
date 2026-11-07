// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// rh-v7 single repeat definition (REPEAT-PROTOCOL.md, revision rh-v7-once-1).
// One owner-directed matched pair under a new root. It reuses the settled rh-v6
// corpus byte for byte instead of capturing, keeps every rh-v6 setting, prompt
// and rubric, grades both answers after the pair and carries cumulative
// accounting from both earlier settlements. Nothing here dispatches work,
// reads credentials or touches the network.

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { FrozenInputs, PilotRevision } from "./contracts.js";
import { assertCorpusAcceptable, loadFrozenInputs } from "./common-inputs.js";
import { RH6_SOURCE_POLICY } from "./source-selection.js";
import { digestFile, digestObject } from "./storage.js";
import {
  PILOT_BUDGET, PILOT_OPERATION_LIMITS, PILOT_SERIES_ROOT, RH5_PILOT,
  type CorpusReuse, type PilotDefinition, type PriorSettlement,
} from "./pilot-config.js";
import { RH6_PILOT, RH6_PROFILE, RH6_PROTOCOL_REVISION, RH6_SERIES_ROOT, rh6Params, rh6Settings } from "./pilot-continuation.js";

const REPO = resolve(PILOT_SERIES_ROOT, "../../../..");
export const RH7_PROTOCOL_REVISION = "rh-v7-once-1" as const;
export const RH7_SCOPE = "research-handoff-single-repeat-rh-v7" as const;
export const RH7_RECORD_TYPE = "owner-directed-single-e2e-repeat" as const;
export const RH7_PROTOCOL_PATH = join(REPO, "docs/experiments/research-handoff/REPEAT-PROTOCOL.md");
export const RH7_OWNER_DIRECTION_PATH = join(REPO, "evidence/agents/20261107T195837Z-e2e-once/owner-direction.json");
/** Immutable owner-direction digest recorded at implementation entry. */
export const RH7_OWNER_DIRECTION_SHA256 = "c5c2bdcc49df17dd9a53711f7ed2660ef56b7d78c9dd4e6b4fc585b3f0b46f0c";
export const RH7_SERIES_ROOT = join(REPO, "evidence/benchmarks/research-handoff/20261107T195837Z-rh-v7-once");
export const RH7_GRADING = "after-both-paid-conversations" as const;

/** rh-v6 profile and settings, unchanged. */
export const RH7_PROFILE = RH6_PROFILE;
/** No capture, recapture, replacement or measured sprint; one charge qualification and one pair. */
export const RH7_OPERATION_LIMITS = { ...PILOT_OPERATION_LIMITS, commonCaptures: 0 } as const;
export const RH7_COMBINED_CEILING_NANO_USD = 10_000_000_000;
/** Both closed settlements, read only and never reopened. */
export const RH7_PRIOR_SETTLEMENTS: readonly PriorSettlement[] = Object.freeze([
  { path: join(PILOT_SERIES_ROOT, "settlement-receipt.json"), sha256: "79282d258bd86b7706d28c888ed340a825f055441868594a49ae9b96ba422214", reportedNanoUsd: 5_700_000 },
  { path: join(RH6_SERIES_ROOT, "settlement-receipt.json"), sha256: "008ecbc985a0f10f4e9c30e499a189eeb98d34ca00be3bf4e4f7ecd323e9896d", reportedNanoUsd: 129_569_733 },
]);
export const RH7_PRIOR_REPORTED_NANO_USD = 135_269_733;
export const RH7_BUDGET = {
  totalNanoUsd: 9_190_000_000,
  captureNanoUsd: 0,
  qualificationNanoUsd: 1_010_000_000,
  baselinePilotNanoUsd: 4_090_000_000,
  candidatePilotNanoUsd: 4_090_000_000,
  sonarAttemptNanoUsd: PILOT_BUDGET.sonarAttemptNanoUsd,
  m3AttemptNanoUsd: PILOT_BUDGET.m3AttemptNanoUsd,
} as const;
/** The accepted rh-v6 corpus: twelve derived pages, imported once without a search or page fetch. */
export const RH7_CORPUS_REUSE: CorpusReuse = Object.freeze({
  path: join(RH6_SERIES_ROOT, "capture", "frozen-inputs.json"),
  sha256: "78e9f94d23fac9f3fc9d08e4a75812c70409b8fe7c3baf13b20be92394c8160c",
  digest: "ca2ec8b0201a0680054fd34b586ededae915207e892923af6bf588a13269799b",
  sourceSeries: RH6_PROTOCOL_REVISION,
  sourceRoot: RH6_SERIES_ROOT,
});

export const RH7_PILOT: PilotDefinition = Object.freeze({
  revision: RH7_PROTOCOL_REVISION, scope: RH7_SCOPE, protocolPath: RH7_PROTOCOL_PATH,
  ownerDecisionPath: RH7_OWNER_DIRECTION_PATH, ownerDecisionSha256: RH7_OWNER_DIRECTION_SHA256, seriesRoot: RH7_SERIES_ROOT,
  profile: RH7_PROFILE, operationLimits: RH7_OPERATION_LIMITS, budget: RH7_BUDGET, sourcePolicy: RH6_SOURCE_POLICY,
  settings: rh6Settings, params: rh6Params,
  corpusReuse: RH7_CORPUS_REUSE, gradingAfterPair: true, closedRoots: Object.freeze([RH6_SERIES_ROOT]),
  cumulative: Object.freeze({ combinedCeilingNanoUsd: RH7_COMBINED_CEILING_NANO_USD, priorReportedNanoUsd: RH7_PRIOR_REPORTED_NANO_USD,
    priorSettlements: RH7_PRIOR_SETTLEMENTS }),
});

export const PILOT_DEFINITIONS: Readonly<Record<PilotRevision, PilotDefinition>> = {
  "rh-v5-pilot-1": RH5_PILOT, "rh-v6-pilot-1": RH6_PILOT, "rh-v7-once-1": RH7_PILOT,
};
export function pilotDefinitionFor(revision: unknown): PilotDefinition {
  const definition = typeof revision === "string" ? PILOT_DEFINITIONS[revision as PilotRevision] : undefined;
  if (!definition) throw new Error(`Unknown pilot revision ${JSON.stringify(revision)}`);
  return definition;
}

const same = (a: unknown, b: unknown) => digestObject(a) === digestObject(b);
function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a JSON object`);
  return value as Record<string, unknown>;
}
async function readObject(path: string, label: string): Promise<Record<string, unknown>> {
  try { return object(JSON.parse(await readFile(path, "utf8")), label); }
  catch (error) { throw new Error(`${label} is unreadable at ${path}: ${String(error)}`); }
}

/**
 * Reads each closed prior settlement and requires its bytes, closure and
 * liabilities to match. Returns the cumulative reported charge. Never writes.
 */
export async function verifyPriorSettlements(priorSettlements: readonly PriorSettlement[]): Promise<number> {
  let reported = 0;
  for (const prior of priorSettlements) {
    let sha: string;
    try { sha = await digestFile(prior.path); } catch (error) { throw new Error(`Prior settlement is unreadable at ${prior.path}: ${String(error)}`); }
    if (sha !== prior.sha256) throw new Error(`Prior settlement bytes changed at ${prior.path}`);
    const s = await readObject(prior.path, "Prior settlement");
    if (s.kind !== "pilot-settlement" || s.closed !== true || s.reportedNanoUsd !== prior.reportedNanoUsd
      || s.unknownNanoUsd !== 0 || s.activeNanoUsd !== 0 || s.overrunNanoUsd !== 0) {
      throw new Error(`Prior settlement at ${prior.path} is not closed with the recorded known charge and no held, active or overrun liability`);
    }
    reported += prior.reportedNanoUsd;
  }
  return reported;
}

/**
 * Verifies the rh-v7 owner direction (already digest-checked by the caller):
 * scope, profile, counts, envelope, allocations, ordering, grading point,
 * reused corpus, both prior settlements and the designated root. Prior roots
 * are read, never written.
 */
export async function verifyRepeatDirection(d: Record<string, unknown>, designatedRoot: string, definition: PilotDefinition = RH7_PILOT): Promise<void> {
  const cumulative = definition.cumulative, reuse = definition.corpusReuse, budget = definition.budget;
  if (!cumulative || !reuse) throw new Error("The rh-v7 definition lacks cumulative accounting or corpus reuse");
  const allocation = object(d.coordinatorAllocationNanoUsd, "coordinatorAllocationNanoUsd");
  const keys = ["commonCapture", "chargeQualification", "baselinePilot", "candidatePilot"];
  const total = keys.reduce((sum, key) => sum + Number(allocation[key]), 0);
  const root = resolve(String(d.designatedSeriesRoot));
  const closed = [PILOT_SERIES_ROOT, ...(definition.closedRoots ?? [])].map(path => resolve(path));
  if (d.schemaVersion !== 1 || d.approved !== true || d.approvedBy !== "owner" || d.scope !== definition.scope || d.recordType !== RH7_RECORD_TYPE
    || !same(d.profile, definition.profile) || !same(d.operationLimits, definition.operationLimits) || !same(d.order, ["baseline", "candidate"])
    || d.grading !== RH7_GRADING
    || Object.keys(allocation).length !== keys.length
    || allocation.commonCapture !== budget.captureNanoUsd || allocation.chargeQualification !== budget.qualificationNanoUsd
    || allocation.baselinePilot !== budget.baselinePilotNanoUsd || allocation.candidatePilot !== budget.candidatePilotNanoUsd
    || d.maximumExperimentEnvelopeNanoUsd !== budget.totalNanoUsd || total !== budget.totalNanoUsd
    || d.combinedCeilingNanoUsd !== cumulative.combinedCeilingNanoUsd || d.priorReportedNanoUsd !== cumulative.priorReportedNanoUsd
    || d.priorUnknownNanoUsd !== 0 || d.priorActiveNanoUsd !== 0
    || cumulative.priorReportedNanoUsd + budget.totalNanoUsd > cumulative.combinedCeilingNanoUsd
    || !same(d.priorSettlements, cumulative.priorSettlements)
    || !same(d.reusedCorpus, { path: reuse.path, sha256: reuse.sha256, digest: reuse.digest, sourceSeries: reuse.sourceSeries })
    || root !== resolve(designatedRoot) || closed.includes(root)) {
    throw new Error("Owner direction does not cover the bounded rh-v7 scope, profile, counts, envelope, allocation, grading, corpus, prior settlements or root");
  }
  const reported = await verifyPriorSettlements(cumulative.priorSettlements);
  if (reported !== cumulative.priorReportedNanoUsd) throw new Error("Prior settlements do not sum to the owner direction's recorded prior charge");
  const s = definition.settings();
  if (!same(s, rh6Settings()) || !same(definition.params(), rh6Params()) || definition.sourcePolicy !== RH6_SOURCE_POLICY
    || s.maxUrls !== definition.profile.maxUrls || s.llmRetryAttempts !== definition.profile.downstreamAttemptsPerCall) {
    throw new Error("rh-v7 settings, parameters or source policy differ from rh-v6");
  }
}
export async function rh7OwnerDirectionSha256(path = RH7_OWNER_DIRECTION_PATH): Promise<string> { return digestFile(path); }

export interface ReusedCorpusProvenance {
  sourceSeries: string;
  sourceRoot: string;
  sourcePath: string;
  sourceFileSha256: string;
  corpusSha256: string;
  settingsSha256: string;
  sourcePolicyId: string;
  sourcePolicySha256: string;
  selectedPages: number;
  sourceCaptureOutcomeSha256: string;
  sourceCorpusAcceptanceSha256: string;
  sourceSettlementSha256: string;
}

/**
 * Verifies the retained corpus without credentials or network: file bytes,
 * frozen-input validation (including re-derivation), corpus digest, settings,
 * parameters, source policy, a complete capture, and the source series'
 * accepted capture, corpus acceptance and closed settlement.
 */
export async function verifyReusedCorpus(definition: PilotDefinition = RH7_PILOT): Promise<{ frozen: FrozenInputs; provenance: ReusedCorpusProvenance }> {
  const reuse = definition.corpusReuse;
  if (!reuse || !definition.sourcePolicy || !definition.cumulative) throw new Error(`${definition.revision} does not reuse a retained corpus`);
  let fileSha: string;
  try { fileSha = await digestFile(reuse.path); } catch (error) { throw new Error(`Retained corpus is unreadable at ${reuse.path}: ${String(error)}`); }
  if (fileSha !== reuse.sha256) throw new Error("Retained corpus bytes differ from the recorded file digest");
  const frozen = await loadFrozenInputs({ path: reuse.path });
  assertCorpusAcceptable({ frozen });
  const failed = frozen.pages.filter(entry => entry.page.status !== "success").length;
  const derivation = frozen.sourceDerivation;
  if (frozen.digest !== reuse.digest) throw new Error("Retained corpus digest differs from the recorded corpus digest");
  if (!same(frozen.settings, definition.settings()) || !same(frozen.capture.params, definition.params())) throw new Error("Retained corpus settings or parameters differ from the frozen profile");
  if (!derivation || derivation.policy.id !== definition.sourcePolicy.id || !same(derivation.policy, definition.sourcePolicy) || failed) {
    throw new Error("Retained corpus lacks the frozen source derivation or a complete capture");
  }
  const capturePath = join(reuse.sourceRoot, "capture", "outcome.json"), acceptancePath = join(reuse.sourceRoot, "corpus-acceptance.json");
  const capture = await readObject(capturePath, "Source capture outcome");
  const acceptance = await readObject(acceptancePath, "Source corpus acceptance");
  if (capture.kind !== "pilot-capture-outcome" || capture.accepted !== true || capture.corpusSha256 !== frozen.digest || capture.sonarReportedCharge !== true
    || capture.protocolRevision !== reuse.sourceSeries || resolve(String(capture.seriesRoot)) !== resolve(reuse.sourceRoot)) {
    throw new Error("Source series has no accepted capture of this corpus");
  }
  if (acceptance.kind !== "pilot-corpus-acceptance" || acceptance.accepted !== true || acceptance.corpusSha256 !== frozen.digest
    || resolve(String(acceptance.seriesRoot)) !== resolve(reuse.sourceRoot)) {
    throw new Error("Source series has no accepted corpus review of this corpus");
  }
  const settlementPath = join(reuse.sourceRoot, "settlement-receipt.json");
  const settlement = definition.cumulative.priorSettlements.find(item => resolve(item.path) === resolve(settlementPath));
  if (!settlement) throw new Error("Source series settlement is not among the verified prior settlements");
  await verifyPriorSettlements([settlement]);
  return { frozen, provenance: {
    sourceSeries: reuse.sourceSeries, sourceRoot: reuse.sourceRoot, sourcePath: reuse.path, sourceFileSha256: fileSha,
    corpusSha256: frozen.digest, settingsSha256: digestObject(frozen.settings), sourcePolicyId: derivation.policy.id,
    sourcePolicySha256: derivation.policySha256, selectedPages: frozen.pages.length,
    sourceCaptureOutcomeSha256: await digestFile(capturePath), sourceCorpusAcceptanceSha256: await digestFile(acceptancePath),
    sourceSettlementSha256: settlement.sha256,
  } };
}
