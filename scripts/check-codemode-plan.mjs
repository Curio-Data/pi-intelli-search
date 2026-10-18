// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
// Deterministic P0 documentation/corpus gate. No inference, network or runtime feature tests.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
for (const arg of args) assert(["--write-manifest", "--require-accepted"].includes(arg), `Unknown argument: ${arg}`);
const corpusRoot = "docs/benchmarks/corpus";
const contractRoot = "docs/plans/codemode";
const read = (path) => readFileSync(path, "utf8");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};
const names = ["deadline", "query-expansion", "codemode"];
const partitions = ["development", "pilot", "held-out", "confirmatory-reserve"];
const inputs = names.map((name) => ({ name, path: `${name}.json`, data: JSON.parse(read(`${corpusRoot}/${name}.json`)) }));
const all = inputs.flatMap(({ data }) => data.queries);
const ids = new Set();
const queries = new Set();
for (const { name, data } of inputs) {
  assert.equal(data.schemaVersion, 1);
  for (const q of data.queries) {
    assert.equal(q.experiment, name);
    assert(!ids.has(q.id), `Duplicate ID ${q.id}`); ids.add(q.id);
    assert(!queries.has(q.query), `Duplicate exact query ${q.id}`); queries.add(q.query);
    assert(partitions.includes(q.partition), `Unknown partition ${q.id}`);
    for (const key of ["query", "focusPrompt", "exposureFamily", "goldStatus"]) assert(typeof q[key] === "string" && q[key].trim(), `${q.id}: ${key}`);
    assert(Array.isArray(q.domains) && q.domains.length > 0);
    assert(q.domains.every((d) => /^[a-z0-9.-]+$/.test(d) && !d.includes("..")), `${q.id}: domains`);
    assert(Array.isArray(q.rubric) && q.rubric.length > 0 && q.rubric.every((r) => typeof r.critical === "boolean" && r.criterion));
    assert.equal(q.expansions.length, name === "query-expansion" ? 3 : 0);
    assert.equal(new Set(q.expansions).size, q.expansions.length);
    if (name !== "query-expansion") assert(q.workflowQueries.length > 0);
  }
  for (const p of partitions) {
    const count = data.queries.filter((q) => q.partition === p).length;
    assert(count >= (p === "pilot" ? 4 : p === "development" ? 2 : 1), `${name}: incomplete ${p}`);
  }
}
const calibrationPath = "judge-calibration.json";
const calibration = JSON.parse(read(`${corpusRoot}/${calibrationPath}`));
assert.equal(calibration.schemaVersion, 1);
for (const q of calibration.items) {
  assert(!ids.has(q.id)); ids.add(q.id);
  assert.equal(q.partition, "judge-calibration");
  assert(q.evidence && q.question && q.answerA && q.answerB && ["A", "B"].includes(q.proposedPreference));
}
assert(calibration.labelStatus.includes("human"));
const methodPaths = ["../README.md", ...names.map((n) => `../${n}/METHOD.md`)];
const domainMap = {};
for (const q of all) for (const domain of q.domains) (domainMap[domain] ??= []).push(q.id);
const exposureGroups = [
  { id: "sql-storage", ids: ["QE-D02", "CM-P03"], rule: "Related acquisition tasks, both tuning partitions; record exposure together and never relabel as unseen confirmation." },
  { id: "node-http-cancellation", ids: ["DL-D01", "QE-D01", "CM-D02"], rule: "Related development topics; share exposure provenance, not independent unseen evidence." },
];
for (const group of exposureGroups) for (const id of group.ids) assert(ids.has(id));
const expected = {
  schemaVersion: 1,
  revision: "P0-1",
  purpose: "Frozen public inputs; no fixture capture, human gold acceptance, paid run or powered sample claimed",
  corpusSha256: hash(canonical({ inputs: inputs.map(({ name, data }) => ({ name, data })), calibration })),
  inputFiles: [...inputs.map(({ path }) => ({ path, sha256: hash(read(`${corpusRoot}/${path}`)) })), { path: calibrationPath, sha256: hash(read(`${corpusRoot}/${calibrationPath}`)) }],
  partitions: inputs.flatMap(({ name, data }) => partitions.map((partition) => {
    const selected = data.queries.filter((q) => q.partition === partition).sort((a, b) => a.id.localeCompare(b.id));
    return { experiment: name, partition, ids: selected.map((q) => q.id), sha256: hash(canonical(selected)) };
  })),
  judgeCalibration: { ids: calibration.items.map((q) => q.id), sha256: hash(canonical(calibration.items)), labelStatus: calibration.labelStatus },
  methods: methodPaths.map((path) => ({ path, sha256: hash(read(`${corpusRoot}/${path}`)) })),
  crossExperimentExposureGroups: exposureGroups,
  sharedDomains: Object.fromEntries(Object.entries(domainMap).filter(([, qids]) => qids.length > 1).sort(([a], [b]) => a.localeCompare(b)).map(([d, qids]) => [d, qids.sort()])),
  confirmation: { status: "reserve-only; later D6 preregistration required", sampleSize: null, expansionRule: "Add fresh inputs in a new manifest revision before independent capture; never relabel exposed material." },
};
const manifestPath = `${corpusRoot}/manifest.json`;
if (args.has("--write-manifest")) writeFileSync(manifestPath, `${JSON.stringify(expected, null, 2)}\n`);
assert.deepEqual(JSON.parse(read(manifestPath)), expected, "Corpus/method manifest drift; inspect changes before deliberate regeneration");
const contract = read(`${contractRoot}/CONTRACT.md`);
const acceptance = read(`${contractRoot}/ACCEPTANCE.md`);
const clauseIds = [...contract.matchAll(/^### (C\d{2}) /gm)].map((m) => m[1]);
assert.deepEqual(clauseIds, Array.from({ length: 34 }, (_, i) => `C${String(i + 1).padStart(2, "0")}`));
assert.deepEqual([...acceptance.matchAll(/^\| T\d{2} \| (C\d{2}) \|/gm)].map((m) => m[1]), clauseIds);
const docs = [`${contractRoot}/CONTRACT.md`, `${contractRoot}/ACCEPTANCE.md`, `${contractRoot}/STATUS.md`, "docs/plans/research-history/PLAN.md", ...methodPaths.map((p) => resolve(corpusRoot, p))];
for (const path of docs) {
  const text = read(path);
  assert(!text.includes("\u2014"), `${path}: authored em dash`);
  for (const m of text.matchAll(/\]\(([^)]+)\)/g)) {
    const target = m[1].split("#")[0];
    if (target && !/^[a-z]+:/i.test(target)) assert(existsSync(resolve(dirname(path), target)), `${path}: missing ${target}`);
  }
}
if (args.has("--require-accepted")) {
  const record = JSON.parse(read(`${contractRoot}/acceptance.json`));
  assert.equal(record.status, "accepted");
  assert.equal(record.revision, "P0-1");
  assert(/^[a-f0-9]{40}$/.test(record.reviewedCommit));
  assert.equal(hash(read(`${contractRoot}/REVIEW.md`)), record.reviewReportSha256);
  assert(record.coordinatorAccepted && record.reviewerModel && record.specificationFiles.length);
  for (const item of record.specificationFiles) {
    assert.equal(hash(readFileSync(item.path)), item.sha256, `Accepted specification changed: ${item.path}`);
    const committed = execFileSync("git", ["show", `${record.reviewedCommit}:${item.path}`]);
    assert.equal(hash(committed), item.sha256, `Review commit mismatch: ${item.path}`);
  }
}
console.log("Codemode P0 contract/corpus/method checks passed; no feature or live benchmark verdict implied.");
