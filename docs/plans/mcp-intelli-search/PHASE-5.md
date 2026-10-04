# Phase 5 Results

## Outcome

Phase 5 implements Host Plugins and Guidance. One shared guidance source now renders both host skills; the _Claude Code_ and _Codex_ plugin bundles and both repository marketplace catalogs are generated artifacts pinned to the exact `@curio-data/mcp-intelli-search` version in `packages/mcp/package.json`. Both plugins install from local copies, launch the same standalone server and complete real host verification. The native `Pi` package, its frozen fixtures and both installation gates are preserved. Phase 6, Documentation, Integration and Release Readiness, is next in the [implementation plan](IMPLEMENTATION.md#phase-6-documentation-integration-and-release-readiness).

No release or publication has occurred. The committed registry launchers pin `0.2.0-alpha.0`, which is not yet on the registry; the pinned `npx` route becomes installable only when Phase 6 publishes the package. All host verification in this phase used generated **local-tarball launchers** (pre-publication evidence class); post-publication registry-pin verification is a separate, still-open gate.

## Implementation

| Path | Responsibility |
|---|---|
| `guidance/research-guide.md` | Single host-neutral guidance source with `{{TOOL_*}}`, `{{SETUP}}` and `{{CACHE_READ_HINT}}` tokens |
| `guidance/setup-claude-code.md`, `guidance/setup-codex.md` | Per-host setup fragments rendered into each skill |
| `scripts/generate-plugin-bundles.mjs` | Generator: registry mode (committed tree), bidirectional `--check` drift gate, `--mode tarball` for pre-publication test trees |
| `plugins/claude-code/` | Claude Code plugin: manifest, `.mcp.json` launcher, generated skill |
| `plugins/codex/` | Codex plugin: compatibility manifest, legacy `.mcp.json` launcher, generated skill |
| `.claude-plugin/marketplace.json` | Claude Code repository marketplace (`curio-data-plugins`) |
| `.agents/plugins/marketplace.json` | Codex repository marketplace (`curio-data-plugins`) |
| `test/plugin-bundles.test.ts` | Deterministic generator tests: schema shape, version pins, per-host tool names, guidance invariants, drift check |
| `test/e2e/12_plugin_bundles.sh` | Live host installation and launch verification (proven runnable; 20 checks) |

The native skill `skills/intelli-search/SKILL.md` remains the `Pi`-specific edition and is unchanged. The two plugin skills are renderings of one shared source, so workflow guidance is maintained once. The stale frozen `maxUrls` schema description (`default: 8` versus the shared default 10) is not propagated: generated guidance states 10/20, and a test pins that.

## Host Findings (Empirical)

Host behavior was probed with a dummy plugin on this machine before authoring the real bundles. These findings, not documentation assumptions, drove the launcher design.

### Claude Code v2.1.289

- Local directory marketplaces install and plugins read in place; `claude plugin validate --strict` passes both plugin and marketplace (needs `author` and a marketplace `description`).
- Plugin MCP servers inherit the full parent environment; `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, `${CLAUDE_PROJECT_DIR}` and arbitrary `${VAR}` all expand in plugin MCP `env` values. The plugins reference lists `CLAUDE_PROJECT_DIR` for inline substitution in MCP `env` values but does not export it into the server process environment; the observed expansion on v2.1.289 matches, and the skill documents the fail-closed fallback for older versions.
- Plugin data directory resolves to `<config>/plugins/data/<plugin>-<marketplace>/`.
- Qualified tool names observed in a real session: `mcp__plugin_intelli-search_intelli_search__intelli_research` (pattern `mcp__plugin_<plugin>_<server>__<tool>`, hyphens preserved).
- `claude mcp list` performs a real health check that launches the server, proving framing and substitution without a model session.
- `claude plugin details intelli-search` proves skill discovery without credentials: the component inventory lists `Skills (1)  intelli-search`.

### Codex CLI 0.144.5

- The portable Agent Plugins layout (`plugin.json` plus root `mcp.json`) is **ignored**: the CLI derives a `.codex-plugin/plugin.json` compatibility manifest without MCP wiring. Only the compatibility layout (`.codex-plugin/plugin.json` with `"mcpServers": "./.mcp.json"` plus a legacy `.mcp.json`) loads plugin MCP servers. The shipped Codex plugin therefore uses the compatibility layout, contradicting the research record's portable-first recommendation; the portable format is documented but not honored by this CLI version.
- No placeholder expansion (`${PLUGIN_ROOT}`, `${PLUGIN_DATA}`, `${HOME}` all pass literally), server working directory is the session directory, and relative `args` resolve against that directory, not the plugin root. A bare `npx` command is the only portable launcher shape.
- The parent environment is filtered to an allowlist (`HOME`, `PATH`, ...). The legacy `.mcp.json` accepts `env_vars`, a list of parent variables forwarded by name; this is the credential and configuration channel (`OPENROUTER_API_KEY`, `INTELLI_SEARCH_CONFIG`, `INTELLI_SEARCH_WORKSPACE`).
- Plugin MCP servers are enabled on install without extra configuration. Marketplace entries require `policy.installation` and `policy.authentication` (`ON_INSTALL` installs a no-OAuth stdio plugin without prompting).
- Qualified tool names observed in a real session rollout: the deferred tool catalog and codemode calls use the normalized form `mcp__intelli_search__intelli_search`. Codex normalizes hyphens in server names to underscores, so the server key is `intelli_search` on both hosts to keep declared and observed names identical.
- Plugin installs are cached by version (`plugins/cache/<marketplace>/<plugin>/<version>/`); editing a local source without reinstalling leaves stale configuration in effect.
- Plugin skills auto-discover from the plugin's `skills/` directory in the compatibility layout: a real session's prompt input lists the skill as `intelli-search:intelli-search` with its cached path, and `codex debug prompt-input` shows the same listing without credentials or a model request.

### Shared Server Name

Both hosts declare the server as `intelli_search`, giving Codex `mcp__intelli_search__intelli_research` and Claude Code `mcp__plugin_intelli-search_intelli_search__intelli_research`. The generator renders each skill with the verified prefix; a unit test asserts both.

## Launcher Design

Both committed launchers pin the exact package version: `npx -y --package @curio-data/mcp-intelli-search@<version> mcp-intelli-search`. Cold start needs network access and [Node.js](https://nodejs.org/) >= 22; later starts reuse the `npx` cache. Credentials never appear in manifests: Claude Code inherits `OPENROUTER_API_KEY` from the parent environment, Codex forwards it by name through `env_vars`.

- Claude Code: `INTELLI_SEARCH_CONFIG=${CLAUDE_PLUGIN_DATA}/config.json`, `INTELLI_SEARCH_WORKSPACE=${CLAUDE_PROJECT_DIR}` (per-project `.search/` caches).
- Codex: configuration and workspace come from user-exported `INTELLI_SEARCH_CONFIG`/`INTELLI_SEARCH_WORKSPACE` (no expansion exists); the setup section documents fixed and per-project (`direnv`) patterns.

`--mode tarball` generates the equivalent tree whose launchers run `node` against a vendored `npm install --prefix <plugin>/vendor` of the packed tarball (`${CLAUDE_PLUGIN_ROOT}` for Claude Code, an absolute `--codex-vendor-dir` for Codex). This is the pre-publication evidence class; it is what `test/e2e/12_plugin_bundles.sh` exercises.

## Verification

Verification ran on `plan/mcp-intelli-search` (after `67be4e4`), using [_Node.js_](https://nodejs.org/) `v24.19.0`, Linux x86-64, `Pi` `1.0.1`, Claude Code `2.1.289` and Codex CLI `0.144.5`. Private logs reside under `.tmp/mcp-phase5/` and `.e2e-logs/`; they are not required to continue. Test totals remain single-sourced in the root README badge.

| Gate | Result and Scope |
|---|---|
| Native Entry Checks | Passed before editing: `build:all`, `test:mcp`, frozen fixtures, core tests, contract type check |
| `npm test` | Passed, including the 16 deterministic plugin-bundle tests (14 at implementation time, 16 after review corrections) |
| `npm run test:mcp` | Passed unchanged |
| Frozen Native Fixtures | Not touched; `native-contract` suite passes |
| Generator Drift Check | `npm run check:plugins` passes on the committed tree |
| `claude plugin validate --strict` | Passed for the plugin and the repository marketplace (also run against the generated tarball tree in the e2e) |
| `test/e2e/12_plugin_bundles.sh` | Passed: 20 checks, 0 failures, 0 skips, fully credential-free. Tarball pack, self-contained tree, vendored CLI smoke, Claude Code strict validation, marketplace add, install, `claude mcp list` connection, vendored-launcher assertion and skill discovery; Codex marketplace add, consumed-catalog assertion, install, installed-cache layout and prompt-input skill discovery |
| Credentialed One-Time Evidence | Recorded 2026-10-04: Claude Code session showed `mcp__plugin_intelli-search_intelli_search__intelli_*` tool names; a Codex session registered the server, completed the MCP handshake with the vendored artifact and recorded `mcp__intelli_search__intelli_*` in its rollout tool catalog. These checks are not repeatable gates; see the credential hazard below |
| Shell Validation | `shellcheck` clean for the new script; the runner includes it |

## Review Corrections

Two independent reviewers (`qwen-token-plan/qwen3.8-max` and `deepseek/deepseek-flash`) examined the uncommitted Phase 5 tree; [Phase 5 Peer Review](PHASE-5-REVIEW.md) records every finding, disposition and follow-up verdict. Corrections incorporated before commit: the drift gate became bidirectional (a stray file in a plugin root now fails `--check`); the setup fragments quote the server's real startup messages instead of tool-result error codes; the failure-mode section classifies `PROVIDER` correctly and covers `INVALID_ARGUMENTS` and `OPERATION`; the Codex manifest declares `capabilities: ["Read", "Write"]`; the e2e defaults scratch to the repository's `.tmp/`, skips cleanly when a host CLI is absent, asserts the catalog path Codex consumed, and hardens the `codex plugin add` JSON parse against warning prefixes. One reported finding was a false positive: the Codex plugin skill **is** discovered (auto-discovery from `skills/`, observed as `intelli-search:intelli-search` in the model-visible prompt input), and the e2e now asserts it.

**Credential hazard found during verification.** The first version of the e2e copied the host's Codex OAuth credentials (`~/.codex/auth.json`) into isolated `CODEX_HOME` directories to drive session checks. OAuth refresh-token rotation means the copy that refreshes becomes the only valid chain; deleting copies invalidated the host's real Codex login ("refresh token was already used"), which the operator had to restore by logging in again. Claude Code's login survived the equivalent copy because no refresh happened during those sessions, but the hazard is identical. The repeatable gate therefore runs fully credential-free; credentialed observations are one-time recorded evidence. Copying OAuth credential files into disposable directories is prohibited for future work.

The Claude tool-name observation and Codex session handshake each spent one small host-model request. No OpenRouter inference ran: servers start without credentials and no research operation was executed.
## Limitations

- The committed registry launchers reference an unpublished version. Installation from the committed catalogs works only after Phase 6 publication; until then the local-tarball path is the working one. The catalogs are distribution metadata on a pre-release branch, not a published offer.
- No full research call was driven through either host plugin. Live MCP research is certified by `test/e2e/11_mcp_stdio.sh` (`Pi` native client); per-host live research belongs to the Phase 6 acceptance matrix row "Live Behaviour".
- Codex findings pin CLI `0.144.5`. The portable layout may become loadable in later releases; the compatibility layout remains supported per the official build guide. Claude Code's `${CLAUDE_PROJECT_DIR}` MCP `env` expansion is observed on `2.1.289` only.
- The Codex TUI and the IDE extension (which does not support plugins at all) were not exercised; `codex exec` sessions drove the credentialed evidence.
- The npx cold-start path (download time, registry availability) is untestable before publication and remains open evidence.
- The codemode exposure of the plugin's tools (as opposed to direct tool calls) was not exercised on either host.

## Continuation

Implement Phase 6 against the generated bundles. Update `README.md` with the three installation routes (native, direct MCP, plugins), extend CI to validate generated manifests (`npm run check:plugins`, `claude plugin validate --strict` where available) and install both tarballs, record the compatibility matrix with the exact host versions above, and wire release automation for the second package with explicit approval. The post-publication gate must re-run the plugin installation against the registry pin and label it separately from the local-tarball evidence in this phase.
