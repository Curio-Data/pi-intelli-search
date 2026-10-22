// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createRuntime, identity, StandaloneError } from "../src/runtime.js";
import { Check } from "typebox/value";
import { researchOutputSchema } from "../../../src/core/output-schemas.js";
import { markdownPage } from "../../../test/helpers/page-fixtures.js";
import { CACHE_SUGGEST_PROMPT } from "../../../src/core/prompts.js";
import { completion, fakeTransport, fixture, json, logger } from "./helpers.js";
import type { OperationInputs } from "../../../src/core/contracts.js";

const page = { url: "https://docs.example/page", title: "Docs", content: "## Docs\nContent" };
const extraction = {
  url: page.url,
  title: page.title,
  extraction: "Extracted facts",
  sourceType: "official docs",
  status: "success",
};

test("all shared operations run outside the host with standalone policy and cache identity", async () => {
  const f = await fixture();
  let runtime: Awaited<ReturnType<typeof createRuntime>> | undefined;
  try {
    const calls: Record<string, number> = {};
    runtime = await createRuntime(f.config, {
      env: { FIXTURE_KEY: "fixture-secret" },
      logger,
      fetch: fakeTransport((body) => {
        const model = String(body.model);
        calls[model] = (calls[model] ?? 0) + 1;
        if (calls[model] % 2 === 1) return json({ error: { code: 503 } }, 503);
        if ((body.messages as Array<{ content: string }>)[0].content === CACHE_SUGGEST_PROMPT)
          return json(completion('[{"index":1,"relevance":"Related fixture"}]'));
        return json(
          completion(
            model === "perplexity/sonar"
              ? `[Docs](${page.url})`
              : model === "fixture/extract"
                ? "Official documentation, current.\nFacts"
                : "Synthesised facts",
          ),
        );
      }),
      pageTransport: markdownPage(page.content),
    });
    const search = await runtime.execute("intelli_search", { query: "search" });
    assert.deepEqual(search.details.sources, [{ url: page.url, title: "Docs" }]);
    assert.deepEqual(
      search.execution.attempts.map((item) => [item.role, item.state]),
      [
        ["search", "failed"],
        ["search", "succeeded"],
      ],
    );
    const extract = await runtime.execute("intelli_extract", {
      ...page,
      query: "extract",
      focusPrompt: "Facts only",
    });
    assert.match(extract.text, /Official documentation/);
    assert.equal(extract.execution.attempts.length, 2);
    assert(
      extract.execution.attempts.every((item) => item.role === "extract" && item.pageId === "S1"),
    );
    const collate = await runtime.execute("intelli_collate", {
      query: "collate",
      extractions: [extraction],
      fullPages: [page],
    });
    assert.match(collate.text, /host's file-reading capability/);
    assert(!collate.text.includes("`read "));
    assert.equal(collate.execution.attempts.length, 2);
    assert(collate.execution.attempts.every((item) => item.role === "collate"));
    assert(collate.data?.cache.status === "committed");
    const collateReport = collate.data.cache.reportPath;
    await assert.rejects(readFile(join(f.dir, ".search/.index.json")), /ENOENT/);
    const progress: string[] = [];
    const research = await runtime.execute(
      "intelli_research",
      { query: "research", maxUrls: 1 },
      { onProgress: (p) => progress.push(p.stage) },
    );
    assert.equal(research.outcome, "completed");
    assert(Check(researchOutputSchema, research.data));
    assert.equal(research.data!.text, research.text);
    assert.deepEqual(research.data!.details, research.details);
    assert.deepEqual(
      [...new Set(research.execution.attempts.map((item) => item.role))],
      ["search", "extract", "collate", "suggest"],
    );
    assert(
      research.execution.attempts.every(
        (item) => item.operationId === research.execution.operationId,
      ),
    );
    assert.equal(research.execution.accounting.attempts, research.execution.attempts.length);
    assert.match(research.text, /Related cached searches/);
    assert(
      research.text.includes(collateReport),
      "registered research reads the verified collate namespace",
    );
    assert(!research.text.includes("`read "));
    assert(progress.includes("search") && progress.includes("collate"));
    const path = research.details.cachePath as string;
    assert(path.startsWith(join(f.dir, ".search/")));
    assert.match(await readFile(join(path, "report.md"), "utf8"), /Synthesised facts/);
    const meta = JSON.parse(await readFile(join(path, "meta.json"), "utf8"));
    assert.equal(meta.packageName, identity.name);
    assert.equal(meta.adapter, "mcp");
    assert.equal(meta.extensionVersion, identity.version);
    assert.equal(calls["perplexity/sonar"], 4);
    assert.equal(calls["fixture/collate"], 4);
    assert((calls["fixture/extract"] ?? 0) >= 4);
  } finally {
    await runtime?.close();
    await f.cleanup();
  }
});

test("runtime errors have safe stable categories, including cancellation", async () => {
  const f = await fixture();
  try {
    const runtime = await createRuntime(f.config, { env: {}, logger });
    const code = (expected: string) => (error: unknown) =>
      error instanceof StandaloneError && error.code === expected && error.cause === undefined;
    await assert.rejects(
      runtime.execute("intelli_search", { query: "" }),
      code("INVALID_ARGUMENTS"),
    );
    await assert.rejects(
      runtime.execute("intelli_search", { query: "test" }),
      code("CONFIGURATION"),
    );
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      runtime.execute("intelli_search", { query: "test" }, { signal: controller.signal }),
      code("CANCELLED"),
    );
    const provider = await createRuntime(f.config, {
      env: { FIXTURE_KEY: "fixture-secret" },
      logger,
      fetch: fakeTransport(() => json({ error: { code: 401, message: "fixture-secret" } }, 401)),
    });
    await assert.rejects(
      provider.execute("intelli_extract", { ...page, query: "test" }),
      code("PROVIDER"),
    );
  } finally {
    await f.cleanup();
  }
});

test("missing later-stage models fail before any paid inference", async () => {
  const f = await fixture();
  let paid = 0;
  try {
    const runtime = await createRuntime(f.config, {
      env: { FIXTURE_KEY: "fixture-secret" },
      logger,
      fetch: async (url) => {
        if (String(url).endsWith("/models")) return json({ data: [] });
        paid++;
        return json(completion());
      },
    });
    await assert.rejects(runtime.execute("intelli_research", { query: "test" }), /unavailable/);
    assert.equal(paid, 0);
    assert.deepEqual(await readdir(f.dir), []);
  } finally {
    await f.cleanup();
  }
});

test("degraded research remains a result and malformed tool arguments never reach transport", async () => {
  const f = await fixture();
  let calls = 0;
  try {
    const runtime = await createRuntime(f.config, {
      env: { FIXTURE_KEY: "fixture-secret" },
      logger,
      fetch: fakeTransport(() => {
        calls++;
        return json(completion("No usable links"));
      }),
    });
    const bad: unknown[] = [
      { query: "" },
      { query: "x", maxUrls: 1.5 },
      { query: "x", maxUrls: -1 },
      { query: "x", apiKey: "secret" },
      { query: "x", domains: ["https://not-a-hostname"] },
    ];
    for (const params of bad)
      await assert.rejects(
        runtime.execute("intelli_research", params as OperationInputs["intelli_research"]),
        /arguments|query|maxUrls|hostnames/,
      );
    assert.equal(calls, 0);
    const result = await runtime.execute("intelli_research", { query: "no sources" });
    assert.equal(result.outcome, "no-links");
    assert.equal(calls, 2);
  } finally {
    await f.cleanup();
  }
});
