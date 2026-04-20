// src/fetch.ts — Fetch individual pages, compare HTML vs markdown, use best.
// Also provides a helper to download site-wide llms-full.txt raw to cache.
//
// For each URL:
//   1. Fetch HTML → Defuddle → markdown  (in parallel with)
//   2. Fetch .md variant (Accept: text/markdown or alt-link)
//   3. Compare quality and return the cleaner/more complete version
//
// For sites with llms-full.txt:
//   4. Download raw to cache for offline grep by the agent
//
import { fetch as wreqFetch } from "wreq-js";
import { Defuddle } from "defuddle/node";
import { parseHTML } from "linkedom";
import type { FetchedPage } from "./types.js";

export interface FetchOptions {
  maxChars: number;
  timeoutMs: number;
  format: string;
}

const DEFAULT_FETCH_OPTIONS: FetchOptions = {
  maxChars: 500_000,
  timeoutMs: 20_000,
  format: "markdown",
};

// ---------------------------------------------------------------------------
// Public API — single page (Defuddle vs markdown comparison)
// ---------------------------------------------------------------------------

/**
 * Fetch a single URL. Fetches HTML→Defuddle and markdown variant in parallel,
 * compares quality, returns the better result.
 */
async function fetchSingle(url: string, opts: FetchOptions): Promise<FetchedPage> {
  try {
    return await fetchWithComparison(url, opts);
  } catch (err: unknown) {
    return {
      url,
      title: "",
      content: "",
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Fetch via both HTML→Defuddle and markdown endpoint,
 * compare quality, return the better result.
 */
async function fetchWithComparison(url: string, opts: FetchOptions): Promise<FetchedPage> {
  // Run both fetches in parallel
  const results = await Promise.allSettled([
    fetchViaDefuddle(url, opts),
    fetchMarkdownVariant(url, opts),
  ]);

  const defuddlePage = results[0].status === "fulfilled" ? results[0].value : null;
  const markdownPage = results[1].status === "fulfilled" ? results[1].value : null;

  if (!defuddlePage && !markdownPage) {
    const e0 = results[0].status === "rejected" ? results[0].reason : null;
    const e1 = results[1].status === "rejected" ? results[1].reason : null;
    const err = e0 ?? e1 ?? new Error("Both fetch pipelines failed");
    throw err;
  }
  if (!defuddlePage) return markdownPage!;
  if (!markdownPage) return defuddlePage;

  return compareAndPick(defuddlePage, markdownPage);
}

/**
 * Compare Defuddle output vs raw markdown and pick the better one.
 * Heuristic: code blocks, headings, tables = bonus. Nav chrome = penalty.
 */
function compareAndPick(a: FetchedPage, b: FetchedPage): FetchedPage {
  const aScore = scoreContent(a.content);
  const bScore = scoreContent(b.content);

  // Log the comparison for debugging
  if (aScore !== bScore) {
    console.error(
      `[pi-web-research fetch] ${a.url}: defuddle=${aScore} markdown=${bScore} → picked ${bScore > aScore ? "markdown" : "defuddle"}`,
    );
  }

  if (bScore > aScore) {
    return { ...b, status: "success", source: "markdown" };
  }
  return { ...a, status: "success", source: "defuddle" };
}

/** Score markdown content quality. Higher = cleaner and more useful. */
function scoreContent(content: string): number {
  let score = content.length;

  // Bonus for code blocks (high-value technical content)
  score += (content.match(/```/g) ?? []).length * 100;

  // Bonus for headings (good structure)
  score += (content.match(/^#{1,6}\s/gm) ?? []).length * 50;

  // Bonus for tables
  score += (content.match(/^\|/gm) ?? []).length * 20;

  // Penalty for nav chrome artifacts
  score -= (content.match(/Skip to content|Was this helpful|Edit page|Report issue|Copy page/g) ?? []).length * 500;

  // Penalty for YAML frontmatter (should have been cleaned)
  if (content.startsWith("---")) score -= 1000;

  return score;
}

// ---------------------------------------------------------------------------
// Pipeline 1: HTML → Defuddle → markdown
// ---------------------------------------------------------------------------

async function fetchViaDefuddle(url: string, opts: FetchOptions): Promise<FetchedPage> {
  const response = await rawFetch(url, opts);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
    throw new Error(`Not HTML: ${contentType}`);
  }

  const body = await response.text();
  const { document } = parseHTML(body);
  const extracted = await Defuddle(document, url, { markdown: true });

  const title = extracted.title ?? "";
  const content = extracted.contentMarkdown ?? extracted.content ?? body;

  return {
    url,
    title,
    content: truncateContent(content, opts.maxChars),
    status: "success",
    source: "defuddle",
  };
}

// ---------------------------------------------------------------------------
// Pipeline 2: Markdown endpoint (Accept header or alt-link)
// ---------------------------------------------------------------------------

async function fetchMarkdownVariant(url: string, opts: FetchOptions): Promise<FetchedPage | null> {
  // a) Accept: text/markdown header (VitePress, FastAPI docs, etc.)
  const acceptResult = await fetchWithAcceptHeader(url, opts);
  if (acceptResult) return acceptResult;

  // b) Starlight/Astro: <link rel="alternate" type="text/markdown" href="...">
  const mdUrl = await findMarkdownAlternate(url, opts);
  if (mdUrl) return await fetchMarkdown(mdUrl, opts);

  return null;
}

async function fetchWithAcceptHeader(url: string, opts: FetchOptions): Promise<FetchedPage | null> {
  try {
    const response = await wreqFetch(url, {
      browser: "chrome_145",
      os: "windows",
      headers: { Accept: "text/markdown" },
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    if (!response.ok) return null;
    if (!response.headers.get("content-type")?.includes("text/markdown")) return null;
    return processMarkdownResponse(url, response, opts);
  } catch {
    return null;
  }
}

async function findMarkdownAlternate(url: string, opts: FetchOptions): Promise<string | null> {
  try {
    const response = await rawFetch(url, opts);
    if (!response.ok) return null;
    if (!response.headers.get("content-type")?.includes("text/html")) return null;

    const html = await response.text();
    const { document } = parseHTML(html);

    const links = document.querySelectorAll('link[rel="alternate"][type="text/markdown"]');
    for (const link of Array.from(links)) {
      const href = link.getAttribute("href");
      if (href) return new URL(href, url).href;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchMarkdown(mdUrl: string, opts: FetchOptions): Promise<FetchedPage> {
  const response = await rawFetch(mdUrl, opts);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  return processMarkdownResponse(mdUrl, response, opts);
}

async function processMarkdownResponse(
  url: string,
  response: Awaited<ReturnType<typeof rawFetch>>,
  opts: FetchOptions,
): Promise<FetchedPage> {
  let content = await response.text();
  content = sanitizeMarkdown(content);

  return {
    url,
    title: guessTitleFromMarkdown(content) || "",
    content: truncateContent(content, opts.maxChars),
    status: "success",
    source: "markdown",
  };
}

// ---------------------------------------------------------------------------
// llms-full.txt download — raw, no processing
// ---------------------------------------------------------------------------

/**
 * Known site → product path → llms-full.txt URL mapping.
 * Sites that provide product-scoped llms-full.txt files.
 */
const LLMS_FULL_SITES: Record<string, (url: string) => string | null> = {
  "developers.cloudflare.com": (url: string) => {
    // Extract product subpath from URL path: /d1/worker-api/ → /d1/llms-full.txt
    const match = new URL(url).pathname.match(/^\/([^/]+)\//);
    if (match) {
      return `https://developers.cloudflare.com/${match[1]}/llms-full.txt`;
    }
    return null;
  },
  "nextjs.org": () => `https://nextjs.org/docs/llms-full.txt`,
  "vite.dev": () => `https://vite.dev/llms-full.txt`,
};

/**
 * Download llms-full.txt for a site and write it to the research cache.
 * The file is stored raw — no LLM processing needed. The agent can
 * grep/search it offline for future lookups.
 *
 * Returns the cache file path if downloaded, null otherwise.
 */
export async function downloadLlmsFullToCache(
  url: string,
  cachePath: string,
  timeoutMs: number = 30_000,
): Promise<string | null> {
  const hostname = safeHostname(url);
  if (!hostname) return null;

  const builder = LLMS_FULL_SITES[hostname];
  if (!builder) return null;

  const llmsFullUrl = builder(url);
  if (!llmsFullUrl) return null;

  try {
    const response = await wreqFetch(llmsFullUrl, {
      browser: "chrome_145",
      os: "windows",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;

    // Write raw to cache — no sanitization needed, it's already clean markdown
    const content = await response.text();
    if (content.length === 0) return null;

    // Import fs dynamically to avoid circular deps
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    const fullCachePath = join(cachePath, "sources");
    await mkdir(fullCachePath, { recursive: true });

    const filename = `llms-full-${hostname}.md`;
    const filepath = join(fullCachePath, filename);
    await writeFile(filepath, content);

    return filepath;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function rawFetch(url: string, opts: FetchOptions) {
  return wreqFetch(url, {
    browser: "chrome_145",
    os: "windows",
    signal: AbortSignal.timeout(opts.timeoutMs),
  });
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function guessTitleFromMarkdown(content: string): string {
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
  if (frontmatter) {
    const titleMatch = frontmatter[1].match(/^title:\s*(.+)$/m);
    if (titleMatch) return titleMatch[1].trim().replace(/^["']|["']$/g, "");
  }
  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (headingMatch) return headingMatch[1].trim();
  return "";
}

/** Strip nav chrome and frontmatter from markdown exports. */
function sanitizeMarkdown(content: string): string {
  content = content.replace(/^---\n[\s\S]*?\n---\s*\n/, "");
  content = content.replace(/\[Skip to content\].*?\n/g, "");
  content = content.replace(/Was this helpful\?\s*\n\s*YesNo\s*\n/g, "");
  content = content.replace(/^Copy (?:page|for LLM|for AI)\n/gm, "");
  content = content.replace(/\[\s*Edit page\s*\]\([^)]*\)/g, "");
  content = content.replace(/\[\s*Report issue\s*\]\([^)]*\)/g, "");
  content = content.replace(/^Edit on GitHub\s*\n/gm, "");
  content = content.replace(/\n{3,}/g, "\n\n");
  return content.trim();
}

function truncateContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + "\n\n[TRUNCATED — content exceeded character limit]";
}

function safeHostname(url: string): string | null {
  try { return new URL(url).hostname; } catch { return null; }
}

// ---------------------------------------------------------------------------
// Batch fetch
// ---------------------------------------------------------------------------

/**
 * Fetch multiple pages. For each: Defuddle vs markdown → pick best.
 */
export async function fetchPages(
  urls: string[],
  signal?: AbortSignal,
  concurrency: number = 4,
): Promise<FetchedPage[]> {
  const opts = { ...DEFAULT_FETCH_OPTIONS };
  const results: (FetchedPage | null)[] = new Array(urls.length).fill(null);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < urls.length) {
      if (signal?.aborted) return;
      const index = nextIndex++;
      results[index] = await fetchSingle(urls[index], opts);
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, urls.length) }, () => worker());
  await Promise.all(workers);

  return results.map((r, i) =>
    r ?? { url: urls[i], title: "", content: "", status: "error" as const, error: "Worker did not complete" },
  );
}
