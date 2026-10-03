// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const repo = fileURLToPath(new URL("../", import.meta.url));

/** Walk type imports and re-exports too, not just executable imports. */
async function auditGraph(
  entry: string,
  declaration = false,
  seen = new Set<string>(),
): Promise<Set<string>> {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const source = await readFile(entry, "utf8");
  const parsed = ts.createSourceFile(entry, source, ts.ScriptTarget.Latest, true);
  const inspect = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      assert.ok(!["getAgentDir", "homedir"].includes(node.text), `${entry}: ${node.text}`);
    }
    if (ts.isPropertyAccessExpression(node) && node.expression.getText(parsed) === "process") {
      assert.ok(!["env", "cwd"].includes(node.name.text), `${entry}: ${node.getText(parsed)}`);
    }
    ts.forEachChild(node, inspect);
  };
  inspect(parsed);
  for (const { fileName } of ts.preProcessFile(source).importedFiles) {
    if (fileName.startsWith("node:")) continue;
    assert.ok(fileName.startsWith("."), `${entry} imports external dependency ${fileName}`);
    const path = resolve(dirname(entry), fileName.replace(/\.js$/, declaration ? ".d.ts" : ".ts"));
    await auditGraph(path, declaration, seen);
  }
  return seen;
}

describe("Phase 1 core dependency boundary", () => {
  it("audits source/declarations and imports emitted code with all package resolution denied", async () => {
    const scratch = join(repo, ".tmp");
    await mkdir(scratch, { recursive: true });
    const temp = await mkdtemp(join(scratch, "core-boundary-"));
    try {
      const entries = [join(repo, "src/core/index.ts"), join(repo, "src/cache.ts")];
      const visited = new Set<string>();
      for (const entry of entries) await auditGraph(entry, false, visited);
      assert.ok(visited.size >= 7, "audit must traverse shared data and helper modules");
      const outDir = join(temp, "emitted");
      const program = ts.createProgram(entries, {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.Node16,
        moduleResolution: ts.ModuleResolutionKind.Node16,
        strict: true,
        skipLibCheck: true,
        declaration: true,
        rootDir: join(repo, "src"),
        outDir,
      });
      const diagnostics = ts.getPreEmitDiagnostics(program);
      assert.equal(
        diagnostics.length,
        0,
        ts.formatDiagnosticsWithColorAndContext(diagnostics, {
          getCanonicalFileName: (path) => path,
          getCurrentDirectory: () => repo,
          getNewLine: () => "\n",
        }),
      );
      assert.equal(program.emit().emitSkipped, false);
      await auditGraph(join(outDir, "core/index.d.ts"), true);
      await auditGraph(join(outDir, "cache.d.ts"), true);
      await writeFile(join(outDir, "package.json"), '{"type":"module"}');
      // Refuse every bare package import and every file outside the emitted tree.
      // Thus parent node_modules cannot accidentally satisfy a host dependency.
      const loader = join(temp, "deny-packages.mjs");
      await writeFile(
        loader,
        `
        import { fileURLToPath } from 'node:url';
        export async function resolve(specifier, context, nextResolve) {
          if (!specifier.startsWith('node:') && !specifier.startsWith('.') && !specifier.startsWith('file:')) {
            throw Object.assign(new Error('Package unavailable: ' + specifier), { code: 'ERR_MODULE_NOT_FOUND' });
          }
          const result = await nextResolve(specifier, context);
          if (result.url.startsWith('file:') && !fileURLToPath(result.url).startsWith(${JSON.stringify(outDir + "/")})) {
            throw new Error('Outside isolated tree: ' + result.url);
          }
          return result;
        }
      `,
      );
      const child = spawnSync(
        process.execPath,
        [
          "--experimental-loader",
          loader,
          "--input-type=module",
          "--eval",
          `
        import assert from 'node:assert/strict';
        for (const pkg of ['@earendil-works/pi-ai', '@earendil-works/pi-coding-agent', '@earendil-works/pi-tui']) {
          await assert.rejects(import(pkg), { code: 'ERR_MODULE_NOT_FOUND' });
        }
        const core = await import('./core/index.js');
        const cache = await import('./cache.js');
        assert.equal(core.resolveWorkspacePaths('/workspace', '.search').cacheRoot, '/workspace/.search');
        assert.equal(core.truncateContent('abc', 2), 'ab\\n\\n[TRUNCATED]');
        assert.deepEqual(core.parseCitations('{}'), []);
        assert.ok(cache.makeCachePath('query', '/workspace', '.search').startsWith('/workspace/.search/'));
        process.stdout.write('isolated core import passed');
      `,
        ],
        { cwd: outDir, encoding: "utf8", timeout: 30_000 },
      );
      assert.equal(child.status, 0, `${child.error ?? ""}\n${child.stderr}`);
      assert.equal(child.stdout, "isolated core import passed");

      const forbidden = join(temp, "forbidden.ts");
      await writeFile(
        forbidden,
        'import type { ExtensionContext } from "@earendil-works/pi-coding-agent";',
      );
      await assert.rejects(auditGraph(forbidden), /imports external dependency/);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
});
