// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { it } from "node:test";
import type {
  Clock,
  FetchClient,
  OperationServices,
  Progress,
  RunStore,
} from "../src/core/contracts.js";
import {
  createOperationRuntime,
  createRuntimeGenerations,
  type OperationRuntimeOptions,
} from "../src/core/operation-runtime.js";
import { createPolicyHooks, runModelWithPolicy } from "../src/core/llm.js";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const neverPersistence = async (): Promise<never> => {
  throw new Error("Persistence integration is not enabled");
};
const fetch: FetchClient = { fetch: neverPersistence, discover: neverPersistence };
function store(settle: () => Promise<void> = async () => {}): RunStore {
  return {
    allocate: neverPersistence,
    commit: neverPersistence,
    updateIndex: neverPersistence,
    recordAccounting: neverPersistence,
    candidates: neverPersistence,
    settle,
  };
}
function options(overrides: Partial<OperationRuntimeOptions> = {}): OperationRuntimeOptions {
  const clock: Clock = {
    monotonicMs: () => 0,
    utcIso: () => "2026-10-18T00:00:00.000Z",
    schedule() {
      throw new Error("No timer expected");
    },
    sleep() {
      throw new Error("No sleep expected");
    },
  };
  return {
    clock,
    generation: 1,
    modelConcurrency: 2,
    criticalReserve: 1,
    fetchConcurrency: 1,
    minRequestIntervalMs: 0,
    createFetch: () => fetch,
    createRuns: () => store(),
    ...overrides,
  };
}
const aborted = { code: "ABORTED" };
const closed = { code: "CLOSED" };
function progress(operationId: string): Progress {
  return {
    operationId,
    sequence: 1,
    stage: "search",
    event: "start",
    state: "running",
    message: "Starting",
    elapsedMs: 0,
    stageIdx: 0,
    totalStages: 1,
    pct: 0,
  };
}
async function model(services: OperationServices, callId: string) {
  const hooks = createPolicyHooks(
    services,
    {
      operation: services.operation,
      ledger: services.ledger,
      role: "search",
      callId,
    },
    { error() {}, warn() {} },
    () => 0.5,
  );
  return runModelWithPolicy(
    async () => ({ value: callId }),
    {
      model: { provider: "fixture", model: "chosen" },
    },
    hooks,
  );
}

it("T10 runtime construction is inert and captures coordinator options/factories", async () => {
  let factories = 0;
  const mutable = {
    ...options(),
    createRuns: () => {
      factories++;
      return store();
    },
  };
  const runtime = createOperationRuntime(mutable);
  assert.equal(factories, 0);
  mutable.generation = 9;
  mutable.createRuns = () => {
    throw new Error("mutated factory");
  };
  assert.equal(runtime.generation, 1);
  await runtime.run({ operationId: "op" }, async (services) => {
    assert.equal(services.clock, mutable.clock);
    assert.equal(services.coordinator, runtime.coordinator);
    assert.equal(services.operation.generation, 1);
    assert.ok(Object.isFrozen(services));
  });
  assert.equal(factories, 1);
  assert.equal(runtime.coordinator.snapshot().activeOperations, 0);
  const closing = runtime.close();
  assert.equal(runtime.close(), closing);
  await closing;
  await assert.rejects(
    runtime.run({ operationId: "late" }, async () => {}),
    closed,
  );
});

it("T10 every invocation has a separate lease, ledger and run store", async () => {
  const stores: RunStore[] = [];
  const services: OperationServices[] = [];
  const release = deferred();
  const runtime = createOperationRuntime(
    options({
      createRuns: () => {
        const runs = store();
        stores.push(runs);
        return runs;
      },
    }),
  );
  const calls = ["one", "two"].map((operationId) =>
    runtime.run({ operationId }, async (context) => {
      services.push(context);
      await model(context, "call");
      await release.promise;
    }),
  );
  await flush();
  assert.equal(runtime.coordinator.snapshot().activeOperations, 2);
  assert.notEqual(services[0].operation, services[1].operation);
  assert.notEqual(services[0].ledger, services[1].ledger);
  assert.notEqual(stores[0], stores[1]);
  assert.equal(services[0].ledger.records()[0].operationId, "one");
  assert.equal(services[1].ledger.records()[0].operationId, "two");
  release.resolve();
  await Promise.all(calls);
  await runtime.close();
});

it("T04 parent ownership spans empty inter-stage gaps and store cleanup", async () => {
  const gap = deferred();
  const cleanup = deferred();
  let services!: OperationServices;
  let drained = false;
  const runtime = createOperationRuntime(
    options({ createRuns: () => store(() => cleanup.promise) }),
  );
  const call = runtime.run({ operationId: "chain" }, async (context) => {
    services = context;
    await model(context, "first");
    await gap.promise;
    return model(context, "second");
  });
  await flush();
  const settlement = services.operation.settle().then(() => {
    drained = true;
  });
  await flush();
  assert.equal(drained, false);
  assert.equal(runtime.coordinator.snapshot().activeModels, 0);
  gap.resolve();
  await flush();
  assert.equal(services.ledger.records().length, 2, "settle cannot close an empty gap");
  assert.equal(drained, false, "store cleanup remains owned");
  cleanup.resolve();
  assert.equal(await call, "second");
  await settlement;
  assert.equal(drained, true);
  assert.throws(() => services.operation.track(Promise.resolve()), closed);
  await runtime.close();
});

it("T04 callback failure aborts then drains tracked work and the store before rejecting", async () => {
  const tail = deferred();
  const cleanup = deferred();
  const failure = new Error("body failed");
  let services!: OperationServices;
  let returned = false;
  const runtime = createOperationRuntime(
    options({ createRuns: () => store(() => cleanup.promise) }),
  );
  const call = assert
    .rejects(
      runtime.run({ operationId: "failed" }, async (context) => {
        services = context;
        context.operation.track(tail.promise);
        throw failure;
      }),
      (error) => error === failure,
    )
    .then(() => {
      returned = true;
    });
  await flush();
  assert.equal(services.operation.signal.aborted, true);
  let runtimeClosed = false;
  const closing = runtime.close().then(() => {
    runtimeClosed = true;
  });
  cleanup.resolve();
  await flush();
  assert.equal(returned, false);
  assert.equal(runtimeClosed, false);
  tail.resolve();
  await Promise.all([call, closing]);
  assert.equal(runtime.coordinator.snapshot().activeOperations, 0);
});

it("T04 service-construction and cleanup failures still deregister the lease", async () => {
  let cleanups = 0;
  let called = false;
  const runtime = createOperationRuntime(
    options({
      createRuns: () =>
        store(async () => {
          cleanups++;
        }),
      createFetch: () => {
        throw new Error("fetch construction failed");
      },
    }),
  );
  await assert.rejects(
    runtime.run({ operationId: "construction" }, async () => {
      called = true;
    }),
    /fetch construction failed/,
  );
  assert.equal(called, false);
  assert.equal(cleanups, 1);
  assert.equal(runtime.coordinator.snapshot().activeOperations, 0);
  await runtime.close();
  const badCleanup = createOperationRuntime(
    options({
      createRuns: () =>
        store(async () => {
          throw new Error("cleanup failed");
        }),
    }),
  );
  await assert.rejects(
    badCleanup.run({ operationId: "cleanup" }, async () => "answer"),
    /cleanup failed/,
  );
  assert.equal(badCleanup.coordinator.snapshot().activeOperations, 0);
  await badCleanup.close();
});

it("T10 pre-aborted admission starts no factory or operation body", async () => {
  const controller = new AbortController();
  controller.abort();
  const runtime = createOperationRuntime(
    options({
      createRuns: () => {
        throw new Error("factory ran");
      },
    }),
  );
  await assert.rejects(
    runtime.run({ operationId: "cancelled", signal: controller.signal }, async () => {
      throw new Error("body ran");
    }),
    aborted,
  );
  assert.equal(runtime.coordinator.snapshot().activeOperations, 0);
  await runtime.close();
});

it("T10 progress uses the captured callback and rejects stale/foreign delivery", async () => {
  const release = deferred();
  const events: Progress[] = [];
  let services!: OperationServices;
  const runtime = createOperationRuntime(options());
  const invocation = {
    operationId: "progress",
    onProgress: (event: Progress) => {
      events.push(event);
    },
  };
  const call = runtime.run(invocation, async (context) => {
    services = context;
    await release.promise;
  });
  invocation.onProgress = () => {
    throw new Error("fresh widget must not receive old events");
  };
  services.onProgress!(progress("progress"));
  services.onProgress!(progress("foreign"));
  assert.equal(events.length, 1);
  release.resolve();
  await call;
  services.onProgress!(progress("progress"));
  assert.equal(events.length, 1);
  await runtime.close();
});

it("T10 replacement stops old admissions immediately and waits for complete cleanup", async () => {
  const generations = createRuntimeGenerations();
  const cleanup = deferred();
  const body = deferred();
  let oldServices!: OperationServices;
  const old = await generations.replace(
    options({ createRuns: () => store(() => cleanup.promise) }),
  );
  const oldCall = assert.rejects(
    generations.run({ operationId: "old" }, async (services) => {
      oldServices = services;
      await body.promise; // deliberately uncooperative until the test releases it
    }),
    aborted,
  );
  await flush();
  let enabled = false;
  const replacement = generations.replace(options({ generation: 2 })).then((runtime) => {
    enabled = true;
    return runtime;
  });
  assert.equal(oldServices.operation.signal.aborted, true);
  assert.equal(old.coordinator.snapshot().closed, true);
  await assert.rejects(
    old.run({ operationId: "stale" }, async () => {}),
    closed,
  );
  const queued = generations.run({ operationId: "new" }, async (services) => {
    assert.equal(old.coordinator.snapshot().activeOperations, 0);
    return services.operation.generation;
  });
  await flush();
  assert.equal(enabled, false);
  body.resolve();
  await flush();
  assert.equal(enabled, false, "cleanup is not excluded from replacement drain");
  cleanup.resolve();
  await oldCall;
  const fresh = await replacement;
  assert.equal(await queued, 2);
  await old.close("Stale shutdown callback");
  assert.equal(fresh.coordinator.snapshot().closed, false);
  await fresh.close();
});

it("T10 gate cancellation removes its listener and never admits the cancelled caller", async () => {
  const generations = createRuntimeGenerations();
  const hold = deferred();
  await generations.replace(options());
  const old = assert.rejects(
    generations.run({ operationId: "old" }, async () => hold.promise),
    aborted,
  );
  await flush();
  const replacing = generations.replace(options({ generation: 2 }));
  const controller = new AbortController();
  let entered = false;
  const queued = assert.rejects(
    generations.run({ operationId: "cancelled", signal: controller.signal }, async () => {
      entered = true;
    }),
    aborted,
  );
  assert.equal(getEventListeners(controller.signal, "abort").length, 1);
  controller.abort();
  await queued;
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  assert.equal(entered, false);
  hold.resolve();
  await old;
  const fresh = await replacing;
  await flush();
  assert.equal(entered, false);
  assert.equal(fresh.coordinator.snapshot().activeOperations, 0);
  await fresh.close();
});

it("T10 overlapping replacements route waiting calls only into the latest generation", async () => {
  const generations = createRuntimeGenerations();
  const hold = deferred();
  const first = await generations.replace(options());
  const oldCall = assert.rejects(
    generations.run({ operationId: "old" }, async () => hold.promise),
    aborted,
  );
  await flush();
  const mutable = { ...options({ generation: 2 }) };
  const second = generations.replace(mutable);
  const waiting = generations.run(
    { operationId: "waiting" },
    async (services) => services.operation.generation,
  );
  mutable.generation = 99;
  const third = generations.replace(options({ generation: 3 }));
  const middleCannotAdmit = second.then((middle) =>
    assert.rejects(
      middle.run({ operationId: "superseded" }, async () => {
        throw new Error("superseded generation ran");
      }),
      closed,
    ),
  );
  hold.resolve();
  await oldCall;
  const middle = await second;
  const latest = await third;
  await middleCannotAdmit;
  assert.equal(middle.generation, 2);
  assert.equal(middle.coordinator.snapshot().closed, true);
  assert.equal(first.coordinator.snapshot().activeOperations, 0);
  assert.equal(await waiting, 3);
  await middle.close();
  assert.equal(latest.coordinator.snapshot().closed, false);
  await latest.close();
});

it("T10 failed replacement cannot fall back to old work; a later valid generation recovers", async () => {
  const generations = createRuntimeGenerations();
  await assert.rejects(
    generations.run({ operationId: "before" }, async () => {}),
    closed,
  );
  const first = await generations.replace(options());
  await assert.rejects(
    generations.replace(options({ generation: 2, modelConcurrency: 1 })),
    /modelConcurrency/,
  );
  await assert.rejects(
    generations.run({ operationId: "after-failure" }, async () => {}),
    /modelConcurrency/,
  );
  assert.equal(first.coordinator.snapshot().closed, true);
  await assert.rejects(generations.replace(options({ generation: 2 })), /increase monotonically/);
  const third = await generations.replace(options({ generation: 3 }));
  assert.equal(
    await generations.run(
      { operationId: "recovered" },
      async (services) => services.operation.generation,
    ),
    3,
  );
  await third.close();
});

it("T04 abort during final filesystem cleanup cannot return a successful result", async () => {
  const cleanup = deferred();
  const controller = new AbortController();
  const runtime = createOperationRuntime(
    options({ createRuns: () => store(() => cleanup.promise) }),
  );
  const call = assert.rejects(
    runtime.run({ operationId: "finalising", signal: controller.signal }, async () => "answer"),
    aborted,
  );
  await flush();
  controller.abort();
  cleanup.resolve();
  await call;
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  await runtime.close();
});

it("T10 a superseded construction failure cannot reject a waiter for the latest valid generation", async () => {
  const generations = createRuntimeGenerations();
  const hold = deferred();
  await generations.replace(options());
  const old = assert.rejects(
    generations.run({ operationId: "old" }, async () => hold.promise),
    aborted,
  );
  await flush();
  const bad = assert.rejects(
    generations.replace(options({ generation: 2, modelConcurrency: 1 })),
    /modelConcurrency/,
  );
  const waiter = generations.run(
    { operationId: "waiting" },
    async (services) => services.operation.generation,
  );
  const latest = generations.replace(options({ generation: 3 }));
  hold.resolve();
  await Promise.all([old, bad]);
  await latest;
  assert.equal(await waiter, 3);
  await generations.close();
});

it("T04 cleanup failure preserves the primary failure object and emits a diagnostic", async () => {
  const primary = Object.assign(new Error("provider failed"), { partialData: { attempts: 1 } });
  const diagnostics: string[] = [];
  const runtime = createOperationRuntime(
    options({
      createRuns: () =>
        store(async () => {
          throw new Error("cleanup failed");
        }),
    }),
  );
  await assert.rejects(
    runtime.run(
      {
        operationId: "failed",
        onDiagnostic: (item) => {
          diagnostics.push(item.code + ": " + item.message);
        },
      },
      async () => {
        throw primary;
      },
    ),
    (error) => error === primary,
  );
  assert.deepEqual(diagnostics, ["OPERATION_CLEANUP_FAILED: cleanup failed"]);
  assert.equal(runtime.coordinator.snapshot().activeOperations, 0);
  await runtime.close();
});

it("T20 progress and diagnostic consumer exceptions cannot discard an answer", async () => {
  const diagnostics: string[] = [];
  const runtime = createOperationRuntime(options());
  for (const throwingDiagnostic of [false, true]) {
    assert.equal(
      await runtime.run(
        {
          operationId: "progress",
          onProgress: () => {
            throw new Error("renderer failed");
          },
          onDiagnostic: (item) => {
            diagnostics.push(item.code);
            if (throwingDiagnostic) throw new Error("diagnostic renderer failed");
          },
        },
        async (services) => {
          services.onProgress!(progress("progress"));
          return "answer";
        },
      ),
      "answer",
    );
  }
  assert.deepEqual(diagnostics, ["PROGRESS_DELIVERY_FAILED", "PROGRESS_DELIVERY_FAILED"]);
  await runtime.close();
});

it("T10 direct coordinator closure also suppresses progress; abort retains its reason", async () => {
  const runtime = createOperationRuntime(options());
  const hold = deferred();
  const events: Progress[] = [];
  let services!: OperationServices;
  const call = assert.rejects(
    runtime.run(
      { operationId: "old", onProgress: (item) => events.push(item) },
      async (context) => {
        services = context;
        await hold.promise;
        context.onProgress!(progress("old"));
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "Session replaced");
      assert.equal(error.cause, services.operation.signal.reason);
      return true;
    },
  );
  const closing = runtime.coordinator.close("Session replaced");
  hold.resolve();
  await Promise.all([call, closing]);
  assert.deepEqual(events, []);
  await runtime.close();
});

it("T10 terminal factory disposal drains pending replacement and never enables a successor", async () => {
  const generations = createRuntimeGenerations();
  const hold = deferred();
  const first = await generations.replace(options());
  const old = assert.rejects(
    generations.run({ operationId: "old" }, async () => hold.promise),
    aborted,
  );
  await flush();
  const next = assert.rejects(generations.replace(options({ generation: 2 })), closed);
  const waiter = assert.rejects(
    generations.run({ operationId: "waiting" }, async () => {
      throw new Error("unexpected work");
    }),
    closed,
  );
  const closing = generations.close("Factory unloaded");
  assert.equal(generations.close(), closing);
  let settled = false;
  void closing.then(() => {
    settled = true;
  });
  await assert.rejects(generations.replace(options({ generation: 3 })), closed);
  await assert.rejects(
    generations.run({ operationId: "after" }, async () => {}),
    closed,
  );
  await flush();
  assert.equal(settled, false);
  hold.resolve();
  await Promise.all([old, next, waiter, closing]);
  assert.equal(first.coordinator.snapshot().activeOperations, 0);
  assert.equal(settled, true);
});

it("T10 ignored early replacement rejections are handled without hiding them from awaiters", async () => {
  const generations = createRuntimeGenerations();
  await generations.replace(options());
  void generations.replace(options());
  await flush();
  await assert.rejects(generations.replace(options()), /increase monotonically/);
  await generations.close();
  void generations.replace(options({ generation: 2 }));
  await flush();
  await assert.rejects(generations.replace(options({ generation: 2 })), closed);
});

it("T10 caller abort reasons survive admission and diagnostic delivery survives close", async () => {
  const controller = new AbortController();
  const hold = deferred();
  const reason = new Error("User pressed Esc");
  const runtime = createOperationRuntime(options());
  const call = assert.rejects(
    runtime.run({ operationId: "cancel", signal: controller.signal }, async () => hold.promise),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, reason.message);
      assert.equal(error.cause, reason);
      return true;
    },
  );
  controller.abort(reason);
  hold.resolve();
  await call;
  await runtime.close();

  const body = deferred();
  const primary = new Error("Primary failure");
  const diagnostics: string[] = [];
  let services!: OperationServices;
  const closingRuntime = createOperationRuntime(
    options({
      createRuns: () =>
        store(async () => {
          throw new Error("cleanup failed");
        }),
    }),
  );
  const failure = assert.rejects(
    closingRuntime.run(
      {
        operationId: "closing",
        onDiagnostic: (item) => {
          diagnostics.push(item.code);
        },
      },
      async (context) => {
        services = context;
        await body.promise;
        throw primary;
      },
    ),
    (error) => error === primary,
  );
  const closing = closingRuntime.close();
  body.resolve();
  await Promise.all([failure, closing]);
  assert.deepEqual(diagnostics, ["OPERATION_CLEANUP_FAILED"]);
  assert.equal(services.operation.signal.aborted, true);
});

it("T10 terminal disposal is inert and permanent even before the initial generation", async () => {
  const generations = createRuntimeGenerations();
  await generations.close();
  await assert.rejects(generations.replace(options()), closed);
  await assert.rejects(
    generations.run({ operationId: "never" }, async () => {}),
    closed,
  );
});
