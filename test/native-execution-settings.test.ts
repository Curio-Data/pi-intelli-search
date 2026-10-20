// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettings, invalidateSettingsCache } from "../src/settings.js";

// No operator configuration or mutable state survives these cases.
test("native execution honours trust, source precedence and strict selected-block validation (T03)", async () => {
  const root = await mkdtemp(join(tmpdir(), "native-execution-"));
  const saved = process.env.PI_CODING_AGENT_DIR;
  const agent = join(root, "agent");
  const project = join(root, ".pi");
  await mkdir(agent);
  await mkdir(project);
  process.env.PI_CODING_AGENT_DIR = agent;
  const save = async (dir: string, value: unknown) => {
    await writeFile(join(dir, "settings.json"), JSON.stringify(value));
    invalidateSettingsCache();
  };
  const load = (trusted: boolean) => loadSettings({ cwd: root, projectTrusted: trusted });
  try {
    await save(agent, { "pi-intelli-search": { execution: { modelConcurrency: 9 }, maxUrls: 6 } });
    await save(project, { "pi-intelli-search": { execution: { modelConcurrency: 2 } } });
    assert.equal((await load(false)).execution?.modelConcurrency, 9);
    assert.equal((await load(true)).execution?.modelConcurrency, 2);
    assert.equal((await load(true)).maxUrls, 6, "unrelated legacy source merge is unchanged");
    await save(project, { "pi-intelli-search": { execution: { lateDrainMs: 17 } } });
    const replaced = await load(true);
    assert.equal(replaced.execution?.lateDrainMs, 17);
    assert.equal(
      replaced.execution?.modelConcurrency,
      5,
      "selected block replaces the preceding source block",
    );
    for (const execution of [
      null,
      "",
      false,
      [],
      { modelConcurrency: 1 },
      { deadline: { enabled: true } },
      { unknown: "do-not-echo" },
    ]) {
      await save(project, { "pi-intelli-search": { execution } });
      await assert.rejects(load(true), (error: unknown) => {
        assert(error instanceof Error);
        assert.match(error.message, /pi-intelli-search.execution/);
        assert(!error.message.includes("do-not-echo"));
        return true;
      });
      assert.equal((await load(false)).execution?.modelConcurrency, 9);
    }
    await save(project, { "pi-intelli-search": { unrelated: "preserved-tolerance" } });
    assert.equal((await load(true)).execution?.modelConcurrency, 9);
    await save(project, { intelliExecution: { modelConcurrency: 1 } });
    assert.equal((await load(true)).execution?.modelConcurrency, 9, "no new deprecated alias");
    await writeFile(join(project, "settings.json"), "{");
    invalidateSettingsCache();
    assert.equal(
      (await load(true)).execution?.modelConcurrency,
      9,
      "malformed-file legacy fallback remains",
    );
  } finally {
    if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = saved;
    invalidateSettingsCache();
    await rm(root, { recursive: true, force: true });
  }
});
