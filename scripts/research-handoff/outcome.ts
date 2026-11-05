// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type { RunRecord } from "./contracts.js";

/** Interpret retained events without rewriting a historical record's label. */
export function observedPipelineOutcome(record: Pick<RunRecord, "adapterEvents" | "error">): string {
  const events = record.adapterEvents;
  const result = [...events].reverse().find(event => event.kind === "research-result");
  if (events.some(event => event.kind === "research-error" || event.kind === "input-control-failed")) return "error";
  if (typeof result?.data.outcome === "string") return result.data.outcome;
  if (record.error) return "error";
  if (events.some(event => event.kind === "research-admitted" || event.kind === "pipeline-attempt"
    || event.kind === "model-request" || event.kind === "search-replayed" || event.kind === "fetch-served")) return "incomplete";
  return "not-started";
}
