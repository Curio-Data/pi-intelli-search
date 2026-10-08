// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtemp, mkdir, writeFile, rm, readFile, utimes } from "node:fs/promises";
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

it("mtime-based live cache selectors ignore newer internal staging directories", async (t) => {
  const cache = await mkdtemp(join(tmpdir(), "e2e-cache-selection-"));
  t.after(() => rm(cache, { recursive: true, force: true }));
  const older = join(cache, "entry-z");
  const latest = join(cache, "entry-a");
  const staging = join(cache, ".staging");
  const pending = join(cache, ".staging.123.pending");
  for (const [index, dir] of [older, latest, staging, pending].entries()) {
    await mkdir(dir);
    await utimes(dir, 1000 + index, 1000 + index);
  }
  for (const script of ["01_main.sh", "04_migration.sh", "15_pi_floor.sh"]) {
    const source = await readFile(resolve("test/e2e", script), "utf8");
    const selection = source.match(/^LATEST_CACHE=.*$/m)?.[0];
    assert.ok(selection, `missing cache selector in ${script}`);
    const run = spawnSync("bash", ["-c", `set -euo pipefail; CACHE_DIR="$1"; ${selection}; printf '%s' "$LATEST_CACHE"`, "fixture", cache], { encoding: "utf8" });
    assert.equal(run.status, 0, `${script}: ${run.stderr}`);
    assert.equal(run.stdout, latest, script);
  }
});

it("E2E auth assembly sends credentials over stdin, not jq arguments", () => {
  const run = spawnSync("bash", ["-c", 'set -euo pipefail; source "$1"; E2E_LOOP_MODEL_ID=openrouter/fixture; OPENROUTER_API_KEY=fixture-secret; e2e_setup_loop_model >/dev/null; printf "%s" "$E2E_AUTH_JSON"', "fixture", resolve("test/e2e/lib.sh")], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), { openrouter: { type: "api_key", key: "fixture-secret" } });
});
