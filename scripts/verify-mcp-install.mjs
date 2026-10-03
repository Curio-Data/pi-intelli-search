// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const scratch = join(root, ".tmp/mcp-install");
await mkdir(scratch, { recursive: true });
const dir = await mkdtemp(join(scratch, "fresh-"));
const env = {
  PATH: process.env.PATH,
  HOME: join(dir, "home"),
  TMPDIR: dir,
  PI_CODING_AGENT_DIR: join(dir, "forbidden-agent"),
};
await mkdir(env.HOME);
async function run(command, args, cwd = dir, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd,
    env: { ...env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (data) => {
    stdout += data;
  });
  child.stderr.on("data", (data) => {
    stderr += data;
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 180_000);
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  clearTimeout(timer);
  if (code !== 0)
    throw new Error(`${command} ${args.join(" ")} failed (${code})\n${stdout}\n${stderr}`);
  return { stdout, stderr };
}
try {
  await run("npm", ["run", "build:mcp"], root);
  const packed = JSON.parse(
    (
      await run(
        "npm",
        [
          "pack",
          "--workspace",
          "@curio-data/mcp-intelli-search",
          "--ignore-scripts",
          "--json",
          "--pack-destination",
          dir,
        ],
        root,
      )
    ).stdout,
  )[0];
  const names = packed.files.map((entry) => entry.path);
  for (const name of [
    "dist/cli.js",
    "dist/runtime.js",
    "README.md",
    "LICENSE",
    "NOTICE",
    "package.json",
  ])
    assert(names.includes(name), `Missing packed file: ${name}`);
  assert(!names.some((name) => /^(src|test|node_modules)\//.test(name)));
  await writeFile(join(dir, "package.json"), JSON.stringify({ private: true, type: "module" }));
  await run("npm", [
    "install",
    "--prefix",
    dir,
    "--workspaces=false",
    "--omit=dev",
    "--no-audit",
    "--no-fund",
    join(dir, packed.filename),
  ]);
  const pkg = join(dir, "node_modules/@curio-data/mcp-intelli-search");
  assert.equal(await realpath(pkg), pkg, "installed package must not be a workspace link");
  const manifest = JSON.parse(await readFile(join(pkg, "package.json"), "utf8"));
  const lock = JSON.parse(await readFile(join(dir, "package-lock.json"), "utf8"));
  assert(
    !Object.keys(lock.packages).some((name) =>
      /(?:pi-intelli-search|pi-ai|pi-coding-agent|pi-tui|node_modules\/(?:tsx|typescript|esbuild)$)/.test(
        name,
      ),
    ),
    "host/development dependencies leaked into standalone installation",
  );
  // Scratch stays on the encrypted mount. Deny *all* ancestor resolution in both
  // module systems so proximity to the checkout cannot mask missing dependencies.
  await writeFile(
    join(dir, "isolation-loader.mjs"),
    `
    import { fileURLToPath } from 'node:url';
    import { realpathSync } from 'node:fs';
    const root = ${JSON.stringify(dir + sep)};
    export async function resolve(specifier, context, nextResolve) {
      const result = await nextResolve(specifier, context);
      if (result.url.startsWith('file:') && !realpathSync(fileURLToPath(result.url)).startsWith(root)) throw new Error('Outside independent installation: ' + specifier);
      return result;
    }
  `,
  );
  await writeFile(
    join(dir, "isolation.mjs"),
    `
    import Module, { register } from 'node:module';
    import { realpathSync } from 'node:fs';
    import { isAbsolute } from 'node:path';
    register('./isolation-loader.mjs', import.meta.url);
    const original = Module._resolveFilename;
    Module._resolveFilename = function(...args) {
      const result = original.apply(this, args);
      if (isAbsolute(result) && !realpathSync(result).startsWith(${JSON.stringify(dir + sep)})) throw new Error('Outside independent installation: ' + args[0]);
      return result;
    };
  `,
  );
  const cli = join(dir, "node_modules/.bin/mcp-intelli-search");
  const isolated = { NODE_OPTIONS: `--import=${join(dir, "isolation.mjs")}` };
  const help = await run(cli, ["--help"], dir, isolated);
  assert.match(help.stdout, /--config/);
  assert.equal(help.stderr, "");
  assert.equal((await run(cli, ["--version"], dir, isolated)).stdout.trim(), manifest.version);
  await copyFile(join(root, "test/probes/mcp-install.mjs"), join(dir, "probe.mjs"));
  const result = await run(process.execPath, ["probe.mjs"], dir, isolated);
  assert.equal(result.stderr, "", "installed runtime emitted unexpected diagnostics");
  const evidence = JSON.parse(result.stdout);
  assert.equal(evidence.outcome, "completed");
  assert(!(await readdir(dir)).includes("forbidden-agent"));
  console.log(
    JSON.stringify(
      {
        artifact: packed.filename,
        shasum: packed.shasum,
        node: process.version,
        platform: `${process.platform}/${process.arch}`,
        ...evidence,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
