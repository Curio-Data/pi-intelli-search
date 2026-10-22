// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
// Copied into a fresh native tarball installation. Pipeline inference is scripted.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.argv[2];
assert(root);
const workspace = join(process.cwd(), "native-research-workspace");
const profile = join(process.cwd(), "native-research-profile");
await mkdir(workspace);
await mkdir(profile);
process.env.PI_CODING_AGENT_DIR = profile;
const { writeFile } = await import("node:fs/promises");
await writeFile(
  join(profile, "settings.json"),
  JSON.stringify({
    "pi-intelli-search": {
      searchModel: { provider: "fixture", model: "search" },
      extractModel: { provider: "fixture", model: "extract" },
      collateModel: { provider: "fixture", model: "collate" },
      defaultUrls: 1,
      maxUrls: 1,
      llmRetryAttempts: 1,
      searchRetryAttempts: 1,
      disableLlmsFullDiscovery: true,
    },
  }),
);
const { default: extension } = await import(pathToFileURL(join(root, "dist/index.js")).href);
const { operationOutputSchemas } = await import(
  pathToFileURL(join(root, "dist/core/output-schemas.js")).href
);
const { Check } = await import("typebox/value");
const tools = [];
const events = new Map();
extension({
  registerTool(tool) {
    tools.push(tool);
  },
  registerMcpServer() {},
  on(name, callback) {
    const list = events.get(name) ?? [];
    list.push(callback);
    events.set(name, list);
  },
});
let html = 0;
let markdown = 0;
const server = createServer((request, response) => {
  const md = request.headers.accept?.includes("text/markdown");
  if (md) markdown++;
  else html++;
  response.writeHead(200, { "content-type": md ? "text/markdown" : "text/html" });
  response.end(
    md
      ? "# Installed Research\n\nInstalled full-operation facts."
      : "<html><body><article><h1>Installed Research</h1><p>Installed full-operation facts.</p></article></body></html>",
  );
});
let port;
for (let candidate = 23000; candidate <= 30000; candidate++) {
  try {
    server.listen(candidate, "127.0.0.1");
    await once(server, "listening");
    port = candidate;
    break;
  } catch (error) {
    if (error.code !== "EADDRINUSE") throw error;
  }
}
assert(port);
const url = `http://127.0.0.1:${port}/page`;
let calls = 0;
const registry = {
  find: (provider, id) => ({ provider, id, api: "openai-completions" }),
  getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "synthetic-install-fixture" }),
  streamSimple(model, _context, options) {
    return {
      async result() {
        calls++;
        options.onProviderStreamEvent?.(
          {
            usage: {
              prompt_tokens: 10,
              completion_tokens: 2,
              total_tokens: 12,
              cost: 0,
              prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
            },
          },
          model,
        );
        return {
          role: "assistant",
          api: "openai-completions",
          provider: "fixture",
          model: model.id,
          timestamp: 0,
          content: [
            {
              type: "text",
              text:
                model.id === "search"
                  ? `[Installed](${url})`
                  : model.id === "extract"
                    ? "Official docs\nInstalled full-operation facts."
                    : "Installed native research completed [S1].",
            },
          ],
          stopReason: "stop",
          usage: {
            input: 10,
            output: 2,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 12,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
        };
      },
    };
  },
};
const context = {
  cwd: workspace,
  modelRegistry: registry,
  hasUI: false,
  isProjectTrusted: () => false,
  sessionManager: { getSessionId: () => "installed-research" },
  ui: { notify() {}, setWorkingIndicator() {} },
};
try {
  const research = tools.find((tool) => tool.name === "intelli_research");
  assert(research);
  const result = await research.execute(
    "installed",
    { query: "Installed native research", maxUrls: 1 },
    undefined,
    undefined,
    context,
  );
  assert(!result.isError);
  const data = result.details.intelli;
  assert(Check(operationOutputSchemas.intelli_research, data));
  assert.equal(data.outcome, "completed");
  assert.equal(data.counts.used, 1);
  assert.equal(data.cache.status, "committed");
  assert.equal(calls, 3);
  assert(html > 0 && markdown > 0);
  const directory = join(workspace, result.details.cachePath);
  const manifest = JSON.parse(await readFile(join(directory, "run.json"), "utf8"));
  assert.deepEqual(manifest.evidenceSourceIds, ["S1"]);
  assert.match(
    await readFile(join(directory, "report.md"), "utf8"),
    /Installed native research completed/,
  );
  const accounting = JSON.parse(await readFile(join(directory, "accounting.json"), "utf8"));
  assert.deepEqual(accounting.attempts, data.attempts);
  assert.equal(accounting.summary.attempts, 3);
  assert.deepEqual(await readdir(join(workspace, ".search/.staging")), []);
  console.log(
    JSON.stringify({
      operation: data.operation,
      outcome: data.outcome,
      html,
      markdown,
      calls,
      attempts: data.accounting.attempts,
      persistence: data.cache.status,
    }),
  );
} finally {
  for (const callback of events.get("session_shutdown") ?? []) await callback({}, context);
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
