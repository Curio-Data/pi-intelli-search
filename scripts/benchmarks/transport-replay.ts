// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Native transport-replay helpers. Binding condition N1 (verbatim):
//
//   a transport-replay implementation must never invoke `options.fetch` or
//   any network primitive. It must replay citations only through recorded
//   `onProviderStreamEvent` chunks, or through a declared non-network tee
//   seam if floor-host replay is ever required.
//
// These helpers sit BELOW the future native policy seam: each call consumes
// exactly one fixture occurrence per actual transport attempt, after the real
// scoped policy admits that attempt (the policy invokes this transport once
// per attempt, so admission, pacing, retries, ledger and cancellation remain
// real). The injected registry facade argument is accepted for signature
// compatibility and is never dereferenced: a miss throws ReplayMissError and
// there is no live fallback path anywhere in this module. The page transport
// helper sits below the real FetchClient (it returns incremental
// ReadableStream bodies so real permits, stream limits, comparison, staging
// and cleanup are exercised).
//
// Timing uses real host wall time: the native transport seam does not inject
// a clock, and deterministic injected-clock comparisons are a separate core
// population (BUILDER-HANDOFF, P3 Recorder and Analysis).

import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions, Usage } from "@earendil-works/pi-ai";
import type { RegistryStreamSimple } from "../../docs/plans/codemode/NATIVE-API.js";
import type { PageTransport, PageTransportRequest, PageTransportResponse } from "../../src/core/execution-contracts.js";
import { asJson, requestSha256, type RequestBinding } from "./canonical.js";
import { ReplayMissError, type BenchmarkReplayStore } from "./replay-store.js";
import type { FetchFixtureRequest, FixtureKey, Json, ModelFixtureRequest, UsageObservation } from "./contracts.js";

/** Recorded wire shape of a model fixture response (inside FixtureRecord.response). */
export interface ModelFixtureResponse {
  readonly text: string;
  readonly providerStreamEvents?: readonly Json[];
  readonly responseId?: string;
}

/** Recorded wire shape of a fetch/catalogue fixture response (inside FixtureRecord.response). */
export interface FetchFixtureResponse {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly finalUrl?: string;
  readonly bodyText?: string;
  readonly bodyBase64?: string;
}

function sleepWithSignal(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
  if (delayMs <= 0) {
    signal?.throwIfAborted();
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        reject(abortError());
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function abortError(): Error {
  const error = new Error("Transport replay aborted before the recorded response delay elapsed");
  error.name = "AbortError";
  return error;
}

/** Extracts the canonical user message text from a pi-ai provider context. */
export function userMessageFromContext(context: Context): string {
  const messages = context.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== "user") continue;
    const content = message.content;
    if (typeof content === "string") return content;
    const parts: string[] = [];
    for (const block of content ?? []) {
      if (block.type === "text") parts.push(block.text);
      else parts.push(`[${block.type}:${canonicalBlockBytes(block)}]`);
    }
    return parts.join("\n");
  }
  return "";
}

function canonicalBlockBytes(block: unknown): number {
  return JSON.stringify(block ?? null).length;
}

/** Maps a recorded canonical usage observation back to the pi-ai Usage view. */
export function usageFromObservation(observation: UsageObservation | undefined): Usage {
  const tokens = observation?.tokens ?? {};
  const cacheRead = tokens.cacheRead ?? 0;
  const cacheWrite = tokens.cacheWrite ?? 0;
  const inputTotal = tokens.inputTotal ?? 0;
  const uncached = tokens.inputUncached ?? Math.max(0, inputTotal - cacheRead - cacheWrite);
  const output = tokens.outputTotal ?? 0;
  const cost = observation?.cost ?? {};
  return {
    input: uncached,
    output,
    cacheRead,
    cacheWrite,
    ...(tokens.cacheWrite1h !== undefined ? { cacheWrite1h: tokens.cacheWrite1h } : {}),
    ...(tokens.reasoning !== undefined ? { reasoning: tokens.reasoning } : {}),
    totalTokens: tokens.totalTokens ?? inputTotal + output,
    cost: {
      input: cost.input ?? 0,
      output: cost.output ?? 0,
      cacheRead: cost.cacheRead ?? 0,
      cacheWrite: cost.cacheWrite ?? 0,
      total: cost.total ?? 0,
    },
  };
}

export interface TransportReplayOptions {
  readonly store: BenchmarkReplayStore;
  readonly scenario: string;
  readonly operationNode: string;
  readonly bindings?: readonly RequestBinding[];
}

export interface ModelTransportReplayOptions extends TransportReplayOptions {
  /** Model role at this operation node; part of the fixture request identity. */
  readonly role: ModelFixtureRequest["role"];
}

/**
 * Builds the exact fixture request for a model transport attempt. The
 * effective payload patch is the recorded effect of the supplied `onPayload`
 * hook applied to an empty payload (the forced workflow's search patch
 * attaches a static tools array); a patch that returns undefined is recorded
 * as null. Non-text user content is folded to bounded structural markers so
 * the canonical bytes stay exact without embedding binary payloads.
 */
export async function modelFixtureRequest(
  model: Model<Api>,
  role: ModelFixtureRequest["role"],
  context: Context,
  options?: SimpleStreamOptions,
): Promise<ModelFixtureRequest> {
  const effectivePayloadPatch = options?.onPayload ? await options.onPayload({}, model) : undefined;
  return {
    model: { provider: model.provider, model: model.id },
    role,
    systemPrompt: context.systemPrompt ?? "",
    userMessage: userMessageFromContext(context),
    maxTokens: options?.maxTokens ?? null,
    reasoning: options?.reasoning ?? null,
    effectivePayloadPatch: (effectivePayloadPatch === undefined || effectivePayloadPatch === null
      ? null
      : (effectivePayloadPatch as Json)),
  };
}

/**
 * Fail-closed model transport replay. Signature-compatible with the frozen
 * RegistryStreamSimple seam so the coordinator can inject it as
 * `NativeTestInjection.registryStreamSimple` in `mode: "transport-replay"`.
 * It never invokes `options.fetch`, `globalThis.fetch`, any network primitive
 * or the passed registry object; citations are delivered only through the
 * supplied `onProviderStreamEvent` hook using recorded chunks; response,
 * usage, error and recorded delay are replayed per attempt.
 */
export function createModelTransportReplay(options: ModelTransportReplayOptions): RegistryStreamSimple {
  const occurrences = new Map<string, number>();
  const nextOccurrence = (hash: string): number => {
    const next = (occurrences.get(hash) ?? 0) + 1;
    occurrences.set(hash, next);
    return next;
  };
  const replay: RegistryStreamSimple = async (_registry, model, context, streamOptions) => {
    // The registry parameter is intentionally ignored (no live fallback);
    // a fixture miss throws and invalidates the block (N1, C30).
    const fixtureRequest = await modelFixtureRequest(model, options.role, context, streamOptions);
    const requestJson = asJson(fixtureRequest);
    const hash = requestSha256(requestJson, options.bindings ?? []);
    const key: FixtureKey = {
      boundary: "model",
      scenario: options.scenario,
      operationNode: options.operationNode,
      requestSha256: hash,
      occurrence: nextOccurrence(hash),
    };
    const record = await options.store.lookup(key, requestJson);
    await sleepWithSignal(record.delayMs, streamOptions?.signal);
    const response = (record.response ?? null) as ModelFixtureResponse | null;
    if (record.error !== undefined || response === null) {
      const errorMessage =
        record.error?.message ?? "replay fixture recorded an error without a message";
      return errorAssistantMessage(model, errorMessage, record.delayMs, record.usage);
    }
    // Citation replay: recorded provider stream events are delivered through
    // the supplied hook only. The recorded chunks are passed exactly as
    // captured, read-only.
    if (streamOptions?.onProviderStreamEvent && response.providerStreamEvents) {
      for (const event of response.providerStreamEvents) {
        await streamOptions.onProviderStreamEvent(event, model);
      }
    }
    const message: AssistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: response.text }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      ...(response.responseId !== undefined ? { responseId: response.responseId } : {}),
      usage: usageFromObservation(record.usage),
      stopReason: "stop",
      timestamp: Date.now(),
      ...(record.delayMs > 0 ? { durationMs: record.delayMs } : {}),
    };
    return message;
  };
  return replay;
}

function errorAssistantMessage(
  model: Model<Api>,
  errorMessage: string,
  delayMs: number,
  usage: UsageObservation | undefined,
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: usageFromObservation(usage),
    stopReason: "error",
    errorMessage,
    timestamp: Date.now(),
    ...(delayMs > 0 ? { durationMs: delayMs } : {}),
  };
}

export interface PageTransportReplayOptions extends TransportReplayOptions {
  /** Configured aggregate byte bound; part of the fetch fixture request identity. */
  readonly maxResponseBytes: number;
}

/**
 * Fail-closed page/catalogue transport replay below the real FetchClient.
 * Returns a chunked ReadableStream body so the client's incremental reads,
 * byte limits and cancellation run for real. Never performs network I/O.
 */
export function createPageTransportReplay(options: PageTransportReplayOptions): PageTransport {
  const occurrences = new Map<string, number>();
  const replay: PageTransport = async (url, request: PageTransportRequest) => {
    const fixtureRequest: FetchFixtureRequest = {
      url,
      method: request.method,
      accept: request.headers["accept"] ?? request.headers["Accept"] ?? "",
      browser: request.browser,
      proxyConfigured: request.proxy !== undefined,
      maxResponseBytes: options.maxResponseBytes,
    };
    const requestJson = asJson(fixtureRequest);
    const hash = requestSha256(requestJson, options.bindings ?? []);
    const occurrence = (occurrences.get(hash) ?? 0) + 1;
    occurrences.set(hash, occurrence);
    const key: FixtureKey = {
      boundary: "fetch",
      scenario: options.scenario,
      operationNode: options.operationNode,
      requestSha256: hash,
      occurrence,
    };
    const record = await options.store.lookup(key, requestJson);
    await sleepWithSignal(record.delayMs, request.signal);
    if (record.error !== undefined) {
      const error = new Error(record.error.message);
      error.name = record.error.kind === "abort" ? "AbortError" : "FetchReplayError";
      throw error;
    }
    const response = record.response as FetchFixtureResponse | undefined;
    if (response === undefined || typeof response.status !== "number") {
      // Fail closed as a miss: the fixture did not freeze a usable response.
      throw new ReplayMissError(
        "not-found",
        `Fetch fixture for ${key.operationNode} occurrence ${key.occurrence} has no usable response body`,
        key,
      );
    }
    const bytes = decodeBody(response);
    const headers = new Map<string, string>();
    for (const [name, value] of Object.entries(response.headers ?? {})) headers.set(name.toLowerCase(), value);
    const responseUrl = response.finalUrl ?? url;
    const pageResponse: PageTransportResponse = {
      status: response.status,
      url: responseUrl,
      headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
      body: chunkedStream(bytes, request.signal),
    };
    return pageResponse;
  };
  return replay;
}

function decodeBody(response: FetchFixtureResponse): Uint8Array {
  if (response.bodyBase64 !== undefined) return new Uint8Array(Buffer.from(response.bodyBase64, "base64"));
  if (response.bodyText !== undefined) return new TextEncoder().encode(response.bodyText);
  return new Uint8Array(0);
}

const CHUNK_BYTES = 16 * 1024;

function chunkedStream(bytes: Uint8Array, signal: AbortSignal | undefined): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (signal?.aborted) {
        controller.error(abortError());
        return;
      }
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const end = Math.min(offset + CHUNK_BYTES, bytes.length);
      controller.enqueue(bytes.slice(offset, end));
      offset = end;
    },
    cancel() {
      // Reader cancellation is honoured; nothing to clean up (no sockets).
    },
  });
}
