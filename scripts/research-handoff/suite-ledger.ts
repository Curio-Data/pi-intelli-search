// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// rh-v8 shared ledger (SUITE-PROTOCOL.md, Financial Controls). One append-only,
// hash-chained file per series in the existing programme-ledger format: genesis
// carries the shared ceiling and the prior settled total; every admitted stage
// reserves its full ceiling before its claim; a settlement releases only a
// known final charge. The parser refuses any reservation that would make
// known + unknown + active + new exceed the ceiling. Appends hold an exclusive
// lock directory and re-read the chain inside it; a stale lock is never cleared
// automatically. An in-process queue serialises concurrent appends.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { open } from "node:fs/promises";
import { appendProgrammeReservation, appendProgrammeSettlement, parseProgrammeLedger, type LedgerBalance } from "./budget.js";
import type { PilotDefinition } from "./pilot-config.js";

export const LEDGER_FILE = "ledger.jsonl";
export const LEDGER_LOCK = "ledger.lock";
const ledgerPath = (root: string) => join(root, LEDGER_FILE);
const lockPath = (root: string) => join(root, LEDGER_LOCK);

let queue: Promise<unknown> = Promise.resolve();
/** Serialises this process's ledger work; the lock directory excludes other processes. */
function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

/** Writes the genesis record once; refuses an existing ledger. */
export async function createSuiteLedger(root: string, definition: PilotDefinition): Promise<LedgerBalance> {
  const cumulative = definition.cumulative;
  if (!cumulative || !definition.suite) throw new Error("Only a plan-bound suite has a shared ledger");
  const line = JSON.stringify({ schemaVersion: 1, kind: "genesis", seq: 0, prevSha256: null, utc: new Date().toISOString(),
    ceilingNanoUsd: cumulative.combinedCeilingNanoUsd, baselineKnownNanoUsd: cumulative.priorReportedNanoUsd, baselineUnknownHoldNanoUsd: 0,
    planSha256: definition.suite.planSha256, note: "Shared cumulative ceiling; the opening known amount is the prior settled total." }) + "\n";
  const handle = await open(ledgerPath(root), "wx", 0o600);
  try { await handle.writeFile(line); await handle.sync(); } finally { await handle.close(); }
  return parseProgrammeLedger(line);
}
export async function readSuiteLedger(root: string): Promise<LedgerBalance> {
  return parseProgrammeLedger(await readFile(ledgerPath(root), "utf8"));
}
/** Ledger rows for one stage identity, in order. */
export async function ledgerRows(root: string): Promise<Array<Record<string, unknown>>> {
  const raw = await readFile(ledgerPath(root), "utf8");
  parseProgrammeLedger(raw);
  return raw.slice(0, -1).split("\n").map(line => JSON.parse(line) as Record<string, unknown>);
}

/** Reserves the stage's full ceiling, refusing when the shared ceiling would be exceeded or the identity was ever used. */
export function reserveSuiteStage(root: string, id: string, reserveNanoUsd: number): Promise<LedgerBalance> {
  return serial(async () => {
    const balance = await readSuiteLedger(root);
    return appendProgrammeReservation({ path: ledgerPath(root), lockPath: lockPath(root), expectedSha256: balance.sha256, runId: id,
      reserveNanoUsd, writerCoordinationConfirmed: true });
  });
}
/** Settles a reservation: the known charge is released from the hold; unknown charge stays held. */
export function settleSuiteStage(root: string, id: string, reportedNanoUsd: number, unknownNanoUsd: number, note: string): Promise<LedgerBalance> {
  return serial(async () => {
    const balance = await readSuiteLedger(root);
    return appendProgrammeSettlement({ path: ledgerPath(root), lockPath: lockPath(root), expectedSha256: balance.sha256, runId: id,
      reportedNanoUsd, unknownNanoUsd, note, writerCoordinationConfirmed: true });
  });
}
/**
 * Converts a stage's final budget receipt into a settlement. A missing or mismatched receipt, or
 * one with active reservations, holds the full reservation as unknown: never a release.
 */
export async function settleFromReceipt(root: string, id: string, budgetPath: string, reservationNanoUsd: number): Promise<{ reportedNanoUsd: number; unknownNanoUsd: number; heldFull: boolean }> {
  let reported = 0, unknown = reservationNanoUsd, heldFull = true;
  try {
    const budget = JSON.parse(await readFile(budgetPath, "utf8")) as Record<string, unknown>;
    if (budget.limitNanoUsd === reservationNanoUsd && [budget.knownNanoUsd, budget.unknownNanoUsd, budget.activeNanoUsd].every(value => Number.isSafeInteger(value) && (value as number) >= 0)) {
      reported = budget.knownNanoUsd as number;
      unknown = (budget.unknownNanoUsd as number) + (budget.activeNanoUsd as number);
      heldFull = false;
    }
  } catch { /* missing receipt: the full reservation stays held */ }
  await settleSuiteStage(root, id, reported, unknown, heldFull ? "No valid final budget receipt: the full reservation is held as unknown" : "Final budget receipt");
  return { reportedNanoUsd: reported, unknownNanoUsd: unknown, heldFull };
}
