// RCCA probe F6b: fetch content-type gate, driven through the real fetchPages against a loopback HTTP server
// (no external network). Records the error each content type produces.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { fetchPages } from "../../../src/core/fetch.js";

let server: http.Server;
let base = "";
const routes: Record<string, [string, string]> = {
  "/plain-pdf": ["application/pdf", "%PDF-1.4 fake"],
  "/charset-pdf": ["application/pdf;charset=UTF-8", "%PDF-1.4 fake"],
  "/text": ["text/plain", "Some reStructuredText source\n====\nbody"],
  "/html": ["text/html; charset=utf-8", "<html><head><title>T</title></head><body><article><h1>Hello</h1><p>" + "word ".repeat(200) + "</p></article></body></html>"],
  "/octet": ["application/octet-stream", "x"],
  "/md": ["text/markdown", "# MD title\n\n" + "body ".repeat(100)],
};
before(async () => {
  server = http.createServer((req, res) => {
    const r = routes[req.url ?? ""];
    if (!r) { res.writeHead(404, { "content-type": "text/plain" }); res.end("nf"); return; }
    // text/markdown only when Accept asks for it, so /md exercises variant (a)
    if (req.url === "/md" && !String(req.headers.accept).includes("text/markdown")) {
      res.writeHead(200, { "content-type": "text/html" }); res.end("<html><body><p>x</p></body></html>"); return;
    }
    res.writeHead(200, { "content-type": r[0] }); res.end(r[1]);
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

describe("F6b fetch gate", () => {
  it("reports each content type", async () => {
    const paths = Object.keys(routes);
    const out = await fetchPages(paths.map((p) => base + p), undefined, { timeoutMs: 5000 });
    for (const [i, p] of paths.entries()) {
      console.log(`${p}\t${routes[p][0]}\t=> status=${out[i].status} source=${out[i].source ?? "-"} error=${out[i].error ?? "-"}`);
    }
  });
  it("application/pdf is rejected as 'Not HTML'", async () => {
    const [a, b, c] = await fetchPages([base + "/plain-pdf", base + "/charset-pdf", base + "/text"], undefined, { timeoutMs: 5000 });
    assert.equal(a.status, "error"); assert.match(a.error ?? "", /Not HTML: application\/pdf/);
    assert.equal(b.status, "error"); assert.match(b.error ?? "", /Not HTML: application\/pdf;charset=UTF-8/);
    assert.equal(c.status, "error"); assert.match(c.error ?? "", /Not HTML: text\/plain/);
  });
  it("html is accepted", async () => {
    const [h] = await fetchPages([base + "/html"], undefined, { timeoutMs: 5000 });
    assert.equal(h.status, "success");
  });
});
