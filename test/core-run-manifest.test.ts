// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { it } from "node:test";
import { Value } from "typebox/value";
import type { Artifact, SourceRecord } from "../src/core/execution-contracts.js";
import {
  RunSourceSchema,
  type RunSource,
  type RunManifest,
} from "../src/core/run-manifest-schema.js";
import { runManifestError } from "../src/core/run-manifest.js";
import {
  MARKER_FILE,
  NAMESPACE_DIR,
  STRUCTURAL_MAX_BYTES,
  encodeRecord,
  sha256,
  type CommittedMarker,
} from "../src/core/run-format.js";
import { readNamespace, validateJournal, verifyCommittedRun } from "../src/core/run-journal.js";
import { createRunStore } from "../src/core/run-store.js";
import {
  artifactsFor,
  manifestFor,
  scratchRoot,
  storeOptions,
} from "./helpers/run-store-fixtures.js";

// Persisted sources are a bounded inventory, never inlined evidence bodies or
// future display/absolute paths. The output mapping is an integration gate.
type InventoryFields = Pick<
  SourceRecord,
  | "id"
  | "url"
  | "title"
  | "state"
  | "sourceType"
  | "truncated"
  | "extractionPath"
  | "fullPagePath"
  | "diagnostic"
>;
const sourceAssignable: (source: RunSource) => InventoryFields = (source) => source;
void sourceAssignable;

const signal = new AbortController().signal;
const startedUtc = "2026-10-18T12:00:00.000Z";
const query = "manifest example";
const extras: Artifact[] = [
  { relativePath: "late/S2.md", kind: "late", bytes: Buffer.from("late extraction") },
  { relativePath: "sources/docs.md", kind: "source", bytes: Buffer.from("documentation") },
];
const files = artifactsFor(query, extras);

function withManifest(value: unknown, base = files): Artifact[] {
  return base.map((a) => (a.kind === "manifest-data" ? { ...a, bytes: encodeRecord(value) } : a));
}
async function allocated(store: ReturnType<typeof createRunStore>) {
  const allocation = await store.allocate({ operationId: "op", query, startedUtc, signal });
  assert.equal(allocation.status, "allocated");
  if (allocation.status !== "allocated") throw new Error("allocation failed");
  return allocation.reservation;
}
async function verify(root: string, runId: string) {
  const nsDir = join(root, NAMESPACE_DIR);
  const ns = (await readNamespace(nsDir))!;
  const journal = await validateJournal(nsDir, ns.namespaceId, "reader");
  return verifyCommittedRun(nsDir, ns.namespaceId, runId, journal.records.get(runId));
}

it("report manifest separates frozen evidence, late extractions and documentation", () => {
  const manifest = manifestFor(extras);
  manifest.sources.push({
    id: "S3",
    url: "https://example.com/failed",
    title: "Failed",
    input: "network",
    state: "fetch-failed",
    diagnostic: "body limit",
  });
  manifest.provenance.focusPrompt = "Compare only the selected feature";
  manifest.provenance.domains = ["example.com"];
  assert.equal(runManifestError(manifest, files), undefined);
  assert.deepEqual(manifest.evidenceSourceIds, ["S1"]);
  assert.equal(manifest.sources[1].state, "late");
  assert.equal(manifest.documents[0].relativePath, "sources/docs.md");
});

it("manual collation records supplied provenance without a network-fetch claim", () => {
  const manifest = manifestFor();
  manifest.operation = "intelli_collate";
  manifest.sources[0].input = "supplied";
  delete manifest.sources[0].fullPagePath;
  delete manifest.provenance.models.search;
  delete manifest.provenance.models.extract;
  const supplied = artifactsFor(query).filter((a) => a.kind !== "source");
  assert.equal(runManifestError(manifest, supplied), undefined);
  manifest.sources[0].input = "network";
  assert.match(runManifestError(manifest, supplied)!, /input disagrees/);
});

const mutations: readonly [string, (m: RunManifest) => void][] = [
  [
    "invented ID",
    (m) => {
      m.sources[0].id = "S8";
    },
  ],
  [
    "nonterminal state",
    (m) => {
      Object.assign(m.sources[0], { state: "fetched" });
    },
  ],
  [
    "raw page body",
    (m) => {
      Object.assign(m.sources[0], { content: "raw body" });
    },
  ],
  [
    "inline extraction",
    (m) => {
      Object.assign(m.sources[0], { extraction: "evidence" });
    },
  ],
  [
    "unknown top-level key",
    (m) => {
      Object.assign(m, { text: "answer" });
    },
  ],
  [
    "secret-bearing configuration key",
    (m) => {
      Object.assign(m.provenance.models.collate, { apiKey: "not allowed" });
    },
  ],
  [
    "missing research model",
    (m) => {
      delete m.provenance.models.search;
    },
  ],
  [
    "late admitted as evidence",
    (m) => {
      m.evidenceSourceIds.push("S2");
    },
  ],
  [
    "empty evidence",
    (m) => {
      m.evidenceSourceIds = [];
    },
  ],
  [
    "duplicate URL",
    (m) => {
      m.sources[1].url = m.sources[0].url;
    },
  ],
  [
    "credential URL",
    (m) => {
      m.sources[0].url = "https://user:secret@example.com/";
    },
  ],
  [
    "non-HTTP URL",
    (m) => {
      m.sources[0].url = "file:///etc/passwd";
    },
  ],
  [
    "wrong extraction kind",
    (m) => {
      m.sources[0].extractionPath = "sources/S1.md";
    },
  ],
  [
    "invented extraction",
    (m) => {
      m.sources[0].extractionPath = "extractions/missing.md";
    },
  ],
  [
    "traversal path",
    (m) => {
      m.sources[0].fullPagePath = "../source.md";
    },
  ],
  [
    "absolute path",
    (m) => {
      m.sources[0].fullPagePath = "/source.md";
    },
  ],
  [
    "late evidence path",
    (m) => {
      m.sources[1].extractionPath = "extractions/S1.md";
    },
  ],
  [
    "raw late page",
    (m) => {
      m.sources[1].fullPagePath = "sources/S1.md";
    },
  ],
  [
    "missing extraction",
    (m) => {
      delete m.sources[0].extractionPath;
    },
  ],
  [
    "failed source extraction",
    (m) => {
      m.sources[0].state = "extract-failed";
    },
  ],
  [
    "unmapped document",
    (m) => {
      m.documents = [];
    },
  ],
  [
    "double-owned source path",
    (m) => {
      m.documents[0].relativePath = "sources/S1.md";
    },
  ],
  [
    "credential document URL",
    (m) => {
      m.documents[0].url = "https://user:secret@example.com/";
    },
  ],
  [
    "document schema extra",
    (m) => {
      Object.assign(m.documents[0], { content: "raw" });
    },
  ],
];

it("state, provenance and file identity defects refuse publication before any artefact write", async () => {
  const root = await scratchRoot("manifest-writer");
  const store = createRunStore(storeOptions(root));
  for (const [label, mutate] of mutations) {
    const manifest = manifestFor(extras);
    mutate(manifest);
    assert.notEqual(runManifestError(manifest, files), undefined, label);
    const reservation = await allocated(store);
    const result = await store.commit(reservation, withManifest(manifest), signal);
    assert.equal(
      result.status === "unavailable" && result.diagnostic.code,
      "INVALID_ARTIFACTS",
      label,
    );
    assert.deepEqual(await readdir(reservation.physicalPath), ["reservation.json"], label);
  }
  await store.settle();
});

it("a hash-valid run.json does not bypass field-level verified-reader checks", async () => {
  const root = await scratchRoot("manifest-reader");
  const store = createRunStore(storeOptions(root));
  const reservation = await allocated(store);
  assert.equal((await store.commit(reservation, files, signal)).status, "committed");
  assert.equal((await verify(root, reservation.runId)).ok, true);
  const markerPath = join(reservation.physicalPath, MARKER_FILE);
  const original: CommittedMarker = JSON.parse(await readFile(markerPath, "utf8"));
  for (const [label, mutate] of mutations) {
    const manifest = manifestFor(extras);
    mutate(manifest);
    const bytes = encodeRecord(manifest);
    await writeFile(join(reservation.physicalPath, "run.json"), bytes);
    const marker = structuredClone(original);
    Object.assign(
      marker.files.find((f) => f.relativePath === "run.json")!,
      { bytes: bytes.byteLength, sha256: sha256(bytes) },
    );
    await writeFile(markerPath, encodeRecord(marker));
    const result = await verify(root, reservation.runId);
    assert.equal(result.ok, false, label);
    assert.equal((await store.candidates(undefined, "other", signal)).length, 0, label);
  }
  await store.settle();
});

it("used-source order is immutable even with multiple nonadjacent successful sources", () => {
  const manifest = manifestFor(extras);
  const extraction: Artifact = {
    relativePath: "extractions/S3.md",
    kind: "extraction",
    bytes: Buffer.from("third"),
  };
  manifest.sources.push({
    ...manifest.sources[0],
    id: "S3",
    url: "https://example.com/third",
    extractionPath: extraction.relativePath,
  });
  delete manifest.sources[2].fullPagePath;
  manifest.evidenceSourceIds.push("S3");
  assert.equal(runManifestError(manifest, [...files, extraction]), undefined);
  manifest.evidenceSourceIds.reverse();
  assert.match(runManifestError(manifest, [...files, extraction])!, /candidate order/);
});

it("run.json structural ceiling is shared by writer and reader", async () => {
  const root = await scratchRoot("manifest-boundary");
  const store = createRunStore(storeOptions(root));
  for (const extra of [0, 1]) {
    const manifest = manifestFor(extras);
    manifest.provenance.focusPrompt = "";
    manifest.provenance.focusPrompt = "x".repeat(
      STRUCTURAL_MAX_BYTES + extra - encodeRecord(manifest).byteLength,
    );
    const bytes = encodeRecord(manifest);
    assert.equal(bytes.byteLength, STRUCTURAL_MAX_BYTES + extra);
    const reservation = await allocated(store);
    const result = await store.commit(reservation, withManifest(manifest), signal);
    if (!extra) {
      assert.equal(result.status, "committed");
      assert.equal((await verify(root, reservation.runId)).ok, true);
    } else {
      assert.equal(result.status === "unavailable" && result.diagnostic.code, "INVALID_ARTIFACTS");
      assert.ok(!(await readdir(reservation.physicalPath)).includes(MARKER_FILE));
    }
  }
  await store.settle();
});

it("empty inline and staged extractions cannot publish or pass verified reading", async () => {
  const root = await scratchRoot("manifest-empty-extraction");
  const store = createRunStore(storeOptions(root));
  const emptyPath = join(root, "empty.md");
  await writeFile(emptyPath, "");
  for (const staged of [false, true]) {
    const reservation = await allocated(store);
    const artefacts = files.map((a): Artifact =>
      a.kind !== "extraction"
        ? a
        : staged
          ? { relativePath: a.relativePath, kind: a.kind, stagedPath: emptyPath }
          : { relativePath: a.relativePath, kind: a.kind, bytes: Buffer.alloc(0) },
    );
    const result = await store.commit(reservation, artefacts, signal);
    assert.equal(result.status === "unavailable" && result.diagnostic.code, "INVALID_ARTIFACTS");
    assert.ok(!(await readdir(reservation.physicalPath)).includes(MARKER_FILE));
  }
  const reservation = await allocated(store);
  assert.equal((await store.commit(reservation, files, signal)).status, "committed");
  await writeFile(join(reservation.physicalPath, "extractions/S1.md"), "");
  const markerPath = join(reservation.physicalPath, MARKER_FILE);
  const marker: CommittedMarker = JSON.parse(await readFile(markerPath, "utf8"));
  Object.assign(
    marker.files.find((f) => f.kind === "extraction")!,
    { bytes: 0, sha256: sha256("") },
  );
  await writeFile(markerPath, encodeRecord(marker));
  assert.equal((await verify(root, reservation.runId)).ok, false);
  await store.settle();
});

it("persisted source schema rejects output-only content fields and unknown nested keys", () => {
  const source = manifestFor().sources[0];
  assert.equal(Value.Check(RunSourceSchema, source), true);
  assert.equal(Value.Check(RunSourceSchema, { ...source, content: "raw" }), false);
});
