// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { mkdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { loadPinnedHost } from "./host.js";
import { runWorker, runSyntheticSeries, reproduce, REPO_ROOT, type WorkerConfig } from "./runner.js";
import { sourceIdentity, writeNewJson } from "./storage.js";
import type { Phase } from "./contracts.js";
import { admitAcceptedPreparation, prepareCapture, qualifyDownstreamCost, collectAcceptedSeries, settleAcceptedSeries } from "./collection.js";

const USAGE = [
  "Research handoff runner",
  "Credential-free operations:",
  "  preflight <new-dir>",
  "  synthetic <new-series-dir>",
  "  analyse <inventory.json> <new-dir> [synthetic|diagnostic|measured] [assessments.json]",
  "  Analysis phase defaults to measured.",
  "Recorded live/financial acceptance required:",
  "  admit <preparation-acceptance.json>",
  "  capture <preparation-acceptance.json> <auth-file>",
  "  qualify-cost <preparation-acceptance.json> <auth-file> <corpus-acceptance.json>",
  "  collect <conversation-acceptance.json> <auth-file> <frozen-inputs.json>",
  "  settle <preparation-acceptance.json>",
  "Internal driver entry (live modes remain gated):",
  "  worker <worker.json>",
  "See docs/experiments/research-handoff/REPRODUCTION.md for the per-stage gates.",
].join("\n");

async function main() {
  const [command, first, second, phase, assessments] = process.argv.slice(2);
  if (command === "--help" || command === "help") { console.log(USAGE); return; }
  if (command === "preflight" && first && !second) {
    const output = resolve(first); await mkdir(output);
    const host = await loadPinnedHost();
    writeNewJson(join(output, "identity.json"), { observedAt: new Date().toISOString(), node: process.version,
      host: host.identity, code: await sourceIdentity(REPO_ROOT), credentialUse: false });
    console.log(`Preflight identity: ${join(output, "identity.json")}`);
  } else if (command === "synthetic" && first && !second) {
    await runSyntheticSeries(first);
    console.log(`Synthetic proof: ${resolve(first)}`);
  } else if (command === "worker" && first && !second) {
    const record = await runWorker(JSON.parse(await readFile(first, "utf8")) as WorkerConfig);
    console.log(`${record.manifest.runId}: ${record.manifest.status}`);
    if (record.manifest.status !== "completed") process.exitCode = 1;
  } else if (command === "analyse" && first && second && (!phase || ["synthetic", "diagnostic", "measured"].includes(phase))) {
    await reproduce(first, second, (phase ?? "measured") as Phase, assessments);
    console.log(`Offline analysis: ${resolve(second)}`);
  } else if (command === "admit" && first && !second) {
    await admitAcceptedPreparation(first);
    console.log("Financial admission recorded.");
  } else if (command === "capture" && first && second && !phase) {
    console.log(await prepareCapture(first, second));
  } else if (command === "qualify-cost" && first && second && phase) {
    console.log(await qualifyDownstreamCost(first, second, phase));
  } else if (command === "collect" && first && second && phase) {
    const result = await collectAcceptedSeries(first, second, phase);
    console.log(`${result.stopped ? "Collection stopped" : "Collection finished"}. Outcome: ${result.outcomePath}`);
    console.log("Financial close-out remains a separate accepted operation; unknown charges stay held.");
    if (result.stopped) process.exitCode = 1;
  } else if (command === "settle" && first && !second) {
    await settleAcceptedSeries(first);
    console.log("Financial close-out recorded.");
  } else {
    throw new Error(USAGE);
  }
}
main().catch(error => { console.error(String(error)); process.exitCode = 1; });
