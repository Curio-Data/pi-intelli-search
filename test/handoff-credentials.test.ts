// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import assert from "node:assert/strict";
import { test } from "node:test";
import { assertStoredCredentialReady } from "../scripts/research-handoff/credentials.js";

test("handoff credential preflight checks expiry without returning or modifying credentials", () => {
  const credential = { type: "oauth" as const, access: "synthetic-access", refresh: "synthetic-refresh", expires: 4_000_000 };
  const before = structuredClone(credential);
  const sdk = { readStoredCredential(provider: string, path?: string) {
    assert.equal(provider, "openai-codex"); assert.equal(path, "synthetic-reference"); return credential;
  } };
  assert.equal(assertStoredCredentialReady(sdk, "synthetic-reference", "openai-codex", 1_000_000), undefined);
  assert.deepEqual(credential, before);
  assert.throws(() => assertStoredCredentialReady(sdk, "synthetic-reference", "openai-codex", 2_000_000), /expires too soon/);
  assert.deepEqual(credential, before);
});

test("handoff credential preflight fails closed on missing fields", () => {
  assert.throws(() => assertStoredCredentialReady({ readStoredCredential: () => undefined }, "fixture", "openrouter"), /Missing/);
  assert.throws(() => assertStoredCredentialReady({ readStoredCredential: () => ({ type: "api_key" }) }, "fixture", "openrouter"), /Missing/);
  assert.throws(() => assertStoredCredentialReady({ readStoredCredential: () => ({ type: "oauth", access: "", refresh: "fake", expires: 4_000_000 }) }, "fixture", "openai-codex", 1_000_000), /Missing/);
});
