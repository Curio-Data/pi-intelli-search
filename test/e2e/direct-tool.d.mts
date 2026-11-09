// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
// Declarations for direct-tool.mjs, the exact registered-tool invocation driver.

export const EXIT: Readonly<{ ok: 0; unavailable: 69; error: 70; agentLoop: 71; notCallable: 72 }>;
export function resolveSdkFromHostBin(hostBin: string): string | undefined;
export function directArguments(args: Record<string, unknown> | undefined): Record<string, unknown>;
export function resolveProjectTrust(
  sdk: Record<string, unknown>,
  cwd: string,
  agentDir: string,
): { projectTrusted: boolean | undefined; basis: string };
export function run(argv: string[]): Promise<number>;
