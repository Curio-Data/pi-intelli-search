# Post-Phase 6 Checkpoint: Host Plugin Verification

This is the 2026-10-05 historical finding record. [Release Readiness](../../RELEASE-READINESS.md) records the current dispositions and verification gates. The implementation is merged and its alpha is published; do not treat the open/next-work wording below as a fresh status assessment. The pending credential-rotation item still requires operator confirmation.

This checkpoint records the host plugin work of 2026-10-05: the [_Claude Code_](https://code.claude.com/docs/en/plugins) key option, the credentialed host scenarios, an independent two-reviewer pass, and a fresh-agent pass that followed the README as a new user. The fresh-agent pass found open defects; fixing them is the next work. The release hold in [Post-Phase 5 Checkpoint](POST-PHASE-5.md) remains in force, and nothing here authorises publication.

## Contents

- [Commits](#commits)
- [Credentialed Host Scenarios](#credentialed-host-scenarios)
- [Two-Reviewer Pass](#two-reviewer-pass)
- [Fresh-Agent Pass](#fresh-agent-pass)
- [Open Findings](#open-findings)
- [Next Work](#next-work)
- [Repeating the Fresh-Agent Pass](#repeating-the-fresh-agent-pass)
- [Operator-Local State on the Development Host](#operator-local-state-on-the-development-host)

## Commits

All on `plan/mcp-intelli-search`, pushed to the remote at `8d4d805`.

| Commit | Change |
|---|---|
| `0d24cda` | Claude Code plugin supplies `OPENROUTER_API_KEY` from a required sensitive `userConfig` option (`openrouter_api_key`); scenario 12 asserts key delivery with dummy values |
| `c8cff3d` | `test/e2e/13_claude_code_plugin.sh`: real `claude -p` research through the installed plugin |
| `b9c1c41` | `test/e2e/14_codex_plugin.sh`: real `codex exec` research through the installed plugin; Codex skill documents tool pre-approval for unattended runs |
| `8d4d805` | Review fixes: `test/e2e/env.sh` parses `.env` without executing it for every live scenario; scenario hardening; Claude Code setup guidance corrected |

### Why the Key Option Is Required

Observed on Claude Code 2.1.289 and recorded in the [compatibility matrix](../../COMPATIBILITY.md#host-plugins): an optional option left unset substitutes an empty string that overrides an exported `OPENROUTER_API_KEY`, and `${user_config.KEY:-fallback}` is not supported. A required option makes the host withhold the server until the key is set. Installation does not ask for the value; it prints a needs-configuration notice. Codex has no option mechanism and still forwards the exported variable through `env_vars`.

## Credentialed Host Scenarios

The owner authorised credentialed host scenarios on 2026-10-05, superseding the re-run prohibition in [Post-Phase 5 Checkpoint](POST-PHASE-5.md) with a safe procedure. Neither scenario copies a credential file.

| Scenario | Authentication | Held by the operator |
|---|---|---|
| `13_claude_code_plugin.sh` | `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`: static, never stored in the isolated profile, never refreshed | One line in the gitignored `.env` (mode 600) |
| `14_codex_plugin.sh` | A dedicated separate ChatGPT login, refreshed in place by one consumer at a time under an exclusive lock | `.e2e-auth/codex/auth.json` (gitignored, mode 700), created with `CODEX_HOME="$PWD/.e2e-auth/codex" codex login --device-auth` |

Rules a continuing agent must keep:

- Never copy, read, print or hash `~/.claude/.credentials.json`, `~/.codex/auth.json` or the dedicated `auth.json`. A copied refresh-token chain invalidates the operator's login.
- Never run `claude setup-token` or a login through an agent session: both print secrets into the transcript. The operator runs them in a separate terminal.
- Scenario 13 and 14 failures that report a missing token or login are operator actions, not code defects.
- **Pending operator action:** the current `CLAUDE_CODE_OAUTH_TOKEN` had a fragment exposed in a session transcript on 2026-10-05 (a wrapped paste executed as shell code). The log copy was deleted; the token itself still needs replacing with a fresh `claude setup-token`.

Both scenarios passed on 2026-10-05 after the review fixes, with scenario 12 (25 checks) and `01_main.sh`.

## Two-Reviewer Pass

Two read-only `pi` reviewers (`qwen-token-plan/qwen3.8-max` and `zai/glm-5.3`) reviewed `1792deb..b9c1c41`. Neither found a critical defect; both judged the option design and the Codex approval discovery sound. Every finding below is fixed in `8d4d805` unless marked otherwise.

- **Credential leak (fixed, high):** scenarios executed `.env` with `source` after redirecting output into `.e2e-logs/`, so a malformed line wrote a token fragment to disk, and `set -a` exported every credential into every agent session. `test/e2e/env.sh` now parses named keys only, before logging starts, and refuses a malformed or non-private file. All live scenarios and `test/run-e2e-all.sh` use it.
- **Key in a process argument (fixed):** scenario 13 built the option JSON with `jq --arg`; it now uses the `printf` builtin, as the guidance does.
- **Vacuous checks (fixed):** scenario 12's "server withheld" check sampled for a fixed window; it now samples until `claude mcp list` exits plus a grace period and cross-checks the list. Scenario 13 now asserts the configure step and the stored secret, so its hygiene check cannot pass on a missing file.
- **Robustness (fixed):** INT and TERM traps, Linux-only gating, retry skipped after a completed research, attempts sized to the runner timeout, `--strict-config` for Codex, symlink-resolved Codex profile confined to the repository with mode 700.
- **Guidance (fixed):** install does not ask for the key; the `/plugin` Installed tab route; a warning against `claude plugin install --config`; the 2.1.285 floor for `--values-stdin` (from the Claude Code documentation); consistent restart, `401` and uninstall text.
- **Not changed:** `PHASE-5.md` keeps its dated present-tense sentence about key inheritance beside the dated update. Uninstall clearing `pluginSecrets` remains unexercised.

## Fresh-Agent Pass

A Claude Code agent (`claude-opus-5-5`, 1M context) with no prior context followed `README.md` and its linked documents only, on Claude Code 2.1.289 and codex-cli 0.144.5. It ran 7 Claude Code and 4 Codex sessions in isolated profiles, using the credentialed procedure above.

| Route | Verdict |
|---|---|
| Claude Code plugin | **Broken as written** (F1 until merge; F2, F3, F4) |
| Claude Code direct registration, source-checkout launcher | Works with caveats (F2; without the skill the model preferred built-in web tools) |
| Codex plugin | Works with caveats (F1 until merge; F6, F8, F13) |

The skill is installed byte-identical to the committed `plugins/<host>/skills/intelli-search/SKILL.md` on both hosts, from the GitHub branch marketplace and from the local-tarball bundle, and both hosts discover it. On Codex the skill loaded for every research question and its guidance, including cache suggestions and the pre-approval setting, worked as written.

## Open Findings

Severity is the harm to a new user following the instructions. Evidence classes follow the [compatibility matrix](../../COMPATIBILITY.md#evidence-classes); "Observed" means the fresh agent ran it.

### F2: Claude Code Drops the Text Summary (High, Confirmed)

When a tool result carries both `content` text and `structuredContent`, Claude Code 2.1.289 passes only the serialized `structuredContent` to the model. `packages/mcp/src/server.ts` returns the summary as text and `{outcome, details}` as structured content, so on Claude Code:

- `intelli_research` reaches the model as `{"outcome":"completed","details":{"cachePath":"…","urlsSearched":2,"pagesFetched":2,"pagesFailed":0}}`; the model must read `report.md` itself, contrary to the skill's "use it directly" guidance.
- `intelli_search` reaches the model as a source list only; in one session the model told the user there was "no answer text" and stopped.
- The related-cached-searches appendix never reaches the model.

Codex passes the text. The orchestrator confirmed the tool-result shape in the fresh agent's session transcripts. Public issue mirrors describe the same host behaviour; whether _Anthropic_ treats it as a defect is unknown. Scenario 13 passed because it asserts only that the tool result is not an error.

Fix direction: carry the summary inside `structuredContent` (for example a `summary` field) so every host that prefers structured content shows it, keep the text content for hosts that read it, update the protocol tests and the result description in `packages/mcp/README.md`, and add a scenario 13 assertion that the model-visible tool result contains summary text.

### F3: An Early Session Disables the Server for About 15 Minutes (High)

A session opened before `config.json` exists starts the server, which exits. Claude Code records the failure in `mcp-needs-auth-cache.json` inside the config directory, and later sessions report the server `failed` without launching it, while `claude mcp list` reports it connected. The cache cleared after about 15 minutes (Observed at 15.7 minutes). The README invites the mistake by sending users to the skill for setup after installation.

Fix direction: make the server start when the configuration **file** is missing or unreadable and return a configuration error on the first tool call, so an incomplete setup never produces a cached startup failure; and document the setup order and the `/mcp` reconnect recovery.

**Decision needed before implementing:** whether the same applies when `--config` or `--workspace` is absent altogether. The guidance documents that case as a deliberate fail-fast startup exit (`guidance/research-guide.md` Failure Modes, `guidance/setup-codex.md`); changing it could hide a misconfigured launcher. The F3 symptom needs only the missing-file case. Ask the owner, or keep the absent-argument exit and change only the file case.

**Coupled change:** whatever F3 changes, update the failure model in `guidance/research-guide.md`, `guidance/setup-codex.md` and `guidance/setup-claude-code.md` in the same change, then `npm run generate:plugins`; otherwise both skills describe the old startup exit.

### F4: Claude Code Setup Is Unreachable From the README (High)

`README.md` names the `claude plugin configure … --values-stdin` command but not its JSON payload shape or the `config.json` path. Asking Claude "what else do I need to finish setup?" did not load the skill. Read by a person, the skill's `mkdir -p "${CLAUDE_PLUGIN_DATA}"` fails in a shell, because the variable is substituted only when Claude loads the skill (Observed with `/intelli-search:intelli-search`).

Fix direction: put both concrete steps in the README (the `printf … | claude plugin configure … --values-stdin` line and the data-directory path, under `$CLAUDE_CONFIG_DIR` when set), and point to `/intelli-search:intelli-search` for the substituted view.

### F1: README Marketplace Commands Fail Until Merge (High; Resolves at Merge)

`claude plugin marketplace add Curio-Data/pi-intelli-search` and the Codex equivalent fail because `main` has no catalogs. Both hosts accept the branch: `'Curio-Data/pi-intelli-search#plan/mcp-intelli-search'` (Claude Code) and `--ref plan/mcp-intelli-search` (Codex). This resolves on merge, which is itself held until the MCP package is published: do not merge to fix it. The only action now is documenting the branch reference if the branch is shared for testing.

### Medium and Low Findings

| ID | Severity | Finding | Fix Direction |
|---|---|---|---|
| F5 | Medium | Claude Code did not load the skill for natural research questions (3 of 3 sessions); the model reached for built-in web tools first and found the deferred MCP tools through tool search | Sharpen the skill description; whether that helps is unknown. [One recorded session](../../COMPARISON.md#host-native-web-search) compares native `Pi` research with Claude Code's built-in web tools, not the MCP plugin route |
| F6 | Medium | Codex with the forwarded variables unset gives no visible error; the model claimed to use the skill while answering from built-in web search | Skill instruction to report an unavailable server instead of substituting another tool; a documented Codex check |
| F7 | Medium | `claude mcp list` prints `Failed to connect` with no reason; server standard error is under `~/.cache/claude-cli-nodejs/<project>/mcp-logs-plugin-intelli-search-intelli-search/` (Observed, Linux, 2.1.289) | Name the log location in the skill's verification step |
| F8 | Medium | Codex skill suggests exporting the key in a shell profile in plain text | Recommend loading it at launch from a mode-600 file or secret store |
| F9 | Low | Skill paths hard-code `~/.claude` and `~/.codex`; the real locations follow `CLAUDE_CONFIG_DIR` and `CODEX_HOME` | Add the variable-based forms |
| F10 | Low | `docs/COMPATIBILITY.md` (the "no full research call" sentence) and `README.md` (the matching limit) contradict the recorded plugin research sessions | Replace with the actual limits, including F2 |
| F11 | Low | `packages/mcp/README.md` names only `--mode tarball`; the required `--output`, `--codex-vendor-dir`, `npm pack` and vendor install steps live in `scripts/README.md`; the generator has no `--help` and rewrites the tracked tree when run without arguments | Link and list the four steps; add `--help` |
| F12 | Low | The host's install message suggests `--config KEY=VALUE`, which the skill forbids, before the user sees the skill | Repeat the warning in the README |
| F13 | Low | No Codex verification step is documented; `codex mcp list` shows the server enabled without starting it | Document a check that starts the server |
| F14 | Low | The related-cached-searches table tells the model to read `<slug>/report.md` but has no directory column | Add the directory name |
| F15 | Low | `--check-config` reports a malformed file with the same message as a missing one | Distinguish "not found" from "invalid JSON at line N" |
| F16 | Low | Direct registration shows connected without a key; only a research call proves the setup | Say so in the README |

## Next Work

In order. Each change follows the `AGENTS.md` gates (build, `npm run test:all`, `npm run check:plugins`, `npm run check:toc`, and the live scenarios through `./test/run-e2e-all.sh` or singly with gaps).

1. **F2:** summary in `structuredContent`, protocol tests, package README, and a scenario 13 assertion on the model-visible result. This changes the unpublished MCP package's result contract; record it in `CHANGELOG.md` under `Unreleased`.
2. **F3:** after the scope decision above, server startup with a missing configuration file, the error reported on the first tool call, tests for both outcomes, and the coupled guidance update.
3. **F4, F12, F16, F1:** README setup text for the Claude Code plugin, and the branch reference while unmerged if the branch is shared for testing.
4. **F5 to F16:** mixed layers. Guidance (`guidance/`, then `npm run generate:plugins`): F5, F6, F7, F8, F9, F13. Documentation: F10, F12, F16 and the documentation half of F11. Code: F11 (`--help` in `scripts/generate-plugin-bundles.mjs`), F15 (`packages/mcp/src/config.ts`, separate missing and malformed messages) and F14 (`src/core/cache.ts` related-searches table). F14 is shared engine code: it changes native `Pi` output too, so run the native contract tests and check the frozen fixtures under `test/fixtures/native-contract/`; do not regenerate them to hide a difference.
5. A second fresh-agent pass, as below, to confirm the routes.

A cold-start successor (`deepseek/deepseek-flash`) read only the tracked handoff on 2026-10-05 and identified F2 in `packages/mcp/src/server.ts` `successResult()` as the first change, with no owner question needed to start it. Its corrections (stale next-work statements, the F3 scope and coupling, the F4 and F1 wording, and the layer split above) are applied here.

## Repeating the Fresh-Agent Pass

The brief is rendered with the `curio-herdr` skill's `render-brief` into `.tmp/agents/<run>/briefs/`. Carry these requirements, which a fresh agent cannot infer:

- Act as a new user: instructions come from `README.md` and the documents it links only, not from `AGENTS.md`, `docs/plans/`, `test/` or `scripts/` source.
- Exercise the Claude Code plugin, Claude Code direct registration with the source-checkout launcher, and the Codex plugin. Run the README marketplace commands literally first; then substitute only the package, using the local-tarball bundle, because the package is unpublished.
- Isolation: `CLAUDE_CONFIG_DIR` in the agent's scratch directory with `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` unset, authenticated by `CLAUDE_CODE_OAUTH_TOKEN` from `.env`; `CODEX_HOME=<repo>/.e2e-auth/codex`, deleting nothing but non-`auth.json` entries; the OpenRouter key read from `~/.pi/agent/auth.json` into a variable and never printed. Give each route its own `git init` project folder under scratch, so sessions do not read the repository.
- Skill evidence: byte comparison with the committed skill, host discovery, and a natural research question that names no tool, observed through `claude -p --output-format stream-json --verbose` and `codex exec --json`, including what the model received as the tool result.
- Budget: at most 8 Claude Code and 6 Codex sessions, `maxUrls` 1 to 2.

## Operator-Local State on the Development Host

These are outside the repository's tracked files and belong to the operator's manual testing:

- `.claude/settings.local.json` declares the `curio-data-plugins` marketplace at `.tmp/plugin-local/bundles` and enables `intelli-search@curio-data-plugins` for this folder only. The bundle there is a local-tarball generation of the committed generator before `8d4d805`; regenerate it in place with `--mode tarball --output .tmp/plugin-local/bundles` after guidance changes so the operator tests current text.
- `~/.claude/plugins/data/intelli-search-curio-data-plugins/config.json` and the `pluginSecrets` entry in `~/.claude/.credentials.json` hold the operator's configuration and key for that install. Do not read or alter the credential file.
- To remove the local install: `claude plugin uninstall intelli-search@curio-data-plugins --scope local`, `claude plugin marketplace remove curio-data-plugins`, then delete `.tmp/plugin-local`.
