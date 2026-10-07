// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
import assert from "node:assert/strict";
import { it } from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

it("the MathML runtime uses the patched external parser, not an embedded older copy", () => {
  const defuddleRequire = createRequire(import.meta.resolve("defuddle/node"));
  const converter = defuddleRequire.resolve("mathml-to-latex");
  const converterSource = readFileSync(converter, "utf8");
  assert.match(converterSource, /require\(['"]@xmldom\/xmldom['"]\)/);
  const converterRequire = createRequire(converter);
  const parser = converterRequire.resolve("@xmldom/xmldom");
  const manifest = JSON.parse(readFileSync(join(dirname(parser), "../package.json"), "utf8"));
  const [major, minor, patch] = manifest.version.split(".").map(Number);
  assert.ok(major > 0 || minor > 9 || (minor === 9 && patch >= 12), `Review parser security for ${manifest.version}`);
  const { MathMLToLaTeX } = defuddleRequire("mathml-to-latex");
  assert.match(MathMLToLaTeX.convert("<math><mfrac><mi>x</mi><mn>2</mn></mfrac></math>"), /\\frac\{x\}\{2\}/);
});
