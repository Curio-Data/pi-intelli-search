// test/plugin-bundles.test.ts — Deterministic tests for the generated
// Claude Code and Codex plugin bundles, repository marketplaces and the
// generator's drift check. No network, no host CLIs.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error plain Node module without declarations
import {
  checkAgainstRepo,
  generateFiles,
  launcherFor,
  readMcpPackage,
  writeTree,
} from "../scripts/generate-plugin-bundles.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GENERATOR = join(REPO_ROOT, "scripts", "generate-plugin-bundles.mjs");

// Repo-derived scratch never goes to an unset-TMPDIR /tmp on this host.
function scratchDir(prefix: string) {
  const base = process.env.TMPDIR ?? join(REPO_ROOT, ".tmp");
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, prefix));
}

const ALL_PATHS = [
  "plugins/claude-code/.claude-plugin/plugin.json",
  "plugins/claude-code/.mcp.json",
  "plugins/claude-code/skills/intelli-search/SKILL.md",
  "plugins/codex/.codex-plugin/plugin.json",
  "plugins/codex/.mcp.json",
  "plugins/codex/skills/intelli-search/SKILL.md",
  ".claude-plugin/marketplace.json",
  ".agents/plugins/marketplace.json",
];

function parse(files: Record<string, string>, path: string) {
  return JSON.parse(files[path]) as Record<string, unknown>;
}

describe("plugin bundle generation", () => {
  const files = generateFiles() as Record<string, string>;
  const mcpPkg = readMcpPackage() as { name: string; version: string };

  it("produces exactly the expected file set", () => {
    assert.deepStrictEqual(Object.keys(files).sort(), ALL_PATHS.sort());
  });

  it("pins the exact MCP package version in both npx launchers", () => {
    for (const path of [
      "plugins/claude-code/.mcp.json",
      "plugins/codex/.mcp.json",
    ]) {
      const server = (parse(files, path).mcpServers as Record<string, never>)[
        "intelli_search"
      ] as { command: string; args: string[] };
      assert.strictEqual(server.command, "npx");
      assert.deepStrictEqual(server.args, [
        "-y",
        "--package",
        `${mcpPkg.name}@${mcpPkg.version}`,
        "mcp-intelli-search",
      ]);
    }
  });

  it("mirrors the MCP package version into both plugin manifests", () => {
    for (const path of [
      "plugins/claude-code/.claude-plugin/plugin.json",
      "plugins/codex/.codex-plugin/plugin.json",
    ]) {
      assert.strictEqual(parse(files, path).version, mcpPkg.version);
    }
  });

  it("keeps marketplace entries free of sibling checkout paths and versions", () => {
    const claude = parse(files, ".claude-plugin/marketplace.json");
    const codex = parse(files, ".agents/plugins/marketplace.json");
    assert.strictEqual(claude.name, "curio-data-plugins");
    assert.strictEqual(codex.name, "curio-data-plugins");
    const claudeEntry = (claude.plugins as never[])[0] as Record<string, unknown>;
    const codexEntry = (codex.plugins as never[])[0] as Record<string, unknown>;
    assert.strictEqual(claudeEntry.source, "./plugins/claude-code");
    assert.deepStrictEqual(codexEntry.source, {
      source: "local",
      path: "./plugins/codex",
    });
    assert.strictEqual(claudeEntry.version, undefined);
    assert.strictEqual(codexEntry.version, undefined);
  });

  it("declares the Codex compatibility layout with env_vars forwarding", () => {
    const manifest = parse(files, "plugins/codex/.codex-plugin/plugin.json");
    assert.strictEqual(manifest.mcpServers, "./.mcp.json");
    const server = (parse(files, "plugins/codex/.mcp.json").mcpServers as never)[
        "intelli_search"
    ] as Record<string, unknown>;
    assert.deepStrictEqual(server.env_vars, [
      "OPENROUTER_API_KEY",
      "INTELLI_SEARCH_CONFIG",
      "INTELLI_SEARCH_WORKSPACE",
    ]);
    assert.strictEqual(server.type, undefined);
    assert.strictEqual(server.env, undefined);
  });

  it("uses plugin-data and project-dir expansion in the Claude Code launcher", () => {
    const server = (parse(files, "plugins/claude-code/.mcp.json").mcpServers as never)[
        "intelli_search"
    ] as Record<string, unknown>;
    assert.deepStrictEqual(server.env, {
      INTELLI_SEARCH_CONFIG: "${CLAUDE_PLUGIN_DATA}/config.json",
      INTELLI_SEARCH_WORKSPACE: "${CLAUDE_PROJECT_DIR}",
    });
  });

  it("declares Codex interface capabilities that include writes", () => {
    const manifest = parse(files, "plugins/codex/.codex-plugin/plugin.json");
    const iface = manifest.interface as { capabilities: string[] };
    // research and collate write cache files; a Read-only claim would
    // contradict the tool annotations (Phase 4 requirement).
    assert.deepStrictEqual(iface.capabilities, ["Read", "Write"]);
  });

  it("qualifies tool names per host in the generated skills", () => {
    const claude = files["plugins/claude-code/skills/intelli-search/SKILL.md"];
    const codex = files["plugins/codex/skills/intelli-search/SKILL.md"];
    for (const op of [
      "intelli_search",
      "intelli_extract",
      "intelli_collate",
      "intelli_research",
    ]) {
      assert.ok(
        claude.includes(`mcp__plugin_intelli-search_intelli_search__${op}`),
        `claude skill missing qualified ${op}`,
      );
      assert.ok(
        codex.includes(`mcp__intelli_search__${op}`),
        `codex skill missing qualified ${op}`,
      );
    }
    assert.ok(!codex.includes("mcp__plugin_"), "codex skill uses Claude naming");
    assert.ok(
      !codex.includes("mcp__intelli-search__"),
      "codex skill uses the hyphen server name that Codex normalizes away",
    );
  });

  it("carries the required guidance in both skills", () => {
    for (const host of ["claude-code", "codex"]) {
      const skill = files[`plugins/${host}/skills/intelli-search/SKILL.md`];
      assert.ok(skill.includes("focusPrompt"), `${host}: focusPrompt guidance`);
      assert.ok(skill.includes("`10` (default)"), `${host}: correct maxUrls default`);
      assert.ok(
        skill.includes("file-reading"),
        `${host}: host-neutral file-reading wording`,
      );
      assert.ok(!skill.includes("{{"), `${host}: no unreplaced tokens`);
      assert.ok(!skill.includes("\u2014"), `${host}: no typographic em dash`);
      assert.ok(
        skill.startsWith("---\nname: intelli-search\n"),
        `${host}: frontmatter name`,
      );
    }
  });

  it("does not propagate the stale native maxUrls schema default", () => {
    // The frozen native schema description says "default: 8" while the
    // shared default is 10; generated guidance must describe 10/20 only.
    for (const host of ["claude-code", "codex"]) {
      const skill = files[`plugins/${host}/skills/intelli-search/SKILL.md`];
      assert.ok(!skill.includes("default 8"), `${host}: stale default absent`);
    }
  });

  it("never references repository-relative paths in registry mode", () => {
    for (const [path, content] of Object.entries(files)) {
      assert.ok(!content.includes("../../src"), `${path} references src/`);
      assert.ok(!content.includes(REPO_ROOT), `${path} embeds the checkout path`);
    }
  });

  it("requires a vendor directory for Codex tarball mode", () => {
    assert.throws(() => launcherFor("codex", "tarball", mcpPkg, undefined));
  });

  it("switches both launchers to node in tarball mode", () => {
    const claude = launcherFor("claude-code", "tarball", mcpPkg, undefined) as {
      command: string;
      args: string[];
    };
    assert.strictEqual(claude.command, "node");
    assert.ok(
      claude.args[0].startsWith("${CLAUDE_PLUGIN_ROOT}/vendor/node_modules/"),
    );
    const codex = launcherFor("codex", "tarball", mcpPkg, "/abs/vendor") as {
      command: string;
      args: string[];
    };
    assert.strictEqual(codex.command, "node");
    assert.ok(
      codex.args[0].startsWith(
        "/abs/vendor/node_modules/@curio-data/mcp-intelli-search/",
      ),
    );
  });
});

describe("plugin bundle drift check", () => {
  it("committed tree matches generator output", () => {
    const out = execFileSync("node", [GENERATOR, "--check"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    assert.ok(out.includes("match"));
  });

  it("tarball mode writes a self-contained tree into the output directory", () => {
    const scratch = scratchDir("plugin-bundles-tarball-");
    try {
      execFileSync("node", [
        GENERATOR,
        "--mode",
        "tarball",
        "--output",
        scratch,
        "--codex-vendor-dir",
        join(scratch, "plugins/codex/vendor"),
      ]);
      const claudeMcp = JSON.parse(
        readFileSync(join(scratch, "plugins/claude-code/.mcp.json"), "utf8"),
      );
      assert.strictEqual(
        claudeMcp.mcpServers["intelli_search"].command,
        "node",
      );
      const codexMcp = JSON.parse(
        readFileSync(join(scratch, "plugins/codex/.mcp.json"), "utf8"),
      );
      assert.ok(
        codexMcp.mcpServers["intelli_search"].args[0].startsWith(
          join(scratch, "plugins/codex/vendor"),
        ),
      );
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("check fails on a committed file the generator does not produce", () => {
    // Bidirectional drift gate: build a fake root holding the real guidance
    // and package metadata, generate the tree, add a stray file, and assert
    // the check reports it (regression: the one-directional gate passed with
    // stray files present).
    const fake = scratchDir("plugin-bundles-stray-");
    try {
      mkdirSync(join(fake, "packages/mcp"), { recursive: true });
      writeFileSync(
        join(fake, "packages/mcp/package.json"),
        readFileSync(join(REPO_ROOT, "packages/mcp/package.json")),
      );
      execFileSync("cp", ["-r", join(REPO_ROOT, "guidance"), join(fake, "guidance")]);
      writeTree(generateFiles("registry", {}, fake), fake);
      assert.deepStrictEqual(checkAgainstRepo(fake), []);
      writeFileSync(join(fake, "plugins/claude-code/STRAY.txt"), "stray");
      const problems = checkAgainstRepo(fake) as string[];
      assert.strictEqual(problems.length, 1);
      assert.ok(problems[0].includes("STRAY.txt"));
      assert.ok(problems[0].includes("unexpected committed file"));
    } finally {
      rmSync(fake, { recursive: true, force: true });
    }
  });
});
