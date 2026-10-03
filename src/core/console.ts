// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { AsyncLocalStorage } from "node:async_hooks";

interface MuzzleScope {
  error: readonly unknown[];
  warn: readonly unknown[];
  muzzled: boolean;
  warned: boolean;
  active: boolean;
}

const scopes = new AsyncLocalStorage<readonly MuzzleScope[]>();
let activeCalls = 0;
let restore: (() => void) | undefined;

/** Install one dispatcher for overlapping regions, restoring only after the last exits. */
function acquireConsole(): void {
  if (activeCalls++ !== 0) return;
  const originalError = console.error;
  const originalWarn = console.warn;
  const dispatch =
    (channel: "error" | "warn", original: typeof console.error) =>
    (...args: unknown[]) => {
      const stack = scopes.getStore() ?? [];
      for (let i = stack.length - 1; i >= 0; i--) {
        const scope = stack[i];
        if (scope.active && scope[channel].includes(args[0])) {
          if (channel === "error") scope.muzzled = true;
          else scope.warned = true;
          return;
        }
      }
      original(...args);
    };
  const errorDispatcher = dispatch("error", originalError);
  const warnDispatcher = dispatch("warn", originalWarn);
  console.error = errorDispatcher;
  console.warn = warnDispatcher;
  restore = () => {
    // Do not overwrite a third party that deliberately replaced the dispatcher.
    if (console.error === errorDispatcher) console.error = originalError;
    if (console.warn === warnDispatcher) console.warn = originalWarn;
  };
}

/**
 * Suppress dependency-specific console tags in this async call only. Nested
 * regions prefer the innermost matching scope. Concurrent calls and unrelated
 * async work cannot mark each other's degradation flags. No permanent patch is
 * installed: the final active region restores the original console methods.
 */
export async function withMuzzledConsole<T>(
  fn: () => Promise<T>,
  muzzleTags: { error?: readonly unknown[]; warn?: readonly unknown[] },
): Promise<{ value: T; muzzled: boolean; warned: boolean }> {
  const error = muzzleTags.error ?? [];
  const warn = muzzleTags.warn ?? [];
  if (error.length === 0 && warn.length === 0) {
    return { value: await fn(), muzzled: false, warned: false };
  }
  const scope: MuzzleScope = { error, warn, muzzled: false, warned: false, active: true };
  acquireConsole();
  try {
    const value = await scopes.run([...(scopes.getStore() ?? []), scope], fn);
    return { value, muzzled: scope.muzzled, warned: scope.warned };
  } finally {
    // Async descendants may outlive fn; a closed scope must not suppress them.
    scope.active = false;
    if (--activeCalls === 0) {
      restore?.();
      restore = undefined;
    }
  }
}
