// src/tools/web-search.ts — web_search tool
import { Type } from "@sinclair/typebox";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { ModelConfig, SearchResult } from "../types.js";
import { callLlm } from "../llm.js";
import { textContent } from "../util.js";

const SEARCH_SYSTEM_PROMPT =
  "You are a web search assistant. Answer the query with cited sources. " +
  "Always include source URLs in markdown link format: [title](url). " +
  "Include as many relevant source URLs as possible.";

export const webSearchTool = {
  name: "web_search",
  label: "Web Search",
  description:
    "Search the web using Perplexity Sonar. Returns a synthesised summary with source URLs. " +
    "For a complete research pipeline, use web_research instead.",
  promptSnippet: "web_search(query): search the web and return synthesised results with source URLs",
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
    const { loadSettings, resolveModelConfig } = await import("../settings.js");
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

function extractSourceUrls(text: string): Array<{ url: string; title: string }> {
  const urls: Array<{ url: string; title: string }> = [];
  const linkPattern = /\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
  let match;
  while ((match = linkPattern.exec(text)) !== null) {
    const url = match[2];
    if (!urls.some((u) => u.url === url)) {
      urls.push({ url, title: match[1] });
    }
  }
  return urls;
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
