// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { assertWorkspaceSafe } from "../src/workspace.js";
import { createRuntime, StandaloneError } from "../src/runtime.js";
import { resolveWorkspacePaths } from "../../../src/core/paths.js";
import { fixture, fakeTransport, completion, json, logger } from "./helpers.js";

test("whole-parent scan tolerates disappearing private spools but refuses replaced roots (T28)", async () => {
  for (const kind of ["private", "cache", "staging"] as const) {
    const f = await fixture();
    const paths = resolveWorkspacePaths(f.dir, ".search", "absolute");
    const target =
      kind === "cache"
        ? paths.cacheRoot
        : kind === "staging"
          ? paths.stagingRoot
          : join(paths.stagingRoot, "pages-owned");
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(join(target, "sentinel"), "preserve");
    const read = fs.readdir;
    let witnessed = false;
    try {
      // Synchronise the mutation to the exact awaited filesystem boundary.
      fs.readdir = (async (path: Parameters<typeof read>[0], options?: unknown) => {
        if (String(path) === target && !witnessed) {
          witnessed = true;
          await fs.rename(target, `${target}-preserved`);
          if (kind !== "private") await fs.mkdir(target);
        }
        return read(path, options as never);
      }) as typeof read;
      syncBuiltinESMExports();
      if (kind === "private") await assertWorkspaceSafe(paths);
      else await assert.rejects(assertWorkspaceSafe(paths), /identity changed/);
      assert(witnessed);
      assert.equal(await fs.readFile(join(`${target}-preserved`, "sentinel"), "utf8"), "preserve");
    } finally {
      fs.readdir = read;
      syncBuiltinESMExports();
      await f.cleanup();
    }
  }
});

test("the unchanged 100000-entry whole-parent cap rejects before inference at its exact boundary (T28)", async () => {
  const f = await fixture();
  const paths = resolveWorkspacePaths(f.dir, ".search", "absolute");
  await fs.mkdir(paths.cacheRoot);
  await fs.writeFile(join(paths.cacheRoot, "shape"), "");
  const fileShape = await fs.lstat(join(paths.cacheRoot, "shape"));
  const read = fs.readdir;
  const stat = fs.lstat;
  let population = 99_999; // The cache root is itself entry one.
  let visits = 0;
  let inference = 0;
  let runtime: Awaited<ReturnType<typeof createRuntime>> | undefined;
  try {
    // Synthetic directory population exercises the actual scanner and runtime,
    // not a replacement scanner. Physical history-growth qualification is M4.
    fs.readdir = (async (path: Parameters<typeof read>[0], options?: unknown) =>
      String(path) === paths.cacheRoot
        ? Array.from({ length: population }, (_, i) => `entry-${i}`)
        : read(path, options as never)) as typeof read;
    fs.lstat = (async (path: Parameters<typeof stat>[0], options?: unknown) => {
      if (String(path).startsWith(join(paths.cacheRoot, "entry-"))) {
        visits++;
        return fileShape;
      }
      return stat(path, options as never);
    }) as typeof stat;
    syncBuiltinESMExports();
    await assertWorkspaceSafe(paths);
    assert.equal(visits, 99_999, "all entries at the accepted boundary are inspected");
    runtime = await createRuntime(f.config, {
      env: { FIXTURE_KEY: "synthetic" },
      logger,
      fetch: fakeTransport(() => {
        inference++;
        return json(completion("Unexpected"));
      }),
    });
    population++;
    await assert.rejects(
      runtime.execute("intelli_search", { query: "blocked before inference" }),
      (error: unknown) => {
        assert(error instanceof StandaloneError);
        assert.equal(error.code, "WORKSPACE");
        assert.match(error.message, /Cache safety scan exceeds 100000 entries/);
        assert.equal(error.execution, undefined);
        return true;
      },
    );
    assert.equal(inference, 0);
  } finally {
    fs.readdir = read;
    fs.lstat = stat;
    syncBuiltinESMExports();
    await runtime?.close();
    await f.cleanup();
  }
});
