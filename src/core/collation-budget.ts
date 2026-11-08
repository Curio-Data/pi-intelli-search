// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
// Collation input budget: what actually goes to the collation model when the
// extractions are larger than its input budget allows. Pure arithmetic plus
// boundary-aware truncation, so the trimming order is testable without a
// model call. Saved extractions on disk are never touched; callers pass text
// and keep their own copies.

/** Characters per token used to size text against a token budget. */
export const CHARS_PER_TOKEN = 4;

/** Per-source prompt overhead (URL, title, type, JSON keys) in tokens. */
export const COLLATION_HEADER_TOKENS_PER_SOURCE = 100;

/**
 * Smallest useful amount of extraction text per source (≈100 tokens). A fair
 * share below this keeps no usable evidence, so whole sources are left out
 * instead of every source being reduced to a fragment.
 */
export const MIN_COLLATION_SOURCE_CHARS = 400;

export interface CollationBudgetItem {
  url: string;
  text: string;
  /** Guessed from search prose rather than cited by the search model. */
  inferred?: boolean;
  /**
   * Measured characters this source's entry adds to the request besides its
   * extraction text (keys, URL, title, indentation). The fixed per-source
   * header is the floor, so a long URL or title is charged in full.
   */
  overheadChars?: number;
}

export interface CollationBudgetOptions {
  /** Tokens available for the extractions, their headers and the synthesis. */
  budgetTokens: number;
  /** Per-extraction ceiling on the text sent, in tokens. */
  sourceMaxTokens: number;
}

export interface CollationBudgetTrim {
  url: string;
  inferred: boolean;
  /** `trimmed` keeps a prefix; `dropped` sends none of this source. */
  action: "trimmed" | "dropped";
  /** Whether the per-extraction cap reduced this source, before budget trimming. */
  sourceCap: boolean;
  /** Whether the shared budget also reduced or dropped this source. */
  budget: boolean;
  originalChars: number;
  keptChars: number;
}

export interface CollationBudgetPlan {
  /** Text to send, in the caller's order. Dropped sources carry `""`. */
  sources: Array<{ url: string; text: string; inferred: boolean; keptChars: number }>;
  /** Every source whose text was reduced or left out, in input order. */
  trims: CollationBudgetTrim[];
  budgetTokens: number;
  sourceMaxTokens: number;
  /** Extraction characters before and after the plan. */
  charsBefore: number;
  charsAfter: number;
  /** True when source-capped extractions plus headers still exceeded the budget. */
  overBudget: boolean;
  /** True when the budget was too small even for one source's header. */
  budgetUnusable: boolean;
}

/**
 * Decide what the collation model receives.
 *
 * Order, as the owner specified: cap each extraction's visible text first;
 * then, if the total still exceeds the budget, trim the longest extractions
 * down to a fair share of it, inferred references before cited sources; then,
 * only when a fair share would keep too little to be useful, leave whole
 * sources out, lowest-ranked first with inferred sources first. Within a
 * group the later source in the search's order is the lower-ranked one.
 */
export function planCollationBudget(
  items: readonly CollationBudgetItem[],
  options: CollationBudgetOptions,
): CollationBudgetPlan {
  const budgetChars = Math.max(0, Math.floor(options.budgetTokens * CHARS_PER_TOKEN));
  const sourceCapChars = Math.max(1, Math.floor(options.sourceMaxTokens * CHARS_PER_TOKEN));
  const headerChars = COLLATION_HEADER_TOKENS_PER_SOURCE * CHARS_PER_TOKEN;
  const charsBefore = items.reduce((sum, item) => sum + item.text.length, 0);

  // Step 1: the per-extraction text cap, independent of the output cap.
  const kept = items.map((item) => Math.min(item.text.length, sourceCapChars));
  // The budget is spent in request characters: the request is JSON, so a
  // newline, quote or backslash costs two characters and a control character
  // six. Measuring raw text would let a line-heavy extraction overrun it.
  const wire = kept.map((n, i) => serializedLength(items[i].text, n));
  const available =
    budgetChars -
    items.reduce((sum, item) => sum + Math.max(headerChars, item.overheadChars ?? 0), 0);
  const totalCapped = wire.reduce((sum, n) => sum + n, 0);
  const overBudget = totalCapped > available;

  const dropped = new Set<number>();
  const budgetLimited = new Set<number>();
  if (overBudget && items.length > 0) {
    let live = items.map((_, i) => i);
    const fairShare = (count: number): number =>
      count > 0 ? Math.max(0, Math.floor(available / count)) : 0;
    // Step 3 (reached first only when the budget is too small): leave whole
    // sources out until a fair share keeps something worth sending.
    while (live.length > 1 && fairShare(live.length) < MIN_COLLATION_SOURCE_CHARS) {
      const victim = dropCandidate(live, items);
      dropped.add(victim);
      live = live.filter((i) => i !== victim);
    }
    if (live.reduce((sum, j) => sum + wire[j], 0) > available) {
      // Step 2: trim the longest down to the fair share. Ordering is
      // observable because the loop stops as soon as the total fits.
      const share = fairShare(live.length);
      for (const i of trimOrder(live, items, wire)) {
        if (live.reduce((sum, j) => sum + wire[j], 0) <= available) break;
        if (wire[i] <= share) continue;
        const limit = prefixWithin(items[i].text, kept[i], share);
        kept[i] = truncateAtBoundary(items[i].text, limit).length;
        wire[i] = serializedLength(items[i].text, kept[i]);
        budgetLimited.add(i);
      }
    }
  }

  const sources = items.map((item, i) => {
    const keptChars = dropped.has(i) ? 0 : kept[i];
    return {
      url: item.url,
      text: keptChars === item.text.length ? item.text : item.text.slice(0, keptChars),
      inferred: item.inferred === true,
      keptChars,
    };
  });
  const trims: CollationBudgetTrim[] = [];
  for (const [i, item] of items.entries()) {
    const keptChars = sources[i].keptChars;
    if (keptChars === item.text.length) continue;
    trims.push({
      url: item.url,
      inferred: item.inferred === true,
      action: keptChars === 0 ? "dropped" : "trimmed",
      sourceCap: item.text.length > sourceCapChars,
      budget: dropped.has(i) || budgetLimited.has(i),
      originalChars: item.text.length,
      keptChars,
    });
  }

  return {
    sources,
    trims,
    budgetTokens: options.budgetTokens,
    sourceMaxTokens: options.sourceMaxTokens,
    charsBefore,
    charsAfter: sources.reduce((sum, source) => sum + source.text.length, 0),
    overBudget,
    budgetUnusable: available <= 0 && items.length > 0,
  };
}

/** Trim order: inferred references first, then the longest in the request first. */
function trimOrder(
  live: readonly number[],
  items: readonly CollationBudgetItem[],
  wire: readonly number[],
): number[] {
  return [...live].sort((a, b) => {
    const inferredA = items[a].inferred === true ? 0 : 1;
    const inferredB = items[b].inferred === true ? 0 : 1;
    return inferredA - inferredB || wire[b] - wire[a] || a - b;
  });
}

/** Characters one UTF-16 unit takes inside a JSON string, pairs counted per unit. */
function unitWidth(text: string, i: number): number {
  const c = text.charCodeAt(i);
  if (c === 0x22 || c === 0x5c) return 2;
  if (c < 0x20) return c === 8 || c === 9 || c === 10 || c === 12 || c === 13 ? 2 : 6;
  if (c >= 0xd800 && c <= 0xdbff) {
    const next = text.charCodeAt(i + 1);
    return next >= 0xdc00 && next <= 0xdfff ? 1 : 6;
  }
  if (c >= 0xdc00 && c <= 0xdfff) {
    const prev = i > 0 ? text.charCodeAt(i - 1) : 0;
    return prev >= 0xd800 && prev <= 0xdbff ? 1 : 6;
  }
  return 1;
}

/**
 * Length of `text.slice(0, n)` once escaped as a JSON string body, as
 * `JSON.stringify` writes it (lone surrogates as `\uXXXX`). Exported for tests.
 */
export function serializedLength(text: string, n = text.length): number {
  let total = 0;
  for (let i = 0; i < n; i++) {
    // A prefix that ends inside a pair leaves a lone high surrogate.
    total += i === n - 1 && isHigh(text, i) ? 6 : unitWidth(text, i);
  }
  return total;
}

function isHigh(text: string, i: number): boolean {
  const c = text.charCodeAt(i);
  return c >= 0xd800 && c <= 0xdbff;
}

/**
 * Longest prefix of at most `maxChars` whose serialized length fits `share`.
 * A surrogate pair is kept or cut whole, so the prefix never ends inside one.
 */
function prefixWithin(text: string, maxChars: number, share: number): number {
  let total = 0;
  let i = 0;
  while (i < maxChars) {
    const step = isHigh(text, i) && unitWidth(text, i) === 1 && i + 1 < maxChars ? 2 : 1;
    const width = step === 2 ? 2 : i === maxChars - 1 && isHigh(text, i) ? 6 : unitWidth(text, i);
    if (total + width > share) return i;
    total += width;
    i += step;
  }
  return maxChars;
}

/** Lowest-ranked live source: inferred first, then last in the caller's order. */
function dropCandidate(live: readonly number[], items: readonly CollationBudgetItem[]): number {
  for (let i = live.length - 1; i >= 0; i--) if (items[live[i]].inferred === true) return live[i];
  return live[live.length - 1];
}

/**
 * Cut at a paragraph, line, sentence or word boundary when one falls in the
 * last fifth of the allowance, so a trimmed extraction does not end mid-word.
 */
function truncateAtBoundary(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const window = text.slice(0, Math.max(0, limit));
  const floor = Math.floor(window.length * 0.8);
  const boundaries: Array<[string, number]> = [
    ["\n\n", 0],
    ["\n", 0],
    [". ", 1],
    [" ", 0],
  ];
  for (const [marker, extra] of boundaries) {
    const at = window.lastIndexOf(marker);
    if (at >= floor) return window.slice(0, at + extra);
  }
  return window;
}

/**
 * Whether a source was guessed from search prose rather than cited by the
 * search model. The provenance flag arrives with the asset-classification
 * work on another track; a source without it counts as cited evidence, the
 * higher rank, so trimming never treats a citation as a guess by default.
 */
export function inferredSource(source: object): boolean {
  return (source as { inferred?: unknown }).inferred === true;
}
