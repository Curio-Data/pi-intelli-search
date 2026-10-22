// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { Type, type TSchema } from "typebox";
import type { OperationName } from "./contracts.js";
import { AccountingSummarySchema, AttemptRecordSchema } from "./accounting-schema.js";

const strict = { additionalProperties: false } as const;
const integer = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const time = Type.Number({ minimum: 0 });
const literals = <T extends string>(values: T[]) =>
  Type.Union(values.map((value) => Type.Literal(value)));
const operation = literals([
  "intelli_search",
  "intelli_extract",
  "intelli_collate",
  "intelli_research",
  "intelli_fetch",
]);
const outcome = literals([
  "completed",
  "no-links",
  "fetch-failed",
  "extraction-failed",
  "error",
  "aborted",
]);
const json = Type.Cyclic(
  {
    Json: Type.Union([
      Type.Null(),
      Type.Boolean(),
      Type.Number(),
      Type.String(),
      Type.Array(Type.Ref("Json")),
      Type.Record(Type.String(), Type.Ref("Json")),
    ]),
  },
  "Json",
);
const details = Type.Record(Type.String(), json);
const identifier = Type.String({ minLength: 1, maxLength: 128 });
export const CountsSchema = Type.Object(
  {
    candidates: integer,
    fetched: integer,
    extracted: integer,
    used: integer,
    late: integer,
    failed: integer,
    cancelled: integer,
    effectivePageConcurrency: integer,
  },
  strict,
);
const diagnostic = Type.Object({ code: Type.String(), message: Type.String() }, strict);
const persistence = Type.Union([
  Type.Object({ status: Type.Literal("not-requested") }, strict),
  Type.Object({ status: Type.Literal("unavailable"), diagnostic }, strict),
  Type.Object(
    {
      status: Type.Literal("committed"),
      runId: Type.String(),
      reportPath: Type.String(),
      index: literals(["updated", "unavailable"]),
      accountingPath: Type.Optional(Type.String()),
      diagnostic: Type.Optional(diagnostic),
    },
    strict,
  ),
]);
const standaloneSource = Type.Object(
  {
    id: Type.String(),
    url: Type.String(),
    title: Type.String(),
    state: literals(["candidate", "used", "empty", "extract-failed", "cancelled"]),
    sourceType: Type.Optional(Type.String()),
    extraction: Type.Optional(Type.String()),
    diagnostic: Type.Optional(Type.String()),
  },
  strict,
);
const collateSource = Type.Object(
  {
    id: Type.String(),
    url: Type.String(),
    title: Type.String(),
    state: literals(["used", "empty", "extract-failed"]),
    sourceType: Type.Optional(Type.String()),
    extractionPath: Type.Optional(Type.String()),
    fullPagePath: Type.Optional(Type.String()),
    diagnostic: Type.Optional(Type.String()),
  },
  strict,
);
const fetchSource = Type.Object(
  {
    id: Type.String(),
    url: Type.String(),
    title: Type.String(),
    state: literals(["fetched", "empty", "fetch-failed", "cancelled"]),
    sourceType: Type.Optional(Type.String()),
    content: Type.Optional(Type.String({ maxLength: 500_000 })),
    truncated: Type.Optional(Type.Boolean()),
    diagnostic: Type.Optional(Type.String()),
  },
  strict,
);
const researchSource = Type.Object(
  {
    id: Type.String(),
    url: Type.String(),
    title: Type.String(),
    state: literals([
      "candidate",
      "fetched",
      "used",
      "late",
      "empty",
      "fetch-failed",
      "extract-failed",
      "cancelled",
    ]),
    sourceType: Type.Optional(Type.String()),
    truncated: Type.Optional(Type.Boolean()),
    extractionPath: Type.Optional(Type.String()),
    fullPagePath: Type.Optional(Type.String()),
    diagnostic: Type.Optional(Type.String()),
  },
  strict,
);
const full = (name: OperationName): TSchema =>
  Type.Object(
    {
      schemaVersion: Type.Literal(1),
      operation: Type.Literal(name),
      operationId: identifier,
      outcome,
      text: Type.String(),
      details,
      summary: Type.String(),
      sources: Type.Array(
        name === "intelli_research"
          ? researchSource
          : name === "intelli_collate"
            ? collateSource
            : name === "intelli_fetch"
              ? fetchSource
              : standaloneSource,
      ),
      cache: persistence,
      related: Type.Array(
        Type.Object(
          {
            query: Type.String(),
            reportPath: Type.String(),
            relevance: Type.String(),
            namespace: literals(["v1", "legacy"]),
          },
          strict,
        ),
      ),
      counts: CountsSchema,
      timing: Type.Object(
        {
          startedUtc: Type.String(),
          elapsedMs: time,
          allWorkSettledMs: time,
          summaryReadyMs: Type.Optional(time),
          cutoffMs: Type.Optional(time),
          abortToSettledMs: Type.Optional(time),
        },
        strict,
      ),
      accounting: AccountingSummarySchema,
      attempts: Type.Array(AttemptRecordSchema),
      deadline: Type.Object(
        {
          enabled: Type.Boolean(),
          reason: literals([
            "disabled",
            "all-terminal",
            "adaptive",
            "minimum",
            "ceiling",
            "not-applicable",
          ]),
          minimumMet: Type.Boolean(),
        },
        strict,
      ),
    },
    strict,
  );

/** Full manual-operation schemas retained as named compatibility exports. */
export const standaloneOutputSchemas = Object.freeze({
  intelli_search: full("intelli_search"),
  intelli_extract: full("intelli_extract"),
});
/** Registered supplied-input collation. */
export const collateOutputSchema = full("intelli_collate");
/** Host-neutral fetch only; no native or MCP registration. */
export const fetchOutputSchema = full("intelli_fetch");
export const researchOutputSchema = full("intelli_research");
export const operationOutputSchemas: Readonly<Record<OperationName, TSchema>> = Object.freeze({
  ...standaloneOutputSchemas,
  intelli_collate: collateOutputSchema,
  intelli_research: researchOutputSchema,
  intelli_fetch: fetchOutputSchema,
});
export const compactOutputSchema = Type.Object(
  {
    outcome,
    text: Type.String(),
    details,
    meta: Type.Object(
      {
        schemaVersion: Type.Literal(1),
        operation,
        operationId: identifier,
        persistence: literals(["not-requested", "unavailable", "committed"]),
        reportPath: Type.Optional(Type.String()),
        index: Type.Optional(literals(["updated", "unavailable"])),
        counts: CountsSchema,
        elapsedMs: time,
        attempts: integer,
        missingAttempts: integer,
        reportedCost: Type.Optional(time),
        estimatedCost: Type.Optional(time),
        costComplete: Type.Boolean(),
      },
      strict,
    ),
  },
  strict,
);
