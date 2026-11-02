# Codemode Study v1 Costed Schedule

Revision: `schedule-v1-r3`. Status: reviewed draft for the bounded integration candidate; no phase after the metadata check has run. Cash figures are [OpenRouter](https://openrouter.ai) pipeline forecasts in United States dollars (USD), not charges. Authority: [Protocol](PROTOCOL.md), [SPEND-BASELINE.json](SPEND-BASELINE.json), owner decision D5.

## Budget Position

| Item | USD |
|---|---:|
| Programme ceiling | 30.000000000 |
| Known engineering expense (36 reconciled invocations) | 0.545984786 |
| Pending holds (window 15 reserve 0.50; mcp-wiring hold 1.00; actual charges unknown) | 1.500000000 |
| **Remaining under the conservative bound** | **27.954015214** |

Study expense to date is zero: the only executed observation (the 2 November metadata check) used the subscription main model and no pipeline calls. Subscription usage is tracked and reported separately from cash in every phase.

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

Batch admission inside a phase uses the same comparison, with "every remaining planned phase" meaning the unexecuted remainder including the rest of the current phase. Expected cost never substitutes for conservative cost in admission; observed cost is used only by the mid-phase stopping rule. Holds are never released by prose: they count against admission until an account statement or an owner decision releases them.

## Phases

| Phase | Work | Paid Live Executions | Replay Executions | Expected USD | Conservative USD |
|---|---|---:|---:|---:|---:|
| 0. Measurement preparation (done) | Spend baseline; one metadata observation | 0 | 0 | 0 | 0 |
| 1. Human calibration | Owner review of [calibration.json](calibration.json); explicit usable verdicts for all four case IDs; ≈1 h human time | 0 | 0 | 0 | 0 |
| 2. Development capture | 4 tasks (one per workflow), fixture capture and harness tuning | 4 | 0 | 0.160 | 0.400 |
| 3. Pilot | 8 tasks × 2 primary arms × 2 repeats live (32 paid executions); pilot replay smoke on the 4 development fixtures × 2 primary arms × 1 repeat = 8 replay executions (no pipeline cash) | 32 | 8 | 1.280 | 3.200 |
| 4. Series freeze | Post-pilot review; freeze margins, size and stopping rule in manifest `v1-r4`; re-derive cost forecasts | 0 | 0 | 0 | 0 |
| 5. Measured series | Replay population: 12 captures (paid) plus 12 tasks × 2 primary arms × 2 repeats = 48 measured replay executions (no pipeline cash); live population: 12 tasks × 2 primary arms × 2 repeats = 48 paid executions | 12 + 48 | 48 | 2.400 | 6.000 |
| 6. Reserve for retries and unknown-charge events | Modelled reserve, not a proven bound; sized on the programme's observed failure pattern (window 15 precedent) | n/a | n/a | 0.300 | 1.000 |
| 7. Analysis and publication package | Regeneration without model calls; judge sessions are subscription | 0 | 0 | 0 | 0 |
| **Totals** | | 96 paid | 8 smoke + 48 measured | **4.140** | **10.600** |

The `only` arm is not scheduled: no `only` execution is budgeted in this costed primary series. Scheduling it requires a schedule revision admitted under the canonical admission rule above.

Under the stated forecasts and pending holds, the schedule leaves USD 17.354015214 of the ceiling. Affordability remains conditional on the finite per-call unknown-charge limits still pending in the runner design, on unknown-charge handling during execution, and on pilot costs; it is not a demonstrated result.

## Uncertainty and Stopping Rules

1. Unknown charges: any execution whose charge cannot be read from provider responses is recorded as unknown and held against the allowance. The finite per-call hold limit and the per-batch conservative admission arithmetic for unknown charges are runner-design decisions still pending full session runner integration; until they are fixed, a phase stops on its first unresolved unknown charge rather than continuing on an unbounded assumption. The historical precedent (window 15's USD 0.50 reserve) illustrates one such event, not a general worst case.
2. Mid-phase check: at the halfway execution of each paid phase, observed cost above three times the phase forecast stops the phase; partial data and the stop point are reported.
3. Forecast update: after the pilot, per-execution forecasts are re-derived from observed pilot costs; the measured series is admitted against the updated numbers, not these.
4. No cross-phase borrowing: a cheap pilot does not authorise a larger series without a schedule revision.

## Human and Subscription Time

| Item | Estimate | Cash |
|---|---|---:|
| Human calibration review | ≈1 h (phase 1) | 0 |
| Judge sessions (both judges, pilot and series) | Subscription; usage reported separately | 0 |
| Coordinator and reviewer sessions | Subscription | 0 |
