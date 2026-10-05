// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { document } from "./helpers.js";

const packageDir = fileURLToPath(new URL("..", import.meta.url));
const childPath = fileURLToPath(new URL("./child-server.ts", import.meta.url));
const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const scratchParent =
  process.env.TMPDIR ?? fileURLToPath(new URL("../../../.tmp/mcp-tests/", import.meta.url));
mkdirSync(scratchParent, { recursive: true });

function workspace(): { dir: string; config: string } {
  const dir = mkdtempSync(join(scratchParent, "protocol-"));
  const config = join(dir, "config.json");
  // Stalled fixtures must outlive the model timeout; the shared policy's own
  // timeout tests live in the provider suite.
  writeFileSync(
    config,
    JSON.stringify({
      ...document(),
      tuning: { ...document().tuning, llmTimeoutMs: 30_000 },
    }),
  );
  return { dir, config };
}

interface FixtureClient {
  client: Client;
  transport: StdioClientTransport;
  stderr: () => string;
  close: () => Promise<void>;
}

async function connect(extraEnv: Record<string, string> = {}): Promise<FixtureClient> {
  const { dir, config } = workspace();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", childPath, "--config", config, "--workspace", dir],
    cwd: packageDir,
    env: { ...process.env, ...extraEnv } as Record<string, string>,
    stderr: "pipe",
  });
  let diagnostics = "";
  transport.stderr?.on("data", (chunk) => {
    diagnostics += chunk.toString();
  });
  const client = new Client({ name: "protocol-test-client", version: "0.0.0" });
  await client.connect(transport);
  return {
    client,
    transport,
    stderr: () => diagnostics,
    close: async () => {
      await client.close();
    },
  };
}

async function waitFor(check: () => boolean, ms = 15_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for fixture condition");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

interface RawChild {
  child: ChildProcess;
  send: (message: unknown) => void;
  lines: () => string[];
  stderr: () => string;
  exitCode: () => number | null | undefined;
}

function spawnRaw(args: string[], extraEnv: Record<string, string> = {}): RawChild {
  const child = spawn(process.execPath, args, {
    cwd: packageDir,
    env: { ...process.env, ...extraEnv },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines: string[] = [];
  let stderr = "";
  let buffer = "";
  let exitCode: number | null | undefined;
  // Record eagerly: a fast-exiting child must not race a late listener.
  child.once("exit", (code) => {
    exitCode = code;
  });
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const split = buffer.split("\n");
    buffer = split.pop() as string;
    lines.push(...split.filter((line) => line.trim()));
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  return {
    child,
    send: (message) => child.stdin.write(`${JSON.stringify(message)}\n`),
    lines: () => lines,
    stderr: () => stderr,
    exitCode: () => exitCode,
  };
}

function exitWithin(child: ChildProcess, ms: number): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Child did not exit in time"));
    }, ms);
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "raw-test-client", version: "0.0.0" },
  },
};

let pageServer: Server | undefined;
let pageUrl = "";
async function pages(): Promise<string> {
  if (pageServer) return pageUrl;
  pageServer = createServer((request, response) => {
    if (request.headers.accept?.includes("text/markdown")) {
      response.setHeader("content-type", "text/markdown");
      response.end("# Protocol Fixture\n\nProtocol fixture page content.\n".repeat(20));
    } else {
      response.setHeader("content-type", "text/html");
      response.end(
        "<!doctype html><html><head><title>Protocol Fixture</title></head><body><article><h1>Fixture</h1>" +
          "<p>Protocol fixture page served over loopback.</p>".repeat(20) +
          "</article></body></html>",
      );
    }
  });
  for (let port = 23000; port <= 30000; port++) {
    try {
      pageServer.listen(port, "127.0.0.1");
      await once(pageServer, "listening");
      pageUrl = `http://127.0.0.1:${port}/docs`;
      return pageUrl;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    }
  }
  throw new Error("No free development port");
}
test.after(() => {
  pageServer?.closeAllConnections();
  pageServer?.close();
});

test("lists the four canonical tools with truthful annotations", { timeout: 60_000 }, async () => {
  const fixture = await connect();
  try {
    const { tools } = await fixture.client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ["intelli_search", "intelli_extract", "intelli_collate", "intelli_research"],
    );
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
    // The served schemas are the frozen native contracts, byte for byte.
    const frozen = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL("../../../test/fixtures/native-contract/tools.json", import.meta.url),
        ),
        "utf8",
      ),
    ) as { tools: Array<{ name: string; parameters: unknown }> };
    for (const entry of frozen.tools)
      assert.deepEqual(
        byName[entry.name].inputSchema,
        entry.parameters,
        `served schema matches the frozen native contract for ${entry.name}`,
      );
    assert.equal(byName.intelli_search.annotations?.readOnlyHint, true);
    assert.equal(byName.intelli_extract.annotations?.readOnlyHint, true);
    assert.equal(byName.intelli_collate.annotations?.readOnlyHint, false);
    assert.equal(byName.intelli_research.annotations?.readOnlyHint, false);
    for (const tool of tools) {
      assert.equal(tool.annotations?.idempotentHint, false);
      assert.equal(tool.annotations?.openWorldHint, true);
      assert.match(tool.description ?? "", /intelli_/);
    }
  } finally {
    await fixture.close();
  }
});

test(
  "executes search, extract and collate over a real stdio connection",
  { timeout: 90_000 },
  async () => {
    const fixture = await connect();
    try {
      const search = await fixture.client.callTool(
        { name: "intelli_search", arguments: { query: "fixture search" } },
        { timeout: 30_000 },
      );
      assert.equal(search.isError, undefined);
      assert.match((search.content as Array<{ text: string }>)[0].text, /### Sources/);
      assert.equal(
        (search.structuredContent as { outcome: string }).outcome,
        "completed",
      );
      const extract = await fixture.client.callTool(
        {
          name: "intelli_extract",
          arguments: {
            query: "fixture extract",
            url: "https://example.invalid/page",
            title: "Fixture",
            content: "Fixture page content",
            focusPrompt: "Preserve fixture facts",
          },
        },
        { timeout: 30_000 },
      );
      assert.equal(
        (extract.structuredContent as { outcome: string }).outcome,
        "completed",
      );
      const collate = await fixture.client.callTool(
        {
          name: "intelli_collate",
          arguments: {
            query: "fixture collate",
            extractions: [
              {
                url: "https://example.invalid/page",
                title: "Fixture",
                extraction: "Fixture extraction facts.",
                sourceType: "official",
                status: "success",
              },
            ],
          },
        },
        { timeout: 30_000 },
      );
      const collated = collate.structuredContent as {
        outcome: string;
        details: { cachePath: string };
      };
      assert.equal(collated.outcome, "completed");
      assert.match((collate.content as Array<{ text: string }>)[0].text, /file-reading capability/);
      assert.ok(collated.details.cachePath.includes(`.search${sep}`));
    } finally {
      await fixture.close();
    }
  },
);

test(
  "executes research with progress notifications and writes the workspace cache",
  { timeout: 120_000 },
  async () => {
    const url = await pages();
    const fixture = await connect({ FIXTURE_PAGE_URL: url });
    try {
      let progress = 0;
      const result = await fixture.client.callTool(
        {
          name: "intelli_research",
          arguments: { query: "fixture research", maxUrls: 1, focusPrompt: "Fixture facts" },
        },
        { timeout: 90_000, onprogress: () => progress++ },
      );
      const structured = result.structuredContent as {
        outcome: string;
        details: { cachePath: string };
      };
      assert.equal(structured.outcome, "completed");
      assert.ok(progress > 0, "progress notifications reach the client");
      assert.ok(structured.details.cachePath.includes(`.search${sep}`));
      const cacheEntries = readdirSync(structured.details.cachePath);
      assert.ok(cacheEntries.includes("meta.json"));
      assert.ok(cacheEntries.includes("report.md"));
      const metadata = JSON.parse(
        readFileSync(join(structured.details.cachePath, "meta.json"), "utf8"),
      );
      assert.equal(metadata.adapter, "mcp");
    } finally {
      await fixture.close();
    }
  },
);

test("keeps a degraded no-links research as a tool result", { timeout: 90_000 }, async () => {
  const fixture = await connect({ FIXTURE_NOLINKS: "1" });
  try {
    const result = await fixture.client.callTool(
      { name: "intelli_research", arguments: { query: "fixture degraded", maxUrls: 1 } },
      { timeout: 60_000 },
    );
    assert.equal(result.isError, undefined);
    assert.equal((result.structuredContent as { outcome: string }).outcome, "no-links");
  } finally {
    await fixture.close();
  }
});

test("reports invalid arguments as tool errors, not protocol errors", { timeout: 60_000 }, async () => {
  const fixture = await connect();
  try {
    const wrongType = await fixture.client.callTool(
      { name: "intelli_search", arguments: { query: 42 } },
      { timeout: 15_000 },
    );
    assert.equal(wrongType.isError, true);
    const empty = await fixture.client.callTool(
      { name: "intelli_search", arguments: { query: "   " } },
      { timeout: 15_000 },
    );
    assert.equal(empty.isError, true);
    assert.match(
      (empty.content as Array<{ text: string }>)[0].text,
      /INVALID_ARGUMENTS|query/i,
    );
    const badStatus = await fixture.client.callTool(
      {
        name: "intelli_collate",
        arguments: {
          query: "fixture",
          extractions: [
            {
              url: "https://example.invalid/page",
              title: "Fixture",
              extraction: "Facts",
              sourceType: "official",
              status: "unknown",
            },
          ],
        },
      },
      { timeout: 15_000 },
    );
    assert.equal(badStatus.isError, true);
    assert.match((badStatus.content as Array<{ text: string }>)[0].text, /INVALID_ARGUMENTS/);
  } finally {
    await fixture.close();
  }
});

test("client cancellation aborts the running operation", { timeout: 60_000 }, async () => {
  const fixture = await connect({ FIXTURE_STALL_MS: "8000" });
  try {
    const controller = new AbortController();
    const call = fixture.client.callTool(
      { name: "intelli_search", arguments: { query: "fixture cancel" } },
      { timeout: 30_000, signal: controller.signal },
    );
    await waitFor(() => fixture.stderr().includes("FIXTURE_COMPLETION_STARTED"));
    controller.abort(new Error("fixture cancellation"));
    await assert.rejects(call);
    await waitFor(() => fixture.stderr().includes("FIXTURE_ABORT_OBSERVED"));
  } finally {
    await fixture.close();
  }
});

test(
  "cancelling a queued request settles it without starting its operation",
  { timeout: 60_000 },
  async () => {
    const fixture = await connect({
      FIXTURE_STALL_MS: "4000",
      FIXTURE_MAX_CONCURRENT: "1",
      FIXTURE_MAX_QUEUED: "2",
    });
    try {
      const first = fixture.client.callTool(
        { name: "intelli_search", arguments: { query: "fixture first" } },
        { timeout: 30_000 },
      );
      await waitFor(() => fixture.stderr().includes("FIXTURE_COMPLETION_STARTED"));
      const controller = new AbortController();
      const queued = fixture.client.callTool(
        { name: "intelli_search", arguments: { query: "fixture queued" } },
        { timeout: 30_000, signal: controller.signal },
      );
      // Prove the request reached the server-side queue before cancelling it:
      // the hook fires for the first request too, so wait for the second
      // marker. An abort that never left the client would satisfy the final
      // assertions without exercising the server-side queue path.
      await waitFor(
        () => (fixture.stderr().match(/FIXTURE_QUEUE_QUEUED/g) ?? []).length >= 2,
      );
      controller.abort(new Error("fixture queued cancellation"));
      await assert.rejects(queued);
      const result = await first;
      assert.equal(result.isError, undefined);
      const starts = fixture.stderr().match(/FIXTURE_COMPLETION_STARTED/g) ?? [];
      assert.equal(starts.length, 1, "the cancelled queued operation never started");
    } finally {
      await fixture.close();
    }
  },
);

test("settles requests beyond the queue bound as busy", { timeout: 60_000 }, async () => {
  const fixture = await connect({
    FIXTURE_STALL_MS: "4000",
    FIXTURE_MAX_CONCURRENT: "1",
    FIXTURE_MAX_QUEUED: "1",
  });
  try {
    const first = fixture.client.callTool(
      { name: "intelli_search", arguments: { query: "fixture first" } },
      { timeout: 30_000 },
    );
    await waitFor(() => fixture.stderr().includes("FIXTURE_COMPLETION_STARTED"));
    const queued = fixture.client.callTool(
      { name: "intelli_search", arguments: { query: "fixture queued" } },
      { timeout: 30_000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    const overflow = await fixture.client.callTool(
      { name: "intelli_search", arguments: { query: "fixture overflow" } },
      { timeout: 30_000 },
    );
    assert.equal(overflow.isError, true);
    assert.match((overflow.content as Array<{ text: string }>)[0].text, /busy/i);
    await queued;
    await first;
  } finally {
    await fixture.close();
  }
});

test(
  "diverts import-time, console and direct stdout noise to standard error",
  { timeout: 60_000 },
  async () => {
    const fixture = await connect({ FIXTURE_NOISE: "1" });
    try {
      const result = await fixture.client.callTool(
        { name: "intelli_search", arguments: { query: "fixture noise" } },
        { timeout: 30_000 },
      );
      assert.equal(result.isError, undefined, "protocol framing survives noisy dependencies");
      assert.match(fixture.stderr(), /NOISE_IMPORT_TIME/);
      assert.match(fixture.stderr(), /NOISE_CONSOLE_LOG/);
      assert.match(fixture.stderr(), /NOISE_DIRECT_STDOUT/);
    } finally {
      await fixture.close();
    }
  },
);

test(
  "emits only protocol messages on stdout and exits on input closure",
  { timeout: 60_000 },
  async () => {
    const { dir, config } = workspace();
    const raw = spawnRaw([
      "--import",
      "tsx",
      childPath,
      "--config",
      config,
      "--workspace",
      dir,
    ]);
    raw.send(initialize);
    raw.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    raw.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    await waitFor(() => raw.lines().length >= 2);
    for (const line of raw.lines()) {
      const message = JSON.parse(line);
      assert.equal(message.jsonrpc, "2.0", "every stdout line is a protocol message");
    }
    raw.child.stdin?.end();
    assert.equal(await exitWithin(raw.child, 15_000), 0);
    assert.doesNotMatch(raw.stderr(), /panic|unhandled/i);
  },
);

test("aborts in-flight work when stdin closes mid-operation", { timeout: 60_000 }, async () => {
  const { dir, config } = workspace();
  const raw = spawnRaw(
    ["--import", "tsx", childPath, "--config", config, "--workspace", dir],
    { FIXTURE_STALL_MS: "8000" },
  );
  raw.send(initialize);
  raw.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  raw.send({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "intelli_search", arguments: { query: "fixture mid-close" } },
  });
  await waitFor(() => raw.stderr().includes("FIXTURE_COMPLETION_STARTED"));
  raw.child.stdin?.end();
  assert.equal(await exitWithin(raw.child, 15_000), 0);
  assert.match(raw.stderr(), /FIXTURE_ABORT_OBSERVED/);
});

test(
  "a host closing standard output closes gracefully instead of crashing on EPIPE",
  { timeout: 60_000 },
  async () => {
    const { dir, config } = workspace();
    const raw = spawnRaw([
      "--import",
      "tsx",
      childPath,
      "--config",
      config,
      "--workspace",
      dir,
    ]);
    raw.send(initialize);
    await waitFor(() => raw.lines().length >= 1);
    // Destroy the read end: the next protocol write raises EPIPE on the
    // server's real stdout, which must take the SDK's graceful close path.
    raw.child.stdout?.destroy();
    raw.send({
      jsonrpc: "2.0",
      id: 9,
      method: "initialize",
      params: initialize.params,
    });
    await waitFor(() => raw.exitCode() !== undefined, 15_000);
    assert.equal(raw.exitCode(), 0);
    assert.doesNotMatch(raw.stderr(), /Unhandled 'error' event|EPIPE/);
  },
);

test("fails startup without explicit configuration, keeping stdout empty", { timeout: 60_000 }, async () => {
  const raw = spawnRaw(["--import", "tsx", cliPath]);
  assert.notEqual(await exitWithin(raw.child, 15_000), 0);
  assert.deepEqual(raw.lines(), []);
  assert.match(raw.stderr(), /--config/);
});
