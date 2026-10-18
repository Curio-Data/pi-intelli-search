// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { it } from "node:test";
import { createNativeUsageCapture } from "../src/native-usage.js";

const sdk = { input: 7, output: 3, cacheRead: 2, cacheWrite: 1, reasoning: 0, totalTokens: 13 };

for (const event of [
  { type: "message_delta", usage: { output_tokens: 3 } },
  { type: "done", usage: sdk },
]) {
  it(`T16 ${event.type} usage does not suppress conservative SDK accounting`, () => {
    const capture = createNativeUsageCapture();
    capture.chunk(event);
    assert.deepEqual(capture.observation(sdk)?.tokens, {
      inputTotal: 10,
      inputUncached: 7,
      outputTotal: 3,
      cacheRead: 2,
      cacheWrite: 1,
    });
    assert.equal(capture.observation(sdk)?.source, "sdk-normalized");
  });
}

for (const alias of ["prompt_cache_hit_tokens", "cached_tokens"]) {
  it(`T16 raw ${alias} retains observed cache presence`, () => {
    const capture = createNativeUsageCapture();
    capture.chunk({
      usage: {
        prompt_tokens: 10,
        completion_tokens: 3,
        [alias]: 2,
        prompt_tokens_details: { cache_write_tokens: 0 },
      },
    });
    assert.deepEqual(capture.observation(sdk)?.tokens, {
      inputTotal: 10,
      inputUncached: 8,
      outputTotal: 3,
      cacheRead: 2,
      cacheWrite: 0,
    });
  });
}

it("T16 provider usage snapshots remain cumulative replacements, not sums or field merges", () => {
  const capture = createNativeUsageCapture();
  capture.chunk({
    usage: {
      prompt_tokens: 20,
      completion_tokens: 6,
      prompt_tokens_details: { cached_tokens: 2, cache_write_tokens: 1 },
    },
  });
  capture.chunk({ usage: { prompt_tokens: 10, completion_tokens: 3 } });
  assert.deepEqual(capture.observation(sdk)?.tokens, { inputTotal: 10, outputTotal: 3 });
});
