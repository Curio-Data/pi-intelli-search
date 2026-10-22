// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// M2 real-adapter qualification (C03/C04/C06/C19, T03/T04/T06/T19). These
// tests drive actual registered native and MCP research through real owned
// page processes against loopback fixtures. They qualify, not accept, M2.

import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { readdir, readFile, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { brotliCompressSync, deflateSync, gzipSync, zstdCompressSync } from "node:zlib";
import type { FullData, Progress } from "../src/core/contracts.js";
import {
  abortAndSettle,
  activeResources,
  createCertificates,
  deferred,
  drip,
  fetchServiceHarness,
  sampleMemory,
  samplePopulation,
  stagingFiles,
  markdownDocument,
  mcpHarness,
  scratch,
  stalledProviderBody,
  startRoutingProxy,
  holdRoute,
  slowBodyRoute,
  type ModelRole,
  type ModelScript,
  type FixtureServer,
  type Route,
  liveTransportChildren,
  links,
  nativeHarness,
  pageRoute,
  procAvailable,
  recordObservation,
  stagingDirectories,
  startFixtureServer,
  untilAborted,
  watchTransportChildren,
} from "./helpers/research-qualification.js";

const CANCELLATION_TARGET_MS = 5_000;
const linux = await procAvailable();

test("native registered research completes through real page children (baseline)", async () => {
  let server: FixtureServer | undefined;
  let h: Awaited<ReturnType<typeof nativeHarness>> | undefined;
  const watch = linux ? watchTransportChildren() : undefined;
  try {
    server = await startFixtureServer({ "/a": pageRoute("Alpha"), "/b": pageRoute("Beta") });
    const origin = server.origin;
    h = await nativeHarness({
      script: async ({ role }) =>
        role === "search"
          ? links([`${origin}/a`, `${origin}/b`])
          : role === "extract"
            ? "Official docs, current.\nFacts"
            : role === "collate"
              ? "Answer [S1] [S2]"
              : "[]",
    });
    const result = await h.research({ query: "baseline" });
    const observed = (await watch?.stop()) ?? [];
    const data = result.details!.intelli as FullData;
    assert.equal(data.outcome, "completed", JSON.stringify(data.sources));
    assert.equal(data.counts.fetched, 2);
    assert.equal(data.cache.status, "committed");
    if (linux) {
      assert(observed.length >= 4, `expected dual-fetch children, saw ${observed.length}`);
      assert.deepEqual(await liveTransportChildren(), []);
    }
    assert.deepEqual(await stagingDirectories(h.cacheRoot), []);
    await recordObservation("baseline", {
      children: observed.length,
      requests: server.requests.length,
      resources: activeResources(),
    });
  } finally {
    await watch?.stop();
    await h?.cleanup();
    await server?.close();
  }
});

// ── C04/C06 native cancellation phases ─────────────────────────────────────

interface Phase {
  readonly name: string;
  readonly settings?: Record<string, unknown>;
  /** Builds routes; call `reached()` once the phase is entered. */
  readonly routes: (reached: () => void) => Record<string, Route>;
  /** Model script; may call `reached()` and hold on the call signal. */
  readonly script: (reached: () => void, origin: string) => ModelScript;
  readonly paths: readonly string[];
}

const answer =
  (reached: () => void, holdRole?: ModelRole, origin = "", paths: readonly string[] = []) =>
  async ({ role, signal }: { role: ModelRole; signal: AbortSignal | undefined }) => {
    if (role === holdRole) {
      reached();
      return untilAborted(signal);
    }
    if (role === "search") return links(paths.map((path) => origin + path));
    if (role === "extract") return "Official docs, current.\nFacts";
    if (role === "collate") return "Answer [S1]";
    return "[]";
  };

const PHASE_ENTRY_LIMIT_MS = 15_000;

async function qualifyNativeAbort(t: TestContext, phase: Phase) {
  const reached = deferred();
  const controller = new AbortController();
  // Every resource created during setup is released on any setup failure.
  let server: FixtureServer | undefined;
  let h: Awaited<ReturnType<typeof nativeHarness>> | undefined;
  let watch: ReturnType<typeof watchTransportChildren> | undefined;
  let pending: Promise<unknown> | undefined;
  try {
    server = await startFixtureServer(phase.routes(() => reached.resolve()));
    h = await nativeHarness({
      script: phase.script(() => reached.resolve(), server.origin),
      settings: phase.settings,
    });
    watch = linux ? watchTransportChildren() : undefined;
    const before = activeResources();
    const run = h.research({ query: `abort ${phase.name}` }, controller.signal);
    pending = run.catch(() => {});
    // Bounded phase entry: on expiry, abort and still await settlement before failing.
    let entryTimer: NodeJS.Timeout | undefined;
    const entry = await Promise.race([
      reached.promise.then(() => "reached" as const),
      run.then(
        () => "settled" as const,
        () => "settled" as const,
      ),
      new Promise<"timeout">((resolve) => {
        entryTimer = setTimeout(() => resolve("timeout"), PHASE_ENTRY_LIMIT_MS);
      }),
    ]);
    clearTimeout(entryTimer);
    if (entry !== "reached") {
      controller.abort();
      const late = await run.then(
        (value) => value.details?.intelli as FullData | undefined,
        () => undefined,
      );
      throw new Error(
        `${phase.name}: phase not entered (${entry}); outcome ${late?.outcome}, states ${JSON.stringify(late?.sources.map((source) => source.state))}, calls ${JSON.stringify(h.calls.map((call) => call.role))}, requests ${server.requests.length}`,
      );
    }
    // Let the phase become steady (children spawned, bodies flowing).
    await delay(60);
    const childrenAtAbort = linux ? await liveTransportChildren() : [];
    const settled = await abortAndSettle(run, () => controller.abort());
    const observed = (await watch?.stop()) ?? [];
    const result = settled.value as Awaited<ReturnType<typeof h.research>> | undefined;
    const data = result?.details?.intelli as FullData | undefined;
    const staging = await stagingDirectories(h.cacheRoot);
    const serverOpenAtSettlement = server.openRequests();
    const lagStart = performance.now();
    while (server.openRequests() && performance.now() - lagStart < 1_000) await delay(5);
    const serverCloseLagMs = performance.now() - lagStart;
    await delay(50);
    const after = activeResources();
    const observation = {
      phase: phase.name,
      abortToSettledMs: Math.round(settled.abortToSettledMs),
      reportedAbortToSettledMs: data?.timing.abortToSettledMs,
      outcome: data?.outcome,
      isError: result?.isError,
      error: settled.error ? String(settled.error) : undefined,
      parentDelivery: data?.accounting.parentDelivery,
      childrenAtAbort: childrenAtAbort.length,
      childrenSpawned: observed.length,
      liveChildrenAtSettlement: settled.liveChildrenAtSettlement.length,
      serverOpenAtSettlement,
      serverCloseLagMs: Math.round(serverCloseLagMs),
      stagingDirectoriesAfter: staging.length,
      requests: server.requests.length,
      attempts: data?.attempts.length,
      sourceStates: data?.sources.map((source) => source.state),
      resourcesBefore: before,
      resourcesAfter: after,
    };
    await recordObservation("native-abort", observation);
    t.diagnostic(JSON.stringify(observation));
    assert.equal(settled.error, undefined, "capable host returns an error result");
    assert.equal(result?.isError, true);
    assert.equal(data?.outcome, "aborted");
    assert.equal(data?.accounting.parentDelivery, "unknown");
    assert(
      settled.abortToSettledMs < CANCELLATION_TARGET_MS,
      `${phase.name}: ${settled.abortToSettledMs} ms exceeds the C06 target`,
    );
    assert.deepEqual(settled.liveChildrenAtSettlement, [], "no page child outlives settlement");
    assert.deepEqual(staging, [], "staging cleanup precedes settlement");
    assert.equal(server.openRequests(), 0, "every fixture request closed");
    for (const type of ["ProcessWrap", "Timeout", "FSReqPromise", "TTYWrap"])
      assert(
        (after[type] ?? 0) <= (before[type] ?? 0),
        `${type} handles grew: ${before[type] ?? 0} -> ${after[type] ?? 0}`,
      );
    return { observation, data, server };
  } finally {
    controller.abort();
    await pending;
    await watch?.stop();
    await h?.cleanup();
    await server?.close();
  }
}

const phases: Phase[] = [
  {
    name: "search-model",
    routes: () => ({ "/a": pageRoute("Alpha") }),
    script: (reached, origin) => answer(reached, "search", origin, ["/a"]),
    paths: ["/a"],
  },
  {
    name: "fetch-headers",
    routes: (reached) => ({ "/a": holdRoute(reached) }),
    script: (reached, origin) => answer(reached, undefined, origin, ["/a"]),
    paths: ["/a"],
  },
  {
    name: "fetch-body",
    routes: (reached) => ({ "/a": slowBodyRoute(reached) }),
    script: (reached, origin) => answer(reached, undefined, origin, ["/a"]),
    paths: ["/a"],
  },
  {
    name: "extract-model-with-body-in-flight",
    routes: () => ({ "/a": pageRoute("Alpha"), "/b": slowBodyRoute() }),
    script: (reached, origin) => answer(reached, "extract", origin, ["/a", "/b"]),
    paths: ["/a", "/b"],
  },
  {
    name: "barrier-fetch-body",
    settings: { execution: { pageExecution: "barrier" } },
    routes: (reached) => ({ "/a": pageRoute("Alpha"), "/b": slowBodyRoute(reached) }),
    script: (reached, origin) => answer(reached, undefined, origin, ["/a", "/b"]),
    paths: ["/a", "/b"],
  },
  {
    name: "barrier-extract-model",
    settings: { execution: { pageExecution: "barrier" } },
    routes: () => ({ "/a": pageRoute("Alpha"), "/b": pageRoute("Beta") }),
    script: (reached, origin) => answer(reached, "extract", origin, ["/a", "/b"]),
    paths: ["/a", "/b"],
  },
  {
    name: "collate-model",
    routes: () => ({ "/a": pageRoute("Alpha") }),
    script: (reached, origin) => answer(reached, "collate", origin, ["/a"]),
    paths: ["/a"],
  },
  {
    name: "queued-fetch-admission",
    settings: { fetchConcurrency: 4, execution: { aggregateFetchConcurrency: 1 } },
    routes: (reached) => ({ "/a": slowBodyRoute(reached), "/b": pageRoute("Beta") }),
    script: (reached, origin) => answer(reached, undefined, origin, ["/a", "/b"]),
    paths: ["/a", "/b"],
  },
  {
    name: "pacing-wait",
    settings: { minRequestIntervalMs: 120_000 },
    routes: (reached) => ({
      "/a": (req, res, record, server) => {
        reached();
        return pageRoute("Alpha")(req, res, record, server);
      },
    }),
    script: (reached, origin) => answer(reached, undefined, origin, ["/a"]),
    paths: ["/a"],
  },
  {
    name: "late-drain",
    settings: {
      execution: {
        lateDrainMs: 30_000,
        deadline: {
          enabled: true,
          quorum: 0.5,
          factor: 0.01,
          floorMs: 0,
          ceilingMs: 200,
          minSources: 1,
        },
      },
    },
    // C09: freeze aborts in-flight fetches; only a started extraction is late work.
    // Alpha's extraction (which triggers freeze) waits until Beta's has started.
    routes: () => ({ "/a": pageRoute("Alpha"), "/b": pageRoute("Beta") }),
    script: (reached, origin) => {
      const betaStarted = deferred();
      return async ({ role, user, signal }) => {
        if (role === "search") return links([`${origin}/a`, `${origin}/b`]);
        if (role === "extract") {
          if (user.includes("Beta")) {
            betaStarted.resolve();
            return untilAborted(signal);
          }
          await Promise.race([betaStarted.promise, untilAborted(signal)]);
          return "Official docs, current.\nFacts";
        }
        if (role === "collate") {
          // Collation returns; the held Beta extraction is then inside the late drain.
          setTimeout(reached, 50);
          return "Answer [S1]";
        }
        return untilAborted(signal);
      };
    },
    paths: ["/a", "/b"],
  },
];

for (const phase of phases)
  test(`native abort during ${phase.name} settles owned work within 5,000 ms (C04/C06, T04/T06)`, async (t) => {
    await qualifyNativeAbort(t, phase);
  });

// ── C04/C06 MCP cancellation phases ────────────────────────────────────────

interface McpPhase {
  readonly name: string;
  readonly tuning?: Record<string, unknown>;
  readonly routes: (reached: () => void) => Record<string, Route>;
  readonly script: (
    reached: () => void,
    origin: string,
    cancelled: () => void,
  ) => Parameters<typeof mcpHarness>[0]["script"];
  /** Abort by caller signal (default) or by closing the whole runtime. */
  readonly by?: "signal" | "close";
}

async function qualifyMcpAbort(t: TestContext, phase: McpPhase) {
  const reached = deferred();
  const controller = new AbortController();
  let readerCancelled = false;
  let server: FixtureServer | undefined;
  let h: Awaited<ReturnType<typeof mcpHarness>> | undefined;
  let watch: ReturnType<typeof watchTransportChildren> | undefined;
  let pending: Promise<unknown> | undefined;
  try {
    server = await startFixtureServer(phase.routes(() => reached.resolve()));
    h = await mcpHarness({
      tuning: phase.tuning,
      script: phase.script(
        () => reached.resolve(),
        server.origin,
        () => {
          readerCancelled = true;
        },
      ),
    });
    watch = linux ? watchTransportChildren() : undefined;
    const before = activeResources();
    const run = h.research({ query: `mcp abort ${phase.name}` }, controller.signal);
    pending = run.catch(() => {});
    let entryTimer: NodeJS.Timeout | undefined;
    const entry = await Promise.race([
      reached.promise.then(() => "reached" as const),
      run.then(
        () => "settled" as const,
        () => "settled" as const,
      ),
      new Promise<"timeout">((resolve) => {
        entryTimer = setTimeout(() => resolve("timeout"), PHASE_ENTRY_LIMIT_MS);
      }),
    ]);
    clearTimeout(entryTimer);
    if (entry !== "reached") {
      controller.abort();
      await pending;
      throw new Error(
        `${phase.name}: phase not entered (${entry}); calls ${JSON.stringify(h.calls)}, requests ${server.requests.length}`,
      );
    }
    await delay(60);
    const childrenAtAbort = linux ? await liveTransportChildren() : [];
    const runtime = h.runtime;
    const settled = await abortAndSettle(run, () =>
      phase.by === "close" ? runtime.close("qualification close") : controller.abort(),
    );
    const observed = (await watch?.stop()) ?? [];
    const error = settled.error as
      | { code?: string; data?: FullData; execution?: { accounting: { parentDelivery: string } } }
      | undefined;
    const staging = await stagingDirectories(h.cacheRoot);
    await delay(50);
    const after = activeResources();
    const observation = {
      phase: phase.name,
      by: phase.by ?? "signal",
      abortToSettledMs: Math.round(settled.abortToSettledMs),
      reportedAbortToSettledMs: error?.data?.timing.abortToSettledMs,
      code: error?.code,
      outcome: error?.data?.outcome,
      parentDelivery: error?.execution?.accounting.parentDelivery,
      readerCancelled,
      childrenAtAbort: childrenAtAbort.length,
      childrenSpawned: observed.length,
      liveChildrenAtSettlement: settled.liveChildrenAtSettlement.length,
      serverOpenAtSettlement: server.openRequests(),
      stagingDirectoriesAfter: staging.length,
      sourceStates: error?.data?.sources.map((source) => source.state),
      resourcesBefore: before,
      resourcesAfter: after,
    };
    await recordObservation("mcp-abort", observation);
    t.diagnostic(JSON.stringify(observation));
    assert.equal(settled.value, undefined, "MCP cancellation throws a protocol-mappable error");
    assert.equal(error?.code, "CANCELLED");
    assert.equal(error?.data?.outcome, "aborted");
    assert.equal(error?.execution?.accounting.parentDelivery, "unknown");
    assert(
      settled.abortToSettledMs < CANCELLATION_TARGET_MS,
      `${phase.name}: ${settled.abortToSettledMs} ms exceeds the C06 target`,
    );
    assert.deepEqual(settled.liveChildrenAtSettlement, []);
    assert.deepEqual(staging, []);
    assert.equal(server.openRequests(), 0);
    for (const type of ["ProcessWrap", "Timeout", "FSReqPromise"])
      assert(
        (after[type] ?? 0) <= (before[type] ?? 0),
        `${type} handles grew: ${before[type] ?? 0} -> ${after[type] ?? 0}`,
      );
    return observation;
  } finally {
    controller.abort();
    await pending;
    await watch?.stop();
    await h?.cleanup();
    await server?.close();
  }
}

const mcpAnswer =
  (reached: () => void, holdRole: ModelRole | undefined, origin: string, paths: string[]) =>
  async ({ role, signal }: { role: ModelRole; signal: AbortSignal | undefined }) => {
    if (role === holdRole) {
      reached();
      return untilAborted(signal);
    }
    if (role === "search") return links(paths.map((path) => origin + path));
    if (role === "extract") return "Official docs, current.\nFacts";
    if (role === "collate") return "Answer [S1]";
    return "[]";
  };

const mcpPhases: McpPhase[] = [
  ...phases
    .filter((phase) =>
      [
        "barrier-fetch-body",
        "barrier-extract-model",
        "collate-model",
        "queued-fetch-admission",
        "pacing-wait",
        "late-drain",
      ].includes(phase.name),
    )
    .map((phase) => ({ ...phase, tuning: phase.settings })),
  {
    name: "search-model",
    routes: () => ({ "/a": pageRoute("Alpha") }),
    script: (reached, origin) => mcpAnswer(reached, "search", origin, ["/a"]),
  },
  {
    name: "stalled-provider-body",
    routes: () => ({ "/a": pageRoute("Alpha") }),
    script: (reached, origin, cancelled) => async (call) => {
      if (call.role === "search") {
        reached();
        return stalledProviderBody(cancelled);
      }
      return mcpAnswer(reached, undefined, origin, ["/a"])(call);
    },
  },
  {
    name: "fetch-body",
    routes: (reached) => ({ "/a": slowBodyRoute(reached) }),
    script: (reached, origin) => mcpAnswer(reached, undefined, origin, ["/a"]),
  },
  {
    name: "extract-model-with-body-in-flight",
    routes: () => ({ "/a": pageRoute("Alpha"), "/b": slowBodyRoute() }),
    script: (reached, origin) => mcpAnswer(reached, "extract", origin, ["/a", "/b"]),
  },
  {
    name: "runtime-close-during-fetch-body",
    by: "close",
    routes: (reached) => ({ "/a": slowBodyRoute(reached) }),
    script: (reached, origin) => mcpAnswer(reached, undefined, origin, ["/a"]),
  },
];

for (const phase of mcpPhases)
  test(`MCP abort during ${phase.name} settles owned work within 5,000 ms (C04/C06, T04/T06)`, async (t) => {
    const observation = await qualifyMcpAbort(t, phase);
    if (phase.name === "stalled-provider-body")
      assert.equal(observation.readerCancelled, true, "the provider body reader was cancelled");
  });

// ── Captured environment/executable and positive verified HTTPS ────────────

const PAGE_ENVIRONMENT = new Set([
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SYSTEMROOT",
  "WINDIR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LIBC",
  "npm_config_libc",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  // Injected by Node itself for the IPC channel, not by the adapter's policy.
  "NODE_CHANNEL_FD",
  "NODE_CHANNEL_SERIALIZATION_MODE",
]);

async function httpsFixture(t: TestContext) {
  const root = await scratch("certs");
  const certificates = await createCertificates(root);
  if (!certificates) {
    t.skip("openssl is unavailable; verified HTTPS was not qualified");
    await rm(root, { recursive: true, force: true });
    return undefined;
  }
  const server = await startFixtureServer(
    { "/a": pageRoute("Alpha"), "/b": pageRoute("Beta"), "/llms-full.txt": docsRoute() },
    certificates,
  );
  return {
    certificates,
    server,
    async close() {
      await server.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

const docsRoute = (): Route => (_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end(markdownDocument("Documentation", 50));
};

const scriptFor =
  (origin: string): ModelScript =>
  async ({ role }) =>
    role === "search"
      ? links([`${origin}/a`, `${origin}/b`])
      : role === "extract"
        ? "Official docs, current.\nFacts"
        : role === "collate"
          ? "Answer [S1] [S2]"
          : "[]";

test("native adapter consumes its captured executable and filtered environment; verified HTTPS needs the captured trust path (C19)", async (t) => {
  if (!linux) return t.skip("/proc witness unavailable");
  const tls = await httpsFixture(t);
  if (!tls) return;
  const home = await scratch("sentinel-home");
  let h: Awaited<ReturnType<typeof nativeHarness>> | undefined;
  let watch: ReturnType<typeof watchTransportChildren> | undefined;
  try {
    h = await nativeHarness({
      script: scriptFor(tls.server.origin),
      environment: {
        HOME: home,
        SSL_CERT_FILE: tls.certificates.caPath,
        SSL_CERT_DIR: undefined,
        OPENROUTER_API_KEY: "sentinel-secret-must-not-reach-pages",
        NODE_OPTIONS: "--max-old-space-size=97",
        QUALIFICATION_MARKER: "must-not-reach-pages",
      },
    });
    watch = watchTransportChildren();
    const first = (await h.research({ query: "verified https" })).details!.intelli as FullData;
    // Mutate the parent after capture: the generation must keep its captured policy.
    process.env.HOME = join(home, "changed");
    delete process.env.SSL_CERT_FILE;
    const second = (await h.research({ query: "captured after mutation" })).details!
      .intelli as FullData;
    const children = await watch.stop();
    const executable = await realpath(process.execPath);
    const observation = {
      firstOutcome: first.outcome,
      firstFetched: first.counts.fetched,
      secondOutcome: second.outcome,
      secondFetched: second.counts.fetched,
      children: children.length,
      executables: [...new Set(children.map((child) => child.exe))],
      environmentKeys: [
        ...new Set(children.flatMap((child) => Object.keys(child.environment))),
      ].sort(),
      homes: [...new Set(children.map((child) => child.environment.HOME))],
      peakChildResidentKiB: Math.max(...children.map((child) => child.peakResidentKiB)),
    };
    await recordObservation("native-environment", observation);
    t.diagnostic(JSON.stringify(observation));
    assert.equal(first.outcome, "completed", JSON.stringify(first.sources));
    assert.equal(first.counts.fetched, 2, "positive verified HTTPS through the native adapter");
    assert.equal(second.outcome, "completed", "captured trust path survives parent mutation");
    assert(children.length >= 8);
    assert.deepEqual(observation.executables, [executable]);
    assert.deepEqual(observation.homes, [home]);
    for (const key of observation.environmentKeys) assert(PAGE_ENVIRONMENT.has(key), key);
    for (const child of children) {
      assert.equal(child.environment.SSL_CERT_FILE, tls.certificates.caPath);
      assert(!("OPENROUTER_API_KEY" in child.environment));
      assert(!("NODE_OPTIONS" in child.environment));
      assert(!("QUALIFICATION_MARKER" in child.environment));
    }
  } finally {
    await watch?.stop();
    await h?.cleanup();
    await tls.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("native HTTPS without a captured trust path fails closed; NODE_EXTRA_CA_CERTS alone is characterised (C19)", async (t) => {
  const tls = await httpsFixture(t);
  if (!tls) return;
  const outcomes: Record<string, unknown> = {};
  try {
    for (const [name, environment] of [
      [
        "no-trust",
        { SSL_CERT_FILE: undefined, SSL_CERT_DIR: undefined, NODE_EXTRA_CA_CERTS: undefined },
      ],
      [
        "node-extra-ca-only",
        {
          SSL_CERT_FILE: undefined,
          SSL_CERT_DIR: undefined,
          NODE_EXTRA_CA_CERTS: tls.certificates.caPath,
        },
      ],
    ] as const) {
      const h = await nativeHarness({ script: scriptFor(tls.server.origin), environment });
      try {
        const data = (await h.research({ query: name })).details!.intelli as FullData;
        outcomes[name] = {
          outcome: data.outcome,
          states: data.sources.map((source) => `${source.state}:${source.diagnostic ?? ""}`),
        };
      } finally {
        await h.cleanup();
      }
    }
    await recordObservation("native-trust-negative", outcomes);
    t.diagnostic(JSON.stringify(outcomes));
    assert.equal((outcomes["no-trust"] as { outcome: string }).outcome, "fetch-failed");
    // Observed limitation: the allow-listed Node-only variable does not reach BoringSSL.
    assert.equal((outcomes["node-extra-ca-only"] as { outcome: string }).outcome, "fetch-failed");
  } finally {
    await tls.close();
  }
});

test("MCP adapter consumes its explicit env option, never the secret, and fetches verified HTTPS (C19)", async (t) => {
  if (!linux) return t.skip("/proc witness unavailable");
  const tls = await httpsFixture(t);
  if (!tls) return;
  const home = await scratch("mcp-home");
  let h: Awaited<ReturnType<typeof mcpHarness>> | undefined;
  let watch: ReturnType<typeof watchTransportChildren> | undefined;
  try {
    h = await mcpHarness({
      script: async (call) => scriptFor(tls.server.origin)(call),
      env: {
        FIXTURE_KEY: "fixture-secret-never-in-page-children",
        PATH: process.env.PATH,
        HOME: home,
        TMPDIR: process.env.TMPDIR,
        SSL_CERT_FILE: tls.certificates.caPath,
        QUALIFICATION_MARKER: "must-not-reach-pages",
      },
    });
    watch = watchTransportChildren();
    const result = await h.research({ query: "mcp verified https" });
    const children = await watch.stop();
    const data = result.data as FullData;
    const observation = {
      outcome: data.outcome,
      fetched: data.counts.fetched,
      children: children.length,
      environmentKeys: [
        ...new Set(children.flatMap((child) => Object.keys(child.environment))),
      ].sort(),
    };
    await recordObservation("mcp-environment", observation);
    t.diagnostic(JSON.stringify(observation));
    assert.equal(data.outcome, "completed", JSON.stringify(data.sources));
    assert.equal(data.counts.fetched, 2);
    assert(children.length >= 4);
    for (const child of children) {
      assert.equal(child.exe, await realpath(process.execPath));
      assert.equal(child.environment.HOME, home, "the option, not process.env, is consumed");
      assert(!("FIXTURE_KEY" in child.environment));
      assert(!("QUALIFICATION_MARKER" in child.environment));
      for (const key of Object.keys(child.environment)) assert(PAGE_ENVIRONMENT.has(key), key);
    }
  } finally {
    await watch?.stop();
    await h?.cleanup();
    await tls.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("native captured proxy carries verified HTTPS pages and bounded documentation discovery (C09/C19)", async (t) => {
  const tls = await httpsFixture(t);
  if (!tls) return;
  const proxy = await startRoutingProxy(tls.server);
  const observations: Record<string, unknown>[] = [];
  try {
    // Discovery runs beside the page phase and is cancelled at finalisation
    // (C09). Characterise both an instant collation and one taking 1,500 ms.
    for (const collateDelayMs of [0, 1_500]) {
      const connectsBefore = proxy.connects.length;
      const docsBefore = tls.server.requests.filter((r) => r.path === "/llms-full.txt").length;
      const h = await nativeHarness({
        script: async (call) => {
          if (call.role === "collate") await delay(collateDelayMs);
          return scriptFor(tls.server.origin)(call);
        },
        settings: { disableLlmsFullDiscovery: false },
        topLevel: { httpProxy: proxy.url },
        environment: { SSL_CERT_FILE: tls.certificates.caPath },
      });
      try {
        const data = (await h.research({ query: `proxied discovery ${collateDelayMs}` })).details!
          .intelli as FullData;
        const runDirectory = await findRunDirectory(h.cacheRoot);
        const sources = runDirectory ? await readdir(join(runDirectory, "sources")) : [];
        const connects = proxy.connects.slice(connectsBefore);
        observations.push({
          collateDelayMs,
          outcome: data.outcome,
          fetched: data.counts.fetched,
          connects,
          docsRequests:
            tls.server.requests.filter((r) => r.path === "/llms-full.txt").length - docsBefore,
          sources,
          diagnostics: data.cache.status !== "not-requested" ? data.cache.diagnostic : undefined,
          stagingAfter: (await stagingDirectories(h.cacheRoot)).length,
        });
        assert.equal(data.outcome, "completed");
        assert(connects.includes(`127.0.0.1:${tls.server.port}`), "pages used the captured proxy");
        assert.deepEqual(await stagingDirectories(h.cacheRoot), []);
      } finally {
        await h.cleanup();
      }
    }
    await recordObservation("native-proxy-discovery", { observations });
    t.diagnostic(JSON.stringify(observations));
    const slow = observations[1] as { connects: string[]; sources: string[] };
    assert(slow.connects.includes("127.0.0.1:443"), "discovery used the captured proxy");
    assert(
      slow.sources.some((name) => name.startsWith("llms-full-")),
      "discovered document published",
    );
  } finally {
    await proxy.close();
    await tls.close();
  }
});

async function findRunDirectory(cacheRoot: string, operationId?: string) {
  const runs = join(cacheRoot, ".intelli-v1", "runs");
  const names = (await readdir(runs).catch(() => [] as string[])).sort();
  if (!operationId) return names.length ? join(runs, names.at(-1)!) : undefined;
  for (const name of names) {
    const reservation = await readFile(join(runs, name, "reservation.json"), "utf8").catch(
      () => "",
    );
    if (reservation.includes(operationId)) return join(runs, name);
  }
  return undefined;
}

// ── C19/T19 decoded byte limits through the real process transport ─────────

const LIMIT = 65_536;
/** HTML of exactly `bytes` bytes (at least 48). */
const filler = (bytes: number) => {
  const head = "<!doctype html><html><body><p>";
  const tail = "</p></body></html>";
  return Buffer.from(`${head}${"a".repeat(bytes - head.length - tail.length)}${tail}`);
};

const encoded = (encoding: "gzip" | "br" | "deflate" | "zstd", decodedBytes: number): Route => {
  // Compress once, outside the request, so timings measure the client only.
  const body = filler(decodedBytes);
  const compressed =
    encoding === "gzip"
      ? gzipSync(body)
      : encoding === "br"
        ? brotliCompressSync(body)
        : encoding === "deflate"
          ? deflateSync(body)
          : zstdCompressSync(body);
  return (_req, res) => {
    res.writeHead(200, {
      "content-type": "text/html",
      "content-encoding": encoding,
      "content-length": String(compressed.byteLength),
    });
    res.end(compressed);
  };
};

/** No Content-Length and no chunking: the body ends when the connection closes. */
const closeDelimited =
  (total: number): Route =>
  async (req, _res, record) => {
    const socket = req.socket;
    socket.write("HTTP/1.1 200 OK\r\ncontent-type: text/html\r\nconnection: close\r\n\r\n<p>");
    const piece = Buffer.alloc(4096, "a");
    for (let sent = 0; sent < total && !socket.destroyed; sent += piece.byteLength) {
      if (!socket.write(piece))
        await new Promise((resolve) => {
          socket.once("drain", resolve);
          socket.once("close", resolve);
        });
      record.bytesWritten += piece.byteLength;
    }
    socket.end();
  };

const chunked =
  (total: number): Route =>
  async (_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    await drip(res, { total, chunk: 4096, intervalMs: 0 });
  };

const exact =
  (bytes: number, declared = bytes): Route =>
  (_req, res) => {
    res.writeHead(200, { "content-type": "text/html", "content-length": String(declared) });
    res.end(filler(bytes));
  };

test("decoded identity/chunked/close-delimited/compressed bodies obey the byte limit in real children (C19, T19)", async (t) => {
  const bomb = 64 * 1024 * 1024;
  const server = await startFixtureServer({
    "/exact": exact(LIMIT),
    "/declared-over": exact(LIMIT + 1),
    "/chunked-over": chunked(1024 * 1024),
    "/close-over": closeDelimited(1024 * 1024),
    "/gzip-ok": encoded("gzip", LIMIT - 1024),
    "/gzip-bomb": encoded("gzip", bomb),
    "/br-bomb": encoded("br", bomb),
    "/deflate-bomb": encoded("deflate", bomb),
    "/zstd-bomb": encoded("zstd", bomb),
  });
  let f: Awaited<ReturnType<typeof fetchServiceHarness>> | undefined;
  const results: Record<string, unknown> = {};
  try {
    f = await fetchServiceHarness({ execution: { fetchMaxResponseBytes: LIMIT } });
    for (const path of [
      "/exact",
      "/declared-over",
      "/chunked-over",
      "/close-over",
      "/gzip-ok",
      "/gzip-bomb",
      "/br-bomb",
      "/deflate-bomb",
      "/zstd-bomb",
    ]) {
      const watch = linux ? watchTransportChildren(2) : undefined;
      const firstRequest = server.requests.length;
      const started = performance.now();
      const [page] = await f.fetchAll([`${server.origin}${path}`]);
      const elapsedMs = Math.round(performance.now() - started);
      const children = (await watch?.stop()) ?? [];
      const requests = server.requests.slice(firstRequest);
      results[path] = {
        state: page.page.state,
        diagnostic: page.page.diagnostic,
        contentChars: page.page.content?.length,
        transferredBytes: page.transferredBytes,
        compressedBytes: requests.map((r) => r.bytesWritten),
        physicalRequests: requests.length,
        serverBytesWritten: requests.map((r) => r.bytesWritten),
        clientClosedEarly: requests.map((r) => r.clientClosedEarly),
        childPeakResidentKiB: children.map((child) => child.peakResidentKiB),
        liveChildrenAfter: linux ? (await liveTransportChildren()).length : undefined,
        elapsedMs,
      };
    }
    await recordObservation("byte-limits", results);
    t.diagnostic(JSON.stringify(results));
    const at = (path: string) =>
      results[path] as {
        state: string;
        diagnostic?: string;
        transferredBytes: number;
        liveChildrenAfter?: number;
      };
    assert.equal(at("/exact").state, "fetched", "exactly the limit is accepted");
    assert.equal(at("/gzip-ok").state, "fetched", "decoded body under the limit is accepted");
    for (const path of [
      "/declared-over",
      "/chunked-over",
      "/close-over",
      "/gzip-bomb",
      "/br-bomb",
      "/deflate-bomb",
      "/zstd-bomb",
    ]) {
      assert.equal(at(path).state, "fetch-failed", path);
      assert.equal(at(path).diagnostic, "RESPONSE_TOO_LARGE", path);
    }
    for (const path of Object.keys(results)) {
      assert(
        at(path).transferredBytes <= 3 * (LIMIT + 65_536),
        `${path} decoded bytes stay bounded`,
      );
      if (linux) assert.equal(at(path).liveChildrenAfter, 0, path);
    }
  } finally {
    await f?.cleanup();
    await server.close();
  }
});

test("returned-character truncation is labelled separately from oversize rejection (C19, T19)", async (t) => {
  const server = await startFixtureServer({ "/a": pageRoute("Alpha", 4_000) });
  let f: Awaited<ReturnType<typeof fetchServiceHarness>> | undefined;
  try {
    f = await fetchServiceHarness({ execution: { fetchMaxChars: 500 } });
    const [configured] = await f.fetchAll([`${server.origin}/a`]);
    const [narrower] = await f.fetchAll([`${server.origin}/a`], 100);
    const [wider] = await f.fetchAll([`${server.origin}/a`], 10_000);
    const observation = {
      configured: { length: configured.page.content?.length, truncated: configured.page.truncated },
      narrower: { length: narrower.page.content?.length, truncated: narrower.page.truncated },
      wider: { length: wider.page.content?.length, truncated: wider.page.truncated },
    };
    t.diagnostic(JSON.stringify(observation));
    await recordObservation("truncation", observation);
    assert.equal(configured.page.state, "fetched");
    assert.equal(configured.page.truncated, true);
    assert(configured.page.content!.length <= 500);
    assert(narrower.page.content!.length <= 100);
    assert(
      wider.page.content!.length <= 500,
      "per-call maxChars cannot enlarge the configured bound",
    );
    assert.equal(configured.page.diagnostic, undefined, "truncation is not a rejection");
  } finally {
    await f?.cleanup();
    await server.close();
  }
});

test("aggregate fetch permits are held through body settlement in real children (C12/C19, T19)", async (t) => {
  for (const aggregate of [1, 2]) {
    let server: FixtureServer | undefined;
    let f: Awaited<ReturnType<typeof fetchServiceHarness>> | undefined;
    try {
      server = await startFixtureServer({
        "*": async (_req, res) => {
          res.writeHead(200, { "content-type": "text/html" });
          await drip(res, { total: 64 * 1024, chunk: 4096, intervalMs: 10 });
        },
      });
      f = await fetchServiceHarness({ execution: { aggregateFetchConcurrency: aggregate } });
      const peakChildren = linux
        ? samplePopulation(async () => (await liveTransportChildren()).length, 2)
        : undefined;
      const origin = server.origin;
      await f.fetchAll([1, 2, 3].map((i) => `${origin}/p${i}`));
      const childrenPeak = await peakChildren?.stop();
      const observation = {
        aggregate,
        physicalRequests: server.requests.length,
        serverPeakConcurrent: server.maxConcurrent(),
        childrenPeak,
      };
      t.diagnostic(JSON.stringify(observation));
      await recordObservation("fetch-permits", observation);
      assert(server.maxConcurrent() <= aggregate, `${server.maxConcurrent()} > ${aggregate}`);
      if (childrenPeak !== undefined) assert(childrenPeak <= aggregate, `children ${childrenPeak}`);
    } finally {
      await f?.cleanup();
      await server?.close();
    }
  }
});

// ── C19 retained bodies versus staged disk population ──────────────────────

test("barrier and streaming bound concurrent page bodies by fetchConcurrency; staged disk population is the whole candidate set (C19, T19)", async (t) => {
  const pages = 6;
  const paths = Array.from({ length: pages }, (_, i) => `/p${i + 1}`);
  const results: Record<string, unknown>[] = [];
  for (const pageExecution of ["barrier", "streaming"] as const) {
    let server: FixtureServer | undefined;
    let h: Awaited<ReturnType<typeof nativeHarness>> | undefined;
    let staged: ReturnType<typeof samplePopulation> | undefined;
    try {
      server = await startFixtureServer(
        Object.fromEntries(
          paths.map((path) => [
            path,
            async (req: IncomingMessage, res: ServerResponse) => {
              const markdown = String(req.headers.accept ?? "").includes("text/markdown");
              res.writeHead(200, { "content-type": markdown ? "text/markdown" : "text/html" });
              await drip(res, { total: 32 * 1024, chunk: 4096, intervalMs: 5, fill: "b" });
            },
          ]),
        ),
      );
      const origin = server.origin;
      let extracting = 0;
      let peakExtracting = 0;
      h = await nativeHarness({
        settings: {
          fetchConcurrency: 2,
          extractionConcurrency: 2,
          maxUrls: pages,
          execution: { pageExecution, aggregateFetchConcurrency: 8 },
        },
        script: async ({ role }) => {
          if (role === "search") return links(paths.map((path) => origin + path));
          if (role === "extract") {
            peakExtracting = Math.max(peakExtracting, ++extracting);
            await delay(40);
            extracting--;
            return "Official docs, current.\nFacts";
          }
          if (role === "collate") return "Answer [S1]";
          return "[]";
        },
      });
      const cacheRoot = h.cacheRoot;
      staged = samplePopulation(async () => (await stagingFiles(cacheRoot)).length, 2);
      const data = (await h.research({ query: `population ${pageExecution}` })).details!
        .intelli as FullData;
      const peakStaged = await staged.stop();
      const observation = {
        pageExecution,
        outcome: data.outcome,
        fetched: data.counts.fetched,
        peakStagedFiles: peakStaged,
        peakConcurrentPagePaths: server.maxConcurrentPaths(),
        peakConcurrentPhysical: server.maxConcurrent(),
        peakExtracting,
        stagingAfter: (await stagingDirectories(cacheRoot)).length,
      };
      results.push(observation);
      assert.equal(data.outcome, "completed");
      assert.equal(data.counts.fetched, pages);
      assert(
        server.maxConcurrentPaths() <= 2,
        "at most fetchConcurrency pages hold bodies at once",
      );
      assert.equal(observation.stagingAfter, 0);
      // Staged files are kept for commit in both modes: disk population is the
      // candidate set; only in-memory retained bodies are slot-bounded.
      assert.equal(peakStaged, pages, "every fetched page is staged on disk until commit");
    } finally {
      await staged?.stop();
      await h?.cleanup();
      await server?.close();
    }
  }
  await recordObservation("retained-vs-disk", { results });
  t.diagnostic(JSON.stringify(results));
});

test("parent memory while accepting and parsing one near-limit page is observed, not capped (C19)", async (t) => {
  // Default 8 MiB decoded limit; the page is just below it.
  const size = 8_388_608 - 4096;
  const words = Buffer.alloc(size - 64, "lorem ipsum ");
  const html = Buffer.concat([
    Buffer.from("<!doctype html><html><body><article><p>"),
    words,
    Buffer.from("</p></article></body></html>"),
  ]).subarray(0, size);
  let server: FixtureServer | undefined;
  let f: Awaited<ReturnType<typeof fetchServiceHarness>> | undefined;
  try {
    server = await startFixtureServer({
      "/large": (_req, res) => {
        res.writeHead(200, {
          "content-type": "text/html",
          "content-length": String(html.byteLength),
        });
        res.end(html);
      },
    });
    f = await fetchServiceHarness({});
    const watch = linux ? watchTransportChildren(2) : undefined;
    const memory = sampleMemory(1);
    const started = performance.now();
    const [page] = await f.fetchAll([`${server.origin}/large`]);
    const elapsedMs = Math.round(performance.now() - started);
    const sampled = memory.stop();
    const children = (await watch?.stop()) ?? [];
    const mib = (bytes: number) => Math.round((bytes / 1_048_576) * 10) / 10;
    const observation = {
      acceptedBytes: html.byteLength,
      state: page.page.state,
      diagnostic: page.page.diagnostic,
      returnedChars: page.page.content?.length,
      truncated: page.page.truncated,
      transferredBytes: page.transferredBytes,
      elapsedMs,
      heapGrowthMiB: mib(sampled.peakHeap - sampled.baseHeap),
      rssGrowthMiB: mib(sampled.peakRss - sampled.baseRss),
      peakExternalMiB: mib(sampled.peakExternal),
      childPeakResidentKiB: children.map((child) => child.peakResidentKiB),
    };
    await recordObservation("large-page-memory", observation);
    t.diagnostic(JSON.stringify(observation));
    assert.equal(page.page.state, "fetched");
    assert.equal(page.page.truncated, true, "returned characters are clamped to fetchMaxChars");
  } finally {
    await f?.cleanup();
    await server?.close();
  }
});

test(
  "parent memory with default fetchConcurrency near-limit pages in flight (C19, opt-in observation)",
  { skip: process.env.QUALIFICATION_HEAVY === "1" ? false : "set QUALIFICATION_HEAVY=1" },
  async (t) => {
    const size = 8_388_608 - 4096;
    const html = Buffer.concat([
      Buffer.from("<!doctype html><html><body><article><p>"),
      Buffer.alloc(size, "lorem ipsum "),
    ]).subarray(0, size);
    let server: FixtureServer | undefined;
    let f: Awaited<ReturnType<typeof fetchServiceHarness>> | undefined;
    try {
      server = await startFixtureServer({
        "*": (_req, res) => {
          res.writeHead(200, { "content-type": "text/html", "content-length": String(size) });
          res.end(html);
        },
      });
      f = await fetchServiceHarness({});
      const origin = server.origin;
      const memory = sampleMemory(1);
      const started = performance.now();
      const results = await f.fetchAll([1, 2, 3, 4].map((i) => `${origin}/large${i}`));
      const elapsedMs = Math.round(performance.now() - started);
      const sampled = memory.stop();
      const mib = (bytes: number) => Math.round((bytes / 1_048_576) * 10) / 10;
      const observation = {
        pages: results.length,
        acceptedBytesPerPage: size,
        states: results.map((r) => r.page.state),
        physicalRequests: server.requests.length,
        elapsedMs,
        heapGrowthMiB: mib(sampled.peakHeap - sampled.baseHeap),
        rssGrowthMiB: mib(sampled.peakRss - sampled.baseRss),
        peakExternalMiB: mib(sampled.peakExternal),
      };
      await recordObservation("large-page-memory-concurrent", observation);
      t.diagnostic(JSON.stringify(observation));
      assert(results.every((r) => r.page.state === "fetched"));
    } finally {
      await f?.cleanup();
      await server?.close();
    }
  },
);

// ── C22 post-suggestion accounting through the real store ──────────────────

test("published accounting covers the suggestion attempt and matches returned attempts (C04/C22)", async (t) => {
  let server: FixtureServer | undefined;
  let h: Awaited<ReturnType<typeof nativeHarness>> | undefined;
  try {
    server = await startFixtureServer({ "/a": pageRoute("Alpha") });
    const origin = server.origin;
    h = await nativeHarness({
      script: async ({ role }) =>
        role === "search"
          ? links([`${origin}/a`])
          : role === "extract"
            ? "Official docs, current.\nFacts"
            : role === "collate"
              ? "Answer [S1]"
              : "[]",
    });
    await h.research({ query: "first committed query" });
    const second = (await h.research({ query: "second related query" })).details!
      .intelli as FullData;
    assert.equal(second.cache.status, "committed");
    const accountingPath =
      second.cache.status === "committed" ? second.cache.accountingPath : undefined;
    assert(accountingPath, "accounting recorded after suggestions");
    const runDirectory = await findRunDirectory(h.cacheRoot, second.operationId);
    const persisted = JSON.parse(
      await readFile(join(runDirectory!, "accounting.json"), "utf8"),
    ) as { attempts: { role: string }[]; summary: { attempts: number } };
    const observation = {
      returnedRoles: second.attempts.map((attempt) => attempt.role),
      persistedRoles: persisted.attempts.map((record) => record.role),
      persistedAttempts: persisted.summary.attempts,
      returnedAttempts: second.accounting.attempts,
    };
    await recordObservation("post-suggestion-accounting", observation);
    t.diagnostic(JSON.stringify(observation));
    assert(observation.returnedRoles.includes("suggest"));
    assert.deepEqual(observation.persistedRoles, observation.returnedRoles);
    assert.equal(observation.persistedAttempts, observation.returnedAttempts);
  } finally {
    await h?.cleanup();
    await server?.close();
  }
});

// ── C06/C22 publication and suggestion edges ───────────────────────────────

test("abort at the publication edge and during post-commit suggestions settles within 5,000 ms (C06/C22, T06)", async (t) => {
  const observations: Record<string, unknown>[] = [];
  for (const edge of ["publication-start", "suggest-model"] as const) {
    let server: FixtureServer | undefined;
    let h: Awaited<ReturnType<typeof nativeHarness>> | undefined;
    const controller = new AbortController();
    let abortedAt: number | undefined;
    let holdSuggest = false;
    try {
      server = await startFixtureServer({ "/a": pageRoute("Alpha") });
      const origin = server.origin;
      h = await nativeHarness({
        script: async ({ role, signal }) => {
          if (role === "search") return links([`${origin}/a`]);
          if (role === "extract") return "Official docs, current.\nFacts";
          if (role === "collate") return "Answer [S1]";
          if (holdSuggest) {
            abortedAt = performance.now();
            controller.abort();
            return untilAborted(signal);
          }
          return "[]";
        },
        onUpdate: (update) => {
          const event = (update as { details?: Partial<Progress> }).details;
          if (
            edge === "publication-start" &&
            !controller.signal.aborted &&
            event?.stage === "cache" &&
            event.event === "start"
          ) {
            abortedAt = performance.now();
            controller.abort();
          }
        },
      });
      // A prior committed run makes the suggestion judge actually run.
      if (edge === "suggest-model") await h.research({ query: "earlier committed query" });
      holdSuggest = edge === "suggest-model";
      const result = await h.research({ query: `edge ${edge}` }, controller.signal);
      const settledMs = performance.now() - abortedAt!;
      const data = result.details!.intelli as FullData;
      const runDirectory = await findRunDirectory(h.cacheRoot, data.operationId);
      const files = runDirectory ? (await readdir(runDirectory)).sort() : [];
      const observation = {
        edge,
        abortToSettledMs: Math.round(settledMs),
        outcome: data.outcome,
        cache: data.cache.status,
        runFiles: files,
        roles: data.attempts.map((attempt) => attempt.role),
        stagingAfter: (await stagingDirectories(h.cacheRoot)).length,
        liveChildren: linux ? (await liveTransportChildren()).length : undefined,
      };
      observations.push(observation);
      assert.equal(data.outcome, "aborted");
      assert(settledMs < CANCELLATION_TARGET_MS);
      assert.equal(observation.stagingAfter, 0);
      assert(!files.includes("accounting.json"), "no accounting write starts after abort");
      if (edge === "publication-start")
        assert(!files.includes("committed.json"), "cancellation before marker publishes nothing");
      else assert(files.includes("committed.json"), "a committed report survives a later abort");
    } finally {
      controller.abort();
      await h?.cleanup();
      await server?.close();
    }
  }
  await recordObservation("publication-edges", { observations });
  t.diagnostic(JSON.stringify(observations));
});

test("MCP publication and post-commit suggestion cancellation settle within 5,000 ms (C06/C22, T06)", async (t) => {
  const observations: Record<string, unknown>[] = [];
  for (const edge of ["publication-start", "suggest-model"] as const) {
    const controller = new AbortController();
    let h: Awaited<ReturnType<typeof mcpHarness>> | undefined;
    let server: FixtureServer | undefined;
    let abortedAt: number | undefined;
    let holdSuggest = false;
    try {
      server = await startFixtureServer({ "/a": pageRoute("Alpha") });
      const origin = server.origin;
      h = await mcpHarness({
        script: async ({ role, signal }) => {
          if (role === "search") return links([`${origin}/a`]);
          if (role === "extract") return "Official docs, current.\nFacts";
          if (role === "collate") return "Answer [S1]";
          if (holdSuggest) {
            abortedAt = performance.now();
            controller.abort();
            return untilAborted(signal);
          }
          return "[]";
        },
      });
      if (edge === "suggest-model") await h.research({ query: "earlier committed query" });
      holdSuggest = edge === "suggest-model";
      const error = await h.runtime
        .execute(
          "intelli_research",
          { query: `edge ${edge}` },
          {
            signal: controller.signal,
            onProgress(event) {
              if (
                edge === "publication-start" &&
                !controller.signal.aborted &&
                event.stage === "cache" &&
                event.event === "start"
              ) {
                abortedAt = performance.now();
                controller.abort();
              }
            },
          },
        )
        .then(
          () => undefined,
          (error: { code: string; data: FullData }) => error,
        );
      const settledMs = performance.now() - abortedAt!;
      assert(error, "cancelled MCP call must not succeed");
      const data = error.data;
      const runDirectory = await findRunDirectory(h.cacheRoot, data.operationId);
      const files = runDirectory ? (await readdir(runDirectory)).sort() : [];
      assert.equal(error.code, "CANCELLED");
      assert.equal(data.outcome, "aborted");
      assert.equal(data.accounting.parentDelivery, "unknown");
      assert(settledMs < CANCELLATION_TARGET_MS);
      assert.deepEqual(await stagingDirectories(h.cacheRoot), []);
      assert(!files.includes("accounting.json"));
      assert.equal(files.includes("committed.json"), edge === "suggest-model");
      const liveChildren = linux ? await liveTransportChildren() : [];
      assert.deepEqual(liveChildren, []);
      observations.push({
        edge,
        abortToSettledMs: Math.round(settledMs),
        outcome: data.outcome,
        runFiles: files,
      });
    } finally {
      controller.abort();
      await h?.cleanup();
      await server?.close();
    }
  }
  await recordObservation("mcp-publication-edges", { observations });
  t.diagnostic(JSON.stringify(observations));
});

// ── C04/C06 native citation (fetch-tee) reader ownership ───────────────────
//
// The search call runs the installed SDK's openai-completions stream against a
// loopback SSE server through native callLlm(), so the real citation fetch
// wrapper tees the provider body. Base 1b199f3 reproduces a reader that is not
// owned by settlement; the coordinator delta adds owned sink settlement. Run
// with QUALIFICATION_ANNOTATION_STRICT=1 on a candidate expected to pass.

const strictAnnotations = true;

const sseChunk = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
/** One content chunk with a url_citation; optionally [DONE]; then keeps the body open. */
const sseRoute =
  (pageUrl: () => string, finish: boolean, entered?: () => void): Route =>
  async (req, res, _record, server) => {
    req.resume();
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(
      sseChunk({
        id: "c1",
        object: "chat.completion.chunk",
        created: 0,
        model: "fixture",
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
              content: `[Source](${pageUrl()})`,
              annotations: [
                { type: "url_citation", url_citation: { url: pageUrl(), title: "Source" } },
              ],
            },
            finish_reason: null,
          },
        ],
      }),
    );
    if (finish) {
      res.write(
        sseChunk({
          id: "c1",
          object: "chat.completion.chunk",
          created: 0,
          model: "fixture",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        }),
      );
      res.write("data: [DONE]\n\n");
    }
    entered?.();
    // A provider/proxy that keeps the body open after the final event.
    await Promise.race([server.released, new Promise((resolve) => res.once("close", resolve))]);
    if (!res.destroyed) res.destroy();
  };

for (const scenario of ["timeout-stalled-stream", "abort-mid-stream"] as const)
  test(`native citation tee reader is settled before the operation returns: ${scenario} (C04/C06, T04/T06)`, async (t) => {
    const { streamSimple } = await import("@earendil-works/pi-ai/api/openai-completions");
    // Remote TCP close delivery is separate from the actual client reader lifecycle.
    const fetch = globalThis.fetch.bind(globalThis);
    let clones = 0;
    const readers: Array<{ pendingReads: number; pendingCancels: number; released: boolean }> = [];
    t.mock.method(globalThis, "fetch", async (...args: Parameters<typeof fetch>) => {
      const response = await fetch(...args);
      const clone = response.clone.bind(response);
      response.clone = () => {
        clones++;
        const branch = clone();
        if (branch.body) {
          const getReader = branch.body.getReader.bind(branch.body);
          branch.body.getReader = (() => {
            const reader = getReader();
            const state = { pendingReads: 0, pendingCancels: 0, released: false };
            readers.push(state);
            const read = reader.read.bind(reader);
            const cancel = reader.cancel.bind(reader);
            const release = reader.releaseLock.bind(reader);
            reader.read = async () => {
              state.pendingReads++;
              try {
                return await read();
              } finally {
                state.pendingReads--;
              }
            };
            reader.cancel = async (reason?: unknown) => {
              state.pendingCancels++;
              try {
                await cancel(reason);
              } finally {
                state.pendingCancels--;
              }
            };
            reader.releaseLock = () => {
              release();
              state.released = true;
            };
            return reader;
          }) as typeof branch.body.getReader;
        }
        return branch;
      };
      return response;
    });
    const entered = deferred();
    const controller = new AbortController();
    let server: FixtureServer | undefined;
    let h: Awaited<ReturnType<typeof nativeHarness>> | undefined;
    let pending: Promise<unknown> | undefined;
    try {
      let origin = "";
      server = await startFixtureServer({
        "/a": pageRoute("Alpha"),
        "/v1/chat/completions": sseRoute(
          () => `${origin}/a`,
          false,
          () => entered.resolve(),
        ),
      });
      origin = server.origin;
      const model = {
        id: "fixture",
        name: "fixture",
        api: "openai-completions",
        provider: "openrouter",
        baseUrl: `${origin}/v1`,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 100_000,
        maxTokens: 1_000,
      };
      h = await nativeHarness({
        provider: (role, context, options) =>
          role === "search"
            ? streamSimple(model as never, context as never, options).result()
            : undefined,
        script: async ({ role }) =>
          role === "extract"
            ? "Official docs, current.\nFacts"
            : role === "collate"
              ? "Answer [S1]"
              : "[]",
        // The installed SDK reads to EOF, not [DONE]; the attempt timeout ends a stall.
        settings: { llmTimeoutMs: 1_000 },
      });
      const sse = () =>
        server!.requests.filter((r) => r.path === "/v1/chat/completions" && r.endedMs === undefined)
          .length;
      const started = performance.now();
      const run = h.research({ query: `annotation ${scenario}` }, controller.signal);
      pending = run.catch(() => {});
      let settledMs: number;
      let result: Awaited<typeof run>;
      if (scenario === "abort-mid-stream") {
        await entered.promise;
        await delay(50);
        const settled = await abortAndSettle(run, () => controller.abort());
        settledMs = settled.abortToSettledMs;
        result = settled.value as Awaited<typeof run>;
      } else {
        result = await run;
        settledMs = performance.now() - started;
      }
      const settledAt = performance.now();
      const openAtSettlement = sse();
      const readersAtSettlement = readers.map((reader) => ({ ...reader }));
      const lagStart = performance.now();
      while (sse() && performance.now() - lagStart < 3_000) await delay(10);
      const data = result?.details?.intelli as FullData | undefined;
      const observation = {
        scenario,
        strict: strictAnnotations,
        outcome: data?.outcome,
        searchLinks: data?.sources.length,
        settledMs: Math.round(settledMs),
        sseOpenAtSettlement: openAtSettlement,
        clones,
        readersAtSettlement,
        sseStillOpenAfter3s: sse(),
        sseCloseLagAfterSettlementMs: Math.round(performance.now() - lagStart),
        // Negative: the provider request closed before the operation returned.
        sseEndedRelativeToSettlementMs: server.requests
          .filter((r) => r.path === "/v1/chat/completions")
          .map((r) =>
            r.endedMs === undefined ? null : Math.round((r.endedMs - settledAt) * 10) / 10,
          ),
      };
      await recordObservation("annotation-reader", observation);
      t.diagnostic(JSON.stringify(observation));
      assert(clones > 0, "the real fetch-tee fallback was exercised");
      assert.equal(
        readersAtSettlement.length,
        clones,
        "every clone has an explicitly owned reader",
      );
      assert(
        readersAtSettlement.every(
          (reader) => reader.released && reader.pendingReads === 0 && reader.pendingCancels === 0,
        ),
        "every actual annotation reader and independent cancellation settled before return",
      );
      assert.equal(sse(), 0, "the remote fixture eventually observed transport closure");
      assert(settledMs < CANCELLATION_TARGET_MS);
    } finally {
      controller.abort();
      await pending;
      await h?.cleanup();
      await server?.close();
    }
  });
