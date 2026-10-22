// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
// Compile-only. These imports must not be executed as feature implementations.
import type {
  AdmissionErrorConstructor,
  Context,
  ModelPolicy,
  PolicyHooks,
  PageTransport,
  ResearchExecutionSettings,
} from "../../src/core/contracts.js";
import type { NativeTestInjection, RegistryStreamSimple } from "../../src/native-injection.js";
import type * as Specification from "../../docs/plans/codemode/API.js";
import type * as NativeSpecification from "../../docs/plans/codemode/NATIVE-API.js";
import type * as PublicCore from "../../src/core/index.js";

// Check actual exported functions, not only the prospective EngineOperations type.
// Research joins this assertion when M2 replaces its legacy implementation.
type PublicSearch = Assert<Equal<typeof PublicCore.search, typeof Specification.search>>;
type PublicExtract = Assert<Equal<typeof PublicCore.extract, typeof Specification.extract>>;
type PublicCollate = Assert<Equal<typeof PublicCore.collate, typeof Specification.collate>>;
type PublicFetch = Assert<Equal<typeof PublicCore.fetchPage, typeof Specification.fetchPage>>;

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
type ConstructorArguments = Assert<
  Equal<
    ConstructorParameters<AdmissionErrorConstructor>,
    ConstructorParameters<typeof Specification.AdmissionError>
  >
>;
declare const admissionError: InstanceType<AdmissionErrorConstructor>;
const specificationError: Specification.AdmissionError = admissionError;
const implementationError: InstanceType<AdmissionErrorConstructor> = specificationError;
void implementationError;

declare const context: Context;
declare const hooks: PolicyHooks;
declare const policy: ModelPolicy;
declare const registry: RegistryStreamSimple;
declare const page: PageTransport;
const specContext: Specification.Context = context;
const implementationContext: Context = specContext;
void implementationContext;

// @ts-expect-error The operation lease owns cancellation, not a second Context signal.
context.signal;
// @ts-expect-error Only services.clock owns operation timing.
context.now;
// @ts-expect-error Progress is routed through services, not duplicated.
context.onProgress;
// @ts-expect-error Jitter is passed to policy hooks, not a duplicate context random source.
context.random;
// @ts-expect-error New coordinated attempt identities retain readonly model configuration.
hooks.scope.ledger.records()[0].model.provider = "changed";

const replay: NativeTestInjection = {
  mode: "transport-replay",
  registryStreamSimple: registry,
  pageTransport: page,
};
const specReplay: NativeSpecification.NativeTestInjection = replay;
const implementationReplay: NativeTestInjection = specReplay;
void implementationReplay;
// @ts-expect-error Complete replay cannot bypass policy by substituting operations.
const bypass: NativeTestInjection = { ...replay, operations: {} };
// @ts-expect-error Complete replay cannot substitute an operation context.
const contextBypass: NativeTestInjection = { ...replay, transformContext: (ctx: Context) => ctx };
// @ts-expect-error Complete replay requires the bounded page transport seam too.
const partialReplay: NativeTestInjection = {
  mode: "transport-replay",
  registryStreamSimple: registry,
};
// @ts-expect-error Enabled deadline numbers cannot be inherited implicitly.
const incomplete: ResearchExecutionSettings["deadline"] = { enabled: true };
void [bypass, contextBypass, partialReplay, incomplete];

void policy(
  async (control) => {
    control.observe({
      tokens: { inputTotal: 3, outputTotal: 1 },
      source: "provider-response",
      costBasis: "unknown",
    });
    return { value: "fixture" };
  },
  { model: { provider: "fixture", model: "test" } },
  hooks,
);
