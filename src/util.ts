// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Compatibility forwarding export. Implementation lives in the shared core.
export * from "./core/util.js";

/** Native diagnostics stay outside the host-neutral engine. */
export function logErr(msg: string, err?: unknown): void {
  if (err !== undefined) console.error(`[pi-intelli-search] ${msg}`, err);
  else console.error(`[pi-intelli-search] ${msg}`);
}
