// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// C25 kernel-released writer lock on the permanent regular file
// `.intelli-v1/writer.lock`. Each acquisition opens a fresh descriptor on the
// same path/inode and polls the nonblocking open-file-description lock; the
// kernel releases it when the descriptor or process dies. The lockfile is never
// unlinked, renamed, replaced or truncated, and no age/PID eviction exists.
/// <reference path="./run-lock-binding.d.ts" />

import { constants } from "node:fs";
import { lstat, open, rename, writeFile, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import type { Clock, Diagnostic } from "./execution-contracts.js";
import {
  LOCK_FILE,
  OWNER_FILE,
  OWNER_MAX_BYTES,
  encodeRecord,
  isValid,
  WriterOwnerSchema,
  type WriterOwner,
} from "./run-format.js";

export const LOCK_POLL_MS = 25;
export const LOCK_WAIT_MS = 2_000;

/** The only two primitives C25 selects; the blocking wait API is not used. */
export interface LockBinding {
  tryLock(fd: number): boolean;
  unlock(fd: number): void;
}
export type LockBindingLoader = () => Promise<LockBinding>;

let nativeBinding: Promise<LockBinding> | undefined;

/**
 * Lazy native load on persistence demand. A failed load is not cached, so a
 * later operation may retry; it never fails extension or server import.
 */
export const loadNativeLockBinding: LockBindingLoader = () => {
  nativeBinding ??= (async () => {
    const loaded: Partial<LockBinding> & { default?: Partial<LockBinding> } =
      await import("fs-native-extensions");
    const api = typeof loaded.tryLock === "function" ? loaded : loaded.default;
    if (typeof api?.tryLock !== "function" || typeof api.unlock !== "function")
      throw new Error("fs-native-extensions does not expose tryLock/unlock");
    const { tryLock, unlock } = api;
    return { tryLock: (fd) => tryLock(fd), unlock: (fd) => unlock(fd) };
  })();
  nativeBinding.catch(() => (nativeBinding = undefined));
  return nativeBinding;
};

export interface HeldLock {
  readonly path: string;
  readonly dev: number;
  readonly ino: number;
  /** Idempotent: unlock is attempted once, then the descriptor is closed. */
  release(): Promise<void>;
}

export type LockAcquisition =
  | { readonly status: "acquired"; readonly lock: HeldLock }
  | { readonly status: "unavailable"; readonly diagnostic: Diagnostic };

export interface AcquireOptions {
  readonly namespaceDir: string;
  readonly clock: Clock;
  readonly signal: AbortSignal;
  readonly loadBinding: LockBindingLoader;
}

function unavailable(code: string, message: string): LockAcquisition {
  return { status: "unavailable", diagnostic: { code, message } };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function acquireWriterLock(options: AcquireOptions): Promise<LockAcquisition> {
  const path = join(options.namespaceDir, LOCK_FILE);
  if (options.signal.aborted) return unavailable("ABORTED", `Cancelled before locking ${path}`);
  let binding: LockBinding;
  try {
    binding = await options.loadBinding();
  } catch (error) {
    return unavailable(
      "LOCK_BACKEND_UNAVAILABLE",
      `Run persistence is unavailable: the native lock backend could not load for ${path} (${describe(error)}). The answer is returned without a saved report.`,
    );
  }
  try {
    const existing = await lstat(path);
    if (!existing.isFile())
      return unavailable("LOCK_NOT_REGULAR", `Writer lock ${path} is not a regular file`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      return unavailable("LOCK_IO", `Cannot inspect writer lock ${path}: ${describe(error)}`);
  }
  let handle: FileHandle;
  try {
    // O_CREAT without O_TRUNC: the permanent inode is created once and reused.
    // libuv opens descriptors close-on-exec, so children never inherit it.
    handle = await open(
      path,
      constants.O_RDWR | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
  } catch (error) {
    return unavailable("LOCK_IO", `Cannot open writer lock ${path}: ${describe(error)}`);
  }
  const close = async () => {
    await handle.close().catch(() => undefined);
  };
  const start = options.clock.monotonicMs();
  for (;;) {
    if (options.signal.aborted) {
      await close();
      return unavailable("ABORTED", `Cancelled while waiting for writer lock ${path}`);
    }
    let acquired: boolean;
    try {
      acquired = binding.tryLock(handle.fd);
    } catch (error) {
      await close();
      return unavailable(
        "LOCK_UNSUPPORTED",
        `The filesystem rejected the writer lock ${path} (${describe(error)}); run persistence is unavailable on this storage.`,
      );
    }
    if (acquired) break;
    if (options.clock.monotonicMs() - start >= LOCK_WAIT_MS) {
      await close();
      return unavailable(
        "LOCK_BUSY",
        `Writer lock ${path} stayed busy for ${LOCK_WAIT_MS} ms; another writer holds it. The answer is returned without a saved report.`,
      );
    }
    try {
      await options.clock.sleep(LOCK_POLL_MS, options.signal);
    } catch {
      await close();
      return unavailable("ABORTED", `Cancelled while waiting for writer lock ${path}`);
    }
  }
  let released: Promise<void> | undefined;
  const release = () => {
    released ??= (async () => {
      try {
        binding.unlock(handle.fd);
      } catch {
        // Closing the descriptor below releases the lock regardless.
      } finally {
        await close();
      }
    })();
    return released;
  };
  try {
    const held = await handle.stat();
    const named = await lstat(path);
    if (!named.isFile() || named.dev !== held.dev || named.ino !== held.ino) {
      await release();
      return unavailable(
        "LOCK_INODE_CHANGED",
        `Writer lock ${path} no longer names the locked inode; a foreign process replaced it. Stop all writers before recovery.`,
      );
    }
    return { status: "acquired", lock: { path, dev: held.dev, ino: held.ino, release } };
  } catch (error) {
    await release();
    return unavailable("LOCK_IO", `Cannot verify writer lock ${path}: ${describe(error)}`);
  }
}

/**
 * Bounded diagnostic owner metadata, written atomically only while the lock is
 * held. It is never read to decide ownership; a stale file is not a held lock.
 */
export async function writeOwnerDiagnostic(
  namespaceDir: string,
  owner: WriterOwner,
  nonce: string,
): Promise<boolean> {
  try {
    if (!isValid(WriterOwnerSchema, owner)) return false;
    const bytes = encodeRecord(owner);
    if (bytes.byteLength > OWNER_MAX_BYTES) return false;
    const target = join(namespaceDir, OWNER_FILE);
    const temp = join(namespaceDir, `.${OWNER_FILE}.${nonce}.tmp`);
    await writeFile(temp, bytes, { flag: "wx", mode: 0o600 });
    await rename(temp, target);
    return true;
  } catch {
    return false;
  }
}
