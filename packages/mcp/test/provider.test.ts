// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { test } from "node:test";
import assert from "node:assert/strict";
import { createOpenRouterClient } from "../src/providers/openrouter.js";
import { buildSearchPayloadPatch } from "../../../src/core/messages.js";
import { parseConfig } from "../src/config.js";
import {
  catalogue,
  completion,
  document,
  fakeTransport,
  fixture,
  json,
  logger,
} from "./helpers.js";
import type { ModelRequest } from "../../../src/core/contracts.js";
const request = (config: Awaited<ReturnType<typeof fixture>>["config"]): ModelRequest => ({
  model: config.settings.searchModel,
  systemPrompt: "SYSTEM SENTINEL",
  userMessage: "USER SENTINEL",
  maxTokens: 222,
  collectCitations: true,
});

test("wire construction preserves system prompt, selected model, reasoning, tool payload and citations", async () => {
  const f = await fixture();
  const sent: Record<string, unknown>[] = [];
  try {
    const client = createOpenRouterClient(f.config, {
      env: { FIXTURE_KEY: "fixture-secret" },
      logger,
      fetch: fakeTransport((body, init) => {
        sent.push(body);
        assert.equal(new Headers(init.headers).get("authorization"), "Bearer fixture-secret");
        assert.equal(init.redirect, "error");
        return json({
          choices: [
            {
              message: {
                content: "answer",
                annotations: [
                  {
                    type: "url_citation",
                    url_citation: { url: "https://docs.example/a", title: "Docs" },
                  },
                  { type: "url_citation", url_citation: { url: "file:///invalid" } },
                ],
              },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 4,
            total_tokens: 16,
            cost: 0.002,
            completion_tokens_details: { reasoning_tokens: 2 },
          },
        });
      }),
    });
    assert.deepEqual(
      await client.preflight([{ role: "search", config: f.config.settings.searchModel }]),
      [],
    );
    const patch = buildSearchPayloadPatch(
      {
        ...f.config.settings,
        searchWebSearch: {
          enabled: true,
          engine: "exa",
          maxResults: 3,
          allowedDomains: ["docs.example"],
        },
      },
      "openrouter",
      ["extra.example"],
    );
    const result = await client.complete({
      ...request(f.config),
      reasoning: "minimal",
      payloadPatch: patch,
    });
    assert.deepEqual(sent[0], {
      model: "perplexity/sonar",
      stream: false,
      messages: [
        { role: "system", content: "SYSTEM SENTINEL" },
        { role: "user", content: "USER SENTINEL" },
      ],
      reasoning: { effort: "minimal", exclude: true },
      max_completion_tokens: 222,
      tools: [
        {
          type: "openrouter:web_search",
          parameters: {
            engine: "exa",
            max_results: 3,
            allowed_domains: ["docs.example", "extra.example"],
          },
        },
      ],
    });
    assert.deepEqual(result.citations, [{ url: "https://docs.example/a", title: "Docs" }]);
    assert.deepEqual(result.usage, {
      input: 12,
      output: 4,
      totalTokens: 16,
      totalCost: 0.002,
      reasoning: 2,
    });
    await assert.rejects(
      client.complete({
        ...request(f.config),
        model: { provider: "other", model: "perplexity/sonar" },
      }),
      /not explicitly/,
    );
    await assert.rejects(
      client.complete({
        ...request(f.config),
        payloadPatch: (payload) => ({ ...payload, model: "other/model" }),
      }),
      /routing/,
    );
    const existing = { tools: [{ type: "existing" }] };
    assert.equal(patch?.(existing), existing);
  } finally {
    await f.cleanup();
  }
});

test("omits reasoning for models that do not advertise the capability", async () => {
  const f = await fixture();
  try {
    const cat = catalogue();
    const data = cat.data.map(({ reasoning: _reasoning, ...entry }) => ({
      ...entry,
      supported_parameters: [],
    }));
    const client = createOpenRouterClient(f.config, {
      logger,
      env: { FIXTURE_KEY: "fixture-secret" },
      fetch: async (url, init) => {
        if (String(url).endsWith("/models")) return json({ data });
        const payload = JSON.parse(String(init?.body));
        assert.equal(Object.hasOwn(payload, "reasoning"), false);
        return json(completion());
      },
    });
    await client.preflight([{ role: "search", config: f.config.settings.searchModel }]);
    await client.complete(request(f.config));
  } finally {
    await f.cleanup();
  }
});

test("preflight rejects unavailable models, text/tool/reasoning incompatibility before inference", async () => {
  const f = await fixture();
  try {
    for (const mode of ["missing", "text", "tools", "reasoning"] as const) {
      const doc = document();
      const cfg = await parseConfig(
        {
          ...doc,
          tuning: { ...doc.tuning, searchWebSearch: { enabled: true, reasoning: "minimal" } },
        },
        f.dir,
      );
      const cat = catalogue();
      if (mode === "missing") cat.data = [];
      if (mode === "text") cat.data[0].architecture.input_modalities = ["image"];
      if (mode === "tools") cat.data[0].supported_parameters = [];
      if (mode === "reasoning") cat.data[0].reasoning.supported_efforts = ["high"];
      const client = createOpenRouterClient(cfg, {
        logger,
        env: { FIXTURE_KEY: "fixture-secret" },
        fetch: async (url) => {
          assert(String(url).endsWith("/models"));
          return json(cat);
        },
      });
      const call = client.preflight([{ role: "search", config: cfg.settings.searchModel }]);
      if (mode === "missing") assert.equal((await call).length, 1);
      else await assert.rejects(call, /advertise|reasoning/);
    }
  } finally {
    await f.cleanup();
  }
});

test("HTTP and successful-body transient errors retry once with fresh citations and Retry-After", async () => {
  const f = await fixture();
  try {
    for (const status of [200, 429, 503]) {
      let attempts = 0;
      const delays: number[] = [];
      const client = createOpenRouterClient(f.config, {
        logger,
        env: { FIXTURE_KEY: "fixture-secret" },
        policyTesting: {
          sleep: async (ms) => {
            delays.push(ms);
          },
          random: () => 0,
        },
        fetch: fakeTransport(() => {
          attempts++;
          return attempts === 1
            ? json(
                {
                  error: {
                    code: 429,
                    message: "fixture-secret",
                    metadata: { raw: "secret-header" },
                  },
                  choices: [
                    {
                      message: {
                        content: "bad",
                        annotations: [
                          { type: "url_citation", url_citation: { url: "https://failed.example" } },
                        ],
                      },
                    },
                  ],
                },
                status,
                { "retry-after": "2" },
              )
            : json(completion("success"));
        }),
      });
      await client.preflight([{ role: "search", config: f.config.settings.searchModel }]);
      const result = await client.complete({
        ...request(f.config),
        retry: { attempts: 2, baseDelayMs: 0, maxDelayMs: 3000 },
      });
      assert.equal(attempts, 2);
      assert.deepEqual(delays, [2000]);
      assert.deepEqual(result.citations, []);
    }
  } finally {
    await f.cleanup();
  }
});

test("choice-level errors preserve transient and permanent classifications without raw messages", async () => {
  const f = await fixture();
  try {
    for (const [error, transient] of [
      [
        { code: 502, message: "fixture-secret", metadata: { error_type: "provider_unavailable" } },
        true,
      ],
      [{ code: 400, metadata: { error_type: "rate_limit_exceeded", raw: "fixture-secret" } }, true],
      [{ code: 503, metadata: { error_type: "authentication" } }, false],
      [{ code: 403, message: "timeout 500 fixture-secret" }, false],
    ] as const) {
      let calls = 0;
      const client = createOpenRouterClient(f.config, {
        logger,
        env: { FIXTURE_KEY: "fixture-secret" },
        fetch: fakeTransport(() => {
          calls++;
          return calls === 1
            ? json({
                choices: [
                  {
                    message: {
                      content: "partial",
                      annotations: [
                        { type: "url_citation", url_citation: { url: "https://failed.example" } },
                      ],
                    },
                    finish_reason: "error",
                    error,
                  },
                ],
              })
            : json(completion("recovered"));
        }),
      });
      await client.preflight([{ role: "search", config: f.config.settings.searchModel }]);
      if (transient) {
        const result = await client.complete(request(f.config));
        assert.deepEqual(result.citations, []);
        assert.equal(calls, 2);
      } else {
        await assert.rejects(
          client.complete(request(f.config)),
          (error: Error) => !error.message.includes("fixture-secret"),
        );
        assert.equal(calls, 1);
      }
    }
  } finally {
    await f.cleanup();
  }
});

test("402 Retry-After is honoured only when a valid delay header exists", async () => {
  const f = await fixture();
  try {
    for (const retryAfter of ["2", "invalid", undefined]) {
      let calls = 0;
      const delays: number[] = [];
      const client = createOpenRouterClient(f.config, {
        logger,
        env: { FIXTURE_KEY: "fixture-secret" },
        policyTesting: {
          sleep: async (ms) => {
            delays.push(ms);
          },
        },
        fetch: fakeTransport(() => {
          calls++;
          return calls === 1
            ? json(
                { error: { code: 402 } },
                402,
                retryAfter ? { "retry-after": retryAfter } : undefined,
              )
            : json(completion());
        }),
      });
      await client.preflight([{ role: "search", config: f.config.settings.searchModel }]);
      const call = client.complete({
        ...request(f.config),
        retry: { attempts: 2, baseDelayMs: 0, maxDelayMs: 3000 },
      });
      if (retryAfter === "2") {
        await call;
        assert.deepEqual(delays, [2000]);
        assert.equal(calls, 2);
      } else {
        await assert.rejects(call, /402/);
        assert.deepEqual(delays, []);
        assert.equal(calls, 1);
      }
    }
  } finally {
    await f.cleanup();
  }
});

test("permanent and malformed errors are safe and do not retry", async () => {
  const f = await fixture();
  try {
    for (const response of [
      () => json({ error: { code: 401, message: "fixture-secret" } }, 401),
      () => json({ error: { code: 402, message: "fixture-secret" } }),
      () => new Response("fixture-secret"),
      () => json({}),
      () => json({ choices: [{ finish_reason: "error", message: { content: "partial" } }] }),
      () => json({ choices: [{ finish_reason: "length", message: { content: "" } }] }),
    ]) {
      let calls = 0;
      const client = createOpenRouterClient(f.config, {
        env: { FIXTURE_KEY: "fixture-secret" },
        logger,
        fetch: fakeTransport(() => {
          calls++;
          return response();
        }),
      });
      await client.preflight([{ role: "search", config: f.config.settings.searchModel }]);
      await assert.rejects(
        client.complete(request(f.config)),
        (error: Error) => !error.message.includes("fixture-secret"),
      );
      assert.equal(calls, 1);
    }
  } finally {
    await f.cleanup();
  }
});

test("stalled bodies time out per attempt, user cancellation never retries", async () => {
  const f = await fixture();
  try {
    for (const cancel of [false, true]) {
      let attempts = 0;
      let cancellations = 0;
      const ac = new AbortController();
      const client = createOpenRouterClient(f.config, {
        env: { FIXTURE_KEY: "fixture-secret" },
        logger,
        fetch: fakeTransport(() => {
          attempts++;
          return new Response(
            new ReadableStream({
              cancel() {
                cancellations++;
              },
            }),
          );
        }),
      });
      await client.preflight([{ role: "search", config: f.config.settings.searchModel }]);
      const call = client.complete({
        ...request(f.config),
        timeoutMs: cancel ? 1000 : 10,
        signal: ac.signal,
      });
      const timer = cancel ? setTimeout(() => ac.abort(), 10) : undefined;
      try {
        await assert.rejects(call, cancel ? /abort/i : /timed out/);
      } finally {
        clearTimeout(timer);
      }
      assert.equal(attempts, cancel ? 1 : 2);
      assert.equal(cancellations, attempts);
    }
  } finally {
    await f.cleanup();
  }
});

test("catalogue requests are cancellable before any paid work", async () => {
  const f = await fixture();
  const ac = new AbortController();
  let calls = 0;
  try {
    const client = createOpenRouterClient(f.config, {
      logger,
      signal: ac.signal,
      env: { FIXTURE_KEY: "fixture-secret" },
      fetch: async () => {
        calls++;
        return new Response(new ReadableStream());
      },
    });
    const call = client.preflight([{ role: "search", config: f.config.settings.searchModel }]);
    setTimeout(() => ac.abort(), 10);
    await assert.rejects(call, /abort/i);
    assert.equal(calls, 1);
  } finally {
    await f.cleanup();
  }
});
