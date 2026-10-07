# MCP Routing Review

The `fix/claude-mcp-tool-routing` branch adds search-first guidance to the Model Context Protocol (MCP) adapter and generated host skills. Two independent reviewers examined commit `38feaae` against `origin/main` at `81b353b`: _Claude Code_ with Opus 5.5 and `Pi` with native DeepSeek Flash. Session provenance confirmed both requested models; the Claude Code footer confirmed the one-million-token variant. The coordinator verified their findings and applied the corrections below. This record is verification evidence, not publication approval.

## Finding Dispositions

| Finding | Decision | Evidence |
|---|---|---|
| Published launchers still pin the old MCP server | Accept as a release prerequisite, not a source-review blocker. Keep the feature branch's manifests and pins unchanged; prepare an MCP-only patch separately and regenerate plugins with that bump | `packages/mcp/package.json`, generated plugin manifests and launchers; the repository's package-specific versioning policy |
| “Using intelli search” cues the expected factual operation | Accept. Replace it in every prompt with “Using the installed web research plugin”; retain the explicit skill request only in the explicit-loading case | `test/e2e/13_claude_code_plugin.sh`; deterministic prompt assertions in `test/claude-routing.test.ts` |
| Deferred descriptions cannot influence invocation | Reject that stronger claim. Names and instructions load first; full definitions load on demand before invocation. Clarify that the skills-disabled case does not isolate descriptions from instructions | [Official tool-search documentation](https://code.claude.com/docs/en/mcp#scale-with-mcp-tool-search), checked 2026-10-07; retained `ToolSearch` traces |
| The research deadline is not read from `.env`; the runner has little worst-case headroom | Accept the operational limitation. Document caller-environment use and the combined timeout budget, without changing the suite runner | `test/run-e2e-all.sh`, scenario 13 and `scripts/README.md` |
| README framing differs from MCP guidance | Accept. Lead the Tools section with search-first guidance and remove “primary research tool” from the table | Root README and regenerated package READMEs |
| Setup should remain before routing; repeated guidance should be removed | Do not include. Routing-first order is intentional for the agent-facing skills; repetition and example budgets do not demonstrate a defect | `guidance/research-guide.md`, generator and plugin tests |
| Native tool descriptions should follow the MCP changes | Defer. The branch targets MCP/plugin routing and preserves native descriptions and schemas | No changes under `src/core/`, `src/tools/` or the native skill |

The user-visible changes are recorded under `Unreleased` in [the changelog](../../CHANGELOG.md). No version bump, release tag, marketplace-pin change or publication is part of this review correction.

## Live Verification

The neutral-prompt scenario ran against a locally packed server and generated plugin, not the published registry pin. Host: Claude Code `2.1.293`. Requested model: `claude-opus-5-5[1m]`; recorded model: `claude-opus-5-5`.

The first run passed all factual cases and completed research. Its comparison gate failed because a local cache-inspection shell loop was denied. The zero-denial assertion correctly retained that failure. Both reviewers confirmed that the denial followed successful skill loading and research, rather than indicating a routing failure. Broadly approving `Bash` was rejected because it would permit shell-based web substitution without a corresponding verifier check.

The correction removes `Bash` from the evaluation's tool set and pre-approves `Read`, `Glob` and `Grep` for local cache inspection. The verifier rejects an exposed or invoked `Bash` tool, direct built-in web substitution and every permission denial. Other host tools, including `Monitor` and `Task`, remain exposed, and the scenario does not pin the host's permission mode. None was invoked in the passing run, but the checks do not exclude every indirect command or delegation route. This is a controlled routing evaluation, not a sandbox or a claim about behaviour in a host with an unrestricted shell.

The subsequent run passed every case:

| Case | Observed Behaviour | Duration |
|---|---|---|
| `descriptions-only` | Skills absent; two search calls; tool search used | 24.811 seconds |
| `factual-auto` | Successful skill invocation before one search call | 16.151 seconds |
| `factual-explicit` | Requested skill invoked before one search call | 11.671 seconds |
| `comparison-auto` | Automatic skill invocation before one research call; completed artefacts under the configured three-page cap | 187.077 seconds |

Every case returned a successful model-visible answer. Search answers included sources; research produced a completed sidecar and report. The isolated plugin credential file was removed, and the operator credential file's modification time was unchanged. The automatic and explicit skill cases remain distinct; explicit loading is not evidence of automatic selection. The checks do not establish factual accuracy or whether a second search was semantically justified.

Retained local evidence, all gitignored:

- Reviewer reports: `.tmp/agents/routing-review/reports/routing-opus.md` and `routing-flash.md`.
- Initial neutral-prompt trace: `.tmp/intelli-claude-e2e-cASL8KhO/`.
- Passing no-shell trace: `.tmp/intelli-claude-e2e-ZD89sQmp/`.
- Coordinator gate logs: `.tmp/agents/routing-review/gates/`.

## Deterministic and Installation Checks

Both builds, native and MCP tests, native-contract type checking, generated-file checks, ShellCheck and the full dependency audit passed. The canonical test total remains in the root README badge. Both independent fresh-tarball installation gates passed, and the native live pipeline scenario passed. The MCP SDK's installed implementation carries server `instructions` into the initialize response; protocol tests verify transmission and description-length budgets.

The full paced live suite was not rerun for this patch review. It remains a release prerequisite, alongside green CI for the exact release candidate and post-publication verification of the regenerated registry pins. The local-tarball evaluation does not establish routing for existing published installations or for other host models.

## Deferred Source-Provenance Finding

Opus identified an independent shared-engine problem in the first comparison report. Its generated Source Assessment listed seventeen sources and its prose named cache files that did not exist, while the canonical appended source index, sidecar and filesystem agreed that only three pages were fetched and extracted. The coordinator confirmed the discrepancy in the retained report and source directory.

`runCollateStage()` passes the search summary together with successful extractions to `buildCollationMessage()` (`src/core/operations/research.ts`). The collation prompt asks for an assessment “For each source” (`src/core/prompts.ts`). Those inputs permit the model to confuse search citations with fetched evidence; the observed report demonstrates the failure, not that every run fails this way.

Do not claim that every cited source was fetched, or that this routing branch fixes source provenance. A separate core change should distinguish search-only citations from extracted pages and prevent fabricated cache references, with deterministic coverage and deliberate native-contract review. Under the repository's policy, including that core correction would require a coupled minor release rather than the MCP-only patch recommended for this branch.
