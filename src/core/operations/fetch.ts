// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type {
  Context,
  CoreResult,
  FetchParams,
  FullData,
  NumericHostUsage,
  OperationFailure,
  Progress,
  SourceRecord,
} from "../contracts.js";
import { AdmissionError } from "../execution-coordinator.js";
import { FetchConfigurationError } from "../page-runtime.js";
import { validatePageTransportUrl } from "../page-transport.js";

export class FetchOperationFailure extends Error implements OperationFailure {
  constructor(
    message: string,
    readonly data: FullData,
    readonly usage: NumericHostUsage,
  ) {
    super(message);
    this.name = "FetchOperationFailure";
  }
}

/** Host-neutral R1 operation only. No registration, model call or persistence. */
export async function fetchPage(params: FetchParams, context: Context): Promise<CoreResult> {
  const input = { ...params };
  validatePageTransportUrl(input.url);
  if (input.maxChars !== undefined && (!Number.isSafeInteger(input.maxChars) || input.maxChars < 1))
    throw new TypeError("maxChars must be a positive integer");
  const { operation, clock, ledger, fetch, onProgress } = context.services;
  const started = clock.monotonicMs();
  const startedUtc = clock.utcIso();
  let abortAt: number | undefined;
  const onAbort = () => {
    abortAt ??= clock.monotonicMs();
  };
  if (operation.signal.aborted) onAbort();
  else operation.signal.addEventListener("abort", onAbort, { once: true });
  let sequence = 0;
  const emit = (
    event: Progress["event"],
    state: Progress["state"],
    message: string,
    pct: number,
  ) => {
    try {
      onProgress?.({
        operationId: operation.id,
        sequence: ++sequence,
        stage: "fetch",
        event,
        state,
        message,
        elapsedMs: Math.max(0, clock.monotonicMs() - started),
        pageId: "S1",
        workStage: "fetch",
        stageIdx: 0,
        totalStages: 1,
        pct,
      });
    } catch {
      /* A renderer cannot discard a settled result. */
    }
  };
  let page: SourceRecord = { id: "S1", url: input.url, title: "", state: "fetch-failed" };
  let transferredBytes = 0;
  let failed = false;
  emit("start", "running", "Fetching...", 0);
  try {
    const result = await fetch.fetch(input, operation, { pageId: "S1" });
    page = result.page;
    transferredBytes = result.transferredBytes;
    if (operation.signal.aborted) throw operation.signal.reason;
  } catch (error) {
    failed = true;
    const cancelled =
      operation.signal.aborted ||
      (error instanceof Error &&
        "code" in error &&
        ["ABORTED", "CLOSED", "PAGE_CUTOFF"].includes(String(error.code)));
    page = {
      id: "S1",
      url: input.url,
      title: "",
      state: cancelled ? "cancelled" : "fetch-failed",
      diagnostic: cancelled
        ? "FETCH_CANCELLED"
        : error instanceof AdmissionError && error.code === "BUSY"
          ? "BUSY"
          : error instanceof FetchConfigurationError
            ? "INVALID_FETCH_CONFIGURATION"
            : error instanceof TypeError
              ? "INVALID_FETCH_ARGUMENTS"
              : "TRANSPORT_FAILED",
    };
  } finally {
    operation.signal.removeEventListener("abort", onAbort);
  }
  const outcome = failed
    ? page.state === "cancelled"
      ? "aborted"
      : "error"
    : page.state === "fetch-failed"
      ? "fetch-failed"
      : "completed";
  const text =
    outcome === "aborted"
      ? "Fetch cancelled"
      : outcome === "error"
        ? "Fetch failed"
        : page.state === "fetch-failed"
          ? `Fetch failed: ${page.diagnostic ?? "TRANSPORT_FAILED"}`
          : `Fetched ${page.content?.length ?? 0} characters${page.truncated ? " (truncated)" : ""}.`;
  const elapsedMs = Math.max(0, clock.monotonicMs() - started);
  const details = { url: input.url, transferredBytes, truncated: page.truncated ?? false };
  const data: FullData = {
    schemaVersion: 1,
    operation: "intelli_fetch",
    operationId: operation.id,
    outcome,
    text,
    details,
    summary: text,
    sources: [page],
    cache: { status: "not-requested" },
    related: [],
    counts: {
      candidates: 1,
      fetched: ["fetched", "empty"].includes(page.state) ? 1 : 0,
      extracted: 0,
      used: 0,
      late: 0,
      failed: ["fetch-failed", "empty"].includes(page.state) ? 1 : 0,
      cancelled: page.state === "cancelled" ? 1 : 0,
      effectivePageConcurrency: Math.min(
        context.settings.extractionConcurrency,
        context.settings.execution!.modelConcurrency - context.settings.execution!.criticalReserve,
      ),
    },
    timing: {
      startedUtc,
      elapsedMs,
      allWorkSettledMs: elapsedMs,
      ...(abortAt === undefined
        ? {}
        : { abortToSettledMs: Math.max(0, clock.monotonicMs() - abortAt) }),
    },
    accounting: ledger.summary(outcome === "aborted" ? "unknown" : "available"),
    attempts: ledger.records(),
    deadline: { enabled: false, reason: "not-applicable", minimumMet: true },
  };
  emit(
    "end",
    outcome === "aborted"
      ? "cancelled"
      : ["error", "fetch-failed"].includes(outcome)
        ? "failed"
        : "succeeded",
    text,
    failed ? 0 : 100,
  );
  const usage = ledger.hostUsage();
  if (failed) throw new FetchOperationFailure(text, data, usage);
  return { text, details, outcome, data, usage };
}
