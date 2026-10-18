// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Json } from "../scripts/benchmarks/contracts.js";
import { parseUsageEvents } from "../scripts/benchmarks/usage-parser.js";

const tokenFields = [
  "inputTotal", "inputUncached", "outputTotal", "cacheRead", "cacheWrite",
  "cacheWrite1h", "reasoning", "totalTokens",
];

// Frozen shape of convertMcpResult in the inspected Pi 1.3.0 host:
// structuredContent is the whole CallToolResult (minus _meta), not its data.
// This is a parser fixture, not a live host/bridge integration verdict.
function convertedEvent(id: string, structuredContent: Json, isError = false): Json {
  return {
    type: "tool_execution_end", toolCallId: id,
    toolName: "mcp__research_server__intelli_research", isError,
    result: {
      content: [{ type: "text", text: isError ? "partial error" : "answer" }],
      details: { server: "research_server", tool: "intelli_research" },
      structuredContent: {
        content: [{ type: "text", text: isError ? "partial error" : "answer" }],
        structuredContent, ...(isError ? { isError: true } : {}),
      },
      ...(isError ? { isError: true } : {}),
    },
  };
}

function compact(meta: Record<string, Json> = {}): Json {
  return {
    outcome: "completed", text: "answer", details: {},
    meta: {
      schemaVersion: 1, operation: "intelli_research", attempts: 4,
      missingAttempts: 1, costComplete: false, reportedCost: 0.02, ...meta,
    },
  };
}

for (const mode of ["json", "rpc"] as const) {
  describe(`MCP envelope accounting (${mode}, D1/D2)`, () => {
    it("recognises the host envelope, including partial error results and repeated turn results", () => {
      const success = convertedEvent("success", compact());
      const failure = convertedEvent("failure", compact({ missingAttempts: 2 }), true);
      const parsed = parseUsageEvents([
        success, failure,
        { type: "turn_end", toolResults: [success, failure] },
      ], mode);
      assert.deepEqual(parsed.toolMessages.map((tool) => tool.toolCallId), ["success", "failure"]);
      assert.deepEqual(parsed.missing, []);
      const summary = parsed.toolMessages[0]!.accounting!;
      assert.equal(summary.attempts, 4);
      assert.equal(summary.observedAttempts, 3);
      assert.equal(summary.missingAttempts, 1);
      assert.deepEqual(summary.tokens, {});
      assert.deepEqual(summary.missingTokenFields, tokenFields);
      assert.equal(summary.parentDelivery, "unknown");
      assert.equal(summary.reportedCost.total, 0.02);
      assert.equal(parsed.toolMessages[1]!.accounting!.observedAttempts, 2);
    });

    it("records expected MCP intelli calls as missing when the envelope or marker is lost", () => {
      const parsed = parseUsageEvents([
        convertedEvent("marker-lost", {}),
        { type: "tool_execution_end", toolCallId: "result-lost", toolName: "mcp__another_server__intelli_search", result: {} },
        { type: "tool_execution_end", toolCallId: "foreign", toolName: "mcp__another_server__other_tool", result: {} },
      ], mode);
      assert.deepEqual(parsed.toolMessages.map((tool) => tool.toolCallId), ["marker-lost", "result-lost"]);
      assert.deepEqual(parsed.missing, ["marker-lost", "result-lost"]);
    });

    it("keeps malformed or missing attempt coverage explicitly missing, never complete", () => {
      for (const value of [null, "0", -1, 0.5, 5] as const) {
        const parsed = parseUsageEvents([convertedEvent("bad", compact({ missingAttempts: value }))], mode);
        assert.equal(parsed.toolMessages[0]!.accounting, null, String(value));
        assert.deepEqual(parsed.missing, ["bad"]);
      }
      const missing = { outcome: "error", meta: { schemaVersion: 1, operation: "intelli_research", attempts: 1, costComplete: false } };
      const parsed = parseUsageEvents([convertedEvent("absent", missing, true)], mode);
      assert.equal(parsed.toolMessages[0]!.accounting, null);
      assert.deepEqual(parsed.missing, ["absent"]);
    });

    it("extracts a full schema from the same envelope without confusing its holder", () => {
      const accounting = {
        attempts: 1, observedAttempts: 1, missingAttempts: 0,
        tokens: { inputTotal: 4 }, reportedCost: {}, estimatedCost: {},
        missingTokenFields: ["inputUncached"], costComplete: false, parentDelivery: "unknown",
      };
      const parsed = parseUsageEvents([convertedEvent("full", { schemaVersion: 1, operation: "intelli_research", accounting })], mode);
      assert.deepEqual(parsed.toolMessages[0]!.accounting, accounting);
      assert.deepEqual(parsed.missing, []);
    });

    it("does not admit an unrelated extension on a merely intelli-prefixed operation", () => {
      const parsed = parseUsageEvents([{
        type: "tool_execution_end", toolCallId: "foreign", toolName: "other_tool",
        result: { structuredContent: { schemaVersion: 1, operation: "intelli_unrelated", accounting: { attempts: 3, tokens: {} } } },
      }], mode);
      assert.deepEqual(parsed.toolMessages, []);
      assert.deepEqual(parsed.missing, []);
    });
  });
}
