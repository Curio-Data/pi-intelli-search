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
| Main-Usage Metadata | Correlated per-request input/cache fields observed in completed multi-turn development sessions; checks remain mandatory for every future run |
| Experiment Runner | Integrated driver and bounded real single-task capture/replay/live sequence verified; remaining workflows have scripted host coverage |
| Research Data and Findings | Versioned one-task development diagnostic bundle exists; pilot, quality scoring and the independent measured series remain |

Production `src/native-registered-tools.ts` still registers four tools without output schemas or fetch. The separate `src/experimental/codemode-study.ts` registers structured results and capability-matched fetch through the actual native runtime, without the old prototype's search-operation substitution. `test/native-study.test.ts` exercises its direct and script paths, transport replay and cache follow-up on the pinned host. `test/native-replay-r2.test.ts` remains historical prototype evidence, not proof of the new entrypoint.

## Measurement and Integration Candidate

The 2 November 2026 candidate adds `scripts/benchmarks/study-host.ts`, `study-metadata.ts`, `study-workflows.ts` and `study-analysis.ts`. The last module regenerates paired estimates and tables offline from its declared dataset format; no measured-series dataset has yet been produced in that format. The [draft protocol and corpus](../../benchmarks/codemode-study-v1/README.md) are new inputs, not changes to the frozen historical method.

One real subscription metadata request is retained in `evidence/benchmarks/metadata-20261102T152129Z/metadata-20261102T153207Z-e9116d51/`. Its assessment establishes explicit input and cache fields with response-ID and canonical-message-hash correlation for that request. It does not establish nonzero cache behaviour, multi-turn coverage or a mode effect. The exact measuring source is retained beside the observation because later deterministic corrections changed the recorder. Main transport is pinned to server-sent events: the host's request hook does not expose the actual WebSocket input deltas.

The [spend baseline](../../benchmarks/codemode-study-v1/SPEND-BASELINE.json) reconciles retained engineering invocations and unknown-charge holds; it is not an account-debit audit. At that checkpoint no new paid pipeline request had been made. The owner supplied A verdicts for all four [calibration cases](../../benchmarks/codemode-study-v1/CALIBRATION-REVIEW.md), and criticised their triviality and uniformly positioned winners. The explicit decisions are retained in `evidence/benchmarks/codemode-study-v1/calibration/decisions.json`. These labels are sanity checks only, not judge validation; no repeat review of them is requested.

Validation and independent-review records belong to `evidence/agents/codemode-study-20261102T152129Z/`. Technical and prose delta reviews accept the bounded candidate, not paid readiness or completion of either research-plan step. `gates/final-*` records the passing build, isolated native/standalone tests, type checks, generators, historical preservation checks and pinned-host scripted checks. `CHECKPOINT.json` binds the final source and review records. The runner must preserve partial accounting and mark missing structured operation data invalid; no speculative error rewrite or packaging change was made. The experimental module is compiled but unregistered in production; packaging remains deferred. A builder overwrote one authored spend-baseline evidence copy during drafting; its exact prior bytes were recovered under a new name with a matching hash, and the correction note is retained in the spend evidence directory. Original receipts and source records were untouched. This candidate does not authorise a measured-series claim. At that checkpoint the actual session runner, finite paid admission, fixture capture and follow-up replay wiring were outstanding. The integrated candidate below addresses that work; pilot execution and the independent series freeze still follow review and live-main verification. The measured data, judged answers, shareable publication bundle and publication-ready findings remain outstanding.

## Integrated Driver Candidate

The next candidate starts from committed foundation `a29e0a4`. `scripts/benchmarks/study.ts` connects actual host sessions to bounded tool/model/page admission, a single append-only programme spend ledger, transport capture and F7 replay, complete observations and offline diagnostic exports. `study-design.ts` holds the matched execution profile and task schedules. `study-runner.ts` uses the real native runtime with immutable explicit settings, and binds native peer imports to the pinned host rather than development peers. Script classifier/image inference is disabled so the on arm gains no additional inference capability.

The actual-host scripted driver tests cover single, manual, parallel breadth and two-turn cache follow-up workflows through both catalogues, including complete F7 fixture consumption and zero live pipeline fallback. They remain synthetic-provider tests, not evidence of a live mode effect. The [runner guide](../../benchmarks/codemode-study-v1/RUNNER.md) documents commands, limits, source refusal, retained failures and accounting. Review and validation records belong to `evidence/agents/codemode-runner-20261102T164151Z/`.

The first real development capture on `44d614e` is retained under `evidence/benchmarks/codemode-development-20261102/`. It failed: the collation response exhausted its output budget in reasoning and produced no visible synthesis. A recorder witness then incorrectly inferred no allocation from `cache.status: not-requested`, despite retained allocation/failure notifications. The full reported charge is in the shared programme ledger with no unknown charge left over; `evidence/agents/codemode-runner-20261102T164151Z/FIRST-CAPTURE.json` records the diagnosis without changing the original result.

The correction uses actual store notifications for that witness and raises the matched collation allowance in both arms, without changing models, reasoning or source budgets. A changed-source technical capture uses a new series and explicit predecessor/reason metadata; the first failure remains retained. The corrected capture and both replay/live pairs completed on `68303cc`. Their raw records are retained under `evidence/benchmarks/codemode-development-20261102-r2/`; the corrected capture explicitly names its failed predecessor. The [versioned development bundle](../../benchmarks/codemode-study-v1/development-v1/README.md) contains the shareable observations, answers, per-request usage, routing, spending and reproducible diagnostic analysis. It reports increased uncached input in both pairs, not a benefit claim. Only one task has comparative data and quality is unscored.

Independent data review found that the original catalogue hash reader missed Responses declarations nested in `input[*].tools`. The observer now recognises that shape and records explicit absence/unsupported states. The shared bundle's metadata was corrected offline from the saved requests, with original values and correction provenance retained; raw requests, observation rows, run manifests, token counts and charges were not rewritten or rerun. The series exporter applies that transparent normalisation in new exports. The private correction record is under `evidence/benchmarks/codemode-development-20261102-r2/catalogue-correction-20261102T201509246Z/`.

Existing series are source-frozen: a later source commit needs a new series, not a silent resume or a repeated original cell. Do not repeat the successful single-task check merely because documentation was committed. Set `TMPDIR` to owned encrypted repository scratch in the shell before starting `node --import tsx`; setting it inside the driver is too late for loader caches. It is not another M4 release-qualification slice. Earlier M1–M3 labels identify preserved acceptance history only; [Development](DEVELOPMENT.md) holds the supporting records.

## Remaining Development Workflows

The 3 November 2026 continuation exercised the other three prescribed workflows on the pinned host. Build `77334a2` captured breadth in `evidence/benchmarks/codemode-development-20261103-r1/`; its off/on replay pair completed with full fixture consumption and consistent per-request evidence. Uncached main input was 6,835 tokens off and 12,931 on. Total input was 8,243 off and 12,931 on. The capture reported USD 0.06207658 in pipeline charges.

The managed installation then advanced to `Pi` 1.5.0. The next capture refused before inference, leaving no reservation or run. Commit `56043bf` adds the tested `--host-root` option, which selects the retained `Pi` 1.4.0 release explicitly without changing the managed installation. The remaining workflows use source-frozen series `codemode-development-20261103-r2`; prior series and observations were not rebound.

Manual capture and on-arm replay completed. Off-arm replay is retained as aborted and invalid after the main model omitted `strconv.Itoa(i + 3)` while copying a fetched page into `intelli_extract`. The exact request hash therefore had no fixture. The runner did not weaken replay matching or retry against live services. This cell has no paired token estimate. Its on-arm replay consumed every fixture and reported no new pipeline cash.

Follow-up capture and both replay arms completed, including the saved-report read and complete fixture consumption. Uncached main input was 7,533 tokens off and 6,717 on; total input was 12,141 off and 21,949 on. These are one-repeat development observations, not evidence of a general effect. Manual and follow-up captures reported USD 0.0298143 and USD 0.02054659 respectively. Study charges now total USD 0.17227591, with no new unknown-charge hold or active reservation. The offline development exports retain missing cells and unscored quality. Next work is the pilot's unforced live population and independent source-backed scoring, followed by the measured-series freeze.

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
