// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// T25 library proofs for the C25 kernel-released writer lock on the
// observed platform (Linux x86-64, Node.js 24, local btrfs in CI of this
// worktree). Other platforms/filesystems are not exercised here.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { join } from "node:path";
import {
  acquireWriterLock,
  loadNativeLockBinding,
  LOCK_POLL_MS,
  LOCK_WAIT_MS,
  type LockBinding,
} from "../src/core/run-lock.js";
import { createRunStoreWithHooks } from "../src/core/run-store.js";
import { LOCK_FILE, NAMESPACE_DIR } from "../src/core/run-format.js";
import {
  realClock,
  repo,
  runWorker,
  scratchRoot,
  storeOptions,
  virtualClock,
} from "./helpers/run-store-fixtures.js";

async function namespace(label: string): Promise<string> {
  const root = await scratchRoot(label);
  const dir = join(root, NAMESPACE_DIR);
  await mkdir(dir);
  return dir;
}

const never = new AbortController().signal;

describe("C25 kernel writer lock", () => {
  it("serialises separate descriptors in one process and reuses one stable inode", async () => {
    const dir = await namespace("lock-same-process");
    const first = await acquireWriterLock({
      namespaceDir: dir,
      clock: realClock(),
      signal: never,
      loadBinding: loadNativeLockBinding,
    });
    assert.equal(first.status, "acquired");
    if (first.status !== "acquired") return;
    const clock = virtualClock();
    const second = await acquireWriterLock({
      namespaceDir: dir,
      clock,
      signal: never,
      loadBinding: loadNativeLockBinding,
    });
    assert.equal(second.status, "unavailable");
    assert.equal(second.status === "unavailable" && second.diagnostic.code, "LOCK_BUSY");
    assert.ok(
      second.status === "unavailable" && second.diagnostic.message.includes(join(dir, LOCK_FILE)),
    );
    // Nonblocking polls every 25 ms until the 2,000 ms monotonic bound.
    assert.ok(clock.sleeps.every((ms) => ms === LOCK_POLL_MS));
    assert.equal(clock.sleeps.length, LOCK_WAIT_MS / LOCK_POLL_MS);
    const before = await stat(join(dir, LOCK_FILE));
    await first.lock.release();
    const third = await acquireWriterLock({
      namespaceDir: dir,
      clock: realClock(),
      signal: never,
      loadBinding: loadNativeLockBinding,
    });
    assert.equal(third.status, "acquired");
    if (third.status !== "acquired") return;
    assert.equal(third.lock.ino, first.lock.ino);
    assert.equal(third.lock.dev, first.lock.dev);
    await third.lock.release();
    const after = await stat(join(dir, LOCK_FILE));
    assert.equal(after.ino, before.ino);
    assert.equal(after.size, 0, "the lockfile is never written or truncated");
  });

  it("closing an unrelated descriptor of the lockfile does not release the owner", async () => {
    const dir = await namespace("lock-unrelated-close");
    const owner = await acquireWriterLock({
      namespaceDir: dir,
      clock: realClock(),
      signal: never,
      loadBinding: loadNativeLockBinding,
    });
    assert.equal(owner.status, "acquired");
    const unrelated = await open(join(dir, LOCK_FILE), "r");
    await unrelated.close();
    const contender = await acquireWriterLock({
      namespaceDir: dir,
      clock: virtualClock(),
      signal: never,
      loadBinding: loadNativeLockBinding,
    });
    assert.equal(contender.status === "unavailable" && contender.diagnostic.code, "LOCK_BUSY");
    if (owner.status === "acquired") await owner.lock.release();
  });

  it("duplicate release cannot unlock a successor that reuses the descriptor number", async () => {
    const dir = await namespace("lock-duplicate-release");
    const unlocked: number[] = [];
    const locked: number[] = [];
    const native = await loadNativeLockBinding();
    const binding: LockBinding = {
      tryLock: (fd) => {
        const ok = native.tryLock(fd);
        if (ok) locked.push(fd);
        return ok;
      },
      unlock: (fd) => {
        unlocked.push(fd);
        native.unlock(fd);
      },
    };
    const first = await acquireWriterLock({
      namespaceDir: dir,
      clock: realClock(),
      signal: never,
      loadBinding: async () => binding,
    });
    assert.equal(first.status, "acquired");
    if (first.status !== "acquired") return;
    await Promise.all([first.lock.release(), first.lock.release()]);
    const successor = await acquireWriterLock({
      namespaceDir: dir,
      clock: realClock(),
      signal: never,
      loadBinding: async () => binding,
    });
    assert.equal(successor.status, "acquired");
    if (successor.status !== "acquired") return;
    assert.equal(locked[1], locked[0], "the successor reuses the closed descriptor number");
    await first.lock.release();
    assert.equal(unlocked.length, 1, "unlock attempted exactly once for the first acquisition");
    const contender = await acquireWriterLock({
      namespaceDir: dir,
      clock: virtualClock(),
      signal: never,
      loadBinding: loadNativeLockBinding,
    });
    assert.equal(
      contender.status === "unavailable" && contender.diagnostic.code,
      "LOCK_BUSY",
      "successor still holds the lock",
    );
    await successor.lock.release();
  });

  it("cancellation while waiting returns promptly and leaves no descriptor holding the lock", async () => {
    const dir = await namespace("lock-abort");
    const owner = await acquireWriterLock({
      namespaceDir: dir,
      clock: realClock(),
      signal: never,
      loadBinding: loadNativeLockBinding,
    });
    assert.equal(owner.status, "acquired");
    const controller = new AbortController();
    const started = performance.now();
    setTimeout(() => controller.abort(new Error("stop")), 60);
    const waiter = await acquireWriterLock({
      namespaceDir: dir,
      clock: realClock(),
      signal: controller.signal,
      loadBinding: loadNativeLockBinding,
    });
    const elapsed = performance.now() - started;
    assert.equal(waiter.status === "unavailable" && waiter.diagnostic.code, "ABORTED");
    assert.ok(elapsed < 500, `abort waited ${elapsed} ms`);
    if (owner.status === "acquired") await owner.lock.release();
    const next = await acquireWriterLock({
      namespaceDir: dir,
      clock: realClock(),
      signal: never,
      loadBinding: loadNativeLockBinding,
    });
    assert.equal(next.status, "acquired");
    if (next.status === "acquired") await next.lock.release();
  });

  it("unsupported and non-regular lock paths are explicit diagnostics with the lock path", async () => {
    const dir = await namespace("lock-unsupported");
    const failing: LockBinding = {
      tryLock: () => {
        throw Object.assign(new Error("ENOLCK: no locks available"), { code: "ENOLCK" });
      },
      unlock: () => undefined,
    };
    const result = await acquireWriterLock({
      namespaceDir: dir,
      clock: realClock(),
      signal: never,
      loadBinding: async () => failing,
    });
    assert.equal(result.status === "unavailable" && result.diagnostic.code, "LOCK_UNSUPPORTED");
    assert.ok(
      result.status === "unavailable" && result.diagnostic.message.includes(join(dir, LOCK_FILE)),
    );
    const dir2 = await namespace("lock-dir");
    await mkdir(join(dir2, LOCK_FILE));
    const notFile = await acquireWriterLock({
      namespaceDir: dir2,
      clock: realClock(),
      signal: never,
      loadBinding: loadNativeLockBinding,
    });
    assert.equal(notFile.status === "unavailable" && notFile.diagnostic.code, "LOCK_NOT_REGULAR");
  });

  it("lazy backend load failure is a non-persisted diagnostic, not an import failure", async () => {
    const root = await scratchRoot("lock-load-failure");
    const diagnostics: { code: string; message: string }[] = [];
    const store = createRunStoreWithHooks(storeOptions(root, { diagnostics }), {
      loadLockBinding: async () => {
        throw new Error("Cannot find addon '.'");
      },
    });
    const allocation = await store.allocate({
      operationId: "op",
      query: "q",
      startedUtc: "2026-10-18T12:00:00.000Z",
      signal: never,
    });
    assert.equal(allocation.status, "unavailable");
    assert.equal(
      allocation.status === "unavailable" && allocation.diagnostic.code,
      "LOCK_BACKEND_UNAVAILABLE",
    );
    assert.ok(
      allocation.status === "unavailable" &&
        allocation.diagnostic.message.includes(join(root, NAMESPACE_DIR, LOCK_FILE)),
    );
    assert.equal(diagnostics[0]?.code, "LOCK_BACKEND_UNAVAILABLE");
    await store.settle();
  });

  it("module import never loads the native binding", async () => {
    const source = await readFile(new URL("../src/core/run-lock.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /^import[^\n]*fs-native-extensions/m, "no static import");
    assert.match(source, /await import\(\s*"fs-native-extensions"\s*\)/);
    assert.doesNotMatch(
      source,
      /waitForLock/,
      "blocking/thread-backed wait API is not used in code",
    );
  });

  it("an unresolvable native package fails only persistence, through the real lazy loader", async () => {
    const root = await scratchRoot("lock-denied");
    const loader = join(root, "deny.mjs");
    await writeFile(
      loader,
      `export async function resolve(specifier, context, next) {
        if (specifier === "fs-native-extensions") throw Object.assign(new Error("denied"), { code: "ERR_MODULE_NOT_FOUND" });
        return next(specifier, context);
      }`,
    );
    const script = `
      const { createRunStore } = await import(${JSON.stringify(join(repo, "src/core/run-store.ts"))});
      const store = createRunStore({ workspaceRoot: ${JSON.stringify(root)}, cacheRoot: ${JSON.stringify(join(root, "cache"))}, displayRoot: ".search",
        clock: { monotonicMs: () => performance.now(), utcIso: () => new Date().toISOString(), schedule: () => () => {}, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
        randomId: () => "ab".repeat(16), onDiagnostic: () => {} });
      const result = await store.allocate({ operationId: "op", query: "q", startedUtc: new Date().toISOString(), signal: new AbortController().signal });
      process.stdout.write(JSON.stringify(result));`;
    const child = spawnSync(
      process.execPath,
      ["--import", "tsx", "--experimental-loader", loader, "--input-type=module", "--eval", script],
      {
        cwd: repo,
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout);
    assert.equal(result.status, "unavailable");
    assert.equal(result.diagnostic.code, "LOCK_BACKEND_UNAVAILABLE");
    assert.match(result.diagnostic.message, /writer\.lock/);
  });

  it("a standalone-style bundle keeps the native binding as an external lazy import", async () => {
    const output = await build({
      absWorkingDir: repo,
      entryPoints: ["src/core/run-store.ts"],
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      packages: "external",
      write: false,
      metafile: true,
    });
    const code = output.outputFiles[0].text;
    assert.match(code, /import\(\s*"fs-native-extensions"\s*\)/);
    assert.doesNotMatch(code, /^import[^\n]*"fs-native-extensions"/m);
    assert.ok(
      !Object.keys(output.metafile.inputs).some((path) =>
        path.includes("node_modules/fs-native-extensions"),
      ),
    );
  });

  it("a child process spawned while the lock is held does not inherit it", async () => {
    const dir = await namespace("lock-cloexec");
    const binding = await loadNativeLockBinding();
    // Raw descriptor opened the way acquireWriterLock opens it, closed without unlock:
    // only an inherited copy in the child could keep the lock alive afterwards.
    const handle = await open(join(dir, LOCK_FILE), "a+");
    assert.equal(binding.tryLock(handle.fd), true);
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], {
      stdio: "ignore",
    });
    try {
      await new Promise((resolve) => child.once("spawn", resolve));
      await handle.close();
      const next = await acquireWriterLock({
        namespaceDir: dir,
        clock: realClock(),
        signal: never,
        loadBinding: loadNativeLockBinding,
      });
      assert.equal(next.status, "acquired", "the locked descriptor was not inherited by the child");
      if (next.status === "acquired") await next.lock.release();
    } finally {
      child.kill("SIGKILL");
    }
  });

  it("independent processes serialise the critical section without overlap", async () => {
    const root = await scratchRoot("lock-processes");
    await mkdir(join(root, NAMESPACE_DIR));
    const workers = Array.from({ length: 4 }, () =>
      runWorker({ mode: "critical", cacheRoot: root, count: 15 }),
    );
    const results = await Promise.all(workers);
    for (const result of results) assert.equal(result.code, 0, result.stderr);
    const lines = (await readFile(join(root, "critical.log"), "utf8")).trim().split("\n");
    assert.equal(lines.length, 4 * 15 * 2);
    for (let i = 0; i < lines.length; i += 2) {
      const [kind, pid] = lines[i].split(" ");
      assert.equal(kind, "start");
      assert.equal(lines[i + 1], `end ${pid}`, `critical sections overlapped at line ${i}`);
    }
  });

  it("SIGKILL of the holder releases automatically on the same stable inode", async () => {
    const root = await scratchRoot("lock-sigkill");
    await mkdir(join(root, NAMESPACE_DIR));
    await writeFile(join(root, NAMESPACE_DIR, LOCK_FILE), "");
    const before = await stat(join(root, NAMESPACE_DIR, LOCK_FILE));
    let held!: () => void;
    const acquired = new Promise<void>((resolve) => (held = resolve));
    const worker = runWorker({ mode: "hold-lock", cacheRoot: root, holdMs: 60_000 }, (line) => {
      if (line.includes('"acquired":"acquired"')) held();
    });
    await acquired;
    const blocked = await acquireWriterLock({
      namespaceDir: join(root, NAMESPACE_DIR),
      clock: virtualClock(),
      signal: never,
      loadBinding: loadNativeLockBinding,
    });
    assert.equal(blocked.status === "unavailable" && blocked.diagnostic.code, "LOCK_BUSY");
    worker.child.kill("SIGKILL");
    const exit = await worker;
    assert.equal(exit.signal, "SIGKILL");
    const after = await acquireWriterLock({
      namespaceDir: join(root, NAMESPACE_DIR),
      clock: realClock(),
      signal: never,
      loadBinding: loadNativeLockBinding,
    });
    assert.equal(after.status, "acquired", "no stale-lock cleanup is needed");
    const now = await stat(join(root, NAMESPACE_DIR, LOCK_FILE));
    assert.equal(now.ino, before.ino);
    assert.equal(now.dev, before.dev);
    if (after.status === "acquired") await after.lock.release();
  });
});
