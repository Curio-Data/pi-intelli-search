// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Shared C16 result/persistence shapes. Semantic ledger checks live separately.
import { Type } from "typebox";

const strict = { additionalProperties: false } as const;
const count = Type.Number({ minimum: 0 });
const integer = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const identifier = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: "^[^\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]+$",
});
const tokenField = Type.Union([
  Type.Literal("inputTotal"),
  Type.Literal("inputUncached"),
  Type.Literal("outputTotal"),
  Type.Literal("cacheRead"),
  Type.Literal("cacheWrite"),
  Type.Literal("cacheWrite1h"),
  Type.Literal("reasoning"),
  Type.Literal("totalTokens"),
]);

export const TokenObservationSchema = Type.Object(
  {
    inputTotal: Type.Optional(count),
    inputUncached: Type.Optional(count),
    outputTotal: Type.Optional(count),
    cacheRead: Type.Optional(count),
    cacheWrite: Type.Optional(count),
    cacheWrite1h: Type.Optional(count),
    reasoning: Type.Optional(count),
    totalTokens: Type.Optional(count),
  },
  strict,
);

export const CostObservationSchema = Type.Object(
  {
    total: Type.Optional(count),
    input: Type.Optional(count),
    output: Type.Optional(count),
    cacheRead: Type.Optional(count),
    cacheWrite: Type.Optional(count),
  },
  strict,
);

export const UsageObservationSchema = Type.Object(
  {
    tokens: TokenObservationSchema,
    cost: Type.Optional(CostObservationSchema),
    source: Type.Union([Type.Literal("provider-response"), Type.Literal("sdk-normalized")]),
    costBasis: Type.Union([
      Type.Literal("reported"),
      Type.Literal("catalogue"),
      Type.Literal("unknown"),
    ]),
    providerRequestId: Type.Optional(Type.String()),
  },
  strict,
);

export const AttemptRecordSchema = Type.Object(
  {
    operationId: identifier,
    callId: identifier,
    attempt: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    model: Type.Object({ provider: Type.String(), model: Type.String() }, strict),
    role: Type.Union([
      Type.Literal("search"),
      Type.Literal("extract"),
      Type.Literal("collate"),
      Type.Literal("suggest"),
    ]),
    pageId: Type.Optional(identifier),
    state: Type.Union([
      Type.Literal("succeeded"),
      Type.Literal("failed"),
      Type.Literal("aborted"),
      Type.Literal("timed-out"),
    ]),
    startedAtMs: Type.Number(),
    settledAtMs: Type.Number(),
    queueMs: count,
    observation: Type.Optional(UsageObservationSchema),
  },
  strict,
);

export const AccountingSummarySchema = Type.Object(
  {
    attempts: integer,
    observedAttempts: integer,
    missingAttempts: integer,
    tokens: TokenObservationSchema,
    reportedCost: CostObservationSchema,
    estimatedCost: CostObservationSchema,
    missingTokenFields: Type.Immutable(Type.Array(tokenField, { uniqueItems: true })),
    costComplete: Type.Boolean(),
    parentDelivery: Type.Union([
      Type.Literal("available"),
      Type.Literal("unavailable-after-parent-cancel"),
      Type.Literal("unknown"),
    ]),
  },
  strict,
);

export const AccountingBodySchema = Type.Object(
  {
    attempts: Type.Array(AttemptRecordSchema),
    summary: AccountingSummarySchema,
  },
  strict,
);
