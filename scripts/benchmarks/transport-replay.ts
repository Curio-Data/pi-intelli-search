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
// real). The frozen `NativeTestInjection` accepts exactly ONE
// `registryStreamSimple` per loaded runtime and its arguments carry no scope,
// call id, role or page id, so a shared instance derives the operation node
// and role from deterministic request content through a caller-supplied
// resolver. Ambiguity invalidates the block: when the store holds identical
// request bytes under two different nodes, or the resolver cannot identify a
// unique node/role, replay stops with an error and never guesses. There is
// no live fallback path anywhere in this module. The page transport helper
// sits below the real FetchClient (incremental ReadableStream bodies keep
// real permits, stream limits, comparison, staging and cleanup exercised).
//
// Recorded usage reaches the native attempt capture through the same two
// channels the live wire uses (Observed in src/llm.ts executeAttempt and
// src/native-usage.ts): a recorded provider-response observation is
// re-encoded into the wire usage-event chunk `chunk()` parses and delivered
// through `onProviderStreamEvent` (raw channel, takes precedence), while a
// recorded sdk-normalized observation rides the resolved message's SDK usage
// (the capture's conservative fallback re-admits exactly its positive
// fields). SDK zero placeholders never become observations, and construction
// simulates the actual capture over the exact inputs the replay will deliver
// and fails closed when the frozen observation is not reproduced exactly
// (see usageReplayInvalidReason). Error records replay as resolved
// provider-failure messages by default (the adapter's behaviour for provider
// errors, Observed in pi-ai 1.1.0 api/openai-completions.js); `kind: "throw"`
// reproduces a transport rejection, the only live path whose observation is
// raw-only and can carry costBasis "unknown".
//
// Timing uses real host wall time: the native transport seam does not inject
// a clock, and deterministic injected-clock comparisons are a separate core
// population (BUILDER-HANDOFF, P3 Recorder and Analysis).
//
// Cancellation mirrors the live stream (pi-ai 1.1.0
// api/openai-completions.js: "output.stopReason = options?.signal?.aborted ?
// 'aborted' : 'error'"): an abort during the recorded delay resolves an
// AssistantMessage with stopReason "aborted" instead of rejecting, so the
// real policy exercises its live branch. The fixture occurrence is still
// consumed: the attempt started and was then cancelled, which counts as
// consumed-but-not-delivered, never as a skipped or missed response.

import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  SimpleStreamOptions,
  Usage,
} from "@earendil-works/pi-ai";
import type { RegistryStreamSimple } from "../../docs/plans/codemode/NATIVE-API.js";
import type {
  PageTransport,
  PageTransportRequest,
  PageTransportResponse,
} from "../../src/core/execution-contracts.js";
import { createNativeUsageCapture } from "../../src/native-usage.js";
import {
  asJson,
  canonicalJson,
  requestSha256,
  sha256Canonical,
  type RequestBinding,
} from "./canonical.js";
import { ReplayMissError, type BenchmarkReplayStore } from "./replay-store.js";
import type {
  FetchFixtureRequest,
  FixtureKey,
  FixtureRecord,
  Json,
  ModelFixtureRequest,
  ModelRole,
  UsageObservation,
} from "./contracts.js";

/** Recorded wire shape of a model fixture response (inside FixtureRecord.response). */
export interface ModelFixtureResponse {
  readonly text: string;
  readonly providerStreamEvents?: readonly Json[];
  readonly responseId?: string;
  /** Recorded provider response metadata replayed through `options.onResponse`. */
  readonly providerResponse?: {
    readonly status: number;
    readonly headers?: Readonly<Record<string, string>>;
  };
}

/** Recorded wire shape of a fetch/catalogue fixture response (inside FixtureRecord.response). */
export interface FetchFixtureResponse {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly finalUrl?: string;
  readonly bodyText?: string;
  readonly bodyBase64?: string;
}

/** Result of deriving node identity from deterministic request content. */
export type ModelNodeResolution =
  | { readonly operationNode: string; readonly role: ModelRole }
  | { readonly ambiguous: true; readonly detail: string };

/**
 * Derives the fixture operation node and model role from the request content
 * (without role, which is the value being derived). The resolver must be
 * deterministic. Returning `ambiguous` stops the replay block; it must never
 * guess between candidates.
 */
export type ModelNodeResolver = (
  request: Omit<ModelFixtureRequest, "role">,
  model: Model<Api>,
  context: Context,
) => ModelNodeResolution;

/** Result of deriving a page/catalogue node from a fetch request. */
export type PageNodeResolution =
  { readonly operationNode: string } | { readonly ambiguous: true; readonly detail: string };

/** Derives the fixture operation node for one physical fetch request. */
export type PageNodeResolver = (request: FetchFixtureRequest) => PageNodeResolution;

function abortMessage(model: Model<Api>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: zeroUsage(),
    stopReason: "aborted",
    errorMessage: "Transport replay aborted before the recorded response was delivered",
    timestamp: Date.now(),
  };
}

function zeroUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function waitRecordedDelay(
  delayMs: number,
  signal: AbortSignal | undefined,
): Promise<"elapsed" | "aborted"> {
  if (signal?.aborted) return Promise.resolve("aborted");
  if (delayMs <= 0) return Promise.resolve("elapsed");
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve("elapsed");
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      resolve("aborted");
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
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
      else parts.push(`[${block.type}:${sha256Canonical(block)}]`);
    }
    return parts.join("\n");
  }
  return "";
}

/** Maps a recorded canonical usage observation back to the pi-ai Usage view. */
export function usageFromObservation(observation: UsageObservation | undefined): Usage {
  const tokens = observation?.tokens ?? {};
  const cacheRead = tokens.cacheRead ?? 0;
  const cacheWrite = tokens.cacheWrite ?? 0;
  // The pi-ai SDK input field is the UNCACHED count. Derive it from the
  // recorded prompt total ONLY when both cache subsets are known: unknown
  // subsets cannot establish uncached input (C16), and defaulting an absent
  // subset to zero would invent one. Otherwise the field keeps the SDK's
  // zero placeholder, which the native usage capture deliberately ignores,
  // so it never becomes an observation.
  const input =
    tokens.inputUncached ??
    (tokens.inputTotal !== undefined &&
    tokens.cacheRead !== undefined &&
    tokens.cacheWrite !== undefined
      ? Math.max(0, tokens.inputTotal - cacheRead - cacheWrite)
      : 0);
  const output = tokens.outputTotal ?? 0;
  const cost = observation?.cost ?? {};
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    ...(tokens.cacheWrite1h !== undefined ? { cacheWrite1h: tokens.cacheWrite1h } : {}),
    ...(tokens.reasoning !== undefined ? { reasoning: tokens.reasoning } : {}),
    // The SDK computes a missing total from its components
    // (parseChunkUsage: input + output + cacheRead + cacheWrite); mirror that
    // formula instead of inventing prompt-total + output arithmetic.
    totalTokens: tokens.totalTokens ?? input + output + cacheRead + cacheWrite,
    cost: {
      input: cost.input ?? 0,
      output: cost.output ?? 0,
      cacheRead: cost.cacheRead ?? 0,
      cacheWrite: cost.cacheWrite ?? 0,
      total: cost.total ?? 0,
    },
  };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when a recorded provider stream event already carries a wire usage object. */
function eventCarriesUsage(event: Json): boolean {
  return isJsonObject(event) && isJsonObject(event["usage"]);
}

/**
 * Re-encodes a recorded provider-response usage observation into the wire
 * usage-event shape the native usage capture parses (`createNativeUsageCapture`
 * `chunk()`: prompt_tokens/completion_tokens/total_tokens/cost plus
 * prompt_tokens_details.cached_tokens/cache_write_tokens and
 * completion_tokens_details.reasoning_tokens, with the request id). This is
 * the inverse of the normalisation the capture itself applies
 * (`normalizeMcpUsage`), so delivering it through the recorded-event channel
 * (`onProviderStreamEvent`, never `options.fetch`) makes the capture
 * reproduce the recorded observation exactly: source `provider-response`,
 * explicit zeros preserved, reported cost and providerRequestId intact, and
 * unknown fields still unknown. Only recorded values are re-encoded; no
 * field is invented. A `catalogue` cost is deliberately NOT encoded: it did
 * not come from the wire but from the SDK estimate, so it rides the resolved
 * message's SDK usage and re-enters through the capture's estimate branch
 * with its `catalogue` basis. Returns null when the observation carries
 * nothing the event channel can represent.
 */
export function usageProviderEventFromObservation(observation: UsageObservation): Json | null {
  const tokens = observation.tokens;
  const details: Record<string, number> = {};
  if (tokens.cacheRead !== undefined) details["cached_tokens"] = tokens.cacheRead;
  if (tokens.cacheWrite !== undefined) details["cache_write_tokens"] = tokens.cacheWrite;
  const completionDetails: Record<string, number> = {};
  if (tokens.reasoning !== undefined) completionDetails["reasoning_tokens"] = tokens.reasoning;
  const usage: Record<string, number | Record<string, number>> = {};
  if (tokens.inputTotal !== undefined) usage["prompt_tokens"] = tokens.inputTotal;
  if (tokens.outputTotal !== undefined) usage["completion_tokens"] = tokens.outputTotal;
  if (tokens.totalTokens !== undefined) usage["total_tokens"] = tokens.totalTokens;
  if (observation.costBasis === "reported" && observation.cost?.total !== undefined) {
    usage["cost"] = observation.cost.total;
  }
  if (Object.keys(details).length > 0) usage["prompt_tokens_details"] = details;
  if (Object.keys(completionDetails).length > 0)
    usage["completion_tokens_details"] = completionDetails;
  if (Object.keys(usage).length === 0) return null;
  return {
    ...(observation.providerRequestId !== undefined ? { id: observation.providerRequestId } : {}),
    usage: usage as unknown as Json,
  };
}

/** Wire usage events carried by a recorded response, in recorded order. */
function recordedUsageEvents(response: ModelFixtureResponse | null): readonly Json[] {
  return (response?.providerStreamEvents ?? []).filter(eventCarriesUsage);
}

/** Canonical-equality diff of two JSON values as a short list of differing paths. */
function differingJsonPaths(derived: unknown, recorded: unknown, prefix = "$"): readonly string[] {
  if (derived === undefined || recorded === undefined) {
    // A key present on one side only: canonical serialisation omits
    // undefined object values, so compare presence directly.
    return derived === recorded ? [] : [prefix];
  }
  if (canonicalJson(derived) === canonicalJson(recorded)) return [];
  if (isJsonObject(derived) && isJsonObject(recorded)) {
    const paths: string[] = [];
    for (const key of new Set([...Object.keys(derived), ...Object.keys(recorded)])) {
      paths.push(...differingJsonPaths(derived[key], recorded[key], `${prefix}.${key}`));
    }
    return paths;
  }
  return [prefix];
}

/**
 * Construction-time qualification of a record's frozen usage against the
 * ACTUAL native capture (`createNativeUsageCapture`, the same module
 * `src/llm.ts` `executeAttempt` wires per attempt): the exact event/sdk
 * inputs the replay will deliver are simulated, and the derived observation
 * must equal the recorded observation field-for-field. Anything else fails
 * the block closed (ReplayMissError "invalid-file") rather than silently
 * replaying different accounting: C16/C30 require exact observations or
 * invalidation, never silent field loss, invented provenance or an
 * observation the record does not freeze.
 *
 * Consequences the simulation enforces (all Observed in src/native-usage.ts
 * and src/core/usage.ts):
 * - A `provider-response` observation must be exactly representable on the
 *   usage-event wire: `inputUncached` without BOTH cache subsets, a
 *   `cacheWrite1h` field, reported cost subfields beyond `total`, or an
 *   empty observation all derive differently and invalidate the block.
 * - An `unknown` cost basis is raw-only: only a transport-rejection record
 *   (`error.kind === "throw"`, observed from raw events alone) reproduces
 *   it; a resolved success or error record always supplies an SDK usage
 *   whose cost estimate the capture labels `catalogue`.
 * - Recorded provider events carrying usage must AGREE with the frozen
 *   observation: the capture derives from the latest cumulative event
 *   snapshot, so a disagreeing `record.usage` would silently replay
 *   different accounting and instead invalidates the block.
 * - A usage-bearing event without a frozen observation would make the live
 *   ledger observe usage the fixture never froze.
 * - An `sdk-normalized` observation must survive the capture's conservative
 *   SDK fallback exactly and cannot coexist with wire usage events (raw
 *   takes precedence over the SDK channel).
 */
function usageReplayInvalidReason(record: {
  readonly key: FixtureKey;
  readonly response?: Json;
  readonly error?: { readonly kind: string; readonly message: string };
  readonly usage?: FixtureRecord["usage"];
}): string | null {
  const usage = record.usage;
  const response = (record.response ?? null) as ModelFixtureResponse | null;
  const wireUsageEvents = recordedUsageEvents(response);
  if (usage === undefined) {
    if (wireUsageEvents.length > 0) {
      return "the recorded provider events carry a usage object but the record freezes no observation";
    }
    return null;
  }
  const throwRecord = record.error?.kind === "throw";
  const capture = createNativeUsageCapture();
  for (const event of wireUsageEvents) capture.chunk(event);
  if (usage.source === "provider-response") {
    if (wireUsageEvents.length === 0) {
      const reconstructed = usageProviderEventFromObservation(usage);
      if (reconstructed === null) {
        return "the provider-response observation has no usage-event-representable field";
      }
      capture.chunk(reconstructed);
    }
  } else if (wireUsageEvents.length > 0) {
    return "an sdk-normalized observation cannot coexist with recorded wire usage events; the raw channel takes precedence";
  }
  // A throw record observes from raw events only (no SDK usage exists); a
  // resolved record observes with the SDK mirror the replay will attach.
  const sdk = throwRecord ? undefined : usageFromObservation(usage);
  const derived = capture.observation(sdk);
  if (derived === undefined) {
    return "the capture derives no observation, but the record freezes one";
  }
  if (canonicalJson(asJson(derived)) !== canonicalJson(asJson(usage))) {
    const paths = differingJsonPaths(asJson(derived), asJson(usage));
    return `the capture would derive a different observation than the recorded one (differing paths: ${paths.slice(0, 8).join(", ")}${paths.length > 8 ? ", …" : ""})`;
  }
  return null;
}

export interface TransportReplayOptions {
  readonly store: BenchmarkReplayStore;
  readonly scenario: string;
  readonly bindings?: readonly RequestBinding[];
}

function groupRecordsByRequest(
  store: BenchmarkReplayStore,
  bindings: readonly RequestBinding[] | undefined,
  boundary: FixtureKey["boundary"],
): Map<string, Set<string>> {
  // Construction-time ambiguity guard: identical canonical request bytes
  // recorded under two different operation nodes cannot be distinguished by
  // any content-derived resolver. One shared instance must refuse such a
  // fixture set instead of guessing.
  const groups = new Map<string, Set<string>>();
  for (const record of store.records()) {
    if (record.key.boundary !== boundary) continue;
    const canonical = canonicalJson(record.request);
    const nodes = groups.get(canonical) ?? new Set<string>();
    nodes.add(record.key.operationNode);
    groups.set(canonical, nodes);
  }
  void bindings;
  return groups;
}

function qualifyReplay(store: BenchmarkReplayStore, check: () => void): void {
  try {
    check();
  } catch (error) {
    if (error instanceof ReplayMissError) store.invalidate(error);
    throw error;
  }
}

function assertNoAmbiguousNodes(
  groups: Map<string, Set<string>>,
  scenario: string,
  boundary: string,
): void {
  for (const [canonical, nodes] of groups) {
    if (nodes.size > 1) {
      throw new ReplayMissError(
        "ambiguous-node",
        `Ambiguous replay fixtures for scenario "${scenario}" (${boundary}): identical request bytes ${canonical.slice(0, 48)}… are recorded under ${nodes.size} different operation nodes (${[...nodes].join(", ")}); content-derived replay cannot distinguish them and must invalidate the block`,
      );
    }
  }
}

/**
 * Builds the exact fixture request for a model transport attempt, without the
 * role (which the resolver derives). Non-text user content is folded to a
 * content-hashed structural marker so distinct blocks keep distinct
 * identities; the canonical text of native pipeline calls (a single text
 * user message) is exact. The effective payload patch is the recorded effect
 * of the supplied `onPayload` hook applied to an empty payload (the forced
 * workflow's search patch attaches a static tools array); a patch that
 * returns undefined is recorded as null.
 */
export async function modelFixtureRequest(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): Promise<Omit<ModelFixtureRequest, "role">> {
  const effectivePayloadPatch = options?.onPayload ? await options.onPayload({}, model) : undefined;
  return {
    model: { provider: model.provider, model: model.id },
    systemPrompt: context.systemPrompt ?? "",
    userMessage: userMessageFromContext(context),
    maxTokens: options?.maxTokens ?? null,
    reasoning: options?.reasoning ?? null,
    effectivePayloadPatch:
      effectivePayloadPatch === undefined || effectivePayloadPatch === null
        ? null
        : (effectivePayloadPatch as Json),
  };
}

export interface ModelTransportReplayOptions extends TransportReplayOptions {
  /** Deterministic node/role derivation for the one shared instance. */
  readonly resolveNode: ModelNodeResolver;
}

/**
 * Fail-closed model transport replay for the single native seam. The frozen
 * `NativeTestInjection` carries no scope at the `RegistryStreamSimple`
 * signature, so this ONE instance serves every stage of a run: the resolver
 * derives `{ operationNode, role }` from request content, the derived role
 * joins the request before hashing, and occurrence counters key by exact
 * request hash. It never invokes `options.fetch`, `globalThis.fetch`, any
 * network primitive or the passed registry object; citations are delivered
 * only through the supplied `onProviderStreamEvent` hook using recorded
 * chunks; recorded `providerResponse` metadata is replayed through
 * `onResponse`; response, usage, error and recorded delay are replayed per
 * attempt. Ambiguous derivation throws `ReplayMissError` (reason
 * "ambiguous-node") and invalidates the block.
 */
export function createModelTransportReplay(
  options: ModelTransportReplayOptions,
): RegistryStreamSimple {
  const bindings = options.bindings ?? [];
  const groups = groupRecordsByRequest(options.store, bindings, "model");
  qualifyReplay(options.store, () => assertNoAmbiguousNodes(groups, options.scenario, "model"));
  // Construction-time usage qualification (see usageReplayInvalidReason):
  // the frozen observation must be exactly reproducible through the actual
  // capture channels, or the block fails closed instead of silently
  // replaying different accounting.
  for (const record of options.store.records()) {
    if (record.key.boundary !== "model") continue;
    const reason = usageReplayInvalidReason(record);
    if (reason !== null) {
      options.store.invalidate(
        new ReplayMissError(
          "invalid-file",
          `Invalid model fixture usage for scenario "${options.scenario}" (${record.key.operationNode} occurrence ${record.key.occurrence}): ${reason}; no live capture path reproduces the frozen observation, so replay must fail closed`,
          record.key,
        ),
      );
    }
  }
  const occurrences = new Map<string, number>();
  const nextOccurrence = (hash: string): number => {
    const next = (occurrences.get(hash) ?? 0) + 1;
    occurrences.set(hash, next);
    return next;
  };
  const replay: RegistryStreamSimple = async (_registry, model, context, streamOptions) => {
    // The registry parameter is intentionally ignored (no live fallback);
    // a fixture miss or ambiguous derivation throws and invalidates the
    // block (N1, C30).
    const requestWithoutRole = await modelFixtureRequest(model, context, streamOptions);
    const resolution = options.resolveNode(requestWithoutRole, model, context);
    if ("ambiguous" in resolution) {
      return options.store.invalidate(
        new ReplayMissError(
          "ambiguous-node",
          `Ambiguous model node derivation for scenario "${options.scenario}": ${resolution.detail}`,
        ),
      );
    }
    const fixtureRequest: ModelFixtureRequest = { ...requestWithoutRole, role: resolution.role };
    const requestJson = asJson(fixtureRequest);
    const hash = requestSha256(requestJson, bindings);
    const key: FixtureKey = {
      boundary: "model",
      scenario: options.scenario,
      operationNode: resolution.operationNode,
      requestSha256: hash,
      occurrence: nextOccurrence(hash),
    };
    const record = await options.store.lookup(key, requestJson);
    if ((await waitRecordedDelay(record.delayMs, streamOptions?.signal)) === "aborted") {
      return abortMessage(model);
    }
    const response = (record.response ?? null) as ModelFixtureResponse | null;
    if (response?.providerResponse && streamOptions?.onResponse) {
      await streamOptions.onResponse(
        {
          status: response.providerResponse.status,
          headers: { ...(response.providerResponse.headers ?? {}) },
        },
        model,
      );
    }
    // Deliver ALL recorded provider events (citations, wire usage chunks)
    // through the supplied hook only, in recorded order, on success, error
    // and rejection paths alike: the live stream delivers chunks before the
    // message finalises, and the per-attempt citation and usage capture reads
    // them on every dispatched attempt, including retries and failures
    // (C16: one terminal observation per dispatched attempt). Recorded
    // provider-response usage observations that no recorded event carries are
    // re-encoded into the same wire shape (usageProviderEventFromObservation,
    // the inverse of the capture's own normalisation) so the capture
    // reproduces the recorded observation instead of reading the SDK zero
    // placeholders. Nothing is delivered through `options.fetch` (N1); when
    // the host supplies no hook there is no channel and delivery is skipped.
    if (streamOptions?.onProviderStreamEvent) {
      const recordedEvents = response?.providerStreamEvents ?? [];
      for (const event of recordedEvents) {
        await streamOptions.onProviderStreamEvent(event, model);
      }
      if (record.usage?.source === "provider-response" && !recordedEvents.some(eventCarriesUsage)) {
        const usageEvent = usageProviderEventFromObservation(record.usage);
        if (usageEvent !== null) {
          await streamOptions.onProviderStreamEvent(usageEvent, model);
        }
      }
    }
    if (record.error !== undefined) {
      const errorMessage = record.error.message;
      if (record.error.kind === "throw") {
        // Transport rejection: the native capture observes from the recorded
        // provider events only (observation(undefined), Observed in
        // src/llm.ts executeAttempt's rejection branch), which is the one
        // live path whose observation can carry costBasis "unknown". The
        // thrown message reaches the retry classifier exactly like a live
        // transport failure.
        throw new Error(errorMessage);
      }
      return errorAssistantMessage(model, errorMessage, record.delayMs, record.usage);
    }
    if (response === null) {
      const errorMessage = "replay fixture recorded an error without a message";
      return errorAssistantMessage(model, errorMessage, record.delayMs, record.usage);
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
  /** Deterministic node derivation for the one shared page instance. */
  readonly resolveNode: PageNodeResolver;
}

/**
 * Fail-closed page/catalogue transport replay below the real FetchClient,
 * serving every page node of a run through one shared instance. Returns a
 * chunked ReadableStream body so the client's incremental reads, byte limits
 * and cancellation run for real. Never performs network I/O.
 */
export function createPageTransportReplay(options: PageTransportReplayOptions): PageTransport {
  const bindings = options.bindings ?? [];
  qualifyReplay(options.store, () =>
    assertNoAmbiguousNodes(
      groupRecordsByRequest(options.store, bindings, "fetch"),
      options.scenario,
      "fetch",
    ),
  );
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
    const resolution = options.resolveNode(fixtureRequest);
    if ("ambiguous" in resolution) {
      return options.store.invalidate(
        new ReplayMissError(
          "ambiguous-node",
          `Ambiguous page node derivation for scenario "${options.scenario}": ${resolution.detail}`,
        ),
      );
    }
    const requestJson = asJson(fixtureRequest);
    const hash = requestSha256(requestJson, bindings);
    const occurrence = (occurrences.get(hash) ?? 0) + 1;
    occurrences.set(hash, occurrence);
    const key: FixtureKey = {
      boundary: "fetch",
      scenario: options.scenario,
      operationNode: resolution.operationNode,
      requestSha256: hash,
      occurrence,
    };
    const record = await options.store.lookup(key, requestJson);
    if ((await waitRecordedDelay(record.delayMs, request.signal)) === "aborted") {
      const error = new Error(
        "Transport replay aborted before the recorded response was delivered",
      );
      error.name = "AbortError";
      throw error;
    }
    if (record.error !== undefined) {
      const error = new Error(record.error.message);
      error.name = record.error.kind === "abort" ? "AbortError" : "FetchReplayError";
      throw error;
    }
    const response = record.response as FetchFixtureResponse | undefined;
    if (response === undefined || typeof response.status !== "number") {
      // Fail closed as a miss: the fixture did not freeze a usable response.
      return options.store.invalidate(
        new ReplayMissError(
          "not-found",
          `Fetch fixture for ${key.operationNode} occurrence ${key.occurrence} has no usable response body`,
          key,
        ),
      );
    }
    const bytes = decodeBody(response);
    const headers = new Map<string, string>();
    for (const [name, value] of Object.entries(response.headers ?? {}))
      headers.set(name.toLowerCase(), value);
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

/**
 * Builds a resolver that requires EXACTLY ONE rule to match. Zero or multiple
 * matches return `ambiguous`, so an overlapping or incomplete rule set stops
 * the block instead of picking by order.
 */
export function uniqueMatchModelResolver(
  rules: ReadonlyArray<{
    matches(request: Omit<ModelFixtureRequest, "role">): boolean;
    operationNode: string;
    role: ModelRole;
  }>,
): ModelNodeResolver {
  return (request) => {
    const hits = rules.filter((rule) => {
      try {
        return rule.matches(request);
      } catch {
        return false;
      }
    });
    if (hits.length === 1) return { operationNode: hits[0]!.operationNode, role: hits[0]!.role };
    return {
      ambiguous: true,
      detail: `${hits.length} resolver rules matched request (systemPrompt "${request.systemPrompt.slice(0, 40)}…", userMessage "${request.userMessage.slice(0, 40)}…")`,
    };
  };
}

/** Page-node variant of {@link uniqueMatchModelResolver}. */
export function uniqueMatchPageResolver(
  rules: ReadonlyArray<{ matches(request: FetchFixtureRequest): boolean; operationNode: string }>,
): PageNodeResolver {
  return (request) => {
    const hits = rules.filter((rule) => {
      try {
        return rule.matches(request);
      } catch {
        return false;
      }
    });
    if (hits.length === 1) return { operationNode: hits[0]!.operationNode };
    return {
      ambiguous: true,
      detail: `${hits.length} resolver rules matched fetch request (${request.method} ${request.url})`,
    };
  };
}

/**
 * Role inference by exact system-prompt match. The four pipeline roles use
 * four distinct prompts (Observed in src/core/prompts.ts: SEARCH_SYSTEM_PROMPT,
 * EXTRACTION_SYSTEM_PROMPT, COLLATION_SYSTEM_PROMPT, CACHE_SUGGEST_PROMPT),
 * so the coordinator wires those constants here; the library itself stays
 * host-neutral and takes the mapping as configuration. An unknown prompt
 * yields `null` and the caller decides whether that is ambiguous.
 */
export function createRoleInferencer(byPrompt: {
  readonly search: string;
  readonly extract: string;
  readonly collate: string;
  readonly suggest: string;
}): (systemPrompt: string) => ModelRole | null {
  return (systemPrompt) => {
    for (const [role, prompt] of Object.entries(byPrompt) as Array<[ModelRole, string]>) {
      if (systemPrompt === prompt) return role;
    }
    return null;
  };
}

function decodeBody(response: FetchFixtureResponse): Uint8Array {
  if (response.bodyBase64 !== undefined)
    return new Uint8Array(Buffer.from(response.bodyBase64, "base64"));
  if (response.bodyText !== undefined) return new TextEncoder().encode(response.bodyText);
  return new Uint8Array(0);
}

const CHUNK_BYTES = 16 * 1024;

function chunkedStream(
  bytes: Uint8Array,
  signal: AbortSignal | undefined,
): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (signal?.aborted) {
        controller.error(abortStreamError());
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

function abortStreamError(): Error {
  const error = new Error("Body replay aborted by request signal");
  error.name = "AbortError";
  return error;
}
