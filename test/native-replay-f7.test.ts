// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// F7-1 (C30/T30) actual-wrapper and real-Codemode multi-research replay with
// the recorded suggestion read-view controller. Three-research blocks run the
// frozen CM-D02 development workflow shape (exact workflowQueries, four
// attempted synthetic pages each) serially and with genuinely overlapping
// parallel research, with suggestions active, fresh random run ids and wall
// UTC. Recording uses the credential-free loopback stage fixture through the
// real host registry; replay injects only `registryStreamSimple`,
// `pageTransport` and the suggestion read view in `mode: "transport-replay"`
// under a process-wide network guard. Binding condition N1 (verbatim):
//
//   a transport-replay implementation must never invoke `options.fetch` or
//   any network primitive. It must replay citations only through recorded
//   `onProviderStreamEvent` chunks, or through a declared non-network tee
//   seam if floor-host replay is ever required.
//
// The historical one-research positive and the unbound two-research failure
// stay in test/native-replay.test.ts, unchanged. This suite is development
// qualification support; it is not M3 acceptance or a study.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { join } from "node:path";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import {
  RAW_SENTINEL,
  REPO_ROOT,
  canonical,
  countAuthResolution,
  createMainFixture,
  createRecording,
  createReplayBlock,
  fixtureFiles,
  importHost,
  installNetworkGuard,
  isolateProcess,
  keySummary,
  loadCompiledNative,
  loadSourceNative,
  openSession,
  restoreWorkspace,
  selectHost,
  snapshotWorkspace,
  startStageFixture,
  syntheticPage,
  treeDigest,
  writeAgentConfig,
  writeEvidence,
  type HostSelection,
  type MainFixture,
  type MainTurn,
  type NetworkGuard,
  type SessionHandle,
  type StageFixture,
  type StageScript,
} from "./helpers/native-replay.js";
import {
  F7BlockIntegrityError,
  codemodeScript,
  createF7Recording,
  createF7Replay,
  defineSchedule,
  f7Pages,
  f7StageScript,
  fixtureFileRefs,
  hostOf,
  loadCorpusShape,
  loadF7BlockSync,
  overlayDigests,
  readBaseline,
  saveF7Block,
  scheduleSha256,
  type ControllerProbe,
  type F7BlockManifest,
  type F7RecordingDriver,
  type F7ReplayDriver,
  type F7ScheduleManifest,
  type ProbeEvent,
  type ProbeHooks,
  type StageControls,
  type StartOrder,
} from "./helpers/native-replay-f7.js";
import { parseUsageEvents } from "../scripts/benchmarks/usage-parser.js";
import { sha256Canonical } from "../scripts/benchmarks/canonical.js";
import {
  F7_SUGGESTION_MARKER,
  InvalidSuggestionArtefactError,
  SuggestionViewError,
  verifySuggestionArtefact,
  type SuggestionViewArtefact,
} from "../scripts/benchmarks/suggestion-replay.js";
import type { SuggestionWorkflowOperation } from "../scripts/benchmarks/suggestion-replay.js";

const isolation = await isolateProcess("f7", join(REPO_ROOT, ".tmp/f7-qualification"));
const guard: NetworkGuard = installNetworkGuard();
const hostSelection: HostSelection = await selectHost();
const host = await importHost(hostSelection);
const source = await loadSourceNative();
const auth = countAuthResolution(host as unknown as Record<string, unknown>, () => guard.phase());
const corpus = await loadCorpusShape();
const pages = f7Pages(corpus);
const [Q1, Q2, Q3] = corpus.workflowQueries as [string, string, string];
const QSEED = "seed research about bounded fetch admission";
const SEED_URL = "https://seed.example.test/doc";
/** Finite prespecified block visibility budget; fits inside the script budget. */
const BUDGET_MS = 20_000;
const SCRIPT_TIMEOUT_MS = 120_000;
/** Declared schedules must not cross UTC midnight (F7-1 Dependency Ownership). */
const MIDNIGHT_MARGIN_MS = 20 * 60_000;
let main: MainFixture;
let stage: StageFixture;

type NativeModule = typeof source.module;

const usage = (prompt: number, completion: number, cached?: number) => ({
  prompt_tokens: prompt,
  completion_tokens: completion,
  total_tokens: prompt + completion,
  ...(cached === undefined ? {} : { prompt_tokens_details: { cached_tokens: cached } }),
});

const SERIAL = defineSchedule({
  corpus,
  block: "serial",
  initialState: "empty",
  groups: [[["S1", 0]], [["S2", 1]], [["S3", 2]]],
});
const PARALLEL = defineSchedule({
  corpus,
  block: "parallel",
  initialState: "seeded",
  groups: [
    [
      ["P1", 0],
      ["P2", 1],
    ],
    [["P3", 2]],
  ],
});
const REPEAT = defineSchedule({
  corpus,
  block: "repeat",
  initialState: "seeded",
  groups: [[["R1", 0]], [["R2", 1]], [["R3", 0]]],
});
const COLLATE_FIRST = defineSchedule({
  corpus,
  block: "collate-first",
  initialState: "empty",
  groups: [[["K1", "collate"]], [["K2", 0]], [["K3", 1]]],
});
const OVERLAP_IDENTICAL = defineSchedule({
  corpus,
  block: "overlap-identical",
  initialState: "empty",
  groups: [
    [
      ["O1", 0],
      ["O2", 0],
    ],
  ],
});

/** Outside-boundary blocker observed on the first runtime pass (see runtime.md). */
const BLOCKER_SEQUENTIAL =
  'blocked: intelli_research/intelli_collate declare executionMode "sequential" and the host nested-call queue serialises them, so Codemode Promise.all cannot overlap research';

/** Parallel-only proofs need a recorded parallel block; fail explicitly instead of cascading. */
function requireParallel(block: FrozenBlock | undefined): FrozenBlock {
  if (!block) assert.fail(`parallel block unavailable (${BLOCKER_SEQUENTIAL})`);
  return block;
}

const researchCount = (schedule: F7ScheduleManifest) =>
  schedule.operations.filter((op) => op.kind === "research").length;

// ── Session plumbing ────────────────────────────────────────────────────────

interface PromptRun {
  readonly handle: SessionHandle;
  readonly wallMs: number;
  readonly mainBodies: string[];
  readonly promptError: string | null;
}

async function runPrompt(input: {
  readonly factory: ((pi: never) => void) | null;
  readonly workspace: string;
  readonly script: string;
  readonly phase: string;
  readonly ports: number[];
  readonly onToolEvent?: (event: Record<string, unknown>) => void;
  readonly extensionPaths?: readonly string[];
  readonly onSession?: (handle: SessionHandle) => void;
}): Promise<PromptRun> {
  const turns: MainTurn[] = [
    {
      toolCalls: [{ name: "codemode", args: { code: input.script } }],
      usage: usage(900, 40, 300),
    },
    { text: "Done.", usage: usage(1200, 6) },
  ];
  main.setScript(turns);
  guard.setPhase(input.phase, input.ports);
  const handle = await openSession({
    host,
    agentDir: isolation.agentDir,
    workspace: input.workspace,
    main,
    nativeFactory: input.factory,
    codemode: "on",
    ...(input.extensionPaths ? { extensionPaths: input.extensionPaths } : {}),
    ...(input.onToolEvent ? { onToolEvent: input.onToolEvent } : {}),
  });
  input.onSession?.(handle);
  const started = performance.now();
  let promptError: string | null = null;
  try {
    await handle.session.prompt("Run the qualification workflow.");
  } catch (error) {
    promptError = String(error);
  } finally {
    guard.setPhase("idle", [stage.port]);
  }
  const wallMs = performance.now() - started;
  const mainBodies = [...main.rawBodies];
  handle.dispose();
  return { handle, wallMs, mainBodies, promptError };
}

type ResearchEnd = {
  toolCallId: string;
  isError: boolean;
  durationMs?: number;
  result: { content?: Array<{ text?: string }>; details?: { intelli?: Record<string, unknown> } };
};

const researchEnds = (handle: SessionHandle) =>
  handle.events.filter(
    (event) =>
      (event as { type?: string }).type === "tool_execution_end" &&
      (event as { toolName?: string }).toolName === "intelli_research",
  ) as unknown as ResearchEnd[];

/** Every report producer's host end event (research and collation). */
const producerEnds = (handle: SessionHandle) =>
  handle.events.filter(
    (event) =>
      (event as { type?: string }).type === "tool_execution_end" &&
      ["intelli_research", "intelli_collate"].includes(String((event as { toolName?: string }).toolName)),
  ) as unknown as ResearchEnd[];

const codemodeEnd = (handle: SessionHandle) =>
  handle.events.find(
    (event) =>
      (event as { type?: string }).type === "tool_execution_end" &&
      (event as { toolName?: string }).toolName === "codemode",
  ) as { isError?: boolean; result?: unknown } | undefined;

/** Run-stable per-research evidence: no generated ids, paths or wall times. */
function stableResult(end: ResearchEnd) {
  const data = (end.result.details?.intelli ?? {}) as Record<string, unknown>;
  const accounting = (data.accounting ?? {}) as Record<string, unknown>;
  const sources = (data.sources ?? []) as Array<{ url?: string; state?: string }>;
  const cache = (data.cache ?? {}) as { status?: unknown; index?: unknown };
  return {
    isError: end.isError,
    outcome: data.outcome,
    sources: sources.map((s) => `${s.url}:${s.state}`).sort(),
    attempts: accounting.attempts,
    observedAttempts: accounting.observedAttempts,
    tokens: accounting.tokens,
    reportedCost: accounting.reportedCost,
    counts: data.counts,
    related: ((data.related ?? []) as Array<{ query?: string }>).map((r) => r.query),
    cache: { status: cache.status, index: cache.index },
    suggestionsUnavailable: JSON.stringify(data).includes("SUGGESTIONS_UNAVAILABLE"),
  };
}

/** Parallel ends may arrive in a different order; compare as a sorted multiset. */
const multiset = (values: unknown[]) => values.map((v) => canonical(v)).sort();

// ── Probe interpretation ────────────────────────────────────────────────────

const allocations = (probe: ControllerProbe) =>
  probe.log.filter(
    (event): event is Extract<ProbeEvent, { kind: "allocated" }> => event.kind === "allocated",
  );

/** Logical node of a native operation: its exact query plus serial allocation rank. */
function nodeOfOperation(
  probe: ControllerProbe,
  workflow: readonly SuggestionWorkflowOperation[],
  operationId: string,
): string {
  const own = allocations(probe).find((event) => event.operationId === operationId);
  if (!own) return `unallocated:${operationId}`;
  const rank = allocations(probe).filter((event) => event.query === own.query).indexOf(own) + 1;
  return workflow.find((op) => op.query === own.query && op.occurrence === rank)?.node ?? "unknown";
}

function labelOf(
  probe: ControllerProbe,
  workflow: readonly SuggestionWorkflowOperation[],
  reportPath: string,
): string {
  const owner = allocations(probe).find((event) => reportPath.includes(`/${event.runId}/`));
  return owner ? nodeOfOperation(probe, workflow, owner.operationId) : "baseline";
}

/** Per read: node, actual reader order and selected order, as logical labels. */
function readOrders(probe: ControllerProbe, workflow: readonly SuggestionWorkflowOperation[]) {
  return probe.log
    .filter(
      (event): event is Extract<ProbeEvent, { kind: "candidates-exit" }> =>
        event.kind === "candidates-exit",
    )
    .map((exit) => {
      const read = probe.log.find(
        (event): event is Extract<ProbeEvent, { kind: "read" }> =>
          event.kind === "read" && event.operationId === exit.operationId,
      );
      return {
        node: nodeOfOperation(probe, workflow, exit.operationId),
        current: read ? read.rows.map((row) => labelOf(probe, workflow, row)) : null,
        selected: exit.selected ? exit.selected.map((row) => labelOf(probe, workflow, row)) : null,
        error: exit.error,
      };
    });
}

const frozenViews = (artefact: SuggestionViewArtefact) =>
  Object.fromEntries(
    artefact.reads.map((read) => [
      read.readerNode,
      read.view.map((entry) => (entry.origin.kind === "baseline" ? "baseline" : entry.origin.producer)),
    ]),
  ) as Record<string, string[]>;

// ── Seed, record and freeze ─────────────────────────────────────────────────

const seedScript: StageScript = ({ role }) => {
  switch (role) {
    case "search":
      return { text: `Seed source: [Seed](${SEED_URL}).`, usage: usage(40, 8) };
    case "extract":
      return { text: "Official docs, current.\nSeed evidence.", usage: usage(90, 9) };
    case "collate":
      return { text: "Seed synthesis [S1].", usage: usage(70, 9) };
    case "suggest":
      return { text: "[]", usage: usage(10, 2) };
  }
};

/** One prior committed run in the initial tree, written through the real native pipeline. */
async function seed(workspace: string): Promise<void> {
  const recording = createRecording("f7-seed", new Map([[SEED_URL, syntheticPage("Seed", "Seed fact.")]]));
  stage.setScript(seedScript);
  const run = await runPrompt({
    factory: source.module.createNativeExtension({
      mode: "unit",
      registryStreamSimple: recording.modelTransport,
      pageTransport: recording.pageTransport,
    }) as never,
    workspace,
    script: [
      '// @options: {"timeout_ms": 60000}',
      `return String((await tools.intelli_research({ query: ${JSON.stringify(QSEED)}, maxUrls: 1 })).length);`,
    ].join("\n"),
    phase: "seed",
    ports: [stage.port],
  });
  assert.equal(run.promptError, null);
  assert.equal(researchEnds(run.handle).length, 1);
  assert.equal(researchEnds(run.handle)[0]!.isError, false, "seed research succeeded");
}

interface RecordedBlock {
  readonly schedule: F7ScheduleManifest;
  readonly workspace: string;
  readonly snapshot: string;
  readonly initialTreeDigest: string;
  readonly driver: F7RecordingDriver;
  readonly run: PromptRun;
  readonly script: { readonly script: string; readonly sha256: string; readonly startOrder: StartOrder };
  readonly stageRequests: ReadonlyArray<{ role: string; user: string }>;
  readonly baselineSize: number;
  readonly holdReleasedBy?: () => string;
}

async function recordBlock(
  schedule: F7ScheduleManifest,
  controls?: (driver: F7RecordingDriver) => StageControls & { holdReleasedBy?: () => string },
): Promise<RecordedBlock> {
  const workspace = join(isolation.root, `ws-${schedule.block}`);
  const snapshot = `${workspace}-s0`;
  await rm(workspace, { recursive: true, force: true });
  await mkdir(workspace, { recursive: true });
  if (schedule.initialState === "seeded") await seed(workspace);
  await snapshotWorkspace(workspace, snapshot);
  const initialTreeDigest = await treeDigest(snapshot);
  assert.equal(await treeDigest(workspace), initialTreeDigest);
  const { displayRoot, baseline, diagnostics } = await readBaseline(workspace);
  assert.equal(await treeDigest(workspace), initialTreeDigest, "the baseline read wrote nothing");
  assert.deepEqual(diagnostics, []);
  assert.equal(baseline.length, schedule.initialState === "seeded" ? 1 : 0);
  const driver = createF7Recording({
    scenario: `f7-${schedule.block}`,
    schedule,
    baseline,
    displayRoot,
    initialTreeDigest,
    pages,
  });
  const extra = controls?.(driver);
  stage.setScript(f7StageScript(corpus, extra ?? {}));
  const script = codemodeScript(schedule, { timeoutMs: SCRIPT_TIMEOUT_MS });
  const run = await runPrompt({
    factory: source.module.createNativeExtension({
      mode: "unit",
      registryStreamSimple: driver.recording.modelTransport,
      pageTransport: driver.recording.pageTransport,
      suggestionReadView: driver.probe.controller,
    }) as never,
    workspace,
    script: script.script,
    phase: `record-${schedule.block}`,
    ports: [stage.port],
    onToolEvent: driver.witnesses.onToolEvent,
  });
  return {
    schedule,
    workspace,
    snapshot,
    initialTreeDigest,
    driver,
    run,
    script,
    stageRequests: [...stage.requests],
    baselineSize: baseline.length,
    ...(extra?.holdReleasedBy ? { holdReleasedBy: extra.holdReleasedBy } : {}),
  };
}

interface FrozenBlock extends RecordedBlock {
  readonly dir: string;
  readonly manifest: F7BlockManifest;
  readonly artefact: SuggestionViewArtefact;
}

async function freezeBlock(recorded: RecordedBlock): Promise<FrozenBlock> {
  recorded.driver.session.assertValid();
  const files = fixtureFiles(recorded.driver.recording);
  // Record-once final binding of the actual fixture files, after recording.
  const artefact = recorded.driver.session.exportArtefact({ fixtureFiles: fixtureFileRefs(files) });
  const dir = join(isolation.root, "blocks", recorded.schedule.block);
  const manifest = await saveF7Block({
    dir,
    schedule: recorded.schedule,
    record: { scriptSha256: recorded.script.sha256, startOrder: recorded.script.startOrder },
    initialTreeDigest: recorded.initialTreeDigest,
    files,
    artefact,
  });
  await writeEvidence(isolation.root, `record-${recorded.schedule.block}`, {
    host: hostSelection,
    schedule: recorded.schedule,
    scheduleSha256: manifest.scheduleSha256,
    script: recorded.script,
    manifest,
    wallMs: Math.round(recorded.run.wallMs),
    probe: recorded.driver.probe.log,
    witnesses: recorded.driver.witnesses.records,
    observations: recorded.driver.session.observations(),
    readOrders: readOrders(recorded.driver.probe, artefact.workflow),
    frozenViews: frozenViews(artefact),
    results: researchEnds(recorded.run.handle).map(stableResult),
    holdReleasedBy: recorded.holdReleasedBy?.() ?? null,
    network: guard.violations(`record-${recorded.schedule.block}`),
  });
  return { ...recorded, dir, manifest, artefact };
}

/** Common recording assertions (validity, no main leakage, no guard violation). */
function assertRecorded(recorded: RecordedBlock) {
  assert.equal(recorded.run.promptError, null);
  assert.deepEqual(recorded.driver.faults, [], JSON.stringify(recorded.driver.faults.map(String)));
  assert.deepEqual(guard.violations(`record-${recorded.schedule.block}`), []);
  assert.equal(codemodeEnd(recorded.run.handle)?.isError, false, "the Codemode script settled");
  const ends = researchEnds(recorded.run.handle);
  assert.equal(ends.length, researchCount(recorded.schedule));
  for (const end of producerEnds(recorded.run.handle)) assert.equal(end.isError, false);
  const settled = recorded.driver.witnesses.records;
  assert.equal(settled.length, recorded.schedule.operations.length, "one host settled witness per producer");
  for (const witness of settled) assert.equal(witness.error, null, JSON.stringify(witness));
  for (const body of recorded.run.mainBodies) assert(!body.includes(RAW_SENTINEL));
  assert.equal(recorded.driver.recording.registryCalls(), recorded.stageRequests.length);
}

// ── Replay ──────────────────────────────────────────────────────────────────

interface ReplayVariant {
  readonly name: string;
  readonly module?: NativeModule;
  readonly startOrder?: StartOrder;
  readonly pageDelayMs?: (url: string) => number;
  readonly budgetMs?: number;
  readonly timeoutMs?: number;
  readonly throwAfter?: ProbeHooks["throwAfter"];
  readonly abortWhenReading?: { readonly query: string; readonly afterMs: number };
  readonly suggestNode?: Parameters<typeof createF7Replay>[0]["suggestNode"];
  /** false: record the stop without aborting (shows caught supplementary misses). */
  readonly stopOnInvalid?: boolean;
  readonly mutateWorkspace?: (workspace: string) => Promise<void>;
  readonly scriptEdit?: (script: string) => string;
  /** Wrap the controller object handed to the factory (capture-immutability proof). */
  readonly controllerFor?: (driver: F7ReplayDriver) => unknown;
}

async function replayBlock(frozen: FrozenBlock, variant: ReplayVariant) {
  await restoreWorkspace(frozen.snapshot, frozen.workspace);
  await variant.mutateWorkspace?.(frozen.workspace);
  const currentTree = await treeDigest(frozen.workspace);
  const loaded = loadF7BlockSync(frozen.dir);
  let handle: SessionHandle | undefined;
  let stops = 0;
  let settled = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const driver = createF7Replay({
    loaded,
    budgetMs: variant.budgetMs ?? BUDGET_MS,
    expectedInitialTreeDigest: loaded.manifest.initialTreeDigest,
    ...(variant.pageDelayMs ? { pageDelayMs: variant.pageDelayMs } : {}),
    ...(variant.suggestNode ? { suggestNode: variant.suggestNode } : {}),
    probeHooks: {
      ...(variant.throwAfter ? { throwAfter: variant.throwAfter } : {}),
      onCandidatesEnter: ({ query }) => {
        if (variant.abortWhenReading?.query !== query) return;
        const timer = setTimeout(() => {
          timers.delete(timer);
          void handle?.session.abort();
        }, variant.abortWhenReading.afterMs);
        timers.add(timer);
      },
    },
  });
  driver.setStop(() => {
    stops++;
    // A fault raised by end-of-block finalisation must not touch a disposed session.
    if (variant.stopOnInvalid !== false && !settled)
      Promise.resolve(handle?.session.abort()).catch(() => {});
  });
  const script = codemodeScript(frozen.schedule, {
    timeoutMs: variant.timeoutMs ?? SCRIPT_TIMEOUT_MS,
    ...(variant.startOrder ? { startOrder: variant.startOrder } : {}),
  });
  const scriptText = variant.scriptEdit ? variant.scriptEdit(script.script) : script.script;
  const stageBefore = stage.requests.length;
  const mainBefore = main.fetchCalls();
  const phase = `replay-${frozen.schedule.block}-${variant.name}`;
  const run = await runPrompt({
    factory: (variant.module ?? source.module).createNativeExtension({
      mode: "transport-replay",
      registryStreamSimple: driver.block.modelTransport,
      pageTransport: driver.block.pageTransport,
      suggestionReadView: (variant.controllerFor?.(driver) ?? driver.probe.controller) as never,
    }) as never,
    workspace: frozen.workspace,
    script: scriptText,
    phase,
    ports: [],
    onToolEvent: driver.witnesses.onToolEvent,
    onSession: (h) => {
      handle = h;
    },
  });
  settled = true;
  for (const timer of timers) clearTimeout(timer);
  return collectReplay(frozen, driver, run, {
    phase,
    currentTree,
    stops,
    stageBefore,
    mainBefore,
    scriptSha256: script.sha256,
    startOrder: script.startOrder,
  });
}

function collectReplay(
  frozen: FrozenBlock,
  driver: F7ReplayDriver,
  run: PromptRun,
  context: {
    readonly phase: string;
    readonly currentTree: string;
    readonly stops: number;
    readonly stageBefore: number;
    readonly mainBefore: number;
    readonly scriptSha256: string;
    readonly startOrder: StartOrder;
  },
) {
  let sessionValid = true;
  try {
    driver.session.assertValid();
  } catch {
    sessionValid = false;
  }
  // Library end-of-block completeness, distinct from the sticky-error check.
  let libraryComplete = true;
  let completeness: string | null = null;
  try {
    driver.session.assertReplayComplete();
  } catch (error) {
    libraryComplete = false;
    completeness = String(error).slice(0, 300);
  }
  let storesValid = true;
  try {
    driver.block.modelStore.assertValid();
    driver.block.fetchStore.assertValid();
  } catch {
    storesValid = false;
  }
  const observations = driver.session.observations();
  const projections = observations.filter((o) => o.kind === "projection").length;
  const contained = driver.probe.log.filter((event) => event.kind === "notification-threw");
  // Harness block validity: library validity and completeness, store
  // validity, no miss, no contained notification exception, and (as an
  // independent cross-check) every frozen research read projected once.
  const complete = projections === researchCount(frozen.schedule);
  const valid =
    sessionValid &&
    libraryComplete &&
    storesValid &&
    driver.block.missErrors.length === 0 &&
    driver.faults.length === 0 &&
    contained.length === 0 &&
    complete;
  return {
    driver,
    run,
    valid,
    sessionValid,
    libraryComplete,
    completeness,
    storesValid,
    complete,
    projections,
    contained,
    faults: driver.faults.map((f) => ({ reason: f.reason, message: f.message.slice(0, 240) })),
    misses: driver.block.missErrors.map((e) => ({
      reason: e.reason,
      node: e.key?.operationNode ?? null,
      message: e.message.slice(0, 240),
    })),
    stops: context.stops,
    treeMatches: context.currentTree === frozen.manifest.initialTreeDigest,
    network: guard.events(context.phase),
    violations: guard.violations(context.phase),
    authEvents: auth.events(context.phase),
    stageRequests: stage.requests.length - context.stageBefore,
    mainFetchCalls: main.fetchCalls() - context.mainBefore,
    model: keySummary(driver.block.modelStore),
    fetch: keySummary(driver.block.fetchStore),
    teeFetchCalls: driver.block.teeFetchCalls(),
    registryReads: driver.block.registryReads(),
    deliveredEvents: driver.block.deliveredEvents(),
    inFlight: driver.probe.inFlight(),
    readOrders: readOrders(driver.probe, frozen.artefact.workflow),
    observations,
    witnesses: driver.witnesses.records,
    scriptSha256: context.scriptSha256,
    startOrder: context.startOrder,
    results: producerEnds(run.handle).map(stableResult),
    codemodeError: codemodeEnd(run.handle)?.isError ?? null,
  };
}

type ReplayRun = ReturnType<typeof collectReplay>;

async function evidence(name: string, run: ReplayRun) {
  await writeEvidence(isolation.root, name, {
    host: hostSelection,
    ...run,
    driver: undefined,
    run: { wallMs: Math.round(run.run.wallMs), promptError: run.run.promptError },
    probe: run.driver.probe.log,
  });
}

/** The positive replay contract shared by every loader. */
function assertValidReplay(frozen: FrozenBlock, run: ReplayRun) {
  const detail = JSON.stringify({ faults: run.faults, misses: run.misses, contained: run.contained });
  assert.equal(run.run.promptError, null);
  assert(run.treeMatches, "the restored initial tree equals the block manifest");
  assert(run.valid, detail);
  assert.deepEqual(run.violations, []);
  assert.deepEqual(run.network, [], "zero network primitives of any kind during replay");
  assert.equal(run.stageRequests, 0);
  assert.equal(run.teeFetchCalls, 0, "N1: options.fetch never invoked");
  assert.equal(run.registryReads, 0, "the live registry is never dereferenced");
  assert.deepEqual(
    run.authEvents.filter((event) => /login|Credential/.test(event.method)),
    [],
    "no credential login or credential operation during replay",
  );
  assert(
    run.authEvents
      .filter((event) => event.method.endsWith(".refresh"))
      .every((event) => event.provider === "allowNetwork=false"),
  );
  assert.equal(main.unguardedStreams(), 0);
  assert(run.mainFetchCalls > 0, "main requests used only the injected in-process transport");
  assert.deepEqual(run.model.unconsumed, [], "every recorded model occurrence was replayed");
  assert.deepEqual(run.fetch.unconsumed, []);
  assert.deepEqual(
    [...run.model.consumed].sort(),
    loadF7BlockSync(frozen.dir)
      .files.model.fixtures.map((f) => `model:${f.key.operationNode}#${f.key.occurrence}`)
      .sort(),
  );
  assert(run.deliveredEvents > 0, "citations and wire usage arrive only through recorded events");
  assert.deepEqual(run.inFlight, { callbacks: 0, reads: 0 }, "no controller callback or read remains");
  assert.equal(run.codemodeError, false);
  const views = frozenViews(frozen.artefact);
  assert.equal(run.readOrders.length, researchCount(frozen.schedule));
  for (const read of run.readOrders) {
    assert.equal(read.error, null);
    assert.deepEqual(read.selected, views[read.node], `selected view of ${read.node} equals the frozen view`);
  }
  assert.deepEqual(
    multiset(run.results),
    multiset(producerEnds(frozen.run.handle).map(stableResult)),
    "results, accounting, related queries and cache outcomes match the recording",
  );
  const recordedUsage = parseUsageEvents(frozen.run.handle.events, "json");
  const replayedUsage = parseUsageEvents(run.run.handle.events, "json");
  assert.deepEqual(
    multiset(replayedUsage.toolMessages.map((t) => t.accounting ?? null)),
    multiset(recordedUsage.toolMessages.map((t) => t.accounting ?? null)),
  );
  for (const body of run.run.mainBodies) assert(!body.includes(RAW_SENTINEL));
  assert.equal(
    canonical(run.run.handle.captures.map((c) => c.payload)),
    canonical(run.run.mainBodies.map((b) => JSON.parse(b))),
  );
}

function assertInvalidReplay(run: ReplayRun) {
  assert.equal(run.valid, false, "the block is invalid");
  assert.deepEqual(run.violations, []);
  assert.deepEqual(run.network, [], "no network primitive, so no live fallback");
  assert.equal(run.stageRequests, 0);
  assert.equal(run.teeFetchCalls, 0);
  assert.equal(run.registryReads, 0);
  assert.deepEqual(run.inFlight, { callbacks: 0, reads: 0 }, "no controller callback or read remains");
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

before(async () => {
  const toMidnight = 86_400_000 - (Date.now() % 86_400_000);
  if (toMidnight < MIDNIGHT_MARGIN_MS)
    throw new Error(
      `F7 schedules would cross UTC midnight (${Math.round(toMidnight / 1000)}s left); rerun after midnight`,
    );
  main = await createMainFixture(hostSelection.root);
  stage = await startStageFixture();
  await writeAgentConfig(isolation.agentDir, stage.baseUrl, { defaultUrls: 4, maxUrls: 4 });
});

after(async () => {
  guard.restore();
  auth.restore();
  await stage?.close();
  if (!process.env.NATIVE_REPLAY_KEEP) await rm(isolation.root, { recursive: true, force: true });
});

// ── Suite ───────────────────────────────────────────────────────────────────

describe(`F7-1 suggestion replay through actual wrappers on ${hostSelection.kind} Pi ${hostSelection.version}`, () => {
  let serial: FrozenBlock;
  let parallel: FrozenBlock | undefined;
  let repeat: FrozenBlock;

  it("pins the corpus shape, schedules and overlay identity before capture", async () => {
    assert.deepEqual(corpus.workflowQueries.length, 3);
    for (const schedule of [SERIAL, PARALLEL, REPEAT])
      assert.equal(scheduleSha256(schedule), sha256Canonical(schedule));
    assert.deepEqual(
      PARALLEL.groups,
      [["P1", "P2"], ["P3"]],
      "P1 and P2 are one concurrently started group",
    );
    await writeEvidence(isolation.root, "pins", {
      corpus,
      overlay: await overlayDigests(),
      schedules: Object.fromEntries(
        [SERIAL, PARALLEL, REPEAT, COLLATE_FIRST, OVERLAP_IDENTICAL].map((s) => [s.block, scheduleSha256(s)]),
      ),
    });
  });

  it("records the serial block from an empty tree: empty and sibling-only views, raw requests beside canonical fixtures", async () => {
    const recorded = await recordBlock(SERIAL);
    assertRecorded(recorded);
    serial = await freezeBlock(recorded);
    assert.deepEqual(frozenViews(serial.artefact), { S1: [], S2: ["S1"], S3: ["S2", "S1"] });
    assert.equal(serial.artefact.suggestRequests.length, 2, "an empty view sends no judge request");
    const suggestFixtures = loadF7BlockSync(serial.dir).files.model.fixtures.filter(
      (f) => (f.request as { role?: string }).role === "suggest",
    );
    assert.deepEqual(suggestFixtures.map((f) => f.key.operationNode).sort(), ["S2.suggest", "S3.suggest"]);
    for (const fixture of suggestFixtures) {
      const request = fixture.request as { userMessage?: unknown; f7Suggestion?: { marker?: unknown } };
      assert.equal(request.userMessage, undefined, "the canonical fixture replaces userMessage");
      assert.equal(request.f7Suggestion?.marker, F7_SUGGESTION_MARKER);
    }
    // Raw actual judge messages are exactly what the stage fixture received.
    const stageSuggest = recorded.stageRequests.filter((r) => r.role === "suggest").map((r) => r.user);
    assert.deepEqual(
      serial.artefact.suggestRequests.map((r) => (r.raw as { userMessage: string }).userMessage).sort(),
      [...stageSuggest].sort(),
    );
    // Generated leaves are real: the raw messages embed fresh run ids and wall UTC.
    for (const allocation of allocations(recorded.driver.probe).slice(0, 2))
      assert(stageSuggest.some((user) => user.includes(allocation.runId)));
  });

  it("records the parallel block with genuine overlap, baseline plus sibling candidates", async () => {
    let releasedBy = "pending";
    const recorded = await recordBlock(PARALLEL, () => {
      let release: () => void = () => {};
      const p2Suggested = new Promise<void>((resolve) => {
        release = resolve;
      });
      const safety = setTimeout(() => {
        releasedBy = "safety-timeout";
        release();
      }, 10_000);
      return {
        // P1's synthesis is held until P2 has published and judged, so P1's
        // read witnesses P2 while both researches are in flight.
        holdCollate: (query) => (query === Q1 ? p2Suggested : undefined),
        onSuggest: (query) => {
          if (query === Q2 && releasedBy === "pending") {
            releasedBy = "p2-suggest";
            clearTimeout(safety);
            release();
          }
        },
        holdReleasedBy: () => releasedBy,
      };
    });
    const log = recorded.driver.probe.log;
    const firstIndexed = log.findIndex((event) => event.kind === "indexed");
    const allocatedBefore = log
      .slice(0, firstIndexed)
      .filter((event) => event.kind === "allocated")
      .map((event) => (event as { query: string }).query);
    await writeEvidence(isolation.root, "record-parallel-attempt", {
      releasedBy,
      allocatedBeforeFirstPublication: allocatedBefore,
      probe: log,
      toolEvents: recorded.run.handle.toolEvents.map((e) => ({ type: e.type, tool: e.toolName, id: e.toolCallId })),
      faults: recorded.driver.faults.map(String),
    });
    // Overlap is judged from real allocations, not host start events: the
    // host emits tool_execution_start before a sequential tool waits for the
    // nested-call queue.
    assert.deepEqual(
      new Set(allocatedBefore),
      new Set([Q1, Q2]),
      `${BLOCKER_SEQUENTIAL}; both group members must allocate before any publication`,
    );
    assertRecorded(recorded);
    assert.equal(releasedBy, "p2-suggest");
    parallel = await freezeBlock(recorded);
    const hostOrder = recorded.run.handle.toolEvents
      .filter((event) => event.toolName === "intelli_research")
      .map((event) => String(event.type).replace("tool_execution_", ""))
      .filter((type) => type !== "update");
    assert.deepEqual(hostOrder.slice(0, 2), ["start", "start"], "host saw both starts before any end");
    assert.deepEqual(frozenViews(parallel.artefact), {
      P1: ["P2", "baseline"],
      P2: ["baseline"],
      P3: ["P2", "P1", "baseline"],
    });
  });

  it("records serial repeated research: identical model-request occurrences and current-query exclusion", async () => {
    const recorded = await recordBlock(REPEAT);
    assertRecorded(recorded);
    repeat = await freezeBlock(recorded);
    assert.deepEqual(frozenViews(repeat.artefact), {
      R1: ["baseline"],
      R2: ["R1", "baseline"],
      R3: ["R2", "baseline"],
    });
    const r1 = allocations(recorded.driver.probe).find((event) => event.query === Q1)!;
    const r3Read = recorded.driver.probe.log.find(
      (event): event is Extract<ProbeEvent, { kind: "read" }> =>
        event.kind === "read" &&
        nodeOfOperation(recorded.driver.probe, repeat.artefact.workflow, event.operationId) === "R3",
    );
    assert(r3Read, "R3 read the real verified reader");
    assert(!r3Read.rows.some((row) => row.includes(`/${r1.runId}/`)), "the reader excluded R1's compatibility key");
    const repeated = loadF7BlockSync(repeat.dir).files.model.fixtures.filter((f) => f.key.occurrence === 2);
    assert(
      repeated.some((f) => (f.request as { role?: string }).role === "search") &&
        repeated.some((f) => (f.request as { role?: string }).role === "collate"),
      "identical search and collate requests keep ordered occurrences",
    );
  });

  it("replays the serial block through the source tree with zero pipeline network", async () => {
    const run = await replayBlock(serial, { name: "source" });
    await evidence("replay-serial-source", run);
    assertValidReplay(serial, run);
  });

  it("robustness-only subcase (predeclared, not a measurement): launch order permuted inside the concurrent group; the projection restores the frozen order", async () => {
    // Coordinator ruling D2: a predeclared launch-order permutation inside the
    // same concurrent group is robustness-only qualification. It is not an
    // identical-script measurement and is never pooled into an estimator; the
    // uniform measurement schedule and its script stay frozen separately.
    const run = await replayBlock(requireParallel(parallel), { name: "reversed", startOrder: [["P2", "P1"], ["P3"]] });
    await writeEvidence(isolation.root, "replay-parallel-reversed-label", {
      classification: "robustness-only",
      measurement: false,
      measurementScriptSha256: requireParallel(parallel).script.sha256,
      permutedScriptSha256: run.scriptSha256,
      startOrder: run.startOrder,
      scheduleSha256: requireParallel(parallel).manifest.scheduleSha256,
    });
    assert.notEqual(run.scriptSha256, requireParallel(parallel).script.sha256, "the permuted script is a distinct exact script");
    await evidence("replay-parallel-reversed", run);
    assertValidReplay(requireParallel(parallel), run);
    assert.equal(allocations(run.driver.probe)[0]?.query, Q2, "P2 allocated first during replay");
    const p3 = run.readOrders.find((read) => read.node === "P3")!;
    assert.deepEqual(p3.current, ["P1", "P2", "baseline"], "actual reader order follows the replay admission order");
    assert.deepEqual(p3.selected, ["P2", "P1", "baseline"], "selected order equals the recorded view");
  });

  it("replays the parallel block with a real visibility wait for a later-publishing sibling", async () => {
    const run = await replayBlock(requireParallel(parallel), {
      name: "visibility-wait",
      pageDelayMs: (url) => (new URL(url).host === hostOf(1) ? 2_500 : 0),
    });
    await evidence("replay-parallel-visibility-wait", run);
    assertValidReplay(requireParallel(parallel), run);
    const waits = run.observations.filter((o) => o.kind === "visibility-wait");
    assert.deepEqual(
      waits.map((o) => ({ node: (o as { node: string }).node, waitedFor: (o as unknown as { waitedFor: string[] }).waitedFor })),
      [{ node: "P1", waitedFor: ["P2"] }],
    );
  });

  it("replays serial repeated research with ordered identical occurrences", async () => {
    const run = await replayBlock(repeat, { name: "source" });
    await evidence("replay-repeat-source", run);
    assertValidReplay(repeat, run);
  });

  it("replays through a private compiled tree; the controller object is captured at factory time", async () => {
    const compiled = await loadCompiledNative(join(isolation.root, "compiled"));
    assert.notEqual(compiled.module.createNativeExtension, source.module.createNativeExtension);
    assert.deepEqual(compiled.sourceHashes, source.sourceHashes);
    let tripwire = 0;
    const run = await replayBlock(repeat, {
      name: "compiled",
      module: compiled.module,
      controllerFor: (driver) => {
        const object = { ...driver.probe.controller };
        // Mutated after the factory captured it (the factory runs first below).
        queueMicrotask(() =>
          Object.assign(object, {
            candidates: async () => {
              tripwire++;
              throw new Error("mutated after capture");
            },
          }),
        );
        return object;
      },
    });
    await evidence("replay-repeat-compiled", run);
    assert.equal(tripwire, 0);
    assertValidReplay(repeat, run);
    assert.throws(
      () =>
        compiled.module.createNativeExtension({
          mode: "transport-replay",
          registryStreamSimple: async () => {
            throw new Error();
          },
          pageTransport: async () => {
            throw new Error();
          },
          suggestionReadView: { ...run.driver.probe.controller, extra: () => {} } as never,
        }),
      /unknown member/,
    );
  });

  for (const kind of ["source", "compiled"] as const)
    it(`replays the repeat block through the host's own extension loader (jiti, fresh module graph): ${kind}`, async () => {
      const entry =
        kind === "source" ? source.entry : join(isolation.root, "compiled", "src/index.js");
      const dir = join(isolation.root, `host-loaded-${kind}`);
      await mkdir(dir, { recursive: true });
      const key = `native-replay-f7.host-loaded.${kind}`;
      const wrapper = join(dir, "extension.ts");
      await writeFile(
        wrapper,
        [
          `import { VERSION } from "@earendil-works/pi-coding-agent";`,
          `import { createNativeExtension } from ${JSON.stringify(entry)};`,
          `import { createF7Replay, loadF7BlockSync } from ${JSON.stringify(join(REPO_ROOT, "test/helpers/native-replay-f7.ts"))};`,
          `const loaded = loadF7BlockSync(${JSON.stringify(repeat.dir)});`,
          `const driver = createF7Replay({ loaded, budgetMs: ${BUDGET_MS}, expectedInitialTreeDigest: loaded.manifest.initialTreeDigest });`,
          `const g = globalThis as Record<symbol, unknown>;`,
          `driver.setStop(() => (g[Symbol.for(${JSON.stringify(`${key}.stop`)})] as (() => void) | undefined)?.());`,
          `g[Symbol.for(${JSON.stringify(key)})] = { driver, createNativeExtension, peerVersion: VERSION };`,
          `export default createNativeExtension({ mode: "transport-replay", registryStreamSimple: driver.block.modelTransport, pageTransport: driver.block.pageTransport, suggestionReadView: driver.probe.controller });`,
        ].join("\n"),
      );
      const g = globalThis as Record<symbol, unknown>;
      const probe = () =>
        g[Symbol.for(key)] as
          | { driver: F7ReplayDriver; createNativeExtension: unknown; peerVersion: string }
          | undefined;
      await restoreWorkspace(repeat.snapshot, repeat.workspace);
      const currentTree = await treeDigest(repeat.workspace);
      const script = codemodeScript(repeat.schedule, { timeoutMs: SCRIPT_TIMEOUT_MS });
      const stageBefore = stage.requests.length;
      const mainBefore = main.fetchCalls();
      const phase = `replay-repeat-host-${kind}`;
      const run = await runPrompt({
        factory: null,
        workspace: repeat.workspace,
        script: script.script,
        phase,
        ports: [],
        extensionPaths: [wrapper],
        onToolEvent: (event) => probe()?.driver.witnesses.onToolEvent(event),
        onSession: (handle) => {
          g[Symbol.for(`${key}.stop`)] = () => Promise.resolve(handle.session.abort()).catch(() => {});
        },
      });
      g[Symbol.for(`${key}.stop`)] = () => {};
      const loadedProbe = probe();
      assert(loadedProbe, "the host loaded the wrapper");
      const collected = collectReplay(repeat, loadedProbe.driver, run, {
        phase,
        currentTree,
        stops: 0,
        stageBefore,
        mainBefore,
        scriptSha256: script.sha256,
        startOrder: script.startOrder,
      });
      await evidence(`replay-repeat-host-${kind}`, collected);
      assert.notEqual(loadedProbe.createNativeExtension, source.module.createNativeExtension);
      assert.equal(loadedProbe.peerVersion, hostSelection.version);
      assertValidReplay(repeat, collected);
    });

  it("keeps the historical unbound behaviour: without the F7 controller and preparation the first judge request misses", async () => {
    await restoreWorkspace(repeat.snapshot, repeat.workspace);
    const loaded = loadF7BlockSync(repeat.dir);
    const block = createReplayBlock(loaded.files);
    let handle: SessionHandle | undefined;
    block.onMiss(() => void handle?.session.abort());
    const phase = "replay-repeat-unbound";
    const run = await runPrompt({
      factory: source.module.createNativeExtension({
        mode: "transport-replay",
        registryStreamSimple: block.modelTransport,
        pageTransport: block.pageTransport,
      }) as never,
      workspace: repeat.workspace,
      script: codemodeScript(repeat.schedule).script,
      phase,
      ports: [],
      onSession: (h) => {
        handle = h;
      },
    });
    await writeEvidence(isolation.root, "replay-repeat-unbound", {
      misses: block.missErrors.map((e) => ({ reason: e.reason, node: e.key?.operationNode ?? null })),
      network: guard.events(phase),
      promptError: run.promptError,
    });
    assert(block.missErrors.length >= 1);
    assert.equal(block.missErrors[0]!.reason, "not-found");
    assert.match(String(block.missErrors[0]!.key?.operationNode), /^suggest\//);
    assert.deepEqual(guard.events(phase), []);
  });

  let collateFirst: FrozenBlock;

  it("records a declared collate-only producer followed by research that suggests it", async () => {
    const recorded = await recordBlock(COLLATE_FIRST);
    assertRecorded(recorded);
    collateFirst = await freezeBlock(recorded);
    assert.deepEqual(
      collateFirst.artefact.workflow.map((op) => [op.node, op.kind]),
      [
        ["K1", "collate"],
        ["K2", "research"],
        ["K3", "research"],
      ],
    );
    assert.equal(collateFirst.artefact.reads.length, 2, "the collate producer has no frozen read");
    assert.deepEqual(frozenViews(collateFirst.artefact), { K2: ["K1"], K3: ["K2", "K1"] });
    assert(
      !recorded.driver.probe.log.some(
        (event) => event.kind === "candidates-enter" && event.query === corpus.query,
      ),
      "the collation never read candidates",
    );
  });

  it("replays the collate-first block with the declared collate producer published before research reads", async () => {
    const run = await replayBlock(collateFirst, { name: "source" });
    await evidence("replay-collate-first-source", run);
    assertValidReplay(collateFirst, run);
  });

  it("fails closed on an undeclared collate producer inside a block", async () => {
    const collateLine = codemodeScript(COLLATE_FIRST).script.split("\n").find((line) => line.includes("intelli_collate"))!;
    const run = await replayBlock(serial, {
      name: "undeclared-collate",
      scriptEdit: (script) => script.replace("const out = [];", `const out = [];\n${collateLine}`),
    });
    await evidence("replay-serial-undeclared-collate", run);
    assertInvalidReplay(run);
    assert.equal(run.faults[0]?.reason, "unknown-operation");
  });

  it("fails closed when the declared collate publication is missing", async () => {
    const run = await replayBlock(collateFirst, {
      name: "missing-collate",
      budgetMs: 1_500,
      scriptEdit: (script) =>
        script
          .split("\n")
          .filter((line) => !line.includes("intelli_collate"))
          .join("\n"),
    });
    await evidence("replay-collate-first-missing-collate", run);
    assertInvalidReplay(run);
    assert.equal(run.faults[0]?.reason, "budget-expired");
    assert.equal(run.libraryComplete, false);
  });

  // ── Negative proofs ───────────────────────────────────────────────────────

  it("rejects tampered block files, artefact bindings and reordered views before any session", async () => {
    const copy = async (name: string) => {
      const dir = join(isolation.root, "tamper", name);
      await rm(dir, { recursive: true, force: true });
      await cp(repeat.dir, dir, { recursive: true });
      return dir;
    };
    const rewrite = async (dir: string, file: string, edit: (value: SuggestionViewArtefact) => void, forge: boolean) => {
      const path = join(dir, file);
      const value = JSON.parse(await readFile(path, "utf8")) as SuggestionViewArtefact;
      edit(value);
      const text = `${JSON.stringify(value, null, 2)}\n`;
      await writeFile(path, text);
      if (forge) {
        const manifestPath = join(dir, "manifest.json");
        const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
          files: Record<string, { name: string; bytesSha256: string }>;
        };
        for (const entry of Object.values(manifest.files))
          if (entry.name === file) entry.bytesSha256 = createHash("sha256").update(text).digest("hex");
        await writeFile(manifestPath, JSON.stringify(manifest));
      }
      return value;
    };
    const corruptBinding = (artefact: SuggestionViewArtefact) => {
      const record = artefact.suggestRequests.find((r) => r.bindings.length > 0)!;
      (record.bindings[0] as { capturedValue: string }).capturedValue = "2000-01-01T00:00:00.000Z";
    };
    // Byte drift is caught by the block manifest.
    const unforged = await copy("binding-bytes");
    await rewrite(unforged, "suggestion-view.json", corruptBinding, false);
    assert.throws(() => loadF7BlockSync(unforged), F7BlockIntegrityError);
    // A forged manifest still fails the library's reconstruction checks.
    const forged = await copy("binding-forged");
    const forgedValue = await rewrite(forged, "suggestion-view.json", corruptBinding, true);
    assert.throws(() => verifySuggestionArtefact(forgedValue), InvalidSuggestionArtefactError);
    assert.throws(() => loadF7BlockSync(forged), InvalidSuggestionArtefactError);
    // Reordering a recorded view, even with recomputed section digests, fails.
    const reordered = await copy("view-order");
    const reorderedValue = await rewrite(
      reordered,
      "suggestion-view.json",
      (artefact) => {
        const read = artefact.reads.find((r) => r.readerNode === "R3")!;
        (read as unknown as { view: unknown[] }).view = [...read.view].reverse();
        (read as unknown as { dependencies: string[] }).dependencies = [...read.dependencies].reverse();
        (artefact as unknown as { integrity: Record<string, string> }).integrity.readsSha256 = sha256Canonical(artefact.reads);
      },
      true,
    );
    assert.throws(() => verifySuggestionArtefact(reorderedValue), InvalidSuggestionArtefactError);
    // A transport fixture byte change is caught before replay.
    const fixture = await copy("fixture-bytes");
    const modelPath = join(fixture, "model.json");
    await writeFile(modelPath, (await readFile(modelPath, "utf8")).replace("Angle 2 synthesis", "Angle 2 synthesis!"));
    assert.throws(() => loadF7BlockSync(fixture), F7BlockIntegrityError);
  });

  it("fails closed when suggestion node derivation differs from the recorded representation", async () => {
    const run = await replayBlock(repeat, {
      name: "node-drift",
      suggestNode: (view) => `${view.readerNode}.suggest-drift`,
    });
    await evidence("replay-repeat-node-drift", run);
    assertInvalidReplay(run);
    assert.equal(run.misses[0]?.reason, "not-found");
    assert.match(String(run.misses[0]?.node), /\.suggest-drift$/);
  });

  it("detects an altered initial tree; a removed baseline run invalidates even when the supplementary stage catches the miss", async () => {
    const loaded = loadF7BlockSync(repeat.dir);
    const removeSeed = async (workspace: string) => {
      const runs = join(workspace, ".search/.intelli-v1/runs");
      const seedRun = loaded.artefact.baseline[0]!.reportPath.split("/").at(-2)!;
      await rm(join(runs, seedRun), { recursive: true, force: true });
    };
    await restoreWorkspace(repeat.snapshot, repeat.workspace);
    await removeSeed(repeat.workspace);
    const altered = await treeDigest(repeat.workspace);
    assert.notEqual(altered, loaded.manifest.initialTreeDigest);
    assert.throws(
      () => createF7Replay({ loaded, budgetMs: BUDGET_MS, expectedInitialTreeDigest: altered }),
      (error: unknown) => error instanceof SuggestionViewError && error.reason === "initial-state-changed",
    );
    const run = await replayBlock(repeat, { name: "baseline-removed", mutateWorkspace: removeSeed, stopOnInvalid: false });
    await evidence("replay-repeat-baseline-removed", run);
    assertInvalidReplay(run);
    assert.equal(run.treeMatches, false);
    assert.equal(run.faults[0]?.reason, "missing-required-candidate");
    assert(
      run.results.some((r) => !r.isError && r.suggestionsUnavailable),
      "a research returned useful output after its suggestion miss was caught",
    );
  });

  it("fails closed on a raw query change that embeds a recorded generated value", async () => {
    const p1 = repeat.driver.probe.log.find(
      (event): event is Extract<ProbeEvent, { kind: "allocated" }> => event.kind === "allocated" && event.query === Q1,
    )!;
    const run = await replayBlock(repeat, {
      name: "query-drift",
      scriptEdit: (script) => script.replace(JSON.stringify(Q2).slice(1, -1), `${JSON.stringify(Q2).slice(1, -1)} ${p1.displayPath}`),
    });
    await evidence("replay-repeat-query-drift", run);
    assertInvalidReplay(run);
    assert.equal(run.faults[0]?.reason, "unknown-operation");
  });

  it("invalidates overlapping identical research during recording", async () => {
    const recorded = await recordBlock(OVERLAP_IDENTICAL);
    await writeEvidence(isolation.root, "record-overlap-identical", {
      faults: recorded.driver.faults.map((f) => ({ reason: f.reason, message: f.message })),
      probe: recorded.driver.probe.log,
    });
    assert(recorded.driver.faults.length >= 1, `${BLOCKER_SEQUENTIAL}; the identical researches never overlapped`);
    assert(["overlapping-queries", "serial-order"].includes(recorded.driver.faults[0]!.reason));
    assert.throws(() => recorded.driver.session.exportArtefact(), SuggestionViewError);
  });

  it("contains a notification exception without changing store writes, and the harness invalidates the block", async () => {
    const run = await replayBlock(repeat, { name: "indexed-throws", throwAfter: (name) => name === "indexed" });
    await evidence("replay-repeat-indexed-throws", run);
    assertInvalidReplay(run);
    assert(run.contained.length >= 1);
    for (const result of run.results) {
      assert.equal(result.isError, false);
      assert.deepEqual(result.cache, { status: "committed", index: "updated" }, "the real write outcome is preserved");
      assert.equal(result.suggestionsUnavailable, true, "the poisoned read surfaced as a caught suggestion miss");
    }
    assert.equal(run.complete, false, "no frozen read was projected after poisoning");
    assert.equal(run.sessionValid, true, "the library saw no fault of its own");
    assert.equal(run.libraryComplete, false, "end-of-block completeness rejects the poisoned block");
  });

  it("expires the finite block budget during a visibility wait", async () => {
    const run = await replayBlock(requireParallel(parallel), {
      name: "budget-expired",
      budgetMs: 300,
      pageDelayMs: (url) => (new URL(url).host === hostOf(1) ? 4_000 : 0),
    });
    await evidence("replay-parallel-budget-expired", run);
    assertInvalidReplay(run);
    assert.equal(run.faults[0]?.reason, "budget-expired");
  });

  it("invalidates on operation cancellation during a visibility wait", async () => {
    const run = await replayBlock(requireParallel(parallel), {
      name: "cancelled",
      pageDelayMs: (url) => (new URL(url).host === hostOf(1) ? 6_000 : 0),
      abortWhenReading: { query: Q1, afterMs: 150 },
    });
    await evidence("replay-parallel-cancelled", run);
    assertInvalidReplay(run);
    assert.equal(run.faults[0]?.reason, "cancelled");
  });

  it("invalidates when the enclosing Codemode script deadline expires during a visibility wait", async () => {
    const p1End = researchEnds(requireParallel(parallel).run.handle).find((end) =>
      stableResult(end).sources.some((source) => source.includes(hostOf(0))),
    );
    const p1Ms = Math.max(1_000, Math.round(p1End?.durationMs ?? 2_000));
    const timeoutMs = p1Ms * 2 + 1_000;
    const run = await replayBlock(requireParallel(parallel), {
      name: "script-deadline",
      timeoutMs,
      pageDelayMs: (url) => (new URL(url).host === hostOf(1) ? timeoutMs + 5_000 : 0),
    });
    await evidence("replay-parallel-script-deadline", { ...run, timeoutMs } as ReplayRun);
    assertInvalidReplay(run);
    assert.equal(run.faults[0]?.reason, "cancelled");
    assert.equal(run.codemodeError, true, "the script deadline surfaced as a Codemode error");
  });
});
