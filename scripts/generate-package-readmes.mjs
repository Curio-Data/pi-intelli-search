#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// scripts/generate-package-readmes.mjs
//
// Derives each package's README from the single hand-edited source, the
// repository root README.md. The root renders every visible section on
// GitHub; each package receives only the sections tagged for it.
//
// Source directives (each on its own line, outside code fences):
//   <!-- packages:mcp -->            Visible in the root; only the listed
//   ...                              packages receive the enclosed lines.
//   <!-- /packages -->               Lists are comma-separated: pi, mcp, dsh.
//                                    `none` keeps a block in the root only.
//   <!-- packages:mcp hidden         An HTML comment, so invisible in the
//   ...                              root; only the listed packages receive
//   -->                              the enclosed lines (titles, badges).
// Untagged lines go to every package except an opt-in audience (dsh), which
// receives only blocks that name it. Blocks do not nest.
//
// Each derived README has its contents list regenerated, links to anchors
// it no longer contains redirected to the root README on GitHub, and
// relative paths made absolute so they resolve on npmjs.com.
//
// The dsh view (DeepSeek Harness bundle README) additionally follows these
// rules, because the in-harness detail page leaves relative links as text:
//   - Double-brace tokens ({{MCP_VERSION}}, {{DSH_ENGINES_RANGE}},
//     {{DSH_NODE_ENGINES_RANGE}}, {{DSH_REFERENCE_VERSION}},
//     {{DSH_TESTED_VERSIONS}}, {{DSH_CONTENTS}}) are allowed only inside
//     `<!-- packages:dsh hidden` blocks. Values come from
//     scripts/dsh-host-metadata.mjs and packages/mcp/package.json.
//   - A {{DSH_CONTENTS}} line becomes a `## Contents` heading and contents
//     list. Hidden source never holds literal TOC markers (`-->` is banned).
//   - Order: select blocks, substitute metadata, insert contents, rewrite
//     links, validate. No view may keep a `{{`.
//   - Every link is absolute. Same-page anchors, contents entries included,
//     point at plugins/dsh/README.md on the release tag mcp-v<version>.
//     Operational files use that tag; every other path follows main, so
//     evidence and history do not freeze at publication.
//   - Link intent: a bare #anchor on a root-visible (shared) line means the
//     heading the root shows under that anchor. It stays on the dsh page only
//     when that same source heading is in the dsh view (its dsh anchor is
//     used, even if the suffix differs); otherwise it goes to the root README.
//     A dsh-only heading never captures a shared link. Lines from hidden
//     blocks name anchors of the dsh view itself.
//   - Self-anchors are validated against the derived text in memory, never
//     against plugins/dsh/README.md on disk.
//
// Modes:
//   (default)          Write the committed derived READMEs (see PACKAGES).
//                      An opt-in view the source does not yet populate is
//                      not written.
//   --check            Validate the source and fail on committed drift.
//   --print PKG        Print one derived README (pi, mcp or dsh) to stdout.
//   --publish-native   prepublishOnly hook: back up the root README to
//                      .tmp/ and replace it with the native derivation, so
//                      both the tarball and the registry manifest (read
//                      after postpack) carry it. Release CI discards the
//                      checkout; locally, run --restore-native afterwards.
//   --restore-native   Put the backed-up root README back.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSlugger, generateToc, scanHeadings } from "./generate-toc.mjs";
import { FENCE, allLinkTargets, closesFence, mapLinks, isExternal } from "./lib/markdown-links.mjs";
import { CONTENTS_TOKEN, dshHostMetadata, substituteMetadata } from "./dsh-host-metadata.mjs";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const REPO_SLUG = "Curio-Data/pi-intelli-search";
const REPO_URL = `https://github.com/${REPO_SLUG}`;
const BLOB_BASE = `${REPO_URL}/blob/main/`;
const RAW_BASE = `https://raw.githubusercontent.com/${REPO_SLUG}/main/`;
const SOURCE = "README.md";
const BACKUP = ".tmp/README.source.md";
const TOC_START = "<!-- TOC:START -->";
const TOC_END = "<!-- TOC:END -->";
export const GENERATED_HEADER =
  "<!-- Generated from the repository README.md by scripts/generate-package-readmes.mjs. " +
  "Edit the root README.md, then run npm run generate:readmes. -->";
export const DSH_GENERATED_HEADER =
  "<!-- Generated from the repository README.md by scripts/generate-package-readmes.mjs. " +
  "Edit the root README.md, then run npm run generate:readmes and npm run generate:plugins. -->";

// Package key -> committed output paths. Every path is a real file: npm drops
// a symlinked README from the tarball, and GitHub shows a symlink as its
// target path instead of rendering it. The root <pkg>.README.md copies are
// previews; the native package ships the root README.md path itself, so
// --publish-native writes the same derivation there at publish time. The dsh
// preview is the only dsh output here: scripts/generate-plugin-bundles.mjs is
// the sole writer of plugins/dsh/README.md, from derivePackageReadme("dsh").
export const PACKAGES = {
  pi: ["pi.README.md"],
  mcp: ["mcp.README.md", "packages/mcp/README.md"],
  dsh: ["dsh.README.md"],
};

/** Audiences that receive only blocks naming them, never untagged lines. */
export const OPT_IN = new Set(["dsh"]);

/** The dsh bundle README path that same-page dsh links target. */
export const DSH_SELF_PATH = "plugins/dsh/README.md";

/** Release-matched operator instructions; every other dsh target follows main. */
export const DSH_OPERATIONAL_FILES = new Set([
  SOURCE,
  "packages/mcp/README.md",
  DSH_SELF_PATH,
  "plugins/dsh/skills/intelli-search/SKILL.md",
]);

export const releaseRef = (version) => `mcp-v${version}`;
export const blobBase = (ref) => `${REPO_URL}/blob/${ref}/`;
export const rawBase = (ref) => `https://raw.githubusercontent.com/${REPO_SLUG}/${ref}/`;

/** Split an absolute link into this repository's blob/raw form, or null. */
export function parseRepoUrl(url) {
  const blob = url.match(/^https:\/\/github\.com\/Curio-Data\/pi-intelli-search\/(blob|tree)\/([^/#?]+)\/([^#?]*)(?:#(.*))?$/);
  if (blob) return { kind: blob[1], ref: blob[2], path: blob[3], anchor: blob[4] };
  const raw = url.match(/^https:\/\/raw\.githubusercontent\.com\/Curio-Data\/pi-intelli-search\/([^/#?]+)\/([^#?]*)$/);
  if (raw) return { kind: "raw", ref: raw[1], path: raw[2], anchor: undefined };
  return null;
}

/** The ref a dsh link to this repository path must use. */
export function expectedDshRef(path, version) {
  return DSH_OPERATIONAL_FILES.has(path) ? releaseRef(version) : "main";
}

const OPEN = /^<!-- packages:([a-z,]+) -->$/;
const OPEN_HIDDEN = /^<!-- packages:([a-z,]+) hidden$/;
const CLOSE = "<!-- /packages -->";
const IMAGE = /\.(png|svg|webp|jpe?g|gif|avif)$/i;
const ID_ANCHOR = /<a\s+(?:id|name)="([^"]+)"/g;

export function isGenerated(markdown) {
  return markdown.startsWith("<!-- Generated from the repository README.md");
}

function parseTargets(list, lineNo) {
  const targets = list.split(",");
  for (const t of targets) {
    if (t !== "none" && !(t in PACKAGES)) {
      throw new Error(`line ${lineNo}: unknown package "${t}" (use ${Object.keys(PACKAGES).join(", ")} or none)`);
    }
  }
  if (targets.includes("none") && targets.length > 1) {
    throw new Error(`line ${lineNo}: "none" cannot be combined with packages`);
  }
  return new Set(targets);
}

const dshOnlyHidden = (block) => block?.hidden && block.targets.size === 1 && block.targets.has("dsh");

// Select the records one rendering receives: { text, line (1-based source
// line), origin }. origin is "visible" for lines the root view shows and
// "hidden" for lines of a hidden block. target "root" is the GitHub view.
export function selectRecords(markdown, target) {
  if (target !== "root" && !(target in PACKAGES)) throw new Error(`unknown target "${target}"`);
  const out = [];
  let block = null;
  let fence = null;
  markdown.split(/\r?\n/).forEach((text, index) => {
    const lineNo = index + 1;
    const keep = () => {
      if (!block) return target === "root" || !OPT_IN.has(target);
      if (block.hidden) return target !== "root" && block.targets.has(target);
      return target === "root" || block.targets.has(target);
    };
    const push = () => {
      if (text.includes("{{") && !dshOnlyHidden(block)) {
        throw new Error(`line ${lineNo}: double-brace tokens are allowed only inside <!-- packages:dsh hidden blocks`);
      }
      if (text.includes(CONTENTS_TOKEN) && text !== CONTENTS_TOKEN) {
        throw new Error(`line ${lineNo}: ${CONTENTS_TOKEN} must be a line of its own`);
      }
      if (keep()) out.push({ text, line: lineNo, origin: block?.hidden ? "hidden" : "visible" });
    };
    if (block?.hidden) {
      if (text === "-->") {
        block = null;
        return;
      }
      if (text.includes("-->")) throw new Error(`line ${lineNo}: "-->" inside a hidden block ends the comment early`);
      if (text.includes("<!--")) throw new Error(`line ${lineNo}: "<!--" inside a hidden block starts an unclosed HTML comment`);
      push();
      return;
    }
    if (fence) {
      if (closesFence(text, fence)) fence = null;
      push();
      return;
    }
    const open = text.match(OPEN) ?? text.match(OPEN_HIDDEN);
    if (open) {
      if (block) throw new Error(`line ${lineNo}: package blocks do not nest (open block from line ${block.lineNo})`);
      block = { targets: parseTargets(open[1], lineNo), hidden: OPEN_HIDDEN.test(text), lineNo };
      return;
    }
    if (text === CLOSE) {
      if (!block) throw new Error(`line ${lineNo}: ${CLOSE} without an open block`);
      block = null;
      return;
    }
    if (/^\s*<!-- \/?packages\b/.test(text)) throw new Error(`line ${lineNo}: malformed package directive: ${text}`);
    const fenceOpen = text.match(FENCE);
    if (fenceOpen) fence = fenceOpen[1];
    push();
  });
  if (block) throw new Error(`line ${block.lineNo}: package block is never closed`);
  if (fence) throw new Error("unterminated code fence");
  return out;
}

// Select the lines one rendering receives. target "root" is the GitHub view:
// visible blocks only, directives dropped. Returns the selected lines.
export function selectLines(markdown, target) {
  return selectRecords(markdown, target).map((r) => r.text);
}

/** Whether the source gives a package any content (always true unless opt-in). */
export function hasAudience(markdown, pkg) {
  if (!(pkg in PACKAGES)) throw new Error(`unknown package "${pkg}"`);
  return !OPT_IN.has(pkg) || selectRecords(markdown, pkg).length > 0;
}

// Collapse the blank-line runs that removed blocks leave behind, outside fences.
function tidyRecords(records) {
  const out = [];
  let fence = null;
  for (const record of records) {
    const line = record.text;
    if (fence) {
      if (closesFence(line, fence)) fence = null;
      out.push(record);
      continue;
    }
    const open = line.match(FENCE);
    if (open) fence = open[1];
    if (line.trim() === "" && (out.length === 0 || out[out.length - 1].text.trim() === "")) continue;
    out.push(record);
  }
  while (out.length && out[out.length - 1].text.trim() === "") out.pop();
  return out;
}

function tidy(lines) {
  return `${tidyRecords(lines.map((text) => ({ text })))
    .map((r) => r.text)
    .join("\n")}\n`;
}

export function anchorsOf(markdown) {
  const anchors = new Set(scanHeadings(markdown).map((h) => h.anchor));
  for (const match of markdown.matchAll(ID_ANCHOR)) anchors.add(match[1]);
  return anchors;
}

// Line-indexed anchors: { index, anchor, kind } for every heading and every
// explicit <a id|name> alias. Mirrors scanHeadings() and is cross-checked
// against it, so link identity can follow a heading to its source line.
export function anchorIndex(lines) {
  const slug = createSlugger();
  const headings = [];
  const ids = [];
  let fenceLength = 0;
  let inToc = false;
  let inComment = false;
  lines.forEach((line, index) => {
    for (const match of line.matchAll(ID_ANCHOR)) ids.push({ index, anchor: match[1], kind: "id" });
    if (inComment) {
      if (line.includes("-->")) inComment = false;
      return;
    }
    if (fenceLength) {
      const close = line.match(/^ {0,3}(`{3,})[ \t]*$/);
      if (close && close[1].length >= fenceLength) fenceLength = 0;
      return;
    }
    if (line === TOC_START) {
      inToc = true;
      return;
    }
    if (line === TOC_END) {
      inToc = false;
      return;
    }
    if (inToc) return;
    if (/^ {0,3}<!--/.test(line) && !line.includes("-->")) {
      inComment = true;
      return;
    }
    const fence = line.match(/^ {0,3}(`{3,})([^`]*)$/);
    if (fence) {
      fenceLength = fence[1].length;
      return;
    }
    const match = line.match(/^ {0,3}(#{1,6})[ \t]+(.+?)\s*$/);
    if (!match) return;
    const title = match[2].replace(/[ \t]+#+[ \t]*$/, "");
    headings.push({ index, anchor: slug(title), kind: "heading" });
  });
  const expected = scanHeadings(lines.join("\n")).map((h) => h.anchor);
  if (expected.join("\n") !== headings.map((h) => h.anchor).join("\n")) {
    throw new Error("internal: anchor index disagrees with scanHeadings()");
  }
  return [...headings, ...ids];
}

function rewriteFor(anchors) {
  return (url) => {
    if (isExternal(url)) return url;
    if (url.startsWith("#")) return anchors.has(url.slice(1)) ? url : `${BLOB_BASE}${SOURCE}${url}`;
    const path = url.replace(/^\.\//, "");
    if (path.startsWith("../")) throw new Error(`relative link leaves the repository: ${url}`);
    const [file] = path.split("#");
    return IMAGE.test(file) ? `${RAW_BASE}${file}` : `${BLOB_BASE}${path}`;
  };
}

function rootAnchorsOf(markdown) {
  return anchorsOf(selectLines(markdown, "root").join("\n"));
}

// The root must stand on its own: every anchor and relative path it shows
// on GitHub has to resolve.
export function validateRoot(markdown, root = REPO_ROOT) {
  const rendered = selectLines(markdown, "root").join("\n");
  const anchors = anchorsOf(rendered);
  const problems = [];
  if (rendered.includes("{{")) problems.push("unreplaced {{ token");
  mapLinks(rendered, (url) => {
    if (isExternal(url)) return url;
    if (url.startsWith("#")) {
      if (!anchors.has(url.slice(1))) problems.push(`missing anchor ${url}`);
    } else if (!existsSync(join(root, url.split("#")[0])) && !Object.values(PACKAGES).flat().includes(url.split("#")[0])) {
      problems.push(`missing file ${url}`);
    }
    return url;
  });
  if (problems.length) throw new Error(`README.md: ${[...new Set(problems)].join("; ")}`);
}

// Replace the contents token with a heading and a generated contents list.
// Records keep their origin; generated lines are marked "generated".
function insertContents(records) {
  const at = records.flatMap((r, i) => (r.text === CONTENTS_TOKEN ? [i] : []));
  if (at.length > 1) throw new Error(`${CONTENTS_TOKEN} appears ${at.length} times; use it once`);
  if (at.length === 0) return records;
  const generated = (text) => ({ text, line: null, origin: "generated" });
  const withMarkers = [
    ...records.slice(0, at[0]),
    generated("## Contents"),
    generated(""),
    generated(TOC_START),
    generated(TOC_END),
    ...records.slice(at[0] + 1),
  ];
  const lines = generateToc(withMarkers.map((r) => r.text).join("\n")).split("\n");
  const start = withMarkers.findIndex((r) => r.text === TOC_START);
  const end = withMarkers.findIndex((r) => r.text === TOC_END);
  const tocLength = lines.length - withMarkers.length + (end - start - 1);
  return [
    ...withMarkers.slice(0, start + 1),
    ...lines.slice(start + 1, start + 1 + tocLength).map(generated),
    ...withMarkers.slice(end),
  ];
}

function deriveDsh(markdown, meta) {
  // 1. Block selection.
  const selected = selectRecords(markdown, "dsh");
  if (selected.length === 0) {
    throw new Error("README.md gives the dsh package no content; add <!-- packages:dsh hidden or mcp,dsh blocks");
  }
  // 2. Metadata substitution, before contents so token-built headings are listed.
  let records = tidyRecords(selected).map((r) => ({ ...r, text: substituteMetadata(r.text, meta) }));
  // 3. Contents insertion.
  records = insertContents(records);
  // 4. Link rewriting.
  const release = releaseRef(meta.mcpVersion);
  const self = (anchor) => `${blobBase(release)}${DSH_SELF_PATH}#${anchor}`;
  const rootRecords = selectRecords(markdown, "root");
  const rootIndex = new Map();
  for (const a of anchorIndex(rootRecords.map((r) => r.text))) {
    if (!rootIndex.has(a.anchor)) rootIndex.set(a.anchor, { line: rootRecords[a.index].line, kind: a.kind, anchor: a.anchor });
  }
  const dshEntries = anchorIndex(records.map((r) => r.text));
  const dshAnchors = new Set(dshEntries.map((a) => a.anchor));
  const dshBySource = new Map();
  for (const a of dshEntries) {
    const line = records[a.index].line;
    if (line !== null) dshBySource.set(`${a.kind}:${line}:${a.kind === "id" ? a.anchor : ""}`, a.anchor);
  }
  const sharedTarget = (anchor) => {
    const target = rootIndex.get(anchor);
    if (!target) return self(anchor); // unresolved: validation reports it
    const local = dshBySource.get(`${target.kind}:${target.line}:${target.kind === "id" ? target.anchor : ""}`);
    return local ? self(local) : `${blobBase(release)}${SOURCE}#${anchor}`;
  };
  const rewrite = (origin) => (url) => {
    if (isExternal(url)) return url;
    if (url.startsWith("#")) {
      const anchor = url.slice(1);
      if (origin === "generated") return self(anchor);
      if (origin === "visible") return sharedTarget(anchor);
      if (dshAnchors.has(anchor)) return self(anchor);
      return rootIndex.has(anchor) ? `${blobBase(release)}${SOURCE}${url}` : self(anchor);
    }
    const path = url.replace(/^\.\//, "");
    if (path.startsWith("../")) throw new Error(`relative link leaves the repository: ${url}`);
    const [file] = path.split("#");
    if (IMAGE.test(file)) return `${rawBase(expectedDshRef(file, meta.mcpVersion))}${file}`;
    return `${blobBase(expectedDshRef(file, meta.mcpVersion))}${path}`;
  };
  let fence = null;
  const lines = records.map((r) => {
    if (fence) {
      if (closesFence(r.text, fence)) fence = null;
      return r.text;
    }
    const open = r.text.match(FENCE);
    if (open) {
      fence = open[1];
      return r.text;
    }
    return mapLinks(r.text, rewrite(r.origin));
  });
  return `${DSH_GENERATED_HEADER}\n\n${lines.join("\n")}\n`;
}

/**
 * Derive one package view from source text. Selection, metadata, contents
 * and link rewriting only; derivePackageReadme() adds source and link
 * validation. options.metadata overrides dshHostMetadata(options.root).
 */
export function derive(markdown, pkg, options = {}) {
  if (!(pkg in PACKAGES)) throw new Error(`unknown package "${pkg}"`);
  if (isGenerated(markdown)) throw new Error("source README.md is a generated copy; run --restore-native first");
  if (pkg === "dsh") return deriveDsh(markdown, options.metadata ?? dshHostMetadata(options.root ?? REPO_ROOT));
  let body = tidy(selectLines(markdown, pkg));
  if (body.includes(TOC_START)) body = generateToc(body);
  body = mapLinks(body, rewriteFor(anchorsOf(body)));
  return `${GENERATED_HEADER}\n\n${body}`;
}

function readSource(root) {
  const source = readFileSync(join(root, SOURCE), "utf8");
  if (isGenerated(source)) {
    throw new Error(`${SOURCE} is the generated native README left by a publish; run node scripts/generate-package-readmes.mjs --restore-native`);
  }
  validateRoot(source, root);
  return source;
}

// Every link a derived README carries must resolve: its own anchors, files
// in this repository behind the GitHub URLs, and anchors in the root README.
// Targets are checked against the working tree, so a file must exist here
// (and be pushed to main) before the published page can show it. The dsh
// view also enforces its ref policy and checks self-anchors in memory only.
export function validateDerived(text, pkg, rootAnchors, root = REPO_ROOT, options = {}) {
  const anchors = anchorsOf(text);
  const problems = [];
  if (text.includes("{{")) problems.push("unreplaced {{ token");
  if (pkg === "dsh") {
    const version = options.metadata?.mcpVersion ?? dshHostMetadata(root).mcpVersion;
    for (const url of allLinkTargets(text)) {
      if (!isExternal(url)) {
        problems.push(url.startsWith("#") ? `same-page anchor ${url} is not absolute` : `relative link ${url}`);
        continue;
      }
      const target = parseRepoUrl(url);
      if (!target) continue;
      const ref = expectedDshRef(target.path, version);
      if (target.ref !== ref) problems.push(`${target.path} must use ref ${ref}, not ${target.ref}`);
      if (target.kind === "blob" && target.path === DSH_SELF_PATH) {
        if (target.anchor && !anchors.has(target.anchor)) problems.push(`missing self anchor #${target.anchor}`);
      } else if (!existsSync(join(root, target.path))) {
        problems.push(`missing file ${target.path}`);
      } else if (target.path === SOURCE && target.anchor && !rootAnchors.has(target.anchor)) {
        problems.push(`missing root anchor #${target.anchor}`);
      }
    }
  } else {
    mapLinks(text, (url) => {
      for (const base of [BLOB_BASE, RAW_BASE]) {
        if (!url.startsWith(base)) continue;
        const [file, anchor] = url.slice(base.length).split("#");
        if (!existsSync(join(root, file))) problems.push(`missing file ${file}`);
        else if (file === SOURCE && anchor && !rootAnchors.has(anchor)) problems.push(`missing root anchor #${anchor}`);
      }
      if (url.startsWith("#") && !anchors.has(url.slice(1))) problems.push(`missing anchor ${url}`);
      if (!isExternal(url) && !url.startsWith("#")) problems.push(`relative link ${url}`);
      return url;
    });
  }
  if (problems.length) throw new Error(`${pkg} README: ${[...new Set(problems)].join("; ")}`);
}

function deriveValidated(source, pkg, root, metadata) {
  const text = derive(source, pkg, { root, metadata });
  validateDerived(text, pkg, rootAnchorsOf(source), root, { metadata });
  return text;
}

/**
 * The one derivation entry point: reads the canonical README.md under root,
 * rejects a publish-swapped generated copy, validates the root view and
 * returns the validated package view. generateAll() and the plugin bundle
 * generator both use it; neither reads a generated README.
 */
export function derivePackageReadme(pkg, root = REPO_ROOT) {
  if (!(pkg in PACKAGES)) throw new Error(`unknown package "${pkg}"`);
  return deriveValidated(readSource(root), pkg, root, pkg === "dsh" ? dshHostMetadata(root) : undefined);
}

// Every package view the source populates. An opt-in view (dsh) with no
// selected content is omitted rather than written empty.
export function generateAll(root = REPO_ROOT) {
  const source = readSource(root);
  const metadata = hasAudience(source, "dsh") ? dshHostMetadata(root) : undefined;
  return Object.fromEntries(
    Object.keys(PACKAGES)
      .filter((pkg) => hasAudience(source, pkg))
      .map((pkg) => [pkg, deriveValidated(source, pkg, root, pkg === "dsh" ? metadata : undefined)]),
  );
}

// Returns the committed outputs that differ from a fresh derivation. An
// omitted opt-in view drifts only if a stale output file exists.
export function checkAgainstRepo(root = REPO_ROOT) {
  const generated = generateAll(root);
  return Object.entries(PACKAGES).flatMap(([pkg, outs]) =>
    outs.filter((out) =>
      pkg in generated
        ? !existsSync(join(root, out)) || readFileSync(join(root, out), "utf8") !== generated[pkg]
        : existsSync(join(root, out)),
    ),
  );
}

export function publishNative(root = REPO_ROOT) {
  const sourcePath = join(root, SOURCE);
  const backupPath = join(root, BACKUP);
  // Re-running after an interrupted publish derives from the backup again.
  const current = readFileSync(sourcePath, "utf8");
  if (isGenerated(current)) {
    if (!existsSync(backupPath)) throw new Error(`${SOURCE} is generated but ${BACKUP} is missing; restore it from git`);
  } else {
    validateRoot(current, root);
    mkdirSync(dirname(backupPath), { recursive: true });
    writeFileSync(backupPath, current);
  }
  writeFileSync(sourcePath, derive(readFileSync(backupPath, "utf8"), "pi"));
  console.log(`Replaced ${SOURCE} with the native package README (source backed up to ${BACKUP}).`);
}

export function restoreNative(root = REPO_ROOT) {
  const backupPath = join(root, BACKUP);
  const current = readFileSync(join(root, SOURCE), "utf8");
  if (!isGenerated(current)) {
    console.log(`${SOURCE} is already the source README.`);
    return;
  }
  if (!existsSync(backupPath)) throw new Error(`${BACKUP} is missing; restore ${SOURCE} from git`);
  renameSync(backupPath, join(root, SOURCE));
  console.log(`Restored ${SOURCE} from ${BACKUP}.`);
}

function main(argv) {
  const [mode, arg, ...rest] = argv;
  const usage = "Usage: node scripts/generate-package-readmes.mjs [--check | --print pi|mcp|dsh | --publish-native | --restore-native]";
  if (rest.length || (mode !== "--print" && arg !== undefined)) throw new Error(usage);
  if (mode === undefined) {
    const generated = generateAll();
    for (const [pkg, outs] of Object.entries(PACKAGES)) {
      if (!(pkg in generated)) {
        console.log(`Skipped ${outs.join(", ")}: README.md gives ${pkg} no content`);
        continue;
      }
      for (const out of outs) {
        writeFileSync(join(REPO_ROOT, out), generated[pkg]);
        console.log(`Generated ${out}`);
      }
    }
  } else if (mode === "--check") {
    const drifted = checkAgainstRepo();
    if (drifted.length) {
      console.error(`Package README drift: ${drifted.join(", ")}. Edit the root README.md, then run npm run generate:readmes.`);
      process.exitCode = 1;
    } else {
      console.log("Package READMEs are in sync with README.md.");
    }
  } else if (mode === "--print") {
    if (!(arg in PACKAGES)) throw new Error(usage);
    process.stdout.write(derivePackageReadme(arg));
  } else if (mode === "--publish-native") {
    publishNative(REPO_ROOT);
  } else if (mode === "--restore-native") {
    restoreNative(REPO_ROOT);
  } else {
    throw new Error(usage);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
