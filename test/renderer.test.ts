// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// test/renderer.test.ts — deterministic coverage for the research tool's
// result renderer: the Pi 1.1.0 durationMs line appears only when the host
// supplies a duration of at least one second, and formatDuration matches
// Pi's shell-duration formatting.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { intelliResearchTool, progressUpdate, formatDuration } from "../src/tools/intelli-research.js";

const theme = {
  fg: (_name: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Parameters<typeof intelliResearchTool.renderResult>[2];

function rendered(durationMs: number | undefined): string {
  const result = {
    content: [{ type: "text", text: "summary text" }],
  } as Parameters<typeof intelliResearchTool.renderResult>[0];
  const component = intelliResearchTool.renderResult(
    result,
    { isPartial: false, expanded: false },
    theme,
    durationMs === undefined ? {} : { durationMs },
  ) as unknown as { render(width: number): string[] };
  return component.render(120).join("\n");
}

describe("intelli_research result renderer duration line", () => {
  it("appends the duration when the host supplies durationMs >= 1000", () => {
    const text = rendered(93_500);
    assert.match(text, /summary text/);
    assert.match(text, /⏱ 1m 33s/);
  });

  it("omits the line below one second, when undefined, and on pre-1.1.0 hosts", () => {
    for (const durationMs of [0, 999, undefined]) {
      const text = rendered(durationMs);
      assert.match(text, /summary text/);
      assert.doesNotMatch(text, /⏱/);
    }
  });

  it("renders the progress bar for partial results regardless of duration", () => {
    const result = {
      content: [],
      details: progressUpdate("extract", "extracting", { current: 1, total: 3 }).details,
    } as unknown as Parameters<typeof intelliResearchTool.renderResult>[0];
    const component = intelliResearchTool.renderResult(
      result,
      { isPartial: true, expanded: false },
      theme,
      { durationMs: 5_000 },
    ) as unknown as { render(width: number): string[] };
    assert.match(component.render(120).join("\n"), /Extract/);
  });
});

describe("formatDuration", () => {
  const cases: Array<[number, string]> = [
    [12_340, "12.3s"],
    [59_999, "60.0s"],
    [60_000, "1m 0s"],
    [93_500, "1m 33s"],
    [3_600_000, "1h 0m 0s"],
    [7_425_000, "2h 3m 45s"],
  ];
  for (const [ms, expected] of cases) {
    it(`formats ${ms}ms as ${expected}`, () => {
      assert.equal(formatDuration(ms), expected);
    });
  }
});
