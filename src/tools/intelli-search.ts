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
  // Permission hints (Pi >= 0.99 consumes them; older hosts ignore the
  // field). Semantically the same hints the standalone MCP package declares:
  // reading the open web, no workspace mutation, not idempotent (provider
  // results vary call to call). destructiveHint is stated explicitly where
  // the MCP package relies on the default.
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  // Prefer strict JSON-schema sampling where the active model supports it;
  // capability metadata downgrades unsupported models to normal tool calls.
  constrainedSampling: { type: "json_schema", strict: "prefer" } as const,

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
