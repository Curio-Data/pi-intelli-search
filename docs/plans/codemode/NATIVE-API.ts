// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
// P0-2 native-only declarations. These types must never enter core/MCP exports.
import type { Api, AssistantMessage, Context as ProviderContext, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Context, EngineOperations, PageTransport } from "./API.js";

export interface NativeRegistryFacade {
  streamSimple(model: Model<Api>, context: ProviderContext, options?: SimpleStreamOptions): { result(): Promise<AssistantMessage> };
}
export type RegistryStreamSimple = (
  registry: NativeRegistryFacade,
  model: Model<Api>,
  context: ProviderContext,
  options?: SimpleStreamOptions,
) => Promise<AssistantMessage>;

/** Unit substitutes can test wrappers, but cannot claim complete benchmark replay. */
export type NativeTestInjection = {
  readonly mode?: "unit";
  readonly operations?: Partial<EngineOperations>;
  readonly transformContext?: (context: Context) => Context;
  readonly registryStreamSimple?: RegistryStreamSimple;
  readonly pageTransport?: PageTransport;
} | {
  readonly mode: "transport-replay";
  readonly registryStreamSimple: RegistryStreamSimple;
  readonly pageTransport: PageTransport;
  readonly operations?: never;
  readonly transformContext?: never;
};

/** Default entry is createNativeExtension(); overrides are immutable per loaded runtime. */
export declare function createNativeExtension(injection?: NativeTestInjection): (pi: ExtensionAPI) => void;
