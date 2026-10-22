// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type {
  Clock,
  DeepReadonly,
  FetchClient,
  OperationLease,
  PageTransport,
} from "./contracts.js";
import type { ResearchSettings } from "./types.js";
import { createFetchClient } from "./fetch-client.js";
import { createProcessPageTransport, type ProcessPageTransportOptions } from "./page-transport.js";

export class FetchConfigurationError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "FetchConfigurationError";
  }
}

/** Legacy per-run fetch settings become strict only when bounded fetch is consumed. */
export function validatePageFetchSettings(settings: DeepReadonly<ResearchSettings>): void {
  for (const [name, min, max] of [
    ["fetchConcurrency", 1, 512],
    ["fetchTimeoutMs", 1, 600_000],
  ] as const) {
    const value = settings[name];
    if (!Number.isSafeInteger(value) || value < min || value > max)
      throw new FetchConfigurationError(
        `pi-intelli-search.${name} must be an integer from ${min} to ${max}`,
      );
  }
}

/** Adapter-owned environment/executable policy, captured before operation work. */
export function capturePageFetchFactory(
  settings: DeepReadonly<ResearchSettings>,
  clock: Clock,
  policy: ProcessPageTransportOptions,
  pageTransport?: PageTransport,
) {
  if (!settings.execution) throw new TypeError("Fetch requires captured execution settings");
  const capturedSettings = structuredClone(settings);
  const captured = {
    browser: settings.browserFingerprint,
    timeoutMs: settings.fetchTimeoutMs,
    concurrency: settings.fetchConcurrency,
    maxResponseBytes: settings.execution.fetchMaxResponseBytes,
    docsMaxResponseBytes: settings.execution.docsMaxResponseBytes,
    maxChars: settings.execution.fetchMaxChars,
    ...(settings.httpProxy === undefined ? {} : { proxy: settings.httpProxy }),
  };
  const transport = pageTransport ?? createProcessPageTransport(policy);
  return (operation: OperationLease): FetchClient => {
    // Legacy native fetch keys remain permissive until bounded fetch is used.
    // Installing this service must not disable unrelated registered operations.
    let client: FetchClient | undefined;
    const get = () => {
      validatePageFetchSettings(capturedSettings);
      return (client ??= createFetchClient({ ...captured, operation, clock, transport }));
    };
    return Object.freeze({
      async fetch(...args: Parameters<FetchClient["fetch"]>) {
        return get().fetch(...args);
      },
      async discover(...args: Parameters<FetchClient["discover"]>) {
        return get().discover(...args);
      },
    });
  };
}

/** Only transport configuration crosses into disposable page children. No keys or debug loaders. */
export function capturePageEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  secretKey?: string,
): Readonly<Record<string, string | undefined>> {
  const names = [
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "SYSTEMROOT",
    "WINDIR",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "LIBC",
    "npm_config_libc",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_EXTRA_CA_CERTS",
  ];
  return Object.freeze(
    Object.fromEntries(
      names
        .filter((name) => name !== secretKey && environment[name] !== undefined)
        .map((name) => [name, environment[name]]),
    ),
  );
}
