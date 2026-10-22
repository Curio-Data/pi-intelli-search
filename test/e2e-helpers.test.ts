// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtemp, mkdir, writeFile, rm, readFile, utimes, chmod, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRunStore } from "../src/core/run-store.js";
import { artifactsFor, storeOptions } from "./helpers/run-store-fixtures.js";

async function committedFixture(cache: string, query = "fixture") {
  const store = createRunStore(storeOptions(cache));
  const signal = new AbortController().signal;
  const allocation = await store.allocate({
    operationId: "fixture",
    query,
    startedUtc: new Date().toISOString(),
    signal,
  });
  assert.equal(allocation.status, "allocated");
  if (allocation.status !== "allocated") throw new Error("allocation failed");
  const committed = await store.commit(allocation.reservation, artifactsFor(query), signal);
  assert.equal(committed.status, "committed");
  if (committed.status !== "committed") throw new Error("commit failed");
  assert.equal(await store.updateIndex(committed.run, query, signal), "updated");
  await store.settle();
  const entry = allocation.reservation.physicalPath;
  const metadata = {
    schemaVersion: 1,
    outcome: "completed",
    stages: {
      fetch: { requested: 3, succeeded: 2 },
      extract: { succeeded: 2 },
      collate: { summaryChars: 200 },
    },
  };
  const save = () => writeFile(join(entry, "meta.json"), JSON.stringify(metadata));
  await save();
  return { entry, metadata, save };
}

const verdictScript = resolve("test/e2e/cache-verdict.mjs");
const verdict = (cache: string, ref?: string) =>
  spawnSync(process.execPath, [verdictScript, cache, ...(ref ? [ref] : [])], { encoding: "utf8" });

it("the live page-budget assertion rejects missing, degraded and wrong-budget evidence", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "e2e-assertions-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cache = join(root, "cache");
  const { entry, metadata, save } = await committedFixture(cache);
  const trace = join(root, "trace.jsonl");
  await writeFile(
    trace,
    JSON.stringify({
      type: "tool_execution_start",
      toolName: "intelli_research",
      args: { query: "fixture" },
    }),
  );
  const check = (scenario = "default") =>
    spawnSync(
      "bash",
      [
        "-c",
        'set -euo pipefail; source "$1"; e2e_verify_page_budget "$2" "$3" "$4"',
        "fixture",
        resolve("test/e2e/lib.sh"),
        cache,
        trace,
        scenario,
      ],
      { encoding: "utf8" },
    );
  const initial = check();
  assert.equal(initial.status, 0, `${initial.stdout}\n${initial.stderr}`);
  assert.notEqual(check("cap").status, 0);
  // The event contains raw provider arguments: the host strips optional nulls
  // before execution. Null must exercise defaults, not bypass an explicit cap.
  const event = {
    type: "tool_execution_start",
    toolName: "intelli_research",
    args: { query: "fixture", maxUrls: null as number | string | boolean | null },
  };
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

it("new-layout discovery requires fresh useful telemetry and a journal-verified commit, not mtime or index alone", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "e2e-commit-verdict-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cache = join(root, ".search");
  const ref = join(root, "reference");
  await writeFile(ref, "");
  await utimes(ref, 1, 1);
  const first = await committedFixture(cache, "first");
  const second = await committedFixture(cache, "second");
  const check = () => verdict(cache, ref);
  const selected = () => {
    const result = check();
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  assert.equal(selected().runPath, second.entry);
  assert.equal(selected().indexVerified, true);
  // Root mtime and uncommitted, newer sidecars never select a run.
  await utimes(first.entry, 4_000_000_000, 4_000_000_000);
  await mkdir(join(cache, ".staging", "newer"), { recursive: true });
  await writeFile(join(cache, ".staging", "newer", "meta.json"), JSON.stringify(second.metadata));
  const marker = join(second.entry, "committed.json");
  const markerBytes = await readFile(marker);
  await rm(marker);
  assert.equal(selected().runPath, first.entry);
  await writeFile(marker, markerBytes);
  const report = join(second.entry, "report.md");
  const reportBytes = await readFile(report);
  await writeFile(report, "tampered");
  assert.equal(selected().runPath, first.entry);
  await writeFile(report, reportBytes);
  second.metadata.outcome = "extraction-failed";
  await second.save();
  assert.equal(selected().runPath, first.entry);
  second.metadata.outcome = "completed";
  second.metadata.stages.fetch.succeeded = 0;
  await second.save();
  assert.equal(selected().runPath, first.entry);
  second.metadata.stages.fetch.succeeded = 2;
  await second.save();
  // Old sidecars and old commits cannot be made fresh by touching a directory.
  await utimes(join(second.entry, "meta.json"), 0, 0);
  assert.equal(selected().runPath, first.entry);
  await second.save();
  await utimes(marker, 0, 0);
  assert.equal(selected().runPath, first.entry);
  await writeFile(marker, markerBytes);
  // A damaged index is an artefact failure, not permission to repeat paid work.
  const indexPath = join(cache, ".intelli-v1", "index.json");
  const indexBytes = await readFile(indexPath);
  const index = JSON.parse(indexBytes.toString());
  index.entries[1].manifestSha256 = "0".repeat(64);
  await writeFile(indexPath, JSON.stringify(index));
  assert.equal(selected().runPath, second.entry);
  assert.equal(selected().indexVerified, false);
  await rm(indexPath);
  assert.equal(selected().indexVerified, false);
  await writeFile(indexPath, indexBytes);
  assert.equal(selected().indexVerified, true);
  // Linked metadata is not a fresh regular sidecar.
  const meta = join(second.entry, "meta.json");
  await rm(meta);
  await symlink(join(first.entry, "meta.json"), meta);
  assert.equal(selected().runPath, first.entry);
  const journal = join(cache, ".intelli-v1", "allocations.ndjson");
  await writeFile(journal, "corrupt\n");
  assert.notEqual(check().status, 0, "a marker cannot override damaged allocation history");
});

it("the live retry loop accepts a verified fresh commit despite print exit 1 without repeating research", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "e2e-retry-verdict-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cache = join(root, ".search");
  const { entry } = await committedFixture(cache);
  const bin = join(root, "bin");
  await mkdir(bin);
  const fakePi = join(bin, "pi");
  await writeFile(
    fakePi,
    `#!${process.execPath}\nimport fs from 'node:fs';\nfs.appendFileSync(process.env.FIXTURE_CALLS, 'call\\n');\nfor (const name of ['meta.json', 'committed.json']) fs.utimesSync(process.env.FIXTURE_ENTRY + '/' + name, new Date(), new Date());\nconsole.log('Response was truncated');\nprocess.exitCode = 1;\n`,
  );
  await chmod(fakePi, 0o700);
  const calls = join(root, "calls");
  const run = spawnSync(
    "bash",
    [
      "-c",
      'set -euo pipefail; source "$1"; E2E_EXTENSION_PATH=fixture; e2e_run_pi "$2" "$2" fixture 10; printf "%s" "$E2E_LAST_RUN_JSON"',
      "fixture",
      resolve("test/e2e/lib.sh"),
      root,
    ],
    {
      encoding: "utf8",
      timeout: 15_000,
      env: {
        ...process.env,
        TMPDIR: root,
        PATH: `${bin}:${process.env.PATH}`,
        FIXTURE_CALLS: calls,
        FIXTURE_ENTRY: entry,
        E2E_TRACE_FILE: join(root, "trace.jsonl"),
      },
    },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.equal(await readFile(calls, "utf8"), "call\n");
  assert.equal(JSON.parse(run.stdout).runPath, entry);
  assert.equal(
    await readFile(join(root, "trace.jsonl.attempt-1"), "utf8"),
    "Response was truncated\n",
  );
  assert.match(run.stderr, /exited 1.*accepted/);
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
  // Remaining legacy scenario selectors are explicitly pending M4 migration.
  for (const script of ["04_migration.sh", "15_pi_floor.sh"]) {
    const source = await readFile(resolve("test/e2e", script), "utf8");
    const selection = source.match(/^LATEST_CACHE=.*$/m)?.[0];
    assert.ok(selection, `missing cache selector in ${script}`);
    const run = spawnSync(
      "bash",
      [
        "-c",
        `set -euo pipefail; CACHE_DIR="$1"; ${selection}; printf '%s' "$LATEST_CACHE"`,
        "fixture",
        cache,
      ],
      { encoding: "utf8" },
    );
    assert.equal(run.status, 0, `${script}: ${run.stderr}`);
    assert.equal(run.stdout, latest, script);
  }
});

it("E2E auth assembly sends credentials over stdin, not jq arguments", () => {
  const run = spawnSync(
    "bash",
    [
      "-c",
      'set -euo pipefail; source "$1"; E2E_LOOP_MODEL_ID=openrouter/fixture; OPENROUTER_API_KEY=fixture-secret; e2e_setup_loop_model >/dev/null; printf "%s" "$E2E_AUTH_JSON"',
      "fixture",
      resolve("test/e2e/lib.sh"),
    ],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), {
    openrouter: { type: "api_key", key: "fixture-secret" },
  });
});
