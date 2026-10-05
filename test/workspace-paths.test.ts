// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveWorkspacePaths, displayCachePath } from "../src/core/paths.js";
import { makeCachePath } from "../src/cache.js";
import { captureOperation, FIXTURES, type Scenario } from "./helpers/native-contract.js";

describe("explicit workspace paths", () => {
  it("anchors physical paths without changing native display paths", () => {
    const paths = resolveWorkspacePaths("/work/project", "./.search");
    const physical = makeCachePath("example", paths.workspaceRoot, paths.cacheRoot);
    assert.equal(paths.cacheRoot, "/work/project/.search");
    assert.equal(paths.stagingRoot, "/work/project/.search/.staging");
    assert.equal(paths.cacheDisplayRoot, "./.search");
    assert.ok(physical.startsWith(paths.cacheRoot + "/"));
    assert.equal(displayCachePath(paths, physical), physical.replace("/work/project/", ""));
    assert.ok(Object.isFrozen(paths));
  });

  it("preserves absolute and parent-relative native cache configuration", () => {
    for (const cacheDir of ["/cache/shared", "../shared"]) {
      const paths = resolveWorkspacePaths("/work/project", cacheDir);
      const physical = makeCachePath("example", paths.workspaceRoot, cacheDir);
      assert.equal(paths.cacheRoot, cacheDir === "../shared" ? "/work/shared" : cacheDir);
      assert.ok(physical.startsWith(paths.cacheRoot + "/"));
      assert.ok(displayCachePath(paths, physical).startsWith(cacheDir + "/"));
    }
  });

  it("supports absolute display paths independently of physical resolution", () => {
    const paths = resolveWorkspacePaths("/work/project", ".search", "absolute");
    const physical = makeCachePath("example", paths.workspaceRoot, paths.cacheRoot);
    assert.equal(displayCachePath(paths, physical), physical);
  });

  it("refuses an implicit process-relative workspace", () => {
    assert.throws(() => resolveWorkspacePaths("relative", ".search"), /must be absolute/);
  });

  for (const scenario of [
    "collate",
    "research",
    "partial-research",
    "no-links",
    "fetch-failed",
    "extraction-failed",
  ] satisfies Scenario[]) {
    it(`keeps ${scenario} cache, index, telemetry and display under the explicit workspace`, async () => {
      const expected = JSON.parse(await readFile(join(FIXTURES, `${scenario}.json`), "utf8"));
      const actual = await captureOperation(scenario, { separateProcessCwd: true });
      assert.deepEqual(actual, expected);
    });
  }
});
