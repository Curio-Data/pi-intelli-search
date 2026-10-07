// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { search, extract, collate, research, MissingModelsError } from "../src/core/index.js";
import { cacheLockDir, makeCachePath, readIndex } from "../src/core/cache.js";
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

it("rejects empty collation instead of reporting a completed cache", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root);
  const complete = context.models.complete;
  context.models.complete = async (request) => request.model.model === "collate"
    ? { text: " \n", citations: [] } : complete(request);
  await assert.rejects(research({ query: "empty synthesis" }, context, dependencies), /no visible text.*collationMaxTokens/);
  await assert.rejects(collate({ query: "empty manual", extractions: [{
    url: "https://one.example", title: "One", extraction: "body", sourceType: "docs", status: "success",
  }] }, context), /no visible text.*collationMaxTokens/);
  assert.deepEqual(await readdir(root), [], "empty synthesis must not create success artefacts");
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
    await assert.rejects(run(), /provenance validation failed/);
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
