// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// rh-v8 study plans (SUITE-PROTOCOL.md, Study Plans). A plan is an immutable
// JSON file that freezes one authorised series: pair count, pair concurrency,
// root, deterministic schedule, shared ceiling, prior settlements and the
// owner directions that authorise it. Preparing a plan grants nothing: every
// live command also needs an implementation acceptance that binds the plan's
// digest, and the plan is re-verified against its owner directions each time.
// Nothing here dispatches work, reads credentials or touches the network.

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { digestFile, digestObject, writeNewJson } from "./storage.js";
import { verifyPriorSettlements } from "./pilot-repeat.js";
import { rh6Params, rh6Settings } from "./pilot-continuation.js";
import { PILOT_SERIES_ROOT, type PilotDefinition, type PriorSettlement } from "./pilot-config.js";
import {
  HISTORICAL_PRIOR_SETTLEMENTS, RH8_BASE, RH8_CLARIFICATION, RH8_CONCURRENCY_DIRECTION_SHA256, RH8_OWNER_DIRECTION_SHA256, RH8_PROTOCOL_REVISION,
  RH8_SCOPE, SUITE_MAX_PAIRS, SUITE_MIN_GAP_MS, SUITE_REPO_ROOT, SUITE_RESERVATIONS, assertScheduleBounds, suiteSchedule, type SuiteSlotSpec,
} from "./pilot-suite.js";

export const PLAN_KIND = "paired-suite-plan" as const;
export const ORDER_RULE = "Waves of parallelPairs consecutive pairs; a wave starts after every pair of the previous wave has ended. Odd pairs run baseline then candidate, even pairs candidate then baseline; the second arm of a pair starts at least 30 seconds after its first arm ends, and the two arms of a pair never overlap." as const;
/** Authorises the current ten-pair series only: its base direction and the owner's concurrency amendment, by exact digest. */
export const AUTHORITY_CURRENT = "rh-v8-owner-and-concurrency-amendment" as const;
/** Generic future authority: one owner direction in the paired-suite format naming every plan parameter. */
export const AUTHORITY_GENERIC = "paired-suite-owner-direction" as const;
export const GENERIC_RECORD_TYPE = "owner-direction-paired-suite" as const;

export interface StudyPlan {
  schemaVersion: 1;
  kind: typeof PLAN_KIND;
  revision: typeof RH8_PROTOCOL_REVISION;
  scope: string;
  seriesRoot: string;
  pairs: number;
  parallelPairs: number;
  waves: number;
  minGapMs: number;
  orderRule: string;
  schedule: SuiteSlotSpec[];
  firstArmCounts: { baseline: number; candidate: number };
  budget: {
    combinedCeilingNanoUsd: number;
    priorReportedNanoUsd: number;
    priorSettlements: PriorSettlement[];
    headroomNanoUsd: number;
    qualificationNanoUsd: number;
    conversationNanoUsd: number;
    m3AttemptNanoUsd: number;
    sonarAttemptNanoUsd: number;
    peakConcurrentReservationNanoUsd: number;
    maxParallelPairsWithinCeiling: number;
    worstCaseAllConversationsNanoUsd: number;
  };
  authority: { kind: typeof AUTHORITY_CURRENT | typeof AUTHORITY_GENERIC; directions: Array<{ role: "base" | "amendment" | "direction"; path: string; sha256: string }> };
  corpus: { path: string; sha256: string; digest: string; sourceSeries: string };
  study: { settingsSha256: string; paramsSha256: string; protocolRevision: string };
  note: string;
}

/** Parses a decimal USD amount exactly into nano-USD; no floating point. */
export function parseUsdToNano(text: string): number {
  if (!/^\d{1,6}(\.\d{1,9})?$/.test(text)) throw new Error("budget-usd must be a decimal amount such as 10 or 9.5 (at most nine decimals)");
  const [whole, fraction = ""] = text.split(".");
  const nano = Number(whole) * 1_000_000_000 + Number(fraction.padEnd(9, "0"));
  if (!Number.isSafeInteger(nano) || nano <= 0) throw new Error("budget-usd must be positive");
  return nano;
}

const same = (a: unknown, b: unknown) => digestObject(a) === digestObject(b);
const exists = async (path: string) => { try { await stat(path); return true; } catch { return false; } };
function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a JSON object`);
  return value as Record<string, unknown>;
}
async function readObject(path: string, label: string): Promise<Record<string, unknown>> {
  try { return object(JSON.parse(await readFile(path, "utf8")), label); }
  catch (error) { throw new Error(`${label} is unreadable at ${path}: ${String(error)}`); }
}

function budgetFor(ceiling: number, prior: number, priorSettlements: PriorSettlement[], pairs: number, parallelPairs: number): StudyPlan["budget"] {
  const r = SUITE_RESERVATIONS, headroom = ceiling - prior;
  const maxParallel = Math.floor(headroom / r.conversationNanoUsd);
  if (headroom <= 0 || r.qualificationNanoUsd + r.conversationNanoUsd > headroom) throw new Error("The ceiling leaves no room for qualification and one conversation after prior charges");
  if (parallelPairs > maxParallel) throw new Error(`parallel-pairs ${parallelPairs} cannot all hold a USD 4.09 reservation at once within the ceiling; at most ${maxParallel}`);
  return { combinedCeilingNanoUsd: ceiling, priorReportedNanoUsd: prior, priorSettlements, headroomNanoUsd: headroom,
    qualificationNanoUsd: r.qualificationNanoUsd, conversationNanoUsd: r.conversationNanoUsd, m3AttemptNanoUsd: r.m3AttemptNanoUsd, sonarAttemptNanoUsd: r.sonarAttemptNanoUsd,
    peakConcurrentReservationNanoUsd: parallelPairs * r.conversationNanoUsd, maxParallelPairsWithinCeiling: maxParallel,
    worstCaseAllConversationsNanoUsd: 2 * pairs * r.conversationNanoUsd };
}

export interface PlanInput {
  pairs: number;
  parallelPairs: number;
  budgetUsd: string;
  root: string;
  directionPaths: string[];
}
/** Builds the plan object from its inputs and owner directions; `verifyStudyPlan` re-derives and checks it. */
export async function buildStudyPlan(input: PlanInput, options: { repoRoot?: string } = {}): Promise<StudyPlan> {
  assertScheduleBounds(input.pairs, input.parallelPairs);
  const ceiling = parseUsdToNano(input.budgetUsd);
  const root = resolve(input.root);
  const directions = [];
  for (const path of input.directionPaths) directions.push({ path: resolve(path), sha256: await digestFile(path), value: await readObject(path, "Owner direction") });
  let authority: StudyPlan["authority"], scope: string, prior: number, priorSettlements: PriorSettlement[];
  if (directions.length === 2) {
    authority = { kind: AUTHORITY_CURRENT, directions: [{ role: "base", path: directions[0].path, sha256: directions[0].sha256 }, { role: "amendment", path: directions[1].path, sha256: directions[1].sha256 }] };
    scope = String(directions[0].value.scope); prior = Number(directions[0].value.priorReportedNanoUsd); priorSettlements = [...HISTORICAL_PRIOR_SETTLEMENTS];
  } else if (directions.length === 1) {
    authority = { kind: AUTHORITY_GENERIC, directions: [{ role: "direction", path: directions[0].path, sha256: directions[0].sha256 }] };
    scope = String(directions[0].value.scope); prior = Number(directions[0].value.priorReportedNanoUsd);
    priorSettlements = (Array.isArray(directions[0].value.priorSettlements) ? directions[0].value.priorSettlements : []) as PriorSettlement[];
  } else throw new Error("A plan needs either the base direction and its concurrency amendment, or one paired-suite owner direction");
  const schedule = suiteSchedule(input.pairs, input.parallelPairs);
  const reuse = RH8_BASE.corpusReuse!;
  const plan: StudyPlan = {
    schemaVersion: 1, kind: PLAN_KIND, revision: RH8_PROTOCOL_REVISION, scope, seriesRoot: root,
    pairs: input.pairs, parallelPairs: input.parallelPairs, waves: Math.ceil(input.pairs / input.parallelPairs), minGapMs: SUITE_MIN_GAP_MS,
    orderRule: ORDER_RULE, schedule,
    firstArmCounts: { baseline: schedule.filter(s => s.position === 1 && s.arm === "baseline").length, candidate: schedule.filter(s => s.position === 1 && s.arm === "candidate").length },
    budget: budgetFor(ceiling, prior, priorSettlements, input.pairs, input.parallelPairs),
    authority, corpus: { path: reuse.path, sha256: reuse.sha256, digest: reuse.digest, sourceSeries: reuse.sourceSeries },
    study: { settingsSha256: digestObject(rh6Settings()), paramsSha256: digestObject(rh6Params()), protocolRevision: RH8_PROTOCOL_REVISION },
    note: "Immutable plan. It grants no dispatch authority by itself: an implementation acceptance must bind this file's SHA-256, and every live command re-verifies it against its owner directions.",
  };
  await verifyPlanObject(plan, options);
  return plan;
}
/** Prepares a new immutable plan file. Write-once; refuses a root that is already bound. */
export async function prepareStudyPlan(input: PlanInput, out: string, options: { repoRoot?: string } = {}): Promise<{ path: string; sha256: string; plan: StudyPlan }> {
  const plan = await buildStudyPlan(input, options);
  if (await exists(join(plan.seriesRoot, "pilot-root-binding.json"))) throw new Error("The plan root is already bound to a series; a new plan needs a new root");
  const path = resolve(out);
  writeNewJson(path, plan);
  return { path, sha256: await digestFile(path), plan };
}

/** Verifies the base direction and its concurrency amendment for the current series only. */
async function verifyCurrentAuthority(plan: StudyPlan): Promise<void> {
  const [base, amendment] = plan.authority.directions;
  if (plan.authority.directions.length !== 2 || base.role !== "base" || amendment.role !== "amendment") throw new Error("Current-series authority needs a base direction and an amendment");
  if (base.sha256 !== RH8_OWNER_DIRECTION_SHA256 || amendment.sha256 !== RH8_CONCURRENCY_DIRECTION_SHA256) throw new Error("Current-series authority accepts only the recorded rh-v8 direction and concurrency amendment");
  const d = await readObject(base.path, "Base direction"), a = await readObject(amendment.path, "Concurrency amendment");
  const current = object(a.currentSeries, "currentSeries");
  const clarification = object(d.clarificationBeforeFinalDirection, "clarificationBeforeFinalDirection");
  if (d.schemaVersion !== 1 || d.recordType !== "coordinator-transcription-of-owner-direction" || d.approved !== true || d.approvedBy !== "owner" || d.scope !== RH8_SCOPE
    || plan.scope !== d.scope || d.matchedPairs !== plan.pairs || d.paidConversations !== 2 * plan.pairs || d.replacementConversations !== 0
    || d.targetPrompt !== "unchanged" || d.corpusAndRubric !== "unchanged rh-v6 corpus and dual rubric"
    || d.combinedCeilingNanoUsd !== plan.budget.combinedCeilingNanoUsd || d.priorReportedNanoUsd !== plan.budget.priorReportedNanoUsd
    || d.priorUnknownNanoUsd !== 0 || d.priorActiveNanoUsd !== 0 || !same(clarification, RH8_CLARIFICATION) || resolve(String(d.designatedSeriesRoot)) !== plan.seriesRoot
    || a.schemaVersion !== 1 || a.approved !== true || a.approvedBy !== "owner" || a.scope !== "research-handoff-configurable-paired-suite"
    || a.supersedesScheduleOnly !== basename(base.path) || current.matchedPairs !== plan.pairs || current.parallelPairs !== plan.parallelPairs
    || current.combinedCeilingNanoUsd !== plan.budget.combinedCeilingNanoUsd || current.targetPrompt !== "unchanged" || current.corpusAndRubric !== "unchanged"
    || current.measuredHost !== RH8_CLARIFICATION.measuredHost || current.mainModel !== RH8_CLARIFICATION.mainModel
    || !same(plan.budget.priorSettlements, HISTORICAL_PRIOR_SETTLEMENTS)) {
    throw new Error("Owner directions do not cover this plan's scope, pairs, concurrency, conversations, task, corpus, ceiling, prior total or root");
  }
}
/** Verifies a future owner direction in the paired-suite format: it must name every plan parameter. */
async function verifyGenericAuthority(plan: StudyPlan): Promise<void> {
  const [direction] = plan.authority.directions;
  if (plan.authority.directions.length !== 1 || direction.role !== "direction") throw new Error("A paired-suite plan needs exactly one owner direction");
  const d = await readObject(direction.path, "Owner direction");
  if (d.schemaVersion !== 1 || d.recordType !== GENERIC_RECORD_TYPE || d.approved !== true || d.approvedBy !== "owner"
    || typeof d.scope !== "string" || !d.scope.trim() || d.scope === RH8_SCOPE || plan.scope !== d.scope
    || d.matchedPairs !== plan.pairs || d.parallelPairs !== plan.parallelPairs || d.replacementConversations !== 0
    || d.targetPrompt !== "unchanged" || d.corpusAndRubric !== "unchanged rh-v6 corpus and dual rubric"
    || d.measuredHost !== RH8_CLARIFICATION.measuredHost || d.mainModel !== RH8_CLARIFICATION.mainModel
    || d.combinedCeilingNanoUsd !== plan.budget.combinedCeilingNanoUsd || d.priorReportedNanoUsd !== plan.budget.priorReportedNanoUsd
    || d.priorUnknownNanoUsd !== 0 || d.priorActiveNanoUsd !== 0 || !same(d.priorSettlements, plan.budget.priorSettlements)
    || resolve(String(d.designatedSeriesRoot)) !== plan.seriesRoot) {
    throw new Error("Owner direction does not cover this plan's scope, pairs, concurrency, task, corpus, ceiling, prior settlements or root");
  }
}

/**
 * Every earlier settlement must be counted: the historical three and every other suite root in
 * this checkout's evidence tree. Another suite root that is bound but unsettled holds open
 * liabilities, so no new plan may proceed beside it.
 */
async function verifyPriorCompleteness(plan: StudyPlan, repoRoot: string): Promise<void> {
  const listed = new Set(plan.budget.priorSettlements.map(item => resolve(item.path)));
  for (const historical of HISTORICAL_PRIOR_SETTLEMENTS) if (!listed.has(resolve(historical.path))) throw new Error(`Plan omits the prior settlement ${historical.path}`);
  const base = join(repoRoot, "evidence/benchmarks/research-handoff");
  let names: string[] = [];
  try { names = await readdir(base); } catch { return; }
  for (const name of names) {
    const root = join(base, name);
    if (resolve(root) === plan.seriesRoot) continue;
    let binding: Record<string, unknown>;
    try { binding = JSON.parse(await readFile(join(root, "pilot-root-binding.json"), "utf8")) as Record<string, unknown>; } catch { continue; }
    if (binding.protocolRevision !== RH8_PROTOCOL_REVISION) continue;
    const settlement = join(root, "settlement-receipt.json");
    if (!await exists(settlement)) throw new Error(`Suite root ${name} is bound but unsettled; settle it before another plan`);
    if (!listed.has(resolve(settlement))) throw new Error(`Plan omits the prior suite settlement ${settlement}`);
  }
}

async function verifyPlanObject(plan: StudyPlan, options: { repoRoot?: string }): Promise<void> {
  if (plan.schemaVersion !== 1 || plan.kind !== PLAN_KIND || plan.revision !== RH8_PROTOCOL_REVISION) throw new Error("Not an rh-v8 paired-suite plan");
  assertScheduleBounds(plan.pairs, plan.parallelPairs);
  if (resolve(plan.seriesRoot) !== plan.seriesRoot || [PILOT_SERIES_ROOT, ...(RH8_BASE.closedRoots ?? [])].some(closed => resolve(closed) === plan.seriesRoot)) {
    throw new Error("Plan root must be an absolute new series root, never a closed earlier root");
  }
  if (!same(plan.schedule, suiteSchedule(plan.pairs, plan.parallelPairs)) || plan.waves !== Math.ceil(plan.pairs / plan.parallelPairs)
    || plan.minGapMs !== SUITE_MIN_GAP_MS || plan.orderRule !== ORDER_RULE) throw new Error("Plan schedule differs from the deterministic schedule");
  const b = plan.budget;
  if (!Number.isSafeInteger(b.combinedCeilingNanoUsd) || !Number.isSafeInteger(b.priorReportedNanoUsd) || b.priorReportedNanoUsd < 0
    || !same(b, budgetFor(b.combinedCeilingNanoUsd, b.priorReportedNanoUsd, b.priorSettlements, plan.pairs, plan.parallelPairs))) {
    throw new Error("Plan budget differs from the frozen reservations and shared-ceiling arithmetic");
  }
  const reported = await verifyPriorSettlements(b.priorSettlements);
  if (reported !== b.priorReportedNanoUsd) throw new Error("Prior settlements do not sum to the plan's prior total");
  const reuse = RH8_BASE.corpusReuse!;
  if (!same(plan.corpus, { path: reuse.path, sha256: reuse.sha256, digest: reuse.digest, sourceSeries: reuse.sourceSeries })
    || !same(plan.study, { settingsSha256: digestObject(rh6Settings()), paramsSha256: digestObject(rh6Params()), protocolRevision: RH8_PROTOCOL_REVISION })) {
    throw new Error("Plan corpus, settings or parameters differ from the frozen rh-v6 study");
  }
  for (const direction of plan.authority.directions) if (await digestFile(direction.path) !== direction.sha256) throw new Error(`Owner direction bytes changed at ${direction.path}`);
  if (plan.authority.kind === AUTHORITY_CURRENT) await verifyCurrentAuthority(plan);
  else if (plan.authority.kind === AUTHORITY_GENERIC) await verifyGenericAuthority(plan);
  else throw new Error("Unknown plan authority kind");
  await verifyPriorCompleteness(plan, options.repoRoot ?? SUITE_REPO_ROOT);
}

export interface VerifiedPlan { plan: StudyPlan; path: string; sha256: string; definition: PilotDefinition }
/** Reads a plan file, checks its digest when given, re-verifies it and returns the runnable definition. */
export async function verifyStudyPlan(path: string, expectedSha256?: string, options: { repoRoot?: string } = {}): Promise<VerifiedPlan> {
  const sha256 = await digestFile(path);
  if (expectedSha256 !== undefined && sha256 !== expectedSha256) throw new Error("Study plan bytes differ from the accepted digest");
  const plan = await readObject(path, "Study plan") as unknown as StudyPlan;
  await verifyPlanObject(plan, options);
  return { plan, path: resolve(path), sha256, definition: definitionFromPlan(plan, resolve(path), sha256) };
}

/** The runnable definition: frozen study content plus the plan's scope, root, counts and money. */
export function definitionFromPlan(plan: StudyPlan, planPath: string, planSha256: string): PilotDefinition {
  const b = plan.budget, primary = plan.authority.directions[0];
  return Object.freeze({
    ...RH8_BASE, scope: plan.scope, seriesRoot: plan.seriesRoot, ownerDecisionPath: primary.path, ownerDecisionSha256: primary.sha256,
    operationLimits: { ...RH8_BASE.operationLimits, paidEndToEndConversations: 2 * plan.pairs },
    budget: { ...RH8_BASE.budget, totalNanoUsd: b.headroomNanoUsd },
    cumulative: Object.freeze({ combinedCeilingNanoUsd: b.combinedCeilingNanoUsd, priorReportedNanoUsd: b.priorReportedNanoUsd, priorSettlements: b.priorSettlements }),
    suite: Object.freeze({ pairs: plan.pairs, parallelPairs: plan.parallelPairs, conversationReservationNanoUsd: b.conversationNanoUsd, planPath, planSha256 }),
  });
}
export const PLAN_BOUNDS = { maxPairs: SUITE_MAX_PAIRS } as const;
