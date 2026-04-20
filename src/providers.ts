// src/providers.ts — Register custom models for the web research extension
//
// Problem: perplexity/sonar is not in pi's built-in openrouter model list.
// Solution: On extension load, ensure these models exist in models.json
// under the openrouter provider. This merges with existing models (upsert by provider+id).
//
// This runs inside the extension factory function, which pi queues and applies
// once the runner initializes.

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const AGENT_DIR = join(homedir(), ".pi", "agent");
const MODELS_JSON_PATH = join(AGENT_DIR, "models.json");

/** Models this extension needs, to be merged into the openrouter provider. */
const REQUIRED_MODELS = {
  "perplexity/sonar": {
    id: "perplexity/sonar",
    name: "Perplexity Sonar",
    reasoning: false,
    input: ["text"],
    cost: { input: 2.0, output: 8.0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 127000,
    maxTokens: 8192,
  },
  "perplexity/sonar-pro": {
    id: "perplexity/sonar-pro",
    name: "Perplexity Sonar Pro",
    reasoning: false,
    input: ["text"],
    cost: { input: 3.0, output: 15.0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 8192,
  },
};

interface ModelsJson {
  providers?: Record<string, {
    models?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

/**
 * Ensure our custom models exist in models.json under the openrouter provider.
 * This is idempotent — safe to call on every extension load.
 * Returns the list of models that were added.
 */
export async function ensureCustomModels(): Promise<string[]> {
  let config: ModelsJson = {};

  // Read existing models.json if it exists
  if (existsSync(MODELS_JSON_PATH)) {
    try {
      const raw = await readFile(MODELS_JSON_PATH, "utf-8");
      config = JSON.parse(raw);
    } catch {
      // Invalid JSON — start fresh (don't overwrite yet)
      config = {};
    }
  }

  // Ensure providers.openrouter exists
  if (!config.providers) config.providers = {};
  if (!config.providers.openrouter) config.providers.openrouter = {};
  if (!config.providers.openrouter.models) config.providers.openrouter.models = [];

  const models = config.providers.openrouter.models as Array<Record<string, unknown>>;
  const added: string[] = [];

  for (const [modelId, modelDef] of Object.entries(REQUIRED_MODELS)) {
    const exists = models.some((m) => m.id === modelId);
    if (!exists) {
      models.push(modelDef);
      added.push(modelId);
    }
  }

  // Only write if we added something
  if (added.length > 0) {
    await writeFile(MODELS_JSON_PATH, JSON.stringify(config, null, 2) + "\n");
  }

  return added;
}
