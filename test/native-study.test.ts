// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Value } from "typebox/value";
import { createStudyExtension, studyActiveTools } from "../src/experimental/codemode-study.js";
import { operationOutputSchemas } from "../src/core/index.js";
import { manualResearchScript, breadthResearchScript, singleResearchScript, followupBaseScript, followupReadScript } from "../scripts/benchmarks/study-workflows.js";
import {
  createMainFixture, createRecording, createReplayBlock, fixtureFiles,
  importHost, isolateProcess, openSession, selectHost, startStageFixture,
  syntheticPage, writeAgentConfig, type MainTurn, type SessionHandle,
} from "./helpers/native-replay.js";

const isolation = await isolateProcess("native-study");
const selected = await selectHost();
const host = await importHost(selected);
const main = await createMainFixture(selected.root);
const stage = await startStageFixture();
const workspace = join(isolation.root, "workspace");
const url = "https://docs.example.test/study";
const pages = new Map([[url, syntheticPage("Study", "The documented limit is seven.")]]);
const query = "What is the documented limit?";

before(async () => {
  await mkdir(workspace, { recursive: true });
  await writeAgentConfig(isolation.agentDir, stage.baseUrl);
  stage.setScript(({ role }) => ({
    text: role === "search" ? `Source: [Study](${url})` : "The documented limit is seven.",
    usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
  }));
});
after(async () => {
  await stage.close();
  if (!process.env.NATIVE_REPLAY_KEEP) await rm(isolation.root, { recursive: true, force: true });
});

function results(handle: SessionHandle, tool: string) {
  return handle.toolEvents.filter((e) => e.type === "tool_execution_end" && e.toolName === tool)
    .map((e) => ({ ...(e.result as { content: Array<{ text: string }>; structuredContent?: Record<string, unknown> }), isError: Boolean(e.isError) }));
}
function catalogue(handle: SessionHandle) {
  const payload = handle.captures[0].payload as { tools: Array<{ function: { name: string; description: string } }> };
  return payload.tools.map((t) => t.function);
}

// This is actual-wrapper/host integration with synthetic provider responses,
// not a measured live model comparison or a claim of token savings.
test(`study off/on wrappers and transport replay on Pi ${selected.version}`, async () => {
  const record = createRecording("study-manual", pages);
  const off = await openSession({
    host, agentDir: isolation.agentDir, workspace, main,
    nativeFactory: createStudyExtension("off", { registryStreamSimple: record.modelTransport, pageTransport: record.pageTransport }) as never,
    codemode: "off", activateOnly: true,
    tools: studyActiveTools("off"),
  });
  let page: Record<string, unknown>;
  try {
    main.setScript([
      { toolCalls: [{ name: "intelli_fetch", args: { url, maxChars: 4000 } }] },
      { text: "Fetched." },
    ]);
    await off.session.prompt("Fetch the study source.");
    const fetched = results(off, "intelli_fetch")[0];
    assert(Value.Check(operationOutputSchemas.intelli_fetch, fetched.structuredContent));
    assert.deepEqual(JSON.parse(fetched.content[0].text), fetched.structuredContent);
    page = (fetched.structuredContent!.sources as Array<Record<string, unknown>>)[0];
    assert.equal(typeof page.content, "string");
    main.setScript([
      { toolCalls: [{ name: "intelli_extract", args: { url, title: page.title, content: page.content, query, focusPrompt: "Preserve the documented limit." } }] },
      { text: "Extracted." },
    ]);
    await off.session.prompt("Extract the documented limit.");
    assert(Value.Check(operationOutputSchemas.intelli_extract, results(off, "intelli_extract")[0].structuredContent));
    const names = catalogue(off).map((t) => t.name);
    assert(names.includes("intelli_fetch"));
    assert(!names.includes("codemode"));
  } finally { off.dispose(); }

  const files = fixtureFiles(record);
  for (const arm of ["on", "only"] as const) {
    const replay = createReplayBlock(files);
    const on = await openSession({
      host, agentDir: isolation.agentDir, workspace, main,
      nativeFactory: createStudyExtension(arm, { mode: "transport-replay", registryStreamSimple: replay.modelTransport, pageTransport: replay.pageTransport }) as never,
      codemode: arm, activateOnly: true,
      tools: studyActiveTools(arm),
    });
    const code = [
      '// @options: {"timeout_ms": 60000}',
      `const fetched = await tools.intelli_fetch({ url: ${JSON.stringify(url)}, maxChars: 4000 });`,
      "const page = fetched.sources[0];",
      `const extracted = await tools.intelli_extract({ url: page.url, title: page.title, content: page.content, query: ${JSON.stringify(query)}, focusPrompt: "Preserve the documented limit." });`,
      "return { outcome: extracted.outcome, summary: extracted.summary };",
    ].join("\n");
    try {
      main.setScript([{ toolCalls: [{ name: "codemode", args: { code } }] }, { text: "Done." }] satisfies MainTurn[]);
      await on.session.prompt("Fetch and extract the study source.");
      replay.modelStore.assertValid();
      replay.fetchStore.assertValid();
      assert.deepEqual(replay.modelStore.unconsumed(), []);
      assert.deepEqual(replay.fetchStore.unconsumed(), []);
      assert.deepEqual(replay.missErrors, []);
      assert.deepEqual((results(on, "intelli_fetch")[0].structuredContent!.sources as unknown[])[0], page!);
      assert(Value.Check(operationOutputSchemas.intelli_extract, results(on, "intelli_extract")[0].structuredContent));
      const tools = catalogue(on);
      assert(!tools.some((t) => t.name === "intelli_fetch"));
      assert(tools.find((t) => t.name === "codemode")?.description.includes("intelli_fetch"));
      const last = JSON.stringify(on.captures.at(-1)?.payload);
      assert(!last.includes(String(page!.content)), "script does not expose the fetched page body to main");
      if (arm === "only") assert.deepEqual(tools.map((t) => t.name), ["codemode"]);
      else assert(tools.some((t) => t.name === "intelli_research"));
    } finally { on.dispose(); }
  }
});

test("bounded manual example runs all four real stages and replays through direct tools", async () => {
  const budget = { maxPages: 2, maxChars: 4000, timeoutMs: 60_000, maxOutputTokens: 2000 };
  const task = { query, focusPrompt: "Preserve the documented limit." };
  const record = createRecording("study-manual-complete", pages);
  const handle = await openSession({
    host, agentDir: isolation.agentDir, workspace, main,
    nativeFactory: createStudyExtension("on", { registryStreamSimple: record.modelTransport, pageTransport: record.pageTransport }) as never,
    codemode: "on", activateOnly: true,
    tools: studyActiveTools("on"),
  });
  let calls: Array<{ name: string; args: Record<string, unknown> }>;
  try {
    main.setScript([{ toolCalls: [{ name: "codemode", args: { code: manualResearchScript(task, budget) } }] }, { text: "Done." }]);
    await handle.session.prompt("Run the complete manual example.");
    assert.equal(results(handle, "codemode")[0].isError, false);
    assert.equal(results(handle, "intelli_collate")[0].structuredContent!.outcome, "completed");
    calls = handle.toolEvents.filter((e) => e.type === "tool_execution_start" && String(e.toolName).startsWith("intelli_"))
      .map((e) => ({ name: String(e.toolName), args: e.args as Record<string, unknown> }));
    assert.deepEqual(calls.map((c) => c.name), ["intelli_search", "intelli_fetch", "intelli_extract", "intelli_collate"]);
  } finally { handle.dispose(); }
  const replay = createReplayBlock(fixtureFiles(record));
  const direct = await openSession({
    host, agentDir: isolation.agentDir, workspace, main,
    nativeFactory: createStudyExtension("off", { mode: "transport-replay", registryStreamSimple: replay.modelTransport, pageTransport: replay.pageTransport }) as never,
    codemode: "off", activateOnly: true,
    tools: studyActiveTools("off"),
  });
  try {
    main.setScript([...calls!.map((call) => ({ toolCalls: [call] })), { text: "Done." }]);
    await direct.session.prompt("Run the same manual stages directly.");
    replay.modelStore.assertValid(); replay.fetchStore.assertValid();
    assert.deepEqual(replay.modelStore.unconsumed(), []);
    assert.deepEqual(replay.fetchStore.unconsumed(), []);
    assert.equal(results(direct, "intelli_collate")[0].structuredContent!.outcome, "completed");
  } finally { direct.dispose(); }
  assert.throws(() => manualResearchScript(task, { ...budget, maxPages: Infinity }));
  assert.throws(() => singleResearchScript({ ...task, focusPrompt: "" }, budget));
  assert.throws(() => breadthResearchScript([task, task, task], budget));
  const breadth = breadthResearchScript([task, task], { ...budget, maxPages: 5 });
  assert(breadth.includes('"maxUrls":3') && breadth.includes('"maxUrls":2'));
  const declaredBreadth = breadthResearchScript([task, task, task], { ...budget, maxPages: 12 });
  const requests = JSON.parse(declaredBreadth.split("\n")[1].slice("const requests = ".length, -1)) as Array<{ maxUrls: number }>;
  assert.deepEqual(requests.map((request) => request.maxUrls), [4, 4, 4]);
  assert.equal(requests.reduce((sum, request) => sum + request.maxUrls, 0), 12);
});

test("cache follow-up reads a real committed report with no additional pipeline call in either arm", async () => {
  const budget = { maxPages: 1, maxChars: 4000, timeoutMs: 60_000, maxOutputTokens: 2000 };
  for (const arm of ["off", "on"] as const) {
    const cwd = join(isolation.root, `followup-${arm}`);
    await mkdir(cwd);
    const record = createRecording(`study-followup-${arm}`, pages);
    const handle = await openSession({ host, agentDir: isolation.agentDir, workspace: cwd, main,
      nativeFactory: createStudyExtension(arm, { registryStreamSimple: record.modelTransport, pageTransport: record.pageTransport }) as never,
      codemode: arm, activateOnly: true, tools: studyActiveTools(arm),
    });
    try {
      const task = { query, focusPrompt: "Preserve the documented limit." };
      main.setScript([{ toolCalls: arm === "off"
        ? [{ name: "intelli_research", args: { ...task, maxUrls: 1 } }]
        : [{ name: "codemode", args: { code: followupBaseScript(task, budget) } }] }, { text: "Base answer." }]);
      await handle.session.prompt("Research the documented limit.");
      const base = results(handle, "intelli_research")[0].structuredContent!;
      const cache = base.cache as { status: string; reportPath: string };
      assert.equal(cache.status, "committed");
      const before = record.registryCalls();
      main.setScript([{ toolCalls: arm === "off"
        ? [{ name: "read", args: { path: cache.reportPath } }]
        : [{ name: "codemode", args: { code: followupReadScript(budget) } }] }, { text: "Follow-up answer." }]);
      await handle.session.prompt("Use the saved report to answer the follow-up without another search.");
      assert.equal(record.registryCalls(), before);
      const read = results(handle, "read").at(-1)!;
      assert.equal(read.isError, false);
      assert(read.content.some((block) => block.text.includes("documented limit is seven")));
      assert(catalogue(handle).some((tool) => tool.name === "read"));
    } finally { handle.dispose(); }
  }
});

test("study fetch keeps structured partial failure and rejects invalid input without model work", async () => {
  const record = createRecording("study-errors", new Map());
  for (const arm of ["off", "on"] as const) {
    const handle = await openSession({
      host, agentDir: isolation.agentDir, workspace, main,
      nativeFactory: createStudyExtension(arm, { registryStreamSimple: record.modelTransport, pageTransport: record.pageTransport }) as never,
      codemode: arm, activateOnly: true,
      tools: studyActiveTools(arm),
    });
    try {
      const calls = arm === "off"
        ? [{ name: "intelli_fetch", args: { url } }]
        : [{ name: "codemode", args: { code: `// @options: {"timeout_ms": 60000}\nreturn await tools.intelli_fetch({url: ${JSON.stringify(url)}});` } }];
      main.setScript([{ toolCalls: calls }, { text: "Done." }]);
      await handle.session.prompt("Attempt the missing page.");
      const fetched = results(handle, "intelli_fetch")[0];
      assert(Value.Check(operationOutputSchemas.intelli_fetch, fetched.structuredContent));
      assert.equal(fetched.structuredContent!.outcome, "fetch-failed");
      assert.deepEqual(fetched.structuredContent!.attempts, []);
      main.setScript([{ toolCalls: arm === "off"
        ? [{ name: "intelli_fetch", args: { url, maxChars: 0 } }]
        : [{ name: "codemode", args: { code: '// @options: {"timeout_ms": 60000}\nreturn await tools.intelli_fetch({url:"file:///invalid"});' } }] }, { text: "Done." }]);
      await handle.session.prompt("Try an invalid argument.");
      assert.equal(results(handle, arm === "off" ? "intelli_fetch" : "codemode").at(-1)?.isError, true);
      assert.equal(record.registryCalls(), 0);
    } finally { handle.dispose(); }
  }
});
