// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type { CompactData, FullData } from "./contracts.js";

/** Preserve answer/details intact. Only verified committed paths may be metadata. */
export function compactResult(data: FullData): CompactData {
  const cache = data.cache;
  return {
    outcome: data.outcome,
    text: data.text,
    details: data.details,
    meta: {
      schemaVersion: 1,
      operation: data.operation,
      operationId: data.operationId,
      persistence: cache.status,
      ...(cache.status === "committed"
        ? {
            ...(Buffer.byteLength(JSON.stringify(cache.reportPath), "utf8") <= 4096
              ? { reportPath: cache.reportPath }
              : {}),
            index: cache.index,
          }
        : {}),
      counts: data.counts,
      elapsedMs: data.timing.elapsedMs,
      attempts: data.accounting.attempts,
      missingAttempts: data.accounting.missingAttempts,
      ...(data.accounting.reportedCost.total === undefined
        ? {}
        : { reportedCost: data.accounting.reportedCost.total }),
      ...(data.accounting.estimatedCost.total === undefined
        ? {}
        : { estimatedCost: data.accounting.estimatedCost.total }),
      costComplete: data.accounting.costComplete,
    },
  };
}
