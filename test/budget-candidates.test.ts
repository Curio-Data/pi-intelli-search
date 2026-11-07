// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { it } from "node:test";
import * as budget from "../src/core/output-budget.js";
import type { ModelCompletion } from "../src/core/contracts.js";

const candidate = (text: string, finishReason: ModelCompletion["finishReason"]) => ({
  completion: { text, finishReason, citations: [] } satisfies ModelCompletion,
  maxTokens: 100,
});

it("ranks completed candidates latest first, then truncated candidates longest first", () => {
  // Multiple completed candidates cannot arise in today's stop-on-completion
  // loop. Exercise the full ranking contract independently, in attempt order.
  const earlyComplete = candidate("An earlier completed response with more text.", "stop");
  const shortTruncated = candidate("Short.", "length");
  const latestComplete = candidate("Done.", "stop");
  const longTruncated = candidate("A much longer truncated response with more detail than any completed response.", "length");
  const attempts = [earlyComplete, shortTruncated, latestComplete, longTruncated];
  const original = [...attempts];
  assert.deepEqual(budget.rankBudgetedCompletions(attempts), [
    latestComplete, earlyComplete, longTruncated, shortTruncated,
  ]);
  assert.deepEqual(attempts, original, "ranking must not mutate attempt order");
});

it("ranks usage-exhausted responses as truncated even when their finish reason is stop", () => {
  const base = candidate("A long answer whose usage reached its cap despite a stop reason.", "stop");
  const exhausted = { ...base, completion: { ...base.completion, usage: { output: 100 } } };
  const complete = candidate("Complete.", undefined);
  // Put the exhausted response last: treating it as complete would win by recency.
  assert.deepEqual(budget.rankBudgetedCompletions([complete, exhausted]), [complete, exhausted]);
});
