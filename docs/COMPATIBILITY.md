# Compatibility Matrix

This document records host versions, artefacts and evidence classes for `intelli-search`. A version absent from this matrix has no recorded verification here. Declared ranges in the [native](../package.json) and [standalone](../packages/mcp/package.json) manifests govern compatibility requirements; this matrix records the checks performed, not a narrower support range. MCP means Model Context Protocol; CLI means command-line interface.

## Evidence Classes

| Class | Meaning |
|---|---|
| Deterministic | Offline tests that run in continuous integration (CI) on every change (unit, contract, protocol and packaging gates). |
| Live: `Pi` Host | Repeatable live scenarios through the native extension or `Pi`'s own MCP client (`test/e2e/`), consuming provider quota. |
| Live: Credential-Free Host | Repeatable host installation checks that need no model session (`test/e2e/12_plugin_bundles.sh`). |
| Live: Credentialed Host | Repeatable real host sessions through an installed plugin, authenticated with a non-refreshing host token (`test/e2e/13_claude_code_plugin.sh`) or a dedicated separate login refreshed in place by one consumer (`test/e2e/14_codex_plugin.sh`), never a copied credential file. |
| One-Time Recorded | Credentialed host observations recorded once (2026-10-04). Not repeatable gates: copying Open Authorization (OAuth) credentials into disposable profiles invalidates refresh-token chains, so these checks are prohibited from re-run in that form. The credentialed host class replaces them where a non-refreshing token exists. |
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
| `Pi` host | 1.0.0 | Compatibility audited and verified 2026-10-02, including the `fetch`/`onPayload` request hooks against pi-ai 1.0.0 |
| `Pi` host | 1.0.1, 1.0.2 | Development hosts for the shared-engine phases; all entry gates and live scenarios |
| `Pi` Host and MCP Client | 1.0.4 | Complete previous provenance-generation paced live suite; see [Provenance Generation Verification](#provenance-generation-verification) |
| pi-ai peer dependency | 1.1.0 | Independent native fresh-tarball installation and plain-Node smoke import pass on 2026-10-07; runtime loading, tool registration and package identity only, not a live pipeline on a newer `Pi` host |
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
| Claude Code | 2.1.289, 2.1.292, 2.1.293, 2.1.294, 2.1.296 | Credential-free installation and key-delivery checks; credentialed local-tarball research. Latest registry-pin installation, connection and skill discovery pass on 2.1.296; historical checks and evidence limits are recorded below |
| Codex CLI | 0.144.5, 0.160.1 | Credential-free installation and credentialed local-tarball research. Latest registry-pin installation, enabled-server listing and skill discovery pass on 0.160.1; the independent registry protocol probe is separate from the host's enabled listing |

The latest [registry-pin verification](#published-0180-registry-pin-verification-2026-10-13) covers both hosts. It does not establish full registry-pin research; earlier checks remain evidence for their recorded package and host versions.

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

Three upstream changes were assessed as opportunities. Two are pure host behaviour and prompted no code change: malformed tool-call arguments now fail validation with the raw text shown to the model instead of silently running partially parsed arguments, and `--model` now prefers a credentialed provider when several providers offer the match. The third did prompt a change: the host's automatic retry now covers gateway `Unable to forward upstream stream` and `The service is temporarily unavailable` errors for its agent loop, and the extension's shared retry classifier was aligned with the full `Pi` 1.3.0 retry list, including the quota/billing fail-fast exclusions, in 0.19.0 (see the [changelog](../CHANGELOG.md#pi-0190---2026-10-16)). The peer floor remains `Pi` >= 0.86.0 and model defaults are unchanged.

## 0.19.0 Candidate Verification (2026-10-16)

All 15 mandatory scenarios in `test/run-e2e-all.sh` pass on candidate `af7bf41`, with none failed or skipped, including research on the pinned `Pi` 0.86.0 floor host (fetch-tee citation recovery live, `search.annotationsHarvested=18`) and both credentialed plugin sessions. An earlier full paced run on `29f97ee` also passed 15 of 15; the candidate commit differs by the two-reviewer findings below. Both builds, native (607) and standalone (46) tests, native-contract types, generated-file checks and the dependency audit pass; logs are retained under gitignored `.tmp/release-019/` (`live-final.log`, `test-all.log`, `build-all.log`, `native-contract.log`, `ts-130.log`, `mcp-install-final.log`, `publish-local-final.log`). The source also type-checks against the shipped `Pi` 1.3.0 declarations (`ts-130.log`, exit 0). Both fresh-tarball gates pass on the final tree: the standalone production install and the native local-tarball install, which resolves `pi-ai@1.3.0` as the peer.

A two-reviewer pass ran on the branch before this verification, spawned through herdr with provenance checked from the session files: code review by [_Claude Code_](https://code.claude.com) (Opus 5.5) and prose review by `pi/openai-codex/gpt-6.1-sol`. Their reports are under `.tmp/agents/2026-10-16-pi130-review/reports/`; the applied findings are in `af7bf41` (word-bounded status codes, retained busy phrasings, the fixture parity gate, and corrections to the changelog, compatibility and architecture prose). Publication and registry-pin verification are post-publication gates and are not recorded here.

## 0.18.0 Candidate Verification (2026-10-13)

All 15 mandatory scenarios in `test/run-e2e-all.sh` pass on candidate `5e74f96`, with none failed or skipped. The shipped runtime matches merge `879f6ee`; the intervening changes correct documentation and a test assertion. Both builds, native and standalone tests, native-contract types, generated-file checks, ShellCheck and the dependency audit pass. Both independent fresh-tarball installation gates passed on the merged runtime. [Exact-commit release-branch CI](https://github.com/Curio-Data/pi-intelli-search/actions/runs/38401566708) also passes. At that verification, main's CI failed only the unchanged unpublished-MCP-pin guard and neither candidate package was public.

| Surface | Observed Evidence | Limit |
|---|---|---|
| Native Current Host | `Pi` 1.2.0: all native scenarios and standalone research through its MCP client pass | Pipeline completion is not factual-answer validation |
| Native Floor Host | `Pi` 0.86.0: completed research, one search link, 11 recovered citations and nonempty synthesis | One floor-host scenario, not every setting |
| Claude Code | 2.1.296, requested model `sonnet`: all four routing/skill cases pass, including model-visible answers and completed comparison research | Local-tarball class; `Bash` is removed for controlled routing |
| Codex CLI | 0.160.1: completed plugin research and `mcp` cache identity through the dedicated profile | Local-tarball class, not registry-pin research |
| Page Budget | Scenario 02 passes with an explicit cap request and no default override, accepting absent or null raw `maxUrls`; fetched-page counts remain within the configured budget | The live count alone does not distinguish clamping from a short search result list |

The initial paced run had 14 passes and one failure: the default-budget assertion rejected a raw `maxUrls: null`. A captured retry reproduced it. The host emits raw tool arguments before removing optional nulls during validation; null therefore represents no override in this test. The corrected assertion retains exact cap arguments and rejects explicit default overrides, wrong types, missing calls and duplicate calls. Deterministic regression coverage and independent code review pass, followed by the complete fresh suite above. This is a test correction, not a runtime change.

Logs are retained under gitignored `.tmp/release-018/`: `live.log` records the failed first suite, `cap-retry-trace.jsonl` records the reproduction, and `live-final.log` records the complete passing suite. Deterministic and installation logs are `gates.log`, `docs-gates.log` and `null-gates.log`; independent prose and code reviews are under `.tmp/agents/release-018/reports/`. The agent loop uses native DeepSeek Flash, except for the floor scenario's configured OpenRouter model; pipeline roles retain each scenario's configuration. Both credentialed plugin checks confirm the operator's credentials were untouched. At candidate verification, registry-pin installation remained a post-publication gate; its completed checks are recorded below. Later release-preparation commits need their own exact-commit CI result.

### Published `0.18.0` Registry-Pin Verification (2026-10-13)

The maintainer approved the staged MCP package. The registry records publication at 13:58:45 Coordinated Universal Time (UTC); `latest` resolves to `0.18.0` and registry metadata exposes signed provenance. The obsolete `alpha` dist-tag is removed; the historical alpha version remains available by explicit version. Both plugins install from the committed repository marketplaces into fresh profiles without copied login credentials, using a dummy inference key.

- **Claude Code 2.1.296:** the exact committed `npx` pin connects, and the installed plugin exposes its skill.
- **Codex CLI 0.160.1:** the installed cache has the expected version, the pinned server is enabled, and prompt-input inspection discovers its skill. An enabled listing alone is not a connection check.
- **Independent Registry Launcher:** a fresh npm cache and consumer directory resolve the executable under that cache's `_npx/`, not the repository workspace. Its manifest and `--version` identify the published package. A direct standard-input/output (stdio) probe verifies server identity, returns instructions naming `intelli_search`, and lists all four tools through `initialize` and `tools/list`. It also checks the new `maxUrls` minimum and corrected default description. Standard output contains protocol frames only; standard error contains the expected startup banner, and the process exits cleanly.

Evidence is retained under gitignored `.tmp/release-018/registry/`, `registry-verification.log` and `registry-protocol.json`. This establishes registry installation, skill discovery, connection and tool listing, not a full research call through a registry-installed package. The credentialed full-research checks remain in the local-tarball class.

### Published `0.18.0` Native Package Verification (2026-10-13)

The registry records native publication at 15:01:42 UTC following maintainer approval; `latest` resolves to the version at `pi-v0.18.0`, and registry metadata exposes signed provenance. `test/run-e2e-publish.sh` passes against that explicit version with `HOME`, `PI_CODING_AGENT_DIR`, npm cache and scratch isolated under repository `.tmp/`. The installed extension loads under plain Node, registers all four tools and its session-start subscription, and contains the expected source, build, skill and legal files. Tests, workflows and environment files are absent; host peer dependencies are not bundled.

The downloaded tarball's SHA-1 matches registry metadata, and its README matches `pi.README.md` at the native release tag byte-for-byte. Evidence is retained under `.tmp/release-018/native-registry-install.log`, `native-public-dist.json`, `native-publication.json` and `native-public/`. These checks establish published-package installation, runtime loading and README derivation, not a live model call through the registry-installed native package.

<a id="current-candidate-verification"></a>
## Floor-Modernisation Verification

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

Logs are retained under gitignored `.tmp/release-017/`, with the full paced output in `live.log`. The native agent loop used [_DeepSeek Flash_](https://www.deepseek.com) except for the floor scenario's configured [_OpenRouter_](https://openrouter.ai) model; pipeline roles retained each scenario's model configuration. Both credentialed host checks confirmed the operator's credential files were untouched.

### Published `0.17.0` Registry-Pin Verification (2026-10-08)

The maintainer approved the staged MCP package. The registry records publication at 11:30:26 Coordinated Universal Time (UTC); `latest` resolves to the version at `mcp-v0.17.0`, with signed provenance. Both plugins install from the committed repository marketplaces into clean profiles without copied login credentials. Checks use a dummy inference key.

- **Claude Code 2.1.294:** the committed `npx` launcher connects, and the installed plugin exposes its skill.
- **Codex CLI 0.160.1:** the installed cache has the expected version, the exact pinned server is enabled, and prompt-input inspection discovers its skill. An enabled listing alone is not a connection check.
- **Independent Registry Launcher:** a fresh npm cache and consumer directory resolve the executable beneath that cache's `_npx/`, not the repository workspace. Its package identity and `--version` match the published pin. A direct standard-input/output (stdio) probe returns the expected server identity, routing instructions and all four tools through `initialize` and `tools/list`, then exits cleanly. Standard output contains protocol frames only; standard error contains the expected startup banner.

Evidence is retained under `.tmp/release-017/registry/` and `.tmp/release-017/registry-verification.log`. This is registry installation, connection and tool-listing evidence, not a full research call or proof that a host model received an answer. The credentialed full-research checks remain in the local-tarball class.

### Published `0.17.0` Native Package Verification (2026-10-08)

The registry records native publication at 11:52:19 UTC; `latest` resolves to the version at `pi-v0.17.0`, and registry metadata exposes its signed provenance attestation. `test/run-e2e-publish.sh` passes against that explicit version with `HOME`, `PI_CODING_AGENT_DIR` and scratch isolated under repository `.tmp/`. The installed extension loads under plain Node, registers all four tools and its session-start subscription, and contains the expected source, build, skill and legal files. Tests, workflows and environment files are absent; host peer dependencies are not bundled.

The downloaded tarball's SHA-1 matches registry metadata, and its README matches `pi.README.md` at the native release tag byte-for-byte. Evidence is retained under `.tmp/release-017/native-registry-install.log` and `.tmp/release-017/native-public/`. These checks establish published-package installation, runtime loading and README derivation, not a live model call through the registry-installed native package.

## Provenance Generation Verification

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

The full paced runner completed on merged commit `5605a2a` on 2026-10-07 with every mandatory scenario passing and none failed or skipped. Pipeline models retain each scenario's configuration; the `Pi` agent loop used native DeepSeek Flash. Both independent fresh-install gates passed, including native resolution of pi-ai 1.1.0 after a transient upstream tarball 404. Release logs are retained under gitignored `.tmp/release-016/`; exact-commit CI must validate subsequent release-preparation edits.

### Published Native Package Verification (2026-10-08)

At this verification, the native package's `latest` tag resolved to the version at release tag `pi-v0.16.0`, not the subsequently prepared native manifest version. The registry records publication at 07:41:48 UTC and exposes its signed provenance attestation. `test/run-e2e-publish.sh` passes against the explicit published version in a clean installation, with `HOME` and `PI_CODING_AGENT_DIR` isolated under repository `.tmp/`. The installed extension loads under plain Node, registers all four tools with the required shapes and subscribes to session startup. Expected source, build, skill and legal files are present; test, workflow and environment files are absent; host peer dependencies are not bundled.

The downloaded published tarball's SHA-1 matches registry metadata. Its README matches `pi.README.md` at the native release tag byte-for-byte, confirming that the publish hook shipped the native derivation rather than the repository README. Logs and the downloaded README are retained under gitignored `.tmp/release-016/native-registry-install.log` and `.tmp/release-016/native-public/`. These checks establish registry installation, package shape and runtime loading, not a live model call through the installed registry package.

### Published `0.16.0` Registry-Pin Verification (2026-10-08)

The maintainer approved the staged MCP package; the registry records publication at 07:27:25 UTC and, at this verification, `latest` resolved to the version at release tag `mcp-v0.16.0`, not the subsequently prepared MCP manifest version. Both host plugins were installed from the committed marketplaces fetched from `Curio-Data/pi-intelli-search` into fresh profiles. No host login credentials were copied, and the only inference credential used was a dummy plugin option.

- **Claude Code 2.1.293:** isolated `CLAUDE_CONFIG_DIR`, marketplace add, plugin install, required key option through `--values-stdin` and explicit configuration. `claude mcp list` shows `plugin:intelli-search:intelli_search` connected through the committed `npx` pin, and `claude plugin details` discovers the skill.
- **Codex CLI 0.160.1:** isolated `CODEX_HOME`, marketplace add, plugin install and forwarded variables. `codex mcp list --json` shows the server enabled with the committed pin; the installed plugin cache and `codex debug prompt-input` expose the current skill. Listing an enabled server is not itself a connection check.
- **Independent Registry Launcher:** a fresh npm cache and consumer directory resolve the executable under that cache's `_npx/`, not the repository workspace. `--version` returns the pinned version. A direct standard-input/output (stdio) probe against that registry-downloaded executable receives the expected server identity, routing instructions and all four tools through `initialize` and `tools/list`, then exits cleanly. The expected startup banner stays on standard error; standard output contains protocol frames only.

Evidence is retained under gitignored `.tmp/release-016/registry/`, with the coordinator log at `.tmp/release-016/registry-verification.log`. This is credential-free registry-pin installation, connection and tool-listing evidence, not a full research call or proof that a host model received a research answer. The first direct probe rejected the documented standard-error startup banner because its assertion was over-strict; the corrected assertion checks the exact banner, and the probe passed without changing package code.

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


