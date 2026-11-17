#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ashraf Miah, Curio Data Pro Ltd
//
// test/e2e/direct-tool.mjs: invoke one registered tool exactly, through the
// real host, with no agent-loop model call.
//
// Configuration scenarios test what the extension does with its settings, not
// whether a model chooses the right arguments. This driver builds the same
// session `pi -p` builds (resource loader with the -e extensions, settings and
// project trust from the isolated agent directory, built-in MCP when
// extensions are not disabled, an in-memory session), emits `session_start`
// through bindExtensions(), then runs exactly one call through
// session.extensionRunner.createToolContext(...).executeTool(name, args). That
// path is the host's tool pipeline: argument validation, tool_call and
// tool_result hooks, MCP server waits, progress updates. Its
// tool_execution_start/update/end events are written as JSON lines in the
// format `pi --mode json` emits.
//
// The agent's own model stream is replaced by one that refuses and records any
// call, so a direct run cannot spend agent-loop quota; the extension's model
// calls use ctx.modelRegistry and are unaffected.
//
// Usage:
//   node direct-tool.mjs --host-bin PATH | --sdk PACKAGE_DIR
//     --agent-dir DIR --cwd DIR --tool NAME --args JSON
//     [--extension PATH]... [--no-extensions] [--tools NAME[,NAME]]
//     [--tool-wait-ms N]
//
// Exit status:
//   0    the call ran (its result, error or not, is in the event stream)
//   69   direct invocation is unavailable on this host (SDK or API missing);
//        a caller may fall back to the agent loop and must say so
//   70   driver error
//   71   an agent-loop model call was attempted (refused)
//   72   the tool never became callable (load error, server not connected)
//   130/143  interrupted

import { existsSync, readFileSync, realpathSync, writeSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const EXIT = Object.freeze({ ok: 0, unavailable: 69, error: 70, agentLoop: 71, notCallable: 72 });
const PACKAGE_NAME = "@earendil-works/pi-coding-agent";
const PARENT_CALL_ID = "e2e-direct";

/** Write one JSON line to stdout synchronously, so nothing is lost on exit. */
function emit(record) {
  writeSync(1, `${JSON.stringify(record)}\n`);
}

function packageNameAt(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name;
  } catch {
    return undefined;
  }
}

/**
 * Locate the coding-agent package that a `pi` executable runs: an npm bin
 * link to dist/cli.js, or the managed launcher script that reads
 * <agent>/install/current-version.
 */
export function resolveSdkFromHostBin(hostBin) {
  const real = realpathSync(hostBin);
  for (let dir = dirname(real); dir !== dirname(dir); dir = dirname(dir)) {
    if (packageNameAt(dir) === PACKAGE_NAME) return dir;
  }
  let text = "";
  try {
    text = readFileSync(real, "utf8").slice(0, 8192);
  } catch {
    return undefined;
  }
  if (text.startsWith("#!") && text.includes("install/current-version")) {
    const agentDir = dirname(dirname(real));
    const versionFile = join(agentDir, "install", "current-version");
    if (!existsSync(versionFile)) return undefined;
    const version = readFileSync(versionFile, "utf8").trim();
    if (!/^[0-9A-Za-z._+-]+$/.test(version) || version === "." || version === "..") return undefined;
    const pkg = join(agentDir, "install", "releases", version, "node_modules", ...PACKAGE_NAME.split("/"));
    if (packageNameAt(pkg) === PACKAGE_NAME) return pkg;
  }
  return undefined;
}

/** Drop null-valued arguments: the host normalises optional nulls to omission. */
export function directArguments(args) {
  return Object.fromEntries(Object.entries(args ?? {}).filter(([, value]) => value !== null && value !== undefined));
}

/**
 * Project trust as `pi` resolves it non-interactively (main.js `createRuntime`,
 * core/project-trust.js `resolveProjectTrusted`):
 *   1. no trust-requiring project resources: the store decision, else trusted;
 *   2. an extension answering the `project_trust` event (not reproduced: the
 *      driver resolves trust before extensions load; recorded in the result);
 *   3. the store decision;
 *   4. the global `defaultProjectTrust` setting: always → trusted, never →
 *      untrusted, ask → untrusted, because a print-mode run has no UI to ask.
 * `defaultProjectTrust` is the value `SettingsManager.getDefaultProjectTrust()`
 * returns from global settings, as main.js reads it.
 */
export function resolveProjectTrust(sdk, cwd, agentDir, defaultProjectTrust = "ask") {
  if (typeof sdk.ProjectTrustStore !== "function" || typeof sdk.hasTrustRequiringProjectResources !== "function") {
    return { projectTrusted: undefined, basis: "host-default", projectTrustExtensionEvent: "unknown" };
  }
  const decision = new sdk.ProjectTrustStore(agentDir).get(cwd);
  if (!sdk.hasTrustRequiringProjectResources(cwd)) {
    return {
      projectTrusted: decision ?? true,
      basis: decision === null || decision === undefined ? "no-trust-requiring-resources" : "trust-store",
      projectTrustExtensionEvent: "not-applicable",
    };
  }
  // The host would emit `project_trust` to extensions before reading the store.
  const projectTrustExtensionEvent = "not-emitted (the driver resolves trust before extensions load)";
  if (decision !== null && decision !== undefined) return { projectTrusted: decision, basis: "trust-store", projectTrustExtensionEvent };
  if (defaultProjectTrust === "always") return { projectTrusted: true, basis: "defaultProjectTrust: always", projectTrustExtensionEvent };
  if (defaultProjectTrust === "never") return { projectTrusted: false, basis: "defaultProjectTrust: never", projectTrustExtensionEvent };
  return { projectTrusted: false, basis: "defaultProjectTrust: ask, no UI (untrusted)", projectTrustExtensionEvent };
}

/** Harness-only research-call budget (E2E_RESEARCH_CALL_BUDGET); undefined when off. */
export function parseBudget(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : undefined;
}

function parseArgs(argv) {
  const out = { extensions: [], noExtensions: false, toolWaitMs: 60_000 };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`missing value for ${flag}`);
      i += 1;
      return v;
    };
    switch (flag) {
      case "--host-bin": out.hostBin = value(); break;
      case "--sdk": out.sdk = value(); break;
      case "--agent-dir": out.agentDir = resolve(value()); break;
      case "--cwd": out.cwd = resolve(value()); break;
      case "--tool": out.tool = value(); break;
      case "--args": out.args = JSON.parse(value()); break;
      case "--extension": out.extensions.push(resolve(value())); break;
      case "--no-extensions": out.noExtensions = true; break;
      case "--tools": out.tools = value().split(",").filter(Boolean); break;
      case "--tool-wait-ms": out.toolWaitMs = Number(value()); break;
      default: throw new Error(`unknown argument ${flag}`);
    }
  }
  if (!out.agentDir || !out.cwd || !out.tool || !out.args || typeof out.args !== "object" || Array.isArray(out.args)) {
    throw new Error("--agent-dir, --cwd, --tool and --args (a JSON object) are required");
  }
  if (!out.sdk && !out.hostBin) throw new Error("--sdk or --host-bin is required");
  return out;
}

function unavailable(reason, extra = {}) {
  emit({ type: "e2e_direct_unavailable", reason, ...extra });
  process.stderr.write(`direct invocation unavailable: ${reason}\n`);
  return EXIT.unavailable;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function run(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`direct-tool: ${error.message}\n`);
    return EXIT.error;
  }

  // Extension and host console output must not interleave with the JSON lines.
  for (const method of ["log", "info", "debug"]) console[method] = (...a) => console.error(...a);

  const sdkDir = opts.sdk ? resolve(opts.sdk) : resolveSdkFromHostBin(opts.hostBin);
  if (!sdkDir || packageNameAt(sdkDir) !== PACKAGE_NAME) {
    return unavailable("cannot locate the host's coding-agent package", { hostBin: opts.hostBin ?? null, sdk: opts.sdk ?? null });
  }
  const sdkVersion = JSON.parse(readFileSync(join(sdkDir, "package.json"), "utf8")).version;
  let sdk;
  try {
    sdk = await import(pathToFileURL(join(sdkDir, "dist", "index.js")).href);
  } catch (error) {
    return unavailable(`cannot import the host SDK: ${error.message}`, { sdkVersion });
  }
  for (const name of ["createAgentSession", "DefaultResourceLoader", "SessionManager", "SettingsManager"]) {
    if (typeof sdk[name] !== "function") return unavailable(`host SDK lacks ${name}`, { sdkVersion });
  }

  // The CLI hands its built-in extensions (MCP, codemode, tool search) to the
  // resource loader as factories (main.js: `[...builtInExtensions, ...]`);
  // the loader then applies --no-extensions to them. Mirror that exactly. The
  // list is not in the package exports, so it is loaded by file path.
  let builtInExtensions = [];
  let builtinsLoaded = false;
  try {
    const mod = await import(pathToFileURL(join(sdkDir, "dist", "extensions", "index.js")).href);
    if (Array.isArray(mod.builtInExtensions)) {
      builtInExtensions = mod.builtInExtensions;
      builtinsLoaded = true;
    }
  } catch {
    // Recorded below; an MCP call without the built-ins cannot be qualified.
  }
  if (!builtinsLoaded && opts.tool.startsWith("mcp__")) {
    return unavailable("host built-in extensions (MCP client) cannot be loaded", { sdkVersion });
  }

  // main.js reads the default from a startup settings manager (global settings).
  let defaultProjectTrust = "ask";
  try {
    const startup = sdk.SettingsManager.create(opts.cwd, opts.agentDir);
    if (typeof startup.getDefaultProjectTrust === "function") defaultProjectTrust = startup.getDefaultProjectTrust();
  } catch {
    // An unreadable settings file leaves the host default.
  }
  const researchCallBudget = parseBudget(process.env.E2E_RESEARCH_CALL_BUDGET);
  const trust = resolveProjectTrust(sdk, opts.cwd, opts.agentDir, defaultProjectTrust);
  const args = directArguments(opts.args);
  emit({
    type: "e2e_direct_driver",
    invocation: "direct",
    sdkVersion,
    sdkPackage: sdkDir.split(sep).slice(-4).join("/"),
    tool: opts.tool,
    args,
    noExtensions: opts.noExtensions,
    extensions: opts.extensions.map((p) => p.split(sep).slice(-3).join("/")),
    tools: opts.tools ?? null,
    builtinExtensions: builtinsLoaded ? builtInExtensions.map((e) => e?.name ?? "unnamed") : null,
    projectTrusted: trust.projectTrusted ?? null,
    projectTrustBasis: trust.basis,
    defaultProjectTrust,
    projectTrustExtensionEvent: trust.projectTrustExtensionEvent,
    researchCallBudget: researchCallBudget ?? null,
  });

  const controller = new AbortController();
  let interrupted = 0;
  const onSignal = (code) => () => {
    interrupted = code;
    controller.abort(new Error("interrupted"));
  };
  process.on("SIGTERM", onSignal(143));
  process.on("SIGINT", onSignal(130));

  // Keep the event loop alive for the whole invocation: a tool that only awaits
  // its abort signal holds no handle, and Node would otherwise exit 0 with the
  // call unfinished. Cleared once the session is disposed.
  const keepAlive = setInterval(() => {}, 1 << 30);
  let session;
  let agentLoopCalls = 0;
  let agentLoopEvents = 0;
  let code = EXIT.ok;
  try {
    const settingsManager = sdk.SettingsManager.create(
      opts.cwd,
      opts.agentDir,
      trust.projectTrusted === undefined ? undefined : { projectTrusted: trust.projectTrusted },
    );
    const resourceLoader = new sdk.DefaultResourceLoader({
      cwd: opts.cwd,
      agentDir: opts.agentDir,
      settingsManager,
      additionalExtensionPaths: opts.extensions,
      extensionFactories: builtInExtensions,
      noExtensions: opts.noExtensions,
      noSkills: true,
      noPromptTemplates: true,
      noContextFiles: true,
    });
    await resourceLoader.reload();
    const loadErrors = (resourceLoader.getExtensions?.().errors ?? []).map(({ path, error }) => ({ path, error: String(error) }));
    if (loadErrors.length > 0) emit({ type: "e2e_direct_extension_errors", errors: loadErrors });

    ({ session } = await sdk.createAgentSession({
      cwd: opts.cwd,
      agentDir: opts.agentDir,
      resourceLoader,
      settingsManager,
      sessionManager: sdk.SessionManager.inMemory(opts.cwd),
      ...(opts.tools ? { tools: opts.tools } : {}),
    }));
    const runner = session.extensionRunner;
    if (typeof runner?.createToolContext !== "function" || typeof session.bindExtensions !== "function") {
      return unavailable("host session lacks extensionRunner.createToolContext or bindExtensions", { sdkVersion });
    }

    // Refuse any agent-loop model call; record it so the run fails loudly. A
    // host that exposes neither known property cannot be guarded, so direct
    // invocation is unavailable there rather than silently unguarded.
    const agent = session.agent;
    const streamKey = ["streamFunction", "streamFn"].find((key) => key in agent);
    if (!streamKey) return unavailable("host agent exposes no known stream property (streamFunction, streamFn)", { sdkVersion });
    agent[streamKey] = () => {
      agentLoopCalls += 1;
      throw new Error("e2e direct driver: agent-loop model call refused");
    };

    let researchStarts = 0;
    const overBudget = new Set();
    session.subscribe((event) => {
      if (event.type === "tool_execution_start" || event.type === "tool_execution_update" || event.type === "tool_execution_end") {
        emit(event);
        // The harness budget. The tracer extension's tool_call hook blocks the
        // over-budget call itself (its result carries the budget marker the
        // verdict counts); the driver records the overrun at the start and
        // stops the attempt once that call has ended. Aborting at the start
        // would pre-empt the block and lose the marker.
        if (researchCallBudget !== undefined && event.toolName === opts.tool) {
          if (event.type === "tool_execution_start") {
            researchStarts += 1;
            if (researchStarts > researchCallBudget) {
              overBudget.add(event.toolCallId);
              emit({ type: "e2e_direct_budget_exceeded", tool: opts.tool, calls: researchStarts, limit: researchCallBudget });
            }
          } else if (event.type === "tool_execution_end" && overBudget.has(event.toolCallId) && !controller.signal.aborted) {
            controller.abort(new Error("research-call budget exceeded"));
          }
        }
      } else if (event.type === "agent_start" || event.type === "turn_start") {
        agentLoopEvents += 1;
      }
    });

    await session.bindExtensions({
      mode: "json",
      onError: (err) => {
        emit({ type: "e2e_direct_extension_error", extensionPath: err.extensionPath, error: String(err.error) });
        process.stderr.write(`Extension error (${err.extensionPath}): ${err.error}\n`);
      },
    });

    // MCP tools register only after their server connects; extension tools
    // are registered on load. Wait, bounded, for the tool to be callable.
    const callable = () => (session.getCallableToolNames?.() ?? session.getActiveToolNames()).includes(opts.tool);
    const waitStart = Date.now();
    while (!callable() && Date.now() - waitStart < opts.toolWaitMs && !controller.signal.aborted) await sleep(100);
    if (!callable()) {
      const registered = session.getAllTools?.().some((t) => t.name === opts.tool) ?? false;
      emit({ type: "e2e_direct_not_callable", tool: opts.tool, registered, waitedMs: Date.now() - waitStart });
      process.stderr.write(`direct invocation: ${opts.tool} is not callable (registered: ${registered})\n`);
      code = interrupted || EXIT.notCallable;
    } else {
      emit({ type: "e2e_direct_tool_ready", tool: opts.tool, waitedMs: Date.now() - waitStart });
      // The nested-call pipeline needs an issuing assistant message. This
      // synthetic one lives only in memory: it is not persisted and is never
      // sent to a model.
      const issuing = {
        role: "assistant",
        content: [{ type: "toolCall", id: PARENT_CALL_ID, name: "e2e_direct_invocation", arguments: { tool: opts.tool } }],
        api: "e2e-direct",
        provider: "e2e-direct",
        model: "e2e-direct",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "toolUse",
        timestamp: Date.now(),
      };
      agent.state.messages = [...agent.state.messages, issuing];
      const context = runner.createToolContext(PARENT_CALL_ID, controller.signal);
      const outcome = await context.executeTool(opts.tool, args, { signal: controller.signal });
      emit({ type: "e2e_direct_result", toolCallId: outcome?.toolCall?.id ?? null, isError: outcome?.isError === true });
      if (interrupted) code = interrupted;
    }
  } catch (error) {
    emit({ type: "e2e_direct_error", error: error instanceof Error ? error.message : String(error) });
    process.stderr.write(`direct-tool: ${error instanceof Error ? error.stack : String(error)}\n`);
    code = interrupted || EXIT.error;
  } finally {
    if (session) {
      try {
        const runner = session.extensionRunner;
        if (runner?.hasHandlers?.("session_shutdown")) await runner.emit({ type: "session_shutdown", reason: "quit" });
      } catch (error) {
        process.stderr.write(`direct-tool: session_shutdown failed: ${error}\n`);
      }
      try {
        session.dispose();
      } catch (error) {
        process.stderr.write(`direct-tool: dispose failed: ${error}\n`);
      }
    }
    clearInterval(keepAlive);
  }
  if ((agentLoopCalls > 0 || agentLoopEvents > 0) && code === EXIT.ok) {
    process.stderr.write("direct-tool: the agent loop ran during a direct invocation\n");
    code = EXIT.agentLoop;
  }
  emit({ type: "e2e_direct_settled", agentLoopModelCalls: agentLoopCalls, agentLoopEvents, exitCode: code });
  return code;
}

function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  // A natural exit before run() settles is a driver failure, never success.
  process.exitCode = EXIT.error;
  // Exit explicitly: a lingering handle (a timer, an MCP child that ignored
  // shutdown) must not keep a finished invocation alive until its deadline.
  run(process.argv.slice(2)).then(
    (status) => process.exit(status),
    (error) => {
      process.stderr.write(`direct-tool: ${error?.stack ?? error}\n`);
      process.exit(EXIT.error);
    },
  );
}
