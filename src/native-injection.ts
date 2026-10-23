// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Native-only immutable factory seam. Never exported through the shared core.
import type {
  Api,
  AssistantMessage,
  Context as ProviderContext,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
  Context, EngineOperations, PageTransport, RunReservation, CommittedRun, IndexCandidate,
} from "./core/contracts.js";

export interface NativeSuggestionReadView {
  readonly allocated: (input: {
    readonly operationId: string;
    readonly query: string;
    readonly reservation: RunReservation;
  }) => void;
  readonly indexed: (input: {
    readonly operationId: string;
    readonly run: CommittedRun;
  }) => void;
  readonly unavailable: (input: {
    readonly operationId: string;
    readonly query: string;
    readonly phase: "allocation" | "commit" | "index" | "operation";
  }) => void;
  readonly candidates: (input: {
    readonly operationId: string;
    readonly current: RunReservation | undefined;
    readonly query: string;
    readonly signal: AbortSignal;
    readonly readVerified: () => Promise<readonly IndexCandidate[]>;
  }) => Promise<readonly IndexCandidate[]>;
}

export interface NativeRegistryFacade {
  streamSimple(
    model: Model<Api>,
    context: ProviderContext,
    options?: SimpleStreamOptions,
  ): { result(): Promise<AssistantMessage> };
}
export type RegistryStreamSimple = (
  registry: NativeRegistryFacade,
  model: Model<Api>,
  context: ProviderContext,
  options?: SimpleStreamOptions,
) => Promise<AssistantMessage>;

/** Unit substitutes do not establish complete transport replay. */
export type NativeTestInjection =
  | {
      readonly mode?: "unit";
      readonly operations?: Partial<EngineOperations>;
      readonly transformContext?: (context: Context) => Context;
      readonly registryStreamSimple?: RegistryStreamSimple;
      readonly pageTransport?: PageTransport;
      readonly suggestionReadView?: NativeSuggestionReadView;
    }
  | {
      readonly mode: "transport-replay";
      readonly registryStreamSimple: RegistryStreamSimple;
      readonly pageTransport: PageTransport;
      readonly suggestionReadView?: NativeSuggestionReadView;
      readonly operations?: never;
      readonly transformContext?: never;
    };

/** Default entry is createNativeExtension(); overrides are immutable per loaded runtime. */
export type NativeExtensionFactory = (
  injection?: NativeTestInjection,
) => (pi: ExtensionAPI) => void;

/** Capture supplied function identities before registration or any await. */
export function captureNativeInjection(injection: NativeTestInjection = {}): NativeTestInjection {
  const mode = injection.mode ?? "unit";
  if (mode !== "unit" && mode !== "transport-replay")
    throw new Error("Unknown native injection mode");
  const registryStreamSimple = injection.registryStreamSimple;
  const pageTransport = injection.pageTransport;
  const operations = injection.operations;
  const transformContext = injection.transformContext;
  const suggestionReadView = captureSuggestionReadView(injection.suggestionReadView);
  for (const [name, value] of Object.entries({
    registryStreamSimple,
    pageTransport,
    transformContext,
  }))
    if (value !== undefined && typeof value !== "function")
      throw new Error(`Native injection ${name} must be a function`);
  if (mode === "transport-replay") {
    if (operations !== undefined || transformContext !== undefined)
      throw new Error("Transport replay cannot replace operations or contexts");
    if (!registryStreamSimple || !pageTransport)
      throw new Error("Transport replay requires both model and page transports");
    return Object.freeze({
      mode, registryStreamSimple, pageTransport,
      ...(suggestionReadView ? { suggestionReadView } : {}),
    });
  }
  const captured: Partial<EngineOperations> = {};
  if (operations !== undefined) {
    if (operations === null || typeof operations !== "object")
      throw new Error("Native injection operations must be an object");
    const names = new Set(["search", "extract", "collate", "research", "fetchPage"]);
    for (const [name, value] of Object.entries(operations)) {
      if (!names.has(name) || (value !== undefined && typeof value !== "function"))
        throw new Error("Native injection contains an invalid operation");
      if (value !== undefined) Object.assign(captured, { [name]: value });
    }
  }
  return Object.freeze({
    mode,
    ...(registryStreamSimple ? { registryStreamSimple } : {}),
    ...(pageTransport ? { pageTransport } : {}),
    ...(transformContext ? { transformContext } : {}),
    ...(suggestionReadView ? { suggestionReadView } : {}),
    ...(operations ? { operations: Object.freeze(captured) } : {}),
  });
}

/** Nested controller functions are captured before registration, just like transports. */
export function captureSuggestionReadView(
  value: NativeSuggestionReadView | undefined,
): NativeSuggestionReadView | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object")
    throw new TypeError("Native suggestion read view must be an object");
  const names = ["allocated", "indexed", "unavailable", "candidates"] as const;
  if (Reflect.ownKeys(value).some((name) => !names.includes(name as typeof names[number])))
    throw new TypeError("Native suggestion read view contains an unknown member");
  const captured = {
    allocated: value.allocated,
    indexed: value.indexed,
    unavailable: value.unavailable,
    candidates: value.candidates,
  };
  if (names.some((name) => typeof captured[name] !== "function"))
    throw new TypeError("Native suggestion read view requires all four functions");
  return Object.freeze(captured);
}
