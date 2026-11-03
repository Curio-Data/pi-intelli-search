#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// scripts/capture-changelog-fixture.mjs — capture the installed `Pi` host's
// extension-changelog parser behaviour into a fixture so the deterministic
// test suite can assert our generated PI_CHANGELOG.md against it without a
// host installation (CI has none).
//
//   node scripts/capture-changelog-fixture.mjs <dist/utils/changelog.js> [out.json]
//   node scripts/capture-changelog-fixture.mjs --check <dist/utils/changelog.js>
//
// The fixture records the parseChangelog heading regex source and the parse
// result of a small golden sample covering the accepted and rejected heading
// forms. The fixture is a capture, not a live probe: nothing here detects a
// host bump by itself, so run --check against the installed host during every
// host-bump audit and recapture deliberately when the parser changes.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_OUT = fileURLToPath(new URL("../test/fixtures/pi-changelog-parser-1.5.0.json", import.meta.url));

async function capture(modulePath) {
  // The heading regex literal, straight from the installed source: the
  // parseChangelog version test is `line.match(/##\s+.../)`.
  const source = readFileSync(modulePath, "utf8");
  const regexMatch = source.match(/line\.match\(\/(.+?)\/\)/);
  if (!regexMatch || !regexMatch[1].startsWith("##\\s+")) {
    throw new Error(`heading regex literal not found in ${modulePath}`);
  }
  const mod = await import(pathToFileURL(modulePath).href);
  if (typeof mod.parseChangelog !== "function") {
    throw new Error(`parseChangelog is not exported by ${modulePath}`);
  }
  const tmp = mkdtempSync(join(tmpdir(), "pi-changelog-fixture-"));
  try {
    const goldenPath = join(tmp, "golden.md");
    writeFileSync(goldenPath, GOLDEN);
    const entries = mod.parseChangelog(goldenPath).map((e) => ({
      version: `${e.major}.${e.minor}.${e.patch}`,
      content: e.content,
    }));
    const pkg = JSON.parse(readFileSync(resolve(dirname(modulePath), "../../package.json"), "utf8"));
    return {
      source: `@earendil-works/pi-coding-agent ${pkg.version} dist/utils/changelog.js`,
      captured: new Date().toISOString().slice(0, 10),
      note:
        "Captured parseChangelog heading regex and golden-sample parse result. test/native-changelog.test.ts " +
        "asserts the generated PI_CHANGELOG.md against this capture; it does not read the installed host. " +
        "Run scripts/capture-changelog-fixture.mjs --check during every host-bump audit and recapture " +
        "deliberately when the parser changes.",
      headingRegexSource: regexMatch[1],
      goldenMarkdown: GOLDEN,
      goldenEntries: entries,
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// Golden sample: accepted `## [1.2.3]` / `## 1.4.0 - date` forms, rejected
// `v`-prefixed, package-prefixed and non-version headings, `###` content.
const GOLDEN = [
  "# Golden sample",
  "",
  "## [1.2.3]",
  "first body",
  "### Sub-heading stays in the entry",
  "",
  "## 1.4.0 - 2026-01-01",
  "second body",
  "",
  "## v1.5.0",
  "rejected: leading v",
  "",
  "## [pi-1.6.0] - 2026-02-02",
  "rejected: package prefix",
  "",
  "## [Unreleased]",
  "rejected: no version",
  "",
  "## [0.13.0-alpha.1]",
  "collapsed onto 0.13.0",
  "",
].join("\n");

async function main(argv) {
  let check = false;
  const args = argv.filter((a) => {
    if (a === "--check") {
      check = true;
      return false;
    }
    return true;
  });
  if (args.length !== 1 || (check && args.length !== 1)) {
    console.error("usage: capture-changelog-fixture.mjs [--check] <dist/utils/changelog.js> [out.json]");
    process.exit(2);
  }
  const modulePath = resolve(args[0]);
  const fixture = await capture(modulePath);
  if (check) {
    const committed = JSON.parse(readFileSync(DEFAULT_OUT, "utf8"));
    const drifted =
      fixture.headingRegexSource !== committed.headingRegexSource ||
      JSON.stringify(fixture.goldenEntries) !== JSON.stringify(committed.goldenEntries);
    if (drifted) {
      console.error(`parser drifted against ${DEFAULT_OUT}; recapture deliberately during the host-bump audit`);
      process.exit(1);
    }
    console.log(`OK: ${DEFAULT_OUT} matches the parser in ${modulePath}`);
    return;
  }
  const outPath = resolve(args[1] ?? DEFAULT_OUT);
  writeFileSync(outPath, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`wrote ${outPath} (regex: ${fixture.headingRegexSource}; ${fixture.goldenEntries.length} golden entries)`);
}

main(process.argv.slice(2));
