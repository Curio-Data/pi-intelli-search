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
  const workspace = await lstat(paths.workspaceRoot);
  if (
    !workspace.isDirectory() ||
    workspace.isSymbolicLink() ||
    (await realpath(paths.workspaceRoot)) !== paths.workspaceRoot
  )
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
    if (descend && entry.isDirectory()) {
      const requiredRoot = path === paths.cacheRoot || path === paths.stagingRoot;
      let names: string[];
      try {
        names = await readdir(path);
      } catch (error) {
        // Parallel operations may remove their private spool directories. Cache
        // and staging roots are identities, not disposable operation artefacts.
        if (!requiredRoot && (error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw new Error("Cannot inspect workspace cache directory");
      }
      for (const name of names) await inspect(join(path, name), true);
      let after;
      try {
        after = await lstat(path);
      } catch (error) {
        if (!requiredRoot && (error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw new Error("Cache directory identity changed during safety scan");
      }
      if (
        !after.isDirectory() ||
        after.isSymbolicLink() ||
        after.dev !== entry.dev ||
        after.ino !== entry.ino
      )
        throw new Error("Cache directory identity changed during safety scan");
    }
  }
  let path = paths.workspaceRoot;
  for (const part of parts) {
    path = join(path, part);
    const before = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    await inspect(path, path === paths.cacheRoot);
    if (before) {
      const after = await lstat(path).catch(() => undefined);
      if (
        !after ||
        !after.isDirectory() ||
        after.isSymbolicLink() ||
        after.dev !== before.dev ||
        after.ino !== before.ino
      )
        throw new Error("Cache root identity changed during safety scan");
    }
  }
  const after = await lstat(paths.workspaceRoot);
  if (
    after.dev !== workspace.dev ||
    after.ino !== workspace.ino ||
    after.isSymbolicLink() ||
    (await realpath(paths.workspaceRoot)) !== paths.workspaceRoot
  )
    throw new Error("Workspace identity changed during safety scan");
}
export async function workspacePaths(workspace: string, cacheDir: string): Promise<WorkspacePaths> {
  validateCacheDir(cacheDir);
  const paths = resolveWorkspacePaths(workspace, cacheDir, "absolute");
  await assertWorkspaceSafe(paths);
  return paths;
}
