// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const startMarker = "<!-- TOC:START -->";
const endMarker = "<!-- TOC:END -->";

// Keep inline formatting in link labels, but slug the visible heading text.
function headingText(title) {
  return title
    .replace(/`+([^`]+)`+/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*{1,3})(.+?)\1/g, "$2")
    .replace(/(?<![\p{L}\p{N}])(_{1,3})(.+?)\1(?![\p{L}\p{N}])/gu, "$2");
}

export function createSlugger() {
  const used = new Set();
  return (title) => {
    const base = headingText(title)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}_ -]/gu, "")
      .replace(/ /g, "-");
    let slug = base;
    let suffix = 0;
    while (used.has(slug)) slug = `${base}-${++suffix}`;
    used.add(slug);
    return slug;
  };
}

export function scanHeadings(markdown) {
  const headings = [];
  const slug = createSlugger();
  let fenceLength = 0;
  let inToc = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (fenceLength) {
      const close = line.match(/^ {0,3}(`{3,})[ \t]*$/);
      if (close && close[1].length >= fenceLength) fenceLength = 0;
      continue;
    }
    if (line === startMarker) {
      inToc = true;
      continue;
    }
    if (line === endMarker) {
      inToc = false;
      continue;
    }
    if (inToc) continue;
    const fence = line.match(/^ {0,3}(`{3,})([^`]*)$/);
    if (fence) {
      fenceLength = fence[1].length;
      continue;
    }
    const match = line.match(/^ {0,3}(#{1,6})[ \t]+(.+?)\s*$/);
    if (!match) continue;
    const title = match[2].replace(/[ \t]+#+[ \t]*$/, "");
    // All heading levels reserve anchors, even though only levels 2 and 3
    // appear in the TOC. This preserves document-wide duplicate numbering.
    headings.push({ depth: match[1].length, title, anchor: slug(title) });
  }
  return headings;
}

export function generateToc(markdown) {
  const starts = [...markdown.matchAll(/^<!-- TOC:START -->(?=\r?$)/gm)];
  const ends = [...markdown.matchAll(/^<!-- TOC:END -->(?=\r?$)/gm)];
  if (starts.length !== 1 || ends.length !== 1 || starts[0].index >= ends[0].index) {
    throw new Error(`Add exactly one ${startMarker} line followed by one ${endMarker} line around the TOC block.`);
  }
  const start = starts[0].index + startMarker.length;
  const end = ends[0].index;
  const newline = markdown.includes("\r\n") ? "\r\n" : "\n";
  const entries = scanHeadings(markdown)
    .filter(({ depth, title }) => (depth === 2 || depth === 3) && !(depth === 2 && headingText(title) === "Contents"))
    .map(({ depth, title, anchor }) => `${depth === 3 ? "  " : ""}- [${title}](#${anchor})`);
  const block = `${newline}${newline}${entries.join(newline)}${newline}${newline}`;
  return markdown.slice(0, start) + block + markdown.slice(end);
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const files = args.filter((arg) => arg !== "--check");
  if (files.length > 1 || files.some((arg) => arg.startsWith("--")) || args.filter((arg) => arg === "--check").length > 1) {
    throw new Error("Usage: node scripts/generate-toc.mjs [--check] [file]");
  }
  const file = resolve(root, files[0] ?? "README.md");
  try {
    const current = await readFile(file, "utf8");
    const generated = generateToc(current);
    if (current === generated) {
      console.log(`TOC is in sync: ${file}`);
    } else if (check) {
      console.error(`TOC drift in ${file}. Run node scripts/generate-toc.mjs ${JSON.stringify(file)} to regenerate.`);
      process.exitCode = 1;
    } else {
      await writeFile(file, generated);
      console.log(`Generated TOC: ${file}`);
    }
  } catch (error) {
    throw new Error(`${file}: ${error.message}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
