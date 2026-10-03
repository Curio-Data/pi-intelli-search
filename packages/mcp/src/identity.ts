// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { readFileSync } from "node:fs";
import type { PackageIdentity } from "../../../src/core/contracts.js";

// Adapter entrypoints live one level below their own manifest, both in source and dist.
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
export const identity: PackageIdentity = Object.freeze({
  name: manifest.name,
  version: manifest.version,
  adapter: "mcp",
});
