// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// Pinned-host session assembly for the research-handoff study (Track B).
//
// Loads the owner-approved Pi 1.5.0 release by absolute path (never the
// repository's 1.1.0 development peers and never a moving launcher), builds
// fully isolated SDK sessions for both arms, and wraps the agent stream
// function so every main-model provider request is intercepted at the fetch
// boundary: recorded before dispatch, capped synchronously (4 logical
// requests, 3 attempts), wire body decoded and compared against the
// payload-hook observation. Synthetic runs exercise the real provider
// serialisation through the pinned openai-responses implementation with a
// scripted fetch; no credentials and no network are involved.

import { createRequire } from "node:module";
import { readFile, writeFile, mkdir, rename, rm, realpath, stat } from "node:fs/promises";
import { zstdDecompressSync } from "node:zlib";
import { isAbsolute, resolve, relative, join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  CredentialStore,
  Credential,
} from "@earendil-works/pi-ai";
import type {
  ExtensionFactory,
  InlineExtension,
  ToolDefinition,
  AgentSession,
} from "@earendil-works/pi-coding-agent";
import { canonicalJson, sha256Hex, computeFrozenDigest } from "./common-inputs.js";
import type { BenchmarkRegistrationOptions } from "./registration.js";
import { HOST_PATH, HOST_VERSION, MAIN_MODEL, MAIN_LIMITS } from "./config.js";
import type { Arm, Journal, MainAttempt } from "./contracts.js";
import {
  RunRecorder,
  recorderExtensionFactory,
  type RunObservation,
} from "./recorder.js";
import { REQUIRED_MODELS } from "../../src/providers.js";

// ---------------------------------------------------------------------------
// Pinned host loading
// ---------------------------------------------------------------------------

/** Values loaded from the pinned release; types come from the study tsconfig mapping. */
export type PinnedSdk = typeof import("@earendil-works/pi-coding-agent");

export interface HostHandle {
  identity: {
    path: string;
    version: string;
    dependencies: Record<string, { path: string; version: string }>;
  };
  sdk: PinnedSdk;
  /** openai-codex WebSocket debug stats from the SAME pi-ai instance the host uses. */
  codexStats: {
    get(sessionId: string): unknown;
    reset(sessionId?: string): void;
    close(sessionId?: string): void;
  };
  /** Re-marks a wrapped stream function so AgentSession keeps runtime auth semantics. */
  markRuntimeStreamFunction(streamFn: unknown, runtime: unknown): void;
}

const PINNED_PEERS = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-codemode",
  "@earendil-works/pi-mcp",
  "@earendil-works/pi-tui",
] as const;

/** Package ROOT of a pinned peer: resolved by walking up from the release root, exactly like Node module resolution (peers are hoisted siblings, and `dirname` of a resolved entry is dist/, never the root). */
async function pinnedPackageRoot(releaseRoot: string, peer: string): Promise<string> {
  const parts = peer.split("/");
  let dir = releaseRoot;
  for (;;) {
    const candidate = join(dir, "node_modules", ...parts);
    try {
      await readFile(join(candidate, "package.json"), "utf8");
      return candidate;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) {
        throw new Error(`pinned peer ${peer} not found above ${releaseRoot}`);
      }
      dir = parent;
    }
  }
}

async function readPackageJson(root: string): Promise<{ name: string; version: string }> {
  const parsed = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { name?: string; version?: string };
  if (typeof parsed.name !== "string" || typeof parsed.version !== "string") {
    throw new Error(`package.json at ${root} lacks name/version`);
  }
  return parsed as { name: string; version: string };
}

/**
 * Load the pinned host by absolute path. Asserts the version and each peer's
 * package root and version (peers are ESM-only; roots are addressed directly
 * and ESM entries imported by file URL). Never falls back to another tree.
 */
export async function loadPinnedHost(releaseRoot: string = HOST_PATH, expectedVersion: string = HOST_VERSION): Promise<HostHandle> {
  const rootPackage = await readPackageJson(releaseRoot);
  if (rootPackage.name !== "@earendil-works/pi-coding-agent" || rootPackage.version !== expectedVersion) {
    throw new Error(`pinned host mismatch at ${releaseRoot}: ${rootPackage.name}@${rootPackage.version}, expected pi-coding-agent@${expectedVersion}`);
  }
  const dependencies: Record<string, { path: string; version: string }> = {};
  for (const peer of PINNED_PEERS) {
    const root = await pinnedPackageRoot(releaseRoot, peer);
    const pkg = await readPackageJson(root);
    if (pkg.name !== peer) {
      throw new Error(`pinned peer mismatch at ${root}: package.json names ${pkg.name}, expected ${peer}`);
    }
    if (pkg.version !== expectedVersion) {
      throw new Error(`pinned peer ${peer} at ${root} has version ${pkg.version}, expected ${expectedVersion}`);
    }
    dependencies[peer] = { path: root, version: pkg.version };
  }
  const sdk = (await import(pathToFileURL(join(releaseRoot, "dist/index.js")).href)) as PinnedSdk;
  // Same module instance as dist/index.js uses (same absolute file URL).
  const agentSessionModule = await import(pathToFileURL(join(releaseRoot, "dist/core/agent-session.js")).href) as {
    markRuntimeStreamFunction(streamFn: unknown, runtime: unknown): void;
  };
  const piAiRoot = dependencies["@earendil-works/pi-ai"].path;
  const codexModule = await import(pathToFileURL(join(piAiRoot, "dist/api/openai-codex-responses.js")).href) as {
    getOpenAICodexWebSocketDebugStats(sessionId: string): unknown;
    resetOpenAICodexWebSocketDebugStats(sessionId?: string): void;
    closeOpenAICodexWebSocketSessions(sessionId?: string): void;
  };
  return {
    identity: { path: releaseRoot, version: rootPackage.version, dependencies },
    sdk,
    codexStats: {
      get: (sessionId) => codexModule.getOpenAICodexWebSocketDebugStats(sessionId),
      reset: (sessionId) => codexModule.resetOpenAICodexWebSocketDebugStats(sessionId),
      close: (sessionId) => codexModule.closeOpenAICodexWebSocketSessions(sessionId),
    },
    markRuntimeStreamFunction: agentSessionModule.markRuntimeStreamFunction,
  };
}

// ---------------------------------------------------------------------------
// Credentials (no refresh-token copying; synthetic runs read nothing real)
// ---------------------------------------------------------------------------

export type CredentialSource =
  | { kind: "readonly-file"; authPath: string }
  | { kind: "inmemory"; credentials: Record<string, Credential> };

/** Read-only reference to a live auth.json. `modify` resolves undefined (never rotates). */
export function readOnlyFileCredentialStore(sdk: PinnedSdk, authPath: string): CredentialStore {
  return {
    async read(providerId) {
      return sdk.readStoredCredential(providerId, authPath) ?? undefined;
    },
    async list() {
      return [];
    },
    async modify() {
      // Deliberately non-refreshing: a rotated refresh token must never be
      // persisted anywhere but the operator's own store.
      return undefined;
    },
    async delete() {
      /* read-only */
    },
  };
}

export function inMemoryCredentialStore(entries: Record<string, Credential>): CredentialStore {
  return {
    async read(providerId) {
      return entries[providerId];
    },
    async list() {
      return [];
    },
    async modify() {
      return undefined;
    },
    async delete() {
      /* fixture store */
    },
  };
}

// ---------------------------------------------------------------------------
// Runner-owned isolated models overlay (perplexity entries on openrouter)
// ---------------------------------------------------------------------------

export async function writeIsolatedModelsOverlay(agentDir: string): Promise<string> {
  const path = join(agentDir, "models.json");
  const payload = JSON.stringify({ providers: { openrouter: { models: REQUIRED_MODELS } } }, null, 2) + "\n";
  await mkdir(agentDir, { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, payload, { flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
  return path;
}

// ---------------------------------------------------------------------------
// Workspace-contained read tool (no symlink or absolute escape)
// ---------------------------------------------------------------------------

async function resolveContained(workspace: string, requested: string): Promise<string> {
  const realWorkspace = await realpath(workspace);
  const absolute = isAbsolute(requested) ? resolve(requested) : resolve(realWorkspace, requested);
  const lexical = relative(realWorkspace, absolute);
  if (lexical.startsWith("..") || isAbsolute(lexical)) {
    throw new Error(`path escapes the run workspace: ${requested}`);
  }
  // Walk up to the deepest existing ancestor and realpath it, so a symlinked
  // directory cannot smuggle a target outside the workspace (existing or not).
  let probe = absolute;
  const tail: string[] = [];
  for (;;) {
    try {
      const real = await realpath(probe);
      const realFull = tail.length === 0 ? real : resolve(real, ...tail);
      const realRel = relative(realWorkspace, realFull);
      if (realRel.startsWith("..") || isAbsolute(realRel)) {
        throw new Error(`path resolves outside the run workspace: ${requested}`);
      }
      return absolute;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "ENOENT") throw error;
    }
    const parent = dirname(probe);
    if (parent === probe) throw new Error(`path escapes the filesystem root: ${requested}`);
    tail.unshift(probe.slice(parent.length + 1));
    probe = parent;
  }
}

/** The matched read capability: built-in read behaviour, contained to the workspace. */
export function containedReadTool(sdk: PinnedSdk, workspace: string): ToolDefinition {
  const operations = {
    async readFile(absolutePath: string): Promise<Buffer> {
      const contained = await resolveContained(workspace, absolutePath);
      const { readFile: read } = await import("node:fs/promises");
      return read(contained);
    },
    async access(absolutePath: string): Promise<void> {
      const contained = await resolveContained(workspace, absolutePath);
      await stat(contained);
    },
  };
  return sdk.createReadToolDefinition(workspace, { operations }) as ToolDefinition;
}

// ---------------------------------------------------------------------------
// Synthetic main transport (real provider serialisation, scripted fetch)
// ---------------------------------------------------------------------------

export const SYNTHETIC_PROVIDER_ID = "rh-synthetic";
export const SYNTHETIC_MODEL_ID = "main-sim";

export interface SyntheticTurn {
  items: Array<
    | { type: "message"; text: string }
    | { type: "function_call"; name: string; args: unknown }
  >;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens?: number;
    cached_tokens?: number;
    reasoning_tokens?: number;
  };
}

/** One physical fetch outcome: a scripted SSE response or a thrown fetch. */
export type SyntheticFetchOutcome =
  | { kind: "response"; status: number; turn: SyntheticTurn }
  | { kind: "throw"; message: string };

/** script[logicalIndex - 1][attemptIndex - 1] selects the physical outcome. */
export type SyntheticScript = SyntheticFetchOutcome[][];

function sseBody(turn: SyntheticTurn, responseId: string): string {
  const frames: string[] = [`{"type":"response.created","response":{"id":"${responseId}"}}`];
  turn.items.forEach((item, index) => {
    if (item.type === "message") {
      const wire = { type: "message", id: `msg_${index}`, content: [{ type: "output_text", text: item.text }] };
      frames.push(`{"type":"response.output_item.added","output_index":${index},"item":${JSON.stringify(wire)}}`);
      frames.push(`{"type":"response.output_item.done","output_index":${index},"item":${JSON.stringify(wire)}}`);
    } else {
      const argumentsJson = JSON.stringify(item.args);
      const wire = { type: "function_call", call_id: `call_${index}`, id: `fc_${index}`, name: item.name, arguments: argumentsJson };
      frames.push(`{"type":"response.output_item.added","output_index":${index},"item":${JSON.stringify(wire)}}`);
      // `response.function_call_arguments.done` carries the complete argument
      // text at the TOP LEVEL (the pinned parser reads event.arguments).
      frames.push(`{"type":"response.function_call_arguments.done","output_index":${index},"arguments":${JSON.stringify(argumentsJson)}}`);
      frames.push(`{"type":"response.output_item.done","output_index":${index},"item":${JSON.stringify(wire)}}`);
    }
  });
  const usage = turn.usage
    ? {
      input_tokens: turn.usage.input_tokens,
      output_tokens: turn.usage.output_tokens,
      total_tokens: turn.usage.total_tokens ?? turn.usage.input_tokens + turn.usage.output_tokens,
      input_tokens_details: { cached_tokens: turn.usage.cached_tokens ?? 0 },
      output_tokens_details: { reasoning_tokens: turn.usage.reasoning_tokens ?? 0 },
    }
    : undefined;
  frames.push(`{"type":"response.completed","response":{"id":"${responseId}","status":"completed"${usage ? `,"usage":${JSON.stringify(usage)}` : ""}}}`);
  return frames.map((frame) => `data: ${frame}\n\n`).join("");
}

/** The synthetic main provider registration (applied directly to the ModelRuntime before session creation, because providers registered inside extension factories only flush when the session binds its runner). */
export function syntheticMainProviderConfig() {
  return {
    name: "Research Handoff Synthetic Main",
    baseUrl: "https://rh-synthetic.invalid/v1",
    apiKey: "rh-synthetic-no-network",
    api: "openai-responses",
    models: [
      {
        type: "chat",
        id: SYNTHETIC_MODEL_ID,
        name: "RH Main Sim",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200_000,
        maxTokens: 8_192,
      },
    ],
  } as never;
}

// ---------------------------------------------------------------------------
// Session assembly
// ---------------------------------------------------------------------------

export interface StudySessionConfig {
  runId: string;
  arm: Arm;
  phase: "synthetic" | "diagnostic" | "measured";
  /** Fresh, empty, per-run workspace (own .search output). */
  workspaceDir: string;
  /** Isolated agent dir; the runner points PI_CODING_AGENT_DIR here and writes settings.json. */
  agentDir: string;
  credentials: CredentialSource;
  /** Track A's registration factory plus its frozen inputs. */
  research: {
    extension: (options: BenchmarkRegistrationOptions) => ExtensionFactory;
    frozenPath: string;
    /** F11 binding: the loaded corpus must carry exactly this accepted digest. */
    expectedDigest: string;
    callLlmDelegate?: BenchmarkRegistrationOptions["callLlmDelegate"];
  };
  /** Optional appended system-prompt lines (forwarded to the resource loader; tests use a distinctive sentinel). */
  appendSystemPrompt?: string[];
  /** Synthetic mode: scripted main-model outcomes; forbids real credentials. */
  syntheticScript?: SyntheticScript;
}

export interface StudySession {
  readonly sessionId: string;
  readonly recorder: RunRecorder;
  activeTools(): readonly string[];
  systemPrompt(): string;
  prompt(text: string): Promise<void>;
  abort(): Promise<void>;
  observation(): RunObservation;
  dispose(): void;
}

/**
 * Final retained-context combination. The settled session transcript may omit
 * (or structurally differ from) the leading system/tool-declaration message the
 * last dispatched stream context carried, so the ACTUAL prefix captured from
 * that context completes or replaces the leading entry. Nothing is estimated
 * and no partial transcript is relabelled: without a captured prefix the
 * settled messages are returned as-is and the action says so.
 */
export interface FinalContextCombination {
  messages: unknown[];
  action: "session-had-prefix" | "prefix-prepended" | "prefix-from-dispatched" | "no-captured-prefix";
  digests?: { settledPrefixDigest?: string; capturedPrefixDigest: string };
}

export function combineFinalRetainedContext(
  capturedContextMessages: readonly unknown[] | undefined,
  settledMessages: readonly unknown[],
): FinalContextCombination {
  const role = (message: unknown) => (message as { role?: string } | null)?.role;
  // pi-agent-core keeps the leading system message at index 0; anything else
  // means there is no provable leading prefix to reuse.
  const capturedLeading = capturedContextMessages && role(capturedContextMessages[0]) === "system"
    ? capturedContextMessages[0]
    : undefined;
  if (capturedLeading === undefined) {
    return { messages: [...settledMessages], action: "no-captured-prefix" };
  }
  const capturedPrefixDigest = sha256Hex(canonicalJson(capturedLeading));
  if (role(settledMessages[0]) !== "system") {
    return { messages: [structuredClone(capturedLeading), ...settledMessages], action: "prefix-prepended", digests: { capturedPrefixDigest } };
  }
  const settledJson = canonicalJson(settledMessages[0]);
  if (settledJson === canonicalJson(capturedLeading)) {
    return { messages: [...settledMessages], action: "session-had-prefix", digests: { capturedPrefixDigest } };
  }
  // Both are complete leading system messages but differ (for example a
  // mid-run loadout change). The DISPATCHED prefix is the authoritative record
  // of what the model actually processed in the final request; keep the
  // settled tail and journal both digests.
  return {
    messages: [structuredClone(capturedLeading), ...settledMessages.slice(1)],
    action: "prefix-from-dispatched",
    digests: {
      settledPrefixDigest: sha256Hex(settledJson),
      capturedPrefixDigest,
    },
  };
}

const BASELINE_TOOLS = ["intelli_research", "read"] as const;
const CANDIDATE_TOOLS = ["codemode", "intelli_research", "read"] as const;

function summarizeContext(context: unknown): unknown {
  const messages = (context as { messages?: unknown[] } | null)?.messages ?? [];
  return {
    messageCount: messages.length,
    roles: messages.map((message) => (message as { role?: string }).role ?? "?"),
  };
}

async function decodeWireBody(init: RequestInit | undefined): Promise<{ payload: unknown; encoding: MainAttempt["wireEncoding"] }> {
  const headers = new Headers(init?.headers);
  const body = init?.body;
  if (typeof body === "string") {
    try {
      return { payload: JSON.parse(body) as unknown, encoding: "identity" };
    } catch {
      return { payload: undefined, encoding: "identity" };
    }
  }
  if (body instanceof Uint8Array || Buffer.isBuffer(body)) {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
    if ((headers.get("content-encoding") ?? "").toLowerCase() === "zstd") {
      try {
        return { payload: JSON.parse(zstdDecompressSync(bytes).toString("utf8")) as unknown, encoding: "zstd" };
      } catch {
        return { payload: undefined, encoding: "zstd" };
      }
    }
    try {
      return { payload: JSON.parse(bytes.toString("utf8")) as unknown, encoding: "identity" };
    } catch {
      return { payload: undefined, encoding: "identity" };
    }
  }
  return { payload: undefined, encoding: "identity" };
}

/**
 * Assemble one study session on the pinned host.
 *
 * - In-memory settings (transport sse, retry disabled, provider maxRetries 2,
 *   compaction off, cache warming off) and in-memory session storage.
 * - Inline-only resources with ALL discovery disabled: no extensions, skills,
 *   prompt templates, themes or context files from the workspace, its
 *   ancestors, or the agent dir. The research core's own settings discovery
 *   still reads PI_CODING_AGENT_DIR; the runner must point it at agentDir.
 * - The agent stream function is wrapped for the main model only: logical
 *   cap checked before delegation, fetch intercepted per attempt (record
 *   before dispatch, decode body, cap attempts), cacheRetention "none".
 * The original stream function and its runtime marking are preserved.
 */
export async function createStudySession(
  host: HostHandle,
  cfg: StudySessionConfig,
  recorder: RunRecorder,
): Promise<StudySession> {
  const { sdk } = host;
  if (cfg.syntheticScript && cfg.credentials.kind === "readonly-file") {
    throw new Error("synthetic runs must not reference real credential files");
  }
  // F11: bind the corpus the registration will load to the ACCEPTED digest.
  // Both the file's declared digest and a recomputation from its content must
  // equal expectedDigest, so a stale or tampered corpus cannot serve a run.
  const frozenFile = JSON.parse(await readFile(cfg.research.frozenPath, "utf8")) as Record<string, unknown> & { digest?: unknown };
  const { digest: declared, ...frozenCore } = frozenFile;
  const recomputed = computeFrozenDigest(frozenCore as never);
  if (typeof declared !== "string" || declared !== cfg.research.expectedDigest || recomputed !== cfg.research.expectedDigest) {
    throw new Error(
      `frozen corpus digest mismatch for ${cfg.research.frozenPath}: declared=${String(declared)} recomputed=${recomputed} expected=${cfg.research.expectedDigest}`,
    );
  }
  await writeIsolatedModelsOverlay(cfg.agentDir);

  const synthetic = cfg.syntheticScript !== undefined;
  const settingsManager = sdk.SettingsManager.inMemory({
    transport: MAIN_LIMITS.transport,
    retry: { enabled: false, provider: { maxRetries: MAIN_LIMITS.providerAttempts - 1 } },
    compaction: { enabled: false },
    cacheWarming: "off",
  });
  const sessionManager = sdk.SessionManager.inMemory();

  const extensionFactories: InlineExtension[] = [
    recorderExtensionFactory(recorder),
    cfg.research.extension({
      journal: recorder.journal(),
      frozenPath: cfg.research.frozenPath,
      ...(cfg.research.callLlmDelegate !== undefined ? { callLlmDelegate: cfg.research.callLlmDelegate } : {}),
      // Forwarded so Track A's registration can bind and journal the served
      // digest once its signature requires it (excess-tolerant until then).
      expectedDigest: cfg.research.expectedDigest,
    } as BenchmarkRegistrationOptions),
  ];
  if (cfg.arm === "candidate") {
    extensionFactories.push(
      sdk.createCodemodeExtension({ mode: "only", inlineBudget: 3000, models: false }),
    );
  }
  const resourceLoader = new sdk.DefaultResourceLoader({
    cwd: cfg.workspaceDir,
    agentDir: cfg.agentDir,
    settingsManager,
    extensionFactories,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    ...(cfg.appendSystemPrompt?.length ? { appendSystemPrompt: cfg.appendSystemPrompt } : {}),
  });
  await resourceLoader.reload();

  const credentials = cfg.credentials.kind === "readonly-file"
    ? readOnlyFileCredentialStore(sdk, cfg.credentials.authPath)
    : inMemoryCredentialStore(cfg.credentials.credentials);
  const modelRuntime = await sdk.ModelRuntime.create({
    credentials,
    modelsPath: join(cfg.agentDir, "models.json"),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });

  const mainProvider = synthetic ? SYNTHETIC_PROVIDER_ID : MAIN_MODEL.provider;
  const mainModelId = synthetic ? SYNTHETIC_MODEL_ID : MAIN_MODEL.model;
  if (synthetic) {
    // Registered on the runtime BEFORE session creation: providers registered
    // inside extension factories stay pending until the session binds its
    // runner, which is too late for initial model selection here.
    modelRuntime.registerProvider(SYNTHETIC_PROVIDER_ID, syntheticMainProviderConfig());
  }
  const model = modelRuntime.getModel(mainProvider, mainModelId);
  if (!model) {
    throw new Error(
      synthetic
        ? `synthetic main model ${mainProvider}/${mainModelId} missing after direct runtime registration`
        : `main model ${mainProvider}/${mainModelId} not present in the pinned registry`,
    );
  }

  const tools = cfg.arm === "baseline" ? [...BASELINE_TOOLS] : [...CANDIDATE_TOOLS];
  const { session } = await sdk.createAgentSession({
    cwd: cfg.workspaceDir,
    agentDir: cfg.agentDir,
    model,
    thinkingLevel: MAIN_LIMITS.reasoning,
    tools,
    customTools: [containedReadTool(sdk, cfg.workspaceDir)],
    resourceLoader,
    sessionManager,
    settingsManager,
    modelRuntime,
  });

  // Intercept main-model provider requests at the dispatch boundary.
  const originalStreamFn = session.agent.streamFunction;
  const wrappedStreamFn = async (modelArg: unknown, context: unknown, options?: Record<string, unknown>) => {
    const isMain = (modelArg as { provider?: string; id?: string } | null)?.provider === mainProvider
      && (modelArg as { id?: string } | null)?.id === mainModelId;
    if (!isMain) {
      return originalStreamFn(modelArg as never, context as never, options as never);
    }
    // Synchronous logical cap: the fifth request never reaches the transport,
    // so no hook, no fetch and no transmission happens for it.
    const handle = recorder.beginMainRequest(context);
    const attemptFetch = async (input: unknown, init?: RequestInit): Promise<Response> => {
      const script = cfg.syntheticScript;
      const attemptId = recorder.beginAttempt(handle.index, script ? "synthetic" : "identity");
      // Record BEFORE dispatch: decode what is about to be transmitted.
      // noteWireBody throws WireIntegrityError (recording the failed attempt)
      // on an undecodable body or a payload-hook mismatch; the transmission
      // is then refused by rethrowing.
      let wire: { payload: unknown; encoding: MainAttempt["wireEncoding"] };
      try {
        wire = await decodeWireBody(init);
        recorder.noteWireBody(attemptId, wire.payload, script ? "synthetic" : wire.encoding);
      } catch (error) {
        throw error;
      }
      if (script) {
        const outcomes = script[handle.index - 1] ?? [];
        const outcome = outcomes[recorder.attemptCount(handle.index) - 1] ?? { kind: "throw" as const, message: "synthetic script exhausted" };
        if (outcome.kind === "throw") {
          recorder.failAttempt(attemptId, "error", outcome.message);
          throw new Error(outcome.message);
        }
        const response = new Response(
          outcome.status >= 200 && outcome.status < 300
            ? sseBody(outcome.turn, `resp-sim-${handle.index}-${recorder.attemptCount(handle.index)}`)
            : "",
          { status: outcome.status, headers: { "content-type": "text/event-stream" } },
        );
        if (!(outcome.status >= 200 && outcome.status < 300)) {
          recorder.failAttempt(attemptId, "error", `http ${outcome.status} (scripted)`);
        }
        // A 2xx attempt stays "started": headers alone are not completion.
        // The terminal provider usage event completes it (recorder), or settle
        // flags it as never terminated.
        return response;
      }
      const baseFetch = (options?.fetch as typeof globalThis.fetch | undefined) ?? globalThis.fetch;
      let response: Response;
      try {
        response = await baseFetch(input as never, init as never);
      } catch (error) {
        const aborted = (error as { name?: string }).name === "AbortError" || (init?.signal as AbortSignal | undefined)?.aborted === true;
        recorder.failAttempt(attemptId, aborted ? "aborted" : "error", String(error));
        throw error;
      }
      if (!response.ok) {
        recorder.failAttempt(attemptId, "error", `http ${response.status}`);
      }
      return response;
    };
    const patched: Record<string, unknown> = { ...options, cacheRetention: "none", fetch: attemptFetch };
    return originalStreamFn(modelArg as never, context as never, patched as never);
  };
  session.agent.streamFunction = wrappedStreamFn as typeof originalStreamFn;
  host.markRuntimeStreamFunction(wrappedStreamFn, session.modelRuntime);

  await session.bindExtensions({});
  const activeToolNames = session.getActiveToolNames();
  recorder.noteSystemPromptAndCatalogue(session.systemPrompt, { activeTools: [...activeToolNames], arm: cfg.arm, phase: cfg.phase });
  recorder.noteEnvironment({
    runId: cfg.runId,
    arm: cfg.arm,
    phase: cfg.phase,
    host: host.identity,
    piCodingAgentDir: process.env.PI_CODING_AGENT_DIR ?? null,
    agentDir: cfg.agentDir,
    workspaceDir: cfg.workspaceDir,
    mainProvider,
    mainModelId,
    node: process.version,
  });
  recorder.journal().record({
    kind: "observer/corpus-bound",
    data: { expectedDigest: cfg.research.expectedDigest, servedDigest: declared, frozenPath: cfg.research.frozenPath },
  });
  if (process.env.PI_CODING_AGENT_DIR !== undefined && process.env.PI_CODING_AGENT_DIR !== cfg.agentDir) {
    recorder.markNonconforming(`PI_CODING_AGENT_DIR (${process.env.PI_CODING_AGENT_DIR}) does not point at the isolated agent dir (${cfg.agentDir})`);
  }

  const unsubscribe = session.subscribe((event) => {
    const type = (event as { type?: string }).type;
    if (type === "agent_settled") {
      recorder.noteAgentSettled((event as { aborted?: boolean }).aborted === true);
    } else if (type && type !== "message_update" && type !== "tool_execution_update" && type !== "message_start" && type !== "message_end" && type !== "turn_start" && type !== "turn_end" && type !== "tool_execution_start" && type !== "tool_execution_end" && type !== "agent_start" && type !== "agent_end") {
      recorder.journal().record({ kind: `observer/session-event`, data: { type, value: redactEvent(event) } });
    }
  });

  return {
    sessionId: session.sessionId,
    recorder,
    activeTools: () => session.getActiveToolNames(),
    systemPrompt: () => session.systemPrompt,
    async prompt(text: string): Promise<void> {
      recorder.notePrompt(text);
      await session.prompt(text);
    },
    async abort(): Promise<void> {
      await session.abort();
    },
    observation(): RunObservation {
      const stats = host.codexStats.get(session.sessionId);
      recorder.journal().record({ kind: "observer/codex-websocket-stats", data: { sessionId: session.sessionId, stats: stats ?? null } });
      // Final exposure: the COMPLETE retained model context. The settled
      // session transcript alone may omit the leading system/declaration
      // message the stream context carries, so combine it with the ACTUAL
      // prefix captured from the last full stream context.
      const settled = session.messages.map((message) => structuredClone(message));
      const combination = combineFinalRetainedContext(recorder.lastMainContextMessages(), settled);
      if (combination.action === "no-captured-prefix") {
        recorder.noteObserverProblem("final retained context: no dispatched stream context prefix captured; system/declaration completeness unverified");
      }
      recorder.journal().record({
        kind: "observer/final-context",
        data: {
          action: combination.action,
          digests: combination.digests ?? null,
          settledCount: settled.length,
          finalCount: combination.messages.length,
        },
      });
      recorder.noteFinalTranscript(combination.messages);
      return recorder.output();
    },
    dispose(): void {
      unsubscribe();
      host.codexStats.close(session.sessionId);
      session.dispose();
    },
  };
}

function redactEvent(event: unknown): unknown {
  const type = (event as { type?: string }).type;
  if (type === "queue_update") return event;
  return { type };
}

/** Convenience for the runner: build the recorder with the frozen limits. */
export function createRecorder(
  runId: string,
  arm: Arm,
  allowedTopLevelTools: readonly string[],
  mainModelId: string,
  durable?: Journal,
): RunRecorder {
  return new RunRecorder({
    runId,
    arm,
    mainModelId,
    maxLogicalMainRequests: MAIN_LIMITS.logicalRequests,
    maxProviderAttempts: MAIN_LIMITS.providerAttempts,
    allowedTopLevelTools,
    ...(durable ? { durable } : {}),
  });
}

/** The main-model id a given configuration will actually dispatch to. */
export function mainModelIdFor(synthetic: boolean): string {
  return synthetic ? SYNTHETIC_MODEL_ID : MAIN_MODEL.model;
}

export function allowedToolsForArm(arm: Arm): readonly string[] {
  return arm === "baseline" ? BASELINE_TOOLS : CANDIDATE_TOOLS;
}

export type { Journal };
