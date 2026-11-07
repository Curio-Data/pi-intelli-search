// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { search, extract, collate, research, MissingModelsError } from "../src/core/index.js";
import type { ResearchDependencies } from "../src/core/operations/research.js";
import { cacheLockDir, makeCachePath, readIndex, withLock } from "../src/core/cache.js";
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
  assert.match(result.text, /missing\.py.*Nothing fetched: HTTP 404: Not Found/);
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
  const base = coreContext(root);
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
  assert.match(result.text, /https:\/\/(one|two)\.example\/page: Output cap reached without visible text at 100 tokens and again after one retry at 200 tokens/);
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
  assert.match(result.text, /Collation output reached its cap/);
});

it("never replaces a successful report committed while collation was failing", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { disableTelemetry: false });
  const query = "concurrent collate failure";
  const path = makeCachePath(query, root, context.paths.cacheRoot);
  const complete = context.models.complete;
  let collated!: () => void;
  const collateDone = new Promise<void>((resolve) => (collated = resolve));
  context.models.complete = async (request) => {
    if (request.model.model !== "collate") return complete(request);
    collated();
    return { text: " ", citations: [] };
  };
  // Hold the cache lock so the failing run decides only after a concurrent
  // run's successful report lands, as when that run commits first.
  let run!: ReturnType<typeof research>;
  await mkdir(dirname(path), { recursive: true });
  await withLock(cacheLockDir(path), async () => {
    run = research({ query }, context, dependencies);
    await collateDone;
    await new Promise((resolve) => setTimeout(resolve, 100));
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "report.md"), "# Report\n\n## Summary\n\nConcurrent success.\n");
  });
  const result = await run;
  assert.equal(result.outcome, "collate-failed");
  assert.equal(result.details.cachePath, "");
  assert.ok(result.details.preservedCachePath);
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
  assert.match(result.text, /after one retry at a larger cap/);
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

for (const outcome of ["no-links", "fetch-failed", "extraction-failed"] as const) {
  it(`retains the ${outcome} degraded outcome without a report`, async (t) => {
    const root = await workspace(t);
    const { context, dependencies, requests } = coreContext(root);
    const original = context.models.complete;
    context.models.complete = async (request) => {
      if (outcome === "no-links") {
        requests.push(request);
        return { text: "No sources", citations: [] };
      }
      if (outcome === "extraction-failed" && request.model.model === "extract")
        throw new Error("fixture extraction failure");
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
  await assert.rejects(readFile(join(metaPath, "report.md")), /ENOENT/);
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
