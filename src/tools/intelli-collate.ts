// src/tools/intelli-collate.ts — intelli_collate tool
//
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
// SPDX-License-Identifier: Apache-2.0
import { Type } from "typebox";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { COLLATION_SYSTEM_PROMPT } from "../prompts.js";
import { callLlm } from "../llm.js";
import {
  makeCachePath,
  writeCacheFiles,
  writeReportFile,
  cacheLockDir,
  indexLockDir,
  withLock,
  updateIndex,
} from "../cache.js";
import { textContent } from "../util.js";
import { loadSettings, resolveModelConfig } from "../settings.js";
import { buildCollationMessage, formatCacheAppendix } from "./shared.js";
import type { ExtractResult, OnUpdate } from "../types.js";

const extractionSchema = Type.Object({
  url: Type.String(),
  title: Type.String(),
  extraction: Type.String(),
  sourceType: Type.String(),
  status: Type.String(),
});

const fullPageSchema = Type.Object({
  url: Type.String(),
  title: Type.String(),
  content: Type.String(),
});

export const intelliCollateTool = {
  name: "intelli_collate",
  label: "Intelli Collate",
  description:
    "Deduplicate and synthesise multiple per-page extractions into a single " +
    "concise summary. Caches results to .search/ for follow-up. Use this " +
    "after extracting multiple pages with intelli_extract; for end-to-end " +
    "research, use intelli_research.",
  promptSnippet:
    "intelli_collate(extractions, query): deduplicate and synthesise extractions into concise summary",
  executionMode: "sequential" as const,
  parameters: Type.Object({
    extractions: Type.Array(extractionSchema, {
      description: "Array of per-page extraction results from intelli_extract",
    }),
    query: Type.String({ description: "The original search query" }),
    searchSummary: Type.Optional(
      Type.String({
        description: "Summary from the initial search step",
      }),
    ),
    fullPages: Type.Optional(
      Type.Array(fullPageSchema, {
        description: "Full page content for caching (not sent to LLM)",
      }),
    ),
  }),

  async execute(
    _toolCallId: string,
    params: {
      extractions: Array<{
        url: string;
        title: string;
        extraction: string;
        sourceType: string;
        status: string;
      }>;
      query: string;
      searchSummary?: string;
      fullPages?: Array<{ url: string; title: string; content: string }>;
    },
    signal: AbortSignal | undefined,
    _onUpdate: OnUpdate | undefined,
    ctx: ExtensionContext,
  ) {
    const settings = await loadSettings({
      cwd: ctx.cwd,
      projectTrusted: ctx.isProjectTrusted(),
    });
    const collateConfig = resolveModelConfig(settings, "collate");

    const cachePath = makeCachePath(params.query, ctx.cwd, settings.cacheDir);
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
    const collation = await callLlm(ctx, collateConfig, COLLATION_SYSTEM_PROMPT, userMessage, {
      maxTokens: settings.collationMaxTokens,
      signal,
    });

    // ═══════════════════════════════════════════════════════════════
    // Write cache artifacts under the per-cache-path lock so two
    // concurrent same-query runs do not interleave file writes.
    // ═══════════════════════════════════════════════════════════════
    await withLock(cacheLockDir(cachePath), async () => {
      // Write cache files (staging-based atomic, no partial visibility)
      await writeCacheFiles(
        cachePath,
        extractResults,
        fetchedPages,
        params.searchSummary ?? "",
        params.query,
      );

      // Write report (atomic via temp-file + rename)
      await writeReportFile(cachePath, params.query, collation, extractResults, fetchedPages);

      // Atomic index update under the shared cache-dir index lock.
      await withLock(indexLockDir(settings.cacheDir), async () => {
        const slug = cachePath.split("/").pop() ?? cachePath;
        await updateIndex(settings.cacheDir, slug, params.query);
      });
    });

    return {
      content: [
        textContent(collation + formatCacheAppendix(cachePath, succeeded.length, blocked.length)),
      ],
      details: { cachePath, sourcesFetched: succeeded.length + blocked.length },
    };
  },
};
