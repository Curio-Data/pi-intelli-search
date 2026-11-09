// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Harness-only global fetch tracer. Enable with NODE_OPTIONS=--import=<this file>
// and PI_INTELLI_E2E_HTTP_TRACE=<jsonl path>. No credentials or message bodies
// are recorded. Model request payloads are read only for their model identifier.

import { appendFileSync } from "node:fs";

const tracePath = process.env.PI_INTELLI_E2E_HTTP_TRACE;
const scenario = process.env.PI_INTELLI_E2E_SCENARIO ?? "unknown";
const loopModel = process.env.PI_INTELLI_E2E_LOOP_MODEL ?? "";

function redact(value) {
  return String(value)
    .replace(/sk-or-v1-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/([?&](?:key|api_key|access_token)=)[^&\s]+/gi, "$1[REDACTED]")
    .slice(0, 1200);
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
        ppid: process.ppid,
        ...event,
      })}\n`,
      { mode: 0o600 },
    );
  } catch {
    // Tracing must never change the result of the operation being measured.
  }
}

function safeUrl(raw) {
  try {
    const parsed = new URL(raw);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return redact(raw).split("?")[0];
  }
}

function payloadModel(body) {
  if (typeof body !== "string") return undefined;
  try {
    const payload = JSON.parse(body);
    return typeof payload.model === "string" ? payload.model : undefined;
  } catch {
    return undefined;
  }
}

function looksLikeModelCall(url, model) {
  if (process.env.PI_INTELLI_E2E_HTTP_ALL === "1") return true;
  return Boolean(
    model ||
      /\/(?:chat\/completions|responses|messages)(?:$|\?)/.test(url) ||
      /\/v1beta\/models\//.test(url),
  );
}

function responseHeaders(response) {
  const selected = {};
  for (const [name, value] of response.headers) {
    const lower = name.toLowerCase();
    if (
      lower === "retry-after" ||
      lower === "cf-ray" ||
      lower.startsWith("x-ratelimit-") ||
      lower === "openrouter-provider"
    ) {
      selected[lower] = redact(value);
    }
  }
  return selected;
}

function inspectModelBody(callId, status, text) {
  const candidates = [];
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) candidates.push(trimmed);
  for (const line of text.split("\n")) {
    if (line.startsWith("data:") && !line.includes("[DONE]")) {
      candidates.push(line.slice(5).trim());
    }
  }
  const errors = [];
  const routes = new Set();
  for (const candidate of candidates) {
    try {
      const data = JSON.parse(candidate);
      if (typeof data.provider === "string") routes.add(data.provider);
      if (data.error) {
        errors.push({
          code: data.error.code,
          type: data.error.type,
          message: redact(data.error.message ?? data.error),
          metadata: data.error.metadata ? {
            error_type: data.error.metadata.error_type,
            provider_code: data.error.metadata.provider_code,
            provider_name: data.error.metadata.provider_name,
            reason: data.error.metadata.reason,
            limit_source: data.error.metadata.limit_source,
          } : undefined,
        });
      }
    } catch {
      // Non-JSON events are not model error records.
    }
    if (errors.length >= 20) break;
  }
  for (const route of routes) write({ type: "http_route", callId, route });
  for (const error of errors) {
    write({ type: "http_stream_error", callId, status, error });
  }
}

if (tracePath) {
  const originalFetch = globalThis.fetch;
  let nextCallId = 1;
  globalThis.fetch = async function tracedFetch(input, init) {
    const rawUrl = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    const url = safeUrl(rawUrl);
    let model = payloadModel(init?.body);
    if (!model && typeof Request !== "undefined" && input instanceof Request && !init?.body) {
      input
        .clone()
        .text()
        .then((body) => {
          const requestModel = payloadModel(body);
          if (requestModel) write({ type: "http_request_model", callId, model: requestModel });
        })
        .catch(() => {});
    }
    if (!looksLikeModelCall(url, model)) return originalFetch(input, init);

    const callId = `${process.pid}-${nextCallId++}`;
    const started = performance.now();
    write({
      type: "http_request",
      callId,
      method: init?.method ?? (typeof input === "object" ? input.method : "GET"),
      url,
      model,
      roleHint: model && model === loopModel ? "possible-agent-loop" : "extension-or-other",
    });
    try {
      const response = await originalFetch(input, init);
      const headersAt = performance.now();
      write({
        type: "http_response",
        callId,
        url,
        model,
        status: response.status,
        retryAfter: response.headers.get("retry-after") ?? undefined,
        headers: responseHeaders(response),
        headersLatencyMs: Math.round(headersAt - started),
      });
      if (!response.body) {
        write({ type: "http_stream_settled", callId, totalLatencyMs: Math.round(performance.now() - started) });
      } else {
        let clone;
        try {
          clone = response.clone();
        } catch (error) {
          write({ type: "http_clone_error", callId, error: redact(error) });
        }
        if (clone) {
          clone
            .text()
            .then((text) => {
              write({
                type: "http_stream_settled",
                callId,
                totalLatencyMs: Math.round(performance.now() - started),
                responseChars: text.length,
              });
              inspectModelBody(callId, response.status, text);
            })
            .catch((error) => {
              write({
                type: "http_stream_error_boundary",
                callId,
                totalLatencyMs: Math.round(performance.now() - started),
                errorName: error?.name,
                error: redact(error),
              });
            });
        }
      }
      return response;
    } catch (error) {
      write({
        type: "http_error",
        callId,
        url,
        model,
        totalLatencyMs: Math.round(performance.now() - started),
        errorName: error?.name,
        error: redact(error),
        cause: error?.cause ? redact(error.cause) : undefined,
      });
      throw error;
    }
  };
  write({ type: "trace_fetch_installed", node: process.version });
}
