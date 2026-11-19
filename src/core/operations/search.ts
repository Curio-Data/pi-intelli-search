// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type { SearchResult } from "../types.js";
import { SEARCH_SYSTEM_PROMPT } from "../prompts.js";
import type { SearchParams } from "../contracts.js";
import { mergeCitations } from "../annotations.js";
import { numberSources } from "../citation-numbering.js";
import { extractSourceUrls, safeLinkLabel, stripTrailingSourcesSection, throwIfAborted } from "../util.js";
import { appendDomainFilter, buildSearchPayloadPatch } from "../messages.js";
import type { OperationContext, OperationResult } from "../contracts.js";

export async function search(
  params: SearchParams,
  context: OperationContext,
): Promise<OperationResult> {
  const { settings, models, signal } = context;
  throwIfAborted(signal);
  const searchConfig = settings.searchModel;

  const searchQuery = appendDomainFilter(params.query, params.domains);

  // Side channel for url_citation annotations (see annotations.ts): merged
  // with text-scraped links so search-grounded models contribute every source
  // they actually consulted, not just the ones written into the prose.
  // Optional OpenRouter web search server tool (settings: searchWebSearch).
  const payloadPatch = buildSearchPayloadPatch(settings, searchConfig.provider, params.domains);

  try {
    const { text: responseText, citations, citationOrder } = await models.complete({
      model: searchConfig,
      systemPrompt: SEARCH_SYSTEM_PROMPT,
      userMessage: searchQuery,
      maxTokens: 2000,
      signal,
      collectCitations: true,
      payloadPatch,
      reasoning: payloadPatch ? (settings.searchWebSearch.reasoning ?? "low") : undefined,
    });

    throwIfAborted(signal);
    // Extract URLs from the FULL text (the trailing Sources section the
    // prompt requests is link-dense), then number the display list so a bare
    // marker [k] in the answer and entry k name the same source: the answer
    // text itself is never rewritten (citation-numbering.ts). The summary
    // handed downstream drops the model's own Sources section; the tool
    // renders its own canonical block from the numbered list.
    const merged = mergeCitations(extractSourceUrls(responseText), { citations });
    const numbering = numberSources(
      responseText,
      merged,
      citations,
      citationOrder,
      Math.max(1, settings.defaultUrls),
    );
    const sources = numbering.entries;

    const result: SearchResult = {
      summary: stripTrailingSourcesSection(responseText),
      sources,
      query: params.query,
      timestamp: new Date().toISOString(),
    };

    return {
      text: formatSearchResult(result, numbering.unmatchedMarkers, numbering.numberingIncomplete),
      outcome: "completed",
      details: { sources, query: params.query },
    };
  } catch (err: any) {
    throwIfAborted(signal);
    throw new Error(`Search failed: ${err?.message ?? String(err)}`);
  }
}

function formatSearchResult(
  result: SearchResult,
  unmatchedMarkers = 0,
  numberingIncomplete = false,
): string {
  let output = `## Search results for: "${result.query}"\n\n`;
  output += result.summary + "\n\n";
  output += `### Sources (${result.sources.length})\n\n`;
  for (const source of result.sources) {
    const inferred = source.inferred
      ? ` (inferred from text, not a citation${source.originalReference ? `; original token: ${source.originalReference}` : ""})`
      : "";
    const repeats = source.repeats !== undefined ? ` (same source as entry ${source.repeats})` : "";
    // Provider titles are untrusted page text: sanitise anything embedded as
    // link text so a title cannot close the entry's link and open another.
    const label = source.title ? safeLinkLabel(source.title, source.url) : source.url;
    output += `${source.number}. [${label}](${source.url})${repeats}${inferred}\n`;
  }
  if (unmatchedMarkers > 0) {
    // The count is of distinct cited numbers, not marker tokens.
    output +=
      `\n> Note: ${unmatchedMarkers} cited number${unmatchedMarkers === 1 ? "" : "s"} in the answer ` +
      `${unmatchedMarkers === 1 ? "has" : "have"} no entry in the list above.\n`;
  }
  if (numberingIncomplete) {
    output +=
      "\n> Note: the answer's citation markers could not be matched to numbered sources, so they may not match the list.\n";
  }
  return output;
}
