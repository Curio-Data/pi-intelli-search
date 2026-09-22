// test/llm.test.ts: LLM transport dispatch tests
//
// callLlm dispatches by feature detection: on Pi >= 0.86 through the
// ctx.modelRegistry.streamSimple() facade (which normalises the context,
// folding systemPrompt into the transcript before a provider sees it), and
// on Pi 0.81.1-0.85.x through the provider's streamSimple() (pi-ai root API)
// reached via ctx.modelRegistry.getProvider(). These tests pin both
// contracts: auth forwarding, the provider-neutral reasoning level, retry
// ownership, the baseUrl override on the legacy path, the raw-Context system
// prompt on both paths (Pi 0.86 providers drop a systemPrompt handed straight
// to them), and the version-guard failure mode on Pi versions without
// modelRegistry.getProvider().
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
import type { AnnotationSink } from "../src/annotations.js";
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
  /** Pi >= 0.86: the registry facade (ctx.modelRegistry.streamSimple) exists. */
  withFacade?: boolean;
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
      ...(overrides.withFacade
        ? {
            streamSimple: () => {
              throw new Error("facade must not be called directly when __harness is mocked");
            },
          }
        : {}),
    },
  } as unknown as ExtensionContext;
}

const CFG = { provider: "openrouter", model: "perplexity/sonar" } as const;

describe("callLlm provider dispatch (pi-ai root API)", () => {
  const original = __harness.streamSimple;
  const originalFacade = __harness.registryStreamSimple;

  afterEach(() => {
    __harness.streamSimple = original;
    __harness.registryStreamSimple = originalFacade;
  });

  it("dispatches via the provider's streamSimple with Pi-resolved auth, reasoning low, and maxRetries 0", async () => {
    let received: SimpleStreamOptions | undefined;
    let receivedProvider: Provider | undefined;
    let receivedModel: Model<Api> | undefined;
    let receivedContext: Context | undefined;
    __harness.streamSimple = (async (
      provider: Provider,
      model: Model<Api>,
      context: Context,
      options?: SimpleStreamOptions,
    ) => {
      receivedProvider = provider;
      receivedModel = model;
      receivedContext = context;
      received = options;
      return successfulResponse();
    }) as typeof __harness.streamSimple;
    __harness.registryStreamSimple = (() => {
      throw new Error("facade path must not be used when the registry has no facade (Pi <= 0.85)");
    }) as typeof __harness.registryStreamSimple;

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
    // The raw Context must carry the systemPrompt on the legacy path: Pi <=
    // 0.85 providers read this field directly, and dropping it would strip
    // every stage's instructions.
    assert.strictEqual(receivedContext?.systemPrompt, "system");
    assert.strictEqual(receivedContext?.messages.length, 1);
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

    const patch = (payload: Record<string, unknown>) => ({
      ...payload,
      tools: [{ type: "openrouter:web_search" }],
    });
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
    await callLlm(contextFor({ ok: true, apiKey: "secret" }), CFG, "system", "user", {
      maxTokens: 10,
    });
    assert.strictEqual(plain?.onPayload, undefined);
    assert.strictEqual(plain?.reasoning, "low");
  });

  it("awaits the annotation side channel before returning text", async () => {
    let releaseRead: (() => void) | undefined;
    const sink: AnnotationSink = {
      citations: [],
      reads: [
        new Promise<void>((resolve) => {
          releaseRead = resolve;
        }),
      ],
    };
    __harness.streamSimple = (async () => successfulResponse()) as typeof __harness.streamSimple;

    let finished = false;
    const call = callLlm(contextFor({ ok: true, apiKey: "secret" }), CFG, "system", "user", {
      maxTokens: 10,
      annotations: sink,
    }).then((text) => {
      finished = true;
      return text;
    });
    await new Promise((r) => setTimeout(r, 25));
    assert.strictEqual(finished, false, "callLlm must not resolve while a read is in flight");
    releaseRead!();
    assert.strictEqual(await call, "ok");
    assert.strictEqual(finished, true);
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

describe("callLlm registry-facade dispatch (Pi >= 0.86)", () => {
  const original = __harness.streamSimple;
  const originalFacade = __harness.registryStreamSimple;

  afterEach(() => {
    __harness.streamSimple = original;
    __harness.registryStreamSimple = originalFacade;
  });

  it("dispatches through the facade with the raw Context and system prompt intact, leaving the baseUrl override to it", async () => {
    let receivedRegistry: unknown;
    let receivedModel: Model<Api> | undefined;
    let receivedContext: Context | undefined;
    let receivedOptions: SimpleStreamOptions | undefined;
    __harness.streamSimple = (() => {
      throw new Error("provider path must not be used when the facade exists (Pi >= 0.86)");
    }) as typeof __harness.streamSimple;
    __harness.registryStreamSimple = (async (
      registry: unknown,
      model: Model<Api>,
      context: Context,
      options?: SimpleStreamOptions,
    ) => {
      receivedRegistry = registry;
      receivedModel = model;
      receivedContext = context;
      receivedOptions = options;
      return successfulResponse();
    }) as typeof __harness.registryStreamSimple;

    const result = await callLlm(
      contextFor(
        { ok: true, apiKey: "secret", baseUrl: "https://proxy.example/v1" },
        { withFacade: true },
      ),
      CFG,
      "system",
      "user",
      { maxTokens: 123 },
    );

    assert.strictEqual(result, "ok");
    assert.strictEqual(
      typeof (receivedRegistry as { streamSimple?: unknown } | undefined)?.streamSimple,
      "function",
      "the harness must receive the registry object so streamSimple runs as a method",
    );
    assert.strictEqual(receivedModel?.id, "perplexity/sonar");
    // The facade owns context normalisation on Pi >= 0.86: it folds
    // systemPrompt into the transcript itself. The raw Context we hand it must
    // still carry the field, and the model must NOT carry the baseUrl
    // override (prepareRequest inside the facade applies it).
    assert.strictEqual(receivedContext?.systemPrompt, "system");
    assert.strictEqual(receivedContext?.messages.length, 1);
    assert.strictEqual((receivedModel as { baseUrl?: string } | undefined)?.baseUrl, undefined);
    // Same option contract as the provider path: auth forwarded verbatim,
    // provider-neutral reasoning, retry owned by callLlm.
    assert.strictEqual(receivedOptions?.apiKey, "secret");
    assert.strictEqual(receivedOptions?.reasoning, "low");
    assert.strictEqual(receivedOptions?.maxRetries, 0);
    assert.strictEqual(receivedOptions?.maxTokens, 123);
  });

  it("forwards the annotation fetch wrapper and payloadPatch through the facade path", async () => {
    let received: SimpleStreamOptions | undefined;
    __harness.registryStreamSimple = (async (
      _registry: unknown,
      _model: Model<Api>,
      _context: Context,
      options?: SimpleStreamOptions,
    ) => {
      received = options;
      return successfulResponse();
    }) as typeof __harness.registryStreamSimple;

    await callLlm(
      contextFor({ ok: true, apiKey: "secret" }, { withFacade: true }),
      CFG,
      "system",
      "user",
      {
        maxTokens: 10,
        annotations: { citations: [] },
        payloadPatch: (payload) => ({ ...payload, tools: [{ type: "openrouter:web_search" }] }),
      },
    );

    assert.strictEqual(typeof received?.fetch, "function", "annotation wrapper forwarded");
    assert.strictEqual(typeof received?.onPayload, "function", "payloadPatch forwarded");
  });

  it("does not invoke the facade transport when auth resolution fails", async () => {
    let calls = 0;
    __harness.registryStreamSimple = (async () => {
      calls++;
      return successfulResponse();
    }) as typeof __harness.registryStreamSimple;

    await assert.rejects(
      callLlm(
        contextFor({ ok: false, error: "missing key" }, { withFacade: true }),
        CFG,
        "system",
        "user",
      ),
      /No API key/,
    );
    assert.strictEqual(calls, 0);
  });

  it("invokes the registry facade as a method, preserving the receiver", async () => {
    // Reproduces the detached-this failure mode caught live in E2E: `Pi`'s
    // ModelRegistry.streamSimple reads `this.runtime`, so a detached function
    // reference throws "Cannot read properties of undefined (reading 'runtime')".
    // This test runs the REAL harness (not a mock), so the registry stub below
    // must be invoked as a method for the call to succeed.
    const registry = {
      find: () => ({ provider: "openrouter", id: "perplexity/sonar" }),
      getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "secret" }),
      getProvider: () => providerStub,
      runtime: "present",
      streamSimple(this: { runtime?: unknown }) {
        if (this?.runtime !== "present") {
          throw new Error("streamSimple invoked without its registry receiver");
        }
        return { result: async () => successfulResponse("via-facade") };
      },
    };

    const result = await callLlm(
      { modelRegistry: registry } as unknown as ExtensionContext,
      CFG,
      "system",
      "user",
    );

    assert.strictEqual(result, "via-facade");
  });
});
