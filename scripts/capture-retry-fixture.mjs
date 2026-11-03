// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// scripts/capture-retry-fixture.mjs — capture the upstream pi-ai retry
// classifier lists from an installed dist/utils/retry.js into the parity
// fixture consumed by test/util.test.ts.
//
//   node scripts/capture-retry-fixture.mjs <retry.js> <out.json>
//   node scripts/capture-retry-fixture.mjs --check <retry.js>
//
// Capture writes the fixture. --check compares the lists extracted from the
// given retry.js against the committed fixture (ignoring the capture date) and
// exits nonzero on drift, so it belongs in every host-bump audit.
//
// The lists are parsed with the TypeScript AST rather than a text scanner:
// this source contains `])` inside patterns, a single-quoted string literal
// (the Zhipu 1308 pattern), and quoted text inside comments, each of which
// breaks a naive scanner. Anything unexpected (missing declaration, empty
// list, non-literal element) fails hard so an upstream refactor cannot
// produce a silently short fixture.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const FIXTURES_DIR = fileURLToPath(new URL("../test/fixtures/", import.meta.url));
const LIST_NAMES = ["NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN", "RETRYABLE_PROVIDER_ERROR_PATTERN"];
const NOTE =
  "Captured upstream retry classifier lists. test/util.test.ts holds the extension lists to this capture; " +
  "it does not read the installed host. Run scripts/capture-retry-fixture.mjs --check <retry.js> at each " +
  "host bump to detect upstream drift.";

/**
 * Extract the two classifier pattern lists from retry.js source text.
 * Returns them in LIST_NAMES order. Throws on any structural surprise.
 */
export function parseRetryLists(source) {
  const sf = ts.createSourceFile("retry.js", source, ts.ScriptTarget.ES2022, /*setParentNodes*/ true, ts.ScriptKind.JS);
  const found = new Map();
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !LIST_NAMES.includes(decl.name.text)) continue;
      if (found.has(decl.name.text)) {
        throw new Error(`duplicate declaration of ${decl.name.text}`);
      }
      const call = decl.initializer;
      if (
        !call ||
        !ts.isCallExpression(call) ||
        !ts.isIdentifier(call.expression) ||
        call.expression.text !== "buildProviderErrorPattern" ||
        call.arguments.length !== 1
      ) {
        throw new Error(`${decl.name.text} is not a buildProviderErrorPattern([...]) call`);
      }
      const arr = call.arguments[0];
      if (!ts.isArrayLiteralExpression(arr)) {
        throw new Error(`${decl.name.text} argument is not an array literal`);
      }
      const patterns = arr.elements.map((el) => {
        if (ts.isStringLiteral(el) || ts.isNoSubstitutionTemplateLiteral(el)) return el.text;
        throw new Error(`${decl.name.text} contains a non-literal element (${ts.SyntaxKind[el.kind]})`);
      });
      if (patterns.length === 0) {
        throw new Error(`${decl.name.text} list is empty`);
      }
      found.set(decl.name.text, patterns);
    }
  }
  for (const name of LIST_NAMES) {
    if (!found.has(name)) throw new Error(`declaration not found: ${name}`);
  }
  return {
    nonRetryable: found.get(LIST_NAMES[0]),
    retryable: found.get(LIST_NAMES[1]),
  };
}

/** Capture the fixture object for an installed retry.js path. */
export function captureFrom(retryPath) {
  const lists = parseRetryLists(readFileSync(retryPath, "utf8"));
  // The pi-ai package.json sits two levels above dist/utils/retry.js.
  const pkgPath = resolve(dirname(retryPath), "../../package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  return {
    source: `@earendil-works/pi-ai ${pkg.version} dist/utils/retry.js`,
    captured: new Date().toISOString().slice(0, 10),
    note: NOTE,
    ...lists,
  };
}

/** The single committed pi-ai retry fixture; errors if there are several. */
export function discoverFixture() {
  const candidates = readdirSync(FIXTURES_DIR).filter((f) => /^pi-ai-retry-.*\.json$/.test(f));
  if (candidates.length !== 1) {
    throw new Error(`expected exactly one pi-ai-retry-*.json fixture, found: ${candidates.join(", ") || "none"}`);
  }
  return join(FIXTURES_DIR, candidates[0]);
}

function diffList(name, actual, expected) {
  const missing = expected.filter((p) => !actual.includes(p));
  const extra = actual.filter((p) => !expected.includes(p));
  const reordered =
    missing.length === 0 && extra.length === 0 && actual.join("\u0000") !== expected.join("\u0000");
  const lines = [];
  if (missing.length) lines.push(`  missing from committed fixture: ${JSON.stringify(missing)}`);
  if (extra.length) lines.push(`  captured but not in fixture: ${JSON.stringify(extra)}`);
  if (reordered) lines.push("  same patterns, different order");
  if (lines.length) {
    console.error(`${name} drifted:\n${lines.join("\n")}`);
    return true;
  }
  return false;
}

function main(argv) {
  let check = false;
  const args = argv.filter((a) => {
    if (a === "--check") {
      check = true;
      return false;
    }
    return true;
  });
  if (args.length < 1 || args.length > 2 || (check && args.length !== 1)) {
    console.error("usage: capture-retry-fixture.mjs [--check] <retry.js> [out.json]");
    process.exit(2);
  }
  const retryPath = resolve(args[0]);
  if (check) {
    const fixturePath = discoverFixture();
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    const captured = captureFrom(retryPath);
    const drifted =
      diffList("nonRetryable", captured.nonRetryable, fixture.nonRetryable) |
      diffList("retryable", captured.retryable, fixture.retryable);
    if (drifted) {
      console.error(`drift against ${basename(fixturePath)}; recapture deliberately during the host-bump audit`);
      process.exit(1);
    }
    console.log(`OK: ${basename(fixturePath)} matches the lists in ${retryPath}`);
    return;
  }
  const outPath = resolve(args[1] ?? join(FIXTURES_DIR, "pi-ai-retry-NEW.json"));
  const fixture = captureFrom(retryPath);
  writeFileSync(outPath, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`wrote ${outPath} (${fixture.nonRetryable.length} non-retryable, ${fixture.retryable.length} retryable)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
