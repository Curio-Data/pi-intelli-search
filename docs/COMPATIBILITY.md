# Compatibility Matrix

This document records host versions, artefacts and evidence classes for `intelli-search`. A version absent from this matrix has no recorded verification here. Declared ranges in the [native](../package.json) and [standalone](../packages/mcp/package.json) manifests govern compatibility requirements; this matrix records the checks performed, not a narrower support range. MCP means Model Context Protocol.

## Evidence Classes

| Class | Meaning |
|---|---|
| Deterministic | Offline tests that run in continuous integration (CI) on every change (unit, contract, protocol and packaging gates). |
| Live: `Pi` Host | Repeatable live scenarios through the native extension or `Pi`'s own MCP client (`test/e2e/`), consuming provider quota. |
| Live: credential-free host | Repeatable host installation checks that need no model session (`test/e2e/12_plugin_bundles.sh`). |
| Live: credentialed host | Repeatable real host sessions through an installed plugin, authenticated with a non-refreshing host token (`test/e2e/13_claude_code_plugin.sh`) or a dedicated separate login refreshed in place by one consumer (`test/e2e/14_codex_plugin.sh`), never a copied credential file. |
| One-time recorded | Credentialed host observations recorded once (2026-10-04). Not repeatable gates: copying Open Authorization (OAuth) credentials into disposable profiles invalidates refresh-token chains, so these checks are prohibited from re-run in that form. The credentialed host class replaces them where a non-refreshing token exists. |
| Local-tarball | Pre-publication evidence: plugins launched a vendored copy of the packed MCP tarball. Registry-pin installation is a separate post-publication gate and is not yet evidence. |

## Native `Pi` Extension (`@curio-data/pi-intelli-search`)

| Component | Tested Version | Evidence |
|---|---|---|
| `Pi` host (peer floor) | 0.81.1 | Real load check 2026-10-04: the branch build loads and `intelli_search` completes through the legacy provider dispatch path in a dependency-isolated install (Node.js v24.19.0); both dispatch paths also covered deterministically (`test/llm.test.ts`) |
| `Pi` host (facade boundary) | 0.86.0 | Real load check 2026-10-04: the branch build loads and `intelli_search` completes through the `ctx.modelRegistry.streamSimple()` facade in a dependency-isolated install; deterministic coverage of both dispatch paths |
| `Pi` host | 1.0.0 | Compatibility audited and verified 2026-10-02, including the `fetch`/`onPayload` request hooks against pi-ai 1.0.0 |
| `Pi` host | 1.0.1, 1.0.2 | Development hosts for the shared-engine phases; all entry gates and live scenarios |
| `Pi` as MCP client | 1.0.1, 1.0.2 | `test/e2e/11_mcp_stdio.sh`: real research through `Pi`'s MCP client against the standalone server (live `Pi` host class). Exact versions are recorded in [Phase 4](plans/mcp-intelli-search/PHASE-4.md#verification) and [Phase 6](plans/mcp-intelli-search/PHASE-6.md#verification) |

## Standalone MCP Server (`@curio-data/mcp-intelli-search`)

The software development kit (SDK) and native fetch assets are verified separately from host integration.

| Component | Tested Version | Evidence |
|---|---|---|
| Node.js | v24.19.0 | Development and verification runtime for all standalone gates |
| Node.js | 22 (floor) | `engines: >=22`; CI validates the aggregate build, test and install gates on Node 22 |
| MCP SDK | `@modelcontextprotocol/server` 2.3.0 (lockfile-pinned) | Protocol suite: initialization, tool listing, schema rejection, all four operations, degraded outcomes, progress, cancellation, queued cancellation, shutdown and clean stdio framing (deterministic) |
| Fetch assets | `wreq-js` 2.3.0, `defuddle` 0.16.0 | Independent tarball install gate exercises real page fetching through the installed native assets on Linux x86-64; other platforms are not verified |

## Host Plugins

| Host | Tested Version | Evidence |
|---|---|---|
| Claude Code | 2.1.289 | `claude plugin validate --strict` on plugin and marketplace; marketplace add, install, `claude mcp list` connection, `claude plugin details` skill discovery, and key delivery: the required sensitive `openrouter_api_key` option withholds the server while unset, reaches the server process as `OPENROUTER_API_KEY` over a different exported value, and is stored under `pluginSecrets` in `.credentials.json` on Linux (credential-free dummy values, local-tarball class). Real research through the installed plugin in a `claude -p` session on 2026-10-05: server connected, `intelli_research` called without a tool error, completed `mcp` sidecar in the project cache (credentialed host, local-tarball class). Qualified tool names observed in one credentialed session (one-time recorded). `${CLAUDE_PROJECT_DIR}` MCP `env` expansion is verified on this version only |
| Codex CLI | 0.144.5 | Repeatable credential-free installation checks; real research through the installed plugin in a `codex exec` session on 2026-10-05 with pre-approved plugin tools: completed `intelli_research` call and `mcp` sidecar (credentialed host, local-tarball class); separate one-time observations and exclusions listed below |

### Codex Evidence and Limits

- **Repeatable Checks:** Marketplace add, `codex plugin add` installation, installed-cache layout and `codex debug prompt-input` skill discovery use the credential-free, local-tarball evidence classes. `test/e2e/14_codex_plugin.sh` adds a real `codex exec` research session from a dedicated login.
- **Unattended Approval:** `codex exec` cancels a plugin MCP tool call that would prompt (`user cancelled MCP tool call`) even with `approval_policy = "never"`; `default_tools_approval_mode = "approve"` in the plugin's `mcp_servers` table allows it.
- **One-Time Observations:** The recorded credentialed session completed the MCP handshake and exposed qualified tool names. The 0.144.5 inspection found that the command-line interface (CLI) ignored the portable Agent Plugins layout; the shipped bundle uses the compatibility layout. See [Phase 5](plans/mcp-intelli-search/PHASE-5.md#codex-cli-01445).
- **Excluded Surfaces:** The terminal user interface (TUI) and integrated development environment (IDE) extension were not exercised. The Phase 5 record describes the IDE extension as lacking plugin support at that time; this is not a fresh compatibility check.

## Shared Constraints

- The committed plugin launchers pin the exact `@curio-data/mcp-intelli-search` version and download it through `npx` on first start: that route needs network access and Node.js 22 or later, and becomes installable only when the pinned version is published. Pre-publication installation uses the local-tarball evidence class.
- No full research call has been driven through either host plugin. Live MCP research is certified through `Pi`'s native MCP client only; per-host live research in _Claude Code_ and _Codex_ remains open evidence.
- Only [_OpenRouter_](https://openrouter.ai) is a verified standalone inference provider. Other OpenAI-compatible endpoints are not claimed: reasoning, search-tool and citation behaviour differs between compatible-looking endpoints.
- _macOS_ and _Windows_ are not verified for any artefact; the fetch dependency's native assets are exercised on _Linux_ x86-64 only.

The per-phase verification records behind this matrix live in the [implementation handoff](plans/mcp-intelli-search/README.md); `docs/plans/mcp-intelli-search/PHASE-5.md` records the empirical host findings in detail.
