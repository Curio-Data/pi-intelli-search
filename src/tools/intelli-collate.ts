// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { OnUpdate } from "../host-types.js";
import type { CollateParams } from "../core/contracts.js";
import { collateSchema } from "../core/schemas.js";
import { collate } from "../core/operations/collate.js";
import { createNativeOperationContext, nativeResult } from "../native-operation-context.js";

export const intelliCollateTool = {
  name: "intelli_collate",
  label: "Intelli Collate",
  description:
    "Deduplicate and synthesise multiple per-page extractions into a single " +
    "concise summary. Caches results to .search/ for follow-up; a successful " +
    "repeat on the same UTC date attempts to archive the previous cached " +
    "files to the lowest free numbered sibling folder (.1, then .2 and so on) " +
    "first. Archiving is best-effort: a failure lets the completed run " +
    "replace files in place, so copy a report elsewhere if it must be " +
    "retained. Use this " +
    "after extracting multiple pages with intelli_extract; for end-to-end " +
    "research, use intelli_research.",
  promptSnippet:
    "intelli_collate(extractions, query): deduplicate and synthesise extractions into concise summary",
  executionMode: "sequential" as const,
  parameters: collateSchema,

  async execute(
    _toolCallId: string,
    params: CollateParams,
    signal: AbortSignal | undefined,
    _onUpdate: OnUpdate | undefined,
    ctx: ExtensionContext,
  ) {
    const context = await createNativeOperationContext(ctx, signal);
    return nativeResult(await collate(params, context));
  },
};
