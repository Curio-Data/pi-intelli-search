// src/cache.ts — .search/ cache read/write utilities
//
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
// SPDX-License-Identifier: Apache-2.0
import { mkdir, writeFile, readFile, rename, rm, stat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import type { FetchedPage, ExtractResult } from "./types.js";

export interface IndexEntry {
  slug: string;
  query: string;
  timestamp: string;
}

export interface CacheIndex {
  searches: IndexEntry[];
}

/** Maximum number of index entries to feed to the LLM judge. */
const MAX_JUDGE_ENTRIES = 20;

// ═══════════════════════════════════════════════════════════════════════════
// Lock primitives — file-system locking via mkdir (atomic on POSIX)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Default time a lock can be held before it is considered stale and can be
 * broken by another process. Guards against orphaned locks from crashed
 * processes. 30 seconds is generous for a few file writes.
 */
const DEFAULT_STALE_MS = 30_000;

/** Default poll interval for lock acquisition, with jitter. */
const DEFAULT_POLL_MS = 50;

/** Default timeout to wait for lock acquisition before giving up. */
const DEFAULT_LOCK_TIMEOUT_MS = 10_000;

/** Create the per-cache-path lock directory path. */
export function cacheLockDir(cachePath: string): string {
  return join(cachePath, ".lock");
}

/** Create the index lock directory path for a cache dir. */
export function indexLockDir(cacheDir: string): string {
  return join(cacheDir, ".index.lock");
}

/**
 * Acquire an advisory file-system lock by atomically creating a directory.
 * `mkdir` without `recursive` is atomic on POSIX: exactly one caller succeeds;
 * everyone else gets EEXIST.
 *
 * Stale locks (orphaned by a crash) are detected via birth-time and broken
 * automatically so a single crashed run cannot permanently block the lock.
 *
 * Returns a release function. The caller **must** call release, even on
 * error (use try/finally). The release is best-effort: failures are swallowed
 * so a double-release is safe.
 */
export async function acquireLock(
  lockDir: string,
  opts?: {
    timeoutMs?: number;
    staleMs?: number;
    pollMs?: number;
  },
): Promise<() => Promise<void>> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const staleMs = opts?.staleMs ?? DEFAULT_STALE_MS;
  const pollMs = opts?.pollMs ?? DEFAULT_POLL_MS;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    try {
      await mkdir(lockDir);
      // Write PID for debugging stuck-lock scenarios.
      await writeFile(join(lockDir, "pid"), String(process.pid), "utf-8");
      return async () => {
        try {
          await rm(lockDir, { recursive: true, force: true });
        } catch {
          // Best-effort release. Double-release is harmless.
        }
      };
    } catch (err: any) {
      if (err?.code !== "EEXIST") throw err;

      // Check for stale lock from a crashed process.
      if (await isLockStale(lockDir, staleMs)) {
        await rm(lockDir, { recursive: true, force: true });
        continue; // Retry acquisition immediately.
      }

      if (Date.now() >= deadline) {
        throw new Error(
          `Lock timeout: could not acquire ${lockDir} within ${timeoutMs}ms`,
        );
      }

      // Jittered backoff to avoid thundering-herd on lock release.
      const delay = pollMs + Math.floor(Math.random() * pollMs);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

async function isLockStale(
  lockDir: string,
  staleMs: number,
): Promise<boolean> {
  try {
    const s = await stat(lockDir);
    return Date.now() - s.birthtimeMs > staleMs;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Atomic write helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Write a file atomically: write to a unique temp name, then rename(2). */
async function atomicWriteFile(
  filePath: string,
  content: string,
): Promise<void> {
  const tmp = filePath +
    "." + process.pid +
    "." + randomBytes(4).toString("hex") +
    ".tmp";
  await writeFile(tmp, content, "utf-8");
  await rename(tmp, filePath);
}

/**
 * Create a unique staging directory within `parent` and return its path.
 * The staging dir is named `.staging.<pid>.<random>` so concurrent runs
 * cannot collide.
 */
async function createStagingDir(parent: string): Promise<string> {
  const name = `.staging.${process.pid}.${randomBytes(4).toString("hex")}`;
  const staging = join(parent, name);
  await mkdir(staging, { recursive: true });
  return staging;
}

export function makeCachePath(query: string, cwd: string, cacheDir: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const words = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join("-");
  // The 5-word stem is human-readable but collides easily: different queries
  // can reduce to the same words, and the date prefix makes same-day collisions
  // certain. Append a short hash of the full query so distinct queries get
  // distinct directories (no silent overwrite) while the same query stays
  // deterministic (re-research refreshes its own directory).
  const hash = createHash("sha1").update(query).digest("hex").slice(0, 6);
  const stem = words ? `${words}-${hash}` : hash;
  return join(cacheDir, `${date}-${stem}`);
}

export function domainSlug(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").replace(/\./g, "-");
  } catch {
    return "unknown";
  }
}

/**
 * Write cache files using a staging directory for atomic visibility.
 *
 * All files (query.txt, extractions/, sources/) are written inside a unique
 * staging directory first, then atomically moved into `cachePath` with
 * `rename`. A reader sees either the complete previous state or the complete
 * new state — never a partial write.
 *
 * The index update is NOT done here; callers must trigger it separately
 * under the index lock so multiple cache-dir writes do not race on the
 * shared .index.json.
 */
export async function writeCacheFiles(
  cachePath: string,
  extractions: ExtractResult[],
  pages: FetchedPage[],
  searchSummary: string,
  query: string,
): Promise<void> {
  // Ensure cachePath exists so staging can live inside it.
  await mkdir(cachePath, { recursive: true });
  const staging = await createStagingDir(cachePath);

  try {
    const stagingExtractions = join(staging, "extractions");
    const stagingSources = join(staging, "sources");
    await mkdir(stagingExtractions, { recursive: true });
    await mkdir(stagingSources, { recursive: true });

    // query.txt
    await writeFile(join(staging, "query.txt"), query, "utf-8");

    // Write extractions
    for (const [i, ext] of extractions.entries()) {
      if (ext.status !== "success" || !ext.extraction) continue;
      const filename = `${String(i + 1).padStart(2, "0")}-${domainSlug(ext.url)}.md`;
      const header = `# ${ext.title}\n\n> Source: ${ext.url}\n> Type: ${ext.sourceType}\n\n---\n\n`;
      await writeFile(join(stagingExtractions, filename), header + ext.extraction, "utf-8");
    }

    // Write full pages (sources)
    for (const [i, page] of pages.entries()) {
      if (page.status !== "success") continue;
      const filename = `${String(i + 1).padStart(2, "0")}-${domainSlug(page.url)}.md`;
      const header = `# ${page.title}\n\n> Source: ${page.url}\n\n---\n\n`;
      await writeFile(join(stagingSources, filename), header + page.content, "utf-8");
    }

    // Atomically move staged files into the final location.
    // For each file in staging, rename it to its target. If the target
    // already exists, unlink it first.
    await moveStagedFiles(staging, cachePath);
  } finally {
    // Clean up staging directory (best-effort, ignore errors).
    await rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Move all files from `staging` to `target`, preserving the directory
 * structure. Uses rename(2) which is atomic per-file on the same filesystem.
 * Existing files at the target are replaced.
 */
async function moveStagedFiles(
  staging: string,
  target: string,
): Promise<void> {
  const entries = await readdir(staging, { withFileTypes: true });
  for (const entry of entries) {
    const src = join(staging, entry.name);
    const dst = join(target, entry.name);
    if (entry.isDirectory()) {
      await mkdir(dst, { recursive: true });
      await moveStagedFiles(src, dst);
    } else {
      // Remove target if it exists, then rename.
      await rm(dst, { force: true }).catch(() => {});
      await rename(src, dst);
    }
  }
}

/**
 * Write the research report atomically.
 *
 * Builds the report content, writes it to a temp file, then renames into
 * place so a reader never sees a partially-written report.
 */
export async function writeReportFile(
  cachePath: string,
  query: string,
  collation: string,
  extractions: ExtractResult[],
  pages: FetchedPage[],
): Promise<void> {
  await mkdir(cachePath, { recursive: true });
  const now = new Date().toISOString();
  const succeeded = extractions.filter((e) => e.status === "success");
  const blocked = extractions.filter((e) => e.status !== "success");

  let report = `# ${query}\n\n`;
  report += `> Searched: ${now}\n`;
  report += `> Cache: ${cachePath}/\n`;
  report += `> Sources: ${succeeded.length} succeeded, ${blocked.length} blocked\n\n`;
  report += collation + "\n\n";

  // Source index table
  report += `## Source index\n\n`;
  report += `| # | Source | Type | Extraction | Full page |\n`;
  report += `|---|--------|------|------------|----------|\n`;
  for (const [i, ext] of succeeded.entries()) {
    const filename = `${String(i + 1).padStart(2, "0")}-${domainSlug(ext.url)}.md`;
    report += `| ${i + 1} | ${ext.url} | ${ext.sourceType} | extractions/${filename} | sources/${filename} |\n`;
  }

  if (blocked.length > 0) {
    report += `\n## Blocked/Failed URLs\n\n`;
    for (const page of pages.filter((p) => p.status !== "success")) {
      report += `- ${page.url}${page.error ? ` — ${page.error}` : ""}\n`;
    }
  }

  await atomicWriteFile(join(cachePath, "report.md"), report);
}

/**
 * Atomically update the shared cache index.
 *
 * The caller MUST hold the index lock (`acquireLock(indexLockDir(cacheDir))`)
 * before calling this. The lock serialises concurrent writers to the shared
 * .index.json across different cache paths.
 *
 * The update itself is atomic: read → modify in memory → write to temp →
 * rename into place. A crash mid-write leaves a stray .tmp (cleaned up by the
 * next successful write), never a partial .index.json.
 */
export async function updateIndex(
  cacheDir: string,
  slug: string,
  query: string,
): Promise<void> {
  await mkdir(cacheDir, { recursive: true });
  const indexPath = join(cacheDir, ".index.json");

  let index: CacheIndex;
  try {
    const raw = await readFile(indexPath, "utf-8");
    index = JSON.parse(raw);
  } catch {
    index = { searches: [] };
  }

  // Drop any prior entry for this slug so re-researching the same query
  // refreshes its entry rather than accumulating duplicates (which would make
  // cache suggest list the same search several times).
  index.searches = index.searches.filter((e) => e.slug !== slug);
  index.searches.push({ slug, query, timestamp: new Date().toISOString() });

  await atomicWriteFile(indexPath, JSON.stringify(index, null, 2) + "\n");
}

/** Read the cache index. Returns empty index if file doesn't exist. */
export async function readIndex(cacheDir: string): Promise<CacheIndex> {
  const indexPath = join(cacheDir, ".index.json");
  try {
    const raw = await readFile(indexPath, "utf-8");
    return JSON.parse(raw) as CacheIndex;
  } catch {
    return { searches: [] };
  }
}

/**
 * Format the cache index for the LLM judge.
 * Returns the most recent MAX_JUDGE_ENTRIES entries as a numbered list.
 * Excludes the entry matching `excludeSlug` (the current search).
 */
export function formatIndexForJudge(index: CacheIndex, excludeSlug?: string): string {
  // Take most recent entries, excluding the current search
  const entries = index.searches
    .filter((e) => e.slug !== excludeSlug)
    .slice(-MAX_JUDGE_ENTRIES);

  if (entries.length === 0) return "No previous searches.";

  return entries
    .map((e, i) => `${i + 1}. "${e.query}" (slug: ${e.slug}, searched: ${e.timestamp})`)
    .join("\n");
}

/**
 * Parse the LLM judge response into matching index entries.
 * Expects a JSON array of { index, relevance } objects.
 * Returns the matched entries with their relevance notes.
 */
export function parseJudgeResponse(
  response: string,
  index: CacheIndex,
  excludeSlug?: string,
): Array<{ entry: IndexEntry; relevance: string }> {
  const eligible = index.searches.filter((e) => e.slug !== excludeSlug);

  // Extract JSON array from the response — the LLM may wrap it in markdown
  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  let parsed: Array<{ index?: number; relevance?: string }>;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const results: Array<{ entry: IndexEntry; relevance: string }> = [];
  for (const item of parsed) {
    if (typeof item.index !== "number" || item.index < 1) continue;
    const entry = eligible[item.index - 1]; // 1-based from the numbered list
    if (!entry) continue;
    results.push({ entry, relevance: item.relevance ?? "" });
  }

  return results;
}

/**
 * Format matched cache entries as a human-readable appendix for the tool output.
 */
export function formatCacheSuggestions(
  matches: Array<{ entry: IndexEntry; relevance: string }>,
  cacheDir: string,
): string {
  if (matches.length === 0) return "";

  // Compute relative age
  const now = Date.now();
  const age = (ts: string): string => {
    const hours = Math.floor((now - new Date(ts).getTime()) / 3_600_000);
    if (hours < 1) return "just now";
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  let out = "\n---\n\n## 📚 Related cached searches\n\n";
  out += "The following previous searches may contain relevant supplementary information. ";
  out += "Read a report with `read .search/<slug>/report.md` if the live results are insufficient.\n\n";
  out += "| # | Query | Age | Why related |\n";
  out += "|---|-------|-----|-------------|\n";
  for (const [i, m] of matches.entries()) {
    const queryTrunc = m.entry.query.length > 60 ? m.entry.query.slice(0, 57) + "..." : m.entry.query;
    out += `| ${i + 1} | \`${queryTrunc}\` | ${age(m.entry.timestamp)} | ${m.relevance} |\n`;
  }
  out += `\nCache directory: \`${cacheDir}/\`\n`;
  return out;
}
