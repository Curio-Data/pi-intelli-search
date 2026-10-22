// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { AsyncLocalStorage } from "node:async_hooks";
import type { Diagnostic } from "./contracts.js";

// Diagnostic observation only, never coordinator, model, credential or policy state.
const observers = new AsyncLocalStorage<{
  active: boolean;
  observe: (diagnostic: Diagnostic) => void;
}>();
export async function withOperationDiagnostics<T>(
  observe: (diagnostic: Diagnostic) => void,
  run: () => Promise<T>,
): Promise<T> {
  const scope = { active: true, observe };
  try {
    return await observers.run(scope, run);
  } finally {
    // Async descendants can retain their store after run() exits. Never let a
    // stale callback mutate a disposed producer or a later operation's result.
    scope.active = false;
  }
}
export function observeOperationDiagnostic(diagnostic: Diagnostic): void {
  try {
    const scope = observers.getStore();
    if (scope?.active) scope.observe(diagnostic);
  } catch {
    /* Observation cannot replace work. */
  }
}
