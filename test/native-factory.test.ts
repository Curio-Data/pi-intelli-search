// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import { createNativeExtension } from "../src/index.js";
import {
  captureNativeInjection,
  type NativeTestInjection,
  type RegistryStreamSimple,
} from "../src/native-injection.js";
import { search } from "../src/core/operations/search.js";
import type { FullData } from "../src/core/contracts.js";
import { clearMigrationContext, invalidateSettingsCache } from "../src/settings.js";

const model: Model<"openai-completions"> = {
  id: "factory",
  name: "Factory fixture",
  provider: "fixture",
  api: "openai-completions",
  baseUrl: "https://fixture.invalid",
  reasoning: false,
  input: ["text"],
  contextWindow: 100_000,
  maxTokens: 1000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const reply = (text: string): AssistantMessage => ({
  role: "assistant",
  provider: model.provider,
  api: model.api,
  model: model.id,
  content: [{ type: "text", text }],
  stopReason: "stop",
  timestamp: 1,
  usage: {
    input: 5,
    output: 2,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 7,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
});
const page = async (url: string) => ({ url, status: 200, headers: new Headers(), body: null });

test("transport-replay factory rejects whole-operation/context substitutes and incomplete transports at runtime", () => {
  const stream: RegistryStreamSimple = async () => reply("unused");
  for (const invalid of [
    { mode: "transport-replay", registryStreamSimple: stream },
    { mode: "transport-replay", pageTransport: page },
    { mode: "transport-replay", registryStreamSimple: stream, pageTransport: page, operations: {} },
    {
      mode: "transport-replay",
      registryStreamSimple: stream,
      pageTransport: page,
      transformContext: (context: unknown) => context,
    },
    { mode: "unknown" },
    { registryStreamSimple: 42 },
    { operations: { search: 42 } },
  ])
    assert.throws(() => createNativeExtension(invalid as unknown as NativeTestInjection));
  const captured = captureNativeInjection({
    mode: "transport-replay",
    registryStreamSimple: stream,
    pageTransport: page,
  });
  assert(Object.isFrozen(captured));
  assert.equal(captured.mode, "transport-replay");
});

test("factory capture is immutable across registrations and retains real scoped standalone policy (T10/T15/T30)", async (t) => {
  await mkdir(resolve(".tmp"), { recursive: true });
  const root = await mkdtemp(resolve(".tmp/native-factory-"));
  const saved = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  invalidateSettingsCache();
  clearMigrationContext();
  const settings = { provider: model.provider, model: model.id };
  await writeFile(
    join(root, "settings.json"),
    JSON.stringify({
      "pi-intelli-search": {
        searchModel: settings,
        extractModel: settings,
        collateModel: settings,
        disableTelemetry: true,
        disableLlmsFullDiscovery: true,
      },
    }),
  );
  const shutdowns: (() => Promise<void>)[] = [];
  t.after(async () => {
    for (const shutdown of shutdowns) await shutdown();
    if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = saved;
    invalidateSettingsCache();
    clearMigrationContext();
    await rm(root, { recursive: true, force: true });
  });
  let calls = 0;
  let transformed = 0;
  let operationCalls = 0;
  let authCalls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("network forbidden");
  });
  const stream: RegistryStreamSimple = async (_registry, _model, _context, options) => {
    calls++;
    assert.equal(options?.maxRetries, 0);
    assert(options?.signal);
    await options?.onProviderStreamEvent?.(
      {
        usage: {
          prompt_tokens: 5,
          completion_tokens: 2,
          cache_write_tokens: 0,
          prompt_tokens_details: { cached_tokens: 0 },
          cost: 0.01,
        },
      },
      model,
    );
    return reply("captured answer");
  };
  const operations = {
    search: async (...args: Parameters<typeof search>) => {
      operationCalls++;
      return search(...args);
    },
  };
  const injection = {
    mode: "unit" as const,
    operations,
    registryStreamSimple: stream,
    transformContext: (context: Parameters<typeof search>[1]) => {
      transformed++;
      return context;
    },
  };
  const extension = createNativeExtension(injection);
  injection.registryStreamSimple = async () => {
    throw new Error("mutated transport");
  };
  injection.transformContext = () => {
    throw new Error("mutated context");
  };
  operations.search = async () => {
    throw new Error("mutated operation");
  };
  const other = createNativeExtension({ registryStreamSimple: async () => reply("other answer") });
  const make = (factory: typeof extension) => {
    const tools = new Map<
      string,
      { executionMode?: string; execute: (...args: unknown[]) => Promise<{ details: { intelli: FullData } }> }
    >();
    const handlers = new Map<
      string,
      (event: unknown, context: ExtensionContext) => Promise<void>
    >();
    factory({
      registerTool: (tool: { name: string }) => tools.set(tool.name, tool as never),
      registerMcpServer() {},
      on: (name: string, handler: (event: unknown, context: ExtensionContext) => Promise<void>) =>
        handlers.set(name, handler),
    } as unknown as ExtensionAPI);
    const ctx = {
      cwd: root,
      hasUI: false,
      isProjectTrusted: () => false,
      sessionManager: { getSessionId: () => "factory" },
      ui: {},
      modelRegistry: {
        find: () => model,
        streamSimple: () => {
          throw new Error("live facade must not dispatch");
        },
        getApiKeyAndHeaders: async () => {
          authCalls++;
          return { ok: true, apiKey: "fixture-not-a-secret" };
        },
      },
    } as unknown as ExtensionContext;
    shutdowns.push(() => handlers.get("session_shutdown")!({}, ctx));
    assert.deepEqual(
      [...tools.keys()],
      ["intelli_search", "intelli_extract", "intelli_collate", "intelli_research"],
    );
    assert.equal(tools.get("intelli_research")!.executionMode, "parallel");
    assert.equal(tools.get("intelli_collate")!.executionMode, "sequential");
    return () =>
      tools
        .get("intelli_search")!
        .execute("host-id", { query: "fixture" }, undefined, undefined, ctx);
  };
  const timer = t.mock.method(globalThis, "setTimeout");
  const first = make(extension);
  const second = make(extension);
  const third = make(other);
  assert.equal(timer.mock.callCount(), 0, "registration starts no timers");
  const a = await first();
  const b = await second();
  const c = await third();
  assert.match(a.details.intelli.text, /captured answer/);
  assert.equal(b.details.intelli.text, a.details.intelli.text);
  assert.match(c.details.intelli.text, /other answer/);
  assert.equal(calls, 2);
  assert.equal(operationCalls, 2);
  assert.equal(transformed, 2);
  assert.equal(authCalls, 3);
  for (const result of [a, b]) {
    assert.equal(result.details.intelli.accounting.attempts, 1);
    assert.equal(result.details.intelli.accounting.reportedCost.total, 0.01);
  }
});
