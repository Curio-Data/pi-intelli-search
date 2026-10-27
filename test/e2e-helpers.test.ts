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
  // The event contains raw provider arguments: the host strips optional nulls
  // before execution. Null must exercise defaults, not bypass an explicit cap.
  const event = { type: "tool_execution_start", toolName: "intelli_research", args: { query: "fixture", maxUrls: null as number | string | boolean | null } };
  for (const [value, defaultPasses, capPasses] of [
    [null, true, false],
    [3, false, false],
    [12, false, true],
    [0, false, false],
    ["3", false, false],
    [false, false, false],
  ] as const) {
    event.args.maxUrls = value;
    await writeFile(trace, JSON.stringify(event));
    assert.equal(check().status === 0, defaultPasses, `default: maxUrls=${JSON.stringify(value)}`);
    assert.equal(check("cap").status === 0, capPasses, `cap: maxUrls=${JSON.stringify(value)}`);
  }
  event.args.maxUrls = null;
  await writeFile(trace, `${JSON.stringify(event)}\n${JSON.stringify(event)}`);
  assert.notEqual(check().status, 0, "multiple research calls must not pass");
  await writeFile(trace, JSON.stringify({ type: "agent_end" }));
  assert.notEqual(check().status, 0, "missing research call must not pass");
  await writeFile(trace, JSON.stringify(event));
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

it("completed live cache selectors ignore numbered archive remnants", async (t) => {
  const cache = await mkdtemp(join(tmpdir(), "e2e-completed-selection-"));
  t.after(() => rm(cache, { recursive: true, force: true }));
  const canonical = join(cache, "entry-z");
  const archive = join(cache, "entry-z.1");
  await mkdir(canonical);
  await mkdir(archive);
  await writeFile(join(cache, ".index.json"), JSON.stringify({ searches: [{ slug: "entry-z" }] }));
  await writeFile(join(canonical, "report.md"), "completed report");
  await writeFile(join(canonical, "meta.json"), JSON.stringify({ outcome: "completed", stages: { fetch: { succeeded: 1 }, collate: { summaryChars: 100 } } }));
  await writeFile(join(archive, "meta.json"), JSON.stringify({ outcome: "extraction-failed" }));
  const legacy = spawnSync("bash", ["-c", 'find "$1" -maxdepth 1 -mindepth 1 -type d -not -name ".*" | sort -r | head -1', "fixture", cache], { encoding: "utf8" });
  assert.equal(legacy.stdout.trim(), archive, "fixture must reproduce the archive-first ordering");
  const selected = spawnSync("bash", ["-c", 'set -euo pipefail; source "$1"; e2e_completed_cache_entry "$2"', "fixture", resolve("test/e2e/lib.sh"), cache], { encoding: "utf8" });
  assert.equal(selected.status, 0, selected.stderr);
  assert.equal(selected.stdout.trim(), canonical);
});

it("E2E auth assembly sends credentials over stdin, not jq arguments", () => {
  const run = spawnSync("bash", ["-c", 'set -euo pipefail; source "$1"; E2E_LOOP_MODEL_ID=openrouter/fixture; OPENROUTER_API_KEY=fixture-secret; e2e_setup_loop_model >/dev/null; printf "%s" "$E2E_AUTH_JSON"', "fixture", resolve("test/e2e/lib.sh")], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), { openrouter: { type: "api_key", key: "fixture-secret" } });
});
