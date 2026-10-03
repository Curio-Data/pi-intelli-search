# Cross-Host Research and Decisions

## Finding

Keep `intelli-search` in one repository, extract one host-independent research engine, and provide two execution interfaces: the existing native `Pi` extension and a standalone Model Context Protocol (MCP) server. Package the server as `@curio-data/mcp-intelli-search`. Provide thin plugin bundles for [_Claude Code_](https://code.claude.com/docs/en/plugins) and [_Codex_](https://developers.openai.com/codex/plugins) rather than separate research implementations.

The owner approved this direction and supplied the MCP package name on 2026-10-03. This record supports the [implementation plan](IMPLEMENTATION.md). It does not claim that the MCP server or plugins exist.

## Evidence Scope

Research used `intelli_research`, official documentation and the repository source at commit `7b7524af34cb0862a978aba2013e8eeb288e0f8a`. The installed `Pi` documentation was also read. The host version observed during planning was `Pi` 1.0.0.

The external documentation describes supported capabilities, not a successful installation of this project's future packages. No cross-host smoke test was performed during research. Package versions and test counts remain canonical in `package.json`, `CHANGELOG.md` and the README badge; this record does not duplicate them.

## Approved Decisions

| Decision | Consequence |
|---|---|
| One Implementation Repository | Keep source, tests, adapters and plugin packaging together. |
| Shared Research Engine | Search, fetch, extraction, collation, cache and resilience logic have one implementation. |
| Native `Pi` Interface Retained | MCP support does not replace the extension or force an upgrade to an MCP-capable host. |
| Existing Package Identity Retained | Continue distributing `@curio-data/pi-intelli-search`. |
| Separate MCP Package | Use exactly `@curio-data/mcp-intelli-search`; the earlier suggested alternative name is superseded. |
| Thin Host Plugins | Claude Code and Codex bundles supply installation metadata, MCP configuration and research guidance. |
| Local Transport First | Start with standard input/output (stdio). A hosted service and public directory submissions are separate work. |

The implementation plan specifies the proposed internal layout and acceptance gates. Those engineering details are planning choices, not already-verified capabilities.

## Host Distribution

### `Pi`

`Pi` packages remain ordinary npm or Git packages exposing extensions, skills and other resources through the `pi` manifest. The `pi-package` keyword makes a package eligible for the [package gallery](https://pi.dev/packages). The existing repository already supplies this manifest and keyword.

Current `Pi` documentation supports stdio and Streamable Hypertext Transfer Protocol (HTTP) MCP servers. It documents `pi mcp add`, `pi mcp list`, the interactive `/mcp` interface, and `pi.registerMcpServer()` for extension registrations. Project MCP configuration is trust-gated. MCP tools receive host-qualified names and can be directly exposed or discovered indirectly.

MCP is therefore an additional route into `Pi`, not a replacement for package distribution. The native extension retains access to the host's model registry, authentication, settings trust, prompt guidance, progress rendering and lifecycle events. Sources: [P1](#p1-pi-mcp), [P2](#p2-pi-packages), [P3](#p3-pi-extensions).

### Claude Code

A plugin can bundle skills, MCP configuration, hooks and other components. Its manifest is `.claude-plugin/plugin.json`; a marketplace catalog is `.claude-plugin/marketplace.json`. A marketplace can live in the plugin's own repository or in a separate catalog repository.

The documented interface includes the `/plugin` browser and these command forms:

```text
claude plugin marketplace add <owner>/<repo>
claude plugin install <plugin>@<marketplace>
```

Publishing a self-hosted marketplace does not require acceptance into Anthropic's official marketplace. The reviewed directory at `claude.ai/directory` and the official `claude-plugins-official` marketplace are different routes. The publishing documentation says the directory portal does not accept submissions to that official marketplace; partner contacts handle that route.

Plugin-relative command paths use `${CLAUDE_PLUGIN_ROOT}`. Installed plugin content must not depend on adjacent monorepo source files. A version-pinned package launcher avoids shipping another pipeline implementation inside the plugin. Sources: [C1](#c1-claude-code-plugins), [C2](#c2-claude-code-marketplaces), [C3](#c3-claude-code-publication).

### Codex

Current official documentation describes native plugins and a plugin browser, not only standalone skills and MCP configuration. The documented marketplace command is:

```text
codex plugin marketplace add <owner>/<repo>
```

The recommended portable plugin layout uses root-level `plugin.json`, `mcp.json` and `skills/`. OpenAI-specific extensions can be recorded in the manifest. The `.codex-plugin/plugin.json` compatibility layout remains supported. Portable `mcp.json` requires an explicit transport `type`; it is not merely a renamed Claude Code configuration file.

Repository marketplace discovery uses `.agents/plugins/marketplace.json`. Custom catalogs support local and remote sources. The official `openai/plugins` repository supplies examples, although its compatibility-layout examples are not the sole supported format.

Two limitations affect rollout:

- The documentation inspected explicitly states that the Codex integrated development environment (IDE) extension does not support plugins. Do not infer that plugin availability is uniform across all Codex surfaces.
- The documented public submission route for MCP-backed plugins expects a remote HTTPS endpoint, meaning HTTP secured with Transport Layer Security. A custom marketplace distributing a local stdio server is a separate route and does not prove eligibility for public-directory submission.

Sources: [O1](#o1-codex-plugin-support), [O2](#o2-openai-plugin-authoring), [O3](#o3-openai-examples).

## Model Access Boundary

MCP carries tool requests and results. It does not transfer the calling agent's provider registry, credentials or subscription entitlement to the server.

The MCP sampling specification states:

> clients make final model selection

Sampling is an optional client capability, model hints are advisory, and a client can map model hints to another provider's model. Consequently, sampling does not establish deterministic access to this pipeline's selected search, extract and collate models. Source: [M1](#m1-mcp-sampling).

The native `Pi` adapter should continue using the host registry and authentication. The MCP adapter needs separately configured inference access. Do not read Claude Code or Codex credential stores, assume subscription billing covers server-side calls, or silently substitute another provider.

A large language model (LLM) client abstraction is the important reuse boundary. Transporting the current extension object over MCP without replacing its `ExtensionContext` dependencies would leave the standalone server dependent on `Pi`.

## Repository Findings

| Source | Observation | Implementation Implication |
|---|---|---|
| `package.json` | The root package exports `src/index.ts` through `pi.extensions`, includes skills, and ships source and compiled output. Host libraries are peer dependencies. | Preserve the root package and entry points; add a separate MCP artifact. |
| `src/tools/intelli-research.ts` | Pipeline execution, host settings, model preflight, rendering and progress are in one module. | Extract execution without moving host rendering into the engine. |
| `src/llm.ts` | `callLlm()` resolves models and authentication through `ExtensionContext`; it also owns retries, timeout, reasoning and provider hooks. | Separate host dispatch from reusable resilience while keeping one retry owner. |
| `src/settings.ts` | Settings use `CONFIG_DIR_NAME`, project trust, cached host paths and migration state. | Keep host discovery and migration in the `Pi` adapter; pass resolved settings to the engine. |
| `src/types.ts`, `src/annotations.ts` | Even shared-looking modules import host types. | Check type imports and generated declarations as well as runtime imports. |
| `src/util.ts` | General helpers share a module with `getAgentDir()`. | Move host-directory discovery out of the shared dependency graph. |
| `src/cache.ts` | `makeCachePath()` accepts `cwd` but constructs its path from `cacheDir`; callers also use `settings.cacheDir` for locks and the index. | Introduce one explicit physical cache root rather than assuming the process directory is the workspace. |
| `src/tools/intelli-research.ts` | Documentation downloads stage through `tmpdir()`. | Give the shared engine a workspace-local staging root and clean it on every exit. |
| `src/telemetry.ts` | Version discovery assumes a fixed relative path from the module to `package.json`. | Inject package identity after extraction or bundling; keep legacy metadata fields readable. |
| `src/tools/shared.ts` | The cache appendix suggests the literal `read` tool. | Retain native wording where needed; use host-neutral guidance in MCP results. |
| `.github/workflows/ci.yml` | Validation includes a fresh tarball installation, not only compilation and unit tests. | Preserve this gate and add an independent MCP installation gate. |
| `.github/workflows/release.yml` | Publication stages only the root package after a published release event. | New-package release handling needs explicit routing and maintainer approval. |

These are source observations, not newly introduced defects. The implementation plan separates compatibility-preserving extraction from targeted portability fixes.

## Repository Boundary Assessment

| Option | Benefit | Cost | Decision |
|---|---|---|---|
| One Repository and One Package | Small initial packaging change | Mixes host peer dependencies with standalone server dependencies and installation behaviour | Reject |
| One Repository and Separate Packages | Atomic changes to engine, adapters and tests; independent installation boundaries | Requires explicit build and artifact checks | Adopt |
| Separate Implementation Repositories | Independent ownership and release administration | Shared-engine releases and cross-repository coordination for coupled changes | Defer |

An internal shared source directory is sufficient initially. Publishing a third core package is unnecessary until there is an external consumer. A separate Curio marketplace repository can later aggregate several products without owning their implementations.

## SDK Findings

The official [_TypeScript_ SDK](https://github.com/modelcontextprotocol/typescript-sdk), where SDK means software development kit, described its second major release line as stable when researched. It separates `@modelcontextprotocol/server` and `@modelcontextprotocol/client`; its stdio example imports `McpServer` from the server package and `StdioServerTransport` from `@modelcontextprotocol/server/stdio`. It supports Standard Schema-compatible schema libraries.

[Phase 0](PHASE-0.md#dependency-verification) subsequently verified registry availability, engine requirements and the request-context API, or application programming interface, through an isolated installed-package probe. Recheck the selected release before adding production dependencies. The earlier monolithic `@modelcontextprotocol/sdk` examples must not be mixed with split-package imports. Package registry resolution was not tested during the initial research but is now recorded in Phase 0. Interoperability with the installed agent clients remains untested. Source: [M2](#m2-typescript-sdk).

## Limitations and Rechecks

- Host installation commands and manifests were documented, not exercised with this project's future artifacts.
- The initial MCP SDK research did not establish the exact cancellation and progress callback signatures. Phase 0 closes that gap for its selected release through installed declarations and a synthetic executable probe; real-agent interoperability remains a later gate.
- Client timeout handling, workspace discovery and plugin environment interpolation require real-host tests.
- Direct MCP configuration and plugin installation must be documented separately. A plugin limitation does not by itself prove that the same host lacks MCP support.
- Search results included a third-party Codex marketplace CLI and unrelated vendor MCP integrations. They were excluded from the architectural evidence.
- Current `Pi` documentation includes `ctx.executeTool()`. At initial research, `AGENTS.md` and `docs/ARCHITECTURE.md` incorrectly treated the inability to call tools as a current universal limitation. The [cold-start handover review](HANDOVER-GLM.md) prompted correction of both files. Keep this pipeline self-contained for portability and older-host compatibility, not because newer hosts forbid nested calls.
- Historical local skills also contain obsolete advice about no native MCP support and the removed `pi-ai/compat` shim. Do not restore that shim; `test/compat-guard.test.ts` and the current registry-dispatch implementation remain authoritative.

## Sources

### P1 `Pi` MCP

[Official MCP documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md). The installed `docs/mcp.md` was read in full. Evidence: transports, configuration, exposure, progress timeout behaviour and extension registration.

### P2 `Pi` Packages

[Official package documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md). Evidence: manifests, discovery, installation and host-provided dependencies.

### P3 `Pi` Extensions

[Official extension documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md). Evidence: registry calls, tool rendering, nested tool execution and MCP registration.

### C1 Claude Code Plugins

[Plugin overview](https://code.claude.com/docs/en/plugins). Evidence: plugin components and discovery interface.

### C2 Claude Code Marketplaces

[Create a marketplace](https://code.claude.com/docs/en/plugins/create-marketplace). Evidence: catalog structure, same-repository distribution and installation commands.

### C3 Claude Code Publication

[Publish a plugin](https://code.claude.com/docs/en/plugins/publish). Evidence: self-hosted distribution, directory submission, path handling and updates.

### O1 Codex Plugin Support

[Codex plugins](https://developers.openai.com/codex/plugins). Evidence: plugin browser and host-surface limitations.

### O2 OpenAI Plugin Authoring

[Build plugins](https://developers.openai.com/plugins/build/plugins). Evidence: portable and compatibility layouts, marketplace commands, local distribution and public MCP submission requirements.

### O3 OpenAI Examples

[Official plugin repository](https://github.com/openai/plugins). Evidence: real plugin and marketplace layouts; not evidence that this project's plugin installs successfully.

### M1 MCP Sampling

[Sampling specification](https://modelcontextprotocol.io/specification/2025-11-25/client/sampling). Evidence: optional capability and advisory model preferences. This is the explicitly researched protocol revision, not a claim that it is the latest revision.

### M2 TypeScript SDK

[Official SDK repository](https://github.com/modelcontextprotocol/typescript-sdk) and [server reference](https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/server/). Evidence: current documented package split, stable-line statement and stdio registration example.

## Local Research Cache

These gitignored paths preserve the full research on the planning host. They are optional evidence aids, not dependencies of this handoff. Public sources and material findings are recorded above so a fresh clone is sufficient.

- `.search/2026-10-03-claude-code-official-plugins-discover-76219f/`
- `.search/2026-10-03-sitedevelopersopenaicom-codex-plugins-marketplace-codexplugin-0a5d9c/`
- `.search/2026-10-03-httpsmodelcontextprotocoliospecification20251125clientsampling-modelpreferences-hints-client-discretion-bd87e0/`
- `.search/2026-10-03-official-model-context-protocol-typescript-52b96e/`

Do not commit downloaded source pages, research credentials or cache contents. The broad MCP search at `.search/2026-10-03-mcp-server-tools-sampling-client-ecc55f/` did not answer the sampling question and is not used as evidence for that decision.
