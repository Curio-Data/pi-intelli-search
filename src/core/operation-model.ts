// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { randomUUID } from "node:crypto";
import type {
  ModelCompletion,
  ModelRequest,
  ModelRole,
  OperationContext,
  ScopedModelClient,
} from "./contracts.js";

/** Explicit call-site roles, never inferred from a shared model or prompt. */
export function completeOperationModel(
  context: OperationContext,
  role: ModelRole,
  request: ModelRequest,
  pageId?: string,
): Promise<ModelCompletion> {
  const services = context.services;
  // Untouched native and direct legacy helpers retain their existing policy.
  if (!services) return context.models.complete(request);
  if (context.signal !== services.operation.signal)
    throw new TypeError("Operation context must use the services signal");
  return (context.models as ScopedModelClient).complete({
    ...request,
    scope: {
      operation: services.operation,
      ledger: services.ledger,
      role,
      callId: randomUUID(),
      ...(pageId ? { pageId } : {}),
    },
  });
}
