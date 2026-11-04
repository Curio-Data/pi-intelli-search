# Codemode Study Analysis Summary

Edition `publication-v1`. Analysis class: measured-series. Recorded experimental commit: `b330750d2b771007372c59ce2a220c17c1da16e9`. This generated summary renders the analysis kernel's claim states; it does not establish that a declared measured-series dataset was independently collected, and it is not the final study report. The final report is authored from this bundle after independent review.

## Scope and Identity

| Field | Value |
|---|---|
| Dataset Schema | 1 |
| Analysis Partition | measured-series |
| Method and Corpus Hashes | `b115290932900947…`, `695ba07dc665dcf8…` |
| Runs in Inventory | 180 |
| Bootstrap | Seed 20261102, 10000 draws, confidence 0.95 |
| Quality-Loss Margin | 0.5 points |
| Human Calibration Approved | true |
| Human Calibration Basis | revision-binding-valid, binding `cbb917ecda8a7c6f2e0578341e4b9c1592e90536b9d9ad8b569cd2eb3e1b19ca` |

## Environment and Models

Environment pins and model identities available in the dataset are in [environment.json](environment.json). Host versions observed across runs: 1.4.0. The main-model identity is declared in the inputs manifest (not verified against run data).

## Population Inventory

| Population | Expected Primary Runs | Observed Original Runs | Completed | Failed | Aborted | Not Started |
|---|---:|---:|---:|---:|---:|---:|
| replay | 60 | 80 | 66 | 0 | 14 | 0 |
| live | 80 | 80 | 70 | 10 | 0 | 0 |

Expected primary runs count off/on query-repeat cells in the primary analysis. Observed originals and outcome counts also include manual replay rows, which are excluded from the replay primary endpoint. Reruns, `only`-arm runs, fixture-capture rows and synthetic-driver-integration rows are excluded from these counts and remain in the full inventory. Do not divide these outcome counts by expected primary runs to estimate completion.

Failed, aborted, invalid and rerun runs are retained in [tables/runs.csv](tables/runs.csv); a technical rerun never replaces its original cell. The `analysis_valid` column there mirrors the kernel's paired-sample validity predicate.

## Token Endpoints

Ratios are geometric means of per-query on/off ratios after averaging evaluable paired repeats within each query. Differences are arithmetic means of per-query on-minus-off differences, in input tokens. Queries are the resampling units. The primary endpoint is the uncached-input ratio; the arithmetic difference is descriptive and can disagree in sign with the ratio. Displayed bounds are rounded for display; claim thresholds use the full-precision values in [derived/analysis.json](derived/analysis.json) and [tables/claims.csv](tables/claims.csv).

### Controlled Replay

- Uncached Input (Primary): paired queries 14, missing 1, undefined ratio queries 0; ratio 1.402, on-minus-off difference 2472.3 input tokens; 95% complete-case diagnostic interval [1.269, 1.562]; primary available: no.
- Total Input (Secondary): paired queries 14, missing 1, undefined ratio queries 0; ratio 1.734, on-minus-off difference 6330.6 input tokens; 95% complete-case diagnostic interval [1.617, 1.869]; primary available: no.
- Claim: The replay primary uncached-input interval is unavailable (incomplete population or undefined ratio queries). No token claim is made, and missing evidence is not treated as zero.
- Historical 50% hypothesis: not established for this dataset.
- Manual replay: 20 observed rows across 5 declared tasks; descriptive reliability evidence outside the primary analysis.

### Unforced Live

- Uncached Input (Primary): paired queries 20, missing 1, undefined ratio queries 0; ratio 1.054, on-minus-off difference 1087.2 input tokens; 95% complete-case diagnostic interval [0.868, 1.261]; primary available: no.
- Total Input (Secondary): paired queries 20, missing 1, undefined ratio queries 0; ratio 1.214, on-minus-off difference 5371.9 input tokens; 95% complete-case diagnostic interval [0.963, 1.473]; primary available: no.
- Claim: The live primary uncached-input interval is unavailable (incomplete population or undefined ratio queries). No token claim is made, and missing evidence is not treated as zero.
- Historical 50% hypothesis: not established for this dataset.
- Live results describe the workflows actually chosen under the declared allowances, not equal realised pipeline work. Where the experimental branch-only fetch operation dominates, results do not establish an effect for full-pipeline research.

Total input is reported alongside uncached input. An uncached-input change alone is not evidence of a total-context reduction. Replay-run pipeline cost is fixture reproduction and excluded from the analysed cost endpoint; [tables/runs.csv](tables/runs.csv) carries it per row as descriptive data. Returned-time estimates appear in [derived/effects.csv](derived/effects.csv); replay timing is never a live-latency measure.

Figures: Controlled replay: [uncached-input pairs](figures/replay-uncached-input-pairs.svg), [total-input pairs](figures/replay-total-input-pairs.svg), [input ratios](figures/replay-token-ratios.svg). Live tasks: [uncached-input pairs](figures/live-uncached-input-pairs.svg), [total-input pairs](figures/live-total-input-pairs.svg), [input ratios](figures/live-token-ratios.svg). Descriptive inventory only: [judge-score distribution](figures/quality-scores.svg).

## Answer Quality

- For the replay population, the primary quality bounds are unavailable or do not establish either preserved quality (requires the on-minus-off lower confidence bound above -0.5 points) or a loss beyond the margin. No quality conclusion is established; this does not demonstrate a small effect.
- Judge bounds (replay): judge 1 on-minus-off difference 0.07, 95% complete-case diagnostic interval [-0.071, 0.250] (primary available: no); judge 2 on-minus-off difference -0.04, 95% complete-case diagnostic interval [-0.214, 0.107] (primary available: no).
- For the live population, the primary quality bounds are unavailable or do not establish either preserved quality (requires the on-minus-off lower confidence bound above -0.5 points) or a loss beyond the margin. No quality conclusion is established; this does not demonstrate a small effect.
- Judge bounds (live): judge 1 on-minus-off difference -0.13, 95% complete-case diagnostic interval [-0.525, 0.300] (primary available: no); judge 2 on-minus-off difference 0.00, 95% complete-case diagnostic interval [-0.325, 0.300] (primary available: no).
- Judge agreement: 89 of 160 answers scored exactly equal, 160 within one point, maximum difference 1. High within-one agreement is not proof of judge reliability.
- Calibration labels are weak sanity checks, not judge validation; disagreements are retained, never adjudicated.
- A recorded judge identifier matches the declared main-model id (gpt-6.1-sol). The declaration is not verified against run data. Verify actual model provenance against the pinned protocol and retain the shared-model limitation where applicable; separate sessions do not remove it.

## Context Exposure (Descriptive)

Retrieved-page material reaching actual main-model requests, measured in characters. This is the frozen `rawPageCharacters` measure: descriptive context, not an endpoint and not claim evidence. Record statuses: complete 175, incomplete 5. Totals over the 175 complete record(s): raw page characters 5358719, whole-page-or-long characters 4954091, short-run characters 404628. Short-run exposure means short exact page-text runs (dataset field `quotationCharacters`): a size class only; no justification is judged and no quotation claim is made. Incomplete records leave totals blank and publish recorded observed lower bounds only; an observed lower bound can legitimately be zero. Per-run values are in [tables/runs.csv](tables/runs.csv).

## Omissions and Redactions

The redaction policy, known omissions and their stated reproducibility limits are in [omissions.json](omissions.json). Recorded scrub locations and aggregate dropped-key counts are in [provenance.json](provenance.json). These records are not a field-by-field redaction audit.

## Reproduction

```bash
# Run from a dedicated parent containing only the unpacked bundle, never an existing project:
# the copy commands replace parent manifests.
cp bundle/package.json bundle/package-lock.json . && npm ci
cd bundle
node --import tsx source/study-analysis.ts dataset.json ../analysis-check
node --import tsx source/study-publication.ts verify . ../verify-check
```

Use a dedicated parent directory containing only `bundle/`: the copy commands replace parent manifests, so preserve existing work and choose another parent if that condition is not met. With the loader provisioned, both verification commands are offline: no model call, credential or private session is involved. Compare the runtime and loader versions against `buildRuntime` in [provenance.json](provenance.json). Bundle verification does not certify script-free provisioning: provisioning and its dependency hooks remain separate from the offline analysis commands. The recorded pair identifies the build tooling, not a complete compatibility matrix; if loading fails, check runtime versions and loader provisioning against that record. See [README.md](README.md) for the bundle layout, the column dictionary and the provisioning separation.

## Non-Claims

> Reported pipeline cost is not an account-debit audit. Subscription usage is not cash spend. No superiority conclusion follows from token usage alone. The only arm is retained in the inventory but is not analysed in this version.

Any `only`-arm runs remain in the inventory but are excluded from the off/on analysis.

Replay timing is not live latency; primary estimates and claims are computed separately for replay and live tasks. Claims apply only to this build, host and declared task population. The renderer labels development and pilot partitions diagnostic-only; measured-series claim states depend on the dataset's declared partition and analysis gates, and the exporter does not verify independent collection or final-publication readiness.
