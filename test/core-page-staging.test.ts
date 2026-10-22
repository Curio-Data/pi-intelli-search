// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// M2 staging module proofs for the C19 retained-page contract. Real
// filesystem scratch lives under this worktree's .tmp/staging (encrypted
// drive, never the system temp directory). A pending-writer injection seam
// covers mid-write cancellation; every default-writer path is real I/O.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getEventListeners } from "node:events";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPageStaging,
  PageStagingError,
  type PageStagingOptions,
} from "../src/core/page-staging.js";
import type { OperationLease } from "../src/core/execution-contracts.js";

const repo = fileURLToPath(new URL("../", import.meta.url));

/** Scratch lives under the encrypted checkout, never the system temp directory. */
async function cacheRootFor(label: string): Promise<string> {
  const base = join(repo, ".tmp", "staging");
  await mkdir(base, { recursive: true });
  return mkdtemp(join(base, `${label}-`));
}

type LeaseCounters = {
  acquireFetch: number;
  cutoffPages: number;
  track: number;
  abort: number;
  settle: number;
};

interface LeaseHarness {
  readonly lease: OperationLease;
  readonly controller: AbortController;
  readonly calls: LeaseCounters;
}

function leaseHarness(): LeaseHarness {
  const controller = new AbortController();
  const calls: LeaseCounters = { acquireFetch: 0, cutoffPages: 0, track: 0, abort: 0, settle: 0 };
  const lease: OperationLease = {
    id: "op-staging-test",
    generation: 1,
    signal: controller.signal,
    acquireFetch: () => {
      calls.acquireFetch++;
      throw new Error("staging must never acquire a fetch permit");
    },
    cutoffPages: () => {
      calls.cutoffPages++;
    },
    track: (task) => {
      calls.track++;
      return task;
    },
    abort: () => {
      calls.abort++;
      controller.abort("lease abort");
    },
    settle: async () => {
      calls.settle++;
    },
  };
  return { lease, controller, calls };
}

function stagingOf(
  cacheRoot: string,
  harness: LeaseHarness,
  overrides: Partial<PageStagingOptions> = {},
): ReturnType<typeof createPageStaging> {
  return createPageStaging({
    cacheRoot,
    operation: harness.lease,
    maxRetainedPages: 2,
    maxPageBytes: 4096,
    ...overrides,
  });
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Records whether a promise has settled; never observes its value or error. */
function tracker(promise: Promise<unknown>): { done: boolean } {
  const state = { done: false };
  promise.then(
    () => {
      state.done = true;
    },
    () => {
      state.done = true;
    },
  );
  return state;
}

async function tick(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((resolve) => setImmediate(resolve));
}

async function pathKind(
  path: string,
): Promise<"missing" | "file" | "directory" | "symlink" | "other"> {
  const info = await lstat(path).catch(() => undefined);
  if (!info) return "missing";
  if (info.isSymbolicLink()) return "symlink";
  if (info.isDirectory()) return "directory";
  if (info.isFile()) return "file";
  return "other";
}

function errorCodeOf(value: unknown): string | undefined {
  return value instanceof PageStagingError ? value.code : undefined;
}

const abortListeners = (signal: AbortSignal): number => getEventListeners(signal, "abort").length;

describe("page staging options", () => {
  it("rejects a non-absolute cache root without touching the filesystem", async () => {
    const root = await cacheRootFor("options-relative");
    const harness = leaseHarness();
    assert.throws(() => stagingOf("relative/path", harness), TypeError);
    assert.throws(() => stagingOf("", harness), TypeError);
    assert.deepEqual(await readdir(root), []);
  });

  it("rejects bounds that are not positive safe integers", async () => {
    const root = await cacheRootFor("options-bounds");
    const harness = leaseHarness();
    const invalid = [0, -1, 1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1];
    for (const value of invalid) {
      assert.throws(() => stagingOf(root, harness, { maxRetainedPages: value }), TypeError);
      assert.throws(() => stagingOf(root, harness, { maxPageBytes: value }), TypeError);
    }
    assert.deepEqual(await readdir(root), []);
  });

  it("rejects an operation lease without a live signal", async () => {
    const root = await cacheRootFor("options-lease");
    assert.throws(
      () =>
        createPageStaging({
          cacheRoot: root,
          operation: { id: "x", generation: 1 } as unknown as OperationLease,
          maxRetainedPages: 1,
          maxPageBytes: 1,
        }),
      TypeError,
    );
  });

  it("creates nothing and registers no listeners at construction", async () => {
    const root = await cacheRootFor("options-inert");
    const harness = leaseHarness();
    stagingOf(root, harness);
    assert.equal(abortListeners(harness.controller.signal), 0);
    assert.equal(await pathKind(join(root, ".staging")), "missing");
    assert.deepEqual(await readdir(root), []);
  });
});

describe("page staging slot admission", () => {
  it("grants up to maxRetainedPages immediately and backpressures the next acquire", async () => {
    const root = await cacheRootFor("admission-cap");
    const harness = leaseHarness();
    const pages = stagingOf(root, harness, { maxRetainedPages: 2 });
    const first = await pages.acquire("p1");
    const second = await pages.acquire("p2");
    const third = pages.acquire("p3");
    const state = tracker(third);
    await tick();
    assert.equal(state.done, false);
    await first.release();
    const granted = await third;
    assert.equal(granted.pageId, "p3");
    await second.release();
    await pages.settle();
  });

  it("admits queued waiters strictly in FIFO order", async () => {
    const root = await cacheRootFor("admission-fifo");
    const harness = leaseHarness();
    const pages = stagingOf(root, harness, { maxRetainedPages: 1 });
    const grants: string[] = [];
    const first = await pages.acquire("p1");
    const queued = ["p2", "p3", "p4"].map((id) =>
      pages.acquire(id).then((slot) => {
        grants.push(id);
        return slot;
      }),
    );
    await tick();
    assert.deepEqual(grants, []);
    await first.release();
    for (const promise of queued) {
      const slot = await promise;
      assert.equal(slot.pageId, grants[grants.length - 1]);
      await slot.release();
    }
    assert.deepEqual(grants, ["p2", "p3", "p4"]);
    await pages.settle();
  });

  it("never caps the queue: the coordinator's population is the only bound", async () => {
    const root = await cacheRootFor("admission-queue-uncapped");
    const harness = leaseHarness();
    const pages = stagingOf(root, harness, { maxRetainedPages: 1 });
    const held = await pages.acquire("held");
    const waiters = Array.from({ length: 24 }, (_, i) => pages.acquire(`p${i + 1}`));
    const states = waiters.map((promise) => tracker(promise));
    await tick();
    assert.ok(states.every((state) => !state.done));
    await held.release();
    await pages.settle();
    await Promise.allSettled(waiters);
  });

  it("cancels a queued waiter through its caller signal and frees no slot for it", async () => {
    const root = await cacheRootFor("admission-caller-cancel");
    const harness = leaseHarness();
    const pages = stagingOf(root, harness, { maxRetainedPages: 1 });
    const held = await pages.acquire("held");
    const caller = new AbortController();
    const cancelled = pages.acquire("cancelled", caller.signal);
    const later = pages.acquire("later");
    await tick();
    caller.abort("caller reason");
    await assert.rejects(cancelled, (error: unknown) => {
      assert.equal(errorCodeOf(error), "CANCELLED");
      assert.equal((error as Error & { cause?: unknown }).cause, "caller reason");
      return true;
    });
    await held.release();
    const granted = await later;
    assert.equal(granted.pageId, "later");
    await granted.release();
    await pages.settle();
  });

  it("cancels a queued waiter through the operation signal with its reason as cause", async () => {
    const root = await cacheRootFor("admission-operation-cancel");
    const harness = leaseHarness();
    const pages = stagingOf(root, harness, { maxRetainedPages: 1 });
    const held = await pages.acquire("held");
    const queued = pages.acquire("queued");
    await tick();
    harness.controller.abort("operation reason");
    await assert.rejects(queued, (error: unknown) => {
      assert.equal(errorCodeOf(error), "ABORTED");
      assert.equal((error as Error & { cause?: unknown }).cause, "operation reason");
      return true;
    });
    await held.release();
    await pages.settle();
  });

  it("rejects acquire after the operation aborted, even with free capacity", async () => {
    const root = await cacheRootFor("admission-aborted");
    const harness = leaseHarness();
    const pages = stagingOf(root, harness);
    harness.controller.abort();
    await assert.rejects(pages.acquire("p1"), (error: unknown) => errorCodeOf(error) === "ABORTED");
    await pages.settle();
  });

  it("rejects acquire with a pre-aborted caller signal", async () => {
    const root = await cacheRootFor("admission-caller-preaborted");
    const harness = leaseHarness();
    const pages = stagingOf(root, harness);
    const caller = new AbortController();
    caller.abort();
    await assert.rejects(
      pages.acquire("p1", caller.signal),
      (error: unknown) => errorCodeOf(error) === "CANCELLED",
    );
    await pages.settle();
  });

  it("rejects acquire after settlement with CLOSED", async () => {
    const root = await cacheRootFor("admission-closed");
    const harness = leaseHarness();
    const pages = stagingOf(root, harness);
    await pages.settle();
    await assert.rejects(
      pages.acquire("p1"),
      (error: unknown) => errorCodeOf(error) === "CLOSED",
    );
  });

  it("rejects invalid pageId and signal arguments", async () => {
    const root = await cacheRootFor("admission-invalid");
    const harness = leaseHarness();
    const pages = stagingOf(root, harness);
    await assert.rejects(
      pages.acquire(""),
      (error: unknown) => errorCodeOf(error) === "INVALID_INPUT",
    );
    await assert.rejects(
      pages.acquire(42 as unknown as string),
      (error: unknown) => errorCodeOf(error) === "INVALID_INPUT",
    );
    await assert.rejects(
      pages.acquire("p1", "not-a-signal" as unknown as AbortSignal),
      (error: unknown) => errorCodeOf(error) === "INVALID_INPUT",
    );
    await pages.settle();
  });
});

describe("page staging listener hygiene", () => {
  it("removes waiter listeners after a caller-signal cancellation", async () => {
    const root = await cacheRootFor("listeners-caller-cancel");
    const harness = leaseHarness();
    const pages = stagingOf(root, harness, { maxRetainedPages: 1 });
    const held = await pages.acquire("held");
    const caller = new AbortController();
    const operationBaseline = abortListeners(harness.controller.signal);
    const callerBaseline = abortListeners(caller.signal);
    const queued = pages.acquire("queued", caller.signal);
    await tick();
    assert.equal(abortListeners(harness.controller.signal), operationBaseline + 1);
    assert.equal(abortListeners(caller.signal), callerBaseline + 1);
    caller.abort();
    await assert.rejects(queued, PageStagingError);
    assert.equal(abortListeners(harness.controller.signal), operationBaseline);
    assert.equal(abortListeners(caller.signal), callerBaseline);
    await held.release();
    await pages.settle();
  });

  it("removes waiter listeners after a grant", async () => {
    const root = await cacheRootFor("listeners-grant");
    const harness = leaseHarness();
    const pages = stagingOf(root, harness, { maxRetainedPages: 1 });
    const held = await pages.acquire("held");
    const baseline = abortListeners(harness.controller.signal);
    const queued = pages.acquire("queued");
    await tick();
    assert.equal(abortListeners(harness.controller.signal), baseline + 1);
    await held.release();
    const granted = await queued;
    assert.equal(abortListeners(harness.controller.signal), baseline);
    await granted.release();
    await pages.settle();
  });

  it("removes the write abort listener after the write settles", async () => {
    const root = await cacheRootFor("listeners-write");
    const harness = leaseHarness();
    const entered = deferred();
    const gate = deferred();
    const pages = stagingOf(root, harness, {
      writeStagedFile: async () => {
        entered.resolve();
        await gate.promise;
      },
    });
    const baseline = abortListeners(harness.controller.signal);
    const slot = await pages.acquire("p1");
    const write = slot.write("body");
    try {
      // A real write can finish before an arbitrary tick budget. Observe a held
      // writer instead, so this asserts both listener attachment and removal.
      await entered.promise;
      assert.equal(abortListeners(harness.controller.signal), baseline + 1);
      gate.resolve();
      await write;
      assert.equal(abortListeners(harness.controller.signal), baseline);
    } finally {
      gate.resolve();
      await slot.release();
      await pages.settle();
    }
  });

  it("removes the write abort listener after a mid-write cancellation", async () => {
    const root = await cacheRootFor("listeners-write-cancel");
    const harness = leaseHarness();
    const gate = deferred();
    const pages = stagingOf(root, harness, {
      writeStagedFile: async () => {
        await gate.promise;
      },
    });
    const baseline = abortListeners(harness.controller.signal);
    const slot = await pages.acquire("p1");
    await pages.directory(); // let the write reach its facing stage deterministically
    const write = slot.write("body");
    await tick();
    assert.equal(abortListeners(harness.controller.signal), baseline + 1);
    harness.controller.abort();
    await assert.rejects(write, PageStagingError);
    assert.equal(abortListeners(harness.controller.signal), baseline);
    gate.resolve();
    await slot.release();
    await pages.settle();
  });
});

describe("page staging writes", () => {
  it("writes exact content to a private regular file inside the owned directory", async () => {
    const root = await cacheRootFor("write-exact");
    const harness = leaseHarness();
    const pages = stagingOf(root, harness);
    const slot = await pages.acquire("p1");
    const result = await slot.write("héllo wörld");
    const directory = await pages.directory();
    assert.equal(dirname(result.stagedPath), directory);
    assert.equal(await readFile(result.stagedPath, "utf-8"), "héllo wörld");
    assert.equal(result.bytes, Buffer.byteLength("héllo wörld", "utf-8"));
    const info = await lstat(result.stagedPath);
    assert.ok(info.isFile());
    assert.equal(info.mode & 0o777, 0o600);
    await slot.release();
    await pages.settle();
  });

  it("enforces the UTF-8 byte limit inclusively and creates no file when over it", async () => {
    const root = await cacheRootFor("write-limit");
    const harness = leaseHarness();
    const pages = stagingOf(root, harness, { maxPageBytes: 4 });
    const within = await pages.acquire("within");
    const exact = await within.write("éé"); // 4 UTF-8 bytes, exactly the limit
    assert.equal(exact.bytes, 4);
    const over = await pages.acquire("over");
    await assert.rejects(
      over.write("ééé"), // 6 UTF-8 bytes
      (error: unknown) => errorCodeOf(error) === "OVERSIZED",
    );
    assert.equal((await readdir(dirname(exact.stagedPath))).length, 1);
    await within.release();
    await over.release();
    await pages.settle();
  });

  it("rejects an oversized write before the directory is ever created", async () => {
    const root = await cacheRootFor("write-limit-nodir");
    const harness = leaseHarness();
    const pages = stagingOf(root, harness, { maxPageBytes: 2 });
    const slot = await pages.acquire("p1");
    await assert.rejects(
      slot.write("toolong"),
      (error: unknown) => errorCodeOf(error) === "OVERSIZED",
    );
    assert.equal(await pathKind(join(root, ".staging")), "missing");
    await slot.release();
    await pages.settle();
  });

  it("allows exactly one write per slot, whatever the first outcome", async () => {
    const root = await cacheRootFor("write-once");
    const harness = leaseHarness();
    const pages = stagingOf(root, harness, { maxPageBytes: 4 });
    const failed = await pages.acquire("failed");
    await assert.rejects(failed.write("oversized-body"), PageStagingError);
    await assert.rejects(
      failed.write("ok"),
      (error: unknown) => errorCodeOf(error) === "WRITE_ONCE",
    );
    const succeeded = await pages.acquire("succeeded");
    await succeeded.write("ok");
    await assert.rejects(
      succeeded.write("again"),
      (error: unknown) => errorCodeOf(error) === "WRITE_ONCE",
    );
    await failed.release();
    await succeeded.release();
    await pages.settle();
  });

  it("rejects a write after the slot was released", async () => {
    const root = await cacheRootFor("write-released");
    const harness = leaseHarness();
    const pages = stagingOf(root, harness);
    const slot = await pages.acquire("p1");
    await slot.release();
    await assert.rejects(
      slot.write("body"),
      (error: unknown) => errorCodeOf(error) === "RELEASED",
    );
    await pages.settle();
  });

  it("rejects a write after settlement with CLOSED and after abort with ABORTED", async () => {
    const settledRoot = await cacheRootFor("write-state-settled");
    const harness = leaseHarness();
    const settledPages = stagingOf(settledRoot, harness);
    const settledSlot = await settledPages.acquire("p1");
    await settledPages.settle();
    await assert.rejects(
      settledSlot.write("body"),
      (error: unknown) => errorCodeOf(error) === "CLOSED",
    );
    const abortedRoot = await cacheRootFor("write-state-aborted");
    const abortedPages = stagingOf(abortedRoot, harness);
    const abortedSlot = await abortedPages.acquire("p1");
    harness.controller.abort();
    await assert.rejects(
      abortedSlot.write("body"),
      (error: unknown) => errorCodeOf(error) === "ABORTED",
    );
    await abortedPages.settle();
  });

  it("memoizes one directory and stages distinct files for distinct slots", async () => {
    const root = await cacheRootFor("write-distinct");
    const harness = leaseHarness();
    const pages = stagingOf(root, harness);
    const first = await pages.acquire("p1");
    const second = await pages.acquire("p2");
    const one = await first.write("one");
    const two = await second.write("two");
    assert.equal(await pages.directory(), await pages.directory());
    assert.notEqual(one.stagedPath, two.stagedPath);
    assert.equal(await readFile(one.stagedPath, "utf-8"), "one");
    assert.equal(await readFile(two.stagedPath, "utf-8"), "two");
    await first.release();
    await second.release();
    await pages.settle();
  });

  it("does not treat a caller pageId as a path component", async () => {
    const root = await cacheRootFor("write-pageid");
    const harness = leaseHarness();
    const pages = stagingOf(root, harness);
    const hostile = await pages.acquire("../../../../escape");
    const result = await hostile.write("body");
    const directory = await pages.directory();
    assert.equal(dirname(result.stagedPath), directory);
    assert.ok(!result.stagedPath.includes("escape"));
    assert.ok(!result.stagedPath.includes(".."));
    await hostile.release();
    await pages.settle();
  });
});

describe("page staging release", () => {
  it("is idempotent and grants only one queued waiter", async () => {
    const root = await cacheRootFor("release-idempotent");
    const harness = leaseHarness();
    const pages = stagingOf(root, harness, { maxRetainedPages: 1 });
    const held = await pages.acquire("held");
    const next = pages.acquire("next");
    const stillQueued = pages.acquire("still-queued");
    await tick();
    await held.release();
    await held.release();
    const granted = await next;
    assert.equal(granted.pageId, "next");
    const queuedState = tracker(stillQueued);
    await tick();
    assert.equal(queuedState.done, false);
    await granted.release();
    const drained = await stillQueued;
    await drained.release();
    await pages.settle();
  });

  it("settles the owned writer before the next slot is granted (injected pending writer)", async () => {
    const root = await cacheRootFor("release-wait-writer");
    const harness = leaseHarness();
    const gate = deferred();
    const order: string[] = [];
    const pages = stagingOf(root, harness, {
      maxRetainedPages: 1,
      writeStagedFile: async () => {
        await gate.promise;
      },
    });
    const slot = await pages.acquire("p1");
    const write = slot.write("body");
    write.then(
      () => order.push("write-settled"),
      () => order.push("write-failed"),
    );
    const release = slot.release();
    release.then(() => order.push("release-settled"));
    const next = pages.acquire("p2");
    next.then(() => order.push("granted"));
    await tick();
    assert.equal(order.length, 0);
    gate.resolve();
    await Promise.all([write, release, next]);
    assert.ok(order.indexOf("write-settled") >= 0);
    assert.ok(order.indexOf("write-settled") < order.indexOf("granted"));
    const granted = await next;
    await granted.release();
    await pages.settle();
  });

  it("settles the owned writer before the next slot is granted (real writer)", async () => {
    const root = await cacheRootFor("release-wait-real");
    const harness = leaseHarness();
    const order: string[] = [];
    const pages = stagingOf(root, harness, { maxRetainedPages: 1 });
    const slot = await pages.acquire("p1");
    const write = slot.write("body");
    write.then(
      () => order.push("write-settled"),
      () => order.push("write-failed"),
    );
    const next = pages.acquire("p2");
    next.then(() => order.push("granted"));
    await Promise.all([write, next, slot.release()]);
    assert.ok(order.indexOf("write-settled") < order.indexOf("granted"));
    const granted = await next;
    await granted.release();
    await pages.settle();
  });

  it("does not propagate a failed write to release and frees the slot anyway", async () => {
    const root = await cacheRootFor("release-failed-write");
    const harness = leaseHarness();
    const pages = stagingOf(root, harness, { maxRetainedPages: 1, maxPageBytes: 4 });
    const slot = await pages.acquire("p1");
    await assert.rejects(slot.write("far too large for the limit"), PageStagingError);
    const queued = pages.acquire("p2");
    await slot.release();
    const granted = await queued;
    assert.equal(granted.pageId, "p2");
    await granted.release();
    await pages.settle();
  });

  it("keeps a successful staged file available after release, until settlement", async () => {
    const root = await cacheRootFor("release-retain");
    const harness = leaseHarness();
    const pages = stagingOf(root, harness);
    const slot = await pages.acquire("p1");
    const result = await slot.write("retained content");
    await slot.release();
    assert.equal(await readFile(result.stagedPath, "utf-8"), "retained content");
    await pages.settle();
    assert.equal(await pathKind(result.stagedPath), "missing");
  });
});

describe("page staging settlement", () => {
  it("creates no directory and no side effect when unused", async () => {
    const root = await cacheRootFor("settle-unused");
    const harness = leaseHarness();
    const pages = stagingOf(root, harness);
    await pages.settle();
    assert.deepEqual(await readdir(root), []);
  });

  it("creates no directory when slots were acquired and released without writes", async () => {
    const root = await cacheRootFor("settle-nowrite");
    const harness = leaseHarness();
    const pages = stagingOf(root, harness);
    const slot = await pages.acquire("p1");
    await slot.release();
    await pages.settle();
    assert.deepEqual(await readdir(root), []);
  });

  it("removes only the owned directory after writers settle and keeps .staging itself", async () => {
    const root = await cacheRootFor("settle-remove");
    const harness = leaseHarness();
    const pages = stagingOf(root, harness);
    const slot = await pages.acquire("p1");
    const result = await slot.write("body");
    const directory = await pages.directory();
    const sibling = join(root, ".staging", "sibling-dir");
    await mkdir(sibling);
    await slot.release();
    await pages.settle();
    assert.equal(await pathKind(directory), "missing");
    assert.equal(await pathKind(result.stagedPath), "missing");
    assert.equal(await pathKind(join(root, ".staging")), "directory");
    assert.equal(await pathKind(sibling), "directory");
  });

  it("is idempotent, and concurrent calls share one outcome", async () => {
    const root = await cacheRootFor("settle-idempotent");
    const harness = leaseHarness();
    const pages = stagingOf(root, harness);
    const slot = await pages.acquire("p1");
    await slot.write("body");
    await slot.release();
    await Promise.all([pages.settle(), pages.settle()]);
    await pages.settle();
    await assert.rejects(pages.directory(), PageStagingError);
  });

  it("cancels queued waiters at settlement", async () => {
    const root = await cacheRootFor("settle-queued");
    const harness = leaseHarness();
    const pages = stagingOf(root, harness, { maxRetainedPages: 1 });
    const held = await pages.acquire("held");
    const queued = pages.acquire("queued");
    const settle = pages.settle();
    await assert.rejects(queued, (error: unknown) => errorCodeOf(error) === "CANCELLED");
    await settle;
    await held.release();
  });

  it("awaits a pending writer before cleanup and cancels its facing promise", async () => {
    const root = await cacheRootFor("settle-pending-writer");
    const harness = leaseHarness();
    const gate = deferred();
    const order: string[] = [];
    const pages = stagingOf(root, harness, {
      writeStagedFile: async () => {
        await gate.promise;
        order.push("writer-resolved");
      },
    });
    const slot = await pages.acquire("p1");
    const directory = await pages.directory(); // memoised with the write's creation
    const write = slot.write("body");
    write.then(
      () => order.push("write-settled"),
      () => order.push("write-cancelled"),
    );
    await tick();
    const settle = pages.settle();
    const settleState = tracker(settle);
    await tick();
    assert.equal(settleState.done, false); // still awaiting the actual writer
    await assert.rejects(write, (error: unknown) => errorCodeOf(error) === "CANCELLED");
    gate.resolve();
    await settle;
    order.push("settled");
    assert.deepEqual(order, ["write-cancelled", "writer-resolved", "settled"]);
    assert.equal(await pathKind(await directory), "missing");
    await slot.release();
  });

  it("still resolves when an awaited writer itself fails", async () => {
    const root = await cacheRootFor("settle-failing-writer");
    const harness = leaseHarness();
    const gate = deferred();
    const pages = stagingOf(root, harness, {
      writeStagedFile: async () => {
        await gate.promise;
        throw new Error("writer broke");
      },
    });
    const slot = await pages.acquire("p1");
    await pages.directory(); // let the write reach its facing stage deterministically
    const write = slot.write("body");
    await tick();
    const settle = pages.settle();
    await assert.rejects(write, (error: unknown) => errorCodeOf(error) === "CANCELLED");
    gate.resolve();
    await settle;
    await slot.release();
  });

  it("cleans up an already created directory even without writes", async () => {
    const root = await cacheRootFor("settle-emptydir");
    const harness = leaseHarness();
    const pages = stagingOf(root, harness);
    const directory = await pages.directory();
    await pages.settle();
    assert.equal(await pathKind(directory), "missing");
    assert.equal(await pathKind(join(root, ".staging")), "directory");
  });

  it("cleans up after a whole-operation abort reached waits and writers", async () => {
    const root = await cacheRootFor("settle-abort");
    const harness = leaseHarness();
    const gate = deferred();
    const pages = stagingOf(root, harness, {
      maxRetainedPages: 1,
      writeStagedFile: async () => {
        await gate.promise;
      },
    });
    const slot = await pages.acquire("p1");
    await pages.directory(); // let the write reach its facing stage deterministically
    const write = slot.write("body");
    const queued = pages.acquire("p2");
    await tick();
    harness.controller.abort("boom");
    await assert.rejects(queued, PageStagingError);
    await assert.rejects(write, (error: unknown) => errorCodeOf(error) === "ABORTED");
    gate.resolve();
    await slot.release();
    await pages.settle();
    const owned = (await readdir(join(root, ".staging"))).filter((name) => name.startsWith("pages-"));
    assert.equal(owned.length, 0);
    assert.equal(await pathKind(join(root, ".staging")), "directory");
  });

  it("propagates cleanup failure and keeps memoising the rejected outcome", async () => {
    const root = await cacheRootFor("settle-cleanup-failure");
    const harness = leaseHarness();
    const pages = stagingOf(root, harness);
    const slot = await pages.acquire("p1");
    const result = await slot.write("body");
    await slot.release();
    const stagingRoot = join(root, ".staging");
    await chmod(stagingRoot, 0o500);
    try {
      await assert.rejects(pages.settle(), (error: unknown) => {
        assert.equal(errorCodeOf(error), "STAGING_FAULT");
        const cause = (error as Error & { cause?: unknown }).cause as
          | NodeJS.ErrnoException
          | undefined;
        assert.equal(cause?.code, "EACCES");
        return true;
      });
      await assert.rejects(pages.settle(), PageStagingError);
      assert.equal(await pathKind(result.stagedPath), "file");
    } finally {
      await chmod(stagingRoot, 0o700);
    }
  });
});

describe("page staging containment", () => {
  it("refuses a staging root that already exists as a symlink", async () => {
    const root = await cacheRootFor("contain-symlink-root");
    const innocent = join(root, "innocent");
    await mkdir(innocent);
    await symlink(innocent, join(root, ".staging"));
    const harness = leaseHarness();
    const pages = stagingOf(root, harness);
    const slot = await pages.acquire("p1");
    await assert.rejects(
      slot.write("body"),
      (error: unknown) => errorCodeOf(error) === "STAGING_FAULT",
    );
    assert.deepEqual(await readdir(innocent), []);
    await slot.release();
    await pages.settle();
  });

  it("refuses cleanup when the staging root was replaced by a symlink", async () => {
    const root = await cacheRootFor("contain-root-replaced");
    const harness = leaseHarness();
    const pages = stagingOf(root, harness);
    const slot = await pages.acquire("p1");
    const result = await slot.write("body");
    const stagingRoot = join(root, ".staging");
    const moved = join(root, "moved-staging");
    const movedResult = join(moved, ...result.stagedPath.split("/").slice(-2));
    await rename(stagingRoot, moved);
    const decoy = join(root, "decoy");
    await mkdir(decoy);
    await symlink(decoy, stagingRoot);
    await slot.release();
    await assert.rejects(
      pages.settle(),
      (error: unknown) => errorCodeOf(error) === "STAGING_FAULT",
    );
    assert.deepEqual(await readdir(decoy), []);
    assert.equal(await readFile(movedResult, "utf-8"), "body"); // moved tree intact
    assert.equal(await pathKind(moved), "directory");
  });

  it("refuses cleanup when the staging root was replaced by an ordinary directory", async () => {
    const root = await cacheRootFor("contain-root-replaced-dir");
    const harness = leaseHarness();
    const pages = stagingOf(root, harness);
    const slot = await pages.acquire("p1");
    const result = await slot.write("body");
    const stagingRoot = join(root, ".staging");
    const moved = join(root, "moved-staging");
    const movedResult = join(moved, ...result.stagedPath.split("/").slice(-2));
    await rename(stagingRoot, moved);
    // An ordinary real replacement root with a same-basename owned child has
    // the right shape but a different filesystem identity; it must survive.
    await mkdir(stagingRoot);
    const replacement = join(stagingRoot, basename(dirname(result.stagedPath)));
    await mkdir(replacement);
    const sentinel = join(replacement, "not-owned.txt");
    await writeFile(sentinel, "replacement tree, not owned by this staging instance");
    await slot.release();
    await assert.rejects(
      pages.settle(),
      (error: unknown) => errorCodeOf(error) === "STAGING_FAULT",
    );
    assert.equal(
      await readFile(sentinel, "utf-8"),
      "replacement tree, not owned by this staging instance",
    );
    assert.equal(await readFile(movedResult, "utf-8"), "body"); // moved tree intact
    assert.equal(await pathKind(moved), "directory");
  });

  it("refuses cleanup when the owned directory itself was replaced", async () => {
    const root = await cacheRootFor("contain-dir-replaced");
    const harness = leaseHarness();
    const pages = stagingOf(root, harness);
    const slot = await pages.acquire("p1");
    await slot.write("body");
    const directory = await pages.directory();
    await rm(directory, { recursive: true });
    const target = join(root, "target-file");
    await writeFile(target, "precious");
    await symlink(target, directory);
    await slot.release();
    await assert.rejects(
      pages.settle(),
      (error: unknown) => errorCodeOf(error) === "STAGING_FAULT",
    );
    assert.equal(await pathKind(directory), "symlink");
    assert.equal(await readFile(target, "utf-8"), "precious");
  });

  it("refuses cleanup when the owned directory was replaced by an ordinary directory", async () => {
    const root = await cacheRootFor("contain-dir-replaced-dir");
    const harness = leaseHarness();
    const pages = stagingOf(root, harness);
    const slot = await pages.acquire("p1");
    const result = await slot.write("body");
    const owned = await pages.directory();
    const moved = join(root, "moved-owned");
    await rename(owned, moved);
    // The replacement is a real directory with the right name but a different
    // inode; the staging root itself is untouched and still the original.
    await mkdir(owned);
    const sentinel = join(owned, "not-owned.txt");
    await writeFile(sentinel, "replacement tree, not owned by this staging instance");
    await slot.release();
    await assert.rejects(
      pages.settle(),
      (error: unknown) => errorCodeOf(error) === "STAGING_FAULT",
    );
    assert.equal(
      await readFile(sentinel, "utf-8"),
      "replacement tree, not owned by this staging instance",
    );
    assert.equal(await readFile(join(moved, basename(result.stagedPath)), "utf-8"), "body");
    assert.equal(await pathKind(moved), "directory");
  });

  it("refuses a cache root that is itself a symlink", async () => {
    const root = await cacheRootFor("contain-cache-target");
    const link = join(dirname(root), `${root.split("/").pop()}-link`);
    await symlink(root, link);
    const harness = leaseHarness();
    const pages = stagingOf(link, harness);
    const slot = await pages.acquire("p1");
    await assert.rejects(
      slot.write("body"),
      (error: unknown) => errorCodeOf(error) === "STAGING_FAULT",
    );
    assert.deepEqual(await readdir(root), []);
    await slot.release();
    await pages.settle();
  });

  it("supports concurrent independent operations on one cache root", async () => {
    const root = await cacheRootFor("contain-concurrent");
    const first = leaseHarness();
    const second = leaseHarness();
    const firstPages = stagingOf(root, first);
    const secondPages = stagingOf(root, second);
    const firstSlot = await firstPages.acquire("a1");
    const secondSlot = await secondPages.acquire("b1");
    const firstWrite = await firstSlot.write("first body");
    const secondWrite = await secondSlot.write("second body");
    const firstDirectory = await firstPages.directory();
    const secondDirectory = await secondPages.directory();
    assert.notEqual(firstDirectory, secondDirectory);
    await firstSlot.release();
    await secondSlot.release();
    await firstPages.settle();
    assert.equal(await pathKind(firstDirectory), "missing");
    assert.equal(await pathKind(firstWrite.stagedPath), "missing");
    assert.equal(await readFile(secondWrite.stagedPath, "utf-8"), "second body");
    await secondPages.settle();
    assert.equal(await pathKind(secondDirectory), "missing");
    assert.equal(await pathKind(join(root, ".staging")), "directory");
  });
});

describe("page staging lease boundaries", () => {
  it("never calls acquireFetch, abort, settle or track on the parent lease", async () => {
    const root = await cacheRootFor("lease-untouched");
    const harness = leaseHarness();
    const pages = stagingOf(root, harness);
    const slot = await pages.acquire("p1");
    await slot.write("body");
    const queued = pages.acquire("p2");
    await slot.release();
    const granted = await queued;
    await granted.release();
    harness.controller.abort("late abort");
    await pages.settle();
    assert.equal(harness.calls.acquireFetch, 0);
    assert.equal(harness.calls.cutoffPages, 0);
    assert.equal(harness.calls.track, 0);
    assert.equal(harness.calls.abort, 0);
    assert.equal(harness.calls.settle, 0);
  });
});
