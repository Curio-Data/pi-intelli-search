// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// Independent-process proofs (T21/T23/T25): concurrent allocation and
// publication across processes, SIGKILL at each named persistence boundary,
// and old/new writers sharing one configured parent. Observed only on the
// platform recorded by the test run; SIGKILL does not model power loss or a
// device that ignores completed syncs.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lstat, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createRunStore, rebuildRunIndex, type FaultPoint } from "../src/core/run-store.js";
import {
  INDEX_FILE,
  JOURNAL_FILE,
  LOCK_FILE,
  MARKER_FILE,
  NAMESPACE_DIR,
  RESERVATION_FILE,
  RUNS_DIR,
} from "../src/core/run-format.js";
import { readNamespace, validateJournal, verifyCommittedRun } from "../src/core/run-journal.js";
import {
  artifactsFor,
  runWorker,
  scratchRoot,
  storeOptions,
} from "./helpers/run-store-fixtures.js";

const never = new AbortController().signal;

function lines(stdout: string): Record<string, unknown>[] {
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function journal(root: string) {
  const dir = join(root, NAMESPACE_DIR);
  const namespace = await readNamespace(dir);
  assert.ok(namespace);
  return { dir, namespace, state: await validateJournal(dir, namespace.namespaceId, "writer") };
}

describe("independent processes", () => {
  it("allocate, publish and index concurrently with unique contiguous admissions", async () => {
    const root = await scratchRoot("process-concurrent");
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        runWorker({ mode: "commit", cacheRoot: root, count: 5, label: `w${i}` }),
      ),
    );
    const granted: number[] = [];
    for (const result of results) {
      assert.equal(result.code, 0, result.stderr);
      for (const line of lines(result.stdout)) {
        if (typeof line.granted === "number") granted.push(line.granted);
        if ("commit" in line) assert.equal(line.commit, "committed");
        if ("index" in line) assert.equal(line.index, "updated");
        assert.ok(!("diagnostic" in line), JSON.stringify(line));
      }
    }
    assert.deepEqual(
      granted.sort((a, b) => a - b),
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
    const { dir, namespace, state } = await journal(root);
    assert.equal(state.records.size, 20);
    const index = JSON.parse(await readFile(join(dir, INDEX_FILE), "utf8"));
    assert.equal(index.entries.length, 20, "no index update was lost under the shared lock");
    for (const entry of index.entries) {
      const verified = await verifyCommittedRun(
        dir,
        namespace.namespaceId,
        entry.runId,
        state.records.get(entry.runId),
        { expectedManifestSha256: entry.manifestSha256 },
      );
      assert.equal(verified.ok, true);
    }
  });

  const boundaries: FaultPoint[] = [
    "lock-acquired",
    "after-run-mkdir",
    "after-journal-write",
    "after-journal-sync",
    "after-reservation",
    "after-artifacts",
    "before-marker-rename",
    "after-marker-rename",
    "before-index-rename",
  ];
  for (const point of boundaries) {
    it(`SIGKILL at ${point} never reuses a granted sequence and needs no lock cleanup`, async () => {
      const root = await scratchRoot(`process-crash-${point}`);
      const prior = createRunStore(storeOptions(root));
      const first = await prior.allocate({
        operationId: "prior",
        query: "prior",
        startedUtc: new Date().toISOString(),
        signal: never,
      });
      assert.equal(first.status, "allocated");
      if (first.status !== "allocated") return;
      // A committed, indexed prior run makes index.json exist before the crash.
      const priorCommit = await prior.commit(first.reservation, artifactsFor("prior"), never);
      assert.equal(priorCommit.status, "committed");
      if (priorCommit.status === "committed")
        assert.equal(await prior.updateIndex(priorCommit.run, "prior", never), "updated");
      const lockBefore = await stat(join(root, NAMESPACE_DIR, LOCK_FILE));
      const crashed = await runWorker({
        mode: "commit",
        cacheRoot: root,
        count: 1,
        crashAt: point,
        query: "crash query",
      });
      assert.equal(crashed.signal, "SIGKILL", crashed.stderr);
      const crashedLines = lines(crashed.stdout);
      assert.ok(
        crashedLines.some((l) => l.fault === point),
        "the crash happened at the named boundary",
      );
      const { dir, namespace, state } = await journal(root);
      const journalled = state.last?.sequence ?? 0;
      const next = await createRunStore(storeOptions(root)).allocate({
        operationId: "after",
        query: "after",
        startedUtc: new Date().toISOString(),
        signal: never,
      });
      assert.equal(next.status, "allocated", JSON.stringify(next));
      if (next.status !== "allocated") return;
      assert.equal(
        next.reservation.sequence,
        journalled + 1,
        "allocation continues after every journalled record",
      );
      assert.ok(next.reservation.sequence > 1);
      // A killed process loses no completed write(2): the record written before
      // its sync is still in the page cache. Power loss is not modelled here.
      assert.equal(
        journalled,
        ["lock-acquired", "after-run-mkdir"].includes(point) ? 1 : 2,
        `journal after ${point}`,
      );
      const lockAfter = await stat(join(root, NAMESPACE_DIR, LOCK_FILE));
      assert.equal(lockAfter.ino, lockBefore.ino, "stable lock inode");
      const final = await journal(root);
      const runs = await readdir(join(dir, RUNS_DIR));
      for (const runId of runs) {
        if (runId === first.reservation.runId) continue;
        const markerExists = await lstat(join(dir, RUNS_DIR, runId, MARKER_FILE)).then(
          () => true,
          () => false,
        );
        const record = final.state.records.get(runId);
        if (markerExists) {
          assert.ok(
            ["after-marker-rename", "before-index-rename"].includes(point),
            `marker only after publication (${point})`,
          );
          assert.equal(
            (await verifyCommittedRun(dir, namespace.namespaceId, runId, record)).ok,
            true,
          );
        }
        if (!record)
          assert.deepEqual(
            await readdir(join(dir, RUNS_DIR, runId)),
            [],
            "an unjournalled directory is an empty orphan",
          );
        if (record && point === "after-journal-sync" && record.sequence === 2)
          await assert.rejects(
            lstat(join(dir, RUNS_DIR, runId, RESERVATION_FILE)),
            { code: "ENOENT" },
            "journalled gap without reservation",
          );
      }
      const candidates = await createRunStore(storeOptions(root)).candidates(
        undefined,
        "unrelated",
        never,
      );
      const published = ["after-marker-rename", "before-index-rename"].includes(point);
      if (published) {
        // Publication survived but the index missed it; the explicit rebuild recovers it.
        assert.equal(
          candidates.some((c) => c.query === "crash query"),
          false,
        );
        const rebuilt = await rebuildRunIndex(storeOptions(root), never);
        assert.equal(rebuilt.status, "rebuilt");
        const after = await createRunStore(storeOptions(root)).candidates(
          undefined,
          "unrelated",
          never,
        );
        assert.equal(after.filter((c) => c.query === "crash query").length, 1);
      } else
        assert.deepEqual(
          candidates.map((c) => c.query),
          ["prior"],
          "no uncommitted run is suggested",
        );
    });
  }

  it("old and new writers share one configured parent without touching each other's metadata", async () => {
    const root = await scratchRoot("process-old-new");
    const [legacy, fresh] = await Promise.all([
      runWorker({ mode: "legacy", cacheRoot: root, count: 3 }),
      runWorker({ mode: "commit", cacheRoot: root, count: 3, label: "new" }),
    ]);
    assert.equal(legacy.code, 0, legacy.stderr);
    assert.equal(fresh.code, 0, fresh.stderr);
    const legacyIndex = JSON.parse(await readFile(join(root, ".index.json"), "utf8"));
    assert.equal(legacyIndex.searches.length, 3);
    assert.ok(
      legacyIndex.searches.every((e: { slug: string }) =>
        /^\d{4}-\d{2}-\d{2}-legacy-query/.test(e.slug),
      ),
    );
    const top = (await readdir(root)).sort();
    assert.ok(top.includes(NAMESPACE_DIR));
    assert.ok(
      !top.some((name) => name.includes("new-query")),
      "new runs never land in the legacy root",
    );
    const namespaceEntries = await readdir(join(root, NAMESPACE_DIR));
    assert.ok(
      !namespaceEntries.includes(".index.json") &&
        !namespaceEntries.some((n) => n.includes("legacy")),
    );
    const newIndex = JSON.parse(await readFile(join(root, NAMESPACE_DIR, INDEX_FILE), "utf8"));
    assert.equal(newIndex.entries.length, 3);
    const candidates = await createRunStore(storeOptions(root)).candidates(
      undefined,
      "unrelated",
      never,
    );
    assert.deepEqual(candidates.map((c) => c.namespace).sort(), [
      "legacy",
      "legacy",
      "legacy",
      "v1",
      "v1",
      "v1",
    ]);
    assert.ok(
      candidates
        .filter((c) => c.namespace === "legacy")
        .every((c) => c.admissionSequence === undefined),
    );
    const journalText = await readFile(join(root, NAMESPACE_DIR, JOURNAL_FILE), "utf8");
    assert.equal(journalText.trim().split("\n").length, 3);
  });
});
