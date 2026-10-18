// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// Shared P2 test fixtures: clocks, scratch roots under the repository .tmp and
// a minimal valid artefact set.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Artifact,
  Clock,
  Diagnostic,
  RunStoreOptions,
} from "../../src/core/execution-contracts.js";

export const repo = fileURLToPath(new URL("../../", import.meta.url));
export const workerPath = fileURLToPath(new URL("./run-store-worker.ts", import.meta.url));

/** Scratch lives under the encrypted checkout, never the system temp directory. */
export async function scratchRoot(label: string): Promise<string> {
  const base = join(repo, ".tmp", "p2-tests");
  await mkdir(base, { recursive: true });
  return mkdtemp(join(base, `${label}-`));
}

export function realClock(utc: () => string = () => new Date().toISOString()): Clock {
  return {
    monotonicMs: () => performance.now(),
    utcIso: utc,
    schedule(delayMs, callback) {
      const timer = setTimeout(callback, delayMs);
      return () => clearTimeout(timer);
    },
    sleep(delayMs, signal) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(signal.reason);
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        }, delayMs);
        const onAbort = () => {
          clearTimeout(timer);
          reject(signal?.reason);
        };
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    },
  };
}

/** Virtual clock: sleep advances monotonic time immediately and records each wait. */
export function virtualClock(
  start = "2026-10-18T12:00:00.000Z",
): Clock & { sleeps: number[]; now: number } {
  const clock = {
    now: 0,
    sleeps: [] as number[],
    monotonicMs: () => clock.now,
    utcIso: () => start,
    schedule: () => () => undefined,
    async sleep(delayMs: number, signal?: AbortSignal) {
      if (signal?.aborted) throw signal.reason;
      clock.sleeps.push(delayMs);
      clock.now += delayMs;
      await new Promise((resolve) => setImmediate(resolve));
      if (signal?.aborted) throw signal.reason;
    },
  };
  return clock;
}

export function storeOptions(
  cacheRoot: string,
  overrides: Partial<RunStoreOptions> & { diagnostics?: Diagnostic[] } = {},
): RunStoreOptions {
  const diagnostics = overrides.diagnostics ?? [];
  return {
    workspaceRoot: overrides.workspaceRoot ?? cacheRoot,
    cacheRoot,
    displayRoot: overrides.displayRoot ?? ".search",
    clock: overrides.clock ?? realClock(),
    randomId: overrides.randomId ?? (() => randomBytes(16).toString("hex")),
    onDiagnostic: overrides.onDiagnostic ?? ((d) => diagnostics.push(d)),
  };
}

export function artifactsFor(query: string, extra: Artifact[] = []): Artifact[] {
  const text = (value: string) => new TextEncoder().encode(value);
  return [
    {
      relativePath: "report.md",
      kind: "report",
      bytes: text(`# Report\n\nAnswer for ${query} [S1].\n`),
    },
    { relativePath: "query.txt", kind: "query", bytes: text(query) },
    {
      relativePath: "run.json",
      kind: "manifest-data",
      bytes: text(JSON.stringify({ sources: [{ id: "S1", state: "used" }] })),
    },
    { relativePath: "sources/S1.md", kind: "source", bytes: text("source one") },
    { relativePath: "extractions/S1.md", kind: "extraction", bytes: text("extraction one") },
    ...extra,
  ];
}

export interface WorkerResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run the independent-process worker with JSON arguments. */
export function runWorker(
  args: Record<string, unknown>,
  onLine?: (line: string) => void,
): Promise<WorkerResult> & { child: ReturnType<typeof spawn> } {
  const child = spawn(process.execPath, ["--import", "tsx", workerPath, JSON.stringify(args)], {
    cwd: repo,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let partial = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
    partial += chunk;
    let index: number;
    while ((index = partial.indexOf("\n")) !== -1) {
      onLine?.(partial.slice(0, index));
      partial = partial.slice(index + 1);
    }
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  const promise = new Promise<WorkerResult>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal, stdout, stderr }));
  }) as Promise<WorkerResult> & { child: ReturnType<typeof spawn> };
  promise.child = child;
  return promise;
}
