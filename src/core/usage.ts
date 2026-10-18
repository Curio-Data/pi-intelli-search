// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Attempt ledger and canonical usage semantics (C16). Missing usage is never zero usage.
import type {
  AccountingSummary,
  AttemptIdentity,
  AttemptLedger,
  AttemptRecord,
  CostObservation,
  ModelUsage,
  NumericHostUsage,
  TokenObservation,
  UsageObservation,
} from "./contracts.js";

export const TOKEN_FIELDS = [
  "inputTotal",
  "inputUncached",
  "outputTotal",
  "cacheRead",
  "cacheWrite",
  "cacheWrite1h",
  "reasoning",
  "totalTokens",
] as const satisfies readonly (keyof TokenObservation)[];

const COST_FIELDS = ["total", "input", "output", "cacheRead", "cacheWrite"] as const satisfies readonly (keyof CostObservation)[];

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

interface Entry {
  readonly identity: AttemptIdentity;
  readonly startedAtMs: number;
  readonly queueMs: number;
  observation?: UsageObservation;
  state?: AttemptRecord["state"];
  settledAtMs?: number;
}

const STATES = new Set<AttemptRecord["state"]>(["succeeded", "failed", "aborted", "timed-out"]);

function keyOf(identity: AttemptIdentity): string {
  return JSON.stringify([identity.operationId, identity.callId, identity.attempt]);
}

function sameIdentity(a: AttemptIdentity, b: AttemptIdentity): boolean {
  return a.operationId === b.operationId && a.callId === b.callId && a.attempt === b.attempt &&
    a.model.provider === b.model.provider && a.model.model === b.model.model &&
    a.role === b.role && a.pageId === b.pageId;
}

function count(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new TypeError(`${label} must be a finite non-negative number`);
  return value;
}

function cleanTokens(tokens: TokenObservation): TokenObservation {
  const out: Mutable<TokenObservation> = {};
  for (const field of TOKEN_FIELDS) {
    const value = count(tokens[field], `tokens.${field}`);
    if (value !== undefined) out[field] = value;
  }
  return out;
}

function cleanCost(cost: CostObservation): CostObservation {
  const out: Mutable<CostObservation> = {};
  for (const field of COST_FIELDS) {
    const value = count(cost[field], `cost.${field}`);
    if (value !== undefined) out[field] = value;
  }
  return out;
}

/**
 * Applies a later cumulative snapshot for the same attempt. Fields it reports
 * replace earlier values; fields it omits keep their last reported value.
 */
function applySnapshot(previous: UsageObservation | undefined, next: UsageObservation): UsageObservation {
  const tokens = { ...previous?.tokens, ...cleanTokens(next.tokens) };
  const cost = next.cost !== undefined ? { ...(previous?.costBasis === next.costBasis ? previous.cost : {}), ...cleanCost(next.cost) } : previous?.cost;
  const costBasis = next.cost !== undefined ? next.costBasis : previous?.costBasis ?? next.costBasis;
  const providerRequestId = next.providerRequestId ?? previous?.providerRequestId;
  return {
    tokens,
    ...(cost !== undefined ? { cost } : {}),
    source: next.source,
    costBasis,
    ...(providerRequestId !== undefined ? { providerRequestId } : {}),
  };
}

function record(entry: Entry): AttemptRecord {
  return {
    ...entry.identity,
    model: { ...entry.identity.model },
    state: entry.state!,
    startedAtMs: entry.startedAtMs,
    settledAtMs: entry.settledAtMs!,
    queueMs: entry.queueMs,
    ...(entry.observation ? { observation: entry.observation } : {}),
  };
}

/**
 * Sums cost of one basis. Cost observed with an `unknown` basis stays on its
 * record but enters neither reported nor catalogue sums: its provenance is not
 * established, so it is neither relabelled nor counted (C16).
 */
function sumCosts(entries: readonly Entry[], basis: UsageObservation["costBasis"]): CostObservation {
  const out: Mutable<CostObservation> = {};
  for (const entry of entries) {
    const observation = entry.observation;
    if (observation?.costBasis !== basis || !observation.cost) continue;
    for (const field of COST_FIELDS) {
      const value = observation.cost[field];
      if (value !== undefined) out[field] = (out[field] ?? 0) + value;
    }
  }
  return out;
}

/** Per-operation ledger: one record per dispatched attempt, owned by the operation's services. */
export function createAttemptLedger(): AttemptLedger {
  const entries = new Map<string, Entry>();

  function entryFor(identity: AttemptIdentity, action: string): Entry {
    const entry = entries.get(keyOf(identity));
    if (!entry) throw new Error(`Cannot ${action} an attempt that was not started`);
    if (!sameIdentity(entry.identity, identity)) throw new Error(`Cannot ${action} with a conflicting attempt identity`);
    return entry;
  }

  function all(): Entry[] {
    return [...entries.values()];
  }

  function summary(parentDelivery: AccountingSummary["parentDelivery"] = "unknown"): AccountingSummary {
    const list = all();
    const tokens: Mutable<TokenObservation> = {};
    const missing: (keyof TokenObservation)[] = [];
    for (const field of TOKEN_FIELDS) {
      let known = 0;
      let total = 0;
      for (const entry of list) {
        const value = entry.observation?.tokens[field];
        if (value === undefined) continue;
        known++;
        total += value;
      }
      if (known > 0 || list.length === 0) tokens[field] = total;
      if (known < list.length) missing.push(field);
    }
    const observedAttempts = list.filter((entry) => entry.observation !== undefined).length;
    return {
      attempts: list.length,
      observedAttempts,
      missingAttempts: list.length - observedAttempts,
      tokens,
      reportedCost: sumCosts(list, "reported"),
      estimatedCost: sumCosts(list, "catalogue"),
      missingTokenFields: missing,
      costComplete: list.every((entry) =>
        entry.observation?.costBasis === "reported" && entry.observation.cost?.total !== undefined),
      parentDelivery,
    };
  }

  return {
    start(identity, startedAtMs, queueMs) {
      const key = keyOf(identity);
      if (entries.has(key)) throw new Error("Attempt was already started");
      if (!Number.isInteger(identity.attempt) || identity.attempt < 1) throw new RangeError("attempt must be a positive integer");
      count(queueMs, "queueMs");
      if (!Number.isFinite(startedAtMs)) throw new TypeError("startedAtMs must be finite");
      entries.set(key, {
        identity: {
          ...identity,
          model: { provider: identity.model.provider, model: identity.model.model },
        },
        startedAtMs,
        queueMs,
      });
    },
    observe(identity, observation) {
      const entry = entryFor(identity, "observe");
      if (entry.state !== undefined) throw new Error("Cannot observe a finished attempt");
      entry.observation = applySnapshot(entry.observation, observation);
    },
    finish(identity, state, settledAtMs) {
      const entry = entryFor(identity, "finish");
      if (!STATES.has(state)) throw new TypeError(`Unknown attempt state ${String(state)}`);
      if (entry.state !== undefined) {
        if (entry.state !== state) throw new Error(`Attempt already finished as ${entry.state}, not ${state}`);
        return;
      }
      if (!Number.isFinite(settledAtMs)) throw new TypeError("settledAtMs must be finite");
      entry.state = state;
      entry.settledAtMs = settledAtMs;
    },
    records() {
      return all().filter((entry) => entry.state !== undefined).map(record);
    },
    summary,
    hostUsage() {
      return hostUsageOf(all());
    },
  };
}

function hostUsageOf(list: readonly Entry[]): NumericHostUsage {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let totalTokens = 0;
  for (const entry of list) {
    const tokens = entry.observation?.tokens ?? {};
    input += tokens.inputUncached ?? 0;
    output += tokens.outputTotal ?? 0;
    cacheRead += tokens.cacheRead ?? 0;
    cacheWrite += tokens.cacheWrite ?? 0;
    // A reported total is kept as reported. Otherwise a known prompt total already
    // includes its cache components, so it replaces them rather than adding to them.
    totalTokens += tokens.totalTokens ?? (tokens.inputTotal !== undefined
      ? tokens.inputTotal + (tokens.outputTotal ?? 0)
      : (tokens.inputUncached ?? 0) + (tokens.cacheRead ?? 0) + (tokens.cacheWrite ?? 0) + (tokens.outputTotal ?? 0));
  }
  // Reported and catalogue costs are never added together.
  const basis = hostCostBasisOf(list);
  const cost = basis === "none" ? {} : sumCosts(list, basis);
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens,
    cost: {
      input: cost.input ?? 0,
      output: cost.output ?? 0,
      cacheRead: cost.cacheRead ?? 0,
      cacheWrite: cost.cacheWrite ?? 0,
      total: cost.total ?? 0,
    },
  };
}

function hostCostBasisOf(list: readonly Entry[]): "reported" | "catalogue" | "none" {
  const has = (basis: UsageObservation["costBasis"]) =>
    list.some((entry) => entry.observation?.costBasis === basis && entry.observation.cost?.total !== undefined);
  return has("reported") ? "reported" : has("catalogue") ? "catalogue" : "none";
}

/**
 * Basis of `hostUsage().cost.total`: a reported subtotal when any attempt
 * reported a total cost, otherwise a catalogue estimate, otherwise none.
 */
export function hostCostBasis(summary: AccountingSummary): "reported" | "catalogue" | "none" {
  if (summary.reportedCost.total !== undefined) return "reported";
  if (summary.estimatedCost.total !== undefined) return "catalogue";
  return "none";
}

function defined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

/**
 * Native `pi-ai` usage: `input` already excludes cache reads and writes, and the
 * cost breakdown is computed from the model catalogue.
 */
export function normalizeNativeUsage(usage: ModelUsage, providerRequestId?: string): UsageObservation {
  const { input, cacheRead, cacheWrite } = usage;
  const inputTotal = input !== undefined && cacheRead !== undefined && cacheWrite !== undefined
    ? input + cacheRead + cacheWrite
    : undefined;
  const tokens = defined<Mutable<TokenObservation>>({
    inputTotal,
    inputUncached: input,
    outputTotal: usage.output,
    cacheRead,
    cacheWrite,
    cacheWrite1h: usage.cacheWrite1h,
    reasoning: usage.reasoning,
    totalTokens: usage.totalTokens,
  });
  // A native total without the SDK breakdown has no established provenance; leave it unknown.
  const cost = usage.cost ? { ...usage.cost } : undefined;
  return {
    tokens: cleanTokens(tokens),
    ...(cost ? { cost: cleanCost(cost) } : {}),
    source: "sdk-normalized",
    costBasis: cost ? "catalogue" : "unknown",
    ...(providerRequestId !== undefined ? { providerRequestId } : {}),
  };
}

/**
 * Standalone OpenRouter usage: `input` is the prompt total including cached
 * tokens, and `totalCost` is the provider-reported charge. Uncached input is
 * established only when every cache subset (read and write) is reported; an
 * absent cache-write count is unknown, not zero.
 */
export function normalizeMcpUsage(usage: ModelUsage, providerRequestId?: string): UsageObservation {
  const { input, cacheRead, cacheWrite } = usage;
  const remainder = input !== undefined && cacheRead !== undefined && cacheWrite !== undefined
    ? input - cacheRead - cacheWrite
    : undefined;
  // A negative remainder means the cache counters are not subsets of the prompt
  // (for example a replayed response-cache hit); uncached input stays unknown.
  const inputUncached = remainder !== undefined && remainder >= 0 ? remainder : undefined;
  const tokens = defined<Mutable<TokenObservation>>({
    inputTotal: input,
    inputUncached,
    outputTotal: usage.output,
    cacheRead,
    cacheWrite,
    cacheWrite1h: usage.cacheWrite1h,
    reasoning: usage.reasoning,
    totalTokens: usage.totalTokens,
  });
  const cost = usage.totalCost !== undefined ? { total: usage.totalCost } : undefined;
  return {
    tokens: cleanTokens(tokens),
    ...(cost ? { cost: cleanCost(cost) } : {}),
    source: "provider-response",
    costBasis: cost ? "reported" : "unknown",
    ...(providerRequestId !== undefined ? { providerRequestId } : {}),
  };
}
