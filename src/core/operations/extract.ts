// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { EXTRACTION_SYSTEM_PROMPT } from "../prompts.js";
import type { ExtractParams } from "../contracts.js";
import { inferSourceType, inferCurrentness, throwIfAborted, budgetExhausted } from "../util.js";
import { buildExtractionMessage } from "../messages.js";
import type { OperationContext, OperationResult } from "../contracts.js";

export async function extract(
  params: ExtractParams,
  context: OperationContext,
): Promise<OperationResult> {
  const { settings, models, signal } = context;
  throwIfAborted(signal);
  const extractConfig = settings.extractModel;

  const userMessage = buildExtractionMessage(
    params.content,
    params.query,
    params.focusPrompt,
    settings.extractMaxChars,
  );

  const { text: extraction, usage } = await models.complete({
    model: extractConfig,
    systemPrompt: EXTRACTION_SYSTEM_PROMPT,
    userMessage,
    maxTokens: settings.extractionMaxTokens,
    signal,
  });

  throwIfAborted(signal);
  // A 200 response can still carry zero visible text: on reasoning models
  // the completion cap covers hidden reasoning tokens, and an exhausted call
  // spends the whole budget before any visible output. Fail with an
  // actionable message instead of returning an empty extraction as if it
  // were a result.
  if (!extraction.trim()) {
    const exhausted = budgetExhausted(usage, settings.extractionMaxTokens);
    const usageNote = usage?.output != null
      ? ` (${usage.output}/${settings.extractionMaxTokens} output tokens` +
        (usage.reasoning ? `, ${usage.reasoning} hidden reasoning` : "") + ")"
      : "";
    throw new Error(
      exhausted
        ? `Extraction returned no visible text${usageNote}; the output budget was exhausted. Review extractionMaxTokens or choose a model with a smaller reasoning requirement.`
        : `Extraction returned no visible text${usageNote}. The output budget was not reported exhausted; inspect the model response before retrying.`,
    );
  }
  const firstLine = extraction.split("\n")[0] ?? "";
  const sourceType = inferSourceType(firstLine);
  const currentness = inferCurrentness(firstLine);

  // Nonempty output cut off by the cap: kept, but flagged so the caller knows
  // the extraction may end mid-sentence. Missing usage never flags.
  const truncated = budgetExhausted(usage, settings.extractionMaxTokens);
  const truncationNote = truncated
    ? `\n\n> ⚠ Extraction output reached extractionMaxTokens (${settings.extractionMaxTokens}); the text may be cut off mid-sentence.`
    : "";

  return {
    text: `### Extraction: ${params.title}\n\n${extraction}${truncationNote}`,
    outcome: "completed",
    details: { url: params.url, extraction, sourceType, currentness, ...(truncated ? { truncated: true } : {}) },
  };
}
