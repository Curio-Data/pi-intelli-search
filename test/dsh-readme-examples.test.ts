// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// test/dsh-readme-examples.test.ts — Executable validation of the dsh README's
// documented examples (Stage 2B Track F of the README unification plan, and
// the Stage 3 executable-example gate). The dsh view is derived from the
// canonical README through the one derivation entry point, then every Bash
// and JSON fence is held to the plan's executable-example rules: no
// angle-bracket placeholders, literal example variables with quoted uses,
// ShellCheck as a syntax gate, and complete JSON documents. The documented
// complete configuration runs through the strict parser with a temporary
// workspace. No network, no inference and no host installation: ShellCheck
// proves syntax, not that a command is runnable or safe.
import { it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error plain Node module without declarations
import { derivePackageReadme, parseRepoUrl } from "../scripts/generate-package-readmes.mjs";
// @ts-expect-error plain Node module without declarations
import { FENCE, allLinkTargets, closesFence } from "../scripts/lib/markdown-links.mjs";
import { parseConfig } from "../packages/mcp/src/config.js";
import { defaultHostConfig, hostPaths } from "../packages/mcp/src/host.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Repo-derived scratch never goes to an unset-TMPDIR /tmp on this host.
function scratchDir(prefix: string): string {
  const base = process.env.TMPDIR ?? join(REPO_ROOT, ".tmp");
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, prefix));
}

interface Fence {
  readonly info: string;
  readonly lines: string[];
}

/** Extracts fenced code blocks with the generator's own fence definition. */
function extractFences(markdown: string): Fence[] {
  const fences: Fence[] = [];
  let open: { marker: string; info: string; lines: string[] } | undefined;
  for (const line of markdown.split("\n")) {
    if (open) {
      if (closesFence(line, open.marker)) {
        fences.push({ info: open.info, lines: open.lines });
        open = undefined;
      } else open.lines.push(line);
      continue;
    }
    const match = line.match(FENCE);
    if (match) open = { marker: match[1], info: line.slice(match[0].length).trim(), lines: [] };
  }
  return fences;
}

let cachedView: string | undefined;

/** The real dsh README view, derived and validated from the canonical source. */
function dshReadme(): string {
  cachedView ??= derivePackageReadme("dsh", REPO_ROOT);
  return cachedView;
}

interface VariableUse {
  readonly name: string;
  readonly line: number;
  readonly quoted: boolean;
}

/**
 * Finds `$name` and `${name` references with the shell's own quoting rules:
 * single quotes make text literal, backslash escapes outside single quotes,
 * and a reference counts as quoted only inside double quotes. Positional and
 * special parameters carry no name and are left to ShellCheck.
 */
function scanVariableUses(lines: string[]): VariableUse[] {
  const uses: VariableUse[] = [];
  const record = (text: string, position: number, line: number): void => {
    const braced = text[position + 1] === "{";
    const start = position + (braced ? 2 : 1);
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(start))?.[0];
    if (name) uses.push({ name, line, quoted: double });
  };
  let single = false;
  let double = false;
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index];
    let escaped = false;
    for (let position = 0; position < text.length; position++) {
      const character = text[position];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (single) {
        if (character === "'") single = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (double) {
        if (character === '"') double = false;
        else if (character === "$") record(text, position, index + 1);
        continue;
      }
      if (character === "'") single = true;
      else if (character === '"') double = true;
      else if (character === "$") record(text, position, index + 1);
    }
  }
  return uses;
}

// A literal example assignment: name=value where the value is one literal
// word (optionally double-quoted) with no expansion or placeholder.
const ASSIGNMENT = /^\s*([a-z_][a-z0-9_]*)=("?[A-Za-z0-9._/@-]*"?)$/;
// `read ... name` introduces a variable without an assignment.
const READ_ASSIGNMENT = /^\s*(?:IFS= )?read\s.*\s([a-z_][a-z0-9_]*)(?: \|\| exit 1)?$/;

/** Names a fence introduces itself, so its uses stay self-contained. */
function introducedNames(lines: string[]): Set<string> {
  const names = new Set<string>();
  for (const line of lines) {
    const assignment = line.match(ASSIGNMENT);
    if (assignment) {
      names.add(assignment[1]);
      continue;
    }
    const read = line.match(READ_ASSIGNMENT);
    if (read) names.add(read[1]);
  }
  return names;
}

function bashFences(): Fence[] {
  const fences = extractFences(dshReadme()).filter((fence) => fence.info === "bash");
  assert.ok(fences.length > 0, "the dsh view documents at least one Bash fence");
  return fences;
}

const fenceLabel = (index: number, fence: Fence): string =>
  `bash fence ${index} (first line: ${fence.lines[0] ?? "<empty>"})`;

it("dsh Bash fences avoid placeholders and quote literal example variables", () => {
  for (const [index, fence] of bashFences().entries()) {
    const label = fenceLabel(index, fence);
    for (const [offset, line] of fence.lines.entries())
      assert.doesNotMatch(
        line,
        /<[a-z-]+>/,
        `${label}, line ${offset + 1}: angle-bracket placeholder`,
      );
    const introduced = introducedNames(fence.lines);
    for (const use of scanVariableUses(fence.lines)) {
      assert.ok(use.quoted, `${label}, line ${use.line}: $${use.name} must be quoted`);
      // Uppercase names are the reader's environment (HOME, DSH_HOME);
      // lowercase names are example variables the fence must introduce.
      if (/^[A-Z_][A-Z0-9_]*$/.test(use.name)) continue;
      assert.ok(
        introduced.has(use.name),
        `${label}, line ${use.line}: example variable $${use.name} needs a literal assignment in the same fence`,
      );
    }
  }
});

it("the documented setup keeps the entered key off the environment and preserves setup status", () => {
  const fence = bashFences().find((f) => f.lines.some((line) => line.includes("mcp-intelli-search setup")));
  assert.ok(fence);
  const dir = scratchDir("dsh-stdin-");
  try {
    // Replace npx, not the documented pipeline. Never load credentials or call the registry.
    writeFileSync(join(dir, "npx"), `#!/bin/bash
[[ ! -v key && $OPENROUTER_API_KEY == previous ]] || exit 81
IFS= read -r supplied && [[ $supplied == dummy-input ]] || exit 82
exit "$STUB_STATUS"
`, { mode: 0o700 });
    for (const expected of [0, 37]) {
      const result = spawnSync("/bin/bash", ["-c", [
        "set -ax", fence.lines.join("\n"), "status=$?", "set +x",
        "[[ $key == previous-variable && $OPENROUTER_API_KEY == previous ]] || exit 83",
        'exit "$status"',
      ].join("\n")], {
        env: { PATH: dir, key: "previous-variable", OPENROUTER_API_KEY: "previous", STUB_STATUS: String(expected) },
        input: "dummy-input\n", encoding: "utf8",
      });
      assert.equal(result.status, expected, result.stderr);
      assert.doesNotMatch(result.stdout + result.stderr, /dummy-input/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("every dsh Bash fence passes shellcheck as a syntax gate", () => {
  const dir = scratchDir("dsh-fences-");
  try {
    for (const [index, fence] of bashFences().entries()) {
      const file = join(dir, `fence-${index}.sh`);
      writeFileSync(file, `${fence.lines.join("\n")}\n`);
      const result = spawnSync("shellcheck", ["--shell=bash", file], { encoding: "utf8" });
      assert.notEqual(result.status, null, "shellcheck must be installed for this gate");
      assert.equal(
        result.status,
        0,
        `${fenceLabel(index, fence)} failed shellcheck:\n${result.stdout}${result.stderr}`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("every dsh repository file link targets a tracked file", () => {
  const paths = new Set<string>();
  for (const url of allLinkTargets(dshReadme())) {
    const target = parseRepoUrl(url);
    if (target && target.kind !== "tree") paths.add(target.path);
  }
  assert.ok(paths.size > 0);
  for (const path of paths) {
    assert.doesNotThrow(
      () => execFileSync("git", ["ls-files", "--error-unmatch", path], { cwd: REPO_ROOT, stdio: "ignore" }),
      `${path} must be tracked; a build-created local file does not make a published link resolve`,
    );
  }
});

it("every unlabelled dsh JSON fence is a complete document", () => {
  const fences = extractFences(dshReadme()).filter((fence) => fence.info === "json");
  assert.ok(fences.length > 0, "the dsh view documents at least one JSON fence");
  for (const [index, fence] of fences.entries())
    assert.doesNotThrow(
      () => JSON.parse(fence.lines.join("\n")),
      `json fence ${index} (first line: ${fence.lines[0] ?? "<empty>"}) is not a complete document; a fragment must be labelled so it is not parsed here`,
    );
});

/** The complete strict configuration examples: providers, models and tuning. */
function completeConfigurations(): Record<string, unknown>[] {
  return extractFences(dshReadme())
    .filter((fence) => fence.info === "json")
    .map((fence) => JSON.parse(fence.lines.join("\n")) as Record<string, unknown>)
    .filter((value) => value.providers && value.models && value.tuning);
}

it("the documented complete configuration parses strictly with an existing workspace", async () => {
  const examples = completeConfigurations();
  assert.equal(examples.length, 1, "exactly one complete configuration example");
  const dir = scratchDir("dsh-config-");
  try {
    const parsed = await parseConfig(examples[0], dir);
    assert.equal(parsed.apiKeyEnv, "OPENROUTER_API_KEY");
    // The example carries no apiKeyFile: host mode injects the default path.
    assert.equal(parsed.apiKeyFile, undefined);
    assert.deepEqual(parsed.settings.searchModel, {
      provider: "openrouter",
      model: "perplexity/sonar",
    });
    assert.deepEqual(parsed.settings.extractModel, {
      provider: "openrouter",
      model: "minimax/minimax-m3",
    });
    assert.deepEqual(parsed.settings.collateModel, {
      provider: "openrouter",
      model: "minimax/minimax-m3",
    });
    // Per query, including each batch member: default five search-result pages, capped at eight.
    assert.equal(parsed.settings.defaultUrls, 5);
    assert.equal(parsed.settings.maxUrls, 8);
    // Untouched defaults the same page states: a 120-second model-call
    // timeout, three retry attempts, two output-budget retries, four
    // concurrent extractions, no request throttle, the .search cache,
    // telemetry on and llms-full discovery on.
    assert.equal(parsed.settings.llmTimeoutMs, 120_000);
    assert.equal(parsed.settings.llmRetryAttempts, 3);
    assert.equal(parsed.settings.outputBudgetRetries, 2);
    assert.equal(parsed.settings.extractionConcurrency, 4);
    assert.equal(parsed.settings.minRequestIntervalMs, 0);
    assert.equal(parsed.settings.cacheDir, ".search");
    assert.equal(parsed.settings.disableTelemetry, false);
    assert.equal(parsed.settings.disableLlmsFullDiscovery, false);
    assert.equal(parsed.settings.searchWebSearch.enabled, false);
    assert.equal(parsed.workspace, realpathSync(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("a partial model-role document is rejected", async () => {
  const [example] = completeConfigurations();
  assert.ok(example);
  const models = example.models as Record<string, unknown>;
  const dir = scratchDir("dsh-config-reject-");
  try {
    const partial = {
      ...example,
      models: { search: models.search, extract: models.extract },
    };
    await assert.rejects(parseConfig(partial, dir), /models\.collate/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("the documented built-in dsh defaults are the launcher defaults", async () => {
  const home = scratchDir("dsh-defaults-");
  const workspace = join(home, "project");
  mkdirSync(join(home, "xdg"), { recursive: true });
  mkdirSync(workspace, { recursive: true });
  try {
    const paths = hostPaths({ HOME: home, XDG_CONFIG_HOME: join(home, "xdg") });
    const parsed = await defaultHostConfig("dsh", workspace, paths);
    // The Configuration section: with no per-user file, OpenRouter for every
    // role, Sonar search, MiniMax M3 extraction and collation, ten pages per
    // research call and a cap of twenty.
    assert.deepEqual(parsed.settings.searchModel, {
      provider: "openrouter",
      model: "perplexity/sonar",
    });
    assert.deepEqual(parsed.settings.extractModel, {
      provider: "openrouter",
      model: "minimax/minimax-m3",
    });
    assert.deepEqual(parsed.settings.collateModel, {
      provider: "openrouter",
      model: "minimax/minimax-m3",
    });
    assert.equal(parsed.settings.defaultUrls, 10);
    assert.equal(parsed.settings.maxUrls, 20);
    assert.equal(parsed.apiKeyEnv, "OPENROUTER_API_KEY");
    assert.equal(parsed.apiKeyFile, paths.credential);
    assert.equal(parsed.workspace, realpathSync(workspace));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
