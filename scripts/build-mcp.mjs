// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { build } from "esbuild";
import { access, chmod, copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = join(root, "packages/mcp");
const manifest = JSON.parse(await readFile(join(pkg, "package.json"), "utf8"));
await rm(join(pkg, "dist"), { recursive: true, force: true });
await mkdir(join(pkg, "dist"), { recursive: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: {
    cli: "packages/mcp/src/cli.ts",
    runtime: "packages/mcp/src/runtime.ts",
    server: "packages/mcp/src/server.ts",
  },
  outdir: "packages/mcp/dist",
  bundle: true,
  platform: "node",
  format: "esm",
  splitting: true,
  target: "node22",
  packages: "external",
  metafile: true,
  sourcemap: false,
});
// Hoisting must never conceal an undeclared runtime dependency or a host import.
for (const path of Object.keys(result.metafile.inputs)) {
  if (!path.startsWith("src/core/") && !path.startsWith("packages/mcp/src/"))
    throw new Error(`Unexpected bundle input: ${path}`);
}
for (const output of Object.values(result.metafile.outputs))
  for (const dependency of output.imports) {
    if (!dependency.external || dependency.path.startsWith("node:")) continue;
    const name = dependency.path.startsWith("@")
      ? dependency.path.split("/").slice(0, 2).join("/")
      : dependency.path.split("/")[0];
    if (!Object.hasOwn(manifest.dependencies, name))
      throw new Error(`Undeclared MCP runtime dependency: ${name}`);
  }
// Native addons stay external: their prebuild lookup is module-relative, and the
// input check above already rejects any bundled node_modules file. Both
// manifests pin them exactly, and every package in their lockfile runtime
// closure carries a permissive licence file for the legal inventory.
const nativeExternal = { "fs-native-extensions": "1.5.1" };
const rootManifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const lockfile = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
const closure = new Set();
const queue = [];
for (const [name, version] of Object.entries(nativeExternal)) {
  for (const [label, dependencies] of [
    ["native", rootManifest.dependencies],
    ["standalone", manifest.dependencies],
  ])
    if (dependencies?.[name] !== version)
      throw new Error(`The ${label} manifest must pin ${name} exactly to ${version}`);
  queue.push(name);
}
while (queue.length > 0) {
  const name = queue.shift();
  if (closure.has(name)) continue;
  closure.add(name);
  const entry = lockfile.packages[`node_modules/${name}`];
  if (!entry) throw new Error(`Native dependency ${name} is missing from package-lock.json`);
  if (!["Apache-2.0", "MIT", "ISC"].includes(entry.license))
    throw new Error(`Native dependency ${name} has unreviewed licence ${entry.license}`);
  await access(join(root, "node_modules", name, "LICENSE"));
  queue.push(...Object.keys(entry.dependencies ?? {}));
}
await chmod(join(pkg, "dist/cli.js"), 0o755);
for (const file of ["LICENSE", "NOTICE"]) await copyFile(join(root, file), join(pkg, file));
console.log("Built standalone CLI, runtime and server with declared external dependencies");
