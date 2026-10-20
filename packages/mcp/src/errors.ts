// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type { FullData, NumericHostUsage } from "../../../src/core/contracts.js";
import type { ExecutionReceipt } from "./execution-receipt.js";

export type StandaloneErrorCode =
  "INVALID_ARGUMENTS" | "CONFIGURATION" | "WORKSPACE" | "PROVIDER" | "OPERATION" | "CANCELLED";

/** Safe boundary metadata for protocol mapping; never retain raw provider causes. */
export class StandaloneError extends Error {
  constructor(
    readonly code: StandaloneErrorCode,
    message: string,
    readonly execution?: ExecutionReceipt,
    readonly data?: FullData,
    readonly usage?: NumericHostUsage,
  ) {
    super(message);
    this.name = code === "CANCELLED" ? "AbortError" : "StandaloneError";
  }
}
