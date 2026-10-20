// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseExecutionSettings, validateRequestInterval } from "../src/core/execution-settings.js";

const enabled = {
  enabled: true,
  quorum: 0.5,
  factor: 2,
  floorMs: 0,
  ceilingMs: 100,
  minSources: 1,
};

test("C03/T03 exact execution defaults, fresh immutable values and whole-deadline replacement", () => {
  const result = parseExecutionSettings(undefined);
  assert.deepEqual(result, {
    pageExecution: "streaming",
    modelConcurrency: 5,
    criticalReserve: 1,
    aggregateFetchConcurrency: 4,
    lateDrainMs: 0,
    deadline: { enabled: false },
    fetchMaxResponseBytes: 8_388_608,
    docsMaxResponseBytes: 16_777_216,
    fetchMaxChars: 500_000,
  });
  assert(Object.isFrozen(result));
  assert(Object.isFrozen(result.deadline));
  assert.notEqual(result.deadline, parseExecutionSettings(undefined).deadline);
  const input = { modelConcurrency: 2, deadline: { ...enabled } };
  const captured = parseExecutionSettings(input);
  input.modelConcurrency = 64;
  input.deadline.factor = 10;
  assert.equal(captured.modelConcurrency, 2);
  assert.deepEqual(captured.deadline, enabled);
  assert.equal(parseExecutionSettings({ pageExecution: "barrier" }).deadline.enabled, false);
  assert.throws(() => parseExecutionSettings({ deadline: { enabled: true } }), /quorum/);
});

const ranges = {
  modelConcurrency: [2, 64],
  criticalReserve: [1, 1],
  aggregateFetchConcurrency: [1, 32],
  lateDrainMs: [0, 30_000],
  fetchMaxResponseBytes: [65_536, 16_777_216],
  docsMaxResponseBytes: [65_536, 33_554_432],
  fetchMaxChars: [1, 500_000],
} as const;
for (const [key, [min, max]] of Object.entries(ranges)) {
  test(`C03/T03 execution.${key} boundaries and types`, () => {
    for (const value of [min, max])
      assert.equal(parseExecutionSettings({ [key]: value })[key as keyof typeof ranges], value);
    for (const value of [
      min - 1,
      max + 1,
      min + 0.5,
      NaN,
      Infinity,
      -Infinity,
      true,
      null,
      "secret",
      undefined,
    ])
      assert.throws(
        () => parseExecutionSettings({ [key]: value }),
        (error: unknown) => {
          assert(error instanceof Error);
          assert(error.message.includes(key));
          assert(!error.message.includes("secret"));
          return true;
        },
      );
  });
}

test("C03/T03 execution rejects malformed blocks and unknown keys without echoing values", () => {
  for (const value of [
    null,
    false,
    1,
    "secret",
    [],
    { secret: "secret" },
    { pageExecution: "secret" },
    { deadline: null },
    { deadline: { enabled: false, quorum: 0.5 } },
    { deadline: { enabled: "true" } },
    { deadline: { ...enabled, secret: "secret" } },
    { pageExecution: "barrier", deadline: enabled },
  ])
    assert.throws(
      () => parseExecutionSettings(value),
      (error: unknown) => {
        assert(error instanceof Error);
        assert(!error.message.includes("secret"));
        return true;
      },
    );
});

test("C03/T03 every enabled deadline field is explicit and finite within its bounds", () => {
  for (const key of Object.keys(enabled)) {
    const value: Record<string, unknown> = { ...enabled };
    delete value[key];
    assert.throws(() => parseExecutionSettings({ deadline: value }), new RegExp(key));
  }
  for (const [key, min, max, integer] of [
    ["quorum", Number.MIN_VALUE, 1, false],
    ["factor", Number.MIN_VALUE, 10, false],
    ["floorMs", 0, 600_000, true],
    ["ceilingMs", 1, 600_000, true],
    ["minSources", 1, 100, true],
  ] as const) {
    for (const value of [min, max]) {
      const policy = { ...enabled, floorMs: 0, ceilingMs: 600_000, [key]: value };
      const result = parseExecutionSettings({ deadline: policy });
      assert.deepEqual(result.deadline, policy);
    }
    for (const value of [
      key === "quorum" || key === "factor" ? 0 : min - 1,
      max + 1,
      NaN,
      Infinity,
      "secret",
      null,
      true,
      ...(integer ? [1.5] : []),
    ])
      assert.throws(
        () => parseExecutionSettings({ deadline: { ...enabled, [key]: value } }),
        new RegExp(key),
      );
  }
  assert.throws(
    () => parseExecutionSettings({ deadline: { ...enabled, floorMs: 101 } }),
    /floorMs/,
  );
  assert.deepEqual(parseExecutionSettings({ deadline: { ...enabled, floorMs: 100 } }).deadline, {
    ...enabled,
    floorMs: 100,
  });
});

test("C03/T03 pacing retains the existing MCP integer range", () => {
  for (const value of [0, 120_000]) assert.equal(validateRequestInterval(value, "pacing"), value);
  for (const value of [-1, 120_001, 0.5, NaN, Infinity, "secret", null, undefined])
    assert.throws(
      () => validateRequestInterval(value, "pacing"),
      /pacing.*integer between 0 and 120000/,
    );
});
