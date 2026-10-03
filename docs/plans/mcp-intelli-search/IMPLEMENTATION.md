# MCP Implementation Plan

## Purpose

Implement `@curio-data/mcp-intelli-search` in this repository while preserving the native `@curio-data/pi-intelli-search` package. Extract one shared research engine, expose it through a Model Context Protocol (MCP) server, and provide installation bundles for [_Claude Code_](https://code.claude.com/docs/en/plugins) and [_Codex_](https://developers.openai.com/codex/plugins).

Read the [handoff](README.md) first and the [research record](RESEARCH.md) for approved decisions, sources and limitations. [Phase 0 results](PHASE-0.md) record the verified dependencies and native compatibility fixtures. [Phase 1 results](PHASE-1.md) record the implemented dependency contracts, native model adapter and explicit cache paths. [Phase 2 results](PHASE-2.md) record the shared operations, model policy, native adapter, documentation staging and telemetry identity. [Phase 3 results](PHASE-3.md) record the standalone runtime, configuration, provider transport and independent artifact verification. Phase 4 is the next implementation step. The remaining proposed paths, commands and interfaces below must be created and tested before they are documented as available.

## Scope

### Required Outputs

- One shared implementation of search, fetch, extract, collate and cache-suggestion behaviour.
- The existing native `Pi` package, with compatible installation, settings, authentication and tool contracts.
- A separately installable `@curio-data/mcp-intelli-search` package with a `mcp-intelli-search` executable.
- A local standard input/output (stdio) MCP server exposing the existing four `intelli_*` operations.
- Explicit inference-provider and workspace configuration that does not require a `Pi` installation.
- Thin Claude Code and Codex plugins containing manifests, MCP launch configuration and research guidance.
- Deterministic tests, fresh-install artifact tests and recorded real-host verification.
- Documentation distinguishing native extension installation, direct MCP configuration and plugin installation.

### Excluded Work

Do not introduce a hosted service, remote multi-tenant transport, account system, subscription credential bridge, mandatory MCP sampling, public-directory submission, repository rename or separately published core package. Do not replace the native `Pi` extension with `pi.registerMcpServer()`. Do not redesign fetching, change model defaults or add another search product as part of extraction.

A server-side inference adapter has a smaller initial provider scope than the native `Pi` registry. Document that boundary rather than claiming universal provider parity.

## Compatibility Contract

| Surface | Required Behaviour | Evidence or Test |
|---|---|---|
| Package Identity | Keep the root package name and existing `pi` manifest resource paths. | `package.json`; fresh tarball install |
| Extension Entry | Preserve `src/index.ts`, `dist/index.js` and the default factory export. | `test/smoke.ts`, `test/run-e2e-publish-local.sh` |
| Host Baseline | Retain the currently declared peer ranges; do not require native MCP on the extension path. | `package.json`, `test/llm.test.ts` |
| LLM Dispatch | Keep registry-facade dispatch and the older provider fallback, including system-prompt delivery. | `src/llm.ts`, `test/llm.test.ts` |
| Host Dependencies | Keep `Pi` libraries host-provided peers, never bundled into the extension. | Dependency graph and packed files |
| Native Tools | Preserve the four tool names, parameter schemas, descriptions, result content and details unless a separately documented change is approved. | Contract snapshots and adapter parity tests |
| Settings | Preserve nested keys, flat-key fallback, merge rules, trust gating and match-based migration. | `test/settings.test.ts`, configuration-recipe end-to-end test |
| Authentication | Preserve native registry authentication and model-registration behaviour. | `test/index.test.ts`, `test/providers.test.ts` |
| User Interface | Preserve progress rendering, working-indicator cleanup, status notifications and non-interactive operation. | Native adapter tests and host smoke |
| Research Semantics | Preserve source ordering, annotation merging, caps, prompts, truncation, degraded outcomes and optional cache suggestions. | Shared-engine fixtures and current tests |
| Cache | Preserve the report, query, source, extraction and index formats. Resolve physical paths explicitly without changing native display paths unintentionally. | Cache fixtures and workspace tests |
| Telemetry | Preserve existing fields and disabled behaviour; new identity fields are additive. | `test/telemetry.test.ts`, `test/research-telemetry.test.ts` |
| Cancellation | Propagate cancellation through network work, inference, queued work and cleanup. Do not convert user cancellation into a retry. | Abort and stalled-response tests |

The peer ranges in `package.json` govern native compatibility. Development dependency pins, installed host versions and versions resolved by the fresh-install gate serve different purposes; none independently raises that compatibility floor.

A deterministic fixture comparison must distinguish intended portability fixes from unintentional behaviour changes. Byte-for-byte equality is appropriate for stable schemas, prompts and fixture output; live model text is not deterministic.

## Proposed Layout

Keep the root package as the native `Pi` distribution. Add an npm workspace for the MCP artifact without relocating the root package or creating another public core package.

```text
package.json                     Existing Pi package; workspace/build scripts
package-lock.json                Single dependency lock
src/
  index.ts                       Existing Pi entry point
  llm.ts                         Pi dispatch adapter and compatibility exports
  settings.ts                    Pi file discovery, trust and migration
  providers.ts                   Pi model registration
  tools/                         Thin Pi registrations and renderers
  core/
    index.ts                     Host-independent entry point
    contracts.ts                 Operations, model calls, progress, results
    defaults.ts                  Shared tuning defaults
    schemas.ts                   Canonical tool parameter contracts
    operations/                  search, extract, collate, research
    llm.ts                       Shared retry/timeout policy
    fetch.ts                     Existing fetch behaviour
    cache.ts                     Cache paths, locks and artifacts
    telemetry.ts                 Identity supplied by adapter
    annotations.ts               Host-neutral citation parsing
    prompts.ts
    util.ts                      Host-neutral helpers only
packages/
  mcp/
    package.json                 @curio-data/mcp-intelli-search
    tsconfig.json                Standalone type check
    src/
      cli.ts                     Argument/environment parsing and startup
      server.ts                  MCP registration and result mapping
      config.ts                  Explicit provider/workspace configuration
      providers/                 Standalone inference adapters
    dist/                        Generated self-contained code bundle
    README.md
plugins/
  claude-code/                   Claude manifest, MCP launcher and skill
  codex/                         Portable manifest, MCP launcher and skill
.claude-plugin/marketplace.json   Claude catalog for this repository
.agents/plugins/marketplace.json Codex catalog for this repository
scripts/                         Build, packaging and validation helpers
```

Keep forwarding exports at old internal paths while tests and adapters migrate. Remove them only after all repository consumers have been checked; preserving the public entry points is mandatory. Do not duplicate functions in old and new locations.

The tree is a target, not a requirement to move every file in one commit. First introduce dependency seams, then move small groups of modules with tests. Phase 3 introduces `src/core/defaults.ts` for shared tuning values. Native model defaults and settings discovery remain in `src/settings.ts`; standalone model/provider selections are explicit.

### Build Boundaries

1. Keep the existing root TypeScript build and compiled entry path working. The root compiler currently includes `src/**/*.ts`; MCP-specific source belongs outside that tree.
2. Build the MCP executable as a Node.js ECMAScript module bundle that includes the internal `src/core/` source but externalises third-party runtime dependencies. A small build script using a verified bundler such as [_esbuild_](https://esbuild.github.io/) is sufficient; record the selected dependency and lockfile change.
3. Preserve native dependencies such as [`wreq-js`](https://github.com/sqdshguy/wreq-js) as external runtime packages so their installation assets are not lost. Declare every external dependency in the MCP package, even when workspace hoisting makes it available locally.
4. Do not make the MCP package depend on `@curio-data/pi-intelli-search` or any `@earendil-works/pi-*` package. The standalone artifact must neither install nor initialise an agent host.
5. Keep root extension builds free of MCP libraries. Inspect generated declarations as well as runtime imports for hidden host or server dependencies.
6. The MCP tarball must include its executable, required metadata, licence and notices. Do not ship an executable that imports `../../src/` from the checkout or relies on a workspace symlink.
7. Keep package version sources in their respective `package.json` files. Generate launcher version pins and other derived metadata; do not maintain hand-copied version strings across plugin files.
8. Preserve the root `build` and `test` commands. Add explicit aggregate and MCP-specific commands, then make continuous integration run all required gates. Document the command surface actually implemented rather than assuming workspace recursion builds the root.

## Shared Contracts

### Execution Context

The core must receive values, not an `ExtensionContext`. Define a small context containing:

- Resolved immutable research settings.
- A model client with explicit preflight and completion methods.
- An absolute workspace root, absolute cache root and workspace-local staging root.
- A separate cache display-path policy, preserving the existing native text where appropriate.
- An optional abort signal and typed progress callback.
- A logger that cannot write protocol data to standard output.
- Package identity for local telemetry and, where needed, injectable time/randomness for deterministic tests.

Use per-operation or per-server dependency injection. Do not extend the module-global `__harness` mutation pattern into the concurrent MCP runtime. Existing tests can retain compatibility seams temporarily while new tests instantiate an isolated engine.

### Model Calls

A core model request must carry the selected provider/model, system and user messages, token limit, reasoning policy, citation collection requirements and supported provider payload customisation. Its result must expose generated text and collected citations; preserve usage data when the provider supplies it rather than inventing counts.

The native adapter delegates to the current host registry path. The standalone adapter owns explicitly configured provider access. Neither adapter silently changes the requested model.

There must be one owner of retry, timeout and cancellation policy. Extract the reusable policy from `callLlm()` while retaining the current native transport behaviour. Disable retries in an underlying client when that client would otherwise compound the shared policy. Keep no-links search retry distinct from transport retry.

Retain these behaviours with focused tests:

- A system prompt reaches the actual provider request on both native dispatch paths.
- Provider errors, including error-bearing successful transport responses, become actionable failures.
- Rate-limit retry honours available retry-delay information.
- A stalled response body is bounded by the application timeout, not only a connection timeout.
- User cancellation is not classified as a retryable timeout.
- Citation collection is reset between attempts and settled before source merging.
- Search payload modification does not overwrite an existing tool array or leak provider-specific fields into other providers.

### Tool Schemas and Results

Maintain a canonical parameter contract for `intelli_search`, `intelli_extract`, `intelli_collate` and `intelli_research`. Use transport adapters or generated schemas rather than independently maintained copies. Verify the chosen MCP software development kit (SDK) accepts the schema bridge; do not assume a host TypeBox object implements the SDK's required schema interface.

Preserve native schema permissiveness during extraction. Stricter standalone validation belongs in the MCP adapter and must be documented and tested without narrowing the existing native contract silently.

Return host-neutral operation results from the engine. The native adapter maps them to the current `content` and `details`; the MCP adapter maps them to text content and useful `structuredContent`. Add an output schema only when all success, degraded and error shapes satisfy it. Do not return the full fetched pages through MCP by default.

Keep the distinction between completed, degraded and failed operations. Empty links or exhausted page extractions should preserve the documented degraded result rather than becoming a protocol crash. Preserve the selected SDK's distinction between malformed protocol requests, unknown operations and invalid tool arguments. The Phase 0 probe verified that its high-level tool input validation returns `isError: true`; do not force that case into a different protocol error shape. Executed operations that fail also use an MCP tool error result where appropriate.

### Progress and Concurrency

Translate engine progress into native updates or MCP progress notifications. Inspect the selected SDK's request context, progress token and cancellation interfaces before implementation. Send progress only through the supported protocol path; never write ad hoc text to standard output.

The native `executionMode` is not an MCP scheduler. Provide a bounded, cancellation-aware server queue, initially with one full operation active per server, while retaining the existing bounded extraction fan-out inside an operation. Keep different server processes safe through filesystem locking. Test queue cancellation and shutdown rather than relying on the calling agent to serialise requests.

Progress may reset a client's idle timeout, but it is not a universal guarantee against total request deadlines. Validate long-running calls in each target host and document any required client timeout configuration.

## MCP Configuration and Inference

### Configuration Contract

Implement explicit configuration without reading host credential stores or automatically trusting project files.

- The proposed executable is `mcp-intelli-search` with `--config` and `--workspace` options, plus `--help` and `--version`.
- Allow `INTELLI_SEARCH_CONFIG` and `INTELLI_SEARCH_WORKSPACE` as environment equivalents. Explicit command-line values take precedence.
- Require an explicit workspace root for the first MCP release. Canonicalise and validate it; do not silently use the plugin directory or package-manager launch directory.
- Require explicit provider and model selections for the three roles. Reuse shared tuning defaults, not an implicit paid provider choice.
- Keep credentials in environment variables referenced by name from configuration. Do not put keys in tool arguments, generated manifests, logs or telemetry.
- Do not automatically load `.pi/settings.json`, host `auth.json` files or arbitrary discovered project configuration. An explicitly selected configuration file is the initial trust boundary.
- Validate provider capabilities, required credentials, role assignments and settings before a paid pipeline call. A server can initialise and list tools without working provider credentials; a call should return an actionable configuration error before doing billable work.
- Distinguish the provider endpoint from fetched web URLs. Do not expose an unrestricted fetch or filesystem operation as an additional tool.

Define and document the exact configuration schema during Phase 3. Validate unknown keys and unsafe values deliberately. Avoid copying the permissive host-settings loader into a new standalone security boundary.

### Initial Provider Scope

Implement a standalone, explicitly selected [_OpenRouter_](https://openrouter.ai) adapter as the reference compatibility path because the existing pipeline tests exercise its search models, citations and web-search payload. Selecting it must require configuration; it is not an automatic fallback. This planning choice does not authorise changing host role bindings or sending unrelated work through OpenRouter.

Read the current provider request, reasoning and web-search documentation before implementation. Keep the provider dispatch interface extensible. Do not advertise support for all OpenAI-compatible endpoints unless each claimed request/response behaviour has tests; compatible-looking endpoints differ on reasoning, search tools and citations. Additional native provider adapters can be separate increments.

Preserve the native `Pi` adapter's existing multi-provider access. The MCP adapter's narrower first-release provider list must not reduce that capability.

An explicit configuration mapping for search, extract and collate is sufficient. Do not use optional client sampling as the only inference backend, inspect subscription credentials, or invoke another coding agent to obtain completions.

## Filesystem and Telemetry

### Workspace Ownership

Resolve all physical cache operations against one absolute root. Phase 1 corrects the previously ignored `cwd` argument to `makeCachePath()` and anchors both cache-writing tools' index, lock and artifact operations to the workspace. Preserve the regression cases where process working directory and workspace differ, and keep display paths separate.

Do not call `process.chdir()` per request. A long-running MCP server must not let one operation change another operation's path resolution.

For MCP, keep cache and staging paths inside the explicitly selected workspace by default. Reject traversal and symlink escapes rather than accepting model-supplied paths. Preserve native configuration behaviour separately; do not silently forbid an existing native absolute cache location during extraction.

Retain the established per-cache-path then index-lock ordering. Do not hold either lock across network or model calls. Test two processes sharing a cache root, the same query concurrently, distinct queries concurrently, cancellation and stale locks. Define the existing same-query refresh policy explicitly; it does not promise that both competing runs retain separate histories.

Move documentation-download staging out of the operating-system temporary directory. Use a unique directory below the workspace-local cache/staging root and remove it in `finally`, including partial extraction failure and cancellation. Test that no content or credentials land in an unrelated temporary directory.

### Result Access

The first release returns the concise summary plus workspace cache paths. It does not introduce remote resource serving. Confirm that the agent process can actually read those paths in every tested local installation; sandboxed or remote hosts cannot be assumed to share the server filesystem.

Preserve native appendix wording where compatibility requires it. MCP guidance should say to use the host's file-reading capability, not assume that every host has a tool literally named `read`.

### Identity and Privacy

Pass package name and version into telemetry construction. Keep the legacy `extensionVersion` field populated with the emitting adapter package's version for compatibility, and add optional package/adapter identity fields so MCP records are not mistaken for native extension records. Update aggregation tests to cover mixed records without changing the existing schema's required fields.

Do not read a version by walking relative to a bundled core module. Test both packed artifacts. Keep telemetry local-only and preserve `disableTelemetry`. Redact credentials and sensitive provider headers from all diagnostics.

## Phased Implementation

### Phase 0: Baseline and Dependency Verification

Completed evidence, fixture maintenance and remaining limitations are recorded in [Phase 0 Results](PHASE-0.md). Retain the checklist below as the scope of that checkpoint.

1. Read this directory, root `AGENTS.md`, `package.json`, `src/llm.ts`, `src/settings.ts`, all four tool modules, cache/telemetry helpers and current tests.
2. Check the working tree before editing. Do not discard unrelated changes. If a later agent resumes on another branch, locate or merge this planning branch rather than recreating a divergent plan.
3. Inspect current installed `Pi` MCP/package/extension documentation and relevant examples. Record any difference from the research; do not mechanically raise the extension baseline to use newer host features.
4. Verify the current stable MCP SDK in the package registry and its Node.js engine requirements. The research found split server/client packages; confirm this before adding dependencies. Read official stdio, schema, cancellation and progress examples from the selected release.
5. Run baseline build, unit tests and the existing primary live scenario. Run the fresh-install gate before refactoring packaging. Store local logs under gitignored `.tmp/` and do not commit secrets or downloaded sources.
6. Capture deterministic fixtures for tool parameter schemas, descriptions, prompts, native result details, cache files and telemetry. Cover all operations, not only the full pipeline.
7. Before the major refactor, run `scc` and record the affected modules. Do not build a semantic index without approval.

Exit gate: baseline failures are understood and recorded, the provider/SDK dependency choices have evidence, and compatibility fixtures exist. A failed baseline is not permission to ignore the failure in the final release gate.

### Phase 1: Dependency Seams

Completed interfaces, path corrections, verification and remaining boundaries are recorded in [Phase 1 Results](PHASE-1.md). Retain this checklist as the scope of that checkpoint.

1. Introduce host-neutral operation, progress, model and package-identity interfaces.
2. Split host types from data types; remove transitive host imports from the intended core boundary, including the annotation fetch type and agent-directory helper.
3. Keep host settings discovery and model registration in their existing adapter modules. Share only resolved values and appropriate pure helpers.
4. Add an adapter that delegates model calls to the existing native implementation before moving retry policy. This provides a small first checkpoint with no new server.
5. Introduce explicit physical cache-root handling and display-path policy with focused tests. Treat any changed path behaviour as a documented portability correction.

Exit gate: native fixtures still match; a core module can be imported in an isolated process without `Pi` packages.

### Phase 2: Shared Operations and Native Adapter

Completed implementation, deliberate resilience corrections and verification are recorded in [Phase 2 Results](PHASE-2.md). Retain this checklist as the scope of that checkpoint.

1. Move the four operation bodies into `src/core/operations/`. Retain the self-contained full pipeline and its distinct stage outcomes.
2. Move shared fetch, prompts, cache, annotation, telemetry and pure utility code into the core, using temporary forwarding exports where needed.
3. Extract retry/timeout policy behind the new model interface. Keep native provider request hooks, authentication and facade feature detection in the adapter.
4. Reduce `src/tools/*.ts` to schemas, descriptions, native execution context construction, result mapping and rendering.
5. Replace global test mutation with injected dependencies in new engine tests. Keep existing tests meaningful rather than deleting coverage after moves.
6. Apply workspace-local staging and telemetry identity changes with cancellation and packed-file tests.
7. Audit prompt text and source handling. Do not reinterpret `domains` as a guaranteed network allowlist; current filtering guides search rather than validating every fetched result.

Exit gate: all native checks and primary live scenario pass, stable fixture comparisons match, and the core dependency graph contains no host imports or global host-configuration discovery.

### Phase 3: Standalone Runtime and Package

Completed implementation, configuration, provider evidence and verification limits are recorded in [Phase 3 Results](PHASE-3.md). Retain the checklist below as the scope of that checkpoint. The independent install uses encrypted repository scratch and denies all ancestor resolution in both module systems instead of placing repository-derived files on an unrelated filesystem.

1. Add `packages/mcp/package.json`, the workspace lockfile entries, standalone type check and build script. Declare all external runtime dependencies explicitly.
2. Implement the proposed CLI and validated configuration contract, including explicit workspace and provider selection.
3. Implement the reference inference adapter with deterministic fake-transport tests for request construction, citations, errors, reasoning and search payloads. Apply explicit configured retry/timeout defaults at the standalone adapter boundary for all four operations, including the one-shot operations whose native requests omit them. Invoke the shared policy once; do not change native defaults or stack another retry loop.
4. Exercise the same shared operations outside `Pi` before adding protocol registration. Confirm no host configuration is read or written.
5. Build and pack the MCP artifact. Install it into a clean directory outside the repository dependency tree and run `--help`, `--version` and a fixture-backed operation.
6. Test the dependency's native fetch assets in the fresh install. A successful bundle build does not establish a usable browser-fingerprint fetch runtime.

Exit gate: an installed MCP package can run its engine without the root package, source checkout, workspace links, development dependencies or any `Pi` library.

### Phase 4: MCP Protocol

1. Register the four existing tool names through the selected SDK and canonical schemas.
2. Return concise text, structured fields and intentional error mapping. Keep protocol registration separate from CLI startup for testing.
3. Translate cancellation and progress, implement bounded queueing, and abort pending work on input closure or process termination.
4. Ensure standard output contains only protocol messages while connected. Send diagnostics to standard error, including dependency startup output. Do not solve this by corrupting the SDK's own output stream.
5. Set truthful tool annotations: research and collation write cache files and are not read-only; operations use external services and incur cost. Do not assert idempotence merely because a function can be called twice.
6. Test with the official client over a real child-process stdio connection. Include initialization, tool listing, schema rejection, all operations, degraded outcomes, progress, cancellation, queued cancellation, missing configuration, shutdown and clean protocol framing.
7. Verify long-duration calls with the native MCP client in `Pi`, separate from the extension path. Configure only isolated test profiles.

Exit gate: the installed artifact passes protocol tests, no logs leak to standard output, and all network/model work is bounded or abortable.

### Phase 5: Host Plugins and Guidance

1. Keep the existing native skill and produce host-appropriate guidance from a shared source or a generator. Do not maintain three independent workflow explanations.
2. Preserve the guidance to provide `focusPrompt`, choose research breadth deliberately, use the concise summary first, and inspect cached pages only when needed.
3. Account for host-qualified MCP tool names. Native `intelli_research` and a qualified MCP name are different declarations; generated examples must match observed names in each host.
4. Add the Claude Code plugin manifest, MCP launch configuration and repository marketplace. Validate the plugin with the current official validator and exercise marketplace installation.
5. Add the Codex portable plugin manifest, typed MCP configuration and repository marketplace. Verify current CLI/browser installation and installed-cache behaviour.
6. Prefer launchers referencing an exact version of `@curio-data/mcp-intelli-search`, rather than copying pipeline code into plugin directories. A pinned `npx` launcher is the proposed distribution path; test startup time and standard-output cleanliness. Explain cold-start network access and Node.js requirements.
7. Generate version pins from the MCP package metadata. For pre-publication tests, generate equivalent isolated manifests pointing at a local tarball; never publish a manifest that references an unavailable registry version.
8. Provide explicit configuration/workspace setup. Test each host's environment substitution rules; do not assume `${CLAUDE_PLUGIN_ROOT}`, `${PLUGIN_ROOT}` or environment expansion is interchangeable.
9. Keep the catalogs in this repository. Do not add an MCP package to the `Pi` manifest or silently enable both native and MCP tools.

Exit gate: plugins install from copied/generated artifacts with no sibling checkout paths, supply working research guidance, and use the same MCP implementation. Before-publication local-tarball tests and post-publication registry tests are labelled separately.

### Phase 6: Documentation, Integration and Release Readiness

1. Update `README.md` with distinct native, direct-MCP and plugin installation routes. Keep the existing native route prominent and unchanged.
2. Update `docs/ARCHITECTURE.md`, component attribution, package READMEs and `AGENTS.md` to match the new boundaries. Preserve the self-contained pipeline rationale clarified during the [cold-start handover review](HANDOVER-GLM.md); the outdated universal no-cross-tool claim has already been corrected.
3. Document initial MCP provider scope, separate inference billing, workspace setup, timeout requirements, local cache access, security limits and troubleshooting.
4. Extend continuous integration to build/type-check both artifacts, test the core/adapters/protocol, validate generated manifests and install both tarballs independently. Keep the existing native fresh-install gate.
5. Record a compatibility matrix with exact tested host versions and artifacts. Test the native minimum baseline, its legacy/facade dispatch boundary and the current host; use dependency-isolated installs where combinations cannot share a dependency tree. Do not claim support for untested plugin surfaces.
6. Run all existing live scenarios through the sequential runner before any release. Run new host scenarios with equivalent pacing, not in a parallel burst.
7. Review release-workflow changes separately. The existing workflow stages only the root package. Add explicit package selection and preserve manual staged-publication approval for each artifact; do not infer that the new package already has a trusted-publisher binding.
8. Record gate results and remaining blockers in the handoff. Leave public-directory submission and hosted service work outside this delivery.

Exit gate: the acceptance matrix below is satisfied or each blocked cell is explicit. A release remains blocked by an unexplained red gate, missing host evidence or missing publication approval.

## Acceptance Matrix

| Area | Required Proof |
|---|---|
| Core Independence | Static import/declaration checks and an isolated runtime import without host libraries |
| Native Parity | Stable fixture comparisons for schemas, prompts, details, cache and telemetry; existing tests retained |
| Native Versions | Real load checks on the declared baseline and current host; deterministic coverage of both model-dispatch paths |
| Model Configuration | Missing keys and unsupported models/capabilities fail before a paid pipeline call; no silent provider substitution |
| Inference Resilience | Rate limits, server errors, invalid credentials, malformed bodies, stream errors, stalled bodies and user abort |
| Source Handling | Prose and annotation deduplication, ordering, caps, no-links retries, partial extraction and degraded outcomes |
| Workspace Isolation | Process directory differs from workspace; plugin install directory remains untouched; traversal and symlink escape rejected on MCP path |
| Shared Cache | Independent processes run same/different queries without broken indexes, leaked staging files or reversed lock order |
| Protocol | Real child-process initialization/list/call flow; schema rejection; correct error/result shapes; clean standard output |
| Lifetime | Cancellation during fetch, extraction, retry delay, queued calls and cache work; shutdown leaves no runaway child/network work |
| Progress | Works with and without a supplied progress token; long calls tested against each actual client's timeout behaviour |
| Native Packaging | Existing fresh-tarball gate passes without checkout resolution |
| MCP Packaging | Fresh install has every dependency and native asset; no host packages or development-only runtime dependencies |
| Plugin Packaging | Installed copies and generated local-tarball launchers work independently of monorepo siblings |
| Guidance | Correct discovered tool names; `focusPrompt` guidance present; no host-specific `read` assumption in MCP instructions |
| Privacy | Credentials absent from logs, manifests, tool results and telemetry; no host credential-store reads on MCP path |
| Live Behaviour | Actual completed research and cache artifacts in each supported host, not merely a process exit code |
| Publication | Explicit approval, both artifacts selected intentionally, trusted-publisher setup verified, no direct publish bypass |

## Verification Commands

These are existing repository commands. Run from the repository root with temporary files confined to the encrypted workspace on this host:

```bash
mkdir -p .tmp/mcp-verification
export TMPDIR="$PWD/.tmp/mcp-verification"
npm run build
npm test
mkdir -p "$TMPDIR/smoke-agent"
PI_CODING_AGENT_DIR="$TMPDIR/smoke-agent" npm run test:smoke
./test/run-e2e-publish-local.sh
./test/e2e/01_main.sh
```

Run the full paced suite before a release:

```bash
./test/run-e2e-all.sh
```

Do not launch the live scenarios concurrently or immediately repeat them after a quota failure. Existing tests use live provider quota and read configured credentials through their documented harness. Keep logs private and record exact failure classification rather than repeatedly spending quota to obtain one green run.

Phase 3 adds `npm run build:all`, `npm run test:all`, `npm run build:mcp`, `npm run typecheck:mcp`, `npm run test:mcp` and `npm run test:mcp:install`. The final command builds, packs and independently installs the standalone artifact, then exercises the installed engine and native fetch assets. Protocol and host-smoke commands remain Phase 4 work. The fresh MCP gate must install a tarball with development dependencies omitted, outside root `node_modules` resolution. A workspace test alone is insufficient.

Run `shellcheck` on every new or modified shell script and execute each new end-to-end script to completion before committing it. Keep deterministic tests network-independent except for loopback fixture servers. Use free development-range ports for fixture listeners on this host.

## Release Controls

Root `AGENTS.md`, Section Release Policy, requires:

> The agent must never create a _GitHub_ Release or trigger `npm` publication without the user's explicit permission.

Root `AGENTS.md`, Section Creating a Release, also states:

> The agent must never attempt to approve a staged publish, even if given credentials.

Those constraints apply to both artifacts. Approval of this implementation direction is not approval to publish. Preserve the existing native version/default-history/lockfile/changelog checks when preparing its release. Add corresponding MCP metadata checks without making MCP version changes trigger native model migrations.

The new npm package's ownership, access and trusted-publisher configuration require maintainer confirmation before staging. Do not assume the existing package's binding covers another package.

## Incremental Review and Recovery

Use small reviewable increments: contract tests, dependency seams, operation extraction, cache corrections, standalone provider/runtime, protocol, plugin packaging, then documentation and release wiring. Each increment must leave the native build usable.

If MCP work fails a gate, retain the native package on the last verified implementation rather than routing native calls through an incomplete server. Do not delete failing tests or broaden peer ranges to hide a mismatch. Avoid a long-lived fork of the pipeline; fix the shared boundary or revert the affected extraction increment.

A completion report must list changed interfaces, actual test commands and results, tested host versions, packed artifact identities, untested surfaces and publication status. Mark a step blocked rather than complete when credentials, host tooling or approval are unavailable.
