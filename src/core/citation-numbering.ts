// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// src/core/citation-numbering.ts: number the Sources list so a bare marker
// [k] in the answer and entry k of the list name the same source.
//
// The answer text is never rewritten (owner decision 2026-11-19): the model
// numbers its markers against the provider's citation list (search-result
// ids, delivered as url_citation annotations in occurrence order), so the
// list is numbered in that order instead. Links that appear only in the
// answer follow the numbered entries. Without provider citations, the list
// keeps its historical order, unless the model numbered its own trailing
// Sources section and wrote bare markers, in which case that section is the
// numbering base. A marker whose number has no entry stays in the text; it
// can never sit beside a wrong source, because nothing is renumbered.

import type { HarvestedCitation } from "./annotations.js";
import { matchTrailingSourcesSection } from "./util.js";

/** Merged display candidate, as mergeCitations() returns it. */
export interface MergedSource {
  url: string;
  title: string;
  inferred?: true;
  originalReference?: string;
}

/** One numbered Sources entry, in render order. */
export interface NumberedSource extends MergedSource {
  /** The entry's number: marker [number] names this source. */
  number: number;
  /** Set when this entry repeats an earlier entry's URL: rendered as a
   *  repeat note instead of a second full link, so a duplicated provider
   *  citation keeps its own number without shifting later entries. */
  repeats?: number;
}

export interface NumberingResult {
  entries: NumberedSource[];
  /** Bare markers in the answer whose number has no entry (beyond the
   *  numbering base). Rendered as one short note; the markers stay. */
  unmatchedMarkers: number;
}

/**
 * Numbers the answer uses: bare `[k]` and inline `[k](url)` forms. The scan
 * is deliberately loose (code and array indices included): a false positive
 * only protects an extra entry from the cap, which is the safe direction.
 */
function usedNumbers(text: string): Set<number> {
  const used = new Set<number>();
  for (const m of text.matchAll(/\[(\d{1,3})\]/g)) used.add(Number(m[1]));
  return used;
}

/** True when the answer contains at least one bare `[n]` marker. */
function hasBareMarkers(text: string): boolean {
  return /\[(\d{1,3})\](?![:(])/.test(text);
}

/**
 * The model's own numbered trailing Sources section, in number order, with
 * each entry's Markdown title when it wrote one. Only meaningful when the
 * provider supplied no citations: it is then the only record of what the
 * model's markers number.
 */
function numberedSectionEntries(
  text: string,
): Array<{ number: number; url: string; title?: string }> {
  const match = matchTrailingSourcesSection(text);
  if (!match) return [];
  const out: Array<{ number: number; url: string; title?: string }> = [];
  const seen = new Set<number>();
  const marked = /^\s*(\d{1,3})[.)]\s*\[([^\]]*)\]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))+)\)/gm;
  for (const m of match.section.matchAll(marked)) {
    const number = Number(m[1]);
    if (seen.has(number)) continue;
    seen.add(number);
    out.push({ number, url: m[3], ...(m[2] ? { title: m[2] } : {}) });
  }
  const bare = /^\s*(\d{1,3})[.)][ \t]+(https?:\/\/(?:[^()\s]|\([^()\s]*\))+)/gm;
  for (const m of match.section.matchAll(bare)) {
    const number = Number(m[1]);
    if (seen.has(number)) continue;
    seen.add(number);
    out.push({ number, url: m[2].replace(/[.,;:!]+$/, "") });
  }
  return out;
}

/**
 * Build the numbered Sources list. `merged` is the full deduplicated
 * candidate list (text links first, then annotation-only URLs, then inferred
 * guesses); `citationOrder` is the provider's occurrence order with
 * duplicates kept (falls back to the deduplicated citations when an adapter
 * does not supply the order); `cap` is the display cap (defaultUrls).
 *
 * Rules:
 * - Provider citations present: entries 1..N are the provider's citations in
 *   occurrence order (a repeated URL repeats its entry with a note). Links
 *   only in the answer follow, numbered from N+1.
 * - No provider citations, but the answer has bare markers and the model
 *   numbered its trailing Sources section: that section numbers the entries
 *   the same way.
 * - Otherwise: today's order, numbered by position, sliced to the cap.
 * - The cap never drops an entry whose number the answer uses, and never
 *   renumbers anything: numbers come from the base, not from position.
 */
export function numberSources(
  text: string,
  merged: ReadonlyArray<MergedSource>,
  citations: ReadonlyArray<HarvestedCitation>,
  citationOrder: ReadonlyArray<HarvestedCitation> | undefined,
  cap: number,
): NumberingResult {
  const used = usedNumbers(text);

  // Base: provider occurrence order, else the model's numbered section.
  const order = citationOrder && citationOrder.length > 0 ? citationOrder : citations;
  let base: ReadonlyArray<{ url: string; title?: string }> | undefined;
  if (order.length > 0) {
    base = order.map((c) => ({ url: c.url, ...(c.title ? { title: c.title } : {}) }));
  } else if (hasBareMarkers(text)) {
    const section = numberedSectionEntries(text);
    if (section.length > 0) {
      base = section.map((e) => ({ url: e.url, ...(e.title ? { title: e.title } : {}) }));
    }
  }

  if (!base) {
    // No numbering base: the historical display, numbered by position.
    return { entries: numberPositional(merged.slice(0, cap)), unmatchedMarkers: 0 };
  }

  // Titles: the provider's title first, else the model's prose-link title,
  // else the URL itself (the render layer sanitises).
  const proseTitle = new Map<string, string>();
  for (const m of merged) if (!m.inferred && !proseTitle.has(m.url)) proseTitle.set(m.url, m.title);
  const titleFor = (url: string, baseTitle?: string): string => {
    if (baseTitle && baseTitle.length > 0) return baseTitle;
    return proseTitle.get(url) ?? url;
  };

  const baseUrls = new Set(base.map((e) => e.url));
  const firstNumberForUrl = new Map<string, number>();
  const entries: NumberedSource[] = [];
  for (const [i, e] of base.entries()) {
    const number = i + 1;
    // The cap bounds the display, but an entry whose number the answer uses
    // is always kept: dropping it would strand a real marker.
    if (number > cap && !used.has(number)) continue;
    const repeats = firstNumberForUrl.get(e.url);
    if (repeats === undefined) firstNumberForUrl.set(e.url, number);
    entries.push({
      number,
      url: e.url,
      title: titleFor(e.url, e.title),
      ...(repeats !== undefined ? { repeats } : {}),
    });
  }

  // Links only in the answer follow the numbered entries, continuing past
  // the base's last number so no entry number can collide with a marker.
  let next = base.length + 1;
  for (const m of merged) {
    if (entries.length >= cap) break;
    if (baseUrls.has(m.url)) continue;
    entries.push({
      number: next++,
      url: m.url,
      title: titleFor(m.url),
      ...(m.inferred ? { inferred: true, originalReference: m.originalReference } : {}),
    });
    baseUrls.add(m.url);
  }

  const baseSize = base.length;
  const unmatchedMarkers = [...used].filter((n) => n >= 1 && n > baseSize).length;
  return { entries, unmatchedMarkers };
}

function numberPositional(sources: ReadonlyArray<MergedSource>): NumberedSource[] {
  return sources.map((s, i) => ({ ...s, number: i + 1 }));
}
