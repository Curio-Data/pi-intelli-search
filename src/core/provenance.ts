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
    result += `| S${index + 1} | ${cell(source.url)} | ${cell(source.sourceType)}${source.truncated ? " ⚠ truncated" : ""} | ${evidence === "fetched" ? "Fetched and extracted" : "Caller-supplied extraction"} | ${extractionFile ? cell(`${cachePath}/extractions/${extractionFile}`) : "Not cached"} | ${fullPage ? cell(`${cachePath}/sources/${fullPage}`) : "Not cached"} |\n`;
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

/** Heading lines that opened failure-report bodies in 0.22.0 development
 *  builds (marker absent, or mid-body after the heading); never released.
 *  Kept so cache artefacts written by those builds are still recognised. */
const LEGACY_FAILURE_HEADINGS = new Set(["## Collation Failed", "## Extraction Failed"]);

/** Heading every successful report carries (generated by finalizeCollation
 *  since 0.16.0), including reports whose synthesis merely mentions a
 *  failure heading. */
const SUMMARY_HEADING = "## Summary";

/** True for a saved report written by collationFailureReport() or
 *  extractionFailureReport().
 *
 *  Detection reads only positions caller-controlled text cannot reach:
 *  - current reports open with their marker as the very first line, a line
 *    only writeReportFile() writes, above the "# <query>" title; a multiline
 *    query can only add lines *after* that title line, so a marker in the
 *    query can never occupy line 1 of a successful report;
 *  - legacy development-build reports are recognised only when their first
 *    line after the title and ">" header block is a failure heading AND the
 *    report contains no "## Summary" heading, which every successful report
 *    this code has written since 0.16.0 carries.
 *
 *  Remaining false positive: a report NOT written by this pipeline's
 *  collation path (hand-edited, pre-0.16.0, or a low-level caller supplying
 *  raw collation) whose first body line is a failure heading and which
 *  carries no "## Summary" line is classified as a failure report. */
export function isCollationFailureReport(report: string): boolean {
  const lines = report.split("\n").map((line) => line.trim());
  if (FAILURE_MARKERS.has(lines[0] ?? "")) return true;
  if (lines.includes(SUMMARY_HEADING)) return false;
  let i = 1; // skip the title line
  while (i < lines.length && (lines[i] === "" || lines[i].startsWith(">"))) i++;
  return i < lines.length && LEGACY_FAILURE_HEADINGS.has(lines[i]);
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
    "report) names each saved page and why its extraction failed. Read a saved page directly, or " +
    "re-run the research; a later extraction retry needs no refetch.\n\n" +
    `## Search summary\n\n${searchSummary.trim()}`
  );
}
