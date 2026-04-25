// src/llm.ts — LLM calling utilities using pi native auth
import { completeSimple } from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Message } from "@mariozechner/pi-ai";
import type { ModelConfig } from "./types.js";

/**
 * Call an LLM via pi's model registry + pi-ai completeSimple().
 * Uses pi's native auth system (auth.json, env vars, OAuth).
 * Uses completeSimple() which handles reasoning models correctly
 * (required for MiniMax M2.7 and other reasoning models).
 *
 * Uses the onResponse callback to detect rate-limiting (HTTP 429) and
 * server errors (5xx) and surface them as actionable errors with retry
 * guidance.
 */
export async function callLlm(
  ctx: ExtensionContext,
  config: ModelConfig,
  systemPrompt: string,
  userMessage: string,
  options?: { maxTokens?: number; signal?: AbortSignal },
): Promise<string> {
  // 1. Resolve model from registry
  const model = ctx.modelRegistry.find(config.provider, config.model);
  if (!model) {
    throw new Error(
      `Model not found: ${config.provider}/${config.model}. ` +
        `Available providers may need API keys in auth.json.`,
    );
  }

  // 2. Get API key + headers
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) {
    throw new Error(
      `No API key for ${config.provider}/${config.model}. Run /login or add key to auth.json.`,
    );
  }

  // 3. Build messages
  const messages: Message[] = [
    {
      role: "user",
      content: [{ type: "text", text: userMessage }],
      timestamp: Date.now(),
    },
  ];

  // 4. Call via pi-ai — use completeSimple which sends reasoning params
  //    for reasoning models (required by MiniMax M2.7 etc.)
  //    The onResponse hook checks HTTP status for rate-limit / server errors
  //    before the stream body is consumed.
  const response = await completeSimple(
    model,
    { systemPrompt, messages },
    {
      apiKey: auth.apiKey,
      headers: auth.headers,
      signal: options?.signal,
      maxTokens: options?.maxTokens,
      reasoning: "low",
      onResponse: (res) => {
        if (res.status === 429) {
          const retryAfter = res.headers["retry-after"];
          throw new Error(
            `Rate limited by ${config.provider}/${config.model}` +
              (retryAfter ? ` (retry after ${retryAfter}s)` : ". Please retry in a moment."),
          );
        }
        if (res.status >= 500) {
          throw new Error(
            `Server error from ${config.provider}/${config.model} (HTTP ${res.status}). ` +
              `The provider may be experiencing issues. Please retry.`,
          );
        }
      },
    },
  );

  // 5. Check for errors
  if (response.stopReason === "error") {
    throw new Error(
      `LLM call failed (${config.provider}/${config.model}): ${response.errorMessage ?? "unknown error"}`,
    );
  }

  // 6. Extract text (skip thinking blocks)
  return response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}
