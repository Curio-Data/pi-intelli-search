// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// Secondary run index and read-only legacy bridge (C26/C27). The index is
// rebuildable from verified committed runs; the legacy `.index.json`, its
// metadata and directories are only ever read. Candidate selection preserves
// the baseline date/query grouping and judge window; it is not a relevance or
// history-policy change.

import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { setImmediate as yieldTurn } from "node:timers/promises";
import type { Diagnostic, IndexCandidate } from "./execution-contracts.js";
import {
  CANDIDATE_WINDOW,
  INDEX_FILE,
  IndexSchema,
  JOURNAL_YIELD_RECORDS,
  RUNS_DIR,
  compatibilityKeyFor,
  isUtc,
  isValid,
  type AllocationRecord,
  type IndexEntry,
  type IndexRecord,
} from "./run-format.js";
import {
  StoreError,
  describe,
  errorCode,
  listRunNames,
  readBoundedFile,
  readJson,
  readNamespace,
  validateJournal,
  verifyCommittedRun,
} from "./run-journal.js";

export const LEGACY_INDEX_FILE = ".index.json";
const LEGACY_SLUG = /^(\d{4}-\d{2}-\d{2})-[a-z0-9-]{1,200}$/;

export interface IndexReadResult {
  readonly status: "valid" | "missing" | "corrupt";
  readonly index?: IndexRecord;
  readonly detail?: string;
}

/** Read the secondary index without repairing it. */
export async function readRunIndex(
  namespaceDir: string,
  namespaceId: string,
): Promise<IndexReadResult> {
  let value: unknown;
  try {
    value = (await readJson(join(namespaceDir, INDEX_FILE))).value;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { status: "missing" };
    return { status: "corrupt", detail: describe(error) };
  }
  if (!isValid(IndexSchema, value))
    return { status: "corrupt", detail: "schema intelli-v1/index@1 mismatch" };
  if (value.namespaceId !== namespaceId)
    return { status: "corrupt", detail: "index names another namespace" };
  const runs = new Set<string>();
  let previous = 0;
  for (const entry of value.entries) {
    if (entry.sequence <= previous || runs.has(entry.runId) || !isUtc(entry.startedUtc))
      return { status: "corrupt", detail: "entries are not unique ascending admissions" };
    previous = entry.sequence;
    runs.add(entry.runId);
  }
  return { status: "valid", index: value };
}

/** Rebuild index entries from verified committed runs only, ascending by admission. */
export async function rebuildIndexEntries(
  namespaceDir: string,
  namespaceId: string,
  journal: ReadonlyMap<string, AllocationRecord>,
  signal?: AbortSignal,
): Promise<{ entries: IndexEntry[]; rejected: string[] }> {
  const entries: IndexEntry[] = [];
  const rejected: string[] = [];
  const names = (await listRunNames(namespaceDir)) ?? [];
  let count = 0;
  for (const runId of names.sort()) {
    if (++count % JOURNAL_YIELD_RECORDS === 0) await yieldTurn();
    if (signal?.aborted)
      throw new StoreError("ABORTED", "Cancelled while rebuilding the run index");
    const record = journal.get(runId);
    const verified = await verifyCommittedRun(namespaceDir, namespaceId, runId, record, { signal });
    if (!verified.ok) {
      if (!verified.reason.endsWith("no committed marker")) rejected.push(verified.reason);
      continue;
    }
    entries.push({
      runId,
      sequence: verified.marker.admissionSequence,
      compatibilityKey: verified.marker.compatibilityKey,
      query: verified.marker.query,
      startedUtc: verified.marker.startedUtc,
      manifestSha256: verified.manifestSha256,
    });
  }
  entries.sort((a, b) => a.sequence - b.sequence);
  return { entries, rejected };
}

interface LegacyCandidate {
  readonly slug: string;
  readonly query: string;
  readonly timestamp: string;
  readonly compatibilityKey: string;
}

/**
 * Read-only legacy bridge. Mirrors the baseline: one entry per slug (the last
 * occurrence wins, as the old writer replaced earlier ones), stored query and
 * timestamp, report at `<cacheRoot>/<slug>/report.md`. Unknown provenance stays
 * unknown and no admission sequence is invented.
 */
export async function readLegacyCandidates(
  cacheRoot: string,
  onDiagnostic?: (diagnostic: Diagnostic) => void,
): Promise<LegacyCandidate[]> {
  let parsed: unknown;
  try {
    const bytes = await readBoundedFile(join(cacheRoot, LEGACY_INDEX_FILE));
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (errorCode(error) !== "ENOENT")
      onDiagnostic?.({
        code: "LEGACY_INDEX_UNREADABLE",
        message: `Legacy index ${join(cacheRoot, LEGACY_INDEX_FILE)} is unreadable and was left untouched: ${describe(error)}`,
      });
    return [];
  }
  const searches = (parsed as { searches?: unknown } | null)?.searches;
  if (!Array.isArray(searches)) return [];
  const bySlug = new Map<string, LegacyCandidate>();
  for (const item of searches as unknown[]) {
    const { slug, query, timestamp } = (item ?? {}) as Record<string, unknown>;
    if (typeof slug !== "string" || typeof query !== "string" || !isUtc(timestamp)) continue;
    const match = LEGACY_SLUG.exec(slug);
    if (!match || !Number.isFinite(Date.parse(`${match[1]}T00:00:00Z`))) continue;
    bySlug.delete(slug);
    bySlug.set(slug, {
      slug,
      query,
      timestamp,
      compatibilityKey: compatibilityKeyFor(query, match[1]),
    });
  }
  return [...bySlug.values()];
}

async function legacyReportValid(cacheRoot: string, slug: string): Promise<boolean> {
  try {
    const dir = await lstat(join(cacheRoot, slug));
    if (!dir.isDirectory()) return false;
    const report = await lstat(join(cacheRoot, slug, "report.md"));
    return report.isFile() && report.size > 0;
  } catch {
    return false;
  }
}

export interface SelectOptions {
  readonly cacheRoot: string;
  readonly displayRoot: string;
  readonly namespaceDir: string;
  readonly currentKey: string;
  readonly signal: AbortSignal;
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void;
  readonly window?: number;
}

function utcMs(value: string): number {
  return Date.parse(value);
}

/**
 * Candidate view: highest verified admission per compatibility key (new) and
 * validated legacy entries, excluding the current key, merged by a stable
 * head-merge on UTC start that prefers new on equality. The returned array is
 * frozen so judge numbering and response parsing share one selection.
 */
export async function selectCandidates(options: SelectOptions): Promise<readonly IndexCandidate[]> {
  const window = options.window ?? CANDIDATE_WINDOW;
  const fresh: IndexCandidate[] = [];
  const claimedKeys = new Set<string>();
  try {
    const namespace = await readNamespace(options.namespaceDir);
    if (namespace) {
      const journal = await validateJournal(
        options.namespaceDir,
        namespace.namespaceId,
        "reader",
        options.signal,
      );
      const read = await readRunIndex(options.namespaceDir, namespace.namespaceId);
      let entries: readonly IndexEntry[];
      if (read.status === "valid" && read.index) entries = read.index.entries;
      else {
        if (read.status === "corrupt")
          options.onDiagnostic?.({
            code: "INDEX_CORRUPT",
            message: `Run index ${join(options.namespaceDir, INDEX_FILE)} is corrupt (${read.detail}); candidates were rebuilt in memory from verified runs and the file was left for preservation.`,
          });
        entries = (
          await rebuildIndexEntries(
            options.namespaceDir,
            namespace.namespaceId,
            journal.records,
            options.signal,
          )
        ).entries;
      }
      for (const entry of entries) claimedKeys.add(entry.compatibilityKey);
      const selected = new Set<string>([options.currentKey]);
      const ordered = [...entries].sort((a, b) => b.sequence - a.sequence);
      for (const entry of ordered) {
        if (fresh.length >= window) break;
        if (selected.has(entry.compatibilityKey)) continue;
        if (options.signal.aborted)
          throw new StoreError("ABORTED", "Cancelled while selecting candidates");
        const verified = await verifyCommittedRun(
          options.namespaceDir,
          namespace.namespaceId,
          entry.runId,
          journal.records.get(entry.runId),
          { expectedManifestSha256: entry.manifestSha256, signal: options.signal },
        );
        if (!verified.ok || verified.marker.query !== entry.query) {
          options.onDiagnostic?.({
            code: "RUN_REJECTED",
            message: `Run ${entry.runId} was not suggested: ${verified.ok ? "index query differs from marker" : verified.reason}`,
          });
          continue;
        }
        selected.add(entry.compatibilityKey);
        fresh.push(
          Object.freeze({
            query: entry.query,
            reportPath: join(
              options.displayRoot,
              ".intelli-v1",
              RUNS_DIR,
              entry.runId,
              "report.md",
            ),
            namespace: "v1" as const,
            startedUtc: entry.startedUtc,
            compatibilityKey: entry.compatibilityKey,
            admissionSequence: entry.sequence,
          }),
        );
      }
    }
  } catch (error) {
    if (options.signal.aborted) throw error;
    options.onDiagnostic?.({
      code: error instanceof StoreError ? error.code : "INDEX_UNAVAILABLE",
      message: `New-format candidates are unavailable: ${describe(error)}`,
    });
    fresh.length = 0;
  }

  const legacy = (await readLegacyCandidates(options.cacheRoot, options.onDiagnostic))
    .filter(
      (entry) =>
        entry.compatibilityKey !== options.currentKey && !claimedKeys.has(entry.compatibilityKey),
    )
    .sort(
      (a, b) =>
        utcMs(b.timestamp) - utcMs(a.timestamp) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
    );
  const old: IndexCandidate[] = [];
  for (const entry of legacy) {
    if (old.length >= window) break;
    if (options.signal.aborted)
      throw new StoreError("ABORTED", "Cancelled while selecting candidates");
    if (!(await legacyReportValid(options.cacheRoot, entry.slug))) continue;
    old.push(
      Object.freeze({
        query: entry.query,
        reportPath: join(options.displayRoot, entry.slug, "report.md"),
        namespace: "legacy" as const,
        startedUtc: entry.timestamp,
        compatibilityKey: entry.compatibilityKey,
      }),
    );
  }

  const merged: IndexCandidate[] = [];
  let i = 0;
  let j = 0;
  while (merged.length < window && (i < fresh.length || j < old.length)) {
    if (
      j >= old.length ||
      (i < fresh.length && utcMs(fresh[i].startedUtc) >= utcMs(old[j].startedUtc))
    )
      merged.push(fresh[i++]);
    else merged.push(old[j++]);
  }
  return Object.freeze(merged);
}

/** Numbered judge list over the one frozen candidate array. */
export function formatCandidatesForJudge(candidates: readonly IndexCandidate[]): string {
  if (candidates.length === 0) return "No previous searches.";
  return candidates
    .map((c, i) => `${i + 1}. "${c.query}" (report: ${c.reportPath}, searched: ${c.startedUtc})`)
    .join("\n");
}

/** Resolve 1-based judge answers against the same frozen array that was rendered. */
export function parseCandidateResponse(
  response: string,
  candidates: readonly IndexCandidate[],
): Array<{ candidate: IndexCandidate; relevance: string }> {
  const match = response.match(/\[[\s\S]*\]/);
  if (!match) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const results: Array<{ candidate: IndexCandidate; relevance: string }> = [];
  for (const item of parsed as Array<{ index?: unknown; relevance?: unknown }>) {
    if (typeof item?.index !== "number" || !Number.isInteger(item.index) || item.index < 1)
      continue;
    const candidate = candidates[item.index - 1];
    if (!candidate) continue;
    results.push({
      candidate,
      relevance: typeof item.relevance === "string" ? item.relevance : "",
    });
  }
  return results;
}
