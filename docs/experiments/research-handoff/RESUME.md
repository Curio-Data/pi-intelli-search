# Pilot Resume

## Assignment

Act as the incoming coordinator in a fresh session. Finish the bounded pilot implementation, qualify it, and run at most two paid end-to-end pilot conversations after the gates below pass. The owner approved a USD 10 total ceiling and the larger matched token profile. Do not ask for that same approval again. Do not start the measured sprint.

Use this existing checkout and branch:

```text
/srv/secure/repos/CURIO/.worktrees/pi-intelli-search/research-handoff-runner
study/research-handoff-runner
```

Do not create, reset or retire a worktree. The retained `evidence/` directory is gitignored and does not travel in a clean clone. Keep the completed `rh-v4` records and earlier failed preparations intact. The historical Handover's branch-creation instructions no longer apply.

Read in this order:

1. This file.
2. [Owner decision](../../../evidence/agents/20261105T173919Z-handoff-resume/owner-decision.json), the authoritative amount, counts and profile.
3. [Refresh and Pilot Plan](REFRESH-PLAN.md), the approved scope and required gates.
4. [Final offline-patch review](../../../evidence/agents/20261105T162901Z-handoff-refresh/reports/review-final.md) and [corrected analysis](../../../evidence/agents/20261105T162901Z-handoff-refresh/analysis-corrected-final-1/summary.md).
5. [Protocol](PROTOCOL.md) and [Reproduction](REPRODUCTION.md) for the implemented historical interfaces. They describe `rh-v4`, not executable authority for this pilot. The Protocol's status text predates collection; Findings records the completed result.

[Findings](FINDINGS.md), [Checkpoint](CHECKPOINT.md) and the [audit](../../../evidence/agents/20261105T144052Z-rh-v4-audit/reports/audit-summary.md) provide historical context. The old USD 4.82 proposal and its `financialApprovalPending: true` close-out are superseded by the new owner decision. Preserve them rather than editing them to look retrospectively approved.

## Entry Checks

The handoff's [readiness receipt](../../../evidence/agents/20261105T173919Z-handoff-resume/readiness.json) identifies the final checkpoint commit, source identity and snapshot manifest. It is written after review and commit; a missing receipt means handoff closure has not completed. It certifies readiness to implement, not readiness to dispatch live work.

From the checkout root, run these checks. They change no tracked file; the TypeScript loader's cache stays under `.tmp/`:

```bash
git status --short
git rev-parse HEAD
sha256sum --check \
  evidence/agents/20261105T173919Z-handoff-resume/snapshot.sha256
mkdir -p .tmp/handoff-resume/entry
TMPDIR="$PWD/.tmp/handoff-resume/entry" node --import tsx -e \
  'import("./scripts/research-handoff/storage.ts").then(async m=>console.log((await m.sourceIdentity(process.cwd())).digest))'
```

Compare the printed source digest with `codeSha256` in `readiness.json`, and the printed commit with `gitCommit`. The close-out expects a clean tracked/untracked Git status; ignored evidence and scratch remain present.

If a check fails, stop changes and live work, inspect read-only and report the mismatch. Do not reset files or rewrite the handoff identity to make it pass.

These checks bind entry only. Once they pass, the approved implementation will change source identity. Preserve this handoff and record a new implementation identity for the new work; do not keep expecting the old digest to match after authorised edits.

## Starting State

The product runtime under `src/` already matches `main` at `d2ec50611ede2f5d46c062b7e568b13203015c22`, verified by a fresh fetch during the refresh. The extraction fix is already included; no newer runtime commit was available to merge. Package defaults are still 8,000 extraction tokens, 4,000 collation tokens and a 120-second attempt timeout. The pilot profile is approved but not implemented.

The reviewed offline patch is complete:

- `analyse.ts` attributes declarations in both actual request shapes, exposes provider item accounting and proxy residuals, reads downstream cache-write usage, reports serving providers and separates initial invocation from recovery and full topology.
- `provider-attribution.ts` reconciles provider parent-item counts without adding nested content twice. Unknown mappings remain unknown. Recorded main input includes cached tokens; do not substitute the SDK's cache-subtracted input for it.
- `outcome.ts` derives pipeline outcomes from events, retaining a completed pipeline when only a later main turn fails. `runner.ts` uses it for new records.
- The corrected re-analysis preserves every historical paired metric, population count and frozen claim-gate verdict. Its changed diagnostics never rewrite raw records.

The full deterministic lane passed under the retained [before](../../../evidence/agents/20261105T162901Z-handoff-refresh/source-final-before.json) and [after](../../../evidence/agents/20261105T162901Z-handoff-refresh/source-final-after.json) identity. Logs and [verification](../../../evidence/agents/20261105T162901Z-handoff-refresh/reanalysis-verification-final.json) are linked from the Refresh Plan. The [final actual-host synthetic series](../../../evidence/benchmarks/research-handoff/20261105T162901Z-handoff-refresh-synthetic-final/analysis.json) completed both routes under that corrected historical implementation. It does not qualify the unimplemented higher-cap pilot profile.

No new observer diagnostic, source capture, qualification or paid pilot has run. The designated pilot series root in the owner decision has not been created. No live admission or budget reservation exists for it.

## Approved Scope

The baseline arm calls `intelli_research` directly. The candidate arm invokes the same operation through `Pi`'s Codemode JavaScript tool interface and returns its complete text once. Both use the same research core and matched inputs.

The owner decision contains the complete numerical profile and counts. In particular:

- Both arms use 16,000-token extraction and collation caps and a 300-second per-attempt timeout. Keep the prescribed host/models, reasoning, source cap, concurrency, retry limits and worker ceiling.
- At most two subscription-main observer conversations use synthetic downstream work.
- One fresh common search/page capture and one charge-reporting qualification precede at most two paid end-to-end conversations. Baseline runs first. The candidate waits for the baseline's machine checks, financial settlement and independently locked answer assessments to pass.
- Failed preparation or a failed pilot stops progression. No replacement conversation, recapture, automatic cap change, extra control series or measured sprint is included. Failure of the single source capture can leave zero end-to-end pilots; baseline failure leaves the candidate unobserved.
- The coordinator allocation within USD 10 is USD 0.81 for capture, USD 1.01 for qualification and USD 4.09 for each pilot. These are ceilings, not predicted charges. The increase from the earlier proposal changes money, not operation counts.

The decision record is immutable. Its `dispatchReady: false` and pending-acceptance fields describe the state when recorded; do not edit them into permission to run. Create separate implementation, diagnostic, admission and pilot acceptances as their gates pass, referencing its digest. Bind authority to its designated real series root so the same decision cannot start another generation under a different root.

## Remaining Work

### 1. Freeze the Pilot Contract

Create `docs/experiments/research-handoff/PILOT-PROTOCOL.md` with its own revision. Preserve the bytes and meaning of the historical `PROTOCOL.md`. Freeze the exact route instructions, complete profile, permitted counts, costed schedule, success/stop rules and separate fidelity/task-usefulness rubrics before capture.

Use the same neutral task and focus from `config.ts`; do not preselect an email mechanism or substitute a new question. The two pilot research calls share one fresh captured corpus, with live extraction and collation. This is not the later fixed-response control and not a measured savings population.

Explicitly permit matched evidence recovery while limiting research to one invocation. Verify the complete first research return even if later reads occur. Define recovery by call position and purpose, not only the tool name `read`: an additional Codemode invocation can itself be recovery work. Keep historical conformance and return checks unchanged for historical analysis.

The incoming coordinator must not open the topic-validation answer or its disclosure query before freezing the rubric. A fresh corpus reviewer must reject missing required setup/failure evidence unless the corpus documents an applicable limitation. Silence or a link to an uncaptured page is insufficient. Freeze per-topic answer pass criteria before source selection. Two fresh answer reviewers lock independent grades before comparison. An answer passes the gate only when each reviewer's locked grade passes both rubrics, or a reviewer meeting the same isolation rule resolves a disagreement as a pass through recorded source-cited adjudication under the frozen criteria. Unresolved disagreement or failure of either rubric fails the gate. Review inputs exclude `rh-v4` answers and grades. Reviewers must not read the earlier topic-validation answer, its disclosure query or the coordinator's answer-shaped planning discussion; the coordinator must provide bounded review inputs rather than the full history.

### 2. Implement One Integrated Pilot Path

The current CLI is not the pilot runner. Do not forge a two-row `measured` acceptance or invoke the old preparation path to get started. The implementation map is:

| Area | Starting Files | Required Change |
|---|---|---|
| Profile and Identity | `config.ts`, `contracts.ts`, `storage.ts` | Separate pilot phase/profile, scope and protocol path; include the new protocol in its accepted identity; preserve historical configuration and analysis semantics |
| Main and Downstream Dispatch | `runner.ts`, `host.ts` | Pilot must use real downstream work and both credentials. Current `phase !== "measured"` logic selects synthetic downstream work, so merely adding a phase silently tests the wrong thing |
| Cost Guards | `config.ts`, `pipeline-client.ts`, `budget.ts` | Replace the pilot's old hard-coded 8,000/4,000 caps and reservations together; verify intended on-wire limits and enforce the new stage ceilings before each attempt |
| Capture and Qualification | `collection.ts`, `capture.ts`, `common-inputs.ts` | One fresh capture, strict corpus gate, one charge qualification, matched complete settings and input digests; no fallback or replacement |
| Authority and Schedule | `collection.ts`, `runner.ts`, `cli.ts` | Bind the new owner scope/root and exact operation counts; reject old receipts, duplicates and twenty-run schedules; pause before candidate until the baseline gate passes |
| Recovery and Analysis | `return-contract.ts`, `registration.ts`, `recorder.ts`, `analyse.ts` | Pilot-specific return/recovery checks and reporting; preserve the old one-handoff gate for `rh-v4`; no pilot savings claim |
| Settlement | `collection.ts` | Close out only the authorised pilot/preparation identities. The existing settlement walk assumes twenty measured runs and cannot be reused unchanged |
| Verification | `test/handoff-*.test.ts` | Reject unsupported scopes, counts and changed roots; cover complete/truncated/failed returns, recovery, monetary holds and worker-limit failure; no test may dispatch live work |

Keep this bounded to the experiment. Do not change package defaults, publish, bump package versions, merge `main`, recreate the unavailable programme ledger or add a security workstream. Read the pinned host's relevant full SDK, extension and Codemode documentation and examples before changing host integration. Provision no new dependencies unless a demonstrated implementation need requires them.

### 3. Qualify the Exact Implementation

The incoming coordinator owns the serial validation lane: build, native and standalone tests, handoff tests/types, native-contract types and applicable generator checks. Record source identities before and after. Run fresh credential-free actual-host synthetic cases for the new profile and failure/recovery paths, with separate fresh roots for preflight and synthetic commands.

Obtain independent technical review and the required fresh Opus prose review of the new protocol, implementation and bounded schedule. Resolve blockers, repeat affected checks on final bytes and record coordinator acceptance before any live gate. The existing offline-patch acceptance is not pilot implementation acceptance.

### 4. Execute Only the Approved Gates

After implementation acceptance, run one subscription observer conversation per arm with synthetic downstream work, baseline first. Claim the two unique observer run IDs beneath the designated pilot root against the same owner decision, enforcing the two-conversation limit before either launches. Independently review their request coverage, usage, assigned routes and unchanged returns. If either fails review, retain it and stop before financial admission; an unused second slot is not a retry of the first arm.

Next refresh public rates, validate the USD 10 allocation and bind financial admission to the same root and owner decision. Perform the single common capture, fresh corpus review and single charge qualification. Then accept and run the baseline pilot. Review its machine checks, final budget and two locked answer grades before authorising the candidate slot. Run the candidate only if those checks pass. Preserve every failure and unused slot.

Every attempt requires a reservation. Retain unknown-charge holds and active reservations; never release an uncertain charge because an error returned no text. The 30-minute worker ceiling can stop before all 300-second retries fit; that is a failed pilot, not permission to extend or repeat it.

### 5. Report and Stop

Settle the authorised series, retaining liabilities where charges are unknown. Deliver the immutable inventory, full requests/results, evidence-access checks, provider routes, token/charge accounting, independent assessments, reproducible offline analysis and a short findings note under a new pilot identity. Update the current Checkpoint with what actually ran and what remains blocked.

Report whether the methodology worked on these pilot observations. Do not infer a stable failure rate or comparative benefit from two runs. A later fixed-response control and the measured sprint need separate accepted schedules and owner decisions. Return the next proposed experiment to the owner rather than treating unused money as permission to continue.

## Credentials and Storage

Use the explicit read-only credential reference `/home/miah0x41/.pi/agent/auth.json` through the existing non-refreshing credential store. Never print or copy it, copy a refresh-token chain into a profile, or refresh the operator's login. `credentials.ts` requires OAuth access to have at least 35 minutes remaining for each worker. Ask the operator to refresh through their normal login if it is insufficient; recheck after assessment delays.

Use the designated new pilot root from the owner decision. Ordinary run workspaces must remain isolated; the frozen corpus stays outside model-readable workspaces. Preserve all ignored evidence. Existing scratch under `.tmp/rh-v4-audit/`, `.tmp/handoff-refresh/` and `.tmp/handoff-resume/` remains; it is not an input to the pilot and has no deletion approval. New scratch stays under the checkout's `.tmp/`, never `/tmp`. Set `TMPDIR` to an existing directory there before running `tsx` or an `npm` lane; the parent loader otherwise caches transpiled repository source in `/tmp`, even when the worker itself redirects its scratch.

For orchestration, follow the current `curio-herdr` skill and roster. The lead may delegate bounded implementation/review slices; delegated agents must not spawn agents, create worktrees, run paid calls or alter shared authority. Keep one integration writer and one full validation lane.

## Fresh-Session Prompt

> Read `docs/experiments/research-handoff/RESUME.md` in `/srv/secure/repos/CURIO/.worktrees/pi-intelli-search/research-handoff-runner`. Act as the incoming coordinator. Verify the handoff, then implement and qualify the approved higher-budget pilot path. The owner approved USD 10 total, one capture, one qualification and up to two end-to-end pilots, with the stated diagnostics and stop rules. Do not ask again for that budget, reuse historical live acceptance, run before the new gates pass or start the measured sprint. Preserve all `rh-v4` evidence and report the bounded pilot outcome.
