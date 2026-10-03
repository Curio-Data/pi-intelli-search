#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { parseArgs } from "node:util";
import { identity } from "./identity.js";
import { loadConfig } from "./config.js";

export function cliOptions(argv: string[], env: NodeJS.ProcessEnv = process.env) {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: {
      config: { type: "string" },
      workspace: { type: "string" },
      help: { type: "boolean" },
      version: { type: "boolean" },
      "check-config": { type: "boolean" },
    },
  });
  return {
    ...values,
    config: values.config ?? env.INTELLI_SEARCH_CONFIG,
    workspace: values.workspace ?? env.INTELLI_SEARCH_WORKSPACE,
  };
}
async function main(): Promise<void> {
  let args: ReturnType<typeof cliOptions>;
  try {
    args = cliOptions(process.argv.slice(2));
  } catch {
    throw new Error("Invalid arguments. Run mcp-intelli-search --help");
  }
  if (args.help) {
    process.stdout.write(
      `Usage: mcp-intelli-search --config FILE --workspace ABSOLUTE_DIRECTORY\n\nOptions:\n  --config FILE       Explicit JSON configuration (or INTELLI_SEARCH_CONFIG)\n  --workspace DIR     Existing absolute workspace (or INTELLI_SEARCH_WORKSPACE)\n  --check-config      Validate configuration without inference or serving\n  --help              Show this help\n  --version           Show package version\n\nCommand-line values take precedence over environment values.\nPhase 3 provides the standalone engine. MCP protocol serving arrives in Phase 4.\n`,
    );
    return;
  }
  if (args.version) {
    process.stdout.write(`${identity.version}\n`);
    return;
  }
  if (!args.config || !args.workspace)
    throw new Error(
      "Explicit --config and --workspace are required (or their INTELLI_SEARCH_* environment equivalents)",
    );
  await loadConfig(args.config, args.workspace);
  if (args["check-config"]) {
    process.stdout.write("Configuration is valid.\n");
    return;
  }
  throw new Error(
    "Configuration is valid. MCP protocol serving is not implemented in this Phase 3 artifact; use the runtime entrypoint for engine verification",
  );
}
// CLI is a dedicated bundle, not a library entrypoint.
void main().catch((error: unknown) => {
  process.stderr.write(
    `mcp-intelli-search: ${error instanceof Error ? error.message : "Startup failed"}\n`,
  );
  process.exitCode = 1;
});
