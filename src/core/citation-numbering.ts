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
// answer follow the numbered entries, never taking a number the answer
// already uses beyond the base. Without provider citations, the list keeps
// its historical order, unless the model numbered its own trailing Sources
// section and the answer has bare markers, in which case the model's own
// section numbers are authoritative (kept, ordered by, and continued after).
// A marker whose number has no entry stays in the text beside a short note;
// it can never sit beside a wrong source, because nothing is renumbered.

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
  /** Distinct bare markers in the answer whose number has no entry in the
   *  final list. Rendered as one short note; the markers stay. */
  unmatchedMarkers: number;
  /** True when the model's own numbered Sources section was rejected or
   *  partly rejected (a repeated or zero number): the list may not match
   *  the markers, and the caller says so instead of mispairing silently. */
  ambiguousNumbering: boolean;
}

/**
 * Numbers the answer uses, in any bracketed form. Deliberately loose (code
 * and array indices included): this set only protects entries from the cap,
 * where a false positive is the safe direction. The unmatched-marker note
 * uses the narrower bare set (bareMarkerNumbers).
 */
function usedNumbers(text: string): Set<number> {
  const used = new Set<number>();
  for (const m of text.matchAll(/\[(\d{1,3})\]/g)) used.add(Number(m[1]));
  return used;
}

/**
 * Bare marker shapes only: `[k]` not followed by `(` (an inline link carries
 * its own URL and strands nothing) or `:` (a reference definition). This is
 * the set the note counts; a code index in this shape remains
 * indistinguishable without code detection, an accepted residue.
 */
function bareMarkerNumbers(text: string): Set<number> {
  const used = new Set<number>();
  for (const m of text.matchAll(/\[(\d{1,3})\](?![:(])/g)) used.add(Number(m[1]));
  return used;
}

/** True when the answer contains at least one bare `[n]` marker. */
function hasBareMarkers(text: string): boolean {
  return /\[(\d{1,3})\](?![:(])/.test(text);
}

/** One entry of a numbering base: a number, a URL, and a title if the
 *  provider or the model's section supplied one. */
interface BaseEntry {
  number: number;
  url: string;
  title?: string;
}

/**
 * The model's own numbered trailing Sources section, in document order,
 * keeping each entry's own number whatever link form it was written in (a
 * marked link and a bare URL in one section keep their relative order).
 * Only meaningful when the provider supplied no citations: it is then the
 * only record of what the model's markers number. Returns undefined when
 * the section is absent. Numbers the section numbers unambiguously (each
 * once, and not zero) become the base; a repeated or zero number is
 * "blocked": its entries drop out of the base and the number is never
 * handed to an answer-only link, because either choice would guess which
 * entry a duplicated number means. The caller surfaces the ambiguity with
 * a note instead of silently mispairing markers. Trailing punctuation is
 * stripped from a bare URL only, matching extractSourceUrls pass 1 (marked
 * links keep their exact URL). Numbers above 999 do not match the parser
 * (\d{1,3}, the same boundary every marker scan uses); their entries drop
 * to the answer-only list and their markers raise the unmatched note.
 */
interface SectionBase {
  usable: BaseEntry[];
  blocked: Set<number>;
}

function numberedSectionBase(text: string): SectionBase | undefined {
  const match = matchTrailingSourcesSection(text);
  if (!match) return undefined;
  const parsed: BaseEntry[] = [];
  const blocked = new Set<number>();
  // One alternation, matched over the whole section: matchAll yields
  // matches in document order, so mixed formats keep the order the model
  // wrote them in.
  const pattern =
    /^\s*(\d{1,3})[.)][ \t]*(?:\[([^\]]*)\]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))+)\)|(https?:\/\/(?:[^()\s]|\([^()\s]*\))+))/gm;
  for (const m of match.section.matchAll(pattern)) {
    const number = Number(m[1]);
    // Bare URLs only: a marked link's URL is exact (extractSourceUrls pass 1
    // does not strip it), so stripping it would rename the source.
    const url = m[3] ?? m[4].replace(/[.,;:!]+$/, "");
    parsed.push({ number, url, ...(m[2] ? { title: m[2] } : {}) });
  }
  // A number the section used more than once, or zero, is ambiguous: no
  // entry keeps it and no answer-only link may take it.
  const counts = new Map<number, number>();
  for (const e of parsed) counts.set(e.number, (counts.get(e.number) ?? 0) + 1);
  const usable = parsed.filter((e) => e.number >= 1 && counts.get(e.number) === 1);
  for (const [number, count] of counts) {
    if (number < 1 || count > 1) blocked.add(number);
  }
  return { usable, blocked };
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
 *   only in the answer follow, numbered past N, skipping every number the
 *   answer already uses so a stranded marker keeps its number and its note.
 * - No provider citations, but the answer has bare markers and the model
 *   numbered its trailing Sources section: the model's numbers are
 *   authoritative; entries keep them, are ordered by them, and answer-only
 *   links continue after the largest section number.
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
  // The reader sees the answer without the model's trailing Sources section
  // (stripTrailingSourcesSection removes it downstream), so marker scans run
  // on that span: a bracketed number written only inside the section must
  // neither fire the note nor switch the display to the section base.
  const sectionMatch = matchTrailingSourcesSection(text);
  const answerText = sectionMatch ? text.slice(0, sectionMatch.start) : text;
  const used = usedNumbers(answerText);

  // Base: provider occurrence order, else the model's numbered section.
  const order = citationOrder && citationOrder.length > 0 ? citationOrder : citations;
  let base: BaseEntry[] | undefined;
  let blocked = new Set<number>();
  let ambiguousNumbering = false;
  if (order.length > 0) {
    base = order.map((c, i) => ({
      number: i + 1,
      url: c.url,
      ...(c.title ? { title: c.title } : {}),
    }));
  } else if (hasBareMarkers(answerText)) {
    const section = numberedSectionBase(text);
    if (section) {
      base = [...section.usable].sort((a, b) => a.number - b.number);
      blocked = section.blocked;
      if (base.length === 0) {
        // No number the section used unambiguously: nothing to honour.
        // Keep the historical positional display, but say so: markers may
        // not match the list, and never pair them silently.
        return {
          entries: numberPositional(merged.slice(0, cap)),
          unmatchedMarkers: 0,
          ambiguousNumbering: true,
        };
      }
      ambiguousNumbering = blocked.size > 0;
    }
  }

  if (!base) {
    // No numbering base: the historical display, numbered by position.
    return { entries: numberPositional(merged.slice(0, cap)), unmatchedMarkers: 0, ambiguousNumbering: false };
  }

  // Titles: the provider's (or section's) title first, else the model's
  // prose-link title, else the URL itself (the render layer sanitises).
  const proseTitle = new Map<string, string>();
  for (const m of merged) if (!proseTitle.has(m.url)) proseTitle.set(m.url, m.title);
  const titleFor = (url: string, baseTitle?: string): string => {
    if (baseTitle && baseTitle.length > 0) return baseTitle;
    return proseTitle.get(url) ?? url;
  };

  const baseUrls = new Set(base.map((e) => e.url));
  const firstNumberForUrl = new Map<string, number>();
  const entries: NumberedSource[] = [];
  for (const e of base) {
    // The cap bounds the display, but an entry whose number the answer uses
    // is always kept: dropping it would strand a real marker.
    if (e.number > cap && !used.has(e.number)) continue;
    const repeats = firstNumberForUrl.get(e.url);
    if (repeats === undefined) firstNumberForUrl.set(e.url, e.number);
    entries.push({
      number: e.number,
      url: e.url,
      title: titleFor(e.url, e.title),
      ...(repeats !== undefined ? { repeats } : {}),
    });
  }

  // Links only in the answer follow the numbered entries. Numbers continue
  // past the base's largest number and skip every number the answer already
  // uses and every number the section left ambiguous, so a stranded marker
  // keeps its number and its note instead of being silently paired with an
  // answer-only link.
  const baseSize = base[base.length - 1].number;
  let next = baseSize + 1;
  for (const m of merged) {
    if (entries.length >= cap) break;
    if (baseUrls.has(m.url)) continue;
    while (used.has(next) || blocked.has(next)) next++;
    entries.push({
      number: next++,
      url: m.url,
      // The merged label (including inferred-from-text derivations) is what
      // the historical display showed; keep it before falling back to the URL.
      title: m.title || titleFor(m.url),
      ...(m.inferred ? { inferred: true, originalReference: m.originalReference } : {}),
    });
    baseUrls.add(m.url);
  }

  // Answer-only links never take a used or blocked number, so a bare
  // marker whose number has no entry in the FINAL list (beyond the base, or
  // in an interior gap of the model's own numbering) is counted.
  const present = new Set(entries.map((e) => e.number));
  const unmatchedMarkers = [...bareMarkerNumbers(answerText)].filter((n) => !present.has(n)).length;
  return { entries, unmatchedMarkers, ambiguousNumbering };
}

function numberPositional(sources: ReadonlyArray<MergedSource>): NumberedSource[] {
  return sources.map((s, i) => ({ ...s, number: i + 1 }));
}
