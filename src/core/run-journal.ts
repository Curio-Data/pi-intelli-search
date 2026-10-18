// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// Durable file helpers, the checksum-chained allocation journal (C23) and the
// verified committed-run reader (C22/C27) shared by run-store.ts and
// run-index.ts. Nothing here deletes, truncates or rewrites existing evidence.

import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { setImmediate as yieldTurn } from "node:timers/promises";
import type { Diagnostic } from "./execution-contracts.js";
import {
  ACCOUNTING_FILE,
  ACCOUNTING_MARKER_FILE,
  AccountingMarkerSchema,
  AccountingSchema,
  AllocationRecordSchema,
  CommittedMarkerSchema,
  JOURNAL_FILE,
  JOURNAL_MAX_BYTES,
  JOURNAL_RECORD_MAX_BYTES,
  JOURNAL_YIELD_RECORDS,
  MARKER_FILE,
  NAMESPACE_FILE,
  NamespaceSchema,
  RESERVATION_FILE,
  ReservationSchema,
  RUNS_DIR,
  ZERO_HASH,
  allocationHash,
  compatibilityKeyFor,
  isSafeRelativePath,
  isUtc,
  isValid,
  sha256,
  utcDateOf,
  type AccountingRecord,
  type AllocationRecord,
  type CommittedMarker,
  type NamespaceRecord,
  type ReservationRecord,
} from "./run-format.js";

/** Structural JSON files (markers, reservations, namespace, index) are bounded. */
export const STRUCTURAL_MAX_BYTES = 16 * 1024 * 1024;
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

export class StoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
  get diagnostic(): Diagnostic {
    return { code: this.code, message: this.message };
  }
}

export function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Write a new file exclusively (never replacing) and sync it before closing. */
export async function writeNewFileDurable(path: string, bytes: Uint8Array): Promise<void> {
  const handle = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW,
    0o600,
  );
  try {
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset);
      offset += bytesWritten;
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Sync a directory entry table. Linux and macOS support this; where the
 * platform refuses it, durability cannot be established and callers return a
 * diagnostic rather than silently weakening the protocol (C21).
 */
export async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Read a bounded regular file without following a final symlink. */
export async function readBoundedFile(
  path: string,
  maxBytes = STRUCTURAL_MAX_BYTES,
): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new StoreError("NOT_REGULAR", `${path} is not a regular file`);
    if (info.size > maxBytes)
      throw new StoreError("TOO_LARGE", `${path} exceeds ${maxBytes} bytes`);
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

export async function readJson(
  path: string,
  maxBytes?: number,
): Promise<{ bytes: Buffer; value: unknown }> {
  const bytes = await readBoundedFile(path, maxBytes);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return { bytes, value: JSON.parse(text) };
}

/** Stream-hash a regular file, refusing symlinks, with cancellation per chunk. */
export async function hashFile(
  path: string,
  signal?: AbortSignal,
): Promise<{ bytes: number; sha256: string }> {
  const handle = await open(path, constants.O_RDONLY | NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new StoreError("NOT_REGULAR", `${path} is not a regular file`);
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(65_536);
    let total = 0;
    for (;;) {
      if (signal?.aborted) throw new StoreError("ABORTED", "Cancelled while hashing");
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      total += bytesRead;
    }
    return { bytes: total, sha256: hash.digest("hex") };
  } finally {
    await handle.close();
  }
}

export interface NamespaceState {
  readonly namespace?: NamespaceRecord;
  readonly journalBytes?: number;
}

export async function readNamespace(namespaceDir: string): Promise<NamespaceRecord | undefined> {
  let parsed: unknown;
  try {
    parsed = (await readJson(join(namespaceDir, NAMESPACE_FILE))).value;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw new StoreError(
      "NAMESPACE_INVALID",
      `Namespace identity ${join(namespaceDir, NAMESPACE_FILE)} is unreadable: ${describe(error)}`,
    );
  }
  if (!isValid(NamespaceSchema, parsed) || !isUtc(parsed.createdUtc))
    throw new StoreError(
      "NAMESPACE_INVALID",
      `Namespace identity ${join(namespaceDir, NAMESPACE_FILE)} does not match schema intelli-v1/namespace@1`,
    );
  return parsed;
}

export interface JournalState {
  readonly records: ReadonlyMap<string, AllocationRecord>;
  readonly last?: AllocationRecord;
  readonly bytes: number;
}

export type JournalMode =
  /** Writers fail closed on every defect, including an unterminated tail. */
  | "writer"
  /** Readers ignore an unterminated tail: a marker can only follow a synced record. */
  | "reader";

/**
 * Validate the journal as a bounded stream: size ceiling, per-record size,
 * strict UTF-8, schema, namespace, contiguous safe sequence from 1, previous
 * hash chain, recomputed record hash and unique run ID. Yields to the event
 * loop and checks cancellation every JOURNAL_YIELD_RECORDS records.
 */
export async function validateJournal(
  namespaceDir: string,
  namespaceId: string,
  mode: JournalMode,
  signal?: AbortSignal,
): Promise<JournalState> {
  const path = join(namespaceDir, JOURNAL_FILE);
  const damaged = (detail: string) =>
    new StoreError(
      "JOURNAL_DAMAGED",
      `Allocation journal ${path} is damaged (${detail}). Publication is unavailable; stop all writers, preserve the namespace and validate the journal before any repair.`,
    );
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | NOFOLLOW);
  } catch (error) {
    if (errorCode(error) === "ENOENT")
      throw new StoreError(
        "JOURNAL_MISSING",
        `Allocation journal ${path} is missing while namespace identity exists; allocation history is unknown and requires operator recovery.`,
      );
    throw new StoreError(
      "JOURNAL_IO",
      `Cannot open allocation journal ${path}: ${describe(error)}`,
    );
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw damaged("not a regular file");
    if (info.size > JOURNAL_MAX_BYTES)
      throw new StoreError(
        "JOURNAL_CEILING",
        `Allocation journal ${path} is ${info.size} bytes, above the ${JOURNAL_MAX_BYTES}-byte safety ceiling; no automatic compaction or reset exists, so publication is unavailable until an operator archives the namespace.`,
      );
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const records = new Map<string, AllocationRecord>();
    let last: AllocationRecord | undefined;
    let pending = Buffer.alloc(0);
    const buffer = Buffer.allocUnsafe(65_536);
    let consumed = 0;
    let count = 0;
    const accept = async (line: Buffer) => {
      if (line.byteLength + 1 > JOURNAL_RECORD_MAX_BYTES)
        throw damaged(`record ${count + 1} exceeds ${JOURNAL_RECORD_MAX_BYTES} bytes`);
      let value: unknown;
      try {
        value = JSON.parse(decoder.decode(line));
      } catch {
        throw damaged(`record ${count + 1} is not UTF-8 JSON`);
      }
      if (!isValid(AllocationRecordSchema, value) || !isUtc(value.startedUtc))
        throw damaged(`record ${count + 1} does not match schema intelli-v1/allocation@1`);
      if (value.namespaceId !== namespaceId)
        throw damaged(`record ${count + 1} names another namespace`);
      const expected = (last?.sequence ?? 0) + 1;
      if (value.sequence !== expected || !Number.isSafeInteger(value.sequence))
        throw damaged(`record ${count + 1} has sequence ${value.sequence}, expected ${expected}`);
      if (value.previousHash !== (last?.hash ?? ZERO_HASH))
        throw damaged(`record ${count + 1} breaks the hash chain`);
      if (allocationHash(value) !== value.hash)
        throw damaged(`record ${count + 1} hash does not match its content`);
      if (records.has(value.runId)) throw damaged(`record ${count + 1} repeats run ${value.runId}`);
      records.set(value.runId, value);
      last = value;
      count += 1;
      if (count % JOURNAL_YIELD_RECORDS === 0) {
        await yieldTurn();
        if (signal?.aborted)
          throw new StoreError("ABORTED", "Cancelled while validating the allocation journal");
      }
    };
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      consumed += bytesRead;
      pending = Buffer.concat([pending, buffer.subarray(0, bytesRead)]);
      let newline: number;
      while ((newline = pending.indexOf(0x0a)) !== -1) {
        await accept(pending.subarray(0, newline));
        pending = pending.subarray(newline + 1);
      }
      if (pending.byteLength >= JOURNAL_RECORD_MAX_BYTES)
        throw damaged(`record ${count + 1} exceeds ${JOURNAL_RECORD_MAX_BYTES} bytes`);
    }
    if (pending.byteLength > 0 && mode === "writer")
      throw damaged("unterminated partial tail; it is never truncated automatically");
    return { records, last, bytes: mode === "writer" ? consumed : consumed - pending.byteLength };
  } finally {
    await handle.close();
  }
}

/** A journal-free namespace has no prior identity, reservation or committed marker. */
export async function listRunNames(namespaceDir: string): Promise<string[] | undefined> {
  try {
    return await readdir(join(namespaceDir, RUNS_DIR));
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

export async function hasStructuralRecord(runDir: string): Promise<boolean> {
  try {
    const info = await lstat(runDir);
    if (!info.isDirectory()) return true;
    const names = await readdir(runDir);
    return names.length > 0;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

/**
 * C23 allocation-time identity check for one journalled run: an existing
 * reservation and an existing committed marker must parse, match the schema
 * and agree with the journal record. A missing reservation without a marker
 * is an allowed gap. File contents are not hashed here; readers do that.
 */
export async function checkRunIdentity(
  namespaceDir: string,
  namespaceId: string,
  runId: string,
  record: AllocationRecord,
): Promise<string | undefined> {
  const runDir = join(namespaceDir, RUNS_DIR, runId);
  const read = async (name: string): Promise<{ value: unknown } | undefined | string> => {
    try {
      return { value: (await readJson(join(runDir, name))).value };
    } catch (error) {
      if (errorCode(error) === "ENOENT") return undefined;
      return `${name} is unreadable: ${describe(error)}`;
    }
  };
  try {
    const dir = await lstat(runDir);
    if (!dir.isDirectory()) return "run path is not a directory";
  } catch (error) {
    return `run path cannot be inspected: ${describe(error)}`;
  }
  const reservation = await read(RESERVATION_FILE);
  const marker = await read(MARKER_FILE);
  if (typeof reservation === "string") return reservation;
  if (typeof marker === "string") return marker;
  if (reservation) {
    const value = reservation.value;
    if (!isValid(ReservationSchema, value)) return "reservation schema mismatch";
    const agrees =
      value.namespaceId === namespaceId &&
      value.runId === runId &&
      value.sequence === record.sequence &&
      value.operationId === record.operationId &&
      value.compatibilityKey === record.compatibilityKey &&
      value.startedUtc === record.startedUtc &&
      value.allocationHash === record.hash;
    if (!agrees) return "reservation identity differs from the journal record";
  }
  if (marker) {
    if (!reservation) return "committed marker without a reservation";
    const value = marker.value;
    if (!isValid(CommittedMarkerSchema, value) || !isUtc(value.startedUtc))
      return "committed marker schema mismatch";
    const agrees =
      value.namespaceId === namespaceId &&
      value.runId === runId &&
      value.admissionSequence === record.sequence &&
      value.allocationHash === record.hash &&
      value.compatibilityKey === record.compatibilityKey &&
      value.startedUtc === record.startedUtc &&
      compatibilityKeyFor(value.query, utcDateOf(value.startedUtc)) === value.compatibilityKey;
    if (!agrees) return "committed marker identity differs from the journal record";
  }
  return undefined;
}

export type RunVerification =
  | {
      readonly ok: true;
      readonly marker: CommittedMarker;
      readonly manifestSha256: string;
      readonly reservation: ReservationRecord;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * C27 verified reader: a run is evidence only when its reservation and
 * committed marker agree with each other and with the journal record, its
 * compatibility key derives from the marker query/date, and every advertised
 * file exists as an unlinked regular file with the recorded size and hash.
 */
export async function verifyCommittedRun(
  namespaceDir: string,
  namespaceId: string,
  runId: string,
  record: AllocationRecord | undefined,
  options: { readonly expectedManifestSha256?: string; readonly signal?: AbortSignal } = {},
): Promise<RunVerification> {
  const fail = (reason: string): RunVerification => ({ ok: false, reason: `${runId}: ${reason}` });
  if (!record) return fail("no journal record");
  const runDir = join(namespaceDir, RUNS_DIR, runId);
  try {
    const dir = await lstat(runDir);
    if (!dir.isDirectory()) return fail("run path is not a directory");
    let markerRead;
    try {
      markerRead = await readJson(join(runDir, MARKER_FILE));
    } catch (error) {
      return fail(
        errorCode(error) === "ENOENT"
          ? "no committed marker"
          : `unreadable committed marker: ${describe(error)}`,
      );
    }
    const manifestSha256 = sha256(markerRead.bytes);
    if (options.expectedManifestSha256 && manifestSha256 !== options.expectedManifestSha256)
      return fail("committed marker differs from the indexed manifest");
    const marker = markerRead.value;
    if (!isValid(CommittedMarkerSchema, marker) || !isUtc(marker.startedUtc))
      return fail("marker schema mismatch");
    const reservationValue = (await readJson(join(runDir, RESERVATION_FILE))).value;
    if (!isValid(ReservationSchema, reservationValue)) return fail("reservation schema mismatch");
    const reservation = reservationValue;
    const identity = [
      marker.namespaceId === namespaceId,
      reservation.namespaceId === namespaceId,
      record.namespaceId === namespaceId,
      marker.runId === runId && reservation.runId === runId && record.runId === runId,
      marker.admissionSequence === record.sequence && reservation.sequence === record.sequence,
      marker.allocationHash === record.hash && reservation.allocationHash === record.hash,
      marker.compatibilityKey === record.compatibilityKey &&
        reservation.compatibilityKey === record.compatibilityKey,
      marker.startedUtc === record.startedUtc && reservation.startedUtc === record.startedUtc,
      reservation.operationId === record.operationId,
      compatibilityKeyFor(marker.query, utcDateOf(marker.startedUtc)) === marker.compatibilityKey,
    ];
    if (identity.includes(false))
      return fail("reservation, marker and journal identities conflict");
    const seen = new Set<string>();
    const required = new Map<string, string>([
      ["report.md", "report"],
      ["query.txt", "query"],
      ["run.json", "manifest-data"],
    ]);
    for (const file of [...marker.files, ...marker.nonEvidence]) {
      if (!isSafeRelativePath(file.relativePath) || seen.has(file.relativePath))
        return fail(`unsafe or duplicate path ${file.relativePath}`);
      seen.add(file.relativePath);
    }
    for (const [path, kind] of required) {
      const entry = marker.files.find((file) => file.relativePath === path);
      if (!entry || entry.kind !== kind) return fail(`required ${path} missing from marker`);
    }
    if (
      marker.files.filter((file) => ["report", "query", "manifest-data"].includes(file.kind))
        .length !== 3
    )
      return fail("duplicate structural file kinds");
    const report = marker.files.find((file) => file.relativePath === "report.md");
    if (!report || report.bytes === 0) return fail("report is empty");
    const query = marker.files.find((file) => file.relativePath === "query.txt");
    if (query?.sha256 !== sha256(Buffer.from(marker.query, "utf8")))
      return fail("query.txt does not match the marker query");
    for (const file of [...marker.files, ...marker.nonEvidence]) {
      const actual = await hashFile(join(runDir, file.relativePath), options.signal);
      if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256)
        return fail(`${file.relativePath} size or hash differs`);
    }
    return { ok: true, marker, manifestSha256, reservation };
  } catch (error) {
    if (options.signal?.aborted) throw new StoreError("ABORTED", "Cancelled while verifying runs");
    return fail(describe(error));
  }
}

/** Readers accept accounting only through its own valid hash marker. */
export async function verifyAccounting(
  runDir: string,
  namespaceId: string,
  runId: string,
  manifestSha256: string,
): Promise<AccountingRecord | undefined> {
  try {
    const marker = (await readJson(join(runDir, ACCOUNTING_MARKER_FILE))).value;
    if (!isValid(AccountingMarkerSchema, marker)) return undefined;
    if (
      marker.namespaceId !== namespaceId ||
      marker.runId !== runId ||
      marker.manifestSha256 !== manifestSha256
    )
      return undefined;
    if (marker.file.relativePath !== ACCOUNTING_FILE) return undefined;
    const { bytes, value } = await readJson(join(runDir, ACCOUNTING_FILE));
    if (bytes.byteLength !== marker.file.bytes || sha256(bytes) !== marker.file.sha256)
      return undefined;
    if (!isValid(AccountingSchema, value)) return undefined;
    if (
      value.namespaceId !== namespaceId ||
      value.runId !== runId ||
      value.manifestSha256 !== manifestSha256
    )
      return undefined;
    return value;
  } catch {
    return undefined;
  }
}
