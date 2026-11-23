// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// test/package-readmes.test.ts — Deterministic tests for deriving each
// package README from the root README. No network.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error plain Node module without declarations
import {
  DSH_GENERATED_HEADER,
  GENERATED_HEADER,
  PACKAGES,
  anchorsOf,
  checkAgainstRepo,
  derive,
  derivePackageReadme,
  generateAll,
  hasAudience,
  isGenerated,
  publishNative,
  restoreNative,
  selectLines,
  validateDerived,
  validateRoot,
} from "../scripts/generate-package-readmes.mjs";
// @ts-expect-error plain Node module without declarations
import { checkDshReadmeLinks, runCheck } from "../scripts/check-dsh-readme-links.mjs";
// @ts-expect-error plain Node module without declarations
import * as dshMeta from "../scripts/dsh-host-metadata.mjs";
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
    ["an HTML comment opener inside a hidden block", "<!-- packages:mcp hidden\n<!-- note\n-->", /starts an unclosed HTML comment/],
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
      [rootView, "Two packages run the research engine;"],
      [generated.pi, "`@curio-data/pi-intelli-search` registers four research tools"],
      [generated.mcp, "`@curio-data/mcp-intelli-search` serves four research tools"],
    ]) {
      assert.match(text, /Intelligent web research[^\n]+\n\n<p align="center">\n  <img src="[^"]*docs\/images\/01\.png"/);
      const image = text.indexOf("docs/images/01.png");
      const bundle = text.indexOf("**DeepSeek Harness profile plugin:**");
      const features = text.indexOf("**Features:**");
      const intro = text.indexOf(introduction);
      const contents = text.indexOf("## Contents");
      if (text === rootView) assert.ok(image < bundle && bundle < features);
      else assert.equal(bundle, -1, "only the repository advertises the separate bundle");
      assert.ok(image < features && features < intro && intro < contents,
        "opening sentence, main image and features must precede package introductions and contents");
      assert.equal(text.split("docs/images/01.png").length, 2, "main image occurs once");
    }
    // The dsh view links to these references rather than duplicating them.
    for (const text of [generated.pi, generated.mcp]) {
      assert.match(text, /Archive failure is logged and the completed run can replace canonical files in place/);
      assert.match(text, /recovery is best-effort, not a complete record of sources consulted/);
      assert.match(text, /query and metadata can contain personal or confidential information/);
      assert.match(text, /can be `0` when none are recovered/);
      assert.match(text, /does not guarantee unique names/);
      assert.match(text, /^## Licence$/m);
      assert.ok((anchorsOf(text) as Set<string>).has("license"), "preserve the old licence anchor");
      assert.match(text, /^## Usage Examples$/m);
      assert.match(text, /"batchMode": "expansion"/);
      assert.match(text, /"batchMode": "independent"/);
      assert.match(text, /"queries": \[/);
      assert.ok(text.includes(`${BLOB}docs/BENCHMARKS.md#batch-research-on-the-native-host`));
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

// ---------------------------------------------------------------------------
// Opt-in DeepSeek Harness (dsh) audience
// ---------------------------------------------------------------------------

const VERSION = "9.8.7";
const RELEASE = `https://github.com/Curio-Data/pi-intelli-search/blob/mcp-v${VERSION}/`;
const SELF = `${RELEASE}plugins/dsh/README.md#`;
const META = {
  mcpVersion: VERSION,
  enginesRange: ">=1.0.0 <2.0.0",
  nodeEnginesRange: ">=30.1.0",
  referenceVersion: "1.0.0",
  testedVersions: ["1.0.0", "1.1.0"],
};
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const DSH_SOURCE = [
  "<!-- packages:mcp hidden",
  "# mcp-title",
  "-->",
  "<!-- packages:dsh hidden",
  "# dsh-title",
  "",
  "Bundle for MCP {{MCP_VERSION}}, dsh {{DSH_ENGINES_RANGE}}, Node.js {{DSH_NODE_ENGINES_RANGE}}.",
  "",
  "{{DSH_CONTENTS}}",
  "",
  "## Tuning",
  "",
  "See [own tuning](#tuning) and [own shared](#shared-heading).",
  "",
  "## Shared Heading",
  "",
  "## Verified on {{DSH_REFERENCE_VERSION}}",
  "",
  "Tested on {{DSH_TESTED_VERSIONS}}.",
  "",
  "```bash",
  "npx -y --package @curio-data/mcp-intelli-search@{{MCP_VERSION}} mcp-intelli-search --check-config",
  "```",
  "-->",
  "Untagged intro, see [Reference](#reference).",
  "",
  "## Contents",
  "",
  "<!-- TOC:START -->",
  "<!-- TOC:END -->",
  "",
  "<!-- packages:mcp -->",
  "#### DeepSeek Harness",
  "<!-- /packages -->",
  "<!-- packages:dsh hidden",
  "## DeepSeek Harness",
  "-->",
  "<!-- packages:mcp,dsh -->",
  '<a id="old-setup"></a>',
  "Shared setup: [full tuning](#tuning), [section](#deepseek-harness), [shared](#shared-heading), [alias](#old-setup), [licence](#license).",
  "Files: [changes](CHANGELOG.md#unreleased), [matrix](docs/COMPATIBILITY.md#host-plugins), [guide](./docs/GUIDE.md#part), [standalone](packages/mcp/README.md#configuration), [skill](plugins/dsh/skills/intelli-search/SKILL.md#setup), ![chart](docs/images/chart.png).",
  "",
  "### Shared Heading",
  "<!-- /packages -->",
  "",
  "## Reference",
  "",
  "<!-- packages:mcp -->",
  "### Tuning",
  "<!-- /packages -->",
  "",
  '<a id="license"></a>',
  "",
  "## Licence",
  "",
].join("\n");

function dshFixture(source = DSH_SOURCE) {
  const dir = scratchDir("readme-dsh-");
  writeFileSync(join(dir, "README.md"), source);
  mkdirSync(join(dir, "docs/images"), { recursive: true });
  mkdirSync(join(dir, "packages/mcp"), { recursive: true });
  writeFileSync(join(dir, "docs/images/chart.png"), "");
  writeFileSync(join(dir, "docs/GUIDE.md"), "## Part\n");
  writeFileSync(join(dir, "docs/COMPATIBILITY.md"), "## Host Plugins\n");
  writeFileSync(join(dir, "CHANGELOG.md"), "## [Unreleased]\n");
  writeFileSync(join(dir, "packages/mcp/package.json"), JSON.stringify({ version: VERSION }));
  writeFileSync(join(dir, "packages/mcp/README.md"), "## Configuration\n");
  mkdirSync(join(dir, "plugins/dsh/skills/intelli-search"), { recursive: true });
  writeFileSync(join(dir, "plugins/dsh/skills/intelli-search/SKILL.md"), "## Setup\n");
  return dir;
}

describe("dsh audience selection", () => {
  it("lists dsh with its preview only; the bundle README has one writer elsewhere", () => {
    assert.deepStrictEqual(PACKAGES.dsh, ["dsh.README.md"]);
    assert.ok(!Object.values(PACKAGES as Record<string, string[]>).flat().includes("plugins/dsh/README.md"));
  });

  it("excludes untagged lines from dsh only and routes shared and hidden blocks", () => {
    const source = [
      "Untagged.",
      "<!-- packages:mcp,dsh -->",
      "Shared.",
      "<!-- /packages -->",
      "<!-- packages:dsh hidden",
      "Dsh only.",
      "-->",
      "<!-- packages:mcp -->",
      "MCP only.",
      "<!-- /packages -->",
    ].join("\n");
    const view = (t: string) => selectLines(source, t).join("\n");
    assert.strictEqual(view("dsh"), "Shared.\nDsh only.");
    assert.strictEqual(view("root"), "Untagged.\nShared.\nMCP only.");
    assert.strictEqual(view("mcp"), "Untagged.\nShared.\nMCP only.");
    assert.strictEqual(view("pi"), "Untagged.");
    assert.ok(hasAudience(source, "dsh"));
    assert.ok(!hasAudience("Untagged only.\n", "dsh"));
    assert.ok(hasAudience("Untagged only.\n", "pi"));
  });

  for (const [name, text] of [
    ["untagged prose", "Version {{MCP_VERSION}}"],
    ["a visible dsh block", "<!-- packages:dsh -->\n{{MCP_VERSION}}\n<!-- /packages -->"],
    ["a hidden MCP block", "<!-- packages:mcp hidden\n{{MCP_VERSION}}\n-->"],
    ["a hidden block shared with MCP", "<!-- packages:mcp,dsh hidden\n{{MCP_VERSION}}\n-->"],
    ["a code fence outside dsh blocks", "```bash\necho {{MCP_VERSION}}\n```"],
  ] as const) {
    it(`rejects a token in ${name}`, () => {
      for (const target of ["root", "pi", "mcp", "dsh"]) {
        assert.throws(() => selectLines(text, target), /tokens are allowed only inside <!-- packages:dsh hidden/);
      }
    });
  }

  it("rejects literal TOC markers and a contents token that is not its own line", () => {
    assert.throws(() => selectLines("<!-- packages:dsh hidden\n<!-- TOC:START -->\n-->", "dsh"), /ends the comment early/);
    assert.throws(() => selectLines("<!-- packages:dsh hidden\nSee {{DSH_CONTENTS}}\n-->", "dsh"), /must be a line of its own/);
  });
});

describe("dsh derivation", () => {
  const dsh = derive(DSH_SOURCE, "dsh", { metadata: META }) as string;

  it("carries the dsh generated header with both regeneration commands and keeps no token", () => {
    assert.ok(dsh.startsWith(`${DSH_GENERATED_HEADER}\n\n# dsh-title\n`));
    assert.match(dsh, /npm run generate:readmes and npm run generate:plugins/);
    assert.ok(isGenerated(dsh));
    assert.doesNotMatch(dsh, /\{\{/);
    assert.doesNotMatch(dsh, /Untagged intro|mcp-title|#### DeepSeek Harness|## Reference|### Tuning/);
  });

  it("substitutes metadata in prose and commands", () => {
    assert.match(dsh, /Bundle for MCP 9\.8\.7, dsh >=1\.0\.0 <2\.0\.0, Node\.js >=30\.1\.0\./);
    assert.match(dsh, /Tested on `1\.0\.0` and `1\.1\.0`\./);
    assert.match(dsh, /@curio-data\/mcp-intelli-search@9\.8\.7 mcp-intelli-search --check-config/);
  });

  it("builds contents after substitution and before absolute link rewriting", () => {
    const toc = dsh.split("<!-- TOC:START -->")[1].split("<!-- TOC:END -->")[0];
    assert.match(dsh, /\n## Contents\n\n<!-- TOC:START -->\n/);
    assert.strictEqual(
      toc,
      [
        "",
        "",
        `- [Tuning](${SELF}tuning)`,
        `- [Shared Heading](${SELF}shared-heading)`,
        `- [Verified on 1.0.0](${SELF}verified-on-100)`,
        `- [DeepSeek Harness](${SELF}deepseek-harness)`,
        `  - [Shared Heading](${SELF}shared-heading-1)`,
        "",
        "",
      ].join("\n"),
    );
  });

  it("makes every link absolute, with no bare same-page anchor", () => {
    assert.doesNotMatch(dsh, /\]\(#|\]\((?!https:\/\/)/);
  });

  it("resolves link intent so dsh-only headings never capture shared reference links", () => {
    const shared = dsh.split("\n").find((l) => l.startsWith("Shared setup:")) as string;
    // The root shows #tuning as the MCP reference heading, which dsh omits.
    assert.ok(shared.includes(`[full tuning](${RELEASE}README.md#tuning)`));
    // Same for the MCP-level heading: the dsh counterpart does not capture it.
    assert.ok(shared.includes(`[section](${RELEASE}README.md#deepseek-harness)`));
    // The shared heading is in the dsh view under a different suffix.
    assert.ok(shared.includes(`[shared](${SELF}shared-heading-1)`));
    // Aliases follow their source line: one shared, one root-only.
    assert.ok(shared.includes(`[alias](${SELF}old-setup)`));
    assert.ok(shared.includes(`[licence](${RELEASE}README.md#license)`));
    // Lines from hidden dsh blocks name the dsh view's own anchors.
    assert.ok(dsh.includes(`See [own tuning](${SELF}tuning) and [own shared](${SELF}shared-heading).`));
  });

  it("uses the release tag only for operational files and main for every other target", () => {
    assert.ok(dsh.includes(`[changes](${BLOB}CHANGELOG.md#unreleased)`));
    assert.ok(dsh.includes(`[matrix](${BLOB}docs/COMPATIBILITY.md#host-plugins)`));
    assert.ok(dsh.includes(`[guide](${BLOB}docs/GUIDE.md#part)`));
    assert.ok(dsh.includes(`[standalone](${RELEASE}packages/mcp/README.md#configuration)`));
    assert.ok(dsh.includes(`[skill](${RELEASE}plugins/dsh/skills/intelli-search/SKILL.md#setup)`));
    assert.ok(dsh.includes(`![chart](${RAW}docs/images/chart.png)`));
  });

  it("refuses a source that gives dsh no content and a generated source", () => {
    assert.throws(() => derive("## Only Untagged\n", "dsh", { metadata: META }), /no content/);
    assert.throws(() => derive(dsh, "dsh", { metadata: META }), /generated copy/);
  });

  it("rejects a repeated contents token and an unsupported token", () => {
    const twice = "<!-- packages:dsh hidden\n{{DSH_CONTENTS}}\n## A\n{{DSH_CONTENTS}}\n-->\n";
    assert.throws(() => derive(twice, "dsh", { metadata: META }), /appears 2 times/);
    const unknown = derive("<!-- packages:dsh hidden\n# T\n{{DSH_VERSION}}\n-->\n", "dsh", { metadata: META });
    assert.throws(() => validateDerived(unknown, "dsh", new Set(), REPO_ROOT, { metadata: META }), /unreplaced \{\{ token/);
  });
});

describe("dsh derivation entry point and validation", () => {
  it("reads README.md, validates it and is the view generateAll writes", () => {
    const dir = dshFixture();
    try {
      const text = derivePackageReadme("dsh", dir) as string;
      const all = generateAll(dir) as Record<string, string>;
      assert.deepStrictEqual(Object.keys(all), ["pi", "mcp", "dsh"]);
      assert.strictEqual(all.dsh, text);
      // Metadata comes from the module, the version from the MCP manifest.
      assert.ok(text.includes(`dsh ${dshMeta.DSH_ENGINES_RANGE}, Node.js ${dshMeta.DSH_NODE_ENGINES_RANGE}`));
      assert.ok(text.includes(`@curio-data/mcp-intelli-search@${VERSION} `));
      assert.deepStrictEqual(checkAgainstRepo(dir), ["pi.README.md", "mcp.README.md", "packages/mcp/README.md", "dsh.README.md"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("validates self-anchors in memory, never against plugins/dsh/README.md on disk", () => {
    const dir = dshFixture(DSH_SOURCE.replace("See [own tuning](#tuning)", "See [own tuning](#nowhere)"));
    try {
      mkdirSync(join(dir, "plugins/dsh"), { recursive: true });
      // A stale bundle README with the missing anchor must not satisfy the check.
      writeFileSync(join(dir, "plugins/dsh/README.md"), "## Nowhere\n");
      assert.throws(() => derivePackageReadme("dsh", dir), /missing self anchor #nowhere/);
      // An absent bundle README must not fail a correct derivation either.
      writeFileSync(join(dir, "README.md"), DSH_SOURCE);
      rmSync(join(dir, "plugins/dsh/README.md"));
      derivePackageReadme("dsh", dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects hand-frozen refs, relative links and missing targets in the dsh view", () => {
    const dir = dshFixture();
    try {
      const root = new Set(["kept"]);
      const opts = { metadata: META };
      validateDerived(`${GENERATED_HEADER}\n\n## Own\n[a](${SELF}own) [b](${RELEASE}README.md#kept)\n`, "dsh", root, dir, opts);
      assert.throws(
        () =>
          validateDerived(
            [
              `[a](${RELEASE}docs/COMPATIBILITY.md#host-plugins)`,
              `[b](${RELEASE}docs/GUIDE.md)`,
              `[c](https://github.com/Curio-Data/pi-intelli-search/blob/mcp-v0.25.0/docs/GUIDE.md)`,
              `[d](#own) [e](docs/GUIDE.md) [f](${BLOB}docs/MISSING.md) [g](${RELEASE}README.md#lost)`,
            ].join("\n"),
            "dsh",
            root,
            dir,
            opts,
          ),
          new RegExp(
            [
              "docs/COMPATIBILITY\\.md must use ref main, not mcp-v9\\.8\\.7",
              "docs/GUIDE\\.md must use ref main, not mcp-v9\\.8\\.7",
              "docs/GUIDE\\.md must use ref main, not mcp-v0\\.25\\.0",
              "same-page anchor #own is not absolute",
              "relative link docs/GUIDE\\.md",
              "missing file docs/MISSING\\.md",
              "missing root anchor #lost",
            ].join("; "),
          ),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("omits an unpopulated dsh view and reports a stale preview as drift", () => {
    const dir = dshFixture("## Only Untagged\n");
    try {
      assert.deepStrictEqual(Object.keys(generateAll(dir)), ["pi", "mcp"]);
      assert.throws(() => derivePackageReadme("dsh", dir), /no content/);
      writeFileSync(join(dir, "dsh.README.md"), "stale\n");
      assert.ok((checkAgainstRepo(dir) as string[]).includes("dsh.README.md"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never derives dsh from a publish-swapped root README", () => {
    const dir = dshFixture();
    try {
      publishNative(dir);
      assert.throws(() => derivePackageReadme("dsh", dir), /generated native README left by a publish; run node scripts\/generate-package-readmes\.mjs --restore-native/);
      assert.throws(() => generateAll(dir), /--restore-native/);
      restoreNative(dir);
      derivePackageReadme("dsh", dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("derives the repository's dsh view only once README.md opts content in", () => {
    const source = readFileSync(join(REPO_ROOT, "README.md"), "utf8");
    if (hasAudience(source, "dsh")) {
      const text = derivePackageReadme("dsh") as string;
      assert.strictEqual((generateAll() as Record<string, string>).dsh, text);
      assert.doesNotMatch(text, /\{\{|\]\(#/);
    } else {
      assert.ok(!("dsh" in (generateAll() as Record<string, string>)));
      assert.throws(() => derivePackageReadme("dsh"), /no content/);
    }
  });
});

describe("dsh host metadata", () => {
  it("takes the MCP version from the MCP manifest", () => {
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "packages/mcp/package.json"), "utf8"));
    assert.strictEqual(dshMeta.readMcpVersion(), manifest.version);
    assert.strictEqual(dshMeta.dshHostMetadata().mcpVersion, manifest.version);
  });

  it("matches the committed bundle manifest until the plugin generator imports it", () => {
    const bundle = JSON.parse(readFileSync(join(REPO_ROOT, "plugins/dsh/package.json"), "utf8"));
    assert.deepStrictEqual(bundle.engines, { node: dshMeta.DSH_NODE_ENGINES_RANGE, dsh: dshMeta.DSH_ENGINES_RANGE });
    assert.strictEqual(dshMeta.DSH_TESTED_VERSIONS[0], dshMeta.DSH_REFERENCE_VERSION);
    assert.ok(dshMeta.DSH_ENGINES_RANGE.startsWith(`>=${dshMeta.DSH_REFERENCE_VERSION} `));
  });

  it("renders tokens and leaves contents and unknown tokens for the caller", () => {
    assert.strictEqual(dshMeta.formatVersionList(["a"]), "`a`");
    assert.strictEqual(dshMeta.formatVersionList(["a", "b", "c"]), "`a`, `b` and `c`");
    assert.strictEqual(
      dshMeta.substituteMetadata("{{MCP_VERSION}} {{DSH_TESTED_VERSIONS}} {{DSH_CONTENTS}} {{OTHER}}", META),
      "9.8.7 `1.0.0` and `1.1.0` {{DSH_CONTENTS}} {{OTHER}}",
    );
    assert.deepStrictEqual(Object.keys(dshMeta.metadataTokenValues(META)), [...dshMeta.METADATA_TOKENS]);
  });
});

describe("dsh README link checker", () => {
  const mem = (label: string, files: Record<string, string>) => ({
    label,
    exists: (p: string) => p in files,
    read: (p: string) => files[p] ?? null,
  });
  const release = mem("candidate", {
    "README.md": "## Kept\n",
    "packages/mcp/README.md": "## Configuration\n",
    "plugins/dsh/skills/intelli-search/SKILL.md": "## Setup\n",
    "CHANGELOG.md": "## [Unreleased]\n## New Entry\n",
  });
  const main = mem("main", {
    "CHANGELOG.md": "## [Unreleased]\n",
    "docs/COMPATIBILITY.md": "## Host Plugins\n",
    "docs/GUIDE.md": "## Part\n",
    "docs/images/chart.png": "",
  });
  const good = [
    DSH_GENERATED_HEADER,
    "",
    "## Own",
    `[a](${SELF}own) [b](${RELEASE}README.md#kept)`,
    `[c](${RELEASE}packages/mcp/README.md#configuration) [d](${RELEASE}plugins/dsh/skills/intelli-search/SKILL.md#setup)`,
    `![e](${RAW}docs/images/chart.png) [f](${BLOB}CHANGELOG.md#unreleased)`,
    `[g](${BLOB}docs/COMPATIBILITY.md#host-plugins) [h](${BLOB}docs/GUIDE.md#part) [i](https://example.com/x)`,
    "",
  ].join("\n");

  it("passes when every target and anchor resolves at its ref", () => {
    assert.deepStrictEqual(checkDshReadmeLinks({ text: good, version: VERSION, release, main }), { problems: [], checked: 9 });
  });

  it("reports each class of unresolved or mis-routed link", () => {
    const bad = [
      "## Own",
      "[a](#own) [b](docs/GUIDE.md) {{MCP_VERSION}}",
      `[c](${SELF}gone) [d](${BLOB}docs/MISSING.md) [e](${BLOB}docs/GUIDE.md#lost)`,
      `[f](${BLOB}CHANGELOG.md#new-entry) [g](${RELEASE}CHANGELOG.md#unreleased) [h](${BLOB}README.md#kept)`,
    ].join("\n");
    const { problems } = checkDshReadmeLinks({ text: bad, version: VERSION, release, main });
    const expected = [
      /generated-file header/,
      /unreplaced \{\{ token/,
      /same-page anchor #own is not absolute/,
      /relative link docs\/GUIDE\.md/,
      /missing self anchor #gone/,
      /missing docs\/MISSING\.md at main/,
      /missing anchor #lost in docs\/GUIDE\.md at main/,
      // An evidence anchor present only in the candidate does not yet resolve on main.
      /missing anchor #new-entry in CHANGELOG\.md at main/,
      /CHANGELOG\.md must use ref main, not mcp-v9\.8\.7/,
      /README\.md must use ref mcp-v9\.8\.7, not main/,
    ];
    assert.strictEqual(problems.length, expected.length, problems.join("\n"));
    expected.forEach((pattern, i) => assert.match(problems[i], pattern));
  });

  it("checks committed bytes in the working tree and in Git objects at the release tag", () => {
    const dir = dshFixture();
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: dir,
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_AUTHOR_NAME: "test",
          GIT_AUTHOR_EMAIL: "test@example.invalid",
          GIT_COMMITTER_NAME: "test",
          GIT_COMMITTER_EMAIL: "test@example.invalid",
        },
      });
    try {
      mkdirSync(join(dir, "plugins/dsh"), { recursive: true });
      writeFileSync(join(dir, "plugins/dsh/README.md"), derivePackageReadme("dsh", dir));
      git("init", "-q", "-b", "main");
      git("add", "-A");
      git("commit", "-q", "-m", "fixture");
      git("tag", `mcp-v${VERSION}`);
      const candidate = runCheck({ file: "plugins/dsh/README.md", mainRef: "main" }, dir);
      assert.deepStrictEqual(candidate.problems, []);
      assert.ok(candidate.receipt.includes("mode: candidate"));
      assert.ok(candidate.receipt.includes("result: PASS"));
      const tag = runCheck({ file: "plugins/dsh/README.md", ref: `mcp-v${VERSION}`, mainRef: "main" }, dir);
      assert.deepStrictEqual(tag.problems, []);
      assert.ok(tag.receipt.some((l: string) => /^release targets: mcp-v9\.8\.7 \([0-9a-f]{40}\)$/.test(l)));
      assert.ok(tag.receipt.some((l: string) => /^sha256: [0-9a-f]{64}$/.test(l)));
      git("tag", "mcp-v1.0.0");
      assert.throws(() => runCheck({ file: "plugins/dsh/README.md", ref: "mcp-v1.0.0", mainRef: "main" }, dir), /does not match/);
      assert.throws(() => runCheck({ file: "plugins/dsh/README.md", mainRef: "no-such-ref" }, dir), /does not resolve/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Canonical dsh operator content (Stage 2A): assertions against the real
// derived views of the repository README, not fixtures.
// ---------------------------------------------------------------------------

/** Every ```bash fence body in a Markdown text. */
function bashFences(markdown: string): string[] {
  return [...markdown.matchAll(/^```bash\n([\s\S]*?)^```$/gm)].map((m) => m[1]);
}

/**
 * Executable-example defects in one Bash fence: an angle-bracket placeholder
 * outside quotes, an unquoted use of the example profile variable, or a use
 * of that variable the fence never sets.
 */
function bashFenceDefects(fence: string): string[] {
  const defects: string[] = [];
  const unquoted = fence.replace(/'[^']*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
  for (const m of unquoted.matchAll(/<[a-z-]+>/g)) defects.push(`placeholder ${m[0]}`);
  if (/\$\{?profile\b/.test(unquoted)) defects.push("unquoted $profile");
  if (/\$\{?profile\b/.test(fence) && !/^profile=\S+$/m.test(fence)) defects.push("$profile used without a literal profile= line");
  return defects;
}

/** Text of one dsh `## heading` section, up to the next depth-two heading. */
function dshSection(text: string, heading: string): string {
  const parts = text.split(`\n## ${heading}\n`);
  assert.equal(parts.length, 2, `dsh section ${heading} occurs once`);
  return parts[1].split(/\n## /)[0];
}

describe("canonical dsh operator content", () => {
  const meta = dshMeta.dshHostMetadata(REPO_ROOT) as {
    mcpVersion: string;
    enginesRange: string;
    nodeEnginesRange: string;
    referenceVersion: string;
    testedVersions: string[];
  };
  const dsh = derivePackageReadme("dsh") as string;
  const mcp = derivePackageReadme("mcp") as string;
  const pi = derivePackageReadme("pi") as string;
  const source = readFileSync(join(REPO_ROOT, "README.md"), "utf8");
  const rootView = selectLines(source, "root").join("\n");
  const release = `https://github.com/Curio-Data/pi-intelli-search/blob/mcp-v${meta.mcpVersion}/`;
  const pinned = `@curio-data/mcp-intelli-search@${meta.mcpVersion}`;
  const nodeFloor = meta.nodeEnginesRange.replace(/^>=(\d+\.\d+)\.0$/, "$1");

  it("puts the depth-one title first, before Contents, and nests every other heading below it", () => {
    const headings = [...dsh.matchAll(/^(#{1,6}) (.+)$/gm)];
    assert.equal(headings[0][0], "# Intelli Search for DeepSeek Harness", "the title is the first heading");
    assert.equal(headings.filter((h) => h[1] === "#").length, 1, "exactly one depth-one heading");
    assert.equal(headings[1][0], "## Contents", "Contents follows the title");
    assert.ok(dsh.indexOf("# Intelli Search for DeepSeek Harness") < dsh.indexOf("## Contents"));
    const toc = dsh.split("<!-- TOC:START -->")[1].split("<!-- TOC:END -->")[0];
    for (const section of [
      "Prerequisites",
      "Installation",
      "Upgrade, Restart and Removal",
      "Credentials",
      "Workspace",
      "Configuration",
      "Verification",
      "Timeouts",
      "Troubleshooting",
      "Charges, Cache and Privacy",
      "Evidence and Limits",
      "Further Documentation",
      "Licence",
    ]) {
      assert.match(dsh, new RegExp(`^## ${escape(section)}$`, "m"), section);
      assert.ok(toc.includes(`[${section}](${release}plugins/dsh/README.md#`), `contents lists ${section} absolutely`);
    }
    // Anchors of the 0.25.0 hand-written page survive as aliases.
    const anchors = anchorsOf(dsh) as Set<string>;
    for (const old of ["requirements", "installation", "credentials", "workspace-and-cache", "tools-and-timeouts", "verification", "removal", "evidence-and-limits", "licence"]) {
      assert.ok(anchors.has(old), `old dsh anchor #${old}`);
    }
  });

  it("states identity, the four tools and when to choose search, research or a batch", () => {
    const intro = dsh.split("## Contents")[0];
    assert.match(intro, /`@curio-data\/dsh-intelli-search` adds cited web search and multi-page research/);
    assert.match(intro, /configuration bundle, not an extension/);
    assert.ok(intro.includes(`version \`${meta.mcpVersion}\``), "names the exact server version it launches");
    for (const tool of ["search", "research", "extract", "collate"]) assert.ok(intro.includes(`\`mcp__intelli__intelli_${tool}\``), tool);
    assert.match(intro, /Quick search: one concise answer with numbered sources/);
    assert.match(intro, /`batchMode: "independent"`[\s\S]*`"expansion"`/);
    assert.match(intro, /Start with a quick search; use research for comparisons/);
  });

  it("lists every prerequisite with metadata-matched ranges", () => {
    const pre = dshSection(dsh, "Prerequisites");
    assert.ok(pre.includes(`\`${meta.enginesRange}\``), "declared dsh range");
    assert.ok(pre.includes(`Node.js ${nodeFloor} or later`), "Node.js floor");
    for (const needle of ["`pnpm` on `PATH`", "`pnpmCommand`", "`node` and `npx` on `PATH`", "Network access on the first start", "bills that account", "Linux x86-64", "_macOS_ and _Windows_ are not verified"]) {
      assert.ok(pre.includes(needle), needle);
    }
    // Visible root literals are the same values as the metadata module.
    const shared = rootView.split("\n#### DeepSeek Harness\n")[1].split("\n#### Generic MCP Host")[0];
    assert.ok(shared.includes(meta.enginesRange));
    assert.ok(shared.includes(`Node.js ${nodeFloor} or later`));
    for (const host of meta.testedVersions) assert.ok(shared.includes(`\`${host}\``), host);
    assert.ok(shared.includes(`60 seconds on \`${meta.referenceVersion}\``));
  });

  it("documents profile selection, CLI and Web installation, upgrade, restart and removal", () => {
    const install = dshSection(dsh, "Installation");
    assert.match(install, /the name given to `--profile`/);
    assert.match(install, /```bash\nprofile=web\ndsh plugin --profile "\$profile" add @curio-data\/dsh-intelli-search\n```/);
    assert.match(install, /\*\*Plugins\*\*, select \*\*Add plugin\*\*/);
    assert.match(install, /```bash\nprofile=web\ndsh --profile "\$profile"\n```/);
    const life = dshSection(dsh, "Upgrade, Restart and Removal");
    assert.match(life, /\*\*Versions\*\* and \*\*Update\*\*/);
    assert.match(life, /no command-line update route has been verified/);
    assert.match(life, /Restart the profile from the project directory after installing, updating or removing the bundle/);
    assert.match(life, /dsh plugin --profile "\$profile" remove @curio-data\/dsh-intelli-search\ndsh --profile "\$profile" --dump-config/);
    assert.match(life, /Removal deletes no data/);
    assert.doesNotMatch(life, /removal (erases|deletes) (the )?(data|credentials|cache)/i);
    assert.doesNotMatch(dsh, /dsh plugin [^\n]*@curio-data\/dsh-intelli-search@/, "no untested versioned upgrade command");
  });

  it("gives environment and credential-file routes with a safe standard-input setup", () => {
    const cred = dshSection(dsh, "Credentials");
    assert.match(cred, /environment that launches the harness, then a `\.env` file in the launch directory, then `\$DSH_HOME\/\.env`/);
    assert.match(cred, /A nonempty environment value takes precedence over the file/);
    assert.match(cred, /model-settings page does not reach this server/);
    const setup = bashFences(cred).find((f) => f.includes("mcp-intelli-search setup"));
    assert.ok(setup, "setup pipeline present");
    assert.equal(
      setup,
      [
        "read -r -s -p 'OpenRouter API key: ' key",
        "printf '\\n'",
        "printf '%s\\n' \"$key\" | \\",
        `  npx -y --package ${pinned} \\`,
        "  mcp-intelli-search setup",
        "unset key",
        "",
      ].join("\n"),
    );
    assert.doesNotMatch(setup, /OPENROUTER_API_KEY|export|codex/, "never overwrites, exports or starts another host");
    assert.match(cred, /refuses a terminal as its input/);
    assert.match(cred, /setup prints `Setup complete\.`/);
    assert.match(cred, /When the file already names a custom `apiKeyFile`, setup writes the key to that path and leaves the configuration file unchanged/);
    assert.match(cred, /Only an absolute `XDG_CONFIG_HOME` is honoured; an unset or relative value means `\$HOME\/\.config`/);
    assert.match(cred, /rereads the credential file on every call/);
  });

  it("explains workspace selection, the fixed-root override and home or root rejection", () => {
    const ws = dshSection(dsh, "Workspace");
    assert.match(ws, /uses the harness working directory as its workspace/);
    assert.match(ws, /home or filesystem-root working directory is rejected/);
    assert.match(ws, /by the configuration check/);
    assert.match(ws, /replaces the row's entire `config`/);
    assert.match(ws, /update the pinned server version after each bundle update/);
  });

  it("documents defaults, the per-user path, a complete strict example and reload rules", async () => {
    const config = dshSection(dsh, "Configuration");
    assert.match(config, /`perplexity\/sonar` for search, `minimax\/minimax-m3` for extraction and collation/);
    assert.ok(config.includes("`${XDG_CONFIG_HOME:-$HOME/.config}/mcp-intelli-search/config.json`"));
    assert.match(config, /all three model roles are required/);
    assert.match(config, /`defaultUrls` must not exceed `maxUrls`/);
    assert.match(config, /A file without `apiKeyFile` still uses the default credential path/);
    assert.ok(config.includes(`${release}packages/mcp/README.md#configuration`));
    assert.ok(config.includes(`${release}packages/mcp/README.md#tuning`));
    assert.match(config, /built-in defaults stay in force until the profile restarts\. Restart after creating the file/);
    assert.match(config, /reads it again, until a call finds it valid/);
    assert.match(config, /Once a file loads, its selections stay fixed until the profile restarts/);
    const blocks = [...config.matchAll(/^```json\n([\s\S]*?)^```$/gm)].map((m) => m[1]);
    assert.equal(blocks.length, 1);
    const document = JSON.parse(blocks[0]);
    assert.deepStrictEqual(Object.keys(document.models).sort(), ["collate", "extract", "search"]);
    assert.ok(document.tuning.defaultUrls <= document.tuning.maxUrls);
    assert.equal(document.providers.openrouter.apiKeyFile, undefined, "a complete example need not carry apiKeyFile");
    const { parseConfig } = await import("../packages/mcp/src/config.js");
    const workspace = scratchDir("dsh-config-example-");
    try {
      const parsed = await parseConfig(document, workspace);
      assert.equal(parsed.settings.searchModel.model, "perplexity/sonar");
      assert.equal(parsed.settings.extractModel.model, "minimax/minimax-m3");
      assert.equal(parsed.settings.collateModel.model, "minimax/minimax-m3");
      assert.equal(parsed.settings.defaultUrls, document.tuning.defaultUrls);
      assert.equal(parsed.settings.maxUrls, document.tuning.maxUrls);
      await assert.rejects(parseConfig({ providers: document.providers, models: { search: document.models.search } }, workspace));
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("gives a credential-free configuration check, both success lines and a labelled inference request", () => {
    const verify = dshSection(dsh, "Verification");
    const check = bashFences(verify).find((f) => f.includes("--check-config"));
    assert.equal(check, `npx -y --package ${pinned} \\\n  mcp-intelli-search --host dsh --check-config\n`);
    assert.match(verify, /From the project directory/);
    assert.match(verify, /It needs no key and makes no model call/);
    assert.ok(verify.includes("- `Configuration is valid.` when the per-user file loads."));
    assert.ok(verify.includes("- `Configuration is valid (built-in DeepSeek Harness defaults; no per-user file found).` when there is no per-user file."));
    assert.match(verify, /\*\*Inference Check \(Billed\)\.\*\*/);
    assert.match(verify, /a quick search does not exercise page fetching, extraction or collation/);
  });

  it("explains both timeout clocks, retry impact and concrete smaller-work remedies", () => {
    const timeouts = dshSection(dsh, "Timeouts");
    for (const needle of ["`toolCallTimeoutMs: 600000`", "`llmTimeoutMs`", "`llmRetryAttempts`", "`outputBudgetRetries`", "it never extends the bridge limit", "`maxUrls` 3", "fewer questions in one batch", "Set `outputBudgetRetries` to `0`"]) {
      assert.ok(timeouts.includes(needle), needle);
    }
  });

  it("writes troubleshooting for a human operator and keeps agent-only rules in the skill", () => {
    const trouble = dshSection(dsh, "Troubleshooting");
    assert.match(trouble, /^\| Symptom \| Cause \| Remedy \|$/m);
    for (const symptom of ["tools are absent", "`WORKSPACE` error", "`CONFIGURATION` error naming `config.json`", "`CONFIGURATION` error for a missing key", "`PROVIDER` error"]) {
      assert.ok(trouble.includes(symptom), symptom);
    }
    assert.doesNotMatch(dsh, /substitut\w+ the harness's own web search|do not claim/i, "agent-only rule stays out of the human page");
    assert.ok(trouble.includes(`${release}packages/mcp/README.md#timeouts-and-troubleshooting`), "full reference in the standalone guide");
    const skill = readFileSync(join(REPO_ROOT, "guidance/setup-dsh.md"), "utf8");
    assert.match(skill, /do not substitute the harness's own web search/);
    assert.match(skill, /read -r -s -p 'OpenRouter API key: ' key\n/);
    assert.match(skill, /@curio-data\/mcp-intelli-search@\{\{MCP_VERSION\}\}/);
    assert.match(skill, /Setup complete\./);
    assert.doesNotMatch(skill, /read -r -s[^\n]*OPENROUTER_API_KEY|unset OPENROUTER_API_KEY|^codex$/m);
    assert.doesNotMatch(skill, /<name>/, "no angle-bracket profile placeholder");
  });

  it("carries the charge notice, cache map, privacy warning and telemetry distinction", () => {
    const notices = dshSection(dsh, "Charges, Cache and Privacy");
    assert.match(notices, /Every search and research call bills the configured OpenRouter account/);
    assert.match(notices, /≈\$0\.09/);
    assert.match(notices, /```text\n\.search\/\n/);
    assert.match(notices, /full copies of fetched pages/);
    assert.match(notices, /fetched addresses are not restricted to public ones/);
    assert.match(notices, /`meta\.json` is local telemetry, which the server never transmits/);
    assert.match(notices, /reports, extractions, sources, batch manifests and the index are still written/);
  });

  it("keeps evidence classes apart and states the bundle-versus-server licence and NOTICE", () => {
    const evidence = dshSection(dsh, "Evidence and Limits");
    for (const label of ["**Local bundle, credential-free:**", "**Pre-bootstrap launcher:**", "**Public installation by name:**", "**Credentialed research:**"]) {
      assert.ok(evidence.includes(label), label);
    }
    assert.match(evidence, /none stands in for another/);
    assert.ok(evidence.includes(meta.enginesRange));
    assert.ok(evidence.includes("https://github.com/Curio-Data/pi-intelli-search/blob/main/docs/COMPATIBILITY.md#deepseek-harness-evidence-and-limits"));
    assert.doesNotMatch(dsh, /registry-pin installation (has|have) not been (tested|verified)/i, "stale registry negative");
    const licence = dshSection(dsh, "Licence");
    assert.match(licence, /The bundle contains no third-party code, so it carries no `NOTICE`/);
    assert.match(licence, /its own \[LICENSE\]\([^)]+packages\/mcp\/LICENSE\) and a \[NOTICE\]\([^)]+packages\/mcp\/NOTICE\)/);
  });

  it("links further documentation absolutely and excludes native, other-host and contributor material", () => {
    const further = dshSection(dsh, "Further Documentation");
    for (const target of [
      `${release}packages/mcp/README.md#usage-examples`,
      `${release}packages/mcp/README.md#cost`,
      `${release}packages/mcp/README.md#timeouts-and-troubleshooting`,
      `${release}packages/mcp/README.md#cache-structure`,
      `${release}packages/mcp/README.md#filesystem-and-privacy-boundaries`,
      `${release}plugins/dsh/skills/intelli-search/SKILL.md`,
      "https://github.com/Curio-Data/pi-intelli-search/blob/main/CHANGELOG.md",
    ]) {
      assert.ok(further.includes(target), target);
    }
    const body = dsh.slice(dsh.indexOf("\n") + 1);
    assert.doesNotMatch(body, /pi install|claude mcp add|codex plugin|Configuration Recipes|npm run |Settings Reference|\| `defaultUrls` \|/);
  });

  it("rejects angle-bracket placeholders and unquoted profile uses in every dsh Bash fence", () => {
    const fences = bashFences(dsh);
    assert.ok(fences.length >= 6, "the page carries its command examples");
    for (const fence of fences) assert.deepStrictEqual(bashFenceDefects(fence), [], fence);
    assert.deepStrictEqual(bashFenceDefects("dsh plugin --profile <name> remove x\n"), ["placeholder <name>"]);
    assert.deepStrictEqual(bashFenceDefects("dsh --profile $profile\n"), ["unquoted $profile", "$profile used without a literal profile= line"]);
    assert.deepStrictEqual(bashFenceDefects("read -r -s -p '<key>: ' key\n"), [], "quoted text is not a placeholder");
    for (const fence of bashFences(mcp).filter((f) => f.includes("dsh"))) assert.deepStrictEqual(bashFenceDefects(fence), [], fence);
  });

  it("gives the MCP view the installation command and current evidence, and corrects frozen root links", () => {
    const section = mcp.split("\n#### DeepSeek Harness\n")[1].split("\n#### Generic MCP Host")[0];
    assert.match(section, /dsh plugin --profile "\$profile" add @curio-data\/dsh-intelli-search/);
    assert.match(section, /read -r -s -p 'OpenRouter API key: ' key/);
    assert.match(section, /--host dsh --check-config/);
    assert.match(section, /\*\*Public installation by name:\*\*/);
    assert.doesNotMatch(mcp, /No registry-pin installation has been verified|published separately from this server|Check the \[repository installation guide\]/);
    assert.match(mcp, /For DeepSeek Harness, the matrix keeps three classes apart/);
    assert.doesNotMatch(source, /blob\/mcp-v\d/, "no hand-frozen release links in the canonical source");
    assert.match(rootView, /\[DeepSeek Harness\]\(#deepseek-harness\) and any \[Generic MCP Host\]/);
    assert.ok(pi.includes("[DeepSeek Harness](https://github.com/Curio-Data/pi-intelli-search/blob/main/README.md#deepseek-harness)"));
    assert.ok((anchorsOf(rootView) as Set<string>).has("deepseek-harness"), "root anchor preserved");
    assert.doesNotMatch(dsh, /\{\{|\]\(#/);
  });
});
