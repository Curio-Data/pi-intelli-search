// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// Scenario-18-only Cordis plugin. It is mounted through the scenario
// profile's user patch layer, never through the generated bundle, and
// writes a bounded JSON observation for the scenario script to assert on:
// the four exact mcp__intelli__* tool names, the intelli-search catalogue
// entry and the loaded skill's body shape. Nothing here calls a provider.
//
// The bridge publishes its first MCP tool generation asynchronously, so an
// immediate registry read can miss it (observed in Phase 1); presence checks
// poll with a deadline instead of a fixed sleep. Absence checks wait out a
// short grace period in a fresh process, where the row is not composed at
// all, and then record what is registered.

import { writeFileSync } from "node:fs";

const REQUIRED_TOOLS = [
  "mcp__intelli__intelli_search",
  "mcp__intelli__intelli_extract",
  "mcp__intelli__intelli_collate",
  "mcp__intelli__intelli_research",
];

export const name = "intelli-inspector";
export const inject = ["tools", "skills"];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function registryNames(ctx) {
  return ctx.tools.definitions().map((definition) => definition.name).sort();
}

async function pollForTools(ctx, deadlineMs) {
  const start = Date.now();
  for (;;) {
    const names = registryNames(ctx);
    const missing = REQUIRED_TOOLS.filter((name) => !names.includes(name));
    if (missing.length === 0) {
      return { settled: true, waitedMs: Date.now() - start, names, missing };
    }
    if (Date.now() - start >= deadlineMs) {
      return { settled: false, waitedMs: Date.now() - start, names, missing };
    }
    await sleep(250);
  }
}

async function settleForAbsence(ctx, graceMs) {
  const start = Date.now();
  let names = registryNames(ctx);
  while (Date.now() - start < graceMs) {
    await sleep(500);
    names = registryNames(ctx);
  }
  return names;
}

export async function apply(ctx) {
  const out = process.env.DSH_INSPECT_OUT;
  if (!out) throw new Error("intelli-inspector requires DSH_INSPECT_OUT");
  const expectTools = (process.env.DSH_INSPECT_EXPECT_TOOLS ?? "yes") === "yes";
  const deadlineMs = Number(process.env.DSH_INSPECT_DEADLINE_MS ?? 45000);
  const graceMs = Number(process.env.DSH_INSPECT_ABSENCE_GRACE_MS ?? 3000);
  const cwd = process.cwd();

  const tools = expectTools
    ? await pollForTools(ctx, deadlineMs)
    : { settled: false, waitedMs: 0, names: await settleForAbsence(ctx, graceMs), missing: [] };
  const intelliTools = tools.names.filter((name) => name.startsWith("mcp__intelli__"));
  const toolsOk = expectTools
    ? tools.settled
    : intelliTools.length === 0;

  const catalog = await ctx.skills.list({ cwd });
  const entry = catalog.find((skill) => skill.name === "intelli-search") ?? null;
  const loaded = entry ? await ctx.skills.get("intelli-search", { cwd }) : undefined;
  const skill = entry
    ? {
        name: entry.name,
        source: entry.source,
        provider: entry.provider,
        path: entry.path,
        resourceBase: entry.resourceBase,
      }
    : null;
  const skillLoaded = loaded
    ? {
        name: loaded.name,
        source: loaded.source,
        provider: loaded.provider,
        path: loaded.path,
        resourceBase: loaded.resourceBase,
        contentStartsWithFrontmatter: loaded.content.startsWith("---"),
        contentLength: loaded.content.length,
      }
    : null;
  const skillOk = expectTools
    ? skill !== null && skillLoaded !== null &&
      skill.source === "bundled" &&
      skillLoaded.contentStartsWithFrontmatter === false
    : skill === null;

  writeFileSync(
    out,
    `${JSON.stringify(
      {
        expectTools,
        toolsOk,
        skillOk,
        waitedMs: tools.waitedMs,
        intelliTools,
        missing: tools.missing,
        skill,
        skillLoaded,
      },
      null,
      2,
    )}\n`,
  );
}
