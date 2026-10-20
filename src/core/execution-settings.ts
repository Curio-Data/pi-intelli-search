// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type { ResearchExecutionSettings } from "./execution-contracts.js";

/** Fresh values per runtime; enabled deadline numbers are never implicit. */
export function executionDefaults(): ResearchExecutionSettings {
  return {
    pageExecution: "streaming",
    modelConcurrency: 5,
    criticalReserve: 1,
    aggregateFetchConcurrency: 4,
    lateDrainMs: 0,
    deadline: { enabled: false },
    fetchMaxResponseBytes: 8_388_608,
    docsMaxResponseBytes: 16_777_216,
    fetchMaxChars: 500_000,
  };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error(`${label} contains an unknown key`);
}
function integer(value: unknown, min: number, max: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max)
    throw new Error(`${label} must be an integer between ${min} and ${max}`);
  return value as number;
}
function positive(value: unknown, max: number, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > max)
    throw new Error(`${label} must be finite, greater than zero and at most ${max}`);
  return value;
}
function deadline(value: unknown, label: string): ResearchExecutionSettings["deadline"] {
  const block = object(value, label);
  if (block.enabled === false) {
    keys(block, ["enabled"], label);
    return Object.freeze({ enabled: false });
  }
  if (block.enabled !== true) throw new Error(`${label}.enabled must be boolean`);
  keys(block, ["enabled", "quorum", "factor", "floorMs", "ceilingMs", "minSources"], label);
  const result = {
    enabled: true as const,
    quorum: positive(block.quorum, 1, `${label}.quorum`),
    factor: positive(block.factor, 10, `${label}.factor`),
    floorMs: integer(block.floorMs, 0, 600_000, `${label}.floorMs`),
    ceilingMs: integer(block.ceilingMs, 1, 600_000, `${label}.ceilingMs`),
    minSources: integer(block.minSources, 1, 100, `${label}.minSources`),
  };
  if (result.floorMs > result.ceilingMs)
    throw new Error(`${label}.floorMs must not exceed ceilingMs`);
  return Object.freeze(result);
}

/** Validate before runtime construction. Omitted fields use C03, not caller values. */
export function parseExecutionSettings(
  value: unknown,
  label = "execution",
): ResearchExecutionSettings {
  const defaults = executionDefaults();
  const block = value === undefined ? {} : object(value, label);
  keys(block, Object.keys(defaults), label);
  const selected = { ...defaults, ...block };
  if (selected.pageExecution !== "streaming" && selected.pageExecution !== "barrier")
    throw new Error(`${label}.pageExecution must be streaming or barrier`);
  const policy = deadline(selected.deadline, `${label}.deadline`);
  if (selected.pageExecution === "barrier" && policy.enabled)
    throw new Error(`${label}.deadline cannot be enabled with barrier page execution`);
  return Object.freeze({
    pageExecution: selected.pageExecution,
    modelConcurrency: integer(selected.modelConcurrency, 2, 64, `${label}.modelConcurrency`),
    criticalReserve: integer(selected.criticalReserve, 1, 1, `${label}.criticalReserve`) as 1,
    aggregateFetchConcurrency: integer(
      selected.aggregateFetchConcurrency,
      1,
      32,
      `${label}.aggregateFetchConcurrency`,
    ),
    lateDrainMs: integer(selected.lateDrainMs, 0, 30_000, `${label}.lateDrainMs`),
    deadline: policy,
    fetchMaxResponseBytes: integer(
      selected.fetchMaxResponseBytes,
      65_536,
      16_777_216,
      `${label}.fetchMaxResponseBytes`,
    ),
    docsMaxResponseBytes: integer(
      selected.docsMaxResponseBytes,
      65_536,
      33_554_432,
      `${label}.docsMaxResponseBytes`,
    ),
    fetchMaxChars: integer(selected.fetchMaxChars, 1, 500_000, `${label}.fetchMaxChars`),
  });
}

/** Shared pacing range; native diagnostics also name the supported flat alias. */
export function validateRequestInterval(value: unknown, label: string): number {
  return integer(value, 0, 120_000, label);
}
