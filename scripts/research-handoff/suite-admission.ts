// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// rh-v8 schedule state and admission with bounded pair concurrency
// (SUITE-PROTOCOL.md, Schedule, Stop Rules). The controller, the worker and the
// rehearsal read the same retained evidence: claims, records, the shared
// ledger, interruption records and the controller lock. The next admissions
// come from a pure planner over that state, never from the caller.
// Nothing here dispatches work, reads credentials or touches the network.

import { hostname } from "node:os";
import { lstat, mkdir, readdir, readFile, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FrozenInputs, RunRecord } from "./contracts.js";
import { loadFrozenInputs } from "./common-inputs.js";
import { digestFile, digestObject } from "./storage.js";
import { pilotChecksFor } from "./pilot-checks.js";
import { type PilotDefinition } from "./pilot-config.js";
import { readPilotClaim, verifyStageReceipt, type VerifiedPilotAuthority } from "./pilot-authority.js";
import { SUITE_MIN_GAP_MS, SUITE_REPO_ROOT, SUITE_SLOT_PATTERN, suiteRunId, suiteSchedule, type SuiteSlotSpec } from "./pilot-suite.js";
import { ledgerRows, readSuiteLedger } from "./suite-ledger.js";

export { SUITE_REPO_ROOT } from "./pilot-suite.js";
const exists = async (path: string) => { try { await stat(path); return true; } catch { return false; } };

/**
 * Refuses collection while the checkout-root `.search` exists in any form: a directory,
 * a file or a symlink, including a dangling one (lstat, not stat). It never removes it.
 */
export async function assertNoCheckoutRootCache(repoRoot = SUITE_REPO_ROOT): Promise<void> {
  const path = join(repoRoot, ".search");
  let kind: string;
  try {
    const entry = await lstat(path);
    kind = entry.isSymbolicLink() ? "symlink" : entry.isDirectory() ? "directory" : "file";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new Error(`Cannot establish absence of the checkout-root .search at ${path}: ${String(error)}`);
  }
  throw new Error(`The checkout-root .search exists as a ${kind} at ${path}; preserve and isolate it before collection. It is never cleared by the runner.`);
}

export interface SuiteContext {
  root: string;
  definition: PilotDefinition;
  phase: "pilot" | "pilot-synthetic";
  codeSha256: string;
  protocolSha256: string;
  implementationAcceptanceSha256?: string;
  /** 30 seconds for live collection; the rehearsal may shorten it. */
  minGapMs: number;
}
export function suiteContextFor(authority: VerifiedPilotAuthority): SuiteContext {
  if (!authority.definition.suite) throw new Error(`${authority.definition.revision} has no bound study plan`);
  return { root: authority.root, definition: authority.definition, phase: "pilot", codeSha256: authority.acceptance.codeSha256,
    protocolSha256: authority.acceptance.protocolSha256, implementationAcceptanceSha256: authority.acceptanceSha256, minGapMs: SUITE_MIN_GAP_MS };
}
export function scheduleFor(definition: PilotDefinition): SuiteSlotSpec[] {
  if (!definition.suite) throw new Error(`${definition.revision} has no bound study plan`);
  return suiteSchedule(definition.suite.pairs, definition.suite.parallelPairs);
}

// ---------------------------------------------------------------------------
// Controller exclusion
// ---------------------------------------------------------------------------

export const CONTROLLER_LOCK = "controller.lock";
/**
 * Exclusive controller lock: one directory created atomically. A stale lock is never cleared
 * automatically; release after a crash needs a verified interruption record (`rh8-interrupt`).
 */
export async function acquireControllerLock(root: string, command: string): Promise<{ release: () => Promise<void> }> {
  const path = join(root, CONTROLLER_LOCK);
  try { await mkdir(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    let owner = "unknown owner";
    try { owner = await readFile(join(path, "owner.json"), "utf8"); } catch { /* lock without owner record */ }
    throw new Error(`Another suite controller holds ${path} (${owner.trim()}). It is never cleared automatically: confirm no controller or worker runs, then release it with rh8-interrupt and a verified receipt.`);
  }
  await writeFile(join(path, "owner.json"), JSON.stringify({ pid: process.pid, hostname: hostname(), command, acquiredAt: new Date().toISOString() }) + "\n", { flag: "wx", mode: 0o600 });
  let released = false;
  return { release: async () => { if (released) return; released = true; await rm(join(path, "owner.json")); await rmdir(path); } };
}
export async function controllerLockHeld(root: string): Promise<boolean> { return exists(join(root, CONTROLLER_LOCK)); }

// ---------------------------------------------------------------------------
// Slot and schedule state
// ---------------------------------------------------------------------------

export type SlotStatus = "unclaimed" | "in-flight" | "interrupted" | "terminal";
export interface SuiteSlotState extends SuiteSlotSpec {
  runId: string;
  status: SlotStatus;
  claimed: boolean;
  dispatched: boolean;
  terminal: boolean;
  reserved: boolean;
  recordSha256?: string;
  startedAt?: string;
  endedAt?: string;
  claimedAt?: string;
  machinePassed?: boolean;
  failingChecks: string[];
  budgetReceipt: boolean;
  financial?: { knownNanoUsd: number; unknownNanoUsd: number; activeNanoUsd: number; rejected: number; overruns: number };
  /** True only for a terminal record whose continuation is safe (Stop Rules). */
  safe: boolean;
  stopReasons: string[];
}
/** Checks whose failure stops new admissions: execution safety and money, never answer content. */
export const SUITE_STOP_CHECKS = ["analysable", "inputs-and-settings-match", "financial-accounting-known", "final-budget-receipt"] as const;

export async function readSlotState(ctx: SuiteContext, spec: SuiteSlotSpec, frozen: Pick<FrozenInputs, "pages" | "digest">, reservedIds: ReadonlySet<string>): Promise<SuiteSlotState> {
  const runId = suiteRunId(ctx.root, spec), directory = join(ctx.root, "runs", runId);
  const claim = await readPilotClaim(ctx.root, spec.slot as `pair-${string}`);
  const dispatched = await exists(join(ctx.root, "claims", spec.slot, "dispatched"));
  const terminal = await exists(join(directory, "record.json"));
  const interrupted = !terminal && await exists(join(ctx.root, "interruptions", `${spec.slot}.json`));
  const base: SuiteSlotState = { ...spec, runId, status: !claim ? "unclaimed" : terminal ? "terminal" : interrupted ? "interrupted" : "in-flight",
    claimed: !!claim, dispatched, terminal, reserved: reservedIds.has(spec.slot), failingChecks: [], budgetReceipt: false, safe: false, stopReasons: [],
    ...(claim ? { claimedAt: String(claim.claimedAt) } : {}) };
  if (!claim) return base;
  const reasons = base.stopReasons;
  if (claim.runId !== runId || claim.slot !== spec.slot || claim.pair !== spec.pair || claim.arm !== spec.arm || claim.scheduleIndex !== spec.index || claim.wave !== spec.wave
    || claim.corpusSha256 !== frozen.digest || (ctx.implementationAcceptanceSha256 ?? null) !== (claim.implementationAcceptanceSha256 ?? null)) {
    reasons.push("Claim does not bind this slot, wave, run, corpus and implementation");
  }
  if (!base.reserved) reasons.push("Claimed slot has no ledger reservation");
  if (interrupted) { reasons.push("Interrupted: no terminal record; the full reservation is held"); return base; }
  if (!terminal) return base;
  const checks = await pilotChecksFor(directory, frozen, "known-charges");
  base.machinePassed = checks.passed;
  base.failingChecks = checks.checks.filter(check => !check.pass).map(check => check.id);
  base.budgetReceipt = checks.budgetReceipt;
  base.financial = checks.financial;
  let record: RunRecord | undefined;
  try { record = JSON.parse(await readFile(join(directory, "record.json"), "utf8")) as RunRecord; }
  catch (error) { reasons.push(`Record unreadable: ${String(error)}`); }
  if (record) {
    base.recordSha256 = digestObject(record);
    base.startedAt = record.manifest?.startedAt; base.endedAt = record.manifest?.endedAt;
    const m = record.manifest;
    if (m?.runId !== runId || m.arm !== spec.arm || m.pair !== spec.pair || m.phase !== ctx.phase || m.codeSha256 !== ctx.codeSha256
      || m.protocolSha256 !== ctx.protocolSha256 || m.corpusSha256 !== frozen.digest) reasons.push("Record identity differs from the scheduled slot");
    if (m?.status === "not-run") reasons.push("Record states that the slot did not run");
    if (record.error) reasons.push(`Worker error: ${record.error}`);
    if (!m?.endedAt || !Number.isFinite(Date.parse(m.endedAt))) reasons.push("Record has no valid end time");
  }
  if (!dispatched) reasons.push("Claimed slot has no dispatch witness");
  for (const id of SUITE_STOP_CHECKS) if (base.failingChecks.includes(id)) reasons.push(`Stop check failed: ${id}`);
  const f = checks.financial;
  if (!checks.budgetReceipt || f.unknownNanoUsd || f.activeNanoUsd || f.rejected || f.overruns) reasons.push("Final charges are not known: an unknown hold, active reservation, refusal, overrun or missing receipt");
  base.safe = reasons.length === 0;
  return base;
}

export interface SuiteCollectionState {
  slots: SuiteSlotState[];
  integrityProblems: string[];
  /** Every claimed slot whose outcome forbids new admissions (terminal unsafe or interrupted). */
  stops: Array<{ slot: string; reasons: string[] }>;
  /** Claimed slots without a terminal record or interruption record: running, or awaiting inspection. */
  inFlight: string[];
  closure?: Record<string, unknown>;
  closureSha256?: string;
  controllerLocked: boolean;
  complete: boolean;
  claimed: number;
  ledger: { knownNanoUsd: number; unknownNanoUsd: number; activeNanoUsd: number; availableNanoUsd: number; active: Record<string, number>; sha256: string } | null;
}

export async function suiteCollectionState(ctx: SuiteContext, frozen: Pick<FrozenInputs, "pages" | "digest">): Promise<SuiteCollectionState> {
  const schedule = scheduleFor(ctx.definition);
  let ledger: SuiteCollectionState["ledger"] = null;
  const reserved = new Set<string>();
  const integrityProblems: string[] = [];
  try {
    const balance = await readSuiteLedger(ctx.root);
    ledger = { knownNanoUsd: balance.knownNanoUsd, unknownNanoUsd: balance.unknownNanoUsd, activeNanoUsd: Object.values(balance.active).reduce((a, b) => a + b, 0),
      availableNanoUsd: balance.availableNanoUsd, active: balance.active, sha256: balance.sha256 };
    for (const row of await ledgerRows(ctx.root)) if (row.kind === "reserve") reserved.add(String(row.runId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") integrityProblems.push(`Ledger unreadable or invalid: ${String(error)}`);
  }
  const slots: SuiteSlotState[] = [];
  for (const spec of schedule) slots.push(await readSlotState(ctx, spec, frozen, reserved));
  // Order integrity: a second arm only after its first arm ended; a wave only after every earlier pair ended.
  for (const slot of slots.filter(item => item.claimed)) {
    if (slot.position === 2) {
      const first = slots.find(item => item.pair === slot.pair && item.position === 1)!;
      if (!first.terminal || !first.endedAt || Date.parse(String(slot.claimedAt)) < Date.parse(first.endedAt)) integrityProblems.push(`${slot.slot} was claimed before its pair's first arm ended`);
    }
    const earlier = slots.filter(item => item.wave < slot.wave);
    if (earlier.some(item => !item.terminal && item.status !== "interrupted")) integrityProblems.push(`${slot.slot} was claimed before every earlier wave ended`);
  }
  let claimDirs: string[] = [];
  try { claimDirs = await readdir(join(ctx.root, "claims")); } catch { /* none yet */ }
  const known = new Set(schedule.map(spec => spec.slot));
  for (const name of claimDirs) {
    if (SUITE_SLOT_PATTERN.test(name) && !known.has(name)) integrityProblems.push(`Unscheduled conversation claim ${name}`);
    if (name === "pilot-baseline" || name === "pilot-candidate" || name === "capture") integrityProblems.push(`Single-pair or capture claim ${name} is not authorised in a suite`);
  }
  let closure: Record<string, unknown> | undefined, closureSha256: string | undefined;
  const closurePath = join(ctx.root, "collection-closure.json");
  if (await exists(closurePath)) { closure = JSON.parse(await readFile(closurePath, "utf8")) as Record<string, unknown>; closureSha256 = await digestFile(closurePath); }
  return {
    slots, integrityProblems,
    stops: slots.filter(slot => slot.claimed && slot.status !== "in-flight" && !slot.safe).map(slot => ({ slot: slot.slot, reasons: slot.stopReasons })),
    inFlight: slots.filter(slot => slot.status === "in-flight").map(slot => slot.slot),
    ...(closure ? { closure, closureSha256 } : {}), controllerLocked: await controllerLockHeld(ctx.root),
    complete: slots.every(slot => slot.terminal), claimed: slots.filter(slot => slot.claimed).length, ledger,
  };
}

/** Why no further conversation may be admitted, or null when admissions may continue. */
/**
 * `active` names slots the caller is still running or settling: their outcome is not final until the
 * worker task has ended and its reservation settled, so they are classified on the next pass.
 */
export function admissionsBlocked(state: SuiteCollectionState, active: ReadonlySet<string> = new Set()): string | null {
  if (state.integrityProblems.length) return `Schedule integrity failure: ${state.integrityProblems.join("; ")}`;
  const stops = state.stops.filter(stop => !active.has(stop.slot));
  if (stops.length) return `New admissions stopped at ${stops.map(stop => `${stop.slot} (${stop.reasons.join("; ")})`).join(", ")}`;
  if (state.closure) return "Collection is closed";
  return null;
}

export interface AdmissionPlan {
  /** Slots that may be admitted now, in launch order. */
  admit: SuiteSlotSpec[];
  /** Earliest time a waiting second arm becomes eligible, if any. */
  wakeAt: number | null;
  wave: number | null;
  blocked: string | null;
  done: boolean;
}
/**
 * Pure admission planner. `active` names the slots this controller is running; any other
 * in-flight slot is unresolved and blocks admission. Within the current wave, a pair with no
 * conversation in flight admits its first arm, or its second arm once the first ended safely and
 * the gap elapsed. A pair is never admitted twice at once, and no later wave starts early.
 */
export function planAdmissions(state: SuiteCollectionState, active: ReadonlySet<string>, now: number, minGapMs: number): AdmissionPlan {
  const blocked = admissionsBlocked(state, active);
  const unresolved = state.inFlight.filter(slot => !active.has(slot));
  if (unresolved.length) return { admit: [], wakeAt: null, wave: null, blocked: `In-flight slot(s) without a terminal record and not run by this controller: ${unresolved.join(", ")}; inspect them and record an interruption before continuing`, done: false };
  if (blocked) return { admit: [], wakeAt: null, wave: null, blocked, done: false };
  // A running slot whose record already exists is settling: its outcome is not final, so nothing is admitted until it settles.
  const settling = state.slots.filter(slot => active.has(slot.slot) && slot.terminal).map(slot => slot.slot);
  const pairDone = (pair: number) => state.slots.filter(slot => slot.pair === pair).every(slot => slot.terminal);
  const pending = state.slots.filter(slot => !pairDone(slot.pair));
  if (!pending.length) return { admit: [], wakeAt: null, wave: null, blocked: null, done: true };
  const wave = Math.min(...pending.map(slot => slot.wave));
  if (settling.length) return { admit: [], wakeAt: null, wave, blocked: null, done: false };
  const admit: SuiteSlotSpec[] = [];
  let wakeAt: number | null = null;
  const pairs = [...new Set(state.slots.filter(slot => slot.wave === wave).map(slot => slot.pair))].sort((a, b) => a - b);
  for (const position of [1, 2] as const) for (const pair of pairs) {
    const arms = state.slots.filter(slot => slot.pair === pair);
    if (arms.some(slot => slot.status === "in-flight" || active.has(slot.slot)) || admit.some(spec => spec.pair === pair)) continue;
    const slot = arms.find(item => item.position === position)!;
    if (slot.claimed) continue;
    if (position === 1) { admit.push(strip(slot)); continue; }
    const first = arms.find(item => item.position === 1)!;
    if (!first.terminal || !first.safe) continue;
    const eligible = Date.parse(String(first.endedAt)) + minGapMs;
    if (now >= eligible) admit.push(strip(slot)); else wakeAt = wakeAt === null ? eligible : Math.min(wakeAt, eligible);
  }
  return { admit, wakeAt, wave, blocked: null, done: false };
}
function strip(slot: SuiteSlotState): SuiteSlotSpec {
  return { index: slot.index, wave: slot.wave, pair: slot.pair, position: slot.position, arm: slot.arm, slot: slot.slot };
}

/**
 * Worker-side re-derivation: the slot is claimed, reserved in the ledger at the full conversation
 * reservation, undispatched and without a record; admissions are not blocked; every earlier wave
 * has ended; a second arm's first arm ended safely at least the gap before now.
 */
export async function verifyWorkerSlot(ctx: SuiteContext, frozen: Pick<FrozenInputs, "pages" | "digest">, spec: SuiteSlotSpec, now: number, repoRoot?: string): Promise<void> {
  await assertNoCheckoutRootCache(repoRoot);
  const state = await suiteCollectionState(ctx, frozen);
  const own = state.slots[spec.index];
  if (state.integrityProblems.length) throw new Error(`Schedule integrity failure: ${state.integrityProblems.join("; ")}`);
  if (state.closure) throw new Error("Collection is closed");
  // Admitted work drains: only a stop the controller knew before this slot's reservation refuses it. The ledger is the
  // controller's total order of knowledge: a slot is classified only after its settlement row, so a stop counts here
  // when its settlement precedes this slot's reservation. Clock times are not compared.
  const rows = await ledgerRows(ctx.root);
  const ownReserve = rows.findIndex(row => row.kind === "reserve" && row.runId === spec.slot);
  const prior = state.stops.filter(stop => {
    if (stop.slot === spec.slot) return false;
    const settled = rows.findIndex(row => row.kind === "settle" && row.runId === stop.slot);
    return ownReserve < 0 || (settled >= 0 && settled < ownReserve);
  });
  if (prior.length) throw new Error(`New admissions stopped at ${prior.map(stop => stop.slot).join(", ")} before ${spec.slot} was reserved`);
  if (own.slot !== spec.slot || own.status !== "in-flight" || own.dispatched) throw new Error(`${spec.slot} is not a claimed, undispatched slot without a record`);
  if (state.ledger?.active[spec.slot] !== ctx.definition.suite!.conversationReservationNanoUsd) throw new Error(`${spec.slot} has no active ledger reservation of the full conversation allowance`);
  if (state.slots.some(slot => slot.wave < spec.wave && !slot.terminal)) throw new Error(`${spec.slot} belongs to a wave that has not started`);
  if (spec.position === 2) {
    const first = state.slots.find(slot => slot.pair === spec.pair && slot.position === 1)!;
    const ended = Date.parse(String(first.endedAt));
    if (!first.terminal || !first.safe || !Number.isFinite(ended) || now - ended < ctx.minGapMs) throw new Error(`${spec.slot} must start at least ${ctx.minGapMs / 1000} seconds after its pair's first arm ended safely`);
  }
}

/** Live preparation gates: financial admission, corpus import, corpus acceptance and a qualification settled with known charges. */
export async function verifySuitePreparation(authority: VerifiedPilotAuthority, corpusAcceptancePath: string): Promise<{
  corpusSha256: string; frozenPath: string; frozen: FrozenInputs; qualificationKnownNanoUsd: number; corpusAcceptanceSha256: string }> {
  const root = authority.root, reuse = authority.definition.corpusReuse;
  if (!reuse || !authority.definition.suite) throw new Error(`${authority.definition.revision} is not a plan-bound suite`);
  await verifyStageReceipt(join(root, "financial-admission-receipt.json"), "pilot-financial-admission", authority);
  const frozenPath = join(root, "corpus-import", "frozen-inputs.json");
  await verifyStageReceipt(join(root, "corpus-import", "outcome.json"), "pilot-corpus-import-outcome", authority,
    { corpusSha256: reuse.digest, frozenFileSha256: reuse.sha256, newSearchChargeNanoUsd: 0 });
  if (await digestFile(frozenPath) !== reuse.sha256) throw new Error("Imported corpus bytes differ from the retained source");
  const corpus = await verifyStageReceipt(corpusAcceptancePath, "pilot-corpus-acceptance", authority, { corpusSha256: reuse.digest });
  if (typeof corpus.reviewer !== "string" || !corpus.reviewPath || await digestFile(String(corpus.reviewPath)) !== corpus.reviewSha256
    || typeof corpus.readableSelectedPages !== "number" || corpus.readableSelectedPages < 2) {
    throw new Error("Corpus acceptance lacks a reviewer, immutable review or at least two readable selected pages");
  }
  await verifyStageReceipt(join(root, "charge-qualification", "outcome.json"), "pilot-charge-qualification-outcome", authority,
    { corpusSha256: reuse.digest, m3ReportedCharge: true });
  let budget: Record<string, unknown>;
  try { budget = JSON.parse(await readFile(join(root, "charge-qualification", "budget.json"), "utf8")) as Record<string, unknown>; }
  catch (error) { throw new Error(`Qualification has no final budget receipt: ${String(error)}`); }
  if (budget.limitNanoUsd !== authority.definition.budget.qualificationNanoUsd || !Number.isSafeInteger(budget.knownNanoUsd) || (budget.knownNanoUsd as number) < 0
    || budget.unknownNanoUsd !== 0 || budget.activeNanoUsd !== 0 || budget.stopped !== false) {
    throw new Error("Qualification final charges are not known");
  }
  const rows = await ledgerRows(root);
  const settled = rows.find(row => row.kind === "settle" && row.runId === "charge-qualification");
  if (!settled || settled.reportedNanoUsd !== budget.knownNanoUsd || settled.unknownNanoUsd !== 0) throw new Error("Qualification is not settled in the shared ledger with its known charge");
  const frozen = await loadFrozenInputs({ path: frozenPath });
  if (frozen.digest !== reuse.digest) throw new Error("Imported corpus digest changed");
  return { corpusSha256: frozen.digest, frozenPath, frozen, qualificationKnownNanoUsd: budget.knownNanoUsd as number,
    corpusAcceptanceSha256: await digestFile(corpusAcceptancePath) };
}

/**
 * Grades follow collection: no controller holds the lock, no claimed slot is in flight, and the
 * schedule is complete, stopped or closed.
 */
export async function assertCollectionFinished(ctx: SuiteContext, frozen: Pick<FrozenInputs, "pages" | "digest">): Promise<SuiteCollectionState> {
  const state = await suiteCollectionState(ctx, frozen);
  if (state.integrityProblems.length) throw new Error(`Schedule integrity failure: ${state.integrityProblems.join("; ")}`);
  if (state.controllerLocked) throw new Error("Grades follow collection: a controller holds the lock");
  if (state.inFlight.length) throw new Error(`Grades follow collection: ${state.inFlight.join(", ")} claimed without a terminal record or interruption record`);
  if (!state.complete && !state.stops.length && !state.closure) throw new Error("Grades follow collection: the schedule is neither complete, stopped nor closed");
  return state;
}
