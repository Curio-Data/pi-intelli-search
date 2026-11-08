// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type { SourceIdentity } from "./cache.js";
import type { ExtractResult, FetchedPage } from "./types.js";
import { failureDetail, redirectedToDifferentHost } from "./util.js";

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

function displayHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url;
  }
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
        // A doubled path slash and a single slash name the same evidence for
        // provenance comparison. Restrict this to pathname: scheme, host and
        // query strings (including slash characters in query values) are
        // never rewritten.
        .replace(/\/+/g, "/")
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
  allowedSourceNumbers?: ReadonlySet<number>,
): string {
  if (!text.trim()) {
    throw new Error(
      "Collation returned no visible text; increase collationMaxTokens or choose a model with a smaller reasoning budget",
    );
  }
  const sources = evidenceExtractions(extractions);
  const allowedSourceIds = allowedSourceNumbers ?? new Set(sources.map((_, index) => index + 1));
  const summary = text
    // Model text can never carry a generated failure-report marker.
    .replaceAll(COLLATION_FAILED_MARKER, "")
    .replaceAll(EXTRACTION_FAILED_MARKER, "")
    .replace(/^(?:[ \t]*\r?\n)+/, "")
    .replace(/^#{1,6}[ \t]+Summary(?:[ \t]*\r?\n|$)/i, "")
    .replace(/^(?:[ \t]*\r?\n)+/, "")
    .trimEnd();
  const outsideBlocks = withoutCodeBlocks(summary);
  const prose = withoutInlineCode(outsideBlocks);
  const invalid = (reason: string): never => {
    throw new Error(
      `Collation provenance validation failed: ${reason}. The synthesis was not accepted.`,
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
      !/^S\d+(?:\s*(?:[,;–—-]|\band\b)\s*S\d+)*$/i.test(bracket[1].trim())
    )
      continue;
    const afterBracket = prose.slice((bracket.index ?? 0) + bracket[0].length);
    if (afterBracket.startsWith("(")) {
      const target = afterBracket.slice(1).match(/^([^\s)]+)/)?.[1];
      const firstId = bracket[1].match(/\bS(\d+)\b/i)?.[1];
      const targetIndex = target
        ? sources.findIndex((source) => pageUrl(source.url) === pageUrl(target))
        : -1;
      if (targetIndex < 0 || firstId !== String(targetIndex + 1)) continue;
    }
    const validateId = (raw: string): void => {
      const index = Number(raw);
      if (raw !== String(index) || !allowedSourceIds.has(index)) {
        invalid("unknown or omitted source ID");
      }
    };
    for (const range of bracket[1].matchAll(/\bS(\d+)\s*[-–—]\s*S(\d+)\b/gi)) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      for (let index = Math.min(start, end); index <= Math.max(start, end); index++) {
        validateId(String(index));
      }
    }
    for (const match of bracket[1].matchAll(/\bS(\d+)\b/gi)) validateId(match[1]);
  }
  // Cross-links present in an extraction are evidence CONTENT, not extra
  // fetched pages. They may appear in synthesis but never enter the inventory.
  const suppliedSources = sources.filter((_, index) => allowedSourceIds.has(index + 1));
  const urls = new Set(
    suppliedSources.flatMap((source) => [source.url, ...proseUrls(source.extraction)]).map(pageUrl),
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

  for (const source of sources) {
    if (!identity.extractionFileFor(source.url)) invalid("an evidence source has no extraction file");
  }
  return (
    `## Summary\n\n${summary}\n\n## Source assessment\n\n` +
    "Source inventory is generated from this run's successful, non-empty extractions, not from search citations. Cross-links in synthesis are not additional fetched sources. Types are extraction metadata, not independent quality ratings.\n\n" +
    sourceTable(sources, cachePath, identity, evidence)
  );
}

function sourceTable(
  sources: readonly ExtractResult[],
  cachePath: string,
  identity: SourceIdentity,
  evidence: "fetched" | "supplied",
): string {
  let result = "| ID | Source | Type | Evidence | Extraction | Full page |\n";
  result += "|---|---|---|---|---|---|\n";
  for (const [index, source] of sources.entries()) {
    const extractionFile = identity.extractionFileFor(source.url);
    const fullPage = identity.sourceFileFor(source.url);
    const evidenceLabel = evidence === "fetched"
      ? source.inferred
        ? "Inferred from text (not a citation); fetched and extracted"
        : "Fetched and extracted"
      : "Caller-supplied extraction";
    result += `| S${index + 1} | ${cell(source.url)} | ${cell(source.sourceType)}${source.truncated ? " ⚠ truncated" : ""} | ${evidenceLabel} | ${extractionFile ? cell(`${cachePath}/extractions/${extractionFile}`) : "Not cached"} | ${fullPage ? cell(`${cachePath}/sources/${fullPage}`) : "Not cached"} |\n`;
  }
  return result.trimEnd();
}

/** Render every inferred reference, including fetches that returned nothing.
 *  The result and report both include this section so an agent can distinguish
 *  a prose guess from a citation and follow a saved code/text asset directly. */
export function inferredAssetsSection(
  pages: readonly FetchedPage[],
  cachePath: string,
  identity?: SourceIdentity,
): string {
  const assets = pages.filter((page) => page.inferred);
  if (assets.length === 0) return "";
  let result = "## Inferred Assets\n\n" +
    "These protocol-less references were guessed from search text, not supplied as citations. Fetch results describe the response, not the filename.\n\n" +
    "| Original token | Normalised URL | Fetch result | Saved asset |\n" +
    "|---|---|---|---|\n";
  for (const page of assets) {
    const sourceFile = identity?.sourceFileFor(page.url);
    let outcome: string;
    if (page.status === "error") {
      // Committed results point at their shared failure list. A preserved
      // result has no such list, so carry the bounded reason inline instead.
      outcome = identity
        ? "Nothing fetched; see Failed Sources below"
        : `Nothing fetched${page.error ? `: ${failureDetail(page.error)}` : ""}`;
    } else {
      const kind = page.assetType === "page"
        ? "Page"
        : page.assetType === "code"
          ? "Code file"
          : page.assetType === "text"
            ? "Text file"
            : "Fetched content";
      outcome = `${kind}${page.contentType ? ` (${page.contentType})` : ""}`;
    }
    if (page.alternateUrl) {
      outcome += `; via alternate ${page.alternateUrl}`;
      if (page.finalUrl && page.finalUrl !== page.alternateUrl) {
        outcome += redirectedToDifferentHost(page.url, page.finalUrl)
          ? `; redirected to a different host (${displayHostname(page.finalUrl)}): ${page.finalUrl}`
          : `; redirected to ${page.finalUrl}`;
      } else if (page.finalUrl && redirectedToDifferentHost(page.url, page.finalUrl)) {
        outcome += ` on a different host (${displayHostname(page.finalUrl)})`;
      }
    } else if (page.finalUrl) {
      outcome += redirectedToDifferentHost(page.url, page.finalUrl)
        ? `; redirected to a different host (${displayHostname(page.finalUrl)}): ${page.finalUrl}`
        : `; redirected to ${page.finalUrl}`;
    }
    const saved = sourceFile
      ? cell(`${cachePath}/sources/${sourceFile}`)
      : page.status === "success"
        ? "Not saved in this attempt"
        : "None";
    result += `| ${cell(page.originalReference ?? page.url)} | ${cell(page.url)} | ${cell(outcome)} | ${saved} |\n`;
  }
  return result.trimEnd();
}

/** Generated marker identifying a collation-failure report. finalizeCollation()
 *  strips every failure-report marker from model text, so a synthesis that
 *  merely mentions a collation failure is never mistaken for one. */
const COLLATION_FAILED_MARKER = "<!-- intelli-search:collate-failed -->";

/** Generated marker identifying an extraction-failure report: every
 *  extraction failed, the fetched pages are saved without a synthesis. */
const EXTRACTION_FAILED_MARKER = "<!-- intelli-search:extraction-failed -->";

/** Both generated failure-report markers. A failure-report body opens with
 *  its marker line; writeReportFile() hoists that line above the report
 *  title so saved failure reports are detectable from a position caller
 *  text can never reach (see isCollationFailureReport). */
const FAILURE_MARKERS = new Set([COLLATION_FAILED_MARKER, EXTRACTION_FAILED_MARKER]);

/** True for a saved report written by collationFailureReport() or
 *  extractionFailureReport().
 *
 *  A failure report opens with its marker as the very first line, a line
 *  only writeReportFile() writes, above the "# <query>" title. Caller-
 *  controlled text cannot reach that position: every non-failure report
 *  opens with the title line (always prefixed "# ", which no marker
 *  matches), and a multiline query can only add lines *after* it.
 *
 *  Owner decision (2026-11-07, round 3): a report without a line-1 marker
 *  is never a failure report. No published release ever wrote one (0.22.0
 *  is unpublished), so unmarked development-build failure reports — the
 *  pre-marker heading shape and the mid-body-marker shape, including
 *  multiline queries and search summaries containing "## Summary" — are
 *  preserved like any other existing report instead of replaced. Accepted
 *  trade-off: a repeat over such a report preserves it and does not save
 *  the new attempt's pages; nothing is ever displaced. */
export function isCollationFailureReport(report: string): boolean {
  return FAILURE_MARKERS.has(report.split("\n", 1)[0]?.trim() ?? "");
}

/** Split a failure-report body that opens with its marker line into the
 *  marker and the remainder (leading blanks stripped). Returns null when the
 *  text does not open with a failure marker. writeReportFile() hoists the
 *  marker above the report title so saved failure reports keep detection at
 *  line 1. */
export function splitFailureMarkerHead(
  text: string,
): { marker: string; body: string } | null {
  for (const marker of FAILURE_MARKERS) {
    if (text.startsWith(`${marker}\n`)) {
      return { marker, body: text.slice(marker.length + 1).replace(/^(?:[ \t]*\n)+/, "") };
    }
  }
  return null;
}

/** Remove generated failure-report marker lines from text shown to the
 *  calling agent. Saved reports keep their marker: it is how a later run
 *  recognises a prior failure report (isCollationFailureReport). Only the
 *  marker line and the blank line after it are removed, so text without a
 *  marker is returned unchanged. */
export function stripFailureMarkers(text: string): string {
  const lines: string[] = [];
  let removedMarker = false;
  for (const line of text.split("\n")) {
    if (FAILURE_MARKERS.has(line.trim())) {
      removedMarker = true;
      continue;
    }
    if (removedMarker && line.trim() === "") {
      removedMarker = false; // exactly one blank line stood after the marker
      continue;
    }
    removedMarker = false;
    lines.push(line);
  }
  return lines.join("\n");
}

/** Shared shape of both failure reports: the marker line first (hoisted to
 *  the top of the saved report by writeReportFile, stripped from the
 *  agent-visible result text), then heading and the one-line reason. */
function failureReportHead(heading: string, marker: string, reason: string): string {
  return `${marker}\n\n## ${heading}\n\n> ⚠ ${reason}\n\n`;
}

/**
 * Report body for a research run whose collation failed after extraction
 * succeeded. No synthesis exists, so the body states the failure and lists the
 * saved extractions; their files carry the paid-for content.
 */
export function collationFailureReport(
  reason: string,
  cachePath: string,
  extractions: readonly ExtractResult[],
  identity: SourceIdentity,
): string {
  const sources = evidenceExtractions(extractions);
  return (
    failureReportHead("Collation Failed", COLLATION_FAILED_MARKER, reason) +
    `No synthesis was produced. The ${sources.length} extraction(s) below were saved; read the ` +
    "extraction files directly, or re-run the research.\n\n" +
    "## Source assessment\n\n" +
    sourceTable(sources, cachePath, identity, "fetched")
  );
}

/**
 * Report body for a research run in which every extraction failed (pages that
 * failed to fetch never reach extraction, so a run reaching this report
 * fetched at least one page). No synthesis exists and no extraction file is
 * written; every fetched page is saved under sources/, and the report's
 * failed-source list names each saved page and why its extraction failed, so
 * the calling agent can revisit a page, or retry its extraction later, without
 * refetching it.
 */
export function extractionFailureReport(
  reason: string,
  cachePath: string,
  savedPages: number,
  searchSummary: string,
): string {
  return (
    failureReportHead("Extraction Failed", EXTRACTION_FAILED_MARKER, reason) +
    `No content was extracted, so no synthesis was produced. ${savedPages} fetched page(s) are saved under ` +
    `${cachePath}/sources/; the **Failed Sources** list below (in this result and in the saved ` +
    "report) names each failed source, the saved page's path when one exists, and why it failed. " +
    "Read a saved page directly, or pass its content to `intelli_extract` to retry its extraction without refetching it.\n\n" +
    `## Search summary\n\n${searchSummary.trim()}`
  );
}
