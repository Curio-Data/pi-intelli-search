# Pilot Resume

## Current State

The `rh-v6` continuation is complete and settled. Both paid conversations passed the machine and financial checks. The baseline answer received an adjudicated narrow pass; both independent reviewers failed the Codemode answer. The pilot pair therefore failed its quality gate. [Continuation Findings](CONTINUATION-FINDINGS.md) records the result, measurements and administrative interruption.

The [owner's latest direction](../../../evidence/agents/20261107T191857Z-pilot-finish/owner-direction.json) is to complete this run first, then repeat until the experiment runs end to end without interruptions, while preserving comparison quality. The current run is finished; the clean repeat is not. Routine format and harness problems are coordinator work, not reasons to ask the owner another implementation question.

## Reading Order

1. [Continuation Findings](CONTINUATION-FINDINGS.md).
2. [Final inventory](../../../evidence/benchmarks/research-handoff/20261106T143614Z-rh-v6-pilot/inventory.json), [assessed outcome](../../../evidence/benchmarks/research-handoff/20261106T143614Z-rh-v6-pilot/assessed-outcome.json) and [settlement](../../../evidence/benchmarks/research-handoff/20261106T143614Z-rh-v6-pilot/settlement-receipt.json).
3. [Pilot Continuation](PILOT-CONTINUATION.md), the frozen `rh-v6` contract, and its [implementation acceptance](../../../evidence/agents/20261106T143614Z-pilot-completion/implementation-acceptance.json).
4. [Administrative correction verification](../../../evidence/agents/20261107T191857Z-pilot-finish/correction-verification.json) and [independent machine and procedural review](../../../evidence/agents/20261107T191857Z-pilot-finish/reports/machine-review.md).
5. [Pilot Findings](PILOT-FINDINGS.md) for the closed `rh-v5` corpus rejection; [Findings](FINDINGS.md) for the completed `rh-v4` comparison that did not establish savings with preserved usefulness.

The `rh-v6` baseline's original [failed gate](../../../evidence/benchmarks/research-handoff/20261106T143614Z-rh-v6-pilot/pilot-baseline-gate-format-failure.json) is retained alongside the corrected gate. A reader of the corrected gate alone would miss the interruption. The final inventory links both the failure and its owner-authorised supersession.

## Checkout and Identity

Continue in the existing checkout:

```text
/srv/secure/repos/CURIO/.worktrees/pi-intelli-search/research-handoff-runner
branch: study/research-handoff-runner
```

Commit `efe8edf` holds the accepted study implementation. The acceptance binds code digest `05f0684b7deb5260c39a82e783c4eff4d491b3ef524248c922ef20154892315c` and protocol digest `048e45887ddc8f5b8708b3e026c7fae06a46e45d133eb3fa988ba712d3bfbf16`. The close-out changes current notes and supplies an offline review-preparation helper outside the frozen study implementation; it does not change those identities. The close-out must be committed and pushed before handover. The expected handover state is a clean `git status --short`; ignored evidence remains. Inspect status before work and investigate unexpected changes rather than resetting the tree or rebinding the closed series.

The evidence is gitignored and retained in this worktree. It does not travel in a clean clone. Preserve the checkout, dependencies, all earlier series and scratch. No cleanup, package integration, publication, version bump or main merge is assigned.

## Next Assignment

Prepare the next clean repeat under the owner's existing direction, then execute it in a fresh session. The comparison remains direct `intelli_research` against Codemode, the `Pi` interface that lets the model invoke tools through a JavaScript script. Reuse the accepted `rh-v6` frozen search and twelve captured page texts across the clean repeats, with live extraction and collation in both arms. Keep matched settings and allowances, complete return measurement and the unchanged dual rubric. Do not recapture sources, tune prompts from the reviewed answers or relax failed criteria to obtain a pass.

The current runner binds `rh6-` commands to a single settled root, so it cannot launch the next repeat as-is. Implement and qualify fresh series identity and cumulative accounting without reopening an old root. Freeze the next attempt counts and allocation before dispatch, using the original USD 10 cumulative ceiling as a coordinator-imposed limit unless the owner changes it. The latest direction authorises repeat work; it is not an instruction to reuse settled receipts or unlimited spending. A new costed-plan discussion is not a prerequisite for routine continuation within those restrictions.

The coordinator-selected next sequence is: validate the repeat runner and obtain independent technical and Opus prose acceptance; qualify both observer routes once for that accepted implementation; verify the retained corpus bytes and their applicability under the unchanged rubric; qualify charge reporting once for the new series; collect the baseline and candidate with the prescribed gap; independently grade both answers; settle, analyse and report. Reuse of corpus and observer qualification must be explicit in the new binding, with their digests checked, rather than copied into a false claim of fresh capture. An implementation change requires renewed qualification. Freeze the operation counts and financial allocations for that sequence before dispatch.

Move answer grading after collection of both arms in the new protocol. This removes review delays between matched conversations and avoids selecting whether to collect the candidate from the baseline's quality result. Keep the same independent reviewers, rubric and pass criteria. Financial, credential, input-integrity and execution-safety failures still stop unsafe progression. This scheduling change is for the next protocol only; the settled `rh-v6` contract remains unchanged.

Classify the next attempt as operationally clean only when collection, grading, settlement and reproduction finish without an unplanned pause, manual receipt correction, orchestration failure or provider/reviewer incident. Record configured retries and quota refusals as incidents rather than silently excluding them. Report quality separately: an uninterrupted workflow with a failed answer is a cleanly collected negative result, not a passing pair. The next protocol must encode these fields before execution.

Remove the following preventable interruptions before dispatch:

- Prepare all reviewer inputs and typed templates in advance. Use the offline review preflight below before the write-once gate. Representational fixes must preserve the original reviews and their content.
- Use fresh available reviewers. Retain quota refusals and switch to an available rostered reviewer before any judgement, rather than waiting for the owner. Do not replace an unfavourable completed review.
- Keep grader briefs aligned with the frozen rubric. The baseline adjudicator identified an extra brief instruction about source contradictions; future briefs must not introduce a separate grading standard. Obtain actual timestamps when locking grades and remove the misleading ungraded-template note from future templates or instruct reviewers to replace it before locking. Never edit a completed original review to tidy its note.
- Recover orchestration timeouts by inspecting the existing agent, not by spawning duplicates. The retained [spawn helper](../../../evidence/agents/20261107T191857Z-pilot-finish/spawn-review.sh) handles an unregistered live agent and checks the report before waiting for work that may already have finished. It is not a resume command: inspect the named agent before rerunning it, because a new invocation creates a tab.
- Plan execution, independent grading, settlement, analysis and the handover as one workflow. Escalate material changes to the comparison or spending boundary, not JSON formatting.

Record every repeat, including failures. A clean workflow can produce a negative quality result. It must not be confused with a successful quality-equivalent pair, and repeating until a pass does not establish a representative success rate. The larger measured comparison is still a separate phase, not started by this close-out.

## Offline Review Preflight

`scripts/handoff-review-preflight.mjs` checks types and bindings before creating review copies and an assessment lock. It serialises an object-valued adjudication rationale losslessly, retains every original and invokes the existing pure assessment function. It never writes a scientific gate or dispatches work. Two failing initial reviews remain a failed assessment even if an adjudication is supplied.

A job file names `recordPath`, `frozenPath`, `protocolPath`, exactly two `reviewPaths`, and optionally `adjudicationPath`. Run the command from the checkout root: relative input paths resolve from the process working directory, not the job file. Use a fresh output directory on the repository filesystem; existing outputs, including partial ones from a failed preparation, are refused. A valid preflight can report `assessment.passed: false`: that is a substantive verdict, not malformed input. Inspect that field before progression. For an actual review, write the prepared copies beneath the new series' durable `evidence/` directory and pass that output's `assessment-lock.json` to the gate. The gate must bind the prepared copies, not the original object-rationale record. Keep the originals and the preflight's digest mapping. Never bind a gate to the scratch output in the demonstration below.

```bash
mkdir -p .tmp/review-preflight
export TMPDIR="$PWD/.tmp/review-preflight"
node --import tsx --test test/pilot-review-preflight.test.mjs
node --import tsx scripts/handoff-review-preflight.mjs \
  evidence/agents/20261107T191857Z-pilot-finish/preflight-job.json \
  .tmp/review-preflight/new-review
```

The example uses the completed candidate's two failing grades and must report a failed assessment without altering them. Choose another new output directory if it already exists. The helper fixes the known object-rationale representation and reports other type problems before a gate is written. It is not a substitute for independent grading, recovery-purpose review or the full machine and financial gate.

## Offline Reproduction

Run from the checkout root. The identity check must pass before comparing newly generated outputs. This reproduces machine analyses; the separate assessed outcome and locked reviews determine quality.

```bash
set -eu
mkdir -p .tmp
WORK=$(mktemp -d "$PWD/.tmp/rh6-reproduction.XXXXXXXX")
export TMPDIR="$WORK"
node --import tsx --input-type=module <<'JS'
import { readFile } from "node:fs/promises";
import { sourceIdentity } from "./scripts/research-handoff/storage.ts";
const acceptance = JSON.parse(await readFile(
  "evidence/agents/20261106T143614Z-pilot-completion/implementation-acceptance.json",
  "utf8",
));
if ((await sourceIdentity(process.cwd())).digest !== acceptance.codeSha256) {
  throw new Error("Source differs from the accepted pilot; stop");
}
JS
ROOT="$PWD/evidence/benchmarks/research-handoff/20261106T143614Z-rh-v6-pilot"
npm run study:handoff -- rh6-analyse \
  "$ROOT/observer-inventory.json" \
  "$ROOT/observer/frozen-inputs.json" "$WORK/observers" no-charges
npm run study:handoff -- rh6-analyse \
  "$ROOT/paid-inventory.json" \
  "$ROOT/capture/frozen-inputs.json" "$WORK/paid" known-charges
cmp "$ROOT/analysis/observers/pilot-analysis.json" \
  "$WORK/observers/pilot-analysis.json"
cmp "$ROOT/analysis/paid/pilot-analysis.json" \
  "$WORK/paid/pilot-analysis.json"
printf 'Both analyses match. Scratch retained: %s\n' "$WORK"
```

Do not substitute a live command, preflight collection or synthetic series for this offline check. Historical `rh-v5` and `rh-v4` analyses retain their own source identities and reproduction records; do not run them under changed source and silently replace their outputs.

## Fresh-Session Prompt

> Read `docs/experiments/research-handoff/RESUME.md`. The interrupted `rh-v6` run is complete and settled: both routes passed machine checks, the baseline passed by adjudication and both candidate reviewers failed answer quality. The owner has directed clean repeats with comparison quality unchanged. Prepare the fresh bounded repeat and remove routine harness friction without asking for trivial implementation decisions. Keep every failed attempt visible and preserve closed roots. Do not claim repeat dispatch readiness until the new series identity, cumulative accounting and validation are in place.
