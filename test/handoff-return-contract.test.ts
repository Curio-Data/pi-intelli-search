// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { checkReturnContract } from "../scripts/research-handoff/return-contract.js";
import { unavailableRecord } from "../scripts/research-handoff/storage.js";

const TEXT = "Useful synthetic summary.\nReport: .search/new/report.md\nNecessary failure status.";
const HEADER = "Script completed\nWall time 0.1 seconds\nOutput:\n";
function fixture(candidate: boolean) {
  const record = unavailableRecord("return-fixture", "synthetic", "synthetic fixture");
  record.manifest.arm = candidate ? "candidate" : "baseline";
  record.toolCalls = candidate
    ? [{ id: "script", name: "codemode", input: {}, resultText: HEADER + TEXT },
      { id: "research", parentToolCallId: "script", name: "intelli_research", input: {}, resultText: TEXT }]
    : [{ id: "research", name: "intelli_research", input: {}, resultText: TEXT }];
  record.adapterEvents = [{ kind: "research-result", data: { textSha256: createHash("sha256").update(TEXT).digest("hex") } }];
  return record;
}
test("handoff unchanged-return check accepts exact native text and pinned host wrappers", () => {
  assert.equal(checkReturnContract(fixture(false)).preserved, true);
  assert.equal(checkReturnContract(fixture(true)).preserved, true);
  const consoleResult = fixture(true);
  consoleResult.toolCalls[0].resultText = `${HEADER}<console_output>\n${TEXT}\n</console_output>`;
  assert.equal(checkReturnContract(consoleResult).preserved, true);
});
test("handoff unchanged-return check rejects silent projections, duplication and changed native text", () => {
  for (const output of [TEXT.slice(0, 20), TEXT + TEXT, JSON.stringify(TEXT), "", `Extra summary\n${TEXT}`]) {
    const record = fixture(true); record.toolCalls[0].resultText = HEADER + output;
    assert.equal(checkReturnContract(record).preserved, false);
  }
  const changed = fixture(false); changed.toolCalls[0].resultText = "Changed after the core returned";
  assert.equal(checkReturnContract(changed).preserved, false);
});
