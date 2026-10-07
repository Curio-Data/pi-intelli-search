// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type { SourceIdentity } from "./cache.js";
import type { ExtractResult } from "./types.js";

/** Only successful, non-empty extractions can support a completed synthesis. */
export function evidenceExtractions(extractions: readonly ExtractResult[]): ExtractResult[] {
  const evidence = extractions.filter(
    (entry) => entry.status === "success" && entry.extraction.trim(),
  );
  if (new Set(evidence.map((entry) => entry.url)).size !== evidence.length) {
    throw new Error(
      "Collation evidence contains duplicate source URLs; supply one extraction per URL",
    );
  }
  return evidence;
}

function cell(value: string): string {
  return value.replaceAll("|", "\\|").replace(/[\r\n]+/g, " ");
}

function withoutCodeBlocks(text: string): string {
  let fence: { char: string; length: number } | undefined;
  return text
    .split("\n")
    .map((line) => {
      const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (fence) {
        if (
          match &&
          match[1][0] === fence.char &&
          match[1].length >= fence.length &&
          !match[2].trim()
        )
          fence = undefined;
        return "";
      }
      if (match) {
        fence = { char: match[1][0], length: match[1].length };
        return "";
      }
      return /^(?: {4}|\t)/.test(line) ? "" : line;
    })
    .join("\n");
}

function withoutInlineCode(text: string): string {
  return text.replace(/(`+)(?!`)[\s\S]*?\1(?!`)/g, "");
}

/** Preserve URL parentheses inside a path; trim only excess closing punctuation. */
function proseUrls(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s<>"`\]]+/g)].map((match) => {
    let url = match[0].replace(/[.,;:!?]+$/, "");
    while (url.endsWith(")") && (url.match(/\)/g)?.length ?? 0) > (url.match(/\(/g)?.length ?? 0))
      url = url.slice(0, -1);
    return url;
  });
}

function pageUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    // A reference may omit a trailing slash or percent-encode unreserved
    // characters. Never merge different hosts, schemes or query parameters.
    url.pathname =
      url.pathname
        .replace(/%[\da-f]{2}/gi, (encoded) => {
          const char = String.fromCharCode(parseInt(encoded.slice(1), 16));
          return /[\w.~\-]/.test(char) ? char : encoded.toUpperCase();
        })
        .replace(/\/$/, "") || "/";
    return url.href;
  } catch {
    return value;
  }
}

/**
 * The model writes synthesis only. Source inventory and file references are
 * rendered from the same identity used by cache writes, never from model text.
 * Validate prose references before callers rotate or write cache artefacts.
 * This validates references, not factual truth or claim-level grounding.
 */
export function finalizeCollation(
  text: string,
  cachePath: string,
  extractions: readonly ExtractResult[],
  identity: SourceIdentity,
  evidence: "fetched" | "supplied",
): string {
  if (!text.trim()) {
    throw new Error(
      "Collation returned no visible text; increase collationMaxTokens or choose a model with a smaller reasoning budget",
    );
  }
  const sources = evidenceExtractions(extractions);
  const summary = text
    .replace(/^(?:[ \t]*\r?\n)+/, "")
    .replace(/^#{1,6}[ \t]+Summary(?:[ \t]*\r?\n|$)/i, "")
    .replace(/^(?:[ \t]*\r?\n)+/, "")
    .trimEnd();
  const outsideBlocks = withoutCodeBlocks(summary);
  const prose = withoutInlineCode(outsideBlocks);
  const invalid = (reason: string): never => {
    throw new Error(
      `Collation provenance validation failed: ${reason}. No report was committed; rerun the operation.`,
    );
  };
  if (!sources.length) invalid("no successful extraction evidence");
  if (!summary) invalid("empty synthesis");
  if (
    /^#{1,6}\s+(?:source assessment|source index|sources?(?: used)?|references|citations)\s*$/im.test(
      prose,
    )
  ) {
    invalid("the model returned a source inventory instead of synthesis only");
  }
  for (const bracket of prose.matchAll(/\[([^\]\n]+)\]/g)) {
    // Only the reserved citation grammar is an ID group. Product names and
    // Markdown link labels such as [Amazon S3](...) are ordinary content.
    if (
      !/^S\d+(?:\s*(?:[,;–-]|\band\b)\s*S\d+)*$/i.test(bracket[1].trim()) ||
      prose.slice((bracket.index ?? 0) + bracket[0].length).startsWith("(")
    )
      continue;
    for (const match of bracket[1].matchAll(/\bS(\d+)\b/gi)) {
      const index = Number(match[1]);
      if (index < 1 || index > sources.length || match[1] !== String(index))
        invalid("unknown source ID");
    }
  }
  // Cross-links present in an extraction are evidence CONTENT, not extra
  // fetched pages. They may appear in synthesis but never enter the inventory.
  const urls = new Set(
    sources.flatMap((source) => [source.url, ...proseUrls(source.extraction)]).map(pageUrl),
  );
  for (const url of proseUrls(prose)) {
    if (!urls.has(pageUrl(url))) invalid("a prose URL is absent from the supplied evidence");
  }
  // Inline code often carries cache references, so keep it in this check.
  // Ordinary project filenames such as report.md are not cache declarations.
  if (
    /(?:sources|extractions)[/\\]\d+-[^\s`<>"\]\)]+\.md\b/i.test(outsideBlocks) ||
    outsideBlocks.includes(`${cachePath}/report.md`)
  ) {
    invalid("the model generated a cache-file reference");
  }

  let result = `## Summary\n\n${summary}\n\n## Source assessment\n\n`;
  result +=
    "Source inventory is generated from this run's successful, non-empty extractions, not from search citations. Cross-links in synthesis are not additional fetched sources. Types are extraction metadata, not independent quality ratings.\n\n";
  result += "| ID | Source | Type | Evidence | Extraction | Full page |\n";
  result += "|---|---|---|---|---|---|\n";
  for (const [index, source] of sources.entries()) {
    const extractionFile = identity.extractionFileFor(source.url);
    if (!extractionFile) invalid("an evidence source has no extraction file");
    const fullPage = identity.sourceFileFor(source.url);
    result += `| S${index + 1} | ${cell(source.url)} | ${cell(source.sourceType)} | ${evidence === "fetched" ? "Fetched and extracted" : "Caller-supplied extraction"} | ${cell(`${cachePath}/extractions/${extractionFile}`)} | ${fullPage ? cell(`${cachePath}/sources/${fullPage}`) : "Not cached"} |\n`;
  }
  return result.trimEnd();
}
