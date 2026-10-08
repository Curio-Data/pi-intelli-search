// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, Context, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { createNativeModelClient, describeModelCatalog } from "../src/native-model-client.js";
import type { ModelRequest, ModelUsage } from "../src/core/contracts.js";

const model = { provider: "fixture", model: "chosen" };
const request: ModelRequest = { model, systemPrompt: "system", userMessage: "user" };
const usage: ModelUsage = { input: 17, output: 3, totalTokens: 20 };

function context(
  _facade: boolean,
  transport: (context: Context, options: SimpleStreamOptions) => Promise<AssistantMessage>,
): ExtensionContext {
  const streamSimple = (_model: unknown, ctx: Context, options: SimpleStreamOptions) => ({
    result: () => transport(ctx, options),
  });
  return {
    modelRegistry: {
      find: (provider: string, id: string) =>
        provider === model.provider && id === model.model ? { provider, id } : undefined,
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "synthetic" }),
      streamSimple,
    },
  } as unknown as ExtensionContext;
}

function response(text = "answer", error?: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: error ? "error" : "stop",
    errorMessage: error,
    timestamp: 0,
    usage,
  } as AssistantMessage;
}

describe("native model client", () => {
  it("preflights exact model bindings without transport or auth calls", async () => {
    const ctx = {
      modelRegistry: {
        find: (provider: string, id: string) =>
          provider === "fixture" && id === "chosen" ? model : undefined,
        getApiKeyAndHeaders: () => {
          throw new Error("preflight must not resolve auth");
        },
      },
    } as unknown as ExtensionContext;
    const client = createNativeModelClient(ctx, async () => {
      throw new Error("no paid work");
    });
    const missing = { role: "extract", config: { provider: "other", model: "chosen" } };
    assert.deepEqual(await client.preflight([{ role: "search", config: model }, missing]), [
      missing,
    ]);
  });

  it("forwards policy/options and owns a separate citation/usage sink per concurrent call", async () => {
    const ctx = {} as ExtensionContext;
    const signal = new AbortController().signal;
    const patch = (payload: Record<string, unknown>) => ({ ...payload, tools: [] });
    const retry = { attempts: 3, baseDelayMs: 1, maxDelayMs: 2 };
    const sinks = new Set();
    const client = createNativeModelClient(
      ctx,
      async (receivedCtx, config, system, user, options) => {
        assert.equal(receivedCtx, ctx);
        assert.equal(config, model);
        assert.equal(system, "system");
        assert.equal(options?.signal, signal);
        assert.equal(options?.payloadPatch, patch);
        assert.equal(options?.retry, retry);
        assert.equal(options?.timeoutMs, 30);
        assert.equal(options?.maxTokens, 55);
        assert.equal(options?.reasoning, "minimal");
        assert.ok(options?.annotations);
        assert.ok(!sinks.has(options.annotations));
        sinks.add(options.annotations);
        await Promise.resolve();
        options.annotations.citations.push({ url: `https://example.com/${user}` });
        options.onUsage?.(usage);
        return user;
      },
    );
    const results = await Promise.all(
      ["a", "b"].map((userMessage) =>
        client.complete({
          ...request,
          userMessage,
          signal,
          payloadPatch: patch,
          retry,
          timeoutMs: 30,
          maxTokens: 55,
          reasoning: "minimal",
          collectCitations: true,
        }),
      ),
    );
    assert.deepEqual(
      results,
      ["a", "b"].map((text) => ({
        text,
        citations: [{ url: `https://example.com/${text}` }],
        usage,
      })),
    );
    assert.notEqual(results[0].usage, usage);
  });

  it("always supplies a retry-notice channel so retries never reach the console", async () => {
    // Forward a supplied progress channel; otherwise use a no-op so native
    // retries never depend on an adapter logger. Native callLlm also uses a
    // silent policy logger defensively.
    const ctx = {} as ExtensionContext;
    const seen: Array<unknown> = [];
    const client = createNativeModelClient(ctx, async (_c, _m, _s, _u, options) => {
      seen.push(options?.onRetryNotice);
      return "ok";
    });
    const callerNotice = () => {};
    await client.complete({ ...request, onRetryNotice: callerNotice });
    await client.complete(request);
    assert.strictEqual(seen[0], callerNotice, "caller callback forwarded verbatim");
    assert.strictEqual(
      typeof seen[1],
      "function",
      "missing callback replaced by a no-op, never left undefined",
    );
  });

  it("does not invent citations or usage or wrap delegate errors", async () => {
    const ctx = {} as ExtensionContext;
    const client = createNativeModelClient(ctx, async (_ctx, _model, _system, _user, options) => {
      assert.equal(options?.annotations, undefined);
      return "answer";
    });
    assert.deepEqual(await client.complete(request), { text: "answer", citations: [] });
    const error = new Error("native error");
    const failing = createNativeModelClient(ctx, async () => {
      throw error;
    });
    await assert.rejects(failing.complete(request), (err) => err === error);
  });

  it("delegates through real callLlm on the facade transport", async () => {
    let calls = 0;
    const client = createNativeModelClient(
      context(true, async (ctx, options) => {
        calls++;
        assert.equal(ctx.systemPrompt, "system");
        assert.deepEqual(ctx.messages[0].content, [{ type: "text", text: "user" }]);
        assert.equal(options.maxRetries, 0);
        assert.equal(options.reasoning, "low");
        assert.equal(options.apiKey, "synthetic");
        return response();
      }),
    );
    assert.deepEqual(await client.complete(request), { text: "answer", citations: [], usage });
    assert.equal(calls, 1);
  });

  it("leaves retry ownership and provider-error classification in callLlm", async () => {
    let calls = 0;
    const client = createNativeModelClient(
      context(true, async () => (++calls === 1 ? response("", "429 retry after 0ms") : response())),
    );
    assert.equal(
      (
        await client.complete({
          ...request,
          retry: { attempts: 2, baseDelayMs: 0, maxDelayMs: 0 },
        })
      ).text,
      "answer",
    );
    assert.equal(calls, 2);
    const failing = createNativeModelClient(context(true, async () => response("", "401 denied")));
    await assert.rejects(
      failing.complete(request),
      /LLM call failed \(fixture\/chosen\): 401 denied/,
    );
  });

  it("propagates caller cancellation without another attempt", async () => {
    const controller = new AbortController();
    let calls = 0;
    const client = createNativeModelClient(
      context(true, async (_ctx, options) => {
        calls++;
        controller.abort();
        assert.ok(options.signal?.aborted);
        return response();
      }),
    );
    await assert.rejects(
      client.complete({
        ...request,
        signal: controller.signal,
        retry: { attempts: 3, baseDelayMs: 0, maxDelayMs: 0 },
      }),
      { name: "AbortError" },
    );
    assert.equal(calls, 1);
  });

  it("retains the native stalled-response timeout", async () => {
    let calls = 0;
    const client = createNativeModelClient(
      context(true, async (_ctx, options) => {
        calls++;
        return new Promise((resolve) => {
          options.signal!.addEventListener(
            "abort",
            () => resolve({ ...response(), stopReason: "aborted" }),
            { once: true },
          );
        });
      }),
    );
    await assert.rejects(client.complete({ ...request, timeoutMs: 5 }), /timed out .* after 5ms/);
    assert.equal(calls, 1);
  });
});

describe("describeModelCatalog (real ModelRegistry facade shapes)", () => {
  it("lists same-provider alternatives through getModelsOfType (Pi >= 0.99 facade)", () => {
    const ctx = {
      modelRegistry: {
        getModelsOfType: (_type: "chat", provider?: string) =>
          [
            { id: "perplexity/sonar", provider: "openrouter" },
            { id: "perplexity/sonar-pro", provider: "openrouter" },
            { id: "minimax/minimax-m3", provider: "openrouter" },
            { id: "other/x", provider: "deepseek" },
          ].filter((m) => !provider || m.provider === provider),
      },
    } as unknown as ExtensionContext;
    const hint = describeModelCatalog(ctx, "openrouter", "perplexity/sonar");
    assert.match(hint, /Available openrouter models:/);
    assert.match(hint, /perplexity\/sonar-pro/);
    assert.doesNotMatch(hint, /perplexity\/sonar,/);
    assert.doesNotMatch(hint, /other\/x/);
  });

  it("falls back to getAll filtered by provider on older facades", () => {
    const ctx = {
      modelRegistry: {
        getAll: () => [
          { id: "perplexity/sonar-pro", provider: "openrouter" },
          { id: "deepseek-chat", provider: "deepseek" },
        ],
      },
    } as unknown as ExtensionContext;
    assert.match(
      describeModelCatalog(ctx, "openrouter", "perplexity/sonar"),
      /perplexity\/sonar-pro/,
    );
    assert.equal(describeModelCatalog(ctx, "deepseek", "deepseek-chat"), "");
  });

  it("returns an empty hint when the facade exposes no catalogue accessor", () => {
    const ctx = { modelRegistry: {} } as unknown as ExtensionContext;
    assert.equal(describeModelCatalog(ctx, "openrouter", "perplexity/sonar"), "");
    const throwing = {
      modelRegistry: {
        getModelsOfType: () => {
          throw new Error("catalog unavailable");
        },
      },
    } as unknown as ExtensionContext;
    assert.equal(describeModelCatalog(throwing, "openrouter", "perplexity/sonar"), "");
  });
});
