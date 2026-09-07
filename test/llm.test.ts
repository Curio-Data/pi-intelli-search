// test/llm.test.ts: LLM transport dispatch tests
//
// callLlm must dispatch through ctx.modelRegistry.getProvider(id).streamSimple()
// (the pi-ai root API) rather than the deprecated @earendil-works/pi-ai/compat
// completeSimple() shim. These tests pin that contract: auth forwarding, the
// provider-neutral reasoning level, retry ownership, baseUrl override, and the
// version-guard failure mode on Pi versions without modelRegistry.getProvider().
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  Provider,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
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

/** Stand-in for the provider object Pi composes for models.json/built-ins. */
const providerStub: Provider = {
  id: "openrouter",
  name: "OpenRouter",
  auth: {} as Provider["auth"],
  getModels: () => [],
  stream: (() => {
    throw new Error("stream() must not be called by callLlm");
  }) as Provider["stream"],
  streamSimple: (() => {
    throw new Error("streamSimple() must not be called directly when __harness is mocked");
  }) as Provider["streamSimple"],
};

interface RegistryOverrides {
  provider?: Provider;
  /** getProvider exists but returns undefined for every provider. */
  providerMissing?: boolean;
  /** Pi < 0.81.1: the facade has no getProvider method at all. */
  omitGetProvider?: boolean;
}

function contextFor(auth: unknown, overrides: RegistryOverrides = {}): ExtensionContext {
  return {
    modelRegistry: {
      find: () => ({ provider: "openrouter", id: "perplexity/sonar" }),
      getApiKeyAndHeaders: async () => auth,
      ...(overrides.omitGetProvider
        ? {}
        : {
            getProvider: (id: string) =>
              overrides.providerMissing
                ? undefined
                : id === "openrouter"
                  ? (overrides.provider ?? providerStub)
                  : undefined,
          }),
    },
  } as unknown as ExtensionContext;
}

const CFG = { provider: "openrouter", model: "perplexity/sonar" } as const;

describe("callLlm provider dispatch (pi-ai root API)", () => {
  const original = __harness.streamSimple;

  afterEach(() => {
    __harness.streamSimple = original;
  });

  it("dispatches via the provider's streamSimple with Pi-resolved auth, reasoning low, and maxRetries 0", async () => {
    let received: SimpleStreamOptions | undefined;
    let receivedProvider: Provider | undefined;
    let receivedModel: Model<Api> | undefined;
    __harness.streamSimple = (async (
      provider: Provider,
      model: Model<Api>,
      _context: Context,
      options?: SimpleStreamOptions,
    ) => {
      receivedProvider = provider;
      receivedModel = model;
      received = options;
      return successfulResponse();
    }) as typeof __harness.streamSimple;

    const result = await callLlm(
      contextFor({
        ok: true,
        apiKey: "secret",
        headers: { "X-Provider": "test" },
        env: { OPENROUTER_API_KEY: "from-env" },
      }),
      CFG,
      "system",
      "user",
      { maxTokens: 123 },
    );

    assert.strictEqual(result, "ok");
    assert.strictEqual(receivedProvider?.id, "openrouter");
    assert.strictEqual(receivedModel?.id, "perplexity/sonar");
    // Auth resolution flows through verbatim (auth.json, env, OAuth headers).
    assert.strictEqual(received?.apiKey, "secret");
    assert.deepStrictEqual(received?.headers, { "X-Provider": "test" });
    assert.deepStrictEqual(received?.env, { OPENROUTER_API_KEY: "from-env" });
    // The provider-neutral reasoning level must survive the transport swap:
    // MiniMax M2.7 and other reasoning models reject or degrade without it.
    assert.strictEqual(received?.reasoning, "low");
    // Retry stays owned by callLlm, not the SDK.
    assert.strictEqual(received?.maxRetries, 0);
    assert.strictEqual(received?.maxTokens, 123);
  });

  it("forwards an annotation-harvesting fetch wrapper only when an annotations sink is provided", async () => {
    const captured: Array<SimpleStreamOptions | undefined> = [];
    __harness.streamSimple = (async (
      _provider: Provider,
      _model: Model<Api>,
      _context: Context,
      options?: SimpleStreamOptions,
    ) => {
      captured.push(options);
      return successfulResponse();
    }) as typeof __harness.streamSimple;

    const ctx = contextFor({ ok: true, apiKey: "secret" });
    await callLlm(ctx, CFG, "system", "user", { maxTokens: 10 });
    await callLlm(ctx, CFG, "system", "user", {
      maxTokens: 10,
      annotations: { citations: [] },
    });

    assert.strictEqual(captured.length, 2);
    assert.strictEqual(captured[0]?.fetch, undefined, "no sink: no fetch wrapper");
    assert.strictEqual(typeof captured[1]?.fetch, "function", "sink present: wrapper forwarded");
  });

  it("forwards payloadPatch as onPayload and per-call reasoning override", async () => {
    let received: SimpleStreamOptions | undefined;
    __harness.streamSimple = (async (
      _provider: Provider,
      _model: Model<Api>,
      _context: Context,
      options?: SimpleStreamOptions,
    ) => {
      received = options;
      return successfulResponse();
    }) as typeof __harness.streamSimple;

    const patch = (payload: Record<string, unknown>) => ({ ...payload, tools: [{ type: "openrouter:web_search" }] });
    await callLlm(contextFor({ ok: true, apiKey: "secret" }), CFG, "system", "user", {
      maxTokens: 10,
      payloadPatch: patch,
      reasoning: "minimal",
    });

    assert.strictEqual(typeof received?.onPayload, "function");
    // The patch runs through onPayload: our server tool lands on the payload.
    const patched = (received?.onPayload as (p: unknown) => unknown)({ model: CFG.model });
    assert.deepStrictEqual(patched, {
      model: CFG.model,
      tools: [{ type: "openrouter:web_search" }],
    });
    assert.strictEqual(received?.reasoning, "minimal");

    // Without overrides the defaults hold: no onPayload, reasoning low.
    let plain: SimpleStreamOptions | undefined;
    __harness.streamSimple = (async (
      _p: Provider,
      _m: Model<Api>,
      _c: Context,
      options?: SimpleStreamOptions,
    ) => {
      plain = options;
      return successfulResponse();
    }) as typeof __harness.streamSimple;
    await callLlm(contextFor({ ok: true, apiKey: "secret" }), CFG, "system", "user", { maxTokens: 10 });
    assert.strictEqual(plain?.onPayload, undefined);
    assert.strictEqual(plain?.reasoning, "low");
  });

  it("applies the auth-resolved baseUrl onto the request model, mirroring ModelRuntime.prepareRequest", async () => {
    let receivedModel: Model<Api> | undefined;
    __harness.streamSimple = (async (
      _provider: Provider,
      model: Model<Api>,
      _context: Context,
      _options?: SimpleStreamOptions,
    ) => {
      receivedModel = model;
      return successfulResponse();
    }) as typeof __harness.streamSimple;

    await callLlm(
      contextFor({
        ok: true,
        apiKey: "secret",
        baseUrl: "https://proxy.example/v1",
      }),
      CFG,
      "system",
      "user",
    );

    assert.strictEqual(
      (receivedModel as { baseUrl?: string } | undefined)?.baseUrl,
      "https://proxy.example/v1",
      "auth.baseUrl must override the model baseUrl exactly as Pi's runtime does",
    );
  });

  it("does not invoke the transport when auth resolution fails", async () => {
    let calls = 0;
    __harness.streamSimple = (async () => {
      calls++;
      return successfulResponse();
    }) as typeof __harness.streamSimple;

    await assert.rejects(
      callLlm(contextFor({ ok: false, error: "missing key" }), CFG, "system", "user"),
      /No API key/,
    );
    assert.strictEqual(calls, 0);
  });

  it("throws a clear version error when modelRegistry lacks getProvider (Pi < 0.81.1)", async () => {
    await assert.rejects(
      callLlm(
        contextFor({ ok: true, apiKey: "secret" }, { omitGetProvider: true }),
        CFG,
        "system",
        "user",
      ),
      /Pi >= 0\.81\.1/,
    );
  });

  it("throws a clear error when the model's provider is not registered", async () => {
    await assert.rejects(
      callLlm(
        contextFor({ ok: true, apiKey: "secret" }, { providerMissing: true }),
        CFG,
        "system",
        "user",
      ),
      /No API provider registered for openrouter/,
    );
  });
});
