// src/tools/intelli-search.ts — intelli_search tool
//
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
// SPDX-License-Identifier: Apache-2.0
import { Type } from "typebox";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SearchResult, OnUpdate } from "../types.js";
import { SEARCH_SYSTEM_PROMPT } from "../prompts.js";
import { callLlm } from "../llm.js";
import { createAnnotationSink, mergeCitations } from "../annotations.js";
import { textContent, extractSourceUrls } from "../util.js";
import { loadSettings, resolveModelConfig } from "../settings.js";
import { appendDomainFilter, buildSearchPayloadPatch } from "./shared.js";

export const intelliSearchTool = {
  name: "intelli_search",
  label: "Intelli Search",
  description:
    "Search the web and return a concise answer with source URLs. " +
    "For multi-page deep research, use intelli_research instead.",
  promptSnippet:
    "intelli_search(query): search the web and return synthesised results with source URLs",
  parameters: Type.Object({
    query: Type.String({ description: "Search query" }),
    domains: Type.Optional(Type.Array(Type.String(), { description: "Restrict to these domains" })),
  }),

  async execute(
    _toolCallId: string,
    params: { query: string; domains?: string[] },
    signal: AbortSignal | undefined,
    _onUpdate: OnUpdate | undefined,
    ctx: ExtensionContext,
  ) {
    const settings = await loadSettings({
      cwd: ctx.cwd,
      projectTrusted: ctx.isProjectTrusted(),
    });
    const searchConfig = resolveModelConfig(settings, "search");

    const searchQuery = appendDomainFilter(params.query, params.domains);

    // Side channel for url_citation annotations (see annotations.ts): merged
    // with text-scraped links so search-grounded models contribute every source
    // they actually consulted, not just the ones written into the prose.
    const annotationSink = createAnnotationSink();
    // Optional OpenRouter web search server tool (settings: searchWebSearch).
    const payloadPatch = buildSearchPayloadPatch(settings, searchConfig.provider, params.domains);

    try {
      const responseText = await callLlm(ctx, searchConfig, SEARCH_SYSTEM_PROMPT, searchQuery, {
        maxTokens: 2000,
        signal,
        annotations: annotationSink,
        payloadPatch,
        reasoning: payloadPatch ? (settings.searchWebSearch.reasoning ?? "low") : undefined,
      });

      const sources = mergeCitations(extractSourceUrls(responseText), annotationSink);

      const result: SearchResult = {
        summary: responseText,
        sources,
        query: params.query,
        timestamp: new Date().toISOString(),
      };

      return {
        content: [textContent(formatSearchResult(result))],
        details: { sources, query: params.query },
      };
    } catch (err: any) {
      throw new Error(`Search failed: ${err?.message ?? String(err)}`);
    }
  },
};

function formatSearchResult(result: SearchResult): string {
  let output = `## Search results for: "${result.query}"\n\n`;
  output += result.summary + "\n\n";
  output += `### Sources (${result.sources.length})\n\n`;
  for (const [i, source] of result.sources.entries()) {
    output += `${i + 1}. [${source.title || source.url}](${source.url})\n`;
  }
  return output;
}
