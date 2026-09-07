// src/tools/shared.ts — Message/appendix builders shared by the intelli_* tools.
//
// Extracted from intelli-search, intelli-extract, intelli-collate, and
// intelli-research, which built these strings independently with small
// drift (three different truncation markers, "failed" vs "blocked" source
// counts). One builder per artefact; each is pure and unit-tested in
// test/shared.test.ts.
//
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
// SPDX-License-Identifier: Apache-2.0
import { sourceFilename } from "../cache.js";
import { truncateContent } from "../util.js";
import type { ExtractResult, ResearchSettings } from "../types.js";

/**
 * Append a `site:` filter to a search query. Returns the query unchanged
 * when no domains are given.
 */
export function appendDomainFilter(query: string, domains?: string[]): string {
  if (!domains?.length) return query;
  return query + " site:" + domains.join(" OR site:");
}

const WEB_SEARCH_ENGINES = new Set(["auto", "native", "exa", "parallel", "perplexity", "firecrawl"]);

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
  settings: ResearchSettings,
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
 * Build the user message for the collation call. Includes the search summary
 * when present and one block per succeeded extraction with cache file
 * references the collation model can cite.
 */
export function buildCollationMessage(
  query: string,
  cachePath: string,
  searchSummary: string | undefined,
  succeededExtractions: ExtractResult[],
): string {
  let msg = `Original query: ${query}\n`;
  msg += `Cache path: ${cachePath}/\n\n`;
  if (searchSummary) {
    msg += `Search summary (from the search model):\n${searchSummary}\n\n`;
  }
  for (const [i, ext] of succeededExtractions.entries()) {
    const filename = sourceFilename(i, ext.url);
    msg += `--- Source ${i + 1}: ${ext.url} ---\n`;
    msg += `Title: ${ext.title}\n`;
    msg += `Type: ${ext.sourceType}\n`;
    msg += `Extraction file: ${cachePath}/extractions/${filename}\n`;
    msg += `Full page file: ${cachePath}/sources/${filename}\n`;
    msg += `\n${ext.extraction}\n\n`;
  }
  return msg;
}

/**
 * Build the result appendix pointing at the cache directory and report.
 * Appended after the collation text in both intelli_research and
 * intelli_collate results.
 */
export function formatCacheAppendix(cachePath: string, succeeded: number, failed: number): string {
  let out = `\n\n---\n`;
  out += `**Cache**: \`${cachePath}/\`\n`;
  out += `**Report**: \`${cachePath}/report.md\`\n`;
  out += `**Sources**: ${succeeded} succeeded, ${failed} failed\n`;
  out += `\nTo explore a specific source:\n`;
  out += `- Read the extraction: \`read ${cachePath}/extractions/01-*.md\`\n`;
  out += `- Read the full page: \`read ${cachePath}/sources/01-*.md\`\n`;
  return out;
}
