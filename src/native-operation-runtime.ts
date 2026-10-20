// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { randomBytes, randomUUID } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
  AccountingSummary,
  AttemptRecord,
  NumericHostUsage,
  Clock,
  FullData,
  Diagnostic,
  FetchClient,
  OperationContext,
  OperationInputs,
  OperationResult,
  OperationServices,
  RunStore,
} from "./core/contracts.js";
import { createRuntimeGenerations, type OperationRuntime } from "./core/operation-runtime.js";
import { AdmissionError } from "./core/execution-coordinator.js";
import { createSystemClock } from "./core/clock.js";
import { createStandaloneResult } from "./core/standalone-result.js";
import { parseExecutionSettings, validateRequestInterval } from "./core/execution-settings.js";
import { createRunStore } from "./core/run-store.js";
import { resolveWorkspacePaths } from "./core/paths.js";
import { search } from "./core/operations/search.js";
import { extract } from "./core/operations/extract.js";
import { collate } from "./core/operations/collate.js";
import {
  research,
  MissingModelsError,
  type ResearchDependencies,
} from "./core/operations/research.js";
import { createScopedNativeModelClient, describeModelCatalog } from "./native-model-client.js";
import { getNativeIdentity } from "./native-identity.js";
import { loadSettings } from "./settings.js";
import { nativeProgress, nativeResult } from "./native-operation-context.js";
import type { OnUpdate } from "./host-types.js";
import { errMsg, textContent } from "./util.js";

interface SessionKey {
  readonly owner: object;
  readonly id: string | undefined;
}
interface SessionState {
  readonly key: SessionKey;
  readonly generation: number;
  closed: boolean;
  failure?: { readonly error: unknown };
  ready: Promise<OperationRuntime>;
  runtime?: OperationRuntime;
  stop?: Promise<void>;
  indicator?: { readonly operationId: string; readonly clear: () => void };
  wait?: {
    outcome?: { error?: unknown; ok?: true };
    readonly waiters: Set<(outcome: { error?: unknown; ok?: true }) => void>;
  };
}

/** Internal unit seam, not the frozen complete transport-replay factory. */
export interface NativeRuntimeOptions {
  readonly clock?: Clock;
  /** Detected on the host API, never inferred from the extension's peer install. */
  readonly supportsErrorResults?: boolean;
  readonly researchDependencies?: ResearchDependencies;
  readonly createRuns?: (services: { operationId: string; clock: Clock }) => RunStore;
}

export interface NativeExecutionReceipt {
  readonly operationId: string;
  readonly accounting: AccountingSummary;
  readonly attempts: readonly AttemptRecord[];
  readonly diagnostics: readonly Diagnostic[];
}

/** Older hosts only recognise thrown failures and cannot deliver these fields. */
export class NativeExecutionError extends Error {
  constructor(
    message: string,
    readonly execution: NativeExecutionReceipt,
    readonly usage: NumericHostUsage,
    readonly data?: FullData,
  ) {
    super(message);
    this.name = "NativeExecutionError";
  }
}

const unwiredFetch: FetchClient = Object.freeze({
  async fetch() {
    throw new Error("Coordinated fetch is not installed");
  },
  async discover() {
    throw new Error("Coordinated discovery is not installed");
  },
});

/** One closure per extension registration. Construction starts no work. */
export function createNativeOperationRuntime(options: NativeRuntimeOptions = {}) {
  options = {
    ...options,
    researchDependencies: options.researchDependencies
      ? { ...options.researchDependencies }
      : undefined,
  };
  const generations = createRuntimeGenerations();
  const sessions = new WeakMap<object, Map<string | undefined, SessionState>>();
  const diagnostics = new Map<string, (diagnostic: Diagnostic) => void>();
  const clock = options.clock ?? createSystemClock();
  let current: SessionState | undefined;
  let generation = 0;
  let disposed = false;
  let closing: Promise<void> | undefined;

  // The session manager and ID are stable across fresh tool/event contexts.
  // The context fallback supports old direct unit mocks only, not host identity.
  const keyOf = (ctx: ExtensionContext): SessionKey => ({
    owner: ctx.sessionManager ?? ctx,
    id: ctx.sessionManager?.getSessionId(),
  });
  const lookup = (key: SessionKey) => sessions.get(key.owner)?.get(key.id);
  const active = (state: SessionState) => !disposed && current === state && !state.closed;
  const stop = (state: SessionState, reason: string): Promise<void> => {
    if (state.stop) return state.stop;
    state.closed = true;
    // Clear while the captured UI can still be valid, never through a successor.
    try {
      state.indicator?.clear();
    } catch {
      /* Stale renderers are disposable. */
    }
    state.indicator = undefined;
    const closing = state.runtime?.close(reason); // Synchronous admission stop.
    state.stop = (async () => {
      await closing;
      const runtime = await state.ready.catch(() => undefined);
      await runtime?.close(reason);
    })();
    return state.stop;
  };

  const start = (
    ctx: ExtensionContext,
    prepare: () => Promise<void> = async () => {},
  ): Promise<void> => {
    if (disposed) return Promise.reject(new AdmissionError("CLOSED", "Native runtime disposed"));
    const key = keyOf(ctx);
    const previous = current;
    const drained = previous ? stop(previous, "Native session replaced") : Promise.resolve();
    // Capture guarded host properties before the first await.
    const cwd = ctx.cwd;
    const projectTrusted = ctx.isProjectTrusted();
    const state: SessionState = { key, generation: ++generation, closed: false, ready: undefined! };
    current = state;
    let owned = sessions.get(key.owner);
    if (!owned) sessions.set(key.owner, (owned = new Map()));
    owned.set(key.id, state);
    state.ready = (async () => {
      try {
        // Preparation can own asynchronous host/file work too. Drain it before
        // the successor starts, not only before enabling its coordinator.
        await drained;
        if (!active(state)) throw new AdmissionError("CLOSED", "Native session superseded");
        await prepare();
        if (!active(state)) throw new AdmissionError("CLOSED", "Native session superseded");
        let settings: Awaited<ReturnType<typeof loadSettings>>;
        let execution;
        try {
          settings = structuredClone(await loadSettings({ cwd, projectTrusted }));
          execution = parseExecutionSettings(settings.execution, "pi-intelli-search.execution");
          validateRequestInterval(
            settings.minRequestIntervalMs,
            "pi-intelli-search.minRequestIntervalMs (deprecated intelliMinRequestIntervalMs)",
          );
        } catch (error) {
          throw new Error(`${errMsg(error)}. Correct settings.json and reload the session.`);
        }
        if (!active(state)) throw new AdmissionError("CLOSED", "Native session superseded");
        const paths = resolveWorkspacePaths(cwd, settings.cacheDir);
        const runtime = await generations.replace({
          generation: state.generation,
          clock,
          modelConcurrency: execution.modelConcurrency,
          criticalReserve: execution.criticalReserve,
          fetchConcurrency: execution.aggregateFetchConcurrency,
          minRequestIntervalMs: settings.minRequestIntervalMs,
          createFetch: () => unwiredFetch,
          createRuns: (operation) =>
            options.createRuns?.({ operationId: operation.id, clock }) ??
            createRunStore({
              workspaceRoot: paths.workspaceRoot,
              cacheRoot: paths.cacheRoot,
              displayRoot: paths.cacheDisplayRoot,
              clock,
              randomId: () => randomBytes(16).toString("hex"),
              onDiagnostic: (diagnostic) => diagnostics.get(operation.id)?.(diagnostic),
            }),
        });
        state.runtime = runtime;
        if (!active(state)) {
          await runtime.close("Native session superseded");
          throw new AdmissionError("CLOSED", "Native session superseded");
        }
        // Settings and paths belong to this generation, not subsequent loads.
        settingsByState.set(state, { settings, paths });
        return runtime;
      } catch (error) {
        state.closed = true;
        state.failure = { error };
        throw error;
      }
    })();
    // A host may report startup failure without awaiting later tool invocations.
    void state.ready.catch(() => {});
    return state.ready.then(() => undefined);
  };
  const settingsByState = new WeakMap<
    SessionState,
    {
      settings: Awaited<ReturnType<typeof loadSettings>>;
      paths: ReturnType<typeof resolveWorkspacePaths>;
    }
  >();

  return Object.freeze({
    start,
    isCurrent(ctx: ExtensionContext): boolean {
      try {
        // Provider monitoring also runs before session_start on older hosts.
        return !disposed && (!current || (active(current) && lookup(keyOf(ctx)) === current));
      } catch {
        return false;
      }
    },
    shutdown(ctx: ExtensionContext): Promise<void> {
      let state: SessionState | undefined;
      try {
        state = lookup(keyOf(ctx));
      } catch {
        /* Invalidated host ctx: no successor lookup. */
      }
      return state ? stop(state, "Native session shutdown") : Promise.resolve();
    },
    /** Terminal registration disposal, distinct from captured-session shutdown. */
    close(reason = "Native runtime disposed"): Promise<void> {
      if (!closing) {
        disposed = true;
        const stopped = current ? stop(current, reason) : Promise.resolve();
        const closed = generations.close(reason);
        closing = Promise.all([stopped, closed]).then(() => undefined);
      }
      return closing;
    },
    async execute<Name extends keyof OperationInputs>(
      name: Name,
      params: OperationInputs[Name],
      signal: AbortSignal | undefined,
      onUpdate: OnUpdate | undefined,
      ctx: ExtensionContext,
    ) {
      const key = keyOf(ctx);
      let state = lookup(key);
      if (!state) {
        // SDK/direct hosts may execute registered tools without session_start.
        const starting = start(ctx);
        void starting.catch(() => {});
        state = lookup(key)!;
      }
      const captured = state;
      if (!disposed && current === captured && captured.failure) throw captured.failure.error;
      if (!active(captured)) throw new AdmissionError("CLOSED", "Native session is closed");
      // Waiters cancel without retaining an abort listener or reaction per call.
      await waitReady(captured, signal);
      if (!active(captured)) throw new AdmissionError("CLOSED", "Native session is closed");
      const { settings, paths } = settingsByState.get(captured)!;
      const modelContext = { modelRegistry: ctx.modelRegistry };
      const ui = ctx.ui;
      const hasUI = ctx.hasUI;
      const notices: Diagnostic[] = [];
      const diagnose = (diagnostic: Diagnostic) => {
        notices.push({ ...diagnostic });
        if (active(captured) && hasUI) {
          try {
            ui.notify(`[pi-intelli-search] ${diagnostic.message}`, "warning");
          } catch {
            /* Retained in receipt. */
          }
        }
      };
      const logger = {
        error: (message: string, error?: unknown) =>
          diagnose({
            code: "OPERATION_DIAGNOSTIC",
            message: message + (error === undefined ? "" : `: ${errMsg(error)}`),
          }),
        warn: (message: string) => diagnose({ code: "OPERATION_DIAGNOSTIC", message }),
      };
      const operationId = randomUUID();
      const projection =
        name === "intelli_search" || name === "intelli_extract"
          ? createStandaloneResult(
              name,
              params,
              clock,
              (event) => {
                if (active(captured)) onUpdate?.(nativeProgress(event));
              },
              diagnose,
            )
          : undefined;
      diagnostics.set(operationId, diagnose);
      let owned: OperationServices | undefined;
      const receipt = (
        parentDelivery: AccountingSummary["parentDelivery"] = "available",
      ): NativeExecutionReceipt => ({
        operationId,
        accounting: owned!.ledger.summary(parentDelivery),
        attempts: owned!.ledger.records(),
        diagnostics: notices,
      });
      try {
        const result = await captured.runtime!.run(
          {
            operationId,
            signal,
            onDiagnostic: diagnose,
            onProgress: (event) => onUpdate?.(nativeProgress(event)),
          },
          async (services) => {
            owned = services;
            const models = createScopedNativeModelClient(modelContext, services, { logger });
            let sequence = 0;
            const started = clock.monotonicMs();
            const context: OperationContext = {
              settings,
              paths,
              identity: await getNativeIdentity(),
              models,
              services,
              logger,
              signal: services.operation.signal,
              now: () => services.clock.monotonicMs(),
              onProgress: (event) =>
                services.onProgress?.({
                  ...event,
                  operationId,
                  sequence: ++sequence,
                  event: "update",
                  state: "running",
                  elapsedMs: services.clock.monotonicMs() - started,
                }),
            };
            switch (name) {
              case "intelli_search":
                return projection!.run(context, (scoped) =>
                  search(params as OperationInputs["intelli_search"], scoped),
                );
              case "intelli_extract":
                return projection!.run(context, (scoped) =>
                  extract(params as OperationInputs["intelli_extract"], scoped),
                );
              case "intelli_collate":
                return collate(params as OperationInputs["intelli_collate"], context);
              case "intelli_research": {
                const originalPreflight = models.preflight;
                const withIndicator: OperationContext = {
                  ...context,
                  models: {
                    ...models,
                    async preflight(bindings) {
                      const missing = await originalPreflight(bindings);
                      if (!missing.length && active(captured)) {
                        try {
                          const working = ui as {
                            setWorkingIndicator?(opts?: {
                              frames?: string[];
                              intervalMs?: number;
                            }): void;
                          };
                          working.setWorkingIndicator?.({
                            frames: ["🔍", "🌐", "📄", "✨"],
                            intervalMs: 400,
                          });
                          captured.indicator = {
                            operationId,
                            clear: () => working.setWorkingIndicator?.(),
                          };
                        } catch {
                          /* Rendering cannot discard a result. */
                        }
                      }
                      return missing;
                    },
                  },
                };
                try {
                  return await research(
                    params as OperationInputs["intelli_research"],
                    withIndicator,
                    options.researchDependencies,
                  );
                } catch (error) {
                  if (error instanceof MissingModelsError) {
                    const lines = error.bindings.map((binding) => {
                      const hint = describeModelCatalog(
                        modelContext,
                        binding.config.provider,
                        binding.config.model,
                      );
                      return `  ${binding.role}: ${binding.config.provider}/${binding.config.model}${hint ? `\n${hint}` : ""}`;
                    });
                    throw new Error(
                      `Configured model(s) not found in Pi's model registry:\n${lines.join("\n")}\nCheck your settings.json for typos or missing provider configuration. Run /login to add API keys, or /model to see available models.`,
                    );
                  }
                  throw error;
                } finally {
                  if (captured.indicator?.operationId === operationId) {
                    if (active(captured)) {
                      try {
                        captured.indicator.clear();
                      } catch {
                        /* Stale UI. */
                      }
                    }
                    captured.indicator = undefined;
                  }
                }
              }
              default:
                throw new Error("Unknown native operation");
            }
          },
        );
        const full = projection?.settled(result);
        return {
          ...nativeResult(result as OperationResult),
          details: {
            ...result.details,
            ...(full ? { intelli: full.data } : {}),
            execution: receipt(),
          },
          usage: full?.usage ?? owned!.ledger.hostUsage(),
        };
      } catch (error) {
        // Runtime.run has drained before any ledger projection, including errors.
        if (
          !owned ||
          (!owned.ledger.records().length &&
            !signal?.aborted &&
            !captured.closed &&
            !(error instanceof AdmissionError && error.code === "BUSY"))
        )
          throw error;
        const aborted = Boolean(signal?.aborted || captured.closed);
        const full = projection?.active
          ? projection.settled(
              undefined,
              { message: errMsg(error), aborted },
              !options.supportsErrorResults || aborted ? "unknown" : "available",
            )
          : undefined;
        if (!options.supportsErrorResults) {
          // The floor agent loop ignores returned isError. Preserve its throwing
          // error signal; partial fields remain local, not claimed as delivered.
          throw new NativeExecutionError(
            errMsg(error),
            receipt("unknown"),
            owned.ledger.hostUsage(),
            full?.data,
          );
        }
        return {
          content: [textContent(errMsg(error))],
          isError: true,
          details: {
            ...(full ? { intelli: full.data } : {}),
            execution: receipt(aborted ? "unknown" : "available"),
          },
          usage: owned.ledger.hostUsage(),
        };
      } finally {
        projection?.dispose();
        diagnostics.delete(operationId);
      }
    },
  });
}

/** One shared completion reaction per generation, removable caller waiters. */
function waitReady(state: SessionState, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new AdmissionError("ABORTED", "Operation aborted"));
  let gate = state.wait;
  if (!gate) {
    gate = { waiters: new Set() };
    state.wait = gate;
    const finish = (outcome: { error?: unknown; ok?: true }) => {
      gate!.outcome = outcome;
      for (const waiter of [...gate!.waiters]) waiter(outcome);
      gate!.waiters.clear();
    };
    void state.ready.then(
      () => finish({ ok: true }),
      (error: unknown) => finish({ error }),
    );
  }
  const captured = gate;
  return new Promise((resolve, reject) => {
    const finish = (outcome: { error?: unknown; ok?: true }) => {
      captured.waiters.delete(finish);
      signal?.removeEventListener("abort", abort);
      if (outcome.ok) resolve();
      else reject(outcome.error);
    };
    const abort = () => finish({ error: new AdmissionError("ABORTED", "Operation aborted") });
    if (captured.outcome) finish(captured.outcome);
    else {
      captured.waiters.add(finish);
      signal?.addEventListener("abort", abort, { once: true });
    }
  });
}
