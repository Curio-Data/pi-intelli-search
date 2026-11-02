// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { registerHooks } from "node:module";
import { readFile, mkdir, readdir, cp, open } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AttemptRecord, FullData, TokenObservation } from "../../src/core/execution-contracts.js";
import type { ResearchSettings } from "../../src/core/types.js";
import { createAttemptLedger } from "../../src/core/usage.js";
import { asJson, sha256Canonical } from "./canonical.js";
import { appendRunObservation } from "./run-observation.js";
import { createStudyLimits, summariseAttemptCharges, attemptHoldUsd, type StudySpendLedger } from "./study-budget.js";
import { createStudyCapture, createStudyReplay, studyBundleSha256, type StudyCapture, type StudyReplay, type StudyReplayBundle, type StudyCaptureOptions } from "./study-transports.js";
import { createStudyPlan, studyPipelineSettings, studyPrompts, STUDY_SYSTEM_PROMPT, type StudyTask } from "./study-design.js";
import { createStudyRecorder, openStudySession, runBoundedPrompt, saveRunObservations, writeNewJson, writeRunManifest, readRepositoryIdentity, STUDY_MAIN_MODEL, type StudyHostModule, type StudyHostSelection, type StudyExtensionFactory, type StudySessionHandle, type RunAssessment } from "./study-host.js";
import type { StudyAnalysisRun } from "./study-analysis.js";

export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export type StudyRunMode = "capture" | "replay" | "live";
export type StudyArm = "off" | "on" | "only";

/** Bind the source extension's value imports to the selected host, not development peers. */
export async function importStudyNative(host: StudyHostSelection) {
  const roots: Record<string, string> = {
    "@earendil-works/pi-coding-agent": join(host.root, "dist/index.js"),
    "@earendil-works/pi-tui": join(dirname(host.root), "pi-tui/dist/index.js"),
  };
  const hooks = registerHooks({ resolve(specifier, context, next) {
    const selected = roots[specifier];
    return next(selected ? pathToFileURL(selected).href : specifier, context);
  } });
  try { return await import("../../src/experimental/codemode-study.js"); }
  finally { hooks.deregister(); }
}

export async function studyTreeDigest(root: string): Promise<string> {
  const hash = createHash("sha256");
  const walk = async (dir: string): Promise<void> => {
    for (const entry of (await readdir(dir, {withFileTypes:true})).sort((a,b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        hash.update(JSON.stringify([relative(root, path), "directory"]) + "\n");
        await walk(path);
      } else if (entry.isFile()) {
        const bytes=await readFile(path);
        hash.update(JSON.stringify([relative(root, path), "file", bytes.byteLength]) + "\n");
        hash.update(bytes);
      }
      else throw new Error("Study workspace must contain only regular files and directories");
    }
  };
  await walk(root);
  return hash.digest("hex");
}

export interface StudyRunOptions {
  readonly host: StudyHostModule;
  readonly hostSelection: StudyHostSelection;
  readonly runId: string;
  readonly seriesRoot: string;
  readonly workspace: string;
  readonly task: StudyTask;
  readonly arm: StudyArm;
  readonly mode: StudyRunMode;
  readonly repeat: number;
  readonly order: number;
  readonly seed: number;
  readonly rerunOf?: string;
  readonly rerunReason?: string;
  readonly rerunSeries?: string;
  readonly methodSha256: string;
  readonly corpusSha256: string;
  readonly candidateCommit: string;
  readonly lockfileSha256: string;
  readonly bundle?: StudyReplayBundle;
  readonly spend?: StudySpendLedger;
  /** Reserve future planned work as well as this run, as required by the schedule. */
  readonly remainingPlannedUsd: number;
  readonly signal?: AbortSignal;
  readonly modelsPath?: string;
  /** Credential-free test-only injection; CLI never supplies it. */
  readonly testing?: {
    readonly main: { provider: string; id: string };
    readonly factories: readonly StudyExtensionFactory[];
    readonly pipeline?: Pick<StudyCaptureOptions, "liveRegistryTransport" | "livePageTransport">;
    readonly settings?: ResearchSettings;
    readonly timeoutMs?: number;
  };
}
export interface StudyRunResult {
  readonly runDir: string;
  readonly observation: StudyAnalysisRun;
  readonly manifestSha256: string;
  readonly captureBundle?: StudyReplayBundle;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function message(error: unknown): string { return error instanceof Error ? `${error.name}: ${error.message}` : String(error); }
function contained(workspace: string, path: string): boolean {
  const absolute = resolve(workspace, path);
  return absolute.startsWith(resolve(workspace) + sep);
}
function aggregateMain(assessment: RunAssessment): { usage: TokenObservation | null; totalComplete: boolean; uncachedComplete: boolean } {
  const messages = assessment.messages;
  const correlated = assessment.evidenceConsistent && assessment.requestWindows === messages.length && messages.length > 0 && messages.every((m) => m.collector?.usageObserved === true && m.collector.correlation === "response-id" && !m.collector.ambiguous);
  const usage: Record<string, number> = {};
  for (const field of ["inputTotal", "inputUncached", "outputTotal", "cacheRead", "cacheWrite", "cacheWrite1h", "reasoning", "totalTokens"] as const) {
    if (correlated && messages.every((m) => m.parsedTokens?.[field] !== undefined)) usage[field] = messages.reduce((sum, m) => sum + m.parsedTokens![field]!, 0);
  }
  return { usage: Object.keys(usage).length ? usage : null, totalComplete: correlated && usage.inputTotal !== undefined, uncachedComplete: correlated && usage.inputUncached !== undefined };
}

/** One actual host session, using the same runtime and catalogue for every workflow. */
export async function runStudyTask(options: StudyRunOptions): Promise<StudyRunResult> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(options.runId)) throw new Error("Invalid study run identity");
  if (options.mode === "replay" && !options.bundle) throw new Error("Replay requires a captured bundle");
  if (options.mode !== "replay" && !options.testing && !options.spend) throw new Error("Paid execution requires the programme spend ledger");
  if (options.mode === "capture" && options.arm !== "on") throw new Error("Fixture capture uses the declared on-arm script workflow");
  if (!options.testing) {
    const current = await readRepositoryIdentity(REPO_ROOT, []);
    if (current.dirty || current.commit !== options.candidateCommit || current.lockfileSha256 !== options.lockfileSha256) throw new Error("Study refuses dirty or changed source identity");
  }
  if (options.task.partition === "reserve") throw new Error("Reserve tasks require a new declared study design");
  const plan = createStudyPlan(options.task);
  const settings = structuredClone(options.testing?.settings ?? studyPipelineSettings());
  const initialTreeDigest = await studyTreeDigest(options.workspace);
  if ((await readdir(options.workspace)).length !== 0) throw new Error("Each study run starts at an empty matched workspace");
  const runDir = join(options.seriesRoot, options.runId);
  await mkdir(options.seriesRoot, {recursive:true});
  await mkdir(runDir); // exclusive run identity, never overwrite failed attempts
  const limits = createStudyLimits({
    ...plan,
    ...(options.mode === "live" ? { omittedMaxUrlsPages: Math.min(settings.defaultUrls, settings.maxUrls) } : {}),
  });
  const issues: string[] = [];
  const cancelled = new AbortController();
  const abort = () => cancelled.abort(options.signal?.reason);
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener("abort", abort, {once:true});
  let handle: StudySessionHandle | undefined;
  const invalidate = (error: Error) => { issues.push(message(error)); cancelled.abort(error); void handle?.session.abort(); };
  let capture: StudyCapture | undefined;
  let replay: StudyReplay | undefined;
  let reserved = false;
  let journalWrites = Promise.resolve();
  let admittedModelCalls = 0;
  const journal = (entry: unknown): Promise<void> => {
    journalWrites = journalWrites.then(async () => {
      const file = await open(join(runDir, "model-dispatch.ndjson"), "a");
      try { await file.writeFile(JSON.stringify(entry) + "\n"); await file.sync(); }
      finally { await file.close(); }
    });
    return journalWrites;
  };
  const prompts = studyPrompts(plan, options.arm, options.mode !== "live");
  const purpose = options.testing ? "synthetic-driver-integration" : options.mode === "capture" ? "fixture-capture" : "comparative-task";
  const identity = {
    schemaVersion: 1, runId: options.runId, purpose, mode: options.mode, arm: options.arm,
    task: options.task, repeat: options.repeat, order: options.order, seed: options.seed,
    rerunOf: options.rerunOf ?? null, rerunReason: options.rerunReason ?? null, rerunSeries: options.rerunSeries ?? null,
    candidateCommit: options.candidateCommit, host: options.hostSelection,
    initialTreeDigest, scheduleSha256: plan.scheduleSha256, settings, plan,
    main: options.testing?.main ?? STUDY_MAIN_MODEL, transport: "sse", systemPrompt: STUDY_SYSTEM_PROMPT,
    prompts, scriptModelsEnabled: false, methodSha256: options.methodSha256, corpusSha256: options.corpusSha256,
    reservationUsd: options.mode === "replay" || !options.spend ? 0 : attemptHoldUsd(plan.maxModelAttempts),
    remainingPlannedUsd: options.remainingPlannedUsd,
  };
  await writeNewJson(join(runDir, "identity.json"), identity);
  if (options.bundle) await writeNewJson(join(runDir, "replay-input.json"), options.bundle);
  const collector = createStudyRecorder({ runId: options.runId, runDir, maxRequests: plan.maxMainRequests, onLimitExceeded: () => invalidate(new Error("Main request limit exceeded")) });
  const toolEvents: Record<string, unknown>[] = [];
  const argsById = new Map<string, Record<string, unknown>>();
  const dataByOperation = new Map<string, FullData>();
  const guard: StudyExtensionFactory = ((pi: ExtensionAPI) => {
    pi.on("before_provider_request", () => { try { limits.admitMainRequest(); } catch (error) { invalidate(error as Error); } });
    pi.on("tool_call", (event) => {
      try {
        if (event.toolName === "intelli_fetch" && typeof event.input.maxChars === "number" && event.input.maxChars > settings.extractMaxChars) throw new Error("Study fetch exceeds the matched page-character limit");
        limits.admitTool(event.toolName, event.input);
        if (event.toolName === "read") {
          if (typeof event.input.path !== "string" || !contained(options.workspace, event.input.path)) throw new Error("Study reads must stay within the run workspace");
        }
        if (event.toolName === "codemode") {
          const code = String(event.input.code ?? "");
          const first = code.split("\n")[0];
          if (!first.startsWith("// @options: ")) throw new Error("Study scripts require finite timeout and output options");
          const opts = JSON.parse(first.slice("// @options: ".length)) as Record<string, unknown>;
          if (!Number.isSafeInteger(opts.timeout_ms) || Number(opts.timeout_ms) < 1 || Number(opts.timeout_ms) > plan.scriptBudget.timeoutMs || !Number.isSafeInteger(opts.max_output_tokens) || Number(opts.max_output_tokens) < 1 || Number(opts.max_output_tokens) > plan.scriptBudget.maxOutputTokens) throw new Error("Study script options exceed their declared budget");
        }
        argsById.set(event.toolCallId, structuredClone(event.input));
      } catch (error) {
        issues.push(message(error));
        return {block:true, reason:message(error)};
      }
      return undefined;
    });
    const observeTool = (event: unknown, type: string) => {
      const copy = JSON.parse(JSON.stringify(event)) as Record<string, unknown>;
      toolEvents.push(copy);
      if (type !== "tool_execution_end" || !String(copy.toolName).startsWith("intelli_")) return;
      const result = record(copy.result) ? copy.result : {};
      const details = record(result.details) ? result.details : {};
      const data = (result.structuredContent ?? details.intelli) as FullData | undefined;
      if (!data || data.schemaVersion !== 1 || typeof data.operationId !== "string") {
        issues.push(`Missing structured operation data: ${String(copy.toolName)}`);
        return;
      }
      dataByOperation.set(data.operationId, data);
      if (!["completed"].includes(data.outcome)) issues.push(`Operation ${data.operation} ended ${data.outcome}`);
      if (data.operation === "intelli_research" || data.operation === "intelli_collate") {
        const args = argsById.get(String(copy.toolCallId));
        if (typeof args?.query !== "string") { issues.push("Missing query for settled host witness"); return; }
        const notices = capture?.snapshot().suggestionObservations ?? replay?.suggestionSession?.observations() ?? [];
        const hasStoreNotice = notices.some((notice) => (notice.kind === "allocated" || notice.kind === "producer-failed") && notice.query === args.query);
        const hasF7 = capture?.suggestionMode === "f7" || replay?.suggestionMode === "f7";
        // not-requested describes publication output, not whether allocation
        // occurred. A failed collation can allocate and then publish nothing.
        const failedBeforeAllocation = hasF7 && !hasStoreNotice && data.outcome !== "completed";
        try { (capture ?? replay)?.reportHostWitness({query:args.query, operationId:data.operationId, outcome: failedBeforeAllocation ? "failed-before-allocation" : data.cache.status === "committed" && data.cache.index === "unavailable" ? "commit-succeeded" : "settled"}); }
        catch (error) { invalidate(error as Error); }
      }
    };
    pi.on("tool_execution_start", (event) => observeTool(event, "tool_execution_start"));
    pi.on("tool_execution_update", (event) => observeTool(event, "tool_execution_update"));
    pi.on("tool_execution_end", (event) => observeTool(event, "tool_execution_end"));
  }) as unknown as StudyExtensionFactory;
  const native = await importStudyNative(options.hostSelection);
  let extension: ReturnType<typeof native.createStudyExtension> | undefined;
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const promptOutcomes = [];
  let settled = false;
  try {
    if (options.mode === "replay") replay = createStudyReplay(options.bundle!, {
      onInvalid: invalidate,
      ...(options.bundle!.suggestion.mode === "f7" ? {f7:{budgetMs:plan.scriptBudget.timeoutMs, displayRoot:settings.cacheDir, expectedInitialTreeDigest:initialTreeDigest, expectedScheduleManifestSha256:plan.scheduleSha256}} : {}),
    });
    else capture = createStudyCapture({
      scenario:options.task.id, maxResponseBytes:settings.execution!.fetchMaxResponseBytes,
      ...options.testing?.pipeline,
      ...(options.mode === "capture" ? {f7:{block:options.task.id,workflow:plan.workflow,baseline:[],displayRoot:settings.cacheDir,initialTreeDigest,scheduleManifestSha256:plan.scheduleSha256}} : {}),
      beforeModelAttempt: async (request) => {
        limits.admitModel(request);
        await journal({kind:"admitted-before-dispatch",modelOrdinal:++admittedModelCalls,utc:new Date().toISOString(),request});
      },
      afterModelAttempt: async (observation, attempt) => {
        await journal({kind:"settled",utc:new Date().toISOString(),attempt,observation:observation??null});
      },
      onInvalid:invalidate,
    });
    extension = native.createStudyExtension(options.arm, (capture ?? replay)!.injection, settings);
    if (options.spend && options.mode !== "replay") {
      await options.spend.reserve(options.runId, attemptHoldUsd(plan.maxModelAttempts), options.remainingPlannedUsd);
      reserved = true;
    }
    handle = await openStudySession({
      host:options.host, workspace:options.workspace, model:options.testing?.main ?? STUDY_MAIN_MODEL,
      thinkingLevel:"low", systemPrompt:STUDY_SYSTEM_PROMPT, transport:"sse", requestTimeoutMs:90_000,
      tools:native.studyActiveTools(options.arm), modelsPath:options.modelsPath,
      extensionFactories:[collector.factory, guard, ...(options.testing?.factories ?? []), extension as unknown as StudyExtensionFactory,
        ...(options.arm === "off" ? [] : [options.host.createCodemodeExtension({mode:options.arm, models:false, inlineBudget:3000})])],
    });
    collector.attachSession(handle.session);
    for (const prompt of prompts) {
      if (cancelled.signal.aborted) break;
      const outcome = await runBoundedPrompt(handle.session, prompt, {timeoutMs:options.testing?.timeoutMs ?? plan.timeoutMs, abortGraceMs:plan.abortGraceMs, signal:cancelled.signal});
      promptOutcomes.push(outcome);
      if (outcome.settlement !== "resolved") { issues.push(`Main prompt ${outcome.settlement}: ${outcome.error ?? ""}`); break; }
    }
  } catch (error) { issues.push(message(error)); }
  finally {
    try { await extension?.close(); settled = true; } catch (error) { issues.push(`Runtime drain failed: ${message(error)}`); }
    handle?.dispose();
    options.signal?.removeEventListener("abort", abort);
  }
  let bundle: StudyReplayBundle | undefined;
  let replayValidity: StudyAnalysisRun["replayValidity"] = options.mode === "replay" ? "valid" : "not-replay";
  if (replay) {
    try { await writeNewJson(join(runDir,"replay.json"),replay.assertComplete()); }
    catch(error){issues.push(message(error));replayValidity="miss";await writeNewJson(join(runDir,"replay.json"),{valid:false,error:message(error)});}
  }
  if (capture) {
    const manifest = await capture.persist(join(runDir,"capture"));
    if (manifest.complete) bundle=capture.exportBundle();
    else if(options.mode==="capture") issues.push(`Incomplete fixture capture: ${manifest.incompleteReason}`);
  }
  const assessment = await saveRunObservations({runDir,recorder:collector,requestLimit:plan.maxMainRequests});
  if (!assessment.evidenceConsistent) issues.push(...assessment.problems);
  if (!options.testing) for(const raw of collector.rawUsage) {
    if (!record(raw.responseMeta) || raw.responseMeta.model !== STUDY_MAIN_MODEL.id) issues.push("Unverified main response model identity");
  }
  const main = aggregateMain(assessment);
  const attempts = new Map<string,AttemptRecord>();
  for(const data of dataByOperation.values()) for(const attempt of data.attempts) {
    const id=`${attempt.operationId}:${attempt.callId}:${attempt.attempt}`;
    const prior=attempts.get(id);
    if(prior && sha256Canonical(asJson(prior))!==sha256Canonical(asJson(attempt))) issues.push("Conflicting pipeline attempt receipts");
    attempts.set(id,attempt);
  }
  const ledger=createAttemptLedger();
  for(const attempt of attempts.values()){ledger.start(attempt,attempt.startedAtMs,attempt.queueMs);if(attempt.observation)ledger.observe(attempt,attempt.observation);ledger.finish(attempt,attempt.state,attempt.settledAtMs);}
  const captureAttempts=capture?.snapshot().attempts.filter((a)=>a.boundary==="model"&&a.state!=="refused")??[];
  if(captureAttempts.length!==attempts.size && capture) issues.push("Transport attempts and delivered pipeline receipts differ");
  const charges = summariseAttemptCharges(captureAttempts.map((a)=>a.state==="settled"&&a.usage?.costBasis==="reported"?a.usage.cost?.total:undefined));
  if(reserved && settled) {
    try { await options.spend!.settle(options.runId,{...charges,note:`${purpose}; ${issues.length} recorded issue(s)`}); }
    catch(error) { issues.push(`Spend settlement failed; reservation retained: ${message(error)}`); }
  }
  const last=assessment.messages.at(-1);
  if(last?.stopReason!=="stop") issues.push(`Main response did not finish: ${last?.stopReason??"missing"}`);
  if(promptOutcomes.length!==prompts.length) issues.push("Task follow-up sequence incomplete");
  const endedAt=new Date().toISOString();
  const durationMs=performance.now()-start;
  const errors=[...new Set(issues)];
  const interrupted = options.signal?.aborted || promptOutcomes.some((outcome) => ["cancelled", "timed-out", "abort-unsettled"].includes(outcome.settlement));
  const status:StudyAnalysisRun["status"]=collector.requestWindows===0&&captureAttempts.length===0?"not-started":interrupted?"aborted":errors.length?"failed":"completed";
  const answers=collector.sessionEvents.flatMap((e)=>record(e)&&e.type==="message_end"&&record(e.message)&&e.message.role==="assistant"?[e.message]:[]);
  await writeNewJson(join(runDir,"answers.json"),answers);
  await writeNewJson(join(runDir,"tool-events.json"),toolEvents);
  await writeNewJson(join(runDir,"pipeline.json"),{attempts:[...attempts.values()],accounting:ledger.summary(),operations:[...dataByOperation.values()],newCash:options.mode==="replay"?{reportedUsd:0,unknownUsd:0}:charges});
  await writeNewJson(join(runDir,"outcome.json"),{status,errors,startedAt,endedAt,durationMs,settled,promptOutcomes,limits:limits.usage(),purpose});
  const captureRoot=join(options.seriesRoot,`${options.runId}-workspace`);
  await cp(options.workspace,captureRoot,{recursive:true,errorOnExist:true,force:false});
  await writeNewJson(join(runDir,"workspace.json"),{path:captureRoot,sha256:await studyTreeDigest(captureRoot)});
  const requestText = await readFile(collector.observer.outPath, "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return ""; throw error; });
  const captures = requestText.split("\n").filter(Boolean).map((line) => JSON.parse(line) as {toolCatalogueSha256:string});
  const catalogue=captures[0]?.toolCatalogueSha256??sha256Canonical(asJson([]));
  const observation:StudyAnalysisRun={
    runId:options.runId,queryId:options.task.id,experiment:"codemode",purpose,arm:options.arm,repeat:options.repeat,seed:options.seed,order:options.order,
    methodSha256:options.methodSha256,corpusSha256:options.corpusSha256,fixtureSha256:options.bundle?studyBundleSha256(options.bundle):null,
    candidateCommit:options.candidateCommit,lockfileSha256:options.lockfileSha256,host:asJson(options.hostSelection) as Record<string,string>,effectiveSettings:asJson(settings),
    toolCatalogueSha256:catalogue,promptSha256:sha256Canonical(asJson({system:STUDY_SYSTEM_PROMPT,prompts})),status,replayValidity,
    ...(options.rerunOf ? {rerunOf:options.rerunOf,rerunReason:options.rerunReason,rerunSeries:options.rerunSeries} : {}),
    observerComplete:collector.observer.complete,mainUsage:main.usage,pipelineUsage:ledger.summary(),reportedPipelineUsd:options.mode==="replay"?0:charges.missingCharges?null:charges.reportedUsd,estimatedPipelineUsd:null,
    subscriptionQuota:asJson(collector.providerResponses.map((p)=>p.visibleHeaders)),artifacts:[],...(errors.length?{error:errors.join("; ")} : {}),
    population:options.mode==="live"?"live":"replay",partition:options.task.partition,workflow:options.task.workflow,
    mainUsageComplete:main.uncachedComplete,mainInputTotalComplete:main.totalComplete,returnedMs:durationMs,qualityJudge1:null,qualityJudge2:null,
  };
  const manifest=await writeRunManifest(runDir);
  const bound={...observation,artifacts:[{path:manifest.path,sha256:manifest.sha256},{path:captureRoot,sha256:await studyTreeDigest(captureRoot)}]};
  await appendRunObservation(options.seriesRoot,bound);
  return {runDir,observation:bound,manifestSha256:manifest.sha256,...(bundle?{captureBundle:bundle}:{})};
}
