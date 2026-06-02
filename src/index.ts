// src/index.ts — Extension entry point — registers all tools, custom models,
// provider-response monitoring, and working-indicator tracking.
//
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
// SPDX-License-Identifier: Apache-2.0
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { intelliSearchTool } from "./tools/intelli-search.js";
import { intelliExtractTool } from "./tools/intelli-extract.js";
import { intelliCollateTool } from "./tools/intelli-collate.js";
import { intelliResearchTool } from "./tools/intelli-research.js";
import { ensureCustomModels } from "./providers.js";
import { invalidateSettingsCache, hasFlatKeys, migrateDefaults, loadSettings, setMigrationContext } from "./settings.js";
import { getAgentDir } from "./util.js";

const CURRENT_VERSION = "0.10.0";

/**
 * Check whether the openrouter provider has auth configured.
 * Checks auth.json and the OPENROUTER_API_KEY environment variable.
 * Best-effort: Pi supports other auth mechanisms (OAuth, API key helpers)
 * that this check won't detect, but those are edge cases.
 * Returns true if auth is likely missing.
 */
export async function isOpenRouterAuthMissing(): Promise<boolean> {
  // Check environment variable first (fast path)
  if (process.env.OPENROUTER_API_KEY) return false;

  // Check auth.json
  try {
    const raw = await readFile(join(getAgentDir(), "auth.json"), "utf-8");
    const auth = JSON.parse(raw);
    if (auth.openrouter?.key && typeof auth.openrouter.key === "string") return false;
  } catch {
    // File doesn't exist or is invalid — auth is missing
  }

  return true;
}

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
  // our tools use (OpenRouter for search, extract, and collate).
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
  //
  // Also handles version tracking and deprecation notices. On upgrade,
  // checks whether the user is still using flat intelli* settings keys
  // and shows a non-blocking notification suggesting migration to the
  // nested pi-intelli-search namespace.
  let modelsChecked = false;
  pi.on("session_start", async (_event, ctx) => {
    sessionActive = true;
    invalidateSettingsCache();

    if (!modelsChecked) {
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
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(
          `[pi-intelli-search] Warning: could not update models.json: ${message}`,
          "warning",
        );
      }
    }

    // Auth pre-flight: warn if OpenRouter has no configured key.
    // With default settings, all three pipeline stages need OpenRouter.
    // This is a best-effort early warning. The tool itself will throw
    // a clearer error at execution time if the key is truly missing.
    try {
      const authMissing = await isOpenRouterAuthMissing();
      if (authMissing) {
        ctx.ui.notify(
          `[pi-intelli-search] No OpenRouter API key found. ` +
          `This extension requires one. Run /login or add 'openrouter' to auth.json.`,
          "warning",
        );
      }
    } catch (err: unknown) {
      // Auth check is best-effort; never block session startup
      console.error(`[pi-intelli-search] Auth check failed:`, err);
    }

    // Version tracking, default migration, and settings deprecation notice
    try {
      // Version file lives in the agent directory (global to the extension
      // installation), not in the project-relative .search/ cache. This
      // ensures version tracking works regardless of which directory the
      // user runs pi from.
      const agentDir = getAgentDir();
      const versionPath = join(agentDir, ".pi-intelli-search-version.json");
      let previousVersion: string | undefined;

      try {
        const raw = await readFile(versionPath, "utf-8");
        const meta = JSON.parse(raw);
        previousVersion = meta.version;
      } catch {
        // No previous version file — fresh install or cleared state
      }

      if (previousVersion && previousVersion !== CURRENT_VERSION) {
        // Check for migration changes BEFORE setting the migration
        // context. loadSettings() applies pendingMigration in-memory,
        // so we must detect changes on the raw (unmigrated) settings.
        try {
          const userSettings = await loadSettings(process.cwd());
          const { changes } = migrateDefaults(previousVersion, CURRENT_VERSION, userSettings);
          if (changes.length > 0) {
            ctx.ui.notify(
              `[pi-intelli-search] Default models updated:\n` +
              changes.map((c) => `  ${c}`).join("\n") + "\n" +
              `Update your settings.json to make these permanent.`,
              "warning",
            );
          }
        } catch (err: unknown) {
          // Migration is best-effort; never block session startup
          console.error(`[pi-intelli-search] Default migration error:`, err);
        }

        // Set migration context so subsequent loadSettings() calls
        // (from tools) get the migrated defaults in-memory.
        // Invalidate the cache so loadSettings() rebuilds with
        // pendingMigration applied (the earlier call for notification
        // populated the cache without migration).
        setMigrationContext(previousVersion, CURRENT_VERSION);
        invalidateSettingsCache();
      }

      // Write current version AFTER migration succeeds, so a failed
      // migration doesn't permanently strand the user on stale defaults.
      await mkdir(agentDir, { recursive: true });
      await writeFile(
        versionPath,
        JSON.stringify({ version: CURRENT_VERSION, settingsFormat: "nested" }, null, 2) + "\n",
      );

      // Flat key deprecation notice — check on every session_start,
      // not just on upgrade, to catch fresh-install users who
      // copy-paste deprecated flat keys from old docs/blog posts.
      try {
        const flatKeysExist = await hasFlatKeys(process.cwd());
        if (flatKeysExist) {
          ctx.ui.notify(
            `[pi-intelli-search] Flat 'intelli*' settings keys are deprecated. ` +
            `Nest them under 'pi-intelli-search' in settings.json. ` +
            `See CHANGELOG.md for details.`,
            "warning",
          );
        }
      } catch {
        // Flat key check is best-effort; never block session startup
      }
    } catch (err: unknown) {
      // Version tracking is best-effort; never break session startup
      console.error(`[pi-intelli-search] Version tracking error:`, err);
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
