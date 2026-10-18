// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// T21-T25 in-process library proofs for createRunStore: namespace layout,
// exclusive allocation, publication/abort linearisation, explicit failure
// unions, journal fail-closed validation and writer settlement.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  appendFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  stat,
  truncate,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type {
  AccountingSummary,
  Diagnostic,
  RunReservation,
} from "../src/core/execution-contracts.js";
import { createRunStore, createRunStoreWithHooks, type FaultPoint } from "../src/core/run-store.js";
import { acquireWriterLock, loadNativeLockBinding } from "../src/core/run-lock.js";
import {
  ACCOUNTING_FILE,
  ACCOUNTING_MARKER_FILE,
  INDEX_FILE,
  IndexSchema,
  JOURNAL_FILE,
  JOURNAL_MAX_BYTES,
  LOCK_FILE,
  MARKER_FILE,
  NAMESPACE_DIR,
  NAMESPACE_FILE,
  RESERVATION_FILE,
  RUNS_DIR,
  ZERO_HASH,
  allocationHash,
  compatibilityKeyFor,
  encodeRecord,
  isValid,
  type AllocationRecord,
} from "../src/core/run-format.js";
import {
  readNamespace,
  validateJournal,
  verifyAccounting,
  verifyCommittedRun,
  StoreError,
} from "../src/core/run-journal.js";
import {
  artifactsFor,
  scratchRoot,
  storeOptions,
  virtualClock,
} from "./helpers/run-store-fixtures.js";

const never = new AbortController().signal;
const START = "2026-10-18T12:00:00.000Z";
const summary: AccountingSummary = {
  attempts: 1,
  observedAttempts: 1,
  missingAttempts: 0,
  tokens: { inputTotal: 10, outputTotal: 5 },
  reportedCost: { total: 0.001 },
  estimatedCost: {},
  missingTokenFields: [],
  costComplete: true,
  parentDelivery: "available",
};

async function allocated(
  store: ReturnType<typeof createRunStore>,
  query = "what is p2",
  startedUtc = START,
): Promise<RunReservation> {
  const result = await store.allocate({
    operationId: `op-${query}`,
    query,
    startedUtc,
    signal: never,
  });
  assert.equal(result.status, "allocated", JSON.stringify(result));
  if (result.status !== "allocated") throw new Error("unreachable");
  return result.reservation;
}

async function journalRecords(root: string): Promise<AllocationRecord[]> {
  const text = await readFile(join(root, NAMESPACE_DIR, JOURNAL_FILE), "utf8");
  return text.trim()
    ? text
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
    : [];
}

describe("C21/C22 namespace, allocation and publication", () => {
  it("creates only the .intelli-v1 layout and publishes a verified run without telemetry", async () => {
    const root = await scratchRoot("store-happy");
    const diagnostics: Diagnostic[] = [];
    const store = createRunStore(storeOptions(root, { diagnostics }));
    const reservation = await allocated(store);
    assert.equal(reservation.sequence, 1);
    assert.equal(reservation.physicalPath, join(root, NAMESPACE_DIR, RUNS_DIR, reservation.runId));
    assert.equal(
      reservation.displayPath,
      join(".search", NAMESPACE_DIR, RUNS_DIR, reservation.runId),
    );
    assert.match(reservation.runId, /^2026-10-18-what-is-p2-[0-9a-f]{32}$/);
    assert.equal(reservation.compatibilityKey, compatibilityKeyFor("what is p2", "2026-10-18"));
    assert.deepEqual(
      (await readdir(root)).sort(),
      [NAMESPACE_DIR],
      "nothing outside the namespace",
    );
    assert.ok((await lstat(join(root, NAMESPACE_DIR, LOCK_FILE))).isFile());
    for (const name of [NAMESPACE_FILE, JOURNAL_FILE, RUNS_DIR])
      await lstat(join(root, NAMESPACE_DIR, name));
    await lstat(join(reservation.physicalPath, RESERVATION_FILE));

    const committed = await store.commit(reservation, artifactsFor("what is p2"), never);
    assert.equal(committed.status, "committed");
    if (committed.status !== "committed") return;
    assert.deepEqual(
      committed.run.files.map((f) => f.relativePath),
      ["report.md", "query.txt", "run.json", "sources/S1.md", "extractions/S1.md"],
    );
    const names = await readdir(reservation.physicalPath);
    assert.ok(!names.includes("meta.json"), "committed without optional telemetry");
    assert.ok(!names.some((n) => n.endsWith(".tmp")));
    const namespace = await readNamespace(join(root, NAMESPACE_DIR));
    const journal = await validateJournal(
      join(root, NAMESPACE_DIR),
      namespace!.namespaceId,
      "writer",
    );
    const verified = await verifyCommittedRun(
      join(root, NAMESPACE_DIR),
      namespace!.namespaceId,
      reservation.runId,
      journal.records.get(reservation.runId),
    );
    assert.equal(verified.ok, true);
    assert.equal(verified.ok && verified.manifestSha256, committed.run.manifestSha256);

    assert.equal(await store.updateIndex(committed.run, "what is p2", never), "updated");
    const index = JSON.parse(await readFile(join(root, NAMESPACE_DIR, INDEX_FILE), "utf8"));
    assert.ok(isValid(IndexSchema, index));
    assert.equal(index.entries[0].runId, reservation.runId);

    const accounting = await store.recordAccounting(committed.run, [], summary, never);
    assert.deepEqual(accounting, {
      status: "recorded",
      path: join(reservation.displayPath, ACCOUNTING_FILE),
    });
    const record = await verifyAccounting(
      reservation.physicalPath,
      namespace!.namespaceId,
      reservation.runId,
      committed.run.manifestSha256,
    );
    assert.equal(record?.coverage, "all-model-work-settled");
    assert.equal(
      (await store.recordAccounting(committed.run, [], summary, never)).status,
      "unavailable",
      "accounting is immutable",
    );
    await store.settle();
    assert.deepEqual(
      diagnostics.map((d) => d.code),
      [],
    );
  });

  it("concurrent operation stores in one process receive unique contiguous sequences", async () => {
    const root = await scratchRoot("store-concurrent");
    const stores = Array.from({ length: 6 }, () => createRunStore(storeOptions(root)));
    const reservations = await Promise.all(
      stores.map((store, i) => allocated(store, `query ${i}`)),
    );
    assert.deepEqual(
      reservations.map((r) => r.sequence).sort((a, b) => a - b),
      [1, 2, 3, 4, 5, 6],
    );
    assert.equal(new Set(reservations.map((r) => r.runId)).size, 6);
    const records = await journalRecords(root);
    assert.deepEqual(
      records.map((r) => r.sequence),
      [1, 2, 3, 4, 5, 6],
    );
    assert.equal(records[0].previousHash, ZERO_HASH);
    for (let i = 1; i < records.length; i++)
      assert.equal(records[i].previousHash, records[i - 1].hash);
  });

  it("forced ID collisions retry, never overwrite, and fail after 16 without journalling", async () => {
    const root = await scratchRoot("store-collisions");
    const fixed = "a".repeat(32);
    const first = createRunStore(storeOptions(root, { randomId: () => fixed }));
    const reservation = await allocated(first, "same words");
    const before = await readFile(join(reservation.physicalPath, RESERVATION_FILE));
    const journalBefore = await readFile(join(root, NAMESPACE_DIR, JOURNAL_FILE));
    let calls = 0;
    const diagnostics: Diagnostic[] = [];
    const colliding = createRunStore(
      storeOptions(root, { randomId: () => (calls++, fixed), diagnostics }),
    );
    const result = await colliding.allocate({
      operationId: "op2",
      query: "same words",
      startedUtc: START,
      signal: never,
    });
    assert.equal(result.status === "unavailable" && result.diagnostic.code, "RUN_ID_COLLISIONS");
    assert.equal(calls, 16);
    assert.deepEqual(
      await readFile(join(reservation.physicalPath, RESERVATION_FILE)),
      before,
      "target untouched",
    );
    assert.deepEqual(
      await readFile(join(root, NAMESPACE_DIR, JOURNAL_FILE)),
      journalBefore,
      "no admission consumed",
    );
    const ids = [fixed, fixed, "b".repeat(32)];
    const retrying = createRunStore(
      storeOptions(root, { randomId: () => ids.shift() ?? "c".repeat(32) }),
    );
    const second = await allocated(retrying, "same words");
    assert.equal(second.sequence, 2);
    assert.ok(second.runId.endsWith("b".repeat(32)));
    const controller = new AbortController();
    controller.abort();
    const aborted = await createRunStore(storeOptions(root)).allocate({
      operationId: "op3",
      query: "x",
      startedUtc: START,
      signal: controller.signal,
    });
    assert.equal(aborted.status === "unavailable" && aborted.diagnostic.code, "ABORTED");
  });

  it("rejects run-ID sources that would exceed the run ID schema", async () => {
    const root = await scratchRoot("store-nonce");
    for (const bad of ["f".repeat(64), "XYZ", "abc"]) {
      const result = await createRunStore(storeOptions(root, { randomId: () => bad })).allocate({
        operationId: "op",
        query: "a much longer query with many words to fill the label",
        startedUtc: START,
        signal: never,
      });
      assert.equal(result.status === "unavailable" && result.diagnostic.code, "INVALID_NONCE", bad);
    }
    const ok = await allocated(
      createRunStore(storeOptions(root)),
      "a much longer query with many words to fill the label " + "x".repeat(80),
    );
    assert.ok(ok.runId.length <= 128);
  });

  it("collision retry checks cancellation on each attempt", async () => {
    const root = await scratchRoot("store-collision-abort");
    const fixed = "d".repeat(32);
    await allocated(createRunStore(storeOptions(root, { randomId: () => fixed })), "w");
    const controller = new AbortController();
    let calls = 0;
    const store = createRunStore(
      storeOptions(root, {
        randomId: () => {
          if (++calls === 3) controller.abort();
          return fixed;
        },
      }),
    );
    const result = await store.allocate({
      operationId: "op",
      query: "w",
      startedUtc: START,
      signal: controller.signal,
    });
    assert.equal(result.status === "unavailable" && result.diagnostic.code, "ABORTED");
    assert.equal(calls, 3);
  });

  it("returns the explicit unavailable union for invalid artefacts and I/O failure, preserving evidence", async () => {
    const root = await scratchRoot("store-commit-failure");
    const cases: [string, ReturnType<typeof artifactsFor>][] = [
      [
        "traversal",
        artifactsFor("q", [
          { relativePath: "../escape.md", kind: "source", bytes: new Uint8Array(1) },
        ]),
      ],
      [
        "absolute",
        artifactsFor("q", [{ relativePath: "/etc/x", kind: "source", bytes: new Uint8Array(1) }]),
      ],
      [
        "reserved",
        artifactsFor("q", [
          { relativePath: "committed.json", kind: "source", bytes: new Uint8Array(1) },
        ]),
      ],
      [
        "duplicate",
        artifactsFor("q", [
          { relativePath: "sources/S1.md", kind: "source", bytes: new Uint8Array(1) },
        ]),
      ],
      [
        "empty report",
        artifactsFor("q").map((a) => (a.kind === "report" ? { ...a, bytes: new Uint8Array() } : a)),
      ],
      ["query mismatch", artifactsFor("other")],
      ["missing run.json", artifactsFor("q").filter((a) => a.kind !== "manifest-data")],
    ];
    for (const [label, artifacts] of cases) {
      const store = createRunStore(storeOptions(root));
      const reservation = await allocated(store, "q");
      const result = await store.commit(reservation, artifacts, never);
      assert.equal(result.status, "unavailable", label);
      assert.equal(
        result.status === "unavailable" && result.diagnostic.code,
        "INVALID_ARTIFACTS",
        label,
      );
      await assert.rejects(lstat(join(reservation.physicalPath, MARKER_FILE)), { code: "ENOENT" });
      await lstat(join(reservation.physicalPath, RESERVATION_FILE));
      assert.equal(
        (await store.commit(reservation, artifactsFor("q"), never)).status,
        "unavailable",
        "never republished",
      );
    }
    const store = createRunStore(storeOptions(root));
    const reservation = await allocated(store, "q");
    const result = await store.commit(
      reservation,
      artifactsFor("q", [
        { relativePath: "sources/S2.md", kind: "source", stagedPath: join(root, "missing") },
      ]),
      never,
    );
    assert.equal(result.status, "unavailable");
    await assert.rejects(lstat(join(reservation.physicalPath, MARKER_FILE)), { code: "ENOENT" });
    await lstat(join(reservation.physicalPath, "report.md"));
    const other = createRunStore(storeOptions(root));
    assert.equal(
      (await other.commit(reservation, artifactsFor("q"), never)).status,
      "unavailable",
      "foreign reservation",
    );
  });

  it("streams staged artefacts and labels late files as non-evidence", async () => {
    const root = await scratchRoot("store-staged");
    await mkdir(join(root, "staging"));
    await writeFile(join(root, "staging", "page"), "x".repeat(200_000));
    const store = createRunStore(storeOptions(root));
    const reservation = await allocated(store, "q");
    const result = await store.commit(
      reservation,
      artifactsFor("q", [
        {
          relativePath: "sources/S2.md",
          kind: "source",
          stagedPath: join(root, "staging", "page"),
        },
        {
          relativePath: "late/S3.md",
          kind: "late",
          bytes: new TextEncoder().encode("late extraction"),
        },
      ]),
      never,
    );
    assert.equal(result.status, "committed");
    const marker = JSON.parse(await readFile(join(reservation.physicalPath, MARKER_FILE), "utf8"));
    assert.equal(
      marker.files.find((f: { relativePath: string }) => f.relativePath === "sources/S2.md").bytes,
      200_000,
    );
    assert.deepEqual(
      marker.nonEvidence.map((f: { relativePath: string }) => f.relativePath),
      ["late/S3.md"],
    );
    assert.ok(
      !marker.files.some((f: { relativePath: string }) => f.relativePath.startsWith("late/")),
    );
  });

  it("abort before the marker leaves it absent; abort after the rename preserves the commit", async () => {
    const root = await scratchRoot("store-abort");
    for (const point of ["after-artifacts", "before-marker-rename"] as FaultPoint[]) {
      const controller = new AbortController();
      const store = createRunStoreWithHooks(storeOptions(root), {
        fault: (p) => void (p === point && controller.abort()),
      });
      const reservation = await allocated(store, `abort ${point}`);
      const result = await store.commit(
        reservation,
        artifactsFor(`abort ${point}`),
        controller.signal,
      );
      assert.equal(result.status === "unavailable" && result.diagnostic.code, "ABORTED", point);
      const names = await readdir(reservation.physicalPath);
      assert.ok(!names.includes(MARKER_FILE), point);
      assert.ok(!names.some((n) => n.startsWith(".committed.json")), "private temp marker removed");
      assert.ok(names.includes("report.md"), "partial evidence preserved");
      await store.settle();
    }
    const controller = new AbortController();
    const store = createRunStoreWithHooks(storeOptions(root), {
      fault: (p) => void (p === "after-marker-rename" && controller.abort()),
    });
    const reservation = await allocated(store, "abort late");
    const result = await store.commit(reservation, artifactsFor("abort late"), controller.signal);
    assert.equal(result.status, "committed", "publication is the linearisation point");
    if (result.status !== "committed") return;
    const accounting = await store.recordAccounting(result.run, [], summary, controller.signal);
    assert.equal(accounting.status === "unavailable" && accounting.diagnostic.code, "ABORTED");
    const names = await readdir(reservation.physicalPath);
    assert.ok(
      !names.includes(ACCOUNTING_FILE) && !names.includes(ACCOUNTING_MARKER_FILE),
      "no accounting write after abort",
    );
  });

  it("an index failure after a valid marker preserves the committed run", async () => {
    const root = await scratchRoot("store-index-failure");
    const diagnostics: Diagnostic[] = [];
    const store = createRunStoreWithHooks(storeOptions(root, { diagnostics }), {
      fault: (p) => {
        if (p === "before-index-rename") throw new Error("injected index failure");
      },
    });
    const reservation = await allocated(store, "q");
    const result = await store.commit(reservation, artifactsFor("q"), never);
    assert.equal(result.status, "committed");
    if (result.status !== "committed") return;
    assert.equal(await store.updateIndex(result.run, "q", never), "unavailable");
    assert.ok(diagnostics.some((d) => d.message.includes("committed report is preserved")));
    const namespace = await readNamespace(join(root, NAMESPACE_DIR));
    const journal = await validateJournal(
      join(root, NAMESPACE_DIR),
      namespace!.namespaceId,
      "writer",
    );
    assert.equal(
      (
        await verifyCommittedRun(
          join(root, NAMESPACE_DIR),
          namespace!.namespaceId,
          reservation.runId,
          journal.records.get(reservation.runId),
        )
      ).ok,
      true,
    );
    assert.ok(!(await readdir(join(root, NAMESPACE_DIR))).some((n) => n.endsWith(".tmp")));
    assert.equal(
      await store.updateIndex(result.run, "different", never),
      "unavailable",
      "query must match the committed query",
    );
  });

  it("unproven marker durability is not advertised; failed accounting is ignored by readers", async () => {
    const root = await scratchRoot("store-durability");
    const store = createRunStoreWithHooks(storeOptions(root), {
      fault: (p) => {
        if (p === "after-marker-rename") throw new Error("injected directory sync failure");
      },
    });
    const reservation = await allocated(store, "q");
    const result = await store.commit(reservation, artifactsFor("q"), never);
    assert.equal(
      result.status === "unavailable" && result.diagnostic.code,
      "MARKER_DURABILITY_UNKNOWN",
    );
    assert.ok(!("run" in result));

    const store2 = createRunStoreWithHooks(storeOptions(root), {
      fault: (p) => {
        if (p === "before-accounting-marker-rename") throw new Error("injected accounting failure");
      },
    });
    const reservation2 = await allocated(store2, "q2");
    const committed = await store2.commit(reservation2, artifactsFor("q2"), never);
    assert.equal(committed.status, "committed");
    if (committed.status !== "committed") return;
    const accounting = await store2.recordAccounting(committed.run, [], summary, never);
    assert.equal(accounting.status, "unavailable");
    const namespace = await readNamespace(join(root, NAMESPACE_DIR));
    assert.equal(
      await verifyAccounting(
        reservation2.physicalPath,
        namespace!.namespaceId,
        reservation2.runId,
        committed.run.manifestSha256,
      ),
      undefined,
    );
    assert.ok(!(await readdir(reservation2.physicalPath)).includes(ACCOUNTING_MARKER_FILE));
  });

  it("settle waits for its own writers only", async () => {
    const root = await scratchRoot("store-settle");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const blocked = new Promise<void>((resolve) => (reached = resolve));
    const slow = createRunStoreWithHooks(storeOptions(root), {
      fault: async (p) => {
        if (p === "after-artifacts") {
          reached();
          await gate;
        }
      },
    });
    const other = createRunStore(storeOptions(root));
    const reservation = await allocated(slow, "slow");
    const commit = slow.commit(reservation, artifactsFor("slow"), never);
    await blocked;
    await other.settle();
    let settled = false;
    const slowSettled = slow.settle().then(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(settled, false, "own pending commit keeps settle open");
    release();
    assert.equal((await commit).status, "committed");
    await slowSettled;
    assert.equal(settled, true);
  });

  it("an allocation while another process-local writer holds the lock is a bounded busy diagnostic", async () => {
    const root = await scratchRoot("store-busy");
    await allocated(createRunStore(storeOptions(root)));
    const held = await acquireWriterLock({
      namespaceDir: join(root, NAMESPACE_DIR),
      clock: virtualClock(),
      signal: never,
      loadBinding: loadNativeLockBinding,
    });
    assert.equal(held.status, "acquired");
    const clock = virtualClock();
    const result = await createRunStore(storeOptions(root, { clock })).allocate({
      operationId: "op",
      query: "q",
      startedUtc: START,
      signal: never,
    });
    assert.equal(result.status === "unavailable" && result.diagnostic.code, "LOCK_BUSY");
    assert.equal(clock.now, 2_000);
    if (held.status === "acquired") await held.lock.release();
  });
});

describe("C23 journal validation fails closed", () => {
  async function damagedRoot(label: string): Promise<string> {
    const root = await scratchRoot(label);
    const store = createRunStore(storeOptions(root));
    await allocated(store, "one");
    await allocated(store, "two");
    return root;
  }
  async function expectUnavailable(root: string, code: string): Promise<void> {
    const journal = join(root, NAMESPACE_DIR, JOURNAL_FILE);
    const before = await readFile(journal).catch(() => undefined);
    const result = await createRunStore(storeOptions(root)).allocate({
      operationId: "op",
      query: "three",
      startedUtc: START,
      signal: never,
    });
    assert.equal(
      result.status === "unavailable" && result.diagnostic.code,
      code,
      JSON.stringify(result),
    );
    assert.deepEqual(
      await readFile(journal).catch(() => undefined),
      before,
      "never truncated or rewritten",
    );
  }

  it("partial tail", async () => {
    const root = await damagedRoot("journal-tail");
    await appendFile(join(root, NAMESPACE_DIR, JOURNAL_FILE), '{"schema":"intelli-v1/allocation"');
    await expectUnavailable(root, "JOURNAL_DAMAGED");
  });

  it("broken chain, tampered hash, duplicate and regressing sequences", async () => {
    const mutations: ((records: AllocationRecord[]) => AllocationRecord[])[] = [
      (r) => [r[0], { ...r[1], previousHash: ZERO_HASH }],
      // Self-consistent record hash, broken previous-hash link.
      (r) => {
        const { hash: _hash, ...body } = { ...r[1], previousHash: ZERO_HASH };
        return [r[0], { ...body, hash: allocationHash(body) }];
      },
      (r) => [r[0], { ...r[1], operationId: "tampered" }],
      (r) => [r[0], r[0]],
      (r) => [r[1], r[0]],
      (r) => [r[0], { ...r[1], namespaceId: "f".repeat(32) }],
    ];
    for (const [i, mutate] of mutations.entries()) {
      const root = await damagedRoot(`journal-mutation-${i}`);
      const records = await journalRecords(root);
      const lines = mutate(records).map((r) => encodeRecord(r).toString("utf8"));
      await writeFile(join(root, NAMESPACE_DIR, JOURNAL_FILE), lines.join(""));
      await expectUnavailable(root, "JOURNAL_DAMAGED");
    }
  });

  it("oversized record and safety ceiling", async () => {
    const root = await damagedRoot("journal-oversize");
    await appendFile(join(root, NAMESPACE_DIR, JOURNAL_FILE), "x".repeat(5_000) + "\n");
    await expectUnavailable(root, "JOURNAL_DAMAGED");
    const root2 = await damagedRoot("journal-ceiling");
    await truncate(join(root2, NAMESPACE_DIR, JOURNAL_FILE), JOURNAL_MAX_BYTES + 1);
    await expectUnavailable(root2, "JOURNAL_CEILING");
  });

  it("missing journal or identity is damaged unless the namespace is provably fresh", async () => {
    const root = await damagedRoot("journal-missing");
    const { rename } = await import("node:fs/promises");
    await rename(join(root, NAMESPACE_DIR, JOURNAL_FILE), join(root, "moved-journal"));
    await expectUnavailable(root, "JOURNAL_MISSING");

    const root2 = await damagedRoot("namespace-missing");
    await rename(join(root2, NAMESPACE_DIR, NAMESPACE_FILE), join(root2, "moved-namespace"));
    await expectUnavailable(root2, "NAMESPACE_MISSING");

    const root3 = await damagedRoot("namespace-missing-runs");
    await rename(join(root3, NAMESPACE_DIR, NAMESPACE_FILE), join(root3, "moved-namespace"));
    await writeFile(join(root3, NAMESPACE_DIR, JOURNAL_FILE), "");
    await expectUnavailable(root3, "NAMESPACE_MISSING");

    // Crash between the empty journal and identity creation: still provably fresh.
    const root4 = await scratchRoot("namespace-fresh-crash");
    await mkdir(join(root4, NAMESPACE_DIR));
    await writeFile(join(root4, NAMESPACE_DIR, JOURNAL_FILE), "");
    assert.equal((await allocated(createRunStore(storeOptions(root4)), "fresh")).sequence, 1);
  });

  it("an unjournalled reservation fails closed; an empty orphan directory is an allowed gap", async () => {
    const root = await damagedRoot("journal-unjournalled");
    await mkdir(join(root, NAMESPACE_DIR, RUNS_DIR, "2026-10-18-orphan-empty"));
    const ok = await allocated(createRunStore(storeOptions(root)), "three");
    assert.equal(ok.sequence, 3);
    await mkdir(join(root, NAMESPACE_DIR, RUNS_DIR, "2026-10-18-foreign"));
    await writeFile(
      join(root, NAMESPACE_DIR, RUNS_DIR, "2026-10-18-foreign", RESERVATION_FILE),
      "{}",
    );
    await expectUnavailable(root, "UNJOURNALLED_RUN");
  });

  it("streams long journals, yielding and checking cancellation every 128 records", async () => {
    const root = await scratchRoot("journal-stream");
    const dir = join(root, NAMESPACE_DIR);
    await mkdir(dir);
    const namespaceId = "1".repeat(32);
    let previous = ZERO_HASH;
    const lines: string[] = [];
    for (let sequence = 1; sequence <= 300; sequence++) {
      const body = {
        schema: "intelli-v1/allocation" as const,
        schemaVersion: 1 as const,
        namespaceId,
        sequence,
        runId: `run-${sequence}`,
        operationId: `op-${sequence}`,
        compatibilityKey: compatibilityKeyFor(`q${sequence}`, "2026-10-18"),
        startedUtc: START,
        previousHash: previous,
      };
      const record = { ...body, hash: allocationHash(body) };
      previous = record.hash;
      lines.push(encodeRecord(record).toString("utf8"));
    }
    await writeFile(join(dir, JOURNAL_FILE), lines.join(""));
    const state = await validateJournal(dir, namespaceId, "writer");
    assert.equal(state.records.size, 300);
    assert.equal(state.last?.sequence, 300);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      validateJournal(dir, namespaceId, "writer", controller.signal),
      (error: unknown) => error instanceof StoreError && error.code === "ABORTED",
    );
    await appendFile(join(dir, JOURNAL_FILE), "{partial");
    assert.equal(
      (await validateJournal(dir, namespaceId, "reader")).records.size,
      300,
      "readers ignore an unterminated tail",
    );
    await assert.rejects(validateJournal(dir, namespaceId, "writer"), /partial tail/);
  });
});

describe("C23/C26 ordering is admission order, not clock order", () => {
  it("UTC rollback and midnight never reorder sequences; the highest admission per key wins", async () => {
    const root = await scratchRoot("order-rollback");
    const store = createRunStore(storeOptions(root));
    const late = await allocated(store, "same", "2026-10-18T23:59:59.999Z");
    const rolledBack = await allocated(
      createRunStore(storeOptions(root)),
      "same",
      "2026-10-18T00:00:00.000Z",
    );
    const nextDay = await allocated(
      createRunStore(storeOptions(root)),
      "same",
      "2026-10-19T00:00:00.001Z",
    );
    assert.deepEqual([late.sequence, rolledBack.sequence, nextDay.sequence], [1, 2, 3]);
    assert.equal(late.compatibilityKey, rolledBack.compatibilityKey);
    assert.notEqual(
      nextDay.compatibilityKey,
      late.compatibilityKey,
      "midnight starts a new date/query key",
    );
    // Commit the newer admission first, then the slower older writer.
    const stores = [createRunStore(storeOptions(root)), createRunStore(storeOptions(root))];
    const a = await allocated(stores[0], "race", START);
    const b = await allocated(stores[1], "race", START);
    const cb = await stores[1].commit(b, artifactsFor("race"), never);
    assert.equal(cb.status, "committed");
    if (cb.status === "committed")
      assert.equal(await stores[1].updateIndex(cb.run, "race", never), "updated");
    const ca = await stores[0].commit(a, artifactsFor("race"), never);
    assert.equal(ca.status, "committed");
    if (ca.status === "committed")
      assert.equal(await stores[0].updateIndex(ca.run, "race", never), "updated");
    const candidates = await createRunStore(storeOptions(root)).candidates(
      undefined,
      "unrelated",
      never,
    );
    const race = candidates.filter((c) => c.query === "race");
    assert.equal(race.length, 1, "one candidate per compatibility key");
    assert.equal(
      race[0].admissionSequence,
      b.sequence,
      "slower older writer cannot displace the higher admission",
    );
  });

  it("namespace stat shows the journal grows append-only", async () => {
    const root = await scratchRoot("order-growth");
    const store = createRunStore(storeOptions(root));
    const sizes: number[] = [];
    for (let i = 0; i < 3; i++) {
      await allocated(store, `g${i}`);
      sizes.push((await stat(join(root, NAMESPACE_DIR, JOURNAL_FILE))).size);
    }
    assert.ok(sizes[0] < sizes[1] && sizes[1] < sizes[2]);
  });
});
