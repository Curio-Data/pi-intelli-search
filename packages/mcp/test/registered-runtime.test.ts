// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";
import { createRuntime, StandaloneError } from "../src/runtime.js";
import { createProtocolServer, lazyRuntime } from "../src/server.js";
import { createSystemClock } from "../../../src/core/clock.js";
import { completion, fakeTransport, fixture, json, logger, catalogue } from "./helpers.js";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const page = { url: "https://docs.example/page", title: "Docs", content: "Facts" };
const reported = {
  prompt_tokens: 12,
  completion_tokens: 3,
  total_tokens: 15,
  cost: 0.001,
  prompt_tokens_details: { cached_tokens: 2, cache_write_tokens: 1 },
};

test("registered MCP runtime retains settled telemetry-off retry and error accounting (T11/T16)", async () => {
  const f = await fixture();
  let calls = 0;
  const base = createSystemClock();
  const clock = { ...base, monotonicMs: () => base.monotonicMs() + 1_000_000 };
  const runtime = await createRuntime(
    { ...f.config, settings: { ...f.config.settings, disableTelemetry: true } },
    {
      env: { FIXTURE_KEY: "fixture-secret" },
      logger,
      clock,
      fetch: fakeTransport(() => {
        calls++;
        return json(
          calls === 1
            ? { error: { code: 503 }, usage: reported }
            : completion("Answer", { usage: reported }),
        );
      }),
    },
  );
  try {
    const result = await runtime.execute("intelli_search", { query: "accounting" });
    assert.equal(result.execution.accounting.attempts, 2);
    assert.equal(result.execution.accounting.observedAttempts, 2);
    assert.equal(result.execution.accounting.tokens.inputTotal, 24);
    assert.equal(result.execution.accounting.tokens.inputUncached, 18);
    assert.equal(result.execution.accounting.reportedCost.total, 0.002);
    assert.equal(result.execution.accounting.costComplete, true);
    assert.equal(result.execution.usage.input, 18);
    assert(result.execution.attempts.every((item) => item.startedAtMs >= 1_000_000));
    assert.equal(result.execution.attempts[0].callId, result.execution.attempts[1].callId);
    assert.deepEqual(await readdir(f.dir), [], "no persistence needed for search/accounting");
  } finally {
    await runtime.close();
    await f.cleanup();
  }

  const bad = await fixture();
  const failed = await createRuntime(bad.config, {
    env: { FIXTURE_KEY: "fixture-secret" },
    logger,
    fetch: fakeTransport(() => json({ error: { code: 401 }, usage: reported })),
  });
  try {
    await assert.rejects(
      failed.execute("intelli_extract", { ...page, query: "failure" }),
      (error: unknown) => {
        assert(error instanceof StandaloneError);
        assert.equal(error.code, "PROVIDER");
        assert.equal(error.execution?.accounting.attempts, 1);
        assert.equal(error.execution?.accounting.reportedCost.total, 0.001);
        assert.equal(error.execution?.attempts[0].state, "failed");
        assert.equal(error.execution?.attempts[0].role, "extract");
        assert.equal(
          error.execution?.accounting.parentDelivery,
          "available",
          "ordinary failure is not parent cancellation",
        );
        assert.equal(error.cause, undefined);
        return true;
      },
    );
  } finally {
    await failed.close();
    await bad.cleanup();
  }
});

test("registered runtime close owns stage gaps and delayed cleanup, suppressing stale progress (T04/T10/T20)", async () => {
  const f = await fixture();
  const entered = deferred();
  const cleanup = deferred();
  const abortSeen = deferred();
  let closed = false;
  let progress = 0;
  const runtime = await createRuntime(f.config, {
    env: { FIXTURE_KEY: "fixture-secret" },
    // Even a faulting operation-owned diagnostic sink cannot break close.
    logger: {
      error() {
        throw new Error("renderer gone");
      },
      warn() {
        throw new Error("renderer gone");
      },
    },
    fetch: fakeTransport(() => json(completion(`[Docs](${page.url})`))),
    researchDependencies: {
      async fetchPages(_urls, signal) {
        entered.resolve();
        if (!signal?.aborted)
          await new Promise<void>((resolve) =>
            signal?.addEventListener("abort", () => resolve(), { once: true }),
          );
        abortSeen.resolve();
        await cleanup.promise;
        return [{ ...page, status: "success" }];
      },
      async downloadLlmsFullToCache() {
        return null;
      },
    },
  });
  const execution = runtime.execute(
    "intelli_research",
    { query: "gap" },
    { onProgress: () => progress++ },
  );
  const outcome = execution.catch((error: unknown) => error);
  await entered.promise;
  const before = progress;
  const closing = runtime.close().then(() => {
    closed = true;
  });
  assert.equal(runtime.close(), runtime.close(), "idempotent captured runtime close");
  await abortSeen.promise;
  await Promise.resolve();
  assert.equal(closed, false, "parent ownership survives a gap with no active model permit");
  await assert.rejects(
    runtime.execute("intelli_search", { query: "after close" }),
    (error: unknown) =>
      error instanceof StandaloneError &&
      error.code === "CANCELLED" &&
      error.execution === undefined,
  );
  cleanup.resolve();
  await closing;
  const error = await outcome;
  assert(error instanceof StandaloneError);
  assert.equal(error.code, "CANCELLED");
  assert.equal(error.execution?.accounting.attempts, 1);
  assert.equal(error.execution?.accounting.parentDelivery, "unknown");
  assert.equal(progress, before, "no stale callbacks after close");
  await f.cleanup();
});

test("registered standalone attempts respect aggregate reserve and leave no queued attempts on abort (T11/T12)", async () => {
  const f = await fixture();
  const release = deferred();
  const four = deferred();
  let starts = 0;
  const runtime = await createRuntime(f.config, {
    env: { FIXTURE_KEY: "fixture-secret" },
    logger,
    fetch: fakeTransport(async (_body, init) => {
      starts++;
      if (starts === 4) four.resolve();
      if (!init.signal?.aborted)
        await new Promise<void>((resolve) => {
          const onAbort = () => {
            init.signal?.removeEventListener("abort", onAbort);
            resolve();
          };
          init.signal?.addEventListener("abort", onAbort, { once: true });
          void release.promise.then(() => {
            init.signal?.removeEventListener("abort", onAbort);
            resolve();
          });
        });
      return json(completion("Extract", { usage: reported }));
    }),
  });
  const controllers = Array.from({ length: 6 }, () => new AbortController());
  const pending = controllers.map((controller) =>
    runtime
      .execute("intelli_extract", { ...page, query: "parallel" }, { signal: controller.signal })
      .catch((error: unknown) => error),
  );
  try {
    await four.promise;
    // Each preflight has completed before its inference can queue. Await one
    // event-loop turn so all six admitted operations reach that queue.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(starts, 4);
    controllers.forEach((controller) => controller.abort());
    release.resolve();
    const errors = await Promise.all(pending);
    const receipts = errors.map((error) => {
      assert(error instanceof StandaloneError);
      assert.equal(error.code, "CANCELLED");
      assert(error.execution);
      return error.execution;
    });
    assert.equal(
      receipts.reduce((sum, item) => sum + item.accounting.attempts, 0),
      4,
    );
    assert.equal(new Set(receipts.map((item) => item.operationId)).size, 6);
  } finally {
    release.resolve();
    await runtime.close();
    await f.cleanup();
  }
});

test("preflight cancellation and lazy protocol close drain without inference or resurrection (T04/T10)", async () => {
  const f = await fixture();
  const entered = deferred();
  const finish = deferred();
  let modelCalls = 0;
  const runtime = await createRuntime(f.config, {
    env: { FIXTURE_KEY: "fixture-secret" },
    logger,
    fetch: async (url, init) => {
      if (!String(url).endsWith("/models")) {
        modelCalls++;
        throw new Error("unexpected inference");
      }
      entered.resolve();
      if (!init?.signal?.aborted)
        await new Promise<void>((resolve) =>
          init?.signal?.addEventListener("abort", () => resolve(), { once: true }),
        );
      await finish.promise;
      return json(catalogue());
    },
  });
  const result = runtime
    .execute("intelli_search", { query: "preflight" })
    .catch((error: unknown) => error);
  await entered.promise;
  const protocol = createProtocolServer(runtime);
  let settled = false;
  const closing = protocol.close().then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  finish.resolve();
  await closing;
  const error = await result;
  assert(error instanceof StandaloneError);
  assert.equal(error.code, "CANCELLED");
  assert.equal(error.execution, undefined, "configuration failure has no fabricated usage");
  assert.equal(modelCalls, 0);

  const load = deferred<typeof f.config>();
  const lazy = lazyRuntime(() => load.promise, { logger });
  const loading = lazy().catch((error: unknown) => error);
  let lazyClosed = false;
  const lazyClosing = lazy.close().then(() => {
    lazyClosed = true;
  });
  await Promise.resolve();
  assert.equal(lazyClosed, false);
  load.resolve(f.config);
  await lazyClosing;
  assert((await loading) instanceof StandaloneError);
  await assert.rejects(lazy(), /closed/);
  await f.cleanup();
});

test("registered pacing uses one captured clock across standalone calls and retries (T13/T15)", async () => {
  const f = await fixture();
  let now = 0;
  let timers = 0;
  const starts: number[] = [];
  const clock = {
    monotonicMs: () => now,
    utcIso: () => "2026-10-19T00:00:00.000Z",
    schedule(ms: number, callback: () => void) {
      timers++;
      const at = now + ms;
      let pending = true;
      const timer = setImmediate(() => {
        pending = false;
        timers--;
        now = Math.max(now, at);
        callback();
      });
      return () => {
        if (pending) {
          pending = false;
          timers--;
          clearImmediate(timer);
        }
      };
    },
    async sleep(ms: number, signal?: AbortSignal) {
      assert(!signal?.aborted);
      now += ms;
    },
  };
  const runtime = await createRuntime(
    { ...f.config, settings: { ...f.config.settings, minRequestIntervalMs: 17 } },
    {
      env: { FIXTURE_KEY: "fixture-secret" },
      logger,
      clock,
      fetch: fakeTransport(() => {
        starts.push(now);
        return json(starts.length === 1 ? { error: { code: 503 } } : completion("Answer"));
      }),
    },
  );
  try {
    assert.equal(timers, 0, "registration starts no clock work");
    const first = runtime.execute("intelli_search", { query: "first" });
    const second = runtime.execute("intelli_extract", { ...page, query: "second" });
    const results = await Promise.all([first, second]);
    assert.equal(starts.length, 3);
    assert.deepEqual(
      starts.map((value, i) => (i ? value - starts[i - 1] : value)),
      [0, 17, 17],
    );
    assert.equal(
      results.reduce((sum, item) => sum + item.execution.accounting.attempts, 0),
      3,
    );
    assert.equal(timers, 0);
  } finally {
    await runtime.close();
    await f.cleanup();
  }
});

test("registered MCP inference cannot use the legacy unscoped bypass (source gate)", async () => {
  const runtime = await readFile(new URL("../src/runtime.ts", import.meta.url), "utf8");
  const tree = ts.createSourceFile("runtime.ts", runtime, ts.ScriptTarget.Latest, true);
  let clients = 0;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === "createOpenRouterClient") {
      clients++;
      const options = node.arguments[1];
      assert(options && ts.isObjectLiteralExpression(options));
      assert(options.properties.some((property) => property.name?.getText(tree) === "services"));
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.equal(clients, 1);
  for (const name of ["search", "extract", "collate", "research"]) {
    const source = await readFile(
      new URL(`../../../src/core/operations/${name}.ts`, import.meta.url),
      "utf8",
    );
    assert(!/\bmodels\.complete\s*\(/.test(source), `${name}: direct dispatch bypasses role scope`);
    assert(source.includes("completeOperationModel("), `${name}: missing explicit role dispatch`);
  }
  const helper = await readFile(
    new URL("../../../src/core/operation-model.ts", import.meta.url),
    "utf8",
  );
  assert.match(helper, /operation: services\.operation/);
  assert.match(helper, /ledger: services\.ledger/);
  assert.match(helper, /scope: \{/);
});
