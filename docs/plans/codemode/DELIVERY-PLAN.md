# Codemode Delivery Milestones

## Status

The owner adopted this execution-plan revision based on source at `3d4a13e`; [Delivery Decisions](OWNER-DELIVERY-DECISIONS.md) records the exact approval and requested models. This is not implementation acceptance. It replaces small prerequisite-sized delivery units with substantial integrated outcomes. It does not alter the frozen [contract](CONTRACT.md), [interfaces](API.ts), [native interfaces](NATIVE-API.ts), [acceptance map](ACCEPTANCE.md), accepted source history or R1/R2 release split.

Combined P4-research/P5 delivery and isolated new-module delegation are approved. Apply the recorded sequencing interpretation and restricted builder boundaries; central integration remains coordinator-owned. All unchanged behaviour, safety and release gates remain binding.

## Authority and Adoption

The frozen contract and acceptance map remain authoritative. M1 uses `.tmp/codemode-p4-core-results/SLICE.md`; M2 co-delivers the research remainder under the recorded owner-approved sequencing interpretation. No temporary legacy research producer is commissioned.

Current continuation uses these milestones. Earlier procedural separation and pending-decision wording are superseded; historical acceptance records are not. No procedural document overrides a conflicting frozen requirement; an actual semantic/interface change still requires specification revision.

## Assessment

Research is the critical path. `src/core/operations/research.ts` still uses legacy barrier fetching, publication and return shapes. The accepted registered projections cover search, extract and collate through native and Model Context Protocol (MCP) adapters; `fetchPage()` already implements its public signature. `src/core/output-schemas.ts` has no research schema or complete five-operation map. `src/native-injection.ts` describes a factory but does not implement it. Complete research replay needs the bounded fetch path, which registered research does not yet consume.

The current separation risks implementing research's full inventory, persistence and failure mapping on the legacy pipeline and then replacing it for streaming, deadlines and drain. The proposed M2 builds those together once. It retains the requirements and coordinator ownership, but its sequencing needs an explicit decision because the frozen stage table makes P4 integration a P5 prerequisite.

Parallel work reduces elapsed time only where dependencies and file ownership are independent. More agents editing the two adapter runtimes, schemas and research entrypoint would increase integration work. The coordinator remains the single owner of those files.

Source assessment: `.tmp/agents/codemode-delivery-replan/reports/review.md`. Its conclusions distinguish inspected source from inferred scheduling benefits. No speed-up, completion percentage or hours estimate is established.

## Delivery Milestones

| Milestone | Integrated Outcome | Required Exit | Dependency |
|---|---|---|---|
| M1: Public Manual Workflow | Public search, extract and collate return settled full results/errors through both adapters, alongside the accepted core fetch operation. Existing legacy helpers retain characterised behaviour | T15/T17/T18/T20 for these operations, unchanged native standalone/MCP policy, compact size/redaction and actual adapter-output schema checks, useful partial accounting, captured configuration consumers, unchanged legacy fixtures and MCP joined-waiter proof | In progress under coordinator authority; current checkpoint is unreviewed, not acceptance |
| M2: Complete Research Engine | One research implementation delivers bounded fetch, barrier/streaming execution, deadlines, frozen evidence, drain, new publication, full results and honest progress through both adapters | Integrated research portions of T03/T04/T06–T12/T14–T20/T22/T24/T26/T27; full five-operation schema map, effective counts and no detached work. Real-adapter C06 qualification is required, not inferred from deterministic helpers | M1 and the recorded sequencing decision; approved isolated helper work can precede integration |
| M3: Replay and Native-Wrapper Readiness | Immutable native factory, actual registered-wrapper/Codemode replay, observer discrimination, parser follow-ons and the temporary R2 wrapper/widget/manual-workflow proof | T30/N1 and the C33/T33 dry run against all public R1 APIs; fixture misses fail closed with zero pipeline network. Remaining P4 obligations must be closed before claiming P4 exit | Coordinator schedules factory work after M2 integration, or only while M2 is paused; complete research replay and dry run require M2 |
| M4: R1 Qualification and Delivery | Behaviour/recovery guidance matches proved replacement; installed/floor/platform/security/live verification, direct A freeze and final combined reviews support a release decision | Applicable P4b/P6 T01/T03/T06/T18/T20/T21/T25–T29/T31–T33 obligations, all carried residuals and separate owner release/merge decisions. MCP publication and registry-pin/plugin verification precede native staging | M2/M3, applicable approvals and accepted layout evidence |
| M5: Native Codemode Feature | Native-only output/exposure, gated fetch, lifecycle-safe widget and bounded manual examples against frozen R1 | P7 portions of T05/T15/T20/T34. No shared-core or MCP repair is hidden in the patch | Frozen R1 prerequisites and direct A; preserve separate R2 candidate |
| M6: R2 Qualification and Delivery | Native compatibility, parent-cancellation, widget, packaging and approved A2/B/C evidence support the second release decision | P8 gates including applicable T01/T05/T15/T20/T29–T34, final combined reviews and separate publication decision. D is claim-dependent and separately approved | M5, required credentials and exact study approvals |

M1 is not a claim that the research API or full P4 is complete. M2 is not permission to skip M3 or qualification. The milestones are delivery units; the frozen C/T identifiers still determine which proofs are required. T29 exposure/partition provenance, T31 recording/cost isolation and T32 calibration/judging apply wherever an approved study runs, including P6 pilots and P8; deferred studies retain incomplete rows and no associated claim. P4's T03/T28 work and their later P6/P4b portions remain explicit.

### M1 Scope

The coordinator completes public `Context`/`CoreResult`/`OperationFailure` use for search, extract and collate, reusing the accepted projection and publication logic. Host-neutral production lives in core; native reconstruction and MCP redaction/compact output remain adapter responsibilities. Remove duplicate production without forcing identical host policy or error delivery on old hosts.

Close nearby residuals in this candidate rather than create separate deliveries: MCP's actual-runtime joined-waiter witness; schema-valid redaction; positive native store-diagnostic forwarding; duplicate warning handling; configuration-consumer assertions; and the migration-notice regression or explicit release deferral. Diagnose the retained MCP progress failure; if it depends on research's new progress flow, carry its concrete disposition into M2 rather than claim it fixed.

Main conflict surface: `src/core/contracts.ts`, `execution-contracts.ts`, `operations/{search,extract,collate}.ts`, result/schema exports and both adapter runtimes. These remain coordinator-owned. The public legacy migration mechanism is an implementation choice to prove, not a new API contract to invent here.

### M2 Scope

The coordinator integrates research once against the accepted lease, ledger, clock, fetch client and run store. The work includes candidate-order identity, pre-ID URL filtering, bounded staging/backpressure, both page execution modes, C08 timing and equal-time precedence, sticky cutoff, independent discovery cancellation, late drain and settlement, source-ID collation, verified publication and final same-ledger accounting. It migrates tests from the legacy page-fetch injection to the real lower transport seam. T26/T27 integration preserves current-compatibility-key exclusion, verified new/legacy candidates and one selected array for judge numbering and parsing, without introducing a new relevance policy.

Write `run.json` after page/discovery drain and before suggestions, from the same frozen nonempty evidence used for collation. Preserve the reservation and publication linearisation protocols. Keep useful results on persistence failure and advertise paths only after commitment. Add the research schema, full/compact mapping, configuration consumers and correlated progress in the same integrated candidate.

The 5,000-millisecond C06 target includes real adapter readers, child closure, processing, writers and cleanup. Do not abandon work, shorten observations or substitute helper timing. The installed full-operation, positive verified HTTPS, environment/executable, codec/platform and memory qualifications remain required at their applicable M2/M4 gates. Record failures as blockers or explicit unverified support limits; do not convert them into passes.

### M3 and M4 Scope

M3 uses real policy/admission/accounting inside actual wrappers and the actual bridge. Pipeline model, page and catalogue replay never falls back live. Main-provider traffic in any separately approved live population remains explicitly identified. Keep native wall time and injected-clock experiments separate.

M4 carries the remaining release conditions: pacing/capacity disclosures; now-false serial-default guidance; new layout and legacy-suggestion effects; receipt/`close()` API documentation; unpaired-page navigation; lock/backend limitations; mixed-writer and installed persistence proof; scan/cap and growth evidence, including near-limit queries and repeated corrupt-index rebuilding. Recovery guidance follows proved behaviour and preserves all historical/orphan evidence. No history-policy redesign, automatic deletion or namespace reset is introduced.

Documentation drafts can run ahead. Corrections describing already accepted admission/pacing behaviour discharge carried review release conditions; they do not claim P4b layout/T28 entry or exit. Archive/layout promises and permission-hint changes land only after their replacement is implemented and proved. Root README and shared guidance are hand-edited sources; derived README/plugin files are generated by one owner.

## Herdr Work Allocation

Use at most two implementation support builders plus one documentation owner alongside the coordinator. Use the owner's requested _Claude Code_ Opus 5.5 and `Pi` GLM 5.3, verifying exact model availability/provenance at commissioning; exclude the orchestrator's model. This is a capacity limit for the proposed workflow, not a measured optimum. No builders are commissioned by this document.

Prioritise Deadline and Staging in the two approved support slots, finishing or parking any early replay work at a preserved commit if needed. Publication, qualification and remaining replay work then reuse freed slots. Real-prompt fixture binding waits until M2's request shapes are fixed. These are assignment waves, not four simultaneous builders.

| Track | Initial File Boundary | Dependency and Delivery | Authority |
|---|---|---|---|
| Coordinator | Central contracts/settings/schemas, operation integration, native factory/context/registration and both adapter runtime cutovers | M1 first; M2 integration; M3 actual factory/wrapper wiring. Own combined candidate and acceptance | Existing coordinator ownership |
| Replay Support | Assigned `scripts/benchmarks/` parser/resolver helpers and matching dedicated benchmark tests; no native runtime or central contracts | Start alongside M1. Deliver generic request/occurrence mechanics, ambiguity rejection, `details.tool` fallback and mixed-usage fixtures. Bind real-prompt mappings only after M2 fixes the requests; complete wrapper/bridge proof remains M3 | Within existing P3 library boundaries, subject to an explicit new brief |
| Deadline Support | Proposed new `src/core/page-deadline.ts` and its dedicated tests only | Existing clock interfaces permit early work. Deliver the complete C08 transition matrix before M2 integration | Approved isolated-module delegation |
| Staging Support | Proposed new `src/core/page-staging.ts` and its dedicated tests only | Deliver bounded spool ownership, cancellation/cleanup and containment before M2 integration | Approved isolated-module delegation |
| Publication or Qualification Support | A separately assigned new research-publication helper or new T28 qualification harness, with its own tests; never concurrent ownership of the same file | Publication follows coordinator-defined snapshot inputs; qualification can use accepted collate output. Reuse a free support slot rather than spawn another permanent track | Approved isolated-module delegation |
| Documentation Owner | Canonical README, shared guidance and selected architecture/recovery notes, with generated artefacts assigned to one owner | Draft alongside M1/M2; land each behavioural claim only after its required proof. R2 examples remain after the R1 freeze | Existing P4b documentation-owner role |

Read-only diagnosis can be assigned to a spare reviewer slot. It is not a substitute for implementation capacity. Native factory/registration changes are **not** delegated: C02 keeps those central seams with the coordinator.

### Dispatch and Integration

1. The coordinator writes one milestone scope and short internal module contracts: inputs/outputs, cancellation/ownership, fixture expectations, allowed files and exact base. Internal helper signatures do not amend the frozen public API.
2. Create each implementation worktree from the same committed base under `/srv/secure/repos/CURIO/.worktrees/pi-intelli-search/`. Use one [_Herdr_](https://herdr.dev) workspace per worktree and one tab per agent, with verified encrypted mounts.
3. Provision real local dependencies for tracks that install/build packages, owned scratch and independently allocated ports where needed. Never install through a primary-checkout dependency link. Give ignored evidence through explicit absolute read-only paths or verified copies; Git does not carry it. Do not copy credentials or mutable profiles.
4. Brief builders at spawn with disjoint files, clause/test IDs, no central edits, no agent spawning and exact report paths. Changes needed outside their boundary are proposals for the coordinator, not unilateral edits.
5. Apply the current prose-review rule to documentation as well as code messages. Sol-orchestrated work retains the standing separate-self-review exception; if another orchestrator takes ownership, commission the required Sol prose review. Independent technical fidelity review remains mandatory. Run TOC, README and plugin generation/drift checks in the serial validation lane for each applicable documentation landing.
6. Editing and inspection can proceed in parallel. Validation uses one coordinator-controlled lane: pause competing tracks for full gates, shared-state tests, packaging and formal review. Isolated targeted tests must use owned state and the assigned validation slot. Do not use separate worktrees as an excuse to run full gates alongside active builders/reviewers.
7. Collect commits and reports, preserve reviewed history through merges, and integrate in dependency order. Pause builders at the integration barrier. A support module is not accepted as a completed milestone merely because its own tests pass.
8. Run the integrated candidate's required deterministic, type, generator, install and security gates. Commission independent exact-candidate technical review with blocking delta resolution, retaining actual model/context provenance. Any specialised reviewers in the same round use non-overlapping review assignments and the same candidate; gate execution remains serial.
9. After acceptance and acknowledgement checks, run the mandatory native `01_main.sh` once for the integrated milestone under standing branch approval and the fresh safe-auth procedure. A diagnosed necessary rerun is preserved and paced. Other live scenarios, studies, staging, publication and merge retain separate approvals.

A new worktree is never removed before its ignored evidence is preserved. A model quota stop is not a completed report; retain it and follow the roster/owner rules rather than silently changing a required reviewer.

## Reduced Process Overhead

Use each integrated milestone as the formal acceptance and mandatory-regression unit. Internal commits remain small enough to inspect, but are not separately announced as accepted product slices. Run required validation for completed changes; do not waive repository checks or leave an untested change labelled complete.

One fresh independent technical review, followed by necessary blocking delta review, is the default milestone cycle. Keep final combined Opus/K3 reviews at P6/P8. Additional informal review is risk-driven, not another compulsory round for every helper. Acknowledgement-fidelity review is needed when evidence claims materially change, not automatically for recording a passing run.

Maintain a short current resume and one milestone record linking exact source, tests, report digests, failures and pending conditions. Preserve prior evidence without reproducing its narrative in each new checkpoint. Refresh manifests at the accepted milestone or actual handoff. An unprimed cold-reader review is for an actual fresh-agent handoff or explicit request, not an automatic post-commit loop. Note-only changes do not trigger another live regression. They still receive applicable deterministic verification, including the strict accepted-plan gate, TOC/README/plugin drift checks and affected tests; no completed change is exempt from required validation.

These changes consolidate work; they do not change safety, exact-candidate review, approved cost boundaries or the mandatory checks.

## Recorded Owner Decisions

### Combined Research Delivery

The owner approved co-delivery and joint acceptance of the remaining P4 research result/schema/producer work with P5's research integration, while retaining every frozen behaviour and public signature. The recorded decision adopts the independently assessed sequencing interpretation; preserve technical fidelity in milestone review. Do not claim P4 exit before its rows and the temporary wrapper dry run actually pass. If the chosen sequencing cannot be reconciled with the frozen stage-entry wording, follow the explicit specification-revision procedure rather than silently edit that bundle.

The sequencing approval is limited to joint delivery and acceptance, not an already passed P4/P5 gate.

### Isolated-Module Delegation

The owner approved support builders for new deadline, staging, publication and qualification modules with isolated tests and coordinator-defined internal contracts. Central files and `research.ts` remain coordinator-only; the coordinator owns integration, cancellation/provenance semantics and acceptance. This does not transfer release ownership or standing regression approval to another branch.

The first approved support assignments are Deadline and Staging. They do not own central integration or authorise a model substitution.

## Unchanged Programme Gates

R1 remains a shared minor and R2 a native-only patch. Preserve direct A and the R1 candidate before P7; no shared repair moves into R2. Reconcile versions/registry/primary ownership at the actual release gate, and obtain the owner decisions on candidate/release branches, merge ownership and merge to `main` at P6/P8. Define the branch-completion event and any transfer of standing regression approval there, not by assumption now.

The exact paid tranches, D6 confirmatory design, D7 causal ablation, human-checked disjoint calibration, prescribed subscription main/judges and separate failure/cost accounting remain unchanged. Deferred studies remain incomplete with no claim. Implementation tracks start only through explicit scoped commissioning under the recorded delegation; neither this plan nor its review starts a study, another live scenario or a release.
