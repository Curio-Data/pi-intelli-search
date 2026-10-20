// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type {
  AccountingSummary,
  CoreResult,
  Counts,
  ExtractParams,
  FullData,
  OperationContext,
  OperationResult,
  OperationServices,
  Progress,
  SearchParams,
  SourceRecord,
  Clock,
} from "./contracts.js";

export type ProjectedStandalone = "intelli_search" | "intelli_extract";

/** Registered boundary state. Final projection is deliberately after runtime.run drains. */
export function createStandaloneResult(
  name: ProjectedStandalone,
  params: SearchParams | ExtractParams,
  clock: Clock,
  onProgress?: (event: Progress) => void,
  onDiagnostic?: (diagnostic: { code: string; message: string }) => void,
) {
  const started = clock.monotonicMs();
  const startedUtc = clock.utcIso();
  const stage = name === "intelli_search" ? "search" : "extract";
  let services: OperationServices | undefined;
  let effectivePageConcurrency = 0;
  let sequence = 0;
  let running = false;
  let ended = false;
  let abortAt: number | undefined;
  let removeAbort: (() => void) | undefined;
  let completedResult: OperationResult | undefined;
  const emit = (
    event: Progress["event"],
    state: Progress["state"],
    message: string,
    pct: number,
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
        elapsedMs: Math.max(0, clock.monotonicMs() - started),
        stageIdx: 0,
        totalStages: 1,
        pct,
        ...(stage === "extract" ? { pageId: "S1", workStage: "extract" as const } : {}),
      });
    } catch {
      try {
        onDiagnostic?.({ code: "PROGRESS_DELIVERY_FAILED", message: "Progress delivery failed" });
      } catch {
        /* Rendering cannot replace the result. */
      }
    }
  };
  return {
    get active() {
      return running;
    },
    dispose() {
      removeAbort?.();
    },
    /** Call only at the registered operation body, after operational preflight. */
    async run(
      context: OperationContext,
      execute: (context: OperationContext) => Promise<OperationResult>,
    ) {
      if (running || !context.services)
        throw new TypeError("Standalone projection requires one scoped operation");
      services = context.services;
      if (services.clock !== clock || context.signal !== services.operation.signal)
        throw new TypeError("Standalone projection must use the authoritative clock and signal");
      const execution = context.settings.execution!;
      effectivePageConcurrency = Math.min(
        context.settings.extractionConcurrency,
        execution.modelConcurrency - execution.criticalReserve,
      );
      running = true;
      const signal = services.operation.signal;
      const aborted = () => {
        abortAt ??= clock.monotonicMs();
      };
      if (signal.aborted) aborted();
      else signal.addEventListener("abort", aborted, { once: true });
      removeAbort = () => signal.removeEventListener("abort", aborted);
      emit("start", "running", name === "intelli_search" ? "Searching..." : "Extracting...", 0);
      // The existing operations supply retry notices here. The outer registered
      // boundary owns correlation and final delivery, not a second model policy.
      completedResult = await execute({
        ...context,
        onProgress: (progress) => emit("retry", "running", progress.message, 0),
      });
      return completedResult;
    },
    /** The caller must await runtime settlement before invoking this exactly once. */
    settled(
      result: OperationResult | undefined,
      failure?: { readonly message: string; readonly aborted: boolean },
      parentDelivery: AccountingSummary["parentDelivery"] = "available",
    ): CoreResult {
      if (!services || !running || ended)
        throw new TypeError("Standalone projection is not pending");
      ended = true;
      removeAbort?.();
      const elapsedMs = Math.max(0, clock.monotonicMs() - started);
      result ??= completedResult;
      const outcome = failure ? (failure.aborted ? "aborted" : "error") : result!.outcome;
      const text = failure ? failure.message : result!.text;
      // Both standalone implementations have JSON-only legacy details. Do not
      // add the native reconstruction field to this object (it would recurse).
      const details = (result?.details ?? {}) as FullData["details"];
      let sources: SourceRecord[] = [];
      if (name === "intelli_search" && result) {
        const candidates = details.sources as unknown as Array<{ url: string; title: string }>;
        sources = candidates.map((source, i) => ({
          ...source,
          id: `S${i + 1}`,
          state: "candidate",
        }));
      } else if (name === "intelli_extract") {
        const input = params as ExtractParams;
        const extraction = result ? String(details.extraction) : undefined;
        sources = [
          {
            id: "S1",
            url: input.url,
            title: input.title,
            state:
              extraction === undefined
                ? failure?.aborted
                  ? "cancelled"
                  : "extract-failed"
                : extraction.trim()
                  ? "used"
                  : "empty",
            ...(extraction === undefined
              ? {}
              : { extraction, sourceType: String(details.sourceType) }),
            ...(failure ? { diagnostic: failure.message } : {}),
          },
        ];
      }
      const used = sources.filter((source) => source.state === "used").length;
      const counts: Counts = {
        candidates: sources.length,
        fetched: 0,
        extracted: used,
        used,
        late: 0,
        failed: sources.filter((source) => ["extract-failed", "empty"].includes(source.state))
          .length,
        cancelled: sources.filter((source) => source.state === "cancelled").length,
        effectivePageConcurrency,
      };
      const data: FullData = {
        schemaVersion: 1,
        operation: name,
        operationId: services.operation.id,
        outcome,
        text,
        details,
        summary: name === "intelli_extract" && result ? String(details.extraction) : text,
        sources,
        cache: { status: "not-requested" },
        related: [],
        counts,
        timing: {
          startedUtc,
          elapsedMs,
          allWorkSettledMs: elapsedMs,
          ...(failure?.aborted && abortAt !== undefined
            ? { abortToSettledMs: Math.max(0, clock.monotonicMs() - abortAt) }
            : {}),
        },
        accounting: services.ledger.summary(parentDelivery),
        attempts: services.ledger.records(),
        deadline: { enabled: false, reason: "not-applicable", minimumMet: true },
      };
      emit(
        "end",
        failure ? (failure.aborted ? "cancelled" : "failed") : "succeeded",
        failure ? text : "Completed",
        failure ? 0 : 100,
      );
      return { text, details, outcome, data, usage: services.ledger.hostUsage() };
    },
  };
}
