// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import type { PinnedSdk } from "./host.js";

// Covers the 30-minute worker ceiling plus the SDK's five-minute refresh window.
export const CREDENTIAL_MIN_VALIDITY_MS = 35 * 60_000;

/** Presence/expiry only. Never copies, refreshes, writes or returns secret material. */
export function assertStoredCredentialReady(
  sdk: Pick<PinnedSdk, "readStoredCredential">,
  authPath: string,
  provider: string,
  now = Date.now(),
): void {
  const credential = sdk.readStoredCredential(provider, authPath);
  if (!credential) throw new Error(`Missing ${provider} credential; operator setup is required`);
  if (credential.type === "oauth") {
    if (!Number.isFinite(credential.expires) || credential.expires - now < CREDENTIAL_MIN_VALIDITY_MS) {
      throw new Error(`${provider} access expires too soon; refresh through the operator's own login, never this study profile`);
    }
    if (!credential.access) throw new Error(`Missing ${provider} access token`);
  } else if (credential.type === "api_key" && !credential.key) {
    throw new Error(`Missing ${provider} API key`);
  }
}
