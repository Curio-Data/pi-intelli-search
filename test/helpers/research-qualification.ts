// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Isolated M2 real-adapter qualification harness (C03/C04/C06/C19).
// Pages travel through the real owned-process transport to loopback fixture
// servers. Models are scripted at the native registry facade or the MCP
// provider fetch seam, so real admission, policy and ledgers remain active.
// Nothing here reaches an external provider, page, catalogue or package source.

import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  readlink,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, Context, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { OperationInputs } from "../../src/core/contracts.js";
import {
  createNativeOperationRuntime,
  type NativeRuntimeOptions,
} from "../../src/native-operation-runtime.js";
import { invalidateSettingsCache, clearMigrationContext } from "../../src/settings.js";
import {
  SEARCH_SYSTEM_PROMPT,
  EXTRACTION_SYSTEM_PROMPT,
  COLLATION_SYSTEM_PROMPT,
  CACHE_SUGGEST_PROMPT,
} from "../../src/prompts.js";

export type ModelRole = "search" | "extract" | "collate" | "suggest";
/** Scripted model step: return text, or wait on the call's abort signal first. */
export type ModelScript = (call: {
  readonly role: ModelRole;
  readonly user: string;
  readonly signal: AbortSignal | undefined;
}) => Promise<string>;

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** Resolves when the signal aborts, then rejects like a cooperative transport. */
export function untilAborted(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_, reject) => {
    const fail = () => reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    if (!signal) return;
    if (signal.aborted) fail();
    else signal.addEventListener("abort", fail, { once: true });
  });
}

const roleOf = (systemPrompt: string | undefined): ModelRole => {
  if (systemPrompt === SEARCH_SYSTEM_PROMPT) return "search";
  if (systemPrompt === EXTRACTION_SYSTEM_PROMPT) return "extract";
  if (systemPrompt === COLLATION_SYSTEM_PROMPT) return "collate";
  if (systemPrompt === CACHE_SUGGEST_PROMPT) return "suggest";
  throw new Error("Unscripted system prompt");
};

/** Every scratch path lives under the runner's private TMPDIR, never a shared /tmp. */
export async function scratch(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `research-qualification-${prefix}-`));
  return realpath(root);
}

// ── Fixture servers ─────────────────────────────────────────────────────────

export interface RequestRecord {
  readonly path: string;
  readonly accept: string;
  readonly acceptEncoding: string;
  readonly startedMs: number;
  endedMs?: number;
  /** Response stream closed before `finish`: the client went away mid-body. */
  clientClosedEarly: boolean;
  bytesWritten: number;
}

export type Route = (
  req: IncomingMessage,
  res: ServerResponse,
  record: RequestRecord,
  server: FixtureServer,
) => void | Promise<void>;

export interface FixtureServer {
  readonly origin: string;
  readonly port: number;
  readonly requests: RequestRecord[];
  /** Highest number of simultaneously open requests, any path. */
  readonly maxConcurrent: () => number;
  /** Highest number of simultaneously open requests per distinct path family. */
  readonly maxConcurrentPaths: () => number;
  readonly openSockets: () => number;
  readonly openRequests: () => number;
  /** Released for every pending hold when the server closes. */
  readonly released: Promise<void>;
  close(): Promise<void>;
}

/**
 * Loopback HTTP(S) fixture. Records each request, its client-side closure and
 * the bytes the server managed to write, which bound what the child consumed.
 */
export async function startFixtureServer(
  routes: Record<string, Route>,
  tls?: { key: Buffer; cert: Buffer },
): Promise<FixtureServer> {
  const requests: RequestRecord[] = [];
  const sockets = new Set<Socket>();
  let open = 0;
  let peak = 0;
  const openPaths = new Map<string, number>();
  let peakPaths = 0;
  const release = deferred();
  let self!: FixtureServer;
  const handler = (req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? "/").split("?")[0];
    const record: RequestRecord = {
      path,
      accept: String(req.headers.accept ?? ""),
      acceptEncoding: String(req.headers["accept-encoding"] ?? ""),
      startedMs: performance.now(),
      clientClosedEarly: false,
      bytesWritten: 0,
    };
    requests.push(record);
    open++;
    peak = Math.max(peak, open);
    const family = path.replace(/\/(alt|probe)$/, "");
    openPaths.set(family, (openPaths.get(family) ?? 0) + 1);
    peakPaths = Math.max(peakPaths, openPaths.size);
    const write = res.write.bind(res);
    res.write = ((chunk: unknown, ...rest: unknown[]) => {
      if (typeof chunk === "string" || chunk instanceof Uint8Array)
        record.bytesWritten += Buffer.byteLength(chunk as string);
      return (write as (...args: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof res.write;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      record.endedMs = performance.now();
      open--;
      const left = (openPaths.get(family) ?? 1) - 1;
      if (left) openPaths.set(family, left);
      else openPaths.delete(family);
    };
    res.once("finish", finish);
    res.once("close", () => {
      if (!res.writableFinished) record.clientClosedEarly = true;
      finish();
    });
    const route = routes[path] ?? routes["*"];
    if (!route) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("missing");
      return;
    }
    void Promise.resolve(route(req, res, record, self)).catch(() => res.destroy());
  };
  const server: Server = tls ? createHttpsServer(tls, handler) : createHttpServer(handler);
  server.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  // Child requests are short-lived; keep-alive must not hold a closed child's socket.
  server.keepAliveTimeout = 1;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  let closing: Promise<void> | undefined;
  self = {
    origin: `${tls ? "https" : "http"}://127.0.0.1:${port}`,
    port,
    requests,
    maxConcurrent: () => peak,
    maxConcurrentPaths: () => peakPaths,
    openSockets: () => sockets.size,
    openRequests: () => open,
    released: release.promise,
    close() {
      closing ??= (async () => {
        release.resolve();
        server.closeAllConnections();
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      })();
      return closing;
    },
  };
  return self;
}

/** Drip `total` bytes in `chunk`-sized writes, `intervalMs` apart; stop on client close. */
export async function drip(
  res: ServerResponse,
  options: { total: number; chunk: number; intervalMs: number; fill?: string },
): Promise<void> {
  let sent = 0;
  const piece = Buffer.alloc(options.chunk, options.fill ?? "a");
  while (sent < options.total && !res.destroyed) {
    const size = Math.min(options.chunk, options.total - sent);
    const ok = res.write(size === options.chunk ? piece : piece.subarray(0, size));
    sent += size;
    if (!ok)
      await new Promise<void>((resolve) => {
        const done = () => {
          res.off("drain", done);
          res.off("close", done);
          resolve();
        };
        res.once("drain", done);
        res.once("close", done);
      });
    if (options.intervalMs) await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
  if (!res.destroyed) res.end();
}

export const markdownDocument = (title: string, words = 200) =>
  `# ${title}\n\n${Array.from({ length: words }, (_, i) => `fact${i}`).join(" ")}\n`;
export const htmlDocument = (title: string, words = 200) =>
  `<!doctype html><html><head><title>${title}</title></head><body><article><h1>${title}</h1><p>${Array.from({ length: words }, (_, i) => `fact${i}`).join(" ")}</p></article></body></html>`;

/** Serve one Markdown page for both the HTML and Markdown variants. */
export const pageRoute =
  (title: string, words = 200): Route =>
  (req, res) => {
    const markdown = String(req.headers.accept ?? "").includes("text/markdown");
    res.writeHead(200, { "content-type": markdown ? "text/markdown" : "text/html" });
    res.end(markdown ? markdownDocument(title, words) : htmlDocument(title, words));
  };

/** Never sends headers until the server closes or the client disconnects. */
export const holdRoute =
  (entered?: () => void): Route =>
  async (_req, res, _record, server) => {
    entered?.();
    await Promise.race([server.released, new Promise((resolve) => res.once("close", resolve))]);
    if (!res.destroyed) res.destroy();
  };

/** Sends headers immediately, then drips a long body until the client leaves. */
export const slowBodyRoute =
  (entered?: () => void, contentType = "text/html"): Route =>
  async (_req, res) => {
    res.writeHead(200, { "content-type": contentType });
    res.write("<!doctype html><html><body><p>");
    entered?.();
    await drip(res, { total: 4 * 1024 * 1024, chunk: 1024, intervalMs: 20 });
  };

// ── Certificates (local private authority for verified HTTPS) ──────────────

const run = promisify(execFile);
export interface Certificates {
  readonly caPath: string;
  readonly key: Buffer;
  readonly cert: Buffer;
}
/** Generates a throwaway authority and loopback leaf with the system `openssl`. */
export async function createCertificates(dir: string): Promise<Certificates | undefined> {
  await mkdir(dir, { recursive: true });
  const at = (name: string) => join(dir, name);
  try {
    await run("openssl", ["version"]);
  } catch {
    return undefined;
  }
  const ec = ["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes"];
  await run("openssl", [
    "req",
    "-x509",
    ...ec,
    "-keyout",
    at("ca.key"),
    "-out",
    at("ca.pem"),
    "-days",
    "2",
    "-subj",
    "/CN=research qualification CA",
    "-addext",
    "basicConstraints=critical,CA:TRUE",
    "-addext",
    "keyUsage=critical,keyCertSign",
  ]);
  await run("openssl", [
    "req",
    ...ec,
    "-keyout",
    at("leaf.key"),
    "-out",
    at("leaf.csr"),
    "-subj",
    "/CN=127.0.0.1",
  ]);
  await writeFile(
    at("leaf.cnf"),
    "subjectAltName=IP:127.0.0.1,DNS:localhost\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n",
  );
  await run("openssl", [
    "x509",
    "-req",
    "-in",
    at("leaf.csr"),
    "-CA",
    at("ca.pem"),
    "-CAkey",
    at("ca.key"),
    "-CAcreateserial",
    "-out",
    at("leaf.pem"),
    "-days",
    "2",
    "-extfile",
    at("leaf.cnf"),
  ]);
  return {
    caPath: at("ca.pem"),
    key: await readFile(at("leaf.key")),
    cert: await readFile(at("leaf.pem")),
  };
}

// ── Out-of-band child process witness (Linux /proc) ─────────────────────────

export interface ChildObservation {
  readonly pid: number;
  readonly exe: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly firstSeenMs: number;
  lastSeenMs: number;
  /** Highest VmHWM (peak resident set) sampled, in KiB. */
  peakResidentKiB: number;
}

export const procAvailable = async () => {
  try {
    await readdir(`/proc/${process.pid}/task`);
    return true;
  } catch {
    return false;
  }
};

async function directChildren(): Promise<number[]> {
  const pids: number[] = [];
  for (const tid of await readdir(`/proc/${process.pid}/task`).catch(() => [] as string[])) {
    const text = await readFile(`/proc/${process.pid}/task/${tid}/children`, "utf8").catch(
      () => "",
    );
    for (const value of text.split(/\s+/)) if (value) pids.push(Number(value));
  }
  return pids;
}

const isTransportChild = (cmdline: string) =>
  cmdline.includes("--input-type=module") && cmdline.includes("wreq-js");

/** Page transport children of this test process that are alive right now. */
export async function liveTransportChildren(): Promise<number[]> {
  const live: number[] = [];
  for (const pid of await directChildren()) {
    const cmdline = await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "");
    const state = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => "");
    // A zombie has exited but is unreaped; it still counts as unsettled ownership.
    if (isTransportChild(cmdline.replaceAll("\0", " ")) && state) live.push(pid);
  }
  return live;
}

/** Samples transport children every few milliseconds until stopped. */
export function watchTransportChildren(intervalMs = 4) {
  const seen = new Map<number, ChildObservation>();
  let stopped = false;
  let tick: Promise<void> = Promise.resolve();
  const sample = async () => {
    for (const pid of await directChildren()) {
      const cmdline = (await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "")).replaceAll(
        "\0",
        " ",
      );
      if (!isTransportChild(cmdline)) continue;
      const now = performance.now();
      const status = await readFile(`/proc/${pid}/status`, "utf8").catch(() => "");
      const hwm = Number(/VmHWM:\s+(\d+)/.exec(status)?.[1] ?? 0);
      let item = seen.get(pid);
      if (!item) {
        const environ = await readFile(`/proc/${pid}/environ`, "utf8").catch(() => "");
        const environment = Object.fromEntries(
          environ
            .split("\0")
            .filter(Boolean)
            .map((entry) => [
              entry.slice(0, entry.indexOf("=")),
              entry.slice(entry.indexOf("=") + 1),
            ]),
        );
        const exe = await readlink(`/proc/${pid}/exe`).catch(() => "");
        if (!exe) continue;
        item = { pid, exe, environment, firstSeenMs: now, lastSeenMs: now, peakResidentKiB: hwm };
        seen.set(pid, item);
      }
      item.lastSeenMs = now;
      item.peakResidentKiB = Math.max(item.peakResidentKiB, hwm);
    }
  };
  const timer = setInterval(() => {
    tick = tick.then(sample, sample);
  }, intervalMs);
  return {
    observations: () => [...seen.values()],
    async stop() {
      if (stopped) return [...seen.values()];
      stopped = true;
      clearInterval(timer);
      await tick.catch(() => {});
      return [...seen.values()];
    },
  };
}

// ── Owned-resource witnesses ────────────────────────────────────────────────

/** Active libuv handle/request counts by type, as Node reports them. */
export function activeResources(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const type of process.getActiveResourcesInfo()) counts[type] = (counts[type] ?? 0) + 1;
  return counts;
}

/** Regular files currently below `<cacheRoot>/.staging`, recursively. */
export async function stagingFiles(cacheRoot: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else found.push(path);
    }
  };
  await walk(join(cacheRoot, ".staging"));
  return found;
}
/** Owned directories remaining below `<cacheRoot>/.staging` (the root itself excluded). */
export async function stagingDirectories(cacheRoot: string): Promise<string[]> {
  return (await readdir(join(cacheRoot, ".staging")).catch(() => [] as string[])).sort();
}

/** Polls a population (for example staged files) and keeps its maximum. */
export function samplePopulation(read: () => Promise<number>, intervalMs = 3) {
  let peak = 0;
  let tick: Promise<void> = Promise.resolve();
  const sample = async () => {
    peak = Math.max(peak, await read().catch(() => 0));
  };
  const timer = setInterval(() => {
    tick = tick.then(sample, sample);
  }, intervalMs);
  return {
    peak: () => peak,
    async stop() {
      clearInterval(timer);
      await tick.catch(() => {});
      await sample();
      return peak;
    },
  };
}

/** Samples this process's heap and resident set until stopped (bytes). */
export function sampleMemory(intervalMs = 2) {
  let heap = process.memoryUsage().heapUsed;
  let rss = process.memoryUsage().rss;
  const base = { heap, rss, external: process.memoryUsage().external };
  let external = base.external;
  const timer = setInterval(() => {
    const now = process.memoryUsage();
    heap = Math.max(heap, now.heapUsed);
    rss = Math.max(rss, now.rss);
    external = Math.max(external, now.external + now.arrayBuffers);
  }, intervalMs);
  return {
    stop() {
      clearInterval(timer);
      return {
        baseHeap: base.heap,
        baseRss: base.rss,
        peakHeap: heap,
        peakRss: rss,
        peakExternal: external,
      };
    },
  };
}

// ── Native registered research harness ──────────────────────────────────────

const usage = {
  input: 9,
  output: 3,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 12,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
function assistant(text: string): AssistantMessage {
  return {
    role: "assistant",
    api: "openai-completions",
    provider: "openrouter",
    model: "fixture",
    timestamp: 0,
    content: [{ type: "text", text }],
    stopReason: "stop",
    usage,
  } as AssistantMessage;
}

export interface NativeHarnessOptions {
  readonly script: ModelScript;
  readonly settings?: Record<string, unknown>;
  /** Top-level `Pi` settings, for example `httpProxy`. */
  readonly topLevel?: Record<string, unknown>;
  readonly runtime?: NativeRuntimeOptions;
  /**
   * Replaces the scripted reply for chosen calls with a real provider stream
   * (for example the installed SDK against a loopback server). Receives the
   * exact options native `callLlm()` passes, including the citation fetch.
   */
  readonly provider?: (
    role: ModelRole,
    context: Context,
    options: SimpleStreamOptions,
  ) => Promise<AssistantMessage> | undefined;
  /** Synchronous native progress observer (for example to abort at a stage edge). */
  readonly onUpdate?: (update: unknown) => void;
  /** Applied to process.env before session start, then restored at cleanup. */
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

/**
 * Actual registered native runtime (generation manager, operation runtime,
 * scoped native model client, real run store). Without `runtime.pageTransport`
 * it captures `process.execPath` and the filtered parent environment exactly
 * as the extension does, then spawns real page children.
 */
export async function nativeHarness(options: NativeHarnessOptions) {
  const root = await scratch("native");
  const agent = join(root, "agent");
  const workspace = join(root, "workspace");
  await mkdir(agent);
  await mkdir(workspace);
  const savedAgent = process.env.PI_CODING_AGENT_DIR;
  const savedEnvironment = new Map<string, string | undefined>();
  process.env.PI_CODING_AGENT_DIR = agent;
  for (const [name, value] of Object.entries(options.environment ?? {})) {
    savedEnvironment.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  invalidateSettingsCache();
  clearMigrationContext();
  await writeFile(
    join(agent, "settings.json"),
    JSON.stringify({
      ...options.topLevel,
      "pi-intelli-search": {
        searchModel: { provider: "openrouter", model: "fixture-search" },
        extractModel: { provider: "openrouter", model: "fixture-extract" },
        collateModel: { provider: "openrouter", model: "fixture-collate" },
        llmRetryAttempts: 1,
        retryBaseDelayMs: 0,
        retryMaxDelayMs: 0,
        searchRetryAttempts: 1,
        disableLlmsFullDiscovery: true,
        disableTelemetry: true,
        fetchTimeoutMs: 30_000,
        ...options.settings,
      },
    }),
  );
  invalidateSettingsCache();
  const calls: { role: ModelRole; startedMs: number }[] = [];
  const registry = {
    find: (provider: string, id: string) => ({ provider, id }),
    getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "synthetic-credential-free" }),
    refresh: async () => {},
    streamSimple: (_model: unknown, context: Context, stream: SimpleStreamOptions) => ({
      result: async () => {
        const role = roleOf(context.systemPrompt);
        calls.push({ role, startedMs: performance.now() });
        const real = options.provider?.(role, context, stream);
        if (real) return real;
        const first = context.messages[0];
        const user =
          typeof first?.content === "string" ? first.content : JSON.stringify(first?.content ?? "");
        return assistant(await options.script({ role, user, signal: stream.signal }));
      },
    }),
  };
  const runtime = createNativeOperationRuntime({ supportsErrorResults: true, ...options.runtime });
  const ctx = {
    cwd: workspace,
    hasUI: false,
    isProjectTrusted: () => false,
    sessionManager: { getSessionId: () => "qualification" },
    modelRegistry: registry,
    ui: { notify() {}, setWorkingIndicator() {} },
  } as unknown as ExtensionContext;
  const updates: unknown[] = [];
  // Capture the session generation (executable, environment, settings) now.
  await runtime.start(ctx);
  return {
    root,
    workspace,
    cacheRoot: join(workspace, ".search"),
    calls,
    updates,
    runtime,
    research(params: OperationInputs["intelli_research"], signal?: AbortSignal) {
      return runtime.execute(
        "intelli_research",
        params,
        signal,
        (u) => {
          updates.push(u);
          options.onUpdate?.(u);
        },
        ctx,
      );
    },
    async cleanup() {
      await runtime.close();
      if (savedAgent === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = savedAgent;
      for (const [name, value] of savedEnvironment) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      invalidateSettingsCache();
      clearMigrationContext();
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** Search reply that lists the given page URLs as Markdown links. */
export const links = (urls: readonly string[]) =>
  urls.map((url, i) => `- [Source ${i + 1}](${url})`).join("\n");

// ── Measurement ─────────────────────────────────────────────────────────────

export interface Settlement<T> {
  readonly value?: T;
  readonly error?: unknown;
  /** Wall-clock milliseconds from the abort request to promise settlement. */
  readonly abortToSettledMs: number;
  /** Transport children alive at the instant the caller observed settlement. */
  readonly liveChildrenAtSettlement: readonly number[];
}

/** Aborts, then measures real wall time to settlement and the children still alive. */
export async function abortAndSettle<T>(
  pending: Promise<T>,
  abort: () => unknown,
): Promise<Settlement<T>> {
  const outcome = pending.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  const started = performance.now();
  await abort();
  const result = await outcome;
  const abortToSettledMs = performance.now() - started;
  return { ...result, abortToSettledMs, liveChildrenAtSettlement: await liveTransportChildren() };
}

/** Append one measured observation line for the evidence log. */
export async function recordObservation(name: string, value: unknown): Promise<void> {
  const file = process.env.QUALIFICATION_LOG;
  if (!file) return;
  await writeFile(file, `${JSON.stringify({ name, ...((value as object) ?? {}) })}\n`, {
    flag: "a",
  });
}

/** Minimal CONNECT/absolute-form proxy that maps every target to one fixture origin. */
export async function startRoutingProxy(target: { port: number }) {
  const connects: string[] = [];
  const absolute: string[] = [];
  const server = createHttpServer((req, res) => {
    absolute.push(String(req.url));
    const url = new URL(String(req.url));
    const upstream = connect(target.port, "127.0.0.1", () => {
      upstream.write(
        `${req.method} ${url.pathname}${url.search} HTTP/1.1\r\nHost: ${url.host}\r\nConnection: close\r\n${Object.entries(
          req.headers,
        )
          .filter(([name]) => !["host", "connection", "proxy-connection"].includes(name))
          .map(([name, value]) => `${name}: ${String(value)}\r\n`)
          .join("")}\r\n`,
      );
      req.pipe(upstream);
      upstream.pipe(res.socket!);
    });
    upstream.on("error", () => res.destroy());
  });
  const sockets = new Set<Socket>();
  server.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("connect", (req: IncomingMessage, socket: Socket, head: Buffer) => {
    connects.push(String(req.url));
    sockets.add(socket);
    const upstream = connect(target.port, "127.0.0.1", () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
    socket.once("close", () => upstream.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    connects,
    absolute,
    async close() {
      for (const socket of sockets) socket.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

// ── MCP registered research harness ─────────────────────────────────────────

const MCP_MODELS = {
  search: { provider: "openrouter", model: "perplexity/sonar" },
  extract: { provider: "openrouter", model: "fixture/extract" },
  collate: { provider: "openrouter", model: "fixture/collate" },
};
const mcpCatalogue = {
  data: Object.values(MCP_MODELS).map(({ model: id }) => ({
    id,
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
    supported_parameters: ["tools", "reasoning"],
    reasoning: { supported_efforts: ["minimal", "low", "high"] },
  })),
};

export interface McpHarnessOptions {
  /** Return text for a JSON completion, or a whole Response (for stalled bodies). */
  readonly script: (call: {
    readonly role: ModelRole;
    readonly user: string;
    readonly signal: AbortSignal | undefined;
  }) => Promise<string | Response>;
  readonly tuning?: Record<string, unknown>;
  /** The adapter's explicit environment option; page children may only see allow-listed names. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Actual standalone runtime (`createRuntime`): strict config, operation
 * runtime, OpenRouter provider policy and real run store. Only the provider
 * HTTP function is scripted; pages use the captured real process transport.
 */
export async function mcpHarness(options: McpHarnessOptions) {
  const { parseConfig } = await import("../../packages/mcp/src/config.js");
  const { createRuntime } = await import("../../packages/mcp/src/runtime.js");
  const root = await scratch("mcp");
  const config = await parseConfig(
    {
      providers: { openrouter: { apiKeyEnv: "FIXTURE_KEY" } },
      models: MCP_MODELS,
      tuning: {
        llmRetryAttempts: 1,
        retryBaseDelayMs: 0,
        retryMaxDelayMs: 0,
        llmTimeoutMs: 60_000,
        searchRetryAttempts: 1,
        disableLlmsFullDiscovery: true,
        disableTelemetry: true,
        fetchTimeoutMs: 30_000,
        ...options.tuning,
      },
    },
    root,
  );
  const calls: ModelRole[] = [];
  const diagnostics: string[] = [];
  const fetch = async (url: string | URL | Request, init: RequestInit = {}) => {
    const target = String(url);
    if (target === "https://openrouter.ai/api/v1/models")
      return new Response(JSON.stringify(mcpCatalogue), { status: 200 });
    if (target !== "https://openrouter.ai/api/v1/chat/completions")
      throw new Error(`Unexpected network access: ${target}`);
    const body = JSON.parse(String(init.body)) as {
      messages: { role: string; content: string }[];
    };
    const role = roleOf(body.messages.find((m) => m.role === "system")?.content);
    calls.push(role);
    const user = body.messages.find((m) => m.role === "user")?.content ?? "";
    const reply = await options.script({ role, user, signal: init.signal ?? undefined });
    if (reply instanceof Response) return reply;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: reply }, finish_reason: "stop" }],
        usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 },
      }),
      { status: 200 },
    );
  };
  const runtime = await createRuntime(config, {
    env: options.env ?? {
      FIXTURE_KEY: "fixture-secret-never-in-page-children",
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
    },
    logger: {
      error: (message: string) => diagnostics.push(message),
      warn: (message: string) => diagnostics.push(message),
    },
    fetch: fetch as never,
  });
  return {
    root,
    cacheRoot: join(root, ".search"),
    calls,
    diagnostics,
    runtime,
    research(params: OperationInputs["intelli_research"], signal?: AbortSignal) {
      return runtime.execute("intelli_research", params, { signal });
    },
    async cleanup() {
      await runtime.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

/**
 * A provider response whose headers arrive but whose JSON body never completes.
 * It ignores abort signals: only the consumer's reader cancellation ends it.
 */
export function stalledProviderBody(onCancel: () => void) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Buffer.from('{"choices":[{"message":{"content":"partial'));
    },
    cancel() {
      onCancel();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "application/json" } });
}

// ── Real fetch-service harness (factory, permits, limits, process transport) ─

/**
 * The adapters' own fetch factory (`capturePageFetchFactory`) inside a real
 * operation runtime, with the real process transport and run store. Used for
 * exact transport-limit diagnostics that research projects only as states.
 */
export async function fetchServiceHarness(options: {
  readonly execution?: Partial<Record<string, unknown>>;
  readonly settings?: Record<string, unknown>;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}) {
  const { createOperationRuntime } = await import("../../src/core/operation-runtime.js");
  const { capturePageFetchFactory, capturePageEnvironment } =
    await import("../../src/core/page-runtime.js");
  const { parseExecutionSettings } = await import("../../src/core/execution-settings.js");
  const { tuningDefaults } = await import("../../src/core/defaults.js");
  const { createSystemClock } = await import("../../src/core/clock.js");
  const { createRunStore } = await import("../../src/core/run-store.js");
  const root = await scratch("fetch");
  const execution = parseExecutionSettings(options.execution ?? {});
  const settings = {
    ...tuningDefaults(),
    searchModel: { provider: "openrouter", model: "unused" },
    extractModel: { provider: "openrouter", model: "unused" },
    collateModel: { provider: "openrouter", model: "unused" },
    fetchTimeoutMs: 30_000,
    ...options.settings,
    execution,
  };
  const clock = createSystemClock();
  const runtime = createOperationRuntime({
    generation: 0,
    clock,
    modelConcurrency: execution.modelConcurrency,
    criticalReserve: execution.criticalReserve,
    fetchConcurrency: execution.aggregateFetchConcurrency,
    minRequestIntervalMs: 0,
    createFetch: capturePageFetchFactory(settings as never, clock, {
      executable: process.execPath,
      environment: capturePageEnvironment(options.environment ?? process.env),
    }),
    createRuns: () =>
      createRunStore({
        workspaceRoot: root,
        cacheRoot: join(root, ".search"),
        displayRoot: ".search",
        clock,
        randomId: () => Math.random().toString(16).slice(2).padEnd(32, "0"),
        onDiagnostic: () => {},
      }),
  });
  let sequence = 0;
  return {
    root,
    runtime,
    /** One operation fetching every URL concurrently; returns settled page records. */
    fetchAll(urls: readonly string[], maxChars?: number) {
      return runtime.run({ operationId: `fetch-${++sequence}` }, async (services) =>
        Promise.all(
          urls.map((url, i) =>
            services.fetch.fetch(
              { url, ...(maxChars === undefined ? {} : { maxChars }) },
              services.operation,
              { pageId: `S${i + 1}` },
            ),
          ),
        ),
      );
    },
    async cleanup() {
      await runtime.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
