// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// Direct registered-tool invocation driver (test/e2e/direct-tool.mjs), used by
// the live configuration recipes. Ported from the parallel-e2e-runtime branch.
// Every case runs against the repository's own development copy of the host
// SDK and a fixture extension: no network, no operator state.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { directArguments, resolveSdkFromHostBin } from "./e2e/direct-tool.mjs";

type Json = Record<string, unknown>;

async function scratch(t: { after: (fn: () => Promise<void>) => void }, prefix: string) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

describe("direct registered-tool invocation (direct-tool.mjs)", () => {
  // The repository's own dev copy of the host SDK, so the fixtures never
  // depend on the operator's installed Pi.
  const SDK = resolve("node_modules/@earendil-works/pi-coding-agent");
  const DRIVER = resolve("test/e2e/direct-tool.mjs");
  // A fixture extension standing in for intelli_research: it records exactly
  // what the host passed and behaves according to the query.
  const FIXTURE = `import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";
export default function (pi) {
  pi.on("session_start", (_e, ctx) => {
    writeFileSync(join(ctx.cwd, "session-start.json"), JSON.stringify({ trusted: ctx.isProjectTrusted() }));
  });
  pi.registerTool({
    name: "intelli_research", label: "fixture", description: "fixture research",
    parameters: Type.Object({ query: Type.String(), maxUrls: Type.Optional(Type.Number()),
      domains: Type.Optional(Type.Array(Type.String())), focusPrompt: Type.Optional(Type.String()) }),
    async execute(_id, params, signal, onUpdate, ctx) {
      writeFileSync(join(ctx.cwd, "received.json"), JSON.stringify(params));
      if (params.query === "loop") {
        pi.sendUserMessage("start an agent turn");
        await new Promise((r) => setTimeout(r, 500));
        return { content: [{ type: "text", text: "loop" }], details: {} };
      }
      if (params.query === "wait-abort") {
        writeFileSync(join(ctx.cwd, "started"), "");
        await new Promise((r) => signal.addEventListener("abort", r, { once: true }));
        writeFileSync(join(ctx.cwd, "aborted"), "");
        return { content: [{ type: "text", text: "aborted" }], details: {} };
      }
      onUpdate?.({ content: [{ type: "text", text: "progress" }], details: {} });
      const slug = "2026-11-09-fixture";
      mkdirSync(join(ctx.cwd, ".search", slug), { recursive: true });
      writeFileSync(join(ctx.cwd, ".search", slug, "meta.json"), JSON.stringify({ outcome: "completed",
        stages: { fetch: { succeeded: 1 }, collate: { summaryChars: 5 } } }));
      return { content: [{ type: "text", text: "done\\n**Cache**: \`.search/" + slug + "/\`" }], details: { cachePath: ".search/" + slug } };
    },
  });
}
`;
  // A local fake loop provider on an unroutable loopback port: even a failed
  // guard could not reach a real endpoint.
  const MODELS = { providers: { e2efake: { baseUrl: "http://127.0.0.1:9/v1", api: "openai-completions", apiKey: "dummy",
    models: [{ id: "fake-model", name: "fake", reasoning: false, input: ["text"], contextWindow: 8000, maxTokens: 1000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } };

  async function setup(t: { after: (fn: () => Promise<void>) => void }) {
    const root = await scratch(t, "e2e-direct-");
    for (const sub of ["agent", "ws", "home", "attempts"]) await mkdir(join(root, sub));
    await writeFile(join(root, "fixture-ext.mjs"), FIXTURE);
    await writeFile(join(root, "agent/settings.json"), JSON.stringify({ defaultProvider: "e2efake", defaultModel: "fake-model" }));
    await writeFile(join(root, "agent/models.json"), JSON.stringify(MODELS));
    return root;
  }
  const env = (root: string) => ({ PATH: process.env.PATH ?? "", HOME: join(root, "home"), PI_OFFLINE: "1", PI_CODING_AGENT_DIR: join(root, "agent") });
  const driverArgs = (root: string, args: Json, extra: string[] = [], tool = "intelli_research") => [DRIVER, "--sdk", SDK,
    "--agent-dir", join(root, "agent"), "--cwd", join(root, "ws"), "--tool", tool, "--args", JSON.stringify(args),
    "--extension", join(root, "fixture-ext.mjs"), "--no-extensions", ...extra];
  const records = (stdout: string) => stdout.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Json);

  it("sends exactly the given arguments, null omissions dropped, with no agent-loop call", async (t) => {
    const root = await setup(t);
    const since = Date.now();
    const run = spawnSync(process.execPath, driverArgs(root, { query: "q", maxUrls: 2, domains: ["a.org"], focusPrompt: null }, ["--tools", "intelli_research"]),
      { cwd: join(root, "ws"), encoding: "utf8", env: env(root), timeout: 60_000 });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(await readFile(join(root, "ws/received.json"), "utf8")), { query: "q", maxUrls: 2, domains: ["a.org"] });
    const events = records(run.stdout);
    const starts = events.filter((e) => e.type === "tool_execution_start");
    assert.equal(starts.length, 1);
    assert.deepEqual(starts[0].args, { query: "q", maxUrls: 2, domains: ["a.org"] });
    assert.ok(events.some((e) => e.type === "tool_execution_update"), "progress updates are streamed");
    assert.deepEqual(events.at(-1), { type: "e2e_direct_settled", agentLoopModelCalls: 0, agentLoopEvents: 0, exitCode: 0 });
    assert.equal(events[0].type, "e2e_direct_driver");
    assert.ok(existsSync(join(root, "ws/session-start.json")), "session_start reached the extension");
    // The fixture's sidecar is fresh and completed, which is what the shell
    // helper's verdict reads.
    const meta = JSON.parse(await readFile(join(root, "ws/.search/2026-11-09-fixture/meta.json"), "utf8"));
    assert.equal(meta.outcome, "completed");
    assert.ok(since <= Date.now());
  });

  it("refuses an agent-loop model call and exits 71", async (t) => {
    const root = await setup(t);
    const run = spawnSync(process.execPath, driverArgs(root, { query: "loop" }), { cwd: join(root, "ws"), encoding: "utf8", env: env(root), timeout: 60_000 });
    assert.equal(run.status, 71, run.stderr);
    const settled = records(run.stdout).at(-1) as Json;
    assert.equal(settled.type, "e2e_direct_settled");
    assert.ok(Number(settled.agentLoopModelCalls) >= 1, "the refused call is counted");
    assert.equal(settled.exitCode, 71);
  });

  it("resolves project trust as the host does and hands the extension the same decision", async (t) => {
    for (const trusted of [true, false]) {
      const root = await setup(t);
      await mkdir(join(root, "ws/.pi"));
      await writeFile(join(root, "ws/.pi/settings.json"), JSON.stringify({ "pi-intelli-search": { cacheDir: ".search-client-x" } }));
      if (trusted) await writeFile(join(root, "agent/trust.json"), JSON.stringify({ [join(root, "ws")]: true }));
      const run = spawnSync(process.execPath, driverArgs(root, { query: "q" }), { cwd: join(root, "ws"), encoding: "utf8", env: env(root), timeout: 60_000 });
      assert.equal(run.status, 0, run.stderr);
      const header = records(run.stdout)[0];
      const seen = JSON.parse(await readFile(join(root, "ws/session-start.json"), "utf8"));
      assert.equal(seen.trusted, header.projectTrusted, `driver and extension agree (trust.json: ${trusted})`);
      if (trusted) assert.equal(seen.trusted, true);
    }
  });

  it("reports an unavailable host explicitly (69) and an uncallable tool as a harness error (72)", async (t) => {
    const root = await setup(t);
    const fake = join(root, "fake-sdk");
    await mkdir(join(fake, "dist"), { recursive: true });
    await writeFile(join(fake, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.0.0", type: "module" }));
    await writeFile(join(fake, "dist/index.js"), "export const VERSION = '0.0.0';\n");
    const args = driverArgs(root, { query: "q" });
    args[2] = fake;
    const missing = spawnSync(process.execPath, args, { cwd: join(root, "ws"), encoding: "utf8", env: env(root), timeout: 60_000 });
    assert.equal(missing.status, 69, missing.stderr);
    assert.match(records(missing.stdout).at(-1)?.reason as string, /lacks createAgentSession/);
    args[2] = join(root, "nowhere");
    assert.equal(spawnSync(process.execPath, args, { cwd: join(root, "ws"), encoding: "utf8", env: env(root) }).status, 69);
    const notCallable = spawnSync(process.execPath, driverArgs(root, { query: "q" }, ["--tool-wait-ms", "300"], "intelli_missing"),
      { cwd: join(root, "ws"), encoding: "utf8", env: env(root), timeout: 60_000 });
    assert.equal(notCallable.status, 72, notCallable.stderr);
    assert.ok(records(notCallable.stdout).some((e) => e.type === "e2e_direct_not_callable"));
  });

  it("an MCP call goes through the host's MCP client to the stdio server with the exact arguments", async (t) => {
    const root = await setup(t);
    // A minimal stdio MCP server: initialize, tools/list, tools/call. It logs
    // the arguments it receives.
    const server = `import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === "initialize") send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: msg.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1.0.0" } } });
  else if (msg.method === "tools/list") send({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "intelli_research", description: "fixture", inputSchema: { type: "object", properties: { query: { type: "string" }, maxUrls: { type: "number" } }, required: ["query"] } }] } });
  else if (msg.method === "tools/call") { appendFileSync(process.argv[2], JSON.stringify(msg.params.arguments) + "\\n"); send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "fixture result" }] } }); }
  else if (msg.id !== undefined) send({ jsonrpc: "2.0", id: msg.id, result: {} });
});
`;
    await writeFile(join(root, "server.mjs"), server);
    await writeFile(join(root, "agent/mcp.json"), JSON.stringify({ mcpServers: { "intelli-search": {
      command: process.execPath, args: [join(root, "server.mjs"), join(root, "calls.jsonl")], exposure: "direct" } } }));
    const tool = "mcp__intelli_search__intelli_research";
    const run = spawnSync(process.execPath, [DRIVER, "--sdk", SDK, "--agent-dir", join(root, "agent"), "--cwd", join(root, "ws"),
      "--tool", tool, "--args", JSON.stringify({ query: "q", maxUrls: 1, focusPrompt: null }), "--tools", tool, "--tool-wait-ms", "15000"],
      { cwd: join(root, "ws"), encoding: "utf8", env: env(root), timeout: 60_000 });
    assert.equal(run.status, 0, run.stderr);
    const events = records(run.stdout);
    assert.deepEqual(events[0].builtinExtensions && (events[0].builtinExtensions as string[]).includes("mcp"), true, "the MCP client is loaded");
    assert.ok(events.some((e) => e.type === "tool_execution_end" && e.toolName === tool && e.isError === false));
    assert.deepEqual((await readFile(join(root, "calls.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l)), [{ query: "q", maxUrls: 1 }]);
    assert.deepEqual(events.at(-1), { type: "e2e_direct_settled", agentLoopModelCalls: 0, agentLoopEvents: 0, exitCode: 0 });
  });

  it("SIGTERM aborts the running call and exits 143 after shutdown", async (t) => {
    const root = await setup(t);
    const { spawn } = await import("node:child_process");
    const child = spawn(process.execPath, driverArgs(root, { query: "wait-abort" }), { cwd: join(root, "ws"), env: env(root), stdio: "ignore" });
    const exited = new Promise<number | null>((r) => child.on("exit", (code) => r(code)));
    for (let i = 0; i < 300 && !existsSync(join(root, "ws/started")); i += 1) await new Promise((r) => setTimeout(r, 100));
    assert.ok(existsSync(join(root, "ws/started")), "the call started");
    child.kill("SIGTERM");
    assert.equal(await exited, 143);
    assert.ok(existsSync(join(root, "ws/aborted")), "the tool saw the abort signal");
  });

  it("locates the host SDK from an npm bin link or the managed launcher, and drops null arguments", async (t) => {
    const root = await scratch(t, "e2e-sdk-resolve-");
    const pkg = join(root, "install/node_modules/@earendil-works/pi-coding-agent");
    await mkdir(join(pkg, "dist"), { recursive: true });
    await writeFile(join(pkg, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "9.9.9" }));
    await writeFile(join(pkg, "dist/cli.js"), "#!/usr/bin/env node\n");
    await mkdir(join(root, "install/node_modules/.bin"));
    const { symlink } = await import("node:fs/promises");
    await symlink("../@earendil-works/pi-coding-agent/dist/cli.js", join(root, "install/node_modules/.bin/pi"));
    assert.equal(resolveSdkFromHostBin(join(root, "install/node_modules/.bin/pi")), pkg);

    const agent = join(root, "agent");
    const managed = join(agent, "install/releases/9.9.9/node_modules/@earendil-works/pi-coding-agent");
    await mkdir(managed, { recursive: true });
    await writeFile(join(managed, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "9.9.9" }));
    await writeFile(join(agent, "install/current-version"), "9.9.9\n");
    await mkdir(join(agent, "bin"));
    await writeFile(join(agent, "bin/pi"), "#!/bin/sh\npi_current_file=$pi_agent_dir/install/current-version\n");
    assert.equal(resolveSdkFromHostBin(join(agent, "bin/pi")), managed);
    await writeFile(join(agent, "install/current-version"), "../../etc\n");
    assert.equal(resolveSdkFromHostBin(join(agent, "bin/pi")), undefined, "an unsafe version name is refused");
    await writeFile(join(root, "other"), "#!/bin/sh\necho hi\n");
    assert.equal(resolveSdkFromHostBin(join(root, "other")), undefined);

    assert.deepEqual(directArguments({ query: "q", maxUrls: null, domains: ["a"], focusPrompt: undefined }), { query: "q", domains: ["a"] });
  });

});
