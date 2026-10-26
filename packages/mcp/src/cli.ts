#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { parseArgs } from "node:util";
import { homedir } from "node:os";
import { realpath } from "node:fs/promises";
import { parse as parsePath } from "node:path";
import { identity } from "./identity.js";
import { ConfigurationError, loadConfig, resolveWorkspace } from "./config.js";
import type { StandaloneConfig } from "./config.js";
import { installStdoutGuard } from "./stdout-guard.js";
import { defaultCodexConfig, hostPaths, setupHost } from "./host.js";

export function cliOptions(argv: string[], env: NodeJS.ProcessEnv = process.env) {
  const { values, positionals } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: true,
    options: {
      config: { type: "string" },
      workspace: { type: "string" },
      host: { type: "string" },
      help: { type: "boolean" },
      version: { type: "boolean" },
      "check-config": { type: "boolean" },
    },
  });
  if (values.host !== undefined && values.host !== "codex")
    throw new Error("Unsupported host");
  if (positionals.length > 1 || (positionals.length === 1 && positionals[0] !== "setup"))
    throw new Error("Unsupported command");
  const setup = positionals[0] === "setup";
  return {
    ...values,
    setup,
    config:
      values.config ?? (setup || values.host === "codex" ? undefined : env.INTELLI_SEARCH_CONFIG),
    workspace:
      values.workspace ??
      (setup || values.host === "codex" ? undefined : env.INTELLI_SEARCH_WORKSPACE),
  };
}

async function credentialInput(): Promise<string> {
  if (process.stdin.isTTY)
    throw new Error(
      "Setup requires the key on standard input; use the hidden-prompt pipeline from the installation guide",
    );
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk);
    length += buffer.length;
    if (length > 4098)
      throw new Error("Credential input exceeds the 4096-byte limit plus its line ending");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  let args: ReturnType<typeof cliOptions>;
  try {
    args = cliOptions(process.argv.slice(2));
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Invalid arguments");
  }
  if (args.help) {
    process.stdout.write(
      `Usage: mcp-intelli-search setup\n       mcp-intelli-search --host codex [--config FILE] [--workspace ABSOLUTE_DIRECTORY]\n       mcp-intelli-search --config FILE --workspace ABSOLUTE_DIRECTORY\n\nCommands:\n  setup               Store an OpenRouter key read from standard input and create or connect per-user configuration; accepts no path selections\n\nOptions:\n  --host codex      Use the Codex working root and per-user defaults\n  --config FILE       Explicit generic configuration (or INTELLI_SEARCH_CONFIG)\n  --workspace DIR     Existing absolute generic workspace (or INTELLI_SEARCH_WORKSPACE)\n  --check-config      Validate configuration without inference or serving\n  --help              Show this help\n  --version           Show package version\n\nGeneric MCP serving requires explicit configuration and workspace paths.\nCodex mode supplies both from its launcher and works without path exports.\nStandard output carries protocol messages only while serving.\n`,
    );
    return;
  }
  if (args.version) {
    process.stdout.write(`${identity.version}\n`);
    return;
  }
  if (args.setup) {
    if (args.config || args.workspace || args.host || args["check-config"])
      throw new Error(
        "Setup accepts no path selections. Remove --config, --workspace, --host and --check-config",
      );
    const paths = await setupHost(await credentialInput());
    // Existing model and tuning selections are preserved; validate the final file.
    await loadConfig(paths.config, process.cwd());
    process.stdout.write(
      `Setup complete.\nConfiguration: ${paths.config}\nCredential: ${paths.credential}\nThe next tool call can use this credential when the selected configuration names its path.\nRestart after changing loaded configuration.\n`,
    );
    if (process.env.OPENROUTER_API_KEY)
      process.stderr.write(
        "OPENROUTER_API_KEY is set and takes precedence over the stored credential\n",
      );
    return;
  }
  const paths = args.host === "codex" ? hostPaths() : undefined;
  const file = args.config ?? paths?.config;
  const workspace = args.workspace ?? (args.host === "codex" ? process.cwd() : undefined);
  if (!file || !workspace)
    throw new Error(
      "Explicit --config and --workspace are required (or their INTELLI_SEARCH_* environment equivalents)",
    );
  const canonicalWorkspace = await resolveWorkspace(workspace);
  let workspaceDefect: string | undefined;
  if (args.host === "codex" && !args.workspace) {
    const home = await realpath(homedir()).catch(() => homedir());
    if (canonicalWorkspace === parsePath(canonicalWorkspace).root || canonicalWorkspace === home)
      workspaceDefect =
        "Codex working root must be a project directory, not the home or filesystem root; restart Codex from the project or with --cd <project>";
  }
  if (args["check-config"]) {
    if (workspaceDefect) throw new Error(workspaceDefect);
    let builtInDefaults = false;
    if (paths && !args.config) {
      try {
        await loadConfig(file, workspace);
      } catch (error) {
        if (!(error instanceof ConfigurationError) || error.reason !== "missing") throw error;
        await defaultCodexConfig(workspace, paths);
        builtInDefaults = true;
      }
    } else {
      await loadConfig(file, workspace);
    }
    process.stdout.write(
      builtInDefaults
        ? "Configuration is valid (built-in Codex defaults; no per-user file found).\n"
        : "Configuration is valid.\n",
    );
    return;
  }
  const loadSelected = async (): Promise<StandaloneConfig> => {
    const loaded = await loadConfig(file, workspace);
    return paths && !args.config && !loaded.apiKeyFile
      ? { ...loaded, apiKeyFile: paths.credential }
      : loaded;
  };
  let config: StandaloneConfig | (() => Promise<StandaloneConfig>);
  if (workspaceDefect) {
    const defect = workspaceDefect;
    config = () => Promise.reject(new Error(defect));
  } else {
    try {
      config = await loadSelected();
    } catch (error) {
      if (!(error instanceof ConfigurationError)) throw error;
      if (paths && !args.config && error.reason === "missing") {
        config = await defaultCodexConfig(workspace, paths);
      } else {
        process.stderr.write(
          `[mcp-intelli-search] ${error.message}. Serving anyway: each tool call reports this and rereads the file until it loads\n`,
        );
        config = loadSelected;
      }
    }
  }
  // The guard must precede loading the server module: dependency import-time
  // output would otherwise corrupt protocol framing on standard output.
  installStdoutGuard();
  const { startServer } = await import("./server.js");
  await startServer(config);
  process.stderr.write(
    `[mcp-intelli-search] ${identity.name} ${identity.version} serving stdio\n`,
  );
}
// CLI is a dedicated bundle, not a library entrypoint.
void main().catch((error: unknown) => {
  process.stderr.write(
    `mcp-intelli-search: ${error instanceof Error ? error.message : "Startup failed"}\n`,
  );
  process.exitCode = 1;
});
