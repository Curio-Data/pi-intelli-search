// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { breadthResearchScript } from "../scripts/benchmarks/study-workflows.js";

const root = new URL("../docs/benchmarks/codemode-study-v1/", import.meta.url);

test("draft study manifest binds every declared input without changing historical files", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8")) as { inputs: Array<{path: string; sha256: string}> };
  assert(manifest.inputs.length > 0);
  const paths = new Set<string>();
  for (const input of manifest.inputs) {
    assert(!paths.has(input.path));
    paths.add(input.path);
    assert(/^[A-Za-z0-9_.-]+$/.test(input.path), "input is a file within the versioned study directory");
    const bytes = await readFile(new URL(input.path, root));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), input.sha256, input.path);
  }
});
test("all declared breadth tasks pass the same total and per-angle budgets to the script", async () => {
  const corpus = JSON.parse(await readFile(new URL("corpus.json", root), "utf8")) as {
    pageBudgets: { breadth: { totalPages: number; angles: number; perAngle: number } };
    queries: Array<{ id: string; workflow: string; workflowQueries: string[]; focusPrompt: string }>;
  };
  const { totalPages, angles, perAngle } = corpus.pageBudgets.breadth;
  assert.equal(totalPages, angles * perAngle);
  const tasks = corpus.queries.filter((task) => task.workflow === "breadth");
  assert(tasks.length > 0);
  for (const task of tasks) {
    assert.equal(task.workflowQueries.length, angles, task.id);
    const script = breadthResearchScript(task.workflowQueries.map((query) => ({ query, focusPrompt: task.focusPrompt })), { maxPages: totalPages, maxChars: 4000, timeoutMs: 60000, maxOutputTokens: 2000 });
    const requests = JSON.parse(script.split("\n")[1].slice("const requests = ".length, -1)) as Array<{maxUrls: number}>;
    assert.deepEqual(requests.map((request) => request.maxUrls), Array(angles).fill(perAngle), task.id);
  }
});
