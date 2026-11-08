# Codemode Research Handoff Study

## Summary

Between 4 and 8 November 2026, a controlled study tested whether invoking `intelli_research` through _Codemode_, the `Pi` JavaScript tool interface, reduces the token traffic that research places in the main agent conversation while preserving a useful answer. On the tested task, it did not. In the final ten-pair comparison, Codemode used more main-conversation tokens in nine of ten pairs (mean +1,441.4 tokens, +23.4%; exact sign test p ≈ 0.021). No answer from either route passed the frozen quality gate, so the study provides no evidence of token savings with preserved answer usefulness.

The single-pair `rh-v6` and `rh-v7` comparisons, and the one `rh-v4` pair in which both conversations conformed and gave adequate answers, pointed the same way: Codemode added 1,090 to 2,350 main tokens. The wider `rh-v4` series was mixed: in two of its four pairs with both conversations conforming, Codemode used fewer tokens (by 67 and 343). Whenever they conform, both routes make one research handoff and one answer-producing resumption, so Codemode had no extra main-model turns to remove. The direct `intelli_research` call remains the recommended route.

The study also found a product defect. The provenance validator in `src/core/provenance.ts` misparses a URL inside bold Markdown and then rejects the clean citation as absent, which left one otherwise completed research run without a committed report. The defect remained unfixed on 8 November 2026.

## Scope

The study compared two ways for the main model to call the same research operation on one fixed question and one captured source corpus:

| Route | Main-Conversation Interaction |
|---|---|
| Direct Research | The main model calls `intelli_research` directly |
| Codemode | The main model writes one Codemode script that awaits `intelli_research` and returns its complete text once |

Both routes ran on `Pi` 1.5.0 with the subscription main model `openai-codex/gpt-6.1-sol`. The research engine, settings, task prompt and source pages were identical. Only the route instructions, the exposed tool interface and the return boundary differed.

The results apply to that question, corpus, host and main model. They are not a general ranking of invocation routes, a measure of live search latency or an evaluation of the separate, earlier Codemode engine study on the `feat/codemode-research` branch, whose observations this study did not use.

## Introduction

`intelli_research` already runs its five stages (search, fetch, extract, collate and cache suggestion) behind a single tool call and returns one synthesis with links to the saved report under `.search/`. The proposal under test was that a Codemode script could make this boundary tighter, so that the main model issues one request and receives one useful response, like an application programming interface (API) call, with less intermediate material entering its context.

The study set out to measure, from actual main-model requests:

- The tokens processed by the main conversation, including cached input.
- The number of main-model resumptions after the research call.
- Whether the route conformed to one handoff with no extra evidence reads.
- Whether the final answer remained useful and faithful to its sources.

A positive claim required lower main-conversation traffic without an unacceptable loss of answer quality. No benefit was an accepted outcome.

## Background

The [feasibility assessment](https://github.com/Curio-Data/pi-intelli-search/blob/archive/codemode-research-handoff/docs/experiments/research-handoff/FEASIBILITY.md) established that the shared core accepts injected model and page-fetch dependencies. A benchmark adapter could therefore serve both routes the same captured search response and page bytes without changing the research algorithm or the public tool parameters.

The study ran as six numbered series, each with its own frozen protocol, evidence root and financial settlement. Results from different series are not pooled.

| Series | Date | Design | Outcome |
|---|---|---|---|
| rh-v3 | 4 November | PostgreSQL question | Both captured corpora rejected before measurement |
| rh-v4 | 5 November | Cloudflare email question, six pages, ten sequential pairs | Claim gate rejected; 8 of 20 runs conforming and adequate |
| rh-v5 | 6 November | Pilot with a fresh capture | Closed at corpus review; the capture lacked required evidence |
| rh-v6 | 6 to 7 November | One pair, twelve captured pages | Direct answer passed after adjudication; Codemode answer failed |
| rh-v7 | 7 November | One uninterrupted pair, same corpus | Both answers failed quality |
| rh-v8 | 8 November | Ten pairs, two running concurrently, same corpus | No answer passed quality; Codemode used more tokens in nine pairs |

From `rh-v4` onwards the question was:

> When running Pi Durable on Cloudflare, how do I enable outbound email with Cloudflare native services?

## Methodology

**Common sources.** In each series, a single [_Perplexity Sonar_](https://docs.perplexity.ai) search was captured once, outside the measured conversations, and its selected pages were fetched once. From `rh-v6` onwards both routes replayed the same search completion and twelve page texts byte for byte through a private adapter. The main conversation never saw the source manifest, and no live search or fetch could substitute for missing material. Extraction and collation stayed live on [_MiniMax M3_](https://minimax.io), so their output could vary between runs.

**Codemode configuration.** The Codemode route used the pinned host's default construction with `mode: "only"`, `inlineBudget: 3000` and `models: false`. The direct route did not activate Codemode. The Codemode script returned the unchanged research text, so the route did not shorten the result. Report length still varied between runs because extraction and collation were live.

**Isolation.** Every conversation started with a new session, an empty workspace, a new agent directory and no previous answer cache.

**Schedule.** The final `rh-v8` suite ran ten matched pairs in five waves of two concurrent pairs. Odd pairs ran direct research first and even pairs ran Codemode first. The two conversations of a pair never overlapped, and the second started more than 30 seconds after the first finished. No conversation was replaced or omitted.

**Measurement.** A request observer recorded provider-reported input, cached input, output and reasoning tokens for each main-model request, together with the request sequence, tool route, recovery calls, downstream usage and charges. The primary efficiency measure was total main-conversation tokens per pair. Internal pipeline calls and progress events did not count as main-model resumptions.

**Answer quality.** Each answer received two fresh, isolated reviews: one from _Claude Code_ on Opus 5.5 and one from `Pi` on Kimi K3.1 Pro. Neither reviewer was the measured main model. Reviewers saw only one answer under a neutral label (its text could still reveal the route), the captured corpus and the frozen rubric. Two rubrics applied independently across six topics:

- **Fidelity:** every claim and instruction is supported by the captured sources, with correct names, scope and maturity.
- **Task usefulness:** the answer supplies what is needed to carry out the task, or a source-documented limitation explaining why it cannot be done.

The six topics were supported mechanism and maturity, prerequisites and setup, configuration and code, agent integration, limitations and failure modes, and applicability and evidence access. A review passed only when every cell of both rubrics passed, and an answer passed only when both reviews passed. When one reviewer passed and the other failed an answer, a third isolated reviewer could adjudicate the whole answer, passing it only by resolving every failed criterion.

**Analysis.** The prespecified primary outcomes were paired answer quality (exact two-sided McNemar test) and paired main-conversation tokens (exact two-sided sign test). No test was adjusted for multiplicity. A prespecified sensitivity population excluded pairs in which either conversation failed its machine checks. The analysis reproduces byte for byte from the retained evidence without credentials or network access.

## Results

### Ten-Pair Suite

Measured collection ran from 17:44:42 to 18:10:47 Coordinated Universal Time (UTC) on 8 November 2026, approximately 26 minutes. Individual conversations took 103 to 174 seconds.

| Measure | Direct Research | Codemode |
|---|---:|---:|
| Collected Conversations | 10 | 10 |
| Machine Checks Passed | 9 | 10 |
| Answer Quality Passed | 0 | 0 |
| Mean Main-Conversation Tokens | 6,156.5 | 7,597.9 |
| Mean Main Input Tokens | 5,247.7 | 6,607.2 |
| Mean Main Output Tokens | 908.8 | 990.7 |
| Mean Downstream Charge, USD | 0.050434 | 0.048747 |
| Mean Conversation Duration, Seconds | 131.4 | 129.9 |
| Main Requests per Conversation | 2 | 2 |
| Recovery Calls | 0 | 0 |

| Pair | Wave | First Route | Direct Tokens | Codemode Tokens | Difference |
|---:|---:|---|---:|---:|---:|
| 1 | 1 | Direct | 6,463 | 7,902 | +1,439 |
| 2 | 1 | Codemode | 6,035 | 7,102 | +1,067 |
| 3 | 2 | Direct | 6,375 | 7,502 | +1,127 |
| 4 | 2 | Codemode | 6,497 | 7,759 | +1,262 |
| 5 | 3 | Direct | 7,601 | 7,115 | -486 |
| 6 | 3 | Codemode | 2,988 | 7,199 | +4,211 |
| 7 | 4 | Direct | 6,743 | 8,100 | +1,357 |
| 8 | 4 | Codemode | 6,058 | 7,789 | +1,731 |
| 9 | 5 | Direct | 6,673 | 7,584 | +911 |
| 10 | 5 | Codemode | 6,132 | 7,927 | +1,795 |

Codemode used a mean of 1,441.4 more tokens per pair (median +1,309.5), with nine positive differences and one negative (p = 0.021484375). Almost all of the increase was main input (mean +1,359.5) rather than output (mean +81.9). Every Codemode conversation's first request carried 526 more input tokens than the direct route's (1,841 against 1,315), and the resumption carried that prefix again, so much of the increase is a fixed per-conversation overhead from the Codemode tool interface and route instructions rather than a larger research result.

The direct conversation in pair 6 failed its machine checks and returned a short error instead of a report, which inflates that pair's difference. Excluding it, the nine-pair sensitivity population still showed a mean increase of 1,133.7 tokens (+17.4%) for Codemode, with eight positive differences and one negative (p = 0.0390625).

Downstream charges and duration were slightly lower on average for Codemode, but their paired tests did not establish a difference (p = 0.34375 and p = 0.75390625). Concurrency, varying provider serving and live extraction output limit any attribution of these figures to the route.

All forty initial reviews failed, so no adjudication was needed. The most frequently failed usefulness topic was agent integration (37 of 40 reviews), followed by limitations and failure modes (29) and configuration and code (22). These are reviewer-cell counts, not independent answer counts. With no discordant quality verdicts, the McNemar test was unavailable; equal failure counts do not establish that the routes produce equivalent quality.

### Quality Failures

No answer came close to passing. An answer passed only if both reviewers passed all twelve cells (six topics under two rubrics). Usefulness failed on any missing required step, even when the answer honestly said the step was absent, and fidelity failed on any material unsupported claim or inference presented as documented instruction. Every answer had at least one review that failed three or more cells; 37 of the 40 reviews failed three or more, and 25 recorded a material unsupported claim.

The captured `Pi` documentation did describe the integration the reviewers required: a `ToolRegistration` with a parameter schema and `execute()` handler, installed on the registry passed to `Harness.open()`. That detail appears to have been lost along the compression chain. Twelve source pages became a research report of 8.3 to 14.4 KB, which the main model condensed into a final answer of 3.6 to 4.4 thousand characters. Six of the nineteen saved reports name none of `ToolRegistration`, `registry.install` or `Harness.open`, and where a report did name them the final answer could still reduce the step to one sentence, for example "Register an email-sending tool through Pi Durable tool registry, and have its execution handler call the binding." Both routes share this chain, so it would limit answer quality without distinguishing them.

The question also requires joining two documentation families, _Cloudflare Email Service_ and the _Pi Durable_ harness. Reviewers treated the connection between them as an inference that an answer must label as such to pass fidelity. Earlier series showed the same pattern: in `rh-v6` the direct answer passed only after adjudication, and in `rh-v7` both answers failed on agent integration. Because no answer passed, the study cannot compare the routes on answer quality; that comparison would need a task and rubric that some answers can pass.

### Earlier Series

| Series | Direct Tokens | Codemode Tokens | Difference | Quality |
|---|---:|---:|---:|---|
| rh-v4, Pair 2 | 6,300 | 7,390 | +1,090 | Both Adequate (rh-v4 Review) |
| rh-v6 | 6,646 | 8,725 | +2,079 | Direct Passed After Adjudication; Codemode Failed |
| rh-v7 | 6,177 | 8,527 | +2,350 | Both Failed |

`rh-v4` used a single adequacy review per answer; `rh-v6` onwards used the two-rubric gate described in Methodology. In `rh-v4`, the full-population Codemode mean was 1,920.5 tokens lower, but two route-nonconforming direct runs that made repeated evidence reads account for the entire reduction. Across the other eight pairs the Codemode mean was 330.1 tokens higher. Pair 2 was the only `rh-v4` pair in which both runs were conforming and adequate. Eleven of the twenty `rh-v4` runs recorded a truncated collation, a stage shared by both routes; the `rh-v6` and `rh-v7` pairs, on the later twelve-page corpus, recorded nonempty, untruncated collation.

### Costs

| Item | Reported Provider Charge, USD |
|---|---:|
| rh-v3 Rejected Captures | 0.01123 |
| rh-v4 (Separate Envelope) | 0.643910399 |
| rh-v5 to rh-v8 (Shared USD 10 Ceiling) | 1.242927268 |
| Of Which rh-v8 | 0.994476951 |

Every settlement closed with no unknown charges, active reservations or overruns. These totals cover search capture and _MiniMax M3_ extraction and collation. Main-model usage ran on a subscription, and reviewer usage is not included in these totals.

## Findings

1. **Codemode increased main-conversation traffic in the ten-pair suite.** It used more main-conversation tokens in nine of ten pairs (exact two-sided sign test, p ≈ 0.021, unadjusted), almost entirely as input. The single-pair `rh-v6` and `rh-v7` comparisons and the one fully eligible `rh-v4` pair pointed the same way; the wider `rh-v4` series was mixed.
2. **There were no resumptions to remove.** Every completed, conforming conversation in both routes made exactly two main-model requests: the research handoff and the answer-producing resumption. The direct `intelli_research` call is already a single self-contained boundary.
3. **No efficiency claim between useful answers is possible.** No pair in the ten-pair suite produced two quality-passing answers. The token comparison therefore describes the cost of each route, not the cost of a useful answer.
4. **Both routes failed quality in the same way.** Reviewers failed both routes mainly on agent integration: the answers did not supply enough steps for defining, installing and invoking an email tool in the running agent, although the captured sources documented them. The detail was lost as sources were compressed into the report and then into the final answer, a chain both routes share. The study does not attribute the failures to either route.
5. **The provenance validator has a false-rejection defect.** In `rh-v8` pair 6, the validator retained closing bold markup as part of a URL in the extracted evidence, then rejected the clean URL in the collation as absent. All extraction and collation calls had completed and were charged, but no report was committed. The model did not invent the citation. On 8 November 2026 the defect remained on `main` (`d2ec506`) and on the unmerged `rcca/mcp-research-failures` branch, whose `proseUrls()` function is unchanged. A fix and regression test are follow-up work.
6. **The fixed-source runner is reusable.** The runner prepares an immutable study plan for a requested number of pairs and concurrent pairs, collects it within a shared spending ceiling, and reproduces its analysis offline. Changing the pair count needs no source edit. A future series still needs a new owner direction, a fresh evidence root and plan-bound acceptance.

The complete workflow was not operationally clean. The `rh-v8` analysis records three administrative incidents (two coordinator preparation errors and one review-format correction that changed no judgement), and a later addendum records 41 grader-registration diagnostics. No measured conversation, quality judgement or charge was affected.

## Records and Reproduction

The detailed protocols, findings and runner are archived under the [`archive/codemode-research-handoff`](https://github.com/Curio-Data/pi-intelli-search/tree/archive/codemode-research-handoff) tag, which marks the final commit of the `study/research-handoff-runner` branch:

- [Ten-Pair Study Findings](https://github.com/Curio-Data/pi-intelli-search/blob/archive/codemode-research-handoff/docs/experiments/research-handoff/SUITE-FINDINGS.md): canonical narrative for `rh-v8`.
- [Suite Protocol](https://github.com/Curio-Data/pi-intelli-search/blob/archive/codemode-research-handoff/docs/experiments/research-handoff/SUITE-PROTOCOL.md): frozen method, rubric, gates and stop rules.
- [Research Handoff Resume](https://github.com/Curio-Data/pi-intelli-search/blob/archive/codemode-research-handoff/docs/experiments/research-handoff/RESUME.md): accepted source identity and the offline reproduction command.
- [Findings](https://github.com/Curio-Data/pi-intelli-search/blob/archive/codemode-research-handoff/docs/experiments/research-handoff/FINDINGS.md), [Continuation Findings](https://github.com/Curio-Data/pi-intelli-search/blob/archive/codemode-research-handoff/docs/experiments/research-handoff/CONTINUATION-FINDINGS.md) and [Repeat Findings](https://github.com/Curio-Data/pi-intelli-search/blob/archive/codemode-research-handoff/docs/experiments/research-handoff/REPEAT-FINDINGS.md): the `rh-v4`, `rh-v6` and `rh-v7` results.
- [Brief](https://github.com/Curio-Data/pi-intelli-search/blob/archive/codemode-research-handoff/docs/experiments/research-handoff/BRIEF.md): the original objective and measurement requirements.

The runner source is under `scripts/research-handoff/` at that tag, with tests in `test/handoff-*.test.ts`. The measured implementation is commit `63abcd4`.

Raw evidence (conversations, captured corpus, ledgers, locked grades, settlements and analyses) is gitignored and retained in the maintainer's study worktree, not in the repository. The `rh-v8` roots are `evidence/benchmarks/research-handoff/20261108T152419Z-rh-v8-suite/` and `evidence/agents/20261108T152419Z-full-suite/`, bound by a 5,036-file evidence manifest.
