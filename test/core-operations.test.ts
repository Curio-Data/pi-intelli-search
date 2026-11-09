// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { search, extract, collate, research, MissingModelsError } from "../src/core/index.js";
import type { ResearchDependencies } from "../src/core/operations/research.js";
import { cacheLockDir, makeCachePath, readIndex, withLock } from "../src/core/cache.js";
import { isCollationFailureReport } from "../src/core/provenance.js";
import { coreContext } from "./helpers/core-context.js";
import type { OperationProgress } from "../src/core/contracts.js";

async function workspace(t: { after(fn: () => Promise<void>): void }) {
  const root = resolve(".tmp");
  await mkdir(root, { recursive: true });
  const path = await mkdtemp(join(root, "core-operations-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

it("runs all four operations with per-instance dependencies and no host context", async (t) => {
  const root = await workspace(t);
  const { context, dependencies, requests } = coreContext(root);
  const result = await search({ query: "standalone", domains: ["docs.example"] }, context);
  assert.equal(result.outcome, "completed");
  assert.equal((result.details.sources as unknown[]).length, 2);
  assert.match(requests[0].userMessage, /site:docs.example/);
  const extracted = await extract(
    {
      url: "https://one.example",
      title: "One",
      content: "body",
      query: "test",
      focusPrompt: "Focus",
    },
    context,
  );
  assert.equal(extracted.details.sourceType, "official docs");
  assert.equal(extracted.details.currentness, "current");
  assert.match(requests[1].userMessage, /Focus: Focus/);
  const collated = await collate(
    {
      query: "collate",
      extractions: [
        {
          url: "https://one.example",
          title: "One",
          extraction: "body",
          sourceType: "docs",
          status: "success",
        },
      ],
    },
    context,
  );
  assert.match(collated.text, /Summary/);
  const stages: OperationProgress[] = [];
  const completed = await research(
    { query: "research" },
    {
      ...context,
      onProgress: (p) => {
        stages.push(p);
      },
    },
    dependencies,
  );
  assert.equal(completed.outcome, "completed");
  assert.equal(stages[0].stage, "search");
  assert.equal(stages.at(-1)?.stage, "cache");
  assert.equal(stages.filter((p) => p.stage === "extract").at(-1)?.subProgress?.current, 2);
  const meta = JSON.parse(
    await readFile(join(root, completed.details.cachePath as string, "meta.json"), "utf8"),
  );
  assert.equal(meta.extensionVersion, "fixture-version");
  assert.equal(meta.packageName, context.identity.name);
  assert.equal(meta.adapter, "mcp");
  assert.equal((await readIndex(context.paths.cacheRoot)).searches.length, 2);
});

it("labels inferred guesses in intelli_search text and structured sources", async (t) => {
  const root = await workspace(t);
  const base = coreContext(root, { defaultUrls: 3, maxUrls: 3 });
  const complete = base.context.models.complete;
  base.context.models.complete = async (request) =>
    request.model.model === "search"
      ? {
          text: "Read [the guide](https://one.example/page), then inspect README.md and notion.so: a workspace tool.",
          citations: [],
        }
      : complete(request);
  const result = await search({ query: "search labels" }, base.context);
  assert.match(result.text, /\[the guide\]\(https:\/\/one\.example\/page\)\n/);
  assert.match(result.text, /\[readme\.md\]\(https:\/\/readme\.md\) \(inferred from text, not a citation; original token: README\.md\)/);
  assert.match(result.text, /\[notion\.so\]\(https:\/\/notion\.so\) \(inferred from text, not a citation; original token: notion\.so\)/);
  const sources = result.details.sources as Array<Record<string, unknown>>;
  assert.equal(sources[0].inferred, undefined);
  assert.deepEqual(sources.slice(1).map((source) => [source.originalReference, source.inferred]), [
    ["README.md", true],
    ["notion.so", true],
  ]);
});

it("keeps inferred file references, records asset fetch outcomes and saves code under sources", async (t) => {
  const root = await workspace(t);
  const base = coreContext(root, { defaultUrls: 3, maxUrls: 3 });
  const complete = base.context.models.complete;
  base.context.models.complete = async (request) => {
    if (request.model.model === "search") {
      return {
        text: "Read [the guide](https://one.example/page), then inspect manage.py and missing.py.",
        citations: [],
      };
    }
    return complete(request);
  };
  const dependencies: ResearchDependencies = {
    ...base.dependencies,
    fetchPages: async (urls) =>
      urls.map((url) => {
        if (url === "https://missing.py") {
          return {
            url,
            title: "",
            content: "",
            status: "error" as const,
            error: "HTTP 404: Not Found",
          };
        }
        const inferred = url !== "https://one.example/page";
        return {
          url,
          title: inferred ? "manage.py" : "Guide",
          content: inferred ? "print('asset body')\n" : "Guide body",
          status: "success" as const,
          source: inferred ? "text" : "defuddle",
          assetType: inferred ? ("code" as const) : ("page" as const),
          contentType: inferred ? "text/plain; charset=utf-8" : "text/html",
        };
      }),
  };
  const result = await research({ query: "inferred source assets" }, base.context, dependencies);
  assert.equal(result.outcome, "completed");
  assert.match(result.text, /## Inferred Assets/);
  assert.match(result.text, /manage\.py.*Code file.*text\/plain; charset=utf-8/);
  assert.match(result.text, /missing\.py.*Nothing fetched; see Failed Sources below/);
  assert.match(result.text, /\*\*Failed Sources\*\*:[\s\S]*https:\/\/missing\.py: HTTP 404: Not Found/);
  assert.match(result.text, /Inferred from text \(not a citation\); fetched and extracted/);
  const assets = result.details.inferredAssets as Array<Record<string, unknown>>;
  assert.deepEqual(assets.map((asset) => [asset.url, asset.outcome]), [
    ["https://manage.py", "code"],
    ["https://missing.py", "nothing"],
  ]);
  assert.equal(assets[0].sourceFile, "sources/02-manage-py.md");
  const cachePath = join(root, result.details.cachePath as string);
  const saved = await readFile(join(cachePath, "sources", "02-manage-py.md"), "utf8");
  assert.match(saved, /print\('asset body'\)/);
  assert.doesNotMatch(saved, /inferred/i);
  const report = await readFile(join(cachePath, "report.md"), "utf8");
  assert.match(report, /## Inferred Assets/);
  assert.match(report, /missing\.py.*Nothing fetched/);
  assert.match(report, /sources\/02-manage-py\.md/);
});

it("shows original tokens, redirect attribution and one bounded error per failed guess", async (t) => {
  const root = await workspace(t);
  const base = coreContext(root, { defaultUrls: 2, maxUrls: 2 });
  const complete = base.context.models.complete;
  base.context.models.complete = async (request) =>
    request.model.model === "search"
      ? { text: "Inspect README.md and Broken.py for the build steps.", citations: [] }
      : complete(request);
  const longError = `TRANSPORT_FAILURE ${"multiline detail\n".repeat(30)}`;
  const dependencies: ResearchDependencies = {
    ...base.dependencies,
    fetchPages: async (urls) => urls.map((url) =>
      url === "https://readme.md"
        ? {
            url,
            finalUrl: "https://downloads.example.net/raw/readme.txt",
            title: "readme.txt",
            content: "print('redirected code')",
            status: "success" as const,
            source: "text",
            assetType: "code" as const,
            contentType: "text/plain",
          }
        : {
            url,
            finalUrl: "https://static.example.net/broken.pdf",
            title: "",
            content: "",
            status: "error" as const,
            error: longError,
          }),
  };
  const result = await research({ query: "redirect attribution" }, base.context, dependencies);
  assert.equal(result.outcome, "completed");
  assert.match(result.text, /\| README\.md \| https:\/\/readme\.md \| Code file \(text\/plain\); redirected to a different host \(downloads\.example\.net\): https:\/\/downloads\.example\.net\/raw\/readme\.txt \|/);
  assert.match(result.text, /\| Broken\.py \| https:\/\/broken\.py \| Nothing fetched; see Failed Sources below; redirected to a different host \(static\.example\.net\): https:\/\/static\.example\.net\/broken\.pdf \| None \|/);
  assert.equal(result.text.match(/TRANSPORT_FAILURE/g)?.length, 1, "raw failure appears only in Failed Sources");
  assert.doesNotMatch(result.text, /multiline detail\nmultiline detail/);
  const assets = result.details.inferredAssets as Array<Record<string, unknown>>;
  assert.deepEqual(assets.map((asset) => [asset.originalReference, asset.url, asset.finalUrl, asset.redirectedToDifferentHost]), [
    ["README.md", "https://readme.md", "https://downloads.example.net/raw/readme.txt", true],
    ["Broken.py", "https://broken.py", "https://static.example.net/broken.pdf", true],
  ]);
  assert.equal((assets[1].error as string).length, 300);
  assert.ok((assets[1].error as string).endsWith("…"));
  const report = await readFile(join(root, result.details.cachePath as string, "report.md"), "utf8");
  assert.match(report, /README\.md \| https:\/\/readme\.md/);
  assert.match(report, /## Failed Sources/);
  assert.doesNotMatch(report, /## Blocked\/Failed URLs/);
  assert.match(report, /redirected to a different host \(downloads\.example\.net\): https:\/\/downloads\.example\.net/);
  assert.equal(report.match(/TRANSPORT_FAILURE/g)?.length, 1);
  assert.doesNotMatch(report, /multiline detail\nmultiline detail/);
  const reportFailure = report.match(/^- https:\/\/broken\.py: .*$/m)?.[0] ?? "";
  assert.ok(reportFailure.length <= 300 + "- https://broken.py: ".length);
  const saved = await readFile(join(root, result.details.cachePath as string, "sources", "01-readme-md.md"), "utf8");
  assert.match(saved, /> Source: https:\/\/readme\.md/);
  assert.match(saved, /> Final URL: https:\/\/downloads\.example\.net\/raw\/readme\.txt/);
});

it("keeps guessed identity and cross-host attribution for a selected alternate", async (t) => {
  const root = await workspace(t);
  const base = coreContext(root, { defaultUrls: 1, maxUrls: 1 });
  const complete = base.context.models.complete;
  base.context.models.complete = async (request) =>
    request.model.model === "search"
      ? { text: "Read guide.example.com/alternate for the answer.", citations: [] }
      : complete(request);
  const dependencies: ResearchDependencies = {
    ...base.dependencies,
    fetchPages: async (urls) => urls.map((url) => ({
      url,
      alternateUrl: "https://cdn.example.net/raw.md",
      finalUrl: "https://cdn.example.net/raw.md",
      title: "Alternate",
      content: "# Alternate\n\nUseful facts.",
      status: "success" as const,
      source: "markdown",
      assetType: "text" as const,
      contentType: "text/markdown",
    })),
  };
  const result = await research({ query: "alternate identity" }, base.context, dependencies);
  assert.equal(result.outcome, "completed");
  assert.match(result.text, /guide\.example\.com\/alternate \| Text file \(text\/markdown\); via alternate https:\/\/cdn\.example\.net\/raw\.md on a different host \(cdn\.example\.net\) \|/);
  assert.doesNotMatch(result.text, /redirected to a different host/);
  const [asset] = result.details.inferredAssets as Array<Record<string, unknown>>;
  assert.equal(asset.url, "https://guide.example.com/alternate");
  assert.equal(asset.alternateUrl, "https://cdn.example.net/raw.md");
  assert.equal(asset.finalUrl, "https://cdn.example.net/raw.md");
  assert.equal(asset.redirectedToDifferentHost, true);
  assert.equal(asset.sourceFile, "sources/01-guide-example-com.md");
  const saved = await readFile(
    join(root, result.details.cachePath as string, "sources", "01-guide-example-com.md"),
    "utf8",
  );
  assert.match(saved, /> Source: https:\/\/guide\.example\.com\/alternate/);
  assert.match(saved, /> Final URL: https:\/\/cdn\.example\.net\/raw\.md/);
});

it("labels inferred references and records nothing when every inferred fetch fails", async (t) => {
  const root = await workspace(t);
  const base = coreContext(root, { defaultUrls: 1, maxUrls: 1 });
  const complete = base.context.models.complete;
  base.context.models.complete = async (request) =>
    request.model.model === "search"
      ? { text: "Inspect manage.py for the answer.", citations: [] }
      : complete(request);
  const dependencies: ResearchDependencies = {
    ...base.dependencies,
    fetchPages: async (urls) => urls.map((url) => ({
      url,
      title: "",
      content: "",
      status: "error" as const,
      error: "Unsupported content type: application/octet-stream",
    })),
  };
  const result = await research({ query: "missing inferred asset" }, base.context, dependencies);
  assert.equal(result.outcome, "fetch-failed");
  assert.match(result.text, /manage\.py \[inferred from text, not a citation\]/);
  assert.match(result.text, /Unsupported content type: application\/octet-stream/);
  assert.deepEqual(result.details.inferredAssets, [{
    url: "https://manage.py",
    originalReference: "manage.py",
    outcome: "nothing",
    error: "Unsupported content type: application/octet-stream",
  }]);
});

it("rejects empty standalone extraction with an actionable budget message", async (t) => {
  const root = await workspace(t);
  const base = coreContext(root);
  const context = {
    ...base.context,
    models: {
      ...base.context.models,
      complete: async () => ({ text: "", citations: [], usage: { output: 100, reasoning: 100 } }),
    },
  };
  await assert.rejects(
    extract({ url: "https://one.example", title: "One", content: "body", query: "q" }, context),
    (error: Error) =>
      error.message.includes("no visible text") &&
      error.message.includes("extractionMaxTokens") &&
      error.message.includes("100/100") &&
      error.message.includes("100 hidden reasoning") &&
      error.message.includes("output budget was exhausted"),
  );
});

it("flags truncated standalone extraction instead of reporting it as complete", async (t) => {
  const root = await workspace(t);
  const base = coreContext(root);
  const context = {
    ...base.context,
    models: {
      ...base.context.models,
      complete: async () => ({
        text: "official docs, current\nExtracted partially",
        citations: [],
        usage: { output: 100 },
      }),
    },
  };
  const result = await extract(
    { url: "https://one.example", title: "One", content: "body", query: "q" },
    context,
  );
  assert.match(result.text, /reached extractionMaxTokens/);
  assert.match(result.text, /cut off mid-sentence/);
  assert.equal(result.details.truncated, true);
});

it("surfaces per-page failure reasons, saved sources and telemetry classification", async (t) => {
  const root = await workspace(t);
  // One retry at a doubled cap keeps this scenario about per-page reporting;
  // the retry schedule itself is covered by test/budget-retry.test.ts.
  const base = coreContext(root, { outputBudgetRetries: 1 });
  const exhaustedUsage = { output: 100, reasoning: 100 };
  // The extract fan-out is concurrent, so key the fixture on the number of
  // extract-model calls seen: the first page exhausts the budget with zero
  // visible text, the second extracts cleanly but its text is cut off at
  // the cap (both at usage.output === extractionMaxTokens = 100). The empty
  // page is retried once at a doubled cap (200), which also comes back empty.
  let extractCalls = 0;
  const complete = async (request: {
    model: { model: string };
    userMessage: string;
    maxTokens?: number;
  }) => {
    if (request.model.model === "search")
      return { text: "Answer. [One](https://one.example/page) [Two](https://two.example/page)", citations: [] };
    if (request.model.model === "collate") return { text: "Summary.", citations: [] };
    if (request.userMessage.startsWith("Current query:")) return { text: "[]", citations: [] };
    if (request.maxTokens === 200)
      return {
        text: "",
        citations: [],
        usage: { output: 200, reasoning: 200 },
        routeProvider: "FixtureRoute",
      };
    extractCalls += 1;
    if (extractCalls === 1)
      return { text: "", citations: [], usage: exhaustedUsage, routeProvider: "FixtureRoute" };
    return {
      text: "official docs, current\nExtracted.",
      citations: [],
      usage: { output: 100 },
      routeProvider: "FixtureRoute",
    };
  };
  const context = { ...base.context, models: { ...base.context.models, complete } };
  const result = await research({ query: "per-page diagnostics" }, context, base.dependencies);
  assert.equal(result.outcome, "completed");
  assert.equal(result.details.extractionFailed, 1);
  assert.match(result.text, /1 truncated at the output cap\), 1 failed/);
  assert.match(result.text, /\*\*Failed Sources\*\*:/);
  assert.match(result.text, /https:\/\/(one|two)\.example\/page: Output cap reached without visible text at 100 tokens and again after one retry up to 200 tokens/);
  assert.match(result.text, /full page saved: `[^`]+\/sources\/\d+-/);
  const meta = JSON.parse(
    await readFile(join(root, result.details.cachePath as string, "meta.json"), "utf8"),
  );
  assert.equal(meta.stages.extract.failureReasons.budgetExhausted, 1);
  assert.equal(meta.stages.extract.failureReasons.other, 0);
  assert.equal(meta.stages.extract.truncated, 1);
  assert.equal(meta.stages.extract.budgetRetries, 1);
  assert.equal(meta.stages.extract.provider, "FixtureRoute");
  const report = await readFile(join(root, result.details.cachePath as string, "report.md"), "utf8");
  assert.match(report, /⚠ truncated/);
  assert.match(report, /full page saved: sources\//);
});

it("keeps the adapter token counts when every extraction budget is exhausted", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { outputBudgetRetries: 2 });
  const complete = context.models.complete;
  context.models.complete = async (request) => {
    if (request.model.model === "extract") {
      throw new (await import("../src/core/util.js")).OutputBudgetExhaustedError(
        "OpenRouter exhausted the output budget without visible text (100 output tokens, 95 hidden reasoning) (the cap includes any reasoning tokens).",
      );
    }
    return complete(request);
  };
  const result = await research({ query: "adapter budget diagnostics" }, context, dependencies);
  assert.equal(result.outcome, "extraction-failed");
  assert.match(result.text, /100 output tokens, 95 hidden reasoning/);
  assert.match(result.text, /Output cap reached without visible text at 100 tokens and again after 2 retries up to 400 tokens/);
});

it("keeps native empty-length token counts and actionable advice", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { outputBudgetRetries: 2 });
  const complete = context.models.complete;
  context.models.complete = async (request) => {
    if (request.model.model === "extract") {
      const cap = request.maxTokens ?? 100;
      return {
        text: "",
        citations: [],
        finishReason: "length" as const,
        usage: { output: cap, reasoning: cap - 5 },
      };
    }
    return complete(request);
  };
  const result = await research({ query: "native empty-length diagnostics" }, context, dependencies);
  assert.equal(result.outcome, "extraction-failed");
  assert.match(result.text, /Raise extractionMaxTokens/);
  assert.match(result.text, /Last attempt: 400 output tokens, 395 hidden reasoning/);
});

it("uses neutral wording and the actual final attempt when reasoning is zero or attempts are mixed", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { outputBudgetRetries: 2 });
  const complete = context.models.complete;
  context.models.complete = async (request) => {
    if (request.model.model === "extract") {
      const cap = request.maxTokens ?? 100;
      return {
        text: "",
        citations: [],
        finishReason: "length" as const,
        usage: { output: cap, reasoning: 0 },
      };
    }
    return complete(request);
  };
  const zeroReasoning = await research({ query: "zero reasoning usage" }, context, dependencies);
  assert.match(zeroReasoning.text, /the output budget was exhausted without visible text/);
  assert.doesNotMatch(zeroReasoning.text, /hidden reasoning consumed every budget/);
  assert.match(zeroReasoning.text, /400 output tokens, 0 hidden reasoning/);

  let extractCalls = 0;
  context.models.complete = async (request) => {
    if (request.model.model !== "extract") return complete(request);
    extractCalls += 1;
    if (extractCalls === 1) {
      return {
        text: "",
        citations: [],
        finishReason: "length" as const,
        usage: { output: 100, reasoning: 95 },
      };
    }
    const cap = request.maxTokens ?? 400;
    throw new (await import("../src/core/util.js")).OutputBudgetExhaustedError(
      `OpenRouter exhausted the output budget without visible text (${cap} output tokens, ${cap - 5} hidden reasoning)`,
    );
  };
  const mixed = await research({ query: "mixed returned and thrown attempts" }, context, dependencies);
  assert.match(mixed.text, /Last attempt: 400 output tokens, 395 hidden reasoning/);
  assert.doesNotMatch(mixed.text, /Last attempt: 100 output tokens, 95 hidden reasoning/);
});

it("omits a zero output-token measurement from the diagnostic", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { outputBudgetRetries: 0 });
  const complete = context.models.complete;
  context.models.complete = async (request) =>
    request.model.model === "collate"
      ? {
          text: "",
          citations: [],
          finishReason: "length" as const,
          usage: { output: 0 },
        }
      : complete(request);
  const result = await research({ query: "zero output usage" }, context, dependencies);
  assert.equal(result.outcome, "collate-failed");
  assert.doesNotMatch(result.text, /Last attempt: 0 output tokens/);
  assert.match(result.text, /budget retries are disabled \(outputBudgetRetries is 0\)/);
});

it("keeps the setting and final counts on the truncated MCP diagnostic", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { outputBudgetRetries: 2 });
  const complete = context.models.complete;
  context.models.complete = async (request) => {
    if (request.model.model === "collate") {
      throw new (await import("../src/core/util.js")).OutputBudgetExhaustedError(
        "OpenRouter exhausted the output budget without visible text (400 output tokens, 395 hidden reasoning) (the cap includes any reasoning tokens). For extraction, review extractionMaxTokens; for synthesis, review collationMaxTokens. If this diagnostic came from search or cache suggestions, report the stage because those output caps are not exposed as tuning settings.",
      );
    }
    return complete(request);
  };
  const result = await research({ query: "MCP budget advice survives truncation" }, context, dependencies);
  assert.equal(result.outcome, "collate-failed");
  const failureLine = result.text.split("\n").find((line) => line.includes("Output cap reached without visible text")) ?? "";
  assert.ok(failureLine.length <= 300);
  assert.match(failureLine, /Raise collationMaxTokens/);
  assert.match(failureLine, /Last attempt: 400 output tokens, 395 hidden reasoning/);
  assert.doesNotMatch(failureLine, /Adapter diagnostic/);
});

it("counts fetch and extraction failures separately with fetch reasons in the appendix", async (t) => {
  const root = await workspace(t);
  const base = coreContext(root);
  const dependencies: ResearchDependencies = {
    ...base.dependencies,
    fetchPages: async (urls): Promise<import("../src/core/types.js").FetchedPage[]> =>
      urls.map((url) =>
        url.startsWith("https://one")
          ? {
              url,
              title: url,
              content: "Page body",
              status: "success",
              source: "markdown",
            }
          : {
              url,
              title: url,
              content: "",
              status: "error" as const,
              error: "HTTP 403 Forbidden",
            },
      ),
  };
  const context = {
    ...base.context,
    models: {
      ...base.context.models,
      complete: async (request: { model: { model: string }; userMessage: string }) => {
        if (request.model.model === "search")
          return { text: "Answer. [One](https://one.example/page) [Two](https://two.example/page)", citations: [] };
        return { text: "official docs, current\nExtracted.", citations: [] };
      },
    },
  };
  const result = await research({ query: "fetch vs extract failure accounting" }, context, dependencies);
  assert.equal(result.outcome, "completed");
  assert.equal(result.details.pagesFailed, 1, "the fetch failure");
  assert.equal(result.details.extractionFailed, 0, "no extraction ran for the failed page");
  // The failed-source line carries the fetch error, not a bare URL.
  assert.match(result.text, /https:\/\/two\.example\/page: HTTP 403 Forbidden/);
  const meta = JSON.parse(
    await readFile(join(root, result.details.cachePath as string, "meta.json"), "utf8"),
  );
  assert.equal(meta.stages.extract.failed, 0);
  assert.equal(meta.stages.fetch.failed, 1);
});

it("distinguishes a degraded cache judge from a valid zero-match verdict", async (t) => {
  const root = await workspace(t);
  // First run populates the index so the second run's judge has candidates.
  const first = coreContext(root);
  await research({ query: "first query" }, first.context, first.dependencies);
  const base = coreContext(root);
  const context = {
    ...base.context,
    models: {
      ...base.context.models,
      complete: async (request: { model: { model: string }; userMessage: string }) => {
        if (request.userMessage.startsWith("Current query:"))
          return { text: "", citations: [] };
        if (request.model.model === "search")
          return { text: "Answer. [One](https://one.example/page)", citations: [] };
        return { text: "official docs, current\nExtracted.", citations: [] };
      },
    },
  };
  const result = await research({ query: "second query" }, context, base.dependencies);
  const meta = JSON.parse(
    await readFile(join(root, result.details.cachePath as string, "meta.json"), "utf8"),
  );
  assert.equal(meta.stages.cacheSuggest.ran, true);
  assert.equal(meta.stages.cacheSuggest.surfaced, 0);
  assert.equal(meta.stages.cacheSuggest.degraded, true);
});

it("marks a thrown cache judge as degraded too, not only an empty response", async (t) => {
  const root = await workspace(t);
  // First run populates the index so the second run's judge has candidates.
  const first = coreContext(root);
  await research({ query: "first query" }, first.context, first.dependencies);
  const base = coreContext(root);
  const context = {
    ...base.context,
    models: {
      ...base.context.models,
      complete: async (request: { model: { model: string }; userMessage: string }) => {
        if (request.userMessage.startsWith("Current query:"))
          throw new Error("LLM call failed: timeout");
        if (request.model.model === "search")
          return { text: "Answer. [One](https://one.example/page)", citations: [] };
        return { text: "official docs, current\nExtracted.", citations: [] };
      },
    },
  };
  const result = await research({ query: "second query" }, context, base.dependencies);
  assert.equal(result.outcome, "completed", "judge failure never degrades research");
  const meta = JSON.parse(
    await readFile(join(root, result.details.cachePath as string, "meta.json"), "utf8"),
  );
  assert.equal(meta.stages.cacheSuggest.ran, false);
  assert.equal(meta.stages.cacheSuggest.degraded, true);
});

it("carries caller truncation flags into collate and warns on its own truncated synthesis", async (t) => {
  const root = await workspace(t);
  const base = coreContext(root);
  const context = {
    ...base.context,
    models: {
      ...base.context.models,
      complete: async (request: { model: { model: string }; userMessage: string }) => {
        if (request.model.model === "collate")
          return { text: "Summary.", citations: [], usage: { output: 100 } };
        return { text: "Answer.", citations: [] };
      },
    },
  };
  const result = await collate(
    {
      query: "collate truncation",
      extractions: [
        {
          url: "https://one.example",
          title: "One",
          extraction: "body",
          sourceType: "docs",
          status: "success",
          truncated: true,
        },
      ],
    },
    context,
  );
  // Supplied truncation flag survives into the appendix count.
  assert.match(result.text, /1 truncated at the output cap\), 0 failed/);
  // The synthesis itself hit collationMaxTokens (100): warning appended.
  assert.match(result.text, /Collation output reached collationMaxTokens/);
  const report = await readFile(
    join(root, result.details.cachePath as string, "report.md"),
    "utf8",
  );
  assert.match(report, /⚠ truncated/, "inventory flags the supplied extraction");
});

it("rejects empty manual collation without creating artefacts", async (t) => {
  const root = await workspace(t);
  const { context } = coreContext(root);
  const complete = context.models.complete;
  context.models.complete = async (request) => request.model.model === "collate"
    ? { text: " \n", citations: [] } : complete(request);
  await assert.rejects(collate({ query: "empty manual", extractions: [{
    url: "https://one.example", title: "One", extraction: "body", sourceType: "docs", status: "success",
  }] }, context), /no visible text.*collationMaxTokens/);
  assert.deepEqual(await readdir(root), [], "empty synthesis must not create success artefacts");
});

it("retries an empty capped collation once with a doubled budget", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { disableTelemetry: false });
  const complete = context.models.complete;
  const caps: Array<number | undefined> = [];
  context.models.complete = async (request) => {
    if (request.model.model !== "collate") return complete(request);
    caps.push(request.maxTokens);
    return caps.length === 1
      ? { text: "", citations: [], finishReason: "length" }
      : complete(request);
  };
  const result = await research({ query: "budget retry" }, context, dependencies);
  assert.equal(result.outcome, "completed");
  assert.deepEqual(caps, [context.settings.collationMaxTokens, context.settings.collationMaxTokens * 2]);
  const meta = JSON.parse(
    await readFile(join(root, result.details.cachePath as string, "meta.json"), "utf8"),
  );
  assert.equal(meta.stages.collate.budgetRetried, true);
});

it("keeps a usable truncated synthesis when the doubled-budget retry fails", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root);
  const complete = context.models.complete;
  let collateCalls = 0;
  context.models.complete = async (request) => {
    if (request.model.model !== "collate") return complete(request);
    collateCalls += 1;
    if (collateCalls === 1)
      return { text: "Usable but truncated synthesis [S1].", citations: [], finishReason: "length" };
    throw new Error("provider rejected max_completion_tokens");
  };
  const result = await research({ query: "retry fallback" }, context, dependencies);
  assert.equal(result.outcome, "completed");
  assert.equal(collateCalls, 2);
  assert.match(result.text, /Usable but truncated synthesis/);
  assert.match(result.text, /Collation output reached its cap \(100 tokens\); a retry at a larger cap ran but did not return a better answer\. The synthesis may be cut off mid-sentence\./);
  assert.doesNotMatch(result.text, /was considered/);
});

it("never replaces a successful report committed while collation was failing", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { disableTelemetry: false });
  const query = "concurrent collate failure";
  const path = makeCachePath(query, root, context.paths.cacheRoot);
  const complete = context.models.complete;
  dependencies.fetchPages = async (urls) => urls.map((url) =>
    url === "https://missing.py"
      ? {
          url,
          title: "",
          content: "",
          status: "error" as const,
          error: `PRESERVED_FAILURE ${"detail\n".repeat(60)}`,
        }
      : {
          url,
          title: "manage.py",
          content: "print('current attempt')",
          status: "success" as const,
          source: "text",
          assetType: "code" as const,
          contentType: "text/x-python",
        });
  let lockAttempted!: () => void;
  const cacheLockAttempt = new Promise<void>((resolve) => (lockAttempted = resolve));
  dependencies.beforeCacheLock = async () => {
    lockAttempted();
  };
  let collating!: () => void;
  const collateStarted = new Promise<void>((resolve) => (collating = resolve));
  // Hold the run inside its collation call, so the concurrent report is
  // written while the run provably cannot yet be waiting on the cache lock.
  // Releasing the call there orders the two runs by event, not by a sleep.
  let releaseCollate!: () => void;
  const collateGate = new Promise<void>((resolve) => (releaseCollate = resolve));
  context.models.complete = async (request) => {
    if (request.model.model === "search") {
      return { text: "Inspect manage.py and missing.py before continuing.", citations: [] };
    }
    if (request.model.model !== "collate") return complete(request);
    collating();
    await collateGate;
    return { text: " ", citations: [] };
  };
  // Hold the cache lock until the failing run is demonstrably waiting for it,
  // then publish the competing success before releasing acquisition. A prior
  // read moved outside the lock observes no report and overwrites it instead.
  let run!: ReturnType<typeof research>;
  await mkdir(dirname(path), { recursive: true });
  await withLock(cacheLockDir(path), async () => {
    run = research({ query }, context, dependencies);
    await collateStarted;
    releaseCollate();
    await cacheLockAttempt;
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "report.md"), "# Report\n\n## Summary\n\nConcurrent success.\n");
  });
  const result = await run;
  assert.equal(result.outcome, "collate-failed");
  assert.equal(result.details.cachePath, "");
  assert.ok(result.details.preservedCachePath);
  const inferred = result.details.inferredAssets as Array<Record<string, unknown>>;
  assert.equal(inferred.length, 2);
  assert.equal(inferred[0].originalReference, "manage.py");
  assert.equal(inferred[0].url, "https://manage.py");
  assert.equal(inferred[0].sourceFile, undefined, "an uncommitted run must not advertise a saved file");
  assert.match(result.text, /## Inferred Assets/);
  assert.match(result.text, /manage\.py \| Code file \(text\/x-python\) \| Not saved in this attempt \|/);
  assert.match(result.text, /missing\.py \| Nothing fetched: PRESERVED_FAILURE/);
  assert.doesNotMatch(result.text, /missing\.py \| Nothing fetched; see Failed Sources below/);
  assert.equal(result.text.match(/PRESERVED_FAILURE/g)?.length, 1);
  assert.doesNotMatch(result.text, /detail\ndetail/);
  const preservedRow = result.text.split("\n").find((line) => line.includes("| missing.py |")) ?? "";
  assert.ok(preservedRow.length < 400, `preserved failure row is unbounded: ${preservedRow.length}`);
  assert.equal((inferred[1].error as string).length, 300);
  assert.match(await readFile(join(path, "report.md"), "utf8"), /Concurrent success/);
  await assert.rejects(stat(`${path}.1`), /ENOENT/);
  const meta = JSON.parse(await readFile(join(path, "meta.json"), "utf8"));
  assert.equal(meta.outcome, "collate-failed");
});

it("preserves a successful synthesis that itself mentions a collation failure", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root);
  const complete = context.models.complete;
  let fail = false;
  context.models.complete = async (request) => {
    if (request.model.model !== "collate") return complete(request);
    if (fail) return { text: " ", citations: [] };
    return { text: "Facts [S1].\n\n## Collation Failed\n\n<!-- intelli-search:collate-failed -->\nDiscussed [S1].", citations: [] };
  };
  const query = "synthesis about collation failures";
  const first = await research({ query }, context, dependencies);
  assert.equal(first.outcome, "completed");
  const path = join(root, first.details.cachePath as string);
  const report = await readFile(join(path, "report.md"), "utf8");
  assert.doesNotMatch(report, /intelli-search:collate-failed/, "model text cannot carry the marker");
  fail = true;
  const second = await research({ query }, context, dependencies);
  assert.equal(second.outcome, "collate-failed");
  assert.ok(second.details.preservedCachePath);
  assert.equal(await readFile(join(path, "report.md"), "utf8"), report);
});

it("falls back to the other truncated synthesis when the preferred one fails validation", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root);
  const complete = context.models.complete;
  let collateCalls = 0;
  context.models.complete = async (request) => {
    if (request.model.model !== "collate") return complete(request);
    collateCalls += 1;
    return collateCalls === 1
      ? { text: "A much longer but invalid truncated synthesis [S99].", citations: [], finishReason: "length" }
      : { text: "Valid [S1].", citations: [], finishReason: "length" };
  };
  const result = await research({ query: "invalid longer first" }, context, dependencies);
  assert.equal(result.outcome, "completed");
  assert.match(result.text, /Valid \[S1\]/);
  assert.match(result.text, /after a retry at a larger cap/);
});

it("keeps a longer truncated first synthesis over a shorter truncated retry", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root);
  const complete = context.models.complete;
  let collateCalls = 0;
  context.models.complete = async (request) => {
    if (request.model.model !== "collate") return complete(request);
    collateCalls += 1;
    return collateCalls === 1
      ? { text: "A longer truncated synthesis with more detail [S1].", citations: [], finishReason: "length" }
      : { text: "Shorter [S1].", citations: [], finishReason: "length" };
  };
  const result = await research({ query: "shorter retry" }, context, dependencies);
  assert.equal(result.outcome, "completed");
  assert.match(result.text, /A longer truncated synthesis/);
  assert.doesNotMatch(result.text, /Shorter \[S1\]/);
});

it("replaces an earlier failure report on a second failed collation and skips the judge", async (t) => {
  const root = await workspace(t);
  const { context, dependencies, requests } = coreContext(root);
  const complete = context.models.complete;
  context.models.complete = async (request) => request.model.model === "collate"
    ? { text: " ", citations: [] } : complete(request);
  // A prior completed run puts an entry in the index, so the judge would run.
  const healthy = await research({ query: "unrelated healthy topic" }, coreContext(root).context, dependencies);
  assert.equal(healthy.outcome, "completed");
  const query = "repeated collate failure";
  const first = await research({ query }, context, dependencies);
  const second = await research({ query }, context, dependencies);
  assert.equal(first.outcome, "collate-failed");
  assert.equal(second.outcome, "collate-failed");
  assert.ok(second.details.cachePath, "the second run commits its own extractions");
  const path = join(root, second.details.cachePath as string);
  assert.match(await readFile(join(path, "report.md"), "utf8"), /## Collation Failed/);
  assert.match(await readFile(join(`${path}.1`, "report.md"), "utf8"), /## Collation Failed/);
  assert.equal(
    requests.filter((request) => request.userMessage.startsWith("Current query:")).length,
    0,
    "no cache-suggest judge call after a failed collation",
  );
});

it("commits research extractions with a failure report when collation fails", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { disableTelemetry: false });
  const complete = context.models.complete;
  context.models.complete = async (request) => request.model.model === "collate"
    ? { text: " \n", citations: [] } : complete(request);
  const result = await research({ query: "empty synthesis" }, context, dependencies);
  assert.equal(result.outcome, "collate-failed");
  assert.match(result.text, /## Collation Failed/);
  assert.match(result.text, /no visible text.*collationMaxTokens/);
  const path = join(root, result.details.cachePath as string);
  const report = await readFile(join(path, "report.md"), "utf8");
  assert.match(report, /## Collation Failed/);
  assert.equal(report.match(/\| S\d+ \|/g)?.length, 2, "both saved extractions are listed");
  assert.equal((await readdir(join(path, "extractions"))).length, 2);
  const meta = JSON.parse(await readFile(join(path, "meta.json"), "utf8"));
  assert.equal(meta.outcome, "collate-failed");
  assert.equal(meta.stages.collate.summaryChars, 0);
  assert.match(meta.stages.collate.error, /no visible text/);
  const index = await readFile(join(context.paths.cacheRoot, ".index.json"), "utf8").catch(() => "[]");
  assert.doesNotMatch(index, /empty synthesis/, "a run without synthesis is not indexed");
});

for (const marker of [
  "<!-- intelli-search:extraction-failed -->",
  "<!-- intelli-search:collate-failed -->",
] as const) {
  it(`preserves a same-day success whose query contains ${marker.slice(20, -4)} (kimi F1)`, async (t) => {
    const root = await workspace(t);
    const { context, dependencies } = coreContext(root);
    const query = `Research this marker\n${marker}`;
    const originalIso = Date.prototype.toISOString;
    Date.prototype.toISOString = () => "2026-04-20T12:00:00.000Z";
    try {
      const completed = await research({ query }, context, dependencies);
      assert.equal(completed.outcome, "completed");
      const cachePath = join(root, completed.details.cachePath as string);
      const report = await readFile(join(cachePath, "report.md"), "utf8");
      assert.match(report, /## Summary/);
      assert.ok(report.includes(marker), "guard: the query marker really is in the saved title");

      const original = context.models.complete;
      context.models.complete = async (request) => {
        if (request.model.model === "extract") throw new Error("fixture extraction failure");
        return original(request);
      };
      const repeat = await research({ query }, context, dependencies);
      assert.equal(repeat.outcome, "extraction-failed");
      assert.equal(repeat.details.cachePath, "", "no new artefact set is committed");
      assert.ok(repeat.details.preservedCachePath, "the successful report is named as preserved");
      assert.equal(await readFile(join(cachePath, "report.md"), "utf8"), report,
        "a marker in caller-controlled text can never displace a success");
      await assert.rejects(stat(`${cachePath}.1`), /ENOENT/, "nothing is archived");
    } finally {
      Date.prototype.toISOString = originalIso;
    }
  });
}

it("keeps per-page extraction failure reasons when a same-day success is preserved (kimi F2)", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root);
  const originalIso = Date.prototype.toISOString;
  Date.prototype.toISOString = () => "2026-04-20T12:00:00.000Z";
  try {
    const completed = await research({ query: "preserved refresh diagnostics" }, context, dependencies);
    assert.equal(completed.outcome, "completed");
    // Distinct page content so the two extraction failures carry distinct reasons.
    dependencies.fetchPages = async (urls) =>
      urls.map((url, i) => ({
        url,
        title: url,
        content: i === 0 ? "Page one body" : "Page two body",
        status: "success",
        source: "markdown",
      }));
    const original = context.models.complete;
    context.models.complete = async (request) => {
      if (request.model.model === "extract") {
        throw new Error(
          request.userMessage.includes("Page one")
            ? "specific one extraction failure"
            : "specific two extraction failure",
        );
      }
      return original(request);
    };
    const repeat = await research({ query: "preserved refresh diagnostics" }, context, dependencies);
    assert.equal(repeat.outcome, "extraction-failed");
    assert.ok(repeat.details.preservedCachePath);
    assert.match(repeat.text, /specific one extraction failure/);
    assert.match(repeat.text, /specific two extraction failure/);
  } finally {
    Date.prototype.toISOString = originalIso;
  }
});

it("removes a stale index entry when an extraction-failed run commits (deepseek F3)", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root);
  const query = "stale index entry";
  const path = makeCachePath(query, root, context.paths.cacheRoot);
  const slug = path.split("/").pop() as string;
  await mkdir(context.paths.cacheRoot, { recursive: true });
  await writeFile(
    join(context.paths.cacheRoot, ".index.json"),
    JSON.stringify({ searches: [{ slug, query, timestamp: "2026-04-20T00:00:00.000Z" }] }),
  );
  const original = context.models.complete;
  context.models.complete = async (request) => {
    if (request.model.model === "extract") throw new Error("fixture extraction failure");
    return original(request);
  };
  const result = await research({ query }, context, dependencies);
  assert.equal(result.outcome, "extraction-failed");
  assert.ok(result.details.cachePath, "the failure report commits");
  const index = await readIndex(context.paths.cacheRoot);
  assert.ok(!index.searches.some((e) => e.slug === slug),
    "cache suggest must never offer a failure report");
});

it("removes a stale index entry when a collate-failed run commits", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root);
  const query = "stale collate index entry";
  const path = makeCachePath(query, root, context.paths.cacheRoot);
  const slug = path.split("/").pop() as string;
  await mkdir(context.paths.cacheRoot, { recursive: true });
  await writeFile(
    join(context.paths.cacheRoot, ".index.json"),
    JSON.stringify({ searches: [{ slug, query, timestamp: "2026-04-20T00:00:00.000Z" }] }),
  );
  const complete = context.models.complete;
  context.models.complete = async (request) => request.model.model === "collate"
    ? { text: " ", citations: [] } : complete(request);
  const result = await research({ query }, context, dependencies);
  assert.equal(result.outcome, "collate-failed");
  assert.ok(result.details.cachePath);
  const index = await readIndex(context.paths.cacheRoot);
  assert.ok(!index.searches.some((e) => e.slug === slug));
});

it("saves every fetched page with a failure report when all extractions fail", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { disableTelemetry: false });
  const original = context.models.complete;
  context.models.complete = async (request) => {
    if (request.model.model === "extract") throw new Error("fixture extraction failure");
    return original(request);
  };
  const result = await research({ query: "all extractions fail" }, context, dependencies);
  assert.equal(result.outcome, "extraction-failed");
  assert.ok(result.details.cachePath, "details.cachePath names the saved folder");
  const path = join(root, result.details.cachePath as string);
  const report = await readFile(join(path, "report.md"), "utf8");
  assert.match(report, /## Extraction Failed/);
  assert.match(report, /intelli-search:extraction-failed/, "the saved report keeps its detection marker");
  assert.match(report, /fixture extraction failure \(full page saved: sources\/01-one-example\.md\)/,
    "the report lists each saved page and why its extraction failed");
  assert.match(report, /Search summary/, "the saved report keeps the search summary");
  assert.deepEqual((await readdir(join(path, "sources"))).sort(), ["01-one-example.md", "02-two-example.md"]);
  assert.deepEqual(await readdir(join(path, "extractions")), [], "a failed extraction writes no extraction file");
  // The calling agent sees the failure, each saved page path and the reason,
  // but never the raw detection marker.
  assert.match(result.text, /## Extraction Failed/);
  assert.match(result.text, /fixture extraction failure \(full page saved: .*sources\/01-one-example\.md/);
  assert.doesNotMatch(result.text, /intelli-search:extraction-failed/);
  const meta = JSON.parse(await readFile(join(path, "meta.json"), "utf8"));
  assert.equal(meta.outcome, "extraction-failed");
  await assert.rejects(
    stat(join(context.paths.cacheRoot, ".index.json")),
    /ENOENT/,
    "a committed failure report creates no index entry and no index file",
  );
});

it("uses caller-supplied file wording through manual intelli_collate", async (t) => {
  const root = await workspace(t);
  const { context } = coreContext(root, { collationSourceMaxTokens: 100 });
  const result = await collate({
    query: "manual trim guidance",
    extractions: [
      {
        url: "https://one.example/a",
        title: "One",
        extraction: "a".repeat(3_000),
        sourceType: "docs",
        status: "success",
      },
    ],
  }, context);
  assert.equal(result.outcome, "completed");
  assert.match(result.text, /The omitted text is in the extraction files below, saved in full from the supplied extractions\. Read them for the missing detail; repeating collation will not recover it\./);
  assert.doesNotMatch(result.text, /re-running research/);
  assert.match(result.text, /full extraction: `[^`]+\/extractions\/01-one-example\.md`/);
  assert.match(result.text, /\*\*Configuration\*\*: To send more next time, raise collationSourceMaxTokens\./);
});

it("keeps original source IDs after budget trimming and dropping", async (t) => {
  const root = await workspace(t);
  const { context, dependencies, requests } = coreContext(root, {
    collationSourceMaxTokens: 256,
  });
  const complete = context.models.complete;
  context.models.complete = async (request) => {
    requests.push(request);
    if (request.model.model === "search") {
      return {
        text: "[First](https://s1.example/page) [Second](https://s2.example/page)",
        citations: [],
      };
    }
    if (request.model.model === "extract") {
      return request.userMessage.includes("FIRST_PAGE")
        ? { text: `${" ".repeat(1024)}First-source-only fact.`, citations: [] }
        : { text: "Second-source-only fact.", citations: [] };
    }
    if (request.model.model === "collate") {
      return { text: "Answer derived from the second source [S2].", citations: [] };
    }
    return complete(request);
  };
  dependencies.fetchPages = async (urls) => urls.map((url) => ({
    url,
    title: url,
    content: url.includes("s1.example") ? "FIRST_PAGE" : "SECOND_PAGE",
    status: "success" as const,
    source: "markdown",
  }));
  const result = await research({ query: "stable IDs after trimming" }, context, dependencies);
  assert.equal(result.outcome, "completed");
  const collation = requests.find((request) => request.model.model === "collate");
  assert.ok(collation);
  const prompt = JSON.parse(collation.userMessage);
  assert.deepEqual(prompt.sources.map((source: { id: string }) => source.id), ["S2"]);
  assert.equal(prompt.sources[0].url, "https://s2.example/page");
  assert.match(result.text, /Answer derived from the second source \[S2\]/);
  assert.match(result.text, /\| S2 \| https:\/\/s2\.example\/page \|/);
  assert.match(result.text, /Left out with empty retained text \(1\)/);
  assert.match(result.text, /256-token per-source limit \(collationSourceMaxTokens\)/);
  assert.match(result.text, /full extraction: `[^`]+\/extractions\/01-s1-example\.md`/);
  assert.match(result.text, /Read them for the missing detail; re-running research will not recover it\./);
  assert.match(result.text, /\*\*Configuration\*\*: To send more next time, raise collationSourceMaxTokens\./);
  assert.match(result.text, /left out because the retained text is empty/);
  const deliveredChars = prompt.sources[0].extraction.length;
  assert.match(result.text, new RegExp(`The model received ${deliveredChars} characters`));
  const meta = JSON.parse(await readFile(join(root, result.details.cachePath as string, "meta.json"), "utf8"));
  assert.equal(meta.stages.collate.inputBudget.charsAfter, deliveredChars);
  assert.equal(meta.stages.collate.inputBudget.trimmed, 0);
  assert.equal(meta.stages.collate.inputBudget.dropped, 1);

  context.models.complete = async (request) => {
    if (request.model.model === "search") {
      return {
        text: "[First](https://s1.example/page) [Second](https://s2.example/page)",
        citations: [],
      };
    }
    if (request.model.model === "extract") {
      return request.userMessage.includes("FIRST_PAGE")
        ? { text: `${" ".repeat(1024)}First-source-only fact.`, citations: [] }
        : { text: "Second-source-only fact.", citations: [] };
    }
    return request.model.model === "collate"
      ? { text: "First-source fact [S1].", citations: [] }
      : complete(request);
  };
  const rejected = await research({ query: "rejected emptied source ID" }, context, dependencies);
  assert.equal(rejected.outcome, "collate-failed");
  assert.match(rejected.text, /unknown or omitted source ID/);
  assert.ok(rejected.details.cachePath, "the failed validation still saves the run");
});

it("keeps original source IDs after an inferred manual-collation source is dropped", async (t) => {
  const root = await workspace(t);
  const { context, requests } = coreContext(root, { collationInputBudgetTokens: 500 });
  const complete = context.models.complete;
  context.models.complete = async (request) => {
    requests.push(request);
    return request.model.model === "collate"
      ? { text: "Third-source fact [S3].", citations: [] }
      : complete(request);
  };
  const result = await collate({
    query: "stable IDs after dropping",
    extractions: [
      { url: "https://one.example/a", title: "One", extraction: "First fact.", sourceType: "docs", status: "success" },
      {
        url: "https://two.example/b",
        title: "Two",
        extraction: `official docs\n${"inferred text ".repeat(75)}`,
        sourceType: "docs",
        status: "success",
        inferred: true,
      },
      { url: "https://three.example/c", title: "Three", extraction: "Third fact.", sourceType: "docs", status: "success" },
    ],
  }, context);
  assert.equal(result.outcome, "completed");
  const prompt = JSON.parse(requests[0].userMessage);
  assert.deepEqual(prompt.sources.map((source: { id: string }) => source.id), ["S1", "S3"]);
  assert.deepEqual(prompt.sources.map((source: { url: string }) => source.url), [
    "https://one.example/a",
    "https://three.example/c",
  ]);
  assert.match(result.text, /Third-source fact \[S3\]/);
  assert.match(result.text, /\| S3 \| https:\/\/three\.example\/c \|/);
  assert.match(result.text, /https:\/\/two\.example\/b: left out entirely/);
  context.models.complete = async (request) =>
    request.model.model === "collate"
      ? { text: "Invented claim from dropped source [S2].", citations: [] }
      : complete(request);
  await assert.rejects(
    collate({
      query: "rejected dropped source ID",
      extractions: [
        { url: "https://one.example/a", title: "One", extraction: "First fact.", sourceType: "docs", status: "success" },
        {
          url: "https://two.example/b",
          title: "Two",
          extraction: `official docs\n${"inferred text ".repeat(75)}`,
          sourceType: "docs",
          status: "success",
          inferred: true,
        },
        { url: "https://three.example/c", title: "Three", extraction: "Third fact.", sourceType: "docs", status: "success" },
      ],
    }, context),
    /unknown or omitted source ID/,
  );
});

it("returns collate-failed without calling the model when the budget leaves no evidence", async (t) => {
  const root = await workspace(t);
  const { context, dependencies, requests } = coreContext(root, {
    defaultUrls: 100,
    maxUrls: 100,
    collationInputBudgetTokens: 10_000,
  });
  const complete = context.models.complete;
  context.models.complete = async (request) => {
    if (request.model.model === "search") {
      return {
        text: Array.from({ length: 100 }, (_, i) => `[S${i + 1}](https://s${i + 1}.example/page)`).join(" "),
        citations: [],
      };
    }
    if (request.model.model === "extract") {
      return { text: `official docs, current\n${"useful text ".repeat(70)}`, citations: [] };
    }
    return complete(request);
  };
  const result = await research({ query: "no evidence fits collation" }, context, dependencies);
  assert.equal(result.outcome, "collate-failed");
  assert.equal(requests.filter((request) => request.model.model === "collate").length, 0);
  assert.match(result.text, /collationInputBudgetTokens/);
  assert.match(result.text, /collationSourceMaxTokens/);
  assert.ok(result.details.cachePath, "the normal collate-failed path saves the run");
  const cachePath = join(root, result.details.cachePath as string);
  assert.equal((await readdir(join(cachePath, "extractions"))).length, 100);
  assert.equal((await readdir(join(cachePath, "sources"))).length, 100);
  assert.match(await readFile(join(cachePath, "report.md"), "utf8"), /## Collation Failed/);
  const meta = JSON.parse(await readFile(join(cachePath, "meta.json"), "utf8"));
  assert.equal(meta.stages.collate.inputBudget.sources, 100);
  assert.equal(meta.stages.collate.inputBudget.dropped, 100);
  assert.equal(meta.stages.collate.inputBudget.charsAfter, 0);
});

it("uses manual-specific no-evidence advice without research-only URL guidance", async (t) => {
  const root = await workspace(t);
  const { context, requests } = coreContext(root, { collationInputBudgetTokens: 10_000 });
  const complete = context.models.complete;
  context.models.complete = async (request) => {
    if (request.model.model === "collate") throw new Error("manual model must not be called");
    return complete(request);
  };
  const extractions = Array.from({ length: 100 }, (_, i) => ({
    url: `https://s${i + 1}.example/page`,
    title: `S${i + 1}`,
    extraction: `official docs\n${"useful text ".repeat(70)}`,
    sourceType: "docs",
    status: "success",
  }));
  await assert.rejects(
    collate({ query: "manual no evidence", extractions }, context),
    (error: Error) => {
      assert.equal(
        error.message,
        "Collation input budget left no non-empty evidence text; raise collationInputBudgetTokens (or collationSourceMaxTokens when sources were cut to the per-source limit), or send fewer sources.",
      );
      assert.doesNotMatch(error.message, /fewer URLs/);
      return true;
    },
  );
  assert.equal(requests.filter((request) => request.model.model === "collate").length, 0);
});

it("drops inferred evidence before cited evidence through the merged research budget planner", async (t) => {
  const root = await workspace(t);
  const { context, dependencies, requests } = coreContext(root, {
    collationInputBudgetTokens: 250,
    defaultUrls: 2,
    maxUrls: 2,
  });
  const complete = context.models.complete;
  context.models.complete = async (request) => {
    if (request.model.model === "search") {
      return { text: "Read [the cited guide](https://one.example/page), then inspect manage.py.", citations: [] };
    }
    if (request.model.model === "extract" && request.userMessage.includes("INFERRED_PAGE")) {
      return { text: `official docs, current\n${"inferred text ".repeat(50)}`, citations: [] };
    }
    return complete(request);
  };
  dependencies.fetchPages = async (urls) => urls.map((url) => ({
    url,
    title: url,
    content: url === "https://manage.py" ? "INFERRED_PAGE" : "CITED_PAGE",
    status: "success" as const,
    source: "text",
    assetType: "code" as const,
    contentType: "text/x-python",
  }));
  const result = await research({ query: "merged inferred budget order" }, context, dependencies);
  assert.equal(result.outcome, "completed");
  const collation = requests.find((request) => request.model.model === "collate");
  assert.ok(collation);
  assert.match(collation.userMessage, /https:\/\/one\.example\/page/);
  assert.doesNotMatch(collation.userMessage, /manage\.py/, "the inferred extraction is left out, not the citation");
  const cachePath = join(root, result.details.cachePath as string);
  const fullInferred = await readFile(join(cachePath, "extractions", "02-manage-py.md"), "utf8");
  assert.match(fullInferred, /official docs, current\ninferred text/, "the saved inferred extraction is not trimmed");
  assert.match(result.text, /Left out to fit the input budget/);
  assert.match(result.text, /lowest-ranked first, inferred references before cited sources\./);
  assert.match(result.text, /https:\/\/manage\.py/);
  const meta = JSON.parse(await readFile(join(cachePath, "meta.json"), "utf8"));
  assert.equal(meta.stages.collate.inputBudget.dropped, 1);
  assert.match(result.text, /## Inferred Assets/, "the same source remains labelled inferred in the result");
});

it("includes inferred assets and identity in a committed extraction-failed result and report", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { disableTelemetry: false });
  const complete = context.models.complete;
  context.models.complete = async (request) => {
    if (request.model.model === "search") {
      return { text: "Inspect manage.py and missing.py for build steps.", citations: [] };
    }
    if (request.model.model === "extract") throw new Error("COMMITTED_EXTRACTION_FAILURE");
    return complete(request);
  };
  dependencies.fetchPages = async (urls) => urls.map((url) =>
    url === "https://missing.py"
      ? { url, title: "", content: "", status: "error" as const, error: "HTTP 404: Not Found" }
      : {
          url,
          title: "manage.py",
          content: "print('kept page')",
          status: "success" as const,
          source: "text",
          assetType: "code" as const,
          contentType: "text/x-python",
        });
  const result = await research({ query: "committed inferred extraction failure" }, context, dependencies);
  assert.equal(result.outcome, "extraction-failed");
  assert.ok(result.details.cachePath);
  assert.match(result.text, /## Inferred Assets/);
  assert.match(result.text, /manage\.py \| Code file \(text\/x-python\) \| .*sources\/01-manage-py\.md \|/);
  assert.match(result.text, /missing\.py \| Nothing fetched; see Failed Sources below \| None \|/);
  const inferred = result.details.inferredAssets as Array<Record<string, unknown>>;
  assert.equal(inferred[0].sourceFile, "sources/01-manage-py.md");
  assert.equal(inferred[1].sourceFile, undefined);
  const path = join(root, result.details.cachePath as string);
  const report = await readFile(join(path, "report.md"), "utf8");
  assert.ok(report.startsWith("<!-- intelli-search:extraction-failed -->\n"));
  assert.match(report, /## Inferred Assets/);
  assert.match(report, /## Failed Sources/);
  assert.match(report, /COMMITTED_EXTRACTION_FAILURE \(full page saved: sources\/01-manage-py\.md\)/);
  assert.match(report, /names each failed source, the saved page's path when one exists, and why it failed/);
  assert.match(report, /pass its content to `intelli_extract` to retry its extraction without refetching it/);
  assert.doesNotMatch(report, /re-run the research/);
  assert.match(await readFile(join(path, "sources", "01-manage-py.md"), "utf8"), /print\('kept page'\)/);
});

it("preserves inferred outcomes inline without identity when an extraction-failed report is preserved", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { disableTelemetry: false });
  const complete = context.models.complete;
  let failExtraction = false;
  context.models.complete = async (request) => {
    if (request.model.model === "search") {
      return { text: "Inspect manage.py and missing.py for build steps.", citations: [] };
    }
    if (failExtraction && request.model.model === "extract") {
      throw new Error(`PRESERVED_EXTRACT_ERROR ${"extract detail\n".repeat(60)}`);
    }
    return complete(request);
  };
  dependencies.fetchPages = async (urls) => urls.map((url) =>
    url === "https://missing.py"
      ? {
          url,
          title: "",
          content: "",
          status: "error" as const,
          error: `PRESERVED_FETCH_ERROR ${"fetch detail\n".repeat(60)}`,
        }
      : {
          url,
          title: "manage.py",
          content: "print('current extraction failure')",
          status: "success" as const,
          source: "text",
          assetType: "code" as const,
          contentType: "text/x-python",
        });
  const query = "preserved inferred extraction failure";
  const first = await research({ query }, context, dependencies);
  assert.equal(first.outcome, "completed");
  const priorPath = join(root, first.details.cachePath as string);
  const priorReport = await readFile(join(priorPath, "report.md"), "utf8");
  failExtraction = true;
  const result = await research({ query }, context, dependencies);
  assert.equal(result.outcome, "extraction-failed");
  assert.equal(result.details.cachePath, "");
  assert.ok(result.details.preservedCachePath);
  assert.match(result.text, /## Inferred Assets/);
  assert.match(result.text, /manage\.py \| Code file \(text\/x-python\) \| Not saved in this attempt \|/);
  assert.match(result.text, /missing\.py \| Nothing fetched: PRESERVED_FETCH_ERROR/);
  assert.doesNotMatch(result.text, /missing\.py \| Nothing fetched; see Failed Sources below/);
  const inferred = result.details.inferredAssets as Array<Record<string, unknown>>;
  assert.equal(inferred.length, 2);
  assert.equal(inferred[0].sourceFile, undefined);
  assert.equal((inferred[1].error as string).length, 300);
  const missingRow = result.text.split("\n").find((line) => line.includes("| missing.py |")) ?? "";
  assert.ok(missingRow.length < 400);
  assert.equal(await readFile(join(priorPath, "report.md"), "utf8"), priorReport);
});

it("preserves a same-day successful report when every extraction fails", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root);
  const originalIso = Date.prototype.toISOString;
  Date.prototype.toISOString = () => "2026-04-20T12:00:00.000Z";
  try {
    const completed = await research({ query: "extract refresh" }, context, dependencies);
    assert.equal(completed.outcome, "completed");
    const cachePath = join(root, completed.details.cachePath as string);
    const report = await readFile(join(cachePath, "report.md"), "utf8");

    const original = context.models.complete;
    context.models.complete = async (request) => {
      if (request.model.model === "extract") throw new Error("fixture extraction failure");
      return original(request);
    };
    const degraded = await research({ query: "extract refresh" }, context, dependencies);
    assert.equal(degraded.outcome, "extraction-failed");
    assert.equal(degraded.details.cachePath, "");
    assert.ok(degraded.details.preservedCachePath, "the preserved report is named separately");
    assert.equal(await readFile(join(cachePath, "report.md"), "utf8"), report,
      "a successful report is never displaced");
    assert.ok((await readdir(join(cachePath, "extractions"))).length > 0,
      "the successful run's extractions survive");
    await assert.rejects(stat(`${cachePath}.1`), /ENOENT/, "no archive is created");
    assert.equal(
      JSON.parse(await readFile(join(cachePath, "meta.json"), "utf8")).outcome,
      "extraction-failed",
      "the failed attempt is recorded in the sidecar only",
    );
  } finally {
    Date.prototype.toISOString = originalIso;
  }
});

it("replaces an earlier extraction-failure report on a repeat and skips the judge", async (t) => {
  const root = await workspace(t);
  const { context, dependencies, requests } = coreContext(root);
  const original = context.models.complete;
  context.models.complete = async (request) => {
    if (request.model.model === "extract") throw new Error("fixture extraction failure");
    return original(request);
  };
  // A prior completed run puts an entry in the index, so the judge would run.
  const healthy = await research({ query: "unrelated healthy topic" }, coreContext(root).context, dependencies);
  assert.equal(healthy.outcome, "completed");
  const originalIso = Date.prototype.toISOString;
  Date.prototype.toISOString = () => "2026-04-20T12:00:00.000Z";
  try {
    const first = await research({ query: "repeated extraction failure" }, context, dependencies);
    assert.ok(first.details.cachePath, "the first failed run commits its pages");
    const second = await research({ query: "repeated extraction failure" }, context, dependencies);
    assert.equal(second.outcome, "extraction-failed");
    assert.ok(second.details.cachePath, "the repeat replaces the earlier failure report");
    const path = join(root, second.details.cachePath as string);
    assert.match(await readFile(join(path, "report.md"), "utf8"), /## Extraction Failed/);
    assert.match(await readFile(join(`${path}.1`, "report.md"), "utf8"), /## Extraction Failed/,
      "the replaced failure report is archived, not discarded");
    assert.equal(
      requests.filter((request) => request.userMessage.startsWith("Current query:")).length,
      0,
      "no cache-suggest judge call after a run without synthesis",
    );
  } finally {
    Date.prototype.toISOString = originalIso;
  }
});

it("saves fetched pages and a failure report with telemetry disabled", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { disableTelemetry: true });
  const original = context.models.complete;
  context.models.complete = async (request) => {
    if (request.model.model === "extract") throw new Error("fixture extraction failure");
    return original(request);
  };
  const result = await research({ query: "silent extraction failure" }, context, dependencies);
  assert.equal(result.outcome, "extraction-failed");
  assert.ok(result.details.cachePath);
  const path = join(root, result.details.cachePath as string);
  assert.match(await readFile(join(path, "report.md"), "utf8"), /## Extraction Failed/);
  assert.deepEqual((await readdir(join(path, "sources"))).length, 2, "pages are kept without a sidecar");
  await assert.rejects(stat(join(path, "meta.json")), /ENOENT/, "telemetry stays disabled");
});

it("preserves an unmarked legacy failure report instead of replacing it (owner decision, round 3)", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root);
  const query = "legacy failure report";
  const path = makeCachePath(query, root, context.paths.cacheRoot);
  await mkdir(path, { recursive: true });
  // Exact shape written by the 0.22.0 development builds before the marker:
  // failure heading, no marker, no "## Summary" section. No published
  // release ever wrote a failure report, so unmarked development-build
  // failure reports are preserved like any other existing report (owner
  // decision, round 3) instead of being recognised and replaced.
  const legacy =
    "# legacy failure report\n\n> Searched: 2026-11-01T00:00:00.000Z\n\n## Collation Failed\n\n> ⚠ legacy reason\n\nNo synthesis was produced.\n\n## Source assessment\n\n| ID | Source |\n|---|---|\n| S1 | https://one.example/page |\n";
  await writeFile(join(path, "report.md"), legacy);
  const original = context.models.complete;
  context.models.complete = async (request) => {
    if (request.model.model === "extract") throw new Error("fixture extraction failure");
    return original(request);
  };
  const result = await research({ query }, context, dependencies);
  assert.equal(result.outcome, "extraction-failed");
  assert.equal(result.details.cachePath, "", "an unmarked report is never replaced");
  assert.ok(result.details.preservedCachePath, "the preserved report is named");
  assert.equal(await readFile(join(path, "report.md"), "utf8"), legacy,
    "the unmarked failure report survives byte-identically");
  await assert.rejects(stat(`${path}.1`), /ENOENT/, "nothing was archived");
});

it("preserves a mid-body-marker development report with a multiline query and a ## Summary search heading", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root);
  // The two grammars the round-2 reviewers reproduced (kimi R2-F1, astra A1):
  // a bd51692-era extraction-failure report whose marker sat mid-body, whose
  // query is multiline, and whose search summary contains "## Summary".
  // Under the line-1-only rule it is preserved like any other report.
  const query = "Legacy extract question\nsecond ordinary line";
  const path = makeCachePath(query, root, context.paths.cacheRoot);
  await mkdir(path, { recursive: true });
  const legacy =
    `# ${query}\n\n> Searched: 2026-11-07T00:00:00.000Z\n> Cache: ${path}/\n> Sources: 0 succeeded, 2 failed\n\n` +
    "## Extraction Failed\n\n<!-- intelli-search:extraction-failed -->\n\n> ⚠ 2 extraction(s) failed.\n\n" +
    "No content was extracted, so no synthesis was produced. 2 fetched page(s) are saved under sources/.\n\n" +
    "## Search summary\n\n## Summary\n\nSearch model answer.\n";
  await writeFile(join(path, "report.md"), legacy);
  const original = context.models.complete;
  context.models.complete = async (request) => {
    if (request.model.model === "extract") throw new Error("fixture extraction failure");
    return original(request);
  };
  const result = await research({ query }, context, dependencies);
  assert.equal(result.outcome, "extraction-failed");
  assert.equal(result.details.cachePath, "", "no line-1 marker: never a failure report");
  assert.ok(result.details.preservedCachePath);
  assert.equal(await readFile(join(path, "report.md"), "utf8"), legacy);
});

it("preserves an unreadable prior report instead of overwriting it (M9)", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { disableTelemetry: false });
  const query = "unreadable prior report";
  const path = makeCachePath(query, root, context.paths.cacheRoot);
  await mkdir(join(path, "report.md"), { recursive: true }); // a directory where the report belongs
  const original = context.models.complete;
  context.models.complete = async (request) => {
    if (request.model.model === "extract") throw new Error("fixture extraction failure");
    return original(request);
  };
  const result = await research({ query }, context, dependencies);
  assert.equal(result.outcome, "extraction-failed");
  assert.equal(result.details.cachePath, "");
  assert.ok(result.details.preservedCachePath, "fail closed: an unreadable report is preserved");
  await assert.rejects(readFile(join(path, "report.md")), /EISDIR/, "the directory is untouched");
  await assert.rejects(stat(`${path}.1`), /ENOENT/, "nothing was archived");
});

it("classifies failure reports only by their line-1 marker", () => {
  // Current grammar: the marker is the report's first line, above the title.
  assert.ok(isCollationFailureReport("<!-- intelli-search:collate-failed -->\n# q\n\n## Collation Failed\n\n> ⚠ r\n"));
  assert.ok(isCollationFailureReport("<!-- intelli-search:extraction-failed -->\n# q\n\n## Extraction Failed\n\n> ⚠ r\n"));
  // A marker anywhere but line 1 never makes a failure report: this is what
  // keeps a multiline query from forging one (kimi F1).
  assert.ok(!isCollationFailureReport(
    "# q\n<!-- intelli-search:extraction-failed -->\n\n> Searched: 2026-11-01T00:00:00.000Z\n\n## Summary\n\nSynthesis.\n"));
  assert.ok(!isCollationFailureReport(
    "# q\n<!-- intelli-search:collate-failed -->\n\n> Searched: 2026-11-01T00:00:00.000Z\n\n## Summary\n\nSynthesis.\n"));
  // Owner decision (round 3): every unmarked shape is preserved like any
  // other existing report — including genuine development-build failure
  // reports written before the line-1 marker existed.
  assert.ok(!isCollationFailureReport(
    "# q\n\n> Searched: 2026-11-01T00:00:00.000Z\n\n## Collation Failed\n\n> ⚠ reason\n\nNo synthesis was produced.\n"),
    "pre-marker development reports are preserved, not replaced");
  assert.ok(!isCollationFailureReport(
    "# q\n\n> Searched: 2026-11-01T00:00:00.000Z\n\n## Extraction Failed\n\n<!-- intelli-search:extraction-failed -->\n\n> ⚠ r\n"),
    "mid-body-marker development reports are preserved, not replaced");
  assert.ok(!isCollationFailureReport(
    "# multiline query\nsecond line\n\n> Searched: 2026-11-01T00:00:00.000Z\n\n## Extraction Failed\n\n<!-- intelli-search:extraction-failed -->\n\n> ⚠ r\n"));
  assert.ok(!isCollationFailureReport("# hand report\n\n## Overview\n\n## Collation Failed\n\nNotes.\n"));
  assert.ok(!isCollationFailureReport("# q\n\n## Summary\n\nSynthesis mentioning ## Collation Failed as prose.\n"));
  assert.ok(!isCollationFailureReport("## Summary\n\n## Collation Failed\n\n"));
  assert.ok(!isCollationFailureReport("# ordinary report\n\n## Summary\n\ntext\n"));
  assert.ok(!isCollationFailureReport(""));
});

it("keeps the failure-report marker out of collate-failed result text (M7)", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root);
  const complete = context.models.complete;
  context.models.complete = async (request) => request.model.model === "collate"
    ? { text: " ", citations: [] } : complete(request);
  const result = await research({ query: "marker visibility" }, context, dependencies);
  assert.equal(result.outcome, "collate-failed");
  assert.doesNotMatch(result.text, /intelli-search:collate-failed/,
    "the raw marker is not shown to the calling agent");
  const path = join(root, result.details.cachePath as string);
  assert.match(await readFile(join(path, "report.md"), "utf8"), /intelli-search:collate-failed/,
    "the saved report keeps its detection marker");
});

for (const outcome of ["no-links", "fetch-failed"] as const) {
  it(`retains the ${outcome} degraded outcome without a report`, async (t) => {
    const root = await workspace(t);
    const { context, dependencies, requests } = coreContext(root);
    const original = context.models.complete;
    context.models.complete = async (request) => {
      if (outcome === "no-links") {
        requests.push(request);
        return { text: "No sources", citations: [] };
      }
      return original(request);
    };
    if (outcome === "fetch-failed")
      dependencies.fetchPages = async (urls) =>
        urls.map((url) => ({ url, title: "", content: "", status: "error" }));
    const result = await research({ query: outcome }, context, dependencies);
    assert.equal(result.outcome, outcome);
    assert.equal(result.details.cachePath, "");
    const path = makeCachePath(outcome, root, context.paths.cacheRoot);
    assert.deepEqual(await readdir(path), ["meta.json"]);
    assert.equal(JSON.parse(await readFile(join(path, "meta.json"), "utf8")).outcome, outcome);
    if (outcome === "no-links") assert.equal(requests.length, 2);
  });
}

it("preserves a previous successful run's artefacts on a degraded refresh of the same query", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root);
  // Freeze the date so both runs resolve to the same cache path.
  const originalIso = Date.prototype.toISOString;
  Date.prototype.toISOString = () => "2026-04-20T12:00:00.000Z";
  try {
    const completed = await research({ query: "refresh" }, context, dependencies);
    assert.equal(completed.outcome, "completed");
    const cachePath = join(root, completed.details.cachePath as string);
    const report = await readFile(join(cachePath, "report.md"), "utf8");
    // Supplementary documentation download from the successful run.
    await writeFile(join(cachePath, "sources", "llms-full-one.example.md"), "docs");
    const slug = cachePath.split("/").pop() as string;
    assert.ok(
      (await readIndex(context.paths.cacheRoot)).searches.some((e) => e.slug === slug),
      "guard: the successful run must have indexed the slug first",
    );

    const original = context.models.complete;
    context.models.complete = async (request) => {
      if (request.model.model === "search") return { text: "No sources", citations: [] };
      return original(request);
    };
    const degraded = await research({ query: "refresh" }, context, dependencies);
    assert.equal(degraded.outcome, "no-links");

    // A degraded repeat never displaces a good report: the previous run's
    // report, extractions, numbered sources and documentation download all
    // survive untouched, and no archive folder is created.
    assert.equal(await readFile(join(cachePath, "report.md"), "utf8"), report);
    assert.ok((await readdir(join(cachePath, "extractions"))).length > 0);
    assert.ok((await readdir(join(cachePath, "sources"))).length > 1);
    assert.ok((await readdir(join(cachePath, "sources"))).includes("llms-full-one.example.md"));
    await assert.rejects(stat(`${cachePath}.1`), /ENOENT/);
    // The failed attempt is recorded in meta.json only.
    assert.equal(
      JSON.parse(await readFile(join(cachePath, "meta.json"), "utf8")).outcome,
      "no-links",
    );
    // The index entry is retained: the report it points at still exists.
    assert.ok((await readIndex(context.paths.cacheRoot)).searches.some((e) => e.slug === slug));
  } finally {
    Date.prototype.toISOString = originalIso;
  }
});

it("writes no cache directory for a fresh degraded query when telemetry is disabled", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { disableTelemetry: true });
  const original = context.models.complete;
  context.models.complete = async (request) => {
    if (request.model.model === "search") return { text: "No sources", citations: [] };
    return original(request);
  };
  const result = await research({ query: "silent degraded" }, context, dependencies);
  assert.equal(result.outcome, "no-links");
  // Acquiring the cache lock would create the directory; a fresh degraded
  // query with telemetry disabled must leave nothing behind.
  const cachePath = makeCachePath("silent degraded", root, context.paths.cacheRoot);
  await assert.rejects(readFile(cachePath), /ENOENT/);
  await assert.rejects(readFile(context.paths.cacheRoot), /ENOENT/);
});

it("preserves a previous run on a degraded refresh even with telemetry disabled", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { disableTelemetry: true });
  const originalIso = Date.prototype.toISOString;
  Date.prototype.toISOString = () => "2026-04-20T12:00:00.000Z";
  try {
    const completed = await research({ query: "silent refresh" }, context, dependencies);
    assert.equal(completed.outcome, "completed");
    const cachePath = join(root, completed.details.cachePath as string);
    await readFile(join(cachePath, "report.md"), "utf8");
    const slug = cachePath.split("/").pop() as string;
    assert.ok((await readIndex(context.paths.cacheRoot)).searches.some((e) => e.slug === slug));

    const original = context.models.complete;
    context.models.complete = async (request) => {
      if (request.model.model === "search") return { text: "No sources", citations: [] };
      return original(request);
    };
    const degraded = await research({ query: "silent refresh" }, context, dependencies);
    assert.equal(degraded.outcome, "no-links");

    await readFile(join(cachePath, "report.md"), "utf8");
    await assert.rejects(
      readFile(join(cachePath, "meta.json")),
      /ENOENT/,
      "telemetry stays disabled: no sidecar may appear",
    );
    assert.ok((await readIndex(context.paths.cacheRoot)).searches.some((e) => e.slug === slug));
  } finally {
    Date.prototype.toISOString = originalIso;
  }
});

it("archives a previous successful run to numbered siblings on same-day repeats", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root);
  const originalIso = Date.prototype.toISOString;
  Date.prototype.toISOString = () => "2026-04-20T12:00:00.000Z";
  try {
    const first = await research({ query: "archive" }, context, dependencies);
    assert.equal(first.outcome, "completed");
    const cachePath = join(root, first.details.cachePath as string);
    const firstReport = await readFile(join(cachePath, "report.md"), "utf8");
    assert.match(firstReport, /Summary\./);
    // Supplementary documentation download from the first run.
    await writeFile(join(cachePath, "sources", "llms-full-one.example.md"), "docs");
    const slug = cachePath.split("/").pop() as string;

    // Distinguish the second run's collation output.
    const original = context.models.complete;
    context.models.complete = async (request) => {
      if (request.model.model === "collate") return { text: "Summary v2.", citations: [] };
      return original(request);
    };
    const second = await research({ query: "archive" }, context, dependencies);
    assert.equal(second.outcome, "completed");

    // The canonical folder holds the new run; the previous run sits intact
    // in the .1 sibling, report beside exactly its own files.
    const secondReport = await readFile(join(cachePath, "report.md"), "utf8");
    assert.match(secondReport, /Summary v2\./);
    const archived = `${cachePath}.1`;
    assert.equal(await readFile(join(archived, "report.md"), "utf8"), firstReport);
    assert.equal(await readFile(join(archived, "query.txt"), "utf8"), "archive");
    assert.ok((await readdir(join(archived, "extractions"))).length > 0);
    assert.ok(
      (await readdir(join(archived, "sources"))).every((name) => !name.startsWith("llms-full-")),
      "documentation downloads stay with the live folder, not the archive",
    );
    assert.equal(
      JSON.parse(await readFile(join(archived, "meta.json"), "utf8")).outcome,
      "completed",
    );
    assert.ok((await readdir(join(cachePath, "sources"))).includes("llms-full-one.example.md"));
    assert.equal(
      JSON.parse(await readFile(join(cachePath, "meta.json"), "utf8")).outcome,
      "completed",
    );
    // One index entry, refreshed in place; the archive is not indexed.
    const entries = (await readIndex(context.paths.cacheRoot)).searches.filter(
      (e) => e.slug === slug,
    );
    assert.equal(entries.length, 1);

    // A third same-day run archives the second to .2, leaving .1 untouched.
    const third = await research({ query: "archive" }, context, dependencies);
    assert.equal(third.outcome, "completed");
    assert.equal(await readFile(join(`${cachePath}.2`, "report.md"), "utf8"), secondReport);
    assert.equal(await readFile(join(archived, "report.md"), "utf8"), firstReport);
    assert.match(await readFile(join(cachePath, "report.md"), "utf8"), /Summary v2\./);
  } finally {
    Date.prototype.toISOString = originalIso;
  }
});

it("archives a degraded-only folder when a later run succeeds", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root);
  const originalIso = Date.prototype.toISOString;
  Date.prototype.toISOString = () => "2026-04-20T12:00:00.000Z";
  try {
    const original = context.models.complete;
    context.models.complete = async (request) => {
      if (request.model.model === "search") return { text: "No sources", citations: [] };
      return original(request);
    };
    const degraded = await research({ query: "degraded then success" }, context, dependencies);
    assert.equal(degraded.outcome, "no-links");
    const cachePath = makeCachePath("degraded then success", root, context.paths.cacheRoot);
    assert.deepEqual(await readdir(cachePath), ["meta.json"]);

    context.models.complete = original;
    const completed = await research(
      { query: "degraded then success" },
      context,
      dependencies,
    );
    assert.equal(completed.outcome, "completed");
    await readFile(join(cachePath, "report.md"), "utf8");
    // The degraded attempt's sidecar is retained in the .1 archive.
    assert.equal(
      JSON.parse(await readFile(join(`${cachePath}.1`, "meta.json"), "utf8")).outcome,
      "no-links",
    );
  } finally {
    Date.prototype.toISOString = originalIso;
  }
});

it("preflights before paid work and preserves explicit model selection", async (t) => {
  const { context, dependencies, requests } = coreContext(await workspace(t));
  context.models.preflight = async (bindings) => [...bindings];
  await assert.rejects(research({ query: "invalid" }, context, dependencies), MissingModelsError);
  assert.deepEqual(requests, []);
});

it("uses isolated concurrent model, citation and logger state", async (t) => {
  const root = await workspace(t);
  const a = coreContext(join(root, "a"));
  const b = coreContext(join(root, "b"));
  a.context.models.complete = async () => ({
    text: "A",
    citations: [{ url: "https://a.example", title: "A" }],
  });
  b.context.models.complete = async () => ({
    text: "B",
    citations: [{ url: "https://b.example", title: "B" }],
  });
  const [ar, br] = await Promise.all([
    search({ query: "a" }, a.context),
    search({ query: "b" }, b.context),
  ]);
  assert.deepEqual(ar.details.sources, [{ url: "https://a.example", title: "A" }]);
  assert.deepEqual(br.details.sources, [{ url: "https://b.example", title: "B" }]);
});

it("keeps docs staging inside the configured root and cleans partial download failures", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { disableLlmsFullDiscovery: false });
  const paths = new Set<string>();
  dependencies.downloadLlmsFullToCache = async (url, staging) => {
    paths.add(staging);
    assert.equal(staging.startsWith(context.paths.stagingRoot + "/llms-"), true);
    await mkdir(join(staging, "sources"), { recursive: true });
    if (url.includes("two")) throw new Error("partial download");
    const file = join(staging, "sources/llms-full-one.example.md");
    await writeFile(file, "full documentation");
    return file;
  };
  const result = await research({ query: "docs" }, context, dependencies);
  assert.equal(paths.size, 1);
  assert.deepEqual(await readdir(context.paths.stagingRoot), []);
  assert.equal(
    await readFile(
      join(root, result.details.cachePath as string, "sources/llms-full-one.example.md"),
      "utf8",
    ),
    "full documentation",
  );
});

for (const failure of ["cancel", "cache-write"] as const) {
  it(`settles documentation writers and removes staging on ${failure}`, async (t) => {
    const root = await workspace(t);
    const { context, dependencies } = coreContext(root, { disableLlmsFullDiscovery: false });
    const controller = new AbortController();
    const cachePath = makeCachePath(failure, root, context.paths.cacheRoot);
    if (failure === "cache-write") {
      // Force the commit to fail at the index update: a same-day refresh
      // archives any pre-existing artefacts at the cache path itself, so an
      // obstacle there would be moved aside instead of failing the write.
      // Renaming onto a .index.json directory is a cache-write failure that
      // archiving cannot clear.
      await mkdir(context.paths.cacheRoot, { recursive: true });
      await mkdir(join(context.paths.cacheRoot, ".index.json"));
    }
    let start!: () => void;
    const started = new Promise<void>((r) => {
      start = r;
    });
    let settled = 0;
    dependencies.downloadLlmsFullToCache = async (_url, staging, signal) => {
      start();
      await new Promise<void>((r) => {
        if (signal!.aborted) r();
        else signal!.addEventListener("abort", () => r(), { once: true });
      });
      // Simulate a final write during shutdown. Cleanup must happen AFTER it.
      await mkdir(join(staging, "sources"), { recursive: true });
      await writeFile(join(staging, "sources", `llms-full-${settled++}.md`), "partial");
      return null;
    };
    const running = research(
      { query: failure },
      { ...context, signal: controller.signal },
      dependencies,
    );
    const rejected = assert.rejects(
      running,
      failure === "cancel" ? { name: "AbortError" } : /EISDIR|ENOTDIR|EEXIST/,
    );
    await started;
    if (failure === "cancel") controller.abort();
    await rejected;
    assert.equal(settled, 2);
    assert.deepEqual(await readdir(context.paths.stagingRoot), []);
    await assert.rejects(readFile(join(cacheLockDir(cachePath), "pid")), /ENOENT/);
  });
}

for (const stage of ["preflight", "fetch", "extract", "collate", "cache"] as const) {
  it(`propagates ${stage} cancellation rather than a degraded success`, async (t) => {
    const root = await workspace(t);
    const { context, dependencies } = coreContext(root);
    const controller = new AbortController();
    if (stage === "preflight") controller.abort();
    if (stage === "fetch")
      dependencies.fetchPages = async () => {
        controller.abort();
        return [];
      };
    const original = context.models.complete;
    context.models.complete = async (request) => {
      if (request.model.model === stage) controller.abort();
      return original(request);
    };
    await assert.rejects(
      research(
        { query: "cancel" },
        {
          ...context,
          signal: controller.signal,
          onProgress: (progress) => {
            if (stage === "cache" && progress.stage === "cache") controller.abort();
          },
        },
        dependencies,
      ),
      { name: "AbortError" },
    );
  });
}

it("keeps degraded results usable when telemetry lock or directory creation fails", async (t) => {
  const root = await workspace(t);
  const { context, dependencies, diagnostics } = coreContext(root);
  await writeFile(context.paths.cacheRoot, "not a directory");
  context.models.complete = async () => ({ text: "No sources", citations: [] });
  const result = await research({ query: "no sources" }, context, dependencies);
  assert.equal(result.outcome, "no-links");
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0], /Telemetry write failed/);
});

it("keeps completed research when optional staging cannot be created", async (t) => {
  const root = await workspace(t);
  const { context, dependencies, diagnostics } = coreContext(root, {
    disableLlmsFullDiscovery: false,
  });
  await mkdir(context.paths.cacheRoot, { recursive: true });
  await writeFile(context.paths.stagingRoot, "pre-existing file");
  const result = await research({ query: "optional docs" }, context, dependencies);
  assert.equal(result.outcome, "completed");
  assert.match(
    await readFile(join(root, result.details.cachePath as string, "report.md"), "utf8"),
    /Summary/,
  );
  assert.equal((await readIndex(context.paths.cacheRoot)).searches.length, 1);
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0], /Documentation staging setup failed/);
});

it("preserves completed research and diagnoses a failed staging cleanup", async (t) => {
  const root = await workspace(t);
  const { context, dependencies, diagnostics } = coreContext(root, {
    disableLlmsFullDiscovery: false,
  });
  let pending = 0;
  dependencies.downloadLlmsFullToCache = async () => {
    pending++;
    await Promise.resolve();
    pending--;
    return null;
  };
  dependencies.removeStaging = async (path) => {
    assert.equal(pending, 0, "writers must settle before cleanup");
    assert.ok(path.startsWith(context.paths.stagingRoot + "/llms-"));
    throw new Error("EACCES fixture cleanup failure");
  };
  const result = await research({ query: "cleanup failure" }, context, dependencies);
  assert.equal(result.outcome, "completed");
  assert.match(
    await readFile(join(root, result.details.cachePath as string, "report.md"), "utf8"),
    /Summary/,
  );
  assert.equal((await readdir(context.paths.stagingRoot)).length, 1);
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0], /Documentation staging cleanup failed: EACCES/);
});

it("does not create staging when discovery is disabled but telemetry is enabled", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, {
    disableTelemetry: false,
    disableLlmsFullDiscovery: true,
  });
  const result = await research({ query: "no docs" }, context, dependencies);
  assert.equal(
    JSON.parse(await readFile(join(root, result.details.cachePath as string, "meta.json"), "utf8"))
      .outcome,
    "completed",
  );
  await assert.rejects(readdir(context.paths.stagingRoot), /ENOENT/);
});

it("suppresses telemetry independently of documentation discovery", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, {
    disableTelemetry: true,
    disableLlmsFullDiscovery: false,
  });
  let downloaded = 0;
  dependencies.downloadLlmsFullToCache = async (_url, staging) => {
    assert.ok(staging.startsWith(context.paths.stagingRoot + "/"));
    downloaded++;
    return null;
  };
  const result = await research({ query: "docs without telemetry" }, context, dependencies);
  assert.equal(downloaded, 2);
  assert.deepEqual(await readdir(context.paths.stagingRoot), []);
  await assert.rejects(
    readFile(join(root, result.details.cachePath as string, "meta.json")),
    /ENOENT/,
  );
});

for (const operation of ["research", "collate"] as const) {
  it(`${operation} excludes search-only claims and preserves prior output on provenance failure`, async (t) => {
    const root = await workspace(t);
    const { context, dependencies, requests } = coreContext(root);
    const query = `provenance ${operation}`;
    const params = { query, searchSummary: "UNFETCHED CLAIM https://unfetched.example/", extractions: [{
      url: "https://one.example/page", title: "One", extraction: "Evidence", sourceType: "docs", status: "success",
    }] };
    const run = () => operation === "research" ? research({ query, maxUrls: 1 }, context, dependencies) : collate(params, context);
    const complete = context.models.complete;
    context.models.complete = async (request) => {
      if (request.model.model === "search") return { text: "UNFETCHED CLAIM. [One](https://one.example/page) [Other](https://unfetched.example/)", citations: [] };
      return complete(request);
    };
    const successful = await run();
    const path = join(root, successful.details.cachePath as string);
    const report = await readFile(join(path, "report.md"), "utf8");
    const index = await readFile(join(context.paths.cacheRoot, ".index.json"), "utf8");
    const input = requests.find((request) => request.model.model === "collate")!;
    assert.doesNotMatch(input.userMessage, /UNFETCHED CLAIM|unfetched|\.search|Source assessment/);
    const sourceCount = JSON.parse(input.userMessage).sources.length;
    assert.equal(report.match(/\| S\d+ \|/g)?.length, sourceCount);
    assert.equal(report.match(/## Source assessment/g)?.length, 1);
    assert.doesNotMatch(report, /## Source index/);
    if (operation === "research") {
      const meta = JSON.parse(await readFile(join(path, "meta.json"), "utf8"));
      assert.equal(meta.stages.collate.summaryChars, "Summary.".length);
    }
    context.models.complete = async (request) => request.model.model === "collate"
      ? { text: "Read `sources/17-fiction.md`. [S17]", citations: [] } : complete(request);
    if (operation === "research") {
      const failed = await run();
      assert.equal(failed.outcome, "collate-failed");
      assert.match(failed.text, /provenance validation failed.*report already saved .* was preserved/s);
      assert.equal(failed.details.cachePath, "");
      assert.equal(failed.details.preservedCachePath, successful.details.cachePath);
    } else {
      await assert.rejects(run(), /provenance validation failed/);
    }
    assert.equal(await readFile(join(path, "report.md"), "utf8"), report);
    assert.equal(await readFile(join(context.paths.cacheRoot, ".index.json"), "utf8"), index);
    await assert.rejects(stat(`${path}.1`), /ENOENT/);
    await assert.rejects(readdir(context.paths.stagingRoot), /ENOENT/);
  });
}

it("does not collate empty or failed caller evidence, and treats empty research extractions as failed", async (t) => {
  const root = await workspace(t);
  const { context, dependencies, requests } = coreContext(root);
  await assert.rejects(collate({ query: "empty", extractions: [{
    url: "https://one.example", title: "Empty", extraction: " \n", sourceType: "docs", status: "success",
  }] }, context), /successful, non-empty extraction/);
  assert.equal(requests.length, 0, "invalid caller evidence must fail before cost");
  const complete = context.models.complete;
  context.models.complete = async (request) => request.model.model === "extract"
    ? { text: " \n", citations: [] } : complete(request);
  const result = await research({ query: "no extracted evidence" }, context, dependencies);
  assert.equal(result.outcome, "extraction-failed");
  assert.equal(requests.filter((request) => request.model.model === "collate").length, 0);
  const metaPath = makeCachePath("no extracted evidence", root, context.paths.cacheRoot);
  const meta = JSON.parse(await readFile(join(metaPath, "meta.json"), "utf8"));
  assert.equal(meta.stages.extract.succeeded, 0);
  assert.equal(meta.stages.extract.failed, 2);
  // Owner decision 2026-11-07: a run without extracted evidence still keeps
  // its fetched pages and writes the extraction-failure report.
  assert.match(await readFile(join(metaPath, "report.md"), "utf8"), /## Extraction Failed/);
});

it("does not write metadata or staging when both features are disabled", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { disableTelemetry: true });
  const result = await research({ query: "disabled" }, context, dependencies);
  await assert.rejects(
    readFile(join(root, result.details.cachePath as string, "meta.json")),
    /ENOENT/,
  );
  await assert.rejects(readdir(context.paths.stagingRoot), /ENOENT/);
});
