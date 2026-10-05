// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  captureOperation,
  capturePrompts,
  captureToolContracts,
  FIXTURES,
  SCENARIOS,
} from "./helpers/native-contract.js";
import { intelliSearchTool } from "../src/tools/intelli-search.js";
import { intelliExtractTool } from "../src/tools/intelli-extract.js";

async function expected(name: string): Promise<unknown> {
  return JSON.parse(await readFile(join(FIXTURES, `${name}.json`), "utf8"));
}

describe("native compatibility fixtures", { concurrency: false }, () => {
  it("preserves tool schemas, descriptions, guidance and registration events", async () => {
    assert.deepStrictEqual(captureToolContracts(), await expected("tools"));
  });

  it("preserves all system prompts verbatim", async () => {
    assert.deepStrictEqual(capturePrompts(), await expected("prompts"));
  });

  for (const scenario of SCENARIOS) {
    it(`preserves ${scenario} output, model requests, progress and cache artifacts`, async () => {
      assert.deepStrictEqual(await captureOperation(scenario), await expected(scenario));
    });
  }

  it("detects mutations to real tool metadata and executed results", async () => {
    const description = intelliSearchTool.description;
    const execute = intelliExtractTool.execute;
    try {
      intelliSearchTool.description = "Deliberate incompatible description";
      assert.notDeepStrictEqual(captureToolContracts(), await expected("tools"));
      intelliExtractTool.execute = async (...args) => {
        const result = await execute(...args);
        return { ...result, details: { ...result.details, sourceType: "deliberate-drift" } };
      };
      assert.notDeepStrictEqual(await captureOperation("extract"), await expected("extract"));
    } finally {
      intelliSearchTool.description = description;
      intelliExtractTool.execute = execute;
    }
    assert.deepStrictEqual(captureToolContracts(), await expected("tools"));
    assert.deepStrictEqual(await captureOperation("extract"), await expected("extract"));
  });

  it("is repeatable across fresh directories and restores process state", async () => {
    const cwd = process.cwd();
    const agent = process.env.PI_CODING_AGENT_DIR;
    const fetch = globalThis.fetch;
    const error = console.error;
    const clock = Date;
    try {
      process.env.PI_CODING_AGENT_DIR = "/nonexistent/host-config-must-not-be-used";
      const first = await captureOperation("research");
      const second = await captureOperation("research");
      assert.deepStrictEqual(first, second);
      assert.equal(process.cwd(), cwd);
      assert.equal(process.env.PI_CODING_AGENT_DIR, "/nonexistent/host-config-must-not-be-used");
      assert.equal(globalThis.fetch, fetch);
      assert.equal(console.error, error);
      assert.equal(Date, clock, "mock clock must be restored");
    } finally {
      if (agent === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = agent;
    }
  });
});
