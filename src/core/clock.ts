// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type { Clock } from "./contracts.js";
import { sleep } from "./util.js";

/** Construction starts no timer; scheduling belongs to active runtime work. */
export function createSystemClock(): Clock {
  return Object.freeze({
    monotonicMs: () => performance.now(),
    utcIso: () => new Date().toISOString(),
    schedule(delayMs: number, callback: () => void) {
      const timer = setTimeout(callback, delayMs);
      return () => clearTimeout(timer);
    },
    sleep,
  });
}
