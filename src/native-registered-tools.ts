// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { OperationInputs } from "./core/contracts.js";
import type { OnUpdate } from "./host-types.js";
import type { createNativeOperationRuntime } from "./native-operation-runtime.js";
import { intelliSearchTool } from "./tools/intelli-search.js";
import { intelliExtractTool } from "./tools/intelli-extract.js";
import { intelliCollateTool } from "./tools/intelli-collate.js";
import { intelliResearchTool } from "./tools/intelli-research.js";

/** Keep metadata/renderers, never register the legacy helper execute functions. */
export function createRegisteredNativeTools(
  runtime: ReturnType<typeof createNativeOperationRuntime>,
) {
  const execute =
    <Name extends keyof OperationInputs>(name: Name) =>
    (
      _toolCallId: string,
      params: OperationInputs[Name],
      signal: AbortSignal | undefined,
      onUpdate: OnUpdate | undefined,
      ctx: ExtensionContext,
    ) =>
      runtime.execute(name, params, signal, onUpdate, ctx);
  return [
    { ...intelliSearchTool, execute: execute("intelli_search") },
    { ...intelliExtractTool, execute: execute("intelli_extract") },
    { ...intelliCollateTool, execute: execute("intelli_collate") },
    { ...intelliResearchTool, execute: execute("intelli_research") },
  ] as const;
}
