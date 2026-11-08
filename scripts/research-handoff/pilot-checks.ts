// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Machine checks recomputed from retained pilot files. Moved unchanged from
// pilot.ts so that the rh-v8 schedule admission can read retained outcomes
// without importing the operation module; pilot.ts re-exports it.

import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { FrozenInputs, PilotWorkerOptions, RunRecord } from "./contracts.js";
import { analysePilotRun, type PilotMachineResult } from "./pilot-analysis.js";

const readJson = async (path: string) => JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;

/** Recompute machine checks from retained files, including a worker that never wrote its record. */
export async function pilotChecksFor(directory: string, frozen: Pick<FrozenInputs, "pages">, financialMode: PilotWorkerOptions["financialMode"]): Promise<PilotMachineResult & { budgetReceipt: boolean }> {
  let budget: Record<string, number> | undefined;
  try { budget = await readJson(join(directory, "budget.json")) as Record<string, number>; } catch { /* absent after a killed worker */ }
  let result: PilotMachineResult;
  try {
    const record = JSON.parse(await readFile(join(directory, "record.json"), "utf8")) as RunRecord;
    result = analysePilotRun(record, frozen, financialMode, budget);
  } catch (error) {
    // A corrupt or unreadable record is an explicit failed observation, never a rejected command.
    result = { runId: basename(directory), arm: "unknown", phase: "unknown", passed: false, analysisError: String(error),
      checks: [{ id: "analysable", pass: false, detail: [`Record unreadable or unanalysable: ${String(error)}`] }],
      returnCheck: { initialInvocationConforms: false, initialProblems: [], initialOptions: { applicable: false, problems: [] }, returnPreserved: false,
        returnProblems: [], codemodeOutputTruncated: false, additionalWork: [], recoveryPermitted: false, fullTopologyConforms: false, recoveryLimitReached: false },
      observedPipelineOutcome: "unknown", recoveryCalls: 0, financial: { knownNanoUsd: 0, unknownNanoUsd: 0, activeNanoUsd: 0, rejected: 0, overruns: 0 } };
  }
  if (!budget) {
    result.passed = false;
    result.checks.push({ id: "final-budget-receipt", pass: false, detail: ["No final budget receipt; the stage ceiling stays held"] });
  }
  return { ...result, budgetReceipt: budget !== undefined };
}
