// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Credential-free native floor qualification.
//
//   node --import tsx scripts/qualify-native-floor.mts install
//   node --import tsx scripts/qualify-native-floor.mts run
//
// `install` places the exact manifest floor host (the single `>=X.Y.Z` of the
// `Pi` peers) in .tmp/m4-floor/host/<version>/ with a private HOME, TMPDIR and
// npm cache below the repository, verifies the installed versions and writes
// provenance.json beside it. It downloads registry packages only; install
// scripts are not run. `run` executes test/native-floor-qualification.test.ts
// against that install with private HOME/agent/TMPDIR and every API key
// variable removed. Neither command makes an inference or page request.

import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { REPO_ROOT } from "../test/helpers/native-replay.js";
import { floorInstallDir, manifestFloor } from "../test/helpers/native-floor-qualification.js";

const scratch = join(REPO_ROOT, ".tmp/m4-floor");
const privateDirs = { HOME: join(scratch, "home"), TMPDIR: join(scratch, "tmp"), npm_config_cache: join(scratch, "npm-cache") };

function privateEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...privateDirs, ...extra };
  for (const key of Object.keys(env))
    if (/(?:API_KEY|AUTH_TOKEN|OAUTH_TOKEN)$/.test(key)) delete env[key];
  return env;
}

const readVersion = async (root: string) =>
  (JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { version: string }).version;

async function install(): Promise<void> {
  const version = await manifestFloor();
  const dir = floorInstallDir(version);
  for (const path of [dir, ...Object.values(privateDirs)]) await mkdir(path, { recursive: true });
  await writeFile(join(dir, "package.json"), `${JSON.stringify({ private: true }, null, 2)}\n`);
  const result = spawnSync(
    "npm",
    ["install", "--no-audit", "--no-fund", "--ignore-scripts", `@earendil-works/pi-coding-agent@${version}`],
    { cwd: dir, env: privateEnv(), stdio: "inherit" },
  );
  if (result.status !== 0) throw new Error(`npm install exited ${String(result.status)}`);
  const host = join(dir, "node_modules/@earendil-works/pi-coding-agent");
  const nested = join(host, "node_modules/@earendil-works");
  const versions: Record<string, string> = { "pi-coding-agent": await readVersion(host) };
  for (const name of ["pi-ai", "pi-agent-core", "pi-tui"]) versions[name] = await readVersion(join(nested, name));
  for (const [name, actual] of Object.entries(versions))
    if (actual !== version) throw new Error(`${name} installed ${actual}, manifest floor is ${version}`);
  const lock = JSON.parse(await readFile(join(dir, "package-lock.json"), "utf8")) as {
    packages: Record<string, { version?: string; integrity?: string; resolved?: string }>;
  };
  const integrity = Object.fromEntries(
    Object.entries(lock.packages)
      .filter(([path]) => /@earendil-works\/[^/]+$/.test(path))
      // The floor's shrinkwrap pins nested `Pi` packages by URL without an
      // integrity hash; record that absence rather than inventing one.
      .map(([path, entry]) => [path, { version: entry.version, integrity: entry.integrity ?? null, resolved: entry.resolved }]),
  );
  await writeFile(
    join(dir, "provenance.json"),
    `${JSON.stringify({ manifestFloor: version, versions, integrity, node: process.version, installedAt: new Date().toISOString(), installScripts: "not run" }, null, 2)}\n`,
  );
  console.log(`Floor Pi ${version} installed at ${host}`);
}

function run(): void {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", "test/native-floor-qualification.test.ts"],
    {
      cwd: REPO_ROOT,
      env: privateEnv({ PI_CODING_AGENT_DIR: join(scratch, "agent") }),
      stdio: "inherit",
    },
  );
  process.exitCode = result.status ?? 1;
}

const command = process.argv[2];
if (command === "install") await install();
else if (command === "run") run();
else {
  console.error("usage: qualify-native-floor.mts install|run");
  process.exitCode = 2;
}
