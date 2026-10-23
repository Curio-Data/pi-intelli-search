// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// M4 growth and recovery qualification driver (credential-free). It records
// the environment identity, then runs the profile-scaled qualification suite
// in test/cache-growth-qualification.test.ts with the requested profile and
// captures all raw observations under one evidence directory.
//
// Usage:
//   node --import tsx scripts/qualify-cache-growth.mts                    # print the plan, write nothing
//   node --import tsx scripts/qualify-cache-growth.mts --profile default  # small deterministic profile
//   node --import tsx scripts/qualify-cache-growth.mts --profile full     # real production ceilings
//
// The full profile physically reaches the real production ceilings: a query
// at the 16 MiB structural limit, a committed population against the 128 MiB
// secondary-index budget, a 100000-entry whole-parent scan population and the
// pinned pi-v0.19.0 old/new writer processes. It writes bounded populations
// (planning estimate: under 1 GiB) under the repository's encrypted
// .tmp/m4-growth scratch and takes minutes. Nothing is deleted, reset or
// lowered; constants are read from src/core/run-format.ts at runtime.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { freemem, cpus, totalmem } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANDIDATE_WINDOW,
  INDEX_MAX_BYTES,
  JOURNAL_MAX_BYTES,
  JOURNAL_RECORD_MAX_BYTES,
  STRUCTURAL_MAX_BYTES,
} from "../src/core/run-format.js";

const repo = fileURLToPath(new URL("../", import.meta.url));
const scratch = join(repo, ".tmp", "m4-growth");
const ownedFiles = [
  "scripts/qualify-cache-growth.mts",
  "test/cache-growth-qualification.test.ts",
  "test/helpers/cache-growth-worker.ts",
];

const args = process.argv.slice(2);
let profile: "default" | "full" | undefined;
for (let i = 0; i < args.length; i++) {
  const value = args[i + 1];
  if (args[i] === "--profile" && (value === "default" || value === "full")) {
    profile = value;
    i += 1;
  } else {
    process.stderr.write(`usage: node --import tsx scripts/qualify-cache-growth.mts [--profile default|full]\n`);
    process.exit(2);
  }
}

const plan = {
  profiles: {
    default: "small deterministic populations; the same code path plain `npm test` runs; an explicit unknown profile name is refused, not silently treated as default",
    full: "real production ceilings: the 16 MiB structural query boundary, a near-structural-limit committed population against the 128 MiB index budget, the physical 100000-entry scan boundary with the MCP runtime WORKSPACE rejection before any catalogue or inference call, pinned pi-v0.19.0 old/new writer processes and the recovery drill with both documented offline choices",
  },
  constantsReadFromSource: {
    STRUCTURAL_MAX_BYTES,
    INDEX_MAX_BYTES,
    JOURNAL_MAX_BYTES,
    JOURNAL_RECORD_MAX_BYTES,
    CANDIDATE_WINDOW,
  },
  scenarios: [
    "q1 committed run-store growth curve (default: 4 and 16 runs; full adds 64, 256 and 1024)",
    "q2a exact structural-limit query boundaries (full only)",
    "q2b near-structural-limit population reaching the real secondary-index budget; writer and reader refusals (full only)",
    "q3 repeated corrupt-index reads, writer repair, distinct valid-but-incomplete case",
    "q4shape legacy/staging/committed/uncommitted scan shape (default)",
    "q4 physical 100000-entry scan cap boundary plus the MCP runtime WORKSPACE rejection with a denied counting transport (full only)",
    "q5 pinned pi-v0.19.0 and current writer processes on one parent",
    "q6 non-destructive recovery drill; unchanged-old-cache-plus-new-cacheDir and whole-cache-rename offline choices",
  ],
  scratchRoot: scratch,
  footprintEstimate:
    "planning estimate only, replaced by measured numbers in summary.json: default well under 100 MB and cleaned on success; full retains every dataset in owned encrypted scratch after success (bounded, roughly 1 to 2 GiB per run including preserved index copies)",
};

if (!profile) {
  process.stdout.write(`${JSON.stringify({ repo, ...plan }, null, 2)}\n`);
  process.stdout.write("No profile requested: nothing was written or executed.\n");
  process.exit(0);
}

function capture(
  command: string,
  captureArgs: readonly string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(command, captureArgs, { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
const evidence =
  process.env.INTELLI_GROWTH_EVIDENCE && process.env.INTELLI_GROWTH_EVIDENCE.length > 0
    ? process.env.INTELLI_GROWTH_EVIDENCE
    : join(scratch, "qualification", `${stamp}-P${process.pid}`);
await mkdir(evidence, { recursive: true });

const [head, branch, dirty, mount, disk] = await Promise.all([
  capture("git", ["rev-parse", "HEAD"]),
  capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]),
  capture("git", ["status", "--porcelain", "--", ...ownedFiles]),
  capture("findmnt", ["-T", evidence, "-o", "TARGET,SOURCE,FSTYPE,OPTIONS"]),
  capture("df", ["-h", scratch]),
]);

const environment = {
  profile,
  startedAt: new Date().toISOString(),
  command: `node --import tsx scripts/qualify-cache-growth.mts --profile ${profile}`,
  node: process.version,
  versions: process.versions,
  platform: process.platform,
  arch: process.arch,
  cpus: cpus().length,
  totalMemBytes: totalmem(),
  freeMemBytesAtStart: freemem(),
  repositoryRoot: repo,
  gitHead: head.code === 0 ? head.stdout.trim() : `unavailable (exit ${head.code})`,
  gitBranch: branch.code === 0 ? branch.stdout.trim() : `unavailable (exit ${branch.code})`,
  ownedFilesStatus: dirty.code === 0 ? dirty.stdout.trim() : `unavailable (exit ${dirty.code})`,
  evidenceMount: mount.code === 0 ? mount.stdout.trim() : `unavailable (exit ${mount.code})`,
  scratchDisk: disk.code === 0 ? disk.stdout.trim() : `unavailable (exit ${disk.code})`,
  plan,
  note: "Single-host observations on the recorded mount. Byte counts are filesystem sizes; elapsed values are wall-clock milliseconds. No heap cap, latency promise or unsupported-platform claim follows from them.",
};
const environmentBytes = JSON.stringify(environment, null, 2);
await writeFile(join(evidence, "environment.json"), environmentBytes);

process.stdout.write(
  [
    `profile: ${profile}`,
    `evidence: ${evidence}`,
    `git head: ${environment.gitHead}`,
    `mount: ${environment.evidenceMount.replace(/\n/g, " | ")}`,
    "",
    "running the qualification suite (full profile reaches the real ceilings; this takes minutes)...",
    "",
  ].join("\n"),
);

const child = spawn(
  process.execPath,
  ["--import", "tsx", "--test", "test/cache-growth-qualification.test.ts"],
  {
    cwd: repo,
    env: { ...process.env, INTELLI_GROWTH_PROFILE: profile, INTELLI_GROWTH_EVIDENCE: evidence },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let tapOutput = "";
child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
  tapOutput += chunk;
  process.stdout.write(chunk);
});
child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
  tapOutput += chunk;
  process.stderr.write(chunk);
});
const exit = await new Promise<number | null>((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code) => resolve(code));
});
await writeFile(join(evidence, "tap-output.txt"), tapOutput);

const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
let summaryText: string | undefined;
try {
  summaryText = await readFile(join(evidence, "summary.json"), "utf8");
} catch {
  summaryText = undefined;
}
process.stdout.write(
  [
    "",
    `test exit code: ${exit ?? "null"}`,
    `environment.json sha256: ${hash(environmentBytes)}`,
    summaryText
      ? `summary.json sha256: ${hash(summaryText)}`
      : "summary.json was not written (the suite did not finish its after() hook)",
    `evidence directory: ${evidence}`,
    "Raw observations: observations.ndjson in the evidence directory.",
    "This run is qualification evidence on one host; it is not a release, live or platform claim.",
  ].join("\n") + "\n",
);
process.exitCode = exit ?? 1;
