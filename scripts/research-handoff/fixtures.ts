// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type { callLlm } from "../../src/llm.js";
import { EXTRACTION_SYSTEM_PROMPT, COLLATION_SYSTEM_PROMPT } from "../../src/core/prompts.js";
import type { FrozenInputs } from "./contracts.js";
import type { ResearchSettings } from "../../src/core/types.js";
import { assembleFrozenInputs } from "./common-inputs.js";
import { studyParams, studySettings, BASELINE_COMMIT } from "./config.js";

/** Newly authored synthetic proof material. Never a measured source capture. */
export async function syntheticInputs(protocolRef: string, settings: ResearchSettings = studySettings()): Promise<FrozenInputs> {
  const urls = ["https://handoff.invalid/alpha", "https://handoff.invalid/beta"];
  return assembleFrozenInputs({
    params: studyParams(), settings,
    searchCompletion: { text: `Synthetic discovery: [Alpha](${urls[0]}) and [Beta](${urls[1]}).`, citations: [] },
    searchAttempts: 1,
    pages: urls.map((url, index) => ({ url, title: index ? "Beta" : "Alpha", status: "success" as const,
      content: `# Synthetic source ${index + 1}\n\nRAW_HANDOFF_SENTINEL_${index + 1}\nThis invented page contains source evidence for an offline adapter check.`, source: "markdown" })),
    meta: { capturedAt: "2026-11-04T00:00:00.000Z", coreCommit: BASELINE_COMMIT, protocolRef },
  });
}
export const syntheticDownstream: typeof callLlm = async (_ctx, _model, system, user, options) => {
  options?.onUsage?.({ input: 100, output: 30, cacheRead: 0, cacheWrite: 0 });
  if (system === EXTRACTION_SYSTEM_PROMPT) {
    if (!user.includes("RAW_HANDOFF_SENTINEL_")) throw new Error("Synthetic extraction received unexpected source bytes");
    return "Synthetic extracted evidence. This is a deterministic adapter check, not a factual research result.";
  }
  if (system === COLLATION_SYSTEM_PROMPT) {
    return "## Synthetic Summary\n\nThe two supplied pages yielded usable synthetic evidence. This report tests persistence and handoff only.";
  }
  throw new Error("Synthetic downstream attempted an unapproved stage");
};
