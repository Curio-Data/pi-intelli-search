// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { it } from "node:test";
import { allocateSourceIdentity } from "../src/core/cache.js";
import { finalizeCollation } from "../src/core/provenance.js";
import type { ExtractResult } from "../src/core/types.js";

const entries: ExtractResult[] = [
  {
    url: "https://failed.example/",
    title: "Failed",
    extraction: "",
    sourceType: "unknown",
    currentness: "unknown",
    status: "failed",
  },
  {
    url: "https://docs.example/page",
    title: "Evidence",
    extraction: "Extracted facts.",
    sourceType: "official docs",
    currentness: "current",
    status: "success",
  },
  {
    url: "https://manual.example/",
    title: "Manual",
    extraction: "Other facts.",
    sourceType: "tutorial|notes\nline",
    currentness: "undated",
    status: "success",
  },
];
const identity = allocateSourceIdentity(entries, [
  { url: "https://docs.example/page", title: "Evidence", content: "Full page", status: "success" },
  {
    url: "https://unextracted.example/",
    title: "Fetched only",
    content: "Unused",
    status: "success",
  },
]);
const finish = (text: string) =>
  finalizeCollation(text, ".search/run", entries, identity, "fetched");

it("renders source inventory and real file slots from evidence, not model output", () => {
  const text = finish("Useful facts. [S1] [S2]");
  assert.match(text, /^## Summary\n\nUseful facts/);
  assert.match(
    text,
    /\| S1 \| https:\/\/docs.example\/page \| official docs \| Fetched and extracted \| .search\/run\/extractions\/02-docs-example.md \| .search\/run\/sources\/02-docs-example.md \|/,
  );
  assert.match(text, /\| S2 \|.*tutorial\\\|notes line.*Not cached/);
  assert.doesNotMatch(text, /failed.example|unextracted.example/);
  assert.equal(text.match(/\| S\d+ \|/g)?.length, 2);
  const manual = finalizeCollation(
    "Supplied facts. [S1]",
    ".search/run",
    entries,
    identity,
    "supplied",
  );
  assert.match(manual, /Caller-supplied extraction/);
  assert.doesNotMatch(manual, /Fetched and extracted/);
});

it("rejects invented inventories, IDs, URLs and cache files before rendering", () => {
  for (const text of [
    "Facts. [S0]",
    "Facts. [S3]",
    "Facts. [S01]",
    "Facts. [S1, S99]",
    "Facts. [S1-S9]",
    "Facts. [S1; S9]",
    "Facts. [S1 and S99]",
    "Facts. [S1–S9]",
    "Facts. [s99]",
    "## Source assessment\nSeventeen sources contributed.",
    "## Sources\nUnfetched sources.",
    "See [unfetched](https://unfetched.example/docs).",
    "A bare URL: https://unfetched.example/docs",
    "## References\n[unfetched](https://unfetched.example/docs)",
    "Read `sources/17-docs-example.md`.",
    "Read `.search/other/extractions/01-docs-example.md`.",
    "Read `sources\\17-docs-example.md`.",
    "Read `.search/run/report.md`.",
  ])
    assert.throws(() => finish(text), /provenance validation failed/);
  assert.throws(() => finish(" \n"), /no visible text.*collationMaxTokens/);
  assert.throws(() => finish("## Summary\n"), /empty synthesis/);
});

it("preserves known page links and code examples without treating example URLs as fetched", () => {
  const summary =
    "See [the page](https://docs.example/page#section). [S1]\n\n```ts\n// example URL and local files are code, not evidence\nfetch('https://api.example/data');\nconst path = 'sources/example.md';\n// [S99]\n```";
  const result = finish(summary);
  assert.ok(result.includes(summary));
  assert.doesNotMatch(result.split("## Source assessment")[1], /api\.example|sources\/example\.md/);
  assert.throws(
    () => finish("See https://docs.example/other-page"),
    /absent from the supplied evidence/,
  );
  assert.throws(() => finish("See http://docs.example/page"), /absent from the supplied evidence/);
  assert.throws(
    () => finish("See https://docs.example/page?lang=other"),
    /absent from the supplied evidence/,
  );
});

it("accepts extracted cross-links and developer code without crediting extra fetched pages", () => {
  const source = {
    ...entries[1],
    extraction:
      "Use https://api.example/charge and [config](https://docs.example/config/). Amazon S3 supports storage.",
  };
  const text =
    "# Summary\n\nSee [config](https://docs.example/config/). [S1]\n\nListen on `http://localhost:5173` and use `POST https://api.example/charge`. Write `report.md`.\n\n    curl https://example.com\n\n```ts\nfetch('https://example.com')\n````";
  const result = finalizeCollation(text, ".search/run", [source], identity, "fetched");
  assert.equal(result.match(/\| S\d+ \|/g)?.length, 1);
  assert.doesNotMatch(result.split("## Source assessment")[1], /config\/|api\.example|localhost/);
  assert.doesNotMatch(result, /## Summary\n\n# Summary/);
  assert.doesNotThrow(() =>
    finalizeCollation(
      "Use [Amazon S3](https://docs.example/config/) or [S3 Standard, S3 Glacier]. [S1]",
      ".search/run",
      [source],
      identity,
      "fetched",
    ),
  );
  assert.doesNotThrow(() =>
    finalizeCollation(
      "See [S3](https://docs.example/config/). [S1]",
      ".search/run",
      [source],
      identity,
      "fetched",
    ),
  );
  assert.ok(finish("See https://docs.example/page/ [S1]").includes("Summary"));
  const leadingCode = "    curl https://api.example/unfetched\n\nFacts. [S1]";
  assert.ok(finish(leadingCode).includes(leadingCode));
  assert.ok(finish("## Summary\n\n" + leadingCode).includes(leadingCode));
  const parenthesized = {
    ...source,
    url: "https://en.wikipedia.org/wiki/Rust_(programming_language)",
  };
  const id = allocateSourceIdentity([parenthesized], []);
  assert.doesNotThrow(() =>
    finalizeCollation(
      "See [Rust](https://en.wikipedia.org/wiki/Rust_(programming_language)). [S1]",
      ".search/run",
      [parenthesized],
      id,
      "supplied",
    ),
  );
});

const citationSources: ExtractResult[] = [
  entries[1],
  entries[2],
  { ...entries[2], url: "https://third.example/", title: "Third" },
];
const sparseIdentity = allocateSourceIdentity(citationSources, []);
const omittedForms = [
  "Bare [S1]",
  "Grouped [S1, S3]",
  "Semicolon [S1; S3]",
  "And [S1 and S3]",
  "Markdown [S1](https://docs.example/page)",
  "Markdown group [S1, S3](https://docs.example/page)",
  "Hyphen range [S1-S3]",
  "En-dash range [S1–S3]",
  "Em-dash range [S1—S3]",
  "Markdown range [S1-S3](https://docs.example/page)",
];
for (const text of omittedForms) {
  it(`rejects an omitted source ID in ${text}`, () => {
    assert.throws(
      () => finalizeCollation(text, ".search/run", citationSources, sparseIdentity, "fetched", new Set([2, 3])),
      /unknown or omitted source ID/,
    );
  });
}

it("rejects an omitted interior source ID in an inclusive range", () => {
  assert.throws(
    () => finalizeCollation("Inclusive range [S1–S3]", ".search/run", citationSources, sparseIdentity, "fetched", new Set([1, 3])),
    /unknown or omitted source ID/,
  );
});

it("accepts a valid sparse Markdown citation and a complete range", () => {
  const sparse = finalizeCollation(
    "Third source [S3](https://third.example/).",
    ".search/run",
    citationSources,
    sparseIdentity,
    "fetched",
    new Set([3]),
  );
  assert.match(sparse, /Third source \[S3\]/);
  assert.match(sparse, /\| S3 \| https:\/\/third\.example\/ \|/);
  assert.doesNotThrow(() =>
    finalizeCollation(
      "Full range [S1–S3] and [Amazon S3](https://third.example/).",
      ".search/run",
      citationSources,
      sparseIdentity,
      "fetched",
      new Set([1, 2, 3]),
    ),
  );
});

it("requires a real extraction identity and excludes empty successful entries", () => {
  const empty = { ...entries[1], extraction: " \n" };
  const result = finalizeCollation(
    "Facts.",
    ".search/run",
    [empty, entries[2]],
    identity,
    "supplied",
  );
  assert.equal(result.match(/\| S\d+ \|/g)?.length, 1);
  assert.doesNotMatch(result, /docs.example/);
  assert.throws(
    () =>
      finalizeCollation("Facts.", ".search/run", [entries[1], entries[1]], identity, "supplied"),
    /duplicate source URLs/,
  );
  assert.throws(
    () => finalizeCollation("Facts.", ".search/run", [], identity, "supplied"),
    /no successful extraction evidence/,
  );
  const noFiles = allocateSourceIdentity([], []);
  assert.throws(
    () => finalizeCollation("Facts.", ".search/run", [entries[1]], noFiles, "supplied"),
    /no extraction file/,
  );
});
