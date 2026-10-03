// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { it } from "node:test";
import { runModelWithPolicy } from "../src/core/llm.js";
import { sleep } from "../src/core/util.js";

const request = {
  model: { provider: "fixture", model: "selected" },
  retry: { attempts: 3, baseDelayMs: 10, maxDelayMs: 100 },
  timeoutMs: 1000,
};
const logger = { error() {}, warn() {} };

it("retries error-bearing responses once per policy, honouring text and header hints", async () => {
  let attempts = 0;
  const delays: number[] = [];
  const result = await runModelWithPolicy(
    async (_signal, hints) => {
      attempts++;
      if (attempts === 1) {
        hints.retryAfterMs = 80;
        return { value: "", error: "429 rate limited" };
      }
      if (attempts === 2) return { value: "", error: "503 retry-after: 500ms" };
      return { value: "ok" };
    },
    request,
    logger,
    {
      random: () => 0,
      sleep: async (ms) => {
        delays.push(ms);
      },
    },
  );
  assert.equal(result, "ok");
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [80, 100]);
});

for (const timeoutMs of [undefined, 1000]) {
  it(`does not mistake a thrown permanent error for timeout (${timeoutMs})`, async () => {
    let attempts = 0;
    await assert.rejects(
      runModelWithPolicy(
        async () => {
          attempts++;
          throw new Error("401 invalid credential");
        },
        { ...request, timeoutMs },
        logger,
      ),
      /401 invalid credential/,
    );
    assert.equal(attempts, 1);
  });
}

it("classifies thrown network failures and returns final actionable response errors", async () => {
  let attempts = 0;
  await assert.rejects(
    runModelWithPolicy(
      async () => {
        if (++attempts === 1) throw new Error("ECONNRESET");
        return { value: "", error: "429 exhausted" };
      },
      request,
      logger,
      { sleep: async () => {} },
    ),
    /LLM call failed \(fixture\/selected\): 429 exhausted/,
  );
  assert.equal(attempts, 3);
});

for (const throws of [true, false]) {
  it(`bounds a stalled body whose transport ${throws ? "throws" : "resolves"} on timeout`, async () => {
    let attempts = 0;
    await assert.rejects(
      runModelWithPolicy(
        async (signal) => {
          attempts++;
          try {
            await sleep(10000, signal);
          } catch (error) {
            if (throws) throw error;
          }
          return { value: "aborted" };
        },
        { ...request, timeoutMs: 5 },
        logger,
        { sleep: async () => {} },
      ),
      /timed out.*fixture\/selected.*5ms.*3 attempt/,
    );
    assert.equal(attempts, 3);
  });
}

it("does not retry cancellation during a response or start work for an already-aborted request", async () => {
  for (const preAborted of [false, true]) {
    const controller = new AbortController();
    let attempts = 0;
    if (preAborted) controller.abort();
    await assert.rejects(
      runModelWithPolicy(
        async () => {
          attempts++;
          controller.abort();
          throw new Error("429 should not retry");
        },
        { ...request, signal: controller.signal },
        logger,
      ),
      { name: "AbortError" },
    );
    assert.equal(attempts, preAborted ? 0 : 1);
  }
});

it("cancels retry delay without another request", async () => {
  const controller = new AbortController();
  let attempts = 0;
  await assert.rejects(
    runModelWithPolicy(
      async () => {
        attempts++;
        return { value: "", error: "503" };
      },
      { ...request, signal: controller.signal },
      logger,
      {
        sleep: async (_ms, signal) => {
          controller.abort();
          await sleep(1000, signal);
        },
      },
    ),
    { name: "AbortError" },
  );
  assert.equal(attempts, 1);
});
