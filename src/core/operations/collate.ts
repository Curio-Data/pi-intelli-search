// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { COLLATION_SYSTEM_PROMPT } from "../prompts.js";
import type { CollateParams } from "../contracts.js";
import { displayCachePath } from "../paths.js";
import { MAX_OUTPUT_TOKENS } from "../defaults.js";
import { planCollationBudget, inferredSource } from "../collation-budget.js";
import {
  makeCachePath,
  writeCacheFiles,
  writeReportFile,
  cacheLockDir,
  indexLockDir,
  withLock,
  updateIndex,
  allocateSourceIdentity,
  rotateCacheArtefacts,
} from "../cache.js";
import { buildCollationMessage, MANUAL_COLLATION_NO_EVIDENCE_MESSAGE, CollationNoEvidenceError, deliveredInputBudget, formatCacheAppendix, formatCollationTrimNotice } from "../messages.js";
import { evidenceExtractions, finalizeCollation } from "../provenance.js";
import type { ExtractResult } from "../types.js";
import { errMsg, throwIfAborted, completionTruncated } from "../util.js";
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
  // Build extract results for cache. The optional truncated/error flags a
  // caller copied from intelli_extract results survive into cache writes,
  // the inventory rendering and the appendix instead of being dropped.
  const extractResults: ExtractResult[] = params.extractions.map((e) => ({
    url: e.url,
    title: e.title,
    extraction: e.extraction,
    sourceType: e.sourceType,
    currentness: "undated",
    status: e.status === "success" && !e.extraction.trim()
      ? "failed" : e.status as ExtractResult["status"],
    ...(e.inferred ? { inferred: true } : {}),
    ...(e.truncated ? { truncated: true } : {}),
    ...(e.error ? { error: e.error } : {}),
  }));
  const succeeded = evidenceExtractions(extractResults);
  const blocked = extractResults.filter((e) => e.status !== "success");
  if (succeeded.length === 0) throw new Error("Collation requires at least one successful, non-empty extraction");

  const fetchedPages = (params.fullPages ?? []).map((p) => ({
    url: p.url,
    title: p.title,
    content: p.content,
    status: "success" as const,
  }));

  // Allocate source file identity once: physical cache files, the collation
  // prompt and the report all cite these exact filenames. Manual collation
  // may supply optional or reordered full pages; URL-keyed slots keep every
  // advertised path pointing at a file this run actually writes.
  const identity = allocateSourceIdentity(extractResults, fetchedPages);

  // Build collation prompt (no files written yet — lock is never held
  // across an LLM call). The input budget is enforced here too, from the
  // supplied extractions' actual sizes, so a manual collation of heavy
  // extractions is trimmed the same way the research pipeline trims it.
  const budget = planCollationBudget(
    succeeded.map((ext) => ({
      url: ext.url,
      text: ext.extraction,
      ...(inferredSource(ext) ? { inferred: true } : {}),
    })),
    {
      budgetTokens: settings.collationInputBudgetTokens,
      sourceMaxTokens: settings.collationSourceMaxTokens,
    },
  );
  const evidence = succeeded.map((ext, index) => ({
    ...ext,
    sourceNumber: index + 1,
    extraction: budget.sources[index]?.text ?? ext.extraction,
  }));
  const inputBudget = deliveredInputBudget(budget, evidence);
  const suppliedSourceNumbers = new Set(
    evidenceExtractions(evidence).map((ext) => ext.sourceNumber ?? 0),
  );
  if (suppliedSourceNumbers.size === 0) {
    throw new CollationNoEvidenceError(MANUAL_COLLATION_NO_EVIDENCE_MESSAGE, inputBudget);
  }
  const userMessage = buildCollationMessage(
    params.query,
    cachePath,
    params.searchSummary,
    evidence,
    identity,
  );

  // Call LLM for collation (no lock — never hold locks across LLM calls)
  const completion = await models.complete({
    model: collateConfig,
    systemPrompt: COLLATION_SYSTEM_PROMPT,
    userMessage,
    maxTokens: settings.collationMaxTokens,
    signal,
  });

  let collation = finalizeCollation(
    completion.text,
    cachePath,
    succeeded,
    identity,
    "supplied",
    suppliedSourceNumbers,
  );

  // Mirrors the research path: a synthesis cut off by the output cap still
  // commits, but the reader must know it may end mid-sentence. A cap already
  // at the ceiling is not told to rise.
  if (completionTruncated(completion, settings.collationMaxTokens)) {
    collation +=
      `\n\n> ⚠ Collation output reached collationMaxTokens (${settings.collationMaxTokens}); ` +
      `the synthesis may be cut off mid-sentence. ` +
      (settings.collationMaxTokens >= MAX_OUTPUT_TOKENS
        ? `collationMaxTokens is already the maximum the settings accept; re-run, or choose a collation model that reasons less, if completeness matters.`
        : `Raise collationMaxTokens or re-run if completeness matters.`);
  }

  // Say what the collation model did not receive, and where the full text is.
  if (budget.trims.length > 0) {
    collation += formatCollationTrimNotice(budget, identity, cachePath, inputBudget.charsAfter, "collate");
  }

  // ═══════════════════════════════════════════════════════════════
  // Write cache artefacts under the per-cache-path lock so two
  // concurrent same-query runs do not interleave file writes. A previous
  // run's artefact set is archived to a numbered sibling folder before
  // this run commits its own.
  // ═══════════════════════════════════════════════════════════════
  await withLock(
    cacheLockDir(physicalPath),
    async () => {
      // Archive the previous run before committing this one (success path
      // only: the new collation is already in hand). Best-effort: a failure
      // falls back to in-place replacement.
      await rotateCacheArtefacts(physicalPath).catch((error) => {
        context.logger.error(`Cache archive failed: ${errMsg(error)}`);
      });

      // Write cache files (staging-based per-file atomic replacement under
      // the lock; obsolete artefacts from a previous run are pruned)
      await writeCacheFiles(
        physicalPath,
        extractResults,
        fetchedPages,
        params.searchSummary ?? "",
        params.query,
        identity,
      );

      // Write report (atomic via temp-file + rename)
      await writeReportFile(
        physicalPath,
        params.query,
        collation,
        extractResults,
        fetchedPages,
        cachePath,
        identity,
        true,
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

  const failedEntries = extractResults
    .filter((e) => e.status !== "success")
    .map((e) => ({
      url: e.url,
      ...(e.error ? { error: e.error } : {}),
      ...(identity.sourceFileFor(e.url)
        ? { sourceFile: `sources/${identity.sourceFileFor(e.url)}` }
        : {}),
    }));
  const truncatedCount = succeeded.filter((e) => e.truncated).length;
  return {
    text: collation + formatCacheAppendix(cachePath, succeeded.length, blocked.length, failedEntries, truncatedCount),
    outcome: "completed",
    details: { cachePath, sourcesFetched: succeeded.length + blocked.length },
  };
}
