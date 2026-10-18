// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// P3 fixture store: exact-keyed replay lookup with occurrence identity,
// fail-closed misses and load-time integrity verification. Complete replay is
// not fetch-only replay (C30): records may freeze model, fetch, catalogue and
// suggestion responses, citations, per-attempt usage, errors and timing.
//
// Semantics fixed by the frozen contract:
// - Keys include scenario, operation node and occurrence, so repeated
//   identical calls do not collapse (C30).
// - One fixture occurrence is one transport attempt; a lookup that reuses an
//   already-consumed key, requests an unrecorded occurrence, or presents a
//   request whose canonical bytes differ from the recorded ones is a MISS.
// - A miss invalidates/stops that replay block and never falls back live.
//   Unused fixtures are skipped (policy-cancelled sequences), not misses
//   (deadline METHOD, Development and Replay).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { canonicalJson, normaliseByBindings, requestSha256, sha256Canonical, type RequestBinding } from "./canonical.js";
import type { FixtureKey, FixtureRecord, Json, ReplayStore } from "./contracts.js";

export const FIXTURE_FILE_SCHEMA_VERSION = 1;

/** Wire format of a versioned fixture file consumed by {@link loadReplayStore}. */
export interface FixtureFile {
  readonly schemaVersion: typeof FIXTURE_FILE_SCHEMA_VERSION;
  readonly kind: "intelli-benchmark-fixtures";
  readonly scenario: string;
  readonly bindings?: readonly RequestBinding[];
  readonly fixtures: readonly FixtureRecord[];
}

/** Thrown for a fail-closed replay miss or an invalid fixture file. */
export class ReplayMissError extends Error {
  readonly key: FixtureKey | null;
  readonly reason:
    | "not-found"
    | "request-mismatch"
    | "already-consumed"
    | "invalid-file";
  constructor(reason: ReplayMissError["reason"], message: string, key: FixtureKey | null = null) {
    super(message);
    this.name = "ReplayMissError";
    this.reason = reason;
    this.key = key;
  }
}

function keyId(key: FixtureKey): string {
  return `${key.boundary}\u0000${key.scenario}\u0000${key.operationNode}\u0000${key.requestSha256}\u0000${key.occurrence}`;
}

/** Thrown by fixture-file validation when the file fails closed. */
export class InvalidFixtureFileError extends ReplayMissError {
  constructor(message: string) {
    super("invalid-file", message, null);
    this.name = "InvalidFixtureFileError";
  }
}

/**
 * Verifies a fixture set at load time: schema version, per-record
 * contentSha256 against canonical(response ?? null), per-record key hash
 * against the binding-normalised canonical request, and key uniqueness.
 * Declared binding maps are structural (name + paths); recorded capturedValue
 * is audit metadata and never used to rewrite request bytes.
 */
export function verifyFixtureFile(file: FixtureFile): readonly RequestBinding[] {
  if (file.schemaVersion !== FIXTURE_FILE_SCHEMA_VERSION || file.kind !== "intelli-benchmark-fixtures") {
    throw new InvalidFixtureFileError(`Unsupported fixture file header: schemaVersion=${String(file.schemaVersion)}`);
  }
  if (typeof file.scenario !== "string" || file.scenario === "") {
    throw new InvalidFixtureFileError("Fixture file scenario must be a nonempty string");
  }
  const bindings = file.bindings ?? [];
  const seen = new Set<string>();
  for (const [index, record] of file.fixtures.entries()) {
    const at = `fixtures[${index}]`;
    if (record.key.scenario !== file.scenario) {
      throw new InvalidFixtureFileError(`${at}: key scenario "${record.key.scenario}" does not match file scenario "${file.scenario}"`);
    }
    if (record.key.occurrence < 1) {
      throw new InvalidFixtureFileError(`${at}: occurrence must be a positive integer`);
    }
    if (record.error === undefined && record.response === undefined) {
      throw new InvalidFixtureFileError(`${at}: record must freeze either a response or an error`);
    }
    if (typeof record.delayMs !== "number" || !Number.isFinite(record.delayMs) || record.delayMs < 0) {
      throw new InvalidFixtureFileError(`${at}: delayMs must be a finite nonnegative number`);
    }
    const expectedContent = sha256Canonical(record.response ?? null);
    if (record.contentSha256 !== expectedContent) {
      throw new InvalidFixtureFileError(`${at}: contentSha256 mismatch (expected ${expectedContent})`);
    }
    const expectedRequest = requestSha256(record.request, bindings);
    if (record.key.requestSha256 !== expectedRequest) {
      throw new InvalidFixtureFileError(`${at}: key requestSha256 mismatch (expected ${expectedRequest})`);
    }
    const id = keyId(record.key);
    if (seen.has(id)) throw new InvalidFixtureFileError(`${at}: duplicate fixture key ${canonicalJson(record.key)}`);
    seen.add(id);
  }
  return bindings;
}

/**
 * An in-memory {@link ReplayStore} over verified fixture records. Lookups are
 * occurrence-exact and request-exact; every failure mode is a recorded miss
 * that throws {@link ReplayMissError}. `unconsumed()` is a benchmark-side
 * addition for skipped-sequence labelling; it is additive to the frozen
 * interface.
 */
export interface BenchmarkReplayStore extends ReplayStore {
  /** Fixture keys never served; callers label these skipped, not missed. */
  unconsumed(): readonly FixtureKey[];
}

export function createReplayStore(input: {
  readonly fixtures: readonly FixtureRecord[];
  readonly bindings?: readonly RequestBinding[];
  readonly scenario: string;
}): BenchmarkReplayStore {
  const bindings = input.bindings ?? [];
  const byKey = new Map<string, FixtureRecord>();
  const consumedKeys: FixtureKey[] = [];
  const consumedIds = new Set<string>();
  const misses: FixtureKey[] = [];
  verifyFixtureFile({
    schemaVersion: FIXTURE_FILE_SCHEMA_VERSION,
    kind: "intelli-benchmark-fixtures",
    scenario: input.scenario,
    bindings,
    fixtures: input.fixtures,
  });
  for (const record of input.fixtures) byKey.set(keyId(record.key), record);

  const store: BenchmarkReplayStore = {
    async lookup(key, request) {
      const callerHash = requestSha256(request, bindings);
      if (callerHash !== key.requestSha256) {
        misses.push(key);
        throw new ReplayMissError(
          "request-mismatch",
          `Replay miss: caller key hash ${key.requestSha256} does not match its own request hash ${callerHash}`,
          key,
        );
      }
      const id = keyId(key);
      const record = byKey.get(id);
      if (record === undefined) {
        misses.push(key);
        throw new ReplayMissError(
          "not-found",
          `Replay miss: no fixture recorded for ${key.boundary}/${key.scenario}/${key.operationNode} occurrence ${key.occurrence} (hash ${key.requestSha256.slice(0, 12)}…)`,
          key,
        );
      }
      // Key hash equality plus full canonical equality of the normalised
      // requests: a colliding key with different normalised bytes still fails
      // closed. Only declared binding paths are normalised (C30).
      if (canonicalJson(normaliseByBindings(request, bindings)) !== canonicalJson(normaliseByBindings(record.request, bindings))) {
        misses.push(key);
        throw new ReplayMissError(
          "request-mismatch",
          "Replay miss: canonical request bytes differ from the recorded fixture request",
          key,
        );
      }
      if (consumedIds.has(id)) {
        misses.push(key);
        throw new ReplayMissError(
          "already-consumed",
          `Replay miss: fixture occurrence already consumed for ${key.operationNode} occurrence ${key.occurrence}; repeated identical calls must use distinct occurrences`,
          key,
        );
      }
      consumedIds.add(id);
      consumedKeys.push(key);
      return record;
    },
    consumed: () => [...consumedKeys],
    misses: () => [...misses],
    unconsumed: () =>
      [...byKey.values()].map((record) => record.key).filter((key) => !consumedIds.has(keyId(key))),
    assertValid() {
      if (misses.length > 0) {
        const detail = misses
          .map((key) => `${key.boundary}/${key.scenario}/${key.operationNode}/occ-${key.occurrence}`)
          .join(", ");
        throw new ReplayMissError("not-found", `Replay block invalid after ${misses.length} miss(es): ${detail}`);
      }
    },
  };
  return store;
}

/** Parses and verifies a fixture file from disk. Fails closed on any defect. */
export async function loadFixtureFile(path: string): Promise<FixtureFile> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new InvalidFixtureFileError(`Cannot read fixture file ${path}: ${String(error)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new InvalidFixtureFileError(`Fixture file ${path} is not valid JSON: ${String(error)}`);
  }
  const file = parsed as FixtureFile;
  verifyFixtureFile(file);
  return file;
}

/** Loads a verified fixture file into a replay store. */
export async function loadReplayStore(path: string): Promise<BenchmarkReplayStore> {
  const file = await loadFixtureFile(path);
  return createReplayStore({ fixtures: file.fixtures, bindings: file.bindings ?? [], scenario: file.scenario });
}

/** Writes a fixture file atomically (temp file then rename in the same directory). */
export async function saveFixtureFile(path: string, file: FixtureFile): Promise<void> {
  verifyFixtureFile(file);
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temp, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  const { rename } = await import("node:fs/promises");
  await rename(temp, path);
}

/**
 * Capture-side recorder for synthetic fixture generation and later approved
 * live capture. Assigns occurrence = 1 + number of already-recorded fixtures
 * with the same (boundary, scenario, operationNode, request hash), so
 * repeated identical calls keep distinct ordered occurrences (C30). The
 * submission order for identical calls is fixed by the forced workflow; the
 * recorder never reorders or merges them.
 */
export interface FixtureRecorder {
  record(
    operationNode: string,
    request: Json,
    outcome: {
      readonly response?: Json;
      readonly error?: { readonly kind: string; readonly message: string };
      readonly usage?: FixtureRecord["usage"];
      readonly delayMs: number;
    },
  ): FixtureRecord;
  records(): readonly FixtureRecord[];
  toFile(): FixtureFile;
}

export function createFixtureRecorder(input: {
  readonly boundary: FixtureKey["boundary"];
  readonly scenario: string;
  readonly bindings?: readonly RequestBinding[];
}): FixtureRecorder {
  const records: FixtureRecord[] = [];
  const occurrenceCounts = new Map<string, number>();
  return {
    record(operationNode, request, outcome) {
      const hash = requestSha256(request, input.bindings ?? []);
      const counterKey = `${input.boundary}\u0000${input.scenario}\u0000${operationNode}\u0000${hash}`;
      const occurrence = (occurrenceCounts.get(counterKey) ?? 0) + 1;
      occurrenceCounts.set(counterKey, occurrence);
      const key: FixtureKey = {
        boundary: input.boundary,
        scenario: input.scenario,
        operationNode,
        requestSha256: hash,
        occurrence,
      };
      const record: FixtureRecord = {
        key,
        request,
        ...(outcome.response !== undefined ? { response: outcome.response } : {}),
        ...(outcome.error !== undefined ? { error: outcome.error } : {}),
        ...(outcome.usage !== undefined ? { usage: outcome.usage } : {}),
        delayMs: outcome.delayMs,
        contentSha256: sha256Canonical(outcome.response ?? null),
      };
      records.push(record);
      return record;
    },
    records: () => [...records],
    toFile: () => ({
      schemaVersion: FIXTURE_FILE_SCHEMA_VERSION,
      kind: "intelli-benchmark-fixtures",
      scenario: input.scenario,
      ...(input.bindings ? { bindings: input.bindings } : {}),
      fixtures: [...records],
    }),
  };
}
