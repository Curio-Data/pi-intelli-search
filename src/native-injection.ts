// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Type-only immutable factory seam. Runtime wiring follows in coordinator integration.
import type {
  Api, AssistantMessage, Context as ProviderContext, Model, SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Context, EngineOperations, PageTransport } from "./core/contracts.js";

export interface NativeRegistryFacade {
  streamSimple(model: Model<Api>, context: ProviderContext, options?: SimpleStreamOptions): { result(): Promise<AssistantMessage> };
}
export type RegistryStreamSimple = (
  registry: NativeRegistryFacade,
  model: Model<Api>,
  context: ProviderContext,
  options?: SimpleStreamOptions,
) => Promise<AssistantMessage>;

/** Unit substitutes do not establish complete transport replay. */
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
export type NativeExtensionFactory = (injection?: NativeTestInjection) => (pi: ExtensionAPI) => void;
