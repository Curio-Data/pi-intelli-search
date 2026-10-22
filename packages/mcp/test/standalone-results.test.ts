// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { test } from "node:test";
import { Check } from "typebox/value";
import { createRuntime, StandaloneError } from "../src/runtime.js";
import { successResult, errorResult } from "../src/server.js";
import {
  standaloneOutputSchemas,
  collateOutputSchema,
  compactOutputSchema,
} from "../../../src/core/output-schemas.js";
import type { Progress, ResearchExecutionSettings } from "../../../src/core/contracts.js";
import { fixture, fakeTransport, completion, json, logger } from "./helpers.js";

const page = { url: "fixture-secret", title: "Title", content: "RAW_SENTINEL", query: "Q" };

test("MCP omitted/partial direct execution blocks reach the standalone capacity consumer (T03/T12/T17/T18)", async () => {
  for (const execution of [undefined, { modelConcurrency: 3 }]) {
    const f = await fixture();
    const config = {
      ...f.config,
      settings: {
        ...f.config.settings,
        execution: execution as ResearchExecutionSettings,
        extractionConcurrency: 9,
      },
    };
    const runtime = await createRuntime(config, {
      env: { FIXTURE_KEY: "fixture-secret" },
      logger,
      fetch: fakeTransport(() =>
        json(completion("Answer fixture-secret [Docs](https://docs.example/page)")),
      ),
    });
    // Mutation after capture cannot alter capacity or trigger a conflicting cap.
    if (execution) execution.modelConcurrency = 64;
    try {
      for (const name of ["intelli_search", "intelli_extract"] as const) {
        const events: Progress[] = [];
        const result = await runtime.execute(
          name,
          name === "intelli_search" ? { query: "Q" } : page,
          { onProgress: (p) => events.push(p as Progress) },
        );
        assert(result.data);
        assert(Check(standaloneOutputSchemas[name], result.data));
        assert.equal(result.data.counts.effectivePageConcurrency, execution ? 2 : 4);
        assert.equal(result.data.text, result.text);
        assert.deepEqual(result.data.details, result.details);
        assert.equal(result.data.counts.fetched, 0);
        assert.equal(result.data.accounting.attempts, 1);
        assert.deepEqual(result.data.attempts, result.execution.attempts);
        assert.deepEqual(result.usage, result.execution.usage);
        assert(!JSON.stringify(result).includes("RAW_SENTINEL"));
        assert(!JSON.stringify(result.data).includes("fixture-secret"));
        assert.deepEqual(
          events.map((p) => [p.sequence, p.event, p.pct]),
          [
            [1, "start", 0],
            [2, "end", 100],
          ],
        );
        assert(events.every((p) => p.operationId === result.data!.operationId));
        const protocol = successResult(result);
        assert(Check(compactOutputSchema, protocol.structuredContent));
        assert.equal((protocol.structuredContent as { text: string }).text, result.text);
        assert(!("attempts" in protocol.structuredContent!));
      }
    } finally {
      await runtime.close();
      await f.cleanup();
    }
  }
});

test("MCP redacts authored text without changing generated schema literals (T17/T18)", async () => {
  for (const secret of ["completed", "search", "provider-response", "candidate"]) {
    const f = await fixture();
    const runtime = await createRuntime(f.config, {
      env: { FIXTURE_KEY: secret },
      logger,
      fetch: fakeTransport(() =>
        json(
          completion(`Answer ${secret} [Docs](https://docs.example/${secret})`, {
            usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5, cost: 0.01 },
          }),
        ),
      ),
    });
    try {
      const result = await runtime.execute("intelli_search", { query: "Q" });
      assert(result.data);
      assert(Check(standaloneOutputSchemas.intelli_search, result.data));
      assert.equal(result.data.outcome, "completed");
      assert.equal(result.data.sources[0].state, "candidate");
      assert.equal(result.data.attempts[0].role, "search");
      assert.equal(result.data.attempts[0].observation?.source, "provider-response");
      assert(result.data.sources[0].url.includes("[REDACTED]"));
      assert(!result.text.includes(`Answer ${secret}`));
      assert(Check(compactOutputSchema, successResult(result).structuredContent));
    } finally {
      await runtime.close();
      await f.cleanup();
    }
  }
});

test("actual manual-workflow adapter envelopes retain large Unicode answers and bounded metadata (T17/T18)", async () => {
  const long = '完整事实\\"\\n'.repeat(10_000);
  for (const name of ["intelli_search", "intelli_extract", "intelli_collate"] as const) {
    for (const failed of [false, true]) {
      const f = await fixture();
      const runtime = await createRuntime(f.config, {
        env: { FIXTURE_KEY: "fixture-secret" },
        logger,
        fetch: fakeTransport(() =>
          failed
            ? json({ error: { code: 401, message: long } }, 401)
            : json(
                completion(
                  long +
                    (name === "intelli_collate"
                      ? " [S1]."
                      : "\nRead a report with `read .search/report.md`"),
                  {
                    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5, cost: 0.01 },
                  },
                ),
              ),
        ),
      });
      try {
        const result = await runtime
          .execute(
            name,
            name === "intelli_search"
              ? { query: "Q" }
              : name === "intelli_extract"
                ? page
                : {
                    query: "Q",
                    extractions: [
                      {
                        url: "supplied",
                        title: "Title",
                        extraction: "Facts",
                        status: "success",
                        sourceType: "official",
                      },
                    ],
                  },
          )
          .catch((error: unknown) => error);
        const data =
          result instanceof StandaloneError
            ? result.data
            : (result as { data: import("../../../src/core/contracts.js").FullData }).data;
        assert(data);
        assert(
          Check(
            name === "intelli_collate" ? collateOutputSchema : standaloneOutputSchemas[name],
            data,
          ),
        );
        const protocol =
          result instanceof StandaloneError
            ? errorResult(name, result.code, result.message, data)
            : successResult(result as Awaited<ReturnType<typeof runtime.execute>>);
        assert(Check(compactOutputSchema, protocol.structuredContent));
        const structured = protocol.structuredContent as {
          outcome: string;
          text: string;
          details: unknown;
        };
        assert.equal(structured.text, (protocol.content![0] as { text: string }).text);
        assert.deepEqual(structured.details, data.details);
        if (!failed)
          assert(
            structured.text.includes(long),
            `${name}: the answer is not truncated to fit metadata`,
          );
        else
          assert(
            structured.text.endsWith(data.text),
            "the adapter's complete safe error is retained",
          );
        const legacy = {
          outcome: structured.outcome,
          text: structured.text,
          details: structured.details,
        };
        const overhead =
          Buffer.byteLength(JSON.stringify(structured)) - Buffer.byteLength(JSON.stringify(legacy));
        assert(overhead <= 8192, `${name} ${failed}: ${overhead}`);
        assert(!JSON.stringify(structured).includes("RAW_SENTINEL"));
        if (!failed && name !== "intelli_collate") {
          assert(!data.text.includes("Read a report with `read"));
          assert.match(data.text, /host's file-reading capability/);
        }
      } finally {
        await runtime.close();
        await f.cleanup();
      }
    }
  }
});

test("MCP extraction keeps generated correlation and clock fields when a literal key matches them", async () => {
  for (const secret of ["S1", "2026", "extract", "sdk-normalized", "unknown"]) {
    const f = await fixture();
    const runtime = await createRuntime(f.config, {
      env: { FIXTURE_KEY: secret },
      logger,
      fetch: fakeTransport(() => json(completion(`Facts ${secret}`))),
    });
    try {
      const result = await runtime.execute("intelli_extract", { ...page, url: secret });
      assert(result.data && Check(standaloneOutputSchemas.intelli_extract, result.data));
      assert.equal(result.data.sources[0].id, "S1");
      assert.equal(result.data.attempts[0].pageId, "S1");
      assert.equal(
        new Date(result.data.timing.startedUtc).toISOString(),
        result.data.timing.startedUtc,
      );
      assert.equal(result.data.sources[0].url, "[REDACTED]");
      assert(!result.text.includes(`Facts ${secret}`));
    } finally {
      await runtime.close();
      await f.cleanup();
    }
  }
});

test("MCP standalone retries retain stderr notices without a progress consumer (T20)", async () => {
  for (const name of ["intelli_search", "intelli_extract"] as const) {
    const f = await fixture();
    const notices: string[] = [];
    let calls = 0;
    const runtime = await createRuntime(f.config, {
      env: { FIXTURE_KEY: "fixture-secret" },
      logger: { warn() {}, error: (message) => notices.push(message) },
      fetch: fakeTransport(() =>
        ++calls === 1 ? json({ error: { code: 503 } }, 503) : json(completion("Answer")),
      ),
    });
    try {
      await runtime.execute(name, name === "intelli_search" ? { query: "Q" } : page);
      assert.equal(calls, 2);
      assert.equal(notices.length, 1);
      assert.match(notices[0], /attempt 1, retrying/);
    } finally {
      await runtime.close();
      await f.cleanup();
    }
  }
});

test("MCP retry/error projection carries final partial usage safely, with honest progress (T16/T17/T18/T20)", async () => {
  const f = await fixture();
  let attempts = 0;
  const events: Progress[] = [];
  const runtime = await createRuntime(f.config, {
    env: { FIXTURE_KEY: "fixture-secret" },
    logger,
    fetch: fakeTransport(() => {
      attempts++;
      return json(
        {
          error: { code: 503, message: "failure fixture-secret" },
          usage: {
            prompt_tokens: 5,
            completion_tokens: 2,
            total_tokens: 7,
            cost: 0.001,
          },
        },
        503,
      );
    }),
  });
  try {
    await assert.rejects(
      runtime.execute("intelli_extract", page, { onProgress: (p) => events.push(p as Progress) }),
      (error: unknown) => {
        assert(error instanceof StandaloneError && error.data && error.usage);
        assert(Check(standaloneOutputSchemas.intelli_extract, error.data));
        assert.equal(error.data.outcome, "error");
        assert.equal(error.data.accounting.attempts, 2);
        assert.equal(error.data.accounting.parentDelivery, "available");
        assert.equal(error.data.counts.failed, 1);
        assert.equal(error.data.counts.fetched, 0);
        assert.deepEqual(error.data.accounting, error.execution!.accounting);
        assert.deepEqual(error.usage, error.execution!.usage);
        assert(!JSON.stringify(error.data).includes("fixture-secret"));
        const protocol = errorResult("intelli_extract", error.code, error.message, error.data);
        assert(protocol.isError);
        assert(Check(compactOutputSchema, protocol.structuredContent));
        assert.equal(
          (protocol.structuredContent as { text: string }).text,
          (protocol.content![0] as { text: string }).text,
        );
        return true;
      },
    );
    assert.equal(attempts, 2);
    assert.deepEqual(
      events.map((p) => [p.sequence, p.event, p.state, p.pct]),
      [
        [1, "start", "running", 0],
        [2, "retry", "running", 0],
        [3, "end", "failed", 0],
      ],
    );
  } finally {
    await runtime.close();
    await f.cleanup();
  }
});

test("MCP abort-shaped transport failure without caller cancellation retains provider-error accounting (T05/T17)", async () => {
  const f = await fixture();
  const runtime = await createRuntime(f.config, {
    env: { FIXTURE_KEY: "fixture-secret" },
    logger,
    fetch: fakeTransport(() => {
      throw new DOMException("transport interrupted", "AbortError");
    }),
  });
  try {
    await assert.rejects(runtime.execute("intelli_extract", page), (error: unknown) => {
      assert(error instanceof StandaloneError && error.data);
      assert.equal(error.code, "PROVIDER");
      assert.equal(error.data.outcome, "error");
      assert.equal(error.data.text, error.message);
      assert.equal(error.execution!.accounting.parentDelivery, "available");
      assert.equal(error.data.accounting.parentDelivery, "available");
      return true;
    });
  } finally {
    await runtime.close();
    await f.cleanup();
  }
});

test("MCP cancellation projects unknown delivery only after active attempt settlement (T05/T17/T20)", async () => {
  const f = await fixture();
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const events: Progress[] = [];
  const runtime = await createRuntime(f.config, {
    env: { FIXTURE_KEY: "fixture-secret" },
    logger,
    fetch: fakeTransport(async () => {
      entered();
      await held;
      return json(completion("late"));
    }),
  });
  const controller = new AbortController();
  try {
    const pending = runtime.execute("intelli_extract", page, {
      signal: controller.signal,
      onProgress: (p) => events.push(p as Progress),
    });
    const verdict = pending.catch((error: unknown) => error);
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
    assert.equal(error.data.text, error.message);
    assert.equal(error.data.outcome, "aborted");
    assert.equal(error.data.counts.cancelled, 1);
    assert.equal(error.data.accounting.parentDelivery, "unknown");
    assert.equal(error.data.accounting.attempts, 1);
    assert(Check(standaloneOutputSchemas.intelli_extract, error.data));
    assert.deepEqual(
      events.map((p) => [p.event, p.state, p.pct]),
      [
        ["start", "running", 0],
        ["end", "cancelled", 0],
      ],
    );
  } finally {
    release();
    await runtime.close();
    await f.cleanup();
  }
});
