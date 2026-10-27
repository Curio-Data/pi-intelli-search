// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
import assert from "node:assert/strict";
import { it } from "node:test";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

it("the MathML runtime uses the patched external parser, not an embedded older copy", () => {
  const defuddleRequire = createRequire(import.meta.resolve("defuddle/node"));
  const converter = defuddleRequire.resolve("mathml-to-latex");
  const converterSource = readFileSync(converter, "utf8");
  assert.match(converterSource, /require\(['"]@xmldom\/xmldom['"]\)/);
  const converterRequire = createRequire(converter);
  const parser = converterRequire.resolve("@xmldom/xmldom");
  const manifest = JSON.parse(readFileSync(join(dirname(parser), "../package.json"), "utf8"));
  const [major, minor, patch] = manifest.version.split(".").map(Number);
  assert.ok(major > 0 || minor > 9 || (minor === 9 && patch >= 12), `Review parser security for ${manifest.version}`);
  const { MathMLToLaTeX } = defuddleRequire("mathml-to-latex");
  assert.match(MathMLToLaTeX.convert("<math><mfrac><mi>x</mi><mn>2</mn></mfrac></math>"), /\\frac\{x\}\{2\}/);
});

it("the development host resolves patched Undici with bounded parser and fetch rejection", () => {
  const hostRequire = createRequire(import.meta.resolve("@earendil-works/pi-coding-agent"));
  const undiciEntry = hostRequire.resolve("undici");
  // A separate process makes an unhandled response-stream error a test failure.
  // Inputs are deliberately small; this does not run a memory-exhaustion attack.
  const result = spawnSync(process.execPath, ["--input-type=commonjs", "-e", `
    const assert = require('node:assert/strict');
    const { createHash } = require('node:crypto');
    const { createServer } = require('node:http');
    const { finished } = require('node:stream/promises');
    const { createRequire } = require('node:module');
    const req = createRequire(${JSON.stringify(undiciEntry)});
    const { fetch, Agent } = req('./index.js');
    const { EventSourceStream } = req('./lib/web/eventsource/eventsource-stream.js');
    (async () => {
      for (const chunks of [
        [Buffer.from('data:\\n'.repeat(1025))],
        Array.from({ length: 1025 }, () => Buffer.from('x')),
        [Buffer.from('id: ' + 'x'.repeat(4097) + '\\n')],
      ]) {
        const parser = new EventSourceStream({ maxEventSize: 4096 });
        const settled = assert.rejects(finished(parser), /maximum.*size|size.*exceeded/i);
        for (const chunk of chunks) parser.write(chunk);
        parser.end();
        await settled;
      }
      const digest = createHash('sha256').update('trusted').digest('base64');
      for (const algorithm of ['sha256', 'SHA256', 'Sha256']) {
        assert.equal(await (await fetch('data:,trusted', { integrity: algorithm + '-' + digest })).text(), 'trusted');
        await assert.rejects(fetch('data:,changed', { integrity: algorithm + '-' + digest }), /fetch failed/);
      }
      const server = createServer((_request, response) => {
        response.writeHead(200, { 'Content-Encoding': 'gzip, gzip, gzip, gzip, gzip, gzip', 'Content-Length': '100' });
        const socket = response.socket;
        response.flushHeaders();
        setTimeout(() => socket.destroy(), 50);
      });
      const agent = new Agent();
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      try {
        await assert.rejects(fetch('http://127.0.0.1:' + server.address().port, { dispatcher: agent }), /fetch failed/);
        // Keep the process alive until the server-close trigger has fired.
        await new Promise(resolve => setTimeout(resolve, 100));
      } finally {
        await agent.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
      }
      process.stdout.write('undici-security-complete\\n');
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `], { encoding: "utf8", timeout: 20_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "undici-security-complete\n", "Every security assertion must finish");
});

it("the MCP runtime's Zod rejects oversized constrained collections before parsing elements", () => {
  const serverRequire = createRequire(import.meta.resolve("@modelcontextprotocol/server"));
  const { z } = serverRequire("zod") as typeof import("zod");
  let visits = 0;
  const element = z.unknown().superRefine(() => { visits++; });
  for (const [schema, input] of [
    [z.array(element).max(2), Array(8).fill(null)],
    [z.set(element).max(2), new Set([1, 2, 3, 4])],
    [z.map(element, element).max(2), new Map([[1, 1], [2, 2], [3, 3]])],
  ] as const) {
    const result = schema.safeParse(input);
    assert.equal(result.success, false);
    if (!result.success) assert.equal(result.error.issues[0].code, "too_big");
  }
  assert.equal(visits, 0);
  assert.equal(z.array(z.number()).max(2).safeParse([1, 2]).success, true);
});
