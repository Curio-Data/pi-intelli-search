// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// test/citation-markers.test.ts — alignCitationMarkers() rewrites the search
// model's [n] markers so each refers to the entry at position n of the list
// displayed beside the answer, and neutralises markers whose referent is not
// displayed. Covers every reachable merge shape: provider citations only,
// prose links only, both, duplicates, cap clamping, unresolvable markers and
// inferred-from-text sources.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { alignCitationMarkers } from "../src/core/citation-markers.js";
import type { HarvestedCitation } from "../src/core/annotations.js";
import { mergeCitations } from "../src/core/annotations.js";
import { extractSourceUrls } from "../src/core/util.js";

const cite = (url: string, title?: string): HarvestedCitation =>
  title ? { url, title } : { url };

/** The displayed list exactly as search.ts builds it: merged then capped. */
function displayedFrom(text: string, citations: HarvestedCitation[], cap: number) {
  return mergeCitations(extractSourceUrls(text), { citations }).slice(0, cap);
}

describe("alignCitationMarkers", () => {
  it("renumbers markers when prose links displace annotation order (the reported bug)", () => {
    const text =
      "Shipped on 12 March [3]. Installation is documented [1]. " +
      "See the [API ref](https://docs.example.com/api) and the mirror [4].";
    const citations = [
      cite("https://docs.example.com/release", "Release"),
      cite("https://docs.example.com/install", "Installation"),
      cite("https://blog.example.com/release-notes", "Release notes"),
      cite("https://mirror.example.com/docs", "Mirror"),
    ];
    const displayed = displayedFrom(text, citations, 10);
    // Displayed order: API ref (prose), then annotation-only entries.
    assert.deepEqual(
      displayed.map((s) => s.url),
      [
        "https://docs.example.com/api",
        "https://docs.example.com/release",
        "https://docs.example.com/install",
        "https://blog.example.com/release-notes",
        "https://mirror.example.com/docs",
      ],
    );

    const out = alignCitationMarkers(text, citations, displayed);
    // [3] meant release notes (provider citation 3): displayed entry 4.
    // [1] meant the release page: displayed entry 2 (after the prose link).
    // [4] meant the mirror: displayed entry 5.
    assert.equal(out.text, "Shipped on 12 March [4]. Installation is documented [2]. See the [API ref](https://docs.example.com/api) and the mirror [5].");
    assert.equal(out.resolved, 3);
    assert.equal(out.removed, 0);
    assert.equal(out.retitled, 0);
    assert.equal(out.touched, true);
  });

  it("keeps markers unchanged when the displayed list already matches provider order", () => {
    const text = "Released May 6[1][2][4]. The status page lists it[1].";
    const citations = [
      cite("https://a.example/1", "A"),
      cite("https://b.example/2", "B"),
      cite("https://c.example/3", "C"),
      cite("https://d.example/4", "D"),
    ];
    const displayed = displayedFrom(text, citations, 10);
    assert.deepEqual(
      displayed.map((s) => s.url),
      ["https://a.example/1", "https://b.example/2", "https://c.example/3", "https://d.example/4"],
    );
    const out = alignCitationMarkers(text, citations, displayed);
    assert.equal(out.text, text);
    assert.equal(out.resolved, 4);
  });

  it("resolves inline numbered links by their own URL, not the citation index", () => {
    const text = "Details in [2](https://real.example/notes) and [2](https://other.example/guide).";
    const citations = [
      cite("https://a.example/1", "A"),
      cite("https://b.example/2", "B"),
    ];
    const displayed = displayedFrom(text, citations, 10);
    // Both inline URLs precede the annotation-only entries in the merged list.
    assert.deepEqual(
      displayed.map((s) => s.url),
      [
        "https://real.example/notes",
        "https://other.example/guide",
        "https://a.example/1",
        "https://b.example/2",
      ],
    );
    const out = alignCitationMarkers(text, citations, displayed);
    assert.equal(out.text, "Details in [1](https://real.example/notes) and [2](https://other.example/guide).");
    assert.equal(out.resolved, 2);
  });

  it("removes bare markers and retitles inline links whose referent the cap dropped", () => {
    const u = (host: string) => `https://${host}.example/x`;
    const text =
      `A [1](${u("a")}) B [2](${u("b")}) C [3](${u("c")}) ` +
      `D [4](${u("d")}) high [7] low [1].`;
    const citations = [
      cite(u("a"), "A ann"),
      cite(u("e2")),
      cite(u("e3")),
      cite(u("e4")),
      cite(u("d"), "D title"),
      cite(u("e6")),
      cite(u("e7")),
    ];
    const displayed = displayedFrom(text, citations, 3);
    assert.deepEqual(
      displayed.map((s) => s.url),
      [u("a"), u("b"), u("c")],
    );
    const out = alignCitationMarkers(text, citations, displayed);
    // The inline [4] link falls outside the cap: it survives retitled from
    // its citation. Bare [7] (annotation-only, capped) is removed. Bare [1]
    // resolves to the annotation that shares the first prose URL.
    assert.equal(
      out.text,
      `A [1](${u("a")}) B [2](${u("b")}) C [3](${u("c")}) ` +
        `D [D title](${u("d")}) high low [1].`,
    );
    assert.equal(out.resolved, 4);
    assert.equal(out.removed, 1);
    assert.equal(out.retitled, 1);
  });

  it("drops markers whose citation index was never supplied", () => {
    const text = "Claim [7]. Supported [1].";
    const citations = [cite("https://a.example/1", "A")];
    const displayed = displayedFrom(text, citations, 10);
    const out = alignCitationMarkers(text, citations, displayed);
    assert.equal(out.text, "Claim. Supported [1].");
    assert.equal(out.removed, 1);
    assert.equal(out.resolved, 1);
  });

  it("resolves markers against the model's numbered trailing section when no annotations exist", () => {
    const text = [
      "Use the tool [2]; the guide [3] explains setup. See the [intro](https://x.example/intro).",
      "",
      "Sources",
      "1. [First](https://a.example/1)",
      "2. [Second](https://b.example/2)",
      "3. [Third](https://c.example/3)",
    ].join("\n");
    const displayed = displayedFrom(text, [], 10);
    assert.deepEqual(
      displayed.map((s) => s.url),
      [
        "https://x.example/intro",
        "https://a.example/1",
        "https://b.example/2",
        "https://c.example/3",
      ],
    );
    const out = alignCitationMarkers(text, [], displayed);
    // Section entry 2 is displayed third; section entry 3 is displayed fourth.
    assert.equal(
      out.text.split("\n")[0],
      "Use the tool [3]; the guide [4] explains setup. See the [intro](https://x.example/intro).",
    );
    assert.equal(out.resolved, 2);
  });

  it("leaves bracketed numbers untouched when the response shows no citation usage", () => {
    const text = "Version [3] ships arrays like arr[1]. No citations here.";
    const out = alignCitationMarkers(text, [], displayedFrom(text, [], 10));
    assert.equal(out.text, text);
    assert.equal(out.touched, false);
  });

  it("never rewrites inside code fences or inline code, even in marker mode", () => {
    const text = [
      "Released [1].",
      "",
      "```js",
      "const x = arr[1]; // [2] stays",
      "```",
      "",
      "Use `list[1]` and [2] in prose.",
    ].join("\n");
    const citations = [cite("https://a.example/1", "A"), cite("https://b.example/2", "B")];
    const displayed = displayedFrom(text, citations, 10);
    const out = alignCitationMarkers(text, citations, displayed);
    const lines = out.text.split("\n");
    assert.equal(lines[0], "Released [1].");
    assert.equal(lines[3], "const x = arr[1]; // [2] stays");
    assert.equal(lines[6], "Use `list[1]` and [2] in prose.");
    assert.equal(out.resolved, 2); // only the two prose markers
  });

  it("collapses duplicate URLs across channels so both markers agree", () => {
    const text = "Same source via citation [2] and via [link](https://b.example/2).";
    const citations = [cite("https://a.example/1", "A"), cite("https://b.example/2", "B")];
    const displayed = displayedFrom(text, citations, 10);
    // The prose link and citation 2 are one entry: prose order puts it first.
    assert.deepEqual(
      displayed.map((s) => s.url),
      ["https://b.example/2", "https://a.example/1"],
    );
    const out = alignCitationMarkers(text, citations, displayed);
    assert.equal(
      out.text,
      "Same source via citation [1] and via [link](https://b.example/2).",
    );
  });

  it("renumbers a marker whose referent is an inferred-from-text source", () => {
    const text =
      "The project lives at [2](https://github.com/example/tool) and docs [1].";
    const citations = [cite("https://github.com/example/tool", "Tool repo")];
    const displayed = displayedFrom(text, citations, 10);
    const out = alignCitationMarkers(text, citations, displayed);
    // The inline link resolves by URL; the bare [1] is citation 1 (same URL).
    assert.equal(
      out.text,
      "The project lives at [1](https://github.com/example/tool) and docs [1].",
    );
    assert.equal(out.resolved, 2);
  });

  it("leaves markdown reference definitions alone", () => {
    const text = "Claim [1].\n\n[1]: https://a.example/1";
    const citations = [cite("https://a.example/1", "A")];
    const displayed = displayedFrom(text, citations, 10);
    const out = alignCitationMarkers(text, citations, displayed);
    assert.equal(out.text, "Claim [1].\n\n[1]: https://a.example/1");
    // The definition line's [1] is skipped by the colon lookahead; the prose
    // marker resolves (to the same number here).
    assert.equal(out.resolved, 1);
  });

  it("keeps adjacent markers tidy when a middle one is dropped", () => {
    const text = "Fact[1][2][4].";
    const citations = [
      cite("https://a.example/1", "A"),
      cite("https://b.example/2", "B"),
    ];
    const displayed = displayedFrom(text, citations, 10);
    const out = alignCitationMarkers(text, citations, displayed);
    assert.equal(out.text, "Fact[1][2].");
    assert.equal(out.removed, 1);
  });
});

describe("mergeCitations numeric link labels", () => {
  it("retitles number-labelled prose links from the citation, or the URL", () => {
    const textUrls = [
      { url: "https://a.example/release-notes", title: "3" },
      { url: "https://b.example/deep/path/page", title: " 12 " },
      { url: "https://c.example/keep", title: "Official docs" },
    ];
    const merged = mergeCitations(textUrls, {
      citations: [{ url: "https://a.example/release-notes", title: "Release notes" }],
    });
    assert.deepEqual(
      merged.map((s) => s.title),
      ["Release notes", "page", "Official docs"],
    );
  });
});
