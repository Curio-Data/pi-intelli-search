// src/core/messages.ts: Message/appendix builders shared by the intelli_* operations.
//
// Extracted from intelli-search, intelli-extract, intelli-collate, and
// intelli-research, which built these strings independently with small
// drift (three different truncation markers, "failed" vs "blocked" source
// counts). One builder per artefact; each is pure and unit-tested in
// test/shared.test.ts.
//
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
// SPDX-License-Identifier: Apache-2.0
import type { SourceIdentity } from "./cache.js";
import type { CollationBudgetPlan, CollationBudgetTrim } from "./collation-budget.js";
import { MAX_OUTPUT_TOKENS, TUNING_RANGES } from "./defaults.js";
import { evidenceExtractions } from "./provenance.js";
import { truncateContent } from "./util.js";
import type { ExtractResult, ResearchSettings } from "./types.js";
import type { DeepReadonly } from "./contracts.js";

/**
 * Append a `site:` filter to a search query. Returns the query unchanged
 * when no domains are given. This guides search; it is not a network allowlist.
 */
export function appendDomainFilter(query: string, domains?: string[]): string {
  if (!domains?.length) return query;
  return query + " site:" + domains.join(" OR site:");
}

const WEB_SEARCH_ENGINES = new Set([
  "auto",
  "native",
  "exa",
  "parallel",
  "perplexity",
  "firecrawl",
]);

/**
 * Build an onPayload patch attaching OpenRouter's openrouter:web_search
 * server tool to a search-stage request. Returns undefined when the feature
 * is disabled, the provider is not OpenRouter (the tool id is
 * OpenRouter-specific), or the request already carries tools (never the
 * case for our search calls, which pass no Context tools, but defensive).
 *
 * Per-call `domains` (the tool's optional domains parameter) merge with
 * settings-level allowedDomains; per-call entries win on collision. Unknown
 * engine strings and out-of-range maxResults are dropped/clamped rather than
 * sent, so a typo degrades to OpenRouter defaults instead of a 400.
 */
export function buildSearchPayloadPatch(
  settings: DeepReadonly<ResearchSettings>,
  provider: string,
  domains?: string[],
): ((payload: Record<string, unknown>) => Record<string, unknown>) | undefined {
  const ws = settings.searchWebSearch;
  if (!ws?.enabled || provider !== "openrouter") return undefined;

  const parameters: Record<string, unknown> = {};
  if (ws.engine && ws.engine !== "auto" && WEB_SEARCH_ENGINES.has(ws.engine)) {
    parameters.engine = ws.engine;
  }
  if (typeof ws.maxResults === "number" && Number.isFinite(ws.maxResults)) {
    parameters.max_results = Math.min(25, Math.max(1, Math.round(ws.maxResults)));
  }
  if (ws.searchContextSize) parameters.search_context_size = ws.searchContextSize;
  const allowed = [...(ws.allowedDomains ?? []), ...(domains ?? [])].filter(
    (d, i, arr) => arr.indexOf(d) === i,
  );
  if (allowed.length > 0) parameters.allowed_domains = allowed;
  if (ws.excludedDomains?.length) parameters.excluded_domains = [...ws.excludedDomains];

  const serverTool = { type: "openrouter:web_search", parameters };
  return (payload) => {
    if (payload.tools) return payload; // never clobber an existing tools array
    return { ...payload, tools: [serverTool] };
  };
}

/**
 * Build the user message for a per-page extraction call. Content is
 * truncated to `maxChars` (unified marker) before wrapping.
 */
export function buildExtractionMessage(
  content: string,
  query: string,
  focusPrompt: string | undefined,
  maxChars: number,
): string {
  let msg = `Web page content:\n---\n${truncateContent(content, maxChars)}\n---\n\n`;
  msg += `Extract information relevant to: ${query}\n`;
  if (focusPrompt) {
    msg += `\nFocus: ${focusPrompt}\n`;
  }
  return msg;
}

export const COLLATION_NO_EVIDENCE_MESSAGE =
  "Collation input budget left no non-empty evidence text; increase collationInputBudgetTokens or collationSourceMaxTokens, or request fewer URLs.";

export const MANUAL_COLLATION_NO_EVIDENCE_MESSAGE =
  "Collation input budget left no non-empty evidence text; raise collationInputBudgetTokens (or collationSourceMaxTokens when sources were cut to the per-source limit), or send fewer sources.";

export interface CollationInputBudgetDetails {
  budgetTokens: number;
  sources: number;
  trimmed: number;
  dropped: number;
  charsBefore: number;
  charsAfter: number;
}

export class CollationNoEvidenceError extends Error {
  constructor(
    message: string,
    readonly inputBudget: CollationInputBudgetDetails,
  ) {
    super(message);
    this.name = "CollationNoEvidenceError";
  }
}

/**
 * A collation that failed after its input was trimmed. The message is the
 * underlying failure's; the trim travels with it so the failure report and
 * telemetry can say what the model was not sent.
 */
export class CollationTrimmedInputError extends Error {
  constructor(
    message: string,
    readonly inputBudget: CollationInputBudgetDetails,
    readonly trimNotice: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "CollationTrimmedInputError";
  }
}

/** Delivery metrics from the same non-empty evidence used by the prompt.
 *  Whitespace-only retained prefixes count as dropped, not delivered text. */
export function deliveredInputBudget(
  plan: CollationBudgetPlan,
  evidence: readonly ExtractResult[],
): CollationInputBudgetDetails {
  const delivered = evidenceExtractions(evidence);
  const deliveredUrls = new Set(delivered.map((source) => source.url));
  return {
    budgetTokens: plan.budgetTokens,
    sources: plan.sources.length,
    trimmed: plan.trims.filter((trim) => trim.action === "trimmed" && deliveredUrls.has(trim.url)).length,
    dropped: plan.trims.filter((trim) => trim.action === "dropped" || !deliveredUrls.has(trim.url)).length,
    charsBefore: plan.charsBefore,
    charsAfter: delivered.reduce((sum, source) => sum + source.extraction.length, 0),
  };
}

/**
 * Give synthesis only the supplied evidence, not the search model's claims or
 * cache paths. Legacy arguments remain accepted by this shared helper, but do
 * not cross the evidence boundary. Provenance is rendered after validation.
 */
export function buildCollationMessage(
  query: string,
  _cachePath: string,
  _searchSummary: string | undefined,
  succeededExtractions: ExtractResult[],
  _identity?: SourceIdentity,
): string {
  return JSON.stringify({
    query,
    sources: evidenceExtractions(succeededExtractions).map((source, index) =>
      collationSourceEntry(source, source.sourceNumber ?? index + 1),
    ),
  }, null, 2);
}

/** One source as the collation request carries it. */
function collationSourceEntry(source: ExtractResult, sourceNumber: number): object {
  return {
    id: `S${sourceNumber}`,
    url: source.url,
    title: source.title,
    type: source.sourceType,
    extraction: source.extraction,
    ...(source.inferred ? { inferredFromText: true } : {}),
    ...(source.finalUrl ? { finalUrl: source.finalUrl } : {}),
  };
}

/**
 * Characters a source's entry adds to the collation request besides its
 * extraction text: keys, URL, title, type and the indentation of its nesting
 * level, so the input budget charges long metadata in full.
 */
export function collationSourceOverheadChars(source: ExtractResult, sourceNumber: number): number {
  const entry = JSON.stringify({ ...collationSourceEntry(source, sourceNumber), extraction: "" }, null, 2);
  // The entry sits four spaces deeper in the request and is followed by ",\n".
  return entry.length + 4 * entry.split("\n").length + 2;
}

/**
 * Render what the collation model did not receive, and where the full
 * extraction is saved. Appended to the synthesis in both the tool result and
 * report.md, so the calling agent can read the untrimmed file when the
 * trimmed text it saw is not enough. Nothing on disk is changed: the saved
 * extraction always holds the whole text.
 */
export function formatCollationTrimNotice(
  plan: CollationBudgetPlan,
  identity: SourceIdentity,
  cachePath: string,
  deliveredChars = plan.charsAfter,
  operation: "research" | "collate" = "research",
): string {
  const isEmpty = (trim: CollationBudgetTrim): boolean =>
    trim.action !== "dropped" && !(plan.sources.find((source) => source.url === trim.url)?.text.trim());
  const empty = plan.trims.filter(isEmpty);
  const isTrimmed = (trim: CollationBudgetTrim): boolean =>
    trim.action === "trimmed" && !isEmpty(trim);
  const sourceCapped = plan.trims.filter((t) => t.sourceCap);
  const displaySourceCapped = sourceCapped.filter(isTrimmed);
  const sourceOnly = displaySourceCapped.filter((t) => !t.budget);
  const both = displaySourceCapped.filter((t) => t.budget);
  const budgetApplied = plan.trims.some((t) => t.budget);
  const budgetTrimmed = plan.trims.filter((t) => t.budget && !t.sourceCap && isTrimmed(t));
  const dropped = plan.trims.filter((t) => t.action === "dropped");
  const chars = (n: number): string => `${n} characters`;
  let out = `\n\n---\n`;
  out += `**Collation input trimmed**: ${plan.trims.length} of ${plan.sources.length} extraction(s) reduced.\n`;
  out += operation === "collate"
    ? "The omitted text is in the extraction files below, saved in full from the supplied extractions. Read them for the missing detail; repeating collation will not recover it.\n"
    : "The omitted text is in the extraction files below. Read them for the missing detail; re-running research will not recover it.\n";
  if (sourceCapped.length > 0) {
    out += `${sourceCapped.length} exceeded the ${plan.sourceMaxTokens}-token per-source limit (collationSourceMaxTokens). `;
  }
  if (budgetApplied) {
    out += `The run's total exceeded the ${plan.budgetTokens}-token input budget (collationInputBudgetTokens), including source headers. `;
  }
  out += `The model received ${chars(deliveredChars)} of ${chars(plan.charsBefore)}.\n`;
  const line = (trim: CollationBudgetTrim): string => {
    const file = identity.extractionFileFor(trim.url);
    const full = file ? ` (full extraction: \`${cachePath}/extractions/${file}\`)` : "";
    const retained = plan.sources.find((source) => source.url === trim.url);
    if (trim.action === "dropped") return `- ${trim.url}: left out entirely${full}\n`;
    if (!retained?.text.trim()) {
      return `- ${trim.url}: left out because the retained text is empty${full}\n`;
    }
    return `- ${trim.url}: ${chars(trim.keptChars)} of ${chars(trim.originalChars)} sent${full}\n`;
  };
  if (sourceOnly.length > 0) {
    out += `\nTrimmed to the per-source limit (${sourceOnly.length}):\n`;
    for (const trim of sourceOnly) out += line(trim);
  }
  if (both.length > 0) {
    out += `\nTrimmed by both limits (${both.length}):\n`;
    for (const trim of both) out += line(trim);
  }
  if (budgetTrimmed.length > 0) {
    out += `\nTrimmed to a fair share of the input budget (${budgetTrimmed.length}):\n`;
    for (const trim of budgetTrimmed) out += line(trim);
  }
  if (empty.length > 0) {
    out += `\nLeft out with empty retained text (${empty.length}):\n`;
    for (const trim of empty) out += line(trim);
  }
  if (dropped.length > 0) {
    out += `\nLeft out to fit the input budget (${dropped.length}):\n`;
    for (const trim of dropped) out += line(trim);
  }
  if (budgetApplied) {
    out += `\nTrim order: the longest extractions first, inferred references before cited sources, down to a fair share `;
    out += `of the input budget; whole sources are left out only when a fair share would keep too little to be useful, lowest-ranked first, inferred references before cited sources.\n`;
  }
  // Only offer a lever that can still move, and only the one that bound.
  const advice: string[] = [];
  if (sourceCapped.length > 0) {
    advice.push(
      plan.sourceMaxTokens >= MAX_OUTPUT_TOKENS
        ? `collationSourceMaxTokens is already at the ${MAX_OUTPUT_TOKENS}-token maximum the settings accept.`
        : `To send more next time, raise collationSourceMaxTokens.`,
    );
  }
  if (budgetApplied) {
    advice.push(
      plan.budgetTokens >= TUNING_RANGES.collationInputBudgetTokens[1]
        ? `collationInputBudgetTokens is already at the ${TUNING_RANGES.collationInputBudgetTokens[1]}-token maximum the settings accept, so ask for fewer URLs to send more.`
        : `To send more next time, raise collationInputBudgetTokens if the collation model's context allows, or ask for fewer URLs.`,
    );
  }
  if (advice.length > 0) out += `**Configuration**: ${advice.join(" ")}\n`;
  return out;
}

/** A failed source rendered in the result appendix: the URL, a bounded
 *  reason when known, and the saved full-page file when one exists. */
export interface FailedSourceEntry {
  url: string;
  error?: string;
  sourceFile?: string;
}

/**
 * Build the result appendix pointing at the cache directory and report.
 * Appended after the collation text in both intelli_research and
 * intelli_collate results. Failed entries name the URL, the bounded failure
 * reason when known, and the saved full-page path, so a calling agent can
 * recover an already-fetched page instead of treating it as lost.
 */
export function formatCacheAppendix(
  cachePath: string,
  succeeded: number,
  failed: number,
  failedEntries: readonly FailedSourceEntry[] = [],
  truncatedCount = 0,
): string {
  let out = `\n\n---\n`;
  out += `**Cache**: \`${cachePath}/\`\n`;
  out += `**Report**: \`${cachePath}/report.md\`\n`;
  out += `**Sources**: ${succeeded} succeeded${truncatedCount > 0 ? ` (${truncatedCount} truncated at the output cap)` : ""}, ${failed} failed\n`;
  out += `\n- Read the report: \`read ${cachePath}/report.md\`\n`;
  if (failedEntries.length > 0) {
    // Bold label and placement after the instruction bullet keep the failure
    // list from visually swallowing the next line a reader scans for.
    out += `\n**Failed Sources**:\n`;
    for (const entry of failedEntries) {
      out += `- ${entry.url}`;
      if (entry.error) out += `: ${entry.error}`;
      if (entry.sourceFile) out += ` (full page saved: \`${cachePath}/${entry.sourceFile}\`)`;
      out += `\n`;
    }
  }
  // With no successful extraction there is no extraction file to choose:
  // name only full-page paths, from the Failed Sources list just above.
  // Completed output keeps the pre-track sentence verbatim.
  out +=
    succeeded > 0
      ? `\nChoose exact extraction and full-page paths from the Source Assessment above. Not cached means no full-page file exists for that source.\n`
      : `\nChoose exact full-page paths from the **Failed Sources** list above. Not cached means no full-page file exists for that source.\n`;
  return out;
}
