// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { OnUpdate } from "../host-types.js";
import type { SearchParams } from "../core/contracts.js";
import { searchSchema } from "../core/schemas.js";
import { search } from "../core/operations/search.js";
import { createNativeOperationContext, nativeResult } from "../native-operation-context.js";

export const intelliSearchTool = {
  name: "intelli_search",
  label: "Intelli Search",
  description:
    "Search the web and return a concise answer with source URLs. " +
    "For multi-page deep research, use intelli_research instead.",
  promptSnippet:
    "intelli_search(query): search the web and return synthesised results with source URLs",
  parameters: searchSchema,

  async execute(
    _toolCallId: string,
    params: SearchParams,
    signal: AbortSignal | undefined,
    _onUpdate: OnUpdate | undefined,
    ctx: ExtensionContext,
  ) {
    const context = await createNativeOperationContext(ctx, signal);
    return nativeResult(await search(params, context));
  },
};
