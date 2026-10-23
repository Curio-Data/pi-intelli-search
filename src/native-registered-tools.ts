// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { OperationInputs } from "./core/contracts.js";
import type { OnUpdate } from "./host-types.js";
import type { createNativeOperationRuntime } from "./native-operation-runtime.js";
import { intelliSearchTool } from "./tools/intelli-search.js";
import { intelliExtractTool } from "./tools/intelli-extract.js";
import { intelliCollateTool } from "./tools/intelli-collate.js";
import { intelliResearchTool } from "./tools/intelli-research.js";

/** Preserve renderers and legacy helper isolation; registered research is C20 parallel-capable. */
export function createRegisteredNativeTools(
  runtime: ReturnType<typeof createNativeOperationRuntime>,
) {
  const execute =
    <Name extends keyof OperationInputs>(name: Name) =>
    (
      _toolCallId: string,
      params: OperationInputs[Name],
      signal: AbortSignal | undefined,
      onUpdate: OnUpdate | undefined,
      ctx: ExtensionContext,
    ) =>
      runtime.execute(name, params, signal, onUpdate, ctx);
  return [
    { ...intelliSearchTool, execute: execute("intelli_search") },
    { ...intelliExtractTool, execute: execute("intelli_extract") },
    {
      ...intelliCollateTool,
      description:
        "Deduplicate and synthesise multiple per-page extractions into a single concise summary. " +
        "A saved report goes into a new run directory under .search/.intelli-v1/runs/ " +
        "(or the configured cacheDir), without replacing earlier reports. " +
        "A valid answer is still returned when persistence is unavailable. " +
        "Use this after extracting multiple pages with intelli_extract; for end-to-end research, use intelli_research.",
      // Shared secondary index replacement keeps the inherited destructive hint.
      execute: execute("intelli_collate"),
    },
    {
      ...intelliResearchTool,
      description:
        "Search the web, fetch top results, extract relevant content from each page, " +
        "and deduplicate into a concise summary. A saved report goes into a new run directory " +
        "under .search/.intelli-v1/runs/ (or the configured cacheDir), without replacing earlier reports. " +
        "Degraded results save no report; a valid answer is still returned when persistence is unavailable. " +
        "This is the primary research tool; for quick factual lookups, use intelli_search instead.",
      // The accepted operation runtime owns admission, publication and drain.
      // Retaining the legacy sequential hint also serialises nested Codemode
      // calls, preventing the C20/T30 parallel population from running at all.
      // An SDK host's agent-wide sequential mode still wins; collate stays
      // serial. Pi 1.1/1.3 expose no stock CLI flag/settings key for that mode.
      executionMode: "parallel" as const,
      execute: execute("intelli_research"),
    },
  ] as const;
}
