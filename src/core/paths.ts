// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { isAbsolute, join, relative, resolve } from "node:path";

export type CacheDisplayPolicy = "configured" | "absolute";

export interface WorkspacePaths {
  /** Absolute session workspace supplied by the adapter. */
  readonly workspaceRoot: string;
  /** May lie outside workspaceRoot for absolute or parent-relative native settings. */
  readonly cacheRoot: string;
  /** Under cacheRoot, not necessarily under workspaceRoot. */
  readonly stagingRoot: string;
  /** Textual root for prompts/results, not for filesystem access. */
  readonly cacheDisplayRoot: string;
}

/**
 * Require an absolute workspaceRoot from the adapter. A relative root is a
 * caller error: resolving it against process.cwd() would break workspace independence.
 * Absolute and parent-relative native cache settings remain supported, so
 * cacheRoot and stagingRoot may lie outside workspaceRoot. This is not an MCP
 * containment validator: that adapter must validate traversal/symlinks.
 */
export function resolveWorkspacePaths(
  workspaceRoot: string,
  cacheDir: string,
  display: CacheDisplayPolicy = "configured",
): WorkspacePaths {
  if (!isAbsolute(workspaceRoot)) throw new Error("Workspace root must be absolute");
  const root = resolve(workspaceRoot);
  const cacheRoot = resolve(root, cacheDir);
  return Object.freeze({
    workspaceRoot: root,
    cacheRoot,
    stagingRoot: join(cacheRoot, ".staging"),
    cacheDisplayRoot: display === "absolute" ? cacheRoot : cacheDir,
  });
}

/** Keep native prompt/report paths stable while physical paths are absolute. */
export function displayCachePath(paths: WorkspacePaths, physicalPath: string): string {
  return join(paths.cacheDisplayRoot, relative(paths.cacheRoot, physicalPath));
}
