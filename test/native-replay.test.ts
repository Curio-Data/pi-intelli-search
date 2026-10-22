// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// T30/C30 native transport replay through actual registered wrappers, the
// real Codemode bridge and real host loaders. Credential-free: the main model
// uses an in-process HTTP fixture under the installed serializer; every pipeline stage
// is recorded from, then replayed below, the real native policy. Set
// NATIVE_REPLAY_PI_HOST to an installed pi-coding-agent root for the explicit
// installed-host qualification; otherwise the repository dev peer is used and
// every evidence record says so.

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { join } from "node:path";
import {
  RAW_SENTINEL,
  canonical,
  createRecording,
  createReplayBlock,
  fixtureFiles,
  importHost,
  installNetworkGuard,
  isolateProcess,
  keySummary,
  loadCompiledNative,
  loadSourceNative,
  ReplayMissError,
  openSession,
  restoreWorkspace,
  selectHost,
  snapshotWorkspace,
  createMainFixture,
  countAuthResolution,
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
import { parseUsageEvents } from "../scripts/benchmarks/usage-parser.js";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createFixtureRecorder } from "../scripts/benchmarks/replay-store.js";

const isolation = await isolateProcess("t30");
const guard: NetworkGuard = installNetworkGuard();
const hostSelection: HostSelection = await selectHost();
const host = await importHost(hostSelection);
const source = await loadSourceNative();
const auth = countAuthResolution(host as unknown as Record<string, unknown>, () => guard.phase());
let main: MainFixture;
let stage: StageFixture;
const workspace = join(isolation.root, "workspace");
const snapshot = join(isolation.root, "workspace-s0");

const ALPHA = "https://docs.example.test/alpha";
const BETA = "https://docs.example.test/beta";
const MISSING = "https://docs.example.test/missing";
const pages = new Map([
  [ALPHA, syntheticPage("Alpha", "Alpha fact: the alpha limit is 7.")],
  [BETA, syntheticPage("Beta", "Beta fact: beta is annotation-only.")],
  [MISSING, { status: 404 }],
]);
const Q = "fixture research query about alpha";
const QSEED = "seed research about alpha limits";
const QS = "fixture repeated search";
const QFAIL = "fixture failing search";
const QC = "fixture standalone collate";

const usage = (prompt: number, completion: number, cached?: number) => ({
  prompt_tokens: prompt,
  completion_tokens: completion,
  total_tokens: prompt + completion,
  ...(cached === undefined ? {} : { prompt_tokens_details: { cached_tokens: cached } }),
});

const stageScript: StageScript = ({ role, user, n }) => {
  switch (role) {
    case "search":
      if (user.includes(QFAIL))
        return {
          status: 400,
          errorBody: JSON.stringify({ error: { message: "fixture permanent bad request" } }),
        };
      if (user.includes(QS))
        return { text: `Repeated answer [Alpha](${ALPHA})`, usage: usage(40, 8) };
      // Prose names alpha and a missing page; beta arrives only as an annotation.
      return {
        text: `Answer: see [Alpha](${ALPHA}) and [Missing](${MISSING}).`,
        annotations: [BETA],
        usage: usage(50, 12, 10),
      };
    case "extract":
      if (user.includes("PAGE-MARKER:Beta"))
        return {
          status: 400,
          errorBody: JSON.stringify({ error: { message: "fixture extract rejected" } }),
        };
      if (user.includes("PAGE-MARKER:Delta"))
        return { text: "Official docs, current.\nDelta facts.", usage: usage(30, 6) };
      return { text: "Official docs, current.\nAlpha limit is 7.", usage: usage(300, 20) };
    case "collate":
      if (user.includes(QC)) return { text: "Standalone collation [S1]", usage: usage(60, 9) };
      // First research collate attempt is rate limited; the policy retries it.
      if (user.includes(Q) && n === 1) return { status: 429, headers: { "retry-after": "0" } };
      return { text: "Alpha limit is 7 [S1].", usage: usage(120, 15) };
    case "suggest":
      return { text: '[{"index":1,"relevance":"seed covers alpha limits"}]', usage: usage(70, 10) };
  }
};

const codemodeScript = [
  '// @options: {"timeout_ms": 60000}',
  `const research = await tools.intelli_research({ query: ${JSON.stringify(Q)}, maxUrls: 3, focusPrompt: "alpha limits" });`,
  `const settled = await Promise.allSettled([tools.intelli_search({ query: ${JSON.stringify(QS)} }), tools.intelli_search({ query: ${JSON.stringify(QS)} })]);`,
  "let failed = null;",
  `try { await tools.intelli_search({ query: ${JSON.stringify(QFAIL)} }); } catch (error) { failed = String(error && error.message).slice(0, 60); }`,
  `return JSON.stringify({ researchChars: research.length, sentinel: research.includes(["RAW", "PAGE", "SENTINEL"].join("-")), related: research.includes("Related cached"), searches: settled.map((s) => s.status), failed });`,
].join("\n");

const deltaContent = "# Delta\n\nPAGE-MARKER:Delta\n\nDelta supplied content.";
const blockTurns: MainTurn[] = [
  {
    toolCalls: [{ name: "codemode", args: { code: codemodeScript } }],
    usage: usage(1000, 50, 600),
  },
  {
    toolCalls: [
      {
        name: "intelli_extract",
        args: {
          url: "https://docs.example.test/delta",
          title: "Delta",
          content: deltaContent,
          query: Q,
          focusPrompt: "delta",
        },
      },
      {
        name: "intelli_collate",
        args: {
          query: QC,
          extractions: [
            {
              url: ALPHA,
              title: "Alpha",
              extraction: "Alpha limit is 7.",
              sourceType: "official-docs",
              status: "success",
            },
          ],
        },
      },
      // Every supplied extraction is blocked: an error result with zero dispatched attempts.
      {
        name: "intelli_collate",
        args: {
          query: `${QC} blocked`,
          extractions: [
            {
              url: BETA,
              title: "Beta",
              extraction: "",
              sourceType: "official-docs",
              status: "failed",
            },
          ],
        },
      },
    ],
  },
  { text: "Done.", usage: usage(1500, 5) },
];

interface BlockRun {
  readonly handle: SessionHandle;
  readonly mainBodies: string[];
  readonly wallMs: number;
}

async function runSession(
  factory: ((pi: never) => void) | null,
  turns: MainTurn[],
  phase: string,
  ports: number[],
  onSession?: (h: SessionHandle) => void,
): Promise<BlockRun> {
  main.setScript(turns);
  guard.setPhase(phase, ports);
  const handle = await openSession({
    host,
    agentDir: isolation.agentDir,
    workspace,
    main,
    nativeFactory: factory,
    codemode: "on",
  });
  onSession?.(handle);
  const started = performance.now();
  try {
    await handle.session.prompt("Run the qualification workflow.");
  } finally {
    guard.setPhase("idle", [stage.port]);
  }
  const wallMs = performance.now() - started;
  const mainBodies = [...main.rawBodies];
  handle.dispose();
  return { handle, mainBodies, wallMs };
}

const intelliEnds = (handle: SessionHandle) =>
  handle.events.filter(
    (event) =>
      (event as { type?: string }).type === "tool_execution_end" &&
      String((event as { toolName?: string }).toolName).startsWith("intelli_"),
  ) as Array<{
    toolName: string;
    toolCallId: string;
    isError: boolean;
    result: { content: Array<{ text?: string }>; details?: Record<string, unknown> };
  }>;

/** Stable per-result evidence: everything except generated ids, paths and wall times. */
function stableResult(end: ReturnType<typeof intelliEnds>[number]) {
  const data = (end.result.details?.intelli ?? {}) as Record<string, unknown>;
  const accounting = (data.accounting ?? {}) as Record<string, unknown>;
  const sources = (data.sources ?? []) as Array<{ url?: string; state?: string }>;
  return {
    tool: end.toolName,
    isError: end.isError,
    outcome: data.outcome,
    sources: sources.map((s) => `${s.url}:${s.state}`).sort(),
    attempts: accounting.attempts,
    observedAttempts: accounting.observedAttempts,
    tokens: accounting.tokens,
    reportedCost: accounting.reportedCost,
    counts: data.counts,
    related: end.result.content.some((part) => part.text?.includes("Related cached")),
  };
}

type Block = ReturnType<typeof createReplayBlock>;
type Factory = (block: Block) => ((pi: never) => void) | null;

/** One replay block from the frozen S0 state: misses abort the session. */
async function replayRun(
  factory: Factory,
  turns: MainTurn[],
  blockFiles: ReturnType<typeof fixtureFiles>,
  phase: string,
  extensionPaths?: (block: Block) => string[],
) {
  await restoreWorkspace(snapshot, workspace);
  const block = createReplayBlock(blockFiles);
  const stageBefore = stage.requests.length;
  const mainBefore = main.fetchCalls();
  main.setScript(turns);
  guard.setPhase(phase, []);
  const handle = await openSession({
    host,
    agentDir: isolation.agentDir,
    workspace,
    main,
    nativeFactory: factory(block),
    codemode: "on",
    ...(extensionPaths ? { extensionPaths: extensionPaths(block) } : {}),
  });
  block.onMiss(() => void handle.session.abort());
  const started = performance.now();
  try {
    await handle.session.prompt("Run the qualification workflow.");
  } finally {
    guard.setPhase("idle", [stage.port]);
  }
  const wallMs = performance.now() - started;
  const mainBodies = [...main.rawBodies];
  handle.dispose();
  // Store invalidation includes resolver/construction errors before lookup.
  // The outer session-stop witness remains independently required.
  let storesValid = true;
  try {
    block.modelStore.assertValid();
    block.fetchStore.assertValid();
  } catch {
    storesValid = false;
  }
  const valid = storesValid && block.missErrors.length === 0;
  return {
    block,
    handle,
    mainBodies,
    wallMs,
    valid,
    storesValid,
    network: guard.events(phase),
    stageRequests: stage.requests.length - stageBefore,
    mainFetchCalls: main.fetchCalls() - mainBefore,
    model: keySummary(block.modelStore),
    fetch: keySummary(block.fetchStore),
    misses: block.missErrors.map((e) => ({
      reason: e.reason,
      node: e.key?.operationNode ?? null,
      message: e.message.slice(0, 200),
    })),
  };
}

const transportReplay =
  (module: typeof source.module): Factory =>
  (block) =>
    module.createNativeExtension({
      mode: "transport-replay",
      registryStreamSimple: block.modelTransport,
      pageTransport: block.pageTransport,
    }) as never;

before(async () => {
  main = await createMainFixture(hostSelection.root);
  stage = await startStageFixture();
  stage.setScript(stageScript);
  await writeAgentConfig(isolation.agentDir, stage.baseUrl);
  await mkdir(workspace, { recursive: true });
});

after(async () => {
  guard.restore();
  auth.restore();
  await stage?.close();
  // Evidence stays only on request: set NATIVE_REPLAY_KEEP=1.
  if (!process.env.NATIVE_REPLAY_KEEP) await rm(isolation.root, { recursive: true, force: true });
});

describe(`native transport replay on ${hostSelection.kind} Pi ${hostSelection.version} (T30)`, () => {
  let files: ReturnType<typeof fixtureFiles>;
  let recorded: BlockRun;
  let s0Digest: string;

  it("records a frozen seed index, then a complete forced Codemode block through real registered operations", async () => {
    // Seed: a committed prior run so the block's cache-suggest judge has a frozen candidate.
    const seed = createRecording("seed", pages);
    await runSession(
      source.module.createNativeExtension({
        mode: "unit",
        registryStreamSimple: seed.modelTransport,
        pageTransport: seed.pageTransport,
      }) as never,
      [
        { toolCalls: [{ name: "intelli_research", args: { query: QSEED, maxUrls: 1 } }] },
        { text: "seeded" },
      ],
      "seed",
      [stage.port],
    );
    await snapshotWorkspace(workspace, snapshot);
    s0Digest = await treeDigest(snapshot);

    const recording = createRecording("codemode-forced", pages);
    stage.setScript(stageScript);
    recorded = await runSession(
      source.module.createNativeExtension({
        mode: "unit",
        registryStreamSimple: recording.modelTransport,
        pageTransport: recording.pageTransport,
      }) as never,
      blockTurns,
      "record",
      [stage.port],
    );
    files = fixtureFiles(recording);
    const ends = intelliEnds(recorded.handle);
    await writeEvidence(isolation.root, "record", {
      host: hostSelection,
      stageRequests: stage.requests.length,
      registryCalls: recording.registryCalls(),
      captures: recorded.handle.captures.length,
      mainBodies: recorded.mainBodies.length,
      results: ends.map(stableResult),
      toolEvents: recorded.handle.toolEvents.length,
      fixtures: { model: files.model.fixtures.length, fetch: files.fetch.fixtures.length },
      codemodeText: recorded.handle.events
        .filter(
          (e) =>
            (e as { type?: string; toolName?: string }).type === "tool_execution_end" &&
            (e as { toolName?: string }).toolName === "codemode",
        )
        .map((e) => JSON.stringify((e as { result?: unknown }).result).slice(0, 2000)),
    });
    assert.equal(guard.violations("record").length, 0, JSON.stringify(guard.violations("record")));
    assert.equal(
      recording.registryCalls(),
      stage.requests.length,
      "every recorded stage attempt went through the real host registry",
    );
    assert(ends.length >= 6, `expected nested and direct intelli results, saw ${ends.length}`);
    // Observer discrimination: the observer sees exactly the main requests the
    // installed serializer sent; recorded stage attempts reached the stage
    // fixture through the host registry but never the observer.
    assert.equal(recorded.handle.captures.length, recorded.mainBodies.length);
    assert.equal(
      canonical(recorded.handle.captures.map((c) => c.payload)),
      canonical(recorded.mainBodies.map((body) => JSON.parse(body))),
    );
    assert(stage.requests.length > 0);
    for (const capture of recorded.handle.captures) {
      const text = canonical(capture.payload);
      for (const prompt of ["Web page content:", '"Previous searches:'])
        assert(!text.includes(prompt), "no stage request reached the observer");
    }
    // The pipeline really carried raw page bytes: extraction inputs hold the sentinel.
    assert(
      files.model.fixtures.some((f) =>
        String((f.request as { userMessage?: string }).userMessage).includes(RAW_SENTINEL),
      ),
    );
  });

  it("parses canonical mixed usage: main from assistant messages, pipeline once per intelli result", () => {
    const parsed = parseUsageEvents(recorded.handle.events, "json");
    assert.deepEqual(
      parsed.assistantMessages.map(
        (m) =>
          m.usage && {
            inputTotal: m.usage.inputTotal,
            inputUncached: m.usage.inputUncached,
            cacheRead: m.usage.cacheRead,
            outputTotal: m.usage.outputTotal,
          },
      ),
      [
        { inputTotal: 1000, inputUncached: 400, cacheRead: 600, outputTotal: 50 },
        // No wire usage: SDK zero placeholders must not become an H1 zero.
        null,
        { inputTotal: 1500, inputUncached: 1500, cacheRead: 0, outputTotal: 5 },
      ],
    );
    assert.deepEqual(parsed.missing, [parsed.assistantMessages[1].id]);
    const tools = parsed.toolMessages.map((t) => ({
      nested: t.parentToolCallId !== undefined && t.parentToolCallId !== null,
      attempts: t.accounting?.attempts,
    }));
    assert.deepEqual(tools, [
      { nested: true, attempts: 6 }, // research: search, 2 extract (one error), collate 429 + retry, suggest
      { nested: true, attempts: 1 }, // repeated identical search, occurrence 1
      { nested: true, attempts: 1 }, // occurrence 2
      { nested: true, attempts: 1 }, // permanent error result with accounting
      { nested: false, attempts: 1 }, // direct extract
      { nested: false, attempts: 1 }, // direct collate
      { nested: false, attempts: 0 }, // blocked collate: error with zero dispatched attempts
    ]);
    // Codemode's own result is outside the pipeline population.
    assert(!parsed.toolMessages.some((t) => /^call_1_0$/.test(t.toolCallId)));
  });

  it("replays the block with transport-replay injection only: exact occurrences, zero pipeline network, identical accounting", async () => {
    assert(files, "record step must run first");
    await restoreWorkspace(snapshot, workspace);
    assert.equal(
      await treeDigest(workspace),
      s0Digest,
      "per-block workspace and index state are byte-identical",
    );
    const stageBefore = stage.requests.length;
    const block = createReplayBlock(files);
    const replayed = await runSession(
      source.module.createNativeExtension({
        mode: "transport-replay",
        registryStreamSimple: block.modelTransport,
        pageTransport: block.pageTransport,
      }) as never,
      blockTurns,
      "replay",
      [],
      (handle) => block.onMiss(() => void handle.session.abort()),
    );
    const model = keySummary(block.modelStore);
    const fetchKeys = keySummary(block.fetchStore);
    const recordedResults = intelliEnds(recorded.handle).map(stableResult);
    const replayedResults = intelliEnds(replayed.handle).map(stableResult);
    const usageRecorded = parseUsageEvents(recorded.handle.events, "json");
    const usageReplayed = parseUsageEvents(replayed.handle.events, "json");
    const evidence = {
      host: hostSelection,
      wallMs: { record: Math.round(recorded.wallMs), replay: Math.round(replayed.wallMs) },
      model,
      fetch: fetchKeys,
      misses: block.missErrors.map((e) => `${e.reason}: ${e.message}`),
      teeFetchCalls: block.teeFetchCalls(),
      registryReads: block.registryReads(),
      deliveredProviderEvents: block.deliveredEvents(),
      network: guard.events("replay"),
      mainTransport: {
        population: "in-process injected fetch (no socket)",
        fetchCalls: main.fetchCalls(),
        unguardedStreams: main.unguardedStreams(),
      },
      auth: auth.events("replay"),
      violations: guard.violations("replay"),
      stageRequestsDuringReplay: stage.requests.length - stageBefore,
      recordedResults,
      replayedResults,
      usage: { recorded: usageRecorded, replayed: usageReplayed },
      observer: replayed.handle.captures.map((c) => c.payloadSha256),
    };
    await writeEvidence(isolation.root, "replay", evidence);
    assert.deepEqual(evidence.violations, []);
    assert.deepEqual(evidence.network, [], "zero network primitives of any kind, main included");
    assert.equal(main.unguardedStreams(), 0);
    assert(main.fetchCalls() > 0, "main requests used only the injected in-process transport");
    assert.deepEqual(
      evidence.auth.filter((event) => /login|Credential/.test(event.method)),
      [],
      "no credential login or credential operation during replay",
    );
    assert(
      evidence.auth
        .filter((event) => event.method.endsWith(".refresh"))
        .every((event) => event.provider === "allowNetwork=false"),
      "model-configuration refreshes during replay are offline",
    );
    assert.equal(evidence.stageRequestsDuringReplay, 0);
    assert.equal(block.teeFetchCalls(), 0, "N1: options.fetch never invoked");
    assert.equal(block.registryReads(), 0, "the live registry is never dereferenced");
    assert.deepEqual(evidence.misses, []);
    block.modelStore.assertValid();
    block.fetchStore.assertValid();
    assert.deepEqual(model.unconsumed, [], "every recorded model occurrence was replayed");
    assert.deepEqual(fetchKeys.unconsumed, []);
    assert.deepEqual(
      [...model.consumed].sort(),
      files.model.fixtures.map((f) => `model:${f.key.operationNode}#${f.key.occurrence}`).sort(),
    );
    assert(
      block.deliveredEvents() > 0,
      "citations and wire usage arrive only through recorded provider events",
    );
    assert.deepEqual(replayedResults, recordedResults);
    assert.deepEqual(
      usageReplayed.toolMessages.map((t) => t.accounting),
      usageRecorded.toolMessages.map((t) => t.accounting),
    );
    for (const body of [...recorded.mainBodies, ...replayed.mainBodies])
      assert(!body.includes(RAW_SENTINEL), "raw page bytes never reach a main request");
    assert.equal(
      canonical(replayed.handle.captures.map((c) => c.payload)),
      canonical(replayed.mainBodies.map((b) => JSON.parse(b))),
    );
  });

  it("fails closed on a request drift: the miss stops the session, no live fallback, block invalid", async () => {
    const drifted = blockTurns.map((turn, index) =>
      index === 0
        ? {
            ...turn,
            toolCalls: [
              { name: "codemode", args: { code: codemodeScript.replace(Q, `${Q} drifted`) } },
            ],
          }
        : turn,
    );
    const run = await replayRun(transportReplay(source.module), drifted, files, "miss-drift");
    await writeEvidence(isolation.root, "miss-drift", {
      host: hostSelection,
      ...run,
      handle: undefined,
      block: undefined,
    });
    assert.equal(run.valid, false, "a miss invalidates the block");
    assert(run.misses.length >= 1);
    assert.equal(run.misses[0]!.reason, "not-found");
    assert.match(String(run.misses[0]!.node), /^search\//);
    assert.deepEqual(run.network, [], "no network primitive, so no live fallback");
    assert.equal(run.stageRequests, 0);
    assert(
      run.model.unconsumed.length > 0,
      "the stopped block leaves later fixtures unconsumed (skipped, not served)",
    );
    assert.equal(run.block.teeFetchCalls(), 0);
  });

  it("rejects a second in-block research: its cache-suggest prompt embeds a fresh run slug and wall timestamp", async () => {
    const Q2 = "second fixture research about beta";
    const twice = [
      '// @options: {"timeout_ms": 60000}',
      `await tools.intelli_research({ query: ${JSON.stringify(Q)}, maxUrls: 3 });`,
      `const second = await tools.intelli_research({ query: ${JSON.stringify(Q2)}, maxUrls: 1 });`,
      "return String(second.length);",
    ].join("\n");
    const turns: MainTurn[] = [
      { toolCalls: [{ name: "codemode", args: { code: twice } }] },
      { text: "Done." },
    ];
    await restoreWorkspace(snapshot, workspace);
    const recording = createRecording("two-research", pages);
    stage.setScript(stageScript);
    await runSession(
      source.module.createNativeExtension({
        mode: "unit",
        registryStreamSimple: recording.modelTransport,
        pageTransport: recording.pageTransport,
      }) as never,
      turns,
      "record-two",
      [stage.port],
    );
    const twoFiles = fixtureFiles(recording);
    const suggestRecords = twoFiles.model.fixtures.filter((f) =>
      f.key.operationNode.startsWith("suggest/"),
    );
    assert.equal(suggestRecords.length, 2, "both researches reached the judge while recording");
    const run = await replayRun(
      transportReplay(source.module),
      turns,
      twoFiles,
      "miss-second-research",
    );
    await writeEvidence(isolation.root, "miss-second-research", {
      host: hostSelection,
      ...run,
      handle: undefined,
      block: undefined,
    });
    assert.equal(run.valid, false);
    assert.equal(run.misses[0]?.reason, "not-found");
    assert.match(
      String(run.misses[0]?.node),
      /^suggest\//,
      "the first miss is the second research's judge",
    );
    assert.deepEqual(run.network, []);
    assert.equal(run.stageRequests, 0);
  });

  it("stops on resolver ambiguity during an actual registered call, and refuses ambiguous fixture sets at construction", async () => {
    const ambiguous: MainTurn[] = [
      {
        toolCalls: [
          {
            name: "intelli_extract",
            args: {
              url: "https://docs.example.test/twin",
              title: "Twin",
              content: "PAGE-MARKER:Alpha and PAGE-MARKER:Beta",
              query: Q,
            },
          },
        ],
      },
      { text: "Done." },
    ];
    const run = await replayRun(transportReplay(source.module), ambiguous, files, "miss-ambiguous");
    await writeEvidence(isolation.root, "miss-ambiguous", {
      host: hostSelection,
      ...run,
      handle: undefined,
      block: undefined,
    });
    assert.equal(run.misses[0]?.reason, "ambiguous-node");
    assert.equal(run.valid, false, "a resolver ambiguity invalidates the block");
    assert.equal(run.storesValid, false, "resolver ambiguity invalidates the store before lookup");
    assert.deepEqual(run.network, []);
    // Identical request bytes recorded under two nodes cannot be told apart by content.
    const first = files.model.fixtures[0]!;
    const twin = createFixtureRecorder({ boundary: "model", scenario: files.model.scenario });
    for (const node of [first.key.operationNode, `${first.key.operationNode}-twin`])
      twin.record(node, first.request, { response: first.response!, delayMs: 0 });
    assert.throws(
      () => createReplayBlock({ model: twin.toFile(), fetch: files.fetch }),
      (error: unknown) => error instanceof ReplayMissError && error.reason === "ambiguous-node",
    );
  });

  it("captures injections immutably per loaded runtime; the default export stays uninjected", async () => {
    assert.throws(
      () =>
        source.module.createNativeExtension({
          mode: "transport-replay",
          registryStreamSimple: async () => {
            throw new Error();
          },
          pageTransport: async () => {
            throw new Error();
          },
          operations: {},
        } as never),
      /cannot replace operations/,
    );
    assert.throws(
      () =>
        source.module.createNativeExtension({
          mode: "transport-replay",
          registryStreamSimple: async () => {
            throw new Error();
          },
        } as never),
      /requires both/,
    );
    assert.throws(
      () => source.module.createNativeExtension({ mode: "record" } as never),
      /Unknown native injection mode/,
    );
    let tripwire = 0;
    const run = await replayRun(
      (block) => {
        const injection = {
          mode: "transport-replay" as const,
          registryStreamSimple: block.modelTransport,
          pageTransport: block.pageTransport,
        };
        const extension = source.module.createNativeExtension(injection);
        // Mutating the caller's object after capture must not reach the runtime.
        Object.assign(injection, {
          registryStreamSimple: async () => {
            tripwire++;
            throw new Error("mutated after capture");
          },
          pageTransport: async () => {
            tripwire++;
            throw new Error("mutated after capture");
          },
        });
        return extension as never;
      },
      blockTurns,
      files,
      "replay-mutated",
    );
    assert.equal(tripwire, 0);
    assert(run.valid, JSON.stringify(run.misses));
    assert.deepEqual(run.model.unconsumed, []);
    assert.deepEqual(run.network, []);
    // Same loaded module, default export: real registry dispatch, untouched by any injection.
    const before = stage.requests.length;
    await runSession(
      source.module.default as never,
      [{ toolCalls: [{ name: "intelli_search", args: { query: QS } }] }, { text: "Done." }],
      "record-default",
      [stage.port],
    );
    assert.equal(stage.requests.length - before, 1, "the default export reached the real registry");
    assert.equal(tripwire, 0);
  });

  it("replays identically through a private compiled tree loaded beside the source tree", async () => {
    const compiled = await loadCompiledNative(join(isolation.root, "compiled"));
    assert.notEqual(compiled.module.createNativeExtension, source.module.createNativeExtension);
    assert.deepEqual(compiled.sourceHashes, source.sourceHashes);
    const run = await replayRun(
      transportReplay(compiled.module),
      blockTurns,
      files,
      "replay-compiled",
    );
    await writeEvidence(isolation.root, "replay-compiled", {
      host: hostSelection,
      entry: compiled.entry,
      ...run,
      handle: undefined,
      block: undefined,
      results: intelliEnds(run.handle).map(stableResult),
    });
    assert(run.valid, JSON.stringify(run.misses));
    assert.deepEqual(run.model.unconsumed, []);
    assert.deepEqual(run.fetch.unconsumed, []);
    assert.deepEqual(run.network, []);
    assert.deepEqual(
      intelliEnds(run.handle).map(stableResult),
      intelliEnds(recorded.handle).map(stableResult),
    );
  });

  for (const kind of ["source", "compiled"] as const)
    it(`replays through the host's own extension loader (jiti, fresh module graph): ${kind}`, async () => {
      const entry =
        kind === "source" ? join(source.entry) : join(isolation.root, "compiled", "src/index.js");
      const dir = join(isolation.root, `host-loaded-${kind}`);
      await mkdir(dir, { recursive: true });
      const fixturePath = join(dir, "fixtures.json");
      await writeFile(fixturePath, JSON.stringify(files));
      const probeKey = `native-replay.host-loaded.${kind}`;
      const wrapper = join(dir, "extension.ts");
      await writeFile(
        wrapper,
        [
          `import { readFileSync } from "node:fs";`,
          `import { VERSION } from "@earendil-works/pi-coding-agent";`,
          `import { createNativeExtension } from ${JSON.stringify(entry)};`,
          `import { createReplayBlock } from ${JSON.stringify(join(source.entry, "../../test/helpers/native-replay.ts"))};`,
          `const block = createReplayBlock(JSON.parse(readFileSync(${JSON.stringify(fixturePath)}, "utf8")));`,
          `(globalThis as Record<symbol, unknown>)[Symbol.for(${JSON.stringify(probeKey)})] = { block, createNativeExtension, peerVersion: VERSION };`,
          `export default createNativeExtension({ mode: "transport-replay", registryStreamSimple: block.modelTransport, pageTransport: block.pageTransport });`,
        ].join("\n"),
      );
      const run = await replayRun(
        () => null,
        blockTurns,
        files,
        `replay-host-loaded-${kind}`,
        () => [wrapper],
      );
      const probe = (globalThis as Record<symbol, unknown>)[Symbol.for(probeKey)] as
        { block: Block; createNativeExtension: unknown; peerVersion: string } | undefined;
      assert(probe, "the host loaded the wrapper");
      const hostModel = keySummary(probe.block.modelStore);
      await writeEvidence(isolation.root, `replay-host-loaded-${kind}`, {
        host: hostSelection,
        entry,
        peerVersionSeenByExtension: probe.peerVersion,
        freshModuleInstance: probe.createNativeExtension !== source.module.createNativeExtension,
        hostModel,
        hostMisses: probe.block.missErrors.map((e) => e.message),
        network: run.network,
        results: intelliEnds(run.handle).map(stableResult),
      });
      assert.notEqual(
        probe.createNativeExtension,
        source.module.createNativeExtension,
        "the host loader built its own module graph",
      );
      assert.equal(
        probe.peerVersion,
        hostSelection.version,
        "the extension's peer imports resolved to the selected host",
      );
      assert.deepEqual(probe.block.missErrors, []);
      assert.deepEqual(hostModel.unconsumed, []);
      assert.deepEqual(run.network, []);
      assert.equal(probe.block.teeFetchCalls(), 0);
      assert.deepEqual(
        intelliEnds(run.handle).map(stableResult),
        intelliEnds(recorded.handle).map(stableResult),
      );
    });
});
