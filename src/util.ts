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
 */
export function getAgentDir(): string {
  return join(homedir(), ".pi", "agent");
}

/**
 * Extract source URLs from LLM-generated markdown text.
 * Parses markdown link format: [title](url)
 */
export function extractSourceUrls(text: string): Array<{ url: string; title: string }> {
  const urls: Array<{ url: string; title: string }> = [];
  const linkPattern = /\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
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
