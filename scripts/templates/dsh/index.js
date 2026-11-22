// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// Generated into plugins/dsh/index.js by scripts/generate-plugin-bundles.mjs
// from this template; the generated copy is the one the host loads. Do not
// edit the generated file.
//
// Cordis object plugin for DeepSeek Harness: registers the bundled
// intelli-search skill with the host skill registry when the bundle loads.
// It imports nothing from the host and has no package dependencies, so the
// bundle needs no peer requirements. Runtime skill registration does not
// parse Markdown frontmatter, so this module parses the generator's exact
// frontmatter shape (a leading `---` block whose lines are `name:`,
// `description:` and an optional `whenToUse:`) and registers the
// frontmatter-free body. It is not a general YAML parser; any other line in
// the block is rejected.

import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const name = "intelli-search-skill";
export const inject = ["skills"];

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(raw) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  if (!match) {
    throw new Error("intelli-search skill is missing its frontmatter block");
  }
  const fields = {};
  for (const line of match[1].split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) {
      throw new Error(`unsupported frontmatter line in intelli-search skill: ${line}`);
    }
    const key = line.slice(0, separator).trim();
    if (key !== "name" && key !== "description" && key !== "whenToUse") {
      throw new Error(`unsupported frontmatter key in intelli-search skill: ${key}`);
    }
    fields[key] = unquote(line.slice(separator + 1));
  }
  if (!fields.name) {
    throw new Error("intelli-search skill frontmatter is missing a name");
  }
  if (!fields.description) {
    throw new Error("intelli-search skill frontmatter is missing a description");
  }
  const registration = { name: fields.name, description: fields.description };
  if (fields.whenToUse) {
    registration.whenToUse = fields.whenToUse;
  }
  return { registration, content: raw.slice(match[0].length) };
}

export function apply(ctx) {
  const skillUrl = new URL("./skills/intelli-search/SKILL.md", import.meta.url);
  const path = fileURLToPath(skillUrl);
  const { registration, content } = parseFrontmatter(readFileSync(path, "utf8"));
  ctx.skills.register({
    ...registration,
    source: "bundled",
    path,
    content,
    resourceBase: {
      kind: "directory",
      path: dirname(path),
    },
  });
}
