// src/cache.ts — .search/ cache read/write utilities
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FetchedPage, ExtractResult } from "./types.js";

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

  interface IndexEntry {
    slug: string;
    query: string;
    timestamp: string;
  }
  interface Index {
    searches: IndexEntry[];
  }

  let index: Index;
  try {
    const raw = await readFile(indexPath, "utf-8");
    index = JSON.parse(raw);
  } catch {
    index = { searches: [] };
  }

  index.searches.push({ slug, query, timestamp: new Date().toISOString() });
  await writeFile(indexPath, JSON.stringify(index, null, 2));
}
