// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { OperationContext, OperationProgress, OperationResult } from "./core/contracts.js";
import { resolveWorkspacePaths } from "./core/paths.js";
import { loadSettings } from "./settings.js";
import { createNativeModelClient } from "./native-model-client.js";
import { getNativeIdentity } from "./native-identity.js";
import { logErr, textContent } from "./util.js";
import type { callLlm } from "./llm.js";

export async function createNativeOperationContext(
  ctx: ExtensionContext,
  signal?: AbortSignal,
  delegate?: typeof callLlm,
): Promise<OperationContext> {
  const settings = await loadSettings({ cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted() });
  return {
    settings,
    models: createNativeModelClient(ctx, delegate),
    paths: resolveWorkspacePaths(ctx.cwd, settings.cacheDir),
    identity: await getNativeIdentity(),
    signal,
    logger: { error: logErr, warn: (message) => console.warn(`[pi-intelli-search] ${message}`) },
  };
}

export function nativeResult(result: OperationResult) {
  return { content: [textContent(result.text)], details: result.details };
}

export function nativeProgress(details: OperationProgress) {
  return {
    content: [
      textContent(`⚙️ Stage ${details.stageIdx + 1}/${details.totalStages}: ${details.message}`),
    ],
    details: { ...details },
  };
}
