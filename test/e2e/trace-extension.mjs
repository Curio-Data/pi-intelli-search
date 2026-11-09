// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Harness-only Pi extension. Load after the extension under test with -e.
// It distinguishes extension registry calls from Pi agent-loop responses and
// records no prompts, completions, credentials, or request headers.

import { appendFileSync } from "node:fs";

const tracePath = process.env.PI_INTELLI_E2E_EXTENSION_TRACE;
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

export default function traceExtension(pi) {
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
