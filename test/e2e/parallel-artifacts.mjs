// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, copyFile, cp, lstat, mkdir, readFile, readdir, readlink, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { supervise, writeJsonExclusive } from "./parallel-supervisor.mjs";

export async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function inside(root, path) {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && rel !== ".." && !isAbsolute(rel));
}

/** Hash every regular file and every internal symlink, including install lockfiles. */
export async function inventoryTree(root, { requireReadOnly = false } = {}) {
  root = await realpath(root);
  const records = [];
  async function visit(path) {
    const stat = await lstat(path);
    const name = relative(root, path) || ".";
    if (stat.isSymbolicLink()) {
      const target = await readlink(path);
      if (!inside(root, await realpath(path))) throw new Error(`Artefact symlink escapes snapshot: ${name}`);
      records.push({ path: name, type: "link", target });
    } else if (stat.isDirectory()) {
      if (requireReadOnly && (stat.mode & 0o222)) throw new Error(`Writable artefact directory: ${name}`);
      records.push({ path: name, type: "directory", mode: stat.mode & 0o777 });
      for (const child of (await readdir(path)).sort()) await visit(join(path, child));
    } else if (stat.isFile()) {
      if (requireReadOnly && (stat.mode & 0o222)) throw new Error(`Writable artefact file: ${name}`);
      records.push({ path: name, type: "file", mode: stat.mode & 0o777, size: stat.size, sha256: await hashFile(path) });
    } else throw new Error(`Unsupported artefact file type: ${name}`);
  }
  await visit(root);
  return records;
}

export async function freezeTree(root) {
  const stat = await lstat(root);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) for (const name of await readdir(root)) await freezeTree(join(root, name));
  await chmod(root, stat.mode & ~0o222);
}

export async function sealArtifacts(root, manifestPath) {
  // Reject escaping/dangling symlinks before changing any modes.
  await inventoryTree(root);
  await freezeTree(root);
  const entries = await inventoryTree(root, { requireReadOnly: true });
  const digest = createHash("sha256").update(JSON.stringify(entries)).digest("hex");
  const manifest = { schemaVersion: 1, algorithm: "sha256", digest, entries };
  await writeJsonExclusive(manifestPath, manifest);
  await chmod(manifestPath, 0o400);
  return manifest;
}

export async function verifyArtifacts(root, manifest) {
  const entries = await inventoryTree(root, { requireReadOnly: true });
  const digest = createHash("sha256").update(JSON.stringify(entries)).digest("hex");
  if (digest !== manifest.digest || JSON.stringify(entries) !== JSON.stringify(manifest.entries))
    throw new Error("Frozen artefact integrity mismatch");
  return digest;
}

export async function verifyEntrypoints(root, paths) {
  const physicalRoot = await realpath(root);
  for (const path of paths) {
    if (!inside(physicalRoot, await realpath(path)) || !(await lstat(await realpath(path))).isFile())
      throw new Error(`Entrypoint outside artefacts or not a regular file: ${path}`);
    if ((await lstat(await realpath(path))).size === 0) throw new Error(`Empty entrypoint: ${path}`);
  }
}

/** One install for each dependency graph, never one install per test unit.
 * Prepacked release inputs are mandatory: this runner neither builds nor packs a moving checkout.
 */
export async function prepareArtifacts({ root, repo, provenance, nativeTarball, mcpTarball,
  nativeSha256, mcpSha256, currentVersion = "1.5.0", floorVersion = "0.86.0", env, signal }) {
  for (const version of [currentVersion, floorVersion])
    if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error("Host versions must be exact pins");
  const artifacts = join(root, "artefacts");
  await mkdir(artifacts, { mode: 0o700 });
  const inputs = [];
  for (const [name, source, expected] of [["native", nativeTarball, nativeSha256], ["mcp", mcpTarball, mcpSha256]]) {
    if (!source || !/^[a-f0-9]{64}$/.test(expected ?? ""))
      throw new Error(`${name} tarball and its expected SHA-256 are required`);
    const before = await hashFile(source);
    if (before !== expected) throw new Error(`${name} input tarball hash mismatch`);
    const target = join(artifacts, `${name}.tgz`);
    await copyFile(source, target);
    if (await hashFile(target) !== expected || await hashFile(source) !== expected)
      throw new Error(`${name} tarball changed during preparation`);
    inputs.push({ name, sha256: expected });
  }
  const tools = join(artifacts, "bin");
  await mkdir(tools);
  const nodeBin = join(tools, "node");
  const nodeHash = await hashFile(process.execPath);
  await copyFile(process.execPath, nodeBin);
  if (await hashFile(nodeBin) !== nodeHash || await hashFile(process.execPath) !== nodeHash)
    throw new Error("Node executable changed during preparation");
  let step = 0;
  const run = async (command, args, cwd) => {
    const receipt = await supervise({ command, args, cwd, env: { ...env, PATH: `${tools}:${env.PATH ?? "/usr/bin:/bin"}` }, signal, timeoutMs: 600_000,
      logPath: join(root, `prepare-${++step}.log`) });
    if (!receipt.settled) {
      const error = new Error("Preparation did not settle; no worker or account snapshot is permitted");
      error.unsettled = true;
      try { await writeJsonExclusive(join(root, `prepare-${step}.json`), receipt); }
      catch (writeError) { error.receiptWriteError = writeError.message; }
      throw error;
    }
    await writeJsonExclusive(join(root, `prepare-${step}.json`), receipt);
    if (receipt.outcome !== "passed") throw new Error(`Preparation step ${step} failed (${receipt.outcome})`);
  };
  await run(nodeBin, ["--version"], artifacts);
  const installs = {};
  for (const [name, version] of [["native", currentVersion], ["mcp", null], ["floor", floorVersion]]) {
    const dir = join(artifacts, name);
    installs[name] = dir;
    await mkdir(dir);
    // No ancestor workspace resolution and no install-time scripts. Native fetch assets ship in tarballs.
    const dependencies = name === "mcp" ? { "@curio-data/mcp-intelli-search": "file:../mcp.tgz" } : {
      "@curio-data/pi-intelli-search": "file:../native.tgz",
      "@earendil-works/pi-coding-agent": version,
      "@earendil-works/pi-ai": version,
      "@earendil-works/pi-tui": version,
    };
    await writeJsonExclusive(join(dir, "package.json"), { private: true, type: "module", dependencies });
    await run("npm", ["install", "--prefix", dir, "--workspaces=false", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], dir);
  }
  const extension = (dir) => join(dir, "node_modules/@curio-data/pi-intelli-search/dist/index.js");
  const host = (dir) => join(dir, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
  const paths = {
    nodeBin,
    extension: extension(installs.native), floorExtension: extension(installs.floor),
    currentBin: join(installs.native, "node_modules/.bin/pi"),
    floorBin: join(installs.floor, "node_modules/.bin/pi"),
    mcpCli: join(installs.mcp, "node_modules/@curio-data/mcp-intelli-search/dist/cli.js"),
    mcpTarball: join(artifacts, "mcp.tgz"),
  };
  await verifyEntrypoints(artifacts, [...Object.values(paths), host(installs.native), host(installs.floor)]);
  for (const name of ["native", "floor"]) {
    const dir = installs[name];
    const expectedVersion = name === "native" ? currentVersion : floorVersion;
    for (const peer of ["pi-coding-agent", "pi-ai", "pi-tui"]) {
      const packagePath = join(dir, `node_modules/@earendil-works/${peer}/package.json`);
      if (JSON.parse(await readFile(packagePath, "utf8")).version !== expectedVersion)
        throw new Error(`Installed ${name} ${peer} version does not match pin`);
    }
    // Import the complete statically imported native graph and native fetch asset without model calls.
    await run(nodeBin, ["--input-type=module", "-e",
      'await import(process.argv[1]); const w = await import("wreq-js"); if (typeof w.fetch !== "function") throw Error("Missing native fetch export");',
      extension(dir)], join(dir, "node_modules/@curio-data/pi-intelli-search"));
    await run(nodeBin, [host(dir), "--version"], dir);
  }
  await run(nodeBin, [paths.mcpCli, "--help"], installs.mcp);
  await run(nodeBin, ["--input-type=module", "-e", 'await import("wreq-js");'],
    join(installs.mcp, "node_modules/@curio-data/mcp-intelli-search"));

  // Freeze the scenario/helper and generator inputs too. No worker reads a changing dist or .env.
  const harness = join(artifacts, "harness");
  await mkdir(harness);
  for (const entry of ["test/e2e", "scripts/generate-plugin-bundles.mjs", "scripts/lib", "guidance"])
    await cp(join(repo, entry), join(harness, entry), { recursive: true, dereference: false, errorOnExist: true });
  for (const [from, to] of [
    [join(installs.native, "node_modules/@curio-data/pi-intelli-search/package.json"), join(harness, "package.json")],
    [join(installs.mcp, "node_modules/@curio-data/mcp-intelli-search/package.json"), join(harness, "packages/mcp/package.json")],
  ]) { await mkdir(dirname(to), { recursive: true }); await copyFile(from, to); }
  paths.harness = harness;
  paths.traceExtension = join(harness, "test/e2e/trace-extension.mjs");
  paths.traceFetch = join(harness, "test/e2e/trace-fetch.mjs");
  await verifyEntrypoints(artifacts, [paths.traceExtension, paths.traceFetch]);
  await writeFile(join(artifacts, "preparation.json"), `${JSON.stringify({ inputs, provenance, currentVersion, floorVersion, nodeVersion: process.version, nodeHash, paths }, null, 2)}\n`);
  const manifest = await sealArtifacts(artifacts, join(root, "artefact-manifest.json"));
  return { root: artifacts, paths, manifest };
}
