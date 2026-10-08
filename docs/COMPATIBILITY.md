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
| Claude Code | 2.1.289, 2.1.292, 2.1.293 | Credential-free installation and key-delivery checks; real local-tarball research; registry-pin installation and connection for `0.15.0-alpha.0` (2026-10-05) and for published `0.15.0` (2026-10-07, 2.1.292). Capabilities and limits are itemised below |
| Codex CLI | 0.144.5, 0.160.1 | Credential-free installation checks, real research through the installed plugin, and registry-pin installation, connection and tool listing for `0.15.0-alpha.0` (2026-10-05) and published `0.15.0` (2026-10-07, 0.160.1); full credentialed local-tarball research also passed on 0.160.1 (2026-10-07). Capabilities and limits are itemised below |

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

## Current Candidate Verification

The floor-modernisation candidate is merged to `main` at `99fea6f`. All 15 mandatory scenarios in `test/run-e2e-all.sh` passed on that commit on 2026-10-08, with none failed or skipped. Both manifest versions are published. MCP registry-pin checks and native registry installation pass. [Release Readiness](RELEASE-READINESS.md#current-candidate) records owner approval and the completed release gates. The targeted implementation checks above remain separate from this merged-tree verification.

| Surface | Candidate Evidence | Remaining Limit |
|---|---|---|
| Native Floor Host | Pinned `Pi` 0.86.0: scenario 15 passes on `99fea6f`, with completed research, one search link, 43 recovered citations and non-empty synthesis through fetch-tee recovery | Floor-host coverage is one native scenario, not every setting or plugin route; it does not establish strict domain filtering |
| Native Current Host | `Pi` 1.1.0: native scenarios and real research through the MCP client pass in the full suite | Does not independently establish interactive duration rendering or each metadata consumer |
| Claude Code | 2.1.294, Sonnet 5.5: all four scenario 13 cases pass, including model-visible factual answers, automatic and explicit skill loading, and completed comparison research | Local-tarball class; `Bash` is removed for controlled routing, not an unrestricted-shell evaluation |
| Codex CLI | 0.160.1: scenario 14 passes with a completed research tool call and `mcp` sidecar through the dedicated profile | Local-tarball class, not registry-pin research |
| Deterministic Gates | Both builds, native and standalone tests, native-contract types, generated gates, ShellCheck and dependency audit pass on `99fea6f` | Later release-preparation commits require exact-commit CI |
| Full Paced Live Suite | All mandatory scenarios pass on `99fea6f`, including credential-free plugin installation and the floor host | Local candidate execution; pipeline output checks do not establish factual accuracy |
| Packaging | Both independent fresh-tarball installs pass on `99fea6f`; native consumer installation resolves pi-ai 1.1.0 | Installation and runtime loading, not live research through the published native package |
| Registry Pins | Main's plugin launchers resolve the published MCP manifest version; clean-profile checks below pass | Installation, skill discovery, connection and protocol checks, not full registry-pin research |

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

This section records the stable generation preceding the provenance corrections, not the current floor-modernisation candidate. The table records paced live verification of the 2026-10-06 candidate commits. The full paced suite subsequently completed on the merged `main` tree (2026-10-07: 14 scenarios, 0 failed, 0 skipped) before either package was staged; see [Release Readiness](RELEASE-READINESS.md#previous-publication).

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

No mandatory host check was skipped. The versions for this historical candidate are recorded in its release tags and changelog entries. The current manifests identify the published floor-modernisation generation; [Release Readiness](RELEASE-READINESS.md) records its completed gates. Repaired-configuration recovery is covered by deterministic CLI and protocol tests; the host's historical authentication-cache expiry was not retimed.

### Published `0.15.0` Registry-Pin Verification (2026-10-07)

After the maintainer approved the staged package (`latest` moved to `0.15.0` at 15:47 UTC), both host plugins were installed from the committed catalogues into clean profiles against the published pin, with no credentials beyond a dummy key option:

- **Claude Code 2.1.292:** isolated `CLAUDE_CONFIG_DIR`, marketplace added from `Curio-Data/pi-intelli-search`, plugin installed, dummy key option set, minimal configuration written; `claude mcp list` shows `plugin:intelli-search:intelli_search` connected through the committed `npx -y --package @curio-data/mcp-intelli-search@0.15.0` launcher.
- **Codex CLI 0.160.1:** isolated `CODEX_HOME`, marketplace added from the same GitHub source, plugin installed (installed-cache root at version `0.15.0`); `codex mcp list` shows `intelli_search` enabled on the same `npx` pin.
- **Direct stdio probe:** `initialize` plus `tools/list` against the registry-pulled server returned all four `intelli_*` tools; the probe also exercised the explicitly-selected-missing-configuration recovery path, serving the protocol with an actionable per-call configuration error rather than refusing connection.

Full research through the registry-pin route remains open evidence; the credentialed full-research scenarios (13 and 14) run in the local-tarball class and passed on this tree on 2026-10-07 (Codex on 0.160.1).

## Shared Constraints

- The committed plugin launchers pin the exact MCP manifest version and download it through `npx` on first start: that route needs network access and Node.js 22 or later. Main's MCP pin is published and verified through the clean-profile checks above. Earlier generation checks remain historical evidence for their respective pins. The registry-pin class covers installation, connection and tool listing; full registry-pin research remains separate evidence.
- Full research calls have been driven through both host plugins in the local-tarball class (`test/e2e/13_claude_code_plugin.sh`, `test/e2e/14_codex_plugin.sh`). A full research call through the registry-pin route remains open evidence; the registry-pin class currently covers installation, connection and tool listing, plus a direct `npx` pull that runs the published CLI.
- Only [_OpenRouter_](https://openrouter.ai) is a verified standalone inference provider. Other OpenAI-compatible endpoints are not claimed: reasoning, search-tool and citation behaviour differs between compatible-looking endpoints.
- _macOS_ and _Windows_ are not verified for any artefact; the fetch dependency's native assets are exercised on _Linux_ x86-64 only.


