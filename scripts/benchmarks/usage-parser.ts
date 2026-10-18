// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Canonical usage-event parser (C16/C30, common METHOD "Common Recording").
//
// Populations, fixed by the frozen contract and methods:
// - Main-model usage comes ONLY from assistant messages in `message_end`
//   session events. Each distinct assistant message is counted once; exact
//   duplicates (repeats of the same finalised message) never double count.
// - Pipeline usage comes ONCE per canonical tool result: `tool_execution_end`
//   events keyed by toolCallId, carrying the extension's AccountingSummary in
//   structuredContent (R2 native shape) or details.intelli (legacy shape).
//   Nested tool calls (parentToolCallId set) are distinct canonical results
//   and count once each under their own id.
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
 * Maps a pi-ai Usage wire object to the canonical TokenObservation:
 * inputTotal includes cached prompt tokens, inputUncached excludes them
 * (pi-ai `input` is uncached; cacheRead/cacheWrite are the cached subsets),
 * reasoning is a subset of output and never an extra total, totalTokens is
 * preserved without being added to components (C16).
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
    inputTotal: (rawInput ?? 0) + (rawCacheRead ?? 0) + (rawCacheWrite ?? 0),
    inputUncached: rawInput ?? 0,
    ...(output !== undefined ? { outputTotal: output } : {}),
    ...(rawCacheRead !== undefined ? { cacheRead: rawCacheRead } : {}),
    ...(rawCacheWrite !== undefined ? { cacheWrite: rawCacheWrite } : {}),
    ...(cacheWrite1h !== undefined ? { cacheWrite1h } : {}),
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  };
}

/** Minimal structural validation of an intelli AccountingSummary payload. */
export function accountingFromToolResult(result: unknown): AccountingSummary | null {
  if (!isJsonObject(result)) return null;
  const structured = result["structuredContent"];
  const details = result["details"];
  const candidate = isJsonObject(structured)
    ? structured["accounting"] ?? structured
    : isJsonObject(details) && isJsonObject(details["intelli"])
      ? details["intelli"]["accounting"]
      : null;
  if (!isJsonObject(candidate)) return null;
  const attempts = candidate["attempts"];
  const tokens = candidate["tokens"];
  if (typeof attempts !== "number" || !Number.isInteger(attempts) || attempts < 0) return null;
  if (!isJsonObject(tokens)) return null;
  return candidate as unknown as AccountingSummary;
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
      const parent = event["parentToolCallId"];
      const accounting = accountingFromToolResult(event["result"]);
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
