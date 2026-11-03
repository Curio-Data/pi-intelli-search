// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Reusable real-host session setup and recording for the research-first
// Codemode study (docs/plans/codemode/RESEARCH-PLAN.md). This module holds no
// endpoint, arm or comparison definition: it opens one explicitly selected
// host session, observes what that session actually sends and receives, and
// reports what is known and what is missing.
//
// Host facts this module depends on (Observed in the installed Pi 1.4.0
// package and its bundled pi-ai 1.4.0, 2 November 2026):
//
// - `provider_stream_event` carries the raw provider event BEFORE pi-ai maps
//   it. pi-ai's Codex mapper accepts `response.done`, `response.completed` and
//   `response.incomplete` as terminal events, so a raw terminal event may not
//   be spelled the way the normalised stream spells it. The raw tap below
//   therefore reads usage from any event carrying it and is compared with the
//   collector rather than trusting either alone.
// - A callback that throws inside the Codex stream fails the provider request
//   (ProviderStreamEventCallbackError). Every handler here catches its errors
//   and records them; a recording fault must never alter the observed run.
// - `before_provider_request` fires once per logical request, before any
//   transport selection. On `transport: "auto"` a later turn may be sent as a
//   `previous_response_id` input delta over a cached WebSocket, so its payload
//   is the logical request and not the wire frame. `after_provider_response`
//   fires only on the SSE path. Runs record the transport they selected.
//
// Host types are structural on purpose: the compiler's development peer is an
// older package than the host measured at run time, and importing its types
// would imply an identity this module has to prove instead.

import { execFile } from "node:child_process";
import { open, readFile, readdir } from "node:fs/promises";
import { registerHooks } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { asJson, canonicalJson, sha256Bytes, sha256Canonical } from "./canonical.js";
import type { Json, ParsedUsage, TokenObservation } from "./contracts.js";
import {
  createMainUsageEvidenceCollector,
  mainUsageEvidenceV2Json,
  wireMainUsageEvidence,
  type MainUsageEvidenceCollector,
  type MainUsageEvidenceV2Record,
  type WireUsageFields,
} from "./main-usage-evidence.js";
import {
  captureProviderPayload,
  createRequestObserver,
  type FileRequestObserver,
} from "./observer.js";
import { parseUsageEvents } from "./usage-parser.js";

/** Owner-selected study host (docs/plans/codemode/OWNER-REFOCUS.md, One Current Host). */
export const PINNED_HOST_VERSION = "1.4.0";
/** Owner-prescribed main model. Never substituted. */
export const STUDY_MAIN_MODEL = { provider: "openai-codex", id: "gpt-6.1-sol" } as const;

const HOST_PACKAGE = "@earendil-works/pi-coding-agent";
const execFileAsync = promisify(execFile);

export class StudyRefusalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudyRefusalError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

// ── Host selection and loaded identity ──────────────────────────────────────

export interface StudyHostSelection {
  readonly root: string;
  readonly version: string;
  /** How the root was chosen; never inferred from the repository's peers. */
  readonly source: "managed-install" | "explicit-root";
  readonly launcher: string | null;
}

/** Package root of the managed install's current release, without running it. */
export async function resolveManagedHostRoot(installedAgentDir: string): Promise<string> {
  const current = (
    await readFile(join(installedAgentDir, "install/current-version"), "utf8")
  ).trim();
  if (!/^[0-9A-Za-z._+-]+$/.test(current) || current === "." || current === "..")
    throw new StudyRefusalError("The managed install's current-version file is invalid");
  return join(installedAgentDir, "install/releases", current, "node_modules", HOST_PACKAGE);
}

/**
 * Validates a host package root and its version. A mismatch refuses: the study
 * records a pinned host, so it never continues on whatever else is installed.
 */
export async function selectStudyHost(options: {
  readonly root: string;
  readonly source: StudyHostSelection["source"];
  /** Required version; null only for deterministic tests of the seam itself. */
  readonly expectedVersion: string | null;
  readonly launcher?: string | null;
}): Promise<StudyHostSelection> {
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(join(options.root, "package.json"), "utf8"));
  } catch (error) {
    throw new StudyRefusalError(`Host root ${options.root} is unreadable: ${errorText(error)}`);
  }
  if (
    !isRecord(manifest) ||
    manifest["name"] !== HOST_PACKAGE ||
    typeof manifest["version"] !== "string"
  )
    throw new StudyRefusalError(`${options.root} is not ${HOST_PACKAGE}`);
  if (options.expectedVersion !== null && manifest["version"] !== options.expectedVersion)
    throw new StudyRefusalError(
      `Host ${options.root} is ${manifest["version"]}, not the pinned ${options.expectedVersion}`,
    );
  return {
    root: options.root,
    version: manifest["version"],
    source: options.source,
    launcher: options.launcher ?? null,
  };
}

/** Selects the pinned release explicitly when the managed install advances mid-study. */
export async function resolveStudyHostSelection(options: {
  readonly installedAgentDir: string;
  readonly explicitRoot?: string;
  readonly expectedVersion: string | null;
}): Promise<StudyHostSelection> {
  if (options.explicitRoot !== undefined) {
    if (options.explicitRoot.trim() === "")
      throw new StudyRefusalError("The explicit host root must not be empty");
    return selectStudyHost({
      root: resolve(options.explicitRoot),
      source: "explicit-root",
      expectedVersion: options.expectedVersion,
      launcher: null,
    });
  }
  return selectStudyHost({
    root: await resolveManagedHostRoot(options.installedAgentDir),
    source: "managed-install",
    expectedVersion: options.expectedVersion,
    launcher: join(options.installedAgentDir, "bin/pi"),
  });
}

export interface ModuleLoadRecorder {
  /** Every file URL resolved since installation, deduplicated, in first-seen order. */
  urls(): readonly string[];
  stop(): void;
}

/**
 * Records module resolution through Node's synchronous hooks. Install it before
 * importing the host: this is the witness for what actually loaded, which a
 * compiler resolution or a package.json on disk cannot provide. It only reads
 * resolution results and never changes them.
 */
export function installModuleLoadRecorder(): ModuleLoadRecorder {
  const seen = new Set<string>();
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      const result = nextResolve(specifier, context);
      if (result.url.startsWith("file:")) seen.add(result.url);
      return result;
    },
  });
  return {
    urls: () => [...seen],
    stop: () => hooks.deregister(),
  };
}

export interface LoadedPackage {
  readonly name: string;
  readonly version: string | null;
  readonly path: string;
  readonly modules: number;
}

export interface LoadedDependencyReport {
  /** Packages under node_modules that resolved during the run. */
  readonly loaded: readonly LoadedPackage[];
  /** Versions of the Pi packages the repository compiles against. */
  readonly developmentPeers: readonly {
    readonly name: string;
    readonly version: string | null;
    readonly path: string;
  }[];
  /** Pi packages that loaded from outside the selected host's release tree. */
  readonly outsideHostRelease: readonly string[];
  /** True when the host's own Codex provider module resolved in this process. */
  readonly codexProviderLoaded: boolean;
}

async function readPackageVersion(packageDir: string): Promise<string | null> {
  try {
    const manifest: unknown = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8"));
    return isRecord(manifest) && typeof manifest["version"] === "string"
      ? manifest["version"]
      : null;
  } catch {
    return null;
  }
}

/** Reduces recorded module URLs to packages and checks them against the selected host. */
export async function reportLoadedDependencies(options: {
  readonly urls: readonly string[];
  readonly hostRoot: string;
  readonly repoRoot: string;
}): Promise<LoadedDependencyReport> {
  const counts = new Map<string, { name: string; path: string; modules: number }>();
  const marker = `${sep}node_modules${sep}`;
  for (const url of options.urls) {
    const path = fileURLToPath(url);
    const at = path.lastIndexOf(marker);
    if (at === -1) continue;
    const parts = path.slice(at + marker.length).split(sep);
    const name = parts[0]?.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? "");
    if (name === "") continue;
    const packageDir = path.slice(0, at + marker.length) + name.split("/").join(sep);
    const entry = counts.get(packageDir);
    if (entry) entry.modules += 1;
    else counts.set(packageDir, { name, path: packageDir, modules: 1 });
  }
  const loaded: LoadedPackage[] = [];
  for (const entry of counts.values())
    loaded.push({ ...entry, version: await readPackageVersion(entry.path) });
  loaded.sort((a, b) => a.path.localeCompare(b.path));
  // The host package root is <release>/node_modules/@earendil-works/pi-coding-agent.
  const releaseModules = dirname(dirname(options.hostRoot)) + sep;
  const outsideHostRelease = loaded
    .filter(
      (item) => item.name.startsWith("@earendil-works/") && !item.path.startsWith(releaseModules),
    )
    .map((item) => item.path);
  const developmentPeers = [];
  for (const name of ["pi-coding-agent", "pi-ai", "pi-agent-core", "pi-tui"]) {
    const path = join(options.repoRoot, "node_modules/@earendil-works", name);
    developmentPeers.push({
      name: `@earendil-works/${name}`,
      version: await readPackageVersion(path),
      path,
    });
  }
  return {
    loaded,
    developmentPeers,
    outsideHostRelease,
    codexProviderLoaded: options.urls.some(
      (url) =>
        url.startsWith(pathToFileURL(releaseModules).href) &&
        /\/pi-ai\/dist\/api\/openai-codex-responses\.js$/.test(url),
    ),
  };
}

// ── Structural host surface ─────────────────────────────────────────────────

export type StudyExtensionFactory = (pi: never) => void;

export interface StudySession {
  readonly model:
    | {
        readonly provider: string;
        readonly id: string;
        readonly api?: string;
        readonly baseUrl?: string;
      }
    | undefined;
  readonly thinkingLevel: string;
  readonly systemPrompt: string;
  prompt(text: string): Promise<void>;
  abort(): Promise<void>;
  subscribe(listener: (event: unknown) => void): () => void;
  bindExtensions(bindings: Record<string, never>): Promise<void>;
  setModel(model: unknown): Promise<void>;
  getActiveToolNames(): string[];
  dispose(): void;
}

interface StudyModelRuntime {
  getModel(provider: string, id: string): unknown;
}

export interface StudyHostModule {
  readonly VERSION: string;
  createCodemodeExtension(options: { mode: "on" | "only"; models?: boolean; inlineBudget?: number }): StudyExtensionFactory;
  getAgentDir(): string;
  readonly ModelRuntime: { create(options?: Record<string, unknown>): Promise<StudyModelRuntime> };
  readonly DefaultResourceLoader: new (options: Record<string, unknown>) => {
    reload(): Promise<void>;
    getExtensions(): { readonly errors: readonly unknown[] };
  };
  createAgentSession(options: Record<string, unknown>): Promise<{
    readonly session: StudySession;
    readonly modelFallbackMessage?: string;
  }>;
  readonly SessionManager: { inMemory(cwd?: string): unknown };
  readonly SettingsManager: { inMemory(settings?: Record<string, unknown>): unknown };
}

/** Imports the host by absolute path from its own release tree. */
export async function importStudyHost(selection: StudyHostSelection): Promise<StudyHostModule> {
  // Read from the package's own export map, not a guessed dist path.
  const manifest = JSON.parse(await readFile(join(selection.root, "package.json"), "utf8")) as {
    exports?: { "."?: string | { import?: string; default?: string } };
  };
  const main = manifest.exports?.["."];
  const entry = typeof main === "string" ? main : (main?.import ?? main?.default);
  if (entry === undefined)
    throw new StudyRefusalError(`${selection.root} has no import entry in its export map`);
  return (await import(pathToFileURL(join(selection.root, entry)).href)) as StudyHostModule;
}

// ── Raw observation ─────────────────────────────────────────────────────────

/**
 * Whitelist copy of a raw usage object: numbers, booleans and nulls verbatim at
 * their original paths; anything else keeps only its type, so a field's
 * presence is visible without retaining unexpected content.
 */
export function projectRawUsage(value: unknown): Json {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : { nonFinite: String(value) };
  if (typeof value === "string") return { nonNumeric: "string", length: value.length };
  if (Array.isArray(value)) return value.map((item) => projectRawUsage(item));
  if (!isRecord(value)) return { nonNumeric: typeof value };
  const out: Record<string, Json> = {};
  for (const key of Object.keys(value).sort()) out[key] = projectRawUsage(value[key]);
  return out;
}

/**
 * Dotted paths of every present leaf in a projected raw usage object. Provider
 * item ids and array positions become `*`, so runs can be compared by path.
 */
export function rawUsageLeafPaths(value: Json, prefix = ""): string[] {
  if (Array.isArray(value)) {
    const paths = value.flatMap((item) => rawUsageLeafPaths(item, `${prefix}[*]`));
    return paths.length > 0 ? [...new Set(paths)] : [`${prefix}[]`];
  }
  if (!isRecord(value) || "nonNumeric" in value) return prefix === "" ? [] : [prefix];
  const paths = Object.keys(value).flatMap((key) => {
    const segment = /^[a-z]+_[0-9a-f]{16,}$/.test(key) ? "*" : key;
    return rawUsageLeafPaths(value[key] as Json, prefix === "" ? segment : `${prefix}.${segment}`);
  });
  return [...new Set(paths)];
}

const RESPONSE_META_KEYS = [
  "id",
  "model",
  "status",
  "service_tier",
  "object",
  "end_turn",
  "created_at",
] as const;
const HIDDEN_HEADER = /^x-codex-turn-state$/; // opaque per-turn routing state
const VISIBLE_HEADER =
  /^(x-codex-[a-z0-9-]+|x-ratelimit-[a-z0-9-]+|x-request-id|x-oai-request-id|openai-model|openai-processing-ms|retry-after|content-type)$/;
const MAX_VISIBLE_HEADER_LENGTH = 128;
const MAX_ERROR_TEXT = 1000;

/** Header names always, values only for bounded usage and correlation headers. */
export function projectResponseHeaders(headers: unknown): {
  readonly names: readonly string[];
  readonly visible: Readonly<Record<string, string>>;
} {
  if (!isRecord(headers)) return { names: [], visible: {} };
  const names = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const visible: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (
      !HIDDEN_HEADER.test(lower) &&
      VISIBLE_HEADER.test(lower) &&
      typeof value === "string" &&
      value.length <= MAX_VISIBLE_HEADER_LENGTH
    )
      visible[lower] = value;
  }
  return { names, visible };
}

export interface RawUsageObservation {
  readonly sequence: number;
  /** The request window open when this event arrived. */
  readonly requestSequence: number;
  readonly receivedAt: string;
  readonly provider: string;
  readonly api: string;
  readonly model: string;
  /** Raw event type as the provider spelled it, before host normalisation. */
  readonly eventType: string | null;
  readonly responseId: string | null;
  readonly usagePath: "response.usage" | "usage" | "choices[0].usage";
  readonly usage: Json;
  readonly responseMeta: Json;
}

export interface ProviderResponseObservation {
  readonly sequence: number;
  readonly requestSequence: number;
  readonly receivedAt: string;
  readonly status: number | null;
  readonly headerNames: readonly string[];
  readonly visibleHeaders: Readonly<Record<string, string>>;
}

export interface ProviderErrorObservation {
  readonly requestSequence: number;
  readonly eventType: string;
  readonly code: string | null;
  readonly message: string | null;
}

function boundedText(value: unknown): string | null {
  return typeof value === "string" ? value.slice(0, MAX_ERROR_TEXT) : null;
}

export interface StudyRecorder {
  /** Extension factory to add to the session's resource loader. */
  readonly factory: StudyExtensionFactory;
  readonly collector: MainUsageEvidenceCollector;
  readonly observer: FileRequestObserver;
  readonly rawUsage: readonly RawUsageObservation[];
  readonly providerResponses: readonly ProviderResponseObservation[];
  readonly providerErrors: readonly ProviderErrorObservation[];
  readonly eventCensus: Readonly<Record<string, number>>;
  /** Top-level key names per raw event type: shape only, never values. */
  readonly eventShapes: Readonly<Record<string, readonly string[]>>;
  readonly hookErrors: readonly string[];
  readonly requestWindows: number;
  readonly limitExceeded: boolean;
  /** Serialised session events except cumulative message updates, which are counted. */
  readonly sessionEvents: readonly Json[];
  readonly sessionEventCounts: Readonly<Record<string, number>>;
  /** Connect to the session after opening it; returns the unsubscribe function. */
  attachSession(session: Pick<StudySession, "subscribe">): () => void;
}

export interface StudyRecorderOptions {
  readonly runId: string;
  readonly runDir: string;
  /** Finite logical request limit for this run. */
  readonly maxRequests: number;
  /** Called once if the session opens a request window beyond the limit. */
  readonly onLimitExceeded?: () => void;
}

/**
 * Read-only recording for one session. It reuses the main usage collector and
 * the request observer, and adds an independent raw usage tap so a disagreement
 * between them is reported instead of being resolved by either one alone.
 */
export function createStudyRecorder(options: StudyRecorderOptions): StudyRecorder {
  if (!Number.isInteger(options.maxRequests) || options.maxRequests < 1)
    throw new StudyRefusalError("maxRequests must be a positive integer");
  const collector = createMainUsageEvidenceCollector();
  const observer = createRequestObserver({
    outPath: join(options.runDir, "actual-requests.ndjson"),
  });
  const rawUsage: RawUsageObservation[] = [];
  const providerResponses: ProviderResponseObservation[] = [];
  const providerErrors: ProviderErrorObservation[] = [];
  const eventCensus: Record<string, number> = {};
  const eventShapes: Record<string, string[]> = {};
  const hookErrors: string[] = [];
  const sessionEvents: Json[] = [];
  const sessionEventCounts: Record<string, number> = {};
  let requestWindows = 0;
  let limitExceeded = false;

  const guarded = (name: string, body: () => void): void => {
    try {
      body();
    } catch (error) {
      hookErrors.push(`${name}: ${errorText(error)}`);
    }
  };

  const tapStreamEvent = (event: Record<string, unknown>): void => {
    const data = isRecord(event["data"]) ? event["data"] : null;
    const eventType = data !== null && typeof data["type"] === "string" ? data["type"] : null;
    const census = eventType ?? "(untyped)";
    eventCensus[census] = (eventCensus[census] ?? 0) + 1;
    if (data === null) return;
    eventShapes[census] = [
      ...new Set([...(eventShapes[census] ?? []), ...Object.keys(data)]),
    ].sort();
    const response = isRecord(data["response"]) ? data["response"] : null;
    if (eventType === "error" || eventType === "response.failed") {
      const nested = isRecord(data["error"])
        ? data["error"]
        : isRecord(response?.["error"])
          ? response["error"]
          : null;
      providerErrors.push({
        requestSequence: requestWindows,
        eventType,
        code: boundedText(data["code"]) ?? boundedText(nested?.["code"]),
        message: boundedText(data["message"]) ?? boundedText(nested?.["message"]),
      });
    }
    const choices = Array.isArray(data["choices"]) ? data["choices"] : [];
    const firstChoice = isRecord(choices[0]) ? choices[0] : null;
    let usagePath: RawUsageObservation["usagePath"] | null = null;
    let usage: unknown;
    if (isRecord(response?.["usage"])) {
      usagePath = "response.usage";
      usage = response["usage"];
    } else if (isRecord(data["usage"])) {
      usagePath = "usage";
      usage = data["usage"];
    } else if (isRecord(firstChoice?.["usage"])) {
      usagePath = "choices[0].usage";
      usage = firstChoice["usage"];
    }
    if (usagePath === null) return;
    const responseMeta: Record<string, Json> = {};
    if (response !== null) {
      for (const key of RESPONSE_META_KEYS) {
        const value = response[key];
        if (
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean" ||
          value === null
        )
          responseMeta[key] = value;
      }
    }
    const id =
      typeof response?.["id"] === "string"
        ? response["id"]
        : typeof data["id"] === "string"
          ? data["id"]
          : null;
    rawUsage.push({
      sequence: rawUsage.length + 1,
      requestSequence: requestWindows,
      receivedAt: new Date().toISOString(),
      provider: String(event["provider"]),
      api: String(event["api"]),
      model: String(event["model"]),
      eventType,
      responseId: id,
      usagePath,
      usage: projectRawUsage(usage),
      responseMeta,
    });
  };

  const factory = (pi: {
    on(event: string, handler: (event: Record<string, unknown>) => unknown): unknown;
  }): void => {
    wireMainUsageEvidence(pi as never, collector);
    pi.on("before_provider_request", async (event) => {
      requestWindows += 1;
      guarded("before_provider_request", () => {
        captureProviderPayload(
          observer,
          event["payload"],
          `${options.runId}:request-${requestWindows}`,
        );
      });
      if (requestWindows > options.maxRequests && !limitExceeded) {
        limitExceeded = true;
        guarded("onLimitExceeded", () => options.onLimitExceeded?.());
      }
      // Durable before the model is reached, so a crash cannot lose the request.
      try {
        await observer.flush();
      } catch (error) {
        hookErrors.push(`observer.flush: ${errorText(error)}`);
      }
      return undefined; // read-only: never a payload replacement
    });
    pi.on("provider_stream_event", (event) => {
      guarded("provider_stream_event", () => tapStreamEvent(event));
      return undefined;
    });
    pi.on("after_provider_response", (event) => {
      guarded("after_provider_response", () => {
        const headers = projectResponseHeaders(event["headers"]);
        providerResponses.push({
          sequence: providerResponses.length + 1,
          requestSequence: requestWindows,
          receivedAt: new Date().toISOString(),
          status: typeof event["status"] === "number" ? event["status"] : null,
          headerNames: headers.names,
          visibleHeaders: headers.visible,
        });
      });
      return undefined;
    });
  };

  return {
    factory: factory as unknown as StudyExtensionFactory,
    collector,
    observer,
    rawUsage,
    providerResponses,
    providerErrors,
    eventCensus,
    eventShapes,
    hookErrors,
    sessionEvents,
    sessionEventCounts,
    get requestWindows() {
      return requestWindows;
    },
    get limitExceeded() {
      return limitExceeded;
    },
    attachSession(session) {
      return session.subscribe((event) => {
        guarded("session.subscribe", () => {
          const type =
            isRecord(event) && typeof event["type"] === "string" ? event["type"] : "(untyped)";
          sessionEventCounts[type] = (sessionEventCounts[type] ?? 0) + 1;
          if (type !== "message_update")
            sessionEvents.push(JSON.parse(JSON.stringify(event)) as Json);
        });
      });
    },
  };
}

// ── Session ─────────────────────────────────────────────────────────────────

export type StudyTransport = "sse" | "auto" | "websocket" | "websocket-cached";

export interface StudySessionOptions {
  readonly host: StudyHostModule;
  readonly workspace: string;
  readonly model: { readonly provider: string; readonly id: string };
  readonly thinkingLevel: string;
  readonly systemPrompt: string;
  readonly transport: StudyTransport;
  readonly requestTimeoutMs: number;
  /** Tool names to activate. Empty means no tools of any kind. */
  readonly tools: readonly string[];
  readonly extensionFactories: readonly StudyExtensionFactory[];
  /** Optional study-local model declarations; credentials still resolve normally. */
  readonly modelsPath?: string;
}

export interface StudySessionHandle {
  readonly session: StudySession;
  readonly agentDir: string;
  /** Exact settings given to the host. Nothing is read from or written to settings files. */
  readonly settings: Readonly<Record<string, Json>>;
  readonly resolvedModel: Json;
  readonly activeTools: readonly string[];
  dispose(): void;
}

/**
 * Opens one real AgentSession from the selected host with no discovered
 * extensions, skills, templates, themes or context files, in-memory session and
 * settings, and the host's normal credential resolution from its own agent
 * directory. Automatic and provider retries, compaction and cache warming are
 * off, so one prompt without tool calls is one logical request. A missing model
 * refuses; there is no fallback.
 */
export async function openStudySession(options: StudySessionOptions): Promise<StudySessionHandle> {
  const { host } = options;
  const agentDir = host.getAgentDir();
  const settings = {
    compaction: { enabled: false },
    retry: { enabled: false, provider: { maxRetries: 0, timeoutMs: options.requestTimeoutMs } },
    transport: options.transport,
    cacheWarming: "off",
  } as const;
  const resourceLoader = new host.DefaultResourceLoader({
    cwd: options.workspace,
    agentDir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: options.systemPrompt,
    extensionFactories: [...options.extensionFactories],
  });
  await resourceLoader.reload();
  const loadErrors = resourceLoader.getExtensions().errors;
  if (loadErrors.length > 0)
    throw new StudyRefusalError(`Extension load errors: ${JSON.stringify(loadErrors)}`);
  const modelRuntime = await host.ModelRuntime.create(options.modelsPath ? { modelsPath: options.modelsPath } : undefined);
  const known = modelRuntime.getModel(options.model.provider, options.model.id);
  const { session } = await host.createAgentSession({
    cwd: options.workspace,
    agentDir,
    thinkingLevel: options.thinkingLevel,
    modelRuntime,
    resourceLoader,
    ...(known !== undefined ? { model: known } : {}),
    ...(options.tools.length === 0
      ? { noTools: "all" }
      // An exact tools list is also an allowlist and would exclude registered
      // script-only fetch. Modifiers select declarations without hiding it.
      : { noTools: "builtin", tools: options.tools.map((name) => `+${name}`) }),
    sessionManager: host.SessionManager.inMemory(options.workspace),
    settingsManager: host.SettingsManager.inMemory(settings),
  });
  try {
    await session.bindExtensions({});
    // A provider registered by an extension exists only once it is bound.
    const model = known ?? modelRuntime.getModel(options.model.provider, options.model.id);
    if (model === undefined)
      throw new StudyRefusalError(
        `Model ${options.model.provider}/${options.model.id} is not in the host registry`,
      );
    if (known === undefined) await session.setModel(model);
    const selected = session.model;
    if (selected?.provider !== options.model.provider || selected.id !== options.model.id)
      throw new StudyRefusalError(
        `Session selected ${selected?.provider}/${selected?.id}, not ${options.model.provider}/${options.model.id}`,
      );
    const activeTools = session.getActiveToolNames();
    if (options.tools.length === 0 && activeTools.length > 0)
      throw new StudyRefusalError(`A no-tool session has active tools: ${activeTools.join(", ")}`);
    return {
      session,
      agentDir,
      settings: asJson(settings) as Record<string, Json>,
      resolvedModel: asJson({
        provider: selected.provider,
        id: selected.id,
        api: selected.api ?? null,
        baseUrl: selected.baseUrl ?? null,
      }),
      activeTools,
      dispose: () => session.dispose(),
    };
  } catch (error) {
    session.dispose();
    throw error;
  }
}

export type PromptSettlement =
  "resolved" | "rejected" | "timed-out" | "cancelled" | "abort-unsettled";

export interface BoundedPromptResult {
  readonly settlement: PromptSettlement;
  readonly error: string | null;
  readonly startedAt: string;
  readonly settledAt: string;
  readonly durationMs: number;
}

/**
 * Runs one prompt with a finite deadline. On expiry or cancellation it aborts
 * the session and waits a finite grace period, reporting honestly if the host
 * did not settle. It never retries.
 */
export async function runBoundedPrompt(
  session: Pick<StudySession, "prompt" | "abort">,
  prompt: string,
  options: {
    readonly timeoutMs: number;
    readonly abortGraceMs: number;
    readonly signal?: AbortSignal;
  },
): Promise<BoundedPromptResult> {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)
    throw new StudyRefusalError("A finite positive prompt timeout is required");
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  type Stop = "timed-out" | "cancelled";
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  let removeAbort = (): void => {};
  const stop = new Promise<Stop>((resolve) => {
    stopTimer = setTimeout(() => resolve("timed-out"), options.timeoutMs);
    if (options.signal?.aborted) resolve("cancelled");
    else if (options.signal) {
      const listener = (): void => resolve("cancelled");
      options.signal.addEventListener("abort", listener, { once: true });
      removeAbort = () => options.signal?.removeEventListener("abort", listener);
    }
  });
  const running = session.prompt(prompt).then(
    () => ({ kind: "resolved" as const, error: null }),
    (error: unknown) => ({ kind: "rejected" as const, error: errorText(error) }),
  );
  const finish = (settlement: PromptSettlement, error: string | null): BoundedPromptResult => {
    const settledMs = Date.now();
    return {
      settlement,
      error,
      startedAt,
      settledAt: new Date(settledMs).toISOString(),
      durationMs: settledMs - startedMs,
    };
  };
  try {
    const first = await Promise.race([running, stop]);
    if (typeof first !== "string") return finish(first.kind, first.error);
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const grace = new Promise<"grace-expired">((resolve) => {
      graceTimer = setTimeout(() => resolve("grace-expired"), options.abortGraceMs);
    });
    const abortOutcome = session.abort().then(
      () => null,
      (error: unknown) => errorText(error),
    );
    const settled = await Promise.race([Promise.all([running, abortOutcome]), grace]);
    clearTimeout(graceTimer);
    if (settled === "grace-expired")
      return finish(
        "abort-unsettled",
        `The host did not settle within ${options.abortGraceMs} ms of abort`,
      );
    const [promptOutcome, abortError] = settled;
    return finish(first, promptOutcome.error ?? abortError);
  } finally {
    clearTimeout(stopTimer);
    removeAbort();
  }
}

// ── Assessment ──────────────────────────────────────────────────────────────

/**
 * Independent reading of a raw usage object. It shares no code with the
 * collector's projection, because the comparison between the two is the point.
 */
export function wireFieldsFromRawUsage(usage: Json): WireUsageFields {
  const object = isRecord(usage) ? usage : {};
  const inputDetails = isRecord(object["input_tokens_details"])
    ? object["input_tokens_details"]
    : isRecord(object["prompt_tokens_details"])
      ? object["prompt_tokens_details"]
      : {};
  const outputDetails = isRecord(object["output_tokens_details"])
    ? object["output_tokens_details"]
    : isRecord(object["completion_tokens_details"])
      ? object["completion_tokens_details"]
      : {};
  const count = (...values: unknown[]): number | null => {
    for (const value of values)
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
    return null;
  };
  return {
    inputTokens: count(object["input_tokens"], object["prompt_tokens"]),
    cachedTokens: count(inputDetails["cached_tokens"]),
    cacheWriteTokens: count(inputDetails["cache_write_tokens"]),
    outputTokens: count(object["output_tokens"], object["completion_tokens"]),
    reasoningTokens: count(outputDetails["reasoning_tokens"]),
    totalTokens: count(object["total_tokens"]),
  };
}

const FIELD_NAMES = [
  "inputTokens",
  "cachedTokens",
  "cacheWriteTokens",
  "outputTokens",
  "reasoningTokens",
  "totalTokens",
] as const;

export interface MessageAssessment {
  readonly messageSha256: string;
  readonly responseId: string | null;
  readonly stopReason: string | null;
  readonly errorMessage: string | null;
  readonly rawEventType: string | null;
  readonly rawLeafPaths: readonly string[];
  /** Per-field wire value; null is absent on the wire and never means zero. */
  readonly wireFields: WireUsageFields | null;
  readonly fieldsAbsentOnWire: readonly string[];
  /** Canonical SDK values that have no wire field behind them. */
  readonly sdkPlaceholderZeros: readonly string[];
  readonly collector: {
    readonly usageObserved: boolean | null;
    readonly correlation: string;
    readonly ambiguous: boolean;
  } | null;
  readonly parsedTokens: TokenObservation | null;
  readonly uncachedInputEstablished: boolean;
}

export interface RunAssessment {
  readonly requestWindows: number;
  readonly requestLimit: number;
  readonly actualRequestCaptures: number;
  readonly providerResponses: number;
  readonly observerComplete: boolean;
  readonly assistantMessages: number;
  readonly messages: readonly MessageAssessment[];
  readonly collectorDiagnostics: Json;
  /** Evidence defects: anything here means the saved record is not fully consistent. */
  readonly problems: readonly string[];
  readonly evidenceConsistent: boolean;
}

/** Message values from the canonical usage object, for comparison with the wire. */
function canonicalUsage(message: Record<string, unknown>): Record<string, number> {
  const usage = isRecord(message["usage"]) ? message["usage"] : {};
  const out: Record<string, number> = {};
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "reasoning", "totalTokens"]) {
    const value = usage[key];
    if (typeof value === "number") out[key] = value;
  }
  return out;
}

/**
 * Pure correlation of the actual requests, raw usage, collector records, parser
 * output and canonical messages. A missing field is reported as missing. A
 * disagreement is a named problem; nothing is reconciled by choosing a source.
 */
export function assessRun(input: {
  readonly requestLimit: number;
  readonly requestWindows: number;
  readonly limitExceeded: boolean;
  readonly observerCaptured: number;
  readonly observerComplete: boolean;
  readonly providerResponses: number;
  readonly rawUsage: readonly RawUsageObservation[];
  readonly records: readonly MainUsageEvidenceV2Record[];
  readonly collectorDiagnostics: Json;
  readonly sessionEvents: readonly Json[];
  readonly parsed: ParsedUsage;
  readonly hookErrors: readonly string[];
}): RunAssessment {
  const problems: string[] = input.hookErrors.map((error) => `hook-error:${error}`);
  if (input.requestWindows === 0) problems.push("no-actual-request");
  if (input.limitExceeded || input.requestWindows > input.requestLimit)
    problems.push(`request-limit-exceeded:${input.requestWindows}>${input.requestLimit}`);
  if (input.observerCaptured !== input.requestWindows)
    problems.push(`request-capture-count:${input.observerCaptured}!=${input.requestWindows}`);
  if (!input.observerComplete) problems.push("request-observer-not-flushed");

  const assistantEvents = input.sessionEvents.flatMap((event) => {
    if (!isRecord(event) || event["type"] !== "message_end" || !isRecord(event["message"]))
      return [];
    return event["message"]["role"] === "assistant" ? [event["message"]] : [];
  });
  if (assistantEvents.length !== input.requestWindows)
    problems.push(
      `assistant-message-count:${assistantEvents.length}!=${input.requestWindows}-requests`,
    );
  if (input.parsed.assistantMessages.length !== assistantEvents.length)
    problems.push(
      `parser-message-count:${input.parsed.assistantMessages.length}!=${assistantEvents.length}`,
    );

  const usedRaw = new Set<RawUsageObservation>();
  const messages = assistantEvents.map((message, index): MessageAssessment => {
    const hash = sha256Canonical(asJson(message));
    const responseId = typeof message["responseId"] === "string" ? message["responseId"] : null;
    const label = responseId ?? `message-${index + 1}`;
    if (responseId === null) problems.push(`message-without-response-id:${label}`);
    const stopReason = typeof message["stopReason"] === "string" ? message["stopReason"] : null;
    const record = input.records.find((item) => item.messageSha256 === hash) ?? null;
    if (record === null) problems.push(`no-collector-record:${label}`);
    // The last usage object for an id is the cumulative final snapshot.
    const matching = input.rawUsage.filter(
      (item) => responseId !== null && item.responseId === responseId,
    );
    for (const item of matching) usedRaw.add(item);
    const raw = matching.at(-1) ?? null;
    const wireFields = raw === null ? null : wireFieldsFromRawUsage(raw.usage);
    const absent =
      wireFields === null
        ? [...FIELD_NAMES]
        : FIELD_NAMES.filter((name) => wireFields[name] === null);
    if (raw === null && stopReason !== "error" && stopReason !== "aborted")
      problems.push(`no-raw-usage-for-completed-response:${label}`);
    if (raw !== null && record !== null) {
      if (record.usageObserved !== true) problems.push(`collector-missed-raw-usage:${label}`);
      else if (record.fields !== null)
        for (const name of FIELD_NAMES)
          if (record.fields[name] !== wireFields?.[name])
            problems.push(`collector-field-mismatch:${name}:${label}`);
    }
    const parsed = input.parsed.assistantMessages[index]?.usage ?? null;
    if (raw !== null && parsed === null) problems.push(`parser-lost-raw-usage:${label}`);

    const canonical = canonicalUsage(message);
    const placeholders: string[] = [];
    if (wireFields !== null) {
      const pairs: readonly (readonly [string, number | null])[] = [
        ["output", wireFields.outputTokens],
        ["cacheRead", wireFields.cachedTokens],
        ["cacheWrite", wireFields.cacheWriteTokens],
        ["reasoning", wireFields.reasoningTokens],
        ["totalTokens", wireFields.totalTokens],
      ];
      for (const [name, wire] of pairs) {
        const value = canonical[name];
        if (wire === null) {
          if (value === 0) placeholders.push(name);
        } else if (value !== wire) {
          problems.push(
            `canonical-mismatch:${name}:wire=${wire}:canonical=${String(value)}:${label}`,
          );
        }
      }
      if (wireFields.inputTokens !== null) {
        const expected = Math.max(
          0,
          wireFields.inputTokens -
            (wireFields.cachedTokens ?? 0) -
            (wireFields.cacheWriteTokens ?? 0),
        );
        if (canonical["input"] !== expected)
          problems.push(
            `canonical-mismatch:input:expected=${expected}:canonical=${String(canonical["input"])}:${label}`,
          );
      } else if (canonical["input"] === 0) placeholders.push("input");
    }
    return {
      messageSha256: hash,
      responseId,
      stopReason,
      errorMessage:
        typeof message["errorMessage"] === "string"
          ? message["errorMessage"].slice(0, MAX_ERROR_TEXT)
          : null,
      rawEventType: raw?.eventType ?? null,
      rawLeafPaths: raw === null ? [] : rawUsageLeafPaths(raw.usage).sort(),
      wireFields,
      fieldsAbsentOnWire: absent,
      sdkPlaceholderZeros: placeholders,
      collector:
        record === null
          ? null
          : {
              usageObserved: record.usageObserved,
              correlation: record.correlation,
              ambiguous: record.ambiguous,
            },
      parsedTokens: parsed,
      uncachedInputEstablished: parsed?.inputUncached !== undefined,
    };
  });
  for (const item of input.rawUsage)
    if (!usedRaw.has(item))
      problems.push(`raw-usage-without-message:${item.responseId ?? `sequence-${item.sequence}`}`);
  return {
    requestWindows: input.requestWindows,
    requestLimit: input.requestLimit,
    actualRequestCaptures: input.observerCaptured,
    providerResponses: input.providerResponses,
    observerComplete: input.observerComplete,
    assistantMessages: assistantEvents.length,
    messages,
    collectorDiagnostics: input.collectorDiagnostics,
    problems,
    evidenceConsistent: problems.length === 0,
  };
}

// ── Evidence ────────────────────────────────────────────────────────────────

/** Writes one new file, durably. An existing file is refused, never replaced. */
export async function writeNewFile(path: string, text: string): Promise<void> {
  const handle = await open(path, "wx");
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export const writeNewJson = (path: string, value: unknown): Promise<void> =>
  writeNewFile(path, `${JSON.stringify(value, null, 2)}\n`);

export const writeNewNdjson = (path: string, values: readonly unknown[]): Promise<void> =>
  writeNewFile(path, values.map((value) => `${canonicalJson(value)}\n`).join(""));

/**
 * Saves a settled recorder's observations and returns its assessment. The
 * canonical messages and collector records are saved unchanged, so the hash
 * correlation can be recomputed from these files alone.
 */
export async function saveRunObservations(options: {
  readonly runDir: string;
  readonly recorder: StudyRecorder;
  readonly requestLimit: number;
}): Promise<RunAssessment> {
  const { recorder, runDir } = options;
  await recorder.observer.flush();
  const records = recorder.collector.records;
  const recordEvents = records.map(mainUsageEvidenceV2Json);
  const diagnostics = asJson({ ...recorder.collector.diagnostics });
  const parsed = parseUsageEvents([...recorder.sessionEvents, ...recordEvents], "json");
  const messageEnds = recorder.sessionEvents.flatMap((event) =>
    isRecord(event) && event["type"] === "message_end" ? [event["message"]] : [],
  );
  await writeNewNdjson(join(runDir, "canonical-messages.ndjson"), messageEnds);
  await writeNewNdjson(join(runDir, "session-events.ndjson"), recorder.sessionEvents);
  await writeNewJson(join(runDir, "session-event-counts.json"), recorder.sessionEventCounts);
  await writeNewNdjson(join(runDir, "main-usage-evidence.ndjson"), recordEvents);
  await writeNewJson(join(runDir, "main-usage-diagnostics.json"), diagnostics);
  await writeNewNdjson(join(runDir, "raw-usage.ndjson"), recorder.rawUsage);
  await writeNewNdjson(join(runDir, "provider-responses.ndjson"), recorder.providerResponses);
  await writeNewNdjson(join(runDir, "provider-errors.ndjson"), recorder.providerErrors);
  await writeNewJson(join(runDir, "stream-event-census.json"), recorder.eventCensus);
  await writeNewJson(join(runDir, "stream-event-shapes.json"), recorder.eventShapes);
  await writeNewJson(join(runDir, "parsed-usage.json"), parsed);
  const assessment = assessRun({
    requestLimit: options.requestLimit,
    requestWindows: recorder.requestWindows,
    limitExceeded: recorder.limitExceeded,
    observerCaptured: recorder.observer.captured,
    observerComplete: recorder.observer.complete,
    providerResponses: recorder.providerResponses.length,
    rawUsage: recorder.rawUsage,
    records,
    collectorDiagnostics: diagnostics,
    sessionEvents: recorder.sessionEvents,
    parsed,
    hookErrors: recorder.hookErrors,
  });
  await writeNewJson(join(runDir, "assessment.json"), assessment);
  return assessment;
}

async function runFiles(root: string, prefix = ""): Promise<string[]> {
  const names: string[] = [];
  for (const entry of (await readdir(join(root, prefix), {withFileTypes:true})).sort((a,b) => a.name.localeCompare(b.name))) {
    const name = join(prefix, entry.name);
    if (entry.isDirectory()) names.push(...await runFiles(root, name));
    else if (entry.isFile()) names.push(name);
    else throw new StudyRefusalError("Run evidence must contain regular files, not links");
  }
  return names;
}

/** Final integrity list: sha256 and size of every retained file in the run. */
export async function writeRunManifest(
  runDir: string,
): Promise<{ readonly path: string; readonly sha256: string }> {
  const names = (await runFiles(runDir)).filter((name) => name !== "manifest.json");
  const files = [];
  for (const name of names) {
    const bytes = await readFile(join(runDir, name));
    files.push({ name, bytes: bytes.byteLength, sha256: sha256Bytes(bytes) });
  }
  const text = `${JSON.stringify({ files }, null, 2)}\n`;
  const path = join(runDir, "manifest.json");
  await writeNewFile(path, text);
  return { path, sha256: sha256Bytes(new TextEncoder().encode(text)) };
}

// ── Repository identity and credential care ─────────────────────────────────

export interface RepositoryIdentity {
  readonly commit: string;
  readonly dirty: boolean;
  readonly dirtyPaths: readonly string[];
  readonly lockfileSha256: string | null;
  /** Hashes of the measuring source, which an uncommitted tree cannot prove by commit. */
  readonly sourceSha256: Readonly<Record<string, string | null>>;
}

async function fileSha256(path: string): Promise<string | null> {
  try {
    return sha256Bytes(await readFile(path));
  } catch {
    return null;
  }
}

export async function readRepositoryIdentity(
  repoRoot: string,
  sources: readonly string[],
): Promise<RepositoryIdentity> {
  const git = async (...args: string[]): Promise<string> =>
    (await execFileAsync("git", args, { cwd: repoRoot })).stdout;
  const dirtyPaths = (await git("status", "--porcelain=v1"))
    .split("\n")
    .filter((line) => line !== "");
  const sourceSha256: Record<string, string | null> = {};
  for (const source of sources) sourceSha256[source] = await fileSha256(join(repoRoot, source));
  return {
    commit: (await git("rev-parse", "HEAD")).trim(),
    dirty: dirtyPaths.length > 0,
    dirtyPaths,
    lockfileSha256: await fileSha256(join(repoRoot, "package-lock.json")),
    sourceSha256,
  };
}

/**
 * Dirty-state refusal from the Research Plan's run metadata. A declared reason
 * is the only way past it; the run records that reason and the dirty paths.
 */
export function assertRepositoryAdmissible(
  identity: RepositoryIdentity,
  allowDirtyReason: string | null,
): void {
  if (identity.dirty && (allowDirtyReason === null || allowDirtyReason.trim() === ""))
    throw new StudyRefusalError(
      `The working tree has ${identity.dirtyPaths.length} uncommitted path(s); commit them or declare a reason`,
    );
}

export interface CredentialFileState {
  /** Held in memory only and never saved. */
  readonly digest: string | null;
  readonly providerEntryType: string | null;
  readonly values: readonly string[];
}

/** Reads what credential care needs. Only the entry type may reach a report. */
export async function readCredentialFileState(
  authPath: string,
  provider: string,
): Promise<CredentialFileState> {
  let bytes: Buffer;
  try {
    bytes = await readFile(authPath);
  } catch {
    return { digest: null, providerEntryType: null, values: [] };
  }
  const values: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      if (value.length >= 20) values.push(value);
    } else if (Array.isArray(value)) value.forEach(walk);
    else if (isRecord(value)) Object.values(value).forEach(walk);
  };
  let providerEntryType: string | null = null;
  try {
    const parsed: unknown = JSON.parse(bytes.toString("utf8"));
    walk(parsed);
    const entry = isRecord(parsed) ? parsed[provider] : undefined;
    if (isRecord(entry) && typeof entry["type"] === "string") providerEntryType = entry["type"];
  } catch {
    // An unparseable file yields no values; the host reports its own failure.
  }
  return { digest: sha256Bytes(bytes), providerEntryType, values };
}

/** Counts credential values or bearer-token shapes in retained files; reports no value. */
export async function scanRunForCredentials(
  runDir: string,
  values: readonly string[],
): Promise<{ readonly filesScanned: number; readonly matchedFiles: readonly string[] }> {
  const matchedFiles: string[] = [];
  const names = await runFiles(runDir);
  for (const name of names) {
    const text = await readFile(join(runDir, name), "utf8");
    if (
      values.some((value) => text.includes(value)) ||
      /\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\./.test(text)
    )
      matchedFiles.push(name);
  }
  return { filesScanned: names.length, matchedFiles };
}
