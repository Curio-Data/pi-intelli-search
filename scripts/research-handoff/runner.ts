// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";
import { join, resolve, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPinnedHost, createStudySession, createRecorder, allowedToolsForArm, SYNTHETIC_MODEL_ID, SYNTHETIC_PROVIDER_ID, type SyntheticScript } from "./host.js";
import { createBenchmarkResearchExtension } from "./registration.js";
import { loadFrozenInputs, settleInputIntegrity, assertCorpusAcceptable } from "./common-inputs.js";
import { studySettings, taskPrompt, MAIN_MODEL, BUDGET } from "./config.js";
import { syntheticInputs, syntheticDownstream } from "./fixtures.js";
import { AttemptBudget } from "./budget.js";
import { createGuardedCallLlm } from "./pipeline-client.js";
import { assertStoredCredentialReady } from "./credentials.js";
import { analyseRun, analysePairs, renderAnalysisMarkdown } from "./analyse.js";
import { DurableJournal, createRunDirectory, digestObject, digestText, digestFile, sourceIdentity, writeNewJson, loadInventory, unavailableRecord } from "./storage.js";
import { isPilotPhase, type PilotWorkerOptions, type Arm, type Phase, type RunManifest, type RunRecord } from "./contracts.js";
import { applyAssessmentBundle } from "./assessment-bundle.js";
import { checkReturnContract } from "./return-contract.js";
import { observedPipelineOutcome } from "./outcome.js";
import { PILOT_SERIES_ROOT } from "./pilot-config.js";

export const REPO_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const PROTOCOL_PATH = join(REPO_ROOT, "docs/experiments/research-handoff/PROTOCOL.md");
export interface WorkerConfig {
  schemaVersion: 1;
  manifest: RunManifest;
  directory: string;
  workspace: string;
  agentDir: string;
  frozenPath: string;
  acceptancePath?: string;
  /** A path reference only; never credential material. */
  authPath?: string;
  /** rh-v5 pilot workers only. */
  pilot?: PilotWorkerOptions;
}
export interface LiveAcceptance {
  schemaVersion: 1;
  phase: "diagnostic" | "measured";
  protocolSha256: string;
  codeSha256: string;
  corpusSha256: string;
  runIds: string[];
  acceptedBy: "coordinator";
  technicalReviewPath: string;
  technicalReviewSha256: string;
  seriesRoot: string;
  costQualificationPath?: string;
  corpusAcceptancePath?: string;
  financialMode?: "fixed-envelope";
  financialAdmissionPath?: string;
  financialAdmissionSha256?: string;
}

export async function assertLiveEvidenceRoot(path: string): Promise<void> {
  // rh-v4 authority never reaches the rh-v5 pilot root, whatever its receipts claim.
  if (resolve(path) === resolve(PILOT_SERIES_ROOT)) throw new Error("The rh-v5 pilot root accepts only pilot authority; historical rh-v4 operations are refused");
  const base = await realpath(join(REPO_ROOT, "evidence/benchmarks/research-handoff"));
  const actual = await realpath(resolve(path));
  const rel = relative(base, actual);
  if (!rel || rel.startsWith("..") || rel.split(/[\\/]/).includes(".tmp") || actual !== resolve(path)) {
    throw new Error("Live series must use a distinct real evidence directory in this checkout, never a scratch clone");
  }
}
export function assertFixedAdmissionIdentity(admission: unknown, codeSha256: string, protocolSha256: string): void {
  const value = admission as { accepted?: unknown; mode?: unknown; codeSha256?: unknown; protocolSha256?: unknown; envelopeNanoUsd?: unknown };
  if (value.accepted !== true || value.mode !== "fixed-envelope" || value.codeSha256 !== codeSha256
    || value.protocolSha256 !== protocolSha256 || value.envelopeNanoUsd !== BUDGET.batchNanoUsd) {
    throw new Error("Fixed-envelope financial admission is missing or changed");
  }
}

export async function validateLiveAcceptance(cfg: WorkerConfig, rootCheck: (path: string) => Promise<void> = assertLiveEvidenceRoot): Promise<void> {
  if (!cfg.acceptancePath || !cfg.authPath) throw new Error("Live inference requires a recorded acceptance and an explicit credential reference");
  const acceptance = JSON.parse(await readFile(cfg.acceptancePath, "utf8")) as LiveAcceptance;
  await rootCheck(acceptance.seriesRoot);
  if (acceptance.schemaVersion !== 1 || acceptance.acceptedBy !== "coordinator" || acceptance.phase !== cfg.manifest.phase
    || acceptance.protocolSha256 !== cfg.manifest.protocolSha256 || acceptance.codeSha256 !== cfg.manifest.codeSha256
    || acceptance.corpusSha256 !== cfg.manifest.corpusSha256 || !acceptance.runIds.includes(cfg.manifest.runId)) {
    throw new Error("Live acceptance does not cover this exact observation");
  }
  if (!acceptance.technicalReviewPath || await digestFile(acceptance.technicalReviewPath) !== acceptance.technicalReviewSha256) throw new Error("Independent technical review is missing or changed");
  const expectedDirectory = join(resolve(acceptance.seriesRoot), "runs", cfg.manifest.runId);
  if (resolve(cfg.directory) !== expectedDirectory || resolve(cfg.workspace) !== join(expectedDirectory, "workspace")
    || resolve(cfg.agentDir) !== join(expectedDirectory, "agent")) throw new Error("Worker paths differ from the accepted series");
  if (cfg.manifest.phase === "measured") {
    if (acceptance.financialMode !== "fixed-envelope") throw new Error("Fixed-envelope financial admission is required");
    if (!acceptance.financialAdmissionPath || await digestFile(acceptance.financialAdmissionPath) !== acceptance.financialAdmissionSha256) {
      throw new Error("Fixed-envelope financial admission is missing or changed");
    }
    assertFixedAdmissionIdentity(JSON.parse(await readFile(acceptance.financialAdmissionPath, "utf8")), cfg.manifest.codeSha256, cfg.manifest.protocolSha256);
    if (!acceptance.costQualificationPath || !acceptance.corpusAcceptancePath) throw new Error("Cost/corpus qualification is missing");
    const cost = JSON.parse(await readFile(acceptance.costQualificationPath, "utf8"));
    const corpus = JSON.parse(await readFile(acceptance.corpusAcceptancePath, "utf8"));
    for (const receipt of [cost, corpus]) {
      if (receipt.accepted !== true || receipt.codeSha256 !== cfg.manifest.codeSha256 || receipt.protocolSha256 !== cfg.manifest.protocolSha256
        || receipt.corpusSha256 !== cfg.manifest.corpusSha256) throw new Error("Cost/corpus qualification differs from the accepted batch");
    }
  }
  const admissions = join(resolve(acceptance.seriesRoot), "admissions");
  await mkdir(admissions, { recursive: true });
  await mkdir(join(admissions, cfg.manifest.runId)); // permanent claim: no duplicate live observation
}
function syntheticScript(arm: Arm, params: unknown): SyntheticScript {
  const args = arm === "baseline" ? params : { code: `return await tools.intelli_research(${JSON.stringify(params)});` };
  return [
    [{ kind: "response", status: 200, turn: { items: [{ type: "function_call", name: arm === "baseline" ? "intelli_research" : "codemode", args }],
      usage: { input_tokens: 120, output_tokens: 45, cached_tokens: 20, reasoning_tokens: 5 } } }],
    [{ kind: "response", status: 200, turn: { items: [{ type: "message", text: "Synthetic final answer: the research operation returned its summary and saved evidence references. This is a credential-free adapter check, not measured research." }],
      usage: { input_tokens: 220, output_tokens: 35, cached_tokens: 40, reasoning_tokens: 5 } } }],
  ];
}
export async function evidenceAccess(record: RunRecord, workspace: string): Promise<RunRecord["evidenceAccess"]> {
  const results = record.adapterEvents.filter(event => event.kind === "research-result");
  const reports: string[] = [], problems: string[] = [];
  for (const result of results) {
    const details = result.data.details as { cachePath?: unknown } | undefined;
    if (typeof details?.cachePath !== "string" || !details.cachePath) { problems.push("Research returned no cache path"); continue; }
    const file = resolve(workspace, details.cachePath, "report.md");
    try {
      const physical = await realpath(file), root = await realpath(workspace);
      if (relative(root, physical).startsWith("..")) throw new Error("Report escapes workspace");
      const content = await readFile(physical, "utf8");
      if (!content.trim()) throw new Error("Empty report");
      const reference = `${details.cachePath}/report.md`;
      if (!record.toolCalls.some(call => call.resultText?.includes(reference))) throw new Error("Saved report reference absent from observed tool results");
      reports.push(reference);
      const sourceDir = join(physical, "..", "sources");
      if (!(await readdir(sourceDir)).length) throw new Error("No saved sources");
    } catch (error) { problems.push(String(error)); }
  }
  if (!reports.length) problems.push("No readable report established");
  return { readable: reports.length > 0 && problems.length === 0, reportPaths: reports, problems };
}

export async function runWorker(cfg: WorkerConfig): Promise<RunRecord> {
  if (cfg.schemaVersion !== 1 || cfg.manifest.status !== "scheduled") throw new Error("Invalid scheduled worker configuration");
  const phase = cfg.manifest.phase;
  // The historical rh-v4 worker never executes a pilot mode; the CLI routes those to the pilot worker.
  if (isPilotPhase(phase)) throw new Error("Pilot phases are executed only by the separate pilot worker");
  const identity = await sourceIdentity(REPO_ROOT);
  if (identity.digest !== cfg.manifest.codeSha256 || await digestFile(PROTOCOL_PATH) !== cfg.manifest.protocolSha256) throw new Error("Code/protocol identity changed before worker dispatch");
  if (cfg.manifest.phase !== "synthetic") await validateLiveAcceptance(cfg);
  const frozen = await loadFrozenInputs({ path: cfg.frozenPath });
  assertCorpusAcceptable({ frozen });
  if (frozen.digest !== cfg.manifest.corpusSha256 || digestObject(studySettings()) !== cfg.manifest.settingsSha256) throw new Error("Input/settings identity changed before worker dispatch");
  if ((await readdir(cfg.workspace)).length) throw new Error("Worker workspace is not empty");
  process.env.PI_CODING_AGENT_DIR = cfg.agentDir;
  await writeFile(join(cfg.agentDir, "settings.json"), JSON.stringify({ "pi-intelli-search": studySettings() }) + "\n", { flag: "wx" });
  const durable = new DurableJournal(cfg.directory, cfg.manifest.runId);
  const host = await loadPinnedHost();
  if (digestObject(host.identity) !== digestObject(cfg.manifest.host)) throw new Error("Loaded host differs from accepted identity");
  const synthetic = cfg.manifest.phase === "synthetic";
  if (!synthetic) assertStoredCredentialReady(host.sdk, cfg.authPath!, MAIN_MODEL.provider);
  if (cfg.manifest.phase === "measured") assertStoredCredentialReady(host.sdk, cfg.authPath!, "openrouter");
  const syntheticResearch = cfg.manifest.phase !== "measured";
  let session: Awaited<ReturnType<typeof createStudySession>> | undefined;
  const fatalControlKinds = new Set(["budget-rejected", "budget-overrun", "extract-hash-mismatch", "corpus-digest-mismatch", "fetch-mismatch", "params-mismatch", "settings-mismatch", "input-control-failed"]);
  const sink = { record(event: Parameters<DurableJournal["record"]>[0]) {
    durable.record(event);
    if (fatalControlKinds.has(event.kind) && session) {
      queueMicrotask(() => { void session?.abort().catch(error => durable.record({ kind: "worker-abort-error", data: { error: String(error) } })); });
    }
  } };
  const recorder = createRecorder(cfg.manifest.runId, cfg.manifest.arm, allowedToolsForArm(cfg.manifest.arm), synthetic ? SYNTHETIC_MODEL_ID : MAIN_MODEL.model, sink);
  const budget = new AttemptBudget(syntheticResearch ? 0 : BUDGET.runNanoUsd, recorder);
  const prompt = taskPrompt(cfg.manifest.arm, frozen.capture.params, phase);
  if (digestText(prompt) !== cfg.manifest.promptSha256) throw new Error("Rendered prompt changed");
  const manifest: RunManifest = { ...cfg.manifest, status: "started", startedAt: new Date().toISOString(), host: host.identity };
  writeNewJson(join(cfg.directory, "started.json"), manifest);
  let failure: string | undefined;
  try {
    session = await createStudySession(host, {
      runId: manifest.runId, arm: manifest.arm, phase,
      workspaceDir: cfg.workspace, agentDir: cfg.agentDir,
      credentials: synthetic ? { kind: "inmemory", credentials: {} } : { kind: "readonly-file", authPath: cfg.authPath! },
      research: { extension: createBenchmarkResearchExtension as Parameters<typeof createStudySession>[1]["research"]["extension"],
        frozenPath: cfg.frozenPath, expectedDigest: frozen.digest, callLlmDelegate: syntheticResearch ? syntheticDownstream
          : createGuardedCallLlm({ runId: manifest.runId, budget, journal: recorder }) },
      ...(synthetic ? { syntheticScript: syntheticScript(manifest.arm, frozen.capture.params) } : {}),
    }, recorder);
    await session.prompt(prompt);
  } catch (error) {
    failure = String(error); recorder.noteError(failure);
    recorder.record({ kind: "worker-error", data: { error: failure } });
  }
  const observation = session ? session.observation() : recorder.output();
  session?.dispose();
  const record: RunRecord = { manifest: { ...manifest, endedAt: new Date().toISOString(), status: failure ? "failed" : recorder.outcome() },
    ...observation, ...(failure ? { error: failure } : {}) };
  record.inputIntegrity = settleInputIntegrity({ frozen, events: record.adapterEvents });
  record.pipelineOutcome = observedPipelineOutcome(record);
  record.financialControl = {
    budgetLimited: record.adapterEvents.some(event => event.kind === "budget-rejected"),
    overrun: record.adapterEvents.some(event => event.kind === "budget-overrun"),
    activeReservations: budget.snapshot().activeNanoUsd > 0,
  };
  record.evidenceAccess = await evidenceAccess(record, cfg.workspace);
  return persistRunRecord(cfg.directory, record, budget.snapshot());
}

/** Preserve the receipt and complete observation even if strict analysis rejects its shape. */
export function persistRunRecord(directory: string, record: RunRecord, budget: ReturnType<AttemptBudget["snapshot"]>): RunRecord {
  writeNewJson(join(directory, "budget.json"), budget);
  let summary: ReturnType<typeof analyseRun> | undefined;
  try {
    const returned = checkReturnContract(record);
    if (!returned.preserved) {
      record.conformance.conforms = false;
      record.conformance.problems.push(...returned.problems);
    }
    summary = analyseRun(record);
  }
  catch (error) {
    record.analysisError = `Post-run analysis rejected the retained observation: ${String(error)}`;
    record.manifest.status = "failed";
  }
  if (record.analysisError || !record.finalAnswer || !record.inputIntegrity.matched || !record.inputIntegrity.complete
    || !record.observerCoverage.verified || !record.evidenceAccess.readable || record.financialControl?.budgetLimited
    || record.financialControl?.overrun || record.financialControl?.activeReservations) {
    record.manifest.status = "failed";
  } else if (!summary?.conforms) {
    record.manifest.status = "nonconforming";
  }
  writeNewJson(join(directory, "record.json"), record);
  return record;
}

export async function runSyntheticSeries(output: string): Promise<void> {
  const directory = resolve(output);
  await mkdir(directory); // never overwrite a prior series
  const host = await loadPinnedHost(), code = await sourceIdentity(REPO_ROOT);
  const protocolSha256 = await digestFile(PROTOCOL_PATH);
  const frozen = await syntheticInputs(protocolSha256);
  const frozenPath = join(directory, "frozen-inputs.json");
  writeNewJson(frozenPath, frozen);
  writeNewJson(join(directory, "identity.json"), { host: host.identity, code, protocolSha256 });
  const inventory: string[] = [];
  for (const arm of ["baseline", "candidate"] as const) {
    const runId = `${basename(directory)}-${arm}`;
    const paths = createRunDirectory(join(directory, "runs"), runId);
    const manifest: RunManifest = {
      schemaVersion: 1, runId, arm, phase: "synthetic", pair: 1, status: "scheduled", host: host.identity,
      mainModel: { provider: SYNTHETIC_PROVIDER_ID, model: SYNTHETIC_MODEL_ID },
      protocolSha256, codeSha256: code.digest, corpusSha256: frozen.digest,
      settingsSha256: digestObject(studySettings()), promptSha256: digestText(taskPrompt(arm, frozen.capture.params)),
    };
    const cfg: WorkerConfig = { schemaVersion: 1, manifest, ...paths, frozenPath };
    await executeWorker(cfg);
    inventory.push(relative(directory, join(paths.directory, "record.json")));
  }
  writeNewJson(join(directory, "inventory.json"), inventory);
  const records = await loadInventory(join(directory, "inventory.json"), "synthetic");
  const analysis = analysePairs(records, { phase: "synthetic" });
  writeNewJson(join(directory, "analysis.json"), analysis);
  if (records.some(record => record.manifest.status !== "completed")) throw new Error("Synthetic series retained failing observations; inspect record.json/process.log");
}

export async function executeWorker(cfg: WorkerConfig): Promise<RunRecord> {
  // Synthetic modes are credential-free and short; every other mode keeps the independent 30-minute ceiling.
  const workerTimeoutMs = cfg.manifest.phase === "pilot-synthetic" && cfg.pilot?.workerCeilingMs !== undefined
    ? Math.min(cfg.pilot.workerCeilingMs, 120_000)
    : cfg.manifest.phase === "synthetic" || cfg.manifest.phase === "pilot-synthetic" ? 120_000 : 1_800_000;
  const configPath = join(cfg.directory, "worker.json");
  writeNewJson(configPath, cfg);
  const log = createWriteStream(join(cfg.directory, "process.log"), { flags: "wx", mode: 0o600 });
  const env: NodeJS.ProcessEnv = { ...process.env, PI_CODING_AGENT_DIR: cfg.agentDir, HOME: cfg.agentDir, TMPDIR: cfg.agentDir };
  for (const key of Object.keys(env)) if (/(?:API_KEY|AUTH_TOKEN|OAUTH_TOKEN)$/.test(key)) delete env[key];
  const child = spawn(process.execPath, ["--import", "tsx", join(REPO_ROOT, "scripts/research-handoff/cli.ts"), "worker", configPath],
    { cwd: REPO_ROOT, env, stdio: ["ignore", "pipe", "pipe"], timeout: workerTimeoutMs });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  let signal: NodeJS.Signals | null = null;
  const exit = await new Promise<number | null>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", (code, closeSignal) => { signal = closeSignal; resolveExit(code); });
  });
  await new Promise<void>(resolveLog => log.end(resolveLog));
  writeNewJson(join(cfg.directory, "process-exit.json"), { exit, signal, workerTimeoutMs });
  const path = join(cfg.directory, "record.json");
  try { await stat(path); }
  catch {
    writeNewJson(path, unavailableRecord(cfg.manifest.runId, cfg.manifest.phase,
      `Worker exited ${exit} without a final record; process log and any raw events are retained`, cfg.manifest));
  }
  try { return JSON.parse(await readFile(path, "utf8")) as RunRecord; }
  catch (error) { return unavailableRecord(cfg.manifest.runId, cfg.manifest.phase, `Final record cannot be read: ${String(error)}`, cfg.manifest); }
}

export async function reproduce(inventoryPath: string, output: string, phase: Phase = "measured", assessmentsPath?: string): Promise<void> {
  const rawRecords = await loadInventory(inventoryPath, phase);
  const records = assessmentsPath ? await applyAssessmentBundle(rawRecords, assessmentsPath) : rawRecords;
  const analysis = analysePairs(records, { phase });
  await mkdir(resolve(output));
  writeNewJson(join(resolve(output), "analysis.json"), analysis);
  await writeFile(join(resolve(output), "summary.md"), renderAnalysisMarkdown(analysis), { flag: "wx", mode: 0o600 });
  const analyserIdentity = await sourceIdentity(REPO_ROOT);
  const analyserProtocolSha256 = await digestFile(PROTOCOL_PATH);
  const recordsCodeSha256 = [...new Set(rawRecords.map(record => record.manifest.codeSha256))];
  const recordsProtocolSha256 = [...new Set(rawRecords.map(record => record.manifest.protocolSha256))];
  const identical = rawRecords.length > 0 && recordsCodeSha256.every(hash => hash === analyserIdentity.digest)
    && recordsProtocolSha256.every(hash => hash === analyserProtocolSha256);
  writeNewJson(join(resolve(output), "inputs.json"), {
    inventorySha256: await digestFile(inventoryPath), assessmentsSha256: assessmentsPath ? await digestFile(assessmentsPath) : undefined,
    phase, analyserIdentity, analyserProtocolSha256, recordsCodeSha256, recordsProtocolSha256, identical,
    ...(!identical ? { advisory: "Read-only re-analysis used a different or unavailable implementation/protocol identity than the retained records; do not represent it as an identity-matched reproduction." } : {}),
  });
}
