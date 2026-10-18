// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { it } from "node:test";
import type { Clock, ModelPolicy, ModelRole, PolicyHooks } from "../src/core/contracts.js";
import { AdmissionError, createExecutionCoordinator } from "../src/core/execution-coordinator.js";
import { runModelWithPolicy } from "../src/core/llm.js";
import { createAttemptLedger } from "../src/core/usage.js";

// Compile the actual implementation against both frozen policy signatures.
const policy: ModelPolicy = runModelWithPolicy;
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

class TestClock implements Clock {
  now = 0;
  private timers = new Set<{ at: number; callback: () => void }>();
  monotonicMs() {
    return this.now;
  }
  utcIso() {
    return "2026-10-18T00:00:00.000Z";
  }
  schedule(ms: number, callback: () => void) {
    const timer = { at: this.now + ms, callback };
    this.timers.add(timer);
    return () => {
      this.timers.delete(timer);
    };
  }
  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
      const onAbort = () => {
        cancel();
        reject(new DOMException("Aborted", "AbortError"));
      };
      const cancel = this.schedule(ms, () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      });
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
  get pending() {
    return this.timers.size;
  }
  async advance(ms: number) {
    const target = this.now + ms;
    for (;;) {
      await flush();
      const next = [...this.timers].filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      this.timers.delete(next);
      this.now = next.at;
      next.callback();
    }
    this.now = target;
    await flush();
  }
}

const request = {
  model: { provider: "fixture", model: "selected" },
  retry: { attempts: 3, baseDelayMs: 10, maxDelayMs: 100 },
  timeoutMs: 1000,
};
function setup(role: ModelRole = "search", pacing = 0) {
  const clock = new TestClock();
  const coordinator = createExecutionCoordinator({
    clock,
    generation: 1,
    modelConcurrency: 2,
    criticalReserve: 1,
    fetchConcurrency: 1,
    minRequestIntervalMs: pacing,
  });
  const operation = coordinator.begin("operation");
  const ledger = createAttemptLedger();
  const notices: string[] = [];
  const hooks: PolicyHooks = {
    coordinator,
    clock,
    scope: { operation, ledger, role, callId: "call" },
    random: () => 0.5,
    logger: {
      error: (message) => {
        notices.push(message);
      },
      warn() {},
    },
  };
  return { clock, coordinator, operation, ledger, hooks, notices };
}

it("T11 scoped policy reacquires per retry, releases before backoff and records error usage", async () => {
  const { clock, coordinator, operation, ledger, hooks, notices } = setup();
  const starts: number[] = [];
  const work = policy(
    async (control) => {
      starts.push(clock.now);
      assert.equal(coordinator.snapshot().activeModels, 1);
      control.observe({
        tokens: { inputTotal: 10 },
        source: "provider-response",
        costBasis: "reported",
        cost: { total: 0.01 },
      });
      control.retryAfterMs = 80;
      return control.identity.attempt === 1
        ? { value: "", error: "429 rate limited" }
        : { value: "ok" };
    },
    request,
    hooks,
  );
  await flush();
  assert.equal(coordinator.snapshot().activeModels, 0);
  assert.deepEqual(
    ledger.records().map((r) => r.state),
    ["failed"],
  );
  let settled = false;
  const draining = operation.settle().then(() => {
    settled = true;
  });
  await clock.advance(79);
  assert.equal(settled, false, "policy owns its backoff even after permit release");
  const other = coordinator.begin("other");
  (
    await coordinator.acquireModel({
      operationId: other.id,
      kind: "critical",
      signal: other.signal,
    })
  ).release();
  await clock.advance(1);
  assert.equal(await work, "ok");
  await draining;
  await other.settle();
  assert.deepEqual(starts, [0, 80]);
  assert.deepEqual(
    ledger.records().map((r) => [r.attempt, r.state]),
    [
      [1, "failed"],
      [2, "succeeded"],
    ],
  );
  assert.equal(ledger.summary().reportedCost.total, 0.02);
  assert.equal(notices.length, 1);
  assert.equal(clock.pending, 0);
  await coordinator.close();
});

for (const resolves of [false, true]) {
  it(`T11 scoped attempt timeout excludes queue wait and drains a ${resolves ? "resolving" : "throwing"} transport`, async () => {
    const { clock, coordinator, operation, ledger, hooks } = setup("extract");
    const blocker = await coordinator.acquireModel({
      operationId: operation.id,
      kind: "page",
      signal: operation.signal,
    });
    let dispatched = false;
    const work = policy(
      async (control) => {
        dispatched = true;
        try {
          await clock.sleep(10000, control.signal);
        } catch (error) {
          if (!resolves) throw error;
        }
        return { value: "late" };
      },
      { ...request, timeoutMs: 100, retry: undefined },
      hooks,
    );
    const failure = assert.rejects(work, /timed out.*100ms.*1 attempt/);
    await clock.advance(500);
    assert.equal(dispatched, false);
    assert.equal(ledger.summary().attempts, 0);
    assert.equal(clock.pending, 0, "no timeout runs in the admission queue");
    blocker.release();
    await flush();
    await clock.advance(99);
    assert.equal(coordinator.snapshot().activeModels, 1);
    await clock.advance(1);
    await failure;
    assert.deepEqual(
      ledger.records().map((r) => [r.state, r.startedAtMs, r.settledAtMs, r.queueMs]),
      [["timed-out", 500, 600, 500]],
    );
    await operation.settle();
    assert.equal(clock.pending, 0);
    await coordinator.close();
  });
}

it("T11 scoped timeouts retry under the same injected clock, not wall-time timers", async () => {
  const { clock, coordinator, operation, ledger, hooks } = setup();
  const work = policy(
    async (control) => {
      await clock.sleep(10000, control.signal);
      return { value: "unreachable" };
    },
    { ...request, timeoutMs: 100 },
    hooks,
  );
  const failure = assert.rejects(work, /timed out.*3 attempt/);
  await clock.advance(315); // timeouts at 100, 205 and 315, with 5/10ms jitter waits
  await failure;
  assert.deepEqual(
    ledger.records().map((r) => [r.state, r.startedAtMs]),
    [
      ["timed-out", 0],
      ["timed-out", 105],
      ["timed-out", 215],
    ],
  );
  await operation.settle();
  assert.equal(clock.pending, 0);
  await coordinator.close();
});

it("T11 admission errors never retry even when their diagnostic looks transient", async () => {
  const { coordinator, operation, ledger, hooks, clock } = setup();
  let admissions = 0;
  let transports = 0;
  const rejecting = {
    ...coordinator,
    acquireModel: async () => {
      admissions++;
      throw new AdmissionError("BUSY", "503 rate limited admission");
    },
  };
  // Retain owns() from the actual coordinator; only force the admission outcome.
  await assert.rejects(
    policy(
      async () => {
        transports++;
        return { value: "" };
      },
      request,
      { ...hooks, coordinator: rejecting },
    ),
    { code: "BUSY" },
  );
  assert.equal(admissions, 1);
  assert.equal(transports, 0);
  assert.equal(ledger.summary().attempts, 0);
  assert.equal(clock.pending, 0);
  await operation.settle();
  await coordinator.close();
});

it("T11 wrong coordinator and closed lease fail before dispatch without retry", async () => {
  const current = setup();
  const foreign = setup();
  let transports = 0;
  const transport = async () => {
    transports++;
    return { value: "" };
  };
  await assert.rejects(
    policy(transport, request, { ...current.hooks, coordinator: foreign.coordinator }),
    /does not belong/,
  );
  await current.operation.settle();
  await assert.rejects(policy(transport, request, current.hooks), { code: "CLOSED" });
  assert.equal(transports, 0);
  assert.equal(current.ledger.summary().attempts, 0);
  await current.coordinator.close();
  await foreign.coordinator.close();
});

it("T09 cutoff lets an active extraction finish but forbids its retry without another attempt record", async () => {
  const { coordinator, operation, ledger, hooks, clock } = setup("extract");
  const work = policy(
    async (control) => {
      operation.cutoffPages();
      assert.equal(control.signal.aborted, false, "page cutoff is not operation cancellation");
      return { value: "", error: "503" };
    },
    request,
    hooks,
  );
  const failure = assert.rejects(work, { code: "PAGE_CUTOFF" });
  await clock.advance(5);
  await failure;
  assert.deepEqual(
    ledger.records().map((r) => r.state),
    ["failed"],
  );
  await operation.settle();
  assert.equal(clock.pending, 0);
  await coordinator.close();
});

for (const location of ["queue", "pacing", "transport", "backoff"] as const) {
  it(`T13 operation cancellation removes scoped ${location} work even with no request signal`, async () => {
    const { coordinator, operation, ledger, hooks, clock } = setup(
      "extract",
      location === "pacing" ? 100 : 0,
    );
    const blocker =
      location === "queue" || location === "pacing"
        ? await coordinator.acquireModel({
            operationId: operation.id,
            kind: "page",
            signal: operation.signal,
          })
        : undefined;
    if (location === "pacing") blocker!.release();
    let attempts = 0;
    const work = policy(
      async (control) => {
        attempts++;
        if (location === "transport") await clock.sleep(10000, control.signal);
        return { value: "", error: "503" };
      },
      request,
      hooks,
    );
    const failure = assert.rejects(work, { name: "AbortError" });
    await flush();
    operation.abort();
    blocker?.release();
    await failure;
    await operation.settle();
    assert.equal(attempts, location === "transport" || location === "backoff" ? 1 : 0);
    assert.equal(ledger.summary().attempts, attempts);
    if (location === "transport") assert.equal(ledger.records()[0].state, "aborted");
    assert.equal(clock.pending, 0);
    assert.equal(coordinator.snapshot().activeOperations, 0);
    await coordinator.close();
  });
}

it("T11 request-only abort and runtime close both drain active scoped work", async () => {
  for (const close of [false, true]) {
    const { coordinator, operation, ledger, hooks, clock } = setup();
    const controller = new AbortController();
    const work = policy(
      async (control) => {
        await clock.sleep(10000, control.signal);
        return { value: "unreachable" };
      },
      { ...request, signal: controller.signal },
      hooks,
    );
    const failure = assert.rejects(work, { name: "AbortError" });
    await flush();
    if (close) await coordinator.close();
    else controller.abort();
    await failure;
    await operation.settle();
    assert.equal(ledger.records()[0].state, "aborted");
    assert.equal(clock.pending, 0);
    await coordinator.close();
  }
});

it("T15 scoped native standalone policy stays one attempt with no application timer", async () => {
  const { coordinator, operation, ledger, hooks, clock } = setup();
  await assert.rejects(
    policy(async () => ({ value: "", error: "503" }), { model: request.model }, hooks),
    /LLM call failed/,
  );
  assert.equal(ledger.summary().attempts, 1);
  assert.equal(clock.pending, 0);
  await operation.settle();
  await coordinator.close();
});

it("T11 scoped transport TypeError is retryable, unlike pre-dispatch identity failures", async () => {
  const { coordinator, operation, ledger, hooks, clock, notices } = setup();
  const channels: string[] = [];
  const work = policy(
    async (control) => {
      if (control.identity.attempt === 1) throw new TypeError("fetch failed");
      return { value: "ok" };
    },
    {
      ...request,
      onRetryNotice: (message) => {
        channels.push(message);
      },
    },
    hooks,
  );
  await clock.advance(5);
  assert.equal(await work, "ok");
  assert.deepEqual(
    ledger.records().map((r) => r.state),
    ["failed", "succeeded"],
  );
  assert.equal(channels.length, 1);
  assert.equal(notices.length, 0);
  await operation.settle();
  await coordinator.close();
});
