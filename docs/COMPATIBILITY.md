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
| Local-tarball | Pre-publication evidence: plugins launched a vendored copy of the packed MCP tarball. Registry-pin installation is the separate post-publication class below. |
| Registry-pin | Post-publication evidence: plugins installed from the committed repository marketplaces launch the exact pinned version from the public registry through `npx`. Recorded once per published version. |

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
| Fetch assets | `wreq-js` 2.3.0, `defuddle` 0.19.4 | Independent tarball install gate exercises real page fetching through the installed native assets on Linux x86-64; other platforms are not verified. Earlier phases verified `defuddle` 0.16.0 |

## Host Plugins

| Host | Tested Version | Evidence |
|---|---|---|
| Claude Code | 2.1.289 | `claude plugin validate --strict` on plugin and marketplace; marketplace add, install, `claude mcp list` connection, `claude plugin details` skill discovery, and key delivery: the required sensitive `openrouter_api_key` option withholds the server while unset, reaches the server process as `OPENROUTER_API_KEY` over a different exported value, and is stored under `pluginSecrets` in `.credentials.json` on Linux (credential-free dummy values, local-tarball class). One-time observations on 2.1.289 (2026-10-05): with the option declared optional and unset, the server received an empty `OPENROUTER_API_KEY` that overrode an exported value, and `${user_config.KEY:-fallback}` is not supported, which is why the option is required; installation prints a needs-configuration notice rather than asking; `claude plugin configure --values-stdin` reports `Restart Claude Code to apply it`, and an already-open session kept its loaded value through `/mcp` reconnect until the operator set the key through `/plugin` Configure; uninstall emptied the plugin data directory. The documentation lists `--values-stdin` from 2.1.285. Real research through the installed plugin in a `claude -p` session on 2026-10-05: server connected, `intelli_research` called without a tool error, completed `mcp` sidecar in the project cache (credentialed host, local-tarball class). Registry-pin class, 2026-10-05, pinned version `0.15.0-alpha.0`: marketplace added from GitHub (`Curio-Data/pi-intelli-search`) into an isolated `CLAUDE_CONFIG_DIR`, plugin installed, key set through `claude plugin configure --values-stdin`, `config.json` written as the skill instructs, and `claude mcp list` connected through `npx -y --package @curio-data/mcp-intelli-search@0.15.0-alpha.0`. Qualified tool names observed in one credentialed session (one-time recorded). `${CLAUDE_PROJECT_DIR}` MCP `env` expansion is verified on this version only |
| Codex CLI | 0.144.5 | Repeatable credential-free installation checks; real research through the installed plugin in a `codex exec` session on 2026-10-05 with pre-approved plugin tools: completed `intelli_research` call and `mcp` sidecar (credentialed host, local-tarball class). Registry-pin class, 2026-10-05, pinned version `0.15.0-alpha.0`: marketplace added from GitHub into an isolated `CODEX_HOME`, `codex plugin add` installed from the committed catalog, `codex mcp list` shows `intelli_search` enabled on the `npx` pin, and a direct stdio `initialize` plus `tools/list` against the registry-pulled server returned all four `intelli_*` tools; separate one-time observations and exclusions listed below |

### Codex Evidence and Limits

- **Repeatable Checks:** Marketplace add, `codex plugin add` installation, installed-cache layout and `codex debug prompt-input` skill discovery use the credential-free, local-tarball evidence classes. `test/e2e/14_codex_plugin.sh` adds a real `codex exec` research session from a dedicated login.
- **Unattended Approval:** `codex exec` cancels a plugin MCP tool call that would prompt (`user cancelled MCP tool call`) even with `approval_policy = "never"`; `default_tools_approval_mode = "approve"` in the plugin's `mcp_servers` table allows it.
- **One-Time Observations:** The recorded credentialed session completed the MCP handshake and exposed qualified tool names. The 0.144.5 inspection found that the command-line interface (CLI) ignored the portable Agent Plugins layout; the shipped bundle uses the compatibility layout. See [Phase 5](plans/mcp-intelli-search/PHASE-5.md#codex-cli-01445).
- **Excluded Surfaces:** The terminal user interface (TUI) and integrated development environment (IDE) extension were not exercised. The Phase 5 record describes the IDE extension as lacking plugin support at that time; this is not a fresh compatibility check.

## Release Candidate Verification

The corrected candidate was verified on 2026-10-06, before publication:

| Surface | Observed Evidence |
|---|---|
| Native host | `Pi` 1.0.4: primary live research and the native scenarios pass; fresh tarball loading also resolves pi-ai 1.0.4 |
| Standalone package | Build, protocol/operation tests and independent production install pass on Node.js v24.19.0, Linux x86-64 |
| Fetch dependencies | Defuddle 0.19.4 and mathml-to-latex 1.8.0 with externally loaded xmldom 0.9.12; full dependency audit reports no advisories |
| Claude Code | 2.1.291: local-tarball installation and real research pass; the session's model-visible result contains the summary and cache appendix, closing F2's missing-answer observation |
| Codex CLI | 0.144.5: local-tarball installation, generated skill discovery and credentialed research pass |
| Paced live scenarios | Scenarios 1 to 4 and 6 to 9 passed before an interruption during scenario 10. Scenario 5 failed the non-empty-summary gate with a reasoning model at a 200-token cap; it was corrected to use the same non-reasoning collation model in both comparisons and passed on rerun with visible synthesis. Scenarios 10 to 14 completed in a paced continuation. One configuration recipe passed on retry after a timeout. The initial scenario 12 assertion still matched an old skill description; it was corrected to match the generated description and rerun successfully. No mandatory host check was skipped |

The candidate's exact versions are in the manifests, and its release gates are in [Release Readiness](RELEASE-READINESS.md). These are local-tarball observations, not verification of an unpublished registry pin. Repaired-configuration recovery is covered by deterministic CLI and protocol tests; the host's historical authentication-cache expiry was not retimed.

## Shared Constraints

- The committed plugin launchers pin the exact `@curio-data/mcp-intelli-search` version and download it through `npx` on first start: that route needs network access and Node.js 22 or later. The initial alpha is published under both `alpha` and `latest` as of the recorded registry check. The working candidate's regenerated pin is not published; keep it on a release branch until its MCP version resolves publicly. Publication and exact-pin host verification remain separate release gates.
- Full research calls have been driven through both host plugins in the local-tarball class (`test/e2e/13_claude_code_plugin.sh`, `test/e2e/14_codex_plugin.sh`). A full research call through the registry-pin route remains open evidence; the registry-pin class currently covers installation, connection and tool listing, plus a direct `npx` pull that runs the published CLI.
- Only [_OpenRouter_](https://openrouter.ai) is a verified standalone inference provider. Other OpenAI-compatible endpoints are not claimed: reasoning, search-tool and citation behaviour differs between compatible-looking endpoints.
- _macOS_ and _Windows_ are not verified for any artefact; the fetch dependency's native assets are exercised on _Linux_ x86-64 only.

The per-phase verification records behind this matrix live in the [implementation handoff](plans/mcp-intelli-search/README.md); `docs/plans/mcp-intelli-search/PHASE-5.md` records the empirical host findings in detail.
