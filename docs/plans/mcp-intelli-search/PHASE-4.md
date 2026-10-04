# Phase 4 Results

## Outcome

Phase 4 implements Model Context Protocol (MCP) serving for `@curio-data/mcp-intelli-search`. The installed executable serves the four canonical operations over standard input/output (stdio) through the official split server package, with bounded queueing, progress forwarding, cancellation, graceful shutdown and clean protocol framing. The native `Pi` package, its frozen fixtures and both installation gates are preserved. Phase 5, Host Plugins and Guidance, is next in the [implementation plan](IMPLEMENTATION.md#phase-5-host-plugins-and-guidance).

No release or publication has occurred. Plugin bundles, multi-host certification, the full paced release suite and release-workflow routing remain later work.

## Implementation

| Path | Responsibility |
|---|---|
| `packages/mcp/src/server.ts` | Tool registration separate from startup, result/error mapping, progress forwarding, stdio serving and shutdown wiring |
| `packages/mcp/src/queue.ts` | Bounded first-in first-out scheduler: one active operation per server, eight queued, busy overflow, queued cancellation |
| `packages/mcp/src/stdout-guard.ts` | Process-wide diversion of non-protocol stdout writes to standard error; the transport keeps the original stream |
| `packages/mcp/src/cli.ts` | Guard installation before loading the server module, then actual server startup |
| `scripts/build-mcp.mjs` | Third bundle entry with ECMAScript module (ESM) code splitting, keeping the CLI's dynamic server import deferred |
| `packages/mcp/test/server.test.ts` | Real child-process protocol suite through the official client |
| `packages/mcp/test/child-server.ts`, `child-noise.ts` | Fixture server with synthetic inference, stall, degraded and noise modes |
| `scripts/verify-mcp-install.mjs` | Installed-artifact raw protocol smoke added to the independent gate |
| `test/e2e/11_mcp_stdio.sh` | Live host smoke through the native MCP client of an isolated `Pi` profile |

The protocol dependency is `@modelcontextprotocol/server` `^2.3.0`, the split-package line verified in [Phase 0](PHASE-0.md#dependency-verification) and rechecked against the registry before installation (still the current release, last published 2026-10-02). The Phase 0 probe passed unchanged against it. The client package is a development dependency used only by the protocol suite. Neither package enters the native extension's runtime boundary; the build audit rejects any bundle input outside the approved roots and any undeclared external.

Registration uses the canonical schemas through the SDK's `fromJsonSchema` bridge, so `tools/list` mirrors the native tool contracts and the SDK itself reports invalid arguments as `isError` tool results. Runtime validation remains the second, stricter layer. Successful calls return the concise text plus structured content (`outcome`, `details`); degraded research stays a normal result. Execution failures map the safe `StandaloneError` category onto an `isError` result without raw provider causes, honouring the established mapping rule that some shared operations surface provider failures as `OPERATION`.

Tool annotations are truthful: search and extract are read-only, collate and research write cache files and are not, no tool claims idempotence, and all carry `openWorldHint` because every operation calls external services and incurs charges.

The stdout guard installs before the server module loads, so import-time dependency output, console calls and direct `process.stdout.write` from dependencies all divert to standard error while the transport writes protocol frames through the original stream binding. The SDK's own output stream is not intercepted. A deliberately noisy fixture proves framing survives all three noise classes.

Shutdown covers three triggers: input closure (the SDK transport aborts in-flight requests and closes), `SIGINT` and `SIGTERM` (the adapter aborts active and queued work, drains the queue and closes, with a ten-second hard-exit backstop). Queued entries abort through the combined request/shutdown signal without starting their operations. A fourth path surfaced during review: a host closing the server's standard output raises EPIPE on the real stream. The guard sinks that error, the SDK takes its graceful close path, and the adapter destroys the now-orphaned standard input so the process actually exits; both the deterministic suite and the installed-artifact gate cover the path.

## Host Interoperability

`test/e2e/11_mcp_stdio.sh` registers the built server in an isolated `Pi` profile's `mcp.json` and drives a real `intelli_research` call (maxUrls 1) through `Pi`'s native MCP client without loading the native extension. It validates connectivity with `pi mcp list`, runs the research, and asserts the workspace cache, the `mcp` adapter telemetry identity and a completed outcome. Two host behaviours were established during verification:

- The native MCP client lives in `Pi`'s built-in extensions: a `pi -p --no-extensions` session has no `mcp__*` tools even though a separate `pi mcp list` without the flag connects normally (`pi --no-extensions mcp list` itself fails, because the subcommand is part of the same integration). The smoke relies on the isolated profile for isolation instead.
- Servers default to `codemode` exposure, under which `mcp__<server>__<tool>` is not declared to the model. The smoke sets `"exposure": "direct"` so the headless loop model calls the tool directly.

The scenario consumes live provider quota (one small research) and is added to the sequential runner `test/run-e2e-all.sh` so release pacing covers it.

## Verification

Verification ran on `plan/mcp-intelli-search` from `1b09318`, using [_Node.js_](https://nodejs.org/) `v24.19.0`, Linux x86-64 and `Pi` `1.0.1`. Private logs reside under `.tmp/mcp-phase4/`; they are not required to continue. Test totals remain single-sourced in the root README badge.

| Gate | Result and Scope |
|---|---|
| Native Entry Checks | Passed before editing: build, frozen fixtures, core tests and contract type check |
| SDK Recheck | Registry still serves the Phase 0 split packages as current; the checked-in probe passed unchanged against 2.3.0 |
| `npm run build:all` | Passed: native compile, standalone source/test type check and all three bundles with splitting |
| `npm run test:all` | Passed: native and standalone deterministic suites, including the protocol and queue suites |
| Contract Type Check | Passed: `node_modules/.bin/tsc -p test/tsconfig.native-contract.json` |
| Frozen Native Fixtures | Passed without regeneration |
| Structural Smoke | Passed with isolated `PI_CODING_AGENT_DIR` |
| Native Tarball | Passed: `./test/run-e2e-publish-local.sh` |
| Standalone Tarball | Passed: production-only install, both fetch variants, plus raw protocol initialize/list/invalid-argument/shutdown with stdout asserted as protocol-only |
| Primary Native Live Scenario | Passed: `./test/e2e/01_main.sh` |
| MCP Host Smoke | Passed: `./test/e2e/11_mcp_stdio.sh`, real research through the isolated `Pi` native MCP client |
| Shell Validation | `shellcheck` clean for the new host-smoke script and the modified runner |

The protocol suite covers initialization, listing with annotations and frozen-fixture schema equality, all four operations, a degraded no-links outcome, invalid arguments as tool errors, progress notifications, client cancellation of a running operation, cancellation of a queued request after proving it reached the server (which then never starts), busy overflow beyond the queue bound, noisy-dependency framing, exit on input closure, in-flight abort on mid-operation input closure, graceful close on host-side standard output closure, and configuration-less startup failure with empty stdout. Queue unit tests pin ordering, the concurrency bound, overflow, abort-before-start, already-aborted submission, handler-contract breach and close-time draining.

The deterministic suite does not establish interoperability with [_Claude Code_](https://code.claude.com/docs/en/plugins) or [_Codex_](https://developers.openai.com/codex/plugins) clients, multi-connection behaviour, or operation under a hostile same-user workspace. Live inference is certified only through the single `Pi` host smoke above, not through a standalone direct-provider run. The declared Node.js range remains a single-version local verification. The `npm audit` report carries pre-existing advisories in pre-Phase-4 dependencies: `defuddle` itself (a production dependency of both artifacts) and its transitive `@xmldom/xmldom`, plus `brace-expansion`, `undici`, `ws` and `esbuild` in the host development tree. None of the new protocol dependencies are affected, the lockfile diff shows additions only, and no dependency was upgraded here.

## Continuation

Implement Phase 5 against the served protocol. Generate host-appropriate guidance from a shared source, accounting for host-qualified tool names (`mcp__<server>__intelli_research` is a different declaration from the native `intelli_research`). Add the _Claude Code_ and _Codex_ plugin manifests, launchers and repository marketplaces (linked at first mention above), preferring a pinned `npx` launcher for an exact `@curio-data/mcp-intelli-search` version, and test each host's environment-substitution rules separately. Keep catalogues in this repository, preserve both installation gates and keep native expected fixtures unchanged. Pre-publication local-tarball launcher tests and post-publication registry tests must be labelled separately. Do not publish; explicit approval remains required for any release or staged publication.
