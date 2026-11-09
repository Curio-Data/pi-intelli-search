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

/** The generated inventory boundary also identifies legacy reports during rotation. */
export const SOURCE_ASSESSMENT_PREAMBLE =
  "## Source assessment\n\n" +
  "Source inventory is generated from this run's successful, non-empty extractions, not from search citations. Cross-links in synthesis are not additional fetched sources. Types are extraction metadata, not independent quality ratings.\n\n";

/** Close only a still-open model fence before appending generated report sections. */
function closeOpenFence(text: string): string {
  const { fence } = codeBlockView(text);
  return fence ? `${text}\n${fence.prefix}${fence.char.repeat(fence.length)}` : text;
}

function withoutCodeBlocks(text: string): string {
  return codeBlockView(text).prose;
}

/** Share fence/container state between validation and final report rendering. */
function codeBlockView(text: string): {
  prose: string;
  fence?: { char: string; length: number; indent: number; prefix: string };
} {
  let fence: { char: string; length: number; indent: number; prefix: string } | undefined;
  let listIndent = 0;
  let afterBlank = false;
  const prose = text
    .split("\n")
    .map((line) => {
      // A list's fenced block ends with its container, unlike a top-level
      // fence. Dedented prose must return to provenance validation.
      if (fence?.indent && line.trim() && !line.startsWith(" ".repeat(fence.indent))) {
        fence = undefined;
        listIndent = 0;
      }
      if (!fence && listIndent && !line.startsWith(" ".repeat(listIndent)) && /^ {0,3}(?:`{3,}|~{3,})/.test(line)) listIndent = 0;
      const thematic = /^ {0,3}(?:([-*_])(?:[ \t]*\1){2,})[ \t\r]*$/.test(line);
      const item = !fence && !thematic && line.match(/^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/);
      if (item) listIndent = item[0].length;
      else if (!fence && ((afterBlank && line.trim() && !line.startsWith(" ".repeat(listIndent))) || /^ {0,3}(?:#{1,6}(?:\s|$)|>)/.test(line))) listIndent = 0;
      const content = item ? line.slice(item[0].length)
        : listIndent && line.startsWith(" ".repeat(listIndent)) ? line.slice(listIndent) : line;
      afterBlank = !line.trim();
      const match = content.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
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
        fence = {
          char: match[1][0], length: match[1].length, indent: listIndent,
          prefix: " ".repeat(listIndent) + (content.match(/^ */)?.[0] ?? ""),
        };
        return "";
      }
      return /^(?: {4}|\t)/.test(content) ? "" : line;
    })
    .join("\n");
  return { prose, fence };
}

function withoutInlineCode(text: string): string {
  return text.replace(/(`+)(?!`)[\s\S]*?\1(?!`)/g, "");
}

function isWhitespace(char: string | undefined): boolean {
  return char === undefined || /\s/.test(char);
}

function isPunctuation(char: string | undefined): boolean {
  return char !== undefined && /[\p{P}\p{S}]/u.test(char);
}

/** Keep the current inline paragraph, including list/quote continuations.
 * Container markers are structural, not emphasis delimiters. A new item or
 * quote depth starts a new paragraph; lazy continuation lines retain it. */
function emphasisPrefix(text: string, urlIndex: number): string {
  const prefix = text.slice(0, urlIndex);
  const lines = prefix.split("\n");
  let paragraph = "";
  let listIndent = 0;
  let quoteDepth = 0;
  let fence: { char: string; length: number } | undefined;
  for (const [index, rawLine] of lines.entries()) {
    const completeLine = index < lines.length - 1;
    let line = rawLine;
    let depth = 0;
    let quote: RegExpMatchArray | null;
    while ((quote = line.match(/^ {0,3}>[ \t]?/))) {
      depth++;
      line = line.slice(quote[0].length);
    }
    if (depth && depth !== quoteDepth) {
      paragraph = "";
      listIndent = 0;
    }
    if (depth) quoteDepth = depth;
    if (completeLine && !line.trim()) {
      paragraph = "";
      listIndent = 0;
      quoteDepth = depth;
      continue;
    }
    const item = line.match(/^( *)(?:[-+*]|\d{1,9}[.)])[ \t]+/);
    const thematic = /^ {0,3}(?:([-*_])(?:[ \t]*\1){2,})[ \t\r]*$/.test(line);
    if (item && !thematic && (item[1].length <= 3 || listIndent > 0)) {
      paragraph = "";
      listIndent = item[0].length;
      line = line.slice(listIndent);
    } else if (listIndent && line.startsWith(" ".repeat(listIndent))) {
      line = line.slice(listIndent);
    }
    const fenceMarker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (fenceMarker && fenceMarker[1][0] === fence.char && fenceMarker[1].length >= fence.length && !fenceMarker[2].trim()) fence = undefined;
      paragraph = "";
      continue;
    }
    if (completeLine && fenceMarker) {
      fence = { char: fenceMarker[1][0], length: fenceMarker[1].length };
      paragraph = "";
      continue;
    }
    const blockStart = thematic || /^(?: {4}|\t| {0,3}(?:#{1,6}(?:\s|$)|`{3,}|~{3,}|=+[ \t\r]*$))/.test(line);
    if (blockStart) {
      paragraph = completeLine ? "" : line;
      if (completeLine) listIndent = 0;
      continue;
    }
    paragraph += line + (completeLine ? "\n" : "");
  }
  return paragraph;
}

/**
 * Return closers for emphasis delimiters still open at a URL. Pairing omits CommonMark's
 * rule of three: surplus trailing markers stay URL content, keeping literal `*`/`_` resources
 * distinct.
 */
function markdownEmphasisCloser(text: string, urlIndex: number, url: string): string {
  const trailing = url.match(/[*_]+$/)?.[0];
  if (!trailing) return "";
  const rawBefore = emphasisPrefix(text, urlIndex);
  // Mask URLs and inline code while preserving offsets: their delimiters are content.
  const before = rawBefore
    .replace(/https?:\/\/[^\s<>"`\]]+/g, (match) => " ".repeat(match.length))
    .replace(/(`+)(?!`)[\s\S]*?\1(?!`)/g, (match) => " ".repeat(match.length));
  const open: string[] = [];
  for (const match of before.matchAll(/\*+|_+/g)) {
    const run = match[0];
    const index = match.index ?? 0;
    let escaped = 0;
    for (let cursor = index - 1; cursor >= 0 && before[cursor] === "\\"; cursor--) escaped++;
    if (escaped % 2 === 1) continue;
    const previous = rawBefore[index - 1];
    const next =
      index + run.length < rawBefore.length ? rawBefore[index + run.length] : text[urlIndex];
    const leftFlanking =
      !isWhitespace(next) &&
      (!isPunctuation(next) || isWhitespace(previous) || isPunctuation(previous));
    const rightFlanking =
      !isWhitespace(previous) &&
      (!isPunctuation(previous) || isWhitespace(next) || isPunctuation(next));
    const canOpen =
      leftFlanking && (run[0] === "*" || !rightFlanking || isPunctuation(previous));
    const canClose =
      rightFlanking && (run[0] === "*" || !leftFlanking || isPunctuation(next));
    if (canClose) {
      let opener = -1;
      for (let index = open.length - 1; index >= 0; index--) {
        if (open[index][0] === run[0]) {
          opener = index;
          break;
        }
      }
      if (opener >= 0) open.splice(opener);
    }
    if (canOpen) open.push(run);
  }
  const openers = open.reverse().join("");
  for (let index = 0; index < openers.length; index++) {
    const candidate = openers.slice(index);
    if (trailing.endsWith(candidate)) return candidate;
  }
  return "";
}

/** Preserve URL parentheses and literal trailing emphasis characters; trim Markdown closers. */
function proseUrls(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s<>"`\]]+/g)].map((match) => {
    let url = match[0];
    let closerPending = true;
    let previous: string;
    do {
      previous = url;
      url = url.replace(/[.,;:!?]+$/, "");
      const before = text.slice(0, match.index ?? 0);
      const trailingMarkers = url.match(/[*_]+$/)?.[0];
      if (trailingMarkers && /\[[^\]\n]*\]\($/.test(before)) {
        // Markers after a Markdown link's closing parenthesis are outside its URL.
        let linkTarget = url.slice(0, -trailingMarkers.length);
        const withMarkers = linkTarget;
        while (
          linkTarget.endsWith(")") &&
          (linkTarget.match(/\)/g)?.length ?? 0) > (linkTarget.match(/\(/g)?.length ?? 0)
        )
          linkTarget = linkTarget.slice(0, -1);
        if (linkTarget !== withMarkers) {
          url = linkTarget;
          closerPending = false;
        }
      }
      const closer = closerPending
        ? markdownEmphasisCloser(text, match.index ?? 0, url)
        : "";
      if (closer) {
        url = url.slice(0, -closer.length);
        closerPending = false;
      }
      while (
        url.endsWith(")") &&
        (url.match(/\)/g)?.length ?? 0) > (url.match(/\(/g)?.length ?? 0)
      )
        url = url.slice(0, -1);
    } while (url !== previous);
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
  /**
   * The extractions as the collation model received them, when the input
   * budget trimmed any. Prose URLs are checked against this text, so a URL
   * that only the trimmed-away part held cannot pass as supplied evidence.
   * The full `extractions` still drive the inventory and file references.
   */
  delivered?: readonly ExtractResult[],
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
  const deliveredText = new Map(delivered?.map((source) => [source.url, source.extraction]));
  const urls = new Set(
    suppliedSources
      .flatMap((source) => [
        source.url,
        ...proseUrls(deliveredText.get(source.url) ?? source.extraction),
      ])
      .map(pageUrl),
  );
  for (const url of proseUrls(prose)) {
    if (!urls.has(pageUrl(url))) {
      invalid(`a prose URL is absent from the supplied evidence (${url})`);
    }
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
    `## Summary\n\n${closeOpenFence(summary)}\n\n` +
    SOURCE_ASSESSMENT_PREAMBLE +
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
 * succeeded. No accepted synthesis exists, so the body states the failure and lists the
 * saved extractions; their files carry the paid-for content.
 */
export function collationFailureReport(
  reason: string,
  cachePath: string,
  extractions: readonly ExtractResult[],
  identity: SourceIdentity,
  inputTrimmed = false,
  synthesisRejected = false,
): string {
  const sources = evidenceExtractions(extractions);
  return (
    failureReportHead("Collation Failed", COLLATION_FAILED_MARKER, reason) +
    (inputTrimmed
      ? `No synthesis was ${synthesisRejected ? "accepted" : "produced"}. The ${sources.length} extraction(s) below were saved. Read the saved extraction files to recover omitted text. A repeat may recover synthesis after a transient failure, but does not recover text omitted by the input limits. The trim notice names those limits.\n\n`
      : `No synthesis was ${synthesisRejected ? "accepted" : "produced"}. The ${sources.length} extraction(s) below were saved; read the extraction files directly, or re-run the research.\n\n`) +
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
