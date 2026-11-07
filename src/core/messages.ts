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
    sources: evidenceExtractions(succeededExtractions).map((source, index) => ({
      id: `S${index + 1}`,
      url: source.url,
      title: source.title,
      type: source.sourceType,
      extraction: source.extraction,
      ...(source.inferred ? { inferredFromText: true } : {}),
      ...(source.finalUrl ? { finalUrl: source.finalUrl } : {}),
    })),
  }, null, 2);
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
): string {
  const sourceCapped = plan.trims.filter((t) => t.sourceCap);
  const sourceOnly = sourceCapped.filter((t) => !t.budget);
  const both = sourceCapped.filter((t) => t.budget);
  const budgetApplied = plan.trims.some((t) => t.budget);
  const budgetTrimmed = plan.trims.filter((t) => t.budget && !t.sourceCap && t.action === "trimmed");
  const dropped = plan.trims.filter((t) => !t.sourceCap && t.action === "dropped");
  const chars = (n: number): string => `${n} characters`;
  let out = `\n\n---\n`;
  out += `**Collation input trimmed**: ${plan.trims.length} of ${plan.sources.length} extraction(s) reduced. `;
  if (sourceCapped.length > 0) {
    out += `${sourceCapped.length} exceeded the ${plan.sourceMaxTokens}-token per-source limit (collationSourceMaxTokens). `;
  }
  if (budgetApplied) {
    out += `The run's total exceeded the ${plan.budgetTokens}-token input budget (collationInputBudgetTokens), including source headers. `;
  }
  out += `The model received ${chars(plan.charsAfter)} of ${chars(plan.charsBefore)}. `;
  out += `Every extraction is saved in full, and nothing here changes what is on disk.\n`;
  const line = (trim: CollationBudgetTrim): string => {
    const file = identity.extractionFileFor(trim.url);
    const full = file ? ` (full extraction: \`extractions/${file}\`)` : "";
    return trim.action === "dropped"
      ? `- ${trim.url}: left out entirely${full}\n`
      : `- ${trim.url}: ${chars(trim.keptChars)} of ${chars(trim.originalChars)} sent${full}\n`;
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
  if (dropped.length > 0) {
    out += `\nLeft out to fit the input budget (${dropped.length}):\n`;
    for (const trim of dropped) out += line(trim);
  }
  if (budgetApplied) {
    out += `\nTrim order: the longest extractions first, inferred references before cited sources, down to a fair share `;
    out += `of the input budget; whole sources are left out only when a fair share would keep too little to be useful, lowest-ranked first.\n`;
  }
  // Only offer a lever that can still move, and only the one that bound.
  const advice: string[] = [];
  if (sourceCapped.length > 0) {
    advice.push(
      plan.sourceMaxTokens >= MAX_OUTPUT_TOKENS
        ? `collationSourceMaxTokens is already at the ${MAX_OUTPUT_TOKENS}-token maximum the settings accept.`
        : `Raise collationSourceMaxTokens to send more of one page.`,
    );
  }
  if (budgetApplied) {
    advice.push(
      plan.budgetTokens >= TUNING_RANGES.collationInputBudgetTokens[1]
        ? `collationInputBudgetTokens is already at the ${TUNING_RANGES.collationInputBudgetTokens[1]}-token maximum the settings accept, so ask for fewer URLs to send more.`
        : `Raise collationInputBudgetTokens if the collation model's context allows, or ask for fewer URLs, to send more overall.`,
    );
  }
  if (advice.length > 0) out += `${advice.join(" ")}\n`;
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
