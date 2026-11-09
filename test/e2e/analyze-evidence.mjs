// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Summarise a run produced by test/run-e2e-parallel.sh without retaining
// prompts, completions, credentials, or full provider payloads.

import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const runDir = process.argv[2];
if (!runDir) throw new Error("Usage: node test/e2e/analyze-evidence.mjs <run-directory>");

function jsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function countBy(values) {
  const result = {};
  for (const value of values) {
    const key = String(value ?? "missing");
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((sorted.length - 1) * fraction))];
}

function latencyStats(values) {
  return {
    count: values.length,
    minMs: values.length ? Math.min(...values) : null,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: values.length ? Math.max(...values) : null,
    totalMs: values.reduce((sum, value) => sum + value, 0),
  };
}

const scenarioDirs = readdirSync(runDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(runDir, entry.name, "extension.jsonl")))
  .map((entry) => entry.name)
  .sort();

const scenarios = [];
for (const name of scenarioDirs) {
  const dir = join(runDir, name);
  const extension = jsonl(join(dir, "extension.jsonl"));
  const http = jsonl(join(dir, "http.jsonl"));
  const traceDir = join(dir, "pi-traces");
  const traceFiles = existsSync(traceDir)
    ? readdirSync(traceDir).filter((file) => file.endsWith(".jsonl")).sort()
    : [];
  const trace = traceFiles.flatMap((file) => jsonl(join(traceDir, file)));
  const resultPath = join(dir, "result.json");
  const result = existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, "utf8")) : null;

  const agentMessages = trace.flatMap((event) => {
    const message = event.type === "message_end" ? event.message : undefined;
    if (message?.role !== "assistant") return [];
    return [{
      provider: message.provider,
      model: message.model,
      stopReason: message.stopReason,
      rawStopReason: message.rawStopReason,
      durationMs: message.durationMs,
      errorMessage: message.errorMessage,
      timestamp: message.timestamp,
    }];
  });
  const agentEventMessages = extension
    .filter((event) => event.type === "agent_message_end")
    .map((event) => ({
      provider: event.provider,
      model: event.model,
      stopReason: event.stopReason,
      rawStopReason: event.rawStopReason,
      durationMs: event.durationMs,
      errorMessage: event.error,
    }));
  const effectiveAgentMessages = agentMessages.length > 0 ? agentMessages : agentEventMessages;
  const retryNotices = trace.flatMap((event) => {
    if (event.type !== "tool_execution_update") return [];
    const text = (event.partialResult?.content ?? [])
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    return /retrying|timed out|rate limit|HTTP (?:429|402)/i.test(text) ? [text] : [];
  });
  const researchCalls = trace.flatMap((event) =>
    event.type === "tool_execution_start" &&
    (event.toolName === "intelli_research" || event.toolName?.endsWith("__intelli_research"))
      ? [{ toolName: event.toolName, args: event.args }]
      : [],
  );
  const toolEnds = trace.flatMap((event) =>
    event.type === "tool_execution_end" &&
    (event.toolName === "intelli_research" || event.toolName?.endsWith("__intelli_research"))
      ? [{ toolName: event.toolName, isError: event.isError, durationMs: event.durationMs }]
      : [],
  );
  const extensionAttempts = extension.filter((event) => event.type === "extension_attempt_end");
  const extensionResponses = extension.filter((event) => event.type === "extension_http_response");
  const agentResponses = extension.filter((event) => event.type === "agent_http_response");
  const unsettledHttp = http.filter((event) => event.type === "http_request").filter((request) =>
    !http.some((event) =>
      event.callId === request.callId &&
      ["http_error", "http_stream_settled", "http_stream_error_boundary"].includes(event.type),
    ),
  );

  scenarios.push({
    scenario: name,
    result,
    providerEvidence: {
      extensionStatusCounts: countBy(extensionResponses.map((event) => event.status)),
      agentStatusCounts: countBy(agentResponses.map((event) => event.status)),
      interceptedFetchStatusCounts: countBy(http.filter((event) => event.type === "http_response").map((event) => event.status)),
      retryAfter: [...extensionResponses, ...agentResponses, ...http.filter((event) => event.type === "http_response")]
        .filter((event) => event.retryAfter || event.headers?.["retry-after"])
        .map((event) => ({ type: event.type, status: event.status, retryAfter: event.retryAfter ?? event.headers["retry-after"] })),
      agentRequests: extension.filter((event) => event.type === "agent_request").length,
      agentStreamErrors: extension.filter((event) => event.type === "agent_stream_error"),
      extensionRoutes: countBy(extension.filter((event) => event.type === "extension_route").map((event) => event.route)),
      extensionProviderErrors: extension.filter((event) =>
        event.type === "extension_stream_error" ||
        (event.type === "extension_attempt_end" && event.outcome === "provider-error") ||
        (event.type === "extension_attempt_end" && event.outcome === "throw"),
      ),
      interceptedFetchErrors: http.filter((event) => event.type === "http_stream_error" || event.type === "http_error"),
      unsettledInterceptedFetchCount: unsettledHttp.length,
    },
    extension: {
      attemptCount: extensionAttempts.length,
      attemptsByStage: countBy(extensionAttempts.map((event) => event.stage)),
      outcomes: countBy(extensionAttempts.map((event) => event.outcome)),
      latency: latencyStats(extensionAttempts.map((event) => event.latencyMs).filter(Number.isFinite)),
      slowest: extensionAttempts
        .map((event) => ({ stage: event.stage, model: event.model, latencyMs: event.latencyMs, outcome: event.outcome }))
        .sort((a, b) => (b.latencyMs ?? 0) - (a.latencyMs ?? 0))
        .slice(0, 5),
    },
    agent: {
      messageCount: effectiveAgentMessages.length,
      statusCounts: countBy(agentResponses.map((event) => event.status)),
      stopReasons: countBy(effectiveAgentMessages.map((event) => event.stopReason)),
      latency: latencyStats(effectiveAgentMessages.map((event) => event.durationMs).filter(Number.isFinite)),
      calls: effectiveAgentMessages,
    },
    researchCalls,
    toolEnds,
    retryNotices,
    traceFileCount: traceFiles.length,
  });
}

const analysis = {
  generatedAt: new Date().toISOString(),
  runName: basename(runDir),
  scenarios,
  totals: {
    scenarioCount: scenarios.length,
    extensionAttempts: scenarios.reduce((sum, item) => sum + item.extension.attemptCount, 0),
    agentMessages: scenarios.reduce((sum, item) => sum + item.agent.messageCount, 0),
    extensionNon200: scenarios.reduce((sum, item) =>
      sum + Object.entries(item.providerEvidence.extensionStatusCounts)
        .filter(([status]) => !status.startsWith("2"))
        .reduce((count, [, value]) => count + value, 0), 0),
    agentNon200: scenarios.reduce((sum, item) =>
      sum + Object.entries(item.providerEvidence.agentStatusCounts)
        .filter(([status]) => !status.startsWith("2"))
        .reduce((count, [, value]) => count + value, 0), 0),
    retryNotices: scenarios.reduce((sum, item) => sum + item.retryNotices.length, 0),
  },
};
const output = join(runDir, "analysis.json");
writeFileSync(output, `${JSON.stringify(analysis, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ output, totals: analysis.totals }, null, 2));
