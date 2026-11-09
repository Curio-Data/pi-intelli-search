// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { allocateSourceIdentity, rotateCacheArtefacts } from "../src/core/cache.js";
import { finalizeCollation } from "../src/core/provenance.js";
import { research } from "../src/core/operations/research.js";
import { coreContext } from "./helpers/core-context.js";

async function workspace(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), "post-0220-review-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

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
function finish(prose: string, evidence = url) {
  return finalizeCollation(
    prose,
    ".search/run",
    [{ ...source, extraction: evidence }],
    identity,
    "fetched",
  );
}

it("matches wrapped emphasis in list and quote paragraphs in both directions", () => {
  for (const marker of ["*", "**", "_", "__"]) {
    for (const shape of [
      `- ${marker}Form:\n  ${url}${marker}`,
      `- ${marker}Form:\n    ${url}${marker}`,
      `* ${marker}Form:\n  ${url}${marker}`,
      `1. ${marker}Form:\n   ${url}${marker}`,
      `> ${marker}Form:\n> ${url}${marker}`,
      `> ${marker}Form:\n${url}${marker}`,
      `- ${marker}Form:\n${url}${marker}`,
      `> - ${marker}Form:\n>   ${url}${marker}`,
      `> > ${marker}Form:\n> > ${url}${marker}`,
    ]) {
      assert.doesNotThrow(() => finish(url, shape), `evidence: ${shape}`);
      assert.doesNotThrow(() => finish(shape), `synthesis: ${shape}`);
      assert.throws(
        () => finish(shape.replaceAll(url, "https://unfetched.example/form")),
        /absent/,
      );
    }
  }
});

it("never pairs emphasis across sibling items, separate quotes, headings or code", () => {
  for (const marker of ["*", "**", "_", "__"]) {
    const literal = `${url}${marker}`;
    for (const text of [
      `- ${marker}First\n- ${literal}`,
      `1. ${marker}First\n2. ${literal}`,
      `- ${marker}First\n  - ${literal}`,
      `> ${marker}First\n>\n> ${literal}`,
      `> ${marker}First\n\n${literal}`,
      `# ${marker}Heading\n${literal}`,
      `> # ${marker}Heading\n> ${literal}`,
      `- ${marker}First\n\n${literal}`,
      `\`\`\`\n${marker}Example\n\`\`\`\n${literal}`,
      `\`\`\`\n${marker}Example\n${literal}`,
      `- \`\`\`\n  ${marker}Example\n  \`\`\`\n${literal}`,
    ]) {
      assert.throws(() => finish(url, text), /absent/, text);
    }
  }
});

it("keeps a truncated open fence outside generated inventories on success and archive", async (t) => {
  const root = await workspace(t);
  for (const fence of ["```", "~~~~"]) {
    const { context, dependencies } = coreContext(root, { outputBudgetRetries: 0 });
    const complete = context.models.complete;
    let later = false;
    const query = `open fence ${fence}`;
    context.models.complete = async (request) =>
      request.model.model === "collate"
        ? {
            text: later ? "New summary [S1]." : `Facts [S1].\n\n${fence}js\nconst x = 1;`,
            citations: [],
            ...(later ? {} : { finishReason: "length" as const }),
          }
        : complete(request);
    const first = await research({ query }, context, dependencies);
    assert.equal(first.outcome, "completed");
    assert.ok(first.text.includes(`const x = 1;\n${fence}\n\n## Source assessment`));
    later = true;
    await research({ query }, context, dependencies);
    const display = first.details.cachePath as string;
    const report = await readFile(join(root, `${display}.1`, "report.md"), "utf8");
    assert.ok(report.includes(`${display}.1/sources/01-one-example.md`));
    assert.ok(!report.includes(`${display}/sources/01-one-example.md`));
  }
});

it("rebases legacy unclosed reports at the generated inventory, not a quoted heading", async (t) => {
  const root = await workspace(t);
  const live = join(root, "run");
  await mkdir(live);
  const example = "```md\n## Source assessment\n\n.search/run/sources/example.md\n```";
  const rendered = finish(`${example}\n\nFacts [S1].\n\n~~~js\nunclosed();`);
  // Simulate the old renderer: remove any newly supplied closing fence.
  const legacy = rendered.replace(
    "unclosed();\n~~~\n\n## Source assessment",
    "unclosed();\n\n## Source assessment",
  );
  await writeFile(join(live, "report.md"), `# q\n\n> Cache: .search/run/\n\n${legacy}`);
  await rotateCacheArtefacts(live, ".search/run");
  const archived = await readFile(join(`${live}.1`, "report.md"), "utf8");
  assert.ok(archived.includes(example), "quoted source heading and path are untouched");
  assert.ok(archived.includes(".search/run.1/extractions/01-docs-example.md"));
  assert.ok(!archived.includes(".search/run/extractions/01-docs-example.md"));
});

for (const mode of ["transport", "empty", "rejected"] as const) {
  it(`distinguishes trimmed ${mode} recovery from omitted-input recovery`, async (t) => {
    const root = await workspace(t);
    const { context, dependencies } = coreContext(root, {
      collationSourceMaxTokens: 256,
      outputBudgetRetries: 0,
      disableTelemetry: true,
    });
    const complete = context.models.complete;
    let calls = 0;
    context.models.complete = async (request) => {
      if (request.model.model === "extract")
        return { text: "Evidence sentence. ".repeat(500), citations: [] };
      if (request.model.model === "collate") {
        calls++;
        if (mode === "transport") throw new Error("fixture transient timeout");
        return {
          text: mode === "empty" ? "" : "Invented https://unfetched.example/",
          citations: [],
        };
      }
      return complete(request);
    };
    const result = await research({ query: mode }, context, dependencies);
    assert.equal(calls, 1);
    assert.equal(result.outcome, "collate-failed");
    const body = result.text.split("\n").find((line) => line.startsWith("No synthesis"))!;
    assert.match(
      body,
      mode === "rejected" ? /^No synthesis was accepted/ : /^No synthesis was produced/,
    );
    assert.match(body, /Read the saved extraction files/);
    assert.match(body, /transient failure/);
    assert.doesNotMatch(body, /review the input limits.*before another collation/);
    assert.match(result.text, /Collation input trimmed/);
    const report = await readFile(
      join(root, result.details.cachePath as string, "report.md"),
      "utf8",
    );
    assert.ok(report.includes(body));
  });
}
