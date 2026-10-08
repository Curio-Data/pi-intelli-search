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
  // Permission hints (Pi >= 0.99 consumes them; older hosts ignore the
  // field). Semantically the same hints the standalone MCP package declares.
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
    params: ExtractParams,
    signal: AbortSignal | undefined,
    _onUpdate: OnUpdate | undefined,
    ctx: ExtensionContext,
  ) {
    const context = await createNativeOperationContext(ctx, signal);
    return nativeResult(await extract(params, context));
  },
};
