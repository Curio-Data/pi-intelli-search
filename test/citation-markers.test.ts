// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// test/citation-markers.test.ts — alignCitationMarkers() rewrites the search
// model's [n] markers so each refers to the entry at position n of the list
// displayed beside the answer, and neutralises markers whose referent is not
// displayed. The matcher is deliberately conservative: non-citation
// bracketed numbers (array indices, [0], reference links) stay verbatim, and
// code is never touched. Covers the shapes from the round-1 review (F1 to
// F7, F11) and the prose review's code findings, each asserting exact output.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { alignCitationMarkers } from "../src/core/citation-markers.js";
import type { HarvestedCitation } from "../src/core/annotations.js";
import { mergeCitations } from "../src/core/annotations.js";
import { extractSourceUrls } from "../src/core/util.js";

const cite = (url: string, title?: string): HarvestedCitation =>
  title ? { url, title } : { url };

/** The displayed list exactly as search.ts builds it: merged then capped. */
function displayedFrom(
  text: string,
  citations: HarvestedCitation[],
  cap: number,
  citationOrder?: HarvestedCitation[],
) {
  return mergeCitations(extractSourceUrls(text), { citations }).slice(0, cap);
}

function align(
  text: string,
  citations: HarvestedCitation[],
  displayed: ReturnType<typeof displayedFrom>,
  citationOrder?: HarvestedCitation[],
) {
  return alignCitationMarkers(text, { citations, citationOrder }, displayed);
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

    const out = align(text, citations, displayed);
    // [3] meant release notes (provider citation 3): displayed entry 4.
    // [1] meant the release page: displayed entry 2 (after the prose link).
    // [4] meant the mirror: displayed entry 5.
    assert.equal(out.text, "Shipped on 12 March [4]. Installation is documented [2]. See the [API ref](https://docs.example.com/api) and the mirror [5].");
    assert.equal(out.resolved, 3);
    assert.equal(out.removed, 0);
    assert.equal(out.retitled, 0);
    assert.equal(out.touched, true);
  });

  it("keeps aligned markers unchanged and rewrites digit-adjacent citations", () => {
    // 2025[1] is an observed citation form (markers glued to a year or
    // version with no space); a bare digit is not an identifier, so the
    // identifier-adjacency refusal must not reject it.
    const text = "Released May 6, 2025[1][2][4]. The status page lists it[1].";
    const citations = [
      cite("https://a.example/1", "A"),
      cite("https://b.example/2", "B"),
      cite("https://c.example/3", "C"),
      cite("https://d.example/4", "D"),
    ];
    const displayed = displayedFrom(text, citations, 10);
    const out = align(text, citations, displayed);
    // "it[1]" is letter-adjacent, so it stays verbatim (it is already [1]
    // here by coincidence; the point is it is never rewritten).
    assert.equal(out.text, text);
    assert.equal(out.resolved, 3);
    assert.equal(out.removed, 0);
  });

  it("resolves inline numbered links by their own URL, not the citation index", () => {
    const text = "Details in [2](https://real.example/notes) and [2](https://other.example/guide).";
    const citations = [
      cite("https://a.example/1", "A"),
      cite("https://b.example/2", "B"),
    ];
    const displayed = displayedFrom(text, citations, 10);
    assert.deepEqual(
      displayed.map((s) => s.url),
      [
        "https://real.example/notes",
        "https://other.example/guide",
        "https://a.example/1",
        "https://b.example/2",
      ],
    );
    const out = align(text, citations, displayed);
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
    const out = align(text, citations, displayed);
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
    const out = align(text, citations, displayed);
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
    const out = align(text, [], displayed);
    assert.equal(
      out.text.split("\n")[0],
      "Use the tool [3]; the guide [4] explains setup. See the [intro](https://x.example/intro).",
    );
    assert.equal(out.resolved, 2);
  });

  it("leaves bracketed numbers untouched when the response shows no citation usage", () => {
    const text = "Version [3] ships arrays like arr[1]. No citations here.";
    const out = align(text, [], displayedFrom(text, [], 10));
    assert.equal(out.text, text);
    assert.equal(out.touched, false);
  });

  it("never rewrites inside code fences, inline code, indented code or multi-line spans", () => {
    const text = [
      "Released [1].",
      "",
      "```js",
      "const x = arr[1]; // [2] stays",
      "```",
      "",
      "    const y = arr[3]; // indented code [2]",
      "",
      "Use `list[1]` and [2] in prose.",
    ].join("\n");
    const citations = [cite("https://a.example/1", "A"), cite("https://b.example/2", "B")];
    const displayed = displayedFrom(text, citations, 10);
    const out = align(text, citations, displayed);
    const lines = out.text.split("\n");
    assert.equal(lines[0], "Released [1].");
    assert.equal(lines[3], "const x = arr[1]; // [2] stays");
    assert.equal(lines[6], "    const y = arr[3]; // indented code [2]");
    assert.equal(lines[8], "Use `list[1]` and [2] in prose.");
    assert.equal(out.resolved, 2); // only the two prose markers
  });

  it("masks inline code spans that cross a newline", () => {
    const text = "Released [1]. Use `arr[3]\nand arr[2]` then [2].";
    const citations = [cite("https://a.example/1", "A"), cite("https://b.example/2", "B")];
    const displayed = displayedFrom(text, citations, 10);
    const out = align(text, citations, displayed);
    assert.equal(out.text, "Released [1]. Use `arr[3]\nand arr[2]` then [2].");
    assert.equal(out.resolved, 2);
  });

  it("treats a four-space-indented list continuation as prose, not code", () => {
    const text = [
      "Released [1].",
      "",
      "- item one",
      "    continuation citing [2]",
      "- item two",
      "",
      "Then [2] again.",
    ].join("\n");
    const citations = [cite("https://a.example/1", "A"), cite("https://b.example/2", "B")];
    const displayed = displayedFrom(text, citations, 10);
    const out = align(text, citations, displayed);
    // Both [2] markers resolve to entry 2 (unchanged number); the point is
    // the continuation line was not swallowed as code.
    assert.equal(out.text, text);
    assert.equal(out.resolved, 3);
  });

  it("collapses duplicate URLs across channels so both markers agree", () => {
    const text = "Same source via citation [2] and via [link](https://b.example/2).";
    const citations = [cite("https://a.example/1", "A"), cite("https://b.example/2", "B")];
    const displayed = displayedFrom(text, citations, 10);
    assert.deepEqual(
      displayed.map((s) => s.url),
      ["https://b.example/2", "https://a.example/1"],
    );
    const out = align(text, citations, displayed);
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
    const out = align(text, citations, displayed);
    assert.equal(
      out.text,
      "The project lives at [1](https://github.com/example/tool) and docs [1].",
    );
    assert.equal(out.resolved, 2);
  });

  it("leaves markdown reference definitions and reference-style uses alone", () => {
    const text = "Claim [1].\n\n[1]: https://a.example/1";
    const citations = [cite("https://a.example/1", "A")];
    const displayed = displayedFrom(text, citations, 10);
    const out = align(text, citations, displayed);
    assert.equal(out.text, "Claim [1].\n\n[1]: https://a.example/1");
    assert.equal(out.resolved, 1);
  });

  it("keeps adjacent markers tidy when a middle one is dropped", () => {
    // "Fact[1]" is letter-adjacent and stays verbatim (conservative);
    // "[2]" after the numeric bracket group [1] is an adjacent marker.
    const text = "Fact[1][2][4].";
    const citations = [
      cite("https://a.example/1", "A"),
      cite("https://b.example/2", "B"),
    ];
    const displayed = displayedFrom(text, citations, 10);
    const out = align(text, citations, displayed);
    assert.equal(out.text, "Fact[1][2].");
    assert.equal(out.removed, 1);
    assert.equal(out.resolved, 1);
  });
});

describe("alignCitationMarkers — review findings F1 to F7, F11", () => {
  it("F1: preserves non-citation bracketed numbers in annotation mode (arr[3], arr[0], list[0])", () => {
    const text =
      "Read [API](https://api.example/ref). The third element arr[3] is key, " +
      "the first is arr[0], and list[0] starts it. Cite [1].";
    const citations = [
      cite("https://a.example/1", "A"),
      cite("https://b.example/2", "B"),
      cite("https://c.example/3", "C"),
    ];
    const displayed = displayedFrom(text, citations, 10);
    const out = align(text, citations, displayed);
    // Only the space-delimited genuine citation is rewritten (to the index
    // of citation 1 after the prose link). The identifier-adjacent tokens
    // keep their exact text; [0] is never a marker (ids are 1-based).
    assert.equal(
      out.text,
      "Read [API](https://api.example/ref). The third element arr[3] is key, " +
        "the first is arr[0], and list[0] starts it. Cite [2].",
    );
    assert.equal(out.resolved, 1);
    assert.equal(out.removed, 0);
  });

  it("F1 trade-off: a space-delimited [n] in a citation-dense answer is treated as a citation", () => {
    // No syntax separates "version [2]" from a real citation; this test
    // records the chosen side of that trade-off. The alternative (leaving
    // every bare marker verbatim) reintroduces the reported mismatch for the
    // dominant marker form, so delimited markers are rewritten.
    const text = "Use version [2] of the tool; see the guide [1].";
    const citations = [cite("https://a.example/1", "A"), cite("https://b.example/2", "B")];
    const displayed = displayedFrom(text, citations, 10);
    const out = align(text, citations, displayed);
    assert.equal(out.text, "Use version [2] of the tool; see the guide [1].");
    assert.equal(out.resolved, 2);
  });

  it("F2: sanitises an untrusted citation title in the inline retitle", () => {
    const u = (host: string) => `https://${host}.example/x`;
    const text = `A [1](${u("a")}) B [2](${u("b")}) C [3](${u("c")}) D [4](${u("e")}).`;
    const citations = [
      cite(u("a"), "A"),
      cite(u("b"), "B"),
      cite(u("c"), "C"),
      cite(u("e"), "Click](https://evil.example/phish) here"),
    ];
    const displayed = displayedFrom(text, citations, 3);
    const out = align(text, citations, displayed);
    // The capped link keeps pointing at its own URL; the injected title is
    // dropped and replaced by the safe URL-derived label.
    assert.equal(out.text, `A [1](${u("a")}) B [2](${u("b")}) C [3](${u("c")}) D [x](${u("e")}).`);
    assert.doesNotMatch(out.text, /evil\.example/);
    assert.equal(out.retitled, 1);
  });

  it("F3: resolves by provider occurrence order when a URL repeats (position-faithful map)", () => {
    // Provider ids 1..4 with the same URL at ids 2 and 3: the deduplicated
    // array would shift every later position. The occurrence order does not.
    const text = "Claim one [1]. Claim three [3]. Claim four [4].";
    const occurrences = [
      cite("https://a.example/1"),
      cite("https://b.example/2"),
      cite("https://b.example/2"),
      cite("https://c.example/3"),
    ];
    const deduped = [occurrences[0], occurrences[1], occurrences[3]];
    const displayed = displayedFrom(text, deduped, 10);
    // [3] is id 3 = the repeated b URL (displayed entry 2), not c.
    const out = align(text, deduped, displayed, occurrences);
    assert.equal(out.text, "Claim one [1]. Claim three [2]. Claim four [3].");
    assert.equal(out.resolved, 3);
    // Without the positional map (adapter fallback), [3] would resolve to c.
  });

  it("F3: removes markers when the numbered section and annotations disagree", () => {
    const text = [
      "Beta claim [1]. Alpha claim [2].",
      "",
      "Sources",
      "1. [B](https://b.example/2)",
      "2. [A](https://a.example/1)",
    ].join("\n");
    const citations = [cite("https://a.example/1"), cite("https://b.example/2")];
    const displayed = displayedFrom(text, citations, 10);
    const out = align(text, citations, displayed);
    // Both markers have two conflicting numbering bases: trust neither.
    assert.equal(out.text.split("\n")[0], "Beta claim. Alpha claim.");
    assert.equal(out.removed, 2);
    assert.equal(out.resolved, 0);
  });

  it("F4: matches balanced-parenthesis URLs inline and in the numbered section", () => {
    const inline = "See [3](https://en.wikipedia.org/wiki/Foo_(bar)) for details.";
    const out1 = align(inline, [], displayedFrom(inline, [], 10));
    assert.equal(out1.text, "See [1](https://en.wikipedia.org/wiki/Foo_(bar)) for details.");
    assert.equal(out1.resolved, 1);

    const sectioned = [
      "Claim [2].",
      "",
      "Sources",
      "1. [A](https://a.example/1)",
      "2. [Foo](https://en.wikipedia.org/wiki/Foo_(bar))",
    ].join("\n");
    const out2 = align(sectioned, [], displayedFrom(sectioned, [], 10));
    assert.equal(out2.text.split("\n")[0], "Claim [2].");
    assert.equal(out2.resolved, 1);
  });

  it("F6: leaves collapsed and full reference links intact under removal pressure", () => {
    const citations = [cite("https://a.example/1", "A")];
    const collapsed = "See [1][].\n\n[1]: https://b.example/2";
    const out1 = align(collapsed, citations, displayedFrom(collapsed, citations, 1));
    assert.equal(out1.text, collapsed);

    const full = "See [1][docs].\n\n[docs]: https://b.example/2";
    const out2 = align(full, citations, displayedFrom(full, citations, 1));
    assert.equal(out2.text, full);

    const used = "See [the docs][1].\n\n[1]: https://b.example/2";
    const out3 = align(used, citations, displayedFrom(used, citations, 1));
    assert.equal(out3.text, used);
  });

  it("F7: never retitles with a purely numeric label", () => {
    const text = `Lead [1](https://a.example/1) then [4](https://d.example/4).`;
    const citations = [cite("https://a.example/1", "A")];
    const displayed = displayedFrom(text, citations, 1);
    const out = align(text, citations, displayed);
    // titleFromUrl("https://d.example/4") is "4": numeric, so the host is
    // used instead of re-emitting a number that reads as an index.
    assert.equal(out.text, "Lead [1](https://a.example/1) then [d.example](https://d.example/4).");
    assert.equal(out.retitled, 1);
  });

  it("F7: keeps a numeric link label the provider does not corroborate", () => {
    const merged = mergeCitations(
      [{ url: "https://en.wikipedia.org/wiki/42_(number)", title: "42" }],
      { citations: [] },
    );
    // The model chose the label "42"; no annotation title exists to replace
    // it, so the label stands verbatim.
    assert.equal(merged[0].title, "42");
  });

  it("F11: resolves an inline referent whose URL carries trailing punctuation", () => {
    const text = "Both [2](https://a.example/x.) and [1](https://y.example/1) count.";
    const citations = [cite("https://a.example/x"), cite("https://y.example/1")];
    const displayed = displayedFrom(text, citations, 10);
    const out = align(text, citations, displayed);
    // The annotation URL has no trailing dot; the inline link's does. The
    // referent still finds its entry, and the original URL text is kept.
    assert.equal(out.text, "Both [1](https://a.example/x.) and [2](https://y.example/1) count.");
    assert.equal(out.resolved, 2);
  });

  it("keeps CRLF offsets stable through masking and rewrites", () => {
    const text = "Released [1].\r\n\r\n```js\r\nconst x = arr[3];\r\n```\r\n";
    const citations = [cite("https://a.example/1", "A"), cite("https://b.example/2", "B")];
    const displayed = displayedFrom(text, citations, 10);
    const out = align(text, citations, displayed);
    assert.equal(out.text, "Released [1].\r\n\r\n```js\r\nconst x = arr[3];\r\n```\r\n");
    assert.equal(out.resolved, 1);
  });

  it("swallows a tab before a removed marker", () => {
    const text = "Claim\t[7]. Source [1].";
    const citations = [cite("https://a.example/1", "A"), cite("https://b.example/2", "B")];
    const displayed = displayedFrom(text, citations, 10);
    const out = align(text, citations, displayed);
    assert.equal(out.text, "Claim. Source [1].");
  });

  it("leaves an unresolvable bare marker verbatim when nothing proves bare-citation usage", () => {
    // One inline numbered link turns marker mode on, but no bare marker
    // resolves: the bare [3] is more likely prose, so it stands.
    const text = "See [1](https://a.example/guide). Access the third [3] item.";
    const out = align(text, [], displayedFrom(text, [], 10));
    assert.equal(out.text, text);
    assert.equal(out.removed, 0);
  });
});

describe("mergeCitations numeric link labels", () => {
  it("adopts the provider title for number-labelled links, keeps uncorroborated labels", () => {
    const textUrls = [
      { url: "https://a.example/release-notes", title: "3" },
      { url: "https://b.example/anything", title: "12" },
      { url: "https://c.example/keep", title: "Official docs" },
    ];
    const merged = mergeCitations(textUrls, {
      citations: [{ url: "https://a.example/release-notes", title: "Release notes" }],
    });
    assert.deepEqual(
      merged.map((s) => s.title),
      ["Release notes", "12", "Official docs"],
    );
  });
});
