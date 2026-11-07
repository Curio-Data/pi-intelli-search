# Fresh-Agent Resume Checkpoint

Current state: the requested single `rh-v7` end-to-end test is complete and settled. The workflow ran without an operational incident; both paid routes passed machine and financial checks, and both answers failed quality. [Repeat Findings](REPEAT-FINDINGS.md) records the result. Start with [Pilot Resume](RESUME.md) for the current evidence and reproduction commands. The one-shot request is fulfilled; no measured batch or additional repeat has started.

Historical `rh-v4` status: completed on 5 November 2026. The full-population Codemode mean was 1,920.5 main tokens lower, but two route-nonconforming baseline runs account for the entire reduction. As a descriptive sensitivity reading, the Codemode mean across the other eight pairs was 330.1 tokens higher. Only pair 2 had both runs conforming and adequate, and Codemode used 1,090 more main tokens in that pair. Only 8 of 20 runs met the completion, conformance and adequacy conditions that the frozen gate requires of every run, so it rejects an overall savings-with-preserved-usefulness claim. This result concerns one question, one corpus, `Pi` 1.5.0 and `openai-codex/gpt-6.1-sol`.

## Resume Here

Start with [Pilot Resume](RESUME.md) for the current reading order, accepted identity and permitted offline continuation. Continue in the existing checkout and preserve the completed `rh-v4` evidence:

```text
/srv/secure/repos/CURIO/.worktrees/pi-intelli-search/research-handoff-runner
branch: study/research-handoff-runner
```

Do not recreate, reset or retire this worktree. Preserve its ignored evidence. The evidence directories survive here, not in a clean clone or a new worktree. Do not clean them or substitute older scientific material when something is absent.

The sections below retain the completed `rh-v4` record. They are historical context, not an alternative launch procedure.

## Comparison and Claim Gate

The baseline made one native `intelli_research` call. The candidate made one Codemode call whose script awaited the same operation and returned its complete text once. Both arms used the same frozen corpus and downstream research engine across ten sequential pairs. [Findings](FINDINGS.md#comparison-and-question) defines main tokens, downstream tokens, resumptions and route conformance.

The [protocol's positive-claim rule](PROTOCOL.md#schedule-and-analysis) requires all twenty runs to complete, conform, pass independent adequacy review and retain readable evidence, with the primary metric known in every pair. Eight runs were both conforming and adequate: two baseline and six candidate. Only pair 2 had both arms eligible. The other twelve runs failed at least one required proof. **The gate rejects the claim.**

## Measured Outcomes

The [measured inventory](../../../evidence/benchmarks/research-handoff/20261105T105332Z-rh-v4-measured/inventory.json) contains all twenty scheduled runs with no replacements:

| Outcome | Baseline | Candidate | Total |
|---|---:|---:|---:|
| Completed Status | 4 | 7 | 11 |
| Failed Status | 4 | 3 | 7 |
| Nonconforming Status | 2 | 0 | 2 |
| Conforming Route | 4 | 7 | 11 |
| Not Conforming Route | 6 | 3 | 9 |
| Adequate Answer | 3 | 6 | 9 |
| Inadequate Answer | 7 | 4 | 11 |
| Both Conforming and Adequate | 2 | 6 | 8 |

The nine route-nonconforming runs comprise seven failed runs and two further runs that finished the pipeline but broke the one-handoff route. Adequacy is graded separately from conformance: baseline pair 6 was adequate despite its route-nonconforming status.

Eleven runs recorded a truncated downstream completion: six baseline and five candidate. Seven produced zero collation output bytes: four baseline and three candidate. Among the nine runs without truncation, two of four baseline answers and five of five candidate answers were adequate. These are observed associations, not evidence of a route-caused quality difference. Adequate answers demonstrated honest scope-keeping against a corpus with gaps, not a complete deployment recipe.

Every completed, conforming run used exactly one post-tool resumption and one top-level handoff in both arms. Six baseline runs used recovery reads and no candidate runs did, accounting for the entire -0.8 mean resumption difference. Failed runs remain in the means. Their main-token values are low because the research call returned no useful text and the final answers were short, not because the conversations made fewer requests. On average, their downstream usage and cost are above the completed-run mean: extraction ran as normal, and each collation reached 4,000 output tokens before returning no visible text.

The [assessment bundle](../../../evidence/benchmarks/research-handoff/20261105T105332Z-rh-v4-measured/assessments.json) joins independently reviewed grades to immutable raw records. The [independent adequacy review](../../../evidence/agents/20261105T080302Z-research-handoff-cloudflare/reports/adequacy-review.md) agreed with every grade. Both reviewers satisfied the planning-answer isolation rule.

## Token Sensitivity

The [assessed analysis](../../../evidence/benchmarks/research-handoff/20261105T105332Z-rh-v4-analysis-assessed-r2/analysis.json) reports a candidate-minus-baseline mean difference of -1,920.5 cumulative total tokens across ten pairs. Baseline pairs 6 and 9 contributed -21,846 to the -19,205 total difference; the other eight pairs summed to +2,641, or +330.1 per pair as a descriptive sensitivity reading that establishes no direction. Six pairs were lower for the candidate and four were higher. The median difference was -205.

Only pair 2 had both runs conforming and adequate. Codemode used 1,090 more main tokens, 4,806 fewer downstream tokens and USD 0.00479936 less downstream reported cost in that pair. One pair supports no conclusion. Candidate means were higher for generated script tokens, downstream output tokens, downstream total tokens, downstream reported cost and collation output bytes. [Findings](FINDINGS.md#token-and-resumption-differences) carries absolute means, medians, ranges and the full sensitivity explanation.

The [assessed reproduction](../../../evidence/benchmarks/research-handoff/20261105T105332Z-rh-v4-analysis-assessed-reproduction/analysis.json) is byte-identical to the analysis in `20261105T105332Z-rh-v4-analysis-assessed-r2/`.

## Accepted Implementation and Live Gates

The measured batch ran from `f5bfc20` plus the receipted `rh-v4-r4` patch, later committed unchanged as `f26a329`. The [candidate receipt](../../../evidence/agents/20261105T080302Z-research-handoff-cloudflare/candidate-rh-v4-r4.json) predates acceptance and binds:

```text
codeSha256:     6c039cf8bee58c6835a81c9a0dee994c335706494badb27e2788123b0829f54f
protocolSha256: 42c0de0798bebd12cc6def14fbc071d2f46909f1be6301b69d03816b9f237992
```

[Technical acceptance](../../../evidence/agents/20261105T080302Z-research-handoff-cloudflare/reports/technical-acceptance.md) and [prose acceptance](../../../evidence/agents/20261105T080302Z-research-handoff-cloudflare/reports/prose-acceptance.md) cover this identity. The [validation log](../../../evidence/agents/20261105T080302Z-research-handoff-cloudflare/reports/rh-v4-validation-r4.log) records matching code and protocol digests before and after the complete lane: build, 663 native tests, 62 standalone tests, 138 study tests, both relevant type projects and all applicable generator checks. The [`20261105T100024Z-rh-v4-synthetic-r4/`](../../../evidence/benchmarks/research-handoff/20261105T100024Z-rh-v4-synthetic-r4/identity.json) series and its offline sibling exercise both actual-host routes with fixed inputs and unchanged returns.

The [observer result](../../../evidence/benchmarks/research-handoff/20261105T101248Z-rh-v4-observer-diagnostic/diagnostic-result.json) accepted two actual-main-model conversations. Each arm used two logical requests, two observed server-sent-event attempts, one assigned handoff and one answer-producing resumption. The [diagnostic review](../../../evidence/agents/20261105T080302Z-research-handoff-cloudflare/reports/diagnostic-review.md) verified on-wire coverage, usage, route conformance, readable evidence and unchanged native returns. These are observer facts, not measured savings.

The [owner financial receipt](../../../evidence/agents/20261104T192721Z-research-handoff-m4/owner-rh-v4-financial-approval.json) authorised one capture, one [_MiniMax M3_](https://minimax.io) qualification and twenty measured conversations under a new fixed USD 25.81 continuation envelope. The single capture selected six readable pages representing five distinct texts. The [fresh corpus review](../../../evidence/benchmarks/research-handoff/20261105T105332Z-rh-v4-measured/corpus-acceptance.json) accepted the evidence for all six assessment topics and recorded duplicate-source, domain, integration-absence, missing-setup and third-party-attribution caveats. The MiniMax M3 [qualification](../../../evidence/benchmarks/research-handoff/20261105T105332Z-rh-v4-measured/cost-qualification/outcome.json) then confirmed numeric provider-reported charges before collection.

## Financial Close-Out

The [settlement receipt](../../../evidence/benchmarks/research-handoff/20261105T105332Z-rh-v4-measured/settlement-receipt.json) records USD 0.643910399 in reported charges, USD 25.166089601 released, zero unknown-charge holds and zero overrun. The [settlement review](../../../evidence/benchmarks/research-handoff/20261105T105332Z-rh-v4-measured/settlement-review.json) records zero active reservations. The study used the fixed continuation envelope because the earlier programme ledger is unavailable; it did not create a replacement. The charges comprise the single [_Perplexity Sonar_](https://docs.perplexity.ai) capture, the MiniMax M3 qualification and MiniMax M3 extraction and collation in the twenty runs. Main-model usage was subscription-billed and has no reported charge here. The earlier rejected [_PostgreSQL_](https://www.postgresql.org) captures reported USD 0.01123 separately. The topic-validation charge is not established by its retained `meta.json` and is outside the experiment envelope.

## Isolation and Historical Records

The [topic-validation disclosure](../../../evidence/benchmarks/research-handoff/20261105T075350Z-topic-validation/planning-disclosure.json) preserves the answer-shaped planning call and prohibits its reuse as experimental input. The corpus reviewer, adequacy grader and checking reviewer did not read that answer, the coordinator's answer-shaped discussion or the disclosure's query field.

Both rejected PostgreSQL preparations remain under [`20261104T203243Z-rh-v3-measured/`](../../../evidence/benchmarks/research-handoff/20261104T203243Z-rh-v3-measured/) and [`20261104T204211Z-rh-v3-measured-r2/`](../../../evidence/benchmarks/research-handoff/20261104T204211Z-rh-v3-measured-r2/). Their implementation and observer passes apply only to `rh-v3`; they establish no comparison and were not reused.

## Historical Repeat Boundary

The following boundary belongs to the completed `rh-v4` series. The later `rh-v5`, `rh-v6` and `rh-v7` pilots are also closed. The completed one-shot request and current study position are recorded in [Pilot Resume](RESUME.md). The historical instructions below do not replace the current owner direction or permit reuse of a settled root.

Inspect or reproduce the completed analysis only. Do not resume collection, rerun a diagnostic, select a replacement source or infer an overall Codemode benefit from the full-population mean. Preserve all evidence under its existing identity. Any new question, recapture, package integration, publication, version bump, main merge or additional measured run requires a separate owner decision.

A repeat of the measured experiment is optional and is not assigned here. It requires a new explicit owner decision before any live gate, including diagnostics, and that decision must state the permitted capture, qualification and measured-conversation attempts. The previous receipt and released envelope provide no repeat authority. The runner checks receipt fields only and would not reject a spent receipt, so a passing check does not establish authority. Before `admit`, record the decision in a new owner financial receipt with the fields listed in [Reproduction](REPRODUCTION.md#live-gates), including scope `continue-without-programme-ledger-rh-v4` and `maximumExperimentEnvelopeNanoUsd: 25810000000` (USD 25.81). A different amount requires a revised implemented bound, renewed acceptance of the resulting identities and an owner financial receipt for that amount. Use new series identities and follow the gate order in that section; never overwrite or reuse an earlier observation identity.
