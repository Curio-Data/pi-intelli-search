// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { join } from "node:path";
import type {
  AccountingSummary,
  Artifact,
  Clock,
  CollateParams,
  CoreResult,
  Counts,
  Diagnostic,
  FullData,
  OperationContext,
  OperationResult,
  OperationServices,
  Persistence,
  Progress,
  RunReservation,
  SourceRecord,
} from "./contracts.js";
import type { RunManifest, RunSource } from "./run-manifest-schema.js";
import type { ExtractResult } from "./types.js";
import { completeOperationModel } from "./operation-model.js";
import { collationSynthesis, evidenceExtractions } from "./provenance.js";
import { COLLATION_SYSTEM_PROMPT } from "./prompts.js";
import { throwIfAborted } from "./util.js";

/** Supplied labels need not be URLs. Parsed user information is never provenance. */
function label(value: string): string {
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = "";
      url.password = "";
      return url.href;
    }
  } catch {
    /* Preserve arbitrary caller-supplied labels. */
  }
  return value;
}
const cell = (value: string) => value.replaceAll("|", "\\|").replace(/[\r\n]+/g, " ");
const bytes = (value: string) => Buffer.from(value, "utf8");

/** Registered supplied-input operation. Legacy direct helpers remain separate. */
export function createCollateResult(
  input: CollateParams,
  clock: Clock,
  onProgress?: (event: Progress) => void,
  onDiagnostic?: (diagnostic: Diagnostic) => void,
) {
  // Caller mutation cannot change evidence or file ownership during inference.
  const params = structuredClone(input);
  const started = clock.monotonicMs();
  const startedUtc = clock.utcIso();
  let services: OperationServices | undefined;
  let active = false;
  let ended = false;
  let sequence = 0;
  let pct = 0;
  let stage: "collate" | "cache" = "collate";
  let effectivePageConcurrency = 0;
  let abortAt: number | undefined;
  let removeAbort: (() => void) | undefined;
  let summaryReadyMs: number | undefined;
  let summary = "";
  let text = "";
  let details: FullData["details"] = {};
  let cache: Persistence = { status: "not-requested" };
  let persistenceDiagnostic: Diagnostic | undefined;
  const persistenceDiagnostics: Diagnostic[] = [];
  let sources: SourceRecord[] = [];

  const emit = (event: Progress["event"], state: Progress["state"], message: string) => {
    if (!services) return;
    try {
      onProgress?.({
        operationId: services.operation.id,
        sequence: ++sequence,
        stage,
        event,
        state,
        message,
        elapsedMs: Math.max(0, clock.monotonicMs() - started),
        stageIdx: stage === "collate" ? 0 : 1,
        totalStages: 2,
        pct,
      });
    } catch {
      try {
        onDiagnostic?.({ code: "PROGRESS_DELIVERY_FAILED", message: "Progress delivery failed" });
      } catch {
        /* Rendering cannot replace an answer. */
      }
    }
  };
  const diagnostic = (value: Diagnostic) => {
    if (
      !persistenceDiagnostics.some(
        (prior) => prior.code === value.code && prior.message === value.message,
      )
    )
      persistenceDiagnostics.push({ ...value });
    persistenceDiagnostic =
      persistenceDiagnostics.length === 1
        ? persistenceDiagnostics[0]
        : {
            code: value.code,
            message: persistenceDiagnostics
              .map((prior) => `${prior.code}: ${prior.message}`)
              .join("\n"),
          };
    if (cache.status === "committed") cache = { ...cache, diagnostic: persistenceDiagnostic };
  };
  const unavailable = (value: Diagnostic) => {
    const observed = persistenceDiagnostics.some(
      (prior) => prior.code === value.code && prior.message === value.message,
    );
    diagnostic(value);
    cache = { status: "unavailable", diagnostic: persistenceDiagnostic! };
    try {
      if (!observed) onDiagnostic?.(value);
    } catch {
      /* Keep the diagnostic in the result. */
    }
  };
  const inventory = (records: readonly SourceRecord[]) => {
    let out = "\n\n## Source assessment\n\n";
    out += "Source inventory records caller-supplied extractions, not network fetches.\n\n";
    out += "| ID | Source | State | Extraction | Full page |\n|---|---|---|---|---|\n";
    for (const source of records) {
      out += `| ${source.id} | ${cell(source.url)} | ${source.state} | ${cell(source.extractionPath ?? "Not cached")} | ${cell(source.fullPagePath ?? "Not cached")} |\n`;
    }
    return out.trimEnd();
  };
  const answer = () => {
    text = `## Summary\n\n${summary}${inventory(sources)}`;
    if (cache.status === "committed") {
      text += `\n\n**Report**: \`${cache.reportPath}\`\n\nRead \`${cache.reportPath}\` with the host's file-reading capability.`;
      if (cache.diagnostic)
        text += `\n\nPersistence diagnostic (${cache.diagnostic.code}): ${cache.diagnostic.message}`;
    } else if (cache.status === "unavailable") {
      text += `\n\nPersistence unavailable (${cache.diagnostic.code}): ${cache.diagnostic.message}`;
    }
  };

  return {
    get active() {
      return active;
    },
    diagnostic,
    dispose() {
      removeAbort?.();
    },
    async run(context: OperationContext): Promise<OperationResult> {
      if (active || !context.services) throw new TypeError("Collate requires one scoped operation");
      services = context.services;
      if (services.clock !== clock || context.signal !== services.operation.signal)
        throw new TypeError("Collate must use the authoritative clock and signal");
      active = true;
      const signal = services.operation.signal;
      const aborted = () => {
        abortAt ??= clock.monotonicMs();
      };
      if (signal.aborted) aborted();
      else signal.addEventListener("abort", aborted, { once: true });
      removeAbort = () => signal.removeEventListener("abort", aborted);
      const execution = context.settings.execution!;
      effectivePageConcurrency = Math.min(
        context.settings.extractionConcurrency,
        execution.modelConcurrency - execution.criticalReserve,
      );
      emit("start", "running", "Collating supplied evidence...");
      throwIfAborted(signal);
      const extractions: readonly ExtractResult[] = Object.freeze(
        params.extractions.map((item, index) => {
          const state =
            item.status === "success"
              ? item.extraction.trim()
                ? "used"
                : "empty"
              : "extract-failed";
          const url = label(item.url);
          sources.push({
            id: `S${index + 1}`,
            url,
            title: item.title,
            state,
            sourceType: item.sourceType,
          });
          return Object.freeze({
            ...item,
            url,
            currentness: "undated" as const,
            status: state === "used" ? ("success" as const) : ("failed" as const),
          });
        }),
      );
      // Duplicate rejection is deliberately after URL-user-information redaction.
      const evidence = Object.freeze(evidenceExtractions(extractions));
      if (!evidence.length)
        throw new Error("Collation requires at least one successful, non-empty extraction");
      const evidenceSources = Object.freeze(sources.filter((source) => source.state === "used"));
      details = { sourcesFetched: sources.length };
      const allocation = await services.runs.allocate({
        operationId: services.operation.id,
        query: params.query,
        startedUtc,
        signal,
      });
      let reservation: RunReservation | undefined;
      if (allocation.status === "allocated") reservation = allocation.reservation;
      else unavailable(allocation.diagnostic);
      throwIfAborted(signal);
      const response = await completeOperationModel(context, "collate", {
        model: context.settings.collateModel,
        systemPrompt: COLLATION_SYSTEM_PROMPT,
        userMessage: JSON.stringify(
          {
            query: params.query,
            sources: evidence.map((item, index) => ({
              id: evidenceSources[index].id,
              url: item.url,
              title: item.title,
              type: item.sourceType,
              extraction: item.extraction,
            })),
          },
          null,
          2,
        ),
        maxTokens: context.settings.collationMaxTokens,
        signal,
        onRetryNotice: (message) => emit("retry", "running", message),
      });
      throwIfAborted(signal);
      summary = collationSynthesis(
        response.text,
        reservation?.displayPath ?? context.paths.cacheDisplayRoot,
        evidence,
        evidenceSources.map((source) => source.id),
      );
      summaryReadyMs = Math.max(0, clock.monotonicMs() - started);
      pct = 50;
      emit("end", "succeeded", "Collation ready");
      stage = "cache";
      emit("start", "running", "Publishing supplied evidence...");
      if (reservation) {
        const manifestSources: RunSource[] = sources.map((source) => ({
          ...source,
          state: source.state as RunSource["state"],
          input: "supplied",
          ...(source.state === "used" ? { extractionPath: `extractions/${source.id}.md` } : {}),
        }));
        const artifacts: Artifact[] = evidence.map((item, index) => ({
          relativePath: manifestSources.find((source) => source.id === evidenceSources[index].id)!
            .extractionPath!,
          kind: "extraction",
          bytes: bytes(item.extraction),
        }));
        const suppliedPages: RunManifest["suppliedPages"] = [];
        for (const [index, page] of (params.fullPages ?? []).entries()) {
          const url = label(page.url);
          const owner = manifestSources.find(
            (source) => source.url === url && !source.fullPagePath,
          );
          const relativePath = `sources/P${index + 1}.md`;
          artifacts.push({ relativePath, kind: "source", bytes: bytes(page.content) });
          if (owner) owner.fullPagePath = relativePath;
          else suppliedPages.push({ url, relativePath });
        }
        const manifest: RunManifest = {
          schema: "intelli-v1/run",
          schemaVersion: 1,
          operation: "intelli_collate",
          sources: manifestSources,
          evidenceSourceIds: evidenceSources.map((source) => source.id),
          documents: [],
          suppliedPages,
          provenance: {
            domains: [],
            models: {
              collate: {
                provider: context.settings.collateModel.provider,
                model: context.settings.collateModel.model,
              },
            },
          },
        };
        const report = `# ${params.query}\n\n## Summary\n\n${summary}${inventory(manifestSources)}`;
        artifacts.push(
          { relativePath: "query.txt", kind: "query", bytes: bytes(params.query) },
          { relativePath: "report.md", kind: "report", bytes: bytes(report) },
          {
            relativePath: "run.json",
            kind: "manifest-data",
            bytes: bytes(JSON.stringify(manifest)),
          },
        );
        const committed = await services.runs.commit(reservation, artifacts, signal);
        if (committed.status === "unavailable") unavailable(committed.diagnostic);
        else {
          const run = committed.run;
          cache = {
            status: "committed",
            runId: reservation.runId,
            reportPath: join(reservation.displayPath, "report.md"),
            index: "unavailable",
            ...(persistenceDiagnostic ? { diagnostic: persistenceDiagnostic } : {}),
          };
          sources = manifestSources.map(({ input: _input, ...source }) => ({
            ...source,
            ...(source.extractionPath
              ? { extractionPath: join(reservation!.displayPath, source.extractionPath) }
              : {}),
            ...(source.fullPagePath
              ? { fullPagePath: join(reservation!.displayPath, source.fullPagePath) }
              : {}),
          }));
          details = { ...details, cachePath: reservation.displayPath };
          throwIfAborted(signal); // A committed marker is never rolled back by cancellation.
          const index = await services.runs.updateIndex(run, params.query, signal);
          cache = { ...cache, index };
          if (index === "unavailable" && !persistenceDiagnostic)
            diagnostic({
              code: "INDEX_UNAVAILABLE",
              message: "The committed report is preserved but its suggestion index was not updated",
            });
          throwIfAborted(signal);
          // No suggestion/model work follows manual collation. Preserve the same
          // final ledger and its insertion order; do not reconstruct or sort it.
          const accounting = await services.runs.recordAccounting(
            run,
            services.ledger.records(),
            services.ledger.summary(),
            signal,
          );
          if (accounting.status === "recorded")
            cache = { ...cache, accountingPath: accounting.path };
          else diagnostic(accounting.diagnostic);
        }
      }
      throwIfAborted(signal);
      answer();
      return { text, details, outcome: "completed" };
    },
    /** Invoke exactly once, after the registered runtime has actually drained. */
    settled(
      _result: OperationResult | undefined,
      failure?: { readonly message: string; readonly aborted: boolean },
      parentDelivery: AccountingSummary["parentDelivery"] = "available",
    ): CoreResult {
      if (!services || !active || ended) throw new TypeError("Collate projection is not pending");
      ended = true;
      removeAbort?.();
      const elapsedMs = Math.max(0, clock.monotonicMs() - started);
      const outcome = failure ? (failure.aborted ? "aborted" : "error") : "completed";
      answer();
      const resultText = failure ? failure.message : text;
      const used = sources.filter((source) => source.state === "used").length;
      const counts: Counts = {
        candidates: sources.length,
        fetched: 0,
        extracted: used,
        used,
        late: 0,
        failed: sources.filter(
          (source) => source.state === "empty" || source.state === "extract-failed",
        ).length,
        cancelled: 0,
        effectivePageConcurrency,
      };
      const data: FullData = {
        schemaVersion: 1,
        operation: "intelli_collate",
        operationId: services.operation.id,
        outcome,
        text: resultText,
        details,
        summary,
        sources,
        cache,
        related: [],
        counts,
        timing: {
          startedUtc,
          elapsedMs,
          allWorkSettledMs: elapsedMs,
          ...(summaryReadyMs === undefined ? {} : { summaryReadyMs }),
          ...(failure?.aborted && abortAt !== undefined
            ? { abortToSettledMs: Math.max(0, clock.monotonicMs() - abortAt) }
            : {}),
        },
        accounting: services.ledger.summary(parentDelivery),
        attempts: services.ledger.records(),
        deadline: { enabled: false, reason: "not-applicable", minimumMet: true },
      };
      if (!failure) pct = 100;
      emit(
        "end",
        failure ? (failure.aborted ? "cancelled" : "failed") : "succeeded",
        failure ? failure.message : "Completed",
      );
      return { text: resultText, details, outcome, data, usage: services.ledger.hostUsage() };
    },
  };
}
