// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { research } from "../src/core/operations/research.js";
import { allocateSourceIdentity, makeCachePath, rotateCacheArtefacts } from "../src/core/cache.js";
import { finalizeCollation, isCollationFailureReport } from "../src/core/provenance.js";
import { invalidateSettingsCache, loadSettings, takeSettingsWarnings } from "../src/settings.js";
import { coreContext } from "./helpers/core-context.js";
import { formatCacheAppendix } from "../src/core/messages.js";
import { extract } from "../src/core/operations/extract.js";
import { nativeResult } from "../src/native-operation-context.js";

async function workspace(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), "post-0220-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

it("accepts emphasis spanning soft line breaks without merging literal URL suffixes", () => {
  const url = "https://example.com/form";
  const source = {
    url: "https://docs.example/page",
    title: "Docs",
    extraction: url,
    sourceType: "docs",
    currentness: "current",
    status: "success" as const,
  };
  const identity = allocateSourceIdentity([source], []);
  for (const marker of ["*", "**", "_", "__"]) {
    for (const decorated of [
      `${marker}Form:\n${url}${marker}`,
      `${marker}Form:\n${url}\n${marker}`,
      `${marker}Form:\r\n${url}${marker}`,
    ]) {
      assert.doesNotThrow(
        () =>
          finalizeCollation(
            `See ${url}`,
            ".search/run",
            [{ ...source, extraction: decorated }],
            identity,
            "fetched",
          ),
        decorated,
      );
      assert.doesNotThrow(
        () => finalizeCollation(decorated, ".search/run", [source], identity, "fetched"),
        decorated,
      );
    }
    // Openers in different blocks cannot consume a literal URL suffix.
    const literal = `${url}${marker}`;
    for (const prefix of [
      `${marker}Note\n\n`,
      `# ${marker}Heading\n`,
      `${marker}Note\n# Heading\n`,
      `> ${marker}Quote\n\n`,
      `\`\`\`\n${marker}code\n\`\`\`\n`,
    ]) {
      assert.throws(
        () =>
          finalizeCollation(
            `See ${url}`,
            ".search/run",
            [{ ...source, extraction: prefix + literal }],
            identity,
            "fetched",
          ),
        /absent/,
      );
    }
    assert.throws(
      () => finalizeCollation(`See ${literal}`, ".search/run", [source], identity, "fetched"),
      /absent/,
    );
  }
});

for (const outcome of [
  "no-links",
  "fetch-failed",
  "extraction-failed",
  "collate-failed",
] as const) {
  it(`keeps successful metadata byte-identical after ${outcome} and retains separate attempts`, async (t) => {
    const root = await workspace(t);
    const { context, dependencies } = coreContext(root, { outputBudgetRetries: 0 });
    const query = `metadata ${outcome}`;
    const good = await research({ query }, context, dependencies);
    const path = join(root, good.details.cachePath as string);
    const meta = await readFile(join(path, "meta.json"), "utf8");
    const report = await readFile(join(path, "report.md"), "utf8");
    const complete = context.models.complete;
    context.models.complete = async (request) => {
      if (outcome === "no-links" && request.model.model === "search")
        return { text: "No links", citations: [] };
      if (outcome === "extraction-failed" && request.model.model === "extract")
        throw new Error("fixture extraction failure");
      if (outcome === "collate-failed" && request.model.model === "collate")
        return { text: "Invented https://unfetched.example/claim", citations: [] };
      return complete(request);
    };
    if (outcome === "fetch-failed")
      dependencies.fetchPages = async (urls) =>
        urls.map((url) => ({
          url,
          title: "",
          content: "",
          status: "error",
          error: "fixture fetch failure",
        }));
    for (let i = 0; i < 2; i++)
      assert.equal((await research({ query }, context, dependencies)).outcome, outcome);
    assert.equal(await readFile(join(path, "meta.json"), "utf8"), meta);
    assert.equal(await readFile(join(path, "report.md"), "utf8"), report);
    const attempts = await readdir(join(path, "attempts"));
    assert.equal(attempts.length, 2);
    for (const attempt of attempts) {
      const dir = join(path, "attempts", attempt);
      assert.equal(JSON.parse(await readFile(join(dir, "meta.json"), "utf8")).outcome, outcome);
      if (outcome === "collate-failed") {
        const diagnostic = JSON.parse(await readFile(join(dir, "rejected-synthesis.json"), "utf8"));
        assert.equal(diagnostic.accepted, false);
        assert.equal(diagnostic.candidates[0].text, "Invented https://unfetched.example/claim");
      }
    }
  });
}

it("saves rejected collation candidates as diagnostics, including after input trimming with telemetry disabled", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, {
    disableTelemetry: true,
    outputBudgetRetries: 1,
    collationSourceMaxTokens: 256,
  });
  const complete = context.models.complete;
  let n = 0;
  const texts = [
    "Rejected first https://unfetched.example/a",
    "Rejected longer second https://unfetched.example/b",
  ];
  context.models.complete = async (request) => {
    if (request.model.model === "extract")
      return { text: "Evidence sentence. ".repeat(500), citations: [] };
    if (request.model.model === "collate")
      return { text: texts[n++], citations: [], finishReason: "length" };
    return complete(request);
  };
  const result = await research({ query: "rejected diagnostics" }, context, dependencies);
  assert.equal(result.outcome, "collate-failed");
  assert.doesNotMatch(result.text, /extraction files directly, or re-run the research/);
  assert.match(result.text, /Read the saved extraction files/);
  const path = join(root, result.details.cachePath as string);
  const diagnostic = JSON.parse(await readFile(join(path, "rejected-synthesis.json"), "utf8"));
  assert.equal(diagnostic.accepted, false);
  assert.deepEqual(
    diagnostic.candidates.map((c: { text: string }) => c.text).sort(),
    [...texts].sort(),
  );
  assert.ok(
    diagnostic.candidates.every((c: { reason: string }) =>
      /provenance validation failed/.test(c.reason),
    ),
  );
  assert.match(result.text, /rejected-synthesis\.json/);
  assert.doesNotMatch(result.text, /Rejected first|Rejected longer second/);
  assert.match(result.text, /Collation input trimmed/);
  assert.match(await readFile(join(path, "report.md"), "utf8"), /rejected-synthesis\.json/);
});

it("retains an untrimmed rejected synthesis without calling it accepted or absent", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { outputBudgetRetries: 0 });
  const complete = context.models.complete;
  context.models.complete = async (request) =>
    request.model.model === "collate"
      ? { text: "Rejected https://unfetched.example/", citations: [] }
      : complete(request);
  const result = await research({ query: "untrimmed rejected text" }, context, dependencies);
  assert.equal(result.outcome, "collate-failed");
  assert.match(result.text, /No synthesis was accepted/);
  assert.doesNotMatch(result.text, /No synthesis was produced|trim notice|Rejected https/);
  const diagnostic = JSON.parse(
    await readFile(
      join(root, result.details.cachePath as string, "rejected-synthesis.json"),
      "utf8",
    ),
  );
  assert.equal(diagnostic.candidates[0].text, "Rejected https://unfetched.example/");
});

it("archived failure reports point to their own sources and extraction files", async (t) => {
  const root = await workspace(t);
  const { context, dependencies } = coreContext(root, { outputBudgetRetries: 0 });
  const complete = context.models.complete;
  context.models.complete = async (request) =>
    request.model.model === "collate" ? { text: "", citations: [] } : complete(request);
  const query = "archive failure";
  const first = await research({ query }, context, dependencies);
  const display = first.details.cachePath as string;
  await research({ query }, context, dependencies);
  const path = makeCachePath(query, root, context.paths.cacheRoot);
  const archived = await readFile(join(`${path}.1`, "report.md"), "utf8");
  assert.ok(isCollationFailureReport(archived));
  assert.ok(archived.includes(`> Cache: ${display}.1/`));
  assert.ok(archived.includes(`${display}.1/sources/`));
  assert.ok(archived.includes(`${display}.1/extractions/`));
  assert.ok(!archived.includes(`${display}/sources/`));
  for (const match of archived.matchAll(/\| ([^|]+\/(?:sources|extractions)\/[^|]+\.md) \|/g))
    await readFile(resolve(root, match[1].trim()));
});

it("archive rebasing leaves fenced synthesis examples unchanged", async (t) => {
  const root = await workspace(t);
  const cache = join(root, "run");
  const display = ".search/run";
  const snippet = '```js\nconst example = ".search/run/sources/01-example.md";\n```';
  await mkdir(cache);
  await writeFile(
    join(cache, "report.md"),
    `# q\n\n> Cache: ${display}/\n\n${snippet}\n\n| ${display}/sources/01-example.md |\n`,
  );
  await rotateCacheArtefacts(cache, display);
  const archived = await readFile(join(`${cache}.1`, "report.md"), "utf8");
  assert.ok(archived.includes(snippet));
  assert.ok(archived.includes(`| ${display}.1/sources/01-example.md |`));
});

it("settings warnings do not claim a built-in default when a global value survives", async (t) => {
  const root = await workspace(t);
  const saved = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  t.after(async () => {
    if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = saved;
    invalidateSettingsCache();
    takeSettingsWarnings();
  });
  await mkdir(join(root, ".pi"));
  await writeFile(
    join(root, "settings.json"),
    JSON.stringify({ "pi-intelli-search": { collationMaxTokens: 16000 } }),
  );
  await writeFile(
    join(root, ".pi/settings.json"),
    JSON.stringify({ "pi-intelli-search": { collationMaxTokens: -1 } }),
  );
  invalidateSettingsCache();
  takeSettingsWarnings();
  const settings = await loadSettings({ cwd: root, projectTrusted: true });
  assert.equal(settings.collationMaxTokens, 16000);
  const warnings = takeSettingsWarnings();
  assert.equal(warnings.length, 1);
  assert.doesNotMatch(warnings[0], /Using the default \(8000\)/);
  assert.match(warnings[0], /Ignoring.*collationMaxTokens=-1/);
});

it("native skill recovery uses model-visible cache text rather than hidden details", async () => {
  const skill = await readFile(
    new URL("../skills/intelli-search/SKILL.md", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(skill, /details\.(?:preservedCachePath|cachePath)/);
  assert.ok(skill.includes("**Cache** line"));
  assert.ok(formatCacheAppendix(".search/run", 1, 0).includes("**Cache**: `.search/run/`"));
});

it("native skill builds collation items from model-visible extraction text alone", async (t) => {
  const skill = await readFile(
    new URL("../skills/intelli-search/SKILL.md", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(skill, /details/, "native agents never see result details");

  // The rule the skill states, applied in its stated order.
  const skillRule: Array<[string[], string]> = [
    [["official doc"], "official docs"],
    [["api reference"], "API reference"],
    [["tutorial"], "tutorial"],
    [["blog"], "blog post"],
    [["forum", "stackoverflow"], "forum"],
  ];
  for (const [needles, value] of skillRule) {
    for (const needle of needles) assert.ok(skill.includes(`\`${needle}\``), needle);
    assert.ok(skill.includes(`\`${value}\``), value);
  }
  const sourceTypeFromSkill = (line: string) =>
    skillRule.find(([needles]) => needles.some((n) => line.toLowerCase().includes(n)))?.[1] ??
    "unknown";

  const root = await mkdtemp(join(tmpdir(), "pi-intelli-skill-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const firstLines = [
    "Official documentation, current",
    "API Reference for the client",
    "A tutorial from 2024",
    "Engineering blog, possibly outdated",
    "StackOverflow answer",
    "Vendor product page",
  ];
  for (const firstLine of firstLines) {
    for (const truncated of [false, true]) {
      const base = coreContext(root);
      const body = `${firstLine}\nKey facts.\n- One point.`;
      const context = {
        ...base.context,
        models: {
          ...base.context.models,
          complete: async () => ({
            text: body,
            citations: [],
            usage: { output: truncated ? 100 : 10 },
            ...(truncated ? { finishReason: "length" } : {}),
          }),
        },
      };
      const result = await extract(
        { url: "https://one.example", title: "One", content: "page", query: "q" },
        context,
      );
      const visible = nativeResult(result).content[0].text;
      const heading = "### Extraction: One\n\n";
      assert.ok(visible.startsWith(heading));
      const warning = visible.match(/\n\n> ⚠ Extraction output reached extractionMaxTokens[^\n]*$/);
      assert.equal(Boolean(warning), truncated, "the warning marks truncation");
      const item = {
        extraction: visible.slice(heading.length, warning ? warning.index : undefined),
        sourceType: sourceTypeFromSkill(visible.slice(heading.length).split("\n")[0]),
        ...(warning ? { truncated: true } : {}),
      };
      assert.deepEqual(item, {
        extraction: result.details.extraction,
        sourceType: result.details.sourceType,
        ...(result.details.truncated ? { truncated: true } : {}),
      }, `${firstLine}, truncated=${truncated}`);
    }
  }
});

it("keeps the line-one failure marker policy for hand-edited reports", () => {
  const report = "<!-- intelli-search:collate-failed -->\n# q\n";
  assert.equal(isCollationFailureReport(report), true);
  assert.equal(isCollationFailureReport(`\n${report}`), false);
});
