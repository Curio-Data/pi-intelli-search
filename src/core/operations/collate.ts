// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { COLLATION_SYSTEM_PROMPT } from "../prompts.js";
import type { CollateParams } from "../contracts.js";
import { displayCachePath } from "../paths.js";
import {
  makeCachePath,
  writeCacheFiles,
  writeReportFile,
  cacheLockDir,
  indexLockDir,
  withLock,
  updateIndex,
} from "../cache.js";
import { buildCollationMessage, formatCacheAppendix } from "../messages.js";
import type { ExtractResult } from "../types.js";
import { throwIfAborted } from "../util.js";
import type { OperationContext, OperationResult } from "../contracts.js";

export async function collate(
  params: CollateParams,
  context: OperationContext,
): Promise<OperationResult> {
  const { settings, models, signal } = context;
  throwIfAborted(signal);
  const collateConfig = settings.collateModel;

  const paths = context.paths;
  const physicalPath = makeCachePath(params.query, paths.workspaceRoot, paths.cacheRoot);
  const cachePath = displayCachePath(paths, physicalPath);
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

  // Build collation prompt (no files written yet — lock is never held
  // across an LLM call).
  const userMessage = buildCollationMessage(
    params.query,
    cachePath,
    params.searchSummary,
    extractResults.filter((e) => e.status === "success"),
  );

  // Call LLM for collation (no lock — never hold locks across LLM calls)
  const { text: collation } = await models.complete({
    model: collateConfig,
    systemPrompt: COLLATION_SYSTEM_PROMPT,
    userMessage,
    maxTokens: settings.collationMaxTokens,
    signal,
  });

  // ═══════════════════════════════════════════════════════════════
  // Write cache artifacts under the per-cache-path lock so two
  // concurrent same-query runs do not interleave file writes.
  // ═══════════════════════════════════════════════════════════════
  await withLock(
    cacheLockDir(physicalPath),
    async () => {
      // Write cache files (staging-based atomic, no partial visibility)
      await writeCacheFiles(
        physicalPath,
        extractResults,
        fetchedPages,
        params.searchSummary ?? "",
        params.query,
      );

      // Write report (atomic via temp-file + rename)
      await writeReportFile(
        physicalPath,
        params.query,
        collation,
        extractResults,
        fetchedPages,
        cachePath,
      );

      // Atomic index update under the shared cache-dir index lock.
      await withLock(
        indexLockDir(paths.cacheRoot),
        async () => {
          const slug = physicalPath.split("/").pop() ?? physicalPath;
          await updateIndex(paths.cacheRoot, slug, params.query);
        },
        signal,
      );
    },
    signal,
  );

  return {
    text: collation + formatCacheAppendix(cachePath, succeeded.length, blocked.length),
    outcome: "completed",
    details: { cachePath, sourcesFetched: succeeded.length + blocked.length },
  };
}
