// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
// Optional Phase 0 dependency probe. SDK packages belong in an isolated prefix,
// not the extension's dependencies. This is not the intelli-search MCP server.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

if (!process.argv[2]) {
  console.error("Usage: node test/probes/mcp-sdk.mjs <isolated-sdk-install-directory>");
  process.exit(2);
}
const sdkDir = resolve(process.argv[2]);
const require = createRequire(join(sdkDir, "package.json"));
const { McpServer, fromJsonSchema } = require("@modelcontextprotocol/server");
const { StdioServerTransport } = require("@modelcontextprotocol/server/stdio");
const { Client } = require("@modelcontextprotocol/client");
const { StdioClientTransport } = require("@modelcontextprotocol/client/stdio");

if (process.argv[3] === "--server") {
  const server = new McpServer({ name: "phase0-sdk-probe", version: "0.0.0" });
  server.registerTool(
    "echo",
    {
      inputSchema: fromJsonSchema({
        type: "object",
        properties: {
          text: { type: "string" },
          wait: { type: "boolean" },
        },
        required: ["text"],
      }),
    },
    async ({ text, wait }, ctx) => {
      assert.ok(ctx.mcpReq.signal instanceof AbortSignal);
      const token = ctx.mcpReq._meta?.progressToken;
      if (token !== undefined)
        await ctx.mcpReq.notify({
          method: "notifications/progress",
          params: { progressToken: token, progress: 1, total: 2 },
        });
      if (wait)
        await new Promise((done) => {
          const finish = (message) => {
            clearTimeout(timer);
            console.error(message);
            done();
          };
          const timer = setTimeout(() => finish("ABORT_NOT_RECEIVED"), 5_000);
          if (ctx.mcpReq.signal.aborted) finish("ABORT_OBSERVED");
          else
            ctx.mcpReq.signal.addEventListener("abort", () => finish("ABORT_OBSERVED"), {
              once: true,
            });
        });
      return { content: [{ type: "text", text }] };
    },
  );
  await server.connect(new StdioServerTransport());
} else {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(import.meta.url), sdkDir, "--server"],
    stderr: "pipe",
  });
  const client = new Client({ name: "phase0-sdk-probe-client", version: "0.0.0" });
  let diagnostics = "";
  transport.stderr?.on("data", (buffer) => {
    diagnostics += buffer.toString();
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.equal(tools[0].name, "echo");
    assert.deepEqual(tools[0].inputSchema.required, ["text"]);
    let progress = 0;
    const result = await client.callTool(
      { name: "echo", arguments: { text: "fixture" } },
      {
        timeout: 5_000,
        onprogress: () => {
          progress++;
        },
      },
    );
    assert.equal(result.content[0].text, "fixture");
    assert.equal(progress, 1);
    const invalid = await client.callTool(
      { name: "echo", arguments: { text: 42 } },
      { timeout: 5_000 },
    );
    assert.equal(invalid.isError, true, "SDK reports invalid tool arguments as a tool error");
    const controller = new AbortController();
    await assert.rejects(
      client.callTool(
        { name: "echo", arguments: { text: "cancel", wait: true } },
        {
          timeout: 5_000,
          signal: controller.signal,
          onprogress: () => controller.abort(new Error("fixture cancellation")),
        },
      ),
    );
    for (let i = 0; i < 100 && !diagnostics.includes("ABORT_OBSERVED"); i++) {
      await new Promise((done) => setTimeout(done, 20));
    }
    assert.match(diagnostics, /ABORT_OBSERVED/);
    assert.doesNotMatch(diagnostics, /ABORT_NOT_RECEIVED/);
    console.log(
      "PASS: stdio, JSON Schema, list/call, progress, invalid-input isError and server-observed cancellation.",
    );
  } finally {
    await client.close();
  }
}
