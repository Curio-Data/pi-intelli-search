// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fixture } from "./helpers.js";

test("the default provider uses the patched MCP dependency, not Node-bundled fetch", async () => {
  const require = createRequire(new URL("../src/providers/openrouter.ts", import.meta.url));
  const installed = require("undici/package.json") as {
    version: string;
    engines: { node: string };
  };
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(installed.version, manifest.dependencies.undici);
  assert.equal(
    installed.engines.node,
    ">=20.18.1",
    "Review Node >=22 compatibility when changing Undici",
  );
  const f = await fixture();
  try {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        fileURLToPath(new URL("../../../test/probes/mcp-provider-security.mjs", import.meta.url)),
        new URL("../src/runtime.ts", import.meta.url).href,
      ],
      { cwd: f.dir, encoding: "utf8", timeout: 20_000 },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(
      result.stdout,
      "mcp-provider-security-complete\n",
      "Every default-transport assertion must finish",
    );
  } finally {
    await f.cleanup();
  }
});
