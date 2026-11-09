// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
// Declarations for scenario-verdict.mjs, the live-attempt binding helper.

export type VerdictStatus = "pass" | "retry" | "oracle-fail" | "product-fail";

export interface Verdict {
  status: VerdictStatus;
  reason: string;
  tool: string;
  workspace: string;
  cacheRoot: string;
  binding: "tool-call" | "workspace-only";
  entry?: string;
  entryRelative?: string;
  reportedCachePath?: string;
  calls?: { toolCallId: string; args: unknown; returned: boolean; isError: boolean }[];
  argumentMismatches?: unknown;
  candidates?: string[];
  malformedLines?: number;
  meta?: Record<string, unknown>;
}

export interface BindOptions {
  traceText?: string;
  workspace: string;
  cacheRoot: string;
  tool: string;
  sinceMs: number;
  expect?: Record<string, unknown>;
  noTrace?: boolean;
}

export const EXIT: Readonly<Record<VerdictStatus | "usage", number>>;
export function parseEvents(text: string): { events: Record<string, unknown>[]; malformed: number };
export function argumentMismatches(
  args: unknown,
  expect: Record<string, unknown> | undefined,
): { argument: string; expected: unknown; actual: unknown }[];
export function resultCachePath(result: unknown): string;
export function bindAttempt(options: BindOptions): Verdict;
export function sourceInventory(
  entry: string,
): { file: string; bytes: number; sha256: string; url: string | null }[];
