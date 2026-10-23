// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// M4 physical cache growth and recovery qualification (C21-C28 / T21-T28).
//
// Profiles: `default` (plain `npm test`) keeps every ordinary deterministic
// test small; `full` (driven by scripts/qualify-cache-growth.mts) runs the
// real production ceilings: the 16 MiB structural query limit, a real
// committed population against the 128 MiB secondary-index budget, the
// physical 100000-entry whole-parent scan boundary, the pinned pi-v0.19.0
// old/new writer processes and the non-destructive recovery drill.
//
// All byte and timing numbers are raw observations on one host. No timing,
// memory or platform promise is asserted anywhere in this file.

import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  truncate,
  writeFile,
} from "node:fs/promises";
import { join, relative } from "node:path";
import { createRunStore, rebuildRunIndex } from "../src/core/run-store.js";
import { readRunIndex } from "../src/core/run-index.js";
import { readNamespace, validateJournal, verifyCommittedRun } from "../src/core/run-journal.js";
import {
  CANDIDATE_WINDOW,
  INDEX_FILE,
  INDEX_MAX_BYTES,
  JOURNAL_FILE,
  JOURNAL_MAX_BYTES,
  MARKER_FILE,
  NAMESPACE_DIR,
  RESERVATION_FILE,
  RUNS_DIR,
  STRUCTURAL_MAX_BYTES,
  encodeRecord,
  type IndexRecord,
} from "../src/core/run-format.js";
import { resolveWorkspacePaths } from "../src/core/paths.js";
import { parseConfig } from "../packages/mcp/src/config.js";
import { createRuntime, StandaloneError } from "../packages/mcp/src/runtime.js";
import { assertWorkspaceSafe } from "../packages/mcp/src/workspace.js";
import { manifestFor, storeOptions } from "./helpers/run-store-fixtures.js";
import type { Artifact, CommittedRun, Diagnostic, RunReservation } from "../src/core/execution-contracts.js";
import {
  OLD_WRITER_COMMIT,
  OLD_WRITER_TAG,
  OldSourceUnavailable,
  evidenceDir,
  extractOldWriterSource,
  growthProfile,
  growthScratchRoot,
  hashTree,
  queryOfLength,
  runGrowthWorker,
  sha256File,
} from "./helpers/cache-growth-worker.js";

const PROFILE = growthProfile();
const EVIDENCE = evidenceDir();
const never = new AbortController().signal;
const LEGACY_SLUG = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]{1,200}$/;

interface Summary {
  profile: string;
  startedAt: string;
  finishedAt?: string;
  note: string;
  q1: unknown[];
  q2a?: unknown;
  q2b?: unknown;
  q3?: unknown;
  q4?: unknown;
  q4shape?: unknown;
  q5?: unknown;
  q6?: unknown;
}

const summary: Summary = {
  profile: PROFILE,
  startedAt: new Date().toISOString(),
  note: "Raw one-host observations. Byte counts are filesystem sizes, entry counts are directory or record counts, and elapsed values are wall-clock milliseconds. No whole-process heap cap, latency promise or unsupported-platform claim is implied.",
  q1: [],
};

async function record(event: Record<string, unknown>): Promise<void> {
  if (!EVIDENCE) return;
  await appendFile(
    join(EVIDENCE, "observations.ndjson"),
    JSON.stringify({ ...event, at: new Date().toISOString() }) + "\n",
  );
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Lean artefact set: the query text lands only in query.txt and the marker. */
function leanArtifacts(query: string): Artifact[] {
  const text = (value: string) => new TextEncoder().encode(value);
  return [
    {
      relativePath: "report.md",
      kind: "report",
      bytes: text("# Qualifier report\n\nGrowth qualification synthetic report.\n"),
    },
    { relativePath: "query.txt", kind: "query", bytes: text(query) },
    { relativePath: "run.json", kind: "manifest-data", bytes: encodeRecord(manifestFor([])) },
    { relativePath: "sources/S1.md", kind: "source", bytes: text("synthetic source") },
    { relativePath: "extractions/S1.md", kind: "extraction", bytes: text("synthetic extraction") },
  ];
}

interface CommittedOne {
  readonly reservation: RunReservation;
  readonly markerSha256: string;
  readonly store: ReturnType<typeof createRunStore>;
  readonly run: CommittedRun;
  readonly updateIndexStatus?: "updated" | "unavailable";
}

async function commitOne(
  root: string,
  query: string,
  options: {
    readonly operationId?: string;
    readonly diagnostics?: Diagnostic[];
    readonly updateIndex?: boolean | "expect-unavailable";
    readonly artifacts?: readonly Artifact[];
  } = {},
): Promise<CommittedOne> {
  const diagnostics = options.diagnostics ?? [];
  const store = createRunStore(
    storeOptions(root, { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) }),
  );
  const allocation = await store.allocate({
    operationId: options.operationId ?? `op-${Math.random().toString(36).slice(2, 10)}`,
    query,
    startedUtc: new Date().toISOString(),
    signal: never,
  });
  assert.equal(allocation.status, "allocated", JSON.stringify(allocation));
  if (allocation.status !== "allocated") throw new Error("unreachable");
  const commit = await store.commit(
    allocation.reservation,
    options.artifacts ?? leanArtifacts(query),
    never,
  );
  assert.equal(commit.status, "committed", JSON.stringify(commit));
  if (commit.status !== "committed") throw new Error("unreachable");
  let updateIndexStatus: "updated" | "unavailable" | undefined;
  if (options.updateIndex === true || options.updateIndex === "expect-unavailable") {
    updateIndexStatus = await store.updateIndex(commit.run, query, never);
    assert.equal(updateIndexStatus, options.updateIndex === true ? "updated" : "unavailable");
  }
  await store.settle();
  return { reservation: allocation.reservation, markerSha256: commit.run.manifestSha256, store, run: commit.run, updateIndexStatus };
}

async function namespaceState(root: string) {
  const namespaceDir = join(root, NAMESPACE_DIR);
  const namespace = await readNamespace(namespaceDir);
  assert.ok(namespace, "namespace identity exists");
  return {
    namespaceDir,
    namespaceId: namespace.namespaceId,
    journal: await validateJournal(namespaceDir, namespace.namespaceId, "writer"),
  };
}

/** Synthetic legacy evidence at a cache root: .index.json plus one report. */
async function writeLegacyShape(
  cacheRoot: string,
  slug: string,
  query: string,
  timestamp = "2026-10-18T09:00:00.000Z",
): Promise<void> {
  await mkdir(join(cacheRoot, slug), { recursive: true });
  await writeFile(join(cacheRoot, slug, "report.md"), `Legacy report for ${query}\n`);
  await writeFile(join(cacheRoot, slug, "query.txt"), query);
  await writeFile(
    join(cacheRoot, ".index.json"),
    JSON.stringify({ searches: [{ slug, query, timestamp }] }),
  );
}

/** Candidate report paths are display paths over the ".search" alias. */
function physicalFor(cacheRoot: string, reportPath: string): string {
  return join(cacheRoot, relative(".search", reportPath));
}

/**
 * Minimal standalone configuration document for the MCP runtime boundary
 * proof. The API key environment variable holds a synthetic value and the
 * injected transport is denied: no catalogue or inference call may happen
 * before the WORKSPACE gate.
 */
function standaloneDocument() {
  return {
    providers: { openrouter: { apiKeyEnv: "INTELLI_GROWTH_FIXTURE_KEY" } },
    models: {
      search: { provider: "openrouter", model: "perplexity/sonar" },
      extract: { provider: "openrouter", model: "fixture/extract" },
      collate: { provider: "openrouter", model: "fixture/collate" },
    },
    tuning: {
      llmRetryAttempts: 2,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0,
      llmTimeoutMs: 1000,
      disableLlmsFullDiscovery: true,
    },
  };
}

function lines(stdout: string): Record<string, unknown>[] {
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/**
 * Full-profile datasets are evidence: they remain in owned encrypted scratch
 * after success. The small default (CI-sized) fixtures may clean up. Failed
 * scenarios always retain their scratch (the cleanup call is simply skipped
 * when an assertion throws earlier).
 */
async function finishScenario(root: string, label: string): Promise<void> {
  if (PROFILE === "full") {
    await record({ scenario: "scratch-retained", label, path: root });
    return;
  }
  await rm(root, { recursive: true, force: true });
}

describe(`M4 cache growth and recovery qualification (profile: ${PROFILE})`, () => {
  after(async () => {
    summary.finishedAt = new Date().toISOString();
    if (!EVIDENCE) return;
    await writeFile(join(EVIDENCE, "summary.json"), JSON.stringify(summary, null, 2));
    process.stdout.write(`evidence summary: ${join(EVIDENCE, "summary.json")}\n`);
  });

  it("q1: committed run-store growth records allocation, index and candidate-read costs", async () => {
    const populations = PROFILE === "full" ? [4, 64, 256, 1024] : [4, 16];
    for (const population of populations) {
      const root = await growthScratchRoot(`q1-growth-${population}`);
      const diagnostics: Diagnostic[] = [];
      const allocateMs: number[] = [];
      const commitMs: number[] = [];
      const indexMs: number[] = [];
      const startedAt = performance.now();
      for (let i = 0; i < population; i++) {
        const query = `growth curve population ${population} query ${i}`;
        const store = createRunStore(
          storeOptions(root, { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) }),
        );
        const t0 = performance.now();
        const allocation = await store.allocate({
          operationId: `op-q1-${population}-${i}`,
          query,
          startedUtc: new Date().toISOString(),
          signal: never,
        });
        const t1 = performance.now();
        assert.equal(allocation.status, "allocated", JSON.stringify(allocation));
        if (allocation.status !== "allocated") throw new Error("unreachable");
        const commit = await store.commit(allocation.reservation, leanArtifacts(query), never);
        const t2 = performance.now();
        assert.equal(commit.status, "committed", JSON.stringify(commit));
        if (commit.status !== "committed") throw new Error("unreachable");
        const index = await store.updateIndex(commit.run, query, never);
        const t3 = performance.now();
        assert.equal(index, "updated");
        await store.settle();
        allocateMs.push(t1 - t0);
        commitMs.push(t2 - t1);
        indexMs.push(t3 - t2);
      }
      const elapsedMs = performance.now() - startedAt;
      assert.deepEqual(diagnostics, [], "no diagnostics on the committed growth path");
      const { namespaceDir, namespaceId, journal } = await namespaceState(root);
      const sequences = [...journal.records.values()]
        .map((entry) => entry.sequence)
        .sort((a, b) => a - b);
      assert.deepEqual(sequences, Array.from({ length: population }, (_, i) => i + 1));
      const read = await readRunIndex(namespaceDir, namespaceId);
      assert.equal(read.status, "valid");
      if (read.status !== "valid") throw new Error("unreachable");
      assert.equal(read.index?.entries.length, population);
      const journalBytes = (await stat(join(namespaceDir, JOURNAL_FILE))).size;
      const indexBytes = (await stat(join(namespaceDir, INDEX_FILE))).size;
      const runDirs = (await readdir(join(namespaceDir, RUNS_DIR))).length;
      assert.equal(runDirs, population);
      const reader = createRunStore(storeOptions(root));
      const c0 = performance.now();
      const candidates = await reader.candidates(undefined, "unrelated current query", never);
      const candidateMs = performance.now() - c0;
      assert.equal(candidates.length, Math.min(population, CANDIDATE_WINDOW));
      // Sampled verified reads, always including the first and last admission.
      const runIds = [...journal.records.keys()];
      const sample = new Set([
        runIds[0],
        runIds[runIds.length - 1],
        runIds[Math.floor(runIds.length / 3)],
        runIds[Math.floor((2 * runIds.length) / 3)],
      ]);
      for (const runId of sample)
        assert.equal(
          (await verifyCommittedRun(namespaceDir, namespaceId, runId, journal.records.get(runId)))
            .ok,
          true,
          `sampled run ${runId} still verifies`,
        );
      await record({
        scenario: "q1-growth",
        population,
        elapsedMs: round(elapsedMs),
        journalBytes,
        indexBytes,
        runDirs,
        candidateMs: round(candidateMs),
        candidateCount: candidates.length,
        allocateMs: allocateMs.map(round),
        commitMs: commitMs.map(round),
        indexMs: indexMs.map(round),
      });
      summary.q1.push({
        population,
        elapsedMs: round(elapsedMs),
        journalBytes,
        indexBytes,
        runDirs,
        candidateMs: round(candidateMs),
        allocateMsMedian: round(median(allocateMs)),
        commitMsMedian: round(median(commitMs)),
        indexMsMedian: round(median(indexMs)),
      });
      await finishScenario(root, "q1");
    }
  });

  it("q2a: exact structural-limit query bytes at the allocation and marker boundaries", async (t) => {
    if (PROFILE !== "full")
      return t.skip(
        "full profile only: commits a real query at the 16 MiB STRUCTURAL_MAX_BYTES ceiling",
      );
    const root = await growthScratchRoot("q2a-structural");
    const diagnostics: Diagnostic[] = [];
    const store = () =>
      createRunStore(
        storeOptions(root, { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) }),
      );
    // Allocation boundary: encodeRecord adds two quotes and one newline.
    const qAt = "a".repeat(STRUCTURAL_MAX_BYTES - 3);
    assert.equal(encodeRecord(qAt).byteLength, STRUCTURAL_MAX_BYTES);
    const at = await store().allocate({
      operationId: "q2a-at-ceiling",
      query: qAt,
      startedUtc: "2026-10-18T12:00:00.000Z",
      signal: never,
    });
    assert.equal(at.status, "allocated", JSON.stringify(at));
    const qOver = "a".repeat(STRUCTURAL_MAX_BYTES - 2);
    assert.equal(encodeRecord(qOver).byteLength, STRUCTURAL_MAX_BYTES + 1);
    const over = await store().allocate({
      operationId: "q2a-over-ceiling",
      query: qOver,
      startedUtc: "2026-10-18T12:00:00.000Z",
      signal: never,
    });
    assert.equal(over.status, "unavailable");
    if (over.status !== "unavailable") throw new Error("unreachable");
    assert.equal(over.diagnostic.code, "QUERY_TOO_LARGE");
    // Marker boundary, measured empirically: the marker is a fixed body plus
    // the query text plus the decimal length of query.txt's byte count, so two
    // same-magnitude probes measure an exact one-byte-per-query-byte slope.
    const markerSize = async (committed: CommittedOne) =>
      (await stat(join(committed.reservation.physicalPath, MARKER_FILE))).size;
    const PROBE = 1_000_000;
    const probe1 = await commitOne(root, "a".repeat(PROBE), {
      operationId: "q2a-probe-1",
      diagnostics,
    });
    const probe2 = await commitOne(root, "a".repeat(2 * PROBE), {
      operationId: "q2a-probe-2",
      diagnostics,
    });
    const bytesAtProbe1 = await markerSize(probe1);
    const bytesAtProbe2 = await markerSize(probe2);
    assert.equal(
      bytesAtProbe2 - bytesAtProbe1,
      PROBE,
      "marker bytes grow exactly one per query byte for escape-free ASCII",
    );
    const decimalDigits = (value: number) => String(value).length;
    const markerBytesFor = (queryBytes: number) =>
      bytesAtProbe1 + (queryBytes - PROBE) + (decimalDigits(queryBytes) - decimalDigits(PROBE));
    const qMax = STRUCTURAL_MAX_BYTES - bytesAtProbe1 + PROBE - 1; // 8-digit byte counts
    assert.equal(decimalDigits(qMax), 8, "the boundary query sits in the measured digit range");
    assert.equal(markerBytesFor(qMax), STRUCTURAL_MAX_BYTES);
    const envelope = bytesAtProbe1 - PROBE - decimalDigits(PROBE);
    const atCap = await commitOne(root, "a".repeat(qMax), {
      operationId: "q2a-marker-at-cap",
      diagnostics,
    });
    const atCapMarkerBytes = await markerSize(atCap);
    assert.equal(atCapMarkerBytes, STRUCTURAL_MAX_BYTES, "marker at the exact structural ceiling");
    // One byte over: publication refuses, preserves the directory, consumes
    // its sequence and never reuses it.
    const refusalStore = store();
    const overAllocation = await refusalStore.allocate({
      operationId: "q2a-marker-over",
      query: "a".repeat(qMax + 1),
      startedUtc: "2026-10-18T12:00:00.000Z",
      signal: never,
    });
    assert.equal(overAllocation.status, "allocated", JSON.stringify(overAllocation));
    if (overAllocation.status !== "allocated") throw new Error("unreachable");
    const overCommit = await refusalStore.commit(
      overAllocation.reservation,
      leanArtifacts("a".repeat(qMax + 1)),
      never,
    );
    assert.equal(overCommit.status, "unavailable");
    if (overCommit.status !== "unavailable") throw new Error("unreachable");
    assert.equal(overCommit.diagnostic.code, "MARKER_TOO_LARGE");
    const overDir = overAllocation.reservation.physicalPath;
    await assert.rejects(stat(join(overDir, MARKER_FILE)), { code: "ENOENT" });
    const preserved = await readdir(overDir);
    assert.ok(preserved.includes("query.txt"), "uncommitted evidence is preserved");
    assert.ok(preserved.includes(RESERVATION_FILE));
    const { namespaceDir, namespaceId, journal } = await namespaceState(root);
    for (const runId of [probe1.reservation.runId, probe2.reservation.runId, atCap.reservation.runId])
      assert.equal(
        (await verifyCommittedRun(namespaceDir, namespaceId, runId, journal.records.get(runId)))
          .ok,
        true,
        `committed run ${runId} is preserved after the refusal`,
      );
    const after = await store().allocate({
      operationId: "q2a-after-refusal",
      query: "after the marker refusal",
      startedUtc: "2026-10-18T12:00:00.000Z",
      signal: never,
    });
    assert.equal(after.status, "allocated");
    if (after.status !== "allocated") throw new Error("unreachable");
    assert.equal(
      after.reservation.sequence,
      overAllocation.reservation.sequence + 1,
      "the refused publication's sequence is never reused",
    );
    const journalBytes = (await stat(join(namespaceDir, JOURNAL_FILE))).size;
    assert.ok(journalBytes < JOURNAL_MAX_BYTES / 64);
    await record({
      scenario: "q2a-structural",
      structuralMaxBytes: STRUCTURAL_MAX_BYTES,
      measuredSlopeBytesPerQueryByte: 1,
      markerBodyEnvelopeBytes: envelope,
      exactCapQueryBytes: qMax,
      exactCapMarkerBytes: atCapMarkerBytes,
      queryTooLargeRefused: true,
      markerTooLargeRefused: true,
      journalBytes,
      refusedSequenceNotReused: true,
    });
    summary.q2a = {
      structuralMaxBytes: STRUCTURAL_MAX_BYTES,
      markerBodyEnvelopeBytes: envelope,
      exactCapQueryBytes: qMax,
      exactCapMarkerBytes: atCapMarkerBytes,
      journalBytes,
    };
    await finishScenario(root, "q2a");
  });

  it("q2b: a real committed population reaches the secondary-index budget; writer and reader refuse beyond", async (t) => {
    if (PROFILE !== "full")
      return t.skip(
        "full profile only: grows a real population against the 128 MiB INDEX_MAX_BYTES budget",
      );
    const root = await growthScratchRoot("q2b-index-budget");
    await writeLegacyShape(root, "2026-10-18-legacy-presence-abc123", "legacy presence query");
    const diagnostics: Diagnostic[] = [];
    // Marker-model probes (separately labelled; they are measurement probes,
    // not the gate population): the marker is a fixed body plus the query
    // text plus the decimal length of query.txt's byte count, so two probes
    // measure the exact largest committable query without lowering anything.
    const markerSize = async (committed: CommittedOne) =>
      (await stat(join(committed.reservation.physicalPath, MARKER_FILE))).size;
    const PROBE = 1 << 20;
    const probe1 = await commitOne(root, "a".repeat(PROBE), {
      operationId: "q2b-marker-probe-1",
      diagnostics,
    });
    const probe2 = await commitOne(root, "a".repeat(2 * PROBE), {
      operationId: "q2b-marker-probe-2",
      diagnostics,
    });
    const bytesAtProbe1 = await markerSize(probe1);
    const bytesAtProbe2 = await markerSize(probe2);
    assert.equal(
      bytesAtProbe2 - bytesAtProbe1,
      PROBE,
      "marker bytes grow exactly one per query byte for escape-free ASCII",
    );
    const decimalDigits = (value: number) => String(value).length;
    const markerBytesFor = (queryBytes: number) =>
      bytesAtProbe1 + (queryBytes - PROBE) + (decimalDigits(queryBytes) - decimalDigits(PROBE));
    const committableBound = STRUCTURAL_MAX_BYTES - bytesAtProbe1 + PROBE - 1;
    assert.equal(decimalDigits(committableBound), 8);
    assert.equal(markerBytesFor(committableBound), STRUCTURAL_MAX_BYTES);
    // The gate population uses genuinely near-structural-limit queries: each
    // within NEAR_MARGIN bytes of the exact committable bound. The margin
    // keeps every population commit safely publishable; the exact boundary
    // itself is proved by q2a.
    const NEAR_MARGIN = 1 << 20;
    const QUERY_BYTES = committableBound - NEAR_MARGIN;
    assert.ok(QUERY_BYTES > (STRUCTURAL_MAX_BYTES * 3) / 4, `near-limit query is ${QUERY_BYTES} bytes`);
    const populationQuery = (index: number, totalBytes = QUERY_BYTES) =>
      queryOfLength(`growth budget ${index} run`, totalBytes);
    const commitPopulation = (index: number, totalBytes = QUERY_BYTES) =>
      commitOne(root, populationQuery(index, totalBytes), {
        operationId: `q2b-${index}`,
        diagnostics,
      });
    const rebuild = () =>
      rebuildRunIndex(
        storeOptions(root, { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) }),
        never,
      );
    const indexBytes = async () => (await stat(join(root, NAMESPACE_DIR, INDEX_FILE))).size;
    // Measure the real per-near-limit-entry cost from two actual rebuilds.
    await commitPopulation(0);
    let rebuilt = await rebuild();
    assert.equal(rebuilt.status, "rebuilt", JSON.stringify(rebuilt));
    if (rebuilt.status !== "rebuilt") throw new Error("unreachable");
    const bytesForOne = await indexBytes();
    await commitPopulation(1);
    rebuilt = await rebuild();
    assert.equal(rebuilt.status, "rebuilt");
    if (rebuilt.status !== "rebuilt") throw new Error("unreachable");
    const bytesForTwo = await indexBytes();
    const entryBytes = bytesForTwo - bytesForOne;
    const envelope = bytesForOne - entryBytes;
    assert.ok(entryBytes >= QUERY_BYTES, `entry carries the query bytes (measured ${entryBytes})`);
    const maxEntriesEstimate = Math.floor((INDEX_MAX_BYTES - envelope) / entryBytes);
    assert.ok(
      maxEntriesEstimate >= 5 && maxEntriesEstimate <= 64,
      `measured entry cost ${entryBytes} gives an implausible population ${maxEntriesEstimate}`,
    );
    // Later entries carry more digits (admission sequence, query prefix), so
    // the early-entry measurement can underestimate. Undershoot by two and
    // find the real boundary empirically until a rebuild actually refuses.
    const target = maxEntriesEstimate - 2;
    const populateStarted = performance.now();
    for (let i = 2; i < target; i++) await commitPopulation(i);
    const populateMs = performance.now() - populateStarted;
    rebuilt = await rebuild();
    assert.equal(rebuilt.status, "rebuilt", JSON.stringify(rebuilt));
    if (rebuilt.status !== "rebuilt") throw new Error("unreachable");
    assert.equal(rebuilt.entries, target + 2); // two probes plus the near-limit population
    assert.deepEqual(rebuilt.rejected, []);
    let bytesAtCap = await indexBytes();
    assert.ok(bytesAtCap <= INDEX_MAX_BYTES, `rebuilt index is ${bytesAtCap} bytes`);
    let committedRuns = target + 2; // probes plus near-limit runs
    let boundaryFound = false;
    for (let extra = 0; extra < 6 && !boundaryFound; extra++) {
      await commitPopulation(target + extra);
      committedRuns += 1;
      const attempt = await rebuild();
      if (attempt.status === "rebuilt") {
        bytesAtCap = await indexBytes();
        assert.ok(attempt.entries === committedRuns);
        continue;
      }
      assert.equal(attempt.status, "unavailable", JSON.stringify(attempt));
      if (attempt.status !== "unavailable") throw new Error("unreachable");
      assert.equal(attempt.diagnostic.code, "INDEX_OVERSIZED");
      boundaryFound = true;
    }
    assert.ok(boundaryFound, "the real secondary-index budget boundary was reached and refused");
    assert.ok(
      bytesAtCap > INDEX_MAX_BYTES - 2 * entryBytes,
      "the last valid index sits within two entries of the real budget",
    );
    const { namespaceDir, namespaceId } = await namespaceState(root);
    let read = await readRunIndex(namespaceDir, namespaceId);
    assert.equal(read.status, "valid");
    if (read.status !== "valid") throw new Error("unreachable");
    const validEntries = read.index?.entries.length ?? 0;
    assert.equal(validEntries, committedRuns - 1, "the last committed run is indexed; the boundary run is not");
    // Candidate read cost at the near-ceiling valid index.
    const reader = createRunStore(
      storeOptions(root, { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) }),
    );
    const c0 = performance.now();
    const candidates = await reader.candidates(undefined, "unrelated current query", never);
    const candidateMsAtCap = performance.now() - c0;
    // CANDIDATE_WINDOW caps the judge view; near-limit entries are so large
    // that the whole budget holds fewer distinct keys than the window. The
    // reader also merges the legacy-presence shape this scenario placed at
    // the cache root, so namespaces are counted separately.
    const v1Candidates = candidates.filter((candidate) => candidate.namespace === "v1");
    assert.equal(v1Candidates.length, Math.min(validEntries, CANDIDATE_WINDOW));
    assert.ok(
      candidates.some((candidate) => candidate.namespace === "legacy"),
      "the mixed reader still serves the legacy candidate",
    );
    assert.equal(candidates.length, v1Candidates.length + 1);
    const indexPath = join(namespaceDir, INDEX_FILE);
    const indexShaAtCap = await sha256File(indexPath);
    // One more near-limit publication beyond the budget: the writer refuses,
    // the run and the valid index are preserved untouched. The query stays
    // within the committable bound (the refusal under test is the index's).
    const overflowBytes = QUERY_BYTES;
    const overflow = await commitPopulation(committedRuns, overflowBytes);
    committedRuns += 1;
    const u0 = performance.now();
    assert.equal(overflow.updateIndexStatus, undefined);
    const update = await overflow.store.updateIndex(
      overflow.run,
      populationQuery(committedRuns - 1, overflowBytes),
      never,
    );
    const updateMs = performance.now() - u0;
    assert.equal(update, "unavailable");
    assert.ok(
      diagnostics.some((diagnostic) => diagnostic.code === "INDEX_OVERSIZED"),
      "the refusing update reports INDEX_OVERSIZED",
    );
    await overflow.store.settle();
    assert.equal(await sha256File(indexPath), indexShaAtCap);
    const overflowState = await namespaceState(root);
    assert.equal(
      (
        await verifyCommittedRun(
          namespaceDir,
          namespaceId,
          overflow.reservation.runId,
          overflowState.journal.records.get(overflow.reservation.runId),
        )
      ).ok,
      true,
      "the beyond-budget run is still committed and verified",
    );
    // Explicit operator rebuild also refuses and leaves the valid index in place.
    const refused = await rebuild();
    assert.equal(refused.status, "unavailable", JSON.stringify(refused));
    if (refused.status !== "unavailable") throw new Error("unreachable");
    assert.equal(refused.diagnostic.code, "INDEX_OVERSIZED");
    assert.equal(await sha256File(indexPath), indexShaAtCap);
    read = await readRunIndex(namespaceDir, namespaceId);
    assert.equal(read.status, "valid", "the untouched index remains valid");
    if (read.status !== "valid") throw new Error("unreachable");
    assert.equal(read.index?.entries.length, validEntries);
    // Already-oversized input is distinct from corruption: no preservation
    // copy, no rebuild, new-format suggestions withdrawn, legacy still served.
    diagnostics.length = 0;
    const validIndexBytes = await readFile(indexPath);
    await truncate(indexPath, INDEX_MAX_BYTES + 1);
    const withdrawn = await createRunStore(
      storeOptions(root, { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) }),
    ).candidates(undefined, "unrelated current query", never);
    assert.equal(withdrawn.filter((candidate) => candidate.namespace === "v1").length, 0);
    assert.ok(
      withdrawn.some((candidate) => candidate.namespace === "legacy"),
      "legacy candidates remain eligible while new-format ones are withdrawn",
    );
    assert.ok(diagnostics.some((diagnostic) => diagnostic.code === "INDEX_OVERSIZED"));
    assert.ok(
      !(await readdir(namespaceDir)).some((name) => name.startsWith("index.corrupt-")),
      "an oversized index is not corruption and creates no preserved corrupt copy",
    );
    await writeFile(indexPath, validIndexBytes);
    read = await readRunIndex(namespaceDir, namespaceId);
    assert.equal(read.status, "valid", "restored index is valid again");
    // The journal stayed far below its own ceiling the whole time.
    const journalBytes = (await stat(join(namespaceDir, JOURNAL_FILE))).size;
    assert.ok(
      journalBytes < JOURNAL_MAX_BYTES / 50,
      `journal is ${journalBytes} of ${JOURNAL_MAX_BYTES} bytes`,
    );
    const preservedCopies = (await readdir(namespaceDir)).filter((name) =>
      name.startsWith("index.preserved-"),
    ).length;
    await record({
      scenario: "q2b-index-budget",
      indexMaxBytes: INDEX_MAX_BYTES,
      populationKind: "near-structural-limit",
      exactCommittableQueryBytes: committableBound,
      nearMarginBytes: NEAR_MARGIN,
      populationQueryBytes: QUERY_BYTES,
      markerProbeBytes: [PROBE, 2 * PROBE],
      entryBytes,
      envelopeBytes: envelope,
      committedRuns,
      indexedRunsAtBoundary: validEntries,
      indexBytesAtBoundary: bytesAtCap,
      preservedCopies,
      populateMs: round(populateMs),
      candidateMsAtBoundary: round(candidateMsAtCap),
      updateRefusalMs: round(updateMs),
      journalBytes,
      journalCeiling: JOURNAL_MAX_BYTES,
      journalRatio: journalBytes / JOURNAL_MAX_BYTES,
    });
    summary.q2b = {
      indexMaxBytes: INDEX_MAX_BYTES,
      populationKind: "near-structural-limit",
      populationQueryBytes: QUERY_BYTES,
      exactCommittableQueryBytes: committableBound,
      committedRuns,
      indexedRunsAtBoundary: validEntries,
      indexBytesAtBoundary: bytesAtCap,
      journalBytes,
      journalRatio: journalBytes / JOURNAL_MAX_BYTES,
      populateMs: round(populateMs),
      candidateMsAtBoundary: round(candidateMsAtCap),
      updateRefusalMs: round(updateMs),
    };
    await finishScenario(root, "q2b");
  });

  it("q3: repeated corrupt-index reads rebuild in memory; a writer repairs only secondary metadata", async () => {
    const root = await growthScratchRoot("q3-corrupt-index");
    const queries = [0, 1, 2].map((i) => `corrupt index query ${i}`);
    for (const query of queries)
      await commitOne(root, query, { operationId: `q3-${query.slice(-1)}`, updateIndex: true });
    const { namespaceDir, namespaceId } = await namespaceState(root);
    const indexPath = join(namespaceDir, INDEX_FILE);
    // Corrupt the secondary index in place, keeping its exact bytes recorded.
    const validBytes = await readFile(indexPath);
    const corruptBytes = Buffer.from(validBytes);
    corruptBytes.write("XXXXX", 2, "utf8");
    await writeFile(indexPath, corruptBytes);
    const corruptSha = await sha256File(indexPath);
    for (let readCount = 1; readCount <= 3; readCount++) {
      const diagnostics: Diagnostic[] = [];
      const candidates = await createRunStore(
        storeOptions(root, { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) }),
      ).candidates(undefined, "unrelated current query", never);
      assert.deepEqual(
        candidates.map((candidate) => candidate.query).sort(),
        [...queries].sort(),
        `read ${readCount}: candidates rebuilt in memory from verified runs`,
      );
      assert.ok(
        diagnostics.some((diagnostic) => diagnostic.code === "INDEX_CORRUPT"),
        `read ${readCount}: corruption is diagnosed, never rewritten`,
      );
      assert.equal(await sha256File(indexPath), corruptSha, `read ${readCount}: corrupt bytes preserved`);
    }
    // A real writer repairs only secondary metadata and preserves the corrupt copy.
    const diagnostics: Diagnostic[] = [];
    const repair = await commitOne(root, "corrupt index repair query", {
      operationId: "q3-repair",
      updateIndex: true,
      diagnostics,
    });
    const rebuiltDiagnostic = diagnostics.find((diagnostic) => diagnostic.code === "INDEX_REBUILT");
    assert.ok(rebuiltDiagnostic, "writer reports INDEX_REBUILT");
    assert.ok(
      rebuiltDiagnostic.message.includes("index.corrupt-"),
      "the diagnostic names the preserved corrupt copy",
    );
    const preservedNames = (await readdir(namespaceDir)).filter((name) =>
      name.startsWith("index.corrupt-"),
    );
    assert.equal(preservedNames.length, 1);
    assert.equal(
      await sha256File(join(namespaceDir, preservedNames[0])),
      corruptSha,
      "the preserved copy holds the exact corrupt bytes",
    );
    let read = await readRunIndex(namespaceDir, namespaceId);
    assert.equal(read.status, "valid");
    if (read.status !== "valid") throw new Error("unreachable");
    assert.equal(read.index?.entries.length, 4);
    const finalState = await namespaceState(root);
    for (const runId of finalState.journal.records.keys())
      assert.equal(
        (
          await verifyCommittedRun(
            namespaceDir,
            namespaceId,
            runId,
            finalState.journal.records.get(runId),
          )
        ).ok,
        true,
        `run ${runId}: reservation, marker, journal and file hashes still agree`,
      );
    // A valid-but-incomplete index is a distinct case, not a corruption repair.
    read = await readRunIndex(namespaceDir, namespaceId);
    assert.ok(read.index);
    const firstEntry = read.index.entries[0];
    const incomplete: IndexRecord = {
      schema: "intelli-v1/index",
      schemaVersion: 1,
      namespaceId,
      entries: [firstEntry],
    };
    await writeFile(indexPath, encodeRecord(incomplete));
    const incompleteDiagnostics: Diagnostic[] = [];
    const incompleteCandidates = await createRunStore(
      storeOptions(root, { onDiagnostic: (diagnostic) => incompleteDiagnostics.push(diagnostic) }),
    ).candidates(undefined, "unrelated current query", never);
    assert.equal(incompleteCandidates.length, 1);
    assert.equal(incompleteCandidates[0].query, firstEntry.query);
    assert.ok(
      !incompleteDiagnostics.some(
        (diagnostic) => diagnostic.code === "INDEX_CORRUPT" || diagnostic.code === "INDEX_REBUILT",
      ),
      "a schema-valid subset is treated as valid, not repaired",
    );
    await commitOne(root, "valid incomplete append query", {
      operationId: "q3-incomplete-append",
      updateIndex: true,
      diagnostics: incompleteDiagnostics,
    });
    read = await readRunIndex(namespaceDir, namespaceId);
    assert.ok(read.index);
    assert.deepEqual(
      read.index.entries.map((entry) => entry.sequence),
      [firstEntry.sequence, repair.reservation.sequence + 1],
      "a plain update appends only the new entry; missing middle entries stay missing",
    );
    const explicit = await rebuildRunIndex(storeOptions(root), never);
    assert.equal(explicit.status, "rebuilt", JSON.stringify(explicit));
    if (explicit.status !== "rebuilt") throw new Error("unreachable");
    assert.equal(explicit.entries, 5);
    read = await readRunIndex(namespaceDir, namespaceId);
    assert.equal(read.index?.entries.length, 5, "only the explicit operator rebuild completes it");
    await record({
      scenario: "q3-corrupt-index",
      committedRuns: 3,
      repeatedReads: 3,
      corruptBytesPreserved: true,
      preservedCopy: preservedNames[0],
      repairedEntries: 4,
      validButIncompleteDistinct: true,
      rebuildCompletes: 5,
    });
    summary.q3 = {
      repeatedReads: 3,
      corruptBytesPreserved: true,
      preservedCopy: preservedNames[0],
      repairedEntries: 4,
      validButIncompleteDistinct: true,
      rebuildCompletes: 5,
    };
    await finishScenario(root, "q3");
  });

  it("q4shape: whole-parent scan accepts a legacy, staging, committed and uncommitted cache shape", async () => {
    const root = await growthScratchRoot("q4-shape");
    const paths = resolveWorkspacePaths(root, ".search", "absolute");
    await writeLegacyShape(paths.cacheRoot, "2026-10-18-legacy-shape-abc123", "legacy shape query");
    await mkdir(join(paths.stagingRoot, "pages-owned"), { recursive: true });
    await writeFile(join(paths.stagingRoot, "spool.txt"), "spool");
    await writeFile(join(paths.stagingRoot, "pages-owned", "page.md"), "page");
    const committed = await commitOne(paths.cacheRoot, "scan shape committed query", {
      operationId: "q4-shape",
    });
    const uncommittedStore = createRunStore(storeOptions(paths.cacheRoot));
    const uncommitted = await uncommittedStore.allocate({
      operationId: "q4-shape-uncommitted",
      query: "scan shape uncommitted query",
      startedUtc: new Date().toISOString(),
      signal: never,
    });
    assert.equal(uncommitted.status, "allocated");
    await uncommittedStore.settle();
    await mkdir(join(paths.cacheRoot, NAMESPACE_DIR, RUNS_DIR, "2026-01-01-orphan-empty-dir"));
    await assert.doesNotReject(assertWorkspaceSafe(paths));
    assert.ok((await stat(committed.reservation.physicalPath)).isDirectory());
    await record({ scenario: "q4-shape", accepted: true });
    summary.q4shape = { accepted: true };
    await finishScenario(root, "q4shape");
  });

  it("q4: physical whole-parent scan at the unchanged 100000-entry cap boundary", async (t) => {
    if (PROFILE !== "full")
      return t.skip("full profile only: physically creates a 100000-entry workspace population");
    const root = await growthScratchRoot("q4-scan-cap");
    const paths = resolveWorkspacePaths(root, ".search", "absolute");
    // Shaped subset: legacy, staging, committed, uncommitted and orphan entries.
    await writeLegacyShape(paths.cacheRoot, "2026-10-18-legacy-shape-abc123", "legacy shape query");
    await mkdir(join(paths.stagingRoot, "pages-owned"), { recursive: true });
    await writeFile(join(paths.stagingRoot, "spool.txt"), "spool");
    await writeFile(join(paths.stagingRoot, "pages-owned", "page.md"), "page");
    await commitOne(paths.cacheRoot, "scan cap committed query", { operationId: "q4-cap" });
    const uncommittedStore = createRunStore(storeOptions(paths.cacheRoot));
    const uncommitted = await uncommittedStore.allocate({
      operationId: "q4-cap-uncommitted",
      query: "scan cap uncommitted query",
      startedUtc: new Date().toISOString(),
      signal: never,
    });
    assert.equal(uncommitted.status, "allocated");
    await uncommittedStore.settle();
    await mkdir(join(paths.cacheRoot, NAMESPACE_DIR, RUNS_DIR, "2026-01-01-orphan-empty-dir"));
    const countEntries = async (dir: string): Promise<number> => {
      let total = 0;
      for (const name of await readdir(dir)) {
        total += 1;
        if ((await stat(join(dir, name))).isDirectory()) total += await countEntries(join(dir, name));
      }
      return total;
    };
    const shaped = await countEntries(paths.cacheRoot); // descendants only
    // The scan counts the cache root itself as entry one.
    const filler = 99_999 - shaped;
    assert.ok(filler > 0, `shaped subset already holds ${shaped} entries`);
    const BATCH = 200;
    const creationStarted = performance.now();
    for (let start = 0; start < filler; start += BATCH) {
      const end = Math.min(start + BATCH, filler);
      await Promise.all(
        Array.from({ length: end - start }, (_, i) =>
          writeFile(join(paths.cacheRoot, `filler-${String(start + i).padStart(6, "0")}`), ""),
        ),
      );
      await new Promise((resolveTurn) => setImmediate(resolveTurn));
    }
    const creationMs = performance.now() - creationStarted;
    const descendants = await countEntries(paths.cacheRoot);
    assert.equal(descendants, 99_999, "physical population reaches exactly 99999 descendants");
    const passStarted = performance.now();
    await assert.doesNotReject(
      assertWorkspaceSafe(paths),
      "the scan passes at exactly 100000 counted entries",
    );
    const passMs = performance.now() - passStarted;
    // The actual MCP runtime boundary on the same physical population. The
    // runtime is constructed while the workspace is still at exactly the
    // accepted boundary, so its own eager startup gate passes there; the
    // extra entry is added afterwards so the rejection under test comes from
    // the per-operation WORKSPACE gate. The transport is denied and counted;
    // a single call fails the test. No substitution, no live network.
    let deniedTransportCalls = 0;
    const runtimeOptions = {
      env: { INTELLI_GROWTH_FIXTURE_KEY: "denied-transport-synthetic" },
      logger: { error() {}, warn() {} },
      fetch: async () => {
        deniedTransportCalls += 1;
        throw new Error(
          "growth qualification denied transport: no catalogue or inference call is permitted at the workspace boundary",
        );
      },
    };
    const runtime = await createRuntime(
      await parseConfig(standaloneDocument(), root),
      runtimeOptions,
    );
    await writeFile(join(paths.cacheRoot, "boundary-over"), "");
    await assert.rejects(
      assertWorkspaceSafe(paths),
      /exceeds 100000 entries/,
      "one entry over fails closed before any inference",
    );
    assert.equal((await countEntries(paths.cacheRoot)) - 99_999, 1);
    try {
      await assert.rejects(
        runtime.execute("intelli_search", { query: "blocked before inference" }),
        (error: unknown) => {
          assert.ok(
            error instanceof StandaloneError,
            `expected StandaloneError, got ${String(error)}`,
          );
          assert.equal(error.code, "WORKSPACE");
          assert.match(error.message, /Cache safety scan exceeds 100000 entries/);
          assert.equal(error.execution, undefined);
          return true;
        },
      );
      assert.equal(
        deniedTransportCalls,
        0,
        "no catalogue or inference call precedes the WORKSPACE rejection",
      );
    } finally {
      await runtime.close();
    }
    // The runtime's own eager startup gate is fail-closed as well: a fresh
    // construction against the over-capacity workspace rejects immediately,
    // before any catalogue, inference or server work.
    await assert.rejects(
      createRuntime(await parseConfig(standaloneDocument(), root), runtimeOptions),
      /exceeds 100000 entries/,
      "runtime construction at 100001 entries fails closed at its startup gate",
    );
    assert.equal(deniedTransportCalls, 0);
    await record({
      scenario: "q4-scan-cap",
      capEntries: 100_000,
      physicalDescendantsAtPass: descendants,
      creationMs: round(creationMs),
      scanPassMs: round(passMs),
      overByOneRejected: true,
      runtimeBoundary: {
        rejectedIn: "WORKSPACE",
        deniedTransportCalls,
        executionReceipt: "absent",
        eagerStartupGateAlsoFailClosed: true,
      },
    });
    summary.q4 = {
      capEntries: 100_000,
      physicalDescendantsAtPass: descendants,
      creationMs: round(creationMs),
      scanPassMs: round(passMs),
      overByOneRejected: true,
      runtimeWorkspaceRejectionBeforeInference: true,
    };
    await finishScenario(root, "q4");
  });

  it("q5: pinned pi-v0.19.0 and current writer processes share one parent without metadata interference", async (t) => {
    let oldSource;
    try {
      oldSource = await extractOldWriterSource();
    } catch (error) {
      if (error instanceof OldSourceUnavailable) {
        if (PROFILE === "full") throw error;
        return t.skip(`pinned old writer source unavailable: ${error.message}`);
      }
      throw error;
    }
    const root = await growthScratchRoot("q5-old-new-writers");
    const namespaceDir = join(root, NAMESPACE_DIR);
    await record({
      scenario: "q5-old-writer-provenance",
      tag: OLD_WRITER_TAG,
      commit: oldSource.commit,
      sourceRoot: oldSource.sourceRoot,
      reusedExtraction: oldSource.reused,
      cacheModuleSha256: oldSource.cacheModuleSha256,
      ...(oldSource.preservedPrevious
        ? { preservedPreviousExtraction: oldSource.preservedPrevious }
        : {}),
    });
    // Phase A: the current writer commits and indexes through a real process.
    const phaseA = await runGrowthWorker({
      mode: "new-writer",
      cacheRoot: root,
      count: 2,
      label: "q5new",
      commit: true,
      updateIndex: true,
    });
    assert.equal(phaseA.code, 0, phaseA.stderr);
    const newLines = lines(phaseA.stdout);
    assert.deepEqual(
      newLines.filter((line) => "granted" in line).map((line) => line.granted),
      [1, 2],
    );
    assert.ok(newLines.every((line) => !("diagnostic" in line)), JSON.stringify(newLines));
    const witnessAfterNew = await hashTree(namespaceDir);
    const lockInoFirst = (await stat(join(namespaceDir, "writer.lock"))).ino;
    // Phase B: the pinned old writer builds legacy history beside it.
    const phaseB = await runGrowthWorker({
      mode: "old-writer",
      cacheRoot: root,
      count: 3,
      label: "q5old",
      sourceRoot: oldSource.sourceRoot,
    });
    assert.equal(phaseB.code, 0, phaseB.stderr);
    const oldLines = lines(phaseB.stdout);
    assert.equal(oldLines.filter((line) => "legacy" in line).length, 3);
    for (const line of oldLines) {
      if (typeof line.legacy !== "string") continue;
      const report = await stat(join(line.legacy, "report.md"));
      assert.ok(report.isFile() && report.size > 0, `legacy report at ${line.legacy}`);
    }
    assert.deepEqual(
      await hashTree(namespaceDir),
      witnessAfterNew,
      "the old writer leaves every new-format metadata byte untouched",
    );
    assert.equal((await stat(join(namespaceDir, "writer.lock"))).ino, lockInoFirst);
    // Phase C: both writers run as independent processes at the same time.
    const [phaseCOld, phaseCNew] = await Promise.all([
      runGrowthWorker({
        mode: "old-writer",
        cacheRoot: root,
        count: 2,
        label: "q5mixold",
        sourceRoot: oldSource.sourceRoot,
      }),
      runGrowthWorker({
        mode: "new-writer",
        cacheRoot: root,
        count: 2,
        label: "q5mixnew",
        commit: true,
        updateIndex: true,
      }),
    ]);
    assert.equal(phaseCOld.code, 0, phaseCOld.stderr);
    assert.equal(phaseCNew.code, 0, phaseCNew.stderr);
    const cNewLines = lines(phaseCNew.stdout);
    assert.deepEqual(
      cNewLines.filter((line) => "granted" in line).map((line) => line.granted),
      [3, 4],
    );
    assert.ok(cNewLines.every((line) => !("diagnostic" in line)), JSON.stringify(cNewLines));
    const { namespaceId, journal } = await namespaceState(root);
    assert.equal(journal.records.size, 4, "four new-format admissions in total");
    const runIds = await readdir(join(namespaceDir, RUNS_DIR));
    assert.equal(runIds.length, 4);
    for (const runId of runIds)
      assert.equal(
        (await verifyCommittedRun(namespaceDir, namespaceId, runId, journal.records.get(runId)))
          .ok,
        true,
      );
    const legacyIndex = JSON.parse(
      await readFile(join(root, ".index.json"), "utf8"),
    ) as { searches: { slug: string }[] };
    assert.equal(legacyIndex.searches.length, 5, "five legacy entries, old writer only");
    for (const entry of legacyIndex.searches) {
      assert.match(entry.slug, LEGACY_SLUG);
      const report = await stat(join(root, entry.slug, "report.md"));
      assert.ok(report.isFile() && report.size > 0);
    }
    assert.equal((await stat(join(namespaceDir, "writer.lock"))).ino, lockInoFirst);
    // Mixed read-only view: both namespaces, physical reports only.
    const candidates = await createRunStore(storeOptions(root)).candidates(
      undefined,
      "unrelated current query",
      never,
    );
    const v1Count = candidates.filter((candidate) => candidate.namespace === "v1").length;
    const legacyCount = candidates.filter((candidate) => candidate.namespace === "legacy").length;
    assert.equal(v1Count, 4);
    assert.equal(legacyCount, 5);
    for (const candidate of candidates) {
      const report = await readFile(physicalFor(root, candidate.reportPath), "utf8");
      assert.ok(report.length > 0, `report exists at ${candidate.reportPath}`);
    }
    await record({
      scenario: "q5-old-new-writers",
      oldTag: OLD_WRITER_TAG,
      oldCommit: oldSource.commit,
      newRuns: 4,
      legacyRuns: 5,
      isolationWitnessEqual: true,
      lockInodeStable: true,
      mixedReaderNamespaces: { v1: v1Count, legacy: legacyCount },
    });
    summary.q5 = {
      oldTag: OLD_WRITER_TAG,
      oldCommit: oldSource.commit,
      cacheModuleSha256: oldSource.cacheModuleSha256,
      newRuns: 4,
      legacyRuns: 5,
      isolationWitnessEqual: true,
      lockInodeStable: true,
    };
    await finishScenario(root, "q5");
  });

  it("q6: non-destructive recovery drill refuses damaged history and archives explicitly", async () => {
    const root = await growthScratchRoot("q6-recovery");
    await writeLegacyShape(root, "2026-10-18-legacy-recovery-abc123", "legacy recovery query");
    const queries = [0, 1, 2].map((i) => `recovery drill query ${i}`);
    for (const query of queries)
      await commitOne(root, query, { operationId: `q6-${query.slice(-1)}`, updateIndex: true });
    const namespaceDir = join(root, NAMESPACE_DIR);
    const journalPath = join(namespaceDir, JOURNAL_FILE);
    const indexPath = join(namespaceDir, INDEX_FILE);
    const lockPath = join(namespaceDir, "writer.lock");
    await mkdir(join(namespaceDir, RUNS_DIR, "2026-01-01-orphan-empty-dir"));
    const lockInoFirst = (await stat(lockPath)).ino;
    const runCount = async () => (await readdir(join(namespaceDir, RUNS_DIR))).length;
    assert.equal(await runCount(), 4); // three committed plus the orphan
    const allocate = async (label: string) =>
      createRunStore(storeOptions(root)).allocate({
        operationId: `q6-${label}`,
        query: `recovery probe ${label}`,
        startedUtc: new Date().toISOString(),
        signal: never,
      });
    // Damaged allocation history: an unterminated journal tail.
    await appendFile(journalPath, "partial record without newline");
    let witness = await hashTree(root);
    let refused = await allocate("tail");
    assert.equal(refused.status, "unavailable", JSON.stringify(refused));
    if (refused.status !== "unavailable") throw new Error("unreachable");
    assert.equal(refused.diagnostic.code, "JOURNAL_DAMAGED");
    assert.deepEqual(await hashTree(root), witness, "the refusal changes no history bytes");
    assert.equal(await runCount(), 4, "numbering is not reused or extended by the refusal");
    const tailReader = await createRunStore(storeOptions(root)).candidates(
      undefined,
      "unrelated current query",
      never,
    );
    assert.equal(
      tailReader.filter((candidate) => candidate.namespace === "v1").length,
      3,
      "the read-only mixed reader still tolerates an unterminated tail",
    );
    assert.ok(tailReader.some((candidate) => candidate.namespace === "legacy"));
    // A missing journal with existing identity is unknown history.
    await rename(journalPath, `${journalPath}.drill-saved`);
    witness = await hashTree(root);
    refused = await allocate("missing");
    assert.equal(refused.status, "unavailable");
    if (refused.status !== "unavailable") throw new Error("unreachable");
    assert.equal(refused.diagnostic.code, "JOURNAL_MISSING");
    assert.deepEqual(await hashTree(root), witness);
    await rename(`${journalPath}.drill-saved`, journalPath);
    // Mid-record corruption: writer and reader both fail closed, bytes preserved.
    // The clean baseline for this phase strips this drill's own synthetic
    // partial tail (everything after the last complete newline-terminated
    // record); the damaged states above were already exercised and witnessed.
    const tailed = await readFile(journalPath);
    const lastRecordEnd = tailed.lastIndexOf(0x0a);
    assert.ok(lastRecordEnd > 0, "at least one complete journal record exists");
    const validJournal = Buffer.from(tailed.subarray(0, lastRecordEnd + 1));
    const brokenJournal = Buffer.from(validJournal);
    const sequenceAt = brokenJournal.indexOf('"sequence":1,');
    assert.ok(sequenceAt > 0, "first journal record found");
    brokenJournal.write('"sequence":2,', sequenceAt, "utf8");
    await writeFile(journalPath, brokenJournal);
    witness = await hashTree(root);
    refused = await allocate("chain");
    assert.equal(refused.status, "unavailable");
    if (refused.status !== "unavailable") throw new Error("unreachable");
    assert.equal(refused.diagnostic.code, "JOURNAL_DAMAGED");
    assert.deepEqual(await hashTree(root), witness);
    const chainDiagnostics: Diagnostic[] = [];
    const chainCandidates = await createRunStore(
      storeOptions(root, { onDiagnostic: (diagnostic) => chainDiagnostics.push(diagnostic) }),
    ).candidates(undefined, "unrelated current query", never);
    assert.equal(chainCandidates.filter((candidate) => candidate.namespace === "v1").length, 0);
    assert.ok(
      chainCandidates.some((candidate) => candidate.namespace === "legacy"),
      "legacy evidence stays eligible when new-format history is unreadable",
    );
    assert.ok(chainDiagnostics.some((diagnostic) => diagnostic.code === "JOURNAL_DAMAGED"));
    await writeFile(journalPath, validJournal);
    // Secondary rebuild happens only under the stable writer lock.
    const indexShaBefore = await sha256File(indexPath);
    let signalAcquired: () => void = () => undefined;
    const holderAcquired = new Promise<void>((resolve) => {
      signalAcquired = resolve;
    });
    const holder = runGrowthWorker(
      { mode: "hold-lock", cacheRoot: root, holdMs: 3000 },
      (line) => {
        try {
          if ((JSON.parse(line) as { acquired?: string }).acquired === "acquired")
            signalAcquired();
        } catch {
          // Ignore partial lines; completion is witnessed by exit code.
        }
      },
    );
    await Promise.race([
      holderAcquired,
      holder.then((exited) => {
        throw new Error(`lock holder exited before acquiring: ${exited.stderr}`);
      }),
    ]);
    const busyRebuild = await rebuildRunIndex(storeOptions(root), never);
    assert.equal(busyRebuild.status, "unavailable", JSON.stringify(busyRebuild));
    if (busyRebuild.status !== "unavailable") throw new Error("unreachable");
    assert.equal(busyRebuild.diagnostic.code, "LOCK_BUSY");
    assert.ok(busyRebuild.diagnostic.message.includes("writer.lock"));
    assert.equal(await sha256File(indexPath), indexShaBefore, "nothing written without the lock");
    assert.ok(
      !(await readdir(namespaceDir)).some((name) => name.startsWith("index.preserved-")),
      "no preserved copy is created while another writer holds the lock",
    );
    const held = await holder;
    assert.equal(held.code, 0, held.stderr);
    const rebuilt = await rebuildRunIndex(storeOptions(root), never);
    assert.equal(rebuilt.status, "rebuilt", JSON.stringify(rebuilt));
    if (rebuilt.status !== "rebuilt") throw new Error("unreachable");
    assert.equal(rebuilt.entries, 3);
    assert.equal(rebuilt.rejected.length, 1, "the orphan run is reported, not deleted");
    assert.match(rebuilt.rejected[0], /orphan/);
    const preservedNames = (await readdir(namespaceDir)).filter((name) =>
      name.startsWith("index.preserved-"),
    );
    assert.equal(preservedNames.length, 1);
    assert.equal(
      await sha256File(join(namespaceDir, preservedNames[0])),
      indexShaBefore,
      "the pre-rebuild index is preserved before the rewrite",
    );
    const afterRebuild = await hashTree(root);
    assert.equal(await runCount(), 4, "historical and orphan directories all survive");
    assert.equal((await stat(lockPath)).ino, lockInoFirst);
    // The two documented explicit offline choices, on this small owned
    // fixture. Neither is a repair, and neither resumes old numbering; the
    // original namespace's complete history and stable lock inode are
    // preserved. writer.lock is never renamed, unlinked or replaced
    // individually: only whole-cache moves occur.
    const beforeChoices = afterRebuild;
    const { namespaceId: originalNamespaceId } = await namespaceState(root);
    // Choice 1: keep the old cache unchanged and configure a new cacheDir.
    const choiceARoot = `${root}-choice-new-cachedir`;
    const choiceA = await commitOne(choiceARoot, "new cacheDir first query", {
      operationId: "q6-choice-new-cachedir",
      updateIndex: true,
    });
    const { namespaceId: choiceANamespaceId } = await namespaceState(choiceARoot);
    assert.notEqual(choiceANamespaceId, originalNamespaceId);
    assert.equal(choiceA.reservation.sequence, 1, "a new cacheDir starts a fresh namespace at one");
    assert.deepEqual(await hashTree(root), beforeChoices, "the unchanged old cache keeps every byte");
    assert.equal((await stat(lockPath)).ino, lockInoFirst);
    // Choice 2: a same-filesystem rename of the complete stopped cache, then
    // a new namespace is created. Rename preserves every inode, so the stable
    // lock inode survives the move with the whole history.
    const aside = `${root}-choice-renamed-aside`;
    await rename(root, aside);
    assert.deepEqual(
      await hashTree(aside),
      beforeChoices,
      "the renamed cache holds the complete history byte-for-byte",
    );
    assert.equal(
      (await stat(join(aside, NAMESPACE_DIR, "writer.lock"))).ino,
      lockInoFirst,
      "a whole-cache rename preserves the stable lock inode",
    );
    const choiceB = await commitOne(root, "in-place fresh namespace first query", {
      operationId: "q6-choice-renamed-aside",
      updateIndex: true,
    });
    const { namespaceId: choiceBNamespaceId } = await namespaceState(root);
    assert.notEqual(choiceBNamespaceId, originalNamespaceId);
    assert.notEqual(choiceBNamespaceId, choiceANamespaceId);
    assert.equal(
      choiceB.reservation.sequence,
      1,
      "the new namespace restarts at one; old numbering is not resumed",
    );
    assert.deepEqual(await hashTree(aside), beforeChoices, "the renamed-aside history is never written again");
    assert.equal((await stat(join(aside, NAMESPACE_DIR, "writer.lock"))).ino, lockInoFirst);
    const asideRunCount = (await readdir(join(aside, NAMESPACE_DIR, RUNS_DIR))).length;
    assert.equal(asideRunCount, 4, "the preserved history keeps its runs and orphan");
    await record({
      scenario: "q6-recovery",
      damagedTailRefused: "JOURNAL_DAMAGED",
      missingJournalRefused: "JOURNAL_MISSING",
      chainCorruptionRefused: "JOURNAL_DAMAGED",
      legacyEligibleUnderDamage: true,
      rebuildUnderLockOnly: "LOCK_BUSY while held",
      orphanReported: rebuilt.rejected[0],
      preservedCopy: preservedNames[0],
      choiceNewCacheDirRoot: choiceARoot,
      choiceNewCacheDirSequence: 1,
      choiceRenamedAsideRoot: aside,
      choiceRenamedAsideLockInodeStable: true,
      choiceInPlaceFreshNamespaceSequence: 1,
      oldNamespacePreserved: true,
      interpretation:
        "Both closing steps are documented explicit offline choices: an unchanged old cache beside a newly configured cacheDir, and a same-filesystem rename of the complete stopped cache before a new namespace is created in place. writer.lock is never renamed, unlinked or replaced individually; only whole-cache moves occur. These are not repairs and do not resume old numbering; the original namespace's complete history and stable lock inode are preserved. No automatic retention or reset utility exists in this drill.",
    });
    summary.q6 = {
      damagedTailRefused: "JOURNAL_DAMAGED",
      missingJournalRefused: "JOURNAL_MISSING",
      chainCorruptionRefused: "JOURNAL_DAMAGED",
      rebuildUnderLockOnly: "LOCK_BUSY while held",
      orphanReportedNotDeleted: true,
      choiceNewCacheDirSequence: 1,
      choiceRenamedAsideLockInodeStable: true,
      choiceInPlaceFreshNamespaceSequence: 1,
      oldNamespacePreserved: true,
    };
    await finishScenario(root, "q6");
    await finishScenario(aside, "q6-choice-renamed-aside");
    await finishScenario(choiceARoot, "q6-choice-new-cachedir");
  });
});
