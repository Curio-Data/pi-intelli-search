// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// rh-v5 pilot authority: owner decision, implementation acceptance, root
// binding, permanent operation claims and the locked dual-rubric answer gate.
// Nothing here dispatches work, reads credentials or touches the network.

import { readFile, mkdir, realpath, stat } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { digestFile, digestObject, digestText, sourceIdentity, writeNewJson } from "./storage.js";
import { FINANCIAL_APPROVAL_SCOPE } from "./config.js";
import {
  OWNER_DECISION_SHA256, PILOT_BUDGET, PILOT_OPERATION_LIMITS, PILOT_PROFILE, PILOT_PROTOCOL_PATH,
  PILOT_PROTOCOL_REVISION, PILOT_RUBRICS, PILOT_SCOPE, PILOT_SERIES_ROOT, PILOT_SLOTS, PILOT_TOPICS,
  pilotSettings, type PilotSlot,
} from "./pilot-config.js";
import type { RunRecord } from "./contracts.js";

const REPO = resolve(PILOT_PROTOCOL_PATH, "../../../..");
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a JSON object");
  return value as Record<string, unknown>;
}
async function readJson(path: string): Promise<Record<string, unknown>> {
  return object(JSON.parse(await readFile(path, "utf8")));
}
const same = (a: unknown, b: unknown) => digestObject(a) === digestObject(b);

/** Test seams only. The CLI never supplies them, so production binds the designated real root. */
export interface PilotAuthorityOptions {
  designatedRoot?: string;
  ownerDecisionSha256?: string;
  rootCheck?: (path: string) => Promise<void>;
}
export async function assertPilotEvidenceRoot(path: string): Promise<void> {
  const base = await realpath(join(REPO, "evidence/benchmarks/research-handoff"));
  const actual = await realpath(resolve(path));
  const rel = relative(base, actual);
  if (!rel || rel.startsWith("..") || rel.split(/[\\/]/).includes(".tmp") || actual !== resolve(path)) {
    throw new Error("Pilot series must be the designated real evidence directory in this checkout");
  }
}

export async function verifyOwnerDecision(path: string, options: PilotAuthorityOptions = {}): Promise<Record<string, unknown>> {
  if (await digestFile(path) !== (options.ownerDecisionSha256 ?? OWNER_DECISION_SHA256)) throw new Error("Owner decision bytes differ from the recorded digest");
  const d = await readJson(path);
  const designated = options.designatedRoot ?? PILOT_SERIES_ROOT;
  const allocation = object(d.coordinatorAllocationNanoUsd);
  const total = ["commonCapture", "chargeQualification", "baselinePilot", "candidatePilot"].reduce((sum, key) => sum + Number(allocation[key]), 0);
  if (d.schemaVersion !== 1 || d.approved !== true || d.approvedBy !== "owner" || d.scope !== PILOT_SCOPE
    || (d.scope as string) === FINANCIAL_APPROVAL_SCOPE || d.maximumExperimentEnvelopeNanoUsd !== PILOT_BUDGET.totalNanoUsd
    || !same(d.profile, PILOT_PROFILE) || !same(d.operationLimits, PILOT_OPERATION_LIMITS)
    || !same(d.order, ["baseline", "candidate"])
    || allocation.commonCapture !== PILOT_BUDGET.captureNanoUsd || allocation.chargeQualification !== PILOT_BUDGET.qualificationNanoUsd
    || allocation.baselinePilot !== PILOT_BUDGET.baselinePilotNanoUsd || allocation.candidatePilot !== PILOT_BUDGET.candidatePilotNanoUsd
    || total !== PILOT_BUDGET.totalNanoUsd || resolve(String(d.designatedSeriesRoot)) !== resolve(designated)) {
    throw new Error("Owner decision does not cover the bounded rh-v5 pilot scope, profile, counts, allocation or root");
  }
  const s = pilotSettings();
  if (s.extractionMaxTokens !== PILOT_PROFILE.extractionMaxTokens || s.collationMaxTokens !== PILOT_PROFILE.collationMaxTokens
    || s.llmTimeoutMs !== PILOT_PROFILE.llmTimeoutMs || s.extractionConcurrency !== PILOT_PROFILE.extractionConcurrency
    || s.maxUrls !== PILOT_PROFILE.maxUrls || s.llmRetryAttempts !== PILOT_PROFILE.downstreamAttemptsPerCall) {
    throw new Error("Pilot settings differ from the owner profile");
  }
  return d;
}

export interface PilotImplementationAcceptance {
  schemaVersion: 1;
  kind: "pilot-implementation-acceptance";
  acceptedBy: "coordinator";
  accepted: true;
  scope: typeof PILOT_SCOPE;
  protocolRevision: typeof PILOT_PROTOCOL_REVISION;
  seriesRoot: string;
  ownerDecisionPath: string;
  ownerDecisionSha256: string;
  codeSha256: string;
  protocolSha256: string;
  technicalReviewPath: string;
  technicalReviewSha256: string;
  proseReviewPath: string;
  proseReviewSha256: string;
}
export interface VerifiedPilotAuthority {
  acceptance: PilotImplementationAcceptance;
  acceptancePath: string;
  acceptanceSha256: string;
  root: string;
}
/** Verifies the implementation acceptance against the live tree; never accepts an rh-v4 receipt. */
export async function verifyPilotImplementation(path: string, options: PilotAuthorityOptions = {}): Promise<VerifiedPilotAuthority> {
  const a = await readJson(path) as unknown as PilotImplementationAcceptance;
  const designated = resolve(options.designatedRoot ?? PILOT_SERIES_ROOT);
  if (a.schemaVersion !== 1 || a.kind !== "pilot-implementation-acceptance" || a.acceptedBy !== "coordinator" || a.accepted !== true
    || a.scope !== PILOT_SCOPE || a.protocolRevision !== PILOT_PROTOCOL_REVISION || "financialMode" in a || "phase" in a) {
    throw new Error("Not an accepted rh-v5 pilot implementation; historical rh-v4 receipts are not reusable");
  }
  if (resolve(a.seriesRoot) !== designated) throw new Error("Pilot authority names a root other than the designated series root");
  await (options.rootCheck ?? assertPilotEvidenceRoot)(a.seriesRoot);
  // Settlement closes the series: no later live command (including another settlement) may continue from it.
  if (await fileExists(join(designated, "settlement-receipt.json"))) throw new Error("The pilot series is settled and closed to further live work");
  await verifyOwnerDecision(a.ownerDecisionPath, options);
  if (a.ownerDecisionSha256 !== (options.ownerDecisionSha256 ?? OWNER_DECISION_SHA256)) throw new Error("Acceptance cites another owner decision");
  if ((await sourceIdentity(REPO)).digest !== a.codeSha256) throw new Error("Pilot code identity changed since acceptance");
  if (await digestFile(PILOT_PROTOCOL_PATH) !== a.protocolSha256) throw new Error("Pilot protocol identity changed since acceptance");
  for (const [p, h] of [[a.technicalReviewPath, a.technicalReviewSha256], [a.proseReviewPath, a.proseReviewSha256]]) {
    if (!p || await digestFile(p) !== h) throw new Error("Independent technical or prose review is missing or changed");
  }
  const acceptanceSha256 = await digestFile(path);
  await bindRoot(designated, { ownerDecisionSha256: a.ownerDecisionSha256, implementationAcceptanceSha256: acceptanceSha256,
    codeSha256: a.codeSha256, protocolSha256: a.protocolSha256 });
  return { acceptance: a, acceptancePath: path, acceptanceSha256, root: designated };
}

/** One generation per root: the first verified use binds it, later uses must match exactly. */
async function bindRoot(root: string, binding: Record<string, string>): Promise<void> {
  const path = join(root, "pilot-root-binding.json");
  try {
    const existing = await readJson(path);
    if (!same(existing.binding, binding)) throw new Error("Designated root is already bound to another pilot generation or implementation");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    writeNewJson(path, { schemaVersion: 1, scope: PILOT_SCOPE, protocolRevision: PILOT_PROTOCOL_REVISION, boundAt: new Date().toISOString(), binding });
  }
}

/** Permanent, exclusive operation claim. A failed operation still consumes its slot. */
export async function claimPilotSlot(root: string, slot: PilotSlot, details: Record<string, unknown>): Promise<string> {
  if (!(PILOT_SLOTS as readonly string[]).includes(slot)) throw new Error(`Unauthorised pilot operation: ${String(slot)}`);
  const claims = join(root, "claims");
  await mkdir(claims, { recursive: true });
  try { await mkdir(join(claims, slot)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Pilot operation ${slot} is already claimed; no replacement is authorised`);
    throw error;
  }
  const path = join(claims, slot, "claim.json");
  writeNewJson(path, { schemaVersion: 1, slot, claimedAt: new Date().toISOString(), ...details });
  return path;
}
export async function readPilotClaim(root: string, slot: PilotSlot): Promise<Record<string, unknown> | undefined> {
  try { return await readJson(join(root, "claims", slot, "claim.json")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
/** Exclusive dispatch marker: one worker per claim, even if a worker config is replayed. */
export async function markPilotDispatch(root: string, slot: PilotSlot, runId: string): Promise<void> {
  const claim = await readPilotClaim(root, slot);
  if (!claim || claim.runId !== runId) throw new Error(`No ${slot} claim covers ${runId}`);
  try { await mkdir(join(root, "claims", slot, "dispatched")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`${slot} was already dispatched`);
    throw error;
  }
}

/** Rejects any schedule other than the one diagnostic or paid pair. */
export function assertPilotSchedule(runIds: readonly string[], expected: readonly string[]): void {
  if (runIds.length !== expected.length || runIds.some((id, index) => id !== expected[index])) {
    throw new Error(`Pilot authority covers only ${expected.length} conversations in baseline-then-candidate order; ${runIds.length} were requested`);
  }
}

/** A stage receipt is accepted only when bound to the same implementation, decision and root. */
export async function verifyStageReceipt(path: string, kind: string, authority: VerifiedPilotAuthority, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  let r: Record<string, unknown>;
  try { r = await readJson(path); }
  catch (error) { throw new Error(`${kind} is missing or unreadable at ${path}: ${String(error)}`); }
  if (r.kind !== kind || r.accepted !== true || r.implementationAcceptanceSha256 !== authority.acceptanceSha256
    || r.ownerDecisionSha256 !== authority.acceptance.ownerDecisionSha256 || resolve(String(r.seriesRoot)) !== authority.root
    || Object.entries(extra).some(([key, value]) => r[key] !== value)) {
    throw new Error(`${kind} is missing, rejected or bound to another identity`);
  }
  return r;
}

// ---------------------------------------------------------------------------
// Locked dual-rubric answer gate
// ---------------------------------------------------------------------------

export interface PilotGrade {
  reviewer: string;
  /** Opaque binding: SHA-256 of the run identity, so blinded graders never see a route-bearing run name. */
  runIdSha256: string;
  recordSha256: string;
  answerSha256: string;
  corpusSha256: string;
  rubricSha256: string;
  lockedAt: string;
  materialUnsupportedClaim: boolean;
  grades: Record<typeof PILOT_RUBRICS[number], Record<string, { pass: boolean; reasons: string; sourceRefs: string[] }>>;
}
export interface PilotAssessmentLock {
  schemaVersion: 1;
  kind: "pilot-answer-assessment-lock";
  runId: string;
  reviews: Array<{ path: string; sha256: string }>;
  adjudication?: { path: string; sha256: string };
  /** Required when a later Codemode call has no nested read: a separate source-cited evidence-only purpose review. */
  recoveryPurposeReview?: { path: string; sha256: string };
}

/** F8: every later Codemode call without a nested read needs a reviewed evidence-only purpose before a paid gate passes. */
export async function assessRecoveryPurpose(lock: PilotAssessmentLock, record: RunRecord, callIds: readonly string[]): Promise<{ passed: boolean; problems: string[] }> {
  if (!callIds.length) return { passed: true, problems: [] };
  if (!lock.recoveryPurposeReview) return { passed: false, problems: [`No purpose review for later Codemode call(s) without a nested read: ${callIds.join(", ")}`] };
  try {
    if (await digestFile(lock.recoveryPurposeReview.path) !== lock.recoveryPurposeReview.sha256) throw new Error("purpose review changed after locking");
    const review = JSON.parse(await readFile(lock.recoveryPurposeReview.path, "utf8")) as {
      kind?: string; reviewer?: string; recordSha256?: string; calls?: Array<{ id?: string; evidenceOnly?: boolean; rationale?: string; sourceRefs?: unknown[] }> };
    if (review.kind !== "pilot-recovery-purpose-review" || !review.reviewer?.trim() || review.recordSha256 !== digestObject(record)) throw new Error("purpose review is not bound to this record");
    const problems: string[] = [];
    for (const id of callIds) {
      const entry = review.calls?.find(item => item.id === id);
      if (!entry || entry.evidenceOnly !== true || !entry.rationale?.trim() || !Array.isArray(entry.sourceRefs) || !entry.sourceRefs.length) {
        problems.push(`Call ${id} lacks a source-cited evidence-only purpose finding`);
      }
    }
    return { passed: problems.length === 0, problems };
  } catch (error) { return { passed: false, problems: [`Purpose review: ${String(error)}`] }; }
}
export interface PilotGateResult { passed: boolean; reviewerPasses: boolean[]; adjudicated: boolean; problems: string[] }

function gradePasses(grade: PilotGrade, problems: string[], label: string): boolean {
  let pass = grade.materialUnsupportedClaim === false;
  if (typeof grade.materialUnsupportedClaim !== "boolean") problems.push(`${label}: material-unsupported-claim status lacks a judgement`);
  for (const rubric of PILOT_RUBRICS) {
    const cells = grade.grades?.[rubric] ?? {};
    for (const topic of PILOT_TOPICS) {
      const cell = cells[topic];
      if (!cell || typeof cell.pass !== "boolean" || !cell.reasons?.trim() || !Array.isArray(cell.sourceRefs) || !cell.sourceRefs.length) {
        problems.push(`${label}: ${rubric}/${topic} lacks a source-cited judgement`); pass = false;
      } else if (!cell.pass) pass = false;
    }
    if (Object.keys(cells).some(topic => !(PILOT_TOPICS as readonly string[]).includes(topic))) { problems.push(`${label}: ${rubric} grades an unfrozen topic`); pass = false; }
  }
  return pass;
}

/** Both locked grades pass both rubrics, or a fresh adjudicator resolves a disagreement as a pass. */
export async function assessPilotAnswerGate(lockPath: string, record: RunRecord, corpusSha256: string, rubricSha256: string): Promise<PilotGateResult> {
  const problems: string[] = [];
  const lock = await readJson(lockPath) as unknown as PilotAssessmentLock;
  if (lock.kind !== "pilot-answer-assessment-lock" || lock.runId !== record.manifest.runId || !Array.isArray(lock.reviews) || lock.reviews.length !== 2) {
    return { passed: false, reviewerPasses: [], adjudicated: false, problems: ["Assessment lock must cover exactly two reviews of this run"] };
  }
  const expected = { runIdSha256: digestText(record.manifest.runId), recordSha256: digestObject(record), answerSha256: digestText(record.finalAnswer ?? ""), corpusSha256, rubricSha256 };
  const grades: PilotGrade[] = [];
  for (const [index, review] of lock.reviews.entries()) {
    try {
      if (await digestFile(review.path) !== review.sha256) throw new Error("artefact changed after locking");
      const grade = JSON.parse(await readFile(review.path, "utf8")) as PilotGrade;
      for (const [key, value] of Object.entries(expected)) if ((grade as unknown as Record<string, unknown>)[key] !== value) throw new Error(`binds a different ${key}`);
      if (!grade.reviewer?.trim() || Number.isNaN(Date.parse(grade.lockedAt))) throw new Error("lacks reviewer identity or lock time");
      grades.push(grade);
    } catch (error) { problems.push(`Review ${index + 1}: ${String(error)}`); }
  }
  if (grades.length !== 2) return { passed: false, reviewerPasses: [], adjudicated: false, problems };
  if (grades[0].reviewer === grades[1].reviewer) problems.push("The two reviews come from the same reviewer");
  const reviewerPasses = grades.map((grade, index) => gradePasses(grade, problems, `Reviewer ${index + 1}`));
  if (problems.some(problem => /same reviewer|lacks a source-cited|lacks a judgement|unfrozen topic/.test(problem))) {
    return { passed: false, reviewerPasses, adjudicated: false, problems };
  }
  if (reviewerPasses.every(Boolean)) return { passed: true, reviewerPasses, adjudicated: false, problems };
  // Overall-verdict comparison: two failing reviews fail the gate even when they failed different topics.
  if (!reviewerPasses.some(Boolean)) return { passed: false, reviewerPasses, adjudicated: false, problems: [...problems, "Both reviewers failed the answer"] };
  if (!lock.adjudication) return { passed: false, reviewerPasses, adjudicated: false, problems: [...problems, "Reviewer disagreement is unresolved"] };
  try {
    if (await digestFile(lock.adjudication.path) !== lock.adjudication.sha256) throw new Error("adjudication changed after recording");
    const adj = JSON.parse(await readFile(lock.adjudication.path, "utf8")) as PilotGrade & { recordedAt?: string; resolvesAsPass?: boolean; rationale?: string } & Record<string, unknown>;
    for (const [key, value] of Object.entries(expected)) if ((adj as Record<string, unknown>)[key] !== value) throw new Error(`binds a different ${key}`);
    if (!adj.reviewer || grades.some(grade => grade.reviewer === adj.reviewer)) throw new Error("adjudicator is not a third, fresh reviewer");
    if (!adj.recordedAt || !Number.isFinite(Date.parse(adj.recordedAt))) throw new Error("adjudication lacks a valid recording time");
    if (grades.some(grade => Date.parse(adj.recordedAt!) <= Date.parse(grade.lockedAt))) throw new Error("adjudication predates a locked grade");
    if (adj.resolvesAsPass !== true || !adj.rationale?.trim()) throw new Error("adjudication does not resolve the disagreement as a pass");
    // Whole-answer adjudication: a complete source-cited grade in which every criterion, including each failed one, passes.
    const adjProblems: string[] = [];
    if (!gradePasses(adj, adjProblems, "Adjudication")) throw new Error(`whole-answer adjudication does not pass every criterion${adjProblems.length ? `: ${adjProblems.join("; ")}` : ""}`);
    return { passed: true, reviewerPasses, adjudicated: true, problems };
  } catch (error) {
    return { passed: false, reviewerPasses, adjudicated: false, problems: [...problems, `Adjudication: ${String(error)}`] };
  }
}

export async function fileExists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}
