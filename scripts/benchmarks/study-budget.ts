// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Finite admission for the research-first Codemode study: one append-only
// programme spend ledger shared across series, and per-run limits checked
// before each tool call and model attempt. This is arithmetic and refusal, not
// an authority framework. It makes no provider call and reads no credential.
//
// Ledger rules (docs/benchmarks/codemode-study-v1/SCHEDULE.md, Canonical
// Admission Rule):
//
// - Amounts are integer nanodollars. A value finer than that rounds UP, so
//   rounding can only overstate exposure. Raw reported values are retained.
// - Admission: baseline known + baseline holds + study known + retained
//   unknown holds + active reservations + requested reservation + remaining
//   planned conservative cost must not exceed the ceiling.
// - The USD 0.50 per-attempt hold is an assumption, not a billing upper bound.
//   A charge above the hold is recorded as it is, never refused, and stops
//   further paid batches.
// - There is no call that releases a baseline hold or a retained unknown hold,
//   and no call that clears a stop. Those need an account statement or an owner
//   decision, which this module does not model.
// - Concurrency: an exclusive lock file covers each read-verify-append. A
//   process killed inside that short window leaves the lock behind; later
//   callers refuse and name the file rather than guessing that it is stale.

import { createHash } from "node:crypto";
import { access, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { ModelFixtureRequest } from "./contracts.js";

const NANO_PER_USD = 1_000_000_000;
const ROW_SCHEMA_VERSION = 1;
const BASELINE_KIND = "codemode-branch-openrouter-spend-baseline";
const MAX_NOTE_CHARS = 2000;
const RUN_ID = /^[A-Za-z0-9._:-]{1,200}$/;

/** Hard programme ceiling (OWNER-REFOCUS.md D5). An increase needs a code change and owner approval. */
export const STUDY_CEILING_USD = 30;
/** Conservative hold per actual model attempt. An assumption, not a guaranteed billing upper bound. */
export const ATTEMPT_HOLD_USD = 0.5;
export const STUDY_SPEND_LEDGER_FILE = "spend-ledger.jsonl";
/**
 * The one programme ledger root, relative to the repository. It deliberately
 * sits beside the `evidence/benchmarks/<series-id>/` folders, not inside one:
 * a per-series root would reset the programme total.
 */
export const PROGRAMME_SPEND_ROOT = "evidence/benchmarks/programme-spend";

/** Every tool a study session may call, in any arm (src/experimental/codemode-study.ts). */
export const STUDY_ALLOWED_TOOLS = [
  "read",
  "codemode",
  "intelli_search",
  "intelli_extract",
  "intelli_collate",
  "intelli_research",
  "intelli_fetch",
] as const;
/** Prescribed pipeline models (OWNER-REFOCUS.md). Matched exactly: no prefix, alias or fallback. */
export const STUDY_ALLOWED_MODELS = [
  { provider: "openrouter", model: "perplexity/sonar" },
  { provider: "openrouter", model: "minimax/minimax-m3" },
] as const;

export type StudyBudgetErrorCode =
  | "invalid-argument"
  | "baseline-invalid"
  | "baseline-changed"
  | "ledger-missing"
  | "ledger-corrupt"
  | "ledger-locked"
  | "ceiling-exceeded"
  | "paid-stopped"
  | "duplicate-run"
  | "duplicate-settlement"
  | "unknown-run"
  | "tool-not-allowed"
  | "model-not-allowed"
  | "limit-exhausted"
  | "limit-exceeded"
  | "run-stopped";

/** Every refusal in this module. Thrown before the refused work starts. */
export class StudyBudgetError extends Error {
  readonly code: StudyBudgetErrorCode;
  constructor(code: StudyBudgetErrorCode, message: string) {
    super(message);
    this.name = "StudyBudgetError";
    this.code = code;
  }
}

function refuse(code: StudyBudgetErrorCode, message: string): never {
  throw new StudyBudgetError(code, message);
}

/** Exact non-negative USD number to nanodollars, rounding up beyond nine decimals. */
export function usdToNano(value: number, label = "amount"): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    refuse("invalid-argument", `${label} must be a finite non-negative USD number`);
  // The shortest round-trip decimal is the value callers and providers wrote.
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(value));
  if (!match) return refuse("invalid-argument", `${label} is not a decimal USD number`);
  const fraction = match[2] ?? "";
  const shift = 9 + Number(match[3] ?? 0) - fraction.length;
  const digits = BigInt(match[1] + fraction);
  let nano: bigint;
  if (shift >= 0) nano = digits * 10n ** BigInt(shift);
  else {
    const divisor = 10n ** BigInt(-shift);
    nano = digits / divisor + (digits % divisor === 0n ? 0n : 1n);
  }
  if (nano > BigInt(Number.MAX_SAFE_INTEGER)) refuse("invalid-argument", `${label} is too large`);
  return Number(nano);
}

/** Exact decimal text for reports and refusal messages: `2.045984786`. */
export function formatNanoUsd(nano: number): string {
  return `${Math.floor(nano / NANO_PER_USD)}.${String(nano % NANO_PER_USD).padStart(9, "0")}`;
}

/** The conservative hold a caller reserves before a paid run. */
export function attemptHoldUsd(maxAttempts: number): number {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1)
    refuse("invalid-argument", "maxAttempts must be a positive integer");
  return maxAttempts * ATTEMPT_HOLD_USD;
}

/**
 * Settlement amounts from one entry per STARTED attempt. A cost of zero is a
 * reported zero; `null` or `undefined` is a missing charge and retains the hold.
 */
export function summariseAttemptCharges(costs: readonly (number | null | undefined)[]): {
  readonly reportedUsd: number;
  readonly unknownUsd: number;
  readonly missingCharges: number;
} {
  let reportedNano = 0;
  let missingCharges = 0;
  for (const cost of costs) {
    if (cost === null || cost === undefined) missingCharges += 1;
    else reportedNano += usdToNano(cost, "attempt cost");
  }
  return {
    reportedUsd: reportedNano / NANO_PER_USD,
    unknownUsd: missingCharges * ATTEMPT_HOLD_USD,
    missingCharges,
  };
}

// ---------------------------------------------------------------------------
// Spend ledger
// ---------------------------------------------------------------------------

export interface StudySpendSettlementInput {
  /** Provider-reported charges for the run. Zero means reported as zero. */
  readonly reportedUsd: number;
  /** USD 0.50 for each attempted charge that is missing. Anything above zero stops paid batches. */
  readonly unknownUsd: number;
  readonly note: string;
}

export interface StudySpendSnapshot {
  readonly ceilingNanoUsd: number;
  readonly baselineSha256: string;
  readonly baselineRevision: string;
  /** Historical engineering expense from the baseline. */
  readonly baselineKnownNanoUsd: number;
  readonly baselineUnknownHoldNanoUsd: number;
  /** Study expense settled in this ledger. */
  readonly studyReportedNanoUsd: number;
  readonly studyUnknownHoldNanoUsd: number;
  readonly activeReservationNanoUsd: number;
  /** Sum of all known spend and every hold above. */
  readonly exposureNanoUsd: number;
  /** Ceiling minus exposure; negative once an overrun passes the ceiling. */
  readonly remainingNanoUsd: number;
  /** Runs reserved and not settled, including any a crashed process left behind. */
  readonly activeRuns: readonly string[];
  /** Non-empty means no further paid batch is admitted. */
  readonly stopReasons: readonly string[];
  readonly rowCount: number;
  /** Hash of the last row. A series manifest can record it to witness continuity. */
  readonly headSha256: string;
}

export interface StudyReservation {
  readonly runId: string;
  readonly reserveNanoUsd: number;
  readonly snapshot: StudySpendSnapshot;
}

export interface StudySettlement {
  readonly runId: string;
  readonly reportedNanoUsd: number;
  readonly unknownNanoUsd: number;
  readonly releasedNanoUsd: number;
  /** Reported plus unknown beyond the reservation: the hold assumption failed. */
  readonly overrunNanoUsd: number;
  readonly snapshot: StudySpendSnapshot;
}

export interface StudySpendLedger {
  readonly path: string;
  /** Durable before it resolves. Call and await it before the paid run starts. */
  reserve(runId: string, reserveUsd: number, remainingPlannedUsd: number): Promise<StudyReservation>;
  settle(runId: string, settlement: StudySpendSettlementInput): Promise<StudySettlement>;
  snapshot(): Promise<StudySpendSnapshot>;
}

export interface OpenStudySpendLedgerOptions {
  /** Refuse instead of creating a first ledger. Use it for every open after the first. */
  readonly mustExist?: boolean;
  readonly lockTimeoutMs?: number;
}

interface BaselineFacts {
  readonly sha256: string;
  readonly revision: string;
  readonly knownNano: number;
  readonly holdNano: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(text: string | Uint8Array): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Reads the baseline and re-derives its totals, so a hand-edited total cannot lower the start. */
async function readBaseline(baselinePath: string): Promise<BaselineFacts> {
  const invalid = (detail: string): never =>
    refuse("baseline-invalid", `Spend baseline ${baselinePath}: ${detail}`);
  let bytes: Uint8Array;
  let parsed: unknown;
  try {
    bytes = await readFile(baselinePath);
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch (error) {
    return invalid(`cannot read it as JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  if (!isRecord(parsed) || parsed.kind !== BASELINE_KIND || parsed.schemaVersion !== 1)
    return invalid("unexpected kind or schema version");
  const { totals, knownCharges, unknownExposure, revision } = parsed;
  if (typeof revision !== "string" || !isRecord(totals) || !Array.isArray(knownCharges) || !Array.isArray(unknownExposure))
    return invalid("missing revision, totals, knownCharges or unknownExposure");
  if (totals.ceilingUsd !== STUDY_CEILING_USD)
    return invalid(`ceiling must stay USD ${STUDY_CEILING_USD}; an increase needs owner approval`);
  const sum = (rows: readonly unknown[], field: string): number => {
    const ids = new Set<unknown>();
    let total = 0;
    for (const row of rows) {
      const amount = isRecord(row) ? row[field] : undefined;
      if (!isRecord(row) || typeof row.id !== "string" || ids.has(row.id) || typeof amount !== "number")
        return invalid(`row ${JSON.stringify(isRecord(row) ? row.id : row)} is malformed or duplicated`);
      ids.add(row.id);
      total += usdToNano(amount, `baseline ${row.id} ${field}`);
    }
    return total;
  };
  const knownNano = sum(knownCharges, "reportedUsd");
  const holdNano = sum(unknownExposure, "pendingHoldUsd");
  if (typeof totals.knownReportedUsd !== "number" || usdToNano(totals.knownReportedUsd) !== knownNano)
    return invalid("totals.knownReportedUsd does not equal its rows");
  if (typeof totals.pendingHoldsUsd !== "number" || usdToNano(totals.pendingHoldsUsd) !== holdNano)
    return invalid("totals.pendingHoldsUsd does not equal its rows");
  if (typeof totals.conservativeExposureUsd !== "number" || usdToNano(totals.conservativeExposureUsd) !== knownNano + holdNano)
    return invalid("totals.conservativeExposureUsd does not equal known plus holds");
  return { sha256: sha256(bytes), revision, knownNano, holdNano };
}

interface LedgerRun {
  readonly reserveNano: number;
  settled: boolean;
}

interface LedgerState {
  readonly baseline: BaselineFacts;
  readonly runs: Map<string, LedgerRun>;
  readonly stopReasons: string[];
  reportedNano: number;
  unknownNano: number;
  activeNano: number;
  rowCount: number;
  headSha256: string;
}

const GENESIS_KEYS = "schemaVersion,kind,seq,prevSha256,utc,ceilingNanoUsd,baselineSha256,baselineRevision,baselineKnownNanoUsd,baselineUnknownHoldNanoUsd";
const RESERVE_KEYS = "schemaVersion,kind,seq,prevSha256,utc,runId,reserveNanoUsd,remainingPlannedNanoUsd,exposureBeforeNanoUsd";
const SETTLE_KEYS = "schemaVersion,kind,seq,prevSha256,utc,runId,reportedNanoUsd,reportedUsdRaw,unknownNanoUsd,releasedNanoUsd,overrunNanoUsd,note";

function exposureOf(state: LedgerState): number {
  return state.baseline.knownNano + state.baseline.holdNano + state.reportedNano + state.unknownNano + state.activeNano;
}

function applySettlement(state: LedgerState, runId: string, run: LedgerRun, reportedNano: number, unknownNano: number): {
  releasedNano: number;
  overrunNano: number;
} {
  const accounted = reportedNano + unknownNano;
  const releasedNano = Math.max(0, run.reserveNano - accounted);
  const overrunNano = Math.max(0, accounted - run.reserveNano);
  run.settled = true;
  state.activeNano -= run.reserveNano;
  state.reportedNano += reportedNano;
  state.unknownNano += unknownNano;
  if (unknownNano > 0)
    state.stopReasons.push(`Run ${runId} retained USD ${formatNanoUsd(unknownNano)} for missing charges`);
  if (overrunNano > 0)
    state.stopReasons.push(`Run ${runId} exceeded its hold by USD ${formatNanoUsd(overrunNano)}`);
  return { releasedNano, overrunNano };
}

/** Strict replay of every row. Anything unexpected refuses: no row is skipped or repaired. */
function parseLedger(text: string, path: string): LedgerState {
  const corrupt = (line: number, detail: string): never =>
    refuse(
      "ledger-corrupt",
      `Spend ledger ${path} line ${line}: ${detail}. Nothing was admitted. Preserve the file and resolve it by hand; ` +
        "starting a new ledger would reset the programme total.",
    );
  if (text.length === 0) return corrupt(1, "the file is empty");
  if (!text.endsWith("\n")) return corrupt(text.split("\n").length, "the last row is incomplete");
  const lines = text.slice(0, -1).split("\n");
  const count = (row: Record<string, unknown>, key: string, line: number): number => {
    const value = row[key];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
      return corrupt(line, `${key} is not a non-negative integer`);
    return value;
  };
  let state: LedgerState | undefined;
  let previous: string | null = null;
  for (const [index, rowText] of lines.entries()) {
    const line = index + 1;
    let row: unknown;
    try {
      row = JSON.parse(rowText);
    } catch {
      return corrupt(line, "the row is not JSON");
    }
    if (!isRecord(row) || JSON.stringify(row) !== rowText) return corrupt(line, "the row is not in its written form");
    const keys = Object.keys(row).join(",");
    if (row.schemaVersion !== ROW_SCHEMA_VERSION) return corrupt(line, "unknown schema version");
    if (row.seq !== index) return corrupt(line, `sequence ${String(row.seq)} where ${index} was expected`);
    if (row.prevSha256 !== previous) return corrupt(line, "the hash chain is broken");
    if (typeof row.utc !== "string") return corrupt(line, "the row has no timestamp");
    const rowHash = sha256(rowText);
    previous = rowHash;
    if (index === 0) {
      if (row.kind !== "genesis" || keys !== GENESIS_KEYS) return corrupt(line, "the first row is not a genesis row");
      if (row.ceilingNanoUsd !== usdToNano(STUDY_CEILING_USD)) return corrupt(line, "the ceiling differs from the programme ceiling");
      if (typeof row.baselineSha256 !== "string" || typeof row.baselineRevision !== "string")
        return corrupt(line, "the baseline binding is malformed");
      state = {
        baseline: {
          sha256: row.baselineSha256,
          revision: row.baselineRevision,
          knownNano: count(row, "baselineKnownNanoUsd", line),
          holdNano: count(row, "baselineUnknownHoldNanoUsd", line),
        },
        runs: new Map(),
        stopReasons: [],
        reportedNano: 0,
        unknownNano: 0,
        activeNano: 0,
        rowCount: 0,
        headSha256: "",
      };
    } else if (state === undefined) {
      return corrupt(line, "no genesis row");
    } else if (row.kind === "reserve" && keys === RESERVE_KEYS) {
      const runId = row.runId;
      if (typeof runId !== "string" || !RUN_ID.test(runId)) return corrupt(line, "invalid run identity");
      if (state.runs.has(runId)) return corrupt(line, `duplicate reservation for ${runId}`);
      const reserveNano = count(row, "reserveNanoUsd", line);
      if (reserveNano === 0) return corrupt(line, "zero reservation");
      if (count(row, "exposureBeforeNanoUsd", line) !== exposureOf(state))
        return corrupt(line, "recorded exposure does not match the earlier rows");
      if (exposureOf(state) + reserveNano + count(row, "remainingPlannedNanoUsd", line) > usdToNano(STUDY_CEILING_USD))
        return corrupt(line, "the reservation is above the ceiling");
      state.runs.set(runId, { reserveNano, settled: false });
      state.activeNano += reserveNano;
    } else if (row.kind === "settle" && keys === SETTLE_KEYS) {
      const runId = row.runId;
      const run = typeof runId === "string" ? state.runs.get(runId) : undefined;
      if (typeof runId !== "string" || run === undefined) return corrupt(line, "settlement of an unknown run");
      if (run.settled) return corrupt(line, `duplicate settlement for ${runId}`);
      if (typeof row.note !== "string" || row.note.length === 0) return corrupt(line, "settlement without a note");
      const reportedNano = count(row, "reportedNanoUsd", line);
      if (typeof row.reportedUsdRaw !== "number" || usdToNano(row.reportedUsdRaw) !== reportedNano)
        return corrupt(line, "reported amount does not match its raw value");
      const { releasedNano, overrunNano } = applySettlement(state, runId, run, reportedNano, count(row, "unknownNanoUsd", line));
      if (count(row, "releasedNanoUsd", line) !== releasedNano || count(row, "overrunNanoUsd", line) !== overrunNano)
        return corrupt(line, "release or overrun does not match the reservation");
    } else {
      return corrupt(line, "unknown row shape");
    }
    state.rowCount = line;
    state.headSha256 = rowHash;
  }
  if (state === undefined) return corrupt(1, "no genesis row");
  return state;
}

function snapshotOf(state: LedgerState): StudySpendSnapshot {
  const ceilingNanoUsd = usdToNano(STUDY_CEILING_USD);
  const exposureNanoUsd = exposureOf(state);
  return {
    ceilingNanoUsd,
    baselineSha256: state.baseline.sha256,
    baselineRevision: state.baseline.revision,
    baselineKnownNanoUsd: state.baseline.knownNano,
    baselineUnknownHoldNanoUsd: state.baseline.holdNano,
    studyReportedNanoUsd: state.reportedNano,
    studyUnknownHoldNanoUsd: state.unknownNano,
    activeReservationNanoUsd: state.activeNano,
    exposureNanoUsd,
    remainingNanoUsd: ceilingNanoUsd - exposureNanoUsd,
    activeRuns: [...state.runs].filter(([, run]) => !run.settled).map(([runId]) => runId),
    stopReasons: [...state.stopReasons],
    rowCount: state.rowCount,
    headSha256: state.headSha256,
  };
}

function isCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

/**
 * Opens the one programme ledger. A first open writes a genesis row bound to
 * the baseline's hash. Every later operation re-verifies all rows and the
 * baseline hash, so no result relies on memory of an earlier read.
 */
export async function openStudySpendLedger(
  root: string,
  baselinePath: string,
  options: OpenStudySpendLedgerOptions = {},
): Promise<StudySpendLedger> {
  const path = join(root, STUDY_SPEND_LEDGER_FILE);
  const lockPath = `${path}.lock`;
  const lockTimeoutMs = options.lockTimeoutMs ?? 10_000;

  const withLock = async <T>(work: () => Promise<T>): Promise<T> => {
    const deadline = Date.now() + lockTimeoutMs;
    for (;;) {
      try {
        const handle = await open(lockPath, "wx");
        try {
          await handle.writeFile(`pid ${process.pid} ${new Date().toISOString()}\n`);
        } finally {
          await handle.close();
        }
        break;
      } catch (error) {
        if (!isCode(error, "EEXIST")) throw error;
        if (Date.now() >= deadline) {
          const holder = await readFile(lockPath, "utf8").catch(() => "unreadable");
          refuse(
            "ledger-locked",
            `Spend ledger lock ${lockPath} is held (${holder.trim()}). Nothing was admitted. If no study process is ` +
              "running, a crash left it behind: remove the file by hand and retry.",
          );
        }
        await delay(5 + Math.random() * 20);
      }
    }
    try {
      return await work();
    } finally {
      await unlink(lockPath);
    }
  };

  const loadBound = async (): Promise<LedgerState> => {
    const state = parseLedger(await readFile(path, "utf8"), path);
    const current = await readBaseline(baselinePath);
    if (current.sha256 !== state.baseline.sha256)
      refuse(
        "baseline-changed",
        `Spend baseline ${baselinePath} has hash ${current.sha256}, but ledger ${path} is bound to ` +
          `${state.baseline.sha256} (${state.baseline.revision}). Nothing was admitted.`,
      );
    if (current.knownNano !== state.baseline.knownNano || current.holdNano !== state.baseline.holdNano)
      refuse("ledger-corrupt", `Spend ledger ${path} line 1: its baseline amounts differ from the baseline it is bound to. Nothing was admitted.`);
    return state;
  };

  const append = async (row: Record<string, unknown>): Promise<void> => {
    const handle = await open(path, "a");
    try {
      await handle.writeFile(`${JSON.stringify(row)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
  };

  const baseline = await readBaseline(baselinePath);
  const exists = await access(path).then(() => true, () => false);
  if (!exists && options.mustExist)
    refuse("ledger-missing", `Spend ledger ${path} does not exist; refusing to start the programme total again`);
  if (!exists) await mkdir(root, { recursive: true });
  await withLock(async () => {
    const present = await access(path).then(() => true, () => false);
    if (present) {
      await loadBound();
      return;
    }
    // Publish the genesis row by rename, so a crash cannot leave an empty ledger.
    const temporary = `${path}.genesis-${process.pid}`;
    const handle = await open(temporary, "wx");
    try {
      await handle.writeFile(`${JSON.stringify({
        schemaVersion: ROW_SCHEMA_VERSION,
        kind: "genesis",
        seq: 0,
        prevSha256: null,
        utc: new Date().toISOString(),
        ceilingNanoUsd: usdToNano(STUDY_CEILING_USD),
        baselineSha256: baseline.sha256,
        baselineRevision: baseline.revision,
        baselineKnownNanoUsd: baseline.knownNano,
        baselineUnknownHoldNanoUsd: baseline.holdNano,
      })}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
    await syncDirectory(root);
  });

  return {
    path,
    snapshot: () => withLock(async () => snapshotOf(await loadBound())),
    reserve: async (runId, reserveUsd, remainingPlannedUsd) => {
      if (typeof runId !== "string" || !RUN_ID.test(runId))
        refuse("invalid-argument", "runId must be 1 to 200 letters, digits, dots, colons, underscores or hyphens");
      const reserveNano = usdToNano(reserveUsd, "reserveUsd");
      const remainingNano = usdToNano(remainingPlannedUsd, "remainingPlannedUsd");
      if (reserveNano === 0 || reserveNano % usdToNano(ATTEMPT_HOLD_USD) !== 0)
        refuse("invalid-argument", `reserveUsd must be a positive multiple of USD ${ATTEMPT_HOLD_USD}: maxAttempts * hold`);
      return withLock(async () => {
        const state = await loadBound();
        if (state.runs.has(runId)) refuse("duplicate-run", `Run ${runId} already has a reservation; a rerun needs a new identity`);
        if (state.stopReasons.length > 0)
          refuse("paid-stopped", `Further paid batches are stopped: ${state.stopReasons.join("; ")}`);
        const exposureBefore = exposureOf(state);
        const requested = exposureBefore + reserveNano + remainingNano;
        if (requested > usdToNano(STUDY_CEILING_USD))
          refuse(
            "ceiling-exceeded",
            `Run ${runId} refused: exposure USD ${formatNanoUsd(exposureBefore)} + reservation USD ${formatNanoUsd(reserveNano)} ` +
              `+ remaining planned USD ${formatNanoUsd(remainingNano)} = USD ${formatNanoUsd(requested)}, above the ceiling of USD ${STUDY_CEILING_USD}`,
          );
        await append({
          schemaVersion: ROW_SCHEMA_VERSION,
          kind: "reserve",
          seq: state.rowCount,
          prevSha256: state.headSha256,
          utc: new Date().toISOString(),
          runId,
          reserveNanoUsd: reserveNano,
          remainingPlannedNanoUsd: remainingNano,
          exposureBeforeNanoUsd: exposureBefore,
        });
        return { runId, reserveNanoUsd: reserveNano, snapshot: snapshotOf(await loadBound()) };
      });
    },
    settle: async (runId, settlement) => {
      const reportedNano = usdToNano(settlement.reportedUsd, "reportedUsd");
      const unknownNano = usdToNano(settlement.unknownUsd, "unknownUsd");
      if (unknownNano % usdToNano(ATTEMPT_HOLD_USD) !== 0)
        refuse("invalid-argument", `unknownUsd must be USD ${ATTEMPT_HOLD_USD} per missing attempted charge`);
      if (typeof settlement.note !== "string" || settlement.note.length === 0 || settlement.note.length > MAX_NOTE_CHARS)
        refuse("invalid-argument", `A settlement needs a note of 1 to ${MAX_NOTE_CHARS} characters`);
      return withLock(async () => {
        const state = await loadBound();
        const run = state.runs.get(runId);
        if (run === undefined) return refuse("unknown-run", `Run ${runId} has no reservation`);
        if (run.settled) refuse("duplicate-settlement", `Run ${runId} is already settled; settlements are final`);
        const seq = state.rowCount;
        const prevSha256 = state.headSha256;
        const { releasedNano, overrunNano } = applySettlement(state, runId, run, reportedNano, unknownNano);
        await append({
          schemaVersion: ROW_SCHEMA_VERSION,
          kind: "settle",
          seq,
          prevSha256,
          utc: new Date().toISOString(),
          runId,
          reportedNanoUsd: reportedNano,
          reportedUsdRaw: settlement.reportedUsd,
          unknownNanoUsd: unknownNano,
          releasedNanoUsd: releasedNano,
          overrunNanoUsd: overrunNano,
          note: settlement.note,
        });
        return {
          runId,
          reportedNanoUsd: reportedNano,
          unknownNanoUsd: unknownNano,
          releasedNanoUsd: releasedNano,
          overrunNanoUsd: overrunNano,
          snapshot: snapshotOf(await loadBound()),
        };
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Per-run limits
// ---------------------------------------------------------------------------

export interface StudyLimitOptions {
  readonly maxMainRequests: number;
  /** Actual transport attempts, retries included. Reserve attemptHoldUsd(maxModelAttempts). */
  readonly maxModelAttempts: number;
  /** Every tool_call hook firing, nested script calls included. */
  readonly maxToolCalls: number;
  /** Attempted-page budget for the run. Reserved per call and not returned if fewer are fetched. */
  readonly maxPages: number;
  /** Per model attempt. */
  readonly maxInputBytes: number;
  /** Per model attempt. */
  readonly maxOutputTokens: number;
  /** Per tool call carrying a query. */
  readonly maxQueryChars: number;
  /**
   * Unforced live population only: pages to reserve when `intelli_research`
   * omits maxUrls. Must be at least the session's effective settings.defaultUrls
   * capped by settings.maxUrls, because the host still runs its own default.
   * Leave unset for prescribed workflows, which then must state maxUrls.
   */
  readonly omittedMaxUrlsPages?: number;
}

export interface StudyLimitUsage {
  readonly mainRequests: number;
  readonly modelAttempts: number;
  readonly toolCalls: number;
  readonly pagesReserved: number;
  readonly toolCallsByName: Readonly<Record<string, number>>;
  readonly refusals: number;
  readonly stopReason: string | null;
}

export interface StudyLimits {
  /** For the real tool_call hook. Throws before the call. Reads args and never changes them. */
  admitTool(name: string, args: unknown): void;
  /** Before each actual transport attempt, including each retry. Throws before dispatch. */
  admitModel(request: ModelFixtureRequest): void;
  /** Before each main-model provider request. */
  admitMainRequest(): void;
  /** Blocks new calls only. Work already started or settled is left alone. The first reason stays. */
  stop(reason: string): void;
  usage(): StudyLimitUsage;
}

const QUERY_TOOLS: ReadonlySet<string> = new Set(["intelli_search", "intelli_extract", "intelli_collate", "intelli_research"]);

export function createStudyLimits(options: StudyLimitOptions): StudyLimits {
  const size = (key: keyof StudyLimitOptions, minimum: number): number => {
    const value = options[key];
    if (!Number.isSafeInteger(value) || (value as number) < minimum)
      return refuse("invalid-argument", `${key} must be an integer of at least ${minimum}`);
    return value as number;
  };
  const maxMainRequests = size("maxMainRequests", 0);
  const maxModelAttempts = size("maxModelAttempts", 0);
  const maxToolCalls = size("maxToolCalls", 0);
  const maxPages = size("maxPages", 0);
  const maxInputBytes = size("maxInputBytes", 1);
  const maxOutputTokens = size("maxOutputTokens", 1);
  const maxQueryChars = size("maxQueryChars", 1);
  const omittedMaxUrlsPages = options.omittedMaxUrlsPages === undefined ? undefined : size("omittedMaxUrlsPages", 1);

  let mainRequests = 0;
  let modelAttempts = 0;
  let toolCalls = 0;
  let pagesReserved = 0;
  let refusals = 0;
  let stopReason: string | null = null;
  const toolCallsByName = new Map<string, number>();

  const block = (code: StudyBudgetErrorCode, message: string): never => {
    refusals += 1;
    return refuse(code, message);
  };
  const assertRunning = (): void => {
    if (stopReason !== null) block("run-stopped", "The study run is stopped; usage() holds the reason");
  };

  // Each admit checks everything before it counts anything, so a refused call consumes no budget.
  // Model refusals carry no numbers or caller text: the core retry classifier
  // matches words such as 429, 500 and timeout, and must not retry a refusal.
  const pagesFor = (name: string, args: Record<string, unknown>): number => {
    if (name === "intelli_fetch") return 1;
    if (name !== "intelli_research") return 0;
    if (args.maxUrls === undefined || args.maxUrls === null) {
      if (omittedMaxUrlsPages !== undefined) return omittedMaxUrlsPages;
      return block("limit-exceeded", "intelli_research must state maxUrls in a prescribed workflow");
    }
    if (typeof args.maxUrls !== "number" || !Number.isSafeInteger(args.maxUrls) || args.maxUrls < 1)
      return block("limit-exceeded", "intelli_research maxUrls must be a positive integer");
    return args.maxUrls;
  };

  return {
    admitTool(name, args) {
      assertRunning();
      if (!(STUDY_ALLOWED_TOOLS as readonly string[]).includes(name))
        block("tool-not-allowed", `Tool ${name} is not in the study catalogue`);
      if (!isRecord(args)) return block("invalid-argument", `Tool ${name} arguments are not an object`);
      if (toolCalls >= maxToolCalls) block("limit-exhausted", `The run's ${maxToolCalls} tool calls are used`);
      if (QUERY_TOOLS.has(name)) {
        if (typeof args.query !== "string") block("invalid-argument", `Tool ${name} has no query`);
        else if (args.query.length > maxQueryChars)
          block("limit-exceeded", `Tool ${name} query has ${args.query.length} characters; the limit is ${maxQueryChars}`);
      }
      const pages = pagesFor(name, args);
      if (pagesReserved + pages > maxPages)
        block("limit-exhausted", `Tool ${name} needs ${pages} pages; ${maxPages - pagesReserved} of ${maxPages} remain`);
      toolCalls += 1;
      pagesReserved += pages;
      toolCallsByName.set(name, (toolCallsByName.get(name) ?? 0) + 1);
    },
    admitModel(request) {
      assertRunning();
      const model = request.model;
      if (!STUDY_ALLOWED_MODELS.some((allowed) => allowed.provider === model?.provider && allowed.model === model?.model))
        block("model-not-allowed", `Model ${String(model?.provider)}/${String(model?.model)} is not a prescribed pipeline model`);
      const { maxTokens } = request;
      if (typeof maxTokens !== "number" || !Number.isSafeInteger(maxTokens) || maxTokens < 1)
        return block("limit-exceeded", "A model attempt needs a finite positive maxTokens");
      if (maxTokens > maxOutputTokens)
        block("limit-exceeded", "A model attempt asks for more than maxOutputTokens");
      const inputBytes =
        Buffer.byteLength(request.systemPrompt) +
        Buffer.byteLength(request.userMessage) +
        (request.effectivePayloadPatch === null ? 0 : Buffer.byteLength(JSON.stringify(request.effectivePayloadPatch)));
      if (inputBytes > maxInputBytes)
        block("limit-exceeded", "A model attempt has more input than maxInputBytes");
      if (modelAttempts >= maxModelAttempts) block("limit-exhausted", "The run has used maxModelAttempts");
      modelAttempts += 1;
    },
    admitMainRequest() {
      assertRunning();
      if (mainRequests >= maxMainRequests) block("limit-exhausted", "The run has used maxMainRequests");
      mainRequests += 1;
    },
    stop(reason) {
      stopReason ??= reason;
    },
    usage: () => ({
      mainRequests,
      modelAttempts,
      toolCalls,
      pagesReserved,
      toolCallsByName: Object.fromEntries(toolCallsByName),
      refusals,
      stopReason,
    }),
  };
}
