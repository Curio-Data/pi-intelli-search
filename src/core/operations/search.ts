// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type { SearchResult } from "../types.js";
import { SEARCH_SYSTEM_PROMPT } from "../prompts.js";
import type { SearchParams } from "../contracts.js";
import { mergeCitations } from "../annotations.js";
import { alignCitationMarkers } from "../citation-markers.js";
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

    // The model numbers its [n] markers against its own citation list; the
    // Sources block below is the merged, deduplicated, capped list, whose
    // order differs whenever prose links precede annotation-only URLs. Align
    // every marker to the entry it will actually sit beside, and neutralise
    // markers whose referent the cap removed (citation-markers.ts).
    const aligned = alignCitationMarkers(responseText, citations, sources);
    // Alignment runs on the full text (the trailing section can be the
    // numbering base for models without annotations); the section itself is
    // then dropped exactly as before.
    const summary = stripTrailingSourcesSection(aligned.text);

    const result: SearchResult = {
      summary,
      sources,
      query: params.query,
      timestamp: new Date().toISOString(),
    };

    return {
      text: formatSearchResult(result, aligned),
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
  aligned?: { removed: number; retitled: number },
): string {
  let output = `## Search results for: "${result.query}"\n\n`;
  output += result.summary + "\n\n";
  output += `### Sources (${result.sources.length})\n\n`;
  for (const [i, source] of result.sources.entries()) {
    const inferred = source.inferred
      ? ` (inferred from text, not a citation${source.originalReference ? `; original token: ${source.originalReference}` : ""})`
      : "";
    output += `${i + 1}. [${source.title || source.url}](${source.url})${inferred}\n`;
  }
  if (aligned && aligned.removed > 0) {
    output +=
      `\n> Note: ${aligned.removed} citation marker${aligned.removed === 1 ? "" : "s"} in the answer ` +
      `referred to source${aligned.removed === 1 ? "" : "s"} outside the list above and ` +
      `${aligned.removed === 1 ? "was" : "were"} removed.\n`;
  }
  return output;
}
