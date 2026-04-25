// src/tools/intelli-extract.ts — intelli_extract tool
//
// Copyright 2025 Ashraf Miah, Curio Data Pro Ltd
// SPDX-License-Identifier: Apache-2.0
import { Type } from "@sinclair/typebox";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { EXTRACTION_SYSTEM_PROMPT } from "../prompts.js";
import { callLlm } from "../llm.js";
import { textContent, inferSourceType, inferCurrentness } from "../util.js";
import { loadSettings, resolveModelConfig } from "../settings.js";

export const intelliExtractTool = {
  name: "intelli_extract",
  label: "Intelli Extract",
  description:
    "Extract query-relevant content from a fetched web page using an LLM. " +
    "Reduces a full page (~50K chars) to relevant content (~3-5K chars). " +
    "Preserves code blocks, API signatures, and technical detail verbatim.",
  promptSnippet: "intelli_extract(page, query, focusPrompt?): LLM extraction of query-relevant content from a web page",
  parameters: Type.Object({
    url: Type.String({ description: "URL of the page (for metadata)" }),
    title: Type.String({ description: "Page title" }),
    content: Type.String({ description: "Full markdown content from web_fetch" }),
    query: Type.String({ description: "The original search query" }),
    focusPrompt: Type.Optional(Type.String({ description: "Optional focus guidance for extraction" })),
  }),

  async execute(
    _toolCallId: string,
    params: { url: string; title: string; content: string; query: string; focusPrompt?: string },
    signal: AbortSignal | undefined,
    _onUpdate: any,
    ctx: ExtensionContext,
  ) {
    const settings = await loadSettings(ctx.cwd);
    const extractConfig = resolveModelConfig(settings, "extract");

    // Truncate extremely large pages
    let content = params.content;
    const maxChars = settings.extractMaxChars;
    if (content.length > maxChars) {
      content = content.slice(0, maxChars) + `\n\n[TRUNCATED — page exceeded ${maxChars} characters]`;
    }

    // Build extraction user message
    let userMessage = `Web page content:\n---\n${content}\n---\n\n`;
    userMessage += `Extract information relevant to: ${params.query}\n`;
    if (params.focusPrompt) {
      userMessage += `\nFocus: ${params.focusPrompt}\n`;
    }

    const extraction = await callLlm(ctx, extractConfig, EXTRACTION_SYSTEM_PROMPT, userMessage, {
      maxTokens: settings.extractionMaxTokens,
      signal,
    });

    const firstLine = extraction.split("\n")[0] ?? "";
    const sourceType = inferSourceType(firstLine);
    const currentness = inferCurrentness(firstLine);

    return {
      content: [textContent(`### Extraction: ${params.title}\n\n${extraction}`)],
      details: { url: params.url, extraction, sourceType, currentness },
    };
  },
};
