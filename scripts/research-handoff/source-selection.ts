// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// rh-v6 bounded source selection (PILOT-CONTINUATION.md, Source Selection Policy).
// A pure, synchronous state machine: the capture drives it with live page
// fetches; frozen-input validation re-drives it from the recorded fetch log and
// requires an identical derivation. It never edits the raw search completion,
// its citations or the core's discovery list; it records a separate derived
// source inventory that both arms replay.

import type { FetchedPage, ResearchSettings } from "../../src/core/types.js";
import type { DeepReadonly, ResearchParams } from "../../src/core/contracts.js";
import { canonicalJson, sha256Hex } from "./common-inputs.js";

export interface SourcePolicy {
  id: string;
  /** Distinct allowed discovery URLs admitted as seeds, in discovery order. */
  seedLimit: number;
  /** Selected page texts, seeds included. */
  selectedLimit: number;
  /** Seeds are depth 0; pages at maxDepth are fetched but not expanded. */
  maxDepth: number;
  /** Page acquisitions, seeds included, whatever their outcome. */
  maxFetches: number;
  /** Distinct followed-link candidates retained across the whole capture. */
  maxCandidates: number;
  /** Links examined per expanded page, in document order. */
  maxLinksPerPage: number;
  /** Minimum number of distinct task terms a followed link must match. */
  minTermScore: number;
  /** Tokens at least this long match when they share this many leading characters. */
  minPrefix: number;
  /** Final path-segment extensions treated as documents; an extensionless segment is always a document. */
  documentExtensions: string[];
  /** Generic English function words removed from task terms and link tokens. */
  stopwords: string[];
  /**
   * Base for resolving a page's relative links. "canonical-directory": the requested URL with its
   * fragment removed and, when its final path segment has no extension and no trailing slash, a
   * trailing slash appended. The fetched URL itself is never rewritten.
   */
  linkBase: "canonical-directory";
}

/** Frozen before any rh-v6 capture; PILOT-CONTINUATION.md carries the same JSON and a test binds them. */
export const RH6_SOURCE_POLICY: SourcePolicy = {
  id: "rh-v6-source-policy-2",
  seedLimit: 6,
  selectedLimit: 12,
  maxDepth: 2,
  maxFetches: 24,
  maxCandidates: 400,
  maxLinksPerPage: 200,
  minTermScore: 1,
  minPrefix: 5,
  documentExtensions: ["htm", "html", "md"],
  stopwords: [
    "a", "about", "all", "also", "an", "and", "any", "are", "as", "at", "be", "between", "by", "can", "do", "does", "each",
    "for", "from", "how", "i", "if", "in", "into", "is", "it", "its", "me", "my", "no", "not", "of", "on", "only", "or",
    "other", "our", "own", "same", "should", "so", "such", "than", "that", "the", "their", "them", "then", "these", "this",
    "to", "too", "very", "was", "we", "what", "when", "where", "which", "while", "who", "why", "will", "with", "would",
    "yes", "you", "your",
  ],
  linkBase: "canonical-directory",
};
export const SOURCE_POLICIES: Readonly<Record<string, SourcePolicy>> = { [RH6_SOURCE_POLICY.id]: RH6_SOURCE_POLICY };

export type DiscoveryDecision = "seed" | "invalid-url" | "host-not-allowed" | "non-document" | "duplicate-alias" | "seed-limit";
export type FetchOutcome = "selected" | "fetch-error" | "empty-content" | "duplicate-content";
export interface DerivedFetch {
  order: number;
  url: string;
  key: string;
  depth: number;
  parentKey: string | null;
  outcome: FetchOutcome;
  contentSha256: string | null;
  /** Index into the frozen pages for a selected fetch; null otherwise. */
  selectedIndex: number | null;
  /** Fetch order of the selected page whose bytes this fetch duplicated. */
  duplicateOf: number | null;
  /** The returned page, retained only when it is not one of the selected pages. */
  page?: FetchedPage;
}
export interface DerivedCandidate {
  order: number;
  url: string;
  key: string;
  depth: number;
  parentKey: string;
  anchor: string;
  termScore: number;
  matchedTerms: string[];
  sameSection: boolean;
  status: "fetched" | "eligible-unfetched" | "below-threshold";
}
export interface SourceDerivation {
  policy: SourcePolicy;
  policySha256: string;
  domains: string[];
  taskTerms: string[];
  discovery: Array<{ position: number; url: string; key: string | null; decision: DiscoveryDecision }>;
  fetches: DerivedFetch[];
  candidates: DerivedCandidate[];
  ignoredLinks: Record<"invalid" | "offHost" | "nonDocument" | "known" | "perPageLimit" | "candidateLimit", number>;
  selected: Array<{ url: string; key: string; depth: number; parentKey: string | null; title: string; fetchOrder: number; contentSha256: string }>;
  stopReason: "selected-limit" | "fetch-limit" | "frontier-exhausted";
}

// ── URL policy ──────────────────────────────────────────────────────────────

function parse(raw: string, base?: string): URL | undefined {
  let url: URL;
  try { url = base === undefined ? new URL(raw) : new URL(raw, base); } catch { return undefined; }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return undefined;
  return url;
}
function lastSegment(path: string): string { return path.split("/").at(-1) ?? ""; }

/**
 * Identity key for alias detection: https scheme, lower-case host without a
 * trailing dot, explicit non-default port kept, query and fragment dropped,
 * repeated slashes collapsed, a final `index.md`, `index.html` or `index.htm`
 * removed, and a trailing slash added to an extensionless final segment.
 */
export function canonicalKey(raw: string, base?: string): string | undefined {
  const url = parse(raw, base);
  if (!url) return undefined;
  let path = url.pathname.replace(/\/{2,}/g, "/").replace(/\/index\.(?:md|html?)$/i, "/");
  if (!path.endsWith("/") && !lastSegment(path).includes(".")) path += "/";
  return `https://${url.hostname.toLowerCase().replace(/\.$/, "")}${url.port ? `:${url.port}` : ""}${path}`;
}
/** The URL actually fetched: the resolved address with only its fragment removed. */
export function fetchUrl(raw: string, base?: string): string | undefined {
  const url = parse(raw, base);
  if (!url) return undefined;
  url.hash = "";
  return url.href;
}
/**
 * Directory-form base for relative links (policy `linkBase: "canonical-directory"`). An extensionless
 * final segment without a trailing slash is treated as a directory, matching the canonical key, so
 * `…/email-service` resolves `setup/` to `…/email-service/setup/`. Query is kept, fragment removed;
 * index files and other files already resolve against their own directory and are unchanged.
 */
export function linkBaseUrl(raw: string): string | undefined {
  const url = parse(raw);
  if (!url) return undefined;
  url.hash = "";
  if (!url.pathname.endsWith("/") && !lastSegment(url.pathname).includes(".")) url.pathname += "/";
  return url.href;
}
/** Exact host equality with one listed domain; subdomains and parent domains are not allowed. */
export function hostAllowed(raw: string, domains: readonly string[]): boolean {
  const url = parse(raw);
  if (!url) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  return domains.some(domain => domain.toLowerCase() === host);
}
export function isDocument(raw: string, policy: SourcePolicy): boolean {
  const url = parse(raw);
  if (!url) return false;
  const segment = lastSegment(url.pathname);
  const dot = segment.lastIndexOf(".");
  return dot < 0 || policy.documentExtensions.includes(segment.slice(dot + 1).toLowerCase());
}

// ── Links and relevance ─────────────────────────────────────────────────────

/** Markdown inline links, autolinks and reference definitions, in document order; images, fragments and non-web schemes are skipped. */
export function extractLinks(content: string): Array<{ href: string; anchor: string }> {
  const found: Array<{ index: number; href: string; anchor: string }> = [];
  for (const match of content.matchAll(/(!?)\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"\n]*")?\s*\)/g)) {
    if (match[1] !== "!") found.push({ index: match.index ?? 0, href: match[3], anchor: match[2] });
  }
  for (const match of content.matchAll(/<(https?:\/\/[^>\s]+)>/g)) found.push({ index: match.index ?? 0, href: match[1], anchor: "" });
  for (const match of content.matchAll(/^[ \t]{0,3}\[([^\]\n]+)\]:[ \t]*<?(\S+?)>?(?:[ \t]+"[^"\n]*")?[ \t]*$/gm)) {
    found.push({ index: match.index ?? 0, href: match[2], anchor: match[1] });
  }
  return found.sort((a, b) => a.index - b.index)
    .filter(link => !/^(?:#|mailto:|javascript:|tel:|data:)/i.test(link.href))
    .map(({ href, anchor }) => ({ href, anchor }));
}
export function tokens(text: string, policy: SourcePolicy): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(token => token && !/^\d+$/.test(token) && !policy.stopwords.includes(token));
}
/** Distinct terms of the frozen query and focus, in first-occurrence order. */
export function taskTerms(params: Pick<ResearchParams, "query" | "focusPrompt">, policy: SourcePolicy): string[] {
  return [...new Set(tokens(`${params.query} ${params.focusPrompt ?? ""}`, policy))];
}
export function termsMatch(a: string, b: string, policy: SourcePolicy): boolean {
  if (a === b) return true;
  if (a.length < policy.minPrefix || b.length < policy.minPrefix) return false;
  return a.slice(0, policy.minPrefix) === b.slice(0, policy.minPrefix);
}
function pathOf(raw: string): string { return parse(raw)?.pathname ?? ""; }
function section(raw: string): string { return pathOf(raw).split("/").filter(Boolean)[0] ?? ""; }

// ── State machine ───────────────────────────────────────────────────────────

interface Pending { url: string; key: string; depth: number; parentKey: string | null; candidate?: DerivedCandidate }

export class SourceSelection {
  private readonly terms: string[];
  private readonly known = new Set<string>();
  private readonly seeds: Pending[] = [];
  private readonly discovery: SourceDerivation["discovery"] = [];
  private readonly fetches: DerivedFetch[] = [];
  private readonly candidates: DerivedCandidate[] = [];
  private readonly selected: SourceDerivation["selected"] = [];
  private readonly pages: FetchedPage[] = [];
  private readonly ignored: SourceDerivation["ignoredLinks"] = { invalid: 0, offHost: 0, nonDocument: 0, known: 0, perPageLimit: 0, candidateLimit: 0 };
  private pending: Pending | undefined;
  private stop: SourceDerivation["stopReason"] | undefined;

  constructor(private readonly policy: SourcePolicy, private readonly params: Pick<ResearchParams, "query" | "focusPrompt" | "domains">, discoveryUrls: readonly string[]) {
    this.terms = taskTerms(params, policy);
    const domains = params.domains ?? [];
    for (const [position, url] of discoveryUrls.entries()) {
      const key = canonicalKey(url) ?? null, target = fetchUrl(url);
      let decision: DiscoveryDecision;
      if (!key || !target) decision = "invalid-url";
      else if (!hostAllowed(target, domains)) decision = "host-not-allowed";
      else if (!isDocument(target, policy)) decision = "non-document";
      else if (this.known.has(key)) decision = "duplicate-alias";
      else if (this.seeds.length >= policy.seedLimit) decision = "seed-limit";
      else { decision = "seed"; this.known.add(key); this.seeds.push({ url: target, key, depth: 0, parentKey: null }); }
      this.discovery.push({ position, url, key, decision });
    }
  }

  /** The next page to acquire, or undefined when a bound or the frontier ends the selection. */
  next(): { url: string; depth: number; order: number } | undefined {
    if (this.pending) throw new Error("Source selection awaits the previous page");
    if (this.selected.length >= this.policy.selectedLimit) { this.stop = "selected-limit"; return undefined; }
    if (this.fetches.length >= this.policy.maxFetches) { this.stop = "fetch-limit"; return undefined; }
    const seed = this.seeds.shift();
    if (seed) { this.pending = seed; return { url: seed.url, depth: 0, order: this.fetches.length }; }
    let best: DerivedCandidate | undefined;
    for (const candidate of this.candidates) {
      if (candidate.status !== "eligible-unfetched") continue;
      if (!best || candidate.termScore > best.termScore
        || candidate.termScore === best.termScore && (Number(candidate.sameSection) > Number(best.sameSection)
          || candidate.sameSection === best.sameSection && (candidate.depth < best.depth
            || candidate.depth === best.depth && candidate.order < best.order))) best = candidate;
    }
    if (!best) { this.stop = "frontier-exhausted"; return undefined; }
    best.status = "fetched";
    this.pending = { url: best.url, key: best.key, depth: best.depth, parentKey: best.parentKey, candidate: best };
    return { url: best.url, depth: best.depth, order: this.fetches.length };
  }

  /** Records the page returned for the last `next()` and expands its links within the bounds. */
  accept(page: FetchedPage | undefined): void {
    const pending = this.pending;
    if (!pending) throw new Error("Source selection received a page it did not request");
    this.pending = undefined;
    const order = this.fetches.length;
    const returned: FetchedPage = page ?? { url: pending.url, title: "", content: "", status: "error", error: "No page returned" };
    const base = { order, url: pending.url, key: pending.key, depth: pending.depth, parentKey: pending.parentKey };
    if (returned.status !== "success") {
      this.fetches.push({ ...base, outcome: "fetch-error", contentSha256: null, selectedIndex: null, duplicateOf: null, page: structuredClone(returned) });
      return;
    }
    const contentSha256 = sha256Hex(returned.content);
    if (!returned.content.trim()) {
      this.fetches.push({ ...base, outcome: "empty-content", contentSha256, selectedIndex: null, duplicateOf: null, page: structuredClone(returned) });
      return;
    }
    const duplicate = this.selected.find(item => item.contentSha256 === contentSha256);
    if (duplicate) {
      this.fetches.push({ ...base, outcome: "duplicate-content", contentSha256, selectedIndex: null, duplicateOf: duplicate.fetchOrder, page: structuredClone(returned) });
      return;
    }
    const selectedIndex = this.selected.length;
    this.fetches.push({ ...base, outcome: "selected", contentSha256, selectedIndex, duplicateOf: null });
    this.selected.push({ url: returned.url, key: pending.key, depth: pending.depth, parentKey: pending.parentKey, title: returned.title, fetchOrder: order, contentSha256 });
    this.pages.push(structuredClone(returned));
    if (pending.depth < this.policy.maxDepth) this.expand(returned.content, pending);
  }

  private expand(content: string, parent: Pending): void {
    const domains = this.params.domains ?? [];
    const links = extractLinks(content);
    const base = linkBaseUrl(parent.url) ?? parent.url;
    if (links.length > this.policy.maxLinksPerPage) this.ignored.perPageLimit += links.length - this.policy.maxLinksPerPage;
    for (const link of links.slice(0, this.policy.maxLinksPerPage)) {
      const key = canonicalKey(link.href, base), target = fetchUrl(link.href, base);
      if (!key || !target) { this.ignored.invalid++; continue; }
      if (!hostAllowed(target, domains)) { this.ignored.offHost++; continue; }
      if (!isDocument(target, this.policy)) { this.ignored.nonDocument++; continue; }
      if (this.known.has(key)) { this.ignored.known++; continue; }
      if (this.candidates.length >= this.policy.maxCandidates) { this.ignored.candidateLimit++; continue; }
      this.known.add(key);
      const linkTokens = [...tokens(link.anchor, this.policy), ...tokens(decodeURIComponentSafe(pathOf(target)), this.policy)];
      const matchedTerms = this.terms.filter(term => linkTokens.some(token => termsMatch(term, token, this.policy)));
      this.candidates.push({ order: this.candidates.length, url: target, key, depth: parent.depth + 1, parentKey: parent.key,
        anchor: link.anchor, termScore: matchedTerms.length, matchedTerms, sameSection: section(target) === section(parent.url),
        status: matchedTerms.length >= this.policy.minTermScore ? "eligible-unfetched" : "below-threshold" });
    }
  }

  selectedPages(): FetchedPage[] { return structuredClone(this.pages); }
  result(): SourceDerivation {
    if (this.pending || !this.stop) throw new Error("Source selection has not finished");
    return structuredClone({
      policy: this.policy, policySha256: sha256Hex(canonicalJson(this.policy)), domains: [...(this.params.domains ?? [])], taskTerms: this.terms,
      discovery: this.discovery, fetches: this.fetches, candidates: this.candidates, ignoredLinks: this.ignored, selected: this.selected, stopReason: this.stop,
    });
  }
}
function decodeURIComponentSafe(value: string): string { try { return decodeURIComponent(value); } catch { return value; } }

/** Drives a selection to completion with a synchronous page source. */
export function deriveSelection(policy: SourcePolicy, params: Pick<ResearchParams, "query" | "focusPrompt" | "domains">, discoveryUrls: readonly string[],
  acquire: (step: { url: string; depth: number; order: number }) => FetchedPage | undefined): { derivation: SourceDerivation; pages: FetchedPage[] } {
  const selection = new SourceSelection(policy, params, discoveryUrls);
  for (let step = selection.next(); step; step = selection.next()) selection.accept(acquire(step));
  return { derivation: selection.result(), pages: selection.selectedPages() };
}

/**
 * Validation of a frozen derivation: the policy must be a registered frozen
 * policy, and replaying the recorded fetch log against the captured
 * discovery list must reproduce the derivation and the frozen pages exactly.
 * Returns problems; never throws for content.
 */
export function verifySourceDerivation(frozen: {
  capture: { params: ResearchParams; selectedSources: Array<{ url: string }> };
  pages: Array<{ page: FetchedPage }>;
  settings: DeepReadonly<ResearchSettings>;
  sourceDerivation?: SourceDerivation;
}): string[] {
  const derivation = frozen.sourceDerivation;
  if (!derivation) return [];
  const problems: string[] = [];
  const policy = SOURCE_POLICIES[derivation.policy?.id];
  if (!policy || canonicalJson(policy) !== canonicalJson(derivation.policy)) return ["sourceDerivation.policy is not a registered frozen source policy"];
  if (derivation.policySha256 !== sha256Hex(canonicalJson(policy))) problems.push("sourceDerivation.policySha256 does not match the frozen policy");
  if (frozen.settings.maxUrls < policy.selectedLimit) problems.push(`settings.maxUrls ${frozen.settings.maxUrls} is below the policy's ${policy.selectedLimit} selected sources`);
  const log = Array.isArray(derivation.fetches) ? derivation.fetches : [];
  let replayed: ReturnType<typeof deriveSelection>;
  try {
    replayed = deriveSelection(policy, frozen.capture.params, frozen.capture.selectedSources.map(source => source.url), step => {
      const entry = log[step.order];
      if (!entry || entry.url !== step.url || entry.depth !== step.depth) throw new Error(`recorded fetch ${step.order} does not match the policy's request ${step.url}`);
      if (entry.outcome === "selected") {
        const page = frozen.pages[entry.selectedIndex ?? -1]?.page;
        if (!page) throw new Error(`recorded fetch ${step.order} names a missing frozen page`);
        return page;
      }
      return entry.page;
    });
  } catch (error) { return [...problems, `sourceDerivation does not replay: ${error instanceof Error ? error.message : String(error)}`]; }
  if (canonicalJson(replayed.derivation) !== canonicalJson(derivation)) problems.push("sourceDerivation differs from the derivation recomputed from the captured discovery list and fetch log");
  if (canonicalJson(replayed.pages) !== canonicalJson(frozen.pages.map(entry => entry.page))) problems.push("frozen pages differ from the derivation's selected pages");
  if (derivation.selected.length === 0) problems.push("sourceDerivation selected no page");
  return problems;
}
