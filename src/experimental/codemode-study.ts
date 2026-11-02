// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Branch-only entrypoint. Not loaded by src/index.ts or either package adapter.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";
import type { JsonValue } from "@earendil-works/pi-ai";
import type { FullData, OperationInputs } from "../core/contracts.js";
import { operationOutputSchemas } from "../core/index.js";
import { captureNativeInjection, type NativeTestInjection } from "../native-injection.js";
import { createNativeOperationRuntime } from "../native-operation-runtime.js";
import { createRegisteredNativeTools } from "../native-registered-tools.js";
import { invalidateSettingsCache } from "../settings.js";

export type StudyArm = "off" | "on" | "only";

/** The reader stays available for cache follow-ups in every workflow. */
export function studyActiveTools(arm: StudyArm): readonly string[] {
  if (!["off", "on", "only"].includes(arm)) throw new TypeError("Unknown study arm");
  return ["read", "intelli_search", "intelli_extract", "intelli_collate", "intelli_research",
    ...(arm === "off" ? ["intelli_fetch"] : ["codemode"])];
}

// Match the host's JSON boundary, omitting optional undefined fields.
function jsonData(data: FullData | undefined): JsonValue | undefined {
  return data === undefined ? undefined : JSON.parse(JSON.stringify(data)) as JsonValue;
}

/** One fixed catalogue per arm, independent of task and replay/live population. */
export function createStudyExtension(arm: StudyArm, injection?: NativeTestInjection) {
  if (!["off", "on", "only"].includes(arm)) throw new TypeError("Unknown study arm");
  const captured = captureNativeInjection(injection);
  return (pi: ExtensionAPI): void => {
    if (typeof pi.registerMcpServer !== "function")
      throw new Error("The experimental study requires the pinned current Pi host");
    const runtime = createNativeOperationRuntime({ ...captured, supportsErrorResults: true });
    for (const tool of createRegisteredNativeTools(runtime)) {
      const name = tool.name as keyof OperationInputs;
      pi.registerTool<TSchema, Record<string, unknown> | undefined>({
        ...tool,
        outputSchema: operationOutputSchemas[name],
        execute: async (_id, params: OperationInputs[keyof OperationInputs], signal, update, ctx) => {
          // The union of registrations has correlated names/inputs; dispatch
          // through the runtime rather than calling a union of execute methods.
          const result = await runtime.execute(name, params, signal, update, ctx);
          return { ...result, structuredContent: jsonData(result.details.intelli) };
        },
      });
    }
    pi.registerTool({
      name: "intelli_fetch",
      label: "Intelli Fetch",
      description: "Fetch one web page with the bounded research page client. Returns page content for extraction, source identity and fetch outcome. It makes no model call.",
      parameters: Type.Object({
        url: Type.String({ description: "Page URL" }),
        maxChars: Type.Optional(Type.Integer({ minimum: 1, description: "Maximum returned page characters" })),
      }, { additionalProperties: false }),
      outputSchema: operationOutputSchemas.intelli_fetch,
      exposure: arm === "off" ? "direct" : "codemode",
      executionMode: "parallel",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      execute: async (_id, params, signal, update, ctx) => {
        const result = await runtime.execute("intelli_fetch", params, signal, update, ctx);
        const data = result.details.intelli;
        return {
          ...result,
          // The same result is returned in both arms. Direct callers need the
          // page body in content; scripts receive the identical full data.
          ...(data ? { content: [{ type: "text" as const, text: JSON.stringify(data) }] } : {}),
          structuredContent: jsonData(data),
        };
      },
    });
    pi.on("session_start", async (_event, ctx) => {
      invalidateSettingsCache();
      await runtime.start(ctx);
    });
    pi.on("session_shutdown", async (_event, ctx) => runtime.shutdown(ctx));
  };
}
