# Pilot Resume

## Current State

The requested one-shot `rh-v7` end-to-end test is complete and settled. It ran without an operational incident. Both routes passed machine and financial checks, and both answers failed the unchanged quality gate. The baseline failed both initial reviews; the candidate failed after the planned adjudication of a reviewer disagreement. [Repeat Findings](REPEAT-FINDINGS.md) records the result and descriptive measurements.

The workflow is now demonstrated end to end on one clean pair. That establishes neither answer-quality equivalence nor savings. No additional test, repeat or measured batch was run under the owner's request to run the test once. A cleanly collected negative result remains a negative result; do not rerun or relax criteria to turn it into a pass.

## Reading Order

1. [Repeat Findings](REPEAT-FINDINGS.md).
2. [Final inventory](../../../evidence/benchmarks/research-handoff/20261107T195837Z-rh-v7-once/inventory.json), [assessed outcome](../../../evidence/benchmarks/research-handoff/20261107T195837Z-rh-v7-once/assessed-outcome.json), [incidents](../../../evidence/benchmarks/research-handoff/20261107T195837Z-rh-v7-once/incidents.json) and [settlement](../../../evidence/benchmarks/research-handoff/20261107T195837Z-rh-v7-once/settlement-receipt.json).
3. [Repeat Protocol](REPEAT-PROTOCOL.md), the frozen `rh-v7-once-1` contract, and its [implementation acceptance](../../../evidence/agents/20261107T195837Z-e2e-once/implementation-acceptance.json).
4. [Independent implementation and prose review](../../../evidence/agents/20261107T195837Z-e2e-once/reports/review.md), [observer review](../../../evidence/agents/20261107T195837Z-e2e-once/reports/observer-review.md) and [paid machine review](../../../evidence/agents/20261107T195837Z-e2e-once/reports/paid-machine-review.md).
5. [Continuation Findings](CONTINUATION-FINDINGS.md) for the interrupted `rh-v6` pair; [Pilot Findings](PILOT-FINDINGS.md) for the `rh-v5` corpus rejection; [Findings](FINDINGS.md) for the historical `rh-v4` comparison.

## Checkout and Identity

Continue in the existing checkout:

```text
/srv/secure/repos/CURIO/.worktrees/pi-intelli-search/research-handoff-runner
branch: study/research-handoff-runner
```

Commit `3088bd8` holds the accepted `rh-v7` implementation. Its acceptance binds code digest `02c7f60afc442de3f7166c77bf711618067c6ec2ccc07f031e5833559df93012` and protocol digest `5a8f1690df39df5f2dd583915343c8830560790d2622279bd8f0396925221add`. The close-out changes current notes, which are outside `sourceIdentity`. The expected handover state is committed and pushed on `study/research-handoff-runner`, with a clean `git status --short` and ignored evidence retained. Investigate unexpected changes rather than resetting or rebinding a closed series.

The evidence is gitignored and exists in this worktree, not in a clean clone. Preserve the checkout, dependencies, all earlier series and scratch. No cleanup, package integration, publication, version bump or main merge is assigned.

## Completed Scope

The [latest owner direction](../../../evidence/agents/20261107T195837Z-e2e-once/owner-direction.json) commissioned one fresh matched pair. That request is fulfilled. The single-series root is settled and cannot be reused; remaining allowance and consumed claims are not new dispatch authority.

The comparison used direct `intelli_research` and Codemode, the `Pi` JavaScript tool interface, with the same captured search and twelve page texts from `rh-v6`. Extraction and collation were live. Answer grading followed both paid conversations, eliminating review delays between arms. The corpus review was explicitly reused because its inputs and rubric were unchanged; the new [corpus acceptance](../../../evidence/benchmarks/research-handoff/20261107T195837Z-rh-v7-once/corpus-acceptance.json) records both rubric digests rather than claiming a fresh capture or review.

The original repeat direction concerned removing avoidable harness friction while preserving comparison quality. The known JSON-rationale problem is now caught before immutable gates by the offline review preflight. Planned reviewer readiness checks precede long grading work, and substantive disagreement is handled by the frozen adjudication rule. Neither is a reason for an additional owner decision. All original grades remain intact.

The next study decision is the scope of any larger measured comparison, not another repair to this completed run. Any later series needs its own frozen schedule, new root and accepted accounting within the applicable owner direction. Keep this clean pair separate from the interrupted `rh-v6` pair and the older `rh-v4` setup; do not treat a selected passing subset as evidence of benefit.

## Offline Reproduction

Run from the checkout root. The source-identity check must pass before comparing new outputs. Machine analysis and quality assessment remain separate: reproduce the former with these commands and inspect the locked reviews and assessed outcome for the latter.

```bash
set -eu
mkdir -p .tmp
WORK=$(mktemp -d "$PWD/.tmp/rh7-reproduction.XXXXXXXX")
export TMPDIR="$WORK"
node --import tsx --input-type=module <<'JS'
import { readFile } from "node:fs/promises";
import { sourceIdentity } from "./scripts/research-handoff/storage.ts";
const acceptance = JSON.parse(await readFile(
  "evidence/agents/20261107T195837Z-e2e-once/implementation-acceptance.json",
  "utf8",
));
if ((await sourceIdentity(process.cwd())).digest !== acceptance.codeSha256) {
  throw new Error("Source differs from the accepted repeat; stop");
}
JS
ROOT="$PWD/evidence/benchmarks/research-handoff/20261107T195837Z-rh-v7-once"
npm run study:handoff -- rh7-analyse \
  "$ROOT/observer-inventory.json" \
  "$ROOT/observer/frozen-inputs.json" "$WORK/observers" no-charges
npm run study:handoff -- rh7-analyse \
  "$ROOT/paid-inventory.json" \
  "$ROOT/corpus-import/frozen-inputs.json" "$WORK/paid" known-charges
cmp "$ROOT/analysis/observers/pilot-analysis.json" \
  "$WORK/observers/pilot-analysis.json"
cmp "$ROOT/analysis/paid/pilot-analysis.json" \
  "$WORK/paid/pilot-analysis.json"
printf 'Both analyses match. Scratch retained: %s\n' "$WORK"
```

Historical reproductions require their own accepted source identities. The `rh-v6` identity was preserved through `8e0901e`; the current tree deliberately differs because it includes the repeat implementation. Do not reinterpret that expected mismatch as corruption or overwrite an earlier analysis. Its byte-identical reproduction and cold-review receipts remain linked from [Continuation Findings](CONTINUATION-FINDINGS.md).

## Review Preflight and Retention

`scripts/handoff-review-preflight.mjs` checks typed review bindings, makes lossless copies and calls the frozen pure evaluator before a gate is written. Run its explicit tests with `node --import tsx --test test/pilot-review-preflight.test.mjs`, with `TMPDIR` inside the checkout's `.tmp/`. The helper never dispatches research or writes a scientific gate.

A job file names `recordPath`, `frozenPath`, `protocolPath`, two `reviewPaths`, and optional `adjudicationPath`. Relative paths resolve from the working directory. For a live series, prepare copies in a new directory beneath its durable evidence root and pass the returned `assessment-lock.json` to the gate. Preserve the original reviews and digest mapping; never bind a gate to scratch. A valid preflight may return `assessment.passed: false`, which is a quality verdict, not malformed input. A completed negative adjudication also leaves the evaluator's `adjudicated` flag false; consult the retained adjudication and the assessed outcome rather than interpreting that flag as absence.

Current scratch remains under `.tmp/rh7-once/` and the earlier retained scratch directories. Worker transpiler caches remain in the evidence tree and are excluded from scientific manifests. Preserve them unless cleanup is explicitly approved.

## Fresh-Session Prompt

> Read `docs/experiments/research-handoff/RESUME.md`. The requested single `rh-v7` test is complete and settled: operationally clean, both routes technically successful, both answers failed quality. Inspect or reproduce the results. Do not rerun this series, replace observations, relax the rubric or start a measured batch from its unused allowance.
