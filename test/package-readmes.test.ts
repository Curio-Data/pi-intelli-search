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
const RELEASE_RAW = `https://raw.githubusercontent.com/Curio-Data/pi-intelli-search/mcp-v${VERSION}/`;
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
  "Files: [changes](CHANGELOG.md#unreleased), [matrix](docs/COMPATIBILITY.md#host-plugins), [guide](./docs/GUIDE.md#part), ![chart](docs/images/chart.png).",
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

  it("carries the standard generated header and keeps no token", () => {
    assert.ok(dsh.startsWith(`${GENERATED_HEADER}\n\n# dsh-title\n`));
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

  it("uses the release tag for operational files and main for evidence and history", () => {
    assert.ok(dsh.includes(`[changes](${BLOB}CHANGELOG.md#unreleased)`));
    assert.ok(dsh.includes(`[matrix](${BLOB}docs/COMPATIBILITY.md#host-plugins)`));
    assert.ok(dsh.includes(`[guide](${RELEASE}docs/GUIDE.md#part)`));
    assert.ok(dsh.includes(`![chart](${RELEASE_RAW}docs/images/chart.png)`));
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
      rmSync(join(dir, "plugins"), { recursive: true });
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
              `[b](${BLOB}docs/GUIDE.md)`,
              `[c](https://github.com/Curio-Data/pi-intelli-search/blob/mcp-v0.25.0/docs/GUIDE.md)`,
              `[d](#own) [e](docs/GUIDE.md) [f](${RELEASE}docs/MISSING.md) [g](${RELEASE}README.md#lost)`,
            ].join("\n"),
            "dsh",
            root,
            dir,
            opts,
          ),
          new RegExp(
            [
              "docs/COMPATIBILITY\\.md must use ref main, not mcp-v9\\.8\\.7",
              "docs/GUIDE\\.md must use ref mcp-v9\\.8\\.7, not main",
              "docs/GUIDE\\.md must use ref mcp-v9\\.8\\.7, not mcp-v0\\.25\\.0",
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
    "docs/GUIDE.md": "## Part\n",
    "docs/images/chart.png": "",
    "CHANGELOG.md": "## [Unreleased]\n## New Entry\n",
  });
  const main = mem("main", { "CHANGELOG.md": "## [Unreleased]\n", "docs/COMPATIBILITY.md": "## Host Plugins\n" });
  const good = [
    GENERATED_HEADER,
    "",
    "## Own",
    `[a](${SELF}own) [b](${RELEASE}README.md#kept) [c](${RELEASE}docs/GUIDE.md#part) ![d](${RELEASE_RAW}docs/images/chart.png)`,
    `[e](${BLOB}CHANGELOG.md#unreleased) [f](${BLOB}docs/COMPATIBILITY.md#host-plugins) [g](https://example.com/x)`,
    "",
  ].join("\n");

  it("passes when every target and anchor resolves at its ref", () => {
    assert.deepStrictEqual(checkDshReadmeLinks({ text: good, version: VERSION, release, main }), { problems: [], checked: 7 });
  });

  it("reports each class of unresolved or mis-routed link", () => {
    const bad = [
      "## Own",
      "[a](#own) [b](docs/GUIDE.md) {{MCP_VERSION}}",
      `[c](${SELF}gone) [d](${RELEASE}docs/MISSING.md) [e](${RELEASE}docs/GUIDE.md#lost)`,
      `[f](${BLOB}CHANGELOG.md#new-entry) [g](${RELEASE}CHANGELOG.md#unreleased) [h](${BLOB}docs/GUIDE.md#part)`,
    ].join("\n");
    const { problems } = checkDshReadmeLinks({ text: bad, version: VERSION, release, main });
    const expected = [
      /generated-file header/,
      /unreplaced \{\{ token/,
      /same-page anchor #own is not absolute/,
      /relative link docs\/GUIDE\.md/,
      /missing self anchor #gone/,
      /missing docs\/MISSING\.md at candidate/,
      /missing anchor #lost in docs\/GUIDE\.md at candidate/,
      // An evidence anchor present only in the candidate does not yet resolve on main.
      /missing anchor #new-entry in CHANGELOG\.md at main/,
      /CHANGELOG\.md must use ref main, not mcp-v9\.8\.7/,
      /docs\/GUIDE\.md must use ref mcp-v9\.8\.7, not main/,
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
