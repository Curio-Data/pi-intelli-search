// test/compat-guard.test.ts — guards the pi-ai/compat migration
//
// @earendil-works/pi-ai documents its /compat entrypoint as temporary:
// "This module is deleted with the coding-agent ModelManager migration", and
// the Pi changelog commits to removing the entrypoint (and the extension
// loader alias that resolves the root to it) in a future release. No source or
// test file may import from "@earendil-works/pi-ai/compat" — imports use the
// stable root entrypoint, whose Provider/createModels API has been exported
// since pi-ai 0.80.8.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|mts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("pi-ai compat import guard", () => {
  // Match import/export/dynamic-import SPECIFIERS only (a quote immediately
  // before the module path). Prose mentions of the deprecated entrypoint in
  // comments and docs are legitimate and ignored. This file exempts itself
  // because it necessarily quotes the pattern in its title and comments.
  const specifier = /["']@earendil-works\/pi-ai\/compat\b/;
  const guard = join(process.cwd(), "test", "compat-guard.test.ts");
  it("no src/ or test/ file imports from @earendil-works/pi-ai/compat", () => {
    const offenders = [...walk(join(process.cwd(), "src")), ...walk(join(process.cwd(), "test"))]
      .filter((file) => file !== guard)
      .filter((file) => specifier.test(readFileSync(file, "utf8")));
    assert.deepStrictEqual(
      offenders,
      [],
      "pi-ai/compat is a deprecated entrypoint slated for removal; import from @earendil-works/pi-ai instead",
    );
  });
});
