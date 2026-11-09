// test/shared.test.ts — Unit tests for src/tools/shared.ts builders.
//
// These builders were extracted from inline code in the four tools during
// the v0.12.1 simplification. The tests lock the exact structure the LLM
// prompts and tool results had at extraction time, so later edits to a
// builder fail loudly here instead of silently changing prompt text.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSearchPayloadPatch,
  appendDomainFilter,
  buildExtractionMessage,
  buildCollationMessage,
  formatCacheAppendix,
} from "../src/tools/shared.js";
import { formatCollationTrimNotice } from "../src/core/messages.js";
import { planCollationBudget } from "../src/core/collation-budget.js";
import { MAX_OUTPUT_TOKENS, TUNING_RANGES } from "../src/core/defaults.js";
import { allocateSourceIdentity } from "../src/core/cache.js";
import { TRUNCATED_MARKER, truncateContent } from "../src/util.js";
import type { ExtractResult } from "../src/types.js";

describe("appendDomainFilter", () => {
  it("returns the query unchanged when no domains are given", () => {
    assert.strictEqual(appendDomainFilter("q"), "q");
    assert.strictEqual(appendDomainFilter("q", []), "q");
    assert.strictEqual(appendDomainFilter("q", undefined), "q");
  });

  it("appends a single site filter", () => {
    assert.strictEqual(appendDomainFilter("q", ["docs.python.org"]), "q site:docs.python.org");
  });

  it("joins multiple domains with OR site:", () => {
    assert.strictEqual(appendDomainFilter("q", ["a.com", "b.com"]), "q site:a.com OR site:b.com");
  });
});

describe("truncateContent", () => {
  it("returns content unchanged at or under the cap", () => {
    assert.strictEqual(truncateContent("abc", 3), "abc");
    assert.strictEqual(truncateContent("abc", 10), "abc");
  });

  it("slices over-cap content and appends the unified marker", () => {
    const out = truncateContent("x".repeat(100), 50);
    assert.strictEqual(out, "x".repeat(50) + TRUNCATED_MARKER);
  });
});

describe("buildExtractionMessage", () => {
  it("wraps content and query, omitting Focus when not given", () => {
    const msg = buildExtractionMessage("PAGE", "the query", undefined, 1000);
    assert.strictEqual(
      msg,
      "Web page content:\n---\nPAGE\n---\n\nExtract information relevant to: the query\n",
    );
  });

  it("includes the Focus line when focusPrompt is given", () => {
    const msg = buildExtractionMessage("PAGE", "the query", "only APIs", 1000);
    assert.ok(msg.endsWith("\nFocus: only APIs\n"));
  });

  it("truncates content beyond maxChars with the unified marker", () => {
    const msg = buildExtractionMessage("y".repeat(200), "q", undefined, 100);
    assert.ok(msg.includes("y".repeat(100) + TRUNCATED_MARKER));
    assert.ok(!msg.includes("y".repeat(101)));
  });
});

function makeExt(url: string, title: string): ExtractResult {
  return {
    url,
    title,
    extraction: `EXTRACTED:${url}`,
    sourceType: "official docs",
    currentness: "current",
    status: "success",
  };
}

describe("buildCollationMessage", () => {
  it("includes only successful extraction evidence, not search claims or cache paths", () => {
    const msg = buildCollationMessage(
      "the query", ".search/2026-01-01-slug-hash", "SEARCH SUMMARY https://unfetched.example/",
      [makeExt("https://example.com/a", "Page A"), makeExt("https://other.org/b", "Page B"),
        { ...makeExt("https://failed.example", "Failed"), status: "failed" },
        { ...makeExt("https://empty.example", "Empty"), extraction: " \n" }],
    );
    assert.deepEqual(JSON.parse(msg), {
      query: "the query",
      sources: [
        { id: "S1", url: "https://example.com/a", title: "Page A", type: "official docs", extraction: "EXTRACTED:https://example.com/a" },
        { id: "S2", url: "https://other.org/b", title: "Page B", type: "official docs", extraction: "EXTRACTED:https://other.org/b" },
      ],
    });
    assert.doesNotMatch(msg, /SEARCH SUMMARY|unfetched|failed|empty|\.search/);
  });

  it("marks inferred sources and their final redirect URL for the collation model", () => {
    const inferred = {
      ...makeExt("https://readme.md", "README"),
      inferred: true,
      finalUrl: "https://downloads.example.net/readme.txt",
    };
    const cited = makeExt("https://docs.example/guide", "Guide");
    const msg = buildCollationMessage("q", ".search/x", undefined, [cited, inferred]);
    assert.deepEqual(JSON.parse(msg).sources, [
      {
        id: "S1",
        url: "https://docs.example/guide",
        title: "Guide",
        type: "official docs",
        extraction: "EXTRACTED:https://docs.example/guide",
      },
      {
        id: "S2",
        url: "https://readme.md",
        title: "README",
        type: "official docs",
        extraction: "EXTRACTED:https://readme.md",
        inferredFromText: true,
        finalUrl: "https://downloads.example.net/readme.txt",
      },
    ]);
  });

  it("omits the search summary section when not given", () => {
    const msg = buildCollationMessage("q", ".search/x", undefined, [
      makeExt("https://a.com/", "t"),
    ]);
    assert.ok(!msg.includes("Search summary"));
  });

  it("keeps evidence IDs independent of file slots in mixed runs", () => {
    const extractions = [
      { ...makeExt("https://a.example/", "a"), extraction: "", status: "failed" as const },
      makeExt("https://b.example/", "b"),
      makeExt("https://c.example/", "c"),
    ];
    const identity = allocateSourceIdentity(extractions, [
      ...extractions.map((e) => ({ url: e.url, title: e.title, content: "page", status: "success" as const })),
    ]);
    const msg = buildCollationMessage(
      "q",
      ".search/x",
      undefined,
      extractions.filter((e) => e.status === "success"),
      identity,
    );
    assert.deepEqual(JSON.parse(msg).sources.map((source: { id: string }) => source.id), ["S1", "S2"]);
    assert.doesNotMatch(msg, /\.md|\.search/);
    assert.equal(identity.extractionFileFor("https://b.example/"), "02-b-example.md");
  });

  it("omits the full-page line when the identity has no source file for a URL", () => {
    const extraction = makeExt("https://a.example/", "a");
    const identity = allocateSourceIdentity([extraction], []);
    const msg = buildCollationMessage("q", ".search/x", undefined, [extraction], identity);
    assert.doesNotMatch(msg, /Full page file|Extraction file|\.search/);
    assert.equal(JSON.parse(msg).sources[0].id, "S1");
  });
});

describe("formatCacheAppendix", () => {
  it("lists cache path, report, source counts, and read hints", () => {
    const out = formatCacheAppendix(".search/slug", 3, 2);
    assert.ok(out.startsWith("\n\n---\n"));
    assert.ok(out.includes("**Cache**: `.search/slug/`\n"));
    assert.ok(out.includes("**Report**: `.search/slug/report.md`\n"));
    assert.ok(out.includes("**Sources**: 3 succeeded, 2 failed\n"));
    assert.ok(out.includes("Read the report: `read .search/slug/report.md`\n"));
    assert.ok(out.includes("Choose exact extraction and full-page paths"));
    assert.doesNotMatch(out, /01-\*/);
  });
});

describe("buildSearchPayloadPatch", () => {
  const baseSettings = {
    searchWebSearch: { enabled: true, engine: "exa", maxResults: 8, reasoning: "minimal" },
  } as unknown as Parameters<typeof buildSearchPayloadPatch>[0];

  it("returns undefined when the feature is disabled", () => {
    const settings = { searchWebSearch: { enabled: false } } as unknown as Parameters<
      typeof buildSearchPayloadPatch
    >[0];
    assert.strictEqual(buildSearchPayloadPatch(settings, "openrouter"), undefined);
  });

  it("returns undefined for non-OpenRouter providers (tool id is OpenRouter-specific)", () => {
    assert.strictEqual(buildSearchPayloadPatch(baseSettings, "minimax"), undefined);
  });

  it("attaches the openrouter:web_search server tool with mapped parameters", () => {
    const patch = buildSearchPayloadPatch(baseSettings, "openrouter");
    assert.ok(patch);
    const patched = patch({});
    const tools = patched.tools as Array<{ type: string; parameters: Record<string, unknown> }>;
    assert.strictEqual(tools.length, 1);
    assert.strictEqual(tools[0].type, "openrouter:web_search");
    assert.strictEqual(tools[0].parameters.engine, "exa");
    assert.strictEqual(tools[0].parameters.max_results, 8);
  });

  it("merges per-call domains with settings allowedDomains, deduped", () => {
    const settings = {
      searchWebSearch: { enabled: true, allowedDomains: ["docs.a.example"], excludedDomains: ["x.example"] },
    } as unknown as Parameters<typeof buildSearchPayloadPatch>[0];
    const patch = buildSearchPayloadPatch(settings, "openrouter", ["docs.b.example", "docs.a.example"]);
    const patched = patch({}) as { tools: Array<{ parameters: Record<string, unknown> }> };
    assert.deepStrictEqual(patched.tools[0].parameters.allowed_domains, [
      "docs.a.example",
      "docs.b.example",
    ]);
    assert.deepStrictEqual(patched.tools[0].parameters.excluded_domains, ["x.example"]);
  });

  it("drops unknown engines and clamps out-of-range maxResults instead of sending them", () => {
    const settings = {
      searchWebSearch: { enabled: true, engine: "bogus", maxResults: 999 },
    } as unknown as Parameters<typeof buildSearchPayloadPatch>[0];
    const patch = buildSearchPayloadPatch(settings, "openrouter");
    const patched = patch({}) as { tools: Array<{ parameters: Record<string, unknown> }> };
    assert.strictEqual(patched.tools[0].parameters.engine, undefined);
    assert.strictEqual(patched.tools[0].parameters.max_results, 25);
  });

  it("never clobbers an existing tools array on the payload", () => {
    const patch = buildSearchPayloadPatch(baseSettings, "openrouter");
    const existing = { tools: [{ type: "function", function: { name: "x" } }] };
    assert.strictEqual(patch(existing), existing);
  });
});

describe("formatCollationTrimNotice", () => {
  const identity = allocateSourceIdentity(
    [
      { url: "https://a.example/", title: "a", extraction: "x", sourceType: "docs", currentness: "current", status: "success" as const },
      { url: "https://b.example/", title: "b", extraction: "x", sourceType: "docs", currentness: "current", status: "success" as const },
    ],
    [],
  );

  it("writes raw numbers, blames the per-source cap, and omits the trim order it did not run", () => {
    const plan = planCollationBudget(
      [
        { url: "https://a.example/", text: "a".repeat(3_000) },
        { url: "https://b.example/", text: "b".repeat(500) },
      ],
      { budgetTokens: 100_000, sourceMaxTokens: 100 },
    );
    const out = formatCollationTrimNotice(plan, identity, ".search/run");
    assert.match(out, /per-source limit/);
    assert.match(out, /collationSourceMaxTokens/);
    assert.match(out, /400 characters of 3000 characters sent/);
    assert.match(out, /`\.search\/run\/extractions\/01-a-example\.md`/);
    assert.match(out, /Read them for the missing detail; re-running research will not recover it\./);
    assert.match(out, /\*\*Configuration\*\*: /);
    assert.doesNotMatch(out, /raise collationInputBudgetTokens/);
    assert.doesNotMatch(out, /\d,\d{3}/, "numbers are written raw, like the rest of the result text");
    assert.doesNotMatch(out, /Trim order:/, "the fair-share machinery did not run");
  });

  it("says the run's total exceeded the budget and names its lever", () => {
    const plan = planCollationBudget(
      [
        { url: "https://a.example/", text: "a".repeat(3_000) },
        { url: "https://b.example/", text: "b".repeat(3_000) },
      ],
      { budgetTokens: 1_000, sourceMaxTokens: 32_000 },
    );
    const out = formatCollationTrimNotice(plan, identity, ".search/run");
    assert.match(out, /run's total exceeded the 1000-token input budget/);
    assert.match(out, /collationInputBudgetTokens/);
    assert.doesNotMatch(out, /collationSourceMaxTokens/);
    assert.match(out, /1600 characters of 3000 characters sent/);
    assert.match(out, /Trim order:/);
    assert.ok(out.indexOf("full extraction") < out.indexOf("**Configuration**"), "configuration advice follows the file list");
    assert.doesNotMatch(out, /\d,\d{3}/);
  });

  it("names both limits and both levers for a dual-bound source", () => {
    const plan = planCollationBudget(
      Array.from({ length: 40 }, (_, i) => ({
        url: `https://s${i}.example/`,
        text: "a".repeat(10_000),
      })),
      { budgetTokens: 10_000, sourceMaxTokens: 256 },
    );
    const out = formatCollationTrimNotice(plan, identity, ".search/run");
    assert.match(out, /per-source limit \(collationSourceMaxTokens\)/);
    assert.match(out, /run's total exceeded the 10000-token input budget \(collationInputBudgetTokens\)/);
    assert.match(out, /Trimmed by both limits \(40\)/);
    assert.match(out, /raise collationSourceMaxTokens/);
    assert.match(out, /raise collationInputBudgetTokens/);
  });

  it("uses caller-supplied file wording for manual collation", () => {
    const plan = planCollationBudget(
      [{ url: "https://a.example/", text: "a".repeat(3_000) }],
      { budgetTokens: 100_000, sourceMaxTokens: 100 },
    );
    const out = formatCollationTrimNotice(plan, identity, ".search/manual", undefined, "collate");
    assert.match(out, /The omitted text is in the extraction files below, saved in full from the supplied extractions\. Read them for the missing detail; repeating collation will not recover it\./);
    assert.doesNotMatch(out, /re-running research/);
    assert.match(out, /`\.search\/manual\/extractions\/01-a-example\.md`/);
    assert.match(out, /\*\*Configuration\*\*: To send more next time, raise collationSourceMaxTokens\./);
  });
});

describe("formatCollationTrimNotice at the settings maxima", () => {
  const identity = allocateSourceIdentity(
    [
      { url: "https://a.example/", title: "a", extraction: "x", sourceType: "docs", currentness: "current", status: "success" as const },
      { url: "https://b.example/", title: "b", extraction: "x", sourceType: "docs", currentness: "current", status: "success" as const },
    ],
    [],
  );

  it("stops advising a raise when the budget is already at its maximum", () => {
    // 100 sources of 40,001 characters overflow the 4,000,000-character
    // ceiling, so the advice branch is the one under test.
    const plan = planCollationBudget(
      Array.from({ length: 100 }, (_, i) => ({
        url: `https://s${i}.example/`,
        text: "a".repeat(40_001),
      })),
      {
        budgetTokens: TUNING_RANGES.collationInputBudgetTokens[1],
        sourceMaxTokens: 32_000,
      },
    );
    assert.ok(plan.trims.length > 0);
    const out = formatCollationTrimNotice(plan, identity, ".search/run");
    assert.match(out, /\*\*Configuration\*\*: .*already at the 1000000-token maximum/);
    assert.doesNotMatch(out, /raise collationInputBudgetTokens/);
  });

  it("stops advising a raise when the per-source cap is already at its maximum", () => {
    const plan = planCollationBudget(
      [{ url: "https://a.example/", text: "a".repeat(MAX_OUTPUT_TOKENS * 4 + 1_000) }],
      { budgetTokens: 1_000_000, sourceMaxTokens: MAX_OUTPUT_TOKENS },
    );
    const out = formatCollationTrimNotice(plan, identity, ".search/run");
    assert.match(out, /\*\*Configuration\*\*: .*already at the 128000-token maximum/);
    assert.doesNotMatch(out, /raise collationSourceMaxTokens/);
  });
});
