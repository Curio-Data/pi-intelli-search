// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import test from "node:test";
import assert from "node:assert/strict";
import { OperationQueue } from "../src/queue.js";

const factories = {
  cancelled: () => "cancelled" as const,
  busy: () => "busy" as const,
};
const deferred = () => {
  let release: (value: string) => void = () => {};
  const promise = new Promise<string>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

test("queued work starts in order and never exceeds the concurrency bound", async () => {
  const queue = new OperationQueue<string>({ maxConcurrent: 1, maxQueued: 4 }, factories);
  const first = deferred();
  const order: string[] = [];
  const one = queue.submit(async () => {
    order.push("one");
    return first.promise;
  }, new AbortController().signal);
  const two = queue.submit(async () => {
    order.push("two");
    return "two";
  }, new AbortController().signal);
  first.release("one");
  assert.deepEqual(await Promise.all([one, two]), ["one", "two"]);
  assert.deepEqual(order, ["one", "two"]);
  await queue.close();
});

test("overflow settles as busy without queueing", async () => {
  const queue = new OperationQueue<string>({ maxConcurrent: 1, maxQueued: 1 }, factories);
  const stalled = deferred();
  const active = queue.submit(() => stalled.promise, new AbortController().signal);
  const queued = queue.submit(() => Promise.resolve("queued"), new AbortController().signal);
  const overflow = await queue.submit(
    () => Promise.resolve("overflow"),
    new AbortController().signal,
  );
  assert.equal(overflow, "busy");
  stalled.release("active");
  assert.equal(await active, "active");
  assert.equal(await queued, "queued");
  await queue.close();
});

test("a queued request aborted before starting settles as cancelled and never starts", async () => {
  const queue = new OperationQueue<string>({ maxConcurrent: 1, maxQueued: 4 }, factories);
  const stalled = deferred();
  const active = queue.submit(() => stalled.promise, new AbortController().signal);
  const controller = new AbortController();
  let started = false;
  const queued = queue.submit(
    async () => {
      started = true;
      return "started";
    },
    controller.signal,
  );
  controller.abort();
  assert.equal(await queued, "cancelled");
  stalled.release("active");
  assert.equal(await active, "active");
  assert.equal(started, false);
  await queue.close();
});

test("an already-aborted submission settles as cancelled synchronously", async () => {
  const queue = new OperationQueue<string>({ maxConcurrent: 1, maxQueued: 4 }, factories);
  const controller = new AbortController();
  controller.abort();
  assert.equal(
    await queue.submit(() => Promise.resolve("never"), controller.signal),
    "cancelled",
  );
  await queue.close();
});

test("a rejecting handler still settles and frees the queue", async () => {
  const queue = new OperationQueue<string>({ maxConcurrent: 1, maxQueued: 4 }, factories);
  const breached = queue.submit(
    () => Promise.reject(new Error("handler contract breach")),
    new AbortController().signal,
  );
  assert.equal(await breached, "cancelled");
  const next = await queue.submit(() => Promise.resolve("next"), new AbortController().signal);
  assert.equal(next, "next");
  await queue.close();
});

test("close settles pending work as cancelled and waits for active work", async () => {
  const queue = new OperationQueue<string>({ maxConcurrent: 1, maxQueued: 4 }, factories);
  const stalled = deferred();
  const active = queue.submit(() => stalled.promise, new AbortController().signal);
  const queued = queue.submit(() => Promise.resolve("queued"), new AbortController().signal);
  const closing = queue.close();
  assert.equal(await queued, "cancelled");
  stalled.release("active");
  assert.equal(await active, "active");
  await closing;
  assert.equal(
    await queue.submit(() => Promise.resolve("after close"), new AbortController().signal),
    "cancelled",
    "submissions after close settle as cancelled",
  );
});
