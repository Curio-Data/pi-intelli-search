# Codemode Study v1 Protocol

Revision: `study-v1-r6-postpilot`. Status: pilot observations are retained; independent measured-series execution remains subject to the post-pilot freeze. Authority: [Owner Decisions](../../plans/codemode/OWNER-REFOCUS.md) (2 November 2026), [Research Plan](../../plans/codemode/RESEARCH-PLAN.md), [Resume](../../plans/codemode/RESUME.md). This protocol supersession note: the frozen historical method ([`docs/benchmarks/codemode/METHOD.md`](../codemode/METHOD.md) revision `P0-2`) remains intact as a reference; this document defines the new versioned study required by the owner refocus. Arm names follow the plan: `off`, `on`, `only`, mapping to the old method's A2, B and C. Old A0/A remain historical engine baselines, not arms of this study.

## Purpose

Establish when Codemode benefits users of `intelli-search`, with evidence suitable for publication where the findings support that use. The primary comparison is Codemode `off` against Codemode `on` on one pinned build and host. `only` is a secondary arm. No benefit is established before measurement; neutral, negative and inconclusive outcomes are retained and reported.

## Build, Host and Model Freeze

| Item | Value |
|---|---|
| Host | Installed `Pi` 1.4.0 (owner-selected); actual loaded host, executable and dependency paths and lockfile hashes are recorded per run, because development peers in this checkout are older and do not prove the runtime |
| Build | One experimental build for every arm; runs record source commit and refuse a dirty tracked tree |
| Main Model (Both Arms) | `openai-codex/gpt-6.1-sol`, subscription |
| Search | `openrouter/perplexity/sonar` |
| Extract, Collate and Suggest | `openrouter/minimax/minimax-m3` |
| Judges | Subscription `claude-opus-5-5[1m]` through Claude Code; `openai-codex/gpt-6.1-sol` in a separate fresh session |

Model substitution, silent or otherwise, is prohibited; actual model identities including routed providers are recorded per run. One judge shares the main model's identity; results are analysed separately and the shared-model limitation is disclosed.

## Arms and the Frozen Catalogue

The experimental build registers a branch-only experimental `intelli_fetch` operation over the same core fetch operation used by research: directly callable in `off`, callable inside scripts in `on` and `only`. Operation semantics, result data and limits are identical across arms; only the exposure surface differs. This registration is experimental and does not change the package's production registration.

| Arm | Codemode | Catalogue | Old Name |
|---|---|---|---|
| `off` | Disabled | `intelli_search`, `intelli_extract`, `intelli_collate`, `intelli_research`, direct `intelli_fetch`, built-in read | A2 |
| `on` | Enabled | `intelli_search`, `intelli_extract`, `intelli_collate`, `intelli_research`, script-callable `intelli_fetch`, built-in read | B |
| `only` | Enabled, script-only workflow | Script-callable operations, built-in read | C |

Rules:

1. One catalogue per arm is frozen for every workflow in both populations. The arms are capability-equivalent: the same operations are available in every arm, differing only in the fetch exposure surface (direct in `off`, script-callable in `on`/`only`) and in what a script may orchestrate. Declaration counts are not asserted identical; the actual declaration and guidance bytes reaching the main model are counted in the input of the arm that carries them, including in the single-call control.
2. Page budgets, pipeline settings, model settings, final-answer budget and starting cache state are matched across arms per task (see [Corpus](corpus.json) `pageBudgets`). Breadth has three angles with four pages each, twelve total. Pass that total as `budget.maxPages` to `breadthResearchScript`; the prescribed direct workflow uses the same three calls and per-call `maxUrls`. The live runner must enforce the same total allowance without prescribing tool choice.
3. Arm switching is configuration on the same build (`openSession({ codemode })` host-selection seam), never a different build.
4. Any catalogue or capability change after series freeze invalidates the frozen series and requires a new protocol revision.

The [runner profile](RUNNER.md#matched-settings-and-limits) fixes both arms to the same captured settings, including bounded page content, a single pipeline attempt, disabled documentation-file discovery and the same final-answer instruction. Codemode's classifier/image-model namespace is disabled to avoid giving the script arm additional inference capabilities. These are declared experimental settings, not untouched package defaults. Paid-call limits and the shared spend ledger are enforced by the integrated driver. This revision increases the matched collation allowance after the first development capture exhausted it in reasoning and produced no synthesis. The original failure and charge remain retained; model identities, reasoning and source budgets are unchanged. Script-output allowances are raised with it and scaled for breadth so a low script cap does not force truncation of the larger collation outputs. Any actual spill-file reads remain in the main-request evidence. This is a pre-pilot profile correction, not a replacement of a measured-series result.

## Workflows

Every task belongs to one of four workflow types, present in every partition except where noted:

| Workflow | Composition | Measures |
|---|---|---|
| `single` | One self-contained research call | Control: overhead of Codemode plumbing with one call |
| `breadth` | Three constituent research queries on one task, prescribed parallel schedule for replay | Multi-call orchestration and context accumulation |
| `manual` | Prescribed manual steps: two searches, four pages fetched and extracted, one collation; no single research call | Direct-tool versus script-tool composition at equal budgets |
| `followup` | One base research; a read of the saved base-research report through the built-in read operation; then the follow-up answer | Incremental work after prior results exist |

The follow-up is answered from the read saved report, not from the cache-suggest stage: cache suggest supplements the live search result and never replaces live work. In controlled replay the follow-up adds zero additional pages; the base research's recorded responses and the saved report are the whole evidence. In the live population the follow-up sequence is the task intent, tool choice is unforced, and any additional fetching is an observation. The follow-up script helper is implemented (`followupBaseScript` and `followupReadScript` in `scripts/benchmarks/study-workflows.ts`), and a scripted actual-host committed-report read check passed in both primary arms; the integrated driver now exercises both turns and their replay in scripted host tests. Live-main follow-up behaviour still requires observation. That scripted check is not a measured follow-up result.

Manual tasks in `off` call `intelli_fetch` and the manual operations directly; in `on` the same steps run inside a script. The workflow prompts express task intent without dictating tool names in the live population; the forced replay population prescribes arguments.

## Populations

Two separately reported populations; never pooled, and replay timings are never quoted as live speed.

### Controlled Replay

Prescribed workflows receive recorded pipeline model, page, catalogue and suggestion responses through the real registered wrappers and the real Codemode bridge, using the existing replay libraries (`transport-replay`, `suggestion-replay`). Only main-model inference remains live. A missing fixture stops that block; there is no live fallback. This measures context and orchestration effects under matched evidence.

### Live Tasks

Prompts express the task without naming tools. Tool choice and routing are observations, not requirements. Discovered skills, extensions, templates and context files are disabled in both arms; automatic skill discovery is not evaluated. An `on` session that chooses direct tools stays in the `on` population. Paired runs are interleaved with recorded order; service variability, failures and cancellations are retained. This population establishes practical behaviour separately from replay.

## Measurements

Record actual requests sent to the main model, not transcript bulk. Count each underlying attempt once; parent/nested summaries and cumulative stream updates are not additional usage. Main-model usage and pipeline usage stay separate.

### Primary Token Endpoint

The primary endpoint is **uncached main-model input tokens per task**, `inputUncached`, computed exactly as the existing collector computes it: `max(0, input_tokens - cached_tokens - cache_write_tokens)`, with all three wire fields required for the value to exist. This is an observed capability on the pinned host, established by one no-tool request: the 2 November 2026 metadata check recorded `input_tokens=2817`, `cached_tokens=0` and `cache_write_tokens=0` explicitly on the wire with response-ID correlation and zero absent usage fields (local-only [assessment](../../../evidence/benchmarks/metadata-20261102T152129Z/metadata-20261102T153207Z-e9116d51/assessment.json), Observed, n=1 response; run manifest SHA-256 `038de199a117fe2b77d74a449456a6496ed1cd72561e321393f40b2a75fddd94`). The ignored raw evidence is available in this retained worktree, not in a clean clone or a public bundle. That request supports retaining the unchanged endpoint for the pilot. Nonzero-cache and multi-turn coverage remain unobserved, and every contributing response must meet the field and correlation checks below. No additional owner decision is required merely to retain the unchanged endpoint.

Endpoint rules, frozen before any comparison data:

1. Every measured response must carry all three per-message wire fields (`input_tokens`, `cached_tokens`, `cache_write_tokens`), response-ID correlated; only then does `inputUncached` exist for that response. A response missing any field is recorded with its missingness; the task's endpoint value is `unknown`, not zero. Raw observed field values are always retained alongside the derived value.
2. `inputUncached = max(0, input_tokens - cached_tokens - cache_write_tokens)` is the endpoint derivation, mirroring the collector's `tokensFromWireEvidence` computation exactly and documented separately from the raw observations it is computed from.
3. Total main-model input tokens remain the planned secondary endpoint, reported wherever observed. Independent total-input completeness and paired analysis are implemented in `scripts/benchmarks/study-analysis.ts` (an independent `mainInputTotalComplete` rule and a `mainInputTotal` paired endpoint), covered by synthetic tests and connected to the series exporter; live-main verification remains to be recorded. Total-input completeness follows its own observation rule rather than being withheld because uncached-input evidence is incomplete.
4. The historical 50% saving hypothesis (H1) is retained as the stated hypothesis on the primary endpoint, not a completion condition.

### Transport Pin

Both arms run with server-sent events (SSE) transport for main-model requests. The host raw-request observer does not expose WebSocket delta requests, so a WebSocket session's usage fields cannot be verified against the wire; WebSocket-transport sessions are therefore out of population and this limitation is disclosed in the report. The pin is recorded per run alongside the host and dependency identities.

### Other Measures

| Measure | Required Record |
|---|---|
| Main-Model Usage | Per-request and per-task input, uncached input, output, cache components, reasoning; missing-field indicators |
| Context Exposure | Raw page material reaching actual main requests, including arguments, results, script output, errors and spill-file reads; justified quotations identified separately |
| Answer Quality | Fixed task rubrics checked against captured sources; blinded scores from both judges; a disjoint human-checked calibration sample; disagreements retained |
| Time and Reliability | Task start/end, summary-ready and settled times where available; successful, degraded, failed, cancelled outcomes; script errors, retries, turns |
| Pipeline Work | Queries and arguments, attempted/fetched/extracted/used pages, source identities, deadlines, late work, all model attempts |
| Spend | Provider-reported charges, estimates and price/date basis, pending holds and unknown charges; subscription usage separately |

### Run Metadata

Each run records: run/task/repeat/arm identifiers; population and partition; source commit and dirty-state refusal; host, executable, loaded dependency paths/versions and lockfile hashes; model/provider identities; effective settings and tool catalogue; prompt/script/guidance/rubric hashes; order and seed; initial cache and fixture identity; response/operation/attempt correlation; timestamps and outcomes; usage completeness; costs; and paths and hashes of every retained artefact. Raw reported values are preserved alongside normalised values. Failed, invalid and cancelled runs stay in the dataset; a technical rerun gets a new identity and reason.

## Sampling and Order

| Partition | Purpose | Rows |
|---|---|---|
| Development | Fixture capture, harness tuning, prompt freeze | 4 (one per workflow) |
| Pilot | Cost and variability estimation; calibration disagreement inspection | 8 (two per workflow) |
| Measured series | Frozen primary population | 12 (three per workflow) |
| Reserve | Later owner-approved revision only | 8 (two per workflow) |

Repeats: two per task per arm in both populations, to expose within-task main-model variability. Order: interleaved paired runs with a recorded seed; replay blocks additionally record their frozen schedule. The pilot precedes the series freeze; the freeze (a new manifest revision, `measured-series-1`) fixes final sample size, stopping rule, margins, uncertainty calculation and intended claims, retaining the missing-data rule below.

The missing-data rule is prespecified before pilot capture: retain every original attempt, and never substitute a technical rerun into its paired cell. A missing, failed or invalid cell makes that endpoint's primary interval unavailable for the population. Complete-case estimates remain labelled diagnostics; reliability counts retain all outcomes. Extra repeats do not override this complete-population rule. The final freeze carries this rule forward; any alternative requires a declared revision before collecting the affected independent series, not a post-result choice. This policy can yield an inconclusive primary result without making the retained failed trials disappear.

Codemode-only mode (`only`) is a secondary arm of the study design, not a scheduled comparison: no `only` execution is budgeted in this costed primary series. Scheduling it later requires a schedule revision admitting its cost under the canonical admission rule. The measured-series rows above are the declared population, not a tuned sample: no row is added, removed or swapped after the freeze, and the corpus's exposure families are never relabelled unseen.

## Judging and Calibration

1. Both judges score every measured-series final answer against the task rubric with identical blinded evidence and balanced answer order, in fresh sessions. Neither judge sees the other's output. [Blinded Quality Judging](JUDGING.md) owns the 0–4 scoring scale, packet preparation and score-file contract.
2. The owner supplied A verdicts for all four cases in [calibration.json](calibration.json), and criticised their triviality and uniformly positioned winners. The explicit decisions and input hashes are retained in `evidence/benchmarks/codemode-study-v1/calibration/decisions.json`. These are sanity-check labels, not evidence of judge reliability. No repeat review of these cases is requested. Source-backed blinded scoring and retained disagreements remain required before any quality claim.
3. Disagreements between judges and between either judge and the human-checked labels are retained and inspected, not adjudicated by preference.
4. Judge prompts are frozen before final-series scoring.

## Budget and Stopping Rules

The programme ceiling is USD 30, with the reconciled baseline in [SPEND-BASELINE.json](SPEND-BASELINE.json): USD 0.545984786 known engineering expense, USD 1.5 pending holds, USD 27.954015214 remaining under the conservative bound. Work is admitted under the single canonical admission rule defined in [SCHEDULE.md](SCHEDULE.md); that section owns the arithmetic, and this protocol adds no second test. Stopping rules are binding:

1. Work that fails the schedule's admission rule stops before starting, not after.
2. A batch stops mid-way if observed cost exceeds three times its forecast at the halfway check; the overrun, partial data and stop point are reported, never trimmed.
3. A replay block stops on any fixture miss or validity failure; the block is retained as invalid, never retried against live services.
4. A live run that fails, degrades or is cancelled is retained with its outcome; a technical rerun is a new identity.
5. Series completion does not require a favourable result; precision shortfalls are reported as such.

## Data Management

Durable raw study data is written directly under `evidence/benchmarks/codemode-study-v1/` (gitignored); nothing needed for a result stays only in `.tmp/`. The publication bundle carries task inputs and rubrics, prompts/scripts/settings, per-run metrics and completeness, final answers and judge outputs where shareable, provenance manifests, analysis source, environment pins and exact regeneration commands. A fresh environment regenerates every published table and figure from the bundle without model calls. Omissions and redactions are documented with their reproducibility effect. No credentials or private session data enter any shareable artefact.

## Validity Threats and Disclosures

| Threat | Treatment |
|---|---|
| Shared main/judge model | Separate sessions, both judges analysed separately, limitation disclosed in every claim |
| Replay is not live latency | Populations never pooled; no replay timing becomes a speed claim |
| Single host and build | Scope of every claim is this build and host; no cross-host generality claimed |
| Small per-workflow samples | Uncertainty reported per workflow; a null result stays null |
| Exposed corpus material | Retained items carry exposure labels; fresh items were composed without web search |
| Live web variability | Live population records fetched-source identities; analysis does not treat two live arms' differing sources as noise |
| Declaration bytes differ by arm | Catalogue bytes counted in main-model input of the arm that carries them; declared here, not hidden |

## Pending Prerequisites

The development and pilot observations are retained. The following prerequisites remain for quality claims and measured-series execution:

| Prerequisite | Required Before | State | Owner |
|---|---|---|---|
| Independent driver review and bounded development verification | Remaining development and pilot work | Complete; all four development workflows have captures and replay attempts, with the invalid manual cell retained | Coordinator |
| Independent source-backed quality scoring | Quality claims | Human sanity-check labels are recorded; blinded pilot scoring and disagreement analysis remain before quality claims | Coordinator and prescribed judges |
| Post-pilot series freeze (manifest `measured-series-1`: margins, final size, stopping rule) | Measured-series capture only | Pending; the pilot itself is paid work that precedes the freeze | Coordinator |

## Change Control

Any change to arms, catalogue, endpoints, population, order, budget handling or judging after the series freeze requires a new protocol revision, a matching manifest revision and, where the change affects the validity of a claimed result, owner notification before the affected comparison is collected.
