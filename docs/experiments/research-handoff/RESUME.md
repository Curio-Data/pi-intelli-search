# Research Handoff Resume

## Current State

The owner-requested ten-pair `rh-v8` suite is complete, graded, financially settled and reproduced offline. Start with [Ten-Pair Study Findings](SUITE-FINDINGS.md) for the result and [Suite Protocol](SUITE-PROTOCOL.md) for the accepted method. No further collection is authorised by this completed request.

The runner supports configurable pair counts and bounded concurrent pairs through an immutable plan. The measured implementation is commit `63abcd4`, source digest `441fc18b7bf62403e139de0e06dc54c190289afaeb39fa401377ca7da7a3b86f`; the protocol digest is `fc529eba1e38036843936ac47b3aa64246e473a877e2156ed4ffe01285af3e25`. The [acceptance](../../../evidence/agents/20261108T152419Z-full-suite/implementation-acceptance.json) binds the [plan](../../../evidence/agents/20261108T152419Z-full-suite/study-plan.json), owner directions and independent reviews.

## Retained Evidence

Continue in the existing `study/research-handoff-runner` worktree. Dependencies and ignored scientific evidence are provisioned here and do not travel with a clean clone.

- [Full-population inventory](../../../evidence/benchmarks/research-handoff/20261108T152419Z-rh-v8-suite/analysis/suite-inventory.json): every scheduled conversation, record, machine check and gate.
- [Paired analysis](../../../evidence/benchmarks/research-handoff/20261108T152419Z-rh-v8-suite/analysis/suite-analysis.json): quality, tokens, charges, timing, concurrency and incidents.
- [Settlement](../../../evidence/benchmarks/research-handoff/20261108T152419Z-rh-v8-suite/settlement-receipt.json): reconciled known charges and the cumulative ceiling.
- [Machine review](../../../evidence/agents/20261108T152419Z-full-suite/reports/paid-machine-review.md): independent transmitted-return, concurrency and financial checks, including the provenance-validator false rejection.
- [Gate verification](../../../evidence/agents/20261108T152419Z-full-suite/gate-verification.json): all answer gates recorded before settlement.

The root `.search` is absent. All per-run output caches, previous series, the archived root cache and scratch remain preserved. Nothing should be deleted or copied into a new measured workspace. No package integration, release, main merge or cleanup is assigned.

## Offline Reproduction

Run from the checkout root. The output directory must not exist; the reproduction checks source identity before analysing and uses no credentials or network. A later source change requires the accepted implementation for reproduction rather than rebinding the old evidence.

```bash
set -eu
mkdir -p .tmp
WORK=$(mktemp -d "$PWD/.tmp/rh8-reproduction.XXXXXXXX")
export TMPDIR="$WORK"
node --import tsx --input-type=module <<'JS'
import { sourceIdentity } from "./scripts/research-handoff/storage.ts";
if ((await sourceIdentity(process.cwd())).digest !==
    "441fc18b7bf62403e139de0e06dc54c190289afaeb39fa401377ca7da7a3b86f") {
  throw new Error("Source differs from the accepted suite");
}
JS
ROOT="$PWD/evidence/benchmarks/research-handoff/20261108T152419Z-rh-v8-suite"
PLAN="$PWD/evidence/agents/20261108T152419Z-full-suite/study-plan.json"
node --import tsx scripts/research-handoff/cli.ts \
  rh8-analyse "$ROOT" "$PLAN" "$WORK/analysis"
cmp "$ROOT/analysis/suite-inventory.json" \
  "$WORK/analysis/suite-inventory.json"
cmp "$ROOT/analysis/suite-analysis.json" \
  "$WORK/analysis/suite-analysis.json"
printf 'Reproduced; scratch retained: %s\n' "$WORK"
```

## Future Studies

`run-study --pairs N --parallel-pairs K --budget-usd X` prepares a plan when supplied with its new root, owner direction and output path. It is not a command that bypasses acceptance or starts paid work by itself. The [protocol](SUITE-PROTOCOL.md#study-plans) defines the supported bounds, direction schema and complete gate sequence. Shared conservative reservations can reduce concurrency while preserving the spending ceiling.

For an accepted future series, use one controller, grade only after collection, prepare exactly one neutral review bundle, and assemble gates serially. Before settlement, confirm collection is complete, stopped or explicitly closed and that every collected answer has its gate. Settlement permanently closes authority-bound commands, including grading. Inspect the settlement's `reconciled` field as well as its liabilities.

The package's general live test suite is not this experiment. Implementation checks remain `npm run test:all`, `npm run test:handoff`, `npm run typecheck:handoff`, the review-preflight tests and the applicable builds and generators. Paid calls require current owner scope and fresh bound identities.

## Historical Records

[Full Study Suite Handover](FULL-SUITE-HANDOFF.md) records the incoming assignment, now fulfilled. [Repeat Findings](REPEAT-FINDINGS.md) records the earlier single clean pair. [Continuation Findings](CONTINUATION-FINDINGS.md), [Pilot Findings](PILOT-FINDINGS.md) and [Findings](FINDINGS.md) retain the earlier outcomes. Their roots, claims, grades and financial receipts remain closed and unchanged. Results from those different series are not pooled into the current comparison.
