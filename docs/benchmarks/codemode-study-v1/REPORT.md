# Codemode Off and On: Measured Study Report

Revision: `measured-series-2-final`. Status: measured execution, quality scoring, offline analysis, fresh-environment reproduction and independent claim review complete. The study closed on 4 November 2026; [Study Closure](../../plans/codemode/CLOSURE.md) records the owner's worktree-retirement and evidence-disposal decision. This report supports no general superiority claim for Codemode or `intelli-search`.

## Finding

The measured study does not demonstrate a Codemode benefit. Both primary token analyses and both primary quality analyses are unavailable under the frozen missing-data rules. The study is therefore inconclusive, not evidence that Codemode saves tokens or preserves quality.

All four diagnostic input-ratio point estimates exceed 1. Codemode-on used more uncached input in replay and more total input in both populations. The live uncached-input interval remains compatible with both reductions and increases, so its near-unity point estimate is not an equivalence result. The lower live pipeline-cost diagnostic reflects the observed routing mix and does not establish Codemode efficiency or preserved quality. These estimates do not replace the unavailable primary analyses.

Main-package integration is not recommended on this evidence. Any later integration decision should first address the replay-miss population, the live run with no answer, and the strong fetch-only routing skew. No package staging, release or merge follows from this report.

## Scope and Method

The comparison used one experimental build at `b330750d2b771007372c59ce2a220c17c1da16e9` and the retained `Pi` 1.4.0 host selected through `explicit-root`. The main model was `openai-codex/gpt-6.1-sol` on subscription in both arms. Pipeline calls used [_OpenRouter_](https://openrouter.ai) with [_Perplexity Sonar_](https://docs.perplexity.ai) and [_MiniMax_](https://minimax.io) models. Search used `openrouter/perplexity/sonar`; extraction, collation and cache suggestion used `openrouter/minimax/minimax-m3`. Judge 1 was subscription `claude-opus-5-5[1m]`; judge 2 was `openai-codex/gpt-6.1-sol` in separate fresh sessions. The shared main and second-judge identity remains a limitation.

The frozen population contained 20 tasks across single, breadth, manual and follow-up workflows, two arms, two repeats and two populations. This gives 160 comparative executions plus 20 fixture captures. Controlled replay and unforced live tasks are reported separately. Replay timings and replay pipeline charges are not production latency or new cash measures.

The primary endpoint was uncached main input. Total input, answer quality, live latency and reported pipeline cost were secondary endpoints. Primary intervals require the complete declared population. Complete-case intervals are diagnostic only.

Authoritative records:

- [Measured analysis](measured-v3/derived/analysis.json)
- [Shared measured dataset](measured-v3/dataset.json)
- [Publication bundle](measured-v3/)
- Private retained execution record, formerly `evidence/agents/20261103T142157Z-codemode-study/reports/measured-executor.md`; disposed under the owner's retirement approval
- [Frozen design](MEASURED-SERIES.json)
- [Protocol](PROTOCOL.md)

## Completion and Missingness

| Population | Executions | Expected Primary Runs | Usable Runs, All Executions | Complete Paired Repeats, Primary | Primary Availability |
|---|---:|---:|---:|---:|---|
| Replay | 80 | 60 | 66 | 28 of 30 | Unavailable: `CS-RES-07` has no complete replay pair |
| Live | 80 | 80 | 79 | 39 of 40 | Unavailable: `CS-RES-08` has one incomplete repeat |

Fourteen replay cells ended in replay misses: ten across five manual tasks in the off arm and all four cells of `CS-RES-07`. They remain in the inventory with no live fallback or unrecorded retry. The replay primary population excludes the five manual tasks, but `CS-RES-07` still makes it incomplete.

Of the ten failed live executions, nine delivered settled answers and remain valid task outcomes under the owner rule. The tenth, `CS-RES-08-live-on-r2`, produced no finished main response and has null usage. Together with 70 completed executions, this leaves 79 usable live cells. The unfinished on-arm cell makes the live primary analysis unavailable.

## Token and Time Results

The following are complete-case diagnostic estimates with 95% paired task-cluster bootstrap intervals. They are not primary claims. Diagnostics use evaluable off/on repeat pairs, then average within each task. Replay contributes 14 primary task clusters. Live contributes all 20 task clusters, with `CS-RES-08` contributing only its first repeat; its missing second repeat still blocks primary inference. A task named as having missing evidence is not necessarily absent from the diagnostic point estimate.

| Population | Endpoint | On/Off Ratio or Difference | Diagnostic Interval | Task With Missing Evidence |
|---|---:|---:|---:|---|
| Replay | Uncached input ratio | 1.4021 | [1.2689, 1.5620] | `CS-RES-07` |
| Replay | Total input ratio | 1.7339 | [1.6168, 1.8686] | `CS-RES-07` |
| Live | Uncached input ratio | 1.0539 | [0.8681, 1.2608] | `CS-RES-08` |
| Live | Total input ratio | 1.2135 | [0.9629, 1.4726] | `CS-RES-08` |
| Live | Latency difference, on minus off | -5,180 ms | [-14,533, 4,129] ms | `CS-RES-08` |
| Live | Reported pipeline cost difference, on minus off | -$0.004564 | [-$0.007985, -$0.001123] | `CS-RES-08` |

The uncached and total ratios are geometric means of per-query on/off ratios. The latency and cost figures are arithmetic mean differences. A ratio and a difference can disagree in sign because they answer different questions.

Live cost and latency must not be interpreted as evidence of Codemode efficiency. Tool routing differed sharply by arm, and many sessions did not run the research pipeline at all.

## Answer Quality

Each judge scored all 160 comparative cells in fresh blinded packet sessions, including 145 cells with delivered answers and 15 without a delivered answer. Missing and failed candidates remain in the scoring inventory; scoring them does not make their primary observations usable. Overall scores agreed exactly on 89 cells and differed by at most one point on all 160. No answer or paired direction met the two-point disagreement-inspection threshold. Six quotation occurrences were flagged as unmatched; 30 of the 320 judge-answer records had empty quotation lists. Both judges matched the owner labels on all four trivial calibration cases. These cases remain sanity checks, not judge validation.

Primary quality analysis is unavailable for both populations because of the same missing tasks. Complete-case diagnostic results were:

| Population | Judge | On-Minus-Off Difference | Diagnostic Interval |
|---|---|---:|---:|
| Replay | Judge 1 | 0.0714 | [-0.0714, 0.2500] |
| Replay | Judge 2 | -0.0357 | [-0.2143, 0.1071] |
| Live | Judge 1 | -0.1250 | [-0.5250, 0.3000] |
| Live | Judge 2 | 0.0000 | [-0.3250, 0.3000] |

These results do not establish preserved quality. They also do not establish a meaningful loss. The live judge-1 interval crosses the declared -0.5-point margin. Separate judge results are retained rather than averaged, and the shared-model limitation remains visible.

A separate prespecified diagnostic sensitivity includes scored failed and invalid cells without repairing primary cells. Its on-minus-off point differences are 0.0667 and -0.0333 for replay judges 1 and 2, and -0.2000 and -0.1000 for live judges 1 and 2. Bounds and selection are retained under `qualitySensitivity` in [the shared analysis](measured-v3/derived/analysis.json). These are sensitivity diagnostics, not primary quality claims.

The visibility basis is `revision-binding-valid`, binding `cbb917ecda8a7c6f2e0578341e4b9c1592e90536b9d9ad8b569cd2eb3e1b19ca`. The [binding](measured-v3/inputs/corpus-revision-binding.json) records a blob-level comparison showing that the rubric and in-scope task material are unchanged and cites the owner-approved carry-over in [rebindings.json](measured-v3/inputs/rebindings.json) and [decisions.json](measured-v3/inputs/decisions.json). The owner record states:

> Yes: the owner's four verdicts on unchanged calibration.json carry over to corpus-v2-r4-owner-expanded.

No repeat owner review was requested or performed. The owner decision and rebinding records are attached to the shared bundle. This visibility basis does not establish judge reliability.

## Live Routing

Forty-two of 80 live cells made no research-pipeline model attempt: 41 used fetch only and one performed no operation before its unfinished response. Fetch-only routing was strongly arm-skewed:

| Arm | Fetch-Only Cells | No-Operation Cells | Cells Using Search | Cells Using Research |
|---|---:|---:|---:|---:|
| Off | 10 of 40 | 0 of 40 | 23 of 40 | 7 of 40 |
| On | 31 of 40 | 1 of 40 | 0 of 40 | 8 of 40 |

Both catalogues exposed search and research operations, so this is observed routing behaviour rather than a catalogue gap. The on arm used script fetch in 16 of the 23 off-arm search pairs. Research totals were similar at 7 off cells and 8 on cells but fell mostly on different task repeats: only one task-repeat pair used research in both arms. Live token, cost and latency claims are therefore restricted to this branch-only-fetch-dominated behaviour. They do not establish an effect for full-pipeline research.

## Context Exposure

Context exposure is descriptive and feeds no endpoint or claim. It counts retained exact page-text runs of at least 32 characters in actual main-model requests, after the recorded URL-delivery gate. Repeated history is counted again in each request, so totals reflect request count as well as page volume. The measure omits shorter matches, paraphrase and uninspectable reasoning, and can undercount differently normalised text; page material is capped by the study profile. Means use complete exposure records only: 38 per arm in replay, 40 off and 39 on in live. They are not paired primary estimates and are not necessarily the same rows as the valid-answer analysis.

| Population | Measure | Off Mean | On Mean |
|---|---|---:|---:|
| Live | Raw page characters summed over requests | 42,286 | 52,781 |
| Live | Peak single request | 30,417 | 34,596 |
| Live | Mean of each run's characters per request | 12,231 | 18,902 |
| Replay | Raw page characters summed over requests | 36,794 | 3,593 |

Live on-arm exposure was higher on all three summaries. Replay exposure is largely fixture-determined and carries limited arm signal; the off-arm manual replay misses also make the populations different. No context-reduction claim follows.

The short-run class is a post-hoc size classification, not a judgement of justified quotation. The rule uses both a length ceiling and a 25% page-share boundary, so classes can overlap by length. Across 175 complete inventory records including 20 fixture captures, the largest short span was 921 characters and the smallest long span was 845. Holding the page-share boundary fixed, changing the ceiling from 1,024 to 1,360 or 4,096 characters changes the short-run total from 404,628 to 406,718 or 408,705. These changes relabel matched material; they do not change total matched exposure or any token endpoint. The effect is concentrated in the live population: across 79 complete live records, the corresponding totals are 36,671, 38,761 and 40,748, increases of 5.7% and 11.1%. Replay and fixture-capture totals are unchanged. These figures describe the inventory, not a calibrated quotation detector or an arm-effect estimate. Short exact runs can be coincidental, and no coincidence correction is applied. The same totals are available in the shared dataset.

The [context method output](measured-v3/derived/context-exposure-method.json) carries units, definitions and per-column meanings. [Context-exposure.csv](measured-v3/derived/context-exposure.csv) carries the complete and missing-record counts, short-run contributions and text skipped before delivery.

## Spend and Subscription Usage

The measured live batch reported USD 0.57922822 in pipeline charges. Settled study charges through that batch total USD 1.53506576, with no new study unknown-charge hold or active reservation; replay adds no new pipeline cash. Separately, the programme ledger retains USD 0.545984786 in known engineering expense and USD 1.5 in historical unknown-charge admission holds. Recorded known programme charges therefore total USD 2.081050546; including the retained holds gives accounting exposure of USD 3.581050546 and USD 26.418949454 remaining against the same USD 30 ceiling. The holds are admission assumptions, not audited charges or proven bounds on unknown bills. These records are not an account-debit audit.

The 84 judge-1 outputs, including four calibration sessions, report USD 43.66264 at list price, or USD 43.6626 rounded. This is notional usage for the subscription judge, not an OpenRouter pipeline charge in the programme cash ledger. Judge 2 also uses a subscription. Do not add list-price equivalents to programme cash spend; actual account debits have not been audited.

The [compact spend reconciliation](spend-reconciliation.json) preserves the original ledger identity and aggregate arithmetic. The original append-only ledger was the authoritative cash record during the study; it is not retained in the archived reproduction bundle and cannot be independently re-audited after worktree retirement.

## Reproduction

The private source dataset has SHA-256 `668409e6b2730247de7103456472996605b3e9bc3ceeaaf73d15bd85a201e498`; the shared sanitised dataset has SHA-256 `1c5d1ce1193bca80f27625d80defa02b8ace79e02890e64cf3127266c39f1901`. Numerical results are retained across sanitisation. Private raw requests, packet evidence, execution receipts and the programme ledger were local audit records during the study and were disposed under the owner's retirement approval. Public numerical regeneration does not independently authenticate those observations or re-score answers against all private sources. The original private-evidence export commands below are historical build provenance, not commands that can be rerun after retirement.

The measured dataset and analysis were regenerated without model calls:

```bash
node --import tsx scripts/benchmarks/study.ts \
  --series codemode-measured-20261103-r1 \
  --analyse measured-series
```

The recorded local bundle-construction command requires private inputs. The exporter refuses the already-retained target; use a new output directory for a corrected build and preserve `measured-v3` unchanged:

```bash
PUBLICATION_DENY_FILE="$PWD/evidence/agents/20261103T142157Z-codemode-study/publication-inputs/deny-list.txt" \
  node --import tsx scripts/benchmarks/study-publication.ts build \
  evidence/benchmarks/codemode-measured-20261103-r1/dataset-measured-series-20261103T184957122Z.json \
  docs/benchmarks/codemode-study-v1/measured-v3 \
  --inputs evidence/agents/20261103T142157Z-codemode-study/publication-inputs/inputs.json
```

Verify the bundle:

```bash
node --import tsx scripts/benchmarks/study-publication.ts verify \
  docs/benchmarks/codemode-study-v1/measured-v3 \
  .tmp/verify-measured-v3-fresh
```

The verified bundle contains the sanitised dataset, analysis, effects and context tables, figures, visible answers, judge outputs, corpus, protocol, design manifest, owner records, other inputs and source files. [MANIFEST.json](measured-v3/MANIFEST.json) binds the file digests and byte sizes; its SHA-256 is `583f0aaa5266e5ff3783fec400565b4062cd01bcd5fb35ebfd761f676439c48d`. The exporter commit is `3546343265110d21610f0656bc202720ed9e97c3`, with no tracked modifications at build; untracked files are not considered. The manifest digest should be published out of band with the bundle.

For public numerical regeneration, follow the [bundle instructions](measured-v3/README.md) with a dedicated empty parent, provisioned loader and fresh sibling output directories. The [public fresh-environment reproduction record](measured-v3-reproduction.md) documents successful cold-cache `npm ci` provisioning and byte-identical analysis and verification under Node v22.23.3 and v24.19.0 outside any repository checkout.

Re-exporting raw study evidence with the calibration revision binding requires the referenced corpus blob in local Git history and its retained owner and witness records. Regenerating numerical outputs from the published dataset does not rerun that calibration assessment. Raw observations and run manifests remain unchanged; analysis corrections create new derived snapshots.

## Limitations

- One replay task and one live repeat are technically missing, so no primary token or quality estimate is available.
- Live routing is dominated by branch-only fetch, especially in the on arm. Full-pipeline claims are not supported.
- One judge shares the main model identity. Separate sessions do not remove that dependence. Judge 1 used _Claude Code_ `2.1.317`, judge 2 used `Pi` `1.5.0`, and study execution remained pinned to `Pi` `1.4.0`; the differing judge harness is a further limitation.
- The calibration cases are trivial sanity checks, not judge validation.
- The short-run classification is post-hoc and ceiling-sensitive. It is not a quotation-quality measure.
- Replay evidence is controlled by fixtures and does not measure production network latency.
- The no-answer `CS-RES-08-live-on-r2` run contributes a genuine zero to on-arm exposure means. It is a recorded absence of retrieved page text, not an invented missing value.
- This is one build, one host and one main-model family. No cross-host or cross-model generality is claimed.
- Some judge text is conservatively redacted. The bundle records one such rationale at `/quality/records/47/score/rationale`; full answers are supplied separately and are not guaranteed to reproduce every judge passage verbatim.

## Recommendation

Do not integrate Codemode into the main package on the basis of this study. Publish the neutral, negative and missing outcomes with the data rather than a superiority narrative. A further experiment needs a less fetch-skewed live population and either complete replay fixtures or an explicitly declared missing-data design that can support a primary estimate.
