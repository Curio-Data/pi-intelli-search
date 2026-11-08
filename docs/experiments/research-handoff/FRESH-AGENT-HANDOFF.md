# Fresh-Agent Handover

## Assignment and First Action

The ten-pair study is finished. This handover supplies context for the next agent; it does not assign another study or a product fix. Verify the checkpoint, read the result and acknowledge the completed state. Then ask the owner what to do next. Do not spend quota, change the prompt, repair the measured implementation or start another review programme merely to resume.

Use the existing checkout:

```text
/srv/secure/repos/CURIO/.worktrees/pi-intelli-search/research-handoff-runner
branch: study/codemode-research-handoff (renamed from study/research-handoff-runner on 8 November 2026)
```

Read in this order:

1. This handover, then [Research Handoff Resume](RESUME.md).
2. [Ten-Pair Study Findings](SUITE-FINDINGS.md), the canonical result narrative.
3. [Final verification](../../../evidence/agents/20261108T152419Z-full-suite/final-verification.json), [implementation acceptance](../../../evidence/agents/20261108T152419Z-full-suite/implementation-acceptance.json) and [study plan](../../../evidence/agents/20261108T152419Z-full-suite/study-plan.json).
4. [Suite Protocol](SUITE-PROTOCOL.md) if another study is proposed, or the relevant source paths below if implementation work is assigned. The historical handovers are not new launch instructions.

## Completed Work

The owner requested a reusable system that accepts a requested number of matched pairs, then approved ten pairs with two pairs running concurrently. All pairs were collected, both answers of every pair were independently graded, the charges were reconciled and the analysis reproduced byte for byte. The study is closed to further dispatch.

The baseline called `intelli_research` directly; the candidate invoked it through Codemode, the `Pi` JavaScript tool interface, and returned its complete text. The main finding is negative: no answer passed the frozen quality gate, and Codemode used more main-conversation tokens in most pairs. The [findings](SUITE-FINDINGS.md#results) report the complete population and the prespecified sensitivity analysis side by side. Do not describe the shorter failed direct answer as an efficiency gain, or equal failure counts as quality equivalence.

The measured host was `Pi` 1.5.0 with `openai-codex/gpt-6.1-sol` on subscription. Each answer had one review from _Claude Code_ on Opus 5.5 and one from `Pi` on Kimi K3.1 Pro. Neither reviewer was the measured main. The captured search and twelve page texts were reused, so there was no new _Sonar_ charge. Live _MiniMax M3_ extraction and collation were the paid operations. Main-model and reviewer subscription usage are distinct from the provider-charge settlement.

Measured collection took approximately 26 minutes. Building and qualifying the reusable runner, then obtaining two fresh grades per answer, took much longer. Future work should report measured results promptly and distinguish collection time from development and assessment overhead. The accepted implementation does not need rebuilding simply to change an authorised pair count.

## Checkpoint and Retention

At handover entry, the tracked tree was clean and the branch was two commits ahead of its remote-tracking branch:

| Commit | Content |
|---|---|
| `63abcd4` | Accepted configurable concurrent runner and frozen protocol |
| `d2dec5b` | Completed findings and updated resume entrypoints |

Both commits were local; neither was pushed. This handover adds a documentation-only commit. Its final identity and review are recorded separately under `evidence/agents/20261108T194523Z-fresh-handoff/`. Check current Git state rather than assuming the historical ahead count still applies. No publication, main merge or push is assigned by this handover.

The measured source and protocol digests are in [Resume](RESUME.md#current-state). The [evidence manifest](../../../evidence/agents/20261108T152419Z-full-suite/evidence-manifest.json) covers the completed study, its external reviews, the accepted-source archive and the closeout notes as they stood at `d2dec5b`. This new handover is additive and is not in that older manifest. Do not regenerate the old manifest to hide a mismatch; investigate changed or missing bytes read-only.

Two durable roots contain the results:

- `evidence/benchmarks/research-handoff/20261108T152419Z-rh-v8-suite/`: raw conversations, per-run caches, claims, shared ledger, locked grades, gates, settlement and canonical analysis.
- `evidence/agents/20261108T152419Z-full-suite/`: owner directions, plan, acceptance, validation, independent reports, offline reproduction, source archive, manifest and final verification.

These roots are gitignored. They survive in this retained worktree, not in a clean clone or a newly created worktree. The checkout-root `.search` is absent, while historical and per-run `.search` directories remain evidence. Scratch, including the `.tmp/rh8-suite/` working area, is retained by policy and is not a durable citation source. Do not clean, relocate or replace any of it without the owner's approval.

## Read-Only Entry Verification

Run from the checkout root. This checks the tracked tree, root-cache absence and the old manifest without writing a new baseline. It uses no credential or network. If a check fails, stop changes and diagnose the discrepancy read-only.

```bash
set -eu
git status --short --branch
if [ -n "$(git status --porcelain)" ]; then
  printf 'Working-tree changes present; inspect before continuing.\n' >&2
  exit 1
fi
if [ -e .search ] || [ -L .search ]; then
  printf 'Root .search exists; preserve it and stop.\n' >&2
  exit 1
fi
node --input-type=module <<'JS'
import { readFile, readlink } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = "evidence/agents/20261108T152419Z-full-suite/";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const manifestBytes = await readFile(root + "evidence-manifest.json");
const receipt = JSON.parse(await readFile(root + "final-verification.json", "utf8"));
if (!receipt.verified || hash(manifestBytes) !== receipt.manifestSha256) {
  throw new Error("Manifest or verification receipt differs");
}
const manifest = JSON.parse(manifestBytes);
for (const file of manifest.files) {
  if (file.sha256) {
    const bytes = await readFile(file.path);
    if (bytes.length !== file.bytes || hash(bytes) !== file.sha256) {
      throw new Error("Evidence differs: " + file.path);
    }
  } else if (await readlink(file.path) !== file.symlink) {
    throw new Error("Evidence link differs: " + file.path);
  }
}
console.log("Retained evidence manifest verified");
JS
```

[Resume](RESUME.md#offline-reproduction) gives the separate credential-free analysis command and source-identity check. Reproduce only if verification of the analysis is needed; a second reproduction is not a prerequisite to acknowledging this handover.

## Known Issues and Interpretation

- **Product defect, not fabricated evidence.** The pair-6 direct run failed because `src/core/provenance.ts` misparsed a URL inside bold Markdown, then rejected the clean citation as absent. The [machine review](../../../evidence/agents/20261108T152419Z-full-suite/reports/paid-machine-review.md#f1-pair-06-baseline-failure-caused-by-an-extension-validator-defect-observed-and-reproduced) retains the reproduction. This remains unfixed in the measured code. A fix and regression test are possible follow-up work, not part of this handover's authority.
- **Incident totals have an addendum.** The original analysis records three administrative incidents. The later [orchestration disclosure](../../../evidence/agents/20261108T152419Z-full-suite/orchestration-addendum.json) adds grader-registration diagnostics without rewriting the original analysis. Operational cleanliness is false. Read both records before quoting a total.
- **Startup timeout is not a failed agent.** The grader agents completed despite registration errors from `herdr agent start`. Inspect the existing pane before registering its identity; do not spawn a duplicate. The provenance logs and locked grades establish completion.
- **Settlement is terminal.** `rh8-settle` closes authority-bound grading as well as collection. Future series must finish every collected answer's gate before settlement. The current series did so.
- **One answer per reviewer.** Preserve the original grades, their isolation and the format-only correction. Do not commission extra reviewers to overturn two failing initial verdicts.
- **Link-check correction.** The `AGENTS.md` compatibility link to `#current-candidate-verification` resolves through an explicit HTML anchor in `docs/COMPATIBILITY.md`. The earlier closeout review's optional broken-link finding was a false positive from checking headings alone. The link needs no repair.

## Reusable Runner Map

| Area | Source |
|---|---|
| Plan Parameters, Owner Scope and Prior Settlements | `scripts/research-handoff/study-plan.ts` |
| Shared Profile and Pair/Wave Schedule | `scripts/research-handoff/pilot-suite.ts` |
| Atomic Shared Reservations | `scripts/research-handoff/suite-ledger.ts`, `budget.ts` |
| Admission, Worker Checks and Stop Classification | `scripts/research-handoff/suite-admission.ts` |
| Concurrent Controller, Review Bundles, Gates and Settlement | `scripts/research-handoff/suite.ts` |
| Full-Population Metrics and Overlap | `scripts/research-handoff/suite-analysis.ts` |
| Command Interface | `scripts/research-handoff/cli.ts` |
| Concurrent and Failure-Path Tests | `test/handoff-suite.test.ts` |
| Review Schema Preparation | `scripts/handoff-review-preflight.mjs` |

`run-study --pairs N --parallel-pairs K --budget-usd X` prepares an immutable plan when supplied with the new root, owner direction and output path. It does not start paid work. `rh8-collect` runs the accepted plan; `rh8-analyse` reads retained evidence. Follow [Study Plans](SUITE-PROTOCOL.md#study-plans) and [Gate Sequence](SUITE-PROTOCOL.md#gate-sequence), not remembered command arguments. A future direction must carry cumulative prior liabilities and cannot reopen this settled root.

For future authorised live work, credentials remain an explicit non-refreshing reference to `/home/miah0x41/.pi/agent/auth.json`, never copied or printed. Insufficient access-token lifetime pauses before a claim and requires the operator's login to be refreshed. Keep conservative reservations distinct from expected spending; parallel workers share one ceiling. No new quota use is needed for this handover.

## Fresh-Agent Prompt

> Read `docs/experiments/research-handoff/FRESH-AGENT-HANDOFF.md` first, then follow its reading order and read-only entry check. Continue in this existing worktree. The ten-pair study is complete, graded, settled and reproduced; the configurable concurrent runner is accepted, and the raw evidence is retained but gitignored. Summarise the completed state, distinguish the measured `Pi` subscription main from reviewer harnesses, and ask the owner for the next task. Do not rerun the study, change its prompt or rubric, fix the product, start a new review programme, push, publish, merge or clean evidence without an applicable new instruction. Preserve the original analysis and its separate incident addendum.
