# Research Handoff Execution Plan

Status: accepted for execution by the owner on 4 November 2026, with the unchanged-text candidate, proposed query and parallel build tracks. The owner instructed the coordinator to validate delegated work as it arrives. The [Protocol](PROTOCOL.md) records the accepted implementation choices. Implementation-entry, diagnostic and paid-collection gates remain binding; acceptance of this plan alone does not establish that those gates have passed.

## Purpose and Authority

Deliver one bounded experiment comparing a direct `intelli_research` call with a Codemode call to the same operation. Establish source equality, measurement correctness and evidence access before spending on collection. Report equal resumptions or increased Codemode traffic if that is what the evidence shows.

The [Handover](HANDOVER.md), [Brief](BRIEF.md) and [Feasibility](FEASIBILITY.md) govern the work. In particular, the Brief's Comparison Section states:

> The candidate changes the main-thread invocation and return boundary, not the research evidence or model quality.

No prior scientific material, execution scripts or experimental runtime will be imported. The existing financial ledger is the sole historical-data exception. Package integration, publication, version changes, a merge to `main`, old-host qualification and a security workstream remain outside scope.

## Inspected Starting State

| Item | Observation on 4 November 2026 |
|---|---|
| Implementation Checkout | The current checkout is the named `research-handoff-runner` worktree on `study/research-handoff-runner`; it already exists and will not be recreated or reset |
| Starting Commit | `77913e0ba9755a532d6505616d76c16c75bef9e6`, also the planning branch tip at inspection |
| Product Baseline | `d2ec50611ede2f5d46c062b7e568b13203015c22`; the intervening tracked changes are the three handover documents and branch instructions |
| Working Trees | Both implementation and planning tracked trees were clean before this plan was written |
| Storage | The implementation checkout resolves to `/dev/mapper/secure[/@repos]` |
| Dependencies | `node_modules/` exists; its provisioning and lockfile consistency still need verification |
| Host | The retained host manifest identifies `Pi` 1.5.0; no experiment session has yet proved the loaded runtime and peer identities |
| Parallel-Agent Facility | Herdr client and server report 0.9.5, compatible, with no restart needed; the implementation worktree already has its own workspace |

The new planning run is `20261104T105817Z-research-handoff-plan`. The [planning report](../../../evidence/agents/20261104T105817Z-research-handoff-plan/reports/planning-report.md) records the inspection and financial-check methods. Its companion [prose review](../../../evidence/agents/20261104T105817Z-research-handoff-plan/reports/prose-review.md) identified corrections incorporated into this proposal. These local evidence files are gitignored and do not travel with a clone. Implementation and collection will each receive a new identity at assignment start.

## Recommended Experiment

### Arms and Return Contract

| Property | Baseline | Candidate |
|---|---|---|
| Main Invocation | One direct `intelli_research` call | One Codemode script awaiting that same tool once |
| Exposure | Codemode disabled; direct research declaration | Codemode `only`; research declaration inside its catalogue |
| Returned Research Content | Existing native result text, unchanged | The same native result text, unchanged, returned once by the script |
| Host Envelope | Native tool envelope | Actual Codemode envelope, including its status and timing text |
| Other Available Operations | One matched, workspace-contained read tool for recovery | The same read operation available inside Codemode |
| Research Engine | Baseline core with immutable per-run input injection | Identical core and injection |

The unchanged-text candidate is the recommended first experiment. The baseline already returns a summary, evidence references and diagnostics. This design isolates the cost of the invocation and catalogue rather than assuming a further compression benefit. Codemode's wrapper text is part of the measured treatment, not something to strip from the trace.

The main model must generate its own call or script. The measured prompt will describe the required route but will not supply executable script text. No additional summarisation model is introduced. No `r.summary` or other structured result is assumed: this baseline returns text.

A reduced response is an alternative decision before protocol freeze, not an additional measured arm by default. It requires a trustworthy structured seam and a field-by-field projection preserving the useful summary, evidence access, failures and truncation status. Do not split arbitrary Markdown on a guessed delimiter. If selected, revise this plan and obtain acceptance before building or collecting that candidate. Do not choose the projection after inspecting measured savings.

### Query and Adequacy

Proposed fresh query about [_PostgreSQL_](https://www.postgresql.org/docs/17/), authored for this plan:

> For a PostgreSQL 17 job table with several concurrent workers, explain how FOR UPDATE SKIP LOCKED differs from transaction-level advisory locks, where LISTEN/NOTIFY helps, and what is still needed to avoid lost jobs or duplicate external side effects.

Proposed focus: transaction boundaries, lock lifetime, worker coordination, crash recovery, notification limitations and evidence-backed safeguards for external side effects. Guide discovery to `postgresql.org`, with a source allowance of three. Domain guidance is not an input-integrity guarantee; validate the captured source identities separately.

The final main prompt will request a concise answer of at most 600 words, source citations and the saved report reference. The word limit is an instruction, not a claim of hard token enforcement. Freeze the exact prompt, main output-token cap and reasoning settings after confirming the pinned host's supported controls.

Adequacy will use six pass/fail criteria, with a cited justification for each:

1. Explain row-lock worker selection and the limitations relevant to the proposed queue.
2. Distinguish transaction-level advisory locking from row locking, including lifetime and coordination requirements.
3. Explain the role and limitations of notifications rather than treating them as the durable job record.
4. Address worker failure, transaction boundaries and retry/recovery behaviour.
5. Address duplicate external effects without claiming that database locks alone guarantee exactly-once execution.
6. Supply support applicable to PostgreSQL 17 and a readable saved-report reference, preserving material failure or truncation caveats.

These are assessment topics, not a prewritten factual answer. Mark an answer adequate only when all six pass and it contains no material unsupported claim. The coordinator will assess de-identified answers against the frozen sources; an independent technical reviewer will check every assessment. Disagreements remain visible until adjudicated with a source citation. A paid model judge is not required. Hiding arm labels reduces cueing but does not guarantee successful blinding.

### Schedule and Matched Controls

Use one common capture and ten pairs, each containing two independent conversations. Odd pairs run Baseline then Candidate; even pairs run Candidate then Baseline. Record the complete order before capture. Run conversations sequentially, with a recorded minimum gap of 30 seconds. Process startup and scheduling add overhead; the fixed parent sleep is not an exact interval between child timestamps. Do not parallelise measured sessions or adapt their order to outcomes.

Keep the prescribed host and model roles from the Brief. Use main reasoning `low` if the pinned model supports it; otherwise resolve the setting before freeze without substituting a model. Extraction and collation retain the baseline's `low` reasoning. Preserve baseline tuning from `src/core/defaults.ts`, except for explicitly matched study settings: three sources, new `.search/` state, and documentation discovery disabled. Record the fully resolved settings rather than relying on ambient defaults.

Every run gets a new process, session and empty workspace. Disable unrelated extensions, skills, project instructions, prompt templates, cache warming and automatic compaction for both arms where the host supports explicit controls. Record the effective system prompt and tool catalogue. Keep unavoidable host instructions visible in accounting. A context limit or unsupported required control is a recorded failure or preflight blocker, not permission to alter one arm.

Provide a matched read capability restricted to each run's workspace, with resolved-path containment checks. Expose no shell, arbitrary file access or free network tool to the main model. Frozen common inputs remain outside those workspaces and are supplied privately by the adapter. Record any cache read as a deviation from the primary one-handoff route. This is controlled capability exposure, not a claim of operating-system sandboxing.

Provider prompt caching is not disabled by an empty workspace. Record cache configuration and reported cache components; do not describe the schedule as a cold-provider-cache test.

## Milestones and Gates

### M0: Establish the Execution Boundary

At implementation start:

- Confirm ownership of the existing implementation checkout before code changes. Preserve the planning checkout and all other worktrees.
- Verify dependencies against this checkout's lockfile; use the repository's package manager if provisioning is required. Do not copy credentials or ignored state from other checkouts.
- Read the pinned host's full relevant extension, software development kit (SDK), Codemode, session and provider documentation, plus linked examples and shipped declarations, before implementation. The planning inspection covered Codemode, SDK and the observer-hook documentation, not that full implementation audit.
- Verify exact model identifiers without inference, and record resolved host, provider-library and extension paths and versions. A manifest check or installed repository peer is not runtime provenance.
- Allocate fresh evidence and task-owned scratch paths. Establish the coordinator as the sole integration, full-suite and financial-record writer.

Exit: a clean, owned execution environment and a written boundary record. No live inference or paid page/search capture.

### M1: Freeze the Implementation Contract

Write `PROTOCOL.md` under this directory, containing the selected arm contract, exact query and focus, prompt text, catalogue, settings, adequacy rubric, schedule, measurement definitions, missing-data rules and stop conditions. Include a preliminary bounded cost estimate before implementation acceptance, using verified rates, conservative prompt bounds, finite attempt limits and the dated available balance. Refresh that estimate against implemented prompts at M4. If a defensible preliminary bound is unavailable, M2 is blocked unless the owner explicitly changes this prerequisite. Unresolved transport coverage remains a declared later qualification gate, not a presumed capability.

Freeze admission limits as part of this contract. Proposed limits are one chargeable research invocation per conversation, at most four logical main requests, and at most three provider attempts per logical main request. Enforce the research limit atomically before dispatch, including concurrent calls from a script; reject further research calls without new pipeline spend and record nonconformance. Preserve the baseline's downstream retry limits and include every outstanding extraction in the reservation. Confirm that main attempt limits can be enforced through the pinned host; otherwise resolve the bound before implementation acceptance. The two subscription-main diagnostics have the same main-request limits and synthetic downstream operations. Recovery beyond these bounds needs a separately accepted diagnostic identity and allowance.

The coordinator then freezes shared interfaces for `FrozenInputs`, `RunManifest`, request/attempt events, pipeline usage and analysis rows. These names are proposed new interfaces, not existing repository APIs. Schema ownership stays with the coordinator throughout parallel development.

Before coding, accept the bounded implementation plan within the Brief's authority. Escalate changes to the research question, prescribed models, host, ceiling or unresolved validity choices to the owner. The owner accepted this plan's recommended choices; remaining implementation and collection prerequisites still require recorded coordinator acceptance.

Exit: one accepted implementation contract and an explicit file-ownership map. No measured data is available when these choices are made.

### M2: Build One Integrated Candidate

Build three modules in parallel after M1. Proposed paths below are new, not existing commands or interfaces.

| Track | Owned Files | Deliverable |
|---|---|---|
| A: Common Inputs | `scripts/research-handoff/common-inputs.ts`, `registration.ts`; matching adapter tests | Capture format, immutable replay, native-wrapper parity and real report persistence |
| B: Host and Recorder | `scripts/research-handoff/host.ts`, `recorder.ts`; matching host tests | Pinned-host sessions, actual direct/Codemode routes, attempt and usage records |
| C: Offline Analysis | `scripts/research-handoff/analyse.ts`, `adequacy.ts`; matching analysis tests | Request attribution, resumptions, reconciliation, per-run and paired tables |
| Coordinator | Shared contracts, runner entrypoint, protocol, package/test wiring and any approved native seam | Integration, one validation lane and bounded execution controls |

Track A will capture the full fresh search completion and citation channels, apply the baseline merge/deduplication/cap semantics, then freeze the selected ordered pages and failures. During measured execution it will replay the completion through a model-client decorator and serve pages through `ResearchDependencies`. It must reject unexpected prompts, parameters, source order, configuration or hashes, without live discovery fallback. Returning replayed search usage must not create another provider charge.

Record both full selected page hashes and extraction-message hashes at the actual model boundary after baseline truncation and message construction. The baseline may compute source selection again from the replayed completion; assert equality with the once-frozen capture selection rather than replacing its selection algorithm.

Prefer benchmark-only registration preserving the native tool's name, schema, guidance, rendering, progress and result behaviour. Do not mutate shared `__harness` globals across sessions. If parity requires a small native factory seam, the coordinator reviews its exact scope before editing; default product behaviour remains unchanged and no public fixed-source parameter or package feature is introduced.

Track B will load the retained host explicitly, register and activate Codemode for SDK sessions, and prove both routes with a synthetic main transport and synthetic research completions. A coordinator-supplied test script proves adapter execution only. Later measured scripts must come from the real main model.

Track C can develop against newly authored synthetic traces as soon as the schema is frozen. It must not wait for paid data or read earlier study fixtures.

Exit: one integrated candidate executing both synthetic routes through the actual host and writing genuine reports. This is not evidence of live model conformance or savings.

### M3: Prove Correctness and Review the Boundary

The coordinator owns the full validation lane. Builders can run their assigned deterministic tests with separate scratch, but do not run concurrent full suites or regenerate shared artefacts.

Required checks:

| Boundary | Acceptance Evidence |
|---|---|
| Native Parity | Identical synthetic input produces the same native result text, diagnostics, schema and saved-report contents under the original wrapper and the new registration; account explicitly for unavoidable path/time differences without broad string normalisation |
| Fixed Inputs | Ordered source and extraction-message hashes match; altered, missing, reordered or corrupt material fails without fallback |
| Persistence | Report and cited source paths resolve inside the run; failed writes, partial extraction and truncation remain visible |
| Host Route | Actual pinned host records one direct call or one Codemode call with the expected nested research call; progress and nested events do not become extra main requests |
| Observer | New synthetic traces cover streaming snapshots, missing usage, retries, cancellation, additional calls and settled-session boundaries |
| Accounting | Every observed provider attempt is counted once; pipeline calls and replayed setup are separated from main usage; cache and reasoning components are not double-counted |
| Isolation | Ordinary model reads cannot reach frozen inputs or another run; ambient resources are absent; workspaces do not share writable caches |
| Failure Retention | Interrupted and nonconforming runs retain identities and partial evidence; restarting the runner does not overwrite or silently replace them |
| Budget Controls | Deterministic admission tests cover insufficient allowance, concurrent writers, unknown charges, interrupted reservations, duplicate research calls and main-request/attempt limits |
| Reproduction | Offline analysis reproduces expected synthetic tables and flags missing or inconsistent records without model calls |

Run `npm run build`, `npm run test:all`, `npm run test:handoff` and `npm run typecheck:handoff`, plus relevant type checks including `test/tsconfig.native-contract.json` if native seams change. The pinned-host study lane is separate from the native and standalone package lanes. Run applicable generator checks; run shared/standalone checks if shared source changes. Shell scripts, if introduced, require `shellcheck`. Do not invoke the general paid end-to-end suite, publication gates or an audit/security workstream merely because package scripts exist.

An independent technical reviewer examines the integrated candidate and measurement boundary before collection readiness is accepted. The reviewer is read-only, reports by severity and can challenge the design beyond the listed tests. Resolve blocking findings as one integrated milestone rather than a succession of tiny acceptance cycles.

Exit: implementation-readiness report with code identity, actual-host evidence, tests run and limitations. Collection remains blocked on M4's financial acceptance and live observer qualification.

### M4: Accept the Costed Batch and Verify Live Coverage

Reconcile the financial ledger again, refresh rate information without paid inference, and calculate maximum admitted exposure from implemented request bounds and retry limits. Accept a bounded diagnostic schedule against an identified candidate code revision and protocol hash before any live inference. The planned measured batch must already have a checked cost envelope, but is not yet authorised to start.

Include two non-measured, subscription-main diagnostic conversations in that schedule: one direct and one Codemode, both using new synthetic research inputs. Their purpose is to verify the prescribed main model's selected transport, request observation and usage reconciliation. They do not establish adequacy on the research query. Record their main usage separately and do not fold them into the ten pairs.

Distinguish a provider-boundary payload hook from on-wire coverage. Inspect the actual provider implementation and test the selected transport, including whether it sends full history or delta requests. If a public, symmetric transport setting is needed to make the boundary observable, treat that change as a new candidate revision. Retain the failed diagnostic, update code/settings/protocol identities, refresh costs, obtain independent review of the affected measurement boundary and accept an additional bounded diagnostic allowance before rerunning both routes. Do not patch the host or claim wire-level coverage from hook counts alone. Missing attempt coverage blocks measured collection. After observer qualification, the coordinator may accept the bounded preparation reservation against the identified code and protocol. Final measured-batch acceptance waits for the accepted corpus and charge-reporting qualifications. The per-entry sequence in [Reproduction](REPRODUCTION.md#live-gates) governs these distinct gates; any later validity-affecting change invalidates the relevant acceptance.

After these checks, capture common search and pages once under the accepted financial reservation. Retain unsuccessful preparation attempts under distinct identities. Accept a usable corpus only if at least two selected pages are readable and the frozen source material supports assessment of the declared topics for PostgreSQL 17. Record version labels and justify applicability for any unversioned source. Unresolved applicability fails preparation. Assess these conditions before seeing any arm result, then bind the accepted corpus digest to the frozen batch. A failed preparation is retained; another capture needs an explicit additional allowance within the accepted schedule, not an unlimited retry loop.

Exit: live observer coverage, verified immutable common inputs and an accepted costed schedule. No per-call owner approval is needed within that accepted batch.

### M5: Collect the Ten Pairs

Execute the frozen order sequentially. Before each run, verify code/protocol/input hashes and reserve its maximum outstanding exposure. Start a fresh process and workspace, capture requests and completed responses, wait for session settlement and pending work, then verify report access and settle known charges. Keep unreported charges held.

Stop the batch on input mismatch, missing observer coverage, changed host/model/configuration, an unresolved financial record, or insufficient allowance. Ordinary failed or nonconforming observations remain in the scheduled inventory. Do not replace them. A separate diagnostic run gets a new identifier and never fills their row.

The runner must distinguish scheduled, started, completed, failed, nonconforming and not-run records. Preserve partial traces on cancellation. Never treat a process exit code alone as a research verdict.

Exit: a complete retained inventory of the planned conversations, including not-run rows if stopped, with financial settlement or explicit holds.

### M6: Analyse, Assess and Report

Run offline analysis on the retained data, assess answer adequacy and obtain an independent check of the resulting claims. Produce a compact table of absolute values and paired differences, with a linkable per-run inventory and the complete failure/nonconformance counts.

Deliver `FINDINGS.md` and `REPRODUCTION.md` here. Document an implemented, tested offline command that reads existing evidence without inference, writes a new analysis output directory and refuses to overwrite raw data. The final implementation report names the branch and commit, actual host/model identities, dataset, test evidence, reproduction command, costs and unresolved limitations.

For this first batch, permit a positive comparative claim only if all twenty scheduled runs complete, conform to their assigned route, pass every adequacy criterion and retain readable evidence references, with the claimed metric observed in both arms of every pair. Require a strictly lower candidate mean for the named metric across the ten pairs. Report any regression in other metrics alongside it; a token reduction is not an unqualified overall benefit if resumptions increase. If the completeness, conformance or adequacy condition fails, report descriptive differences and limitations only, not an overall savings-with-preserved-usefulness conclusion. This deliberately conservative rule is fixed before collection. With this small single-query experiment, make no general non-inferiority claim. A result showing no advantage completes the experiment equally well.

## Measurement and Analysis Rules

### Raw Records

Keep new raw evidence under `evidence/benchmarks/research-handoff/<new-series-id>/`, including:

- Protocol, code, runtime, settings and catalogue identities.
- Common search request/completion, citations, reported usage, source selection, selected page bytes, variant metadata and failures.
- Per-run session transcripts, provider-boundary request records, provider events needed for attempt/usage reconciliation, tool inputs/results, final answers and settled outcomes.
- Per-stage downstream completions and usage, reports, source files, adequacy assessments and financial receipts.
- Append-only run inventory and a hash inventory linking each immutable artefact to its role.

Record request content without authentication headers or credentials. Review any shareable export separately; permission to retain source pages locally is not automatic permission to redistribute them. No durable report cites scratch.

### Counting Units

Maintain separate identifiers for a logical main-model request and each provider attempt. Automatic transport retries are attempts, not automatically additional research-orchestration resumptions. A resumption requires a new main-model request after tool execution; identify the final answer-producing resumption separately from additional research/recovery continuations.

Report cumulative main input and output tokens separately, and their labelled sum. Preserve raw provider usage and document normalisation: cached input may be included in or separate from the provider's input field. Reasoning is not added again when already part of output. Missing fields remain unknown. Keep setup and downstream pipeline usage separate from main usage.

Retain all actual history retransmissions. Record terminal conversation content and peak logical request context separately from cumulative processing and transmitted delta size. Do not call a count of streaming snapshots a count of requests.

### Attribution

Use provenance-tagged content spans for common instructions/query, arm declarations/guidance, generated arguments/scripts, intermediate research material, useful summary/evidence, necessary status, error/recovery traffic and other/unallocated content. Preserve the tool-returned summary separately from the final main answer.

Proposed estimation method: a locally pinned `o200k_base` tokenizer, applied to recorded textual content with a fixed serialisation rule. Verify the local implementation and freeze its version before coding the analyser. Treat it as a proxy, not an asserted tokenizer for the prescribed main model. Keep whole-request estimates, component estimates and a signed reconciliation residual against provider totals. Do not force independent fragment estimates to sum exactly or relabel all residuals as avoidable overhead. If the method cannot be implemented reproducibly, resolve its replacement before collection.

Count generated scripts as output and, when later supplied in context, as input. These are distinct processing events, not accidental duplicate accounting. Do not subtract final-answer output tokens from input to derive overhead.

### Population and Missingness

For the initial analysis, use descriptive within-query statistics only: per-run values, paired candidate-minus-baseline differences, mean, median and range. Do not add a significance test or confidence interval after seeing results. Ten pairs of one query do not establish generality.

Publish every scheduled row. Numeric pair summaries use pairs where the relevant metric is observed in both arms, with the denominator printed beside each summary. Do not impute missing usage as zero. Show completeness, conformance and adequacy classifications alongside those summaries; give the conforming-and-adequate subset as a separately labelled view, never as the whole experiment. If missingness or failures prevent a defensible comparison, report the limitation rather than a savings claim.

## Budget

The programme ceiling and financial-ledger path remain those in the [Brief](BRIEF.md#retained-model-roles-and-budget). A planning-only read at `2026-11-04T10:59:35Z` found:

| Financial Item | Recorded USD |
|---|---:|
| Known Charges, Including Opening Balance | 2.081050546 |
| Unknown-Charge Holds | 1.500000000 |
| Active Reservations | 0.000000000 |
| Remaining Ledger Allowance | 26.418949454 |

The inspected ledger had 279 records, ending at sequence 278, with digest `72bf6b92f906fc28c2e7f711a4fb6256926fa0f1ad7530ae6991a81ed3984725`. Sequence continuity, previous-record hashes, reservation pairing and settlement arithmetic passed the planning check. This establishes the balance recorded in that file, not completeness of external billing or absence of unrecorded commitments. Reconcile both before approval. No ledger entry was changed during planning.

Do not use previous-run costs to predict this experiment. Derive its estimate from current rates and this new protocol:

- One common search capture, including bounded search retry exposure and any applicable request fee.
- One selected-page capture; its network requests are setup work, not repeated arm calls.
- The conforming route comprises twenty runs with at most three extraction operations and one collation each: up to 80 downstream logical model operations before retries. The enforced one-research-invocation limit prevents nonconforming scripts from creating a second pipeline under the same reservation. Fresh-cache suggestion inference is expected to be absent and must be verified.
- Two subscription-main observer diagnostics, then twenty measured main conversations; record usage even when marginal billed cost is zero.
- The separately bounded downstream charge-reporting qualification defined in the Protocol; it is not a measured conversation.
- A separately bounded contingency, if accepted. No unbounded capture retries or automatic replacement runs.

Compute input bounds from the complete constructed prompts, not page characters alone; include maximum output, reasoning treatment, all retry attempts and outstanding parallel extraction calls. Reserve before dispatch, then replace reservations with reported charges and retained unknown holds. The first schedule should request only its justified envelope, not the entire remaining programme allowance.

No numerical collection estimate is approved yet: current rates, full prompt bounds and the final attempt policy have not been verified. A conservative preliminary estimate is an M1 prerequisite before coding; refreshing and independently checking it against implemented bounds is an M4 prerequisite before live qualification or collection. The writer must preserve one authoritative programme balance and coordinate with any other ledger writer; a new branch-local ledger cannot create a second allowance. Financial compatibility may be implemented from the record format without importing old execution code.

## Parallel Herdr Plan

Parallelism is useful for implementation and independent review, not for the measured conversations.

| Wave | Concurrent Work | Dependency |
|---|---|---|
| 1 | Source-adapter design and host/observer design; coordinator prepares protocol, schema and budget method | Owner discussion complete; no code until M1 acceptance |
| 2 | Builders A, B and C work on their disjoint owned files | Shared interfaces frozen; C can start with new synthetic traces |
| 3 | Technical review of the integrated candidate and prose review of protocol/reproduction guidance | Coordinator finishes integration and serial full-suite validation |
| 4 | Independent adequacy review and offline numerical reproduction | Collection is settled and raw data is immutable |

Use the existing implementation workspace, one tab per agent, no split panes. The handover permits one implementation worktree, not an automatic fleet of additional branches. Use disjoint-file builders in that checkout; any need for more worktrees requires an owner decision. Agents cannot install dependencies, modify shared contracts, run the full suite, commit, push, spawn agents or change branches. Escalate cross-track edits to the coordinator.

For this run, the coordinator's `gpt-6-astra` model is excluded from the pool. Propose native `zai/glm-5.3` builders for A and B, and native `kimi-coding/k3.1-pro` for C, subject to the live roster and availability. The roster's preferred Claude builder is not selected because the shared-checkout arrangement does not provide its prescribed build isolation. An independent Claude reviewer on `claude-opus-5-5[1m]` can perform read-only technical review; `qwen-token-plan/qwen3.8-max` is the next reviewer option. Use `openai-codex/gpt-6.1-sol` for prose review. These are development-agent assignments, not changes to the experimental model roles.

Before each pool, run the house Herdr preflight and roster check, stagger launches, pass a rendered brief at spawn and confirm actual model provenance. Briefs specify owned paths, prohibited old-study material, no live study calls, encrypted scratch, exact report paths and the no-spawn rule. Read-only reviewers may write only their own reports and allowed scratch. Agent status is not acceptance: read and verify the durable report.

The critical path is protocol/interfaces, then host measurement and adapter parity, then integrated review, budget/live-observer qualification, sequential collection and final analysis. Adding builders beyond three does not shorten the sequential gates and increases shared-interface coordination.

## Accepted Choices

The owner accepted the unchanged-text candidate, the proposed single query and three disjoint-file build tracks in the existing worktree. No extra worktrees are assumed. The implementation-readiness report precedes acceptance of the costed collection batch. The incoming lead can accept that later batch within the standing authority once its gates pass; changes to the agreed scope remain owner decisions.
