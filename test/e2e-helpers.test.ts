// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
import assert from "node:assert/strict";
import { it } from "node:test";
import { chmod, mkdtemp, mkdir, writeFile, rm, readFile, symlink, utimes } from "node:fs/promises";
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

it("E2E loop selection copies API-key logins only, never a rotating OAuth login", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "e2e-loop-auth-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const secrets = /fixture-access-7c1f|fixture-refresh-7c1f|fixture-untyped-7c1f/;
  const setup = async (auth: unknown, env: Record<string, string> = {}) => {
    const operator = join(dir, `auth-${Math.random().toString(36).slice(2)}.json`);
    await writeFile(operator, JSON.stringify(auth));
    return spawnSync("bash", ["-c",
      'set -euo pipefail; source "$1"; OPENROUTER_API_KEY=or-fixture; e2e_setup_loop_model >/dev/null; printf "%s\\n%s" "$PI_INTELLI_E2E_LOOP_MODEL" "$E2E_AUTH_JSON"',
      "fixture", resolve("test/e2e/lib.sh")],
      { encoding: "utf8", env: { ...process.env, E2E_LOOP_MODEL_ID: "", TEST_MODEL: "", E2E_OPERATOR_AUTH_JSON: operator, ...env } });
  };
  const parsed = (run: ReturnType<typeof spawnSync>) => {
    const out = String(run.stdout);
    const split = out.indexOf("\n");
    return { label: out.slice(0, split), auth: JSON.parse(out.slice(split + 1)) };
  };
  const oauth = { type: "oauth", access: "fixture-access-7c1f", refresh: "fixture-refresh-7c1f", expires: 1 };
  const qwen = { type: "api_key", key: "qwen-fixture" };

  // An explicitly chosen loop provider is refused unless its type is exactly api_key.
  for (const entry of [oauth, { key: "fixture-untyped-7c1f" }, { type: null, key: "fixture-untyped-7c1f" }, "fixture-untyped-7c1f"]) {
    for (const env of [{ E2E_LOOP_MODEL_ID: "kimi-coding/k3" }, { TEST_MODEL: "kimi-coding/k3" }] as Record<string, string>[]) {
      const run = await setup({ "kimi-coding": entry }, env);
      assert.notEqual(run.status, 0, JSON.stringify({ entry, env }));
      assert.match(String(run.stderr), /not an API-key login/);
      assert.equal(run.stdout, "", "no credential assembled for a refused loop login");
      assert.doesNotMatch(String(run.stderr), secrets, "a refusal never prints the credential");
    }
  }

  // The default prefers the qwen-token-plan API key and exports the selection for traces.
  const byDefault = await setup({ "kimi-coding": oauth, "qwen-token-plan": qwen });
  assert.equal(byDefault.status, 0, String(byDefault.stderr));
  assert.deepEqual(parsed(byDefault), {
    label: "qwen-token-plan/qwen3.8-max",
    auth: { openrouter: { type: "api_key", key: "or-fixture" }, "qwen-token-plan": qwen },
  });

  // A qwen-token-plan login that is not an API key falls back to OpenRouter alone.
  for (const entry of [oauth, { key: "fixture-untyped-7c1f" }]) {
    const fallback = await setup({ "qwen-token-plan": entry });
    assert.equal(fallback.status, 0, String(fallback.stderr));
    assert.deepEqual(parsed(fallback), {
      label: "openrouter/google/gemini-3.8-flash",
      auth: { openrouter: { type: "api_key", key: "or-fixture" } },
    });
  }
});

it("E2E private-file check judges a symlinked .env by its target's mode", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "e2e-private-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const check = (path: string) => spawnSync("bash", ["-c", 'set -euo pipefail; source "$1"; e2e_require_private "$2"', "fixture", resolve("test/e2e/env.sh"), path], { encoding: "utf8" });
  for (const [mode, ok] of [[0o600, true], [0o640, false], [0o604, false]] as const) {
    const target = join(dir, `target-${mode.toString(8)}`);
    const link = join(dir, `link-${mode.toString(8)}`);
    await writeFile(target, "KEY=value\n");
    await chmod(target, mode);
    await symlink(target, link);
    const run = check(link);
    assert.equal(run.status === 0, ok, `${mode.toString(8)} target: ${run.stderr}`);
    if (!ok) assert.match(run.stderr, new RegExp(`mode ${mode.toString(8)}`), "the message reports the target's mode");
  }
  assert.equal(check(join(dir, "missing")).status, 0, "an absent file is not an error");
});

it("evidence analyser reads per-recipe trace subdirectories", async (t) => {
  const run = await mkdtemp(join(tmpdir(), "e2e-analyse-"));
  t.after(() => rm(run, { recursive: true, force: true }));
  const scenario = join(run, "10_config_recipes");
  await mkdir(join(scenario, "pi-traces", "r1"), { recursive: true });
  await mkdir(join(scenario, "pi-traces", "r5"), { recursive: true });
  await writeFile(join(scenario, "extension.jsonl"), "");
  const events = (n: number) =>
    [
      { type: "tool_execution_start", toolName: "intelli_research", args: { query: `q${n}` } },
      { type: "tool_execution_update", partialResult: { content: [{ type: "text", text: "Stage 3: retrying after rate limit" }] } },
      { type: "tool_execution_end", toolName: "intelli_research", isError: false, durationMs: 10 },
    ].map((event) => JSON.stringify(event)).join("\n") + "\n";
  await writeFile(join(scenario, "pi-traces", "r1", "attempt-1.jsonl"), events(1));
  await writeFile(join(scenario, "pi-traces", "r5", "attempt-1.jsonl"), events(5));
  await writeFile(join(scenario, "pi-traces", "top.jsonl"), events(0));

  const result = spawnSync(process.execPath, [resolve("test/e2e/analyze-evidence.mjs"), run], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const analysis = JSON.parse(await readFile(join(run, "analysis.json"), "utf8"));
  const [summary] = analysis.scenarios;
  assert.equal(summary.traceFileCount, 3);
  assert.deepEqual(summary.researchCalls.map((call: { args: { query: string } }) => call.args.query).sort(), ["q0", "q1", "q5"]);
  assert.equal(summary.toolEnds.length, 3);
  assert.equal(summary.retryNotices.length, 3);
});
