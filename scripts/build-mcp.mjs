// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { build } from "esbuild";
import { chmod, copyFile, mkdir, readFile, rm } from "node:fs/promises";
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
await chmod(join(pkg, "dist/cli.js"), 0o755);
for (const file of ["LICENSE", "NOTICE"]) await copyFile(join(root, file), join(pkg, file));
console.log("Built standalone CLI, runtime and server with declared external dependencies");
