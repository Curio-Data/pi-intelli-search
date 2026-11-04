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

The existing native and standalone tests remain in `test:all`. The explicit `test:handoff` lane runs the experiment's tests, including installed-host checks, with isolated home, agent and temporary directories. No live end-to-end package suite, publication check or security audit is part of this experiment's validation authority.

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

The join happens in memory. It never rewrites raw records. A missing or changed review artefact, a duplicate grade or a record-hash mismatch rejects the assessment bundle. Without accepted assessments, the numeric table remains available but the positive-claim gate cannot pass.

## Live Gates

Live commands are implemented but are not self-authorising. A source file, successful synthetic run or populated approval-shaped JSON object does not establish permission. The coordinator must inspect the required evidence and record acceptance of the exact identities before using a live entry.

Follow the gates in this order. Each entry requires the evidence in its own row, not the later stages' outputs:

| Stage | Entry or Decision | Prerequisites | Output |
|---|---|---|---|
| Implementation | Independent technical acceptance | Frozen candidate, deterministic checks and actual-host synthetic proof | Accepted candidate and measurement boundary |
| Main Diagnostics | `collect`, diagnostic acceptance | Accepted candidate and a separately accepted two-conversation diagnostic schedule using synthetic downstream inputs | Real main-provider observer evidence; no programme reservation required for this subscription-only step |
| Financial Admission | `reserve` | Accepted diagnostic evidence, owner permission for cross-worktree ledger appends, writer coordination and a current bounded schedule | One active programme reservation; a copied ledger creates no allowance |
| Common Capture | `capture` | Accepted preparation and active reservation | Fresh search/pages and Sonar's numeric-charge check |
| Corpus Review | Coordinator decision | Retained common capture | Accepted topic coverage and source-version applicability |
| Downstream Qualification | `qualify-cost` | Accepted corpus and Sonar reporting, within the reserved qualification allowance | M3 reported-charge evidence |
| Measured Acceptance | Coordinator decision | Accepted diagnostics, corpus, cost reporting and reservation | Frozen measured schedule and all input/runtime identities |
| Measured Conversations | `collect`, measured acceptance | That exact measured acceptance | Full retained inventory, including failures or not-run rows |
| Financial Close-Out | `settle` | Terminal collection or preparation-failure evidence and reviewed receipts | Programme settlement with unknown charges still held |

Unresolved owner ledger permission blocks financial appends and paid stages. It does not make a synthetic test or subscription-only observer diagnostic a paid research observation.

For the main diagnostics, create a fresh credential-free synthetic series under the accepted code and pass its `frozen-inputs.json` to `collect`. The diagnostic acceptance review must verify both assigned routes, complete observer coverage, fixed-input equality and unchanged-return preservation. Compare the candidate's recorded return with its transmitted `function_call_output`, accounting for the pinned host's newline envelope. A nonconforming or unreviewed diagnostic is not accepted merely because `collect` reports that collection finished. These conversations establish observation and return behaviour, not factual answer adequacy.

The authority structures are defined by `PreparationAcceptance` in [`collection.ts`](../../../scripts/research-handoff/collection.ts) and `LiveAcceptance` in [`runner.ts`](../../../scripts/research-handoff/runner.ts). Credential arguments are explicit file references, never token values. Credentials are read through a non-refreshing store. OAuth access must have at least 35 minutes remaining, covering the 30-minute worker ceiling and the host's refresh window; expiry requires the operator's own login workflow. No credential is written into a run profile.

| Entry | Purpose |
|---|---|
| `reserve <preparation-acceptance.json>` | Refresh public rates and append the accepted programme reservation |
| `capture <preparation-acceptance.json> <auth-file>` | Run fresh common search and page acquisition behind the financial guard |
| `qualify-cost <preparation-acceptance.json> <auth-file> <corpus-acceptance.json>` | Qualify M3's reported-charge channel on one frozen source |
| `collect <conversation-acceptance.json> <auth-file> <frozen-inputs.json>` | Execute the exact diagnostic or measured schedule sequentially |
| `settle <preparation-acceptance.json>` | Reconcile retained stage receipts and append programme settlement, keeping unknown holds |

`collect` reports whether collection finished or stopped and names `collection-outcome.json`. It does not perform programme settlement; `settle` remains a separate accepted operation.

Live roots must be real, distinct directories under this checkout's experiment evidence parent, not scratch clones. Permanent per-run admission claims reject duplicate live observations. Source or accounting failures stop the batch and leave not-run rows. Budget refusal is latched and remains a failed observation, not an apparent token-saving result.

A missing stage budget after a started operation is held conservatively during close-out. Unknown charge holds are not silently released. A revised diagnostic or capture requires a new identity and a separately accepted allowance; it never replaces a scheduled observation.

## Operational Limits

The full-catalogue reservation bounds remain deliberately conservative. An unknown charge from even one failed extraction can prevent a retry while other extractions remain active. The run and batch then stop as budget-limited, even when known charges are small. This is a financial-control outcome, not evidence for either research arm. No unverified per-message tokenizer estimate replaces these bounds. Financial admission must explicitly accept this stop behaviour; it is not renegotiated after seeing failures.

The collection driver appends `collection-progress.jsonl` after every retained row. If its parent is interrupted, that journal preserves completed row identities, but the absence of a final inventory and outcome is not a terminal collection result. Keep the programme reservation and all run directories intact. Confirm that no collector or worker remains active, inspect the progress journal and financial receipts, and obtain separately recorded coordinator acceptance for any recovery. Do not restart the same observation identities or synthesise a terminal outcome for automatic settlement. A post-session finalisation failure or worker kill can likewise leave only `started.json`, `events.jsonl` and `process.log`; settlement retains the conservative full-stage hold when the final budget is unavailable.

`writerLockPath` is an agreed operational lock location, not a financial record. Keep it in shared, task-owned encrypted scratch and require every programme writer to use the same path. A killed writer can leave an empty lock directory. Do not remove it merely because a command reports `EEXIST`: first confirm that no writer is active, inspect the authoritative ledger and retained receipts, and obtain operator confirmation. Remove only the verified empty lock with `rmdir`; never remove the ledger or evidence, and never force-remove a nonempty path.

The attribution leaves mixed host guidance unallocated rather than labelling it avoidable overhead. Provider totals and raw request contents remain available; the component estimates do not establish an exact semantic split or a causal explanation for every token difference.

## Checkpoint Reports

Implementation checkpoints record tests actually run, the retained synthetic proof, independent review findings and unresolved gates. A complete experiment additionally requires the measured inventory, independently checked adequacy, financial settlement and a findings note. An implementation checkpoint alone does not establish one-handoff conformance on the live main model, useful answers to the selected query or lower traffic.
