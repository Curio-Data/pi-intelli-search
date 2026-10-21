// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
// Copied into an independent native or standalone production installation.

import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { pathToFileURL } from "node:url";

const { createProcessPageTransport } = await import(pathToFileURL(process.argv[2]).href);
const children = [],
  closed = new Set();
const spawn = childProcess.spawn;
childProcess.spawn = (...args) => {
  const child = spawn(...args);
  children.push(child);
  child.once("close", () => closed.add(child));
  return child;
};
const body = Buffer.from("# Installed Process Fetch\nRésumé 中文\n\u0000byte-exact\n");
const sockets = new Set();
let socketClosed;
const server = createServer((req, res) => {
  if (req.url === "/stalled") {
    req.socket.once("close", () => socketClosed());
    res.writeHead(200, { "content-type": "text/plain" });
    res.write("first");
  } else if (req.url === "/redirect") {
    res.writeHead(302, { location: "/content" });
    res.end();
  } else {
    res.writeHead(200, { "content-type": "text/markdown", "x-install-fixture": "process" });
    res.end(body);
  }
});
server.on("connection", (socket) => {
  sockets.add(socket);
  socket.once("close", () => sockets.delete(socket));
});
let port;
for (port = 23000; port <= 30000; port++) {
  try {
    server.listen(port, "127.0.0.1");
    await once(server, "listening");
    break;
  } catch (error) {
    if (error.code !== "EADDRINUSE") throw error;
  }
}
assert(port <= 30000, "No free development fixture port");
const request = (signal) => ({
  method: "GET",
  browser: "chrome_145",
  headers: { Accept: "text/markdown" },
  signal,
});
const controller = new AbortController();
const make = createProcessPageTransport({
  executable: process.execPath,
  environment: { ...process.env },
});
try {
  const root = `http://127.0.0.1:${port}`;
  const response = await make(`${root}/redirect`, request(controller.signal));
  assert.equal(response.url, `${root}/content`);
  assert.equal(response.headers.get("x-install-fixture"), "process");
  const reader = response.body.getReader();
  const parts = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      parts.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  assert.deepEqual(Buffer.concat(parts), body);
  assert(
    children.every((child) => closed.has(child)),
    "natural body EOF preceded child closure",
  );
  const head = await make(`${root}/content`, { ...request(controller.signal), method: "HEAD" });
  assert.equal(head.body, null);
  assert(
    children.every((child) => closed.has(child)),
    "HEAD left a live child",
  );
  const witness = new Promise((resolve) => {
    socketClosed = resolve;
  });
  const stalled = await make(`${root}/stalled`, request(controller.signal));
  const stalledReader = stalled.body.getReader();
  await stalledReader.read();
  const reason = new Error("installed fixture cancelled");
  const failed = assert.rejects(stalledReader.read(), (error) => error === reason);
  controller.abort(reason);
  await failed;
  stalledReader.releaseLock();
  assert(
    children.every((child) => closed.has(child)),
    "abort returned before child closure",
  );
  await witness;
  assert.equal(children.length, 3);
  process.stdout.write(
    JSON.stringify({
      content: "byte-exact",
      redirects: "validated",
      cancellation: "process-settled",
      childrenClosed: children.length,
    }) + "\n",
  );
} finally {
  controller.abort();
  await Promise.all(
    children
      .filter((child) => !closed.has(child))
      .map(async (child) => {
        const close = once(child, "close");
        child.kill("SIGKILL");
        await close;
      }),
  );
  childProcess.spawn = spawn;
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve));
}
