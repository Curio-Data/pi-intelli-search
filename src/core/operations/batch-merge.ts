// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Expansion-mode merge for batch research (docs/proposals/BATCH-RESEARCH.md,
// Phase 3): one collation call over the completed entries' summaries, with
// their [S<n>] identifiers renumbered into one batch-wide series deduplicated
// by URL, validated by the ordinary collation provenance rules.

import type { OperationContext } from "../contracts.js";
import type { ExtractResult } from "../types.js";
import { SUPER_COLLATION_SYSTEM_PROMPT } from "../prompts.js";
import {
  SOURCE_ASSESSMENT_PREAMBLE,
  cell,
  citationProseMask,
  codeBlockProse,
  pageUrl,
  closeOpenFence,
  evidenceExtractions,
  validateSynthesis,
} from "../provenance.js";
import { CHARS_PER_TOKEN } from "../collation-budget.js";
import { errMsg, failureDetail } from "../util.js";
import { completeSynthesis, SynthesisRejectedError, type ResearchSynthesis } from "./research.js";

/** One completed entry offered to the merge. */
export interface MergeMember {
  /** 1-based position in the caller's list. */
  position: number;
  query: string;
  focusPrompt?: string;
  synthesis: ResearchSynthesis;
}

/** One page in the batch-wide inventory. */
export interface BatchSource {
  /** Batch-wide identifier number: the page is `S<id>`. */
  id: number;
  url: string;
  sourceType: string;
  truncated: boolean;
  inferred: boolean;
  /** Every extraction of this page, one per entry that fetched it. */
  extractions: Array<{ position: number; text: string; extractionPath?: string; sourcePath?: string }>;
}

export interface BatchEvidence {
  sources: BatchSource[];
  /** Inventory rows before deduplication by URL. */
  sourcesBeforeDedup: number;
  /** Each member's summary with its identifiers rewritten into the batch series. */
  runs: Array<{ position: number; query: string; focusPrompt?: string; summary: string; summaryTruncated?: boolean }>;
}

/** The citation grammar `validateSynthesis()` treats as an identifier group. */
const CITATION = /\[([^\[\]\n]+)\]/g;
const ID_GROUP = /^S\d+(?:\s*(?:[,;–—-]|\band\b)\s*S\d+)*$/i;

/** The summary part of an accepted collation: after its heading, before its inventory. */
export function memberSummary(collation: string): string {
  const end = collation.lastIndexOf(`\n${SOURCE_ASSESSMENT_PREAMBLE}`);
  return (end < 0 ? collation : collation.slice(0, end))
    .replace(/^#{1,6}[ \t]+Summary[ \t]*\r?\n/i, "")
    .trim();
}

/**
 * Rewrite every bracketed identifier group, for example `[S1]`, `[S1, S3]`
 * or `[S2–S4]`, through `map`. Only groups that match the citation grammar
 * change, so ordinary brackets and names such as "Amazon S3" never do. A
 * range is expanded, because renumbering does not keep it contiguous. A
 * group naming an identifier `map` lacks is left unchanged, so validation
 * rejects it rather than the merge silently citing another page.
 */
export function renumberCitations(text: string, map: ReadonlyMap<number, number>, urls: readonly string[] = []): string {
  const prose = citationProseMask(text);
  const linkLabels = new Set([...prose.matchAll(/^ {0,3}\[([^\]\n]+)\]:/gm)].map((m) => m[1].trim().toLowerCase()));
  return text.replace(CITATION, (whole, inner: string, offset: number) => {
    if (!ID_GROUP.test(inner.trim()) || !prose.startsWith(whole, offset)) return whole;
    let start = offset;
    while (start > 0 && text[start - 1] === "\\") start--;
    if ((offset - start) % 2 || text[offset - 1] === "!") return whole;
    const after = offset + whole.length;
    if (text[after] !== "(" && linkLabels.has(inner.trim().toLowerCase())) return whole;
    const ref = text[after] === "[" ? text.slice(after).match(/^\[([^\]\n]+)\]/)?.[1] : undefined;
    if (ref && linkLabels.has(ref.trim().toLowerCase())) return whole;
    if (text[after] === "(") {
      // A link label is a citation only when its local ID identifies its target.
      const target = text.slice(after + 1).match(/^([^\s)]+)/)?.[1];
      const source = urls[Number(inner.match(/S(\d+)/i)?.[1]) - 1];
      if (!source || !target || pageUrl(source) !== pageUrl(target)) return whole;
    }
    const local = new Set<number>();
    for (const range of inner.matchAll(/S(\d+)\s*[-–—]\s*S(\d+)/gi)) {
      const [a, b] = [Number(range[1]), Number(range[2])];
      if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || !map.has(a) || !map.has(b) || Math.abs(a - b) >= map.size) return whole;
      for (let n = Math.min(a, b); n <= Math.max(a, b); n++) local.add(n);
    }
    for (const single of inner.matchAll(/S(\d+)/gi)) local.add(Number(single[1]));
    if ([...local].some((n) => !map.has(n))) return whole;
    const ids = [...new Set([...local].map((n) => map.get(n)!))].sort((a, b) => a - b);
    if (text[after] === "(") {
      // Keep the linked page first, so the label still names its target.
      const linked = map.get(Number(inner.match(/S(\d+)/i)?.[1]))!;
      ids.splice(ids.indexOf(linked), 1);
      ids.unshift(linked);
    }
    return `[${ids.map((n) => `S${n}`).join(", ")}]`;
  });
}

/**
 * Number every member's evidence into one series in caller order, one
 * identifier per URL, and rewrite each summary into that series. Identifiers
 * in a member summary index that member's non-empty successful extractions,
 * which is how `finalizeCollation()` numbered them.
 */
export function buildBatchEvidence(members: readonly MergeMember[]): BatchEvidence {
  const byUrl = new Map<string, BatchSource>();
  let sourcesBeforeDedup = 0;
  const runs = members.map((member) => {
    const { synthesis } = member;
    const local = new Map<number, number>();
    const memberSources = evidenceExtractions(synthesis.extractions);
    for (const [index, ext] of memberSources.entries()) {
      sourcesBeforeDedup++;
      let source = byUrl.get(ext.url);
      if (!source) {
        source = {
          id: byUrl.size + 1,
          url: ext.url,
          sourceType: ext.sourceType,
          truncated: false,
          inferred: !!ext.inferred,
          extractions: [],
        };
        byUrl.set(ext.url, source);
      }
      source.truncated ||= !!ext.truncated;
      // A page counts as cited when any entry cited it.
      source.inferred &&= !!ext.inferred;
      const extractionFile = synthesis.identity.extractionFileFor(ext.url);
      const sourceFile = synthesis.identity.sourceFileFor(ext.url);
      source.extractions.push({
        position: member.position,
        text: ext.extraction,
        ...(extractionFile ? { extractionPath: `${synthesis.cachePath}/extractions/${extractionFile}` } : {}),
        ...(sourceFile ? { sourcePath: `${synthesis.cachePath}/sources/${sourceFile}` } : {}),
      });
      local.set(index + 1, source.id);
    }
    return {
      position: member.position,
      query: member.query,
      ...(member.focusPrompt ? { focusPrompt: member.focusPrompt } : {}),
      summary: renumberCitations(memberSummary(synthesis.collation), local, memberSources.map((s) => s.url)),
      ...(synthesis.truncated ? { summaryTruncated: true } : {}),
    };
  });
  return { sources: [...byUrl.values()], sourcesBeforeDedup, runs };
}

/** The batch evidence as the extraction list `validateSynthesis()` numbers: index i is S(i+1). */
function evidenceList(sources: readonly BatchSource[]): ExtractResult[] {
  return sources.map((source) => ({
    url: source.url,
    title: "",
    // Every entry's text, so a prose URL from any of them is supplied evidence.
    extraction: source.extractions.map((e) => e.text).join("\n\n"),
    sourceType: source.sourceType,
    currentness: "",
    status: "success",
    ...(source.inferred ? { inferred: true } : {}),
  }));
}

export const BATCH_SOURCE_PREAMBLE =
  "## Source assessment\n\n" +
  "Source inventory is generated from the queries' successful, non-empty extractions, one row per URL across all queries, not from search citations. Cross-links in synthesis are not additional fetched sources. Types are extraction metadata, not independent quality ratings.\n\n";

/**
 * One cell listing a file per entry: each entry extracted the page with its
 * own focus, so a claim from query 2 must be checked against query 2's file.
 */
function pathsCell(source: BatchSource, key: "extractionPath" | "sourcePath"): string {
  const paths = source.extractions.map((e) => ({ position: e.position, path: e[key] }));
  if (paths.length === 1) return paths[0].path ? cell(paths[0].path) : "Not cached";
  return paths.map((p) => `Query ${p.position}: ${p.path ? cell(p.path) : "Not cached"}`).join("; ");
}

function batchSourceTable(sources: readonly BatchSource[]): string {
  let table = "| ID | Source | Type | Queries | Extraction | Full page |\n|---|---|---|---|---|---|\n";
  for (const source of sources) {
    const type = `${cell(source.sourceType)}${source.truncated ? " ⚠ truncated" : ""}${source.inferred ? " (inferred from text, not a citation)" : ""}`;
    table +=
      `| S${source.id} | ${cell(source.url)} | ${type} | ${source.extractions.map((e) => e.position).join(", ")} | ` +
      `${pathsCell(source, "extractionPath")} | ${pathsCell(source, "sourcePath")} |\n`;
  }
  return table.trimEnd();
}

/** Bulleted or numbered items in the first section whose heading matches `heading`. */
export function countSectionItems(text: string, heading: RegExp): number {
  // Code examples are masked line for line, so a sample heading or list in a
  // fence is not counted as the synthesis's own section.
  const lines = codeBlockProse(text).split("\n");
  const start = lines.findIndex((line) => /^#{1,6}\s/.test(line) && heading.test(line));
  if (start < 0) return 0;
  let count = 0;
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line)) break;
    if (/^\s{0,3}(?:[-*+]|\d+[.)])\s+\S/.test(line) && !/none found/i.test(line)) count++;
  }
  return count;
}

export interface MergeStageTelemetry {
  model: string;
  outcome: "completed" | "rejected" | "failed" | "skipped";
  /** Entries whose summaries were merged. */
  entries: number;
  sources: number;
  sourcesBeforeDedup: number;
  inputChars: number;
  outputChars: number;
  contradictions: number;
  gaps: number;
  durationMs: number;
  truncated?: boolean;
  budgetRetries?: number;
  provider?: string;
  error?: string;
}

export type MergeResult =
  | {
      ok: true;
      /** `## Summary`, the merged synthesis and the batch-wide inventory. */
      body: string;
      telemetry: MergeStageTelemetry;
      rejected: Array<{ text: string; reason: string; maxTokens: number }>;
    }
  | {
      ok: false;
      reason: string;
      telemetry: MergeStageTelemetry;
      rejected: Array<{ text: string; reason: string; maxTokens: number }>;
    };

/**
 * Merge the members' summaries with one collation call. Never throws for a
 * model or validation failure: the caller falls back to the per-query
 * sections. Cancellation propagates.
 */
export async function mergeBatch(
  context: OperationContext,
  members: readonly MergeMember[],
  batchDisplay: string,
): Promise<MergeResult> {
  const now = context.now ?? Date.now;
  const started = now();
  const model = `${context.settings.collateModel.provider}/${context.settings.collateModel.model}`;
  const evidence = buildBatchEvidence(members);
  const userMessage = JSON.stringify(
    {
      queries: evidence.runs.map(({ query, focusPrompt, summary, summaryTruncated }) => ({
        query,
        ...(focusPrompt ? { focusPrompt } : {}),
        summary,
        ...(summaryTruncated ? { summaryTruncated } : {}),
      })),
      sources: evidence.sources.map((s) => ({ id: `S${s.id}`, url: s.url })),
    },
    null,
    2,
  );
  const base: MergeStageTelemetry = {
    model,
    outcome: "completed",
    entries: members.length,
    sources: evidence.sources.length,
    sourcesBeforeDedup: evidence.sourcesBeforeDedup,
    inputChars: SUPER_COLLATION_SYSTEM_PROMPT.length + userMessage.length,
    outputChars: 0,
    contradictions: 0,
    gaps: 0,
    durationMs: 0,
  };
  // The merge sends whole member summaries; collationInputBudgetTokens trims
  // each member's evidence but not this request, so check it before paying.
  const budgetTokens = context.settings.collationInputBudgetTokens;
  const inputTokens = Math.ceil(base.inputChars / CHARS_PER_TOKEN);
  if (inputTokens > budgetTokens) {
    const reason =
      `the merge input (≈${inputTokens} tokens) exceeds collationInputBudgetTokens (${budgetTokens}); ` +
      "raise it if the collation model's context allows, or batch fewer queries";
    context.logger.error(`Batch merge skipped: ${reason}`);
    return { ok: false, reason, rejected: [], telemetry: { ...base, outcome: "skipped", error: reason } };
  }
  const list = evidenceList(evidence.sources);
  try {
    const result = await completeSynthesis(
      context,
      { systemPrompt: SUPER_COLLATION_SYSTEM_PROMPT, userMessage },
      (text) => validateSynthesis(text, batchDisplay, list).summary,
    );
    const summary = result.accepted;
    const truncation = result.truncated
      ? `\n\n> ⚠ The merged report reached its output cap (${result.maxTokens} tokens) and may be cut off. See Per-Query Reports for member outcomes and available evidence.`
      : "";
    return {
      ok: true,
      body:
        `## Summary\n\n${closeOpenFence(summary)}${truncation}\n\n` +
        BATCH_SOURCE_PREAMBLE +
        batchSourceTable(evidence.sources),
      rejected: result.rejected,
      telemetry: {
        ...base,
        outputChars: summary.length,
        contradictions: countSectionItems(summary, /contradiction/i),
        gaps: countSectionItems(summary, /\bgaps?\b/i),
        durationMs: now() - started,
        ...(result.truncated ? { truncated: true } : {}),
        ...(result.budgetRetries ? { budgetRetries: result.budgetRetries } : {}),
        ...(result.provider ? { provider: result.provider } : {}),
      },
    };
  } catch (error) {
    if (context.signal?.aborted) throw error;
    const reason = failureDetail(errMsg(error)) || "merge failed";
    context.logger.error(`Batch merge failed: ${reason}`);
    return {
      ok: false,
      reason,
      rejected: error instanceof SynthesisRejectedError ? error.rejected : [],
      telemetry: {
        ...base,
        outcome: error instanceof SynthesisRejectedError ? "rejected" : "failed",
        durationMs: now() - started,
        error: reason,
      },
    };
  }
}
