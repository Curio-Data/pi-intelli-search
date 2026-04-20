// src/tools/web-collate.ts — web_collate tool
import { Type } from "@sinclair/typebox";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { COLLATION_SYSTEM_PROMPT } from "../prompts.js";
import { callLlm } from "../llm.js";
import { makeCachePath, domainSlug, writeCacheFiles, writeReportFile } from "../cache.js";
import { textContent } from "../util.js";
import type { ExtractResult } from "../types.js";

const extractionSchema = Type.Object({
  url: Type.String(),
  title: Type.String(),
  extraction: Type.String(),
  sourceType: Type.String(),
  status: Type.String(),
});

const fullPageSchema = Type.Object({
  url: Type.String(),
  title: Type.String(),
  content: Type.String(),
});

export const webCollateTool = {
  name: "web_collate",
  label: "Web Collate",
  description:
    "Collate multiple per-page extractions into a deduplicated summary. " +
    "Produces a concise injection for the main conversation and writes " +
    "a persistent cache to .search/ for follow-up.",
  promptSnippet: "web_collate(extractions, query): deduplicate and synthesise extractions into concise summary",
  parameters: Type.Object({
    extractions: Type.Array(extractionSchema, {
      description: "Array of per-page extraction results from web_extract",
    }),
    query: Type.String({ description: "The original search query" }),
    searchSummary: Type.Optional(Type.String({
      description: "Sonar summary from the search step",
    })),
    fullPages: Type.Optional(Type.Array(fullPageSchema, {
      description: "Full Defuddle output for caching (not sent to LLM)",
    })),
  }),

  async execute(
    _toolCallId: string,
    params: {
      extractions: Array<{ url: string; title: string; extraction: string; sourceType: string; status: string }>;
      query: string;
      searchSummary?: string;
      fullPages?: Array<{ url: string; title: string; content: string }>;
    },
    signal: AbortSignal | undefined,
    _onUpdate: any,
    ctx: ExtensionContext,
  ) {
    const { loadSettings, resolveModelConfig } = await import("../settings.js");
    const settings = await loadSettings(ctx.cwd);
    const collateConfig = resolveModelConfig(settings, "collate");

    const cachePath = makeCachePath(params.query, ctx.cwd, settings.cacheDir);
    const succeeded = params.extractions.filter((e) => e.status === "success");
    const blocked = params.extractions.filter((e) => e.status !== "success");

    // Build extract results for cache
    const extractResults: ExtractResult[] = params.extractions.map((e) => ({
      url: e.url,
      title: e.title,
      extraction: e.extraction,
      sourceType: e.sourceType,
      currentness: "undated",
      status: e.status as ExtractResult["status"],
    }));

    const fetchedPages = (params.fullPages ?? []).map((p) => ({
      url: p.url,
      title: p.title,
      content: p.content,
      status: "success" as const,
    }));

    await writeCacheFiles(cachePath, extractResults, fetchedPages, params.searchSummary ?? "", params.query);

    // Build collation prompt
    let userMessage = `Original query: ${params.query}\n`;
    userMessage += `Cache path: ${cachePath}/\n\n`;

    if (params.searchSummary) {
      userMessage += `Search summary (from Sonar):\n${params.searchSummary}\n\n`;
    }

    for (const [i, ext] of succeeded.entries()) {
      const filename = `${String(i + 1).padStart(2, "0")}-${domainSlug(ext.url)}.md`;
      userMessage += `--- Source ${i + 1}: ${ext.url} ---\n`;
      userMessage += `Title: ${ext.title}\n`;
      userMessage += `Type: ${ext.sourceType}\n`;
      userMessage += `Extraction file: ${cachePath}/extractions/${filename}\n`;
      userMessage += `Full page file: ${cachePath}/sources/${filename}\n`;
      userMessage += `\n${ext.extraction}\n\n`;
    }

    // Call LLM for collation
    const collation = await callLlm(ctx, collateConfig, COLLATION_SYSTEM_PROMPT, userMessage, {
      maxTokens: 4000,
      signal,
    });

    // Write report
    await writeReportFile(cachePath, params.query, collation, extractResults, fetchedPages);

    return {
      content: [textContent(formatCollationResult(collation, cachePath, succeeded, blocked))],
      details: { cachePath, sourcesFetched: succeeded.length + blocked.length },
    };
  },
};

function formatCollationResult(
  collation: string,
  cachePath: string,
  succeeded: Array<{ url: string }>,
  blocked: Array<{ url: string }>,
): string {
  let output = collation + "\n\n";
  output += `---\n`;
  output += `**Cache**: \`${cachePath}/\`\n`;
  output += `**Report**: \`${cachePath}/report.md\`\n`;
  output += `**Sources**: ${succeeded.length} succeeded, ${blocked.length} blocked\n`;
  output += `\nTo explore a specific source:\n`;
  output += `- Read the extraction: \`read ${cachePath}/extractions/01-*.md\`\n`;
  output += `- Read the full page: \`read ${cachePath}/sources/01-*.md\`\n`;
  return output;
}
