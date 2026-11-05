// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { appendFileSync, writeFileSync } from "node:fs";
import { join, resolve, relative, basename } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadPinnedHost, writeIsolatedModelsOverlay, readOnlyFileCredentialStore } from "./host.js";
import { createNativeOperationContext } from "../../src/native-operation-context.js";
import { fetchPages } from "../../src/core/fetch.js";
import { buildExtractionMessage } from "../../src/core/messages.js";
import { EXTRACTION_SYSTEM_PROMPT } from "../../src/core/prompts.js";
import { studySettings, studyParams, taskPrompt, pairedSchedule, MAIN_MODEL, BUDGET, BASELINE_COMMIT, FINANCIAL_APPROVAL_SCOPE } from "./config.js";
import { createGuardedCallLlm, providerReportedCost } from "./pipeline-client.js";
import { assertStoredCredentialReady } from "./credentials.js";
import { AttemptBudget } from "./budget.js";
import { captureCommonInputs } from "./capture.js";
import { loadFrozenInputs, assertCorpusAcceptable } from "./common-inputs.js";
import { DurableJournal, createRunDirectory, digestFile, digestObject, digestText, sourceIdentity, writeNewJson, unavailableRecord } from "./storage.js";
import { executeWorker, REPO_ROOT, assertLiveEvidenceRoot, assertFixedAdmissionIdentity, type LiveAcceptance, type WorkerConfig } from "./runner.js";
import type { Arm, RunManifest, RunRecord, JournalEvent, FrozenInputs } from "./contracts.js";

export interface PreparationAcceptance {
  schemaVersion: 1;
  phase: "preparation";
  acceptedBy: "coordinator";
  seriesRoot: string;
  codeSha256: string;
  protocolSha256: string;
  technicalReviewPath: string;
  technicalReviewSha256: string;
  financialMode: "fixed-envelope";
  fixedEnvelopeNanoUsd: number;
  ownerFinancialApprovalPath: string;
  ownerFinancialApprovalSha256: string;
  /** Independent observer diagnostics must already be retained and accepted. */
  diagnosticAcceptancePath: string;
}
const protocolFile = join(REPO_ROOT, "docs/experiments/research-handoff/PROTOCOL.md");

export function assertFixedEnvelopeApproval(owner: unknown): void {
  const approval = owner as { schemaVersion?: unknown; approvedAt?: unknown; approvedBy?: unknown; approved?: unknown; scope?: unknown; maximumExperimentEnvelopeNanoUsd?: unknown };
  if (approval.schemaVersion !== 1 || typeof approval.approvedAt !== "string" || !approval.approvedAt
    || approval.approvedBy !== "owner" || approval.approved !== true || approval.scope !== FINANCIAL_APPROVAL_SCOPE
    || approval.maximumExperimentEnvelopeNanoUsd !== BUDGET.batchNanoUsd) {
    throw new Error("Owner approval does not cover the bounded no-ledger experiment");
  }
}

type RootCheck = (path: string) => Promise<void>;
async function verifyPreparationIdentity(path: string, rootCheck: RootCheck): Promise<PreparationAcceptance> {
  const a = JSON.parse(await readFile(path, "utf8")) as PreparationAcceptance;
  if (a.schemaVersion !== 1 || a.phase !== "preparation" || a.acceptedBy !== "coordinator"
    || a.financialMode !== "fixed-envelope" || a.fixedEnvelopeNanoUsd !== BUDGET.batchNanoUsd
    || "programmeLedgerPath" in a || "programmeReservationId" in a) throw new Error("Preparation authority is not the accepted fixed-envelope mode");
  await rootCheck(a.seriesRoot);
  if (!a.ownerFinancialApprovalPath || await digestFile(a.ownerFinancialApprovalPath) !== a.ownerFinancialApprovalSha256) {
    throw new Error("Fixed-envelope financial approval is missing or changed");
  }
  assertFixedEnvelopeApproval(JSON.parse(await readFile(a.ownerFinancialApprovalPath, "utf8")));
  if ((await sourceIdentity(REPO_ROOT)).digest !== a.codeSha256 || await digestFile(protocolFile) !== a.protocolSha256) throw new Error("Preparation code/protocol identity changed");
  if (await digestFile(a.technicalReviewPath) !== a.technicalReviewSha256) throw new Error("Technical review identity changed");
  const diagnostic = JSON.parse(await readFile(a.diagnosticAcceptancePath, "utf8"));
  if (diagnostic.accepted !== true || diagnostic.codeSha256 !== a.codeSha256 || diagnostic.protocolSha256 !== a.protocolSha256) {
    throw new Error(`Actual-provider observer diagnostics are not accepted: expected ${a.codeSha256}/${a.protocolSha256}, received ${String(diagnostic.codeSha256)}/${String(diagnostic.protocolSha256)}`);
  }
  return a;
}
export async function verifyPreparationAuthority(path: string, rootCheck: RootCheck = assertLiveEvidenceRoot): Promise<PreparationAcceptance> {
  const a = await verifyPreparationIdentity(path, rootCheck);
  const admission = JSON.parse(await readFile(join(a.seriesRoot, "financial-admission-receipt.json"), "utf8"));
  assertFixedAdmissionIdentity(admission, a.codeSha256, a.protocolSha256);
  return a;
}
export async function admitAcceptedPreparation(path: string, rootCheck: RootCheck = assertLiveEvidenceRoot): Promise<void> {
  const a = await verifyPreparationIdentity(path, rootCheck);
  const response = await fetch("https://openrouter.ai/api/v1/models");
  if (!response.ok) throw new Error(`Rate catalogue unavailable (${response.status})`);
  const data = await response.json() as { data: Array<{ id: string; context_length: number; pricing: Record<string, string> }> };
  const sonar = data.data.find(m => m.id === "perplexity/sonar"), m3 = data.data.find(m => m.id === "minimax/minimax-m3");
  if (!sonar || !m3 || sonar.context_length > 127072 || m3.context_length > 1048576
    || Number(sonar.pricing.prompt) > 0.000001 || Number(sonar.pricing.completion) > 0.000001 || Number(sonar.pricing.web_search) > 0.005
    || Number(m3.pricing.prompt) > 0.0000003 || Number(m3.pricing.completion) > 0.0000012
    || !Number.isSafeInteger(sonar.context_length) || !Number.isSafeInteger(m3.context_length) || sonar.context_length <= 0 || m3.context_length <= 0
    || [sonar.pricing.prompt, sonar.pricing.completion, sonar.pricing.web_search, m3.pricing.prompt, m3.pricing.completion].some(v => typeof v !== "string" || v.trim() === "" || !Number.isFinite(Number(v)) || Number(v) < 0)) {
    throw new Error("Current catalogue exceeds or does not establish the accepted cost bounds");
  }
  await mkdir(join(a.seriesRoot, "financial-admission"));
  writeNewJson(join(a.seriesRoot, "rates-at-admission.json"), { observedAt: new Date().toISOString(), sonar, m3 });
  writeNewJson(join(a.seriesRoot, "financial-admission-receipt.json"), {
    accepted: true, mode: "fixed-envelope", codeSha256: a.codeSha256, protocolSha256: a.protocolSha256,
    envelopeNanoUsd: BUDGET.batchNanoUsd, programmeLedgerCreated: false,
  });
}
export async function assertCredentialReady(authPath: string, provider: string): Promise<void> {
  const { sdk } = await loadPinnedHost();
  assertStoredCredentialReady(sdk, authPath, provider);
}
async function nativeContext(agentDir: string, workspace: string, authPath: string, budget: AttemptBudget, journal: DurableJournal, runId: string) {
  process.env.PI_CODING_AGENT_DIR = agentDir;
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ "pi-intelli-search": studySettings() }) + "\n", { flag: "wx" });
  const host = await loadPinnedHost();
  await writeIsolatedModelsOverlay(agentDir);
  const runtime = await host.sdk.ModelRuntime.create({
    credentials: readOnlyFileCredentialStore(host.sdk, authPath), modelsPath: join(agentDir, "models.json"),
    allowModelNetwork: false, refreshOnCreate: false,
  });
  const ctx = { cwd: workspace, isProjectTrusted: () => false, modelRegistry: new host.sdk.ModelRegistry(runtime), ui: {} } as unknown as ExtensionContext;
  return createNativeOperationContext(ctx, undefined, createGuardedCallLlm({ runId, budget, journal }));
}
function successfulReportedCharge(events: JournalEvent[], stage: string): boolean {
  const last = [...events].reverse().find(e => e.kind === "pipeline-completion" && e.stage === stage
    && (e.data.stopReason === "stop" || e.data.stopReason === "length"));
  return !!last && providerReportedCost({ usage: last.data.rawUsage }) !== undefined;
}

/** Paid entry: requires accepted diagnostics and a programme reservation before reading auth. */
export async function prepareCapture(authorityPath: string, authPath: string): Promise<string> {
  const a = await verifyPreparationAuthority(authorityPath);
  const paths = createRunDirectory(resolve(a.seriesRoot), "capture");
  const journal = new DurableJournal(paths.directory, `${basename(a.seriesRoot)}-capture`);
  const budget = new AttemptBudget(BUDGET.captureNanoUsd, journal);
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  let frozen: FrozenInputs | undefined, failure: string | undefined;
  try {
    await assertCredentialReady(authPath, "openrouter");
    const context = await nativeContext(paths.agentDir, paths.workspace, authPath, budget, journal, "capture");
    frozen = await captureCommonInputs({ params: studyParams(), context, fetchPages, journal,
      meta: { capturedAt: new Date().toISOString(), coreCommit: BASELINE_COMMIT, protocolRef: a.protocolSha256 } });
    writeNewJson(join(paths.directory, "frozen-inputs.json"), frozen);
    assertCorpusAcceptable({ frozen });
    if (!successfulReportedCharge(journal.events, "search")) throw new Error("Sonar did not report a numeric charge; stop before any measured work");
    if (budget.snapshot().stopped || budget.snapshot().activeNanoUsd) throw new Error("Capture financial state is not settled");
  } catch (error) { failure = String(error); }
  finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    writeNewJson(join(paths.directory, "budget.json"), budget.snapshot());
    writeNewJson(join(paths.directory, "outcome.json"), { accepted: failure === undefined, error: failure,
      codeSha256: a.codeSha256, protocolSha256: a.protocolSha256, corpusSha256: frozen?.digest,
      sonarReportedCharge: successfulReportedCharge(journal.events, "search") });
  }
  if (failure) throw new Error(failure);
  return join(paths.directory, "frozen-inputs.json");
}

export async function qualifyDownstreamCost(authorityPath: string, authPath: string, corpusAcceptancePath: string): Promise<string> {
  const a = await verifyPreparationAuthority(authorityPath);
  const frozen = await loadFrozenInputs({ path: join(a.seriesRoot, "capture/frozen-inputs.json") });
  assertCorpusAcceptable({ frozen });
  const corpus = JSON.parse(await readFile(corpusAcceptancePath, "utf8"));
  if (corpus.accepted !== true || corpus.corpusSha256 !== frozen.digest || corpus.codeSha256 !== a.codeSha256
    || corpus.protocolSha256 !== a.protocolSha256) throw new Error("Source topic/version acceptance is missing");
  const capture = JSON.parse(await readFile(join(a.seriesRoot, "capture/outcome.json"), "utf8"));
  if (capture.accepted !== true || capture.sonarReportedCharge !== true) throw new Error("Sonar charge reporting is not qualified");
  const paths = createRunDirectory(a.seriesRoot, "cost-qualification");
  const journal = new DurableJournal(paths.directory, `${basename(a.seriesRoot)}-cost-qualification`);
  const budget = new AttemptBudget(BUDGET.costQualificationNanoUsd, journal);
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  let failure: string | undefined;
  try {
    await assertCredentialReady(authPath, "openrouter");
    const context = await nativeContext(paths.agentDir, paths.workspace, authPath, budget, journal, "cost-qualification");
    const page = frozen.pages.find(item => item.page.status === "success")!.page;
    const settings = context.settings;
    const completion = await context.models.complete({ model: settings.extractModel, systemPrompt: EXTRACTION_SYSTEM_PROMPT,
      userMessage: buildExtractionMessage(page.content, frozen.capture.params.query, frozen.capture.params.focusPrompt, settings.extractMaxChars),
      maxTokens: settings.extractionMaxTokens, timeoutMs: settings.llmTimeoutMs,
      retry: { attempts: settings.llmRetryAttempts, baseDelayMs: settings.retryBaseDelayMs, maxDelayMs: settings.retryMaxDelayMs } });
    writeNewJson(join(paths.directory, "completion.json"), { usageBasis: "sdk-normalised-estimate", completion });
    if (!completion.text.trim() || !successfulReportedCharge(journal.events, "extract")) throw new Error("M3 did not produce a nonempty completion with a numeric reported charge");
    if (budget.snapshot().stopped || budget.snapshot().activeNanoUsd) throw new Error("Cost qualification financial state is not settled");
  } catch (error) { failure = String(error); }
  finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    writeNewJson(join(paths.directory, "budget.json"), budget.snapshot());
    writeNewJson(join(paths.directory, "outcome.json"), { accepted: failure === undefined, error: failure,
      codeSha256: a.codeSha256, protocolSha256: a.protocolSha256, corpusSha256: frozen.digest,
      sonarReportedCharge: true, m3ReportedCharge: successfulReportedCharge(journal.events, "extract") });
  }
  if (failure) throw new Error(failure);
  return join(paths.directory, "outcome.json");
}

/** Sequential schedule driver with injected boundaries for deterministic positive-path tests. */
export async function driveAcceptedSchedule(options: {
  root: string;
  phase: LiveAcceptance["phase"];
  schedule: Array<{ pair: number; arm: Arm }>;
  ids: string[];
  manifests: RunManifest[];
  acceptancePath: string;
  authPath: string;
  frozenPath: string;
  execute?: typeof executeWorker;
  credentialCheck?: typeof assertCredentialReady;
  sleep?: (milliseconds: number) => Promise<void>;
}): Promise<{ stopped: boolean; reason?: string; outcomePath: string }> {
  const { root, phase, schedule, ids, manifests, acceptancePath, authPath, frozenPath } = options;
  const execute = options.execute ?? executeWorker;
  const credentialCheck = options.credentialCheck ?? assertCredentialReady;
  const sleep = options.sleep ?? (milliseconds => new Promise<void>(resolveGap => setTimeout(resolveGap, milliseconds)));
  const progressPath = join(root, "collection-progress.jsonl");
  writeFileSync(progressPath, "", { flag: "wx", mode: 0o600 });
  const inventory: string[] = [];
  let stop: string | undefined;
  for (const [index] of schedule.entries()) {
    const paths = createRunDirectory(join(root, "runs"), ids[index]);
    const manifest = manifests[index];
    let record: RunRecord;
    if (stop) {
      record = unavailableRecord(manifest.runId, phase, `Not run: ${stop}`, manifest);
      record.manifest.status = "not-run";
      writeNewJson(join(paths.directory, "record.json"), record);
    } else {
      try {
        await credentialCheck(authPath, "openai-codex");
        const cfg: WorkerConfig = { schemaVersion: 1, manifest, ...paths, frozenPath, acceptancePath, authPath };
        record = await execute(cfg);
        if (record.analysisError || !record.inputIntegrity.matched || !record.observerCoverage.verified
          || record.financialControl?.budgetLimited || record.financialControl?.overrun || record.financialControl?.activeReservations) {
          stop = `Control/accounting failure in ${manifest.runId}`;
        }
      } catch (error) {
        stop = String(error); record = unavailableRecord(manifest.runId, phase, stop, manifest);
        try { await stat(join(paths.directory, "record.json")); } catch { writeNewJson(join(paths.directory, "record.json"), record); }
      }
    }
    const recordPath = relative(root, join(paths.directory, "record.json"));
    inventory.push(recordPath);
    appendFileSync(progressPath, JSON.stringify({ index, runId: manifest.runId, recordPath, status: record.manifest.status, stop: stop ?? null }) + "\n", { flush: true });
    if (!stop && index + 1 < schedule.length) await sleep(30_000);
  }
  writeNewJson(join(root, "inventory.json"), inventory);
  const outcomePath = join(root, "collection-outcome.json");
  writeNewJson(outcomePath, { stopped: stop !== undefined, reason: stop, observations: inventory.length, progressPath });
  return { stopped: stop !== undefined, reason: stop, outcomePath };
}

/** Sequential owner-accepted schedule. No replacement observations or automatic diagnostic reruns. */
export async function collectAcceptedSeries(acceptancePath: string, authPath: string, frozenPath: string): Promise<{ stopped: boolean; reason?: string; outcomePath: string }> {
  const a = JSON.parse(await readFile(acceptancePath, "utf8")) as LiveAcceptance;
  if (a.phase !== "diagnostic" && a.phase !== "measured") throw new Error("Not a conversation acceptance");
  const root = resolve(a.seriesRoot);
  await assertLiveEvidenceRoot(root);
  const frozen = await loadFrozenInputs({ path: frozenPath });
  const host = await loadPinnedHost(), code = await sourceIdentity(REPO_ROOT), protocolSha256 = await digestFile(protocolFile);
  if (code.digest !== a.codeSha256 || protocolSha256 !== a.protocolSha256 || frozen.digest !== a.corpusSha256) throw new Error("Accepted series identity changed");
  assertCorpusAcceptable({ frozen });
  const schedule = a.phase === "measured" ? pairedSchedule() : [{ pair: 1, arm: "baseline" as const }, { pair: 1, arm: "candidate" as const }];
  const ids = schedule.map(({ pair, arm }) => `${basename(root)}-${a.phase}-${String(pair).padStart(2, "0")}-${arm}`);
  if (JSON.stringify(ids) !== JSON.stringify(a.runIds)) throw new Error("Accepted run IDs/order do not match the frozen schedule");
  const manifests: RunManifest[] = schedule.map((item, index) => ({ schemaVersion: 1, runId: ids[index], arm: item.arm, phase: a.phase, pair: item.pair,
    status: "scheduled", host: host.identity, mainModel: MAIN_MODEL,
    protocolSha256, codeSha256: code.digest, corpusSha256: frozen.digest,
    settingsSha256: digestObject(studySettings()), promptSha256: digestText(taskPrompt(item.arm, frozen.capture.params, a.phase)) }));
  writeNewJson(join(root, "schedule.json"), schedule.map((item, index) => ({ ...item, runId: ids[index] })));
  return driveAcceptedSchedule({ root, phase: a.phase, schedule, ids, manifests, acceptancePath, authPath, frozenPath });
}

/** Explicit close-out only: an absent started-stage receipt is held at its full ceiling. */
export async function settleAcceptedSeries(authorityPath: string, rootCheck: RootCheck = assertLiveEvidenceRoot): Promise<void> {
  const a = await verifyPreparationAuthority(authorityPath, rootCheck);
  let terminal = false;
  try { const outcome = JSON.parse(await readFile(join(a.seriesRoot, "collection-outcome.json"), "utf8")); terminal = typeof outcome.stopped === "boolean"; } catch { /* preparation may have stopped first */ }
  if (!terminal) {
    try { const corpus = JSON.parse(await readFile(join(a.seriesRoot, "corpus-acceptance.json"), "utf8")); if (corpus.accepted === false) terminal = true; } catch { /* no source-rejection decision */ }
    for (const stage of ["capture", "cost-qualification"]) {
      try { const outcome = JSON.parse(await readFile(join(a.seriesRoot, stage, "outcome.json"), "utf8")); if (outcome.accepted === false) terminal = true; } catch { /* no terminal failure here */ }
    }
  }
  if (!terminal) throw new Error("Series has no terminal collection or preparation-failure record; do not settle active work");
  let reported = 0, unknown = 0;
  const stages = [
    { path: join(a.seriesRoot, "capture"), cap: BUDGET.captureNanoUsd },
    { path: join(a.seriesRoot, "cost-qualification"), cap: BUDGET.costQualificationNanoUsd },
    ...pairedSchedule().map(({ pair, arm }) => ({ path: join(a.seriesRoot, "runs", `${basename(a.seriesRoot)}-measured-${String(pair).padStart(2, "0")}-${arm}`), cap: BUDGET.runNanoUsd })),
  ];
  const receipts: unknown[] = [];
  for (const stage of stages) {
    try { await stat(stage.path); } catch { receipts.push({ path: stage.path, notStarted: true }); continue; }
    let record: RunRecord | undefined;
    try { record = JSON.parse(await readFile(join(stage.path, "record.json"), "utf8")); } catch { /* preparation has no conversation */ }
    if (record?.manifest.status === "not-run") { receipts.push({ path: stage.path, notStarted: true }); continue; }
    try {
      const budget = JSON.parse(await readFile(join(stage.path, "budget.json"), "utf8"));
      for (const key of ["knownNanoUsd", "unknownNanoUsd", "activeNanoUsd"]) if (!Number.isSafeInteger(budget[key]) || budget[key] < 0) throw new Error("Malformed budget receipt");
      if (budget.limitNanoUsd !== stage.cap) throw new Error("Budget receipt belongs to a different allowance");
      reported += budget.knownNanoUsd; unknown += budget.unknownNanoUsd + budget.activeNanoUsd;
      receipts.push({ path: stage.path, budget });
    } catch (error) {
      unknown += stage.cap;
      receipts.push({ path: stage.path, heldNanoUsd: stage.cap, reason: "Final budget unavailable or invalid", detail: String(error) });
    }
  }
  writeNewJson(join(a.seriesRoot, "settlement-review.json"), { reportedNanoUsd: reported, unknownNanoUsd: unknown, receipts });
  const liability = reported + unknown;
  writeNewJson(join(a.seriesRoot, "settlement-receipt.json"), {
    mode: "fixed-envelope", reportedNanoUsd: reported, unknownNanoUsd: unknown,
    releasedNanoUsd: Math.max(0, BUDGET.batchNanoUsd - liability),
    overrunNanoUsd: Math.max(0, liability - BUDGET.batchNanoUsd), programmeLedgerCreated: false,
  });
}
