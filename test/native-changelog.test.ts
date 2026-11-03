// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// test/native-changelog.test.ts — deterministic gates for the generated
// PI_CHANGELOG.md: drift against CHANGELOG.md, host-parser compatibility
// (asserted against the captured pi-changelog-parser fixture, not a live
// host), packaging declarations, and the generator's exclusion and
// inline-code rules.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  classifyHeading,
  derive,
  isGenerated,
  validateGenerated,
  checkAgainstRepo,
} from "../scripts/generate-native-changelog.mjs";
import { mapLinks, splitInlineCode, allLinkTargets } from "../scripts/lib/markdown-links.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const parserFixture = JSON.parse(
  readFileSync(new URL("./fixtures/pi-changelog-parser-1.5.0.json", import.meta.url), "utf8"),
) as { headingRegexSource: string; goldenEntries: Array<{ version: string; content: string }> };
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
  files: string[];
  pi?: { changelogPath?: string };
};

function headingsOf(markdown: string): string[] {
  return markdown
    .split("\n")
    .filter((l) => l.startsWith("## "))
    .map((l) => l.slice(3));
}

describe("PI_CHANGELOG.md drift and packaging", () => {
  it("committed file equals a fresh derivation from CHANGELOG.md", () => {
    assert.ok(checkAgainstRepo(ROOT));
  });

  it("is marked generated, so hand edits are detectable", () => {
    const committed = readFileSync(new URL("../PI_CHANGELOG.md", import.meta.url), "utf8");
    assert.ok(isGenerated(committed));
  });

  it("package.json declares pi.changelogPath and ships the file", () => {
    assert.strictEqual(pkg.pi?.changelogPath, "PI_CHANGELOG.md");
    assert.ok(pkg.files.includes("PI_CHANGELOG.md"), "files must list PI_CHANGELOG.md");
  });

  it("newest parsed version equals the package version", () => {
    const committed = readFileSync(new URL("../PI_CHANGELOG.md", import.meta.url), "utf8");
    const versions = validateGenerated(committed, ROOT);
    assert.strictEqual(versions[0], pkg.version);
    assert.strictEqual(new Set(versions).size, versions.length, "duplicate parsed versions");
  });
});

describe("host parser compatibility (captured pi 1.5.0 fixture)", () => {
  const headingRe = new RegExp(parserFixture.headingRegexSource);

  it("fixture golden sample pins the parser's accept/reject behaviour", () => {
    assert.deepStrictEqual(
      parserFixture.goldenEntries.map((e) => e.version),
      ["1.2.3", "1.4.0", "0.13.0"],
    );
    assert.ok(parserFixture.goldenEntries[0].content.includes("### Sub-heading stays in the entry"));
  });

  it("every generated heading parses under the captured regex", () => {
    const committed = readFileSync(new URL("../PI_CHANGELOG.md", import.meta.url), "utf8");
    for (const heading of headingsOf(committed)) {
      assert.match(`## ${heading}`, headingRe);
    }
  });

  it("generated heading count equals the validated section count, and every source heading classifies", () => {
    const committed = readFileSync(new URL("../PI_CHANGELOG.md", import.meta.url), "utf8");
    const versions = validateGenerated(committed, ROOT);
    assert.strictEqual(headingsOf(committed).length, versions.length);
    const source = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
    for (const heading of headingsOf(source)) {
      assert.doesNotThrow(() => classifyHeading(heading), `source heading failed classification: ${heading}`);
    }
  });
});

describe("generate-native-changelog exclusions", () => {
  const mini = [
    "# Changelog",
    "",
    "## [Unreleased]",
    "not an entry",
    "",
    "## [pi-2.1.0] - 2026-11-30",
    "native entry with a [link](docs/COMPATIBILITY.md#pi-150-verification-2026-11-03) and `[code](docs/x.md)` span",
    "",
    "## [mcp-2.1.0] - 2026-11-30",
    "mcp pointer only",
    "",
    "## [pi-2.0.0-beta.1] - 2026-11-01",
    "prerelease: parser collapses it onto 2.0.0",
    "",
    "## [2.0.0] - 2026-10-01",
    "historical entry with a [baseline](docs/BENCHMARKS.md#findings) link",
    "",
    "## [1.9.0] - Prepared 2026-09-01, Not Published",
    "never shipped",
    "",
    "[2.0.0]: https://example.com/v2.0.0",
    "[1.9.0]: https://example.com/v1.9.0",
    "",
  ].join("\n");

  it("keeps native sections, rewrites headings and tag-pins links, drops everything else", () => {
    const derived = derive(mini);
    const headings = headingsOf(derived);
    assert.deepStrictEqual(headings, ["[2.1.0] - 2026-11-30", "[2.0.0] - 2026-10-01"]);
    assert.ok(
      derived.includes(
        "https://github.com/Curio-Data/pi-intelli-search/blob/pi-v2.1.0/docs/COMPATIBILITY.md#pi-150-verification-2026-11-03",
      ),
      "prefixed-era links pin to pi-v tags",
    );
    assert.ok(derived.includes("blob/v2.0.0/"), "historical links pin to v tags");
    assert.ok(!derived.includes("mcp pointer"), "mcp sections excluded");
    assert.ok(!derived.includes("prerelease"), "prerelease sections excluded");
    assert.ok(!derived.includes("never shipped"), "Not Published sections excluded");
    assert.ok(!derived.includes("https://example.com"), "reference definitions dropped");
    assert.ok(derived.includes("`[code](docs/x.md)`"), "inline code spans untouched");
  });
});

describe("markdown link mapping", () => {
  it("never rewrites link-shaped text inside inline code spans", () => {
    const line = "without markdown `[title](url)` links (common for how-to queries)";
    const rewritten = mapLinks(line, (u) => `https://rewritten/${u}`) as string;
    assert.ok(rewritten.includes("`[title](url)`"));
    assert.ok(!rewritten.includes("https://rewritten/"));
  });

  it("rewrites real links on the same line as code spans", () => {
    const line = "see [`Pi`](README.md#install) and [docs](docs/ARCHITECTURE.md)";
    const rewritten = mapLinks(line, (u) => `https://rewritten/${u}`) as string;
    assert.ok(rewritten.includes("https://rewritten/README.md#install"));
    assert.ok(rewritten.includes("https://rewritten/docs/ARCHITECTURE.md"));
  });

  it("protects the remainder of a line with an unpaired backtick", () => {
    const parts = splitInlineCode("it`s a [link](url)");
    assert.ok(parts.every((p) => p.code || !p.text.includes("[link]")));
  });

  it("matches backtick run lengths, so double-backtick spans are code and singles inside are literal", () => {
    const rewritten = mapLinks("a ``code `[x](docs/a.md)` span`` and [real](docs/b.md)", (u) => `https://r/${u}`) as string;
    assert.ok(rewritten.includes("``code `[x](docs/a.md)` span``"));
    assert.ok(rewritten.includes("https://r/docs/b.md"));
  });

  it("rewrites single-quoted Markdown titles and HTML attributes", () => {
    const rewritten = mapLinks(
      "[a](docs/a.md 'title') and <a href='docs/b.md'>x</a>",
      (u) => `https://r/${u}`,
    ) as string;
    assert.ok(rewritten.includes("https://r/docs/a.md"));
    assert.ok(rewritten.includes("https://r/docs/b.md"));
  });

  it("allLinkTargets catches a relative link a rewrite skipped behind an unpaired backtick", () => {
    const targets = allLinkTargets("it`s odd but [this](docs/nope.md) stays relative");
    assert.ok(targets.includes("docs/nope.md"));
    const protected_ = mapLinks("it`s odd but [this](docs/nope.md) stays relative", (u) => `https://r/${u}`) as string;
    assert.ok(protected_.includes("(docs/nope.md)"));
  });
});

describe("classifyHeading", () => {
  it("rewrites native-prefixed headings and keeps the date suffix", () => {
    assert.deepStrictEqual(classifyHeading("[pi-0.21.0] - 2026-11-03"), {
      version: "0.21.0",
      tag: "pi-v0.21.0",
      heading: "## [0.21.0] - 2026-11-03",
    });
  });

  it("keeps historical headings and pins them to the v tag", () => {
    assert.deepStrictEqual(classifyHeading("[0.14.0] - 2026-09-22"), {
      version: "0.14.0",
      tag: "v0.14.0",
      heading: "## [0.14.0] - 2026-09-22",
    });
  });

  it("rejects unreleased, mcp, prerelease and not-published headings", () => {
    assert.strictEqual(classifyHeading("[Unreleased]"), null);
    assert.strictEqual(classifyHeading("[mcp-0.21.0] - 2026-11-03"), null);
    assert.strictEqual(classifyHeading("[pi-0.22.0-alpha.0] - 2026-11-05"), null);
    assert.strictEqual(classifyHeading("[0.12.6] - Prepared 2026-09-01, Not Published"), null);
  });

  it("accepts the host-documented unbracketed heading form", () => {
    assert.strictEqual(classifyHeading("0.18.0 - 2026-10-13")?.version, "0.18.0");
  });

  it("fails closed on a mistyped or unknown heading instead of dropping the release", () => {
    assert.throws(() => classifyHeading("[pi-0.18.0 ] - 2026-10-13"), /unrecognised/);
    assert.throws(() => classifyHeading("[PI-0.21.0] - 2026-11-03"), /unrecognised/);
    assert.throws(() => classifyHeading("[0.21]"), /unrecognised/);
    assert.throws(() => classifyHeading("[Something New]"), /unrecognised/);
  });
});
