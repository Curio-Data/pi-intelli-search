# Codemode Research Status

Current direction: research first, under the [2 November 2026 Owner Decisions](OWNER-REFOCUS.md). Start with [Resume](RESUME.md) and follow the [Research Plan](RESEARCH-PLAN.md). No Codemode benefit has been measured. The branch is not complete until the code, measured data, reproducible analysis and publication-ready report exist.

## Current Implementation Checkpoint

The accepted foundations remain in this branch. They are not experimental results:

| Component | Position |
|---|---|
| Public Operation Results and Accounting | Implemented; earlier M1 acceptance retained |
| Bounded Parallel Research, Streaming and Deadlines | Implemented; earlier M2 acceptance retained |
| Native Replay and Verified Suggestion Views | Implemented; earlier M3 acceptance retained |
| Structured Native Output, Matched Fetch Interfaces and Examples | Branch-only entrypoint and bounded single, breadth, manual and cache-follow-up scripts implemented; actual-host scripted wrapper tests pass |
| Main-Usage Metadata | One real prescribed-main observation on the pinned host has correlated wire fields, including explicit cache components; multi-turn live coverage remains |
| Experiment Runner | Pinned-host recorder and offline analysis added; paid admission, capture/replay orchestration, scoring and publication integration remain |
| Research Data and Findings | No completed off/on measured series or publication dataset |

Production `src/native-registered-tools.ts` still registers four tools without output schemas or fetch. The separate `src/experimental/codemode-study.ts` registers structured results and capability-matched fetch through the actual native runtime, without the old prototype's search-operation substitution. `test/native-study.test.ts` exercises its direct and script paths, transport replay and cache follow-up on the pinned host. `test/native-replay-r2.test.ts` remains historical prototype evidence, not proof of the new entrypoint.

## Measurement and Integration Candidate

The 2 November 2026 candidate adds `scripts/benchmarks/study-host.ts`, `study-metadata.ts`, `study-workflows.ts` and `study-analysis.ts`. The last module regenerates paired estimates and tables offline from its declared dataset format; no measured-series dataset has yet been produced in that format. The [draft protocol and corpus](../../benchmarks/codemode-study-v1/README.md) are new inputs, not changes to the frozen historical method.

One real subscription metadata request is retained in `evidence/benchmarks/metadata-20261102T152129Z/metadata-20261102T153207Z-e9116d51/`. Its assessment establishes explicit input and cache fields with response-ID and canonical-message-hash correlation for that request. It does not establish nonzero cache behaviour, multi-turn coverage or a mode effect. The exact measuring source is retained beside the observation because later deterministic corrections changed the recorder. Main transport is pinned to server-sent events: the host's request hook does not expose the actual WebSocket input deltas.

The [spend baseline](../../benchmarks/codemode-study-v1/SPEND-BASELINE.json) reconciles retained engineering invocations and unknown-charge holds; it is not an account-debit audit. No new paid pipeline request has been made. The [human calibration packet](../../benchmarks/codemode-study-v1/CALIBRATION-REVIEW.md) is prepared and unapproved.

Validation and independent-review records belong to `evidence/agents/codemode-study-20261102T152129Z/`. Technical and prose delta reviews accept the bounded candidate, not paid readiness or completion of either research-plan step. `gates/final-*` records the passing build, isolated native/standalone tests, type checks, generators, historical preservation checks and pinned-host scripted checks. `CHECKPOINT.json` binds the final source and review records. The runner must preserve partial accounting and mark missing structured operation data invalid; no speculative error rewrite or packaging change was made. The experimental module is compiled but unregistered in production; packaging remains deferred. A builder overwrote one authored spend-baseline evidence copy during drafting; its exact prior bytes were recovered under a new name with a matching hash, and the correction note is retained in the spend evidence directory. Original receipts and source records were untouched. This candidate does not authorise a measured-series claim. Complete the actual session runner, finite paid-call admission, fixture capture and follow-up replay wiring; obtain human calibration and independent design acceptance; then execute the pilot and freeze the final series. The measured data, judged answers, shareable publication bundle and publication-ready findings remain outstanding.

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
