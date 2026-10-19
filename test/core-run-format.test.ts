// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// Versioned on-disk wire formats (C21/C23). test/fixtures/run-store-v1/
// holds the JSON Schemas generated from src/core/run-format.ts plus a
// deterministic example namespace. Regenerate deliberately with
// UPDATE_RUN_STORE_FIXTURES=1; otherwise this test is the drift gate.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Value } from "typebox/value";
import {
  INDEX_FILE,
  JOURNAL_FILE,
  LOCK_FILE,
  NAMESPACE_DIR,
  NAMESPACE_FILE,
  OWNER_FILE,
  RUNS_DIR,
  ZERO_HASH,
  allocationHash,
  canonicalJson,
  compatibilityKeyFor,
  displayLabel,
  encodeRecord,
  isSafeRelativePath,
  sha256,
  wireSchemas,
  type AllocationRecord,
} from "../src/core/run-format.js";
import { validateJournal, verifyAccounting, verifyCommittedRun } from "../src/core/run-journal.js";
import { TOKEN_FIELDS } from "../src/core/usage.js";
import { createRunStore } from "../src/core/run-store.js";
import { manifestFor, storeOptions } from "./helpers/run-store-fixtures.js";

const fixtures = fileURLToPath(new URL("./fixtures/run-store-v1/", import.meta.url));
const update = process.env.UPDATE_RUN_STORE_FIXTURES === "1";
const NS = "0123456789abcdef0123456789abcdef";
const START = "2026-10-18T12:00:00.000Z";

/** Deterministic example namespace: two admissions, the second committed with accounting. */
function exampleNamespace(): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const text = (value: string) => Buffer.from(value, "utf8");
  const ns = (path: string) => join("example", NAMESPACE_DIR, path);
  files.set(
    ns(NAMESPACE_FILE),
    encodeRecord({
      schema: "intelli-v1/namespace",
      schemaVersion: 1,
      namespaceId: NS,
      createdUtc: START,
    }),
  );
  files.set(ns(LOCK_FILE), Buffer.alloc(0));
  files.set(
    ns(OWNER_FILE),
    encodeRecord({
      schema: "intelli-v1/writer-owner",
      schemaVersion: 1,
      pid: 4242,
      acquiredUtc: START,
      purpose: "index",
      operationId: "op-2",
    }),
  );
  const query = "example run store query";
  const key = compatibilityKeyFor(query, "2026-10-18");
  const records: AllocationRecord[] = [];
  let previous = ZERO_HASH;
  for (const [sequence, nonce] of [
    [1, "1".repeat(32)],
    [2, "2".repeat(32)],
  ] as const) {
    const body = {
      schema: "intelli-v1/allocation" as const,
      schemaVersion: 1 as const,
      namespaceId: NS,
      sequence,
      runId: `${displayLabel(query, START)}-${nonce}`,
      operationId: `op-${sequence}`,
      compatibilityKey: key,
      startedUtc: START,
      previousHash: previous,
    };
    const record = { ...body, hash: allocationHash(body) };
    previous = record.hash;
    records.push(record);
  }
  files.set(ns(JOURNAL_FILE), Buffer.concat(records.map(encodeRecord)));
  // Sequence 1 is an allowed gap: journalled, reserved, never published.
  for (const record of records) {
    const run = (path: string) => ns(join(RUNS_DIR, record.runId, path));
    files.set(
      run("reservation.json"),
      encodeRecord({
        schema: "intelli-v1/reservation",
        schemaVersion: 1,
        namespaceId: NS,
        sequence: record.sequence,
        runId: record.runId,
        operationId: record.operationId,
        compatibilityKey: key,
        startedUtc: START,
        allocationHash: record.hash,
      }),
    );
  }
  const published = records[1];
  const run = (path: string) => ns(join(RUNS_DIR, published.runId, path));
  const artefacts: [string, string, Buffer][] = [
    ["report.md", "report", text(`# ${query}\n\nThe store publishes by marker rename [S1].\n`)],
    ["query.txt", "query", text(query)],
    [
      "run.json",
      "manifest-data",
      encodeRecord(
        manifestFor([
          {
            relativePath: "late/S2.md",
            kind: "late",
            bytes: text("Late extraction, not evidence.\n"),
          },
        ]),
      ),
    ],
    ["sources/S1.md", "source", text("Example source page.\n")],
    ["extractions/S1.md", "extraction", text("Example extraction.\n")],
  ];
  for (const [path, , bytes] of artefacts) files.set(run(path), bytes);
  files.set(run("late/S2.md"), text("Late extraction, not evidence.\n"));
  const marker = encodeRecord({
    schema: "intelli-v1/committed",
    schemaVersion: 1,
    namespaceId: NS,
    runId: published.runId,
    admissionSequence: 2,
    allocationHash: published.hash,
    compatibilityKey: key,
    query,
    startedUtc: START,
    reportOutcome: "succeeded",
    files: artefacts.map(([relativePath, kind, bytes]) => ({
      relativePath,
      kind,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    })),
    nonEvidence: [
      {
        relativePath: "late/S2.md",
        bytes: files.get(run("late/S2.md"))!.byteLength,
        sha256: sha256(files.get(run("late/S2.md"))!),
      },
    ],
  });
  files.set(run("committed.json"), marker);
  const manifestSha256 = sha256(marker);
  const accounting = encodeRecord({
    schema: "intelli-v1/accounting",
    schemaVersion: 1,
    namespaceId: NS,
    runId: published.runId,
    manifestSha256,
    coverage: "all-model-work-settled",
    attempts: [
      {
        operationId: "op-2",
        callId: "c1",
        attempt: 1,
        model: { provider: "fixture", model: "m" },
        role: "collate",
        state: "succeeded",
        startedAtMs: 0,
        settledAtMs: 10,
        queueMs: 0,
      },
    ],
    summary: {
      attempts: 1,
      observedAttempts: 0,
      missingAttempts: 1,
      tokens: {},
      reportedCost: {},
      estimatedCost: {},
      missingTokenFields: [...TOKEN_FIELDS],
      costComplete: false,
      parentDelivery: "unknown",
    },
  });
  files.set(run("accounting.json"), accounting);
  files.set(
    run("accounting.committed.json"),
    encodeRecord({
      schema: "intelli-v1/accounting-committed",
      schemaVersion: 1,
      namespaceId: NS,
      runId: published.runId,
      manifestSha256,
      file: {
        relativePath: "accounting.json",
        bytes: accounting.byteLength,
        sha256: sha256(accounting),
      },
    }),
  );
  files.set(
    ns(INDEX_FILE),
    encodeRecord({
      schema: "intelli-v1/index",
      schemaVersion: 1,
      namespaceId: NS,
      entries: [
        {
          runId: published.runId,
          sequence: 2,
          compatibilityKey: key,
          query,
          startedUtc: START,
          manifestSha256,
        },
      ],
    }),
  );
  return files;
}

function expectedFixtures(): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  for (const [name, schema] of Object.entries(wireSchemas)) {
    const document = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: `intelli-v1/${name}@1`,
      ...JSON.parse(JSON.stringify(schema)),
    };
    files.set(`${name}.schema.json`, Buffer.from(JSON.stringify(document, null, 2) + "\n"));
  }
  for (const [path, bytes] of exampleNamespace()) files.set(path, bytes);
  return files;
}

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else out.push(relative(root, path));
    }
  }
  await walk(root);
  return out.sort();
}

describe("run-store-v1 wire schemas and fixtures", () => {
  it("committed fixtures match the generated schemas and example namespace", async () => {
    const expected = expectedFixtures();
    if (update) {
      for (const [path, bytes] of expected) {
        await mkdir(dirname(join(fixtures, path)), { recursive: true });
        await writeFile(join(fixtures, path), bytes);
      }
    }
    assert.deepEqual(
      await listFiles(fixtures),
      [...expected.keys()].sort(),
      "no stale or missing fixture files",
    );
    for (const [path, bytes] of expected)
      assert.deepEqual(
        await readFile(join(fixtures, path)),
        bytes,
        `${path} drifted; regenerate deliberately`,
      );
  });

  it("every example document validates against its published JSON Schema file", async () => {
    const schema = async (name: string) =>
      JSON.parse(await readFile(join(fixtures, `${name}.schema.json`), "utf8"));
    const root = join(fixtures, "example", NAMESPACE_DIR);
    const check = async (name: string, path: string) => {
      const value = JSON.parse(await readFile(join(root, path), "utf8"));
      assert.ok(Value.Check(await schema(name), value), `${path} fails ${name}`);
    };
    await check("namespace", NAMESPACE_FILE);
    await check("index", INDEX_FILE);
    await check("writer-owner", OWNER_FILE);
    for (const line of (await readFile(join(root, JOURNAL_FILE), "utf8")).trim().split("\n"))
      assert.ok(Value.Check(await schema("allocation"), JSON.parse(line)));
    for (const runId of await readdir(join(root, RUNS_DIR)))
      await check("reservation", join(RUNS_DIR, runId, "reservation.json"));
    const published = (await readdir(join(root, RUNS_DIR))).sort()[1];
    await check("committed", join(RUNS_DIR, published, "committed.json"));
    await check("run", join(RUNS_DIR, published, "run.json"));
    await check("accounting", join(RUNS_DIR, published, "accounting.json"));
    await check("accounting-committed", join(RUNS_DIR, published, "accounting.committed.json"));
    // Schemas are strict: an unknown field is rejected.
    const namespace = JSON.parse(await readFile(join(root, NAMESPACE_FILE), "utf8"));
    assert.equal(Value.Check(await schema("namespace"), { ...namespace, extra: true }), false);
  });

  it("the example namespace passes the real journal, marker, accounting and candidate readers", async () => {
    const root = join(fixtures, "example", NAMESPACE_DIR);
    const journal = await validateJournal(root, NS, "writer");
    assert.equal(journal.records.size, 2);
    const runs = (await readdir(join(root, RUNS_DIR))).sort();
    const gap = await verifyCommittedRun(root, NS, runs[0], journal.records.get(runs[0]));
    assert.equal(gap.ok, false, "journalled gap without marker is not evidence");
    const verified = await verifyCommittedRun(root, NS, runs[1], journal.records.get(runs[1]));
    assert.equal(verified.ok, true, verified.ok ? "" : verified.reason);
    if (!verified.ok) return;
    assert.ok(
      await verifyAccounting(join(root, RUNS_DIR, runs[1]), NS, runs[1], verified.manifestSha256),
    );
    const candidates = await createRunStore(storeOptions(join(fixtures, "example"))).candidates(
      undefined,
      "different",
      new AbortController().signal,
    );
    assert.deepEqual(
      candidates.map((c) => [c.namespace, c.admissionSequence]),
      [["v1", 2]],
    );
  });

  it("journal hashes are sha256 of sorted-key canonical JSON excluding hash, chained from 64 zeros", () => {
    assert.equal(
      canonicalJson({ b: 1, a: [true, null, "x"], c: { z: 1, y: 2 } }),
      '{"a":[true,null,"x"],"b":1,"c":{"y":2,"z":1}}',
    );
    assert.throws(() => canonicalJson({ a: Number.NaN }));
    const body = {
      schema: "intelli-v1/allocation",
      schemaVersion: 1,
      namespaceId: NS,
      sequence: 1,
      runId: "r",
      operationId: "o",
      compatibilityKey: compatibilityKeyFor("q", "2026-10-18"),
      startedUtc: START,
      previousHash: ZERO_HASH,
    } as const;
    const hash = allocationHash(body);
    assert.equal(hash, sha256(Buffer.from(canonicalJson(body), "utf8")));
    assert.equal(allocationHash({ ...body, hash }), hash, "the hash field itself is excluded");
    assert.equal(ZERO_HASH, "0".repeat(64));
  });

  it("namespace and artefact names avoid legacy patterns, reserved names and traversal", () => {
    const legacySlug = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+(\.\d+)?$/;
    assert.ok(!legacySlug.test(NAMESPACE_DIR));
    assert.ok(![".staging", ".index.json", ".index.lock", ".version.json"].includes(NAMESPACE_DIR));
    assert.ok(!NAMESPACE_DIR.startsWith(".staging"));
    for (const bad of [
      "../x",
      "/abs",
      "a/../b",
      "a\\b",
      ".hidden",
      "committed.json",
      "reservation.json",
      "x.tmp",
      "C:/x",
      "a/b/c/d/e",
      "",
    ])
      assert.equal(isSafeRelativePath(bad), false, bad);
    for (const good of ["report.md", "sources/S1-example-com.md", "late/S2.md"])
      assert.equal(isSafeRelativePath(good), true, good);
    assert.equal(displayLabel("Rust: async/await?", START), "2026-10-18-rust-asyncawait");
    assert.equal(displayLabel("日本語", START), "2026-10-18");
  });
});
