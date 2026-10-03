// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
// Characterise native behaviour before extraction. No live model or page calls.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mock } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import extension from "../../src/index.js";
import * as prompts from "../../src/prompts.js";
import { clearMigrationContext, invalidateSettingsCache } from "../../src/settings.js";
import { _resetVersionCacheForTests } from "../../src/telemetry.js";
import { intelliSearchTool } from "../../src/tools/intelli-search.js";
import { intelliExtractTool } from "../../src/tools/intelli-extract.js";
import { intelliCollateTool } from "../../src/tools/intelli-collate.js";
import { intelliResearchTool, __harness } from "../../src/tools/intelli-research.js";
import type { FetchedPage } from "../../src/types.js";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
export const FIXTURES = join(REPO, "test/fixtures/native-contract");
export const SCENARIOS = [
  "search",
  "extract",
  "collate",
  "research",
  "partial-research",
  "no-links",
  "fetch-failed",
  "extraction-failed",
] as const;
export type Scenario = (typeof SCENARIOS)[number];
const FIXED_NOW = Date.UTC(2026, 0, 2);
const QUERY = "Fixture research";
const URLS = ["https://example.com/a", "https://example.org/b", "https://example.net/c"];
const SEARCH = `Fixture answer.\n\n## Sources\n[A](${URLS[0]})\n[B](${URLS[1]})`;
const EXTRACTION = "Official docs, current 2026.\n\nUse `fixture()` for the example.";
const COLLATION =
  "## Summary\n\nFixture synthesis.\n\n## Source assessment\n\nTwo relevant sources.";
const PRIOR_SLUG = "2026-01-01-prior-fixture-abcdef";

function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function response(model: string, text: string, errorMessage?: string): AssistantMessage {
  return {
    role: "assistant",
    api: "openai-completions",
    provider: "openrouter",
    model,
    content: errorMessage ? [] : [{ type: "text", text }],
    stopReason: errorMessage ? "error" : "stop",
    errorMessage,
    timestamp: Date.now(),
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

export function captureToolContracts(): unknown {
  const tools: unknown[] = [];
  const events: string[] = [];
  extension({
    registerTool(tool: Record<string, unknown>) {
      const { execute, renderResult, ...data } = tool;
      assert.equal(typeof execute, "function");
      tools.push({ ...data, hasRenderResult: typeof renderResult === "function" });
    },
    on(event: string) {
      events.push(event);
    },
  } as unknown as ExtensionAPI);
  return plain({ tools, events });
}

export function capturePrompts(): unknown {
  return plain(prompts);
}

async function cacheFiles(root: string, version: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function walk(relative: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(join(root, relative), { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const path = join(relative, entry.name);
      if (entry.isDirectory()) await walk(path);
      else {
        let text = await readFile(join(root, path), "utf8");
        if (entry.name === "meta.json") {
          const meta = JSON.parse(text);
          // Assert the real value before normalising only the release identity.
          assert.equal(meta.extensionVersion, version);
          assert.equal(meta.durationMs, 0, "Date is frozen; latency must be deterministic");
          meta.extensionVersion = "<PACKAGE_VERSION>";
          text = JSON.stringify(meta, null, 2) + "\n";
        }
        result[path.replaceAll("\\", "/")] = text;
      }
    }
  }
  await walk(".search");
  return result;
}

// One scenario per isolated directory. The test file runs these serially because
// the original implementation has global harness/settings/clock state. This is
// a baseline harness, not a concurrency design for the future shared engine.
export async function captureOperation(
  scenario: Scenario,
  options: { separateProcessCwd?: boolean } = {},
): Promise<unknown> {
  const scratch = join(REPO, ".tmp");
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, "native-contract-"));
  const previousCwd = process.cwd();
  const previousAgent = process.env.PI_CODING_AGENT_DIR;
  const previousFetch = globalThis.fetch;
  const previousPageFetch = __harness.fetchPages;
  const diagnostics: string[] = [];
  const calls: unknown[] = [];
  const updates: unknown[] = [];
  const indicators: unknown[] = [];
  let searchCalls = 0;
  let pageCalls = 0;
  let clockEnabled = false;
  let consoleMock: ReturnType<typeof mock.method> | undefined;
  try {
    const agent = join(root, "agent");
    await mkdir(agent);
    process.env.PI_CODING_AGENT_DIR = agent;
    const processDir = options.separateProcessCwd ? join(root, "launcher") : root;
    await mkdir(processDir, { recursive: true });
    process.chdir(processDir);
    invalidateSettingsCache();
    clearMigrationContext();
    _resetVersionCacheForTests();
    await writeFile(
      join(agent, "settings.json"),
      JSON.stringify({
        "pi-intelli-search": {
          searchModel: { provider: "openrouter", model: "fixture-search" },
          extractModel: { provider: "openrouter", model: "fixture-extract" },
          collateModel: { provider: "openrouter", model: "fixture-collate" },
          defaultUrls: 2,
          maxUrls: 3,
          extractionConcurrency: 1,
          extractMaxChars: 40,
          extractionMaxTokens: 123,
          collationMaxTokens: 234,
          searchRetryAttempts: 1,
          llmRetryAttempts: 1,
          disableLlmsFullDiscovery: true,
          searchWebSearch: { enabled: true, engine: "auto", maxResults: 3, reasoning: "minimal" },
        },
      }),
    );
    const version = JSON.parse(await readFile(join(REPO, "package.json"), "utf8")).version;
    mock.timers.enable({ apis: ["Date"], now: FIXED_NOW });
    clockEnabled = true;
    consoleMock = mock.method(console, "error", (...args: unknown[]) => {
      diagnostics.push(args.map(String).join(" "));
    });
    globalThis.fetch = async (input) => {
      assert.equal(
        String(input),
        "https://fixture.invalid/completion",
        "unexpected network request",
      );
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                annotations: [
                  { type: "url_citation", url_citation: { url: URLS[0], title: "Duplicate A" } },
                  { type: "url_citation", url_citation: { url: URLS[2], title: "Annotation C" } },
                ],
              },
            },
          ],
        }),
        { headers: { "content-type": "application/json" } },
      );
    };
    const pages: FetchedPage[] = URLS.map((url, i) => ({
      url,
      title: ["Page A", "Page B", "Page C"][i],
      content: `Page ${i + 1} fixture content with a deliberately long truncation boundary.`,
      status: "success",
      source: i === 1 ? "markdown" : "defuddle",
    }));
    __harness.fetchPages = async (urls, _signal, options) => {
      pageCalls++;
      calls.push({ fetch: urls, options });
      return urls.map((url) => {
        const page = pages.find((p) => p.url === url);
        assert.ok(page, `unexpected fetched URL: ${url}`);
        return scenario === "fetch-failed" || (scenario === "partial-research" && url === URLS[1])
          ? { ...page, content: "", status: "error", error: "fixture blocked" }
          : { ...page };
      });
    };
    const complete = async (
      model: { id: string },
      context: Context,
      options?: SimpleStreamOptions,
    ) => {
      const prompt = Object.entries(prompts).find(([, text]) => text === context.systemPrompt)?.[0];
      assert.ok(prompt, "unexpected system prompt");
      const message = context.messages[0];
      assert.equal(message.role, "user");
      const payload = options?.onPayload
        ? await options.onPayload({ model: model.id }, model as Model<Api>)
        : undefined;
      calls.push({
        prompt,
        model: model.id,
        messages: context.messages,
        maxTokens: options?.maxTokens,
        reasoning: options?.reasoning,
        maxRetries: options?.maxRetries,
        payload,
      });
      let text: string;
      if (prompt === "SEARCH_SYSTEM_PROMPT") {
        searchCalls++;
        text = scenario === "no-links" ? "Fixture answer without sources." : SEARCH;
        if (scenario !== "no-links") {
          assert.ok(options?.fetch, "citation-harvesting fetch must be installed");
          const response = await options.fetch("https://fixture.invalid/completion");
          await response.text();
        }
      } else if (prompt === "EXTRACTION_SYSTEM_PROMPT") {
        if (scenario === "extraction-failed") {
          return response(model.id, "", "fixture extraction refused");
        }
        text = EXTRACTION;
      } else if (prompt === "COLLATION_SYSTEM_PROMPT") text = COLLATION;
      else text = '[{"index":1,"relevance":"Related fixture"}]';
      return response(model.id, text);
    };
    const ctx = {
      cwd: root,
      hasUI: false,
      isProjectTrusted: () => false,
      ui: { setWorkingIndicator: (value?: unknown) => indicators.push(value ?? null) },
      modelRegistry: {
        find: (provider: string, id: string) => ({ provider, id }),
        getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "fixture-not-a-real-key" }),
        getProvider: () => ({
          streamSimple: () => {
            throw new Error("unexpected legacy dispatch");
          },
        }),
        streamSimple: (model: { id: string }, context: Context, options?: SimpleStreamOptions) => ({
          result: () => complete(model, context, options),
        }),
      },
    } as unknown as ExtensionContext;
    const signal = new AbortController().signal;
    const onUpdate = (value: unknown) => {
      updates.push(plain(value));
    };
    let result: unknown;
    if (scenario === "search") {
      result = await intelliSearchTool.execute(
        "fixture",
        { query: QUERY, domains: ["example.com"] },
        signal,
        onUpdate,
        ctx,
      );
    } else if (scenario === "extract") {
      result = await intelliExtractTool.execute(
        "fixture",
        {
          query: QUERY,
          url: URLS[0],
          title: "Page A",
          content: pages[0].content,
          focusPrompt: "Preserve fixture details.",
        },
        signal,
        onUpdate,
        ctx,
      );
    } else if (scenario === "collate") {
      result = await intelliCollateTool.execute(
        "fixture",
        {
          query: QUERY,
          searchSummary: "Fixture answer.",
          extractions: [
            {
              url: URLS[0],
              title: "Page A",
              extraction: EXTRACTION,
              sourceType: "official docs",
              status: "success",
            },
            {
              url: URLS[1],
              title: "Page B",
              extraction: "",
              sourceType: "unknown",
              status: "blocked",
            },
          ],
          fullPages: [pages[0]],
        },
        signal,
        onUpdate,
        ctx,
      );
    } else {
      if (scenario === "research") {
        await mkdir(join(root, ".search"));
        await writeFile(
          join(root, ".search/.index.json"),
          JSON.stringify({
            searches: [
              {
                slug: PRIOR_SLUG,
                query: "Prior fixture",
                timestamp: "2026-01-01T00:00:00.000Z",
              },
            ],
          }),
        );
      }
      result = await intelliResearchTool.execute(
        "fixture",
        {
          query: QUERY,
          maxUrls: 99,
          domains: ["example.com"],
          focusPrompt: "Preserve fixture details.",
        },
        signal,
        onUpdate,
        ctx,
      );
      assert.deepEqual(indicators.at(-1), null, "working indicator must be cleared");
    }
    if (scenario !== "extract" && scenario !== "collate") assert.equal(searchCalls, 1);
    if (["search", "extract", "collate", "no-links"].includes(scenario)) assert.equal(pageCalls, 0);
    else assert.equal(pageCalls, 1);
    const files = await cacheFiles(root, version);
    if (options.separateProcessCwd) {
      assert.deepEqual(await readdir(processDir), [], "operation must not write into launcher cwd");
    }
    // Full file inventory is captured, including unexpected residue. Only the
    // emitting package version is normalised; paths, dates and text are stable.
    return plain({ result, calls, updates, indicators, diagnostics, files });
  } finally {
    consoleMock?.mock.restore();
    if (clockEnabled) mock.timers.reset();
    globalThis.fetch = previousFetch;
    __harness.fetchPages = previousPageFetch;
    process.chdir(previousCwd);
    if (previousAgent === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgent;
    invalidateSettingsCache();
    clearMigrationContext();
    _resetVersionCacheForTests();
    await rm(root, { recursive: true, force: true });
  }
}

export async function writeFixture(name: string, value: unknown): Promise<void> {
  const path = join(FIXTURES, `${name}.json`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n");
}
