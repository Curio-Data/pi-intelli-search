// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { persistRunRecord } from "../scripts/research-handoff/runner.js";
import { unavailableRecord } from "../scripts/research-handoff/storage.js";

test("handoff help separates safe inspection from gated operations and names analysis phases", () => {
  const cli = fileURLToPath(new URL("../scripts/research-handoff/cli.ts", import.meta.url));
  const result = spawnSync(process.execPath, ["--import", "tsx", cli, "--help"], { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Credential-free operations:/);
  assert.match(result.stdout, /synthetic\|diagnostic\|measured/);
  assert.match(result.stdout, /defaults to measured/);
  assert.match(result.stdout, /Recorded live\/financial acceptance required:/);
  assert.match(result.stdout, /REPRODUCTION\.md/);
});

test("handoff strict analysis failure preserves the full observation and financial receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "handoff-retention-"));
  try {
    const record = unavailableRecord("new-corrupt-trace", "synthetic", "synthetic fixture");
    delete record.analysisError;
    record.finalAnswer = "The full final answer must survive analysis rejection.";
    record.requests = [1, 2].map(logicalIndex => ({
      id: "duplicate-request-id", logicalIndex, context: { retained: `context-${logicalIndex}` }, attempts: [],
      afterToolCall: logicalIndex === 2, finalAnswerProducing: logicalIndex === 2,
    }));
    const budget = { limitNanoUsd: 100, knownNanoUsd: 5, unknownNanoUsd: 10, activeNanoUsd: 0, remainingNanoUsd: 85, stopped: false };
    assert.doesNotThrow(() => persistRunRecord(root, record, budget));
    const retained = JSON.parse(await readFile(join(root, "record.json"), "utf8"));
    assert.equal(retained.manifest.status, "failed");
    assert.match(retained.analysisError, /Duplicate/);
    assert.equal(retained.requests.length, 2);
    assert.equal(retained.requests[1].context.retained, "context-2");
    assert.equal(retained.finalAnswer, record.finalAnswer);
    assert.deepEqual(JSON.parse(await readFile(join(root, "budget.json"), "utf8")), budget);
  } finally { await rm(root, { recursive: true, force: true }); }
});
