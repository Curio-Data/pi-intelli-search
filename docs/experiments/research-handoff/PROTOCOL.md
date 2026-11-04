# Fixed-Source Handoff Protocol

Revision: `rh-v2`. The incoming lead accepted the initial implementation contract on 4 November 2026 after the owner's instruction to execute the [Execution Plan](EXECUTION-PLAN.md). This pre-collection revision incorporates the independent component review; no measured data or live source capture preceded it. Live collection remains blocked on deterministic qualification, independent technical review, actual-provider observation and final financial acceptance. The source-capture and measured-batch identities will be recorded separately without changing this protocol retrospectively.

## Question and Arms

Compare one native `intelli_research` call with one Codemode script awaiting that same operation and returning its complete text once. The candidate uses Codemode `only`; the baseline does not activate Codemode. No script is supplied in the main prompt. Verify the native return against the core's result hash and verify that the candidate exposes that complete text exactly once under the pinned host's documented success envelope. A single returned/`text()` item or a single console-output wrapper is accepted. Projection, truncation, duplication or extra script-authored output is nonconforming even when the tool topology is correct. Both arms expose the same workspace-contained read capability, with no shell or independent network tool. Reads and extra calls are recorded as nonconformance, not silently excluded. The measured prompt deliberately permits an evidence read when the summary is insufficient: recovery remains observable, but using it means the primary one-handoff boundary was not met and blocks a positive conformance claim.

Preserve the baseline tool's declaration, guidance, schema, progress, return text, necessary diagnostics and cache references. Import the released core from this checkout. Use benchmark-only registration rather than editing production source or mutating global test hooks during execution. A native-wrapper parity test may use the original test hooks in isolation and restore them afterwards.

## Task

Exact query:

> For a PostgreSQL 17 job table with several concurrent workers, explain how FOR UPDATE SKIP LOCKED differs from transaction-level advisory locks, where LISTEN/NOTIFY helps, and what is still needed to avoid lost jobs or duplicate external side effects.

Exact focus:

> Explain transaction boundaries, lock lifetime, worker coordination, crash recovery, notification limitations and evidence-backed safeguards for external side effects. Restrict claims to PostgreSQL 17 or explain source-version applicability.

Exact parameters: the query and focus above, `domains: ["postgresql.org"]`, `maxUrls: 3`. The main prompt includes these parameter values, requests one research call by the assigned route, and asks for at most 600 words, source citations and the saved report reference. It contains no executable script. The runner records the complete rendered prompt and declaration catalogue before each conversation. Its stable template is part of the implementation hash and must be frozen before live qualification.

Corpus acceptance requires at least two readable selected pages, evidence supporting the declared assessment topics and documented applicability to PostgreSQL 17. The selected URLs and order come from the baseline citation merge and cap, not hand selection. Failed pages remain in position. No replacement source or live fallback is allowed during replay.

## Host and Models

Use the retained host at `/home/miah0x41/.pi/agent/install/releases/1.5.0/node_modules/@earendil-works/pi-coding-agent`, verifying loaded module paths and versions. Repository development peers remain separate; their installation does not prove the executing host's identity. The benchmark imports the unchanged native wrapper's `CONFIG_DIR_NAME` and rendering class from the checkout's development peers. Record those adapter dependencies separately, including their installed manifests in the implementation identity; do not describe them as loaded host peers.

| Role | Identity |
|---|---|
| Main | `openai-codex/gpt-6.1-sol` |
| Common Search | `openrouter/perplexity/sonar` |
| Extraction and Collation | `openrouter/minimax/minimax-m3` |

Both main arms use reasoning `low`, server-sent events (`sse`) transport, provider `maxRetries: 2`, no session-level retry, no automatic compaction or cache warming, and at most four logical main requests. The selected transport is a study control, not a comparison of default transport performance. The retained provider's request builder does not emit `maxTokens`; leave its output limit unchanged rather than claiming an unsupported custom cap. The final-answer length instruction is identical in both arms. Record the catalogue's output limit and any actual truncation.

Use `cacheRetention: "none"` symmetrically to omit a session prompt-cache key where supported, but do not claim this disables provider caching. Record reported cache components. A new process, empty workspace, isolated resource loader and session are required per observation. The main-request wrapper and the transmitted-request observer must enforce the stated bounds before dispatch. No credentials or refresh-token chains are copied into a test profile; synthetic tests have no credentials, and live credentials are injected in memory through an approved non-refreshing mechanism.

Research settings are the complete result of `tuningDefaults()` with the prescribed model bindings, `defaultUrls: 3`, `maxUrls: 3`, `disableLlmsFullDiscovery: true`, and `cacheDir: ".search"`. Preserve all other baseline tuning, including extraction limits, retry delays, timeout and concurrency. Freeze and compare the entire resolved settings object, not a subset that omits retry or throttling fields. Fresh-cache suggestion inference must be absent; any such call is rejected and recorded.

## Common Inputs and Identity

Capture search outside the measured main conversations. Preserve its complete request, raw completion text, citation annotations, reported usage and all attempt records. Recompute baseline citation selection and freeze the capped ordered list. Fetch those pages once through the baseline fetch implementation; preserve the selected text, titles, URLs, variant metadata and failures.

Canonical identity uses recursively key-sorted JSON, with normal JSON omission of undefined object fields and array order preserved. SHA-256 binds the complete capture, each selected page and each expected extraction request. Extraction identity includes both the system prompt and the complete user message after baseline truncation. Repeated identical page messages are a multiset, not a set: every expected occurrence must be consumed exactly once.

At replay, bind the registration to the coordinator's expected corpus digest and journal the digest actually loaded. Assert the expected query, focus, domains, source cap, full settings, search request, ordered fetch URLs and page digests. Verify each extraction request against the expected remaining multiset before delegating to a live client; recording hashes after dispatch alone is insufficient. Reject unknown model stages, unexpected suggestion calls and changed input. Latch an input-control failure so later model requests are refused; if the baseline catches a page error, the registration still raises the latched failure rather than returning success. Keep input equality separate from execution completeness and pipeline outcome. A provider failure is not a source mismatch, and missing execution does not prove changed inputs. Return copies of frozen data. Preserve captured search usage as setup provenance with an explicit replay marker; never charge or count it as a new provider attempt.

## Measurement

Each run retains logical main requests, actual transmitted attempts, provider events needed to recover usage, completed assistant messages, top-level and nested tool events, final conversation state, downstream requests/completions, reports and outcome. Observe the outgoing server-sent-event request body at the supplied fetch boundary, decoding compression when necessary. Compare it with the request hook. Persist no authentication headers. A request hook alone is not proof of on-wire attempt coverage.

Count attempts once. Count a post-tool resumption only when another logical main request occurs; classify the final answer-producing resumption separately. Retries, progress and nested tool events are not automatically additional resumptions. Keep provider-reported main totals separate from downstream pipeline and common preparation usage. Preserve raw fields and their source; missing usage is unknown, not zero. Cached input included in total input is not added twice. Reasoning already included in output is not added again.

Component estimates use `js-tiktoken@1.0.21` with `o200k_base`, verified locally by a round-trip check. Recognise the actual host `toolCall`/`toolResult` shapes and provider Responses call/output shapes. Project model-visible content before logical-context estimates: exclude timestamps, SDK usage/accounting fields, tool `details` and `nestedCalls` that the provider does not send. Do not tokenise opaque reasoning ciphertext as plaintext; retain its byte count separately and leave its semantic contribution in the unknown/residual accounting. This is a reproducible proxy, not a claim about the model's tokenizer. Estimate recorded textual components with a documented deterministic serialisation, including common instructions/query, arm-specific declarations/guidance, generated arguments/scripts, intermediate material, useful results/evidence, necessary status, errors/recovery and unallocated material. When a result cannot be split reliably into summary and status, classify the complete return conservatively as useful result including necessary status; do not label unexplained text as overhead. Report component sums, whole-request estimates and a signed residual against provider totals without forcing equality.

Report cumulative input and output separately and as a labelled sum; terminal retained context and peak logical request size are separate quantities. Report downstream request/usage totals, extraction and collation text sizes, failures, truncation signals, reported charges and unknown holds separately from main traffic, so live downstream variation remains visible. Generated scripts count as generation and, when subsequently processed, input. Retain repeated history processing. Record any difference between logical context and transmitted body rather than substituting one for the other.

## Schedule and Analysis

There are two non-measured main-provider diagnostic conversations with synthetic downstream research: baseline, then candidate. They establish observer coverage, not task adequacy. Their prompt explicitly identifies synthetic qualification, asks for one handoff and a brief acknowledgement with the saved report reference, and forbids additional evidence reads; it does not request a factual answer from invented sources. Any needed rerun is a new identity requiring a revised bounded diagnostic acceptance. A transport or validity-affecting code change requires renewed symmetric qualification and review before measured acceptance.

After common preparation, execute ten pairs sequentially, with a minimum 30-second gap between conversations. The parent sleeps for 30 seconds after the preceding worker closes; process startup and scheduling add overhead. Validate the minimum against retained start/end timestamps rather than requiring exact millisecond equality. This is not a latency benchmark. Odd pairs run baseline then candidate; even pairs run candidate then baseline. No replacement runs. A stopped batch retains not-run rows. Each conversation can invoke chargeable research at most once; the registration enforces this synchronously before any await. Additional invocations are rejected and retained as nonconformance.

The adequacy rubric is the six-item rubric in the Execution Plan, which is included in the implementation identity hash. The coordinator grades de-identified answers against frozen sources and an independent reviewer checks every grade. Each final assessment must identify that reviewer, a durable review record, source-cited rationale and agreement with the final grade. Preserve disagreements and source-cited adjudication; unresolved disagreement blocks a positive conclusion. No paid judge is required.

Publish all scheduled rows, success/failure/nonconformance counts, absolute metrics and candidate-minus-baseline differences. Corrupt or missing records remain rows with explicit analysis errors and unknown metrics, not a reason to discard the complete inventory. Real input mismatches invalidate paired aggregation; ordinary pipeline failures do not masquerade as input mismatches. A logical request without observed attempts makes cumulative usage incomplete. Use mean, median and range only; no significance tests or confidence intervals. Each available-pair metric names its denominator. A conforming-and-adequate subset is a separately labelled view, never the whole population.

The frozen primary metric is cumulative main input plus output tokens (`cumulativeTotalTokens`). Other metrics are descriptive; a shorter final answer or smaller useful return alone cannot satisfy the positive-claim gate. A positive preserved-usefulness comparison requires all twenty planned runs to complete, conform, satisfy all independently checked adequacy criteria and retain readable references, with the primary metric and its input/cache decomposition known in every pair. The entire batch must share one code, protocol, corpus, settings, host and main-model identity and follow the recorded order and gap. No budget-limited run, overrun or unresolved active reservation may qualify. Its candidate mean must be strictly lower. Disclose regressions in other metrics. Otherwise report descriptive differences and limitations without an overall benefit claim. Results concern this query only.

## Preliminary Financial Bound

The [rate capture](../../../evidence/agents/20261104T112537Z-research-handoff-implementation/reports/public-rates.json) records the unauthenticated model catalogue retrieved on 4 November 2026. The [revised financial check](../../../evidence/agents/20261104T112537Z-research-handoff-implementation/reports/preliminary-budget-v2.json) verifies the existing ledger without reading old execution code. It records USD 26.418949454 remaining after known charges, holds and active reservations. This is not independent verification of external billing completeness; the historical unknown hold remains intact.

The revised preliminary admission envelope is USD 25.81: USD 0.81 for common search preparation, USD 1.00 for one downstream cost-reporting qualification and USD 1.20 for each of twenty measured runs. The subscription-main diagnostics have no admitted metered-provider work. No contingency or capture replacement is pre-authorised. These are maximum admitted exposures, not predicted spend or a guarantee every retry path can finish.

| Operation | Conservative Attempt Reservation |
|---|---:|
| Sonar | USD 0.134072 |
| M3 Extraction | USD 0.3241728 |
| M3 Collation | USD 0.3193728 |

Reservations use the full catalogue context allowance as an input upper bound, plus the configured output cap and catalogue search fee where applicable: Sonar input 127,072 at USD 0.000001/token, output cap 2,000 at the same rate and USD 0.005 search fee; M3 input 1,048,576 at USD 0.0000003/token, extraction output cap 8,000 or collation cap 4,000 at USD 0.0000012/token. This deliberately over-reserves input rather than pretending the proxy tokenizer is exact. Six search attempts fit within USD 0.81. Three concurrent extraction attempts fit within the per-run envelope.

After capture, require a successful Sonar attempt to expose a numeric provider-reported charge before proceeding. Qualify M3's reporting separately with one extraction of a frozen source, preserving the normal extraction prompt, limits and up to three attempts within the USD 1.00 qualification envelope. Retain this qualification outside the measured dataset. If a successful completion lacks the reporting channel, stop before the twenty runs; do not discover the missing channel repeatedly at paid collation.

Before every actual downstream attempt, atomically reserve its bound against the run's remaining exposure. Settle provider-reported charges when available; retain an unknown-charge hold when reporting is absent. Do not treat a catalogue-derived cost estimate as a reported charge. The next retry or stage may proceed only if its reservation also fits. This can stop an observation before the baseline's retry allowance is exhausted. Latch budget refusal or overrun, refuse later model work, classify the observation as a budget-limited failure and stop the batch. Retain it in the inventory and exclude it from positive eligibility; do not interpret it as an algorithmic or orchestration benefit. Outstanding attempts remain reserved until settlement. Unexpected provider charges above the bound stop the batch and remain liabilities.

The preliminary estimate satisfies implementation entry only. Before live qualification, independently check the implemented admission logic, prompt/output limits, model rates, fee interpretation and ledger continuity. Before collection, reconcile external commitments and acquire one authoritative programme reservation. Appending reservation and settlement records to the inherited cross-worktree ledger requires an owner permission record; reading that ledger for continuity does not itself permit modification. A copied ledger or a branch-local balance must not create a fresh allowance. No paid call may run while that authority or its coordination with another writer is unresolved.

## Acceptance and Stop Conditions

M1 permits bounded implementation against this protocol. M3 requires native parity, actual-host synthetic execution, input equality, complete attempt accounting, containment, failure retention, deterministic tests, types and independent technical review. These checks do not establish live savings.

M4 permits only the separately accepted diagnostic and collection schedules after their gates pass. Freeze implementation and protocol hashes before diagnostics; bind the accepted input digest before measurement. Any validity-affecting revision invalidates prior collection acceptance. Stop on changed inputs, identities, missing attempt coverage, unresolved ledger state or insufficient allowance. No package release or merge is authorised.
