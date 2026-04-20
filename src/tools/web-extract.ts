// src/tools/web-extract.ts — web_extract tool
import { Type } from "@sinclair/typebox";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { EXTRACTION_SYSTEM_PROMPT } from "../prompts.js";
import { callLlm } from "../llm.js";
import { textContent } from "../util.js";

export const webExtractTool = {
  name: "web_extract",
  label: "Web Extract",
  description:
    "Extract query-relevant content from a fetched web page using an LLM. " +
    "Reduces a full page (~50K chars) to relevant content (~3-5K chars). " +
    "Preserves code blocks, API signatures, and technical detail verbatim.",
  promptSnippet: "web_extract(page, query, focusPrompt?): LLM extraction of query-relevant content from a web page",
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
    const { loadSettings, resolveModelConfig } = await import("../settings.js");
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
      maxTokens: 3000,
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

function inferSourceType(line: string): string {
  const lower = line.toLowerCase();
  if (lower.includes("official doc")) return "official docs";
  if (lower.includes("api reference")) return "API reference";
  if (lower.includes("tutorial")) return "tutorial";
  if (lower.includes("blog")) return "blog post";
  if (lower.includes("forum") || lower.includes("stackoverflow")) return "forum";
  return "unknown";
}

function inferCurrentness(line: string): string {
  const lower = line.toLowerCase();
  if (lower.includes("current") || lower.includes("up to date")) return "current";
  if (lower.includes("outdated") || lower.includes("old")) return "possibly outdated";
  return "undated";
}
