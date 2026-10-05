// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { lstat, readdir, realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { resolveWorkspacePaths, type WorkspacePaths } from "../../../src/core/paths.js";
import { throwIfAborted } from "../../../src/core/util.js";
import { validateCacheDir } from "./config.js";

/** Reject existing links, including dangling links and links in cached artifact subtrees. */
export async function assertWorkspaceSafe(
  paths: WorkspacePaths,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  if ((await realpath(paths.workspaceRoot)) !== paths.workspaceRoot)
    throw new Error("Workspace identity changed");
  const parts = relative(paths.workspaceRoot, paths.cacheRoot).split(sep);
  if (!parts.length || parts.some((part) => !part || part === ".."))
    throw new Error("Cache must remain inside the workspace");
  let count = 0;
  async function inspect(path: string, descend: boolean): Promise<void> {
    throwIfAborted(signal);
    if (++count > 100_000)
      throw new Error("Cache safety scan exceeds 100000 entries; use a smaller cache directory");
    let entry;
    try {
      entry = await lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw new Error("Cannot inspect workspace cache");
    }
    if (entry.isSymbolicLink() || (entry.isFile() && entry.nlink > 1))
      throw new Error("Cache links are not allowed; select an unlinked workspace-local cache");
    if (!entry.isFile() && !entry.isDirectory())
      throw new Error("Cache contains an unsupported filesystem entry");
    if (
      (!descend || path === paths.cacheRoot || path === paths.stagingRoot) &&
      !entry.isDirectory()
    )
      throw new Error("Cache and staging roots and their ancestors must be directories");
    if (descend && entry.isDirectory())
      for (const name of await readdir(path)) await inspect(join(path, name), true);
  }
  let path = paths.workspaceRoot;
  for (const part of parts) {
    path = join(path, part);
    await inspect(path, path === paths.cacheRoot);
  }
}
export async function workspacePaths(workspace: string, cacheDir: string): Promise<WorkspacePaths> {
  validateCacheDir(cacheDir);
  const paths = resolveWorkspacePaths(workspace, cacheDir, "absolute");
  await assertWorkspaceSafe(paths);
  return paths;
}
