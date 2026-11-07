// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
// Output-budget retry arithmetic: which caps the attempts use, and how long
// each attempt may take. Pure functions, so the schedule is testable without
// a model call.

import { MAX_OUTPUT_TOKENS } from "./defaults.js";

/**
 * How many times a single attempt's timeout may grow over `llmTimeoutMs`.
 * At the observed ≈95-104 tokens/s a 32,000-token attempt needs ≈320 s, so the
 * scaling has to reach well past the base timeout; the cap bounds a hung
 * provider connection at four times the configured timeout instead of letting
 * a failing page run for the whole budget schedule.
 */
export const MAX_TIMEOUT_MULTIPLE = 4;

/**
 * Output caps to try, in order: the configured cap, then each retry's doubled
 * cap, never above `ceiling` and never repeating a cap. A configured cap at or
 * above the ceiling yields a single attempt, because a larger retry is
 * impossible. `retries` is the number of extra attempts, not the number of
 * attempts: 0 disables the retry.
 */
export function budgetCaps(
  configuredCap: number,
  retries: number,
  ceiling: number = MAX_OUTPUT_TOKENS,
): number[] {
  const caps = [Math.min(configuredCap, ceiling)];
  for (let i = 0; i < retries; i++) {
    const next = Math.min(caps[caps.length - 1] * 2, ceiling);
    if (next <= caps[caps.length - 1]) break;
    caps.push(next);
  }
  return caps;
}

/**
 * Timeout for one attempt, scaled to its output cap so an attempt allowed a
 * larger budget also has time to spend it: `llmTimeoutMs × attemptCap /
 * configuredCap`, capped at `MAX_TIMEOUT_MULTIPLE × llmTimeoutMs`. The first
 * attempt always gets the configured timeout unchanged.
 */
export function attemptTimeoutMs(
  llmTimeoutMs: number,
  configuredCap: number,
  attemptCap: number,
): number {
  if (configuredCap <= 0 || attemptCap <= configuredCap) return llmTimeoutMs;
  const scaled = (llmTimeoutMs * attemptCap) / configuredCap;
  return Math.round(Math.min(scaled, llmTimeoutMs * MAX_TIMEOUT_MULTIPLE));
}
