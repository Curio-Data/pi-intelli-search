// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type { ProtocolQueueSettings } from "../../../src/core/contracts.js";

export const defaultAdmission: ProtocolQueueSettings = Object.freeze({
  maxConcurrent: 2,
  maxQueued: 8,
});
export const maximumPendingConfiguration = 16 + 256;

/** Adapter-only settings, deliberately separate from shared execution tuning. */
export function parseAdmission(value: unknown): ProtocolQueueSettings {
  if (value === undefined) return defaultAdmission;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("admission must be an object");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["maxConcurrent", "maxQueued"].includes(key)))
    throw new Error("admission contains an unknown key");
  const maxConcurrent =
    input.maxConcurrent === undefined ? defaultAdmission.maxConcurrent : input.maxConcurrent;
  const maxQueued = input.maxQueued === undefined ? defaultAdmission.maxQueued : input.maxQueued;
  for (const [key, n, min, max] of [
    ["maxConcurrent", maxConcurrent, 1, 16],
    ["maxQueued", maxQueued, 0, 256],
  ] as const) {
    if (!Number.isSafeInteger(n) || (n as number) < min || (n as number) > max)
      throw new Error(`admission.${key} must be an integer between ${min} and ${max}`);
  }
  return Object.freeze({ maxConcurrent: maxConcurrent as number, maxQueued: maxQueued as number });
}
