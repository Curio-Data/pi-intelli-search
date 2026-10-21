// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { after, afterEach, before, describe, it, mock } from "node:test";
import childProcess, { type ChildProcess, type SpawnOptions } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createTcpServer, type Server } from "node:net";
import { fetch as baselineFetch } from "wreq-js";
import { once } from "node:events";
import { gzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createProcessPageTransport } from "../src/core/page-transport.js";
import type { PageTransportRequest, PageTransportResponse } from "../src/core/contracts.js";

const children: ChildProcess[] = [];
const closed = new Set<ChildProcess>();
const originalSpawn = childProcess.spawn;
before(() => {
  mock.method(
    childProcess,
    "spawn",
    (command: string, args: readonly string[], options: SpawnOptions) => {
      const child = originalSpawn(command, [...args], options);
      children.push(child);
      child.once("close", () => closed.add(child));
      return child;
    },
  );
});
afterEach(async () => {
  const active = children.filter((child) => !closed.has(child));
  try {
    assert.deepEqual(
      active.map((child) => child.pid),
      [],
      "operation returned with a live page child",
    );
  } finally {
    await Promise.all(
      active.map(async (child) => {
        const close = once(child, "close");
        child.kill("SIGKILL");
        await close;
      }),
    );
  }
});
after(() => mock.restoreAll());

function latch<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture<T>(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  body: (url: string) => Promise<T>,
): Promise<T> {
  return withServer(createServer(handler), body);
}
async function withServer<T>(server: Server, body: (url: string) => Promise<T>): Promise<T> {
  const sockets = new Set<import("node:net").Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  let port = 0;
  for (let attempt = 0; attempt < 100; attempt++) {
    port = 20000 + Math.floor(Math.random() * 10001);
    try {
      server.listen(port, "127.0.0.1");
      await once(server, "listening");
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
      port = 0;
    }
  }
  assert(port > 0, "No free development fixture port");
  try {
    return await body(`http://127.0.0.1:${port}`);
  } finally {
    // Failure cleanup only. Cancellation witnesses are awaited before this.
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((done) => server.close(() => done()));
  }
}
const transport = () =>
  createProcessPageTransport({ executable: process.execPath, environment: {} });
const request = (
  signal: AbortSignal,
  extra: Partial<PageTransportRequest> = {},
): PageTransportRequest => ({
  method: "GET",
  headers: {},
  browser: "chrome_145",
  signal,
  ...extra,
});
async function bytes(response: PageTransportResponse): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let count = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      count += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, count);
}
const text = async (response: PageTransportResponse) =>
  new TextDecoder().decode(await bytes(response));
const allClosed = () =>
  assert(
    children.every((child) => closed.has(child)),
    "process close must precede settlement",
  );

describe("owned process page transport (C04/C06/C19 prerequisite)", () => {
  it("constructs lazily and rejects unsafe initial inputs without spawning", async () => {
    const start = children.length;
    const fetch = transport();
    const signal = new AbortController().signal;
    for (const url of [
      "file:///etc/passwd",
      "https://u:p@example.com",
      "not a URL",
      "https://example.com/\nsecret",
      "https://example.com/a b",
    ])
      await assert.rejects(fetch(url, request(signal)), TypeError);
    const abort = new AbortController();
    const reason = new Error("caller cancelled before start");
    abort.abort(reason);
    await assert.rejects(
      fetch("https://example.com", request(abort.signal)),
      (error) => error === reason,
    );
    assert.equal(children.length, start);
  });

  it("returns actual status, final URL, headers and byte-exact content, and awaits natural exit", async () => {
    const payload = Buffer.from("# Résumé\n中文\n\u0000binary\n");
    await fixture(
      (_req, res) => {
        res.writeHead(201, {
          "content-type": "text/markdown; charset=utf-8",
          "x-fixture": "exact",
        });
        res.end(payload);
      },
      async (url) => {
        const response = await transport()(
          `${url}/source`,
          request(new AbortController().signal, { headers: { Accept: "text/markdown" } }),
        );
        assert.equal(response.status, 201);
        assert.equal(response.url, `${url}/source`);
        assert.equal(response.headers.get("x-fixture"), "exact");
        assert.deepEqual(await bytes(response), payload);
        allClosed();
      },
    );
  });

  it("handles HEAD without a body consumer or surviving process", async () => {
    await fixture(
      (req, res) => {
        assert.equal(req.method, "HEAD");
        res.writeHead(204, { "x-fixture": "head" });
        res.end();
      },
      async (url) => {
        const response = await transport()(
          url,
          request(new AbortController().signal, { method: "HEAD" }),
        );
        assert.equal(response.body, null);
        assert.equal(response.status, 204);
        allClosed();
      },
    );
  });

  for (const phase of ["before-headers", "inline-body", "pending-body", "refusal"] as const) {
    it(
      `awaits process and socket teardown for ${phase} cancellation`,
      { timeout: 8000 },
      async () => {
        const received = latch<void>();
        const socketClosed = latch<void>();
        const abort = new AbortController();
        const reason = new Error(`cancel ${phase}`);
        await fixture(
          (req, res) => {
            req.socket.once("close", () => socketClosed.resolve());
            received.resolve();
            if (phase === "before-headers") return;
            res.writeHead(phase === "refusal" ? 503 : 200, {
              "content-type": "text/plain",
              ...(phase === "inline-body" ? { "content-length": String(1024 * 1024) } : {}),
            });
            res.write("first chunk");
          },
          async (url) => {
            let result: PageTransportResponse | undefined;
            const pending = transport()(url, request(abort.signal));
            // Attach a rejection handler before triggering cancellation.
            const observed = pending.then(
              (value) => {
                result = value;
              },
              (error: unknown) => error,
            );
            try {
              await received.promise;
              if (phase === "before-headers" || phase === "inline-body") {
                const started = performance.now();
                abort.abort(reason);
                assert.equal(await observed, reason);
                assert(performance.now() - started < 5000);
              } else {
                await observed;
                assert(result?.body);
                if (phase === "pending-body") {
                  const reader = result.body.getReader();
                  assert.equal((await reader.read()).done, false);
                  const next = reader.read();
                  const failed = assert.rejects(next, (error) => error === reason);
                  const started = performance.now();
                  abort.abort(reason);
                  await failed;
                  assert(performance.now() - started < 5000);
                  reader.releaseLock();
                } else {
                  assert.equal(result.status, 503);
                  const started = performance.now();
                  await result.body.cancel();
                  assert(performance.now() - started < 5000);
                }
              }
              allClosed();
              await socketClosed.promise;
            } finally {
              abort.abort(reason);
              await observed;
            }
          },
        );
      },
    );
  }

  it("cancels an unread body and a body after receiving content", async () => {
    for (const readFirst of [false, true]) {
      await fixture(
        (_req, res) => {
          res.writeHead(200, { "content-type": "text/plain" });
          res.write("stream");
        },
        async (url) => {
          const result = await transport()(url, request(new AbortController().signal));
          if (readFirst) {
            const reader = result.body!.getReader();
            await reader.read();
            await reader.cancel();
            reader.releaseLock();
          } else await result.body!.cancel();
          allClosed();
        },
      );
    }
  });

  it("uses pull-driven IPC with no read requests before a consumer asks", async () => {
    await fixture(
      (_req, res) => {
        res.writeHead(200, { "content-type": "text/plain" });
        res.write(Buffer.alloc(100_000, 65));
      },
      async (url) => {
        const childStart = children.length;
        const result = await transport()(url, request(new AbortController().signal));
        const child = children[childStart];
        assert(child);
        // Spy only after headers. No later read should appear until reader.read().
        const send = mock.method(child, "send");
        assert.equal(send.mock.callCount(), 0);
        const reader = result.body!.getReader();
        const chunk = await reader.read();
        assert.equal(chunk.done, false);
        assert.deepEqual(
          send.mock.calls.map((call) => call.arguments[0]),
          [{ type: "read" }],
        );
        await reader.cancel();
        reader.releaseLock();
        allClosed();
        send.mock.restore();
      },
    );
  });

  it("accepts the next pull before the preceding child send callback finishes", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "process-ipc-order-"));
    const bootstrap = join(scratch, "delayed-send.mjs");
    await writeFile(
      bootstrap,
      `
      const original = process.send.bind(process);
      process.send = (message, callback) => original(message, (error) => setTimeout(() => callback(error), 25));
    `,
    );
    try {
      await fixture(
        (_req, res) => {
          res.writeHead(200);
          res.end(Buffer.alloc(3 * 1024 * 1024, 42));
        },
        async (url) => {
          const fetch = createProcessPageTransport({
            executable: process.execPath,
            environment: { NODE_OPTIONS: `--import=${pathToFileURL(bootstrap).href}` },
          });
          const result = await fetch(url, request(new AbortController().signal));
          assert.deepEqual(await bytes(result), Buffer.alloc(3 * 1024 * 1024, 42));
          allClosed();
        },
      );
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("streams decoded gzip bytes and can kill a stalled oversized decoded response", async () => {
    const payload = Buffer.alloc(2 * 1024 * 1024, 120);
    await fixture(
      (_req, res) => {
        res.writeHead(200, { "content-type": "text/plain", "content-encoding": "gzip" });
        res.end(gzipSync(payload));
      },
      async (url) => {
        const response = await transport()(url, request(new AbortController().signal));
        assert.deepEqual(await bytes(response), payload);
        allClosed();
      },
    );
    const socketClosed = latch<void>();
    await fixture(
      (req, res) => {
        req.socket.once("close", () => socketClosed.resolve());
        res.writeHead(200, { "content-type": "text/plain", "content-encoding": "gzip" });
        res.write(gzipSync(payload)); // Leave chunked HTTP body open.
      },
      async (url) => {
        const response = await transport()(url, request(new AbortController().signal));
        const reader = response.body!.getReader();
        let count = 0;
        while (count <= 65536) {
          const next = await reader.read();
          assert(!next.done);
          count += next.value.byteLength;
        }
        await reader.cancel("consumer byte limit");
        reader.releaseLock();
        allClosed();
        await socketClosed.promise;
      },
    );
  });

  it("follows validated relative redirects and rejects credential-bearing targets before requesting them", async () => {
    const requests: string[] = [];
    await fixture(
      (req, res) => {
        requests.push(req.url!);
        if (req.url === "/start") {
          res.writeHead(302, { location: "/done" });
          res.end();
        } else if (req.url === "/unsafe") {
          res.writeHead(302, { location: `http://u:p@${req.headers.host}/forbidden` });
          res.end();
        } else res.end("redirect content");
      },
      async (url) => {
        const fetch = transport();
        const response = await fetch(`${url}/start`, request(new AbortController().signal));
        assert.equal(response.url, `${url}/done`);
        assert.equal(await text(response), "redirect content");
        await assert.rejects(
          fetch(`${url}/unsafe`, request(new AbortController().signal)),
          /request failed/,
        );
        assert.deepEqual(requests, ["/start", "/done", "/unsafe"]);
        allClosed();
      },
    );
  });

  it("preserves redirect cookies in one chain without leaking them to later chains", async () => {
    let requests = 0;
    await fixture(
      (req, res) => {
        requests++;
        if (!req.headers.cookie?.includes("gate=ok")) {
          res.writeHead(302, { "set-cookie": "gate=ok; Path=/", location: "/gate" });
          res.end();
        } else res.end("article after cookie gate");
      },
      async (url) => {
        const baseline = await baselineFetch(`${url}/gate`, {
          browser: "chrome_145",
          os: "windows",
        });
        assert.equal(await baseline.text(), "article after cookie gate");
        assert.equal(requests, 2);
        const fetch = transport();
        for (let chain = 0; chain < 2; chain++) {
          const result = await fetch(`${url}/gate`, request(new AbortController().signal));
          assert.equal(await text(result), "article after cookie gate");
          assert.equal(requests, 4 + chain * 2, "cookies remain private to each physical chain");
          allClosed();
        }
      },
    );
  });

  it("uses the native session jar's cookie path and Secure scopes across redirects", async () => {
    const seen: Array<string | undefined> = [];
    await fixture(
      (req, res) => {
        if (req.url === "/start") {
          res.writeHead(302, {
            "set-cookie": [
              "public=ok; Path=/",
              "private=hidden; Path=/private",
              "secure=hidden; Path=/; Secure",
            ],
            location: "/public",
          });
          res.end();
        } else {
          seen.push(req.headers.cookie);
          res.end("scoped cookies");
        }
      },
      async (url) => {
        await (
          await baselineFetch(`${url}/start`, { browser: "chrome_145", os: "windows" })
        ).text();
        assert.equal(
          await text(await transport()(`${url}/start`, request(new AbortController().signal))),
          "scoped cookies",
        );
        assert.deepEqual(seen, ["public=ok", "public=ok"]);
        allClosed();
      },
    );
  });

  it("matches installed follow-mode Referer replacement for same and cross-origin hops", async () => {
    for (const method of ["GET", "HEAD"] as const) {
      for (const explicit of [false, true]) {
        const seen: Array<string | undefined> = [];
        await fixture(
          (req, res) => {
            seen.push(req.headers.referer);
            res.end("landing");
          },
          async (destination) => {
            await fixture(
              (req, res) => {
                if (req.url?.startsWith("/start")) {
                  res.writeHead(303, {
                    location: req.url.includes("cross=1") ? destination : "/landing",
                  });
                  res.end();
                } else {
                  seen.push(req.headers.referer);
                  res.end("landing");
                }
              },
              async (url) => {
                for (const cross of [false, true]) {
                  const start = `${url}/start?cross=${cross ? 1 : 0}&query=fixture#fragment`;
                  const headers: Record<string, string> = explicit
                    ? { Referer: "https://caller.example/path" }
                    : {};
                  await (
                    await baselineFetch(start, {
                      browser: "chrome_145",
                      os: "windows",
                      method,
                      headers,
                    })
                  ).text();
                  await text(
                    await transport()(
                      start,
                      request(new AbortController().signal, { method, headers }),
                    ),
                  );
                  assert.deepEqual(seen.splice(0), [start.split("#")[0], start.split("#")[0]]);
                  allClosed();
                }
              },
            );
          },
        );
      }
    }
  });

  it("preserves an HTTP_PROXY selected only in the captured child environment", async () => {
    let target: string | undefined;
    await fixture(
      (req, res) => {
        target = req.url;
        res.end("captured environment proxy");
      },
      async (proxy) => {
        const fetch = createProcessPageTransport({
          executable: process.execPath,
          environment: { HTTP_PROXY: proxy, NO_PROXY: "" },
        });
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), 3000);
        try {
          assert.equal(
            await text(await fetch("http://127.0.0.1:1/environment-proxy", request(abort.signal))),
            "captured environment proxy",
          );
          assert.equal(target, "http://127.0.0.1:1/environment-proxy");
          allClosed();
        } finally {
          clearTimeout(timer);
          abort.abort();
        }
      },
    );
  });

  it("preserves the configured HTTP proxy and its authentication without exposing them in argv", async () => {
    let target: string | undefined;
    let auth: string | undefined;
    await fixture(
      (req, res) => {
        target = req.url;
        auth = req.headers["proxy-authorization"] as string | undefined;
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("via selected proxy");
      },
      async (proxy) => {
        const configured = new URL(proxy);
        configured.username = "fixture-user";
        configured.password = "fixture-password";
        const response = await transport()(
          "http://127.0.0.1:1/proxy-target",
          request(new AbortController().signal, { proxy: configured.href }),
        );
        assert.equal(await text(response), "via selected proxy");
        assert.equal(target, "http://127.0.0.1:1/proxy-target");
        assert.equal(
          auth,
          `Basic ${Buffer.from("fixture-user:fixture-password").toString("base64")}`,
        );
        allClosed();
      },
    );
  });

  it("strips origin credentials when following a cross-origin redirect", async () => {
    await fixture(
      (req, res) => {
        assert.equal(req.headers.authorization, undefined);
        assert.equal(req.headers.cookie, undefined);
        res.end("new origin");
      },
      async (destination) => {
        await fixture(
          (req, res) => {
            assert.equal(req.headers.authorization, "Bearer fixture");
            res.writeHead(302, { location: destination });
            res.end();
          },
          async (url) => {
            const response = await transport()(
              url,
              request(new AbortController().signal, {
                headers: { Authorization: "Bearer fixture", Cookie: "fixture=cookie" },
              }),
            );
            assert.equal(await text(response), "new origin");
            allClosed();
          },
        );
      },
    );
  });

  it("matches installed browser TLS ClientHello parameters on the actual wire", async () => {
    const hellos: Buffer[] = [];
    const server = createTcpServer((socket) => {
      let data = Buffer.alloc(0);
      socket.on("data", (chunk) => {
        data = Buffer.concat([data, typeof chunk === "string" ? Buffer.from(chunk) : chunk]);
        if (data.length >= 5 && data.length >= 5 + data.readUInt16BE(3)) {
          hellos.push(data.subarray(0, 5 + data.readUInt16BE(3)));
          socket.destroy(); // No certificate or external TLS endpoint is needed.
        }
      });
    });
    await withServer(server, async (url) => {
      const https = url.replace("http:", "https:");
      await assert.rejects(
        baselineFetch(https, { browser: "chrome_145", os: "windows", timeout: 2000 }),
      );
      await assert.rejects(transport()(https, request(new AbortController().signal)));
      assert.equal(hellos.length, 2);
      const fingerprint = (record: Buffer) => {
        assert.equal(record[0], 22);
        assert.equal(record[5], 1);
        let at = 44 + record[43]; // Skip record/handshake headers, version, random and session ID.
        const grease = (value: number) =>
          (value & 0x0f0f) === 0x0a0a && value >> 8 === (value & 255);
        const words = (value: Buffer) =>
          Array.from({ length: value.length / 2 }, (_, i) => value.readUInt16BE(i * 2)).filter(
            (value) => !grease(value),
          );
        const cipherLength = record.readUInt16BE(at);
        at += 2;
        const ciphers = words(record.subarray(at, at + cipherLength));
        at += cipherLength;
        at += 1 + record[at]; // Compression methods.
        const end = at + 2 + record.readUInt16BE(at);
        at += 2;
        const extensions = new Map<number, Buffer>();
        while (at < end) {
          const type = record.readUInt16BE(at),
            size = record.readUInt16BE(at + 2);
          if (!grease(type)) extensions.set(type, record.subarray(at + 4, at + 4 + size));
          at += 4 + size;
        }
        return {
          ciphers,
          extensionTypes: [...extensions.keys()].sort((a, b) => a - b),
          groups: words(extensions.get(10)!.subarray(2)),
          alpn: extensions.get(16),
        };
      };
      // GREASE values, key material, random bytes and Chrome's extension shuffle
      // are not stable identifiers. Compare the declared profile parameters.
      assert.deepEqual(fingerprint(hellos[0]), fingerprint(hellos[1]));
      allClosed();
    });
  });

  it("bounds redirect loops at ten hops in one owned child", async () => {
    let count = 0;
    await fixture(
      (_req, res) => {
        count++;
        res.writeHead(302, { location: "/again" });
        res.end();
      },
      async (url) => {
        const before = children.length;
        await assert.rejects(
          transport()(url, request(new AbortController().signal)),
          /request failed/,
        );
        assert.equal(count, 11);
        assert.equal(children.length, before + 1);
        allClosed();
      },
    );
  });

  it("captures explicit environment/executable options and keeps proxies out of argv", async () => {
    const selected = { executable: process.execPath, environment: {} as Record<string, string> };
    const fetch = createProcessPageTransport(selected);
    selected.executable = "/does/not/exist";
    selected.environment.NODE_OPTIONS = "--invalid-option";
    await fixture(
      (_req, res) => res.end("captured"),
      async (url) => {
        assert.equal(
          await text(await fetch(url, request(new AbortController().signal))),
          "captured",
        );
        allClosed();
      },
    );
    await fixture(
      (_req, res) => res.end(),
      async (url) => {
        const secret = "proxy-password-marker";
        await assert.rejects(
          fetch(
            url,
            request(new AbortController().signal, { proxy: `http://user:${secret}@127.0.0.1:1` }),
          ),
          (error) => {
            assert(!String(error).includes(secret));
            return true;
          },
        );
        assert(children.every((child) => !child.spawnargs.join(" ").includes(secret)));
        allClosed();
      },
    );
  });

  it("reports executable launch failure without abandoning the failed child handle", async () => {
    const fetch = createProcessPageTransport({
      executable: "/missing/node-for-fixture",
      environment: {},
    });
    await assert.rejects(
      fetch("https://example.com", request(new AbortController().signal)),
      /Node.js process/,
    );
    allClosed();
  });

  it("owns four parallel independent chains and cancels them before returning", async () => {
    const ready = latch<void>();
    let count = 0;
    await fixture(
      (_req, res) => {
        res.writeHead(200, { "content-type": "text/plain" });
        res.write("parallel");
        if (++count === 4) ready.resolve();
      },
      async (url) => {
        const fetch = transport();
        const before = children.length;
        const abort = new AbortController();
        const responses = await Promise.all(
          Array.from({ length: 4 }, () => fetch(url, request(abort.signal))),
        );
        await ready.promise;
        assert.equal(children.length, before + 4);
        assert.equal(children.slice(before).filter((child) => !closed.has(child)).length, 4);
        const reading = responses.map((response) => {
          const reader = response.body!.getReader();
          return (async () => {
            try {
              while (!(await reader.read()).done) {
                /* Drain until cancellation. */
              }
            } finally {
              reader.releaseLock();
            }
          })();
        });
        const settled = Promise.allSettled(reading);
        const started = performance.now();
        abort.abort(new Error("parallel cancelled"));
        assert((await settled).every((result) => result.status === "rejected"));
        assert(performance.now() - started < 5000);
        allClosed();
      },
    );
  });

  it("has no in-process fetch fallback or inherited terminal streams", async () => {
    const source = await readFile(
      new URL("../src/core/page-transport.ts", import.meta.url),
      "utf8",
    );
    assert.match(source, /stdio: \["ignore", "ignore", "ignore", "ipc"\]/);
    assert.doesNotMatch(
      source,
      /globalThis\.fetch|wreqFetch|process\.env|process\.execArgv|console\./,
    );
  });
});
