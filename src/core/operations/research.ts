// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import {
  SEARCH_SYSTEM_PROMPT,
  EXTRACTION_SYSTEM_PROMPT,
  COLLATION_SYSTEM_PROMPT,
  CACHE_SUGGEST_PROMPT,
} from "../prompts.js";
import { mergeCitations } from "../annotations.js";
import type {
  ModelClient,
  ModelRequest,
  ModelUsage,
  OperationContext,
  OperationResult,
  ResearchParams,
  ModelRetryConfig as LlmRetryConfig,
} from "../contracts.js";
import { displayCachePath, type WorkspacePaths } from "../paths.js";
import { fetchPages, downloadLlmsFullToCache } from "../fetch.js";
import {
  makeCachePath,
  writeCacheFiles,
  writeReportFile,
  readIndex,
  formatIndexForJudge,
  isWellFormedJudgeResponse,
  parseJudgeResponse,
  formatCacheSuggestions,
  cacheLockDir,
  indexLockDir,
  withLock,
  updateIndex,
  removeIndexEntry,
  allocateSourceIdentity,
  clearCacheArtefacts,
  rotateCacheArtefacts,
  type SourceIdentity,
} from "../cache.js";
import {
  extractSourceUrls,
  stripTrailingSourcesSection,
  inferSourceType,
  inferCurrentness,
  mapWithConcurrency,
  sleep,
  createRateLimiter,
  errMsg,
  failureDetail,
  redirectedToDifferentHost,
  throwIfAborted,
  completionTruncated,
  isOutputBudgetExhausted,
  OutputBudgetExhaustedError,
  reasoningOnlyCompletion,
} from "../util.js";
import { TelemetryBuilder, writeTelemetry, type TelemetryOutcome } from "../telemetry.js";
import { mkdir, writeFile, rm, readdir, readFile, mkdtemp, stat } from "node:fs/promises";
import { join } from "node:path";
import type { FetchedPage, ExtractResult, ModelConfig } from "../types.js";
import {
  appendDomainFilter,
  buildSearchPayloadPatch,
  buildExtractionMessage,
  buildCollationMessage,
  collationSourceOverheadChars,
  COLLATION_NO_EVIDENCE_MESSAGE,
  CollationNoEvidenceError,
  CollationTrimmedInputError,
  type CollationInputBudgetDetails,
  deliveredInputBudget,
  formatCacheAppendix,
  formatCollationTrimNotice,
} from "../messages.js";
import { MAX_OUTPUT_TOKENS } from "../defaults.js";
import {
  attemptTimeoutMs,
  budgetCaps,
  MIN_RETRY_GROWTH,
  rankBudgetedCompletions,
  retryCeiling,
  type BudgetedCompletion,
} from "../output-budget.js";
import { planCollationBudget, inferredSource, type CollationBudgetPlan } from "../collation-budget.js";
import { progress } from "../progress.js";
import {
  collationFailureReport,
  evidenceExtractions,
  extractionFailureReport,
  finalizeCollation,
  inferredAssetsSection,
  isCollationFailureReport,
  stripFailureMarkers,
} from "../provenance.js";

/** Per-run I/O injection; no mutable global engine harness. */
export interface ResearchDependencies {
  fetchPages: typeof fetchPages;
  downloadLlmsFullToCache: typeof downloadLlmsFullToCache;
  /** Optional per-run filesystem seam for deterministic cleanup-failure tests. */
  removeStaging?: (path: string) => Promise<void>;
  /** Optional lock-attempt seam for deterministic preservation-race tests. */
  beforeCacheLock?: (path: string) => Promise<void>;
}

export class MissingModelsError extends Error {
  constructor(readonly bindings: import("../contracts.js").ModelBinding[]) {
    super(
      `Configured model(s) not found: ${bindings.map(({ role, config }) => `${role}: ${config.provider}/${config.model}`).join(", ")}`,
    );
  }
}

export async function preflightResearch(context: OperationContext): Promise<void> {
  const missing = await context.models.preflight([
    { role: "search", config: context.settings.searchModel },
    { role: "extract", config: context.settings.extractModel },
    { role: "collate", config: context.settings.collateModel },
  ]);
  if (missing.length) throw new MissingModelsError(missing);
}

export async function research(
  params: ResearchParams,
  context: OperationContext,
  dependencies: ResearchDependencies = { fetchPages, downloadLlmsFullToCache },
): Promise<OperationResult> {
  throwIfAborted(context.signal);
  await preflightResearch(context);
  throwIfAborted(context.signal);
  const { settings, paths } = context;
  const physicalCachePath = makeCachePath(params.query, paths.workspaceRoot, paths.cacheRoot);
  return executePipeline({
    ...context,
    signal: context.signal,
    dependencies,
    params,
    physicalCachePath,
    cachePath: displayCachePath(paths, physicalCachePath),
    maxUrls: Math.min(params.maxUrls ?? settings.defaultUrls, settings.maxUrls),
    retry: {
      attempts: settings.llmRetryAttempts,
      baseDelayMs: settings.retryBaseDelayMs,
      maxDelayMs: settings.retryMaxDelayMs,
    },
    gate: createRateLimiter(settings.minRequestIntervalMs),
    tel: settings.disableTelemetry
      ? null
      : await TelemetryBuilder.create(params.query, context.identity, context.now),
    searchConfig: settings.searchModel,
    extractConfig: settings.extractModel,
    collateConfig: settings.collateModel,
    budgetRetries: { extract: 0, collate: 0 },
  });
}

// ── Pipeline context: everything a stage needs, assembled once in execute() ──

interface PipelineCtx extends OperationContext {
  dependencies: ResearchDependencies;
  models: ModelClient;
  paths: WorkspacePaths;
  physicalCachePath: string;
  params: ResearchParams;
  settings: OperationContext["settings"];
  maxUrls: number;
  retry: LlmRetryConfig;
  gate: (signal?: AbortSignal) => Promise<void>;
  tel: TelemetryBuilder | null;
  searchConfig: ModelConfig;
  extractConfig: ModelConfig;
  collateConfig: ModelConfig;
  signal: AbortSignal | undefined;
  cachePath: string;
  /** Doubled-budget retries issued: extraction pages, and collation. */
  budgetRetries: { extract: number; collate: number };
  rejectedSyntheses?: Array<{ text: string; reason: string; maxTokens: number }>;
  rejectedSynthesisPath?: string;
}

/**
 * The 5-stage research pipeline. Each stage is a module-level function that
 * records its own telemetry slice; degraded exits go through degradedReturn()
 * so every early return writes its sidecar the same way.
 */
async function executePipeline(p: PipelineCtx): Promise<OperationResult> {
  // ═══════════════════════════════════════════
  // Stage 1: Search
  // ═══════════════════════════════════════════
  const search = await runSearchStage(p);
  if (search.urls.length === 0) {
    return degradedReturn(
      p,
      "no-links",
      `Search returned no links for query: "${p.params.query}" after ${search.maxAttempts} attempt(s). ` +
        `This is a degraded search response (the model replied without markdown links), ` +
        `not a fetch or extraction failure.\n\nSearch summary:\n${search.searchResult}`,
      { cachePath: "", urlsSearched: 0, pagesFetched: 0, pagesFailed: 0 },
    );
  }

  // ═══════════════════════════════════════════
  // Stage 2: Fetch pages via wreq-js + Defuddle
  // ═══════════════════════════════════════════
  const fetched = await runFetchStage(p, search.urls);
  throwIfAborted(p.signal);
  if (fetched.successPages.length === 0) {
    const fetchLines = fetched.pages
      .map((pg) => `- ${pg.url}${pg.inferred ? " [inferred from text, not a citation]" : ""}: ${failureDetail(pg.error ?? "no reason recorded")}`)
      .slice(0, 10)
      .join("\n");
    return degradedReturn(
      p,
      "fetch-failed",
      `All ${search.urls.length} pages failed to fetch.` +
        (fetchLines ? `\n\nFailed Sources (up to 10):\n${fetchLines}` : "") +
        `\n\nSearch summary:\n${search.searchResult}`,
      {
        cachePath: "",
        urlsSearched: search.urls.length,
        pagesFetched: 0,
        pagesFailed: search.urls.length,
        ...inferredAssetDetailsField(fetched.pages),
      },
    );
  }

  // ═══════════════════════════════════════════
  // Stage 3: Extract per-page via LLM (parallel)
  // ═══════════════════════════════════════════
  const extracted = await runExtractStage(p, fetched.successPages, fetched.pages);
  throwIfAborted(p.signal);

  // ═══════════════════════════════════════════
  // Stage 4: Collate via LLM + write cache
  // ═══════════════════════════════════════════
  // The collate banner is emitted before the degraded check so progress
  // ordering matches the pre-split pipeline on every exit path.
  p.onProgress?.(progress("collate", "Synthesising results..."));

  const allExtractions = [...extracted.extractions, ...extracted.blockedExtractions];
  const succeededExtractions = allExtractions.filter((e) => e.status === "success");
  // Allocate source file identity once: physical cache files, the collation
  // prompt and the report all cite these exact filenames, so mixed outcomes
  // cannot cite files this run never wrote.
  const identity = allocateSourceIdentity(allExtractions, fetched.pages);

  // If no extraction produced useful content (every extraction LLM call
  // errored; all-fetch-failed exits earlier), keep every fetched page and a
  // failure report instead of leaving only meta.json (owner decision,
  // 2026-11-07): the saved pages let the calling agent revisit a page, or
  // retry its extraction later, without refetching, and the failed-source
  // list names each saved page's path and why its extraction failed. Like a
  // collation failure, the write never displaces a same-day successful
  // report and replaces an earlier failure report (both decided under the
  // cache lock inside writeCacheArtifacts).
  let collation: string;
  let outcome: "completed" | "collate-failed" | "extraction-failed" = "completed";
  let failureMessage = "";
  if (succeededExtractions.length === 0) {
    const fetchFailed = extracted.blockedExtractions.length;
    const extractFailed = extracted.extractions.filter((e) => e.status === "failed").length;
    const reason = [
      ...(fetchFailed > 0 ? [`${fetchFailed} page(s) failed to fetch`] : []),
      ...(extractFailed > 0 || fetchFailed === 0 ? [`${extractFailed} extraction(s) failed`] : []),
    ].join(" and ");
    // Per-page reasons travel with every exit, including the preserved
    // refresh: the pages of THIS attempt were not saved, so no source path
    // is offered, but the bounded reason for each page must survive for the
    // calling agent to act on (kimi F2).
    const failureLines = allExtractions
      .filter((e) => e.status !== "success")
      .map((e) => {
        const detail =
          e.error ?? fetched.pages.find((pg) => pg.url === e.url)?.error;
        return detail ? `- ${e.url}: ${failureDetail(String(detail))}` : `- ${e.url}`;
      })
      .slice(0, 10)
      .join("\n");
    failureMessage =
      `${asSentence(reason)} No content was extracted. ${fetched.successPages.length} page(s) were ` +
      `fetched, but the report already saved for this query at ${p.cachePath} was preserved, ` +
      `so this run's fetched pages were not saved.` +
      (failureLines ? `\n\n**Failed Sources** (this attempt, up to 10):\n${failureLines}` : "") +
      `\n\nSearch summary:\n${search.searchResult}`;
    outcome = "extraction-failed";
    collation = extractionFailureReport(
      asSentence(reason),
      p.cachePath,
      fetched.successPages.length,
      search.searchResult,
    );
  } else {
    // A collation failure after paid extraction commits the extractions with a
    // report that states the failure, instead of discarding the run. A
    // successful report already in place for the same query (decided under the
    // cache lock) is preserved like any degraded refresh: only the failed
    // attempt's sidecar is recorded.
    try {
      collation = await runCollateStage(p, search.searchResult, succeededExtractions, identity);
    } catch (error) {
      throwIfAborted(p.signal);
      const reason = failureDetail(errMsg(error)) || "collation failed";
      p.logger.error(`Collation failed: ${reason}`);
      p.tel?.recordCollate({
        model: `${p.collateConfig.provider}/${p.collateConfig.model}`,
        summaryChars: 0,
        ...(p.budgetRetries.collate > 0
          ? { budgetRetried: true, budgetRetries: p.budgetRetries.collate }
          : {}),
        error: reason,
        ...(error instanceof CollationNoEvidenceError || error instanceof CollationTrimmedInputError
          ? { inputBudget: error.inputBudget }
          : {}),
      });
      failureMessage =
        `Collation failed: ${asSentence(reason)} ${succeededExtractions.length} page(s) were extracted, but ` +
        `the report already saved for this query at ${p.cachePath} was preserved, ` +
        `so this run's extractions were not saved.\n\nSearch summary:\n${search.searchResult}`;
      outcome = "collate-failed";
      collation =
        collationFailureReport(
          reason, p.cachePath, succeededExtractions, identity,
          error instanceof CollationTrimmedInputError, !!p.rejectedSyntheses?.length,
        ) +
        (error instanceof CollationTrimmedInputError ? error.trimNotice : "");
    }
  }

  // Keep inferred provenance and every fetch outcome beside the authoritative
  // source inventory in both the tool result and report.md. This point is
  // shared by completed, collate-failed and extraction-failed reports, so a
  // committed extraction failure carries the same identity-bearing assets.
  // The preserved return below renders current outcomes separately without
  // identity (and with inline bounded reasons) because nothing was saved.
  const inferredAssets = inferredAssetsSection(fetched.pages, p.cachePath, identity);
  if (inferredAssets) collation += `\n\n${inferredAssets}`;

  // Start llms-full downloads BEFORE acquiring any lock, then write cache
  // artefacts under the per-cache-path lock (only local file I/O there).
  // A run without a synthesis skips supplementary documentation downloads.
  throwIfAborted(p.signal);
  const llms: LlmsDownloads =
    outcome === "completed"
      ? await startLlmsFullDownloads(p, fetched.successPages)
      : { abort: new AbortController(), futures: [] };
  let committed: boolean;
  try {
    committed = await writeCacheArtifacts(
      p,
      allExtractions,
      fetched,
      search.searchResult,
      collation,
      llms,
      identity,
      outcome,
    );
  } finally {
    // Settle writers before removing their directory, even on cache failure or cancellation.
    llms.abort.abort();
    await Promise.allSettled(llms.futures);
    if (llms.staging) {
      try {
        if (p.dependencies.removeStaging) await p.dependencies.removeStaging(llms.staging);
        else await rm(llms.staging, { recursive: true, force: true });
      } catch (error) {
        p.logger.error(`Documentation staging cleanup failed: ${errMsg(error)}`);
      }
    }
  }

  if (!committed) {
    const currentInferredAssets = inferredAssetsSection(fetched.pages, p.cachePath);
    return {
      text: failureMessage + (currentInferredAssets ? `\n\n${currentInferredAssets}` : "") + rejectedSynthesisNotice(p),
      outcome,
      details: {
        cachePath: "",
        // The preserved report is not this run's output, so it is reported
        // separately rather than as cachePath.
        preservedCachePath: p.cachePath,
        urlsSearched: search.urls.length,
        pagesFetched: fetched.successPages.length,
        pagesFailed: fetched.pages.length - fetched.successPages.length,
        extractionFailed: allExtractions.filter((e) => e.status === "failed").length,
        // This run was not committed: return its inferred outcomes, but do
        // not advertise source files that were never saved.
        ...inferredAssetDetailsField(fetched.pages),
      },
    };
  }

  // ═══════════════════════════════════════════
  // Stage 5: Cache suggest — find related previous searches
  // ═══════════════════════════════════════════
  // Skipped without a synthesis: the run is not indexed, and the judge would
  // spend another model call on a run that already failed.
  const suggestionsAppendix = outcome === "completed" ? await runCacheSuggestStage(p) : "";

  // ── Telemetry sidecar refresh ──
  // The sidecar was already written under the cache lock with all core
  // stages recorded. Rewrite it now that cache-suggest data is available
  // so the final sidecar is complete. Atomic via temp-file + rename; a
  // failure is caught and logged, never surfaced to the pipeline.
  throwIfAborted(p.signal);
  await writeLockedTelemetry(p, outcome);

  // ═══════════════════════════════════════════
  // Return concise injection
  // ═══════════════════════════════════════════
  const failedCount = fetched.pages.length - fetched.successPages.length;
  // Extraction failures only: pages that never fetched carry status
  // "blocked" and are already counted by pagesFailed / fetch.failed.
  const extractionFailures = allExtractions.filter((e) => e.status === "failed").length;
  const truncatedCount = succeededExtractions.filter((e) => e.truncated).length;
  const failedEntries = allExtractions
    .filter((e) => e.status !== "success")
    .map((e) => {
      const savedSource = identity.sourceFileFor(e.url);
      return {
        url: e.url,
        // Extraction reason when the extract call failed; fetch error when
        // the page never made it that far (blocked entries carry none).
        ...(e.error ? { error: e.error } : {}),
        ...(fetched.pages.find((page) => page.url === e.url)?.error
          ? { error: failureDetail(fetched.pages.find((page) => page.url === e.url)!.error!) }
          : {}),
        // The full page stays on disk even when extraction failed; pointing
        // the agent at it recovers work that was already paid for.
        ...(savedSource ? { sourceFile: `sources/${savedSource}` } : {}),
      };
    });
  const result =
    stripFailureMarkers(collation) +
    rejectedSynthesisNotice(p) +
    formatCacheAppendix(
      p.cachePath,
      succeededExtractions.length,
      allExtractions.length - succeededExtractions.length,
      failedEntries,
      truncatedCount,
    ) +
    suggestionsAppendix;

  return {
    text: result,
    outcome,
    details: {
      cachePath: p.cachePath,
      urlsSearched: search.urls.length,
      pagesFetched: fetched.successPages.length,
      pagesFailed: failedCount,
      // Extraction failures only (status "failed"); pagesFailed counts fetch
      // failures (status "blocked"), so the two never double-count a page.
      extractionFailed: extractionFailures,
      ...inferredAssetDetailsField(fetched.pages, identity),
    },
  };
}

// ── Stage 1: Search ──

interface SearchStageOut {
  searchResult: string;
  urls: Array<{
    url: string;
    title: string;
    inferred?: true;
    originalReference?: string;
  }>;
  /** Iterations actually executed. */
  attemptsUsed: number;
  /** Configured cap on iterations (1 = no retry). */
  maxAttempts: number;
}

async function runSearchStage(p: PipelineCtx): Promise<SearchStageOut> {
  p.onProgress?.(
    progress("search", `Querying ${p.searchConfig.provider}/${p.searchConfig.model}...`),
  );

  const searchQuery = appendDomainFilter(p.params.query, p.params.domains);

  // The search model occasionally returns a valid response with no markdown
  // links (a "degraded 200" — common under provider load). callLlm's retry
  // only covers transport errors, so retry the search call itself a bounded
  // number of times until it yields at least one URL.
  let searchResult = "";
  let urls: Array<{
    url: string;
    title: string;
    inferred?: true;
    originalReference?: string;
  }> = [];
  const maxAttempts = Math.max(1, p.settings.searchRetryAttempts);
  let attemptsUsed = 0;
  // Side channel for url_citation annotations: search-grounded models cite
  // many more sources than the prose links they write, and the transport
  // drops them (see annotations.ts). Merged into urls after each attempt.
  let annotationsHarvested = 0;
  // Optional OpenRouter web search server tool (settings: searchWebSearch).
  // Attaches search grounding to any OpenRouter chat model.
  const payloadPatch = buildSearchPayloadPatch(
    p.settings,
    p.searchConfig.provider,
    p.params.domains,
  );
  const searchReasoning = payloadPatch
    ? (p.settings.searchWebSearch.reasoning ?? "low")
    : undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    throwIfAborted(p.signal);
    attemptsUsed = attempt;
    const completion = await p.models.complete({
      model: p.searchConfig,
      systemPrompt: SEARCH_SYSTEM_PROMPT,
      userMessage: searchQuery,
      maxTokens: 2000,
      signal: p.signal,
      retry: p.retry,
      timeoutMs: p.settings.llmTimeoutMs,
      collectCitations: true,
      payloadPatch,
      reasoning: searchReasoning,
      onRetryNotice: (msg) => p.onProgress?.(progress("search", msg)),
    });
    searchResult = completion.text;
    annotationsHarvested = completion.citations.length;
    urls = mergeCitations(extractSourceUrls(searchResult), completion).slice(0, p.maxUrls);
    if (urls.length > 0 || p.signal?.aborted || attempt === maxAttempts) break;
    p.onProgress?.(
      progress("search", `Search returned no links — retrying (${attempt}/${maxAttempts - 1})...`),
    );
    await sleep(p.settings.retryBaseDelayMs, p.signal);
  }

  // User cancel during search: propagate abort rather than returning a
  // misleading "no links" diagnostic.
  if (p.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  // Drop the model's trailing Sources section before the text flows
  // downstream: URLs are extracted above from the FULL text (the section is
  // link-dense), and collation/error summaries get the canonical source
  // list from the extractions and cache appendix instead of a duplicate,
  // differently-ordered rendered list.
  searchResult = stripTrailingSourcesSection(searchResult);

  p.tel?.recordSearch({
    model: `${p.searchConfig.provider}/${p.searchConfig.model}`,
    linksReturned: urls.length,
    retryFired: attemptsUsed > 1,
    attempts: attemptsUsed,
    degraded: urls.length === 0,
    annotationsHarvested,
  });

  return { searchResult, urls, attemptsUsed, maxAttempts };
}

// ── Stage 2: Fetch ──

interface FetchStageOut {
  pages: FetchedPage[];
  successPages: FetchedPage[];
}

interface InferredAssetDetail {
  url: string;
  originalReference?: string;
  alternateUrl?: string;
  finalUrl?: string;
  redirectedToDifferentHost?: true;
  outcome: "page" | "code" | "text" | "unknown" | "nothing";
  contentType?: string;
  sourceFile?: string;
  error?: string;
}

/** Structured companion to the rendered inferred-assets table. MCP passes
 *  details through verbatim, so callers need not parse Markdown to follow up. */
function inferredAssetDetailsField(
  pages: readonly FetchedPage[],
  identity?: SourceIdentity,
): { inferredAssets?: InferredAssetDetail[] } {
  const inferredAssets = pages.filter((page) => page.inferred).map((page): InferredAssetDetail => {
    const sourceFile = identity?.sourceFileFor(page.url);
    return {
      url: page.url,
      ...(page.originalReference ? { originalReference: page.originalReference } : {}),
      ...(page.alternateUrl ? { alternateUrl: page.alternateUrl } : {}),
      ...(page.finalUrl ? { finalUrl: page.finalUrl } : {}),
      ...(redirectedToDifferentHost(page.url, page.finalUrl)
        ? { redirectedToDifferentHost: true as const }
        : {}),
      outcome: page.status === "error" ? ("nothing" as const) : (page.assetType ?? "unknown"),
      ...(page.contentType ? { contentType: page.contentType } : {}),
      ...(sourceFile ? { sourceFile: `sources/${sourceFile}` } : {}),
      ...(page.error ? { error: failureDetail(page.error) } : {}),
    };
  });
  return inferredAssets.length > 0 ? { inferredAssets } : {};
}

async function runFetchStage(
  p: PipelineCtx,
  urls: Array<{
    url: string;
    title: string;
    inferred?: true;
    originalReference?: string;
  }>,
): Promise<FetchStageOut> {
  p.onProgress?.(progress("fetch", `Fetching ${urls.length} pages...`));
  throwIfAborted(p.signal);
  const fetchedPages = await p.dependencies.fetchPages(
    urls.map((u) => u.url),
    p.signal,
    {
      timeoutMs: p.settings.fetchTimeoutMs,
      browser: p.settings.browserFingerprint as unknown as import("wreq-js").BrowserProfile,
      concurrency: p.settings.fetchConcurrency,
      proxy: p.settings.httpProxy,
    },
  );
  const pages = fetchedPages.map((page, index) => ({
    ...page,
    ...(urls[index]?.inferred ? { inferred: true as const } : {}),
    ...(urls[index]?.originalReference
      ? { originalReference: urls[index].originalReference }
      : {}),
  }));
  const successPages = pages.filter((pg) => pg.status === "success");

  // Tally fetch-variant winners from the per-page `source` field that
  // fetch.ts stamps ("defuddle" | "defuddle-fallback" | "markdown" | "text").
  // Falls back to "unknown" for any page lacking the field.
  const fetchWinners: Record<string, number> = {};
  for (const pg of successPages) {
    const variant = pg.source ?? "unknown";
    fetchWinners[variant] = (fetchWinners[variant] ?? 0) + 1;
  }
  p.tel?.recordFetch({
    requested: urls.length,
    succeeded: successPages.length,
    failed: pages.length - successPages.length,
    winners: fetchWinners,
  });

  return { pages, successPages };
}

// ── Stage 3: Extract ──

interface ExtractStageOut {
  extractions: ExtractResult[];
  blockedExtractions: ExtractResult[];
}

async function runExtractStage(
  p: PipelineCtx,
  successPages: FetchedPage[],
  pages: FetchedPage[],
): Promise<ExtractStageOut> {
  p.onProgress?.(
    progress("extract", `Extracting from ${successPages.length} pages...`, {
      current: 0,
      total: successPages.length,
    }),
  );

  // Extract pages through a bounded worker pool (settings.extractionConcurrency)
  // rather than all at once. With maxUrls up to 16, an unbounded Promise.all
  // would fire that many simultaneous LLM calls and trip provider rate limits.
  // Progress is emitted on each page's completion (via onSettled), so the
  // sub-progress bar reflects real work done instead of jumping to N/N at launch.
  let extractDone = 0;
  const rawExtractions = await mapWithConcurrency(
    successPages,
    p.settings.extractionConcurrency,
    async (page) => {
      // Space out concurrent extract calls when a throttle is configured.
      await p.gate(p.signal);
      return extractPage(p, page);
    },
    {
      signal: p.signal,
      onSettled: (page) => {
        extractDone++;
        p.onProgress?.(
          progress(
            "extract",
            `Page ${extractDone}/${successPages.length}: ${(page.title || page.url).slice(0, 40)}...`,
            { current: extractDone, total: successPages.length },
          ),
        );
      },
    },
  );

  // Indices left unrun by an aborted signal become a failed extraction so the
  // result array stays aligned with successPages and fully typed.
  const extractions: ExtractResult[] = rawExtractions.map(
    (e, i) =>
      e ?? {
        url: successPages[i].url,
        title: successPages[i].title,
        extraction: "",
        sourceType: "unknown",
        currentness: "unknown",
        status: "failed" as const,
        ...(successPages[i].inferred ? { inferred: true as const } : {}),
        ...(successPages[i].originalReference
          ? { originalReference: successPages[i].originalReference }
          : {}),
        ...(successPages[i].alternateUrl ? { alternateUrl: successPages[i].alternateUrl } : {}),
        ...(successPages[i].finalUrl ? { finalUrl: successPages[i].finalUrl } : {}),
        ...(successPages[i].assetType ? { assetType: successPages[i].assetType } : {}),
        ...(successPages[i].contentType ? { contentType: successPages[i].contentType } : {}),
      },
  );

  // Include failed pages as blocked extractions
  const blockedExtractions: ExtractResult[] = pages
    .filter((pg) => pg.status !== "success")
    .map((pg) => ({
      url: pg.url,
      title: "",
      extraction: "",
      sourceType: "unknown",
      currentness: "unknown",
      status: "blocked" as const,
      ...(pg.inferred ? { inferred: true as const } : {}),
      ...(pg.originalReference ? { originalReference: pg.originalReference } : {}),
      ...(pg.alternateUrl ? { alternateUrl: pg.alternateUrl } : {}),
      ...(pg.finalUrl ? { finalUrl: pg.finalUrl } : {}),
      ...(pg.contentType ? { contentType: pg.contentType } : {}),
    }));

  // Telemetry: tally extract outcomes and char throughput. Input chars are
  // the truncated page content actually fed to each extraction; output is
  // the returned extraction text. Blocked pages contributed no input.
  const succeededExtr = extractions.filter((e) => e.status === "success");
  const failedExtr = extractions.length - succeededExtr.length;
  // Failure classification aggregates after the worker pool settles from the
  // structured per-result kind, never from re-parsing error text (a quota
  // message containing "exhausted" must not count as budget exhaustion).
  let budgetExhaustedFailures = 0;
  for (const e of extractions) {
    if (e.status === "failed" && e.failureKind === "budget") budgetExhaustedFailures += 1;
  }
  const truncatedCount = succeededExtr.filter((e) => e.truncated).length;
  // Route provider: record it when every page that observed one agrees.
  const routeProviders = new Set(
    extractions.filter((e) => e.routeProvider).map((e) => e.routeProvider),
  );
  // Input chars are not retained per-page post-call; approximate from the
  // pages that were fed in (capped at extractMaxChars each).
  const totalIn = successPages.reduce(
    (sum, pg) => sum + Math.min(pg.content.length, p.settings.extractMaxChars),
    0,
  );
  const totalOut = succeededExtr.reduce((sum, e) => sum + e.extraction.length, 0);
  p.tel?.recordExtract({
    model: `${p.extractConfig.provider}/${p.extractConfig.model}`,
    succeeded: succeededExtr.length,
    failed: failedExtr,
    totalInputCharsApprox: totalIn,
    totalOutputChars: totalOut,
    ...(truncatedCount > 0 ? { truncated: truncatedCount } : {}),
    ...(p.budgetRetries.extract > 0 ? { budgetRetries: p.budgetRetries.extract } : {}),
    ...(failedExtr > 0
      ? {
          failureReasons: {
            budgetExhausted: budgetExhaustedFailures,
            other: failedExtr - budgetExhaustedFailures,
          },
        }
      : {}),
    ...(routeProviders.size === 1 ? { provider: [...routeProviders][0] } : {}),
  });

  return { extractions, blockedExtractions };
}

// ── Stage 4: Collate + cache write ──

async function runCollateStage(
  p: PipelineCtx,
  searchResult: string,
  succeededExtractions: ExtractResult[],
  identity: SourceIdentity,
): Promise<string> {
  // The collation model's input budget binds, not the extraction output cap:
  // decide what it receives from the extractions' actual sizes. Trimming
  // applies only to the text sent to the model; the saved extractions are
  // written from the untouched results and the notice names each full file.
  const budget = planCollationBudget(
    succeededExtractions.map((ext, index) => ({
      url: ext.url,
      text: ext.extraction,
      overheadChars: collationSourceOverheadChars(ext, index + 1),
      ...(inferredSource(ext) ? { inferred: true } : {}),
    })),
    {
      budgetTokens: p.settings.collationInputBudgetTokens,
      sourceMaxTokens: p.settings.collationSourceMaxTokens,
    },
  );
  const evidence = succeededExtractions.map((ext, index) => ({
    ...ext,
    sourceNumber: index + 1,
    extraction: budget.sources[index]?.text ?? ext.extraction,
  }));
  const inputBudget = deliveredInputBudget(budget, evidence);
  const suppliedSourceNumbers = new Set(
    evidenceExtractions(evidence).map((ext) => ext.sourceNumber ?? 0),
  );
  if (suppliedSourceNumbers.size === 0) {
    throw new CollationNoEvidenceError(COLLATION_NO_EVIDENCE_MESSAGE, inputBudget);
  }

  // Build collation prompt (no files written yet — lock is never held
  // across the LLM call). File references use the shared run identity and
  // are resolved when cache files are written.
  const collationUserMsg = buildCollationMessage(
    p.params.query,
    p.cachePath,
    searchResult,
    evidence,
    identity,
  );

  throwIfAborted(p.signal);
  try {
    return await collateTrimmedEvidence(p, collationUserMsg, succeededExtractions, identity, {
      budget,
      evidence,
      inputBudget,
      suppliedSourceNumbers,
    });
  } catch (error) {
    // A failure after trimming keeps the trim on record: the report and
    // telemetry must say what the model was not sent (round-2 DS-F3).
    if (budget.trims.length === 0 || p.signal?.aborted) throw error;
    throw new CollationTrimmedInputError(
      errMsg(error),
      inputBudget,
      formatCollationTrimNotice(budget, identity, p.cachePath, inputBudget.charsAfter),
      { cause: error },
    );
  }
}

async function collateTrimmedEvidence(
  p: PipelineCtx,
  collationUserMsg: string,
  succeededExtractions: ExtractResult[],
  identity: SourceIdentity,
  plan: {
    budget: CollationBudgetPlan;
    evidence: ExtractResult[];
    inputBudget: CollationInputBudgetDetails;
    suppliedSourceNumbers: Set<number>;
  },
): Promise<string> {
  const { budget, evidence, inputBudget, suppliedSourceNumbers } = plan;
  // A truncated synthesis is retried too: one collation call is cheap next to
  // the extractions it would otherwise summarise incompletely.
  const chosen = await completeWithBudgetRetry(
    p,
    "collate",
    {
      model: p.collateConfig,
      systemPrompt: COLLATION_SYSTEM_PROMPT,
      userMessage: collationUserMsg,
      maxTokens: p.settings.collationMaxTokens,
      signal: p.signal,
      retry: p.retry,
      timeoutMs: p.settings.llmTimeoutMs,
      onRetryNotice: (msg) => p.onProgress?.(progress("collate", msg)),
    },
    true,
  );
  // Any candidate can contain an invalid or cut-off citation. Keep trying
  // ranked alternatives, but preserve the preferred candidate's diagnostic
  // if none validates.
  let { completion, maxTokens } = chosen;
  const alternatives = [...chosen.alternatives];
  let firstFailure: { error: unknown } | undefined;
  const rejected: NonNullable<PipelineCtx["rejectedSyntheses"]> = [];
  let collation: string;
  while (true) {
    try {
      collation = finalizeCollation(
        completion.text,
        p.cachePath,
        succeededExtractions,
        identity,
        "fetched",
        suppliedSourceNumbers,
        evidence,
      );
      break;
    } catch (error) {
      firstFailure ??= { error };
      if (completion.text.trim()) {
        rejected.push({ text: completion.text, reason: errMsg(error), maxTokens });
      }
      const next = alternatives.shift();
      if (!next) {
        p.rejectedSyntheses = rejected;
        throw firstFailure.error;
      }
      ({ completion, maxTokens } = next);
    }
  }
  const { text, routeProvider } = completion;

  // A synthesis cut off by the output cap still commits, but the reader must
  // know it is incomplete rather than assume a clean ending.
  const collateTruncated = completionTruncated(completion, maxTokens);
  if (collateTruncated) {
    // Advice past the ceiling would be impossible to follow: there is no
    // larger cap to raise.
    collation +=
      maxTokens > p.settings.collationMaxTokens
        ? `\n\n> ⚠ Collation output reached its cap (${maxTokens} tokens, after a retry at a larger cap); ` +
          `the synthesis may be cut off mid-sentence. Re-run, or choose a collation model that reasons less, if completeness matters.`
        : p.budgetRetries.collate > 0
          ? `\n\n> ⚠ Collation output reached its cap (${maxTokens} tokens); a retry at a larger cap ran but did not return a better answer. ` +
            `The synthesis may be cut off mid-sentence. Re-run, or choose a collation model that reasons less, if completeness matters.`
          : p.settings.collationMaxTokens >= MAX_OUTPUT_TOKENS
            ? `\n\n> ⚠ Collation output reached its cap (${maxTokens} tokens), which is already the maximum the settings accept; ` +
              `the synthesis may be cut off mid-sentence. Re-run, or choose a collation model that reasons less, if completeness matters.`
            : `\n\n> ⚠ Collation output reached its cap (${maxTokens} tokens); ` +
              `the synthesis may be cut off mid-sentence. Raise collationMaxTokens or re-run if completeness matters.`;
  }

  // Say what the collation model did not receive, and where the full text is.
  if (budget.trims.length > 0) {
    collation += formatCollationTrimNotice(budget, identity, p.cachePath, inputBudget.charsAfter);
  }

  p.tel?.recordCollate({
    model: `${p.collateConfig.provider}/${p.collateConfig.model}`,
    summaryChars: text.trim().length,
    ...(collateTruncated ? { truncated: true } : {}),
    ...(p.budgetRetries.collate > 0
      ? { budgetRetried: true, budgetRetries: p.budgetRetries.collate }
      : {}),
    ...(budget.trims.length > 0 ? { inputBudget } : {}),
    ...(routeProvider ? { provider: routeProvider } : {}),
  });

  return collation;
}

interface LlmsDownloads {
  staging?: string;
  abort: AbortController;
  futures: Array<Promise<string | null>>;
}

/**
 * Start llms-full downloads to a unique per-run staging dir. Network I/O
 * never happens under the cache lock. The staging dir is unique to this run
 * so concurrent same-query runs never interleave their downloads.
 */
async function startLlmsFullDownloads(
  p: PipelineCtx,
  successPages: FetchedPage[],
): Promise<LlmsDownloads> {
  const abort = new AbortController();
  if (p.settings.disableLlmsFullDiscovery) return { abort, futures: [] };
  throwIfAborted(p.signal);
  let staging: string;
  try {
    await mkdir(p.paths.stagingRoot, { recursive: true });
    staging = await mkdtemp(join(p.paths.stagingRoot, "llms-"));
  } catch (error) {
    throwIfAborted(p.signal);
    p.logger.error(`Documentation staging setup failed: ${errMsg(error)}`);
    return { abort, futures: [] };
  }
  const signal = p.signal ? AbortSignal.any([p.signal, abort.signal]) : abort.signal;
  let futures: Array<Promise<string | null>> = [];
  {
    const sampleUrlByHost = new Map<string, string>();
    for (const pg of successPages) {
      try {
        const h = new URL(pg.url).hostname;
        if (!sampleUrlByHost.has(h)) sampleUrlByHost.set(h, pg.url);
      } catch {
        /* skip malformed URLs */
      }
    }
    futures = [...sampleUrlByHost.values()].map((sampleUrl) =>
      Promise.resolve()
        .then(() =>
          p.dependencies.downloadLlmsFullToCache(
            sampleUrl,
            staging,
            signal,
            undefined,
            p.settings.httpProxy,
          ),
        )
        .catch(() => null),
    );
  }
  return { staging, abort, futures };
}

/**
 * Write cache artefacts under the per-cache-path lock (only local file I/O
 * happens under the lock; it serialises two concurrent same-query runs),
 * then commit any remaining llms-full downloads under a second short lock.
 * A previous run's artefact set is archived to a numbered sibling folder
 * before `writeCacheFiles` commits this run's set, preserving supplementary
 * llms-full downloads.
 */
async function writeCacheArtifacts(
  p: PipelineCtx,
  allExtractions: ExtractResult[],
  fetched: FetchStageOut,
  searchResult: string,
  collation: string,
  llms: LlmsDownloads,
  identity: SourceIdentity,
  outcome: TelemetryOutcome,
): Promise<boolean> {
  await p.dependencies.beforeCacheLock?.(p.physicalCachePath);
  const committed = await withLock(
    cacheLockDir(p.physicalCachePath),
    async () => {
      // A run without a synthesis never displaces a successful report, which
      // may have been committed by a concurrent run since collation began.
      // An earlier failure report is replaced (and archived) as usual.
      if (outcome !== "completed") {
        // Fail closed: only a confirmed absence lets this run commit; an
        // unreadable report is preserved as if it were successful.
        const prior = await readFile(join(p.physicalCachePath, "report.md"), "utf8").catch(
          (error: NodeJS.ErrnoException) => (error.code === "ENOENT" ? undefined : ""),
        );
        if (prior !== undefined && !isCollationFailureReport(prior)) {
          await writePreservedAttempt(p, outcome);
          return false;
        }
      }

      // Archive a previous run's artefact set to a numbered sibling folder
      // (<cachePath>.1, .2, ...) before this run commits, with the new
      // results already in hand. A failed run reaches this point only when
      // no successful report is in place, so it archives at most an earlier
      // failure report; a successful one is preserved above.
      // Archiving is best-effort: a failure falls back to in-place
      // replacement rather than discarding the completed run.
      await rotateCacheArtefacts(p.physicalCachePath, p.cachePath).catch((error) => {
        p.logger.error(`Cache archive failed: ${errMsg(error)}`);
      });

      // Write cache files (staging-based per-file atomic replacement under
      // the lock; obsolete artefacts from a previous run are pruned)
      await writeCacheFiles(
        p.physicalCachePath,
        allExtractions,
        fetched.successPages,
        searchResult,
        p.params.query,
        identity,
      );

      await writeRejectedSyntheses(p, p.physicalCachePath);
      // Write report (atomic via temp-file + rename)
      await writeReportFile(
        p.physicalCachePath,
        p.params.query,
        collation + rejectedSynthesisNotice(p),
        allExtractions,
        fetched.pages,
        p.cachePath,
        identity,
        true,
      );

      // Write telemetry sidecar (atomic via temp-file + rename)
      await writeTelemetrySidecar(p.logger, p.tel, p.physicalCachePath, outcome);

      // Atomic index update under a separate lock scoped to the cache
      // directory. Different cache paths contend only on this short
      // index update, not on the per-cache-path bulk writes. A run without
      // a synthesis is not indexed, and any stale entry left for this slug
      // (for example by an interrupted earlier run) is removed: cache
      // suggest must never offer a failure report as related research
      // (deepseek F3). removeIndexEntry never creates the index file.
      if (outcome !== "completed") {
        await withLock(
          indexLockDir(p.paths.cacheRoot),
          async () => {
            const slug = p.physicalCachePath.split("/").pop() ?? p.physicalCachePath;
            await removeIndexEntry(p.paths.cacheRoot, slug);
          },
          p.signal,
        );
        return true;
      }
      await withLock(
        indexLockDir(p.paths.cacheRoot),
        async () => {
          const slug = p.physicalCachePath.split("/").pop() ?? p.physicalCachePath;
          await updateIndex(p.paths.cacheRoot, slug, p.params.query);
        },
        p.signal,
      );
      return true;
    },
    p.signal,
  );
  if (!committed) return false;

  // Await remaining llms-full downloads outside the lock. Commit their
  // staged files under the cache lock so concurrent same-query runs cannot
  // interleave writes to identical llms-full filenames.
  await Promise.all(llms.futures);
  throwIfAborted(p.signal);
  if (llms.staging) {
    const staging = llms.staging;
    await withLock(
      cacheLockDir(p.physicalCachePath),
      () => flushLlmsStaging(staging, join(p.physicalCachePath, "sources")),
      p.signal,
    );
  }
  return true;
}

// ── Stage 5: Cache suggest ──

/**
 * Find related previous searches and return the formatted appendix (empty
 * string when none). Runs after the pipeline completes and after both cache
 * and index locks are released. Uses the extract model as a cheap LLM judge.
 * Never blocks the main result — graceful degradation on failure. No lock is
 * needed: reading .index.json is safe (atomic rename on write) and the only
 * writer (updateIndex) has already released the index lock.
 */
async function runCacheSuggestStage(p: PipelineCtx): Promise<string> {
  p.onProgress?.(progress("cache", "Checking related cached research..."));
  throwIfAborted(p.signal);

  const currentSlug = p.cachePath.split("/").pop() ?? "";
  let suggestionsAppendix = "";
  // Tracked for telemetry regardless of whether the judge runs.
  let cacheSuggestRan = false;
  let cacheSuggestSurfaced = 0;
  let cacheSuggestSlugs: string[] = [];
  // True when the judge response was empty or unparseable, distinguishing a
  // failed judge from a valid zero-match answer (both surface zero entries).
  let cacheSuggestDegraded: boolean | undefined;
  // True once the judge call is actually issued; a throw after that point is
  // a failed judge (adapter exhaustion, timeout, transport), not "no previous
  // searches to compare against".
  let judgeAttempted = false;
  try {
    const index = await readIndex(p.paths.cacheRoot);
    // Only run judge if there are other searches to compare against
    if (index.searches.some((e) => e.slug !== currentSlug)) {
      judgeAttempted = true;
      const indexText = formatIndexForJudge(index, currentSlug);
      const judgeUserMsg = `Current query: "${p.params.query}"\n\nPrevious searches:\n${indexText}`;
      // 2,000 since 0.20.0: the extract model's hidden reasoning counts
      // against the cap, and 500 let reasoning-only answers masquerade as a
      // valid "no related searches" verdict.
      const { text: judgeResponse } = await p.models.complete({
        model: p.extractConfig,
        systemPrompt: CACHE_SUGGEST_PROMPT,
        userMessage: judgeUserMsg,
        maxTokens: 2000,
        signal: p.signal,
        retry: p.retry,
        timeoutMs: p.settings.llmTimeoutMs,
        onRetryNotice: (msg) => p.onProgress?.(progress("cache", msg)),
      });
      if (!judgeResponse.trim() || !isWellFormedJudgeResponse(judgeResponse)) {
        cacheSuggestDegraded = true;
        p.logger.error(
          `Cache suggest judge returned ${judgeResponse.trim() ? "an unparseable" : "an empty"} response; treating as zero matches`,
        );
      }
      const matches = parseJudgeResponse(judgeResponse, index, currentSlug);
      cacheSuggestRan = true;
      cacheSuggestSurfaced = matches.length;
      cacheSuggestSlugs = matches.map((m) => m.entry.slug);
      suggestionsAppendix = formatCacheSuggestions(matches, p.paths.cacheDisplayRoot);
    }
  } catch (err: unknown) {
    throwIfAborted(p.signal);
    // Cache suggest is purely additive; user cancellation still propagates.
    // A judge that was issued and threw is degraded, never a valid zero-match.
    if (judgeAttempted) cacheSuggestDegraded = true;
    p.logger.error(`Cache suggest failed: ${errMsg(err)}`);
  }

  p.tel?.recordCacheSuggest({
    ran: cacheSuggestRan,
    surfaced: cacheSuggestSurfaced,
    slugs: cacheSuggestSlugs,
    ...(cacheSuggestDegraded ? { degraded: true } : {}),
  });

  return suggestionsAppendix;
}

/**
 * Shared degraded-exit path: stamp the outcome, write the sidecar, and return
 * the fallback result. The search-stage early returns (no-links,
 * fetch-failed) go through here so the degraded exits stay structurally
 * uniform; the extraction-failed exit writes its kept-pages artefact set via
 * writeCacheArtifacts instead, because it has fetched pages to save.
 *
 * A previous successful run of the same query is preserved untouched (report,
 * extractions, numbered sources and index entry): a degraded refresh never
 * displaces a good report or its metadata. Failed attempts receive separate
 * sidecars under attempts/, still visible to scripts/analyze-sessions.sh. When
 * no previous report exists, partial artefacts from an interrupted write are
 * cleared and any dangling index entry removed, so a fresh degraded query
 * leaves only its telemetry sidecar.
 *
 * With telemetry disabled and no previous cache directory, nothing is written
 * at all: acquiring the cache lock would create the directory, and a fresh
 * degraded query must leave no artefacts.
 */
async function degradedReturn(
  p: PipelineCtx,
  outcome: TelemetryOutcome,
  message: string,
  details: Record<string, unknown>,
): Promise<OperationResult> {
  throwIfAborted(p.signal);
  const dirExists = await stat(p.physicalCachePath)
    .then(() => true)
    .catch(() => false);
  if (!p.tel && !dirExists) return { text: message, details, outcome };
  try {
    await withLock(
      cacheLockDir(p.physicalCachePath),
      async () => {
        const hasReport = await stat(join(p.physicalCachePath, "report.md"))
          .then(() => true)
          .catch(() => false);
        if (!hasReport) {
          await clearCacheArtefacts(p.physicalCachePath).catch((error) => {
            p.logger.error(`Cache artefact cleanup failed: ${errMsg(error)}`);
          });
          // Index removal follows the lock-ordering invariant: the index
          // lock is only ever taken while already holding the cache lock,
          // mirroring the successful path's updateIndex placement.
          await withLock(
            indexLockDir(p.paths.cacheRoot),
            async () => {
              const slug = p.physicalCachePath.split("/").pop() ?? p.physicalCachePath;
              await removeIndexEntry(p.paths.cacheRoot, slug);
            },
            p.signal,
          );
        }
        if (hasReport) await writePreservedAttempt(p, outcome);
        else await writeTelemetrySidecar(p.logger, p.tel, p.physicalCachePath, outcome);
      },
      p.signal,
    );
  } catch (error) {
    throwIfAborted(p.signal);
    p.logger.error(`Telemetry write failed: ${errMsg(error)}`);
  }
  return { text: message, details, outcome };
}

/**
 * Move completed llms-full downloads from a per-run staging directory
 * into the target cache sources directory. Best-effort: errors on
 * individual files are logged and skipped. Each call happens while holding
 * the cache lock; the staging directory is unique per run and the lock
 * serialises writes to matching destination filenames.
 */
async function flushLlmsStaging(staging: string, targetDir: string): Promise<void> {
  const stagingSources = join(staging, "sources");
  let entries: string[];
  try {
    entries = await readdir(stagingSources);
  } catch {
    return; // No staging dir yet (downloads haven't completed)
  }
  await mkdir(targetDir, { recursive: true });
  for (const name of entries) {
    if (!name.startsWith("llms-full-")) continue;
    const src = join(stagingSources, name);
    const dst = join(targetDir, name);
    try {
      const data = await readFile(src, "utf-8");
      await writeFile(dst, data);
    } catch {
      // Best-effort: skip files that can't be read or written.
    }
  }
}

/**
 * Write the telemetry sidecar into `cachePath`, stamping the run `outcome`.
 * Creates the directory (degraded paths reach this before writeCacheFiles does)
 * and never throws: a write failure is logged and swallowed so it cannot alter
 * the pipeline result. No-op when telemetry is disabled (`tel === null`).
 */
async function writeLockedTelemetry(p: PipelineCtx, outcome: TelemetryOutcome): Promise<void> {
  if (!p.tel) return;
  try {
    await withLock(
      cacheLockDir(p.physicalCachePath),
      () => writeTelemetrySidecar(p.logger, p.tel, p.physicalCachePath, outcome),
      p.signal,
    );
  } catch (error) {
    throwIfAborted(p.signal);
    p.logger.error(`Telemetry write failed: ${errMsg(error)}`);
  }
}

function rejectedSynthesisNotice(p: PipelineCtx): string {
  return p.rejectedSynthesisPath
    ? `\n\nRejected synthesis is saved for diagnosis only: ${p.rejectedSynthesisPath}. It failed source validation and is not accepted evidence.`
    : "";
}

async function writeRejectedSyntheses(p: PipelineCtx, directory: string): Promise<void> {
  if (!p.rejectedSyntheses?.length) return;
  try {
    await writeFile(
      join(directory, "rejected-synthesis.json"),
      JSON.stringify({ schemaVersion: 1, accepted: false, candidates: p.rejectedSyntheses }, null, 2) + "\n",
      "utf8",
    );
    p.rejectedSynthesisPath = `${displayCachePath(p.paths, directory)}/rejected-synthesis.json`;
  } catch (error) {
    p.logger.error(`Rejected synthesis diagnostic write failed: ${errMsg(error)}`);
  }
}

/** Keep failed-attempt diagnostics separate from the report being preserved. */
async function writePreservedAttempt(p: PipelineCtx, outcome: TelemetryOutcome): Promise<void> {
  if (!p.tel && !p.rejectedSyntheses?.length) return;
  try {
    const attempts = join(p.physicalCachePath, "attempts");
    await mkdir(attempts, { recursive: true });
    const directory = await mkdtemp(join(attempts, "attempt-"));
    await writeTelemetrySidecar(p.logger, p.tel, directory, outcome);
    await writeRejectedSyntheses(p, directory);
  } catch (error) {
    p.logger.error(`Failed attempt diagnostic write failed: ${errMsg(error)}`);
  }
}

async function writeTelemetrySidecar(
  logger: OperationContext["logger"],
  tel: TelemetryBuilder | null,
  cachePath: string,
  outcome: TelemetryOutcome,
): Promise<void> {
  if (!tel) return;
  tel.setOutcome(outcome);
  try {
    await mkdir(cachePath, { recursive: true });
    await writeTelemetry(cachePath, tel.finalize());
  } catch (err: unknown) {
    logger.error(`Telemetry write failed: ${errMsg(err)}`);
  }
}

/**
 * Extract query-relevant content from a single page.
 */
async function extractPage(p: PipelineCtx, page: FetchedPage): Promise<ExtractResult> {
  throwIfAborted(p.signal);
  // Set inside try while usage is in scope; read by the catch to classify.
  let exhausted: boolean | undefined;
  let routeProvider: string | undefined;
  try {
    const userMessage = buildExtractionMessage(
      page.content,
      p.params.query,
      p.params.focusPrompt,
      p.settings.extractMaxChars,
    );

    const { completion, maxTokens } = await completeWithBudgetRetry(
      p,
      "extract",
      {
        model: p.extractConfig,
        systemPrompt: EXTRACTION_SYSTEM_PROMPT,
        userMessage,
        maxTokens: p.settings.extractionMaxTokens,
        signal: p.signal,
        retry: p.retry,
        timeoutMs: p.settings.llmTimeoutMs,
        onRetryNotice: (msg) => p.onProgress?.(progress("extract", msg)),
      },
      false,
    );
    const { text: extraction, usage } = completion;
    routeProvider = completion.routeProvider;

    // Classification signal, computed while usage is in scope so the catch
    // below can label the failure without re-parsing error text.
    exhausted = completionTruncated(completion, maxTokens);
    if (!extraction.trim()) {
      // A 200 response can still carry zero visible text: on reasoning models
      // the completion cap covers hidden reasoning tokens, and an exhausted
      // call spends the whole budget before any visible output. Advice is
      // conditional on the reported budget so a healthy budget is not told to
      // raise its cap.
      const usageNote = usage?.output != null
        ? ` (${usage.output}/${maxTokens} output tokens` +
          (usage.reasoning ? `, ${usage.reasoning} hidden reasoning` : "") + ")"
        : "";
      throw new Error(
        exhausted
          ? `Extraction returned no visible text${usageNote}; the output budget was exhausted. Review extractionMaxTokens or choose a model with a smaller reasoning requirement.`
          : `Extraction returned no visible text${usageNote}. The output budget was not reported exhausted; inspect the model response before retrying.`,
      );
    }
    const firstLine = extraction.split("\n")[0] ?? "";
    return {
      url: page.url,
      title: page.title,
      extraction,
      sourceType: inferSourceType(firstLine),
      currentness: inferCurrentness(firstLine),
      status: "success",
      // Nonempty output cut off by the cap: kept, but flagged so the report
      // and telemetry can say so. Missing usage never flags.
      truncated: exhausted || undefined,
      ...(routeProvider ? { routeProvider } : {}),
      ...(page.inferred ? { inferred: true as const } : {}),
      ...(page.originalReference ? { originalReference: page.originalReference } : {}),
      ...(page.alternateUrl ? { alternateUrl: page.alternateUrl } : {}),
      ...(page.finalUrl ? { finalUrl: page.finalUrl } : {}),
      ...(page.assetType ? { assetType: page.assetType } : {}),
      ...(page.contentType ? { contentType: page.contentType } : {}),
    };
  } catch (err: unknown) {
    throwIfAborted(p.signal);
    // Log extraction error but don't fail the whole pipeline. The bounded,
    // single-line reason is retained on the result so the report and tool
    // result can explain the failure instead of a bare "Extraction failed";
    // provider bodies often carry newlines and markup that would break both.
    const message = failureDetail(errMsg(err)) || "extraction failed";
    p.logger.error(`Extraction failed for ${page.url}: ${message}`);
    return {
      url: page.url,
      title: page.title,
      extraction: "",
      sourceType: "unknown",
      currentness: "unknown",
      status: "failed",
      error: message,
      // Structured classification: usage-based when the call completed, else
      // a match against our own adapter messages (never free provider text).
      failureKind: exhausted === true || isOutputBudgetExhausted(err) ? "budget" : "other",
      ...(routeProvider ? { routeProvider } : {}),
      ...(page.inferred ? { inferred: true as const } : {}),
      ...(page.originalReference ? { originalReference: page.originalReference } : {}),
      ...(page.alternateUrl ? { alternateUrl: page.alternateUrl } : {}),
      ...(page.finalUrl ? { finalUrl: page.finalUrl } : {}),
      ...(page.assetType ? { assetType: page.assetType } : {}),
      ...(page.contentType ? { contentType: page.contentType } : {}),
    };
  }
}

/** A failure reason closed as a sentence, so further text can follow it. */
function asSentence(reason: string): string {
  return /[.!?…]$/.test(reason) ? reason : `${reason}.`;
}

/**
 * One model call, retried with a doubled output budget when hidden reasoning
 * spent the cap before any visible text (or, when `retryTruncated` is set,
 * before the text finished). The number of retries is the
 * `outputBudgetRetries` setting (0 disables it), a retry's cap never exceeds
 * the shared ceiling or the model's output limit, a near-duplicate cap is
 * not retried, and each attempt's timeout scales with the budget it is
 * given so a retry that needs its allowance is not timed out first. Reasoning
 * models on some serving routes ignore the requested effort and the route is
 * chosen per call, so the same cap is never retried: the shared policy leaves
 * this outcome to the operation.
 */
async function completeWithBudgetRetry(
  p: PipelineCtx,
  stage: "extract" | "collate",
  request: ModelRequest & { maxTokens: number },
  retryTruncated: boolean,
): Promise<BudgetedCompletion & { alternatives: BudgetedCompletion[] }> {
  const configuredCap = request.maxTokens;
  let reported: number | undefined;
  try {
    reported = p.models.outputLimit?.(request.model);
  } catch {
    // A limit lookup is advisory: an unreadable entry leaves the shared ceiling.
    reported = undefined;
  }
  // Normalised once, so the ceiling and every message agree on the limit.
  const modelLimit =
    reported !== undefined && Number.isInteger(reported) && reported > 0 ? reported : undefined;
  const ceiling = retryCeiling(configuredCap, modelLimit);
  // The model limit binds only below the shared maximum; at 128,000 no model
  // can be given more, so the maximum is the bound to report.
  const limitBinds = modelLimit !== undefined && modelLimit < MAX_OUTPUT_TOKENS && ceiling === modelLimit;
  const caps = budgetCaps(configuredCap, p.settings.outputBudgetRetries, ceiling);
  const attempt = (cap: number): ModelRequest & { maxTokens: number } => ({
    ...request,
    maxTokens: cap,
    timeoutMs: attemptTimeoutMs(p.settings.llmTimeoutMs, configuredCap, cap),
  });
  // Keep every usable answer in case a larger attempt is worse. Every
  // configured attempt runs while only truncated text is available; once
  // calls stop, validation tries completed candidates before truncated ones.
  const candidates: BudgetedCompletion[] = [];
  const best = (): (BudgetedCompletion & { alternatives: BudgetedCompletion[] }) | undefined => {
    const [preferred, ...alternatives] = rankBudgetedCompletions(candidates);
    return preferred ? { ...preferred, alternatives } : undefined;
  };

  let lastBudgetError: unknown;
  let lastBudgetUsage: ModelUsage | undefined;
  for (const [index, cap] of caps.entries()) {
    throwIfAborted(p.signal);
    if (index > 0) {
      if (stage === "extract") p.budgetRetries.extract += 1;
      else p.budgetRetries.collate += 1;
      p.onProgress?.(
        progress(
          stage,
          `Output cap of ${caps[index - 1]} tokens reached; retrying with ${cap} tokens`,
        ),
      );
      // The retry is a further extract call, so it observes the configured throttle.
      if (stage === "extract") await p.gate(p.signal);
    }
    try {
      const completion = await p.models.complete(attempt(cap));
      const spent = completionTruncated(completion, cap);
      if (spent) {
        lastBudgetError = undefined;
        lastBudgetUsage = completion.usage;
      }
      if (!spent || (completion.text.trim() && !retryTruncated)) {
        // Stop requesting retries, but rank all usable output before
        // validation, including this completed response.
        if (completion.text.trim()) candidates.push({ completion, maxTokens: cap });
        return best() ?? { completion, maxTokens: cap, alternatives: [] };
      }
      // Usable but cut off: keep it and let the next configured cap try for a
      // complete answer. The longest kept answer wins if none completes.
      if (completion.text.trim()) candidates.push({ completion, maxTokens: cap });
    } catch (error) {
      throwIfAborted(p.signal);
      if (!isOutputBudgetExhausted(error)) {
        // Keep paid, usable output when a larger attempt fails (for example a
        // model whose output limit is below the doubled cap).
        const kept = best();
        if (kept) {
          p.logger.error(
            `Retry with ${cap} output tokens failed: ${failureDetail(errMsg(error))}`,
          );
          return kept;
        }
        throw error;
      }
      // Budget exhausted with no visible text: the next cap is the only
      // remaining remedy, so continue. Keep the adapter's diagnostic too:
      // its output and hidden-reasoning counts explain the exhaustion.
      lastBudgetError = error;
      lastBudgetUsage = undefined;
    }
  }

  const kept = best();
  if (kept) return kept;
  // Report the cap actually used: a configured cap above the ceiling was
  // clamped, and naming the unclamped value would contradict the request.
  const effectiveCap = caps[0];
  const setting = stage === "extract" ? "extractionMaxTokens" : "collationMaxTokens";
  const { counts, adapterText } = budgetDiagnosticParts(lastBudgetError, lastBudgetUsage);
  if (caps.length === 1) {
    // Name the real reason no retry ran, then the measured counts, then a
    // remedy that can change the outcome. Research cuts a reason at 300
    // characters from the end, so adapter text goes last.
    const capReached = `Output cap of ${effectiveCap} tokens reached without visible text; `;
    let reason: string;
    let remedy: string;
    if (modelLimit !== undefined && effectiveCap >= modelLimit) {
      // Only the spent attempt is known, not where the model stopped: the
      // recorded limit can be a host default below what the provider allows.
      reason =
        `No visible text within the ${effectiveCap}-token cap; the model's output limit of ` +
        `${modelLimit} tokens is at or below the cap, so no larger retry was made.`;
      remedy =
        modelLimit < MAX_OUTPUT_TOKENS && p.identity.adapter === "pi"
          ? NATIVE_LIMIT_REMEDY
          : " Choose a model that reasons less, or re-run.";
    } else if (effectiveCap >= MAX_OUTPUT_TOKENS) {
      reason = `${capReached}the cap is already at the ${MAX_OUTPUT_TOKENS}-token maximum, so no larger retry is possible.`;
      remedy = " Choose a model that reasons less, or re-run.";
    } else if (
      p.settings.outputBudgetRetries === 0 &&
      budgetCaps(configuredCap, 1, ceiling).length > 1
    ) {
      // Only when enabling retries would actually issue one.
      reason = `${capReached}budget retries are disabled (outputBudgetRetries is 0).`;
      remedy = ` Raise outputBudgetRetries or ${setting}, or re-run.`;
    } else if (limitBinds) {
      reason = `${capReached}the model's output limit (${modelLimit} tokens) allows a retry under 25% larger, so none ran.`;
      // Above 102,400 no limit up to the maximum could allow a retry, so
      // one attempt at the limit is the only larger budget available.
      remedy =
        configuredCap * MIN_RETRY_GROWTH > MAX_OUTPUT_TOKENS
          ? ` Set ${setting} to ${modelLimit} for one attempt at the limit, or change model.`
          : p.identity.adapter === "pi"
            ? NATIVE_LIMIT_REMEDY
            : " Change model, or re-run.";
    } else {
      reason = `${capReached}the ${MAX_OUTPUT_TOKENS}-token maximum allows a retry under 25% larger, so none ran.`;
      remedy = ` Set ${setting} to ${MAX_OUTPUT_TOKENS} for one attempt at the maximum.`;
    }
    throw new OutputBudgetExhaustedError(reason + counts + remedy + adapterText);
  }
  throw bothBudgetsSpent(
    stage,
    effectiveCap,
    caps[caps.length - 1],
    caps.length - 1,
    lastBudgetError,
    lastBudgetUsage,
    // What stopped the schedule: the shared maximum was reached, or the model
    // limit set the ceiling and no further retry would have grown the last
    // cap enough to be issued. Otherwise the retry count ran out.
    // The limit is named when it prevented a larger attempt: it shortened the
    // schedule, or it leaves no room for a retry worth issuing.
    caps[caps.length - 1] >= MAX_OUTPUT_TOKENS
      ? { kind: "maximum" }
      : limitBinds &&
          modelLimit !== undefined &&
          (budgetCaps(configuredCap, p.settings.outputBudgetRetries, MAX_OUTPUT_TOKENS).at(-1)! >
            caps[caps.length - 1] ||
            modelLimit < caps[caps.length - 1] * MIN_RETRY_GROWTH)
        ? { kind: "limit", limit: modelLimit }
        : undefined,
    p.identity.adapter,
  );
}

/**
 * The last attempt's measured counts, or, when none were reported, the
 * adapter's own diagnostic. Callers place counts before their remedy and the
 * adapter text after it, so the 300-character cut takes adapter text first.
 */
function budgetDiagnosticParts(
  error: unknown,
  usage?: ModelUsage,
): { counts: string; adapterText: string } {
  if (usage?.output != null && usage.output > 0) {
    return {
      counts: ` Last attempt: ${usage.output} output tokens${
        usage.reasoning != null ? `, ${usage.reasoning} hidden reasoning` : ""
      }.`,
      adapterText: "",
    };
  }
  const found = errMsg(error).match(/([\d,]+) output tokens(?:, ([\d,]+) hidden reasoning)?/);
  if (found && Number(found[1].replaceAll(",", "")) > 0) {
    return {
      counts: ` Last attempt: ${found[1]} output tokens${found[2] ? `, ${found[2]} hidden reasoning` : ""}.`,
      adapterText: "",
    };
  }
  return {
    counts: "",
    adapterText: error === undefined ? "" : ` Adapter diagnostic: ${failureDetail(errMsg(error))}`,
  };
}

const BOTH_SPENT = "Output cap reached without visible text at ";

/** Native remedy when the recorded output limit binds: the limit lives in
 *  the host's model registry (models.json, or modelOverrides for a built-in
 *  model). The MCP catalogue limit has no override, so MCP omits it. */
const NATIVE_LIMIT_REMEDY = " Change model, or raise its maxTokens in models.json if the provider allows more.";

function bothBudgetsSpent(
  stage: "extract" | "collate",
  cap: number,
  maxTokens: number,
  retries: number,
  lastError?: unknown,
  lastUsage?: ModelUsage,
  bound?: { kind: "maximum" } | { kind: "limit"; limit: number },
  adapter: "pi" | "mcp" = "pi",
): OutputBudgetExhaustedError {
  const setting = stage === "extract" ? "extractionMaxTokens" : "collationMaxTokens";
  const attempts = retries === 1 ? "one retry" : `${retries} retries`;
  const reasoningCount = lastUsage?.reasoning ?? Number(
    errMsg(lastError).match(/([\d,]+) hidden reasoning/)?.[1].replaceAll(",", "") ?? 0,
  );
  const reasoningReported = reasoningCount > 0;
  const parts = budgetDiagnosticParts(lastError, lastUsage);
  const cause = reasoningReported
    ? "the model's hidden reasoning consumed every budget."
    : "the output budget was exhausted without visible text.";
  // At a bound a larger setting cannot produce a larger retry.
  const remedy =
    bound?.kind === "maximum"
      ? ` ${MAX_OUTPUT_TOKENS} is the maximum; choose a model that reasons less, or re-run.`
      : bound?.kind === "limit"
        ? adapter === "pi"
          ? ` Model limit (${bound.limit}) stops retries: change model or raise maxTokens in models.json.`
          : ` Model limit (${bound.limit}) stops retries: change model or re-run.`
        : ` Raise ${setting}, choose a model that reasons less for this stage, or re-run.`;
  return new OutputBudgetExhaustedError(
    `${BOTH_SPENT}${cap} tokens and again after ${attempts} up to ${maxTokens} tokens; ` +
      cause +
      // Measured counts before advice, adapter text last: research cuts a
      // reason at 300 characters from the end.
      parts.counts +
      remedy +
      parts.adapterText,
  );
}
