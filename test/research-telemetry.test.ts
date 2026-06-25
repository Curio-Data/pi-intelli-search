// test/research-telemetry.test.ts
//
// Orchestrator-level wiring tests for the telemetry sidecar. Drives the real
// intelliResearchTool.execute() with the two I/O collaborators (callLlm,
// fetchPages) swapped via the __harness seam, so the per-stage values the
// sidecar records are asserted against the real computation in the
// orchestrator, not just the builder. No LLM/network calls.
//
// Covers the brief's Success Criterion: disableTelemetry:true suppresses the
// sidecar end-to-end, plus the degraded early-return paths that now also write
// a sidecar with an outcome set.
//
// Isolation: each test swaps __harness, sets PI_CODING_AGENT_DIR to a temp
// agent dir, AND chdirs to a temp cwd (the cache path is relative to
// process.cwd(), per AGENTS.md "working-directory isolation pattern").
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { intelliResearchTool, __harness } from "../src/tools/intelli-research.js";
import { invalidateSettingsCache } from "../src/settings.js";
import {
  SEARCH_SYSTEM_PROMPT,
  EXTRACTION_SYSTEM_PROMPT,
  COLLATION_SYSTEM_PROMPT,
  CACHE_SUGGEST_PROMPT,
} from "../src/prompts.js";
import type { FetchedPage } from "../src/types.js";
import type { TelemetryMeta } from "../src/telemetry.js";

// A markdown link the search extractor (util.extractSourceUrls) will pick up.
const SEARCH_WITH_LINKS =
  "Answer.\n\n[Example](https://example.com/page1)\n\n[Other](https://example.com/page2)\n";
const SEARCH_NO_LINKS = "Answer with no markdown links at all.";

const EXTRACT_OUT = "Extracted relevant content.";
const COLLATE_OUT = "Collated summary.";
const JUDGE_OUT = "[]"; // no related matches

function makePage(url: string, source: string): FetchedPage {
  return {
    url,
    title: "Title " + url,
    content: "x".repeat(5000),
    status: "success",
    source,
  };
}

interface CtxLike {
  cwd: string;
  hasUI: boolean;
  ui: { setWorkingIndicator?(opts?: unknown): void };
  modelRegistry: { find(provider: string, modelId: string): unknown };
}

function makeCtx(cwd: string): CtxLike {
  return {
    cwd,
    hasUI: false,
    ui: { setWorkingIndicator: () => {} },
    modelRegistry: { find: () => ({ provider: "openrouter", id: "stub" }) },
  };
}

/** Read meta.json from the single .search/<slug>/ directory under cwd, or null. */
async function readMeta(cwd: string): Promise<TelemetryMeta | null> {
  const root = join(cwd, ".search");
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      const raw = await readFile(join(root, e.name, "meta.json"), "utf-8");
      return JSON.parse(raw) as TelemetryMeta;
    } catch {
      /* not in this dir */
    }
  }
  return null;
}

describe("intelli_research telemetry wiring", () => {
  let savedAgentDir: string | undefined;
  let savedCwd: string;
  let savedHarnessCallLlm: typeof __harness.callLlm;
  let savedHarnessFetchPages: typeof __harness.fetchPages;

  before(() => {
    savedAgentDir = process.env.PI_CODING_AGENT_DIR;
    savedCwd = process.cwd();
    savedHarnessCallLlm = __harness.callLlm;
    savedHarnessFetchPages = __harness.fetchPages;
  });

  after(() => {
    if (savedAgentDir !== undefined) process.env.PI_CODING_AGENT_DIR = savedAgentDir;
    else delete process.env.PI_CODING_AGENT_DIR;
    process.chdir(savedCwd);
    __harness.callLlm = savedHarnessCallLlm;
    __harness.fetchPages = savedHarnessFetchPages;
    invalidateSettingsCache();
  });

  it("writes no meta.json when disableTelemetry is true (suppression)", async () => {
    const env = await isolatedEnv({ disableTelemetry: true });
    try {
      stubHarness({
        search: SEARCH_WITH_LINKS,
        pages: [makePage("https://example.com/page1", "defuddle")],
      });
      const res = await intelliResearchTool.execute(
        "tc1",
        { query: "suppression test", maxUrls: 1 },
        undefined,
        undefined,
        makeCtx(env.cwd) as any,
      );
      assert.ok(res, "execute returned a result");
      assert.equal(await readMeta(env.cwd), null, "meta.json written under disableTelemetry");
    } finally {
      restore(env);
    }
  });

  it("records outcome=completed with real per-stage values", async () => {
    const env = await isolatedEnv({ disableTelemetry: false });
    try {
      stubHarness({
        search: SEARCH_WITH_LINKS,
        pages: [
          makePage("https://example.com/page1", "defuddle"),
          makePage("https://example.com/page2", "markdown"),
        ],
      });
      await intelliResearchTool.execute(
        "tc2",
        { query: "happy path wiring", maxUrls: 2 },
        undefined,
        undefined,
        makeCtx(env.cwd) as any,
      );
      const meta = await readMeta(env.cwd);
      assert.ok(meta, "meta.json not written on happy path");
      assert.equal(meta!.outcome, "completed");
      assert.equal(meta!.stages.search.retryFired, false);
      assert.equal(meta!.stages.search.attempts, 1);
      assert.equal(meta!.stages.search.linksReturned, 2);
      assert.equal(meta!.stages.fetch.succeeded, 2);
      assert.equal(meta!.stages.fetch.failed, 0);
      assert.deepStrictEqual(meta!.stages.fetch.winners, { defuddle: 1, markdown: 1 });
      assert.equal(meta!.stages.extract.succeeded, 2);
      assert.ok(meta!.stages.extract.totalInputCharsApprox > 0, "input chars approx populated");
      assert.ok(meta!.stages.extract.totalOutputChars > 0);
      assert.ok(meta!.stages.collate.summaryChars > 0);
      // Empty index in temp dir => judge skipped, ran=false.
      assert.equal(meta!.stages.cacheSuggest.ran, false);
      assert.equal(meta!.stages.cacheSuggest.surfaced, 0);
    } finally {
      restore(env);
    }
  });

  it("records search retryFired=true when the first search yields no links", async () => {
    const env = await isolatedEnv({ disableTelemetry: false, searchRetryAttempts: 3, retryBaseDelayMs: 1 });
    try {
      let searchCall = 0;
      __harness.callLlm = ((...args: any[]) => {
        const sysPrompt = args[2] as string;
        if (sysPrompt === SEARCH_SYSTEM_PROMPT) {
          searchCall++;
          return Promise.resolve(searchCall === 1 ? SEARCH_NO_LINKS : SEARCH_WITH_LINKS);
        }
        return resolveByPrompt(sysPrompt);
      }) as any;
      __harness.fetchPages = (() =>
        Promise.resolve([makePage("https://example.com/page1", "defuddle")])) as any;
      await intelliResearchTool.execute(
        "tc3",
        { query: "retry wiring", maxUrls: 1 },
        undefined,
        undefined,
        makeCtx(env.cwd) as any,
      );
      const meta = await readMeta(env.cwd);
      assert.ok(meta);
      assert.equal(meta!.outcome, "completed");
      assert.equal(meta!.stages.search.retryFired, true);
      assert.equal(meta!.stages.search.attempts, 2);
      assert.equal(meta!.stages.search.linksReturned, 1); // clamped by maxUrls:1
    } finally {
      restore(env);
    }
  });

  it("writes outcome=no-links sidecar on the degraded no-links path", async () => {
    const env = await isolatedEnv({ disableTelemetry: false, searchRetryAttempts: 1 });
    try {
      stubHarness({ search: SEARCH_NO_LINKS, pages: [] });
      await intelliResearchTool.execute(
        "tc4",
        { query: "no links degraded", maxUrls: 1 },
        undefined,
        undefined,
        makeCtx(env.cwd) as any,
      );
      const meta = await readMeta(env.cwd);
      assert.ok(meta, "degraded no-links run wrote no sidecar");
      assert.equal(meta!.outcome, "no-links");
      assert.equal(meta!.stages.search.linksReturned, 0);
      assert.equal(meta!.stages.search.retryFired, false);
    } finally {
      restore(env);
    }
  });

  it("writes outcome=fetch-failed sidecar when every page fails to fetch", async () => {
    const env = await isolatedEnv({ disableTelemetry: false });
    try {
      __harness.callLlm = ((_ctx: any, _cfg: any, sysPrompt: string) =>
        sysPrompt === SEARCH_SYSTEM_PROMPT ? Promise.resolve(SEARCH_WITH_LINKS) : resolveByPrompt(sysPrompt)) as any;
      __harness.fetchPages = (() =>
        Promise.resolve([
          { url: "https://example.com/x", title: "", content: "", status: "error", error: "boom" },
        ] as unknown as FetchedPage[])) as any;
      await intelliResearchTool.execute(
        "tc5",
        { query: "fetch failed degraded", maxUrls: 1 },
        undefined,
        undefined,
        makeCtx(env.cwd) as any,
      );
      const meta = await readMeta(env.cwd);
      assert.ok(meta, "degraded fetch-failed run wrote no sidecar");
      assert.equal(meta!.outcome, "fetch-failed");
      assert.equal(meta!.stages.fetch.succeeded, 0);
      assert.equal(meta!.stages.fetch.failed, 1);
    } finally {
      restore(env);
    }
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function resolveByPrompt(sysPrompt: string): Promise<string> {
  if (sysPrompt === EXTRACTION_SYSTEM_PROMPT) return Promise.resolve(EXTRACT_OUT);
  if (sysPrompt === COLLATION_SYSTEM_PROMPT) return Promise.resolve(COLLATE_OUT);
  if (sysPrompt === CACHE_SUGGEST_PROMPT) return Promise.resolve(JUDGE_OUT);
  return Promise.resolve("");
}

function stubHarness(opts: { search: string; pages: FetchedPage[] }): void {
  __harness.callLlm = ((_ctx: any, _cfg: any, sysPrompt: string) => {
    if (sysPrompt === SEARCH_SYSTEM_PROMPT) return Promise.resolve(opts.search);
    return resolveByPrompt(sysPrompt);
  }) as any;
  __harness.fetchPages = (() => Promise.resolve(opts.pages)) as any;
}

interface Env {
  cwd: string;
  agentDir: string;
  prevCwd: string;
}

/** Create an isolated PI_CODING_AGENT_DIR + temp cwd with .pi/settings.json,
 * and chdir into the temp cwd so the relative cache path resolves there. */
async function isolatedEnv(settings: Record<string, unknown>): Promise<Env> {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-intelli-wire-agent-"));
  const cwd = await mkdtemp(join(tmpdir(), "pi-intelli-wire-cwd-"));
  const prevCwd = process.cwd();
  process.env.PI_CODING_AGENT_DIR = agentDir;
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await writeFile(
    join(cwd, ".pi", "settings.json"),
    JSON.stringify({ "pi-intelli-search": settings }),
    "utf-8",
  );
  invalidateSettingsCache();
  process.chdir(cwd);
  return { cwd, agentDir, prevCwd };
}

function restore(env: Env): void {
  process.chdir(env.prevCwd);
  invalidateSettingsCache();
}
