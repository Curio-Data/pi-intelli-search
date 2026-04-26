// src/cache.ts — .search/ cache read/write utilities
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
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

export function makeCachePath(query: string, cwd: string, cacheDir: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const words = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .slice(0, 5)
    .join("-");
  return join(cacheDir, `${date}-${words}`);
}

export function domainSlug(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").replace(/\./g, "-");
  } catch {
    return "unknown";
  }
}

export async function writeCacheFiles(
  cachePath: string,
  extractions: ExtractResult[],
  pages: FetchedPage[],
  searchSummary: string,
  query: string,
): Promise<void> {
  const extractionsPath = join(cachePath, "extractions");
  const sourcesPath = join(cachePath, "sources");

  await mkdir(extractionsPath, { recursive: true });
  await mkdir(sourcesPath, { recursive: true });
  await writeFile(join(cachePath, "query.txt"), query);

  // Write extractions
  for (const [i, ext] of extractions.entries()) {
    if (ext.status !== "success" || !ext.extraction) continue;
    const filename = `${String(i + 1).padStart(2, "0")}-${domainSlug(ext.url)}.md`;
    const header = `# ${ext.title}\n\n> Source: ${ext.url}\n> Type: ${ext.sourceType}\n\n---\n\n`;
    await writeFile(join(extractionsPath, filename), header + ext.extraction);
  }

  // Write full pages (sources)
  for (const [i, page] of pages.entries()) {
    if (page.status !== "success") continue;
    const filename = `${String(i + 1).padStart(2, "0")}-${domainSlug(page.url)}.md`;
    const header = `# ${page.title}\n\n> Source: ${page.url}\n\n---\n\n`;
    await writeFile(join(sourcesPath, filename), header + page.content);
  }

  // Update index — derive slug from cachePath (last path component)
  const slug = cachePath.split("/").pop() ?? cachePath;
  const cacheDir = cachePath.split("/").slice(0, -1).join("/") || ".search";
  await updateIndex(cacheDir, slug, query);
}

export async function writeReportFile(
  cachePath: string,
  query: string,
  collation: string,
  extractions: ExtractResult[],
  pages: FetchedPage[],
): Promise<void> {
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

  await writeFile(join(cachePath, "report.md"), report);
}

async function updateIndex(cacheDir: string, slug: string, query: string): Promise<void> {
  // Ensure cacheDir exists
  await mkdir(cacheDir, { recursive: true });
  const indexPath = join(cacheDir, ".index.json");

  let index: CacheIndex;
  try {
    const raw = await readFile(indexPath, "utf-8");
    index = JSON.parse(raw);
  } catch {
    index = { searches: [] };
  }

  index.searches.push({ slug, query, timestamp: new Date().toISOString() });
  await writeFile(indexPath, JSON.stringify(index, null, 2));
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
