// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// scripts/dsh-host-metadata.mjs
//
// Single source of the DeepSeek Harness (dsh) host metadata that generated
// documentation and the bundle manifest state: the declared engine range,
// the Node.js floor, the reference host and every tested host. The MCP
// version is never stored here; it is read from packages/mcp/package.json,
// the version the bundle launcher pins.
//
// Generators substitute these values for double-brace tokens (see TOKENS).
// Tokens are confined to hidden dsh README blocks and agent guidance; visible
// root prose uses readable literals that tests check against this module.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

/** Declared `engines.dsh` range of the bundle: compatibility, not coverage. */
export const DSH_ENGINES_RANGE = ">=0.2.2-rc.1 <0.3.0";

/** Declared `engines.node` range of the bundle: the harness's own floor. */
export const DSH_NODE_ENGINES_RANGE = ">=24.9.0";

/** Reference host for host-specific statements (timeouts, skill precedence). */
export const DSH_REFERENCE_VERSION = "0.2.2-rc.1";

/** Every dsh host the credential-free verification has passed on, oldest first. */
export const DSH_TESTED_VERSIONS = Object.freeze(["0.2.2-rc.1", "0.2.2-rc.5"]);

/** Token names the generators substitute; DSH_CONTENTS is structural, not metadata. */
export const METADATA_TOKENS = Object.freeze([
  "MCP_VERSION",
  "DSH_ENGINES_RANGE",
  "DSH_NODE_ENGINES_RANGE",
  "DSH_REFERENCE_VERSION",
  "DSH_TESTED_VERSIONS",
]);
export const CONTENTS_TOKEN = "{{DSH_CONTENTS}}";

/** The MCP package version the dsh bundle launches. */
export function readMcpVersion(root = REPO_ROOT) {
  const manifest = JSON.parse(readFileSync(join(root, "packages/mcp/package.json"), "utf8"));
  if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) {
    throw new Error(`packages/mcp/package.json: invalid version ${JSON.stringify(manifest.version)}`);
  }
  return manifest.version;
}

/** Complete metadata record for one repository root. */
export function dshHostMetadata(root = REPO_ROOT) {
  return {
    mcpVersion: readMcpVersion(root),
    enginesRange: DSH_ENGINES_RANGE,
    nodeEnginesRange: DSH_NODE_ENGINES_RANGE,
    referenceVersion: DSH_REFERENCE_VERSION,
    testedVersions: [...DSH_TESTED_VERSIONS],
  };
}

/** Render a version list as readable prose: `a`, `b` and `c`. */
export function formatVersionList(versions) {
  const quoted = versions.map((v) => `\`${v}\``);
  if (quoted.length === 0) throw new Error("tested-host list is empty");
  if (quoted.length === 1) return quoted[0];
  return `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
}

/** Token name -> substituted text. Versions and ranges are inserted bare. */
export function metadataTokenValues(meta) {
  return {
    MCP_VERSION: meta.mcpVersion,
    DSH_ENGINES_RANGE: meta.enginesRange,
    DSH_NODE_ENGINES_RANGE: meta.nodeEnginesRange,
    DSH_REFERENCE_VERSION: meta.referenceVersion,
    DSH_TESTED_VERSIONS: formatVersionList(meta.testedVersions),
  };
}

/**
 * Replace every metadata token. Leaves {{DSH_CONTENTS}} and any other
 * double-brace text in place, so the caller's unreplaced-token check fails on
 * misspelt or unsupported tokens instead of this helper hiding them.
 */
export function substituteMetadata(text, meta) {
  let out = text;
  for (const [name, value] of Object.entries(metadataTokenValues(meta))) {
    out = out.replaceAll(`{{${name}}}`, value);
  }
  return out;
}
