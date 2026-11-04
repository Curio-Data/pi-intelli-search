// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { createHash } from "node:crypto";
import { open, readFile, mkdir, rmdir } from "node:fs/promises";
import type { Journal } from "./contracts.js";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
function amount(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid nano-USD amount: ${name}`);
  }
  return value;
}
export interface LedgerBalance {
  sha256: string;
  lastRecordSha256: string;
  nextSeq: number;
  ceilingNanoUsd: number;
  knownNanoUsd: number;
  unknownNanoUsd: number;
  active: Record<string, number>;
  availableNanoUsd: number;
}
/** Read only the financial wire format; no dependency on historical execution code. */
export function parseProgrammeLedger(raw: string): LedgerBalance {
  if (!raw.endsWith("\n") || raw.includes("\n\n")) throw new Error("Incomplete financial ledger");
  const lines = raw.slice(0, -1).split("\n");
  let known = 0, unknown = 0, ceiling = 0;
  const active = new Map<string, number>(), seen = new Set<string>();
  for (const [index, line] of lines.entries()) {
    const row = JSON.parse(line) as Record<string, unknown>;
    if (row.schemaVersion !== 1 || row.seq !== index || row.prevSha256 !== (index ? sha(lines[index - 1]) : null)) {
      throw new Error(`Financial chain mismatch at record ${index}`);
    }
    if (index === 0) {
      if (row.kind !== "genesis") throw new Error("Missing financial genesis");
      ceiling = amount(row.ceilingNanoUsd, "ceiling");
      known = amount(row.baselineKnownNanoUsd, "opening known");
      unknown = amount(row.baselineUnknownHoldNanoUsd, "opening hold");
      continue;
    }
    const id = row.runId;
    if (typeof id !== "string" || !id) throw new Error("Missing financial run identity");
    if (row.kind === "reserve") {
      if (seen.has(id)) throw new Error(`Reused financial identity: ${id}`);
      seen.add(id);
      const reservation = amount(row.reserveNanoUsd, "reservation");
      const exposure = known + unknown + [...active.values()].reduce((a, b) => a + b, 0);
      if (exposure + reservation > ceiling) throw new Error("Financial reservation exceeded ceiling");
      active.set(id, reservation);
    } else if (row.kind === "settle") {
      const reserved = active.get(id);
      if (reserved === undefined) throw new Error(`Settlement without reservation: ${id}`);
      const reported = amount(row.reportedNanoUsd, "reported");
      const held = amount(row.unknownNanoUsd, "unknown");
      const released = amount(row.releasedNanoUsd, "released");
      const overrun = amount(row.overrunNanoUsd, "overrun");
      if (reserved + overrun !== reported + held + released) throw new Error("Financial settlement mismatch");
      known += reported; unknown += held; active.delete(id);
    } else {
      throw new Error(`Unknown financial record: ${String(row.kind)}`);
    }
  }
  const outstanding = [...active.values()].reduce((a, b) => a + b, 0);
  const available = ceiling - known - unknown - outstanding;
  if (![known, unknown, available].every(Number.isSafeInteger)) throw new Error("Financial integer overflow");
  return { sha256: sha(raw), lastRecordSha256: sha(lines.at(-1)!), nextSeq: lines.length,
    ceilingNanoUsd: ceiling, knownNanoUsd: known, unknownNanoUsd: unknown,
    active: Object.fromEntries(active), availableNanoUsd: available };
}
export async function readProgrammeLedger(path: string): Promise<LedgerBalance> {
  return parseProgrammeLedger(await readFile(path, "utf8"));
}

/** A caller must establish that ALL programme writers use this lock before live use.
 * Tests exercise a new local ledger only. A snapshot alone is not exclusive authority.
 */
export async function appendProgrammeReservation(options: {
  path: string; lockPath: string; expectedSha256: string; runId: string; reserveNanoUsd: number;
  writerCoordinationConfirmed: boolean;
}): Promise<LedgerBalance> {
  if (!options.writerCoordinationConfirmed) throw new Error("Programme writer coordination is unresolved");
  await mkdir(options.lockPath);
  try {
    const raw = await readFile(options.path, "utf8"), balance = parseProgrammeLedger(raw);
    if (balance.sha256 !== options.expectedSha256) throw new Error("Financial ledger changed since acceptance");
    const reserve = amount(options.reserveNanoUsd, "reservation");
    if (!reserve || reserve > balance.availableNanoUsd) throw new Error("Insufficient programme allowance");
    const event = { schemaVersion: 1, kind: "reserve", seq: balance.nextSeq,
      prevSha256: balance.lastRecordSha256, utc: new Date().toISOString(), runId: options.runId,
      reserveNanoUsd: reserve, remainingPlannedNanoUsd: 0,
      exposureBeforeNanoUsd: balance.ceilingNanoUsd - balance.availableNanoUsd };
    const line = JSON.stringify(event) + "\n";
    const next = parseProgrammeLedger(raw + line); // validates duplicate identities before writing
    const handle = await open(options.path, "a");
    try { await handle.writeFile(line); await handle.sync(); } finally { await handle.close(); }
    return next;
  } finally { await rmdir(options.lockPath); }
}

export async function appendProgrammeSettlement(options: {
  path: string; lockPath: string; expectedSha256: string; runId: string;
  reportedNanoUsd: number; unknownNanoUsd: number; note: string;
  writerCoordinationConfirmed: boolean;
}): Promise<LedgerBalance> {
  if (!options.writerCoordinationConfirmed) throw new Error("Programme writer coordination is unresolved");
  await mkdir(options.lockPath);
  try {
    const raw = await readFile(options.path, "utf8"), balance = parseProgrammeLedger(raw);
    if (balance.sha256 !== options.expectedSha256) throw new Error("Financial ledger changed since settlement review");
    const reserved = balance.active[options.runId];
    if (reserved === undefined) throw new Error("Programme reservation is not active");
    const reported = amount(options.reportedNanoUsd, "reported");
    const unknown = amount(options.unknownNanoUsd, "unknown");
    const liability = reported + unknown;
    amount(liability, "total liability");
    const event = { schemaVersion: 1, kind: "settle", seq: balance.nextSeq,
      prevSha256: balance.lastRecordSha256, utc: new Date().toISOString(), runId: options.runId,
      reportedNanoUsd: reported, reportedUsdRaw: reported / 1e9, unknownNanoUsd: unknown,
      releasedNanoUsd: Math.max(0, reserved - liability), overrunNanoUsd: Math.max(0, liability - reserved),
      note: options.note };
    const line = JSON.stringify(event) + "\n", next = parseProgrammeLedger(raw + line);
    const handle = await open(options.path, "a");
    try { await handle.writeFile(line); await handle.sync(); } finally { await handle.close(); }
    return next;
  } finally { await rmdir(options.lockPath); }
}

type Reservation = { bound: number; state: "active" | "settled" | "unknown"; charged: number };
/** Synchronous admission closes the concurrent-extraction check/reserve race. */
export class AttemptBudget {
  private readonly reservations = new Map<string, Reservation>();
  private stopped = false;
  constructor(readonly limitNanoUsd: number, private readonly journal: Journal) {
    amount(limitNanoUsd, "attempt budget");
  }
  snapshot() {
    let known = 0, unknown = 0, active = 0;
    for (const item of this.reservations.values()) {
      if (item.state === "active") active += item.bound;
      else if (item.state === "unknown") unknown += item.bound;
      else known += item.charged;
    }
    return { limitNanoUsd: this.limitNanoUsd, knownNanoUsd: known, unknownNanoUsd: unknown,
      activeNanoUsd: active, remainingNanoUsd: this.limitNanoUsd - known - unknown - active, stopped: this.stopped };
  }
  reserve(id: string, boundNanoUsd: number): void {
    const bound = amount(boundNanoUsd, "attempt reservation");
    if (this.stopped || this.reservations.has(id) || !bound || bound > this.snapshot().remainingNanoUsd) {
      this.stopped = true;
      this.journal.record({ kind: "budget-rejected", data: { id, boundNanoUsd, ...this.snapshot() } });
      throw new Error("Research handoff attempt admission refused");
    }
    this.journal.record({ kind: "budget-reserved", data: { id, boundNanoUsd } });
    this.reservations.set(id, { bound, state: "active", charged: 0 });
  }
  settle(id: string, providerReportedUsd?: number): void {
    const entry = this.reservations.get(id);
    if (!entry || entry.state !== "active") throw new Error("Attempt settlement without active reservation");
    if (providerReportedUsd === undefined) {
      this.journal.record({ kind: "budget-unknown", data: { id, heldNanoUsd: entry.bound } });
      entry.state = "unknown";
      return;
    }
    if (!Number.isFinite(providerReportedUsd) || providerReportedUsd < 0) throw new Error("Invalid provider charge");
    const charged = Math.ceil(providerReportedUsd * 1e9);
    amount(charged, "charge");
    this.journal.record({ kind: "budget-settled", data: { id, reportedNanoUsd: charged, boundNanoUsd: entry.bound } });
    entry.charged = charged; entry.state = "settled";
    if (charged > entry.bound) {
      this.stopped = true;
      this.journal.record({ kind: "budget-overrun", data: { id, reportedNanoUsd: charged, boundNanoUsd: entry.bound } });
      throw new Error("Provider charge exceeded its reserved bound");
    }
  }
}
