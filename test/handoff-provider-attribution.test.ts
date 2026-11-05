// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { providerInputAttribution } from "../scripts/research-handoff/provider-attribution.js";
import { observedPipelineOutcome } from "../scripts/research-handoff/outcome.js";
import type { MainAttempt, RunRecord } from "../scripts/research-handoff/contracts.js";

function attempt(): MainAttempt {
  return {
    id: "a", startedAt: "2026-11-05T00:00:00Z", status: "completed", wireEncoding: "synthetic",
    usage: { input: 30, output: 2 },
    payload: { instructions: "System", input: [{ role: "developer", type: "additional_tools", tools: [{ name: "example" }] }] },
    rawUsage: {
      input_tokens: 30,
      attribution: {
        items: { at_example: { input_tokens: 10 }, msg_example: { input_tokens: 15, content: [{ input_tokens: 15 }] } },
        request_fields: { instructions: { input_tokens: 5 } },
      },
    },
  };
}

describe("provider item attribution", () => {
  it("reconciles parent counts without double-counting nested content", () => {
    assert.deepEqual(providerInputAttribution(attempt()), {
      source: "provider-raw-usage", available: true, reconciled: true,
      providerInputTokens: 30, accountedInputTokens: 30, residual: 0,
      declarationInputTokens: 10, instructionInputTokens: 5, problems: [],
    });
  });

  it("keeps absent provider attribution unknown", () => {
    const input = attempt(); delete input.rawUsage;
    assert.deepEqual(providerInputAttribution(input), {
      source: "provider-raw-usage", available: false, reconciled: false, problems: [],
    });
  });

  it("does not infer zero declarations from an unknown payload shape", () => {
    const input = attempt(); input.payload = { tools: [{ name: "example" }] };
    const result = providerInputAttribution(input);
    assert.equal(result.reconciled, true);
    assert.equal(result.declarationInputTokens, undefined);
    assert.match(result.problems.join(" "), /shape is not recognised/);
  });

  it("leaves ambiguous or non-developer declaration mappings unknown", () => {
    for (const payload of [
      { instructions: "System", tools: [], input: [{ role: "developer", type: "additional_tools", tools: [] }] },
      { instructions: "System", input: [{ role: "user", type: "additional_tools", tools: [] }] },
      { instructions: "System", input: [
        { role: "developer", type: "additional_tools", tools: [] },
        { role: "developer", type: "additional_tools", tools: [] },
      ] },
    ]) {
      const input = attempt(); input.payload = payload;
      assert.equal(providerInputAttribution(input).declarationInputTokens, undefined);
    }
  });

  it("withholds components on missing, invalid or unreconciled parent counts", () => {
    for (const value of [undefined, -1, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1, "10"]) {
      const input = attempt();
      input.rawUsage = { input_tokens: 30, attribution: { items: { at_test: { input_tokens: value } }, request_fields: {} } };
      const result = providerInputAttribution(input);
      assert.equal(result.reconciled, false);
      assert.equal(result.declarationInputTokens, undefined);
      assert.ok(result.problems.length);
    }
    const input = attempt();
    input.rawUsage = { input_tokens: 30, attribution: { items: { at_test: { input_tokens: 5 } }, request_fields: {} } };
    const result = providerInputAttribution(input);
    assert.equal(result.residual, 25);
    assert.equal(result.reconciled, false);
    assert.equal(result.declarationInputTokens, undefined);
  });

  it("reconciles cached usage with function and custom-tool parents without adding cache or output", () => {
    const input = attempt();
    input.usage = { input: 30, output: 100, cacheRead: 12, cacheWrite: 1 };
    input.rawUsage = { input_tokens: 30, input_tokens_details: { cached_tokens: 12, cache_write_tokens: 1 }, output_tokens: 100,
      attribution: {
        items: {
          at_example: { input_tokens: 10, cached_tokens: 4, output_tokens: 0 },
          msg_example: { input_tokens: 10, cached_tokens: 4, content: [{ input_tokens: 10 }] },
          fc_example: { input_tokens: 4, output_tokens: 100 },
          ctc_example: { input_tokens: 2, cached_tokens: 2, output_tokens: 0 },
          ctco_example: { input_tokens: 1, content: [{ input_tokens: 1 }] },
        },
        request_fields: { instructions: { input_tokens: 3, cached_tokens: 2, cache_write_tokens: 1 } },
      },
    };
    const result = providerInputAttribution(input);
    assert.equal(result.accountedInputTokens, 30);
    assert.equal(result.declarationInputTokens, 10);
    assert.equal(result.reconciled, true);
  });

  it("detects raw and recorded total disagreement", () => {
    const input = attempt(); input.usage!.input = 31;
    const result = providerInputAttribution(input);
    assert.equal(result.reconciled, false);
    assert.equal(result.declarationInputTokens, undefined);
    assert.match(result.problems.join(" "), /totals differ/);
  });

  it("retains a provider-reported zero as known", () => {
    const input = attempt(); input.usage!.input = 0;
    input.rawUsage = { input_tokens: 0, attribution: {
      items: { at_test: { input_tokens: 0 } }, request_fields: { instructions: { input_tokens: 0 } },
    } };
    assert.equal(providerInputAttribution(input).declarationInputTokens, 0);
    assert.equal(providerInputAttribution(input).instructionInputTokens, 0);
  });
});

describe("event-derived pipeline outcomes", () => {
  it("separates never started, interrupted, returned and failed pipelines", () => {
    const input: Pick<RunRecord, "adapterEvents" | "error"> = { adapterEvents: [] };
    assert.equal(observedPipelineOutcome(input), "not-started");
    input.adapterEvents.push({ kind: "pipeline-attempt", data: {} });
    assert.equal(observedPipelineOutcome(input), "incomplete");
    input.adapterEvents.push({ kind: "research-result", data: { outcome: "completed" } });
    assert.equal(observedPipelineOutcome(input), "completed");
    input.adapterEvents.push({ kind: "research-error", data: { message: "Empty collation" } });
    assert.equal(observedPipelineOutcome(input), "error");
  });

  it("does not turn a completed pipeline into a pipeline error when the later main turn fails", () => {
    assert.equal(observedPipelineOutcome({
      adapterEvents: [{ kind: "research-result", data: { outcome: "completed" } }],
      error: "Main response failed after the tool result",
    }), "completed");
  });

  it("does not mistake an input-control failure after a core return for completion", () => {
    assert.equal(observedPipelineOutcome({ adapterEvents: [
      { kind: "research-result", data: { outcome: "completed" } },
      { kind: "input-control-failed", data: {} },
    ] }), "error");
    assert.equal(observedPipelineOutcome({ adapterEvents: [], error: "worker stopped" }), "error");
  });
});
