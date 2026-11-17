// src/core/telemetry.ts: Local-only per-research telemetry sidecar (meta.json)
//
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
// SPDX-License-Identifier: Apache-2.0
//
// Writes a `meta.json` file into each `.search/<slug>/` cache directory at the
// end of an `intelli_research` run, recording per-stage outcomes that are
// computed at runtime but otherwise discarded.
//
// Privacy: strictly local. No network call is added, no data leaves the host,
// and no account or identity is recorded. Suppressed entirely when the
// `disableTelemetry` setting is true.
//
// Schema evolution: additive only. New fields must be optional. Bump
// `SCHEMA_VERSION` only on a breaking change (rename/remove/retype). Historical
// sidecars remain interpretable because `schemaVersion` is independent of the
// product `extensionVersion`.
import { writeFile, rename, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { BatchMode, PackageIdentity } from "./contracts.js";
import { randomBytes } from "node:crypto";

/** Payload shape version. Bump only on a breaking schema change. */
export const SCHEMA_VERSION = 1 as const;

/** Run outcome. Degraded runs also write a sidecar (v0.11.0+) so the analysis
 * script can measure how often the pipeline degraded, not just how often it
 * succeeded. */
export type TelemetryOutcome =
  | "completed"
  | "no-links"
  | "fetch-failed"
  | "extraction-failed"
  | "collate-failed";

/**
 * Canonical telemetry payload. Additive-only evolution: new fields optional.
 *
 * `schemaVersion` is decoupled from `extensionVersion` so consumers can branch
 * on payload shape without parsing the product semver.
 */
export interface TelemetryMeta {
  schemaVersion: typeof SCHEMA_VERSION;
  extensionVersion: string;
  /** Optional adapter identity; legacy native records retain their exact shape. */
  packageName?: string;
  adapter?: PackageIdentity["adapter"];
  query: string;
  timestamp: string; // ISO 8601, mirrors query.txt / report.md
  durationMs: number;
  outcome: TelemetryOutcome; // which exit path produced this sidecar
  // Present only on a batch entry's sidecar: groups the entries of one call.
  // `position` is 1-based in the order the caller listed the queries.
  batch?: BatchEntryTelemetry;
  stages: {
    search: {
      model: string; // "provider/model"
      linksReturned: number;
      retryFired: boolean; // true if more than one search iteration ran
      attempts: number; // iterations actually executed
      degraded: boolean; // true when the search returned text but zero extractable URLs
      annotationsHarvested?: number; // url_citation annotations collected via the fetch side channel
    };
    fetch: {
      requested: number;
      succeeded: number;
      failed: number;
      // Tally of the winning fetch variant per page. Keys come from
      // FetchedPage.source as stamped by fetch.ts: "defuddle",
      // "defuddle-fallback", "markdown", or "text". The orchestrator falls
      // back to "unknown" for any page lacking the field.
      winners: Record<string, number>;
      // Batch entries only: URLs of the pages fetched successfully, so page
      // overlap between entries can be measured from the sidecars. Single
      // queries do not record it.
      urls?: string[];
    };
    extract: {
      model: string;
      succeeded: number;
      // LLM-call failures only. Pages that never fetched are accounted in
      // stages.fetch.failed (status "blocked"), not here.
      failed: number;
      // Lower bound on the chars fed to extraction LLMs. Sums
      // min(page.content.length, extractMaxChars) over fetched pages. It
      // excludes the per-call wrapper text ("Web page content:", the query,
      // focusPrompt) and the "[TRUNCATED]" marker, so it understates actual
      // input. Direction of error is consistent, so relative comparisons
      // across runs remain valid. Renamed from totalInputChars in v0.11.0.
      totalInputCharsApprox: number;
      totalOutputChars: number;
      // Successful extractions whose visible text was cut off by the output
      // cap (finish reason "length", or usage.output >= the cap). Present
      // only when nonzero.
      truncated?: number;
      // Extraction budget retries issued after output-cap exhaustion.
      // Present only when nonzero.
      budgetRetries?: number;
      // Failure classification aggregated after the extract worker pool
      // settles. Present only when at least one extraction failed.
      failureReasons?: { budgetExhausted: number; other: number };
      // Serving route every observed page agreed on (for example the
      // OpenRouter "provider" behind the model). Absent when the adapter
      // does not expose one or pages disagreed.
      provider?: string;
    };
    collate: {
      model: string;
      summaryChars: number;
      // True when the synthesis itself was cut off by its output cap.
      truncated?: boolean;
      // True when any collation budget retry was issued.
      budgetRetried?: boolean;
      // Number of collation budget retries issued. Present only when nonzero.
      budgetRetries?: number;
      // What the collation input budget reduced, when it reduced anything.
      inputBudget?: {
        budgetTokens: number;
        sources: number;
        trimmed: number;
        dropped: number;
        charsBefore: number;
        charsAfter: number;
      };
      // Bounded reason when collation failed and the run committed the
      // extractions without a synthesis (outcome "collate-failed").
      error?: string;
      // Serving route when the adapter observed one.
      provider?: string;
    };
    cacheSuggest: {
      ran: boolean;
      surfaced: number; // count of related entries returned
      slugs: string[];
      // True when the judge response was empty or unparseable: zero matches
      // then reflect a failed judge, not a valid "nothing related" verdict.
      degraded?: boolean;
    };
  };
}

/**
 * Mutable accumulator. Each pipeline stage updates its slice; `finalize()`
 * stamps the wall-clock duration and returns the frozen payload.
 *
 * Constructed only when telemetry is enabled (disableTelemetry === false).
 */
export class TelemetryBuilder {
  private readonly start: number;
  private readonly meta: TelemetryMeta;

  private constructor(
    identity: PackageIdentity,
    query: string,
    private readonly now: () => number,
  ) {
    this.start = now();
    this.meta = {
      schemaVersion: SCHEMA_VERSION,
      extensionVersion: identity.version,
      ...(identity.adapter === "pi"
        ? {}
        : { packageName: identity.name, adapter: identity.adapter }),
      query,
      timestamp: new Date(this.start).toISOString(),
      durationMs: 0,
      outcome: "completed",
      stages: {
        search: { model: "", linksReturned: 0, retryFired: false, attempts: 0, degraded: false },
        fetch: { requested: 0, succeeded: 0, failed: 0, winners: {} },
        extract: {
          model: "",
          succeeded: 0,
          failed: 0,
          totalInputCharsApprox: 0,
          totalOutputChars: 0,
        },
        collate: { model: "", summaryChars: 0 },
        cacheSuggest: { ran: false, surfaced: 0, slugs: [] },
      },
    };
  }

  /** Identity is supplied by the emitting adapter, never discovered from core paths. */
  static async create(
    query: string,
    identity: PackageIdentity,
    now: () => number = Date.now,
  ): Promise<TelemetryBuilder> {
    return new TelemetryBuilder(identity, query, now);
  }

  recordSearch(input: {
    model: string;
    linksReturned: number;
    retryFired: boolean;
    attempts: number;
    degraded?: boolean;
    annotationsHarvested?: number;
  }): void {
    this.meta.stages.search = { degraded: false, ...input };
  }

  recordFetch(input: {
    requested: number;
    succeeded: number;
    failed: number;
    winners: Record<string, number>;
    urls?: string[];
  }): void {
    this.meta.stages.fetch = { ...input };
  }

  recordExtract(input: {
    model: string;
    succeeded: number;
    failed: number;
    totalInputCharsApprox: number;
    totalOutputChars: number;
    truncated?: number;
    budgetRetries?: number;
    failureReasons?: { budgetExhausted: number; other: number };
    provider?: string;
  }): void {
    this.meta.stages.extract = { ...input };
  }

  recordCollate(input: {
    model: string;
    summaryChars: number;
    truncated?: boolean;
    budgetRetried?: boolean;
    /** Number of doubled-budget retries this stage issued (0 or more). */
    budgetRetries?: number;
    /** What the collation input budget reduced, when it reduced anything. */
    inputBudget?: {
      budgetTokens: number;
      sources: number;
      trimmed: number;
      dropped: number;
      charsBefore: number;
      charsAfter: number;
    };
    error?: string;
    provider?: string;
  }): void {
    this.meta.stages.collate = { ...input };
  }

  recordCacheSuggest(input: { ran: boolean; surfaced: number; slugs: string[]; degraded?: boolean }): void {
    this.meta.stages.cacheSuggest = { ...input };
  }

  /** Mark this sidecar as one entry of a batch. */
  setBatch(batch: BatchEntryTelemetry): void {
    this.meta.batch = { ...batch };
  }

  /** Record which exit path produced this sidecar. Call at every return
   * point so the analysis script can bucket degraded runs. */
  setOutcome(outcome: TelemetryOutcome): void {
    this.meta.outcome = outcome;
  }

  /** Stamp duration and return the immutable payload. */
  finalize(): TelemetryMeta {
    this.meta.durationMs = this.now() - this.start;
    return this.meta;
  }
}

/**
 * Write the telemetry sidecar atomically, sweeping any stray temp files
 * left by a prior crashed write first.
 *
 * Writes to a uniquely-named temp file, then `rename(2)`s it into place.
 * `rename` is atomic when source and destination are on the same filesystem,
 * which holds here (both live under `cachePath`). A crash mid-write leaves a
 * stray `.tmp` file, never a partial `meta.json`; that orphan is swept by the
 * next successful write so cache directories stay self-healing.
 *
 * The caller wraps this in a try/catch so a write failure never surfaces to
 * the pipeline result.
 */
export async function writeTelemetry(cachePath: string, meta: TelemetryMeta): Promise<void> {
  await atomicJson(cachePath, "meta.json", meta);
}

/** Write `value` as `<dir>/<name>` through a temp file and rename. */
async function atomicJson(dir: string, name: string, value: unknown): Promise<void> {
  await sweepStaleTempFiles(dir, name);
  const target = join(dir, name);
  const tmp = join(dir, `.${name}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  await writeFile(tmp, JSON.stringify(value, null, 2) + "\n", "utf-8");
  await rename(tmp, target);
}

/** Best-effort cleanup of orphaned `.<name>.*.tmp` files from a prior
 * crashed write. Errors are ignored: a sweep failure must not block the write. */
async function sweepStaleTempFiles(dir: string, name: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return; // directory may not exist yet on a degraded path; caller mkdirs
  }
  const prefix = `.${name}.`;
  await Promise.all(
    entries
      .filter((e) => e.startsWith(prefix) && e.endsWith(".tmp"))
      .map((e) => unlink(join(dir, e)).catch(() => {})),
  );
}

// ── Batch telemetry ──

/** Batch fields on each entry's `meta.json`. */
export interface BatchEntryTelemetry {
  id: string;
  mode: BatchMode;
  size: number;
  position: number;
}

/** Payload shape version of the batch record, independent of `SCHEMA_VERSION`. */
export const BATCH_SCHEMA_VERSION = 1 as const;

/** File name of the batch record in the batch folder. Not `meta.json`, so
 *  readers that treat every `meta.json` as one research run never see it. */
export const BATCH_TELEMETRY_FILE = "batch-meta.json";

/** `partial` when some entries completed and some did not; `failed` when none did. */
export type BatchOutcome = "completed" | "partial" | "failed";

/**
 * One batch research call, written to the batch folder beside the manifest.
 * Same rules as the per-run sidecar: local only, additive, suppressed by
 * `disableTelemetry`, and never fatal to the result.
 */
export interface BatchTelemetry {
  kind: "batch";
  schemaVersion: typeof BATCH_SCHEMA_VERSION;
  extensionVersion: string;
  packageName?: string;
  adapter?: PackageIdentity["adapter"];
  id: string;
  mode: BatchMode;
  timestamp: string;
  durationMs: number;
  outcome: BatchOutcome;
  size: number;
  /** Entries allowed to run at once (`batchConcurrency`, at most the size). */
  concurrency: number;
  /** Batch-wide extraction pool size (`batchExtractionConcurrency`). */
  extractionPool: number;
  entries: Array<{
    position: number;
    /** `error` when the entry threw instead of returning a result. */
    outcome: TelemetryOutcome | "error";
    durationMs: number;
    /** Display path of the folder this entry committed; absent when nothing was committed. */
    cachePath?: string;
  }>;
  cacheSuggest: { ran: boolean; surfaced: number; slugs: string[]; degraded?: boolean };
  /** Expansion batches only: the merge call over the entries' summaries. */
  merge?: {
    model: string;
    /** `rejected`: every candidate failed provenance validation; `skipped`: fewer than two entries completed. */
    outcome: "completed" | "rejected" | "failed" | "skipped";
    entries: number;
    /** Inventory rows after and before deduplication by URL. */
    sources: number;
    sourcesBeforeDedup: number;
    inputChars: number;
    outputChars: number;
    /** List items under the merged report's Contradictions and Gaps headings. */
    contradictions: number;
    gaps: number;
    durationMs: number;
    truncated?: boolean;
    budgetRetries?: number;
    provider?: string;
    error?: string;
  };
}

/** Identity fields of a record, following the per-run sidecar's rule. */
export function telemetryIdentity(identity: PackageIdentity): Pick<BatchTelemetry, "extensionVersion" | "packageName" | "adapter"> {
  return {
    extensionVersion: identity.version,
    ...(identity.adapter === "pi" ? {} : { packageName: identity.name, adapter: identity.adapter }),
  };
}

export async function writeBatchTelemetry(dir: string, record: BatchTelemetry): Promise<void> {
  await atomicJson(dir, BATCH_TELEMETRY_FILE, record);
}
