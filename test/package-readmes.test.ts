// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// test/package-readmes.test.ts — Deterministic tests for deriving each
// package README from the root README. No network.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error plain Node module without declarations
import {
  anchorsOf,
  checkAgainstRepo,
  derive,
  generateAll,
  isGenerated,
  publishNative,
  restoreNative,
  selectLines,
  validateDerived,
  validateRoot,
} from "../scripts/generate-package-readmes.mjs";
// @ts-expect-error plain Node module without declarations
import { generateToc } from "../scripts/generate-toc.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BLOB = "https://github.com/Curio-Data/pi-intelli-search/blob/main/";
const RAW = "https://raw.githubusercontent.com/Curio-Data/pi-intelli-search/main/";

// Repo-derived scratch never goes to an unset-TMPDIR /tmp on this host.
function scratchDir(prefix: string) {
  const base = process.env.TMPDIR ?? join(REPO_ROOT, ".tmp");
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, prefix));
}

const SOURCE = [
  "<!-- packages:mcp hidden",
  "# mcp-title",
  "-->",
  "<!-- packages:pi -->",
  "# pi-title",
  "<!-- /packages -->",
  "",
  "Shared intro, see [Native](#native) and [MCP](#mcp).",
  "",
  "## Contents",
  "",
  "<!-- TOC:START -->",
  "<!-- TOC:END -->",
  "",
  "<!-- packages:pi -->",
  "## Native",
  "",
  "Pi only. ![chart](docs/images/chart.png) [guide](./docs/GUIDE.md#part)",
  "<!-- /packages -->",
  "",
  "<!-- packages:mcp -->",
  "## MCP",
  "",
  "MCP only.",
  "<!-- /packages -->",
  "",
  "<!-- packages:none -->",
  "## Development",
  "<!-- /packages -->",
  "",
  "## Shared",
  "",
  "```markdown",
  "<!-- packages:pi -->",
  "[literal](#native)",
  "```",
  "",
].join("\n");

describe("package README block selection", () => {
  it("routes untagged, visible, hidden and repository-only blocks", () => {
    const root = selectLines(SOURCE, "root").join("\n");
    const pi = selectLines(SOURCE, "pi").join("\n");
    const mcp = selectLines(SOURCE, "mcp").join("\n");
    assert.match(root, /# pi-title/);
    assert.doesNotMatch(root, /mcp-title/);
    assert.match(root, /## Native[\s\S]*## MCP[\s\S]*## Development/);
    assert.match(pi, /# pi-title/);
    assert.doesNotMatch(pi, /mcp-title|## MCP|## Development/);
    assert.match(mcp, /# mcp-title/);
    assert.doesNotMatch(mcp, /pi-title|## Native|## Development/);
    for (const text of [pi, mcp]) assert.match(text, /## Shared/);
  });

  it("leaves directive lookalikes inside code fences alone", () => {
    const pi = selectLines(SOURCE, "pi").join("\n");
    assert.match(pi, /```markdown\n<!-- packages:pi -->\n\[literal\]\(#native\)\n```/);
  });

  for (const [name, text, message] of [
    ["nested blocks", "<!-- packages:pi -->\n<!-- packages:mcp -->\n<!-- /packages -->", /do not nest/],
    ["an unclosed block", "<!-- packages:pi -->\ntext", /never closed/],
    ["a stray close", "<!-- /packages -->", /without an open block/],
    ["an unknown package", "<!-- packages:codex -->\n<!-- /packages -->", /unknown package "codex"/],
    ["none with a package", "<!-- packages:none,pi -->\n<!-- /packages -->", /cannot be combined/],
    ["--> inside a hidden block", "<!-- packages:mcp hidden\na --> b\n-->", /ends the comment early/],
    ["a malformed directive", "<!-- packages: pi -->", /malformed package directive/],
  ] as const) {
    it(`rejects ${name}`, () => {
      assert.throws(() => selectLines(text, "pi"), message);
    });
  }
});

describe("package README derivation", () => {
  const pi = derive(SOURCE, "pi") as string;
  const mcp = derive(SOURCE, "mcp") as string;

  it("marks the output as generated and refuses it as a source", () => {
    assert.ok(isGenerated(pi));
    assert.throws(() => derive(pi, "mcp"), /generated copy/);
  });

  it("regenerates the contents list from the selected headings only", () => {
    assert.match(pi, /- \[Native\]\(#native\)\n- \[Shared\]\(#shared\)/);
    assert.doesNotMatch(pi, /\(#mcp\)\n|\(#development\)/);
    assert.match(mcp, /- \[MCP\]\(#mcp\)\n- \[Shared\]\(#shared\)/);
  });

  it("redirects anchors the package omits to the root README", () => {
    assert.match(pi, /\[Native\]\(#native\) and \[MCP\]\(https:\/\/github\.com\/Curio-Data\/pi-intelli-search\/blob\/main\/README\.md#mcp\)/);
    assert.match(mcp, new RegExp(`\\[Native\\]\\(${BLOB}README\\.md#native\\) and \\[MCP\\]\\(#mcp\\)`));
  });

  it("makes relative paths absolute, images from raw content", () => {
    assert.ok(pi.includes(`![chart](${RAW}docs/images/chart.png)`));
    assert.ok(pi.includes(`[guide](${BLOB}docs/GUIDE.md#part)`));
  });

  it("collapses the blank lines removed blocks leave behind", () => {
    assert.doesNotMatch(pi, /\n\n\n/);
    assert.ok(pi.endsWith("```\n"));
  });
});

describe("root README validation", () => {
  it("rejects anchors and files the GitHub view cannot resolve", () => {
    const dir = scratchDir("readme-root-");
    try {
      assert.throws(() => validateRoot("## A\n\n[x](#b) [y](missing.md)\n", dir), /missing anchor #b; missing file missing\.md/);
      // Headings inside hidden blocks are not part of the GitHub view.
      assert.throws(() => validateRoot("<!-- packages:mcp hidden\n## B\n-->\n[x](#b)\n", dir), /missing anchor #b/);
      writeFileSync(join(dir, "present.md"), "");
      validateRoot("## A\n\n[x](#a) [y](present.md)\n", dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps hidden-block headings out of the root contents list", () => {
    const toc = generateToc("<!-- packages:mcp hidden\n## Hidden\n-->\n<!-- TOC:START -->\n<!-- TOC:END -->\n## Shown\n") as string;
    assert.match(toc, /- \[Shown\]\(#shown\)/);
    assert.doesNotMatch(toc, /Hidden\]/);
  });
});

describe("derived README link validation", () => {
  it("accepts only links that resolve in the repository and the root README", () => {
    const dir = scratchDir("readme-derived-");
    try {
      writeFileSync(join(dir, "README.md"), "");
      mkdirSync(join(dir, "docs/images"), { recursive: true });
      writeFileSync(join(dir, "docs/images/a.png"), "");
      const root = new Set(["kept"]);
      validateDerived(`## Own\n[a](#own) [b](${BLOB}README.md#kept) ![c](${RAW}docs/images/a.png)\n`, "pi", root, dir);
      assert.throws(
        () => validateDerived(`[a](#gone) [b](${BLOB}README.md#lost) ![c](${RAW}docs/images/b.png) [d](docs/x.md)\n`, "pi", root, dir),
        /missing anchor #gone; missing root anchor #lost; missing file docs\/images\/b\.png; relative link docs\/x\.md/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("repository package READMEs", () => {
  const generated = generateAll() as Record<string, string>;

  it("commits package READMEs identical to a fresh derivation", () => {
    assert.deepStrictEqual(checkAgainstRepo(), []);
  });

  it("gives each package its own self-contained published install and reference sections", () => {
    assert.match(generated.pi, /^# pi-intelli-search$/m);
    assert.doesNotMatch(generated.pi, /^#{2,4} (MCP Server|MCP Server Reference|Development)$/m);
    assert.match(generated.mcp, /^# mcp-intelli-search$/m);
    assert.doesNotMatch(generated.mcp, /^#{2,4} (`Pi` Native Extension|Settings Reference|Configuration Recipes|Development)$/m);

    const rootView = selectLines(readFileSync(join(REPO_ROOT, "README.md"), "utf8"), "root").join("\n");
    for (const [text, introduction] of [
      [rootView, "This repository provides two first-class packages"],
      [generated.pi, "`@curio-data/pi-intelli-search` registers four research tools"],
      [generated.mcp, "`@curio-data/mcp-intelli-search` serves four research tools"],
    ]) {
      assert.match(text, /Intelligent web research[^\n]+\n\n<p align="center">\n  <img src="[^"]*docs\/images\/01\.png"/);
      const image = text.indexOf("docs/images/01.png");
      const features = text.indexOf("**Features:**");
      const intro = text.indexOf(introduction);
      const contents = text.indexOf("## Contents");
      assert.ok(image < features && features < intro && intro < contents,
        "opening sentence, main image and features must precede package introductions and contents");
      assert.equal(text.split("docs/images/01.png").length, 2, "main image occurs once");
    }
    for (const text of Object.values(generated)) {
      assert.match(text, /Archive failure is logged and the completed run can replace canonical files in place/);
      assert.match(text, /recovery is best-effort, not a complete record of sources consulted/);
      assert.match(text, /query and metadata can contain personal or confidential information/);
      assert.match(text, /can be `0` when none are recovered/);
      assert.match(text, /does not guarantee unique names/);
      assert.match(text, /^## Licence$/m);
      assert.ok((anchorsOf(text) as Set<string>).has("license"), "preserve the old licence anchor");
      assert.match(text, /^## Usage Examples$/m);
      assert.doesNotMatch(text, /publication is pending|post-publication|pre-publication|is unpublished/i);
      // Preserve existing inbound usage links after renaming the heading.
      assert.ok((anchorsOf(text) as Set<string>).has("quick-start"));
    }
    const nativeInstall = generated.pi.split("### `Pi` Native Extension\n")[1].split("\n## Tools")[0];
    assert.match(nativeInstall, /pi install npm:@curio-data\/pi-intelli-search/);
    assert.match(nativeInstall, /#### Prerequisites[\s\S]*#### Install the Extension[\s\S]*#### Verify Installation/);
    assert.doesNotMatch(nativeInstall, /"extractMaxChars"/);

    const claudeInstall = generated.mcp.split("#### Claude Code\n")[1].split("\n#### Claude Code Plugin")[0];
    const configBlock = claudeInstall.match(/```json\n([\s\S]*?)\n```/);
    assert.ok(configBlock, "the introductory route includes the complete server configuration");
    const config = JSON.parse(configBlock[1]);
    assert.deepStrictEqual(Object.keys(config).sort(), ["models", "providers"]);
    assert.deepStrictEqual(config.providers, { openrouter: { apiKeyEnv: "OPENROUTER_API_KEY" } });
    assert.deepStrictEqual(Object.keys(config.models).sort(), ["collate", "extract", "search"]);
    assert.match(claudeInstall, /read -r -s[^\n]*OPENROUTER_API_KEY[\s\S]*export OPENROUTER_API_KEY/);
    assert.match(claudeInstall, /claude mcp add intelli_search --scope local/);
    assert.match(claudeInstall, /INTELLI_SEARCH_CONFIG=\$PWD\/\.intelli-search\.json/);
    assert.match(claudeInstall, /INTELLI_SEARCH_WORKSPACE=\$PWD/);
    assert.match(claudeInstall, /npx -y --package @curio-data\/mcp-intelli-search/);
    assert.match(claudeInstall, /--check-config[\s\S]*Configuration is valid\.[\s\S]*claude mcp list/);
    assert.doesNotMatch(claudeInstall, /packages\/mcp\/dist|#generic-mcp-host|\]\(#verification\)/);
    assert.match(generated.mcp, /configuration's \[`tuning` object\]\(#tuning\)/);
    assert.match(generated.mcp, /category alone does not identify a rejected key/);
    assert.match(generated.pi, /Native calls await background citation reads for up to two seconds/);
    assert.doesNotMatch(generated.mcp, /README\.md#settings\)/);
  });

  it("keeps the MCP anchors the generated plugin skills link to", () => {
    const anchors = anchorsOf(generated.mcp) as Set<string>;
    for (const anchor of ["configuration", "tuning", "verification", "filesystem-and-privacy-boundaries"]) {
      assert.ok(anchors.has(anchor), anchor);
    }
  });
});

describe("native publish swap", () => {
  it("replaces the root README for publish and restores it", () => {
    const dir = scratchDir("readme-publish-");
    try {
      writeFileSync(join(dir, "README.md"), SOURCE);
      mkdirSync(join(dir, "docs/images"), { recursive: true });
      writeFileSync(join(dir, "docs/images/chart.png"), "");
      writeFileSync(join(dir, "docs/GUIDE.md"), "");
      publishNative(dir);
      const published = readFileSync(join(dir, "README.md"), "utf8");
      assert.ok(isGenerated(published));
      assert.match(published, /# pi-title/);
      // A repeated hook after an interrupted publish derives from the backup.
      publishNative(dir);
      assert.strictEqual(readFileSync(join(dir, "README.md"), "utf8"), published);
      assert.throws(() => generateAll(dir), /--restore-native/);
      restoreNative(dir);
      assert.strictEqual(readFileSync(join(dir, "README.md"), "utf8"), SOURCE);
      restoreNative(dir);
      assert.strictEqual(readFileSync(join(dir, "README.md"), "utf8"), SOURCE);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
