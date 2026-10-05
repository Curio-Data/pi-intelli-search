// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseConfig } from "../src/config.js";
import type { FetchFunction } from "../../../src/core/annotations.js";

export const logger = { error() {}, warn() {} };
export function document() {
  return {
    providers: { openrouter: { apiKeyEnv: "FIXTURE_KEY" } },
    models: {
      search: { provider: "openrouter", model: "perplexity/sonar" },
      extract: { provider: "openrouter", model: "fixture/extract" },
      collate: { provider: "openrouter", model: "fixture/collate" },
    },
    tuning: {
      llmRetryAttempts: 2,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0,
      llmTimeoutMs: 1000,
      disableLlmsFullDiscovery: true,
    },
  };
}
export async function fixture() {
  const parent =
    process.env.TMPDIR ?? fileURLToPath(new URL("../../../.tmp/mcp-tests/", import.meta.url));
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(join(parent, "standalone-"));
  return {
    dir,
    config: await parseConfig(document(), dir),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
export function catalogue() {
  return {
    data: Object.values(document().models).map(({ model: id }) => ({
      id,
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      supported_parameters: ["tools", "reasoning"],
      reasoning: { supported_efforts: ["minimal", "low", "high"] },
    })),
  };
}
export const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers });
export const completion = (text = "A grounded answer.", extra = {}) => ({
  choices: [{ message: { content: text }, finish_reason: "stop" }],
  ...extra,
});
export function fakeTransport(
  handler: (body: Record<string, unknown>, init: RequestInit) => Promise<Response> | Response,
): FetchFunction {
  return async (url, init = {}) => {
    if (String(url) === "https://openrouter.ai/api/v1/models") return json(catalogue());
    if (String(url) !== "https://openrouter.ai/api/v1/chat/completions")
      throw new Error("Unexpected network access");
    return handler(JSON.parse(String(init.body)), init);
  };
}
