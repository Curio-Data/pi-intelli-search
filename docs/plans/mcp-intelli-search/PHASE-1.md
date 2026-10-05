# Phase 1 Results

## Outcome

Phase 1 is complete for its defined scope: host-neutral dependency contracts, a native model adapter and explicit physical cache paths are implemented. The frozen native fixtures match without regeneration. Phase 2, Shared Operations and Native Adapter, is next in the [implementation plan](IMPLEMENTATION.md#phase-2-shared-operations-and-native-adapter).

No Model Context Protocol (MCP) server, standalone provider, plugin or new dependency is introduced. The native package identity, peer ranges, defaults, schemas, prompts and result shapes remain unchanged. Operation bodies still live in `src/tools/`; `src/core/index.ts` is a dependency boundary, not a complete research engine.

## Interfaces and Boundaries

| Source | Responsibility |
|---|---|
| `src/core/contracts.ts` | Operation inputs/results, progress, deeply readonly settings context, model requests/completions, retry configuration, logger and package identity |
| `src/core/paths.ts` | Absolute workspace/cache/staging path values and an independent cache display policy |
| `src/core/index.ts` | Host-neutral contracts, data types, path helpers, annotations and utilities |
| `src/native-model-client.ts` | Per-operation model client delegating to existing native `callLlm()`; model-existence preflight |
| `src/agent-dir.ts` | Native agent-directory discovery, formerly in shared utilities |
| `src/host-types.ts` | Native update callback, tool result and theme types, formerly in shared data types |

All four native tools use the model adapter. Each completion owns its citation and usage state; the adapter does not add retries, read another credential store or substitute a provider. `callLlm()` remains the sole transport retry/timeout owner and retains both registry-facade and legacy provider dispatch. Its optional `onUsage` callback lets the adapter retain reported usage without inventing missing counts. Native result payloads do not gain usage fields in this phase.

Preflight retains native behaviour: research validates all configured models exist before starting the pipeline. Credential resolution remains in `callLlm()`. This is not the stricter standalone configuration validation planned for Phase 3.

Settings discovery, trust gating, migration and model registration stay in their native modules. The annotation wrapper now uses the standard `typeof globalThis.fetch` type instead of importing a host type. Repository consumers of the old host-type and directory-helper locations were migrated; `validateModelConfigs` remains re-exported from the research tool for existing tests. Existing global test seams remain native-only. New model-client tests inject a delegate per instance.

## Cache Portability Correction

`makeCachePath(query, cwd, cacheDir)` now returns an absolute physical path anchored to the supplied workspace rather than ignoring `cwd`. Both cache-writing tools resolve their report, source, extraction, index, lock and telemetry access against that root. Cache suggestions read the same anchored index. No operation changes the process directory.

The display path remains separate. Prompts, returned details, appendices and the report header retain native configured-path text, including relative `.search/...` paths. `writeReportFile()` accepts a display path independently of its physical destination. Absolute and parent-relative native cache settings remain supported. The correction is observable when the process directory differs from `ctx.cwd`: files now land in the session workspace instead of the launcher directory.

The path helper is not a filesystem containment validator. MCP traversal and symlink checks remain later work. The contract defines a staging root, but documentation downloads still use the existing temporary-directory implementation; workspace-local download staging and unconditional cleanup belong to Phase 2. Verification commands redirected temporary files into the encrypted repository.

## Verification

Verification ran on branch `plan/mcp-intelli-search`, starting from `d975f19`, on 2026-10-03. The live host was `Pi` `1.0.0` with [_Node.js_](https://nodejs.org/) `v24.19.0`. The root package version remains canonical in `package.json`; the test total remains canonical in the README badge. Logs are gitignored under `.tmp/mcp-phase1/`.

| Check | Result | Evidence Scope |
|---|---|---|
| Baseline Native Fixtures | Passed Before Editing | Existing expected files established the starting contract |
| `npm run build` | Passed | Native source and new interfaces compile |
| `npm test` | Passed | Existing coverage plus dependency-boundary, adapter and workspace tests |
| Contract Type Check | Passed | `node_modules/.bin/tsc -p test/tsconfig.native-contract.json`, expanded to include the new seam tests |
| Frozen Native Fixtures | Passed Unchanged | Exact tool, prompt, request, result, progress, cache and telemetry captures |
| Core Independence | Passed | Recursive source and generated-declaration import checks; emitted core/cache imported in a child process with all package resolution and out-of-tree file imports denied |
| Model Adapter | Passed | Per-call state isolation, option forwarding, provider usage, both native dispatch paths, retry delegation, provider errors, cancellation and stalled-response timeout |
| Workspace Isolation | Passed | Completed, partial and degraded cache-writing scenarios match existing fixtures while running from a separate empty launcher directory; launcher remains untouched |
| `npm run test:smoke` | Passed | Final run used `PI_CODING_AGENT_DIR` under `.tmp/mcp-phase1/smoke-agent/` to isolate model registration |
| `./test/run-e2e-publish-local.sh` | Passed | Root tarball installs and registers under plain Node.js; fresh peer resolution selected `pi-ai` `1.0.1` |
| `./test/e2e/01_main.sh` | Passed | Live pipeline completed with report, index, extraction, source and all five telemetry stage buckets |
| Shell Validation | Passed | Existing primary live scenario, shared harness and fresh-install script |

The independence test denies package resolution explicitly so ancestor `node_modules` directories cannot mask a host dependency. It also checks generated declarations, where type-only host imports would survive despite disappearing from _JavaScript_. This proves the Phase 1 boundary, not an unimplemented standalone engine or package.

The live scenario used its documented `kimi-coding/k3` agent loop and configured [_OpenRouter_](https://openrouter.ai) pipeline models. Real host credentials were read only by the existing isolated test harness; no host configuration was modified. No release, staged publication or plugin installation occurred.

## Subsequent Peer Review

Two independent native reviewers assessed this checkpoint and its follow-up corrections. [Phase 1 Peer Review](PHASE-1-REVIEW.md) records model provenance, findings, dispositions and re-run gates. The custom-cache suggestion instruction now uses its configured display root; the default frozen fixture text remains unchanged. Phase 2 is still next.

## Continuation

Start Phase 2 by moving operation bodies behind the new model and execution contracts, preserving native registration and rendering. Keep the fixture JSON unchanged unless an intentional behavioural correction is separately documented. Move shared helpers with forwarding exports, then extract retry/timeout policy with one owner.

Outstanding Phase 2 work includes workspace-local documentation staging and cleanup, injected telemetry package identity, and replacing native global harness mutation in new engine tests. The operation context and host-neutral result interface are defined but not yet the execution API of the native tools. Do not claim the complete pipeline is host-independent until those moves pass the dependency and native gates.

The full paced release suite, real minimum-host installation matrix, standalone provider wire tests, MCP protocol tests and host-plugin installation tests were not run. They remain the later gates in the implementation plan, not Phase 1 acceptance evidence.
