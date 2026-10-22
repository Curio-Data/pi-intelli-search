// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// T33/C33 temporary R2 dry run against the public R1 APIs, plus the R1
// production non-activation check. Unit-mode evidence only: the R2 fetch
// path substitutes `operations.search`, so nothing here claims complete
// transport replay. Set NATIVE_REPLAY_PI_HOST for the installed host.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Value } from "typebox/value";
import {
  RAW_SENTINEL,
  createMainFixture,
  createRecording,
  createReplayBlock,
  fixtureFiles,
  importHost,
  installNetworkGuard,
  isolateProcess,
  keySummary,
  loadSourceNative,
  openSession,
  restoreWorkspace,
  selectHost,
  snapshotWorkspace,
  startStageFixture,
  syntheticPage,
  writeAgentConfig,
  writeEvidence,
  type MainFixture,
  type MainTurn,
  type SessionHandle,
  type StageFixture,
  type StageScript,
} from "./helpers/native-replay.js";
import { R2Widget, createR2DryRunExtension, manualWorkflowScript, type WidthHelpers } from "./helpers/native-replay-r2.js";

const isolation = await isolateProcess("t33");
const guard = installNetworkGuard();
const hostSelection = await selectHost();
const host = await importHost(hostSelection);
const source = await loadSourceNative();
const core = await import("../src/core/index.js");
const width = (await import(pathToFileURL(join(dirname(hostSelection.root), "pi-tui/dist/index.js")).href)) as WidthHelpers;
let main: MainFixture;
let stage: StageFixture;
const workspace = join(isolation.root, "workspace");
const snapshot = join(isolation.root, "workspace-s0");

const ALPHA = "https://docs.example.test/alpha";
const BETA = "https://docs.example.test/beta";
const MISSING = "https://docs.example.test/missing";
const pages = new Map([
  [ALPHA, syntheticPage("Alpha", "Alpha fact: the alpha limit is 7.")],
  [BETA, syntheticPage("Beta", "Beta fact: beta is two.")],
  [MISSING, { status: 404 }],
]);
const QM = "manual workflow query about alpha";

const stageScript: StageScript = ({ role, user }) => {
  const usage = { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24 };
  if (role === "search" && user.includes("failing")) return { status: 400, errorBody: JSON.stringify({ error: { message: "fixture permanent bad request" } }) };
  if (role === "search") return { text: `See [Alpha](${ALPHA}), [Missing](${MISSING}) and [Beta](${BETA}).`, usage };
  if (role === "extract") return { text: `Official docs, current.\n${user.includes("PAGE-MARKER:Beta") ? "Beta is two." : "Alpha limit is 7."}`, usage };
  if (role === "collate") return { text: "Alpha limit is 7 [S1]; beta is two [S2].", usage };
  return { text: "[]", usage };
};

const errorScript = [
  '// @options: {"timeout_ms": 20000}',
  "const out = {};",
  "try { await tools.intelli_fetch({ url: 'file:///etc/hostname' }); out.invalid = 'resolved'; } catch (error) { out.invalid = String(error.message).slice(0, 80); }",
  "try { const r = await tools.intelli_fetch({ url: " + JSON.stringify(MISSING) + " }); out.missing = { outcome: r.outcome, state: r.sources[0].state, diagnostic: r.sources[0].diagnostic }; } catch (error) { out.missing = String(error.message).slice(0, 80); }",
  "const failing = await tools.intelli_search({ query: 'r2 failing search' }).catch((error) => ({ rejected: String(error.message).slice(0, 80) }));",
  "out.failingSearch = failing.rejected ? failing : { outcome: failing.outcome, attempts: failing.accounting.attempts };",
  "return JSON.stringify(out);",
].join("\n");

const turns: MainTurn[] = [
  { toolCalls: [{ name: "codemode", args: { code: manualWorkflowScript(QM, 3, 60_000) } }] },
  { toolCalls: [{ name: "codemode", args: { code: errorScript } }] },
  { text: "Done." },
];

let widget: R2Widget | undefined;
const currentWidget = (): R2Widget | undefined => widget;
const r2 = (transports: { registryStreamSimple?: never; pageTransport?: never }) =>
  createR2DryRunExtension({ native: source.module, core, width, ...transports, onWidget: (w) => (widget = w) });

async function run(factory: unknown, codemode: "on" | "off", phase: string, ports: number[], script = turns, explicitTools?: string[]) {
  main.setScript(script);
  guard.setPhase(phase, ports);
  // Activate the four tools (and codemode) without an allowlist, so the
  // script-only fetch stays registered but undeclared.
  const tools = explicitTools ?? ["intelli_search", "intelli_extract", "intelli_collate", "intelli_research", ...(codemode === "on" ? ["codemode"] : [])];
  const handle = await openSession({ host, agentDir: isolation.agentDir, workspace, main, nativeFactory: factory as never, codemode, tools, activateOnly: explicitTools === undefined });
  const writes = { console: 0, stderr: 0 };
  const restore: Array<() => void> = [];
  for (const name of ["log", "info", "warn", "error", "debug"] as const) {
    const original = console[name];
    console[name] = (...args: unknown[]) => {
      writes.console++;
      void args;
    };
    restore.push(() => (console[name] = original));
  }
  const stderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((...args: Parameters<typeof process.stderr.write>) => {
    writes.stderr++;
    return stderrWrite(...args);
  }) as typeof process.stderr.write;
  restore.push(() => (process.stderr.write = stderrWrite));
  try {
    await handle.session.prompt("Run the manual R2 workflow.");
  } finally {
    restore.forEach((fn) => fn());
    guard.setPhase("idle", [stage.port]);
  }
  const bodies = [...main.rawBodies];
  handle.dispose();
  return { handle, bodies, writes };
}

const ends = (handle: SessionHandle) =>
  handle.events.filter((e) => (e as { type?: string }).type === "tool_execution_end") as Array<{
    toolName: string;
    toolCallId: string;
    isError: boolean;
    result: { content: Array<{ text?: string }>; structuredContent?: unknown; details?: Record<string, unknown> };
  }>;

before(async () => {
  main = await createMainFixture(hostSelection.root);
  stage = await startStageFixture();
  stage.setScript(stageScript);
  await writeAgentConfig(isolation.agentDir, stage.baseUrl);
  await mkdir(workspace, { recursive: true });
  await snapshotWorkspace(workspace, snapshot);
});

after(async () => {
  guard.restore();
  await stage?.close();
  if (!process.env.NATIVE_REPLAY_KEEP) await rm(isolation.root, { recursive: true, force: true });
});

/** Registration surface seen by a minimal host API. */
function registrations(factory: (pi: never) => void, withSentinel: boolean) {
  const tools: Array<Record<string, unknown>> = [];
  const events: string[] = [];
  factory({
    registerTool: (tool: Record<string, unknown>) => tools.push(tool),
    on: (name: string) => events.push(name),
    ...(withSentinel ? { registerMcpServer() {} } : {}),
  } as never);
  return { tools, events };
}

describe(`temporary R2 dry run against public R1 APIs on ${hostSelection.kind} Pi ${hostSelection.version} (T33)`, () => {
  it("R1 production activates no R2 exposure, schema, fetch tool or widget", () => {
    const r1 = registrations(source.module.default as never, true);
    assert.deepEqual(r1.tools.map((t) => t.name), ["intelli_search", "intelli_extract", "intelli_collate", "intelli_research"]);
    for (const tool of r1.tools) {
      assert.equal(tool.outputSchema, undefined, `${String(tool.name)} declares no output schema in R1`);
      assert.equal(tool.exposure, undefined, `${String(tool.name)} keeps default direct exposure in R1`);
    }
    assert(!r1.events.some((name) => name.startsWith("tool_execution_")), "no widget subscriptions in R1");
    const gated = registrations(r2({}) as never, false);
    assert(!gated.tools.some((t) => t.name === "intelli_fetch"), "hosts without the capability sentinel register no fetch tool");
    const r2tools = registrations(r2({}) as never, true).tools;
    const fetchTool = r2tools.find((t) => t.name === "intelli_fetch");
    assert.equal(fetchTool?.exposure, "codemode");
    assert.deepEqual(fetchTool?.annotations, { readOnlyHint: true, openWorldHint: true });
    for (const tool of r2tools) assert.equal(tool.outputSchema, core.operationOutputSchemas[tool.name as keyof typeof core.operationOutputSchemas]);
  });

  let files: ReturnType<typeof fixtureFiles>;
  
  it("records the manual workflow through real registered wrappers and the real Codemode bridge", async () => {
    await restoreWorkspace(snapshot, workspace);
    const recording = createRecording("r2-manual", pages);
    await run(r2({ registryStreamSimple: recording.modelTransport as never, pageTransport: recording.pageTransport as never }), "on", "r2-record", [stage.port]);
    files = fixtureFiles(recording);
    assert.deepEqual(guard.violations("r2-record"), []);
  });

  it("replays the dry run below the real policy with zero network; full schemas and structuredContent on every branch", async () => {
    await restoreWorkspace(snapshot, workspace);
    const block = createReplayBlock(files);
    widget = undefined;
    const replayed = await run(r2({ registryStreamSimple: block.modelTransport as never, pageTransport: block.pageTransport as never }), "on", "r2-replay", []);
    const all = ends(replayed.handle);
    const intelli = all.filter((e) => e.toolName.startsWith("intelli_"));
    const codemodeOut = all.filter((e) => e.toolName === "codemode").map((e) => e.result.content.map((c) => c.text ?? "").join("\n"));
    const schemaChecks = intelli.map((e) => ({
      tool: e.toolName,
      isError: e.isError,
      outcome: (e.result.structuredContent as { outcome?: string } | undefined)?.outcome ?? null,
      hasStructured: e.result.structuredContent !== undefined,
      valid: e.result.structuredContent !== undefined && Value.Check(core.operationOutputSchemas[e.toolName as keyof typeof core.operationOutputSchemas], e.result.structuredContent),
      errors: e.result.structuredContent === undefined ? [] : [...Value.Errors(core.operationOutputSchemas[e.toolName as keyof typeof core.operationOutputSchemas], e.result.structuredContent)].slice(0, 3).map((x) => `${x.instancePath} ${x.message}`),
      textEqualsData: e.result.structuredContent === undefined || (e.result.structuredContent as { text?: string }).text === e.result.content.map((c) => c.text ?? "").join(""),
    }));
    const firstTools = (JSON.parse(replayed.bodies[0] ?? "{}") as { tools?: Array<{ function?: { name?: string; description?: string } }> }).tools ?? [];
    const evidence = {
      host: hostSelection,
      class: "unit-dry-run (operations.search substitution for intelli_fetch); not complete replay",
      model: keySummary(block.modelStore),
      fetch: keySummary(block.fetchStore),
      misses: block.missErrors.map((e) => e.message),
      network: guard.events("r2-replay"),
      schemaChecks,
      codemodeOut,
      declaredTools: firstTools.map((t) => t.function?.name),
      fetchListedInCodemode: firstTools.find((t) => t.function?.name === "codemode")?.function?.description?.includes("intelli_fetch") ?? false,
      widget: { rows: currentWidget()?.rows.size, pruned: currentWidget()?.pruned, generation: currentWidget()?.generation },
      writes: replayed.writes,
      nestedFetchCarriedRaw: all.some((e) => e.toolName === "intelli_fetch" && JSON.stringify(e.result.structuredContent ?? "").includes(RAW_SENTINEL)),
    };
    await writeEvidence(isolation.root, "r2-replay", evidence);
    assert.deepEqual(evidence.network, []);
    assert.deepEqual(evidence.misses, []);
    assert.deepEqual(evidence.model.unconsumed, []);
    assert.deepEqual(evidence.fetch.unconsumed, []);
    // R1 gap pinned (reported): fetchPage() throws a bare TypeError for an
    // invalid URL before admission, so that branch carries no FullData and the
    // wrapper cannot return schema-matching structuredContent for it.
    const invalid = schemaChecks.filter((c) => c.tool === "intelli_fetch" && c.isError && !c.hasStructured);
    assert.equal(invalid.length, 1, "exactly the invalid-URL branch lacks structuredContent");
    assert(schemaChecks.some((c) => c.tool === "intelli_search" && c.isError && c.hasStructured && c.valid), "a dispatched error result carries schema-valid structuredContent");
    for (const check of schemaChecks.filter((c) => !invalid.includes(c))) {
      assert(check.hasStructured, `${check.tool} returned structuredContent`);
      assert(check.valid, `${check.tool} structuredContent matches its full schema: ${check.errors.join("; ")}`);
    }
    assert(schemaChecks.some((c) => c.tool === "intelli_fetch" && c.outcome === "completed"));
    assert(schemaChecks.some((c) => c.tool === "intelli_fetch" && c.outcome !== "completed"), "a degraded or failed fetch branch was exercised");
    assert(evidence.declaredTools.includes("codemode"));
    assert(!evidence.declaredTools.includes("intelli_fetch"), "fetch is script-only");
    assert(evidence.fetchListedInCodemode, "fetch is callable from scripts");
    assert(evidence.nestedFetchCarriedRaw, "raw page bytes did reach the script");
    for (const body of replayed.bodies) assert(!body.includes(RAW_SENTINEL), "script-reduced results keep raw bytes out of main requests");
    assert.equal(currentWidget()?.rows.size, 0, "rows were pruned when their parents ended");
    assert(Number(currentWidget()?.pruned) > 0);
    assert.deepEqual(replayed.writes, { console: 0, stderr: 0 }, "no raw console pollution");
  });

  it("keeps the four tools directly available with Codemode off and exposes no fetch declaration", async () => {
    await restoreWorkspace(snapshot, workspace);
    const recording = createRecording("r2-off", pages);
    const off = await run(
      r2({ registryStreamSimple: recording.modelTransport as never, pageTransport: recording.pageTransport as never }),
      "off",
      "r2-off",
      [stage.port],
      [{ toolCalls: [{ name: "intelli_search", args: { query: QM } }] }, { text: "Done." }],
    );
    const tools = ((JSON.parse(off.bodies[0] ?? "{}") as { tools?: Array<{ function?: { name?: string } }> }).tools ?? []).map((t) => t.function?.name).sort();
    assert.deepEqual(tools, ["intelli_collate", "intelli_extract", "intelli_research", "intelli_search"]);
    const search = ends(off.handle).find((e) => e.toolName === "intelli_search");
    assert(search?.result.structuredContent, "direct results carry structuredContent too");
  });

  it("enforces a finite script budget over a stalled nested fetch", async () => {
    await restoreWorkspace(snapshot, workspace);
    let settled = false;
    const stalled = (async (_url: string, request: { signal: AbortSignal }) =>
      new Promise((_, reject) =>
        request.signal.addEventListener(
          "abort",
          () => {
            settled = true;
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          },
          { once: true },
        ),
      )) as never;
    const script = ['// @options: {"timeout_ms": 400}', `const r = await tools.intelli_fetch({ url: ${JSON.stringify(ALPHA)} });`, "return r.outcome;"].join("\n");
    const started = performance.now();
    const budget = await run(r2({ pageTransport: stalled }), "on", "r2-budget", [], [{ toolCalls: [{ name: "codemode", args: { code: script } }] }, { text: "Done." }]);
    const elapsed = performance.now() - started;
    const out = ends(budget.handle).find((e) => e.toolName === "codemode");
    const text = out?.result.content.map((c) => c.text ?? "").join("\n") ?? "";
    await writeEvidence(isolation.root, "r2-budget", { host: hostSelection, elapsedMs: Math.round(elapsed), text, nestedSettledByReturn: settled, network: guard.events("r2-budget") });
    assert.match(text, /Script failed/);
    assert(elapsed < 10_000, `budgeted script returned in ${Math.round(elapsed)} ms`);
    assert.deepEqual(guard.events("r2-budget"), []);
  });

  it("renders widget rows within visible width for narrow, long, non-ASCII, combining, wide and resized output", () => {
    const w = new R2Widget(width);
    const update = (parent: string, op: string, message: string) =>
      w.update({ type: "tool_execution_update", toolName: "intelli_research", toolCallId: `${parent}/1`, parentToolCallId: parent, partialResult: { details: { operationId: op, message } } });
    update("p1", "op-a", "Fetching pages for a long query ".repeat(6));
    update("p1", "op-b", "Ünïcödé façade naïve");
    update("p2", "op-c", "ééé combining marks");
    update("p2", "op-d", "宽字符测试 🙂🙂🙂 wide glyphs");
    for (const columns of [80, 24, 12, 6]) {
      const lines = w.render(columns);
      assert.equal(lines.length, 4);
      for (const line of lines) assert(width.visibleWidth(line) <= columns, `${JSON.stringify(line)} fits ${columns}`);
    }
    w.update({ type: "tool_execution_end", toolName: "codemode", toolCallId: "p1" });
    assert.deepEqual([...w.rows.values()].map((row) => row.parentToolCallId), ["p2", "p2"], "pruning one parent keeps another live parent's rows");
    w.newGeneration();
    assert.equal(w.rows.size, 0);
    update("p2", "op-c", "after reload");
    assert.equal([...w.rows.keys()][0], `${w.generation}:p2:op-c`);
  });

  it("pins host semantics: an explicit tools allowlist naming intelli_fetch declares the script-only tool", async () => {
    await restoreWorkspace(snapshot, workspace);
    const recording = createRecording("r2-explicit", pages);
    const explicit = await run(
      r2({ registryStreamSimple: recording.modelTransport as never, pageTransport: recording.pageTransport as never }),
      "on",
      "r2-explicit",
      [stage.port],
      [{ text: "Done." }],
      ["codemode", "intelli_search", "intelli_fetch"],
    );
    const declared = ((JSON.parse(explicit.bodies[0] ?? "{}") as { tools?: Array<{ function?: { name?: string } }> }).tools ?? []).map((t) => t.function?.name);
    await writeEvidence(isolation.root, "r2-explicit", { host: hostSelection, declared });
    assert(declared.includes("intelli_fetch"), "explicit activation overrides codemode exposure (reported, not changed)");
  });
});
