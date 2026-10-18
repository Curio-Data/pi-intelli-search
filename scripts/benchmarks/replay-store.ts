// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// P3 fixture store: exact-keyed replay lookup with occurrence identity,
// fail-closed misses and load-time integrity verification. Complete replay is
// not fetch-only replay (C30): records may freeze model, fetch, catalogue and
// suggestion responses, citations, per-attempt usage, errors and timing.
//
// Semantics fixed by the frozen contract:
// - Keys include scenario, operation node and occurrence, so repeated
//   identical calls do not collapse (C30). Occurrences are served strictly in
//   order: occurrence k is servable only after occurrence k-1 of the same key
//   family is consumed; an out-of-order or reused lookup is a MISS that
//   invalidates the block (C30 "ambiguous/mismatched occurrence invalidates
//   the block").
// - One fixture occurrence is one transport attempt; a lookup that reuses an
//   already-consumed key, requests an unrecorded occurrence, or presents a
//   request whose canonical bytes differ from the recorded ones is a MISS.
// - A miss never falls back live. Unused fixtures are skipped (policy-
//   cancelled sequences), not misses (deadline METHOD).
// - `contentSha256` covers the WHOLE frozen record payload: a canonical
//   object of { response, error, usage, delayMs }. Usage feeds ledger and
//   cost endpoints, error text drives the retry classifier and delayMs drives
//   replay timing, so tampering with any of them fails file verification.
// - Bindings may normalise only generated identity/path fields. Paths rooted
//   at the frozen request fields themselves are rejected: a binding on
//   `userMessage`, `systemPrompt` or `url` would wildcard the content the
//   fixture is meant to freeze exactly.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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

/**
 * Whole-record content digest: sha256 of the canonical serialisation of the
 * frozen outcome payload. This is the preimage of `FixtureRecord.contentSha256`.
 */
export function recordContentSha256(record: {
  readonly response?: Json;
  readonly error?: { readonly kind: string; readonly message: string };
  readonly usage?: FixtureRecord["usage"];
  readonly delayMs: number;
}): string {
  return sha256Canonical({
    response: record.response ?? null,
    error: record.error ?? null,
    usage: record.usage ?? null,
    delayMs: record.delayMs,
  });
}

/** Thrown for a fail-closed replay miss or an invalid fixture file. */
export class ReplayMissError extends Error {
  readonly key: FixtureKey | null;
  readonly reason:
    | "not-found"
    | "request-mismatch"
    | "already-consumed"
    | "out-of-order"
    | "ambiguous-node"
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

function keyFamilyId(key: FixtureKey): string {
  return `${key.boundary}\u0000${key.scenario}\u0000${key.operationNode}\u0000${key.requestSha256}`;
}

/** Thrown by fixture-file validation when the file fails closed. */
export class InvalidFixtureFileError extends ReplayMissError {
  constructor(message: string) {
    super("invalid-file", message, null);
    this.name = "InvalidFixtureFileError";
  }
}

// Frozen request fields that bindings must never wildcard, per boundary. A
// binding whose first path segment is one of these fields replaces the very
// content the fixture identity must freeze exactly (L2).
const MODEL_FORBIDDEN_BINDING_ROOTS = new Set([
  "model",
  "role",
  "systemPrompt",
  "userMessage",
  "maxTokens",
  "reasoning",
  "effectivePayloadPatch",
]);
const FETCH_FORBIDDEN_BINDING_ROOTS = new Set([
  "url",
  "method",
  "accept",
  "browser",
  "proxyConfigured",
  "maxResponseBytes",
]);

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateBindingsForBoundaries(
  bindings: readonly RequestBinding[],
  boundaries: ReadonlySet<FixtureKey["boundary"]>,
  at: string,
): void {
  for (const binding of bindings) {
    if (binding !== null && !isJsonObject(binding)) {
      throw new InvalidFixtureFileError(`${at}: binding entries must be objects`);
    }
    if (typeof binding.name !== "string" || binding.name === "") {
      throw new InvalidFixtureFileError(`${at}: binding name must be a nonempty string`);
    }
    if (!Array.isArray(binding.paths) || binding.paths.length === 0) {
      throw new InvalidFixtureFileError(`${at}: binding "${binding.name}" must declare at least one path`);
    }
    for (const rawPath of binding.paths) {
      if (typeof rawPath !== "string" || rawPath === "") {
        throw new InvalidFixtureFileError(`${at}: binding paths must be nonempty strings`);
      }
      const root = rawPath.split(".")[0]!;
      if (boundaries.has("model") && MODEL_FORBIDDEN_BINDING_ROOTS.has(root)) {
        throw new InvalidFixtureFileError(
          `${at}: binding "${binding.name}" path "${rawPath}" targets frozen model request field "${root}"; only generated identity/path fields outside the frozen request shape may be normalised`,
        );
      }
      if (boundaries.has("fetch") && FETCH_FORBIDDEN_BINDING_ROOTS.has(root)) {
        throw new InvalidFixtureFileError(
          `${at}: binding "${binding.name}" path "${rawPath}" targets frozen fetch request field "${root}"`,
        );
      }
    }
  }
}

/**
 * Verifies a fixture set at load time: structural shape, schema version,
 * per-record whole-payload contentSha256, per-record key hash against the
 * binding-normalised canonical request, key uniqueness, integer occurrences
 * and binding allowlists. Recorded binding capturedValue is audit metadata
 * and never used to rewrite request bytes.
 */
export function verifyFixtureFile(file: FixtureFile): readonly RequestBinding[] {
  if (!isJsonObject(file)) {
    throw new InvalidFixtureFileError("Fixture file must be a JSON object");
  }
  if (file.schemaVersion !== FIXTURE_FILE_SCHEMA_VERSION || file.kind !== "intelli-benchmark-fixtures") {
    throw new InvalidFixtureFileError(`Unsupported fixture file header: schemaVersion=${String(file.schemaVersion)}`);
  }
  if (typeof file.scenario !== "string" || file.scenario === "") {
    throw new InvalidFixtureFileError("Fixture file scenario must be a nonempty string");
  }
  if (file.bindings !== undefined && !Array.isArray(file.bindings)) {
    throw new InvalidFixtureFileError("Fixture file bindings must be an array when present");
  }
  if (!Array.isArray(file.fixtures)) {
    throw new InvalidFixtureFileError("Fixture file fixtures must be an array");
  }
  const bindings = (file.bindings ?? []) as readonly RequestBinding[];
  const boundaries = new Set<FixtureKey["boundary"]>();
  for (const record of file.fixtures) {
    if (isJsonObject(record) && isJsonObject(record.key) && typeof record.key.boundary === "string") {
      boundaries.add(record.key.boundary as FixtureKey["boundary"]);
    }
  }
  validateBindingsForBoundaries(bindings, boundaries, "bindings");
  const seen = new Set<string>();
  for (const [index, record] of file.fixtures.entries()) {
    const at = `fixtures[${index}]`;
    if (!isJsonObject(record) || !isJsonObject(record.key)) {
      throw new InvalidFixtureFileError(`${at}: record and record.key must be objects`);
    }
    const key = record.key as Record<string, unknown>;
    for (const field of ["boundary", "scenario", "operationNode", "requestSha256"] as const) {
      if (typeof key[field] !== "string" || (key[field] as string) === "") {
        throw new InvalidFixtureFileError(`${at}: key.${field} must be a nonempty string`);
      }
    }
    if (key.scenario !== file.scenario) {
      throw new InvalidFixtureFileError(`${at}: key scenario "${String(key.scenario)}" does not match file scenario "${file.scenario}"`);
    }
    const occurrence = key.occurrence;
    if (typeof occurrence !== "number" || !Number.isInteger(occurrence) || occurrence < 1) {
      throw new InvalidFixtureFileError(`${at}: occurrence must be a positive integer`);
    }
    if (record.request === undefined || record.request === null || typeof record.request === "string") {
      throw new InvalidFixtureFileError(`${at}: request must be a JSON object`);
    }
    if (record.error === undefined && record.response === undefined) {
      throw new InvalidFixtureFileError(`${at}: record must freeze either a response or an error`);
    }
    if (record.error !== undefined && !isJsonObject(record.error)) {
      throw new InvalidFixtureFileError(`${at}: error must be an object`);
    }
    if (typeof record.delayMs !== "number" || !Number.isFinite(record.delayMs) || record.delayMs < 0) {
      throw new InvalidFixtureFileError(`${at}: delayMs must be a finite nonnegative number`);
    }
    const expectedContent = recordContentSha256({
      response: record.response as Json | undefined,
      error: record.error as FixtureRecord["error"],
      usage: record.usage as FixtureRecord["usage"],
      delayMs: record.delayMs,
    });
    if (record.contentSha256 !== expectedContent) {
      throw new InvalidFixtureFileError(`${at}: contentSha256 mismatch (expected ${expectedContent})`);
    }
    const expectedRequest = requestSha256(record.request as Json, bindings);
    if (record.key.requestSha256 !== expectedRequest) {
      throw new InvalidFixtureFileError(`${at}: key requestSha256 mismatch (expected ${expectedRequest})`);
    }
    const id = keyId(record.key as unknown as FixtureKey);
    if (seen.has(id)) throw new InvalidFixtureFileError(`${at}: duplicate fixture key ${canonicalJson(record.key)}`);
    seen.add(id);
  }
  return bindings;
}

/**
 * Canonical digest of a VERIFIED fixture file. This is the value
 * `RunObservation.fixtureSha256` records for a replay block: it covers the
 * complete frozen file (bindings and every record, including usage, errors
 * and timing) after verification passes.
 */
export function fixtureFileSha256(file: FixtureFile): string {
  verifyFixtureFile(file);
  return sha256Canonical(file);
}

/** Digest of the file on disk after it passes verification. */
export async function fixtureFileSha256FromPath(path: string): Promise<string> {
  return fixtureFileSha256(await loadFixtureFile(path));
}

/**
 * An in-memory {@link ReplayStore} over verified fixture records. Lookups are
 * occurrence-exact, order-checked and request-exact; every failure mode is a
 * recorded miss that throws {@link ReplayMissError}. `unconsumed()` and
 * `records()` are benchmark-side additions for skipped-sequence labelling and
 * content-derived node resolution; they are additive to the frozen interface.
 */
export interface BenchmarkReplayStore extends ReplayStore {
  /** Fixture keys never served; callers label these skipped, not missed. */
  unconsumed(): readonly FixtureKey[];
  /** The verified fixture records backing this store (read-only view). */
  records(): readonly FixtureRecord[];
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
  const consumedFamilies = new Map<string, number>();
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
      const family = keyFamilyId(key);
      if (key.occurrence > 1 && (consumedFamilies.get(family) ?? 0) !== key.occurrence - 1) {
        misses.push(key);
        throw new ReplayMissError(
          "out-of-order",
          `Replay miss: occurrence ${key.occurrence} of ${key.operationNode} requested before occurrence ${key.occurrence - 1} was consumed; ambiguous occurrence order invalidates the block`,
          key,
        );
      }
      consumedIds.add(id);
      consumedKeys.push(key);
      consumedFamilies.set(family, key.occurrence);
      return record;
    },
    consumed: () => [...consumedKeys],
    misses: () => [...misses],
    unconsumed: () =>
      [...byKey.values()].map((record) => record.key).filter((key) => !consumedIds.has(keyId(key))),
    records: () => [...input.fixtures],
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
  await rename(temp, path);
}

/**
 * Capture-side recorder for synthetic fixture generation and later approved
 * live capture. Assigns occurrence = 1 + number of already-recorded fixtures
 * with the same (boundary, scenario, operationNode, request hash), so
 * repeated identical calls keep distinct ordered occurrences (C30). The
 * submission order for identical calls is fixed by the forced workflow; the
 * recorder never reorders or merges them. `contentSha256` covers the whole
 * record payload ({ response, error, usage, delayMs }).
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
        contentSha256: recordContentSha256(outcome),
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
