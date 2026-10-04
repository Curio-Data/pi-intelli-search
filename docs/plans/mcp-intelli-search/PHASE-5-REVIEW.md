# Phase 5 Peer Review

## Scope and Method

Two independent native reviewers, `qwen-token-plan/qwen3.8-max` and `deepseek/deepseek-flash`, each covered the **whole** uncommitted Phase 5 change on `plan/mcp-intelli-search` (base `67be4e4`), working diff-first in the main checkout under read-only briefs. Both re-ran the deterministic gates themselves (`npm run check:plugins`, the plugin-bundle test file, `claude plugin validate --strict` on the plugin and the marketplace, `shellcheck` on the new script) with scratch under `.tmp/agents/2026-10-04-p5-review/work/`; neither ran live scenarios or shared suites, per brief. The orchestrator's logs under `.tmp/mcp-phase5/` and `.e2e-logs/` were available to both as corroborating evidence, and qwen additionally probed both host CLIs in isolated configuration directories.

Reports: `.tmp/agents/2026-10-04-p5-review/reports/{qwen,deepseek}.md` (gitignored; the report file, not the pane, was the authority).

## Findings and Dispositions

### Corrected

| Finding | Reviewer | Disposition |
|---|---|---|
| Drift gate checked only generator output against the committed tree, so a stray file in a plugin root would ship silently | both (deepseek F1, qwen F6) | **Fixed.** `checkAgainstRepo()` enumerates the committed `plugins/`, `.claude-plugin/` and `.agents/plugins/` trees and fails on any file the generator does not produce; a regression test plants a stray file and asserts detection. After follow-up, the `vendor/` exclusion was removed too, so a committed vendor tree also fails the gate. |
| Codex skill claimed absent from the model-visible prompt; skill discovery unproven on both hosts | qwen F2, deepseek F3 | **Coverage fixed; claim retracted.** The e2e now asserts `claude plugin details intelli-search` lists `Skills (1)  intelli-search` and `codex debug prompt-input` lists `intelli-search:intelli-search`, both credential-free. Qwen re-probed and **retracted** the Codex absence claim as a false positive (his grep targeted skill body text, which Codex never inlines; the listing was present in his own probe output). |
| Launchers pin a registry version that does not resolve until publication, with no merge enforcement | qwen F1 | **Fixed as policy.** The handoff's Fixed Requirements now forbid merging `plan/mcp-intelli-search` to `main` before `@curio-data/mcp-intelli-search` is published. The pin itself is intentional (generated from the package manifest). |
| The Claude Code skill's fallback sentence carried the `${CLAUDE_PROJECT_DIR}` sigil, which the host's skill-body substitution would rewrite into a path, destroying the instruction | qwen F3 | **Fixed.** The sentence names `CLAUDE_PROJECT_DIR` in prose without the sigil, quotes the real startup message, and the setup section states the resolved plugin-data path shape. |
| Setup fragments named `WORKSPACE`/`CONFIGURATION` tool-result codes for startup failures the startup path never emits | both (deepseek F5, qwen F4) | **Fixed.** Both fragments quote the real stderr messages from `cli.ts`/`config.ts` verbatim. |
| Failure-mode section misclassified `PROVIDER` as setup and omitted `INVALID_ARGUMENTS`/`OPERATION` | qwen F5 | **Fixed.** The section separates startup failures from tool-result codes, splits provider auth/credit failures from transient 429/5xx, and covers all six codes. |
| `INTELLI_SEARCH_CONFIG` parenthetical called a file path a directory | deepseek F6 | **Fixed.** |
| Generator, test and e2e scratch defaulted to unencrypted `/tmp` when `TMPDIR` is unset | both (deepseek F4, qwen F7 location half) | **Fixed.** All three default to the repository's `.tmp/`. |
| The e2e copied real Claude/Codex OAuth credentials into isolated homes and `chmod`ed after copying | qwen F7 | **Fixed by removal.** The credentialed checks are gone from the repeatable script; see the incident note below. |
| Missing `claude` or `codex` CLI hard-failed the paced runner | both (deepseek F7, qwen F10) | **Fixed.** The scenario now skips with a notice. |
| Both catalogs share one marketplace name, so the e2e could not tell which file Codex consumed | qwen F8 | **Fixed.** The e2e asserts `codex plugin list` names `.agents/plugins/marketplace.json`. |
| Codex manifest declared `capabilities: ["Read"]` for a plugin that writes cache files and bills external APIs | qwen F9 | **Fixed.** Now `["Read", "Write"]`, pinned by a unit test. |
| Token guard checked only `{{` | qwen F11 | **Fixed.** `}}` also rejects. |
| Claude cache-read hint read as a dangling appositive; setup never gave the data-directory shape | qwen F12 | **Fixed.** Hint reworded; the path shape is stated in the setup fragment. |
| `codex plugin add --json` parse could be redded by a warning line preceding the JSON body | deepseek F2 | **Fixed.** The script parses from the first brace line and captures stderr separately. |

### Retracted or Weakened

- **Codex skill absence** (qwen F2 core claim): retracted by qwen on re-probe; directory-based auto-discovery works in the compatibility layout, and the manifest needs no `skills` key on Codex CLI 0.144.5.
- **`${CLAUDE_PLUGIN_DATA}` unusable in setup shell commands** (deepseek's initial suspicion): not a functional defect; skill bodies are substituted at load, so the agent sees resolved paths.
- **Unpublished registry pin as a rule violation** (deepseek): not a violation; the catalogs are pre-release distribution metadata on the branch, and qwen F1's enforcement gap is what got fixed.
- **`${CLAUDE_PROJECT_DIR}` "not documented" wording** (deepseek F8): the current plugins reference lists it for inline MCP `env` substitution (not exported to the process environment); `PHASE-5.md` now says exactly that while keeping the observed-version pin and the fail-closed fallback.

### Recorded, Not Fixed Here

- **Codex `interface` block casing and compat-layout support** (qwen F9 residual): `websiteURL` matches the published manifest example, but whether the compatibility-layout parser honours a top-level `interface` block is unknown; install and discovery work either way. Settle before any public-directory submission (out of scope; no submission is planned).
- **Codemode exposure of plugin tools** on either host: not exercised; recorded in `PHASE-5.md` limitations.
- **Live research through either host plugin** remains Phase 6 acceptance-matrix scope ("Live Behaviour"), as does the post-publication registry-pin re-run.

## The Credential Incident

While developing the credentialed Codex session check, the orchestrator copied `~/.codex/auth.json` into isolated `CODEX_HOME` directories. OAuth refresh-token rotation made a copy the valid chain; cleanup deleted it, invalidating the host's real Codex login ("refresh token was already used"). The login remains broken until the operator runs `codex login` again; the operator was informed in the completion report. Claude Code's login survived the equivalent copies (no refresh occurred in those sessions). Consequences, all recorded in `PHASE-5.md`: the repeatable e2e is now fully credential-free; the credentialed tool-name and handshake evidence is one-time recorded evidence with dates and host versions; copying OAuth credential files into disposable directories is prohibited for future work.

## Verification of the Corrections

After the fixes, the orchestrator re-ran: `npm run build:all`, `npm test` (460 native, including 16 plugin-bundle tests), `npm run test:mcp` (41), the contract type check, `npm run check:plugins` (bidirectional), isolated structural smoke, `claude plugin validate --strict` on the plugin and marketplace, `shellcheck` on the changed scripts, and the full `./test/e2e/12_plugin_bundles.sh` (20 checks, 0 failures, 0 skips, credential-free). The badge moved to the new aggregate.

## Follow-Up

Both reviewers re-checked the corrected tree against their own findings and re-ran the deterministic gates.

- **qwen: FOLLOW-UP: PASS.** Every finding confirmed fixed or formally retracted (F2); the retraction includes the corrected probe evidence. The gate table in his follow-up shows 16/16 tests and all validators green.
- **deepseek: FOLLOW-UP: PASS.** All thirteen corrections verified with `path:line` citations against the corrected tree. One non-blocking residual (the `vendor/` exclusion in the reverse enumeration) was tightened by the orchestrator after his pass and re-verified with `npm run check:plugins` and the 16-test suite.

The tracked tree is the authority on the final state.

## Limits

Neither reviewer ran live scenarios, e2e scripts or the shared suites (orchestrator-owned). The credentialed one-time evidence predates the corrections by hours; the corrections did not touch launchers, server names or tool naming, so the observed qualified names still apply. The review does not cover Phase 6 surfaces: README installation routes, CI wiring, release automation and the post-publication registry-pin gate.
