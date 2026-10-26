// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { document, fixture } from "./helpers.js";
import { identity } from "../src/identity.js";
const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
function invoke(args: string[], env: NodeJS.ProcessEnv = {}, cwd = process.cwd()) {
  return spawnSync(process.execPath, ["--import", "tsx", cli, ...args], {
    encoding: "utf8",
    timeout: 10_000,
    cwd,
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
test("CLI paths override environment equivalents and valid setup serves until input closes", async () => {
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
      // spawnSync closes standard input immediately: the server starts, sees
      // end-of-input and exits cleanly without emitting protocol messages.
      const result = invoke(args, env);
      assert.equal(result.status, 0);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /serving stdio/);
      const checked = invoke([...args, "--check-config"], env);
      assert.equal(checked.status, 0);
      assert.equal(checked.stdout, "Configuration is valid.\n");
      assert.equal(checked.stderr, "");
    }
  } finally {
    await f.cleanup();
  }
});
test("Codex mode serves with no configuration, workspace or credential exports", async () => {
  const f = await fixture();
  try {
    const workspace = join(f.dir, "project");
    await mkdir(workspace);
    const result = invoke(
      ["--host", "codex"],
      {
        HOME: f.dir,
        INTELLI_SEARCH_CONFIG: "/nonexistent/legacy.json",
        INTELLI_SEARCH_WORKSPACE: "/nonexistent/legacy-workspace",
      },
      workspace,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /serving stdio/);
    assert.doesNotMatch(result.stderr, /Configuration file not found/);
    const checked = invoke(["--host", "codex", "--check-config"], { HOME: f.dir }, workspace);
    assert.equal(checked.status, 0, checked.stderr);
    assert.equal(
      checked.stdout,
      "Configuration is valid (built-in Codex defaults; no per-user file found).\n",
    );
  } finally {
    await f.cleanup();
  }
});

test("Codex mode serves tool errors for a home workspace and rejects its config check", async () => {
  const f = await fixture();
  try {
    const result = invoke(["--host", "codex"], { HOME: f.dir }, f.dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /serving stdio/);
    const checked = invoke(["--host", "codex", "--check-config"], { HOME: f.dir }, f.dir);
    assert.equal(checked.status, 1);
    assert.match(checked.stderr, /must be a project directory/);
  } finally {
    await f.cleanup();
  }
});

test("CLI rejects unsupported hosts and setup path selections with specific diagnostics", async () => {
  const f = await fixture();
  try {
    const unsupported = invoke(["--host", "claude"]);
    assert.equal(unsupported.status, 1);
    assert.match(unsupported.stderr, /Unsupported host/);
    for (const args of [
      ["setup", "--config", "x"],
      ["setup", "--workspace", "x"],
      ["setup", "--host", "codex"],
      ["setup", "--check-config"],
    ]) {
      const result = invoke(args, { HOME: f.dir }, f.dir);
      assert.equal(result.status, 1, args.join(" "));
      assert.match(result.stderr, /Setup accepts no path selections/);
    }
    const oversized = spawnSync(process.execPath, ["--import", "tsx", cli, "setup"], {
      input: "x".repeat(4099),
      encoding: "utf8",
      timeout: 10_000,
      env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, HOME: f.dir },
    });
    assert.equal(oversized.status, 1);
    assert.match(oversized.stderr, /4096-byte limit/);
  } finally {
    await f.cleanup();
  }
});

test("setup reads the key from stdin without echoing it or writing it into config", async () => {
  const f = await fixture();
  const key = "sk-or-cli-test-only";
  try {
    const result = spawnSync(process.execPath, ["--import", "tsx", cli, "setup"], {
      input: `${key}\n`,
      encoding: "utf8",
      timeout: 10_000,
      env: {
        PATH: process.env.PATH,
        TMPDIR: process.env.TMPDIR,
        HOME: f.dir,
        INTELLI_SEARCH_CONFIG: "/nonexistent/old-config.json",
        INTELLI_SEARCH_WORKSPACE: "/nonexistent/old-workspace",
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert(!result.stdout.includes(key));
    assert(!result.stderr.includes(key));
    const base = join(f.dir, ".config/mcp-intelli-search");
    assert(!(await readFile(join(base, "config.json"), "utf8")).includes(key));
    assert.equal(await readFile(join(base, "openrouter.key"), "utf8"), `${key}\n`);
    assert.equal((await stat(join(base, "openrouter.key"))).mode & 0o777, 0o600);
  } finally {
    await f.cleanup();
  }
});

test("check-config stays strict and distinguishes file defects", async () => {
  const f = await fixture();
  try {
    const file = join(f.dir, "config.json");
    const missing = invoke(["--config", file, "--workspace", f.dir, "--check-config"]);
    assert.equal(missing.status, 1);
    assert.equal(missing.stdout, "");
    assert.match(missing.stderr, /Configuration file not found: /);
    await writeFile(file, '{\n  "providers": {\n    "openrouter": "sk-or-secret"\n  ,\n}');
    const malformed = invoke(["--config", file, "--workspace", f.dir, "--check-config"]);
    assert.equal(malformed.status, 1);
    assert.equal(malformed.stdout, "");
    assert.match(malformed.stderr, /not valid JSON at line 5, column 1/);
    assert(!malformed.stderr.includes("sk-or-secret"));
  } finally {
    await f.cleanup();
  }
});
test("a defective configuration file starts the server; launcher defects stay fatal", async () => {
  const f = await fixture();
  try {
    const file = join(f.dir, "config.json");
    // spawnSync closes standard input at once, so a server that started exits 0.
    const served = invoke(["--config", file, "--workspace", f.dir]);
    assert.equal(served.status, 0);
    assert.equal(served.stdout, "");
    assert.match(served.stderr, /Configuration file not found: .*Serving anyway/);
    assert.match(served.stderr, /serving stdio/);
    for (const args of [
      ["--config", file],
      ["--config", file, "--workspace", join(f.dir, "absent")],
      ["--config", file, "--workspace", "relative"],
    ]) {
      const failed = invoke(args);
      assert.equal(failed.status, 1, args.join(" "));
      assert.equal(failed.stdout, "");
      assert.doesNotMatch(failed.stderr, /serving stdio/);
    }
  } finally {
    await f.cleanup();
  }
});
