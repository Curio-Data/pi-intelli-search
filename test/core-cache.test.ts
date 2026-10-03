// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { it } from "node:test";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { acquireLock, withLock, readIndex } from "../src/core/cache.js";
import { TelemetryBuilder, writeTelemetry } from "../src/core/telemetry.js";

const exec = promisify(execFile);
const repo = fileURLToPath(new URL("../", import.meta.url));
async function workspace(t: { after(fn: () => Promise<void>): void }) {
  await mkdir(resolve(".tmp"), { recursive: true });
  const path = await mkdtemp(resolve(".tmp/core-cache-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

it("aborts lock wait without stealing the existing lock", async (t) => {
  const root = await workspace(t);
  const lock = join(root, ".lock");
  const release = await acquireLock(lock);
  const controller = new AbortController();
  let invoked = false;
  const pending = withLock(
    lock,
    async () => {
      invoked = true;
    },
    controller.signal,
  );
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(invoked, false);
  assert.equal(await readFile(join(lock, "pid"), "utf8"), String(process.pid));
  await release();
  assert.deepEqual(await readdir(root), []);
});

it("serialises same-query and distinct-query cache writes across independent processes", async (t) => {
  const root = await workspace(t);
  const coreUrl = new URL("../src/core/index.ts", import.meta.url).href;
  const helperUrl = new URL("./helpers/core-context.ts", import.meta.url).href;
  const program = `
    import { collate } from ${JSON.stringify(coreUrl)};
    import { coreContext } from ${JSON.stringify(helperUrl)};
    const [root, query, marker] = process.argv.slice(1);
    const { context } = coreContext(root);
    context.models.complete = async () => ({ text: marker, citations: [] });
    const result = await collate({ query, extractions: [{ url: 'https://fixture.example', title: marker, extraction: marker, sourceType: 'docs', status: 'success' }], fullPages: [{ url: 'https://fixture.example', title: marker, content: marker }] }, context);
    process.stdout.write(JSON.stringify(result.details));
  `;
  const runs = await Promise.all(
    ["shared", "shared", "distinct-a", "distinct-b"].map((query, i) =>
      exec(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "--eval", program, root, query, `marker-${i}`],
        { cwd: repo, timeout: 30000 },
      ),
    ),
  );
  const index = await readIndex(join(root, ".search"));
  assert.deepEqual(index.searches.map((e) => e.query).sort(), [
    "distinct-a",
    "distinct-b",
    "shared",
  ]);
  for (const run of runs) {
    const cache = join(root, JSON.parse(run.stdout).cachePath);
    const report = await readFile(join(cache, "report.md"), "utf8");
    const extraction = await readFile(join(cache, "extractions/01-fixture-example.md"), "utf8");
    const source = await readFile(join(cache, "sources/01-fixture-example.md"), "utf8");
    const marker = report.match(/marker-\d+/)![0];
    assert.match(extraction, new RegExp(marker));
    assert.match(source, new RegExp(marker));
    assert.equal(
      (await readdir(cache)).some((p) => p.startsWith(".lock") || p.startsWith(".staging")),
      false,
    );
  }
});

it("aggregates legacy native and identity-tagged standalone metadata without schema changes", async (t) => {
  const root = await workspace(t);
  const sessions = join(root, "sessions");
  await mkdir(sessions);
  await writeFile(
    join(sessions, "2026-10-session.jsonl"),
    JSON.stringify({
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", name: "intelli_research", arguments: {} }],
      },
    }) + "\n",
  );
  for (const adapter of ["pi", "mcp"] as const) {
    const builder = await TelemetryBuilder.create(
      "query",
      { name: `fixture-${adapter}`, version: `${adapter}-version`, adapter },
      () => 100,
    );
    builder.recordFetch({ requested: 2, succeeded: 1, failed: 1, winners: { markdown: 1 } });
    const metadata = builder.finalize();
    assert.equal(metadata.extensionVersion, `${adapter}-version`);
    assert.equal(metadata.packageName, adapter === "pi" ? undefined : "fixture-mcp");
    const cache = join(root, ".search", adapter);
    await mkdir(cache, { recursive: true });
    await writeTelemetry(cache, metadata);
  }
  const run = spawnSync("bash", [join(repo, "scripts/analyze-sessions.sh"), sessions], {
    cwd: root,
    env: { ...process.env, SEARCH_ROOTS: root, TMPDIR: root },
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(run.status, 0, run.stderr + run.stdout);
  assert.match(run.stdout, /sidecars found: 2/);
  assert.match(run.stdout, /completed: 2/);
  assert.match(run.stdout, /"succeeded": 2/);
  assert.match(run.stdout, /"failed": 2/);
});
