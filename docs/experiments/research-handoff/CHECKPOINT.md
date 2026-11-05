# Fresh-Agent Resume Checkpoint

Status: the owner approved the `rh-v4` question amendment on 5 November 2026, recorded in [the receipt](../../../evidence/agents/20261104T192721Z-research-handoff-m4/owner-cloudflare-question-amendment.json). The `rh-v4-r3` candidate passed deterministic validation, actual-host synthetic proof and byte-identical offline reproduction. Its technical reviewer accepted observer renewal, but its prose reviewer required one documentation-only correction round; `rh-v4-r4` carries those corrections. No Cloudflare experiment capture, symmetric observer diagnostic, MiniMax M3 charge qualification or measured conversation has run. Both rejected `rh-v3` PostgreSQL preparations remain closed with zero unknown holds and zero active reservations. Do not infer a comparison from synthetic or diagnostic records. This checkpoint is the fresh-agent handover; [Findings](FINDINGS.md) is the compact result record.

## Resume Here

Continue in the existing checkout:

```text
/srv/secure/repos/CURIO/.worktrees/pi-intelli-search/research-handoff-runner
branch: study/research-handoff-runner
```

Do not recreate, reset or retire this worktree. Preserve its ignored evidence. The outgoing handoff lead was `Pi`, `openai-codex/gpt-6-astra`. The incoming lead is `Pi`, `kimi-coding/k3.1-pro`; that coordinator model is excluded from the new review pool. The experimental main model is a separate, fixed assignment.

Read in this order:

1. This checkpoint, which supersedes older current-status and next-step prose in the handover and agent reports.
2. [Execution Plan](EXECUTION-PLAN.md), [Protocol](PROTOCOL.md) and [Reproduction](REPRODUCTION.md).
3. [Brief](BRIEF.md) and [Feasibility](FEASIBILITY.md) for the original scope and scientific controls. [Handover](HANDOVER.md) remains the commissioning record, not a fresh instruction to create another branch.
4. The historical pause receipt under `evidence/agents/20261104T160000Z-research-handoff-resume/`, which records the checkpoint commit, working-tree state, source/evidence inventory and checks at that pause. Its readiness, pending-review and unresolved-ledger fields are historical, not current authority.
5. The owner receipts under `evidence/agents/20261104T192721Z-research-handoff-m4/`: `owner-financial-amendment.json` for the historical `rh-v3` fixed envelope, which grants no `rh-v4` financial authority; and `owner-cloudflare-question-amendment.json` for the approved `rh-v4` stimulus, query, focus, domains and source cap. The question amendment is the current task authority.
6. The review reports and revision distinctions below.

The evidence directories are gitignored. They survive in this retained checkout, not in a clean clone or a newly created worktree. Do not clean them or substitute older scientific material when something is absent.

Historical entry verification was completed by the incoming lead before any authorised change. These commands passed against the committed pause snapshot at `065173b`:

```bash
sha256sum -c evidence/agents/20261104T160000Z-research-handoff-resume/source-final.sha256
sha256sum -c evidence/agents/20261104T160000Z-research-handoff-resume/implementation-final.sha256
sha256sum -c evidence/agents/20261104T160000Z-research-handoff-resume/evidence-final.sha256
```

`source-final.sha256` covers every changed handoff/source file from that pause, including the historical checkpoint bytes. `implementation-final.sha256` covers the broader pause implementation identity, including unchanged production source, governing documents and adapter dependency manifests. `evidence-final.sha256` covers the retained reports and synthetic evidence. The original unsuffixed manifests and `candidate.json` preserve the first cold-reader submission; the final inventories and `receipt.json` remain immutable historical evidence.

Do not rerun those manifests as a current-tree gate after the recorded M3 and `rh-v3` deltas. The accepted `rh-v3` verification basis is `candidate-rh-v3-r4.json` and its named evidence under `evidence/agents/20261104T192721Z-research-handoff-m4/`. The `rh-v4` question amendment is validity-affecting: that candidate remains the historical record of the `rh-v3` implementation but authorises no live work, and the working tree now carries the revised stimulus constants, revised tests and revised governing documents. A fresh candidate identity must be frozen and accepted through the renewed gates before anything is measured. An unexplained mismatch against a recorded receipt stops changes for read-only diagnosis and owner direction. Preserve all snapshots; none re-baselines another.

## Owner Authority and Financial Amendment

The owner accepted the plan and said:

> This looks great. Execute. As the orchestrator validate their work as it arrives.

This accepts the unchanged-text Codemode candidate, the proposed PostgreSQL 17 query and three parallel implementation tracks. The `rh-v4` receipt records the owner's later exchange and approval:

> I don't want to use documents up front. We need an alternative suitably challenging search request, something not in memory. For example, "When running Pi Durable on Cloudflare how do we enable outbound email with Cloudflare native services."

The owner then answered yes to the coordinator's D1, recorded in the receipt, approving the exact neutral query and focus as the replacement study task and superseding the PostgreSQL query. The candidate design and non-financial controls carry over through coordinator implementation choices. The question amendment grants no financial authority: a new narrow owner receipt with scope `continue-without-programme-ledger-rh-v4` is required before `admit`.

The owner first approved reservation-and-settlement appends, then reported that the historical ledger was permanently unavailable and directed continuation without it. The retained `owner-financial-amendment.json` under `evidence/agents/20261104T192721Z-research-handoff-m4/` records that decision. The accepted `rh-v3` boundary was a fixed USD 25.81 maximum experiment envelope for that identity; a new receipt is required for `rh-v4`. The proposed `rh-v4` accounting shape retains current-rate admission, per-attempt reservations, unknown-charge holds and local close-out. It is not a fresh USD 30 allowance or a claim about prior or external billing. No replacement ledger, writer lock or ledger-recovery procedure applies.

No package integration, publication, version bump, main merge, old-host qualification or security workstream is authorised, and the `rh-v4` receipt equally withholds pre-declared documents, planning-cache reuse and any fresh capture before the renewed gates pass. No prior study queries, observations, fixtures, analysis rules, runtime or scripts may be imported; the rejected PostgreSQL captures are retained history, not reusable inputs. The historical financial inspection was the sole historical-data exception and is not a current input.

## Current Implementation

Production files under `src/` are unchanged. The working implementation is under `scripts/research-handoff/`:

| Files | Responsibility |
|---|---|
| `contracts.ts`, `config.ts` | Shared record types, prescribed models, query, controls, schedule and conservative bounds |
| `common-inputs.ts`, `registration.ts` | Immutable capture/replay, digest binding, extraction-input multiset checks, latched control failures and native-wrapper parity |
| `host.ts`, `recorder.ts` | Explicit retained-host loading, isolated SDK sessions, direct/Codemode execution, request/fetch-attempt recording and contained reads |
| `return-contract.ts` | Latest addition: verify the core result hash and one unchanged native return, including the pinned Codemode envelope; reject silent projection, duplication and truncation |
| `analyse.ts`, `adequacy.ts` | Main/downstream accounting, actual host message shapes, proxy attribution, paired summaries, missingness and the strict primary claim gate |
| `budget.ts`, `pipeline-client.ts` | Financial wire-format compatibility, per-attempt reservations, unknown holds, latched budget refusal and raw reported-charge capture |
| `capture.ts`, `collection.ts`, `credentials.ts` | Guarded preparation, cost qualification, sequential accepted collection, settlement and non-refreshing credential checks |
| `storage.ts`, `assessment-bundle.ts` | Immutable output, retained bad rows, identity inventories and later assessments without editing raw records |
| `fixtures.ts`, `runner.ts`, `cli.ts` | New synthetic inputs, process-isolated workers, orchestration and command surface |

The study tests are `test/handoff-*.test.ts`, with `test/helpers/handoff-fixtures.ts` and `test/tsconfig.research-handoff.json`. `scripts/run-tests.mjs` separates the explicit pinned-host study lane from the package lanes. `js-tiktoken@1.0.21` is a development-only dependency. The current checkout has dependencies provisioned from its lockfile; the retained host is the approved explicit installation, not the repository's development peers or the moving launcher.

## Verification History and Its Limits

Historical pause state: the last comprehensive passing lane before the close-out edits was:

- `evidence/agents/20261104T112537Z-research-handoff-implementation/reports/validation-20261104T141146Z.log`.
- It passed build, native and standalone deterministic tests, the then-current study tests, both relevant type projects and all applicable generator checks.
- Matching synthetic proof: `evidence/benchmarks/research-handoff/20261104T141222Z-synthetic-v2-final/`.
- That proof's code digest is `654acdc2fe5fa53bb837dec923838e9bae494bc03d1190a1e765e81fba56b7d4`; its protocol digest is `0fbba3891f57e792284d6bf9a201837fb9a9b0d35cb168eb4e011e53ad15cbd3`.
- Both arms completed with one top-level handoff, two logical main requests and one answer-producing resumption; the candidate used the actual Codemode sandbox and a nested research call. Input equality, readable reports and observer coverage passed. Offline reproduction was byte-identical.

Those are synthetic facts. Their usage values are programmed, not measured processing or savings. That source revision is historical: later code, tests and documentation changed. Never use its green log or proof to accept the current tree without rerunning and binding a new candidate.

Historical pause state: the coordinator ran one fresh complete checkpoint lane. It passed build, 663 native tests, 62 standalone tests, 126 study tests, both type projects and all generator checks. The exact log is `evidence/agents/20261104T160000Z-research-handoff-resume/reports/checkpoint-validation.log`. It covered the then-current code, including the return-contract and close-out edits, but was not independent implementation acceptance. At that pause a new driver-level actual-host synthetic series and exact-revision review were still required. The M3 Acceptance Evidence below records their subsequent completion.

## Reviews and Close-Out Work

All following reports are in `evidence/agents/20261104T112537Z-research-handoff-implementation/reports/`. They remain immutable evidence; do not rewrite their verdicts.

- `technical-components.md`: independent Claude review, findings F1–F15. Most were addressed in the subsequent component remediations.
- `adapter-remediation.md`: source-control latching, equality/completeness separation, expected-digest binding and corpus checks.
- `analysis-remediation.md` and `analysis-host-shape-followup.md`: real host/provider shapes, metadata projection, independent assessment, whole-series identity, minimum-gap work and downstream variation. The follow-up fixed lost system sections and duplicate SDK cost estimates.
- `host-build.md`: actual-host proof, complete request/fetch boundary, final context, isolation and caps.
- `technical-integrated.md`: independent Qwen review. Its final verdict against the historical digest above was **not ready**, with I-4 as its sole blocking code issue. I-0, I-1 and I-2 were closed. It also records residual medium/low findings.
- `prose-implementation.md`: Sol review. P2 was closed; P1, P3, P4, P5 and P6 remained open at its final inspection.

Historical pause state: the following changes had not yet been independently rechecked. Their M3 disposition is recorded below:

1. I-4: `persistRunRecord` writes the budget receipt first and catches strict analysis rejection, retaining the full record with `analysisError`. A new worker-retention regression passed in targeted testing.
2. P1/P6: `collect` now distinguishes finished/stopped collection, names the outcome, and states that financial settlement is separate. Help is multiline, names the populations and separates gated operations. Help regression passed.
3. P3: reproduction guidance now gives per-stage prerequisites without a circular combined list.
4. P4/P5 and I-3/I-5: Markdown now labels provider counts, estimates, units and difference direction; missing observations and unassessed/review-incomplete answers are distinct; healthy rows show no analysis error; counts and per-run limitations were added.
5. I-6/I-8: identity coverage now includes study tests, their runner/configuration and governing/reproduction documents. Reproduction receipts disclose a mismatch between record identities and the analysing implementation.
6. I-10/I-11/I-13/I-14/I-15: collection validates its live root before writes; OAuth validity now covers the worker ceiling plus refresh margin; invalid budget receipts retain their error detail; stale-lock recovery and conservative-budget fragility are documented; the explicit study commands are named in branch guidance.
7. Additional coordinator finding: correct tool topology alone did not prove an unchanged candidate return. `return-contract.ts` now checks the actual text and core hash; analysis and worker classification use it. New tests cover exact return/console envelopes and rejection of projection, duplication and changed native text. At the pause this addition needed fresh technical review and actual-host qualification; the M3 evidence below records its acceptance.

Residual deliberate limitations: mixed host guidance remains partly unallocated rather than being labelled overhead; full-catalogue financial reservations can stop a batch on an unknown charge while other extractions remain active. No per-message cost estimate replaces that conservative bound. The accepted `rh-v3` observer diagnostic qualified the selected live server-sent-event (SSE) main transport and its usage coverage for that identity, not WebSocket transport. Both rejected captures observed numeric Sonar charges. The separate MiniMax M3 charge-reporting qualification did not run.

## M3 Acceptance Evidence

The incoming lead verified all three final handoff inventories before changing the tree. The first fresh candidate received unconditional prose acceptance but a technical blocker for unrecognised Codex terminal events. The accepted revision preserves that failed review and candidate evidence, then makes only the recorded recorder, collection-driver, test and reproduction-guide changes.

Bind historical milestone M3 to these artefacts under `evidence/agents/20261104T164114Z-research-handoff-m3/` and `evidence/benchmarks/research-handoff/`:

- `candidate-revised.json`: exact implementation, host and protocol identities.
- `reports/revised-validation.log`: serial build, native, standalone and study tests, both type projects and all generator checks, with matching code digests before and after.
- `20261104T170500Z-revised-synthetic/`: fresh actual-host baseline and Codemode proof with fixed-input equality, unchanged returns, complete request accounting and readable reports.
- `20261104T170500Z-revised-offline/`: byte-identical offline `analysis.json` and a matching-identity receipt.
- `reports/technical-final.md` and `reports/technical-recheck.md`: the blocking review and its bounded delta closure. The final verdict is **ACCEPTED FOR M3** against the digests above.
- `reports/prose-final.md` and `reports/prose-recheck.md`: unconditional initial and delta prose acceptance.

The coordinator accepted the reviewer's recommended D-1 disposition without another code change. Descriptive pair statistics can include a failed conversation only when its provider usage is complete; its failed status remains visible, it cannot enter the positive-claim subset, and `FINDINGS.md` must isolate any such pair rather than describe its difference as a benefit. Financial admission must also accept that missing terminal observer coverage or an unknown-charge hold can stop the batch, as Reproduction records.

## Observer Diagnostic Acceptance

The `rh-v2` implementation accepted at this milestone was commit `86ba13f8aedeb1c33f54d9696b295cb88a3b8aa2`. The separate diagnostic series is `evidence/benchmarks/research-handoff/20261104T172343Z-observer-diagnostic/`, with offline analysis in the adjacent `-offline/` directory. Its `diagnostic-result.json` is the coordinator acceptance receipt and binds the same code and protocol digests.

Both prescribed `openai-codex/gpt-6.1-sol` conversations completed with two logical requests, two observed SSE attempts, one assigned handoff and one answer-producing resumption. Fixed inputs, usage coverage, route conformance and readable reports passed. `diagnostic-verification.json` independently checks the native hashes and transmitted return bytes: the baseline returned exact native text, and the candidate returned it once under the pinned Codemode envelope with the documented separator. The operator auth file remained unchanged and 301 retained files contained no scanned credential value. These are observer facts, not measured-dataset savings or answer-adequacy results.

## RH-V3 Amendment Acceptance

The `rh-v3` candidate and its proof are retained under `evidence/agents/20261104T192721Z-research-handoff-m4/candidate-rh-v3-r4.json` and `evidence/benchmarks/research-handoff/20261104T201721Z-rh-v3-synthetic-r4/`, with the adjacent `-offline/` reproduction. `reports/rh-v3-validation-r4.log` binds the complete deterministic lane before and after the same code digest. `reports/technical-r3.md` accepts the implementation correction and `reports/technical-r4.md` verifies its documentation-only successor. `reports/prose-r4.md` records the final prose disposition.

Earlier M3 and observer-diagnostic evidence remains valid for its recorded `rh-v2` identity but could not authorise paid work under `rh-v3`. The `rh-v3` renewal completed with the R4 observer result at `20261104T203108Z-rh-v3-observer-diagnostic/diagnostic-result.json`, produced with the R4 synthetic `frozen-inputs.json`. The sibling `diagnostic-acceptance.json` is the schedule authority, not the acceptance result. The `rh-v4` question amendment invalidates the `rh-v3` acceptances in the same way: they remain the record of that identity but authorise no capture or measured conversation under `rh-v4`.

## Preparation Close-Out and Fresh-Agent Handover

The accepted `rh-v3` implementation was commit `3e43070183b6c63623f02fd782b633cd0c552f2c`. Its renewed observer series is `20261104T203108Z-rh-v3-observer-diagnostic/`; both conversations completed with complete fixed-input, usage, route, and unchanged-return evidence. These are observer facts, not savings.

The first corpus at `20261104T203243Z-rh-v3-measured/` omitted `SKIP LOCKED`. The sole approved recapture at `20261104T204211Z-rh-v3-measured-r2/` omitted it again and selected two `current` pages rather than PostgreSQL 17 pages. Each `corpus-acceptance.json` records rejection before any arm result. No third capture, MiniMax M3 qualification, measured pair, or answer assessment ran.

Both series have `settlement-review.json` and `settlement-receipt.json`. Reported charges total USD 0.01123, with zero unknown holds and zero active reservations. Receipt amounts are nano-USD. Each series released the unused part of its own envelope; residual lifetime or further-capture authority is not inferred. No replacement ledger was created. [Findings](FINDINGS.md) contains the compact evidence map, source-selection diagnosis, outcome table, and owner-receipt convention.

The following commands verified the accepted `rh-v3` identity at commit `3e43070183b6c63623f02fd782b633cd0c552f2c`. They are a historical record, not a current-tree gate: the working tree now carries the `rh-v4` stimulus constants, revised tests and revised governing documents, so both digests differ by design:

```bash
node --import tsx --input-type=module -e 'import { sourceIdentity } from "./scripts/research-handoff/storage.js"; console.log((await sourceIdentity(process.cwd())).digest)'
# rh-v3 record: 1c420c9027dac6b10b0294db1407cc8fff09eb562a922f312f9d4b39ef804e73
sha256sum docs/experiments/research-handoff/PROTOCOL.md
# rh-v3 record: 0f252090b0c2910f33212af62f5b734716d670c6e73bde4b651be1e2bb94f530
```

The `rh-v4-r1`, `rh-v4-r2` and `rh-v4-r3` freezes are retained under `evidence/agents/20261105T080302Z-research-handoff-cloudflare/`. Each passed deterministic and synthetic evidence, and its technical reviewer accepted observer renewal, but its prose reviewer required corrections. The corrected `candidate-rh-v4-r4.json` binds a fresh identity and requires both review dispositions before diagnostics.

## Exact Next Assignment

The owner chose the revised source/question route: `owner-cloudflare-question-amendment.json` under `evidence/agents/20261104T192721Z-research-handoff-m4/` approves the neutral `rh-v4` Cloudflare task, its verbatim query and focus, the domains `developers.cloudflare.com` and `pi.dev`, the source cap of six and the required renewal list. Do not rerun either PostgreSQL capture, select a replacement source by hand, or treat the implementation and observer passes as measured results.

The next work is independent review of `rh-v4-r4` in run `20261105T080302Z-research-handoff-cloudflare`, followed by symmetric observer diagnostics if both reviewers accept it. A new narrow owner financial receipt and current-rate admission then precede any capture. Fresh corpus acceptance follows capture and precedes MiniMax M3 charge qualification, measured acceptance, ten sequential pairs, independent answer assessment, offline analysis, local close-out and findings. No capture is authorised before financial admission passes, and no measured conversation is authorised before measured acceptance. Preserve every failed preparation and diagnostic under its existing identity. No comparative claim is available from the present evidence.

Before approving the question, the coordinator ran an answer-shaped topic-validation call. The [planning disclosure](../../../evidence/benchmarks/research-handoff/20261105T075350Z-topic-validation/planning-disclosure.json) preserves it and prohibits its reuse. Fresh corpus acceptance and adequacy grading require reviewers who have not read that answer, the coordinator's answer-shaped discussion or the disclosure's query field. The call was outside the experiment envelope. Its provider charge is not established by its retained `meta.json` and is not included in the settlement figures.

## Agent and Workspace State

The three builders and both later reviewers were idle with completed reports when the handoff began. Their actual model provenance was retained in the handoff run's `reports/helper-provenance.txt`, and the coordinator closed their five commissioned helper tabs. They have no outstanding implementation commission. The owner's tab and all worktrees remain intact. Do not reuse stale pane IDs, close the owner's tab or remove any worktree.

For renewed parallel work, use one workspace for this existing worktree and one tab per agent, with disjoint file ownership and a single coordinator-owned full-suite lane. Use the live roster, exclude the incoming coordinator's model, and verify actual agent provenance. Claude's earlier quota exhaustion was a time-specific observation, not a permanent availability decision.

## Suggested Resume Prompt

> Read `docs/experiments/research-handoff/CHECKPOINT.md` and `docs/experiments/research-handoff/FINDINGS.md` in the existing `study/research-handoff-runner` worktree. The owner approved the `rh-v4` Cloudflare task; no experiment capture or measured result exists. Complete independent review of `rh-v4-r4`, then run symmetric observer diagnostics if both reviewers accept it. A new owner financial receipt and current-rate admission precede capture; fresh corpus acceptance follows capture and precedes MiniMax M3 charge qualification and measured collection. Preserve the rejected PostgreSQL captures and the disclosed topic-validation research without reusing either as experimental input.
