// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, symlink, writeFile, link, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parseConfig, loadConfig, ConfigurationError } from "../src/config.js";
import { createRuntime } from "../src/runtime.js";
import { workspacePaths } from "../src/workspace.js";
import { document, fixture } from "./helpers.js";

test("configuration is explicit, canonical, deeply frozen and credential-free", async () => {
  const f = await fixture();
  try {
    const cfg = await parseConfig(document(), f.dir);
    assert.equal(cfg.workspace, f.dir);
    assert.equal(cfg.settings.defaultUrls, 10);
    assert(Object.isFrozen(cfg.settings.searchWebSearch));
    assert(Object.isFrozen(cfg.settings.searchModel));
    assert.equal(cfg.settings.httpProxy, undefined);
    const runtime = await createRuntime(cfg, { env: {} });
    await assert.rejects(runtime.execute("intelli_search", { query: "test" }), /FIXTURE_KEY/);
    assert.deepEqual(await readdir(f.dir), []);
  } finally {
    await f.cleanup();
  }
});

test("rejects missing selections, unknown fields and unsafe tuning without echoing values", async () => {
  const f = await fixture();
  try {
    const cases: unknown[] = [
      null,
      {},
      { ...document(), workspace: f.dir },
      { ...document(), providers: { openrouter: { apiKey: "secret" } } },
      { ...document(), providers: { openrouter: { apiKeyEnv: "secret-value" } } },
      {
        ...document(),
        models: { ...document().models, extract: { provider: "other", model: "fixture/extract" } },
      },
      { ...document(), models: { ...document().models, collate: undefined } },
    ];
    for (const tuning of [
      { cacheDir: "../escape" },
      { cacheDir: "/outside" },
      { cacheDir: "x/../x" },
      { cacheDir: "x\\outside" },
      { cacheDir: "." },
      { maxUrls: 0 },
      { defaultUrls: 21 },
      { llmTimeoutMs: 0 },
      { fetchConcurrency: 1.1 },
      { disableTelemetry: "true" },
      { httpProxy: "secret" },
      { searchWebSearch: { enabled: true, engine: "unknown" } },
      { searchWebSearch: { enabled: true, secret: "secret" } },
    ])
      cases.push({ ...document(), tuning });
    for (const value of cases)
      await assert.rejects(
        parseConfig(value, f.dir),
        (error: Error) => !error.message.includes("secret"),
      );
    await assert.rejects(parseConfig(document(), "."), /absolute/);
    await assert.rejects(loadConfig(join(f.dir, "missing.json"), f.dir), /not found/);
    const bad = join(f.dir, "bad.json");
    await writeFile(bad, '{"secret":');
    await assert.rejects(
      loadConfig(bad, f.dir),
      (error: Error) => !error.message.includes("secret"),
    );
  } finally {
    await f.cleanup();
  }
});

test("configuration file defects are distinct, located and never quote the file body", async () => {
  const f = await fixture();
  try {
    const file = join(f.dir, "config.json");
    const reject = async (reason: string, pattern: RegExp) => {
      await assert.rejects(loadConfig(file, f.dir), (error: unknown) => {
        assert(error instanceof ConfigurationError);
        assert.equal(error.reason, reason);
        assert.match(error.message, pattern);
        assert(error.message.includes(file), "names the selected file");
        assert(!error.message.includes("sk-or-"), "never quotes the body");
        return true;
      });
    };
    await reject("missing", /^Configuration file not found: /);
    await mkdir(file);
    await reject("unreadable", /is a directory/);
    await rm(file, { recursive: true });
    await writeFile(file, "");
    await reject("invalid-json", /is empty/);
    // V8 reports a position for this defect: line 3, column 3.
    await writeFile(file, '{\n  "providers": {},\n  sk-or-unquoted: 1\n}');
    await reject("invalid-json", /not valid JSON at line 3, column 3:/);
    // V8 omits the position and quotes the input for an unexpected token.
    await writeFile(file, '{\n  "a":\n    sk-or-bare\n}');
    await reject("invalid-json", /not valid JSON at line 3, column 5:/);
    await writeFile(file, '{\n  "providers": "sk-or-truncated');
    await reject("invalid-json", /end of input \(line 2\)/);
    await writeFile(file, '{\n  "providers": {\n');
    await reject("invalid-json", /end of input \(line 2\); the file is incomplete/);
    await writeFile(file, JSON.stringify({ ...document(), extra: "sk-or-value" }));
    await reject("invalid", /^Invalid configuration in .*: configuration contains an unknown key$/);
    // A byte order mark from a Windows editor is tolerated.
    await writeFile(file, `\uFEFF${JSON.stringify(document())}`);
    assert.equal((await loadConfig(file, f.dir)).apiKeyEnv, "FIXTURE_KEY");
    // An unusable workspace is a launcher defect, not a configuration-file defect.
    await assert.rejects(
      loadConfig(file, join(f.dir, "absent")),
      (error: unknown) => !(error instanceof ConfigurationError) && /workspace/.test(String(error)),
    );
  } finally {
    await f.cleanup();
  }
});

test("cache rejects ancestor, nested, dangling symlinks and hardlinked files", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.dir, "not-directory"), "file");
    await assert.rejects(workspacePaths(f.dir, "not-directory"), /directories/);
    await mkdir(join(f.dir, "staging-file"));
    await writeFile(join(f.dir, "staging-file/.staging"), "file");
    await assert.rejects(workspacePaths(f.dir, "staging-file"), /directories/);
    const outside = join(f.dir, "outside");
    await mkdir(outside);
    await symlink(outside, join(f.dir, "linked"));
    await assert.rejects(workspacePaths(f.dir, "linked/cache"), /links/);
    await symlink(join(f.dir, "missing"), join(f.dir, "dangling"));
    await assert.rejects(workspacePaths(f.dir, "dangling"), /links/);
    await mkdir(join(f.dir, "cache/sources"), { recursive: true });
    await symlink(outside, join(f.dir, "cache/sources/escaped"));
    await assert.rejects(workspacePaths(f.dir, "cache"), /links/);
    await writeFile(join(outside, "file"), "source");
    await mkdir(join(f.dir, "hard"));
    await link(join(outside, "file"), join(f.dir, "hard/file"));
    await assert.rejects(workspacePaths(f.dir, "hard"), /links/);
  } finally {
    await f.cleanup();
  }
});

test("rechecks cache containment at every operation before provider access", async () => {
  const f = await fixture();
  let calls = 0;
  try {
    const runtime = await createRuntime(f.config, {
      env: { FIXTURE_KEY: "fixture-secret" },
      fetch: async () => {
        calls++;
        throw new Error("unexpected");
      },
    });
    await symlink(join(f.dir, "absent"), join(f.dir, ".search"));
    await assert.rejects(runtime.execute("intelli_search", { query: "test" }), /links/);
    assert.equal(calls, 0);
  } finally {
    await f.cleanup();
  }
});
