// src/providers.ts — Register custom models for the web research extension
//
// Problem: perplexity/sonar is not in pi's built-in openrouter model list.
// Solution: On extension load, merge these models into models.json
// under the openrouter provider. models.json models merge with built-in
// models by id (add or replace), so this doesn't disturb existing models.
//
// registerProvider("openrouter", { models }) would REPLACE all OpenRouter
// models — that's destructive. The models.json merge approach is the
// correct way to *add* models to an existing built-in provider.

import { readFile, writeFile, mkdir, rename, rm, realpath, stat, lstat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, dirname } from "node:path";
import { withLock } from "./core/cache.js";
import { getAgentDir } from "./agent-dir.js";

/**
 * Resolve models.json lazily inside each call: PI_CODING_AGENT_DIR may be
 * set after module load (isolated test and E2E environments), so a
 * module-level constant would go stale.
 */
function modelsJsonPath(): string {
  return join(getAgentDir(), "models.json");
}

/** Models this extension needs, to be merged into the openrouter provider. */
export const REQUIRED_MODELS = [
  {
    id: "perplexity/sonar",
    name: "Perplexity Sonar",
    reasoning: false,
    input: ["text"],
    // $1/$1 per 1M tokens per https://openrouter.ai/perplexity/sonar (2026).
    // (Sonar also bills a per-request search fee that this cost shape can't
    // express; the token rates here drive Pi's /model cost estimates.)
    cost: { input: 1.0, output: 1.0, cacheRead: 0, cacheWrite: 0 },
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
  {
    // OpenRouter-exclusive agentic model (powers Perplexity Pro Search),
    // offered as an alternative searchModel. Note the per-request search
    // fee: $18 per 1,000 requests on top of the token rates below (this
    // cost shape cannot express per-request fees; see openrouter.ai model
    // card).
    id: "perplexity/sonar-pro-search",
    name: "Perplexity Sonar Pro Search",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 3.0, output: 15.0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 8192,
  },
];

interface ModelsJson {
  providers?: Record<
    string,
    {
      models?: Array<Record<string, unknown>>;
      [key: string]: unknown;
    }
  >;
  [key: string]: unknown;
}

/**
 * Ensure our custom models exist in models.json under the openrouter provider.
 * This is idempotent — safe to call on every extension load.
 * Returns the list of models that were added.
 */
export async function ensureCustomModels(): Promise<string[]> {
  let path = modelsJsonPath();
  try {
    // Preserve operator-managed symlinks by replacing the physical target.
    path = await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const entry = await lstat(path).catch((cause: NodeJS.ErrnoException) => {
      if (cause.code !== "ENOENT") throw cause;
      return undefined;
    });
    if (entry?.isSymbolicLink())
      throw new Error("models.json is a dangling symlink; existing configuration was not changed");
  }
  await mkdir(dirname(path), { recursive: true });
  return withLock(`${path}.intelli-lock`, async () => {
    let config: ModelsJson = {};
    let mode = 0o600;
    let raw: string | undefined;
    try {
      raw = await readFile(path, "utf8");
      mode = (await stat(path)).mode & 0o777;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("Cannot read models.json; existing configuration was not changed");
    }
    if (raw !== undefined) {
      try {
        const parsed: unknown = JSON.parse(raw);
        const isObject = (value: unknown): value is Record<string, unknown> =>
          value !== null && typeof value === "object" && !Array.isArray(value);
        if (!isObject(parsed)) throw new Error();
        if (parsed.providers !== undefined) {
          if (!isObject(parsed.providers)) throw new Error();
          for (const provider of Object.values(parsed.providers)) {
            if (!isObject(provider)) throw new Error();
            if (
              provider.models !== undefined &&
              (!Array.isArray(provider.models) || !provider.models.every(isObject))
            )
              throw new Error();
          }
        }
        config = parsed as ModelsJson;
      } catch {
        // Never include parser messages, which can contain credential-bearing JSON.
        throw new Error(
          "Invalid models.json; repair its JSON/object structure before registration. Existing configuration was not changed",
        );
      }
    }
    config.providers ??= {};
    config.providers.openrouter ??= {};
    config.providers.openrouter.models ??= [];
    const models = config.providers.openrouter.models;
    const added: string[] = [];
    for (const modelDef of REQUIRED_MODELS) {
      if (!models.some((model) => model.id === modelDef.id)) {
        models.push(modelDef);
        added.push(modelDef.id);
      }
    }
    if (added.length) {
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(config, null, 2) + "\n", { mode, flag: "wx" });
        await rename(temporary, path);
      } finally {
        await rm(temporary, { force: true }).catch(() => {});
      }
    }
    return added;
  });
}
