// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Real capture and fail-closed replay wiring for the Codemode study runner.
// Benchmark-only code, never packaged. It composes the accepted libraries
// (replay-store, transport-replay, suggestion-replay) and adds no second replay
// format, isolation layer or monitor.
//
// Capture sits at the same two seams replay uses: one `registryStreamSimple`
// and one `pageTransport`, supplied to the native runtime through
// `NativeTestInjection`. Admission, pacing, retries, ledger and cancellation
// stay real above the seam; each transport call is one attempt.
//
// Binding rules implemented here:
// - An occurrence belongs to dispatch order, not settlement order. Attempts are
//   journalled at dispatch and fed to FixtureRecorder in that order at export,
//   because replay assigns occurrences when a request arrives.
// - Every dispatched attempt is retained, including rejected, cancelled and
//   failed ones. Usage comes from the same per-attempt capture the native client
//   uses, so a field the provider did not report stays absent.
// - A capture fault stops further paid dispatch and blocks export. The journal
//   is still persisted, so a failed block is never lost.
// - Replay has no live path. It receives a registry tripwire, drops
//   `options.fetch`, and a miss, a preparation fault or an unreproduced recorded
//   cancellation invalidates the block.

import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { PageTransport, PageTransportRequest, PageTransportResponse } from "../../src/core/execution-contracts.js";
import { createProcessPageTransport } from "../../src/core/page-transport.js";
import { capturePageEnvironment } from "../../src/core/page-runtime.js";
import {
  CACHE_SUGGEST_PROMPT,
  COLLATION_SYSTEM_PROMPT,
  EXTRACTION_SYSTEM_PROMPT,
  SEARCH_SYSTEM_PROMPT,
} from "../../src/core/prompts.js";
import type { NativeTestInjection, RegistryStreamSimple } from "../../src/native-injection.js";
import { createNativeUsageCapture } from "../../src/native-usage.js";
import { asJson, requestSha256, sha256Canonical } from "./canonical.js";
import type {
  FetchFixtureRequest,
  FixtureRecord,
  Json,
  ModelFixtureRequest,
  ModelRole,
  UsageObservation,
} from "./contracts.js";
import {
  createFixtureRecorder,
  createReplayStore,
  fixtureFileSha256,
  ReplayMissError,
  verifyFixtureFile,
  type BenchmarkReplayStore,
  type FixtureFile,
} from "./replay-store.js";
import {
  createSuggestionTransportPreparation,
  createSuggestionViewRecorder,
  createSuggestionViewReplay,
  F7_SUGGESTION_MARKER,
  suggestionArtefactSha256,
  SuggestionViewError,
  verifySuggestionArtefact,
  type SuggestionBaselineEntry,
  type SuggestionHostWitnessInput,
  type SuggestionObservation,
  type SuggestionViewArtefact,
  type SuggestionViewRecorder,
  type SuggestionViewReplay,
  type SuggestionWorkflowOperation,
} from "./suggestion-replay.js";
import {
  createModelTransportReplay,
  createPageTransportReplay,
  createRoleInferencer,
  modelFixtureRequest,
  type ModelNodeResolver,
  type ModelRequestPreparation,
  type ModelRequestPreparer,
  type PageNodeResolver,
} from "./transport-replay.js";

// ---------------------------------------------------------------------------
// Errors and identity
// ---------------------------------------------------------------------------

export type StudyTransportFault =
  | "invalid-option"
  | "invalid-bundle"
  | "capture-sealed"
  | "capture-incomplete"
  | "capture-overflow"
  | "capture-unrepresentable"
  | "observer-failed"
  | "admission-refused"
  | "spend-callback-failed"
  | "replay-incomplete";

export class StudyTransportError extends Error {
  readonly fault: StudyTransportFault;
  constructor(fault: StudyTransportFault, message: string) {
    super(message);
    this.name = "StudyTransportError";
    this.fault = fault;
  }
}

const roleOf = createRoleInferencer({
  search: SEARCH_SYSTEM_PROMPT,
  extract: EXTRACTION_SYSTEM_PROMPT,
  collate: COLLATION_SYSTEM_PROMPT,
  suggest: CACHE_SUGGEST_PROMPT,
});

/**
 * Role from the exact core system prompt; node from the exact request hash, so
 * identical requests share one node and differ only by occurrence. An unknown
 * prompt is ambiguous: a request that cannot be identified is never dispatched.
 */
export const resolveStudyModelNode: ModelNodeResolver = (request) => {
  const role = roleOf(request.systemPrompt);
  if (role === null)
    return { ambiguous: true, detail: "the system prompt is not an exact canonical core stage prompt" };
  return { operationNode: `${role}/${sha256Canonical({ ...request, role })}`, role };
};

/** Page node from the exact physical request. */
export const resolveStudyPageNode: PageNodeResolver = (request) => ({
  operationNode: `page/${sha256Canonical(request)}`,
});

const defaultPreparer: ModelRequestPreparer = (request, model, context) => {
  const resolution = resolveStudyModelNode(request, model, context);
  if ("ambiguous" in resolution)
    throw new ReplayMissError("ambiguous-node", `Study model node derivation failed: ${resolution.detail}`);
  return {
    request: asJson({ ...request, role: resolution.role } satisfies ModelFixtureRequest),
    operationNode: resolution.operationNode,
    role: resolution.role,
  };
};

function pageFixtureRequest(
  url: string,
  request: PageTransportRequest,
  maxResponseBytes: number,
): FetchFixtureRequest {
  // Same shape as createPageTransportReplay. The proxy value is never retained.
  return {
    url,
    method: request.method,
    accept: request.headers["accept"] ?? request.headers["Accept"] ?? "",
    browser: request.browser,
    proxyConfigured: request.proxy !== undefined,
    maxResponseBytes,
  };
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const errorName = (error: unknown): string | undefined => (error instanceof Error ? error.name : undefined);
const abortText = (signal: AbortSignal | undefined): string =>
  signal?.reason === undefined ? "Attempt cancelled" : errorText(signal.reason);

function assertScenario(value: unknown): asserts value is string {
  if (typeof value !== "string" || value === "")
    throw new StudyTransportError("invalid-option", "scenario must be a nonempty string");
}

function assertByteBound(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
    throw new StudyTransportError("invalid-option", "maxResponseBytes must be a positive safe integer");
}

// ---------------------------------------------------------------------------
// Public capture types
// ---------------------------------------------------------------------------

/** Prescribed F7 workflow identity. Required for suggestion fixtures reusable across generated paths. */
export interface StudyCaptureF7Options {
  readonly block: string;
  readonly workflow: readonly SuggestionWorkflowOperation[];
  readonly baseline: readonly SuggestionBaselineEntry[];
  readonly displayRoot: string;
  readonly initialTreeDigest: string;
  readonly scheduleManifestSha256: string;
}

export type StudyModelOutcome = "completed" | "provider-error" | "cancelled" | "throw";
export type StudyPageOutcome = "completed" | "consumer-cancelled" | "cancelled" | "body-error" | "throw";

/** Identity handed to the spend callback with each settled model attempt. */
export interface StudyModelAttemptInfo {
  readonly sequence: number;
  readonly role: ModelRole;
  readonly operationNode: string;
  readonly occurrence: number;
  readonly outcome: StudyModelOutcome;
}

export interface StudyCaptureOptions {
  readonly scenario: string;
  /**
   * Byte bound in the fetch request identity and the retention limit. It must
   * cover every limit the fetch client enforces: a body read beyond it cannot
   * be frozen and invalidates the capture. See the report on documentation
   * downloads.
   */
  readonly maxResponseBytes: number;
  /** Deterministic-test override. Default: `registry.streamSimple(...).result()`. */
  readonly liveRegistryTransport?: RegistryStreamSimple;
  /** Deterministic-test override. Default: process transport with the captured page environment. */
  readonly livePageTransport?: PageTransport;
  /** Without this, suggestion requests are frozen raw and bound to their exact generated paths. */
  readonly f7?: StudyCaptureF7Options;
  /** Awaited before each model dispatch. Rejection refuses the attempt and invalidates the capture. */
  readonly beforeModelAttempt?: (request: ModelFixtureRequest) => Promise<void>;
  /** Awaited once for every dispatched attempt after it settles. `undefined` means nothing was observed. */
  readonly afterModelAttempt?: (
    observation: UsageObservation | undefined,
    attempt: StudyModelAttemptInfo,
  ) => void | Promise<void>;
  /** Called once with the first fault. The runner cancels its block here. */
  readonly onInvalid?: (error: Error) => void;
}

export type StudyAttemptState = "in-flight" | "settled" | "refused";

/** One journal entry. Refused entries were never dispatched and never become fixtures. */
export interface StudyAttemptRecord {
  readonly sequence: number;
  readonly boundary: "model" | "fetch";
  readonly state: StudyAttemptState;
  readonly operationNode: string;
  readonly requestSha256: string;
  /** Fixture occurrence within the request hash; null for a refused attempt. */
  readonly occurrence: number | null;
  readonly role?: ModelRole;
  /** Canonical fixture request; the F7 projection for a prepared suggestion request. */
  readonly request: Json;
  /** The actual request, kept when `request` is an F7 projection, so a failed block still has it. */
  readonly rawRequest?: Json;
  readonly startedUtc: string;
  readonly settledUtc?: string;
  readonly durationMs?: number;
  readonly outcome?: StudyModelOutcome | StudyPageOutcome;
  readonly response?: Json;
  readonly error?: { readonly kind: string; readonly message: string };
  readonly usage?: UsageObservation;
}

export type StudySuggestionMode = "f7" | "raw-exact";

export interface StudyHostWitnessRecord extends SuggestionHostWitnessInput {
  readonly reportedUtc: string;
}

/** Non-throwing view of the capture, including pending attempts and faults. */
export interface StudyCaptureSnapshot {
  readonly scenario: string;
  readonly maxResponseBytes: number;
  readonly suggestionMode: StudySuggestionMode;
  readonly attempts: readonly StudyAttemptRecord[];
  readonly pendingAttempts: number;
  readonly faults: readonly string[];
  /** Transport calls rejected, without dispatch, because the capture was sealed or invalid. */
  readonly rejectedCalls: number;
  readonly hostWitnesses: readonly StudyHostWitnessRecord[];
  readonly suggestionObservations: readonly SuggestionObservation[];
}

export interface StudyAttemptCounts {
  readonly model: Readonly<Record<StudyModelOutcome, number>>;
  readonly fetch: Readonly<Record<StudyPageOutcome, number>>;
}

export type StudyBundleSuggestion =
  | {
      readonly mode: "f7";
      readonly block: string;
      readonly artefact: SuggestionViewArtefact;
      readonly artefactSha256: string;
    }
  | {
      readonly mode: "raw-exact";
      /** Always false: raw suggestion messages embed generated slugs and times. */
      readonly reusableAcrossGeneratedPaths: false;
      readonly rawSuggestRequests: number;
    };

/** Complete replay input: transport fixtures plus F7 artefact or an explicit raw declaration. */
export interface StudyReplayBundle {
  readonly schemaVersion: 1;
  readonly kind: "intelli-study-replay-bundle";
  readonly scenario: string;
  readonly maxResponseBytes: number;
  readonly model: FixtureFile;
  readonly fetch: FixtureFile;
  readonly modelSha256: string;
  readonly fetchSha256: string;
  readonly suggestion: StudyBundleSuggestion;
  readonly attemptCounts: StudyAttemptCounts;
}

export interface StudyPersistManifest {
  readonly schemaVersion: 1;
  readonly kind: "intelli-study-capture-manifest";
  readonly scenario: string;
  /** True only when `bundle.json` exists and passed verification. */
  readonly complete: boolean;
  readonly incompleteReason?: string;
  readonly attemptsSha256: string;
  readonly bundleSha256?: string;
  readonly suggestionMode: StudySuggestionMode;
  readonly attempts: number;
  readonly pendingAttempts: number;
  readonly faults: readonly string[];
}

export interface StudyCapture {
  /** Actual model and page transports, plus the F7 recorder when one is prescribed. */
  readonly injection: NativeTestInjection;
  readonly suggestionMode: StudySuggestionMode;
  snapshot(): StudyCaptureSnapshot;
  /** Fixture files over the attempts settled so far, in dispatch order. */
  fixtureFiles(): { readonly model: FixtureFile; readonly fetch: FixtureFile };
  /** Reports real host settlement. Forwarded to the F7 recorder; always journalled. */
  reportHostWitness(input: SuggestionHostWitnessInput): void;
  /**
   * Throws unless all attempts settled, no fault occurred, the F7 block is
   * complete and the frozen fixtures qualify for replay. Success seals the
   * capture. An F7 completeness failure is sticky, so call it after the host
   * witnesses.
   */
  assertComplete(): void;
  /** `assertComplete()`, then the sealed bundle. */
  exportBundle(): StudyReplayBundle;
  /**
   * Writes `attempts.json` always, `bundle.json` when complete, and
   * `manifest.json` last. `root` must not exist: evidence is never overwritten.
   */
  persist(root: string): Promise<StudyPersistManifest>;
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

interface MutableAttempt {
  sequence: number;
  boundary: "model" | "fetch";
  state: StudyAttemptState;
  operationNode: string;
  requestSha256: string;
  occurrence: number | null;
  role?: ModelRole;
  request: Json;
  rawRequest?: Json;
  startedUtc: string;
  startedAt: number;
  settledUtc?: string;
  durationMs?: number;
  outcome?: StudyModelOutcome | StudyPageOutcome;
  response?: Json;
  error?: { kind: string; message: string };
  usage?: UsageObservation;
}

const ZERO_MODEL_COUNTS: Record<StudyModelOutcome, number> = {
  completed: 0,
  "provider-error": 0,
  cancelled: 0,
  throw: 0,
};
const ZERO_PAGE_COUNTS: Record<StudyPageOutcome, number> = {
  completed: 0,
  "consumer-cancelled": 0,
  cancelled: 0,
  "body-error": 0,
  throw: 0,
};

const textOf = (message: AssistantMessage): string =>
  message.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");

/** Headers the fetch client reads. Nothing else, including cookies, is retained. */
const RETAINED_PAGE_HEADERS = ["content-type", "content-length", "content-encoding"] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Distinct routed provider and model labels reported in the stream, in first-seen order. */
function routedFields(events: readonly Json[]): { provider?: string[]; model?: string[] } {
  const collect = (name: "provider" | "model"): string[] => [
    ...new Set(
      events.flatMap((event) => {
        const value = isObject(event) ? event[name] : undefined;
        return typeof value === "string" && value !== "" ? [value] : [];
      }),
    ),
  ];
  const provider = collect("provider");
  const model = collect("model");
  return {
    ...(provider.length > 0 ? { provider } : {}),
    ...(model.length > 0 ? { model } : {}),
  };
}

export function createStudyCapture(options: StudyCaptureOptions): StudyCapture {
  assertScenario(options.scenario);
  assertByteBound(options.maxResponseBytes);
  for (const name of ["beforeModelAttempt", "afterModelAttempt", "onInvalid", "liveRegistryTransport", "livePageTransport"] as const)
    if (options[name] !== undefined && typeof options[name] !== "function")
      throw new StudyTransportError("invalid-option", `${name} must be a function when supplied`);
  const scenario = options.scenario;
  const maxResponseBytes = options.maxResponseBytes;

  const attempts: MutableAttempt[] = [];
  const faults: Error[] = [];
  const hostWitnesses: StudyHostWitnessRecord[] = [];
  const occurrences = { model: new Map<string, number>(), fetch: new Map<string, number>() };
  let rejectedCalls = 0;
  let sealed: StudyReplayBundle | undefined;

  const fault = (error: Error): void => {
    faults.push(error);
    if (faults.length === 1) {
      try {
        options.onInvalid?.(error);
      } catch (callbackError) {
        faults.push(new Error(`onInvalid callback failed: ${errorText(callbackError)}`));
      }
    }
  };

  /** A sealed or invalid capture never dispatches another paid or physical request. */
  const assertOpen = (): void => {
    if (faults.length > 0) {
      rejectedCalls += 1;
      throw faults[0];
    }
    if (sealed !== undefined) {
      rejectedCalls += 1;
      const error = new StudyTransportError(
        "capture-sealed",
        "A transport attempt arrived after the capture was sealed; it was not dispatched",
      );
      fault(error);
      throw error;
    }
  };

  const recorder: SuggestionViewRecorder | undefined = options.f7
    ? createSuggestionViewRecorder({
        scenario,
        block: options.f7.block,
        workflow: options.f7.workflow,
        baseline: options.f7.baseline,
        displayRoot: options.f7.displayRoot,
        initialTreeDigest: options.f7.initialTreeDigest,
        scheduleManifestSha256: options.f7.scheduleManifestSha256,
        onInvalid: fault,
      })
    : undefined;
  const prepare: ModelRequestPreparer = recorder
    ? createSuggestionTransportPreparation({ session: recorder, resolveNode: resolveStudyModelNode })
    : defaultPreparer;

  const dispatchEntry = (
    boundary: "model" | "fetch",
    operationNode: string,
    request: Json,
    role?: ModelRole,
  ): MutableAttempt => {
    const hash = requestSha256(request);
    const occurrence = (occurrences[boundary].get(hash) ?? 0) + 1;
    occurrences[boundary].set(hash, occurrence);
    const entry: MutableAttempt = {
      sequence: attempts.length + 1,
      boundary,
      state: "in-flight",
      operationNode,
      requestSha256: hash,
      occurrence,
      ...(role ? { role } : {}),
      request,
      startedUtc: new Date().toISOString(),
      startedAt: performance.now(),
    };
    attempts.push(entry);
    return entry;
  };

  const settle = (
    entry: MutableAttempt,
    result: {
      outcome: StudyModelOutcome | StudyPageOutcome;
      response?: Json;
      error?: { kind: string; message: string };
      usage?: UsageObservation;
    },
  ): void => {
    entry.state = "settled";
    entry.settledUtc = new Date().toISOString();
    entry.durationMs = Math.max(0, Math.round(performance.now() - entry.startedAt));
    entry.outcome = result.outcome;
    if (result.response !== undefined) entry.response = result.response;
    if (result.error !== undefined) entry.error = result.error;
    if (result.usage !== undefined) entry.usage = result.usage;
  };

  const notifySpend = async (entry: MutableAttempt): Promise<void> => {
    if (!options.afterModelAttempt) return;
    try {
      await options.afterModelAttempt(entry.usage, {
        sequence: entry.sequence,
        role: entry.role!,
        operationNode: entry.operationNode,
        occurrence: entry.occurrence!,
        outcome: entry.outcome as StudyModelOutcome,
      });
    } catch (error) {
      // The provider attempt already happened, so its result still returns.
      // Spend reconciliation is lost, which invalidates the block.
      fault(
        new StudyTransportError(
          "spend-callback-failed",
          `Spend callback failed for attempt ${entry.sequence}: ${errorText(error)}`,
        ),
      );
    }
  };

  const liveModel: RegistryStreamSimple =
    options.liveRegistryTransport ??
    ((registry, model, context, streamOptions) => registry.streamSimple(model, context, streamOptions).result());

  const modelTransport: RegistryStreamSimple = async (registry, model: Model<Api>, context: Context, streamOptions) => {
    assertOpen();
    const withoutRole = await modelFixtureRequest(model, context, streamOptions);
    let prepared: ModelRequestPreparation;
    try {
      prepared = prepare(withoutRole, model, context);
    } catch (error) {
      // Not dispatched. The F7 session has already reported its own fault;
      // fault() keeps the first error and appends this one.
      fault(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
    const raw: ModelFixtureRequest = { ...withoutRole, role: prepared.role };
    if (options.beforeModelAttempt) {
      try {
        await options.beforeModelAttempt(raw);
      } catch (error) {
        attempts.push({
          sequence: attempts.length + 1,
          boundary: "model",
          state: "refused",
          operationNode: prepared.operationNode,
          requestSha256: requestSha256(prepared.request),
          occurrence: null,
          role: prepared.role,
          request: prepared.request,
          startedUtc: new Date().toISOString(),
          startedAt: performance.now(),
          error: { kind: "admission-refused", message: errorText(error) },
        });
        fault(new StudyTransportError("admission-refused", `Model attempt refused before dispatch: ${errorText(error)}`));
        throw error;
      }
      // Another attempt may have invalidated the capture during that wait.
      assertOpen();
    }

    const events: Json[] = [];
    const usageCapture = createNativeUsageCapture();
    let providerResponse: { status: number; headers: Record<string, string> } | undefined;
    const entry = dispatchEntry("model", prepared.operationNode, prepared.request, prepared.role);
    if (recorder && prepared.role === "suggest") entry.rawRequest = asJson(raw);
    const captureOptions: SimpleStreamOptions = {
      ...streamOptions,
      onProviderStreamEvent: async (event, eventModel) => {
        // A throwing stream callback can fail the provider request, so an
        // observation problem invalidates the block and leaves the stream alone.
        try {
          usageCapture.chunk(event);
          if (entry.state === "in-flight") events.push(JSON.parse(JSON.stringify(event)) as Json);
        } catch (error) {
          fault(new StudyTransportError("observer-failed", `Provider event capture failed: ${errorText(error)}`));
        }
        await streamOptions?.onProviderStreamEvent?.(event, eventModel);
      },
      onResponse: async (response, responseModel) => {
        const retryAfter = response.headers["retry-after"];
        // Status and retry-after drive the retry policy. No other header is kept.
        providerResponse = {
          status: response.status,
          headers: retryAfter === undefined ? {} : { "retry-after": retryAfter },
        };
        await streamOptions?.onResponse?.(response, responseModel);
      },
    };
    const responseBody = (text: string, capture: Record<string, unknown>): Json =>
      JSON.parse(
        JSON.stringify({
          text,
          providerStreamEvents: events,
          ...(providerResponse ? { providerResponse } : {}),
          capture: { ...capture, routed: routedFields(events) },
        }),
      ) as Json;

    let message: AssistantMessage;
    try {
      message = await liveModel(registry, model, context, captureOptions);
    } catch (error) {
      const signalAborted = streamOptions?.signal?.aborted === true;
      const usage = usageCapture.observation(undefined);
      settle(entry, {
        outcome: signalAborted ? "cancelled" : "throw",
        response: responseBody("", {
          outcome: signalAborted ? "cancelled" : "throw",
          signalAborted,
          ...(errorName(error) ? { errorName: errorName(error) } : {}),
        }),
        error: { kind: "throw", message: errorText(error) },
        ...(usage ? { usage } : {}),
      });
      await notifySpend(entry);
      throw error;
    }

    const outcome: StudyModelOutcome =
      message.stopReason === "error" ? "provider-error" : message.stopReason === "aborted" ? "cancelled" : "completed";
    const usage = usageCapture.observation(message.usage);
    const body = responseBody(textOf(message), {
      outcome,
      signalAborted: streamOptions?.signal?.aborted === true,
      stopReason: message.stopReason,
      ...(message.rawStopReason ? { rawStopReason: message.rawStopReason } : {}),
      ...(message.responseModel ? { responseModel: message.responseModel } : {}),
      // SDK view for audit. Its zeros can be placeholders; `usage` is the observation.
      sdkUsage: message.usage,
    });
    settle(entry, {
      outcome,
      response: message.responseId ? ({ ...(body as object), responseId: message.responseId } as Json) : body,
      ...(outcome === "provider-error"
        ? { error: { kind: "provider-error", message: message.errorMessage ?? "unknown error" } }
        : outcome === "cancelled"
          ? { error: { kind: "cancelled", message: message.errorMessage ?? "Attempt cancelled" } }
          : {}),
      ...(usage ? { usage } : {}),
    });
    await notifySpend(entry);
    return message;
  };

  const livePage: PageTransport =
    options.livePageTransport ??
    createProcessPageTransport({
      executable: process.execPath,
      environment: capturePageEnvironment(process.env),
    });

  const pageTransport: PageTransport = async (url, request) => {
    assertOpen();
    const fixtureRequest = asJson(pageFixtureRequest(url, request, maxResponseBytes));
    const { operationNode } = resolveStudyPageNode(fixtureRequest as unknown as FetchFixtureRequest) as {
      operationNode: string;
    };
    const entry = dispatchEntry("fetch", operationNode, fixtureRequest);
    let response: PageTransportResponse;
    try {
      response = await livePage(url, request);
    } catch (error) {
      const signalAborted = request.signal.aborted;
      settle(entry, {
        outcome: signalAborted ? "cancelled" : "throw",
        error: { kind: signalAborted ? "abort" : "throw", message: errorText(error) },
        response: { capture: { outcome: signalAborted ? "cancelled" : "throw", signalAborted } } as unknown as Json,
      });
      throw error;
    }

    const headers: Record<string, string> = {};
    for (const name of RETAINED_PAGE_HEADERS) {
      const value = response.headers.get(name);
      if (value !== null) headers[name] = value;
    }
    const freeze = (state: "eof" | "cancel" | "error", retained: Buffer, observedBytes: number, cause?: unknown): void => {
      if (entry.state !== "in-flight") return;
      const signalAborted = request.signal.aborted;
      const outcome: StudyPageOutcome =
        state === "eof"
          ? "completed"
          : signalAborted
            ? "cancelled"
            : state === "cancel"
              ? "consumer-cancelled"
              : "body-error";
      const message =
        outcome === "cancelled"
          ? abortText(request.signal)
          : outcome === "body-error"
            ? errorText(cause)
            : undefined;
      settle(entry, {
        outcome,
        response: {
          status: response.status,
          headers,
          finalUrl: response.url,
          bodyBase64: retained.toString("base64"),
          capture: {
            outcome,
            signalAborted,
            retainedBytes: retained.byteLength,
            observedBytes,
            truncatedAtCapture: observedBytes > retained.byteLength,
          },
        } as unknown as Json,
        ...(message !== undefined
          ? { error: { kind: outcome === "cancelled" ? "abort" : "body-error", message } }
          : {}),
      });
    };
    if (!response.body) {
      freeze("eof", Buffer.alloc(0), 0);
      return response;
    }

    // No read-ahead: only bytes the consumer pulled are retained, and cancellation
    // reaches the live body directly. The chunk that crosses the bound is kept
    // whole, so a client that stops there sees the same bytes and reaches the
    // same over-limit decision under any limit of its own. A consumer that pulls
    // more bytes after the bound has a larger limit than this capture can freeze.
    const chunks: Buffer[] = [];
    let observed = 0;
    let overflowReported = false;
    const reader = response.body.getReader();
    let cancelling = false;
    const body = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          let chunk: ReadableStreamReadResult<Uint8Array>;
          try {
            chunk = await reader.read();
          } catch (error) {
            if (cancelling) return;
            freeze("error", Buffer.concat(chunks), observed, error);
            controller.error(error);
            return;
          }
          // A pending read resolves as done on cancel. That is not EOF.
          if (cancelling) return;
          if (chunk.done) {
            freeze("eof", Buffer.concat(chunks), observed);
            controller.close();
            return;
          }
          const bytes = chunk.value;
          if (observed <= maxResponseBytes) {
            chunks.push(Buffer.from(bytes));
          } else if (!overflowReported) {
            overflowReported = true;
            fault(
              new StudyTransportError(
                "capture-overflow",
                `The consumer read past ${maxResponseBytes} bytes of ${url}; the body cannot be frozen under this byte bound`,
              ),
            );
          }
          observed += bytes.byteLength;
          controller.enqueue(bytes);
        },
        async cancel(reason) {
          cancelling = true;
          try {
            await reader.cancel(reason);
          } finally {
            freeze("cancel", Buffer.concat(chunks), observed);
          }
        },
      },
      { highWaterMark: 0 },
    );
    return { status: response.status, url: response.url, headers: response.headers, body };
  };

  const buildFiles = (): { model: FixtureFile; fetch: FixtureFile } => {
    const model = createFixtureRecorder({ boundary: "model", scenario });
    const fetchRecorder = createFixtureRecorder({ boundary: "fetch", scenario });
    for (const entry of attempts) {
      if (entry.state !== "settled") continue;
      const recorderFor = entry.boundary === "model" ? model : fetchRecorder;
      const record = recorderFor.record(entry.operationNode, entry.request, {
        ...(entry.response !== undefined ? { response: entry.response } : {}),
        ...(entry.error !== undefined ? { error: entry.error } : {}),
        ...(entry.usage !== undefined ? { usage: entry.usage } : {}),
        delayMs: entry.durationMs ?? 0,
      });
      if (record.key.occurrence !== entry.occurrence || record.key.requestSha256 !== entry.requestSha256)
        throw new StudyTransportError(
          "capture-unrepresentable",
          `Attempt ${entry.sequence} froze under a different key than its dispatch identity`,
        );
    }
    return { model: model.toFile(), fetch: fetchRecorder.toFile() };
  };

  const counts = (): StudyAttemptCounts => {
    const model = { ...ZERO_MODEL_COUNTS };
    const fetch = { ...ZERO_PAGE_COUNTS };
    for (const entry of attempts) {
      if (entry.state !== "settled") continue;
      if (entry.boundary === "model") model[entry.outcome as StudyModelOutcome] += 1;
      else fetch[entry.outcome as StudyPageOutcome] += 1;
    }
    return { model, fetch };
  };

  const buildBundle = (): StudyReplayBundle => {
    if (faults.length > 0) throw faults[0];
    const pending = attempts.filter((entry) => entry.state === "in-flight");
    if (pending.length > 0)
      throw new StudyTransportError(
        "capture-incomplete",
        `${pending.length} attempt(s) have not settled (first: ${pending[0]!.boundary} sequence ${pending[0]!.sequence})`,
      );
    if (attempts.length === 0)
      throw new StudyTransportError("capture-incomplete", "The capture observed no transport attempt");
    const files = buildFiles();
    const modelSha256 = fixtureFileSha256(files.model);
    const fetchSha256 = fixtureFileSha256(files.fetch);
    qualifyModelFixtures(files.model);
    let suggestion: StudyBundleSuggestion;
    if (recorder) {
      recorder.assertValid();
      const artefact = recorder.exportArtefact({
        fixtureFiles: [
          { name: "model", sha256: modelSha256 },
          { name: "fetch", sha256: fetchSha256 },
        ],
      });
      suggestion = {
        mode: "f7",
        block: artefact.block,
        artefact,
        artefactSha256: suggestionArtefactSha256(artefact),
      };
    } else {
      suggestion = {
        mode: "raw-exact",
        reusableAcrossGeneratedPaths: false,
        rawSuggestRequests: attempts.filter((entry) => entry.role === "suggest").length,
      };
    }
    return {
      schemaVersion: 1,
      kind: "intelli-study-replay-bundle",
      scenario,
      maxResponseBytes,
      model: files.model,
      fetch: files.fetch,
      modelSha256,
      fetchSha256,
      suggestion,
      attemptCounts: counts(),
    };
  };

  const assertComplete = (): void => {
    if (sealed !== undefined) {
      if (faults.length > 0) throw faults[0];
      return;
    }
    sealed = buildBundle();
  };

  const snapshot = (): StudyCaptureSnapshot => ({
    scenario,
    maxResponseBytes,
    suggestionMode: recorder ? "f7" : "raw-exact",
    attempts: attempts.map(({ startedAt: _startedAt, ...entry }) => structuredClone(entry)),
    pendingAttempts: attempts.filter((entry) => entry.state === "in-flight").length,
    faults: faults.map((error) => errorText(error)),
    rejectedCalls,
    hostWitnesses: hostWitnesses.map((witness) => ({ ...witness })),
    suggestionObservations: recorder ? recorder.observations() : [],
  });

  return {
    injection: Object.freeze({
      mode: "unit" as const,
      registryStreamSimple: modelTransport,
      pageTransport,
      ...(recorder ? { suggestionReadView: recorder.controller } : {}),
    }),
    suggestionMode: recorder ? "f7" : "raw-exact",
    snapshot,
    fixtureFiles: buildFiles,
    reportHostWitness(input) {
      hostWitnesses.push({ ...input, reportedUtc: new Date().toISOString() });
      recorder?.reportHostWitness(input);
    },
    assertComplete,
    exportBundle() {
      assertComplete();
      return sealed!;
    },
    async persist(root) {
      await mkdir(dirname(root), { recursive: true });
      // Non-recursive and exclusive: an existing evidence directory is refused.
      await mkdir(root, { mode: 0o700 });
      const attemptsText = `${JSON.stringify(snapshot(), null, 2)}\n`;
      await writeFile(join(root, "attempts.json"), attemptsText, { flag: "wx", mode: 0o600 });
      let incompleteReason: string | undefined;
      let bundleSha256: string | undefined;
      try {
        assertComplete();
        verifyStudyReplayBundle(sealed!);
        await writeFile(join(root, "bundle.json"), `${JSON.stringify(sealed, null, 2)}\n`, { flag: "wx", mode: 0o600 });
        bundleSha256 = studyBundleSha256(sealed!);
      } catch (error) {
        incompleteReason = errorText(error);
      }
      const current = snapshot();
      const manifest: StudyPersistManifest = {
        schemaVersion: 1,
        kind: "intelli-study-capture-manifest",
        scenario,
        complete: bundleSha256 !== undefined,
        ...(incompleteReason !== undefined ? { incompleteReason } : {}),
        attemptsSha256: sha256Canonical(JSON.parse(attemptsText)),
        ...(bundleSha256 !== undefined ? { bundleSha256 } : {}),
        suggestionMode: current.suggestionMode,
        attempts: current.attempts.length,
        pendingAttempts: current.pendingAttempts,
        faults: current.faults,
      };
      await writeFile(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      return manifest;
    },
  };
}

/**
 * Runs the replay library's construction-time usage qualification at capture
 * time, so a capture that replay would refuse is reported where it can still be
 * explained. Dispatches nothing.
 */
function qualifyModelFixtures(file: FixtureFile): void {
  const store = createReplayStore({ fixtures: file.fixtures, scenario: file.scenario });
  createModelTransportReplay({ store, scenario: file.scenario, resolveNode: resolveStudyModelNode });
}

// ---------------------------------------------------------------------------
// Bundle verification and loading
// ---------------------------------------------------------------------------

const hasF7Marker = (record: FixtureRecord): boolean => {
  const projection = isObject(record.request) ? record.request["f7Suggestion"] : undefined;
  return isObject(projection) && projection["marker"] === F7_SUGGESTION_MARKER;
};
const roleOfRecord = (record: FixtureRecord): unknown =>
  isObject(record.request) ? record.request["role"] : undefined;

/** Fails closed on any header, digest, boundary or suggestion-mode inconsistency. */
export function verifyStudyReplayBundle(bundle: StudyReplayBundle): void {
  const invalid = (message: string): never => {
    throw new StudyTransportError("invalid-bundle", message);
  };
  if (!isObject(bundle) || bundle.schemaVersion !== 1 || bundle.kind !== "intelli-study-replay-bundle")
    invalid("Unsupported study replay bundle header");
  assertScenario(bundle.scenario);
  assertByteBound(bundle.maxResponseBytes);
  verifyFixtureFile(bundle.model);
  verifyFixtureFile(bundle.fetch);
  if (bundle.model.scenario !== bundle.scenario || bundle.fetch.scenario !== bundle.scenario)
    invalid("A fixture file names a different scenario than the bundle");
  if ((bundle.model.bindings ?? []).length > 0 || (bundle.fetch.bindings ?? []).length > 0)
    invalid("Study fixture files must not declare generic request bindings");
  if (bundle.model.fixtures.some((record) => record.key.boundary !== "model"))
    invalid("The model fixture file contains a non-model record");
  if (bundle.fetch.fixtures.some((record) => record.key.boundary !== "fetch"))
    invalid("The fetch fixture file contains a non-fetch record");
  for (const record of bundle.fetch.fixtures) {
    const maxBytes = isObject(record.request) ? record.request["maxResponseBytes"] : undefined;
    if (maxBytes !== bundle.maxResponseBytes)
      invalid(`A fetch record was captured under byte bound ${String(maxBytes)}, not ${bundle.maxResponseBytes}`);
  }
  if (fixtureFileSha256(bundle.model) !== bundle.modelSha256) invalid("The model fixture digest does not match");
  if (fixtureFileSha256(bundle.fetch) !== bundle.fetchSha256) invalid("The fetch fixture digest does not match");
  const suggestRecords = bundle.model.fixtures.filter((record) => roleOfRecord(record) === "suggest");
  const suggestion = bundle.suggestion;
  if (!isObject(suggestion)) invalid("The bundle declares no suggestion mode");
  if (suggestion.mode === "raw-exact") {
    if (suggestion.reusableAcrossGeneratedPaths !== false)
      invalid("A raw suggestion bundle cannot claim reuse across generated paths");
    if (suggestRecords.some(hasF7Marker)) invalid("A raw suggestion bundle contains F7 projected requests");
    if (suggestion.rawSuggestRequests !== suggestRecords.length)
      invalid("The raw suggestion request count does not match the fixtures");
  } else if (suggestion.mode === "f7") {
    verifySuggestionArtefact(suggestion.artefact);
    if (suggestionArtefactSha256(suggestion.artefact) !== suggestion.artefactSha256)
      invalid("The suggestion artefact digest does not match");
    if (suggestion.artefact.scenario !== bundle.scenario || suggestion.artefact.block !== suggestion.block)
      invalid("The suggestion artefact names a different scenario or block");
    if (!suggestRecords.every(hasF7Marker)) invalid("An F7 bundle contains an unprojected suggestion request");
  } else {
    invalid("The bundle declares an unknown suggestion mode");
  }
}

/** Whole-bundle digest for `RunObservation.fixtureSha256`. */
export function studyBundleSha256(bundle: StudyReplayBundle): string {
  return sha256Canonical(bundle);
}

/** Loads and verifies a persisted bundle. */
export async function loadStudyReplayBundle(path: string): Promise<StudyReplayBundle> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new StudyTransportError("invalid-bundle", `Cannot read study replay bundle ${path}: ${errorText(error)}`);
  }
  verifyStudyReplayBundle(parsed as StudyReplayBundle);
  return parsed as StudyReplayBundle;
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

export interface StudyReplayF7Options {
  /** Finite visibility-wait budget that fits inside the enclosing script budget. */
  readonly budgetMs: number;
  /** Must equal the recorded display root. */
  readonly displayRoot: string;
  readonly expectedInitialTreeDigest?: string;
  readonly expectedScheduleManifestSha256?: string;
}

export interface StudyReplayOptions {
  /** Called once with the first invalidation. The runner cancels its block here. */
  readonly onInvalid: (error: Error) => void;
  /** Required for an F7 bundle, refused for a raw bundle. */
  readonly f7?: StudyReplayF7Options;
}

export interface StudyReplaySummary {
  readonly consumed: { readonly model: number; readonly fetch: number };
  /** Fixtures the run never requested. Empty unless the caller allowed them. */
  readonly skipped: readonly FixtureRecord["key"][];
}

export interface StudyReplay {
  readonly injection: NativeTestInjection;
  readonly suggestionMode: StudySuggestionMode;
  readonly modelStore: BenchmarkReplayStore;
  readonly fetchStore: BenchmarkReplayStore;
  readonly suggestionSession?: SuggestionViewReplay;
  /** Reports real host settlement to the F7 session. Does nothing for a raw bundle. */
  reportHostWitness(input: SuggestionHostWitnessInput): void;
  /** The first invalidation, or undefined. */
  invalidation(): Error | undefined;
  /**
   * Accepts the block or throws. Checks stickiness, both stores and F7
   * completeness, then refuses unconsumed fixtures unless `allowUnconsumed`: a
   * run that stopped early otherwise looks valid. Allowed fixtures are returned
   * as skipped, never as misses.
   */
  assertComplete(options?: { readonly allowUnconsumed?: boolean }): StudyReplaySummary;
}

export function createStudyReplay(bundle: StudyReplayBundle, options: StudyReplayOptions): StudyReplay {
  if (typeof options?.onInvalid !== "function")
    throw new StudyTransportError("invalid-option", "createStudyReplay requires an onInvalid callback that cancels the run");
  verifyStudyReplayBundle(bundle);
  const suggestion = bundle.suggestion;
  if (suggestion.mode === "f7" && options.f7 === undefined)
    throw new StudyTransportError("invalid-option", "An F7 bundle requires f7 replay options");
  if (suggestion.mode === "raw-exact" && options.f7 !== undefined)
    throw new StudyTransportError("invalid-option", "A raw suggestion bundle has no F7 artefact to replay");

  let firstInvalid: Error | undefined;
  const invalidate = (error: Error): void => {
    if (firstInvalid !== undefined) return;
    firstInvalid = error;
    try {
      options.onInvalid(error);
    } catch {
      // A failing cancel callback cannot restore validity or replace the cause.
    }
  };
  const session: SuggestionViewReplay | undefined =
    suggestion.mode === "f7"
      ? createSuggestionViewReplay({
          artefact: suggestion.artefact,
          displayRoot: options.f7!.displayRoot,
          budgetMs: options.f7!.budgetMs,
          ...(options.f7!.expectedInitialTreeDigest !== undefined
            ? { expectedInitialTreeDigest: options.f7!.expectedInitialTreeDigest }
            : {}),
          ...(options.f7!.expectedScheduleManifestSha256 !== undefined
            ? { expectedScheduleManifestSha256: options.f7!.expectedScheduleManifestSha256 }
            : {}),
          expectedFixtureFiles: [
            { name: "model", sha256: bundle.modelSha256 },
            { name: "fetch", sha256: bundle.fetchSha256 },
          ],
          onInvalid: invalidate,
        })
      : undefined;

  const modelStore = createReplayStore({ fixtures: bundle.model.fixtures, scenario: bundle.scenario });
  const fetchStore = createReplayStore({ fixtures: bundle.fetch.fixtures, scenario: bundle.scenario });

  // Tells each transport wrapper which record its own call consumed, including
  // when identical requests run concurrently.
  const lookupSlot = new AsyncLocalStorage<{ record?: FixtureRecord }>();
  const tracking = (store: BenchmarkReplayStore): BenchmarkReplayStore => ({
    ...store,
    async lookup(key, request) {
      const record = await store.lookup(key, request);
      const slot = lookupSlot.getStore();
      if (slot) slot.record = record;
      return record;
    },
  });

  const replayModel = createModelTransportReplay({
    store: tracking(modelStore),
    scenario: bundle.scenario,
    ...(session
      ? { prepare: createSuggestionTransportPreparation({ session, resolveNode: resolveStudyModelNode }) }
      : { resolveNode: resolveStudyModelNode }),
  });
  const replayPage = createPageTransportReplay({
    store: tracking(fetchStore),
    scenario: bundle.scenario,
    maxResponseBytes: bundle.maxResponseBytes,
    resolveNode: resolveStudyPageNode,
  });

  const registryTripwire = new Proxy(
    {},
    {
      get() {
        throw new ReplayMissError("invalid-file", "Study replay dereferenced the live model registry");
      },
    },
  ) as Parameters<RegistryStreamSimple>[0];

  const stopIfInvalid = (): void => {
    if (firstInvalid !== undefined) throw firstInvalid;
  };

  /**
   * A recorded cancellation is a control-flow fact of the captured run. If the
   * same signal is not aborted now, the replay diverged. Delivering the recorded
   * failure would invent a cancellation the replayed run did not experience.
   */
  const unreproducedCancellation = (
    store: BenchmarkReplayStore,
    record: FixtureRecord | undefined,
    signal: AbortSignal | undefined,
  ): void => {
    if (record === undefined || signal?.aborted) return;
    const capture = isObject(record.response) ? record.response["capture"] : undefined;
    if (!isObject(capture) || capture["outcome"] !== "cancelled") return;
    store.invalidate(
      new ReplayMissError(
        "request-mismatch",
        `Recorded cancellation of ${record.key.operationNode} occurrence ${record.key.occurrence} was not reproduced by the replayed run`,
        record.key,
      ),
    );
  };

  const isInvalidation = (error: unknown): error is Error =>
    error instanceof ReplayMissError || error instanceof SuggestionViewError;

  const modelTransport: RegistryStreamSimple = async (_registry, model, context, streamOptions) => {
    stopIfInvalid();
    // N1: the tee `fetch` never reaches the replay path.
    const { fetch: _fetch, ...withoutFetch } = streamOptions ?? {};
    const slot: { record?: FixtureRecord } = {};
    try {
      const message = await lookupSlot.run(slot, () => replayModel(registryTripwire, model, context, withoutFetch));
      unreproducedCancellation(modelStore, slot.record, streamOptions?.signal);
      return message;
    } catch (error) {
      if (!isInvalidation(error)) {
        try {
          unreproducedCancellation(modelStore, slot.record, streamOptions?.signal);
        } catch (miss) {
          invalidate(miss as Error);
          throw miss;
        }
        throw error; // A recorded transport rejection, replayed as a failed attempt.
      }
      invalidate(error);
      throw error;
    }
  };

  const pageTransport: PageTransport = async (url, request) => {
    stopIfInvalid();
    const slot: { record?: FixtureRecord } = {};
    try {
      const response = await lookupSlot.run(slot, () => replayPage(url, request));
      unreproducedCancellation(fetchStore, slot.record, request.signal);
      return response;
    } catch (error) {
      if (!isInvalidation(error)) {
        try {
          unreproducedCancellation(fetchStore, slot.record, request.signal);
        } catch (miss) {
          invalidate(miss as Error);
          throw miss;
        }
        throw error;
      }
      invalidate(error);
      throw error;
    }
  };

  return {
    injection: Object.freeze({
      mode: "transport-replay" as const,
      registryStreamSimple: modelTransport,
      pageTransport,
      ...(session ? { suggestionReadView: session.controller } : {}),
    }),
    suggestionMode: suggestion.mode,
    modelStore,
    fetchStore,
    ...(session ? { suggestionSession: session } : {}),
    reportHostWitness(input) {
      session?.reportHostWitness(input);
    },
    invalidation: () => firstInvalid,
    assertComplete(completeOptions) {
      if (firstInvalid !== undefined) throw firstInvalid;
      modelStore.assertValid();
      fetchStore.assertValid();
      if (session) {
        session.assertValid();
        session.assertReplayComplete();
      }
      const skipped = [...modelStore.unconsumed(), ...fetchStore.unconsumed()];
      if (skipped.length > 0 && completeOptions?.allowUnconsumed !== true)
        throw new StudyTransportError(
          "replay-incomplete",
          `${skipped.length} recorded fixture(s) were never requested (first: ${skipped[0]!.boundary} ${skipped[0]!.operationNode})`,
        );
      return {
        consumed: { model: modelStore.consumed().length, fetch: fetchStore.consumed().length },
        skipped,
      };
    },
  };
}
