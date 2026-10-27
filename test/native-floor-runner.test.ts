// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
import assert from "node:assert/strict";
import { it } from "node:test";
import { privateFloorEnv } from "../scripts/qualify-native-floor.mjs";

it("the floor runner allows only explicit environment names, never ambient credentials or loaders", () => {
  const env = privateFloorEnv(
    { NATIVE_FLOOR_REQUIRED: "1" },
    {
      PATH: "/synthetic/bin",
      LANG: "C.UTF-8",
      NATIVE_FLOOR_HOST: "/synthetic/floor",
      NATIVE_FLOOR_KEEP: "1",
      GH_TOKEN: "synthetic",
      GITHUB_TOKEN: "synthetic",
      AWS_SECRET_ACCESS_KEY: "synthetic",
      OPENROUTER_API_KEY: "synthetic",
      NODE_OPTIONS: "--require synthetic",
      HOME: "/operator",
      TMPDIR: "/unencrypted",
      PI_CODING_AGENT_DIR: "/operator/agent",
      UNRELATED_UNKNOWN_VALUE: "synthetic",
    },
  );
  assert.equal(env.PATH, "/synthetic/bin");
  assert.equal(env.NATIVE_FLOOR_HOST, "/synthetic/floor");
  assert.equal(env.NATIVE_FLOOR_KEEP, "1");
  assert.equal(env.NATIVE_FLOOR_REQUIRED, "1");
  for (const key of [
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "AWS_SECRET_ACCESS_KEY",
    "OPENROUTER_API_KEY",
    "NODE_OPTIONS",
    "PI_CODING_AGENT_DIR",
    "UNRELATED_UNKNOWN_VALUE",
  ])
    assert.equal(Object.hasOwn(env, key), false, key);
  assert(env.HOME?.includes("/.tmp/m4-floor/home"));
  assert(env.TMPDIR?.includes("/.tmp/m4-floor/tmp"));
  assert.equal(env.PI_OFFLINE, "1");
});
