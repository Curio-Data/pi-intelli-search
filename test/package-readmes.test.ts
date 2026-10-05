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

describe("repository package READMEs", () => {
  const generated = generateAll() as Record<string, string>;

  it("commits an MCP README identical to a fresh derivation", () => {
    assert.deepStrictEqual(checkAgainstRepo(), []);
  });

  it("gives each package only its own install and reference sections", () => {
    assert.match(generated.pi, /^# pi-intelli-search$/m);
    assert.doesNotMatch(generated.pi, /^#{2,4} (MCP Server|MCP Server Reference|Development)$/m);
    assert.match(generated.mcp, /^# mcp-intelli-search$/m);
    assert.doesNotMatch(generated.mcp, /^#{2,4} (`Pi` Native Extension|Settings Reference|Configuration Recipes|Development)$/m);
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
