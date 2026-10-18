// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// Versioned on-disk wire formats for the `.intelli-v1` run namespace (C21-C27).
// The JSON Schema copies under test/fixtures/run-store-v1/ are generated from
// these definitions and drift-checked by test/core-run-format.test.ts.

import { createHash } from "node:crypto";
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

export const NAMESPACE_DIR = ".intelli-v1";
export const NAMESPACE_FILE = "namespace.json";
export const JOURNAL_FILE = "allocations.ndjson";
export const LOCK_FILE = "writer.lock";
export const OWNER_FILE = "writer.owner.json";
export const INDEX_FILE = "index.json";
export const RUNS_DIR = "runs";
export const RESERVATION_FILE = "reservation.json";
export const MARKER_FILE = "committed.json";
export const ACCOUNTING_FILE = "accounting.json";
export const ACCOUNTING_MARKER_FILE = "accounting.committed.json";

/** Shared reader/writer ceiling for structural JSON files, excluding the index. */
export const STRUCTURAL_MAX_BYTES = 16 * 1024 * 1024;
/** C23 bounds. */
export const JOURNAL_RECORD_MAX_BYTES = 4_096;
export const JOURNAL_MAX_BYTES = 67_108_864;
export const JOURNAL_YIELD_RECORDS = 128;
export const ZERO_HASH = "0".repeat(64);
/**
 * Read/write ceiling for the secondary index, derived from the journal safety
 * ceiling rather than a stored-entry cap (C26). Entries never outnumber journal
 * records, and each entry's non-query fields (run ID, sequence, key, start,
 * manifest hash) are no larger than its record's (run ID, sequence, key, start,
 * operation ID and two hashes), so they total at most JOURNAL_MAX_BYTES; the
 * second JOURNAL_MAX_BYTES budgets the escaped query text. Only histories whose
 * queries average longer than about that share per record can exceed it.
 */
export const INDEX_MAX_BYTES = 2 * 67_108_864;
/** Diagnostic owner metadata is bounded; it never decides ownership. */
export const OWNER_MAX_BYTES = 1_024;
/** Existing judge window (src/core/cache.ts MAX_JUDGE_ENTRIES), retained by C26. */
export const CANDIDATE_WINDOW = 20;

const sha256Hex = Type.String({ pattern: "^[0-9a-f]{64}$" });
const namespaceId = Type.String({ pattern: "^[0-9a-f]{32}$" });
const runId = Type.String({ pattern: "^[a-z0-9][a-z0-9-]{0,127}$" });
const utc = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,9})?Z$" });
const sequence = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const compatibilityKey = Type.String({ pattern: "^sha256:[0-9a-f]{64}$" });
const operationId = Type.String({ minLength: 1, maxLength: 256 });
const relativePath = Type.String({
  pattern: "^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}(/[A-Za-z0-9_][A-Za-z0-9._-]{0,127}){0,3}$",
  maxLength: 512,
});
const fileDigest = Type.Object(
  { relativePath, bytes: Type.Integer({ minimum: 0 }), sha256: sha256Hex },
  { additionalProperties: false },
);
const strict = { additionalProperties: false } as const;

export const NamespaceSchema = Type.Object(
  {
    schema: Type.Literal("intelli-v1/namespace"),
    schemaVersion: Type.Literal(1),
    namespaceId,
    createdUtc: utc,
  },
  strict,
);
export const AllocationRecordSchema = Type.Object(
  {
    schema: Type.Literal("intelli-v1/allocation"),
    schemaVersion: Type.Literal(1),
    namespaceId,
    sequence,
    runId,
    operationId,
    compatibilityKey,
    startedUtc: utc,
    previousHash: sha256Hex,
    hash: sha256Hex,
  },
  strict,
);
export const ReservationSchema = Type.Object(
  {
    schema: Type.Literal("intelli-v1/reservation"),
    schemaVersion: Type.Literal(1),
    namespaceId,
    sequence,
    runId,
    operationId,
    compatibilityKey,
    startedUtc: utc,
    allocationHash: sha256Hex,
  },
  strict,
);
export const CommittedMarkerSchema = Type.Object(
  {
    schema: Type.Literal("intelli-v1/committed"),
    schemaVersion: Type.Literal(1),
    namespaceId,
    runId,
    admissionSequence: sequence,
    allocationHash: sha256Hex,
    compatibilityKey,
    query: Type.String(),
    startedUtc: utc,
    reportOutcome: Type.Literal("succeeded"),
    files: Type.Array(
      Type.Object(
        {
          relativePath,
          kind: Type.Union([
            Type.Literal("report"),
            Type.Literal("query"),
            Type.Literal("manifest-data"),
            Type.Literal("source"),
            Type.Literal("extraction"),
          ]),
          bytes: Type.Integer({ minimum: 0 }),
          sha256: sha256Hex,
        },
        strict,
      ),
      { minItems: 3 },
    ),
    nonEvidence: Type.Array(fileDigest),
  },
  strict,
);
export const AccountingSchema = Type.Object(
  {
    schema: Type.Literal("intelli-v1/accounting"),
    schemaVersion: Type.Literal(1),
    namespaceId,
    runId,
    manifestSha256: sha256Hex,
    coverage: Type.Literal("all-model-work-settled"),
    attempts: Type.Array(Type.Object({}, { additionalProperties: true })),
    summary: Type.Object({}, { additionalProperties: true }),
  },
  strict,
);
export const AccountingMarkerSchema = Type.Object(
  {
    schema: Type.Literal("intelli-v1/accounting-committed"),
    schemaVersion: Type.Literal(1),
    namespaceId,
    runId,
    manifestSha256: sha256Hex,
    file: fileDigest,
  },
  strict,
);
export const IndexEntrySchema = Type.Object(
  {
    runId,
    sequence,
    compatibilityKey,
    query: Type.String(),
    startedUtc: utc,
    manifestSha256: sha256Hex,
  },
  strict,
);
export const IndexSchema = Type.Object(
  {
    schema: Type.Literal("intelli-v1/index"),
    schemaVersion: Type.Literal(1),
    namespaceId,
    entries: Type.Array(IndexEntrySchema),
  },
  strict,
);
export const WriterOwnerSchema = Type.Object(
  {
    schema: Type.Literal("intelli-v1/writer-owner"),
    schemaVersion: Type.Literal(1),
    pid: Type.Integer({ minimum: 1 }),
    acquiredUtc: utc,
    purpose: Type.Union([Type.Literal("allocate"), Type.Literal("index")]),
    operationId: Type.Optional(operationId),
  },
  strict,
);

export type NamespaceRecord = Static<typeof NamespaceSchema>;
export type AllocationRecord = Static<typeof AllocationRecordSchema>;
export type ReservationRecord = Static<typeof ReservationSchema>;
export type CommittedMarker = Static<typeof CommittedMarkerSchema>;
export type AccountingRecord = Static<typeof AccountingSchema>;
export type AccountingMarker = Static<typeof AccountingMarkerSchema>;
export type IndexEntry = Static<typeof IndexEntrySchema>;
export type IndexRecord = Static<typeof IndexSchema>;
export type WriterOwner = Static<typeof WriterOwnerSchema>;

/** Every wire schema, keyed by its published fixture basename. */
export const wireSchemas: Readonly<Record<string, TSchema>> = Object.freeze({
  namespace: NamespaceSchema,
  allocation: AllocationRecordSchema,
  reservation: ReservationSchema,
  committed: CommittedMarkerSchema,
  accounting: AccountingSchema,
  "accounting-committed": AccountingMarkerSchema,
  index: IndexSchema,
  "writer-owner": WriterOwnerSchema,
});

export function isValid<T extends TSchema>(schema: T, value: unknown): value is Static<T> {
  return Value.Check(schema, value);
}

export function isUtc(value: unknown): value is string {
  if (typeof value !== "string" || !isValid(utc, value)) return false;
  const instant = Date.parse(value);
  // Date.parse normalises invalid days and 24:00. Preserve supported fractional
  // precision, but require the calendar and whole-second fields to round-trip.
  return (
    Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 19) === value.slice(0, 19)
  );
}

/** Sorted-key JSON without whitespace; rejects values JSON cannot represent exactly. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Non-finite number in canonical JSON");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  throw new TypeError(`Unsupported canonical JSON value: ${typeof value}`);
}

/** Canonical file encoding: one canonical JSON document plus a newline. */
export function encodeRecord(value: unknown): Buffer {
  return Buffer.from(canonicalJson(value) + "\n", "utf8");
}

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** C23: hash of the record's canonical JSON excluding its own `hash` field. */
export function allocationHash(record: Omit<AllocationRecord, "hash"> | AllocationRecord): string {
  const { hash: _ignored, ...rest } = record as AllocationRecord;
  return sha256(Buffer.from(canonicalJson(rest), "utf8"));
}

/** C26: exact query text plus the run's UTC date, as a full digest. */
export function compatibilityKeyFor(query: string, utcDate: string): string {
  return `sha256:${sha256(Buffer.from(canonicalJson({ query, utcDate }), "utf8"))}`;
}

export function utcDateOf(startedUtc: string): string {
  return startedUtc.slice(0, 10);
}

/**
 * Display label for a run directory: UTC date plus up to five query words,
 * mirroring the legacy slug stem. It carries no identity; the nonce does not
 * prove exclusivity either (exclusive mkdir does).
 */
export function displayLabel(query: string, startedUtc: string): string {
  const words = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join("-")
    .slice(0, 60)
    .replace(/-+$/, "");
  return words ? `${utcDateOf(startedUtc)}-${words}` : utcDateOf(startedUtc);
}

const RESERVED_NAMES = new Set([
  RESERVATION_FILE,
  MARKER_FILE,
  ACCOUNTING_FILE,
  ACCOUNTING_MARKER_FILE,
]);

/**
 * Relative, traversal-free artefact names: at most four portable segments,
 * no leading dot, no backslash or drive syntax, and none of the store's own
 * structural file names or temporary suffixes.
 */
export function isSafeRelativePath(path: string): boolean {
  if (!isValid(relativePath, path)) return false;
  if (RESERVED_NAMES.has(path) || path.endsWith(".tmp")) return false;
  return path.split("/").every((segment) => segment !== "." && segment !== "..");
}
