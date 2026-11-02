// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// One bounded main-usage metadata observation on the pinned study host. It
// sends exactly one prompt to the prescribed subscription main model, with no
// tools, extensions or research pipeline, then saves the actual request, raw
// usage fields, canonical message and their correlation. It defines no paired
// endpoint and collects no comparison.
//
//   node --import tsx scripts/benchmarks/study-metadata.ts --preflight
//   node --import tsx scripts/benchmarks/study-metadata.ts \
//     --series metadata-20261102T152129Z --allow-dirty-reason "<why>"
//
// A series accepts one run. A later attempt needs --technical-rerun-reason,
// which is recorded and never replaces the earlier run.

import { randomBytes } from "node:crypto";
import { mkdir, readdir, rmdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { asJson, sha256Text } from "./canonical.js";
import {
  PINNED_HOST_VERSION,
  STUDY_MAIN_MODEL,
  StudyRefusalError,
  assertRepositoryAdmissible,
  createStudyRecorder,
  importStudyHost,
  installModuleLoadRecorder,
  openStudySession,
  readCredentialFileState,
  readRepositoryIdentity,
  reportLoadedDependencies,
  resolveManagedHostRoot,
  runBoundedPrompt,
  saveRunObservations,
  scanRunForCredentials,
  selectStudyHost,
  writeNewJson,
  writeRunManifest,
  type StudyTransport,
} from "./study-host.js";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const EVIDENCE_ROOT = join(REPO_ROOT, "evidence/benchmarks");
const DEFAULT_SERIES = "metadata-20261102T152129Z";
const MAX_TIMEOUT_MS = 300_000;

export function metadataScratchPath(repo: string, series: string, runId: string): string {
  if (![series, runId].every((value) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)))
    throw new StudyRefusalError("Metadata scratch identities must be plain directory names");
  return join(repo, ".tmp/study", series, runId);
}
const MEASURING_SOURCES = [
  "scripts/benchmarks/study-host.ts",
  "scripts/benchmarks/study-metadata.ts",
  "scripts/benchmarks/main-usage-evidence.ts",
  "scripts/benchmarks/observer.ts",
  "scripts/benchmarks/usage-parser.ts",
  "scripts/benchmarks/canonical.ts",
] as const;

/**
 * Fixed prompt text. The system prompt is padded past the prompt-cache minimum
 * so the cache fields are observed on an eligible request, not merely on one
 * too short to be cached. A single request cannot show a cache read.
 */
export function metadataSystemPrompt(): string {
  const lines = [
    "You are a metadata probe. You have no tools. Follow the user's instruction exactly.",
  ];
  for (let index = 1; index <= 160; index += 1)
    lines.push(
      `Reference line ${index}: this fixed padding text has no instruction and needs no response.`,
    );
  return lines.join("\n");
}
export const METADATA_USER_PROMPT = "Reply with exactly the single word OK.";

const USAGE = `Usage: study-metadata [--preflight] [--series <id>] [--timeout-ms <n>]
  [--transport sse|auto] [--thinking <level>] [--allow-dirty-reason <text>]
  [--technical-rerun-reason <text>]
The default series already has an observation. Use a new --series for a separately
planned observation, or declare a technical rerun reason; neither replaces evidence.`;

function parseOptions() {
  const { values } = parseArgs({
    options: {
      preflight: { type: "boolean", default: false },
      series: { type: "string", default: DEFAULT_SERIES },
      "timeout-ms": { type: "string", default: "120000" },
      transport: { type: "string", default: "sse" },
      thinking: { type: "string", default: "low" },
      "allow-dirty-reason": { type: "string" },
      "technical-rerun-reason": { type: "string" },
    },
  });
  const timeoutMs = Number(values["timeout-ms"]);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS)
    throw new StudyRefusalError(`--timeout-ms must be an integer from 1 to ${MAX_TIMEOUT_MS}`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(values.series))
    throw new StudyRefusalError("--series must be a plain directory name");
  if (values.transport !== "sse" && values.transport !== "auto")
    throw new StudyRefusalError("--transport must be sse or auto");
  return {
    preflight: values.preflight,
    series: values.series,
    timeoutMs,
    transport: values.transport as StudyTransport,
    thinking: values.thinking,
    allowDirtyReason: values["allow-dirty-reason"] ?? null,
    rerunReason: values["technical-rerun-reason"] ?? null,
  };
}

/** Removes this run's workspace only if nothing was left in it. */
async function removeEmptyWorkspace(workspace: string): Promise<void> {
  await rmdir(workspace).catch(() => {});
}

/** Exit codes: 0 observed and consistent, 1 run or evidence problem, 2 refused before dispatch. */
async function main(): Promise<number> {
  const options = parseOptions();
  // Before the host loads, so the recorder witnesses every host module.
  const moduleRecorder = installModuleLoadRecorder();
  const installedAgentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi/agent");
  const hostRoot = await resolveManagedHostRoot(installedAgentDir);
  const selection = await selectStudyHost({
    root: hostRoot,
    source: "managed-install",
    expectedVersion: PINNED_HOST_VERSION,
    launcher: join(installedAgentDir, "bin/pi"),
  });
  // Automatic catalogue, version and attribution traffic are not the observation.
  Object.assign(process.env, { PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0" });
  const repository = await readRepositoryIdentity(REPO_ROOT, MEASURING_SOURCES);
  const authPath = join(installedAgentDir, "auth.json");
  const credentialsBefore = await readCredentialFileState(authPath, STUDY_MAIN_MODEL.provider);
  const host = await importStudyHost(selection);

  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  const runId = `metadata-${stamp}-${randomBytes(4).toString("hex")}`;
  const scratch = metadataScratchPath(REPO_ROOT, options.series, runId);
  const workspace = join(scratch, "workspace");
  process.env.TMPDIR = scratch;

  const systemPrompt = metadataSystemPrompt();

  if (options.preflight) {
    await mkdir(workspace, { recursive: true });
    // Opens the real session and resolves the model; dispatches no request.
    const recorder = createStudyRecorder({
      runId,
      runDir: join(scratch, `preflight-${runId}`),
      maxRequests: 1,
    });
    const handle = await openStudySession({
      host,
      workspace,
      model: STUDY_MAIN_MODEL,
      thinkingLevel: options.thinking,
      systemPrompt,
      transport: options.transport,
      requestTimeoutMs: options.timeoutMs,
      tools: [],
      extensionFactories: [recorder.factory],
    });
    const dependencies = await reportLoadedDependencies({
      urls: moduleRecorder.urls(),
      hostRoot: selection.root,
      repoRoot: REPO_ROOT,
    });
    console.log(
      JSON.stringify(
        {
          preflight: true,
          requestsSent: recorder.requestWindows,
          host: { root: selection.root, version: selection.version, exported: host.VERSION },
          agentDir: handle.agentDir,
          model: handle.resolvedModel,
          thinkingLevel: handle.session.thinkingLevel,
          activeTools: handle.activeTools,
          credentialEntryType: credentialsBefore.providerEntryType,
          outsideHostRelease: dependencies.outsideHostRelease,
          developmentPeers: dependencies.developmentPeers,
          loadedPi: dependencies.loaded.filter((item) => item.name.startsWith("@earendil-works/")),
          repository: {
            commit: repository.commit,
            dirty: repository.dirty,
            dirtyPaths: repository.dirtyPaths,
          },
        },
        null,
        2,
      ),
    );
    handle.dispose();
    await removeEmptyWorkspace(workspace);
    await removeEmptyWorkspace(scratch);
    return dependencies.outsideHostRelease.length === 0 ? 0 : 1;
  }

  assertRepositoryAdmissible(repository, options.allowDirtyReason);
  if (credentialsBefore.providerEntryType !== "oauth")
    throw new StudyRefusalError(
      `The ${STUDY_MAIN_MODEL.provider} credential entry is ${String(credentialsBefore.providerEntryType)}, not a subscription login`,
    );
  const seriesDir = join(EVIDENCE_ROOT, options.series);
  await mkdir(seriesDir, { recursive: true });
  const earlierRuns = (await readdir(seriesDir)).filter((name) => name.startsWith("metadata-"));
  if (earlierRuns.length > 0 && options.rerunReason === null)
    throw new StudyRefusalError(
      `Series ${options.series} already holds ${earlierRuns.join(", ")}; a technical rerun needs a declared reason`,
    );
  const runDir = join(seriesDir, runId);
  await mkdir(runDir); // exclusive: an existing run directory fails here
  await mkdir(workspace, { recursive: true });

  const baseIdentity = {
    runId,
    series: options.series,
    purpose: "bounded main-usage metadata observation; not a comparison or an endpoint definition",
    host: { ...selection, exportedVersion: host.VERSION },
    node: { version: process.version, execPath: process.execPath },
    environmentOverrides: ["PI_OFFLINE=1", "PI_SKIP_VERSION_CHECK=1", "PI_TELEMETRY=0", `TMPDIR=${scratch}`],
    requestedModel: STUDY_MAIN_MODEL,
    credentialClass: {
      provider: STUDY_MAIN_MODEL.provider,
      entryType: credentialsBefore.providerEntryType,
    },
    prompts: {
      systemPromptSha256: sha256Text(systemPrompt),
      userPrompt: METADATA_USER_PROMPT,
      userPromptSha256: sha256Text(METADATA_USER_PROMPT),
    },
    requestedTransport: options.transport,
    requestedThinkingLevel: options.thinking,
    timeoutMs: options.timeoutMs,
    repository,
    allowDirtyReason: options.allowDirtyReason,
    technicalRerunReason: options.rerunReason,
    earlierRunsInSeries: earlierRuns,
  };
  // Saved before any model request, so an interrupted attempt stays visible.
  await writeNewJson(join(runDir, "admission.json"), {
    ...baseIdentity,
    admittedAt: new Date().toISOString(),
  });

  const cancel = new AbortController();
  const onSignal = (): void => cancel.abort();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  let abortForLimit = (): void => {};
  const recorder = createStudyRecorder({
    runId,
    runDir,
    maxRequests: 1,
    onLimitExceeded: () => abortForLimit(),
  });
  let openError: string | null = null;
  let handle: Awaited<ReturnType<typeof openStudySession>> | null = null;
  let prompt: Awaited<ReturnType<typeof runBoundedPrompt>> | null = null;
  try {
    handle = await openStudySession({
      host,
      workspace,
      model: STUDY_MAIN_MODEL,
      thinkingLevel: options.thinking,
      systemPrompt,
      transport: options.transport,
      requestTimeoutMs: options.timeoutMs,
      tools: [],
      extensionFactories: [recorder.factory],
    });
    const session = handle.session;
    abortForLimit = () => void session.abort();
    recorder.attachSession(session);
    prompt = await runBoundedPrompt(session, METADATA_USER_PROMPT, {
      timeoutMs: options.timeoutMs,
      abortGraceMs: 10_000,
      signal: cancel.signal,
    });
  } catch (error) {
    // Preserved as an outcome, not retried and not converted to a substitute.
    openError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }

  const assessment = await saveRunObservations({ runDir, recorder, requestLimit: 1 });
  const dependencies = await reportLoadedDependencies({
    urls: moduleRecorder.urls(),
    hostRoot: selection.root,
    repoRoot: REPO_ROOT,
  });
  const credentialsAfter = await readCredentialFileState(authPath, STUDY_MAIN_MODEL.provider);
  await writeNewJson(join(runDir, "identity.json"), {
    ...baseIdentity,
    agentDir: handle?.agentDir ?? null,
    resolvedModel: handle?.resolvedModel ?? null,
    settingsGivenToHost: handle?.settings ?? null,
    effectiveThinkingLevel: handle?.session.thinkingLevel ?? null,
    activeTools: handle?.activeTools ?? null,
    effectiveSystemPromptSha256: handle ? sha256Text(handle.session.systemPrompt) : null,
    loadedDependencies: asJson(dependencies),
    moduleUrls: moduleRecorder.urls().filter((url) => url.includes("/@earendil-works/")),
  });
  const lastMessage = assessment.messages.at(-1) ?? null;
  const outcome = {
    runId,
    settledAt: new Date().toISOString(),
    openError,
    prompt,
    stopReason: lastMessage?.stopReason ?? null,
    errorMessage: lastMessage?.errorMessage ?? null,
    succeeded:
      openError === null && prompt?.settlement === "resolved" && lastMessage?.stopReason === "stop",
    evidenceConsistent: assessment.evidenceConsistent,
    problems: assessment.problems,
    limits: {
      transportAttemptsWitnessed: recorder.providerResponses.length,
      transportWitnessNote: "after_provider_response fires on the SSE path only",
    },
    credentialFileChangedDuringRun: credentialsBefore.digest !== credentialsAfter.digest,
    credentialFileNote:
      "A change can be the host's normal token refresh or another process on this machine",
    subscriptionNote:
      "Subscription quota, not cash spend. Canonical usage.cost is a catalogue estimate, not a charge.",
  };
  await writeNewJson(join(runDir, "outcome.json"), outcome);
  const scan = await scanRunForCredentials(runDir, [
    ...new Set([...credentialsBefore.values, ...credentialsAfter.values]),
  ]);
  await writeNewJson(join(runDir, "credential-scan.json"), {
    filesScanned: scan.filesScanned,
    matchedFiles: scan.matchedFiles,
    note: "Counts leaf values of the credential file and bearer-token shapes; no value is recorded.",
  });
  const manifest = await writeRunManifest(runDir);
  handle?.dispose();
  await removeEmptyWorkspace(workspace);
  await removeEmptyWorkspace(scratch);

  console.log(
    JSON.stringify(
      {
        runDir,
        manifestSha256: manifest.sha256,
        succeeded: outcome.succeeded,
        evidenceConsistent: outcome.evidenceConsistent,
        problems: outcome.problems,
        settlement: prompt?.settlement ?? null,
        openError,
        requestWindows: assessment.requestWindows,
        providerResponses: assessment.providerResponses,
        credentialMatches: scan.matchedFiles,
      },
      null,
      2,
    ),
  );
  return outcome.succeeded && outcome.evidenceConsistent && scan.matchedFiles.length === 0 ? 0 : 1;
}

// A cached transport connection can hold the process open after settling.
function exitWith(code: number): void {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 250);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then(exitWith, (error: unknown) => {
    if (error instanceof StudyRefusalError) {
      console.error(`Refused: ${error.message}\n${USAGE}`);
      exitWith(2);
      return;
    }
    console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    exitWith(1);
  });
}
