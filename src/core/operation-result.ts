// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type {
  AccountingSummary,
  Clock,
  Context,
  CoreResult,
  FullData,
  NumericHostUsage,
  Diagnostic,
  ModelBinding,
  OperationContext,
  OperationFailure,
  OperationResult,
  OperationServices,
  Progress,
} from "./contracts.js";
import { withOperationDiagnostics } from "./operation-diagnostics.js";
import { parseExecutionSettings } from "./execution-settings.js";

export class CoreConfigurationError extends Error {
  constructor(
    message: string,
    readonly bindings: readonly ModelBinding[] = [],
  ) {
    super(message);
    this.name = "CoreConfigurationError";
  }
}

export class CoreOperationFailure extends Error implements OperationFailure {
  constructor(
    message: string,
    readonly data: FullData,
    readonly usage: NumericHostUsage,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CoreOperationFailure";
  }
}
export function isOperationFailure(error: unknown): error is OperationFailure {
  if (!(error instanceof Error) || !("data" in error) || !("usage" in error)) return false;
  const data = error.data as Partial<FullData> | undefined;
  return data?.schemaVersion === 1 && typeof data.operationId === "string" && Boolean(error.usage);
}

interface Producer {
  readonly active: boolean;
  run(context: OperationContext): Promise<OperationResult>;
  settled(
    result: OperationResult | undefined,
    failure?: { message: string; aborted: boolean },
    parentDelivery?: AccountingSummary["parentDelivery"],
  ): CoreResult;
  dispose(): void;
  diagnostic?(diagnostic: { code: string; message: string }): void;
}

/** Frozen Context exposes exactly one authority for signal, clock and progress. */
export function legacyOperationContext(context: Context): OperationContext {
  const { services } = context;
  if (!services || !services.operation || !services.ledger || !services.clock)
    throw new TypeError("Core operations require authoritative operation services");
  for (const key of ["signal", "now", "random", "onProgress"])
    if (Object.hasOwn(context, key)) throw new TypeError(`Core Context must not contain ${key}`);
  const settings = structuredClone(context.settings);
  return {
    ...context,
    settings: { ...settings, execution: parseExecutionSettings(settings.execution) },
    services,
    signal: services.operation.signal,
    now: () => services.clock.monotonicMs(),
  };
}

/** Core owns production and its writers. Adapter finalisation adds no inventory. */
export async function produceCoreResult(
  context: Context,
  create: (legacy: OperationContext) => Producer,
  role: "search" | "extract" | "collate",
): Promise<CoreResult> {
  const clock = context.services.clock;
  const started = clock.monotonicMs();
  const startedUtc = clock.utcIso();
  const legacy = legacyOperationContext(context);
  legacy.signal?.throwIfAborted();
  const missing = await legacy.models.preflight([
    { role, config: legacy.settings[`${role}Model`] },
  ]);
  legacy.signal?.throwIfAborted();
  if (missing.length)
    throw new CoreConfigurationError(
      `Configured model unavailable for role(s): ${missing.map((item) => `${item.role}: ${item.config.provider}/${item.config.model}`).join(", ")}`,
      missing,
    );
  const producerOffset = Math.max(0, clock.monotonicMs() - started);
  const producer = create(legacy);
  let result: OperationResult | undefined;
  let failure: unknown;
  let failed = false;
  try {
    await withOperationDiagnostics(
      (diagnostic) => producer.diagnostic?.(diagnostic),
      async () => {
        try {
          result = await producer.run(legacy);
        } catch (error) {
          failed = true;
          failure = error;
        }
        try {
          await context.services.runs.settle();
        } catch (error) {
          if (!failed) {
            failed = true;
            failure = error;
          }
        }
      },
    );
    if (!producer.active) {
      if (failed) throw failure;
      throw new TypeError("Core result producer was not started");
    }
    const aborted = context.services.operation.signal.aborted;
    const produced = producer.settled(
      result,
      failed || aborted
        ? {
            message: failed
              ? failure instanceof Error
                ? failure.message
                : String(failure)
              : "Operation aborted",
            aborted,
          }
        : undefined,
      aborted ? "unknown" : "available",
    );
    const elapsedMs = Math.max(0, clock.monotonicMs() - started);
    const final: CoreResult = {
      ...produced,
      data: {
        ...produced.data,
        timing: {
          ...produced.data.timing,
          startedUtc,
          elapsedMs,
          allWorkSettledMs: elapsedMs,
          ...(produced.data.timing.summaryReadyMs === undefined
            ? {}
            : {
                summaryReadyMs: producerOffset + produced.data.timing.summaryReadyMs,
              }),
        },
      },
    };
    if (failed || aborted)
      throw new CoreOperationFailure(final.text, final.data, final.usage, { cause: failure });
    return final;
  } finally {
    producer.dispose();
  }
}

/** Shared registered boundary: retain core data through outer runtime drain. */
export function createOperationResultBoundary(
  clock: Clock,
  deliver: (progress: Progress) => void,
  onDiagnostic?: (diagnostic: Diagnostic) => void,
) {
  const started = clock.monotonicMs();
  const startedUtc = clock.utcIso();
  let services: OperationServices | undefined;
  let coreOffset = 0;
  let value: CoreResult | undefined;
  let terminal: Progress | undefined;
  let lastPct = 0;
  let abortAt: number | undefined;
  let removeAbort: (() => void) | undefined;
  const send = (event: Progress) => {
    try {
      deliver(event);
    } catch (error) {
      try {
        onDiagnostic?.({
          code: "PROGRESS_DELIVERY_FAILED",
          message: error instanceof Error ? error.message : "Progress delivery failed",
        });
      } catch {
        /* Rendering is supplementary. */
      }
    }
  };
  const progress = (event: Progress) => {
    if (
      event.event === "end" &&
      (event.state !== "succeeded" || event.stageIdx === event.totalStages - 1)
    )
      terminal = event;
    else {
      lastPct = event.pct;
      send(event);
    }
  };
  return {
    get hasResult() {
      return value !== undefined;
    },
    context(context: OperationContext): Context {
      if (!context.services) throw new TypeError("Registered core operation requires services");
      services = context.services;
      coreOffset = Math.max(0, clock.monotonicMs() - started);
      const signal = services.operation.signal;
      const aborted = () => {
        abortAt ??= clock.monotonicMs();
      };
      if (signal.aborted) aborted();
      else signal.addEventListener("abort", aborted, { once: true });
      removeAbort = () => signal.removeEventListener("abort", aborted);
      return {
        settings: context.settings,
        paths: context.paths,
        identity: context.identity,
        models: context.models as Context["models"],
        logger: context.logger,
        services: { ...services, onProgress: progress },
      };
    },
    async run(execute: () => Promise<CoreResult>): Promise<CoreResult> {
      try {
        value = await execute();
        return value;
      } catch (error) {
        if (isOperationFailure(error))
          value = {
            text: error.data.text,
            details: error.data.details,
            outcome: error.data.outcome,
            data: error.data,
            usage: error.usage,
          };
        throw error;
      }
    },
    settled(
      failure?: { message: string; aborted: boolean },
      parentDelivery: AccountingSummary["parentDelivery"] = "available",
    ): CoreResult | undefined {
      if (!value || !services) return undefined;
      if (value.data.operationId !== services.operation.id)
        throw new TypeError("Foreign core result at adapter boundary");
      const elapsedMs = Math.max(0, clock.monotonicMs() - started);
      const outcome = failure ? (failure.aborted ? "aborted" : "error") : value.outcome;
      const text = failure?.message ?? value.text;
      const data: FullData = {
        ...value.data,
        text,
        outcome,
        timing: {
          ...value.data.timing,
          startedUtc,
          elapsedMs,
          allWorkSettledMs: elapsedMs,
          ...(value.data.timing.summaryReadyMs === undefined
            ? {}
            : {
                summaryReadyMs: coreOffset + value.data.timing.summaryReadyMs,
              }),
          ...(failure?.aborted && abortAt !== undefined
            ? { abortToSettledMs: Math.max(0, clock.monotonicMs() - abortAt) }
            : {}),
        },
        accounting: services.ledger.summary(parentDelivery),
        attempts: services.ledger.records(),
      };
      if (terminal)
        send({
          ...terminal,
          elapsedMs,
          ...(failure
            ? {
                state: failure.aborted ? ("cancelled" as const) : ("failed" as const),
                pct: terminal.state === "succeeded" ? lastPct : terminal.pct,
                message: text,
              }
            : {}),
        });
      return { text, details: data.details, outcome, data, usage: services.ledger.hostUsage() };
    },
    dispose() {
      removeAbort?.();
    },
  };
}
