// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
  Api,
  Model,
  AssistantMessage,
  Context,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type {
  AccountingSummary,
  AttemptRecord,
  Clock,
  OperationInputs,
} from "../src/core/contracts.js";
import extension from "../src/index.js";
import { getEventListeners } from "node:events";
import { Check } from "typebox/value";
import {
  standaloneOutputSchemas,
  collateOutputSchema,
  researchOutputSchema,
} from "../src/core/output-schemas.js";
import { suppliedCollation, verifyCollateData } from "./helpers/collate-fixtures.js";
import { markdownPage } from "./helpers/page-fixtures.js";
import { createRunStore } from "../src/core/run-store.js";
import type { FullData, Progress } from "../src/core/contracts.js";
import { __harness as indexHarness } from "../src/index.js";
import { __harness as llmHarness } from "../src/llm.js";
import { __harness as researchHarness } from "../src/tools/intelli-research.js";
import {
  createNativeOperationRuntime,
  NativeExecutionError,
  type NativeRuntimeOptions,
} from "../src/native-operation-runtime.js";
import { createRegisteredNativeTools } from "../src/native-registered-tools.js";
import { invalidateSettingsCache, clearMigrationContext } from "../src/settings.js";
import {
  SEARCH_SYSTEM_PROMPT,
  EXTRACTION_SYSTEM_PROMPT,
  COLLATION_SYSTEM_PROMPT,
} from "../src/prompts.js";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const page = { url: "https://docs.example/page", title: "Docs", content: "Facts" };
const wireUsage = {
  prompt_tokens: 12,
  completion_tokens: 3,
  total_tokens: 15,
  cost: 0.001,
  prompt_tokens_details: { cached_tokens: 2, cache_write_tokens: 1 },
};
function response(text: string, error?: string): AssistantMessage {
  return {
    role: "assistant",
    api: "openai-completions",
    provider: "openrouter",
    model: "fixture",
    timestamp: 0,
    content: [{ type: "text", text }],
    stopReason: error ? "error" : "stop",
    ...(error ? { errorMessage: error } : {}),
    usage: {
      input: 9,
      output: 3,
      cacheRead: 2,
      cacheWrite: 1,
      totalTokens: 15,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  } as AssistantMessage;
}
type Transport = (context: Context, options: SimpleStreamOptions) => Promise<AssistantMessage>;
type Result = Awaited<ReturnType<ReturnType<typeof createNativeOperationRuntime>["execute"]>>;
function receipt(result: Result) {
  return result.details!.execution as {
    operationId: string;
    accounting: AccountingSummary;
    attempts: AttemptRecord[];
    diagnostics: { code: string; message: string }[];
  };
}
async function fixture(transport: Transport, options: NativeRuntimeOptions = {}, settings = {}) {
  const root = await mkdtemp(join(tmpdir(), "native-registered-"));
  const agent = join(root, "agent");
  await mkdir(agent);
  const saved = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agent;
  invalidateSettingsCache();
  clearMigrationContext();
  const saveSettings = async (extra = {}) => {
    await writeFile(
      join(agent, "settings.json"),
      JSON.stringify({
        "pi-intelli-search": {
          searchModel: { provider: "openrouter", model: "same-model" },
          extractModel: { provider: "openrouter", model: "same-model" },
          collateModel: { provider: "openrouter", model: "same-model" },
          llmRetryAttempts: 2,
          retryBaseDelayMs: 0,
          retryMaxDelayMs: 0,
          searchRetryAttempts: 1,
          disableLlmsFullDiscovery: true,
          disableTelemetry: true,
          ...settings,
          ...extra,
        },
      }),
    );
    invalidateSettingsCache();
  };
  await saveSettings();
  const runtime = createNativeOperationRuntime({ supportsErrorResults: true, ...options });
  const updates: unknown[] = [];
  const indicators: unknown[] = [];
  const notices: string[] = [];
  const registry = {
    find: (_provider: string, id: string) => ({ provider: "openrouter", id }),
    getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "synthetic" }),
    refresh: async () => {},
    streamSimple: (_model: unknown, context: Context, options: SimpleStreamOptions) => ({
      result: async () => {
        assert.equal(options.maxRetries, 0);
        options.onProviderStreamEvent?.(
          { usage: wireUsage },
          registry.find("openrouter", "same-model") as Model<Api>,
        );
        return transport(context, options);
      },
    }),
  };
  const makeContext = (id: string): ExtensionContext =>
    ({
      cwd: root,
      hasUI: true,
      isProjectTrusted: () => false,
      sessionManager: { getSessionId: () => id },
      modelRegistry: registry,
      ui: {
        notify: (message: string) => notices.push(message),
        setWorkingIndicator: (value?: unknown) => indicators.push(value ?? null),
      },
    }) as unknown as ExtensionContext;
  const ctx = makeContext("first");
  const tools = createRegisteredNativeTools(runtime);
  const run = <Name extends keyof OperationInputs>(
    name: Name,
    params: OperationInputs[Name],
    signal?: AbortSignal,
    context = ctx,
  ) => runtime.execute(name, params, signal, (value) => updates.push(value), context);
  return {
    root,
    agent,
    runtime,
    ctx,
    makeContext,
    tools,
    run,
    indicators,
    updates,
    notices,
    saveSettings,
    async cleanup() {
      await runtime.close();
      if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = saved;
      invalidateSettingsCache();
      clearMigrationContext();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("all registered model preflight errors retain native recovery hints without dispatch (T15/T17)", async (t) => {
  for (const supportsErrorResults of [false, true]) {
    const f = await fixture(
      async () => {
        throw new Error("must not dispatch");
      },
      { supportsErrorResults },
    );
    const find = t.mock.method(f.ctx.modelRegistry, "find", () => undefined);
    Object.assign(f.ctx.modelRegistry, {
      getAll: () => [
        { provider: "openrouter", id: "same-model-corrected" },
        { provider: "other-provider", id: "foreign-model" },
      ],
    });
    try {
      for (const name of [
        "intelli_search",
        "intelli_extract",
        "intelli_collate",
        "intelli_research",
      ] as const) {
        await assert.rejects(
          f.run(
            name,
            name === "intelli_search" || name === "intelli_research"
              ? { query: "Q" }
              : name === "intelli_extract"
                ? { ...page, query: "Q" }
                : suppliedCollation(),
          ),
          (error: unknown) => {
            assert(error instanceof Error && !(error instanceof NativeExecutionError));
            assert.match(
              error.message,
              new RegExp(
                `${name === "intelli_research" ? "search" : name.slice(8)}: openrouter/same-model`,
              ),
            );
            assert.match(error.message, /Available openrouter models: same-model-corrected/);
            assert.match(error.message, /settings.json/);
            assert.match(error.message, /Run \/login to add API keys/);
            assert.match(error.message, /\/model to see available models/);
            assert(!error.message.includes("foreign-model"));
            assert(
              !("usage" in error) && !("data" in error),
              "ordinary preflight invents no receipt",
            );
            return true;
          },
        );
      }
      assert.equal(f.updates.length, 0);
    } finally {
      find.mock.restore();
      await f.cleanup();
    }
  }
});

test("registered entry uses scoped standalone inference, numeric usage and no mutable transport harness (T11/T15/T16)", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("network forbidden");
  });
  const old = llmHarness.registryStreamSimple;
  llmHarness.registryStreamSimple = async () => {
    throw new Error("legacy harness bypass");
  };
  let attempts = 0;
  const f = await fixture(async () => {
    attempts++;
    return response("answer", "503 retryable");
  });
  const registered: Record<string, unknown> = {};
  let shutdown: ((event: unknown, ctx: ExtensionContext) => Promise<void>) | undefined;
  extension({
    registerTool(tool: (typeof f.tools)[0]) {
      registered[tool.name] = tool;
    },
    registerMcpServer() {},
    on(name: string, handler: typeof shutdown) {
      if (name === "session_shutdown") shutdown = handler;
    },
  } as unknown as ExtensionAPI);
  try {
    for (const [name, params] of [
      ["intelli_search", { query: "standalone" }],
      ["intelli_extract", { ...page, query: "standalone" }],
      [
        "intelli_collate",
        {
          query: "standalone",
          extractions: [{ ...page, extraction: "facts", sourceType: "docs", status: "success" }],
        },
      ],
    ] as const) {
      const tool = registered[name] as {
        execute(
          id: string,
          params: unknown,
          signal: undefined,
          update: undefined,
          ctx: ExtensionContext,
        ): Promise<Result>;
      };
      const result = await tool.execute("host-id", params, undefined, undefined, f.ctx);
      assert.equal(result.isError, true);
      assert.equal(receipt(result).accounting.attempts, 1, "standalone never retries");
      assert.equal(receipt(result).accounting.parentDelivery, "available");
      assert.equal(receipt(result).accounting.costComplete, true);
      if (name !== "intelli_collate") {
        const data = result.details!.intelli as FullData;
        assert(Check(standaloneOutputSchemas[name], data));
        assert.equal(data.outcome, "error");
        assert.deepEqual(data.accounting, receipt(result).accounting);
        assert.equal(data.accounting.parentDelivery, "available");
        assert(
          !JSON.stringify(data).includes('"intelli"'),
          "no recursive native reconstruction field",
        );
      }
      assert.equal(result.usage.input, 9);
      assert.equal(result.usage.cost.total, 0.001);
    }
    assert.equal(attempts, 3);
    // The actual default-registered research path also uses scoped accounting.
    const researchTool = registered.intelli_research as {
      execute(
        id: string,
        params: unknown,
        signal: undefined,
        update: undefined,
        ctx: ExtensionContext,
      ): Promise<Result>;
    };
    const result = await researchTool.execute(
      "host-research",
      { query: "no links" },
      undefined,
      undefined,
      f.ctx,
    );
    assert(result.isError);
    assert.equal(receipt(result).accounting.attempts, 2, "research retains configured retries");
  } finally {
    await shutdown?.({}, f.ctx);
    llmHarness.registryStreamSimple = old;
    await f.cleanup();
  }
});

test("native research/suggest roles share a settled operation, retry accounting and immutable registered dependencies (T04/T11/T16)", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("network forbidden");
  });
  let searchCalls = 0;
  const old = researchHarness.fetchPages;
  researchHarness.fetchPages = async () => {
    throw new Error("legacy page harness bypass");
  };
  const f = await fixture(
    async (context) => {
      if (context.systemPrompt === SEARCH_SYSTEM_PROMPT) {
        searchCalls++;
        return response(`[Docs](${page.url})`, searchCalls === 1 ? "503 transient" : undefined);
      }
      if (context.systemPrompt === EXTRACTION_SYSTEM_PROMPT)
        return response("Official docs, current.\nFacts");
      if (context.systemPrompt === COLLATION_SYSTEM_PROMPT) return response("Answer [S1]");
      return response("[]");
    },
    {
      pageTransport: markdownPage(page.content),
    },
  );
  try {
    await mkdir(join(f.root, ".search/2026-01-01-prior-abcdef"), { recursive: true });
    await writeFile(
      join(f.root, ".search/2026-01-01-prior-abcdef/report.md"),
      "Prior verified legacy report",
    );
    await writeFile(
      join(f.root, ".search/.index.json"),
      JSON.stringify({
        searches: [
          {
            slug: "2026-01-01-prior-abcdef",
            query: "prior",
            timestamp: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    );
    const result = await f.tools[3].execute(
      "host-research",
      { query: "scoped research" },
      undefined,
      (value) => f.updates.push(value),
      f.ctx,
    );
    assert(!result.isError);
    const data = result.details!.intelli as FullData;
    assert(Check(researchOutputSchema, data));
    assert.equal(data.text, result.content[0].type === "text" ? result.content[0].text : "");
    assert.equal(data.accounting.attempts, 5);
    assert.equal(data.sources[0].state, "used");
    const execution = receipt(result);
    assert.deepEqual(
      execution.attempts.map((item) => item.role),
      ["search", "search", "extract", "collate", "suggest"],
    );
    assert.equal(new Set(execution.attempts.map((item) => item.operationId)).size, 1);
    assert.equal(execution.attempts[0].callId, execution.attempts[1].callId);
    assert.equal(execution.attempts[2].pageId, "S1");
    assert.equal(execution.accounting.attempts, 5);
    assert.equal(execution.accounting.tokens.inputTotal, 60);
    assert.equal(execution.accounting.reportedCost.total, 0.005);
    assert(f.updates.length > 0);
    assert.equal(f.indicators.at(-1), null);
  } finally {
    researchHarness.fetchPages = old;
    await f.cleanup();
  }
});

test("replacement owns stage-gap drain; old shutdown, late progress and UI failures cannot touch successor (T04/T10/T20)", async () => {
  const entered = deferred();
  const abortSeen = deferred();
  const cleanup = deferred();
  const f = await fixture(async () => response(`[Docs](${page.url})`), {
    async pageTransport(url, request) {
      const signal = request.signal;
      entered.resolve();
      if (!signal.aborted)
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      abortSeen.resolve();
      await cleanup.promise;
      signal.throwIfAborted();
      return markdownPage(page.content)(url, request);
    },
  });
  try {
    const pending = f.run("intelli_research", { query: "old gap" });
    await entered.promise;
    const before = f.updates.length;
    const next = f.makeContext("next");
    let ready = false;
    const replacing = f.runtime.start(next).then(() => {
      ready = true;
    });
    await abortSeen.promise;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(ready, false);
    assert.equal(f.runtime.isCurrent(f.ctx), false);
    const queued = new AbortController();
    const waiting = f.run("intelli_search", { query: "waiting" }, queued.signal, next);
    queued.abort();
    await assert.rejects(waiting, (error: Error) => error.name === "AdmissionError");
    await assert.rejects(f.run("intelli_search", { query: "old" }));
    // Closing the captured old session cannot dispose the manager/successor.
    const shutdown = f.runtime.shutdown(f.ctx);
    assert.equal(f.runtime.shutdown(f.ctx), shutdown);
    assert.equal(getEventListeners(queued.signal, "abort").length, 0);
    cleanup.resolve();
    await replacing;
    await shutdown;
    const result = await pending;
    assert(result.isError);
    assert.equal(receipt(result).accounting.parentDelivery, "unknown");
    assert.equal(f.updates.length, before);
    assert.equal(f.indicators.at(-1), null);
    assert(f.runtime.isCurrent(next));
    const after = await f.run("intelli_search", { query: "new" }, undefined, next);
    assert(!after.isError);
    await f.runtime.shutdown(f.ctx);
    assert(!(await f.run("intelli_search", { query: "still new" }, undefined, next)).isError);
  } finally {
    cleanup.resolve();
    await f.cleanup();
  }
});

test("native caller cancellation on open runtime retains only dispatched attempts and unknown parent delivery (T05/T12/T16)", async () => {
  const four = deferred();
  const release = deferred();
  let starts = 0;
  const f = await fixture(async () => {
    if (++starts === 4) four.resolve();
    await release.promise;
    return response("extract");
  });
  const controllers = Array.from({ length: 6 }, () => new AbortController());
  const pending = controllers.map((controller) =>
    f.run("intelli_extract", { ...page, query: "reserve" }, controller.signal),
  );
  try {
    await four.promise;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(starts, 4);
    controllers.forEach((controller) => controller.abort());
    release.resolve();
    const results = await Promise.all(pending);
    assert.equal(
      results.reduce((count, result) => count + receipt(result).accounting.attempts, 0),
      4,
    );
    for (const result of results) {
      assert(result.isError);
      assert.equal(receipt(result).accounting.parentDelivery, "unknown");
      const data = result.details!.intelli as FullData;
      assert(Check(standaloneOutputSchemas.intelli_extract, data));
      assert.equal(data.outcome, "aborted");
      assert.equal(data.counts.cancelled, 1);
      assert.equal(data.accounting.parentDelivery, "unknown");
      assert.deepEqual(data.attempts, receipt(result).attempts);
    }
    assert.equal(new Set(results.map((result) => receipt(result).operationId)).size, 6);
    assert(!(await f.run("intelli_search", { query: "still open" })).isError);
  } finally {
    release.resolve();
    await f.cleanup();
  }
});

test("captured native settings and runtime-wide clock/pacing preserve standalone no-timeout policy (T10/T13/T15)", async () => {
  let now = 0;
  let timers = 0;
  const starts: number[] = [];
  const clock: Clock = {
    monotonicMs: () => now,
    utcIso: () => "2026-10-20T00:00:00.000Z",
    schedule(ms, callback) {
      timers++;
      let pending = true;
      const timer = setImmediate(() => {
        pending = false;
        timers--;
        now += ms;
        callback();
      });
      return () => {
        if (pending) {
          pending = false;
          timers--;
          clearImmediate(timer);
        }
      };
    },
    async sleep(ms) {
      now += ms;
    },
  };
  const f = await fixture(
    async () => {
      starts.push(now);
      return response("Answer");
    },
    { clock },
    { minRequestIntervalMs: 17, llmTimeoutMs: 1_000 },
  );
  try {
    assert.equal(timers, 0);
    await f.runtime.start(f.ctx);
    await f.saveSettings({ minRequestIntervalMs: 100 });
    await Promise.all([
      f.run("intelli_search", { query: "one" }),
      f.run("intelli_extract", { ...page, query: "two" }),
    ]);
    assert.deepEqual(starts, [0, 17], "generation retains captured pacing despite settings reload");
    assert.equal(timers, 0, "standalone did not schedule configured model timeout");
  } finally {
    await f.cleanup();
  }
});

test("close-safe operation diagnostics survive cleanup failure without raw console writes (T04/T16/T20)", async (t) => {
  t.mock.method(console, "warn", () => {
    throw new Error("raw console forbidden");
  });
  t.mock.method(console, "error", () => {
    throw new Error("raw console forbidden");
  });
  const entered = deferred();
  const release = deferred();
  const f = await fixture(async () => response("", "401 primary failure"), {
    createRuns() {
      return {
        async settle() {
          entered.resolve();
          await release.promise;
          throw new Error("cleanup diagnostic");
        },
      } as unknown as import("../src/core/contracts.js").RunStore;
    },
  });
  try {
    f.ctx.ui.notify = () => {
      throw new Error("renderer gone");
    };
    const pending = f.run("intelli_search", { query: "failure" });
    await entered.promise;
    let done = false;
    const closing = f.runtime.shutdown(f.ctx).then(() => {
      done = true;
    });
    await Promise.resolve();
    assert.equal(done, false);
    release.resolve();
    await closing;
    const result = await pending;
    assert(result.isError);
    assert.match(result.content[0].text, /401 primary failure/);
    assert.equal(receipt(result).attempts[0].state, "failed");
    assert(
      receipt(result).diagnostics.some(
        (item) => item.code === "OPERATION_CLEANUP_FAILED" && item.message === "cleanup diagnostic",
      ),
    );
    assert.equal(receipt(result).accounting.parentDelivery, "unknown");
    assert.equal(f.runtime.close(), f.runtime.close());
  } finally {
    release.resolve();
    await f.cleanup();
  }
});

test("failed/superseded preparation cannot resurrect admission or enable a disposed generation (T10)", async () => {
  const preparing = deferred();
  const f = await fixture(async () => response("answer"));
  try {
    await f.runtime.start(f.ctx);
    const next = f.makeContext("pending");
    const start = f.runtime.start(next, () => preparing.promise).catch((error: unknown) => error);
    const newest = f.makeContext("newest");
    const final = f.runtime.start(newest);
    const controller = new AbortController();
    const waiting = f.run("intelli_search", { query: "pending" }, controller.signal, newest);
    controller.abort();
    await assert.rejects(waiting);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    preparing.resolve();
    assert((await start) instanceof Error);
    await final;
    assert(!(await f.run("intelli_search", { query: "latest" }, undefined, newest)).isError);
    const invalid = f.makeContext("invalid");
    await assert.rejects(
      f.runtime.start(invalid, async () => {
        throw new Error("invalid preparation");
      }),
      /invalid preparation/,
    );
    await assert.rejects(f.run("intelli_search", { query: "failed" }, undefined, invalid));
    await assert.rejects(f.run("intelli_search", { query: "old" }, undefined, newest));
    const disposed = f.makeContext("disposed");
    const held = deferred();
    const pending = f.runtime.start(disposed, () => held.promise).catch((error: unknown) => error);
    const close = f.runtime.close();
    held.resolve();
    await close;
    assert((await pending) instanceof Error);
    await assert.rejects(f.runtime.start(f.makeContext("after disposal")), /disposed/);
  } finally {
    preparing.resolve();
    await f.cleanup();
  }
});

test("entry lifecycle suppresses stale startup/provider callbacks and captured shutdown leaves successor open (T10/T20)", async () => {
  const entered = deferred();
  const release = deferred();
  const f = await fixture(async () => response("answer"));
  const old = indexHarness.ensureCustomModels;
  indexHarness.ensureCustomModels = async () => {
    entered.resolve();
    await release.promise;
    return ["fixture"];
  };
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
  const registered: Record<string, unknown> = {};
  extension({
    registerTool(tool: { name: string }) {
      registered[tool.name] = tool;
    },
    on(name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) {
      handlers.set(name, handler);
    },
  } as unknown as ExtensionAPI);
  const next = f.makeContext("entry-next");
  let oldUi = 0;
  let newUi = 0;
  f.ctx.ui.notify = () => {
    oldUi++;
  };
  f.ctx.ui.setStatus = () => {
    oldUi++;
  };
  next.ui.notify = () => {
    newUi++;
  };
  next.ui.setStatus = () => {
    newUi++;
  };
  try {
    const first = Promise.resolve(handlers.get("session_start")!({}, f.ctx)).catch(
      (error: unknown) => error,
    );
    await entered.promise;
    const replacing = Promise.resolve(handlers.get("session_start")!({}, next));
    handlers.get("after_provider_response")!({ status: 429, headers: {} }, f.ctx);
    assert.equal(oldUi, 0);
    release.resolve();
    await replacing;
    assert((await first) instanceof Error);
    assert.equal(oldUi, 0, "late startup notification never reaches old UI");
    await handlers.get("session_shutdown")!({}, f.ctx);
    handlers.get("after_provider_response")!({ status: 200, headers: {} }, next);
    assert(newUi > 0);
    const tool = registered.intelli_search as {
      execute(
        id: string,
        params: unknown,
        signal: undefined,
        update: undefined,
        ctx: ExtensionContext,
      ): Promise<Result>;
    };
    assert(!(await tool.execute("next", { query: "next" }, undefined, undefined, next)).isError);
  } finally {
    release.resolve();
    await handlers.get("session_shutdown")!({}, next);
    indexHarness.ensureCustomModels = old;
    await f.cleanup();
  }
});

// Source-level semantic fixture of pi-agent-core 0.86.0 executePreparedToolCall:
// a returned result always becomes isError:false; only a throw marks failure.
// The newer loop uses result.isError === true. This is not a live-floor gate.
async function hostToolBoundary(execute: () => Promise<Result>, returnedErrors: boolean) {
  try {
    const result = await execute();
    return { result, isError: returnedErrors && result.isError === true };
  } catch (error) {
    return { error, isError: true };
  }
}

for (const modern of [false, true]) {
  test(`registered failures/cancellation keep host error semantics with returned-error capability ${modern} (T15/T16/T20)`, async () => {
    let cancel: AbortController | undefined;
    const f = await fixture(async () => {
      cancel?.abort();
      return response("", "401 rejected");
    });
    const registered: Record<string, unknown> = {};
    let shutdown: ((event: unknown, ctx: ExtensionContext) => Promise<void>) | undefined;
    extension({
      registerTool(tool: { name: string }) {
        registered[tool.name] = tool;
      },
      ...(modern ? { registerMcpServer() {} } : {}),
      on(name: string, handler: typeof shutdown) {
        if (name === "session_shutdown") shutdown = handler;
      },
    } as unknown as ExtensionAPI);
    const tool = registered.intelli_search as {
      execute(
        id: string,
        params: unknown,
        signal: AbortSignal | undefined,
        update: undefined,
        ctx: ExtensionContext,
      ): Promise<Result>;
    };
    try {
      for (const aborted of [false, true]) {
        cancel = aborted ? new AbortController() : undefined;
        const verdict = await hostToolBoundary(
          () => tool.execute("host", { query: "error" }, cancel?.signal, undefined, f.ctx),
          modern,
        );
        assert.equal(
          verdict.isError,
          true,
          "the host never records a failure/cancellation as success",
        );
        if (modern) {
          assert(verdict.result);
          assert.equal(
            receipt(verdict.result).accounting.parentDelivery,
            aborted ? "unknown" : "available",
          );
          assert.equal(verdict.result.usage.input, 9);
        } else {
          assert(verdict.error instanceof NativeExecutionError);
          assert.equal(
            verdict.error.execution.accounting.parentDelivery,
            "unknown",
            "thrown partial fields are local, not proven host delivery",
          );
          assert.equal(verdict.error.execution.accounting.attempts, 1);
          assert.equal(verdict.error.usage.input, 9);
          assert(verdict.error.data);
          assert(Check(standaloneOutputSchemas.intelli_search, verdict.error.data));
          assert.equal(verdict.error.data.accounting.parentDelivery, "unknown");
          assert.equal(verdict.error.data.outcome, aborted ? "aborted" : "error");
        }
      }
    } finally {
      await shutdown?.({}, f.ctx);
      await f.cleanup();
    }
  });
}

test("invalid generation pacing stays fail-closed with an actionable cause on every registered call (T03/T10)", async () => {
  const f = await fixture(async () => response("answer"));
  try {
    for (const value of [-1, "250", true, 0.5, 120_001]) {
      await f.saveSettings({ minRequestIntervalMs: value });
      const ctx = f.makeContext(String(value));
      await assert.rejects(
        f.runtime.start(ctx),
        /pi-intelli-search.minRequestIntervalMs.*intelliMinRequestIntervalMs.*integer between 0 and 120000.*reload/,
      );
      await assert.rejects(
        f.run("intelli_search", { query: "bad pacing" }, undefined, ctx),
        /pi-intelli-search.minRequestIntervalMs.*intelliMinRequestIntervalMs.*integer between 0 and 120000.*reload/,
      );
    }
    await f.saveSettings({ minRequestIntervalMs: 0 });
    const valid = f.makeContext("valid");
    await f.runtime.start(valid);
    assert(!(await f.run("intelli_search", { query: "recovered" }, undefined, valid)).isError);
  } finally {
    await f.cleanup();
  }
});

test("configured native capacity is captured per generation and retains the critical reserve (T03/T10/T12)", async () => {
  const entered = deferred();
  const release = deferred();
  let pages = 0;
  const f = await fixture(
    async (context) => {
      if (context.systemPrompt === EXTRACTION_SYSTEM_PROMPT) {
        if (++pages === 1) entered.resolve();
        await release.promise;
        return response("extracted");
      }
      return response("critical");
    },
    {},
    { execution: { modelConcurrency: 2, aggregateFetchConcurrency: 1 } },
  );
  let pending: Promise<Result>[] = [];
  try {
    await f.runtime.start(f.ctx);
    await f.saveSettings({ execution: { modelConcurrency: 64, aggregateFetchConcurrency: 32 } });
    pending = Array.from({ length: 3 }, () =>
      f.run("intelli_extract", { ...page, query: "capacity" }),
    );
    await entered.promise;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(pages, 1, "current generation does not reload coordinator settings per operation");
    const critical = await f.run("intelli_search", { query: "reserved" });
    assert.equal(
      receipt(critical).accounting.attempts,
      1,
      "critical work can use the reserved slot",
    );
    release.resolve();
    const results = await Promise.all(pending);
    assert.equal(pages, 3);
    assert(results.every((result) => receipt(result).attempts.length === 1));
    assert.equal(new Set(results.map((result) => receipt(result).operationId)).size, 3);
    const successor = f.makeContext("larger");
    await f.runtime.start(successor);
    assert(!(await f.run("intelli_search", { query: "successor" }, undefined, successor)).isError);
  } finally {
    release.resolve();
    await Promise.allSettled(pending);
    await f.cleanup();
  }
});

test("invalid native execution and deprecated pacing fail before inference, then recover (T03/T10)", async () => {
  let calls = 0;
  const f = await fixture(async () => {
    calls++;
    return response("answer");
  });
  try {
    for (const execution of [
      { modelConcurrency: 1 },
      { criticalReserve: 2 },
      { deadline: { enabled: true } },
      { secret: "not-echoed" },
    ]) {
      await f.saveSettings({ execution });
      const ctx = f.makeContext(JSON.stringify(execution));
      await assert.rejects(f.runtime.start(ctx), /pi-intelli-search.execution/);
      await assert.rejects(
        f.run("intelli_search", { query: "invalid" }, undefined, ctx),
        /pi-intelli-search.execution/,
      );
    }
    await writeFile(
      join(f.agent, "settings.json"),
      JSON.stringify({ intelliMinRequestIntervalMs: 0.5 }),
    );
    invalidateSettingsCache();
    const flat = f.makeContext("flat");
    await assert.rejects(
      f.runtime.start(flat),
      /pi-intelli-search.minRequestIntervalMs.*intelliMinRequestIntervalMs.*integer between 0 and 120000.*reload/,
    );
    assert.equal(calls, 0);
    await f.saveSettings({ execution: { modelConcurrency: 2 }, minRequestIntervalMs: 0 });
    const recovered = f.makeContext("recovered");
    await f.runtime.start(recovered);
    assert(!(await f.run("intelli_search", { query: "valid" }, undefined, recovered)).isError);
    assert.equal(calls, 1);
  } finally {
    await f.cleanup();
  }
});

test("registered standalone full data and correlated progress consume captured capacity without leaking supplied bodies (T12/T17/T20)", async () => {
  const f = await fixture(
    async () => response("Facts [Docs](https://docs.example/page)"),
    {},
    {
      execution: { modelConcurrency: 3 },
      extractionConcurrency: 9,
    },
  );
  try {
    await f.runtime.start(f.ctx);
    await f.saveSettings({ execution: { modelConcurrency: 64 } });
    for (const name of ["intelli_search", "intelli_extract"] as const) {
      const before = f.updates.length;
      const result = await f.run(name, { ...page, query: "full", content: "RAW_PAGE_SENTINEL" });
      const data = result.details!.intelli as FullData;
      assert(Check(standaloneOutputSchemas[name], data));
      assert.equal(
        data.counts.effectivePageConcurrency,
        2,
        "captured generation, not reloaded settings",
      );
      assert.equal(data.text, result.content[0].text);
      assert.equal(data.counts.fetched, 0);
      assert.equal(data.accounting.attempts, 1);
      assert.deepEqual(data.attempts, receipt(result).attempts);
      assert.deepEqual(data.accounting, receipt(result).accounting);
      assert(!JSON.stringify(data).includes("RAW_PAGE_SENTINEL"));
      assert.equal(data.details.intelli, undefined);
      const updates = f.updates
        .slice(before)
        .map((update) => (update as { details: Progress }).details);
      assert.deepEqual(
        updates.map((event) => [event.sequence, event.event, event.pct]),
        [
          [1, "start", 0],
          [2, "end", 100],
        ],
      );
      assert(updates.every((event) => event.operationId === data.operationId));
    }
  } finally {
    await f.cleanup();
  }
});

test("standalone final data waits for cleanup and contains progress renderer failures (T04/T17/T20)", async () => {
  let now = 0;
  const clock: Clock = {
    monotonicMs: () => now,
    utcIso: () => "2026-10-20T00:00:00.000Z",
    schedule() {
      throw new Error("no standalone timeout");
    },
    async sleep() {},
  };
  const entered = deferred();
  const release = deferred();
  const f = await fixture(async () => response("Answer"), {
    clock,
    createRuns: () =>
      ({
        async settle() {
          entered.resolve();
          await release.promise;
          now = 71;
        },
      }) as import("../src/core/contracts.js").RunStore,
  });
  try {
    const pending = f.runtime.execute(
      "intelli_search",
      { query: "settlement" },
      undefined,
      () => {
        throw new Error("renderer gone");
      },
      f.ctx,
    );
    await entered.promise;
    let done = false;
    void pending.then(() => {
      done = true;
    });
    await Promise.resolve();
    assert.equal(done, false);
    release.resolve();
    const result = await pending;
    const data = result.details!.intelli as FullData;
    assert.equal(data.timing.allWorkSettledMs, 71);
    assert.equal(
      receipt(result).diagnostics.filter((d) => d.code === "PROGRESS_DELIVERY_FAILED").length,
      2,
    );
    assert.equal(result.isError, undefined);
  } finally {
    release.resolve();
    await f.cleanup();
  }
});

test("cleanup failure preserves completed standalone evidence in settled partial data (T17)", async () => {
  const f = await fixture(async () => response("Successful extraction"), {
    createRuns: () =>
      ({
        async settle() {
          throw new Error("cleanup failed");
        },
      }) as unknown as import("../src/core/contracts.js").RunStore,
  });
  try {
    const result = await f.run("intelli_extract", { ...page, query: "partial" });
    assert(result.isError);
    const data = result.details!.intelli as FullData;
    assert(Check(standaloneOutputSchemas.intelli_extract, data));
    assert.equal(data.outcome, "error");
    assert.equal(data.sources[0].extraction, "Successful extraction");
    assert.equal(data.sources[0].state, "used");
    assert.equal(data.counts.extracted, 1);
    assert.equal(data.counts.failed, 0);
    assert.equal(data.attempts[0].state, "succeeded");
    assert.equal(data.details.extraction, "Successful extraction");
    assert.equal((result.details as Record<string, unknown>).extraction, data.details.extraction);
  } finally {
    await f.cleanup();
  }
});

test("superseded standalone projection cannot deliver a late end into the successor (T10/T20)", async () => {
  const started = deferred();
  const release = deferred();
  let first = true;
  const f = await fixture(async () => {
    if (first) {
      first = false;
      started.resolve();
      await release.promise;
    }
    return response("Facts");
  });
  try {
    const old = f.run("intelli_extract", { ...page, query: "old" });
    await started.promise;
    const next = f.makeContext("successor");
    const replacement = f.runtime.start(next);
    release.resolve();
    const result = await old;
    await replacement;
    const oldId = receipt(result).operationId;
    await f.run("intelli_search", { query: "new" }, undefined, next);
    const events = f.updates.map((value) => (value as { details: Progress }).details);
    assert.deepEqual(
      events.filter((event) => event.operationId === oldId).map((event) => event.event),
      ["start"],
    );
    assert.deepEqual(
      events.filter((event) => event.operationId !== oldId).map((event) => event.event),
      ["start", "end"],
    );
    assert.equal((result.details!.intelli as FullData).outcome, "aborted");
  } finally {
    release.resolve();
    await f.cleanup();
  }
});

test("registered standalone page-queue BUSY has zero-attempt full error data on capable and older hosts (T12/T17)", async () => {
  for (const modern of [true, false]) {
    const release = deferred();
    let extractions = 0;
    const f = await fixture(
      async (context) => {
        if (context.systemPrompt === SEARCH_SYSTEM_PROMPT)
          return response(
            Array.from({ length: 80 }, (_, i) => `[Page ${i}](https://docs.example/${i})`).join(
              " ",
            ),
          );
        extractions++;
        await release.promise;
        return response("Facts");
      },
      {
        supportsErrorResults: modern,
        pageTransport: markdownPage(),
      },
      {
        maxUrls: 80,
        defaultUrls: 80,
        fetchConcurrency: 80,
        extractionConcurrency: 63,
        execution: { modelConcurrency: 64 },
      },
    );
    await f.runtime.start(f.ctx);
    // Exactly 511 page attempts: 63 active and the 448 permitted queued
    // positions. Unlike the former whole-page injection, real spooling is async.
    const allSubmitted = deferred();
    let submitted = 0;
    const push = f.updates.push.bind(f.updates);
    f.updates.push = (...values) => {
      for (const value of values) {
        const event = (value as { details?: Progress }).details;
        if (event?.workStage === "extract" && /^Extracting S/.test(event.message)) {
          if (++submitted === 511) allSubmitted.resolve();
        }
      }
      return push(...values);
    };
    const controllers = Array.from({ length: 9 }, () => new AbortController());
    const floods = controllers.map((controller, i) =>
      f
        .run(
          "intelli_research",
          { query: `queue ${i}`, maxUrls: i < 8 ? 63 : 7 },
          controller.signal,
        )
        .catch((error: unknown) => error),
    );
    try {
      await allSubmitted.promise;
      // Auth is an already-fulfilled fixture promise. Drain its finite microtask
      // population after the explicit submission witness, not a wall-time guess.
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(extractions, 63);
      assert.equal(submitted, 511);
      const result = await f
        .run("intelli_extract", { ...page, query: "busy" })
        .catch((error: unknown) => error);
      const data =
        result instanceof NativeExecutionError
          ? result.data
          : ((result as Result).details!.intelli as FullData);
      assert(data);
      assert(Check(standaloneOutputSchemas.intelli_extract, data));
      assert.equal(data.outcome, "error");
      assert.equal(data.accounting.attempts, 0);
      assert.deepEqual(data.attempts, []);
      assert.equal(data.accounting.observedAttempts, 0);
      assert.equal(data.accounting.missingAttempts, 0);
      assert(
        Object.values(data.accounting.tokens).every((value) => value === 0),
        "accepted ledger zero-attempt summary, not a provider observation",
      );
      assert.equal(data.accounting.parentDelivery, modern ? "available" : "unknown");
      assert.equal(extractions, 63, "rejected standalone ticket never dispatched");
      if (modern) assert((result as Result).isError);
      else assert(result instanceof NativeExecutionError);
    } finally {
      controllers.forEach((controller) => controller.abort());
      release.resolve();
      await Promise.all(floods);
      await f.cleanup();
    }
  }
});

test("registered native inference source gate excludes legacy context/client/harness construction", async () => {
  const entry = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.match(entry, /createRegisteredNativeTools\(native\)/);
  const registered = await readFile(
    new URL("../src/native-registered-tools.ts", import.meta.url),
    "utf8",
  );
  assert.match(registered, /runtime\.execute\(name, params, signal, onUpdate, ctx\)/);
  for (const name of ["search", "extract", "collate", "research"])
    assert(registered.includes(`execute("intelli_${name}")`));
  const source = await readFile(
    new URL("../src/native-operation-runtime.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /modelConcurrency: execution\.modelConcurrency/);
  assert.match(source, /criticalReserve: execution\.criticalReserve/);
  assert.match(source, /fetchConcurrency: execution\.aggregateFetchConcurrency/);
  assert.match(source, /createScopedNativeModelClient\(modelContext, services/);
  assert.match(source, /captured\.runtime!\.run\(/);
  for (const operation of ["search", "extract", "collate"])
    assert.match(source, new RegExp(`boundary!\\.run\\(\\s*\\(\\) =>\\s*${operation}\\(`));
  assert(!/createStandaloneResult|createCollateResult/.test(source));
  const collateSource = await readFile(
    new URL("../src/core/collate-result.ts", import.meta.url),
    "utf8",
  );
  assert.match(collateSource, /completeOperationModel\(context, "collate",/);
  assert(!/\bmodels\.complete\s*\(/.test(collateSource));
  assert.match(source, /boundary\?\.settled\(\)/);
  assert(
    !/\b(createNativeOperationContext|createNativeModelClient|__harness|callLlm)\b/.test(source),
  );
  for (const name of ["search", "extract", "collate", "research"]) {
    const operation = await readFile(
      new URL(`../src/core/operations/${name}.ts`, import.meta.url),
      "utf8",
    );
    assert(!/\bmodels\.complete\s*\(/.test(operation));
    assert(operation.includes("completeOperationModel("));
    if (name !== "research") assert(operation.includes("produceCoreResult("));
  }
});

test("registered native collate publishes supplied identities and settled full data without touching legacy research (T07/T17/T20/T22)", async () => {
  const f = await fixture(
    async (context, options) => {
      assert.equal(context.systemPrompt, COLLATION_SYSTEM_PROMPT);
      assert.equal(options.maxRetries, 0);
      assert(
        !JSON.stringify(context).includes("RAW_") && !JSON.stringify(context).includes("password"),
      );
      return response("Facts [S2] and [S4].");
    },
    {},
    {
      collateModel: {
        provider: "openrouter",
        model: "same-model",
        comment: "cheap",
        apiKey: "DO_NOT_PERSIST_SENTINEL",
      },
    },
  );
  try {
    const result = await f.run("intelli_collate", suppliedCollation());
    const data = result.details!.intelli as FullData;
    assert(Check(collateOutputSchema, data));
    assert.equal(data.text, result.content[0].text);
    assert.equal(data.accounting.attempts, 1);
    assert.deepEqual(data.attempts, receipt(result).attempts);
    assert.equal(data.counts.fetched, 0);
    assert.equal(data.counts.used, 2);
    assert(!JSON.stringify(data).includes("RAW_"));
    const proof = await verifyCollateData(f.root, data);
    assert.deepEqual(proof.manifest.provenance.models.collate, {
      provider: "openrouter",
      model: "same-model",
    });
    assert(!JSON.stringify(proof.manifest).includes("DO_NOT_PERSIST_SENTINEL"));
    assert(!("intelli" in data.details));
    assert.equal(f.updates.length, 4);
  } finally {
    await f.cleanup();
  }
});

test("native collate forwards real store diagnostics once into full data and the UI", async () => {
  const f = await fixture(async () => response("Useful summary [S1]."));
  try {
    const namespace = join(f.root, ".search", ".intelli-v1");
    await mkdir(namespace, { recursive: true });
    await writeFile(join(namespace, "namespace.json"), "{}");
    const result = await f.run("intelli_collate", {
      query: "Q",
      extractions: [
        {
          url: "label",
          title: "Docs",
          extraction: "Useful facts",
          sourceType: "official",
          status: "success",
        },
      ],
    });
    const data = result.details!.intelli as FullData;
    assert.equal(data.outcome, "completed");
    assert.equal(data.cache.status, "unavailable");
    if (data.cache.status === "unavailable") {
      const diagnostic = data.cache.diagnostic;
      assert(
        receipt(result).diagnostics.some(
          (item) => item.code === diagnostic.code && item.message === diagnostic.message,
        ),
      );
      assert.equal(f.notices.filter((message) => message.includes(diagnostic.message)).length, 1);
    }
  } finally {
    await f.cleanup();
  }
});

test("native collate cleanup diagnostics stay separate from persistence diagnostics (T04/T17)", async () => {
  let root = "";
  const f = await fixture(async () => response("Facts [S2] and [S4]."), {
    createRuns: ({ clock }) => {
      const store = createRunStore({
        workspaceRoot: root,
        cacheRoot: join(root, ".search"),
        displayRoot: ".search",
        clock,
        randomId: () => "0123456789abcdef",
        onDiagnostic() {},
      });
      return {
        ...store,
        async settle() {
          await store.settle();
          throw new Error("cleanup fault");
        },
      };
    },
  });
  root = f.root;
  try {
    const result = await f.run("intelli_collate", suppliedCollation());
    assert(result.isError);
    const data = result.details!.intelli as FullData;
    assert(Check(collateOutputSchema, data));
    assert.equal(data.outcome, "error");
    assert(data.cache.status === "committed");
    assert.equal(data.cache.diagnostic, undefined);
    assert(receipt(result).diagnostics.some((d) => d.code === "OPERATION_CLEANUP_FAILED"));
    await verifyCollateData(f.root, data);
  } finally {
    await f.cleanup();
  }
});

test("native collate replacement drains its active attempt and suppresses stale completion (T05/T10/T17/T20)", async () => {
  const entered = deferred();
  const release = deferred();
  const f = await fixture(async () => {
    entered.resolve();
    await release.promise;
    return response("Facts [S2] and [S4].");
  });
  try {
    const pending = f.run("intelli_collate", suppliedCollation());
    await entered.promise;
    const successor = f.makeContext("replacement");
    let enabled = false;
    const replacing = f.runtime.start(successor).then(() => {
      enabled = true;
    });
    await Promise.resolve();
    assert.equal(enabled, false);
    const before = f.updates.length;
    release.resolve();
    const old = await pending;
    await replacing;
    const data = old.details!.intelli as FullData;
    assert(Check(collateOutputSchema, data));
    assert.equal(data.outcome, "aborted");
    assert.equal(data.accounting.parentDelivery, "unknown");
    assert.equal(data.accounting.attempts, 1);
    assert.equal(f.updates.length, before);
    await f.runtime.shutdown(f.ctx);
    const fresh = await f.run("intelli_collate", suppliedCollation(), undefined, successor);
    assert.equal((fresh.details!.intelli as FullData).outcome, "completed");
  } finally {
    release.resolve();
    await f.cleanup();
  }
});

test("native collate zero-input and BUSY-coded allocation faults retain zero-attempt errors on capable and older hosts (T17)", async () => {
  for (const modern of [true, false]) {
    for (const busy of [false, true]) {
      let attempts = 0;
      const f = await fixture(
        async () => {
          attempts++;
          return response("Unexpected");
        },
        {
          supportsErrorResults: modern,
          ...(busy
            ? {
                createRuns: () =>
                  ({
                    async allocate() {
                      throw Object.assign(new Error("Resource busy"), { code: "BUSY" });
                    },
                    async settle() {},
                  }) as unknown as import("../src/core/contracts.js").RunStore,
              }
            : {}),
        },
      );
      try {
        const result = await f
          .run("intelli_collate", busy ? suppliedCollation() : { query: "Empty", extractions: [] })
          .catch((e: unknown) => e);
        const data =
          result instanceof NativeExecutionError
            ? result.data
            : ((result as Result).details!.intelli as FullData);
        assert(data && Check(collateOutputSchema, data));
        assert.equal(data.outcome, "error");
        assert.equal(data.accounting.attempts, 0);
        assert.equal(data.accounting.parentDelivery, modern ? "available" : "unknown");
        assert.equal(attempts, 0);
        if (modern) assert((result as Result).isError);
        else assert(result instanceof NativeExecutionError);
      } finally {
        await f.cleanup();
      }
    }
  }
});

test("unused legacy fetch settings preserve manual tools; research rejects invalid consumed settings before inference", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("network forbidden");
  });
  const f = await fixture(
    async (context) => {
      if (context.systemPrompt === SEARCH_SYSTEM_PROMPT) return response(`[Docs](${page.url})`);
      if (context.systemPrompt === EXTRACTION_SYSTEM_PROMPT)
        return response("Official docs, current.\nFacts");
      if (context.systemPrompt === COLLATION_SYSTEM_PROMPT) return response("Answer [S1]");
      return response("[]");
    },
    {
      pageTransport: markdownPage(page.content),
    },
    { fetchTimeoutMs: 900_000, fetchConcurrency: 1.5 },
  );
  try {
    for (const [name, params] of [
      ["intelli_search", { query: "Search" }],
      ["intelli_extract", { ...page, query: "Extract" }],
      [
        "intelli_collate",
        {
          query: "Collate",
          extractions: [
            {
              url: page.url,
              title: page.title,
              extraction: "Facts",
              sourceType: "docs",
              status: "success",
            },
          ] as OperationInputs["intelli_collate"]["extractions"],
        },
      ],
    ] as const) {
      const result = await f.run(name, params);
      assert(!result.isError, `${name} remains unaffected by unused fetch settings`);
      assert(receipt(result).accounting.attempts > 0);
    }
    await assert.rejects(
      f.run("intelli_research", { query: "Research", maxUrls: 1 }),
      /pi-intelli-search.fetchConcurrency/,
    );
  } finally {
    await f.cleanup();
  }
});
