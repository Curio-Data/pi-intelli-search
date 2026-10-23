// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// F7-1 recorded suggestion replay library (benchmark-only code, never
// packaged). This module implements the accepted F7-1 amendment artefact and
// controllers for the native `NativeSuggestionReadView` seam
// (src/native-suggestion-view.ts wraps the real RunStore; the production
// default installs no controller):
//
// - a RECORDER controller that captures the real verified candidate reads,
//   producer allocations/publications and the suggestion judge requests into
//   a versioned, integrity-pinned suggestion-view artefact;
// - a REPLAY controller that waits for recorded index-visible prerequisites
//   inside one finite prespecified block budget, re-reads through the real
//   verified reader and projects the frozen logical view by selecting and
//   reordering current verified references;
// - a synchronous canonical request preparation used by both sides through
//   the transport preparation hook (scripts/benchmarks/transport-replay.ts).
//   Non-suggestion requests stay byte-exact; suggestion judge requests are
//   projected into a canonical F7 representation whose generated directory
//   slug and `startedUtc` leaves are typed binding tokens named by logical
//   producer and leaf kind. Tokens are structured values outside the
//   literal-string domain, so authored token-looking text cannot collide
//   with them.
//
// Binding replay condition N1 (verbatim, unchanged by this amendment):
//
//   a transport-replay implementation must never invoke `options.fetch` or
//   any network primitive. It must replay citations only through recorded
//   `onProviderStreamEvent` chunks, or through a declared non-network tee
//   seam if floor-host replay is ever required.
//
// This library performs no I/O at all: it neither fetches, nor touches the
// filesystem (artefact save/load helpers excepted, which only read/write the
// caller-named artefact file), nor mutates the run index. The only store
// access is the caller-supplied `readVerified()` from the native wrapper.
// Fail-closed policy: every controller or preparation fault marks the
// external block invalid (sticky) and calls the supplied stop callback
// BEFORE throwing, including faults the native wrapper contains and faults
// the pipeline's supplementary suggestion stage catches; a useful operation
// result alone never grants replay validity. No timing, latency or speed-up
// claim is recorded anywhere: observations carry structured facts only.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";
import type { CommittedRun, IndexCandidate, RunReservation } from "../../src/core/contracts.js";
import { compatibilityKeyFor, utcDateOf } from "../../src/core/run-format.js";
import type { NativeSuggestionReadView } from "../../src/native-injection.js";
import { asJson, canonicalJson, sha256Canonical } from "./canonical.js";
import { ReplayMissError } from "./replay-store.js";
import type { ModelNodeResolver, ModelRequestPreparer } from "./transport-replay.js";
import type { Json, ModelFixtureRequest } from "./contracts.js";

// ---------------------------------------------------------------------------
// Constants and shared value types
// ---------------------------------------------------------------------------

/** F7-1 generated leaf kinds embedded in the suggestion judge message. */
export type SuggestionLeafKind = "slug" | "startedUtc";

/** Explicit F7 representation marker carried by projected model fixture requests. */
export const F7_SUGGESTION_MARKER = "intelli-f7-suggestion-view" as const;

/** Amendment revision this library implements. */
export const F7_AMENDMENT_VERSION = "F7-1" as const;

/** Versioned suggestion-view artefact schema. */
export const SUGGESTION_ARTEFACT_SCHEMA_VERSION = 1;

/** Canonical kind tag of a suggestion-view artefact file. */
export const SUGGESTION_ARTEFACT_KIND = "intelli-f7-suggestion-view" as const;

/** Store notification phases, mirroring the native seam declaration. */
export type SuggestionFailurePhase = "allocation" | "commit" | "index" | "operation";

/** One frozen workflow report-producing operation. */
export interface SuggestionWorkflowOperation {
  /** Bounded logical node, unique within the workflow (no control characters). */
  readonly node: string;
  /** Exact query text of the operation. */
  readonly query: string;
  /** Serial occurrence of this exact query within the workflow (1-based). */
  readonly occurrence: number;
  /**
   * Operation kind. Omitted means "research" (the unambiguous default for
   * source compatibility). A "collate" producer allocates and publishes like
   * any report producer and can appear in another research's candidate view,
   * but never performs a candidate read of its own and never receives a
   * suggestion judge request.
   */
  readonly kind?: "research" | "collate";
}

/** Candidate fields as returned by the real verified reader. */
export interface SuggestionCandidateFields {
  readonly query: string;
  readonly reportPath: string;
  readonly namespace: "v1" | "legacy";
  readonly startedUtc: string;
  readonly compatibilityKey: string;
  readonly admissionSequence?: number;
}

/** A baseline entry: an `IndexCandidate`-shaped record from the pinned initial state. */
export interface SuggestionBaselineEntry extends SuggestionCandidateFields {}

/** Origin of one entry inside a recorded read view. */
export type SuggestionViewEntryOrigin =
  | { readonly kind: "baseline" }
  | { readonly kind: "block-local"; readonly producer: string };

/** One entry of a recorded read view. */
export interface SuggestionViewEntry extends SuggestionCandidateFields {
  readonly origin: SuggestionViewEntryOrigin;
}

/** Recorded allocation identity of one block producer (audit; current values differ at replay). */
export interface SuggestionReservationRecord {
  readonly runId: string;
  readonly sequence: number;
  readonly startedUtc: string;
  readonly compatibilityKey: string;
  readonly displayPath: string;
}

/** Terminal outcome of one declared block producer. */
export type SuggestionProducerOutcome = "indexed" | "failed" | "witnessed";

/** Producer record frozen into the artefact. */
export interface SuggestionProducerRecord {
  readonly node: string;
  readonly query: string;
  readonly occurrence: number;
  readonly allocated: boolean;
  readonly outcome: SuggestionProducerOutcome;
  /** Every unavailable phase observed, in order, without duplicates. */
  readonly failurePhases: readonly SuggestionFailurePhase[];
  /** Commit success established (indexed notification or host witness); false means not established. */
  readonly committed: boolean;
  readonly hostWitness: "failed-before-allocation" | "commit-succeeded" | null;
  /** How operation settlement was established for the serial order; null when never established. */
  readonly settleWitness: "host-settled" | "pre-allocation" | null;
  readonly reservation: SuggestionReservationRecord | null;
  readonly indexedManifestSha256: string | null;
}

/** One recorded read occurrence with its frozen logical view. */
export interface SuggestionReadRecord {
  readonly readerNode: string;
  readonly occurrence: number;
  readonly query: string;
  readonly view: readonly SuggestionViewEntry[];
  /** Block-local producers whose publications this read depends on, in view order. */
  readonly dependencies: readonly string[];
  /** Index into the artefact's suggestRequests, or null when the view is empty. */
  readonly matchedSuggestRequest: number | null;
}

/** One typed generated-leaf binding captured at recording. */
export interface SuggestionBindingRecord {
  readonly producer: string;
  readonly leaf: SuggestionLeafKind;
  readonly capturedValue: string;
}

/** Identity of the frozen logical view referenced by a canonical request. */
export interface SuggestionProjectionViewIdentity {
  readonly readerNode: string;
  readonly occurrence: number;
  readonly query: string;
  readonly viewSha256: string;
}

/** The F7 projection replacing `userMessage` inside a canonical suggestion request. */
export interface F7SuggestionProjection {
  readonly marker: typeof F7_SUGGESTION_MARKER;
  readonly amendmentVersion: typeof F7_AMENDMENT_VERSION;
  readonly artefact: { readonly scenario: string; readonly block: string };
  readonly view: SuggestionProjectionViewIdentity;
  readonly segments: readonly SuggestionSegment[];
}

/** One recorded suggestion judge request with raw/canonical/binding relationships. */
export interface SuggestionRequestRecord {
  readonly readerNode: string;
  readonly occurrence: number;
  /** The exact actual request, including the real `userMessage` string. */
  readonly raw: Json;
  /** The projected canonical request (f7Suggestion representation, no userMessage). */
  readonly canonical: Json;
  readonly bindings: readonly SuggestionBindingRecord[];
  readonly rawSha256: string;
  readonly canonicalSha256: string;
  readonly viewSha256: string;
}

/** Reference to one transport fixture file used by the block, by whole-file digest. */
export interface SuggestionFixtureFileRef {
  readonly name: string;
  readonly sha256: string;
}

/** Section digests making the artefact whole-file verifiable. */
export interface SuggestionArtefactIntegrity {
  readonly workflowSha256: string;
  readonly baselineSha256: string;
  readonly producersSha256: string;
  readonly readsSha256: string;
  readonly suggestRequestsSha256: string;
}

/** The versioned F7-1 suggestion-view artefact. */
export interface SuggestionViewArtefact {
  readonly schemaVersion: typeof SUGGESTION_ARTEFACT_SCHEMA_VERSION;
  readonly kind: typeof SUGGESTION_ARTEFACT_KIND;
  readonly amendmentVersion: typeof F7_AMENDMENT_VERSION;
  readonly scenario: string;
  readonly block: string;
  /** Digest of the versioned schedule manifest that froze the workflow before capture. */
  readonly scheduleManifestSha256: string;
  readonly workflow: readonly SuggestionWorkflowOperation[];
  readonly baseline: readonly SuggestionBaselineEntry[];
  /** Display root the recorded messages' slugs are relative to (same at replay). */
  readonly displayRoot: string;
  /** Digest of the pinned initial workspace/cache/index tree bytes. */
  readonly initialTreeDigest: string;
  /** Final transport fixture files pinned by the record-once export finalisation. */
  readonly fixtureFiles: readonly SuggestionFixtureFileRef[];
  readonly producers: readonly SuggestionProducerRecord[];
  readonly reads: readonly SuggestionReadRecord[];
  readonly suggestRequests: readonly SuggestionRequestRecord[];
  readonly integrity: SuggestionArtefactIntegrity;
}

// ---------------------------------------------------------------------------
// Segments (mirror of the production formatter template)
// ---------------------------------------------------------------------------

/** Literal template segment. */
export interface SuggestionLiteralSegment {
  readonly kind: "literal";
  readonly text: string;
}

/** Typed generated-leaf binding token, named by logical producer and leaf kind. */
export interface SuggestionBindingSegment {
  readonly kind: "binding";
  readonly producer: string;
  readonly leaf: SuggestionLeafKind;
}

export type SuggestionSegment = SuggestionLiteralSegment | SuggestionBindingSegment;

/** One view entry rendered into message-entry form for segment building. */
export interface SuggestionMessageEntry {
  readonly query: string;
  /** Slug value as the message renders it (literal for baseline, token for block-local). */
  readonly slug: string;
  readonly startedUtc: string;
  /** Block-local producer node, or null for a baseline entry. */
  readonly bindingProducer: string | null;
}

/** Current values for one producer's generated leaves. */
export interface SuggestionBindingValues {
  readonly slug: string;
  readonly startedUtc: string;
}

/**
 * Builds the suggestion judge message segments. This benchmark-side builder
 * mirrors the unchanged production template byte for byte: the
 * `src/core/research-result.ts` `suggestions()` call site builds
 * `Current query: "<query>"\n\nPrevious searches:\n` plus
 * `formatIndexForJudge(index, "")`, where `index.searches` maps the selected
 * candidates to `{ query, timestamp: startedUtc, slug: relative(displayRoot,
 * dirname(reportPath)) }`, `judgeCandidates` drops slugless entries and keeps
 * the last 20, and the operation slices the reader array to the first 20
 * before mapping. Boundaries are built here; leaves are never located by
 * searching for a captured value or applying a regular expression.
 */
export function buildSuggestionSegments(
  currentQuery: string,
  entries: readonly SuggestionMessageEntry[],
): readonly SuggestionSegment[] {
  const segments: SuggestionSegment[] = [
    { kind: "literal", text: `Current query: "` },
    { kind: "literal", text: currentQuery },
    { kind: "literal", text: `"\n\nPrevious searches:\n` },
  ];
  const visible = entries.slice(0, 20).filter((entry) => entry.slug !== "").slice(-20);
  if (visible.length === 0) {
    segments.push({ kind: "literal", text: "No previous searches." });
    return Object.freeze(segments);
  }
  visible.forEach((entry, index) => {
    if (index > 0) segments.push({ kind: "literal", text: "\n" });
    segments.push({ kind: "literal", text: `${index + 1}. "${entry.query}" (slug: ` });
    if (entry.bindingProducer === null) segments.push({ kind: "literal", text: entry.slug });
    else segments.push({ kind: "binding", producer: entry.bindingProducer, leaf: "slug" });
    segments.push({ kind: "literal", text: `, searched: ` });
    if (entry.bindingProducer === null) segments.push({ kind: "literal", text: entry.startedUtc });
    else segments.push({ kind: "binding", producer: entry.bindingProducer, leaf: "startedUtc" });
    segments.push({ kind: "literal", text: `)` });
  });
  return Object.freeze(segments);
}

/**
 * Renders segments into the exact message text using the supplied binding
 * values. Missing values fail closed. Used only to validate an actual
 * message byte for byte; canonical identity keeps bindings as tokens.
 */
export function renderSuggestionSegments(
  segments: readonly SuggestionSegment[],
  values: ReadonlyMap<string, SuggestionBindingValues>,
): string {
  let out = "";
  for (const segment of segments) {
    if (segment.kind === "literal") {
      out += segment.text;
      continue;
    }
    const value = values.get(segment.producer);
    if (value === undefined)
      throw new SuggestionViewError(
        "message-mismatch",
        `No current binding value exists for producer "${segment.producer}" leaf ${segment.leaf}`,
      );
    out += segment.leaf === "slug" ? value.slug : value.startedUtc;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Errors and observations
// ---------------------------------------------------------------------------

/** Fail-closed invalidation reasons. */
export type SuggestionInvalidReason =
  | "invalid-argument"
  | "reader-failed"
  | "invalid-artefact"
  | "invalid-workflow"
  | "invalid-baseline"
  | "unknown-operation"
  | "operation-query-mismatch"
  | "invalid-notification"
  | "collate-read"
  | "duplicate-allocation"
  | "duplicate-read"
  | "overlapping-queries"
  | "serial-order"
  | "allocation-cross-check"
  | "indexed-without-allocation"
  | "indexed-after-failure"
  | "reservation-mismatch"
  | "unexpected-candidate"
  | "duplicate-candidate"
  | "ambiguous-candidate"
  | "self-candidate"
  | "missing-required-candidate"
  | "producer-failed"
  | "message-mismatch"
  | "unmatched-view"
  | "unexpected-suggest-request"
  | "canonical-mismatch"
  | "budget-expired"
  | "cancelled"
  | "incomplete-block"
  | "initial-state-changed"
  | "fixture-mismatch"
  | "identity-mismatch";

/** Every library fault carries one of these reasons and invalidates the block. */
export class SuggestionViewError extends Error {
  readonly reason: SuggestionInvalidReason;
  constructor(reason: SuggestionInvalidReason, message: string) {
    super(message);
    this.name = "SuggestionViewError";
    this.reason = reason;
  }
}

/** Thrown by artefact validation when a suggestion-view artefact fails closed. */
export class InvalidSuggestionArtefactError extends SuggestionViewError {
  constructor(message: string) {
    super("invalid-artefact", message);
    this.name = "InvalidSuggestionArtefactError";
  }
}

/** Structured observations. No timing, latency or duration is ever recorded. */
export type SuggestionObservation =
  | {
      readonly kind: "allocated";
      readonly node: string;
      readonly query: string;
      readonly occurrence: number;
      readonly runId: string;
    }
  | {
      readonly kind: "producer-failed";
      readonly node: string;
      readonly query: string;
      readonly occurrence: number;
      readonly phase: SuggestionFailurePhase;
      readonly allocated: boolean;
    }
  | {
      readonly kind: "indexed";
      readonly node: string;
      readonly query: string;
      readonly occurrence: number;
      readonly runId: string;
    }
  | {
      readonly kind: "host-witness";
      readonly node: string;
      readonly query: string;
      readonly occurrence: number;
      readonly outcome: "failed-before-allocation" | "commit-succeeded" | "settled";
      /** The library never claims to have observed the host event itself. */
      readonly reportedBy: "coordinator";
    }
  | {
      readonly kind: "read";
      readonly node: string;
      readonly query: string;
      readonly occurrence: number;
      readonly entries: number;
      readonly baseline: number;
      readonly blockLocal: number;
    }
  | {
      /** Replay only: a visibility wait was actually needed and used part of the block budget. */
      readonly kind: "visibility-wait";
      readonly node: string;
      readonly query: string;
      readonly occurrence: number;
      readonly waitedFor: readonly string[];
      readonly blockBudgetMs: number;
    }
  | {
      /** Replay only: current rows excluded from the projection to reproduce the recorded instant. */
      readonly kind: "projection";
      readonly node: string;
      readonly query: string;
      readonly occurrence: number;
      readonly excludedProducers: readonly string[];
    }
  | {
      readonly kind: "suggest-prepared";
      readonly node: string;
      readonly query: string;
      readonly occurrence: number;
      readonly attempt: number;
      readonly bindings: number;
    }
  | { readonly kind: "fault"; readonly reason: SuggestionInvalidReason; readonly detail: string };

/** Coordinator-reported real host settled-event witness. */
export interface SuggestionHostWitnessInput {
  /** Exact query of the settled operation. */
  readonly query: string;
  /** Runtime operation id, when the coordinator can correlate it. */
  readonly operationId?: string;
  readonly outcome:
    /** The operation settled with no store notification of its own (for example a successful run). */
    | "settled"
    /** The operation aborted before any store call; no notification exists at all. */
    | "failed-before-allocation"
    /** The settled host result shows a committed report under an index failure. */
    | "commit-succeeded";
}

/** The documented session surface shared by recorder and replay. */
export interface SuggestionViewSession {
  /** Native controller for injection; frozen with stable function identities. */
  readonly controller: NativeSuggestionReadView;
  /**
   * Synchronous canonical request preparation. Non-suggestion requests are
   * returned byte-exact; suggestion requests are validated against the exact
   * selected verified view and projected into the F7 representation.
   */
  prepare(request: ModelFixtureRequest): Json;
  /** Reports the real host's settled-event witness (never claimed as observed by the library). */
  reportHostWitness(input: SuggestionHostWitnessInput): void;
  /** Throws the first recorded fault; a valid session returns silently. */
  assertValid(): void;
  /** Structured observations, in occurrence order; no timing claims. */
  observations(): readonly SuggestionObservation[];
}

/** Recorder session: additionally exports the frozen artefact. */
export interface SuggestionViewRecorder extends SuggestionViewSession {
  /**
   * Validates completeness and freezes the artefact. `finalisation` pins the
   * final transport fixture files by whole-file digest: the binding is
   * record-once and immutable, so a repeated export must repeat the same
   * digests (or omit finalisation to reuse the bound set).
   */
  exportArtefact(finalisation?: {
    readonly fixtureFiles: readonly SuggestionFixtureFileRef[];
  }): SuggestionViewArtefact;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Boolean array check WITHOUT a type predicate: `Array.isArray` narrows
 * declared `readonly T[]` types to `any[]`, which collapses later element
 * checking, so runtime shape validation uses this non-narrowing form.
 */
function isArrayValue(value: unknown): boolean {
  return Array.isArray(value);
}

function nonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isHex64(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

const NODE_PATTERN = /^[^\u0000-\u001f]{1,128}$/;
const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;

function validateNode(node: unknown, at: string): string {
  if (!nonemptyString(node) || !NODE_PATTERN.test(node))
    throw new InvalidSuggestionArtefactError(`${at}: logical node must be 1-128 characters without control characters`);
  return node;
}

function validateCandidateFields(value: unknown, at: string): SuggestionCandidateFields {
  if (!isRecord(value)) throw new InvalidSuggestionArtefactError(`${at}: must be an object`);
  for (const field of ["query", "reportPath", "startedUtc", "compatibilityKey"] as const)
    if (!nonemptyString(value[field]))
      throw new InvalidSuggestionArtefactError(`${at}: ${field} must be a nonempty string`);
  if (value.namespace !== "v1" && value.namespace !== "legacy")
    throw new InvalidSuggestionArtefactError(`${at}: namespace must be "v1" or "legacy"`);
  if (value.admissionSequence !== undefined) {
    if (typeof value.admissionSequence !== "number" || !Number.isSafeInteger(value.admissionSequence) || value.admissionSequence < 1)
      throw new InvalidSuggestionArtefactError(`${at}: admissionSequence must be a positive integer when present`);
  }
  return value as unknown as SuggestionCandidateFields;
}

function fieldsOf(candidate: SuggestionCandidateFields): SuggestionCandidateFields {
  return {
    query: candidate.query,
    reportPath: candidate.reportPath,
    namespace: candidate.namespace,
    startedUtc: candidate.startedUtc,
    compatibilityKey: candidate.compatibilityKey,
    ...(candidate.admissionSequence !== undefined ? { admissionSequence: candidate.admissionSequence } : {}),
  };
}

function candidatesEqual(a: SuggestionCandidateFields, b: SuggestionCandidateFields): boolean {
  return canonicalJson(asJson(fieldsOf(a))) === canonicalJson(asJson(fieldsOf(b)));
}

/** Digest of one frozen logical view (identity plus ordered entries). */
export function suggestionViewSha256(
  identity: { readonly readerNode: string; readonly occurrence: number; readonly query: string },
  entries: readonly SuggestionViewEntry[],
): string {
  return sha256Canonical({ identity, entries: entries.map(fieldsOf) });
}

function validateWorkflowShape(
  workflow: readonly SuggestionWorkflowOperation[],
): void {
  if (!isArrayValue(workflow) || workflow.length === 0)
    throw new SuggestionViewError("invalid-workflow", "The frozen workflow must be a nonempty array");
  const nodes = new Set<string>();
  const byQuery = new Map<string, number[]>();
  workflow.forEach((op, index) => {
    const at = `workflow[${index}]`;
    const node = validateNode(op.node, at);
    if (nodes.has(node))
      throw new SuggestionViewError("invalid-workflow", `${at}: duplicate logical node "${node}"`);
    nodes.add(node);
    if (!nonemptyString(op.query))
      throw new SuggestionViewError("invalid-workflow", `${at}: query must be a nonempty string`);
    if (op.kind !== undefined && op.kind !== "research" && op.kind !== "collate")
      throw new SuggestionViewError("invalid-workflow", `${at}: kind must be "research" or "collate" when present`);
    if (typeof op.occurrence !== "number" || !Number.isSafeInteger(op.occurrence) || op.occurrence < 1)
      throw new SuggestionViewError("invalid-workflow", `${at}: occurrence must be a positive integer`);
    const occurrences = byQuery.get(op.query) ?? [];
    if (occurrences.includes(op.occurrence))
      throw new SuggestionViewError("invalid-workflow", `${at}: duplicate occurrence ${op.occurrence} for query "${op.query}"`);
    occurrences.push(op.occurrence);
    byQuery.set(op.query, occurrences);
  });
  for (const [query, occurrences] of byQuery) {
    const sorted = [...occurrences].sort((a, b) => a - b);
    sorted.forEach((occurrence, index) => {
      if (occurrence !== index + 1)
        throw new SuggestionViewError(
          "invalid-workflow",
          `Query "${query}" declares occurrences ${sorted.join(", ")}; serial repeats must be contiguous 1..n`,
        );
    });
  }
}

function validateBaselineShape(baseline: readonly SuggestionBaselineEntry[]): void {
  if (!isArrayValue(baseline))
    throw new SuggestionViewError("invalid-baseline", "The baseline must be an array");
  const paths = new Set<string>();
  const keys = new Set<string>();
  baseline.forEach((entry, index) => {
    const validated = validateCandidateFields(entry, `baseline[${index}]`);
    if (paths.has(validated.reportPath))
      throw new SuggestionViewError("invalid-baseline", `baseline[${index}]: duplicate reportPath "${validated.reportPath}"`);
    if (keys.has(validated.compatibilityKey))
      throw new SuggestionViewError("invalid-baseline", `baseline[${index}]: duplicate compatibilityKey (a real reader output selects one entry per key)`);
    paths.add(validated.reportPath);
    keys.add(validated.compatibilityKey);
  });
}

// ---------------------------------------------------------------------------
// Artefact verification, digests and file I/O
// ---------------------------------------------------------------------------

function artefactSectionDigest(artefact: SuggestionViewArtefact, section: keyof SuggestionViewArtefact): string {
  return sha256Canonical(artefact[section]);
}

/**
 * Verifies a suggestion-view artefact completely and fails closed on any
 * defect: header, frozen workflow, baseline, producer outcomes, every read
 * occurrence with its view/dependencies, every suggest request's
 * raw/binding/canonical relationships (fully reconstructed through the
 * segment builder), section digests, dependency-graph validity and
 * referential integrity. Does not touch the network or the filesystem
 * beyond the passed value.
 */
export function verifySuggestionArtefact(artefact: SuggestionViewArtefact): void {
  const fail: (message: string) => never = (message) => {
    throw new InvalidSuggestionArtefactError(message);
  };
  // Structural check WITHOUT a type predicate: narrowing the already-typed
  // artefact records through `is Record<string, unknown>` collapses their
  // interfaces and breaks later property narrowing, so this guard only
  // validates runtime shape (the value comes from a JSON.parse cast).
  const requireObject = (value: unknown, at: string): void => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${at}: must be an object`);
  };
  if (!isRecord(artefact)) fail("The suggestion-view artefact must be an object");  if (
    artefact.schemaVersion !== SUGGESTION_ARTEFACT_SCHEMA_VERSION ||
    artefact.kind !== SUGGESTION_ARTEFACT_KIND ||
    artefact.amendmentVersion !== F7_AMENDMENT_VERSION
  )
    fail("Unsupported suggestion-view artefact header");
  if (!nonemptyString(artefact.scenario) || !nonemptyString(artefact.block))
    fail("Artefact scenario and block must be nonempty strings");
  if (!isHex64(artefact.scheduleManifestSha256))
    fail("Artefact scheduleManifestSha256 must be a sha256 hex digest of the frozen schedule manifest");
  if (!nonemptyString(artefact.displayRoot)) fail("Artefact displayRoot must be a nonempty string");
  if (!isHex64(artefact.initialTreeDigest)) fail("Artefact initialTreeDigest must be a sha256 hex digest");
  // Workflow and baseline are revalidated through the shared shape checks.
  try {
    validateWorkflowShape(artefact.workflow);
    validateBaselineShape(artefact.baseline);
    // The artefact is the frozen record: its workflow entries carry the
    // explicit operation kind (the recorder normalises the research default).
    artefact.workflow.forEach((op, index) => {
      if (op.kind !== "research" && op.kind !== "collate")
        fail(`workflow[${index}]: the frozen artefact must carry an explicit kind "research" or "collate"`);
    });
  } catch (error) {
    if (error instanceof SuggestionViewError) fail(error.message);
    throw error;
  }
  const fixtureNames = new Set<string>();
  if (!isArrayValue(artefact.fixtureFiles)) fail("Artefact fixtureFiles must be an array");
  for (const [index, ref] of artefact.fixtureFiles.entries()) {
    requireObject(ref, `fixtureFiles[${index}]`);
    if (!nonemptyString(ref.name) || !isHex64(ref.sha256))
      fail(`fixtureFiles[${index}]: name must be nonempty and sha256 a hex digest`);
    if (fixtureNames.has(ref.name)) fail(`fixtureFiles[${index}]: duplicate fixture file name "${ref.name}"`);
    fixtureNames.add(ref.name);
  }
  // Producers: exactly one per workflow node, consistent outcome accounting.
  const byNode = new Map(artefact.workflow.map((op) => [op.node, op]));
  if (!isArrayValue(artefact.producers)) fail("Artefact producers must be an array");
  if (artefact.producers.length !== artefact.workflow.length)
    fail("Every workflow operation must have exactly one producer record");
  const producerNodes = new Set<string>();
  for (const [index, producer] of artefact.producers.entries()) {
    const at = `producers[${index}]`;
    requireObject(producer, at);
    const node = validateNode(producer.node, at);
    if (!byNode.has(node)) fail(`${at}: producer "${node}" is not declared in the workflow`);
    if (producerNodes.has(node)) fail(`${at}: duplicate producer record for "${node}"`);
    producerNodes.add(node);
    const op = byNode.get(node)!;
    if (producer.query !== op.query || producer.occurrence !== op.occurrence)
      fail(`${at}: producer query/occurrence does not match the workflow entry`);
    if (typeof producer.allocated !== "boolean") fail(`${at}: allocated must be a boolean`);
    if (producer.outcome !== "indexed" && producer.outcome !== "failed" && producer.outcome !== "witnessed")
      fail(`${at}: unknown producer outcome`);
    if (!isArrayValue(producer.failurePhases)) fail(`${at}: failurePhases must be an array`);
    const phases = new Set<string>();
    for (const phase of producer.failurePhases) {
      if (phase !== "allocation" && phase !== "commit" && phase !== "index" && phase !== "operation")
        fail(`${at}: unknown failure phase "${String(phase)}"`);
      if (phases.has(phase)) fail(`${at}: duplicate failure phase "${phase}"`);
      phases.add(phase);
    }
    if (producer.outcome === "indexed" && !producer.allocated) fail(`${at}: an indexed producer must have allocated`);
    if (producer.outcome === "indexed" && phases.size > 0) fail(`${at}: an indexed producer cannot carry failure phases`);
    if (producer.outcome === "failed" && phases.size === 0) fail(`${at}: a failed producer needs at least one failure phase`);
    if (producer.outcome === "witnessed" && (producer.allocated || phases.size > 0))
      fail(`${at}: a witnessed producer neither allocated nor failed through notifications`);
    if (producer.outcome === "witnessed" && producer.hostWitness !== "failed-before-allocation")
      fail(`${at}: a witnessed producer must carry the failed-before-allocation host witness`);
    if (phases.has("allocation")) {
      if (producer.allocated) fail(`${at}: an allocation-phase failure means the producer never allocated`);
      if (phases.has("operation"))
        fail(`${at}: a never-allocated producer cannot receive the settle-time operation phase`);
      if (!producer.reservation) fail(`${at}: an allocation-phase failure carries no reservation`);
    }
    if ((phases.has("commit") || phases.has("index") || phases.has("operation")) && !producer.allocated)
      fail(`${at}: ${[...phases].join("/")} failures require an allocated producer`);
    if (producer.allocated && !producer.reservation) fail(`${at}: an allocated producer must record its reservation`);
    if (producer.reservation !== null) {
      const res = producer.reservation;
      if (
        !nonemptyString(res.runId) ||
        typeof res.sequence !== "number" ||
        !Number.isSafeInteger(res.sequence) ||
        res.sequence < 1 ||
        !UTC_PATTERN.test(res.startedUtc) ||
        !nonemptyString(res.compatibilityKey) ||
        !nonemptyString(res.displayPath)
      )
        fail(`${at}: malformed reservation record`);
      if (res.compatibilityKey !== compatibilityKeyFor(op.query, utcDateOf(res.startedUtc)))
        fail(`${at}: reservation compatibility key does not cross-check against its query and UTC date`);
    }
    if (producer.committed !== (producer.outcome === "indexed" || producer.hostWitness === "commit-succeeded"))
      fail(`${at}: committed must reflect index visibility or the commit-succeeded witness`);
    if (
      producer.settleWitness !== null &&
      producer.settleWitness !== "host-settled" &&
      producer.settleWitness !== "pre-allocation"
    )
      fail(`${at}: unknown settle witness`);
    if (producer.settleWitness === "pre-allocation" && producer.allocated)
      fail(`${at}: a pre-allocation settle witness means the producer never allocated`);
    if (producer.hostWitness !== null && producer.hostWitness !== "failed-before-allocation" && producer.hostWitness !== "commit-succeeded")
      fail(`${at}: unknown host witness`);
    if (producer.indexedManifestSha256 !== null && !isHex64(producer.indexedManifestSha256))
      fail(`${at}: indexedManifestSha256 must be a sha256 hex digest`);
    if (producer.outcome !== "indexed" && producer.indexedManifestSha256 !== null)
      fail(`${at}: only an indexed producer records a manifest digest`);
  }
  // Reads: exactly one per RESEARCH operation; a collate producer never reads.
  if (!isArrayValue(artefact.reads)) fail("Artefact reads must be an array");
  const researchOps = artefact.workflow.filter((op) => op.kind === "research");
  if (artefact.reads.length !== researchOps.length)
    fail(
      "Every research operation must have exactly one read occurrence record, and a collate operation must have none",
    );
  const readNodes = new Set<string>();
  const readByNode = new Map<string, SuggestionReadRecord>();
  for (const [index, read] of artefact.reads.entries()) {
    const at = `reads[${index}]`;
    requireObject(read, at);
    const node = validateNode(read.readerNode, at);
    if (readNodes.has(node)) fail(`${at}: duplicate read record for "${node}"`);
    readNodes.add(node);
    const op = byNode.get(node)!;
    if (op.kind !== "research") fail(`${at}: a read record exists for collate operation "${node}"`);
    if (read.occurrence !== op.occurrence || read.query !== op.query)
      fail(`${at}: read occurrence/query does not match the workflow entry`);
    if (!isArrayValue(read.view)) fail(`${at}: view must be an array`);
    const viewPaths = new Set<string>();
    const viewProducers = new Set<string>();
    const dependencies: string[] = [];
    read.view.forEach((entry, entryIndex) => {
      const entryAt = `${at}.view[${entryIndex}]`;
      requireObject(entry, entryAt);
      requireObject(entry.origin, `${entryAt}.origin`);
      const fields = validateCandidateFields(entry, entryAt);
      if (viewPaths.has(fields.reportPath)) fail(`${entryAt}: duplicate reportPath within the view`);
      viewPaths.add(fields.reportPath);
      if (entry.origin.kind === "baseline") {
        const baselineEntry = artefact.baseline.find((candidate) => candidatesEqual(candidate, fields));
        if (baselineEntry === undefined)
          fail(`${entryAt}: baseline-origin entry does not exactly match a frozen baseline entry`);
      } else if (entry.origin.kind === "block-local") {
        const producerNode = validateNode(entry.origin.producer, `${entryAt}.origin`);
        const producer = artefact.producers.find((p) => p.node === producerNode);
        if (producer === undefined) fail(`${entryAt}: block-local producer "${producerNode}" is not declared`);
        if (producer.outcome !== "indexed")
          fail(`${entryAt}: block-local producer "${producerNode}" is not index-visible`);
        if (producerNode === node) fail(`${entryAt}: a view cannot depend on its own reader's publication`);
        if (viewProducers.has(producerNode)) fail(`${entryAt}: producer "${producerNode}" appears twice in the view`);
        if (producer.query !== fields.query || producer.reservation?.startedUtc !== fields.startedUtc || producer.reservation?.compatibilityKey !== fields.compatibilityKey)
          fail(`${entryAt}: entry semantic identity does not match its recorded producer`);
        viewProducers.add(producerNode);
        dependencies.push(producerNode);
      } else fail(`${entryAt}: unknown view entry origin`);
    });
    if (!isArrayValue(read.dependencies)) fail(`${at}: dependencies must be an array`);
    if (canonicalJson(asJson(read.dependencies)) !== canonicalJson(asJson(dependencies)))
      fail(`${at}: dependencies must list exactly the view's block-local producers in view order`);
    readByNode.set(node, read);
  }
  // Suggest requests: full raw/binding/canonical reconstruction.
  if (!isArrayValue(artefact.suggestRequests)) fail("Artefact suggestRequests must be an array");
  const matchedReads = new Set<string>();
  artefact.suggestRequests.forEach((record, index) => {
    const at = `suggestRequests[${index}]`;
    requireObject(record, at);
    const node = validateNode(record.readerNode, at);
    const read = readByNode.get(node);
    if (read === undefined) fail(`${at}: no read record for reader "${node}"`);
    if (read.occurrence !== record.occurrence) fail(`${at}: occurrence does not match the read record`);
    if (read.view.length === 0) fail(`${at}: an empty view never receives a judge request`);
    if (read.matchedSuggestRequest !== index) fail(`${at}: the read record does not reference this request`);
    const readKey = `${node}\u0000${read.occurrence}`;
    if (matchedReads.has(readKey)) fail(`${at}: more than one suggest request for read "${node}"`);
    matchedReads.add(readKey);
    // Raw shape.
    const raw = record.raw;
    if (!isRecord(raw) || raw.role !== "suggest" || !nonemptyString(raw.userMessage))
      fail(`${at}: raw request must be a suggestion request with a text userMessage`);
    for (const field of ["systemPrompt"] as const)
      if (typeof raw[field] !== "string") fail(`${at}: raw ${field} must be a string`);
    if (raw.maxTokens !== null && typeof raw.maxTokens !== "number") fail(`${at}: raw maxTokens must be a number or null`);
    if (raw.reasoning !== null && typeof raw.reasoning !== "string") fail(`${at}: raw reasoning must be a string or null`);
    // Canonical shape and identity.
    const canonical = record.canonical;
    if (!isRecord(canonical) || canonical.userMessage !== undefined) fail(`${at}: canonical request must replace userMessage`);
    if (canonical.role !== "suggest") fail(`${at}: canonical role must be "suggest"`);
    for (const field of ["model", "systemPrompt", "maxTokens", "reasoning", "effectivePayloadPatch"] as const)
      if (canonicalJson(asJson(canonical[field] ?? null)) !== canonicalJson(asJson(raw[field] ?? null)))
        fail(`${at}: canonical field "${field}" must equal the raw request field exactly`);
    const projection = canonical.f7Suggestion;
    if (!isRecord(projection) || projection.marker !== F7_SUGGESTION_MARKER)
      fail(`${at}: canonical request carries no explicit F7 representation marker`);
    if (projection.amendmentVersion !== F7_AMENDMENT_VERSION) fail(`${at}: unknown amendment version`);
    if (!isRecord(projection.artefact) || projection.artefact.scenario !== artefact.scenario || projection.artefact.block !== artefact.block)
      fail(`${at}: the projection must reference this artefact's identity`);
    const view = projection.view;
    if (
      !isRecord(view) ||
      view.readerNode !== node ||
      view.occurrence !== read.occurrence ||
      view.query !== read.query ||
      !isHex64(view.viewSha256)
    )
      fail(`${at}: the projection's view identity does not match the read record`);
    if (view.viewSha256 !== suggestionViewSha256({ readerNode: node, occurrence: read.occurrence, query: read.query }, read.view))
      fail(`${at}: the projection's view digest does not match the frozen view`);
    // Rebuild the segments from the frozen view and compare byte-exactly.
    const messageEntries: SuggestionMessageEntry[] = read.view.map((entry) => ({
      query: entry.query,
      slug: relative(artefact.displayRoot, dirname(entry.reportPath)),
      startedUtc: entry.startedUtc,
      bindingProducer: entry.origin.kind === "block-local" ? entry.origin.producer : null,
    }));
    const rebuilt = buildSuggestionSegments(read.query, messageEntries);
    if (canonicalJson(asJson(rebuilt)) !== canonicalJson(asJson(projection.segments)))
      fail(`${at}: canonical segments do not match the frozen view rebuilt through the segment builder`);
    // Bindings: exactly the binding segments, values matching the view leaves.
    if (!isArrayValue(record.bindings)) fail(`${at}: bindings must be an array`);
    const bindingKeys = new Set<string>();
    for (const [bindingIndex, binding] of record.bindings.entries()) {
      const bindingAt = `${at}.bindings[${bindingIndex}]`;
      requireObject(binding, bindingAt);
      if (!nonemptyString(binding.producer) || !nonemptyString(binding.capturedValue))
        fail(`${bindingAt}: malformed binding record`);
      if (binding.leaf !== "slug" && binding.leaf !== "startedUtc") fail(`${bindingAt}: unknown leaf kind`);
      const key = `${binding.producer}\u0000${binding.leaf}`;
      if (bindingKeys.has(key)) fail(`${bindingAt}: duplicate binding`);
      bindingKeys.add(key);
    }
    const segmentBindings = rebuilt.filter((s): s is SuggestionBindingSegment => s.kind === "binding");
    if (
      segmentBindings.length !== record.bindings.length ||
      !segmentBindings.every((segment) =>
        record.bindings.some((b) => b.producer === segment.producer && b.leaf === segment.leaf),
      )
    )
      fail(`${at}: bindings must match the binding segments exactly`);
    const values = new Map<string, SuggestionBindingValues>();
    for (const binding of record.bindings) {
      const entry = read.view.find((e) => e.origin.kind === "block-local" && e.origin.producer === binding.producer);
      if (entry === undefined) fail(`${at}: binding producer "${binding.producer}" is not in the view`);
      if (binding.leaf === "startedUtc" && binding.capturedValue !== entry.startedUtc)
        fail(`${at}: captured startedUtc does not match the view entry`);
      if (binding.leaf === "slug" && binding.capturedValue !== relative(artefact.displayRoot, dirname(entry.reportPath)))
        fail(`${at}: captured slug does not match the view entry`);
      const current = values.get(binding.producer) ?? { slug: "", startedUtc: "" };
      values.set(binding.producer, {
        slug: binding.leaf === "slug" ? binding.capturedValue : current.slug,
        startedUtc: binding.leaf === "startedUtc" ? binding.capturedValue : current.startedUtc,
      });
    }
    if (renderSuggestionSegments(rebuilt, values) !== raw.userMessage)
      fail(`${at}: the rendered segments do not reproduce the raw userMessage byte for byte`);
    // Digests.
    if (record.rawSha256 !== sha256Canonical(raw)) fail(`${at}: rawSha256 mismatch`);
    if (record.canonicalSha256 !== sha256Canonical(canonical)) fail(`${at}: canonicalSha256 mismatch`);
    if (record.viewSha256 !== view.viewSha256) fail(`${at}: viewSha256 mismatch`);
  });
  // Every nonempty view is matched by exactly one suggest request.
  for (const read of artefact.reads) {
    if (read.view.length > 0 && (read.matchedSuggestRequest === null || !artefact.suggestRequests[read.matchedSuggestRequest]))
      fail(`The nonempty read view of "${read.readerNode}" has no matching suggest request`);
    if (read.view.length === 0 && read.matchedSuggestRequest !== null)
      fail(`The empty read view of "${read.readerNode}" must not reference a suggest request`);
  }
  // Dependency graph: existence, self-dependency and acyclicity. Reads only
  // point at producers and producers point at nothing, so a cycle requires a
  // self-dependency; the explicit DFS below still guards future extensions.
  const graphEdges = new Map<string, readonly string[]>();
  for (const read of artefact.reads) graphEdges.set(read.readerNode, read.dependencies);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: string): void => {
    if (visited.has(node)) return;
    if (visiting.has(node)) fail(`The dependency graph contains a cycle through "${node}"`);
    visiting.add(node);
    for (const dependency of graphEdges.get(node) ?? []) visit(dependency);
    visiting.delete(node);
    visited.add(node);
  };
  for (const node of graphEdges.keys()) visit(node);
  // Serial-order evidence: within one query, every occurrence except the
  // last must carry an explicit settlement witness (a host settled event, the
  // settle-time operation phase, or a pre-allocation witness). Settlement is
  // never inferred from a read, a model response or a publication.
  const settledProducersByQuery = new Map<string, SuggestionProducerRecord[]>();
  for (const producer of artefact.producers) {
    const list = settledProducersByQuery.get(producer.query) ?? [];
    list.push(producer);
    settledProducersByQuery.set(producer.query, list);
  }
  for (const [query, producers] of settledProducersByQuery) {
    const ordered = [...producers].sort((a, b) => a.occurrence - b.occurrence);
    for (const producer of ordered.slice(0, -1)) {
      if (producer.settleWitness === null)
        fail(
          `Serial occurrence ${producer.occurrence} of query "${query}" ("${producer.node}") carries no settlement witness; a later occurrence ran without the real host settlement event`,
        );
    }
  }
  // Section digests.
  requireObject(artefact.integrity, "integrity");
  const sections: readonly [keyof SuggestionArtefactIntegrity, keyof SuggestionViewArtefact][] = [
    ["workflowSha256", "workflow"],
    ["baselineSha256", "baseline"],
    ["producersSha256", "producers"],
    ["readsSha256", "reads"],
    ["suggestRequestsSha256", "suggestRequests"],
  ];
  for (const [digestField, section] of sections) {
    if (!isHex64(artefact.integrity[digestField])) fail(`integrity.${digestField} must be a sha256 hex digest`);
    if (artefact.integrity[digestField] !== artefactSectionDigest(artefact, section))
      fail(`integrity.${digestField} does not match the ${String(section)} section`);
  }
}

/** Whole-file digest of a VERIFIED artefact; the value the coordinator pins. */
export function suggestionArtefactSha256(artefact: SuggestionViewArtefact): string {
  verifySuggestionArtefact(artefact);
  return sha256Canonical(artefact);
}

/** Writes a verified artefact atomically (temp file then rename). */
export async function saveSuggestionViewArtefact(path: string, artefact: SuggestionViewArtefact): Promise<void> {
  verifySuggestionArtefact(artefact);
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temp, `${JSON.stringify(artefact, null, 2)}\n`, "utf8");
  await rename(temp, path);
}

/** Parses and verifies an artefact file from disk. Fails closed on any defect. */
export async function loadSuggestionViewArtefact(path: string): Promise<SuggestionViewArtefact> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new InvalidSuggestionArtefactError(`Cannot read suggestion-view artefact ${path}: ${String(error)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new InvalidSuggestionArtefactError(`Suggestion-view artefact ${path} is not valid JSON: ${String(error)}`);
  }
  const artefact = parsed as SuggestionViewArtefact;
  verifySuggestionArtefact(artefact);
  return artefact;
}

// ---------------------------------------------------------------------------
// Session core
// ---------------------------------------------------------------------------

interface ProducerWaiter {
  onProducerSettled(producer: ProducerRuntime): void;
}

interface ProducerRuntime {
  readonly op: SuggestionWorkflowOperation;
  operationId: string | null;
  started: boolean;
  readBound: boolean;
  prepareBound: boolean;
  prepareAttempts: number;
  allocated: boolean;
  status: "declared" | "allocated" | "indexed" | "failed" | "witnessed";
  phases: SuggestionFailurePhase[];
  committedWitness: boolean;
  preAllocationWitness: boolean;
  settledWitness: boolean;
  reservation: RunReservation | null;
  indexedManifestSha256: string | null;
  /** Recorded (recorder) or frozen (replay) view of this reader. */
  view: readonly SuggestionViewEntry[] | null;
  /** Replay only: the current rows selected by the projection, in frozen order. */
  currentRows: readonly IndexCandidate[] | null;
  waiters: Set<ProducerWaiter>;
}

/** Options shared by the recorder and replay constructors. */
export interface SuggestionSessionOptions {
  /** Called once per fault, before the library throws. Must not be relied on to throw. */
  readonly onInvalid: (error: SuggestionViewError) => void;
}

abstract class SuggestionSessionCore {
  protected readonly producers: readonly ProducerRuntime[];
  protected readonly byNode = new Map<string, ProducerRuntime>();
  protected readonly byQuery = new Map<string, ProducerRuntime[]>();
  protected readonly byOperationId = new Map<string, ProducerRuntime>();
  protected readonly observations: SuggestionObservation[] = [];
  private invalid: SuggestionViewError | null = null;

  constructor(
    workflow: readonly SuggestionWorkflowOperation[],
    private readonly onInvalid: (error: SuggestionViewError) => void,
  ) {
    this.producers = workflow.map((op) => {
      const producer: ProducerRuntime = {
        op,
        operationId: null,
        started: false,
        readBound: false,
        prepareBound: false,
        prepareAttempts: 0,
        allocated: false,
        status: "declared",
        phases: [],
        committedWitness: false,
        preAllocationWitness: false,
        settledWitness: false,
        reservation: null,
        indexedManifestSha256: null,
        view: null,
        currentRows: null,
        waiters: new Set(),
      };
      return producer;
    });
    for (const producer of this.producers) {
      this.byNode.set(producer.op.node, producer);
      const list = this.byQuery.get(producer.op.query) ?? [];
      list.push(producer);
      this.byQuery.set(producer.op.query, list);
    }
  }

  protected observe(observation: SuggestionObservation): void {
    this.observations.push(observation);
  }

  /** Records the fault externally (sticky), calls the stop callback, then throws. */
  protected fault(reason: SuggestionInvalidReason, message: string): never {
    const error = new SuggestionViewError(reason, message);
    this.recordFault(error);
    throw error;
  }

  protected recordFault(error: SuggestionViewError): void {
    if (this.invalid === null) {
      this.invalid = error;
      this.observe({ kind: "fault", reason: error.reason, detail: error.message });
    }
    try {
      this.onInvalid(error);
    } catch (callbackError) {
      // A throwing stop callback (for example a store invalidation) replaces
      // the propagated error; the block is already externally invalid either way.
      throw callbackError;
    }
  }

  protected assertNotInvalid(): void {
    if (this.invalid !== null) throw this.invalid;
  }

  assertValid(): void {
    if (this.invalid !== null) throw this.invalid;
  }

  observationsList(): readonly SuggestionObservation[] {
    return [...this.observations];
  }

  protected async verifiedRead(
    readVerified: () => Promise<readonly IndexCandidate[]>,
    signal: AbortSignal,
  ): Promise<readonly IndexCandidate[]> {
    try {
      return await readAll(readVerified);
    } catch (error) {
      if (signal.aborted) this.faultCancelled(signal);
      if (error instanceof SuggestionViewError) this.fault(error.reason, error.message);
      this.fault("reader-failed", "The actual verified suggestion candidate read failed");
    }
  }

  /** Marks invalid and propagates cancellation as the abort reason. */
  protected faultCancelled(signal: AbortSignal): never {
    const error = new SuggestionViewError("cancelled", "The suggestion replay block was cancelled during a visibility wait");
    this.recordFault(error);
    signal.throwIfAborted();
    throw error;
  }

  /**
   * Real settlement of one occurrence, as required before a later serial
   * occurrence of the same query may start. Settlement is established only
   * by the coordinator's host settled-event witness or a pre-allocation
   * witness; it is never inferred from a store phase, a read, a model
   * response or a publication.
   */
  settledForSerial(producer: ProducerRuntime): boolean {
    if (producer.settledWitness || producer.preAllocationWitness) return true;
    // Only coordinator-reported host witnesses establish settlement. The
    // settle-time `operation` unavailable phase fires during run-store
    // settlement, before the runtime lease and host result necessarily
    // settle, so it is not full operation settlement evidence; completed
    // reads, preparations and publications never count either.
    return false;
  }

  /**
   * Binds an incoming event to a workflow occurrence. Serial repeats of one
   * query bind in frozen occurrence order and require the preceding
   * occurrence to have really settled; a violation is an overlapping-query
   * or serial-order invalidation, never a guess.
   */
  protected bindProducerEvent(
    query: string,
    operationId: string | undefined,
    kind: "allocate" | "unavailable" | "read",
  ): ProducerRuntime {
    if (operationId !== undefined) {
      const bound = this.byOperationId.get(operationId);
      if (bound !== undefined) {
        if (bound.op.query !== query)
          this.fault(
            "operation-query-mismatch",
            `Operation "${operationId}" was bound to query "${bound.op.query}" but reported "${query}"`,
          );
        return bound;
      }
    }
    const list = this.byQuery.get(query);
    if (list === undefined)
      this.fault("unknown-operation", `Query "${query}" is not declared in the frozen workflow`);
    const next = list.find((producer) => !producer.started);
    if (next === undefined)
      this.fault(
        "unknown-operation",
        `More ${kind} events arrived for query "${query}" than the frozen workflow declares`,
      );
    for (const earlier of list) {
      if (earlier.op.occurrence >= next.op.occurrence) break;
      if (!this.settledForSerial(earlier))
        this.fault(
          kind === "read" ? "serial-order" : "overlapping-queries",
          `Occurrence ${next.op.occurrence} of query "${query}" started before occurrence ${earlier.op.occurrence} settled; a serial repeat requires the real host settlement witness`,
        );
    }
    if (operationId !== undefined) this.byOperationId.set(operationId, next);
    next.started = true;
    return next;
  }

  protected settleWaiters(producer: ProducerRuntime): void {
    for (const waiter of [...producer.waiters]) waiter.onProducerSettled(producer);
  }

  onAllocated(operationId: string, query: string, reservation: RunReservation): void {
    this.assertNotInvalid();
    const producer = this.bindProducerEvent(query, operationId, "allocate");
    if (producer.allocated || producer.reservation !== null)
      this.fault("duplicate-allocation", `Producer "${producer.op.node}" allocated more than once`);
    // Cross-check the reservation against the exact unique query.
    if (reservation.compatibilityKey !== compatibilityKeyFor(query, utcDateOf(reservation.startedUtc)))
      this.fault(
        "allocation-cross-check",
        `The allocation reservation of "${producer.op.node}" does not cross-check against its exact query and UTC start date`,
      );
    producer.allocated = true;
    producer.status = "allocated";
    producer.reservation = reservation;
    this.observe({
      kind: "allocated",
      node: producer.op.node,
      query,
      occurrence: producer.op.occurrence,
      runId: reservation.runId,
    });
  }

  onIndexed(operationId: string, run: CommittedRun): void {
    this.assertNotInvalid();
    const producer = this.byOperationId.get(operationId);
    if (producer === undefined)
      this.fault("unknown-operation", `An indexed notification arrived for unbound operation "${operationId}"`);
    if (!producer.allocated || producer.reservation === null)
      this.fault("indexed-without-allocation", `Producer "${producer.op.node}" signalled index visibility without an allocation`);
    if (producer.status === "failed")
      this.fault("indexed-after-failure", `Producer "${producer.op.node}" signalled index visibility after a failure phase`);
    const reservation = producer.reservation;
    const observed = run.reservation;
    if (
      observed.runId !== reservation.runId ||
      observed.sequence !== reservation.sequence ||
      observed.startedUtc !== reservation.startedUtc ||
      observed.compatibilityKey !== reservation.compatibilityKey ||
      observed.displayPath !== reservation.displayPath
    )
      this.fault(
        "reservation-mismatch",
        `The committed run of "${producer.op.node}" does not match its recorded allocation reservation`,
      );
    producer.status = "indexed";
    producer.indexedManifestSha256 = run.manifestSha256;
    this.observe({
      kind: "indexed",
      node: producer.op.node,
      query: producer.op.query,
      occurrence: producer.op.occurrence,
      runId: observed.runId,
    });
    this.settleWaiters(producer);
  }

  onUnavailable(operationId: string, query: string, phase: SuggestionFailurePhase): void {
    this.assertNotInvalid();
    const producer = this.bindProducerEvent(query, operationId, "unavailable");
    if (phase === "allocation") {
      if (producer.allocated)
        this.fault("invalid-notification", `An allocation failure arrived for already-allocated producer "${producer.op.node}"`);
    } else if (!producer.allocated)
      this.fault("invalid-notification", `A ${phase} failure arrived for producer "${producer.op.node}" before any allocation`);
    if (producer.status === "indexed")
      this.fault("invalid-notification", `A ${phase} failure arrived after producer "${producer.op.node}" became index-visible`);
    if (!producer.phases.includes(phase)) producer.phases.push(phase);
    producer.status = "failed";
    this.observe({
      kind: "producer-failed",
      node: producer.op.node,
      query,
      occurrence: producer.op.occurrence,
      phase,
      allocated: producer.allocated,
    });
    this.settleWaiters(producer);
  }

  reportHostWitness(input: SuggestionHostWitnessInput): void {
    this.assertNotInvalid();
    if (
      input.outcome !== "failed-before-allocation" &&
      input.outcome !== "commit-succeeded" &&
      input.outcome !== "settled"
    )
      this.fault("invalid-argument", `Unknown host witness outcome "${String(input.outcome)}"`);
    const list = this.byQuery.get(input.query);
    if (list === undefined)
      this.fault("unknown-operation", `A host witness arrived for undeclared query "${input.query}"`);
    let target: ProducerRuntime | undefined;
    if (input.operationId !== undefined) {
      const bound = this.byOperationId.get(input.operationId);
      if (bound === undefined || bound.op.query !== input.query)
        this.fault("unknown-operation", `The host witness operation is not bound to query "${input.query}"`);
      target = bound;
    }
    if (input.outcome === "failed-before-allocation") {
      if (target === undefined)
        target =
          list.find((producer) => producer.started && !producer.allocated && producer.phases.length === 0 && !producer.preAllocationWitness) ??
          this.bindProducerEvent(input.query, undefined, "unavailable");
      if (target.allocated || target.phases.length > 0)
        this.fault(
          "invalid-argument",
          `A failed-before-allocation witness arrived for producer "${target.op.node}", which already allocated or failed through notifications`,
        );
      target.preAllocationWitness = true;
      target.status = "witnessed";
    } else if (input.outcome === "settled") {
      // The real host end event: the positive settlement witness for the
      // serial occurrence order. It applies to the earliest started
      // occurrence of the query that is not settled yet.
      if (target === undefined)
        target = list.find((producer) => producer.started && !this.settledForSerial(producer));
      if (target === undefined)
        this.fault(
          "unknown-operation",
          `No started, unsettled occurrence of query "${input.query}" accepts a settled witness`,
        );
      target.settledWitness = true;
    } else {
      if (target === undefined)
        target = list.find((producer) => producer.started && producer.allocated && producer.status !== "indexed" && !producer.committedWitness);
      if (target === undefined)
        this.fault("unknown-operation", `No allocated non-indexed producer for query "${input.query}" accepts a commit-succeeded witness`);
      if (!target.allocated)
        this.fault("invalid-argument", `A commit-succeeded witness arrived for producer "${target.op.node}" before any allocation`);
      target.committedWitness = true;
    }
    this.observe({
      kind: "host-witness",
      node: target.op.node,
      query: input.query,
      occurrence: target.op.occurrence,
      outcome: input.outcome,
      reportedBy: "coordinator",
    });
    if (input.outcome === "failed-before-allocation") this.settleWaiters(target);
  }

  /** Shared read entry: binding, duplicate-read guard and current cross-check. */
  protected bindRead(
    query: string,
    operationId: string,
    current: RunReservation | undefined,
  ): ProducerRuntime {
    const producer = this.bindProducerEvent(query, operationId, "read");
    if ((producer.op.kind ?? "research") === "collate")
      this.fault(
        "collate-read",
        `A candidate read arrived for collate producer "${producer.op.node}"; the frozen workflow declares it never reads`,
      );
    if (producer.readBound)
      this.fault("duplicate-read", `Operation "${operationId}" performed more than one candidate read`);
    if (producer.reservation !== null) {
      if (current === undefined || current.runId !== producer.reservation.runId)
        this.fault(
          "reservation-mismatch",
          `The candidate read of "${producer.op.node}" did not present its own allocation reservation`,
        );
    } else if (current !== undefined) {
      this.fault(
        "reservation-mismatch",
        `The candidate read of "${producer.op.node}" presented a current reservation without an allocation`,
      );
    }
    return producer;
  }

  protected observeRead(producer: ProducerRuntime, view: readonly SuggestionViewEntry[]): void {
    this.observe({
      kind: "read",
      node: producer.op.node,
      query: producer.op.query,
      occurrence: producer.op.occurrence,
      entries: view.length,
      baseline: view.filter((entry) => entry.origin.kind === "baseline").length,
      blockLocal: view.filter((entry) => entry.origin.kind === "block-local").length,
    });
  }
}

// ---------------------------------------------------------------------------
// Recorder
// ---------------------------------------------------------------------------

/** Constructor options for the recorder. */
export interface SuggestionRecorderOptions extends SuggestionSessionOptions {
  readonly scenario: string;
  readonly block: string;
  /** Digest of the versioned schedule manifest that froze the workflow before capture. */
  readonly scheduleManifestSha256: string;
  /** Frozen forced workflow of report-producing operations. */
  readonly workflow: readonly SuggestionWorkflowOperation[];
  /**
   * The real verified reader's output on the pinned initial state, captured
   * before any block producer allocates. Exact paths, times and metadata.
   */
  readonly baseline: readonly SuggestionBaselineEntry[];
  /** Display root the operation's judge message computes slugs relative to. */
  readonly displayRoot: string;
  /** Digest of the pinned initial workspace/cache/index tree bytes. */
  readonly initialTreeDigest: string;
}

/**
 * Creates the F7-1 recorder session. The controller is injected into the
 * native seam (`withNativeSuggestionReadView`); recording calls the
 * unmodified verified reader and returns its exact array, classifying every
 * entry as an exact frozen-baseline member or a declared block-local
 * producer cross-checked through its allocation reservation. The suggestion
 * judge request preparation validates the complete actual message against
 * the selected verified view and the production formatter template, emits
 * typed generated-leaf tokens and records the raw request, binding map and
 * canonical representation for the artefact.
 */
export function createSuggestionViewRecorder(options: SuggestionRecorderOptions): SuggestionViewRecorder {
  if (!nonemptyString(options.scenario) || !nonemptyString(options.block))
    throw new SuggestionViewError("invalid-argument", "Recorder scenario and block must be nonempty strings");
  if (!nonemptyString(options.displayRoot))
    throw new SuggestionViewError("invalid-argument", "Recorder displayRoot must be a nonempty string");
  if (!isHex64(options.initialTreeDigest))
    throw new SuggestionViewError("invalid-argument", "Recorder initialTreeDigest must be a sha256 hex digest");
  if (!isHex64(options.scheduleManifestSha256))
    throw new SuggestionViewError(
      "invalid-argument",
      "Recorder scheduleManifestSha256 must be a sha256 hex digest of the frozen schedule manifest",
    );
  if (typeof options.onInvalid !== "function")
    throw new SuggestionViewError("invalid-argument", "Recorder onInvalid must be a function");
  validateWorkflowShape(options.workflow);
  validateBaselineShape(options.baseline);

  const suggestRequests: SuggestionRequestRecord[] = [];
  const suggestRequestsByRead = new Map<string, SuggestionRequestRecord>();
  const baseline: readonly SuggestionBaselineEntry[] = options.baseline.map(fieldsOf);
  // Record-once final fixture binding: the final model/fetch fixture-file
  // digests are unknown at construction and are pinned by the first
  // exportArtefact finalisation; the binding is immutable afterwards.
  let finalFixtureFiles: readonly SuggestionFixtureFileRef[] | null = null;

  class Recorder extends SuggestionSessionCore {
    constructor() {
      super(options.workflow, options.onInvalid);
    }

    private slugOf(reportPath: string): string {
      return relative(options.displayRoot, dirname(reportPath));
    }

    private classifyRow(row: IndexCandidate, reader: ProducerRuntime): SuggestionViewEntry {
      const matches: ProducerRuntime[] = [];
      for (const producer of this.producers) {
        const reservation = producer.reservation;
        if (reservation === null) continue;
        if (
          row.namespace === "v1" &&
          row.startedUtc === reservation.startedUtc &&
          row.compatibilityKey === reservation.compatibilityKey &&
          row.query === producer.op.query &&
          dirname(row.reportPath) === reservation.displayPath
        )
          matches.push(producer);
      }
      const baselineEntry = baseline.find((entry) => candidatesEqual(entry, row));
      if (matches.length > 1)
        this.fault(
          "ambiguous-candidate",
          `A candidate row (path ${row.reportPath}) matches the reservations of ${matches.map((p) => p.op.node).join(" and ")}`,
        );
      if (matches.length === 1) {
        const producer = matches[0];
        if (producer === reader)
          this.fault(
            "self-candidate",
            `The candidate view of "${reader.op.node}" contains its own publication; the real reader excludes the current compatibility key`,
          );
        if (producer.status !== "indexed")
          this.fault(
            "unexpected-candidate",
            `A candidate row matches producer "${producer.op.node}", which is not index-visible`,
          );
        if (baselineEntry !== undefined)
          this.fault("ambiguous-candidate", `A candidate row matches both a block producer and a baseline entry`);
        return { origin: { kind: "block-local", producer: producer.op.node }, ...fieldsOf(row) };
      }
      if (baselineEntry !== undefined) return { origin: { kind: "baseline" }, ...fieldsOf(row) };
      this.fault(
        "unexpected-candidate",
        `A candidate row (query "${row.query}", path ${row.reportPath}) is neither an exact frozen-baseline member nor a declared block producer`,
      );
    }

    async candidates(input: {
      readonly operationId: string;
      readonly current: RunReservation | undefined;
      readonly query: string;
      readonly signal: AbortSignal;
      readonly readVerified: () => Promise<readonly IndexCandidate[]>;
    }): Promise<readonly IndexCandidate[]> {
      this.assertNotInvalid();
      const producer = this.bindRead(input.query, input.operationId, input.current);
      const rows = await this.verifiedRead(input.readVerified, input.signal);
      this.assertNotInvalid();
      const entries = rows.map((row) => this.classifyRow(row, producer));
      const paths = new Set<string>();
      for (const entry of entries) {
        if (paths.has(entry.reportPath))
          this.fault("duplicate-candidate", `The candidate view of "${producer.op.node}" contains ${entry.reportPath} twice`);
        paths.add(entry.reportPath);
      }
      producer.view = entries;
      producer.readBound = true;
      this.observeRead(producer, entries);
      return rows;
    }

    prepare(request: ModelFixtureRequest): Json {
      this.assertNotInvalid();
      if (request.role !== "suggest") return asJson(request);
      if (typeof request.userMessage !== "string")
        this.fault("message-mismatch", "A suggestion request arrived without a text user message");
      let matched: ProducerRuntime | null = null;
      let segments: readonly SuggestionSegment[] | null = null;
      let values: Map<string, SuggestionBindingValues> | null = null;
      for (const producers of this.byQuery.values()) {
        const latest = [...producers].reverse().find((producer) => producer.started && producer.readBound && producer.view !== null);
        if (latest === undefined) continue;
        const candidateSegments = buildSuggestionSegments(
          latest.op.query,
          (latest.view ?? []).map((entry) => ({
            query: entry.query,
            slug: this.slugOf(entry.reportPath),
            startedUtc: entry.startedUtc,
            bindingProducer: entry.origin.kind === "block-local" ? entry.origin.producer : null,
          })),
        );
        const candidateValues = new Map<string, SuggestionBindingValues>();
        for (const entry of latest.view ?? []) {
          if (entry.origin.kind !== "block-local") continue;
          candidateValues.set(entry.origin.producer, {
            slug: this.slugOf(entry.reportPath),
            startedUtc: entry.startedUtc,
          });
        }
        let rendered: string;
        try {
          rendered = renderSuggestionSegments(candidateSegments, candidateValues);
        } catch (error) {
          if (error instanceof SuggestionViewError) {
            this.fault(error.reason, `Suggestion message rendering failed: ${error.message}`);
          }
          throw error;
        }
        if (rendered === request.userMessage) {
          if (matched !== null)
            this.fault(
              "ambiguous-candidate",
              `The suggestion judge request matches the read views of "${matched.op.node}" and "${latest.op.node}"`,
            );
          matched = latest;
          segments = candidateSegments;
          values = candidateValues;
        }
      }
      if (matched === null || segments === null || values === null)
        this.fault(
          "message-mismatch",
          "The suggestion judge request does not match the latest recorded read view of any workflow query",
        );
      const view = matched.view ?? [];
      if (view.length === 0)
        this.fault(
          "unexpected-suggest-request",
          `A suggestion judge request arrived for the empty read view of "${matched.op.node}"; the pipeline sends no judge request for an empty view`,
        );
      for (const producers of this.byQuery.values()) {
        for (const earlier of producers) {
          if (earlier.op.occurrence >= matched.op.occurrence || earlier.op.query !== matched.op.query) continue;
          if (earlier.view !== null && earlier.view.length > 0 && !earlier.prepareBound)
            this.fault(
              "unmatched-view",
              `The nonempty read view of "${earlier.op.node}" never received its suggestion judge request`,
            );
        }
      }
      const identity = {
        readerNode: matched.op.node,
        occurrence: matched.op.occurrence,
        query: matched.op.query,
      };
      const viewSha256 = suggestionViewSha256(identity, view);
      const canonical = asJson({
        model: request.model,
        role: request.role,
        systemPrompt: request.systemPrompt,
        maxTokens: request.maxTokens,
        reasoning: request.reasoning,
        effectivePayloadPatch: request.effectivePayloadPatch,
        f7Suggestion: {
          marker: F7_SUGGESTION_MARKER,
          amendmentVersion: F7_AMENDMENT_VERSION,
          artefact: { scenario: options.scenario, block: options.block },
          view: { ...identity, viewSha256 },
          segments,
        },
      });
      const bindings: SuggestionBindingRecord[] = [];
      for (const segment of segments) {
        if (segment.kind !== "binding") continue;
        const value = values.get(segment.producer);
        if (value === undefined)
          this.fault("canonical-mismatch", `No binding value exists for producer "${segment.producer}"`);
        bindings.push({
          producer: segment.producer,
          leaf: segment.leaf,
          capturedValue: segment.leaf === "slug" ? value.slug : value.startedUtc,
        });
      }
      const readKey = `${identity.readerNode}\u0000${identity.occurrence}`;
      const existing = suggestRequestsByRead.get(readKey);
      matched.prepareAttempts += 1;
      if (existing !== undefined) {
        // A retried transport attempt re-prepares the same view: identical
        // inputs must produce the identical canonical representation.
        if (sha256Canonical(canonical) !== existing.canonicalSha256)
          this.fault(
            "canonical-mismatch",
            `A repeated preparation of "${identity.readerNode}" produced a different canonical representation`,
          );
        this.observe({
          kind: "suggest-prepared",
          node: identity.readerNode,
          query: identity.query,
          occurrence: identity.occurrence,
          attempt: matched.prepareAttempts,
          bindings: bindings.length,
        });
        return existing.canonical;
      }
      const raw = asJson(request);
      const record: SuggestionRequestRecord = {
        readerNode: identity.readerNode,
        occurrence: identity.occurrence,
        raw,
        canonical,
        bindings,
        rawSha256: sha256Canonical(raw),
        canonicalSha256: sha256Canonical(canonical),
        viewSha256,
      };
      suggestRequests.push(record);
      suggestRequestsByRead.set(readKey, record);
      matched.prepareBound = true;
      this.observe({
        kind: "suggest-prepared",
        node: identity.readerNode,
        query: identity.query,
        occurrence: identity.occurrence,
        attempt: matched.prepareAttempts,
        bindings: bindings.length,
      });
      return canonical;
    }

    reportHostWitness(input: SuggestionHostWitnessInput): void {
      super.reportHostWitness(input);
    }

    exportArtefact(finalisation?: {
      readonly fixtureFiles: readonly SuggestionFixtureFileRef[];
    }): SuggestionViewArtefact {
      this.assertValid();
      if (finalisation !== undefined) {
        if (!isArrayValue(finalisation.fixtureFiles) || finalisation.fixtureFiles.length === 0)
          this.fault(
            "invalid-argument",
            "The export finalisation must pin at least one transport fixture file by whole-file digest",
          );
        const names = new Set<string>();
        for (const [index, ref] of finalisation.fixtureFiles.entries()) {
          if (!isRecord(ref) || !nonemptyString(ref.name) || !isHex64(ref.sha256))
            this.fault("invalid-argument", `fixtureFiles[${index}] must carry a name and a sha256 hex digest`);
          if (names.has(ref.name))
            this.fault("invalid-argument", `fixtureFiles[${index}]: duplicate name "${ref.name}"`);
          names.add(ref.name);
        }
        const binding = finalisation.fixtureFiles.map((ref) => ({ ...ref }));
        if (finalFixtureFiles === null) finalFixtureFiles = binding;
        else if (canonicalJson(asJson(finalFixtureFiles)) !== canonicalJson(asJson(binding)))
          this.fault(
            "fixture-mismatch",
            "The final fixture-file binding is record-once and immutable; a repeated export presented different fixture digests",
          );
      }
      for (const producer of this.producers) {
        if (!producer.started)
          this.fault("incomplete-block", `Workflow operation "${producer.op.node}" never started`);
        if ((producer.op.kind ?? "research") === "collate") {
          // A collate producer allocates and publishes but never reads: no
          // candidate read is required or permitted (bindRead already rejects
          // one), and no suggestion judge request can exist for it.
          if (producer.readBound)
            this.fault(
              "collate-read",
              `Collate producer "${producer.op.node}" performed a candidate read despite the frozen declaration`,
            );
        } else if (!producer.readBound) {
          this.fault(
            "incomplete-block",
            `Research operation "${producer.op.node}" settled without its frozen candidate read`,
          );
        }
        if (producer.allocated && producer.status !== "indexed" && producer.phases.length === 0)
          this.fault(
            "incomplete-block",
            `Allocated producer "${producer.op.node}" is neither indexed nor failed; the block ended before it settled`,
          );
        if (!producer.allocated && producer.phases.length === 0 && !producer.preAllocationWitness)
          this.fault(
            "incomplete-block",
            `Producer "${producer.op.node}" neither allocated nor received the coordinator's pre-allocation host witness`,
          );
        if (producer.view !== null && producer.view.length > 0 && !producer.prepareBound)
          this.fault("unmatched-view", `The nonempty read view of "${producer.op.node}" never received its judge request`);
      }
      if (finalFixtureFiles === null)
        this.fault(
          "fixture-mismatch",
          "The artefact cannot export without the record-once final fixture-file binding; pass finalisation.fixtureFiles on the first export",
        );
      const producers: SuggestionProducerRecord[] = this.producers.map((producer) => ({
        node: producer.op.node,
        query: producer.op.query,
        occurrence: producer.op.occurrence,
        allocated: producer.allocated,
        outcome:
          producer.status === "indexed"
            ? "indexed"
            : producer.preAllocationWitness && producer.phases.length === 0
              ? "witnessed"
              : "failed",
        failurePhases: [...producer.phases],
        committed: producer.status === "indexed" || producer.committedWitness,
        hostWitness:
          producer.preAllocationWitness && producer.phases.length === 0
            ? "failed-before-allocation"
            : producer.committedWitness
              ? "commit-succeeded"
              : null,
        settleWitness: producer.settledWitness
          ? "host-settled"
          : producer.preAllocationWitness
            ? "pre-allocation"
            : null,
        reservation: producer.reservation
          ? {
              runId: producer.reservation.runId,
              sequence: producer.reservation.sequence,
              startedUtc: producer.reservation.startedUtc,
              compatibilityKey: producer.reservation.compatibilityKey,
              displayPath: producer.reservation.displayPath,
            }
          : null,
        indexedManifestSha256: producer.indexedManifestSha256,
      }));
      const reads: SuggestionReadRecord[] = this.producers
        .filter((producer) => (producer.op.kind ?? "research") === "research")
        .map((producer) => {
          const view = producer.view ?? [];
          const matchedIndex = suggestRequests.findIndex((record) => record.readerNode === producer.op.node);
          return {
            readerNode: producer.op.node,
            occurrence: producer.op.occurrence,
            query: producer.op.query,
            view,
            dependencies: [
              ...new Set(
                view
                  .filter((entry) => entry.origin.kind === "block-local")
                  .map((entry) => (entry.origin as { producer: string }).producer),
              ),
            ],
            matchedSuggestRequest: view.length > 0 ? (matchedIndex >= 0 ? matchedIndex : null) : null,
          };
        });
      // The frozen workflow normalises the research default to an explicit
      // kind, and the integrity digest is computed over the SAME normalised
      // records the artefact carries.
      const frozenWorkflow: readonly SuggestionWorkflowOperation[] = options.workflow.map((op) => ({
        ...op,
        kind: op.kind ?? "research",
      }));
      const artefact: SuggestionViewArtefact = {
        schemaVersion: SUGGESTION_ARTEFACT_SCHEMA_VERSION,
        kind: SUGGESTION_ARTEFACT_KIND,
        amendmentVersion: F7_AMENDMENT_VERSION,
        scenario: options.scenario,
        block: options.block,
        scheduleManifestSha256: options.scheduleManifestSha256,
        workflow: frozenWorkflow,
        baseline: baseline.map(fieldsOf),
        displayRoot: options.displayRoot,
        initialTreeDigest: options.initialTreeDigest,
        fixtureFiles: (finalFixtureFiles ?? []).map((ref) => ({ ...ref })),
        producers,
        reads,
        suggestRequests: [...suggestRequests],
        integrity: {
          workflowSha256: sha256Canonical(frozenWorkflow),
          baselineSha256: sha256Canonical(baseline),
          producersSha256: sha256Canonical(producers),
          readsSha256: sha256Canonical(reads),
          suggestRequestsSha256: sha256Canonical(suggestRequests),
        },
      };
      verifySuggestionArtefact(artefact);
      return artefact;
    }
  }

  const recorder = new Recorder();
  const session: SuggestionViewRecorder = {
    controller: Object.freeze({
      allocated: (input) => recorder.onAllocated(input.operationId, input.query, input.reservation),
      indexed: (input) => recorder.onIndexed(input.operationId, input.run),
      unavailable: (input) => recorder.onUnavailable(input.operationId, input.query, input.phase),
      candidates: (input) => recorder.candidates(input),
    } satisfies NativeSuggestionReadView),
    prepare: (request) => recorder.prepare(request),
    reportHostWitness: (input) => recorder.reportHostWitness(input),
    assertValid: () => recorder.assertValid(),
    observations: () => recorder.observationsList(),
    exportArtefact: (finalisation?: { readonly fixtureFiles: readonly SuggestionFixtureFileRef[] }) =>
      recorder.exportArtefact(finalisation),
  };
  return session;
}

async function readAll(readVerified: () => Promise<readonly IndexCandidate[]>): Promise<readonly IndexCandidate[]> {
  return readVerified();
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

/** Replay session: adds the end-of-block completeness finalisation. */
export interface SuggestionViewReplay extends SuggestionViewSession {
  /**
   * End-of-block replay completeness assertion, distinct from the sticky-error
   * `assertValid()`: a fault-free session whose controller reads never entered
   * the library (for example a native wrapper poisoned before every read)
   * still fails here. Requires the frozen expected producers, candidate reads
   * and suggestion-request occurrences; never fabricates missed work.
   */
  assertReplayComplete(): void;
}

/** Constructor options for the replay. */
export interface SuggestionReplayOptions extends SuggestionSessionOptions {
  /** Verified artefact (re-verified at construction). */
  readonly artefact: SuggestionViewArtefact;
  /** Must equal the artefact's displayRoot; canonical identity depends on it. */
  readonly displayRoot: string;
  /** Finite prespecified block visibility budget in milliseconds. */
  readonly budgetMs: number;
  /** Cross-checked against the artefact when provided. */
  readonly expectedInitialTreeDigest?: string;
  /** Cross-checked against the artefact when provided. */
  readonly expectedScheduleManifestSha256?: string;
  /**
   * The actual transport fixture files replay will use, by whole-file
   * digest. Required: replay verifies these digests against the artefact's
   * record-once final binding, so an unbound or mismatched artefact can
   * never be mistaken for complete replay validity.
   */
  readonly expectedFixtureFiles: readonly SuggestionFixtureFileRef[];
}

/**
 * Creates the F7-1 replay session. Dependency-graph validation and identity
 * cross-checks run at construction, before any replay event. The controller
 * waits (only when a visibility wait is actually needed) for the recorded
 * index-visible prerequisites inside one finite block budget that starts at
 * the first wait, honours cancellation and removes every timer and listener
 * before callback settlement; it then calls the real verified reader again
 * and selects/reorders current verified references to match the frozen
 * logical view. Differences are limited to declared block-local producers
 * that were not visible at the recorded read instant; those are excluded
 * only to reproduce that instant. Unexpected baseline candidates or
 * metadata, required window loss, failed producers, foreign/duplicate/
 * ambiguous bindings, changed initial state, budget expiry and cancellation
 * fail closed. No polling loop, filesystem bypass, index mutation or
 * invented candidate exists in this session.
 */
export function createSuggestionViewReplay(options: SuggestionReplayOptions): SuggestionViewReplay {
  verifySuggestionArtefact(options.artefact);
  if (options.displayRoot !== options.artefact.displayRoot)
    throw new SuggestionViewError(
      "identity-mismatch",
      `The replay display root "${options.displayRoot}" differs from the recorded artefact display root "${options.artefact.displayRoot}"`,
    );
  if (
    typeof options.budgetMs !== "number" ||
    !Number.isFinite(options.budgetMs) ||
    !Number.isSafeInteger(options.budgetMs) ||
    options.budgetMs <= 0
  )
    throw new SuggestionViewError("invalid-argument", "The replay budget must be a positive finite integer of milliseconds");
  if (options.expectedInitialTreeDigest !== undefined && options.expectedInitialTreeDigest !== options.artefact.initialTreeDigest)
    throw new SuggestionViewError(
      "initial-state-changed",
      `The pinned initial tree digest changed: the artefact recorded ${options.artefact.initialTreeDigest} but replay was given ${options.expectedInitialTreeDigest}`,
    );
  if (
    options.expectedScheduleManifestSha256 !== undefined &&
    options.expectedScheduleManifestSha256 !== options.artefact.scheduleManifestSha256
  )
    throw new SuggestionViewError(
      "identity-mismatch",
      `The frozen schedule manifest digest changed: the artefact recorded ${options.artefact.scheduleManifestSha256} but replay was given ${options.expectedScheduleManifestSha256}`,
    );
  if (!isArrayValue(options.expectedFixtureFiles) || options.expectedFixtureFiles.length === 0)
    throw new SuggestionViewError(
      "invalid-argument",
      "Replay requires the actual transport fixture files by whole-file digest so it can verify them against the artefact's final binding",
    );
  {
    const byName = (files: readonly SuggestionFixtureFileRef[]): readonly SuggestionFixtureFileRef[] =>
      [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const recorded = canonicalJson(asJson(byName(options.artefact.fixtureFiles)));
    const given = canonicalJson(asJson(byName(options.expectedFixtureFiles)));
    if (recorded !== given)
      throw new SuggestionViewError(
        "fixture-mismatch",
        options.artefact.fixtureFiles.length === 0
          ? "The artefact pinned no final fixture files (unbound) but replay was given fixture files; an unbound artefact is not complete replay validity"
          : "The transport fixture files replay will use do not match the artefact's record-once final fixture binding",
      );
  }
  if (typeof options.onInvalid !== "function")
    throw new SuggestionViewError("invalid-argument", "Replay onInvalid must be a function");

  const artefact = options.artefact;
  const readByNode = new Map(artefact.reads.map((read) => [read.readerNode, read]));
  const suggestByRead = new Map<string, SuggestionRequestRecord>();
  for (const record of artefact.suggestRequests)
    suggestByRead.set(`${record.readerNode}\u0000${record.occurrence}`, record);

  class Replay extends SuggestionSessionCore {
    private budgetStartedAt: number | null = null;

    constructor() {
      super(artefact.workflow, options.onInvalid);
      // Frozen views are known at construction for research producers;
      // dependency validation ran in verifySuggestionArtefact (existence,
      // self-dependency, acyclicity). A collate producer never reads, so it
      // carries no frozen view and never matches a suggestion preparation.
      for (const producer of this.producers) {
        if ((producer.op.kind ?? "research") === "collate") continue;
        const read = readByNode.get(producer.op.node);
        if (read === undefined)
          throw new SuggestionViewError("invalid-artefact", `No frozen read record for research workflow node "${producer.op.node}"`);
        producer.view = read.view;
      }
    }

    private slugOf(reportPath: string): string {
      return relative(artefact.displayRoot, dirname(reportPath));
    }

    private remainingBudgetMs(): number {
      if (this.budgetStartedAt === null) {
        this.budgetStartedAt = performance.now();
        return options.budgetMs;
      }
      return options.budgetMs - (performance.now() - this.budgetStartedAt);
    }

    private async waitForDependencies(
      dependencies: readonly string[],
      reader: ProducerRuntime,
      signal: AbortSignal,
    ): Promise<void> {
      const missing: ProducerRuntime[] = [];
      for (const node of dependencies) {
        const producer = this.byNode.get(node);
        if (producer === undefined)
          this.fault("invalid-artefact", `Dependency "${node}" is not a declared producer`);
        if (producer.status === "failed" || producer.status === "witnessed")
          this.fault(
            "producer-failed",
            `Required producer "${node}" failed before the candidate read of "${reader.op.node}"`,
          );
        if (producer.status !== "indexed") missing.push(producer);
      }
      if (missing.length === 0) return;
      const remaining = this.remainingBudgetMs();
      if (remaining <= 0)
        this.fault(
          "budget-expired",
          `The suggestion visibility budget of ${options.budgetMs}ms expired before the candidate read of "${reader.op.node}"`,
        );
      this.observe({
        kind: "visibility-wait",
        node: reader.op.node,
        query: reader.op.query,
        occurrence: reader.op.occurrence,
        waitedFor: missing.map((producer) => producer.op.node),
        blockBudgetMs: options.budgetMs,
      });
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const waiter: ProducerWaiter = {
          onProducerSettled: (producer) => {
            if (settled) return;
            if (producer.status === "failed" || producer.status === "witnessed") {
              finish(() =>
                reject(
                  new SuggestionViewError(
                    "producer-failed",
                    `Required producer "${producer.op.node}" failed while "${reader.op.node}" waited for index visibility`,
                  ),
                ),
              );
              return;
            }
            if (producer.status === "indexed" && missing.every((p) => p.status === "indexed"))
              finish(() => resolve());
          },
        };
        const cleanup = () => {
          if (timer !== undefined) clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          for (const producer of missing) producer.waiters.delete(waiter);
        };
        const finish = (settle: () => void) => {
          if (settled) return;
          settled = true;
          cleanup();
          settle();
        };
        const onAbort = () => {
          finish(() => reject(signal.reason ?? new Error("Suggestion visibility wait aborted")));
        };
        // Every timer and listener is removed before callback settlement.
        timer = setTimeout(
          () =>
            finish(() =>
              reject(
                new SuggestionViewError(
                  "budget-expired",
                  `The suggestion visibility budget of ${options.budgetMs}ms expired while "${reader.op.node}" waited for ${missing.map((p) => p.op.node).join(", ")}`,
                ),
              ),
            ),
          remaining,
        );
        for (const producer of missing) producer.waiters.add(waiter);
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
    }

    private classifyCurrentRow(row: IndexCandidate): { kind: "baseline" } | { kind: "block-local"; producer: string } {
      const matches: ProducerRuntime[] = [];
      for (const producer of this.producers) {
        const reservation = producer.reservation;
        if (reservation === null) continue;
        if (
          row.namespace === "v1" &&
          row.startedUtc === reservation.startedUtc &&
          row.compatibilityKey === reservation.compatibilityKey &&
          row.query === producer.op.query &&
          dirname(row.reportPath) === reservation.displayPath
        )
          matches.push(producer);
      }
      if (matches.length > 1)
        this.fault(
          "ambiguous-candidate",
          `A current candidate row (path ${row.reportPath}) matches the reservations of ${matches.map((p) => p.op.node).join(" and ")}`,
        );
      if (matches.length === 1) return { kind: "block-local", producer: matches[0].op.node };
      if (artefact.baseline.some((entry) => candidatesEqual(entry, row))) return { kind: "baseline" };
      this.fault(
        "unexpected-candidate",
        `A current candidate row (query "${row.query}", path ${row.reportPath}) is neither an exact frozen-baseline member nor a declared block producer`,
      );
    }

    private currentRowForEntry(entry: SuggestionViewEntry, rows: readonly IndexCandidate[]): IndexCandidate {
      if (entry.origin.kind === "baseline") {
        const found = rows.filter((row) => candidatesEqual(row, entry));
        if (found.length === 0)
          this.fault(
            "missing-required-candidate",
            `The frozen baseline candidate (query "${entry.query}", path ${entry.reportPath}) is absent from the current read; a displaced or altered baseline invalidates the block`,
          );
        if (found.length > 1)
          this.fault("duplicate-candidate", `The current read contains the frozen baseline candidate ${entry.reportPath} twice`);
        return found[0];
      }
      const producer = this.byNode.get(entry.origin.producer);
      if (producer === undefined) this.fault("invalid-artefact", `Dependency "${entry.origin.producer}" is not a declared producer`);
      const reservation = producer.reservation;
      if (reservation === null)
        this.fault(
          "missing-required-candidate",
          `Required producer "${producer.op.node}" has no current allocation, so its candidate cannot be verified`,
        );
      const found = rows.filter(
        (row) =>
          row.namespace === "v1" &&
          row.startedUtc === reservation.startedUtc &&
          row.compatibilityKey === reservation.compatibilityKey &&
          row.query === producer.op.query &&
          dirname(row.reportPath) === reservation.displayPath,
      );
      if (found.length === 0)
        this.fault(
          "missing-required-candidate",
          `The candidate of required producer "${producer.op.node}" is absent from the current read; publication, indexing or the candidate window hid it`,
        );
      if (found.length > 1)
        this.fault("duplicate-candidate", `The current read contains the candidate of "${producer.op.node}" twice`);
      return found[0];
    }

    async candidates(input: {
      readonly operationId: string;
      readonly current: RunReservation | undefined;
      readonly query: string;
      readonly signal: AbortSignal;
      readonly readVerified: () => Promise<readonly IndexCandidate[]>;
    }): Promise<readonly IndexCandidate[]> {
      this.assertNotInvalid();
      const producer = this.bindRead(input.query, input.operationId, input.current);
      const read = readByNode.get(producer.op.node)!;
      try {
        await this.waitForDependencies(read.dependencies, producer, input.signal);
      } catch (error) {
        if (input.signal.aborted) this.faultCancelled(input.signal);
        if (error instanceof SuggestionViewError) this.fault(error.reason, error.message);
        this.fault("cancelled", `The visibility wait of "${producer.op.node}" failed: ${String(error)}`);
      }
      const rows = await this.verifiedRead(input.readVerified, input.signal);
      this.assertNotInvalid();
      const selected: IndexCandidate[] = [];
      const used = new Set<IndexCandidate>();
      for (const entry of read.view) {
        const row = this.currentRowForEntry(entry, rows);
        if (used.has(row))
          this.fault("duplicate-candidate", `The projection of "${producer.op.node}" selected one current row twice`);
        selected.push(row);
        used.add(row);
      }
      const excluded: string[] = [];
      for (const row of rows) {
        if (used.has(row)) continue;
        const origin = this.classifyCurrentRow(row);
        if (origin.kind === "block-local") {
          if (read.view.some((entry) => entry.origin.kind === "block-local" && entry.origin.producer === origin.producer))
            this.fault(
              "ambiguous-candidate",
              `Two current rows compete for the frozen view entry of producer "${origin.producer}"`,
            );
          excluded.push(origin.producer);
          continue;
        }
        this.fault(
          "unexpected-candidate",
          `A baseline candidate absent from the frozen view appeared in the current read (query "${row.query}", path ${row.reportPath}); an altered baseline or index invalidates the block`,
        );
      }
      producer.currentRows = selected;
      producer.readBound = true;
      this.observeRead(producer, read.view);
      this.observe({
        kind: "projection",
        node: producer.op.node,
        query: producer.op.query,
        occurrence: producer.op.occurrence,
        excludedProducers: excluded,
      });
      return selected;
    }

    prepare(request: ModelFixtureRequest): Json {
      this.assertNotInvalid();
      if (request.role !== "suggest") return asJson(request);
      if (typeof request.userMessage !== "string")
        this.fault("message-mismatch", "A suggestion request arrived without a text user message");
      let matched: ProducerRuntime | null = null;
      let segments: readonly SuggestionSegment[] | null = null;
      for (const producers of this.byQuery.values()) {
        const latest = [...producers].reverse().find((producer) => producer.started && producer.readBound && producer.view !== null);
        if (latest === undefined || latest.currentRows === null) continue;
        const view = latest.view ?? [];
        const rows = latest.currentRows;
        const candidateSegments = buildSuggestionSegments(
          latest.op.query,
          view.map((entry, index) => {
            if (entry.origin.kind === "block-local") {
              const row = rows[index];
              if (row === undefined)
                this.fault("canonical-mismatch", `The projection of "${latest.op.node}" is shorter than its frozen view`);
              return {
                query: entry.query,
                slug: this.slugOf(row.reportPath),
                startedUtc: row.startedUtc,
                bindingProducer: entry.origin.producer,
              };
            }
            return {
              query: entry.query,
              slug: this.slugOf(entry.reportPath),
              startedUtc: entry.startedUtc,
              bindingProducer: null,
            };
          }),
        );
        const candidateValues = new Map<string, SuggestionBindingValues>();
        view.forEach((entry, index) => {
          if (entry.origin.kind !== "block-local") return;
          const row = rows[index];
          if (row === undefined)
            this.fault("canonical-mismatch", `The projection of "${latest.op.node}" is shorter than its frozen view`);
          candidateValues.set(entry.origin.producer, {
            slug: this.slugOf(row.reportPath),
            startedUtc: row.startedUtc,
          });
        });
        let rendered: string;
        try {
          rendered = renderSuggestionSegments(candidateSegments, candidateValues);
        } catch (error) {
          if (error instanceof SuggestionViewError) this.fault(error.reason, `Suggestion message rendering failed: ${error.message}`);
          throw error;
        }
        if (rendered === request.userMessage) {
          if (matched !== null)
            this.fault(
              "ambiguous-candidate",
              `The suggestion judge request matches the read views of "${matched.op.node}" and "${latest.op.node}"`,
            );
          matched = latest;
          segments = candidateSegments;
        }
      }
      if (matched === null || segments === null)
        this.fault(
          "message-mismatch",
          "The suggestion judge request does not match the latest projected read view of any workflow query",
        );
      const view = matched.view ?? [];
      if (view.length === 0)
        this.fault(
          "unexpected-suggest-request",
          `A suggestion judge request arrived for the empty frozen view of "${matched.op.node}"`,
        );
      const identity = {
        readerNode: matched.op.node,
        occurrence: matched.op.occurrence,
        query: matched.op.query,
      };
      const viewSha256 = suggestionViewSha256(identity, view);
      const canonical = asJson({
        model: request.model,
        role: request.role,
        systemPrompt: request.systemPrompt,
        maxTokens: request.maxTokens,
        reasoning: request.reasoning,
        effectivePayloadPatch: request.effectivePayloadPatch,
        f7Suggestion: {
          marker: F7_SUGGESTION_MARKER,
          amendmentVersion: F7_AMENDMENT_VERSION,
          artefact: { scenario: artefact.scenario, block: artefact.block },
          view: { ...identity, viewSha256 },
          segments,
        },
      });
      const frozen = suggestByRead.get(`${identity.readerNode}\u0000${identity.occurrence}`) ?? null;
      if (frozen === null)
        this.fault(
          "unexpected-suggest-request",
          `A suggestion judge request arrived for the read of "${identity.readerNode}", which recorded none`,
        );
      if (sha256Canonical(canonical) !== frozen.canonicalSha256)
        this.fault(
          "canonical-mismatch",
          `The projected canonical suggestion request of "${identity.readerNode}" does not match the frozen artefact representation`,
        );
      matched.prepareAttempts += 1;
      matched.prepareBound = true;
      this.observe({
        kind: "suggest-prepared",
        node: identity.readerNode,
        query: identity.query,
        occurrence: identity.occurrence,
        attempt: matched.prepareAttempts,
        bindings: segments.filter((segment) => segment.kind === "binding").length,
      });
      return canonical;
    }

    reportHostWitness(input: SuggestionHostWitnessInput): void {
      super.reportHostWitness(input);
    }

    assertReplayComplete(): void {
      // Distinct from the sticky-error assertValid(): a fault-free session
      // whose controller reads never entered the library (for example a
      // native wrapper poisoned before every read) still fails here. Nothing
      // is fabricated: only what actually happened can satisfy the check.
      this.assertValid();
      for (const producer of this.producers) {
        if (!producer.started)
          this.fault(
            "incomplete-block",
            `Producer "${producer.op.node}" was never driven at replay`,
          );
        if ((producer.op.kind ?? "research") === "research" && !producer.readBound)
          this.fault(
            "incomplete-block",
            `The frozen candidate read of "${producer.op.node}" was never performed at replay`,
          );
      }
      for (const record of artefact.suggestRequests) {
        const producer = this.byNode.get(record.readerNode);
        if (producer === undefined)
          this.fault("invalid-artefact", `Suggestion request references unknown reader "${record.readerNode}"`);
        if (producer !== undefined && !producer.prepareBound)
          this.fault(
            "incomplete-block",
            `The frozen suggestion judge request of "${record.readerNode}" was never replayed`,
          );
      }
    }
  }

  const replay = new Replay();
  const session: SuggestionViewReplay = {
    controller: Object.freeze({
      allocated: (input) => replay.onAllocated(input.operationId, input.query, input.reservation),
      indexed: (input) => replay.onIndexed(input.operationId, input.run),
      unavailable: (input) => replay.onUnavailable(input.operationId, input.query, input.phase),
      candidates: (input) => replay.candidates(input),
    } satisfies NativeSuggestionReadView),
    prepare: (request) => replay.prepare(request),
    reportHostWitness: (input) => replay.reportHostWitness(input),
    assertValid: () => replay.assertValid(),
    observations: () => replay.observationsList(),
    assertReplayComplete: () => replay.assertReplayComplete(),
  };
  return session;
}

// ---------------------------------------------------------------------------
// Transport preparation integration
// ---------------------------------------------------------------------------

/** Extracts and validates the F7 projection from a canonical suggestion request. */
export function f7ProjectionOf(canonical: Json): F7SuggestionProjection {
  const projection = (canonical as { f7Suggestion?: unknown }).f7Suggestion;
  if (
    !isRecord(projection) ||
    projection.marker !== F7_SUGGESTION_MARKER ||
    !isRecord(projection.view) ||
    !isRecord(projection.artefact)
  )
    throw new SuggestionViewError("canonical-mismatch", "The canonical request carries no F7 suggestion projection");
  return projection as unknown as F7SuggestionProjection;
}

/**
 * Builds the benchmark-only transport preparation hook wiring a recorder or
 * replay session into `createModelTransportReplay`. The coordinator records
 * with the same preparation used for replay. Role derivation uses the
 * supplied resolver (role-distinct system prompts); the operation node of a
 * suggestion request is derived from the CANONICAL representation (never
 * the raw message), defaulting to `<readerNode>.suggest`. Every other
 * request is passed through byte-exact with the resolver's node.
 */
export function createSuggestionTransportPreparation(options: {
  readonly session: SuggestionViewSession;
  readonly resolveNode: ModelNodeResolver;
  /** Optional override for the suggestion judge node derivation. */
  readonly suggestNode?: (view: SuggestionProjectionViewIdentity) => string;
}): ModelRequestPreparer {
  const suggestNode = options.suggestNode ?? ((view) => `${view.readerNode}.suggest`);
  return (request, model, context) => {
    const resolution = options.resolveNode(request, model, context);
    if ("ambiguous" in resolution)
      throw new ReplayMissError(
        "ambiguous-node",
        `Ambiguous model node derivation during suggestion transport preparation: ${resolution.detail}`,
      );
    const canonical = options.session.prepare({ ...request, role: resolution.role });
    const operationNode =
      resolution.role === "suggest" ? suggestNode(f7ProjectionOf(canonical).view) : resolution.operationNode;
    return { request: canonical, operationNode, role: resolution.role };
  };
}
