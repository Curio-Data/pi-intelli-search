// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { validateManifest } from "./parallel-manifest.mjs";

export async function writeJsonExclusive(path, data) {
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, { flag: "wx", mode: 0o600 });
}

export async function allocateRun(parent, id) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/.test(id) || id === "." || id === "..")
    throw new Error("Run ID must be a single safe path component (maximum 96 characters)");
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const root = resolve(parent, id);
  await mkdir(root, { mode: 0o700 }); // Exclusive claim, including against an existing symlink.
  return root;
}

/** Linux procfs identity includes starttime, avoiding accidental signals to reused PIDs. */
let censusInFlight;
let recentCensus;
let censusAt = 0;

export async function processTable() {
  // Share a census across concurrent workers rather than scanning procfs 25 times.
  if (censusInFlight) return censusInFlight;
  if (recentCensus && performance.now() - censusAt < 10) return recentCensus;
  censusInFlight = readProcessTable().then((rows) => {
    recentCensus = rows;
    censusAt = performance.now();
    return rows;
  }).finally(() => { censusInFlight = undefined; });
  return censusInFlight;
}

async function readProcessTable() {
  if (process.platform !== "linux") throw new Error("Parallel supervision requires Linux procfs");
  const rows = await Promise.all((await readdir("/proc")).filter((id) => /^\d+$/.test(id)).map(async (id) => {
    try {
      const stat = await readFile(`/proc/${id}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      return { pid: Number(id), state: fields[0], ppid: Number(fields[1]),
        pgid: Number(fields[2]), sid: Number(fields[3]), start: fields[19] };
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ESRCH") return null;
      throw error; // Observation failure is not an empty process set.
    }
  }));
  return rows.filter(Boolean);
}

function ownedProcesses(table, leader, known) {
  const byPid = new Map(table.map((row) => [row.pid, row]));
  let changed;
  do {
    changed = false;
    for (const row of table) {
      if (known.get(row.pid) === row.start) continue;
      const parent = byPid.get(row.ppid);
      if (row.pgid === leader || row.sid === leader ||
          (parent && known.get(parent.pid) === parent.start)) {
        known.set(row.pid, row.start);
        changed = true;
      }
    }
  } while (changed);
  // Zombies cannot execute, hold sockets or write files; the external reaper owns them.
  return table.filter((row) => known.get(row.pid) === row.start && !["Z", "X"].includes(row.state));
}

function signalOwned(rows, leader, signal) {
  try { process.kill(-leader, signal); } catch (error) { if (error.code !== "ESRCH") throw error; }
  // Also cover observed descendants that changed process group/session.
  for (const row of rows) {
    try { process.kill(row.pid, signal); } catch (error) { if (error.code !== "ESRCH") throw error; }
  }
}

/** Streams directly to an owned fd. No transcript is accumulated in JS or shell variables.
 * Scope: cooperative non-daemonising scenario trees, including nested timeout groups.
 * Deliberate double-fork+setsid escape before observation requires a cgroup/subreaper.
 */
export async function supervise({ command, args = [], cwd, env, logPath, timeoutMs,
  signal, graceMs = 2_000, killWaitMs = 10_000, pollMs = 25, event = () => {} }) {
  if (process.platform !== "linux") throw new Error("Parallel supervision requires Linux");
  const started = new Date().toISOString();
  if (signal?.aborted) return { started, ended: started, outcome: "interrupted", settled: true, exitCode: null };
  const fd = openSync(logPath, "wx", 0o600);
  let child;
  try {
    child = spawn(command, args, { cwd, env, detached: true, stdio: ["ignore", fd, fd] });
  } finally { closeSync(fd); }
  let exited = false;
  let exitCode = null;
  let exitSignal = null;
  let spawnError;
  child.on("error", (error) => { spawnError = error; exited = true; });
  child.on("exit", (code, sig) => { exitCode = code; exitSignal = sig; exited = true; });
  const pid = child.pid;
  if (!pid) {
    await new Promise((done) => child.once("close", done));
    return { started, ended: new Date().toISOString(), outcome: "harness-fail", settled: true,
      exitCode, error: spawnError?.message ?? "Process did not start" };
  }
  let evidenceError;
  const notify = (data) => {
    try { event(data); } catch (error) { evidenceError = error.message; }
  };
  notify({ type: "spawn", pid, started });
  const deadline = performance.now() + timeoutMs;
  const known = new Map();
  let termination;
  let termAt;
  let killed = false;
  let descendantsTerminated = false;
  let emptySince;
  let lastRows = [];
  try {
    while (true) {
      const now = performance.now();
      lastRows = ownedProcesses(await processTable(), pid, known);
      if (!termination && (signal?.aborted || evidenceError || now >= deadline || exited)) {
        termination = signal?.aborted ? "interrupted" : evidenceError ? "evidence-error" : now >= deadline ? "timeout" : "exit";
        termAt = now;
        descendantsTerminated = termination === "exit" && lastRows.some((row) => row.pid !== pid);
        notify({ type: "term", reason: termination, pid, remaining: lastRows.map((row) => row.pid) });
        signalOwned(lastRows, pid, "SIGTERM");
      }
      if (termination && lastRows.length) {
        if (termination === "exit" && lastRows.some((row) => row.pid !== pid)) descendantsTerminated = true;
        const hard = now - termAt >= graceMs;
        if (hard && !killed) { killed = true; notify({ type: "kill", pid }); }
        // Repeat for children born during signal handlers, not just the initial census.
        signalOwned(lastRows, pid, hard ? "SIGKILL" : "SIGTERM");
        if (hard && now - termAt >= graceMs + killWaitMs) {
          return { started, ended: new Date().toISOString(), outcome: "unsettled", settled: false,
            pid, exitCode, exitSignal, termination, remaining: lastRows };
        }
      }
      if (exited && lastRows.length === 0) {
        emptySince ??= now;
        if (now - emptySince >= Math.max(100, pollMs * 2)) break;
      } else emptySince = undefined;
      await delay(pollMs);
    }
  } catch (error) {
    // Fail closed: no claim of settlement after a census error, even after best-effort KILL.
    signalOwned(lastRows, pid, "SIGKILL");
    return { started, ended: new Date().toISOString(), outcome: "unsettled", settled: false,
      pid, exitCode, exitSignal, error: error.message };
  }
  notify({ type: "settled", pid, at: new Date().toISOString(), observedProcesses: known.size });
  const outcome = evidenceError ? "harness-fail" : termination === "timeout" ? "timeout" : termination === "interrupted" ? "interrupted"
    : spawnError ? "harness-fail" : exitCode === 0 && descendantsTerminated ? "descendants-terminated"
    : exitCode === 0 ? "passed" : exitCode === 77 ? "skipped" : "failed";
  return { started, ended: new Date().toISOString(), outcome, settled: true, pid,
    exitCode, exitSignal, termination, killed, descendantsTerminated, observedProcesses: known.size, evidenceError };
}

export function completeResults(manifest, receipts) {
  return manifest.units.map((unit) => receipts.get(unit.id) ?? {
    id: unit.id, script: unit.script, kind: unit.kind, outcome: "missing-receipt", settled: false,
  });
}

/** Dependency comparisons consume only settled successful arms. Default admission is unbounded. */
export async function runManifest(manifest, execute, { concurrency = manifest.units.length, signal, onReceipt = async () => {} } = {}) {
  validateManifest(manifest);
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error("Concurrency must be a positive integer");
  const pending = new Map(manifest.units.map((unit) => [unit.id, unit]));
  const receipts = new Map();
  const active = new Map();
  async function record(unit, receipt) {
    const record = { ...receipt, id: unit.id, script: unit.script, kind: unit.kind };
    receipts.set(unit.id, record);
    try { await onReceipt(record); } catch (error) {
      // A publication failure must not unwind past still-running children.
      record.outcome = "harness-fail";
      record.receiptWriteError = error.message;
    }
  }
  while (pending.size || active.size) {
    for (const [id, unit] of pending) {
      if (signal?.aborted) {
        pending.delete(id);
        await record(unit, { outcome: "not-started", reason: "suite-interrupted", settled: true });
        continue;
      }
      if (!unit.dependencies.every((dep) => receipts.has(dep))) continue;
      if (unit.dependencies.some((dep) => receipts.get(dep).outcome !== "passed" || !receipts.get(dep).settled)) {
        pending.delete(id);
        await record(unit, { outcome: "blocked", reason: "dependency-not-passed", settled: true });
        continue;
      }
      if (active.size >= concurrency) continue;
      pending.delete(id);
      const promise = Promise.resolve().then(() => execute(unit)).catch((error) => ({
        outcome: "harness-fail", error: error.message, settled: false,
      })).then((receipt) => record(unit, receipt)).finally(() => active.delete(id));
      active.set(id, promise);
    }
    if (active.size) await Promise.race(active.values());
    else if (pending.size) throw new Error("No schedulable units");
  }
  return completeResults(manifest, receipts);
}

export async function allocateUnit(root, id) {
  const unitRoot = join(root, "units", id);
  await mkdir(unitRoot, { mode: 0o700 });
  const paths = { root: unitRoot };
  for (const name of ["home", "tmp", "workspace", "logs", "traces", "agent", "npm-cache",
    "xdg-cache", "xdg-config", "xdg-data", "xdg-state", "xdg-runtime"]) {
    paths[name] = join(unitRoot, name);
    await mkdir(paths[name], { mode: 0o700 });
  }
  return paths;
}
