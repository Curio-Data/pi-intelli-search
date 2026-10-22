// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// C19 page staging: bounded retained-page slots plus a private spool directory
// below <cacheRoot>/.staging/. A slot bounds retained page bodies: streaming
// holds it through extraction; a full-fetch barrier releases it after spooling
// and later reads staged files under bounded extraction admission. It is not a
// physical fetch permit; this helper never calls acquireFetch. The coordinator
// owns publication (RunStore.commit streams staged files through
// Artifact.stagedPath), finalisation order and the lease; this helper never
// calls the lease's abort or settle and never deletes anything outside its own
// uniquely owned staging directory.
import { randomBytes } from "node:crypto";
import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { OperationLease } from "./execution-contracts.js";

export type PageStagingErrorCode =
  | "INVALID_INPUT"
  | "ABORTED"
  | "CANCELLED"
  | "CLOSED"
  | "OVERSIZED"
  | "WRITE_ONCE"
  | "RELEASED"
  | "STAGING_FAULT";

/** Admission, write-rule or staging-filesystem rejection; never a retryable fault. */
export class PageStagingError extends Error {
  readonly code: PageStagingErrorCode;
  constructor(code: PageStagingErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PageStagingError";
    this.code = code;
  }
}

export interface PageStagingWriteResult {
  readonly stagedPath: string;
  readonly bytes: number;
}

export interface PageStagingSlot {
  readonly pageId: string;
  /**
   * Writes this slot's page content once to a private regular file. Content
   * above `maxPageBytes` by UTF-8 byte count rejects before any filesystem
   * write. The returned path is the only physical path this helper hands out.
   */
  write(content: string): Promise<PageStagingWriteResult>;
  /**
   * Idempotent. Marks the slot unwritable, settles the owned writer (if any)
   * and only then grants the slot to the longest-queued waiter. Successful
   * staged files are retained for RunStore.commit until settlement.
   */
  release(): Promise<void>;
}

export interface PageStaging {
  /**
   * FIFO logical slot admission bounded by `maxRetainedPages`. The wait is
   * cancellable through the operation or caller signal; there is no queue cap
   * (the coordinator bounds the submitted page population).
   */
  acquire(pageId: string, signal?: AbortSignal): Promise<PageStagingSlot>;
  /** Lazily creates and returns this staging's unique private directory. */
  directory(): Promise<string>;
  /**
   * Idempotent. Closes admissions, cancels queued waits and pending write
   * promises, awaits the actual writers, then removes only this staging's
   * verified owned directory. Cleanup failures propagate.
   */
  settle(): Promise<void>;
}

export interface PageStagingOptions {
  /** Absolute validated cache location captured by the coordinator. */
  readonly cacheRoot: string;
  readonly operation: OperationLease;
  /** Internal retained-page slot limit; not a new setting. */
  readonly maxRetainedPages: number;
  /** Internal UTF-8 byte ceiling per staged page; not a new setting. */
  readonly maxPageBytes: number;
  /**
   * Captured internal test seam replacing the physical staged-file write.
   * Production callers omit it and get exclusive-creation private regular files.
   */
  readonly writeStagedFile?: (path: string, content: string) => Promise<void>;
}

interface SlotRecord {
  readonly pageId: string;
  released: boolean;
  writeCalled: boolean;
  /** Whole write lifecycle; settles only after the physical writer settles. */
  work: Promise<void> | undefined;
  cancelWrite: ((error: PageStagingError) => void) | undefined;
  releasePromise: Promise<void> | undefined;
}

interface Waiter {
  readonly pageId: string;
  readonly resolve: (slot: PageStagingSlot) => void;
  readonly reject: (error: PageStagingError) => void;
  done: boolean;
  detach: () => void;
}

const STAGING_DIR = ".staging";

/**
 * Stable create-time filesystem identity of an owned directory. Shape checks
 * (directory, not a symlink) cannot prove ownership: a renamed-away original
 * replaced by a fresh ordinary directory passes them all. Device and inode are
 * compared at cleanup so only the instance-created object is ever removed.
 */
interface DirectoryIdentity {
  readonly dev: number;
  readonly ino: number;
}

async function defaultWriteStagedFile(path: string, content: string): Promise<void> {
  // Exclusive creation and private mode; a staged file is temporary spool, so
  // durability belongs to RunStore.commit, which re-reads and syncs it.
  await writeFile(path, content, { encoding: "utf-8", flag: "wx", mode: 0o600 });
}

export function createPageStaging(options: PageStagingOptions): PageStaging {
  const { cacheRoot, operation, maxRetainedPages, maxPageBytes } = options;
  if (typeof cacheRoot !== "string" || !isAbsolute(cacheRoot))
    throw new TypeError("Page staging requires an absolute cache root");
  if (
    typeof operation !== "object" ||
    operation === null ||
    !(operation.signal instanceof AbortSignal)
  )
    throw new TypeError("Page staging requires an operation lease with a signal");
  const bounds: ReadonlyArray<readonly [string, number]> = [
    ["maxRetainedPages", maxRetainedPages],
    ["maxPageBytes", maxPageBytes],
  ];
  for (const [name, value] of bounds)
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new TypeError(`Page staging requires ${name} to be a positive safe integer`);
  if (options.writeStagedFile !== undefined && typeof options.writeStagedFile !== "function")
    throw new TypeError("writeStagedFile must be a function when provided");

  const operationSignal = operation.signal;
  const stagingRoot = join(cacheRoot, STAGING_DIR);
  const writeStaged = options.writeStagedFile ?? defaultWriteStagedFile;

  let state: "open" | "settling" | "settled" = "open";
  let directoryPath: string | undefined;
  let directoryPromise: Promise<string> | undefined;
  let stagingRootIdentity: DirectoryIdentity | undefined;
  let ownedIdentity: DirectoryIdentity | undefined;
  let settlePromise: Promise<void> | undefined;
  let sequence = 0;
  const active = new Set<SlotRecord>();
  const queue: Waiter[] = [];

  const aborted = (message: string): PageStagingError =>
    new PageStagingError("ABORTED", message, { cause: operationSignal.reason });
  const cancelledBy = (signal: AbortSignal, message: string): PageStagingError =>
    new PageStagingError("CANCELLED", message, { cause: signal.reason });

  function makeSlot(pageId: string): PageStagingSlot {
    const record: SlotRecord = {
      pageId,
      released: false,
      writeCalled: false,
      work: undefined,
      cancelWrite: undefined,
      releasePromise: undefined,
    };
    active.add(record);
    return Object.freeze({
      pageId,
      write: (content: string) => write(record, content),
      release: () => release(record),
    });
  }

  function grantNext(): void {
    while (active.size < maxRetainedPages && queue.length > 0) {
      const waiter = queue.shift();
      if (!waiter || waiter.done) continue;
      waiter.done = true;
      waiter.detach();
      waiter.resolve(makeSlot(waiter.pageId));
    }
  }

  function cancelWaiter(waiter: Waiter, signal: AbortSignal): void {
    if (waiter.done) return;
    waiter.done = true;
    waiter.detach();
    const index = queue.indexOf(waiter);
    if (index >= 0) queue.splice(index, 1);
    waiter.reject(
      signal === operationSignal
        ? aborted(`Page ${waiter.pageId} admission was cancelled by operation abort`)
        : cancelledBy(signal, `Page ${waiter.pageId} admission was cancelled`),
    );
  }

  function acquire(pageId: string, signal?: AbortSignal): Promise<PageStagingSlot> {
    if (typeof pageId !== "string" || pageId.length === 0)
      return Promise.reject(
        new PageStagingError("INVALID_INPUT", "pageId must be a non-empty string"),
      );
    if (signal !== undefined && !(signal instanceof AbortSignal))
      return Promise.reject(
        new PageStagingError("INVALID_INPUT", "signal must be an AbortSignal when provided"),
      );
    if (state !== "open")
      return Promise.reject(new PageStagingError("CLOSED", "Page staging has settled"));
    if (operationSignal.aborted)
      return Promise.reject(aborted("Page admission rejected after operation abort"));
    if (signal?.aborted)
      return Promise.reject(
        cancelledBy(signal, `Page ${pageId} admission was cancelled before queueing`),
      );
    if (active.size < maxRetainedPages) return Promise.resolve(makeSlot(pageId));
    return new Promise<PageStagingSlot>((resolve, reject) => {
      const waiter: Waiter = { pageId, resolve, reject, done: false, detach: () => undefined };
      const onOperationAbort = () => cancelWaiter(waiter, operationSignal);
      const callerSignal = signal && signal !== operationSignal ? signal : undefined;
      const onCallerAbort = callerSignal ? () => cancelWaiter(waiter, callerSignal) : undefined;
      waiter.detach = () => {
        operationSignal.removeEventListener("abort", onOperationAbort);
        if (onCallerAbort && callerSignal)
          callerSignal.removeEventListener("abort", onCallerAbort);
      };
      operationSignal.addEventListener("abort", onOperationAbort, { once: true });
      if (onCallerAbort && callerSignal)
        callerSignal.addEventListener("abort", onCallerAbort, { once: true });
      queue.push(waiter);
    });
  }

  async function ensureDirectory(): Promise<string> {
    // Refuse a symlinked cache root before creating anything through it.
    const existing = await lstat(cacheRoot).catch(() => undefined);
    if (existing?.isSymbolicLink())
      throw new PageStagingError("STAGING_FAULT", `Cache root ${cacheRoot} is a symbolic link`);
    await mkdir(stagingRoot, { recursive: true });
    const cacheInfo = await lstat(cacheRoot);
    if (!cacheInfo.isDirectory() || cacheInfo.isSymbolicLink())
      throw new PageStagingError("STAGING_FAULT", `Cache root ${cacheRoot} is not a real directory`);
    const rootInfo = await lstat(stagingRoot);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
      throw new PageStagingError(
        "STAGING_FAULT",
        `Staging root ${stagingRoot} is not a real directory`,
      );
    stagingRootIdentity = { dev: rootInfo.dev, ino: rootInfo.ino };
    // mkdtemp is exclusive and private (0o700), so no collision retry is needed.
    const dir = await mkdtemp(join(stagingRoot, "pages-"));
    // Capture the created directory's identity immediately; the pair is only
    // complete together, so cleanup never runs against a half-captured state.
    const dirInfo = await lstat(dir);
    ownedIdentity = { dev: dirInfo.dev, ino: dirInfo.ino };
    directoryPath = dir;
    return dir;
  }

  function directory(): Promise<string> {
    if (state !== "open")
      return Promise.reject(new PageStagingError("CLOSED", "Page staging has settled"));
    if (operationSignal.aborted)
      return Promise.reject(aborted("Staging directory unavailable after operation abort"));
    directoryPromise ??= ensureDirectory();
    return directoryPromise;
  }

  async function write(
    record: SlotRecord,
    content: string,
  ): Promise<PageStagingWriteResult> {
    if (typeof content !== "string")
      throw new PageStagingError("INVALID_INPUT", "Staged content must be a string");
    if (record.released)
      throw new PageStagingError(
        "RELEASED",
        `Page ${record.pageId} slot was released before this write`,
      );
    if (record.writeCalled)
      throw new PageStagingError(
        "WRITE_ONCE",
        `Page ${record.pageId} slot already consumed its single write`,
      );
    if (state !== "open") throw new PageStagingError("CLOSED", "Page staging has settled");
    if (operationSignal.aborted)
      throw aborted(`Page ${record.pageId} write rejected after operation abort`);
    record.writeCalled = true;
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > maxPageBytes)
      throw new PageStagingError(
        "OVERSIZED",
        `Page ${record.pageId} content is ${bytes} UTF-8 bytes; the limit is ${maxPageBytes}`,
      );
    let settleWork!: () => void;
    record.work = new Promise<void>((resolve) => {
      settleWork = resolve;
    });
    let workSettled = false;
    const settleWorkOnce = (): void => {
      if (workSettled) return;
      workSettled = true;
      settleWork();
    };
    let underlying: Promise<void> | undefined;
    try {
      const dir = await directory();
      if (state !== "open") throw new PageStagingError("CLOSED", "Page staging has settled");
      if (operationSignal.aborted)
        throw aborted(`Page ${record.pageId} write cancelled by operation abort`);
      // pageId never becomes a path component; names are internal and unique.
      const path = join(
        dir,
        `page-${String(++sequence).padStart(6, "0")}-${randomBytes(6).toString("hex")}`,
      );
      const writer = writeStaged(path, content);
      underlying = writer;
      const facing = new Promise<PageStagingWriteResult>((resolve, reject) => {
        let settled = false;
        const settleFacing = (deliver: () => void) => {
          if (settled) return;
          settled = true;
          operationSignal.removeEventListener("abort", onAbort);
          deliver();
        };
        const onAbort = () =>
          settleFacing(() =>
            reject(aborted(`Page ${record.pageId} write cancelled by operation abort`)),
          );
        operationSignal.addEventListener("abort", onAbort, { once: true });
        record.cancelWrite = (error) => settleFacing(() => reject(error));
        writer.then(
          () => settleFacing(() => resolve({ stagedPath: path, bytes })),
          (error: unknown) => settleFacing(() => reject(error)),
        );
      });
      // The caller observes cancellation promptly: the write promise settles
      // with the facing outcome, never held open by a stalled physical writer.
      // The physical writer stays owned: record.work settles only after BOTH
      // the facing outcome and the writer settle, so release()/settle() still
      // await it and no later slot is granted early. This continuation runs to
      // completion on its own (allSettled cannot reject, facing settles no
      // later than the writer); it is not an abandoned promise or a timeout.
      Promise.allSettled([facing, writer]).then(() => settleWorkOnce());
      return await facing;
    } finally {
      // With a started writer, the allSettled continuation owns work
      // settlement. The body settles work here only for pre-writer faults
      // (directory fault or early state/abort recheck), where there is no
      // physical writer to await.
      if (!underlying) settleWorkOnce();
    }
  }

  function release(record: SlotRecord): Promise<void> {
    record.released = true;
    record.releasePromise ??= (async () => {
      // work never rejects; a failed write's error belongs to its own caller.
      await record.work;
      active.delete(record);
      grantNext();
    })();
    return record.releasePromise;
  }

  async function removeOwnedDirectory(path: string): Promise<void> {
    // Re-verify both levels: a replaced root or directory is never followed.
    const rootInfo = await lstat(stagingRoot).catch(() => undefined);
    if (!rootInfo || !rootInfo.isDirectory() || rootInfo.isSymbolicLink())
      throw new PageStagingError(
        "STAGING_FAULT",
        `Staging root ${stagingRoot} is missing or was replaced; refusing cleanup`,
      );
    // A real directory at the expected path is not proof of ownership: only
    // the create-time device/inode identity is. Fail closed when the identity
    // was never captured.
    if (
      rootInfo.dev !== stagingRootIdentity?.dev ||
      rootInfo.ino !== stagingRootIdentity?.ino
    )
      throw new PageStagingError(
        "STAGING_FAULT",
        `Staging root ${stagingRoot} was replaced by a different directory; refusing cleanup`,
      );
    if (dirname(path) !== stagingRoot)
      throw new PageStagingError("STAGING_FAULT", `Refusing to clean a path outside ${stagingRoot}`);
    const info = await lstat(path).catch(() => undefined);
    if (!info) return; // Already removed; nothing owned remains.
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new PageStagingError(
        "STAGING_FAULT",
        `Owned staging directory ${path} was replaced; refusing cleanup`,
      );
    if (info.dev !== ownedIdentity?.dev || info.ino !== ownedIdentity?.ino)
      throw new PageStagingError(
        "STAGING_FAULT",
        `Owned staging directory ${path} was replaced by a different directory; refusing cleanup`,
      );
    await rm(path, { recursive: true, force: true }).catch((error: unknown) => {
      throw new PageStagingError("STAGING_FAULT", `Failed to remove staging directory ${path}`, {
        cause: error,
      });
    });
  }

  async function performSettle(): Promise<void> {
    state = "settling";
    try {
      for (const waiter of queue.splice(0)) {
        if (waiter.done) continue;
        waiter.done = true;
        waiter.detach();
        waiter.reject(
          new PageStagingError(
            "CANCELLED",
            `Page ${waiter.pageId} admission was cancelled by staging settlement`,
          ),
        );
      }
      const slots = [...active];
      for (const slot of slots)
        slot.cancelWrite?.(
          new PageStagingError(
            "CANCELLED",
            `Page ${slot.pageId} write was cancelled by staging settlement`,
          ),
        );
      await Promise.allSettled(slots.map((slot) => slot.work ?? Promise.resolve()));
      await Promise.allSettled(slots.map((slot) => slot.releasePromise ?? Promise.resolve()));
      if (directoryPromise) await directoryPromise.then(() => undefined, () => undefined);
      if (directoryPath) await removeOwnedDirectory(directoryPath);
    } finally {
      state = "settled";
    }
  }

  function settle(): Promise<void> {
    settlePromise ??= performSettle();
    return settlePromise;
  }

  return Object.freeze({ acquire, directory, settle });
}
