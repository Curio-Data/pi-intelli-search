// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import test from "node:test";
import { createRuntime, StandaloneError } from "../src/runtime.js";
import { fixture, fakeTransport, logger } from "./helpers.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("MCP abort awaits the first provider-body cancellation rather than a second resolved cancel (T04/T06)", async () => {
  const f = await fixture();
  const entered = deferred();
  const cancelling = deferred();
  const release = deferred();
  const controller = new AbortController();
  const runtime = await createRuntime(f.config, {
    env: { FIXTURE_KEY: "synthetic" },
    logger,
    fetch: fakeTransport(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(stream) {
              stream.enqueue(Buffer.from('{"partial":'));
              entered.resolve();
            },
            async cancel() {
              cancelling.resolve();
              await release.promise;
            },
          }),
          { status: 200 },
        ),
    ),
  });
  let settled = false;
  const pending = runtime
    .execute("intelli_search", { query: "held cancellation" }, { signal: controller.signal })
    .catch((error: unknown) => {
      settled = true;
      return error;
    });
  try {
    await entered.promise;
    controller.abort();
    await cancelling.promise;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false, "the independent cancellation is still owned");
    release.resolve();
    const error = await pending;
    assert(error instanceof StandaloneError);
    assert.equal(error.code, "CANCELLED");
    assert.equal(error.execution!.accounting.attempts, 1);
    assert.equal(error.execution!.accounting.parentDelivery, "unknown");
  } finally {
    release.resolve();
    controller.abort();
    await pending;
    await runtime.close();
    await f.cleanup();
  }
});
