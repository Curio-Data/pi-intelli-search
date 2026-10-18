// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// Operation-scoped run store for `<cacheRoot>/.intelli-v1/` (C21-C25).
// Allocation appends a synced checksum-chained journal record under the kernel
// writer lock before granting a reservation; publication is the atomic rename
// of `committed.json` into the uniquely owned run directory. Expected I/O and
// protocol failures return the explicit unavailable union; nothing here
// deletes, truncates, rotates or replaces existing runs or metadata.

import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { setImmediate as yieldTurn } from "node:timers/promises";
import type {
  AccountingSummary,
  AllocateInput,
  Allocation,
  Artifact,
  AttemptRecord,
  CommittedRun,
  Diagnostic,
  IndexCandidate,
  RunReservation,
  RunStore,
  RunStoreOptions,
} from "./execution-contracts.js";
import {
  ACCOUNTING_FILE,
  ACCOUNTING_MARKER_FILE,
  INDEX_FILE,
  JOURNAL_FILE,
  JOURNAL_MAX_BYTES,
  JOURNAL_RECORD_MAX_BYTES,
  JOURNAL_YIELD_RECORDS,
  MARKER_FILE,
  NAMESPACE_DIR,
  NAMESPACE_FILE,
  RESERVATION_FILE,
  RUNS_DIR,
  ZERO_HASH,
  allocationHash,
  canonicalJson,
  compatibilityKeyFor,
  displayLabel,
  encodeRecord,
  isSafeRelativePath,
  isUtc,
  sha256,
  utcDateOf,
  type AccountingMarker,
  type AccountingRecord,
  type AllocationRecord,
  type CommittedMarker,
  type IndexEntry,
  type IndexRecord,
  type NamespaceRecord,
  type ReservationRecord,
} from "./run-format.js";
import {
  StoreError,
  describe,
  errorCode,
  checkRunIdentity,
  hasStructuralRecord,
  listRunNames,
  readNamespace,
  syncDirectory,
  validateJournal,
  verifyCommittedRun,
  writeNewFileDurable,
  type JournalState,
} from "./run-journal.js";
import { readRunIndex, rebuildIndexEntries, selectCandidates } from "./run-index.js";
import {
  acquireWriterLock,
  loadNativeLockBinding,
  writeOwnerDiagnostic,
  type HeldLock,
  type LockBindingLoader,
} from "./run-lock.js";

/** C22: exclusive directory creation retries before persistence is unavailable. */
export const MAX_RUN_ID_COLLISIONS = 16;
/** Up to 16 random bytes as hex; with the 71-character label the run ID stays within the 128-character schema. */
const NONCE = /^[0-9a-f]{8,32}$/;
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
/** Private temporary names and namespace identity never use the injected run-ID source. */
const tempNonce = () => randomBytes(8).toString("hex");

/** Named crash/fault boundaries for deterministic and independent-process tests. */
export type FaultPoint =
  | "lock-acquired"
  | "after-run-mkdir"
  | "after-journal-write"
  | "after-journal-sync"
  | "after-reservation"
  | "after-artifacts"
  | "before-marker-rename"
  | "after-marker-rename"
  | "before-index-rename"
  | "before-accounting-marker-rename";

export interface RunStoreHooks {
  readonly loadLockBinding?: LockBindingLoader;
  readonly fault?: (point: FaultPoint) => void | Promise<void>;
}

type CommitResult =
  | { readonly status: "committed"; readonly run: CommittedRun }
  | { readonly status: "unavailable"; readonly diagnostic: Diagnostic };
type AccountingResult =
  | { readonly status: "recorded"; readonly path: string }
  | { readonly status: "unavailable"; readonly diagnostic: Diagnostic };

interface OwnedRun {
  readonly reservation: RunReservation;
  readonly query: string;
  readonly operationId: string;
  readonly allocationHash: string;
  state: "allocated" | "committing" | "committed" | "failed";
  run?: CommittedRun;
  accounting: "none" | "writing" | "recorded" | "failed";
}

function unavailable(
  code: string,
  message: string,
): { readonly status: "unavailable"; readonly diagnostic: Diagnostic } {
  return { status: "unavailable", diagnostic: { code, message } };
}

function asUnavailable(error: unknown, fallback: string, context: string) {
  if (error instanceof StoreError) return unavailable(error.code, error.message);
  return unavailable(fallback, `${context}: ${describe(error)}`);
}

export function createRunStore(options: RunStoreOptions): RunStore {
  return createRunStoreWithHooks(options, {});
}

/** Test seam: inject the lock backend loader and named fault boundaries. */
export function createRunStoreWithHooks(options: RunStoreOptions, hooks: RunStoreHooks): RunStore {
  const namespaceDir = join(options.cacheRoot, NAMESPACE_DIR);
  const runsDir = join(namespaceDir, RUNS_DIR);
  const displayNamespace = join(options.displayRoot, NAMESPACE_DIR);
  const loadBinding = hooks.loadLockBinding ?? loadNativeLockBinding;
  const fault = async (point: FaultPoint) => {
    await hooks.fault?.(point);
  };
  const owned = new Map<string, OwnedRun>();
  const pending = new Set<Promise<unknown>>();

  function track<T>(work: () => Promise<T>): Promise<T> {
    const promise = work();
    pending.add(promise);
    void promise.then(
      () => pending.delete(promise),
      () => pending.delete(promise),
    );
    return promise;
  }

  function nextNonce(): string {
    const nonce = options.randomId();
    if (typeof nonce !== "string" || !NONCE.test(nonce))
      throw new StoreError(
        "INVALID_NONCE",
        "Run ID source returned a value that is not 8-32 lowercase hexadecimal characters",
      );
    return nonce;
  }

  async function withLock<T>(
    signal: AbortSignal,
    purpose: "allocate" | "index",
    operationId: string | undefined,
    body: (lock: HeldLock) => Promise<T>,
  ): Promise<T> {
    if (!isAbsolute(options.cacheRoot))
      throw new StoreError("INVALID_ROOT", "Cache root must be absolute");
    try {
      await mkdir(options.cacheRoot, { recursive: true });
      await mkdir(namespaceDir);
    } catch (error) {
      if (errorCode(error) !== "EEXIST")
        throw new StoreError("NAMESPACE_IO", `Cannot create ${namespaceDir}: ${describe(error)}`);
    }
    const info = await lstat(namespaceDir);
    if (!info.isDirectory())
      throw new StoreError("NAMESPACE_INVALID", `${namespaceDir} is not a directory`);
    const acquired = await acquireWriterLock({
      namespaceDir,
      clock: options.clock,
      signal,
      loadBinding,
    });
    if (acquired.status !== "acquired")
      throw new StoreError(acquired.diagnostic.code, acquired.diagnostic.message);
    try {
      const wrote = await writeOwnerDiagnostic(
        namespaceDir,
        {
          schema: "intelli-v1/writer-owner",
          schemaVersion: 1,
          pid: process.pid,
          acquiredUtc: options.clock.utcIso(),
          purpose,
          ...(operationId && operationId.length <= 256 ? { operationId } : {}),
        },
        tempNonce(),
      );
      if (!wrote)
        options.onDiagnostic({
          code: "OWNER_DIAGNOSTIC_SKIPPED",
          message: "Writer owner diagnostics could not be written; ownership is unaffected",
        });
      await fault("lock-acquired");
      return await body(acquired.lock);
    } finally {
      await acquired.lock.release();
    }
  }

  /**
   * Validate identity and allocation history under the lock. A missing journal
   * is initialisable only when there is no namespace identity, no journalled
   * history and no run directory at all; otherwise history is unknown.
   */
  async function openNamespace(
    signal: AbortSignal,
  ): Promise<{ namespace: NamespaceRecord; journal: JournalState }> {
    const namespace = await readNamespace(namespaceDir);
    if (namespace) {
      const journal = await validateJournal(namespaceDir, namespace.namespaceId, "writer", signal);
      const names = (await listRunNames(namespaceDir)) ?? [];
      let checked = 0;
      for (const name of names) {
        if (++checked % JOURNAL_YIELD_RECORDS === 0) {
          await yieldTurn();
          if (signal.aborted)
            throw new StoreError("ABORTED", "Cancelled while validating run identities");
        }
        const record = journal.records.get(name);
        if (record) {
          // C23: journal, reservation and committed identities are checked together.
          const conflict = await checkRunIdentity(
            namespaceDir,
            namespace.namespaceId,
            name,
            record,
          );
          if (conflict)
            throw new StoreError(
              "RUN_IDENTITY_CONFLICT",
              `Run ${join(runsDir, name)} conflicts with its allocation journal record (${conflict}); publication is unavailable until an operator stops all writers, preserves the namespace and validates it.`,
            );
          continue;
        }
        if (await hasStructuralRecord(join(runsDir, name)))
          throw new StoreError(
            "UNJOURNALLED_RUN",
            `Run directory ${join(runsDir, name)} has content but no allocation journal record; publication is unavailable until an operator validates the namespace.`,
          );
      }
      return { namespace, journal };
    }
    const journalPath = join(namespaceDir, JOURNAL_FILE);
    try {
      const journalInfo = await lstat(journalPath);
      if (!journalInfo.isFile() || journalInfo.size > 0)
        throw new StoreError(
          "NAMESPACE_MISSING",
          `Namespace identity ${join(namespaceDir, NAMESPACE_FILE)} is missing but allocation history exists; history requires operator recovery.`,
        );
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
    const names = await listRunNames(namespaceDir);
    if (names && names.length > 0)
      throw new StoreError(
        "NAMESPACE_MISSING",
        `Namespace identity is missing but ${runsDir} contains runs; it is not provably fresh.`,
      );
    // Fresh namespace: empty journal first, then identity, then runs/. Every
    // crash point leaves a state this function re-initialises or accepts.
    try {
      const handle = await open(
        journalPath,
        constants.O_WRONLY | constants.O_CREAT | NOFOLLOW,
        0o600,
      );
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      await syncDirectory(namespaceDir);
      const created: NamespaceRecord = {
        schema: "intelli-v1/namespace",
        schemaVersion: 1,
        namespaceId: randomBytes(16).toString("hex"),
        createdUtc: options.clock.utcIso(),
      };
      if (!isUtc(created.createdUtc))
        throw new StoreError("INVALID_CLOCK", "The configured clock did not return a UTC ISO time");
      const temp = join(namespaceDir, `.${NAMESPACE_FILE}.${tempNonce()}.tmp`);
      await writeNewFileDurable(temp, encodeRecord(created));
      await rename(temp, join(namespaceDir, NAMESPACE_FILE));
      await mkdir(runsDir, { recursive: true });
      await syncDirectory(namespaceDir);
      return { namespace: created, journal: { records: new Map(), bytes: 0 } };
    } catch (error) {
      if (error instanceof StoreError) throw error;
      throw new StoreError(
        "DURABILITY_UNAVAILABLE",
        `Cannot durably initialise ${namespaceDir}: ${describe(error)}`,
      );
    }
  }

  async function allocateLocked(input: AllocateInput): Promise<Allocation> {
    const compatibilityKey = compatibilityKeyFor(input.query, utcDateOf(input.startedUtc));
    const label = displayLabel(input.query, input.startedUtc);
    return withLock(input.signal, "allocate", input.operationId, async () => {
      const { namespace, journal } = await openNamespace(input.signal);
      const last = journal.last;
      const sequence = (last?.sequence ?? 0) + 1;
      if (!Number.isSafeInteger(sequence))
        throw new StoreError(
          "SEQUENCE_EXHAUSTED",
          "Allocation sequence would exceed the safe integer range",
        );
      let runId: string | undefined;
      for (let attempt = 0; attempt < MAX_RUN_ID_COLLISIONS; attempt++) {
        if (input.signal.aborted)
          throw new StoreError("ABORTED", "Cancelled during run allocation");
        const candidate = `${label}-${nextNonce()}`;
        try {
          await mkdir(join(runsDir, candidate));
          runId = candidate;
          break;
        } catch (error) {
          if (errorCode(error) !== "EEXIST")
            throw new StoreError(
              "RUN_DIR_IO",
              `Cannot create run directory under ${runsDir}: ${describe(error)}`,
            );
        }
      }
      if (!runId)
        throw new StoreError(
          "RUN_ID_COLLISIONS",
          `Run directory creation collided ${MAX_RUN_ID_COLLISIONS} times under ${runsDir}; persistence is unavailable for this answer.`,
        );
      await fault("after-run-mkdir");
      if (input.signal.aborted)
        throw new StoreError("ABORTED", "Cancelled before the admission record");
      const body: Omit<AllocationRecord, "hash"> = {
        schema: "intelli-v1/allocation",
        schemaVersion: 1,
        namespaceId: namespace.namespaceId,
        sequence,
        runId,
        operationId: input.operationId,
        compatibilityKey,
        startedUtc: input.startedUtc,
        previousHash: last?.hash ?? ZERO_HASH,
      };
      const record: AllocationRecord = { ...body, hash: allocationHash(body) };
      const line = encodeRecord(record);
      if (line.byteLength > JOURNAL_RECORD_MAX_BYTES)
        throw new StoreError(
          "JOURNAL_RECORD_TOO_LARGE",
          `Allocation record would exceed ${JOURNAL_RECORD_MAX_BYTES} bytes`,
        );
      if (journal.bytes + line.byteLength > JOURNAL_MAX_BYTES)
        throw new StoreError(
          "JOURNAL_CEILING",
          `Allocation journal would exceed the ${JOURNAL_MAX_BYTES}-byte safety ceiling; no automatic compaction or reset exists, so publication is unavailable until an operator archives the namespace.`,
        );
      const journalPath = join(namespaceDir, JOURNAL_FILE);
      try {
        const handle = await open(journalPath, constants.O_WRONLY | constants.O_APPEND | NOFOLLOW);
        try {
          let offset = 0;
          while (offset < line.byteLength) {
            const { bytesWritten } = await handle.write(line, offset, line.byteLength - offset);
            offset += bytesWritten;
          }
          await fault("after-journal-write");
          await handle.sync();
        } finally {
          await handle.close();
        }
      } catch (error) {
        throw new StoreError(
          "JOURNAL_IO",
          `Cannot durably append to ${journalPath}: ${describe(error)}`,
        );
      }
      await fault("after-journal-sync");
      const runDir = join(runsDir, runId);
      const reservationRecord: ReservationRecord = {
        schema: "intelli-v1/reservation",
        schemaVersion: 1,
        namespaceId: namespace.namespaceId,
        sequence,
        runId,
        operationId: input.operationId,
        compatibilityKey,
        startedUtc: input.startedUtc,
        allocationHash: record.hash,
      };
      try {
        // Temporary file plus rename: a crash never leaves a partial
        // reservation that later allocations would read as a conflict.
        const temp = join(runDir, `.${RESERVATION_FILE}.${tempNonce()}.tmp`);
        await writeNewFileDurable(temp, encodeRecord(reservationRecord));
        await rename(temp, join(runDir, RESERVATION_FILE));
        await syncDirectory(runDir);
        await syncDirectory(runsDir);
      } catch (error) {
        throw new StoreError(
          "RESERVATION_IO",
          `Sequence ${sequence} was journalled but its reservation could not be made durable in ${runDir} (an allowed gap): ${describe(error)}`,
        );
      }
      await fault("after-reservation");
      const reservation: RunReservation = Object.freeze({
        namespaceId: namespace.namespaceId,
        runId,
        sequence,
        startedUtc: input.startedUtc,
        compatibilityKey,
        physicalPath: runDir,
        displayPath: join(displayNamespace, RUNS_DIR, runId),
      });
      owned.set(runId, {
        reservation,
        query: input.query,
        operationId: input.operationId,
        allocationHash: record.hash,
        state: "allocated",
        accounting: "none",
      });
      return { status: "allocated" as const, reservation };
    });
  }

  async function allocate(input: AllocateInput): Promise<Allocation> {
    if (
      typeof input.query !== "string" ||
      !isUtc(input.startedUtc) ||
      typeof input.operationId !== "string" ||
      input.operationId.length < 1 ||
      input.operationId.length > 256
    )
      return unavailable(
        "INVALID_INPUT",
        "Allocation requires a query, a 1-256 character operation ID and a UTC ISO start time",
      );
    try {
      return await allocateLocked(input);
    } catch (error) {
      const result = asUnavailable(
        error,
        "ALLOCATION_IO",
        `Run allocation under ${namespaceDir} failed`,
      );
      options.onDiagnostic(result.diagnostic);
      return result;
    }
  }

  async function ensureDirectory(
    runDir: string,
    relative: string,
    created: Set<string>,
  ): Promise<void> {
    const parts = relative.split("/").slice(0, -1);
    let current = runDir;
    for (const part of parts) {
      current = join(current, part);
      try {
        await mkdir(current);
        created.add(current);
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
        const info = await lstat(current);
        if (!info.isDirectory())
          throw new StoreError("ARTIFACT_PATH", `${current} is not a directory`);
      }
    }
  }

  async function writeArtifact(
    target: string,
    artifact: Artifact,
    signal: AbortSignal,
  ): Promise<{ bytes: number; sha256: string }> {
    if ("bytes" in artifact) {
      await writeNewFileDurable(target, artifact.bytes);
      return { bytes: artifact.bytes.byteLength, sha256: sha256(artifact.bytes) };
    }
    const source = await open(artifact.stagedPath, constants.O_RDONLY | NOFOLLOW);
    try {
      const info = await source.stat();
      if (!info.isFile())
        throw new StoreError(
          "ARTIFACT_SOURCE",
          `Staged artefact ${artifact.stagedPath} is not a regular file`,
        );
      const handle = await open(
        target,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW,
        0o600,
      );
      try {
        const hash = createHash("sha256");
        const buffer = Buffer.allocUnsafe(65_536);
        let total = 0;
        for (;;) {
          if (signal.aborted)
            throw new StoreError("ABORTED", "Cancelled while streaming a staged artefact");
          const { bytesRead } = await source.read(buffer, 0, buffer.byteLength, null);
          if (bytesRead === 0) break;
          const chunk = buffer.subarray(0, bytesRead);
          let offset = 0;
          while (offset < chunk.byteLength)
            offset += (await handle.write(chunk, offset, chunk.byteLength - offset)).bytesWritten;
          hash.update(chunk);
          total += bytesRead;
        }
        await handle.sync();
        return { bytes: total, sha256: hash.digest("hex") };
      } finally {
        await handle.close();
      }
    } finally {
      await source.close();
    }
  }

  function validateArtifacts(artifacts: readonly Artifact[], query: string): string | undefined {
    const seen = new Set<string>();
    const structural: Record<string, string> = {
      report: "report.md",
      query: "query.txt",
      "manifest-data": "run.json",
    };
    const counts: Record<string, number> = {};
    for (const artifact of artifacts) {
      if (!isSafeRelativePath(artifact.relativePath))
        return `unsafe artefact path ${JSON.stringify(artifact.relativePath)}`;
      if (seen.has(artifact.relativePath))
        return `duplicate artefact path ${artifact.relativePath}`;
      seen.add(artifact.relativePath);
      counts[artifact.kind] = (counts[artifact.kind] ?? 0) + 1;
      const expected = structural[artifact.kind];
      if (expected && artifact.relativePath !== expected)
        return `${artifact.kind} must be ${expected}`;
      if (!expected && Object.values(structural).includes(artifact.relativePath))
        return `${artifact.relativePath} must have its structural kind`;
      if (!("bytes" in artifact) && artifact.kind in structural)
        return `${artifact.kind} must be supplied as bytes`;
    }
    for (const kind of Object.keys(structural))
      if (counts[kind] !== 1) return `exactly one ${kind} artefact is required`;
    const byKind = (kind: string) =>
      artifacts.find((a) => a.kind === kind) as Artifact & { bytes: Uint8Array };
    if (byKind("report").bytes.byteLength === 0)
      return "the report is empty; only successful nonempty reports are published";
    if (Buffer.from(byKind("query").bytes).toString("utf8") !== query)
      return "query.txt does not match the allocated query";
    try {
      const run = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(byKind("manifest-data").bytes),
      );
      if (typeof run !== "object" || run === null || Array.isArray(run))
        return "run.json must be a JSON object";
    } catch {
      return "run.json must be UTF-8 JSON";
    }
    return undefined;
  }

  async function commitOwned(
    entry: OwnedRun,
    artifacts: readonly Artifact[],
    signal: AbortSignal,
  ): Promise<CommitResult> {
    const { reservation } = entry;
    const runDir = reservation.physicalPath;
    const created = new Set<string>();
    const files: CommittedMarker["files"][number][] = [];
    const nonEvidence: CommittedMarker["nonEvidence"][number][] = [];
    for (const artifact of artifacts) {
      if (signal.aborted)
        throw new StoreError(
          "ABORTED",
          "Cancelled before publication; no committed marker was written",
        );
      await ensureDirectory(runDir, artifact.relativePath, created);
      const digest = await writeArtifact(join(runDir, artifact.relativePath), artifact, signal);
      if (artifact.kind === "late")
        nonEvidence.push({ relativePath: artifact.relativePath, ...digest });
      else files.push({ relativePath: artifact.relativePath, kind: artifact.kind, ...digest });
    }
    for (const dir of [...created].sort((a, b) => b.length - a.length)) await syncDirectory(dir);
    await syncDirectory(runDir);
    await fault("after-artifacts");
    if (signal.aborted)
      throw new StoreError(
        "ABORTED",
        "Cancelled before publication; no committed marker was written",
      );
    const marker: CommittedMarker = {
      schema: "intelli-v1/committed",
      schemaVersion: 1,
      namespaceId: reservation.namespaceId,
      runId: reservation.runId,
      admissionSequence: reservation.sequence,
      allocationHash: entry.allocationHash,
      compatibilityKey: reservation.compatibilityKey,
      query: entry.query,
      startedUtc: reservation.startedUtc,
      reportOutcome: "succeeded",
      files,
      nonEvidence,
    };
    const bytes = encodeRecord(marker);
    const temp = join(runDir, `.${MARKER_FILE}.${tempNonce()}.tmp`);
    await writeNewFileDurable(temp, bytes);
    try {
      await fault("before-marker-rename");
      // Last cancellation point before the linearisation rename.
      if (signal.aborted)
        throw new StoreError(
          "ABORTED",
          "Cancelled before publication; no committed marker was written",
        );
      try {
        await lstat(join(runDir, MARKER_FILE));
        throw new StoreError(
          "MARKER_EXISTS",
          `${join(runDir, MARKER_FILE)} already exists; an owned run is never replaced`,
        );
      } catch (error) {
        if (errorCode(error) !== "ENOENT") throw error;
      }
      await rename(temp, join(runDir, MARKER_FILE));
    } catch (error) {
      // The private unpublished temporary marker is not evidence.
      await unlink(temp).catch(() => undefined);
      throw error;
    }
    // Linearised: an abort from here on cannot roll the publication back.
    const run: CommittedRun = Object.freeze({
      reservation,
      files: Object.freeze(
        files.map((file) =>
          Object.freeze({
            relativePath: file.relativePath,
            sha256: file.sha256,
            bytes: file.bytes,
          }),
        ),
      ),
      manifestSha256: sha256(bytes),
    });
    try {
      await fault("after-marker-rename");
      await syncDirectory(runDir);
    } catch (error) {
      // The rename already published a valid marker; C22 keeps that committed
      // state. The frozen commit union has no diagnostic field, so durability
      // is reported through onDiagnostic, keyed by run ID.
      options.onDiagnostic({
        code: "MARKER_DURABILITY_UNPROVEN",
        message: `Run ${reservation.runId} is committed (its marker in ${runDir} is in place and valid), but the directory sync after publication failed (${describe(error)}); durability of the publication across power loss is unproven.`,
      });
    }
    entry.state = "committed";
    entry.run = run;
    return { status: "committed", run };
  }

  async function commit(
    reservation: RunReservation,
    artifacts: readonly Artifact[],
    signal: AbortSignal,
  ): Promise<CommitResult> {
    const entry = owned.get(reservation?.runId);
    if (!entry || entry.reservation !== reservation)
      return unavailable(
        "FOREIGN_RESERVATION",
        "This run store did not allocate the reservation; only the owning operation may publish it",
      );
    if (entry.state !== "allocated")
      return unavailable(
        "ALREADY_PUBLISHING",
        `Run ${reservation.runId} is ${entry.state}; an owned run is published at most once and never replaced`,
      );
    const invalid = validateArtifacts(artifacts, entry.query);
    if (invalid) {
      entry.state = "failed";
      return unavailable(
        "INVALID_ARTIFACTS",
        `Run ${reservation.runId} was not published: ${invalid}`,
      );
    }
    entry.state = "committing";
    try {
      return await commitOwned(entry, artifacts, signal);
    } catch (error) {
      if (entry.state === "committing") entry.state = "failed";
      const result = asUnavailable(
        error,
        "PUBLICATION_IO",
        `Run ${reservation.runId} was not published; its directory is preserved as uncommitted evidence`,
      );
      options.onDiagnostic(result.diagnostic);
      return result;
    }
  }

  async function writeIndex(namespaceId: string, entries: IndexEntry[]): Promise<void> {
    const index: IndexRecord = {
      schema: "intelli-v1/index",
      schemaVersion: 1,
      namespaceId,
      entries,
    };
    const temp = join(namespaceDir, `.${INDEX_FILE}.${tempNonce()}.tmp`);
    await writeNewFileDurable(temp, encodeRecord(index));
    try {
      await fault("before-index-rename");
      await rename(temp, join(namespaceDir, INDEX_FILE));
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      throw error;
    }
    await syncDirectory(namespaceDir);
  }

  /** Preserve corrupt secondary input by exclusive copy before any rewrite. */
  async function preserveCorruptIndex(): Promise<string | undefined> {
    const stamp = options.clock.utcIso().replace(/[^0-9TZ]/g, "");
    const target = join(namespaceDir, `index.corrupt-${stamp}-${tempNonce()}.json`);
    await copyFile(join(namespaceDir, INDEX_FILE), target, constants.COPYFILE_EXCL);
    return target;
  }

  async function updateIndexOwned(
    run: CommittedRun,
    query: string,
    signal: AbortSignal,
  ): Promise<"updated" | "unavailable"> {
    const entry = owned.get(run?.reservation?.runId);
    if (!entry || entry.run !== run || entry.state !== "committed") {
      options.onDiagnostic({
        code: "FOREIGN_RUN",
        message: "Only the operation that committed a run updates the index for it",
      });
      return "unavailable";
    }
    if (query !== entry.query) {
      options.onDiagnostic({
        code: "INDEX_QUERY_MISMATCH",
        message: `Index query differs from the committed query for ${run.reservation.runId}`,
      });
      return "unavailable";
    }
    try {
      await withLock(signal, "index", entry.operationId, async () => {
        const namespace = await readNamespace(namespaceDir);
        if (!namespace || namespace.namespaceId !== run.reservation.namespaceId)
          throw new StoreError("NAMESPACE_INVALID", "Namespace identity changed after publication");
        const read = await readRunIndex(namespaceDir, namespace.namespaceId);
        let entries: IndexEntry[];
        if (read.status === "valid" && read.index) entries = [...read.index.entries];
        else {
          if (read.status === "corrupt") {
            const preserved = await preserveCorruptIndex();
            options.onDiagnostic({
              code: "INDEX_REBUILT",
              message: `Corrupt run index preserved at ${preserved} (${read.detail}); rebuilt from verified committed runs`,
            });
          }
          const journal = await validateJournal(
            namespaceDir,
            namespace.namespaceId,
            "reader",
            signal,
          );
          const rebuilt = await rebuildIndexEntries(
            namespaceDir,
            namespace.namespaceId,
            journal.records,
            signal,
          );
          for (const reason of rebuilt.rejected)
            options.onDiagnostic({ code: "RUN_REJECTED", message: reason });
          entries = rebuilt.entries;
        }
        if (!entries.some((item) => item.runId === run.reservation.runId)) {
          entries.push({
            runId: run.reservation.runId,
            sequence: run.reservation.sequence,
            compatibilityKey: run.reservation.compatibilityKey,
            query,
            startedUtc: run.reservation.startedUtc,
            manifestSha256: run.manifestSha256,
          });
          entries.sort((a, b) => a.sequence - b.sequence);
        }
        await writeIndex(namespace.namespaceId, entries);
      });
      return "updated";
    } catch (error) {
      const diagnostic =
        error instanceof StoreError
          ? error.diagnostic
          : { code: "INDEX_IO", message: `Run index update failed: ${describe(error)}` };
      options.onDiagnostic({
        code: diagnostic.code,
        message: `${diagnostic.message}. The committed report is preserved.`,
      });
      return "unavailable";
    }
  }

  async function recordAccountingOwned(
    run: CommittedRun,
    records: readonly AttemptRecord[],
    summary: AccountingSummary,
    signal: AbortSignal,
  ): Promise<AccountingResult> {
    const entry = owned.get(run?.reservation?.runId);
    if (!entry || entry.run !== run || entry.state !== "committed")
      return unavailable(
        "FOREIGN_RUN",
        "Only the operation that committed a run records its accounting",
      );
    if (entry.accounting !== "none")
      return unavailable("ACCOUNTING_EXISTS", "Accounting is immutable and recorded at most once");
    if (signal.aborted) return unavailable("ABORTED", "No accounting write starts after abort");
    entry.accounting = "writing";
    const runDir = run.reservation.physicalPath;
    try {
      const accounting: AccountingRecord = {
        schema: "intelli-v1/accounting",
        schemaVersion: 1,
        namespaceId: run.reservation.namespaceId,
        runId: run.reservation.runId,
        manifestSha256: run.manifestSha256,
        coverage: "all-model-work-settled",
        attempts: JSON.parse(canonicalJson(records)),
        summary: JSON.parse(canonicalJson(summary)),
      };
      const bytes = encodeRecord(accounting);
      await writeNewFileDurable(join(runDir, ACCOUNTING_FILE), bytes);
      if (signal.aborted)
        throw new StoreError(
          "ABORTED",
          "Cancelled before the accounting marker; accounting.json is not accepted without it",
        );
      const marker: AccountingMarker = {
        schema: "intelli-v1/accounting-committed",
        schemaVersion: 1,
        namespaceId: run.reservation.namespaceId,
        runId: run.reservation.runId,
        manifestSha256: run.manifestSha256,
        file: { relativePath: ACCOUNTING_FILE, bytes: bytes.byteLength, sha256: sha256(bytes) },
      };
      const temp = join(runDir, `.${ACCOUNTING_MARKER_FILE}.${tempNonce()}.tmp`);
      await writeNewFileDurable(temp, encodeRecord(marker));
      try {
        await fault("before-accounting-marker-rename");
        if (signal.aborted)
          throw new StoreError(
            "ABORTED",
            "Cancelled before the accounting marker; accounting.json is not accepted without it",
          );
        await rename(temp, join(runDir, ACCOUNTING_MARKER_FILE));
      } catch (error) {
        await unlink(temp).catch(() => undefined);
        throw error;
      }
      await syncDirectory(runDir);
      entry.accounting = "recorded";
      return { status: "recorded", path: join(run.reservation.displayPath, ACCOUNTING_FILE) };
    } catch (error) {
      entry.accounting = "failed";
      const result = asUnavailable(
        error,
        "ACCOUNTING_IO",
        `Accounting for ${run.reservation.runId} was not recorded; the report and returned usage are unaffected`,
      );
      options.onDiagnostic(result.diagnostic);
      return result;
    }
  }

  async function candidatesFor(
    current: RunReservation | undefined,
    query: string,
    signal: AbortSignal,
  ): Promise<readonly IndexCandidate[]> {
    const currentKey =
      current?.compatibilityKey ?? compatibilityKeyFor(query, utcDateOf(options.clock.utcIso()));
    return selectCandidates({
      cacheRoot: options.cacheRoot,
      displayRoot: options.displayRoot,
      namespaceDir,
      currentKey,
      signal,
      onDiagnostic: options.onDiagnostic,
    });
  }

  return {
    allocate: (input) => track(() => allocate(input)),
    commit: (reservation, artifacts, signal) => track(() => commit(reservation, artifacts, signal)),
    updateIndex: (run, query, signal) => track(() => updateIndexOwned(run, query, signal)),
    recordAccounting: (run, records, summary, signal) =>
      track(() => recordAccountingOwned(run, records, summary, signal)),
    candidates: (current, query, signal) => track(() => candidatesFor(current, query, signal)),
    async settle() {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },
  };
}

/**
 * Explicit operator repair of secondary metadata only: with all writers
 * stopped, preserve the existing index (if any) and rebuild it from verified
 * committed runs under the same stable writer lock. Journal damage is never
 * repaired here; allocation history is not reset.
 */
export async function rebuildRunIndex(
  options: RunStoreOptions,
  signal: AbortSignal,
  hooks: RunStoreHooks = {},
): Promise<
  | {
      readonly status: "rebuilt";
      readonly entries: number;
      readonly preserved?: string;
      readonly rejected: readonly string[];
    }
  | { readonly status: "unavailable"; readonly diagnostic: Diagnostic }
> {
  const namespaceDir = join(options.cacheRoot, NAMESPACE_DIR);
  try {
    const info = await lstat(namespaceDir);
    if (!info.isDirectory())
      return unavailable("NAMESPACE_INVALID", `${namespaceDir} is not a directory`);
  } catch (error) {
    return unavailable(
      "NAMESPACE_MISSING",
      `${namespaceDir} cannot be inspected: ${describe(error)}`,
    );
  }
  const acquired = await acquireWriterLock({
    namespaceDir,
    clock: options.clock,
    signal,
    loadBinding: hooks.loadLockBinding ?? loadNativeLockBinding,
  });
  if (acquired.status !== "acquired") return acquired;
  try {
    const namespace = await readNamespace(namespaceDir);
    if (!namespace)
      return unavailable(
        "NAMESPACE_MISSING",
        `${join(namespaceDir, NAMESPACE_FILE)} is missing; nothing is rebuilt`,
      );
    const journal = await validateJournal(namespaceDir, namespace.namespaceId, "writer", signal);
    let preserved: string | undefined;
    try {
      await lstat(join(namespaceDir, INDEX_FILE));
      const stamp = options.clock.utcIso().replace(/[^0-9TZ]/g, "");
      preserved = join(namespaceDir, `index.preserved-${stamp}-${tempNonce()}.json`);
      await copyFile(join(namespaceDir, INDEX_FILE), preserved, constants.COPYFILE_EXCL);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
    const rebuilt = await rebuildIndexEntries(
      namespaceDir,
      namespace.namespaceId,
      journal.records,
      signal,
    );
    const index: IndexRecord = {
      schema: "intelli-v1/index",
      schemaVersion: 1,
      namespaceId: namespace.namespaceId,
      entries: rebuilt.entries,
    };
    const temp = join(namespaceDir, `.${INDEX_FILE}.${tempNonce()}.tmp`);
    await writeNewFileDurable(temp, encodeRecord(index));
    await rename(temp, join(namespaceDir, INDEX_FILE));
    await syncDirectory(namespaceDir);
    return {
      status: "rebuilt",
      entries: rebuilt.entries.length,
      preserved,
      rejected: rebuilt.rejected,
    };
  } catch (error) {
    return asUnavailable(error, "INDEX_IO", `Index rebuild under ${namespaceDir} failed`);
  } finally {
    await acquired.lock.release();
  }
}

export { verifyCommittedRun };
