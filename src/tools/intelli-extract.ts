// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { OnUpdate } from "../host-types.js";
import type { ExtractParams } from "../core/contracts.js";
import { extractSchema } from "../core/schemas.js";
import { extract } from "../core/operations/extract.js";
import { createNativeOperationContext, nativeResult } from "../native-operation-context.js";

export const intelliExtractTool = {
  name: "intelli_extract",
  label: "Intelli Extract",
  description:
    "Extract query-relevant content from a web page. Compresses full page content " +
    "to the parts that matter for a given query, preserving code blocks, API " +
    "signatures, and technical detail verbatim. Use this for individual pages " +
    "you already have; for end-to-end research, use intelli_research.",
  promptSnippet:
    "intelli_extract(page, query, focusPrompt?): LLM extraction of query-relevant content from a web page",
  parameters: extractSchema,

  async execute(
    _toolCallId: string,
    params: ExtractParams,
    signal: AbortSignal | undefined,
    _onUpdate: OnUpdate | undefined,
    ctx: ExtensionContext,
  ) {
    const context = await createNativeOperationContext(ctx, signal);
    return nativeResult(await extract(params, context));
  },
};
