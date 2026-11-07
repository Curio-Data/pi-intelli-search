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
  "/upper.py": ["Text/Html; charset=utf-8", "<html><head><title>Upper</title></head><body><article><h1>Upper</h1><p>" + "html ".repeat(100) + "</p></article></body></html>"],
  "/upper.xhtml": ["Application/Xhtml+Xml; charset=utf-8", "<html><head><title>XHTML</title></head><body><article><h1>XHTML</h1><p>" + "xhtml ".repeat(100) + "</p></article></body></html>"],
  "/bare.xhtml": ["application/xhtml", "<html><head><title>Bare XHTML</title></head><body><article><h1>Bare XHTML</h1><p>" + "bare ".repeat(100) + "</p></article></body></html>"],
  "/octet": ["application/octet-stream", "x"],
  "/md": ["text/markdown", "# MD title\n\n" + "body ".repeat(100)],
  "/raw.md": ["text/markdown", "# Alternate\n\n" + "Reference facts. ".repeat(200)],
  "/sub/raw.md": ["text/markdown", "# Relative alternate\n\n" + "Relative facts. ".repeat(200)],
  "/binary": ["application/pdf", "%PDF-1.4\n" + "BINARY ".repeat(1000)],
  "/binary-octet": ["application/octet-stream", "%PDF-1.4\n" + "OCTET ".repeat(1000)],
};
before(async () => {
  server = http.createServer((req, res) => {
    const port = (server.address() as AddressInfo).port;
    const alternatePage = (target: string) =>
      `<html><head><title>Guide</title><link rel="alternate" type="text/markdown" href="${target}"></head><body><article><h1>Guide</h1><p>Short guide.</p></article></body></html>`;
    if (req.url === "/alternate") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(alternatePage(`http://localhost:${port}/raw.md`));
      return;
    }
    if (req.url === "/same-alternate") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(alternatePage(`${base}/raw.md`));
      return;
    }
    if (req.url === "/redirect-alternate") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(alternatePage(`${base}/alias.md`));
      return;
    }
    if (req.url === "/start-html-alternate") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(alternatePage(`http://localhost:${port}/sub/body`));
      return;
    }
    if (req.url === "/redirect-html-body") {
      res.writeHead(302, { location: `http://localhost:${port}/sub/body` });
      res.end();
      return;
    }
    if (req.url === "/sub/body") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<html><head><title>Body</title></head><body><article><h1>Body</h1><p>${"Instructions and details. ".repeat(100)}</p><a href="install">Install details</a></article></body></html>`);
      return;
    }
    if (req.url === "/redirect-relative-page") {
      res.writeHead(302, { location: `http://localhost:${port}/sub/page` });
      res.end();
      return;
    }
    if (req.url === "/sub/page") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(alternatePage("raw.md"));
      return;
    }
    if (req.url === "/binary-alternate" || req.url === "/octet-alternate") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(alternatePage(`${base}${req.url === "/binary-alternate" ? "/binary" : "/binary-octet"}`));
      return;
    }
    if (req.url === "/alias.md") {
      res.writeHead(302, { location: `http://localhost:${port}/raw.md` });
      res.end();
      return;
    }
    if (req.url === "/redirect-code") {
      res.writeHead(302, { location: `${base}/script.py` });
      res.end();
      return;
    }
    if (req.url === "/redirect-cross-host") {
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
    { path: "/upper.py", assetType: "page", contentType: "Text/Html; charset=utf-8" },
    { path: "/upper.xhtml", assetType: "page", contentType: "Application/Xhtml+Xml; charset=utf-8" },
    { path: "/bare.xhtml", assetType: "page", contentType: "application/xhtml" },
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

  it("rejects PDF and octet-stream alternates and keeps the usable HTML page", async () => {
    const [pdf, octet] = await fetchPages(
      [base + "/binary-alternate", base + "/octet-alternate"],
      undefined,
      { timeoutMs: 5000 },
    );
    for (const page of [pdf, octet]) {
      assert.equal(page.status, "success", page.error ?? "alternate fallback failed");
      assert.equal(page.assetType, "page");
      assert.equal(page.contentType, "text/html");
      assert.match(page.content, /guide/i);
      assert.doesNotMatch(page.content, /BINARY|OCTET/);
      assert.equal(page.finalUrl, undefined);
    }
  });

  it("keeps the guessed identity across same-host, cross-host and redirected alternates", async () => {
    const [cross, same, redirected] = await fetchPages(
      [base + "/alternate", base + "/same-alternate", base + "/redirect-alternate"],
      undefined,
      { timeoutMs: 5000 },
    );
    assert.equal(cross.status, "success", cross.error ?? "cross-host alternate failed");
    assert.equal(cross.url, base + "/alternate");
    assert.equal(cross.alternateUrl, `http://localhost:${(server.address() as AddressInfo).port}/raw.md`);
    assert.equal(cross.finalUrl, cross.alternateUrl);
    assert.equal(cross.assetType, "text");
    assert.equal(same.url, base + "/same-alternate");
    assert.equal(same.alternateUrl, base + "/raw.md");
    assert.equal(same.finalUrl, base + "/raw.md");
    assert.equal(redirected.url, base + "/redirect-alternate");
    assert.equal(redirected.alternateUrl, base + "/alias.md");
    assert.equal(redirected.finalUrl, cross.finalUrl);
  });

  it("resolves a relative alternate against the post-redirect page URL", async () => {
    const [page] = await fetchPages([base + "/redirect-relative-page"], undefined, { timeoutMs: 5000 });
    const port = (server.address() as AddressInfo).port;
    assert.equal(page.status, "success", page.error ?? "relative alternate failed");
    assert.equal(page.url, base + "/redirect-relative-page");
    assert.equal(page.alternateUrl, `http://localhost:${port}/sub/raw.md`);
    assert.equal(page.finalUrl, `http://localhost:${port}/sub/raw.md`);
  });

  it("resolves links inside selected HTML against the actual response URL", async () => {
    const [alternate, redirected] = await fetchPages(
      [base + "/start-html-alternate", base + "/redirect-html-body"],
      undefined,
      { timeoutMs: 5000 },
    );
    const port = (server.address() as AddressInfo).port;
    for (const page of [alternate, redirected]) {
      assert.equal(page.status, "success", page.error ?? "HTML representation failed");
      assert.equal(page.finalUrl, `http://localhost:${port}/sub/body`);
      assert.match(page.content, new RegExp(`http://localhost:${port}/sub/install`));
      assert.doesNotMatch(page.content, new RegExp(`http://127\\.0\\.0\\.1:${port}/install`));
    }
    assert.equal(alternate.url, base + "/start-html-alternate");
    assert.equal(alternate.alternateUrl, `http://localhost:${port}/sub/body`);
    assert.equal(redirected.url, base + "/redirect-html-body");
  });
});
