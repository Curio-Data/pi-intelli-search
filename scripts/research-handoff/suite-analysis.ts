// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// rh-v8 full-population inventory and paired analysis (SUITE-PROTOCOL.md,
// Analysis). Offline and credential-free: it reads only retained evidence,
// lists every scheduled slot whether or not it ran, treats missing usage as
// unknown and keeps machine checks, answer quality, incidents, money and
// subscription usage in separate sections. The output carries no clock
// reading, so a repeat run over the same evidence is byte-identical.

import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { RunRecord } from "./contracts.js";
import { loadFrozenInputs } from "./common-inputs.js";
import { digestFile, digestObject, digestText, sourceIdentity, writeNewJson } from "./storage.js";
import { pilotChecksFor } from "./pilot-checks.js";
import { pilotRunId, type PilotDefinition } from "./pilot-config.js";
import { SUITE_MIN_GAP_MS, pairOrder } from "./pilot-suite.js";
import { definitionFromPlan, type StudyPlan } from "./study-plan.js";
import { SUITE_REPO_ROOT, suiteCollectionState, type SuiteContext, type SuiteSlotState } from "./suite-admission.js";

const exists = async (path: string) => { try { await stat(path); return true; } catch { return false; } };
async function readObject(path: string): Promise<Record<string, unknown> | undefined> {
  try { return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>; } catch { return undefined; }
}
const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;

/** Declared before collection; see SUITE-PROTOCOL.md, Analysis. */
export const SUITE_PRIMARY_METRIC = "mainTotalTokens" as const;
export const SUITE_METRICS = [
  "mainTotalTokens", "mainInputTokens", "mainUncachedInputTokens", "mainOutputTokens", "mainCacheReadTokens", "mainReasoningTokens",
  "mainProviderAttempts", "logicalMainRequests", "recoveryCalls",
  "downstreamKnownNanoUsd", "downstreamInputTokens", "downstreamOutputTokens", "downstreamProviderAttempts", "configuredRetries",
  "wallMs", "finalAnswerChars",
] as const;
export type SuiteMetric = typeof SUITE_METRICS[number];

type Checks = Awaited<ReturnType<typeof pilotChecksFor>>;
export function runMetrics(record: RunRecord | undefined, checks: Checks): Record<SuiteMetric, number | null> {
  const usage = checks.usage, downstream = checks.downstream;
  const analysable = !checks.analysisError && !!record;
  const stages = downstream ? Object.values(downstream.byStage) : [];
  const started = Date.parse(String(record?.manifest?.startedAt)), ended = Date.parse(String(record?.manifest?.endedAt));
  const f = checks.financial;
  return {
    mainTotalTokens: finite(usage?.total.value), mainInputTokens: finite(usage?.input.value), mainUncachedInputTokens: finite(usage?.uncachedInput.value),
    mainOutputTokens: finite(usage?.output.value), mainCacheReadTokens: finite(usage?.cacheRead.value), mainReasoningTokens: finite(usage?.reasoning.value),
    mainProviderAttempts: analysable && usage ? usage.attempts : null,
    logicalMainRequests: analysable && Array.isArray(record?.requests) ? record!.requests.length : null,
    recoveryCalls: analysable ? checks.recoveryCalls : null,
    downstreamKnownNanoUsd: checks.budgetReceipt && !f.unknownNanoUsd && !f.activeNanoUsd ? f.knownNanoUsd : null,
    downstreamInputTokens: finite(downstream?.usage.input.value), downstreamOutputTokens: finite(downstream?.usage.output.value),
    downstreamProviderAttempts: analysable && downstream ? downstream.providerAttempts : null,
    configuredRetries: analysable && downstream ? stages.reduce((sum, stage) => sum + Math.max(0, stage.providerAttempts - stage.logicalRequests), 0) : null,
    wallMs: Number.isFinite(started) && Number.isFinite(ended) && ended >= started ? ended - started : null,
    finalAnswerChars: analysable && typeof record?.finalAnswer === "string" ? record!.finalAnswer.length : null,
  };
}

export interface Distribution { n: number; mean: number | null; median: number | null; minimum: number | null; maximum: number | null }
export function distribution(values: number[]): Distribution {
  if (!values.length) return { n: 0, mean: null, median: null, minimum: null, maximum: null };
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return { n: values.length, mean: values.reduce((a, b) => a + b, 0) / values.length,
    median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2, minimum: sorted[0], maximum: sorted.at(-1)! };
}
/** Exact two-sided binomial (sign or McNemar) test on the nonzero signs; null when there are none. */
export function exactTwoSidedSignP(positive: number, negative: number): number | null {
  const n = positive + negative;
  if (!n) return null;
  const k = Math.min(positive, negative);
  // Probabilities, not coefficients: P(0) = 2^-n, P(i) = P(i-1)(n-i+1)/i. Stable without overflow for every planned n (at most 198).
  let tail = 0, probability = 0.5 ** n;
  for (let i = 0; i <= k; i++) { if (i > 0) probability = probability * (n - i + 1) / i; tail += probability; }
  return Math.min(1, 2 * tail);
}

interface ConversationRow {
  slot: string; pair: number; position: number; arm: string; runId: string; runIdSha256: string;
  status: "not-run" | "in-flight" | "interrupted" | "collected";
  wave: number;
  interval: { startedAt: string; endedAt: string } | null;
  overlapsWith: string[];
  claimed: boolean; dispatched: boolean; recordPath: string | null; recordSha256: string | null;
  machinePassed: boolean | null; failingChecks: string[]; continuationSafe: boolean | null; stopReasons: string[];
  financial: SuiteSlotState["financial"] | null;
  gate: { path: string; sha256: string; passed: boolean; machinePassed: boolean; qualityPassed: boolean; reviewerPasses: unknown; adjudicated: unknown } | null;
  gateProblems: string[];
  quality: boolean | null;
  metrics: Record<SuiteMetric, number | null>;
  automaticIncidents: Array<{ category: string; detail: string }>;
  mainUsage: { input: number | null; output: number | null; total: number | null; complete: boolean };
}
const NULL_METRICS = Object.fromEntries(SUITE_METRICS.map(metric => [metric, null])) as Record<SuiteMetric, null>;

/**
 * Actual overlap from recorded start and end times: each conversation's overlapping slots, the
 * peak number running at once, per-wave spans, and per-pair checks that the arms did not overlap
 * and that the second began at least the gap after the first ended. Fills `overlapsWith`.
 */
export function observedConcurrency(rows: Array<Pick<ConversationRow, "slot" | "pair" | "position" | "wave" | "interval" | "overlapsWith">>) {
  const timed = rows.filter(row => row.interval).map(row => ({ row, start: Date.parse(row.interval!.startedAt), end: Date.parse(row.interval!.endedAt) }));
  for (const a of timed) a.row.overlapsWith = timed.filter(b => b !== a && b.start < a.end && a.start < b.end).map(b => b.row.slot).sort();
  const events = timed.flatMap(item => [{ at: item.start, delta: 1 }, { at: item.end, delta: -1 }]).sort((x, y) => x.at - y.at || x.delta - y.delta);
  let running = 0, peak = 0;
  for (const event of events) { running += event.delta; peak = Math.max(peak, running); }
  const waves = [...new Set(rows.map(row => row.wave))].sort((a, b) => a - b).map(wave => {
    const members = timed.filter(item => item.row.wave === wave);
    return { wave, conversationsTimed: members.length, startedAt: members.length ? new Date(Math.min(...members.map(m => m.start))).toISOString() : null,
      endedAt: members.length ? new Date(Math.max(...members.map(m => m.end))).toISOString() : null };
  });
  const pairs = [...new Set(rows.map(row => row.pair))].sort((a, b) => a - b).map(pair => {
    const first = timed.find(item => item.row.pair === pair && item.row.position === 1), second = timed.find(item => item.row.pair === pair && item.row.position === 2);
    return { pair, armsOverlap: !!first && !!second && second.start < first.end, gapMs: first && second ? second.start - first.end : null };
  });
  return { observedPeak: peak, conversationsTimed: timed.length, untimedConversations: rows.filter(row => !row.interval).map(row => row.slot), waves, pairs,
    note: "Observed from each record's start and end time. Overlap with other pairs is recorded because provider contention can affect timing and usage." };
}

/** Retained controller events in name order: budget waits (concurrency degradation), ceiling exhaustion and settlement errors. */
async function controllerEvents(root: string): Promise<Array<Record<string, unknown> & { kind: string; slot?: string; path: string }>> {
  let names: string[] = [];
  try { names = (await readdir(join(root, "controller-events"))).filter(name => name.endsWith(".json")).sort(); } catch { return []; }
  const events = [];
  for (const name of names) events.push({ ...(JSON.parse(await readFile(join(root, "controller-events", name), "utf8")) as { kind: string; slot?: string }), path: `controller-events/${name}` });
  return events;
}

/** Categories of REPEAT-PROTOCOL.md, Operational Cleanliness and Quality. */
export const INCIDENT_CATEGORIES = ["configured-retry", "provider-incident", "reviewer-incident", "controller-incident"] as const;
/** A coordinator incident record: schemaVersion 1 and every incident with its category, step, time, evidence path and effect. */
export function validateIncidents(record: Record<string, unknown>): string[] {
  const problems: string[] = [];
  if (record.schemaVersion !== 1) problems.push("incidents.json schemaVersion is not 1");
  if (!Array.isArray(record.incidents)) { problems.push("incidents.json has no incidents array"); return problems; }
  for (const [index, value] of (record.incidents as unknown[]).entries()) {
    const incident = (value ?? {}) as Record<string, unknown>;
    if (typeof value !== "object" || value === null || Array.isArray(value)) { problems.push(`Incident ${index + 1} is not an object`); continue; }
    if (!(INCIDENT_CATEGORIES as readonly string[]).includes(String(incident.category))) problems.push(`Incident ${index + 1} has no recognised category`);
    for (const field of ["step", "evidencePath", "effect"]) if (typeof incident[field] !== "string" || !(incident[field] as string).trim()) problems.push(`Incident ${index + 1} lacks ${field}`);
    if (!Number.isFinite(Date.parse(String(incident.at)))) problems.push(`Incident ${index + 1} lacks a valid time`);
  }
  return problems;
}

/**
 * Everything that prevents the series from being called operationally clean. Absent evidence is
 * a blocker, never a pass: each preparation receipt must be accepted, every conversation collected
 * and safe, every answer gated, the series settled with known charges only, and the coordinator's
 * incident record present, well formed and empty, as must the automatic incident list.
 */
async function cleanlinessBlockers(input: { root: string; phase: string; state: Awaited<ReturnType<typeof suiteCollectionState>>; conversations: ConversationRow[];
  observers: Array<Record<string, unknown>>; settlement?: Record<string, unknown>; coordinatorIncidents?: Record<string, unknown>; incidentProblems: string[];
  autoIncidents: unknown[]; coordinatorList: unknown[] }): Promise<string[]> {
  const blockers: string[] = [];
  const { root, state, conversations } = input;
  if (input.phase === "pilot") {
    const accepted: Array<[string, string]> = [["diagnostic-acceptance.json", "pilot-diagnostic-acceptance"], ["financial-admission-receipt.json", "pilot-financial-admission"],
      ["corpus-import/outcome.json", "pilot-corpus-import-outcome"], ["corpus-acceptance.json", "pilot-corpus-acceptance"], ["charge-qualification/outcome.json", "pilot-charge-qualification-outcome"]];
    for (const [path, kind] of accepted) {
      const receipt = await readObject(join(root, path));
      if (receipt?.kind !== kind || receipt.accepted !== true) blockers.push(`Preparation receipt ${path} is missing or not accepted`);
    }
    if (input.observers.length !== 2 || input.observers.some(row => row.status !== "collected" || row.machinePassed !== true)) blockers.push("Both observers did not pass machine checks");
  }
  if (state.integrityProblems.length) blockers.push(...state.integrityProblems.map(problem => `Schedule integrity: ${problem}`));
  if (!state.complete) blockers.push("Not every scheduled conversation ran");
  for (const stop of state.stops) blockers.push(`New admissions stopped at ${stop.slot}`);
  if (state.inFlight.length) blockers.push(`In flight without a terminal record: ${state.inFlight.join(", ")}`);
  if (state.closure) blockers.push("Collection was closed early");
  for (const row of conversations) {
    if (row.status === "collected" && !row.continuationSafe) blockers.push(`${row.slot} did not finish safely`);
    if (row.status === "collected" && !row.gate) blockers.push(`${row.slot} has no valid gate`);
    if (row.gateProblems.length) blockers.push(`${row.slot}: ${row.gateProblems.join("; ")}`);
  }
  const s = input.settlement;
  if (!s) blockers.push("The series is not settled");
  else if (s.kind !== "pilot-settlement" || s.closed !== true || s.unknownNanoUsd !== 0 || s.activeNanoUsd !== 0 || s.overrunNanoUsd !== 0) blockers.push("The settlement is not closed with known charges only");
  if (!input.coordinatorIncidents) blockers.push("No coordinator incidents.json: incidents are unestablished");
  else if (input.incidentProblems.length) blockers.push(`incidents.json is malformed: ${input.incidentProblems.join("; ")}`);
  if (input.autoIncidents.length) blockers.push(`${input.autoIncidents.length} automatic incident(s)`);
  if (input.coordinatorList.length) blockers.push(`${input.coordinatorList.length} coordinator-recorded incident(s)`);
  return blockers;
}

/**
 * Writes `suite-inventory.json` and `suite-analysis.json` beneath a new output directory.
 * `phase` is "pilot" for the live series and "pilot-synthetic" for the rehearsal only.
 */
export async function analyseSuite(rootInput: string, output: string, options: { phase?: "pilot" | "pilot-synthetic"; definition?: PilotDefinition; planPath?: string } = {}): Promise<void> {
  const root = resolve(rootInput), phase = options.phase ?? "pilot";
  let definition = options.definition;
  if (!definition) {
    // Offline: the plan named here must be the one the root was bound to. Its owner directions were verified at every live step.
    if (!options.planPath) throw new Error("Live-series analysis needs the bound study plan");
    const bound = await readObject(join(root, "pilot-root-binding.json"));
    const planSha256 = await digestFile(options.planPath);
    if ((bound?.binding as Record<string, string> | undefined)?.planSha256 !== planSha256) throw new Error("The plan is not the one this root is bound to");
    definition = definitionFromPlan(JSON.parse(await readFile(options.planPath, "utf8")) as StudyPlan, resolve(options.planPath), planSha256);
  }
  if (!definition.suite || !definition.cumulative) throw new Error(`${definition.revision} has no suite schedule`);
  const rel = (path: string) => relative(root, path);
  let identity: { codeSha256: string; protocolSha256: string; implementationAcceptanceSha256?: string; ownerDecisionSha256?: string };
  let identitySource: string;
  if (phase === "pilot") {
    const bound = await readObject(join(root, "pilot-root-binding.json"));
    const b = bound?.binding as Record<string, string> | undefined;
    if (!b || bound?.protocolRevision !== definition.revision) throw new Error("The series root has no binding for this revision");
    identity = { codeSha256: b.codeSha256, protocolSha256: b.protocolSha256, implementationAcceptanceSha256: b.implementationAcceptanceSha256, ownerDecisionSha256: b.ownerDecisionSha256 };
    identitySource = "pilot-root-binding.json";
  } else {
    const rehearsal = await readObject(join(root, "suite-identity.json"));
    if (rehearsal?.kind !== "suite-rehearsal") throw new Error("Synthetic analysis needs a rehearsal root");
    identity = { codeSha256: String(rehearsal.codeSha256), protocolSha256: String(rehearsal.protocolSha256) };
    identitySource = "suite-identity.json";
  }
  const frozenPath = join(root, "corpus-import", "frozen-inputs.json");
  const frozen = await loadFrozenInputs({ path: frozenPath });
  const ctx: SuiteContext = { root, definition, phase, codeSha256: identity.codeSha256, protocolSha256: identity.protocolSha256,
    implementationAcceptanceSha256: identity.implementationAcceptanceSha256, minGapMs: SUITE_MIN_GAP_MS };
  const state = await suiteCollectionState(ctx, frozen);

  const conversations: ConversationRow[] = [];
  for (const slot of state.slots) {
    const directory = join(root, "runs", slot.runId), recordPath = join(directory, "record.json");
    const row: ConversationRow = { slot: slot.slot, pair: slot.pair, position: slot.position, arm: slot.arm, runId: slot.runId, runIdSha256: digestText(slot.runId),
      status: slot.status === "unclaimed" ? "not-run" : slot.status === "terminal" ? "collected" : slot.status, wave: slot.wave,
      interval: slot.startedAt && slot.endedAt && Number.isFinite(Date.parse(slot.startedAt)) && Number.isFinite(Date.parse(slot.endedAt)) ? { startedAt: slot.startedAt, endedAt: slot.endedAt } : null,
      overlapsWith: [], claimed: slot.claimed, dispatched: slot.dispatched,
      recordPath: slot.terminal ? rel(recordPath) : null, recordSha256: slot.recordSha256 ?? null,
      machinePassed: slot.terminal ? slot.machinePassed ?? false : null, failingChecks: slot.failingChecks,
      continuationSafe: slot.claimed ? slot.safe : null, stopReasons: slot.stopReasons, financial: slot.financial ?? null,
      gate: null, gateProblems: [], quality: null, metrics: { ...NULL_METRICS }, automaticIncidents: [],
      mainUsage: { input: null, output: null, total: null, complete: false } };
    if (slot.terminal) {
      const checks = await pilotChecksFor(directory, frozen, "known-charges");
      let record: RunRecord | undefined;
      try { record = JSON.parse(await readFile(recordPath, "utf8")) as RunRecord; } catch { /* unreadable: metrics stay unknown */ }
      row.metrics = runMetrics(record, checks);
      row.mainUsage = { input: row.metrics.mainInputTokens, output: row.metrics.mainOutputTokens, total: row.metrics.mainTotalTokens,
        complete: row.metrics.mainTotalTokens !== null };
      if ((row.metrics.configuredRetries ?? 0) > 0) row.automaticIncidents.push({ category: "configured-retry", detail: `${row.metrics.configuredRetries} downstream attempt(s) beyond the first` });
      if ((checks.downstream?.failures ?? 0) > 0) row.automaticIncidents.push({ category: "provider-incident", detail: `${checks.downstream!.failures} failed downstream attempt(s) or incomplete request(s)` });
      if (checks.financial.rejected) row.automaticIncidents.push({ category: "provider-incident", detail: "Budget refusal of a downstream attempt" });
      if (record?.error) row.automaticIncidents.push({ category: "controller-incident", detail: `Worker error: ${record.error}` });
      const gatePath = join(root, "gates", `${slot.slot}-gate.json`);
      if (await exists(gatePath)) {
        const gate = await readObject(gatePath);
        const assessment = (gate?.assessment ?? {}) as Record<string, unknown>;
        if (gate?.kind !== "suite-answer-gate" || gate.runId !== slot.runId || gate.slot !== slot.slot || gate.recordSha256 !== slot.recordSha256
          || typeof gate.qualityPassed !== "boolean") {
          row.gateProblems.push("Gate is malformed or bound to another record");
        } else {
          row.gate = { path: rel(gatePath), sha256: await digestFile(gatePath), passed: gate.passed === true, machinePassed: gate.machinePassed === true,
            qualityPassed: gate.qualityPassed, reviewerPasses: assessment.reviewerPasses ?? null, adjudicated: assessment.adjudicated ?? null };
          row.quality = gate.qualityPassed;
        }
      }
    }
    if (row.status === "in-flight" || row.status === "interrupted") row.automaticIncidents.push({ category: "controller-incident", detail: `Claimed conversation without a terminal record (${row.status})` });
    conversations.push(row);
  }

  const concurrency = { ...observedConcurrency(conversations), controllerEvents: await controllerEvents(root) };
  for (const event of concurrency.controllerEvents.filter(item => item.kind === "settlement-error")) {
    conversations.find(row => row.slot === event.slot)?.automaticIncidents.push({ category: "controller-incident", detail: `Settlement error: ${String(event.error)}` });
  }

  const observers = [];
  if (phase === "pilot") {
    for (const arm of ["baseline", "candidate"] as const) {
      const runId = pilotRunId(root, "observer", arm), directory = join(root, "runs", runId);
      if (!await exists(join(directory, "record.json"))) { observers.push({ arm, runId, status: "not-run" }); continue; }
      const observerFrozen = await loadFrozenInputs({ path: join(root, "observer", "frozen-inputs.json") });
      const checks = await pilotChecksFor(directory, observerFrozen, "no-charges");
      const usage = checks.usage;
      observers.push({ arm, runId, status: "collected", recordPath: rel(join(directory, "record.json")), machinePassed: checks.passed,
        failingChecks: checks.checks.filter(check => !check.pass).map(check => check.id),
        mainUsage: { input: finite(usage?.input.value), output: finite(usage?.output.value), total: finite(usage?.total.value), complete: finite(usage?.total.value) !== null } });
    }
  }
  const preparation = [];
  for (const name of ["diagnostic-acceptance.json", "financial-admission-receipt.json", "rates-at-admission.json", "corpus-import/outcome.json",
    "corpus-acceptance.json", "charge-qualification/outcome.json", "charge-qualification/budget.json", "collection-closure.json"]) {
    const path = join(root, name);
    preparation.push(await exists(path) ? { path: name, sha256: await digestFile(path) } : { path: name, present: false });
  }
  const settlementPath = join(root, "settlement-receipt.json"), settlement = await readObject(settlementPath);
  const incidentsPath = join(root, "incidents.json"), coordinatorIncidents = await readObject(incidentsPath);
  const qualificationBudget = await readObject(join(root, "charge-qualification", "budget.json"));

  const inventory = {
    schemaVersion: 1, kind: "suite-full-population-inventory", revision: definition.revision, phase, rootName: root.split(/[\\/]/).at(-1),
    identitySource, identity, corpusSha256: frozen.digest, scheduledPairs: definition.suite.pairs, scheduledConversations: conversations.length,
    orderRule: "odd pairs baseline then candidate; even pairs candidate then baseline",
    parallelPairs: definition.suite.parallelPairs, planSha256: definition.suite.planSha256,
    collection: { complete: state.complete, stops: state.stops, inFlight: state.inFlight, closed: !!state.closure, closureSha256: state.closureSha256 ?? null,
      integrityProblems: state.integrityProblems, claimed: state.claimed,
      collected: conversations.filter(row => row.status === "collected").length,
      notRun: conversations.filter(row => row.status === "not-run").length,
      inFlightWithoutRecord: conversations.filter(row => row.status === "in-flight").length,
      interrupted: conversations.filter(row => row.status === "interrupted").length },
    conversations, observers, preparation,
    settlement: settlement ? { path: "settlement-receipt.json", sha256: await digestFile(settlementPath) } : null,
    coordinatorIncidents: coordinatorIncidents ? { path: "incidents.json", sha256: await digestFile(incidentsPath) } : null,
    replacements: 0, newCaptures: 0,
  };

  // ---------------------------------------------------------------- paired analysis
  const pairs = Array.from({ length: definition.suite.pairs }, (_value, index) => {
    const pair = index + 1, baseline = conversations.find(row => row.pair === pair && row.arm === "baseline")!, candidate = conversations.find(row => row.pair === pair && row.arm === "candidate")!;
    const collected = baseline.status === "collected" && candidate.status === "collected";
    const status = collected ? "collected" : baseline.status === "not-run" && candidate.status === "not-run" ? "not-started" : "incomplete";
    return { pair, wave: baseline.wave, status, order: pairOrder(pair)[0] === "baseline" ? "baseline-first" : "candidate-first", collected,
      bothMachinePassed: collected && baseline.machinePassed === true && candidate.machinePassed === true,
      quality: { baseline: baseline.quality, candidate: candidate.quality, pairPassed: baseline.quality === null || candidate.quality === null ? null : baseline.quality && candidate.quality },
      differences: Object.fromEntries(SUITE_METRICS.map(metric => {
        const b = baseline.metrics[metric], c = candidate.metrics[metric];
        return [metric, { baseline: b, candidate: c, candidateMinusBaseline: collected && b !== null && c !== null ? c - b : null }];
      })) as Record<SuiteMetric, { baseline: number | null; candidate: number | null; candidateMinusBaseline: number | null }> };
  });
  const summarise = (population: typeof pairs) => Object.fromEntries(SUITE_METRICS.map(metric => {
    const known = population.filter(pair => pair.differences[metric].candidateMinusBaseline !== null);
    const diffs = known.map(pair => pair.differences[metric].candidateMinusBaseline!);
    const lower = diffs.filter(value => value < 0).length, higher = diffs.filter(value => value > 0).length;
    return [metric, { pairsInPopulation: population.length, pairsWithBothValues: known.length, pairsWithUnknownValue: population.length - known.length,
      baseline: distribution(known.map(pair => pair.differences[metric].baseline!)), candidate: distribution(known.map(pair => pair.differences[metric].candidate!)),
      candidateMinusBaseline: distribution(diffs), signs: { candidateLower: lower, candidateHigher: higher, equal: diffs.length - lower - higher },
      exactSignTestTwoSidedP: exactTwoSidedSignP(higher, lower) }];
  }));
  const collectedPairs = pairs.filter(pair => pair.collected);
  const byArm = (arm: "baseline" | "candidate") => {
    const rows = conversations.filter(row => row.arm === arm);
    const failing: Record<string, number> = {};
    for (const row of rows) for (const id of row.failingChecks) failing[id] = (failing[id] ?? 0) + 1;
    return { scheduled: rows.length, collected: rows.filter(row => row.status === "collected").length, notRun: rows.filter(row => row.status === "not-run").length,
      inFlightOrInterrupted: rows.filter(row => row.status === "in-flight" || row.status === "interrupted").length,
      machinePassed: rows.filter(row => row.machinePassed === true).length, machineFailed: rows.filter(row => row.machinePassed === false).length,
      failingCheckCounts: Object.fromEntries(Object.entries(failing).sort(([a], [b]) => a.localeCompare(b))),
      qualityPassed: rows.filter(row => row.quality === true).length, qualityFailed: rows.filter(row => row.quality === false).length,
      qualityUnknown: rows.filter(row => row.status === "collected" && row.quality === null).length };
  };
  const graded = collectedPairs.filter(pair => pair.quality.baseline !== null && pair.quality.candidate !== null);
  const candidateOnly = graded.filter(pair => pair.quality.candidate && !pair.quality.baseline).length;
  const baselineOnly = graded.filter(pair => pair.quality.baseline && !pair.quality.candidate).length;
  const autoIncidents = conversations.flatMap(row => row.automaticIncidents.map(incident => ({ slot: row.slot, ...incident })));
  const incidentCounts: Record<string, number> = {};
  for (const incident of autoIncidents) incidentCounts[incident.category] = (incidentCounts[incident.category] ?? 0) + 1;
  const incidentProblems = coordinatorIncidents ? validateIncidents(coordinatorIncidents) : [];
  const coordinatorList = Array.isArray(coordinatorIncidents?.incidents) ? coordinatorIncidents!.incidents as Array<Record<string, unknown>> : [];
  for (const incident of coordinatorList) { const category = String(incident?.category ?? "uncategorised"); incidentCounts[category] = (incidentCounts[category] ?? 0) + 1; }
  const blockers = await cleanlinessBlockers({ root, phase, state, conversations, observers, settlement, coordinatorIncidents, incidentProblems, autoIncidents, coordinatorList });
  const conversationKnown = conversations.reduce((sum, row) => sum + (row.financial?.knownNanoUsd ?? 0), 0);
  const conversationHeld = conversations.reduce((sum, row) => sum + (row.financial?.unknownNanoUsd ?? 0) + (row.financial?.activeNanoUsd ?? 0), 0);
  const subscriptionRows = [...conversations.filter(row => row.status === "collected").map(row => ({ id: row.slot, ...row.mainUsage })),
    ...observers.filter(row => row.status === "collected").map(row => ({ id: `observer-${row.arm}`, ...(row as { mainUsage: ConversationRow["mainUsage"] }).mainUsage }))];
  const sumKnown = (field: "input" | "output" | "total") => ({ observed: subscriptionRows.reduce((sum, row) => sum + (row[field] ?? 0), 0),
    conversationsWithUnknown: subscriptionRows.filter(row => row[field] === null).map(row => row.id) });

  const analysis = {
    schemaVersion: 1, kind: "suite-paired-analysis", revision: definition.revision, phase,
    claim: "Descriptive full-population comparison of the scheduled pairs. The primary outcomes are paired answer quality (exact two-sided McNemar test) and paired main-conversation total tokens (exact two-sided sign test); every other metric is secondary. No test, primary or secondary, is adjusted for multiplicity. No equivalence or savings claim follows from a non-significant result.",
    primary: { quality: "both-rubric answer gate per arm, paired", efficiency: SUITE_PRIMARY_METRIC },
    machine: { baseline: byArm("baseline"), candidate: byArm("candidate"),
      stops: state.stops, collectionComplete: state.complete, closed: !!state.closure },
    concurrency,
    quality: { baseline: byArm("baseline"), candidate: byArm("candidate"),
      pairs: { graded: graded.length, bothPassed: graded.filter(pair => pair.quality.baseline && pair.quality.candidate).length,
        neitherPassed: graded.filter(pair => !pair.quality.baseline && !pair.quality.candidate).length, candidateOnly, baselineOnly,
        ungradedOrIncomplete: pairs.length - graded.length },
      exactMcNemarTwoSidedP: exactTwoSidedSignP(candidateOnly, baselineOnly) },
    efficiency: {
      allCollectedPairs: summarise(collectedPairs),
      bothMachinePassedPairsSensitivity: summarise(collectedPairs.filter(pair => pair.bothMachinePassed)),
      primaryByOrder: {
        baselineFirst: summarise(collectedPairs.filter(pair => pair.order === "baseline-first"))[SUITE_PRIMARY_METRIC],
        candidateFirst: summarise(collectedPairs.filter(pair => pair.order === "candidate-first"))[SUITE_PRIMARY_METRIC],
      },
    },
    pairs,
    incidents: { automatic: autoIncidents, coordinatorRecorded: coordinatorList, countsByCategory: Object.fromEntries(Object.entries(incidentCounts).sort(([a], [b]) => a.localeCompare(b))),
      coordinatorRecordProblems: incidentProblems,
      operationallyClean: blockers.length === 0, cleanlinessBlockers: blockers,
      cleanlinessScope: "Observation through settlement, from retained evidence. Offline reproduction of this analysis is a later step, confirmed by comparing a second run byte for byte." },
    finance: { combinedCeilingNanoUsd: definition.cumulative.combinedCeilingNanoUsd, priorReportedNanoUsd: definition.cumulative.priorReportedNanoUsd,
      qualificationKnownNanoUsd: finite(qualificationBudget?.knownNanoUsd), conversationKnownNanoUsd: conversationKnown, conversationHeldNanoUsd: conversationHeld,
      settled: settlement?.closed === true,
      settlement: settlement ? { reportedNanoUsd: settlement.reportedNanoUsd, unknownNanoUsd: settlement.unknownNanoUsd, activeNanoUsd: settlement.activeNanoUsd,
        overrunNanoUsd: settlement.overrunNanoUsd, cumulative: settlement.cumulative ?? null } : null },
    subscription: { billing: "subscription main model; not part of the monetary settlement", paidConversations: subscriptionRows.filter(row => !row.id.startsWith("observer")).length,
      observerConversations: subscriptionRows.filter(row => row.id.startsWith("observer")).length,
      inputTokens: sumKnown("input"), outputTokens: sumKnown("output"), totalTokens: sumKnown("total") },
    inputs: { inventorySha256: digestObject(inventory), corpusSha256: frozen.digest, analyserCode: (await sourceIdentity(SUITE_REPO_ROOT)).digest,
      protocolSha256: await digestFile(definition.protocolPath), recordsIdentity: identity },
  };
  const directory = resolve(output);
  await mkdir(directory);
  writeNewJson(join(directory, "suite-inventory.json"), inventory);
  writeNewJson(join(directory, "suite-analysis.json"), analysis);
}
