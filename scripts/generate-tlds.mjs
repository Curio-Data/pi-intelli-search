// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// scripts/generate-tlds.mjs — refresh the delegated-TLD set in
// src/core/tlds.ts from a downloaded copy of the IANA root zone list.
//
//   curl -sS -o <dir>/tlds.txt https://data.iana.org/TLD/tlds-alpha-by-domain.txt
//   node scripts/generate-tlds.mjs <dir>/tlds.txt           # rewrite the set
//   node scripts/generate-tlds.mjs --check <dir>/tlds.txt   # exit 1 on drift
//
// Only the version line and the IANA_TLDS literal are rewritten; the
// FILE_EXTENSION_TLDS policy below them is maintained by hand. The script
// makes no network request, so the download stays an explicit step.

import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const check = args[0] === "--check";
const source = check ? args[1] : args[0];
if (!source) {
  console.error("Usage: node scripts/generate-tlds.mjs [--check] <tlds-alpha-by-domain.txt>");
  process.exit(2);
}
const target = new URL("../src/core/tlds.ts", import.meta.url);
const lines = readFileSync(source, "utf8").split("\n");
const version = lines[0].match(/^# Version (\d+)/)?.[1];
if (!version) throw new Error("Not an IANA TLD list: missing '# Version' header");
const labels = lines
  .slice(1)
  .map((line) => line.trim().toLowerCase())
  .filter(Boolean);
if (labels.some((label) => !/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(label)))
  throw new Error("Unexpected label shape in the IANA list");

const chunks = [];
let current = "";
for (const label of labels) {
  if (current && current.length + label.length + 1 > 92) {
    chunks.push(current);
    current = label;
  } else current = current ? `${current} ${label}` : label;
}
if (current) chunks.push(current);
const literal = `const IANA_TLDS =\n  ${chunks.map((c, i) => JSON.stringify(i < chunks.length - 1 ? `${c} ` : c)).join(" +\n  ")};`;

const before = readFileSync(target, "utf8");
const after = before
  .replace(/^\/\/ version \d+\)\.$/m, `// version ${version}).`)
  .replace(/^const IANA_TLDS =\n[\s\S]*?;$/m, literal);
if (check) {
  if (after !== before) {
    console.error(`src/core/tlds.ts differs from IANA list version ${version}; rerun without --check`);
    process.exit(1);
  }
  console.log(`src/core/tlds.ts matches IANA list version ${version} (${labels.length} TLDs)`);
} else {
  writeFileSync(target, after);
  console.log(`Wrote ${labels.length} TLDs from IANA list version ${version}`);
}
