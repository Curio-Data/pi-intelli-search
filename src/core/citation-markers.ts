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
// url_citation annotations in provider order. The rendered Sources list,
// however, is built by mergeCitations(): prose links first, then
// annotation-only URLs, then inferred guesses, clamped to the results cap.
// Without alignment, a marker can sit beside a completely different entry:
// the model's `[3]` (its third search result) renders next to whichever URL
// happened to land third in the merged list.
//
// alignCitationMarkers() rewrites each resolvable marker to the index of its
// referent in the displayed list, and neutralises markers whose referent is
// missing (clamped away or never supplied) instead of leaving a number that
// points at the wrong source. Code fences and inline code spans are never
// touched, so `arr[3]` inside an example survives verbatim.

import type { HarvestedCitation } from "./annotations.js";
import { matchTrailingSourcesSection, titleFromUrl } from "./util.js";

/** Source entry shape alignCitationMarkers() needs: a resolvable URL. */
export interface DisplayedSource {
  url: string;
}

export interface MarkerAlignment {
  /** Response text with markers aligned (or the original text when the
   *  response shows no numbered-citation usage). */
  text: string;
  /** Markers rewritten to a displayed index. */
  resolved: number;
  /** Bare markers removed because their referent is not in the displayed
   *  list (clamped away, or a citation index that was never supplied). */
  removed: number;
  /** Inline number-labelled links whose referent fell outside the displayed
   *  list; the link survives, retitled from the citation or URL so it no
   *  longer reads as a list index. */
  retitled: number;
  /** True when at least one marker was resolved, removed or retitled. */
  touched: boolean;
}

/**
 * Numbered entries of the model's own trailing Sources section, keyed by the
 * number the model wrote. Only consulted when no annotations were harvested:
 * with annotations present, the provider's citation array is the numbering
 * base and a model-rendered section may disagree with it.
 */
function numberedSectionEntries(section: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const m of section.matchAll(/^\s*(\d{1,3})[.)]\s*\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/gm)) {
    out.set(Number(m[1]), m[2]);
  }
  for (const m of section.matchAll(/^\s*(\d{1,3})[.)][ \t]+(https?:\/\/\S+)/gm)) {
    if (!out.has(Number(m[1]))) out.set(Number(m[1]), m[2].replace(/[.,;:!]+$/, ""));
  }
  return out;
}

/** Mask text so marker matching never sees code: fenced blocks line-wise and
 *  inline code spans are replaced by same-length NUL runs, keeping every
 *  offset stable. Returns the masked text and the original spans. */
function maskCodeSpans(text: string): { masked: string; spans: Array<{ start: number; end: number }> } {
  const spans: Array<{ start: number; end: number }> = [];
  const lines = text.split("\n");
  let offset = 0;
  let fence: { char: string; length: number } | undefined;
  for (const line of lines) {
    const opener = line.match(/^[ \t]*(`{3,}|~{3,})/);
    if (fence || opener) {
      if (fence) {
        spans.push({ start: offset, end: offset + line.length });
        if (opener && opener[1][0] === fence.char && opener[1].length >= fence.length) {
          fence = undefined;
        }
      } else {
        fence = { char: opener![1][0], length: opener![1].length };
        spans.push({ start: offset, end: offset + line.length });
      }
    } else {
      for (const m of line.matchAll(/(`+)(?!`)[\s\S]*?\1(?!`)/g)) {
        spans.push({ start: offset + m.index, end: offset + m.index + m[0].length });
      }
    }
    offset += line.length + 1;
  }
  let masked = "";
  let cursor = 0;
  for (const { start, end } of spans) {
    masked += text.slice(cursor, start) + "\u0000".repeat(end - start);
    cursor = end;
  }
  masked += text.slice(cursor);
  return { masked, spans };
}

/**
 * Rewrite the response's numbered citation markers so each one carries the
 * index of its referent in `displayed`, the list rendered beside the text.
 *
 * Referent resolution, in order:
 * 1. Inline link `[n](url)`: the link itself names the referent.
 * 2. Bare `[n]` with annotations: the provider's n-th citation
 *    (Perplexity numbers markers against its search-result list, which is
 *    what the annotations channel delivers, in order).
 * 3. Bare `[n]` with no annotations: entry n of the model's own numbered
 *    trailing Sources section, when it wrote one.
 *
 * A resolved referent found in `displayed` keeps its bracket form with the
 * displayed index (`[k]`, or `[k](url)` for inline links). A referent
 * outside `displayed` is neutralised: bare markers are removed (with the
 * space before them) and inline links survive retitled from the citation or
 * URL, so no number silently points at the wrong source. When the response
 * shows no numbered-citation usage (no annotations, no inline numbered
 * links, no numbered trailing section), the text is returned untouched:
 * bracketed numbers in such prose are not established as citations.
 */
export function alignCitationMarkers(
  text: string,
  citations: HarvestedCitation[],
  displayed: ReadonlyArray<DisplayedSource>,
): MarkerAlignment {
  const sectionMatch = matchTrailingSourcesSection(text);
  const sectionEntries = citations.length === 0 && sectionMatch
    ? numberedSectionEntries(sectionMatch.section)
    : new Map<number, string>();

  const { masked } = maskCodeSpans(text);

  // Numbered-citation mode: annotations present, an inline numbered link, or
  // a numbered trailing section. Without one of these, [n] tokens in prose
  // have no known numbering base and are left alone.
  const inlineNumbered = /\[\d{1,3}\]\(https?:\/\//.test(masked);
  if (citations.length === 0 && !inlineNumbered && sectionEntries.size === 0) {
    return { text, resolved: 0, removed: 0, retitled: 0, touched: false };
  }

  const indexOfUrl = new Map<string, number>();
  displayed.forEach((source, index) => {
    if (!indexOfUrl.has(source.url)) indexOfUrl.set(source.url, index);
  });
  const citationTitle = new Map<string, string>();
  for (const c of citations) {
    if (c.title && c.title.length > 0 && !citationTitle.has(c.url)) citationTitle.set(c.url, c.title);
  }

  let resolved = 0;
  let removed = 0;
  let retitled = 0;
  let out = "";
  let cursor = 0;

  // Inline form `[n](url)` first; bare form second, refusing a following
  // `(` (that pair belongs to a link whose URL failed the http(s) test) and
  // `:` (markdown reference definitions like `[1]: https://...`). The bare
  // form also swallows one preceding space so a removed marker does not
  // leave "word ." behind; adjacent markers `[1][2]` have no space to eat.
  const pattern = /\[(\d{1,3})\]\((https?:\/\/[^)\s]+)\)|( ?)\[(\d{1,3})\](?![:(])/g;
  for (const m of masked.matchAll(pattern)) {
    const whole = m[0];
    // A match touching a masked code span is not a citation marker. Spans
    // are NUL runs, and NUL is not excluded by the URL character class, so
    // guard explicitly instead of relying on the mask alone.
    if (whole.includes("\u0000")) continue;
    const start = m.index;

    const n = m[1] !== undefined ? Number(m[1]) : Number(m[4]);
    const inlineUrl = m[2];
    let referent: string | undefined = inlineUrl;
    if (!referent) {
      if (n >= 1 && n <= citations.length) referent = citations[n - 1].url;
      else if (sectionEntries.has(n)) referent = sectionEntries.get(n);
    }

    out += text.slice(cursor, start);
    if (referent !== undefined && indexOfUrl.has(referent)) {
      const k = indexOfUrl.get(referent)! + 1;
      out += inlineUrl ? `[${k}](${inlineUrl})` : (m[3] ?? "") + `[${k}]`;
      resolved++;
    } else if (inlineUrl) {
      // Keep the link (its URL is the citation), but the number would point
      // at the wrong list entry or nothing: retitle it.
      const title = citationTitle.get(inlineUrl) ?? titleFromUrl(inlineUrl);
      out += `[${title}](${inlineUrl})`;
      retitled++;
    } else {
      removed++;
      // The optional leading space (m[3]) is part of the match and is not
      // re-emitted, so "claim [7]." becomes "claim." not "claim .".
    }
    cursor = start + whole.length;
  }
  out += text.slice(cursor);

  return { text: out, resolved, removed, retitled, touched: resolved + removed + retitled > 0 };
}
