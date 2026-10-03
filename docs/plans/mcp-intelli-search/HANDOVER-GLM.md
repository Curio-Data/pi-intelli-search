# Cold-Start Handover Review

## Result

A fresh `Pi` session using [_GLM 5.3_](https://docs.z.ai/) returned PASS WITH NONBLOCKING NOTES for the committed handoff at `e4e2f6a`. It reconstructed the completed state, the next bounded implementation step, fixed decisions and prohibitions from the permitted documents alone. It found no blocking contradiction or material information gap and independently passed both entry checks.

The coordinator incorporated the documentation notes described below. Phase 1, Dependency Seams, remains the next implementation step. No production code, dependency, fixture expectation or runtime interface changed during this review.

## Provenance and Isolation

| Item | Evidence |
|---|---|
| Review Date | 2026-10-03 |
| Requested and Observed Model | `zai/glm-5.3`, native provider; no model change reported by transcript provenance |
| Harness | Fresh interactive `Pi` session |
| Session | `01a10287-5ca2-75ee-bf14-aef0cf84d7b7` |
| Reviewed Revision | `e4e2f6ad34f23d1b50a393c049e2cd7d7327e7ed` on `plan/mcp-intelli-search` |
| Context | No prior conversation, automatic context files, skills, prompt templates or memory/research extensions |
| Configuration | Isolated agent directory containing only the selected provider configuration; credential copies removed after shutdown |
| Persistent Evidence | Transcript, brief, report and check logs stored under the repository's gitignored `.tmp/agents/2026-10-03-handover-glm/` |
| Work Scope | Read-only review, with report and authorised check scratch writes only |

The only loaded extension reported agent lifecycle and transcript location. The coordinator verified the actual model through the transcript rather than relying on the reviewer's self-report. The initial startup command timed out while the agent was already working; the coordinator recovered its registration and waited for that same session. No duplicate agent or fallback model was launched.

This was a fresh-context test in the existing checkout with dependencies already installed, not a fresh-clone installation test. Read-only and read-scope limits were briefing constraints, not an operating-system sandbox. The coordinator inspected tool-call paths and the clean working tree to corroborate compliance.

## Permitted Evidence

The reviewer started at the handoff README and could read:

- `docs/plans/mcp-intelli-search/README.md`
- `docs/plans/mcp-intelli-search/RESEARCH.md`
- `docs/plans/mcp-intelli-search/PHASE-0.md`
- `docs/plans/mcp-intelli-search/IMPLEMENTATION.md`
- Root `AGENTS.md`
- `test/fixtures/native-contract/README.md`
- `package.json`

Revision, tracking and file-existence inspection was allowed. Production/test source inspection, earlier sessions, previous scratch evidence, research caches and external research were excluded. The reviewer therefore classified externally sourced platform claims as stated evidence rather than independently verified facts.

The actual read-tool paths matched this permitted set. The only write-tool target was the designated report. The reviewer made no tracked-file changes.

## Independent Checks

Both checks ran in the primary checkout with temporary files directed into repository-local scratch:

```bash
node --import tsx --test test/native-contract.test.ts
node_modules/.bin/tsc -p test/tsconfig.native-contract.json
```

The fixture suite passed, and the type check exited successfully without diagnostics. The reviewer confirmed that the working tree remained clean and the fixture harness removed its temporary sandboxes.

The reviewer did not run live-provider tests, install dependencies, regenerate fixtures or begin implementation. The coordinator's post-correction build, full unit suite and primary live scenario also passed; those checks are separate from the independent cold-start review.

## Findings and Disposition

| Finding | Review Assessment | Incorporated Change |
|---|---|---|
| Universal No-Cross-Tool Claim | Nonblocking because the handoff already identified the old claim and preserved direct stage execution intentionally | Corrected `AGENTS.md` and `docs/ARCHITECTURE.md`: current hosts expose `ctx.executeTool()`, but the pipeline remains self-contained for baseline compatibility and reuse |
| Unscoped Package Name | Editorial drift in `AGENTS.md` | Changed the package identifier to `@curio-data/pi-intelli-search` |
| Incomplete Source Listing | Editorial drift in `AGENTS.md` | Included the configuration-recipe scenario, shared end-to-end helper and Phase 0 fixture/probe files |
| Different Version Figures | No contradiction; development pins, host versions and peer ranges serve different purposes | Added a concise distinction to the implementation compatibility contract; peer ranges govern the native floor |
| Missing Handoff Entry Point | An agent starting at `AGENTS.md` alone would not discover the plan | Added a direct link near the top of `AGENTS.md` and listed the plan directory |

The research record now describes the stale cross-tool claim as a resolved historical finding. Phase 6 retains the broader documentation-update task without asking a future agent to repeat this completed correction.

## Limits

The verdict applies to the original reviewed revision. The documentation corrections were verified by the coordinator; a second fresh GLM session was not run after those corrections. The raw reviewer report remains unchanged in local scratch, while this record summarises its findings and their disposition.

This review does not establish future shared-engine parity, minimum-host runtime compatibility, standalone provider wire correctness or actual MCP/plugin interoperability. MCP means Model Context Protocol. Those remain the explicit gates in the implementation plan.

## Next Step

Begin [Phase 1](IMPLEMENTATION.md#phase-1-dependency-seams). Re-run the two entry checks, then introduce host-neutral operation, progress, model and package-identity interfaces. The first small checkpoint is an adapter that delegates to the current native `callLlm()` while preserving the frozen fixtures and native tool entries. Do not scaffold the MCP server or move retry policy first.
