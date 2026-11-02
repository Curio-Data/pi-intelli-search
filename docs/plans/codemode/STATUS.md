# Codemode Research Status

Current direction: research first, under the [2 November 2026 Owner Decisions](OWNER-REFOCUS.md). Start with [Resume](RESUME.md) and follow the [Research Plan](RESEARCH-PLAN.md). No Codemode benefit has been measured. The branch is not complete until the code, measured data, reproducible analysis and publication-ready report exist.

## Current Implementation Checkpoint

The accepted foundations remain in this branch. They are not experimental results:

| Component | Position |
|---|---|
| Public Operation Results and Accounting | Implemented; earlier M1 acceptance retained |
| Bounded Parallel Research, Streaming and Deadlines | Implemented; earlier M2 acceptance retained |
| Native Replay and Verified Suggestion Views | Implemented; earlier M3 acceptance retained |
| Structured Native Output, Matched Fetch Interfaces and Examples | Test-only wrapper prototype exists; experimental integration remains |
| Main-Usage Metadata | Collector and scripted tests exist; real selected-provider field coverage remains to be checked |
| Experiment Runner | Recording/replay/statistics libraries exist; full study orchestration and publication pipeline remain |
| Research Data and Findings | No completed off/on measured series or publication dataset |

`src/native-registered-tools.ts` still registers four tools without the proposed native output schemas or script-only fetch. `test/native-replay-r2.test.ts` deliberately tests a prototype and production non-activation. Do not report that test as completed feature integration. `scripts/benchmarks/README.md` records the unresolved uncached-token observation issue.

The current task is a bounded measurement/integration candidate, then pilot, independent measured series and publication package. It is not another M4 release-qualification slice. Earlier M1–M3 labels identify preserved acceptance history only; [Development](DEVELOPMENT.md) holds the supporting records.

## Scope Removed from the Critical Path

The egress-monitor investigation is stopped by owner direction. R16 remains historically blocked; it is neither integrated nor reclassified as passing. There is no pending threat-model question to answer before research development. Old-host, broad platform, package-release and separate deadline/query-expansion studies are deferred. Main-package incorporation and an impact statement for older hosts follow only if the research supports that decision.

A previously observed dependency-audit finding remains disclosed in the preserved records. No dependency repair or new security exploration is commissioned. Report an encountered security question to the owner in plain terms. This is not a claim that known findings were fixed or that credential care is unnecessary.

## Branch Cleanup

The pre-cleanup source commit was `748e5deaf21e88c34efd3be9dd2dc57d2c39d02a`. The accepted runtime source and dependencies are unchanged by the cleanup.

The pending 22-file legacy-harness overlay is parked, not discarded, under `evidence/codemode/20261102T133135Z-research-refocus/pending-legacy-harness/`. It contains full file copies, exact hashes and a tracked-file patch; the original untracked `trace-verdict.mjs` is included as a file copy. Those working paths were restored to the committed baseline. The README badge returned with that older test population. Do not run the restored legacy scripts: their pending cache-discovery and retry/verdict changes are parked with the overlay, although some scripts already had earlier immutable-cache support. The new study needs its own bounded runner, not this release suite.

The separate changelog, cache-guide and benchmark-guide corrections are retained. Previous monitor notes remain in Development as history. The original owner exchange, pre-cleanup navigation and complete dirty diff are retained under `evidence/codemode/20261102T133135Z-research-refocus/`. These local evidence files do not travel with Git; a fresh session uses this retained worktree. No historical evidence directory or unrelated scratch was deleted.

## Authority and Validation

The new owner decisions supersede old scope and sequencing instructions, including the former security pause and release-first milestones. The frozen contract/API/method/corpus acceptance files and checker are preserved unchanged. `npm run check:codemode-plan` is an integrity check on that historical accepted foundation, not the new study's execution authority. New protocol, corpus and run manifests must be explicitly versioned before capture. Historical acceptance details remain in `acceptance.json`, Development and Git at `748e5de:docs/plans/codemode/STATUS.md`; the pre-cleanup evidence copy also retains the later uncommitted R16 notes. Those records explain earlier results, not current next steps.

This cleanup creates no research run, credential preparation, new paid ledger, package staging, publication or main merge. The research spending approval and USD 30 ceiling are recorded in Owner Decisions; remaining allowance must be reconciled before paid calls. No fresh full allowance is implied by a new session.

Cleanup build, native/standalone tests, native-contract types, historical plan integrity, generator and whitespace checks pass; their commands and outcomes are retained under `evidence/agents/codemode-refocus-20261102T133135Z/gates/`. Security investigation and historical paid scenarios were not run. Handover review status and exact reports are recorded in that evidence root's `CHECKPOINT.json`; read the completed reports before relying on a readiness verdict. Handover readiness does not establish experimental results.
