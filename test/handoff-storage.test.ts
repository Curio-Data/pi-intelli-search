// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonicalJson, writeNewJson, loadInventory, unavailableRecord } from "../scripts/research-handoff/storage.js";
import { canonicalJson as inputCanonicalJson } from "../scripts/research-handoff/common-inputs.js";

test("handoff storage uses one canonicaliser, including integer-like keys", () => {
  const value = { "2": { "10": 1, "2": 2 }, "10": 3, b: undefined };
  assert.equal(canonicalJson(value), inputCanonicalJson(value));
  assert.equal(canonicalJson, inputCanonicalJson);
});

test("handoff atomic JSON publication never replaces an existing record", async () => {
  const root = await mkdtemp(join(tmpdir(), "handoff-storage-"));
  try {
    const path = join(root, "record.json");
    writeNewJson(path, { original: true });
    await assert.rejects(async () => writeNewJson(path, { original: false }), /EEXIST/);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { original: true });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("handoff inventory retains missing, corrupt, duplicate and escaped rows", async () => {
  const root = await mkdtemp(join(tmpdir(), "handoff-inventory-"));
  try {
    const series = join(root, "series"); await mkdir(series);
    writeNewJson(join(series, "known.json"), unavailableRecord("known", "synthetic", "synthetic incomplete record"));
    await writeFile(join(series, "corrupt.json"), '{"unfinished":');
    await writeFile(join(root, "outside.json"), "DO_NOT_READ_OUTSIDE_SENTINEL");
    await symlink(join(root, "outside.json"), join(series, "escape.json"));
    writeNewJson(join(series, "inventory.json"), ["known.json", "missing.json", "corrupt.json", "known.json", "escape.json"]);
    const records = await loadInventory(join(series, "inventory.json"), "synthetic");
    assert.equal(records.length, 5);
    assert.equal(records[0].manifest.runId, "known");
    assert.ok(records.slice(1).every(row => row.analysisError && !row.observerCoverage.verified));
    assert.ok(records[4].analysisError?.includes("escapes"));
    assert.ok(!JSON.stringify(records).includes("DO_NOT_READ_OUTSIDE_SENTINEL"));
  } finally { await rm(root, { recursive: true, force: true }); }
});
