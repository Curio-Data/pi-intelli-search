// src/tools/intelli-research.ts — intelli_research orchestrator tool
//
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
// SPDX-License-Identifier: Apache-2.0
import { Type } from "typebox";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { SEARCH_SYSTEM_PROMPT, EXTRACTION_SYSTEM_PROMPT, COLLATION_SYSTEM_PROMPT, CACHE_SUGGEST_PROMPT } from "../prompts.js";
import { callLlm } from "../llm.js";
import { fetchPages, downloadLlmsFullToCache } from "../fetch.js";
import { makeCachePath, domainSlug, writeCacheFiles, writeReportFile, readIndex, formatIndexForJudge, parseJudgeResponse, formatCacheSuggestions } from "../cache.js";
import { textContent, extractSourceUrls, inferSourceType, inferCurrentness, mapWithConcurrency, sleep, createRateLimiter } from "../util.js";
import type { LlmRetryConfig } from "../llm.js";
import { loadSettings, resolveModelConfig } from "../settings.js";
import type { FetchedPage, ExtractResult } from "../types.js";

// ── Progress bar: pipeline stages ──
const STAGES = ["search", "fetch", "extract", "collate", "cache"] as const;
type StageName = (typeof STAGES)[number];

const STAGE_LABELS: Record<StageName, string> = {
  search: "Search",
  fetch: "Fetch",
  extract: "Extract",
  collate: "Collate",
  cache: "Cache",
};

interface ProgressDetails {
  stage: StageName;
  stageIdx: number;
  totalStages: number;
  message: string;
  pct: number;
  subProgress?: { current: number; total: number };
}

export const intelliResearchTool = {
  name: "intelli_research",
  label: "Intelli Research",
  description:
    "Search the web, fetch top results, extract relevant content from each " +
    "page, and deduplicate into a concise summary. Caches all results under " +
    ".search/ for follow-up. This is the primary research tool; for quick " +
    "factual lookups, use intelli_search instead.",
  promptSnippet: "intelli_research(query): full search → fetch → extract → collate pipeline with caching",
  promptGuidelines: [
    "Use intelli_research when the user needs current web information (docs, APIs, best practices, library updates). For quick factual questions, use intelli_search alone.",
    "Use maxUrls to control breadth: 3 for targeted, 8 (default) for broad, 12 for exhaustive. The setting caps requests at maxUrls (default 16).",
    "Always provide focusPrompt to guide extraction. Without it the LLM extracts generically. Translate the user's intent into a specific extraction focus.",
    "The tool result contains a concise summary — use it directly. Only read .search/ cache files when the summary is insufficient.",
    "Use domains to target specific sites (e.g., ['docs.python.org']) when the user references a specific documentation source.",
  ],
  parameters: Type.Object({
    query: Type.String({ description: "What to research" }),
    maxUrls: Type.Optional(Type.Number({ description: "Max URLs to fetch (default: 8, capped by settings.maxUrls)" })),
    domains: Type.Optional(Type.Array(Type.String(), { description: "Restrict search to these domains" })),
    focusPrompt: Type.Optional(Type.String({ description: "Focus guidance for all extractions" })),
  }),

  renderResult(
    result: any,
    { isPartial }: { isPartial: boolean; expanded: boolean },
    theme: any,
    _context: any,
  ): Text {
    if (isPartial && result.details?.stage) {
      return renderProgressBar(result.details as ProgressDetails, theme);
    }
    // Final result: show the collated summary text (compact fallback)
    const content = result.content?.[0];
    const text = content?.type === "text" ? content.text : "";
    return new Text(text, 0, 0);
  },

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
    const settings = await loadSettings(ctx.cwd);

    const requestedMax = params.maxUrls ?? settings.defaultUrls;
    const maxUrls = Math.min(requestedMax, settings.maxUrls);

    // Transport-level retry config shared by every LLM call in this pipeline.
    const retry: LlmRetryConfig = {
      attempts: settings.llmRetryAttempts,
      baseDelayMs: settings.retryBaseDelayMs,
      maxDelayMs: settings.retryMaxDelayMs,
    };
    // Min-interval gate for the extract fan-out (no-op when interval is 0).
    const gate = createRateLimiter(settings.minRequestIntervalMs);

    const searchConfig = resolveModelConfig(settings, "search");
    const extractConfig = resolveModelConfig(settings, "extract");
    const collateConfig = resolveModelConfig(settings, "collate");

    // Pre-flight: validate all three models exist in the registry before
    // starting the pipeline. This catches typos in settings.json (e.g.
    // "minimax/M3.7") before any LLM calls are made and cost incurred.
    const missingModels = validateModelConfigs(ctx, [
      { role: "search", config: searchConfig },
      { role: "extract", config: extractConfig },
      { role: "collate", config: collateConfig },
    ]);
    if (missingModels.length > 0) {
      const lines = missingModels.map(
        (m) => `  ${m.role}: ${m.config.provider}/${m.config.model}`,
      );
      throw new Error(
        `Configured model(s) not found in Pi's model registry:\n${lines.join("\n")}\n` +
        `Check your settings.json for typos or missing provider configuration. ` +
        `Run /login to add API keys, or /model to see available models.`,
      );
    }

    // ═══════════════════════════════════════════
    // Working indicator — custom research spinner
    // ═══════════════════════════════════════════
    // setWorkingIndicator was added in pi 0.68.0.
    // Gracefully degrade on older versions.
    const ui = ctx.ui as { setWorkingIndicator?(opts?: { frames?: string[]; intervalMs?: number }): void };
    const INDICATOR_FRAMES = ["🔍", "🌐", "📄", "✨"];
    ui.setWorkingIndicator?.({ frames: INDICATOR_FRAMES, intervalMs: 400 });
    // Ensure cleanup on any exit path
    const restoreIndicator = () => ui.setWorkingIndicator?.();
    try {
      return await executePipeline();
    } finally {
      restoreIndicator();
    }

    async function executePipeline() {
    // ═══════════════════════════════════════════
    // Stage 1: Search
    // ═══════════════════════════════════════════
    onUpdate?.(progressUpdate("search", `Querying ${searchConfig.provider}/${searchConfig.model}...`));

    let searchQuery = params.query;
    if (params.domains?.length) {
      searchQuery += " site:" + params.domains.join(" OR site:");
    }

    // The search model occasionally returns a valid response with no markdown
    // links (a "degraded 200" — common under provider load). callLlm's retry
    // only covers transport errors, so retry the search call itself a bounded
    // number of times until it yields at least one URL.
    let searchResult = "";
    let urls: Array<{ url: string; title: string }> = [];
    const searchAttempts = Math.max(1, settings.searchRetryAttempts);
    for (let attempt = 1; attempt <= searchAttempts; attempt++) {
      searchResult = await callLlm(ctx, searchConfig, SEARCH_SYSTEM_PROMPT, searchQuery, {
        maxTokens: 2000,
        signal,
        retry,
        timeoutMs: settings.llmTimeoutMs,
      });
      urls = extractSourceUrls(searchResult).slice(0, maxUrls);
      if (urls.length > 0 || signal?.aborted || attempt === searchAttempts) break;
      onUpdate?.(progressUpdate("search", `Search returned no links — retrying (${attempt}/${searchAttempts - 1})...`));
      await sleep(settings.retryBaseDelayMs, signal);
    }

    if (urls.length === 0) {
      return {
        content: [textContent(
          `Search returned no links for query: "${params.query}" after ${searchAttempts} attempt(s). ` +
          `This is a degraded search response (the model replied without markdown links), ` +
          `not a fetch or extraction failure.\n\nSearch summary:\n${searchResult}`,
        )],
        details: { cachePath: "", urlsSearched: 0, pagesFetched: 0, pagesFailed: 0 } as Record<string, unknown>,
      };
    }

    // ═══════════════════════════════════════════
    // Stage 2: Fetch pages via wreq-js + Defuddle
    // ═══════════════════════════════════════════
    onUpdate?.(progressUpdate("fetch", `Fetching ${urls.length} pages...`));
    const pages = await fetchPages(urls.map((u) => u.url), signal, {
      timeoutMs: settings.fetchTimeoutMs,
      browser: settings.browserFingerprint as unknown as import("wreq-js").BrowserProfile,
      concurrency: settings.fetchConcurrency,
    });
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
    onUpdate?.(progressUpdate("extract", `Extracting from ${successPages.length} pages...`, {
      current: 0,
      total: successPages.length,
    }));

    // Extract pages through a bounded worker pool (settings.extractionConcurrency)
    // rather than all at once. With maxUrls up to 16, an unbounded Promise.all
    // would fire that many simultaneous LLM calls and trip provider rate limits.
    // Progress is emitted on each page's completion (via onSettled), so the
    // sub-progress bar reflects real work done instead of jumping to N/N at launch.
    let extractDone = 0;
    const rawExtractions = await mapWithConcurrency(
      successPages,
      settings.extractionConcurrency,
      async (page) => {
        // Space out concurrent extract calls when a throttle is configured.
        await gate(signal);
        return extractPage(ctx, extractConfig, page, params.query, params.focusPrompt, settings.extractMaxChars, settings.extractionMaxTokens, signal, retry, settings.llmTimeoutMs);
      },
      {
        signal,
        onSettled: (page) => {
          extractDone++;
          onUpdate?.(progressUpdate("extract",
            `Page ${extractDone}/${successPages.length}: ${(page.title || page.url).slice(0, 40)}...`,
            { current: extractDone, total: successPages.length },
          ));
        },
      },
    );

    // Indices left unrun by an aborted signal become a failed extraction so the
    // result array stays aligned with successPages and fully typed.
    const extractions: ExtractResult[] = rawExtractions.map((e, i) => e ?? {
      url: successPages[i].url,
      title: successPages[i].title,
      extraction: "",
      sourceType: "unknown",
      currentness: "unknown",
      status: "failed" as const,
    });

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
    onUpdate?.(progressUpdate("collate", "Synthesising results..."));

    const cachePath = makeCachePath(params.query, ctx.cwd, settings.cacheDir);
    const allExtractions = [...extractions, ...blockedExtractions];

    // Build collation message
    const succeededExtractions = allExtractions.filter((e) => e.status === "success");

    // If no extractions produced useful content (all fetches failed or all
    // extraction LLM calls errored), return the search summary without
    // creating cache artifacts or running collation.
    if (succeededExtractions.length === 0) {
      const fetchFailed = blockedExtractions.length;
      const extractFailed = extractions.filter((e) => e.status === "failed").length;
      const reason = fetchFailed > 0
        ? `${fetchFailed} page(s) failed to fetch`
        : `${extractFailed} extraction(s) failed`;
      return {
        content: [textContent(
          `${reason}. No content was extracted.\n\nSearch summary:\n${searchResult}`,
        )],
        details: {
          cachePath: "",
          urlsSearched: urls.length,
          pagesFetched: successPages.length,
          pagesFailed: pages.length - successPages.length,
        } as Record<string, unknown>,
      };
    }

    // Write cache (only when there are successful extractions)
    await writeCacheFiles(cachePath, allExtractions, successPages, searchResult, params.query);

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
      maxTokens: settings.collationMaxTokens,
      signal,
      retry,
      timeoutMs: settings.llmTimeoutMs,
    });

    // Download llms-full.txt for each unique domain in the results
    // (unless disabled via settings.disableLlmsFullDiscovery).
    // Pass a representative page URL per hostname (not the bare hostname)
    // so path-aware builders (e.g. Cloudflare product-scoped paths) still
    // receive the path context they need to construct the correct URL.
    // These probes are supplementary cache artifacts, not part of the returned
    // summary. Each honours the tool signal (Esc cancels) and a tight timeout
    // (fetch.ts: LLMS_FULL_TIMEOUT_MS), so a slow or hanging documentation host
    // can no longer stall the result. They run concurrently with the report
    // write below, so the worst-case added latency is one probe timeout.
    let llmsFullPromises: Promise<unknown>[] = [];
    if (!settings.disableLlmsFullDiscovery && !signal?.aborted) {
      const sampleUrlByHost = new Map<string, string>();
      for (const p of successPages) {
        try {
          const h = new URL(p.url).hostname;
          if (!sampleUrlByHost.has(h)) sampleUrlByHost.set(h, p.url);
        } catch { /* skip malformed URLs */ }
      }
      llmsFullPromises = [...sampleUrlByHost.values()].map((sampleUrl) =>
        downloadLlmsFullToCache(sampleUrl, cachePath, signal).catch(() => null),
      );
    }

    // Write report
    await writeReportFile(cachePath, params.query, collation, allExtractions, pages);

    // Wait for llms-full downloads (don't fail if they don't complete)
    await Promise.all(llmsFullPromises);

    // ═══════════════════════════════════════════
    // Stage 5: Cache suggest — find related previous searches
    // ═══════════════════════════════════════════
    // Runs after the pipeline completes. Uses the extract model as a cheap
    // LLM judge to find semantically related cached searches. Never blocks
    // the main result — graceful degradation on failure.
    // ── Stage 5 notification ──
    onUpdate?.(progressUpdate("cache", "Checking related cached research..."));

    const currentSlug = cachePath.split("/").pop() ?? "";
    let suggestionsAppendix = "";
    try {
      const index = await readIndex(settings.cacheDir);
      // Only run judge if there are other searches to compare against
      if (index.searches.some((e) => e.slug !== currentSlug)) {
        const indexText = formatIndexForJudge(index, currentSlug);
        const judgeUserMsg = `Current query: "${params.query}"\n\nPrevious searches:\n${indexText}`;
        const judgeResponse = await callLlm(ctx, extractConfig, CACHE_SUGGEST_PROMPT, judgeUserMsg, {
          maxTokens: 500,
          signal,
          retry,
          timeoutMs: settings.llmTimeoutMs,
        });
        const matches = parseJudgeResponse(judgeResponse, index, currentSlug);
        suggestionsAppendix = formatCacheSuggestions(matches, settings.cacheDir);
      }
    } catch (err: unknown) {
      // Cache suggest is purely additive — never fail the pipeline
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[pi-intelli-search] Cache suggest failed: ${message}`);
    }

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
    result += suggestionsAppendix;

    return {
      content: [textContent(result)],
      details: {
        cachePath,
        urlsSearched: urls.length,
        pagesFetched: successPages.length,
        pagesFailed: failedCount,
      },
    };
    } // end executePipeline()
  },
};

/**
 * Validate that all configured models exist in Pi's model registry.
 * Returns a list of models that are missing. An empty list means all OK.
 * Call this before starting any pipeline stages to fail fast on typos.
 */
export function validateModelConfigs(
  ctx: ExtensionContext,
  configs: Array<{ role: string; config: { provider: string; model: string } }>,
): Array<{ role: string; config: { provider: string; model: string } }> {
  const missing: Array<{ role: string; config: { provider: string; model: string } }> = [];
  for (const { role, config } of configs) {
    const model = ctx.modelRegistry.find(config.provider, config.model);
    if (!model) {
      missing.push({ role, config });
    }
  }
  return missing;
}

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
  maxTokens: number,
  signal: AbortSignal | undefined,
  retry: LlmRetryConfig,
  timeoutMs: number,
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
      maxTokens,
      signal,
      retry,
      timeoutMs,
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
  } catch (err: unknown) {
    // Log extraction error but don't fail the whole pipeline
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[pi-intelli-search] Extraction failed for ${page.url}: ${message}`);
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

/**
 * Build a progress update payload with structured stage data.
 * The content text is what the LLM sees as the tool result during streaming.
 * The details carry structured data for renderResult to render a progress bar.
 */
export function progressUpdate(
  stage: StageName,
  message: string,
  subProgress?: { current: number; total: number },
) {
  const stageIdx = STAGES.indexOf(stage);
  const pct = Math.round(((stageIdx + 1) / STAGES.length) * 100);
  return {
    content: [textContent(`⚙️ Stage ${stageIdx + 1}/${STAGES.length}: ${message}`)],
    details: {
      stage,
      stageIdx,
      totalStages: STAGES.length,
      message,
      pct,
      ...(subProgress ? { subProgress } : {}),
    } satisfies ProgressDetails,
  };
}

/**
 * Render a progress bar showing pipeline stage completion for the TUI.
 * Called by renderResult when isPartial is true during tool streaming.
 * Shows overall bar, stage pills, current message, and optional sub-progress.
 */
export function renderProgressBar(details: ProgressDetails, theme: any): Text {
  const { stage, stageIdx, totalStages, message, subProgress } = details;

  // Overall progress bar
  const barWidth = 20;
  const filled = Math.round(((stageIdx + 1) / totalStages) * barWidth);
  const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
  const pct = Math.round(((stageIdx + 1) / totalStages) * 100);

  // Stage pills: ✓ for done, ● for current, ○ for pending
  const pills = STAGES.map((s, i) => {
    const label = STAGE_LABELS[s];
    if (i < stageIdx) return theme.fg("success", `✓${label}`);
    if (i === stageIdx) return theme.fg("accent", theme.bold(`●${label}`));
    return theme.fg("dim", `○${label}`);
  }).join("  ");

  let text = theme.fg("accent", `[${bar}] ${pct}%`) + "\n";
  text += pills + "\n";
  text += theme.fg("dim", message);

  // Sub-progress bar for stages with per-item progress (e.g. extraction)
  if (subProgress) {
    const subFilled = Math.round((subProgress.current / subProgress.total) * barWidth);
    const subBar = "▐".repeat(subFilled) + "░".repeat(barWidth - subFilled);
    text += "\n  " + theme.fg("muted", `╰ [${subBar}] ${subProgress.current}/${subProgress.total}`);
  }

  return new Text(text, 0, 0);
}
