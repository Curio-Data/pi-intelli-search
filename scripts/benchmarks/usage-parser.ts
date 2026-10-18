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

import { canonicalJson } from "./canonical.js";
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
    rawInput === undefined && rawCacheRead === undefined && rawCacheWrite === undefined &&
    output === undefined && totalTokens === undefined
  ) {
    return null;
  }
  return {
    ...(rawInput !== undefined
      ? { inputTotal: rawInput + (rawCacheRead ?? 0) + (rawCacheWrite ?? 0), inputUncached: rawInput }
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
  return typeof value === "string" && value.startsWith("intelli_");
}

/** The explicit intelli identity markers a tool result can carry. */
export type IntelliResultMarker = "full" | "compact" | "legacy-details";

/**
 * Recognises an intelli tool result by EXPLICIT identity markers, never by
 * accounting shape alone (review C2): the full native marker is
 * `structuredContent.schemaVersion === 1` plus `structuredContent.operation`
 * naming an intelli operation (FullData, C17/R2); the compact marker is the
 * same pair under `structuredContent.meta` (CompactData projection, C18);
 * the legacy native marker is `details.intelli` carrying the same pair. A
 * foreign tool whose structured output merely happens to contain `attempts`
 * and `tokens` objects carries no marker and stays outside the pipeline
 * population.
 */
export function intelliResultMarker(result: unknown): IntelliResultMarker | null {
  if (!isJsonObject(result)) return null;
  const structured = result["structuredContent"];
  if (isJsonObject(structured)) {
    if (structured["schemaVersion"] === 1 && isIntelliOperation(structured["operation"])) return "full";
    const meta = structured["meta"];
    if (isJsonObject(meta) && meta["schemaVersion"] === 1 && isIntelliOperation(meta["operation"])) return "compact";
  }
  const details = result["details"];
  if (isJsonObject(details) && isJsonObject(details["intelli"])) {
    const intelli = details["intelli"];
    if (intelli["schemaVersion"] === 1 && isIntelliOperation(intelli["operation"])) return "legacy-details";
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
  if (marker === "full" || marker === "legacy-details") {
    const holder = marker === "full" ? result["structuredContent"] : (result["details"] as Record<string, unknown>)["intelli"];
    const candidate = isJsonObject(holder) ? holder["accounting"] : null;
    return validAccountingShape(candidate) ? (candidate as unknown as AccountingSummary) : null;
  }
  const meta = (result["structuredContent"] as Record<string, unknown>)["meta"];
  if (!isJsonObject(meta)) return null;
  const attempts = meta["attempts"];
  const missingAttempts = meta["missingAttempts"];
  if (typeof attempts !== "number" || !Number.isInteger(attempts) || attempts < 0) return null;
  const missing = typeof missingAttempts === "number" && Number.isInteger(missingAttempts) && missingAttempts >= 0 ? missingAttempts : 0;
  const reported = meta["reportedCost"];
  const estimated = meta["estimatedCost"];
  return {
    attempts,
    observedAttempts: Math.max(0, attempts - missing),
    missingAttempts: missing,
    tokens: {}, // compact projection carries no token components: unknown, never invented
    ...(typeof reported === "number" ? { reportedCost: { total: reported } } : { reportedCost: {} }),
    ...(typeof estimated === "number" ? { estimatedCost: { total: estimated } } : { estimatedCost: {} }),
    missingTokenFields: [],
    costComplete: meta["costComplete"] === true,
    parentDelivery: "unknown",
  };
}

/** True when a tool execution belongs to the intelli pipeline population. */
export function isIntelliToolExecution(toolName: unknown, result: unknown): boolean {
  if (typeof toolName === "string" && INTELLI_TOOL_NAMES.has(toolName)) return true;
  // Renamed/MCP registrations and codemode-script calls are recognised by
  // their explicit intelli identity marker; the codemode parent tool itself
  // carries none (its usage field is host aggregation, not an intelli
  // result). Shape resemblance alone never admits a foreign tool.
  return intelliResultMarker(result) !== null;
}

function assistantId(message: Record<string, unknown>, usedIds: Set<string>): string {
  const provider = typeof message["provider"] === "string" ? message["provider"] : "unknown-provider";
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
      const usage = tokensFromWireUsage(message["usage"]);
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
