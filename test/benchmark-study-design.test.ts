// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { breadthResearchScript } from "../scripts/benchmarks/study-workflows.js";
import { readStudyDesign } from "../scripts/benchmarks/study-design.js";
import { analyseStudy, type StudyDataset } from "../scripts/benchmarks/study-analysis.js";
import { observeToolCatalogue } from "../scripts/benchmarks/observer.js";
import { asJson } from "../scripts/benchmarks/canonical.js";

const root = new URL("../docs/benchmarks/codemode-study-v1/", import.meta.url);

test("the shared development edition binds its data, corrected catalogues and reproduced analysis", async () => {
  const bundle=new URL("development-v1/",root);
  const manifest=JSON.parse(await readFile(new URL("manifest.json",bundle),"utf8")) as {files:Array<{path:string;sha256:string}>};
  for(const file of manifest.files)assert.equal(createHash("sha256").update(await readFile(new URL(file.path,bundle))).digest("hex"),file.sha256,file.path);
  const bytes=await readFile(new URL("dataset.json",bundle),"utf8");
  const dataset=JSON.parse(bytes) as StudyDataset;
  const saved=JSON.parse(await readFile(new URL("derived/analysis.json",bundle),"utf8"));
  assert.deepEqual(saved,{datasetSha256:createHash("sha256").update(bytes).digest("hex"),...analyseStudy(dataset)});
  const catalogues=JSON.parse(await readFile(new URL("tool-catalogues.json",bundle),"utf8")) as Array<{sha256:string;declarations:unknown}>;
  for(const catalogue of catalogues)assert.equal(observeToolCatalogue(asJson({input:[{type:"additional_tools",tools:catalogue.declarations}]})).sha256,catalogue.sha256);
  assert.equal(new Set(dataset.runs.filter((run)=>run.purpose==="comparative-task").map((run)=>run.toolCatalogueSha256)).size,2);
});

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
test("the measured-series freeze binds the declared population and repeats", async () => {
  const design = await readStudyDesign(new URL(".", root).pathname);
  assert.equal(design.measuredSeries?.revision, "measured-series-2");
  assert.equal(design.measuredSeries?.population.queryIds.length, 20);
  assert.deepEqual(design.measuredSeries?.population.repeats, [1, 2]);
  assert.deepEqual(design.measuredSeries?.population.populations, ["replay", "live"]);
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
