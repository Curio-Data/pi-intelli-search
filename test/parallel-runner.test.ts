// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
import assert from "node:assert/strict";
import { it } from "node:test";
import { chmod, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { createManifest, validateManifest } from "./e2e/parallel-manifest.mjs";
import { allocateRun, allocateUnit, completeResults, processTable, runManifest, supervise } from "./e2e/parallel-supervisor.mjs";
import { hashFile, inventoryTree, prepareArtifacts, sealArtifacts, verifyArtifacts, verifyEntrypoints } from "./e2e/parallel-artifacts.mjs";
import { captureProvenance, formatUnitResult, isolatedEnvironment, PARALLEL_EVIDENCE_POLICY, preflightCredentials, summarizeResults, workerEnvironment } from "./e2e/parallel-runner.mjs";
import { analyzeRun, readUnitEvidence } from "./e2e/analyze-evidence.mjs";

// Deliberately retain fixtures. The operator owns scratch cleanup policy.
async function scratch() {
  assert.notEqual(tmpdir(), "/tmp", "Set TMPDIR to encrypted repository scratch before this test");
  return mkdtemp(join(tmpdir(), "parallel-runner-"));
}

async function runNode(args: string[], env = process.env) {
  const child = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const code = await new Promise((done, reject) => { child.on("error", reject); child.on("close", done); });
  return { code, stdout, stderr };
}

it("budgets every provider's three attempts, kill grace, retry gaps and setup", () => {
  const manifest = createManifest();
  for (const unit of manifest.units.filter((unit) => unit.kind === "provider")) {
    const attempt = /^(01|11|15)_/.test(unit.id) ? 600 : /^(03|08)_/.test(unit.id) ? 300 : 360;
    assert.equal(unit.budget.attemptSeconds, attempt);
    assert.equal(unit.timeoutMs, (3 * (attempt + 15) + 60 + 180) * 1000);
  }
  assert.throws(() => createManifest({ scriptSeconds: 1200 }), /01_main.*2085/);
  assert.ok(createManifest({ scriptSeconds: 2400 }).units.every((unit) => unit.timeoutMs === 2_400_000));
  const changed = createManifest({ attemptSeconds: 700, retrySeconds: 7, killSeconds: 20 });
  assert.equal(changed.units[0].timeoutMs, (3 * 720 + 14 + 180) * 1000);
  assert.throws(() => createManifest({ attemptSeconds: "NaN" }), /E2E_TIMEOUT_SECONDS/);
});

it("rejects a lower script timeout before preparation or credential access", async () => {
  const root = await scratch();
  const result = await runNode(["test/e2e/parallel-runner.mjs", "--prepare-only"], {
    PATH: process.env.PATH, E2E_SCRIPT_TIMEOUT_SECONDS: "1200", E2E_RUN_ROOT: join(root, "runs"),
    E2E_OPERATOR_AUTH_JSON: "/must-not-be-read", E2E_NATIVE_TARBALL: "/absent", E2E_NATIVE_SHA256: "0".repeat(64),
    E2E_MCP_TARBALL: "/absent", E2E_MCP_SHA256: "0".repeat(64),
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /minimum budget/);
  await assert.rejects(stat(join(root, "runs")), /ENOENT/);
});

it("preflights synthetic api_key credentials without leaking malformed or OAuth values", async () => {
  const root = await scratch();
  const path = join(root, "synthetic-auth.json");
  const sentinel = "synthetic-secret-never-log";
  await writeFile(path, JSON.stringify({ openrouter: { type: "api_key", key: sentinel } }));
  const result = await preflightCredentials({ E2E_OPERATOR_AUTH_JSON: path });
  assert.equal(result.OPENROUTER_API_KEY, sentinel);
  assert.equal((await preflightCredentials({ OPENROUTER_API_KEY: "explicit", E2E_OPERATOR_AUTH_JSON: "/absent" })).OPENROUTER_API_KEY, "explicit");
  for (const value of [JSON.stringify({ openrouter: { type: "oauth", key: sentinel, refresh: sentinel } }),
    `{broken-json-${sentinel}`, JSON.stringify({ openrouter: { type: "api_key", key: " " } })]) {
    await writeFile(path, value);
    await assert.rejects(preflightCredentials({ E2E_OPERATOR_AUTH_JSON: path }), (error: Error) => {
      assert.ok(!error.message.includes(sentinel));
      return true;
    });
  }
  await assert.rejects(preflightCredentials({}), /requires OPENROUTER_API_KEY/);
});

it("missing credentials fail before any run directory or installer is created", async () => {
  const root = await scratch();
  const result = await runNode(["test/e2e/parallel-runner.mjs"], {
    PATH: process.env.PATH, E2E_RUN_ROOT: join(root, "runs"),
    E2E_NATIVE_TARBALL: "/absent", E2E_NATIVE_SHA256: "0".repeat(64),
    E2E_MCP_TARBALL: "/absent", E2E_MCP_SHA256: "0".repeat(64),
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /requires OPENROUTER_API_KEY/);
  await assert.rejects(stat(join(root, "runs")), /ENOENT/);
});

it("provenance binds staged, unstaged and untracked bytes, not only filenames", async () => {
  const root = await scratch();
  await writeFile(join(root, "new.mjs"), "one");
  let staged = "staged binary patch";
  let unstaged = "unstaged binary patch";
  const runGit = (args: string[]) => {
    if (args[0] === "ls-files") return Buffer.from("new.mjs\0");
    if (args[0] === "rev-parse") return Buffer.from(args.includes("HEAD") && args.length === 2 ? "fixture-head\n" : "fixture-branch\n");
    if (args[0] === "status") return Buffer.from("MM tracked.mjs\n?? new.mjs\n");
    return Buffer.from(args.includes("--cached") ? staged : args.includes("HEAD") ? `${staged}${unstaged}` : unstaged);
  };
  const first = await captureProvenance(root, runGit);
  assert.equal(first.head, "fixture-head");
  assert.match(first.status, /new.mjs/);
  assert.equal(first.diffs.untracked.length, 1);
  assert.equal((await captureProvenance(root, runGit)).completeDiffSha256, first.completeDiffSha256);
  await writeFile(join(root, "new.mjs"), "two");
  const changedFile = await captureProvenance(root, runGit);
  assert.notEqual(changedFile.completeDiffSha256, first.completeDiffSha256);
  staged += "changed";
  const changedStaged = await captureProvenance(root, runGit);
  assert.notEqual(changedStaged.completeDiffSha256, changedFile.completeDiffSha256);
  unstaged += "changed";
  assert.notEqual((await captureProvenance(root, runGit)).completeDiffSha256, changedStaged.completeDiffSha256);
});

it("captures actual checkout identity read-only without retaining raw diffs", async () => {
  const provenance = await captureProvenance(process.cwd());
  assert.match(provenance.head, /^[a-f0-9]{40,64}$/);
  assert.match(provenance.completeDiffSha256, /^[a-f0-9]{64}$/);
  assert.ok(Array.isArray(provenance.diffs.untracked));
  assert.equal(typeof provenance.status, "string");
  assert.ok(!JSON.stringify(provenance).includes("diff --git"));
});

it("analysis reads unit layouts, skips preparation and retains missing expected units", async () => {
  const root = await scratch();
  const dir = join(root, "units", "15_pi_floor");
  await mkdir(join(dir, "traces"), { recursive: true });
  await mkdir(join(root, "units", "_preparation"));
  await writeFile(join(root, "manifest.json"), JSON.stringify({ units: [{ id: "15_pi_floor" }, { id: "absent" }] }));
  await writeFile(join(dir, "result.json"), JSON.stringify({ outcome: "passed", settled: true }));
  await writeFile(join(dir, "extension.jsonl"), `${JSON.stringify({ type: "extension_http_response", status: 429, retryAfter: "7" })}\nmalformed\n`);
  await writeFile(join(dir, "http.jsonl"), `${JSON.stringify({ type: "http_response", status: 402, headers: { "retry-after": "0" }, body: "do-not-copy" })}\n`);
  await writeFile(join(dir, "traces/001-attempt-1.verdict.json"), JSON.stringify({ status: "pass", binding: "workspace-only", entry: "do-not-copy" }));
  await writeFile(join(dir, "traces/001-attempt-1.jsonl"), JSON.stringify({ type: "tool_execution_start", toolName: "intelli_research", args: { query: "fixture" } }));
  const summary = readUnitEvidence(dir);
  assert.equal(summary.binding, "workspace-only");
  assert.equal(summary.providerSignals.non200, 2);
  assert.equal(summary.providerSignals.retryAfter.length, 2);
  assert.equal(summary.providerSignals.health.malformedRecords, 1);
  assert.ok(!JSON.stringify(summary).includes("do-not-copy"));
  const analysis = analyzeRun(root);
  assert.equal(analysis.layout, "units");
  assert.equal(analysis.totals.scenarioCount, 2);
  assert.deepEqual(analysis.totals.missingResults, ["absent"]);
  assert.equal(analysis.scenarios.find((item) => item.scenario === "15_pi_floor").traceFileCount, 1);
  assert.deepEqual(analysis.totals.unitsWith429, ["15_pi_floor"]);
});

it("analysis retains historical one-level pi-traces support", async () => {
  const root = await scratch();
  const dir = join(root, "01_main");
  await mkdir(join(dir, "pi-traces"), { recursive: true });
  await writeFile(join(dir, "extension.jsonl"), "");
  await writeFile(join(dir, "http.jsonl"), "");
  await writeFile(join(dir, "pi-traces/attempt.jsonl"), JSON.stringify({ type: "message_end", message: { role: "assistant", model: "fixture" } }));
  const analysis = analyzeRun(root);
  assert.equal(analysis.layout, "legacy");
  assert.equal(analysis.totals.scenarioCount, 1);
  assert.equal(analysis.totals.agentMessages, 1);
});

it("CLI preparation failure accounts for every unit without claiming execution", async () => {
  const root = await scratch();
  const input = join(root, "synthetic.tgz");
  await writeFile(input, "deliberate input hash mismatch");
  const runRoot = join(root, "runs");
  const result = await runNode(["test/e2e/parallel-runner.mjs", "--prepare-only"], {
    PATH: process.env.PATH, HOME: join(root, "absent-home"), E2E_RUN_ROOT: runRoot, E2E_RUN_NAME: "failure",
    E2E_OPERATOR_AUTH_JSON: "/must-not-read", E2E_NATIVE_TARBALL: input, E2E_NATIVE_SHA256: "0".repeat(64),
    E2E_MCP_TARBALL: input, E2E_MCP_SHA256: "0".repeat(64),
  });
  assert.equal(result.code, 1, result.stderr);
  const receipt = JSON.parse(await readFile(join(runRoot, "failure/results.json"), "utf8"));
  assert.equal(receipt.status, "preparation-failed");
  assert.equal(receipt.complete, false);
  assert.equal(receipt.accountingComplete, true);
  assert.equal(receipt.executedUnits, 0);
  assert.equal(receipt.counts["not-started"], 25);
  assert.equal(receipt.accountEnd, "suppressed");
  assert.match(result.stdout, /preparation-failed; executed 0\/25/);
  await assert.rejects(stat(join(runRoot, "failure/key-state-start.json")), /ENOENT/);
});

it("suite summaries distinguish preparation failure, skips and a completed product failure", () => {
  const options = { prepared: true, integrity: "verified-before-and-after" };
  const unstarted = [{ id: "one", outcome: "not-started", settled: true }];
  const failedPreparation = summarizeResults(unstarted, { ...options, prepared: false, failure: "install failed" });
  assert.equal(failedPreparation.status, "preparation-failed");
  assert.equal(failedPreparation.complete, false);
  assert.equal(failedPreparation.accountingComplete, true);
  assert.equal(failedPreparation.executedUnits, 0);
  const prepOnly = summarizeResults(unstarted, { ...options, preparationOnly: true });
  assert.equal(prepOnly.status, "prepared-only");
  assert.equal(prepOnly.complete, false);
  const skipped = summarizeResults([{ id: "12", outcome: "skipped", settled: true, started: "fixture" }], options);
  assert.equal(skipped.status, "incomplete-coverage");
  assert.equal(skipped.complete, false);
  assert.equal(skipped.passed, false);
  const failed = summarizeResults([{ id: "one", outcome: "failed", settled: true, started: "fixture" }], options);
  assert.equal(failed.status, "failed");
  assert.equal(failed.complete, true);
  assert.equal(failed.passed, false);
});

it("weaker binding and transport warnings remain visible without introducing an admission cap", () => {
  const receipt = { id: "15_pi_floor", kind: "provider", outcome: "passed", settled: true, started: "fixture",
    binding: "workspace-only", providerSignals: { non200: 1, retryAfter: [{ retryAfter: "7" }] } };
  const summary = summarizeResults([receipt], { prepared: true, integrity: "verified-before-and-after" });
  assert.equal(summary.status, "passed-with-limitations");
  assert.equal(summary.cleanPass, false);
  assert.equal(summary.providerObservations.non200, 1);
  assert.equal(summary.providerObservations.retryAfterRecords, 1);
  assert.ok(summary.warnings.some((warning) => warning.includes("binding=workspace-only")));
  assert.ok(summary.warnings.some((warning) => warning.includes("Retry-After")));
  assert.match(formatUnitResult(receipt), /binding=workspace-only non200=1 retryAfter=1/);
  assert.equal(PARALLEL_EVIDENCE_POLICY.PI_OFFLINE, "1");
  assert.match(PARALLEL_EVIDENCE_POLICY.explanation, /Standalone/);
});

it("declares exactly 25 units, 22 provider cases, eight recipes and two dependent comparisons", () => {
  const manifest = createManifest();
  validateManifest(manifest);
  assert.equal(manifest.units.length, 25);
  assert.equal(manifest.providerUnits, 22);
  assert.deepEqual(manifest.units.filter((unit) => unit.id.startsWith("10_")).map((unit) => unit.env.E2E_RECIPE),
    ["r1", "r4", "r5", "r6", "r7", "r8", "r9", "r10"]);
  assert.equal(manifest.units.filter((unit) => unit.kind === "comparison").length, 2);
  assert.equal(manifest.units.filter((unit) => unit.kind === "host-install").length, 1);
  assert.ok(!manifest.units.some((unit) => /^(13|14)_/.test(unit.id)));
});

it("dry run requires no credentials, tarballs, files or network", async () => {
  const result = await runNode(["test/e2e/parallel-runner.mjs", "--dry-run"], { PATH: process.env.PATH });
  assert.equal(result.code, 0, result.stderr);
  const manifest = JSON.parse(result.stdout);
  assert.equal(manifest.expectedUnits, 25);
  assert.equal(manifest.concurrency, 25);
  assert.equal(manifest.operatorCap, false);
});

it("duplicate run IDs have one winner across independent processes", async () => {
  const root = await scratch();
  const module = pathToFileURL(resolve("test/e2e/parallel-supervisor.mjs")).href;
  const program = `import { allocateRun } from ${JSON.stringify(module)}; await allocateRun(process.argv[1], 'same-id');`;
  const results = await Promise.all([1, 2].map(() => runNode(["--input-type=module", "-e", program, root])));
  assert.equal(results.filter((result) => result.code === 0).length, 1);
  assert.match(results.find((result) => result.code !== 0)!.stderr, /EEXIST/);
  await assert.rejects(allocateRun(root, "../escape"));
});

it("allocates distinct private roots and rejects reuse", async () => {
  const root = await scratch();
  await mkdir(join(root, "units"));
  const a = await allocateUnit(root, "a");
  const b = await allocateUnit(root, "b");
  for (const key of Object.keys(a)) {
    assert.notEqual(a[key], b[key]);
    assert.equal((await stat(a[key])).mode & 0o777, 0o700);
  }
  await assert.rejects(allocateUnit(root, "a"), /EEXIST/);
});

it("unbounded default admits all 23 initially runnable units before either comparison", async () => {
  const manifest = createManifest();
  const entered: string[] = [];
  let release: () => void;
  const barrier = new Promise<void>((done) => { release = done; });
  const promise = runManifest(manifest, async (unit) => {
    entered.push(unit.id);
    if (unit.kind !== "comparison") await barrier;
    return { outcome: "passed", settled: true };
  });
  await delay(30);
  assert.equal(entered.length, 23);
  assert.ok(!entered.some((id) => id.endsWith("compare")));
  release!();
  const results = await promise;
  assert.equal(results.length, 25);
  assert.equal(results.filter((result) => result.outcome === "passed").length, 25);
});

it("operator cap is explicit and skips, blocked comparisons and missing receipts remain visible", async () => {
  const manifest = createManifest();
  let active = 0;
  let peak = 0;
  const results = await runManifest(manifest, async (unit) => {
    peak = Math.max(peak, ++active);
    await delay(2);
    active--;
    return { outcome: unit.id === "05_default" ? "skipped" : "passed", settled: true };
  }, { concurrency: 2 });
  assert.equal(peak, 2);
  assert.equal(results.length, 25);
  assert.equal(results.find((result) => result.id === "05_compare").outcome, "blocked");
  assert.equal(results.find((result) => result.id === "05_default").outcome, "skipped");
  const missing = completeResults(manifest, new Map());
  assert.equal(missing.length, 25);
  assert.ok(missing.every((result) => result.outcome === "missing-receipt" && !result.settled));
});

it("cancelled admission still accounts for the entire manifest", async () => {
  const controller = new AbortController();
  controller.abort();
  const results = await runManifest(createManifest(), () => assert.fail("must not execute"), { signal: controller.signal });
  assert.equal(results.length, 25);
  assert.ok(results.every((result) => result.outcome === "not-started"));
});

it("receipt write failure drains other workers rather than escaping the scheduler", async () => {
  const manifest = createManifest();
  let settled = 0;
  const results = await runManifest(manifest, async () => {
    await delay(5);
    settled++;
    return { outcome: "passed", settled: true };
  }, { onReceipt: async () => { throw new Error("disk full fixture"); } });
  assert.equal(settled, 23); // Comparison prerequisites have failed their publication.
  assert.equal(results.length, 25);
  assert.ok(results.every((result) => result.outcome === "harness-fail"));
});

it("rejects cycles, unknown dependencies and duplicate units before execution", () => {
  const manifest = createManifest();
  manifest.units[0].dependencies = [manifest.units[0].id];
  assert.throws(() => validateManifest(manifest), /cycle/);
  manifest.units[0].dependencies = ["absent"];
  assert.throws(() => validateManifest(manifest), /Unknown dependency/);
  manifest.units[0].dependencies = [];
  manifest.units.push(manifest.units[0]);
  assert.throws(() => validateManifest(manifest), /duplicate/);
});

it("passes isolated environment and exact decomposition hooks without inherited runtime injection", async () => {
  const root = await scratch();
  await mkdir(join(root, "units"));
  const paths = await allocateUnit(root, "05_compare");
  const normal = await allocateUnit(root, "05_default");
  const tight = await allocateUnit(root, "05_tight");
  const base = { PATH: "/usr/bin", HOME: "/operator", OPENROUTER_API_KEY: "dummy-fixture",
    NODE_OPTIONS: "--require=evil", CODEX_HOME: "/operator/codex", KIMI_API_KEY: "not-inherited" };
  assert.equal(isolatedEnvironment(paths, base).NODE_OPTIONS, undefined);
  const artifacts = { paths: { currentBin: "/frozen/bin/pi", floorBin: "/floor/bin/pi", extension: "/frozen/entry.js",
    floorExtension: "/floor/entry.js", mcpCli: "/frozen/mcp.js", mcpTarball: "/frozen/mcp.tgz",
    traceExtension: "/frozen/trace.mjs", traceFetch: "/frozen/fetch.mjs" } };
  const manifest = createManifest();
  const env = workerEnvironment(manifest.units.find((unit) => unit.id === "05_compare"), paths,
    new Map([["05_default", normal], ["05_tight", tight]]), artifacts, base);
  assert.equal(env.E2E_COMPARE_DEFAULT_WORKSPACE, normal.workspace);
  assert.equal(env.E2E_COMPARE_TIGHT_WORKSPACE, tight.workspace);
  assert.equal(env.E2E_LIMIT_ARM, "compare");
  assert.equal(env.OPENROUTER_API_KEY, undefined);
  assert.equal(env.KIMI_API_KEY, undefined);
  assert.equal(env.CODEX_HOME, undefined);
  assert.equal(env.E2E_RUN_ROOT, paths.root);
  assert.equal(env.TEST_MODEL, "openrouter/google/gemini-3.8-flash");
  assert.equal(env.JITI_FS_CACHE, "false");
  assert.equal(env.PI_OFFLINE, "1");
  assert.ok(!env.NODE_OPTIONS.includes("evil"));
  const floor = workerEnvironment(manifest.units.find((unit) => unit.id === "15_pi_floor"), paths, new Map(), artifacts, base);
  assert.equal(floor.E2E_EXTENSION_PATH, "/floor/entry.js");
  assert.equal(floor.OPENROUTER_API_KEY, "dummy-fixture");
  assert.equal(floor.E2E_TIMEOUT_SECONDS, "600");
  assert.equal(floor.E2E_RETRY_SLEEP_SECONDS, "30");
  assert.equal(floor.E2E_KILL_AFTER_SECONDS, "15");
});

it("hashes the full graph, seals permissions and detects same-sized content tampering", async () => {
  const root = await scratch();
  const artifacts = join(root, "artefacts");
  await mkdir(join(artifacts, "chunks"), { recursive: true });
  await writeFile(join(artifacts, "entry.js"), 'import "./chunks/dep.js";');
  const dep = join(artifacts, "chunks/dep.js");
  await writeFile(dep, "export const a = 1;");
  await symlink("entry.js", join(artifacts, "cli"));
  await verifyEntrypoints(artifacts, [join(artifacts, "cli")]);
  const manifest = await sealArtifacts(artifacts, join(root, "manifest.json"));
  try {
    assert.equal(await verifyArtifacts(artifacts, manifest), manifest.digest);
    await chmod(dep, 0o600); // Same-UID permissions are accidental-write protection, not a sandbox.
    await writeFile(dep, "export const a = 2;");
    await chmod(dep, 0o400);
    await assert.rejects(verifyArtifacts(artifacts, manifest), /integrity mismatch/);
  } finally {
    await chmod(artifacts, 0o700);
    await chmod(join(artifacts, "chunks"), 0o700);
    await chmod(join(artifacts, "entry.js"), 0o600);
    await chmod(dep, 0o600);
    await chmod(join(root, "manifest.json"), 0o600);
  }
});

it("refuses missing entrypoints, symlink escapes and permission changes", async () => {
  const root = await scratch();
  const artifacts = join(root, "artefacts");
  await mkdir(artifacts);
  await writeFile(join(root, "outside"), "fixture");
  await symlink("../outside", join(artifacts, "escape"));
  await assert.rejects(inventoryTree(artifacts), /escapes snapshot/);
  await assert.rejects(verifyEntrypoints(artifacts, [join(artifacts, "missing")]), /ENOENT/);
  const clean = join(root, "clean");
  await mkdir(clean);
  await writeFile(join(clean, "entry"), "data");
  const manifest = await sealArtifacts(clean, join(root, "clean-manifest.json"));
  try {
    await chmod(join(clean, "entry"), 0o600);
    await assert.rejects(verifyArtifacts(clean, manifest), /Writable artefact/);
  } finally {
    await chmod(clean, 0o700);
    await chmod(join(clean, "entry"), 0o600);
    await chmod(join(root, "clean-manifest.json"), 0o600);
  }
});

it("rejects a mismatched packed input before any installer is started", async () => {
  const root = await scratch();
  const input = join(root, "native.tgz");
  await writeFile(input, "synthetic tarball fixture");
  await assert.rejects(prepareArtifacts({ root, repo: root, nativeTarball: input,
    nativeSha256: "0".repeat(64), mcpTarball: input, mcpSha256: "0".repeat(64),
    env: { PATH: "/no-installer-here" } }), /input tarball hash mismatch/);
});

it("reports a missing executable and an explicit skip without losing settlement", async () => {
  const root = await scratch();
  const missing = await supervise({ command: join(root, "absent"), cwd: root, env: process.env,
    logPath: join(root, "absent.log"), timeoutMs: 1000 });
  assert.equal(missing.outcome, "harness-fail");
  assert.equal(missing.settled, true);
  const skipped = await supervise({ command: process.execPath, args: ["-e", "process.exit(77)"],
    cwd: root, env: process.env, logPath: join(root, "skip.log"), timeoutMs: 1000 });
  assert.equal(skipped.outcome, "skipped");
  assert.equal(skipped.settled, true);
});

it("streams output before exit and escalates TERM-resistant descendants to KILL", { timeout: 15_000 }, async () => {
  const root = await scratch();
  const logPath = join(root, "scenario.log");
  const childCode = 'process.on("SIGTERM", () => {}); console.log("CHILD", process.pid); setInterval(() => console.log("tick"), 20);';
  const code = `const {spawn}=require('node:child_process'); process.on('SIGTERM',()=>{}); spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'inherit'}); console.log('READY'); setInterval(()=>{},100);`;
  const events: { type: string }[] = [];
  const running = supervise({ command: process.execPath, args: ["-e", code], cwd: root, env: process.env,
    logPath, timeoutMs: 600, graceMs: 150, event: (event) => events.push(event) });
  for (let i = 0; i < 100; i++) {
    if (await readFile(logPath, "utf8").catch(() => "").then((text) => text.includes("CHILD"))) break;
    await delay(10);
  }
  assert.match(await readFile(logPath, "utf8"), /CHILD/);
  const receipt = await running;
  assert.equal(receipt.outcome, "timeout");
  assert.equal(receipt.settled, true);
  assert.equal(receipt.killed, true);
  assert.ok(receipt.observedProcesses >= 2);
  assert.ok(events.some((event) => event.type === "kill"));
  const hash = await hashFile(logPath);
  await delay(150);
  assert.equal(await hashFile(logPath), hash);
  assert.ok(!(await processTable()).some((row) => row.sid === receipt.pid && !["Z", "X"].includes(row.state)));
});

it("drains late grandchildren spawned by a TERM handler before publication", { timeout: 15_000 }, async () => {
  const root = await scratch();
  const late = 'process.on("SIGTERM",()=>{}); console.log("LATE",process.pid); setInterval(()=>console.log("late-tick"),20);';
  const code = `const {spawn}=require('node:child_process'); let once=false; process.on('SIGTERM',()=>{if(once)return;once=true;spawn(process.execPath,['-e',${JSON.stringify(late)}],{stdio:'inherit'});setTimeout(()=>process.exit(0),100);});console.log('ready');setInterval(()=>{},100);`;
  const logPath = join(root, "late.log");
  const receipt = await supervise({ command: process.execPath, args: ["-e", code], cwd: root, env: process.env,
    logPath, timeoutMs: 400, graceMs: 300 });
  assert.equal(receipt.settled, true);
  assert.equal(receipt.outcome, "timeout");
  assert.match(await readFile(logPath, "utf8"), /LATE/);
  const hash = await hashFile(logPath);
  await delay(150);
  assert.equal(await hashFile(logPath), hash);
  assert.ok(!(await processTable()).some((row) => row.sid === receipt.pid && !["Z", "X"].includes(row.state)));
});

it("normal shell exit with a surviving descendant is settled but is not a pass", { timeout: 15_000 }, async () => {
  const root = await scratch();
  const childCode = 'process.on("SIGTERM",()=>{}); console.log("background",process.pid); setInterval(()=>{},100);';
  const code = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'inherit'});child.unref();setTimeout(()=>process.exit(0),150);`;
  const receipt = await supervise({ command: process.execPath, args: ["-e", code], cwd: root, env: process.env,
    logPath: join(root, "exit.log"), timeoutMs: 2_000, graceMs: 100 });
  assert.equal(receipt.outcome, "descendants-terminated");
  assert.equal(receipt.settled, true);
  assert.equal(receipt.killed, true);
  assert.equal(receipt.descendantsTerminated, true);
  assert.match(formatUnitResult({ ...receipt, id: "fixture", binding: "workspace-only" }), /termination=exit killed=true binding=workspace-only/);
});

it("cancellation settles the running group and evidence-write failures do not orphan it", { timeout: 15_000 }, async () => {
  for (const mode of ["cancel", "evidence-error"]) {
    const root = await scratch();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 150);
    const receipt = await supervise({ command: process.execPath, args: ["-e", "setInterval(()=>{},100)"],
      cwd: root, env: process.env, logPath: join(root, "cancel.log"), timeoutMs: 2_000,
      signal: mode === "cancel" ? controller.signal : undefined, graceMs: 100,
      event: () => { if (mode === "evidence-error") throw new Error("fixture disk full"); } });
    clearTimeout(timer);
    assert.equal(receipt.settled, true);
    assert.equal(receipt.outcome, mode === "cancel" ? "interrupted" : "harness-fail");
  }
});
