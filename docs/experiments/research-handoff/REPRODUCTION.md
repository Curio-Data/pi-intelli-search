# Research Handoff Reproduction

The runner implements the unchanged-text comparison in [Protocol](PROTOCOL.md). Synthetic checks exercise the retained `Pi` host, the native research core and the real Codemode sandbox without inference. Their programmed usage values test accounting only; they are not measured savings.

## Prerequisites

Use this implementation checkout and its lockfile. The actual-host lane requires the retained host path and version in `scripts/research-handoff/config.ts`; it never selects a moving launcher. The executing host and its peers are recorded separately from the checkout's native-wrapper dependencies. [_Node.js_](https://nodejs.org/) 24 provides the compression and filesystem APIs used by the runner.

Keep scratch under this checkout's gitignored `.tmp/`. Keep durable evidence under `evidence/benchmarks/research-handoff/`. Each output directory and observation identity must be new. No command below is permission to copy credentials, refresh-token chains, old scientific material or mutable cache state.

## Deterministic Validation

Run these lanes sequentially:

```bash
npm run build
npm run test:all
npm run test:handoff
npm run typecheck:handoff
node_modules/.bin/tsc -p test/tsconfig.native-contract.json
npm run check:toc
npm run check:plugins
npm run check:readmes
npm run check:changelog
```

The existing native and standalone tests remain in `test:all`. The explicit `test:handoff` lane runs the experiment's tests, including installed-host checks, with isolated home, agent and temporary directories. Record `sourceIdentity(process.cwd()).digest` before and after the complete lane and require the same value, so the log binds every check to one implementation identity. No live end-to-end package suite, publication check or security audit is part of this experiment's validation authority.

## Host Identity and Synthetic Proof

Create the evidence parent if absent. Replace the example output names with fresh, unique identities before each invocation:

```bash
mkdir -p evidence/benchmarks/research-handoff
npm run study:handoff -- preflight \
  evidence/benchmarks/research-handoff/unique-preflight
npm run study:handoff -- synthetic \
  evidence/benchmarks/research-handoff/unique-synthetic
```

`preflight` records the actual loaded host and peer versions, checkout adapter dependencies and implementation hashes. It does not check credentials or establish live model availability.

`synthetic` creates fresh frozen inputs, then runs one baseline and one candidate conversation in separate processes. Each writes a real `.search/` report. The retained series includes input and implementation identities, worker configurations, append-only events, process logs, final records, budgets, inventory and derived analysis. A failing worker is retained; the driver does not replace it.

The synthetic main provider uses the pinned host's Responses serialisation with a scripted fetch. It establishes host wiring and accounting, not live Codex transport behaviour. Live observer qualification is a separate gate.

## Offline Analysis

Reproduce from the retained inventory into another new output directory:

```bash
npm run study:handoff -- analyse \
  evidence/benchmarks/research-handoff/unique-synthetic/inventory.json \
  evidence/benchmarks/research-handoff/unique-analysis \
  synthetic
```

Select `diagnostic` or `measured` explicitly for those populations. The default is `measured`; synthetic and diagnostic records never become measured observations by omission of a flag.

The output contains `analysis.json`, `summary.md` and `inputs.json`, identifying the input inventory and analysis implementation. The receipt lists the records' code/protocol identities and states whether they match the analysing implementation. A mismatch is an explicit re-analysis advisory, not a reason to discard the original data. Invalid or missing retained records remain explicit error rows with unavailable metrics. Invalid input identities prevent aggregation; failures are not silently replaced. The summary distinguishes provider totals from tokenizer estimates and downstream variation.

## Adequacy Without Editing Raw Records

Raw `record.json` files are immutable. Store later assessments in a separate bundle using the exported `AssessmentBundle` shape in [`assessment-bundle.ts`](../../../scripts/research-handoff/assessment-bundle.ts). Each entry binds an assessment to the canonical digest of one raw record and to the digest of its independent review artefact. Preserve the initial grading and any disagreement/adjudication records separately.

Supply that bundle as the final analysis argument:

```bash
npm run study:handoff -- analyse \
  evidence/benchmarks/research-handoff/unique-measured/inventory.json \
  evidence/benchmarks/research-handoff/unique-assessed-analysis \
  measured \
  evidence/benchmarks/research-handoff/unique-measured/assessments.json
```

Both the grader and the checking reviewer must satisfy the isolation rule in [Protocol](PROTOCOL.md#task). The join happens in memory. It never rewrites raw records. A missing or changed review artefact, a duplicate grade or a record-hash mismatch rejects the assessment bundle. Without accepted assessments, the numeric table remains available but the positive-claim gate cannot pass.

## Live Gates

Live commands are implemented but are not self-authorising. A source file, successful synthetic run or populated approval-shaped JSON object does not establish permission. The coordinator must inspect the required evidence and record acceptance of the exact identities before using a live entry.

Follow the gates in this order. Each entry requires the evidence in its own row, not the later stages' outputs:

| Stage | Entry or Decision | Prerequisites | Output |
|---|---|---|---|
| Implementation | Independent technical and prose acceptance | Frozen candidate, deterministic checks and actual-host synthetic proof | Accepted candidate and measurement boundary |
| Main Diagnostics | `collect`, diagnostic acceptance | Accepted candidate and a separately accepted two-conversation diagnostic schedule using synthetic downstream inputs | Real main-provider observer evidence; no programme reservation required for this subscription-only step |
| Financial Admission | `admit` | Accepted diagnostic evidence, the new narrow owner financial receipt with scope `continue-without-programme-ledger-rh-v4`, and current public rates | One bounded local admission; no replacement programme ledger |
| Common Capture | `capture` | Accepted preparation and fixed-envelope admission | Fresh search/pages and Sonar's numeric-charge check |
| Corpus Review | Fresh reviewer who has not read the topic-validation answer, the coordinator's answer-shaped discussion or the disclosure's query field | Retained common capture | Accepted topic coverage and source applicability, including any documented limitation or absence; silence alone fails |
| Downstream Qualification | `qualify-cost` | Accepted corpus and Sonar reporting, within the bounded qualification allowance | MiniMax M3 reported-charge evidence |
| Measured Acceptance | Coordinator decision | Accepted diagnostics, corpus, charge reporting and financial admission | Frozen measured schedule and all input/runtime identities |
| Measured Conversations | `collect`, measured acceptance | That exact measured acceptance | Full retained inventory, including failures or not-run rows |
| Financial Close-Out | `settle` | Terminal collection or preparation-failure evidence and reviewed receipts | Local settlement receipt with unknown charges still held |

The owner's `rh-v3` amendment removed the unavailable programme-ledger prerequisite and fixed the maximum experiment envelope at USD 25.81. The `rh-v4` question amendment replaces the study stimulus but grants no financial authority: a new narrow owner receipt with scope `continue-without-programme-ledger-rh-v4`, `schemaVersion: 1`, `approvedBy: "owner"`, `approved: true`, a non-empty `approvedAt`, and `maximumExperimentEnvelopeNanoUsd` equal to the implemented bound is required before `admit`. The runner rejects the historical `rh-v3` receipt scope. Every acceptance recorded against the `rh-v3` identity, including the synthetic proof, observer diagnostic and financial admission, requires renewal against the revised code and protocol identity before any live entry is used. Neither amendment makes a synthetic test or subscription-only observer diagnostic a paid research observation, and the question amendment authorises no fresh capture or measured conversation by itself. No replacement ledger or fresh USD 30 allowance is created.

For the main diagnostics, create a fresh credential-free synthetic series under the accepted code and pass its `frozen-inputs.json` to `collect`. The driver supplies two synthetic pages because these conversations qualify main-model observation and return behaviour; the deterministic pinned-host tests cover six-page downstream fan-out separately. The diagnostic acceptance review must verify both assigned routes, complete observer coverage, fixed-input equality and unchanged-return preservation. Compare the candidate's recorded return with its transmitted `function_call_output`, accounting for the pinned host's newline envelope. A nonconforming or unreviewed diagnostic is not accepted merely because `collect` reports that collection finished. These conversations establish observation and return behaviour, not factual answer adequacy.

The authority structures are defined by `PreparationAcceptance` in [`collection.ts`](../../../scripts/research-handoff/collection.ts) and `LiveAcceptance` in [`runner.ts`](../../../scripts/research-handoff/runner.ts). Credential arguments are explicit file references, never token values. Credentials are read through a non-refreshing store. OAuth access must have at least 35 minutes remaining, covering the 30-minute worker ceiling and the host's refresh window; expiry requires the operator's own login workflow. No credential is written into a run profile.

| Entry | Purpose |
|---|---|
| `admit <preparation-acceptance.json>` | Refresh public rates and record the accepted fixed-envelope admission |
| `capture <preparation-acceptance.json> <auth-file>` | Run fresh common search and page acquisition behind the financial guard |
| `qualify-cost <preparation-acceptance.json> <auth-file> <corpus-acceptance.json>` | Qualify MiniMax M3's reported-charge channel on one frozen source |
| `collect <conversation-acceptance.json> <auth-file> <frozen-inputs.json>` | Execute the exact diagnostic or measured schedule sequentially |
| `settle <preparation-acceptance.json>` | Reconcile retained stage receipts and write local settlement, keeping unknown holds |

`collect` reports whether collection finished or stopped and names `collection-outcome.json`. It does not perform programme settlement; `settle` remains a separate accepted operation.

Live roots must be real, distinct directories under this checkout's experiment evidence parent, not scratch clones. Permanent per-run admission claims reject duplicate live observations. Source or accounting failures stop the batch and leave not-run rows. Budget refusal is latched and remains a failed observation, not an apparent token-saving result.

A missing stage budget after a started operation is held conservatively during close-out. Unknown charge holds are not silently released. A revised diagnostic or capture requires a new identity and a separately accepted allowance; it never replaces a scheduled observation.

## Operational Limits

The full-catalogue reservation bounds remain deliberately conservative. An unknown charge from even one failed extraction can prevent a retry while other extractions remain active. The run and batch then stop as budget-limited, even when known charges are small. This is a financial-control outcome, not evidence for either research arm. No unverified per-message tokenizer estimate replaces these bounds. Financial admission must explicitly accept this stop behaviour; it is not renegotiated after seeing failures.

The collection driver appends `collection-progress.jsonl` after every retained row. If its parent is interrupted, that journal preserves completed row identities, but the absence of a final inventory and outcome is not a terminal collection result. Keep the financial admission and all run directories intact. Confirm that no collector or worker remains active, inspect the progress journal and financial receipts, and obtain separately recorded coordinator acceptance for any recovery. Do not restart the same observation identities or synthesise a terminal outcome for automatic settlement. A post-session finalisation failure or worker kill can likewise leave only `started.json`, `events.jsonl` and `process.log`; settlement retains the conservative full-stage hold when the final budget is unavailable.

The runner supports only fixed-envelope admission. It writes no programme ledger and needs no writer lock or ledger-recovery procedure. Interruption recovery remains limited to the retained local receipts and coordinator-approved path described above.

The attribution leaves mixed host guidance unallocated rather than labelling it avoidable overhead. Provider totals and raw request contents remain available; the component estimates do not establish an exact semantic split or a causal explanation for every token difference.

## Checkpoint Reports

Implementation checkpoints record tests actually run, the retained synthetic proof, independent review findings and unresolved gates. A complete experiment additionally requires the measured inventory, independently checked adequacy, financial settlement and a findings note. An implementation checkpoint alone does not establish one-handoff conformance on the live main model, useful answers to the selected query or lower traffic.
