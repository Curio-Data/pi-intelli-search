# Pilot Resume

## Current State

The bounded `rh-v5` series is closed. The approved implementation passed validation and independent review, both subscription-main observer conversations passed, and the single fresh capture completed. A fresh corpus reviewer rejected its answerability under the frozen rubric. Preparation stopped before charge qualification or either paid end-to-end pilot. [Pilot Findings](PILOT-FINDINGS.md) records the result and financial close-out.

The USD 10 owner decision has been used for this series. Unused slots and released allowance do not authorise a retry, recapture, replacement or measured sprint. The implementation rejects further live work after settlement. Do not reopen the root, alter the decision or remove claims to bypass that boundary.

## Reading Order

1. [Pilot Findings](PILOT-FINDINGS.md), including the source-policy proposal and limits of the observations.
2. [Final inventory](../../../evidence/benchmarks/research-handoff/20261105T173919Z-rh-v5-pilot/inventory.json), [corpus rejection](../../../evidence/benchmarks/research-handoff/20261105T173919Z-rh-v5-pilot/corpus-acceptance.json) and [settlement](../../../evidence/benchmarks/research-handoff/20261105T173919Z-rh-v5-pilot/settlement-receipt.json).
3. [Pilot Protocol](PILOT-PROTOCOL.md), the frozen contract for this closed series.
4. [Implementation acceptance](../../../evidence/agents/20261106T103008Z-pilot-implementation/implementation-acceptance.json), its independent reviews and [accepted protocol snapshot](../../../evidence/agents/20261106T103008Z-pilot-implementation/protocol-accepted.md).

The [original incoming-coordinator brief](../../../evidence/agents/20261106T103008Z-pilot-implementation/resume-at-entry.md) and [Refresh and Pilot Plan](REFRESH-PLAN.md) are retained commissioning history. Their implementation instructions and pre-implementation entry digests do not describe the current state. [Protocol](PROTOCOL.md), [Reproduction](REPRODUCTION.md) and [Findings](FINDINGS.md) remain the separate historical `rh-v4` records.

## Checkout and Identity

Keep the existing checkout:

```text
/srv/secure/repos/CURIO/.worktrees/pi-intelli-search/research-handoff-runner
branch: study/research-handoff-runner
```

The accepted pilot implementation is committed as `64914bf`; later documentation-only close-out may be a descendant. The accepted source and protocol digests are recorded in the implementation acceptance. `sourceIdentity()` includes the frozen pilot protocol but excludes current resume, checkpoint and findings notes. The [evidence manifest](../../../evidence/benchmarks/research-handoff/20261105T173919Z-rh-v5-pilot/evidence-manifest.json) binds the retained run artefacts separately.

Before offline work, inspect `git status --short`; the committed close-out expects no tracked or untracked changes, while ignored evidence remains. A mismatch requires read-only investigation, not a reset or rebinding of the closed series.

## Offline Verification

Run from the checkout root. This sequence compares source identity with the acceptance, reproduces each homogeneous analysis and compares it with the retained result. It writes only to a fresh scratch directory outside the closed series root. A changed source digest or byte comparison stops the sequence.

```bash
set -eu
mkdir -p .tmp
WORK=$(mktemp -d "$PWD/.tmp/pilot-reproduction.XXXXXXXX")
export TMPDIR="$WORK"
node --import tsx --input-type=module <<'JS'
import { readFile } from "node:fs/promises";
import { sourceIdentity } from "./scripts/research-handoff/storage.ts";
const acceptance = JSON.parse(await readFile(
  "evidence/agents/20261106T103008Z-pilot-implementation/implementation-acceptance.json",
  "utf8",
));
const current = await sourceIdentity(process.cwd());
if (current.digest !== acceptance.codeSha256) {
  throw new Error("Source differs from the accepted pilot; stop");
}
console.log("Accepted source identity:", current.digest);
JS
ROOT="$PWD/evidence/benchmarks/research-handoff/20261105T173919Z-rh-v5-pilot"
npm run study:handoff -- pilot-analyse \
  "$ROOT/observer-inventory.json" \
  "$ROOT/observer/frozen-inputs.json" \
  "$WORK/observers" no-charges
npm run study:handoff -- pilot-analyse \
  "$ROOT/paid-inventory.json" \
  "$ROOT/capture/frozen-inputs.json" \
  "$WORK/paid" known-charges
cmp "$ROOT/analysis/observers/pilot-analysis.json" \
  "$WORK/observers/pilot-analysis.json"
cmp "$ROOT/analysis/paid/pilot-analysis.json" \
  "$WORK/paid/pilot-analysis.json"
printf 'Both analyses match. Scratch retained: %s\n' "$WORK"
```

Successful comparisons print no `cmp` output; the final line names the retained scratch. Do not use `preflight`, `pilot-synthetic` or any live command as a substitute for this offline check. Promote any new result worth retaining outside scratch before citing it; deletion requires consent.

## Permitted Continuation

Inspect the retained evidence, reproduce the homogeneous observer and paid analyses, or develop a proposal for a new source-selection policy. The next proposal is to canonicalise alternate page URLs and define any bounded following of required documentation links before selecting sources. It requires a separately costed schedule and owner decision before live execution. Neither a new capture nor implementation of a changed collection policy is assigned by this closed pilot.

The observer evidence establishes request coverage and complete returns for synthetic downstream work. It does not establish live extraction/collation reliability at the larger caps, useful paid answers or savings. Keep these distinctions when reporting the result.

## Retention and Exclusions

Preserve all `rh-v4` and pilot evidence, including the rejected corpus, failed synthetic cases and earlier implementation candidates. The gitignored evidence exists in this worktree and does not travel in a clean clone. Do not create, reset or retire a worktree or replace its dependencies.

Current scratch remains under `.tmp/pilot-implementation/` and `.tmp/pilot-reproduction.*`, alongside the earlier scratch named in the archived incoming brief. Worker transpiler caches also remain inside the evidence root and are explicitly excluded from the scientific manifest. No cleanup, package integration, publication, version bump, main merge or new live operation is authorised.

## Fresh-Session Prompt

> Read `docs/experiments/research-handoff/RESUME.md`. The `rh-v5` pilot is closed after corpus rejection, with no paid end-to-end conversation. Inspect or reproduce the retained result; do not reuse its approval, root or unused slots. Any new source-policy pilot needs a separately costed schedule and owner decision.
