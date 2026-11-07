// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// rh-v5 bounded pilot path (PILOT-PROTOCOL.md, revision rh-v5-pilot-1).
// Separate from the historical rh-v4 runner/collector: its own phases,
// protocol, settings, downstream guards, budgets, operation claims, worker,
// machine checks and settlement walk. Historical modules are imported only
// for shared mechanics (host, recorder, registration, storage).

import { constants as fsConstants } from "node:fs";
import { copyFile, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve, relative } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { callLlm } from "../../src/llm.js";
import { createNativeOperationContext } from "../../src/native-operation-context.js";
import { fetchPages } from "../../src/core/fetch.js";
import { buildExtractionMessage } from "../../src/core/messages.js";
import { EXTRACTION_SYSTEM_PROMPT, COLLATION_SYSTEM_PROMPT, SEARCH_SYSTEM_PROMPT } from "../../src/core/prompts.js";
import { loadPinnedHost, createStudySession, createRecorder, allowedToolsForArm, writeIsolatedModelsOverlay, readOnlyFileCredentialStore,
  SYNTHETIC_MODEL_ID, SYNTHETIC_PROVIDER_ID, type SyntheticScript, type SyntheticTurn } from "./host.js";
import { createBenchmarkResearchExtension } from "./registration.js";
import { loadFrozenInputs, settleInputIntegrity, assertCorpusAcceptable, verifyFrozenInputs } from "./common-inputs.js";
import { BASELINE_COMMIT, MAIN_MODEL } from "./config.js";
import { syntheticInputs, syntheticDownstream } from "./fixtures.js";
import { AttemptBudget } from "./budget.js";
import { createGuardedCallLlm, providerReportedCost, type DownstreamLimits } from "./pipeline-client.js";
import { assertStoredCredentialReady } from "./credentials.js";
import { captureCommonInputs } from "./capture.js";
import { DurableJournal, createRunDirectory, digestFile, digestObject, digestText, sourceIdentity, writeNewJson, unavailableRecord } from "./storage.js";
import { executeWorker, evidenceAccess, REPO_ROOT, type WorkerConfig } from "./runner.js";
import { observedPipelineOutcome } from "./outcome.js";
import { analysePilotRun, type PilotMachineResult } from "./pilot-analysis.js";
import {
  verifyPilotImplementation, verifyStageReceipt, claimPilotSlot, readPilotClaim, markPilotDispatch, assessPilotAnswerGate, assessRecoveryPurpose,
  type PilotAssessmentLock,
  assertPilotSchedule, fileExists, type PilotAuthorityOptions, type VerifiedPilotAuthority,
} from "./pilot-authority.js";
import {
  PILOT_BUDGET, PILOT_CODEMODE_MAX_OUTPUT_TOKENS, PILOT_RUBRICS, PILOT_TOPICS, PILOT_MIN_GAP_MS, PILOT_PROFILE, PILOT_PROTOCOL_PATH, PILOT_PROTOCOL_REVISION, PILOT_SCOPE,
  pilotAllocationFor, pilotParams, pilotRunId, pilotSettings, pilotTaskPrompt, pilotAllocation, RH5_PILOT, type PilotDefinition, type PilotSlot,
} from "./pilot-config.js";
import { syntheticContinuationInputs } from "./pilot-continuation.js";
import { pilotDefinitionFor, verifyReusedCorpus } from "./pilot-repeat.js";
import { isPilotPhase, type Arm, type FrozenInputs, type JournalEvent, type PilotSyntheticScenario, type PilotWorkerOptions, type RunManifest, type RunRecord } from "./contracts.js";

/** On-wire and reservation guards for every downstream attempt of a pilot definition. */
export function pilotDownstreamLimits(definition: PilotDefinition): DownstreamLimits {
  const { profile, budget } = definition;
  return {
    maxTokens: { search: 2000, fetch: 0, extract: profile.extractionMaxTokens, collate: profile.collationMaxTokens },
    boundsNanoUsd: { search: budget.sonarAttemptNanoUsd, fetch: 0, extract: budget.m3AttemptNanoUsd, collate: budget.m3AttemptNanoUsd },
    maxAttempts: profile.downstreamAttemptsPerCall,
    exactWireLimit: true,
    timeoutMs: profile.llmTimeoutMs,
  };
}
export const PILOT_DOWNSTREAM_LIMITS: DownstreamLimits = pilotDownstreamLimits(RH5_PILOT);
export async function pilotProtocolSha256(definition: PilotDefinition = RH5_PILOT): Promise<string> {
  try { return await digestFile(definition.protocolPath); }
  catch { throw new Error(`Pilot protocol ${definition.protocolPath} is missing; pilot modes cannot run without the frozen contract`); }
}
/** Observer and synthetic corpora: rh-v6 builds its invented corpus through the real source derivation. */
async function pilotSyntheticCorpus(definition: PilotDefinition, protocolSha256: string): Promise<FrozenInputs> {
  return definition.sourcePolicy ? syntheticContinuationInputs(protocolSha256, definition) : syntheticInputs(protocolSha256, definition.settings());
}
const sleep = (milliseconds: number) => new Promise<void>(resolveSleep => setTimeout(resolveSleep, milliseconds));
const readJson = async (path: string) => JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;

// ---------------------------------------------------------------------------
// Credential-free synthetic cases
// ---------------------------------------------------------------------------

export const PILOT_SYNTHETIC_SCENARIOS: readonly PilotSyntheticScenario[] = [
  "complete", "recovery", "truncated", "failed", "recovery-limit", "budget-refused", "unknown-charge", "worker-ceiling",
  "long-complete", "default-limit-truncated", "observer-complete",
];
/** Arms per case. The default-limit case is a candidate-only Codemode display check. */
export const PILOT_SYNTHETIC_ARMS: Partial<Record<PilotSyntheticScenario, readonly Arm[]>> = { "default-limit-truncated": ["candidate"] };
/** Long collation text: above Codemode's default 40,000-character display budget, below the 100,000-token one. */
export const SYNTHETIC_LONG_COLLATION_CHARS = 48_000;
export const SYNTHETIC_WORKER_CEILING_MS = 25_000;
/** Each case's expected machine verdict and the check it must fail. */
export const PILOT_SYNTHETIC_EXPECTATIONS: Record<PilotSyntheticScenario, { passed: boolean; failing?: string; recoveryCalls?: number }> = {
  complete: { passed: true, recoveryCalls: 0 },
  recovery: { passed: true, recoveryCalls: 1 },
  truncated: { passed: false, failing: "collation-nonempty-untruncated" },
  failed: { passed: false, failing: "pipeline-completed" },
  "recovery-limit": { passed: false, failing: "settled-final-answer-within-bounds" },
  "budget-refused": { passed: false, failing: "financial-accounting-known" },
  "unknown-charge": { passed: false, failing: "financial-accounting-known" },
  "worker-ceiling": { passed: false, failing: "analysable" },
  "long-complete": { passed: true, recoveryCalls: 0 },
  "default-limit-truncated": { passed: false, failing: "initial-return-preserved" },
  "observer-complete": { passed: true, recoveryCalls: 0 },
};
export const PILOT_SYNTHETIC_FINANCIAL: Partial<Record<PilotSyntheticScenario, PilotWorkerOptions["financialMode"]>> = { "observer-complete": "no-charges" };
const SYNTHETIC_COST_USD = 0.000125;

function reportPathIn(payload: unknown): string {
  const match = /\.search\/[A-Za-z0-9._-]+\/report\.md/.exec(JSON.stringify(payload ?? ""));
  if (!match) throw new Error("Synthetic recovery found no saved report reference in the request");
  return match[0];
}
function usage(input: number, output: number) { return { input_tokens: input, output_tokens: output, cached_tokens: 0, reasoning_tokens: 0 }; }
export function pilotSyntheticScript(arm: Arm, scenario: PilotSyntheticScenario, params: unknown): SyntheticScript {
  const research: SyntheticTurn = { items: [arm === "baseline"
    ? { type: "function_call", name: "intelli_research", args: params }
    : { type: "function_call", name: "codemode", args: { code: `${scenario === "default-limit-truncated" ? "" : `// @options: {"max_output_tokens": ${PILOT_CODEMODE_MAX_OUTPUT_TOKENS}}\n`}return await tools.intelli_research(${JSON.stringify(params)});` } }], usage: usage(1200, 60) };
  let reads = 0;
  const read = { kind: "dynamic" as const, build: (payload: unknown): SyntheticTurn => {
    const path = reportPathIn(payload), callId = `call_recovery_${++reads}`;
    return { items: [arm === "baseline"
      ? { type: "function_call", name: "read", args: { path }, callId }
      : { type: "function_call", name: "codemode", args: { code: `return await tools.read({ path: ${JSON.stringify(path)} });` }, callId }], usage: usage(2400, 40) };
  } };
  const final: SyntheticTurn = { items: [{ type: "message", text: "Synthetic final answer citing the saved report reference. This is a credential-free pilot check, not research." }], usage: usage(3000, 50) };
  const ok = (turn: SyntheticTurn) => [{ kind: "response" as const, status: 200, turn }];
  if (scenario === "recovery") return [ok(research), [read], ok(final)];
  if (scenario === "recovery-limit") return [ok(research), [read], [read], [read]];
  return [ok(research), ok(final)];
}

/** A synthetic model registry below the REAL pilot guard: payload caps, reservations and settlement all execute. */
export function syntheticRegistry(scenario: PilotSyntheticScenario, searchText = "Synthetic discovery: [Alpha](https://handoff.invalid/alpha) and [Beta](https://handoff.invalid/beta).") {
  return {
    find: (provider: string, id: string) => ({ provider, id, api: "openai-completions", name: id }),
    getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "synthetic-no-network", headers: {} }),
    streamSimple(model: { provider: string; id: string }, context: { systemPrompt?: string }, options: Record<string, unknown> = {}) {
      return { result: async () => {
        const stage = context.systemPrompt === COLLATION_SYSTEM_PROMPT ? "collate" : context.systemPrompt === EXTRACTION_SYSTEM_PROMPT ? "extract"
          : context.systemPrompt === SEARCH_SYSTEM_PROMPT ? "search" : "other";
        const maxTokens = options.maxTokens as number;
        const onPayload = options.onPayload as ((payload: unknown, model: unknown) => Promise<unknown>) | undefined;
        await onPayload?.({ model: model.id, max_tokens: maxTokens, messages: [] }, model);
        if (scenario === "worker-ceiling") {
          await new Promise<never>((_resolve, reject) => {
            const signal = options.signal as AbortSignal | undefined;
            signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          });
        }
        const truncated = scenario === "truncated" && stage === "collate";
        const failed = scenario === "failed" && stage === "collate";
        const output = truncated ? maxTokens : 120;
        const onEvent = options.onProviderStreamEvent as ((event: unknown) => void) | undefined;
        if (scenario !== "unknown-charge") onEvent?.({ provider: "synthetic-route", usage: { prompt_tokens: 900, completion_tokens: output, cost: SYNTHETIC_COST_USD } });
        else onEvent?.({ provider: "synthetic-route", usage: { prompt_tokens: 900, completion_tokens: output } });
        const long = scenario === "long-complete" || scenario === "default-limit-truncated";
        const summary = "## Synthetic Summary\n\nThe supplied pages yielded synthetic evidence for the pilot return check.";
        const text = stage === "collate"
          ? (long ? `${summary}\n\n${"Synthetic long collation line for the display-budget check.\n".repeat(Math.ceil(SYNTHETIC_LONG_COLLATION_CHARS / 59))}` : summary)
          : stage === "search" ? searchText
          : "Synthetic extracted evidence for the pilot check; not a factual result.";
        return {
          role: "assistant", api: "openai-completions", provider: model.provider, model: model.id, timestamp: Date.now(),
          content: failed ? [] : [{ type: "text", text }],
          usage: { input: 900, output, cacheRead: 0, cacheWrite: 0, totalTokens: 900 + output,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: failed ? "error" : truncated ? "length" : "stop",
          ...(failed ? { errorMessage: "synthetic permanent provider rejection (400 bad request)" } : {}),
        };
      } };
    },
  };
}
export function pilotSyntheticDownstream(scenario: PilotSyntheticScenario, guarded: typeof callLlm): typeof callLlm {
  const registry = syntheticRegistry(scenario);
  return (ctx, ...rest) => guarded({ ...ctx, modelRegistry: registry } as unknown as typeof ctx, ...rest);
}

// ---------------------------------------------------------------------------
// Pilot worker
// ---------------------------------------------------------------------------

function slotForRun(phase: RunManifest["phase"], arm: Arm): PilotSlot {
  if (phase === "pilot-diagnostic") return arm === "baseline" ? "observer-baseline" : "observer-candidate";
  if (phase === "pilot") return arm === "baseline" ? "pilot-baseline" : "pilot-candidate";
  throw new Error("Synthetic pilot runs claim no operation slot");
}

/** F1: every selected page must have been captured; a partial capture ends preparation. */
export function assertAllSelectedPagesCaptured(frozen: Pick<FrozenInputs, "pages">): void {
  const failed = frozen.pages.map((item, index) => ({ index, status: item.page.status, url: item.page.url })).filter(item => item.status !== "success");
  if (failed.length) throw new Error(`Capture has ${failed.length} failed selected page(s) (${failed.map(item => `#${item.index + 1} ${item.url}`).join(", ")}); every selected page must be captured`);
}

/**
 * The series corpus stage: the capture (rh-v5, rh-v6) or the byte-for-byte import of a
 * retained corpus (rh-v7). A reuse series never accepts a capture receipt, and the
 * imported file must still hold the recorded source bytes.
 */
export async function verifyCorpusStage(authority: VerifiedPilotAuthority, captureExtra: Record<string, unknown> = {}): Promise<{ corpusSha256: string; frozenPath: string }> {
  const root = authority.root, reuse = authority.definition.corpusReuse;
  if (!reuse) {
    const capture = await verifyStageReceipt(join(root, "capture", "outcome.json"), "pilot-capture-outcome", authority, captureExtra);
    return { corpusSha256: String(capture.corpusSha256), frozenPath: join(root, "capture", "frozen-inputs.json") };
  }
  const frozenPath = join(root, "corpus-import", "frozen-inputs.json");
  const imported = await verifyStageReceipt(join(root, "corpus-import", "outcome.json"), "pilot-corpus-import-outcome", authority,
    { corpusSha256: reuse.digest, frozenFileSha256: reuse.sha256, newSearchChargeNanoUsd: 0 });
  if (await digestFile(frozenPath) !== reuse.sha256) throw new Error("Imported corpus bytes differ from the retained source");
  return { corpusSha256: String(imported.corpusSha256), frozenPath };
}

/**
 * rh-v7 candidate admission: the baseline conversation must be retained with passed machine
 * checks, a final budget receipt and known charges only. Its answer gate is not consulted;
 * both answers are graded after the pair. An unreadable, failed or unsafe baseline blocks.
 */
export async function verifyBaselineCollected(authority: VerifiedPilotAuthority, frozenPath: string, corpusSha256: string, now = Date.now()) {
  const root = authority.root, runId = pilotRunId(root, "pilot", "baseline"), directory = join(root, "runs", runId);
  const claim = await readPilotClaim(root, "pilot-baseline");
  if (!claim || claim.runId !== runId || claim.corpusSha256 !== corpusSha256 || claim.implementationAcceptanceSha256 !== authority.acceptanceSha256
    || !await fileExists(join(root, "claims", "pilot-baseline", "dispatched"))) {
    throw new Error("Candidate requires the claimed baseline conversation of this series with a dispatch witness");
  }
  const frozen = await loadFrozenInputs({ path: frozenPath });
  const checks = await pilotChecksFor(directory, frozen, "known-charges");
  let record: RunRecord;
  try { record = JSON.parse(await readFile(join(directory, "record.json"), "utf8")) as RunRecord; }
  catch (error) { throw new Error(`Candidate requires a readable baseline record: ${String(error)}`); }
  const failing = checks.checks.filter(check => !check.pass).map(check => check.id);
  if (!checks.passed || !checks.budgetReceipt || checks.financial.unknownNanoUsd !== 0 || checks.financial.activeNanoUsd !== 0
    || checks.financial.rejected !== 0 || checks.financial.overruns !== 0 || record.manifest?.runId !== runId || record.manifest.status !== "completed"
    || record.manifest.corpusSha256 !== corpusSha256 || record.manifest.arm !== "baseline" || record.manifest.phase !== "pilot"
    || record.manifest.codeSha256 !== authority.acceptance.codeSha256 || record.manifest.protocolSha256 !== authority.acceptance.protocolSha256) {
    throw new Error(`Candidate requires a baseline with passed machine checks and known charges only; failing: ${failing.join(", ") || "record identity or financial state"}`);
  }
  const ended = Date.parse(String(record.manifest.endedAt));
  if (!Number.isFinite(ended) || now - ended < PILOT_MIN_GAP_MS) throw new Error("Candidate must start at least 30 seconds after the baseline worker ended");
  return { baselineRunId: runId, baselineRecordSha256: digestObject(record), baselineEndedAt: record.manifest.endedAt, baselineMachineChecksPassed: true,
    baselineKnownNanoUsd: checks.financial.knownNanoUsd };
}

/** Gates for a paid pilot conversation: admission, corpus stage, corpus review, qualification; candidate also needs the baseline gate (rh-v7: the collected baseline). */
export async function verifyPaidPrerequisites(authority: VerifiedPilotAuthority, arm: Arm, corpusAcceptancePath: string, now = Date.now()): Promise<{ corpusSha256: string; baseline?: Record<string, unknown> }> {
  const root = authority.root;
  await verifyStageReceipt(join(root, "financial-admission-receipt.json"), "pilot-financial-admission", authority);
  const { corpusSha256, frozenPath } = await verifyCorpusStage(authority, { sonarReportedCharge: true });
  const corpus = await verifyStageReceipt(corpusAcceptancePath, "pilot-corpus-acceptance", authority, { corpusSha256 });
  if (typeof corpus.reviewer !== "string" || !corpus.reviewPath || await digestFile(String(corpus.reviewPath)) !== corpus.reviewSha256
    || typeof corpus.readableSelectedPages !== "number" || corpus.readableSelectedPages < 2) {
    throw new Error("Corpus acceptance lacks a fresh reviewer, immutable review or at least two readable selected pages");
  }
  await verifyStageReceipt(join(root, "charge-qualification", "outcome.json"), "pilot-charge-qualification-outcome", authority, { corpusSha256, m3ReportedCharge: true });
  if (arm === "candidate" && authority.definition.gradingAfterPair) {
    return { corpusSha256, baseline: await verifyBaselineCollected(authority, frozenPath, corpusSha256, now) };
  }
  if (arm === "candidate") {
    const gate = await verifyStageReceipt(join(root, "pilot-baseline-gate.json"), "pilot-baseline-gate", authority, { passed: true });
    const ended = Date.parse(String(gate.baselineEndedAt));
    if (!Number.isFinite(ended) || now - ended < PILOT_MIN_GAP_MS) throw new Error("Candidate must start at least 30 seconds after the baseline worker ended");
  }
  return { corpusSha256 };
}

/** Live worker admission. The worker calls it without seams; tests pass isolated fixture authority only. */
export async function validatePilotWorker(cfg: WorkerConfig, options: PilotAuthorityOptions & { now?: () => number } = {}): Promise<void> {
  if (!cfg.acceptancePath || !cfg.authPath) throw new Error("Live pilot inference requires an implementation acceptance and an explicit credential reference");
  const definition = pilotDefinitionFor(cfg.pilot?.revision);
  const authority = await verifyPilotImplementation(cfg.acceptancePath, { ...options, definition });
  const expected = join(authority.root, "runs", cfg.manifest.runId);
  if (resolve(cfg.directory) !== expected || resolve(cfg.workspace) !== join(expected, "workspace") || resolve(cfg.agentDir) !== join(expected, "agent")) {
    throw new Error("Pilot worker paths differ from the designated series");
  }
  if (cfg.manifest.codeSha256 !== authority.acceptance.codeSha256 || cfg.manifest.protocolSha256 !== authority.acceptance.protocolSha256) {
    throw new Error("Pilot worker identity differs from the accepted implementation");
  }
  const slot = slotForRun(cfg.manifest.phase, cfg.manifest.arm);
  const claim = await readPilotClaim(authority.root, slot);
  if (!claim || claim.runId !== cfg.manifest.runId || claim.corpusSha256 !== cfg.manifest.corpusSha256
    || claim.implementationAcceptanceSha256 !== authority.acceptanceSha256) throw new Error(`No matching ${slot} claim`);
  if (cfg.manifest.phase === "pilot") {
    if (cfg.pilot?.budgetNanoUsd !== pilotAllocation(definition, cfg.manifest.arm) || cfg.pilot.financialMode !== "known-charges") throw new Error("Paid pilot allowance differs from the allocation");
    const { corpusSha256 } = await verifyPaidPrerequisites(authority, cfg.manifest.arm, String(claim.corpusAcceptancePath), options.now?.());
    if (corpusSha256 !== cfg.manifest.corpusSha256) throw new Error("Paid pilot corpus differs from the accepted capture");
  } else if (cfg.pilot?.budgetNanoUsd !== 0 || cfg.pilot.financialMode !== "no-charges") {
    throw new Error("Observer diagnostics admit no chargeable downstream calls");
  }
  await markPilotDispatch(authority.root, slot, cfg.manifest.runId);
}

export async function runPilotWorker(cfg: WorkerConfig): Promise<RunRecord> {
  const phase = cfg.manifest.phase;
  if (cfg.schemaVersion !== 1 || cfg.manifest.status !== "scheduled" || !isPilotPhase(phase) || !cfg.pilot) {
    throw new Error("Invalid scheduled pilot worker configuration");
  }
  let definition: PilotDefinition;
  try { definition = pilotDefinitionFor(cfg.pilot.revision); } catch { throw new Error("Invalid scheduled pilot worker configuration"); }
  const options: PilotWorkerOptions = cfg.pilot;
  const synthetic = phase === "pilot-synthetic";
  if (synthetic && !options.scenario) throw new Error("Synthetic pilot workers require a scenario");
  if (!synthetic && options.scenario) throw new Error("Live pilot workers never run synthetic scenarios");
  const identity = await sourceIdentity(REPO_ROOT);
  if (identity.digest !== cfg.manifest.codeSha256 || await pilotProtocolSha256(definition) !== cfg.manifest.protocolSha256) throw new Error("Code/pilot protocol identity changed before worker dispatch");
  if (!synthetic) await validatePilotWorker(cfg);
  const frozen = await loadFrozenInputs({ path: cfg.frozenPath });
  assertCorpusAcceptable({ frozen });
  if (frozen.digest !== cfg.manifest.corpusSha256 || digestObject(definition.settings()) !== cfg.manifest.settingsSha256
    || digestObject(frozen.settings) !== cfg.manifest.settingsSha256) throw new Error("Input/settings identity changed before worker dispatch");
  // A derived-source series replays only derived corpora, and an earlier series never replays one.
  if (!!definition.sourcePolicy !== !!frozen.sourceDerivation || (frozen.sourceDerivation && frozen.sourceDerivation.policy.id !== definition.sourcePolicy?.id)) {
    throw new Error("Frozen corpus source derivation differs from the pilot definition");
  }
  if ((await readdir(cfg.workspace)).length) throw new Error("Worker workspace is not empty");
  process.env.PI_CODING_AGENT_DIR = cfg.agentDir;
  await writeFile(join(cfg.agentDir, "settings.json"), JSON.stringify({ "pi-intelli-search": definition.settings() }) + "\n", { flag: "wx" });
  const durable = new DurableJournal(cfg.directory, cfg.manifest.runId);
  const host = await loadPinnedHost();
  if (digestObject(host.identity) !== digestObject(cfg.manifest.host)) throw new Error("Loaded host differs from accepted identity");
  if (!synthetic) assertStoredCredentialReady(host.sdk, cfg.authPath!, MAIN_MODEL.provider);
  if (phase === "pilot") assertStoredCredentialReady(host.sdk, cfg.authPath!, "openrouter");
  let session: Awaited<ReturnType<typeof createStudySession>> | undefined;
  const fatal = new Set(["budget-rejected", "budget-overrun", "extract-hash-mismatch", "corpus-digest-mismatch", "fetch-mismatch", "params-mismatch", "settings-mismatch", "input-control-failed"]);
  const sink = { record(event: JournalEvent) {
    durable.record(event);
    if (fatal.has(event.kind) && session) queueMicrotask(() => { void session?.abort().catch(error => durable.record({ kind: "worker-abort-error", data: { error: String(error) } })); });
  } };
  const recorder = createRecorder(cfg.manifest.runId, cfg.manifest.arm, allowedToolsForArm(cfg.manifest.arm),
    synthetic ? SYNTHETIC_MODEL_ID : MAIN_MODEL.model, sink, "evidence-permitted");
  const budget = new AttemptBudget(options.budgetNanoUsd, recorder);
  const guarded = createGuardedCallLlm({ runId: cfg.manifest.runId, budget, journal: recorder, limits: pilotDownstreamLimits(definition) });
  // Explicit per-mode downstream: only the paid pilot reaches real extraction/collation.
  const downstream: typeof callLlm = phase === "pilot" ? guarded
    : phase === "pilot-diagnostic" || options.scenario === "observer-complete" ? syntheticDownstream : pilotSyntheticDownstream(options.scenario!, guarded);
  const prompt = pilotTaskPrompt(cfg.manifest.arm, frozen.capture.params, pilotOpening(phase, options.scenario));
  if (digestText(prompt) !== cfg.manifest.promptSha256) throw new Error("Rendered pilot prompt changed");
  const manifest: RunManifest = { ...cfg.manifest, status: "started", startedAt: new Date().toISOString(), host: host.identity };
  writeNewJson(join(cfg.directory, "started.json"), manifest);
  let failure: string | undefined;
  try {
    session = await createStudySession(host, {
      runId: manifest.runId, arm: manifest.arm, phase, workspaceDir: cfg.workspace, agentDir: cfg.agentDir,
      credentials: synthetic ? { kind: "inmemory", credentials: {} } : { kind: "readonly-file", authPath: cfg.authPath! },
      research: { extension: createBenchmarkResearchExtension as Parameters<typeof createStudySession>[1]["research"]["extension"],
        frozenPath: cfg.frozenPath, expectedDigest: frozen.digest, callLlmDelegate: downstream },
      ...(synthetic ? { syntheticScript: pilotSyntheticScript(manifest.arm, options.scenario!, frozen.capture.params) } : {}),
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
  return persistPilotRunRecord(cfg.directory, record, budget.snapshot(), frozen, options.financialMode);
}

/** Receipt first, then machine checks, then the immutable record. Status is completed only when every machine check passes. */
export function persistPilotRunRecord(directory: string, record: RunRecord, budget: ReturnType<AttemptBudget["snapshot"]>,
  frozen: Pick<FrozenInputs, "pages">, financialMode: PilotWorkerOptions["financialMode"]): RunRecord {
  writeNewJson(join(directory, "budget.json"), budget);
  let checks: PilotMachineResult;
  try { checks = analysePilotRun(record, frozen, financialMode, budget); }
  catch (error) { record.analysisError = `Pilot machine checks rejected the retained observation: ${String(error)}`; checks = undefined as never; }
  if (checks) writeNewJson(join(directory, "pilot-checks.json"), checks);
  record.manifest.status = checks?.passed ? "completed" : "failed";
  writeNewJson(join(directory, "record.json"), record);
  return record;
}

/** Recompute machine checks from retained files, including a worker that never wrote its record. */
export async function pilotChecksFor(directory: string, frozen: Pick<FrozenInputs, "pages">, financialMode: PilotWorkerOptions["financialMode"]): Promise<PilotMachineResult & { budgetReceipt: boolean }> {
  let budget: Record<string, number> | undefined;
  try { budget = await readJson(join(directory, "budget.json")) as Record<string, number>; } catch { /* absent after a killed worker */ }
  let result: PilotMachineResult;
  try {
    const record = JSON.parse(await readFile(join(directory, "record.json"), "utf8")) as RunRecord;
    result = analysePilotRun(record, frozen, financialMode, budget);
  } catch (error) {
    // A corrupt or unreadable record is an explicit failed observation, never a rejected command.
    result = { runId: basename(directory), arm: "unknown", phase: "unknown", passed: false, analysisError: String(error),
      checks: [{ id: "analysable", pass: false, detail: [`Record unreadable or unanalysable: ${String(error)}`] }],
      returnCheck: { initialInvocationConforms: false, initialProblems: [], initialOptions: { applicable: false, problems: [] }, returnPreserved: false,
        returnProblems: [], codemodeOutputTruncated: false, additionalWork: [], recoveryPermitted: false, fullTopologyConforms: false, recoveryLimitReached: false },
      observedPipelineOutcome: "unknown", recoveryCalls: 0, financial: { knownNanoUsd: 0, unknownNanoUsd: 0, activeNanoUsd: 0, rejected: 0, overruns: 0 } };
  }
  if (!budget) {
    result.passed = false;
    result.checks.push({ id: "final-budget-receipt", pass: false, detail: ["No final budget receipt; the stage ceiling stays held"] });
  }
  return { ...result, budgetReceipt: budget !== undefined };
}

function pilotManifest(input: { runId: string; arm: Arm; phase: RunManifest["phase"]; host: RunManifest["host"]; codeSha256: string;
  protocolSha256: string; frozen: FrozenInputs; synthetic: boolean; scenario?: PilotSyntheticScenario; definition: PilotDefinition }): RunManifest {
  return { schemaVersion: 1, runId: input.runId, arm: input.arm, phase: input.phase, pair: 1, status: "scheduled", host: input.host,
    mainModel: input.synthetic ? { provider: SYNTHETIC_PROVIDER_ID, model: SYNTHETIC_MODEL_ID } : MAIN_MODEL,
    protocolSha256: input.protocolSha256, codeSha256: input.codeSha256, corpusSha256: input.frozen.digest,
    settingsSha256: digestObject(input.definition.settings()),
    promptSha256: digestText(pilotTaskPrompt(input.arm, input.frozen.capture.params, pilotOpening(input.phase, input.scenario))) };
}
/** Observer diagnostics and their synthetic rehearsal use the observer opening; every other pilot mode uses the paid opening. */
export function pilotOpening(phase: RunManifest["phase"], scenario?: PilotSyntheticScenario): "paid" | "observer" {
  return phase === "pilot-diagnostic" || scenario === "observer-complete" ? "observer" : "paid";
}

// ---------------------------------------------------------------------------
// Credential-free actual-host synthetic series
// ---------------------------------------------------------------------------

export async function runPilotSyntheticSeries(output: string, scenarios: readonly PilotSyntheticScenario[] = PILOT_SYNTHETIC_SCENARIOS,
  execute: typeof executeWorker = executeWorker, definition: PilotDefinition = RH5_PILOT): Promise<{ passed: boolean; outcomes: unknown[] }> {
  const directory = resolve(output);
  await mkdir(directory);
  const host = await loadPinnedHost(), code = await sourceIdentity(REPO_ROOT), protocolSha256 = await pilotProtocolSha256(definition);
  const frozen = await pilotSyntheticCorpus(definition, protocolSha256);
  const frozenPath = join(directory, "frozen-inputs.json");
  writeNewJson(frozenPath, frozen);
  writeNewJson(join(directory, "identity.json"), { host: host.identity, code, protocolSha256, protocolRevision: definition.revision, credentialUse: false });
  const outcomes: Array<Record<string, unknown>> = [];
  for (const scenario of scenarios) {
    for (const arm of PILOT_SYNTHETIC_ARMS[scenario] ?? (["baseline", "candidate"] as const)) {
      const runId = `${basename(directory)}-${scenario}-${arm}`;
      const paths = createRunDirectory(join(directory, "runs"), runId);
      const manifest = pilotManifest({ runId, arm, phase: "pilot-synthetic", host: host.identity, codeSha256: code.digest, protocolSha256, frozen, synthetic: true, scenario, definition });
      const financialMode = PILOT_SYNTHETIC_FINANCIAL[scenario] ?? "known-charges";
      const budgetNanoUsd = scenario === "budget-refused" ? definition.budget.m3AttemptNanoUsd + 1 : financialMode === "no-charges" ? 0 : pilotAllocation(definition, arm);
      const pilot: PilotWorkerOptions = { revision: definition.revision, budgetNanoUsd, financialMode, scenario,
        ...(scenario === "worker-ceiling" ? { workerCeilingMs: SYNTHETIC_WORKER_CEILING_MS } : {}) };
      await execute({ schemaVersion: 1, manifest, ...paths, frozenPath, pilot });
      const checks = await pilotChecksFor(paths.directory, frozen, financialMode);
      const expected = PILOT_SYNTHETIC_EXPECTATIONS[scenario];
      const failing = checks.checks.filter(check => !check.pass).map(check => check.id);
      let exit: unknown;
      try { exit = await readJson(join(paths.directory, "process-exit.json")); } catch { /* injected executor */ }
      const problems: string[] = [];
      if (checks.passed !== expected.passed) problems.push(`expected passed=${expected.passed}, observed ${checks.passed}`);
      if (expected.failing && !failing.includes(expected.failing)) problems.push(`expected failing check ${expected.failing}; failing: ${failing.join(", ")}`);
      if (expected.recoveryCalls !== undefined && checks.recoveryCalls !== expected.recoveryCalls) problems.push(`expected ${expected.recoveryCalls} recovery call(s), observed ${checks.recoveryCalls}`);
      if (scenario === "worker-ceiling" && checks.budgetReceipt) problems.push("worker-ceiling case unexpectedly wrote a final budget receipt");
      if (scenario === "default-limit-truncated" && !checks.returnCheck.codemodeOutputTruncated) problems.push("default display limit did not truncate the long return");
      if (scenario === "default-limit-truncated" && checks.checks.find(check => check.id === "candidate-initial-output-option")?.pass !== false) problems.push("missing @options line was not rejected");
      if (scenario === "long-complete") {
        const record = JSON.parse(await readFile(join(paths.directory, "record.json"), "utf8")) as RunRecord;
        const length = record.toolCalls.find(item => item.name === "intelli_research")?.resultText?.length ?? 0;
        if (length <= 40_000) problems.push(`long return is only ${length} characters`);
      }
      outcomes.push({ scenario, arm, runId, expected, observedPassed: checks.passed, failing, recoveryCalls: checks.recoveryCalls,
        recovery: checks.returnCheck.additionalWork.map(work => ({ position: work.position, name: work.name, purpose: work.purpose, nested: work.nested.map(item => item.name) })),
        returnPreserved: checks.returnCheck.returnPreserved, financial: checks.financial, processExit: exit ?? null, problems, matched: problems.length === 0,
        record: relative(directory, join(paths.directory, "record.json")) });
    }
  }
  const passed = outcomes.every(outcome => outcome.matched === true);
  writeNewJson(join(directory, "series-outcome.json"), { revision: definition.revision, passed, outcomes,
    ...(frozen.sourceDerivation ? { corpusSha256: frozen.digest, derivedSources: frozen.sourceDerivation.selected.map(item => item.url) } : {}) });
  return { passed, outcomes };
}

// ---------------------------------------------------------------------------
// Live gate operations (each requires accepted authority; none is run by tests)
// ---------------------------------------------------------------------------

function binding(authority: VerifiedPilotAuthority) {
  return { scope: authority.definition.scope, protocolRevision: authority.definition.revision, seriesRoot: authority.root,
    implementationAcceptanceSha256: authority.acceptanceSha256, ownerDecisionSha256: authority.acceptance.ownerDecisionSha256,
    codeSha256: authority.acceptance.codeSha256, protocolSha256: authority.acceptance.protocolSha256 };
}
type Credential = (authPath: string, provider: string) => Promise<void>;
const defaultCredentialCheck: Credential = async (authPath, provider) => {
  const { sdk } = await loadPinnedHost();
  assertStoredCredentialReady(sdk, authPath, provider);
};
export interface PilotOperationOptions extends PilotAuthorityOptions {
  execute?: typeof executeWorker;
  credentialCheck?: Credential;
  wait?: (milliseconds: number) => Promise<void>;
  fetchCatalogue?: () => Promise<unknown>;
  /** Test seams: a synthetic registry below the real pilot guard, synthetic page acquisition and a clock. */
  modelRegistry?: unknown;
  fetchPages?: typeof fetchPages;
  now?: () => number;
}

/** Step 3: both observer slots are claimed before either launches; baseline machine failure leaves the candidate unrun. */
export async function pilotObserve(acceptancePath: string, authPath: string, options: PilotOperationOptions = {}): Promise<{ stopped: boolean; outcomePath: string }> {
  const authority = await verifyPilotImplementation(acceptancePath, options);
  const root = authority.root;
  const execute = options.execute ?? executeWorker, credentialCheck = options.credentialCheck ?? defaultCredentialCheck, wait = options.wait ?? sleep;
  const runIds = (["baseline", "candidate"] as const).map(arm => pilotRunId(root, "observer", arm));
  assertPilotSchedule(runIds, [pilotRunId(root, "observer", "baseline"), pilotRunId(root, "observer", "candidate")]);
  await mkdir(join(root, "observer"));
  const host = await loadPinnedHost();
  const definition = authority.definition;
  const frozen = await pilotSyntheticCorpus(definition, authority.acceptance.protocolSha256);
  const frozenPath = join(root, "observer", "frozen-inputs.json");
  writeNewJson(frozenPath, frozen);
  for (const [index, arm] of (["baseline", "candidate"] as const).entries()) {
    await claimPilotSlot(root, arm === "baseline" ? "observer-baseline" : "observer-candidate", { ...binding(authority), runId: runIds[index], corpusSha256: frozen.digest });
  }
  const outcomes: unknown[] = [];
  let stop: string | undefined;
  for (const [index, arm] of (["baseline", "candidate"] as const).entries()) {
    const paths = createRunDirectory(join(root, "runs"), runIds[index]);
    const manifest = pilotManifest({ runId: runIds[index], arm, phase: "pilot-diagnostic", host: host.identity,
      codeSha256: authority.acceptance.codeSha256, protocolSha256: authority.acceptance.protocolSha256, frozen, synthetic: false, definition });
    if (stop) {
      const record = unavailableRecord(manifest.runId, manifest.phase, `Not run: ${stop}`, manifest);
      record.manifest.status = "not-run";
      writeNewJson(join(paths.directory, "record.json"), record);
      outcomes.push({ runId: manifest.runId, status: "not-run", reason: stop });
      continue;
    }
    try {
      await credentialCheck(authPath, MAIN_MODEL.provider);
      await execute({ schemaVersion: 1, manifest, ...paths, frozenPath, acceptancePath, authPath,
        pilot: { revision: definition.revision, budgetNanoUsd: 0, financialMode: "no-charges" } });
      const checks = await pilotChecksFor(paths.directory, frozen, "no-charges");
      outcomes.push({ runId: manifest.runId, passed: checks.passed, failing: checks.checks.filter(check => !check.pass).map(check => check.id) });
      if (!checks.passed) stop = `Observer ${arm} failed machine checks`;
    } catch (error) {
      stop = String(error);
      if (!await fileExists(join(paths.directory, "record.json"))) writeNewJson(join(paths.directory, "record.json"), unavailableRecord(manifest.runId, manifest.phase, stop, manifest));
      outcomes.push({ runId: manifest.runId, error: stop });
    }
    if (!stop && index === 0) await wait(PILOT_MIN_GAP_MS);
  }
  const outcomePath = join(root, "observer", "outcome.json");
  writeNewJson(outcomePath, { ...binding(authority), kind: "pilot-observer-outcome", stopped: stop !== undefined, reason: stop ?? null, outcomes,
    note: "Machine checks only; independent review and a coordinator diagnostic acceptance are still required." });
  return { stopped: stop !== undefined, outcomePath };
}

export interface CatalogueModel { id: string; context_length: number; pricing: Record<string, string> }
/** Step 4 bounds (PILOT-PROTOCOL.md, Financial Controls). */
export function assertPilotRates(data: { data: CatalogueModel[] }, definition: PilotDefinition = RH5_PILOT): { sonar: CatalogueModel; m3: CatalogueModel } {
  const budget = definition.budget;
  const sonar = data.data.find(model => model.id === "perplexity/sonar"), m3 = data.data.find(model => model.id === "minimax/minimax-m3");
  const numeric = (value: unknown) => typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0;
  if (!sonar || !m3 || ![sonar.pricing.prompt, sonar.pricing.completion, sonar.pricing.web_search, m3.pricing.prompt, m3.pricing.completion].every(numeric)
    || !Number.isSafeInteger(sonar.context_length) || !Number.isSafeInteger(m3.context_length) || sonar.context_length <= 0 || m3.context_length <= 0
    || sonar.context_length > 127_072 || m3.context_length > 1_048_576
    || Number(sonar.pricing.prompt) > 0.000001 || Number(sonar.pricing.completion) > 0.000001 || Number(sonar.pricing.web_search) > 0.005
    || Number(m3.pricing.prompt) > 0.0000003 || Number(m3.pricing.completion) > 0.0000012) {
    throw new Error("Current catalogue exceeds or does not establish the pilot cost bounds");
  }
  // Each pilot envelope must hold twelve full M3 reservations at once (both protocols, Financial Controls).
  // A reuse series (rh-v7) makes no search: its capture allowance must be exactly zero.
  const captureFits = definition.corpusReuse ? budget.captureNanoUsd === 0 : 6 * budget.sonarAttemptNanoUsd <= budget.captureNanoUsd;
  if (!captureFits || 3 * budget.m3AttemptNanoUsd > budget.qualificationNanoUsd
    || 12 * budget.m3AttemptNanoUsd > Math.min(budget.baselinePilotNanoUsd, budget.candidatePilotNanoUsd)
    || budget.captureNanoUsd + budget.qualificationNanoUsd + budget.baselinePilotNanoUsd + budget.candidatePilotNanoUsd !== budget.totalNanoUsd) {
    throw new Error("Pilot allocation arithmetic does not fit the stage reservations");
  }
  return { sonar, m3 };
}

/** Step 4: financial admission after an accepted diagnostic. Fetches the public catalogue only; no inference. */
export async function pilotAdmit(acceptancePath: string, diagnosticAcceptancePath: string, options: PilotOperationOptions = {}): Promise<string> {
  const authority = await verifyPilotImplementation(acceptancePath, options);
  await verifyStageReceipt(diagnosticAcceptancePath, "pilot-diagnostic-acceptance", authority, { recoveryPurposeReviewed: true });
  await claimPilotSlot(authority.root, "financial-admission", { ...binding(authority), diagnosticAcceptanceSha256: await digestFile(diagnosticAcceptancePath) });
  let rates: ReturnType<typeof assertPilotRates>;
  try {
    const raw = options.fetchCatalogue ? await options.fetchCatalogue() : await (async () => {
      const response = await fetch("https://openrouter.ai/api/v1/models");
      if (!response.ok) throw new Error(`Rate catalogue unavailable (${response.status})`);
      return response.json();
    })();
    rates = assertPilotRates(raw as { data: CatalogueModel[] }, authority.definition);
  } catch (error) {
    writeNewJson(join(authority.root, "financial-admission-receipt.json"), { ...binding(authority), kind: "pilot-financial-admission", accepted: false, error: String(error) });
    throw error;
  }
  writeNewJson(join(authority.root, "rates-at-admission.json"), { observedAt: new Date().toISOString(), ...rates });
  const path = join(authority.root, "financial-admission-receipt.json");
  const budget = authority.definition.budget;
  writeNewJson(path, { ...binding(authority), kind: "pilot-financial-admission", accepted: true, envelopeNanoUsd: budget.totalNanoUsd,
    allocationNanoUsd: { capture: budget.captureNanoUsd, chargeQualification: budget.qualificationNanoUsd,
      baselinePilot: budget.baselinePilotNanoUsd, candidatePilot: budget.candidatePilotNanoUsd },
    reservationsNanoUsd: { sonarAttempt: budget.sonarAttemptNanoUsd, m3Attempt: budget.m3AttemptNanoUsd } });
  return path;
}

async function pilotNativeContext(definition: PilotDefinition, agentDir: string, workspace: string, authPath: string, budget: AttemptBudget, journal: DurableJournal, runId: string, registry?: unknown) {
  process.env.PI_CODING_AGENT_DIR = agentDir;
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ "pi-intelli-search": definition.settings() }) + "\n", { flag: "wx" });
  let modelRegistry = registry;
  if (!modelRegistry) {
    const host = await loadPinnedHost();
    await writeIsolatedModelsOverlay(agentDir);
    const runtime = await host.sdk.ModelRuntime.create({ credentials: readOnlyFileCredentialStore(host.sdk, authPath),
      modelsPath: join(agentDir, "models.json"), allowModelNetwork: false, refreshOnCreate: false });
    modelRegistry = new host.sdk.ModelRegistry(runtime);
  }
  const ctx = { cwd: workspace, isProjectTrusted: () => false, modelRegistry, ui: {} } as unknown as ExtensionContext;
  return createNativeOperationContext(ctx, undefined, createGuardedCallLlm({ runId, budget, journal, limits: pilotDownstreamLimits(definition) }));
}
function reportedCharge(events: JournalEvent[], stage: string): boolean {
  const last = [...events].reverse().find(event => event.kind === "pipeline-completion" && event.stage === stage && (event.data.stopReason === "stop" || event.data.stopReason === "length"));
  return !!last && providerReportedCost({ usage: last.data.rawUsage }) !== undefined;
}

/** Step 5: the one common capture. No fallback, replacement or recapture. */
export async function pilotCapture(acceptancePath: string, authPath: string, options: PilotOperationOptions = {}): Promise<string> {
  const authority = await verifyPilotImplementation(acceptancePath, options);
  if (authority.definition.corpusReuse) throw new Error(`${authority.definition.revision} reuses a retained corpus; capture and recapture are not authorised`);
  await verifyStageReceipt(join(authority.root, "financial-admission-receipt.json"), "pilot-financial-admission", authority);
  await claimPilotSlot(authority.root, "capture", binding(authority));
  const paths = createRunDirectory(authority.root, "capture");
  const journal = new DurableJournal(paths.directory, `${basename(authority.root)}-capture`);
  const definition = authority.definition;
  const budget = new AttemptBudget(definition.budget.captureNanoUsd, journal);
  const previous = process.env.PI_CODING_AGENT_DIR;
  let frozen: FrozenInputs | undefined, failure: string | undefined;
  try {
    await (options.credentialCheck ?? defaultCredentialCheck)(authPath, "openrouter");
    const context = await pilotNativeContext(definition, paths.agentDir, paths.workspace, authPath, budget, journal, "capture", options.modelRegistry);
    frozen = await captureCommonInputs({ params: definition.params(), context, fetchPages: options.fetchPages ?? fetchPages, journal,
      ...(definition.sourcePolicy ? { sourcePolicy: definition.sourcePolicy } : {}),
      meta: { capturedAt: new Date().toISOString(), coreCommit: BASELINE_COMMIT, protocolRef: authority.acceptance.protocolSha256 } });
    writeNewJson(join(paths.directory, "frozen-inputs.json"), frozen);
    if (definition.sourcePolicy) verifyFrozenInputs(frozen);
    assertCorpusAcceptable({ frozen });
    assertAllSelectedPagesCaptured(frozen);
    if (digestObject(frozen.settings) !== digestObject(definition.settings())) throw new Error("Captured settings differ from the frozen pilot profile");
    if (!reportedCharge(journal.events, "search")) throw new Error("Sonar did not report a numeric charge");
    if (budget.snapshot().stopped || budget.snapshot().activeNanoUsd || budget.snapshot().unknownNanoUsd) throw new Error("Capture financial state is not settled with known charges");
  } catch (error) { failure = String(error); }
  finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    writeNewJson(join(paths.directory, "budget.json"), budget.snapshot());
    writeNewJson(join(paths.directory, "outcome.json"), { ...binding(authority), kind: "pilot-capture-outcome", accepted: failure === undefined,
      error: failure, corpusSha256: frozen?.digest, sonarReportedCharge: reportedCharge(journal.events, "search") });
  }
  if (failure) throw new Error(failure);
  return join(paths.directory, "frozen-inputs.json");
}

/**
 * rh-v7 corpus stage: after financial admission, verify the retained corpus and its source
 * series, claim the single import slot and copy the file byte for byte. Credential-free; no
 * search, page fetch or model call, and no capture fallback. The zero-limit budget receipt
 * lets settlement record the stage's zero charge from the ordinary walk.
 */
export async function pilotImportCorpus(acceptancePath: string, options: PilotOperationOptions = {}): Promise<string> {
  const authority = await verifyPilotImplementation(acceptancePath, options);
  const definition = authority.definition, reuse = definition.corpusReuse;
  if (!reuse) throw new Error(`${definition.revision} captures its own corpus; corpus import is not authorised`);
  await verifyStageReceipt(join(authority.root, "financial-admission-receipt.json"), "pilot-financial-admission", authority);
  const { provenance } = await verifyReusedCorpus(definition);
  await claimPilotSlot(authority.root, "corpus-import", { ...binding(authority), corpusSha256: reuse.digest, sourceFileSha256: reuse.sha256 });
  const directory = join(authority.root, "corpus-import");
  await mkdir(directory);
  const frozenPath = join(directory, "frozen-inputs.json");
  const budget = new AttemptBudget(definition.budget.captureNanoUsd, { record: () => {} });
  let failure: string | undefined, copiedSha256: string | undefined;
  try {
    await copyFile(reuse.path, frozenPath, fsConstants.COPYFILE_EXCL);
    copiedSha256 = await digestFile(frozenPath);
    if (copiedSha256 !== reuse.sha256) throw new Error("Imported corpus bytes differ from the retained source");
    const copied = await loadFrozenInputs({ path: frozenPath });
    if (copied.digest !== reuse.digest) throw new Error("Imported corpus digest differs from the retained source");
  } catch (error) { failure = String(error); }
  finally {
    writeNewJson(join(directory, "budget.json"), budget.snapshot());
    writeNewJson(join(directory, "outcome.json"), { ...binding(authority), kind: "pilot-corpus-import-outcome", accepted: failure === undefined,
      error: failure, corpusSha256: reuse.digest, frozenFileSha256: copiedSha256 ?? null, newSearchChargeNanoUsd: 0,
      network: false, credentialUse: false, provenance,
      note: "Byte-for-byte reuse of a settled earlier capture. No search, page fetch or model call was made; the source series' search charge is in its own settlement." });
  }
  if (failure) throw new Error(failure);
  return frozenPath;
}

/** Step 6: one charge-reporting extraction with the complete pilot profile, at most three attempts. */
export async function pilotQualify(acceptancePath: string, authPath: string, corpusAcceptancePath: string, options: PilotOperationOptions = {}): Promise<string> {
  const authority = await verifyPilotImplementation(acceptancePath, options);
  const stage = await verifyCorpusStage(authority, { sonarReportedCharge: true });
  const frozen = await loadFrozenInputs({ path: stage.frozenPath });
  assertCorpusAcceptable({ frozen });
  assertAllSelectedPagesCaptured(frozen);
  if (frozen.digest !== stage.corpusSha256) throw new Error("Capture corpus changed");
  const corpus = await verifyStageReceipt(corpusAcceptancePath, "pilot-corpus-acceptance", authority, { corpusSha256: frozen.digest });
  if (typeof corpus.readableSelectedPages !== "number" || corpus.readableSelectedPages < 2 || !corpus.reviewPath
    || await digestFile(String(corpus.reviewPath)) !== corpus.reviewSha256) throw new Error("Corpus acceptance is incomplete");
  await claimPilotSlot(authority.root, "charge-qualification", { ...binding(authority), corpusSha256: frozen.digest });
  const paths = createRunDirectory(authority.root, "charge-qualification");
  const journal = new DurableJournal(paths.directory, `${basename(authority.root)}-charge-qualification`);
  const budget = new AttemptBudget(authority.definition.budget.qualificationNanoUsd, journal);
  const previous = process.env.PI_CODING_AGENT_DIR;
  let failure: string | undefined;
  try {
    await (options.credentialCheck ?? defaultCredentialCheck)(authPath, "openrouter");
    const context = await pilotNativeContext(authority.definition, paths.agentDir, paths.workspace, authPath, budget, journal, "charge-qualification", options.modelRegistry);
    const page = frozen.pages.find(item => item.page.status === "success")!.page;
    const s = context.settings;
    const completion = await context.models.complete({ model: s.extractModel, systemPrompt: EXTRACTION_SYSTEM_PROMPT,
      userMessage: buildExtractionMessage(page.content, frozen.capture.params.query, frozen.capture.params.focusPrompt, s.extractMaxChars),
      maxTokens: s.extractionMaxTokens, timeoutMs: s.llmTimeoutMs,
      retry: { attempts: s.llmRetryAttempts, baseDelayMs: s.retryBaseDelayMs, maxDelayMs: s.retryMaxDelayMs } });
    writeNewJson(join(paths.directory, "completion.json"), { usageBasis: "sdk-normalised-estimate", completion });
    if (!completion.text.trim() || !reportedCharge(journal.events, "extract")) throw new Error("M3 did not produce a nonempty completion with a numeric reported charge");
    const snapshot = budget.snapshot();
    if (snapshot.stopped || snapshot.activeNanoUsd || snapshot.unknownNanoUsd) throw new Error("Qualification final accounting is not known");
  } catch (error) { failure = String(error); }
  finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    writeNewJson(join(paths.directory, "budget.json"), budget.snapshot());
    writeNewJson(join(paths.directory, "outcome.json"), { ...binding(authority), kind: "pilot-charge-qualification-outcome", accepted: failure === undefined,
      error: failure, corpusSha256: frozen.digest, m3ReportedCharge: reportedCharge(journal.events, "extract") });
  }
  if (failure) throw new Error(failure);
  return join(paths.directory, "outcome.json");
}

/** Steps 7-8: one paid conversation for the named arm. The candidate needs the passed baseline gate. */
export async function pilotRun(acceptancePath: string, authPath: string, arm: Arm, corpusAcceptancePath: string, options: PilotOperationOptions = {}): Promise<{ runId: string; passed: boolean }> {
  const authority = await verifyPilotImplementation(acceptancePath, options);
  const root = authority.root;
  const { corpusSha256, baseline } = await verifyPaidPrerequisites(authority, arm, corpusAcceptancePath, options.now?.());
  const { frozenPath } = await verifyCorpusStage(authority);
  const frozen = await loadFrozenInputs({ path: frozenPath });
  if (frozen.digest !== corpusSha256) throw new Error("Capture corpus changed");
  assertAllSelectedPagesCaptured(frozen);
  const runId = pilotRunId(root, "pilot", arm);
  await (options.credentialCheck ?? defaultCredentialCheck)(authPath, MAIN_MODEL.provider);
  await (options.credentialCheck ?? defaultCredentialCheck)(authPath, "openrouter");
  await claimPilotSlot(root, arm === "baseline" ? "pilot-baseline" : "pilot-candidate", { ...binding(authority), runId, corpusSha256,
    corpusAcceptancePath, corpusAcceptanceSha256: await digestFile(corpusAcceptancePath), ...(baseline ? { candidateAdmission: baseline } : {}) });
  const host = await loadPinnedHost();
  const paths = createRunDirectory(join(root, "runs"), runId);
  const manifest = pilotManifest({ runId, arm, phase: "pilot", host: host.identity, codeSha256: authority.acceptance.codeSha256,
    protocolSha256: authority.acceptance.protocolSha256, frozen, synthetic: false, definition: authority.definition });
  await (options.execute ?? executeWorker)({ schemaVersion: 1, manifest, ...paths, frozenPath, acceptancePath, authPath,
    pilot: { revision: authority.definition.revision, budgetNanoUsd: pilotAllocation(authority.definition, arm), financialMode: "known-charges" } });
  const checks = await pilotChecksFor(paths.directory, frozen, "known-charges");
  return { runId, passed: checks.passed };
}

/** Records the gate for one paid answer: machine checks, settled known charges and the locked dual-rubric assessments. Write-once. */
export async function pilotGate(acceptancePath: string, arm: Arm, lockPath: string, options: PilotOperationOptions = {}): Promise<{ passed: boolean; path: string }> {
  const authority = await verifyPilotImplementation(acceptancePath, options);
  const root = authority.root, runId = pilotRunId(root, "pilot", arm);
  const directory = join(root, "runs", runId);
  const stage = await verifyCorpusStage(authority);
  const frozen = await loadFrozenInputs({ path: stage.frozenPath });
  if (frozen.digest !== stage.corpusSha256) throw new Error("Capture corpus changed");
  if (authority.definition.gradingAfterPair) await assertPairCollected(authority, frozen);
  const checks = await pilotChecksFor(directory, frozen, "known-charges");
  let record: RunRecord | undefined, assessment: unknown, purpose: { passed: boolean; problems: string[] } = { passed: false, problems: [] };
  let assessed = false;
  try {
    record = JSON.parse(await readFile(join(directory, "record.json"), "utf8")) as RunRecord;
    const result = await assessPilotAnswerGate(lockPath, record, frozen.digest, authority.acceptance.protocolSha256);
    const lock = JSON.parse(await readFile(lockPath, "utf8")) as PilotAssessmentLock;
    const noRead = checks.returnCheck.additionalWork.filter(work => work.purpose === "codemode-without-read").map(work => work.id);
    purpose = await assessRecoveryPurpose(lock, record, noRead);
    assessment = result; assessed = result.passed;
  } catch (error) { assessment = { passed: false, problems: [`Gate inputs unreadable: ${String(error)}`] }; }
  const passed = checks.passed && assessed && purpose.passed;
  const path = join(root, `pilot-${arm}-gate.json`);
  writeNewJson(path, { ...binding(authority), kind: `pilot-${arm}-gate`, accepted: true, passed, runId,
    recordSha256: record ? digestObject(record) : null, [`${arm}EndedAt`]: record?.manifest.endedAt ?? null,
    machineChecks: checks.checks, financial: checks.financial, assessment, recoveryPurpose: purpose, assessmentLockSha256: await digestFile(lockPath) });
  return { passed, path };
}

/**
 * rh-v7 grades follow the pair: no answer gate is written until the candidate has a terminal
 * record, or the baseline's failed machine checks have blocked the candidate.
 */
async function assertPairCollected(authority: VerifiedPilotAuthority, frozen: FrozenInputs): Promise<void> {
  const root = authority.root;
  if (await readPilotClaim(root, "pilot-candidate")) {
    if (await fileExists(join(root, "runs", pilotRunId(root, "pilot", "candidate"), "record.json"))) return;
    throw new Error("Grades follow the pair: the claimed candidate has no terminal record yet");
  }
  if (!await readPilotClaim(root, "pilot-baseline")) throw new Error("Grades follow the pair: no baseline conversation has been collected");
  const baseline = await pilotChecksFor(join(root, "runs", pilotRunId(root, "pilot", "baseline")), frozen, "known-charges");
  if (baseline.passed) throw new Error("Grades follow the pair: collect the candidate before writing any answer gate");
}

function settlementStages(definition: PilotDefinition): Array<{ slot: PilotSlot; cap: number; directory: (root: string) => string }> {
  const budget = definition.budget;
  return [
    { slot: "observer-baseline", cap: 0, directory: root => join(root, "runs", pilotRunId(root, "observer", "baseline")) },
    { slot: "observer-candidate", cap: 0, directory: root => join(root, "runs", pilotRunId(root, "observer", "candidate")) },
    definition.corpusReuse
      ? { slot: "corpus-import", cap: budget.captureNanoUsd, directory: root => join(root, "corpus-import") }
      : { slot: "capture", cap: budget.captureNanoUsd, directory: root => join(root, "capture") },
    { slot: "charge-qualification", cap: budget.qualificationNanoUsd, directory: root => join(root, "charge-qualification") },
    { slot: "pilot-baseline", cap: budget.baselinePilotNanoUsd, directory: root => join(root, "runs", pilotRunId(root, "pilot", "baseline")) },
    { slot: "pilot-candidate", cap: budget.candidatePilotNanoUsd, directory: root => join(root, "runs", pilotRunId(root, "pilot", "candidate")) },
  ];
}
/** Walks only the claimed identities of this decision. A claimed stage without a valid final receipt is held at its full ceiling. */
export async function pilotSettle(acceptancePath: string, options: PilotOperationOptions = {}, interruptionReceiptPaths: readonly string[] = []): Promise<string> {
  const authority = await verifyPilotImplementation(acceptancePath, options);
  const root = authority.root;
  let reported = 0, unknown = 0, active = 0;
  const receipts: unknown[] = [];
  // F5: an interrupted stage may be closed out only with a separately bound coordinator receipt; it is held, never released.
  const interruptions = new Map<string, Record<string, unknown>>();
  for (const path of interruptionReceiptPaths) {
    const receipt = await verifyStageReceipt(path, "pilot-interruption-receipt", authority, { noActiveProcess: true });
    if (typeof receipt.slot !== "string" || interruptions.has(receipt.slot) || !String(receipt.rationale ?? "").trim()
      || !Number.isFinite(Date.parse(String(receipt.inspectedAt))) || !receipt.inspectionEvidencePath
      || await digestFile(String(receipt.inspectionEvidencePath)) !== receipt.inspectionEvidenceSha256) {
      throw new Error(`Interruption receipt ${path} lacks a unique slot, rationale, inspection time or retained inspection evidence`);
    }
    interruptions.set(receipt.slot, { ...receipt, receiptSha256: await digestFile(path) });
  }
  for (const stage of settlementStages(authority.definition)) {
    const claim = await readPilotClaim(root, stage.slot);
    if (!claim) { receipts.push({ slot: stage.slot, claimed: false, notStarted: true }); continue; }
    const dir = stage.directory(root);
    const terminal = await fileExists(join(dir, "record.json")) || await fileExists(join(dir, "outcome.json"));
    const dispatched = stage.slot.startsWith("capture") || stage.slot.startsWith("charge") || stage.slot === "corpus-import" || await fileExists(join(root, "claims", stage.slot, "dispatched"));
    if (!terminal && await fileExists(dir) && dispatched) {
      const interruption = interruptions.get(stage.slot);
      if (!interruption) throw new Error(`${stage.slot} has no terminal record; do not settle potentially active work without an interruption receipt`);
      unknown += stage.cap;
      receipts.push({ slot: stage.slot, claimed: true, interrupted: true, heldNanoUsd: stage.cap,
        reason: "Interrupted stage without a terminal record; full ceiling held", interruptionReceiptSha256: interruption.receiptSha256 });
      continue;
    }
    let record: RunRecord | undefined;
    try { record = JSON.parse(await readFile(join(dir, "record.json"), "utf8")) as RunRecord; } catch { /* preparation stages */ }
    if (record?.manifest.status === "not-run") { receipts.push({ slot: stage.slot, claimed: true, notRun: true }); continue; }
    try {
      const budget = await readJson(join(dir, "budget.json")) as Record<string, number>;
      for (const key of ["knownNanoUsd", "unknownNanoUsd", "activeNanoUsd"]) if (!Number.isSafeInteger(budget[key]) || budget[key] < 0) throw new Error("Malformed budget receipt");
      if (budget.limitNanoUsd !== stage.cap) throw new Error("Budget receipt belongs to a different allowance");
      reported += budget.knownNanoUsd; unknown += budget.unknownNanoUsd; active += budget.activeNanoUsd;
      receipts.push({ slot: stage.slot, claimed: true, budget });
    } catch (error) {
      unknown += stage.cap;
      receipts.push({ slot: stage.slot, claimed: true, heldNanoUsd: stage.cap, reason: "Final budget unavailable or invalid", detail: String(error) });
    }
  }
  const unused = [...interruptions.keys()].filter(slot => !receipts.some(item => (item as { slot?: string; interrupted?: boolean }).slot === slot && (item as { interrupted?: boolean }).interrupted));
  if (unused.length) throw new Error(`Interruption receipt names a slot that is not an interrupted stage: ${unused.join(", ")}`);
  writeNewJson(join(root, "settlement-review.json"), { ...binding(authority), reportedNanoUsd: reported, unknownNanoUsd: unknown, activeNanoUsd: active, receipts });
  const liability = reported + unknown + active, path = join(root, "settlement-receipt.json");
  const cumulative = authority.definition.cumulative;
  writeNewJson(path, { ...binding(authority), kind: "pilot-settlement", closed: true, reportedNanoUsd: reported, unknownNanoUsd: unknown, activeNanoUsd: active,
    releasedNanoUsd: Math.max(0, authority.definition.budget.totalNanoUsd - liability), overrunNanoUsd: Math.max(0, liability - authority.definition.budget.totalNanoUsd),
    ...(cumulative ? { cumulative: { priorSettlements: cumulative.priorSettlements, priorReportedNanoUsd: cumulative.priorReportedNanoUsd,
      seriesLiabilityNanoUsd: liability, cumulativeLiabilityNanoUsd: cumulative.priorReportedNanoUsd + liability,
      combinedCeilingNanoUsd: cumulative.combinedCeilingNanoUsd,
      withinCombinedCeiling: cumulative.priorReportedNanoUsd + liability <= cumulative.combinedCeilingNanoUsd } } : {}),
    note: "Subscription-main usage is reported separately and is not part of this monetary settlement." });
  return path;
}

/** Offline re-analysis of retained pilot records; never applies the historical savings gate. */
export async function analysePilotInventory(inventoryPath: string, frozenPath: string, output: string, financialMode: PilotWorkerOptions["financialMode"],
  definition: PilotDefinition = RH5_PILOT): Promise<void> {
  const root = resolve(inventoryPath, "..");
  const rows = JSON.parse(await readFile(inventoryPath, "utf8")) as unknown;
  if (!Array.isArray(rows) || !rows.every(row => typeof row === "string")) throw new Error("Expected a record-path inventory");
  const frozen = await loadFrozenInputs({ path: frozenPath });
  const runs: unknown[] = [], seen = new Set<string>(), phases = new Set<string>();
  const physicalRoot = await realpath(root);
  for (const row of rows as string[]) {
    const full = resolve(root, row);
    if (isAbsolute(row) || relative(root, full).startsWith("..") || seen.has(full)) throw new Error(`Inventory row is absolute, escapes its directory or repeats: ${row}`);
    seen.add(full);
    let physical: string | undefined;
    try { physical = await realpath(full); } catch { /* missing record stays an explicit failure below */ }
    if (physical && relative(physicalRoot, physical).startsWith("..")) throw new Error(`Inventory symlink escapes its directory: ${row}`);
    try {
      const manifest = (JSON.parse(await readFile(full, "utf8")) as RunRecord).manifest;
      if (manifest?.corpusSha256 !== frozen.digest) throw new Error(`Inventory mixes corpora: ${row}`);
      if (manifest.phase === "pilot-diagnostic" && financialMode !== "no-charges" || manifest.phase === "pilot" && financialMode !== "known-charges") {
        throw new Error(`Inventory financial mode does not match ${manifest.phase} record ${row}`);
      }
      phases.add(manifest.phase);
    } catch (error) {
      if (/mixes corpora|financial mode/.test(String(error))) throw error;
    }
    runs.push(await pilotChecksFor(resolve(full, ".."), frozen, financialMode));
  }
  if (phases.size > 1) throw new Error(`Inventory mixes phases: ${[...phases].join(", ")}; use separate observer and paid inventories`);
  await mkdir(resolve(output));
  writeNewJson(join(resolve(output), "pilot-analysis.json"), { revision: definition.revision, financialMode,
    claim: "Machine checks per observation only; no failure rate, equivalence or savings is inferred.", runs,
    inputs: { inventorySha256: await digestFile(inventoryPath), frozenSha256: frozen.digest, analyserCode: (await sourceIdentity(REPO_ROOT)).digest,
      protocolSha256: await pilotProtocolSha256(definition) } });
}

/**
 * F2: credential-free review inputs for one paid answer. Graders receive a neutral label, the answer text,
 * its evidence-access record, opaque bindings and an ungraded skeleton; never the run name, raw record or traces.
 * The coordinator-only mapping retains the actual run identity for assembling the lock after both grades exist.
 */
export async function pilotReviewInputs(recordPath: string, frozenPath: string, output: string, answerLabel: string, definition: PilotDefinition = RH5_PILOT): Promise<string> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(answerLabel) || /baseline|candidate|codemode|direct/i.test(answerLabel)) {
    throw new Error("Answer label must be neutral and must not name a route");
  }
  const record = JSON.parse(await readFile(recordPath, "utf8")) as RunRecord;
  const frozen = await loadFrozenInputs({ path: frozenPath });
  if (record.manifest?.corpusSha256 !== frozen.digest) throw new Error("Record and frozen corpus differ");
  const bindings = { answerLabel, runIdSha256: digestText(record.manifest.runId), recordSha256: digestObject(record),
    answerSha256: digestText(record.finalAnswer ?? ""), corpusSha256: frozen.digest, rubricSha256: await pilotProtocolSha256(definition) };
  const directory = resolve(output);
  await mkdir(directory);
  const graders = join(directory, "graders");
  await mkdir(graders);
  await writeFile(join(graders, `${answerLabel}-answer.md`), record.finalAnswer ?? "", { flag: "wx", mode: 0o600 });
  writeNewJson(join(graders, `${answerLabel}-evidence-access.json`), { answerLabel, readable: record.evidenceAccess?.readable === true,
    reportPaths: record.evidenceAccess?.reportPaths ?? [], problems: record.evidenceAccess?.problems ?? [] });
  writeNewJson(join(graders, `${answerLabel}-bindings.json`), { ...bindings, topics: PILOT_TOPICS, rubrics: PILOT_RUBRICS });
  writeNewJson(join(graders, `${answerLabel}-grade-template.json`), {
    reviewer: "", lockedAt: "", ...Object.fromEntries(Object.entries(bindings).filter(([key]) => key !== "answerLabel")),
    materialUnsupportedClaim: null,
    grades: Object.fromEntries(PILOT_RUBRICS.map(rubric => [rubric, Object.fromEntries(PILOT_TOPICS.map(topic => [topic, { pass: null, reasons: "", sourceRefs: [] }]))])),
    note: "Ungraded skeleton: bindings only, never judgements. Every cell needs pass true/false, reasons and source references; lock it before seeing any other review.",
  });
  writeNewJson(join(directory, "coordinator-mapping.json"), { ...bindings, runId: record.manifest.runId, recordPath: resolve(recordPath),
    note: "Coordinator only. Do not give this file or the run name to graders. Assemble the lock (with the actual runId) only after both grades are written." });
  return directory;
}

/**
 * Credential-free bounded corpus-review bundle: the frozen task, the protocol digest, every selected page's
 * bytes and, for a derived corpus, the derivation without page bodies so a reviewer can check how each page
 * was reached. Never includes the raw search text, any answer, grade or conversation history.
 */
export async function pilotCorpusReviewInputs(frozenPath: string, output: string, definition: PilotDefinition = RH5_PILOT): Promise<string> {
  const frozen = await loadFrozenInputs({ path: frozenPath });
  if (!!definition.sourcePolicy !== !!frozen.sourceDerivation) throw new Error("Frozen corpus source derivation differs from the pilot definition");
  const directory = resolve(output);
  await mkdir(directory);
  const derivation = frozen.sourceDerivation;
  const path = join(directory, "inputs.json");
  writeNewJson(path, {
    kind: "pilot-corpus-review-inputs", revision: definition.revision, protocolSha256: await pilotProtocolSha256(definition),
    corpusSha256: frozen.digest, frozenFileSha256: await digestFile(frozenPath), task: frozen.capture.params,
    pages: frozen.pages.map((entry, position) => ({ position, url: entry.page.url, title: entry.page.title, status: entry.page.status,
      variant: entry.page.source ?? null, characters: entry.page.content.length, contentSha256: entry.contentSha256, content: entry.page.content,
      ...(derivation ? { depth: derivation.selected[position]?.depth, parentKey: derivation.selected[position]?.parentKey } : {}) })),
    ...(derivation ? { derivation: { policyId: derivation.policy.id, policySha256: derivation.policySha256, taskTerms: derivation.taskTerms,
      discovery: derivation.discovery, stopReason: derivation.stopReason, ignoredLinks: derivation.ignoredLinks,
      fetches: derivation.fetches.map(({ page: _page, ...rest }) => rest),
      candidates: derivation.candidates.map(({ order, url, depth, parentKey, anchor, termScore, matchedTerms, sameSection, status }) =>
        ({ order, url, depth, parentKey, anchor, termScore, matchedTerms, sameSection, status })) } } : {}),
    note: "Bounded corpus-review input. The raw search text, answers, grades and conversation history are deliberately absent.",
  });
  return path;
}
