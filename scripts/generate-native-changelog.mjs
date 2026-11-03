#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// scripts/generate-native-changelog.mjs
//
// Derives PI_CHANGELOG.md from the repository CHANGELOG.md so `Pi` 1.5.0's
// Extension Updates feature can show our native package's changelog after an
// update. The host reads `pi.changelogPath` from package.json (default:
// CHANGELOG.md at the package root) and parses headings matching
// `## [X.Y.Z]` or `## X.Y.Z - date`; our canonical headings carry package
// prefixes (`## [pi-0.20.0]`) that the parser cannot read, and the shipped
// CHANGELOG.md therefore parses only its historical unprefixed entries.
//
// The derivation:
//   - includes native sections only: `## [pi-X.Y.Z] ...` headings are
//     rewritten to `## [X.Y.Z] ...`; historical unprefixed sections keep
//     their headings;
//   - excludes `## [Unreleased]`, every `## [mcp-*]` section, any section
//     whose version carries a prerelease suffix (the host parser collapses
//     `0.22.0-alpha.0` onto `0.22.0`, which would duplicate entries), and
//     sections marked "Not Published";
//   - fails closed on any other `## ` heading: a mistyped version heading
//     must stop generation, not silently drop a release;
//   - drops the trailing reference-definition block and rewrites version
//     shortcut references (`[pi-0.15.0]`) to release-tag links;
//   - rewrites relative links to repository URLs pinned to the section's
//     release tag when the file and anchor exist there (or the tag is not
//     cut yet), falling back to `main` for post-tag evidence such as
//     publication records, which by design land after the tag;
//   - never rewrites link-shaped text inside inline code spans or fences.
//
// Modes:
//   (default)  Write PI_CHANGELOG.md from CHANGELOG.md.
//   --check    Validate and fail on committed drift.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { anchorsOf } from "./generate-package-readmes.mjs";
import { FENCE, closesFence, mapLinks, allLinkTargets, splitInlineCode, isExternal } from "./lib/markdown-links.mjs";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE = "CHANGELOG.md";
const OUT = "PI_CHANGELOG.md";
const REPO_URL = "https://github.com/Curio-Data/pi-intelli-search";
const GENERATED_HEADER =
  "<!-- Generated from the repository CHANGELOG.md by scripts/generate-native-changelog.mjs. " +
  "Edit CHANGELOG.md, then run npm run generate:changelog. -->";
const INTRO =
  "Native `Pi` extension release notes, generated from the repository `CHANGELOG.md`. " +
  "Standalone Model Context Protocol (MCP) server release notes remain in that canonical changelog.";

const PREFIXED = /^\[pi-(\d+)\.(\d+)\.(\d+)((?:-[0-9A-Za-z.-]+)?)\]((?:\s+.*)?)$/;
const BARE = /^\[(\d+)\.(\d+)\.(\d+)((?:-[0-9A-Za-z.-]+)?)\]((?:\s+.*)?)$/;
const BARE_NO_BRACKETS = /^(\d+)\.(\d+)\.(\d+)((?:-[0-9A-Za-z.-]+)?)(\s+.*)?$/;
const MCP_HEADING = /^\[mcp-/;
const UNRELEASED_HEADING = /^\[Unreleased\]$/;
const NOT_PUBLISHED = /not published/i;
const REFERENCE_DEF = /^\[[^\]]+\]:\s*\S/;
const VERSION_SHORTCUT = /\[(pi-|mcp-)?(\d+\.\d+\.\d+)\](?![:(\d])/g;

export function isGenerated(markdown) {
  return markdown.startsWith("<!-- Generated from the repository CHANGELOG.md");
}

/**
 * Classify one `## ` heading title into a section descriptor, or null when the
 * section is explicitly excluded. Any other heading throws: a bracketed or
 * version-shaped heading that matches no rule is a typo away from silently
 * dropping a release, so classification is fail-closed.
 */
export function classifyHeading(title) {
  if (UNRELEASED_HEADING.test(title) || MCP_HEADING.test(title)) return null;
  for (const [re, prefixed] of [
    [PREFIXED, true],
    [BARE, false],
  ]) {
    const m = title.match(re);
    if (m) {
      if (m[4]) return null; // prerelease suffix: the host parser collapses it onto the release version
      if (NOT_PUBLISHED.test(m[5] ?? "")) return null;
      const version = `${m[1]}.${m[2]}.${m[3]}`;
      const suffix = m[5] ? ` - ${m[5].trim().replace(/^-\s*/, "").trim()}` : "";
      return { version, tag: prefixed ? `pi-v${version}` : `v${version}`, heading: `## [${version}]${suffix}` };
    }
  }
  const nb = title.match(BARE_NO_BRACKETS);
  if (nb) {
    if (nb[4]) return null;
    if (NOT_PUBLISHED.test(title)) return null;
    const version = `${nb[1]}.${nb[2]}.${nb[3]}`;
    return { version, tag: `v${version}`, heading: `## [${version}]${title.slice(version.length)}` };
  }
  throw new Error(`unrecognised "## ${title}" in ${SOURCE}: fix the heading or classify it explicitly`);
}

/** File content at a git ref, or null when the ref or path does not exist. */
const refCache = new Map();
function contentAtRef(root, ref, file) {
  const key = `${ref}:${file}`;
  if (refCache.has(key)) return refCache.get(key);
  let content = null;
  try {
    content = execFileSync("git", ["-C", root, "show", `${ref}:${file}`], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    content = null;
  }
  refCache.set(key, content);
  return content;
}

const tagExistsCache = new Map();
function tagExists(root, tag) {
  if (!tagExistsCache.has(tag)) {
    try {
      execFileSync("git", ["-C", root, "rev-parse", "--verify", "--quiet", `${tag}^{commit}`], { stdio: ["ignore", "pipe", "pipe"] });
      tagExistsCache.set(tag, true);
    } catch {
      tagExistsCache.set(tag, false);
    }
  }
  return tagExistsCache.get(tag);
}

function anchorAtRef(root, ref, file, anchor) {
  const content = ref === "HEAD" ? (existsSync(join(root, file)) ? readFileSync(join(root, file), "utf8") : null) : contentAtRef(root, ref, file);
  return content !== null && anchorsOf(content).has(anchor);
}

/**
 * Pin a relative link for a section whose release tag is `tag`. The tag wins
 * when the target exists there (or the tag is not cut yet and the target
 * exists at HEAD); post-tag evidence that exists only at HEAD pins to main.
 * Unknown targets throw: generation fails rather than emitting a dead link.
 */
function pinLink(root, tag, url) {
  if (isExternal(url)) return url;
  if (url.startsWith("#")) {
    const anchor = url.slice(1);
    if (!anchorAtRef(root, "HEAD", SOURCE, anchor)) throw new Error(`anchor missing at HEAD: ${url}`);
    const useTag = !tagExists(root, tag) || anchorAtRef(root, tag, SOURCE, anchor);
    return `${REPO_URL}/blob/${useTag ? tag : "main"}/${SOURCE}${url}`;
  }
  const path = url.replace(/^\.\//, "");
  if (path.startsWith("../")) throw new Error(`relative link leaves the repository: ${url}`);
  const [file, anchor] = path.split("#");
  const targetOk = (ref) =>
    (ref === "HEAD" ? existsSync(join(root, file)) : contentAtRef(root, ref, file) !== null) &&
    (!anchor || anchorAtRef(root, ref, file, anchor));
  if (!targetOk("HEAD")) throw new Error(`link target missing at HEAD: ${url}`);
  const useTag = !tagExists(root, tag) || targetOk(tag);
  return `${REPO_URL}/blob/${useTag ? tag : "main"}/${path}`;
}

/** Rewrite version shortcut references ([pi-0.15.0], [0.14.0]) to release-tag links. */
function rewriteShortcutReferences(markdown) {
  return markdown
    .split("\n")
    .map((line) =>
      line.startsWith("## ") || REFERENCE_DEF.test(line.trim())
        ? line
        : splitInlineCode(line)
            .map((seg) =>
              seg.code
                ? seg.text
                : seg.text.replace(VERSION_SHORTCUT, (whole, prefix, version) => {
                    const tag = prefix === "mcp-" ? `mcp-v${version}` : prefix ? `pi-v${version}` : `v${version}`;
                    return `[${(prefix ?? "") + version}](${REPO_URL}/releases/tag/${tag})`;
                  }),
            )
            .join(""),
    )
    .join("\n");
}

/** Derive the PI_CHANGELOG.md content from the canonical CHANGELOG.md text. */
export function derive(markdown, root = REPO_ROOT) {
  if (isGenerated(markdown)) throw new Error(`${SOURCE} is a generated copy`);
  refCache.clear();
  tagExistsCache.clear();
  const sections = [];
  let current = null;
  const flush = () => {
    if (!current) return;
    while (current.lines.length && current.lines[current.lines.length - 1].trim() === "") current.lines.pop();
    while (current.lines.length && REFERENCE_DEF.test(current.lines[current.lines.length - 1])) {
      current.lines.pop();
    }
    sections.push(current);
    current = null;
  };
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^## (.*)$/);
    if (heading) {
      flush();
      current = classifyHeading(heading[1]);
      if (current) current.lines = [current.heading];
      continue;
    }
    if (current) current.lines.push(line);
  }
  flush();
  if (sections.length === 0) throw new Error("no native sections found");
  const bodies = sections.map((s) => {
    let body = mapLinks(s.lines.join("\n"), (url) => pinLink(root, s.tag, url));
    body = rewriteShortcutReferences(body);
    return body.trim();
  });
  return `${GENERATED_HEADER}\n\n# Changelog\n\n${INTRO}\n\n${bodies.join("\n\n")}\n`;
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]; // positive when a is newer
  }
  return 0;
}

/**
 * Validate generated PI_CHANGELOG.md text against the working tree and git
 * refs: every link target is absolute; tag-pinned repository links resolve
 * (file and anchor at the pinned ref, falling back to the same rule the
 * generator used); no reference-style links or definitions survive; no `## `
 * line sits inside a code fence; versions are strictly descending with no
 * duplicates; no em-dashes in the generated prose. Link targets are
 * re-scanned independently of the rewriter (well-formed code spans only), so
 * a rewrite the mapper skipped cannot hide behind the same rule.
 */
export function validateGenerated(text, root = REPO_ROOT) {
  const problems = [];
  if (!isGenerated(text)) problems.push("missing generated header");
  let fence = null;
  const versions = [];
  for (const line of text.split("\n")) {
    if (fence) {
      if (closesFence(line, fence)) fence = null;
      else if (/^## /.test(line)) problems.push(`heading inside a code fence: ${line}`);
      continue;
    }
    const open = line.match(FENCE);
    if (open) {
      fence = open[1];
      continue;
    }
    if (line.includes("—")) problems.push("em-dash in generated prose");
    if (REFERENCE_DEF.test(line.trim())) problems.push(`reference definition in output: ${line.trim()}`);
    if (/^## /.test(line)) {
      const m = line.match(/^## \[(\d+)\.(\d+)\.(\d+)\]/);
      if (!m) problems.push(`heading not in ## [X.Y.Z] form: ${line}`);
      else versions.push(`${m[1]}.${m[2]}.${m[3]}`);
    }
  }
  for (let i = 1; i < versions.length; i++) {
    if (compareVersions(versions[i - 1], versions[i]) <= 0) {
      problems.push(`versions not strictly descending: ${versions[i - 1]} then ${versions[i]}`);
    }
  }
  // Version-shaped shortcut references must have been rewritten to links
  // (section headings excepted: their bracketed version is the parse form).
  for (const line of text.split("\n")) {
    if (line.startsWith("## ") || REFERENCE_DEF.test(line.trim())) continue;
    for (const seg of splitInlineCode(line, { completeOnly: true })) {
      if (seg.code) continue;
      const shortcut = seg.text.match(/\[(pi-|mcp-)?\d+\.\d+\.\d+\](?![:(\d])/);
      if (shortcut && !REFERENCE_DEF.test(seg.text.trim())) {
        problems.push(`version shortcut reference not rewritten: ${shortcut[0]}`);
      }
    }
  }
  const blobBase = `${REPO_URL}/blob/`;
  for (const url of allLinkTargets(text)) {
    if (!isExternal(url)) {
      problems.push(`non-absolute link remains: ${url}`);
      continue;
    }
    if (!url.startsWith(blobBase)) continue;
    const withoutBase = url.slice(blobBase.length);
    const slash = withoutBase.indexOf("/");
    const ref = withoutBase.slice(0, slash);
    const [file, anchor] = withoutBase.slice(slash + 1).split("#");
    const fileAt = (r) => (r === "HEAD" ? existsSync(join(root, file)) : contentAtRef(root, r, file) !== null);
    const anchorAt = (r) => anchor && anchorAtRef(root, r, file, anchor);
    if (ref === "main") {
      if (!fileAt("HEAD")) problems.push(`missing file ${file}`);
      else if (anchor && !anchorAt("HEAD")) problems.push(`missing anchor #${anchor} in ${file} at HEAD`);
    } else if (tagExists(root, ref)) {
      if (!fileAt(ref) && !fileAt("HEAD")) problems.push(`missing file ${file}`);
      else if (anchor && !anchorAt(ref) && !anchorAt("HEAD")) problems.push(`missing anchor #${anchor} in ${file} at ${ref} or HEAD`);
    } else {
      if (!fileAt("HEAD")) problems.push(`missing file ${file} (tag ${ref} not cut)`);
      else if (anchor && !anchorAt("HEAD")) problems.push(`missing anchor #${anchor} in ${file} (tag ${ref} not cut)`);
    }
  }
  if (problems.length) throw new Error(`${OUT}: ${[...new Set(problems)].slice(0, 10).join("; ")}`);
  return versions;
}

/** Derive from the committed CHANGELOG.md. */
function deriveFromRepo(root = REPO_ROOT) {
  return derive(readFileSync(join(root, SOURCE), "utf8"), root);
}

/** Regenerate, validate and (unless --check) write. Returns true when in sync. */
export function checkAgainstRepo(root = REPO_ROOT, { write = false } = {}) {
  const derived = deriveFromRepo(root);
  validateGenerated(derived, root);
  const committedPath = join(root, OUT);
  if (!existsSync(committedPath)) {
    if (!write) throw new Error(`${OUT} is missing; run npm run generate:changelog`);
    writeFileSync(committedPath, derived);
    console.log(`wrote ${OUT}`);
    return true;
  }
  const committed = readFileSync(committedPath, "utf8");
  if (committed === derived) return true;
  if (write) {
    writeFileSync(committedPath, derived);
    console.log(`rewrote ${OUT}`);
    return true;
  }
  throw new Error(`${OUT} is stale; run npm run generate:changelog`);
}

function main(argv) {
  if (argv.length === 0) {
    checkAgainstRepo(REPO_ROOT, { write: true });
    return;
  }
  if (argv.length === 1 && argv[0] === "--check") {
    checkAgainstRepo(REPO_ROOT);
    console.log(`${OUT} is in sync with ${SOURCE}.`);
    return;
  }
  console.error("usage: generate-native-changelog.mjs [--check]");
  process.exit(2);
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
