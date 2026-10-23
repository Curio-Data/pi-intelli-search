// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// M4 growth and recovery qualification support. This module is dual purpose:
//
// 1. Shared fixtures for test/cache-growth-qualification.test.ts: profile and
//    evidence plumbing, encrypted scratch roots, the pinned old-writer source
//    extractor and deterministic byte-witness hashing.
// 2. The independent-process worker driven by runGrowthWorker(): a current-tree
//    run-store writer, the pinned pi-v0.19.0 legacy writer and a lock holder.
//
// Nothing here mutates shared git state, installs packages, lowers production
// constants or deletes historical evidence. Old-tag source extraction stays
// under the repository's encrypted .tmp scratch, never /tmp.

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Clock } from "../../src/core/execution-contracts.js";
import { createRunStore } from "../../src/core/run-store.js";
import { acquireWriterLock, loadNativeLockBinding } from "../../src/core/run-lock.js";
import { NAMESPACE_DIR } from "../../src/core/run-format.js";
import { artifactsFor, storeOptions } from "./run-store-fixtures.js";

export const growthRepo = fileURLToPath(new URL("../../", import.meta.url));
export const GROWTH_SCRATCH_DIR = join(growthRepo, ".tmp", "m4-growth");

export type GrowthProfile = "default" | "full";

/**
 * Unset or empty means the small deterministic profile. An explicit but
 * unknown value (for example a mistyped "ful") is refused loudly instead of
 * silently running a reduced population under the default name.
 */
export function growthProfile(): GrowthProfile {
  const raw = process.env.INTELLI_GROWTH_PROFILE;
  if (raw === undefined || raw === "") return "default";
  if (raw === "default" || raw === "full") return raw;
  throw new Error(
    `Unknown INTELLI_GROWTH_PROFILE ${JSON.stringify(raw)}: expected "default" or "full". Refusing to silently treat a mistyped profile name as the small default population.`,
  );
}

export function evidenceDir(): string | undefined {
  const value = process.env.INTELLI_GROWTH_EVIDENCE;
  return value && value.length > 0 ? resolve(value) : undefined;
}

/** Scratch always lives under the encrypted checkout, never the system temp. */
export async function growthScratchRoot(label: string): Promise<string> {
  await mkdir(GROWTH_SCRATCH_DIR, { recursive: true });
  return mkdtemp(join(GROWTH_SCRATCH_DIR, `${label}-`));
}

/** The pinned old writer: exact tag and commit required by the growth contract. */
export const OLD_WRITER_TAG = "pi-v0.19.0";
export const OLD_WRITER_COMMIT = "17fccb388d2016fe46aab91521711197522e502a";

export class OldSourceUnavailable extends Error {
  constructor(
    message: string,
    readonly detail: string,
  ) {
    super(message);
  }
}

interface Capture {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function capture(
  command: string,
  args: readonly string[],
  options: { readonly cwd?: string; readonly encoding?: BufferEncoding } = {},
): Promise<Capture> & { child: ReturnType<typeof spawn> } {
  const child = spawn(command, args, { cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding(options.encoding ?? "utf8").on("data", (chunk: string) => {
    if (stdout.length < 1_000_000) stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const promise = new Promise<Capture>((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolvePromise({ code, stdout, stderr }));
  }) as Promise<Capture> & { child: ReturnType<typeof spawn> };
  promise.child = child;
  return promise;
}

/**
 * The single excluded name is the operational writer-owner diagnostic
 * (C25: owner metadata is diagnostic only, written per lock acquisition, and
 * its legitimate change is not historical report/journal preservation). No
 * orphan, temporary-looking, preserved or corrupt evidence is excluded;
 * every other byte below the walked root participates in the witness.
 */
export const OWNER_DIAGNOSTIC_EXCLUDED = "writer.owner.json";

export interface TreeWitness {
  readonly files: number;
  readonly dirs: number;
  readonly bytes: number;
  readonly manifestSha256: string;
}

/**
 * Deterministic content witness: sorted (kind, sha256, size, relative path)
 * lines over every regular file and directory below root, hashed as one
 * manifest. Symlinks are recorded by target and never followed.
 */
export async function hashTree(root: string): Promise<TreeWitness> {
  const lines: string[] = [];
  let files = 0;
  let dirs = 0;
  let bytes = 0;
  const walk = async (dir: string, prefix: string): Promise<void> => {
    const names = (await readdir(dir)).sort();
    for (const name of names) {
      if (name === OWNER_DIAGNOSTIC_EXCLUDED) continue;
      const path = join(dir, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      const info = await lstat(path);
      if (info.isDirectory()) {
        dirs += 1;
        lines.push(`dir - - ${relative}`);
        await walk(path, relative);
      } else if (info.isFile()) {
        files += 1;
        bytes += info.size;
        lines.push(`file ${await sha256File(path)} ${info.size} ${relative}`);
      } else if (info.isSymbolicLink()) {
        lines.push(`symlink - - ${relative}`);
      } else {
        lines.push(`other ${info.mode.toString(8)} - ${relative}`);
      }
    }
  };
  await walk(root, "");
  const manifest = createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
  return { files, dirs, bytes, manifestSha256: manifest };
}

/** Streamed file digest; large index files never load whole into memory here. */
export async function sha256File(path: string): Promise<string> {
  const handle = await open(path, fsConstants.O_RDONLY);
  try {
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(65_536);
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
    return hash.digest("hex");
  } finally {
    await handle.close();
  }
}

export interface OldWriterSource {
  readonly sourceRoot: string;
  readonly commit: string;
  readonly reused: boolean;
  readonly cacheModuleSha256: string;
  /** Set when a prior extraction with an absent or wrong stamp was preserved aside rather than deleted. */
  readonly preservedPrevious?: string;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Extract the pinned old writer from the local git object database into
 * encrypted owned scratch. The tag must resolve to exactly the pinned commit;
 * any other resolution, a missing tag or a failed extraction refuses rather
 * than silently substituting current code. Extraction is idempotent through a
 * stamp file and never installs dependencies (the old writer imports only Node
 * builtins and its own modules at this tag).
 */
export async function extractOldWriterSource(): Promise<OldWriterSource> {
  const resolved = await capture("git", ["rev-parse", `${OLD_WRITER_TAG}^{commit}`], {
    cwd: growthRepo,
  });
  if (resolved.code !== 0)
    throw new OldSourceUnavailable(
      `git tag ${OLD_WRITER_TAG} is unavailable in ${growthRepo}`,
      resolved.stderr.trim() || `exit ${resolved.code}`,
    );
  const commit = resolved.stdout.trim();
  if (commit !== OLD_WRITER_COMMIT)
    throw new OldSourceUnavailable(
      `git tag ${OLD_WRITER_TAG} resolves to ${commit}, not the pinned ${OLD_WRITER_COMMIT}`,
      "tag-moved",
    );
  const dest = join(GROWTH_SCRATCH_DIR, "old-writer", commit);
  const stamp = join(dest, ".extracted");
  try {
    const existing = (await readFile(stamp, "utf8")).trim();
    if (existing === commit)
      return {
        sourceRoot: dest,
        commit,
        reused: true,
        cacheModuleSha256: await sha256File(join(dest, "src/core/cache.ts")),
      };
  } catch {
    // No usable stamp: the existing extraction, if any, is preserved aside.
  }
  // An existing extraction whose stamp is absent or wrong is never deleted:
  // preserve it under an owned distinct sibling, or stop. Historical
  // extraction state is evidence, not disposable scratch.
  let preservedPrevious: string | undefined;
  if (await lstat(dest).then(
    () => true,
    () => false,
  )) {
    const preserveStamp = new Date().toISOString().replace(/[^0-9TZ]/g, "");
    preservedPrevious = join(
      GROWTH_SCRATCH_DIR,
      "old-writer",
      `${commit}.preserved-${preserveStamp}-${randomBytes(4).toString("hex")}`,
    );
    try {
      await rename(dest, preservedPrevious);
    } catch (error) {
      throw new OldSourceUnavailable(
        `refusing to delete the existing old-writer extraction at ${dest} (its stamp is absent or wrong) and it could not be preserved aside`,
        describeError(error),
      );
    }
  }
  await mkdir(dest, { recursive: true });
  const archive = spawn("git", ["archive", "--format=tar", commit], {
    cwd: growthRepo,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const extract = spawn("tar", ["-x", "-C", dest], { stdio: ["pipe", "ignore", "pipe"] });
  let archiveStderr = "";
  let extractStderr = "";
  archive.stderr.setEncoding("utf8").on("data", (chunk: string) => (archiveStderr += chunk));
  extract.stderr.setEncoding("utf8").on("data", (chunk: string) => (extractStderr += chunk));
  if (archive.stdout && extract.stdin) {
    archive.stdout.pipe(extract.stdin);
  } else {
    archive.kill("SIGKILL");
    extract.kill("SIGKILL");
    throw new OldSourceUnavailable("git archive pipe could not be established", "no-stdio");
  }
  const [archiveResult, extractResult] = await Promise.all([
    new Promise<number | null>((resolveExit, reject) => {
      archive.once("error", reject);
      archive.once("close", (code) => resolveExit(code));
    }),
    new Promise<number | null>((resolveExit, reject) => {
      extract.once("error", reject);
      extract.once("close", (code) => resolveExit(code));
    }),
  ]);
  if (archiveResult !== 0 || extractResult !== 0)
    throw new OldSourceUnavailable(
      `extracting ${OLD_WRITER_TAG} failed (git archive exit ${archiveResult}, tar exit ${extractResult})`,
      `${archiveStderr.trim()} | ${extractStderr.trim()}`,
    );
  const cacheModule = join(dest, "src/core/cache.ts");
  try {
    await lstat(cacheModule);
  } catch {
    throw new OldSourceUnavailable(
      `extracted archive of ${commit} has no src/core/cache.ts`,
      "missing-module",
    );
  }
  await writeFile(stamp, `${commit}\n`, "utf8");
  return {
    sourceRoot: dest,
    commit,
    reused: false,
    cacheModuleSha256: await sha256File(cacheModule),
    ...(preservedPrevious ? { preservedPrevious } : {}),
  };
}

export interface WorkerResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

const workerUrl = fileURLToPath(import.meta.url);

/** Spawn the worker with one JSON argument; results arrive as JSON lines. */
export function runGrowthWorker(
  args: Record<string, unknown>,
  onLine?: (line: string) => void,
): Promise<WorkerResult> & { child: ReturnType<typeof spawn> } {
  const child = spawn(process.execPath, ["--import", "tsx", workerUrl, JSON.stringify(args)], {
    cwd: growthRepo,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let partial = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
    partial += chunk;
    let index: number;
    while ((index = partial.indexOf("\n")) !== -1) {
      onLine?.(partial.slice(0, index));
      partial = partial.slice(index + 1);
    }
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  const promise = new Promise<WorkerResult>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolveExit({ code, signal, stdout, stderr }));
  }) as Promise<WorkerResult> & { child: ReturnType<typeof spawn> };
  promise.child = child;
  return promise;
}

/** Real clock with injectable UTC source, mirroring the shared fixtures. */
function workerClock(): Clock {
  return {
    monotonicMs: () => performance.now(),
    utcIso: () => new Date().toISOString(),
    schedule(delayMs, callback) {
      const timer = setTimeout(callback, delayMs);
      return () => clearTimeout(timer);
    },
    async sleep(delayMs, signal) {
      await new Promise((resolveSleep, rejectSleep) => {
        if (signal?.aborted) return rejectSleep(signal.reason);
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolveSleep(null);
        }, delayMs);
        const onAbort = () => {
          clearTimeout(timer);
          rejectSleep(signal?.reason);
        };
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    },
  };
}

/** Old legacy writer surface used from the pinned tag. */
interface OldCacheModule {
  makeCachePath(query: string, cwd: string, cacheDir: string): string;
  cacheLockDir(cachePath: string): string;
  indexLockDir(cacheDir: string): string;
  withLock<T>(lockDir: string, fn: () => Promise<T>): Promise<T>;
  writeCacheFiles(
    cachePath: string,
    extractions: readonly unknown[],
    pages: readonly unknown[],
    searchSummary: string,
    query: string,
  ): Promise<void>;
  writeReportFile(
    cachePath: string,
    query: string,
    collation: string,
    extractions: readonly unknown[],
    pages: readonly unknown[],
  ): Promise<void>;
  updateIndex(cacheDir: string, slug: string, query: string): Promise<void>;
}

async function dynamicImportOldCache(sourceRoot: string): Promise<OldCacheModule> {
  const url = pathToFileURL(join(sourceRoot, "src/core/cache.ts"));
  const module = (await import(url.href)) as unknown as OldCacheModule;
  if (typeof module.makeCachePath !== "function" || typeof module.updateIndex !== "function")
    throw new Error(`old writer module at ${url.href} lacks the expected exports`);
  return module;
}

/** Query of an exact byte length, escape-free after the descriptive prefix. */
export function queryOfLength(prefix: string, totalBytes: number): string {
  if (prefix.length >= totalBytes)
    throw new Error(`prefix of ${prefix.length} bytes leaves no room in ${totalBytes}`);
  return prefix + "a".repeat(totalBytes - prefix.length);
}

interface WorkerArgs {
  readonly mode: "new-writer" | "old-writer" | "hold-lock";
  readonly cacheRoot: string;
  readonly count?: number;
  readonly label?: string;
  readonly queryBytes?: number;
  readonly commit?: boolean;
  readonly updateIndex?: boolean;
  readonly sourceRoot?: string;
  readonly holdMs?: number;
}

async function workerMain(): Promise<void> {
  const args = JSON.parse(process.argv[2] ?? "{}") as WorkerArgs;
  const emit = (value: unknown) => process.stdout.write(JSON.stringify(value) + "\n");
  const signal = new AbortController().signal;
  if (args.mode === "new-writer") {
    for (let i = 0; i < (args.count ?? 1); i++) {
      const label = args.label ?? "worker";
      const store = createRunStore(
        storeOptions(args.cacheRoot, { onDiagnostic: (diagnostic) => emit({ diagnostic }) }),
      );
      const query =
        args.queryBytes && args.queryBytes > 0
          ? queryOfLength(`growth ${label} ${process.pid} ${i}`, args.queryBytes)
          : `growth ${label} query ${process.pid} ${i}`;
      const started = performance.now();
      const allocation = await store.allocate({
        operationId: `op-growth-${process.pid}-${i}`,
        query,
        startedUtc: new Date().toISOString(),
        signal,
      });
      const allocateMs = performance.now() - started;
      if (allocation.status !== "allocated") {
        emit({ allocation, allocateMs });
        continue;
      }
      emit({ granted: allocation.reservation.sequence, runId: allocation.reservation.runId, allocateMs });
      if (args.commit !== false) {
        const commitStart = performance.now();
        const result = await store.commit(allocation.reservation, artifactsFor(query), signal);
        const commitMs = performance.now() - commitStart;
        emit({ commit: result.status, runId: allocation.reservation.runId, commitMs });
        if (result.status === "committed" && args.updateIndex === true) {
          const indexStart = performance.now();
          const index = await store.updateIndex(result.run, query, signal);
          emit({ index, indexMs: performance.now() - indexStart });
        }
      }
      await store.settle();
    }
    emit({ done: true });
  } else if (args.mode === "old-writer") {
    if (!args.sourceRoot) throw new Error("old-writer mode requires sourceRoot");
    const oldCache = await dynamicImportOldCache(args.sourceRoot);
    for (let i = 0; i < (args.count ?? 1); i++) {
      const query = `legacy ${args.label ?? "old"} query ${process.pid} ${i}`;
      const cachePath = oldCache.makeCachePath(query, args.cacheRoot, args.cacheRoot);
      await oldCache.withLock(oldCache.cacheLockDir(cachePath), async () => {
        await oldCache.writeCacheFiles(cachePath, [], [], "legacy qualifier summary", query);
        await oldCache.writeReportFile(cachePath, query, "Legacy qualifier report body", [], []);
        await oldCache.withLock(oldCache.indexLockDir(args.cacheRoot), () =>
          oldCache.updateIndex(args.cacheRoot, basename(cachePath), query),
        );
      });
      emit({ legacy: cachePath, slug: basename(cachePath), query });
    }
    emit({ done: true });
  } else if (args.mode === "hold-lock") {
    const acquired = await acquireWriterLock({
      namespaceDir: join(args.cacheRoot, NAMESPACE_DIR),
      clock: workerClock(),
      signal,
      loadBinding: loadNativeLockBinding,
    });
    emit({ acquired: acquired.status });
    await new Promise((resolveSleep) => setTimeout(resolveSleep, args.holdMs ?? 60_000));
    if (acquired.status === "acquired") await acquired.lock.release();
    emit({ released: true });
  } else {
    throw new Error(`unknown worker mode ${String(args.mode)}`);
  }
}

const invokedAsWorker = process.argv[1] ? resolve(process.argv[1]) === workerUrl : false;
if (invokedAsWorker) {
  workerMain().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
