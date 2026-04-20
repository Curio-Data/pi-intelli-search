// src/tools/web-research.ts — web_research orchestrator tool
import { Type } from "@sinclair/typebox";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { EXTRACTION_SYSTEM_PROMPT, COLLATION_SYSTEM_PROMPT } from "../prompts.js";
import { callLlm } from "../llm.js";
import { fetchPages, downloadLlmsFullToCache } from "../fetch.js";
import { makeCachePath, domainSlug, writeCacheFiles, writeReportFile } from "../cache.js";
import { textContent } from "../util.js";
import type { FetchedPage, ExtractResult } from "../types.js";

const SEARCH_SYSTEM_PROMPT =
  "You are a web search assistant. Answer the query with cited sources. " +
  "Always include source URLs in markdown link format: [title](url). " +
  "Include as many relevant source URLs as possible.";

export const webResearchTool = {
  name: "web_research",
  label: "Web Research",
  description:
    "Full research pipeline: search the web, fetch top results, extract " +
    "query-relevant content from each page, collate and deduplicate findings, " +
    "and cache everything for follow-up. Returns a concise summary.",
  promptSnippet: "web_research(query): full search → fetch → extract → collate pipeline with caching",
  promptGuidelines: [
    "Use web_research when the user needs current web information (docs, APIs, best practices, library updates). For quick factual questions, use web_search alone.",
    "Use maxUrls to control breadth: 3 for targeted, 8 (default) for broad, 12 for exhaustive.",
    "Always provide focusPrompt to guide extraction. Without it the LLM extracts generically. Translate the user's intent into a specific extraction focus.",
    "The tool result contains a concise summary — use it directly. Only read .search/ cache files when the summary is insufficient.",
  ],
  parameters: Type.Object({
    query: Type.String({ description: "What to research" }),
    maxUrls: Type.Optional(Type.Number({ description: "Max URLs to fetch (default: from settings, typically 8)" })),
    domains: Type.Optional(Type.Array(Type.String(), { description: "Restrict search to these domains" })),
    focusPrompt: Type.Optional(Type.String({ description: "Focus guidance for all extractions" })),
  }),

  async execute(
    _toolCallId: string,
    params: {
      query: string;
      maxUrls?: number;
      domains?: string[];
      focusPrompt?: string;
    },
    signal: AbortSignal | undefined,
    onUpdate: any,
    ctx: ExtensionContext,
  ) {
    const { loadSettings, resolveModelConfig } = await import("../settings.js");
    const settings = await loadSettings(ctx.cwd);

    const maxUrls = params.maxUrls ?? settings.maxUrls;
    const searchConfig = resolveModelConfig(settings, "search");
    const extractConfig = resolveModelConfig(settings, "extract");
    const collateConfig = resolveModelConfig(settings, "collate");

    // ═══════════════════════════════════════════
    // Stage 1: Search via Sonar
    // ═══════════════════════════════════════════
    onUpdate?.(progressUpdate("Searching...", 0.1));

    let searchQuery = params.query;
    if (params.domains?.length) {
      searchQuery += " site:" + params.domains.join(" OR site:");
    }

    const searchResult = await callLlm(ctx, searchConfig, SEARCH_SYSTEM_PROMPT, searchQuery, {
      maxTokens: 2000,
      signal,
    });

    const urls = extractSourceUrls(searchResult).slice(0, maxUrls);

    if (urls.length === 0) {
      return {
        content: [textContent(`No URLs found for query: "${params.query}"\n\nSearch summary:\n${searchResult}`)],
        details: { cachePath: "", urlsSearched: 0, pagesFetched: 0, pagesFailed: 0 } as Record<string, unknown>,
      };
    }

    // ═══════════════════════════════════════════
    // Stage 2: Fetch pages via wreq-js + Defuddle
    // ═══════════════════════════════════════════
    onUpdate?.(progressUpdate(`Fetching ${urls.length} pages...`, 0.2));
    const pages = await fetchPages(urls.map((u) => u.url), signal);
    const successPages = pages.filter((p) => p.status === "success");

    if (successPages.length === 0) {
      return {
        content: [textContent(
          `All ${urls.length} pages failed to fetch.\n\nSearch summary:\n${searchResult}`,
        )],
        details: { cachePath: "", urlsSearched: urls.length, pagesFetched: 0, pagesFailed: urls.length } as Record<string, unknown>,
      };
    }

    // ═══════════════════════════════════════════
    // Stage 3: Extract per-page via LLM (parallel)
    // ═══════════════════════════════════════════
    onUpdate?.(progressUpdate(`Extracting from ${successPages.length} pages...`, 0.4));

    const extractions: ExtractResult[] = await Promise.all(
      successPages.map(async (page, i) => {
        onUpdate?.(progressUpdate(
          `Extracting ${i + 1}/${successPages.length}: ${(page.title || page.url).slice(0, 40)}...`,
          0.4 + (i / successPages.length) * 0.3,
        ));

        return extractPage(ctx, extractConfig, page, params.query, params.focusPrompt, settings.extractMaxChars, signal);
      }),
    );

    // Include failed pages as blocked extractions
    const blockedExtractions: ExtractResult[] = pages
      .filter((p) => p.status !== "success")
      .map((p) => ({
        url: p.url,
        title: "",
        extraction: "",
        sourceType: "unknown",
        currentness: "unknown",
        status: "blocked" as const,
      }));

    // ═══════════════════════════════════════════
    // Stage 4: Collate via LLM + write cache
    // ═══════════════════════════════════════════
    onUpdate?.(progressUpdate("Collating findings...", 0.85));

    const cachePath = makeCachePath(params.query, ctx.cwd, settings.cacheDir);
    const allExtractions = [...extractions, ...blockedExtractions];

    // Write cache
    await writeCacheFiles(cachePath, allExtractions, successPages, searchResult, params.query);

    // Build collation message
    const succeededExtractions = allExtractions.filter((e) => e.status === "success");
    let collationUserMsg = `Original query: ${params.query}\n`;
    collationUserMsg += `Cache path: ${cachePath}/\n\n`;
    collationUserMsg += `Search summary (from Sonar):\n${searchResult}\n\n`;

    for (const [i, ext] of succeededExtractions.entries()) {
      const filename = `${String(i + 1).padStart(2, "0")}-${domainSlug(ext.url)}.md`;
      collationUserMsg += `--- Source ${i + 1}: ${ext.url} ---\n`;
      collationUserMsg += `Title: ${ext.title}\n`;
      collationUserMsg += `Type: ${ext.sourceType}\n`;
      collationUserMsg += `Extraction file: ${cachePath}/extractions/${filename}\n`;
      collationUserMsg += `Full page file: ${cachePath}/sources/${filename}\n`;
      collationUserMsg += `\n${ext.extraction}\n\n`;
    }

    const collation = await callLlm(ctx, collateConfig, COLLATION_SYSTEM_PROMPT, collationUserMsg, {
      maxTokens: 4000,
      signal,
    });

    // Download llms-full.txt in parallel — runs alongside the report write.
    // The raw file lands in sources/ for the agent to grep later.
    const firstUrl = successPages[0]?.url;
    const llmsFullPromise = firstUrl
      ? downloadLlmsFullToCache(firstUrl, cachePath).catch(() => null)
      : Promise.resolve(null);

    // Write report
    await writeReportFile(cachePath, params.query, collation, allExtractions, pages);

    // Wait for llms-full download (doesn't fail if it doesn't complete)
    const llmsFullPath = await llmsFullPromise;

    // ═══════════════════════════════════════════
    // Return concise injection
    // ═══════════════════════════════════════════
    const failedCount = pages.length - successPages.length;
    let result = collation;
    result += `\n\n---\n`;
    result += `**Cache**: \`${cachePath}/\`\n`;
    result += `**Report**: \`${cachePath}/report.md\`\n`;
    result += `**Sources**: ${successPages.length} succeeded, ${failedCount} failed\n`;
    result += `\nTo explore a specific source:\n`;
    result += `- Read the extraction: \`read ${cachePath}/extractions/01-*.md\`\n`;
    result += `- Read the full page: \`read ${cachePath}/sources/01-*.md\`\n`;

    return {
      content: [textContent(result)],
      details: {
        cachePath,
        urlsSearched: urls.length,
        pagesFetched: successPages.length,
        pagesFailed: failedCount,
      },
    };
  },
};

/**
 * Extract query-relevant content from a single page.
 */
async function extractPage(
  ctx: ExtensionContext,
  extractConfig: { provider: string; model: string },
  page: FetchedPage,
  query: string,
  focusPrompt: string | undefined,
  maxChars: number,
  signal: AbortSignal | undefined,
): Promise<ExtractResult> {
  try {
    let content = page.content;
    if (content.length > maxChars) {
      content = content.slice(0, maxChars) + "\n\n[TRUNCATED]";
    }

    let userMessage = `Web page content:\n---\n${content}\n---\n\n`;
    userMessage += `Extract information relevant to: ${query}\n`;
    if (focusPrompt) {
      userMessage += `\nFocus: ${focusPrompt}\n`;
    }

    const extraction = await callLlm(ctx, extractConfig, EXTRACTION_SYSTEM_PROMPT, userMessage, {
      maxTokens: 3000,
      signal,
    });

    const firstLine = extraction.split("\n")[0] ?? "";
    return {
      url: page.url,
      title: page.title,
      extraction,
      sourceType: inferSourceType(firstLine),
      currentness: inferCurrentness(firstLine),
      status: "success",
    };
  } catch (err: any) {
    // Log extraction error but don't fail the whole pipeline
    console.error(`[pi-web-research] Extraction failed for ${page.url}: ${err?.message ?? err}`);
    return {
      url: page.url,
      title: page.title,
      extraction: "",
      sourceType: "unknown",
      currentness: "unknown",
      status: "failed",
    };
  }
}

function progressUpdate(message: string, progress: number) {
  return {
    content: [textContent(`⏳ ${message}`)],
    details: { progress, phase: message },
  };
}

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

function inferSourceType(line: string): string {
  const lower = line.toLowerCase();
  if (lower.includes("official doc")) return "official docs";
  if (lower.includes("api reference")) return "API reference";
  if (lower.includes("tutorial")) return "tutorial";
  if (lower.includes("blog")) return "blog post";
  if (lower.includes("forum") || lower.includes("stackoverflow")) return "forum";
  return "unknown";
}

function inferCurrentness(line: string): string {
  const lower = line.toLowerCase();
  if (lower.includes("current") || lower.includes("up to date")) return "current";
  if (lower.includes("outdated") || lower.includes("old")) return "possibly outdated";
  return "undated";
}
