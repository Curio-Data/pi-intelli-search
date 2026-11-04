# Codemode Research Plan

Revision: `research-first-1`. Scope and spending authority: [Owner Decisions](OWNER-REFOCUS.md), 2 November 2026. Start from [Resume](RESUME.md). The purpose is to establish when Codemode benefits users of `intelli-search`, with evidence suitable for publishing and promoting the package where the findings support that use. The comparison must remain fair; no benefit is established yet.

## Completion

The branch is complete only when all five deliverables exist:

1. Working experimental code for the same-build off/on comparison, with relevant deterministic and actual-host tests.
2. A completed measured series on a declared question population, with failures, incomplete observations and spend retained.
3. A durable dataset containing the inputs, outputs, metadata and quality assessments needed to audit the claims.
4. Analysis code that regenerates every published table and figure from the frozen dataset without another model call.
5. A publication-ready report stating the measured effects, uncertainty, useful workflows, costs and limitations, with independently checked links from claims to data.

A pilot, synthetic replay, a green test suite or a package release is not a substitute. A scientifically inconclusive result is reportable; a missing measured series or unreconciled data is unfinished work. Do not promise superiority before measurement. Main-package integration is a later owner decision if the benefits justify it.

## Comparison

The primary comparison is Codemode off against Codemode on on the same experimental build and pinned host. Use the models in Owner Decisions. Keep task intent, available evidence, page allowances, pipeline settings, model settings, final-answer budget and starting cache state matched. Record differences in declarations, guidance, script output and routing explicitly. Include the cost of the script and Codemode instructions in the main-model totals.

Cover at least these workflow types: one self-contained research call; multi-angle or breadth research; a manual search/fetch/extract/collate workflow; and research followed by a cache follow-up. The single-call case is a control, not the only population. Manual off/on runs need equivalent underlying fetching and extraction capabilities; making page fetching available only to the on arm would confound that comparison. Define and test the matched direct interface before claiming a mode effect.

Use the names `off`, `on` and `only` in new run records, with an explicit mapping to the old method's A2, B and C. Old A0/A are historical engine baselines, not required new comparison arms. No structured-output ablation arm is commissioned.

For the manual comparison, use a branch-only experimental registration of the same core fetch operation: directly callable in `off`, callable inside scripts in `on`. Keep operation semantics, result data and limits identical, and declare the exposure difference in the protocol. This experimental entrypoint need not change the package's production registration, the script-only shipping design in the old contract or its historical non-activation tests. A versioned protocol plus focused implementation tests/review is sufficient for this research seam; the later integration decision determines the shipping API. Do not weaken the matched comparison merely to preserve a release-only exposure rule. Freeze one capability-matched tool catalogue per arm for every workflow in both replay and live populations: direct fetch remains available throughout `off`, and script fetch throughout `on` and `only`. Count the resulting declaration differences in the measured main-model input, including the single-call control; do not change the catalogue secretly by task.

Codemode-only mode is a secondary comparison, not a replacement for the off/on pair. Separate deadline tuning and query-expansion experiments are parked. Their existing capabilities may be used with identical settings in both arms. Do not require a package release or a separate old-versus-new engine study before this comparison.

Use two separately reported populations:

- **Controlled Replay:** prescribed workflows receive the same recorded pipeline model, page, catalogue and suggestion responses through the real wrappers and Codemode bridge. Only identified main-model inference remains live. A missing recording stops that block; it never falls back to a real pipeline request. This measures context and orchestration effects under matched evidence, not production network latency.
- **Live Tasks:** prompts express the task without dictating a tool name. Record what the model actually chooses. An on-arm session that chooses direct tools stays in that arm. Interleave paired runs and record order, failures and service variability. These observations establish practical behaviour separately from replay.

Do not pool these populations or use replay timings as a live speed claim. Record intentional serial/parallel schedules; do not silently change one arm to obtain a pass.

## Measurements

Record actual requests sent to the main model, not merely all events printed in a transcript. Keep main-model and research-pipeline usage separate and count each underlying attempt once. Parent/nested summaries and cumulative stream updates are not additional usage.

| Measure | Required Record |
|---|---|
| Main-Model Usage | Reported input and output tokens; observed cache components; missing-field indicators; per-request and per-task totals |
| Context Exposure | Raw page material reaching actual main requests, including arguments, results, script output, errors and spill-file reads; justified quotations identified separately |
| Answer Quality | Fixed task rubrics checked against captured sources; blinded scores from both judges; a disjoint human-checked calibration sample; disagreements retained |
| Time and Reliability | Task start/end, summary-ready and settled times where available; successful, degraded, failed and cancelled outcomes; script errors, retries and turns |
| Pipeline Work | Queries and arguments, attempted/fetched/extracted/used pages, source identities, deadlines, late work and all model attempts |
| Spend | Provider-reported charges, estimates and their price/date basis, unknown charges and pending exposure; subscription usage separately |

### Token Recording Before the Study

The collector exists in `scripts/benchmarks/main-usage-evidence.ts`, but live usage-field coverage on the selected main is not yet proved. First exercise one bounded metadata check on the pinned host and confirm correlation between actual provider fields and saved canonical messages. This is a measurement prerequisite, not another security investigation.

Freeze the primary token definition before comparing outcomes. Report observed total main input in all cases where available. Report uncached input only when the provider fields or a documented provider-specific accounting rule establish it. A missing cache-write field is not automatically zero. If the old uncached-input hypothesis is not measurable, document that limitation and declare an observable primary endpoint in the new protocol before the paired series; do not silently replace it after seeing the result. Keep the original hypothesis's disposition visible. Document provider-specific derivations separately from the unchanged raw observations and generic parser output. Declare and review that measurement rule in the new protocol; this does not require reopening the frozen historical contract. Surface a proposed claim change to the owner before collecting the affected comparison, not on every metadata check. The 50% threshold is not a branch-completion requirement.

### Run Metadata

Each run records: run/task/repeat/arm identifiers; experimental purpose and partition; source commit and dirty-state refusal; host, executable, loaded dependency paths/versions and lockfile hashes; model/provider identities; effective settings and tool catalogue; prompt/script/guidance/rubric hashes; order and seed; initial cache and fixture identity; response/operation/attempt correlation; exact timestamps and outcomes; usage completeness; costs; and paths/hashes of every retained artefact. Use the existing observation and replay libraries rather than replacing them with an unrelated harness.

Preserve raw reported values as well as normalised values. Failed, invalid and cancelled runs stay in the dataset. A technical rerun gets a new identity and a reason; it does not overwrite its predecessor or create an unreported smaller sample.

## Sampling and Quality

The old corpus has development, pilot, held-out and reserve partitions, but its small primary comparison is not enough to justify a broad conclusion. It also lacks prescribed manual and follow-up populations. Keep those original files and exposure labels unchanged. Create a new versioned corpus/protocol for this study, retaining suitable questions with their provenance and adding representative fresh questions before capture.

Use the pilot to estimate cost and variability, then freeze the independent measured-series design: task population, repeat counts, stopping rule, paired/randomised order, meaningful quality-loss margin, uncertainty calculation, missing-data handling and intended claims. Repeated answers to two questions are not evidence about many independent user needs. Do not tune on the final population, relabel exposed questions as unseen, or treat two judges as two independent task samples.

The chosen main is also one judge. Include a human-calibration task in the Step 1 schedule: the coordinator prepares a small disjoint sample with captured source evidence and asks the owner or an owner-designated human to check its labels before judge calibration and final-series scoring. Specify the sample size and coverage rationale in that schedule; proposed labels in the old calibration file are not human approval. Arrange this human time early rather than discovering the dependency after paid runs. Use fresh blinded judge sessions and balanced answer order; analyse both judges separately and disclose the shared-model limitation. Inspect important disagreements rather than selecting the more favourable score. The report must distinguish a small effect, no demonstrated effect and insufficient precision.

## Budget

The existing USD 30 programme ceiling and prescribed model roles are authoritative in Owner Decisions. Prepare a simple costed run schedule and append-only spend record before paid capture. Include recording, pilots, measured runs, retries, failed calls and any paid quality work. For the first spend entry, conservatively include all known OpenRouter charges and retained unknown-charge exposure from this branch's programme, separating study and historical engineering expense. Start from [the terminal-tranche record in Development](DEVELOPMENT.md#m4-scenario-12-through-15-terminal-tranche), its linked immutable record, and the earlier regression/tranche records it carries. Count each original invocation once, not every copied or carried ledger row; do not sum whole historical ceilings. Never reopen old ledgers. This bounds the remaining allowance without assuming that old engineering charges were excluded.

Use expected and conservative per-run costs to admit the next batch within the remaining ceiling. Update the forecast with observed costs after the pilot. Do not build another authority/preparer framework, ask for approval for every small call, or silently increase the allowance. If the remaining budget cannot support the declared claim, report the achievable precision and obtain an owner decision before expanding or weakening the final design.

## Work Sequence

| Step | Work | Exit Evidence |
|---|---|---|
| 1. Measurement Preparation | Pin the actual host/runtime; confirm main usage fields; design the matched manual interface, new corpus/protocol and costed schedule | A reviewed experimental specification with observable metrics, no capability confound, known remaining budget and a concrete runner design |
| 2. Experimental Integration | Connect structured native results, script fetch, matched direct fetch and bounded examples; complete recording/runner/analysis integration using existing libraries | Deterministic tests and a bounded actual-host off/on comparison with complete saved observations; no claim of user benefit from this check |
| 3. Pilot | Run representative development/pilot tasks, examine quality-calibration disagreements, costs and variability | Retained pilot data and a frozen independent measured-series plan that fits the budget |
| 4. Measured Series | Execute paired replay and live populations under their declared methods, retaining every outcome | Complete run inventory, reconciled usage/spend, source-backed quality scores and explicit missingness |
| 5. Publication Package | Generate tables/figures/report, sanitise shareable artefacts, verify claims and reproduce the analysis independently | The five completion deliverables above; an evidence-based recommendation on whether main-package integration is worthwhile |

Steps 1 and 2 may share a bounded implementation cycle. Use parallel agents only for disjoint implementation or review tasks. Keep one owner for central native registration and one validation lane. An independent reviewer checks the experiment and final claims; reviews must not expand into unrelated release or security work.

## Evidence and Reproduction

Write durable raw study data directly under `evidence/benchmarks/<series-id>/`. This location is ignored by Git and does not travel in a clone. Disposable scratch alone may use `.tmp/`; promote anything needed for a result before citing it. Preserve historical evidence by default. User-requested consolidation, archival or deletion follows [Repository Folders](../../../AGENTS.md#repository-folders), with the scope, retained material and consequences for citations, manifests, reproducibility and recovery explained before approval. Record any approved disposal without changing historical outcomes or implying that removed evidence remains available locally.

The publication deliverable needs a versioned shareable bundle in addition to private raw files. Include task inputs/rubrics, prompts/scripts/settings, per-run metrics and completeness, final answers and judge outputs where shareable, provenance manifests, analysis source, environment pins, and exact commands to regenerate tables and figures. Retain full private source snapshots for audit; share fetched material only where redistribution is appropriate. Document every omission/redaction and its effect on reproducibility. No credentials or private session data belong in the public bundle.

A fresh environment must reproduce the published analysis from that bundle without model calls. A separately documented live rerun may produce different answers or search results; reproducibility does not mean promising identical remote-service outputs. If material needed to check a claim cannot be shared, disclose the limitation and narrow the claim or choose shareable fixtures before the measured series.

## Validation and Boundaries

Build, deterministic native/standalone tests, types and applicable documentation generators remain required for changed code. Use owned encrypted scratch. Run the new study runner's readiness checks before spending. Preserve operation settlement and credential hygiene; do not copy refresh chains or print secrets.

Do not run the old paid scenario suite, stopped helpers, monitor candidates or old-host installers as automatic gates. They are historical release evidence, not the experiment driver. A known dependency advisory remains disclosed, not repaired in this workstream; an encountered question goes to the owner for a version/risk choice. No security scan or investigation is commissioned by this plan.

`npm run check:codemode-plan` still verifies the unchanged historical contract, types, corpus and acceptance objects. It is a preservation check, not approval of this study or a requirement to execute the old phase order. Keep its old files intact. Freeze the new protocol and inputs separately before capture, and validate their manifests in the study runner. Changes to public interfaces, if genuinely needed, require an explicit implementation/specification change rather than weakening a type assertion.

## Integration After Research

Do not merge into the main package, bump release versions, stage packages or publish them as part of this research approval. After the report, the owner decides whether the measured benefits justify integration. Only then assess older hosts, feature gates, compatibility-layer retirement, packaging and release checks. The interactive progress display may be developed later if it is not needed to interpret the measured runs.
