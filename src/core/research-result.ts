// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { readFile } from "node:fs/promises";
import { join, relative, dirname } from "node:path";
import type {
  AccountingSummary,
  Artifact,
  Clock,
  CommittedRun,
  CoreResult,
  Counts,
  Diagnostic,
  FullData,
  IndexCandidate,
  OperationContext,
  OperationResult,
  OperationServices,
  Persistence,
  Progress,
  RelatedReport,
  ResearchParams,
  RunReservation,
  SourceRecord,
} from "./contracts.js";
import type { ExtractResult } from "./types.js";
import type { RunManifest, RunSource } from "./run-manifest-schema.js";
import {
  createPageDeadline,
  type PageDeadline,
  type PageDeadlineSnapshot,
} from "./page-deadline.js";
import { validatePageFetchSettings } from "./page-runtime.js";
import { createPageStaging, type PageStaging, type PageStagingSlot } from "./page-staging.js";
import { AdmissionError } from "./execution-coordinator.js";
import { validatePageTransportUrl } from "./page-transport.js";
import { completeOperationModel } from "./operation-model.js";
import { mergeCitations } from "./annotations.js";
import { collationSynthesis } from "./provenance.js";
import { appendDomainFilter, buildSearchPayloadPatch, buildExtractionMessage } from "./messages.js";
import { formatIndexForJudge, parseJudgeResponse, formatCacheSuggestions } from "./cache.js";
import {
  SEARCH_SYSTEM_PROMPT,
  EXTRACTION_SYSTEM_PROMPT,
  COLLATION_SYSTEM_PROMPT,
  CACHE_SUGGEST_PROMPT,
} from "./prompts.js";
import {
  extractSourceUrls,
  stripTrailingSourcesSection,
  inferSourceType,
  throwIfAborted,
} from "./util.js";
import { TelemetryBuilder, writeTelemetry, type TelemetryOutcome } from "./telemetry.js";

interface Page {
  source: SourceRecord;
  fetched: boolean;
  stagedPath?: string;
  extraction?: Readonly<ExtractResult>;
}
interface Evidence {
  readonly id: string;
  readonly extraction: Readonly<ExtractResult>;
}
const bytes = (value: string) => Buffer.from(value, "utf8");
const cell = (value: string) => value.replaceAll("|", "\\|").replace(/[\r\n]+/g, " ");
const modelId = (model: { readonly provider: string; readonly model: string }) => ({
  provider: model.provider,
  model: model.model,
});

/** Registered research producer. All page buffers are spooled and all work drains here. */
export function createResearchResult(
  input: ResearchParams,
  clock: Clock,
  onProgress?: (event: Progress) => void,
  onDiagnostic?: (diagnostic: Diagnostic) => void,
) {
  const params = structuredClone(input);
  const started = clock.monotonicMs();
  const startedUtc = clock.utcIso();
  let services: OperationServices | undefined;
  let context: OperationContext;
  let active = false;
  let ended = false;
  let sequence = 0;
  let pct = 0;
  let stage: Progress["stage"] = "search";
  const stages = ["search", "fetch", "extract", "collate", "cache"] as const;
  let effectivePageConcurrency = 0;
  let abortAt: number | undefined;
  let detachAbort = () => {};
  let summaryReadyMs: number | undefined;
  let summary = "";
  let searchSummary = "";
  let text = "";
  let outcome: FullData["outcome"] = "completed";
  let cache: Persistence = { status: "not-requested" };
  let reservation: RunReservation | undefined;
  let committed: CommittedRun | undefined;
  const diagnostics: Diagnostic[] = [];
  const pages: Page[] = [];
  let evidence: readonly Evidence[] = Object.freeze([]);
  let related: RelatedReport[] = [];
  let relatedAppendix = "";
  let deadline: PageDeadline | undefined;
  let snapshot: PageDeadlineSnapshot | undefined;
  let staging: PageStaging | undefined;
  const pageCutoff = new AbortController();
  const pageDrain = new AbortController();
  const discoveryCancel = new AbortController();
  let pageTasks: Promise<void>[] = [];
  let discovery: Promise<readonly SourceRecord[]> = Promise.resolve([]);
  let documents: readonly SourceRecord[] = [];
  let telemetry: TelemetryBuilder | null = null;
  let extractionInputChars = 0;

  const elapsed = () => Math.max(0, clock.monotonicMs() - started);
  const counts = (): Counts => ({
    candidates: pages.length,
    fetched: pages.filter((page) => page.fetched).length,
    extracted: pages.filter((page) => page.extraction).length,
    used: evidence.length,
    late: pages.filter((page) => page.source.state === "late").length,
    failed: pages.filter((page) =>
      ["empty", "fetch-failed", "extract-failed"].includes(page.source.state),
    ).length,
    cancelled: pages.filter((page) => page.source.state === "cancelled").length,
    effectivePageConcurrency,
  });
  const emit = (
    event: Progress["event"],
    state: Progress["state"],
    message: string,
    work?: { pageId: string; workStage: "fetch" | "extract" },
  ) => {
    if (!services) return;
    try {
      onProgress?.({
        operationId: services.operation.id,
        sequence: ++sequence,
        stage,
        event,
        state,
        message,
        elapsedMs: elapsed(),
        stageIdx: stages.indexOf(stage),
        totalStages: 5,
        pct,
        counts: counts(),
        ...(work ?? {}),
      });
    } catch {
      try {
        onDiagnostic?.({ code: "PROGRESS_DELIVERY_FAILED", message: "Progress delivery failed" });
      } catch {
        /* Supplementary. */
      }
    }
  };
  const diagnostic = (value: Diagnostic) => {
    if (!diagnostics.some((prior) => prior.code === value.code && prior.message === value.message))
      diagnostics.push({ ...value });
    const combined =
      diagnostics.length === 1
        ? diagnostics[0]
        : {
            code: value.code,
            message: diagnostics.map((prior) => `${prior.code}: ${prior.message}`).join("\n"),
          };
    if (cache.status !== "not-requested") cache = { ...cache, diagnostic: combined };
  };
  const notice = (value: Diagnostic) => {
    const known = diagnostics.some(
      (prior) => prior.code === value.code && prior.message === value.message,
    );
    diagnostic(value);
    if (!known) {
      try {
        onDiagnostic?.(value);
      } catch {
        /* Retain in data. */
      }
    }
  };
  const unavailable = (value: Diagnostic) => {
    cache = { status: "unavailable", diagnostic: value };
    notice(value);
  };
  // Filesystem and staging errors can include absolute paths and arbitrary OS text.
  const stagingFault = () =>
    notice({
      code: "STAGING_UNAVAILABLE",
      message: "Private page staging is unavailable under the configured cache directory",
    });
  const retry = () => ({
    attempts: context.settings.llmRetryAttempts,
    baseDelayMs: context.settings.retryBaseDelayMs,
    maxDelayMs: context.settings.retryMaxDelayMs,
  });
  const inventory = (sources: readonly SourceRecord[]) => {
    let result =
      "\n\n## Source assessment\n\nSource inventory uses stable candidate IDs. Only used sources support the summary; late extractions are not evidence.\n\n";
    result += "| ID | Source | State | Extraction | Full page |\n|---|---|---|---|---|\n";
    for (const source of sources)
      result += `| ${source.id} | ${cell(source.url)} | ${source.state} | ${cell(source.extractionPath ?? "Not cached")} | ${cell(source.fullPagePath ?? "Not cached")} |\n`;
    return result.trimEnd();
  };
  const answer = () => {
    text =
      outcome === "completed"
        ? `## Summary\n\n${summary}${inventory(pages.map((page) => page.source))}`
        : summary;
    if (cache.status === "committed") {
      text += `\n\n**Report**: \`${cache.reportPath}\`\n\nRead \`${cache.reportPath}\` with the host's file-reading capability.`;
      if (cache.diagnostic)
        text += `\n\nPersistence diagnostic (${cache.diagnostic.code}): ${cache.diagnostic.message}`;
    } else if (cache.status === "unavailable")
      text += `\n\nPersistence unavailable (${cache.diagnostic.code}): ${cache.diagnostic.message}`;
    text += relatedAppendix;
  };
  const details = (): FullData["details"] => ({
    cachePath: cache.status === "committed" ? reservation!.displayPath : "",
    urlsSearched: pages.length,
    pagesFetched: counts().fetched,
    pagesFailed: pages.filter((page) => page.source.state === "fetch-failed").length,
    ...(snapshot?.adaptiveAtMs === undefined
      ? {}
      : { deadlineAdaptiveMs: Math.max(0, snapshot.adaptiveAtMs - started) }),
    ...(snapshot?.ceilingAtMs === undefined
      ? {}
      : { deadlineCeilingMs: Math.max(0, snapshot.ceilingAtMs - started) }),
  });

  const search = async () => {
    emit("start", "running", "Searching for sources...");
    const settings = context.settings;
    const patch = buildSearchPayloadPatch(settings, settings.searchModel.provider, params.domains);
    const maxUrls = Math.min(params.maxUrls ?? settings.defaultUrls, settings.maxUrls);
    const cap = Math.max(1, settings.searchRetryAttempts);
    let attempts = 0;
    let citations = 0;
    for (let attempt = 1; attempt <= cap; attempt++) {
      throwIfAborted(services!.operation.signal);
      attempts = attempt;
      const completion = await completeOperationModel(context, "search", {
        model: settings.searchModel,
        systemPrompt: SEARCH_SYSTEM_PROMPT,
        userMessage: appendDomainFilter(params.query, params.domains),
        maxTokens: 2000,
        signal: services!.operation.signal,
        retry: retry(),
        timeoutMs: settings.llmTimeoutMs,
        collectCitations: true,
        payloadPatch: patch,
        reasoning: patch ? (settings.searchWebSearch.reasoning ?? "low") : undefined,
        onRetryNotice: (message) => emit("retry", "running", message),
      });
      searchSummary = stripTrailingSourcesSection(completion.text);
      citations = completion.citations.length;
      const seen = new Set<string>();
      const candidates = mergeCitations(extractSourceUrls(completion.text), completion)
        .filter((item) => {
          try {
            validatePageTransportUrl(item.url);
          } catch {
            return false;
          }
          if (seen.has(item.url)) return false;
          seen.add(item.url);
          return true;
        })
        .slice(0, maxUrls);
      pages.push(
        ...candidates.map((item, index): Page => ({
          source: { ...item, id: `S${index + 1}`, state: "candidate" },
          fetched: false,
        })),
      );
      if (pages.length || attempt === cap) break;
      emit("retry", "running", "Search returned no usable links; retrying...");
      await clock.sleep(settings.retryBaseDelayMs, services!.operation.signal);
    }
    telemetry?.recordSearch({
      model: `${settings.searchModel.provider}/${settings.searchModel.model}`,
      linksReturned: pages.length,
      attempts,
      retryFired: attempts > 1,
      degraded: !pages.length,
      annotationsHarvested: citations,
    });
    pct = 20;
    emit("end", "succeeded", "Search settled");
  };

  // A bounded worker population reads staged files. Barrier mode never reloads
  // every body together; streaming retains its fetch slot through extraction.
  const extractPage = async (page: Page) => {
    const signal = AbortSignal.any([services!.operation.signal, pageDrain.signal]);
    throwIfAborted(signal);
    if (pageCutoff.signal.aborted) throw new AdmissionError("PAGE_CUTOFF");
    const body = await readFile(page.stagedPath!, "utf8");
    throwIfAborted(signal);
    if (pageCutoff.signal.aborted) throw new AdmissionError("PAGE_CUTOFF");
    extractionInputChars += Math.min(body.length, context.settings.extractMaxChars);
    emit("update", "running", `Extracting ${page.source.id}`, {
      pageId: page.source.id,
      workStage: "extract",
    });
    const result = await completeOperationModel(
      context,
      "extract",
      {
        model: context.settings.extractModel,
        systemPrompt: EXTRACTION_SYSTEM_PROMPT,
        userMessage: buildExtractionMessage(
          body,
          params.query,
          params.focusPrompt,
          context.settings.extractMaxChars,
        ),
        maxTokens: context.settings.extractionMaxTokens,
        signal,
        retry: retry(),
        timeoutMs: context.settings.llmTimeoutMs,
        onRetryNotice: (message) =>
          emit("retry", "running", message, { pageId: page.source.id, workStage: "extract" }),
      },
      page.source.id,
    );
    throwIfAborted(signal);
    if (result.text.trim()) {
      const sourceType = inferSourceType(result.text.split("\n")[0] ?? "");
      page.extraction = Object.freeze({
        url: page.source.url,
        title: page.source.title,
        extraction: result.text,
        sourceType,
        currentness: "unknown",
        status: "success",
      });
      page.source = { ...page.source, sourceType };
    } else page.source = { ...page.source, state: "empty" };
  };
  // Keep accepted body content inside this frame only until the writer settles.
  const fetchPage = async (page: Page, slot: PageStagingSlot) => {
    const result = await services!.fetch.fetch({ url: page.source.url }, services!.operation, {
      pageId: page.source.id,
      signal: AbortSignal.any([pageCutoff.signal, pageDrain.signal]),
    });
    const { content, ...source } = result.page;
    page.source = {
      ...source,
      id: page.source.id,
      url: page.source.url,
      title: source.title || page.source.title,
    };
    if (source.state === "fetch-failed") return;
    page.fetched = true;
    if (source.state === "empty" || !content?.trim()) {
      page.source = { ...page.source, state: "empty" };
      return;
    }
    try {
      page.stagedPath = (await slot.write(content)).stagedPath;
    } catch (error) {
      if (!services!.operation.signal.aborted) stagingFault();
      throw error;
    }
  };

  const pagePhase = async () => {
    const settings = context.settings;
    const execution = settings.execution!;
    stage = "fetch";
    emit("start", "running", `Fetching ${pages.length} sources...`);
    let resolveFreeze!: (snapshot: PageDeadlineSnapshot) => void;
    let rejectFreeze!: (error: unknown) => void;
    const frozen = new Promise<PageDeadlineSnapshot>((resolve, reject) => {
      resolveFreeze = resolve;
      rejectFreeze = reject;
    });
    // Install a handler before a synchronous timer/terminal callback can fail.
    void frozen.catch(() => {});
    const failPhase = (error: unknown) => {
      pageDrain.abort();
      pageCutoff.abort();
      discoveryCancel.abort();
      rejectFreeze(error);
    };
    deadline = createPageDeadline({
      clock,
      policy: execution.deadline,
      candidateIds: pages.map((page) => page.source.id),
      onFreeze(value) {
        snapshot = value;
        evidence = Object.freeze(
          value.successIds.map((id) => {
            const page = pages.find((page) => page.source.id === id)!;
            if (!page.extraction?.extraction.trim()) throw new Error("Frozen evidence is missing");
            page.source = { ...page.source, state: "used" };
            return Object.freeze({ id, extraction: page.extraction });
          }),
        );
        services!.operation.cutoffPages();
        pageCutoff.abort();
        resolveFreeze(value);
      },
      onCallbackError(error) {
        notice({ code: "PAGE_FREEZE_FAILED", message: "Page snapshot finalisation failed" });
        failPhase(error);
      },
    });
    const signal = services!.operation.signal;
    const aborted = () => failPhase(signal.reason ?? new Error("Operation aborted"));
    signal.addEventListener("abort", aborted, { once: true });
    deadline.start();
    try {
      if (signal.aborted) aborted();
      if (pages.length) {
        staging = createPageStaging({
          cacheRoot: context.paths.cacheRoot,
          operation: services!.operation,
          maxRetainedPages: settings.fetchConcurrency,
          maxPageBytes: execution.fetchMaxChars * 3,
        });
        if (!settings.disableLlmsFullDiscovery) {
          discovery = (async () => {
            try {
              const root = await staging!.directory();
              return await services!.fetch.discover(
                pages.map((page) => page.source.url),
                root,
                services!.operation,
                discoveryCancel.signal,
              );
            } catch (error) {
              throwIfAborted(signal);
              if (!discoveryCancel.signal.aborted)
                notice({
                  code: "DISCOVERY_UNAVAILABLE",
                  message: "Documentation discovery is unavailable",
                });
              return [];
            }
          })();
          void discovery.catch(() => {});
        }
        const gate = extractionGate(
          effectivePageConcurrency,
          AbortSignal.any([signal, pageCutoff.signal, pageDrain.signal]),
        );
        const terminal = (page: Page) => {
          const accepted = deadline!.terminal(page.source.id, Boolean(page.extraction));
          if (page.extraction && !accepted) page.source = { ...page.source, state: "late" };
          pct = Math.max(
            pct,
            40 +
              (20 *
                pages.filter((page) => !["candidate", "fetched"].includes(page.source.state))
                  .length) /
                pages.length,
          );
          emit("update", "running", `${page.source.id} settled`, {
            pageId: page.source.id,
            workStage: page.fetched ? "extract" : "fetch",
          });
        };
        const failed = (page: Page, error: unknown) => {
          if (error instanceof AdmissionError && error.code === "BUSY") failPhase(error);
          const cancelled =
            signal.aborted ||
            pageDrain.signal.aborted ||
            pageCutoff.signal.aborted ||
            (error instanceof AdmissionError &&
              ["PAGE_CUTOFF", "ABORTED", "CLOSED"].includes(error.code));
          page.source = {
            ...page.source,
            state: cancelled ? "cancelled" : page.fetched ? "extract-failed" : "fetch-failed",
            diagnostic: cancelled
              ? "PAGE_CANCELLED"
              : page.fetched
                ? "EXTRACTION_FAILED"
                : "FETCH_FAILED",
          };
        };
        const fetchOne = async (page: Page) => {
          let slot: PageStagingSlot | undefined;
          try {
            slot = await staging!.acquire(
              page.source.id,
              AbortSignal.any([pageCutoff.signal, pageDrain.signal]),
            );
            await fetchPage(page, slot);
            if (execution.pageExecution === "streaming" && page.stagedPath)
              await gate(() => extractPage(page));
          } catch (error) {
            failed(page, error);
          } finally {
            await slot?.release();
          }
          if (execution.pageExecution === "streaming" || !page.stagedPath) terminal(page);
        };
        stage = "extract";
        pct = Math.max(pct, 40);
        emit("start", "running", "Extracting bounded page evidence...");
        pageTasks = pages.map((page) => services!.operation.track(fetchOne(page)));
        if (execution.pageExecution === "barrier") {
          await Promise.all(pageTasks);
          pageTasks = pages
            .filter((page) => page.stagedPath)
            .map((page) =>
              services!.operation.track(
                (async () => {
                  try {
                    await gate(() => extractPage(page));
                  } catch (error) {
                    failed(page, error);
                  }
                  terminal(page);
                })(),
              ),
            );
        }
        void Promise.all(pageTasks).catch(failPhase);
      }
      await frozen;
      throwIfAborted(signal);
    } finally {
      signal.removeEventListener("abort", aborted);
    }
  };

  const drain = async (budget: number) => {
    const work = Promise.allSettled([...pageTasks, discovery]);
    if (budget > 0 && !services!.operation.signal.aborted) {
      const signal = services!.operation.signal;
      let cancel = () => {};
      let wake = () => {};
      try {
        await Promise.race([
          work,
          new Promise<void>((resolve) => {
            wake = resolve;
            signal.addEventListener("abort", wake, { once: true });
            cancel = clock.schedule(budget, resolve);
            if (signal.aborted) resolve();
          }),
        ]);
      } finally {
        cancel();
        signal.removeEventListener("abort", wake);
      }
    }
    // This race chooses when to request cancellation, never when to return.
    pageCutoff.abort();
    pageDrain.abort();
    discoveryCancel.abort();
    await work;
    documents = await discovery.catch(() => []);
    for (const page of pages)
      if (page.source.state === "candidate" || page.source.state === "fetched")
        page.source = { ...page.source, state: "cancelled" };
  };

  const publish = async () => {
    if (!reservation || outcome !== "completed") return;
    const manifestSources: RunSource[] = pages.map((page) => ({
      ...page.source,
      state: page.source.state as RunSource["state"],
      input: "network",
      ...(page.extraction
        ? {
            extractionPath: `${page.source.state === "late" ? "late" : "extractions"}/${page.source.id}.md`,
          }
        : {}),
      ...(page.stagedPath && page.source.state !== "late"
        ? { fullPagePath: `sources/P${page.source.id.slice(1)}.md` }
        : {}),
    }));
    const artifacts: Artifact[] = [];
    for (const [i, source] of manifestSources.entries()) {
      if (source.extractionPath)
        artifacts.push({
          relativePath: source.extractionPath,
          kind: source.state === "late" ? "late" : "extraction",
          bytes: bytes(pages[i].extraction!.extraction),
        });
      if (source.fullPagePath)
        artifacts.push({
          relativePath: source.fullPagePath,
          kind: "source",
          stagedPath: pages[i].stagedPath!,
        });
    }
    const docs: RunManifest["documents"] = [];
    for (const document of documents) {
      if (!document.fullPagePath) continue;
      const relativePath = `sources/llms-full-${document.id}.md`;
      docs.push({ url: document.url, relativePath });
      artifacts.push({ relativePath, kind: "source", stagedPath: document.fullPagePath });
    }
    const manifest: RunManifest = {
      schema: "intelli-v1/run",
      schemaVersion: 1,
      operation: "intelli_research",
      sources: manifestSources,
      evidenceSourceIds: evidence.map((item) => item.id),
      documents: docs,
      suppliedPages: [],
      provenance: {
        domains: [...(params.domains ?? [])],
        ...(params.focusPrompt === undefined ? {} : { focusPrompt: params.focusPrompt }),
        models: {
          search: modelId(context.settings.searchModel),
          extract: modelId(context.settings.extractModel),
          collate: modelId(context.settings.collateModel),
          suggest: modelId(context.settings.extractModel),
        },
      },
    };
    artifacts.push(
      { relativePath: "query.txt", kind: "query", bytes: bytes(params.query) },
      {
        relativePath: "report.md",
        kind: "report",
        bytes: bytes(`# ${params.query}\n\n## Summary\n\n${summary}${inventory(manifestSources)}`),
      },
      { relativePath: "run.json", kind: "manifest-data", bytes: bytes(JSON.stringify(manifest)) },
    );
    const result = await services!.runs.commit(reservation, artifacts, services!.operation.signal);
    if (result.status === "unavailable") {
      unavailable(result.diagnostic);
      return;
    }
    committed = result.run;
    cache = {
      status: "committed",
      runId: reservation.runId,
      reportPath: join(reservation.displayPath, "report.md"),
      index: "unavailable",
      ...(diagnostics.length
        ? { diagnostic: cache.status === "unavailable" ? cache.diagnostic : diagnostics.at(-1)! }
        : {}),
    };
    for (const [i, source] of manifestSources.entries()) {
      const { input: _input, ...record } = source;
      pages[i].source = {
        ...record,
        ...(source.extractionPath
          ? { extractionPath: join(reservation.displayPath, source.extractionPath) }
          : {}),
        ...(source.fullPagePath
          ? { fullPagePath: join(reservation.displayPath, source.fullPagePath) }
          : {}),
      };
    }
    throwIfAborted(services!.operation.signal);
    const index = await services!.runs.updateIndex(
      committed,
      params.query,
      services!.operation.signal,
    );
    cache = { ...cache, index };
    if (index === "unavailable")
      notice({
        code: "INDEX_UNAVAILABLE",
        message: "The committed report is preserved but its suggestion index was not updated",
      });
  };

  const suggestions = async () => {
    let selected: readonly IndexCandidate[] = [];
    let ran = false;
    try {
      selected = Object.freeze(
        [
          ...(await services!.runs.candidates(
            reservation,
            params.query,
            services!.operation.signal,
          )),
        ].slice(0, 20),
      );
      const index = {
        searches: selected.map((item) => ({
          query: item.query,
          timestamp: item.startedUtc,
          slug: relative(context.paths.cacheDisplayRoot, dirname(item.reportPath)),
        })),
      };
      if (selected.length) {
        const result = await completeOperationModel(context, "suggest", {
          model: context.settings.extractModel,
          systemPrompt: CACHE_SUGGEST_PROMPT,
          userMessage: `Current query: "${params.query}"\n\nPrevious searches:\n${formatIndexForJudge(index, "")}`,
          maxTokens: 500,
          signal: services!.operation.signal,
          retry: retry(),
          timeoutMs: context.settings.llmTimeoutMs,
          onRetryNotice: (message) => emit("retry", "running", message),
        });
        ran = true;
        const matches = parseJudgeResponse(result.text, index, "");
        related = matches.map((match) => {
          const item = selected[index.searches.indexOf(match.entry)];
          return {
            query: item.query,
            reportPath: item.reportPath,
            namespace: item.namespace,
            relevance: match.relevance,
          };
        });
        relatedAppendix = formatCacheSuggestions(matches, context.paths.cacheDisplayRoot);
      }
    } catch {
      throwIfAborted(services!.operation.signal);
      notice({
        code: "SUGGESTIONS_UNAVAILABLE",
        message: "Related cached research is unavailable",
      });
    }
    telemetry?.recordCacheSuggest({
      ran,
      surfaced: related.length,
      slugs: related.map((item) =>
        relative(context.paths.cacheDisplayRoot, dirname(item.reportPath)),
      ),
    });
  };

  return {
    get active() {
      return active;
    },
    diagnostic,
    dispose() {
      detachAbort();
      deadline?.dispose();
    },
    async run(value: OperationContext): Promise<OperationResult> {
      if (active || !value.services) throw new TypeError("Research requires one scoped operation");
      context = value;
      services = value.services;
      if (services.clock !== clock || context.signal !== services.operation.signal)
        throw new TypeError("Research must use the authoritative clock and signal");
      validatePageFetchSettings(context.settings);
      active = true;
      const signal = services.operation.signal;
      const aborted = () => {
        abortAt ??= clock.monotonicMs();
      };
      if (signal.aborted) aborted();
      else signal.addEventListener("abort", aborted, { once: true });
      detachAbort = () => signal.removeEventListener("abort", aborted);
      effectivePageConcurrency = Math.min(
        context.settings.extractionConcurrency,
        context.settings.execution!.modelConcurrency - context.settings.execution!.criticalReserve,
      );
      try {
        throwIfAborted(signal);
        if (!context.settings.disableTelemetry)
          telemetry = await TelemetryBuilder.create(
            params.query,
            context.identity,
            () => Date.parse(startedUtc) + elapsed(),
          );
        const allocation = await services.runs.allocate({
          operationId: services.operation.id,
          query: params.query,
          startedUtc,
          signal,
        });
        if (allocation.status === "allocated") reservation = allocation.reservation;
        else unavailable(allocation.diagnostic);
        await search();
        await pagePhase();
        if (!evidence.length) {
          outcome = !pages.length
            ? "no-links"
            : !counts().fetched
              ? "fetch-failed"
              : "extraction-failed";
          summary = `${outcome === "no-links" ? "Search returned no usable links" : outcome === "fetch-failed" ? "All pages failed to fetch" : "No nonempty evidence was extracted"}.\n\nSearch summary:\n${searchSummary}`;
        } else {
          stage = "collate";
          pct = Math.max(pct, 60);
          emit("start", "running", "Synthesising frozen evidence...");
          const result = await completeOperationModel(context, "collate", {
            model: context.settings.collateModel,
            systemPrompt: COLLATION_SYSTEM_PROMPT,
            userMessage: JSON.stringify(
              {
                query: params.query,
                sources: evidence.map((item) => ({
                  id: item.id,
                  url: item.extraction.url,
                  title: item.extraction.title,
                  type: item.extraction.sourceType,
                  extraction: item.extraction.extraction,
                })),
              },
              null,
              2,
            ),
            maxTokens: context.settings.collationMaxTokens,
            signal,
            retry: retry(),
            timeoutMs: context.settings.llmTimeoutMs,
            onRetryNotice: (message) => emit("retry", "running", message),
          });
          throwIfAborted(signal);
          summary = collationSynthesis(
            result.text,
            reservation?.displayPath ?? context.paths.cacheDisplayRoot,
            evidence.map((item) => item.extraction),
            evidence.map((item) => item.id),
          );
          summaryReadyMs = elapsed();
          telemetry?.recordCollate({
            model: `${context.settings.collateModel.provider}/${context.settings.collateModel.model}`,
            summaryChars: summary.length,
          });
          pct = 80;
          emit("end", "succeeded", "Summary ready");
        }
        await drain(context.settings.execution!.lateDrainMs);
        throwIfAborted(signal);
        stage = "cache";
        pct = Math.max(pct, 80);
        emit("start", "running", "Publishing settled research...");
        await publish();
        await suggestions();
        throwIfAborted(signal);
        if (committed) {
          const accounting = await services.runs.recordAccounting(
            committed,
            services.ledger.records(),
            services.ledger.summary(),
            signal,
          );
          if (accounting.status === "recorded" && cache.status === "committed")
            cache = { ...cache, accountingPath: accounting.path };
          else if (accounting.status === "unavailable") notice(accounting.diagnostic);
        }
        if (telemetry && reservation) {
          const winners: Record<string, number> = {};
          for (const page of pages.filter((page) => page.fetched)) {
            const type = page.source.sourceType ?? "unknown";
            winners[type] = (winners[type] ?? 0) + 1;
          }
          telemetry.recordFetch({
            requested: pages.length,
            succeeded: counts().fetched,
            failed: pages.length - counts().fetched,
            winners,
          });
          telemetry.recordExtract({
            model: `${context.settings.extractModel.provider}/${context.settings.extractModel.model}`,
            succeeded: counts().extracted,
            failed: pages.filter(
              (page) => page.source.state === "extract-failed" || page.source.state === "empty",
            ).length,
            totalInputCharsApprox: extractionInputChars,
            totalOutputChars: pages.reduce(
              (total, page) => total + (page.extraction?.extraction.length ?? 0),
              0,
            ),
          });
          telemetry.setOutcome(outcome as TelemetryOutcome);
          try {
            await writeTelemetry(reservation.physicalPath, telemetry.finalize());
          } catch {
            notice({
              code: "TELEMETRY_UNAVAILABLE",
              message: "The local telemetry sidecar could not be written",
            });
          }
        }
        answer();
        return { text, details: details(), outcome };
      } finally {
        deadline?.dispose();
        await drain(0);
        try {
          await staging?.settle();
        } catch {
          stagingFault();
        }
      }
    },
    settled(
      _result: OperationResult | undefined,
      failure?: { message: string; aborted: boolean },
      parentDelivery: AccountingSummary["parentDelivery"] = "available",
    ): CoreResult {
      if (!services || !active || ended) throw new TypeError("Research projection is not pending");
      ended = true;
      detachAbort();
      answer();
      const finalOutcome = failure ? (failure.aborted ? "aborted" : "error") : outcome;
      const resultText = failure?.message ?? text;
      const data: FullData = {
        schemaVersion: 1,
        operation: "intelli_research",
        operationId: services.operation.id,
        outcome: finalOutcome,
        text: resultText,
        details: details(),
        summary,
        sources: pages.map((page) => page.source),
        cache,
        related,
        counts: counts(),
        timing: {
          startedUtc,
          elapsedMs: elapsed(),
          allWorkSettledMs: elapsed(),
          ...(summaryReadyMs === undefined ? {} : { summaryReadyMs }),
          ...(snapshot === undefined
            ? {}
            : { cutoffMs: Math.max(0, snapshot.frozenAtMs - started) }),
          ...(failure?.aborted && abortAt !== undefined
            ? { abortToSettledMs: Math.max(0, clock.monotonicMs() - abortAt) }
            : {}),
        },
        accounting: services.ledger.summary(parentDelivery),
        attempts: services.ledger.records(),
        deadline: {
          enabled: context.settings.execution!.deadline.enabled,
          reason: snapshot?.reason ?? "not-applicable",
          minimumMet: snapshot?.minimumMet ?? !context.settings.execution!.deadline.enabled,
        },
      };
      if (!failure) {
        stage = "cache";
        pct = 100;
      }
      emit(
        "end",
        failure ? (failure.aborted ? "cancelled" : "failed") : "succeeded",
        failure?.message ?? "Completed",
      );
      return {
        text: resultText,
        details: data.details,
        outcome: finalOutcome,
        data,
        usage: services.ledger.hostUsage(),
      };
    },
  };
}

/** Bounded reads and extraction calls; cancellation removes queued readers only. */
function extractionGate(limit: number, signal: AbortSignal) {
  let active = 0;
  const queue: Array<() => void> = [];
  const pump = () => {
    while (active < limit && queue.length) queue.shift()!();
  };
  return async (body: () => Promise<void>) => {
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        const index = queue.indexOf(start);
        if (index >= 0) queue.splice(index, 1);
        signal.removeEventListener("abort", abort);
        reject(new AdmissionError("PAGE_CUTOFF"));
      };
      const start = () => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) {
          reject(new AdmissionError("PAGE_CUTOFF"));
          return;
        }
        active++;
        resolve();
      };
      if (signal.aborted) abort();
      else if (active < limit) start();
      else {
        queue.push(start);
        signal.addEventListener("abort", abort, { once: true });
      }
    });
    try {
      await body();
    } finally {
      active--;
      pump();
    }
  };
}
