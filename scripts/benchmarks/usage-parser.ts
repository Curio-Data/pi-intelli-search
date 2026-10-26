// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Canonical usage-event parser (C16/C30, common METHOD "Common Recording").
//
// Populations, fixed by the frozen contract and methods:
// - Main-model usage comes ONLY from assistant messages in `message_end`
//   session events. Each distinct assistant message is counted once; exact
//   duplicates (repeats of the same finalised message) never double count.
// - Pipeline usage comes ONCE per canonical intelli tool result: an
//   `tool_execution_end` event whose toolName is one of the registered
//   intelli tools OR whose result carries an EXPLICIT intelli identity marker
//   (full `structuredContent.schemaVersion`+`operation`, compact
//   `structuredContent.meta` pair, or legacy `details.intelli` pair). Shape
//   resemblance alone never admits a foreign tool (review C2). `bash`,
//   `read`, `edit`, the `codemode` script tool and every other non-intelli
//   execution is outside the pipeline population entirely, so `missing`
//   keeps its meaning: an expected observation (an intelli result that lost
//   its accounting, or an assistant message without usage) is absent. Nested
//   intelli calls (parentToolCallId set) are distinct canonical results and
//   count once each under their own id.
// - `turn_end` (whose message and toolResults repeat finalised results),
//   `agent_end.messages`, compaction events and RPC protocol records are not
//   populations: they never enter the sums. This implements "never repeat
//   turn_end.toolResults or nested-parent totals" and "tool results counted
//   once, not repeated turn results".
// - Missing usage (absent usage object), failed assistant messages
//   (stopReason error/aborted without usage) and tool results without an
//   intelli accounting summary are preserved as null observations and listed
//   in `missing`; nothing is invented and nothing is dropped.
//
// Event shapes are the installed Pi 1.3.0 JSON/RPC wire contract
// (docs/json.md: session header in json mode; response/extension records in
// rpc mode; message_end.message, tool_execution_end.result). Both modes share
// the session-event shapes; only the skipped envelope records differ.

import { asJson, canonicalJson, sha256Canonical } from "./canonical.js";
import {
  readMainUsageEvidenceV2,
  tokensFromWireEvidence,
  type MainUsageEvidenceV2Record,
} from "./main-usage-evidence.js";
import type { AccountingSummary, Json, ParsedUsage, TokenObservation } from "./contracts.js";

interface AssistantObservation {
  readonly id: string;
  readonly usage: TokenObservation | null;
}

interface ToolObservation {
  readonly toolCallId: string;
  readonly parentToolCallId?: string;
  readonly accounting: AccountingSummary | null;
}

const RPC_ENVELOPE_TYPES = new Set(["response", "extension_ui_request", "extension_ui_response"]);
const JSON_HEADER_TYPE = "session";

/** Optional sidecar evidence, correlated without mutating the canonical message. */
export const MAIN_USAGE_EVIDENCE_TYPE = "intelli_benchmark_main_usage";
export function mainUsageEvidence(message: Json, observed: boolean): Json {
  return {
    type: MAIN_USAGE_EVIDENCE_TYPE,
    schemaVersion: 1,
    messageSha256: sha256Canonical(message),
    observed,
  };
}

/** Folded schemaVersion 2 evidence for one canonical message hash. */
interface V2EvidenceFold {
  readonly status: "agreed" | "conflict";
  readonly record?: MainUsageEvidenceV2Record;
}

/**
 * Two v2 records agree when their usage claims match exactly: the tri-state
 * `usageObserved`, the asserted api/source/cost and every wire field
 * position (null vs value). Diagnostic fields (uncorrelated id lists,
 * request-window counts) may differ without conflict. Disagreement folds to
 * `conflict`, which the parser treats as unobserved, mirroring the v1 rule
 * that conflicting evidence cannot turn an unknown observation into a known
 * zero.
 */
function v2RecordsAgree(a: MainUsageEvidenceV2Record, b: MainUsageEvidenceV2Record): boolean {
  if (a.usageObserved !== b.usageObserved) return false;
  if (a.usageObserved === null) return true; // both make no claim
  if (a.ambiguous !== b.ambiguous) return false;
  if (a.usageSource !== b.usageSource || a.wireCostTotal !== b.wireCostTotal) return false;
  const fa = a.fields;
  const fb = b.fields;
  if ((fa === null) !== (fb === null)) return false;
  if (fa === null || fb === null) return true;
  return (
    fa.inputTokens === fb.inputTokens &&
    fa.cachedTokens === fb.cachedTokens &&
    fa.cacheWriteTokens === fb.cacheWriteTokens &&
    fa.outputTokens === fb.outputTokens &&
    fa.reasoningTokens === fb.reasoningTokens &&
    fa.totalTokens === fb.totalTokens
  );
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Maps a pi-ai Usage wire object to the canonical TokenObservation,
 * preserving genuinely missing fields as unknown instead of inventing zeros
 * (the H1 primary endpoint is `inputUncached`): `inputUncached` is present
 * only when the wire reports `input`; `inputTotal` (which includes cached
 * prompt tokens, C16) is present only when input is reported (absent cache
 * subsets read as the zeros pi-ai's required fields imply). `reasoning` is a
 * subset of output and never an extra total; `totalTokens` is preserved
 * without being added to components. Explicit zeros are reported values and
 * are kept.
 */
export function tokensFromWireUsage(usage: unknown): TokenObservation | null {
  if (!isJsonObject(usage)) return null;
  const read = (field: string): number | undefined => {
    const value = usage[field];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  };
  const rawInput = read("input");
  const rawCacheRead = read("cacheRead");
  const rawCacheWrite = read("cacheWrite");
  const output = read("output");
  const cacheWrite1h = read("cacheWrite1h");
  const reasoning = read("reasoning");
  const totalTokens = read("totalTokens");
  if (
    rawInput === undefined &&
    rawCacheRead === undefined &&
    rawCacheWrite === undefined &&
    output === undefined &&
    totalTokens === undefined
  ) {
    return null;
  }
  return {
    ...(rawInput !== undefined
      ? {
          inputTotal: rawInput + (rawCacheRead ?? 0) + (rawCacheWrite ?? 0),
          inputUncached: rawInput,
        }
      : {}), // input unreported: uncached input and its total stay unknown
    ...(output !== undefined ? { outputTotal: output } : {}),
    ...(rawCacheRead !== undefined ? { cacheRead: rawCacheRead } : {}),
    ...(rawCacheWrite !== undefined ? { cacheWrite: rawCacheWrite } : {}),
    ...(cacheWrite1h !== undefined ? { cacheWrite1h } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  };
}

/** Registered intelli tool names (native); renamed/MCP registrations are recognised by explicit result markers. */
const INTELLI_TOOL_NAMES = new Set([
  "intelli_search",
  "intelli_extract",
  "intelli_collate",
  "intelli_research",
  "intelli_fetch",
]);

function isIntelliOperation(value: unknown): boolean {
  return typeof value === "string" && INTELLI_TOOL_NAMES.has(value);
}

/** The explicit intelli identity markers a tool result can carry. */
export type IntelliResultMarker =
  "full" | "full-envelope" | "compact" | "compact-envelope" | "legacy-details";

/** Every canonical token field a compact (MCP) projection cannot supply. */
const ALL_TOKEN_FIELDS: ReadonlyArray<keyof import("./contracts.js").TokenObservation> = [
  "inputTotal",
  "inputUncached",
  "outputTotal",
  "cacheRead",
  "cacheWrite",
  "cacheWrite1h",
  "reasoning",
  "totalTokens",
];

/**
 * Recognises an intelli tool result by EXPLICIT identity markers, never by
 * accounting shape alone (review C2): the full native marker is
 * `structuredContent.schemaVersion === 1` plus `structuredContent.operation`
 * naming an intelli operation (FullData, C17/R2); the compact marker is the
 * same pair under `structuredContent.meta` (CompactData projection, C18);
 * the legacy native marker is `details.intelli` carrying the same pair.
 * MCP tools delivered through `Pi`'s MCP client nest one level deeper
 * (review D1): the whole Model Context Protocol (MCP) `CallToolResult`
 * becomes the tool's `structuredContent` (convertMcpResult spreads the
 * result minus `_meta` into it; Observed in the host 1.3.0
 * extensions/mcp/tools.js), so the compact marker also arrives at
 * `structuredContent.structuredContent.meta` and a full marker at
 * `structuredContent.structuredContent` itself. A foreign tool whose
 * structured output merely happens to contain `attempts` and `tokens`
 * objects carries no marker and stays outside the pipeline population.
 */
export function intelliResultMarker(result: unknown): IntelliResultMarker | null {
  if (!isJsonObject(result)) return null;
  const structured = result["structuredContent"];
  if (isJsonObject(structured)) {
    if (structured["schemaVersion"] === 1 && isIntelliOperation(structured["operation"]))
      return "full";
    const meta = structured["meta"];
    if (isJsonObject(meta) && meta["schemaVersion"] === 1 && isIntelliOperation(meta["operation"]))
      return "compact";
    // CallToolResult envelope nesting (Pi's MCP client, review D1).
    const envelope = structured["structuredContent"];
    if (isJsonObject(envelope)) {
      if (envelope["schemaVersion"] === 1 && isIntelliOperation(envelope["operation"]))
        return "full-envelope";
      const envelopeMeta = envelope["meta"];
      if (
        isJsonObject(envelopeMeta) &&
        envelopeMeta["schemaVersion"] === 1 &&
        isIntelliOperation(envelopeMeta["operation"])
      ) {
        return "compact-envelope";
      }
    }
  }
  const details = result["details"];
  if (isJsonObject(details) && isJsonObject(details["intelli"])) {
    const intelli = details["intelli"];
    if (intelli["schemaVersion"] === 1 && isIntelliOperation(intelli["operation"]))
      return "legacy-details";
  }
  return null;
}

function validAccountingShape(candidate: unknown): candidate is AccountingSummary {
  if (!isJsonObject(candidate)) return false;
  const attempts = candidate["attempts"];
  if (typeof attempts !== "number" || !Number.isInteger(attempts) || attempts < 0) return false;
  return isJsonObject(candidate["tokens"]);
}

/**
 * Extracts the intelli AccountingSummary from a recognised result marker.
 * Full and legacy results carry the complete summary; compact results carry
 * only the meta projection, from which an honest partial summary is built
 * with unknown token fields left empty (never invented) and `parentDelivery`
 * unknown. Returns null when the marker is present but its accounting is
 * absent or malformed, so the observation is preserved as missing.
 */
export function accountingFromToolResult(result: unknown): AccountingSummary | null {
  const marker = intelliResultMarker(result);
  if (marker === null) return null;
  if (!isJsonObject(result)) return null;
  if (marker === "full" || marker === "full-envelope" || marker === "legacy-details") {
    const structured = result["structuredContent"];
    const holder =
      marker === "legacy-details"
        ? (result["details"] as Record<string, unknown>)["intelli"]
        : marker === "full-envelope" && isJsonObject(structured)
          ? structured["structuredContent"]
          : structured;
    const candidate = isJsonObject(holder) ? holder["accounting"] : null;
    return validAccountingShape(candidate) ? (candidate as unknown as AccountingSummary) : null;
  }
  // Compact projection (direct or inside the MCP CallToolResult envelope).
  // The compact meta carries no token components and its required fields are
  // validated strictly (review D2): an absent or malformed `missingAttempts`
  // is not defaulted to zero completeness but produces a null summary, so the
  // observation is listed missing instead of inventing `observedAttempts ==
  // attempts`. Every canonical token field is reported missing because the
  // projection cannot supply any of them.
  const structured = result["structuredContent"] as Record<string, unknown>;
  const meta =
    marker === "compact-envelope"
      ? isJsonObject(structured["structuredContent"])
        ? (structured["structuredContent"] as Record<string, unknown>)["meta"]
        : undefined
      : structured["meta"];
  if (!isJsonObject(meta)) return null;
  const attempts = meta["attempts"];
  const missingAttempts = meta["missingAttempts"];
  if (typeof attempts !== "number" || !Number.isInteger(attempts) || attempts < 0) return null;
  if (
    typeof missingAttempts !== "number" ||
    !Number.isInteger(missingAttempts) ||
    missingAttempts < 0
  )
    return null;
  const observed = attempts - missingAttempts;
  if (observed < 0) return null; // bounds: observedAttempts must never be negative
  const reported = meta["reportedCost"];
  const estimated = meta["estimatedCost"];
  return {
    attempts,
    observedAttempts: observed,
    missingAttempts,
    tokens: {}, // compact projection carries no token components: unknown, never invented
    ...(typeof reported === "number"
      ? { reportedCost: { total: reported } }
      : { reportedCost: {} }),
    ...(typeof estimated === "number"
      ? { estimatedCost: { total: estimated } }
      : { estimatedCost: {} }),
    missingTokenFields: [...ALL_TOKEN_FIELDS],
    costComplete: meta["costComplete"] === true,
    parentDelivery: "unknown",
  };
}

/** True for an MCP-registered intelli tool name (`mcp__<server>__intelli_*`). */
function isMcpIntelliToolName(toolName: unknown): boolean {
  if (typeof toolName !== "string") return false;
  const match = /^mcp__(.+)__(intelli_[a-z0-9_]+)$/.exec(toolName);
  return match !== null && INTELLI_TOOL_NAMES.has(match[2]!);
}

/**
 * True when the host result carries Pi's MCP execution identity naming an
 * intelli operation. Pi registers MCP tools as `mcp__<server>__<tool>`
 * sanitised to `[A-Za-z0-9_]`, truncated to 64 characters with a hash suffix
 * when too long, and hash-suffixed again when two registrations sanitise to
 * the same name (Observed in the installed Pi 1.3.0
 * `dist/extensions/mcp/tools.js` `createMcpToolName` and `index.js`
 * `assignName`), so a long or colliding server name cuts the intelli suffix
 * out of the registered name and the strict `mcp__<server>__intelli_*`
 * shape no longer identifies the execution. The host's MCP client records
 * the explicit identity on every result instead: `details: { server, tool }`
 * with the raw server-side tool name (Observed in `convertMcpResult`).
 * Recognition through that identity is gated on the `mcp__` registration
 * prefix (every MCP registration carries it; native tools never do), so a
 * native tool reporting a `tool` detail for unrelated reasons cannot enter
 * the pipeline population through this channel.
 */
function isMcpDetailsIntelliExecution(toolName: unknown, result: unknown): boolean {
  if (typeof toolName !== "string" || !toolName.startsWith("mcp__")) return false;
  if (!isJsonObject(result)) return false;
  const details = result["details"];
  if (!isJsonObject(details)) return false;
  return isIntelliOperation(details["tool"]);
}

/** True when a tool execution belongs to the intelli pipeline population. */
export function isIntelliToolExecution(toolName: unknown, result: unknown): boolean {
  if (typeof toolName === "string" && INTELLI_TOOL_NAMES.has(toolName)) return true;
  // An MCP-registered intelli tool (`mcp__<server>__intelli_*`) is an expected
  // pipeline observation even when no marker can be recovered (host shape
  // change, degraded result): it enters the population with a null summary
  // and is listed missing rather than silently dropped (review D1).
  if (isMcpIntelliToolName(toolName)) return true;
  // A shortened or collision-hash-suffixed MCP registration that lost its
  // intelli suffix is recognised through the host's explicit
  // `details.tool` identity when structured markers are absent (integration
  // condition 7). Accounting still comes only from explicit markers, so such
  // an execution is retained as missing, never dropped and never summed from
  // the host's tool-execution usage field.
  if (isMcpDetailsIntelliExecution(toolName, result)) return true;
  // Renamed registrations and codemode-script calls are recognised by their
  // explicit intelli identity marker (including the MCP CallToolResult
  // envelope nesting); the codemode parent tool itself carries none (its
  // `details.calls` aggregation and usage field are host bookkeeping, not an
  // intelli result). Shape resemblance alone never admits a foreign tool.
  return intelliResultMarker(result) !== null;
}

function assistantId(message: Record<string, unknown>, usedIds: Set<string>): string {
  const provider =
    typeof message["provider"] === "string" ? message["provider"] : "unknown-provider";
  const model = typeof message["model"] === "string" ? message["model"] : "unknown-model";
  const responseId = typeof message["responseId"] === "string" ? message["responseId"] : null;
  const timestamp = typeof message["timestamp"] === "number" ? message["timestamp"] : 0;
  const base = responseId ?? `${provider}/${model}@${timestamp}`;
  let id = base;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${base}#${suffix}`;
    suffix += 1;
  }
  usedIds.add(id);
  return id;
}

/**
 * Parses canonical usage populations from a stream of session events.
 * `mode` selects which envelope records are protocol noise: json mode skips
 * the session header, rpc mode skips response/extension-UI records. All
 * non-population session events are ignored without entering any sum.
 */
export function parseUsageEvents(events: readonly Json[], mode: "json" | "rpc"): ParsedUsage {
  const assistantMessages: AssistantObservation[] = [];
  const assistantSeen = new Map<string, AssistantObservation>(); // canonical message -> observation
  const usedIds = new Set<string>();
  const toolById = new Map<string, ToolObservation>();
  const toolOrder: string[] = [];
  const mainEvidence = new Map<string, boolean>();
  const v2Evidence = new Map<string, V2EvidenceFold>();
  for (const event of events) {
    const v2 = readMainUsageEvidenceV2(event);
    if (v2 !== null) {
      const hash = v2.messageSha256;
      const existing = v2Evidence.get(hash);
      if (existing === undefined) v2Evidence.set(hash, { status: "agreed", record: v2 });
      else if (existing.status === "agreed" && existing.record !== undefined && !v2RecordsAgree(existing.record, v2))
        v2Evidence.set(hash, { status: "conflict" });
      continue;
    }
    if (
      !isJsonObject(event) ||
      event["type"] !== MAIN_USAGE_EVIDENCE_TYPE ||
      event["schemaVersion"] !== 1 ||
      typeof event["messageSha256"] !== "string" ||
      !/^[0-9a-f]{64}$/.test(event["messageSha256"]) ||
      typeof event["observed"] !== "boolean"
    )
      continue;
    const hash = event["messageSha256"];
    // Conflicting evidence cannot turn an unknown observation into known zero.
    mainEvidence.set(hash, event["observed"] && mainEvidence.get(hash) !== false);
  }

  for (const event of events) {
    if (!isJsonObject(event)) continue;
    const type = event["type"];
    if (typeof type !== "string") continue;
    if (mode === "json" && type === JSON_HEADER_TYPE) continue;
    if (mode === "rpc" && RPC_ENVELOPE_TYPES.has(type)) continue;

    if (type === "message_end") {
      const message = event["message"];
      if (!isJsonObject(message) || message["role"] !== "assistant") continue;
      const canonical = canonicalJson(message);
      const existing = assistantSeen.get(canonical);
      if (existing !== undefined) continue; // exact duplicate finalised message
      const candidate = tokensFromWireUsage(message["usage"]);
      const hash = sha256Canonical(asJson(message));
      const v1Observed = mainEvidence.get(hash);
      const v2 = v2Evidence.get(hash);
      // A schemaVersion 2 witness carries per-field wire presence. When it
      // asserts an observation (and v1 evidence, if present, does not
      // contradict it), the canonical tokens come from the wire fields:
      // wire-explicit zeros are values, wire-absent fields stay unknown. A
      // v2 record that asserts no usage (`usageObserved: false`), a folded
      // conflict, or a v1/v2 disagreement fails closed to an unobserved null,
      // mirroring the v1 conflicting-evidence rule. Ambiguous or unmatched
      // v2 records make no claim and leave the v1/SDK path intact.
      const v2Asserts =
        v2 !== undefined &&
        v2.status === "agreed" &&
        v2.record !== undefined &&
        !v2.record.ambiguous &&
        v2.record.usageObserved === true &&
        v1Observed !== false;
      const v2Unobserved =
        v2 !== undefined &&
        (v2.status === "conflict" || (v2.record !== undefined && v2.record.usageObserved === false));
      let usage: TokenObservation | null;
      if (v2Asserts && v2.record !== undefined) {
        usage = tokensFromWireEvidence(v2.record);
      } else if (v2Unobserved) {
        usage = null;
      } else {
        // SDKs initialise required usage fields to zero when the provider sends
        // no usage. Without a correlated wire-presence witness, all-zero SDK
        // usage is ambiguous and must not become a zero-token H1 observation.
        usage =
          v1Observed === false ||
          (v1Observed !== true &&
            candidate !== null &&
            Object.values(candidate).every((value) => value === 0))
            ? null
            : candidate;
      }
      const observation: AssistantObservation = { id: assistantId(message, usedIds), usage };
      assistantSeen.set(canonical, observation);
      assistantMessages.push(observation);
      continue;
    }

    if (type === "tool_execution_end") {
      const toolCallId = event["toolCallId"];
      if (typeof toolCallId !== "string" || toolCallId === "") continue;
      const toolName = event["toolName"];
      const result = event["result"];
      if (!isIntelliToolExecution(toolName, result)) {
        // Non-intelli executions (bash, read, edit, codemode, unrelated
        // extensions) are not pipeline observations and never enter
        // `missing`.
        continue;
      }
      const parent = event["parentToolCallId"];
      const accounting = accountingFromToolResult(result);
      const observation: ToolObservation = {
        toolCallId,
        ...(typeof parent === "string" && parent !== "" ? { parentToolCallId: parent } : {}),
        accounting,
      };
      const previous = toolById.get(toolCallId);
      if (previous !== undefined) {
        // A finalised execution observed twice updates in place; it is never
        // counted twice.
        toolById.set(toolCallId, observation);
        continue;
      }
      toolById.set(toolCallId, observation);
      toolOrder.push(toolCallId);
    }
    // turn_end, agent_end, message_start/update, tool_execution_start/update,
    // compaction and all other events are not populations.
  }

  const missing: string[] = [];
  for (const message of assistantMessages) if (message.usage === null) missing.push(message.id);
  for (const id of toolOrder) if (toolById.get(id)?.accounting === null) missing.push(id);

  return {
    assistantMessages,
    toolMessages: toolOrder.map((id) => toolById.get(id)!),
    missing,
  };
}
