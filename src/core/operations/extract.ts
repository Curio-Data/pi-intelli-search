// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { EXTRACTION_SYSTEM_PROMPT } from "../prompts.js";
import { completeOperationModel } from "../operation-model.js";
import type { ExtractParams, Context, CoreResult } from "../contracts.js";
import { createStandaloneResult } from "../standalone-result.js";
import { produceCoreResult } from "../operation-result.js";
import { inferSourceType, inferCurrentness, throwIfAborted } from "../util.js";
import { buildExtractionMessage } from "../messages.js";
import type { OperationContext, OperationResult } from "../contracts.js";

export function extract(params: ExtractParams, context: Context): Promise<CoreResult> {
  const input = structuredClone(params);
  return produceCoreResult(
    context,
    (legacy) => {
      const producer = createStandaloneResult(
        "intelli_extract",
        input,
        context.services.clock,
        context.services.onProgress,
        (diagnostic) => legacy.logger.warn(`${diagnostic.code}: ${diagnostic.message}`),
      );
      return {
        get active() {
          return producer.active;
        },
        settled: producer.settled,
        dispose: producer.dispose,
        run: (scoped) => producer.run(scoped, (ctx) => legacyExtract(input, ctx)),
      };
    },
    "extract",
  );
}

/** Explicit compatibility entrypoint; not used by registered execution. */
export async function legacyExtract(
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
      ...(context.services
        ? {
            onRetryNotice: (message: string) =>
              context.onProgress?.({
                stage: "extract",
                stageIdx: 0,
                totalStages: 1,
                message,
                pct: 0,
              }),
          }
        : {}),
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
