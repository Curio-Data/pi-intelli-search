# Codemode Study v1

Versioned protocol, corpus, calibration packet, costed schedule and spend baseline for the research-first Codemode `off`/`on` comparison. Authority: [Owner Decisions](../../plans/codemode/OWNER-REFOCUS.md), [Research Plan](../../plans/codemode/RESEARCH-PLAN.md), [Resume](../../plans/codemode/RESUME.md). Status: pre-pilot integrated-driver candidate. Current execution outcomes are recorded in [Status](../../plans/codemode/STATUS.md); no measured-series benefit is claimed.

## Files

| File | Role |
|---|---|
| [PROTOCOL.md](PROTOCOL.md) | Study protocol: arms and frozen catalogue (built-in read in every arm), workflows, populations, measurements and endpoints, sampling, judging, canonical admission, stopping rules, pending prerequisites |
| [corpus.json](corpus.json) | Corpus `corpus-v1-r3`: 32 concrete named tasks across `single`, `breadth`, `manual`, `followup` workflows and four partitions, with provenance and exposure labels |
| [manifest.json](manifest.json) | Manifest with hashes binding this revision's inputs |
| [calibration.json](calibration.json) | Four disjoint synthetic calibration cases, one per workflow; calibration only, never live research results; approval needs explicit usable verdicts for all four IDs |
| [CALIBRATION-REVIEW.md](CALIBRATION-REVIEW.md) | Original sanity-check procedure; the owner's verdicts and criticism are now recorded |
| [RUNNER.md](RUNNER.md) | Executable driver, bounded admission, capture/replay and offline analysis commands |
| [SCHEDULE.md](SCHEDULE.md) | Costed phase schedule with the canonical admission rule and stopping rules |
| [SPEND-BASELINE.json](SPEND-BASELINE.json) | Machine-readable deduplicated reconciliation of the branch's historical OpenRouter expense and pending holds (`spend-baseline-3`), citing durable evidence copies |

## Relationship to Frozen Historical Material

The old corpus, methods and manifests under [`docs/benchmarks/corpus/`](../corpus/) and [`docs/benchmarks/codemode/`](../codemode/) are unchanged historical inputs; their hashes and exposure labels are never rewritten. This study retains two old development questions with their exposure recorded (see `oldCorpusRelationship` in the corpus), composes fresh questions for everything else, and adds the manual and follow-up workflow populations the old corpus lacked. The old calibration items J-01 to J-04 remain as they were; this study's calibration packet is separate and disjoint.

## Spend Position

Known engineering expense USD 0.545984786 across 36 deduplicated invocations; pending holds USD 1.5 with unknown actual charges, held for admission rather than released; remaining under the USD 30 ceiling's conservative bound USD 27.954015214. The evidence copies backing these figures are promoted under `evidence/benchmarks/spend-baseline-20261102T152129Z/` with hashes; the baseline never cites scratch locations.

## Pending Prerequisites by Phase

| Prerequisite | Required Before | State |
|---|---|---|
| Independent review, then bounded `CS-DEV-01` verification | Remaining development and pilot work | The first capture, replay pair and live pair produce the verification observations after review and passing gates; current results are in Status |
| Independent source-backed quality scoring | Quality claims | The owner labelled all four sanity checks and criticised their triviality. Labels are recorded in `evidence/benchmarks/codemode-study-v1/calibration/decisions.json`; judge reliability is not established |
| Post-pilot series freeze (manifest `measured-series-1`: margins, final size, stopping rule) | Measured-series capture only | Pending; the pilot itself is paid work that precedes the freeze |
