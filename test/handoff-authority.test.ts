// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyPreparationAuthority, reserveAcceptedProgramme, prepareCapture, qualifyDownstreamCost, settleAcceptedSeries } from "../scripts/research-handoff/collection.js";
import { assertLiveEvidenceRoot, validateLiveAcceptance, type WorkerConfig } from "../scripts/research-handoff/runner.js";
import { unavailableRecord, writeNewJson } from "../scripts/research-handoff/storage.js";

test("handoff unresolved financial authority blocks every metered entry before network or credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "handoff-authority-"));
  const savedFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; throw new Error("unexpected network"); };
  try {
    const path = join(root, "unaccepted.json");
    writeNewJson(path, { schemaVersion: 1, phase: "preparation", acceptedBy: "coordinator", writerCoordinationConfirmed: false });
    await assert.rejects(verifyPreparationAuthority(path), /unresolved/);
    await assert.rejects(reserveAcceptedProgramme(path), /unresolved/);
    await assert.rejects(prepareCapture(path, "nonexistent-credential-reference"), /unresolved/);
    await assert.rejects(qualifyDownstreamCost(path, "nonexistent-credential-reference", "nonexistent-review"), /unresolved/);
    await assert.rejects(settleAcceptedSeries(path), /unresolved/);
    assert.equal(networkCalls, 0);
  } finally { globalThis.fetch = savedFetch; await rm(root, { recursive: true, force: true }); }
});

test("handoff scratch clones cannot become live evidence roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "handoff-clone-"));
  try { await assert.rejects(assertLiveEvidenceRoot(root)); }
  finally { await rm(root, { recursive: true, force: true }); }
});

test("handoff a raw worker needs explicit live acceptance and credential reference", async () => {
  const manifest = unavailableRecord("unaccepted", "measured", "new fixture").manifest;
  const config = { schemaVersion: 1, manifest, directory: "unused", workspace: "unused", agentDir: "unused", frozenPath: "unused" } as WorkerConfig;
  await assert.rejects(validateLiveAcceptance(config), /requires a recorded acceptance/);
});
