// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { OperationProgress, ResearchParams, ResearchStage } from "../core/contracts.js";
import { research, MissingModelsError } from "../core/operations/research.js";
import { researchSchema } from "../core/schemas.js";
import { STAGES, progress } from "../core/progress.js";
import {
  createNativeOperationContext,
  nativeResult,
  nativeProgress,
} from "../native-operation-context.js";
import type { ToolResultLike, OnUpdate, PiTheme } from "../host-types.js";
import { callLlm } from "../llm.js";
import { fetchPages } from "../fetch.js";
import { downloadLlmsFullToCache } from "../fetch.js";
export { validateModelConfigs } from "../native-model-client.js";

type ProgressDetails = OperationProgress;
type StageName = ResearchStage;
const STAGE_LABELS: Record<StageName, string> = {
  search: "Search",
  fetch: "Fetch",
  extract: "Extract",
  collate: "Collate",
  cache: "Cache",
};

// Legacy native test seam only. Shared operations use per-run dependencies.
export const __harness = { callLlm, fetchPages };

export const intelliResearchTool = {
  name: "intelli_research",
  label: "Intelli Research",
  description:
    "Search the web, fetch top results, extract relevant content from each " +
    "page, and deduplicate into a concise summary. Caches all results under " +
    ".search/ for follow-up; a successful repeat on the same UTC date " +
    "archives the previous results to a numbered .1 sibling folder before " +
    "writing fresh ones, and a degraded repeat leaves the previous report " +
    "untouched. This is the primary research tool; for quick " +
    "factual lookups, use intelli_search instead.",
  promptSnippet:
    "intelli_research(query): full search → fetch → extract → collate pipeline with caching",
  executionMode: "sequential" as const,
  promptGuidelines: [
    "Use intelli_research when the user needs current web information (docs, APIs, best practices, library updates). For quick factual questions, use intelli_search alone.",
    "Use maxUrls to control breadth: 3 for targeted, 10 (default) for broad, 16 for exhaustive. The setting caps requests at maxUrls (default 20).",
    "Always provide focusPrompt to guide extraction. Without it the LLM extracts generically. Translate the user's intent into a specific extraction focus.",
    "The tool result contains a concise summary — use it directly. Only read .search/ cache files when the summary is insufficient.",
    "Use domains to target specific sites (e.g., ['docs.python.org']) when the user references a specific documentation source.",
  ],
  parameters: researchSchema,

  renderResult(
    result: ToolResultLike,
    { isPartial }: { isPartial: boolean; expanded: boolean },
    theme: PiTheme,
    _context: unknown,
  ): Text {
    if (isPartial && result.details?.stage) {
      return renderProgressBar(result.details as unknown as ProgressDetails, theme);
    }
    // Final result: show the collated summary text (compact fallback)
    const content = result.content?.[0];
    const text = content?.type === "text" ? content.text : "";
    return new Text(text, 0, 0);
  },

  async execute(
    _toolCallId: string,
    params: ResearchParams,
    signal: AbortSignal | undefined,
    onUpdate: OnUpdate | undefined,
    ctx: ExtensionContext,
  ) {
    const context = await createNativeOperationContext(ctx, signal, __harness.callLlm);
    const ui = ctx.ui as {
      setWorkingIndicator?(opts?: { frames?: string[]; intervalMs?: number }): void;
    };
    let started = false;
    const models = {
      ...context.models,
      async preflight(bindings: Parameters<typeof context.models.preflight>[0]) {
        const missing = await context.models.preflight(bindings);
        if (!missing.length) {
          ui.setWorkingIndicator?.({ frames: ["🔍", "🌐", "📄", "✨"], intervalMs: 400 });
          started = true;
        }
        return missing;
      },
    };
    try {
      return nativeResult(
        await research(
          params,
          {
            ...context,
            models,
            onProgress: (details) => onUpdate?.(nativeProgress(details)),
          },
          { fetchPages: __harness.fetchPages, downloadLlmsFullToCache },
        ),
      );
    } catch (err) {
      if (err instanceof MissingModelsError) {
        const lines = err.bindings.map(
          (m) => `  ${m.role}: ${m.config.provider}/${m.config.model}`,
        );
        throw new Error(
          `Configured model(s) not found in Pi's model registry:\n${lines.join("\n")}\n` +
            `Check your settings.json for typos or missing provider configuration. ` +
            `Run /login to add API keys, or /model to see available models.`,
        );
      }
      throw err;
    } finally {
      if (started) ui.setWorkingIndicator?.();
    }
  },
};

export function progressUpdate(
  stage: StageName,
  message: string,
  subProgress?: { current: number; total: number },
) {
  return nativeProgress(progress(stage, message, subProgress));
}

/**
 * Render a progress bar showing pipeline stage completion for the TUI.
 * Called by renderResult when isPartial is true during tool streaming.
 * Shows overall bar, stage pills, current message, and optional sub-progress.
 */
export function renderProgressBar(details: ProgressDetails, theme: PiTheme): Text {
  const { stage, stageIdx, totalStages, message, subProgress } = details;

  // Overall progress bar
  const barWidth = 20;
  const filled = Math.round(((stageIdx + 1) / totalStages) * barWidth);
  const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
  const pct = Math.round(((stageIdx + 1) / totalStages) * 100);

  // Stage pills: ✓ for done, ● for current, ○ for pending
  const pills = STAGES.map((s, i) => {
    const label = STAGE_LABELS[s];
    if (i < stageIdx) return theme.fg("success", `✓ ${label}`);
    if (i === stageIdx) return theme.fg("accent", theme.bold(`● ${label}`));
    return theme.fg("dim", `○ ${label}`);
  }).join("  ");

  let text = theme.fg("accent", `[${bar}] ${pct}%`) + "\n";
  text += pills + "\n";
  text += theme.fg("dim", message);

  // Sub-progress bar for stages with per-item progress (e.g. extraction)
  if (subProgress) {
    const subFilled = Math.round((subProgress.current / subProgress.total) * barWidth);
    const subBar = "▐".repeat(subFilled) + "░".repeat(barWidth - subFilled);
    text += "\n  " + theme.fg("muted", `╰ [${subBar}] ${subProgress.current}/${subProgress.total}`);
  }

  return new Text(text, 0, 0);
}
