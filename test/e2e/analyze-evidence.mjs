// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Summarise units/<id> or historical one-level runs. Legacy analysis retains
// research tool arguments; readUnitEvidence exports metadata only, never payloads.

import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function jsonl(path, health) {
  if (!existsSync(path)) { if (health) health.missing.push(basename(path)); return []; }
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        if (health) health.malformedRecords++;
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

function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

/** Selected metadata only: never copy prompt/completion bodies into unit receipts. */
export function readUnitEvidence(dir) {
  const health = { missing: [], malformedRecords: 0, malformedVerdicts: 0 };
  const responses = [
    ...jsonl(join(dir, "extension.jsonl"), health).filter((event) =>
      ["extension_http_response", "agent_http_response"].includes(event.type)),
    ...jsonl(join(dir, "http.jsonl"), health).filter((event) => event.type === "http_response"),
  ];
  const non200 = responses.filter((event) => Number.isInteger(event.status) && event.status !== 200);
  const retryAfter = responses.flatMap((event) => {
    const value = event.retryAfter ?? event.headers?.["retry-after"];
    return value === undefined || value === null || value === "" ? [] :
      [{ type: event.type, status: event.status, retryAfter: String(value).slice(0, 200) }];
  });
  const traceDir = join(dir, existsSync(join(dir, "traces")) ? "traces" : "pi-traces");
  const verdictFiles = existsSync(traceDir) ? readdirSync(traceDir).filter((file) => file.endsWith(".verdict.json")).sort() : [];
  const attempts = verdictFiles.flatMap((file) => {
    const verdict = readJson(join(traceDir, file));
    if (!verdict || typeof verdict.status !== "string") { health.malformedVerdicts++; return []; }
    return [{ file, status: verdict.status,
      binding: ["tool-call", "workspace-only"].includes(verdict.binding) ? verdict.binding : "unknown" }];
  });
  const accepted = attempts.filter((attempt) => attempt.status === "pass");
  const bindings = [...new Set((accepted.length ? accepted : attempts).map((attempt) => attempt.binding))];
  return { binding: bindings.length === 1 ? bindings[0] : bindings.length ? "mixed" : "unavailable", attempts,
    providerSignals: { responseRecords: responses.length, non200: non200.length,
      unknownStatusRecords: responses.filter((event) => !Number.isInteger(event.status)).length,
      non200StatusCounts: countBy(non200.map((event) => event.status)),
      retryAfter, saw429: non200.some((event) => event.status === 429),
      scope: "observed response records; channels may overlap; not a complete request census", health } };
}

export function analyzeRun(runDir) {
const unitLayout = existsSync(join(runDir, "units"));
const directoryRoot = unitLayout ? join(runDir, "units") : runDir;
const manifest = readJson(join(runDir, "manifest.json"));
const suite = readJson(join(runDir, "results.json"));
const expected = manifest?.units?.map((unit) => unit.id) ?? suite?.scenarios?.map((unit) => unit.id ?? unit.scenario?.replace(/\.sh$/, ""));
const discovered = readdirSync(directoryRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && (unitLayout || existsSync(join(directoryRoot, entry.name, "extension.jsonl"))))
  .map((entry) => entry.name);
const scenarioDirs = [...new Set(expected ?? discovered)]
  .filter((name) => typeof name === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name) && name !== "_preparation").sort();
const scenarios = [];
for (const name of scenarioDirs) {
  const dir = join(directoryRoot, name);
  const unitEvidence = readUnitEvidence(dir);
  const extension = jsonl(join(dir, "extension.jsonl"));
  const http = jsonl(join(dir, "http.jsonl"));
  const traceDir = join(dir, existsSync(join(dir, "traces")) ? "traces" : "pi-traces");
  const traceFiles = existsSync(traceDir)
    ? readdirSync(traceDir).filter((file) => file.endsWith(".jsonl")).sort()
    : [];
  const trace = traceFiles.flatMap((file) => jsonl(join(traceDir, file)));
  const resultPath = join(dir, "result.json");
  const result = readJson(resultPath) ?? readJson(join(dir, "supervision-failure.json")) ??
    suite?.scenarios?.find((unit) => (unit.id ?? unit.scenario?.replace(/\.sh$/, "")) === name) ?? null;

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
    ...unitEvidence,
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
  layout: unitLayout ? "units" : "legacy",
  scenarios,
  totals: {
    scenarioCount: scenarios.length,
    extensionAttempts: scenarios.reduce((sum, item) => sum + item.extension.attemptCount, 0),
    agentMessages: scenarios.reduce((sum, item) => sum + item.agent.messageCount, 0),
    extensionNon200: scenarios.reduce((sum, item) =>
      sum + Object.entries(item.providerEvidence.extensionStatusCounts)
        .filter(([status]) => status !== "200")
        .reduce((count, [, value]) => count + value, 0), 0),
    agentNon200: scenarios.reduce((sum, item) =>
      sum + Object.entries(item.providerEvidence.agentStatusCounts)
        .filter(([status]) => status !== "200")
        .reduce((count, [, value]) => count + value, 0), 0),
    retryNotices: scenarios.reduce((sum, item) => sum + item.retryNotices.length, 0),
    observedNon200: scenarios.reduce((sum, item) => sum + item.providerSignals.non200, 0),
    retryAfterRecords: scenarios.reduce((sum, item) => sum + item.providerSignals.retryAfter.length, 0),
    unitsWith429: scenarios.filter((item) => item.providerSignals.saw429).map((item) => item.scenario),
    missingResults: scenarios.filter((item) => !item.result).map((item) => item.scenario),
    malformedRecords: scenarios.reduce((sum, item) => sum + item.providerSignals.health.malformedRecords, 0),
  },
};
return analysis;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runDir = process.argv[2];
  if (!runDir) throw new Error("Usage: node test/e2e/analyze-evidence.mjs <run-directory> (units or legacy layout)");
  const analysis = analyzeRun(runDir);
  const output = join(runDir, "analysis.json");
  writeFileSync(output, `${JSON.stringify(analysis, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ output, totals: analysis.totals }, null, 2));
}
