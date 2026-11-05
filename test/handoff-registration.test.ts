// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Native-parity and fail-closed registration tests for the fixed-source
// research-handoff study (Track A). Arm A executes the ORIGINAL native
// wrapper with synthetic transports injected through the legacy test seam
// (in isolation, restored afterwards; PROTOCOL.md permits exactly this).
// Arm B executes the benchmark registration with the same synthetic
// completions and frozen inputs. No network, no host session, no paid calls.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { intelliResearchTool, __harness } from "../src/tools/intelli-research.js";
import { research } from "../src/core/operations/research.js";
import { resolveWorkspacePaths } from "../src/core/paths.js";
import { createBenchmarkResearchTool, createBenchmarkResearchExtension } from "../scripts/research-handoff/registration.js";
import {
  settleInputIntegrity,
  createFrozenModelClient,
  createFrozenFetchPages,
  createForbidLlmsFull,
  createInputControlLatch,
  sha256Hex,
  FrozenIntegrityError,
} from "../scripts/research-handoff/common-inputs.js";
import { studySettings, studyParams } from "../scripts/research-handoff/config.js";
import type { FrozenInputs, JournalEvent } from "../scripts/research-handoff/contracts.js";
import type { callLlm } from "../src/llm.js";
import type { fetchPages } from "../src/core/fetch.js";
import {
  buildSyntheticCorpus,
  writeFrozenFile,
  arrayJournal,
  syntheticCallLlmDelegate,
  mockExtensionContext,
  isolateAgentEnv,
  normaliseForParity,
  singleCacheDir,
} from "./helpers/handoff-fixtures.js";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "rh-reg-ws-"));
}

function captureStages(): { stages: string[]; onUpdate: Parameters<typeof intelliResearchTool.execute>[3] } {
  const stages: string[] = [];
  return {
    stages,
    onUpdate: (update) => {
      const stage = (update?.details as { stage?: string } | undefined)?.stage;
      if (stage) stages.push(stage);
    },
  };
}

interface RunOutcome {
  result: Awaited<ReturnType<typeof intelliResearchTool.execute>>;
  stages: string[];
}

/** Arm A: the original wrapper with synthetic transports through __harness. */
async function runOriginalWrapper(args: {
  cwd: string;
  frozenParams: ReturnType<typeof studyParams>;
  delegate: typeof callLlm;
  fetchPages: typeof fetchPages;
  signal?: AbortSignal;
}): Promise<RunOutcome> {
  const savedCallLlm = __harness.callLlm;
  const savedFetchPages = __harness.fetchPages;
  __harness.callLlm = args.delegate;
  __harness.fetchPages = args.fetchPages;
  const { stages, onUpdate } = captureStages();
  try {
    const result = await intelliResearchTool.execute(
      "call-original",
      args.frozenParams,
      args.signal,
      onUpdate,
      mockExtensionContext({ cwd: args.cwd, settings: studySettings() }) as never,
    );
    return { result, stages };
  } finally {
    __harness.callLlm = savedCallLlm;
    __harness.fetchPages = savedFetchPages;
  }
}

/** Arm B: the benchmark registration with per-run frozen inputs. */
async function runBenchmarkTool(args: {
  cwd: string;
  frozenPath: string;
  expectedDigest: string;
  params: ReturnType<typeof studyParams>;
  delegate: typeof callLlm;
  events: JournalEvent[];
  signal?: AbortSignal;
}): Promise<RunOutcome> {
  const journal = { record: (event: JournalEvent) => args.events.push(event) };
  const tool = createBenchmarkResearchTool({
    frozenPath: args.frozenPath,
    expectedDigest: args.expectedDigest,
    journal,
    callLlmDelegate: args.delegate,
  });
  const { stages, onUpdate } = captureStages();
  const result = await tool.execute(
    "call-benchmark",
    args.params,
    args.signal,
    onUpdate,
    mockExtensionContext({ cwd: args.cwd, settings: studySettings() }) as never,
  );
  return { result, stages };
}

test("native parity: identical inputs produce identical text, details, progress and reports", async () => {
  const agent = isolateAgentEnv(studySettings());
  try {
    const { frozen } = await buildSyntheticCorpus();
    const frozenPath = writeFrozenFile(frozen);
    const delegateCalls: Array<{ systemPrompt: string; userMessage: string }> = [];

    const wsA = workspace();
    const wsB = workspace();
    // Arm A: synthetic search/extract/collate completions through __harness;
    // the synthetic pages flow through the same fetchPages seam.
    const syntheticFetch: typeof fetchPages = async (urls) => {
      assert.deepEqual(urls, frozen.capture.selectedSources.map((s) => s.url));
      return structuredClone(frozen.pages.map((entry) => entry.page));
    };
    const runA = await runOriginalWrapper({
      cwd: wsA,
      frozenParams: { ...studyParams() },
      delegate: syntheticCallLlmDelegate({ frozen, calls: delegateCalls }),
      fetchPages: syntheticFetch,
    });
    // Arm B: the benchmark registration with the same frozen corpus.
    const events: JournalEvent[] = [];
    const runB = await runBenchmarkTool({
      cwd: wsB,
      frozenPath,
      expectedDigest: frozen.digest,
      params: { ...studyParams() },
      delegate: syntheticCallLlmDelegate({ frozen, calls: delegateCalls }),
      events,
    });

    // Result text and pipeline details are exactly equal.
    assert.equal(runB.result.content[0].type, "text");
    assert.equal(runA.result.content[0].type, "text");
    const textA = runA.result.content[0].type === "text" ? runA.result.content[0].text : "";
    const textB = runB.result.content[0].type === "text" ? runB.result.content[0].text : "";
    assert.equal(textB, textA);
    assert.deepEqual(runB.result.details, runA.result.details);

    // Progress stage sequences match exactly.
    assert.deepEqual(runB.stages, runA.stages);

    // Saved reports: byte-equal after only the two documented normalisations.
    const cacheA = singleCacheDir(wsA);
    const cacheB = singleCacheDir(wsB);
    const reportA = normaliseForParity(readFileSync(join(cacheA, "report.md"), "utf8"));
    const reportB = normaliseForParity(readFileSync(join(cacheB, "report.md"), "utf8"));
    assert.equal(reportB, reportA);

    // Extraction and source artefacts: same file sets, byte-equal contents.
    for (const sub of ["extractions", "sources"]) {
      const namesA = readdirSync(join(cacheA, sub)).sort();
      const namesB = readdirSync(join(cacheB, sub)).sort();
      assert.deepEqual(namesB, namesA, `${sub} file sets differ`);
      for (const name of namesA) {
        assert.equal(
          readFileSync(join(cacheB, sub, name), "utf8"),
          readFileSync(join(cacheA, sub, name), "utf8"),
          `${sub}/${name} bytes differ`,
        );
      }
    }

    // Telemetry sidecars: identical on stage outcome fields (field selection,
    // not string munging; timings and timestamps are excluded by name).
    const metaA = JSON.parse(readFileSync(join(cacheA, "meta.json"), "utf8")) as Record<string, any>;
    const metaB = JSON.parse(readFileSync(join(cacheB, "meta.json"), "utf8")) as Record<string, any>;
    assert.equal(metaB.outcome, metaA.outcome);
    assert.equal(metaB.search?.linksReturned, metaA.search?.linksReturned);
    assert.equal(metaB.extract?.succeeded, metaA.extract?.succeeded);
    assert.equal(metaB.extract?.failed, metaA.extract?.failed);
    assert.equal(metaB.fetch?.succeeded, metaA.fetch?.succeeded);
    assert.equal(metaB.collate?.summaryChars, metaA.collate?.summaryChars);
    assert.equal(metaB.cacheSuggest?.ran, metaA.cacheSuggest?.ran);

    // Adapter evidence: search replayed once (uncharged), all extraction
    // inputs consumed exactly once, settleInputIntegrity matches.
    assert.equal(events.filter((e) => e.kind === "search-replayed").length, 1);
    assert.equal(events.filter((e) => e.kind === "extract-consumed").length, frozen.extractionInputs.length);
    const result = events.find((e) => e.kind === "research-result");
    assert.ok(result);
    assert.equal(result.data.outcome, "completed");
    assert.equal(result.data.textSha256, sha256Hex(textB));
    const settled = settleInputIntegrity({ frozen, events });
    assert.equal(settled.matched, true);
    assert.equal(settled.complete, true);
    assert.deepEqual(settled.problems, []);
    assert.deepEqual(settled.completenessProblems, []);
    // The registration bound the served corpus digest (F11).
    const bound = events.find((e) => e.kind === "corpus-bound");
    assert.ok(bound);
    assert.equal(bound.data.servedDigest, frozen.digest);
    assert.equal(bound.data.expectedDigest, frozen.digest);

    // Model roles that crossed the live delegate. Arm A crosses all four
    // stages; arm B's search is REPLAYED by the frozen adapter (never
    // delegated), so the delegate sees: one search (arm A), one extraction per
    // frozen page per arm, one collation per arm.
    const roles = delegateCalls
      .map((call) => call.systemPrompt)
      .map((prompt) => {
        if (prompt.includes("extraction assistant")) return "extract";
        if (prompt.includes("collation assistant")) return "collate";
        return "search";
      });
    assert.equal(roles.filter((r) => r === "search").length, 1); // arm A only; arm B replayed
    assert.equal(roles.filter((r) => r === "extract").length, frozen.extractionInputs.length * 2);
    assert.equal(roles.filter((r) => r === "collate").length, 2); // once per arm
  } finally {
    agent.restore();
  }
});

test("contract identity: the benchmark tool is the native tool's declaration", async () => {
  const { frozen } = await buildSyntheticCorpus();
  const { journal } = arrayJournal();
  const tool = createBenchmarkResearchTool({
    frozenPath: writeFrozenFile(frozen),
    expectedDigest: frozen.digest,
    journal,
  });
  assert.equal(tool.name, intelliResearchTool.name);
  assert.equal(tool.label, intelliResearchTool.label);
  assert.equal(tool.description, intelliResearchTool.description);
  assert.equal(tool.promptSnippet, intelliResearchTool.promptSnippet);
  assert.equal(tool.promptGuidelines, intelliResearchTool.promptGuidelines);
  assert.equal(tool.parameters, intelliResearchTool.parameters);
  assert.equal(tool.annotations, intelliResearchTool.annotations);
  assert.equal(tool.constrainedSampling, intelliResearchTool.constrainedSampling);
  assert.equal(tool.executionMode, intelliResearchTool.executionMode);
  assert.equal(tool.renderResult, intelliResearchTool.renderResult);
  assert.equal("outputSchema" in tool, false);
  // The extension factory registers exactly that tool object.
  const registered: unknown[] = [];
  createBenchmarkResearchExtension({
    frozenPath: writeFrozenFile(frozen),
    expectedDigest: frozen.digest,
    journal,
  })({
    registerTool: (definition: unknown) => {
      registered.push(definition);
    },
  } as never);
  assert.equal(registered.length, 1);
  assert.equal((registered[0] as { name: string }).name, "intelli_research");
});

test("fail-closed: corrupt frozen corpus is rejected with zero model calls", async () => {
  const agent = isolateAgentEnv(studySettings());
  try {
    const { frozen } = await buildSyntheticCorpus();
    const dir = mkdtempSync(join(tmpdir(), "rh-reg-corrupt-"));
    const path = join(dir, "frozen-inputs.json");
    const mutated = structuredClone(frozen);
    mutated.pages[0].page.content += "tampered";
    writeFileSync(path, JSON.stringify(mutated));
    const events: JournalEvent[] = [];
    const calls: Array<{ systemPrompt: string; userMessage: string }> = [];
    await assert.rejects(
      runBenchmarkTool({
        cwd: workspace(),
        frozenPath: path,
        expectedDigest: frozen.digest,
        params: { ...studyParams() },
        delegate: syntheticCallLlmDelegate({ frozen, calls }),
        events,
      }),
      /Fixed-source input control failed/,
    );
    assert.equal(calls.length, 0);
    assert.ok(events.some((e) => e.kind === "frozen-inputs-invalid"));
  } finally {
    agent.restore();
  }
});

test("fail-closed: settings drift is rejected before any model call", async () => {
  const drifted: ReturnType<typeof studySettings> = { ...studySettings(), retryBaseDelayMs: 4242 };
  const agent = isolateAgentEnv(drifted);
  try {
    const { frozen } = await buildSyntheticCorpus();
    const events: JournalEvent[] = [];
    const calls: Array<{ systemPrompt: string; userMessage: string }> = [];
    await assert.rejects(
      runBenchmarkTool({
        cwd: workspace(),
        frozenPath: writeFrozenFile(frozen),
        expectedDigest: frozen.digest,
        params: { ...studyParams() },
        delegate: syntheticCallLlmDelegate({ frozen, calls }),
        events,
      }),
      /Fixed-source input control failed \(settings\)/,
    );
    assert.equal(calls.length, 0);
    const mismatch = events.find((e) => e.kind === "settings-mismatch");
    assert.ok(mismatch);
    assert.ok((mismatch.data.problems as string[]).some((p) => p.includes("retryBaseDelayMs")));
    // Admission was consumed by the failed attempt on the SAME registration
    // instance; a second invocation is rejected as nonconformance, not
    // treated as a fresh research call.
    const second: JournalEvent[] = [];
    const tool = createBenchmarkResearchTool({
      frozenPath: writeFrozenFile(frozen),
      expectedDigest: frozen.digest,
      journal: { record: (event) => second.push(event) },
      callLlmDelegate: syntheticCallLlmDelegate({ frozen, calls: [] }),
    });
    const firstCall = tool.execute(
      "first",
      { ...studyParams() },
      undefined,
      undefined,
      mockExtensionContext({ cwd: workspace(), settings: studySettings() }) as never,
    );
    await assert.rejects(firstCall, /Fixed-source input control failed \(settings\)/);
    await assert.rejects(
      tool.execute(
        "second",
        { ...studyParams() },
        undefined,
        undefined,
        mockExtensionContext({ cwd: workspace(), settings: studySettings() }) as never,
      ),
      /already invoked once/,
    );
    assert.ok(second.some((e) => e.kind === "admission-rejected"));
  } finally {
    agent.restore();
  }
});

test("fail-closed: parameter drift is rejected before any model call", async () => {
  const agent = isolateAgentEnv(studySettings());
  try {
    const { frozen } = await buildSyntheticCorpus();
    const events: JournalEvent[] = [];
    const calls: Array<{ systemPrompt: string; userMessage: string }> = [];
    await assert.rejects(
      runBenchmarkTool({
        cwd: workspace(),
        frozenPath: writeFrozenFile(frozen),
        expectedDigest: frozen.digest,
        params: { ...studyParams(), query: "a rephrased query the model chose" },
        delegate: syntheticCallLlmDelegate({ frozen, calls }),
        events,
      }),
      /Fixed-source input control failed \(params\)/,
    );
    assert.equal(calls.length, 0);
    assert.ok(events.some((e) => e.kind === "params-mismatch"));
  } finally {
    agent.restore();
  }
});

test("partial failures: a frozen failed page stays visible in both arms", async () => {
  const agent = isolateAgentEnv(studySettings());
  try {
    const pages = [
      {
        url: "https://developers.cloudflare.com/synthetic-page-1",
        title: "Synthetic Page 1",
        content: "SYNTHETIC_PAGE_1 readable placeholder content; no real setup instructions.",
        status: "success" as const,
        source: "markdown",
      },
      {
        url: "https://pi.dev/synthetic-page-2",
        title: "Synthetic Page 2",
        content: "",
        status: "error" as const,
        error: "synthetic fetch failure (frozen)",
      },
    ];
    const completion = {
      text: pages.map((page) => `[${page.title}](${page.url})`).join(" "),
      citations: [],
    };
    const { frozen } = await buildSyntheticCorpus({ pages, searchCompletion: completion });
    const frozenPath = writeFrozenFile(frozen);
    assert.equal(frozen.pages.length, 2);
    assert.equal(frozen.extractionInputs.length, 1);

    const wsA = workspace();
    const wsB = workspace();
    const syntheticFetch: typeof fetchPages = async (urls) => {
      assert.deepEqual(urls, frozen.capture.selectedSources.map((s) => s.url));
      return structuredClone(frozen.pages.map((entry) => entry.page));
    };
    const runA = await runOriginalWrapper({
      cwd: wsA,
      frozenParams: { ...studyParams() },
      delegate: syntheticCallLlmDelegate({ frozen }),
      fetchPages: syntheticFetch,
    });
    const events: JournalEvent[] = [];
    const runB = await runBenchmarkTool({
      cwd: wsB,
      frozenPath,
      expectedDigest: frozen.digest,
      params: { ...studyParams() },
      delegate: syntheticCallLlmDelegate({ frozen }),
      events,
    });

    const textA = runA.result.content[0].type === "text" ? runA.result.content[0].text : "";
    const textB = runB.result.content[0].type === "text" ? runB.result.content[0].text : "";
    assert.equal(textB, textA);
    // The failed page and its frozen reason remain visible in the result.
    assert.ok(textB.includes("synthetic-page-2"));
    assert.ok(textB.includes("synthetic fetch failure"));
    // Both runs completed with one blocked source.
    assert.equal((runB.result.details as Record<string, unknown>).pagesFailed, 1);
    assert.equal((runA.result.details as Record<string, unknown>).pagesFailed, 1);
    // Reports exist and record the failure counts.
    const reportB = readFileSync(join(singleCacheDir(wsB), "report.md"), "utf8");
    assert.match(reportB, /1 succeeded, 1 failed/);
    // Integrity: the one expected extraction was consumed; outcome completed.
    const settled = settleInputIntegrity({ frozen, events });
    assert.equal(settled.matched, true);
    assert.equal(settled.complete, true);
  } finally {
    agent.restore();
  }
});

test("truncation: the hash boundary covers the truncated extraction message", async () => {
  const settings = { ...studySettings(), extractMaxChars: 60 };
  const agent = isolateAgentEnv(settings);
  try {
    const { frozen } = await buildSyntheticCorpus({ settings });
    const events: JournalEvent[] = [];
    const run = await runBenchmarkTool({
      cwd: workspace(),
      frozenPath: writeFrozenFile(frozen),
        expectedDigest: frozen.digest,
      params: { ...studyParams() },
      delegate: syntheticCallLlmDelegate({ frozen }),
      events,
    });
    assert.equal((run.result.details as Record<string, unknown>).outcome ?? "completed", "completed");
    const consumed = events.filter((e) => e.kind === "extract-consumed");
    assert.equal(consumed.length, frozen.extractionInputs.length);
    for (const event of consumed) {
      const expected = frozen.extractionInputs.find(
        (input) => input.userMessageSha256 === event.data.userMessageSha256,
      );
      assert.ok(expected, "every consumed hash must belong to the frozen corpus");
    }
    const settled = settleInputIntegrity({ frozen, events });
    assert.equal(settled.matched, true);
    assert.equal(settled.complete, true);
    assert.deepEqual(settled.completenessProblems, []);
    // The synthetic pages are longer than the cap; the frozen hashes were
    // computed over the truncated builder output (raw UTF-8 bytes).
    for (const page of frozen.pages) {
      if (page.page.status === "success") {
        assert.ok(page.page.content.length > 60);
      }
    }
  } finally {
    agent.restore();
  }
});

test("cancellation: an aborted signal propagates and consumes the invocation", async () => {
  const agent = isolateAgentEnv(studySettings());
  try {
    const { frozen } = await buildSyntheticCorpus();
    const events: JournalEvent[] = [];
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      runBenchmarkTool({
        cwd: workspace(),
        frozenPath: writeFrozenFile(frozen),
        expectedDigest: frozen.digest,
        params: { ...studyParams() },
        delegate: syntheticCallLlmDelegate({ frozen }),
        events,
        signal: controller.signal,
      }),
      (error: unknown) => {
        assert.equal((error as Error).name, "AbortError");
        return true;
      },
    );
    assert.ok(events.some((e) => e.kind === "research-admitted"));
    assert.ok(events.some((e) => e.kind === "research-error"));
    // Missing execution is an incompleteness, not proof of changed inputs:
    // matched stays true (F4) and the gap is reported in completenessProblems.
    const settled = settleInputIntegrity({ frozen, events });
    assert.equal(settled.matched, true);
    assert.equal(settled.complete, false);
    assert.ok(settled.completenessProblems.some((p) => p.includes("no research-result")));
  } finally {
    agent.restore();
  }
});

test("concurrency admission: a second simultaneous invocation is rejected synchronously", async () => {
  const agent = isolateAgentEnv(studySettings());
  try {
    const { frozen } = await buildSyntheticCorpus();
    const frozenPath = writeFrozenFile(frozen);
    const events: JournalEvent[] = [];
    const tool = createBenchmarkResearchTool({
      frozenPath,
      expectedDigest: frozen.digest,
      journal: { record: (event) => events.push(event) },
      callLlmDelegate: syntheticCallLlmDelegate({ frozen }),
    });
    const ctx = mockExtensionContext({ cwd: workspace(), settings: studySettings() });
    const first = tool.execute("first", { ...studyParams() }, undefined, undefined, ctx as never);
    const second = tool.execute("second", { ...studyParams() }, undefined, undefined, ctx as never);
    const [a, b] = await Promise.allSettled([first, second]);
    assert.equal(a.status, "fulfilled");
    assert.equal(b.status, "rejected");
    assert.match(String((b as PromiseRejectedResult).reason), /already invoked once/);
    assert.equal(events.filter((e) => e.kind === "research-admitted").length, 1);
    assert.equal(events.filter((e) => e.kind === "admission-rejected").length, 1);
    assert.equal(events.filter((e) => e.kind === "search-replayed").length, 1);
    // Exactly one pipeline ran: one search replay and the full extraction set.
    assert.equal(events.filter((e) => e.kind === "extract-consumed").length, frozen.extractionInputs.length);
    const settled = settleInputIntegrity({ frozen, events });
    assert.equal(settled.matched, true);
  } finally {
    agent.restore();
  }
});

test("reports resolve: cited cache paths point at readable files", async () => {
  const agent = isolateAgentEnv(studySettings());
  try {
    const { frozen } = await buildSyntheticCorpus();
    const ws = workspace();
    const events: JournalEvent[] = [];
    const run = await runBenchmarkTool({
      cwd: ws,
      frozenPath: writeFrozenFile(frozen),
        expectedDigest: frozen.digest,
      params: { ...studyParams() },
      delegate: syntheticCallLlmDelegate({ frozen }),
      events,
    });
    const text = run.result.content[0].type === "text" ? run.result.content[0].text : "";
    // The result text cites the saved report inside the workspace.
    const match = text.match(/\.search\/[^\s)]+\/report\.md/);
    assert.ok(match, "result text cites a .search report path");
    const cited = join(ws, match[0]);
    assert.ok(existsSync(cited), `cited report path resolves: ${cited}`);
    const cacheDir = singleCacheDir(ws);
    assert.ok(existsSync(join(cacheDir, "sources")));
    const sources = readdirSync(join(cacheDir, "sources"));
    assert.ok(sources.length >= frozen.extractionInputs.length, "source files were written");
  } finally {
    agent.restore();
  }
});

// ── Review regressions (F2, F4, F11) ─────────────────────────────────────

/**
 * Adapter+core harness: the real research() pipeline with frozen adapters
 * over an IN-MEMORY tampered corpus. Load-time verification is bypassed by
 * construction, which is exactly how baseline drift between capture and
 * replay would surface: the tampered multiset is what the adapter enforces.
 */
async function runCoreWithFrozen(args: {
  frozen: FrozenInputs;
  delegate: typeof callLlm;
}): Promise<{ outcome: string; events: JournalEvent[]; delegateCalls: number }> {
  const corpus = args.frozen;
  const events: JournalEvent[] = [];
  const journal = { record: (event: JournalEvent) => events.push(event) };
  const latch = createInputControlLatch();
  const delegateCalls: Array<{ systemPrompt: string }> = [];
  // Live downstream path: the raw callLlm-shaped delegate, with every call
  // recorded so tests can assert what actually reached the "provider".
  const liveDelegate: import("../src/core/contracts.js").ModelClient = {
    preflight: async () => [],
    complete: async (request) => {
      delegateCalls.push({ systemPrompt: request.systemPrompt });
      const text = await (args.delegate as unknown as (
        ctx: unknown,
        config: unknown,
        systemPrompt: string,
        userMessage: string,
      ) => Promise<string>)(undefined, request.model, request.systemPrompt, request.userMessage);
      return { text, citations: [] };
    },
  };
  const ws = workspace();
  const context = {
    settings: corpus.settings,
    models: createFrozenModelClient({ delegate: liveDelegate, frozen: corpus, journal, latch }),
    paths: resolveWorkspacePaths(ws, (corpus.settings as ReturnType<typeof studySettings>).cacheDir),
    identity: { name: "rh-test", version: "0.0.0", adapter: "pi" as const },
    logger: { error: () => {}, warn: () => {} },
  };
  const result = await research({ ...studyParams() }, context as never, {
    fetchPages: createFrozenFetchPages({ frozen: corpus, journal, latch: createInputControlLatch() }),
    downloadLlmsFullToCache: createForbidLlmsFull({ journal, latch: createInputControlLatch() }),
  });
  return { outcome: result.outcome, events, delegateCalls: delegateCalls.length };
}

test("F2: a fully mismatched extraction multiset stops all live delegation; the core still swallows", async () => {
  const { frozen } = await buildSyntheticCorpus();
  const tampered = structuredClone(frozen);
  for (const input of tampered.extractionInputs) input.userMessageSha256 = "0".repeat(64);
  // Every extraction request mismatches: none is delegated, the latch sets,
  // later requests are refused, and the core records all extractions failed.
  const run = await runCoreWithFrozen({
    frozen: tampered,
    delegate: syntheticCallLlmDelegate({ frozen }),
  });
  assert.equal(run.outcome, "extraction-failed"); // the core swallowed the page errors
  assert.equal(run.delegateCalls, 0); // nothing was ever delegated live
  assert.ok(run.events.some((e) => e.kind === "extract-hash-mismatch"));
  assert.ok(run.events.some((e) => e.kind === "input-control-latched"));
  const settled = settleInputIntegrity({ frozen: tampered, events: run.events });
  assert.equal(settled.matched, false);
});

test("F2: a partial mismatch refuses the later collation before delegation", async () => {
  const { frozen } = await buildSyntheticCorpus();
  const tampered = structuredClone(frozen);
  // Page 0 consumes and delegates; page 1 mismatches; the remaining pages and
  // collation are refused by the latch BEFORE any live delegation.
  tampered.extractionInputs[1].userMessageSha256 = "1".repeat(64);
  await assert.rejects(
    runCoreWithFrozen({ frozen: tampered, delegate: syntheticCallLlmDelegate({ frozen }) }),
    FrozenIntegrityError,
  );
});

test("F2: registration raises after the core swallows a rejected cache-suggestion judge", async () => {
  const agent = isolateAgentEnv(studySettings());
  try {
    const { frozen } = await buildSyntheticCorpus();
    // A workspace with a pre-existing unrelated index entry makes the cache
    // suggest judge fire; the adapter rejects it, the core swallows the
    // rejection, and the registration must still fail the run.
    const ws = workspace();
    const searchRoot = join(ws, ".search");
    mkdirSync(searchRoot, { recursive: true });
    writeFileSync(join(searchRoot, ".index.json"), JSON.stringify({
      searches: [{ slug: "2026-11-04-unrelated-abc123", query: "an unrelated prior search", timestamp: "2026-11-04T00:00:00.000Z" }],
    }));
    const events: JournalEvent[] = [];
    await assert.rejects(
      runBenchmarkTool({
        cwd: ws,
        frozenPath: writeFrozenFile(frozen),
        expectedDigest: frozen.digest,
        params: { ...studyParams() },
        delegate: syntheticCallLlmDelegate({ frozen }),
        events,
      }),
      /input control failed during execution/,
    );
    assert.ok(events.some((e) => e.kind === "cache-suggest-rejected"));
    const result = events.find((e) => e.kind === "research-result");
    assert.ok(result, "the swallowed core result is still journaled as evidence");
    assert.equal(result.data.outcome, "completed");
    assert.ok(events.some((e) => e.kind === "input-control-failed"));
    const settled = settleInputIntegrity({ frozen, events });
    assert.equal(settled.matched, false); // the deviation is a real input mismatch
    assert.equal(settled.complete, true); // while the execution itself ran
  } finally {
    agent.restore();
  }
});

test("F4: an all-extraction provider failure is not an input mismatch", async () => {
  const agent = isolateAgentEnv(studySettings());
  try {
    const { frozen } = await buildSyntheticCorpus();
    // The live downstream provider fails every extraction: inputs still match.
    const failingDelegate = (async (_ctx: unknown, _config: unknown, systemPrompt: string) => {
      if (systemPrompt.includes("extraction assistant")) {
        throw new Error("synthetic provider 503");
      }
      return syntheticCallLlmDelegate({ frozen })(undefined as never, undefined as never, systemPrompt, "");
    }) as unknown as typeof callLlm;
    const ws = workspace();
    const events: JournalEvent[] = [];
    const run = await runBenchmarkTool({
      cwd: ws,
      frozenPath: writeFrozenFile(frozen),
      expectedDigest: frozen.digest,
      params: { ...studyParams() },
      delegate: failingDelegate,
      events,
    });
    // The degraded result is RETURNED, not thrown: a provider failure is not
    // an input deviation. nativeResult keeps the details record; the outcome
    // travels in the journal's research-result event.
    assert.equal((run.result.details as Record<string, unknown>).extractionFailed, frozen.extractionInputs.length);
    const result = events.find((e) => e.kind === "research-result");
    assert.equal(result?.data.outcome, "extraction-failed");
    assert.equal(events.some((e) => e.kind === "input-control-failed"), false);
    const settled = settleInputIntegrity({ frozen, events });
    assert.equal(settled.matched, true);
    assert.deepEqual(settled.problems, []);
    assert.equal(settled.complete, false);
    assert.ok(settled.completenessProblems.some((p) => p.includes("extraction-failed")));
  } finally {
    agent.restore();
  }
});

test("F11: a changed corpus digest at registration is rejected before any work", async () => {
  const agent = isolateAgentEnv(studySettings());
  try {
    const { frozen } = await buildSyntheticCorpus();
    const events: JournalEvent[] = [];
    const calls: Array<{ systemPrompt: string; userMessage: string }> = [];
    await assert.rejects(
      runBenchmarkTool({
        cwd: workspace(),
        frozenPath: writeFrozenFile(frozen),
        expectedDigest: "0".repeat(64), // not the bound digest
        params: { ...studyParams() },
        delegate: syntheticCallLlmDelegate({ frozen, calls }),
        events,
      }),
      /digest binding/,
    );
    assert.equal(calls.length, 0);
    const mismatch = events.find((e) => e.kind === "corpus-digest-mismatch");
    assert.ok(mismatch);
    assert.equal(mismatch.data.servedDigest, frozen.digest);
    assert.equal(mismatch.data.expectedDigest, "0".repeat(64));
    const settled = settleInputIntegrity({ frozen, events });
    assert.equal(settled.matched, false);
  } finally {
    agent.restore();
  }
});
