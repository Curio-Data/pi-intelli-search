// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { it } from "node:test";
import childProcess from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFetchClient, type FetchClientOptions } from "../src/core/fetch-client.js";
import { createExecutionCoordinator } from "../src/core/execution-coordinator.js";
import { createAttemptLedger } from "../src/core/usage.js";
import { fetchPage } from "../src/core/operations/fetch.js";
import { createSystemClock } from "../src/core/clock.js";
import { createProcessPageTransport } from "../src/core/page-transport.js";
import { capturePageFetchFactory, capturePageEnvironment } from "../src/core/page-runtime.js";
import { parseExecutionSettings } from "../src/core/execution-settings.js";
import { coreContext } from "./helpers/core-context.js";
import type { PageTransport, PageTransportResponse } from "../src/core/contracts.js";

const flush = () => new Promise<void>((done) => setImmediate(done));
function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function response(
  text: string,
  type = "text/markdown",
  extra: Partial<PageTransportResponse> = {},
): PageTransportResponse {
  return {
    status: 200,
    url: "https://example.com/page",
    headers: new Headers({ "content-type": type }),
    body: new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(text));
        c.close();
      },
    }),
    ...extra,
  };
}
function setup(
  transport: PageTransport,
  overrides: Partial<FetchClientOptions> = {},
  fetchConcurrency = 1,
) {
  const clock = overrides.clock ?? createSystemClock();
  const coordinator = createExecutionCoordinator({
    clock,
    generation: 1,
    modelConcurrency: 2,
    criticalReserve: 1,
    fetchConcurrency,
    minRequestIntervalMs: 0,
  });
  const operation = coordinator.begin("fetch-test");
  const client = createFetchClient({
    operation,
    clock,
    transport,
    browser: "chrome_145",
    timeoutMs: 20_000,
    concurrency: 2,
    maxResponseBytes: 65_536,
    docsMaxResponseBytes: 65_536,
    maxChars: 500_000,
    ...overrides,
  });
  return { client, operation, coordinator, clock };
}

it("dual fetch and alternate probes obey cap one without an outer-permit deadlock", async () => {
  let active = 0,
    peak = 0;
  const calls: string[] = [];
  const s = setup(async (url, request) => {
    active++;
    peak = Math.max(peak, active);
    calls.push(url + request.headers.Accept);
    assert.equal(s.coordinator.snapshot().activeFetches, 1);
    await flush();
    active--;
    if (url.endsWith("doc.md")) return response("# Better\n\n" + "evidence\n".repeat(200));
    return response(
      '<html><head><title>Original</title><link rel="alternate" type="text/markdown" href="doc.md"></head><body><p>Small body</p></body></html>',
      "text/html",
    );
  });
  const result = await s.client.fetch({ url: "https://example.com/page" }, s.operation, {
    pageId: "S7",
  });
  assert.equal(result.page.id, "S7");
  assert.equal(result.page.title, "Better");
  assert.equal(result.page.sourceType, "markdown");
  assert.equal(calls.length, 4);
  assert.equal(peak, 1);
  assert(result.transferredBytes > 0);
  await s.operation.settle();
  assert.equal(s.coordinator.snapshot().activeFetches, 0);
});

it("decoded/no-length bodies reject one byte over, accept the exact bound, and clamp returned characters", async () => {
  for (const size of [65_536, 65_537]) {
    let cancels = 0;
    // Exact-size fixture has one chunk then EOF, rather than an infinite stream.
    let calls = 0;
    const exact = setup(
      async () => {
        calls++;
        let sent = false;
        return response("", "text/markdown", {
          body: new ReadableStream(
            {
              pull(c) {
                if (sent) c.close();
                else {
                  sent = true;
                  c.enqueue(new Uint8Array(size).fill(97));
                }
              },
              cancel() {
                cancels++;
              },
            },
            { highWaterMark: 0 },
          ),
        });
      },
      { maxChars: 5 },
    );
    const result = await exact.client.fetch(
      { url: "https://example.com/page", maxChars: 999 },
      exact.operation,
    );
    if (size === 65_536) {
      assert.equal(result.page.content, "aaaaa");
      assert.equal(result.page.truncated, true);
    } else {
      assert.equal(result.page.state, "fetch-failed");
      assert.equal(result.page.diagnostic, "RESPONSE_TOO_LARGE");
      assert.equal(cancels, 3);
    }
    assert.equal(calls, size === 65_536 ? 2 : 3);
    await exact.operation.settle();
  }
});

it("early declared-length and HTTP refusals await cancellation before releasing a physical permit", async () => {
  for (const kind of ["length", "status"]) {
    const entered = latch(),
      release = latch();
    let calls = 0;
    const s = setup(async () => {
      calls++;
      entered.resolve();
      return response("", "text/markdown", {
        status: kind === "status" ? 503 : 200,
        headers: new Headers({
          "content-type": "text/markdown",
          ...(kind === "length" ? { "content-length": "999999" } : {}),
        }),
        body: new ReadableStream({ cancel: () => release.promise }),
      });
    });
    const task = s.client.fetch({ url: "https://example.com/page" }, s.operation);
    await entered.promise;
    await flush();
    assert.equal(calls, 1);
    assert.equal(s.coordinator.snapshot().activeFetches, 1);
    release.resolve();
    const result = await task;
    assert.equal(result.page.diagnostic, kind === "status" ? "HTTP_STATUS" : "RESPONSE_TOO_LARGE");
    await s.operation.settle();
  }
});

it("timeout uses the captured clock and holds the permit through independent reader cancellation", async () => {
  const base = createSystemClock();
  const callbacks = new Set<() => void>();
  const entered = latch(),
    release = latch();
  let cleared = 0,
    expireNew = false;
  const s = setup(
    async (_url, req) => {
      entered.resolve();
      return response("", "text/markdown", {
        body: new ReadableStream({
          pull() {
            return new Promise(() => {});
          },
          cancel: () => release.promise,
        }),
      });
    },
    {
      clock: {
        ...base,
        schedule(_ms, callback) {
          callbacks.add(callback);
          if (expireNew) queueMicrotask(callback);
          return () => {
            callbacks.delete(callback);
            cleared++;
          };
        },
      },
    },
  );
  const task = s.client.fetch({ url: "https://example.com/page" }, s.operation);
  await entered.promise;
  await flush();
  [...callbacks][0]();
  await flush();
  assert.equal(s.coordinator.snapshot().activeFetches, 1);
  expireNew = true;
  release.resolve();
  await flush();
  await flush();
  // Each queued physical variant obtains its own independent timer.
  for (const callback of callbacks) callback();
  const result = await task;
  assert.equal(result.page.diagnostic, "FETCH_TIMEOUT");
  assert.equal(cleared, 3);
  assert.equal(callbacks.size, 0);
  await s.operation.settle();
});

it("cutoff cancels queued/active pages but discovery survives and discovery-only cancel drains", async () => {
  const entered = latch(),
    release = latch();
  const temp = await mkdtemp(join(tmpdir(), "client-docs-"));
  let docSignal: AbortSignal | undefined;
  const s = setup(async (url, request) => {
    if (url.endsWith("llms-full.txt")) {
      docSignal = request.signal;
      entered.resolve();
      return response("", "text/plain", {
        body: new ReadableStream({
          pull() {
            return new Promise(() => {});
          },
          cancel: () => release.promise,
        }),
      });
    }
    return response("# Page");
  });
  const controller = new AbortController();
  try {
    const docs = s.client.discover(
      ["https://example.com/page"],
      temp,
      s.operation,
      controller.signal,
    );
    await entered.promise;
    await flush();
    s.operation.cutoffPages();
    assert.equal(docSignal!.aborted, false);
    controller.abort();
    let returned = false;
    void docs.then(() => {
      returned = true;
    });
    await flush();
    assert.equal(returned, false);
    assert.equal(s.coordinator.snapshot().activeFetches, 1);
    release.resolve();
    assert.deepEqual(await docs, []);
    assert.equal(s.operation.signal.aborted, false);
    await assert.rejects(
      s.client.fetch({ url: "https://example.com/page" }, s.operation, { pageId: "S1" }),
      { code: "PAGE_CUTOFF" },
    );
    await s.operation.settle();
  } finally {
    release.resolve();
    await s.coordinator.close();
    await rm(temp, { recursive: true, force: true });
  }
});

it("discovery validates the full population and preserves completed documents on its own cancel", async () => {
  const temp = await mkdtemp(join(tmpdir(), "client-docs-"));
  let calls = 0;
  const s = setup(async () => {
    calls++;
    return response("documentation", "text/plain");
  });
  try {
    await assert.rejects(() =>
      s.client.discover(
        ["https://example.com", "https://user:secret@example.com"],
        temp,
        s.operation,
        new AbortController().signal,
      ),
    );
    assert.equal(calls, 0);
    const records = await s.client.discover(
      ["https://example.com/page", "https://example.com/other"],
      temp,
      s.operation,
      new AbortController().signal,
    );
    assert.equal(records.length, 1);
    assert.equal(calls, 1);
    assert.equal(await readFile(records[0].fullPagePath!, "utf8"), "documentation");
    assert.equal(records[0].content, undefined);
    await s.operation.settle();
  } finally {
    await s.coordinator.close();
    await rm(temp, { recursive: true, force: true });
  }
});

it("foreign identity and invalid URL/maxChars never start transports; diagnostics never echo secrets", async () => {
  let calls = 0;
  const s = setup(async () => {
    calls++;
    throw new Error("secret-proxy/password");
  });
  for (const url of ["file:///private", "https://u:p@example.com", "https://example.com/a b"])
    await assert.rejects(() => s.client.fetch({ url }, s.operation));
  for (const maxChars of [0, -1, 1.5, NaN])
    await assert.rejects(() =>
      s.client.fetch({ url: "https://example.com", maxChars }, s.operation),
    );
  await assert.rejects(() => s.client.fetch({ url: "https://example.com" }, { ...s.operation }));
  assert.equal(calls, 0);
  const result = await s.client.fetch({ url: "https://example.com" }, s.operation);
  assert.equal(result.page.diagnostic, "TRANSPORT_FAILED");
  assert(!JSON.stringify(result).includes("secret"));
  await s.operation.settle();
});

it("logical admission holds the per-operation page cap, removes queued cancellation and drains close", async () => {
  const entered = latch(),
    release = latch();
  let calls = 0;
  const s = setup(
    async () => {
      calls++;
      entered.resolve();
      await release.promise;
      return response("# body");
    },
    { concurrency: 1 },
  );
  const first = s.client.fetch({ url: "https://example.com/first" }, s.operation);
  await entered.promise;
  const controller = new AbortController();
  const queued = s.client.fetch({ url: "https://example.com/second" }, s.operation, {
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(queued);
  assert.equal(calls, 1);
  let closed = false;
  const closing = s.coordinator.close().then(() => {
    closed = true;
  });
  await flush();
  assert.equal(closed, false);
  release.resolve();
  await assert.rejects(first);
  await closing;
  assert.equal(closed, true);
  assert.equal(calls, 1);
});

it("real owned-process transport rejects decoded gzip overflow and settles active cancellation", async () => {
  let port = 0;
  const sockets = new Set<import("node:net").Socket>();
  const requested = latch();
  const server = createServer((req, res) => {
    if (req.url === "/stall") {
      res.writeHead(200, { "content-type": "text/markdown" });
      res.flushHeaders();
      requested.resolve();
      return;
    }
    res.writeHead(200, { "content-type": "text/markdown", "content-encoding": "gzip" });
    res.end(gzipSync("x".repeat(65_537)));
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  for (let i = 0; i < 100; i++) {
    port = 20000 + Math.floor(Math.random() * 10001);
    try {
      server.listen(port, "127.0.0.1");
      await once(server, "listening");
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE") throw e;
      port = 0;
    }
  }
  assert(port);
  const transport = createProcessPageTransport({ executable: process.execPath, environment: {} });
  const s = setup(transport);
  try {
    const over = await s.client.fetch({ url: `http://127.0.0.1:${port}/gzip` }, s.operation);
    assert.equal(over.page.diagnostic, "RESPONSE_TOO_LARGE");
    assert.equal(s.coordinator.snapshot().activeFetches, 0);
    const task = s.client.fetch({ url: `http://127.0.0.1:${port}/stall` }, s.operation, {
      pageId: "S1",
    });
    await requested.promise;
    s.operation.abort();
    await assert.rejects(task);
    await s.operation.settle();
    assert.equal(s.coordinator.snapshot().activeFetches, 0);
  } finally {
    await s.coordinator.close();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((done) => server.close(() => done()));
  }
});

it("captured adapter fetch factory freezes settings and uses the selected executable", async (t) => {
  const spawn = childProcess.spawn;
  const commands: string[] = [];
  t.mock.method(
    childProcess,
    "spawn",
    (
      command: string,
      ...args: Parameters<typeof spawn> extends [string, ...infer Rest] ? Rest : never
    ) => {
      commands.push(command);
      return spawn(command, ...args);
    },
  );
  const settings = coreContext("/workspace").context.settings;
  const mutable = structuredClone(settings) as import("../src/core/types.js").ResearchSettings;
  mutable.execution = parseExecutionSettings({ fetchMaxChars: 4 });
  const clock = createSystemClock();
  const env = { HTTP_PROXY: "http://127.0.0.1:1" };
  const make = capturePageFetchFactory(mutable, clock, {
    executable: "/nonexistent/node-fetch-fixture",
    environment: env,
  });
  mutable.fetchTimeoutMs = 0;
  mutable.execution = parseExecutionSettings({ fetchMaxChars: 100 });
  env.HTTP_PROXY = "changed";
  const s = setup(async () => response("unused"));
  const client = make(s.operation);
  const result = await client.fetch({ url: "http://127.0.0.1:1/page" }, s.operation);
  assert.equal(result.page.diagnostic, "TRANSPORT_FAILED");
  assert(commands.length > 0);
  assert(commands.every((command) => command === "/nonexistent/node-fetch-fixture"));
  await s.operation.settle();
});

it("discovery-only cancellation preserves earlier completed files and whole-operation abort throws", async () => {
  const root = await mkdtemp(join(tmpdir(), "partial-docs-"));
  for (const whole of [false, true]) {
    const entered = latch(),
      release = latch();
    const s = setup(
      async (url) => {
        if (url.includes("first.example")) return response("retained document", "text/plain");
        entered.resolve();
        return response("", "text/plain", {
          body: new ReadableStream({
            pull() {
              return new Promise(() => {});
            },
            cancel: () => release.promise,
          }),
        });
      },
      { concurrency: 1 },
    );
    const controller = new AbortController();
    try {
      const pending = s.client.discover(
        ["https://first.example", "https://second.example"],
        root,
        s.operation,
        controller.signal,
      );
      const observed = pending.then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      await entered.promise;
      await flush();
      if (whole) s.operation.abort();
      else controller.abort();
      assert.equal(s.coordinator.snapshot().activeFetches, 1);
      release.resolve();
      const result = await observed;
      if (whole) assert("error" in result);
      else {
        assert("value" in result);
        assert.equal(result.value.length, 1);
        assert.equal(await readFile(result.value[0].fullPagePath!, "utf8"), "retained document");
      }
      await s.operation.settle();
    } finally {
      release.resolve();
      await s.coordinator.close();
    }
  }
  await rm(root, { recursive: true, force: true });
});

it("adapter factory consumes captured proxy environment and character settings through real native assets", async () => {
  const targets: string[] = [];
  const server = createServer((req, res) => {
    targets.push(req.url ?? "");
    res.writeHead(200, { "content-type": "text/markdown" });
    res.end("# frozen content");
  });
  let port = 0;
  for (let i = 0; i < 100; i++) {
    port = 20000 + Math.floor(Math.random() * 10001);
    try {
      server.listen(port, "127.0.0.1");
      await once(server, "listening");
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE") throw e;
      port = 0;
    }
  }
  assert(port);
  const settings = structuredClone(
    coreContext("/workspace").context.settings,
  ) as import("../src/core/types.js").ResearchSettings;
  settings.execution = parseExecutionSettings({ fetchMaxChars: 4 });
  const env = { HTTP_PROXY: `http://127.0.0.1:${port}` };
  const clock = createSystemClock();
  const make = capturePageFetchFactory(settings, clock, {
    executable: process.execPath,
    environment: env,
  });
  env.HTTP_PROXY = "http://127.0.0.1:1";
  settings.execution = parseExecutionSettings({ fetchMaxChars: 100 });
  const s = setup(async () => response("unused"));
  try {
    const result = await make(s.operation).fetch(
      { url: "http://fixture.invalid/page" },
      s.operation,
    );
    assert.equal(result.page.content, "# fr");
    assert.equal(result.page.truncated, true);
    assert(targets.every((url) => url === "http://fixture.invalid/page"));
    assert.equal(targets.length, 2);
    const context = coreContext("/workspace").context;
    const full = await fetchPage(
      { url: "http://fixture.invalid/page" },
      {
        ...context,
        settings: { ...context.settings, execution: parseExecutionSettings({}) },
        services: {
          operation: s.operation,
          coordinator: s.coordinator,
          clock,
          ledger: createAttemptLedger(),
          fetch: make(s.operation),
          runs: {} as import("../src/core/contracts.js").RunStore,
        },
      },
    );
    assert.equal(full.data.sources[0].content, "# fr");
    assert.equal(full.data.accounting.attempts, 0);
    assert.equal(full.data.counts.fetched, 1);
    assert(!full.text.includes("# fr"));
    assert.equal(targets.length, 4);
    await s.operation.settle();
  } finally {
    await s.coordinator.close();
    await new Promise<void>((done) => server.close(() => done()));
  }
});

it("all registered factories select the captured bounded service without adding a fetch registration", async () => {
  const native = await readFile(
    new URL("../src/native-operation-runtime.ts", import.meta.url),
    "utf8",
  );
  const mcp = await readFile(new URL("../packages/mcp/src/runtime.ts", import.meta.url), "utf8");
  assert.match(native, /createFetch: capturePageFetchFactory\(settings, clock, pagePolicy\)/);
  assert.match(native, /environment: capturePageEnvironment\(process.env\)/);
  assert.match(mcp, /capturePageFetchFactory\(config.settings, clock, pagePolicy\)/);
  assert.match(mcp, /environment: capturePageEnvironment\(env, config.apiKeyEnv\)/);
  assert(!native.includes("Coordinated fetch is not installed"));
  assert(!mcp.includes('case "intelli_fetch"'));
  const registrations = await readFile(
    new URL("../src/native-registered-tools.ts", import.meta.url),
    "utf8",
  );
  assert(!registrations.includes('"intelli_fetch"'));
});

it("unsupported content is cancelled at headers without reading binary or discarded Accept bodies", async () => {
  for (const type of ["application/pdf", "text/html"]) {
    let pulls = 0,
      cancels = 0;
    const s = setup(async () => {
      let sent = false;
      return response("", type, {
        body: new ReadableStream(
          {
            pull(c) {
              pulls++;
              if (sent) c.close();
              else {
                sent = true;
                c.enqueue(
                  new TextEncoder().encode("<html><body><p>Accepted text</p></body></html>"),
                );
              }
            },
            cancel() {
              cancels++;
            },
          },
          { highWaterMark: 0 },
        ),
      });
    });
    const result = await s.client.fetch({ url: "https://example.com" }, s.operation);
    if (type === "application/pdf") {
      assert.equal(pulls, 0);
      assert.equal(cancels, 3);
      assert.equal(result.transferredBytes, 0);
      assert.equal(result.page.diagnostic, "UNSUPPORTED_CONTENT");
    } else {
      assert.equal(pulls, 4);
      assert.equal(cancels, 1);
      assert.equal(result.page.state, "fetched");
    }
    await s.operation.settle();
  }
});

it("page environment retains transport policy but excludes credentials and implicit debug loaders", () => {
  const env = {
    HTTP_PROXY: "http://proxy",
    SSL_CERT_FILE: "/test/ca",
    NODE_EXTRA_CA_CERTS: "/test/node-ca",
    NODE_OPTIONS: "--inspect",
    OPENROUTER_API_KEY: "secret",
    CUSTOM_KEY: "secret",
    LANG: "en_GB.UTF-8",
  };
  const captured = capturePageEnvironment(env);
  env.HTTP_PROXY = "changed";
  assert.deepEqual(captured, {
    HTTP_PROXY: "http://proxy",
    SSL_CERT_FILE: "/test/ca",
    NODE_EXTRA_CA_CERTS: "/test/node-ca",
    LANG: "en_GB.UTF-8",
  });
  assert.equal(capturePageEnvironment(env, "HTTP_PROXY").HTTP_PROXY, undefined);
  assert(Object.isFrozen(captured));
});

it("character truncation does not return a lone UTF-16 surrogate", async () => {
  const s = setup(async () => response("😀abc"), { maxChars: 1 });
  const result = await s.client.fetch({ url: "https://example.com" }, s.operation);
  assert.equal(result.page.content, "");
  assert.equal(result.page.truncated, true);
  await s.operation.settle();
});
