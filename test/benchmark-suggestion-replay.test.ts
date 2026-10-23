// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dirname, relative } from "node:path";
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { formatIndexForJudge } from "../src/core/cache.js";
import { compatibilityKeyFor } from "../src/core/run-format.js";
import { createExecutionCoordinator } from "../src/core/execution-coordinator.js";
import { createSystemClock } from "../src/core/clock.js";
import type {
  CommittedRun,
  IndexCandidate,
  OperationLease,
  RunReservation,
  RunStore,
} from "../src/core/contracts.js";
import { withNativeSuggestionReadView } from "../src/native-suggestion-view.js";
import type { NativeSuggestionReadView } from "../src/native-injection.js";
import { asJson, canonicalJson, sha256Canonical } from "../scripts/benchmarks/canonical.js";
import { createFixtureRecorder, createReplayStore, ReplayMissError } from "../scripts/benchmarks/replay-store.js";
import {
  createModelTransportReplay,
  createRoleInferencer,
  type ModelNodeResolver,
} from "../scripts/benchmarks/transport-replay.js";
import {
  buildSuggestionSegments,
  createSuggestionTransportPreparation,
  createSuggestionViewRecorder,
  createSuggestionViewReplay,
  loadSuggestionViewArtefact,
  renderSuggestionSegments,
  saveSuggestionViewArtefact,
  suggestionArtefactSha256,
  verifySuggestionArtefact,
  SuggestionViewError,
  type SuggestionBaselineEntry,
  type SuggestionViewArtefact,
  type SuggestionViewRecorder,
  type SuggestionViewReplay,
  type SuggestionViewSession,
} from "../scripts/benchmarks/suggestion-replay.js";
import type { Json, ModelFixtureRequest } from "../scripts/benchmarks/contracts.js";
import { forbidNetwork, removeDir, scratchDir } from "../scripts/benchmarks/testing.js";

// N1 (verbatim): a transport-replay implementation must never invoke
// `options.fetch` or any network primitive. It must replay citations only
// through recorded `onProviderStreamEvent` chunks, or through a declared
// non-network tee seam if floor-host replay is ever required.

const SCENARIO = "suggestion-f7-unit";
const MODEL = { provider: "fixture-openrouter", id: "minimax/minimax-m3" } as unknown as Model<Api>;
const DISPLAY_ROOT = ".search";
const DATE = "2026-10-23";

const PROMPTS = {
  search: "You are the synthetic search stage.",
  extract: "You are the synthetic extraction stage.",
  collate: "You are the synthetic collation stage.",
  suggest: "You judge search query relevance.",
};
const roleOf = createRoleInferencer(PROMPTS);

const resolver: ModelNodeResolver = (request) => {
  const role = roleOf(request.systemPrompt);
  if (role === null) return { ambiguous: true, detail: `unknown system prompt "${request.systemPrompt}"` };
  const node: Record<string, string> = {
    search: "research.search",
    extract: "research.extract",
    collate: "research.collate",
    suggest: "ignored.suggest",
  };
  return { operationNode: node[role]!, role };
};

function reservationFor(query: string, date: string, runId: string, sequence: number): RunReservation {
  return {
    namespaceId: "a".repeat(32),
    runId,
    sequence,
    startedUtc: `${date}T09:00:00.000Z`,
    compatibilityKey: compatibilityKeyFor(query, date),
    physicalPath: `/cache/.intelli-v1/runs/${runId}`,
    displayPath: `${DISPLAY_ROOT}/.intelli-v1/runs/${runId}`,
  };
}

/** A fresh replay reservation: new random run identity, same query and date semantics. */
function freshReservation(base: RunReservation, runId: string): RunReservation {
  return {
    ...base,
    runId,
    physicalPath: `/cache/.intelli-v1/runs/${runId}`,
    displayPath: `${DISPLAY_ROOT}/.intelli-v1/runs/${runId}`,
  };
}

/** A fresh v1 row for a replay producer, consistent with its fresh reservation. */
function freshRow(base: IndexCandidate, runId: string): IndexCandidate {
  return { ...base, reportPath: `${DISPLAY_ROOT}/.intelli-v1/runs/${runId}/report.md` };
}

function runOf(reservation: RunReservation): CommittedRun {
  return { reservation, files: [], manifestSha256: "f".repeat(64) };
}

function v1Row(query: string, date: string, runId: string, sequence: number): IndexCandidate {
  return {
    query,
    reportPath: `${DISPLAY_ROOT}/.intelli-v1/runs/${runId}/report.md`,
    namespace: "v1",
    startedUtc: `${date}T09:00:00.000Z`,
    compatibilityKey: compatibilityKeyFor(query, date),
    admissionSequence: sequence,
  };
}

function legacyRow(query: string, date: string, slug: string): IndexCandidate {
  return {
    query,
    reportPath: `${DISPLAY_ROOT}/${slug}/report.md`,
    namespace: "legacy",
    startedUtc: `${date}T08:00:00.000Z`,
    compatibilityKey: compatibilityKeyFor(query, date),
  };
}

// The frozen block: two baseline entries, two parallel producers with unique
// queries and one serial repeat of the first query.
const BASELINE: readonly SuggestionBaselineEntry[] = [
  legacyRow("legacy topic research", "2026-10-20", "2026-10-20-legacy-topic-research-1a2b3c"),
  v1Row("prior v1 search", "2026-10-21", "2026-10-21-prior-v1-search-9f8e7d", 41),
];
const WORKFLOW = [
  { node: "research-alpha", query: "alpha query", occurrence: 1 },
  { node: "research-beta", query: "beta query", occurrence: 1 },
  { node: "alpha-repeat", query: "alpha query", occurrence: 2 },
] as const;
const SCHEDULE_MANIFEST_SHA256 = "2".repeat(64);
const FIXTURE_FILES = [{ name: "model", sha256: "5".repeat(64) }] as const;
const RES_ALPHA = reservationFor("alpha query", DATE, "2026-10-23-alpha-query-a1b2c3", 42);
const RES_BETA = reservationFor("beta query", DATE, "2026-10-23-beta-query-d4e5f6", 43);
const RES_REPEAT = reservationFor("alpha query", DATE, "2026-10-23-alpha-query-g7h8i9", 44);
const ROW_ALPHA = v1Row("alpha query", DATE, RES_ALPHA.runId, 42);
const ROW_BETA = v1Row("beta query", DATE, RES_BETA.runId, 43);
const ROW_REPEAT = v1Row("alpha query", DATE, RES_REPEAT.runId, 44);

/** Builds the real judge message exactly like src/core/research-result.ts suggestions(). */
function judgeMessage(query: string, selected: readonly IndexCandidate[]): string {
  const index = {
    searches: selected.map((item) => ({
      query: item.query,
      timestamp: item.startedUtc,
      slug: relative(DISPLAY_ROOT, dirname(item.reportPath)),
    })),
  };
  return `Current query: "${query}"\n\nPrevious searches:\n${formatIndexForJudge(index, "")}`;
}

function suggestRequest(query: string, selected: readonly IndexCandidate[]): ModelFixtureRequest {
  return {
    model: { provider: MODEL.provider, model: MODEL.id },
    role: "suggest",
    systemPrompt: PROMPTS.suggest,
    userMessage: judgeMessage(query, selected),
    maxTokens: 500,
    reasoning: null,
    effectivePayloadPatch: null,
  };
}

function nonSuggestRequest(): ModelFixtureRequest {
  return {
    model: { provider: MODEL.provider, model: MODEL.id },
    role: "search",
    systemPrompt: PROMPTS.search,
    userMessage: "fixture search query",
    maxTokens: 2048,
    reasoning: "low",
    effectivePayloadPatch: null,
  };
}

function userContext(text: string, systemPrompt: string): Context {
  return { systemPrompt, messages: [{ role: "user", content: [{ type: "text", text }], timestamp: 1 }] };
}

interface BlockHarness {
  readonly store: RunStore;
  begin(id: string): OperationLease;
  wrap(operation: OperationLease): RunStore;
  finish(): Promise<void>;
}

/**
 * Drives the REAL native wrapper (withNativeSuggestionReadView) over a
 * controllable fake RunStore, one wrapper per operation, sharing one
 * controller across the block exactly like the loaded runtime does.
 */
function harness(
  controller: NativeSuggestionReadView,
  plan: {
    /** Planned allocations per exact query, consumed in call order. */
    readonly reservations?: Readonly<Record<string, readonly RunReservation[]>>;
    readonly rows: readonly IndexCandidate[] | (() => readonly IndexCandidate[]);
    readonly indexResults?: readonly ("updated" | "unavailable")[];
  },
): BlockHarness {
  const coordinator = createExecutionCoordinator({
    generation: 1,
    clock: createSystemClock(),
    modelConcurrency: 5,
    criticalReserve: 1,
    fetchConcurrency: 4,
    minRequestIntervalMs: 0,
  });
  const reservations = new Map(Object.entries(plan.reservations ?? {}).map(([query, list]) => [query, [...list]]));
  const indexResults = [...(plan.indexResults ?? [])];
  const wrappers: RunStore[] = [];
  const operations: OperationLease[] = [];
  const store: RunStore = {
    allocate: async (input) => {
      const queue = reservations.get(input.query);
      if (queue !== undefined && queue.length > 0) return { status: "allocated", reservation: queue.shift()! };
      return { status: "unavailable", diagnostic: { code: "EXHAUSTED", message: "no planned reservation" } };
    },
    commit: async (reservation) => ({ status: "committed", run: runOf(reservation) }),
    updateIndex: async () => (indexResults.length > 0 ? indexResults.shift()! : "updated"),
    recordAccounting: async () => ({ status: "recorded", path: "/accounting" }),
    candidates: async () => (typeof plan.rows === "function" ? plan.rows() : plan.rows),
    settle: async () => {},
  };
  let counter = 0;
  return {
    store,
    begin: (id) => {
      const operation = coordinator.begin(`${id}-${++counter}`);
      operations.push(operation);
      return operation;
    },
    wrap: (operation) => {
      const wrapper = withNativeSuggestionReadView(store, controller, operation);
      wrappers.push(wrapper);
      return wrapper;
    },
    finish: async () => {
      for (const wrapper of wrappers) await wrapper.settle();
      for (const operation of operations) await operation.settle();
      await coordinator.close();
    },
  };
}

interface DrivenOperation {
  readonly operation: OperationLease;
  readonly wrapper: RunStore;
  readonly reservation: RunReservation | undefined;
  readonly view: readonly IndexCandidate[];
}

async function allocateOn(block: BlockHarness, query: string): Promise<{ operation: OperationLease; wrapper: RunStore; reservation: RunReservation | undefined }> {
  const operation = block.begin("op");
  const wrapper = block.wrap(operation);
  const allocation = await wrapper.allocate({
    operationId: operation.id,
    query,
    startedUtc: `${DATE}T09:00:00.000Z`,
    signal: operation.signal,
  });
  return { operation, wrapper, reservation: allocation.status === "allocated" ? allocation.reservation : undefined };
}

/** Allocates, commits, indexes and reads one operation through the wrapper. */
async function driveOperation(block: BlockHarness, query: string): Promise<DrivenOperation> {
  const started = await allocateOn(block, query);
  const { operation, wrapper, reservation } = started;
  if (reservation) {
    const committed = await wrapper.commit(reservation, [], operation.signal);
    if (committed.status === "committed") {
      await wrapper.updateIndex(committed.run, query, operation.signal);
    }
  }
  const view = await wrapper.candidates(reservation, query, operation.signal);
  return { operation, wrapper, reservation, view };
}

function recorderSession(onInvalid: (error: SuggestionViewError) => void = () => {}): SuggestionViewRecorder {
  return createSuggestionViewRecorder({
    scenario: SCENARIO,
    block: "block-1",
    scheduleManifestSha256: SCHEDULE_MANIFEST_SHA256,
    workflow: WORKFLOW,
    baseline: BASELINE,
    displayRoot: DISPLAY_ROOT,
    initialTreeDigest: "1".repeat(64),
    onInvalid,
  });
}

/**
 * Records the canonical three-operation block through the real wrapper:
 * alpha (baseline-only view), beta (sees alpha's fresh block-local entry),
 * then the serial repeat of alpha's query (sees beta's entry; alpha's
 * same-day compatibility key is excluded by the real current-query rule).
 */
async function recordCanonicalBlock(): Promise<SuggestionViewArtefact> {
  const session = recorderSession();
  let rows: readonly IndexCandidate[] = [...BASELINE];
  const block = harness(session.controller, {
    reservations: { "alpha query": [RES_ALPHA, RES_REPEAT], "beta query": [RES_BETA] },
    rows: () => rows,
  });
  const alpha = await driveOperation(block, "alpha query");
  session.prepare(suggestRequest("alpha query", alpha.view));
  // The real host settled event for occurrence 1, required before the serial
  // repeat may start: settlement is never inferred from a read or publication.
  session.reportHostWitness({ query: "alpha query", outcome: "settled" });
  rows = [ROW_ALPHA, ...BASELINE];
  const beta = await driveOperation(block, "beta query");
  session.prepare(suggestRequest("beta query", beta.view));
  rows = [ROW_BETA, ...BASELINE];
  const repeat = await driveOperation(block, "alpha query");
  session.prepare(suggestRequest("alpha query", repeat.view));
  await block.finish();
  session.assertValid();
  return session.exportArtefact({ fixtureFiles: FIXTURE_FILES });
}

describe("segment builder fidelity (production formatter mirror)", () => {
  it("renders byte-for-byte what formatIndexForJudge plus the call site produce", () => {
    for (const rows of [
      [],
      [ROW_ALPHA],
      [ROW_ALPHA, ...BASELINE],
      [ROW_BETA, ROW_ALPHA, ...BASELINE],
    ] as const) {
      const message = judgeMessage("alpha query", rows);
      const segments = buildSuggestionSegments("alpha query", rows.map((row) => ({
        query: row.query,
        slug: relative(DISPLAY_ROOT, dirname(row.reportPath)),
        startedUtc: row.startedUtc,
        bindingProducer: null,
      })));
      assert.equal(renderSuggestionSegments(segments, new Map()), message);
    }
  });

  it("renders the empty view exactly and mirrors the window and slugless filters", () => {
    assert.equal(
      renderSuggestionSegments(buildSuggestionSegments("q", []), new Map()),
      `Current query: "q"\n\nPrevious searches:\nNo previous searches.`,
    );
    const many = Array.from({ length: 25 }, (_, i) => v1Row(`query ${i}`, DATE, `run-${i}`, i + 1));
    const index = {
      searches: many
        .slice(0, 20)
        .map((row) => ({ query: row.query, timestamp: row.startedUtc, slug: relative(DISPLAY_ROOT, dirname(row.reportPath)) })),
    };
    const expected = `Current query: "q"\n\nPrevious searches:\n${formatIndexForJudge(index, "")}`;
    const slugless = [...many, { ...many[0]!, reportPath: `${DISPLAY_ROOT}/report.md` }];
    const segments = buildSuggestionSegments("q", slugless.map((row) => ({
      query: row.query,
      slug: relative(DISPLAY_ROOT, dirname(row.reportPath)),
      startedUtc: row.startedUtc,
      bindingProducer: null,
    })));
    assert.equal(renderSuggestionSegments(segments, new Map()), expected);
  });

  it("keeps authored token-looking text literal while bindings stay structured", () => {
    const tricky = legacyRow(`why does "2026-10-23-alpha-query-a1b2c3" appear`, DATE, "slug-with-nonce-x9y8z7");
    const message = judgeMessage(tricky.query, [tricky, ROW_ALPHA]);
    const segments = buildSuggestionSegments(tricky.query, [
      { query: tricky.query, slug: relative(DISPLAY_ROOT, dirname(tricky.reportPath)), startedUtc: tricky.startedUtc, bindingProducer: null },
      { query: ROW_ALPHA.query, slug: relative(DISPLAY_ROOT, dirname(ROW_ALPHA.reportPath)), startedUtc: ROW_ALPHA.startedUtc, bindingProducer: "research-alpha" },
    ]);
    const values = new Map([
      ["research-alpha", { slug: relative(DISPLAY_ROOT, dirname(ROW_ALPHA.reportPath)), startedUtc: ROW_ALPHA.startedUtc }],
    ]);
    assert.equal(renderSuggestionSegments(segments, values), message);
    const bindings = segments.filter((segment): segment is { kind: "binding"; producer: string; leaf: "slug" | "startedUtc" } => segment.kind === "binding");
    assert.deepEqual(bindings.map((segment) => ({ producer: segment.producer, leaf: segment.leaf })), [
      { producer: "research-alpha", leaf: "slug" },
      { producer: "research-alpha", leaf: "startedUtc" },
    ]);
  });
});

describe("recorder", () => {
  it("records views exactly and exports a verifying artefact with exact relationships", async () => {
    const session = recorderSession();
    let rows: readonly IndexCandidate[] = [...BASELINE];
    const block = harness(session.controller, {
      reservations: { "alpha query": [RES_ALPHA, RES_REPEAT], "beta query": [RES_BETA] },
      rows: () => rows,
    });
    const alpha = await driveOperation(block, "alpha query");
    session.prepare(suggestRequest("alpha query", alpha.view));
    session.reportHostWitness({ query: "alpha query", outcome: "settled" });
    rows = [ROW_ALPHA, ...BASELINE];
    const beta = await driveOperation(block, "beta query");
    session.prepare(suggestRequest("beta query", beta.view));
    rows = [ROW_BETA, ...BASELINE];
    const repeat = await driveOperation(block, "alpha query");
    session.prepare(suggestRequest("alpha query", repeat.view));
    await block.finish();
    session.assertValid();
    const artefact = session.exportArtefact({ fixtureFiles: FIXTURE_FILES });
    verifySuggestionArtefact(artefact);
    const reads = new Map(artefact.reads.map((read) => [read.readerNode, read]));
    assert.deepEqual(reads.get("research-alpha")!.view.map((entry) => entry.origin.kind), ["baseline", "baseline"]);
    const betaView = reads.get("research-beta")!.view;
    assert.deepEqual(betaView.map((entry) => entry.origin.kind), ["block-local", "baseline", "baseline"]);
    const firstOrigin = betaView[0]!.origin;
    assert.ok(firstOrigin.kind === "block-local" && firstOrigin.producer === "research-alpha");
    assert.deepEqual(reads.get("research-beta")!.dependencies, ["research-alpha"]);
    assert.deepEqual(reads.get("alpha-repeat")!.dependencies, ["research-beta"]);
    assert.equal(reads.get("research-alpha")!.matchedSuggestRequest, 0);
    assert.equal(reads.get("research-beta")!.matchedSuggestRequest, 1);
    assert.equal(reads.get("alpha-repeat")!.matchedSuggestRequest, 2);
    const producers = new Map(artefact.producers.map((producer) => [producer.node, producer]));
    assert.equal(producers.get("research-alpha")!.outcome, "indexed");
    assert.equal(producers.get("research-alpha")!.committed, true);
    assert.equal(producers.get("research-alpha")!.reservation!.runId, RES_ALPHA.runId);
    assert.ok(producers.get("research-alpha")!.indexedManifestSha256 !== null);
    // The recorded view entries carry the exact reader fields.
    assert.deepEqual(betaView[0]!, { origin: { kind: "block-local", producer: "research-alpha" }, ...ROW_ALPHA });
    // Observations carry structured facts only, with no timing fields.
    const kinds = session.observations().map((observation) => observation.kind);
    assert.equal(kinds.filter((kind) => kind === "read").length, 3);
    assert.equal(kinds.filter((kind) => kind === "suggest-prepared").length, 3);
    assert.ok(!session.observations().some((observation) => "durationMs" in observation || "elapsedMs" in observation));
  });

  it("returns the actual unmodified reader array from the controller", async () => {
    const session = recorderSession();
    const rows: readonly IndexCandidate[] = [...BASELINE];
    const returned = await session.controller.candidates({
      operationId: "direct-op",
      current: undefined,
      query: "beta query",
      signal: new AbortController().signal,
      readVerified: async () => rows,
    });
    assert.equal(returned, rows);
  });

  it("rejects an allocation whose reservation does not cross-check its query, without changing the write", async () => {
    const invalid: RunReservation = { ...RES_ALPHA, compatibilityKey: compatibilityKeyFor("other query", DATE) };
    const faults: SuggestionViewError[] = [];
    const session = recorderSession((error) => faults.push(error));
    const block = harness(session.controller, { reservations: { "alpha query": [invalid] }, rows: [...BASELINE] });
    const operation = block.begin("op");
    const wrapper = block.wrap(operation);
    // The native wrapper contains the notification exception; the store write result is unchanged.
    const allocation = await wrapper.allocate({ operationId: operation.id, query: "alpha query", startedUtc: `${DATE}T09:00:00.000Z`, signal: operation.signal });
    assert.equal(allocation.status, "allocated");
    assert.equal(faults.length, 1);
    assert.equal(faults[0]!.reason, "allocation-cross-check");
    assert.throws(() => session.assertValid(), /cross-check/);
    await assert.rejects(wrapper.candidates(undefined, "alpha query", operation.signal), /notification failed|Suggestion read/);
    await block.finish();
  });

  it("fails closed on unexpected, ambiguous, duplicate and self candidates", async () => {
    // Unexpected: a row that is neither baseline nor declared producer.
    {
      const ghost = v1Row("ghost query", DATE, "2026-10-23-ghost-run-zzz", 99);
      const session = recorderSession();
      await assert.rejects(
        driveOperation(harness(session.controller, { reservations: { "alpha query": [RES_ALPHA] }, rows: [ghost, ...BASELINE] }), "alpha query"),
        /neither an exact frozen-baseline member nor a declared block producer/,
      );
      assert.throws(() => session.assertValid(), /unexpected-candidate|neither/);
    }
    // Ambiguous: a serial repeat whose allocation carries occurrence 1's
    // exact reservation identity, so one current row matches two producers.
    {
      const session = recorderSession();
      let rows: readonly IndexCandidate[] = [...BASELINE];
      const block = harness(session.controller, {
        reservations: { "alpha query": [RES_ALPHA, { ...RES_ALPHA }] },
        rows: () => rows,
      });
      const first = await driveOperation(block, "alpha query");
      session.prepare(suggestRequest("alpha query", first.view));
      session.reportHostWitness({ query: "alpha query", outcome: "settled" });
      rows = [ROW_ALPHA, ...BASELINE];
      await assert.rejects(driveOperation(block, "alpha query"), /matches the reservations of/);
      await block.finish();
    }
    // Duplicate: the same row twice in one read.
    {
      const session = recorderSession();
      await assert.rejects(
        driveOperation(harness(session.controller, { reservations: { "alpha query": [RES_ALPHA] }, rows: [BASELINE[0]!, BASELINE[0]!] }), "alpha query"),
        /twice/,
      );
    }
    // Self: the reader's own publication inside its own view.
    {
      const session = recorderSession();
      await assert.rejects(
        driveOperation(harness(session.controller, { reservations: { "alpha query": [RES_ALPHA] }, rows: [ROW_ALPHA, ...BASELINE] }), "alpha query"),
        /its own publication/,
      );
    }
  });

  it("enforces one read per operation, declared queries and the serial occurrence order", async () => {
    // Duplicate read for one operation.
    {
      const session = recorderSession();
      const block = harness(session.controller, { reservations: { "alpha query": [RES_ALPHA] }, rows: [...BASELINE] });
      const started = await allocateOn(block, "alpha query");
      await started.wrapper.candidates(started.reservation, "alpha query", started.operation.signal);
      await assert.rejects(started.wrapper.candidates(started.reservation, "alpha query", started.operation.signal), /more than one candidate read/);
      await block.finish();
    }
    // Undeclared query: the notification fault is contained by the native
    // wrapper (poisoning it), and the session records the true reason.
    {
      const session = recorderSession();
      await assert.rejects(
        driveOperation(harness(session.controller, { reservations: { "alpha query": [RES_ALPHA] }, rows: [] }), "undeclared query"),
        /notification failed|not declared in the frozen workflow/,
      );
      assert.throws(() => session.assertValid(), /not declared in the frozen workflow/);
    }
    // The serial repeat may not start before occurrence 1 completed its read
    // cycle. The fault fires inside a notification, so the native wrapper
    // contains it (poisoning itself) and the session records the true reason.
    {
      const session = recorderSession();
      const block = harness(session.controller, { reservations: { "alpha query": [RES_ALPHA, RES_REPEAT] }, rows: [...BASELINE] });
      const first = await driveOperation(block, "alpha query");
      // Nonempty view recorded and even prepared, but occurrence 1 has not
      // settled: no witness exists, so the repeat must not start.
      session.prepare(suggestRequest("alpha query", first.view));
      await assert.rejects(driveOperation(block, "alpha query"), /notification failed|settled/);
      assert.throws(() => session.assertValid(), /requires the real host settlement witness/);
      await block.finish();
    }
    // After the real host settlement witness, the serial repeat binds and reads normally.
    {
      const session = recorderSession();
      const block = harness(session.controller, { reservations: { "alpha query": [RES_ALPHA, RES_REPEAT] }, rows: [...BASELINE] });
      const first = await driveOperation(block, "alpha query");
      session.prepare(suggestRequest("alpha query", first.view));
      session.reportHostWitness({ query: "alpha query", outcome: "settled" });
      await driveOperation(block, "alpha query");
      session.assertValid();
      await block.finish();
    }
  });

  it("records failed producers, unavailable phases and the settle-time operation phase", async () => {
    const session = recorderSession();
    let rows: readonly IndexCandidate[] = [...BASELINE];
    const block = harness(session.controller, {
      reservations: { "alpha query": [RES_ALPHA, RES_REPEAT], "beta query": [RES_BETA] },
      rows: () => rows,
      indexResults: ["updated", "unavailable"],
    });
    const alpha = await driveOperation(block, "alpha query");
    session.prepare(suggestRequest("alpha query", alpha.view));
    session.reportHostWitness({ query: "alpha query", outcome: "settled" });
    // Beta allocates and commits, but the index write fails.
    const betaStarted = await allocateOn(block, "beta query");
    await betaStarted.wrapper.commit(betaStarted.reservation!, [], betaStarted.operation.signal);
    await betaStarted.wrapper.updateIndex(runOf(betaStarted.reservation!), "beta query", betaStarted.operation.signal);
    rows = [...BASELINE];
    const betaView = await betaStarted.wrapper.candidates(betaStarted.reservation, "beta query", betaStarted.operation.signal);
    session.prepare(suggestRequest("beta query", betaView));
    await betaStarted.wrapper.settle(); // fires the settle-time operation phase once
    // The repeat of alpha query still runs: beta holds a different query.
    const repeat = await driveOperation(block, "alpha query");
    session.prepare(suggestRequest("alpha query", repeat.view));
    await block.finish();
    const artefact = session.exportArtefact({ fixtureFiles: FIXTURE_FILES });
    const beta = artefact.producers.find((producer) => producer.node === "research-beta")!;
    assert.equal(beta.outcome, "failed");
    assert.deepEqual(beta.failurePhases, ["index", "operation"]);
    assert.equal(beta.committed, false);
    // The settle-time operation phase is audit data (failurePhases), not
    // settlement evidence: beta carries no settle witness; alpha's serial
    // settlement came from the host settled witness.
    assert.equal(beta.settleWitness, null);
    assert.equal(artefact.producers.find((producer) => producer.node === "research-alpha")!.settleWitness, "host-settled");
  });

  it("records a collate producer that publishes without reading and feeds a later research suggestion", async () => {
    const session = createSuggestionViewRecorder({
      scenario: SCENARIO,
      block: "block-collate",
      scheduleManifestSha256: SCHEDULE_MANIFEST_SHA256,
      workflow: [
        { node: "collate-extra", query: "collated summary query", occurrence: 1, kind: "collate" },
        { node: "research-alpha", query: "alpha query", occurrence: 1 },
      ],
      baseline: BASELINE,
      displayRoot: DISPLAY_ROOT,
      initialTreeDigest: "1".repeat(64),
      onInvalid: () => {},
    });
    const resCollate = reservationFor("collated summary query", DATE, "2026-10-23-collated-summary-x1y2z3", 45);
    const rowCollate = v1Row("collated summary query", DATE, resCollate.runId, 45);
    let rows: readonly IndexCandidate[] = [rowCollate, ...BASELINE];
    const block = harness(session.controller, {
      reservations: { "collated summary query": [resCollate], "alpha query": [RES_ALPHA] },
      rows: () => rows,
    });
    // Real wrapper sequence: the collate operation allocates, commits and
    // becomes index-visible, and NEVER calls candidates.
    const collateStarted = await allocateOn(block, "collated summary query");
    await collateStarted.wrapper.commit(collateStarted.reservation!, [], collateStarted.operation.signal);
    await collateStarted.wrapper.updateIndex(runOf(collateStarted.reservation!), "collated summary query", collateStarted.operation.signal);
    // The research reads: the collate publication is a block-local entry in its view.
    const alpha = await driveOperation(block, "alpha query");
    session.prepare(suggestRequest("alpha query", alpha.view));
    await block.finish();
    const artefact = session.exportArtefact({ fixtureFiles: FIXTURE_FILES });
    verifySuggestionArtefact(artefact);
    assert.equal(artefact.reads.length, 1);
    assert.equal(artefact.reads[0]!.readerNode, "research-alpha");
    const collate = artefact.producers.find((producer) => producer.node === "collate-extra")!;
    assert.equal(collate.outcome, "indexed");
    assert.deepEqual(artefact.reads[0]!.view[0]!.origin, { kind: "block-local", producer: "collate-extra" });
    assert.deepEqual(artefact.reads[0]!.dependencies, ["collate-extra"]);
    assert.equal(artefact.workflow[0]!.kind, "collate");
    assert.equal(artefact.workflow[1]!.kind, "research");
    // Replay the same shape end to end, including the completeness finalisation.
    const replay = createSuggestionViewReplay({
      artefact,
      displayRoot: DISPLAY_ROOT,
      budgetMs: 5000,
      expectedFixtureFiles: FIXTURE_FILES,
      onInvalid: () => {},
    });
    const freshCollate = freshReservation(resCollate, "fresh-collate-run-201");
    const freshAlpha = freshReservation(RES_ALPHA, "fresh-alpha-run-202");
    rows = [freshRow(rowCollate, freshCollate.runId), ...BASELINE];
    const replayBlock = harness(replay.controller, {
      reservations: { "collated summary query": [freshCollate], "alpha query": [freshAlpha] },
      rows: () => rows,
    });
    const replayCollate = await allocateOn(replayBlock, "collated summary query");
    await replayCollate.wrapper.commit(replayCollate.reservation!, [], replayCollate.operation.signal);
    await replayCollate.wrapper.updateIndex(runOf(replayCollate.reservation!), "collated summary query", replayCollate.operation.signal);
    const replayAlpha = await driveOperation(replayBlock, "alpha query");
    const canonical = replay.prepare(suggestRequest("alpha query", replayAlpha.view));
    assert.equal(sha256Canonical(canonical), artefact.suggestRequests[0]!.canonicalSha256);
    await replayBlock.finish();
    replay.assertValid();
    replay.assertReplayComplete();
    // Negative, in its own session (the fault is sticky-invalidating): a
    // candidate read for the declared collate operation fails closed.
    {
      const negative = createSuggestionViewRecorder({
        scenario: SCENARIO,
        block: "block-collate-negative",
        scheduleManifestSha256: SCHEDULE_MANIFEST_SHA256,
        workflow: [{ node: "collate-extra", query: "collated summary query", occurrence: 1, kind: "collate" }],
        baseline: BASELINE,
        displayRoot: DISPLAY_ROOT,
        initialTreeDigest: "1".repeat(64),
        onInvalid: () => {},
      });
      const negativeBlock = harness(negative.controller, {
        reservations: { "collated summary query": [resCollate] },
        rows: [],
      });
      const started = await allocateOn(negativeBlock, "collated summary query");
      await assert.rejects(
        started.wrapper.candidates(started.reservation, "collated summary query", started.operation.signal),
        /never reads/,
      );
      assert.throws(() => negative.assertValid(), /never reads/);
      await negativeBlock.finish();
    }
  });

  it("accepts only the host settled witness for serial query reuse, not the settle-time operation phase", async () => {
    const buildSession = (): SuggestionViewRecorder =>
      createSuggestionViewRecorder({
        scenario: SCENARIO,
        block: "block-serial-settle",
        scheduleManifestSha256: SCHEDULE_MANIFEST_SHA256,
        workflow: [
          { node: "research-alpha", query: "alpha query", occurrence: 1 },
          { node: "alpha-repeat", query: "alpha query", occurrence: 2 },
        ],
        baseline: BASELINE,
        displayRoot: DISPLAY_ROOT,
        initialTreeDigest: "1".repeat(64),
        onInvalid: () => {},
      });
    // Occurrence 1 fails at the index phase; its settle-time operation phase
    // fires at wrapper settlement. That notification is NOT settlement
    // evidence: the serial repeat must still fail closed.
    {
      const session = buildSession();
      const block = harness(session.controller, {
        reservations: { "alpha query": [RES_ALPHA, RES_REPEAT] },
        rows: [...BASELINE],
        indexResults: ["unavailable"],
      });
      const first = await driveOperation(block, "alpha query");
      session.prepare(suggestRequest("alpha query", first.view));
      await first.wrapper.settle();
      await assert.rejects(driveOperation(block, "alpha query"), /notification failed|requires the real host settlement witness/);
      assert.throws(() => session.assertValid(), /requires the real host settlement witness/);
      await block.finish();
    }
    // With the real host settled witness, the repeat runs and the artefact
    // records the settlement evidence.
    {
      const session = buildSession();
      const block = harness(session.controller, {
        reservations: { "alpha query": [RES_ALPHA, RES_REPEAT] },
        rows: [...BASELINE],
        indexResults: ["unavailable"],
      });
      const first = await driveOperation(block, "alpha query");
      session.prepare(suggestRequest("alpha query", first.view));
      await first.wrapper.settle();
      session.reportHostWitness({ query: "alpha query", outcome: "settled" });
      const repeat = await driveOperation(block, "alpha query");
      session.prepare(suggestRequest("alpha query", repeat.view));
      await block.finish();
      const artefact = session.exportArtefact({ fixtureFiles: FIXTURE_FILES });
      const alpha = artefact.producers.find((producer) => producer.node === "research-alpha")!;
      assert.equal(alpha.outcome, "failed");
      assert.deepEqual(alpha.failurePhases, ["index", "operation"]);
      assert.equal(alpha.settleWitness, "host-settled");
      assert.equal(artefact.producers.find((producer) => producer.node === "alpha-repeat")!.settleWitness, null);
    }
  });

  it("resolves a pre-allocation abort only through the coordinator's host witness", async () => {
    const session = recorderSession();
    const block = harness(session.controller, {
      reservations: { "alpha query": [RES_REPEAT], "beta query": [RES_BETA] },
      rows: [...BASELINE],
    });
    // Occurrence 1 of "alpha query" aborted before any store call: the
    // library observes no event at all. Only the coordinator's real host
    // settled-event witness can terminalise that occurrence; without it the
    // serial repeat's first event would silently bind to occurrence 1.
    session.reportHostWitness({ query: "alpha query", outcome: "failed-before-allocation" });
    // With the witness, occurrence 2 binds and runs normally.
    const repeat = await driveOperation(block, "alpha query");
    session.prepare(suggestRequest("alpha query", repeat.view));
    const beta = await driveOperation(block, "beta query");
    session.prepare(suggestRequest("beta query", beta.view));
    await block.finish();
    const witnessed = session.observations().find((observation) => observation.kind === "host-witness")!;
    assert.ok(
      witnessed.kind === "host-witness" &&
        witnessed.node === "research-alpha" &&
        witnessed.reportedBy === "coordinator" &&
        witnessed.outcome === "failed-before-allocation",
    );
    // The witnessed operation never read, so the block cannot export: a
    // pre-allocation abort remains an explicit invalidation, never repaired.
    assert.throws(() => session.exportArtefact(), /settled without its frozen candidate read/);
  });

  it("records commit success for an index-failed producer through the commit-succeeded witness", async () => {
    const session = recorderSession();
    const block = harness(session.controller, {
      reservations: { "beta query": [RES_BETA] },
      rows: [...BASELINE],
      indexResults: ["unavailable"],
    });
    const started = await allocateOn(block, "beta query");
    await started.wrapper.commit(started.reservation!, [], started.operation.signal);
    await started.wrapper.updateIndex(runOf(started.reservation!), "beta query", started.operation.signal);
    const view = await started.wrapper.candidates(started.reservation, "beta query", started.operation.signal);
    session.prepare(suggestRequest("beta query", view));
    await started.wrapper.settle();
    await block.finish();
    session.reportHostWitness({ query: "beta query", outcome: "commit-succeeded" });
    // The workflow is incomplete (alpha and the repeat never ran), so assert on the producer record.
    assert.throws(() => session.exportArtefact(), /never started/);
    const observations = session.observations().filter((observation) => observation.kind === "host-witness");
    assert.equal(observations.length, 1);
  });

  it("rejects an unmatched nonempty view and an incomplete workflow at export", async () => {
    // Nonempty view whose judge request never arrived.
    {
      const session = recorderSession();
      const block = harness(session.controller, { reservations: { "alpha query": [RES_ALPHA] }, rows: [...BASELINE] });
      await driveOperation(block, "alpha query");
      await block.finish();
      assert.throws(() => session.exportArtefact(), /never received its judge request/);
    }
    // A declared operation that never started.
    {
      const session = recorderSession();
      let rows: readonly IndexCandidate[] = [...BASELINE];
      const block = harness(session.controller, {
        reservations: { "alpha query": [RES_ALPHA], "beta query": [RES_BETA] },
        rows: () => rows,
      });
      const alpha = await driveOperation(block, "alpha query");
      session.prepare(suggestRequest("alpha query", alpha.view));
      rows = [ROW_ALPHA, ...BASELINE];
      const beta = await driveOperation(block, "beta query");
      session.prepare(suggestRequest("beta query", beta.view));
      await block.finish();
      assert.throws(() => session.exportArtefact(), /never started/);
    }
  });

  it("keeps nonsuggestion requests byte-exact and re-prepares retries identically", async () => {
    const session = recorderSession();
    const search = nonSuggestRequest();
    assert.equal(canonicalJson(session.prepare(search)), canonicalJson(asJson(search)));
    const block = harness(session.controller, { reservations: { "alpha query": [RES_ALPHA] }, rows: [...BASELINE] });
    const alpha = await driveOperation(block, "alpha query");
    await block.finish();
    const request = suggestRequest("alpha query", alpha.view);
    const first = session.prepare(request);
    const second = session.prepare(request);
    assert.equal(canonicalJson(first), canonicalJson(second));
    const attempts = session.observations().filter((observation) => observation.kind === "suggest-prepared");
    assert.equal(attempts.length, 2);
    assert.ok(attempts.every((attempt) => attempt.kind === "suggest-prepared" && attempt.attempt <= 2));
    assert.throws(() => session.exportArtefact(), /never started/); // beta and the repeat never ran
  });

  it("fails closed when the suggestion judge message does not match the recorded view", async () => {
    const session = recorderSession();
    const block = harness(session.controller, { reservations: { "alpha query": [RES_ALPHA] }, rows: [...BASELINE] });
    const alpha = await driveOperation(block, "alpha query");
    await block.finish();
    const request = suggestRequest("alpha query", alpha.view);
    const tampered: ModelFixtureRequest = { ...request, userMessage: request.userMessage.replace("legacy topic research", "edited query text") };
    assert.throws(() => session.prepare(tampered), /does not match the latest recorded read view/);
    assert.throws(() => session.assertValid(), /does not match/);
  });

  it("never prepares a judge request for an empty recorded view", async () => {
    const session = recorderSession();
    const block = harness(session.controller, { reservations: { "alpha query": [RES_ALPHA] }, rows: [] });
    const alpha = await driveOperation(block, "alpha query");
    await block.finish();
    assert.deepEqual(alpha.view, []);
    assert.throws(() => session.prepare(suggestRequest("alpha query", alpha.view)), /empty read view/);
    // The fault is sticky: export rethrows the recorded invalidation rather
    // than reporting the (also incomplete) workflow separately.
    assert.throws(() => session.exportArtefact(), /empty read view/);
  });
});

describe("artefact integrity", () => {
  type ArtefactDraft = {
    schemaVersion: number;
    kind: string;
    amendmentVersion: string;
    scenario: string;
    block: string;
    workflow: Array<{ node: string; query: string; occurrence: number }>;
    baseline: SuggestionBaselineEntry[];
    displayRoot: string;
    initialTreeDigest: string;
    fixtureFiles: Array<{ name: string; sha256: string }>;
    producers: Array<{
      node: string;
      query: string;
      occurrence: number;
      allocated: boolean;
      outcome: "indexed" | "failed" | "witnessed";
      failurePhases: Array<"allocation" | "commit" | "index" | "operation">;
      committed: boolean;
      hostWitness: "failed-before-allocation" | "commit-succeeded" | null;
      reservation: { runId: string; sequence: number; startedUtc: string; compatibilityKey: string; displayPath: string } | null;
      indexedManifestSha256: string | null;
    }>;
    reads: Array<{
      readerNode: string;
      occurrence: number;
      query: string;
      view: Array<{
        origin: { kind: "baseline" } | { kind: "block-local"; producer: string };
        query: string;
        reportPath: string;
        namespace: "v1" | "legacy";
        startedUtc: string;
        compatibilityKey: string;
        admissionSequence?: number;
      }>;
      dependencies: string[];
      matchedSuggestRequest: number | null;
    }>;
    suggestRequests: Array<{
      readerNode: string;
      occurrence: number;
      raw: Json;
      canonical: Json;
      bindings: Array<{ producer: string; leaf: "slug" | "startedUtc"; capturedValue: string }>;
      rawSha256: string;
      canonicalSha256: string;
      viewSha256: string;
    }>;
    integrity: {
      workflowSha256: string;
      baselineSha256: string;
      producersSha256: string;
      readsSha256: string;
      suggestRequestsSha256: string;
    };
  };

  it("saves, loads and digests the recorded artefact through a real file roundtrip", async () => {
    const scratch = await scratchDir("suggestion");
    try {
      const artefact = await recordCanonicalBlock();
      const path = `${scratch}/suggestion-view.json`;
      await saveSuggestionViewArtefact(path, artefact);
      const loaded = await loadSuggestionViewArtefact(path);
      assert.equal(suggestionArtefactSha256(loaded), suggestionArtefactSha256(artefact));
      verifySuggestionArtefact(loaded);
    } finally {
      await removeDir(scratch);
    }
  });

  it("rejects tampered sections through the integrity digests", async () => {
    const artefact = await recordCanonicalBlock();
    const digestTampered = structuredClone(artefact) as unknown as ArtefactDraft;
    digestTampered.integrity.readsSha256 = "0".repeat(64);
    assert.throws(() => verifySuggestionArtefact(digestTampered as unknown as SuggestionViewArtefact), /does not match the reads section/);
  });

  it("rejects semantic tampering even with recomputed section digests", async () => {
    const artefact = await recordCanonicalBlock();
    const tamper = (mutate: (draft: ArtefactDraft) => void): SuggestionViewArtefact => {
      const draft = structuredClone(artefact) as unknown as ArtefactDraft;
      mutate(draft);
      draft.integrity = {
        workflowSha256: sha256Canonical(draft.workflow),
        baselineSha256: sha256Canonical(draft.baseline),
        producersSha256: sha256Canonical(draft.producers),
        readsSha256: sha256Canonical(draft.reads),
        suggestRequestsSha256: sha256Canonical(draft.suggestRequests),
      };
      return draft as unknown as SuggestionViewArtefact;
    };
    // Altered baseline: the recorded view's baseline-origin entry no longer matches.
    assert.throws(
      () => verifySuggestionArtefact(tamper((draft) => {
        draft.baseline[1] = { ...draft.baseline[1]!, startedUtc: "2026-10-19T09:00:00.000Z" };
      })),
      /does not exactly match a frozen baseline entry/,
    );
    // Reordered frozen view: the projection's pinned view digest no longer
    // matches the reordered view (the segment rebuild is the second layer,
    // exercised by the canonical edit below).
    assert.throws(
      () => verifySuggestionArtefact(tamper((draft) => {
        const view = draft.reads[1]!.view;
        const first = view[0]!;
        view[0] = view[1]!;
        view[1] = first;
      })),
      /view digest does not match the frozen view/,
    );
    // Raw message edited.
    assert.throws(
      () => verifySuggestionArtefact(tamper((draft) => {
        const raw = draft.suggestRequests[0]!.raw as { userMessage: string };
        raw.userMessage = raw.userMessage.replace("legacy topic research", "edited");
      })),
      /do not reproduce the raw userMessage/,
    );
    // Canonical representation edited with a recomputed record digest.
    assert.throws(
      () => verifySuggestionArtefact(tamper((draft) => {
        const record = draft.suggestRequests[0]!;
        const canonical = record.canonical as unknown as {
          f7Suggestion: { segments: Array<{ kind: string; text?: string }> };
        };
        const literal = canonical.f7Suggestion.segments.find((segment) => segment.kind === "literal" && segment.text === `Current query: "`)!;
        literal.text = `Current query:  `;
        draft.suggestRequests[0] = {
          ...record,
          canonical: canonical as unknown as Json,
          canonicalSha256: sha256Canonical(canonical),
        };
      })),
      /canonical segments do not match/,
    );
    // Binding captured value edited.
    assert.throws(
      () => verifySuggestionArtefact(tamper((draft) => {
        const record = draft.suggestRequests[1]!;
        const binding = record.bindings.find((candidate) => candidate.leaf === "slug")!;
        binding.capturedValue = `${binding.capturedValue}-x`;
      })),
      /captured slug does not match the view entry/,
    );
    // Producer flipped to failed while its entry stays in a view.
    assert.throws(
      () => verifySuggestionArtefact(tamper((draft) => {
        const producer = draft.producers.find((candidate) => candidate.node === "research-alpha")!;
        producer.outcome = "failed";
        producer.failurePhases = ["index"];
        producer.committed = false;
        producer.indexedManifestSha256 = null;
      })),
      /is not index-visible/,
    );
    // Dependencies list edited away from the view's producers.
    assert.throws(
      () => verifySuggestionArtefact(tamper((draft) => {
        draft.reads[1]!.dependencies = [];
      })),
      /dependencies must list exactly/,
    );
    // A view that depends on its own reader's publication.
    assert.throws(
      () => verifySuggestionArtefact(tamper((draft) => {
        const read = draft.reads[1]!;
        const readerProducer = draft.producers.find((producer) => producer.node === "research-beta")!;
        const entry = read.view[0]!;
        read.view[0] = {
          ...entry,
          origin: { kind: "block-local", producer: "research-beta" },
          query: readerProducer.query,
          startedUtc: readerProducer.reservation!.startedUtc,
          compatibilityKey: readerProducer.reservation!.compatibilityKey,
        };
      })),
      /own reader's publication/,
    );
    // A nonempty view whose suggest-request linkage was removed.
    assert.throws(
      () => verifySuggestionArtefact(tamper((draft) => {
        draft.reads[1]!.matchedSuggestRequest = null;
      })),
      /does not reference this request|has no matching suggest request/,
    );
  });
});

describe("replay", () => {
  function replaySession(artefact: SuggestionViewArtefact, budgetMs = 5000): SuggestionViewReplay {
    return createSuggestionViewReplay({
      artefact,
      displayRoot: DISPLAY_ROOT,
      budgetMs,
      expectedFixtureFiles: FIXTURE_FILES,
      onInvalid: () => {},
    });
  }

  it("projects the frozen view from reordered current rows, excluding later siblings", async () => {
    const artefact = await recordCanonicalBlock();
    const session = replaySession(artefact);
    // Replay interleaving: alpha completes; beta publishes but defers its
    // read; the serial repeat completes; beta reads last and sees the
    // repeat's row, which was not visible at the recorded instant.
    const FRESH_ALPHA = freshReservation(RES_ALPHA, "fresh-alpha-run-001");
    const FRESH_BETA = freshReservation(RES_BETA, "fresh-beta-run-003");
    const FRESH_REPEAT = freshReservation(RES_REPEAT, "fresh-alpha-run-002");
    let rows: readonly IndexCandidate[] = [...BASELINE];
    const block = harness(session.controller, {
      reservations: { "alpha query": [FRESH_ALPHA, FRESH_REPEAT], "beta query": [FRESH_BETA] },
      rows: () => rows,
    });
    const alpha = await driveOperation(block, "alpha query");
    session.prepare(suggestRequest("alpha query", alpha.view));
    session.reportHostWitness({ query: "alpha query", outcome: "settled" });
    // Beta publishes now but reads later.
    const betaStarted = await allocateOn(block, "beta query");
    await betaStarted.wrapper.commit(betaStarted.reservation!, [], betaStarted.operation.signal);
    await betaStarted.wrapper.updateIndex(runOf(betaStarted.reservation!), "beta query", betaStarted.operation.signal);
    // The repeat reads: beta's fresh row is visible, alpha's same-day row is excluded by the current key.
    rows = [freshRow(ROW_BETA, FRESH_BETA.runId), ...BASELINE];
    const repeat = await driveOperation(block, "alpha query");
    session.prepare(suggestRequest("alpha query", repeat.view));
    // Beta reads late, in a scrambled arrival order that also contains the repeat's row.
    rows = [BASELINE[0]!, freshRow(ROW_REPEAT, FRESH_REPEAT.runId), BASELINE[1]!, freshRow(ROW_ALPHA, FRESH_ALPHA.runId)];
    const betaView = await betaStarted.wrapper.candidates(betaStarted.reservation, "beta query", betaStarted.operation.signal);
    assert.deepEqual(
      betaView.map((row) => row.reportPath),
      [FRESH_ALPHA.displayPath + "/report.md", ...BASELINE.map((entry) => entry.reportPath)],
    );
    const projection = session.observations().find(
      (observation) => observation.kind === "projection" && observation.node === "research-beta",
    )!;
    assert.ok(projection.kind === "projection" && projection.excludedProducers.includes("alpha-repeat"));
    // The canonical representation matches the frozen one byte-for-byte.
    const canonical = session.prepare(suggestRequest("beta query", betaView));
    const frozen = artefact.suggestRequests.find((record) => record.readerNode === "research-beta")!;
    assert.equal(sha256Canonical(canonical), frozen.canonicalSha256);
    await block.finish();
    session.assertValid();
    session.assertReplayComplete();
  });

  it("waits for a deferred prerequisite publication inside the block budget", async () => {
    const artefact = await recordCanonicalBlock();
    const session = replaySession(artefact);
    const FRESH_ALPHA = freshReservation(RES_ALPHA, "fresh-alpha-run-011");
    const FRESH_BETA = freshReservation(RES_BETA, "fresh-beta-run-012");
    const block = harness(session.controller, {
      reservations: { "alpha query": [FRESH_ALPHA], "beta query": [FRESH_BETA] },
      rows: [BASELINE[0]!, freshRow(ROW_ALPHA, FRESH_ALPHA.runId), BASELINE[1]!],
    });
    // Alpha allocates but does not publish yet; beta's read must wait.
    const alphaStarted = await allocateOn(block, "alpha query");
    const betaStarted = await allocateOn(block, "beta query");
    const reading = betaStarted.wrapper.candidates(betaStarted.reservation, "beta query", betaStarted.operation.signal);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await alphaStarted.wrapper.commit(alphaStarted.reservation!, [], alphaStarted.operation.signal);
    await alphaStarted.wrapper.updateIndex(runOf(alphaStarted.reservation!), "alpha query", alphaStarted.operation.signal);
    const view = await reading;
    assert.deepEqual(view.map((row) => row.query), ["alpha query", ...BASELINE.map((entry) => entry.query)]);
    const wait = session.observations().find((observation) => observation.kind === "visibility-wait")!;
    assert.ok(wait.kind === "visibility-wait" && wait.waitedFor.includes("research-alpha"));
    assert.ok(wait.kind === "visibility-wait" && wait.blockBudgetMs === 5000);
    await block.finish();
    session.assertValid();
  });

  it("fails closed on required window loss and unexpected or altered baseline rows", async () => {
    const artefact = await recordCanonicalBlock();
    // The frozen alpha entry is missing from beta's current read.
    {
      const session = replaySession(artefact);
      const FRESH_ALPHA = freshReservation(RES_ALPHA, "fresh-a-021");
      const FRESH_BETA = freshReservation(RES_BETA, "fresh-b-022");
      let rows: readonly IndexCandidate[] = [...BASELINE];
      const block = harness(session.controller, {
        reservations: { "alpha query": [FRESH_ALPHA], "beta query": [FRESH_BETA] },
        rows: () => rows,
      });
      const alpha = await driveOperation(block, "alpha query");
      session.prepare(suggestRequest("alpha query", alpha.view));
      await assert.rejects(driveOperation(block, "beta query"), /absent from the current read/);
      assert.throws(() => session.assertValid(), /absent from the current read/);
      await block.finish();
    }
    // An unexpected baseline addition appears in the current read.
    {
      const session = replaySession(artefact);
      const intruder = legacyRow("intruder query", "2026-10-22", "2026-10-22-intruder-query-777aaa");
      const FRESH_ALPHA = freshReservation(RES_ALPHA, "fresh-a-031");
      const block = harness(session.controller, { reservations: { "alpha query": [FRESH_ALPHA] }, rows: [intruder, ...BASELINE] });
      await assert.rejects(driveOperation(block, "alpha query"), /neither an exact frozen-baseline member nor a declared block producer/);
      await block.finish();
    }
    // Altered baseline metadata: the frozen entry can no longer be found in
    // the current read (the altered row is foreign), which fails closed as a
    // displaced baseline rather than an excludable difference.
    {
      const session = replaySession(artefact);
      const altered = { ...BASELINE[0]!, startedUtc: "2026-10-20T10:30:00.000Z" };
      const FRESH_ALPHA = freshReservation(RES_ALPHA, "fresh-a-041");
      const block = harness(session.controller, { reservations: { "alpha query": [FRESH_ALPHA] }, rows: [altered, BASELINE[1]!] });
      await assert.rejects(driveOperation(block, "alpha query"), /absent from the current read/);
      await block.finish();
    }
  });

  it("fails closed when a required producer failed before the dependent read", async () => {
    const artefact = await recordCanonicalBlock();
    const session = replaySession(artefact);
    const FRESH_ALPHA = freshReservation(RES_ALPHA, "fresh-a-051");
    const FRESH_BETA = freshReservation(RES_BETA, "fresh-b-052");
    const block = harness(session.controller, {
      reservations: { "alpha query": [FRESH_ALPHA], "beta query": [FRESH_BETA] },
      rows: [...BASELINE],
      indexResults: ["unavailable"],
    });
    await driveOperation(block, "alpha query"); // alpha's index write fails
    await assert.rejects(driveOperation(block, "beta query"), /Required producer "research-alpha" failed/);
    assert.throws(() => session.assertValid(), /Required producer|producer-failed/);
    await block.finish();
  });

  it("expires the block budget when a prerequisite never becomes index-visible", async () => {
    const artefact = await recordCanonicalBlock();
    const session = replaySession(artefact, 40);
    const FRESH_ALPHA = freshReservation(RES_ALPHA, "fresh-a-061");
    const FRESH_BETA = freshReservation(RES_BETA, "fresh-b-062");
    const block = harness(session.controller, {
      reservations: { "alpha query": [FRESH_ALPHA], "beta query": [FRESH_BETA] },
      rows: [...BASELINE],
    });
    await allocateOn(block, "alpha query"); // allocated, never published
    const betaStarted = await allocateOn(block, "beta query");
    await assert.rejects(
      betaStarted.wrapper.candidates(betaStarted.reservation, "beta query", betaStarted.operation.signal),
      /expired/,
    );
    assert.throws(() => session.assertValid(), /budget/);
    assert.ok(session.observations().some((observation) => observation.kind === "visibility-wait"));
    await block.finish();
  });

  it("invalidates and propagates cancellation when a visibility wait is aborted", async () => {
    const artefact = await recordCanonicalBlock();
    const session = replaySession(artefact);
    const FRESH_ALPHA = freshReservation(RES_ALPHA, "fresh-a-071");
    const FRESH_BETA = freshReservation(RES_BETA, "fresh-b-072");
    const block = harness(session.controller, {
      reservations: { "alpha query": [FRESH_ALPHA], "beta query": [FRESH_BETA] },
      rows: [...BASELINE],
    });
    await allocateOn(block, "alpha query");
    const betaStarted = await allocateOn(block, "beta query");
    const reading = betaStarted.wrapper.candidates(betaStarted.reservation, "beta query", betaStarted.operation.signal);
    await new Promise((resolve) => setTimeout(resolve, 10));
    betaStarted.operation.abort("block cancelled");
    await assert.rejects(reading);
    assert.throws(
      () => session.assertValid(),
      (error: unknown) => error instanceof SuggestionViewError && error.reason === "cancelled",
    );
    await block.finish();
  });

  it("fails end-of-block completeness when controller reads never entered the library", async () => {
    const artefact = await recordCanonicalBlock();
    const session = replaySession(artefact);
    // A fault-free session: producers allocate and publish through the real
    // wrapper, but no candidates call ever reaches the controller (the
    // wrapper was poisoned before every read). assertValid alone would pass.
    const block = harness(session.controller, {
      reservations: {
        "alpha query": [freshReservation(RES_ALPHA, "fresh-a-131")],
        "beta query": [freshReservation(RES_BETA, "fresh-b-132")],
      },
      rows: [...BASELINE],
    });
    for (const [query, started] of [
      ["alpha query", await allocateOn(block, "alpha query")],
      ["beta query", await allocateOn(block, "beta query")],
    ] as const) {
      await started.wrapper.commit(started.reservation!, [], started.operation.signal);
      await started.wrapper.updateIndex(runOf(started.reservation!), query, started.operation.signal);
    }
    session.assertValid();
    assert.throws(() => session.assertReplayComplete(), /frozen candidate read of "research-alpha" was never performed/);
    assert.throws(() => session.assertValid(), /never performed/);
    await block.finish();
  });

  it("fails end-of-block completeness for undriven producers and unreplayed suggestion requests", async () => {
    const artefact = await recordCanonicalBlock();
    // Nothing was driven at all.
    {
      const session = replaySession(artefact);
      session.assertValid();
      assert.throws(() => session.assertReplayComplete(), /was never driven at replay/);
    }
    // Every frozen read was performed, but the frozen suggestion judge
    // request of the first research was never replayed.
    {
      const session = replaySession(artefact);
      const FRESH_ALPHA = freshReservation(RES_ALPHA, "fresh-a-141");
      const FRESH_BETA = freshReservation(RES_BETA, "fresh-b-142");
      const FRESH_REPEAT = freshReservation(RES_REPEAT, "fresh-a-143");
      let rows: readonly IndexCandidate[] = [...BASELINE];
      const block = harness(session.controller, {
        reservations: { "alpha query": [FRESH_ALPHA, FRESH_REPEAT], "beta query": [FRESH_BETA] },
        rows: () => rows,
      });
      await driveOperation(block, "alpha query");
      session.reportHostWitness({ query: "alpha query", outcome: "settled" });
      rows = [freshRow(ROW_ALPHA, FRESH_ALPHA.runId), ...BASELINE];
      await driveOperation(block, "beta query");
      rows = [freshRow(ROW_BETA, FRESH_BETA.runId), ...BASELINE];
      await driveOperation(block, "alpha query");
      await block.finish();
      session.assertValid();
      assert.throws(() => session.assertReplayComplete(), /frozen suggestion judge request of "research-alpha" was never replayed/);
    }
  });

  it("fails closed on a judge message that does not match the projected view", async () => {
    const artefact = await recordCanonicalBlock();
    const session = replaySession(artefact);
    const FRESH_ALPHA = freshReservation(RES_ALPHA, "fresh-a-081");
    const block = harness(session.controller, { reservations: { "alpha query": [FRESH_ALPHA] }, rows: [...BASELINE] });
    const alpha = await driveOperation(block, "alpha query");
    await block.finish();
    const request = suggestRequest("alpha query", alpha.view);
    assert.throws(
      () => session.prepare({ ...request, userMessage: request.userMessage.replace("prior v1 search", "edited") }),
      /does not match the latest projected read view/,
    );
    assert.throws(() => session.assertValid(), /does not match/);
  });

  it("cross-checks the schedule, initial tree, fixture digests, display root and budget at construction", async () => {
    const artefact = await recordCanonicalBlock();
    assert.throws(
      () => createSuggestionViewReplay({
        artefact,
        displayRoot: DISPLAY_ROOT,
        budgetMs: 1000,
        expectedInitialTreeDigest: "9".repeat(64),
        expectedFixtureFiles: FIXTURE_FILES,
        onInvalid: () => {},
      }),
      /initial tree digest changed/,
    );
    assert.throws(
      () => createSuggestionViewReplay({
        artefact,
        displayRoot: DISPLAY_ROOT,
        budgetMs: 1000,
        expectedScheduleManifestSha256: "7".repeat(64),
        expectedFixtureFiles: FIXTURE_FILES,
        onInvalid: () => {},
      }),
      /schedule manifest digest changed/,
    );
    assert.throws(
      () => createSuggestionViewReplay({
        artefact,
        displayRoot: DISPLAY_ROOT,
        budgetMs: 1000,
        expectedFixtureFiles: [{ name: "model", sha256: "8".repeat(64) }],
        onInvalid: () => {},
      }),
      /do not match the artefact's record-once final fixture binding/,
    );
    assert.throws(
      () => createSuggestionViewReplay({ artefact, displayRoot: DISPLAY_ROOT, budgetMs: 1000, onInvalid: () => {} } as never),
      /requires the actual transport fixture files/,
    );
    {
      // An unbound artefact (no final fixture binding) is not complete replay validity.
      const unbound = structuredClone(artefact) as unknown as {
        fixtureFiles: Array<{ name: string; sha256: string }>;
      } as unknown as SuggestionViewArtefact;
      (unbound as unknown as { fixtureFiles: unknown[] }).fixtureFiles = [];
      assert.throws(
        () => createSuggestionViewReplay({
          artefact: unbound,
          displayRoot: DISPLAY_ROOT,
          budgetMs: 1000,
          expectedFixtureFiles: FIXTURE_FILES,
          onInvalid: () => {},
        }),
        /unbound/,
      );
    }
    assert.throws(
      () => createSuggestionViewReplay({
        artefact,
        displayRoot: ".other-search",
        budgetMs: 1000,
        expectedFixtureFiles: FIXTURE_FILES,
        onInvalid: () => {},
      }),
      /differs from the recorded artefact display root/,
    );
    assert.throws(
      () => createSuggestionViewReplay({ artefact, displayRoot: DISPLAY_ROOT, budgetMs: 0, expectedFixtureFiles: FIXTURE_FILES, onInvalid: () => {} }),
      /positive finite integer/,
    );
  });
});

describe("transport preparation integration", () => {
  async function textOf(message: AssistantMessage): Promise<string> {
    return message.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("");
  }

  it("serves recorded suggestion fixtures to the replayed canonical request across recording and replay", async () => {
    const guard = forbidNetwork({ fail: (message) => assert.fail(message) });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("options.fetch/globalThis.fetch invoked during replay (N1 violation)");
    }) as typeof globalThis.fetch;
    try {
      // Record with the SAME preparation replay will use, preparing each
      // judge request inline after its read (serial association requires it:
      // after the repeat's read, alpha's older view is no longer the latest
      // for its query and its request can no longer be prepared).
      const recorder = recorderSession();
      const recorderPreparation = createSuggestionTransportPreparation({ session: recorder, resolveNode: resolver });
      const fixtureRecorder = createFixtureRecorder({ boundary: "model", scenario: SCENARIO });
      const recordJudge = (request: ModelFixtureRequest): void => {
        const { role, ...withoutRole } = request;
        void role;
        const prepared = recorderPreparation(withoutRole, MODEL, userContext(request.userMessage, request.systemPrompt));
        fixtureRecorder.record(prepared.operationNode, prepared.request, {
          response: { text: "[]" },
          usage: { tokens: { inputTotal: 10, outputTotal: 2 }, cost: { total: 0.0001 }, source: "provider-response", costBasis: "reported" },
          delayMs: 0,
        });
      };
      let rows: readonly IndexCandidate[] = [...BASELINE];
      const recordBlock = harness(recorder.controller, {
        reservations: { "alpha query": [RES_ALPHA, RES_REPEAT], "beta query": [RES_BETA] },
        rows: () => rows,
      });
      const alpha = await driveOperation(recordBlock, "alpha query");
      recordJudge(suggestRequest("alpha query", alpha.view));
      recorder.reportHostWitness({ query: "alpha query", outcome: "settled" });
      rows = [ROW_ALPHA, ...BASELINE];
      const beta = await driveOperation(recordBlock, "beta query");
      recordJudge(suggestRequest("beta query", beta.view));
      rows = [ROW_BETA, ...BASELINE];
      const repeat = await driveOperation(recordBlock, "alpha query");
      recordJudge(suggestRequest("alpha query", repeat.view));
      await recordBlock.finish();
      const searchPrepared = recorderPreparation(
        (() => { const { role, ...withoutRole } = nonSuggestRequest(); void role; return withoutRole; })(),
        MODEL,
        userContext("fixture search query", PROMPTS.search),
      );
      fixtureRecorder.record(searchPrepared.operationNode, searchPrepared.request, { response: { text: "[]" }, delayMs: 0 });
      const artefact = recorder.exportArtefact({ fixtureFiles: FIXTURE_FILES });
      // Replay: fresh runs, a different sibling arrival order, current generated values.
      const replay = createSuggestionViewReplay({
        artefact,
        displayRoot: DISPLAY_ROOT,
        budgetMs: 5000,
        expectedFixtureFiles: FIXTURE_FILES,
        onInvalid: () => {},
      });
      const store = createReplayStore({ fixtures: fixtureRecorder.records(), scenario: SCENARIO });
      const transport = createModelTransportReplay({
        store,
        scenario: SCENARIO,
        prepare: createSuggestionTransportPreparation({ session: replay, resolveNode: resolver }),
      });
      const FRESH_ALPHA = freshReservation(RES_ALPHA, "fresh-alpha-run-101");
      const FRESH_BETA = freshReservation(RES_BETA, "fresh-beta-run-102");
      let replayRows: readonly IndexCandidate[] = [...BASELINE];
      const replayBlock = harness(replay.controller, {
        reservations: { "alpha query": [FRESH_ALPHA], "beta query": [FRESH_BETA] },
        rows: () => replayRows,
      });
      const replayAlpha = await driveOperation(replayBlock, "alpha query");
      const alphaMessage = await transport(
        { streamSimple: () => ({ result: async () => { throw new Error("live registry invoked (no live fallback)"); } }) } as never,
        MODEL,
        userContext(judgeMessage("alpha query", replayAlpha.view), PROMPTS.suggest),
        { maxTokens: 500 },
      );
      assert.equal(await textOf(alphaMessage), "[]");
      replayRows = [BASELINE[1]!, BASELINE[0]!, freshRow(ROW_ALPHA, FRESH_ALPHA.runId)];
      const replayBeta = await driveOperation(replayBlock, "beta query");
      const betaMessage = await transport(
        { streamSimple: () => ({ result: async () => { throw new Error("live registry invoked (no live fallback)"); } }) } as never,
        MODEL,
        userContext(judgeMessage("beta query", replayBeta.view), PROMPTS.suggest),
        { maxTokens: 500 },
      );
      assert.equal(await textOf(betaMessage), "[]");
      await replayBlock.finish();
      // A non-suggest request through the same preparation stays byte-exact.
      const searchMessage = await transport(
        { streamSimple: () => ({ result: async () => { throw new Error("live registry invoked (no live fallback)"); } }) } as never,
        MODEL,
        userContext("fixture search query", PROMPTS.search),
        { maxTokens: 2048, reasoning: "low" },
      );
      assert.equal(await textOf(searchMessage), "[]");
      store.assertValid();
      assert.equal(store.misses().length, 0);
      assert.equal(guard.calls(), 0);
      replay.assertValid();
    } finally {
      globalThis.fetch = originalFetch;
      guard.restore();
    }
  });

  it("invalidates the store when preparation fails, even though core would catch the error", async () => {
    const artefact = await recordCanonicalBlock();
    const replay = createSuggestionViewReplay({
      artefact,
      displayRoot: DISPLAY_ROOT,
      budgetMs: 5000,
      expectedFixtureFiles: FIXTURE_FILES,
      onInvalid: () => {},
    });
    const FRESH_ALPHA = freshReservation(RES_ALPHA, "fresh-alpha-run-111");
    const block = harness(replay.controller, { reservations: { "alpha query": [FRESH_ALPHA] }, rows: [...BASELINE] });
    const driven = await driveOperation(block, "alpha query");
    await block.finish();
    const fixtures = createFixtureRecorder({ boundary: "model", scenario: SCENARIO });
    fixtures.record("research-alpha.suggest", asJson({ placeholder: true }), { response: { text: "[]" }, delayMs: 0 });
    const store = createReplayStore({ fixtures: fixtures.records(), scenario: SCENARIO });
    const transport = createModelTransportReplay({
      store,
      scenario: SCENARIO,
      prepare: createSuggestionTransportPreparation({ session: replay, resolveNode: resolver }),
    });
    // A judge message that matches no recorded view: the preparer faults and
    // the transport invalidates the block, even if the pipeline's suggestion
    // stage catches the thrown error and continues.
    await assert.rejects(
      transport(
        { streamSimple: () => ({ result: async () => { throw new Error("live registry invoked"); } }) } as never,
        MODEL,
        userContext(judgeMessage("alpha query", driven.view).replace("prior v1 search", "something else"), PROMPTS.suggest),
        { maxTokens: 500 },
      ),
      (error: unknown) => error instanceof ReplayMissError && error.reason === "request-mismatch",
    );
    assert.ok(store.invalidations().length > 0);
    assert.throws(() => store.assertValid());
  });

  it("keeps the default resolver path byte-identical for non-prepared transports", async () => {
    const guard = forbidNetwork({ fail: (message) => assert.fail(message) });
    try {
      const fixtures = createFixtureRecorder({ boundary: "model", scenario: SCENARIO });
      fixtures.record("research.search", asJson(nonSuggestRequest()), { response: { text: "answer" }, delayMs: 0 });
      const store = createReplayStore({ fixtures: fixtures.records(), scenario: SCENARIO });
      const transport = createModelTransportReplay({ store, scenario: SCENARIO, resolveNode: resolver });
      const message = await transport(
        { streamSimple: () => ({ result: async () => { throw new Error("live registry invoked"); } }) } as never,
        MODEL,
        userContext("fixture search query", PROMPTS.search),
        { maxTokens: 2048, reasoning: "low" },
      );
      assert.equal(await textOf(message), "answer");
      store.assertValid();
    } finally {
      guard.restore();
    }
  });

  it("derives the suggestion node from the canonical representation, not the raw message", async () => {
    const artefact = await recordCanonicalBlock();
    const session = createSuggestionViewReplay({
      artefact,
      displayRoot: DISPLAY_ROOT,
      budgetMs: 5000,
      expectedFixtureFiles: FIXTURE_FILES,
      onInvalid: () => {},
    });
    const FRESH_ALPHA = freshReservation(RES_ALPHA, "fresh-alpha-run-121");
    const block = harness(session.controller, { reservations: { "alpha query": [FRESH_ALPHA] }, rows: [...BASELINE] });
    const driven = await driveOperation(block, "alpha query");
    await block.finish();
    const preparation = createSuggestionTransportPreparation({ session, resolveNode: resolver });
    const { role, ...withoutRole } = suggestRequest("alpha query", driven.view);
    void role;
    const prepared = preparation(withoutRole, MODEL, userContext(judgeMessage("alpha query", driven.view), PROMPTS.suggest));
    assert.equal(prepared.role, "suggest");
    assert.equal(prepared.operationNode, "research-alpha.suggest");
    const canonical = prepared.request as unknown as {
      f7Suggestion: { marker: string; view: { readerNode: string }; segments: unknown[] };
      userMessage?: unknown;
    };
    assert.equal(canonical.f7Suggestion.marker, "intelli-f7-suggestion-view");
    assert.equal(canonical.f7Suggestion.view.readerNode, "research-alpha");
    assert.equal(canonical.userMessage, undefined);
  });
});
