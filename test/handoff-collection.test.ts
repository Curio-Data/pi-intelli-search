// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driveAcceptedSchedule } from "../scripts/research-handoff/collection.js";
import { unavailableRecord } from "../scripts/research-handoff/storage.js";
import type { RunManifest, RunRecord } from "../scripts/research-handoff/contracts.js";
import type { WorkerConfig } from "../scripts/research-handoff/runner.js";

function scheduleFixture(root: string, phase: "diagnostic" | "measured" = "diagnostic") {
  const schedule = [{ pair: 1, arm: "baseline" as const }, { pair: 1, arm: "candidate" as const }];
  const ids = schedule.map(item => `${root.split("/").at(-1)}-${item.arm}`);
  const manifests: RunManifest[] = schedule.map((item, index) => ({
    ...unavailableRecord(ids[index], phase, "new collection fixture").manifest,
    arm: item.arm,
    pair: item.pair,
    status: "scheduled",
  }));
  return { root, phase, schedule, ids, manifests, acceptancePath: join(root, "acceptance.json"), authPath: "unused", frozenPath: "unused" };
}

function workerRecord(cfg: WorkerConfig): RunRecord {
  const record = unavailableRecord(cfg.manifest.runId, cfg.manifest.phase, "replaced by worker fixture", cfg.manifest);
  delete record.analysisError;
  delete record.error;
  record.manifest.status = "completed";
  record.inputIntegrity = { matched: true, complete: true, problems: [], completenessProblems: [] };
  record.observerCoverage = { verified: true, problems: [] };
  record.financialControl = { budgetLimited: false, overrun: false, activeReservations: false };
  return record;
}

test("accepted collection executes in order, spaces workers and publishes durable progress", async () => {
  const root = await mkdtemp(join(tmpdir(), "handoff-collection-success-"));
  try {
    const calls: string[] = [], gaps: number[] = [];
    const result = await driveAcceptedSchedule({
      ...scheduleFixture(root),
      credentialCheck: async () => {},
      execute: async cfg => { calls.push(cfg.manifest.runId); return workerRecord(cfg); },
      sleep: async milliseconds => { gaps.push(milliseconds); },
    });
    assert.equal(result.stopped, false);
    assert.equal(calls.length, 2);
    assert.deepEqual(gaps, [30_000]);
    const inventory = JSON.parse(await readFile(join(root, "inventory.json"), "utf8")) as string[];
    assert.equal(inventory.length, 2);
    const progress = (await readFile(join(root, "collection-progress.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    assert.deepEqual(progress.map(row => row.runId), calls);
    assert.ok(progress.every(row => row.status === "completed" && row.stop === null));
    const outcome = JSON.parse(await readFile(result.outcomePath, "utf8"));
    assert.equal(outcome.observations, 2);
    assert.equal(outcome.progressPath, join(root, "collection-progress.jsonl"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a control failure retains its row and creates not-run successors without another worker", async () => {
  const root = await mkdtemp(join(tmpdir(), "handoff-collection-stop-"));
  try {
    const fixture = scheduleFixture(root);
    let workers = 0, credentials = 0, sleeps = 0;
    const result = await driveAcceptedSchedule({
      ...fixture,
      credentialCheck: async () => { credentials++; },
      execute: async cfg => {
        workers++;
        const record = workerRecord(cfg);
        record.manifest.status = "failed";
        record.observerCoverage = { verified: false, problems: ["synthetic missing coverage"] };
        return record;
      },
      sleep: async () => { sleeps++; },
    });
    assert.equal(result.stopped, true);
    assert.equal(workers, 1);
    assert.equal(credentials, 1);
    assert.equal(sleeps, 0);
    const inventory = JSON.parse(await readFile(join(root, "inventory.json"), "utf8")) as string[];
    const successor = JSON.parse(await readFile(join(root, inventory[1]), "utf8")) as RunRecord;
    assert.equal(successor.manifest.status, "not-run");
    assert.match(successor.analysisError ?? "", /Control\/accounting failure/);
    const progress = (await readFile(join(root, "collection-progress.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    assert.deepEqual(progress.map(row => row.status), ["failed", "not-run"]);
    assert.ok(progress.every(row => typeof row.stop === "string"));
  } finally { await rm(root, { recursive: true, force: true }); }
});
