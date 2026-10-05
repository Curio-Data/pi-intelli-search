// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { AsyncLocalStorage } from "node:async_hooks";
import type { OperationLogger } from "../../../src/core/contracts.js";

const scopes = new AsyncLocalStorage<{ active: boolean; logger: OperationLogger }>();
let activeCalls = 0;
let restore: (() => void) | undefined;
const channels = ["log", "info", "debug", "dir", "table"] as const;

/** Suppress stdout console diagnostics only inside standalone operation scopes. */
export async function withStandaloneStdout<T>(
  logger: OperationLogger,
  operation: () => Promise<T>,
): Promise<T> {
  if (activeCalls++ === 0) {
    const restores: Array<() => void> = [];
    for (const channel of channels) {
      const original = console[channel];
      const dispatch = (...args: unknown[]) => {
        const scope = scopes.getStore();
        if (scope?.active) {
          // Do not forward fetched content or recursively invoke a logger's console.log.
          scopes.exit(() =>
            scope.logger.warn("Suppressed dependency console output during standalone execution"),
          );
        } else original(...args);
      };
      console[channel] = dispatch;
      restores.push(() => {
        if (console[channel] === dispatch) console[channel] = original;
      });
    }
    restore = () => {
      for (const undo of restores) undo();
    };
  }
  const scope = { active: true, logger };
  try {
    return await scopes.run(scope, operation);
  } finally {
    scope.active = false;
    if (--activeCalls === 0) {
      restore?.();
      restore = undefined;
    }
  }
}
