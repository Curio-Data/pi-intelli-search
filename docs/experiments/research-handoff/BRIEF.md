# Research Handoff Experiment Brief

Status: owner-agreed direction and `Pi` 1.5.0 host pin, recorded 4 November 2026. The exact collection protocol still needs freezing before paid execution. Start with [Handover](HANDOVER.md), this brief and [Feasibility](FEASIBILITY.md), not the previous Codemode study's protocol.

## Objective

Determine whether a Codemode research handoff reduces unnecessary token traffic and research-related resumptions in the main large language model (LLM) conversation while preserving a useful answer and access to its evidence.

The owner described the desired interaction as:

> main -> summary of answer and links to .search

The intended boundary is one request followed by one useful response, like an application programming interface (API) call. Search, page fetching, extraction, collation and persistence happen behind that boundary. The main model should not need to supervise each step. The owner did not prescribe a telemetry schema: the measurements must explain what content and repeated processing were avoided, not merely provide a token total.

This is a fresh experiment. Do not reuse previous study queries, captures, observations, scores, datasets, reports, statistical rules or execution scripts. Existing released product code is the implementation under test, not reused experimental evidence. Do not merge the previous experimental branch. Financial obligations remain obligations: a fresh dataset does not reset a spending ceiling.

## Branch and Authority

- Planning branch: `study/research-handoff`, created from `main` at `d2ec50611ede2f5d46c062b7e568b13203015c22`.
- Planning worktree: `/srv/secure/repos/CURIO/.worktrees/pi-intelli-search/research-handoff`.
- The incoming lead agent creates `study/research-handoff-runner` in a new sibling worktree from the committed planning tip, following [Handover](HANDOVER.md). Do not branch from the former Codemode study or start again from `main`, which lacks this handover.
- Initial assignment: prepare the fresh protocol, required measurement path and collection plan. Implement only the bounded benchmark adapter, main-request observer, attribution analysis and deterministic checks needed after the coordinator accepts that plan. Do not start live capture from this brief alone.
- No package release, version bump, main merge, old-host qualification or security-investigation work is commissioned.
- The owner uses speech-to-text. Resolve obvious transcription errors from context; surface ambiguities that change the experiment.

## Retained Model Roles and Budget

The model assignments below carry forward the owner's model selection, not the previous study's observations or protocol. They are the proposed unchanged assignments for the new collection plan; any substitution needs an explicit owner decision.

| Role | Provider and Model |
|---|---|
| Main Model in Both Arms | `openai-codex/gpt-6.1-sol`, subscription |
| Common Search Capture | `openrouter/perplexity/sonar` |
| Extraction, Collation and Any Cache Suggestion | `openrouter/minimax/minimax-m3` |

A paid quality judge is not a prerequisite. Freeze the answer-adequacy method and who checks it in the new plan; do not inherit previous judge scores, calibration or reliability claims.

The owner approved `Pi` 1.5.0 for both arms on 4 November 2026. Use the retained release at `/home/miah0x41/.pi/agent/install/releases/1.5.0/node_modules/@earendil-works/pi-coding-agent`, not a moving `pi` launcher or the former study's host. Record and verify the actual loaded host and peer identities. If this release or a prescribed model is unavailable, report the blocker; do not substitute silently.

The standing programme ceiling remains USD 30. The retained append-only financial record is `/srv/secure/repos/CURIO/.worktrees/pi-intelli-search/codemode-research/evidence/benchmarks/programme-spend/spend-ledger.jsonl`. Before accepting a costed schedule, the coordinator must supply a dated balance covering prior known charges, historical unknown-charge holds, active reservations and the remaining allowance. Read that record only for financial continuity, not as experimental data. No balance was re-audited for this brief, and the new branch does not imply that USD 30 is unspent. If the record is unavailable, obtain the balance from the coordinator rather than assuming a fresh allocation. This narrow financial exception does not permit reuse of old scientific material.

## Comparison

The baseline is the current `intelli-search` research operation, `intelli_research`, not a manually decomposed sequence of search, fetch and extract calls. Its implementation is already self-contained. The initial study concerns research, not the separate quick-search `intelli_search` operation.

Use the same baseline core, settings and source adapter in both arms. The candidate changes the main-thread invocation and return boundary, not the research evidence or model quality. Record the exact code differences. If a proposed Codemode engine also changes the pipeline, describe it as a broader engine comparison and obtain a scope decision before measurement.

| Arm | Main-Thread Interaction | Required Behaviour |
|---|---|---|
| Baseline | Main model calls `intelli_research` directly | Preserve its existing result text, diagnostics and cache references; do not enlarge its response to manufacture overhead |
| Codemode | Main model issues one Codemode script that calls the same research operation | Keep internal work inside the call and return the useful summary, evidence references and necessary failure or truncation status |

Define and freeze the Codemode mode and catalogue before collection. Simply enabling `on` and leaving tool selection unforced does not test the proposed boundary. Script-only exposure is a candidate configuration, not a measured fact or an approved implementation. Count every instruction and declaration it requires. Use the real main model to issue the handoff; a coordinator-supplied script executed without main inference is only an adapter check. If a script is supplied in the prompt, count its input cost and disclose that different task.

A wrapper returning the baseline text unchanged is the minimal control. A smaller return requires an explicit projection contract: identify which fields disappear and why they are unnecessary for the answer. Do not silently add an extra summarisation model or discard important caveats, source failures or evidence links. A shorter answer is not automatically avoided overhead.

Both arms may already achieve one handoff. Report that equality if observed. Do not substitute a weaker manual baseline to create an interruption advantage.

## Common Sources

The owner's proposed control is to query [_Perplexity Sonar_](https://docs.perplexity.ai) once for a new task and provide the resulting source set to both arms. Adopt that separation, with the following precision:

1. Capture a fresh search response outside the two measured main conversations. Preserve the query, focus, model and settings, response text, citation annotations, timestamp, reported usage and selected ordered source list. Apply the baseline's citation merge, deduplication and source cap once. Keep a hash of the complete capture.
2. Fetch the selected sources once through the existing fetch implementation. Freeze the chosen page text, titles, source URLs, fetch-variant metadata and failures. Freeze what extraction actually consumes, including truncation settings, rather than only a list of addresses. Equal URLs fetched twice do not guarantee equal content.
3. Give both arms access to those immutable inputs through an internal adapter. Do not paste the pages or the source manifest into the main conversation. Each main conversation receives the same query and task instructions; the adapter resolves its inputs privately.
4. Refuse a source, order or content mismatch. No live search or page-fetch fallback may replace missing material. Preserve failed capture attempts and their charges under distinct identities.
5. Leave extraction and collation live in the initial fixed-source comparison, with identical prompts, models, limits and settings. Their outputs can still vary. Record that variation and answer adequacy rather than attributing every token difference to orchestration.

The measured boundary starts with the main request after common-input preparation and ends at the settled final answer. Report the common preparation cost separately and once. This is an end-to-end handoff over fixed source evidence, not an end-to-end live search or network-latency benchmark.

An additional fixed-response control can use newly captured extraction and collation responses if needed to isolate presentation costs. It is a separate, clearly labelled measurement, not a prerequisite for the first study and not a substitute for the live downstream comparison. No old fixtures may be used.

## Initial Schedule and Controls

The proposed first dataset is one fresh query repeated ten times in each arm: twenty independent conversations arranged as ten pairs. Freeze the query and usefulness criteria before capture. Alternate or randomise arm order with a recorded schedule. Ten repeats of one query measure repeatability for that query, not generality across user needs. A broader task set is a later decision.

Every execution starts with a new session and an empty workspace. It may write its own `.search/` results; it must not read previous executions' caches. Do not delete an operator's cache. Keep the common frozen inputs outside the session workspace and inaccessible to ordinary model file reads. Preserve each run's output and verify its reported cache paths resolve.

Match the main model, reasoning level, task wording, final-answer budget, research models, source allowance, extraction limits, concurrency and retry policy. Disable unrelated skills, extensions and contextual instructions equally. Record every necessary arm-specific instruction rather than hiding it from token accounting. Disable extra documentation discovery for the fixed-source comparison in both arms; otherwise freeze and account for those additional sources too.

A fresh `.search/` folder does not disable provider prompt caching. Record cached and uncached input separately, but total input remains required. Use fresh sessions, balanced order and recorded caching settings; do not claim to control a provider's cache merely by deleting files.

## Measurements

The agent may choose the storage schema. The records must support the following questions from actual main-model requests and completed responses, not from terminal output or tool-event counts alone.

| Question | Required Evidence |
|---|---|
| How much processing entered the main thread? | Provider-reported cumulative input and output tokens, reported separately and as a labelled sum; input cache components and reasoning usage where exposed; explicit missingness |
| What caused that traffic? | Request-level content attribution covering common instructions/query, arm-specific declarations/guidance, tool arguments/scripts, intermediate research material, useful returned summary/evidence references, and error/recovery traffic |
| How much context remains? | Material left in the main conversation at completion and peak request size, separately from cumulative tokens processed across all requests |
| How often did the main model resume? | Main-model request sequence, top-level handoffs and post-tool resumptions; identify the final answer-producing resumption separately from additional research-orchestration resumptions |
| Was the intended boundary followed? | One-handoff conformance per run, actual tool route, extra scripts, cache reads, retries and failures; retain nonconforming runs |
| Was the useful result preserved? | Final answer, tool-returned summary, evidence references, saved report, source coverage and a frozen answer-adequacy assessment |

Count each provider attempt once. Count repeated history again when it is actually processed in a later request; that repetition is part of the effect. Do not count streaming snapshots as separate requests. Keep main-model usage separate from research-pipeline usage. Do not add reasoning tokens twice when already included in output. Record tool-generated script tokens both as generation and, where applicable, later input, with those different roles explicit.

Provider usage gives whole-request totals, not a semantic payload breakdown. Use a documented tokenizer or attribution method for components, label component counts as estimates when appropriate, and retain an unallocated or reconciliation residual. Do not claim that independently tokenised fragments exactly sum to the provider's count. Unknown usage is not zero. Do not derive overhead by subtracting final-answer output tokens from input tokens.

Define useful payload and necessary status information before inspecting results. Keep the tool-returned summary distinct from the main model's final answer. Material outside those categories is a candidate for avoidable traffic, not proof of uselessness. Report content categories and explain exclusions so another analyst can challenge the classification.

An internal fetch, pipeline model call, progress update or nested tool event is not a main-thread interruption unless it causes another main-model request. The target is one top-level handoff, one result and one answer-producing resumption, with zero additional research-orchestration resumptions. Fewer requests or fewer page characters do not by themselves establish better reasoning; describe reduced context exposure unless answer-quality evidence supports a stronger claim.

## Collection and Analysis Contract

For each pair, retain exact input identities, code and host identity, settings, catalogue, request sequence, usage, content categories, resumptions, outcomes and answer-adequacy results. Show absolute baseline and candidate values plus paired differences. Keep per-run rows visible and report successful, failed and nonconforming counts separately.

Choose missing-data handling and any uncertainty calculation before collecting the measured batch. A failure belongs in the inventory, not in a silent replacement. A diagnostic retry needs a new identity and must not replace the scheduled observation. Do not invent precision from one query or change the population after inspecting its results.

Deliver an offline analysis command and a compact result table that explains any net saving or increase. A positive conclusion requires a reduction in measured traffic or resumptions without an unacceptable loss of useful content or evidence access. No benefit is also a valid result. Do not require a predetermined percentage saving.

## Agent Work Sequence

1. Read this brief and the feasibility note. Inspect the current source and installed host documentation directly. Do not read the old study as an execution guide.
2. Write the exact arm definitions, source-capture design, response contract, measurement and attribution method, query/usefulness rubric, missing-data rule, model/host pins and bounded cost estimate. Identify decisions that affect interpretation. Obtain coordinator acceptance of this implementation plan before Step 3.
3. Build the bounded adapter, main-request observer and attribution analysis; prove their accounting with new synthetic inputs and traces. Show that both arms consume identical source bytes, preserve the baseline behaviour under the adapter, write real reports and expose the intended result boundary through the actual host. These checks are not measured results.
4. Obtain coordinator acceptance of the frozen protocol and costed collection schedule. Retain the previously prescribed model roles unless the owner changes them. Verify the approved `Pi` 1.5.0 pin and actual loaded dependencies rather than inheriting a moving installed version. Reconcile existing programme spend against the standing USD 30 ceiling; do not reset it or request approval for every routine call in an accepted batch.
5. Collect fresh common inputs, then the declared paired runs. Record deviations and stop on violated input controls. Do not broaden the study to manual/breadth/follow-up workflows as a prerequisite.
6. Produce fresh raw evidence, shareable data where permitted, offline analysis and a findings note. Obtain an independent check that the conclusions follow from the recorded main-thread traffic and answer adequacy.

## Deliverables and Boundaries

Tracked design and analysis documentation belongs under `docs/experiments/research-handoff/`. New raw inputs, requests, responses, run manifests and results belong under `evidence/benchmarks/research-handoff/<new-series-id>/`. Agent briefs and reports belong under `evidence/agents/<new-run-id>/`. These durable directories are never deleted by agents. Scratch belongs only in task-owned `.tmp/`, never `/tmp`, and no report may cite scratch paths.

Do not copy credentials or refresh-token chains into a profile, alter global host settings, overwrite old evidence, modify another worktree, or run release/publish steps. The incoming lead agent may create the single implementation branch and worktree described in Handover. A delegated builder or data-collection agent does not spawn agents or create worktrees. Commit or push only when the coordinator authorises it. The coordinator owns the validation lane; no concurrent full-suite runs.

The existing `research-handoff` planning worktree has no provisioned dependencies or copied ignored data. Provision the new `research-handoff-runner` implementation worktree from its branch's lockfile before implementation. Do not copy `.env`, `.e2e-auth/`, `.search/`, old evidence or mutable state from another checkout. Production code changes require build, deterministic tests, relevant types and applicable generator checks. The general package live-suite/audit checklist is not authority to launch paid calls or a security workstream for this experiment.

The agent's report must identify what was observed, inferred, proposed and left untested; name the exact dataset and reproduction command; and state whether one-handoff behaviour, lower traffic and adequate answers were established. Write the report before sending the final chat summary. The final line is `STATUS: COMPLETE` only when the assigned deliverables are present; that marker does not mean the hypothesis passed.
