// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
// Field-review regressions for C22/C23/C26/C27, including real reader ceilings.

import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { it } from "node:test";
import { Value } from "typebox/value";
import type { Artifact, AttemptRecord, Diagnostic } from "../src/core/execution-contracts.js";
import {
  ACCOUNTING_FILE,
  ACCOUNTING_MARKER_FILE,
  INDEX_FILE,
  JOURNAL_FILE,
  MARKER_FILE,
  NAMESPACE_DIR,
  NAMESPACE_FILE,
  OWNER_FILE,
  RESERVATION_FILE,
  STRUCTURAL_MAX_BYTES,
  encodeRecord,
  isUtc,
  wireSchemas,
  type CommittedMarker,
  type IndexRecord,
} from "../src/core/run-format.js";
import {
  readNamespace,
  validateJournal,
  verifyAccounting,
  verifyCommittedRun,
} from "../src/core/run-journal.js";
import { createRunStore } from "../src/core/run-store.js";
import { createAttemptLedger } from "../src/core/usage.js";
import { artifactsFor, scratchRoot, storeOptions } from "./helpers/run-store-fixtures.js";

const signal = new AbortController().signal;
const startedUtc = "2026-10-18T12:00:00.000Z";
const artifacts = (query: string): Artifact[] =>
  artifactsFor(query).map((a) =>
    a.kind === "report" ? { ...a, bytes: Buffer.from("# Answer [S1]\n") } : a,
  );
async function allocate(store: ReturnType<typeof createRunStore>, query: string) {
  const result = await store.allocate({ operationId: "op", query, startedUtc, signal });
  assert.equal(result.status, "allocated", JSON.stringify(result));
  if (result.status !== "allocated") throw new Error("allocation failed");
  return result.reservation;
}
async function commit(store: ReturnType<typeof createRunStore>, query: string) {
  const reservation = await allocate(store, query);
  const result = await store.commit(reservation, artifacts(query), signal);
  assert.equal(result.status, "committed", JSON.stringify(result));
  if (result.status !== "committed") throw new Error("commit failed");
  assert.equal(await store.updateIndex(result.run, query, signal), "updated");
  return result.run;
}

it("structural marker boundary: exact reader ceiling commits; one byte more cannot poison later allocations", async () => {
  const root = await scratchRoot("schema-marker-boundary");
  const store = createRunStore(storeOptions(root));
  const baseline = await commit(store, "x");
  const template: CommittedMarker = JSON.parse(
    await readFile(join(baseline.reservation.physicalPath, MARKER_FILE), "utf8"),
  );
  // All identities/hashes have fixed encoded widths. The long query label is
  // capped at 60 characters; only query text and its file-byte digits grow.
  template.runId = `2026-10-18-${"x".repeat(60)}-${"0".repeat(32)}`;
  function queryAt(target: number): string {
    let n = target - encodeRecord(template).byteLength + 1;
    for (;;) {
      template.query = "x".repeat(n);
      template.files.find((f) => f.kind === "query")!.bytes = n;
      const delta = target - encodeRecord(template).byteLength;
      if (delta === 0) return template.query;
      n += delta;
    }
  }
  const acceptedQuery = queryAt(STRUCTURAL_MAX_BYTES);
  const accepted = await commit(store, acceptedQuery);
  const markerBytes = await readFile(join(accepted.reservation.physicalPath, MARKER_FILE));
  assert.equal(markerBytes.byteLength, STRUCTURAL_MAX_BYTES);
  const nsDir = join(root, NAMESPACE_DIR);
  const ns = (await readNamespace(nsDir))!;
  const journal = await validateJournal(nsDir, ns.namespaceId, "writer");
  assert.equal(
    (
      await verifyCommittedRun(
        nsDir,
        ns.namespaceId,
        accepted.reservation.runId,
        journal.records.get(accepted.reservation.runId),
      )
    ).ok,
    true,
  );

  const rejectedQuery = queryAt(STRUCTURAL_MAX_BYTES + 1);
  const rejected = await allocate(store, rejectedQuery);
  const result = await store.commit(rejected, artifacts(rejectedQuery), signal);
  assert.equal(result.status === "unavailable" && result.diagnostic.code, "MARKER_TOO_LARGE");
  const names = await readdir(rejected.physicalPath);
  assert.ok(names.includes("report.md"), "uncommitted evidence is preserved");
  assert.ok(!names.some((name) => name === MARKER_FILE || name.startsWith(`.${MARKER_FILE}`)));
  const next = await commit(createRunStore(storeOptions(root)), "after oversized marker");
  assert.equal(
    next.reservation.sequence,
    rejected.sequence + 1,
    "no namespace-wide identity conflict or sequence reuse",
  );
  await store.settle();
});

it("oversized encoded queries and malformed Unicode reject before namespace creation", async () => {
  for (const query of [
    "x".repeat(STRUCTURAL_MAX_BYTES),
    "\u0000".repeat(Math.ceil(STRUCTURAL_MAX_BYTES / 6)),
    "\ud800",
  ]) {
    const root = await scratchRoot("schema-query-input");
    const result = await createRunStore(storeOptions(root)).allocate({
      operationId: "op",
      query,
      startedUtc,
      signal,
    });
    assert.equal(
      result.status === "unavailable" && result.diagnostic.code,
      query === "\ud800" ? "INVALID_QUERY" : "QUERY_TOO_LARGE",
    );
    assert.deepEqual(await readdir(root), []);
  }
});

it("query.txt must contain exact UTF-8 bytes, not a lossy equivalent", async () => {
  const root = await scratchRoot("schema-query-bytes");
  const store = createRunStore(storeOptions(root));
  const query = "\ufffd";
  const reservation = await allocate(store, query);
  const result = await store.commit(
    reservation,
    artifacts(query).map((a) => (a.kind === "query" ? { ...a, bytes: Buffer.from([0xff]) } : a)),
    signal,
  );
  assert.equal(result.status === "unavailable" && result.diagnostic.code, "INVALID_ARTIFACTS");
  assert.ok(!(await readdir(reservation.physicalPath)).includes(MARKER_FILE));
  const valid = await commit(store, query);
  assert.deepEqual(
    await readFile(join(valid.reservation.physicalPath, "query.txt")),
    Buffer.from(query),
  );
});

it("accounting boundary: exact ceiling is readable; one byte more returns unavailable without a file or marker", async () => {
  const root = await scratchRoot("schema-accounting-boundary");
  for (const extra of [0, 1]) {
    const store = createRunStore(storeOptions(root));
    const run = await commit(store, `accounting ${extra}`);
    const identity = {
      operationId: "op",
      callId: "c1",
      attempt: 1,
      model: { provider: "fixture", model: "m" },
      role: "collate" as const,
    };
    const ledger = createAttemptLedger();
    ledger.start(identity, 0, 0);
    ledger.observe(identity, {
      tokens: { inputTotal: 1 },
      costBasis: "unknown",
      source: "provider-response",
      providerRequestId: "",
    });
    ledger.finish(identity, "succeeded", 1);
    const records: AttemptRecord[] = JSON.parse(JSON.stringify(ledger.records()));
    const summary = ledger.summary();
    const envelope = {
      schema: "intelli-v1/accounting",
      schemaVersion: 1,
      namespaceId: run.reservation.namespaceId,
      runId: run.reservation.runId,
      manifestSha256: run.manifestSha256,
      coverage: "all-model-work-settled",
      attempts: records,
      summary,
    };
    records[0] = {
      ...records[0],
      observation: {
        ...records[0].observation!,
        providerRequestId: "x".repeat(
          STRUCTURAL_MAX_BYTES + extra - encodeRecord(envelope).byteLength,
        ),
      },
    };
    assert.equal(encodeRecord(envelope).byteLength, STRUCTURAL_MAX_BYTES + extra);
    const result = await store.recordAccounting(run, records, summary, signal);
    if (extra === 0) {
      assert.equal(result.status, "recorded");
      assert.ok(
        await verifyAccounting(
          run.reservation.physicalPath,
          run.reservation.namespaceId,
          run.reservation.runId,
          run.manifestSha256,
        ),
      );
    } else {
      assert.equal(
        result.status === "unavailable" && result.diagnostic.code,
        "ACCOUNTING_TOO_LARGE",
      );
      const names = await readdir(run.reservation.physicalPath);
      assert.ok(!names.includes(ACCOUNTING_FILE) && !names.includes(ACCOUNTING_MARKER_FILE));
      assert.ok(names.includes(MARKER_FILE), "report is unaffected");
    }
    await store.settle();
  }
});

it("secondary index provenance cannot invent sequences, group identity or UTC ordering", async () => {
  for (const field of ["sequence", "compatibilityKey", "startedUtc"] as const) {
    const root = await scratchRoot(`schema-index-${field}`);
    const diagnostics: Diagnostic[] = [];
    const store = createRunStore(storeOptions(root, { diagnostics }));
    const older = await commit(store, "alpha");
    const newer = await commit(store, "alpha");
    const beta = await commit(store, "beta");
    const indexPath = join(root, NAMESPACE_DIR, INDEX_FILE);
    const index: IndexRecord = JSON.parse(await readFile(indexPath, "utf8"));
    if (field === "sequence") {
      index.entries[1].sequence = 5;
      index.entries[2].sequence = 6;
    }
    if (field === "compatibilityKey")
      index.entries[1].compatibilityKey = `sha256:${"f".repeat(64)}`;
    if (field === "startedUtc") index.entries[1].startedUtc = "2030-01-01T00:00:00Z";
    const damaged = encodeRecord(index);
    await writeFile(indexPath, damaged);
    const candidates = await store.candidates(undefined, "other", signal);
    assert.equal(
      candidates.find((c) => c.query === "alpha")?.admissionSequence,
      older.reservation.sequence,
      field,
    );
    assert.ok(!candidates.some((c) => c.reportPath.includes(newer.reservation.runId)));
    if (field === "sequence")
      assert.ok(
        !candidates.some((c) => c.query === "beta"),
        "invented beta admission also rejected",
      );
    else
      assert.equal(
        candidates.find((c) => c.query === "beta")?.admissionSequence,
        beta.reservation.sequence,
      );
    assert.ok(
      diagnostics.some((d) => d.code === "RUN_REJECTED" && d.message.includes("index provenance")),
    );
    assert.deepEqual(await readFile(indexPath), damaged, "reader leaves damaged input untouched");
  }
});

it("real writer output is canonical and validates against every published wire schema", async () => {
  const root = await scratchRoot("schema-real-writer");
  const store = createRunStore(storeOptions(root));
  const gap = await allocate(store, "gap");
  const reservation = await allocate(store, "writer");
  const result = await store.commit(
    reservation,
    artifacts("writer").concat({
      relativePath: "late/S2.md",
      kind: "late",
      bytes: Buffer.from("not evidence"),
    }),
    signal,
  );
  assert.equal(result.status, "committed");
  if (result.status !== "committed") return;
  assert.equal(await store.updateIndex(result.run, "writer", signal), "updated");
  const ledger = createAttemptLedger();
  assert.equal(
    (await store.recordAccounting(result.run, ledger.records(), ledger.summary(), signal)).status,
    "recorded",
  );
  const nsDir = join(root, NAMESPACE_DIR);
  const documents: [string, string][] = [
    ["namespace", join(nsDir, NAMESPACE_FILE)],
    ["writer-owner", join(nsDir, OWNER_FILE)],
    ["index", join(nsDir, INDEX_FILE)],
    ["reservation", join(gap.physicalPath, RESERVATION_FILE)],
    ["reservation", join(reservation.physicalPath, RESERVATION_FILE)],
    ["committed", join(reservation.physicalPath, MARKER_FILE)],
    ["accounting", join(reservation.physicalPath, ACCOUNTING_FILE)],
    ["accounting-committed", join(reservation.physicalPath, ACCOUNTING_MARKER_FILE)],
  ];
  const checked = new Set<string>();
  async function check(name: string, bytes: Buffer) {
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    const schema = JSON.parse(
      await readFile(
        new URL(`./fixtures/run-store-v1/${name}.schema.json`, import.meta.url),
        "utf8",
      ),
    );
    assert.ok(Value.Check(schema, value), name);
    assert.deepEqual(bytes, encodeRecord(value), `${name} encoding`);
    checked.add(name);
  }
  for (const [name, path] of documents) await check(name, await readFile(path));
  for (const line of (await readFile(join(nsDir, JOURNAL_FILE), "utf8")).trimEnd().split("\n"))
    await check("allocation", Buffer.from(line + "\n"));
  assert.deepEqual([...checked].sort(), Object.keys(wireSchemas).sort());
  const ns = (await readNamespace(nsDir))!;
  const journal = await validateJournal(nsDir, ns.namespaceId, "writer");
  assert.equal(
    (
      await verifyCommittedRun(
        nsDir,
        ns.namespaceId,
        reservation.runId,
        journal.records.get(reservation.runId),
      )
    ).ok,
    true,
  );
  assert.ok(
    await verifyAccounting(
      reservation.physicalPath,
      ns.namespaceId,
      reservation.runId,
      result.run.manifestSha256,
    ),
  );
  await store.settle();
});

it("UTC validation rejects calendar normalisation while retaining fractional precision", () => {
  for (const bad of [
    "2026-02-30T00:00:00Z",
    "2025-02-29T00:00:00Z",
    "2026-04-31T00:00:00Z",
    "2026-10-18T24:00:00Z",
    "2026-99-99T99:99:99Z",
  ])
    assert.equal(isUtc(bad), false, bad);
  for (const good of [
    startedUtc,
    "2024-02-29T00:00:00Z",
    "2026-10-18T23:59:59.123456789Z",
    "0000-01-01T00:00:00Z",
  ])
    assert.equal(isUtc(good), true, good);
});
