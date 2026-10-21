// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { Check } from "typebox/value";
import { createRuntime, StandaloneError } from "../src/runtime.js";
import { successResult, errorResult } from "../src/server.js";
import { collateOutputSchema, compactOutputSchema } from "../../../src/core/output-schemas.js";
import { suppliedCollation, verifyCollateData } from "../../../test/helpers/collate-fixtures.js";
import type { Progress } from "../../../src/core/contracts.js";
import { fixture, fakeTransport, completion, json, logger } from "./helpers.js";

const usage = { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12, cost: 0.001 };

test("MCP registered collate uses frozen supplied evidence, real publication and compact settled protocol data (T07/T16/T17/T18)", async () => {
  const f = await fixture();
  let attempts = 0;
  const notices: string[] = [];
  const runtime = await createRuntime(f.config, {
    env: { FIXTURE_KEY: "fixture-secret" },
    logger: { warn() {}, error: (message) => notices.push(message) },
    fetch: fakeTransport((body) => {
      const request = JSON.stringify(body);
      assert(
        !request.includes("RAW_") &&
          !request.includes("SEARCH_SUMMARY") &&
          !request.includes("password"),
      );
      return ++attempts === 1
        ? json({ error: { code: 503 }, usage }, 503)
        : json(completion("Facts [S2] and [S4]. fixture-secret", { usage }));
    }),
  });
  try {
    const events: Progress[] = [];
    const final = await runtime.execute("intelli_collate", suppliedCollation(), {
      onProgress: (p) => events.push(p),
    });
    assert(final.data && Check(collateOutputSchema, final.data));
    assert.equal(final.data.text, final.text);
    assert.deepEqual(final.data.details, final.details);
    assert.equal(final.data.accounting.attempts, 2);
    assert.equal(final.data.counts.fetched, 0);
    assert.equal(final.data.counts.used, 2);
    assert(
      !JSON.stringify(final.data).includes("fixture-secret") &&
        !JSON.stringify(final.data).includes("RAW_"),
    );
    // Persisted reports are local artefacts, not the redacted protocol view.
    await verifyCollateData(f.dir, final.data);
    const protocol = successResult(final);
    assert(Check(compactOutputSchema, protocol.structuredContent));
    assert.equal((protocol.structuredContent as { text: string }).text, final.text);
    assert.equal(notices.length, 1);
    assert.deepEqual(
      events.map((e) => [e.sequence, e.event, e.pct]),
      [
        [1, "start", 0],
        [2, "retry", 0],
        [3, "end", 50],
        [4, "start", 50],
        [5, "end", 100],
      ],
    );
  } finally {
    await runtime.close();
    await f.cleanup();
  }
});

test("MCP collate retains retry stderr without a progress consumer (T20)", async () => {
  const f = await fixture();
  const notices: string[] = [];
  let calls = 0;
  const runtime = await createRuntime(f.config, {
    env: { FIXTURE_KEY: "fixture-secret" },
    logger: { warn() {}, error: (message) => notices.push(message) },
    fetch: fakeTransport(() =>
      ++calls === 1
        ? json({ error: { code: 503 } }, 503)
        : json(completion("Facts [S2] and [S4].")),
    ),
  });
  try {
    await runtime.execute("intelli_collate", suppliedCollation());
    assert.equal(notices.length, 1);
    assert.match(notices[0], /attempt 1, retrying/);
  } finally {
    await runtime.close();
    await f.cleanup();
  }
});

test("MCP collate damaged allocation history retains the useful source-ID answer without advertised files (T24)", async () => {
  const f = await fixture();
  const runtime = await createRuntime(f.config, {
    env: { FIXTURE_KEY: "fixture-secret" },
    logger,
    fetch: fakeTransport(() => json(completion("Facts [S2] and [S4].", { usage }))),
  });
  try {
    const first = await runtime.execute("intelli_collate", suppliedCollation());
    assert(first.data);
    await verifyCollateData(f.dir, first.data);
    await writeFile(join(f.dir, ".search/.intelli-v1/allocations.ndjson"), "corrupt history\n");
    const second = await runtime.execute("intelli_collate", suppliedCollation());
    assert(second.data && Check(collateOutputSchema, second.data));
    assert.equal(second.data.outcome, "completed");
    assert.equal(second.data.cache.status, "unavailable");
    assert(!("cachePath" in second.details));
    assert(second.data.sources.every((s) => !s.extractionPath && !s.fullPagePath));
    assert.match(second.text, /Persistence unavailable/);
    assert.match(
      await readFile(join(f.dir, ".search/.intelli-v1/allocations.ndjson"), "utf8"),
      /corrupt history/,
    );
  } finally {
    await runtime.close();
    await f.cleanup();
  }
});

test("MCP collate operational/zero-input failures expose compact partial data, not invented model work (T17/T18)", async () => {
  for (const zero of [true, false]) {
    const f = await fixture();
    let calls = 0;
    const runtime = await createRuntime(f.config, {
      env: { FIXTURE_KEY: "fixture-secret" },
      logger,
      fetch: fakeTransport(() => {
        calls++;
        return json({ error: { code: 401, message: "fixture-secret failure" }, usage }, 401);
      }),
    });
    try {
      await assert.rejects(
        runtime.execute(
          "intelli_collate",
          zero ? { query: "Empty", extractions: [] } : suppliedCollation(),
        ),
        (error: unknown) => {
          assert(error instanceof StandaloneError && error.data && error.usage);
          assert(Check(collateOutputSchema, error.data));
          assert.equal(error.data.outcome, "error");
          assert.equal(error.data.accounting.attempts, zero ? 0 : 1);
          assert.equal(error.data.accounting.parentDelivery, "available");
          assert(!JSON.stringify(error.data).includes("fixture-secret"));
          const protocol = errorResult("intelli_collate", error.code, error.message, error.data);
          assert(protocol.isError && Check(compactOutputSchema, protocol.structuredContent));
          return true;
        },
      );
      assert.equal(calls, zero ? 0 : 1);
    } finally {
      await runtime.close();
      await f.cleanup();
    }
  }
});

test("MCP collate caller cancellation drains the active scoped attempt before full partial error delivery (T05/T17)", async () => {
  const f = await fixture();
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const runtime = await createRuntime(f.config, {
    env: { FIXTURE_KEY: "fixture-secret" },
    logger,
    fetch: fakeTransport(async () => {
      entered();
      await held;
      return json(completion("Facts [S2] and [S4].", { usage }));
    }),
  });
  const controller = new AbortController();
  try {
    const verdict = runtime
      .execute("intelli_collate", suppliedCollation(), { signal: controller.signal })
      .catch((error: unknown) => error);
    await started;
    controller.abort();
    let done = false;
    void verdict.then(() => {
      done = true;
    });
    await Promise.resolve();
    assert.equal(done, false);
    release();
    const error = await verdict;
    assert(error instanceof StandaloneError && error.data);
    assert.equal(error.code, "CANCELLED");
    assert.equal(error.data.outcome, "aborted");
    assert.equal(error.data.accounting.parentDelivery, "unknown");
    assert.equal(error.data.accounting.attempts, 1);
    assert.equal(error.data.counts.used, 2, "supplied snapshot survives cancelled synthesis");
    assert(Check(collateOutputSchema, error.data));
  } finally {
    release();
    await runtime.close();
    await f.cleanup();
  }
});

test("MCP collate workspace/preflight failures remain ordinary errors without invented full data (T17)", async () => {
  const f = await fixture();
  await mkdir(join(f.dir, ".search"));
  const runtime = await createRuntime(f.config, { env: {}, logger });
  try {
    await assert.rejects(
      runtime.execute("intelli_collate", suppliedCollation()),
      (error: unknown) => {
        assert(error instanceof StandaloneError);
        assert.equal(error.data, undefined);
        assert.equal(error.execution, undefined);
        return true;
      },
    );
  } finally {
    await runtime.close();
    await f.cleanup();
  }
});
