// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { mkdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { loadPinnedHost } from "./host.js";
import { runWorker, runSyntheticSeries, reproduce, REPO_ROOT, type WorkerConfig } from "./runner.js";
import { sourceIdentity, writeNewJson } from "./storage.js";
import type { Phase } from "./contracts.js";
import { isPilotPhase, type PilotSyntheticScenario } from "./contracts.js";
import { runPilotWorker, runPilotSyntheticSeries, analysePilotInventory, pilotObserve, pilotAdmit, pilotCapture, pilotQualify, pilotRun, pilotGate, pilotSettle, pilotReviewInputs, PILOT_SYNTHETIC_SCENARIOS } from "./pilot.js";
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
  "rh-v5 pilot (PILOT-PROTOCOL.md; separate from every command above):",
  "  Credential-free:",
  "    pilot-synthetic <new-dir> [scenario,...]",
  "    pilot-analyse <inventory.json> <frozen-inputs.json> <new-dir> [known-charges|no-charges]",
  "    pilot-review-inputs <record.json> <frozen-inputs.json> <new-dir> <neutral-answer-label>",
  "  Pilot implementation acceptance required (designated root only, each slot once), in gate order:",
  "    step 3: pilot-observe <implementation-acceptance.json> <auth-file>",
  "    step 4: pilot-admit <implementation-acceptance.json> <diagnostic-acceptance.json>   (after observer review)",
  "    step 5: pilot-capture <implementation-acceptance.json> <auth-file>   (then corpus review)",
  "    step 6: pilot-qualify <implementation-acceptance.json> <auth-file> <corpus-acceptance.json>",
  "    step 7: pilot-run <implementation-acceptance.json> <auth-file> baseline <corpus-acceptance.json>",
  "            pilot-gate <implementation-acceptance.json> baseline <assessment-lock.json>",
  "    step 8: pilot-run ... candidate ...   (only after a passed baseline gate), then pilot-gate ... candidate ...",
  "    close:  pilot-settle <implementation-acceptance.json> [interruption-receipt.json ...]   (closes the series)",
  "Internal driver entry (live modes remain gated):",
  "  worker <worker.json>",
  "rh-v4: see docs/experiments/research-handoff/REPRODUCTION.md. rh-v5 pilot: see docs/experiments/research-handoff/PILOT-PROTOCOL.md, Gate Sequence and Schedule.",
].join("\n");

async function main() {
  const [command, first, second, phase, assessments] = process.argv.slice(2);
  const args = process.argv.slice(3);
  const arm = (value: string | undefined) => {
    if (value !== "baseline" && value !== "candidate") throw new Error(USAGE);
    return value;
  };
  if (command === "--help" || command === "help") { console.log(USAGE); return; }
  if (command?.startsWith("pilot-")) {
    if (command === "pilot-synthetic" && args.length >= 1 && args.length <= 2) {
      const scenarios = args[1] ? args[1].split(",") : [...PILOT_SYNTHETIC_SCENARIOS];
      if (!scenarios.every(item => (PILOT_SYNTHETIC_SCENARIOS as readonly string[]).includes(item))) throw new Error(USAGE);
      const result = await runPilotSyntheticSeries(args[0], scenarios as PilotSyntheticScenario[]);
      console.log(`Pilot synthetic series ${result.passed ? "matched every expected verdict" : "MISMATCHED an expected verdict"}: ${resolve(args[0])}/series-outcome.json`);
      if (!result.passed) process.exitCode = 1;
    } else if (command === "pilot-analyse" && args.length >= 3 && args.length <= 4 && (!args[3] || ["known-charges", "no-charges"].includes(args[3]))) {
      await analysePilotInventory(args[0], args[1], args[2], (args[3] ?? "known-charges") as "known-charges" | "no-charges");
      console.log(`Pilot offline analysis: ${resolve(args[2])}`);
    } else if (command === "pilot-observe" && args.length === 2) {
      const result = await pilotObserve(args[0], args[1]);
      console.log(`Observer diagnostics ${result.stopped ? "stopped" : "finished"}: ${result.outcomePath}`);
      if (result.stopped) process.exitCode = 1;
    } else if (command === "pilot-admit" && args.length === 2) {
      console.log(`Pilot financial admission: ${await pilotAdmit(args[0], args[1])}`);
    } else if (command === "pilot-capture" && args.length === 2) {
      console.log(`Pilot capture: ${await pilotCapture(args[0], args[1])}`);
    } else if (command === "pilot-qualify" && args.length === 3) {
      console.log(`Pilot charge qualification: ${await pilotQualify(args[0], args[1], args[2])}`);
    } else if (command === "pilot-run" && args.length === 4) {
      const result = await pilotRun(args[0], args[1], arm(args[2]), args[3]);
      console.log(`${result.runId}: machine checks ${result.passed ? "passed" : "failed"}; assessments and the gate remain separate.`);
      if (!result.passed) process.exitCode = 1;
    } else if (command === "pilot-gate" && args.length === 3) {
      const result = await pilotGate(args[0], arm(args[1]), args[2]);
      console.log(`Pilot ${args[1]} gate ${result.passed ? "passed" : "failed"}: ${result.path}`);
      if (!result.passed) process.exitCode = 1;
    } else if (command === "pilot-settle" && args.length >= 1) {
      console.log(`Pilot settlement: ${await pilotSettle(args[0], {}, args.slice(1))}`);
    } else if (command === "pilot-review-inputs" && args.length === 4) {
      console.log(`Pilot review inputs: ${await pilotReviewInputs(args[0], args[1], args[2], args[3])}`);
    } else {
      throw new Error(USAGE);
    }
    return;
  }
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
    const config = JSON.parse(await readFile(first, "utf8")) as WorkerConfig;
    const record = isPilotPhase(config.manifest?.phase) ? await runPilotWorker(config) : await runWorker(config);
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
