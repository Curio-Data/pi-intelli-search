// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Harness-only Pi extension. Load after the extension under test with -e.
// It distinguishes extension registry calls from Pi agent-loop responses and
// records no prompts, completions, credentials, or request headers.
//
// It also enforces the harness research-call budget when
// E2E_RESEARCH_CALL_BUDGET is a positive integer (the parallel runner sets 1;
// it is off otherwise). The verdict never chooses between several research
// calls in one attempt, so every call beyond the first would be paid for and
// then discarded. The budget blocks each call over the limit before it runs
// and sets the host's `terminate` hint, which ends the agent run after a batch
// whose results all carry it. The run is deliberately not aborted: an abort
// replaces the blocked result's text (losing the marker the verdict counts)
// and, on the hosts tested, still lets the loop request one more model turn.

import { appendFileSync } from "node:fs";

const tracePath = process.env.PI_INTELLI_E2E_EXTENSION_TRACE;
/** Text the blocked tool result carries; scenario-verdict.mjs counts it. */
export const RESEARCH_BUDGET_MARKER = "E2E research-call budget";
const DEFAULT_BUDGET_TOOLS = "intelli_research,mcp__intelli_search__intelli_research";
const scenario = process.env.PI_INTELLI_E2E_SCENARIO ?? "unknown";
let nextCallId = 1;

function redact(value) {
  return String(value)
    .replace(/sk-or-v1-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .slice(0, 1600);
}

function write(event) {
  if (!tracePath) return;
  try {
    appendFileSync(
      tracePath,
      `${JSON.stringify({
        ts: new Date().toISOString(),
        monoMs: Math.round(performance.now() * 1000) / 1000,
        scenario,
        pid: process.pid,
        ...event,
      })}\n`,
      { mode: 0o600 },
    );
  } catch {
    // Evidence capture is deliberately fail-safe.
  }
}

function stageFor(systemPrompt) {
  if (systemPrompt.startsWith("You are a web search assistant.")) return "search";
  if (systemPrompt.startsWith("You are a technical content extraction assistant.")) return "extract";
  if (systemPrompt.startsWith("You are a research collation assistant")) return "collate";
  if (systemPrompt.startsWith("You judge search query relevance.")) return "cacheSuggest";
  return "other-extension-call";
}

function selectedHeaders(headers) {
  const result = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    const lower = name.toLowerCase();
    if (lower === "retry-after" || lower === "cf-ray" || lower.startsWith("x-ratelimit-")) {
      result[lower] = redact(value);
    }
  }
  return result;
}

function instrumentRegistry(registry) {
  if (!registry || registry.__piIntelliE2ETraced || typeof registry.streamSimple !== "function") return;
  const original = registry.streamSimple;
  registry.streamSimple = function tracedRegistryStream(model, context, options = {}) {
    const callId = `registry-${process.pid}-${nextCallId++}`;
    const started = performance.now();
    let routeLogged = false;
    const stage = stageFor(context?.systemPrompt ?? "");
    write({
      type: "extension_attempt_start",
      callId,
      stage,
      provider: model.provider,
      model: model.id,
    });
    const wrapped = {
      ...options,
      onResponse: async (response) => {
        write({
          type: "extension_http_response",
          callId,
          stage,
          provider: model.provider,
          model: model.id,
          status: response.status,
          retryAfter: response.headers?.["retry-after"],
          headers: selectedHeaders(response.headers),
          latencyMs: Math.round(performance.now() - started),
        });
        await options.onResponse?.(response);
      },
      onProviderStreamEvent: (data) => {
        if (!routeLogged && typeof data?.provider === "string") {
          routeLogged = true;
          write({ type: "extension_route", callId, stage, route: data.provider });
        }
        if (data?.error) {
          write({
            type: "extension_stream_error",
            callId,
            stage,
            error: redact(data.error.message ?? data.error),
            code: data.error.code,
          });
        }
        return options.onProviderStreamEvent?.(data);
      },
    };
    let stream;
    try {
      stream = original.call(this, model, context, wrapped);
    } catch (error) {
      write({
        type: "extension_attempt_end",
        callId,
        stage,
        outcome: "throw",
        errorName: error?.name,
        error: redact(error),
        latencyMs: Math.round(performance.now() - started),
      });
      throw error;
    }
    return new Proxy(stream, {
      get(target, property, receiver) {
        if (property !== "result") {
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        }
        return async () => {
          try {
            const message = await target.result();
            write({
              type: "extension_attempt_end",
              callId,
              stage,
              outcome: message.stopReason === "error" ? "provider-error" : "response",
              stopReason: message.stopReason,
              error: message.errorMessage ? redact(message.errorMessage) : undefined,
              latencyMs: Math.round(performance.now() - started),
            });
            return message;
          } catch (error) {
            write({
              type: "extension_attempt_end",
              callId,
              stage,
              outcome: "throw",
              errorName: error?.name,
              error: redact(error),
              latencyMs: Math.round(performance.now() - started),
            });
            throw error;
          }
        };
      },
    });
  };
  Object.defineProperty(registry, "__piIntelliE2ETraced", { value: true });
  write({ type: "trace_registry_installed" });
}

/**
 * Install the research-call budget. Only validated calls reach `tool_call`, so
 * a call the host rejects for its arguments costs nothing and is not counted.
 */
export function installResearchBudget(pi, env = process.env) {
  const limit = Number(env.E2E_RESEARCH_CALL_BUDGET);
  if (!Number.isInteger(limit) || limit < 1) return false;
  const tools = new Set((env.E2E_RESEARCH_BUDGET_TOOLS || DEFAULT_BUDGET_TOOLS).split(",").map((t) => t.trim()).filter(Boolean));
  let calls = 0;
  pi.on("tool_call", (event) => {
    if (!tools.has(event.toolName)) return undefined;
    calls += 1;
    if (calls <= limit) {
      write({ type: "research_call_budget", action: "allowed", tool: event.toolName, call: calls, limit });
      return undefined;
    }
    write({ type: "research_call_budget", action: "blocked", tool: event.toolName, call: calls, limit, toolCallId: event.toolCallId });
    return {
      block: true,
      terminate: true,
      reason: `${RESEARCH_BUDGET_MARKER}: research call ${calls} exceeds the harness limit of ${limit} per attempt; the attempt is stopped and its verdict is an oracle failure`,
    };
  });
  write({ type: "research_call_budget_installed", limit, tools: [...tools] });
  return true;
}

export default function traceExtension(pi) {
  installResearchBudget(pi);
  if (!tracePath) return;
  pi.on("session_start", (_event, ctx) => {
    instrumentRegistry(ctx.modelRegistry);
  });
  pi.on("after_provider_response", (event, ctx) => {
    write({
      type: "agent_http_response",
      provider: ctx.model?.provider,
      model: ctx.model?.id,
      status: event.status,
      retryAfter: event.headers?.["retry-after"],
      headers: selectedHeaders(event.headers),
    });
  });
  pi.on("message_end", (event) => {
    const message = event.message;
    if (message?.role !== "assistant") return;
    write({
      type: "agent_message_end",
      provider: message.provider,
      model: message.model,
      stopReason: message.stopReason,
      rawStopReason: message.rawStopReason,
      durationMs: message.durationMs,
      error: message.errorMessage ? redact(message.errorMessage) : undefined,
    });
  });
  try {
    pi.on("before_provider_request", (_event, ctx) => {
      write({ type: "agent_request", provider: ctx.model?.provider, model: ctx.model?.id });
    });
    pi.on("provider_stream_event", (event) => {
      if (event.data?.error) {
        write({
          type: "agent_stream_error",
          provider: event.provider,
          model: event.model,
          code: event.data.error.code,
          error: redact(event.data.error.message ?? event.data.error),
        });
      }
    });
  } catch (error) {
    write({ type: "trace_optional_events_unavailable", error: redact(error) });
  }
  write({ type: "trace_extension_loaded" });
}
