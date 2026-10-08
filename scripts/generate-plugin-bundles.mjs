#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// scripts/generate-plugin-bundles.mjs
//
// Generates the Claude Code and Codex plugin bundles plus the two
// repository marketplace catalogs from the shared guidance source in
// guidance/ and the version pinned in packages/mcp/package.json.
//
// Modes:
//   (default)          Write the registry-mode tree into the repository:
//                      launchers pin an exact @curio-data/mcp-intelli-search
//                      version resolved through npx.
//   --check            Regenerate into a temporary directory and diff
//                      against the committed tree; exit 1 on drift.
//   --mode tarball --output DIR --codex-vendor-dir ABS
//                      Pre-publication test mode: write a self-contained
//                      tree into DIR whose launchers run a locally vendored
//                      tarball install instead of the registry. Claude Code
//                      resolves ${CLAUDE_PLUGIN_ROOT}; Codex performs no
//                      expansion, so its launcher embeds the absolute vendor
//                      directory passed here.
//
// Host behavior verified empirically during the 0.15.0 host-plugin verification:
//   Claude Code v2.1.289: full environment inheritance; ${CLAUDE_PLUGIN_ROOT},
//     ${CLAUDE_PLUGIN_DATA}, ${CLAUDE_PROJECT_DIR} and arbitrary ${VAR}
//     expand in plugin MCP env values; tools are named
//     mcp__plugin_<plugin>_<server>__<tool>.
//   Claude Code v2.1.289 userConfig: a sensitive option is stored under
//     pluginSecrets in ~/.claude/.credentials.json on Linux (the host's
//     credential store elsewhere) and substituted by
//     ${user_config.<key>}. An unset optional option substitutes an empty
//     string that overrides any inherited variable, and the reference has no
//     ${...:-fallback} form, so the key option is required: the host does not
//     start the server until it is set.
//   Codex CLI 0.144.5: only the compatibility layout (.codex-plugin/plugin.json
//     plus legacy .mcp.json) loads; the portable mcp.json is ignored; no
//     placeholder expansion and no parent-environment inheritance except an
//     allowlist; env_vars forwards named parent variables; tools are named
//     mcp__<server>__<tool>.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Server key is intelli_search (underscore): Codex normalizes hyphens in
// server names to underscores in its tool catalog, so an underscore key keeps
// the declared and observed tool names identical on both hosts.
const SERVER_NAME = "intelli_search";
const PLUGIN_NAME = "intelli-search";
const MARKETPLACE_NAME = "curio-data-plugins";
const VENDOR_CLI_SUFFIX =
  "vendor/node_modules/@curio-data/mcp-intelli-search/dist/cli.js";

const DESCRIPTION =
  "Research the web with a five-stage pipeline (search, fetch, extract, " +
  "collate, cache suggest) served over MCP by @curio-data/mcp-intelli-search.";

// Claude Code supplies the provider key through a required sensitive
// userConfig option; the configuration file names OPENROUTER_API_KEY.
const API_KEY_OPTION = "openrouter_api_key";

const SKILL_DESCRIPTION =
  "Load before calling any intelli_search, intelli_research, intelli_extract " +
  "or intelli_collate tool, including requests to use intelli search. " +
  "Use for current web information, documentation and API verification. " +
  "Start with intelli_search for quick facts, latest versions and release " +
  "dates; reserve intelli_research for multi-page analysis and comparisons. " +
  "Includes tool selection, focused extraction, cache use and setup. " +
  "Report unavailable tools explicitly; never claim another search used this server.";

export function readMcpPackage(root = REPO_ROOT) {
  const manifest = JSON.parse(
    readFileSync(join(root, "packages/mcp/package.json"), "utf8"),
  );
  return { name: manifest.name, version: manifest.version };
}

/** Launcher argv per host and mode. */
export function launcherFor(host, mode, mcpPkg, codexVendorDir) {
  if (mode === "tarball") {
    if (host === "claude-code") {
      return {
        command: "node",
        args: [`\${CLAUDE_PLUGIN_ROOT}/${VENDOR_CLI_SUFFIX}`],
      };
    }
    if (!codexVendorDir) {
      throw new Error("tarball mode for codex requires --codex-vendor-dir");
    }
    return {
      command: "node",
      args: [`${codexVendorDir}/node_modules/@curio-data/mcp-intelli-search/dist/cli.js`],
    };
  }
  return {
    command: "npx",
    args: [
      "-y",
      "--package",
      `${mcpPkg.name}@${mcpPkg.version}`,
      "mcp-intelli-search",
    ],
  };
}

function renderSkill(host, root = REPO_ROOT) {
  const toolPrefix =
    host === "claude-code"
      ? `mcp__plugin_${PLUGIN_NAME}_${SERVER_NAME}__`
      : `mcp__${SERVER_NAME}__`;
  const hostLabel = host === "claude-code" ? "Claude Code" : "Codex";
  const cacheReadHint =
    host === "claude-code"
      ? "Use the `Read` tool, this host's file-reading capability."
      : "Read those files with available shell or file-reading tools.";
  const setup = readFileSync(
    join(root, "guidance", `setup-${host}.md`),
    "utf8",
  ).trim();
  const body = readFileSync(join(root, "guidance", "research-guide.md"), "utf8")
    .replaceAll("{{TOOL_SEARCH}}", `${toolPrefix}intelli_search`)
    .replaceAll("{{TOOL_EXTRACT}}", `${toolPrefix}intelli_extract`)
    .replaceAll("{{TOOL_COLLATE}}", `${toolPrefix}intelli_collate`)
    .replaceAll("{{TOOL_RESEARCH}}", `${toolPrefix}intelli_research`)
    .replaceAll("{{SETUP}}", `${setup}\n`)
    .replaceAll("{{CACHE_READ_HINT}}", cacheReadHint)
    .replaceAll("{{HOST}}", hostLabel);
  if (body.includes("{{") || body.includes("}}")) {
    throw new Error(`unreplaced token remains in ${host} skill`);
  }
  return (
    `---\nname: ${PLUGIN_NAME}\ndescription: "${SKILL_DESCRIPTION}"\n---\n\n` +
    body
  );
}

function jsonBlock(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Computes every generated file as a map of repo-relative path to content.
 * Pure: performs no I/O beyond reading guidance/ and package metadata.
 */
export function generateFiles(mode = "registry", options = {}, root = REPO_ROOT) {
  const mcpPkg = readMcpPackage(root);
  const codexVendorDir = options.codexVendorDir;
  const claudeLauncher = launcherFor("claude-code", mode, mcpPkg, codexVendorDir);
  const codexLauncher = launcherFor("codex", mode, mcpPkg, codexVendorDir);

  const claudePluginManifest = {
    name: PLUGIN_NAME,
    displayName: "Intelli Search",
    version: mcpPkg.version,
    description: DESCRIPTION,
    author: {
      name: "Curio Data Pro Ltd",
      url: "https://github.com/Curio-Data",
    },
    homepage: "https://github.com/Curio-Data/pi-intelli-search",
    repository: "https://github.com/Curio-Data/pi-intelli-search",
    license: "Apache-2.0",
    keywords: ["research", "web-search", "documentation", "mcp"],
    userConfig: {
      [API_KEY_OPTION]: {
        type: "string",
        title: "OpenRouter API key",
        description:
          "OpenRouter key for the search, extract and collate stages. " +
          "Stored in the Claude Code credential store and passed to the " +
          "server as OPENROUTER_API_KEY.",
        sensitive: true,
        required: true,
      },
    },
  };

  const claudeMcp = {
    mcpServers: {
      [SERVER_NAME]: {
        command: claudeLauncher.command,
        args: claudeLauncher.args,
        env: {
          OPENROUTER_API_KEY: `\${user_config.${API_KEY_OPTION}}`,
          INTELLI_SEARCH_CONFIG: "${CLAUDE_PLUGIN_DATA}/config.json",
          INTELLI_SEARCH_WORKSPACE: "${CLAUDE_PROJECT_DIR}",
        },
      },
    },
  };

  const codexPluginManifest = {
    name: PLUGIN_NAME,
    version: mcpPkg.version,
    description: DESCRIPTION,
    author: {
      name: "Curio Data Pro Ltd",
      url: "https://github.com/Curio-Data",
    },
    homepage: "https://github.com/Curio-Data/pi-intelli-search",
    repository: "https://github.com/Curio-Data/pi-intelli-search",
    license: "Apache-2.0",
    keywords: ["research", "web-search", "documentation", "mcp"],
    mcpServers: "./.mcp.json",
    interface: {
      displayName: "Intelli Search",
      shortDescription: "Intelligent web research",
      longDescription:
        "Research the web with a five-stage pipeline: search, fetch, " +
        "per-page extraction, collation and cache suggestions. Serves the " +
        "four intelli_* tools over MCP from the pinned " +
        "@curio-data/mcp-intelli-search package.",
      developerName: "Curio Data Pro Ltd",
      category: "Developer Tools",
      capabilities: ["Read", "Write"],
      websiteURL: "https://github.com/Curio-Data/pi-intelli-search",
    },
  };

  const codexMcp = {
    mcpServers: {
      [SERVER_NAME]: {
        command: codexLauncher.command,
        args: codexLauncher.args,
        env_vars: [
          "OPENROUTER_API_KEY",
          "INTELLI_SEARCH_CONFIG",
          "INTELLI_SEARCH_WORKSPACE",
        ],
      },
    },
  };

  const claudeMarketplace = {
    name: MARKETPLACE_NAME,
    description:
      "Curio Data plugins: intelligent web research for coding agents.",
    owner: {
      name: "Curio Data Pro Ltd",
      url: "https://github.com/Curio-Data",
    },
    plugins: [
      {
        name: PLUGIN_NAME,
        source: "./plugins/claude-code",
        description: DESCRIPTION,
        category: "research",
        tags: ["research", "web-search", "documentation", "mcp"],
      },
    ],
  };

  const codexMarketplace = {
    name: MARKETPLACE_NAME,
    interface: { displayName: "Curio Data Plugins" },
    plugins: [
      {
        name: PLUGIN_NAME,
        source: { source: "local", path: "./plugins/codex" },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Developer Tools",
      },
    ],
  };

  return {
    "plugins/claude-code/.claude-plugin/plugin.json": jsonBlock(claudePluginManifest),
    "plugins/claude-code/.mcp.json": jsonBlock(claudeMcp),
    "plugins/claude-code/skills/intelli-search/SKILL.md": renderSkill("claude-code", root),
    "plugins/codex/.codex-plugin/plugin.json": jsonBlock(codexPluginManifest),
    "plugins/codex/.mcp.json": jsonBlock(codexMcp),
    "plugins/codex/skills/intelli-search/SKILL.md": renderSkill("codex", root),
    ".claude-plugin/marketplace.json": jsonBlock(claudeMarketplace),
    ".agents/plugins/marketplace.json": jsonBlock(codexMarketplace),
  };
}

export function writeTree(files, base) {
  for (const [rel, content] of Object.entries(files)) {
    const target = join(base, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

function listFiles(base) {
  const out = execFileSync("find", [".", "-type", "f"], {
    cwd: base,
    encoding: "utf8",
  });
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => line.replace(/^\.\//, ""))
    .sort();
}

// Directories whose committed contents must be exactly the generated set.
const GENERATED_ROOTS = [
  "plugins/claude-code",
  "plugins/codex",
  ".claude-plugin",
  ".agents/plugins",
];

// Scratch stays on the encrypted repository filesystem when TMPDIR is not
// set (this host forbids repo-derived bytes in /tmp); tests and CI can
// redirect with TMPDIR.
function scratchRoot(root = REPO_ROOT) {
  return process.env.TMPDIR ? tmpdir() : join(root, ".tmp");
}

export function checkAgainstRepo(root = REPO_ROOT) {
  mkdirSync(join(scratchRoot(root)), { recursive: true });
  const scratch = mkdtempSync(join(scratchRoot(root), "plugin-bundles-check-"));
  try {
    writeTree(generateFiles("registry", {}, root), scratch);
    const expected = listFiles(scratch);
    const problems = [];
    for (const rel of expected) {
      const committed = join(root, rel);
      if (!existsSync(committed)) {
        problems.push(`missing committed file: ${rel}`);
        continue;
      }
      if (readFileSync(committed, "utf8") !== readFileSync(join(scratch, rel), "utf8")) {
        problems.push(`drift: ${rel} differs from generator output`);
      }
    }
    // Reverse direction: a committed file the generator does not produce
    // would ship to both hosts silently (stray vendor trees, editor backups,
    // misplaced credentials), so enumerate the generated roots as well.
    // --check only supports the committed registry tree, so vendored
    // directories count as unexpected files here by construction.
    const expectedSet = new Set(expected);
    for (const dir of GENERATED_ROOTS) {
      const committedDir = join(root, dir);
      if (!existsSync(committedDir)) {
        problems.push(`missing generated root: ${dir}`);
        continue;
      }
      for (const rel of listFiles(committedDir)) {
        const full = `${dir}/${rel}`;
        if (!expectedSet.has(full)) {
          problems.push(`unexpected committed file not produced by the generator: ${full}`);
        }
      }
    }
    return problems;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const args = { mode: "registry", output: undefined, codexVendorDir: undefined, check: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--check") args.check = true;
    else if (arg === "--mode") args.mode = argv[++i];
    else if (arg === "--output") args.output = argv[++i];
    else if (arg === "--codex-vendor-dir") args.codexVendorDir = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!["registry", "tarball"].includes(args.mode)) {
    throw new Error(`unknown mode: ${args.mode}`);
  }
  if (args.mode === "tarball" && !args.output) {
    throw new Error("tarball mode requires --output DIR");
  }
  if (args.check && (args.mode !== "registry" || args.output)) {
    throw new Error("--check only supports the committed registry tree");
  }
  return args;
}

function main() {
  if (process.argv.length === 3 && process.argv[2] === "--help") {
    console.log(`Usage: node scripts/generate-plugin-bundles.mjs [--check | --mode tarball --output DIR --codex-vendor-dir ABS]

No arguments: regenerate the tracked registry launchers and marketplaces.
--check: detect drift without changing tracked files.
--mode tarball: generate test launchers (requires both directory arguments).

Build and npm pack the MCP workspace first; install that tarball into both
vendor directories before installing the generated marketplaces.
See scripts/README.md for the generator reference and the tested install flow.`);
    return;
  }
  const args = parseArgs(process.argv.slice(2));
  if (args.check) {
    const problems = checkAgainstRepo();
    if (problems.length > 0) {
      for (const problem of problems) console.error(problem);
      console.error("run scripts/generate-plugin-bundles.mjs to regenerate");
      process.exit(1);
    }
    console.log("plugin bundles match generator output");
    return;
  }
  const base = args.mode === "tarball" ? args.output : REPO_ROOT;
  writeTree(generateFiles(args.mode, { codexVendorDir: args.codexVendorDir }), base);
  console.log(`generated ${args.mode} plugin bundles in ${base}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
