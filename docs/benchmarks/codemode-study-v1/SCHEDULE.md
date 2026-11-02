# Codemode Study v1 Costed Schedule

Revision: `schedule-v1-r4-prepilot`. Status: driver-integration schedule; measured-series admission remains pending. Cash figures are [OpenRouter](https://openrouter.ai) pipeline forecasts in United States dollars (USD), not charges. Authority: [Protocol](PROTOCOL.md), [SPEND-BASELINE.json](SPEND-BASELINE.json), owner decision D5.

## Budget Position

| Item | USD |
|---|---:|
| Programme ceiling | 30.000000000 |
| Known engineering expense (36 reconciled invocations) | 0.545984786 |
| Pending holds (window 15 reserve 0.50; mcp-wiring hold 1.00; actual charges unknown) | 1.500000000 |
| **Remaining under the conservative bound** | **27.954015214** |

The table is the historical starting balance, not a live account statement. Subsequent study charges and holds are appended to `evidence/benchmarks/programme-spend/spend-ledger.jsonl`; subscription usage is reported separately. [Runner](RUNNER.md) describes the executable admission checks.

## Cost Basis

Per-execution pipeline forecasts start from the reconciled programme distribution (n=36 invocations: min USD 0.00535, median 0.0110, mean 0.0152, p75 0.0193, max 0.0466; Observed). The conservative column is an **assumption**, not a proven bound: it applies a 2.5x multiplier to the expected value with a per-constituent-call floor at the observed maximum. The observed max-to-median ratio is approximately 4.2, above the multiplier, which is why the floor exists and why the admission rule below governs every paid phase. The pilot re-derives these forecasts from observed study costs before the measured series is admitted.

| Workflow | One Live Execution, Expected | Conservative (Assumption) | Composition Basis |
|---|---:|---:|---|
| single | 0.020 | 0.050 | one research, 4 attempted pages |
| breadth | 0.060 | 0.150 | three constituent research calls (floor 3 x observed max) |
| manual | 0.050 | 0.125 | two searches, four fetch/extract, one collation |
| followup | 0.030 | 0.075 | base research, report read, follow-up answer |

Replay executions carry no pipeline cash: recorded responses are replayed through the real wrappers, and only the main model (subscription) runs live. Fixture capture for a replay task is one paid live execution.

## Canonical Admission Rule

This is the single admission test for all paid work in this study; the protocol references it and adds no second test.

> Requested work is admitted when: known committed spend to date, plus all outstanding pending holds, plus the conservative cost of the requested work, plus the conservative cost of every remaining planned phase, is less than or equal to the USD 30 ceiling.

Batch admission inside a phase uses the same comparison, with "every remaining planned phase" meaning the unexecuted remainder including the rest of the current phase. Expected cost never substitutes for conservative cost in admission; observed cost is used only by the mid-phase stopping rule. Historical and unresolved-charge holds are never released by prose: they remain counted until reconciled. A completed run releases the unused portion of its reservation only against its retained dispatch and reported-charge records.

## Phases

| Phase | Work | Paid Live Executions | Replay Executions | Expected USD | Conservative USD |
|---|---|---:|---:|---:|---:|
| 0. Measurement preparation (done) | Spend baseline; one metadata observation | 0 | 0 | 0 | 0 |
| 1. Human Sanity Check | Owner verdicts are recorded for all four synthetic cases. The owner criticised their triviality; no judge reliability is established and no repeat review is requested | 0 | 0 | 0 | 0 |
| 2. Development Capture and Live Check | Four workflow captures plus one off/on live pair on `CS-DEV-01`; the pair is integration evidence, not a measured-series result | 6 | 0 | 0.200 | 0.500 |
| 3. Pilot | 8 tasks × 2 primary arms × 2 repeats live (32 paid executions); pilot replay smoke on the 4 development fixtures × 2 primary arms × 1 repeat = 8 replay executions (no pipeline cash) | 32 | 8 | 1.280 | 3.200 |
| 4. Series freeze | Post-pilot review; freeze margins, size and stopping rule in manifest `measured-series-1`; re-derive cost forecasts | 0 | 0 | 0 | 0 |
| 5. Measured series | Replay population: 12 captures (paid) plus 12 tasks × 2 primary arms × 2 repeats = 48 measured replay executions (no pipeline cash); live population: 12 tasks × 2 primary arms × 2 repeats = 48 paid executions | 12 + 48 | 48 | 2.400 | 6.000 |
| 6. Reserve for retries and unknown-charge events | Modelled reserve, not a proven bound; sized on the programme's observed failure pattern (window 15 precedent) | n/a | n/a | 0.300 | 1.000 |
| 7. Analysis and publication package | Regeneration without model calls; judge sessions are subscription | 0 | 0 | 0 | 0 |
| **Totals** | | 98 paid | 8 smoke + 48 measured | **4.180** | **10.700** |

The `only` arm is not scheduled: no `only` execution is budgeted in this costed primary series. Scheduling it requires a schedule revision admitted under the canonical admission rule above.

Under these forecasts and the historical holds, the schedule leaves USD 17.254015214 of the ceiling before subsequent study charges. The executable phase forecasts are in `STUDY_PHASE_FORECAST` and `STUDY_REMAINING_PLANNED_USD` in `study-design.ts`. Admission uses a larger per-run reservation of USD 0.50 per allowed model attempt, plus the remaining-phase forecast. Affordability remains conditional on reported charges, retained unknowns and pilot costs; neither forecast nor hold is a guaranteed billing bound.

## Uncertainty and Stopping Rules

1. Unknown charges: each dispatched attempt without a reported charge retains USD 0.50, and further paid batches stop. An unresolved crash reservation also blocks a new paid batch. The driver does not infer zero or clear these stops automatically.
2. Mid-phase check: at the halfway execution of each paid phase, observed cost above three times the phase forecast stops the phase; partial data and the stop point are reported.
3. Forecast update: after the pilot, per-execution forecasts are re-derived from observed pilot costs; the measured series is admitted against the updated numbers, not these.
4. No cross-phase borrowing: a cheap pilot does not authorise a larger series without a schedule revision.

## Human and Subscription Time

| Item | Estimate | Cash |
|---|---|---:|
| Human sanity-check review | Completed; elapsed human time was not measured | 0 |
| Judge sessions (both judges, pilot and series) | Subscription; usage reported separately | 0 |
| Coordinator and reviewer sessions | Subscription | 0 |
