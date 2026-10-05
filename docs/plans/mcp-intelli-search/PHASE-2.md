# Phase 2 Results

## Outcome

Phase 2 is complete for its defined scope. All four operations execute from `src/core/operations/`, and the native tools retain their frozen schemas, prompts, results, progress and cache fixtures without regeneration. Phase 3, Standalone Runtime and Package, is next in the [implementation plan](IMPLEMENTATION.md#phase-3-standalone-runtime-and-package).

No Model Context Protocol (MCP) runtime, standalone provider, plugin, dependency or release is introduced. Native package metadata, peer ranges, defaults, settings discovery and authentication remain unchanged.

## Boundaries

| Source | Responsibility |
|---|---|
| `src/core/operations/` | Search, extract, collate and the self-contained five-stage research pipeline |
| `src/core/contracts.ts` | Explicit settings, model client, paths, package identity, progress, diagnostics and operation outcomes |
| `src/core/schemas.ts` | Canonical native-permissive parameter schemas, reused by native registrations |
| `src/core/llm.ts` | Single model retry, timeout and cancellation policy |
| `src/core/console.ts` | Async-local dependency diagnostic suppression with reference-counted restoration |
| `src/core/fetch.ts`, `cache.ts`, `annotations.ts`, `prompts.ts`, `messages.ts`, `telemetry.ts`, `types.ts`, `util.ts` | Shared implementation, with forwarding exports at former paths |
| `src/native-operation-context.ts` | Trusted native settings, model adapter, workspace paths, identity and result/progress mapping |
| `src/native-identity.ts` | Native manifest discovery from source or packed output |
| `src/llm.ts` | Native authentication, model lookup, legacy/facade dispatch and provider request hooks |
| `src/tools/` | Native descriptions, registration, execution wrappers and rendering |

Each operation receives values rather than an `ExtensionContext` and returns `{ text, details, outcome }`. Execution failures throw; the three degraded research outcomes remain usable results. The native adapter retains its model-registry diagnostic and starts its spinner after successful preflight. It maps core results and progress to the existing native payloads.

Research accepts per-run page-fetch, documentation-download and optional staging-cleanup dependencies. New tests instantiate independent contexts; they do not mutate a shared engine harness, clock, process directory or host settings. The old native `__harness` remains only for existing compatibility tests. The core imports no host libraries and discovers no host configuration. Third-party fetch libraries and the generic schema library remain external dependencies. Their native peer treatment is unchanged; Phase 3 must declare the standalone runtime dependencies explicitly.

Search `domains` remain search guidance, not a network allowlist. Fetching, source ordering, caps, prompts and successful-result formatting retain their existing semantics. Native result text still names the `read` tool; host-appropriate standalone wording remains adapter work.

## Resilience Corrections

`callLlm()` now invokes `runModelWithPolicy()` from the core exactly once. Operations and `createNativeModelClient()` do not add transport retries. Native streams still receive `maxRetries: 0`; authentication, reasoning, payload patches and both dispatch paths remain native responsibilities. The no-links search retry remains separate.

Extraction exposed a classifier defect: any thrown provider exception was marked as an application timeout when the user signal was not aborted. The new policy marks only an actual timer expiry as a timeout. Permanent errors such as invalid credentials do not retry as timeouts; transient exceptions and error-bearing provider responses still use bounded backoff and available retry-delay hints. Tests cover both transports that reject and transports that resolve on timeout, plus cancellation during responses and retry delays.

Every native attempt now owns a separate citation sink. Successful citations are copied after bounded settlement, so a late read from a failed attempt cannot contaminate the successful response. A transport-hook regression test exercises that race. The earlier settlement test now drives the wrapped fetch instead of preloading the caller's sink with an artificial pending promise.

Cancellation propagates at stage boundaries and through cache-lock waits instead of becoming a degraded result. Active extraction workers settle before the pool reports failure. Non-cancellation per-page and cache-suggestion failures retain their graceful degradation.

The subsequent peer review exposed a pre-existing overlap defect in dependency console suppression. `src/core/console.ts` now assigns suppression to async-local scopes, installs one dispatcher while regions are active and restores console methods after the final region exits. Tests cover interleaved success and failure, identical tags in concurrent scopes, nested scopes and detached tasks. Console methods are still temporarily patched; unrelated async work passes through. The core's direct fetch debug line is removed, and native diagnostic prefixes remain outside the core.

Configured retry and timeout settings apply inside `intelli_research`. Native standalone search, extract and collate retain their one-attempt, no-application-timeout behaviour. Documentation now states that scope, and Phase 3 requires explicit policy defaults in the standalone adapter for all four operations without adding a second retry loop.

## Filesystem and Telemetry

Documentation downloads use a unique `llms-*` directory below `WorkspacePaths.stagingRoot`, normally `<workspace>/.search/.staging/`. They no longer use the operating-system temporary directory. Downloads run outside cache locks. Their writers settle before cleanup in `finally`, including user cancellation and cache-write failure, so a late writer cannot recreate the removed staging directory. Completed files are copied only after downloads settle. Optional staging setup and cleanup errors are logged without discarding the research result; both failure paths have deterministic regression coverage. Tests also verify that telemetry and documentation-discovery switches act independently. An empty staging parent may remain.

A failed cleanup can leave a `llms-*` directory. No automatic sweep is implemented: deleting a directory belonging to an active run would be unsafe. After all research processes using that cache root have stopped, inspect the path named by the cleanup diagnostic, correct its filesystem permissions and remove only the abandoned directory. Standalone recovery policy remains later work.

Native absolute and parent-relative cache settings remain supported; their staging directories follow the configured cache root and can therefore lie outside the workspace. This is not standalone containment validation. Traversal and symlink checks remain Phase 3 work.

Cache and index locking retain the per-cache-path then index-lock order. Lock waits accept cancellation. Telemetry refreshes also use the cache lock, but a non-cancellation telemetry lock or write failure remains diagnostic-only. Independent processes writing the same query and different queries retain readable reports and an intact index. Same-query runs refresh one directory; separate run histories are not promised.

Core telemetry construction requires injected package identity and does not read a nearby manifest. `extensionVersion` carries the supplied adapter version. Native records retain their exact legacy shape; non-native records additionally carry optional `packageName` and `adapter` fields. Mixed-record aggregation passes without changing the required schema fields. The native compatibility facade still exposes the former version and builder entry points. Fresh-tarball verification checks identity against the installed manifest.

## Verification

Verification ran on `plan/mcp-intelli-search`, starting from `c60c056`, on 2026-10-03. The runtime was [_Node.js_](https://nodejs.org/) `v24.19.0` and `Pi` `1.0.1`. Logs and scratch files are gitignored under `.tmp/mcp-phase2/`. The test total remains canonical in the root README badge.

| Check | Result | Scope |
|---|---|---|
| Baseline Build, Fixtures and Phase 1 Tests | Passed Before Editing | Established the extraction baseline |
| `npm run build` | Passed | Native and shared source compile |
| `npm test` | Passed | Existing coverage retained; new engine, policy, staging and cache tests |
| Contract Type Check | Passed | `node_modules/.bin/tsc -p test/tsconfig.native-contract.json`, including the new core tests |
| Frozen Native Fixtures | Passed Unchanged | All operation payloads, prompts, model requests, progress and cache files |
| Core Independence | Passed | Recursive source/declaration audit, isolated emitted-engine import with host resolution denied, and a fake-model search outside the host |
| Cancellation and Staging | Passed | Stage cancellation, retry delay, lock wait, partial documentation failure, cache-write failure and writer settlement before cleanup |
| Shared Cache | Passed | Same-query and distinct-query collation in independent child processes |
| Telemetry | Passed | Injected identity, native compatibility, disabled behaviour, fail-safe lock errors and mixed-record aggregation |
| `npm run test:smoke` | Passed | Isolated `PI_CODING_AGENT_DIR`; no real model-registration files modified |
| `./test/run-e2e-publish-local.sh` | Passed | Native tarball loads under plain Node.js, resolves fresh `pi-ai` `1.0.1`, and supplies installed-manifest identity |
| `./test/e2e/01_main.sh` | Passed | Live research completed with report, sources, extraction, index and all telemetry stage buckets |
| Shell Validation | Passed | Primary live script, shared live harness, modified fresh-install gate and aggregation script |

The isolation test permits only the declared non-host package families and their dependencies, while denying host package resolution. It does not pretend that a complete fetch engine needs no third-party libraries. The fresh-install gate verifies the native artifact; there is no standalone artifact yet.

The live scenario used the existing isolated harness and its configured models. Real credentials were read through that harness only; host credentials and settings were not changed. No release, staged publication or plugin installation occurred.

## Continuation

Start Phase 3 from the [handoff](README.md). Recheck the selected bundler and provider wire documentation before adding dependencies. Create `@curio-data/mcp-intelli-search` with explicit workspace, configuration, model roles and environment-referenced credentials. Call the shared operations directly and use the shared model policy once around the new transport. Keep native host libraries out of that package and standalone dependencies out of the native execution path.

Remaining gates include standalone configuration validation and filesystem containment, bundled-artifact installation, provider wire tests, protocol queueing and shutdown, plugin installation, the real minimum-host matrix and the full paced release suite. [Phase 2 Peer Review](PHASE-2-REVIEW.md) records two independent reviews, the adopted fixes, follow-up verdicts and final coordinator verification.
