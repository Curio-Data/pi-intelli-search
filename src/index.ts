// src/index.ts — Extension entry point — registers all tools and custom models
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { webSearchTool } from "./tools/web-search.js";
import { webExtractTool } from "./tools/web-extract.js";
import { webCollateTool } from "./tools/web-collate.js";
import { webResearchTool } from "./tools/web-research.js";
import { invalidateSettingsCache } from "./settings.js";

import type { ProviderModelConfig } from "@mariozechner/pi-coding-agent";

/** Models this extension needs under the openrouter provider. */
const REQUIRED_MODELS: ProviderModelConfig[] = [
  {
    id: "perplexity/sonar",
    name: "Perplexity Sonar",
    reasoning: false,
    input: ["text"],
    cost: { input: 2.0, output: 8.0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 127000,
    maxTokens: 8192,
  },
  {
    id: "perplexity/sonar-pro",
    name: "Perplexity Sonar Pro",
    reasoning: false,
    input: ["text"],
    cost: { input: 3.0, output: 15.0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 8192,
  },
];

export default function piWebResearchExtension(pi: ExtensionAPI) {
  // Register tools immediately
  pi.registerTool(webSearchTool);
  pi.registerTool(webExtractTool);
  pi.registerTool(webCollateTool);
  pi.registerTool(webResearchTool);

  // Register custom models via pi's official provider API.
  // This is idempotent and doesn't require manual models.json manipulation.
  pi.registerProvider("openrouter", {
    models: REQUIRED_MODELS,
  });

  // Invalidate settings cache on session lifecycle events
  pi.on("session_start", () => {
    invalidateSettingsCache();
  });
}
