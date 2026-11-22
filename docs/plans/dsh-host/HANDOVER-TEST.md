# Fresh Agent Handover Tests

## README Unification Handover (22 November 2026)

Fresh `Pi` agents on `deepseek/deepseek-flash` tested the unification handover from `.plan/RELEASE-READINESS.md` without conversation context. The first two tests drove the access and approval-boundary corrections; the final independent agent verified the published result.

| Round | Agent and Model | Commit Tested | Verdict and Gaps | Resolution |
|---|---|---|---|---|
| Initial cold start | `dsh-resume-cold`, `deepseek/deepseek-flash` | `0028e94` plus the uncommitted plan | NOT READY: fresh clones and builder worktrees could not receive the plan; stale plan-board and runner-registration instructions also needed correction | Plan and handover committed as `427d5da`; board, runner, spend and release guidance corrected |
| Committed checkout | `dsh-resume-final`, `deepseek/deepseek-flash` | `427d5da` | NOT READY: `origin/main` still lacked the plan and the entry point did not distinguish Stage 0 from Stage 1 approval | Continuation refinements committed as `597012c`, with Stage 0 allowed and Stage 1 approval reserved; both commits pushed |
| Remote closure | `dsh-resume-proof`, `deepseek/deepseek-flash` | `597012c`, identical on `origin/main` | READY: the plan is remotely accessible, the next action is unambiguous, and no live procedure depends on the retired worktree | No blocking correction; record-keeping observations incorporated afterward |

Reports and briefs are retained in the main checkout under `evidence/agents/2026-11-22-dsh-readme-resume-{check,final,proof}/`.

## Review-Fix Handover (21 November 2026)

The handover for applying the Steps 1 to 4 review findings was tested by fresh `Pi` agents under herdr, each starting from `HANDOVER.md` with no prior context. Entry checks passed in every round; the gaps were in the handover's instructions.

| Round | Agent and Model | Handover Commit | Verdict and Gaps | Fix |
|---|---|---|---|---|
| 1 | `dsh-handover`, `kimi-coding/k3.1-pro` | `b082263` | NOT READY: C4 needed an owner answer the handover said not to wait for; push and merge directions conflicted with the prohibitions | Owner decisions E1 and E2 and git authority recorded (`2901f6e`) |
| 2 | `dsh-handover-r2`, `deepseek/deepseek-flash` (from its session file; the report's header names `zai/glm-5.3` in error) | `2901f6e` | NOT READY: three contradictions (an incomplete hand-edit list, a one-step edit rule, the stale proposal status read first), two guesses (no `rc.5` host recipe, an incomplete PLAN amendment) and five ambiguities | Handover rewritten: commit grouping, second-host recipe, full gate list, evidence destination, CI scope |
| 3 | `dsh-handover-r3`, `qwen-token-plan/qwen4-max-preview` (from its session file; fresh context, though the same model ran the code review) | `481de17` | READY: no contradiction, one minor guess (which commit takes the proposal) and three low ambiguities | All four applied directly without a further test, at the owner's request |

Reports and briefs are in the main checkout's gitignored `evidence/agents/2026-11-20-dsh-reviews/` (`reports/dsh-handover.md`, `reports/dsh-handover-r2.md`, `reports/dsh-handover-r3.md`).

## Plan Handover (19 November 2026, Historical)

This section records the test of the earlier handover, whose next step was PLAN.md Step 1. It does not describe the current handover.

### Result

On 19 November 2026 a fresh `Pi` agent on `zai/glm-5.3` (herdr agent `dsh-handover`, no prior conversation) started from `HANDOVER.md` and returned **VERDICT: READY**. It reconstructed the current state, the six fixed decisions, the next step and its acceptance criterion, the owner stop points and the prohibitions before inspecting the tree. It ran every entry check to the stated result, verified the plan's key claims against the worktree with `path:line`, and recorded no guess, stall or contradiction.

### History

| Stage | Agent and Model | Outcome |
|---|---|---|
| Plan and handover written | `dsh-explore`, `kimi-coding/k3.1-pro` | `PLAN.md`, `HANDOVER.md` |
| Adversarial plan review | `dsh-plan-review`, `qwen-token-plan/qwen4-max-preview` | Ready after named fixes: one Blocking (changelog generator rejects `[dsh-X.Y.Z]`), three Major, seven Minor |
| Revision | `dsh-explore` | All eleven findings resolved; Revision Log in `PLAN.md` |
| Handover test | `dsh-handover`, `zai/glm-5.3` | READY |

### Follow-Up Applied

The test noted that `fnm use` needs `eval "$(fnm env)"` first in a non-interactive shell; `HANDOVER.md` now says so. Its other notes were limits of the read-only test (no network to re-check registry tags), which the plan already schedules at release time.

### Evidence

Briefs and reports are in the main checkout's gitignored `evidence/agents/2026-11-18-next-activities/`: `reports/dsh-plan.md`, `dsh-plan-review.md`, `dsh-plan-r2.md` and `dsh-handover-test.md`, with their briefs under `briefs/`.

### Scope of the Test

The test ran on 19 November 2026 while the plan and handover lived in the main checkout's gitignored `.plan/dsh-host/`, before they moved onto this branch (`af3bec0`). Moving them changed the handover's links and its HEAD expectation; a later session-level handover test found that expectation stale, and it now names the newest commit that changed `docs/plans/dsh-host/` rather than a fixed hash. The test's other results are unaffected by the move.
