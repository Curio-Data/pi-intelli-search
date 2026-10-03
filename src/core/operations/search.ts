// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type { SearchResult } from "../types.js";
import { SEARCH_SYSTEM_PROMPT } from "../prompts.js";
import type { SearchParams } from "../contracts.js";
import { mergeCitations } from "../annotations.js";
import { extractSourceUrls, stripTrailingSourcesSection, throwIfAborted } from "../util.js";
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
    const { text: responseText, citations } = await models.complete({
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
    // prompt requests is link-dense), then cap the list at defaultUrls:
    // annotation harvesting can surface 20+ cited sources, and an
    // unbounded list would flood the agent context. The summary handed
    // downstream drops the model's own Sources section; the tool renders
    // its own canonical block from this list.
    const sources = mergeCitations(extractSourceUrls(responseText), { citations }).slice(
      0,
      Math.max(1, settings.defaultUrls),
    );

    const result: SearchResult = {
      summary: stripTrailingSourcesSection(responseText),
      sources,
      query: params.query,
      timestamp: new Date().toISOString(),
    };

    return {
      text: formatSearchResult(result),
      outcome: "completed",
      details: { sources, query: params.query },
    };
  } catch (err: any) {
    throwIfAborted(signal);
    throw new Error(`Search failed: ${err?.message ?? String(err)}`);
  }
}

function formatSearchResult(result: SearchResult): string {
  let output = `## Search results for: "${result.query}"\n\n`;
  output += result.summary + "\n\n";
  output += `### Sources (${result.sources.length})\n\n`;
  for (const [i, source] of result.sources.entries()) {
    output += `${i + 1}. [${source.title || source.url}](${source.url})\n`;
  }
  return output;
}
