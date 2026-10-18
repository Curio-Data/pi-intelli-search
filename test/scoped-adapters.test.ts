// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { it } from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  normalizeContext,
  type AssistantMessage,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import type { Clock, ModelCallScope, ModelUsage } from "../src/core/contracts.js";
import { createExecutionCoordinator } from "../src/core/execution-coordinator.js";
import { createAttemptLedger } from "../src/core/usage.js";
import { createScopedNativeModelClient } from "../src/native-model-client.js";
import { callLlm } from "../src/llm.js";
import { createOpenRouterClient } from "../packages/mcp/src/providers/openrouter.js";
import { completion, fakeTransport, fixture, json, logger } from "../packages/mcp/test/helpers.js";
import { sleep } from "../src/core/util.js";

// Adapter plumbing uses the wall clock. These are not virtual-clock deadline
// experiments or real-provider/floor/cancellation-latency acceptance evidence.
function setup(role: ModelCallScope["role"] = "search") {
  const clock: Clock = {
    monotonicMs: () => performance.now(),
    utcIso: () => new Date().toISOString(),
    schedule: (ms, callback) => {
      const timer = setTimeout(callback, ms);
      return () => clearTimeout(timer);
    },
    sleep,
  };
  const coordinator = createExecutionCoordinator({
    modelConcurrency: 2,
    criticalReserve: 1,
    fetchConcurrency: 1,
    minRequestIntervalMs: 0,
    clock,
    generation: 1,
  });
  const operation = coordinator.begin("adapter-operation");
  const ledger = createAttemptLedger();
  const services = { operation, ledger, clock, coordinator };
  const scope: ModelCallScope = { operation, ledger, role, callId: "adapter-call" };
  return { services, scope, coordinator, operation, ledger };
}
const config = { provider: "openrouter", model: "perplexity/sonar" };
const request = { model: config, systemPrompt: "system", userMessage: "user" };
const retry = { attempts: 2, baseDelayMs: 0, maxDelayMs: 0 };
const nativeUsage: ModelUsage = {
  input: 7,
  cacheRead: 2,
  cacheWrite: 1,
  output: 3,
  totalTokens: 13,
  cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
};
const wireUsage = {
  prompt_tokens: 10,
  completion_tokens: 3,
  total_tokens: 13,
  cost: 0.03,
  prompt_tokens_details: { cached_tokens: 2, cache_write_tokens: 1 },
};
function response(error?: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "answer" }],
    stopReason: error ? "error" : "stop",
    ...(error ? { errorMessage: error } : {}),
    timestamp: 0,
    usage: nativeUsage,
  } as AssistantMessage;
}
function context(
  transport: (options: SimpleStreamOptions) => Promise<AssistantMessage>,
): ExtensionContext {
  return {
    modelRegistry: {
      find: () => ({ provider: config.provider, id: config.model }),
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "synthetic" }),
      streamSimple: (_model: unknown, _context: unknown, options: SimpleStreamOptions) => ({
        result: () => transport(options),
      }),
    },
  } as unknown as ExtensionContext;
}

function sseResponse(usage?: unknown): Response {
  const chunks: unknown[] = [
    {
      id: "sdk-request",
      choices: [{ index: 0, delta: { role: "assistant", content: "answer" }, finish_reason: null }],
    },
    { id: "sdk-request", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ...(usage === undefined ? [] : [{ id: "sdk-request", choices: [], usage }]),
  ];
  return new Response(
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n",
    {
      headers: { "content-type": "text/event-stream" },
    },
  );
}

function sdkContext(withEvents = true): ExtensionContext {
  const model: Model<"openai-completions"> = {
    id: config.model,
    name: "SDK Fixture",
    api: "openai-completions",
    provider: config.provider,
    baseUrl: "http://127.0.0.1:9/api/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 100,
  };
  return {
    modelRegistry: {
      find: () => model,
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "synthetic" }),
      streamSimple: (
        _model: unknown,
        ctx: Parameters<typeof normalizeContext>[0],
        options: SimpleStreamOptions,
      ) =>
        streamSimple(model, normalizeContext(ctx), {
          ...options,
          ...(withEvents ? {} : { onProviderStreamEvent: undefined }),
        }),
    },
  } as unknown as ExtensionContext;
}

for (const usageState of ["http-error", "no-chunk", "empty-usage"] as const) {
  it(`T16 real SDK ${usageState} does not turn default zeros into observed usage`, async (t) => {
    const f = setup();
    let requests = 0;
    t.mock.method(globalThis, "fetch", async () => {
      requests++;
      return usageState === "http-error"
        ? json({ error: { message: "rate limited" } }, 429)
        : sseResponse(usageState === "empty-usage" ? {} : undefined);
    });
    try {
      const work = createScopedNativeModelClient(sdkContext(), f.services).complete({
        ...request,
        scope: f.scope,
      });
      if (usageState === "http-error") await assert.rejects(work, /LLM call failed/);
      else assert.equal((await work).text, "answer");
      assert.equal(requests, 1, "SDK retries stay disabled");
      assert.equal(f.ledger.records()[0].observation, undefined);
      assert.equal(f.ledger.summary().missingAttempts, 1);
      assert.equal(f.ledger.summary().estimatedCost.total, undefined);
      assert.equal(f.ledger.summary().reportedCost.total, undefined);
    } finally {
      await f.coordinator.close();
    }
  });
}

it("T16 real SDK wire absence stays unknown instead of inheriting cache and reasoning defaults", async (t) => {
  const f = setup();
  t.mock.method(globalThis, "fetch", async () =>
    sseResponse({ ...wireUsage, cost: undefined, prompt_tokens_details: { cached_tokens: 2 } }),
  );
  try {
    await createScopedNativeModelClient(sdkContext(), f.services).complete({
      ...request,
      scope: f.scope,
    });
    assert.deepEqual(f.ledger.records()[0].observation?.tokens, {
      inputTotal: 10,
      outputTotal: 3,
      cacheRead: 2,
      totalTokens: 13,
    });
    for (const key of ["cacheWrite", "reasoning", "inputUncached"] as const)
      assert(f.ledger.summary().missingTokenFields.includes(key));
    assert.equal(f.ledger.summary().costComplete, false);
  } finally {
    await f.coordinator.close();
  }
});

it("T16 explicit wire zeros and reported zero cost remain known through the real SDK", async (t) => {
  const f = setup();
  t.mock.method(globalThis, "fetch", async () =>
    sseResponse({
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      cost: 0,
      prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: 0 },
    }),
  );
  try {
    await createScopedNativeModelClient(sdkContext(), f.services).complete({
      ...request,
      scope: f.scope,
    });
    assert.deepEqual(f.ledger.records()[0].observation?.tokens, {
      inputTotal: 0,
      inputUncached: 0,
      outputTotal: 0,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      totalTokens: 0,
    });
    assert.equal(f.ledger.summary().observedAttempts, 1);
    assert.deepEqual(f.ledger.summary().reportedCost, { total: 0 });
    assert.deepEqual(f.ledger.summary().estimatedCost, {});
    assert.equal(f.ledger.summary().costComplete, true);
  } finally {
    await f.coordinator.close();
  }
});

it("T16 without provider events SDK usage stays conservative and partial", async (t) => {
  const f = setup();
  t.mock.method(globalThis, "fetch", async () =>
    sseResponse({ ...wireUsage, prompt_tokens_details: { cached_tokens: 2 } }),
  );
  try {
    await createScopedNativeModelClient(sdkContext(false), f.services).complete({
      ...request,
      scope: f.scope,
    });
    assert.deepEqual(f.ledger.records()[0].observation?.tokens, { outputTotal: 3, cacheRead: 2 });
    assert.equal(f.ledger.summary().costComplete, false);
    for (const key of [
      "inputTotal",
      "inputUncached",
      "cacheWrite",
      "reasoning",
      "totalTokens",
    ] as const)
      assert(f.ledger.summary().missingTokenFields.includes(key));
  } finally {
    await f.coordinator.close();
  }
});

it("T11/T16 native scoped client uses real callLlm/policy and records failed and successful SDK observations", async () => {
  const f = setup();
  let calls = 0;
  const client = createScopedNativeModelClient(
    context(async (options) => {
      calls++;
      assert.equal(options.maxRetries, 0);
      assert.equal(f.coordinator.snapshot().activeModels, 1);
      return response(calls === 1 ? "429 rate limited" : undefined);
    }),
    f.services,
  );
  try {
    assert.equal((await client.complete({ ...request, scope: f.scope, retry })).text, "answer");
    assert.equal(calls, 2);
    assert.deepEqual(
      f.ledger.records().map((r) => r.state),
      ["failed", "succeeded"],
    );
    assert.equal(f.ledger.summary().tokens.inputTotal, 20);
    assert.equal(f.ledger.summary().tokens.inputUncached, 14);
    assert.equal(f.ledger.summary().estimatedCost.total, 0.06);
    assert.equal(f.ledger.summary().reportedCost.total, undefined);
    assert.equal(f.ledger.summary().costComplete, false);
  } finally {
    await f.coordinator.close();
  }
});

it("T11 native successful onUsage remains compatible but is not the accounting source", async () => {
  const f = setup();
  let calls = 0;
  const seen: ModelUsage[] = [];
  try {
    await callLlm(
      context(async () => response(++calls === 1 ? "503" : undefined)),
      config,
      "system",
      "user",
      {
        policyHooks: { ...f.services, scope: f.scope, logger, random: () => 0 },
        retry,
        onUsage: (usage) => {
          seen.push(usage);
        },
      },
    );
    assert.equal(seen.length, 1);
    assert.equal(f.ledger.records().length, 2);
  } finally {
    await f.coordinator.close();
  }
});

it("native scoped transport is captured immutably and citations use provider chunks without calling fetch", async (t) => {
  const f = setup();
  let network = 0;
  t.mock.method(globalThis, "fetch", async () => {
    network++;
    throw new Error("forbidden pipeline network");
  });
  const options = {
    registryStreamSimple: async (
      _registry: unknown,
      _model: unknown,
      _context: unknown,
      opts?: SimpleStreamOptions,
    ) => {
      await opts?.onProviderStreamEvent?.(
        {
          choices: [
            {
              delta: {
                annotations: [
                  { type: "url_citation", url_citation: { url: "https://example.com/doc" } },
                ],
              },
            },
          ],
        },
        _model as Parameters<NonNullable<SimpleStreamOptions["onProviderStreamEvent"]>>[1],
      );
      return response();
    },
  };
  const client = createScopedNativeModelClient(
    context(async () => {
      throw new Error("not the injected transport");
    }),
    f.services,
    options,
  );
  options.registryStreamSimple = async () => {
    throw new Error("mutated injection");
  };
  try {
    const result = await client.complete({ ...request, scope: f.scope, collectCitations: true });
    assert.deepEqual(result.citations, [{ url: "https://example.com/doc" }]);
    assert.equal(network, 0);
    assert.equal(f.ledger.records().length, 1);
  } finally {
    await f.coordinator.close();
  }
});

it("T10 scoped adapter rejects another lease or ledger before transport/auth", async () => {
  const f = setup();
  const other = setup();
  let calls = 0;
  const client = createScopedNativeModelClient(
    context(async () => {
      calls++;
      return response();
    }),
    f.services,
  );
  try {
    for (const scope of [
      { ...f.scope, ledger: other.ledger },
      { ...f.scope, operation: other.operation },
    ])
      await assert.rejects(client.complete({ ...request, scope }), /services lease and ledger/);
    assert.equal(calls, 0);
    assert.equal(f.ledger.records().length, 0);
  } finally {
    await f.coordinator.close();
    await other.coordinator.close();
  }
});

it("T16 mocked HTTP through the real SDK and MCP parser preserves explicit cache fields", async (t) => {
  const disk = await fixture();
  const mcp = setup();
  const native = setup();
  try {
    const client = createOpenRouterClient(disk.config, {
      services: mcp.services,
      random: () => 0,
      env: { FIXTURE_KEY: "synthetic" },
      logger,
      fetch: fakeTransport(() =>
        json(completion("answer", { id: "request-id", usage: wireUsage })),
      ),
    });
    assert.deepEqual(await client.preflight([{ role: "search", config }]), []);
    assert.equal(mcp.ledger.records().length, 0, "catalogue is not model inference");
    await client.complete({ ...request, scope: mcp.scope });
    t.mock.method(globalThis, "fetch", async () => sseResponse({ ...wireUsage, cost: undefined }));
    await createScopedNativeModelClient(sdkContext(), native.services).complete({
      ...request,
      scope: native.scope,
    });
    assert.deepEqual(mcp.ledger.summary().tokens, native.ledger.summary().tokens);
    assert.equal(mcp.ledger.summary().costComplete, true);
    assert.equal(native.ledger.summary().costComplete, false);
    assert.equal(mcp.ledger.records()[0].observation?.providerRequestId, "request-id");
    assert.deepEqual(mcp.ledger.summary().reportedCost, { total: 0.03 });
    assert.deepEqual(mcp.ledger.summary().estimatedCost, {});
  } finally {
    await mcp.coordinator.close();
    await native.coordinator.close();
    await disk.cleanup();
  }
});

for (const errorPosition of ["root", "choice"] as const) {
  it(`T16 MCP preserves usage accompanying a ${errorPosition} response error before retry`, async () => {
    const disk = await fixture();
    const f = setup();
    let calls = 0;
    try {
      const client = createOpenRouterClient(disk.config, {
        services: f.services,
        random: () => 0,
        env: { FIXTURE_KEY: "synthetic" },
        logger,
        fetch: fakeTransport(() => {
          calls++;
          if (calls > 1) return json(completion("answer", { usage: wireUsage }));
          const error = { code: 503 };
          return json({
            usage: wireUsage,
            ...(errorPosition === "root" ? { error } : { choices: [{ error }] }),
          });
        }),
      });
      await client.preflight([{ role: "search", config }]);
      assert.equal((await client.complete({ ...request, scope: f.scope })).text, "answer");
      assert.equal(calls, 2);
      assert.deepEqual(
        f.ledger.records().map((r) => r.state),
        ["failed", "succeeded"],
      );
      assert.equal(f.ledger.summary().reportedCost.total, 0.06);
    } finally {
      await f.coordinator.close();
      await disk.cleanup();
    }
  });
}

it("T16 missing MCP cache-write usage stays unknown through the real adapter", async () => {
  const disk = await fixture();
  const f = setup();
  try {
    const client = createOpenRouterClient(disk.config, {
      services: f.services,
      random: () => 0,
      env: { FIXTURE_KEY: "synthetic" },
      logger,
      fetch: fakeTransport(() =>
        json(
          completion("answer", {
            usage: { ...wireUsage, prompt_tokens_details: { cached_tokens: 2 } },
          }),
        ),
      ),
    });
    await client.preflight([{ role: "search", config }]);
    await client.complete({ ...request, scope: f.scope });
    assert.equal(f.ledger.summary().tokens.inputUncached, undefined);
    assert.equal(f.ledger.summary().tokens.cacheWrite, undefined);
    assert(f.ledger.summary().missingTokenFields.includes("inputUncached"));
    assert(f.ledger.summary().missingTokenFields.includes("cacheWrite"));
  } finally {
    await f.coordinator.close();
    await disk.cleanup();
  }
});

it("T11 MCP preserves cutoff codes rather than wrapping them as provider failures", async () => {
  const disk = await fixture();
  const f = setup("extract");
  let calls = 0;
  try {
    const client = createOpenRouterClient(disk.config, {
      services: f.services,
      random: () => 0,
      env: { FIXTURE_KEY: "synthetic" },
      logger,
      fetch: fakeTransport(() => {
        calls++;
        return json(completion());
      }),
    });
    await client.preflight([{ role: "search", config }]);
    f.operation.cutoffPages();
    await assert.rejects(client.complete({ ...request, scope: f.scope }), { code: "PAGE_CUTOFF" });
    assert.equal(calls, 0);
    assert.equal(f.ledger.records().length, 0);
  } finally {
    await f.coordinator.close();
    await disk.cleanup();
  }
});

for (const adapter of ["native", "mcp"] as const) {
  it(`T11 ${adapter} scoped transport cancellation drains before the policy returns`, async () => {
    const disk = await fixture();
    const f = setup();
    let entered!: () => void;
    const dispatched = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let drained = false;
    try {
      const wait = async (signal?: AbortSignal) => {
        entered();
        try {
          await sleep(10000, signal);
        } finally {
          drained = true;
        }
      };
      const client =
        adapter === "native"
          ? createScopedNativeModelClient(
              context(async (options) => {
                await wait(options.signal);
                return response();
              }),
              f.services,
            )
          : createOpenRouterClient(disk.config, {
              services: f.services,
              random: () => 0,
              env: { FIXTURE_KEY: "synthetic" },
              logger,
              fetch: fakeTransport(async (_payload, init) => {
                await wait(init.signal ?? undefined);
                return json(completion());
              }),
            });
      await client.preflight([{ role: "search", config }]);
      const failure = assert.rejects(client.complete({ ...request, scope: f.scope }), {
        name: "AbortError",
      });
      await dispatched;
      f.operation.abort();
      await failure;
      assert.equal(drained, true);
      assert.equal(f.ledger.records()[0].state, "aborted");
      assert.equal(f.coordinator.snapshot().activeModels, 0);
    } finally {
      await f.coordinator.close();
      await disk.cleanup();
    }
  });
}
