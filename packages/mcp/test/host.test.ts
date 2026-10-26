// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import test from "node:test";
import assert from "node:assert/strict";
import { chmod, link, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { completion, document, fakeTransport, fixture, json } from "./helpers.js";
import { parseConfig } from "../src/config.js";
import { createRuntime } from "../src/runtime.js";
import {
  defaultCodexConfig,
  hostPaths,
  resolveCredential,
  setupHost,
} from "../src/host.js";

const KEY = "sk-or-test-only";

test("Codex defaults select the current workspace and stable per-user files", async () => {
  const f = await fixture();
  try {
    const paths = hostPaths({ HOME: f.dir });
    assert.equal(paths.directory, join(f.dir, ".config/mcp-intelli-search"));
    const config = await defaultCodexConfig(f.dir, paths);
    assert.equal(config.workspace, f.dir);
    assert.equal(config.apiKeyEnv, "OPENROUTER_API_KEY");
    assert.equal(config.apiKeyFile, paths.credential);
    assert.equal(config.settings.searchModel.model, "perplexity/sonar");
    assert.equal(config.settings.extractModel.model, "minimax/minimax-m3");
    const xdg = hostPaths({ HOME: "/unused", XDG_CONFIG_HOME: join(f.dir, "xdg") });
    assert.equal(xdg.directory, join(f.dir, "xdg/mcp-intelli-search"));
    const relative = hostPaths({ HOME: f.dir, XDG_CONFIG_HOME: "relative" });
    assert.equal(relative.directory, paths.directory);
    assert.ok(hostPaths({}).directory.length > 0);
  } finally {
    await f.cleanup();
  }
});

test("setup writes a private credential and preserves existing configuration", async () => {
  const f = await fixture();
  try {
    const paths = await setupHost(`${KEY}\n`, { HOME: f.dir });
    assert.equal(await readFile(paths.credential, "utf8"), `${KEY}\n`);
    assert.equal((await stat(paths.credential)).mode & 0o777, 0o600);
    const initial = await readFile(paths.config, "utf8");
    assert(!initial.includes(KEY));
    await writeFile(paths.config, JSON.stringify(document()));
    await setupHost("sk-or-replacement", { HOME: f.dir });
    const preserved = JSON.parse(await readFile(paths.config, "utf8"));
    assert.deepEqual(preserved.models, document().models);
    assert.deepEqual(preserved.tuning, document().tuning);
    assert.equal(preserved.providers.openrouter.apiKeyFile, paths.credential);
    assert.equal(await readFile(paths.credential, "utf8"), "sk-or-replacement\n");
    assert.equal(await resolveCredential(f.config, {}), undefined);
    const configured = await defaultCodexConfig(f.dir, paths);
    assert.equal(await resolveCredential(configured, {}), "sk-or-replacement");
    assert.equal(
      await resolveCredential(configured, { OPENROUTER_API_KEY: "sk-or-environment" }),
      "sk-or-environment",
    );
  } finally {
    await f.cleanup();
  }
});

test("a stored credential repairs the next call without rebuilding the runtime", async () => {
  const f = await fixture();
  try {
    const paths = hostPaths({ HOME: f.dir });
    const doc = {
      ...document(),
      providers: {
        openrouter: {
          ...document().providers.openrouter,
          apiKeyFile: paths.credential,
        },
      },
    };
    const config = await parseConfig(doc, f.dir);
    let expected = KEY;
    const runtime = await createRuntime(config, {
      env: {},
      fetch: fakeTransport((_body, init) => {
        assert.equal((init.headers as Record<string, string>).Authorization, `Bearer ${expected}`);
        return json(completion("Configured [source](https://example.com)"));
      }),
    });
    await assert.rejects(runtime.execute("intelli_search", { query: "test" }), /setup/);
    await setupHost(KEY, { HOME: f.dir });
    const result = await runtime.execute("intelli_search", { query: "test" });
    assert.match(result.text, /Configured/);
    expected = "sk-or-replacement";
    await setupHost(expected, { HOME: f.dir });
    await runtime.execute("intelli_search", { query: "test" });
  } finally {
    await f.cleanup();
  }
});

test("setup honours a custom credential path in the default configuration", async () => {
  const f = await fixture();
  try {
    const paths = hostPaths({ HOME: f.dir });
    const custom = join(f.dir, "custom-credential", "openrouter.key");
    const doc = {
      ...document(),
      providers: {
        openrouter: { ...document().providers.openrouter, apiKeyFile: custom },
      },
    };
    await mkdir(paths.directory, { recursive: true });
    await writeFile(paths.config, JSON.stringify(doc), { mode: 0o600 });
    const configured = await setupHost(KEY, { HOME: f.dir });
    assert.equal(configured.credential, custom);
    assert.equal(await readFile(custom, "utf8"), `${KEY}\n`);
    assert.equal(JSON.parse(await readFile(paths.config, "utf8")).providers.openrouter.apiKeyFile, custom);
  } finally {
    await f.cleanup();
  }
});

test("setup handles BOM and configured symlink files without leaking malformed content", async () => {
  const f = await fixture();
  try {
    const paths = hostPaths({ HOME: f.dir });
    await mkdir(paths.directory, { recursive: true });
    await writeFile(paths.config, "{\"secret\":");
    await assert.rejects(setupHost(KEY, { HOME: f.dir }), (error: Error) => {
      assert(!error.message.includes("secret"));
      assert.match(error.message, /not valid JSON/);
      return true;
    });
    await writeFile(paths.config, `\uFEFF${JSON.stringify(document())}`);
    await setupHost(KEY, { HOME: f.dir });
    assert.equal(await readFile(paths.credential, "utf8"), `${KEY}\n`);

    const custom = join(f.dir, "linked-credential");
    const doc = {
      ...document(),
      providers: {
        openrouter: { ...document().providers.openrouter, apiKeyFile: custom },
      },
    };
    const actual = join(f.dir, "actual-config.json");
    await writeFile(actual, JSON.stringify(doc));
    await rm(paths.config, { force: true });
    await symlink(actual, paths.config);
    const linked = await setupHost("sk-or-linked", { HOME: f.dir });
    assert.equal(linked.credential, custom);
    assert.equal(await readFile(custom, "utf8"), "sk-or-linked\n");
  } finally {
    await f.cleanup();
  }
});

test("credential files fail closed on unsafe metadata and contents", async () => {
  const f = await fixture();
  try {
    const paths = await setupHost(KEY, { HOME: f.dir });
    const config = await defaultCodexConfig(f.dir, paths);
    if (process.platform !== "win32") {
      await chmod(paths.credential, 0o644);
      await assert.rejects(resolveCredential(config, {}), /inaccessible to group and other users/);
      await chmod(paths.credential, 0o600);
    }
    const linkedPath = join(f.dir, "credential-link");
    await symlink(paths.credential, linkedPath);
    await assert.rejects(
      resolveCredential({ ...config, apiKeyFile: linkedPath }, {}),
      /regular, non-linked file/,
    );
    const hardlink = join(f.dir, "credential-hardlink");
    await link(paths.credential, hardlink);
    await assert.rejects(resolveCredential(config, {}), /regular, non-linked file/);
    await rm(hardlink);
    await writeFile(paths.credential, "two values\n", { mode: 0o600 });
    await assert.rejects(resolveCredential(config, {}), /one nonempty line without whitespace/);
    for (const value of ["", "   ", "one\ntwo"]) {
      await assert.rejects(setupHost(value, { HOME: f.dir }), /one nonempty line/);
    }
  } finally {
    await f.cleanup();
  }
});
