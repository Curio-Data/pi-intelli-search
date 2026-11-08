// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { mkdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { loadPinnedHost } from "./host.js";
import { runWorker, runSyntheticSeries, reproduce, REPO_ROOT, type WorkerConfig } from "./runner.js";
import { sourceIdentity, writeNewJson } from "./storage.js";
import type { Phase } from "./contracts.js";
import { isPilotPhase, type PilotSyntheticScenario } from "./contracts.js";
import { runPilotWorker, runPilotSyntheticSeries, analysePilotInventory, pilotObserve, pilotAdmit, pilotCapture, pilotImportCorpus, pilotQualify, pilotRun, pilotGate, pilotSettle, pilotReviewInputs, pilotCorpusReviewInputs, PILOT_SYNTHETIC_SCENARIOS } from "./pilot.js";
import { RH5_PILOT, type PilotDefinition } from "./pilot-config.js";
import { RH6_PILOT } from "./pilot-continuation.js";
import { RH7_PILOT } from "./pilot-repeat.js";
import { RH8_BASE, SUITE_MAX_PAIRS } from "./pilot-suite.js";
import {
  rehearseSuite, suiteAdmit, suiteClose, suiteCollect, suiteGate, suiteImport, suiteInterrupt, suiteObserve, suiteQualify, suiteReviewInputs, suiteSettle, suiteStatus,
  SUITE_REHEARSAL_PLANS,
} from "./suite.js";
import { analyseSuite } from "./suite-analysis.js";
import { prepareStudyPlan, verifyStudyPlan } from "./study-plan.js";
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
  "rh-v6 continuation (PILOT-CONTINUATION.md): the same commands and arguments with the rh6- prefix in place of pilot-,",
  "  bound only to the rh-v6 owner direction, root, profile, envelope and slots; pilot- commands never reach it.",
  "  Credential-free: rh6-synthetic, rh6-analyse, rh6-review-inputs, and",
  "    rh6-corpus-review-inputs <frozen-inputs.json> <new-dir>   (bounded corpus-review bundle, after step 5)",
  "  Acceptance required, in gate order: rh6-observe, rh6-admit, rh6-capture, rh6-qualify, rh6-run/rh6-gate (baseline, then candidate), rh6-settle",
  "rh-v7 single repeat (REPEAT-PROTOCOL.md): the rh6- commands with the rh7- prefix, bound only to the rh-v7 owner direction and root, except:",
  "  rh7-capture is refused; after rh7-admit run   rh7-import <implementation-acceptance.json>   (credential-free byte-for-byte rh-v6 corpus reuse)",
  "  rh7-run candidate needs the baseline's passed machine checks and known charges, not its gate; rh7-gate runs for both answers after the pair",
  "  Credential-free: rh7-synthetic, rh7-analyse, rh7-review-inputs",
  "rh-v8 paired suite (SUITE-PROTOCOL.md, rh-v8-suite-2). A plan freezes one authorised series; live commands need an acceptance binding it:",
  "  Credential-free:",
  `    run-study --pairs N --parallel-pairs K --budget-usd X --root <new-series-root> --owner-direction <json> [--owner-direction <amendment.json>] --out <new-plan.json>`,
  `              prepares an immutable plan (N 1..${SUITE_MAX_PAIRS}; K 1..N and within the ceiling); it authorises nothing by itself`,
  "    rh8-plan-verify <plan.json>                 re-verifies a plan against its owner directions; writes nothing",
  "    rh8-synthetic <new-dir> [scenario,...]      actual-host worker cases for both arms",
  "    rh8-rehearse <new-dir> [stop|clean|serial]  actual-host rehearsal of the concurrent controller (SIGINT pauses after draining)",
  "    rh8-rehearse-resume <rehearsal-dir>         resume a paused rehearsal",
  "    rh8-analyse <series-root> <plan.json> <new-dir>   full planned-population inventory and paired analysis (offline, reproducible)",
  "    rh8-runs-analyse <inventory.json> <frozen-inputs.json> <new-dir> [known-charges|no-charges]   diagnostic only",
  "  Implementation acceptance (binding planPath and planSha256) required, in gate order:",
  "    rh8-observe <acceptance.json> <auth-file>",
  "    rh8-admit <acceptance.json> <diagnostic-acceptance.json>      (financial admission and the shared ledger genesis)",
  "    rh8-import <acceptance.json>",
  "    rh8-qualify <acceptance.json> <auth-file> <corpus-acceptance.json>",
  "    rh8-collect <acceptance.json> <auth-file> <corpus-acceptance.json>   (one controller; exit 0 complete, 2 stopped, 3 paused: rerun to resume,",
  "                                                                       4 owner decision: ceiling, 5 blocked: in-flight slot needs rh8-interrupt)",
  "    rh8-status <acceptance.json>                                       (read-only; after rh8-import)",
  "    rh8-interrupt <acceptance.json> <interruption-receipt.json>       (slot without a record, or slot \"controller-lock\")",
  "    rh8-close <acceptance.json> <reason>                               (takes the controller lock; refused while a slot is in flight)",
  "    rh8-review-inputs <acceptance.json> <new-dir>                      (after collection)",
  "    rh8-gate <acceptance.json> <pair-NN-arm> <assessment-lock.json>    (after collection; one at a time)",
  "    rh8-settle <acceptance.json>",
  "  rh8-capture, rh8-run, rh8-next and rh8-corpus-review-inputs are refused.",
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
  if (command?.startsWith("rh8-") || command === "run-study") { await rh8(command, args); return; }
  if (command?.startsWith("pilot-") || command?.startsWith("rh6-") || command?.startsWith("rh7-")) {
    // Each command family is bound to exactly one frozen definition; nothing infers it from a receipt.
    const definition: PilotDefinition = command.startsWith("rh7-") ? RH7_PILOT : command.startsWith("rh6-") ? RH6_PILOT : RH5_PILOT;
    const name = `pilot-${command.slice(command.indexOf("-") + 1)}`;
    const options = { definition };
    if (name === "pilot-synthetic" && args.length >= 1 && args.length <= 2) {
      const scenarios = args[1] ? args[1].split(",") : [...PILOT_SYNTHETIC_SCENARIOS];
      if (!scenarios.every(item => (PILOT_SYNTHETIC_SCENARIOS as readonly string[]).includes(item))) throw new Error(USAGE);
      const result = await runPilotSyntheticSeries(args[0], scenarios as PilotSyntheticScenario[], undefined, definition);
      console.log(`Pilot synthetic series ${result.passed ? "matched every expected verdict" : "MISMATCHED an expected verdict"}: ${resolve(args[0])}/series-outcome.json`);
      if (!result.passed) process.exitCode = 1;
    } else if (name === "pilot-analyse" && args.length >= 3 && args.length <= 4 && (!args[3] || ["known-charges", "no-charges"].includes(args[3]))) {
      await analysePilotInventory(args[0], args[1], args[2], (args[3] ?? "known-charges") as "known-charges" | "no-charges", definition);
      console.log(`Pilot offline analysis: ${resolve(args[2])}`);
    } else if (name === "pilot-observe" && args.length === 2) {
      const result = await pilotObserve(args[0], args[1], options);
      console.log(`Observer diagnostics ${result.stopped ? "stopped" : "finished"}: ${result.outcomePath}`);
      if (result.stopped) process.exitCode = 1;
    } else if (name === "pilot-admit" && args.length === 2) {
      console.log(`Pilot financial admission: ${await pilotAdmit(args[0], args[1], options)}`);
    } else if (command === "rh7-import" && args.length === 1) {
      console.log(`Corpus import: ${await pilotImportCorpus(args[0], options)}`);
    } else if (name === "pilot-capture" && args.length === 2) {
      console.log(`Pilot capture: ${await pilotCapture(args[0], args[1], options)}`);
    } else if (name === "pilot-qualify" && args.length === 3) {
      console.log(`Pilot charge qualification: ${await pilotQualify(args[0], args[1], args[2], options)}`);
    } else if (name === "pilot-run" && args.length === 4) {
      const result = await pilotRun(args[0], args[1], arm(args[2]), args[3], options);
      console.log(`${result.runId}: machine checks ${result.passed ? "passed" : "failed"}; assessments and the gate remain separate.`);
      if (!result.passed) process.exitCode = 1;
    } else if (name === "pilot-gate" && args.length === 3) {
      const result = await pilotGate(args[0], arm(args[1]), args[2], options);
      console.log(`Pilot ${args[1]} gate ${result.passed ? "passed" : "failed"}: ${result.path}`);
      if (!result.passed) process.exitCode = 1;
    } else if (name === "pilot-settle" && args.length >= 1) {
      console.log(`Pilot settlement: ${await pilotSettle(args[0], options, args.slice(1))}`);
    } else if (name === "pilot-review-inputs" && args.length === 4) {
      console.log(`Pilot review inputs: ${await pilotReviewInputs(args[0], args[1], args[2], args[3], definition)}`);
    } else if (command === "rh6-corpus-review-inputs" && args.length === 2) {
      console.log(`Pilot corpus-review inputs: ${await pilotCorpusReviewInputs(args[0], args[1], definition)}`);
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
function flags(args: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) throw new Error(`Expected --flag value pairs; got ${key ?? "nothing"}\n${USAGE}`);
    map.set(key, [...(map.get(key) ?? []), value]);
  }
  return map;
}
function integerFlag(map: Map<string, string[]>, key: string): number {
  const value = map.get(key)?.[0];
  if (!value || !/^[1-9][0-9]*$/.test(value)) throw new Error(`${key} must be a positive integer`);
  return Number(value);
}
/**
 * SIGINT or SIGTERM ends new admissions; admitted workers run in their own process groups, so a
 * terminal interrupt does not reach them, and the controller waits for each to finish and settle.
 */
function drainOnSignal(): AbortSignal {
  const controller = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { console.error(`${signal}: no new admissions; draining admitted conversations`); controller.abort(); });
  return controller.signal;
}
const COLLECT_EXIT = { complete: 0, stopped: 2, paused: 3, "owner-decision": 4, blocked: 5 } as const;
const COLLECT_MESSAGES: Record<keyof typeof COLLECT_EXIT, (halt: string | null) => string> = {
  complete: () => "COMPLETE: every planned conversation has a terminal record.",
  paused: halt => `PAUSED, resumable: ${halt}. Resolve the cause, then rerun rh8-collect.`,
  stopped: halt => `STOPPED under the Stop Rules: ${halt}. No further admission is possible; proceed to grading and settlement.`,
  blocked: halt => `BLOCKED: ${halt}. Inspect the in-flight slot and record an interruption with rh8-interrupt before anything else.`,
  "owner-decision": halt => `OWNER DECISION: ${halt}. Nothing is running and the next full reservation does not fit the shared ceiling.`,
};
/** rh-v8 suite commands. The family is bound to the plan-driven rh-v8 base; nothing infers authority from a receipt. */
async function rh8(command: string, args: string[]): Promise<void> {
  const refused: Record<string, string> = {
    "rh8-capture": "rh8-capture is refused: rh-v8 reuses the rh-v6 corpus through rh8-import (SUITE-PROTOCOL.md, Corpus Reuse)",
    "rh8-run": "rh8-run is refused: paid conversations run only through rh8-collect, in the frozen plan (SUITE-PROTOCOL.md, Schedule)",
    "rh8-next": "rh8-next is refused: the unaccepted serial driver is superseded by rh8-collect (SUITE-PROTOCOL.md, Schedule)",
    "rh8-corpus-review-inputs": "rh8-corpus-review-inputs is refused: the rh-v6 corpus review is reused (SUITE-PROTOCOL.md, Corpus Reuse)",
  };
  if (refused[command]) throw new Error(refused[command]);
  if (command === "run-study" || command === "rh8-plan") {
    const map = flags(args);
    for (const key of map.keys()) if (!["--pairs", "--parallel-pairs", "--budget-usd", "--root", "--owner-direction", "--out"].includes(key)) throw new Error(`Unknown flag ${key}`);
    const required = (key: string) => { const value = map.get(key); if (!value?.length) throw new Error(`${key} is required`); return value; };
    const result = await prepareStudyPlan({ pairs: integerFlag(map, "--pairs"), parallelPairs: integerFlag(map, "--parallel-pairs"), budgetUsd: required("--budget-usd")[0],
      root: required("--root")[0], directionPaths: required("--owner-direction") }, required("--out")[0]);
    console.log(JSON.stringify({ planPath: result.path, planSha256: result.sha256, seriesRoot: result.plan.seriesRoot, pairs: result.plan.pairs,
      parallelPairs: result.plan.parallelPairs, waves: result.plan.waves, budget: result.plan.budget,
      launchOrder: result.plan.schedule.map(spec => `${spec.wave}:${spec.slot}`),
      next: "Bind planPath and planSha256 in an implementation acceptance after independent review; the plan alone authorises nothing." }, null, 2));
    return;
  }
  if (command === "rh8-plan-verify" && args.length === 1) {
    const verified = await verifyStudyPlan(args[0]);
    console.log(JSON.stringify({ planPath: verified.path, planSha256: verified.sha256, seriesRoot: verified.plan.seriesRoot, pairs: verified.plan.pairs,
      parallelPairs: verified.plan.parallelPairs, authority: verified.plan.authority, verified: true }, null, 2));
    return;
  }
  if (command === "rh8-synthetic" && args.length >= 1 && args.length <= 2) {
    const scenarios = args[1] ? args[1].split(",") : [...PILOT_SYNTHETIC_SCENARIOS];
    if (!scenarios.every(item => (PILOT_SYNTHETIC_SCENARIOS as readonly string[]).includes(item))) throw new Error(USAGE);
    const result = await runPilotSyntheticSeries(args[0], scenarios as PilotSyntheticScenario[], undefined, RH8_BASE);
    console.log(`Suite synthetic series ${result.passed ? "matched every expected verdict" : "MISMATCHED an expected verdict"}: ${resolve(args[0])}/series-outcome.json`);
    if (!result.passed) process.exitCode = 1;
    return;
  }
  if ((command === "rh8-rehearse" && args.length >= 1 && args.length <= 2 && (!args[1] || args[1] in SUITE_REHEARSAL_PLANS))
    || (command === "rh8-rehearse-resume" && args.length === 1)) {
    const result = await rehearseSuite(args[0], (args[1] ?? "stop") as keyof typeof SUITE_REHEARSAL_PLANS, { signal: drainOnSignal(), resume: command === "rh8-rehearse-resume" });
    console.log(result.paused ? `Suite rehearsal PAUSED by signal after draining; resume with rh8-rehearse-resume: ${result.path}`
      : `Suite rehearsal ${result.passed ? "matched its expected schedule" : `MISMATCHED: ${result.problems.join("; ")}`}: ${result.path}`);
    if (result.paused) process.exitCode = 3; else if (!result.passed) process.exitCode = 1;
    return;
  }
  if (command === "rh8-analyse" && args.length === 3) {
    await analyseSuite(args[0], args[2], { phase: "pilot", planPath: args[1] });
    console.log(`Suite inventory and paired analysis: ${resolve(args[2])}`);
    return;
  }
  if (command === "rh8-runs-analyse" && args.length >= 3 && args.length <= 4 && (!args[3] || ["known-charges", "no-charges"].includes(args[3]))) {
    await analysePilotInventory(args[0], args[1], args[2], (args[3] ?? "known-charges") as "known-charges" | "no-charges", RH8_BASE);
    console.log(`Suite per-run machine analysis (diagnostic): ${resolve(args[2])}`);
    return;
  }
  if (command === "rh8-observe" && args.length === 2) {
    const result = await suiteObserve(args[0], args[1]);
    console.log(`Observer diagnostics ${result.stopped ? "stopped" : "finished"}: ${result.outcomePath}`);
    if (result.stopped) process.exitCode = 1;
  } else if (command === "rh8-admit" && args.length === 2) {
    console.log(`Suite financial admission and ledger genesis: ${await suiteAdmit(args[0], args[1])}`);
  } else if (command === "rh8-import" && args.length === 1) {
    console.log(`Corpus import: ${await suiteImport(args[0])}`);
  } else if (command === "rh8-qualify" && args.length === 3) {
    console.log(`Suite charge qualification: ${await suiteQualify(args[0], args[1], args[2])}`);
  } else if (command === "rh8-collect" && args.length === 3) {
    const result = await suiteCollect(args[0], args[1], args[2], { signal: drainOnSignal() });
    console.log(JSON.stringify(result, null, 2));
    console.log(COLLECT_MESSAGES[result.outcome](result.halt));
    process.exitCode = COLLECT_EXIT[result.outcome];
  } else if (command === "rh8-status" && args.length === 1) {
    console.log(JSON.stringify(await suiteStatus(args[0]), null, 2));
  } else if (command === "rh8-interrupt" && args.length === 2) {
    console.log(`Interruption recorded: ${await suiteInterrupt(args[0], args[1])}`);
  } else if (command === "rh8-close" && args.length === 2) {
    console.log(`Collection closed: ${await suiteClose(args[0], args[1])}`);
  } else if (command === "rh8-review-inputs" && args.length === 2) {
    console.log(`Suite review inputs: ${await suiteReviewInputs(args[0], args[1])}`);
  } else if (command === "rh8-gate" && args.length === 3) {
    const result = await suiteGate(args[0], args[1], args[2]);
    console.log(`${args[1]} gate ${result.passed ? "passed" : "failed"}: ${result.path}`);
  } else if (command === "rh8-settle" && args.length === 1) {
    console.log(`Suite settlement: ${await suiteSettle(args[0])}`);
  } else {
    throw new Error(USAGE);
  }
}
main().catch(error => { console.error(String(error)); process.exitCode = 1; });
