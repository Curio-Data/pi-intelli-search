// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { isDeepStrictEqual } from "node:util";
import { Value } from "typebox/value";
import { AccountingBodySchema } from "./accounting-schema.js";
import { validateIdentifier } from "./execution-coordinator.js";
import { createAttemptLedger } from "./usage.js";

/**
 * Validate untrusted settled records and recompute their summary through C16's
 * sole ledger implementation. No missing observation is replaced with zero.
 * Parent delivery is an external observation, not derivable from attempt data.
 * Returns a diagnostic rather than accepting a shape-only accounting claim.
 */
export function accountingBodyError(
  attempts: unknown,
  summary: unknown,
  operationId?: string,
): string | undefined {
  const body = { attempts, summary };
  if (!Value.Check(AccountingBodySchema, body)) return "accounting body schema mismatch";
  const ledger = createAttemptLedger();
  let owner = operationId;
  try {
    for (const record of body.attempts) {
      validateIdentifier(record.operationId, "operationId");
      validateIdentifier(record.callId, "callId");
      if (record.pageId !== undefined) validateIdentifier(record.pageId, "pageId");
      owner ??= record.operationId;
      if (record.operationId !== owner) return "attempt belongs to a different operation";
      if (record.settledAtMs < record.startedAtMs) return "attempt settled before its start";
      const identity = {
        operationId: record.operationId,
        callId: record.callId,
        attempt: record.attempt,
        model: record.model,
        role: record.role,
        ...(record.pageId !== undefined ? { pageId: record.pageId } : {}),
      };
      ledger.start(identity, record.startedAtMs, record.queueMs);
      if (record.observation !== undefined) ledger.observe(identity, record.observation);
      ledger.finish(identity, record.state, record.settledAtMs);
    }
  } catch (error) {
    return `invalid attempt records: ${error instanceof Error ? error.message : String(error)}`;
  }
  const expected = ledger.summary(body.summary.parentDelivery);
  // A missing-field mask is a set; its JSON order carries no accounting meaning.
  const actual = {
    ...body.summary,
    missingTokenFields: [...body.summary.missingTokenFields].sort(),
  };
  const calculated = { ...expected, missingTokenFields: [...expected.missingTokenFields].sort() };
  if (!isDeepStrictEqual(actual, calculated))
    return "accounting summary differs from its attempt ledger";
  return undefined;
}
