// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import test from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import {
  createAnnotationSink,
  wrapFetchForAnnotations,
  settleOwnedAnnotationSink,
} from "../src/core/annotations.js";
import { createOperationRuntime } from "../src/core/operation-runtime.js";
import { createSystemClock } from "../src/core/clock.js";
import { createScopedNativeModelClient } from "../src/native-model-client.js";
import type { OperationServices, RunStore, FetchClient } from "../src/core/contracts.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function heldClone() {
  const entered = deferred();
  const cancelled = deferred();
  const release = deferred();
  const response = new Response("Primary stream is complete");
  response.clone = () =>
    new Response(
      new ReadableStream<Uint8Array>({
        pull() {
          entered.resolve();
          return new Promise<void>(() => {});
        },
        async cancel() {
          cancelled.resolve();
          await release.promise;
        },
      }),
    );
  return { response, entered, cancelled, release };
}

for (const reason of ["signal", "timeout", "failure"] as const) {
  test(`owned annotation ${reason} cancellation awaits the independent reader cancellation (T04/T06)`, async () => {
    const held = heldClone();
    const controller = new AbortController();
    const sink = createAnnotationSink();
    const wrapped = wrapFetchForAnnotations(async () => held.response, sink, controller.signal);
    const result = await wrapped("https://fixture.invalid/never-network");
    assert.equal(await result.text(), "Primary stream is complete");
    await held.entered.promise;
    let timer: (() => void) | undefined;
    let cleared = false;
    const clock = {
      schedule(_ms: number, callback: () => void) {
        timer = callback;
        return () => {
          cleared = true;
        };
      },
    };
    let settled = false;
    const pending = settleOwnedAnnotationSink(
      sink,
      controller.signal,
      reason === "failure",
      2_000,
      clock,
    ).then(() => {
      settled = true;
    });
    if (reason === "signal") controller.abort();
    if (reason === "timeout") timer!();
    await held.cancelled.promise;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false, "reader.read() resolving done is not cancellation settlement");
    held.release.resolve();
    await pending;
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    if (reason !== "failure") assert(cleared);
    assert.deepEqual(sink.citations, []);
  });
}

test("owned citation reads preserve the fetch-tee floor fallback on success", async () => {
  const sink = createAnnotationSink();
  const signal = new AbortController().signal;
  const wrapped = wrapFetchForAnnotations(
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                annotations: [
                  {
                    type: "url_citation",
                    url_citation: { url: "https://docs.example/page", title: "Docs" },
                  },
                ],
              },
            },
          ],
        }),
      ),
    sink,
    signal,
  );
  const response = await wrapped("https://fixture.invalid/never-network");
  await response.text();
  await settleOwnedAnnotationSink(sink, signal);
  assert.deepEqual(sink.citations, [{ url: "https://docs.example/page", title: "Docs" }]);
  assert.equal(getEventListeners(signal, "abort").length, 0);
});

test("native scoped provider failure retains its permit through annotation cleanup (T04/T11)", async (t) => {
  const held = heldClone();
  t.mock.method(globalThis, "fetch", async () => held.response);
  const clock = createSystemClock();
  const runtime = createOperationRuntime({
    clock,
    generation: 0,
    modelConcurrency: 2,
    criticalReserve: 1,
    fetchConcurrency: 1,
    minRequestIntervalMs: 0,
    createFetch: () => ({}) as FetchClient,
    createRuns: () => ({ async settle() {} }) as RunStore,
  });
  let owned: OperationServices | undefined;
  const registry = {
    find: () => ({ provider: "fixture", id: "model" }),
    getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "synthetic" }),
    streamSimple(
      _model: unknown,
      _context: unknown,
      options: { fetch: typeof fetch; signal: AbortSignal },
    ) {
      return {
        async result() {
          const response = await options.fetch("https://fixture.invalid/never-network", {
            signal: options.signal,
          });
          await response.text();
          throw new Error("primary provider failure");
        },
      };
    },
  };
  let settled = false;
  const pending = runtime
    .run({ operationId: "owned-annotation" }, async (services) => {
      owned = services;
      const model = createScopedNativeModelClient(
        { modelRegistry: registry } as unknown as ExtensionContext,
        services,
      );
      return model.complete({
        model: { provider: "fixture", model: "model" },
        systemPrompt: "Search",
        userMessage: "Q",
        collectCitations: true,
        scope: {
          operation: services.operation,
          ledger: services.ledger,
          callId: "call",
          role: "search",
        },
      });
    })
    .then(
      () => {
        settled = true;
        return undefined;
      },
      (error: unknown) => {
        settled = true;
        return error;
      },
    );
  try {
    await held.cancelled.promise;
    assert.equal(settled, false);
    assert.equal(runtime.coordinator.snapshot().activeModels, 1);
    held.release.resolve();
    const error = await pending;
    assert(error instanceof Error);
    assert.match(error.message, /primary provider failure/);
    assert.equal(owned!.ledger.records().length, 1);
    assert.equal(owned!.ledger.records()[0].state, "failed");
    assert.equal(runtime.coordinator.snapshot().activeModels, 0);
    assert.equal(runtime.coordinator.snapshot().activeOperations, 0);
  } finally {
    held.release.resolve();
    await pending;
    await runtime.close();
  }
});
