#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// test/e2e/scenario-verdict.mjs: bind one live research attempt to the cache
// entry its own tool call produced.
//
// A completed sidecar somewhere under the working directory proves nothing
// about this attempt: another scenario, an earlier attempt or a numbered
// archive can all hold one. The verdict therefore starts from the attempt's
// own JSON event stream, takes the single research call, checks the arguments
// the prompt named, follows the cache path that call returned, and accepts the
// sidecar only when it lies directly inside the unit's expected cache root,
// is fresh for this attempt and records completed useful work.
//
// Usage:
//   node scenario-verdict.mjs bind --trace FILE --workspace DIR --cache-root DIR
//       --tool NAME --since-ms EPOCH_MS [--expect JSON] [--no-trace]
//
// Prints one JSON verdict on stdout. Exit status:
//   0  pass          exactly one call, expected arguments, bound completed sidecar
//   3  retry         no completed research in this attempt (nothing useful was
//                    paid for, or the call did not return)
//   4  oracle-fail   agent behaviour: several research calls, wrong arguments,
//                    or (workspace-only binding) an ambiguous result
//   5  product-fail  the call returned a cache path outside the expected root
//   2  usage error
//
// --no-trace is for hosts without a JSON event stream (the floor host when it
// lacks --mode json). It binds by the expected cache root alone and accepts
// exactly one fresh completed entry; the verdict records the weaker binding.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

export const EXIT = Object.freeze({ pass: 0, usage: 2, retry: 3, "oracle-fail": 4, "product-fail": 5 });

/** Freshness slack for filesystem timestamp granularity, in milliseconds. */
const FRESHNESS_SLACK_MS = 1000;

/** Parse a JSON-lines event stream; malformed lines are counted, not dropped silently. */
export function parseEvents(text) {
  const events = [];
  let malformed = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const value = JSON.parse(line);
      if (value && typeof value === "object") events.push(value);
      else malformed += 1;
    } catch {
      malformed += 1;
    }
  }
  return { events, malformed };
}

/**
 * Compare call arguments with the prompt's named values. A null expectation
 * means the argument must be omitted (the host normalises optional nulls, so
 * an explicit null is treated as omitted too). Unnamed arguments are free.
 */
export function argumentMismatches(args, expect) {
  const mismatches = [];
  const actualArgs = args && typeof args === "object" ? args : {};
  for (const [key, expected] of Object.entries(expect ?? {})) {
    const actual = actualArgs[key];
    if (expected === null) {
      if (actual !== undefined && actual !== null) mismatches.push({ argument: key, expected: "omitted", actual });
    } else if (!isDeepStrictEqual(actual, expected)) {
      mismatches.push({ argument: key, expected, actual: actual === undefined ? "omitted" : actual });
    }
  }
  return mismatches;
}

/** The cache path a research result reports: structured details first, then the text appendix. */
export function resultCachePath(result) {
  const details = result?.details;
  if (details && typeof details.cachePath === "string" && details.cachePath !== "") {
    return details.cachePath.replace(/\/+$/, "");
  }
  const content = Array.isArray(result?.content) ? result.content : [];
  for (const part of content) {
    if (part?.type !== "text" || typeof part.text !== "string") continue;
    const match = part.text.match(/\*\*Cache\*\*: `([^`]+?)\/?`/);
    if (match && match[1] !== "") return match[1];
  }
  return "";
}

function completed(meta) {
  return (
    meta?.outcome === "completed" &&
    Number(meta?.stages?.fetch?.succeeded) > 0 &&
    Number(meta?.stages?.collate?.summaryChars) > 0
  );
}

function readMeta(entry) {
  const file = join(entry, "meta.json");
  if (!existsSync(file)) return { meta: undefined, mtimeMs: 0 };
  try {
    return { meta: JSON.parse(readFileSync(file, "utf8")), mtimeMs: statSync(file).mtimeMs };
  } catch {
    return { meta: undefined, mtimeMs: statSync(file).mtimeMs };
  }
}

function within(parent, child) {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function sidecarState(entry, sinceMs) {
  const { meta, mtimeMs } = readMeta(entry);
  if (meta === undefined) return { ok: false, reason: "bound cache entry has no readable meta.json" };
  if (mtimeMs + FRESHNESS_SLACK_MS < sinceMs) {
    return { ok: false, reason: "bound meta.json predates this attempt (stale sidecar)", meta };
  }
  if (!completed(meta)) {
    return {
      ok: false,
      reason: `bound sidecar does not record completed useful work (outcome: ${meta?.outcome ?? "missing"})`,
      meta,
    };
  }
  return { ok: true, meta };
}

function summary(meta) {
  if (!meta) return undefined;
  return {
    outcome: meta.outcome,
    searchModel: meta.stages?.search?.model,
    extractModel: meta.stages?.extract?.model,
    collateModel: meta.stages?.collate?.model,
    fetchRequested: meta.stages?.fetch?.requested,
    fetchSucceeded: meta.stages?.fetch?.succeeded,
  };
}

/**
 * Decide one attempt. Pure apart from filesystem reads under cacheRoot.
 * Returns { status, reason, ... } with status one of the EXIT keys.
 */
export function bindAttempt({ traceText, workspace, cacheRoot, tool, sinceMs, expect, noTrace = false }) {
  const base = { tool, workspace, cacheRoot, binding: noTrace ? "workspace-only" : "tool-call" };
  const ws = existsSync(workspace) ? realpathSync(workspace) : resolve(workspace);
  const rootPath = resolve(ws, cacheRoot);
  // A root the research has not created yet still gets a canonical spelling.
  const root = existsSync(rootPath) ? realpathSync(rootPath) : join(ws, relative(resolve(workspace), rootPath));
  if (!within(ws, root)) {
    // A harness configuration error, not a product or agent result.
    throw new Error(`expected cache root ${cacheRoot} is not inside the unit workspace ${workspace}`);
  }

  if (noTrace) {
    if (!existsSync(root)) return { ...base, status: "retry", reason: "expected cache root does not exist" };
    const fresh = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => join(root, d.name))
      .filter((entry) => sidecarState(entry, sinceMs).ok);
    if (fresh.length === 0) return { ...base, status: "retry", reason: "no fresh completed sidecar in the expected cache root" };
    if (fresh.length > 1) {
      return {
        ...base,
        status: "oracle-fail",
        reason: `ambiguous: ${fresh.length} fresh completed entries in the expected cache root`,
        candidates: fresh.map((entry) => relative(ws, entry)),
      };
    }
    const entry = fresh[0];
    return {
      ...base,
      status: "pass",
      reason: "one fresh completed entry in the expected cache root (no call binding on this host)",
      entry,
      entryRelative: relative(ws, entry),
      meta: summary(readMeta(entry).meta),
    };
  }

  const { events, malformed } = parseEvents(traceText ?? "");
  const starts = events.filter((e) => e.type === "tool_execution_start" && e.toolName === tool);
  const ends = new Map(
    events.filter((e) => e.type === "tool_execution_end" && e.toolName === tool).map((e) => [e.toolCallId, e]),
  );
  const calls = starts.map((s) => ({
    toolCallId: s.toolCallId,
    args: s.args,
    returned: ends.has(s.toolCallId),
    isError: ends.get(s.toolCallId)?.isError === true,
  }));
  const withCalls = { ...base, malformedLines: malformed, calls };

  if (starts.length === 0) return { ...withCalls, status: "retry", reason: `no ${tool} call in this attempt` };
  if (starts.length > 1) {
    return {
      ...withCalls,
      status: "oracle-fail",
      reason: `${starts.length} ${tool} calls in one attempt; the verdict does not choose between them`,
      argumentMismatches: calls.map((c) => argumentMismatches(c.args, expect)),
    };
  }

  const call = starts[0];
  const mismatches = argumentMismatches(call.args, expect);
  if (mismatches.length > 0) {
    return { ...withCalls, status: "oracle-fail", reason: "research call arguments differ from the prompt", argumentMismatches: mismatches };
  }

  const end = ends.get(call.toolCallId);
  if (!end) return { ...withCalls, status: "retry", reason: "research call did not return in this attempt" };

  const reported = resultCachePath(end.result);
  if (reported === "") {
    return { ...withCalls, status: "retry", reason: "research returned no cache path (degraded or failed)", isError: end.isError === true };
  }
  const resolved = resolve(ws, reported);
  if (!existsSync(resolved)) {
    return { ...withCalls, status: "retry", reason: "reported cache path does not exist", reportedCachePath: reported };
  }
  const entry = realpathSync(resolved);
  if (dirname(entry) !== root) {
    return {
      ...withCalls,
      status: "product-fail",
      reason: "reported cache entry is not directly inside the expected cache root",
      reportedCachePath: reported,
      entry,
    };
  }
  const state = sidecarState(entry, sinceMs);
  if (!state.ok) {
    return { ...withCalls, status: "retry", reason: state.reason, reportedCachePath: reported, entry, meta: summary(state.meta) };
  }
  return {
    ...withCalls,
    status: "pass",
    reason: "one research call with the prompted arguments, bound to a fresh completed sidecar",
    reportedCachePath: reported,
    entry,
    entryRelative: relative(ws, entry),
    meta: summary(state.meta),
  };
}

/** Hash every saved source of an entry: comparison arms record what they actually read. */
export function sourceInventory(entry) {
  const dir = join(entry, "sources");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => {
      const bytes = readFileSync(join(dir, d.name));
      const url = bytes.toString("utf8", 0, Math.min(bytes.length, 4096)).match(/https?:\/\/[^\s)>"'`]+/)?.[0] ?? null;
      return { file: d.name, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), url };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}

function parseArgs(argv) {
  /** @type {{ expect?: unknown, noTrace: boolean, trace?: string, workspace?: string, cacheRoot?: string, tool?: string, sinceMs?: number, entry?: string }} */
  const out = { expect: undefined, noTrace: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`missing value for ${flag}`);
      i += 1;
      return v;
    };
    switch (flag) {
      case "--trace": out.trace = value(); break;
      case "--workspace": out.workspace = value(); break;
      case "--cache-root": out.cacheRoot = value(); break;
      case "--tool": out.tool = value(); break;
      case "--since-ms": out.sinceMs = Number(value()); break;
      case "--expect": out.expect = JSON.parse(value()); break;
      case "--no-trace": out.noTrace = true; break;
      case "--entry": out.entry = value(); break;
      default: throw new Error(`unknown argument ${flag}`);
    }
  }
  return out;
}

function main(argv) {
  const [command, ...rest] = argv;
  let opts;
  try {
    opts = parseArgs(rest);
  } catch (error) {
    process.stderr.write(`scenario-verdict: ${error.message}\n`);
    return EXIT.usage;
  }
  if (command === "sources") {
    if (!opts.entry) {
      process.stderr.write("scenario-verdict: sources needs --entry\n");
      return EXIT.usage;
    }
    process.stdout.write(`${JSON.stringify(sourceInventory(opts.entry), null, 2)}\n`);
    return EXIT.pass;
  }
  if (command !== "bind" || !opts.workspace || !opts.cacheRoot || !opts.tool || !Number.isFinite(opts.sinceMs) || (!opts.noTrace && !opts.trace)) {
    process.stderr.write("scenario-verdict: bind needs --workspace, --cache-root, --tool, --since-ms and --trace (or --no-trace)\n");
    return EXIT.usage;
  }
  if (opts.expect !== undefined && (opts.expect === null || typeof opts.expect !== "object" || Array.isArray(opts.expect))) {
    process.stderr.write("scenario-verdict: --expect must be a JSON object\n");
    return EXIT.usage;
  }
  let traceText = "";
  if (!opts.noTrace) {
    traceText = existsSync(opts.trace) ? readFileSync(opts.trace, "utf8") : "";
  }
  let verdict;
  try {
    verdict = bindAttempt({ ...opts, traceText });
  } catch (error) {
    process.stderr.write(`scenario-verdict: ${error.message}\n`);
    return EXIT.usage;
  }
  process.stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
  return EXIT[verdict.status];
}

function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}
if (invokedDirectly()) process.exitCode = main(process.argv.slice(2));
