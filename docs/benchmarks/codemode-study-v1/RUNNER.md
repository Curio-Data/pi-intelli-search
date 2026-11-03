# Study Runner

Revision: `runner-v4`. The driver executes the branch-only experiment on pinned `Pi` 1.4.0. It is not the historical end-to-end harness or a release gate. `scripts/benchmarks/study.ts` is the entrypoint; `study-runner.ts` owns one actual session, and `study-transports.ts` captures or replays the pipeline beneath its real policy and accounting.

## Execution Scope

The current driver admits development and pilot inputs only. It refuses measured-series and reserve tasks until the independent measured-series design is frozen. Codemode-only runs remain unscheduled. Development capture covers the four declared workflows; the additional development live check is one off/on pair on `CS-DEV-01`. Broader live questions belong to the pilot. Repeated cells are refused unless a single-arm technical rerun names its predecessor and reason; reruns remain outside primary paired cells. A source correction requires a new series. Use `--rerun-series`, `--rerun-of` and `--rerun-reason` to link that technical attempt to the retained predecessor in its original series; neither series resets the programme ledger.

One immutable series identity binds the source commit, lockfile, design and model definitions. A dirty checkout or changed series identity refuses before inference. The native extension's value imports resolve to the selected host release, not the older development peers. The driver records loaded module paths, normal registry model definitions and observed response identities. Credentials resolve through the host normally; no login files or refresh chains are copied. `PI_OFFLINE=1` disables catalogue refresh, not inference: definitions come from the installed catalogue and existing agent configuration, rather than a fresh personalised catalogue. The prescribed search model must already be registered there; the study does not modify `models.json`. `--check` reports model presence and the definitions retained for comparison.

Both arms start from an empty workspace at the same physical path. A run copies that workspace into durable evidence before removing its own scratch. A crash leaves the workspace and reservation for inspection; a new invocation never silently deletes either. The tool catalogue remains fixed across workflows. Codemode's classifier/image-model namespace is disabled, so the script arm gains no extra inference capability outside the comparison.

## Matched Settings and Limits

`studyPipelineSettings()` and `createStudyPlan()` in `scripts/benchmarks/study-design.ts` are the executable settings reference. Every run saves their values. Both arms use the prescribed models, the same extraction and collation token limits, bounded page content, one pipeline attempt per model call, and disabled documentation-file discovery. This is a declared experimental profile, not a comparison of untouched package defaults. The main agent uses low reasoning, server-sent events, no automatic retry or cache warming, and the same 500-word final-answer instruction. Discovered skills, extensions, prompt templates and context files are disabled. Live tool choice is unforced within the supplied catalogue and instructions; automatic skill discovery and the ordinary personalised agent environment are not evaluated.

The guard counts model attempts immediately before pipeline dispatch, including any retry, and counts direct and nested tool calls at the same host hook. Research reserves its requested page allowance; manual fetch reserves one page. Reservation is not returned when fewer pages succeed. A script must declare finite time and output limits. The host's main-request hook cannot reject a request by throwing, so a limit breach requests cancellation and may admit one final subscription request; that request and any missing usage remain recorded. The pipeline guard rejects before its paid dispatch. Attempt-budget exhaustion in an unforced live task is a reportable outcome of this bounded profile, not automatically a driver defect or a Codemode failure.

The driver records model admission before dispatch and settlement afterwards in a durable per-run journal. These records supplement, rather than replace, authoritative native attempt receipts. The raw request observer records only actual main-request payloads; nested tool-event traffic is retained separately and is not counted as main context exposure.

## Spend

The single programme ledger is `evidence/benchmarks/programme-spend/spend-ledger.jsonl`, shared across series. Its initial row binds the unchanged historical baseline. Ordinary opens require it to exist; creating another series never resets spend. An unresolved active reservation blocks a new paid batch. The ledger and raw evidence must survive any worktree retirement. Accounting and phase preflight run before taking the workspace lock. An actual crash can leave an active reservation and `.active` lock; there is no automated recovery command in this candidate. Stop for reconciliation from retained dispatch records, without editing ledger history, deleting evidence or treating an unknown charge as zero.

Before each paid run, the driver holds USD 0.50 per allowed pipeline attempt and also leaves the conservative remaining-phase forecast available. This per-attempt hold is an admission assumption, not a guarantee about external billing. Known settled charges release the unused reservation; each unobserved attempted charge retains its hold and stops further paid batches. A process crash leaves the full reservation counted. No stop is cleared automatically, and neither baseline hold is released by this driver. The schedule's halfway cost rule is checked against settled programme rows before and after paid runs.

## Commands

Check the pinned host, prescribed model availability and design hashes without model requests:

```bash
node --import tsx scripts/benchmarks/study.ts --check
```

If the managed installation advances while the study remains pinned, select the retained release explicitly. The version check still refuses any other host, and the run records `explicit-root` provenance:

```bash
node --import tsx scripts/benchmarks/study.ts \
  --host-root ~/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent \
  --check
```

Pass the same `--host-root` option to capture, replay and live commands in that source-frozen series. Do not change the managed installation's current-version file to continue a study.

Initialise the programme ledger once, after reviewing the baseline. An existing directory refuses rather than resetting it:

```bash
node --import tsx scripts/benchmarks/study.ts --init-spend
```

After independent review and passing gates, use the following capture, replay pair and live pair on `CS-DEV-01` as the bounded development verification sequence. Inspect those retained outcomes before remaining development or pilot work. The verification sequence itself is permitted to create the observations needed for broader readiness; no earlier live comparison is required.

Capture one prescribed development workflow. This makes paid pipeline requests and subscription main requests:

```bash
node --import tsx scripts/benchmarks/study.ts \
  --series codemode-development-1 \
  --task CS-DEV-01 --mode capture --arm on
```

Use the returned `fixtureBundle` path for the off/on replay pair. Only the subscription main model runs live:

```bash
node --import tsx scripts/benchmarks/study.ts \
  --series codemode-development-1 \
  --task CS-DEV-01 --mode replay --pair \
  --bundle <returned-fixtureBundle-path>
```

Run the separately labelled, unforced live pair:

```bash
node --import tsx scripts/benchmarks/study.ts \
  --series codemode-development-1 \
  --task CS-DEV-01 --mode live --pair
```

Each pair's order is derived from the saved seed, task ID and repeat, not reused unchanged for every task. Global order follows the append-only series inventory. Finalised failed, cancelled and not-started executions remain in that inventory. If evidence finalisation fails, the retained run identity blocks further calls and analysis until reconciliation; it is never silently replaced by a smaller sample. An arm never started after an interruption has no execution row; its declared expected cell remains missing in the offline analysis. There are no automatic paid reruns.

Export diagnostic development analysis without model calls:

```bash
node --import tsx scripts/benchmarks/study.ts \
  --series codemode-development-1 \
  --analyse development
```

The export validates retained run manifests, writes a new dataset snapshot and regenerates `analysis.json` and `effects.csv`. It includes every expected development task, so uncollected cells remain missing. Capture runs stay in the inventory but never enter paired comparison cells. Development and pilot analyses are explicitly diagnostic, not confirmatory; quality scores remain unavailable until independent scoring is integrated.

## Evidence and Limits

Raw data belongs under `evidence/benchmarks/<series>/`. Each run retains identity, prompts, main requests, usage witnesses, tool events, pipeline attempts, final messages, limits, outcomes, workspace copies and integrity manifests. Complete captures include verified model/page fixtures and generated-path suggestion views; failed captures retain their attempt journals without claiming a usable bundle. Replay refuses missing or unconsumed recordings and never falls back to a live pipeline request.

Replay timing is not production latency. Recorded cancellations can yield incomplete replay accounting, and mid-body failures can replay earlier than their original failure point; the original capture remains the accounting witness for those cases. Failed or wire-incomplete comparative cells make their primary endpoint unavailable under the prespecified rule. Observing less input is not evidence of preserved quality or of superiority.

The owner labelled the four synthetic calibration cases and criticised their triviality and uniformly positioned winners. Those labels are retained as sanity checks only. They do not validate the judges; no repeat of that exercise is requested. [Blinded Quality Judging](JUDGING.md) owns source-backed packet preparation, independent judge outputs and offline score ingestion. The publication bundle remains later study work.
