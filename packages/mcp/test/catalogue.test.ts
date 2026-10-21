// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import test from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { createCatalogue } from "../src/catalogue.js";
import { createRuntime } from "../src/runtime.js";
import { createSystemClock } from "../../../src/core/clock.js";
import { catalogue, fixture, json } from "./helpers.js";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((r, j) => {
    resolve = r;
    reject = j;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise<void>((r) => setImmediate(r));

test("T14 single flight caches success for strictly less than 60 monotonic seconds", async () => {
  let now = 0;
  let loads = 0;
  const clock = { ...createSystemClock(), monotonicMs: () => now };
  const loader = createCatalogue(async () => ++loads, clock);
  const signal = new AbortController().signal;
  assert.deepEqual(await Promise.all([loader.read(signal), loader.read(signal)]), [1, 1]);
  assert.equal(getEventListeners(signal, "abort").length, 0);
  now = 59_999;
  assert.equal(await loader.read(), 1);
  now = 60_000;
  assert.equal(await loader.read(), 2);
  await loader.close();
  await assert.rejects(loader.read(), { name: "AbortError" });
});

test("T14 independent waiter cancellation leaves another load live, failure is not cached", async () => {
  let loads = 0;
  const held = deferred<number>();
  let transportSignal: AbortSignal | undefined;
  const loader = createCatalogue(async (s) => {
    transportSignal = s;
    loads++;
    return held.promise;
  }, createSystemClock());
  const a = new AbortController();
  const b = new AbortController();
  const one = loader.read(a.signal);
  const two = loader.read(b.signal);
  await tick();
  a.abort();
  await assert.rejects(one, { name: "AbortError" });
  assert.equal(transportSignal?.aborted, false);
  assert.equal(getEventListeners(a.signal, "abort").length, 0);
  held.reject(new Error("catalogue failure"));
  await assert.rejects(two, /catalogue failure/);
  await assert.rejects(loader.read(), /catalogue failure/);
  assert.equal(loads, 2);
  assert.equal(getEventListeners(b.signal, "abort").length, 0);
  await loader.close();
});

test("T14 last waiter abort waits for loader drain; arrivals cannot overlap its successor", async () => {
  const drain = deferred<number>();
  let loads = 0;
  let active = 0;
  let maximum = 0;
  let transportSignal: AbortSignal | undefined;
  const loader = createCatalogue(async (s) => {
    loads++;
    active++;
    maximum = Math.max(maximum, active);
    transportSignal = s;
    try {
      return loads === 1 ? await drain.promise : 2;
    } finally {
      active--;
    }
  }, createSystemClock());
  const caller = new AbortController();
  let settled = false;
  const first = loader.read(caller.signal);
  const rejected = assert.rejects(first, { name: "AbortError" }).then(() => {
    settled = true;
  });
  await tick();
  caller.abort();
  assert(transportSignal?.aborted);
  const next = loader.read();
  const cancelled = new AbortController();
  const waiting = loader.read(cancelled.signal);
  cancelled.abort();
  await assert.rejects(waiting, { name: "AbortError" });
  assert.equal(getEventListeners(cancelled.signal, "abort").length, 0);
  await tick();
  assert.equal(loads, 1);
  assert.equal(settled, false);
  drain.resolve(1);
  await rejected;
  assert.equal(await next, 2);
  assert.equal(maximum, 1);
  await loader.close();
});

test("T14 runtime shares loader, validates every binding and drains last cancellation/close", async () => {
  const f = await fixture();
  let now = 0;
  const cfg = f.config;
  const held = deferred<void>();
  const secondStarted = deferred<void>();
  let loads = 0;
  let completions = 0;
  let lastSignal: AbortSignal | undefined;
  const runtime = await createRuntime(cfg, {
    env: { FIXTURE_KEY: "synthetic-credential" },
    clock: { ...createSystemClock(), monotonicMs: () => now },
    fetch: async (url, init) => {
      if (String(url).endsWith("/models")) {
        loads++;
        lastSignal = init?.signal ?? undefined;
        if (loads === 2) {
          secondStarted.resolve();
          await held.promise;
        }
        // Deliberately omit extract. Each waiter must validate its own role.
        return json({
          data: catalogue().data.filter((m) => m.id !== cfg.settings.extractModel.model),
        });
      }
      completions++;
      return json({ choices: [{ message: { content: "Facts" }, finish_reason: "stop" }] });
    },
  });
  try {
    const [search, extract] = await Promise.allSettled([
      runtime.execute("intelli_search", { query: "one" }),
      runtime.execute("intelli_extract", {
        url: "label",
        title: "title",
        content: "body",
        query: "two",
      }),
    ]);
    assert.equal(search.status, "fulfilled");
    assert.equal(extract.status, "rejected");
    if (extract.status === "rejected") assert.match(extract.reason.message, /extract/);
    assert.equal(loads, 1);
    assert.equal(completions, 1);
    now = 60_000;
    const caller = new AbortController();
    const one = runtime.execute(
      "intelli_search",
      { query: "cancelled" },
      { signal: caller.signal },
    );
    const two = runtime.execute("intelli_search", { query: "close" });
    const oneFailure = assert.rejects(one, /aborted/);
    const twoFailure = assert.rejects(two, /aborted/);
    await secondStarted.promise;
    caller.abort();
    // The second operation can still be in filesystem preflight here. The
    // lower single-flight test proves independent live-waiter cancellation;
    // this actual-runtime case proves close ownership without a timing guess.
    let closed = false;
    const closing = runtime.close().then(() => {
      closed = true;
    });
    assert(lastSignal?.aborted);
    await tick();
    assert.equal(closed, false, "close cannot abandon catalogue transport");
    held.resolve();
    await Promise.all([closing, oneFailure, twoFailure]);
    assert.equal(completions, 1);
  } finally {
    held.resolve();
    await runtime.close();
    await f.cleanup();
  }
});
