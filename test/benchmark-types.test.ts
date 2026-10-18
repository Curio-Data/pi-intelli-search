// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { REPO_ROOT } from "../scripts/benchmarks/testing.js";

// Type-proof gate (review M4): the assignability proofs in
// scripts/benchmarks/contracts.ts (mirrored types against the frozen P0-2
// declarations AND the actual function implementations against the frozen
// signatures) are compile-time facts. tsx strips types during npm test, so
// this test invokes the TypeScript compiler on the benchmark config directly
// and fails the suite when any proof drifts. The config is noEmit: this gate
// writes nothing.
describe("benchmark type proofs compile (frozen API assignability)", () => {
  it("typechecks scripts/benchmarks against the frozen declarations with zero diagnostics", async () => {
    const tsc = join(REPO_ROOT, "node_modules", "typescript", "bin", "tsc");
    await access(tsc);
    const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
      execFile(
        process.execPath,
        [tsc, "-p", join(REPO_ROOT, "scripts", "benchmarks", "tsconfig.json")],
        { cwd: REPO_ROOT, maxBuffer: 16 * 1024 * 1024, env: process.env },
        (error, stdout, stderr) => {
          if (error !== null && typeof (error as { code?: unknown }).code !== "number") {
            reject(error);
            return;
          }
          resolve({
            code: (error as { code?: number } | null)?.code ?? 0,
            stdout: String(stdout),
            stderr: String(stderr),
          });
        },
      );
    });
    assert.equal(result.code, 0, `tsc must exit 0; diagnostics:\\n${result.stdout}${result.stderr}`);
    assert.equal(result.stdout.trim(), "", `tsc diagnostics must be empty, got:\\n${result.stdout}`);
    assert.equal(result.stderr.trim(), "", `tsc must not write to stderr:\\n${result.stderr}`);
  });
});
