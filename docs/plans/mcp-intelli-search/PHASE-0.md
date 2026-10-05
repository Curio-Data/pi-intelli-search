# Phase 0 Results

## Outcome

Phase 0 is complete for its defined scope: the native compatibility baseline is captured and the proposed Model Context Protocol (MCP) dependency surface is verified. The next implementation step is Phase 1, Dependency Seams, in the [implementation plan](IMPLEMENTATION.md#phase-1-dependency-seams).

Production source, package metadata and dependency lockfiles remain unchanged. This phase adds deterministic native fixtures, a fixture-maintenance command, an optional isolated SDK probe and continuation documentation. It does not create the shared engine, the `@curio-data/mcp-intelli-search` runtime or either host plugin.

## Provenance

- Planning branch: `plan/mcp-intelli-search`, pushed to `origin` before Phase 0 work.
- Starting commit: `886bf7c`.
- Production source captured by the fixtures: `7b7524af34cb0862a978aba2013e8eeb288e0f8a`, unchanged by the planning commit.
- Verification date: 2026-10-03.
- Planning host: Linux x86-64; Node.js `v24.19.0`; npm `11.17.0`; installed `Pi` `1.0.0`; local TypeScript compiler `5.9.3`.

The root package version remains canonical in `package.json`. The test total remains canonical in the root README badge. Local logs and temporary dependency installs live in gitignored `.tmp/mcp-phase0/` and are not required by the new native fixture tests.

## Dependency Verification

The [_TypeScript MCP SDK_](https://github.com/modelcontextprotocol/typescript-sdk), where SDK means software development kit, was checked through the npm registry and an isolated installation. No dependency was added to the root extension package.

| Package | Registry Version Observed | Declared Node.js Requirement | Decision |
|---|---|---|---|
| `@modelcontextprotocol/server` | `2.3.0` | `>=20` | Verified candidate for the standalone server |
| `@modelcontextprotocol/client` | `2.3.0` | `>=20` | Verified candidate for protocol tests |
| `@modelcontextprotocol/sdk` | `1.32.0` | `>=18` | Older monolithic line; not selected for new code |
| `esbuild` | `0.28.2` | `>=18` | Registry-verified bundler candidate; no bundle built in this phase |

Use the verified split-package line when implementing the server, subject to rechecking release status before installation. The SDK's minimum runtime is not proof that the complete future MCP package runs on every compatible Node.js version. Native fetch assets and host compatibility still need the planned fresh-install matrix.

The existing `wreq-js` manifest restricts supported operating systems and processor architectures. It must remain an external runtime dependency with its native assets installed. Workspace hoisting and bundling cannot substitute for the independent artifact test in Phase 3.

### Verified Interfaces

The installed declarations and a real child-process stdio probe establish the following interfaces for the selected SDK. Stdio means standard input/output.

| Concern | Verified Interface |
|---|---|
| Server Registration | `McpServer` from `@modelcontextprotocol/server` |
| Server Transport | `StdioServerTransport` from `@modelcontextprotocol/server/stdio` |
| Client Transport | `StdioClientTransport` from `@modelcontextprotocol/client/stdio` |
| Schema Bridge | `fromJsonSchema(schema)` from the server package converts JSON Schema to the required Standard Schema interface |
| Typed Tool Handler | With an input schema, the handler receives `(args, ctx)` |
| Cancellation | `ctx.mcpReq.signal`, not a presumed top-level `ctx.signal` |
| Incoming Progress Token | `ctx.mcpReq._meta?.progressToken` |
| Related Notifications | `ctx.mcpReq.notify({ method, params })` |
| Client Tool Call | `client.callTool(params, options)`; no older result-schema positional argument |
| Invalid Tool Arguments | The SDK probe returned a tool result with `isError: true` |

The synthetic probe validates initialization, listing, calling a tool, invalid input, a progress notification and cancellation observed by the server. It uses an `echo` operation, not the research pipeline. It does not establish interoperability with `Pi`, Claude Code or Codex, or prove the future package's shutdown and timeout behaviour.

The declarations also mark older push-style sampling as deprecated on the newer protocol path. The provider-owned inference decision therefore remains appropriate; do not build the new server around assumed client sampling support.

### Reproduction

The probe is checked in at [`test/probes/mcp-sdk.mjs`](../../../test/probes/mcp-sdk.mjs). Install the server and client package versions from the table into an isolated prefix, then pass that prefix to the probe. The verified command forms are:

```bash
mkdir -p .tmp/mcp-phase0/sdk
npm install --prefix .tmp/mcp-phase0/sdk \
  --ignore-scripts --no-audit --no-fund --save-exact \
  @modelcontextprotocol/server@2.3.0 \
  @modelcontextprotocol/client@2.3.0
node test/probes/mcp-sdk.mjs .tmp/mcp-phase0/sdk
```

These are development-only dependency checks. Do not add the SDK to the native package merely to run them. The probe is outside `test/*.test.ts` and does not run as part of normal unit tests.

### Research Corrections

The initial web extracts did not document the handler context and inferred that examples with one handler argument might imply no context parameter. The installed declarations and executable probe supersede that inference: a context argument exists, with the request-specific members listed above.

The plan originally grouped all invalid tool requests with protocol errors. The SDK distinguishes malformed protocol requests from invalid tool arguments and reports the latter as `isError` in the tested high-level interface. The implementation plan now preserves this distinction rather than requiring a conflicting custom error mapping.

Sources: [SDK server reference](https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/server/), [tool guide](https://ts.sdk.modelcontextprotocol.io/v2/servers/tools), installed package exports and declarations, and the checked-in probe. Registry output and the probe log are retained locally under `.tmp/mcp-phase0/`.

## Provider Evidence

[_OpenRouter_](https://openrouter.ai/docs/guides/features/server-tools/web-search) remains the explicitly selected reference adapter for the later standalone implementation. Its current documentation confirms the chat-completions endpoint, bearer-key authentication, the `openrouter:web_search` tool and non-streaming URL-citation annotations. The web-search tool is model-decided, so the no-links degraded-response path remains necessary.

No standalone provider client was implemented or verified. The broader reasoning/streaming search returned Responses API documentation rather than the required Chat Completions wire reference. Do not copy those event names or token-limit fields into the planned adapter. Phase 3 must verify the exact reasoning and streaming error shapes against the chosen endpoint before implementing it. Existing native provider tests and this phase's fake responses do not prove a new transport's wire compatibility.

Provider selection remains explicit. This work neither changes host role bindings nor introduces an automatic OpenRouter fallback.

## Native Fixtures

The fixture suite is [`test/native-contract.test.ts`](../../../test/native-contract.test.ts). Its [fixture guide](../../../test/fixtures/native-contract/README.md) defines every scenario, normalization rule and maintenance command.

The fixtures cover all four native operations, exact tool schemas and descriptions, prompt guidance, system prompts, native result details, model request construction, progress, citation merging, input truncation, source caps, cache files and local telemetry. Completed research includes related-cache suggestions; additional cases exercise a partial fetch and each degraded pipeline outcome.

The expected JSON files are static and independent of the implementation under test. Normal execution reads them but never rewrites them. The harness calls the real tool methods and native LLM dispatch around fake transport responses, where LLM means large language model. It uses isolated workspace/configuration directories and fails unexpected fetch URLs without making a network request.

A fixed synthetic clock removes elapsed-time variation without deleting time fields. Telemetry package identity is checked against `package.json` before replacing it with a release-independent marker. Two clean-directory runs produce identical research captures, and controlled mutations of actual tool metadata and executed result details are detected.

### Test Commands

```bash
node --import tsx --test test/native-contract.test.ts
node_modules/.bin/tsc -p test/tsconfig.native-contract.json
```

The separate type check includes the helper and generator because the production `tsconfig.json` only compiles `src/`. It prevents new test code from relying solely on the runtime transpiler.

Do not regenerate the fixtures to hide an extraction regression. Future intentional contract changes require a reviewed explanation and targeted tests. The fixture guide records the explicit regeneration command and its overwrite behaviour.

## Source Inventory

Before the refactor, `scc src test` reported 45 files, 13,960 lines and 10,499 code lines. The `src/` subset contained 16 TypeScript files, 4,866 lines and 3,243 code lines. These are the Phase 0 starting tree's measurements, not a rolling project-size claim.

The affected areas remain:

- `src/llm.ts`: host registry/authentication combined with retry, timeout, reasoning and citation hooks.
- `src/settings.ts`, `src/util.ts`: host directory discovery, trusted project settings and migration state mixed with reusable values/helpers.
- `src/types.ts`, `src/annotations.ts`: host type imports in otherwise reusable modules.
- `src/tools/*.ts`: operation execution combined with native registration and result rendering.
- `src/cache.ts`: relative physical paths despite the `cwd` parameter, plus process-shared lock/index operations.
- `src/telemetry.ts`: package-version lookup tied to module location.

No index was built and no source module was moved.

## `Pi` Documentation Check

The installed MCP, package and extension documentation and `examples/sdk/14-codemode-mcp.ts` were inspected. The findings agree with the planning record: native MCP is an additional interface, packages remain supported, host libraries should remain host-provided, and current extensions can execute nested tools.

The SDK example explicitly adds built-in MCP/discovery extensions to an SDK resource loader; those are not loaded automatically by an embedded session. This distinction matters for later host tests but does not justify embedding another `Pi` agent inside the standalone server.

The current host's nested-tool and MCP APIs must not raise the existing native package's minimum supported version. The old global no-cross-tool claim and historical compatibility-shim advice remain obsolete; the current source and compatibility guard tests take precedence.

## Verification

Verification results below apply to Phase 0 source and test changes only. They are not acceptance evidence for the unimplemented MCP package.

| Check | Result | Scope |
|---|---|---|
| Initial Build and Unit Suite | Passed | Starting branch before new fixtures |
| Initial Fresh Tarball Install | Passed | Existing package installed independently with current peer resolution |
| Final Fresh Tarball Install | Passed | Repeated after Phase 0 changes; native registration succeeds with freshly resolved peers |
| Final Build and Unit Suite | Passed | Native source plus added compatibility suite |
| Structural Smoke | Passed | Existing tool registration and structure |
| Contract Type Check | Passed | Fixture helper, tests and generator |
| Optional SDK Probe | Passed | Synthetic stdio/schema/progress/cancellation flow |
| Primary Live Scenario | Passed | Real native pipeline and completed cache/telemetry |
| Fixture Update Guard | Passed | Missing `--write` exits without changing any expected-file checksum |
| Formatting and Shell Validation | Passed | New executable/test files and the existing shell gates used in this phase |
| Documentation and Diff Checks | Passed | Relative links, prohibited punctuation and change scope |

The full paced release suite and minimum-host runtime matrix remain later release gates. No public release, npm staging or plugin-catalog publication is authorised by this phase.

## Continuation

Start Phase 1 with the fixtures in place. First introduce host-neutral contracts and an adapter that delegates to the existing native `callLlm()`. Keep the old tool entries and rendering intact. Separate host-directory discovery and type imports, then address physical cache roots and display paths with explicit compatibility tests.

There is no production refactor to resume and no MCP artifact to install. Do not skip directly to server scaffolding. Before editing, re-run the native fixture suite and inspect the working tree. Keep the frozen JSON unchanged for a behaviour-preserving extraction; explain and isolate any deliberate path correction.

The outstanding provider wire research belongs to Phase 3. Actual client interoperability, packed MCP installation and plugin environment/path behaviour belong to Phases 4 and 5. Those limitations do not block beginning Phase 1.
