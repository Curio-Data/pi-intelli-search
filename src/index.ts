// src/index.ts — Extension entry point — registers all tools and custom models
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { webSearchTool } from "./tools/web-search.js";
import { webExtractTool } from "./tools/web-extract.js";
import { webCollateTool } from "./tools/web-collate.js";
import { webResearchTool } from "./tools/web-research.js";
import { ensureCustomModels } from "./providers.js";

export default function piWebResearchExtension(pi: ExtensionAPI) {
  // Register tools immediately
  pi.registerTool(webSearchTool);
  pi.registerTool(webExtractTool);
  pi.registerTool(webCollateTool);
  pi.registerTool(webResearchTool);

  // On first session_start, ensure custom models exist in models.json.
  // This event fires after the runner initializes, so we can safely
  // trigger a model refresh if we added new models.
  let modelsChecked = false;
  pi.on("session_start", async (_event, ctx) => {
    if (modelsChecked) return;
    modelsChecked = true;

    try {
      const added = await ensureCustomModels();
      if (added.length > 0) {
        // We wrote new models to models.json. Refresh the registry so they're
        // available immediately without restarting pi.
        (ctx.modelRegistry as any).refresh();
        ctx.ui.notify(
          `[pi-web-research] Added models: ${added.join(", ")}. Use /model to select them.`,
          "info",
        );
      }
    } catch (err: any) {
      ctx.ui.notify(
        `[pi-web-research] Warning: could not update models.json: ${err?.message ?? err}`,
        "warning",
      );
    }
  });
}
