# Codemode Acceptance Map

Specification revision: `P0-1`. [CONTRACT.md](CONTRACT.md) defines each rule once; [API.ts](API.ts) freezes signatures. This map specifies future proofs, not completed feature tests. Current review/acceptance state is [STATUS.md](STATUS.md). Every eventual result records clause/test ID, candidate commit, command, environment, evidence path and observed outcome. Existing baseline tests do not establish new behaviour.

## Requirement Map

| ID | Clause | Owner / Stage | Required Test and Exact Observation |
|---|---|---|---|
| T01 | C01 | Coordinator, P6/P8 | Candidate diff proves R1 contains shared prerequisites and R2 changes no core/MCP implementation; approvals and MCP registry verification precede native staging. |
| T02 | C02 | Coordinator + Independent Reviewer, P0 | Accepted contract/corpus/method commit and fresh exact-revision technical report exist; builder bases carry the accepted commit and the coordinator's matching type-seam descendant. |
| T03 | C03 | Coordinator, P4/P6 | Exact defaults and every range/boundary validate before inference; disabled deadline has no implicit enabled values; barrier+deadline and aggregate cap one reject; zero MCP queue permits immediate work; no paid call before tranche approval. |
| T04 | C04 | Coordinator, P5 | Normal/degraded/error/abort from every state leaves no owned task, timer, permit, reader, file writer or callback after operation settlement; shared catalogue waiter ownership is separate. |
| T05 | C05 | Native Owner, P7/P8 | Real parent-cancellation trace distinguishes parent return from nested settlement; any unavailable late parent usage is explicitly incomplete, never counted twice or called zero. |
| T06 | C06 | Coordinator, P5/P6 | Prespecified 5,000 ms abort-to-settled target includes real adapters, queued admission, annotations and file cleanup. An uncooperative dependency fails the gate; no detached timeout race passes it. |
| T07 | C07 | Coordinator, P5 | Reordered page completions preserve source IDs; frozen nonempty snapshot alone drives citations/provenance; no future path is supplied as model evidence. |
| T08 | C08 | Coordinator, P5 | Injected-clock cases cover N=0/1/2/odd/even, no quorum, failures before successes, empty evidence, all-terminal before floor, ordinary even median, clamp/minimum/ceiling, both equal-time delivery orders and the minimum-trigger exception; disabled mode creates no cutoff. |
| T09 | C09 | Coordinator, P5 | Queued page/pacing calls and fetches stop at freeze; no page retry starts afterwards; active extraction can finish during collation/drain; drain end actually settles; late files never enter report evidence. |
| T10 | C10 | P1 Library + Coordinator P5 | Replacement has zero old/new active-work overlap; registration creates no timer/process; stale/shutdown callbacks cannot affect new generation; operation/ticket ceilings reject before work; close is idempotent. |
| T11 | C11 | P1 Library + Native/MCP Integration | Each retry reacquires admission and releases before backoff; attempt timeout excludes queue wait; error-bearing responses report observations before failure conversion; SDK policy is invoked once and SDK retries are disabled. |
| T12 | C12 | P1 Library + Coordinator P5 | Per-run/aggregate limits hold; page-eligible capacity and effective count exact; all page slots held by late attempts still leave critical eligibility; three/one dispatch plus operation round-robin has the declared grant order. |
| T13 | C13 | P1 Library | Cancellation during capacity, pacing and backoff leaves no permit or future reservation; actual start alone advances spacing; no active permit is held for a pacing sleep. |
| T14 | C14 | Coordinator, P4/P5 | Two real MCP protocol calls overlap; serial control does not; queue zero/full/close and abort listener cleanup exact; single-flight TTL, independent/last-waiter cancellation, drain/new-waiter race and runtime shutdown hold. |
| T15 | C15 | Coordinator, P4/P7/P8 | Direct native standalone retry/timeout remains unchanged; MCP explicit policy remains; every supplied manual script has finite budget/fan-out; actual stalled-body cancellation and incomplete-parent disclosure pass. |
| T16 | C16 | P1 Ledger + Native/MCP Integration | Native uncached/cache components and MCP prompt totals normalise to equivalent canonical fixtures; cumulative updates not summed; success/error/empty/retry/abort/unknown, reported/catalogue cost and telemetry-off results preserve completeness. |
| T17 | C17 | Coordinator, P4 | All five operations validate full shapes on success/degraded/error/abort; legacy fields agree with data; failure partial accounting reaches adapters where deliverable; zero-input collate remains an error; no raw research page content leaks into text/inventory. |
| T18 | C18 | Coordinator, P4/P6 | Matched old payloads plus maximum/non-ASCII/degraded/error cases preserve complete text/details; new metadata overhead <=8,192 encoded bytes; overlong valid paths omit only compact optional path; clean host captures establish actual model-visible representation. |
| T19 | C19 | Coordinator, P4/P5 | Real dual-fetch/probe/document paths all hold physical admission through body settlement; decoded compressed/chunked/no-length bodies obey byte limits; returned-char truncation labelled; staging backpressure bounds retained pages; no invented fetch model usage. |
| T20 | C20 | Coordinator, P4/P6 | All operations produce correlated progress and monotonic display percentage; late page events do not rewind global phase; floor host/facade/citation fallback and stdout/UI safety pass; collate remains sequential. |
| T21 | C21 | P2 Library + Coordinator P6 | Namespace avoids legacy/reserved names; actual old/new processes write the same configured parent without touching each other's metadata; portable path tests pass; platform evidence and any unverified persistence limitation are explicit. |
| T22 | C22 | P2 Library + Coordinator P5 | Forced ID collisions never overwrite empty/nonempty targets; incomplete/missing/bad markers are invisible; telemetry-off still publishes marker; required hash/path set validates; marker/index failure and writer settlement are independent. |
| T23 | C23 | P2 Library | Process crash at each append/sync/reservation/marker boundary never reuses a granted sequence; gaps accepted; partial tail/missing journal/conflicting markers fail publication closed; rollback/midnight do not reorder same-key new entries. |
| T24 | C24 | P2 Library + Coordinator P5 | Allocation/journal/marker failure retains a useful source-ID-only answer without missing paths; index failure preserves committed report; failed attempts/orphans retained; benchmark persistence validity does not silently erase quality/cost observations. |
| T25 | C25 | P2 Library | Independent-process contention, killed owner, duplicate release and bounded abort waits obey no-eviction lock; no age/PID/token deletion path exists; only acquiring owner removes lock once; stopped-writer operator recovery preserves evidence. |
| T26 | C26 | P2 Library + Coordinator | Baseline slug dedup/current exclusion/window are characterised; date/query compatibility key prevents duplicate floods without domain/focus grouping; highest-admission success wins; stable two-list merge/ties/legacy missing provenance/clock rollback exact; no new cap/previous link or future-policy experiment. |
| T27 | C27 | P2 Library | Verified new and legacy readers reject corrupt/unsafe/missing/uncommitted reports; old files untouched; no invented legacy sequence; prompt and parser share one candidate array; corrupt secondary input preserved before rebuild. |
| T28 | C28 | Coordinator, P4/P4b | Whole-parent scan handles owned-temp disappearance but rejects root/link changes; history growth/cap measured; recovery/orphan/archive docs match proved layout; generators/hints/fixtures and applicable prose review pass; no automatic sweep/deletion. |
| T29 | C29 | Coordinator, P0/P3 | P0 manifest/hash checker proves global IDs/partition membership and frozen exact inputs; source-only A0 identified as non-live; later recording logs exposure and never relabels tuning/calibration material held-out. |
| T30 | C30 | P3 Library + Coordinator | Actual native wrappers/real Codemode bridge consume complete fixtures including model usage/citations/suggestions; repeated calls/path binding/loader isolation/miss have exact outcomes; misses make zero live calls; mixed assistant/tool/nested/turn-repeat fixtures count once; actual payload markers are captured. |
| T31 | C31 | Coordinator, P3/P6/P8 | Worktree overrides yield only the intended tool catalogue/settings/model per arm; subscription/main costs separated; all paid calls share tranche ledger; failure/unknown charge retained; next tranche follows actual-cost report; native controls use same main model. |
| T32 | C32 | Coordinator + Judges/Owner | Both fresh blinded judges use identical rubric/order balancing with disjoint human calibration; same-model judge bias/disagreement preserved; clustered paired endpoints and later margins enforced; separate causal claim only with funded prespecified ablation. |
| T33 | C33 | Coordinator + Independent Reviewers | R2 wrapper dry run type-checks/fixture-passes against R1 with no core/MCP repair; all required build/install/security/live gates and actual new end-to-end scripts pass; final implementation/evidence review is new. |
| T34 | C34 | Native Owner, P7/P8 | Full schema values are script-visible; unsupported hosts register no fetch; parent-interleaved/missing-end/abort/run/session/reload cleanup preserves other rows; narrow/wide/combining/resize rendering and no raw-console pollution pass. |

## P0 Exit Checklist

P0 ends only when all of the following are recorded in STATUS:

1. Applicable owner scope/default/output/timeout/model/isolation choices are settled or explicitly deferred to their permitted later gate. No new history-policy choice is demanded here.
2. Coordinator selections in C03/C06/C08/C10–C14/C18/C21–C27 are concrete, including exact filesystem protocol, cancellation target and compatibility selection rather than open alternatives.
3. API declarations and consumer type-check pass. Every C01–C34 has an acceptance row and accountable stage.
4. Corpus files, exact expansion inputs and each partition/method hash pass the deterministic checker. Confirmation reserve is labelled as reserve, not claimed sample size/power.
5. The old source baseline and changed notes are preserved; all documentation/probe checks list actual results and limitations.
6. A tracked specification commit is reviewed by a fresh independent rostered Reviewer through Herdr. Findings are resolved on the reviewed final revision, with native model provenance and report digest recorded.
7. The coordinator accepts that final revision and records the accepted commit. Applicable prose review follows the house roster rule; when the prose reviewer model orchestrated the work, record its standing exception and use independent review rather than self-review.

None of T04–T28/T30–T34 is claimed implemented by P0 exit. P0 freezes those tests and interfaces so library work can begin. Real-adapter cancellation, loader/replay integration and publication crash proofs remain implementation gates; a contract review cannot pass them.

## Stage Entry and Ownership

| Stage | Entry | Library / Integration Ownership | Exit |
|---|---|---|---|
| P1 | Accepted P0 documentation; coordinator's matching type-only seam descendant before builders | Builder A: `src/core/execution-coordinator.ts`, `src/core/usage.ts`, isolated tests. No central settings/research edits. | T10–T13/T16 library proofs; adapter integration remains coordinator-owned. |
| P2 | Same accepted base/type seam | Builder B: `src/core/run-store.ts`, `src/core/run-index.ts`, independent-process/crash tests. No central wiring. | T21–T27 library proofs; retain no-eviction/no-reset protocol. |
| P3 | Accepted corpus/interfaces | Builder C: `scripts/benchmarks/` recorder/replay/observer/parser/statistics and isolated fixtures/tests; coordinator owns native injection seam. | T29–T32 synthetic correctness and miss proof; no paid fallback. |
| P4 | Libraries ready | Coordinator: full results/progress/config, bounded fetch and native/MCP adapters/queue/catalogue, exact schema fixtures. | T14–T20 and temporary R2 dry run. |
| P4b | Accepted P2 layout implemented/proved | Coordinator/documentation owner: behaviour descriptions, guidance, hints, generators, recovery and architecture. | T28 reviewed generated artefacts. |
| P5 | P1/P2/P4 integrated | Coordinator alone wires `src/core/operations/research.ts` and ownership/deadline/provenance flow. | Complete integrated deterministic matrix and real-adapter cancellation. |
| P6 / R1 | Integrated candidate + applicable tranche approval | Sequential coordinator gates and frozen direct A; both package minor release preparations. | Live/install/security/independent code-evidence review and separate owner release decision. |
| P7 | R1 prerequisites/direct A frozen | Native-only schema/exposure/widget/examples; no shared/MCP repair. | T05/T15/T20/T34 and native-only diff. |
| P8 / R2 | Native-only candidate + applicable tranche/study approvals | Sequential A2/B/C and claim-dependent D, final reviews and package gates. | Separate owner publication decision; no automatic completion of deferred studies. |

## Commands and Evidence

For this documentation freeze, run:

```bash
node scripts/check-codemode-plan.mjs
node_modules/.bin/tsc -p docs/plans/codemode/tsconfig.json
npm run build:all
npm run test:all
node_modules/.bin/tsc -p test/tsconfig.native-contract.json
npm run check:toc
npm run check:readmes
npm run check:plugins
npm audit --audit-level=low
```

Set child-process scratch and package-manager cache under the encrypted worktree's `.tmp/`. These are baseline regression and contract-shape checks, not new feature acceptance. The private P0 evidence manifest records actual command exits and file hashes. No paid main research or live end-to-end driver is required to change internal contract documentation; do not call the live release gates passed or waive them. Later release checks include both fresh tarball installs, embedded dependency inspection, shellcheck and the complete paced live suite under repository instructions. Never run shared-key drivers or shared-state integration gates concurrently with an active builder/reviewer.
