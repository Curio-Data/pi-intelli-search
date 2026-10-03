// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { document, fixture } from "./helpers.js";
import { identity } from "../src/identity.js";
const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
function invoke(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, ["--import", "tsx", cli, ...args], {
    encoding: "utf8",
    timeout: 10_000,
    env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, ...env },
  });
}
test("help/version are independent of configuration and credentials", () => {
  const help = invoke(["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--config/);
  assert.match(help.stdout, /--workspace/);
  assert.match(help.stdout, /--check-config/);
  assert.equal(help.stderr, "");
  const version = invoke(["--version"]);
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), identity.version);
  assert.equal(version.stderr, "");
});
test("CLI rejects invalid options without echoing values and requires explicit paths", () => {
  for (const args of [[], ["--unknown", "secret"], ["--config"], ["secret"]]) {
    const result = invoke(args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert(!result.stderr.includes("secret"));
  }
});
test("CLI paths override environment equivalents and valid setup does not start a premature server", async () => {
  const f = await fixture();
  try {
    const file = join(f.dir, "config.json");
    await writeFile(file, JSON.stringify(document()));
    for (const [args, env] of [
      [[], { INTELLI_SEARCH_CONFIG: file, INTELLI_SEARCH_WORKSPACE: f.dir }],
      [
        ["--config", file, "--workspace", f.dir],
        { INTELLI_SEARCH_CONFIG: "/nonexistent", INTELLI_SEARCH_WORKSPACE: "/nonexistent" },
      ],
    ] as [string[], NodeJS.ProcessEnv][]) {
      const result = invoke(args, env);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /MCP protocol serving is not implemented/);
      const checked = invoke([...args, "--check-config"], env);
      assert.equal(checked.status, 0);
      assert.equal(checked.stdout, "Configuration is valid.\n");
      assert.equal(checked.stderr, "");
    }
  } finally {
    await f.cleanup();
  }
});
