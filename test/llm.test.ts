// test/llm.test.ts — LLM auth forwarding tests
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai/compat";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { __harness, callLlm } from "../src/llm.js";

function successfulResponse(text = "ok"): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "stop",
    timestamp: Date.now(),
  } as AssistantMessage;
}

function contextFor(auth: unknown): ExtensionContext {
  return {
    modelRegistry: {
      find: () => ({ provider: "openrouter", id: "perplexity/sonar" }),
      getApiKeyAndHeaders: async () => auth,
    },
  } as unknown as ExtensionContext;
}

describe("callLlm auth forwarding", () => {
  const original = __harness.completeSimple;

  afterEach(() => {
    __harness.completeSimple = original;
  });

  it("forwards resolved apiKey, headers, and env", async () => {
    let received: SimpleStreamOptions | undefined;
    __harness.completeSimple = (async (
      _model: Model<any>,
      _context: Context,
      options?: SimpleStreamOptions,
    ) => {
      received = options;
      return successfulResponse();
    }) as typeof __harness.completeSimple;

    await callLlm(
      contextFor({
        ok: true,
        apiKey: "secret",
        headers: { "X-Provider": "test" },
        env: { OPENROUTER_API_KEY: "from-env" },
      }),
      { provider: "openrouter", model: "perplexity/sonar" },
      "system",
      "user",
    );

    assert.strictEqual(received?.apiKey, "secret");
    assert.deepStrictEqual(received?.headers, { "X-Provider": "test" });
    assert.deepStrictEqual(received?.env, { OPENROUTER_API_KEY: "from-env" });
  });

  it("does not invoke completeSimple when auth resolution fails", async () => {
    let calls = 0;
    __harness.completeSimple = (async () => {
      calls++;
      return successfulResponse();
    }) as typeof __harness.completeSimple;

    await assert.rejects(
      callLlm(
        contextFor({ ok: false, error: "missing key" }),
        { provider: "openrouter", model: "perplexity/sonar" },
        "system",
        "user",
      ),
      /No API key/,
    );
    assert.strictEqual(calls, 0);
  });
});
