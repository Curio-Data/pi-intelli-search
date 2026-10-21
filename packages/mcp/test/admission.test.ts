// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import test from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { mergeAdmission, parseAdmission } from "../src/admission.js";
import { OperationQueue } from "../src/queue.js";
import { parseConfig } from "../src/config.js";
import { createRuntime } from "../src/runtime.js";
import { document, fixture } from "./helpers.js";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const tick = () => new Promise<void>((r) => setImmediate(r));
const factories = { cancelled: () => "cancelled", busy: () => "busy", failed: () => "failed" };
const signal = () => new AbortController().signal;

test("T03 admission validates every bound, strict keys and direct callers before work", async () => {
  assert.deepEqual(parseAdmission(undefined), { maxConcurrent: 2, maxQueued: 8 });
  assert.deepEqual(parseAdmission({ maxQueued: 0 }), { maxConcurrent: 2, maxQueued: 0 });
  assert.deepEqual(parseAdmission({ maxConcurrent: 16, maxQueued: 256 }), {
    maxConcurrent: 16,
    maxQueued: 256,
  });
  const f = await fixture();
  try {
    const cfg = await parseConfig(
      { ...document(), admission: { maxConcurrent: 1, maxQueued: 0 } },
      f.dir,
    );
    assert(Object.isFrozen(cfg.admission));
    const runtime = await createRuntime(cfg, { env: {} });
    assert.deepEqual(runtime.admission, cfg.admission);
    await runtime.close();
    for (const admission of [
      null,
      [],
      "secret",
      { secret: 1 },
      { maxQueued: null },
      { maxConcurrent: null },
      { maxConcurrent: 0 },
      { maxConcurrent: 17 },
      { maxConcurrent: 1.1 },
      { maxQueued: -1 },
      { maxQueued: 257 },
      { maxQueued: Infinity },
      { maxQueued: "secret" },
    ]) {
      assert.throws(
        () => parseAdmission(admission),
        (e: Error) => /admission/.test(e.message) && !e.message.includes("secret"),
      );
      await assert.rejects(parseConfig({ ...document(), admission }, f.dir), /admission/);
      await assert.rejects(
        createRuntime(
          { ...cfg, admission: admission as unknown as typeof cfg.admission },
          {
            fetch: async () => {
              throw new Error("must not fetch");
            },
          },
        ),
        /admission/,
      );
    }
  } finally {
    await f.cleanup();
  }
});

test("partial server overrides omit undefined without resetting configured admission", () => {
  const configured = { maxConcurrent: 4, maxQueued: 3 };
  assert.deepEqual(mergeAdmission(configured, { maxConcurrent: undefined, maxQueued: 0 }), {
    maxConcurrent: 4,
    maxQueued: 0,
  });
  assert.deepEqual(configured, { maxConcurrent: 4, maxQueued: 3 });
  assert.throws(
    () => mergeAdmission(configured, { maxConcurrent: null } as unknown as typeof configured),
    /admission/,
  );
});

test("T14 zero queue admits all free active slots and releases listeners before result", async () => {
  const queue = new OperationQueue<string>({ maxConcurrent: 2, maxQueued: 0 }, factories);
  const held = deferred<string>();
  const s = signal();
  const one = queue.submit(() => held.promise, s);
  const two = queue.submit(() => held.promise, signal());
  assert.equal(await queue.submit(async () => "never", signal()), "busy");
  held.resolve("done");
  assert.deepEqual(await Promise.all([one, two]), ["done", "done"]);
  assert.equal(getEventListeners(s, "abort").length, 0);
  assert.equal(await queue.submit(async () => "next", s), "next");
  assert.equal(
    await queue.submit(() => {
      throw new Error("sync");
    }, s),
    "failed",
  );
  assert.equal(getEventListeners(s, "abort").length, 0);
  await queue.close();
});

test("T14 queued/active cancellation removes listeners and close awaits actual active drain", async () => {
  const queue = new OperationQueue<string>({ maxConcurrent: 1, maxQueued: 2 }, factories);
  const drain = deferred<string>();
  let owned: AbortSignal | undefined;
  const caller = new AbortController();
  const queuedCaller = new AbortController();
  const active = queue.submit((s) => {
    owned = s;
    return drain.promise;
  }, caller.signal);
  await tick();
  const queued = queue.submit(async () => "never", queuedCaller.signal);
  queuedCaller.abort();
  assert.equal(await queued, "cancelled");
  assert.equal(getEventListeners(queuedCaller.signal, "abort").length, 0);
  caller.abort();
  assert(owned?.aborted);
  let settled = false;
  active.then(() => {
    settled = true;
  });
  const closing = queue.close();
  assert.equal(closing, queue.close());
  await tick();
  assert.equal(settled, false);
  drain.resolve("ignored success");
  assert.equal(await active, "cancelled");
  await closing;
  assert.equal(getEventListeners(caller.signal, "abort").length, 0);
});

test("T14 active cancellation preserves the handler's settled partial-error envelope", async () => {
  const controller = new AbortController();
  const held = deferred<string>();
  const queue = new OperationQueue<string>(
    { maxConcurrent: 1, maxQueued: 0 },
    {
      ...factories,
      cancelled: (settled) => settled ?? "cancelled",
    },
  );
  const result = queue.submit(() => held.promise, controller.signal);
  await tick();
  controller.abort();
  held.resolve("settled partial accounting");
  assert.equal(await result, "settled partial accounting");
  await queue.close();
});

test("T14 deferred configuration bounds bootstrap population then applies actual FIFO limits", async () => {
  const config = deferred<{ maxConcurrent: number; maxQueued: number }>();
  const queue = new OperationQueue<string>(() => config.promise, factories);
  const held = deferred<string>();
  const order: number[] = [];
  const calls = Array.from({ length: 272 }, (_, i) =>
    queue.submit(async () => {
      order.push(i);
      return held.promise;
    }, signal()),
  );
  assert.equal(await queue.submit(async () => "never", signal()), "busy");
  config.resolve({ maxConcurrent: 1, maxQueued: 1 });
  await tick();
  assert.deepEqual(order, [0]);
  assert((await Promise.all(calls.slice(2))).every((value) => value === "busy"));
  held.resolve("done");
  assert.deepEqual(await Promise.all(calls.slice(0, 2)), ["done", "done"]);
  assert.deepEqual(order, [0, 1]);
  await queue.close();
});

test("T14 deferred failure retries, pending cancellation cleans up, close awaits preparation", async () => {
  const config = deferred<{ maxConcurrent: number; maxQueued: number }>();
  let loads = 0;
  const queue = new OperationQueue<string>(async () => {
    if (++loads === 1) throw new Error("invalid config");
    return config.promise;
  }, factories);
  assert.equal(await queue.submit(async () => "never", signal()), "failed");
  await tick();
  const controller = new AbortController();
  const waiting = queue.submit(async () => "never", controller.signal);
  controller.abort();
  assert.equal(await waiting, "cancelled");
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  let closed = false;
  const closing = queue.close().then(() => {
    closed = true;
  });
  await tick();
  assert.equal(closed, false);
  config.resolve({ maxConcurrent: 1, maxQueued: 0 });
  await closing;
  assert.equal(await queue.submit(async () => "never", signal()), "cancelled");
});
