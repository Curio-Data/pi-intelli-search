// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd

import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { ConfigurationError, parseConfig, type StandaloneConfig } from "./config.js";
import { StandaloneError } from "./errors.js";

export interface HostPaths {
  readonly directory: string;
  readonly config: string;
  readonly credential: string;
}

/** Stable per-user paths. No host credential stores or project files are discovered. */
export function hostPaths(env: NodeJS.ProcessEnv = process.env): HostPaths {
  const home = env.HOME || homedir();
  if (!home || !isAbsolute(home)) throw new Error("A home directory is required");
  const base =
    env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME)
      ? env.XDG_CONFIG_HOME
      : join(home, ".config");
  const directory = join(base, "mcp-intelli-search");
  return {
    directory,
    config: join(directory, "config.json"),
    credential: join(directory, "openrouter.key"),
  };
}

export function defaultDocument(credential: string) {
  return {
    providers: {
      openrouter: {
        apiKeyEnv: "OPENROUTER_API_KEY",
        apiKeyFile: credential,
      },
    },
    models: {
      search: { provider: "openrouter", model: "perplexity/sonar" },
      extract: { provider: "openrouter", model: "minimax/minimax-m3" },
      collate: { provider: "openrouter", model: "minimax/minimax-m3" },
    },
  };
}

export function defaultCodexConfig(workspace: string, paths: HostPaths): Promise<StandaloneConfig> {
  return parseConfig(defaultDocument(paths.credential), workspace);
}

function credentialText(source: string): string {
  const value = source.replace(/\r?\n$/, "");
  if (!value || value.length > 4096 || /\s/.test(value))
    throw new Error("OpenRouter credential must be one nonempty line without whitespace");
  return value;
}

/** Environment wins. A missing credential file is handled by provider preflight. */
export async function resolveCredential(
  config: StandaloneConfig,
  env: Readonly<Record<string, string | undefined>>,
): Promise<string | undefined> {
  const fromEnvironment = env[config.apiKeyEnv];
  if (fromEnvironment) return fromEnvironment;
  if (!config.apiKeyFile) return undefined;
  let source: string;
  try {
    const metadata = await lstat(config.apiKeyFile);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1)
      throw new StandaloneError(
        "CONFIGURATION",
        "OpenRouter credential file must be one regular, non-linked file",
      );
    if (process.platform !== "win32") {
      if (metadata.uid !== process.getuid?.() || (metadata.mode & 0o077) !== 0)
        throw new StandaloneError(
          "CONFIGURATION",
          "OpenRouter credential file must be owned by the current user and inaccessible to group and other users; repair it or run mcp-intelli-search setup for the default configuration",
        );
    }
    source = await readFile(config.apiKeyFile, "utf8");
  } catch (error) {
    if (error instanceof StandaloneError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new StandaloneError(
      "CONFIGURATION",
      "OpenRouter credential file is not readable; repair the configured path or run mcp-intelli-search setup for the default configuration",
    );
  }
  try {
    return credentialText(source);
  } catch (error) {
    throw new StandaloneError(
      "CONFIGURATION",
      `${error instanceof Error ? error.message : "Invalid OpenRouter credential"}; replace it or run mcp-intelli-search setup for the default configuration`,
    );
  }
}

async function writePrivateAtomic(file: string, source: string): Promise<void> {
  const directory = dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, source, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

/** Creates or connects the default configuration before storing the credential. */
async function prepareConfig(paths: HostPaths): Promise<HostPaths> {
  let source: string;
  try {
    source = await readFile(paths.config, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await writePrivateAtomic(
      paths.config,
      `${JSON.stringify(defaultDocument(paths.credential), null, 2)}\n`,
    );
    return paths;
  }
  if (source.startsWith("\uFEFF")) source = source.slice(1);
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new ConfigurationError(
      "invalid-json",
      `Configuration file is not valid JSON: ${paths.config}`,
    );
  }
  let parsed: StandaloneConfig;
  try {
    parsed = await parseConfig(value, process.cwd());
  } catch (error) {
    if (error instanceof ConfigurationError) throw error;
    throw new ConfigurationError(
      "invalid",
      `Invalid configuration in ${paths.config}: ${error instanceof Error ? error.message : "unknown defect"}`,
    );
  }
  if (parsed.apiKeyFile) return { ...paths, credential: parsed.apiKeyFile };
  const metadata = await lstat(paths.config);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1)
    throw new Error("Configuration must be one regular, non-linked file before setup can update it");
  const document = value as {
    providers: { openrouter: Record<string, unknown> };
  };
  document.providers.openrouter.apiKeyFile = paths.credential;
  await writePrivateAtomic(paths.config, `${JSON.stringify(document, null, 2)}\n`);
  return paths;
}

/** Writes a complete setup without accepting a credential in argv or config JSON. */
export async function setupHost(
  source: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<HostPaths> {
  const credential = credentialText(source);
  const paths = await prepareConfig(hostPaths(env));
  await writePrivateAtomic(paths.credential, `${credential}\n`);
  return paths;
}
