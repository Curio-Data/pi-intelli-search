# Phase 3 Results

## Outcome

Phase 3 implements the standalone `@curio-data/mcp-intelli-search` runtime and package. Its installed engine executes all four operations without the native package, source checkout, development dependencies or `Pi` libraries. Phase 4, MCP Protocol, is next in the [implementation plan](IMPLEMENTATION.md#phase-4-mcp-protocol).

This checkpoint does not serve Model Context Protocol (MCP) requests. The executable supplies help, version and explicit `--check-config` validation with success/failure exit status. An invocation requesting server startup still exits with an availability error rather than pretending to run a server. Protocol registration, queueing, progress notifications, shutdown and host plugins remain later work. No release or publication has occurred.

## Implementation

| Path | Responsibility |
|---|---|
| `packages/mcp/package.json` | Separate artifact, executable, runtime exports and explicit external dependencies |
| `packages/mcp/src/config.ts` | Explicit file/workspace selection, strict configuration validation and immutable resolved values |
| `packages/mcp/src/workspace.ts` | Workspace-contained cache paths and existing-link checks |
| `packages/mcp/src/providers/openrouter.ts` | Catalogue preflight and non-streaming inference transport using the shared policy |
| `packages/mcp/src/runtime.ts` | Per-operation context, standalone argument validation and host-neutral cache guidance |
| `packages/mcp/src/console.ts`, `errors.ts` | Scoped dependency stdout interception and safe error categories |
| `packages/mcp/src/identity.ts` | Adapter-owned installed-manifest identity |
| `src/core/defaults.ts` | Shared tuning values, without provider/model selections |
| `scripts/build-mcp.mjs` | Bundled internal core, audited external dependencies and generated legal-file copies |
| `scripts/verify-mcp-install.mjs` | Independent production install and installed executable/engine/native-fetch verification |
| `packages/mcp/test/` | Deterministic configuration, CLI, provider and runtime tests |

The root remains the native `Pi` package, with unchanged peer ranges, resource paths, model defaults and command meanings for `build` and `test`. New explicit aggregate commands are `build:all` and `test:all`; MCP-specific commands are `build:mcp`, `typecheck:mcp`, `test:mcp` and `test:mcp:install`. Continuous integration runs both artifacts, the contract type check and both installation gates. Release workflow routing is unchanged and remains later work.

The standalone bundle includes internal core source and externalises third-party packages. Its manifest declares `defuddle`, `linkedom`, `typebox` and `wreq-js`; no host package or MCP SDK (software development kit) is introduced on the runtime boundary. [_esbuild_](https://esbuild.github.io/) is a root development dependency, pinned after registry verification. The lockfile retains native host dependency versions; its larger diff includes the bundler's platform-specific optional packages and the older version still required by `tsx`.

The build reads package metadata for dependency audits. Each emitted adapter entry discovers its own installed manifest; the bundled core does not walk the filesystem for identity. Root `LICENSE` and `NOTICE` are copied during build and included in the tarball, with generated copies ignored in the checkout. The runtime entrypoint is experimental and does not yet publish TypeScript declarations.

## Configuration and Provider Evidence

The exact schema, validation ranges and setup example are in the [standalone README](../../../packages/mcp/README.md#configuration). Configuration requires an absolute existing workspace, explicit role selections and an environment-variable reference for credentials. Unknown fields and unsafe values are rejected. No host credential store, discovered project file, alternate endpoint or inference-provider fallback is used.

[_OpenRouter_](https://openrouter.ai) is the only standalone provider. Each operation performs a bounded model-catalogue lookup before paid work, checking exact role identifiers, text input/output and applicable advertised capabilities. Full research validates all roles before search. Missing credentials do not prevent configuration loading or runtime construction. Catalogue capability checks do not prove per-key model access or sufficient account credit.

The adapter uses Chat Completions with `stream: false`, system/user messages, `max_completion_tokens`, `reasoning.effort` and `reasoning.exclude` only for models advertising reasoning support. Search payloads reuse the shared `openrouter:web_search` builder. Citations are parsed from the completed response body; unsuccessful attempts cannot contribute citations. Provider-reported token counts and total cost are retained without invented component costs. `ModelUsage.totalCost` is an additive optional core field; native result fixtures are unchanged.

The shared model policy runs once for each catalogue or inference request. Standalone defaults cover all four operations, including one-shot operations whose native policy remains unchanged. Cancellation covers catalogue requests, response-body reads and shared retry delays. HTTP (Hypertext Transfer Protocol) errors, successful responses with top-level or choice-level error bodies, malformed responses and empty token-budget-exhausted completions produce safe failures. Known provider error types take precedence over numeric status for retry classification. A valid Retry-After header also makes an in-flight-budget `402` retryable; ordinary credit exhaustion remains permanent. Raw provider messages, metadata, headers and transport exceptions are not copied into diagnostics.

Provider documentation was checked on 2026-10-03:

- [Chat Completions](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion): endpoint, non-streaming shape and completion token limit.
- [Reasoning Tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens): effort, exclusion, catalogue `reasoning.supported_efforts` and shared reasoning/output budget.
- [Web Search](https://openrouter.ai/docs/guides/features/server-tools/web-search): tool parameters, domain filtering and citation annotations.
- [Errors and Debugging](https://openrouter.ai/docs/api/reference/errors-and-debugging): HTTP and successful-body errors, Retry-After and provider failure shapes.

The initial summarised research incorrectly said that `reasoning.exclude` was absent. Direct inspection of the reasoning guide established the field and supersedes that summary. The adapter deliberately uses non-streaming JSON (JavaScript Object Notation), not Responses API events or an incomplete streaming parser. Fixture tests establish request/response handling; live standalone inference is not claimed.

## Filesystem Boundaries

Standalone paths use the explicit canonical workspace and absolute display paths. Cache configuration rejects absolute locations and traversal. Safety checks inspect cache ancestors and existing subtrees for symlinks, dangling links, hardlinked files and special entries before execution, then repeat after provider preflight. Cache/staging roots must be directories. The scan has a bounded entry count.

This prevents existing escapes, not adversarial concurrent path replacement by another process with workspace write access. The workspace remains a trusted local operator boundary, not an operating-system sandbox. Native absolute and parent-relative cache configuration is preserved. Source fetching retains the shared semantics; `domains` is guidance rather than a network allowlist, and private network addresses are not filtered.

Cache and local telemetry formats retain shared behaviour. Standalone results use absolute paths and host-neutral file-reading guidance. Same-query writes refresh one shared directory under existing locks. Optional documentation staging and its cleanup remain the Phase 2 implementation.

## Verification

Verification ran on `plan/mcp-intelli-search` from `0c26972`, using [_Node.js_](https://nodejs.org/) `v24.19.0`, Linux x86-64 and `Pi` `1.0.1`. Private logs reside under `.tmp/mcp-phase3/`; they are not required to continue. Test totals remain single-sourced in the root README badge.

| Gate | Result and Scope |
|---|---|
| Native Entry Checks | Passed before editing: build, frozen fixtures, core tests and contract type check |
| `npm run build:all` | Passed: native compile, standalone source/test type check and both bundles |
| `npm run test:all` | Passed: native and standalone deterministic suites |
| Contract Type Check | Passed: `node_modules/.bin/tsc -p test/tsconfig.native-contract.json` |
| Frozen Native Fixtures | Passed without regeneration |
| Structural Smoke | Passed with isolated `PI_CODING_AGENT_DIR` |
| Native Tarball | Passed: plain Node.js registration, installed identity and freshly resolved host peers |
| Standalone Tarball | Passed: production-only install, help/version, all operations, telemetry identity and both real native-fetch variants |
| Primary Native Live Scenario | Passed: completed report, source, extraction, index and all local telemetry stage buckets |
| Shell Validation | Passed for the existing live, publish and aggregation scripts used by these gates |

The independent standalone install stays under repository scratch on the encrypted drive. An explicit loader denies every external-to-install file resolution in both ECMAScript modules and CommonJS. Negative probes reject host packages, the native root package and build/test tools, so ancestor `node_modules` cannot mask undeclared dependencies. The installed package is a real directory, not a workspace link. The probe runs from a launcher directory different from the explicit research workspace and exercises native fetching against loopback fixtures. Registry access installs dependencies; inference is synthetic and requires no credentials.

The standalone declared Node.js range is not a completed version/platform matrix. Only the runtime above was exercised locally. Continuous integration is configured for Node.js 22 but its remote result is separate evidence. Real minimum-native-host checks, live standalone inference, protocol clients, plugins and the full paced release suite remain later gates. No staged npm publication is authorised by completion of this phase.

## Peer Review

[Phase 3 Peer Review](PHASE-3-REVIEW.md) records two independent final `PASS` verdicts, the corrected provider-classification and dependency-stdout defects, configuration/error improvements and frozen-tree verification. Its scope and remaining limits are separate from the later fresh-agent handoff check.

## Continuation

Implement Phase 4 against the packaged runtime. Recheck the split MCP SDK release and its Phase 0 probe before adding production protocol dependencies. Preserve explicit configuration and credential-free initialisation; register the canonical operations through the SDK bridge, map progress and cancellation, add bounded queueing and shutdown, and prove clean framing with a real child-process client. Treat an invalid operation as a tool result or protocol error according to the SDK's established distinctions.

The Phase 3 CLI must gain actual server startup, not be documented as already serving. Retain `--check-config` as a separate credential-free validation route. The runtime exposes safe error categories for mapping without parsing prose; shared-operation wrapping can classify a provider failure as `OPERATION`. Dependencies are not assumed silent: the installed Defuddle conversion-failure handler prints fetched content through `console.log`. Standalone execution now suppresses stdout console calls inside an async scope, with an actual-dependency regression and overlap/restoration tests. Import-time output and direct stdout writes remain explicit Phase 4 framing tests, not properties established by that console guard. Plugin manifests and launchers remain Phase 5. Preserve both installation gates and keep native expected fixtures unchanged.
