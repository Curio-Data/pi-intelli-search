# Fresh Agent Handover Test

## Result

On 19 November 2026 a fresh `Pi` agent on `zai/glm-5.3` (herdr agent `dsh-handover`, no prior conversation) started from `HANDOVER.md` and returned **VERDICT: READY**. It reconstructed the current state, the six fixed decisions, the next step and its acceptance criterion, the owner stop points and the prohibitions before inspecting the tree. It ran every entry check to the stated result, verified the plan's key claims against the worktree with `path:line`, and recorded no guess, stall or contradiction.

## History

| Stage | Agent and Model | Outcome |
|---|---|---|
| Plan and handover written | `dsh-explore`, `kimi-coding/k3.1-pro` | `PLAN.md`, `HANDOVER.md` |
| Adversarial plan review | `dsh-plan-review`, `qwen-token-plan/qwen4-max-preview` | Ready after named fixes: one Blocking (changelog generator rejects `[dsh-X.Y.Z]`), three Major, seven Minor |
| Revision | `dsh-explore` | All eleven findings resolved; Revision Log in `PLAN.md` |
| Handover test | `dsh-handover`, `zai/glm-5.3` | READY |

## Follow-Up Applied

The test noted that `fnm use` needs `eval "$(fnm env)"` first in a non-interactive shell; `HANDOVER.md` now says so. Its other notes were limits of the read-only test (no network to re-check registry tags), which the plan already schedules at release time.

## Evidence

Briefs and reports are in the main checkout's gitignored `evidence/agents/2026-11-18-next-activities/`: `reports/dsh-plan.md`, `dsh-plan-review.md`, `dsh-plan-r2.md` and `dsh-handover-test.md`, with their briefs under `briefs/`.

## Scope of the Test

The test ran on 19 November 2026 while the plan and handover lived in the main checkout's gitignored `.plan/dsh-host/`, before they moved onto this branch (`af3bec0`). Moving them changed the handover's links and its HEAD expectation; a later session-level handover test found that expectation stale, and it now names the newest commit that changed `docs/plans/dsh-host/` rather than a fixed hash. The test's other results are unaffected by the move.
