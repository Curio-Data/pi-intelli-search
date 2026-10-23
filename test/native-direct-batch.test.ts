// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// M4 K1 qualification: direct (non-Codemode) native research batches on an
// actual AgentSession. The scripted main model issues several registered
// tool calls in ONE assistant message; the installed agent loop then chooses
// parallel or sequential batch execution from tool executionMode and the
// agent's toolExecution field (pi-agent-core agent-loop executeToolCalls).
//
// Evidence class: loopback RECORD phase, not zero-network replay. Pipeline
// stages go through the real host registry to the private loopback stage
// fixture; pages come from synthetic in-process bytes through the real
// FetchClient. The main model is the in-process scripted fixture. No
// credential, live provider, page or catalogue is used, and the network and
// auth tripwires stay installed. Set NATIVE_REPLAY_PI_HOST to an installed
// pi-coding-agent root for the explicit installed-host run.
//
// Overlap is judged from actual operation admission (run-store allocation
// through the native suggestion read seam) and in-flight stage requests,
// never from host tool_execution_start events, which the host can emit
// before a call waits.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { IndexCandidate, PageTransport } from "../src/core/contracts.js";
import type { NativeSuggestionReadView } from "../src/native-injection.js";
import {
  REPO_ROOT,
  MAX_RESPONSE_BYTES,
  RAW_SENTINEL,
  countAuthResolution,
  createMainFixture,
  createRecording,
  importHost,
  installNetworkGuard,
  isolateProcess,
  loadSourceNative,
  openSession,
  selectHost,
  startStageFixture,
  syntheticPage,
  writeAgentConfig,
  writeEvidence,
  type HostSelection,
  type MainFixture,
  type MainTurn,
  type NetworkGuard,
  type PipelineSettings,
  type SessionHandle,
  type StageFixture,
  type StageReply,
  type StageRole,
} from "./helpers/native-replay.js";

const isolation = await isolateProcess("direct-batch", join(REPO_ROOT, ".tmp/m4-batch"));
const guard: NetworkGuard = installNetworkGuard();
const hostSelection: HostSelection = await selectHost();
const host = await importHost(hostSelection);
const source = await loadSourceNative();
const auth = countAuthResolution(host as unknown as Record<string, unknown>, () => guard.phase());
let main: MainFixture;
let stage: StageFixture;

const QA = "direct batch alpha research";
const QB = "direct batch bravo research";
/** Its search is permanently rejected (HTTP 400) after actual dispatch. */
const QF = "direct batch failing research";
const QC = "direct batch standalone collate";
const page = (id: string) => `https://docs.example.test/${id.toLowerCase()}`;
const PAGES: Record<string, readonly string[]> = { [QA]: ["A1", "A2"], [QB]: ["B1", "B2"] };
const pages = new Map(
  Object.values(PAGES)
    .flat()
    .map((id) => [page(id), syntheticPage(id, `${id} fact: the ${id} limit is ${id.length}.`)]),
);

const usage = (prompt: number, completion: number) => ({
  prompt_tokens: prompt,
  completion_tokens: completion,
  total_tokens: prompt + completion,
});
/** Wire usage per role; the ledger must sum exactly these per operation. */
const ROLE_USAGE: Record<StageRole, { prompt: number; completion: number }> = {
  search: { prompt: 50, completion: 10 },
  extract: { prompt: 300, completion: 20 },
  collate: { prompt: 120, completion: 15 },
  suggest: { prompt: 70, completion: 8 },
};

// ── Stage attribution and in-flight accounting ─────────────────────────────

/** Owning operation of one stage request, from exact request content. */
function ownerOf(role: StageRole, user: string): string {
  if (role === "search") return [QA, QB, QF].find((q) => user.startsWith(q)) ?? "unknown";
  if (role === "extract") {
    const marker = /PAGE-MARKER:([A-Za-z0-9]+)/.exec(user)?.[1];
    return Object.entries(PAGES).find(([, ids]) => marker && ids.includes(marker))?.[0] ?? "unknown";
  }
  if (role === "suggest") return /^Current query: "([^"]+)"/.exec(user)?.[1] ?? "unknown";
  return (JSON.parse(user) as { query?: string }).query ?? "unknown";
}

interface StageRow {
  readonly role: StageRole;
  readonly owner: string;
  readonly arrivedMs: number;
  settledMs?: number;
}

interface Meter {
  readonly rows: StageRow[];
  peak: number;
  peakByRole: Record<StageRole, number>;
  /** Search rendezvous outcome: did both searches arrive before either was answered? */
  rendezvous: "pending" | "met" | "timeout" | "unused";
}

interface ScriptOptions {
  /** Hold each research's first search until the other's search arrives, or until this many ms. */
  readonly searchRendezvousMs?: number;
  /** Extra hold on every extraction response (creates page-class pressure). */
  readonly extractHoldMs?: number;
  /** Owners whose search the fixture rejects with a permanent 400 (no usage on the wire). */
  readonly rejectSearch?: readonly string[];
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The stage script answers from content and tracks in-flight requests. Each
 * reply resolves its `after` only when it is about to be written, so the
 * in-flight count never over-counts: the next attempt cannot arrive before
 * its permit is released, which follows the response.
 */
function scriptStage(options: ScriptOptions = {}): Meter {
  const started = performance.now();
  const meter: Meter = {
    rows: [],
    peak: 0,
    peakByRole: { search: 0, extract: 0, collate: 0, suggest: 0 },
    rendezvous: options.searchRendezvousMs === undefined ? "unused" : "pending",
  };
  const inFlight = { all: 0, search: 0, extract: 0, collate: 0, suggest: 0 };
  let meet: () => void = () => {};
  const met = new Promise<void>((resolve) => {
    meet = resolve;
  });
  const searchOwners = new Set<string>();
  stage.setScript(({ role, user }) => {
    const owner = ownerOf(role, user);
    const row: StageRow = { role, owner, arrivedMs: performance.now() - started };
    meter.rows.push(row);
    inFlight.all++;
    inFlight[role]++;
    meter.peak = Math.max(meter.peak, inFlight.all);
    meter.peakByRole[role] = Math.max(meter.peakByRole[role], inFlight[role]);
    let hold: Promise<unknown> = Promise.resolve();
    if (role === "search" && options.searchRendezvousMs !== undefined) {
      searchOwners.add(owner);
      if (searchOwners.size >= 2 && meter.rendezvous === "pending") {
        meter.rendezvous = "met";
        meet();
      }
      hold = Promise.race([
        met,
        sleep(options.searchRendezvousMs).then(() => {
          if (meter.rendezvous === "pending") meter.rendezvous = "timeout";
        }),
      ]);
    }
    if (role === "extract" && options.extractHoldMs) hold = sleep(options.extractHoldMs);
    const settle = hold.then(() => {
      inFlight.all--;
      inFlight[role]--;
      row.settledMs = performance.now() - started;
    });
    const { prompt, completion } = ROLE_USAGE[role];
    const reply = (text: string): StageReply => ({ text, usage: usage(prompt, completion), after: settle });
    switch (role) {
      case "search": {
        if (options.rejectSearch?.includes(owner))
          return {
            status: 400,
            errorBody: JSON.stringify({ error: { message: "fixture permanent bad request" } }),
            after: settle,
          };
        const ids = PAGES[owner] ?? [];
        return reply(`Answer for ${owner}: ${ids.map((id) => `[${id}](${page(id)})`).join(" and ")}.`);
      }
      case "extract":
        return reply(`Official docs, current.\nExtracted facts for ${owner}.`);
      case "collate":
        return reply(`Synthesis for ${owner} [S1].`);
      case "suggest":
        return reply("[]");
    }
  });
  return meter;
}

// ── Actual admission and publication probe ──────────────────────────────────

type AdmissionEvent =
  | { readonly kind: "allocated"; readonly operationId: string; readonly query: string; readonly runId: string; readonly atMs: number }
  | { readonly kind: "indexed"; readonly operationId: string; readonly runId: string; readonly atMs: number }
  | { readonly kind: "unavailable"; readonly operationId: string; readonly phase: string; readonly atMs: number };

/**
 * Pass-through controller for the native suggestion read seam: it observes
 * real run-store allocation and index publication and returns the actual
 * verified read unchanged, so suggestions behave as without a controller.
 */
function admissionProbe(): { controller: NativeSuggestionReadView; log: AdmissionEvent[] } {
  const started = performance.now();
  const log: AdmissionEvent[] = [];
  const at = () => performance.now() - started;
  return {
    log,
    controller: {
      allocated: (input) =>
        void log.push({
          kind: "allocated",
          operationId: input.operationId,
          query: input.query,
          runId: input.reservation.runId,
          atMs: at(),
        }),
      indexed: (input) =>
        void log.push({
          kind: "indexed",
          operationId: input.operationId,
          runId: input.run.reservation.runId,
          atMs: at(),
        }),
      unavailable: (input) =>
        void log.push({ kind: "unavailable", operationId: input.operationId, phase: input.phase, atMs: at() }),
      candidates: async (input): Promise<readonly IndexCandidate[]> => input.readVerified(),
    },
  };
}

/** Wraps the recording page transport with a timing hold and an in-flight meter. */
function meteredPages(inner: PageTransport, holdMs: number) {
  const state = { inFlight: 0, peak: 0, calls: 0 };
  const transport: PageTransport = async (url, request) => {
    state.calls++;
    state.inFlight++;
    state.peak = Math.max(state.peak, state.inFlight);
    try {
      if (holdMs > 0) await sleep(holdMs);
      return await inner(url, request);
    } finally {
      state.inFlight--;
    }
  };
  return { transport, state };
}

// ── Session driver ──────────────────────────────────────────────────────────

const researchCall = (query: string) => ({
  name: "intelli_research",
  args: { query, maxUrls: 2, focusPrompt: `facts for ${query}` },
});
const collateCall = {
  name: "intelli_collate",
  args: {
    query: QC,
    extractions: [
      {
        url: page("A1"),
        title: "A1",
        extraction: "A1 limit is 2.",
        sourceType: "official-docs",
        status: "success",
      },
    ],
  },
};

interface BatchRun {
  readonly handle: SessionHandle;
  readonly meter: Meter;
  readonly admissions: AdmissionEvent[];
  readonly pages: { inFlight: number; peak: number; calls: number };
  readonly registryCalls: number;
  readonly promptError: string | null;
  readonly mainBodies: string[];
  readonly toolExecutionBefore: unknown;
  readonly toolExecutionDuring: unknown;
}

async function runBatch(input: {
  readonly phase: string;
  readonly calls: MainTurn["toolCalls"];
  readonly settings?: PipelineSettings;
  readonly script?: ScriptOptions;
  readonly pageHoldMs?: number;
  /** Host-wide control: the installed Agent's public toolExecution field. */
  readonly hostSequential?: boolean;
}): Promise<BatchRun> {
  const workspace = join(isolation.root, `workspace-${input.phase}`);
  await mkdir(workspace, { recursive: true });
  await writeAgentConfig(isolation.agentDir, stage.baseUrl, {
    defaultUrls: 2,
    maxUrls: 2,
    ...input.settings,
  });
  const meter = scriptStage(input.script);
  const probe = admissionProbe();
  const recording = createRecording(input.phase, pages);
  const metered = meteredPages(recording.pageTransport, input.pageHoldMs ?? 0);
  main.setScript([
    { toolCalls: input.calls, usage: usage(900, 40) },
    { text: "Done.", usage: usage(1200, 6) },
  ]);
  guard.setPhase(input.phase, [stage.port]);
  const handle = await openSession({
    host,
    agentDir: isolation.agentDir,
    workspace,
    main,
    nativeFactory: source.module.createNativeExtension({
      mode: "unit",
      registryStreamSimple: recording.modelTransport,
      pageTransport: metered.transport,
      suggestionReadView: probe.controller,
    }) as never,
    codemode: "off",
  });
  const agent = (handle.session as unknown as { agent: { toolExecution: unknown } }).agent;
  const toolExecutionBefore = agent.toolExecution;
  if (input.hostSequential) agent.toolExecution = "sequential";
  const toolExecutionDuring = agent.toolExecution;
  let promptError: string | null = null;
  try {
    await handle.session.prompt("Run the direct batch.");
  } catch (error) {
    promptError = String(error);
  } finally {
    guard.setPhase("idle", [stage.port]);
  }
  const mainBodies = [...main.rawBodies];
  handle.dispose();
  return {
    handle,
    meter,
    admissions: probe.log,
    pages: metered.state,
    registryCalls: recording.registryCalls(),
    promptError,
    mainBodies,
    toolExecutionBefore,
    toolExecutionDuring,
  };
}

// ── Interpretation ──────────────────────────────────────────────────────────

type ToolEnd = {
  toolName: string;
  toolCallId: string;
  isError: boolean;
  result: { content?: Array<{ text?: string }>; details?: { intelli?: Record<string, unknown> } };
};

const ends = (handle: SessionHandle) =>
  handle.events.filter(
    (event) =>
      (event as { type?: string }).type === "tool_execution_end" &&
      String((event as { toolName?: string }).toolName).startsWith("intelli_"),
  ) as unknown as ToolEnd[];

/** Host start/end order for intelli tools, as toolName:start|end. */
const hostOrder = (handle: SessionHandle) =>
  handle.toolEvents
    .filter((event) => String(event.toolName).startsWith("intelli_") && event.type !== "tool_execution_update")
    .map((event) => `${String(event.toolName)}:${String(event.type).replace("tool_execution_", "")}`);

/** The call's own query, from the host start event's arguments for the same toolCallId. */
const queryOf = (handle: SessionHandle, end: ToolEnd) =>
  String(
    (
      handle.toolEvents.find(
        (event) => event.type === "tool_execution_start" && event.toolCallId === end.toolCallId,
      )?.args as { query?: unknown } | undefined
    )?.query ?? "",
  );

/** Queries allocated before the first index publication of the batch. */
function allocatedBeforeFirstPublication(log: readonly AdmissionEvent[]): string[] {
  const first = log.findIndex((event) => event.kind === "indexed");
  return log
    .slice(0, first === -1 ? log.length : first)
    .filter((event): event is Extract<AdmissionEvent, { kind: "allocated" }> => event.kind === "allocated")
    .map((event) => event.query);
}

/** Per-query ordered operation lifecycles: [allocated, indexed] positions in the log. */
function lifecycles(log: readonly AdmissionEvent[]) {
  return log
    .filter((event): event is Extract<AdmissionEvent, { kind: "allocated" }> => event.kind === "allocated")
    .map((allocation) => ({
      query: allocation.query,
      allocated: log.indexOf(allocation),
      indexed: log.findIndex((event) => event.kind === "indexed" && event.runId === allocation.runId),
    }));
}

function accountingOf(end: ToolEnd) {
  const data = (end.result.details?.intelli ?? {}) as Record<string, unknown>;
  return (data.accounting ?? {}) as {
    attempts?: number;
    observedAttempts?: number;
    missingAttempts?: number;
    tokens?: { inputTotal?: number; outputTotal?: number; totalTokens?: number };
    estimatedCost?: { input?: number; output?: number };
  };
}

/** Expected exact attempts and wire tokens per owner, from stage-observed requests. */
function stageTotals(rows: readonly StageRow[], owner: string) {
  const own = rows.filter((row) => row.owner === owner);
  return {
    attempts: own.length,
    input: own.reduce((sum, row) => sum + ROLE_USAGE[row.role].prompt, 0),
    output: own.reduce((sum, row) => sum + ROLE_USAGE[row.role].completion, 0),
  };
}

function evidenceOf(run: BatchRun) {
  return {
    host: hostSelection,
    evidenceClass: "loopback-record (not zero-network replay)",
    toolExecution: { before: run.toolExecutionBefore, during: run.toolExecutionDuring },
    promptError: run.promptError,
    hostOrder: hostOrder(run.handle),
    admissions: run.admissions,
    stage: {
      rendezvous: run.meter.rendezvous,
      peak: run.meter.peak,
      peakByRole: run.meter.peakByRole,
      rows: run.meter.rows,
    },
    pages: run.pages,
    registryCalls: run.registryCalls,
    results: ends(run.handle).map((end) => ({
      tool: end.toolName,
      query: queryOf(run.handle, end),
      isError: end.isError,
      outcome: end.result.details?.intelli?.outcome,
      accounting: accountingOf(end),
    })),
  };
}

/** Invariants every batch keeps: tripwires, delivery, exact ledger and no raw page bytes in main. */
function assertCommon(run: BatchRun, phase: string, expected: readonly string[]) {
  assert.equal(run.promptError, null);
  assert.deepEqual(guard.violations(phase), [], JSON.stringify(guard.violations(phase)));
  assert.equal(run.registryCalls, run.meter.rows.length, "every stage attempt went through the host registry");
  assert(!run.meter.rows.some((row) => row.owner === "unknown"), "every stage request attributed");
  for (const body of run.mainBodies) assert(!body.includes(RAW_SENTINEL), "no raw page bytes reach main");
  const results = ends(run.handle);
  const q = (end: ToolEnd) => queryOf(run.handle, end);
  assert.deepEqual(results.map(q).sort(), [...expected].sort(), "one host end per call");
  for (const end of results) {
    assert.equal(end.isError, false, `${end.toolName} ${q(end)} succeeded`);
    const accounting = accountingOf(end);
    const totals = stageTotals(run.meter.rows, q(end));
    assert.equal(accounting.attempts, totals.attempts, `${q(end)} attempts are exactly its own`);
    assert.equal(accounting.observedAttempts, totals.attempts);
    assert.equal(accounting.missingAttempts, 0);
    assert.equal(accounting.tokens?.inputTotal, totals.input, `${q(end)} input tokens are exactly its own`);
    assert.equal(accounting.tokens?.outputTotal, totals.output);
    assert.equal(accounting.tokens?.totalTokens, totals.input + totals.output);
    // Fixture catalogue cost: 1 per million input, 2 per million output tokens.
    assert(Math.abs((accounting.estimatedCost?.input ?? NaN) - totals.input * 1e-6) < 1e-12);
    assert(Math.abs((accounting.estimatedCost?.output ?? NaN) - totals.output * 2e-6) < 1e-12);
  }
  const allocations = run.admissions.filter((event) => event.kind === "allocated");
  assert.equal(allocations.length, expected.length, "one actual allocation per producer");
  assert.equal(new Set(allocations.map((event) => event.runId)).size, expected.length, "distinct runs");
  assert.equal(run.admissions.filter((event) => event.kind === "indexed").length, expected.length);
  assert.deepEqual(run.admissions.filter((event) => event.kind === "unavailable"), []);
}

/** Strict serial order: each producer allocates only after the previous one published. */
function assertSerial(run: BatchRun, expected: readonly string[]) {
  const cycles = lifecycles(run.admissions);
  assert.deepEqual(cycles.map((cycle) => cycle.query), [...expected], "actual admission follows batch order");
  for (let index = 1; index < cycles.length; index++)
    assert(
      cycles[index]!.allocated > cycles[index - 1]!.indexed,
      `${cycles[index]!.query} allocated only after ${cycles[index - 1]!.query} published`,
    );
  const order = hostOrder(run.handle);
  for (let index = 0; index < order.length; index += 2)
    assert.equal(
      order[index]!.replace(/:start$/, ""),
      order[index + 1]!.replace(/:end$/, ""),
      `host runs each call to its end before the next start: ${order.join(", ")}`,
    );
  assert.equal(run.meter.peakByRole.search, 1, "no two searches were ever in flight");
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

before(async () => {
  main = await createMainFixture(hostSelection.root);
  stage = await startStageFixture();
});

after(async () => {
  guard.restore();
  auth.restore();
  await stage?.close();
  // Evidence stays only on request: set NATIVE_REPLAY_KEEP=1.
  if (!process.env.NATIVE_REPLAY_KEEP) await rm(isolation.root, { recursive: true, force: true });
});

// ── Suite ───────────────────────────────────────────────────────────────────

describe(`direct native research batches on ${hostSelection.kind} Pi ${hostSelection.version} (M4 K1, Codemode off)`, () => {
  it("pins the installed host's default batch strategy and the registered execution modes", async () => {
    const workspace = join(isolation.root, "workspace-pins");
    await mkdir(workspace, { recursive: true });
    await writeAgentConfig(isolation.agentDir, stage.baseUrl);
    main.setScript([]);
    guard.setPhase("pins", []);
    const handle = await openSession({
      host,
      agentDir: isolation.agentDir,
      workspace,
      main,
      nativeFactory: source.module.createNativeExtension({ mode: "unit" }) as never,
      codemode: "off",
    });
    try {
      // The agent loop reads executionMode from the agent state's tools.
      const agent = (handle.session as unknown as {
        agent: {
          toolExecution: unknown;
          state: { tools: Array<{ name: string; executionMode?: unknown }> };
        };
      }).agent;
      assert.equal(agent.toolExecution, "parallel", "installed default is parallel");
      const modes = Object.fromEntries(
        agent.state.tools
          .filter((tool) => tool.name.startsWith("intelli_"))
          .map((tool) => [tool.name, tool.executionMode ?? null]),
      );
      await writeEvidence(isolation.root, "pins", { host: hostSelection, modes });
      assert.deepEqual(modes, {
        intelli_search: null,
        intelli_extract: null,
        intelli_collate: "sequential",
        intelli_research: "parallel",
      });
    } finally {
      guard.setPhase("idle", [stage.port]);
      handle.dispose();
    }
  });

  it("two direct research calls in one assistant batch genuinely overlap: both allocate before either publishes", async () => {
    const run = await runBatch({
      phase: "record-direct-overlap",
      calls: [researchCall(QA), researchCall(QB)],
      script: { searchRendezvousMs: 10_000 },
    });
    await writeEvidence(isolation.root, "direct-overlap", evidenceOf(run));
    assertCommon(run, "record-direct-overlap", [QA, QB]);
    assert.equal(run.toolExecutionDuring, "parallel");
    assert.equal(run.meter.rendezvous, "met", "both searches were in flight together");
    assert.equal(run.meter.peakByRole.search, 2);
    assert.deepEqual(
      new Set(allocatedBeforeFirstPublication(run.admissions)),
      new Set([QA, QB]),
      "both operations were actually admitted before any publication",
    );
    assert.deepEqual(hostOrder(run.handle).slice(0, 2), ["intelli_research:start", "intelli_research:start"]);
  });

  it("concurrent direct researches share one runtime's model, page and fetch bounds exactly", async () => {
    const run = await runBatch({
      phase: "record-direct-bounds",
      calls: [researchCall(QA), researchCall(QB)],
      settings: {
        execution: {
          fetchMaxResponseBytes: MAX_RESPONSE_BYTES,
          modelConcurrency: 2,
          aggregateFetchConcurrency: 1,
        },
      },
      script: { searchRendezvousMs: 10_000, extractHoldMs: 60 },
      pageHoldMs: 15,
    });
    await writeEvidence(isolation.root, "direct-bounds", evidenceOf(run));
    assertCommon(run, "record-direct-bounds", [QA, QB]);
    assert.equal(run.meter.rendezvous, "met", "two critical searches fit modelConcurrency 2");
    assert.deepEqual(new Set(allocatedBeforeFirstPublication(run.admissions)), new Set([QA, QB]));
    assert.equal(run.meter.rows.filter((row) => row.role === "extract").length, 4, "four pages extracted");
    assert(run.meter.peak <= 2, `model attempts in flight ${run.meter.peak} exceed modelConcurrency 2`);
    assert.equal(run.meter.peakByRole.extract, 1, "page attempts share capacity modelConcurrency - criticalReserve = 1");
    assert(run.pages.calls >= 4);
    assert.equal(run.pages.peak, 1, "page fetches share aggregateFetchConcurrency 1");
  });

  it("control: the same held batch at default capacity exceeds those bounds, so the meters discriminate", async () => {
    const run = await runBatch({
      phase: "record-direct-bounds-control",
      calls: [researchCall(QA), researchCall(QB)],
      script: { searchRendezvousMs: 10_000, extractHoldMs: 60 },
      pageHoldMs: 15,
    });
    await writeEvidence(isolation.root, "direct-bounds-control", evidenceOf(run));
    assertCommon(run, "record-direct-bounds-control", [QA, QB]);
    // Defaults: modelConcurrency 5 (page capacity 4), aggregateFetchConcurrency 4.
    assert(run.meter.peakByRole.extract >= 2, `extract peak ${run.meter.peakByRole.extract}`);
    assert(run.meter.peak > 2, `model peak ${run.meter.peak}`);
    assert(run.pages.peak >= 2, `fetch peak ${run.pages.peak}`);
  });

  it("a parallel direct batch settles both members when one research fails after actual search dispatch", async () => {
    const phase = "record-direct-failure";
    const run = await runBatch({
      phase,
      calls: [researchCall(QF), researchCall(QA)],
      script: { searchRendezvousMs: 10_000, rejectSearch: [QF] },
    });
    const results = ends(run.handle);
    const failed = results.find((end) => queryOf(run.handle, end) === QF);
    const sibling = results.find((end) => queryOf(run.handle, end) === QA);
    await writeEvidence(isolation.root, "direct-failure", { ...evidenceOf(run), failedEnd: failed ?? null });
    assert.equal(run.promptError, null);
    assert.deepEqual(guard.violations(phase), [], JSON.stringify(guard.violations(phase)));
    assert.equal(run.registryCalls, run.meter.rows.length);
    assert(!run.meter.rows.some((row) => row.owner === "unknown"));
    for (const body of run.mainBodies) assert(!body.includes(RAW_SENTINEL));

    // Genuine overlap before the failure: the rejected search was dispatched
    // and held in flight with its sibling's, and both were admitted first.
    assert.equal(run.meter.rendezvous, "met");
    assert.equal(run.meter.peakByRole.search, 2);
    assert.deepEqual(
      run.meter.rows.filter((row) => row.owner === QF).map((row) => row.role),
      ["search"],
      "a permanent 400 is one dispatched attempt: no retry and no later stage",
    );
    assert.deepEqual(new Set(allocatedBeforeFirstPublication(run.admissions)), new Set([QF, QA]));
    assert.deepEqual(hostOrder(run.handle).slice(0, 2), ["intelli_research:start", "intelli_research:start"]);

    // Both members settle: one host end each, the session continues and the
    // main model receives both results in its next request.
    assert.equal(results.length, 2);
    assert(failed && sibling, "one end per member");
    assert.equal(run.mainBodies.length, 2, "the batch settled and the agent loop continued");
    assert(run.mainBodies[1]!.includes("fixture permanent bad request"), "main sees the failure");

    // The sibling completes and publishes with its own exact ledger.
    assert.equal(sibling.isError, false);
    assert.equal(sibling.result.details?.intelli?.outcome, "completed");
    const own = stageTotals(run.meter.rows, QA);
    const siblingAccounting = accountingOf(sibling);
    assert.equal(siblingAccounting.attempts, own.attempts);
    assert.equal(siblingAccounting.observedAttempts, own.attempts);
    assert.equal(siblingAccounting.missingAttempts, 0);
    assert.equal(siblingAccounting.tokens?.inputTotal, own.input);
    assert.equal(siblingAccounting.tokens?.outputTotal, own.output);

    // The failure is a canonical error result, not a thrown host error.
    assert.equal(failed.isError, true);
    const data = (failed.result.details?.intelli ?? {}) as Record<string, unknown>;
    assert.equal(data.outcome, "error");
    assert.match(String(failed.result.content?.[0]?.text), /fixture permanent bad request/);
    assert.deepEqual(data.cache, { status: "not-requested" });
    const attempts = data.attempts as Array<{ role?: string; state?: string }>;
    assert.deepEqual(attempts.map((a) => `${a.role}:${a.state}`), ["search:failed"]);
    // Partial accounting keeps missingness: no zero tokens or zero charges invented.
    const failedAccounting = data.accounting as Record<string, unknown>;
    assert.deepEqual(
      {
        attempts: failedAccounting.attempts,
        observedAttempts: failedAccounting.observedAttempts,
        missingAttempts: failedAccounting.missingAttempts,
        tokens: failedAccounting.tokens,
        reportedCost: failedAccounting.reportedCost,
        estimatedCost: failedAccounting.estimatedCost,
        costComplete: failedAccounting.costComplete,
        parentDelivery: failedAccounting.parentDelivery,
      },
      {
        attempts: 1,
        observedAttempts: 0,
        missingAttempts: 1,
        tokens: {},
        reportedCost: {},
        estimatedCost: {},
        costComplete: false,
        parentDelivery: "available",
      },
    );
    assert.deepEqual(
      [...(failedAccounting.missingTokenFields as string[])].sort(),
      ["cacheRead", "cacheWrite", "cacheWrite1h", "inputTotal", "inputUncached", "outputTotal", "reasoning", "totalTokens"],
    );
    // The execution receipt carries the same canonical accounting.
    const execution = (failed.result.details as { execution?: { accounting?: unknown } } | undefined)?.execution;
    assert.deepEqual(execution?.accounting, failedAccounting);
    // Host numeric usage has required number fields: unknown values are zero
    // placeholders (CONTRACT C17/T17 numeric host usage), and the canonical
    // completeness above explains them. Pinned here so a change is visible.
    const hostUsage = (failed.result as { usage?: Record<string, unknown> }).usage;
    assert.deepEqual(hostUsage, {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    });

    // Actual store lifecycle: both allocated, only the sibling published, and
    // the failed operation settled with an operation-phase unavailability.
    const allocations = run.admissions.filter((event) => event.kind === "allocated");
    assert.equal(allocations.length, 2);
    const failedOperation = allocations.find((event) => event.query === QF)!.operationId;
    assert.deepEqual(
      run.admissions.filter((event) => event.kind !== "allocated").map((event) => `${event.kind}:${event.operationId === failedOperation ? "F" : "A"}`),
      ["unavailable:F", "indexed:A"],
    );
    assert.deepEqual(
      run.admissions.filter((event) => event.kind === "unavailable").map((event) => (event as { phase: string }).phase),
      ["operation"],
    );
  });

  it("a direct batch containing sequential collate serialises as a whole", async () => {
    const expected = [QA, QC, QB];
    const run = await runBatch({
      phase: "record-mixed-collate",
      calls: [researchCall(QA), collateCall, researchCall(QB)],
      script: { searchRendezvousMs: 400 },
    });
    await writeEvidence(isolation.root, "mixed-collate", evidenceOf(run));
    assertCommon(run, "record-mixed-collate", expected);
    assert.equal(run.toolExecutionDuring, "parallel", "serialisation comes from the batch, not host-wide mode");
    assert.equal(run.meter.rendezvous, "timeout", "the first search never had a concurrent partner");
    assertSerial(run, expected);
  });

  it("host-wide sequential toolExecution serialises two direct researches", async () => {
    const expected = [QA, QB];
    const run = await runBatch({
      phase: "record-host-sequential",
      calls: [researchCall(QA), researchCall(QB)],
      script: { searchRendezvousMs: 400 },
      hostSequential: true,
    });
    await writeEvidence(isolation.root, "host-sequential", evidenceOf(run));
    assertCommon(run, "record-host-sequential", expected);
    assert.equal(run.toolExecutionBefore, "parallel");
    assert.equal(run.toolExecutionDuring, "sequential");
    assert.equal(run.meter.rendezvous, "timeout");
    assertSerial(run, expected);
  });

  it("records auth resolution per phase without credentials", async () => {
    const events = auth.events();
    await writeEvidence(isolation.root, "auth", { events });
    for (const event of events) {
      assert(
        !/login|enqueueCredentialOperation/.test(event.method),
        `no interactive credential operation: ${event.method}`,
      );
      // Refresh records allowNetwork; every other method names a fixture provider.
      if (event.method.endsWith(".refresh")) assert.notEqual(event.provider, "allowNetwork=true");
      else assert(["fixture-inproc", "fixture-stage"].includes(event.provider), event.provider);
    }
  });
});
