// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { describe, it } from "node:test";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: repo, encoding: "utf8" }).trim();

function fixture(run: (root: string, check: (...args: string[]) => ReturnType<typeof spawnSync>) => void) {
  const root = mkdtempSync(join(tmpdir(), "f7-plan-"));
  try {
    cpSync(join(repo, "docs"), join(root, "docs"), {
      recursive: true,
      filter: (path) => !path.includes("/images/"),
    });
    mkdirSync(join(root, "scripts"));
    cpSync(join(repo, "scripts/check-codemode-plan.mjs"), join(root, "scripts/check-codemode-plan.mjs"));
    run(root, (...args) => spawnSync(process.execPath, ["scripts/check-codemode-plan.mjs", ...args], {
      cwd: root,
      env: { ...process.env, GIT_DIR: gitDir, GIT_WORK_TREE: repo },
      encoding: "utf8",
    }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function mutate(root: string, path: string, change: (text: string) => string) {
  const file = join(root, path);
  writeFileSync(file, change(readFileSync(file, "utf8")));
}

function failure(result: ReturnType<typeof spawnSync>, pattern: RegExp) {
  assert.notEqual(result.status, 0);
  assert.match(String(result.stderr), pattern);
}

describe("F7 specification revision authority", () => {
  it("retains diagnostic validation while strict acceptance rejects a pending revision", () => fixture((root, check) => {
    const diagnostic = check();
    assert.equal(diagnostic.status, 0, String(diagnostic.stderr));
    mutate(root, "docs/plans/codemode/acceptance.json", (text) => {
      const value = JSON.parse(text);
      value.status = "pending";
      value.coordinatorAccepted = false;
      return JSON.stringify(value);
    });
    failure(check("--require-accepted"), /pending/);
  }));

  it("rejects changing original corpus inputs even after deliberate manifest regeneration", () => fixture((root, check) => {
    mutate(root, "docs/benchmarks/corpus/codemode.json", (text) => text.replace('"query": "', '"query": "changed '));
    failure(check("--write-manifest"), /Outside F7 scope|P0-2|Corpus\/method/);
  }));

  it("rejects historical acceptance replacement", () => fixture((root, check) => {
    mutate(root, "docs/plans/codemode/history/P0-2/acceptance.json", (text) => `${text} `);
    failure(check(), /P0-2 acceptance snapshot changed/);
  }));

  it("rejects an amended method without its exact authority digest", () => fixture((root, check) => {
    mutate(root, "docs/benchmarks/codemode/METHOD-F7-1.md", (text) => `${text}\nAltered method.\n`);
    failure(check(), /sha256|deep-equal/);
  }));

  it("rejects method/specification precedence drift", () => fixture((root, check) => {
    mutate(root, "docs/benchmarks/codemode/method-authority-F7-1.json", (text) => text.replace("P0-3-F7", "P0-2"));
    failure(check(), /P0-3-F7|deep-equal/);
  }));

  it("rejects F7 normative content drift without a regenerated specification manifest", () => fixture((root, check) => {
    mutate(root, "docs/plans/codemode/F7-REPLAY.md", (text) => `${text}\nAltered authority.\n`);
    failure(check(), /Candidate specification hash drift/);
  }));
});
