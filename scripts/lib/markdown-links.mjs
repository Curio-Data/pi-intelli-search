// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// scripts/lib/markdown-links.mjs — shared markdown scanning helpers for the
// generation scripts (package READMEs, native changelog). Keeps one
// implementation of fence tracking, inline-code splitting and link mapping so
// the two generators cannot drift apart.

/** Opening code fence: three or more backticks or tildes, up to three leading spaces. */
export const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** Whether a line closes the given open fence marker. */
export const closesFence = (line, fence) =>
  /^ {0,3}[`~]{3,}\s*$/.test(line) && line.trim()[0] === fence[0] && line.trim().length >= fence.length;

/** Whether a link target is absolute (scheme or protocol-relative), not repository-relative. */
export const isExternal = (url) => /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//");

/**
 * Split a line into segments, marking inline code spans. A span opens with a
 * backtick run and closes with a run of the same length (CommonMark); a run of
 * a different length inside the span is literal text.
 *
 * With `completeOnly`, an unpaired opening run is left as plain text instead
 * of protecting the rest of the line: rewriters use the default (protect,
 * because a wrong rewrite is worse than a missed one), while validators use
 * `completeOnly` so a malformed line cannot hide a relative link from review.
 */
export function splitInlineCode(line, { completeOnly = false } = {}) {
  const parts = [];
  let plainStart = 0;
  let i = 0;
  outer: while (i < line.length) {
    if (line[i] !== "`") {
      i++;
      continue;
    }
    let openLen = 1;
    while (line[i + openLen] === "`") openLen++;
    let j = i + openLen;
    let closeIdx = -1;
    while (j < line.length) {
      if (line[j] === "`") {
        let runLen = 1;
        while (line[j + runLen] === "`") runLen++;
        if (runLen === openLen) {
          closeIdx = j;
          break;
        }
        j += runLen;
      } else {
        j++;
      }
    }
    if (closeIdx === -1) {
      // Unpaired opening run.
      if (completeOnly) {
        i += openLen; // treat the run as literal text and keep scanning
        continue outer;
      }
      if (i > plainStart) parts.push({ code: false, text: line.slice(plainStart, i) });
      parts.push({ code: true, text: line.slice(i) });
      return parts;
    }
    const end = closeIdx + openLen;
    if (i > plainStart) parts.push({ code: false, text: line.slice(plainStart, i) });
    parts.push({ code: true, text: line.slice(i, end) });
    plainStart = i = end;
  }
  if (plainStart < line.length) parts.push({ code: false, text: line.slice(plainStart) });
  return parts;
}

/** Markdown link target and optional single- or double-quoted title. */
export const MD_LINK = /\]\(([^)\s]+)((?:\s+(?:"[^"]*"|'[^']*'))?)\)/g;
/** HTML href/src/srcset attribute, single- or double-quoted. */
export const HTML_ATTR = /\b(href|src|srcset)=("([^"]*)"|'([^']*)')/g;

/**
 * Apply fn(target) to every link target outside code fences and well-formed
 * inline code spans: Markdown links and images, plus HTML attributes. An
 * unpaired backtick protects the remainder of the line (a missed rewrite is
 * preferable to a wrong one); validators re-scan with completeOnly to catch
 * what this skipped. Returns the rewritten markdown; never mutates the input.
 */
export function mapLinks(markdown, fn) {
  let fence = null;
  return markdown
    .split("\n")
    .map((line) => {
      if (fence) {
        if (closesFence(line, fence)) fence = null;
        return line;
      }
      const open = line.match(FENCE);
      if (open) {
        fence = open[1];
        return line;
      }
      return splitInlineCode(line)
        .map((seg) =>
          seg.code
            ? seg.text
            : seg.text
                .replace(MD_LINK, (_, url, title) => `](${fn(url)}${title})`)
                .replace(HTML_ATTR, (_, attr, _dq, dqVal, sqVal) => `${attr}="${fn(sqVal ?? dqVal)}"`),
        )
        .join("");
    })
    .join("\n");
}

/**
 * Every link target in the text, outside fences and well-formed code spans,
 * including targets an earlier rewrite may have skipped. Returns them in
 * order; validators treat any non-absolute entry as a problem.
 */
export function allLinkTargets(markdown) {
  const targets = [];
  let fence = null;
  for (const line of markdown.split("\n")) {
    if (fence) {
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    const open = line.match(FENCE);
    if (open) {
      fence = open[1];
      continue;
    }
    for (const seg of splitInlineCode(line, { completeOnly: true })) {
      if (seg.code) continue;
      for (const m of seg.text.matchAll(MD_LINK)) targets.push(m[1]);
      for (const m of seg.text.matchAll(HTML_ATTR)) targets.push(m[3] ?? m[4]);
    }
  }
  return targets;
}
