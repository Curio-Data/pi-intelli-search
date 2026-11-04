# Codemode Study Closure

The owner closed the Codemode investigation on 4 November 2026 and approved retirement of the `codemode-research` worktree after compact preservation. The branch `feat/codemode-research` remains the source and archival record. No main-package integration, release or further paid experiment follows from this closure.

## Result

The [final measured report](../../benchmarks/codemode-study-v1/REPORT.md) records a completed but inconclusive study. It does not demonstrate a Codemode benefit or establish preserved answer quality. Both primary token analyses and both primary quality analyses are unavailable under the frozen missing-data rules. Complete-case diagnostics do not show a token saving. The report recommends against main-package integration on this evidence.

The frozen design executed 160 comparative runs across 20 tasks, two arms, two repeats and two populations, plus 20 fixture captures. Replay produced 66 completed and 14 aborted runs; live execution produced 70 completed and 10 failed runs. Nine failed live runs delivered settled answers and remained valid task outcomes under the owner rule. One live run had no finished answer or usage.

The final report, methodology and original outcome counts are retained without changing historical verdicts. This closure is a scope and retention decision, not a new experimental result.

## Preserved Record

The branch contains:

- Experimental implementation, study driver and deterministic tests already present at commit `b330750d2b771007372c59ce2a220c17c1da16e9`.
- The frozen protocol, corpus, judging procedure, calibration inputs and measured-series design under `docs/benchmarks/codemode-study-v1/`.
- The final report and [measured-v3 publication bundle](../../benchmarks/codemode-study-v1/measured-v3/), including the sanitised dataset, analysis source, answers, judge outputs, tables and figures.
- The [fresh-environment reproduction record](../../benchmarks/codemode-study-v1/measured-v3-reproduction.md).
- A [compact spend reconciliation](../../benchmarks/codemode-study-v1/spend-reconciliation.json) with the original ledger identity and aggregate accounting limits.
- [Cache-growth qualification records](../../benchmarks/cache-growth-qualification/) needed to inspect the summaries, observations and environment records cited by current documentation.
- A [historical source patch](archive/) preserving the previously uncommitted M4 source changes against their recorded base commit.
- The cleanup records and this closure note.

The final report and publication bundle originated on `study/integration` at commit `302ecea5e4725dc8ca908c24ef51dde11c0b377b`. They were copied onto this branch without merging that branch or changing its worktree. The measured-v3 manifest SHA-256 is `583f0aaa5266e5ff3783fec400565b4062cd01bcd5fb35ebfd761f676439c48d`; its sanitised dataset SHA-256 is `1c5d1ce1193bca80f27625d80defa02b8ace79e02890e64cf3127266c39f1901`.

## Reproduction Boundary

Follow the [public bundle instructions](../../benchmarks/codemode-study-v1/measured-v3/README.md) to regenerate the numerical analysis without model calls. The bundle includes its analysis and verification source. Do not use the original private-evidence build commands as an archival reproduction path.

The owner approved disposal of the original ignored results during retirement. This includes raw benchmark sessions, request captures, replay fixtures, judge packets, execution receipts, the original programme ledger, historical monitor evidence, retained M4 archives and source checkout, agent scratch, test authentication profiles, dependency installations and caches. Failed and incomplete observations remain represented in the shared dataset and analysis; their original private artefacts are not selectively retained.

After retirement, numerical tables and figures remain reproducible from the committed bundle. Independent verification against the original raw requests, captured pages, judge evidence, run manifests and spend-ledger rows is no longer possible. The original M4 snapshot's installed environment is not retained; its source changes survive only as the recorded patch. These are deliberate reproduction limits, not claims that the original evidence remains locally available or recoverable from a verified backup.

The two earlier cleanup records describe material already removed before this closure. Their links into ignored evidence are historical references, not live archival paths. Current qualification links resolve to tracked records. No external backup or restore is assumed for the deleted originals.

## Worktree Retirement

Before removal, incoming dependency links in five related worktrees are replaced with independent copies, preserving those worktrees and their uncommitted work. The `codemode-study-integration` evidence link is replaced by a small directory pointing to its committed report and bundle; that worktree no longer depends on this worktree's ignored evidence for numerical reproduction.

No tracked file in the main checkout is modified as part of retirement. No other worktree or branch is removed. The final durable retirement inventory is retained under the main checkout's ignored `evidence/codemode/` directory; it is an administrative receipt, not an input to study reproduction.
