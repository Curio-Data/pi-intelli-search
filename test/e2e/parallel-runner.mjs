#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { appendFileSync } from "node:fs";
import { mkdir, writeFile, readFile, lstat, readlink } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { createManifest, LOOP_MODEL } from "./parallel-manifest.mjs";
import { allocateRun, allocateUnit, completeResults, runManifest, supervise, writeJsonExclusive } from "./parallel-supervisor.mjs";
import { hashFile, prepareArtifacts, verifyArtifacts } from "./parallel-artifacts.mjs";
import { readUnitEvidence } from "./analyze-evidence.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export const PARALLEL_EVIDENCE_POLICY = {
  PI_OFFLINE: "1",
  explanation: "Parallel-lane hosts disable automatic network activity, including model catalogue refreshes; explicit model calls remain live. Standalone runs do not set this by default.",
  loopModelResolution: "Not established by offline fixtures; qualify against the installed host before live acceptance.",
  environmentFile: "Repository .env is not loaded or copied; pass approved variables explicitly.",
};

export async function preflightCredentials(base) {
  if (typeof base.OPENROUTER_API_KEY === "string" && base.OPENROUTER_API_KEY.trim()) return { ...base };
  if (!base.E2E_OPERATOR_AUTH_JSON)
    throw new Error("Provider execution requires OPENROUTER_API_KEY or E2E_OPERATOR_AUTH_JSON with an api_key OpenRouter entry");
  let entry;
  try { entry = JSON.parse(await readFile(base.E2E_OPERATOR_AUTH_JSON, "utf8")).openrouter; }
  catch { throw new Error("E2E_OPERATOR_AUTH_JSON could not be read or parsed; credential contents are withheld"); }
  if (entry?.type !== "api_key" || typeof entry.key !== "string" || !entry.key.trim())
    throw new Error("E2E_OPERATOR_AUTH_JSON requires an api_key OpenRouter entry with a nonempty key");
  return { ...base, OPENROUTER_API_KEY: entry.key };
}

export async function captureProvenance(repo, runGit) {
  const git = runGit ?? ((args) => execFileSync("git", ["-C", repo, ...args], {
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }));
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const diffArgs = ["--no-ext-diff", "--no-textconv", "--binary", "--full-index"];
  const untracked = [];
  for (const path of git(["ls-files", "--others", "--exclude-standard", "-z"]).toString().split("\0").filter(Boolean).sort()) {
    const physical = join(repo, path);
    const info = await lstat(physical);
    if (!info.isFile() && !info.isSymbolicLink()) throw new Error("Unsupported untracked provenance entry");
    untracked.push({ path, mode: info.mode & 0o777, type: info.isSymbolicLink() ? "symlink" : "file",
      sha256: info.isSymbolicLink() ? hash(await readlink(physical)) : await hashFile(physical) });
  }
  const diffs = {
    headToWorktree: hash(git(["diff", ...diffArgs, "HEAD", "--"])),
    staged: hash(git(["diff", ...diffArgs, "--cached", "--"])),
    unstaged: hash(git(["diff", ...diffArgs, "--"])),
    untracked,
  };
  return { worktree: resolve(repo), head: git(["rev-parse", "HEAD"]).toString().trim(),
    branch: git(["rev-parse", "--abbrev-ref", "HEAD"]).toString().trim(),
    status: git(["status", "--porcelain=v1", "--untracked-files=all"]).toString(),
    completeDiffSha256: hash(JSON.stringify(diffs)), diffs,
    scope: "Tracked staged and unstaged binary diffs, including mode changes, plus all non-ignored untracked file bytes; ignored inputs are excluded." };
}

export function summarizeResults(results, { prepared, preparationOnly = false, failure, integrity, preparationSettled = true }) {
  const settled = preparationSettled && results.every((result) => result.settled);
  const counts = {};
  for (const result of results) counts[result.outcome] = (counts[result.outcome] ?? 0) + 1;
  const executedUnits = results.filter((result) => result.started).length;
  const accountingComplete = !results.some((result) => result.outcome === "missing-receipt");
  const incompleteUnits = results.filter((result) => !result.started || ["not-started", "skipped", "blocked", "missing-receipt", "unsettled"].includes(result.outcome)).map((result) => result.id);
  const complete = prepared && !preparationOnly && !failure && settled && accountingComplete && incompleteUnits.length === 0;
  const passed = complete && integrity === "verified-before-and-after" && results.every((result) => result.outcome === "passed");
  const warnings = results.flatMap((result) => [
    ...(result.descendantsTerminated ? [`${result.id}: descendants terminated after leader exit`] : []),
    ...(result.kind === "provider" && result.started && result.binding !== "tool-call" ? [`${result.id}: binding=${result.binding ?? "unavailable"}`] : []),
    ...(result.providerSignals?.non200 ? [`${result.id}: ${result.providerSignals.non200} observed non-200 responses`] : []),
    ...(result.providerSignals?.retryAfter?.length ? [`${result.id}: ${result.providerSignals.retryAfter.length} Retry-After records`] : []),
    ...(result.providerSignals?.health?.malformedRecords ? [`${result.id}: malformed provider records`] : []),
    ...(result.providerSignals?.health?.malformedVerdicts ? [`${result.id}: malformed verdict receipts`] : []),
    ...(result.providerSignals?.health?.missing?.length ? [`${result.id}: missing provider streams: ${result.providerSignals.health.missing.join(", ")}`] : []),
    ...(result.kind === "provider" && result.started && result.providerSignals?.responseRecords === 0 ? [`${result.id}: no observed provider responses`] : []),
  ]);
  const status = !prepared ? "preparation-failed" : preparationOnly ? failure ? "preparation-failed" : "prepared-only"
    : !settled ? "unsettled" : incompleteUnits.length ? "incomplete-coverage" : !passed ? "failed"
    : warnings.length ? "passed-with-limitations" : "passed";
  const providerObservations = {
    non200: results.reduce((sum, result) => sum + (result.providerSignals?.non200 ?? 0), 0),
    retryAfterRecords: results.reduce((sum, result) => sum + (result.providerSignals?.retryAfter?.length ?? 0), 0),
    unitsWith429: results.filter((result) => result.providerSignals?.saw429).map((result) => result.id),
    scope: "Observed records only; channels may overlap and missing evidence is not zero provider activity.",
  };
  return { status, complete, accountingComplete, settled, executedUnits, counts, incompleteUnits, passed,
    cleanPass: passed && warnings.length === 0, warnings, providerObservations,
    policy: "Every expected unit is required. Skips and blocked or unstarted units are incomplete coverage, not product failures. Descendant termination after a zero leader exit is not a pass." };
}

export function formatUnitResult(receipt) {
  return `${receipt.id.padEnd(24)} ${receipt.outcome} settled=${receipt.settled} termination=${receipt.termination ?? "none"} killed=${Boolean(receipt.killed)} binding=${receipt.binding ?? "not-applicable"} non200=${receipt.providerSignals?.non200 ?? "unknown"} retryAfter=${receipt.providerSignals?.retryAfter?.length ?? "unknown"}`;
}

export function isolatedEnvironment(paths, base = process.env) {
  // Deliberately do not inherit NODE_OPTIONS, provider keys, host profiles or npm configuration.
  const env = {};
  for (const key of ["PATH", "LANG", "LC_ALL", "TZ", "TERM", "SSL_CERT_FILE", "SSL_CERT_DIR"])
    if (base[key]) env[key] = base[key];
  return { ...env, HOME: paths.home, TMPDIR: paths.tmp, TMP: paths.tmp, TEMP: paths.tmp,
    PI_CODING_AGENT_DIR: paths.agent, XDG_CONFIG_HOME: paths["xdg-config"],
    XDG_CACHE_HOME: paths["xdg-cache"], XDG_DATA_HOME: paths["xdg-data"],
    XDG_STATE_HOME: paths["xdg-state"], XDG_RUNTIME_DIR: paths["xdg-runtime"],
    npm_config_cache: paths["npm-cache"], npm_config_userconfig: join(paths.home, ".npmrc"),
    npm_config_globalconfig: join(paths.home, "global.npmrc"), npm_config_update_notifier: "false",
    JITI_FS_CACHE: "false", PI_OFFLINE: "1", NO_COLOR: "1" };
}

export function workerEnvironment(unit, paths, allPaths, artifacts, base = process.env) {
  const frozen = artifacts.paths;
  const env = { ...isolatedEnvironment(paths, base), ...unit.env,
    PATH: `${dirname(frozen.nodeBin ?? process.execPath)}:${dirname(frozen.currentBin)}:${base.PATH ?? "/usr/bin:/bin"}`,
    E2E_UNIT_ID: unit.id, E2E_RUN_ROOT: paths.root,
    E2E_WORKSPACE: paths.workspace, E2E_LOG_ROOT: paths.logs, E2E_TRACE_DIR: paths.traces,
    E2E_TRACE_EXTENSION_PATH: frozen.traceExtension,
    E2E_EXTENSION_PATH: unit.id === "15_pi_floor" ? frozen.floorExtension : frozen.extension,
    E2E_MCP_CLI: frozen.mcpCli, E2E_MCP_TARBALL: frozen.mcpTarball, E2E_FLOOR_BIN: frozen.floorBin,
    E2E_SKIP_BUILD: "1", E2E_COMPACT_JSON_OUTPUT: "1", E2E_KEEP_ARTIFACTS: "1",
    TEST_MODEL: LOOP_MODEL, E2E_LOOP_MODEL_ID: LOOP_MODEL,
    PI_INTELLI_E2E_SCENARIO: unit.id, PI_INTELLI_E2E_LOOP_MODEL: LOOP_MODEL,
    PI_INTELLI_E2E_HTTP_TRACE: join(paths.root, "http.jsonl"),
    PI_INTELLI_E2E_EXTENSION_TRACE: join(paths.root, "extension.jsonl"),
    NODE_OPTIONS: `--import=${pathToFileURL(frozen.traceFetch).href}`,
  };
  // Scenario 12 and comparison processes get no real provider authority.
  if (unit.kind === "provider") {
    env.E2E_OPERATOR_AUTH_JSON = base.E2E_OPERATOR_AUTH_JSON ?? join(base.HOME ?? "", ".pi/agent/auth.json");
    if (base.OPENROUTER_API_KEY) env.OPENROUTER_API_KEY = base.OPENROUTER_API_KEY;
  } else env.E2E_OPERATOR_AUTH_JSON = join(paths.home, "absent-auth.json");
  if (unit.kind === "comparison") {
    const [normal, tight] = unit.dependencies.map((id) => allPaths.get(id));
    env.E2E_COMPARE_DEFAULT_WORKSPACE = normal.workspace;
    env.E2E_COMPARE_TIGHT_WORKSPACE = tight.workspace;
  }
  // Only these execution knobs are inherited, not arbitrary E2E/runtime injection.
  for (const key of ["E2E_RUN_GAP_SECONDS", "E2E_GAP_SECONDS"])
    if (base[key] !== undefined) env[key] = base[key];
  if (unit.kind === "provider") {
    env.E2E_TOOL_ALLOWLIST = unit.id === "11_mcp_stdio"
      ? "mcp__intelli_search__intelli_research"
      : "intelli_research";
    // Configuration units 02-11 make their research call exactly (no agent
    // loop) and fail rather than fall back when the host cannot; 01 and 15
    // keep natural-language routing as a separate evidence class.
    if (/^(0[2-9]|1[01])_/.test(unit.script)) env.E2E_INVOCATION = "direct";
    env.E2E_TIMEOUT_SECONDS = String(unit.budget.attemptSeconds);
    env.E2E_RETRY_SLEEP_SECONDS = String(unit.budget.retrySeconds);
    env.E2E_KILL_AFTER_SECONDS = String(unit.budget.killSeconds);
  }
  return env;
}

async function accountSnapshot(root, phase, base) {
  const receipt = { observedAt: new Date().toISOString(), scope: "key-wide; includes any non-suite traffic" };
  if (base.E2E_ACCOUNT_SNAPSHOTS !== "1" || !base.OPENROUTER_API_KEY) {
    receipt.status = "not-requested-or-key-unavailable";
  } else {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/key", {
        headers: { Authorization: `Bearer ${base.OPENROUTER_API_KEY}` }, signal: AbortSignal.timeout(30_000),
      });
      receipt.httpStatus = response.status;
      if (response.ok) {
        const body = await response.json();
        receipt.data = {};
        for (const key of ["limit", "limit_reset", "limit_remaining", "usage", "usage_daily", "is_free_tier", "free_model_daily_requests", "effective_budget"])
          if (Object.hasOwn(body.data ?? {}, key)) receipt.data[key] = body.data[key];
        receipt.status = "captured";
      } else { await response.body?.cancel(); receipt.status = "unavailable"; }
    } catch { receipt.status = "unavailable"; }
  }
  await writeJsonExclusive(join(root, `key-state-${phase}.json`), receipt);
}

function positiveInteger(value, fallback, name) {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value)))
    throw new Error(`${name} must be a positive integer`);
  return Number(value);
}

export async function main(args = process.argv.slice(2), base = process.env) {
  const supported = new Set(["--dry-run", "--prepare-only", "--help"]);
  const preparationOnly = args.includes("--prepare-only");
  for (const arg of args) if (!supported.has(arg)) throw new Error(`Unknown option: ${arg}`);
  if (args.includes("--help")) {
    console.log(`Usage: test/run-e2e-parallel.sh [--dry-run | --prepare-only]
Required inputs: E2E_NATIVE_TARBALL, E2E_NATIVE_SHA256, E2E_MCP_TARBALL, E2E_MCP_SHA256.
Inputs must be prepacked release artefacts. This runner does not build or pack.
Optional: E2E_RUN_ROOT (parent), E2E_RUN_NAME, E2E_CONCURRENCY (default: all eligible units),
E2E_CURRENT_VERSION (1.5.0), PI_FLOOR_VERSION (0.86.0).
Timeouts derive from 3 attempts (600s for 01/11/15, 300s for 03/08, otherwise 360s),
plus 15s hard-kill grace per attempt, two 30s retry gaps and 180s setup allowance.
E2E_TIMEOUT_SECONDS, E2E_RETRY_SLEEP_SECONDS and E2E_KILL_AFTER_SECONDS override those inputs.
E2E_SCRIPT_TIMEOUT_SECONDS may raise, but cannot lower, any derived unit budget.
Host-install unit 12 has a 1200s budget; offline comparisons have 180s budgets.
Execution preflights OPENROUTER_API_KEY or loads an api_key openrouter.key from E2E_OPERATOR_AUTH_JSON.
No repository .env is loaded. Dry-run and prepare-only do not read credentials.
E2E_ACCOUNT_SNAPSHOTS=1 enables key-wide snapshots using the preflighted key.
Every expected unit is required: skipped host-install coverage (missing claude/codex) is incomplete, not a pass.
PI_OFFLINE=1 disables automatic host network activity, including catalogue refreshes, not explicit model calls.
This differs from standalone-lane evidence. Offline tests do not establish loop-model catalogue availability.
Dry run prints all 25 units without filesystem writes, credentials, installs or network calls.
Prepare-only installs and validates the snapshots without workers or account API calls.`);
    return 0;
  }
  const manifest = createManifest({ scriptSeconds: base.E2E_SCRIPT_TIMEOUT_SECONDS,
    attemptSeconds: base.E2E_TIMEOUT_SECONDS, retrySeconds: base.E2E_RETRY_SLEEP_SECONDS,
    killSeconds: base.E2E_KILL_AFTER_SECONDS });
  const concurrency = positiveInteger(base.E2E_CONCURRENCY, manifest.units.length, "E2E_CONCURRENCY");
  if (base.E2E_RUN_MODE && base.E2E_RUN_MODE !== "parallel")
    throw new Error("Use E2E_CONCURRENCY=1 for a deliberately serial override");
  if (args.includes("--dry-run")) {
    console.log(JSON.stringify({ ...manifest, concurrency, evidencePolicy: PARALLEL_EVIDENCE_POLICY, operatorCap: base.E2E_CONCURRENCY !== undefined }, null, 2));
    return 0;
  }
  // Validate input requirements before allocating a run or reading credentials.
  for (const key of ["E2E_NATIVE_TARBALL", "E2E_NATIVE_SHA256", "E2E_MCP_TARBALL", "E2E_MCP_SHA256"])
    if (!base[key]) throw new Error(`Required: ${key} (see --help)`);
  if (!preparationOnly) base = await preflightCredentials(base);
  const parent = resolve(base.E2E_RUN_ROOT ?? join(repoRoot, ".tmp/e2e-parallel"));
  const root = await allocateRun(parent, base.E2E_RUN_NAME ?? `parallel-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  const records = new Map();
  let artifacts;
  let integrity = "not-prepared";
  let preparationSettled = true;
  let prepared = false;
  let executionStarted = false;
  let failure;
  try {
    const provenance = await captureProvenance(repoRoot);
    await writeJsonExclusive(join(root, "manifest.json"), { ...manifest, concurrency, runRoot: root,
      provenance, evidencePolicy: PARALLEL_EVIDENCE_POLICY,
      operatorCap: base.E2E_CONCURRENCY !== undefined, createdAt: new Date().toISOString() });
    await mkdir(join(root, "units"), { mode: 0o700 });
    const allPaths = new Map();
    for (const unit of manifest.units) allPaths.set(unit.id, await allocateUnit(root, unit.id));
    const prepPaths = await allocateUnit(root, "_preparation");
    console.log(`Preparing frozen runtimes: ${root}`);
    artifacts = await prepareArtifacts({ root, repo: repoRoot, provenance,
      nativeTarball: resolve(base.E2E_NATIVE_TARBALL), mcpTarball: resolve(base.E2E_MCP_TARBALL),
      nativeSha256: base.E2E_NATIVE_SHA256, mcpSha256: base.E2E_MCP_SHA256,
      currentVersion: base.E2E_CURRENT_VERSION ?? "1.5.0", floorVersion: base.PI_FLOOR_VERSION ?? "0.86.0",
      env: isolatedEnvironment(prepPaths, base), signal: controller.signal });
    await verifyArtifacts(artifacts.root, artifacts.manifest);
    integrity = "verified-before";
    const afterPreparation = await captureProvenance(repoRoot);
    if (afterPreparation.head !== provenance.head || afterPreparation.status !== provenance.status ||
        afterPreparation.completeDiffSha256 !== provenance.completeDiffSha256)
      throw new Error("Harness source changed during preparation; refuse worker admission");
    prepared = true;
    if (preparationOnly) {
      for (const unit of manifest.units) records.set(unit.id, {
        id: unit.id, script: unit.script, kind: unit.kind, outcome: "not-started", reason: "preparation-only", settled: true,
      });
    } else {
      await accountSnapshot(root, "start", base);
      executionStarted = true;
      await runManifest(manifest, async (unit) => {
      const paths = allPaths.get(unit.id);
      for (const filename of ["http.jsonl", "extension.jsonl", "supervision.jsonl"])
        await writeFile(join(paths.root, filename), "", { flag: "wx", mode: 0o600 });
      const event = (data) => appendFileSync(join(paths.root, "supervision.jsonl"), `${JSON.stringify({ unit: unit.id, ...data })}\n`);
      const result = await supervise({ command: "bash", args: [join(artifacts.paths.harness, "test/e2e", unit.script)],
        cwd: paths.workspace, env: workerEnvironment(unit, paths, allPaths, artifacts, base),
        logPath: join(paths.root, "scenario.log"), timeoutMs: unit.timeoutMs, signal: controller.signal, event });
      let evidence = { binding: "unsettled", providerSignals: null };
      if (result.settled) {
        try { evidence = readUnitEvidence(paths.root); }
        catch { result.outcome = "harness-fail"; evidence = { binding: "unavailable", evidenceError: "Could not read unit evidence" }; }
      }
      return { ...result, ...evidence, artefactManifestHash: artifacts.manifest.digest,
        evidencePolicy: PARALLEL_EVIDENCE_POLICY };
    }, { concurrency, signal: controller.signal, onReceipt: async (receipt) => {
      records.set(receipt.id, receipt);
      // An unresolved process census is a diagnostic, never a terminal verdict.
      await writeJsonExclusive(join(allPaths.get(receipt.id).root, receipt.settled ? "result.json" : "supervision-failure.json"), receipt);
      console.log(formatUnitResult(receipt));
      if (!receipt.settled) controller.abort();
      } });
    }
    await verifyArtifacts(artifacts.root, artifacts.manifest);
    integrity = "verified-before-and-after";
  } catch (error) {
    failure = error.message;
    if (error.unsettled) preparationSettled = false;
    if (artifacts) integrity = "failed-or-unverified-after";
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
  // All expected cases survive preparation failure, cancellation and receipt gaps.
  for (const unit of manifest.units) if (!records.has(unit.id) && !executionStarted)
    records.set(unit.id, { id: unit.id, script: unit.script, kind: unit.kind, outcome: "not-started",
      reason: "preparation-failed", settled: true });
  const results = completeResults(manifest, records);
  const summary = summarizeResults(results, { prepared, preparationOnly, failure, integrity, preparationSettled });
  const captureEnd = summary.settled && executionStarted;
  if (captureEnd) await accountSnapshot(root, "end", base);
  await writeJsonExclusive(join(root, "results.json"), { schemaVersion: 2, expectedUnits: manifest.expectedUnits,
    providerUnits: manifest.providerUnits, ...summary, preparationOnly, prepared, integrity, error: failure ?? null,
    evidencePolicy: PARALLEL_EVIDENCE_POLICY,
    accountEnd: captureEnd ? "after-settlement" : "suppressed", scenarios: results });
  console.log(`Results: ${join(root, "results.json")} (${summary.status}; executed ${summary.executedUnits}/${manifest.expectedUnits}; skipped ${summary.counts.skipped ?? 0}; not-started ${summary.counts["not-started"] ?? 0})`);
  console.log(`Observed responses: non200=${summary.providerObservations.non200} Retry-After=${summary.providerObservations.retryAfterRecords}; this is not a complete request census.`);
  for (const warning of summary.warnings) console.log(`Evidence: ${warning}`);
  if (summary.incompleteUnits.length) console.log("Required coverage is incomplete; skipped, blocked and unstarted units are not product failures.");
  return summary.passed || (preparationOnly && prepared && !failure) ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (error) => {
    console.error(`Parallel runner: ${error.message}`);
    process.exitCode = 1;
  });
}
