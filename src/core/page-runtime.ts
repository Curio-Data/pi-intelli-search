// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type { Clock, DeepReadonly, OperationLease } from "./contracts.js";
import type { ResearchSettings } from "./types.js";
import { createFetchClient } from "./fetch-client.js";
import { createProcessPageTransport, type ProcessPageTransportOptions } from "./page-transport.js";

/** Adapter-owned environment/executable policy, captured before operation work. */
export function capturePageFetchFactory(
  settings: DeepReadonly<ResearchSettings>,
  clock: Clock,
  policy: ProcessPageTransportOptions,
) {
  if (!settings.execution) throw new TypeError("Fetch requires captured execution settings");
  const captured = {
    browser: settings.browserFingerprint,
    timeoutMs: settings.fetchTimeoutMs,
    concurrency: settings.fetchConcurrency,
    maxResponseBytes: settings.execution.fetchMaxResponseBytes,
    docsMaxResponseBytes: settings.execution.docsMaxResponseBytes,
    maxChars: settings.execution.fetchMaxChars,
    ...(settings.httpProxy === undefined ? {} : { proxy: settings.httpProxy }),
  };
  const transport = createProcessPageTransport(policy);
  return (operation: OperationLease) =>
    createFetchClient({ ...captured, operation, clock, transport });
}
