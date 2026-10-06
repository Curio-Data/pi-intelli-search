// src/core/cache.ts: .search/ cache read/write utilities
//
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
// SPDX-License-Identifier: Apache-2.0
import { mkdir, writeFile, readFile, rename, rm, stat, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveWorkspacePaths } from "./paths.js";
import { createHash, randomBytes } from "node:crypto";
import { sleep, throwIfAborted } from "./util.js";
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

/** Filename prefix of supplementary documentation downloads in sources/. */
const LLMS_FULL_PREFIX = "llms-full-";

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
    signal?: AbortSignal;
  },
): Promise<() => Promise<void>> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const staleMs = opts?.staleMs ?? DEFAULT_STALE_MS;
  const pollMs = opts?.pollMs ?? DEFAULT_POLL_MS;
  const deadline = Date.now() + timeoutMs;
  throwIfAborted(opts?.signal);
  await mkdir(dirname(lockDir), { recursive: true });

  while (true) {
    throwIfAborted(opts?.signal);
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
        throw new Error(`Lock timeout: could not acquire ${lockDir} within ${timeoutMs}ms`);
      }

      // Jittered backoff to avoid thundering-herd on lock release.
      const delay = pollMs + Math.floor(Math.random() * pollMs);
      await sleep(delay, opts?.signal);
    }
  }
}

async function isLockStale(lockDir: string, staleMs: number): Promise<boolean> {
  try {
    const s = await stat(lockDir);
    return Date.now() - s.birthtimeMs > staleMs;
  } catch {
    return false;
  }
}

/**
 * Run `fn` while holding the lock at `lockDir`, always releasing in a
 * finally. Preferred over calling acquireLock directly so the try/finally
 * release pattern cannot be forgotten.
 *
 * Lock-ordering invariant (deadlock freedom): the index lock
 * (`indexLockDir`) is only ever acquired while already holding the
 * per-cache-path lock (`cacheLockDir`), never the reverse. Callers nesting
 * two withLock calls must keep that order.
 */
export async function withLock<T>(
  lockDir: string,
  fn: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const release = await acquireLock(lockDir, { signal });
  try {
    throwIfAborted(signal);
    return await fn();
  } finally {
    await release();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Atomic write helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Write a file atomically: write to a unique temp name, then rename(2). */
async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const tmp = filePath + "." + process.pid + "." + randomBytes(4).toString("hex") + ".tmp";
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

/**
 * Return an absolute physical cache path. `cwd` must be an absolute workspace
 * root; relative roots are rejected rather than resolved against process.cwd().
 * `cacheDir` accepts a configured relative path or an already-resolved absolute
 * cache root (which takes precedence over `cwd`). Use displayCachePath for text.
 */
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
  return join(resolveWorkspacePaths(cwd, cacheDir).cacheRoot, `${date}-${stem}`);
}

export function domainSlug(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").replace(/\./g, "-");
  } catch {
    return "unknown";
  }
}

/** Canonical cache filename for the Nth (0-based) source of `url`: "01-example-com.md". */
export function sourceFilename(index: number, url: string): string {
  return `${String(index + 1).padStart(2, "0")}-${domainSlug(url)}.md`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Source identity — one filename allocation shared by every consumer
// ═══════════════════════════════════════════════════════════════════════════

/**
 * File identity for one research run, allocated once and reused by physical
 * cache writes, the collation prompt and the report so every advertised path
 * matches a file that is actually written.
 *
 * Slots are keyed by URL and allocated in array order: extractions first,
 * then full pages whose URL has no slot yet. A run whose extractions all
 * succeed (pages in extraction order) keeps the historical 01-, 02-…
 * numbering; mixed outcomes stop the report from citing files that were
 * never written (a leading failed extraction no longer shifts the numbering
 * between physical files and prompts/reports).
 */
export interface SourceIdentity {
  /** Filename per extraction entry, or null when that entry writes no file. */
  readonly extractionFiles: ReadonlyArray<string | null>;
  /** Filename per page entry, or null when that entry writes no file. */
  readonly sourceFiles: ReadonlyArray<string | null>;
  /** Filename of the extraction file written for `url`, when this run writes one. */
  extractionFileFor(url: string): string | null;
  /** Filename of the full-page file written for `url`, when this run writes one. */
  sourceFileFor(url: string): string | null;
}

export function allocateSourceIdentity(
  extractions: readonly ExtractResult[],
  pages: readonly FetchedPage[],
): SourceIdentity {
  const extractionFileByUrl = new Map<string, string>();
  const sourceFileByUrl = new Map<string, string>();
  const slotByUrl = new Map<string, number>();
  let nextSlot = 0;
  const slotOf = (url: string): number => {
    let slot = slotByUrl.get(url);
    if (slot === undefined) {
      slot = nextSlot++;
      slotByUrl.set(url, slot);
    }
    return slot;
  };

  // Extractions allocate first so fully successful runs keep today's numbering.
  // Slots are positional: a failed or blocked entry still consumes its slot, so
  // a mixed run keeps exactly the physical filenames the previous
  // implementation wrote — only prompts and reports change to match them.
  const extractionFiles = extractions.map((ext) => {
    const slot = slotOf(ext.url);
    if (ext.status !== "success" || !ext.extraction) return null;
    const filename = sourceFilename(slot, ext.url);
    extractionFileByUrl.set(ext.url, filename);
    return filename;
  });
  const sourceFiles = pages.map((page) => {
    const slot = slotOf(page.url);
    if (page.status !== "success") return null;
    const filename = sourceFilename(slot, page.url);
    sourceFileByUrl.set(page.url, filename);
    return filename;
  });

  return {
    extractionFiles,
    sourceFiles,
    extractionFileFor: (url) => extractionFileByUrl.get(url) ?? null,
    sourceFileFor: (url) => sourceFileByUrl.get(url) ?? null,
  };
}

/**
 * Write cache files using a staging directory, replacing the previous
 * run's artefact set for the same cache path.
 *
 * All files (query.txt, extractions/, sources/) are written inside a unique
 * staging directory first, then committed with per-file `rename` under the
 * caller's per-cache-path lock (see `withLock(cacheLockDir(...))` in the
 * operations). The commit also prunes extraction/source files from a
 * previous run that this run did not write, so a refresh cannot mix old
 * and new artefact sets; supplementary documentation downloads
 * (`llms-full-*.md` in sources/) are preserved across refreshes.
 *
 * Atomicity is per file: each `rename` replaces its target atomically, but a
 * reader that does not hold the cache lock can observe a mix of old and new
 * files during the commit. Callers that need a consistent view must hold
 * the lock.
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
  identity: SourceIdentity = allocateSourceIdentity(extractions, pages),
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

    // Write extractions using the shared identity so prompts and the report
    // cite exactly the filenames that land on disk. Filenames resolve by URL,
    // so the arrays passed here need not be the exact arrays the identity was
    // allocated from (the research pipeline passes filtered success pages).
    const writtenExtractions = new Set<string>();
    for (const ext of extractions) {
      if (ext.status !== "success" || !ext.extraction) continue;
      const filename = identity.extractionFileFor(ext.url);
      if (!filename) continue;
      const header = `# ${ext.title}\n\n> Source: ${ext.url}\n> Type: ${ext.sourceType}\n\n---\n\n`;
      await writeFile(join(stagingExtractions, filename), header + ext.extraction, "utf-8");
      writtenExtractions.add(filename);
    }

    // Write full pages (sources) under the same identity: a page whose URL
    // already holds an extraction slot keeps that slot, so the report's
    // sources/<filename> reference always matches the physical file.
    const writtenSources = new Set<string>();
    for (const page of pages) {
      if (page.status !== "success") continue;
      const filename = identity.sourceFileFor(page.url);
      if (!filename) continue;
      const header = `# ${page.title}\n\n> Source: ${page.url}\n\n---\n\n`;
      await writeFile(join(stagingSources, filename), header + page.content, "utf-8");
      writtenSources.add(filename);
    }

    await commitStagedArtefacts(staging, cachePath, writtenExtractions, writtenSources);
  } finally {
    // Clean up staging directory (best-effort, ignore errors).
    await rm(staging, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Commit staged artefacts: replace each file atomically (rename overwrites
 * a regular target on POSIX), then prune files left by a previous run so the
 * cache directory advertises exactly this run's artefact set. `llms-full-*`
 * documentation downloads in sources/ are preserved.
 */
async function commitStagedArtefacts(
  staging: string,
  cachePath: string,
  writtenExtractions: ReadonlySet<string>,
  writtenSources: ReadonlySet<string>,
): Promise<void> {
  const finalExtractions = join(cachePath, "extractions");
  const finalSources = join(cachePath, "sources");
  await mkdir(finalExtractions, { recursive: true });
  await mkdir(finalSources, { recursive: true });

  await rename(join(staging, "query.txt"), join(cachePath, "query.txt"));
  for (const name of writtenExtractions) {
    await rename(join(staging, "extractions", name), join(finalExtractions, name));
  }
  for (const name of writtenSources) {
    await rename(join(staging, "sources", name), join(finalSources, name));
  }

  await pruneDirectory(finalExtractions, writtenExtractions, null);
  await pruneDirectory(finalSources, writtenSources, LLMS_FULL_PREFIX);
}

/**
 * Remove entries of `dir` that are not in `keep`. Entries starting with
 * `preservePrefix` are never removed (supplementary documentation).
 */
async function pruneDirectory(
  dir: string,
  keep: ReadonlySet<string>,
  preservePrefix: string | null,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err: any) {
    if (err?.code === "ENOENT") return;
    throw err;
  }
  for (const name of entries) {
    if (keep.has(name)) continue;
    if (preservePrefix && name.startsWith(preservePrefix)) continue;
    await rm(join(dir, name), { force: true });
  }
}

/**
 * Remove a previous run's cache artefacts from `cachePath`, keeping only
 * supplementary documentation downloads (`llms-full-*.md` in sources/) and
 * operational files (`meta.json`, lock directories). Used by degraded exits:
 * a degraded refresh of an existing entry must not leave an older report
 * and extraction set alongside newer degraded telemetry.
 *
 * The caller MUST hold the per-cache-path lock.
 */
export async function clearCacheArtefacts(cachePath: string): Promise<void> {
  await Promise.all([
    rm(join(cachePath, "report.md"), { force: true }),
    rm(join(cachePath, "query.txt"), { force: true }),
    rm(join(cachePath, "extractions"), { recursive: true, force: true }),
  ]);
  await pruneDirectory(join(cachePath, "sources"), new Set(), LLMS_FULL_PREFIX);
}

/**
 * Write the research report atomically.
 *
 * Builds the report content, writes it to a temp file, then renames into
 * place so a reader never sees a partially-written report. Source-file
 * references come from `identity`, so every advertised path matches a file
 * `writeCacheFiles` wrote with the same identity; absent optional full-page
 * content renders as a Not cached cell instead of a broken path.
 */
export async function writeReportFile(
  cachePath: string,
  query: string,
  collation: string,
  extractions: ExtractResult[],
  pages: FetchedPage[],
  displayPath: string = cachePath,
  identity: SourceIdentity = allocateSourceIdentity(extractions, pages),
): Promise<void> {
  await mkdir(cachePath, { recursive: true });
  const now = new Date().toISOString();
  const succeeded = extractions.filter((e) => e.status === "success");
  const blocked = extractions.filter((e) => e.status !== "success");

  let report = `# ${query}\n\n`;
  report += `> Searched: ${now}\n`;
  report += `> Cache: ${displayPath}/\n`;
  report += `> Sources: ${succeeded.length} succeeded, ${blocked.length} blocked\n\n`;
  report += collation + "\n\n";

  // Source index table
  report += `## Source index\n\n`;
  report += `| # | Source | Type | Extraction | Full page |\n`;
  report += `|---|--------|------|------------|----------|\n`;
  for (const [i, ext] of succeeded.entries()) {
    const extractionFile = identity.extractionFileFor(ext.url);
    const sourceFile = identity.sourceFileFor(ext.url);
    report += `| ${i + 1} | ${ext.url} | ${ext.sourceType} | ${
      extractionFile ? `extractions/${extractionFile}` : "Not cached"
    } | ${sourceFile ? `sources/${sourceFile}` : "Not cached"} |\n`;
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
export async function updateIndex(cacheDir: string, slug: string, query: string): Promise<void> {
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
 * Remove `slug` from the shared cache index, atomically.
 *
 * Used by degraded exits: a degraded refresh that clears a previous run's
 * artefacts must also drop the index entry, or cache suggest would surface a
 * search whose report no longer exists. The caller MUST hold the index lock
 * (`acquireLock(indexLockDir(cacheDir))`), acquired while holding the
 * per-cache-path lock (the documented lock order).
 *
 * A missing or malformed index file, or an entry that is not present, leaves
 * the filesystem untouched: this never creates an empty index for a cache
 * root that has no successful history.
 */
export async function removeIndexEntry(cacheDir: string, slug: string): Promise<void> {
  const indexPath = join(cacheDir, ".index.json");
  let index: CacheIndex;
  try {
    index = JSON.parse(await readFile(indexPath, "utf-8"));
  } catch {
    return; // No readable index: nothing to remove, and never create one.
  }
  if (!Array.isArray(index.searches) || !index.searches.some((e) => e.slug === slug)) return;
  index.searches = index.searches.filter((e) => e.slug !== slug);
  await atomicWriteFile(indexPath, JSON.stringify(index, null, 2) + "\n");
}

/**
 * The candidate window shared by the judge prompt and its response parser:
 * the most recent `MAX_JUDGE_ENTRIES` entries, excluding `excludeSlug`.
 * Both consumers MUST resolve numbered items against this same window;
 * otherwise a judge answer about item N resolves to a different entry once
 * the eligible history exceeds the window.
 */
export function judgeCandidates(index: CacheIndex, excludeSlug?: string): IndexEntry[] {
  return index.searches.filter((e) => e.slug !== excludeSlug).slice(-MAX_JUDGE_ENTRIES);
}

/**
 * Format the cache index for the LLM judge.
 * Returns the `judgeCandidates` window as a numbered list.
 */
export function formatIndexForJudge(index: CacheIndex, excludeSlug?: string): string {
  // Take the shared candidate window (most recent entries, excluding the
  // current search).
  const entries = judgeCandidates(index, excludeSlug);

  if (entries.length === 0) return "No previous searches.";

  return entries
    .map((e, i) => `${i + 1}. "${e.query}" (slug: ${e.slug}, searched: ${e.timestamp})`)
    .join("\n");
}

/**
 * Parse the LLM judge response into matching index entries.
 * Expects a JSON array of { index, relevance } objects. Indexes are 1-based
 * positions in the `judgeCandidates` window — the same window
 * `formatIndexForJudge` rendered — so an answer about item N always resolves
 * to the entry the model saw at position N.
 */
export function parseJudgeResponse(
  response: string,
  index: CacheIndex,
  excludeSlug?: string,
): Array<{ entry: IndexEntry; relevance: string }> {
  const candidates = judgeCandidates(index, excludeSlug);

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
    const entry = candidates[item.index - 1]; // 1-based from the numbered list
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
  out += "Read the report listed for a match if the live results are insufficient.\n\n";
  out += "| # | Query | Age | Report | Why related |\n";
  out += "|---|-------|-----|--------|-------------|\n";
  for (const [i, m] of matches.entries()) {
    const queryTrunc =
      m.entry.query.length > 60 ? m.entry.query.slice(0, 57) + "..." : m.entry.query;
    out += `| ${i + 1} | \`${queryTrunc}\` | ${age(m.entry.timestamp)} | `;
    out += `\`${cacheDir}/${m.entry.slug}/report.md\` | ${m.relevance} |\n`;
  }
  out += `\nCache directory: \`${cacheDir}/\`\n`;
  return out;
}
