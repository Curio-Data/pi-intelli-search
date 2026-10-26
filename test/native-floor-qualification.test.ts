// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// M4 native floor qualification on the exact manifest floor host.
//
// A real AgentSession of the owned floor installation (see
// scripts/qualify-native-floor.mts) runs the native extension from the
// immutable createNativeExtension() factory with Codemode off. Stage calls
// are NOT injected: the native client dispatches through the floor's own
// ModelRegistry.streamSimple() facade to the private loopback stage fixture,
// with an observation-only wrapper counting calls and the caller's own
// citation channels. Pages are synthetic in-process bytes through the real
// FetchClient. The main model is the in-process scripted fixture.
//
// It qualifies what the floor supports, directly: actual host batch
// scheduling, thrown floor error delivery, the required registry facade,
// pre-stream-hook (fetch-tee) citation recovery and the usage the floor lets
// the extension observe. Later Codemode/MCP factories are absent at the
// floor; those cases are reported as unsupported, never substituted.
//
// Evidence class: loopback record phase, not zero-network replay. No
// credential, live provider, page or catalogue request is made; the network
// and auth tripwires stay installed. NATIVE_FLOOR_HOST names an explicit
// control host instead; capability-dependent expectations then follow the
// static capability probe, and records say "explicit-control".

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { IndexCandidate, PageTransport } from "../src/core/contracts.js";
import type { NativeSuggestionReadView } from "../src/native-injection.js";
import {
  REPO_ROOT,
  RAW_SENTINEL,
  countAuthResolution,
  createRecording,
  installNetworkGuard,
  isolateProcess,
  loadSourceNative,
  openSession,
  startStageFixture,
  syntheticPage,
  writeAgentConfig,
  writeEvidence,
  type MainFixture,
  type MainTurn,
  type NetworkGuard,
  type SessionHandle,
  type StageFixture,
  type StageReply,
  type StageRole,
} from "./helpers/native-replay.js";
import {
  createFloorMainFixture,
  importFloorHost,
  observeRegistryFacade,
  selectFloorHost,
  staticCapabilities,
  type FacadeObserver,
} from "./helpers/native-floor-qualification.js";

// `npm test` runs every test file. Without the owned floor install this suite
// reports one visible skip naming the missing install; the qualification
// script sets NATIVE_FLOOR_REQUIRED=1, so a missing install fails there.
const selection = await selectFloorHost().then(
  (host) => ({ host }),
  (error: unknown) => {
    // A named control host or a required run never degrades to a skip.
    if (process.env.NATIVE_FLOOR_REQUIRED === "1" || process.env.NATIVE_FLOOR_HOST) throw error;
    return { skip: error instanceof Error ? error.message : String(error) };
  },
);

if ("skip" in selection) {
  describe("native floor qualification", () => {
    it("runs only against the owned floor install or an explicit control host", { skip: selection.skip }, () => {});
  });
} else {
  const isolation = await isolateProcess("floor", join(REPO_ROOT, ".tmp/m4-floor"));
  const guard: NetworkGuard = installNetworkGuard();
  const floor = selection.host;
  const host = await importFloorHost(floor);
  const capabilities = await staticCapabilities(floor, host);
  const source = await loadSourceNative();
  const auth = countAuthResolution(host as unknown as Record<string, unknown>, () => guard.phase());
  const facade: FacadeObserver = observeRegistryFacade(host);
  const codemodeAvailable = capabilities.laterFactories.createCodemodeExtension === true;
  let main: MainFixture;
  let stage: StageFixture;

  const QA = "floor batch alpha research";
  const QB = "floor batch bravo research";
  /** Its search is permanently rejected (HTTP 400) after actual dispatch. */
  const QF = "floor batch failing research";
  const QC = "floor batch standalone collate";
  /** Its search answer carries no prose links: sources arrive only as url_citation annotations. */
  const QN = "floor citation-only research";
  const page = (id: string) => `https://docs.example.test/${id.toLowerCase()}`;
  const PAGES: Record<string, readonly string[]> = {
    [QA]: ["A1", "A2"],
    [QB]: ["B1", "B2"],
    [QN]: ["N1", "N2"],
  };
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
  const ROLE_USAGE: Record<StageRole, { prompt: number; completion: number }> = {
    search: { prompt: 50, completion: 10 },
    extract: { prompt: 300, completion: 20 },
    collate: { prompt: 120, completion: 15 },
    suggest: { prompt: 70, completion: 8 },
  };

  // ── Stage attribution and in-flight accounting ─────────────────────────────

  function ownerOf(role: StageRole, user: string): string {
    if (role === "search") return [QA, QB, QF, QN].find((q) => user.startsWith(q)) ?? "unknown";
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
  }

  interface Meter {
    readonly rows: StageRow[];
    peakByRole: Record<StageRole, number>;
    rendezvous: "pending" | "met" | "timeout" | "unused";
  }

  interface ScriptOptions {
    readonly searchRendezvousMs?: number;
    readonly rejectSearch?: readonly string[];
  }

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  function scriptStage(options: ScriptOptions = {}): Meter {
    const meter: Meter = {
      rows: [],
      peakByRole: { search: 0, extract: 0, collate: 0, suggest: 0 },
      rendezvous: options.searchRendezvousMs === undefined ? "unused" : "pending",
    };
    const inFlight = { search: 0, extract: 0, collate: 0, suggest: 0 };
    let meet: () => void = () => {};
    const met = new Promise<void>((resolve) => {
      meet = resolve;
    });
    const searchOwners = new Set<string>();
    stage.setScript(({ role, user }) => {
      const owner = ownerOf(role, user);
      meter.rows.push({ role, owner });
      inFlight[role]++;
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
      const settle = hold.then(() => {
        inFlight[role]--;
      });
      const { prompt, completion } = ROLE_USAGE[role];
      const reply = (text: string, extra: Partial<StageReply> = {}): StageReply => ({
        text,
        usage: usage(prompt, completion),
        after: settle,
        ...extra,
      });
      switch (role) {
        case "search": {
          if (options.rejectSearch?.includes(owner))
            return {
              status: 400,
              errorBody: JSON.stringify({ error: { message: "fixture permanent bad request" } }),
              after: settle,
            };
          const ids = PAGES[owner] ?? [];
          if (owner === QN)
            return reply(`Answer for ${owner} without prose links.`, { annotations: ids.map(page) });
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
    | { readonly kind: "allocated"; readonly operationId: string; readonly query: string; readonly runId: string }
    | { readonly kind: "indexed"; readonly operationId: string; readonly runId: string }
    | { readonly kind: "unavailable"; readonly operationId: string; readonly phase: string };

  function admissionProbe(): { controller: NativeSuggestionReadView; log: AdmissionEvent[] } {
    const log: AdmissionEvent[] = [];
    return {
      log,
      controller: {
        allocated: (input) =>
          void log.push({
            kind: "allocated",
            operationId: input.operationId,
            query: input.query,
            runId: input.reservation.runId,
          }),
        indexed: (input) =>
          void log.push({ kind: "indexed", operationId: input.operationId, runId: input.run.reservation.runId }),
        unavailable: (input) =>
          void log.push({ kind: "unavailable", operationId: input.operationId, phase: input.phase }),
        candidates: async (input): Promise<readonly IndexCandidate[]> => input.readVerified(),
      },
    };
  }

  function countedPages(inner: PageTransport) {
    const urls: string[] = [];
    const transport: PageTransport = async (url, request) => {
      urls.push(url);
      return inner(url, request);
    };
    return { transport, urls };
  }

  // ── Thrown-error witness ────────────────────────────────────────────────────

  interface ThrownRecord {
    readonly tool: string;
    readonly name: string;
    readonly message: string;
    readonly execution?: unknown;
    readonly usage?: unknown;
    readonly data?: unknown;
  }

  /**
   * Observation-only witness at the native registration boundary: the native
   * factory receives a proxy of the host ExtensionAPI whose registerTool wraps
   * each intelli tool's execute. The wrapper calls the original and records a
   * thrown error's own fields before rethrowing it unchanged, so the floor loop
   * sees exactly the original throw. Everything else is the host's own API.
   */
  function witnessThrows(
    factory: (pi: never) => void,
    /** Discriminating control only: falsely advertise the later error-result capability. */
    advertiseErrorResults = false,
  ): {
    factory: (pi: never) => void;
    thrown: ThrownRecord[];
    invocations: () => number;
  } {
    const thrown: ThrownRecord[] = [];
    let invocations = 0;
    const wrap = (tool: { name: string; execute: (...args: unknown[]) => Promise<unknown> }) => ({
      ...tool,
      execute: async (...args: unknown[]) => {
        invocations++;
        try {
          return await tool.execute(...args);
        } catch (error) {
          const fields = error as { name?: unknown; message?: unknown; execution?: unknown; usage?: unknown; data?: unknown };
          thrown.push({
            tool: tool.name,
            name: String(fields.name),
            message: String(fields.message),
            execution: fields.execution,
            usage: fields.usage,
            data: fields.data,
          });
          throw error;
        }
      },
    });
    const proxied = (pi: Record<string, unknown>) =>
      factory(
        new Proxy(pi, {
          get(target, key, receiver) {
            if (advertiseErrorResults && key === "registerMcpServer")
              return () => {
                throw new Error("control: advertised only");
              };
            const value = Reflect.get(target, key, receiver);
            if (key !== "registerTool" || typeof value !== "function") return value;
            return (tool: { name: string; execute: (...args: unknown[]) => Promise<unknown> }) =>
              value.call(target, tool.name.startsWith("intelli_") ? wrap(tool) : tool);
          },
        }) as never,
      );
    return { factory: proxied as never, thrown, invocations: () => invocations };
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
        { url: page("A1"), title: "A1", extraction: "A1 limit is 2.", sourceType: "official-docs", status: "success" },
      ],
    },
  };

  interface BatchRun {
    readonly handle: SessionHandle;
    readonly meter: Meter;
    readonly admissions: AdmissionEvent[];
    readonly pageUrls: string[];
    readonly facadeCalls: ReturnType<typeof facadeSnapshot>;
    readonly thrown: ThrownRecord[];
    readonly witnessInvocations: number;
    readonly promptError: string | null;
    readonly mainBodies: string[];
    readonly toolExecutionBefore: unknown;
    readonly toolExecutionDuring: unknown;
    readonly workspace: string;
  }

  const facadeSnapshot = () => facade.calls.map((call) => ({ ...call }));

  async function runBatch(input: {
    readonly phase: string;
    readonly calls: MainTurn["toolCalls"];
    readonly script?: ScriptOptions;
    readonly hostSequential?: boolean;
    readonly advertiseErrorResults?: boolean;
  }): Promise<BatchRun> {
    const workspace = join(isolation.root, `workspace-${input.phase}`);
    await mkdir(workspace, { recursive: true });
    await writeAgentConfig(isolation.agentDir, stage.baseUrl, { defaultUrls: 2, maxUrls: 2 });
    const meter = scriptStage(input.script);
    const probe = admissionProbe();
    const counted = countedPages(createRecording(input.phase, pages).pageTransport);
    main.setScript([
      { toolCalls: input.calls, usage: usage(900, 40) },
      { text: "Done.", usage: usage(1200, 6) },
    ]);
    guard.setPhase(input.phase, [stage.port]);
    // No registryStreamSimple injection: the native client uses the floor facade.
    const witness = witnessThrows(
      source.module.createNativeExtension({
        mode: "unit",
        pageTransport: counted.transport,
        suggestionReadView: probe.controller,
      }) as never,
      input.advertiseErrorResults,
    );
    const handle = await openSession({
      host,
      agentDir: isolation.agentDir,
      workspace,
      main,
      nativeFactory: witness.factory,
      codemode: "off",
    });
    const agent = (handle.session as unknown as { agent: { toolExecution: unknown } }).agent;
    const toolExecutionBefore = agent.toolExecution;
    if (input.hostSequential) agent.toolExecution = "sequential";
    const toolExecutionDuring = agent.toolExecution;
    facade.reset();
    let promptError: string | null = null;
    try {
      await handle.session.prompt("Run the floor batch.");
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
      pageUrls: counted.urls,
      facadeCalls: facadeSnapshot(),
      thrown: witness.thrown,
      witnessInvocations: witness.invocations(),
      promptError,
      mainBodies,
      toolExecutionBefore,
      toolExecutionDuring,
      workspace,
    };
  }

  // ── Interpretation ──────────────────────────────────────────────────────────

  type ToolEnd = {
    toolName: string;
    toolCallId: string;
    isError: boolean;
    result: {
      content?: Array<{ text?: string }>;
      details?: { intelli?: Record<string, unknown> } & Record<string, unknown>;
      usage?: unknown;
    };
  };

  const ends = (handle: SessionHandle) =>
    handle.events.filter(
      (event) =>
        (event as { type?: string }).type === "tool_execution_end" &&
        String((event as { toolName?: string }).toolName).startsWith("intelli_"),
    ) as unknown as ToolEnd[];

  /** Final toolResult messages, as the session persists them. */
  const toolResultMessages = (handle: SessionHandle) =>
    handle.events
      .filter(
        (event) =>
          (event as { type?: string }).type === "message_end" &&
          (event as { message?: { role?: string } }).message?.role === "toolResult",
      )
      .map((event) => (event as { message: Record<string, unknown> }).message);

  const hostOrder = (handle: SessionHandle) =>
    handle.toolEvents
      .filter((event) => String(event.toolName).startsWith("intelli_") && event.type !== "tool_execution_update")
      .map((event) => `${String(event.toolName)}:${String(event.type).replace("tool_execution_", "")}`);

  const queryOf = (handle: SessionHandle, end: { toolCallId: unknown }) =>
    String(
      (
        handle.toolEvents.find(
          (event) => event.type === "tool_execution_start" && event.toolCallId === end.toolCallId,
        )?.args as { query?: unknown } | undefined
      )?.query ?? "",
    );

  function allocatedBeforeFirstPublication(log: readonly AdmissionEvent[]): string[] {
    const first = log.findIndex((event) => event.kind === "indexed");
    return log
      .slice(0, first === -1 ? log.length : first)
      .filter((event): event is Extract<AdmissionEvent, { kind: "allocated" }> => event.kind === "allocated")
      .map((event) => event.query);
  }

  function lifecycles(log: readonly AdmissionEvent[]) {
    return log
      .filter((event): event is Extract<AdmissionEvent, { kind: "allocated" }> => event.kind === "allocated")
      .map((allocation) => ({
        query: allocation.query,
        allocated: log.indexOf(allocation),
        indexed: log.findIndex((event) => event.kind === "indexed" && event.runId === allocation.runId),
      }));
  }

  const accountingOf = (end: ToolEnd) =>
    ((end.result.details?.intelli ?? {}) as { accounting?: Record<string, unknown> }).accounting ?? {};

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
      host: floor,
      capabilities: { ...capabilities, hostExports: undefined },
      evidenceClass: "loopback-record (not zero-network replay); stage dispatch through the actual host facade",
      toolExecution: { before: run.toolExecutionBefore, during: run.toolExecutionDuring },
      promptError: run.promptError,
      hostOrder: hostOrder(run.handle),
      admissions: run.admissions,
      stage: { rendezvous: run.meter.rendezvous, peakByRole: run.meter.peakByRole, rows: run.meter.rows },
      pageUrls: run.pageUrls,
      facadeCalls: run.facadeCalls,
      witnessInvocations: run.witnessInvocations,
      thrown: run.thrown,
      results: ends(run.handle).map((end) => ({
        tool: end.toolName,
        query: queryOf(run.handle, end),
        isError: end.isError,
        content: end.result.content,
        detailKeys: Object.keys(end.result.details ?? {}),
        outcome: end.result.details?.intelli?.outcome,
        accounting: accountingOf(end),
        usage: end.result.usage ?? null,
      })),
      toolResultMessages: toolResultMessages(run.handle).map((message) => ({
        toolName: message.toolName,
        isError: message.isError,
        usage: message.usage ?? null,
        detailKeys: Object.keys((message.details as object | undefined) ?? {}),
      })),
    };
  }

  /** Tripwires and facade use common to every floor batch. */
  function assertTripwires(run: BatchRun, phase: string) {
    assert.equal(run.promptError, null);
    assert.deepEqual(guard.violations(phase), [], JSON.stringify(guard.violations(phase)));
    assert(!run.meter.rows.some((row) => row.owner === "unknown"), "every stage request attributed");
    for (const body of run.mainBodies) assert(!body.includes(RAW_SENTINEL), "no raw page bytes reach main");
    // Every stage request was dispatched by the host facade, with its system prompt.
    const stageCalls = run.facadeCalls.filter((call) => call.provider === "fixture-stage");
    assert.equal(stageCalls.length, run.meter.rows.length, "one facade call per stage request");
    assert(stageCalls.every((call) => call.systemPrompt), "facade received every stage system prompt");
    assert.equal(
      run.facadeCalls.filter((call) => call.provider !== "fixture-stage").length,
      0,
      "the main is not dispatched through the extension facade path",
    );
    assert(run.witnessInvocations > 0, "the executable-tool witness was on the actual loop path");
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
    main = await createFloorMainFixture(floor);
    stage = await startStageFixture();
  });

  after(async () => {
    facade.restore();
    guard.restore();
    auth.restore();
    await stage?.close();
    if (!process.env.NATIVE_FLOOR_KEEP) await rm(isolation.root, { recursive: true, force: true });
  });

  // ── Suite ───────────────────────────────────────────────────────────────────

  describe(`native floor qualification on ${floor.kind} Pi ${floor.version} (manifest floor ${floor.manifestFloor}, Codemode off)`, () => {
    it("pins the floor identity, capability surface and registered execution modes", async () => {
      const workspace = join(isolation.root, "workspace-pins");
      await mkdir(workspace, { recursive: true });
      await writeAgentConfig(isolation.agentDir, stage.baseUrl);
      main.setScript([]);
      guard.setPhase("pins", []);
      let registerMcpServer: string | undefined;
      const handle = await openSession({
        host,
        agentDir: isolation.agentDir,
        workspace,
        main,
        nativeFactory: source.module.createNativeExtension({ mode: "unit" }) as never,
        codemode: "off",
        extraFactories: [
          ((pi: Record<string, unknown>) => {
            registerMcpServer = typeof pi.registerMcpServer;
          }) as never,
        ],
      });
      try {
        const agent = (handle.session as unknown as {
          agent: { toolExecution: unknown; state: { tools: Array<{ name: string; executionMode?: unknown }> } };
        }).agent;
        const modes = Object.fromEntries(
          agent.state.tools
            .filter((tool) => tool.name.startsWith("intelli_"))
            .map((tool) => [tool.name, tool.executionMode ?? null]),
        );
        const peer = JSON.parse(
          await readFile(join(REPO_ROOT, "node_modules/@earendil-works/pi-coding-agent/package.json"), "utf8"),
        ) as { version: string };
        await writeEvidence(isolation.root, "pins", {
          host: floor,
          capabilities,
          registerMcpServer,
          toolExecution: agent.toolExecution,
          modes,
          // The native source's runtime peer imports (CONFIG_DIR_NAME, pi-tui Text)
          // resolve from the repository tree, as in test/e2e/15_pi_floor.sh.
          nativePeerImportsResolveFrom: { root: "repository node_modules", piCodingAgent: peer.version },
        });
        assert.equal(agent.toolExecution, "parallel", "host default batch strategy");
        assert.deepEqual(modes, {
          intelli_search: null,
          intelli_extract: null,
          intelli_collate: "sequential",
          intelli_research: "parallel",
        });
        assert.equal(typeof (host.ModelRegistry as unknown as { prototype: { streamSimple?: unknown } }).prototype.streamSimple, "function");
        assert(capabilities.completionsFetchOption, "the host adapter forwards options.fetch (tee channel)");
        if (floor.kind === "owned-floor") {
          assert.equal(floor.version, floor.manifestFloor);
          assert.deepEqual(capabilities.laterFactories, {
            createCodemodeExtension: false,
            createMcpExtension: false,
            createToolSearchExtension: false,
          });
          assert.equal(registerMcpServer, "undefined", "floor extension API has no registerMcpServer");
          assert.equal(capabilities.completionsStreamHook, false, "floor pi-ai predates onProviderStreamEvent");
          assert.equal(capabilities.loopHonoursReturnedIsError, false, "floor loop recognises only thrown errors");
        }
      } finally {
        guard.setPhase("idle", [stage.port]);
        handle.dispose();
      }
    });

    it("dispatches a research through the floor facade and recovers citation-only sources through the matching channel", async () => {
      const phase = "record-citations";
      const run = await runBatch({ phase, calls: [researchCall(QN)] });
      const [end] = ends(run.handle);
      await writeEvidence(isolation.root, "citations", evidenceOf(run));
      assertTripwires(run, phase);
      assert(end, "one host end");
      assert.equal(end.isError, false);
      assert.equal(end.result.details?.intelli?.outcome, "completed");
      // Sources existed only as annotations, so fetching them proves recovery.
      for (const id of PAGES[QN]!) assert(run.pageUrls.includes(page(id)), `${id} fetched from a citation`);
      assert.equal(run.meter.rows.filter((row) => row.role === "extract").length, 2, "both cited pages extracted");
      const searches = run.facadeCalls.filter((call) => call.model === "search");
      assert.equal(searches.length, 1);
      const search = searches[0]!;
      assert(search.fetchOption && search.fetchInvocations > 0, "the fetch-tee channel carried the search request");
      assert(search.streamHookOption, "the extension also offers the stream hook");
      if (capabilities.completionsStreamHook)
        assert(search.streamHookInvocations > 0, "a host with the stream hook delivers chunks through it");
      else assert.equal(search.streamHookInvocations, 0, "the floor never invokes the stream hook: recovery is the tee");
      // The run's own telemetry sidecar records the harvest, as 15_pi_floor.sh requires live.
      const runs = join(run.workspace, ".search/.intelli-v1/runs");
      const [runDir, ...others] = await readdir(runs);
      assert(runDir && !others.length, "one run directory");
      const meta = JSON.parse(await readFile(join(runs, runDir, "meta.json"), "utf8")) as {
        outcome?: string;
        stages?: { search?: { annotationsHarvested?: number; linksReturned?: number } };
      };
      assert.equal(meta.outcome, "completed");
      assert.equal(meta.stages?.search?.annotationsHarvested, PAGES[QN]!.length);
      assert.equal(meta.stages?.search?.linksReturned, PAGES[QN]!.length);
    });

    it("two direct researches in one assistant batch genuinely overlap on the floor loop", async () => {
      const phase = "record-direct-overlap";
      const run = await runBatch({
        phase,
        calls: [researchCall(QA), researchCall(QB)],
        script: { searchRendezvousMs: 10_000 },
      });
      await writeEvidence(isolation.root, "direct-overlap", evidenceOf(run));
      assertTripwires(run, phase);
      assert.equal(run.toolExecutionDuring, "parallel");
      assert.equal(run.meter.rendezvous, "met", "both searches were in flight together");
      assert.equal(run.meter.peakByRole.search, 2);
      assert.deepEqual(new Set(allocatedBeforeFirstPublication(run.admissions)), new Set([QA, QB]));
      assert.deepEqual(hostOrder(run.handle).slice(0, 2), ["intelli_research:start", "intelli_research:start"]);
      for (const end of ends(run.handle)) {
        assert.equal(end.isError, false);
        assert.equal(end.result.details?.intelli?.outcome, "completed");
      }
    });

    it("a floor batch containing sequential collate serialises as a whole", async () => {
      const expected = [QA, QC, QB];
      const phase = "record-mixed-collate";
      const run = await runBatch({
        phase,
        calls: [researchCall(QA), collateCall, researchCall(QB)],
        script: { searchRendezvousMs: 400 },
      });
      await writeEvidence(isolation.root, "mixed-collate", evidenceOf(run));
      assertTripwires(run, phase);
      assert.equal(run.toolExecutionDuring, "parallel", "serialisation comes from the batch, not host-wide mode");
      assert.equal(run.meter.rendezvous, "timeout");
      assertSerial(run, expected);
    });

    it("floor host-wide sequential toolExecution serialises two direct researches", async () => {
      const expected = [QA, QB];
      const phase = "record-host-sequential";
      const run = await runBatch({
        phase,
        calls: [researchCall(QA), researchCall(QB)],
        script: { searchRendezvousMs: 400 },
        hostSequential: true,
      });
      await writeEvidence(isolation.root, "host-sequential", evidenceOf(run));
      assertTripwires(run, phase);
      assert.equal(run.toolExecutionBefore, "parallel");
      assert.equal(run.toolExecutionDuring, "sequential");
      assert.equal(run.meter.rendezvous, "timeout");
      assertSerial(run, expected);
    });

    it("delivers a dispatched research failure in a parallel floor batch through the floor's error channel", async () => {
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
      assertTripwires(run, phase);
      assert.equal(run.meter.rendezvous, "met");
      assert.deepEqual(
        run.meter.rows.filter((row) => row.owner === QF).map((row) => row.role),
        ["search"],
        "a permanent 400 is one dispatched attempt",
      );
      assert.deepEqual(new Set(allocatedBeforeFirstPublication(run.admissions)), new Set([QF, QA]));
      assert(failed && sibling, "one end per member");
      assert.equal(run.mainBodies.length, 2, "the batch settled and the loop continued");
      assert(run.mainBodies[1]!.includes("fixture permanent bad request"), "main sees the failure");
      assert.equal(sibling.isError, false);
      assert.equal(sibling.result.details?.intelli?.outcome, "completed");
      assert.equal(failed.isError, true, "the host marks the failure");
      assert.match(String(failed.result.content?.[0]?.text), /fixture permanent bad request/);
      const failedOperation = run.admissions.find((event) => event.kind === "allocated" && event.query === QF)!.operationId;
      assert.deepEqual(
        run.admissions.filter((event) => event.kind !== "allocated").map((event) => `${event.kind}:${event.operationId === failedOperation ? "F" : "A"}`),
        ["unavailable:F", "indexed:A"],
      );
      if (!capabilities.loopHonoursReturnedIsError) {
        // Floor: the runtime throws NativeExecutionError; the loop builds its own
        // error result, so no canonical field or host usage is delivered.
        assert.equal(run.thrown.length, 1, "exactly one thrown failure");
        const thrown = run.thrown[0]!;
        assert.equal(thrown.name, "NativeExecutionError");
        assert.match(thrown.message, /fixture permanent bad request/);
        assert.deepEqual(failed.result.details, {}, "no canonical data reaches the host");
        assert.equal(failed.result.usage, undefined, "no host usage is delivered");
        const persisted = toolResultMessages(run.handle).find((message) => message.toolCallId === failed.toolCallId);
        assert.equal(persisted?.isError, true);
        assert.equal(persisted?.usage, undefined, "the session persists no usage for the failed call");
        // The thrown receipt keeps missingness locally and marks delivery unknown.
        const execution = thrown.execution as { accounting?: Record<string, unknown> };
        assert.equal(execution.accounting?.parentDelivery, "unknown");
        assert.equal(execution.accounting?.missingAttempts, 1);
        assert.deepEqual(execution.accounting?.tokens, {});
        assert.equal(execution.accounting?.costComplete, false);
      } else {
        assert.equal(run.thrown.length, 0, "a capable host receives a returned error result");
        assert.equal(failed.result.details?.intelli?.outcome, "error");
      }
    });

    it(
      "control: a falsely advertised error-result capability would report the failure as success on the floor loop",
      { skip: capabilities.loopHonoursReturnedIsError ? "this host honours returned isError" : false },
      async () => {
        const phase = "record-false-capability-control";
        const run = await runBatch({
          phase,
          calls: [researchCall(QF)],
          script: { rejectSearch: [QF] },
          advertiseErrorResults: true,
        });
        const [end] = ends(run.handle);
        await writeEvidence(isolation.root, "false-capability-control", evidenceOf(run));
        assertTripwires(run, phase);
        assert.equal(run.thrown.length, 0, "the runtime returned instead of throwing");
        assert(end, "one host end");
        // The floor loop ignores the returned isError: detection is load-bearing.
        assert.equal(end.isError, false, "floor marks the returned failure as success");
        assert.equal(end.result.details?.intelli?.outcome, "error");
      },
    );

    it("records the usage the floor lets a successful research observe", async () => {
      const phase = "record-usage";
      const run = await runBatch({ phase, calls: [researchCall(QA)] });
      const [end] = ends(run.handle);
      const evidence = evidenceOf(run);
      await writeEvidence(isolation.root, "usage", evidence);
      assertTripwires(run, phase);
      assert(end && !end.isError);
      const accounting = accountingOf(end) as {
        attempts?: number;
        observedAttempts?: number;
        missingAttempts?: number;
        tokens?: Record<string, number>;
        missingTokenFields?: string[];
        costComplete?: boolean;
      };
      const own = stageTotals(run.meter.rows, QA);
      const estimated = (accounting as { estimatedCost?: Record<string, number> }).estimatedCost ?? {};
      const hostUsage = end.result.usage as { input?: number; output?: number; totalTokens?: number; cost?: Record<string, number> };
      assert.equal(accounting.attempts, own.attempts);
      assert.equal(accounting.observedAttempts, own.attempts);
      assert.equal(accounting.missingAttempts, 0);
      assert.equal(accounting.costComplete, false);
      assert(Math.abs((estimated.output ?? NaN) - own.output * 2e-6) < 1e-12);
      if (capabilities.completionsStreamHook) {
        // Raw wire usage is visible: exact tokens, as on current hosts.
        assert.equal(accounting.tokens?.inputTotal, own.input);
        assert.equal(accounting.tokens?.outputTotal, own.output);
        return;
      }
      // Floor: no raw stream events. The SDK's zero-initialised usage cannot
      // prove a reported input, so only positive output is kept as observed and
      // every other token field stays missing rather than zero.
      assert.deepEqual(accounting.tokens, { outputTotal: own.output });
      assert.deepEqual(
        [...(accounting.missingTokenFields ?? [])].sort(),
        ["cacheRead", "cacheWrite", "cacheWrite1h", "inputTotal", "inputUncached", "reasoning", "totalTokens"],
      );
      // Observed inconsistency, pinned so a change is deliberate: the catalogue
      // estimate still carries the SDK's input cost for those missing tokens,
      // and host usage pairs a zero input placeholder with that input cost.
      assert(Math.abs((estimated.input ?? NaN) - own.input * 1e-6) < 1e-12);
      assert.equal(hostUsage.input, 0);
      assert.equal(hostUsage.output, own.output);
      assert.equal(hostUsage.totalTokens, own.output);
      assert(Math.abs((hostUsage.cost?.input ?? NaN) - own.input * 1e-6) < 1e-12);
    });

    it("reports later Codemode replay as unsupported at the floor rather than substituting a host", { skip: codemodeAvailable ? "Codemode exists on this control host; covered by native-replay-f7" : false }, async () => {
      assert.equal(codemodeAvailable, false);
      assert.equal(typeof (host as unknown as Record<string, unknown>).createCodemodeExtension, "undefined");
    });

    it("records auth resolution without credentials", async () => {
      const events = auth.events();
      await writeEvidence(isolation.root, "auth", { events });
      for (const event of events) {
        assert(!/login|enqueueCredentialOperation/.test(event.method), `no credential operation: ${event.method}`);
        if (event.method.endsWith(".refresh")) assert.notEqual(event.provider, "allowNetwork=true");
        else assert(["fixture-inproc", "fixture-stage"].includes(event.provider), event.provider);
      }
    });
  });
}
