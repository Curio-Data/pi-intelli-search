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
import type { ExtractResult } from "../types.js";

/**
 * Append a `site:` filter to a search query. Returns the query unchanged
 * when no domains are given.
 */
export function appendDomainFilter(query: string, domains?: string[]): string {
  if (!domains?.length) return query;
  return query + " site:" + domains.join(" OR site:");
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
    msg += `Search summary (from Sonar):\n${searchSummary}\n\n`;
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
