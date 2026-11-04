# Fresh-Agent Resume Checkpoint

Status: M3 implementation readiness and the two-conversation subscription-main observer diagnostic are accepted on 4 November 2026 for code digest `59b550ca92cf0ad4f1f4e5d224cc1d884e8634c4346be8f395d11035ecf5d379` and protocol digest `4485f00a5f7af58389fa8e0f76f0c174725bbaa760840b68055f02205662c8ba`. The next gate is owner resolution of D1 before financial admission. No paid source capture, measured conversation, programme reservation or settlement has run. The pause record below preserves the entry history and handoff verification requirements.

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
4. The final handoff receipt under `evidence/agents/20261104T160000Z-research-handoff-resume/`, which records the actual checkpoint commit, working-tree state, source/evidence inventory and checks performed at this pause.
5. The review reports and revision distinctions below.

The evidence directories are gitignored. They survive in this retained checkout, not in a clean clone or a newly created worktree. Do not clean them or substitute older scientific material when something is absent.

Historical entry verification was completed by the incoming lead before any authorised change. These commands passed against the committed pause snapshot at `065173b`:

```bash
sha256sum -c evidence/agents/20261104T160000Z-research-handoff-resume/source-final.sha256
sha256sum -c evidence/agents/20261104T160000Z-research-handoff-resume/implementation-final.sha256
sha256sum -c evidence/agents/20261104T160000Z-research-handoff-resume/evidence-final.sha256
```

`source-final.sha256` covers every changed handoff/source file from that pause, including the historical checkpoint bytes. `implementation-final.sha256` covers the broader pause implementation identity, including unchanged production source, governing documents and adapter dependency manifests. `evidence-final.sha256` covers the retained reports and synthetic evidence. The original unsuffixed manifests and `candidate.json` preserve the first cold-reader submission; the final inventories and `receipt.json` remain immutable historical evidence.

Do not rerun those manifests as a current-tree gate after the recorded M3 delta. The current verification basis is `candidate-revised.json` and its named evidence under `evidence/agents/20261104T164114Z-research-handoff-m3/`. An unexplained mismatch against that current receipt stops changes for read-only diagnosis and owner direction. Preserve both snapshots; neither re-baselines the other.

## Owner Authority and Pending Decision

The owner accepted the plan and said:

> This looks great. Execute. As the orchestrator validate their work as it arrives.

This accepts the unchanged-text Codemode candidate, the proposed PostgreSQL 17 query and three parallel implementation tracks. The incoming lead owns integration, validation and acceptance of a bounded later batch within the existing authority. Do not ask again whether to implement those accepted choices.

The outgoing lead asked the following decision, which remains unanswered:

> D1) May I append only this experiment's reservation and settlement records to that ledger, preserving every existing entry?

The authoritative ledger is the path in `config.ts` and the Brief, inside the old `codemode-research` worktree. The brief permits reading it for financial continuity but prohibits modifying another worktree. Do not infer an answer to D1 from the general execution approval or the request for a fresh handover. Do not create an owner-permission receipt until the owner resolves it. No such receipt, live acceptance or programme reservation was created.

The standing programme ceiling is USD 30, not a fresh allowance. The last inspected balance and conservative preliminary envelope are in the Protocol and `preliminary-budget-v2.json`; refresh them before acceptance. The envelope includes a separate M3 charge-reporting qualification because synthetic downstream calls cannot prove the live charge channel. A reservation is not expected spend, and unknown charges remain held.

No package integration, publication, version bump, main merge, old-host qualification or security workstream is authorised. No prior study queries, observations, fixtures, analysis rules, runtime or scripts may be imported. Reading the financial ledger is the sole historical-data exception.

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

The last comprehensive passing lane before the latest close-out edits is:

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

Residual deliberate limitations: mixed host guidance remains partly unallocated rather than being labelled overhead; full-catalogue financial reservations can stop a batch on an unknown charge while other extractions remain active. No per-message cost estimate replaces that conservative bound. The accepted observer diagnostic has since qualified the selected live SSE main transport and its usage coverage, not WebSocket transport. Actual Sonar/M3 reported-charge channels remain untested.

## M3 Acceptance Evidence

The incoming lead verified all three final handoff inventories before changing the tree. The first fresh candidate received unconditional prose acceptance but a technical blocker for unrecognised Codex terminal events. The accepted revision preserves that failed review and candidate evidence, then makes only the recorded recorder, collection-driver, test and reproduction-guide changes.

Bind M3 to these current artefacts under `evidence/agents/20261104T164114Z-research-handoff-m3/` and `evidence/benchmarks/research-handoff/`:

- `candidate-revised.json`: exact implementation, host and protocol identities.
- `reports/revised-validation.log`: serial build, native, standalone and study tests, both type projects and all generator checks, with matching code digests before and after.
- `20261104T170500Z-revised-synthetic/`: fresh actual-host baseline and Codemode proof with fixed-input equality, unchanged returns, complete request accounting and readable reports.
- `20261104T170500Z-revised-offline/`: byte-identical offline `analysis.json` and a matching-identity receipt.
- `reports/technical-final.md` and `reports/technical-recheck.md`: the blocking review and its bounded delta closure. The final verdict is **ACCEPTED FOR M3** against the digests above.
- `reports/prose-final.md` and `reports/prose-recheck.md`: unconditional initial and delta prose acceptance.

The coordinator accepted the reviewer's recommended D-1 disposition without another code change. Descriptive pair statistics can include a failed conversation only when its provider usage is complete; its failed status remains visible, it cannot enter the positive-claim subset, and `FINDINGS.md` must isolate any such pair rather than describe its difference as a benefit. Financial admission must also accept that missing terminal observer coverage or an unknown-charge hold can stop the batch, as Reproduction records.

## Observer Diagnostic Acceptance

The accepted implementation is committed as `86ba13f8aedeb1c33f54d9696b295cb88a3b8aa2`. The separate diagnostic series is `evidence/benchmarks/research-handoff/20261104T172343Z-observer-diagnostic/`, with offline analysis in the adjacent `-offline/` directory. Its `diagnostic-result.json` is the coordinator acceptance receipt and binds the same code and protocol digests.

Both prescribed `openai-codex/gpt-6.1-sol` conversations completed with two logical requests, two observed SSE attempts, one assigned handoff and one answer-producing resumption. Fixed inputs, usage coverage, route conformance and readable reports passed. `diagnostic-verification.json` independently checks the native hashes and transmitted return bytes: the baseline returned exact native text, and the candidate returned it once under the pinned Codemode envelope with the documented separator. The operator auth file remained unchanged and 301 retained files contained no scanned credential value. These are observer facts, not measured-dataset savings or answer-adequacy results.

## Exact Next Assignment

Continue the full plan from the accepted observer diagnostic. Do not repeat M3 or the diagnostic, start another broad design exercise, or edit the six identity-bearing governing documents during accepted live work.

1. Resolve D1, reconcile finance and writer coordination, refresh current rates, and accept the finite reservation. Preserve the existing ceiling and obligations. Explicitly accept the documented budget-stop and missing-observer stop behaviour. The accepted diagnostic supplies no ledger-append permission.
2. Capture one fresh common corpus, assess topic/version coverage, qualify Sonar and M3 charge reporting, then freeze the accepted measured batch. If a validity-affecting change is required, preserve the failed diagnostic and qualify a new revision; do not silently amend an accepted batch.
3. Execute the ten balanced pairs sequentially through the accepted driver. Retain failed, nonconforming and not-run observations. Do not request per-call approval inside an accepted batch and do not replace scheduled failures. An interrupted parent leaves partial evidence, not terminal collection or settlement authority.
4. Grade the final answers against the frozen rubric, obtain independent review, join assessment bundles without modifying raw records, run offline analysis, settle charges and holds, and deliver the findings and reproduction inventory. Isolate failed-but-numeric descriptive pairs as recorded above. No-benefit or increased-overhead results are valid outcomes.

## Agent and Workspace State

The three builders and both later reviewers were idle with completed reports when the handoff began. Their actual model provenance was retained in the handoff run's `reports/helper-provenance.txt`, and the coordinator closed their five commissioned helper tabs. They have no outstanding implementation commission. The owner's tab and all worktrees remain intact. Do not reuse stale pane IDs, close the owner's tab or remove any worktree.

For renewed parallel work, use one workspace for this existing worktree and one tab per agent, with disjoint file ownership and a single coordinator-owned full-suite lane. Use the live roster, exclude the incoming coordinator's model, and verify actual agent provenance. Claude's earlier quota exhaustion was a time-specific observation, not a permanent availability decision.

## Suggested Resume Prompt

> Read `docs/experiments/research-handoff/CHECKPOINT.md` in the existing `study/research-handoff-runner` worktree and act as the incoming lead. M3 and the subscription-main observer diagnostic are accepted against the recorded identities; do not repeat them. Resume at owner decision D1 and the remaining financial, preparation, collection and analysis gates in Exact Next Assignment. Do not write the cross-worktree financial ledger or make paid calls until the pending owner permission and collection prerequisites are resolved. Do not import old scientific material, recreate the worktree, rerun historical entry manifests as a current gate, or infer savings from synthetic or diagnostic usage.
