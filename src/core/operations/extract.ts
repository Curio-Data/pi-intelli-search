// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { EXTRACTION_SYSTEM_PROMPT } from "../prompts.js";
import { completeOperationModel } from "../operation-model.js";
import type { ExtractParams } from "../contracts.js";
import { inferSourceType, inferCurrentness, throwIfAborted } from "../util.js";
import { buildExtractionMessage } from "../messages.js";
import type { OperationContext, OperationResult } from "../contracts.js";

export async function extract(
  params: ExtractParams,
  context: OperationContext,
): Promise<OperationResult> {
  const { settings, signal } = context;
  throwIfAborted(signal);
  const extractConfig = settings.extractModel;

  const userMessage = buildExtractionMessage(
    params.content,
    params.query,
    params.focusPrompt,
    settings.extractMaxChars,
  );

  const { text: extraction } = await completeOperationModel(
    context,
    "extract",
    {
      model: extractConfig,
      systemPrompt: EXTRACTION_SYSTEM_PROMPT,
      userMessage,
      maxTokens: settings.extractionMaxTokens,
      signal,
    },
    "S1",
  );

  throwIfAborted(signal);
  const firstLine = extraction.split("\n")[0] ?? "";
  const sourceType = inferSourceType(firstLine);
  const currentness = inferCurrentness(firstLine);

  return {
    text: `### Extraction: ${params.title}\n\n${extraction}`,
    outcome: "completed",
    details: { url: params.url, extraction, sourceType, currentness },
  };
}
