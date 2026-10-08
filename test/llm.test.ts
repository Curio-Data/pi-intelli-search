// test/llm.test.ts: LLM transport dispatch tests
//
// Since 0.17.0 the peer floor is Pi >= 0.86 and callLlm dispatches through
// exactly one transport: the ctx.modelRegistry.streamSimple() facade (which
// normalises the context, folding systemPrompt into the transcript before a
// provider sees it, resolving auth, and applying the auth baseUrl override).
// The legacy provider path through modelRegistry.getProvider() is gone.
// These tests pin the facade contract: auth forwarding, the provider-neutral
// reasoning level, retry ownership, the raw-Context system prompt, both
// citation channels (the onProviderStreamEvent stream option added with
// pi-ai 1.0 and the fetch-tee fallback that serves older hosts), and the
// version-guard failure mode on a registry without the facade.
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  Api,
  AssistantMessage,
  Context,
  Model,
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

/** One url_citation chunk shaped like an OpenAI Chat Completions SSE delta. */
function citationChunk(...urls: string[]): unknown {
  return {
    choices: [
      {
        delta: {
          annotations: urls.map((url) => ({
            type: "url_citation",
            url_citation: { url, title: `Title ${url}` },
          })),
        },
      },
    ],
  };
}

/**
 * Registry stub for the facade era: find + auth resolve normally, while the
 * facade method itself throws because the deterministic tests mock the
 * harness seam instead. `withFacade: false` drops the method entirely,
 * reproducing a host below the peer floor.
 */
function contextFor(auth: unknown, options: { withFacade?: boolean } = {}): ExtensionContext {
  return {
    modelRegistry: {
      find: () => ({ provider: "openrouter", id: "perplexity/sonar" }),
      getApiKeyAndHeaders: async () => auth,
      ...(options.withFacade === false
        ? {}
        : {
            streamSimple: () => {
              throw new Error("facade must not be called directly when __harness is mocked");
            },
          }),
    },
  } as unknown as ExtensionContext;
}

const CFG = { provider: "openrouter", model: "perplexity/sonar" } as const;

describe("native retry notice delivery", () => {
  const originalFacade = __harness.registryStreamSimple;
  afterEach(() => {
    __harness.registryStreamSimple = originalFacade;
  });

  for (const withNotice of [false, true]) {
    it(`facade retries stay console-free ${withNotice ? "with" : "without"} a notice callback`, async (t) => {
      let attempts = 0;
      const attempt = async () => {
        attempts++;
        return attempts === 1
          ? { ...successfulResponse(), stopReason: "error", errorMessage: "429 rate limited" } as AssistantMessage
          : successfulResponse();
      };
      __harness.registryStreamSimple = attempt as typeof __harness.registryStreamSimple;
      const consoleCalls: unknown[][] = [];
      for (const method of ["error", "warn", "log", "info"] as const) {
        t.mock.method(console, method, (...args: unknown[]) => { consoleCalls.push(args); });
      }
      const notices: string[] = [];
      const text = await callLlm(
        contextFor({ ok: true, apiKey: "synthetic" }),
        CFG,
        "system",
        "user",
        {
          retry: { attempts: 2, baseDelayMs: 0, maxDelayMs: 0 },
          ...(withNotice ? { onRetryNotice: (message: string) => { notices.push(message); } } : {}),
        },
      );
      assert.equal(text, "ok");
      assert.equal(attempts, 2);
      assert.equal(notices.length, withNotice ? 1 : 0);
      if (withNotice) assert.match(notices[0], /openrouter\/perplexity\/sonar: .*attempt 1, retrying in 0ms/);
      assert.deepEqual(consoleCalls, []);
    });
  }
});

describe("console-write source audit (Pi TUI safety)", () => {
  it("pipeline hot paths contain no direct console calls", async () => {
    // Raw console writes from extensions bypass the Pi TUI layout and appear
    // as stray lines in the window (reported against Pi 1.0). This audit
    // covers direct calls in the listed modules, not transitive logger
    // writes; the behavioural tests above cover native retry delivery.
    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const paths = [
      "src/llm.ts",
      "src/core/llm.ts",
      "src/core/fetch.ts",
      "src/core/operations/research.ts",
      "src/core/operations/search.ts",
      "src/core/operations/extract.ts",
      "src/core/operations/collate.ts",
    ];
    for (const rel of paths) {
      const source = readFileSync(join(root, rel), "utf8");
      // Strip comments: fetch.ts documents Defuddle's own console calls in
      // its muzzle comments, which are not calls made by this package.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
      const hits = code.match(/console\.(log|warn|error|info)\(/g) ?? [];
      assert.deepStrictEqual(hits, [], `${rel} must not call console.* directly`);
    }
  });
});

describe("callLlm registry-facade dispatch (single transport, Pi >= 0.86)", () => {
  const originalFacade = __harness.registryStreamSimple;

  afterEach(() => {
    __harness.registryStreamSimple = originalFacade;
  });

  it("dispatches through the facade with the raw Context and system prompt intact, leaving the baseUrl override to it", async () => {
    let receivedRegistry: unknown;
    let receivedModel: Model<Api> | undefined;
    let receivedContext: Context | undefined;
    let receivedOptions: SimpleStreamOptions | undefined;
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
      contextFor({ ok: true, apiKey: "secret", baseUrl: "https://proxy.example/v1" }),
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
    // Auth resolution flows through verbatim (auth.json, env, OAuth headers).
    assert.strictEqual(receivedOptions?.apiKey, "secret");
    // The provider-neutral reasoning level must survive the transport:
    // MiniMax M3 and other reasoning models reject or degrade without it.
    assert.strictEqual(receivedOptions?.reasoning, "low");
    // Retry stays owned by callLlm, not the SDK.
    assert.strictEqual(receivedOptions?.maxRetries, 0);
    assert.strictEqual(receivedOptions?.maxTokens, 123);
  });

  it("forwards an annotation fetch wrapper and stream-event hook only when a sink is provided", async () => {
    const captured: Array<SimpleStreamOptions | undefined> = [];
    __harness.registryStreamSimple = (async (
      _registry: unknown,
      _model: Model<Api>,
      _context: Context,
      options?: SimpleStreamOptions,
    ) => {
      captured.push(options);
      return successfulResponse();
    }) as typeof __harness.registryStreamSimple;

    const ctx = contextFor({ ok: true, apiKey: "secret" });
    await callLlm(ctx, CFG, "system", "user", { maxTokens: 10 });
    await callLlm(ctx, CFG, "system", "user", {
      maxTokens: 10,
      annotations: { citations: [] },
    });

    assert.strictEqual(captured.length, 2);
    assert.strictEqual(captured[0]?.fetch, undefined, "no sink: no fetch wrapper");
    assert.strictEqual(
      captured[0]?.onProviderStreamEvent,
      undefined,
      "no sink: no stream-event hook",
    );
    assert.strictEqual(typeof captured[1]?.fetch, "function", "sink present: wrapper forwarded");
    assert.strictEqual(
      typeof captured[1]?.onProviderStreamEvent,
      "function",
      "sink present: stream-event hook forwarded",
    );
  });

  it("harvests citations through both channels into one deduplicated sink", async () => {
    const savedFetch = globalThis.fetch;
    const sink: AnnotationSink = { citations: [] };
    globalThis.fetch = async () =>
      new Response(JSON.stringify(citationChunk("https://via-fetch.example")));
    __harness.registryStreamSimple = async (_registry, _model, _context, options) => {
      // The stream-event channel fires during the stream, as it does live.
      (options?.onProviderStreamEvent as (data: unknown) => void | Promise<void>)?.(
        citationChunk("https://via-fetch.example", "https://via-event.example"),
      );
      await options!.fetch!("https://fixture.invalid");
      return successfulResponse();
    };

    try {
      await callLlm(contextFor({ ok: true, apiKey: "secret" }), CFG, "system", "user", {
        maxTokens: 10,
        annotations: sink,
      });
      assert.deepEqual(
        sink.citations.map((c) => c.url),
        ["https://via-fetch.example", "https://via-event.example"],
        "both channels feed the sink and the shared URL is deduplicated",
      );
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it("forwards payloadPatch as onPayload and per-call reasoning override", async () => {
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
    __harness.registryStreamSimple = (async (
      _r: unknown,
      _m: Model<Api>,
      _c: Context,
      options?: SimpleStreamOptions,
    ) => {
      plain = options;
      return successfulResponse();
    }) as typeof __harness.registryStreamSimple;
    await callLlm(contextFor({ ok: true, apiKey: "secret" }), CFG, "system", "user", {
      maxTokens: 10,
    });
    assert.strictEqual(plain?.onPayload, undefined);
    assert.strictEqual(plain?.reasoning, "low");
  });

  it("awaits the annotation side channel before returning text", async () => {
    let releaseRead: (() => void) | undefined;
    const sink: AnnotationSink = { citations: [] };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            releaseRead = () => {
              controller.enqueue(new TextEncoder().encode("{}"));
              controller.close();
              releaseRead = undefined;
            };
          },
        }),
      );
    __harness.registryStreamSimple = async (_registry, _model, _context, options) => {
      await options!.fetch!("https://fixture.invalid");
      return successfulResponse();
    };

    let finished = false;
    const call = callLlm(contextFor({ ok: true, apiKey: "secret" }), CFG, "system", "user", {
      maxTokens: 10,
      annotations: sink,
    }).then((text) => {
      finished = true;
      return text;
    });
    try {
      await new Promise((r) => setTimeout(r, 25));
      assert.strictEqual(finished, false, "callLlm must not resolve while a read is in flight");
      releaseRead!();
      assert.strictEqual(await call, "ok");
      assert.strictEqual(finished, true);
    } finally {
      releaseRead?.();
      await call;
      globalThis.fetch = originalFetch;
    }
  });

  it("does not merge late citations from a failed attempt into the successful attempt", async () => {
    const savedFetch = globalThis.fetch;
    const sink: AnnotationSink = { citations: [] };
    const citation = (url: string) =>
      JSON.stringify({
        choices: [{ message: { annotations: [{ type: "url_citation", url_citation: { url } }] } }],
      });
    let releaseOld: (() => void) | undefined;
    let fetches = 0;
    globalThis.fetch = async () => {
      if (++fetches > 1) return new Response(citation("https://successful.example"));
      return new Response(
        new ReadableStream({
          start(controller) {
            releaseOld = () => {
              controller.enqueue(new TextEncoder().encode(citation("https://failed.example")));
              controller.close();
              releaseOld = undefined;
            };
          },
        }),
      );
    };
    let attempts = 0;
    __harness.registryStreamSimple = async (_registry, _model, _context, options) => {
      await options!.fetch!("https://fixture.invalid");
      if (++attempts === 1)
        return { ...successfulResponse(), stopReason: "error", errorMessage: "429" };
      releaseOld?.();
      return successfulResponse();
    };
    try {
      await callLlm(contextFor({ ok: true, apiKey: "secret" }), CFG, "system", "user", {
        annotations: sink,
        retry: { attempts: 2, baseDelayMs: 0, maxDelayMs: 0 },
      });
      assert.deepEqual(sink.citations, [{ url: "https://successful.example" }]);
      assert.equal(attempts, 2);
    } finally {
      releaseOld?.();
      globalThis.fetch = savedFetch;
    }
  });

  it("does not invoke the transport when auth resolution fails", async () => {
    let calls = 0;
    __harness.registryStreamSimple = (async () => {
      calls++;
      return successfulResponse();
    }) as typeof __harness.registryStreamSimple;

    await assert.rejects(
      callLlm(contextFor({ ok: false, error: "missing key" }), CFG, "system", "user"),
      /No API key/,
    );
    assert.strictEqual(calls, 0);
  });

  it("throws a clear version error when the registry lacks the facade (Pi < 0.86)", async () => {
    await assert.rejects(
      callLlm(
        contextFor({ ok: true, apiKey: "secret" }, { withFacade: false }),
        CFG,
        "system",
        "user",
      ),
      /Pi >= 0\.86/,
    );
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
