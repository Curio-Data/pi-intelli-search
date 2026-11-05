# Research Handoff Findings

Status: the `rh-v4` experiment completed on 5 November 2026. The full-population Codemode mean was 1,920.5 main tokens lower, but two route-nonconforming baseline runs account for the entire reduction. As a descriptive sensitivity reading, the Codemode mean across the other eight pairs was 330.1 tokens higher. Only one pair had both runs conforming and adequate, and Codemode used 1,090 more main tokens in that pair. Only 8 of 20 runs met the completion, conformance and adequacy conditions that the frozen gate requires of every run, so it rejects an overall savings-with-preserved-usefulness claim. This result concerns one question, one corpus, `Pi` 1.5.0 and `openai-codex/gpt-6.1-sol`.

## Comparison and Question

The baseline made one native `intelli_research` call. The candidate made one Codemode call whose script awaited the same operation and returned its complete text once. Both routes used the same frozen corpus, settings and downstream research engine. The query was:

> When running Pi Durable on Cloudflare, how do I enable outbound email with Cloudflare native services?

Ten sequential pairs alternated order, with at least 30 seconds between conversations. **Main tokens** are provider-reported input and output from the main agent. **Downstream tokens** are usage from the research pipeline's extraction and collation work; search was captured once and replayed. A **post-tool resumption** is another logical main-model request after a tool result. A **conforming run** used its assigned route with one handoff and no extra evidence calls.

## Claim Gate and Outcomes

The [protocol's positive-claim rule](PROTOCOL.md#schedule-and-analysis) requires all twenty runs to complete, conform, pass independent adequacy review and retain readable evidence, with the primary metric known in every pair. Eight runs met both the conformance and adequacy conditions: two baseline and six candidate. Only pair 2 had both arms eligible. The other twelve runs failed at least one required completion, input, pipeline, observer, usage, financial, conformance, adequacy or evidence condition. **The gate rejects the claim.**

All twenty scheduled conversations produced retained records. The collector did not stop early, and no replacements occurred. The [run inventory](../../../evidence/benchmarks/research-handoff/20261105T105332Z-rh-v4-measured/inventory.json) retains every outcome.

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

The nine route-nonconforming runs comprise seven failed runs and two further runs that finished the pipeline but broke the one-handoff route. Adequacy is graded separately from conformance: baseline pair 6 was adequate despite its route-nonconforming status and truncated synthesis. Only baseline pairs 2 and 10 were both conforming and adequate; candidate pairs 1, 2, 3, 5, 7 and 9 met both conditions.

## Collation and Answer Adequacy

Eleven runs recorded a truncated downstream completion: six baseline and five candidate. Seven produced zero collation output bytes: four baseline and three candidate. These failures arose in a downstream stage shared by both arms. In the failed records, `pipelineOutcome: not-started` means that no `research-result` event was recorded, although downstream attempts and usage were retained.

Among the nine runs with no truncated completion, two of four baseline answers and five of five candidate answers were adequate. This is an observed association, not evidence that either route caused better answers. Adequate answers demonstrated honest scope-keeping against a corpus with documented gaps; the grade does not certify a complete deployment recipe.

The eleven inadequate answers comprised the seven empty-collation failures and four others: unsupported prerequisite claims in baseline pairs 1 and 3, an unsupported absence claim in baseline pair 9, and insufficient content after a truncated synthesis in candidate pair 10. Three answers carried material unsupported claims. Baseline pair 9 omitted a send invocation present in the corpus.

Recovery behaviour differed. Six baseline runs used evidence reads: each of its four failed runs read once, and route-nonconforming pairs 6 and 9 each read four times. No candidate run used an evidence read. Candidate pair 10 disclosed the truncation and declined to answer without reading the saved evidence. Baseline pair 6 recovered enough evidence for an adequate answer but broke the one-handoff route.

The [independent adequacy review](../../../evidence/agents/20261105T080302Z-research-handoff-cloudflare/reports/adequacy-review.md) agreed with all twenty grades. The grader and checking reviewer were isolated from the earlier topic-validation answer, the coordinator's answer-shaped discussion and the disclosure's query field. The [assessment bundle](../../../evidence/benchmarks/research-handoff/20261105T105332Z-rh-v4-measured/assessments.json) binds each grade to its raw record and the durable review.

## Token and Resumption Differences

The [assessed analysis](../../../evidence/benchmarks/research-handoff/20261105T105332Z-rh-v4-analysis-assessed-r2/analysis.json) includes all ten pairs for each metric below. Failed runs remain in these means. Their main-token values are low because the research call returned no useful text and the final answers were short, not because the conversations made fewer requests. On average, their downstream usage and cost are above the completed-run mean: extraction ran as normal, and each collation reached 4,000 output tokens before returning no visible text. Differences are candidate minus baseline. Negative values mean lower candidate values, not an automatic benefit.

| Metric | Baseline Mean | Candidate Mean | Mean Difference | Median Difference | Difference Range |
|---|---:|---:|---:|---:|---:|
| Cumulative Input Tokens | 6,858.8 | 5,025.7 | -1,833.1 | 39 | -11,563 to 1,104 |
| Cumulative Output Tokens | 710.0 | 622.6 | -87.4 | -92 | -895 to 530 |
| Cumulative Total Tokens | 7,568.8 | 5,648.3 | -1,920.5 | -205 | -12,458 to 1,634 |
| Post-Tool Resumptions | 1.8 | 1.0 | -0.8 | -1 | -2 to 0 |
| Generated Script Tokens | 0 | 111.0 | 111.0 | 111 | 106 to 116 |
| Downstream Output Tokens | 20,771.6 | 21,342.1 | 570.5 | 1,586 | -7,200 to 9,285 |
| Downstream Total Tokens | 52,464.9 | 52,594.9 | 130.0 | 455.5 | -8,451 to 9,433 |
| Downstream Reported Cost, USD | 0.03105911 | 0.032239592 | 0.001180482 | 0.00198027 | -0.007298008 to 0.010846152 |
| Collation Output Text Bytes | 2,941.7 | 3,084.0 | 142.3 | -112 | -4,317 to 6,713 |

Baseline pairs 6 and 9 contributed -21,846 to the -19,205 total difference. The other eight pairs summed to +2,641, or +330.1 per pair. Six pairs were lower for the candidate and four were higher. The median difference of -205 against the mean of -1,920.5 shows the skew. The same two pairs also reverse the direction for cumulative input, uncached input, cumulative output, the proxy estimates for peak logical request, final retained context, useful tool return and final answer, and collation output bytes when they are removed as a descriptive sensitivity reading. The eight-pair reading establishes no direction. Pairs 6 and 9 remain in every frozen full-population metric, as the protocol requires.

Only pair 2 had both runs conforming and adequate. Codemode used 1,090 more main tokens, 4,806 fewer downstream tokens and USD 0.00479936 less downstream reported cost in that pair. One pair supports no conclusion and does not establish an overall direction.

Every completed, conforming run used exactly one post-tool resumption and one top-level handoff in both arms. The resumption difference arose only in failed and route-nonconforming baseline runs. Six baseline runs used recovery reads and no candidate runs did, accounting for the entire -0.8 difference. This does not establish that either route is more efficient.

Candidate means were higher for generated script tokens, downstream output tokens, downstream total tokens, downstream reported cost and collation output bytes. These are the analysis gate's named regressions; collation output bytes nevertheless had a negative median difference. No significance test or confidence interval is reported for this single-query study.

## Corpus Limits

The single authorised capture used normal [_Perplexity Sonar_](https://docs.perplexity.ai) discovery without pre-declared documents. It selected six readable pages representing five distinct texts. The [fresh corpus review](../../../evidence/benchmarks/research-handoff/20261105T105332Z-rh-v4-measured/corpus-acceptance.json) accepted sufficient evidence for all six assessment topics, including documented limitations and absences.

The reviewer recorded limits for grading: one duplicate document, two sources outside the requested domains, no direct documentation joining _Pi Durable_ to the email mechanism, missing setup and send-failure details, and a misleading citation title for a third-party repository whose claims had to remain repo-scoped. The separate [_MiniMax M3_](https://minimax.io) [qualification](../../../evidence/benchmarks/research-handoff/20261105T105332Z-rh-v4-measured/cost-qualification/outcome.json) confirmed a numeric provider-reported charge before measured collection.

## Financial Close-Out

The continuation envelope was USD 25.81. The [settlement receipt](../../../evidence/benchmarks/research-handoff/20261105T105332Z-rh-v4-measured/settlement-receipt.json) and [settlement review](../../../evidence/benchmarks/research-handoff/20261105T105332Z-rh-v4-measured/settlement-review.json) record:

| Financial Item | Result |
|---|---:|
| Reported Charges | USD 0.643910399 |
| Released Envelope | USD 25.166089601 |
| Unknown-Charge Holds | USD 0 |
| Active Reservations | USD 0 |
| Overrun | USD 0 |
| Replacement Programme Ledger | No |

The study used the fixed continuation envelope because the earlier programme ledger is unavailable; it did not create a replacement. Reported charges comprise the single capture, the MiniMax M3 qualification and MiniMax M3 extraction and collation in the twenty runs. Main-model usage was subscription-billed and has no reported charge here; it is not included in the total. Zero unknown holds therefore does not mean that all consumption was priced.

The earlier rejected [_PostgreSQL_](https://www.postgresql.org) captures reported USD 0.01123 separately. The topic-validation call was outside the experiment envelope, and its provider charge is not established by its retained `meta.json`; neither figure is included in this settlement.

## Implementation and Observer Evidence

The measured batch ran from `f5bfc20` plus the receipted `rh-v4-r4` patch, later committed unchanged as `f26a329`. The [candidate receipt](../../../evidence/agents/20261105T080302Z-research-handoff-cloudflare/candidate-rh-v4-r4.json) predates acceptance and records code identity `6c039cf8bee58c6835a81c9a0dee994c335706494badb27e2788123b0829f54f` and protocol identity `42c0de0798bebd12cc6def14fbc071d2f46909f1be6301b69d03816b9f237992`.

The [deterministic lane](../../../evidence/agents/20261105T080302Z-research-handoff-cloudflare/reports/rh-v4-validation-r4.log) passed 663 native tests, 62 standalone tests and 138 study tests, plus build, both relevant type projects and all applicable generator checks. Fresh actual-host synthetic runs exercised both routes with equal inputs and unchanged native returns. Independent technical and prose reviewers accepted the candidate.

The [observer result](../../../evidence/benchmarks/research-handoff/20261105T101248Z-rh-v4-observer-diagnostic/diagnostic-result.json) records two completed subscription-main conversations under `openai-codex/gpt-6.1-sol`. Each arm used two logical requests and two observed server-sent-event attempts, one assigned handoff and one answer-producing resumption. The [independent diagnostic review](../../../evidence/agents/20261105T080302Z-research-handoff-cloudflare/reports/diagnostic-review.md) verified equal frozen inputs, complete usage, route conformance, readable reports and unchanged native return bytes under the pinned host's output wrapper. These are observer facts, not measured savings.

## Reproduction

The final analysis was reproduced offline into `20261105T105332Z-rh-v4-analysis-assessed-reproduction/`. Its `analysis.json`, `inputs.json` and `summary.md` are byte-identical to those in `20261105T105332Z-rh-v4-analysis-assessed-r2/`. The [human-readable summary](../../../evidence/benchmarks/research-handoff/20261105T105332Z-rh-v4-analysis-assessed-r2/summary.md) lists every run and its limitations.

Choose a fresh output directory under `.tmp/` and run:

```bash
npm run study:handoff -- analyse \
  evidence/benchmarks/research-handoff/20261105T105332Z-rh-v4-measured/inventory.json \
  .tmp/analysis-rh-v4-new \
  measured \
  evidence/benchmarks/research-handoff/20261105T105332Z-rh-v4-measured/assessments.json
```

The output directory must not already exist. Raw records remain immutable, and assessments join in memory. Evidence links in this document resolve only in this retained worktree because `evidence/` is gitignored.

## Historical Preparation

The accepted `rh-v3` implementation passed its deterministic, synthetic and observer gates, but both permitted PostgreSQL corpora were rejected before any arm result. Their source identities and rejection receipts remain under [`20261104T203243Z-rh-v3-measured/`](../../../evidence/benchmarks/research-handoff/20261104T203243Z-rh-v3-measured/) and [`20261104T204211Z-rh-v3-measured-r2/`](../../../evidence/benchmarks/research-handoff/20261104T204211Z-rh-v3-measured-r2/). No measured PostgreSQL conversation ran, and those captures were not reused.

Before the owner approved the [_Cloudflare_](https://www.cloudflare.com) question, the coordinator ran an answer-shaped topic-validation call. Its [planning disclosure](../../../evidence/benchmarks/research-handoff/20261105T075350Z-topic-validation/planning-disclosure.json) preserves and digest-binds that material while prohibiting its use as experimental input. The corpus and adequacy reviewers remained isolated from it.
