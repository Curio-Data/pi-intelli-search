// src/tools/intelli-search.ts — intelli_search tool
//
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
// SPDX-License-Identifier: Apache-2.0
import { Type } from "typebox";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { SearchResult } from "../types.js";
import { SEARCH_SYSTEM_PROMPT } from "../prompts.js";
import { callLlm } from "../llm.js";
import { textContent, extractSourceUrls } from "../util.js";
import { loadSettings, resolveModelConfig } from "../settings.js";

export const intelliSearchTool = {
  name: "intelli_search",
  label: "Intelli Search",
  description:
    "Search the web using Perplexity Sonar. Returns a synthesised summary with source URLs. " +
    "For a complete research pipeline, use intelli_research instead.",
  promptSnippet: "intelli_search(query): search the web and return synthesised results with source URLs",
  parameters: Type.Object({
    query: Type.String({ description: "Search query" }),
    domains: Type.Optional(Type.Array(Type.String(), { description: "Restrict to these domains" })),
  }),

  async execute(
    _toolCallId: string,
    params: { query: string; domains?: string[] },
    signal: AbortSignal | undefined,
    _onUpdate: any,
    ctx: ExtensionContext,
  ) {
    const settings = await loadSettings(ctx.cwd);
    const searchConfig = resolveModelConfig(settings, "search");

    let searchQuery = params.query;
    if (params.domains?.length) {
      searchQuery += " site:" + params.domains.join(" OR site:");
    }

    try {
      const responseText = await callLlm(ctx, searchConfig, SEARCH_SYSTEM_PROMPT, searchQuery, {
        maxTokens: 2000,
        signal,
      });

      const sources = extractSourceUrls(responseText);

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
