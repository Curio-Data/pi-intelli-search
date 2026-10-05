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
  parseJudgeResponse,
  formatCacheSuggestions,
  cacheLockDir,
  indexLockDir,
  withLock,
  updateIndex,
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
  throwIfAborted,
} from "../util.js";
import { TelemetryBuilder, writeTelemetry, type TelemetryOutcome } from "../telemetry.js";
import { mkdir, writeFile, rm, readdir, readFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import type { FetchedPage, ExtractResult, ModelConfig } from "../types.js";
import {
  appendDomainFilter,
  buildSearchPayloadPatch,
  buildExtractionMessage,
  buildCollationMessage,
  formatCacheAppendix,
} from "../messages.js";
import { progress } from "../progress.js";

/** Per-run I/O injection; no mutable global engine harness. */
export interface ResearchDependencies {
  fetchPages: typeof fetchPages;
  downloadLlmsFullToCache: typeof downloadLlmsFullToCache;
  /** Optional per-run filesystem seam for deterministic cleanup-failure tests. */
  removeStaging?: (path: string) => Promise<void>;
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
    return degradedReturn(
      p,
      "fetch-failed",
      `All ${search.urls.length} pages failed to fetch.\n\nSearch summary:\n${search.searchResult}`,
      {
        cachePath: "",
        urlsSearched: search.urls.length,
        pagesFetched: 0,
        pagesFailed: search.urls.length,
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

  // If no extractions produced useful content (all fetches failed or all
  // extraction LLM calls errored), return the search summary without
  // creating cache artifacts or running collation.
  if (succeededExtractions.length === 0) {
    const fetchFailed = extracted.blockedExtractions.length;
    const extractFailed = extracted.extractions.filter((e) => e.status === "failed").length;
    const reason =
      fetchFailed > 0
        ? `${fetchFailed} page(s) failed to fetch`
        : `${extractFailed} extraction(s) failed`;
    return degradedReturn(
      p,
      "extraction-failed",
      `${reason}. No content was extracted.\n\nSearch summary:\n${search.searchResult}`,
      {
        cachePath: "",
        urlsSearched: search.urls.length,
        pagesFetched: fetched.successPages.length,
        pagesFailed: fetched.pages.length - fetched.successPages.length,
      },
    );
  }

  const collation = await runCollateStage(p, search.searchResult, succeededExtractions);

  // Start llms-full downloads BEFORE acquiring any lock, then write cache
  // artifacts under the per-cache-path lock (only local file I/O there).
  throwIfAborted(p.signal);
  const llms = await startLlmsFullDownloads(p, fetched.successPages);
  try {
    await writeCacheArtifacts(p, allExtractions, fetched, search.searchResult, collation, llms);
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

  // ═══════════════════════════════════════════
  // Stage 5: Cache suggest — find related previous searches
  // ═══════════════════════════════════════════
  const suggestionsAppendix = await runCacheSuggestStage(p);

  // ── Telemetry sidecar refresh ──
  // The sidecar was already written under the cache lock with all core
  // stages recorded. Rewrite it now that cache-suggest data is available
  // so the final sidecar is complete. Atomic via temp-file + rename; a
  // failure is caught and logged, never surfaced to the pipeline.
  throwIfAborted(p.signal);
  await writeLockedTelemetry(p, "completed");

  // ═══════════════════════════════════════════
  // Return concise injection
  // ═══════════════════════════════════════════
  const failedCount = fetched.pages.length - fetched.successPages.length;
  const result =
    collation +
    formatCacheAppendix(p.cachePath, fetched.successPages.length, failedCount) +
    suggestionsAppendix;

  return {
    text: result,
    outcome: "completed",
    details: {
      cachePath: p.cachePath,
      urlsSearched: search.urls.length,
      pagesFetched: fetched.successPages.length,
      pagesFailed: failedCount,
    },
  };
}

// ── Stage 1: Search ──

interface SearchStageOut {
  searchResult: string;
  urls: Array<{ url: string; title: string }>;
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
  let urls: Array<{ url: string; title: string }> = [];
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

async function runFetchStage(
  p: PipelineCtx,
  urls: Array<{ url: string; title: string }>,
): Promise<FetchStageOut> {
  p.onProgress?.(progress("fetch", `Fetching ${urls.length} pages...`));
  throwIfAborted(p.signal);
  const pages = await p.dependencies.fetchPages(
    urls.map((u) => u.url),
    p.signal,
    {
      timeoutMs: p.settings.fetchTimeoutMs,
      browser: p.settings.browserFingerprint as unknown as import("wreq-js").BrowserProfile,
      concurrency: p.settings.fetchConcurrency,
      proxy: p.settings.httpProxy,
    },
  );
  const successPages = pages.filter((pg) => pg.status === "success");

  // Tally fetch-variant winners from the per-page `source` field that
  // fetch.ts stamps ("defuddle" | "markdown"). Falls back to "unknown"
  // for any page lacking the field.
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
    }));

  // Telemetry: tally extract outcomes and char throughput. Input chars are
  // the truncated page content actually fed to each extraction; output is
  // the returned extraction text. Blocked pages contributed no input.
  const succeededExtr = extractions.filter((e) => e.status === "success");
  const failedExtr = extractions.length - succeededExtr.length;
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
  });

  return { extractions, blockedExtractions };
}

// ── Stage 4: Collate + cache write ──

async function runCollateStage(
  p: PipelineCtx,
  searchResult: string,
  succeededExtractions: ExtractResult[],
): Promise<string> {
  // Build collation prompt (no files written yet — lock is never held
  // across the LLM call). Path references in the prompt are resolved
  // later when cache files are written.
  const collationUserMsg = buildCollationMessage(
    p.params.query,
    p.cachePath,
    searchResult,
    succeededExtractions,
  );

  throwIfAborted(p.signal);
  const { text: collation } = await p.models.complete({
    model: p.collateConfig,
    systemPrompt: COLLATION_SYSTEM_PROMPT,
    userMessage: collationUserMsg,
    maxTokens: p.settings.collationMaxTokens,
    signal: p.signal,
    retry: p.retry,
    timeoutMs: p.settings.llmTimeoutMs,
    onRetryNotice: (msg) => p.onProgress?.(progress("collate", msg)),
  });

  p.tel?.recordCollate({
    model: `${p.collateConfig.provider}/${p.collateConfig.model}`,
    summaryChars: collation.length,
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
 * Write cache artifacts under the per-cache-path lock (only local file I/O
 * happens under the lock; it serialises two concurrent same-query runs),
 * then commit any remaining llms-full downloads under a second short lock.
 */
async function writeCacheArtifacts(
  p: PipelineCtx,
  allExtractions: ExtractResult[],
  fetched: FetchStageOut,
  searchResult: string,
  collation: string,
  llms: LlmsDownloads,
): Promise<void> {
  await withLock(
    cacheLockDir(p.physicalCachePath),
    async () => {
      // Write cache files (staging-based atomic, no partial visibility)
      await writeCacheFiles(
        p.physicalCachePath,
        allExtractions,
        fetched.successPages,
        searchResult,
        p.params.query,
      );

      // Write report (atomic via temp-file + rename)
      await writeReportFile(
        p.physicalCachePath,
        p.params.query,
        collation,
        allExtractions,
        fetched.pages,
        p.cachePath,
      );

      // Write telemetry sidecar (atomic via temp-file + rename)
      await writeTelemetrySidecar(p.logger, p.tel, p.physicalCachePath, "completed");

      // Atomic index update under a separate lock scoped to the cache
      // directory. Different cache paths contend only on this short
      // index update, not on the per-cache-path bulk writes.
      await withLock(
        indexLockDir(p.paths.cacheRoot),
        async () => {
          const slug = p.physicalCachePath.split("/").pop() ?? p.physicalCachePath;
          await updateIndex(p.paths.cacheRoot, slug, p.params.query);
        },
        p.signal,
      );
    },
    p.signal,
  );

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
  try {
    const index = await readIndex(p.paths.cacheRoot);
    // Only run judge if there are other searches to compare against
    if (index.searches.some((e) => e.slug !== currentSlug)) {
      const indexText = formatIndexForJudge(index, currentSlug);
      const judgeUserMsg = `Current query: "${p.params.query}"\n\nPrevious searches:\n${indexText}`;
      const { text: judgeResponse } = await p.models.complete({
        model: p.extractConfig,
        systemPrompt: CACHE_SUGGEST_PROMPT,
        userMessage: judgeUserMsg,
        maxTokens: 500,
        signal: p.signal,
        retry: p.retry,
        timeoutMs: p.settings.llmTimeoutMs,
        onRetryNotice: (msg) => p.onProgress?.(progress("cache", msg)),
      });
      const matches = parseJudgeResponse(judgeResponse, index, currentSlug);
      cacheSuggestRan = true;
      cacheSuggestSurfaced = matches.length;
      cacheSuggestSlugs = matches.map((m) => m.entry.slug);
      suggestionsAppendix = formatCacheSuggestions(matches, p.paths.cacheDisplayRoot);
    }
  } catch (err: unknown) {
    throwIfAborted(p.signal);
    // Cache suggest is purely additive; user cancellation still propagates.
    p.logger.error(`Cache suggest failed: ${errMsg(err)}`);
  }

  p.tel?.recordCacheSuggest({
    ran: cacheSuggestRan,
    surfaced: cacheSuggestSurfaced,
    slugs: cacheSuggestSlugs,
  });

  return suggestionsAppendix;
}

/**
 * Shared degraded-exit path: stamp the outcome, write the sidecar, and
 * return the fallback result. Every early return in executePipeline() goes
 * through here so the three degraded outcomes stay structurally uniform.
 */
async function degradedReturn(
  p: PipelineCtx,
  outcome: TelemetryOutcome,
  message: string,
  details: Record<string, unknown>,
): Promise<OperationResult> {
  throwIfAborted(p.signal);
  await writeLockedTelemetry(p, outcome);
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
  try {
    const userMessage = buildExtractionMessage(
      page.content,
      p.params.query,
      p.params.focusPrompt,
      p.settings.extractMaxChars,
    );

    const { text: extraction } = await p.models.complete({
      model: p.extractConfig,
      systemPrompt: EXTRACTION_SYSTEM_PROMPT,
      userMessage,
      maxTokens: p.settings.extractionMaxTokens,
      signal: p.signal,
      retry: p.retry,
      timeoutMs: p.settings.llmTimeoutMs,
      onRetryNotice: (msg) => p.onProgress?.(progress("extract", msg)),
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
    throwIfAborted(p.signal);
    // Log extraction error but don't fail the whole pipeline
    p.logger.error(`Extraction failed for ${page.url}: ${errMsg(err)}`);
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
