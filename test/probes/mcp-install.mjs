// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
// Copied into the independent installation by scripts/verify-mcp-install.mjs.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, sep } from "node:path";
import { createRuntime, parseConfig, identity } from "@curio-data/mcp-intelli-search/runtime";

const require = createRequire(import.meta.url);
for (const name of [
  "@curio-data/pi-intelli-search",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
  "tsx",
  "typescript",
  "esbuild",
]) {
  await assert.rejects(import(name));
  assert.throws(() => require(name));
}
const manifest = require("@curio-data/mcp-intelli-search/package.json");
assert.deepEqual(identity, { name: manifest.name, version: manifest.version, adapter: "mcp" });
let htmlRequests = 0;
let markdownRequests = 0;
const server = createServer((request, response) => {
  if (request.headers.accept?.includes("text/markdown")) {
    markdownRequests++;
    response.setHeader("content-type", "text/markdown");
    response.end(
      "# Installed Native Fetch Fixture\n\n" +
        "Verified browser-fingerprint fetch assets and markdown extraction.\n".repeat(20),
    );
  } else {
    htmlRequests++;
    response.setHeader("content-type", "text/html");
    response.end(
      "<!doctype html><html><head><title>Installed Fetch Fixture</title></head><body><article><h1>Fixture</h1>" +
        "<p>Installed HTML extraction passes through the real native fetch library and DOM parser.</p>".repeat(
          20,
        ) +
        "</article></body></html>",
    );
  }
});
async function listen() {
  for (let port = 23000; port <= 30000; port++) {
    try {
      server.listen(port, "127.0.0.1");
      await once(server, "listening");
      return port;
    } catch (error) {
      if (error.code !== "EADDRINUSE") throw error;
    }
  }
  throw new Error("No free development port");
}
const port = await listen();
try {
  const url = `http://127.0.0.1:${port}/docs`;
  const workspace = join(process.cwd(), "workspace");
  await mkdir(workspace);
  const selected = {
    search: "perplexity/sonar",
    extract: "fixture/extract",
    collate: "fixture/collate",
  };
  const config = await parseConfig(
    {
      providers: { openrouter: { apiKeyEnv: "INSTALL_FIXTURE_KEY" } },
      models: Object.fromEntries(
        Object.entries(selected).map(([role, model]) => [role, { provider: "openrouter", model }]),
      ),
      tuning: { defaultUrls: 1, maxUrls: 1, disableLlmsFullDiscovery: true, llmRetryAttempts: 1 },
    },
    workspace,
  );
  let modelCalls = 0;
  const runtime = await createRuntime(config, {
    env: { INSTALL_FIXTURE_KEY: "synthetic-install-credential" },
    fetch: async (input, init) => {
      if (String(input) === "https://openrouter.ai/api/v1/models")
        return Response.json({
          data: Object.values(selected).map((id) => ({
            id,
            architecture: { input_modalities: ["text"], output_modalities: ["text"] },
            supported_parameters: ["tools", "reasoning"],
          })),
        });
      assert.equal(String(input), "https://openrouter.ai/api/v1/chat/completions");
      const body = JSON.parse(init.body);
      assert.equal(body.messages[0].role, "system");
      assert.equal(body.stream, false);
      modelCalls++;
      return Response.json({
        choices: [
          {
            message: {
              content:
                body.model === selected.search
                  ? `[Fixture](${url})`
                  : body.model === selected.extract
                    ? "Official documentation, current.\nVerified fixture content."
                    : "Installed artifact research succeeded.",
            },
            finish_reason: "stop",
          },
        ],
      });
    },
  });
  assert.equal(
    (await runtime.execute("intelli_search", { query: "fixture search" })).outcome,
    "completed",
  );
  assert.equal(
    (
      await runtime.execute("intelli_extract", {
        query: "fixture extract",
        url,
        title: "Fixture",
        content: "Fixture content",
      })
    ).outcome,
    "completed",
  );
  const collated = await runtime.execute("intelli_collate", {
    query: "fixture collate",
    extractions: [
      { url, title: "Fixture", extraction: "Facts", sourceType: "official", status: "success" },
    ],
  });
  assert.match(collated.text, /host's file-reading capability/);
  const result = await runtime.execute("intelli_research", {
    query: "fixture research",
    maxUrls: 1,
    focusPrompt: "Verify installation",
  });
  assert.equal(result.outcome, "completed");
  assert(htmlRequests > 0 && markdownRequests > 0, "both real native fetch paths must run");
  const cachePath = result.details.cachePath;
  assert(cachePath.startsWith(join(workspace, ".search") + sep));
  const metadata = JSON.parse(await readFile(join(cachePath, "meta.json"), "utf8"));
  assert.equal(metadata.packageName, manifest.name);
  assert.equal(metadata.extensionVersion, manifest.version);
  assert.equal(metadata.adapter, "mcp");
  const sources = await readdir(join(cachePath, "sources"));
  assert(sources.length > 0);
  const source = await readFile(join(cachePath, "sources", sources[0]), "utf8");
  assert.match(source, /[Ff]ixture/);
  assert.match(
    await readFile(join(cachePath, "report.md"), "utf8"),
    /Installed artifact research succeeded/,
  );
  assert(modelCalls >= 6);
  assert.equal(
    (await readdir(process.cwd())).includes(".search"),
    false,
    "launcher stays cache-free",
  );
  process.stdout.write(
    JSON.stringify({
      outcome: result.outcome,
      identity,
      htmlRequests,
      markdownRequests,
      modelCalls,
    }) + "\n",
  );
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
