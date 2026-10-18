# Concurrent Research Measurement

Method revision: `P0-1`. These are prespecified planning methods, not results. The [contract](../plans/codemode/CONTRACT.md), [acceptance map](../plans/codemode/ACCEPTANCE.md) and [corpus manifest](corpus/manifest.json) define ownership, inputs and later gates. Existing benchmark evidence in [BENCHMARKS.md](../BENCHMARKS.md) remains append-only and is not replaced.

## Experiments

- [Deadline and Contention](deadline/METHOD.md): page scheduling, cutoff, late ownership and actual settlement.
- [Query Expansion](query-expansion/METHOD.md): fixed original/expanded queries with effective attempted-page controls.
- [Native Codemode](codemode/METHOD.md): direct/off/on/only controls through the actual native bridge.

Each experiment has disjoint development, pilot, held-out and confirmatory-reserve identifiers. Membership and input hashes are frozen before fixture capture. The reserve is not a powered study design or authorised run count. Reading/reviewing the specification exposes its questions; held-out means not used for policy tuning, judge calibration or prior outcome inspection, not secret from specification authors. Record all cross-experiment result exposure before any later confirmation claim.

## Common Recording

A run uses the `RunObservation` and fixture interfaces in the contract's [API declarations](../plans/codemode/API.ts). Record source/candidate/lockfile/host/model/settings/tool/prompt/method/corpus/fixture hashes, order/seed/repeat, request/event traces, source states, all attempts, usage completeness, errors, technical-rerun lineage, reports/final answers and both judge outputs. Hash each raw artefact and append observations; never overwrite a failed run or quietly relabel it a pass.

Main-model endpoints use assistant-message usage, not pipeline tool usage. Normalise uncached input explicitly; cached subsets and reasoning are not extra totals. Count canonical tool results once, not repeated turn results or parent/nested aggregation twice. Actual main request payloads establish exposure; unrelated transcript/partial-event bytes do not. Missing charges are unknown. Subscription tokens/quota and paid pipeline dollars are separate.

Complete replay freezes model/fetch/catalogue/suggestion outputs, usage and timing. Fixed-argument forced workflows and live unforced routing are different populations. Replay miss stops the affected block with no live fallback; it is a harness-validity failure, not an automatic task-quality judgement. All runs remain in the manifest, including unscorable or invalid ones.

## Judging and Analysis

The main is subscription `Pi` `openai-codex/gpt-6.1-sol`. Judges are subscription Opus 5.5 through Claude Code and Sol 6.1 in a separate fresh `Pi` session, coordinated through [_Herdr_](https://herdr.dev). Keep evidence/rubric identical, arm labels hidden and pairwise order balanced. Preserve both judgements and disagreements; judge count is not independent query count. The same-model judge requires calibration and sensitivity analysis, not an independence claim.

The four synthetic calibration seeds have proposed expectations, not an accepted human-labelled gold set. Before scoring held-out answers, independently human-check/extend disjoint calibration material, inspect raw disagreements/order/verbosity effects and freeze both judge prompts. No universal kappa or position-bias threshold is asserted. No paid judge fallback is permitted when subscriptions are blocked.

Use the query as the analysis unit. `estimatePairedQueries()` receives explicit expected query IDs and repeat numbers, rejects duplicate arm/query/repeat cells and lists any absent/invalid/unknown paired cell as missing. Average the evaluable paired repeats within each query. The difference point estimate is the equal-query mean of treatment minus control; the ratio is the exponentiated equal-query mean log ratio of those positive query means. Nonpositive means are listed separately as `undefinedRatioQueries` and make the ratio/its interval unavailable, not an invented saving; valid difference endpoints still retain those zero-valued pairs. Export every query/repeat observation so later-margin exploratory sensitivity is possible. `bootstrapPairedQueries()` resamples these query pairs together with the recorded seed, requested draws/confidence and metric, not individual judge calls or pages. It returns no interval with fewer than two evaluable query clusters; a degenerate small sample is not power evidence. Exclude unknown/zero-denominator values only from the specifically undefined numeric endpoint and retain missingness/task-failure reporting. A primary benefit claim is unavailable when its prespecified valid-pair population is incomplete; complete-case results are diagnostic, not silently substituted.

Pilot intervals describe uncertainty, not equivalence, non-inferiority or measured power. After the pilot, D6 must prespecify meaningful margins, independent fresh-series size/precision, confidence/multiplicity rules and the exact analysis revision before confirmation. H1 requires uncertainty supporting its saving threshold, H2 requires two-sided equivalence and H4 requires one-sided non-inferiority; an inconclusive result is not sameness or harm. Confirmation reserve can be expanded only in a new manifest revision before capture, without reclassifying exposed material.

## Budget and Execution

The owner accepted phased forecasting around US$30 for [_OpenRouter_](https://openrouter.ai) Sonar/M3 calls only. The exact first and subsequent tranche ceilings remain separate approvals. The initial canary uses `DL-D01` and `DL-D02`, two prescribed old-direct executions each, at most eight attempted pages per execution. Its source-preservation checkpoint and assumption-based cash forecast are not live evidence. Finish the contract/harness/observer gates before capture; then reconcile actual costs/completeness and obtain the next go/no-go decision. No automatic rollover or silent exclusion of retries, fixtures, synthesis or mandatory live validation from the paid ledger.

Use pre-configured encrypted worktrees and supported overrides; no extra isolation framework is required. Record effective tool catalogues/settings, use the same main model per comparison and do not copy operator credentials. Keep shared-key drivers sequential except intentional concurrency inside a measured arm. Do not run this programme alongside unrelated live drivers on the same key.

Raw runs stay in encrypted gitignored `evidence/benchmarks/<series-id>/` or the designated worktree `.tmp/`. Public results require approved sanitised artefacts/manifests. The new results files remain absent until observations exist; never create an empty results page that appears to claim completion.
