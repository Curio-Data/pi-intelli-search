// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// src/core/citation-markers.ts: align the search model's numbered citation
// markers with the source list actually displayed beside them.
//
// Search-grounded models number their citations against their OWN result
// list: Perplexity documents that markers like `[1]`, `[2]` map to the
// search-result `id` they arrive with (docs.perplexity.ai, "Streaming
// Citation Parsing", checked 2026-11-18), which this pipeline harvests as
// url_citation annotations. The rendered Sources list, however, is built by
// mergeCitations(): prose links first, then annotation-only URLs, then
// inferred guesses, clamped to the results cap. Without alignment, a marker
// can sit beside a completely different entry.
//
// alignCitationMarkers() rewrites each resolvable marker to the index of its
// referent in the displayed list, and neutralises markers whose referent is
// missing (clamped away or never supplied) instead of leaving a number that
// points at the wrong source. It is deliberately conservative about what
// counts as a marker, because the answer text is the model's prose, not a
// citation grammar:
//
// - `[0]` is never a marker (provider ids are 1-based).
// - A bare `[n]` glued to an identifier (`arr[3]`, `list[0]`) is left
//   verbatim: no syntax distinguishes it from an index. A digit immediately
//   before a marker is allowed (`2025[1]`), because that shape is an
//   observed citation form while a bare digit is not an identifier.
// - Reference-style link uses (`[label][n]`, `[n][ref]`, `[n][]`) and
//   definitions (`[n]: url`) are left verbatim.
// - Code fences, indented code blocks and inline code spans (including
//   spans crossing a newline) are masked and never touched.
// - When neither the provider order nor the model's own numbered Sources
//   section can resolve a bare marker, it is removed only if other bare
//   markers in the same response did resolve: with no such evidence the
//   bracketed number is more likely prose, and prose stays verbatim.
// - When the provider order and the model's numbered section disagree about
//   a marker's referent, the marker is removed rather than resolved by
//   either list: neither base can be trusted over the other.

import type { HarvestedCitation } from "./annotations.js";
import { matchTrailingSourcesSection } from "./util.js";
import { safeNonNumericLinkLabel } from "./util.js";

/** Source entry shape alignCitationMarkers() needs: a resolvable URL. */
export interface DisplayedSource {
  url: string;
}

/** The two citation lists a search response carries. `citations` is the
 *  deduplicated merge input; `citationOrder` is the provider's occurrence
 *  order with duplicates kept, which is the base bare `[n]` markers are
 *  numbered by. When `citationOrder` is absent (adapters without positional
 *  visibility), `citations` is used as the order. */
export interface CitationNumbering {
  citations: HarvestedCitation[];
  citationOrder?: HarvestedCitation[];
}

export interface MarkerAlignment {
  /** Response text with markers aligned (or the original text when the
   *  response shows no numbered-citation usage). */
  text: string;
  /** Markers rewritten to a displayed index. */
  resolved: number;
  /** Bare markers removed because their referent is not in the displayed
   *  list (clamped away, never supplied, or two numbering bases disagreed). */
  removed: number;
  /** Inline number-labelled links whose referent fell outside the displayed
   *  list; the link survives, retitled from the citation or URL so it no
   *  longer reads as a list index. */
  retitled: number;
  /** True when at least one marker was resolved, removed or retitled. */
  touched: boolean;
}

/** URL body that admits one level of balanced parentheses, as
 *  extractSourceUrls pass 1 does, so `Foo_(bar)` URLs are not truncated at
 *  the first `)` and the referent matches the displayed entry exactly. At
 *  least one character, so `[3]()` never matches. */
const URL_CHARS = "(?:[^()\\s]|\\([^()\\s]*\\))+";

/**
 * Numbered entries of the model's own trailing Sources section, keyed by the
 * number the model wrote. Cross-checked against the provider order for
 * conflicts, and used for indices the provider order does not cover.
 */
function numberedSectionEntries(section: string): Map<number, string> {
  const out = new Map<number, string>();
  const marked = new RegExp(`^\\s*(\\d{1,3})[.)]\\s*\\[[^\\]]*\\]\\((https?://${URL_CHARS})\\)`, "gm");
  for (const m of section.matchAll(marked)) {
    if (!out.has(Number(m[1]))) out.set(Number(m[1]), m[2]);
  }
  const bare = new RegExp(`^\\s*(\\d{1,3})[.)][ \\t]+(https?://${URL_CHARS})`, "gm");
  for (const m of section.matchAll(bare)) {
    if (!out.has(Number(m[1]))) out.set(Number(m[1]), m[2].replace(/[.,;:!]+$/, ""));
  }
  return out;
}

/** Compare two URLs as the same source, tolerating trailing punctuation a
 *  provider or the model appended to one of them. */
function sameSource(a: string, b: string): boolean {
  const strip = (u: string) => u.replace(/[.,;:!]+$/, "");
  return strip(a) === strip(b);
}

function strippedForLookup(url: string): string {
  return url.replace(/[.,;:!?]+$/, "");
}

/** Expand leading whitespace to columns (tab = 4) to measure indentation. */
function indentWidth(line: string): number {
  const lead = line.match(/^[ \t]*/)?.[0] ?? "";
  let width = 0;
  for (const ch of lead) width = ch === "\t" ? Math.ceil((width + 1) / 4) * 4 : width + 1;
  return width;
}

/** Fill the given [start, end) intervals with same-length NUL runs, keeping
 *  every offset stable. Overlapping intervals are clamped, not dropped. */
function applyIntervals(
  text: string,
  intervals: Array<{ start: number; end: number }>,
): string {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const { start, end } of sorted) {
    const s = Math.max(start, cursor);
    if (s >= end) continue;
    out += text.slice(cursor, s) + "\u0000".repeat(end - s);
    cursor = end;
  }
  return out + text.slice(cursor);
}

/** Mask text so marker matching never sees code. Three shapes are masked:
 *  fenced blocks (``` / ~~~ with the closer at least as long), indented code
 *  blocks (4 columns, outside list-item continuation, per CommonMark's
 *  content-indent rule), and inline code spans, including spans that cross a
 *  newline. Everything else keeps its offsets, so matches found on the
 *  masked text map one-to-one onto the original. */
function maskCodeSpans(text: string): string {
  const intervals: Array<{ start: number; end: number }> = [];
  const lines = text.split("\n");
  let offset = 0;
  let fence: { char: string; length: number } | undefined;
  let listContentIndent: number | undefined;
  for (const line of lines) {
    const opener = line.match(/^[ \t]*(`{3,}|~{3,})/);
    if (fence || opener) {
      intervals.push({ start: offset, end: offset + line.length });
      if (fence) {
        if (opener && opener[1][0] === fence.char && opener[1].length >= fence.length) {
          fence = undefined;
        }
      } else {
        fence = { char: opener![1][0], length: opener![1].length };
      }
    } else if (line.trim().length === 0) {
      // Blank lines do not end a list or a fence's paragraph break state.
    } else {
      const listMarker = line.match(/^( {0,3})(?:[-+*]|\d{1,9}[.)])([ \t]+|$)/);
      if (listMarker) {
        // The column where this item's content starts; a continuation line
        // indented at least this far is list prose, not indented code.
        listContentIndent =
          listMarker[0].length + (listMarker[2].length > 0 ? 0 : 1);
      } else {
        const width = indentWidth(line);
        const codeFloor = listContentIndent === undefined ? 4 : listContentIndent + 4;
        if (width >= 4 && width >= codeFloor) {
          intervals.push({ start: offset, end: offset + line.length });
        } else if (width < (listContentIndent ?? 0)) {
          // Dedented prose leaves the list.
          listContentIndent = undefined;
        }
      }
    }
    offset += line.length + 1;
  }
  const maskedLines = applyIntervals(text, intervals);
  // Inline code spans over the whole text so a span crossing a newline is
  // caught; spans cannot start or end inside an already-masked region
  // (backticks there are NULs), and over-masking only leaves text verbatim,
  // which is the safe direction.
  for (const m of maskedLines.matchAll(/(`+)(?!`)[\s\S]*?\1(?!`)/g)) {
    intervals.push({ start: m.index, end: m.index + m[0].length });
  }
  return applyIntervals(text, intervals);
}

type BareOutcome = "resolved" | "capped" | "conflict" | "unresolvable" | "verbatim";

/**
 * Rewrite the response's numbered citation markers so each one carries the
 * index of its referent in `displayed`, the list rendered beside the text.
 * See the file header for the conservative rules that decide what counts as
 * a marker at all.
 */
export function alignCitationMarkers(
  text: string,
  numbering: CitationNumbering,
  displayed: ReadonlyArray<DisplayedSource>,
): MarkerAlignment {
  const order =
    numbering.citationOrder && numbering.citationOrder.length > 0
      ? numbering.citationOrder
      : numbering.citations;
  const sectionMatch = matchTrailingSourcesSection(text);
  const sectionEntries = sectionMatch ? numberedSectionEntries(sectionMatch.section) : new Map<number, string>();

  const masked = maskCodeSpans(text);

  // Numbered-citation mode: a provider order, an inline numbered link, or a
  // numbered trailing section. Without one of these, [n] tokens in prose
  // have no known numbering base and are left alone.
  const inlineNumbered = /\[\d{1,3}\]\(https?:\/\//.test(masked);
  if (order.length === 0 && !inlineNumbered && sectionEntries.size === 0) {
    return { text, resolved: 0, removed: 0, retitled: 0, touched: false };
  }

  // Displayed lookup: exact URL first, then a trailing-punctuation-stripped
  // alias, so a provider URL with a trailing dot still finds its entry.
  const indexOfUrl = new Map<string, number>();
  displayed.forEach((source, index) => {
    if (!indexOfUrl.has(source.url)) indexOfUrl.set(source.url, index);
    const stripped = strippedForLookup(source.url);
    if (stripped !== source.url && !indexOfUrl.has(stripped)) indexOfUrl.set(stripped, index);
  });
  const citationTitle = new Map<string, string>();
  for (const c of numbering.citations) {
    if (c.title && c.title.length > 0 && !citationTitle.has(c.url)) citationTitle.set(c.url, c.title);
  }

  // Inline form `[n](url)` first (balanced-paren URLs, per extractSourceUrls
  // pass 1). Bare form second, with three refusals built in:
  // - `[0]`-style: handled in code, ids are 1-based;
  // - identifier-adjacent `[n]` (`arr[3]`): the lookbehind refuses a letter
  //   or underscore before the bracket, but allows a digit (`2025[1]`);
  // - reference links: a preceding text-labelled bracket group
  //   (`[the docs][1]`), a following `[ref]` or `[]` (`[1][docs]`, `[1][]`),
  //   or a following `:` (definition `[1]: url`).
  // The bare form also swallows one preceding space or tab so a removed
  // marker does not leave "word ." behind; adjacent markers `[1][2]` have
  // no space to eat.
  const pattern = new RegExp(
    `\\[(\\d{1,3})\\]\\((https?://${URL_CHARS})\\)` +
      `|([\\t ]?)(?<![\\p{L}_])(?<!\\[[^\\]\\n]*[^\\]\\d\\n][^\\]\\n]*\\])\\[(\\d{1,3})\\](?![:(]|\\[\\D|\\[\\])`,
    "gu",
  );

  interface Plan {
    start: number;
    whole: string;
    inlineUrl?: string;
    space?: string;
    n: number;
    outcome: BareOutcome | "inline";
    k?: number; // displayed index (1-based) when resolved
  }
  const plans: Plan[] = [];
  let anyBareEstablished = false;

  for (const m of masked.matchAll(pattern)) {
    const whole = m[0];
    // A match touching masked code is not a citation marker. Spans are NUL
    // runs, and NUL is not excluded by the URL character class, so guard
    // explicitly instead of relying on the mask alone.
    if (whole.includes("\u0000")) continue;
    const start = m.index;
    const inlineUrl = m[2];
    const n = inlineUrl !== undefined ? Number(m[1]) : Number(m[4]);

    if (inlineUrl !== undefined) {
      const k = indexOfUrl.get(strippedForLookup(inlineUrl));
      plans.push(
        k !== undefined
          ? { start, whole, inlineUrl, n, outcome: "inline", k: k + 1 }
          : { start, whole, inlineUrl, n, outcome: "inline" },
      );
      continue;
    }

    if (n === 0) {
      // Never a 1-based citation marker.
      plans.push({ start, whole, n, outcome: "verbatim" });
      continue;
    }
    const fromOrder = n <= order.length ? order[n - 1].url : undefined;
    const fromSection = sectionEntries.get(n);
    let referent: string | undefined;
    let outcome: BareOutcome;
    if (fromOrder !== undefined && fromSection !== undefined && !sameSource(fromOrder, fromSection)) {
      // The two numbering bases disagree: trust neither, remove the marker.
      outcome = "conflict";
    } else {
      referent = fromOrder ?? fromSection;
      if (referent === undefined) {
        outcome = "unresolvable";
      } else {
        const k = indexOfUrl.get(strippedForLookup(referent));
        if (k !== undefined) {
          plans.push({ start, whole, space: m[3], n, outcome: "resolved", k: k + 1 });
          anyBareEstablished = true;
          continue;
        }
        outcome = "capped";
      }
    }
    if (outcome === "capped" || outcome === "conflict") anyBareEstablished = true;
    plans.push({ start, whole, space: m[3], n, outcome });
  }

  let resolved = 0;
  let removed = 0;
  let retitled = 0;
  let out = "";
  let cursor = 0;
  for (const plan of plans) {
    out += text.slice(cursor, plan.start);
    cursor = plan.start + plan.whole.length;
    if (plan.outcome === "verbatim") {
      // Identifier-adjacent, [0], or unproven: the original token stays.
      out += plan.whole;
      continue;
    }
    if (plan.outcome === "inline") {
      if (plan.k !== undefined) {
        out += `[${plan.k}](${plan.inlineUrl})`;
        resolved++;
      } else {
        // The URL is the citation and stays clickable; the number would
        // point at the wrong list entry or none, so the label is replaced
        // with a safe, never purely numeric title.
        const title = safeNonNumericLinkLabel(citationTitle.get(plan.inlineUrl!), plan.inlineUrl!);
        out += `[${title}](${plan.inlineUrl})`;
        retitled++;
      }
      continue;
    }
    if (plan.outcome === "resolved") {
      out += (plan.space ?? "") + `[${plan.k}]`;
      resolved++;
      continue;
    }
    if (plan.outcome === "unresolvable" && !anyBareEstablished) {
      // No bare marker in this response resolved: this bracketed number is
      // more likely prose, and prose stays verbatim.
      out += plan.whole;
      continue;
    }
    // capped, conflict, or unresolvable with citation evidence: remove.
    // The optional leading space/tab (m[3]) is part of the match and is not
    // re-emitted, so "claim [7]." becomes "claim." not "claim .".
    removed++;
  }
  out += text.slice(cursor);

  return { text: out, resolved, removed, retitled, touched: resolved + removed + retitled > 0 };
}
