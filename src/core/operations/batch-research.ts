// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Batch research: several queries in one research call. Each entry runs the
// ordinary five-stage pipeline (runResearchEntry) in its own cache folder;
// the batch shares one extraction pool and one request throttle across its
// entries, runs cache suggestion once, and records a batch folder with a
// manifest and a batch telemetry record. Design and decisions:
// docs/proposals/BATCH-RESEARCH.md.

import { randomBytes } from "node:crypto";
import { basename } from "node:path";
import type {
  BatchMode,
  OperationContext,
  OperationOutcome,
  OperationResult,
  ResearchParams,
  ResearchQuery,
} from "../contracts.js";
import type { ResearchSettings } from "../types.js";
import { displayCachePath } from "../paths.js";
import {
  cacheLockDir,
  indexLockDir,
  removeIndexEntry,
  updateIndex,
  writeBatchFile,
  makeBatchCachePath,
  makeCachePath,
  rotateCacheArtefacts,
  withLock,
  writeBatchManifest,
  type BatchManifest,
} from "../cache.js";
import {
  createRateLimiter,
  createSemaphore,
  errMsg,
  failureDetail,
  mapWithConcurrency,
  throwIfAborted,
} from "../util.js";
import { progress } from "../progress.js";
import {
  BATCH_SCHEMA_VERSION,
  telemetryIdentity,
  writeBatchTelemetry,
  type BatchOutcome,
  type BatchTelemetry,
} from "../telemetry.js";
import {
  preflightResearch,
  runResearchEntry,
  suggestRelatedSearches,
  type CacheSuggestOutcome,
  type ResearchDependencies,
  type ResearchRunResult,
} from "./research.js";
import { mergeBatch, type MergeMember } from "./batch-merge.js";

/** A research argument that breaks a rule the schema cannot express. */
export class ResearchArgumentError extends Error {
  override name = "ResearchArgumentError";
}

export interface ValidatedBatch {
  kind: "batch";
  mode: BatchMode;
  /** Entries in caller order, with top-level defaults applied. */
  entries: ResearchQuery[];
}

export type ValidatedResearch = { kind: "single"; query: ResearchQuery } | ValidatedBatch;

const BATCH_MODES: readonly BatchMode[] = ["expansion", "independent"];

/**
 * Enforce the rules the strict tool schema cannot express portably, before
 * any model call: exactly one of `query` and `queries`; `batchMode` with
 * `queries` only; two to `maxBatchEntries` entries, each with a nonempty,
 * distinct query and a positive integer `maxUrls` where one applies. A single
 * query passes through exactly as before batch support.
 */
export function validateResearchParams(
  params: ResearchParams,
  settings: Pick<ResearchSettings, "maxBatchEntries">,
): ValidatedResearch {
  const { query, queries, batchMode, ...defaults } = params;
  if (query !== undefined && queries !== undefined)
    throw new ResearchArgumentError("Give either query or queries, not both.");
  if (queries === undefined) {
    if (query === undefined) throw new ResearchArgumentError("query is required unless queries is given.");
    if (batchMode !== undefined)
      throw new ResearchArgumentError("batchMode applies only with queries.");
    return { kind: "single", query: { ...defaults, query } };
  }
  if (batchMode === undefined)
    throw new ResearchArgumentError('batchMode is required with queries: "independent" or "expansion".');
  if (!BATCH_MODES.includes(batchMode))
    throw new ResearchArgumentError('batchMode must be "independent" or "expansion".');
  if (!Array.isArray(queries) || queries.length < 2)
    throw new ResearchArgumentError("queries needs at least two entries; use query for one.");
  if (queries.length > settings.maxBatchEntries)
    throw new ResearchArgumentError(
      `queries has ${queries.length} entries; settings.maxBatchEntries allows at most ${settings.maxBatchEntries}.`,
    );
  const seen = new Set<string>();
  const entries = queries.map((entry, index): ResearchQuery => {
    const label = `queries[${index}]`;
    if (typeof entry?.query !== "string" || !entry.query.trim())
      throw new ResearchArgumentError(`${label}.query must not be empty.`);
    // Identical queries would share one cache folder and overwrite each other.
    if (seen.has(entry.query.trim()))
      throw new ResearchArgumentError(`${label}.query repeats an earlier entry.`);
    seen.add(entry.query.trim());
    const merged: ResearchQuery = { query: entry.query };
    const focusPrompt = entry.focusPrompt ?? defaults.focusPrompt;
    const maxUrls = entry.maxUrls ?? defaults.maxUrls;
    const domains = entry.domains ?? defaults.domains;
    if (maxUrls !== undefined && (!Number.isSafeInteger(maxUrls) || maxUrls < 1))
      throw new ResearchArgumentError(`${label}.maxUrls must be a positive integer.`);
    if (focusPrompt !== undefined) merged.focusPrompt = focusPrompt;
    if (maxUrls !== undefined) merged.maxUrls = maxUrls;
    if (domains !== undefined) merged.domains = domains;
    return merged;
  });
  return { kind: "batch", mode: batchMode, entries };
}

interface EntryOutcome {
  position: number;
  entry: ResearchQuery;
  durationMs: number;
  run?: ResearchRunResult;
  /** Bounded reason when the entry threw instead of returning a result. */
  error?: string;
}

/**
 * Run a validated batch: preflight once, then every entry through the
 * ordinary pipeline with shared resources. A failed or degraded entry becomes
 * its own section; it never fails the batch. Cancellation aborts every entry.
 */
export async function researchBatch(
  batch: ValidatedBatch,
  context: OperationContext,
  dependencies?: ResearchDependencies,
): Promise<OperationResult> {
  throwIfAborted(context.signal);
  await preflightResearch(context);
  throwIfAborted(context.signal);
  const { settings, paths } = context;
  const now = context.now ?? Date.now;
  const started = now();
  const id = randomBytes(4).toString("hex");
  const size = batch.entries.length;
  const concurrency = Math.min(settings.batchConcurrency, size);
  const extractionPool = createSemaphore(settings.batchExtractionConcurrency);
  // One throttle for the whole batch: a per-entry limiter would multiply the
  // request rate that minRequestIntervalMs exists to cap.
  const gate = createRateLimiter(settings.minRequestIntervalMs);

  context.onProgress?.(
    progress("search", `Researching ${size} queries, up to ${concurrency} at once...`, {
      current: 0,
      total: size,
    }),
  );
  let finished = 0;
  const settled = await mapWithConcurrency(
    batch.entries,
    concurrency,
    async (entry, index): Promise<EntryOutcome> => {
      const position = index + 1;
      const entryStart = now();
      const tag = `[${position}/${size}] `;
      try {
        const run = await runResearchEntry(
          entry,
          {
            ...context,
            onProgress: (event) => context.onProgress?.({ ...event, message: tag + event.message }),
          },
          dependencies,
          {
            extractionPool,
            gate,
            skipCacheSuggest: true,
            batch: { id, mode: batch.mode, size, position },
          },
        );
        return { position, entry, durationMs: now() - entryStart, run };
      } catch (error) {
        throwIfAborted(context.signal);
        const reason = failureDetail(errMsg(error)) || "research failed";
        context.logger.error(`Batch entry ${position} failed: ${reason}`);
        return { position, entry, durationMs: now() - entryStart, error: reason };
      }
    },
    {
      signal: context.signal,
      onSettled: () => {
        finished++;
        context.onProgress?.(
          progress("cache", `${finished} of ${size} queries finished`, { current: finished, total: size }),
        );
      },
    },
  );
  throwIfAborted(context.signal);
  const outcomes = settled as EntryOutcome[];

  const completed = outcomes.filter((o) => o.run?.result.outcome === "completed").length;
  const batchOutcome: BatchOutcome =
    completed === size ? "completed" : completed > 0 ? "partial" : "failed";

  const batchPath = makeBatchCachePath(
    batch.mode,
    batch.entries.map((e) => e.query),
    paths.workspaceRoot,
    paths.cacheRoot,
  );
  const batchDisplay = displayCachePath(paths, batchPath);
  const batchSlug = basename(batchPath);
  const memberSlugs = batch.entries.map((e) =>
    basename(makeCachePath(e.query, paths.workspaceRoot, paths.cacheRoot)),
  );

  // Expansion merges the completed entries' summaries; it needs two or more.
  const members: MergeMember[] = outcomes.flatMap((o) =>
    o.run?.synthesis
      ? [{
          position: o.position,
          query: o.entry.query,
          ...(o.entry.focusPrompt ? { focusPrompt: o.entry.focusPrompt } : {}),
          synthesis: o.run.synthesis,
        }]
      : [],
  );
  const mergeRuns = batch.mode === "expansion" && members.length >= 2;
  if (mergeRuns)
    context.onProgress?.(progress("collate", `Merging ${members.length} summaries into one report...`));

  // Cache suggestion once, over the joined queries, leaving out every member
  // folder and the batch's own: otherwise each member would surface its
  // siblings. It runs beside the merge, which it does not depend on.
  const noSuggestions: CacheSuggestOutcome = { appendix: "", telemetry: { ran: false, surfaced: 0, slugs: [] } };
  const [merge, suggestions] = await Promise.all([
    mergeRuns ? mergeBatch(context, members, batchDisplay) : Promise.resolve(undefined),
    completed > 0
      ? suggestRelatedSearches(context, batch.entries.map((e) => e.query).join("; "), [...memberSlugs, batchSlug])
      : Promise.resolve(noSuggestions),
  ]);
  throwIfAborted(context.signal);
  const mergeSkipReason =
    batch.mode === "expansion" && !mergeRuns
      ? `the merged report needs at least two completed queries, and ${members.length} completed`
      : undefined;

  // Batch folder: manifest always, merged report when the merge succeeded,
  // batch record unless telemetry is off. A write failure is logged and never
  // discards the entries' results.
  const timestamp = new Date(started).toISOString();
  const queryList = batch.entries.map((e) => e.query);
  const report =
    merge?.ok
      ? `# Merged research: ${size} queries\n\n` +
        `> Searched: ${timestamp}\n> Cache: ${batchDisplay}/\n> Queries: ${size}, ${completed} completed, ${members.length} merged\n\n` +
        `${merge.body}\n\n${perQueryList(outcomes)}\n`
      : undefined;
  const manifest: BatchManifest = {
    schemaVersion: 1,
    id,
    mode: batch.mode,
    timestamp,
    entries: outcomes.map((o) => ({
      position: o.position,
      ...o.entry,
      outcome: o.run?.result.outcome ?? "error",
      ...committedPaths(o),
      ...(o.error ? { error: o.error } : {}),
    })),
  };
  let batchWritten = false;
  let reportWritten = false;
  try {
    await withLock(
      cacheLockDir(batchPath),
      async () => {
        try {
          await rotateCacheArtefacts(batchPath, batchDisplay);
        } catch (error) {
          context.logger.error(`Batch folder archive failed; replacing in place: ${errMsg(error)}`);
        }
        await writeBatchManifest(batchPath, manifest);
        if (merge?.rejected.length) {
          try {
            await writeBatchFile(
              batchPath,
              "rejected-synthesis.json",
              JSON.stringify({ schemaVersion: 1, accepted: !!merge.ok, candidates: merge.rejected }, null, 2) + "\n",
            );
          } catch (error) {
            context.logger.error(`Rejected merge diagnostic write failed: ${errMsg(error)}`);
          }
        }
        if (report !== undefined) {
          await writeBatchFile(batchPath, "report.md", report);
          reportWritten = true;
        }
        // Only a batch with a merged report is indexed. Lock order: the index
        // lock nests inside the cache-path lock, as in the single pipeline.
        await withLock(
          indexLockDir(paths.cacheRoot),
          () =>
            reportWritten
              ? updateIndex(paths.cacheRoot, batchSlug, `Batch: ${queryList.join("; ")}`)
              : removeIndexEntry(paths.cacheRoot, batchSlug),
          context.signal,
        );
        if (!settings.disableTelemetry) {
          const record: BatchTelemetry = {
            kind: "batch",
            schemaVersion: BATCH_SCHEMA_VERSION,
            ...telemetryIdentity(context.identity),
            id,
            mode: batch.mode,
            timestamp,
            durationMs: now() - started,
            outcome: batchOutcome,
            size,
            concurrency,
            extractionPool: settings.batchExtractionConcurrency,
            entries: outcomes.map((o) => {
              const { cachePath } = committedPaths(o);
              return {
                position: o.position,
                outcome: o.run?.result.outcome ?? "error",
                durationMs: o.durationMs,
                ...(cachePath ? { cachePath } : {}),
              };
            }),
            cacheSuggest: suggestions.telemetry,
            ...(batch.mode === "expansion"
              ? {
                  merge: merge?.telemetry ?? {
                    model: `${settings.collateModel.provider}/${settings.collateModel.model}`,
                    outcome: "skipped" as const,
                    entries: members.length,
                    sources: 0,
                    sourcesBeforeDedup: 0,
                    inputChars: 0,
                    outputChars: 0,
                    contradictions: 0,
                    gaps: 0,
                    durationMs: 0,
                    error: mergeSkipReason,
                  },
                }
              : {}),
          };
          try {
            await writeBatchTelemetry(batchPath, record);
          } catch (error) {
            context.logger.error(`Batch telemetry write failed: ${errMsg(error)}`);
          }
        }
        batchWritten = true;
      },
      context.signal,
    );
  } catch (error) {
    throwIfAborted(context.signal);
    context.logger.error(`Batch folder write failed: ${errMsg(error)}`);
  }

  if (completed === 0 && outcomes.every((o) => o.error)) {
    throw new Error(
      `Every batch entry failed. ${outcomes.map((o) => `[${o.position}] ${o.error}`).join(" ")}`,
    );
  }

  const folder = batchWritten ? batchDisplay : "";
  let text: string;
  if (merge?.ok) {
    text =
      `${batchHeadline(batch.mode, outcomes, completed)} The merged report covers ${members.length} of them.\n\n` +
      `${merge.body}\n\n${perQueryList(outcomes)}` +
      (folder ? `\n\nBatch folder: \`${folder}/\` (${reportWritten ? "report.md is this merged report; " : ""}manifest.json lists each query's cache folder).` : "");
  } else {
    const notice =
      batch.mode === "expansion"
        ? `> ⚠ No merged report: ${merge ? `the merge failed (${merge.reason})` : mergeSkipReason}. ` +
          `Each query's result follows.${merge?.rejected.length && folder ? ` Rejected merge candidates: \`${folder}/rejected-synthesis.json\`.` : ""}`
        : "";
    text = formatBatchText(batch.mode, outcomes, completed, folder, notice);
  }

  return {
    text: text + suggestions.appendix,
    outcome: batchResultOutcome(outcomes),
    details: {
      batch: {
        id,
        mode: batch.mode,
        outcome: batchOutcome,
        cachePath: folder,
        ...(batch.mode === "expansion"
          ? {
              merge: merge?.ok
                ? { outcome: "completed", reportPath: reportWritten ? `${folder}/report.md` : "" }
                : { outcome: merge ? merge.telemetry.outcome : "skipped", reason: merge ? merge.reason : mergeSkipReason },
            }
          : {}),
        entries: outcomes.map((o) => ({
          position: o.position,
          query: o.entry.query,
          outcome: o.run?.result.outcome ?? "error",
          ...(o.run ? { details: o.run.result.details } : {}),
          ...(o.error ? { error: o.error } : {}),
        })),
      },
    },
  };
}

/** Where each query's own report is, for the merged report's reader. */
function perQueryList(outcomes: EntryOutcome[]): string {
  const lines = outcomes.map((o) => {
    const query = o.entry.query.replace(/\s+/g, " ").trim();
    const { cachePath, preservedCachePath } = committedPaths(o);
    const outcome = o.run?.result.outcome ?? "error";
    if (outcome === "completed" && cachePath) return `${o.position}. ${query}: \`${cachePath}/report.md\``;
    const kept = preservedCachePath ? ` (earlier report kept: \`${preservedCachePath}/report.md\`)` : "";
    return `${o.position}. ${query}: not merged, ${outcome === "error" ? `failed (${o.error})` : outcome}${kept}`;
  });
  return `## Per-Query Reports\n\n${lines.join("\n")}`;
}

/** The entry's committed folder, or the earlier report its degraded run kept. */
function committedPaths(o: EntryOutcome): { cachePath?: string; preservedCachePath?: string } {
  const details = o.run?.result.details ?? {};
  const cachePath = typeof details.cachePath === "string" && details.cachePath ? details.cachePath : undefined;
  const preserved =
    typeof details.preservedCachePath === "string" && details.preservedCachePath
      ? details.preservedCachePath
      : undefined;
  return { ...(cachePath ? { cachePath } : {}), ...(preserved ? { preservedCachePath: preserved } : {}) };
}

/**
 * `completed` when any entry completed, so a partial batch still reads as a
 * usable result; otherwise the first returned entry's degraded outcome.
 * `details.batch.outcome` carries the batch-level verdict.
 */
function batchResultOutcome(outcomes: EntryOutcome[]): OperationOutcome {
  if (outcomes.some((o) => o.run?.result.outcome === "completed")) return "completed";
  return outcomes.find((o) => o.run)?.run?.result.outcome ?? "collate-failed";
}

function batchHeadline(mode: BatchMode, outcomes: EntryOutcome[], completed: number): string {
  const size = outcomes.length;
  return (
    `Batch research, ${mode} mode: ${size} queries, ${completed} completed` +
    (completed < size ? `, ${size - completed} did not` : "") +
    "."
  );
}

function formatBatchText(
  mode: BatchMode,
  outcomes: EntryOutcome[],
  completed: number,
  batchDisplay: string,
  notice = "",
): string {
  const size = outcomes.length;
  const head =
    batchHeadline(mode, outcomes, completed).replace(/ did not\.$/, " did not (see each section).") +
    (notice ? `\n\n${notice}` : "");
  const sections = outcomes.map((o) => {
    const title = `# Query ${o.position} of ${size}: ${o.entry.query.replace(/\s+/g, " ").trim()}`;
    const body = o.run ? o.run.result.text : `Research failed for this query: ${o.error}`;
    return `${title}\n\n${body.trim()}`;
  });
  const folder = batchDisplay
    ? `\n\n---\n\nBatch folder: \`${batchDisplay}/\` (manifest.json lists each query's cache folder).`
    : "";
  return `${head}\n\n---\n\n${sections.join("\n\n---\n\n")}${folder}`;
}
