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
  "/python": ["text/x-python; charset=utf-8", "print('hello')\n"],
  "/script.py": ["text/plain; charset=utf-8", "print('plain python')\n"],
  "/json": ["application/json", "{\"answer\": 42}\n"],
  "/javascript": ["application/javascript", "export const answer = 42;\n"],
  "/xml": ["application/xml", "<answer>42</answer>\n"],
  "/html": ["text/html; charset=utf-8", "<html><head><title>T</title></head><body><article><h1>Hello</h1><p>" + "word ".repeat(200) + "</p></article></body></html>"],
  "/octet": ["application/octet-stream", "x"],
  "/md": ["text/markdown", "# MD title\n\n" + "body ".repeat(100)],
};
before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/redirect-code") {
      res.writeHead(302, { location: `${base}/script.py` });
      res.end();
      return;
    }
    if (req.url === "/redirect-cross-host") {
      const port = (server.address() as AddressInfo).port;
      res.writeHead(302, { location: `http://localhost:${port}/script.py` });
      res.end();
      return;
    }
    if (req.url === "/redirect-pdf") {
      res.writeHead(302, { location: `${base}/plain-pdf` });
      res.end();
      return;
    }
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
  it("application/pdf and octet-stream are rejected as unsupported assets", async () => {
    const [a, b, c] = await fetchPages([base + "/plain-pdf", base + "/charset-pdf", base + "/octet"], undefined, { timeoutMs: 5000 });
    assert.equal(a.status, "error"); assert.match(a.error ?? "", /Unsupported content type: application\/pdf/);
    assert.equal(b.status, "error"); assert.match(b.error ?? "", /Unsupported content type: application\/pdf;charset=UTF-8/);
    assert.equal(c.status, "error"); assert.match(c.error ?? "", /Unsupported content type: application\/octet-stream/);
  });

  const acceptedAssets = [
    { path: "/text", assetType: "text", contentType: "text/plain" },
    { path: "/python", assetType: "code", contentType: "text/x-python; charset=utf-8" },
    { path: "/script.py", assetType: "code", contentType: "text/plain; charset=utf-8" },
    { path: "/json", assetType: "code", contentType: "application/json" },
    { path: "/javascript", assetType: "code", contentType: "application/javascript" },
    { path: "/xml", assetType: "code", contentType: "application/xml" },
    { path: "/md", assetType: "text", contentType: "text/markdown" },
    { path: "/html", assetType: "page", contentType: "text/html; charset=utf-8" },
  ] as const;
  for (const { path, assetType, contentType } of acceptedAssets) {
    it(`accepts ${contentType} as a ${assetType} asset`, async () => {
      const [page] = await fetchPages([base + path], undefined, { timeoutMs: 5000 });
      assert.equal(page.status, "success", page.error ?? "fetch failed");
      assert.equal(page.assetType, assetType);
      assert.equal(page.contentType, contentType);
      assert.ok(page.content.length > 0);
    });
  }

  it("records the final URL after same-host and cross-host redirects", async () => {
    const [sameHost, crossHost] = await fetchPages(
      [base + "/redirect-code", base + "/redirect-cross-host"],
      undefined,
      { timeoutMs: 5000 },
    );
    assert.equal(sameHost.status, "success", sameHost.error ?? "same-host redirect failed");
    assert.equal(sameHost.url, base + "/redirect-code");
    assert.equal(sameHost.finalUrl, base + "/script.py");
    assert.equal(crossHost.status, "success", crossHost.error ?? "cross-host redirect failed");
    assert.equal(crossHost.url, base + "/redirect-cross-host");
    assert.match(crossHost.finalUrl ?? "", /^http:\/\/localhost:\d+\/script\.py$/);
  });

  it("retains the final URL when the redirected response is unsupported", async () => {
    const [page] = await fetchPages([base + "/redirect-pdf"], undefined, { timeoutMs: 5000 });
    assert.equal(page.status, "error");
    assert.equal(page.finalUrl, base + "/plain-pdf");
    assert.match(page.error ?? "", /Unsupported content type: application\/pdf/);
  });
});
