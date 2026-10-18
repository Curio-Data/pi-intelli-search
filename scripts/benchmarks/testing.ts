// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

// Test-support helpers for the P3 benchmark libraries. Scratch directories are
// created under the repository's gitignored .tmp/ (encrypted host policy:
// never /tmp) and removed by the caller.

import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunObservation, UsageObservation } from "./contracts.js";

export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Creates an isolated scratch directory under <repo>/.tmp/benchmark-*. */
export async function scratchDir(prefix: string): Promise<string> {
  return mkdtemp(join(REPO_ROOT, ".tmp", `benchmark-${prefix}-`));
}

/** Removes a scratch directory (best effort). */
export async function removeDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

export const HEX_64 = "0123456789abcdef".padEnd(64, "0").slice(0, 64).replace(/^0+$/, "0").padStart(64, "0");

/** A synthetic sha256-shaped digest built from a repeatable character. */
export function fakeHash(character: string): string {
  return character.repeat(64);
}

export function sampleUsage(overrides: Partial<UsageObservation["tokens"]> = {}): UsageObservation {
  return {
    tokens: {
      inputTotal: 1200,
      inputUncached: 300,
      outputTotal: 90,
      cacheRead: 800,
      cacheWrite: 100,
      totalTokens: 1290,
      ...overrides,
    },
    cost: { total: 0.0021, input: 0.0004, output: 0.0007, cacheRead: 0.0008, cacheWrite: 0.0002 },
    source: "provider-response",
    costBasis: "reported",
    providerRequestId: "req-synthetic-1",
  };
}

/** A structurally valid synthetic run observation for append tests. */
export function sampleRunObservation(overrides: Partial<RunObservation> = {}): RunObservation {
  return {
    runId: "run-synthetic-1",
    queryId: "CD-D01",
    experiment: "codemode",
    arm: "B",
    repeat: 1,
    seed: 42,
    order: 1,
    methodSha256: fakeHash("a"),
    corpusSha256: fakeHash("b"),
    fixtureSha256: fakeHash("c"),
    candidateCommit: "e1cfe62745631cabed26539c09225fae707fbd5d",
    lockfileSha256: fakeHash("d"),
    host: { pi: "1.3.0", node: "24" },
    effectiveSettings: { execution: { pageExecution: "streaming" } },
    toolCatalogueSha256: fakeHash("e"),
    promptSha256: fakeHash("f"),
    status: "completed",
    replayValidity: "valid",
    observerComplete: true,
    mainUsage: { inputTotal: 5000, inputUncached: 1200, outputTotal: 700 },
    pipelineUsage: {
      attempts: 3,
      observedAttempts: 3,
      missingAttempts: 0,
      tokens: { inputTotal: 3600, outputTotal: 250 },
      reportedCost: { total: 0.01 },
      estimatedCost: { total: 0.01 },
      missingTokenFields: [],
      costComplete: true,
      parentDelivery: "available",
    },
    reportedPipelineUsd: 0.01,
    estimatedPipelineUsd: 0.01,
    subscriptionQuota: { windowResetUtc: "2026-10-18T00:00:00Z" },
    artifacts: [{ path: "report.md", sha256: fakeHash("1") }],
    ...overrides,
  };
}

/**
 * Installs a guard around globalThis.fetch that records calls and fails the
 * test if any network primitive is invoked. Returns a restore function.
 */
export function forbidNetwork(test: { fail: (message: string) => void }): {
  restore: () => void;
  calls: () => number;
} {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => {
    calls += 1;
    test.fail("transport replay invoked globalThis.fetch (N1 violation)");
    throw new Error("network forbidden in replay");
  }) as typeof globalThis.fetch;
  return {
    restore: () => {
      globalThis.fetch = original;
    },
    calls: () => calls,
  };
}

// Deterministic content-derived resolvers for the committed synthetic
// scenario "synthetic-codemode-dev": role from the exact per-role system
// prompt (mirroring the real pipeline's role-distinct prompts), page nodes
// from the source marker in the user message, fetch nodes from method/url/
// accept. Shared by the benchmark fixture tests; the coordinator wires the
// equivalent mapping from src/core/prompts.ts at integration.
export const SYNTHETIC_ROLE_PROMPTS = {
  search: "You are the synthetic search stage.",
  extract: "You are the synthetic extraction stage.",
  collate: "You are the synthetic collation stage.",
  suggest: "You are the synthetic cache-suggestion stage.",
} as const;

export function syntheticModelResolver(): (
  request: {
    readonly systemPrompt: string;
    readonly userMessage: string;
  },
) => { readonly operationNode: string; readonly role: "search" | "extract" | "collate" | "suggest" } | { readonly ambiguous: true; readonly detail: string } {
  return (request) => {
    const entry = Object.entries(SYNTHETIC_ROLE_PROMPTS).find(([, prompt]) => prompt === request.systemPrompt);
    if (entry === undefined) {
      return { ambiguous: true, detail: `unknown synthetic system prompt "${request.systemPrompt}"` };
    }
    const role = entry[0] as "search" | "extract" | "collate" | "suggest";
    if (role === "extract") {
      const match = /source (S\d+)/.exec(request.userMessage);
      if (match === null) return { ambiguous: true, detail: "extract request without a source marker" };
      return { operationNode: `research.extract/${match[1]}`, role };
    }
    const nodeByRole = { search: "research.search", collate: "research.collate", suggest: "suggest.judge" } as const;
    return { operationNode: nodeByRole[role], role };
  };
}

export function syntheticPageResolver(): (
  request: { readonly url: string; readonly method: string; readonly accept: string },
) => { readonly operationNode: string } | { readonly ambiguous: true; readonly detail: string } {
  return (request) => {
    if (request.url === "https://example.com/one" && request.method === "GET") {
      if (request.accept.includes("markdown")) return { operationNode: "page.fetch/variant-markdown" };
      return { operationNode: "page.fetch/variant-html" };
    }
    if (request.url === "https://example.com/llms-full.txt" && request.method === "HEAD") {
      return { operationNode: "docs.discovery/probe" };
    }
    return { ambiguous: true, detail: `no synthetic page node for ${request.method} ${request.url}` };
  };
}
