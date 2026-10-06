// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
  await assert.rejects(collate({ query: "empty manual", extractions: [] }, context), /no visible text.*collationMaxTokens/);
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

it("clears a previous successful run's artefacts on a degraded refresh of the same query", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root);
  // Freeze the date so both runs resolve to the same cache path.
  const originalIso = Date.prototype.toISOString;
  Date.prototype.toISOString = () => "2026-04-20T12:00:00.000Z";
  try {
    const completed = await research({ query: "refresh" }, context, dependencies);
    assert.equal(completed.outcome, "completed");
    const cachePath = join(root, completed.details.cachePath as string);
    await readFile(join(cachePath, "report.md"), "utf8");
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

    // The older report/extraction set must not survive next to the newer
    // degraded telemetry; the documentation download is preserved.
    assert.deepEqual((await readdir(cachePath)).sort(), ["meta.json", "sources"]);
    assert.deepEqual(await readdir(join(cachePath, "sources")), ["llms-full-one.example.md"]);
    assert.equal(
      JSON.parse(await readFile(join(cachePath, "meta.json"), "utf8")).outcome,
      "no-links",
    );
    // The index entry is dropped too, so cache suggest cannot surface a
    // search whose report was just cleared.
    assert.deepEqual((await readIndex(context.paths.cacheRoot)).searches, []);
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

it("clears artefacts and drops the index entry on a degraded refresh even with telemetry disabled", async (t) => {
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

    await assert.rejects(readFile(join(cachePath, "report.md")), /ENOENT/);
    await assert.rejects(
      readFile(join(cachePath, "meta.json")),
      /ENOENT/,
      "telemetry stays disabled: no sidecar may appear",
    );
    assert.deepEqual((await readIndex(context.paths.cacheRoot)).searches, []);
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
    if (failure === "cache-write") await mkdir(join(cachePath, "report.md"), { recursive: true });
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
