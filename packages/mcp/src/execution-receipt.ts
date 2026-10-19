// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type {
  AccountingSummary,
  AttemptRecord,
  NumericHostUsage,
  OperationServices,
} from "../../../src/core/contracts.js";

/** Internal adapter handoff, not the full operation data or MCP projection. */
export interface ExecutionReceipt {
  readonly operationId: string;
  readonly accounting: AccountingSummary;
  readonly attempts: readonly AttemptRecord[];
  readonly usage: NumericHostUsage;
}

/** Called only after the operation runtime has drained, including error paths. */
export function executionReceipt(
  services: OperationServices,
  parentDelivery: AccountingSummary["parentDelivery"] = "available",
): ExecutionReceipt {
  return Object.freeze({
    operationId: services.operation.id,
    accounting: services.ledger.summary(parentDelivery),
    attempts: services.ledger.records(),
    usage: services.ledger.hostUsage(),
  });
}
