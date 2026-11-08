// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// rh-v8 paired-suite base (SUITE-PROTOCOL.md, revision rh-v8-suite-2). This
// module freezes only what every authorised suite shares: the unchanged rh-v6
// task, settings, prompts, source policy, corpus and rubric, the per-attempt
// and per-conversation reservations and the historical prior settlements.
// Pair count, pair concurrency, root, budget ceiling and owner identities are
// data in a bound study plan (study-plan.ts), never source constants.
// Nothing here dispatches work, reads credentials or touches the network.

import { join, resolve } from "node:path";
import type { Arm } from "./contracts.js";
import { MAIN_MODEL } from "./config.js";
import { RH6_SOURCE_POLICY } from "./source-selection.js";
import { PILOT_BUDGET, PILOT_SERIES_ROOT, type PilotDefinition, type PriorSettlement } from "./pilot-config.js";
import { RH6_SERIES_ROOT, rh6Params, rh6Settings } from "./pilot-continuation.js";
import { PILOT_DEFINITIONS, RH7_CORPUS_REUSE, RH7_PRIOR_SETTLEMENTS, RH7_PROFILE, RH7_SERIES_ROOT } from "./pilot-repeat.js";

export const SUITE_REPO_ROOT = resolve(PILOT_SERIES_ROOT, "../../../..");
export const RH8_PROTOCOL_REVISION = "rh-v8-suite-2" as const;
export const RH8_PROTOCOL_PATH = join(SUITE_REPO_ROOT, "docs/experiments/research-handoff/SUITE-PROTOCOL.md");
/** The current series' identities. The plan records and verifies them; nothing dispatches from these constants alone. */
export const RH8_SCOPE = "research-handoff-ten-matched-pairs-rh-v8" as const;
export const RH8_OWNER_DIRECTION_PATH = join(SUITE_REPO_ROOT, "evidence/agents/20261108T152419Z-full-suite/owner-direction.json");
export const RH8_OWNER_DIRECTION_SHA256 = "18edcb6fdf05bfd05266d7d9255da275165480c334a9062a64a20b422e839129";
export const RH8_CONCURRENCY_DIRECTION_PATH = join(SUITE_REPO_ROOT, "evidence/agents/20261108T152419Z-full-suite/owner-concurrency-direction.json");
export const RH8_CONCURRENCY_DIRECTION_SHA256 = "8e6e44400dd1363ced5b5d25cb218cbf27c0bb652f832060cf12a980652df235";
export const RH8_SERIES_ROOT = join(SUITE_REPO_ROOT, "evidence/benchmarks/research-handoff/20261108T152419Z-rh-v8-suite");

/** rh-v6 profile and settings, unchanged. */
export const RH8_PROFILE = RH7_PROFILE;
/** Historical settled series every suite plan must account for: rh-v5, rh-v6, rh-v7. */
export const HISTORICAL_PRIOR_SETTLEMENTS: readonly PriorSettlement[] = Object.freeze([
  ...RH7_PRIOR_SETTLEMENTS,
  { path: join(RH7_SERIES_ROOT, "settlement-receipt.json"), sha256: "1c2852bb03beb41c73ce719ecf75c073662688c590df5a2cec38398c547a45db", reportedNanoUsd: 113_180_584 },
]);
export const HISTORICAL_PRIOR_REPORTED_NANO_USD = 248_450_317;
/** Unchanged single-pair ceilings, reserved one per admitted conversation against the plan's shared ceiling. */
export const SUITE_RESERVATIONS = Object.freeze({
  qualificationNanoUsd: 1_010_000_000,
  conversationNanoUsd: 4_090_000_000,
  m3AttemptNanoUsd: PILOT_BUDGET.m3AttemptNanoUsd,
  sonarAttemptNanoUsd: PILOT_BUDGET.sonarAttemptNanoUsd,
});
export const SUITE_MIN_GAP_MS = 30_000;
/** Honest bounds: two-digit slot names, and concurrency never above the pair count. */
export const SUITE_MAX_PAIRS = 99;
export const RH8_CLARIFICATION = {
  measuredHost: "Pi 1.5.0",
  mainModel: `${MAIN_MODEL.provider}/${MAIN_MODEL.model}`,
  mainBilling: "subscription",
  downstream: "MiniMax M3 extraction and collation through existing OpenRouter route",
  search: "reuse captured Sonar search and twelve page texts; no new search or fetch",
  spending: "retain original shared USD 10 cumulative ceiling; sequential reservations released only on known settlement; return to owner if an increase is actually needed",
} as const;

/**
 * The frozen study content shared by every suite plan. It has no `suite` field: a runnable
 * definition exists only after a bound plan supplies the pairs, concurrency, root and budget.
 */
export const RH8_BASE: PilotDefinition = Object.freeze({
  revision: RH8_PROTOCOL_REVISION, scope: "plan-bound", protocolPath: RH8_PROTOCOL_PATH,
  ownerDecisionPath: "plan-bound", ownerDecisionSha256: "plan-bound", seriesRoot: "plan-bound",
  profile: RH8_PROFILE,
  operationLimits: { commonCaptures: 0, chargeQualifications: 1, subscriptionObserverConversations: 2, paidEndToEndConversations: 0,
    replacementConversations: 0, recaptures: 0, measuredSprintConversations: 0 },
  budget: { totalNanoUsd: 0, captureNanoUsd: 0, qualificationNanoUsd: SUITE_RESERVATIONS.qualificationNanoUsd,
    baselinePilotNanoUsd: SUITE_RESERVATIONS.conversationNanoUsd, candidatePilotNanoUsd: SUITE_RESERVATIONS.conversationNanoUsd,
    sonarAttemptNanoUsd: SUITE_RESERVATIONS.sonarAttemptNanoUsd, m3AttemptNanoUsd: SUITE_RESERVATIONS.m3AttemptNanoUsd },
  sourcePolicy: RH6_SOURCE_POLICY, settings: rh6Settings, params: rh6Params,
  corpusReuse: RH7_CORPUS_REUSE, closedRoots: Object.freeze([RH6_SERIES_ROOT, RH7_SERIES_ROOT]),
});

/** Revision registry including rh-v8; the earlier registry in pilot-repeat.ts is unchanged. */
export function pilotDefinitionFor(revision: unknown): PilotDefinition {
  if (revision === RH8_PROTOCOL_REVISION) return RH8_BASE;
  const definition = typeof revision === "string" ? (PILOT_DEFINITIONS as Readonly<Record<string, PilotDefinition>>)[revision] : undefined;
  if (!definition) throw new Error(`Unknown pilot revision ${JSON.stringify(revision)}`);
  return definition;
}

// ---------------------------------------------------------------------------
// Deterministic schedule: waves of K pairs, alternating arm order by pair
// ---------------------------------------------------------------------------

export interface SuiteSlotSpec {
  /** Zero-based planned launch order across the schedule. */
  index: number;
  /** One-based wave: pairs (w-1)K+1 .. wK run concurrently; a wave starts after the previous one ends. */
  wave: number;
  pair: number;
  /** Position of this arm within its pair; position 2 starts at least 30 s after position 1 ends. */
  position: 1 | 2;
  arm: Arm;
  slot: string;
}
export const SUITE_SLOT_PATTERN = /^pair-(0[1-9]|[1-9][0-9])-(baseline|candidate)$/;
export function suiteSlotFor(pair: number, arm: Arm): string {
  if (!Number.isSafeInteger(pair) || pair < 1 || pair > SUITE_MAX_PAIRS) throw new Error(`Invalid pair number ${pair}`);
  return `pair-${String(pair).padStart(2, "0")}-${arm}`;
}
/** Odd pairs run baseline then candidate; even pairs run candidate then baseline. */
export function pairOrder(pair: number): readonly [Arm, Arm] {
  return pair % 2 === 1 ? ["baseline", "candidate"] : ["candidate", "baseline"];
}
export function assertScheduleBounds(pairs: number, parallelPairs: number): void {
  if (!Number.isSafeInteger(pairs) || pairs < 1 || pairs > SUITE_MAX_PAIRS) throw new Error(`pairs must be an integer from 1 to ${SUITE_MAX_PAIRS}`);
  if (!Number.isSafeInteger(parallelPairs) || parallelPairs < 1 || parallelPairs > pairs) throw new Error("parallel-pairs must be an integer from 1 to the pair count");
}
/**
 * Planned launch order: within each wave, every pair's first arm in pair order, then every
 * pair's second arm in pair order. Actual second-arm start times depend on when each first arm
 * ends; the analysis records the observed intervals.
 */
export function suiteSchedule(pairs: number, parallelPairs: number): SuiteSlotSpec[] {
  assertScheduleBounds(pairs, parallelPairs);
  const schedule: SuiteSlotSpec[] = [];
  for (let first = 1, wave = 1; first <= pairs; first += parallelPairs, wave++) {
    const members = Array.from({ length: Math.min(parallelPairs, pairs - first + 1) }, (_value, offset) => first + offset);
    for (const position of [1, 2] as const) for (const pair of members) {
      const arm = pairOrder(pair)[position - 1];
      schedule.push({ index: schedule.length, wave, pair, position, arm, slot: suiteSlotFor(pair, arm) });
    }
  }
  return schedule;
}
export function suiteRunId(root: string, spec: Pick<SuiteSlotSpec, "pair" | "arm">): string {
  return `${resolve(root).split(/[\\/]/).at(-1)}-${suiteSlotFor(spec.pair, spec.arm)}`;
}
