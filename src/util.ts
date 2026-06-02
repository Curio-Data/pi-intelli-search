// src/util.ts — Shared utilities
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Create a properly-typed text content object for tool results.
 */
export function textContent(text: string): { type: "text"; text: string } {
  return { type: "text" as const, text };
}

/**
 * Get the pi agent directory path.
 * Respects PI_CODING_AGENT_DIR for isolated environments (e.g. E2E tests).
 */
export function getAgentDir(): string {
  if (process.env.PI_CODING_AGENT_DIR) {
    return process.env.PI_CODING_AGENT_DIR;
  }
  return join(homedir(), ".pi", "agent");
}

/**
 * Map over `items` running at most `concurrency` tasks concurrently.
 *
 * A bounded worker pool: each worker pulls the next index, runs `fn`, stores
 * the result by index (input order preserved), then fires `onSettled`. This
 * caps how many expensive operations (network fetches, LLM calls) run at once,
 * so a wide result set cannot launch dozens of simultaneous requests and trip
 * provider rate limits.
 *
 * Workers stop pulling new work once `signal` aborts: in-flight tasks finish
 * but no new ones start, and indices that never ran are left `undefined`.
 * `fn` is expected to handle its own errors and resolve to a result; a throw
 * propagates and rejects the returned promise (matching Promise.all).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  opts?: {
    signal?: AbortSignal;
    onSettled?: (item: T, index: number, result: R) => void;
  },
): Promise<Array<R | undefined>> {
  const results: Array<R | undefined> = new Array(items.length).fill(undefined);
  let nextIndex = 0;
  const limit = Math.max(1, Math.min(concurrency, items.length));

  const worker = async () => {
    while (nextIndex < items.length) {
      if (opts?.signal?.aborted) return;
      const index = nextIndex++;
      const result = await fn(items[index], index);
      results[index] = result;
      opts?.onSettled?.(items[index], index, result);
    }
  };

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

/**
 * Extract source URLs from LLM-generated markdown text.
 * Parses markdown link format: [title](url)
 */
export function extractSourceUrls(text: string): Array<{ url: string; title: string }> {
  const urls: Array<{ url: string; title: string }> = [];
  // Match markdown links [title](url). The URL body allows balanced
  // single-level parentheses so links to pages like Wikipedia disambiguation
  // (`Foo_(disambiguation)`) or MSDN (`...format(v=net-8.0)`) keep their
  // closing paren instead of being truncated at the first `)`. URLs never
  // contain whitespace, so a space ends the match.
  const linkPattern = /\[([^\]]*)\]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))*)\)/g;
  let match;
  while ((match = linkPattern.exec(text)) !== null) {
    const url = match[2];
    if (!urls.some((u) => u.url === url)) {
      urls.push({ url, title: match[1] });
    }
  }
  return urls;
}

/**
 * Infer source type from the first line of an LLM extraction.
 */
export function inferSourceType(line: string): string {
  const lower = line.toLowerCase();
  if (lower.includes("official doc")) return "official docs";
  if (lower.includes("api reference")) return "API reference";
  if (lower.includes("tutorial")) return "tutorial";
  if (lower.includes("blog")) return "blog post";
  if (lower.includes("forum") || lower.includes("stackoverflow")) return "forum";
  return "unknown";
}

/**
 * Infer how current a source appears from the first line of extraction.
 */
export function inferCurrentness(line: string): string {
  const lower = line.toLowerCase();
  if (lower.includes("current") || lower.includes("up to date")) return "current";
  if (lower.includes("outdated") || lower.includes("old")) return "possibly outdated";
  return "undated";
}
