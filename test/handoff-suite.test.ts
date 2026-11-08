// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// rh-v8 paired suite (rh-v8-suite-2): protocol agreement, plan preparation and
// authority, deterministic waves, the shared cross-process ledger, the pure
// admission planner, the concurrent controller with deferred executors,
// worker-side authority, stop and drain, resume, interruption, closure,
// reviewer isolation, settlement and reproducible full-population analysis.
// No test dispatches live work, fetches a page or reads credentials.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import {
  RH8_BASE, RH8_PROTOCOL_PATH, RH8_PROTOCOL_REVISION, RH8_OWNER_DIRECTION_PATH, RH8_OWNER_DIRECTION_SHA256, RH8_CONCURRENCY_DIRECTION_PATH,
  RH8_CONCURRENCY_DIRECTION_SHA256, RH8_SERIES_ROOT, HISTORICAL_PRIOR_SETTLEMENTS, HISTORICAL_PRIOR_REPORTED_NANO_USD, SUITE_RESERVATIONS,
  pilotDefinitionFor, suiteSchedule, suiteRunId, pairOrder,
} from "../scripts/research-handoff/pilot-suite.js";
import { RH7_PILOT, RH7_SERIES_ROOT, RH7_CORPUS_REUSE, verifyPriorSettlements } from "../scripts/research-handoff/pilot-repeat.js";
import { RH6_PILOT, RH6_PROTOCOL_PATH, RH6_SERIES_ROOT, rh6Params, rh6Settings } from "../scripts/research-handoff/pilot-continuation.js";
import { PILOT_SERIES_ROOT, PILOT_RUBRICS, PILOT_TOPICS, pilotTaskPrompt } from "../scripts/research-handoff/pilot-config.js";
import { verifyPilotImplementation, claimPilotSlot } from "../scripts/research-handoff/pilot-authority.js";
import { syntheticRegistry, assertPilotRates, validatePilotWorker, pilotManifest, pilotRun, pilotCapture, pilotSettle } from "../scripts/research-handoff/pilot.js";
import { assertNoCheckoutRootCache, planAdmissions, suiteCollectionState, acquireControllerLock, scheduleFor, verifyWorkerSlot, type SuiteCollectionState, type SuiteSlotState, type SuiteContext } from "../scripts/research-handoff/suite-admission.js";
import { markPilotDispatch } from "../scripts/research-handoff/pilot-authority.js";
import {
  suiteObserve, suiteAdmit, suiteImport, suiteQualify, suiteCollect, suiteGate, suiteReviewInputs, suiteClose, suiteSettle, suiteInterrupt, suiteStatus,
  runController, rehearsalDefinition,
} from "../scripts/research-handoff/suite.js";
import { createSuiteLedger, readSuiteLedger, reserveSuiteStage, settleSuiteStage, settleFromReceipt } from "../scripts/research-handoff/suite-ledger.js";
import { analyseSuite, exactTwoSidedSignP, distribution, validateIncidents } from "../scripts/research-handoff/suite-analysis.js";
import { buildStudyPlan, prepareStudyPlan, verifyStudyPlan, parseUsdToNano, GENERIC_RECORD_TYPE } from "../scripts/research-handoff/study-plan.js";
import { SYNTHETIC_MODEL_ID, SYNTHETIC_PROVIDER_ID, loadPinnedHost } from "../scripts/research-handoff/host.js";
import { assertLiveEvidenceRoot, executeWorker, REPO_ROOT, type WorkerConfig } from "../scripts/research-handoff/runner.js";
import { createRunDirectory, digestFile, digestObject, digestText, sourceIdentity, writeNewJson } from "../scripts/research-handoff/storage.js";
import { loadFrozenInputs } from "../scripts/research-handoff/common-inputs.js";
import type { PilotSyntheticScenario, RunRecord } from "../scripts/research-handoff/contracts.js";
import type { CatalogueModel } from "../scripts/research-handoff/pilot.js";

const CATALOGUE: { data: CatalogueModel[] } = { data: [
  { id: "perplexity/sonar", context_length: 127072, pricing: { prompt: "0.000001", completion: "0.000001", web_search: "0.005" } },
  { id: "minimax/minimax-m3", context_length: 1048576, pricing: { prompt: "0.0000003", completion: "0.0000012" } }] };
const CURRENT_DIRECTIONS = [RH8_OWNER_DIRECTION_PATH, RH8_CONCURRENCY_DIRECTION_PATH];
const scratch = (prefix: string) => mkdtemp(join(tmpdir(), prefix));

test("rh-v8-suite-2 protocol keeps every rh-v6 setting, prompt and byte-locked rubric paragraph", async () => {
  const text = await readFile(RH8_PROTOCOL_PATH, "utf8");
  assert.match(text, /Revision: `rh-v8-suite-2`/);
  for (const value of [RH8_OWNER_DIRECTION_SHA256, RH8_CONCURRENCY_DIRECTION_SHA256, RH7_CORPUS_REUSE.sha256, RH7_CORPUS_REUSE.digest, "20261108T152419Z-rh-v8-suite"]) assert.ok(text.includes(value), value);
  assert.equal(await digestFile(RH8_OWNER_DIRECTION_PATH), RH8_OWNER_DIRECTION_SHA256);
  assert.equal(await digestFile(RH8_CONCURRENCY_DIRECTION_PATH), RH8_CONCURRENCY_DIRECTION_SHA256);
  assert.equal(digestObject(RH8_BASE.settings()), digestObject(rh6Settings()));
  assert.deepEqual(RH8_BASE.params(), rh6Params());
  assert.equal(RH8_BASE.sourcePolicy, RH6_PILOT.sourcePolicy);
  assert.equal(RH8_BASE.suite, undefined, "no runnable schedule exists without a bound plan");
  for (const arm of ["baseline", "candidate"] as const) for (const opening of ["paid", "observer"] as const) {
    assert.equal(pilotTaskPrompt(arm, RH8_BASE.params(), opening), pilotTaskPrompt(arm, rh6Params(), opening));
  }
  const v6 = (await readFile(RH6_PROTOCOL_PATH, "utf8")).split("## Frozen Assessment Criteria\n\n")[1].split("## Gate Sequence")[0].trim().split("\n\n");
  const v8 = text.split("## Frozen Assessment Criteria\n\n")[1].split("## Gate Sequence")[0];
  for (const paragraph of [v6[2], v6[3], v6[4], v6[6]]) assert.ok(v8.includes(paragraph), paragraph.slice(0, 60));
  const identity = v6[8].slice(v6[8].indexOf("Record identity uses"), v6[8].indexOf("Corpus identity"));
  assert.ok(identity.length > 80 && v8.includes(identity));
  assert.ok(!/—/.test(text));
  assert.equal((await sourceIdentity(REPO_ROOT)).files["docs/experiments/research-handoff/SUITE-PROTOCOL.md"], await digestFile(RH8_PROTOCOL_PATH));
  assert.equal(pilotDefinitionFor(RH8_PROTOCOL_REVISION), RH8_BASE);
  assert.throws(() => pilotDefinitionFor("rh-v8-suite-1"), /Unknown pilot revision/, "the unaccepted draft is superseded");
  assert.equal(await verifyPriorSettlements(HISTORICAL_PRIOR_SETTLEMENTS), HISTORICAL_PRIOR_REPORTED_NANO_USD);
});

test("waves of K pairs: balanced arm order, consecutive arms per pair, bounds stated", () => {
  const k2 = suiteSchedule(10, 2);
  assert.equal(k2.length, 20);
  assert.deepEqual(k2.slice(0, 8).map(spec => `${spec.wave}:${spec.slot}`), ["1:pair-01-baseline", "1:pair-02-candidate", "1:pair-01-candidate", "1:pair-02-baseline",
    "2:pair-03-baseline", "2:pair-04-candidate", "2:pair-03-candidate", "2:pair-04-baseline"]);
  assert.equal(Math.max(...k2.map(spec => spec.wave)), 5);
  for (const wave of [1, 2, 3, 4, 5]) {
    const first = k2.filter(spec => spec.wave === wave && spec.position === 1).map(spec => spec.arm).sort();
    assert.deepEqual(first, ["baseline", "candidate"], `wave ${wave} first arms are one of each`);
  }
  assert.deepEqual(suiteSchedule(2, 1).map(spec => spec.slot), ["pair-01-baseline", "pair-01-candidate", "pair-02-candidate", "pair-02-baseline"]);
  assert.deepEqual(suiteSchedule(3, 2).map(spec => spec.wave), [1, 1, 1, 1, 2, 2]);
  for (let pair = 1; pair <= 10; pair++) assert.deepEqual(pairOrder(pair), pair % 2 ? ["baseline", "candidate"] : ["candidate", "baseline"]);
  for (const [pairs, parallel] of [[0, 1], [100, 1], [10, 0], [10, 11], [2.5, 1], [10, 1.5]]) assert.throws(() => suiteSchedule(pairs, parallel), /must be an integer/);
  assert.equal(new Set(k2.map(spec => suiteRunId(RH8_SERIES_ROOT, spec))).size, 20);
});

test("the current plan derives from both owner directions, is deterministic and refuses out-of-scope parameters", async () => {
  const dir = await scratch("handoff-rh8-plan-");
  try {
    const input = { pairs: 10, parallelPairs: 2, budgetUsd: "10", root: RH8_SERIES_ROOT, directionPaths: CURRENT_DIRECTIONS };
    const first = await prepareStudyPlan(input, join(dir, "plan-a.json")), second = await prepareStudyPlan(input, join(dir, "plan-b.json"));
    assert.equal(first.sha256, second.sha256, "plan bytes are deterministic");
    await assert.rejects(prepareStudyPlan(input, join(dir, "plan-a.json")), /EEXIST|exists/, "a plan file is write-once");
    const plan = first.plan;
    assert.deepEqual([plan.pairs, plan.parallelPairs, plan.waves, plan.seriesRoot], [10, 2, 5, RH8_SERIES_ROOT]);
    assert.deepEqual(plan.firstArmCounts, { baseline: 5, candidate: 5 });
    assert.equal(plan.budget.headroomNanoUsd, 9_751_549_683);
    assert.equal(plan.budget.peakConcurrentReservationNanoUsd, 8_180_000_000);
    assert.equal(plan.budget.maxParallelPairsWithinCeiling, 2);
    assert.equal(plan.budget.worstCaseAllConversationsNanoUsd, 81_800_000_000);
    assert.deepEqual(plan.authority.directions.map(d => d.sha256), [RH8_OWNER_DIRECTION_SHA256, RH8_CONCURRENCY_DIRECTION_SHA256]);
    const verified = await verifyStudyPlan(first.path, first.sha256);
    assert.deepEqual([verified.definition.suite!.pairs, verified.definition.suite!.parallelPairs, verified.definition.seriesRoot], [10, 2, RH8_SERIES_ROOT]);
    assert.doesNotThrow(() => assertPilotRates(CATALOGUE, verified.definition));
    await assert.rejects(stat(RH8_SERIES_ROOT), /ENOENT/, "preparing a plan creates no series root");
    for (const [change, pattern] of [[{ parallelPairs: 3 }, /at most 2/], [{ pairs: 12 }, /do not cover/], [{ parallelPairs: 1 }, /do not cover/],
      [{ budgetUsd: "11" }, /do not cover/], [{ root: join(dir, "elsewhere") }, /do not cover/], [{ root: RH7_SERIES_ROOT }, /closed earlier root/],
      [{ directionPaths: [RH8_OWNER_DIRECTION_PATH] as string[] }, /does not cover|do not sum/], [{ budgetUsd: "ten" }, /decimal amount/]] as const) {
      await assert.rejects(buildStudyPlan({ ...input, ...change }), pattern, JSON.stringify(change));
    }
    const tampered = join(dir, "tampered.json");
    await writeFile(tampered, JSON.stringify({ ...plan, schedule: [...plan.schedule].reverse() }));
    await assert.rejects(verifyStudyPlan(tampered, first.sha256), /accepted digest/);
    await assert.rejects(verifyStudyPlan(tampered), /deterministic schedule/);
    const lessPrior = join(dir, "less-prior.json");
    await writeFile(lessPrior, JSON.stringify({ ...plan, budget: { ...plan.budget, priorSettlements: plan.budget.priorSettlements.slice(1) } }));
    await assert.rejects(verifyStudyPlan(lessPrior), /budget differs|do not sum|omits|do not cover/);
  } finally { await rm(dir, { recursive: true, force: true }); }
  assert.equal(parseUsdToNano("10"), 10_000_000_000);
  assert.equal(parseUsdToNano("9.751549683"), 9_751_549_683);
  for (const bad of ["0", "-1", "1e3", "1.0000000001", ""]) assert.throws(() => parseUsdToNano(bad), /budget-usd/, bad);
});

async function genericDirection(root: string, extra: Record<string, unknown> = {}) {
  const path = join(root, "..", `${root.split("/").at(-1)}-direction.json`);
  await writeFile(path, JSON.stringify({ schemaVersion: 1, recordType: GENERIC_RECORD_TYPE, approved: true, approvedBy: "owner", scope: "fixture-paired-suite",
    matchedPairs: 10, parallelPairs: 2, replacementConversations: 0, targetPrompt: "unchanged", corpusAndRubric: "unchanged rh-v6 corpus and dual rubric",
    measuredHost: "Pi 1.5.0", mainModel: "openai-codex/gpt-6.1-sol", combinedCeilingNanoUsd: 10_000_000_000, priorReportedNanoUsd: HISTORICAL_PRIOR_REPORTED_NANO_USD,
    priorUnknownNanoUsd: 0, priorActiveNanoUsd: 0, priorSettlements: HISTORICAL_PRIOR_SETTLEMENTS, designatedSeriesRoot: root, ...extra }));
  return path;
}

test("a future owner direction in the paired-suite format authorises its own plan; an open sibling suite root blocks it", async () => {
  const base = await scratch("handoff-rh8-generic-");
  try {
    const repoRoot = join(base, "checkout"), evidence = join(repoRoot, "evidence/benchmarks/research-handoff");
    await mkdir(evidence, { recursive: true });
    const root = join(base, "series"), direction = await genericDirection(root);
    const input = { pairs: 10, parallelPairs: 2, budgetUsd: "10", root, directionPaths: [direction] };
    const plan = await buildStudyPlan(input, { repoRoot });
    assert.equal(plan.authority.kind, "paired-suite-owner-direction");
    await assert.rejects(buildStudyPlan({ ...input, parallelPairs: 1 }, { repoRoot }), /does not cover/);
    const misuse = await genericDirection(join(base, "other"), { scope: "research-handoff-ten-matched-pairs-rh-v8" });
    await assert.rejects(buildStudyPlan({ ...input, root: join(base, "other"), directionPaths: [misuse] }, { repoRoot }), /does not cover/);
    await mkdir(join(evidence, "open-suite"));
    await writeFile(join(evidence, "open-suite", "pilot-root-binding.json"), JSON.stringify({ protocolRevision: RH8_PROTOCOL_REVISION }));
    await assert.rejects(buildStudyPlan(input, { repoRoot }), /bound but unsettled/);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("collection refuses a checkout-root .search directory, file or dangling symlink and never removes it", async () => {
  const base = await scratch("handoff-rh8-root-cache-");
  try {
    const absent = join(base, "absent"); await mkdir(absent);
    await assert.doesNotReject(assertNoCheckoutRootCache(absent));
    const cases: Array<[string, (path: string) => Promise<void>]> = [
      ["directory", async path => { await mkdir(path); await writeFile(join(path, ".index.json"), "{}"); }],
      ["file", async path => writeFile(path, "stale")],
      ["symlink", async path => symlink(join(base, "missing-target"), path)],
    ];
    for (const [kind, plant] of cases) {
      const repo = join(base, kind); await mkdir(repo); await plant(join(repo, ".search"));
      await assert.rejects(assertNoCheckoutRootCache(repo), new RegExp(`exists as a ${kind}`));
      assert.ok((await readdir(repo)).includes(".search"));
    }
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("the shared ledger reserves full allowances atomically, refuses oversubscription and reuse, and releases only known charges", async () => {
  const root = await scratch("handoff-rh8-ledger-");
  try {
    const definition = rehearsalDefinition(root, 10, 2);
    await createSuiteLedger(root, definition);
    await assert.rejects(createSuiteLedger(root, definition), /EEXIST/);
    const c = SUITE_RESERVATIONS.conversationNanoUsd;
    const results = await Promise.allSettled(["a", "b", "c"].map(id => reserveSuiteStage(root, id, c)));
    assert.equal(results.filter(item => item.status === "fulfilled").length, 2, "exactly two of three concurrent reservations fit");
    assert.match(String((results.find(item => item.status === "rejected") as PromiseRejectedResult).reason), /exceeded ceiling|Insufficient/);
    let balance = await readSuiteLedger(root);
    assert.equal(Object.values(balance.active).reduce((a, b) => a + b, 0), 2 * c);
    const [first, second] = Object.keys(balance.active);
    await assert.rejects(reserveSuiteStage(root, first, 1), /Reused financial identity/);
    await settleSuiteStage(root, first, 1_000_000, 0, "known");
    balance = await readSuiteLedger(root);
    assert.equal(balance.knownNanoUsd, HISTORICAL_PRIOR_REPORTED_NANO_USD + 1_000_000, "only the known charge remains");
    assert.deepEqual(await settleFromReceipt(root, second, join(root, "missing-budget.json"), c), { reportedNanoUsd: 0, unknownNanoUsd: c, heldFull: true });
    assert.equal((await readSuiteLedger(root)).unknownNanoUsd, c);
    await mkdir(join(root, "ledger.lock"));
    await assert.rejects(reserveSuiteStage(root, "d", 1), /EEXIST/, "a held ledger lock is never cleared automatically");
    assert.ok((await readdir(root)).includes("ledger.lock"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

function stateOf(pairs: number, parallel: number, overrides: Record<string, Partial<SuiteSlotState>> = {}, extra: Partial<SuiteCollectionState> = {}): SuiteCollectionState {
  const slots = suiteSchedule(pairs, parallel).map(spec => ({ ...spec, runId: spec.slot, status: "unclaimed", claimed: false, dispatched: false, terminal: false, reserved: false,
    failingChecks: [], budgetReceipt: false, safe: false, stopReasons: [], ...overrides[spec.slot] } as SuiteSlotState));
  return { slots, integrityProblems: [], stops: [], inFlight: slots.filter(slot => slot.status === "in-flight").map(slot => slot.slot), controllerLocked: false,
    complete: slots.every(slot => slot.terminal), claimed: slots.filter(slot => slot.claimed).length, ledger: null, ...extra };
}
const done = (endedAt = "2026-11-08T10:00:00.000Z"): Partial<SuiteSlotState> => ({ status: "terminal", claimed: true, terminal: true, safe: true, endedAt });
const flying: Partial<SuiteSlotState> = { status: "in-flight", claimed: true };

test("the pure planner admits one conversation per pair, waits for the gap, keeps waves and blocks on unresolved or unsafe state", () => {
  const t = Date.parse("2026-11-08T10:00:00.000Z");
  assert.deepEqual(planAdmissions(stateOf(4, 2), new Set(), t, 30_000).admit.map(s => s.slot), ["pair-01-baseline", "pair-02-candidate"]);
  assert.deepEqual(planAdmissions(stateOf(4, 1), new Set(), t, 30_000).admit.map(s => s.slot), ["pair-01-baseline"], "K1 admits a single pair");
  const running = stateOf(4, 2, { "pair-01-baseline": flying, "pair-02-candidate": flying });
  assert.deepEqual(planAdmissions(running, new Set(["pair-01-baseline", "pair-02-candidate"]), t, 30_000).admit, [], "no second conversation in a pair, no later wave");
  assert.match(String(planAdmissions(running, new Set(["pair-01-baseline"]), t, 30_000).blocked), /not run by this controller: pair-02-candidate/);
  const firstDone = stateOf(4, 2, { "pair-01-baseline": done(), "pair-02-candidate": flying });
  const early = planAdmissions(firstDone, new Set(["pair-02-candidate"]), t + 10_000, 30_000);
  assert.deepEqual([early.admit, early.wakeAt], [[], t + 30_000]);
  assert.deepEqual(planAdmissions(firstDone, new Set(["pair-02-candidate"]), t + 30_000, 30_000).admit.map(s => s.slot), ["pair-01-candidate"]);
  assert.deepEqual(planAdmissions(firstDone, new Set(["pair-01-baseline", "pair-02-candidate"]), t + 60_000, 30_000).admit, [], "a finished arm still settling blocks its pair");
  const waveOne = Object.fromEntries(["pair-01-baseline", "pair-01-candidate", "pair-02-candidate"].map(slot => [slot, done()]));
  assert.deepEqual(planAdmissions(stateOf(4, 2, { ...waveOne, "pair-02-baseline": flying }), new Set(["pair-02-baseline"]), t + 60_000, 30_000).admit, [], "wave 2 waits for wave 1");
  assert.deepEqual(planAdmissions(stateOf(4, 2, { ...waveOne, "pair-02-baseline": done() }), new Set(), t + 60_000, 30_000).admit.map(s => s.slot), ["pair-03-baseline", "pair-04-candidate"]);
  assert.match(String(planAdmissions(stateOf(4, 2, {}, { stops: [{ slot: "pair-01-baseline", reasons: ["unsafe"] }] }), new Set(), t, 30_000).blocked), /stopped at pair-01-baseline/);
  const unsafeStillActive = stateOf(4, 2, { "pair-01-baseline": done(), "pair-02-candidate": flying }, { stops: [{ slot: "pair-01-baseline", reasons: ["unsafe"] }] });
  assert.equal(planAdmissions(unsafeStillActive, new Set(["pair-01-baseline", "pair-02-candidate"]), t, 30_000).blocked, null, "a slot still settling is classified on the next pass");
  assert.match(String(planAdmissions(unsafeStillActive, new Set(["pair-02-candidate"]), t, 30_000).blocked), /stopped at pair-01-baseline/);
  assert.equal(planAdmissions(stateOf(1, 1, { "pair-01-baseline": done(), "pair-01-candidate": done() }), new Set(), t, 30_000).done, true);
});

/** A deferred executor: each real synthetic worker waits for the test to release it, so concurrency is observable and controlled. */
function deferredExecutor(scenarios: Record<string, PilotSyntheticScenario> = {}) {
  const gates = new Map<string, () => void>(), waiting: string[] = [], order: string[] = [];
  let running = 0, peak = 0;
  const executions = new Map<string, number>();
  const execute = async (cfg: WorkerConfig) => {
    const slot = `pair-${String(cfg.manifest.pair).padStart(2, "0")}-${cfg.manifest.arm}`;
    executions.set(slot, (executions.get(slot) ?? 0) + 1);
    order.push(slot); running++; peak = Math.max(peak, running);
    await new Promise<void>(release => { gates.set(slot, release); waiting.push(slot); });
    try { return await executeWorker({ ...cfg, pilot: { ...cfg.pilot!, scenario: scenarios[slot] ?? cfg.pilot!.scenario } }); }
    finally { running--; }
  };
  const release = async (slot: string) => {
    for (let i = 0; i < 400 && !gates.has(slot); i++) await new Promise(r => setTimeout(r, 25));
    const gate = gates.get(slot); if (!gate) throw new Error(`${slot} never started`);
    gates.delete(slot); gate();
  };
  return { execute, release, order, executions, waiting, get peak() { return peak; } };
}
async function rehearsalContext(pairs: number, parallel: number) {
  const root = await scratch("handoff-rh8-controller-");
  const definition = rehearsalDefinition(root, pairs, parallel);
  await mkdir(join(root, "corpus-import"));
  const frozenPath = join(root, "corpus-import", "frozen-inputs.json");
  await writeFile(frozenPath, await readFile(RH7_CORPUS_REUSE.path));
  await createSuiteLedger(root, definition);
  const ctx: SuiteContext = { root, definition, phase: "pilot-synthetic", codeSha256: (await sourceIdentity(REPO_ROOT)).digest, protocolSha256: await digestFile(RH8_PROTOCOL_PATH), minGapMs: 50 };
  return { root, ctx, frozen: await loadFrozenInputs({ path: frozenPath }), frozenPath };
}
async function waitFor(check: () => boolean) { for (let i = 0; i < 800 && !check(); i++) await new Promise(r => setTimeout(r, 25)); assert.ok(check()); }
const controllerOptions = (c: Awaited<ReturnType<typeof rehearsalContext>>, execute: (cfg: WorkerConfig) => Promise<unknown>) => ({ ctx: c.ctx, frozen: c.frozen, frozenPath: c.frozenPath,
  execute, preClaim: async () => {}, claimBinding: { rehearsal: true }, rehearsal: { scenarioFor: () => "complete" as const }, repoRoot: c.root });

test("controller K2: deferred workers prove bounded concurrency, unique dispatch, consecutive arms and wave order", { timeout: 300_000 }, async () => {
  const c = await rehearsalContext(4, 2);
  const exec = deferredExecutor();
  try {
    const run = runController(controllerOptions(c, exec.execute));
    await waitFor(() => exec.waiting.length === 2);
    assert.deepEqual(exec.order, ["pair-01-baseline", "pair-02-candidate"]);
    assert.equal((await readSuiteLedger(c.root)).active["pair-01-baseline"], SUITE_RESERVATIONS.conversationNanoUsd);
    await exec.release("pair-02-candidate");
    await waitFor(() => exec.waiting.length === 3);
    assert.equal(exec.order[2], "pair-02-baseline", "a pair's second arm follows its own first arm, not the other pair's");
    await exec.release("pair-01-baseline");
    await waitFor(() => exec.waiting.length === 4);
    assert.equal(exec.order[3], "pair-01-candidate");
    assert.ok(!exec.order.includes("pair-03-baseline"), "wave 2 waits for wave 1");
    await exec.release("pair-02-baseline"); await exec.release("pair-01-candidate");
    await waitFor(() => exec.waiting.length === 6);
    assert.deepEqual(exec.order.slice(4), ["pair-03-baseline", "pair-04-candidate"]);
    for (const slot of ["pair-03-baseline", "pair-04-candidate"]) await exec.release(slot);
    await waitFor(() => exec.waiting.length === 8);
    for (const slot of ["pair-03-candidate", "pair-04-baseline"]) await exec.release(slot);
    const result = await run;
    assert.deepEqual([result.done, exec.peak, result.peakConcurrency], [true, 2, 2]);
    assert.ok([...exec.executions.values()].every(count => count === 1), "no slot dispatched twice");
    assert.deepEqual(Object.keys((await readSuiteLedger(c.root)).active), [], "every reservation settled");
    const state = await suiteCollectionState(c.ctx, c.frozen);
    assert.deepEqual([state.integrityProblems, state.complete], [[], true]);
  } finally { await rm(c.root, { recursive: true, force: true }); }
});

test("controller stop and drain: an unsafe result stops new admissions while the concurrent admitted arm finishes and settles", { timeout: 300_000 }, async () => {
  const c = await rehearsalContext(4, 2);
  const exec = deferredExecutor({ "pair-01-baseline": "unknown-charge" });
  try {
    const run = runController(controllerOptions(c, exec.execute));
    await waitFor(() => exec.waiting.length === 2);
    await exec.release("pair-01-baseline");
    await waitFor(() => !!(JSON.stringify(Object.keys({})) && true));
    for (let i = 0; i < 400 && (await readSuiteLedger(c.root)).active["pair-01-baseline"] !== undefined; i++) await new Promise(r => setTimeout(r, 25));
    await new Promise(r => setTimeout(r, 500));
    assert.deepEqual(exec.order, ["pair-01-baseline", "pair-02-candidate"], "nothing new admitted after the unsafe result");
    await exec.release("pair-02-candidate");
    const result = await run;
    assert.match(String(result.halt), /stopped at pair-01-baseline/);
    assert.deepEqual([...result.completed].sort(), ["pair-01-baseline", "pair-02-candidate"]);
    const balance = await readSuiteLedger(c.root);
    assert.deepEqual(Object.keys(balance.active), []);
    assert.ok(balance.unknownNanoUsd > 0, "the unsafe arm's unknown hold stays held");
    const state = await suiteCollectionState(c.ctx, c.frozen);
    assert.equal(state.slots.find(slot => slot.slot === "pair-02-candidate")!.safe, true, "the drained arm is retained as a safe result");
    assert.equal(state.slots.filter(slot => !slot.claimed).length, 6);
  } finally { await rm(c.root, { recursive: true, force: true }); }
});

test("controller K1 runs strictly one conversation at a time in plan order", { timeout: 300_000 }, async () => {
  const c = await rehearsalContext(2, 1);
  const exec = deferredExecutor();
  try {
    const run = runController(controllerOptions(c, exec.execute));
    for (const slot of suiteSchedule(2, 1).map(spec => spec.slot)) { await waitFor(() => exec.order.at(-1) === slot); await exec.release(slot); }
    const result = await run;
    assert.deepEqual([result.done, exec.peak], [true, 1]);
    assert.deepEqual(exec.order, ["pair-01-baseline", "pair-01-candidate", "pair-02-candidate", "pair-02-baseline"]);
  } finally { await rm(c.root, { recursive: true, force: true }); }
});

test("exact paired tests stay finite and exact for every allowed pair count; distributions are deterministic", () => {
  assert.equal(exactTwoSidedSignP(0, 0), null);
  assert.equal(exactTwoSidedSignP(10, 0), 2 / 1024);
  assert.equal(exactTwoSidedSignP(5, 5), 1);
  assert.ok(Math.abs(exactTwoSidedSignP(8, 2)! - 0.109375) < 1e-12);
  const extreme = exactTwoSidedSignP(198, 0)!;
  assert.ok(Number.isFinite(extreme) && extreme > 0 && extreme < 1e-58);
  assert.equal(exactTwoSidedSignP(99, 99), 1);
  assert.ok(Math.abs(exactTwoSidedSignP(60, 40)! - 0.0569) < 0.0005);
  assert.deepEqual(distribution([3, 1, 2, 10]), { n: 4, mean: 4, median: 2.5, minimum: 1, maximum: 10 });
});

test("coordinator incident records are validated field by field", () => {
  assert.deepEqual(validateIncidents({ schemaVersion: 1, incidents: [] }), []);
  assert.deepEqual(validateIncidents({ schemaVersion: 1, incidents: [{ category: "reviewer-incident", step: "grading", at: "2026-11-08T22:00:00Z", evidencePath: "x.log", effect: "Switched reviewer" }] }), []);
  const problems = validateIncidents({ schemaVersion: 1, incidents: [{ category: "other", at: "not a time" }, "text"] });
  for (const pattern of [/recognised category/, /lacks step/, /lacks evidencePath/, /lacks effect/, /valid time/, /not an object/]) assert.ok(problems.some(item => pattern.test(item)), String(pattern));
  assert.ok(validateIncidents({ schemaVersion: 1 }).some(item => /no incidents array/.test(item)));
});

// ---------------------------------------------------------------------------
// Plan-bound live path with fixture authority (no credentials, synthetic workers)
// ---------------------------------------------------------------------------

async function suiteFixture(pairs = 10, parallel = 2) {
  const base = await scratch("handoff-rh8-fixture-");
  const repoRoot = join(base, "checkout"); await mkdir(repoRoot);
  const root = join(base, "series"); await mkdir(root);
  const direction = await genericDirection(root, { matchedPairs: pairs, parallelPairs: parallel });
  const planPath = join(base, "study-plan.json");
  const { sha256: planSha256 } = await prepareStudyPlan({ pairs, parallelPairs: parallel, budgetUsd: "10", root, directionPaths: [direction] }, planPath, { repoRoot });
  const review = join(base, "review.md"); await writeFile(review, "review\n");
  const acceptance = { schemaVersion: 1, kind: "pilot-implementation-acceptance", acceptedBy: "coordinator", accepted: true,
    scope: "fixture-paired-suite", protocolRevision: RH8_PROTOCOL_REVISION, seriesRoot: root, ownerDecisionPath: direction, ownerDecisionSha256: await digestFile(direction),
    codeSha256: (await sourceIdentity(REPO_ROOT)).digest, protocolSha256: await digestFile(RH8_PROTOCOL_PATH),
    technicalReviewPath: review, technicalReviewSha256: await digestFile(review), proseReviewPath: review, proseReviewSha256: await digestFile(review), planPath, planSha256 };
  const acceptancePath = join(base, "implementation-acceptance.json");
  writeNewJson(acceptancePath, acceptance);
  const seams = { rootCheck: async () => {}, repoRoot };
  const bound = async (kind: string, extra: Record<string, unknown> = {}) => ({ kind, accepted: true, seriesRoot: root,
    implementationAcceptanceSha256: await digestFile(acceptancePath), ownerDecisionSha256: acceptance.ownerDecisionSha256, ...extra });
  return { base, root, repoRoot, acceptance, acceptancePath, planPath, seams, bound };
}
type Fixture = Awaited<ReturnType<typeof suiteFixture>>;

/** Runs the REAL worker-side authority (no seams but the fixture root check and checkout), then a synthetic worker; only this executor relabels the record as paid. */
function authorisedExecutor(fixture: Fixture, scenarioFor: (slot: string) => PilotSyntheticScenario, hooks: { onStart?: (cfg: WorkerConfig) => void } = {}) {
  let running = 0, peak = 0;
  const seen = new Map<string, number>();
  const execute = async (cfg: WorkerConfig) => {
    await validatePilotWorker(cfg, fixture.seams);
    const slot = cfg.manifest.phase === "pilot" ? `pair-${String(cfg.manifest.pair).padStart(2, "0")}-${cfg.manifest.arm}` : "observer";
    seen.set(slot, (seen.get(slot) ?? 0) + 1); running++; peak = Math.max(peak, running); hooks.onStart?.(cfg);
    try {
      const { acceptancePath: _a, authPath: _p, ...rest } = cfg;
      const record = await executeWorker({ ...rest, manifest: { ...cfg.manifest, phase: "pilot-synthetic", mainModel: { provider: SYNTHETIC_PROVIDER_ID, model: SYNTHETIC_MODEL_ID } },
        pilot: { ...cfg.pilot!, scenario: cfg.manifest.phase === "pilot" ? scenarioFor(slot) : "observer-complete" } });
      if (cfg.manifest.phase === "pilot") { record.manifest.phase = "pilot"; await writeFile(join(cfg.directory, "record.json"), JSON.stringify(record, null, 2)); }
      return record;
    } finally { running--; }
  };
  return { execute, seen, get peak() { return peak; } };
}
async function prepare(fixture: Fixture, execute: (cfg: WorkerConfig) => Promise<unknown>) {
  const { root, acceptancePath, seams, bound } = fixture;
  const auth = join(root, "credential-reference-never-read");
  const common = { ...seams, credentialCheck: async () => {}, wait: async () => {} };
  const observed = await suiteObserve(acceptancePath, auth, { ...common, execute: execute as never });
  assert.equal(observed.stopped, false, await readFile(observed.outcomePath, "utf8"));
  const diagnostic = join(root, "diagnostic-acceptance.json");
  writeNewJson(diagnostic, await bound("pilot-diagnostic-acceptance", { recoveryPurposeReviewed: true }));
  await suiteAdmit(acceptancePath, diagnostic, { ...common, fetchCatalogue: async () => CATALOGUE });
  const admission = JSON.parse(await readFile(join(root, "financial-admission-receipt.json"), "utf8"));
  assert.equal(admission.planSha256, fixture.acceptance.planSha256);
  await assert.rejects(pilotCapture(acceptancePath, auth, { ...common, definition: RH8_BASE }), /capture and recapture are not authorised/);
  await suiteImport(acceptancePath, common);
  const review = join(root, "rh6-corpus-review-citation.md");
  await writeFile(review, "fixture citation of the rh-v6 corpus review\n");
  const corpus = join(root, "corpus-acceptance.json");
  writeNewJson(corpus, await bound("pilot-corpus-acceptance", { corpusSha256: RH7_CORPUS_REUSE.digest, reviewer: "rh6-corpus-reviewer", reviewPath: review,
    reviewSha256: await digestFile(review), readableSelectedPages: 12 }));
  await suiteQualify(acceptancePath, auth, corpus, { ...common, modelRegistry: syntheticRegistry("complete") });
  return { auth, common, corpus };
}
async function lockFor(dir: string, record: RunRecord, corpusSha256: string, rubricSha256: string, pass = true, names?: string[]): Promise<string> {
  const reviews = [];
  for (const reviewer of names ?? [`${record.manifest.runId}-reviewer-1`, `${record.manifest.runId}-reviewer-2`]) {
    const path = join(dir, `${record.manifest.runId}-${reviewer}.json`);
    await writeFile(path, JSON.stringify({ reviewer, runIdSha256: digestText(record.manifest.runId), recordSha256: digestObject(record), answerSha256: digestText(record.finalAnswer),
      corpusSha256, rubricSha256, lockedAt: "2026-11-08T21:00:00Z", materialUnsupportedClaim: false,
      grades: Object.fromEntries(PILOT_RUBRICS.map(rubric => [rubric, Object.fromEntries(PILOT_TOPICS.map(topic => [topic, { pass, reasons: "Fixture.", sourceRefs: ["page-1"] }]))])) }));
    reviews.push({ path, sha256: await digestFile(path) });
  }
  const lock = join(dir, `${record.manifest.runId}-${digestText(JSON.stringify(names ?? [])).slice(0, 8)}-lock.json`);
  await writeFile(lock, JSON.stringify({ schemaVersion: 1, kind: "pilot-answer-assessment-lock", runId: record.manifest.runId, reviews }));
  return lock;
}

test("rh-v8 authority binds the plan: earlier acceptances, closed roots, a changed plan and suite misuse of pilot commands are refused", async () => {
  const fixture = await suiteFixture();
  const { base, root, acceptance, acceptancePath, seams } = fixture;
  try {
    const authority = await verifyPilotImplementation(acceptancePath, { ...seams, definition: RH8_BASE });
    assert.deepEqual([authority.definition.suite!.pairs, authority.definition.suite!.parallelPairs, authority.root], [10, 2, root]);
    assert.equal(JSON.parse(await readFile(join(root, "pilot-root-binding.json"), "utf8")).binding.planSha256, acceptance.planSha256);
    await assert.rejects(verifyPilotImplementation(acceptancePath, { ...seams, definition: RH7_PILOT }), /Not an accepted rh-v7-once-1/);
    for (const [index, change] of [{ planSha256: "0".repeat(64) }, { planPath: undefined }, { protocolRevision: "rh-v8-suite-1" }, { seriesRoot: RH7_SERIES_ROOT },
      { scope: "other" }, { ownerDecisionSha256: "0".repeat(64) }].entries()) {
      const path = join(base, `changed-${index}.json`);
      writeNewJson(path, { ...acceptance, ...change });
      await assert.rejects(verifyPilotImplementation(path, { ...seams, definition: RH8_BASE }), /Not an accepted|accepted digest|another scope|another owner/, JSON.stringify(change));
    }
    await assert.rejects(assertLiveEvidenceRoot(RH8_SERIES_ROOT), /rh-v8 suite root accepts only rh-v8/);
    await assert.rejects(pilotRun(acceptancePath, "x", "baseline", "x", { ...seams, definition: RH8_BASE }), /only through its schedule driver/);
    await assert.rejects(pilotSettle(acceptancePath, { ...seams, definition: RH8_BASE }), /shared ledger/);
    for (const closed of [RH6_SERIES_ROOT, PILOT_SERIES_ROOT]) {
      await assert.rejects(buildStudyPlan({ pairs: 10, parallelPairs: 2, budgetUsd: "10", root: closed, directionPaths: [await genericDirection(closed)] }), /closed earlier root/);
    }
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("rh-v8 live path: ten pairs two at a time, signal drain and resume, worker-side authority, grading after collection, settlement and analysis", { timeout: 900_000 }, async () => {
  const fixture = await suiteFixture();
  const { base, root, acceptance, acceptancePath, planPath } = fixture;
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("network forbidden in this test"); };
  const abort = new AbortController();
  let starts = 0;
  const exec = authorisedExecutor(fixture, slot => slot === "pair-02-baseline" ? "truncated" : "complete",
    { onStart: cfg => { if (cfg.manifest.phase === "pilot" && ++starts === 3) abort.abort(); } });
  try {
    const { auth, common, corpus } = await prepare(fixture, exec.execute);
    const options = { ...common, execute: exec.execute as never };
    await assert.rejects(suiteReviewInputs(acceptancePath, join(base, "early"), options), /neither complete, stopped nor closed/);
    const held = await acquireControllerLock(root, "test");
    await assert.rejects(suiteCollect(acceptancePath, auth, corpus, options), /Another suite controller holds/);
    await assert.rejects(suiteClose(acceptancePath, "reason", options), /Another suite controller holds/);
    await held.release();
    const first = await suiteCollect(acceptancePath, auth, corpus, { ...options, signal: abort.signal });
    assert.match(String(first.halt), /signal/);
    assert.ok(first.admitted.length >= 3 && first.admitted.length <= 4, `admitted ${first.admitted.join(", ")}`);
    assert.ok(first.admitted.every(slot => suiteSchedule(10, 2).find(spec => spec.slot === slot)!.wave === 1), "no admission after the signal reached a later wave");
    assert.deepEqual(Object.keys((await readSuiteLedger(root)).active), [], "drained work settled");
    const second = await suiteCollect(acceptancePath, auth, corpus, options);
    assert.equal(second.done, true, String(second.halt));
    assert.deepEqual([...first.admitted, ...second.admitted].sort(), suiteSchedule(10, 2).map(spec => spec.slot).sort());
    assert.ok([...exec.seen.entries()].filter(([slot]) => slot !== "observer").every(([, count]) => count === 1), "no slot dispatched twice");
    assert.ok(exec.peak <= 2 && second.peakConcurrency === 2, `peak ${exec.peak}`);
    const status = await suiteStatus(acceptancePath, options);
    assert.deepEqual([status.complete, status.controllerLocked, status.stops.length, status.inFlight.length], [true, false, 0, 0]);
    const claim = JSON.parse(await readFile(join(root, "claims", "pair-04-candidate", "claim.json"), "utf8"));
    assert.deepEqual([claim.wave, claim.position, claim.planSha256, claim.ledger.reservationNanoUsd], [2, 1, acceptance.planSha256, SUITE_RESERVATIONS.conversationNanoUsd]);
    const bundle = await suiteReviewInputs(acceptancePath, join(base, "reviews"), options);
    assert.equal(JSON.parse(await readFile(join(bundle, "coordinator-mapping.json"), "utf8")).answers.length, 20);
    assert.ok(!JSON.stringify(JSON.parse(await readFile(join(bundle, "grader-index.json"), "utf8"))).match(/baseline|candidate|pair-/));
    const schedule = suiteSchedule(10, 2);
    const read = async (slot: string) => JSON.parse(await readFile(join(root, "runs", suiteRunId(root, schedule.find(s => s.slot === slot)!), "record.json"), "utf8")) as RunRecord;
    const firstLock = await lockFor(base, await read(schedule[0].slot), RH7_CORPUS_REUSE.digest, acceptance.protocolSha256, true, ["shared-reviewer", "first-only"]);
    assert.equal((await suiteGate(acceptancePath, schedule[0].slot, firstLock, options)).passed, true);
    const reuse = await lockFor(base, await read(schedule[1].slot), RH7_CORPUS_REUSE.digest, acceptance.protocolSha256, true, ["shared-reviewer", "fresh"]);
    await assert.rejects(suiteGate(acceptancePath, schedule[1].slot, reuse, options), /already graded another answer/);
    for (const spec of schedule.slice(1)) {
      const gate = await suiteGate(acceptancePath, spec.slot, await lockFor(base, await read(spec.slot), RH7_CORPUS_REUSE.digest, acceptance.protocolSha256, spec.slot !== "pair-03-baseline"), options);
      assert.equal(gate.passed, spec.slot !== "pair-03-baseline" && spec.slot !== "pair-02-baseline", spec.slot);
    }
    await writeFile(join(root, "incidents.json"), JSON.stringify({ schemaVersion: 1, incidents: [] }));
    const settlement = JSON.parse(await readFile(await suiteSettle(acceptancePath, options), "utf8"));
    assert.deepEqual([settlement.closed, settlement.unknownNanoUsd, settlement.activeNanoUsd, settlement.reconciled, settlement.cumulative.withinCombinedCeiling], [true, 0, 0, true, true]);
    assert.equal(settlement.cumulative.priorReportedNanoUsd, HISTORICAL_PRIOR_REPORTED_NANO_USD);
    await assert.rejects(suiteCollect(acceptancePath, auth, corpus, options), /settled and closed/);
    await analyseSuite(root, join(base, "analysis-1"), { planPath });
    await analyseSuite(root, join(base, "analysis-2"), { planPath });
    for (const name of ["suite-inventory.json", "suite-analysis.json"]) assert.equal(await digestFile(join(base, "analysis-1", name)), await digestFile(join(base, "analysis-2", name)), name);
    const analysis = JSON.parse(await readFile(join(base, "analysis-1", "suite-analysis.json"), "utf8"));
    assert.ok(analysis.concurrency.observedPeak >= 1 && analysis.concurrency.observedPeak <= 2);
    assert.ok(analysis.concurrency.pairs.every((pair: { armsOverlap: boolean; gapMs: number }) => !pair.armsOverlap && pair.gapMs >= 30_000));
    assert.equal(analysis.quality.pairs.graded, 10);
    assert.equal(analysis.machine.baseline.machineFailed, 1);
    assert.deepEqual([analysis.incidents.operationallyClean, analysis.incidents.cleanlinessBlockers], [true, []]);
    await assert.rejects(analyseSuite(root, join(base, "analysis-bad"), { planPath: acceptancePath }), /not the one this root is bound to/);
  } finally { globalThis.fetch = savedFetch; await rm(base, { recursive: true, force: true }); }
});

test("rh-v8 in-flight slots block everything until a verified interruption holds their full reservation; stale locks need a receipt", { timeout: 300_000 }, async () => {
  const fixture = await suiteFixture(2, 2);
  const { base, root, acceptancePath, bound } = fixture;
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("network forbidden in this test"); };
  const exec = authorisedExecutor(fixture, () => "complete");
  try {
    const { auth, common, corpus } = await prepare(fixture, exec.execute);
    const options = { ...common, execute: exec.execute as never };
    const spec = suiteSchedule(2, 2)[0];
    await reserveSuiteStage(root, spec.slot, SUITE_RESERVATIONS.conversationNanoUsd);
    await claimPilotSlot(root, spec.slot as `pair-${string}`, { runId: suiteRunId(root, spec), slot: spec.slot, wave: 1, pair: 1, position: 1, arm: "baseline",
      scheduleIndex: 0, corpusSha256: RH7_CORPUS_REUSE.digest, implementationAcceptanceSha256: await digestFile(acceptancePath) });
    const collect = await suiteCollect(acceptancePath, auth, corpus, options);
    assert.match(String(collect.halt), /not run by this controller: pair-01-baseline/);
    assert.deepEqual(collect.admitted, []);
    await assert.rejects(suiteClose(acceptancePath, "reason", options), /record an interruption first/);
    await assert.rejects(suiteSettle(acceptancePath, options), /record an interruption before settling/);
    await assert.rejects(suiteReviewInputs(acceptancePath, join(base, "r"), options), /without a terminal record/);
    const evidence = join(base, "inspection.txt"); await writeFile(evidence, "fixture: no process\n");
    const receipt = async (name: string, extra: Record<string, unknown>) => {
      const path = join(base, name);
      writeNewJson(path, await bound("pilot-interruption-receipt", { noActiveProcess: true, slot: spec.slot, rationale: "Fixture", inspectedAt: "2026-11-08T22:00:00Z",
        inspectionEvidencePath: evidence, inspectionEvidenceSha256: await digestFile(evidence), ...extra }));
      return path;
    };
    await assert.rejects(suiteInterrupt(acceptancePath, await receipt("active.json", { noActiveProcess: false }), options), /interruption-receipt is missing, rejected/);
    await assert.rejects(suiteInterrupt(acceptancePath, await receipt("other.json", { slot: "pair-02-candidate" }), options), /not claimed without a terminal record/);
    await suiteInterrupt(acceptancePath, await receipt("ok.json", {}), options);
    const balance = await readSuiteLedger(root);
    assert.deepEqual([balance.active[spec.slot], balance.unknownNanoUsd], [undefined, SUITE_RESERVATIONS.conversationNanoUsd], "the full reservation is held");
    const after = await suiteCollect(acceptancePath, auth, corpus, options);
    assert.match(String(after.halt), /stopped at pair-01-baseline/);
    assert.deepEqual(after.admitted, [], "an interruption stops new admissions; no replacement");
    await acquireControllerLock(root, "crashed-controller");
    await assert.rejects(suiteInterrupt(acceptancePath, await receipt("lock-wrong.json", { slot: "controller-lock", lockOwnerSha256: "0".repeat(64) }), options), /current lock owner/);
    const owner = await digestFile(join(root, "controller.lock", "owner.json"));
    const moved = await suiteInterrupt(acceptancePath, await receipt("lock.json", { slot: "controller-lock", lockOwnerSha256: owner }), options);
    assert.ok((await readdir(moved)).includes("owner.json"), "the released lock is retained");
    const closure = JSON.parse(await readFile(await suiteClose(acceptancePath, "Fixture closure", options), "utf8"));
    assert.deepEqual(closure.interruptedSlots, [spec.slot]);
    const settlement = JSON.parse(await readFile(await suiteSettle(acceptancePath, options), "utf8"));
    assert.equal(settlement.unknownNanoUsd, SUITE_RESERVATIONS.conversationNanoUsd);
    await analyseSuite(root, join(base, "analysis"), { planPath: fixture.planPath });
    const inventory = JSON.parse(await readFile(join(base, "analysis", "suite-inventory.json"), "utf8"));
    assert.deepEqual([inventory.collection.interrupted, inventory.collection.notRun], [1, 3]);
    const analysis = JSON.parse(await readFile(join(base, "analysis", "suite-analysis.json"), "utf8"));
    assert.ok(analysis.pairs.every((pair: { status: string }) => pair.status !== "collected"), "every planned pair is listed, none collected");
    assert.equal(analysis.incidents.operationallyClean, false);
  } finally { globalThis.fetch = savedFetch; await rm(base, { recursive: true, force: true }); }
});

test("a worker refuses a pre-populated workspace before creating a session", { timeout: 120_000 }, async () => {
  const root = await scratch("handoff-rh8-workspace-");
  try {
    const frozen = await loadFrozenInputs({ path: RH7_CORPUS_REUSE.path });
    const host = await loadPinnedHost();
    const paths = createRunDirectory(join(root, "runs"), "planted-workspace");
    await mkdir(join(paths.workspace, ".search"));
    await writeFile(join(paths.workspace, ".search", ".index.json"), "[]");
    const manifest = { ...pilotManifest({ runId: "planted-workspace", arm: "baseline", phase: "pilot-synthetic", host: host.identity,
      codeSha256: (await sourceIdentity(REPO_ROOT)).digest, protocolSha256: await digestFile(RH8_PROTOCOL_PATH), frozen, synthetic: true, scenario: "complete", definition: RH8_BASE }), pair: 1 };
    const record = await executeWorker({ schemaVersion: 1, manifest, ...paths, frozenPath: RH7_CORPUS_REUSE.path,
      pilot: { revision: RH8_PROTOCOL_REVISION, budgetNanoUsd: SUITE_RESERVATIONS.conversationNanoUsd, financialMode: "known-charges", scenario: "complete" } });
    assert.equal(record.manifest.status, "failed");
    assert.match(await readFile(join(paths.directory, "process.log"), "utf8"), /Worker workspace is not empty/);
    assert.ok((await readdir(join(paths.workspace, ".search"))).includes(".index.json"));
    await assert.rejects(stat(join(paths.agentDir, "settings.json")), /ENOENT/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// r4: settlement race, ledger-order worker check, budget backpressure, settlement errors, CLI process-group SIGINT
// ---------------------------------------------------------------------------

test("planner admits nothing while a running slot already has a record (settling), even when another pair is eligible", () => {
  const t = Date.parse("2026-11-08T10:00:00.000Z");
  const state = stateOf(10, 2, { "pair-01-baseline": done(), "pair-02-candidate": { status: "terminal", claimed: true, terminal: true, safe: false, endedAt: "2026-11-08T10:00:30.000Z" } },
    { stops: [{ slot: "pair-02-candidate", reasons: ["Final charges are not known"] }] });
  const settling = planAdmissions(state, new Set(["pair-02-candidate"]), t + 60_000, 30_000);
  assert.deepEqual([settling.admit, settling.blocked], [[], null], "pair-01-candidate waits until pair-02-candidate has settled");
  assert.match(String(planAdmissions(state, new Set(), t + 60_000, 30_000).blocked), /stopped at pair-02-candidate/);
});

async function terminalSynthetic(c: Awaited<ReturnType<typeof rehearsalContext>>, slot: string, scenario: PilotSyntheticScenario) {
  const spec = scheduleFor(c.ctx.definition).find(item => item.slot === slot)!;
  const runId = suiteRunId(c.root, spec), host = await loadPinnedHost();
  await claimPilotSlot(c.root, slot as `pair-${string}`, { runId, slot, wave: spec.wave, pair: spec.pair, position: spec.position, arm: spec.arm, scheduleIndex: spec.index, corpusSha256: c.frozen.digest });
  await markPilotDispatch(c.root, slot as `pair-${string}`, runId);
  const paths = createRunDirectory(join(c.root, "runs"), runId);
  const manifest = { ...pilotManifest({ runId, arm: spec.arm, phase: "pilot-synthetic", host: host.identity, codeSha256: c.ctx.codeSha256, protocolSha256: c.ctx.protocolSha256,
    frozen: c.frozen, synthetic: true, scenario, definition: c.ctx.definition }), pair: spec.pair };
  await executeWorker({ schemaVersion: 1, manifest, ...paths, frozenPath: c.frozenPath, pilot: { revision: RH8_PROTOCOL_REVISION, budgetNanoUsd: SUITE_RESERVATIONS.conversationNanoUsd, financialMode: "known-charges", scenario } });
  return spec;
}
async function claimOnly(c: Awaited<ReturnType<typeof rehearsalContext>>, slot: string) {
  const spec = scheduleFor(c.ctx.definition).find(item => item.slot === slot)!;
  await claimPilotSlot(c.root, slot as `pair-${string}`, { runId: suiteRunId(c.root, spec), slot, wave: spec.wave, pair: spec.pair, position: spec.position, arm: spec.arm, scheduleIndex: spec.index, corpusSha256: c.frozen.digest });
  return spec;
}

test("worker check uses ledger order: a stop settled after this slot's reservation never refuses it; one settled before always does", { timeout: 120_000 }, async () => {
  const c = await rehearsalContext(3, 3);
  try {
    const r = SUITE_RESERVATIONS.conversationNanoUsd;
    await reserveSuiteStage(c.root, "pair-01-baseline", r);
    await terminalSynthetic(c, "pair-01-baseline", "unknown-charge");
    await reserveSuiteStage(c.root, "pair-02-candidate", r);
    const admittedBefore = await claimOnly(c, "pair-02-candidate");
    await settleFromReceipt(c.root, "pair-01-baseline", join(c.root, "runs", suiteRunId(c.root, { pair: 1, arm: "baseline" }), "budget.json"), r);
    await assert.doesNotReject(verifyWorkerSlot(c.ctx, c.frozen, admittedBefore, Date.now(), c.root), "admitted before the stop was known: it drains");
    // Release the unknown hold's headroom by settling pair-02 so a third reservation fits, then reserve pair-03 after the stop.
    await settleSuiteStage(c.root, "pair-02-candidate", 0, 0, "fixture");
    await reserveSuiteStage(c.root, "pair-03-baseline", r);
    const admittedAfter = await claimOnly(c, "pair-03-baseline");
    await assert.rejects(verifyWorkerSlot(c.ctx, c.frozen, admittedAfter, Date.now(), c.root), /stopped at pair-01-baseline before pair-03-baseline was reserved/);
  } finally { await rm(c.root, { recursive: true, force: true }); }
});

function withCeiling(c: Awaited<ReturnType<typeof rehearsalContext>>, ceiling: number): Awaited<ReturnType<typeof rehearsalContext>> {
  const definition = { ...c.ctx.definition, cumulative: { ...c.ctx.definition.cumulative!, combinedCeilingNanoUsd: ceiling } };
  return { ...c, ctx: { ...c.ctx, definition } };
}
async function freshLedger(c: Awaited<ReturnType<typeof rehearsalContext>>) {
  await rm(join(c.root, "ledger.jsonl"));
  await createSuiteLedger(c.root, c.ctx.definition);
}

test("budget backpressure: a full reservation that does not fit waits for admitted work, records a degradation and is never reduced", { timeout: 300_000 }, async () => {
  const base = await rehearsalContext(2, 2);
  const c = withCeiling(base, HISTORICAL_PRIOR_REPORTED_NANO_USD + SUITE_RESERVATIONS.conversationNanoUsd + 2_000_000_000);
  await freshLedger(c);
  const exec = deferredExecutor();
  try {
    const run = runController(controllerOptions(c, exec.execute));
    await waitFor(() => exec.waiting.length === 1);
    await new Promise(r => setTimeout(r, 1_000));
    assert.deepEqual(exec.order, ["pair-01-baseline"], "the second pair's reservation waits instead of shrinking");
    const events = await readdir(join(c.root, "controller-events"));
    assert.ok(events.some(name => name.includes("concurrency-degradation-pair-02-candidate")));
    for (const slot of ["pair-01-baseline", "pair-02-candidate", "pair-01-candidate", "pair-02-baseline"]) { await waitFor(() => exec.order.includes(slot)); await exec.release(slot); }
    const result = await run;
    assert.deepEqual([result.outcome, exec.peak], ["complete", 1]);
    assert.ok(result.budgetWaits.includes("pair-02-candidate"));
    for (const slot of exec.order) assert.equal(JSON.parse(await readFile(join(c.root, "claims", slot, "claim.json"), "utf8")).ledger.reservationNanoUsd, SUITE_RESERVATIONS.conversationNanoUsd);
    await analyseSuite(c.root, join(c.root, "analysis-out"), { phase: "pilot-synthetic", definition: c.ctx.definition }).catch(() => undefined);
  } finally { await rm(c.root, { recursive: true, force: true }); }
  const empty = await rehearsalContext(1, 1);
  const tight = withCeiling(empty, HISTORICAL_PRIOR_REPORTED_NANO_USD + SUITE_RESERVATIONS.conversationNanoUsd - 1);
  await freshLedger(tight);
  try {
    const result = await runController(controllerOptions(tight, deferredExecutor().execute));
    assert.equal(result.outcome, "owner-decision");
    assert.deepEqual(result.admitted, []);
    assert.ok((await readdir(join(tight.root, "controller-events"))).some(name => name.includes("ceiling-exhausted")));
    await assert.rejects(stat(join(tight.root, "claims")), /ENOENT/, "nothing was claimed");
  } finally { await rm(tight.root, { recursive: true, force: true }); }
});

test("a settlement error stops new admissions, keeps the controller running until every admitted worker ends, and a resume reconciles it", { timeout: 300_000 }, async () => {
  const c = await rehearsalContext(2, 2);
  const exec = deferredExecutor();
  try {
    let returned = false;
    const failing: typeof settleFromReceipt = async (root, id, budget, reservation) => {
      if (id === "pair-01-baseline") throw new Error("fixture: ledger lock held by another process");
      return settleFromReceipt(root, id, budget, reservation);
    };
    const run = runController({ ...controllerOptions(c, exec.execute), settle: failing }).then(result => { returned = true; return result; });
    await waitFor(() => exec.waiting.length === 2);
    await exec.release("pair-01-baseline");
    await waitFor(() => !!exec.executions.get("pair-01-baseline"));
    for (let i = 0; i < 200 && !(await readdir(c.root)).includes("controller-events"); i++) await new Promise(r => setTimeout(r, 50));
    await new Promise(r => setTimeout(r, 1_000));
    assert.equal(returned, false, "the controller, and so its lock, stays while pair-02-candidate runs");
    assert.deepEqual(exec.order, ["pair-01-baseline", "pair-02-candidate"], "no admission after the settlement error");
    await exec.release("pair-02-candidate");
    const result = await run;
    assert.equal(result.outcome, "paused");
    assert.match(String(result.halt), /Settlement of pair-01-baseline failed/);
    assert.deepEqual(result.settlementErrors.map(item => item.slot), ["pair-01-baseline"]);
    const balance = await readSuiteLedger(c.root);
    assert.deepEqual(Object.keys(balance.active), ["pair-01-baseline"], "the failed settlement leaves only its own reservation held");
    const resumed = deferredExecutor();
    const next = runController(controllerOptions(c, resumed.execute));
    for (const slot of ["pair-01-candidate", "pair-02-baseline"]) { await waitFor(() => resumed.order.includes(slot)); await resumed.release(slot); }
    const final = await next;
    assert.deepEqual([final.outcome, final.reconciled], ["complete", ["pair-01-baseline"]]);
    assert.deepEqual(Object.keys((await readSuiteLedger(c.root)).active), []);
  } finally { await rm(c.root, { recursive: true, force: true }); }
});

test("real CLI: a process-group SIGINT drains running workers, which complete and settle; the resume finishes without duplicates", { timeout: 600_000 }, async () => {
  const root = join(await scratch("handoff-rh8-cli-"), "rehearsal");
  const cli = join(REPO_ROOT, "scripts/research-handoff/cli.ts");
  const env = { ...process.env, RH8_SYNTHETIC_DELAY_MS: "8000" };
  try {
    const child = spawn(process.execPath, ["--import", "tsx", cli, "rh8-rehearse", root, "clean"], { cwd: REPO_ROOT, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; child.stdout.on("data", data => { output += data; }); child.stderr.on("data", data => { output += data; });
    const runs = async () => { try { return await readdir(join(root, "runs")); } catch { return []; } };
    const started = async () => { const list = await runs(); if (list.length !== 2) return false; for (const run of list) { try { await stat(join(root, "runs", run, "started.json")); } catch { return false; } } return true; };
    for (let i = 0; i < 600 && !await started(); i++) await new Promise(r => setTimeout(r, 100));
    const before = await runs();
    for (const run of before) await assert.rejects(stat(join(root, "runs", run, "record.json")), /ENOENT/, "both workers are mid-run when the signal arrives");
    process.kill(-child.pid!, "SIGINT");
    const code = await new Promise<number | null>(done => child.on("close", value => done(value)));
    assert.equal(code, 3, output);
    assert.match(output, /PAUSED by signal after draining/);
    for (const run of before) {
      const exit = JSON.parse(await readFile(join(root, "runs", run, "process-exit.json"), "utf8"));
      const record = JSON.parse(await readFile(join(root, "runs", run, "record.json"), "utf8")) as RunRecord;
      assert.deepEqual([exit.exit, exit.signal, record.manifest.status], [0, null, "completed"], run);
    }
    const ledger = (await readFile(join(root, "ledger.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line) as { kind: string; runId?: string; unknownNanoUsd?: number });
    assert.deepEqual(ledger.filter(row => row.kind === "settle").map(row => [row.runId, row.unknownNanoUsd]).sort(), [["pair-01-baseline", 0], ["pair-02-candidate", 0]]);
    const resume = spawnSync(process.execPath, ["--import", "tsx", cli, "rh8-rehearse-resume", root], { cwd: REPO_ROOT, env: { ...process.env }, encoding: "utf8" });
    assert.equal(resume.status, 0, resume.stdout + resume.stderr);
    const outcome = JSON.parse(await readFile(join(root, "rehearsal-outcome.json"), "utf8"));
    assert.deepEqual([outcome.passed, outcome.outcome], [true, "complete"], JSON.stringify(outcome.problems));
    const reserves = (await readFile(join(root, "ledger.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line) as { kind: string; runId?: string }).filter(row => row.kind === "reserve").map(row => row.runId);
    assert.equal(reserves.length, 8);
    assert.equal(new Set(reserves).size, 8, "no slot reserved twice");
    assert.equal((await runs()).length, 8, "no run directory reused or duplicated");
  } finally { await rm(join(root, ".."), { recursive: true, force: true }); }
});
