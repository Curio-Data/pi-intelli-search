// src/telemetry.ts — Local-only per-research telemetry sidecar (meta.json)
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
import { writeFile, rename, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

/** Payload shape version. Bump only on a breaking schema change. */
export const SCHEMA_VERSION = 1 as const;

/**
 * Canonical telemetry payload. Additive-only evolution: new fields optional.
 *
 * `schemaVersion` is decoupled from `extensionVersion` so consumers can branch
 * on payload shape without parsing the product semver.
 */
export interface TelemetryMeta {
  schemaVersion: typeof SCHEMA_VERSION;
  extensionVersion: string;
  query: string;
  timestamp: string; // ISO 8601, mirrors query.txt / report.md
  durationMs: number;
  stages: {
    search: {
      model: string; // "provider/model"
      linksReturned: number;
      retryFired: boolean; // true if more than one search iteration ran
      attempts: number; // iterations actually executed
    };
    fetch: {
      requested: number;
      succeeded: number;
      failed: number;
      // Tally of the winning fetch variant per page. Source comes from
      // FetchedPage.source, which fetch.ts stamps as "defuddle" | "markdown".
      winners: Record<string, number>;
    };
    extract: {
      model: string;
      succeeded: number;
      failed: number;
      totalInputChars: number;
      totalOutputChars: number;
    };
    collate: {
      model: string;
      summaryChars: number;
    };
    cacheSuggest: {
      ran: boolean;
      surfaced: number; // count of related entries returned
      slugs: string[];
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
  private readonly start = Date.now();
  private readonly meta: TelemetryMeta;

  private constructor(extensionVersion: string, query: string, timestamp: string) {
    this.meta = {
      schemaVersion: SCHEMA_VERSION,
      extensionVersion,
      query,
      timestamp,
      durationMs: 0,
      stages: {
        search: { model: "", linksReturned: 0, retryFired: false, attempts: 0 },
        fetch: { requested: 0, succeeded: 0, failed: 0, winners: {} },
        extract: { model: "", succeeded: 0, failed: 0, totalInputChars: 0, totalOutputChars: 0 },
        collate: { model: "", summaryChars: 0 },
        cacheSuggest: { ran: false, surfaced: 0, slugs: [] },
      },
    };
  }

  /**
   * Async factory: reads the extension version from package.json once per
   * process. Falls back to "unknown" if unreadable; never throws, because a
   * version-read failure must not break the pipeline.
   */
  static async create(query: string): Promise<TelemetryBuilder> {
    const extensionVersion = await getExtensionVersion();
    return new TelemetryBuilder(extensionVersion, query, new Date().toISOString());
  }

  recordSearch(input: {
    model: string;
    linksReturned: number;
    retryFired: boolean;
    attempts: number;
  }): void {
    this.meta.stages.search = { ...input };
  }

  recordFetch(input: {
    requested: number;
    succeeded: number;
    failed: number;
    winners: Record<string, number>;
  }): void {
    this.meta.stages.fetch = { ...input };
  }

  recordExtract(input: {
    model: string;
    succeeded: number;
    failed: number;
    totalInputChars: number;
    totalOutputChars: number;
  }): void {
    this.meta.stages.extract = { ...input };
  }

  recordCollate(input: { model: string; summaryChars: number }): void {
    this.meta.stages.collate = { ...input };
  }

  recordCacheSuggest(input: { ran: boolean; surfaced: number; slugs: string[] }): void {
    this.meta.stages.cacheSuggest = { ...input };
  }

  /** Stamp duration and return the immutable payload. */
  finalize(): TelemetryMeta {
    this.meta.durationMs = Date.now() - this.start;
    return this.meta;
  }
}

/**
 * Write the telemetry sidecar atomically.
 *
 * Writes to a uniquely-named temp file, then `rename(2)`s it into place.
 * `rename` is atomic when source and destination are on the same filesystem,
 * which holds here (both live under `cachePath`). A crash mid-write leaves a
 * stray `.tmp` file, never a partial `meta.json`.
 *
 * The caller wraps this in a try/catch so a write failure never surfaces to
 * the pipeline result.
 */
export async function writeTelemetry(
  cachePath: string,
  meta: TelemetryMeta,
): Promise<void> {
  const target = join(cachePath, "meta.json");
  const tmp = join(
    cachePath,
    `.meta.json.${process.pid}.${randomBytes(4).toString("hex")}.tmp`,
  );
  await writeFile(tmp, JSON.stringify(meta, null, 2) + "\n", "utf-8");
  await rename(tmp, target);
}

// ── Extension version sourcing ──────────────────────────────────────────────

let cachedVersion: string | null = null;

/**
 * Read the extension version from package.json. Resolves `dist/telemetry.js`
 * up to the repo root. Cached for the process lifetime. Never throws:
 * returns "unknown" on any read or parse failure so a packaging quirk cannot
 * break telemetry or the pipeline.
 *
 * Note: this is intentionally independent of the hardcoded `CURRENT_VERSION`
 * constant in `src/index.ts`, which is used only for upgrade-migration
 * detection and is not authoritative for the published version.
 */
async function getExtensionVersion(): Promise<string> {
  if (cachedVersion) return cachedVersion;
  try {
    // dist/telemetry.js -> repo root (../). Also works for src/ via tsx where
    // import.meta.url points at the source file.
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, "..", "package.json");
    const raw = await readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(raw) as { version?: unknown };
    if (typeof pkg.version === "string" && pkg.version.length > 0) {
      cachedVersion = pkg.version;
    } else {
      cachedVersion = "unknown";
    }
  } catch {
    cachedVersion = "unknown";
  }
  return cachedVersion;
}

/** Test-only: reset the version cache between unit tests. */
export function _resetVersionCacheForTests(): void {
  cachedVersion = null;
}
