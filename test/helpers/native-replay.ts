// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// M3 native transport-replay qualification harness (C30/T30).
//
// A real `Pi` AgentSession runs in-process with the built-in Codemode
// extension, a read-only before_provider_request observer and the native
// extension from the immutable createNativeExtension() factory. The main
// model uses a credential-free in-process HTTP fixture under the installed
// OpenAI-completions serializer, so request serialisation, observer and usage
// events are real. Recording sends pipeline stages through the real host
// registry to a loopback stage fixture and freezes complete per-attempt
// fixtures; replay injects only `registryStreamSimple` and `pageTransport` in
// `mode: "transport-replay"`, below the real scoped policy, ledger, citation
// hooks and FetchClient. Binding condition N1 (verbatim):
//
//   a transport-replay implementation must never invoke `options.fetch` or
//   any network primitive. It must replay citations only through recorded
//   `onProviderStreamEvent` chunks, or through a declared non-network tee
//   seam if floor-host replay is ever required.
//
// Replay blocks run under a process-wide guard that forbids every network
// primitive during replay, including main network. A fixture miss
// aborts the session and invalidates the block; there is no live fallback.

import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire, syncBuiltinESMExports } from "node:module";
import childProcess from "node:child_process";
import dns from "node:dns";
import net from "node:net";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import ts from "typescript";
import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type {
  PageTransport,
  PageTransportRequest,
  PageTransportResponse,
} from "../../src/core/execution-contracts.js";
import type { RegistryStreamSimple } from "../../src/native-injection.js";
import { createNativeUsageCapture } from "../../src/native-usage.js";
import {
  CACHE_SUGGEST_PROMPT,
  COLLATION_SYSTEM_PROMPT,
  EXTRACTION_SYSTEM_PROMPT,
  SEARCH_SYSTEM_PROMPT,
} from "../../src/core/prompts.js";
import { asJson, canonicalJson, sha256Canonical } from "../../scripts/benchmarks/canonical.js";
import type {
  FetchFixtureRequest,
  FixtureRecord,
  Json,
  ModelFixtureRequest,
  ModelRole,
} from "../../scripts/benchmarks/contracts.js";
import {
  createFixtureRecorder,
  createReplayStore,
  ReplayMissError,
  type BenchmarkReplayStore,
  type FixtureFile,
} from "../../scripts/benchmarks/replay-store.js";
import {
  createModelTransportReplay,
  createPageTransportReplay,
  modelFixtureRequest,
  type ModelNodeResolver,
  type PageNodeResolver,
} from "../../scripts/benchmarks/transport-replay.js";

export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const LOCAL_PEER_ROOT = join(REPO_ROOT, "node_modules/@earendil-works/pi-coding-agent");
/** Synthetic page bytes carry this marker; it must never reach a main request. */
export const RAW_SENTINEL = "RAW-PAGE-SENTINEL-7f3c9a";
export const FIXTURE_API_KEY = "fixture-not-a-credential";
export const MAX_RESPONSE_BYTES = 1_048_576;

// ── Host selection ──────────────────────────────────────────────────────────

export interface HostSelection {
  readonly root: string;
  readonly version: string;
  /** Explicit installed qualification host, or the repository's dev peer. Never inferred. */
  readonly kind: "explicit-installed" | "local-dev-peer";
}

/**
 * NATIVE_REPLAY_PI_HOST names an installed pi-coding-agent package root. When
 * it is set but unusable the harness fails instead of substituting the peer.
 */
export async function selectHost(): Promise<HostSelection> {
  const explicit = process.env.NATIVE_REPLAY_PI_HOST;
  const root = explicit || LOCAL_PEER_ROOT;
  let manifest: { name?: unknown; version?: unknown };
  try {
    manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  } catch (error) {
    throw new Error(
      `NATIVE_REPLAY_PI_HOST ${root} is not a readable package root: ${String(error)}`,
    );
  }
  if (manifest.name !== "@earendil-works/pi-coding-agent" || typeof manifest.version !== "string")
    throw new Error(`${root} is not @earendil-works/pi-coding-agent`);
  return {
    root,
    version: manifest.version,
    kind: explicit ? "explicit-installed" : "local-dev-peer",
  };
}

// ── Process isolation ───────────────────────────────────────────────────────

export interface Isolation {
  readonly root: string;
  readonly agentDir: string;
  readonly home: string;
  readonly tmp: string;
}

/**
 * Private HOME, agent directory and TMPDIR below the repository's encrypted
 * .tmp/. Must run before the host or native source is imported.
 */
export async function isolateProcess(prefix: string): Promise<Isolation> {
  await mkdir(join(REPO_ROOT, ".tmp"), { recursive: true });
  const root = await mkdtemp(join(REPO_ROOT, ".tmp", `native-replay-${prefix}-`));
  const agentDir = join(root, "agent");
  const home = join(root, "home");
  const tmp = join(root, "tmp");
  for (const dir of [agentDir, home, tmp]) await mkdir(dir, { recursive: true });
  for (const key of Object.keys(process.env))
    if (/(?:API_KEY|AUTH_TOKEN|OAUTH_TOKEN)$/.test(key)) delete process.env[key];
  Object.assign(process.env, {
    PI_CODING_AGENT_DIR: agentDir,
    HOME: home,
    TMPDIR: tmp,
    PI_OFFLINE: "1",
    PI_SKIP_VERSION_CHECK: "1",
    PI_TELEMETRY: "0",
  });
  return { root, agentDir, home, tmp };
}

// ── Network guard ───────────────────────────────────────────────────────────

export interface NetworkEvent {
  readonly phase: string;
  readonly primitive: "fetch" | "socket" | "spawn" | "wreq" | "dns";
  readonly target: string;
  readonly allowed: boolean;
}

export interface NetworkGuard {
  /** Ports reachable on loopback for capture only; replay permits no ports. */
  setPhase(phase: string, allowedPorts: readonly number[]): void;
  phase(): string;
  events(phase?: string): readonly NetworkEvent[];
  violations(phase?: string): readonly NetworkEvent[];
  restore(): void;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost", "::ffff:127.0.0.1"]);

/**
 * Process-wide guard over every JavaScript network primitive the pipeline or
 * host could reach: globalThis.fetch, TCP socket connects (undici, http,
 * provider SDKs), DNS, child-process spawns (the default page transport runs
 * an owned child) and every function of the cached wreq-js native binding.
 * A forbidden call is recorded and throws; it never reaches the network.
 */
export function installNetworkGuard(): NetworkGuard {
  const log: NetworkEvent[] = [];
  let phase = "setup";
  let allowed = new Set<number>();
  const note = (primitive: NetworkEvent["primitive"], target: string, ok: boolean) => {
    log.push({ phase, primitive, target, allowed: ok });
    if (!ok) throw new Error(`Network primitive forbidden in ${phase}: ${primitive} ${target}`);
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    note(
      "fetch",
      url.href,
      LOOPBACK.has(url.hostname.replace(/^\[|\]$/g, "")) && allowed.has(Number(url.port)),
    );
    return originalFetch(input, init);
  }) as typeof fetch;
  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
    // net.connect() passes its internal normalised [options, callback] array.
    const raw = args[0];
    const first = (Array.isArray(raw) ? raw[0] : raw) as
      { port?: number; host?: string; path?: string } | number | string;
    let target: string;
    let ok = false;
    if (typeof first === "object" && first !== null) {
      const options = first;
      target = options.path ?? `${options.host ?? "localhost"}:${options.port}`;
      ok =
        options.path === undefined &&
        LOOPBACK.has(options.host ?? "localhost") &&
        allowed.has(Number(options.port));
    } else {
      target = `${String(args[1] ?? "localhost")}:${String(first)}`;
      ok = LOOPBACK.has(String(args[1] ?? "localhost")) && allowed.has(Number(first));
    }
    note("socket", target, ok);
    return (originalConnect as (...a: unknown[]) => net.Socket).apply(this, args);
  } as typeof net.Socket.prototype.connect;
  const restorers: Array<() => void> = [];
  const patch = (
    target: Record<string, unknown>,
    name: string,
    primitive: NetworkEvent["primitive"],
  ) => {
    const original = target[name] as (...a: unknown[]) => unknown;
    target[name] = function (this: unknown, ...args: unknown[]) {
      // Module loading during setup may start a compiler service; nothing later may.
      note(primitive, `${name} ${String(args[0])}`, phase === "setup" && primitive !== "wreq");
      return original.apply(this, args);
    };
    restorers.push(() => {
      target[name] = original;
    });
  };
  for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"])
    patch(childProcess as unknown as Record<string, unknown>, name, "spawn");
  for (const name of ["lookup", "resolve", "resolve4", "resolve6"])
    patch(dns as unknown as Record<string, unknown>, name, "dns");
  syncBuiltinESMExports();
  // The same cached binding object serves every wreq-js importer.
  // Qualification platform is Linux x86-64 glibc; other platforms fail loudly below.
  const requireFromWreq = createRequire(join(REPO_ROOT, "node_modules/wreq-js/dist/wreq-js.js"));
  const bindingPath = join(
    REPO_ROOT,
    `node_modules/wreq-js/rust/wreq-js.${process.platform}-${process.arch}${process.platform === "linux" ? "-gnu" : ""}.node`,
  );
  try {
    const binding = requireFromWreq(bindingPath) as Record<string, unknown>;
    for (const name of Object.keys(binding))
      if (typeof binding[name] === "function") patch(binding, name, "wreq");
  } catch (error) {
    throw new Error(`wreq-js native binding could not be guarded: ${String(error)}`);
  }
  return {
    setPhase(next, ports) {
      phase = next;
      allowed = new Set(ports);
    },
    phase: () => phase,
    events: (only) => log.filter((event) => only === undefined || event.phase === only),
    violations: (only) =>
      log.filter((event) => !event.allowed && (only === undefined || event.phase === only)),
    restore() {
      globalThis.fetch = originalFetch;
      net.Socket.prototype.connect = originalConnect;
      for (const restore of restorers.reverse()) restore();
      syncBuiltinESMExports();
    },
  };
}

// ── Auth-resolution counters ────────────────────────────────────────────────

export interface AuthEvent {
  readonly phase: string;
  readonly method: string;
  readonly provider: string;
}

const AUTH_METHODS: Record<string, readonly string[]> = {
  ModelRegistry: ["getApiKeyAndHeaders", "getApiKeyForProvider", "getProviderAuth", "refresh"],
  ModelRuntime: [
    "getAuth",
    "prepareRequest",
    "refresh",
    "login",
    "enqueueCredentialOperation",
    "synchronizeCredentialState",
  ],
};

/**
 * Counts host credential resolution and refresh calls by guard phase and
 * provider. Observation only: the original method always runs.
 */
export function countAuthResolution(
  host: Record<string, unknown>,
  phase: () => string,
): { events(only?: string): readonly AuthEvent[]; restore(): void } {
  const log: AuthEvent[] = [];
  const restorers: Array<() => void> = [];
  for (const [className, methods] of Object.entries(AUTH_METHODS)) {
    const proto = (host[className] as { prototype?: Record<string, unknown> } | undefined)
      ?.prototype;
    if (!proto) continue;
    for (const method of methods) {
      const original = proto[method];
      if (typeof original !== "function") continue;
      proto[method] = function (this: unknown, ...args: unknown[]) {
        const first = args[0] as { provider?: unknown } | string | undefined;
        const provider =
          method === "refresh"
            ? `allowNetwork=${String((first as { allowNetwork?: unknown } | undefined)?.allowNetwork)}`
            : typeof first === "string"
              ? first
              : typeof first?.provider === "string"
                ? first.provider
                : "unknown";
        log.push({ phase: phase(), method: `${className}.${method}`, provider });
        return (original as (...a: unknown[]) => unknown).apply(this, args);
      };
      restorers.push(() => {
        proto[method] = original;
      });
    }
  }
  return {
    events: (only) => log.filter((event) => only === undefined || event.phase === only),
    restore: () => restorers.reverse().forEach((restore) => restore()),
  };
}

// ── Loopback fixtures ───────────────────────────────────────────────────────

async function listenLoopback(server: Server): Promise<number> {
  // Development range per host policy; loopback only.
  for (let attempt = 0; attempt < 200; attempt++) {
    const port = 20_000 + Math.floor(Math.random() * 10_001);
    try {
      server.listen(port, "127.0.0.1");
      await once(server, "listening");
      return port;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    }
  }
  throw new Error("No free loopback port in 20000-30000");
}

const sseChunk = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const chunk = (id: string, delta: unknown, finish: string | null = null, usage?: unknown) => ({
  id,
  object: "chat.completion.chunk",
  created: 0,
  model: "fixture",
  choices: [{ index: 0, delta, finish_reason: finish }],
  ...(usage ? { usage } : {}),
});

export interface WireUsage {
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
  readonly total_tokens: number;
  readonly prompt_tokens_details?: { readonly cached_tokens?: number };
}

/** One scripted main turn: tool calls or final text, with optional wire usage. */
export interface MainTurn {
  readonly toolCalls?: ReadonlyArray<{
    readonly name: string;
    readonly args: Record<string, unknown>;
  }>;
  readonly text?: string;
  /** Omit to exercise missing main usage. */
  readonly usage?: WireUsage;
}

export const MAIN_PROVIDER = "fixture-inproc";
export const MAIN_API = "fixture-inproc-completions";
/** Never resolved or connected: the in-process fetch answers it without a socket. */
export const MAIN_BASE_URL = "http://main.fixture.invalid/v1";

export interface MainFixture {
  /** Extension factory registering the in-process main provider. */
  readonly factory: (pi: never) => void;
  /** Exact request bodies the installed serializer produced. */
  readonly rawBodies: string[];
  /** Calls to the injected in-process fetch (the declared main transport population). */
  readonly fetchCalls: () => number;
  /** Provider stream invocations whose options carried no injected fetch (must stay 0). */
  readonly unguardedStreams: () => number;
  setScript(turns: readonly MainTurn[]): void;
}

function mainSse(turn: MainTurn | undefined, id: string, callPrefix: string): string {
  const parts: string[] = [];
  if (!turn) {
    parts.push(
      sseChunk(chunk(id, { role: "assistant", content: "script exhausted" })),
      sseChunk(chunk(id, {}, "stop")),
    );
  } else if (turn.toolCalls?.length) {
    turn.toolCalls.forEach((call, index) =>
      parts.push(
        sseChunk(
          chunk(id, {
            role: "assistant",
            tool_calls: [
              {
                index,
                id: `${callPrefix}_${index}`,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.args) },
              },
            ],
          }),
        ),
      ),
    );
    parts.push(sseChunk(chunk(id, {}, "tool_calls", turn.usage)));
  } else {
    parts.push(
      sseChunk(chunk(id, { role: "assistant", content: turn.text ?? "" })),
      sseChunk(chunk(id, {}, "stop", turn.usage)),
    );
  }
  parts.push("data: [DONE]\n\n");
  return parts.join("");
}

/**
 * Credential-free scripted main with NO network transport. A provider is
 * registered whose streamSimple delegates to the selected host's own
 * installed `pi-ai/api/openai-completions` streamSimple (so request
 * serialisation, onPayload/before_provider_request, SSE parsing and usage
 * normalisation are the host's), passing an injected in-process `fetch` that
 * answers from the script. No globalThis.fetch, socket or DNS is used.
 */
export async function createMainFixture(hostRoot: string): Promise<MainFixture> {
  const completions = (await import(
    pathToFileURL(join(dirname(hostRoot), "pi-ai/dist/api/openai-completions.js")).href
  )) as {
    streamSimple: (model: Model<Api>, context: unknown, options?: SimpleStreamOptions) => unknown;
  };
  let turns: readonly MainTurn[] = [];
  let next = 0;
  let fetchCalls = 0;
  let unguarded = 0;
  const rawBodies: string[] = [];
  const inProcessFetch = (async (input: unknown, init?: { body?: unknown }) => {
    fetchCalls++;
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    if (!url.startsWith(MAIN_BASE_URL)) throw new Error(`main fixture received foreign URL ${url}`);
    const body =
      typeof init?.body === "string"
        ? init.body
        : await new Response(init?.body as BodyInit).text();
    rawBodies.push(body);
    const sse = mainSse(turns[next++], `main-${rawBodies.length}`, `call_${rawBodies.length}`);
    return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  const factory = (pi: { registerProvider: (name: string, config: unknown) => void }) => {
    pi.registerProvider(MAIN_PROVIDER, {
      baseUrl: MAIN_BASE_URL,
      apiKey: FIXTURE_API_KEY,
      api: MAIN_API,
      models: [{ ...modelEntry("main"), api: MAIN_API }],
      streamSimple: (model: Model<Api>, context: unknown, options?: SimpleStreamOptions) => {
        if (options?.fetch) unguarded++;
        return completions.streamSimple(
          { ...model, api: "openai-completions" } as Model<Api>,
          context,
          {
            ...options,
            fetch: inProcessFetch,
          },
        );
      },
    });
  };
  return {
    factory: factory as never,
    rawBodies,
    fetchCalls: () => fetchCalls,
    unguardedStreams: () => unguarded,
    setScript(script) {
      turns = script;
      next = 0;
      rawBodies.length = 0;
    },
  };
}

export type StageRole = ModelRole;
export interface StageReply {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly text?: string;
  readonly annotations?: readonly string[];
  readonly usage?: WireUsage;
  readonly errorBody?: string;
}
export type StageScript = (call: {
  readonly role: StageRole;
  readonly user: string;
  readonly n: number;
}) => StageReply;

export interface StageFixture {
  readonly port: number;
  readonly baseUrl: string;
  readonly requests: Array<{ role: StageRole; user: string }>;
  setScript(script: StageScript): void;
  close(): Promise<void>;
}

export const stageRoleOf = (systemPrompt: string): StageRole | null =>
  systemPrompt === SEARCH_SYSTEM_PROMPT
    ? "search"
    : systemPrompt === EXTRACTION_SYSTEM_PROMPT
      ? "extract"
      : systemPrompt === COLLATION_SYSTEM_PROMPT
        ? "collate"
        : systemPrompt === CACHE_SUGGEST_PROMPT
          ? "suggest"
          : null;

/** Loopback stage provider used only while recording; closed before replay. */
export async function startStageFixture(): Promise<StageFixture> {
  let script: StageScript = () => ({ text: "" });
  const requests: Array<{ role: StageRole; user: string }> = [];
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    for await (const part of req) body += part;
    const json = JSON.parse(body) as { messages: Array<{ role: string; content: unknown }> };
    const text = (content: unknown) =>
      typeof content === "string"
        ? content
        : (content as Array<{ text?: string }>).map((part) => part.text ?? "").join("");
    const system = text(
      json.messages.find((m) => m.role === "system" || m.role === "developer")?.content ?? "",
    );
    const user = text(json.messages.find((m) => m.role === "user")?.content ?? "");
    const role = stageRoleOf(system);
    if (!role) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "unscripted stage prompt" } }));
      return;
    }
    requests.push({ role, user });
    const reply = script({ role, user, n: requests.filter((r) => r.role === role).length });
    if (reply.status && reply.status >= 400) {
      res.writeHead(reply.status, { "content-type": "application/json", ...(reply.headers ?? {}) });
      res.end(
        reply.errorBody ?? JSON.stringify({ error: { message: `fixture status ${reply.status}` } }),
      );
      return;
    }
    const id = `stage-${requests.length}`;
    res.writeHead(200, { "content-type": "text/event-stream", ...(reply.headers ?? {}) });
    res.write(
      sseChunk(
        chunk(id, {
          role: "assistant",
          content: reply.text ?? "",
          ...(reply.annotations?.length
            ? {
                annotations: reply.annotations.map((url) => ({
                  type: "url_citation",
                  url_citation: { url, title: `Cited ${url}` },
                })),
              }
            : {}),
        }),
      ),
    );
    res.write(sseChunk(chunk(id, {}, "stop", reply.usage)));
    res.end("data: [DONE]\n\n");
  });
  const port = await listenLoopback(server);
  return {
    port,
    baseUrl: `http://127.0.0.1:${port}/stage/v1`,
    requests,
    setScript(next) {
      script = next;
      requests.length = 0;
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

// ── Agent configuration ─────────────────────────────────────────────────────

const modelEntry = (id: string) => ({
  id,
  name: id,
  reasoning: false,
  input: ["text"],
  contextWindow: 200_000,
  maxTokens: 8_000,
  cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
});

export interface PipelineSettings {
  readonly [key: string]: unknown;
}

/** Private models.json/settings.json. Keys are fixture literals, not credentials. */
export async function writeAgentConfig(
  agentDir: string,
  stageBaseUrl: string,
  settings: PipelineSettings = {},
): Promise<void> {
  await writeFile(
    join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        "fixture-stage": {
          baseUrl: stageBaseUrl,
          api: "openai-completions",
          apiKey: FIXTURE_API_KEY,
          models: [modelEntry("search"), modelEntry("extract"), modelEntry("collate")],
        },
      },
    }),
  );
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      "pi-intelli-search": {
        searchModel: { provider: "fixture-stage", model: "search" },
        extractModel: { provider: "fixture-stage", model: "extract" },
        collateModel: { provider: "fixture-stage", model: "collate" },
        defaultUrls: 3,
        maxUrls: 3,
        llmRetryAttempts: 2,
        retryBaseDelayMs: 10,
        retryMaxDelayMs: 40,
        searchRetryAttempts: 2,
        execution: { fetchMaxResponseBytes: MAX_RESPONSE_BYTES },
        ...settings,
      },
    }),
  );
}

// ── Synthetic pages ─────────────────────────────────────────────────────────

export interface SyntheticPage {
  readonly status: number;
  readonly html?: string;
  readonly markdown?: string;
}

export function syntheticPage(id: string, facts: string): SyntheticPage {
  return {
    status: 200,
    html: `<!doctype html><html><head><title>Fixture ${id}</title></head><body><nav>menu</nav><article><h1>Fixture page ${id}</h1><p>PAGE-MARKER:${id}</p><p>${facts}</p><p>${RAW_SENTINEL}:${id} raw body bytes that only the page carries.</p><pre><code>const ${id.toLowerCase()} = 1;</code></pre></article></body></html>`,
    markdown: `# Fixture page ${id}\n\nPAGE-MARKER:${id}\n\n${facts}\n\n${RAW_SENTINEL}:${id} raw body bytes that only the page carries.\n\n\`\`\`js\nconst ${id.toLowerCase()} = 1;\n\`\`\`\n`,
  };
}

// ── Fixture identity (content-derived, never scope-derived) ────────────────

const shortHash = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12);

/**
 * Node identity derives from exact request content: role from the exact
 * stage prompt, extraction pages from the synthetic page marker, others from
 * a hash of the exact user message. Identical requests share a node and are
 * distinguished only by occurrence, so repeated calls never collapse.
 */
export const contentModelResolver: ModelNodeResolver = (request) => {
  const role = stageRoleOf(request.systemPrompt);
  if (!role) return { ambiguous: true, detail: "unknown stage system prompt" };
  if (role === "extract") {
    const markers = [...request.userMessage.matchAll(/PAGE-MARKER:([A-Za-z0-9-]+)/g)].map(
      (m) => m[1],
    );
    const unique = [...new Set(markers)];
    if (unique.length !== 1)
      return { ambiguous: true, detail: `${unique.length} page markers in extraction input` };
    return { operationNode: `extract/${unique[0]}`, role };
  }
  return { operationNode: `${role}/${shortHash(request.userMessage)}`, role };
};

export const contentPageResolver: PageNodeResolver = (request) => {
  const variant = request.accept.includes("markdown") ? "markdown" : "html";
  return {
    operationNode: `${request.method === "HEAD" ? "probe" : "page"}/${variant}/${request.url}`,
  };
};

// ── Recording transports ────────────────────────────────────────────────────

const textOf = (message: AssistantMessage) =>
  message.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");

export interface Recording {
  readonly model: ReturnType<typeof createFixtureRecorder>;
  readonly fetch: ReturnType<typeof createFixtureRecorder>;
  readonly modelTransport: RegistryStreamSimple;
  readonly pageTransport: PageTransport;
  /** Stage requests that went to the real host registry while recording. */
  readonly registryCalls: () => number;
}

/**
 * Recording is NOT replay: stage calls go through the real host registry to
 * the loopback stage fixture so the host serialises, streams and normalises
 * them. Each actual attempt becomes one fixture occurrence with its complete
 * provider stream events (citations and wire usage), response metadata,
 * error text, usage and measured wall delay.
 */
export function createRecording(
  scenario: string,
  pages: ReadonlyMap<string, SyntheticPage>,
): Recording {
  const model = createFixtureRecorder({ boundary: "model", scenario });
  const fetchRecorder = createFixtureRecorder({ boundary: "fetch", scenario });
  let registryCalls = 0;
  const modelTransport: RegistryStreamSimple = async (registry, m, context, options) => {
    const withoutRole = await modelFixtureRequest(m, context, options);
    const resolution = contentModelResolver(withoutRole, m, context);
    if ("ambiguous" in resolution)
      throw new Error(`Recording cannot identify node: ${resolution.detail}`);
    const request = asJson({ ...withoutRole, role: resolution.role } satisfies ModelFixtureRequest);
    const events: Json[] = [];
    const usageCapture = createNativeUsageCapture();
    let providerResponse: { status: number; headers: Record<string, string> } | undefined;
    const streamOptions: SimpleStreamOptions = {
      ...options,
      onProviderStreamEvent: async (event, eventModel) => {
        events.push(structuredClone(event) as Json);
        usageCapture.chunk(event);
        await options?.onProviderStreamEvent?.(event, eventModel);
      },
      onResponse: async (response, responseModel) => {
        const headers: Record<string, string> = {};
        const retryAfter = response.headers["retry-after"];
        if (retryAfter !== undefined) headers["retry-after"] = retryAfter;
        providerResponse = { status: response.status, headers };
        await options?.onResponse?.(response, responseModel);
      },
    };
    registryCalls++;
    const started = performance.now();
    const message = await registry.streamSimple(m, context, streamOptions).result();
    const delayMs = Math.max(0, Math.round(performance.now() - started));
    const response = {
      text: message.stopReason === "error" ? "" : textOf(message),
      providerStreamEvents: events,
      ...(message.responseId ? { responseId: message.responseId } : {}),
      ...(providerResponse ? { providerResponse } : {}),
    };
    const observation = usageCapture.observation(message.usage);
    model.record(resolution.operationNode, request, {
      response: asJson(response),
      ...(message.stopReason === "error"
        ? { error: { kind: "provider-error", message: message.errorMessage ?? "unknown error" } }
        : {}),
      ...(observation ? { usage: observation } : {}),
      delayMs,
    });
    return message;
  };
  const pageTransport: PageTransport = async (url, request: PageTransportRequest) => {
    const fixtureRequest: FetchFixtureRequest = {
      url,
      method: request.method,
      accept: request.headers["accept"] ?? request.headers["Accept"] ?? "",
      browser: request.browser,
      proxyConfigured: request.proxy !== undefined,
      maxResponseBytes: MAX_RESPONSE_BYTES,
    };
    const resolution = contentPageResolver(fixtureRequest);
    if ("ambiguous" in resolution) throw new Error(resolution.detail);
    const page = pages.get(url);
    const markdown = fixtureRequest.accept.includes("markdown");
    const status = page?.status ?? 404;
    const body = status === 200 ? ((markdown ? page?.markdown : page?.html) ?? "") : "not found";
    const headers = {
      "content-type":
        status === 200
          ? markdown
            ? "text/markdown; charset=utf-8"
            : "text/html; charset=utf-8"
          : "text/plain",
    };
    fetchRecorder.record(resolution.operationNode, asJson(fixtureRequest), {
      response: asJson({
        status,
        headers,
        finalUrl: url,
        bodyText: request.method === "HEAD" ? "" : body,
      }),
      delayMs: 1,
    });
    const bytes = new TextEncoder().encode(request.method === "HEAD" ? "" : body);
    const response: PageTransportResponse = {
      status,
      url,
      headers: { get: (name) => (headers as Record<string, string>)[name.toLowerCase()] ?? null },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    };
    return response;
  };
  return {
    model,
    fetch: fetchRecorder,
    modelTransport,
    pageTransport,
    registryCalls: () => registryCalls,
  };
}

// ── Replay transports ───────────────────────────────────────────────────────

export interface ReplayBlock {
  readonly modelStore: BenchmarkReplayStore;
  readonly fetchStore: BenchmarkReplayStore;
  readonly modelTransport: RegistryStreamSimple;
  readonly pageTransport: PageTransport;
  /** Count of `options.fetch` invocations attempted through the replay seam (must stay 0). */
  readonly teeFetchCalls: () => number;
  /** Registry property reads through the replay seam (must stay 0). */
  readonly registryReads: () => number;
  /** Provider stream events delivered through the supplied hook. */
  readonly deliveredEvents: () => number;
  readonly missErrors: ReplayMissError[];
  onMiss(stop: () => void): void;
}

export function fixtureFiles(recording: Recording): { model: FixtureFile; fetch: FixtureFile } {
  return { model: recording.model.toFile(), fetch: recording.fetch.toFile() };
}

/**
 * Wraps the library replay transports with N1 tripwires: a registry proxy
 * that throws on any read and an `options.fetch` that throws and counts.
 * The first miss stops the session through the supplied callback.
 */
export function createReplayBlock(files: { model: FixtureFile; fetch: FixtureFile }): ReplayBlock {
  const modelStore = createReplayStore({
    fixtures: files.model.fixtures,
    scenario: files.model.scenario,
    bindings: files.model.bindings ?? [],
  });
  const fetchStore = createReplayStore({
    fixtures: files.fetch.fixtures,
    scenario: files.fetch.scenario,
    bindings: files.fetch.bindings ?? [],
  });
  const replayModel = createModelTransportReplay({
    store: modelStore,
    scenario: files.model.scenario,
    resolveNode: contentModelResolver,
  });
  const replayPage = createPageTransportReplay({
    store: fetchStore,
    scenario: files.fetch.scenario,
    resolveNode: contentPageResolver,
    maxResponseBytes: MAX_RESPONSE_BYTES,
  });
  let teeFetchCalls = 0;
  let registryReads = 0;
  let delivered = 0;
  const missErrors: ReplayMissError[] = [];
  let stop: () => void = () => {};
  const registryTripwire = new Proxy(
    {},
    {
      get() {
        registryReads++;
        throw new Error("transport replay dereferenced the live registry");
      },
    },
  ) as Parameters<RegistryStreamSimple>[0];
  const miss = (error: unknown) => {
    if (error instanceof ReplayMissError) {
      missErrors.push(error);
      stop();
    }
    return error;
  };
  const modelTransport: RegistryStreamSimple = async (
    _registry,
    model: Model<Api>,
    context: Context,
    options,
  ) => {
    const guarded: SimpleStreamOptions = {
      ...options,
      ...(options?.fetch
        ? {
            fetch: (async () => {
              teeFetchCalls++;
              throw new Error("N1: transport replay invoked options.fetch");
            }) as unknown as typeof fetch,
          }
        : {}),
      ...(options?.onProviderStreamEvent
        ? {
            onProviderStreamEvent: (event: unknown, eventModel: Model<Api>) => {
              delivered++;
              return options.onProviderStreamEvent!(event, eventModel);
            },
          }
        : {}),
    };
    try {
      return await replayModel(registryTripwire, model, context, guarded);
    } catch (error) {
      throw miss(error);
    }
  };
  const pageTransport: PageTransport = async (url, request) => {
    try {
      return await replayPage(url, request);
    } catch (error) {
      throw miss(error);
    }
  };
  return {
    modelStore,
    fetchStore,
    modelTransport,
    pageTransport,
    teeFetchCalls: () => teeFetchCalls,
    registryReads: () => registryReads,
    deliveredEvents: () => delivered,
    missErrors,
    onMiss(next) {
      stop = next;
    },
  };
}

// ── Loaders ─────────────────────────────────────────────────────────────────

type NativeModule = typeof import("../../src/index.js");

export interface LoadedNative {
  readonly kind: "source" | "compiled";
  readonly entry: string;
  readonly module: NativeModule;
  /** sha256 of every src/ file the loader compiled or imported, by relative path. */
  readonly sourceHashes: Readonly<Record<string, string>>;
}

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(path)));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) out.push(path);
  }
  return out.sort();
}

async function hashSources(): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const file of await sourceFiles(join(REPO_ROOT, "src")))
    hashes[relative(REPO_ROOT, file)] = createHash("sha256")
      .update(await readFile(file))
      .digest("hex");
  return hashes;
}

/** The tsx-imported source tree, as development and the unit suite load it. */
export async function loadSourceNative(): Promise<LoadedNative> {
  const entry = join(REPO_ROOT, "src/index.ts");
  return {
    kind: "source",
    entry,
    module: (await import(pathToFileURL(entry).href)) as NativeModule,
    sourceHashes: await hashSources(),
  };
}

/**
 * A private compiled tree: every src/ file transpiled with the repository's
 * compiler options into an owned .tmp directory (never dist/), beside a copy
 * of package.json so native identity resolves as it does from dist/. This is
 * isolated scratch, not the release build.
 */
export async function compileNative(
  outRoot: string,
): Promise<{ entry: string; sourceHashes: Record<string, string> }> {
  const sourceHashes = await hashSources();
  const config = ts.readConfigFile(join(REPO_ROOT, "tsconfig.json"), ts.sys.readFile).config as {
    compilerOptions?: Record<string, unknown>;
  };
  const options = ts.convertCompilerOptionsFromJson(
    config.compilerOptions ?? {},
    REPO_ROOT,
  ).options;
  for (const file of await sourceFiles(join(REPO_ROOT, "src"))) {
    const out = join(outRoot, relative(REPO_ROOT, file)).replace(/\.ts$/, ".js");
    await mkdir(dirname(out), { recursive: true });
    const { outputText, diagnostics } = ts.transpileModule(await readFile(file, "utf8"), {
      compilerOptions: {
        ...options,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        sourceMap: false,
        inlineSourceMap: false,
        declaration: false,
        noEmit: false,
      },
      fileName: file,
      reportDiagnostics: true,
    });
    if (diagnostics?.length)
      throw new Error(
        `transpile ${file}: ${diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("; ")}`,
      );
    await writeFile(out, outputText);
  }
  await cp(join(REPO_ROOT, "package.json"), join(outRoot, "package.json"));
  return { entry: join(outRoot, "src/index.js"), sourceHashes };
}

export async function loadCompiledNative(outRoot: string): Promise<LoadedNative> {
  const { entry, sourceHashes } = await compileNative(outRoot);
  return {
    kind: "compiled",
    entry,
    module: (await import(pathToFileURL(entry).href)) as NativeModule,
    sourceHashes,
  };
}

// ── Sessions ────────────────────────────────────────────────────────────────

// The host package is imported by absolute path; its types are the repository
// peer's, which share this SDK surface (Observed for 1.1.0 and 1.3.0).
type HostModule = typeof import("@earendil-works/pi-coding-agent");

export async function importHost(host: HostSelection): Promise<HostModule> {
  return (await import(pathToFileURL(join(host.root, "dist/index.js")).href)) as HostModule;
}

export interface ObserverCapture {
  readonly sequence: number;
  readonly payload: Json;
  readonly payloadSha256: string;
}

export interface SessionHandle {
  readonly session: Awaited<ReturnType<HostModule["createAgentSession"]>>["session"];
  readonly events: Json[];
  readonly captures: ObserverCapture[];
  /** Extension-level tool_execution_* events with parentToolCallId. */
  readonly toolEvents: Array<Record<string, unknown>>;
  dispose(): void;
}

export interface SessionOptions {
  readonly host: HostModule;
  readonly agentDir: string;
  readonly workspace: string;
  readonly main: MainFixture;
  readonly nativeFactory: ((pi: never) => void) | null;
  /** Extra extension files loaded through the host's own jiti loader. */
  readonly extensionPaths?: readonly string[];
  readonly codemode: "on" | "only" | "off";
  readonly extraFactories?: ReadonlyArray<(pi: never) => void>;
  readonly tools?: readonly string[];
  /**
   * Activate `tools` as `+name` modifiers with built-ins off. The SDK then
   * keeps no allowlist, so non-direct (script-only) tools stay registered and
   * callable without being declared. A plain `tools` list is both allowlist
   * and active set: naming a codemode-exposure tool there declares it.
   */
  readonly activateOnly?: boolean;
}

/**
 * One real AgentSession. The observer is read-only: it records a deep copy
 * of the actual provider payload and returns nothing.
 */
export async function openSession(options: SessionOptions): Promise<SessionHandle> {
  const { host } = options;
  const captures: ObserverCapture[] = [];
  const toolEvents: Array<Record<string, unknown>> = [];
  const observer = (pi: {
    on: (name: string, handler: (event: Record<string, unknown>) => unknown) => void;
  }) => {
    pi.on("before_provider_request", (event) => {
      const payload = structuredClone(event.payload) as Json;
      captures.push({
        sequence: captures.length + 1,
        payload,
        payloadSha256: sha256Canonical(payload),
      });
      return undefined;
    });
    for (const name of ["tool_execution_start", "tool_execution_update", "tool_execution_end"])
      pi.on(name, (event) => {
        toolEvents.push(JSON.parse(JSON.stringify(event)) as Record<string, unknown>);
      });
  };
  const factories = [
    observer,
    options.main.factory,
    ...(options.nativeFactory ? [options.nativeFactory] : []),
    ...(options.codemode === "off"
      ? []
      : [host.createCodemodeExtension({ mode: options.codemode })]),
    ...(options.extraFactories ?? []),
  ];
  const resourceLoader = new host.DefaultResourceLoader({
    cwd: options.workspace,
    agentDir: options.agentDir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: "You are a scripted qualification main model.",
    additionalExtensionPaths: [...(options.extensionPaths ?? [])],
    extensionFactories: factories as never,
  });
  await resourceLoader.reload();
  const loaded = resourceLoader.getExtensions();
  if (loaded.errors.length)
    throw new Error(`extension load errors: ${JSON.stringify(loaded.errors)}`);
  const modelRuntime = await host.ModelRuntime.create({
    authPath: join(options.agentDir, "auth.json"),
    modelsPath: join(options.agentDir, "models.json"),
  });
  const { session } = await host.createAgentSession({
    cwd: options.workspace,
    agentDir: options.agentDir,
    thinkingLevel: "off",
    modelRuntime,
    resourceLoader,
    ...(options.activateOnly ? { noTools: "builtin" as const } : {}),
    tools: [
      ...(options.activateOnly ? (options.tools ?? []).map((name) => `+${name}`) : []),
      ...(options.activateOnly
        ? []
        : (options.tools ??
          (options.codemode === "off"
            ? ["intelli_search", "intelli_extract", "intelli_collate", "intelli_research"]
            : [
                "codemode",
                "intelli_search",
                "intelli_extract",
                "intelli_collate",
                "intelli_research",
              ]))),
    ],
    sessionManager: host.SessionManager.inMemory(options.workspace),
    settingsManager: host.SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false },
    }),
  });
  await session.bindExtensions({});
  // The in-process main provider exists only once its extension is bound.
  const main = (
    modelRuntime as unknown as { getModel(provider: string, id: string): Model<Api> | undefined }
  ).getModel(MAIN_PROVIDER, "main");
  if (!main) throw new Error("in-process main model missing from host registry");
  await session.setModel(main);
  const events: Json[] = [];
  session.subscribe((event: unknown) => {
    events.push(JSON.parse(JSON.stringify(event)) as Json);
  });
  return {
    session,
    events,
    captures,
    toolEvents,
    dispose: () => session.dispose(),
  };
}

// ── Workspace state ─────────────────────────────────────────────────────────

/** Freeze the per-block workspace (including the cache index) as a byte copy. */
export async function snapshotWorkspace(workspace: string, snapshot: string): Promise<void> {
  await rm(snapshot, { recursive: true, force: true });
  await cp(workspace, snapshot, { recursive: true, verbatimSymlinks: true });
}

/** Restore the frozen state at the SAME absolute path, so prompts embedding paths match. */
export async function restoreWorkspace(snapshot: string, workspace: string): Promise<void> {
  await rm(workspace, { recursive: true, force: true });
  await cp(snapshot, workspace, { recursive: true, verbatimSymlinks: true });
}

export async function treeDigest(dir: string): Promise<string> {
  const hash = createHash("sha256");
  const walk = async (current: string): Promise<void> => {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(current, entry.name);
      hash.update(relative(dir, path));
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) hash.update(await readFile(path));
    }
  };
  await walk(dir);
  return hash.digest("hex");
}

// ── Evidence helpers ────────────────────────────────────────────────────────

export const canonical = canonicalJson;
export { ReplayMissError };
export type { FixtureFile, FixtureRecord, Json };

export function keySummary(store: BenchmarkReplayStore) {
  const label = (key: { boundary: string; operationNode: string; occurrence: number }) =>
    `${key.boundary}:${key.operationNode}#${key.occurrence}`;
  return {
    consumed: store.consumed().map(label),
    misses: store.misses().map(label),
    unconsumed: store.unconsumed().map(label),
  };
}

/** Append an evidence record under the harness root (never /tmp). */
export async function writeEvidence(root: string, name: string, value: unknown): Promise<string> {
  const path = join(root, "evidence", `${name}.json`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}
