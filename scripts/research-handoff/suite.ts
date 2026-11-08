// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// rh-v8 suite operations (SUITE-PROTOCOL.md). Plans are prepared by
// study-plan.ts; this module runs the plan-bound operations: observation,
// admission with the shared ledger, corpus import, qualification, the single
// concurrent controller (collect and resume), interruption records, closure,
// the all-answer review bundle, per-answer gates, ledger settlement and the
// credential-free actual-host rehearsal. Every live operation re-verifies the
// acceptance and its bound plan.

import { randomInt } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { Arm, PilotSyntheticScenario, RunRecord } from "./contracts.js";
import { loadPinnedHost } from "./host.js";
import { MAIN_MODEL } from "./config.js";
import { assertCorpusAcceptable, loadFrozenInputs } from "./common-inputs.js";
import { createRunDirectory, digestFile, digestObject, sourceIdentity, writeNewJson } from "./storage.js";
import { executeWorker, REPO_ROOT, type WorkerConfig } from "./runner.js";
import { assertStoredCredentialReady } from "./credentials.js";
import {
  assessPilotAnswerGate, assessRecoveryPurpose, claimPilotSlot, markPilotDispatch, readPilotClaim, verifyPilotImplementation, verifyStageReceipt,
  type PilotAssessmentLock, type VerifiedPilotAuthority,
} from "./pilot-authority.js";
import { type AnyPilotSlot, type PilotDefinition } from "./pilot-config.js";
import {
  assertAllSelectedPagesCaptured, binding, pilotAdmit, pilotChecksFor, pilotImportCorpus, pilotManifest, pilotObserve, pilotProtocolSha256, pilotQualify,
  pilotReviewInputs, type PilotOperationOptions,
} from "./pilot.js";
import { HISTORICAL_PRIOR_REPORTED_NANO_USD, HISTORICAL_PRIOR_SETTLEMENTS, RH8_BASE, SUITE_RESERVATIONS, suiteRunId, type SuiteSlotSpec } from "./pilot-suite.js";
import {
  CONTROLLER_LOCK, acquireControllerLock, assertCollectionFinished, assertNoCheckoutRootCache, planAdmissions, scheduleFor, suiteCollectionState,
  suiteContextFor, verifySuitePreparation, type SuiteContext,
} from "./suite-admission.js";
import { createSuiteLedger, ledgerRows, readSuiteLedger, reserveSuiteStage, settleFromReceipt, settleSuiteStage } from "./suite-ledger.js";
import { analyseSuite } from "./suite-analysis.js";

export interface SuiteOperationOptions extends PilotOperationOptions {
  /** Test seam: the checkout whose root `.search` must be absent and whose evidence tree plan verification scans. */
  repoRoot?: string;
  /** Stops new admissions; admitted work drains and settles. The CLI wires SIGINT and SIGTERM to it. */
  signal?: AbortSignal;
}
const defaultCredentialCheck = async (authPath: string, provider: string) => {
  const { sdk } = await loadPinnedHost();
  assertStoredCredentialReady(sdk, authPath, provider);
};
const pathExists = async (path: string) => { try { await stat(path); return true; } catch { return false; } };
const entries = async (path: string) => (await readdir(path)).sort();
const sleep = (milliseconds: number) => new Promise<void>(done => setTimeout(done, Math.max(0, milliseconds)));

export async function suiteAuthority(acceptancePath: string, options: SuiteOperationOptions): Promise<VerifiedPilotAuthority> {
  const authority = await verifyPilotImplementation(acceptancePath, { ...options, definition: RH8_BASE });
  if (!authority.definition.suite) throw new Error("The acceptance binds no study plan");
  return authority;
}
async function withControllerLock<T>(root: string, command: string, work: () => Promise<T>): Promise<T> {
  const lock = await acquireControllerLock(root, command);
  try { return await work(); } finally { await lock.release(); }
}

// ---------------------------------------------------------------------------
// Preparation
// ---------------------------------------------------------------------------

export async function suiteObserve(acceptancePath: string, authPath: string, options: SuiteOperationOptions = {}) {
  const authority = await suiteAuthority(acceptancePath, options);
  await assertNoCheckoutRootCache(options.repoRoot);
  return withControllerLock(authority.root, "rh8-observe", () => pilotObserve(acceptancePath, authPath, { ...options, definition: RH8_BASE }));
}
/** Financial admission, then the shared ledger's genesis: ceiling and prior settled total from the plan. */
export async function suiteAdmit(acceptancePath: string, diagnosticAcceptancePath: string, options: SuiteOperationOptions = {}): Promise<string> {
  const authority = await suiteAuthority(acceptancePath, options);
  return withControllerLock(authority.root, "rh8-admit", async () => {
    const receipt = await pilotAdmit(acceptancePath, diagnosticAcceptancePath, { ...options, definition: RH8_BASE });
    await createSuiteLedger(authority.root, authority.definition);
    return receipt;
  });
}
export async function suiteImport(acceptancePath: string, options: SuiteOperationOptions = {}): Promise<string> {
  const authority = await suiteAuthority(acceptancePath, options);
  return withControllerLock(authority.root, "rh8-import", () => pilotImportCorpus(acceptancePath, { ...options, definition: RH8_BASE }));
}
/** The single qualification: its full USD 1.01 is reserved in the ledger first and released only by its known final charge. */
export async function suiteQualify(acceptancePath: string, authPath: string, corpusAcceptancePath: string, options: SuiteOperationOptions = {}): Promise<string> {
  const authority = await suiteAuthority(acceptancePath, options);
  await assertNoCheckoutRootCache(options.repoRoot);
  const root = authority.root, cap = authority.definition.budget.qualificationNanoUsd;
  return withControllerLock(root, "rh8-qualify", async () => {
    await reserveSuiteStage(root, "charge-qualification", cap);
    try { return await pilotQualify(acceptancePath, authPath, corpusAcceptancePath, { ...options, definition: RH8_BASE }); }
    finally {
      if (await readPilotClaim(root, "charge-qualification")) await settleFromReceipt(root, "charge-qualification", join(root, "charge-qualification", "budget.json"), cap);
      else await settleSuiteStage(root, "charge-qualification", 0, 0, "Refused before its claim: no model call was possible");
    }
  });
}

// ---------------------------------------------------------------------------
// Controller: bounded pair concurrency over the frozen waves
// ---------------------------------------------------------------------------

export interface ControllerCore {
  ctx: SuiteContext;
  frozen: Awaited<ReturnType<typeof loadFrozenInputs>>;
  frozenPath: string;
  execute: (cfg: WorkerConfig) => Promise<unknown>;
  /** Non-consuming checks immediately before each reservation and claim. */
  preClaim: (spec: SuiteSlotSpec) => Promise<void>;
  claimBinding: Record<string, unknown>;
  worker?: { acceptancePath: string; authPath: string };
  /** Rehearsal only: synthetic workers verify no authority, so the controller writes the dispatch witness. */
  rehearsal?: { scenarioFor: (slot: string) => PilotSyntheticScenario };
  repoRoot?: string;
  signal?: AbortSignal;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  /** Test seam: settles one slot's reservation from its receipt (default `settleFromReceipt`). */
  settle?: typeof settleFromReceipt;
}
/**
 * How a controller run ended. `complete`: every planned conversation has a terminal record.
 * `paused`: nothing blocks a rerun (a refusal before any claim or a signal); rerun `rh8-collect`.
 * `stopped`: a Stop Rules condition holds; no further admission is possible. `blocked`: a claimed
 * slot has no terminal record and needs inspection and `rh8-interrupt`. `owner-decision`: nothing is
 * running and the next full reservation does not fit the shared ceiling.
 */
export type ControllerOutcome = "complete" | "paused" | "stopped" | "blocked" | "owner-decision";
export interface ControllerResult {
  admitted: string[];
  completed: string[];
  halt: string | null;
  done: boolean;
  outcome: ControllerOutcome;
  peakConcurrency: number;
  /** Reservations that waited because admitted work held the headroom (retained under controller-events/). */
  budgetWaits: string[];
  settlementErrors: Array<{ slot: string; error: string }>;
  reconciled: string[];
}
const BUDGET_REFUSAL = /Insufficient programme allowance|exceeded ceiling/;
async function recordControllerEvent(root: string, kind: string, detail: Record<string, unknown>): Promise<string> {
  await mkdir(join(root, "controller-events"), { recursive: true });
  const at = new Date().toISOString();
  const path = join(root, "controller-events", `${at.replace(/[:.]/g, "-")}-${kind}-${String(detail.slot ?? "series")}.json`);
  writeNewJson(path, { kind, at, ...detail });
  return path;
}
/**
 * Runs the plan from its retained state: admits within the current wave, at most one conversation
 * per pair at a time and never a later wave early. A full reservation that does not fit while
 * admitted work holds headroom waits for that work to settle (a retained concurrency-degradation
 * event) and is then retried at the same full amount; with nothing running it ends the run for an
 * owner decision. An unsafe result, a settlement error, a refused pre-claim check or a signal stops
 * new admissions. Admitted work always drains, and the function returns only after every worker it
 * started has ended. Resuming is the same call; it first settles any reservation whose worker
 * already left a terminal record.
 */
export async function runController(core: ControllerCore): Promise<ControllerResult> {
  const { ctx } = core, root = ctx.root, reservation = ctx.definition.suite!.conversationReservationNanoUsd;
  const now = core.now ?? Date.now, wait = core.wait ?? sleep, settle = core.settle ?? settleFromReceipt;
  const active = new Map<string, Promise<void>>();
  const admitted: string[] = [], completed: string[] = [], budgetWaits: string[] = [], reconciled: string[] = [];
  const settlementErrors: ControllerResult["settlementErrors"] = [];
  let halt: string | null = null, done = false, peak = 0, ownerDecision = false;
  // Resume: a worker that ended after its controller stopped leaves a terminal record with an active reservation.
  {
    const balance = await readSuiteLedger(root);
    const start = await suiteCollectionState(ctx, core.frozen);
    for (const slot of start.slots) {
      if (slot.terminal && balance.active[slot.slot] !== undefined) {
        await settle(root, slot.slot, join(root, "runs", slot.runId, "budget.json"), reservation);
        reconciled.push(slot.slot);
      }
    }
  }
  /** Returns false when the full reservation must wait for admitted work to settle. */
  const admit = async (spec: SuiteSlotSpec): Promise<boolean> => {
    const runId = suiteRunId(root, spec);
    if (await pathExists(join(root, "runs", runId))) throw new Error(`Run directory for ${spec.slot} already exists; preserve and inspect it. No claim was made.`);
    await core.preClaim(spec);
    let balance;
    try { balance = await reserveSuiteStage(root, spec.slot, reservation); }
    catch (error) {
      if (!BUDGET_REFUSAL.test(String(error))) throw error;
      const ledger = await readSuiteLedger(root);
      const held = Object.values(ledger.active).reduce((a, b) => a + b, 0);
      if (active.size) {
        if (!budgetWaits.includes(spec.slot)) {
          budgetWaits.push(spec.slot);
          await recordControllerEvent(root, "concurrency-degradation", { slot: spec.slot, reason: "The full reservation does not fit while admitted work holds headroom; waiting for it to settle",
            reservationNanoUsd: reservation, availableNanoUsd: ledger.availableNanoUsd, activeNanoUsd: held, running: [...active.keys()] });
        }
        return false;
      }
      ownerDecision = true;
      await recordControllerEvent(root, "ceiling-exhausted", { slot: spec.slot, reservationNanoUsd: reservation, availableNanoUsd: ledger.availableNanoUsd,
        note: "Nothing is running and the full reservation does not fit the shared ceiling. Return to the owner; the reservation is never reduced." });
      throw new Error(`The next full reservation for ${spec.slot} does not fit the shared ceiling with nothing running: return to the owner`);
    }
    await claimPilotSlot(root, spec.slot as AnyPilotSlot, { ...core.claimBinding, runId, slot: spec.slot, wave: spec.wave, pair: spec.pair, position: spec.position,
      arm: spec.arm, scheduleIndex: spec.index, corpusSha256: core.frozen.digest, planSha256: ctx.definition.suite!.planSha256,
      ledger: { reservationNanoUsd: reservation, ledgerSha256AfterReservation: balance.sha256, availableAfterNanoUsd: balance.availableNanoUsd,
        activeAfterNanoUsd: Object.values(balance.active).reduce((a, b) => a + b, 0) } });
    const paths = createRunDirectory(join(root, "runs"), runId);
    await assertNoCheckoutRootCache(core.repoRoot);
    const workspaceEntries = await entries(paths.workspace), agentEntries = await entries(paths.agentDir);
    if (workspaceEntries.length || agentEntries.length) throw new Error("A new run directory is not empty");
    writeNewJson(join(paths.directory, "pre-dispatch.json"), { slot: spec.slot, runId, wave: spec.wave, checkedAt: new Date(now()).toISOString(),
      workspaceEntries, agentEntries, checkoutRootCacheAbsent: true, newRunDirectory: true, concurrentWith: [...active.keys()] });
    const host = await loadPinnedHost();
    const scenario = core.rehearsal?.scenarioFor(spec.slot);
    const phase = core.rehearsal ? "pilot-synthetic" as const : "pilot" as const;
    const manifest = { ...pilotManifest({ runId, arm: spec.arm, phase, host: host.identity, codeSha256: ctx.codeSha256, protocolSha256: ctx.protocolSha256,
      frozen: core.frozen, synthetic: phase === "pilot-synthetic", ...(scenario ? { scenario } : {}), definition: ctx.definition }), pair: spec.pair };
    if (core.rehearsal) await markPilotDispatch(root, spec.slot as AnyPilotSlot, runId);
    const cfg: WorkerConfig = { schemaVersion: 1, manifest, ...paths, frozenPath: core.frozenPath, ...(core.worker ?? {}),
      pilot: { revision: ctx.definition.revision, budgetNanoUsd: reservation, financialMode: "known-charges", ...(scenario ? { scenario } : {}) } };
    admitted.push(spec.slot);
    const work = (async () => {
      try { await core.execute(cfg); } catch { /* the missing or failed record is classified from retained files */ }
      try { await settle(root, spec.slot, join(paths.directory, "budget.json"), reservation); }
      catch (error) {
        // The reservation stays active in the ledger; a resume or rh8-settle settles it from the retained receipt.
        settlementErrors.push({ slot: spec.slot, error: String(error) });
        if (!halt) halt = `Settlement of ${spec.slot} failed: ${String(error)}; new admissions ended, admitted work drains`;
        await recordControllerEvent(root, "settlement-error", { slot: spec.slot, error: String(error) }).catch(() => undefined);
      }
      completed.push(spec.slot);
      active.delete(spec.slot);
    })();
    active.set(spec.slot, work);
    peak = Math.max(peak, active.size);
    return true;
  };
  for (;;) {
    // Snapshot the running set before reading state: a slot that finishes during the read stays unclassified until the next pass.
    const running = new Set(active.keys());
    const state = await suiteCollectionState(ctx, core.frozen);
    const plan = planAdmissions(state, running, now(), ctx.minGapMs);
    if (core.signal?.aborted && !halt) halt = "Stopped by signal: new admissions ended; admitted work drains";
    if (plan.blocked && !halt) halt = plan.blocked;
    if (plan.done) done = true;
    let waitingForBudget = false;
    if (!halt && !done) {
      for (const spec of plan.admit) {
        if (core.signal?.aborted) { halt = "Stopped by signal: new admissions ended; admitted work drains"; break; }
        try { if (!await admit(spec)) { waitingForBudget = true; break; } }
        catch (error) { halt = `Admission of ${spec.slot} refused: ${String(error)}`; break; }
      }
    }
    // A slot that finished during this pass was judged as still running: plan again before deciding to wait or stop.
    if ([...running].some(slot => !active.has(slot))) continue;
    if (!active.size) {
      if (halt || done) break;
      if (plan.wakeAt === null && !plan.admit.length && !waitingForBudget) { halt = "No admissible conversation and none running"; break; }
    }
    const waits: Array<Promise<unknown>> = [...active.values()];
    if (plan.wakeAt !== null && !halt && !waitingForBudget) waits.push(wait(plan.wakeAt - now()));
    if (!waits.length) continue;
    await Promise.race(waits);
  }
  await Promise.all(active.values());
  const final = await suiteCollectionState(ctx, core.frozen);
  const outcome: ControllerOutcome = done && final.complete ? "complete" : ownerDecision ? "owner-decision"
    : final.inFlight.length ? "blocked" : final.stops.length || final.integrityProblems.length || final.closure ? "stopped" : "paused";
  return { admitted, completed, halt, done, outcome, peakConcurrency: peak, budgetWaits, settlementErrors, reconciled };
}

/** Live collection or resume: one controller process for the bound plan, under the controller lock. */
export async function suiteCollect(acceptancePath: string, authPath: string, corpusAcceptancePath: string, options: SuiteOperationOptions = {}): Promise<ControllerResult & { sessionPath: string }> {
  const authority = await suiteAuthority(acceptancePath, options);
  const prep = await verifySuitePreparation(authority, corpusAcceptancePath);
  assertCorpusAcceptable({ frozen: prep.frozen });
  assertAllSelectedPagesCaptured(prep.frozen);
  const ctx = suiteContextFor(authority), credentialCheck = options.credentialCheck ?? defaultCredentialCheck;
  return withControllerLock(authority.root, "rh8-collect", async () => {
    const startedAt = new Date().toISOString();
    const result = await runController({ ctx, frozen: prep.frozen, frozenPath: prep.frozenPath, execute: options.execute ?? executeWorker,
      preClaim: async () => {
        await assertNoCheckoutRootCache(options.repoRoot);
        await credentialCheck(authPath, MAIN_MODEL.provider);
        await credentialCheck(authPath, "openrouter");
      },
      claimBinding: { ...binding(authority), corpusAcceptancePath: resolve(corpusAcceptancePath), corpusAcceptanceSha256: prep.corpusAcceptanceSha256 },
      worker: { acceptancePath, authPath }, repoRoot: options.repoRoot, signal: options.signal, now: options.now, wait: options.wait });
    await mkdir(join(authority.root, "controller-sessions"), { recursive: true });
    const sessionPath = join(authority.root, "controller-sessions", `${startedAt.replace(/[:.]/g, "-")}-${process.pid}.json`);
    writeNewJson(sessionPath, { ...binding(authority), kind: "suite-controller-session", startedAt, endedAt: new Date().toISOString(), ...result });
    return { ...result, sessionPath };
  });
}

/** Read-only state for the coordinator: plan, ledger, per-slot status and what would be admitted now. */
export async function suiteStatus(acceptancePath: string, options: SuiteOperationOptions = {}) {
  const authority = await suiteAuthority(acceptancePath, options);
  const ctx = suiteContextFor(authority);
  const frozenPath = join(authority.root, "corpus-import", "frozen-inputs.json");
  if (!await pathExists(frozenPath)) throw new Error("rh8-status needs the imported corpus (run rh8-import first)");
  const frozen = await loadFrozenInputs({ path: frozenPath });
  const state = await suiteCollectionState(ctx, frozen);
  const plan = planAdmissions(state, new Set(), Date.now(), ctx.minGapMs);
  return { planSha256: authority.definition.suite!.planSha256, pairs: authority.definition.suite!.pairs, parallelPairs: authority.definition.suite!.parallelPairs,
    controllerLocked: state.controllerLocked, complete: state.complete, stops: state.stops, inFlight: state.inFlight, closed: !!state.closure,
    integrityProblems: state.integrityProblems, ledger: state.ledger, wouldAdmitNow: plan.admit.map(spec => spec.slot), blocked: plan.blocked, wave: plan.wave,
    // Paused, not stopped: a rerun of rh8-collect would continue.
    resumable: !state.complete && !state.controllerLocked && !plan.blocked && !state.stops.length && !state.inFlight.length && !state.closure && !state.integrityProblems.length,
    slots: state.slots.map(slot => ({ slot: slot.slot, wave: slot.wave, status: slot.status, machinePassed: slot.machinePassed ?? null,
      safe: slot.claimed ? slot.safe : null, knownNanoUsd: slot.financial?.knownNanoUsd ?? null })) };
}

// ---------------------------------------------------------------------------
// Interruptions, closure, review inputs, gates and settlement
// ---------------------------------------------------------------------------

async function verifyInterruptionReceipt(path: string, authority: VerifiedPilotAuthority): Promise<Record<string, unknown>> {
  const receipt = await verifyStageReceipt(path, "pilot-interruption-receipt", authority, { noActiveProcess: true });
  if (typeof receipt.slot !== "string" || !String(receipt.rationale ?? "").trim() || !Number.isFinite(Date.parse(String(receipt.inspectedAt)))
    || !receipt.inspectionEvidencePath || await digestFile(String(receipt.inspectionEvidencePath)) !== receipt.inspectionEvidenceSha256) {
    throw new Error(`Interruption receipt ${path} lacks a slot, rationale, inspection time or retained inspection evidence`);
  }
  return receipt;
}
/**
 * Records a coordinator-verified interruption. For a conversation slot without a terminal record it
 * writes `interruptions/<slot>.json` and holds the slot's full reservation as unknown; the slot then
 * stops new admissions. For `slot: "controller-lock"` it moves a stale lock aside (retained, never
 * deleted) after checking the receipt names the lock's exact owner record. Neither is automatic:
 * the runner cannot observe other processes, so the coordinator's inspection evidence carries that fact.
 */
export async function suiteInterrupt(acceptancePath: string, receiptPath: string, options: SuiteOperationOptions = {}): Promise<string> {
  const authority = await suiteAuthority(acceptancePath, options);
  const receipt = await verifyInterruptionReceipt(receiptPath, authority), root = authority.root;
  if (receipt.slot === "controller-lock") {
    const lock = join(root, CONTROLLER_LOCK), owner = join(lock, "owner.json");
    if (!await pathExists(lock)) throw new Error("No controller lock is held");
    const ownerSha256 = await pathExists(owner) ? await digestFile(owner) : null;
    if (receipt.lockOwnerSha256 !== ownerSha256) throw new Error("The receipt does not name the current lock owner record");
    const target = join(root, `${CONTROLLER_LOCK}.released-${new Date().toISOString().replace(/[:.]/g, "-")}`);
    await rename(lock, target);
    writeNewJson(join(target, "release.json"), { receiptPath: resolve(receiptPath), receiptSha256: await digestFile(receiptPath), releasedAt: new Date().toISOString() });
    return target;
  }
  return withControllerLock(root, "rh8-interrupt", async () => {
    const spec = scheduleFor(authority.definition).find(item => item.slot === receipt.slot);
    if (!spec) throw new Error(`${String(receipt.slot)} is not a scheduled slot`);
    const frozen = await loadFrozenInputs({ path: join(root, "corpus-import", "frozen-inputs.json") });
    const state = await suiteCollectionState(suiteContextFor(authority), frozen);
    if (state.slots[spec.index].status !== "in-flight") throw new Error(`${spec.slot} is not claimed without a terminal record`);
    await mkdir(join(root, "interruptions"), { recursive: true });
    const path = join(root, "interruptions", `${spec.slot}.json`);
    writeNewJson(path, { ...binding(authority), kind: "suite-interruption", slot: spec.slot, receiptPath: resolve(receiptPath), receiptSha256: await digestFile(receiptPath),
      heldNanoUsd: authority.definition.suite!.conversationReservationNanoUsd, note: "No terminal record. The full reservation is held as unknown; no retry or replacement." });
    const balance = await readSuiteLedger(root);
    if (balance.active[spec.slot] !== undefined) await settleSuiteStage(root, spec.slot, 0, balance.active[spec.slot], "Interrupted without a terminal record: full reservation held");
    return path;
  });
}

/** Ends collection early. Takes the controller lock, so it cannot race a running controller, and refuses while any slot is in flight. */
export async function suiteClose(acceptancePath: string, reason: string, options: SuiteOperationOptions = {}): Promise<string> {
  if (!reason.trim()) throw new Error("A closure needs a stated reason");
  const authority = await suiteAuthority(acceptancePath, options);
  return withControllerLock(authority.root, "rh8-close", async () => {
    const frozen = await loadFrozenInputs({ path: join(authority.root, "corpus-import", "frozen-inputs.json") });
    const state = await suiteCollectionState(suiteContextFor(authority), frozen);
    if (state.inFlight.length) throw new Error(`Closure refused: ${state.inFlight.join(", ")} claimed without a terminal record; record an interruption first`);
    const path = join(authority.root, "collection-closure.json");
    writeNewJson(path, { ...binding(authority), kind: "suite-collection-closure", accepted: true, closedAt: new Date().toISOString(), reason,
      claimedSlots: state.slots.filter(slot => slot.claimed).map(slot => slot.slot),
      interruptedSlots: state.slots.filter(slot => slot.status === "interrupted").map(slot => slot.slot),
      unclaimedSlots: state.slots.filter(slot => !slot.claimed).map(slot => slot.slot),
      note: "Unclaimed slots are not-run observations of the full planned population. No replacement is authorised." });
    return path;
  });
}

/** All-answer review bundle after collection; random neutral labels; the mapping stays with the coordinator. */
export async function suiteReviewInputs(acceptancePath: string, output: string, options: SuiteOperationOptions = {}): Promise<string> {
  const authority = await suiteAuthority(acceptancePath, options);
  const frozenPath = join(authority.root, "corpus-import", "frozen-inputs.json");
  const frozen = await loadFrozenInputs({ path: frozenPath });
  const state = await assertCollectionFinished(suiteContextFor(authority), frozen);
  const collected = state.slots.filter(slot => slot.terminal);
  const order = collected.map((_slot, index) => index);
  for (let index = order.length - 1; index > 0; index--) { const swap = randomInt(index + 1); [order[index], order[swap]] = [order[swap], order[index]]; }
  const directory = resolve(output);
  await mkdir(directory);
  const mapping: Array<{ label: string; slot: string; runId: string; pair: number; arm: Arm; recordPath: string; bundled: boolean; answerPresent: boolean }> = [];
  for (const [position, slotIndex] of order.entries()) {
    const slot = collected[slotIndex], label = `answer-${String(position + 1).padStart(3, "0")}`;
    const recordPath = join(authority.root, "runs", slot.runId, "record.json");
    let answerPresent = false;
    try { answerPresent = !!(JSON.parse(await readFile(recordPath, "utf8")) as RunRecord).finalAnswer?.trim(); } catch { /* unreadable: listed, not bundled */ }
    if (slot.recordSha256) await pilotReviewInputs(recordPath, frozenPath, join(directory, label), label, authority.definition);
    mapping.push({ label, slot: slot.slot, runId: slot.runId, pair: slot.pair, arm: slot.arm, recordPath, bundled: !!slot.recordSha256, answerPresent });
  }
  writeNewJson(join(directory, "grader-index.json"), { kind: "suite-grader-index", reviewerRule: "Each reviewer, initial or adjudicating, grades exactly one answer of this suite.",
    labels: mapping.filter(item => item.bundled).map(item => item.label),
    corpusPath: frozenPath, corpusSha256: frozen.digest, rubricPath: authority.definition.protocolPath, rubricSha256: authority.acceptance.protocolSha256,
    note: "Give each reviewer one label's graders/ directory, the corpus and the rubric section only. Never this directory's coordinator files." });
  writeNewJson(join(directory, "coordinator-mapping.json"), { kind: "suite-coordinator-mapping", ...binding(authority), answers: mapping,
    note: "Coordinator only. Labels are a random permutation of collected answers; assemble each lock with the actual runId after both grades exist." });
  return directory;
}

/** Reviewer identities named by one lock's review, adjudication and purpose-review files. */
async function lockReviewers(lockPath: string): Promise<string[]> {
  let lock: PilotAssessmentLock;
  try { lock = JSON.parse(await readFile(lockPath, "utf8")) as PilotAssessmentLock; } catch { return []; }
  const paths = [...(Array.isArray(lock.reviews) ? lock.reviews : []), ...(lock.adjudication ? [lock.adjudication] : []),
    ...(lock.recoveryPurposeReview ? [lock.recoveryPurposeReview] : [])].map(item => item?.path).filter((path): path is string => typeof path === "string");
  const names = new Set<string>();
  for (const path of paths) {
    try { const reviewer = (JSON.parse(await readFile(path, "utf8")) as { reviewer?: unknown }).reviewer; if (typeof reviewer === "string" && reviewer.trim()) names.add(reviewer); }
    catch { /* an unreadable review fails the gate assessment itself */ }
  }
  return [...names].sort();
}
async function gatedReviewers(root: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let names: string[] = [];
  try { names = await readdir(join(root, "gates")); } catch { return map; }
  for (const name of names.filter(item => item.endsWith("-gate.json")).sort()) {
    const gate = JSON.parse(await readFile(join(root, "gates", name), "utf8")) as { slot?: string; reviewers?: unknown };
    for (const reviewer of Array.isArray(gate.reviewers) ? gate.reviewers : []) if (typeof reviewer === "string") map.set(reviewer, String(gate.slot));
  }
  return map;
}
/** One collected answer's gate, after collection. Write-once; the coordinator assembles gates one at a time. */
export async function suiteGate(acceptancePath: string, slotName: string, lockPath: string, options: SuiteOperationOptions = {}): Promise<{ passed: boolean; path: string }> {
  const authority = await suiteAuthority(acceptancePath, options);
  const spec = scheduleFor(authority.definition).find(item => item.slot === slotName);
  if (!spec) throw new Error(`${slotName} is not a scheduled slot`);
  const frozen = await loadFrozenInputs({ path: join(authority.root, "corpus-import", "frozen-inputs.json") });
  const state = await assertCollectionFinished(suiteContextFor(authority), frozen);
  const slot = state.slots[spec.index];
  if (!slot.terminal) throw new Error(`${slotName} was not collected; there is no answer to gate`);
  const directory = join(authority.root, "runs", slot.runId);
  const reviewers = await lockReviewers(lockPath);
  const earlier = await gatedReviewers(authority.root);
  const reused = reviewers.filter(reviewer => earlier.has(reviewer));
  if (reused.length) throw new Error(`Reviewer(s) ${reused.join(", ")} already graded another answer of this suite (${reused.map(reviewer => earlier.get(reviewer)).join(", ")}); each reviewer grades exactly one answer`);
  const checks = await pilotChecksFor(directory, frozen, "known-charges");
  let record: RunRecord | undefined, assessment: unknown, purpose: { passed: boolean; problems: string[] } = { passed: false, problems: [] }, assessed = false;
  try {
    record = JSON.parse(await readFile(join(directory, "record.json"), "utf8")) as RunRecord;
    const result = await assessPilotAnswerGate(lockPath, record, frozen.digest, authority.acceptance.protocolSha256);
    const lock = JSON.parse(await readFile(lockPath, "utf8")) as PilotAssessmentLock;
    purpose = await assessRecoveryPurpose(lock, record, checks.returnCheck.additionalWork.filter(work => work.purpose === "codemode-without-read").map(work => work.id));
    assessment = result; assessed = result.passed;
  } catch (error) { assessment = { passed: false, problems: [`Gate inputs unreadable: ${String(error)}`] }; }
  await mkdir(join(authority.root, "gates"), { recursive: true });
  const path = join(authority.root, "gates", `${slotName}-gate.json`);
  const passed = checks.passed && assessed && purpose.passed;
  writeNewJson(path, { ...binding(authority), kind: "suite-answer-gate", accepted: true, slot: slotName, pair: spec.pair, arm: spec.arm, runId: slot.runId,
    passed, machinePassed: checks.passed, qualityPassed: assessed && purpose.passed, reviewers, recordSha256: record ? digestObject(record) : null,
    machineChecks: checks.checks, financial: checks.financial, assessment, recoveryPurpose: purpose, assessmentLockSha256: await digestFile(lockPath) });
  return { passed, path };
}

/**
 * Closes the series from the shared ledger. Any reservation a crashed controller left active is
 * settled first: from the slot's final receipt when its record exists, as zero when it was never
 * claimed (no dispatch was possible), and never released for an in-flight slot without an
 * interruption record. The receipt reports the series liability against the shared ceiling.
 */
export async function suiteSettle(acceptancePath: string, options: SuiteOperationOptions = {}): Promise<string> {
  const authority = await suiteAuthority(acceptancePath, options);
  const root = authority.root, definition = authority.definition, reservation = definition.suite!.conversationReservationNanoUsd;
  return withControllerLock(root, "rh8-settle", async () => {
    const frozen = await loadFrozenInputs({ path: join(root, "corpus-import", "frozen-inputs.json") });
    const state = await suiteCollectionState(suiteContextFor(authority), frozen);
    if (state.inFlight.length) throw new Error(`${state.inFlight.join(", ")} claimed without a terminal record; record an interruption before settling`);
    const repaired: unknown[] = [];
    for (const id of Object.keys((await readSuiteLedger(root)).active)) {
      const slot = state.slots.find(item => item.slot === id);
      if (id === "charge-qualification") {
        if (await readPilotClaim(root, "charge-qualification")) repaired.push({ id, ...await settleFromReceipt(root, id, join(root, "charge-qualification", "budget.json"), definition.budget.qualificationNanoUsd) });
        else { await settleSuiteStage(root, id, 0, 0, "Never claimed: no model call was possible"); repaired.push({ id, reportedNanoUsd: 0, unknownNanoUsd: 0 }); }
      } else if (slot?.terminal) repaired.push({ id, ...await settleFromReceipt(root, id, join(root, "runs", slot.runId, "budget.json"), reservation) });
      else if (slot && !slot.claimed) { await settleSuiteStage(root, id, 0, 0, "Reserved but never claimed: no worker could be dispatched"); repaired.push({ id, reportedNanoUsd: 0, unknownNanoUsd: 0 }); }
      else throw new Error(`Active reservation ${id} has no settleable stage`);
    }
    const balance = await readSuiteLedger(root), rows = await ledgerRows(root), cumulative = definition.cumulative!;
    if (Object.keys(balance.active).length) throw new Error("Active reservations remain after reconciliation");
    const reconciliation = [];
    for (const slot of state.slots.filter(item => item.claimed)) {
      const settled = rows.find(row => row.kind === "settle" && row.runId === slot.slot);
      reconciliation.push({ slot: slot.slot, status: slot.status, ledgerReportedNanoUsd: settled?.reportedNanoUsd ?? null, ledgerUnknownNanoUsd: settled?.unknownNanoUsd ?? null,
        receiptKnownNanoUsd: slot.financial?.knownNanoUsd ?? null, agrees: !!settled && (slot.status === "interrupted" || settled.reportedNanoUsd === slot.financial?.knownNanoUsd) });
    }
    const reported = balance.knownNanoUsd - cumulative.priorReportedNanoUsd, unknown = balance.unknownNanoUsd;
    const overrun = rows.filter(row => row.kind === "settle").reduce((sum, row) => sum + Number(row.overrunNanoUsd ?? 0), 0);
    writeNewJson(join(root, "settlement-review.json"), { ...binding(authority), ledgerSha256: balance.sha256, repaired, reconciliation,
      reportedNanoUsd: reported, unknownNanoUsd: unknown, activeNanoUsd: 0 });
    const path = join(root, "settlement-receipt.json"), liability = reported + unknown;
    writeNewJson(path, { ...binding(authority), kind: "pilot-settlement", closed: true, reportedNanoUsd: reported, unknownNanoUsd: unknown, activeNanoUsd: 0,
      releasedNanoUsd: Math.max(0, definition.budget.totalNanoUsd - liability), overrunNanoUsd: overrun, ledgerSha256: balance.sha256, planSha256: definition.suite!.planSha256,
      reconciled: reconciliation.every(item => item.agrees),
      cumulative: { priorSettlements: cumulative.priorSettlements, priorReportedNanoUsd: cumulative.priorReportedNanoUsd, seriesLiabilityNanoUsd: liability,
        cumulativeLiabilityNanoUsd: cumulative.priorReportedNanoUsd + liability, combinedCeilingNanoUsd: cumulative.combinedCeilingNanoUsd,
        withinCombinedCeiling: cumulative.priorReportedNanoUsd + liability <= cumulative.combinedCeilingNanoUsd },
      note: "Subscription-main usage is reported separately and is not part of this monetary settlement." });
    return path;
  });
}

// ---------------------------------------------------------------------------
// Credential-free actual-host rehearsal of the concurrent controller
// ---------------------------------------------------------------------------

export const REHEARSAL_GAP_MS = 8_000;
/** Per-slot synthetic case for each rehearsal; unlisted slots complete cleanly. */
export const SUITE_REHEARSAL_PLANS: Record<"stop" | "clean" | "serial", { pairs: number; parallelPairs: number; scenarios: Record<string, PilotSyntheticScenario>; expectedNotRun: string[] }> = {
  /** Wave 1 runs two pairs at once, one with a safe machine failure; in wave 2 an unknown charge stops new admissions while the concurrent pair's admitted arm drains. */
  stop: { pairs: 4, parallelPairs: 2, scenarios: { "pair-02-baseline": "truncated", "pair-03-baseline": "unknown-charge" }, expectedNotRun: ["pair-03-candidate", "pair-04-baseline"] },
  clean: { pairs: 4, parallelPairs: 2, scenarios: {}, expectedNotRun: [] },
  serial: { pairs: 2, parallelPairs: 1, scenarios: {}, expectedNotRun: [] },
};
/** The definition a rehearsal runs under: frozen study content, a scratch root and the current ceiling and priors, without any acceptance. */
export function rehearsalDefinition(root: string, pairs: number, parallelPairs: number): PilotDefinition {
  const ceiling = 10_000_000_000;
  return Object.freeze({ ...RH8_BASE, scope: "suite-rehearsal", seriesRoot: root,
    budget: { ...RH8_BASE.budget, totalNanoUsd: ceiling - HISTORICAL_PRIOR_REPORTED_NANO_USD },
    cumulative: { combinedCeilingNanoUsd: ceiling, priorReportedNanoUsd: HISTORICAL_PRIOR_REPORTED_NANO_USD, priorSettlements: HISTORICAL_PRIOR_SETTLEMENTS },
    suite: { pairs, parallelPairs, conversationReservationNanoUsd: SUITE_RESERVATIONS.conversationNanoUsd, planPath: "rehearsal", planSha256: "rehearsal" } });
}
/**
 * Runs the real controller, real worker processes and the pinned host with the synthetic main model
 * and synthetic downstream below the real guard. The scratch root has no acceptance, so this
 * confers no live authority, and workers never read a credential.
 */
export async function rehearseSuite(output: string, planName: keyof typeof SUITE_REHEARSAL_PLANS = "stop",
  options: { execute?: (cfg: WorkerConfig) => Promise<unknown>; repoRoot?: string; signal?: AbortSignal; resume?: boolean } = {}): Promise<{ passed: boolean; paused: boolean; problems: string[]; path: string }> {
  const root = resolve(output);
  const code = await sourceIdentity(REPO_ROOT);
  if (options.resume) {
    const identity = JSON.parse(await readFile(join(root, "suite-identity.json"), "utf8")) as { kind?: string; plan?: keyof typeof SUITE_REHEARSAL_PLANS; codeSha256?: string };
    if (identity.kind !== "suite-rehearsal" || !identity.plan) throw new Error("Not a rehearsal root");
    if (identity.codeSha256 !== code.digest) throw new Error("Rehearsal root was created by another source identity");
    planName = identity.plan;
  }
  const rehearsal = SUITE_REHEARSAL_PLANS[planName];
  if (!rehearsal) throw new Error(`Unknown rehearsal plan ${String(planName)}`);
  const definition = rehearsalDefinition(root, rehearsal.pairs, rehearsal.parallelPairs);
  const protocolSha256 = await pilotProtocolSha256(definition);
  const frozenPath = join(root, "corpus-import", "frozen-inputs.json");
  if (!options.resume) {
    await mkdir(root);
    await mkdir(join(root, "corpus-import"));
    await copyFile(definition.corpusReuse!.path, frozenPath);
  }
  const frozen = await loadFrozenInputs({ path: frozenPath });
  if (!options.resume) {
    writeNewJson(join(root, "suite-identity.json"), { kind: "suite-rehearsal", revision: definition.revision, plan: planName, pairs: rehearsal.pairs,
      parallelPairs: rehearsal.parallelPairs, codeSha256: code.digest, protocolSha256, corpusSha256: frozen.digest, credentialUse: false, liveAuthority: false });
    await createSuiteLedger(root, definition);
  }
  // The live gap is 30 s. The rehearsal uses 8 s: long enough that a concurrent pair's first arm always ends before the other pair's second arm becomes eligible, so the stop case is deterministic.
  const ctx: SuiteContext = { root, definition, phase: "pilot-synthetic", codeSha256: code.digest, protocolSha256, minGapMs: REHEARSAL_GAP_MS };
  const lock = await acquireControllerLock(root, options.resume ? "rh8-rehearse-resume" : "rh8-rehearse");
  let result: ControllerResult;
  try {
    result = await runController({ ctx, frozen, frozenPath, execute: options.execute ?? executeWorker, preClaim: async () => assertNoCheckoutRootCache(options.repoRoot),
      claimBinding: { rehearsal: true }, rehearsal: { scenarioFor: slot => rehearsal.scenarios[slot] ?? "complete" }, repoRoot: options.repoRoot, signal: options.signal });
  } finally { await lock.release(); }
  await mkdir(join(root, "rehearsal-sessions"), { recursive: true });
  const session = join(root, "rehearsal-sessions", `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}.json`);
  writeNewJson(session, { kind: "suite-rehearsal-session", resume: !!options.resume, ...result });
  if (result.outcome === "paused") return { passed: true, paused: true, problems: [], path: session };
  const problems: string[] = [];
  const schedule = scheduleFor(definition);
  const expectedAdmitted = schedule.map(spec => spec.slot).filter(slot => !rehearsal.expectedNotRun.includes(slot));
  const claimed = (await suiteCollectionState(ctx, frozen)).slots.filter(slot => slot.claimed).map(slot => slot.slot);
  if (digestObject([...claimed].sort()) !== digestObject([...expectedAdmitted].sort())) problems.push(`Claimed ${claimed.join(", ")}; expected ${expectedAdmitted.join(", ")}`);
  if (!options.resume && result.peakConcurrency !== rehearsal.parallelPairs) problems.push(`Peak concurrency ${result.peakConcurrency}; expected ${rehearsal.parallelPairs}`);
  if (rehearsal.expectedNotRun.length ? result.outcome !== "stopped" : result.outcome !== "complete") problems.push(`Unexpected controller outcome ${result.outcome}: ${result.halt}`);
  const balance = await readSuiteLedger(root);
  if (Object.keys(balance.active).length) problems.push("Active reservations remain after the drain");
  const analysisDir = join(root, "analysis");
  await analyseSuite(root, analysisDir, { phase: "pilot-synthetic", definition });
  const inventory = JSON.parse(await readFile(join(analysisDir, "suite-inventory.json"), "utf8")) as { conversations: Array<{ slot: string; status: string }> };
  const notRun = inventory.conversations.filter(row => row.status === "not-run").map(row => row.slot).sort();
  if (digestObject(notRun) !== digestObject([...rehearsal.expectedNotRun].sort())) problems.push(`Inventory not-run rows ${notRun.join(", ")} differ from ${rehearsal.expectedNotRun.join(", ")}`);
  const analysis = JSON.parse(await readFile(join(analysisDir, "suite-analysis.json"), "utf8")) as { concurrency: { observedPeak: number; pairs: Array<{ armsOverlap: boolean }> } };
  if (analysis.concurrency.observedPeak > rehearsal.parallelPairs) problems.push(`Observed interval peak ${analysis.concurrency.observedPeak} exceeds ${rehearsal.parallelPairs}`);
  if (analysis.concurrency.pairs.some(pair => pair.armsOverlap)) problems.push("The two arms of a pair overlapped");
  const reproduced = join(root, "analysis-reproduced");
  await analyseSuite(root, reproduced, { phase: "pilot-synthetic", definition });
  for (const name of ["suite-inventory.json", "suite-analysis.json"]) {
    if (await digestFile(join(analysisDir, name)) !== await digestFile(join(reproduced, name))) problems.push(`${name} is not byte-identical on reproduction`);
  }
  const path = join(root, "rehearsal-outcome.json");
  writeNewJson(path, { kind: "suite-rehearsal-outcome", plan: planName, passed: problems.length === 0, problems, ...result, ledgerSha256: balance.sha256,
    observedPeak: analysis.concurrency.observedPeak, rootName: basename(root), credentialUse: false, liveAuthority: false });
  return { passed: problems.length === 0, paused: false, problems, path };
}
