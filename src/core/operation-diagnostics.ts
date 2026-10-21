// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { AsyncLocalStorage } from "node:async_hooks";
import type { Diagnostic } from "./contracts.js";

// Diagnostic observation only, never coordinator, model, credential or policy state.
const observers = new AsyncLocalStorage<(diagnostic: Diagnostic) => void>();
export function withOperationDiagnostics<T>(
  observe: (diagnostic: Diagnostic) => void,
  run: () => Promise<T>,
): Promise<T> {
  return observers.run(observe, run);
}
export function observeOperationDiagnostic(diagnostic: Diagnostic): void {
  try {
    observers.getStore()?.(diagnostic);
  } catch {
    /* Observation cannot replace work. */
  }
}
