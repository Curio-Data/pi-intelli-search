// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { createHash } from "node:crypto";
import type { RunRecord } from "./contracts.js";

/** Validate the unchanged return, not just the tool topology.
 * The envelope is pinned to Pi 1.5.0 extensions/codemode/execute.js:
 * header + one returned/text() item, or its documented console-output wrapper.
 * No Markdown summary extraction or delimiter guessing is performed.
 */
export function checkReturnContract(record: Pick<RunRecord, "manifest" | "toolCalls" | "adapterEvents">): { preserved: boolean; problems: string[] } {
  const problems: string[] = [];
  const top = record.toolCalls.filter(call => !call.parentToolCallId);
  const research = record.toolCalls.filter(call => call.name === "intelli_research");
  const results = record.adapterEvents.filter(event => event.kind === "research-result");
  if (research.length !== 1 || results.length !== 1 || top.length !== 1) {
    return { preserved: false, problems: ["Return contract requires one research result and one top-level handoff"] };
  }
  const native = research[0].resultText;
  if (typeof native !== "string" || !native || research[0].isError) {
    return { preserved: false, problems: ["Native research text is absent or errored"] };
  }
  const hash = createHash("sha256").update(native).digest("hex");
  if (results[0].data.textSha256 !== hash) problems.push("Observed native research text differs from the core result hash");
  if (record.manifest.arm === "baseline") {
    if (top[0].id !== research[0].id || research[0].parentToolCallId) problems.push("Baseline did not return research directly");
  } else {
    if (top[0].name !== "codemode" || research[0].parentToolCallId !== top[0].id || top[0].isError) {
      problems.push("Candidate did not return its one nested research call successfully");
    }
    const visible = top[0].resultText ?? "";
    const header = /^Script completed\nWall time \d+\.\d seconds\nOutput:\n/.exec(visible);
    if (!header) problems.push("Candidate return has no recognised pinned-host success envelope");
    else {
      const output = visible.slice(header[0].length);
      if (output !== native && output !== `<console_output>\n${native}\n</console_output>`) {
        problems.push("Candidate did not expose the complete unchanged native text exactly once");
      }
    }
  }
  return { preserved: problems.length === 0, problems };
}
