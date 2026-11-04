// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AttemptBudget, parseProgrammeLedger, appendProgrammeReservation, appendProgrammeSettlement } from "../scripts/research-handoff/budget.js";
import type { JournalEvent } from "../scripts/research-handoff/contracts.js";

function genesis() {
  return JSON.stringify({ schemaVersion: 1, kind: "genesis", seq: 0, prevSha256: null,
    ceilingNanoUsd: 30_000_000_000, baselineKnownNanoUsd: 1_000_000_000,
    baselineUnknownHoldNanoUsd: 2_000_000_000 }) + "\n";
}
function append(raw: string, fields: Record<string, unknown>) {
  const rows = raw.trimEnd().split("\n");
  return raw + JSON.stringify({ schemaVersion: 1, seq: rows.length,
    prevSha256: createHash("sha256").update(rows.at(-1)!).digest("hex"), ...fields }) + "\n";
}

test("handoff financial chain retains opening holds, reservations and settlement", () => {
  const a = append(genesis(), { kind: "reserve", runId: "fresh", reserveNanoUsd: 3_000_000_000 });
  assert.equal(parseProgrammeLedger(a).availableNanoUsd, 24_000_000_000);
  const b = append(a, { kind: "settle", runId: "fresh", reportedNanoUsd: 100_000_000,
    unknownNanoUsd: 500_000_000, releasedNanoUsd: 2_400_000_000, overrunNanoUsd: 0 });
  const balance = parseProgrammeLedger(b);
  assert.equal(balance.knownNanoUsd, 1_100_000_000);
  assert.equal(balance.unknownNanoUsd, 2_500_000_000);
  assert.deepEqual(balance.active, {});
  assert.equal(balance.availableNanoUsd, 26_400_000_000);
  assert.throws(() => parseProgrammeLedger(b.slice(0, -1)), /Incomplete/);
  assert.throws(() => parseProgrammeLedger(b.replace('"seq":1', '"seq":8')), /chain/);
  assert.throws(() => parseProgrammeLedger(append(b, { kind: "reserve", runId: "fresh", reserveNanoUsd: 1 })), /Reused/);
  assert.throws(() => parseProgrammeLedger(append(genesis(), { kind: "reserve", runId: "excess", reserveNanoUsd: 28_000_000_000 })), /ceiling/);
  assert.throws(() => parseProgrammeLedger(append(a, { kind: "settle", runId: "fresh", reportedNanoUsd: 1,
    unknownNanoUsd: 0, releasedNanoUsd: 0, overrunNanoUsd: 0 })), /mismatch/);
});

test("handoff reservation writer requires coordination, fresh hash and exclusive admission", async () => {
  const root = await mkdtemp(join(tmpdir(), "handoff-ledger-"));
  try {
    const path = join(root, "new-ledger.jsonl"), lockPath = join(root, "writer.lock");
    const raw = genesis(); await writeFile(path, raw);
    const opts = { path, lockPath, expectedSha256: parseProgrammeLedger(raw).sha256,
      runId: "new-reservation", reserveNanoUsd: 4_000_000_000, writerCoordinationConfirmed: false };
    await assert.rejects(appendProgrammeReservation(opts), /coordination/);
    assert.equal(await readFile(path, "utf8"), raw);
    const results = await Promise.allSettled([
      appendProgrammeReservation({ ...opts, writerCoordinationConfirmed: true }),
      appendProgrammeReservation({ ...opts, runId: "racer", writerCoordinationConfirmed: true }),
    ]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    const balance = parseProgrammeLedger(await readFile(path, "utf8"));
    assert.equal(balance.nextSeq, 2);
    await assert.rejects(appendProgrammeReservation({ ...opts, writerCoordinationConfirmed: true }), /changed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("handoff programme settlement preserves holds and refuses a second settlement", async () => {
  const root = await mkdtemp(join(tmpdir(), "handoff-settlement-"));
  try {
    const path = join(root, "ledger.jsonl"), lockPath = join(root, "writer.lock");
    const raw = genesis(); await writeFile(path, raw);
    const reserved = await appendProgrammeReservation({ path, lockPath, expectedSha256: parseProgrammeLedger(raw).sha256,
      runId: "fresh-batch", reserveNanoUsd: 5_000_000_000, writerCoordinationConfirmed: true });
    const options = { path, lockPath, expectedSha256: reserved.sha256, runId: "fresh-batch",
      reportedNanoUsd: 250_000_000, unknownNanoUsd: 500_000_000, note: "new synthetic fixture", writerCoordinationConfirmed: true };
    const settled = await appendProgrammeSettlement(options);
    assert.equal(settled.knownNanoUsd, 1_250_000_000);
    assert.equal(settled.unknownNanoUsd, 2_500_000_000);
    assert.equal(settled.availableNanoUsd, 26_250_000_000);
    assert.deepEqual(settled.active, {});
    await assert.rejects(appendProgrammeSettlement({ ...options, expectedSha256: settled.sha256 }), /not active/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("handoff concurrent attempts retain unknown charges and never reclaim active exposure", () => {
  const events: JournalEvent[] = [];
  const budget = new AttemptBudget(1_200_000_000, { record: e => events.push(e) });
  for (const id of ["a", "b", "c"]) budget.reserve(id, 324_172_800);
  assert.equal(budget.snapshot().remainingNanoUsd, 227_481_600);
  budget.settle("a", 0.01); budget.settle("b");
  assert.equal(budget.snapshot().knownNanoUsd, 10_000_000);
  assert.equal(budget.snapshot().unknownNanoUsd, 324_172_800);
  assert.equal(budget.snapshot().activeNanoUsd, 324_172_800);
  budget.reserve("d", 319_372_800);
  assert.throws(() => budget.reserve("d", 1), /admission/);
  budget.settle("c", 0); budget.settle("d", 0.02);
  assert.equal(budget.snapshot().activeNanoUsd, 0);
  assert.equal(budget.snapshot().remainingNanoUsd, 845_827_200);
  assert.throws(() => budget.settle("a", 0), /active/);
  assert.equal(events.filter(e => e.kind === "budget-unknown").length, 1);
});

test("handoff budget refusal latches even after concurrent work settles", () => {
  const events: JournalEvent[] = [];
  const budget = new AttemptBudget(1_200_000_000, { record: event => { events.push(event); } });
  for (const id of ["a", "b", "c"]) budget.reserve(id, 324_172_800);
  budget.settle("a");
  assert.throws(() => budget.reserve("a-retry", 324_172_800), /admission/);
  budget.settle("b", 0.001); budget.settle("c", 0.001);
  assert.ok(budget.snapshot().remainingNanoUsd > 800_000_000);
  assert.equal(budget.snapshot().stopped, true);
  assert.throws(() => budget.reserve("collation", 319_372_800), /admission/);
  assert.equal(events.filter(e => e.kind === "budget-reserved").length, 3);
});

test("handoff overrun records the liability and blocks further admission", () => {
  const budget = new AttemptBudget(100, { record() {} });
  budget.reserve("a", 50);
  assert.throws(() => budget.settle("a", 0.00000007), /exceeded/);
  assert.equal(budget.snapshot().knownNanoUsd, 70);
  assert.equal(budget.snapshot().stopped, true);
  assert.throws(() => budget.reserve("b", 1), /admission/);
});

test("handoff failed journal append prevents dispatch admission", () => {
  const budget = new AttemptBudget(100, { record() { throw new Error("disk unavailable"); } });
  assert.throws(() => budget.reserve("a", 50), /disk/);
  assert.equal(budget.snapshot().activeNanoUsd, 0);
});
