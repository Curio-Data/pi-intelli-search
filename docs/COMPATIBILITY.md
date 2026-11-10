# Compatibility Matrix

This document records host versions, artefacts and evidence classes for `intelli-search`. A version absent from this matrix has no recorded verification here. Declared ranges in the [native](../package.json) and [standalone](../packages/mcp/package.json) manifests govern compatibility requirements; this matrix records the checks performed, not a narrower support range. MCP means Model Context Protocol; CLI means command-line interface.

The verification sections for 0.16.0 to 0.19.1 (Provenance Generation, Floor-Modernisation, 0.18.0, 0.19.0 and 0.19.1) originally cited local logs, probes and review reports in the gitignored `.tmp/` scratch folder. Scratch is not a durable citation target, and that material was never promoted to `evidence/`, so the citations were removed on 2026-11-09. Those sections keep their recorded verdicts but name no retained local witness. Where a section links an exact-commit CI run, that run and the public registry metadata remain checkable; the 0.16.0 and 0.17.0 live-suite and installation results have no remaining witness beyond this record. From 0.20.0 the witnesses are indexed in `evidence/`.

## Evidence Classes

| Class | Meaning |
|---|---|
| Deterministic | Offline tests that run in continuous integration (CI) on every change (unit, contract, protocol and packaging gates). |
| Live: `Pi` Host | Repeatable live scenarios through the native extension or `Pi`'s own MCP client (`test/e2e/`), consuming provider quota. |
| Live: Credential-Free Host | Repeatable host installation checks that need no model session (`test/e2e/12_plugin_bundles.sh`). |
| Live: Credentialed Host | Repeatable real host sessions through an installed plugin, authenticated with a non-refreshing host token (`test/e2e/13_claude_code_plugin.sh`) or a dedicated separate login refreshed in place by one consumer (`test/e2e/14_codex_plugin.sh`), never a copied credential file. |
| One-Time Recorded | Credentialed host observations recorded once (2026-10-04). Not repeatable gates: copying OAuth credentials into disposable profiles invalidates refresh-token chains, so these checks are prohibited from re-run in that form. The credentialed host class replaces them where a non-refreshing token exists. |
| Local-Tarball | Pre-publication evidence: plugins launched a vendored copy of the packed MCP tarball. Registry-pin installation is the separate post-publication class below. |
| Registry-Pin | Post-publication evidence: plugins installed from the committed repository marketplaces launch the exact pinned version from the public registry through `npx`. Recorded once per published version. |

## Native `Pi` Extension (`@curio-data/pi-intelli-search`)

| Component | Tested Version | Evidence |
|---|---|---|
| `Pi` Host (Historical Peer Floor) | 0.81.1 | Real load check 2026-10-04: that branch build loaded and `intelli_search` completed through the legacy provider dispatch path in a dependency-isolated install (Node.js v24.19.0); both paths had deterministic coverage then. This host is below the current peer floor |
| `Pi` Host (Historical Facade Boundary) | 0.86.0 | Real load check 2026-10-04: that branch build loaded and `intelli_search` completed through the facade in a dependency-isolated install; both dispatch paths had deterministic coverage then |
| `Pi` Host (Current Peer Floor) | 0.86.0 | Live `test/e2e/15_pi_floor.sh` passed on 2026-10-08 against implementation commit `a52bd31`: host-isolated pinned host (the extension's peer value imports resolve from the repository tree; the only such import, `CONFIG_DIR_NAME`, is identical across the supported range), completed native research, `search.linksReturned=1` and `search.annotationsHarvested=13` through the fetch-tee fallback. The host predates `onProviderStreamEvent`; the agent loop used `openrouter/minimax/minimax-m3`. Targeted implementation verification, not a full paced-suite result. The catalogue-hint fix (`3ddd9f7`) landed after this run and touches only the error path |
| `Pi` Host | 1.1.0 | Live `test/e2e/01_main.sh` passed on 2026-10-08 against implementation commit `a52bd31`: `fetch.succeeded=1`, `collate.summaryChars=1464`. Targeted implementation verification of native research only, not a completed full paced suite |
| `Pi` Host and MCP Client | 1.2.0 | Static interface audit and targeted research, followed by the [complete candidate suite](#0180-candidate-verification-2026-10-13). Local candidate execution, not published-package installation |
| `Pi` Host | 1.3.0 | Static interface audit, a type check against the shipped 1.3.0 declarations and live `test/e2e/01_main.sh` passed on 2026-10-16 against the 0.18.0 runtime (tree `a26040e`): completed outcome, `fetch.succeeded=1`, `collate.summaryChars=1302`; the agent loop used `kimi-coding/k3` on the provider's new Chat Completions endpoint. Targeted verification (see [`Pi` 1.3.0 Verification](#pi-130-verification-2026-10-16)), superseded for the 0.19.0 runtime by the [candidate verification](#0190-candidate-verification-2026-10-16) |
| `Pi` Host | 1.4.0 | Installed development host before the 1.5.0 audit. The [0.20.0 candidate record](#0200-candidate-verification-2026-11-02) documents a completed full paced live suite and a separate native fresh consumer resolving `pi-ai@1.5.0`; it does not identify the live suite's host version or a separate 1.4.0 static audit |
| `Pi` Host and MCP Client | 1.5.0 | Static interface audit, a type check against the shipped 1.5.0 declarations, the deterministic suite and targeted live research (native `01_main.sh` and MCP-client `11_mcp_stdio.sh`, both completed outcomes on 2026-11-03); see [`Pi` 1.5.0 Verification](#pi-150-verification-2026-11-03). Carries the 0.21.0 classifier alignment and the `PI_CHANGELOG.md` extension-updates file |
| `Pi` host | 1.0.0 | Compatibility audited and verified 2026-10-02, including the `fetch`/`onPayload` request hooks against pi-ai 1.0.0 |
| `Pi` host | 1.0.1, 1.0.2 | Development hosts for the shared-engine phases; all entry gates and live scenarios |
| `Pi` Host and MCP Client | 1.0.4 | Complete previous provenance-generation paced live suite; see [Provenance Generation Verification](#provenance-generation-verification) |
| pi-ai peer dependency | 1.1.0 | Independent native fresh-tarball installation and plain-Node smoke import pass on 2026-10-07; runtime loading, tool registration and package identity only, not a live pipeline on a newer `Pi` host |
| pi-ai peer dependency | 1.3.0 | Both candidate and merged-tree native fresh-tarball installations pass; see [candidate verification](#0190-candidate-verification-2026-10-16). This establishes installation and runtime loading, not live research through that consumer installation |
| `Pi` as MCP client | 1.0.1, 1.0.2 | `test/e2e/11_mcp_stdio.sh`: real research through `Pi`'s MCP client against the standalone server (live `Pi` host class) |

## Standalone MCP Server (`@curio-data/mcp-intelli-search`)

The software development kit (SDK) and native fetch assets are verified separately from host integration.

| Component | Tested Version | Evidence |
|---|---|---|
| Node.js | v24.19.0 | Development and verification runtime for all standalone gates |
| Node.js | 22 (floor) | `engines: >=22`; CI validates the aggregate build, test and install gates on Node 22 |
| MCP SDK | `@modelcontextprotocol/server` 2.3.1 (current lockfile) | Protocol suite: initialisation, server instructions, tool listing, schema rejection, all four operations, degraded outcomes, progress, cancellation, queued cancellation, shutdown and clean stdio framing (deterministic). Earlier phases verified 2.3.0 |
| Fetch assets | `wreq-js` 2.3.1, `defuddle` 0.19.4 (current lockfile) | Independent tarball install gate exercises real page fetching through the installed native assets on Linux x86-64; other platforms are not verified. Earlier phases verified `wreq-js` 2.3.0 and `defuddle` 0.16.0 |

## Host Plugins

| Host | Tested Version | Evidence |
|---|---|---|
| Claude Code | 2.1.289, 2.1.292, 2.1.293, 2.1.294, 2.1.296, 2.1.301, 2.1.302, 2.1.311, 2.1.316, 2.1.317, 2.1.319 | Credential-free installation and key-delivery checks; credentialed local-tarball research. Latest registry-pin installation, connection and skill discovery pass on 2.1.319; historical checks and evidence limits are recorded below |
| Codex CLI | 0.144.5, 0.160.1 | Credential-free installation and credentialed local-tarball research. Current-candidate zero-configuration startup, missing-key recovery and research pass on 0.160.1. Latest registry-pin installation, enabled-server listing and skill discovery pass on 0.160.1; the independent registry protocol probe is separate from the host's enabled listing |

The latest [registry-pin verification](#published-0220-registry-pin-verification-2026-11-09) covers both hosts. It does not establish full registry-pin research; earlier checks remain evidence for their recorded package and host versions.

### Claude Code Evidence and Limits

| Capability | Evidence | Limits |
|---|---|---|
| Installation and Skill Discovery | On 2.1.289: strict plugin/marketplace validation, marketplace add, install, `claude mcp list` connection and `claude plugin details` skill discovery | Credential-free dummy values, local-tarball class |
| Required Key Option | The server is withheld while `openrouter_api_key` is unset. Once set, it reaches the process as `OPENROUTER_API_KEY` over a different exported value and is stored under `pluginSecrets` in `.credentials.json` on Linux | Dummy-value check on 2.1.289; not a claim about every platform |
| Real Research | A `claude -p` session connected, called `intelli_research` without a tool error and wrote a completed `mcp` sidecar in the project cache (2026-10-05) | Credentialed host, local-tarball class; model-visible answer verification is separate in [Release Candidate Verification](#release-candidate-verification) |
| Registry Installation | Isolated `CLAUDE_CONFIG_DIR`, marketplace from `Curio-Data/pi-intelli-search`, plugin install, key via `--values-stdin`, configuration as instructed, and connection through the `npx` launcher: `0.15.0-alpha.0` on 2.1.289 (2026-10-05); published `0.15.0` on 2.1.292 (2026-10-07), plus a direct `--version` probe of the published package returning `0.15.0` | Registry-pin class; connection does not establish full research |
| Tool Names and Paths | Qualified tool names observed in one credentialed session; `${CLAUDE_PROJECT_DIR}` expansion in MCP `env` verified | One-time recorded on 2.1.289 only |

One-time setup observations on 2.1.289 (2026-10-05): an optional unset key option sent an empty `OPENROUTER_API_KEY`, overriding an exported value; `${user_config.KEY:-fallback}` was unsupported. These observations motivated the required option. Installation printed a needs-configuration notice rather than prompting. `claude plugin configure --values-stdin` reported `Restart Claude Code to apply it`; an open session retained its loaded value through `/mcp` reconnect until the operator set the key through `/plugin` Configure. Uninstall emptied the plugin data directory. Host documentation lists `--values-stdin` from 2.1.285, a documentation statement rather than a local check of that version.

### Codex Evidence and Limits

| Capability | Evidence | Limits |
|---|---|---|
| Installation and Skill Discovery | Marketplace add, `codex plugin add` installation, installed-cache layout and `codex debug prompt-input` skill discovery; registry-pin class: marketplace from `Curio-Data/pi-intelli-search` into an isolated `CODEX_HOME`, installation from the committed catalogue, `codex mcp list` showing `intelli_search` enabled on the `npx` pin, and a direct stdio `initialize` plus `tools/list` against the registry-pulled server returning all four `intelli_*` tools (2026-10-05, `0.15.0-alpha.0`) | Credential-free, both evidence classes |
| Real Research | A real `codex exec` session through the installed plugin with pre-approved plugin tools: completed `intelli_research` call and `mcp` sidecar (2026-10-05) | Credentialed host with a dedicated login, local-tarball class |
| Zero-Configuration Startup | On 0.160.1, a fresh local-tarball plugin session with no configuration, workspace or credential exports called `intelli_search` and received actionable missing-key guidance (2026-10-26) | Credentialed host, local-tarball class; proves startup and tool discovery, not provider access |
| Persistent Credential Recovery | On 0.160.1, `setup` received the key through standard input; a subsequent session with all three former exports unset and a non-default `XDG_CONFIG_HOME` completed research through `codex exec --cd` from a different directory and wrote the `mcp` sidecar in the selected working root (2026-10-26) | Credentialed host, local-tarball class; the no-restart credential-file check is deterministic |
| Unattended Approval | `codex exec` cancels a plugin MCP tool call that would prompt (`user cancelled MCP tool call`) even with `approval_policy = "never"`; `default_tools_approval_mode = "approve"` in the plugin's `mcp_servers` table allows it | Recorded on 0.144.5 |
| Plugin Layout | The 0.144.5 inspection found the CLI ignored the portable Agent Plugins layout; the shipped bundle uses the compatibility layout | One-time inspection |
| Excluded Surfaces | The terminal user interface (TUI) and integrated development environment (IDE) extension were not exercised | The Phase 5 record describes the IDE extension as lacking plugin support at that time; not a fresh compatibility check |

## `Pi` 1.2.0 Verification (2026-10-13)

The 0.18.0 minor identified in the [changelog](../CHANGELOG.md#pi-0180---2026-10-13) advances both packages because the changed schema lives in the shared core. The peer floor and model defaults are unchanged. The checks in this section predate publication; [MCP registry-pin verification](#published-0180-registry-pin-verification-2026-10-13) is recorded separately below. [Native registry installation](#published-0180-native-package-verification-2026-10-13) is also verified after publication.

The static audit compares installed `Pi` 1.2.0 interfaces with 1.1.0: the `model-registry.d.ts` declaration and the `pi-ai` `index.d.ts` barrel are byte-identical. The barrel's re-exported type modules did change: `pi-ai` relocated its model and compatibility declarations into provider schema modules, and `pi-coding-agent` added optional namespace `aliases` and tool `reachesTools` fields. The `onProviderStreamEvent`, `onPayload`, `ProviderRequestOptions.fetch`, `constrainedSampling` and tool-annotation interfaces used by the extension are unchanged. The [upstream breaking changes](https://github.com/earendil-works/pi/releases/tag/v1.2.0) to `before_agent_start`, theme schemas, `pi mcp list --json` resource reporting and run-start busy state (`ctx.isIdle()` and `pi.sendMessage()` while a run starts) affect no code path used by this extension.

The recorded live checks passed `test/e2e/01_main.sh` through the native extension and `test/e2e/11_mcp_stdio.sh` through `Pi`'s MCP client on 2026-10-13. These are targeted research checks, not a full paced-suite result or verification of every setting. `Pi` 1.2.0 no longer lists MCP resources while connecting.

The harness now separates research completion from the agent-loop exit code. `Pi` 1.2.0 print mode exits `1` when the final summary reaches its output-token limit, including after a completed research call. `test/e2e/lib.sh` accepts a fresh sidecar only when it records a completed outcome, successful fetch and nonempty synthesis, regardless of that exit code; it distinguishes a truncated attempt without that evidence. The MCP scenario applies the same completed-outcome predicate in its retry loop and separately checks report existence, adapter identity and completed outcome. The pinned floor-host scenario retains its exit-`0` gate. This harness adaptation does not change the extension's research result or guarantee a complete agent-loop summary.

[_OpenRouter_](https://openrouter.ai) personalisation filters the built-in chat catalogue before `models.json` entries merge, so the extension's registrations survive. Registration remains unconditional and does not establish account access; see [Native Model Registration](ARCHITECTURE.md#custom-model-registration) for the decision and metadata trade-off. The published [settings schema](https://pi.dev/schemas/settings.schema.json) permits extension namespaces without validating their contents; the [models schema](https://pi.dev/schemas/models.schema.json) accepts the registration shape. The native research schema adds `minimum: 1` for `maxUrls`, displayed as an `@minimum` constraint by `Pi` 1.2.0 codemode; the runtime default and configured upper cap are unchanged.

## `Pi` 1.3.0 Verification (2026-10-16)

The static audit compares installed `Pi` 1.3.0 interfaces with 1.2.0. The `model-registry.d.ts` declaration (`streamSimple` facade) and `extensions/types.d.ts` (`ToolDefinition`, `constrainedSampling`, the event unions and the `durationMs` seam) are byte-identical. The `pi-ai` `types.d.ts` adds one optional `argumentsError` field on tool calls; additive only. The `pi-ai` `index.d.ts` barrel drops the `utils/assistant-message-frame.ts` re-export, which the extension does not import, and `pi-coding-agent`'s barrel adds a `formatReadLineRange` export. The `onProviderStreamEvent`, `onPayload`, `ProviderRequestOptions.fetch` and `FetchFunction` types are unchanged. `remote-catalog-provider.js` and `provider-composer.js` are byte-identical, so the extension's unconditional `models.json` registrations for [_Perplexity_](https://docs.perplexity.ai) still merge after OpenRouter personalisation. The extension source type-checks cleanly against the shipped 1.3.0 declarations (`tsc` with `paths` mapped at the installed release, no emit), and the full deterministic suite passes.

The 1.3.0 [upstream release](https://github.com/earendil-works/pi/releases/tag/v1.3.0) moves the `kimi-coding` provider to [_OpenAI_](https://platform.openai.com/docs/api-reference/chat) Chat Completions at `https://api.kimi.com/coding/v1` and requires `models.json` base URL overrides for that provider to include `/v1`. K3 remains in the catalogue. Neither the extension nor its end-to-end harness writes a `kimi-coding` base URL override, so the requirement has no effect here; `test/e2e/lib.sh` still selects `kimi-coding/k3` as the agent-loop model when its key exists. `pi mcp list [--json]`, used by `test/e2e/11_mcp_stdio.sh`, is unchanged, and no print-mode exit-code behaviour changed.

The recorded live check passed `test/e2e/01_main.sh` on 2026-10-16 against the 0.18.0 runtime (tree `a26040e`, before the classifier alignment), with the agent loop on `kimi-coding/k3`, exercising the provider's new protocol: completed outcome, `fetch.succeeded=1`, nonempty synthesis (`collate.summaryChars=1302`) and pipeline stages on the OpenRouter defaults. This is a targeted research check of the host interfaces, not a full paced-suite result; live evidence for the 0.19.0 runtime is recorded in [0.19.0 Candidate Verification](#0190-candidate-verification-2026-10-16).

Three upstream changes were assessed as opportunities. Two are pure host behaviour and prompted no code change: malformed tool-call arguments now fail validation with the raw text shown to the model instead of silently running partially parsed arguments, and `--model` now prefers a credentialed provider when several providers offer the match. The third did prompt a change: the host's automatic retry now covers gateway `Unable to forward upstream stream` and `The service is temporarily unavailable` errors for its agent loop, and the extension's shared retry classifier was aligned with the full `Pi` 1.3.0 retry list, including the quota/billing fail-fast exclusions, in 0.19.0 (see the [changelog](../CHANGELOG.md#pi-0190---2026-10-17)). The peer floor remains `Pi` >= 0.86.0 and model defaults are unchanged.

## 0.22.0 Candidate Verification (2026-11-09)

Merge commit `71cce34`, which both release tags identify, passes both builds, all native and standalone deterministic tests, native-contract types, generated-file checks, [_ShellCheck_](https://www.shellcheck.net/), the dependency audit (0 vulnerabilities) and both independent fresh-tarball installations. Exact-commit [release-branch CI](https://github.com/Curio-Data/pi-intelli-search/actions/runs/42606775156) passes. The first attempt of the `main` run stopped only at the unpublished-catalogue-pin guard, as designed before publication, and its re-run passed after publication.

The full paced live suite ran on `Pi` 1.5.0 and passed 13 of 15 scenarios on `71cce34`, including both credentialed plugin sessions (_Claude Code_ 2.1.319, _Codex_ 0.160.1) and research on the pinned `Pi` 0.86.0 floor host with the fetch-tee citation channel live (`search.annotationsHarvested=36`). Both other scenarios passed in isolated re-runs on the same tree; no single serial run recorded all 15 green for this release.

- **`02_cap.sh`:** in the paced run the cap case's research completed, but the check of the agent-loop model's tool arguments failed: the model did not make exactly one `intelli_research` call with `maxUrls=12`. The trace was not retained, and the default case did not run. The isolated re-run, from a copy of the script that differs only in keeping its scratch directory, passed both cases.
- **`10_config_recipes.sh`:** the paced run exceeded the runner's 1,200-second per-script limit after completing recipe R7, as R8 started, so no R8 to R10 check ran. Two agent-loop invocations in that run (R1 and R6) were stopped at the per-call timeout after their research completed; their sidecars were accepted, but the stalls used part of the scenario's time, and the log does not show why the agent loop stalled. The isolated re-run passed all eight of the scenario's recipes (R1 and R4 to R10), including R9 (large-context collation) and R10 (bounded time and spend, with the 150,000-character cap proven on a page that exceeded it), in 24 minutes, which is longer than that limit. Recipes 2 and 3 run in `08_websearch_tool.sh` and `09_sonar_pro_search.sh`, which passed in the paced suite. Neither the paced nor the isolated log records a rate-limit error, but neither captures provider retries, so rate limiting is neither shown nor excluded. A later traced investigation on 2026-11-09 (`evidence/agents/2026-11-09-post-release/`) ran scenarios 01 to 12 and 15 in three all-at-once passes and one paced pass. Scenario 10 reached the 1,200-second limit in all four. No extension or agent-loop call ended in an error stop reason and no `Retry-After` header was recorded; the slow and failed runs came from agent argument errors, repeated research, slow successful calls, timeouts, semantic collation rejection and harness defects.

The durable local witnesses are indexed in `evidence/2026-11-09-0220-release-verification/verification-receipt.md`.

### Published `0.22.0` Registry-Pin Verification (2026-11-09)

Following maintainer approval, the registry records MCP publication at 11:50:36 Coordinated Universal Time (UTC); `latest` resolves to `0.22.0`, and registry metadata exposes signed provenance attestations. Both plugins install from the committed repository marketplaces into fresh profiles without copied login credentials, using a dummy inference key.

- **Claude Code 2.1.319:** the exact committed `npx` pin connects, and the installed plugin exposes its skill. The connection check ran from an isolated consumer directory with its own fresh npm cache, so `npx` resolved the registry package rather than the repository workspace.
- **Codex CLI 0.160.1:** the installed cache has the expected version, the pinned server is enabled, and prompt-input inspection discovers the skill at the versioned plugin-cache path. An enabled listing alone is not a connection check.
- **Independent Registry Launcher:** a fresh npm cache and an isolated consumer project resolve the executable under that cache's `_npx/`, not the repository workspace. Its manifest and `--version` identify the published package. A direct standard-input/output (stdio) probe verifies server identity, returns instructions naming `intelli_search`, and lists all four tools through `initialize` and `tools/list`. Standard output contains protocol frames only; standard error contains the expected startup banner, and the process exits cleanly.

Run from inside the repository, `npx` resolves the workspace's own linked package when its version satisfies the pin; the first launcher and _Claude Code_ connection checks did so and were repeated from the isolated consumer, each with its own fresh npm cache. These checks establish registry installation, skill discovery, connection and tool listing, not a full research call through the registry-installed package. Credentialed full-research checks remain in the local-tarball class.

### Published `0.22.0` Native Package Verification (2026-11-09)

Following maintainer approval, the registry records native publication at 11:57:35 UTC; `latest` resolves to `0.22.0`, and registry metadata exposes signed provenance attestations. `test/run-e2e-publish.sh 0.22.0` passes with `HOME`, `PI_CODING_AGENT_DIR`, npm cache and scratch isolated under repository `.tmp/`. The installed extension loads under plain _Node.js_, registers all four tools and its session-start subscription, and `ensureCustomModels()` is idempotent.

The downloaded tarball's SHA-1 matches registry metadata (`6cfc169a58fd980f694a505ae1cc4899e158544a`), and its README matches `pi.README.md` at `pi-v0.22.0` byte-for-byte. The tarball ships `PI_CHANGELOG.md` with its newest heading `## [0.22.0] - 2026-11-09`, and the manifest's `pi` object is intact: `extensions`, `skills`, `image` and `changelogPath` are all present. These checks establish published-package installation, runtime loading, README derivation and changelog packaging, not a live model call through the registry-installed native package.

## 0.21.0 Candidate Verification (2026-11-03)

Implementation merge `b076ffe` passes both builds, all native and standalone deterministic tests, native-contract types, generated-file checks, [_ShellCheck_](https://www.shellcheck.net/), the dependency audit and both independent fresh-tarball installations. The full paced live suite passes 14 of 15 scenarios, including both credentialed plugin sessions and research on the pinned `Pi` 0.86.0 floor host with the fetch-tee citation channel live. The config-recipes scenario timed out at its slowest recipe, free-tier pacing, after the suite's quota draw and passed completely, including that recipe, in an isolated re-run on the same tree; no single serial run recorded all 15 green for this release.

The first release-branch CI run failed only the new `PI_CHANGELOG.md` drift test: its depth-1 tagless checkout re-derived post-tag evidence links as tag-pinned instead of `main`-pinned, mechanically reproduced in a tagless local clone. Final release commit `5bc5e41` sets `fetch-depth: 0` in `.github/workflows/ci.yml`, matching `.github/workflows/release.yml`. Exact-commit [release-branch CI](https://github.com/Curio-Data/pi-intelli-search/actions/runs/41631666053) passes on `5bc5e41`; the `main` runs for both release commits stopped only at the unpublished-catalogue-pin guard, as designed before publication.

The durable local witnesses are indexed in `evidence/2026-11-03-0210-release-verification/verification-receipt.md`.

### Published `0.21.0` Registry-Pin Verification (2026-11-03)

Following maintainer approval, the registry records MCP publication at 14:10:02 Coordinated Universal Time (UTC); `latest` resolves to `0.21.0`, and registry metadata exposes signed provenance attestations. Both plugins install from the committed repository marketplaces into fresh profiles without copied login credentials, using a dummy inference key.

- **Claude Code 2.1.317:** the exact committed `npx` pin connects, and the installed plugin exposes its skill.
- **Codex CLI 0.160.1:** the installed cache has the expected version, the pinned server is enabled, and prompt-input inspection discovers the skill at the versioned plugin-cache path. An enabled listing alone is not a connection check.
- **Independent Registry Launcher:** a fresh npm cache and consumer directory resolve the executable under that cache's `_npx/`, not the repository workspace. Its manifest and `--version` identify the published package. A direct standard-input/output (stdio) probe verifies server identity, returns instructions naming `intelli_search`, and lists all four tools through `initialize` and `tools/list`. Standard output contains protocol frames only; standard error contains the expected startup banner, and the process exits cleanly.

These checks establish registry installation, skill discovery, connection and tool listing, not a full research call through the registry-installed package. Credentialed full-research checks remain in the local-tarball class.

### Published `0.21.0` Native Package Verification (2026-11-03)

Following maintainer approval, the registry records native publication at 14:16:47 UTC; `latest` resolves to `0.21.0`, and registry metadata exposes signed provenance attestations. `test/run-e2e-publish.sh 0.21.0` passes with `HOME`, `PI_CODING_AGENT_DIR`, npm cache and scratch isolated under repository `.tmp/`. The installed extension loads under plain _Node.js_, registers all four tools and its session-start subscription, and `ensureCustomModels()` is idempotent.

The downloaded tarball's SHA-1 matches registry metadata (`e1039a5b7173729d17f392f8f50588b8d3cb36ec`), and its README matches `pi.README.md` at `pi-v0.21.0` byte-for-byte. The tarball additionally ships `PI_CHANGELOG.md` with its newest heading `## [0.21.0] - 2026-11-03`, and the manifest's `pi` object is intact: `extensions`, `skills`, `image` and `changelogPath` are all present. The package provides the native notes consumed by `Pi` 1.5.0's Extension Updates display. Display requires a fresh session and a previously recorded older package version; these packaging checks do not exercise the panel. These checks establish published-package installation, runtime loading, README derivation and changelog packaging, not a live model call through the registry-installed native package.

## 0.20.0 Candidate Verification (2026-11-02)

Implementation merge `c9bc7f0` passes both builds, all native and standalone deterministic tests, native-contract types, generated-file checks, ShellCheck, dependency audits and both independent fresh-tarball installations. The native fresh consumer resolves `pi-ai@1.5.0`. All 15 mandatory scenarios in `test/run-e2e-all.sh` pass with none failed or skipped, including both credentialed plugin sessions and research on the pinned `Pi` 0.86.0 floor host. The agent loop uses native DeepSeek Flash except for the floor scenario's configured OpenRouter model.

Final release commit `eabb5d2` merges remote commit `0c39848`, which changes only download data and chart images. The build, native tests, dependency audit and scenario 01 pass again on that commit. Exact-commit [release-branch CI](https://github.com/Curio-Data/pi-intelli-search/actions/runs/41478445838) passes. Main's initial run failed only the unpublished-MCP-pin guard; [main CI](https://github.com/Curio-Data/pi-intelli-search/actions/runs/41478441179) passes after MCP publication, including that guard.

The durable local witnesses are indexed in `evidence/2026-11-02-0200-release-verification/verification-receipt.md`.

### Published `0.20.0` Registry-Pin Verification (2026-11-02)

Following maintainer approval, the registry records MCP publication at 16:20:21 Coordinated Universal Time (UTC); `latest` resolves to `0.20.0`, and registry metadata exposes signed provenance. Both plugins install from the committed repository marketplaces into fresh profiles without copied login credentials, using a dummy inference key.

- **Claude Code 2.1.316:** the exact committed `npx` pin connects, and the installed plugin exposes its skill.
- **Codex CLI 0.160.1:** the installed cache has the expected version, the pinned server is enabled, and prompt-input inspection discovers the skill at the versioned plugin-cache path. An enabled listing alone is not a connection check.
- **Independent Registry Launcher:** a fresh npm cache and consumer directory resolve the executable under that cache's `_npx/`, not the repository workspace. Its manifest and `--version` identify the published package. A direct standard-input/output (stdio) probe verifies server identity, returns instructions naming `intelli_search`, and lists all four tools through `initialize` and `tools/list`. Standard output contains protocol frames only; standard error contains the expected startup banner, and the process exits cleanly.

These checks establish registry installation, skill discovery, connection and tool listing, not a full research call through the registry-installed package. Credentialed full-research checks remain in the local-tarball class.

### Published `0.20.0` Native Package Verification (2026-11-02)

Following maintainer approval, the registry records native publication at 16:30:50 UTC; `latest` resolves to `0.20.0`, and registry metadata exposes signed provenance. `test/run-e2e-publish.sh 0.20.0` passes with `HOME`, `PI_CODING_AGENT_DIR`, npm cache and scratch isolated under repository `.tmp/`. The installed extension loads under plain Node, registers all four tools and its session-start subscription, and contains the expected source, build, skill and legal files. Tests, workflows and environment files are absent; host peer dependencies are not bundled.

The downloaded tarball's SHA-1 matches registry metadata (`09fa5ddd324feaf8c31d3539b46b8a71afbee677`), and its README matches `pi.README.md` at `pi-v0.20.0` byte-for-byte. These checks establish published-package installation, runtime loading and README derivation, not a live model call through the registry-installed native package.

## 0.19.1 Candidate Verification (2026-10-27)

Local witnesses for this section are not retained; see the note at the top of this page.

Candidate `18781d1` passes exact-commit [release-branch CI](https://github.com/Curio-Data/pi-intelli-search/actions/runs/40480082522), both builds, 609 native and 59 standalone deterministic tests, native-contract types, generated-file checks, ShellCheck, dependency audits and both independent fresh-tarball installations. The native consumer resolves `pi-ai@1.4.0`. This MCP-only patch leaves the native package at `0.19.0`; no native release is required.

Two serial full-suite attempts each passed 14 of 15 scenarios. The first exposed an archive-first cache-selector defect in scenario 05 after a successful retry; the corrected index-based selector has deterministic regression coverage, and scenarios 05 and 06 then passed on the same content. The second attempt passed every scenario except 05, whose attempts produced no completed sidecar after provider extraction timeouts. Every scenario therefore has a pass on the final content, but no single serial run achieved 15 of 15. The owner accepted that evidence scope for MCP staging and directed a future paced-parallel verification design rather than another serial rerun. Local-tarball plugin scenarios 12, 13 and 14 pass on the final content, including Codex zero-configuration startup, missing-key recovery and persistent-credential research.

### Published `0.19.1` Registry-Pin Verification (2026-10-27)

Following maintainer approval, the registry records MCP publication at 11:38:14 Coordinated Universal Time (UTC); `latest` resolves to `0.19.1`, and registry metadata exposes signed provenance. Both plugins install from the committed repository marketplaces into fresh profiles without copied login credentials, using a dummy inference key.

- **Claude Code 2.1.311:** the exact committed `npx` pin connects, and the installed plugin exposes its skill.
- **Codex CLI 0.160.1:** the installed cache has the expected version, the pinned server is enabled, and prompt-input inspection discovers the skill at the versioned plugin-cache path. An enabled listing alone is not a connection check.
- **Independent Registry Launcher:** a fresh npm cache and consumer directory resolve the executable under that cache's `_npx/`, not the repository workspace. Its manifest and `--version` identify the published package. A direct standard-input/output (stdio) probe verifies server identity, returns instructions naming `intelli_search`, and lists all four tools through `initialize` and `tools/list`. Standard output contains protocol frames only; standard error contains the expected startup banner, and the process exits cleanly.

These checks establish registry installation, skill discovery, connection and tool listing, not a full research call through the registry-installed package. Credentialed full-research checks remain in the local-tarball class.

## `Pi` 1.5.0 Verification (2026-11-03)

<a id="pi-150-verification-2026-11-03"></a>

The static audit compares installed `Pi` 1.5.0 interfaces with 1.4.0. `model-registry.d.ts` (`streamSimple` facade) is byte-identical. `extensions/types.d.ts` changes additively (injected `KeybindingHints`, a `blocked` option on inline custom components, persisted-entry `messageId`/`timestamp`); the extension uses none of the new surface, and `constrainedSampling` is unchanged. The `pi-ai` barrel drops its [_TypeBox_](https://github.com/sinclairzx81/typebox) re-exports; the extension imports `Type` from its own `typebox` dependency and only message/model types from `pi-ai`, so the removed re-exports do not affect these imports, and the extension source type-checks cleanly against the shipped 1.5.0 declarations (`tsc` with `paths` mapped at the installed release, no emit). `remote-catalog-provider.js` and `provider-composer.js` are byte-identical, so the `models.json` registrations still merge after OpenRouter personalisation, and `minimax/minimax-m3` survives the models.dev v2 catalogue under the `openrouter` group.

Tool-argument validation moved to `@earendil-works/pi-schema`, an upstream breaking change. The extension uses JSON-Schema-compatible [_TypeBox_](https://github.com/sinclairzx81/typebox) builders. A recorded probe compiled a schema shaped like `researchSchema` with the installed `@earendil-works/pi-schema` 1.5.0 validator using `compile(schema, { coerce: true })`: in the probed cases, extra properties remained accepted and numeric strings were coerced as before. Plain schemas without `additionalProperties` remain open; the closed-by-default rule belongs to pi-schema's own `obj()` builder, and validation-error wording changed. These checks do not establish equivalence for every schema or input. The trust fix (a saved "Do not trust" decision now honoured for auto-trust-eligible projects) makes the extension's `ctx.isProjectTrusted()` gate stricter and correct; `test/e2e/10_config_recipes.sh` pre-seeds `trust.json` and is unaffected.

The recorded live checks passed `test/e2e/01_main.sh` through the native extension and `test/e2e/11_mcp_stdio.sh` through `Pi`'s MCP client on 2026-11-03: the initial audit runs against the 0.20.0 runtime, then both scenarios again on the final 0.21.0 tree (completed outcomes, `fetch.succeeded=1`, `extensionVersion 0.21.0`), after restoring the full `pi` manifest object that the first implementation of the changelog wiring had accidentally replaced (a two-agent branch review caught it; the packed-tarball install gate now asserts the manifest's extension entries alongside the changelog). These are targeted research checks, not a full paced-suite result; the 0.21.0 release runs the paced suite before publication.

Two alignment changes ship in 0.21.0. The shared retry classifier is recaptured from `pi-ai` 1.5.0 (two new fail-fast patterns, six new retryable patterns, and the boundary-guarded status-code group verbatim; see the [changelog](../CHANGELOG.md#pi-0210---2026-11-03)). The new fail-fast classifications are reachable on the native path, where the host appends `error.error.metadata.raw` unescaped, but not through the standalone MCP adapter, whose OpenRouter wire client discards provider response bodies; a standalone usage-limit 429 retries until attempts run out, as `insufficient_quota` already did. Detecting future classifier drift requires `scripts/capture-retry-fixture.mjs --check` against the installed host; the deterministic parity gate never reads the host. The native package additionally ships a generated `PI_CHANGELOG.md` behind `pi.changelogPath`, making `Pi` 1.5.0's Extension Updates panel show the native changelog; the shipped `CHANGELOG.md` alone parses only its historical unprefixed sections.

## 0.19.0 Candidate Verification (2026-10-16)

Local witnesses for this section are not retained; see the note at the top of this page.

All 15 mandatory scenarios in `test/run-e2e-all.sh` pass on candidate `af7bf41`, with none failed or skipped, including research on the pinned `Pi` 0.86.0 floor host (fetch-tee citation recovery live, `search.annotationsHarvested=18`) and both credentialed plugin sessions. An earlier full paced run on `29f97ee` also passed 15 of 15; the candidate commit differs by the two-reviewer findings below. Both builds, native (607) and standalone (46) tests, native-contract types, generated-file checks and the dependency audit pass. The source also type-checks against the shipped `Pi` 1.3.0 declarations. Both fresh-tarball gates pass on the final tree: the standalone production install and the native local-tarball install, which resolves `pi-ai@1.3.0` as the peer.

A two-reviewer pass ran on the branch before this verification, spawned through herdr with provenance checked from the session files: code review by [_Claude Code_](https://code.claude.com) (Opus 5.5) and prose review by `pi/openai-codex/gpt-6.1-sol`. The applied findings are in `af7bf41` (word-bounded status codes, retained busy phrasings, the fixture parity gate, and corrections to the changelog, compatibility and architecture prose). At that candidate checkpoint, publication and registry-pin verification remained pending; the completed publication checks are recorded below.

On 2026-10-17, all 15 mandatory scenarios pass again on merged commit `129114f`, with none failed or skipped. Its executable source, tests, scripts and manifests are unchanged from `af7bf41`. Both builds, all deterministic tests, generated-file checks, the dependency audit and both independent fresh-tarball installations also pass on the merged commit. The native consumer resolves `pi-ai@1.3.0`. Exact-commit [release-branch CI](https://github.com/Curio-Data/pi-intelli-search/actions/runs/39024508290) passes, including the native-contract type check and [_ShellCheck_](https://www.shellcheck.net/). Before MCP publication, main's initial run stopped at the unpublished-MCP-pin guard and skipped the remaining steps; the same commit passes those steps in release-branch CI.

### Published `0.19.0` Registry-Pin Verification (2026-10-17)

Following maintainer approval, the registry records MCP publication at 20:02:39 Coordinated Universal Time (UTC); `latest` resolves to `0.19.0`, and registry metadata exposes signed provenance. Both plugins install from the committed repository marketplaces into fresh profiles without copied login credentials, using a dummy inference key.

- **Claude Code 2.1.302:** the exact committed `npx` pin connects, and the installed plugin exposes its skill.
- **Codex CLI 0.160.1:** the installed cache has the expected version, the pinned server is enabled, and prompt-input inspection discovers its skill. An enabled listing alone is not a connection check.
- **Independent Registry Launcher:** a fresh npm cache and consumer directory resolve the executable under that cache's `_npx/`, not the repository workspace. Its manifest and `--version` identify the published package. A direct standard-input/output (stdio) probe verifies server identity, returns instructions naming `intelli_search`, and lists all four tools through `initialize` and `tools/list`. The served `intelli_research` schema keeps the `maxUrls` minimum of 1 and the stated default of 10. Standard output contains protocol frames only; standard error contains the expected startup banner, and the process exits cleanly.

These checks establish registry installation, skill discovery, connection and tool listing, not a full research call through a registry-installed package. Credentialed full-research checks remain in the local-tarball class. Native registry installation is verified separately below.

### Published `0.19.0` Native Package Verification (2026-10-17)

Following maintainer approval, the registry records native publication at 20:18:44 UTC; `latest` resolves to `0.19.0`, and registry metadata exposes signed provenance. `test/run-e2e-publish.sh` passes against that explicit version with `HOME`, `PI_CODING_AGENT_DIR`, npm cache and scratch isolated under repository `.tmp/`. The installed extension loads under plain Node, registers all four tools and its session-start subscription, and contains the expected source, build, skill and legal files. Tests, workflows and environment files are absent; host peer dependencies are not bundled.

The downloaded tarball's SHA-1 matches registry metadata, and its README matches `pi.README.md` at `pi-v0.19.0` byte-for-byte. These checks establish published-package installation, runtime loading and README derivation, not a live model call through the registry-installed native package.

## 0.18.0 Candidate Verification (2026-10-13)

Local witnesses for this section are not retained; see the note at the top of this page.

All 15 mandatory scenarios in `test/run-e2e-all.sh` pass on candidate `5e74f96`, with none failed or skipped. The shipped runtime matches merge `879f6ee`; the intervening changes correct documentation and a test assertion. Both builds, native and standalone tests, native-contract types, generated-file checks, ShellCheck and the dependency audit pass. Both independent fresh-tarball installation gates passed on the merged runtime. [Exact-commit release-branch CI](https://github.com/Curio-Data/pi-intelli-search/actions/runs/38401566708) also passes. At that verification, main's CI failed only the unchanged unpublished-MCP-pin guard and neither candidate package was public.

| Surface | Observed Evidence | Limit |
|---|---|---|
| Native Current Host | `Pi` 1.2.0: all native scenarios and standalone research through its MCP client pass | Pipeline completion is not factual-answer validation |
| Native Floor Host | `Pi` 0.86.0: completed research, one search link, 11 recovered citations and nonempty synthesis | One floor-host scenario, not every setting |
| Claude Code | 2.1.296, requested model `sonnet`: all four routing/skill cases pass, including model-visible answers and completed comparison research | Local-tarball class; `Bash` is removed for controlled routing |
| Codex CLI | 0.160.1: completed plugin research and `mcp` cache identity through the dedicated profile | Local-tarball class, not registry-pin research |
| Page Budget | Scenario 02 passes with an explicit cap request and no default override, accepting absent or null raw `maxUrls`; fetched-page counts remain within the configured budget | The live count alone does not distinguish clamping from a short search result list |

The initial paced run had 14 passes and one failure: the default-budget assertion rejected a raw `maxUrls: null`. A captured retry reproduced it. The host emits raw tool arguments before removing optional nulls during validation; null therefore represents no override in this test. The corrected assertion retains exact cap arguments and rejects explicit default overrides, wrong types, missing calls and duplicate calls. Deterministic regression coverage and independent code review pass, followed by the complete fresh suite above. This is a test correction, not a runtime change.

In this suite the agent loop uses native DeepSeek Flash, except for the floor scenario's configured OpenRouter model; pipeline roles retain each scenario's configuration. Both credentialed plugin checks confirm the operator's credentials were untouched. At candidate verification, registry-pin installation remained a post-publication gate; its completed checks are recorded below. Later release-preparation commits need their own exact-commit CI result.

### Published `0.18.0` Registry-Pin Verification (2026-10-13)

The maintainer approved the staged MCP package. The registry records publication at 13:58:45 Coordinated Universal Time (UTC); `latest` resolves to `0.18.0` and registry metadata exposes signed provenance. The obsolete `alpha` dist-tag is removed; the historical alpha version remains available by explicit version. Both plugins install from the committed repository marketplaces into fresh profiles without copied login credentials, using a dummy inference key.

- **Claude Code 2.1.296:** the exact committed `npx` pin connects, and the installed plugin exposes its skill.
- **Codex CLI 0.160.1:** the installed cache has the expected version, the pinned server is enabled, and prompt-input inspection discovers its skill. An enabled listing alone is not a connection check.
- **Independent Registry Launcher:** a fresh npm cache and consumer directory resolve the executable under that cache's `_npx/`, not the repository workspace. Its manifest and `--version` identify the published package. A direct standard-input/output (stdio) probe verifies server identity, returns instructions naming `intelli_search`, and lists all four tools through `initialize` and `tools/list`. It also checks the new `maxUrls` minimum and corrected default description. Standard output contains protocol frames only; standard error contains the expected startup banner, and the process exits cleanly.

This establishes registry installation, skill discovery, connection and tool listing, not a full research call through a registry-installed package. The credentialed full-research checks remain in the local-tarball class.

### Published `0.18.0` Native Package Verification (2026-10-13)

The registry records native publication at 15:01:42 UTC following maintainer approval; `latest` resolves to the version at `pi-v0.18.0`, and registry metadata exposes signed provenance. `test/run-e2e-publish.sh` passes against that explicit version with `HOME`, `PI_CODING_AGENT_DIR`, npm cache and scratch isolated under repository `.tmp/`. The installed extension loads under plain Node, registers all four tools and its session-start subscription, and contains the expected source, build, skill and legal files. Tests, workflows and environment files are absent; host peer dependencies are not bundled.

The downloaded tarball's SHA-1 matches registry metadata, and its README matches `pi.README.md` at the native release tag byte-for-byte. These checks establish published-package installation, runtime loading and README derivation, not a live model call through the registry-installed native package.

<a id="current-candidate-verification"></a>
## Floor-Modernisation Verification

Local witnesses for this section are not retained; see the note at the top of this page.

The floor-modernisation generation merged to `main` at `99fea6f`. All 15 mandatory scenarios in `test/run-e2e-all.sh` passed on that commit on 2026-10-08, with none failed or skipped. Both packages in that generation are published. MCP registry-pin checks and native registry installation pass. The targeted implementation checks above remain separate from this merged-tree verification.

| Surface | Candidate Evidence | Remaining Limit |
|---|---|---|
| Native Floor Host | Pinned `Pi` 0.86.0: scenario 15 passes on `99fea6f`, with completed research, one search link, 43 recovered citations and non-empty synthesis through fetch-tee recovery | Floor-host coverage is one native scenario, not every setting or plugin route; it does not establish strict domain filtering |
| Native Host at That Verification | `Pi` 1.1.0: native scenarios and real research through the MCP client pass in the full suite | Does not independently establish interactive duration rendering or each metadata consumer |
| Claude Code | 2.1.294, Sonnet 5.5: all four scenario 13 cases pass, including model-visible factual answers, automatic and explicit skill loading, and completed comparison research | Local-tarball class; `Bash` is removed for controlled routing, not an unrestricted-shell evaluation |
| Codex CLI | 0.160.1: scenario 14 passes with a completed research tool call and `mcp` sidecar through the dedicated profile | Local-tarball class, not registry-pin research |
| Deterministic Gates | Both builds, native and standalone tests, native-contract types, generated gates, ShellCheck and dependency audit pass on `99fea6f` | Later release-preparation commits require exact-commit CI |
| Full Paced Live Suite | All mandatory scenarios pass on `99fea6f`, including credential-free plugin installation and the floor host | Local candidate execution; pipeline output checks do not establish factual accuracy |
| Packaging | Both independent fresh-tarball installs pass on `99fea6f`; native consumer installation resolves pi-ai 1.1.0 | Installation and runtime loading, not live research through the published native package |
| Registry Pins | The launchers at `mcp-v0.17.0` resolve the published package; the clean-profile checks below apply to that tag | Installation, skill discovery, connection and protocol checks, not full registry-pin research |

The native agent loop used [_DeepSeek Flash_](https://www.deepseek.com) except for the floor scenario's configured [_OpenRouter_](https://openrouter.ai) model; pipeline roles retained each scenario's model configuration. Both credentialed host checks confirmed the operator's credential files were untouched.

### Published `0.17.0` Registry-Pin Verification (2026-10-08)

The maintainer approved the staged MCP package. The registry records publication at 11:30:26 Coordinated Universal Time (UTC); `latest` resolves to the version at `mcp-v0.17.0`, with signed provenance. Both plugins install from the committed repository marketplaces into clean profiles without copied login credentials. Checks use a dummy inference key.

- **Claude Code 2.1.294:** the committed `npx` launcher connects, and the installed plugin exposes its skill.
- **Codex CLI 0.160.1:** the installed cache has the expected version, the exact pinned server is enabled, and prompt-input inspection discovers its skill. An enabled listing alone is not a connection check.
- **Independent Registry Launcher:** a fresh npm cache and consumer directory resolve the executable beneath that cache's `_npx/`, not the repository workspace. Its package identity and `--version` match the published pin. A direct standard-input/output (stdio) probe returns the expected server identity, routing instructions and all four tools through `initialize` and `tools/list`, then exits cleanly. Standard output contains protocol frames only; standard error contains the expected startup banner.

This is registry installation, connection and tool-listing evidence, not a full research call or proof that a host model received an answer. The credentialed full-research checks remain in the local-tarball class.

### Published `0.17.0` Native Package Verification (2026-10-08)

The registry records native publication at 11:52:19 UTC; `latest` resolves to the version at `pi-v0.17.0`, and registry metadata exposes its signed provenance attestation. `test/run-e2e-publish.sh` passes against that explicit version with `HOME`, `PI_CODING_AGENT_DIR` and scratch isolated under repository `.tmp/`. The installed extension loads under plain Node, registers all four tools and its session-start subscription, and contains the expected source, build, skill and legal files. Tests, workflows and environment files are absent; host peer dependencies are not bundled.

The downloaded tarball's SHA-1 matches registry metadata, and its README matches `pi.README.md` at the native release tag byte-for-byte. These checks establish published-package installation, runtime loading and README derivation, not a live model call through the registry-installed native package.

## Provenance Generation Verification

Local witnesses for this section are not retained; see the note at the top of this page.

The provenance correction passed that generation's local verification. Local-tarball checks do not establish registry availability. The provenance-generation MCP package is published; [the registry-pin verification below](#published-0160-registry-pin-verification-2026-10-08) records independent installation of the launchers committed at that release.

| Surface | Recorded Evidence | Remaining Limit |
|---|---|---|
| Native Host | `Pi` 1.0.4: complete paced suite on merged commit `5605a2a` passes on 2026-10-07 | Local candidate execution, not installation of the published native candidate |
| MCP Host | Real standalone research through `Pi`'s MCP client; completed `mcp` identity and cache; published registry-pin installation and protocol checks below | Full registry-pin research remains unverified |
| Output Budget | The paired non-reasoning collation check passes, including its tight limit | It establishes the configured size comparison, not a fixed result length including inventories |
| Claude Code | 2.1.293: neutral factual lookup, automatic and explicit skill invocation, and comparison research pass against the local tarball with Opus 5.5 during implementation and Sonnet 5.5 in the full release suite | `Bash` is removed for controlled routing; other host tools remain exposed. This is not an unrestricted-shell evaluation or a guarantee across models |
| Provenance | Comparison inventories independently match extraction counts; every listed file exists and its source header matches | Reference consistency is not factual accuracy or claim-level grounding |
| Deterministic and Packaging | Both builds, all tests, frozen native contracts, generated gates, audit and both independent tarball installs pass; implementation CI is linked from Release Readiness | Require exact-commit CI again for later edits |
| Codex Plugin | 0.160.1: scenario 14 passes on 2026-10-07 with the dedicated profile, completed research and `mcp` sidecar | Local-tarball class, not current-candidate registry-pin research |

The full paced runner completed on merged commit `5605a2a` on 2026-10-07 with every mandatory scenario passing and none failed or skipped. Pipeline models retain each scenario's configuration; the `Pi` agent loop used native DeepSeek Flash. Both independent fresh-install gates passed, including native resolution of pi-ai 1.1.0 after a transient upstream tarball 404. Exact-commit CI must validate subsequent release-preparation edits.

### Published Native Package Verification (2026-10-08)

At this verification, the native package's `latest` tag resolved to the version at release tag `pi-v0.16.0`, not the subsequently prepared native manifest version. The registry records publication at 07:41:48 UTC and exposes its signed provenance attestation. `test/run-e2e-publish.sh` passes against the explicit published version in a clean installation, with `HOME` and `PI_CODING_AGENT_DIR` isolated under repository `.tmp/`. The installed extension loads under plain Node, registers all four tools with the required shapes and subscribes to session startup. Expected source, build, skill and legal files are present; test, workflow and environment files are absent; host peer dependencies are not bundled.

The downloaded published tarball's SHA-1 matches registry metadata. Its README matches `pi.README.md` at the native release tag byte-for-byte, confirming that the publish hook shipped the native derivation rather than the repository README. These checks establish registry installation, package shape and runtime loading, not a live model call through the installed registry package.

### Published `0.16.0` Registry-Pin Verification (2026-10-08)

The maintainer approved the staged MCP package; the registry records publication at 07:27:25 UTC and, at this verification, `latest` resolved to the version at release tag `mcp-v0.16.0`, not the subsequently prepared MCP manifest version. Both host plugins were installed from the committed marketplaces fetched from `Curio-Data/pi-intelli-search` into fresh profiles. No host login credentials were copied, and the only inference credential used was a dummy plugin option.

- **Claude Code 2.1.293:** isolated `CLAUDE_CONFIG_DIR`, marketplace add, plugin install, required key option through `--values-stdin` and explicit configuration. `claude mcp list` shows `plugin:intelli-search:intelli_search` connected through the committed `npx` pin, and `claude plugin details` discovers the skill.
- **Codex CLI 0.160.1:** isolated `CODEX_HOME`, marketplace add, plugin install and forwarded variables. `codex mcp list --json` shows the server enabled with the committed pin; the installed plugin cache and `codex debug prompt-input` expose the current skill. Listing an enabled server is not itself a connection check.
- **Independent Registry Launcher:** a fresh npm cache and consumer directory resolve the executable under that cache's `_npx/`, not the repository workspace. `--version` returns the pinned version. A direct standard-input/output (stdio) probe against that registry-downloaded executable receives the expected server identity, routing instructions and all four tools through `initialize` and `tools/list`, then exits cleanly. The expected startup banner stays on standard error; standard output contains protocol frames only.

This is credential-free registry-pin installation, connection and tool-listing evidence, not a full research call or proof that a host model received a research answer. The first direct probe rejected the documented standard-error startup banner because its assertion was over-strict; the corrected assertion checks the exact banner, and the probe passed without changing package code.

## Release Candidate Verification

This section records the stable generation preceding the provenance corrections, not the later floor-modernisation generation. The table records paced live verification of the 2026-10-06 candidate commits. The full paced suite subsequently completed on the merged `main` tree (2026-10-07: 14 scenarios, 0 failed, 0 skipped) before either package was staged.

| Surface | Observed Evidence |
|---|---|
| Native host | `Pi` 1.0.4: primary live research and the native scenarios pass; fresh tarball loading also resolves pi-ai 1.0.4 |
| Standalone package | Build, protocol/operation tests and independent production install pass on Node.js v24.19.0, Linux x86-64 |
| Fetch dependencies | Defuddle 0.19.4 and mathml-to-latex 1.8.0 with externally loaded xmldom 0.9.12; full dependency audit reports no advisories |
| Claude Code | 2.1.291: local-tarball installation and real research pass; the session's model-visible result contains the summary and cache appendix, closing F2's missing-answer observation |
| Codex CLI | 0.144.5: local-tarball installation, generated skill discovery and credentialed research pass |

Paced live scenario history:

1. Scenarios 1 to 4 and 6 to 9 passed before an interruption during scenario 10.
2. Scenario 5 failed the non-empty-summary gate with a reasoning model at a 200-token cap; it was corrected to use the same non-reasoning collation model in both comparisons and passed on rerun with visible synthesis.
3. Scenarios 10 to 14 completed in a paced continuation. One configuration recipe passed on retry after a timeout.
4. The initial scenario 12 assertion still matched an old skill description; it was corrected to match the generated description and rerun successfully.

No mandatory host check was skipped. The versions for this historical candidate are recorded in its release tags and changelog entries. The floor-modernisation release tags identify that published generation; the manifests now identify the shared-schema generation recorded in the changelog. Repaired-configuration recovery is covered by deterministic CLI and protocol tests; the host's historical authentication-cache expiry was not retimed.

### Published `0.15.0` Registry-Pin Verification (2026-10-07)

After the maintainer approved the staged package (`latest` moved to `0.15.0` at 15:47 UTC), both host plugins were installed from the committed catalogues into clean profiles against the published pin, with no credentials beyond a dummy key option:

- **Claude Code 2.1.292:** isolated `CLAUDE_CONFIG_DIR`, marketplace added from `Curio-Data/pi-intelli-search`, plugin installed, dummy key option set, minimal configuration written; `claude mcp list` shows `plugin:intelli-search:intelli_search` connected through the committed `npx -y --package @curio-data/mcp-intelli-search@0.15.0` launcher.
- **Codex CLI 0.160.1:** isolated `CODEX_HOME`, marketplace added from the same GitHub source, plugin installed (installed-cache root at version `0.15.0`); `codex mcp list` shows `intelli_search` enabled on the same `npx` pin.
- **Direct stdio probe:** `initialize` plus `tools/list` against the registry-pulled server returned all four `intelli_*` tools; the probe also exercised the explicitly-selected-missing-configuration recovery path, serving the protocol with an actionable per-call configuration error rather than refusing connection.

Full research through the registry-pin route remains open evidence; the credentialed full-research scenarios (13 and 14) run in the local-tarball class and passed on this tree on 2026-10-07 (Codex on 0.160.1).

## Shared Constraints

- The committed plugin launchers pin the exact MCP manifest version and download it through `npx` on first start: that route needs network access and Node.js 22 or later. Current-main launchers resolve the published MCP pin, verified through the clean-profile checks above. Earlier checks remain historical evidence for their respective release tags. The registry-pin class covers installation, connection and tool listing; full registry-pin research remains separate evidence.
- Full research calls have been driven through both host plugins in the local-tarball class (`test/e2e/13_claude_code_plugin.sh`, `test/e2e/14_codex_plugin.sh`). A full research call through the registry-pin route remains open evidence; the registry-pin class currently covers installation, connection and tool listing, plus a direct `npx` pull that runs the published CLI.
- Only [_OpenRouter_](https://openrouter.ai) is a verified standalone inference provider. Other OpenAI-compatible endpoints are not claimed: reasoning, search-tool and citation behaviour differs between compatible-looking endpoints.
- _macOS_ and _Windows_ are not verified for any artefact; the fetch dependency's native assets are exercised on _Linux_ x86-64 only.


