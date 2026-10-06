// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

it("the live page-budget assertion rejects missing, degraded and wrong-budget evidence", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "e2e-assertions-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cache = join(root, "cache");
  const entry = join(cache, "entry");
  await mkdir(join(entry, "extractions"), { recursive: true });
  await mkdir(join(entry, "sources"));
  await writeFile(join(cache, ".index.json"), JSON.stringify({ searches: [{ slug: "entry" }] }));
  await writeFile(join(entry, "report.md"), "summary");
  await writeFile(join(entry, "extractions/01.md"), "extraction");
  const trace = join(root, "trace.jsonl");
  const metadata = { outcome: "completed", stages: { fetch: { requested: 3, succeeded: 2 }, extract: { succeeded: 2 }, collate: { summaryChars: 200 } } };
  const save = () => writeFile(join(entry, "meta.json"), JSON.stringify(metadata));
  await save();
  await writeFile(trace, JSON.stringify({ type: "tool_execution_start", toolName: "intelli_research", args: { query: "fixture" } }));
  const check = (scenario = "default") => spawnSync("bash", ["-c", 'set -euo pipefail; source "$1"; e2e_verify_page_budget "$2" "$3" "$4"', "fixture", resolve("test/e2e/lib.sh"), cache, trace, scenario], { encoding: "utf8" });
  assert.equal(check().status, 0);
  assert.notEqual(check("cap").status, 0);
  metadata.stages.fetch.requested = 4;
  await save();
  assert.notEqual(check().status, 0);
  metadata.stages.fetch.requested = 3;
  metadata.outcome = "extraction-failed";
  await save();
  assert.notEqual(check().status, 0);
  metadata.outcome = "completed";
  await save();
  await rm(join(entry, "extractions"), { recursive: true });
  assert.notEqual(check().status, 0);
});

it("E2E auth assembly sends credentials over stdin, not jq arguments", () => {
  const run = spawnSync("bash", ["-c", 'set -euo pipefail; source "$1"; E2E_LOOP_MODEL_ID=openrouter/fixture; OPENROUTER_API_KEY=fixture-secret; e2e_setup_loop_model >/dev/null; printf "%s" "$E2E_AUTH_JSON"', "fixture", resolve("test/e2e/lib.sh")], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), { openrouter: { type: "api_key", key: "fixture-secret" } });
});
