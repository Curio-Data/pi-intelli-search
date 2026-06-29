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
import { fetch as wreqFetch, type BrowserProfile } from "wreq-js";
import { Defuddle } from "defuddle/node";
import { parseHTML } from "linkedom";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FetchedPage } from "./types.js";
import { mapWithConcurrency, withMuzzledConsole } from "./util.js";

export interface FetchOptions {
  maxChars: number;
  timeoutMs: number;
  browser: BrowserProfile;
  concurrency: number;
  /** Optional HTTP proxy URL (mirrors Pi's top-level httpProxy setting). */
  proxy?: string;
}

const DEFAULT_FETCH_OPTIONS: FetchOptions = {
  maxChars: 500_000,
  timeoutMs: 20_000,
  browser: "chrome_145",
  concurrency: 4,
};

// ---------------------------------------------------------------------------
// Public API — single page (Defuddle vs markdown comparison)
// ---------------------------------------------------------------------------

/**
 * Fetch a single URL. Fetches HTML→Defuddle and markdown variant in parallel,
 * compares quality, returns the better result.
 */
async function fetchSingle(url: string, opts: FetchOptions, signal?: AbortSignal): Promise<FetchedPage> {
  try {
    return await fetchWithComparison(url, opts, signal);
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
async function fetchWithComparison(url: string, opts: FetchOptions, signal?: AbortSignal): Promise<FetchedPage> {
  // Run both fetches in parallel
  const results = await Promise.allSettled([
    fetchViaDefuddle(url, opts, signal),
    fetchMarkdownVariant(url, opts, signal),
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
      `[pi-intelli-search fetch] ${a.url}: defuddle=${aScore} markdown=${bScore} → picked ${bScore > aScore ? "markdown" : "defuddle"}`,
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

async function fetchViaDefuddle(url: string, opts: FetchOptions, signal?: AbortSignal): Promise<FetchedPage> {
  const response = await rawFetch(url, opts, signal);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
    throw new Error(`Not HTML: ${contentType}`);
  }

  const body = await response.text();
  const { document } = parseHTML(body);
  cleanBrokenMetadata(document, url);

  // Try Defuddle first. Two failure modes are handled:
  //   1. Defuddle throws (rare). Caught below.
  //   2. Defuddle logs to console.error from its own internal catch and returns
  //      a degraded result (raw serialized body, no clean markdown). This is
  //      the common case for pages with malformed CSS selectors. Defuddle's log
  //      prints the full stack to the user's terminal; we muzzle just that log
  //      for the duration of the call and, when it fires, route to our own DOM
  //      text fallback so the output stays clean and structured.
  let extracted: Awaited<ReturnType<typeof Defuddle>> | undefined;
  let degraded = false;
  try {
    const out = await withMuzzledConsole(
      () => Defuddle(document, url, { markdown: true }),
      // Defuddle logs as `console.error('Defuddle', 'Error ...', error)`.
      ["Defuddle"],
    );
    extracted = out.value;
    degraded = out.muzzled;
  } catch {
    degraded = true;
  }

  if (degraded || !extracted) {
    // Defuddle failed or degraded. Fall back to basic DOM text extraction.
    const title = document.querySelector("title")?.textContent?.trim() ?? "";
    const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() ?? "";
    const bodyText = document.body?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const content = [`# ${title}`,
      metaDesc ? `> ${metaDesc}` : "",
      bodyText.length > 0 ? bodyText : "(No parseable text content)",
    ].filter(Boolean).join("\n\n");

    return {
      url,
      title,
      content: truncateContent(content, opts.maxChars),
      status: "success",
      source: "defuddle-fallback",
    };
  }

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

async function fetchMarkdownVariant(url: string, opts: FetchOptions, signal?: AbortSignal): Promise<FetchedPage | null> {
  // a) Accept: text/markdown header (VitePress, FastAPI docs, etc.)
  const acceptResult = await fetchWithAcceptHeader(url, opts, signal);
  if (acceptResult) return acceptResult;

  // b) Starlight/Astro: <link rel="alternate" type="text/markdown" href="...">
  const mdUrl = await findMarkdownAlternate(url, opts, signal);
  if (mdUrl) return await fetchMarkdown(mdUrl, opts, signal);

  return null;
}

async function fetchWithAcceptHeader(url: string, opts: FetchOptions, signal?: AbortSignal): Promise<FetchedPage | null> {
  try {
    const combinedSignal = combineSignal(signal, opts.timeoutMs);
    const response = await wreqFetch(url, {
      browser: opts.browser,
      os: "windows",
      headers: { Accept: "text/markdown" },
      proxy: opts.proxy,
      signal: combinedSignal,
    });
    if (!response.ok) return null;
    if (!response.headers.get("content-type")?.includes("text/markdown")) return null;
    return processMarkdownResponse(url, response, opts);
  } catch {
    return null;
  }
}

async function findMarkdownAlternate(url: string, opts: FetchOptions, signal?: AbortSignal): Promise<string | null> {
  try {
    const response = await rawFetch(url, opts, signal);
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

async function fetchMarkdown(mdUrl: string, opts: FetchOptions, signal?: AbortSignal): Promise<FetchedPage> {
  const response = await rawFetch(mdUrl, opts, signal);
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
 * Per-probe timeout for llms-full.txt discovery. These downloads are
 * supplementary (raw docs cached for offline grep), not part of the returned
 * summary, so the budget is deliberately tight: a slow or hanging documentation
 * host must not stall the user-facing research result. Probes also honour the
 * caller's AbortSignal, so pressing Esc cancels them immediately.
 */
export const LLMS_FULL_TIMEOUT_MS = 10_000;

/**
 * Known site → llms-full.txt URL builder.
 * Sites whose llms-full.txt is not at the standard /llms-full.txt root.
 * The standard /llms-full.txt convention is auto-probed for all other sites.
 */
const BUILTIN_LLMS_FULL_SITES: Record<string, (url: string) => string | null> = {
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
 *
 * Resolution order:
 *   1. Built-in mappings (Cloudflare product-scoped, Next.js, Vite)
 *   2. Probe the standard /llms-full.txt convention at the domain root
 *
 * The file is stored raw — no LLM processing needed. The agent can
 * grep/search it offline for future lookups.
 *
 * Returns the cache file path if downloaded, null otherwise.
 */
export async function downloadLlmsFullToCache(
  url: string,
  cachePath: string,
  signal?: AbortSignal,
  timeoutMs: number = LLMS_FULL_TIMEOUT_MS,
  proxy?: string,
): Promise<string | null> {
  if (signal?.aborted) return null;
  const hostname = safeHostname(url);
  if (!hostname) return null;

  // 1. Check built-in mappings for sites with non-standard paths
  const builder = BUILTIN_LLMS_FULL_SITES[hostname];
  let llmsFullUrl: string | null = builder ? builder(url) : null;

  // 2. Fall back to the de facto convention: /llms-full.txt at the root
  if (!llmsFullUrl) {
    llmsFullUrl = `https://${hostname}/llms-full.txt`;
  }

  return downloadLlmsFullFile(llmsFullUrl, hostname, cachePath, timeoutMs, signal, proxy);
}

/**
 * Fetch an llms-full.txt URL and write it to the cache.
 */
async function downloadLlmsFullFile(
  llmsFullUrl: string,
  hostname: string,
  cachePath: string,
  timeoutMs: number,
  signal?: AbortSignal,
  proxy?: string,
): Promise<string | null> {

  try {
    const response = await wreqFetch(llmsFullUrl, {
      browser: "chrome_145",
      os: "windows",
      proxy,
      signal: combineSignal(signal, timeoutMs),
    });
    if (!response.ok) return null;

    const content = await response.text();
    if (content.length === 0) return null;

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

/** Combine an external abort signal (e.g. pi agent Esc) with a per-request timeout. */
function combineSignal(external: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (external) {
    return AbortSignal.any([external, timeout]);
  }
  return timeout;
}

async function rawFetch(url: string, opts: FetchOptions, signal?: AbortSignal) {
  return wreqFetch(url, {
    browser: opts.browser,
    os: "windows",
    proxy: opts.proxy,
    signal: combineSignal(signal, opts.timeoutMs),
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

/**
 * Fix or remove meta/link/a tags that would crash Defuddle's MetadataExtractor.
 *
 * Defuddle calls `new URL()` on metadata values (og:url, canonical, etc.).
 * This throws for:
 *   - Literal "undefined" / "null" strings
 *   - Relative paths like "/owner/repo/releases"
 *
 * We resolve relative URLs to absolute using the page URL, and remove
 * elements with unsalvageable values.
 */
function cleanBrokenMetadata(document: Document, pageUrl: string): void {
  const elements = document.querySelectorAll('meta[content], link[href], a[href]');
  for (const el of Array.from(elements)) {
    const tag = (el as Element).tagName.toLowerCase();

    for (const attr of tag === 'meta' ? ['content'] : ['href']) {
      const val = (el as Element).getAttribute(attr);
      if (!val) continue;

      // Remove literal undefined/null
      if (/^(undefined|null)$/i.test(val)) {
        el.remove();
        break;
      }

      // Test if this value is a valid absolute URL
      try {
        new URL(val);
        // Already absolute — nothing to do
      } catch {
        // Not an absolute URL. Try to resolve it against the page URL.
        try {
          const resolved = new URL(val, pageUrl).href;
          (el as Element).setAttribute(attr, resolved);
        } catch {
          // Can't resolve — remove the element to prevent Defuddle crashing
          el.remove();
          break;
        }
      }
    }
  }

  // Strip <script type="application/ld+json"> tags with invalid JSON.
  // Defuddle's _extractSchemaOrgData calls JSON.parse on these, which
  // throws for malformed content (e.g. YouTube pages). Removing invalid
  // scripts upfront prevents a crash and wasted error handling.
  const ldJsonScripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of Array.from(ldJsonScripts)) {
    const text = script.textContent?.trim();
    if (!text) {
      script.remove();
      continue;
    }
    try {
      JSON.parse(text);
    } catch {
      script.remove();
    }
  }
}

function safeHostname(url: string): string | null {
  try { return new URL(url).hostname; } catch { return null; }
}

// ---------------------------------------------------------------------------
// Batch fetch
// ---------------------------------------------------------------------------

/**
 * Fetch multiple pages. For each: Defuddle vs markdown → pick best.
 * Accepts partial overrides for fetch options (typically from ResearchSettings).
 */
export async function fetchPages(
  urls: string[],
  signal?: AbortSignal,
  opts?: Partial<FetchOptions>,
): Promise<FetchedPage[]> {
  const fullOpts = { ...DEFAULT_FETCH_OPTIONS, ...opts };

  const results = await mapWithConcurrency(
    urls,
    fullOpts.concurrency,
    (url) => fetchSingle(url, fullOpts, signal),
    { signal },
  );

  return results.map((r, i) =>
    r ?? { url: urls[i], title: "", content: "", status: "error" as const, error: "Worker did not complete" },
  );
}
