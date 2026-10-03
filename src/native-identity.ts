// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PackageIdentity } from "./core/contracts.js";

let cachedIdentity: PackageIdentity | undefined;

/** Native adapter owns manifest discovery. Works from src/ and packed dist/. */
export async function getNativeIdentity(): Promise<PackageIdentity> {
  if (cachedIdentity) return cachedIdentity;
  const path = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  try {
    const pkg = JSON.parse(await readFile(path, "utf8")) as { name?: unknown; version?: unknown };
    cachedIdentity = {
      name: typeof pkg.name === "string" ? pkg.name : "@curio-data/pi-intelli-search",
      version: typeof pkg.version === "string" && pkg.version ? pkg.version : "unknown",
      adapter: "pi",
    };
  } catch {
    cachedIdentity = { name: "@curio-data/pi-intelli-search", version: "unknown", adapter: "pi" };
  }
  return cachedIdentity;
}

export async function getExtensionVersion(): Promise<string> {
  return (await getNativeIdentity()).version;
}

export async function readVersionFromPackageJson(pkgPath: string): Promise<string> {
  try {
    const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" && pkg.version.length > 0 ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

export function _resetVersionCacheForTests(): void {
  cachedIdentity = undefined;
}
