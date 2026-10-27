// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Benchmark-only main-usage wire-presence observer and evidence emitter (T31).
//
// The canonical assistant message carries SDK-normalised usage whose required
// fields are zero placeholders: pi-ai's openai-completions `parseChunkUsage`
// maps an absent `prompt_tokens` to 0 and derives `input` with
// `Math.max(0, prompt - cacheRead - cacheWrite)`, and its responses-family
// `finalizeResponse` does the same with `|| 0` fallbacks (Observed in the
// installed Pi 1.3.0 host's bundled pi-ai 1.3.0
// dist/api/openai-completions.js and dist/api/openai-responses-shared.js;
// byte-identical in this worktree's dev pi-ai 1.1.0). Per-field wire absence
// therefore cannot be recovered from a finalised message. This module is the
// missing emitter side: it subscribes to the supported host events, records
// the RAW wire usage field presence of the main agent loop's provider
// streams, correlates each observation to the finalised assistant message,
// and emits schemaVersion 2 evidence records for `parseUsageEvents`.
//
// Supported host events (Observed in the installed Pi 1.3.0
// dist/core/extensions/types.d.ts and dist/core/sdk.js):
//
// - `provider_stream_event` `{ data, provider, api, model }`: fired by
//   `handleProviderStreamEvent` for every parsed provider stream event before
//   Pi normalises it. The session wires this handler into the agent loop's
//   own stream options (`createLoopConfig` in pi-agent-core dist/agent.js
//   passes `onProviderStreamEvent` into every `streamAssistantResponse`
//   call), so the event fires for main agent-loop requests and for cache-warm
//   requests (dist/core/cache-warmer.js spreads the captured
//   `run.options`, which include the handler, into its own `streamSimple`
//   call). It does NOT fire for extension model calls (the intelli pipeline
//   supplies its own callbacks to `ctx.modelRegistry.streamSimple()` and
//   ModelRuntime.prepareRequest injects no session handler), nor for
//   compaction or summary calls, which stream outside the agent loop.
// - `before_provider_request` `{ payload }`: fired once per logical provider
//   request (pi-ai calls `options.onPayload` once, before its retry wrapper).
//   Its return value replaces the payload, so a read-only observer MUST
//   return nothing. This collector's handler returns `undefined` and never
//   mutates the payload; it records only a window count.
// - `message_end` `{ message }`: the finalised canonical message. Assistant
//   messages carry `responseId`, which pi-ai sets from the wire:
//   openai-completions `output.responseId ||= chunk.id` (first chunk id) and
//   responses-family `response.created`/`finalizeResponse`
//   `output.responseId = response.id`. The response id is therefore an exact
//   correlation key between a wire stream and its finalised message.
//
// Correlation policy (fail closed):
//
// - A wire usage observation is keyed by the response id carried on the wire.
//   At assistant `message_end`, the observation with the message's
//   `responseId` is consumed. Cache-warm calls, failed attempts and any other
//   stream whose id never finalises stays UNCORRELATED: it is never folded
//   into a message and is reported in `uncorrelatedResponseIds`.
// - Usage chunks without any response id attach to the last id seen for the
//   same provider/model and mark the record `ambiguous`; ambiguous records
//   make no usage-presence claim (`usageObserved: null`).
// - A response id consumed by two distinct canonical messages marks both
//   records `ambiguous` and emits a conflict record for the earlier message,
//   so the parser fails closed on both.
// - Record content is a whitelist projection: numeric usage fields, response
//   ids, api/provider/model names and counts. Message content, provider
//   headers and credentials never enter records (the stream event carries
//   parsed chunks only, and the request observer ignores the payload body).

import { asJson, canonicalJson, sha256Canonical } from "./canonical.js";
import type { Json } from "./contracts.js";
import type { TokenObservation } from "./contracts.js";

/** Evidence record type shared with `usage-parser.ts` v1 sidecars. */
export const MAIN_USAGE_EVIDENCE_TYPE = "intelli_benchmark_main_usage";
/** Internal schema version of the richer field-presence record. */
export const MAIN_USAGE_EVIDENCE_V2_SCHEMA_VERSION = 2;

/** Cap on retained uncorrelated response ids per record; counts stay exact. */
const DEFAULT_MAX_UNCORRELATED_IDS = 32;

/** Maximum accepted length for a wire response id string in records. */
const MAX_RESPONSE_ID_LENGTH = 256;

/**
 * Raw wire usage field presence. `null` means the field was absent from the
 * wire usage object; an explicit wire zero is a reported value and stays `0`.
 */
export interface WireUsageFields {
  /** Completions `prompt_tokens` / responses `input_tokens` (cache-inclusive total). */
  readonly inputTokens: number | null;
  /** Completions `prompt_tokens_details.cached_tokens` (or fallback spellings) / responses `input_tokens_details.cached_tokens`. */
  readonly cachedTokens: number | null;
  /** Completions `prompt_tokens_details.cache_write_tokens` / responses `input_tokens_details.cache_write_tokens`. */
  readonly cacheWriteTokens: number | null;
  /** Completions `completion_tokens` / responses `output_tokens`. */
  readonly outputTokens: number | null;
  /** Completions `completion_tokens_details.reasoning_tokens` / responses `output_tokens_details.reasoning_tokens`. */
  readonly reasoningTokens: number | null;
  /** Provider-reported `total_tokens`, retained independently of component arithmetic on either family. */
  readonly totalTokens: number | null;
}

/** Where the usage object was found on the wire. */
export type WireUsageSource = "chunk-usage" | "choice-usage" | "response-usage";

/** How the record's wire observation was matched to the message. */
export type MainUsageCorrelation = "response-id" | "none";

/**
 * schemaVersion 2 main-usage evidence record. `usageObserved` is tri-state:
 * `true` (wire usage object observed for the correlated response id, fields
 * valid), `false` (correlated response id completed with no usage-bearing
 * wire object) or `null` (correlation failed or ambiguous: no claim).
 */
export interface MainUsageEvidenceV2Record {
  readonly type: typeof MAIN_USAGE_EVIDENCE_TYPE;
  readonly schemaVersion: typeof MAIN_USAGE_EVIDENCE_V2_SCHEMA_VERSION;
  /** Canonical sha256 of the unchanged finalised assistant message. */
  readonly messageSha256: string;
  /** Correlation key actually used; null when the message carries no responseId. */
  readonly responseId: string | null;
  readonly correlation: MainUsageCorrelation;
  readonly usageObserved: boolean | null;
  /** Api of the wire observation; the empty string when no observation exists. */
  readonly api: string;
  readonly usageSource: WireUsageSource | null;
  readonly fields: WireUsageFields | null;
  /** Provider-reported total cost on the wire usage object, when numeric. */
  readonly wireCostTotal: number | null;
  /** True when the observation's attachment was uncertain; makes no claim. */
  readonly ambiguous: boolean;
  readonly uncorrelatedResponseIds: readonly string[];
  readonly uncorrelatedCount: number;
  /** `before_provider_request` windows observed before this record was emitted. */
  readonly requestWindows: number;
}

/** Api families whose wire usage spellings this module extracts. */
const COMPLETIONS_APIS = new Set(["openai-completions"]);
const RESPONSES_APIS = new Set([
  "openai-responses",
  "azure-openai-responses",
  "openai-codex-responses",
]);

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Finite non-negative number check for token counts (negative wire values are noise). */
function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Response id safe for records: nonempty bounded string. */
function safeResponseId(value: unknown): string | null {
  return typeof value === "string" && value !== "" && value.length <= MAX_RESPONSE_ID_LENGTH
    ? value
    : null;
}

const EMPTY_FIELDS: WireUsageFields = {
  inputTokens: null,
  cachedTokens: null,
  cacheWriteTokens: null,
  outputTokens: null,
  reasoningTokens: null,
  totalTokens: null,
};

interface WireObservation {
  readonly api: string;
  readonly provider: string;
  readonly model: string;
  fields: WireUsageFields;
  usageSource: WireUsageSource | null;
  wireCostTotal: number | null;
  attachedWithoutId: boolean;
  usageBearing: boolean;
  consumedBy: string | null; // canonical message hash
}

export interface MainUsageEvidenceDiagnostics {
  /** Total `before_provider_request` windows observed (read-only handler). */
  readonly requestWindows: number;
  /** `provider_stream_event` events received. */
  readonly streamEvents: number;
  /** Stream events whose api has no field spelling support (counted only). */
  readonly unsupportedApiEvents: number;
  /** Usage-bearing wire objects seen. */
  readonly usageBearingObservations: number;
  /** Wire response ids with usage that never correlated to a message. */
  readonly uncorrelatedResponseIds: readonly string[];
  /** Assistant message_end events correlated, by kind. */
  readonly correlated: number;
  readonly unmatched: number;
  readonly ambiguous: number;
}

export interface MainUsageEvidenceCollectorOptions {
  /** Cap for `uncorrelatedResponseIds` per record (default 32). */
  readonly maxUncorrelatedIds?: number;
}

/** Structural host event shapes (host-neutral; no Pi imports). */
export interface BeforeProviderRequestLike {
  readonly type: "before_provider_request";
  readonly payload: unknown;
}
export interface ProviderStreamEventLike {
  readonly type: "provider_stream_event";
  readonly provider: string;
  readonly api: string;
  readonly model: string;
  readonly data: unknown;
}
export interface MessageEndLike {
  readonly type: "message_end";
  readonly message: unknown;
}

export interface MainUsageEvidenceCollector {
  /** Read-only request observer: returns nothing, mutates nothing. */
  onBeforeProviderRequest(event: BeforeProviderRequestLike): undefined;
  onProviderStreamEvent(event: ProviderStreamEventLike): void;
  onMessageEnd(event: MessageEndLike): void;
  /** Emitted evidence records in emission order (v2 only). */
  readonly records: readonly MainUsageEvidenceV2Record[];
  /** Run-wide diagnostics; call after the run settles for final uncorrelated ids. */
  readonly diagnostics: MainUsageEvidenceDiagnostics;
}

interface CompletionsUsageProjection {
  readonly fields: WireUsageFields;
  readonly costTotal: number | null;
}

/**
 * Projects an openai-completions wire usage object onto canonical field
 * presence. Mirrors the spelling precedence Observed in pi-ai
 * `parseChunkUsage`: cached tokens read `prompt_tokens_details.cached_tokens`
 * then `prompt_cache_hit_tokens` then `cached_tokens` (null-skipping `??`
 * chain, so an explicit 0 spelling wins over a later spelling). pi-ai reads
 * `cache_write_tokens` and the responses-family spellings with `|| 0`; this
 * projection records presence for any finite non-negative number including 0
 * (honest divergence: a wire 0 stays a present value instead of collapsing
 * to the SDK zero placeholder).
 */
function projectCompletionsUsage(usage: Record<string, unknown>): CompletionsUsageProjection {
  const details = isJsonObject(usage["prompt_tokens_details"]) ? usage["prompt_tokens_details"] : {};
  const completionDetails = isJsonObject(usage["completion_tokens_details"])
    ? usage["completion_tokens_details"]
    : {};
  const cachedCandidates = [details["cached_tokens"], usage["prompt_cache_hit_tokens"], usage["cached_tokens"]];
  const cachedTokens = cachedCandidates.find((value) => tokenCount(value) !== null) ?? null;
  const cachedValue = cachedTokens === null ? null : tokenCount(cachedTokens);
  const rawCost = usage["cost"];
  const costTotal = finiteNumber(rawCost) ?? (isJsonObject(rawCost) ? finiteNumber(rawCost["total"]) : null);
  return {
    fields: {
      inputTokens: tokenCount(usage["prompt_tokens"]),
      cachedTokens: cachedValue,
      cacheWriteTokens: tokenCount(details["cache_write_tokens"]),
      outputTokens: tokenCount(usage["completion_tokens"]),
      reasoningTokens: tokenCount(completionDetails["reasoning_tokens"]),
      totalTokens: tokenCount(usage["total_tokens"]),
    },
    costTotal,
  };
}

/** Projects a responses-family wire `response.usage` object (Observed in pi-ai `finalizeResponse`). */
function projectResponsesUsage(usage: Record<string, unknown>): CompletionsUsageProjection {
  const inputDetails = isJsonObject(usage["input_tokens_details"]) ? usage["input_tokens_details"] : {};
  const outputDetails = isJsonObject(usage["output_tokens_details"]) ? usage["output_tokens_details"] : {};
  const rawCost = usage["cost"];
  const costTotal = finiteNumber(rawCost) ?? (isJsonObject(rawCost) ? finiteNumber(rawCost["total"]) : null);
  return {
    fields: {
      inputTokens: tokenCount(usage["input_tokens"]),
      cachedTokens: tokenCount(inputDetails["cached_tokens"]),
      cacheWriteTokens: tokenCount(inputDetails["cache_write_tokens"]),
      outputTokens: tokenCount(usage["output_tokens"]),
      reasoningTokens: tokenCount(outputDetails["reasoning_tokens"]),
      totalTokens: tokenCount(usage["total_tokens"]),
    },
    costTotal,
  };
}

function hasAnyField(fields: WireUsageFields): boolean {
  return (
    fields.inputTokens !== null ||
    fields.cachedTokens !== null ||
    fields.cacheWriteTokens !== null ||
    fields.outputTokens !== null ||
    fields.reasoningTokens !== null ||
    fields.totalTokens !== null
  );
}

/**
 * Creates the collector. Wire observations are keyed by response id; ids are
 * unique per provider response (each HTTP/WebSocket attempt opens a new one),
 * so cache-warm calls and failed attempts can never collide with a finalised
 * message's id. Handlers are synchronous and never throw on malformed data:
 * malformed events degrade the observation, never the host run.
 */
export function createMainUsageEvidenceCollector(
  options: MainUsageEvidenceCollectorOptions = {},
): MainUsageEvidenceCollector {
  const maxUncorrelated = options.maxUncorrelatedIds ?? DEFAULT_MAX_UNCORRELATED_IDS;
  const wire = new Map<string, WireObservation>();
  const lastIdByStream = new Map<string, string>(); // `${provider}/${model}` -> last seen response id
  const emitted: MainUsageEvidenceV2Record[] = [];
  const seenMessageHashes = new Set<string>();
  let requestWindows = 0;
  let streamEvents = 0;
  let unsupportedApiEvents = 0;
  let usageBearingObservations = 0;
  let correlated = 0;
  let unmatched = 0;
  let ambiguousMessages = 0;

  const uncorrelatedIds = (): { ids: readonly string[]; count: number } => {
    const all: string[] = [];
    for (const [id, observation] of wire) {
      if (observation.usageBearing && observation.consumedBy === null) all.push(id);
    }
    return { ids: all.slice(0, maxUncorrelated), count: all.length };
  };

  const baseRecord = (
    messageSha256: string,
    responseId: string | null,
    requestWindowCount: number,
  ): Omit<
    MainUsageEvidenceV2Record,
    "correlation" | "usageObserved" | "api" | "usageSource" | "fields" | "wireCostTotal" | "ambiguous"
  > => {
    const uncorrelated = uncorrelatedIds();
    return {
      type: MAIN_USAGE_EVIDENCE_TYPE,
      schemaVersion: MAIN_USAGE_EVIDENCE_V2_SCHEMA_VERSION,
      messageSha256,
      responseId,
      uncorrelatedResponseIds: uncorrelated.ids,
      uncorrelatedCount: uncorrelated.count,
      requestWindows: requestWindowCount,
    };
  };

  const collector: MainUsageEvidenceCollector = {
    onBeforeProviderRequest(_event: BeforeProviderRequestLike): undefined {
      requestWindows += 1;
      return undefined; // read-only: never a payload replacement
    },

    onProviderStreamEvent(event: ProviderStreamEventLike): void {
      streamEvents += 1;
      const api = typeof event.api === "string" ? event.api : "";
      if (!COMPLETIONS_APIS.has(api) && !RESPONSES_APIS.has(api)) {
        unsupportedApiEvents += 1;
        return;
      }
      const data = isJsonObject(event.data) ? (event.data as Record<string, unknown>) : null;
      if (data === null) return;
      const streamKey = `${event.provider}/${event.model}`;

      if (COMPLETIONS_APIS.has(api)) {
        // ChatCompletionChunk: every chunk of one completion shares the id;
        // usage sits on `chunk.usage` with a `choices[0].usage` fallback some
        // providers use (Observed in pi-ai openai-completions.js).
        const chunkId = safeResponseId(data["id"]);
        let usageSource: WireUsageSource | null = null;
        let projection: CompletionsUsageProjection | null = null;
        const chunkUsage = isJsonObject(data["usage"]) ? data["usage"] : null;
        const choices = Array.isArray(data["choices"]) ? data["choices"] : [];
        const firstChoice = isJsonObject(choices[0]) ? choices[0] : null;
        const choiceUsage =
          chunkUsage === null && firstChoice !== null && isJsonObject(firstChoice["usage"])
            ? firstChoice["usage"]
            : null;
        if (chunkUsage !== null) {
          usageSource = "chunk-usage";
          projection = projectCompletionsUsage(chunkUsage);
        } else if (choiceUsage !== null) {
          usageSource = "choice-usage";
          projection = projectCompletionsUsage(choiceUsage);
        }
        applyObservation(streamKey, api, event, chunkId, usageSource, projection);
        return;
      }

      // Responses family: `response.created` opens the response id;
      // terminal events carry `response.usage` (Observed in pi-ai
      // openai-responses-shared.js processResponsesStream and
      // openai-codex-responses.js mapCodexEvents).
      const eventType = typeof data["type"] === "string" ? data["type"] : "";
      const response = isJsonObject(data["response"]) ? data["response"] : null;
      if (eventType === "response.created") {
        applyObservation(streamKey, api, event, safeResponseId(response?.["id"]), null, null);
        return;
      }
      if (eventType === "response.completed" || eventType === "response.failed" || eventType === "response.incomplete") {
        const responseUsage = response !== null && isJsonObject(response["usage"]) ? response["usage"] : null;
        applyObservation(
          streamKey,
          api,
          event,
          safeResponseId(response?.["id"]),
          responseUsage !== null ? "response-usage" : null,
          responseUsage !== null ? projectResponsesUsage(responseUsage) : null,
        );
        return;
      }
      // Non-terminal responses events (deltas, items) carry no usage and no id claim.
    },

    onMessageEnd(event: MessageEndLike): void {
      const message = isJsonObject(event.message) ? (event.message as Record<string, unknown>) : null;
      if (message === null || message["role"] !== "assistant") return;
      let canonical: string;
      let hash: string;
      try {
        canonical = canonicalJson(message);
        hash = sha256Canonical(asJson(message));
      } catch {
        return; // non-JSON message content cannot be keyed honestly
      }
      if (seenMessageHashes.has(canonical)) return; // exact duplicate finalisation
      seenMessageHashes.add(canonical);
      const responseId = safeResponseId(message["responseId"]);
      const observation = responseId !== null ? wire.get(responseId) : undefined;
      if (responseId === null || observation === undefined) {
        unmatched += 1;
        emitted.push({
          ...baseRecord(hash, responseId, requestWindows),
          correlation: "none",
          usageObserved: null,
          api: "",
          usageSource: null,
          fields: null,
          wireCostTotal: null,
          ambiguous: false,
        });
        return;
      }
      if (observation.consumedBy !== null && observation.consumedBy !== hash) {
        // The same wire response id finalised two distinct messages: the
        // usage cannot be attributed to either. Emit an ambiguous conflict
        // record for the earlier message too, so folding fails closed on both.
        ambiguousMessages += 1;
        emitted.push({
          ...baseRecord(observation.consumedBy, responseId, requestWindows),
          correlation: "response-id",
          usageObserved: null,
          api: observation.api,
          usageSource: null,
          fields: null,
          wireCostTotal: null,
          ambiguous: true,
        });
        emitted.push({
          ...baseRecord(hash, responseId, requestWindows),
          correlation: "response-id",
          usageObserved: null,
          api: observation.api,
          usageSource: null,
          fields: null,
          wireCostTotal: null,
          ambiguous: true,
        });
        return;
      }
      // Consume BEFORE snapshotting uncorrelated ids, so the observation this
      // record claims is not listed as uncorrelated in its own record.
      observation.consumedBy = hash;
      correlated += 1;
      const ambiguous = observation.attachedWithoutId;
      if (ambiguous) ambiguousMessages += 1;
      emitted.push({
        ...baseRecord(hash, responseId, requestWindows),
        correlation: "response-id",
        usageObserved: ambiguous ? null : observation.usageBearing,
        api: observation.api,
        usageSource: ambiguous ? null : observation.usageSource,
        fields: ambiguous || !observation.usageBearing ? null : observation.fields,
        wireCostTotal: ambiguous ? null : observation.wireCostTotal,
        ambiguous,
      });
    },

    get records(): readonly MainUsageEvidenceV2Record[] {
      // Snapshot: callers cannot mutate emission history retroactively.
      return [...emitted];
    },

    get diagnostics(): MainUsageEvidenceDiagnostics {
      return {
        requestWindows,
        streamEvents,
        unsupportedApiEvents,
        usageBearingObservations,
        uncorrelatedResponseIds: uncorrelatedIds().ids,
        correlated,
        unmatched,
        ambiguous: ambiguousMessages,
      };
    },
  };

  function applyObservation(
    streamKey: string,
    api: string,
    event: ProviderStreamEventLike,
    chunkId: string | null,
    usageSource: WireUsageSource | null,
    projection: CompletionsUsageProjection | null,
  ): void {
    let id = chunkId;
    let attachedWithoutId = false;
    if (id === null && usageSource !== null) {
      // Usage-bearing chunk without its own id: attach to the last id seen
      // for the same provider/model stream and mark the attachment ambiguous.
      id = lastIdByStream.get(streamKey) ?? null;
      attachedWithoutId = true;
    }
    if (id === null) {
      if (usageSource !== null) usageBearingObservations += 1; // counted, never claimed
      return; // nothing keyable: no observation, no claim
    }
    if (chunkId !== null) lastIdByStream.set(streamKey, chunkId);
    const existing = wire.get(id);
    if (existing === undefined) {
      const fields = projection === null ? EMPTY_FIELDS : projection.fields;
      const usageBearing = projection !== null && hasAnyField(projection.fields);
      if (usageBearing) usageBearingObservations += 1;
      wire.set(id, {
        api,
        provider: event.provider,
        model: event.model,
        fields,
        usageSource: usageBearing ? usageSource : null,
        wireCostTotal: projection === null ? null : projection.costTotal,
        attachedWithoutId,
        usageBearing,
        consumedBy: null,
      });
      return;
    }
    if (projection !== null) {
      // Each usage object is the latest cumulative snapshot, as in the SDK's
      // whole-object overwrite. Fields absent from it must become unknown;
      // retaining earlier fields would silently mix two different snapshots.
      if (!existing.usageBearing && hasAnyField(projection.fields)) usageBearingObservations += 1;
      existing.fields = projection.fields;
      existing.usageBearing = hasAnyField(projection.fields);
      existing.usageSource = existing.usageBearing ? usageSource : null;
      existing.wireCostTotal = projection.costTotal;
    }
    existing.attachedWithoutId = existing.attachedWithoutId || attachedWithoutId;
  }

  return collector;
}

/**
 * Convenience wiring for a benchmark harness: subscribes the collector to the
 * three supported events on an `ExtensionAPI`-like surface and returns the
 * unsubscribe functions. The before_provider_request handler returns nothing,
 * so the host keeps the original payload.
 */
export function wireMainUsageEvidence(
  pi: {
    on(
      event: "before_provider_request",
      handler: (event: BeforeProviderRequestLike) => undefined,
    ): () => void;
    on(event: "provider_stream_event", handler: (event: ProviderStreamEventLike) => void): () => void;
    on(event: "message_end", handler: (event: MessageEndLike) => void): () => void;
  },
  collector: MainUsageEvidenceCollector,
): readonly (() => void)[] {
  return [
    pi.on("before_provider_request", (event) => collector.onBeforeProviderRequest(event)),
    pi.on("provider_stream_event", (event) => collector.onProviderStreamEvent(event)),
    pi.on("message_end", (event) => collector.onMessageEnd(event)),
  ];
}

// ---------------------------------------------------------------------------
// Record reading and canonical mapping, consumed by usage-parser.ts.
// ---------------------------------------------------------------------------

const WIRE_FIELD_KEYS: readonly (keyof WireUsageFields)[] = [
  "inputTokens",
  "cachedTokens",
  "cacheWriteTokens",
  "outputTokens",
  "reasoningTokens",
  "totalTokens",
];

function readWireFields(value: unknown): WireUsageFields | null {
  if (!isJsonObject(value)) return null;
  const out: Partial<Record<keyof WireUsageFields, number | null>> = {};
  for (const key of WIRE_FIELD_KEYS) {
    const raw = value[key];
    if (raw === null) {
      out[key] = null;
      continue;
    }
    const count = tokenCount(raw);
    if (count === null) return null;
    out[key] = count;
  }
  return {
    inputTokens: out.inputTokens ?? null,
    cachedTokens: out.cachedTokens ?? null,
    cacheWriteTokens: out.cacheWriteTokens ?? null,
    outputTokens: out.outputTokens ?? null,
    reasoningTokens: out.reasoningTokens ?? null,
    totalTokens: out.totalTokens ?? null,
  };
}

/** Reader bound for uncorrelated id lists: generous, independent of the emitter cap. */
const MAX_READ_UNCORRELATED_IDS = 4096;

function readStringArray(value: unknown, cap: number): string[] | null {
  if (!Array.isArray(value) || value.length > cap) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length > MAX_RESPONSE_ID_LENGTH) return null;
    out.push(item);
  }
  return out;
}

/**
 * Strictly validates a schemaVersion 2 evidence record from an event stream.
 * Returns the typed record or null when any required field is malformed;
 * unknown extra keys are ignored so future additive revisions stay readable.
 */
export function readMainUsageEvidenceV2(event: unknown): MainUsageEvidenceV2Record | null {
  if (!isJsonObject(event)) return null;
  if (event["type"] !== MAIN_USAGE_EVIDENCE_TYPE) return null;
  if (event["schemaVersion"] !== MAIN_USAGE_EVIDENCE_V2_SCHEMA_VERSION) return null;
  const messageSha256 = event["messageSha256"];
  if (typeof messageSha256 !== "string" || !/^[0-9a-f]{64}$/.test(messageSha256)) return null;
  const responseId = event["responseId"];
  const safeId = responseId === null ? null : safeResponseId(responseId);
  if (responseId !== null && safeId === null) return null;
  const correlation = event["correlation"];
  if (correlation !== "response-id" && correlation !== "none") return null;
  const usageObserved = event["usageObserved"];
  if (usageObserved !== true && usageObserved !== false && usageObserved !== null) return null;
  const api = event["api"];
  if (typeof api !== "string") return null;
  const usageSource = event["usageSource"];
  if (
    usageSource !== null &&
    usageSource !== "chunk-usage" &&
    usageSource !== "choice-usage" &&
    usageSource !== "response-usage"
  )
    return null;
  const wireCostTotal = event["wireCostTotal"];
  if (wireCostTotal !== null && finiteNumber(wireCostTotal) === null) return null;
  if (typeof event["ambiguous"] !== "boolean") return null;
  const uncorrelatedCount = event["uncorrelatedCount"];
  if (typeof uncorrelatedCount !== "number" || !Number.isInteger(uncorrelatedCount) || uncorrelatedCount < 0)
    return null;
  const requestWindows = event["requestWindows"];
  if (typeof requestWindows !== "number" || !Number.isInteger(requestWindows) || requestWindows < 0)
    return null;
  const fields = event["fields"];
  const parsedFields = fields === null ? null : readWireFields(fields);
  if (fields !== null && parsedFields === null) return null;
  const uncorrelatedResponseIds = readStringArray(event["uncorrelatedResponseIds"], MAX_READ_UNCORRELATED_IDS);
  if (uncorrelatedResponseIds === null) return null;
  // Claim consistency: an asserted observation must carry supported api,
  // fields and a source; an unasserted record must carry none of them.
  if (usageObserved === true) {
    if (parsedFields === null) return null;
    if (!COMPLETIONS_APIS.has(api) && !RESPONSES_APIS.has(api)) return null;
    if (usageSource === null) return null;
    if (!hasAnyField(parsedFields)) return null;
  } else if (parsedFields !== null || usageSource !== null) {
    return null;
  }
  if (correlation === "none" && usageObserved !== null) return null;
  if (correlation === "response-id" && responseId === null) return null;
  return {
    type: MAIN_USAGE_EVIDENCE_TYPE,
    schemaVersion: MAIN_USAGE_EVIDENCE_V2_SCHEMA_VERSION,
    messageSha256,
    responseId: safeId,
    correlation,
    usageObserved,
    api,
    usageSource,
    fields: parsedFields,
    wireCostTotal: wireCostTotal === null ? null : finiteNumber(wireCostTotal),
    ambiguous: event["ambiguous"] === true,
    uncorrelatedResponseIds,
    uncorrelatedCount,
    requestWindows,
  };
}

/** Serialises a record to canonical Json for the benchmark event stream. */
export function mainUsageEvidenceV2Json(record: MainUsageEvidenceV2Record): Json {
  return asJson({ ...record });
}

/**
 * Maps wire field presence to the canonical TokenObservation, mirroring the
 * host's arithmetic while staying presence-honest:
 *
 * - `inputTokens` is cache-inclusive. Uncached input requires both cache
 *   subsets as well as that total; wire-absent subsets are not zero. This
 *   deliberately differs from SDK zero-defaulting and preserves C16/T31
 *   missingness before any H1 measurement.
 * - Preserve a reported `total_tokens` on either family. Without one the
 *   total remains unknown, even when component arithmetic is possible: the
 *   canonical field cannot distinguish a derived value from a reported one.
 */
export function tokensFromWireEvidence(record: MainUsageEvidenceV2Record): TokenObservation | null {
  if (record.usageObserved !== true || record.fields === null) return null;
  const fields = record.fields;
  const cacheRead = fields.cachedTokens;
  const cacheWrite = fields.cacheWriteTokens;
  const output = fields.outputTokens;
  const reasoning = fields.reasoningTokens;
  const observation: TokenObservation = {
    ...(fields.inputTokens !== null
      ? {
          inputTotal: fields.inputTokens,
          ...(cacheRead !== null && cacheWrite !== null
            ? { inputUncached: Math.max(0, fields.inputTokens - cacheRead - cacheWrite) }
            : {}),
        }
      : {}),
    ...(output !== null ? { outputTotal: output } : {}),
    ...(cacheRead !== null ? { cacheRead } : {}),
    ...(cacheWrite !== null ? { cacheWrite } : {}),
    ...(reasoning !== null ? { reasoning } : {}),
    ...(fields.totalTokens !== null ? { totalTokens: fields.totalTokens } : {}),
  };
  return observation;
}
