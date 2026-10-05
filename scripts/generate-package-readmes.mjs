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
//   <!-- /packages -->               Lists are comma-separated: pi, mcp.
//                                    `none` keeps a block in the root only.
//   <!-- packages:mcp hidden         An HTML comment, so invisible in the
//   ...                              root; only the listed packages receive
//   -->                              the enclosed lines (titles, badges).
// Untagged lines go to every package. Blocks do not nest.
//
// Each derived README has its contents list regenerated, links to anchors
// it no longer contains redirected to the root README on GitHub, and
// relative paths made absolute so they resolve on npmjs.com.
//
// Modes:
//   (default)          Write the committed derived READMEs: packages/mcp and
//                      the native preview in docs/readmes/.
//   --check            Validate the source and fail on committed drift.
//   --print PKG        Print one derived README (pi or mcp) to stdout.
//   --publish-native   prepublishOnly hook: back up the root README to
//                      .tmp/ and replace it with the native derivation, so
//                      both the tarball and the registry manifest (read
//                      after postpack) carry it. Release CI discards the
//                      checkout; locally, run --restore-native afterwards.
//   --restore-native   Put the backed-up root README back.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateToc, scanHeadings } from "./generate-toc.mjs";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const REPO_URL = "https://github.com/Curio-Data/pi-intelli-search";
const BLOB_BASE = `${REPO_URL}/blob/main/`;
const RAW_BASE = "https://raw.githubusercontent.com/Curio-Data/pi-intelli-search/main/";
const SOURCE = "README.md";
const BACKUP = ".tmp/README.source.md";
const GENERATED_HEADER =
  "<!-- Generated from the repository README.md by scripts/generate-package-readmes.mjs. " +
  "Edit the root README.md, then run npm run generate:readmes. -->";

// Package key -> committed output path. The native package ships the root
// README.md path itself, so its committed copy is a reviewable preview that
// --publish-native reproduces at publish time.
export const PACKAGES = { pi: "docs/readmes/pi-intelli-search.md", mcp: "packages/mcp/README.md" };

const OPEN = /^<!-- packages:([a-z,]+) -->$/;
const OPEN_HIDDEN = /^<!-- packages:([a-z,]+) hidden$/;
const CLOSE = "<!-- /packages -->";
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const closesFence = (line, fence) =>
  /^ {0,3}[`~]{3,}\s*$/.test(line) && line.trim()[0] === fence[0] && line.trim().length >= fence.length;
const IMAGE = /\.(png|svg|webp|jpe?g|gif|avif)$/i;

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

// Select the lines one rendering receives. target "root" is the GitHub view:
// visible blocks only, directives dropped. Returns the selected lines.
export function selectLines(markdown, target) {
  if (target !== "root" && !(target in PACKAGES)) throw new Error(`unknown target "${target}"`);
  const out = [];
  let block = null;
  let fence = null;
  markdown.split(/\r?\n/).forEach((line, index) => {
    const lineNo = index + 1;
    const keep = () => {
      if (!block) return true;
      if (block.hidden) return target !== "root" && block.targets.has(target);
      return target === "root" || block.targets.has(target);
    };
    if (block?.hidden) {
      if (line === "-->") {
        block = null;
        return;
      }
      if (line.includes("-->")) throw new Error(`line ${lineNo}: "-->" inside a hidden block ends the comment early`);
      if (keep()) out.push(line);
      return;
    }
    if (fence) {
      if (closesFence(line, fence)) fence = null;
      if (keep()) out.push(line);
      return;
    }
    const open = line.match(OPEN) ?? line.match(OPEN_HIDDEN);
    if (open) {
      if (block) throw new Error(`line ${lineNo}: package blocks do not nest (open block from line ${block.lineNo})`);
      block = { targets: parseTargets(open[1], lineNo), hidden: OPEN_HIDDEN.test(line), lineNo };
      return;
    }
    if (line === CLOSE) {
      if (!block) throw new Error(`line ${lineNo}: ${CLOSE} without an open block`);
      block = null;
      return;
    }
    if (/^\s*<!-- \/?packages\b/.test(line)) throw new Error(`line ${lineNo}: malformed package directive: ${line}`);
    const fenceOpen = line.match(FENCE);
    if (fenceOpen) fence = fenceOpen[1];
    if (keep()) out.push(line);
  });
  if (block) throw new Error(`line ${block.lineNo}: package block is never closed`);
  if (fence) throw new Error("unterminated code fence");
  return out;
}

// Collapse the blank-line runs that removed blocks leave behind, outside fences.
function tidy(lines) {
  const out = [];
  let fence = null;
  for (const line of lines) {
    if (fence) {
      if (closesFence(line, fence)) fence = null;
      out.push(line);
      continue;
    }
    const open = line.match(FENCE);
    if (open) fence = open[1];
    if (line.trim() === "" && (out.length === 0 || out[out.length - 1].trim() === "")) continue;
    out.push(line);
  }
  while (out.length && out[out.length - 1].trim() === "") out.pop();
  return `${out.join("\n")}\n`;
}

export function anchorsOf(markdown) {
  const anchors = new Set(scanHeadings(markdown).map((h) => h.anchor));
  for (const match of markdown.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) anchors.add(match[1]);
  return anchors;
}

// Apply fn(target) to every link target outside code fences: Markdown links
// and images, plus HTML href, src and srcset attributes.
function mapLinks(markdown, fn) {
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
      return line
        .replace(/\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g, (_, url, title) => `](${fn(url)}${title})`)
        .replace(/\b(href|src|srcset)="([^"]+)"/g, (_, attr, url) => `${attr}="${fn(url)}"`);
    })
    .join("\n");
}

const isExternal = (url) => /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//");

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

// The root must stand on its own: every anchor and relative path it shows
// on GitHub has to resolve.
export function validateRoot(markdown, root = REPO_ROOT) {
  const rendered = selectLines(markdown, "root").join("\n");
  const anchors = anchorsOf(rendered);
  const problems = [];
  mapLinks(rendered, (url) => {
    if (isExternal(url)) return url;
    if (url.startsWith("#")) {
      if (!anchors.has(url.slice(1))) problems.push(`missing anchor ${url}`);
    } else if (!existsSync(join(root, url.split("#")[0]))) {
      problems.push(`missing file ${url}`);
    }
    return url;
  });
  if (problems.length) throw new Error(`README.md: ${[...new Set(problems)].join("; ")}`);
}

export function derive(markdown, pkg) {
  if (!(pkg in PACKAGES)) throw new Error(`unknown package "${pkg}"`);
  if (isGenerated(markdown)) throw new Error("source README.md is a generated copy; run --restore-native first");
  let body = tidy(selectLines(markdown, pkg));
  if (body.includes("<!-- TOC:START -->")) body = generateToc(body);
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
// (and be pushed to main) before the published page can show it.
export function validateDerived(text, pkg, rootAnchors, root = REPO_ROOT) {
  const anchors = anchorsOf(text);
  const problems = [];
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
  if (problems.length) throw new Error(`${pkg} README: ${[...new Set(problems)].join("; ")}`);
}

export function generateAll(root = REPO_ROOT) {
  const source = readSource(root);
  const rootAnchors = anchorsOf(selectLines(source, "root").join("\n"));
  return Object.fromEntries(
    Object.keys(PACKAGES).map((pkg) => {
      const text = derive(source, pkg);
      validateDerived(text, pkg, rootAnchors, root);
      return [pkg, text];
    }),
  );
}

// Returns the committed outputs that differ from a fresh derivation.
export function checkAgainstRepo(root = REPO_ROOT) {
  const generated = generateAll(root);
  return Object.entries(PACKAGES)
    .filter(([pkg, out]) => (!existsSync(join(root, out)) || readFileSync(join(root, out), "utf8") !== generated[pkg]))
    .map(([, out]) => out);
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
  const usage = "Usage: node scripts/generate-package-readmes.mjs [--check | --print pi|mcp | --publish-native | --restore-native]";
  if (rest.length || (mode !== "--print" && arg !== undefined)) throw new Error(usage);
  if (mode === undefined) {
    const generated = generateAll();
    for (const [pkg, out] of Object.entries(PACKAGES)) {
      mkdirSync(dirname(join(REPO_ROOT, out)), { recursive: true });
      writeFileSync(join(REPO_ROOT, out), generated[pkg]);
      console.log(`Generated ${out}`);
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
    process.stdout.write(generateAll()[arg]);
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
