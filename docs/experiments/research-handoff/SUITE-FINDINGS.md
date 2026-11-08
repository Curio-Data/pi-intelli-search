# Ten-Pair Study Findings

The requested `rh-v8` study completed all ten matched pairs on 8 November 2026. Codemode used more main-conversation tokens in nine pairs, and neither route produced an answer that passed the frozen quality gate. This study provides no evidence of token savings with preserved answer usefulness.

The [paired analysis](../../../evidence/benchmarks/research-handoff/20261108T152419Z-rh-v8-suite/analysis/suite-analysis.json) is the canonical numerical result. The [full-population inventory](../../../evidence/benchmarks/research-handoff/20261108T152419Z-rh-v8-suite/analysis/suite-inventory.json) joins every planned conversation to its record, machine checks, quality gate and charges. No conversation was replaced or omitted.

## Design and Execution

The [frozen protocol](SUITE-PROTOCOL.md), [plan](../../../evidence/agents/20261108T152419Z-full-suite/study-plan.json) and [implementation acceptance](../../../evidence/agents/20261108T152419Z-full-suite/implementation-acceptance.json) bind the comparison. Both routes ran on `Pi` 1.5.0 with subscription main model `openai-codex/gpt-6.1-sol`. The baseline invoked `intelli_research` directly; the candidate invoked the same operation through Codemode and returned its complete text. Extraction and collation used live _MiniMax M3_ calls. The task, settings, rubric, captured search and twelve page texts were unchanged from `rh-v6`; no new search or page fetch occurred.

The owner [approved two concurrent pairs](../../../evidence/agents/20261108T152419Z-full-suite/owner-concurrency-direction.json). Five waves each held two pairs. Odd pairs ran baseline first and even pairs candidate first; the two arms within a pair never overlapped, and the second arm started more than 30 seconds after the first finished. All conversations had new empty workspaces and agent directories, fresh sessions and no previous answer cache. The checkout-root `.search` remained absent.

Measured collection ran from 17:44:42 to 18:10:47 Coordinated Universal Time (UTC), approximately 26 minutes. Individual conversations took 103 to 174 seconds. Development and implementation review preceded collection; independent answer grading followed it and accounted for much of the later elapsed time. These activities are not measured conversation latency.

## Results

| Measure | Direct Research | Codemode |
|---|---:|---:|
| Collected Conversations | 10 | 10 |
| Machine Checks Passed | 9 | 10 |
| Answer Quality Passed | 0 | 0 |
| Mean Main-Conversation Tokens | 6,156.5 | 7,597.9 |
| Mean Downstream Charge, USD | 0.050434 | 0.048747 |
| Mean Conversation Duration, Seconds | 131.4 | 129.9 |
| Main Requests per Conversation | 2 | 2 |
| Recovery Calls | 0 | 0 |

The primary token measure includes cached input and output. Codemode used a mean of 1,441.4 more tokens per pair, or 23.4% more relative to the direct route's mean. The median paired difference was +1,309.5. Nine differences were positive and one negative; the exact two-sided sign-test p-value was 0.021484375. Neither primary nor secondary tests were adjusted for multiplicity.

The failed direct conversation in pair 6 returned a short error instead of a report, inflating the token difference. The prespecified sensitivity population, the nine pairs whose two arms passed machine checks, still showed a mean increase of 1,133.7 tokens (17.4%) for Codemode, with eight positive differences and one negative; p = 0.0390625. Both populations are retained. There were no pairs with two quality-passing answers, so neither population establishes an efficiency comparison between useful answers.

Downstream charges and duration were lower on average for Codemode, but their paired sign tests did not establish a difference (p = 0.34375 and 0.75390625 respectively). Concurrency, variable provider serving and live extraction and collation output limit attribution. This is a comparison on one fixed task and source snapshot, not a general ranking of invocation routes. The equal quality-failure counts do not establish equivalence; there were no discordant quality verdicts, and the analysis reports the quality test as unavailable.

## Answer Assessment

Each answer received two fresh, isolated reviews: one from _Claude Code_ on Opus 5.5 and one from `Pi` on Kimi K3.1 Pro. Reviewers saw only one neutral answer bundle, the captured source corpus and the frozen rubric. They did not receive other answers, grades or route mappings. All forty initial overall verdicts failed, so no adjudication was required. The [gate verification](../../../evidence/agents/20261108T152419Z-full-suite/gate-verification.json) and retained review locks bind the results.

The most frequently failed task-usefulness topic was agent integration: 37 of the 40 reviews failed that cell. Limitations and failure modes failed in 29 reviews, and configuration and code in 22. These are reviewer-cell counts, not independent answer counts. The individual grades retain the source-cited reasons rather than reducing every failed answer to the same defect.

One review needed a format correction before its gate: two empty source-reference arrays did not name the evidence-access record already cited in its reasons. The original author supplied those references in a new copy without changing any judgement, reason, binding or original lock time. The [correction report](../../../evidence/agents/20261108T152419Z-full-suite/reports/rh8-g014a-format.md) and original grade remain intact.

## Machine Failure

The [independent machine review](../../../evidence/agents/20261108T152419Z-full-suite/reports/paid-machine-review.md) reproduced the cause of the pair-6 baseline failure. The extension's provenance validator misparsed a URL inside bold Markdown in the extracted evidence, retaining closing markup as part of the URL. It then rejected the clean version of that same URL in the collation as absent from the evidence. All extraction and collation calls had completed and were charged, but no report was committed.

This was a false rejection by the product under test, not evidence that the model invented the cited URL. The failed conversation remains in the primary population; it was not rerun and the validator was not changed during the study. A product fix is a separate task.

## Accounting and Incidents

The [settlement](../../../evidence/benchmarks/research-handoff/20261108T152419Z-rh-v8-suite/settlement-receipt.json) is closed and reconciled. New provider charges were USD 0.994476951, including charge qualification. Cumulative charges across `rh-v5` through `rh-v8` were USD 1.242927268 against the shared USD 10 ceiling, with no unknown charges, active reservations or overruns. Main-model subscription usage is recorded separately and is not included in those monetary totals.

Collection had no retries, budget waits, controller stops or settlement errors. The complete workflow was not operationally clean. The reproduced analysis records [three administrative incidents](../../../evidence/benchmarks/research-handoff/20261108T152419Z-rh-v8-suite/incidents.json): two coordinator preparation errors and the review-format correction. A later [orchestration addendum](../../../evidence/agents/20261108T152419Z-full-suite/orchestration-addendum.json) retains 41 additional grader-start registration diagnostics, counted as controller incidents under the protocol's broad definition. Those counts are additional to, not included in, the original analysis's incident totals. All affected agents were already running, were registered without duplicate launches and completed their work. No measured conversation, quality judgement or charge changed. Earlier development and reviewer-provider availability failures preceded the observation window and remain in the preparation reports.

## Retention and Reuse

Raw records, transmitted payloads, caches, ledger entries, reviews and analyses remain under `evidence/benchmarks/research-handoff/20261108T152419Z-rh-v8-suite/`. Authority, validation logs, independent reviews and the second offline analysis remain under `evidence/agents/20261108T152419Z-full-suite/`. The two generated analysis files reproduced byte for byte into that separate directory. Historical evidence and scratch were preserved.

The runner now accepts configurable pair counts and concurrency in an immutable study plan. `run-study` prepares the plan; `rh8-collect` executes its bounded schedule, and `rh8-analyse` reproduces its results. Future authorised studies need no source edit merely to change the pair count, but still need a new owner direction, plan, accepted identities and fresh root. This settled series grants no further collection authority. [Resume](RESUME.md) records the current entrypoint.
