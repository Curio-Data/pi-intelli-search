// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// M4 native floor qualification helpers.
//
// The floor is the exact `Pi` version named by the package manifest's peer
// range, installed by scripts/qualify-native-floor.mts into an owned
// directory below the repository's encrypted .tmp/. It is never upgraded and
// never silently replaced: a missing or different installation fails, and a
// deliberately different host must be named through NATIVE_FLOOR_HOST, which
// labels every record as an explicit control rather than floor evidence.
//
// The floor's npm-shrinkwrap.json nests pi-ai and pi-agent-core below the
// coding-agent package, so this module resolves them from the selected host
// instead of assuming the sibling layout of a hoisted installation.

import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Api, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { FIXTURE_API_KEY, MAIN_API, MAIN_BASE_URL, MAIN_PROVIDER, REPO_ROOT } from "./native-replay.js";
import type { MainFixture, MainTurn } from "./native-replay.js";

export const FLOOR_INSTALL_PARENT = join(REPO_ROOT, ".tmp/m4-floor/host");
const PEERS = ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"];

/** The single `>=X.Y.Z` floor shared by every `Pi` peer in the manifest. */
export async function manifestFloor(): Promise<string> {
  const manifest = JSON.parse(await readFile(join(REPO_ROOT, "package.json"), "utf8")) as {
    peerDependencies?: Record<string, string>;
  };
  const floors = PEERS.map((name) => {
    const range = manifest.peerDependencies?.[name];
    const match = range ? /^>=(\d+\.\d+\.\d+)$/.exec(range) : null;
    if (!match) throw new Error(`peer ${name} has no exact >=X.Y.Z floor: ${String(range)}`);
    return match[1]!;
  });
  if (new Set(floors).size !== 1) throw new Error(`peer floors disagree: ${floors.join(", ")}`);
  return floors[0]!;
}

export const floorInstallDir = (version: string) => join(FLOOR_INSTALL_PARENT, version);

export interface FloorHost {
  readonly root: string;
  readonly version: string;
  readonly manifestFloor: string;
  /** Owned exact floor install, or a host the operator named explicitly as a control. */
  readonly kind: "owned-floor" | "explicit-control";
  readonly piAiRoot: string;
  readonly piAiVersion: string;
  readonly agentCoreRoot: string;
  readonly agentCoreVersion: string;
}

async function packageAt(root: string): Promise<{ name: string; version: string }> {
  return JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
    name: string;
    version: string;
  };
}

/** A dependency of the host package: nested (shrinkwrap layout) first, then sibling. */
async function hostDependency(hostRoot: string, name: string): Promise<string> {
  for (const candidate of [
    join(hostRoot, "node_modules/@earendil-works", name),
    join(hostRoot, "..", name),
  ]) {
    try {
      await access(join(candidate, "package.json"));
      return candidate;
    } catch {
      /* Try the next layout. */
    }
  }
  throw new Error(`${hostRoot} has no resolvable @earendil-works/${name}`);
}

export async function selectFloorHost(): Promise<FloorHost> {
  const floor = await manifestFloor();
  const explicit = process.env.NATIVE_FLOOR_HOST;
  const root =
    explicit || join(floorInstallDir(floor), "node_modules/@earendil-works/pi-coding-agent");
  let manifest: { name: string; version: string };
  try {
    manifest = await packageAt(root);
  } catch (error) {
    throw new Error(
      explicit
        ? `NATIVE_FLOOR_HOST ${root} is not a readable package root: ${String(error)}`
        : `Owned floor Pi ${floor} is not installed at ${root}. ` +
            `Run: node --import tsx scripts/qualify-native-floor.mts install`,
    );
  }
  if (manifest.name !== "@earendil-works/pi-coding-agent")
    throw new Error(`${root} is not @earendil-works/pi-coding-agent`);
  if (!explicit && manifest.version !== floor)
    throw new Error(`owned floor install reports ${manifest.version}, manifest floor is ${floor}`);
  const piAiRoot = await hostDependency(root, "pi-ai");
  const agentCoreRoot = await hostDependency(root, "pi-agent-core");
  return {
    root,
    version: manifest.version,
    manifestFloor: floor,
    kind: explicit ? "explicit-control" : "owned-floor",
    piAiRoot,
    piAiVersion: (await packageAt(piAiRoot)).version,
    agentCoreRoot,
    agentCoreVersion: (await packageAt(agentCoreRoot)).version,
  };
}

type HostModule = typeof import("@earendil-works/pi-coding-agent");

export async function importFloorHost(host: FloorHost): Promise<HostModule> {
  return (await import(pathToFileURL(join(host.root, "dist/index.js")).href)) as HostModule;
}

// ── Static capability surface ───────────────────────────────────────────────

export interface StaticCapabilities {
  readonly hostExports: readonly string[];
  /** Later Codemode/MCP/tool-search factories; absent at the floor. */
  readonly laterFactories: Readonly<Record<string, boolean>>;
  /** The host's OpenAI-completions adapter source names the pre-normalisation stream hook. */
  readonly completionsStreamHook: boolean;
  /** The same adapter forwards options.fetch to its client (the fetch-tee channel). */
  readonly completionsFetchOption: boolean;
  /** pi-agent-core honours a returned `isError` (later hosts) rather than only thrown errors. */
  readonly loopHonoursReturnedIsError: boolean;
}

export async function staticCapabilities(
  host: FloorHost,
  module: HostModule,
): Promise<StaticCapabilities> {
  const hostExports = Object.keys(module).sort();
  const completions = await readFile(join(host.piAiRoot, "dist/api/openai-completions.js"), "utf8");
  const loop = await readFile(join(host.agentCoreRoot, "dist/agent-loop.js"), "utf8");
  return {
    hostExports,
    laterFactories: Object.fromEntries(
      ["createCodemodeExtension", "createMcpExtension", "createToolSearchExtension"].map((name) => [
        name,
        hostExports.includes(name),
      ]),
    ),
    completionsStreamHook: completions.includes("onProviderStreamEvent"),
    completionsFetchOption: /options\?\.fetch/.test(completions),
    loopHonoursReturnedIsError: /result\.isError === true/.test(loop),
  };
}

// ── Registry facade observer ────────────────────────────────────────────────

export interface FacadeCall {
  readonly provider: string;
  readonly model: string;
  readonly systemPrompt: boolean;
  readonly fetchOption: boolean;
  readonly streamHookOption: boolean;
  fetchInvocations: number;
  streamHookInvocations: number;
}

export interface FacadeObserver {
  readonly calls: FacadeCall[];
  reset(): void;
  restore(): void;
}

/**
 * Observation-only wrapper on the host's ModelRegistry.prototype.streamSimple
 * (the facade the native client must use). It records each call and counts
 * invocations of the caller's own `fetch` and `onProviderStreamEvent`
 * options, then delegates to the original method with the same behaviour.
 * It never answers, alters or replaces a request.
 */
export function observeRegistryFacade(module: HostModule): FacadeObserver {
  const proto = (module.ModelRegistry as unknown as { prototype: Record<string, unknown> })
    .prototype;
  const original = proto.streamSimple as (
    this: unknown,
    model: Model<Api>,
    context: { systemPrompt?: unknown },
    options?: SimpleStreamOptions,
  ) => unknown;
  if (typeof original !== "function") throw new Error("host ModelRegistry has no streamSimple facade");
  const calls: FacadeCall[] = [];
  proto.streamSimple = function (
    this: unknown,
    model: Model<Api>,
    context: { systemPrompt?: unknown },
    options?: SimpleStreamOptions,
  ) {
    const call: FacadeCall = {
      provider: model.provider,
      model: model.id,
      systemPrompt: typeof context?.systemPrompt === "string" && context.systemPrompt.length > 0,
      fetchOption: typeof options?.fetch === "function",
      streamHookOption: typeof options?.onProviderStreamEvent === "function",
      fetchInvocations: 0,
      streamHookInvocations: 0,
    };
    calls.push(call);
    const observed: SimpleStreamOptions | undefined = options && {
      ...options,
      ...(options.fetch
        ? {
            fetch: ((...args: Parameters<typeof fetch>) => {
              call.fetchInvocations++;
              return (options.fetch as typeof fetch)(...args);
            }) as typeof fetch,
          }
        : {}),
      ...(options.onProviderStreamEvent
        ? {
            onProviderStreamEvent: (event: unknown, eventModel: Model<Api>) => {
              call.streamHookInvocations++;
              return options.onProviderStreamEvent!(event, eventModel);
            },
          }
        : {}),
    };
    return original.call(this, model, context, observed);
  };
  return {
    calls,
    reset: () => void (calls.length = 0),
    restore: () => {
      proto.streamSimple = original;
    },
  };
}

// ── In-process main fixture for any host layout ─────────────────────────────

const sse = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const chunk = (id: string, delta: unknown, finish: string | null = null, usage?: unknown) => ({
  id,
  object: "chat.completion.chunk",
  created: 0,
  model: "fixture",
  choices: [{ index: 0, delta, finish_reason: finish }],
  ...(usage ? { usage } : {}),
});

function mainSse(turn: MainTurn | undefined, id: string, callPrefix: string): string {
  const parts: string[] = [];
  if (!turn) parts.push(sse(chunk(id, { role: "assistant", content: "script exhausted" })), sse(chunk(id, {}, "stop")));
  else if (turn.toolCalls?.length) {
    turn.toolCalls.forEach((call, index) =>
      parts.push(
        sse(
          chunk(id, {
            role: "assistant",
            tool_calls: [
              {
                index,
                id: `${callPrefix}_${index}`,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.args) },
              },
            ],
          }),
        ),
      ),
    );
    parts.push(sse(chunk(id, {}, "tool_calls", turn.usage)));
  } else
    parts.push(
      sse(chunk(id, { role: "assistant", content: turn.text ?? "" })),
      sse(chunk(id, {}, "stop", turn.usage)),
    );
  parts.push("data: [DONE]\n\n");
  return parts.join("");
}

/**
 * The same credential-free scripted main as native-replay's createMainFixture,
 * resolving the selected host's own `pi-ai` adapter from its actual layout.
 * The main never opens a socket: an injected in-process fetch answers it.
 */
export async function createFloorMainFixture(host: FloorHost): Promise<MainFixture> {
  const completions = (await import(
    pathToFileURL(join(host.piAiRoot, "dist/api/openai-completions.js")).href
  )) as {
    streamSimple: (model: Model<Api>, context: unknown, options?: SimpleStreamOptions) => unknown;
  };
  let turns: readonly MainTurn[] = [];
  let next = 0;
  let fetchCalls = 0;
  let unguarded = 0;
  const rawBodies: string[] = [];
  const inProcessFetch = (async (input: unknown, init?: { body?: unknown }) => {
    fetchCalls++;
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    if (!url.startsWith(MAIN_BASE_URL)) throw new Error(`main fixture received foreign URL ${url}`);
    const body =
      typeof init?.body === "string" ? init.body : await new Response(init?.body as BodyInit).text();
    rawBodies.push(body);
    return new Response(mainSse(turns[next++], `main-${rawBodies.length}`, `call_${rawBodies.length}`), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }) as typeof fetch;
  const factory = (pi: { registerProvider: (name: string, config: unknown) => void }) => {
    pi.registerProvider(MAIN_PROVIDER, {
      baseUrl: MAIN_BASE_URL,
      apiKey: FIXTURE_API_KEY,
      api: MAIN_API,
      models: [
        {
          id: "main",
          name: "main",
          api: MAIN_API,
          reasoning: false,
          input: ["text"],
          contextWindow: 200_000,
          maxTokens: 8_000,
          cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
        },
      ],
      streamSimple: (model: Model<Api>, context: unknown, options?: SimpleStreamOptions) => {
        if (options?.fetch) unguarded++;
        return completions.streamSimple({ ...model, api: "openai-completions" } as Model<Api>, context, {
          ...options,
          fetch: inProcessFetch,
        });
      },
    });
  };
  return {
    factory: factory as never,
    rawBodies,
    fetchCalls: () => fetchCalls,
    unguardedStreams: () => unguarded,
    setScript(script) {
      turns = script;
      next = 0;
      rawBodies.length = 0;
    },
  };
}
