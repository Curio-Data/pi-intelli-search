// test/dsh-release.test.ts — Deterministic contract tests for the
// @curio-data/dsh-intelli-search third-package release route. They pin what
// the tracked workflows and generated manifests must say; they do not prove
// GitHub Actions execution, which stays Unknown until an authorised release
// run. No network: `npm view` appears only as workflow text.
import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const release = readFileSync(join(REPO_ROOT, ".github/workflows/release.yml"), "utf8");
const ci = readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
const dshManifest = JSON.parse(
  readFileSync(join(REPO_ROOT, "plugins/dsh/package.json"), "utf8"),
) as { name: string; version: string };
const mcpManifest = JSON.parse(
  readFileSync(join(REPO_ROOT, "packages/mcp/package.json"), "utf8"),
) as { name: string; version: string };

it("selects the dsh package, directory and version from a dsh-v tag", () => {
  assert.match(release, /\^dsh-v\(\.\+\)\$/);
  // The dsh branch must resolve before the native fallback ordering can
  // swallow it and must emit all three selection outputs.
  const dshBranch = release.split("elif [[ \"$tag\" =~ ^dsh-v(.+)$ ]]; then")[1]?.split("elif")[0] ?? "";
  assert.ok(dshBranch.length > 0, "release.yml has a dsh-v tag branch");
  assert.ok(dshBranch.includes("package=@curio-data/dsh-intelli-search"));
  assert.ok(dshBranch.includes("directory=plugins/dsh"));
  assert.ok(dshBranch.includes("version=${version}"));
  assert.match(
    release,
    /'dsh-vX\.Y\.Z' for the DeepSeek Harness bundle/,
    "unrecognised-tag diagnostic names the dsh route",
  );
});

it("guards dsh staging on the exact published MCP version", () => {
  const guardIndex = release.indexOf("Require the exact published MCP version before dsh staging");
  assert.ok(guardIndex > 0, "release.yml has the dsh staging guard");
  const guard = release.slice(guardIndex, release.indexOf("- name: Build both artifacts", guardIndex));
  assert.ok(guard.includes('cd "$probe"'));
  assert.ok(guard.includes('npm exec --yes --package="@curio-data/mcp-intelli-search@${TAG_VERSION}"'));
  assert.ok(guard.includes('mcp-intelli-search --host dsh --workspace "$probe/project" --check-config'));
  assert.match(
    guard,
    /if: steps\.select\.outputs\.package == '@curio-data\/dsh-intelli-search'/,
    "guard applies only to dsh releases",
  );
  assert.match(
    guard,
    /npm view "@curio-data\/mcp-intelli-search@\$\{TAG_VERSION\}" version/,
    "guard resolves the exact pinned MCP version",
  );
  assert.match(
    guard,
    /test "\$mcp_manifest" = "\$TAG_VERSION"/,
    "guard requires the MCP manifest to mirror the dsh tag version",
  );
  const stageIndex = release.indexOf("- name: Stage publish");
  assert.ok(stageIndex > guardIndex, "the MCP-before-dsh guard precedes staging");
});

it("keeps the native/MCP coupled release rule unchanged for the other packages", () => {
  assert.match(
    release,
    /Require matching package minor versions before native staging/,
    "native staging guard retained",
  );
  assert.match(release, /if: steps\.select\.outputs\.package == '@curio-data\/pi-intelli-search'/);
});

it("checks the dsh pack inventory in CI and release verification", () => {
  for (const [name, workflow] of [
    ["ci.yml", ci],
    ["release.yml", release],
  ] as const) {
    assert.match(
      workflow,
      /Verify the dsh bundle pack inventory/,
      `${name} has the dsh pack check`,
    );
    const step = workflow.split("- name: Verify the dsh bundle pack inventory")[1]?.split("- name:")[0] ?? "";
    assert.ok(step.includes("cd plugins/dsh"), `${name} packs in the bundle directory`);
    assert.match(step, /npm pack --dry-run --json --ignore-scripts/, `${name} packs without scripts`);
    assert.match(step, /any\(startswith\("vendor"\)\) \| not/, `${name} rejects a vendor tree`);
    assert.match(step, /any\(\. == "cordis.patch\.yml"\)/, `${name} requires the patch`);
    assert.match(step, /any\(\. == "LICENSE"\)/, `${name} requires the licence`);
  }
});

it("requires the same-version dsh package in the main/PR publication guard", () => {
  const step = ci.split("- name: Require published catalog pins before merging to main")[1]?.split("- name:")[0] ?? "";
  assert.ok(step.length > 0, "ci.yml has the publication guard");
  assert.match(step, /npm view "@curio-data\/mcp-intelli-search@\$version" version/);
  assert.match(step, /npm view "@curio-data\/dsh-intelli-search@\$version" version/);
  assert.match(
    step,
    /test "\$dsh_version" = "\$version"/,
    "dsh manifest must mirror the MCP version before merge",
  );
  assert.match(
    step,
    /removes the early-merge allowance/i,
    "the guard records the dsh-carrying branch consequence",
  );
});

it("keeps the dsh host out of the Node 22 CI job", () => {
  assert.doesNotMatch(ci, /DSH_BIN/, "CI installs no dsh host");
  assert.doesNotMatch(ci, /@deepseek-ai\/dsh/, "CI adds no dsh dependency");
  assert.match(ci, /node-version: 22/, "CI stays on the standalone Node floor");
});

it("mirrors the MCP manifest version in the generated dsh manifest", () => {
  assert.strictEqual(dshManifest.name, "@curio-data/dsh-intelli-search");
  assert.strictEqual(dshManifest.version, mcpManifest.version);
});
