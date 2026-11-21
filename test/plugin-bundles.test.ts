// test/plugin-bundles.test.ts — Deterministic tests for the generated
// Claude Code, Codex and DeepSeek Harness (dsh) plugin bundles, repository
// marketplaces, the dsh skill registrar and the generator's drift check.
// No network, no host CLIs.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
// @ts-expect-error plain Node module without declarations
import {
  checkAgainstRepo,
  DSH_TESTED_VERSION,
  generateFiles,
  launcherFor,
  readMcpPackage,
  writeTree,
} from "../scripts/generate-plugin-bundles.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GENERATOR = join(REPO_ROOT, "scripts", "generate-plugin-bundles.mjs");

it("generator help describes tarball prerequisites without changing output", () => {
  const before = readFileSync(join(REPO_ROOT, "plugins/codex/.mcp.json"), "utf8");
  const help = execFileSync(process.execPath, [GENERATOR, "--help"], { encoding: "utf8" });
  assert.match(help, /--output DIR --codex-vendor-dir ABS/);
  assert.match(help, /npm pack/);
  assert.equal(readFileSync(join(REPO_ROOT, "plugins/codex/.mcp.json"), "utf8"), before);
});

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
  "plugins/dsh/package.json",
  "plugins/dsh/cordis.patch.yml",
  "plugins/dsh/index.js",
  "plugins/dsh/skills/intelli-search/SKILL.md",
  "plugins/dsh/locale/en.json",
  "plugins/dsh/locale/zh.json",
  "plugins/dsh/icon.svg",
  "plugins/dsh/README.md",
  "plugins/dsh/LICENSE",
];

const DSH_PATHS = ALL_PATHS.filter((path) => path.startsWith("plugins/dsh/"));

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
        ...(path.includes("codex") ? ["--host", "codex"] : []),
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
    assert.deepStrictEqual(server.env_vars, ["OPENROUTER_API_KEY", "XDG_CONFIG_HOME"]);
    assert.deepStrictEqual(server.args.slice(-2), ["--host", "codex"]);
    assert.strictEqual(server.type, undefined);
    assert.strictEqual(server.env, undefined);
  });

  it("uses plugin-data and project-dir expansion in the Claude Code launcher", () => {
    const server = (parse(files, "plugins/claude-code/.mcp.json").mcpServers as never)[
        "intelli_search"
    ] as Record<string, unknown>;
    assert.deepStrictEqual(server.env, {
      OPENROUTER_API_KEY: "${user_config.openrouter_api_key}",
      INTELLI_SEARCH_CONFIG: "${CLAUDE_PLUGIN_DATA}/config.json",
      INTELLI_SEARCH_WORKSPACE: "${CLAUDE_PROJECT_DIR}",
    });
  });

  it("declares the Claude Code key as a required sensitive option", () => {
    // An unset optional option substitutes an empty string that overrides
    // an inherited key, so the option must stay required.
    const manifest = parse(files, "plugins/claude-code/.claude-plugin/plugin.json");
    const option = (manifest.userConfig as Record<string, Record<string, unknown>>)
      .openrouter_api_key;
    assert.strictEqual(option.type, "string");
    assert.strictEqual(option.sensitive, true);
    assert.strictEqual(option.required, true);
    assert.strictEqual(option.default, undefined);
  });

  it("keeps credential values out of every generated file", () => {
    // The drift check below makes generated output equal the committed tree.
    for (const path of ALL_PATHS) {
      assert.ok(!/sk-(or-v1-[0-9a-f]{16,}|ant-[A-Za-z0-9_-]{20,})/.test(files[path]), `${path} carries a key value`);
    }
    const codex = parse(files, "plugins/codex/.codex-plugin/plugin.json");
    assert.strictEqual(codex.userConfig, undefined);
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
    const dsh = files["plugins/dsh/skills/intelli-search/SKILL.md"];
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
      assert.ok(
        dsh.includes(`mcp__intelli__${op}`),
        `dsh skill missing qualified ${op}`,
      );
    }
    assert.ok(!codex.includes("mcp__plugin_"), "codex skill uses Claude naming");
    assert.ok(
      !codex.includes("mcp__intelli-search__"),
      "codex skill uses the hyphen server name that Codex normalizes away",
    );
    assert.ok(!dsh.includes("mcp__plugin_"), "dsh skill uses Claude naming");
    assert.ok(
      !dsh.includes("mcp__intelli_search__"),
      "dsh skill uses the two-host server name instead of the D1 choice intelli",
    );
    assert.ok(!dsh.includes("{{"), "dsh skill has unreplaced tokens");
    assert.match(dsh, /DeepSeek Harness/, "dsh skill names its host");
    assert.match(
      dsh,
      /Use the `read` tool, this host's file-reading capability\./,
      "dsh skill carries its cache read hint",
    );
  });

  it("carries the required guidance in both skills", () => {
    for (const host of ["claude-code", "codex", "dsh"]) {
      const skill = files[`plugins/${host}/skills/intelli-search/SKILL.md`];
      assert.ok(skill.includes("focusPrompt"), `${host}: focusPrompt guidance`);
      assert.ok(skill.includes("`10` (default)"), `${host}: correct maxUrls default`);
      assert.ok(
        skill.includes("file-reading"),
        `${host}: host-neutral file-reading wording`,
      );
      assert.match(skill, /Archiving is best-effort/, `${host}: no retention guarantee`);
      assert.match(skill, /new run can replace the canonical files in place/, `${host}: archive fallback disclosed`);
      assert.match(skill, /Harvesting is best-effort, not a complete record of sources consulted/, `${host}: citation scope`);
      assert.match(skill, /pipeline awaits the judge/, `${host}: supplementary-stage latency`);
      assert.match(skill, /`details\.cachePath`/, `${host}: custom cache paths supported`);
      assert.match(skill, /pass catalogue validation for the required roles/, `${host}: model capability limits`);
      assert.ok(!skill.includes("your shell"), `${host}: host-neutral register`);
      assert.ok(!skill.includes("{{"), `${host}: no unreplaced tokens`);
      assert.ok(!skill.includes("\u2014"), `${host}: no typographic em dash`);
      assert.ok(
        skill.startsWith("---\nname: intelli-search\n"),
        `${host}: frontmatter name`,
      );
    }
  });

  it("explains zero-configuration Codex startup and persistent credentials", () => {
    const skill = files["plugins/codex/skills/intelli-search/SKILL.md"];
    assert.match(skill, /No path or credential exports are required/);
    assert.match(skill, /four tools start even when credentials are absent/);
    assert.match(skill, /mcp-intelli-search setup/);
    assert.match(skill, /next tool call reads a new or replacement key without a restart/);
    assert.match(skill, /XDG_CONFIG_HOME/);
    assert.match(skill, /`Auth: Unsupported` is expected/);
    assert.match(skill, /does not describe the OpenRouter credential/);
    assert.match(skill, /`failed \(0 tools\)` means that startup or initialisation failed/);
  });

  it("keeps Claude Code and Codex outputs byte-identical to the committed tree", () => {
    // The dsh extension must not disturb the two existing hosts; the
    // committed files are the pre-change bytes, so a direct comparison is
    // stronger than relying on the drift gate alone.
    for (const path of ALL_PATHS.filter((p) => !p.startsWith("plugins/dsh/"))) {
      const committed = readFileSync(join(REPO_ROOT, path), "utf8");
      assert.strictEqual(files[path], committed, `${path} drifted from the committed bytes`);
    }
  });

  it("pins the dsh launcher to the exact MCP version in registry mode", () => {
    const launcher = launcherFor("dsh", "registry", mcpPkg, undefined) as {
      command: string;
      args: string[];
    };
    assert.strictEqual(launcher.command, "npx");
    assert.deepStrictEqual(launcher.args, [
      "-y",
      "--package",
      `${mcpPkg.name}@${mcpPkg.version}`,
      "mcp-intelli-search",
      "--host",
      "dsh",
    ]);
  });

  it("derives the dsh tarball vendor directory from the tarball output", () => {
    const scratch = scratchDir("plugin-bundles-dsh-vendor-");
    try {
      execFileSync(process.execPath, [GENERATOR, "--mode", "tarball", "--output", "out", "--codex-vendor-dir", "vendor"], { cwd: scratch });
      assert.ok(readFileSync(join(scratch, "out/plugins/dsh/cordis.patch.yml"), "utf8").includes(join(scratch, "out/plugins/dsh/vendor/node_modules")));
      const tarballFiles = generateFiles("tarball", {
        output: scratch,
        codexVendorDir: join(scratch, "plugins/codex/vendor"),
      }) as Record<string, string>;
      const manifest = JSON.parse(tarballFiles["plugins/dsh/package.json"]) as {
        files: string[];
      };
      assert.ok(manifest.files.includes("vendor/**"), "tarball mode ships vendor");
      const patch = tarballFiles["plugins/dsh/cordis.patch.yml"];
      const vendoredCli = join(
        scratch,
        "plugins/dsh/vendor/node_modules/@curio-data/mcp-intelli-search/dist/cli.js",
      );
      assert.match(patch, new RegExp(`command: node`));
      assert.ok(
        patch.includes(`- '${vendoredCli}'`),
        "dsh patch embeds the output-derived vendor path",
      );
      assert.ok(patch.includes("- '--host'"), "dsh patch passes the host flag");
      const registryManifest = JSON.parse(files["plugins/dsh/package.json"]) as {
        files: string[];
      };
      assert.ok(
        !registryManifest.files.includes("vendor/**"),
        "registry mode omits vendor",
      );
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("declares the dsh bundle manifest contract", () => {
    const manifest = parse(files, "plugins/dsh/package.json");
    assert.strictEqual(manifest.name, "@curio-data/dsh-intelli-search");
    assert.strictEqual(manifest.version, mcpPkg.version);
    assert.strictEqual(manifest.type, "module");
    assert.strictEqual(manifest.license, "Apache-2.0");
    assert.deepStrictEqual(manifest.repository, {
      type: "git",
      url: "git+https://github.com/Curio-Data/pi-intelli-search.git",
      directory: "plugins/dsh",
    });
    assert.deepStrictEqual(manifest.exports, {
      ".": "./index.js",
      "./package.json": "./package.json",
      "./locale/*.json": "./locale/*.json",
      "./icon": "./icon.svg",
    });
    assert.deepStrictEqual(manifest.files, [
      "index.js",
      "cordis.patch.yml",
      "skills/**",
      "locale/*.json",
      "icon.svg",
      "README.md",
      "LICENSE",
    ]);
    assert.strictEqual(DSH_TESTED_VERSION, "0.2.2-rc.1");
    assert.deepStrictEqual(manifest.engines, {
      node: ">=24.9.0",
      dsh: ">=0.2.2-rc.1 <0.3.0",
    });
    assert.deepStrictEqual(manifest.dsh, {
      manifestVersion: 1,
      bundle: { patch: "./cordis.patch.yml" },
    });
    assert.strictEqual(manifest.private, undefined);
  });

  it("emits both dsh patch rows with every required bridge value", () => {
    const patch = files["plugins/dsh/cordis.patch.yml"];
    assert.match(patch, /^# Generated by scripts\/generate-plugin-bundles\.mjs/, "patch names its generator");
    assert.ok(patch.includes("\n- insert:\n"), "patch opens with an insert operation");
    assert.ok(patch.includes("- id: mcp-intelli-search\n"), "bridge row id");
    assert.ok(
      patch.includes("name: '@deepseek-ai/dsh-mcp-client'\n"),
      "bridge row uses the shipped MCP client",
    );
    assert.ok(patch.includes("serverName: intelli\n"), "D1 server name");
    assert.ok(patch.includes("transport: stdio\n"), "stdio transport");
    assert.ok(patch.includes("command: npx\n"), "registry launcher command");
    for (const arg of [
      "-y",
      "--package",
      `${mcpPkg.name}@${mcpPkg.version}`,
      "mcp-intelli-search",
      "--host",
      "dsh",
    ]) {
      assert.ok(patch.includes(`- '${arg}'`), `patch arg ${arg}`);
    }
    assert.ok(
      patch.includes("OPENROUTER_API_KEY: !!js process.env.OPENROUTER_API_KEY || ''"),
      "literal environment expression",
    );
    assert.ok(patch.includes("toolCallTimeoutMs: 600000\n"), "ten-minute call limit");
    assert.ok(patch.includes("failOnStartupError: false\n"), "startup tolerance");
    assert.ok(patch.includes("- id: intelli-search-skill\n"), "skill row id");
    assert.ok(
      patch.includes("name: '@curio-data/dsh-intelli-search'"),
      "skill row uses the bundle package",
    );
    assert.ok(
      !patch.includes("mcp__intelli_search__"),
      "patch carries no two-host server name",
    );
  });

  it("ships dsh display metadata, artwork and licence copies", () => {
    for (const locale of ["en", "zh"]) {
      const meta = parse(files, `plugins/dsh/locale/${locale}.json`).meta as {
        title: string;
        description: string;
      };
      assert.ok(meta.title.length > 0, `${locale} title`);
      assert.ok(meta.description.length > 20, `${locale} description`);
    }
    const en = parse(files, "plugins/dsh/locale/en.json").meta as {
      description: string;
    };
    const zh = parse(files, "plugins/dsh/locale/zh.json").meta as {
      description: string;
    };
    assert.notEqual(en.description, zh.description, "distinct locale text");
    const icon = files["plugins/dsh/icon.svg"];
    assert.ok(icon.startsWith("<svg"), "icon is SVG artwork");
    assert.ok(
      Buffer.byteLength(icon, "utf8") < 256 * 1024,
      "icon below the host's 256 KiB limit",
    );
    assert.strictEqual(
      files["plugins/dsh/LICENSE"],
      readFileSync(join(REPO_ROOT, "LICENSE"), "utf8"),
      "licence copied verbatim from the repository root",
    );
    assert.ok(
      !DSH_PATHS.includes("plugins/dsh/NOTICE"),
      "NOTICE is not bundled",
    );
  });

  it("explains DeepSeek Harness setup, credentials and timeouts in the skill", () => {
    const skill = files["plugins/dsh/skills/intelli-search/SKILL.md"];
    assert.match(skill, /No path or credential exports are required/);
    assert.match(skill, /four tools start even when credentials are absent/);
    assert.match(skill, /an `OPENROUTER_API_KEY` exported in the launching environment, then a `\.env` file in the launch directory, then `\$DSH_HOME\/\.env`/);
    assert.match(skill, /one harness restart/);
    assert.match(skill, /does not provision this server/);
    assert.match(skill, /a directory change later in the session does not move the cache/);
    assert.match(skill, /profile's `cordis.patch.yml` and set `cwd`/);
    assert.match(skill, /`WORKSPACE` tool error/);
    for (const op of [
      "mcp__intelli__intelli_search",
      "mcp__intelli__intelli_extract",
      "mcp__intelli__intelli_collate",
      "mcp__intelli__intelli_research",
    ]) {
      assert.ok(skill.includes(op), `setup names ${op}`);
    }
    assert.match(skill, /ten minutes \(`toolCallTimeoutMs: 600000`\)/);
    assert.match(skill, /separate 60-second protocol default/);
    assert.match(skill, /failOnStartupError: false/);
    assert.match(skill, /A project skill with the same name outranks this registration; a user-level skill does not/);
    assert.match(skill, /dsh plugin --profile <name> remove @curio-data\/dsh-intelli-search/);
    assert.match(skill, /--dump-config/);
    assert.match(skill, /0\.2\.2-rc\.1/);
  });

  it("makes skill loading and search-first routing visible before setup", () => {
    for (const host of ["claude-code", "codex", "dsh"]) {
      const skill = files[`plugins/${host}/skills/intelli-search/SKILL.md`];
      const description = skill.split("\n").find((line) => line.startsWith("description:")) ?? "";
      assert.match(description, /Load before calling any intelli_search, intelli_research, intelli_extract or intelli_collate tool/);
      assert.match(description, /Start with intelli_search for quick facts, latest versions and release dates/);
      const routing = skill.indexOf("## When to Use Which Tool");
      const setup = skill.indexOf("## Setup");
      assert.ok(routing >= 0 && setup > routing, `${host}: routing precedes setup`);
      assert.match(skill.slice(routing, setup), /do not add comparisons, pricing or release history unless requested/);
      assert.match(skill.slice(routing, setup), /specific evidence gap requiring multiple pages/);
      const examples = [...skill.matchAll(/```[^\n]*\n([\s\S]*?)```/g)]
        .filter(([, block]) => /mcp__\S+__intelli_research\(/.test(block));
      assert.ok(examples.length > 0, `${host}: research examples exist`);
      for (const [, example] of examples) {
        assert.match(example, /maxUrls=\d+/, `${host}: research example chooses a page budget`);
      }
    }
  });

  it("does not propagate the stale native maxUrls schema default", () => {
    // The frozen native schema description says "default: 8" while the
    // shared default is 10; generated guidance must describe 10/20 only.
    for (const host of ["claude-code", "codex", "dsh"]) {
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

  it("requires a vendor directory for dsh tarball mode", () => {
    assert.throws(() => launcherFor("dsh", "tarball", mcpPkg, undefined), /dsh/);
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
    assert.deepStrictEqual(codex.args.slice(-2), ["--host", "codex"]);
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
      const dshPatch = readFileSync(
        join(scratch, "plugins/dsh/cordis.patch.yml"),
        "utf8",
      );
      assert.ok(
        dshPatch.includes(
          `- '${join(
            scratch,
            "plugins/dsh/vendor/node_modules/@curio-data/mcp-intelli-search/dist/cli.js",
          )}'`,
        ),
        "dsh tarball launcher embeds the output-derived vendor CLI",
      );
      const dshManifest = JSON.parse(
        readFileSync(join(scratch, "plugins/dsh/package.json"), "utf8"),
      );
      assert.ok(
        dshManifest.files.includes("vendor/**"),
        "tarball dsh manifest retains the vendored server",
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
      execFileSync("cp", [
        "-r",
        join(REPO_ROOT, "guidance"),
        join(fake, "guidance"),
      ]);
      mkdirSync(join(fake, "scripts"), { recursive: true });
      execFileSync("cp", [
        "-r",
        join(REPO_ROOT, "scripts/templates"),
        join(fake, "scripts"),
      ]);
      writeFileSync(
        join(fake, "LICENSE"),
        readFileSync(join(REPO_ROOT, "LICENSE")),
      );
      writeTree(generateFiles("registry", {}, fake), fake);
      assert.deepStrictEqual(checkAgainstRepo(fake), []);
      writeFileSync(join(fake, "plugins/claude-code/STRAY.txt"), "stray");
      let problems = checkAgainstRepo(fake) as string[];
      assert.strictEqual(problems.length, 1);
      assert.ok(problems[0].includes("STRAY.txt"));
      assert.ok(problems[0].includes("unexpected committed file"));
      rmSync(join(fake, "plugins/claude-code/STRAY.txt"));
      assert.deepStrictEqual(checkAgainstRepo(fake), []);

      // The same three failure classes must be reported for dsh files.
      writeFileSync(join(fake, "plugins/dsh/STRAY.txt"), "stray");
      problems = checkAgainstRepo(fake) as string[];
      assert.strictEqual(problems.length, 1);
      assert.ok(problems[0].includes("plugins/dsh/STRAY.txt"));
      assert.ok(problems[0].includes("unexpected committed file"));
      rmSync(join(fake, "plugins/dsh/STRAY.txt"));

      const patchPath = join(fake, "plugins/dsh/cordis.patch.yml");
      const original = readFileSync(patchPath, "utf8");
      writeFileSync(patchPath, `${original}# drift\n`);
      problems = checkAgainstRepo(fake) as string[];
      assert.strictEqual(problems.length, 1);
      assert.ok(problems[0].includes("plugins/dsh/cordis.patch.yml"));
      assert.ok(problems[0].includes("differs from generator output"));
      rmSync(patchPath);
      problems = checkAgainstRepo(fake) as string[];
      assert.strictEqual(problems.length, 1);
      assert.ok(problems[0].includes("missing committed file: plugins/dsh/cordis.patch.yml"));
    } finally {
      rmSync(fake, { recursive: true, force: true });
    }
  });
});

describe("dsh registrar contract", () => {
  // The registrar is imported from a generated tree written to isolated
  // scratch; the operator's agent directory is never read. Its sibling
  // package.json declares "type": "module", so the import is ESM wherever
  // the scratch directory lives.
  function writeGeneratedTree(prefix: string) {
    const scratch = scratchDir(prefix);
    writeTree(generateFiles("registry", {}, REPO_ROOT) as Record<string, string>, scratch);
    return scratch;
  }

  function mockContext() {
    const registrations: Record<string, unknown>[] = [];
    const ctx = {
      skills: {
        register(registration: Record<string, unknown>) {
          registrations.push(registration);
          return () => {};
        },
      },
    };
    return { ctx, registrations };
  }

  it("registers the bundled skill with the required fields", async () => {
    const scratch = writeGeneratedTree("plugin-bundles-dsh-registrar-");
    try {
      const registrar = (await import(
        pathToFileURL(join(scratch, "plugins/dsh/index.js")).href
      )) as {
        name: string;
        inject: string[];
        apply: (ctx: unknown) => void;
      };
      assert.strictEqual(registrar.name, "intelli-search-skill");
      assert.deepStrictEqual(registrar.inject, ["skills"]);
      const { ctx, registrations } = mockContext();
      registrar.apply(ctx);
      assert.strictEqual(registrations.length, 1);
      const registration = registrations[0];
      assert.strictEqual(registration.name, "intelli-search");
      assert.ok(
        typeof registration.description === "string" &&
          registration.description.startsWith("Load before calling any"),
        "registration carries the frontmatter description",
      );
      assert.strictEqual(registration.source, "bundled");
      assert.strictEqual(registration.whenToUse, undefined);
      const path = registration.path as string;
      assert.ok(isAbsolute(path), "instruction path is absolute");
      assert.ok(
        path.endsWith(join("plugins/dsh/skills/intelli-search/SKILL.md")),
        "instruction path points at the sibling skill",
      );
      assert.deepStrictEqual(registration.resourceBase, {
        kind: "directory",
        path: dirname(path),
      });
      const content = registration.content as string;
      assert.ok(!content.startsWith("---"), "content is frontmatter-free");
      assert.ok(content.includes("mcp__intelli__intelli_search"), "content is the dsh skill body");
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("rejects mutated frontmatter instead of registering silently", async () => {
    const scratch = writeGeneratedTree("plugin-bundles-dsh-mutated-");
    try {
      const registrar = (await import(
        pathToFileURL(join(scratch, "plugins/dsh/index.js")).href
      )) as { apply: (ctx: unknown) => void };
      const skillPath = join(scratch, "plugins/dsh/skills/intelli-search/SKILL.md");
      const original = readFileSync(skillPath, "utf8");
      // The generator's frontmatter is exactly: ---, one line per field, ---.
      const lines = original.split("\n");
      const closeIdx = lines.indexOf("---", 1);
      const frontLines = lines.slice(1, closeIdx);
      const rebuild = (fields: string[]) =>
        ["---", ...fields, "---", ...lines.slice(closeIdx + 1)].join("\n");
      const { ctx } = mockContext();
      const cases: [string, string, RegExp][] = [
        [
          "missing name",
          rebuild(frontLines.filter((line) => !line.startsWith("name:"))),
          /missing a name/,
        ],
        [
          "empty description",
          rebuild([
            ...frontLines.filter((line) => !line.startsWith("description:")),
            'description: ""',
          ]),
          /missing a description/,
        ],
        ["malformed frontmatter", original.replace(/^---\n/, ""), /missing its frontmatter block/],
        [
          "unsupported key",
          rebuild([...frontLines, "version: 2"]),
          /unsupported frontmatter key/,
        ],
      ];
      for (const [label, mutated, pattern] of cases) {
        writeFileSync(skillPath, mutated);
        assert.throws(() => registrar.apply(ctx), pattern, label);
      }
      writeFileSync(skillPath, original);
      const { ctx: cleanCtx, registrations } = mockContext();
      registrar.apply(cleanCtx);
      assert.strictEqual(registrations.length, 1, "restored fixture registers again");
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("carries an optional whenToUse through to the registration", async () => {
    const scratch = writeGeneratedTree("plugin-bundles-dsh-whentouse-");
    try {
      const registrar = (await import(
        pathToFileURL(join(scratch, "plugins/dsh/index.js")).href
      )) as { apply: (ctx: unknown) => void };
      const skillPath = join(scratch, "plugins/dsh/skills/intelli-search/SKILL.md");
      const original = readFileSync(skillPath, "utf8");
      const lines = original.split("\n");
      const closeIdx = lines.indexOf("---", 1);
      const frontLines = lines.slice(1, closeIdx);
      writeFileSync(
        skillPath,
        [
          "---",
          ...frontLines,
          'whenToUse: "Before any intelli tool call"',
          "---",
          ...lines.slice(closeIdx + 1),
        ].join("\n"),
      );
      const { ctx, registrations } = mockContext();
      registrar.apply(ctx);
      assert.strictEqual(registrations[0].whenToUse, "Before any intelli tool call");
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe("dsh package inventory", () => {
  it("packs exactly its generated payload with no vendor tree", () => {
    const out = execFileSync(
      "npm",
      ["pack", "--dry-run", "--json", "--ignore-scripts"],
      { cwd: join(REPO_ROOT, "plugins/dsh"), encoding: "utf8" },
    );
    const packed = (
      JSON.parse(out) as { files: { path: string }[] }[]
    )[0].files
      .map((entry) => entry.path)
      .sort();
    assert.deepStrictEqual(packed, [
      "LICENSE",
      "README.md",
      "cordis.patch.yml",
      "icon.svg",
      "index.js",
      "locale/en.json",
      "locale/zh.json",
      "package.json",
      "skills/intelli-search/SKILL.md",
    ]);
    for (const path of packed) {
      assert.ok(!path.includes("vendor"), `vendor leaked into the package: ${path}`);
      assert.ok(!/sk-[a-z0-9]/i.test(path), `secret-shaped file name: ${path}`);
    }
  });
});
