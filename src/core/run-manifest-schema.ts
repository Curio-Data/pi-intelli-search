// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Pipeline-owned report-time provenance. Final accounting is a separate record.
import { Type, type Static } from "typebox";

const strict = { additionalProperties: false } as const;
const sourceId = Type.String({ pattern: "^S[1-9][0-9]*$" });
const model = Type.Object({ provider: Type.String(), model: Type.String() }, strict);

export const RunSourceSchema = Type.Object(
  {
    id: sourceId,
    url: Type.String(),
    title: Type.String(),
    state: Type.Union([
      Type.Literal("used"),
      Type.Literal("late"),
      Type.Literal("empty"),
      Type.Literal("fetch-failed"),
      Type.Literal("extract-failed"),
      Type.Literal("cancelled"),
    ]),
    input: Type.Union([Type.Literal("network"), Type.Literal("supplied")]),
    sourceType: Type.Optional(Type.String()),
    truncated: Type.Optional(Type.Boolean()),
    extractionPath: Type.Optional(Type.String()),
    fullPagePath: Type.Optional(Type.String()),
    diagnostic: Type.Optional(Type.String()),
  },
  strict,
);

export const RunManifestSchema = Type.Object(
  {
    schema: Type.Literal("intelli-v1/run"),
    schemaVersion: Type.Literal(1),
    operation: Type.Union([Type.Literal("intelli_research"), Type.Literal("intelli_collate")]),
    sources: Type.Array(RunSourceSchema, { minItems: 1 }),
    evidenceSourceIds: Type.Array(sourceId, { minItems: 1, uniqueItems: true }),
    documents: Type.Array(Type.Object({ url: Type.String(), relativePath: Type.String() }, strict)),
    provenance: Type.Object(
      {
        domains: Type.Array(Type.String()),
        focusPrompt: Type.Optional(Type.String()),
        models: Type.Object(
          {
            search: Type.Optional(model),
            extract: Type.Optional(model),
            collate: model,
            suggest: Type.Optional(model),
          },
          strict,
        ),
      },
      strict,
    ),
  },
  strict,
);

export type RunSource = Static<typeof RunSourceSchema>;
export type RunManifest = Static<typeof RunManifestSchema>;
