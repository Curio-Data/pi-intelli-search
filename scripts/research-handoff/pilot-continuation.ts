// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// rh-v6 pilot continuation definition (PILOT-CONTINUATION.md, revision
// rh-v6-pilot-1). It reuses the rh-v5 mechanics through a PilotDefinition and
// changes only what the owner direction changes: a new root, authority,
// envelope and allocations, a twelve-source cap and the frozen source policy.
// Nothing here dispatches work, reads credentials or touches the network.

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ResearchParams } from "../../src/core/contracts.js";
import type { FetchedPage, ResearchSettings } from "../../src/core/types.js";
import type { FrozenInputs } from "./contracts.js";
import { assembleFrozenInputs } from "./common-inputs.js";
import { BASELINE_COMMIT } from "./config.js";
import { RH6_SOURCE_POLICY, deriveSelection } from "./source-selection.js";
import { digestFile, digestObject } from "./storage.js";
import {
  PILOT_PROFILE, PILOT_OPERATION_LIMITS, PILOT_BUDGET, PILOT_SERIES_ROOT, pilotParams, pilotSettings,
  type PilotDefinition,
} from "./pilot-config.js";

const REPO = resolve(PILOT_SERIES_ROOT, "../../../..");
export const RH6_PROTOCOL_REVISION = "rh-v6-pilot-1" as const;
export const RH6_SCOPE = "research-handoff-pilot-completion-rh-v6" as const;
export const RH6_RECORD_TYPE = "owner-directed-pilot-completion-not-live-acceptance" as const;
export const RH6_PROTOCOL_PATH = join(REPO, "docs/experiments/research-handoff/PILOT-CONTINUATION.md");
export const RH6_OWNER_DIRECTION_PATH = join(REPO, "evidence/agents/20261106T143614Z-pilot-completion/owner-direction.json");
/** Immutable owner-direction digest recorded at implementation entry. */
export const RH6_OWNER_DIRECTION_SHA256 = "eae365c85b39b6b6acf23e2627d3afbf4c8739311219708ed352160f94c38159";
export const RH6_SERIES_ROOT = join(REPO, "evidence/benchmarks/research-handoff/20261106T143614Z-rh-v6-pilot");
/** The closed rh-v5 settlement this direction builds on; read only, never reopened. */
export const RH6_PRIOR_SETTLEMENT_PATH = join(PILOT_SERIES_ROOT, "settlement-receipt.json");

export const RH6_PROFILE = { ...PILOT_PROFILE, maxUrls: 12 } as const;
export const RH6_OPERATION_LIMITS = { ...PILOT_OPERATION_LIMITS } as const;
export const RH6_COMBINED_CEILING_NANO_USD = 10_000_000_000;
export const RH6_PRIOR_REPORTED_NANO_USD = 5_700_000;
export const RH6_BUDGET = {
  totalNanoUsd: 9_994_300_000,
  captureNanoUsd: 810_000_000,
  qualificationNanoUsd: 1_010_000_000,
  baselinePilotNanoUsd: 4_087_150_000,
  candidatePilotNanoUsd: 4_087_150_000,
  sonarAttemptNanoUsd: PILOT_BUDGET.sonarAttemptNanoUsd,
  m3AttemptNanoUsd: PILOT_BUDGET.m3AttemptNanoUsd,
} as const;

/** rh-v5 settings with the twelve-source cap; every other value is unchanged. */
export function rh6Settings(): ResearchSettings { return { ...pilotSettings(), maxUrls: RH6_PROFILE.maxUrls }; }
/** Unchanged query, focus and domains; the matched cap rises to twelve. */
export function rh6Params(): ResearchParams { return { ...pilotParams(), maxUrls: RH6_PROFILE.maxUrls }; }

export const RH6_PILOT: PilotDefinition = Object.freeze({
  revision: RH6_PROTOCOL_REVISION, scope: RH6_SCOPE, protocolPath: RH6_PROTOCOL_PATH,
  ownerDecisionPath: RH6_OWNER_DIRECTION_PATH, ownerDecisionSha256: RH6_OWNER_DIRECTION_SHA256, seriesRoot: RH6_SERIES_ROOT,
  profile: RH6_PROFILE, operationLimits: RH6_OPERATION_LIMITS, budget: RH6_BUDGET, sourcePolicy: RH6_SOURCE_POLICY,
  settings: rh6Settings, params: rh6Params,
});
// The revision registry (pilotDefinitionFor) lives in pilot-repeat.ts, which also knows rh-v7.

const same = (a: unknown, b: unknown) => digestObject(a) === digestObject(b);
function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a JSON object`);
  return value as Record<string, unknown>;
}

/**
 * Verifies the rh-v6 owner direction (already digest-checked by the caller):
 * scope, profile, operation counts, envelope, allocations, designated root and
 * the closed rh-v5 settlement it accounts for. The prior settlement is read,
 * never written.
 */
export async function verifyContinuationDirection(d: Record<string, unknown>, designatedRoot: string, priorSettlementPath = RH6_PRIOR_SETTLEMENT_PATH): Promise<void> {
  const allocation = object(d.coordinatorAllocationNanoUsd, "coordinatorAllocationNanoUsd");
  const keys = ["commonCapture", "chargeQualification", "baselinePilot", "candidatePilot"];
  const total = keys.reduce((sum, key) => sum + Number(allocation[key]), 0);
  const prior = Number(d.priorReportedNanoUsd) + Number(d.priorUnknownNanoUsd) + Number(d.priorActiveNanoUsd);
  if (d.schemaVersion !== 1 || d.approved !== true || d.approvedBy !== "owner" || d.scope !== RH6_SCOPE || d.recordType !== RH6_RECORD_TYPE
    || !same(d.profile, RH6_PROFILE) || !same(d.operationLimits, RH6_OPERATION_LIMITS) || !same(d.order, ["baseline", "candidate"])
    || Object.keys(allocation).length !== keys.length
    || allocation.commonCapture !== RH6_BUDGET.captureNanoUsd || allocation.chargeQualification !== RH6_BUDGET.qualificationNanoUsd
    || allocation.baselinePilot !== RH6_BUDGET.baselinePilotNanoUsd || allocation.candidatePilot !== RH6_BUDGET.candidatePilotNanoUsd
    || d.maximumExperimentEnvelopeNanoUsd !== RH6_BUDGET.totalNanoUsd || total !== RH6_BUDGET.totalNanoUsd
    || d.combinedCeilingNanoUsd !== RH6_COMBINED_CEILING_NANO_USD || d.priorReportedNanoUsd !== RH6_PRIOR_REPORTED_NANO_USD
    || d.priorUnknownNanoUsd !== 0 || d.priorActiveNanoUsd !== 0 || prior + total > RH6_COMBINED_CEILING_NANO_USD
    || resolve(REPO, String(d.priorSettlementPath)) !== RH6_PRIOR_SETTLEMENT_PATH
    || resolve(String(d.designatedSeriesRoot)) !== resolve(designatedRoot) || resolve(String(d.designatedSeriesRoot)) === resolve(PILOT_SERIES_ROOT)) {
    throw new Error("Owner direction does not cover the bounded rh-v6 scope, profile, counts, envelope, allocation or root");
  }
  let settlement: Record<string, unknown>;
  try { settlement = object(JSON.parse(await readFile(priorSettlementPath, "utf8")), "prior settlement"); }
  catch (error) { throw new Error(`Prior rh-v5 settlement is unreadable: ${String(error)}`); }
  if (settlement.kind !== "pilot-settlement" || settlement.closed !== true || settlement.reportedNanoUsd !== d.priorReportedNanoUsd
    || settlement.unknownNanoUsd !== d.priorUnknownNanoUsd || settlement.activeNanoUsd !== d.priorActiveNanoUsd) {
    throw new Error("Prior rh-v5 settlement does not match the owner direction's recorded close-out");
  }
  const s = rh6Settings();
  if (s.extractionMaxTokens !== RH6_PROFILE.extractionMaxTokens || s.collationMaxTokens !== RH6_PROFILE.collationMaxTokens
    || s.llmTimeoutMs !== RH6_PROFILE.llmTimeoutMs || s.extractionConcurrency !== RH6_PROFILE.extractionConcurrency
    || s.maxUrls !== RH6_PROFILE.maxUrls || s.llmRetryAttempts !== RH6_PROFILE.downstreamAttemptsPerCall
    || RH6_SOURCE_POLICY.selectedLimit !== RH6_PROFILE.maxUrls) {
    throw new Error("rh-v6 settings or source policy differ from the owner profile");
  }
}
export async function rh6OwnerDirectionSha256(path = RH6_OWNER_DIRECTION_PATH): Promise<string> { return digestFile(path); }

// ---------------------------------------------------------------------------
// Credential-free synthetic corpus built through the real derivation
// ---------------------------------------------------------------------------

/** Invented pages on the task's allowed hosts. No request is ever made to them. */
const SITE = "https://developers.cloudflare.com/synthetic-handoff";
const PI = "https://pi.dev/docs/synthetic-handoff";
function synthetic(url: string, n: number, title: string, body: string): FetchedPage {
  return { url, title, status: "success", source: "markdown",
    content: `# ${title}\n\nRAW_HANDOFF_SENTINEL_${n}\nInvented page for an offline derivation check; not a factual source.\n\n${body}` };
}
const seedB = synthetic(`${PI}/`, 2, "Synthetic Runtime", "See [Agent integration](agent-tools/), [Configuration reference](broken/) and [Configuration mirror](mirror/).");
export const SYNTHETIC_CONTINUATION_SITE: Readonly<Record<string, FetchedPage>> = {
  [`${SITE}/`]: synthetic(`${SITE}/`, 1, "Synthetic Service",
    "Read [Setup guide](setup/), [Platform limits](platform/limits/), [Pricing](https://www.cloudflare.com/plans/), [Blog](/blog/unrelated-news/), "
    + "[Markdown alternate](index.md) and ![diagram](diagram.png)."),
  [`${SITE}/setup/`]: synthetic(`${SITE}/setup/`, 3, "Synthetic Setup",
    "Next: [Failure modes and errors](../errors/), [Configuration](../configuration/), [Code examples](../code/) and [Limits reference](../limits-reference/)."),
  [`${SITE}/platform/limits/`]: synthetic(`${SITE}/platform/limits/`, 4, "Synthetic Limits",
    "Back to [overview](../../). See [Version and maturity](../../maturity/)."),
  [`${SITE}/errors/`]: synthetic(`${SITE}/errors/`, 5, "Synthetic Errors", "No further links."),
  [`${SITE}/configuration/`]: synthetic(`${SITE}/configuration/`, 7, "Synthetic Configuration", "No further links."),
  [`${SITE}/code/`]: synthetic(`${SITE}/code/`, 8, "Synthetic Code", "No further links."),
  [`${SITE}/maturity/`]: synthetic(`${SITE}/maturity/`, 9, "Synthetic Maturity", "No further links."),
  /** Relevant and fetchable, but ranked after the twelfth selection: the cap leaves it unfetched. */
  [`${SITE}/limits-reference/`]: synthetic(`${SITE}/limits-reference/`, 13, "Synthetic Limits Reference", "No further links."),
  [`${PI}/`]: seedB,
  [`${PI}/agent-tools/`]: synthetic(`${PI}/agent-tools/`, 6, "Synthetic Agent Tools",
    "See the [runtime](../), [Integration points](integration/), [Supported services](../services/) and [Prerequisites](../prerequisites/)."),
  [`${PI}/agent-tools/integration/`]: synthetic(`${PI}/agent-tools/integration/`, 10, "Synthetic Integration", "No further links."),
  [`${PI}/services/`]: synthetic(`${PI}/services/`, 11, "Synthetic Services", "No further links."),
  [`${PI}/prerequisites/`]: synthetic(`${PI}/prerequisites/`, 12, "Synthetic Prerequisites", "No further links."),
  [`${PI}/mirror/`]: { ...seedB, url: `${PI}/mirror/` },
};
/** Raw discovery text: an out-of-domain page, an HTML/index.md alias pair and a non-document link. */
export const SYNTHETIC_CONTINUATION_DISCOVERY = [
  "Synthetic discovery for the rh-v6 derivation check:",
  "[Marketing](https://www.cloudflare.com/products/synthetic-handoff/),",
  `[Service](${SITE}/), [Service markdown](${SITE}/index.md),`,
  `[Runtime](${PI}/) and [Logo](${SITE}/logo.png).`,
].join(" ");
export function syntheticSiteFetch(url: string): FetchedPage {
  const page = SYNTHETIC_CONTINUATION_SITE[url];
  return page ? structuredClone(page) : { url, title: "", content: "", status: "error", error: "synthetic 404" };
}

/** Synthetic rh-v6 corpus: raw discovery, the real derivation and assembly, offline. */
export async function syntheticContinuationInputs(protocolRef: string, definition: PilotDefinition = RH6_PILOT): Promise<FrozenInputs> {
  if (!definition.sourcePolicy) throw new Error("Synthetic continuation inputs need a source policy");
  const params = definition.params(), settings = definition.settings();
  const searchCompletion = { text: SYNTHETIC_CONTINUATION_DISCOVERY, citations: [] };
  const { extractSourceUrls } = await import("../../src/core/util.js");
  const { mergeCitations } = await import("../../src/core/annotations.js");
  const discovery = mergeCitations(extractSourceUrls(searchCompletion.text), { citations: [] })
    .slice(0, Math.min(params.maxUrls ?? settings.defaultUrls, settings.maxUrls)).map(source => source.url);
  const { derivation, pages } = deriveSelection(definition.sourcePolicy, params, discovery, step => syntheticSiteFetch(step.url));
  return assembleFrozenInputs({ params, settings, searchCompletion, searchAttempts: 1, pages, sourceDerivation: derivation,
    meta: { capturedAt: "2026-11-06T00:00:00.000Z", coreCommit: BASELINE_COMMIT, protocolRef } });
}
