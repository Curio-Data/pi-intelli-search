// src/index.ts — Extension entry point — registers all tools, custom models,
// provider-response monitoring, and working-indicator tracking.
//
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
// SPDX-License-Identifier: Apache-2.0
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { intelliSearchTool } from "./tools/intelli-search.js";
import { intelliExtractTool } from "./tools/intelli-extract.js";
import { intelliCollateTool } from "./tools/intelli-collate.js";
import { intelliResearchTool } from "./tools/intelli-research.js";
import { ensureCustomModels } from "./providers.js";
import { invalidateSettingsCache } from "./settings.js";

export default function piWebResearchExtension(pi: ExtensionAPI) {
  // ═══════════════════════════════════════════════
  // Tool registration
  // ═══════════════════════════════════════════════
  pi.registerTool(intelliSearchTool);
  pi.registerTool(intelliExtractTool);
  pi.registerTool(intelliCollateTool);
  pi.registerTool(intelliResearchTool);

  // ═══════════════════════════════════════════════
  // Provider-response monitoring
  // ═══════════════════════════════════════════════
  // Watch for rate-limiting (429) and server errors (5xx) from the providers
  // our tools use (OpenRouter for Sonar search, MiniMax for extract/collate).
  // This catches issues that slip through the per-call onResponse hook in
  // llm.ts — e.g. when the agent itself calls these providers outside our
  // tools, or when a 429 arrives on a streaming response that our onResponse
  // hook didn't catch.
  //
  // sessionActive guards against stale ctx after session replacement (/new,
  // /resume, /fork). In-flight requests from the old session can still fire
  // after_provider_response through the invalidated runtime, and touching
  // ctx.ui on a stale runtime throws.
  let sessionActive = true;
  let lastRateLimitNotified = 0;
  pi.on("after_provider_response", (event, ctx) => {
    if (!sessionActive) return;
    try {
      if (event.status === 429) {
        // Debounce: only notify once per 30 seconds
        const now = Date.now();
        if (now - lastRateLimitNotified > 30_000) {
          lastRateLimitNotified = now;
          const retryAfter = event.headers["retry-after"];
          ctx.ui.setStatus(
            "pi-intelli-search:ratelimit",
            `⏳ Rate limited — retry ${retryAfter ? `after ${retryAfter}s` : "shortly"}`,
          );
        }
      } else if (event.status < 400) {
        // Clear rate-limit status on success
        ctx.ui.setStatus("pi-intelli-search:ratelimit", undefined);
      }
    } catch {
      // ctx is stale — session was replaced while request was in-flight
      sessionActive = false;
    }
  });

  // ═══════════════════════════════════════════════
  // Working indicator lifecycle tracking
  // ═══════════════════════════════════════════════
  // Track when our tools are executing. The intelli_research tool uses
  // ctx.ui.setWorkingIndicator() directly for its custom spinner.
  // These handlers are available for future use (e.g. cross-tool
  // indicator coordination).
  pi.on("tool_execution_start", (event) => {
    if (
      event.toolName === "intelli_research" ||
      event.toolName === "intelli_search" ||
      event.toolName === "intelli_extract" ||
      event.toolName === "intelli_collate"
    ) {
      // Extension tools are running — indicator set by intelli_research.execute()
    }
  });
  pi.on("tool_execution_end", (event) => {
    if (
      event.toolName === "intelli_research" ||
      event.toolName === "intelli_search" ||
      event.toolName === "intelli_extract" ||
      event.toolName === "intelli_collate"
    ) {
      // Extension tools finished — indicator restored by intelli_research.execute()
    }
  });

  // ═══════════════════════════════════════════════
  // Session lifecycle
  // ═══════════════════════════════════════════════
  // On first session_start, merge Perplexity Sonar models into models.json.
  // registerProvider("openrouter", { models }) would REPLACE all OpenRouter
  // models — destructive. models.json merges by id instead.
  // This event fires after the runner initializes, so we can safely
  // trigger a model registry refresh if we added new models.
  let modelsChecked = false;
  pi.on("session_start", async (_event, ctx) => {
    invalidateSettingsCache();

    if (modelsChecked) return;
    modelsChecked = true;

    try {
      const added = await ensureCustomModels();
      if (added.length > 0) {
        // We wrote new models to models.json. Refresh the registry so they're
        // available immediately without restarting pi.
        // modelRegistry.refresh() is not on the public ExtensionContext type,
        // but is available at runtime on the concrete ModelRegistry instance.
        const registry = ctx.modelRegistry as { refresh?: () => void };
        registry.refresh?.();
        ctx.ui.notify(
          `[pi-intelli-search] Added models: ${added.join(", ")}. Use /model to select them.`,
          "info",
        );
      }
    } catch (err: any) {
      ctx.ui.notify(
        `[pi-intelli-search] Warning: could not update models.json: ${err?.message ?? err}`,
        "warning",
      );
    }
  });

  // ═══════════════════════════════════════════════
  // Session shutdown
  // ═══════════════════════════════════════════════
  // Prevent after_provider_response handlers from touching ctx.ui after
  // the session runtime is torn down (e.g. /new leaves in-flight requests).
  pi.on("session_shutdown", () => {
    sessionActive = false;
    modelsChecked = false;
  });
}
