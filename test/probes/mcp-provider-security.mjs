// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
// Runs against source or an independent production installation. No fetch
// injection is passed to the runtime: the actual default provider HTTP runs.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { connect } from "node:net";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";

const target = process.argv[2] ?? "@curio-data/mcp-intelli-search/runtime";
const modes = process.argv[3] ? [process.argv[3]] : ["healthy", "encoding", "abort"];
assert(modes.every((mode) => ["healthy", "encoding", "abort"].includes(mode)));
const { createRuntime, parseConfig } = await import(target);
const require = createRequire(import.meta.resolve(target));
const { Agent, getGlobalDispatcher, setGlobalDispatcher } = require("undici");
const savedDispatcher = getGlobalDispatcher();
const originalFetch = globalThis.fetch;
globalThis.fetch = () => {
  throw new Error("Node-bundled fetch must not serve MCP provider requests");
};
const model = "perplexity/sonar";
const secret = "synthetic-provider-security-key";
let mode = "healthy";
let catalogueCalls = 0;
let completionCalls = 0;
let active = 0;
let stalled;
let stalledStarted;
const server = createServer((request, response) => {
  assert.equal(request.headers.authorization, `Bearer ${secret}`);
  active++;
  response.once("close", () => {
    active--;
  });
  if (request.url === "/api/v1/models") {
    catalogueCalls++;
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        data: [
          { id: model, architecture: { input_modalities: ["text"], output_modalities: ["text"] } },
        ],
      }),
    );
    return;
  }
  assert.equal(request.url, "/api/v1/chat/completions");
  completionCalls++;
  if (mode === "encoding") {
    response.writeHead(200, {
      "Content-Encoding": "gzip, gzip, gzip, gzip, gzip, gzip",
      "Content-Length": "100",
    });
    const socket = response.socket;
    response.flushHeaders();
    setTimeout(() => socket.destroy(), 50);
  } else if (mode === "abort") {
    stalled = response;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.flushHeaders();
    stalledStarted();
  } else {
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        choices: [
          { message: { content: "Default provider transport succeeded." }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16, cost: 0.001 },
      }),
    );
  }
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const agent = new Agent({
  // Test-only connector: keep the production HTTPS URL/headers/path intact,
  // but supply a local HTTP socket. No DNS or external connection is made.
  connect(options, callback) {
    assert.equal(options.hostname, "openrouter.ai");
    assert.equal(options.protocol, "https:");
    assert(["", "443"].includes(String(options.port)));
    const socket = connect({ host: "127.0.0.1", port: server.address().port });
    socket.once("connect", () => callback(null, socket));
    socket.once("error", callback);
    return socket;
  },
});
setGlobalDispatcher(agent);
try {
  for (const testMode of modes) {
    mode = testMode;
    const workspace = await mkdtemp(join(process.cwd(), `provider-security-${mode}-`));
    const config = await parseConfig(
      {
        providers: { openrouter: { apiKeyEnv: "SECURITY_FIXTURE_KEY" } },
        models: Object.fromEntries(
          ["search", "extract", "collate"].map((role) => [role, { provider: "openrouter", model }]),
        ),
        tuning: { llmRetryAttempts: 1, llmTimeoutMs: 5000, disableLlmsFullDiscovery: true },
      },
      workspace,
    );
    const runtime = await createRuntime(config, {
      env: { SECURITY_FIXTURE_KEY: secret },
      logger: { warn() {}, error() {} },
    });
    try {
      const controller = new AbortController();
      const started = new Promise((resolve) => {
        stalledStarted = resolve;
      });
      const result = runtime.execute(
        "intelli_search",
        { query: "Synthetic transport security fixture" },
        { signal: controller.signal },
      );
      if (mode === "healthy") {
        assert.equal((await result).outcome, "completed");
      } else {
        // Attach rejection handling immediately; cancellation waits for the
        // server's explicit body-start witness instead of a timing guess.
        const rejected = assert.rejects(result, (error) => {
          assert(!error.message.includes(secret));
          return /OpenRouter|abort/i.test(error.message);
        });
        if (mode === "abort") {
          await started;
          controller.abort();
        }
        await rejected;
      }
    } finally {
      await runtime.close();
      stalled?.destroy();
      stalled = undefined;
    }
    // Observe all server-side close callbacks before the next case. This is
    // not a claim that a remote-close callback is client settlement evidence.
    for (let i = 0; active > 0 && i < 100; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(active, 0);
  }
  assert.equal(catalogueCalls, modes.length);
  assert.equal(completionCalls, modes.length);
} finally {
  setGlobalDispatcher(savedDispatcher);
  globalThis.fetch = originalFetch;
  await agent.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
process.stdout.write("mcp-provider-security-complete\n");
