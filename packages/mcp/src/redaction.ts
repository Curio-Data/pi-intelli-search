// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type { FullData } from "../../../src/core/contracts.js";

/** Redact authored/provider strings without corrupting generated schema literals. */
export function redactFullData(data: FullData, redact: (value: string) => string): FullData {
  const safe: FullData = JSON.parse(
    JSON.stringify(data, (_key, value: unknown) =>
      typeof value === "string" ? redact(value) : value,
    ),
  );
  return {
    ...safe,
    operation: data.operation,
    operationId: data.operationId,
    outcome: data.outcome,
    cache:
      data.cache.status === "committed"
        ? {
            ...(safe.cache as Extract<FullData["cache"], { status: "committed" }>),
            status: "committed",
            index: data.cache.index,
          }
        : data.cache.status === "unavailable"
          ? {
              ...(safe.cache as Extract<FullData["cache"], { status: "unavailable" }>),
              status: "unavailable",
            }
          : { status: "not-requested" },
    deadline: { ...data.deadline },
    sources: safe.sources.map((source, i) => ({
      ...source,
      id: data.sources[i].id,
      state: data.sources[i].state,
    })),
    related: safe.related.map((report, i) => ({ ...report, namespace: data.related[i].namespace })),
    accounting: {
      ...safe.accounting,
      parentDelivery: data.accounting.parentDelivery,
      missingTokenFields: [...data.accounting.missingTokenFields],
    },
    attempts: safe.attempts.map((attempt, i) => {
      const original = data.attempts[i];
      return {
        ...attempt,
        operationId: original.operationId,
        callId: original.callId,
        state: original.state,
        role: original.role,
        ...(attempt.observation && original.observation
          ? {
              observation: {
                ...attempt.observation,
                source: original.observation.source,
                costBasis: original.observation.costBasis,
              },
            }
          : {}),
      };
    }),
  };
}
