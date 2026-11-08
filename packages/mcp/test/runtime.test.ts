// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createRuntime, identity, StandaloneError } from "../src/runtime.js";
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
  try {
    const calls: Record<string, number> = {};
    const runtime = await createRuntime(f.config, {
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
      researchDependencies: {
        fetchPages: async () => [{ ...page, status: "success", source: "markdown" }],
        downloadLlmsFullToCache: async () => null,
      },
    });
    const search = await runtime.execute("intelli_search", { query: "search" });
    assert.deepEqual(search.details.sources, [{ url: page.url, title: "Docs" }]);
    const extract = await runtime.execute("intelli_extract", {
      ...page,
      query: "extract",
      focusPrompt: "Facts only",
    });
    assert.match(extract.text, /Official documentation/);
    const collate = await runtime.execute("intelli_collate", {
      query: "collate",
      extractions: [extraction],
      fullPages: [page],
    });
    assert.match(collate.text, /host's file-reading capability/);
    assert(!collate.text.includes("`read "));
    const progress: string[] = [];
    const research = await runtime.execute(
      "intelli_research",
      { query: "research", maxUrls: 1 },
      { onProgress: (p) => progress.push(p.stage) },
    );
    assert.equal(research.outcome, "completed");
    assert.match(research.text, /Related cached searches/);
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

test("MCP research keeps the valid third candidate after two longer provenance failures", async () => {
  const f = await fixture();
  try {
    const caps: unknown[] = [];
    const runtime = await createRuntime(
      { ...f.config, settings: { ...f.config.settings, collationMaxTokens: 100, outputBudgetRetries: 2 } },
      {
        env: { FIXTURE_KEY: "fixture-secret" },
        logger,
        fetch: fakeTransport((body) => {
          if (body.model === "perplexity/sonar") return json(completion(`[Docs](${page.url})`));
          if (body.model === "fixture/extract") return json(completion("Official docs, current.\nFacts"));
          caps.push(body.max_completion_tokens);
          const text = caps.length === 1
            ? "The longest truncated synthesis is invalid and cites unknown [S99]."
            : caps.length === 2 ? "The second longest is invalid [S98]." : "Valid [S1].";
          return json(completion(text, { choices: [{ message: { content: text }, finish_reason: "length" }] }));
        }),
        researchDependencies: {
          fetchPages: async () => [{ ...page, status: "success", source: "markdown" }],
          downloadLlmsFullToCache: async () => null,
        },
      },
    );
    const result = await runtime.execute("intelli_research", { query: "valid third candidate", maxUrls: 1 });
    assert.deepEqual(caps, [100, 200, 400]);
    assert.equal(result.outcome, "completed");
    assert.match(result.text, /Valid \[S1\]/);
    assert.doesNotMatch(result.text, /\[S99\]|\[S98\]/);
    const report = await readFile(join(result.details.cachePath as string, "report.md"), "utf8");
    assert.match(report, /Valid \[S1\]/);
  } finally {
    await f.cleanup();
  }
});

for (const scenario of ["complete", "truncated-errors", "mixed-errors"] as const) {
  test(`MCP candidate precedence and first-ranked error: ${scenario}`, async () => {
    const f = await fixture();
    try {
      const caps: unknown[] = [];
      const unknown = "Bad [S99].";
      const absentUrl = "The longest invalid synthesis. ".repeat(5) + "https://absent.example/page";
      const cacheReference = "An invalid cache reference: `extractions/01-invented.md`.";
      const texts = scenario === "complete"
        ? ["A much longer but truncated synthesis with useful evidence [S1].", "Complete [S1]."]
        : scenario === "mixed-errors" ? [cacheReference, absentUrl, unknown] : [unknown, absentUrl, cacheReference];
      const runtime = await createRuntime(
        { ...f.config, settings: { ...f.config.settings, collationMaxTokens: 100, outputBudgetRetries: 2 } },
        {
          env: { FIXTURE_KEY: "fixture-secret" },
          logger,
          fetch: fakeTransport((body) => {
            if (body.model === "perplexity/sonar") return json(completion(`[Docs](${page.url})`));
            if (body.model === "fixture/extract") return json(completion("Official docs, current.\nFacts"));
            caps.push(body.max_completion_tokens);
            const text = texts[caps.length - 1];
            const finish = caps.length === texts.length && scenario !== "truncated-errors" ? "stop" : "length";
            return json(completion(text, { choices: [{ message: { content: text }, finish_reason: finish }] }));
          }),
          researchDependencies: {
            fetchPages: async () => [{ ...page, status: "success", source: "markdown" }],
            downloadLlmsFullToCache: async () => null,
          },
        },
      );
      const result = await runtime.execute("intelli_research", { query: scenario, maxUrls: 1 });
      assert.deepEqual(caps, scenario === "complete" ? [100, 200] : [100, 200, 400]);
      assert.equal(result.outcome, scenario === "complete" ? "completed" : "collate-failed");
      const report = await readFile(join(result.details.cachePath as string, "report.md"), "utf8");
      for (const output of [result.text, report]) {
        if (scenario === "complete") {
          assert.match(output, /Complete \[S1\]\./);
          assert.doesNotMatch(output, /A much longer but truncated synthesis|Collation output reached its cap/);
        } else {
          const firstReason = scenario === "mixed-errors" ? "unknown or omitted source ID" : "a prose URL is absent from the supplied evidence";
          assert.ok(output.includes(`Collation provenance validation failed: ${firstReason}`));
          assert.doesNotMatch(output, scenario === "mixed-errors"
            ? /a prose URL is absent|generated a cache-file reference/
            : /unknown or omitted source ID|generated a cache-file reference/);
        }
      }
    } finally {
      await f.cleanup();
    }
  });
}

test("MCP dual-bound collation names both limits and preserves full extractions", async () => {
  const f = await fixture();
  try {
    let sent: Array<{ content: string }> = [];
    const runtime = await createRuntime(
      { ...f.config, settings: { ...f.config.settings, collationInputBudgetTokens: 10_000, collationSourceMaxTokens: 256 } },
      {
        env: { FIXTURE_KEY: "fixture-secret" },
        logger,
        fetch: fakeTransport((body) => {
          sent = body.messages as Array<{ content: string }>;
          return json(completion("Summary [S1]."));
        }),
      },
    );
    const text = "a".repeat(10_000);
    const result = await runtime.execute("intelli_collate", {
      query: "dual-bound supplied input",
      extractions: Array.from({ length: 40 }, (_, i) => ({
        ...extraction, url: `https://source-${i}.example`, extraction: text,
      })),
    });
    assert.equal(result.outcome, "completed");
    const payload = JSON.parse(sent[1].content) as { sources: Array<{ extraction: string }> };
    assert.equal(payload.sources.length, 40);
    assert.ok(payload.sources.every((s) => s.extraction.length > 0 && s.extraction.length < 1024));
    const report = await readFile(join(result.details.cachePath as string, "report.md"), "utf8");
    for (const output of [result.text, report]) {
      assert.match(output, /Trimmed by both limits \(40\)/);
      assert.match(output, /per-source limit \(collationSourceMaxTokens\)/);
      assert.match(output, /run's total exceeded the 10000-token input budget \(collationInputBudgetTokens\)/);
      assert.match(output, /raise collationSourceMaxTokens/);
      assert.match(output, /raise collationInputBudgetTokens/);
      assert.match(output, /full extraction: `[^`]+\/extractions\/01-source-0-example\.md`/);
      assert.match(output, /The omitted text is in the extraction files below, saved in full from the supplied extractions\. Read them for the missing detail; repeating collation will not recover it\./);
      assert.match(output, /\*\*Configuration\*\*: /);
    }
    const saved = await readFile(join(result.details.cachePath as string, "extractions", "01-source-0-example.md"), "utf8");
    assert.ok(saved.includes(text));
  } finally {
    await f.cleanup();
  }
});

test("the collation input budget trims the prompt and the MCP result says what was trimmed", async () => {
  const f = await fixture();
  try {
    let sent: Array<{ content: string }> = [];
    const runtime = await createRuntime(
      {
        ...f.config,
        settings: { ...f.config.settings, collationInputBudgetTokens: 10_000 },
      } as typeof f.config,
      {
        env: { FIXTURE_KEY: "fixture-secret" },
        logger,
        fetch: fakeTransport((body) => {
          sent = body.messages as Array<{ content: string }>;
          return json(completion("Summary citing the evidence."));
        }),
      },
    );
    // Two 21,000-character extractions exceed the 40,000-character budget.
    const line = "Evidence line for the collation input budget.\n";
    const long = line.repeat(Math.ceil(21_000 / line.length)).slice(0, 21_000);
    const result = await runtime.execute("intelli_collate", {
      query: "collation input budget",
      extractions: [
        { ...extraction, url: "https://one.example", extraction: long },
        { ...extraction, url: "https://two.example", extraction: long },
      ],
    });
    assert.equal(result.outcome, "completed");
    assert.match(result.text, /\*\*Collation input trimmed\*\*: 2 of 2 extraction/);
    assert.match(result.text, /full extraction: `[^`]+\/extractions\/01-/);
    // The evidence actually sent, read back from the wire payload.
    const payload = JSON.parse(sent[1].content) as {
      sources: Array<{ extraction: string }>;
    };
    const sentChars = payload.sources.reduce((total, source) => total + source.extraction.length, 0);
    assert.ok(sentChars <= 39_200, `sent ${sentChars} characters of extraction text`);
    assert.ok(sentChars > 0);
    // The standalone adapter reports the physical cache path, not a display path.
    const saved = await readFile(
      join(result.details.cachePath as string, "extractions", "01-one-example.md"),
      "utf8",
    );
    assert.ok(saved.length > 21_000, "the saved extraction keeps the whole text");
  } finally {
    await f.cleanup();
  }
});
