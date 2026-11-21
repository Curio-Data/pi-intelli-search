# DeepSeek Harness Phase 2 Handover

## Read First

1. Read the proposal's [Resume Here](../../proposals/dsh-host-support-proposal.md#resume-here) on this branch (`docs/proposals/dsh-host-support-proposal.md`), including its corrections and Owner Decisions D1 to D6. The main checkout's copy predates Phase 1 and has no Resume Here; do not use it as the governing text.
2. Read the complete [Phase 2 plan](PLAN.md).
3. Read Phase 1 evidence at `/srv/secure/repos/CURIO/pi-intelli-search/evidence/agents/2026-11-18-next-activities/reports/dsh-explore.md`.
4. Read [REVIEW-2026-11-20.md](REVIEW-2026-11-20.md) and the two review reports it names.
5. Before release work, read `/srv/secure/repos/CURIO/pi-intelli-search/.plan/OPS.md` and `/srv/secure/repos/CURIO/pi-intelli-search/.plan/RELEASE-READINESS.md`.

## Current State

**Observed on 2026-11-21:** the implementation worktree is `/srv/secure/repos/CURIO/.worktrees/pi-intelli-search/explore-dsh-host`, branch `explore/dsh-host`. Its HEAD is the newest commit that changed `docs/plans/dsh-host/` (check with `git log -1 --format=%h -- docs/plans/dsh-host`), pushed to `origin/explore/dsh-host`. PLAN.md Steps 1 to 4 are committed (`b2d060b`, `78f34ec`, `4b98798`, `762afbc`; see its Progress Checklist), built by `dsh-phase2` on `zai/glm-5.3`. Commit `0529c95` is the Phase 1 adapter spike. `test:all` gives 1014 native and 162 standalone tests, matching the README badge (1176). The branch last merged `main` at `0bccc6a`.

On 2026-11-20 an independent code review and a fresh Opus 5.5 prose review of Steps 1 to 4 completed. [REVIEW-2026-11-20.md](REVIEW-2026-11-20.md) lists every finding, the owner's instruction to apply all of them, and the owner's decisions of 21 November 2026 that govern them: a declared `engines.dsh` range tested on `rc.1` and `rc.5` (E1), and approved licence-note wording (E2). Nothing in it waits for the owner.

The tested host is dsh `0.2.2-rc.1`. On 2026-11-20 the registry's `latest` and `next` were both `0.2.2-rc.5`. A pinned scratch host remains under the worktree's `.tmp/dsh/`, but scratch is disposable and is not evidence; recreate it with the plan's recipe if needed. **Observed:** Node.js 24.19.0 is available through `fnm`; scenario 18 also needs `pnpm` on `PATH` (an isolated 12.21.0 was installed under worktree scratch for Step 2).

Still outside this branch and owned by the coordinator: the `.plan/OPS.md` and `.plan/RELEASE-READINESS.md` text that PLAN.md Step 3 assigns, recorded ready to apply in the Step 3 section of `/srv/secure/repos/CURIO/pi-intelli-search/evidence/agents/2026-11-19-dsh-phase2/reports/dsh-phase2.md`. Do not apply it from the fix session. Step 5 has not started. On 21 November 2026 the owner authorised taking its two credentials from the `api_key` entries `deepseek` and `openrouter` in `~/.pi/agent/auth.json`; the coordinator wrote them as `DEEPSEEK_API_KEY` and `OPENROUTER_API_KEY` to the worktree's gitignored, mode-600 `.env`. That is the source PLAN.md Step 5 names. It copies two values, not the file, and neither is an OAuth login. Do not print, copy or cite the file, and do not use it before Step 5. The spend lands on the same accounts the operator's `pi` agents use.

## Next Step

Apply the review findings in [REVIEW-2026-11-20.md](REVIEW-2026-11-20.md), as a new session:

1. Run the entry checks below. If `main` has moved, merge it into this branch first (merge, never rebase), then re-run them.
2. Read both review reports in full, then apply every finding, following E1 and E2 where they govern.
3. Edit hand-edited sources only (`README.md`, `guidance/`, `scripts/templates/dsh/`, the generator and scripts), then regenerate. Never hand-edit a generated file.
4. Run the gates in that file's After Applying section, including scenario 18, which must run successfully, not skip.
5. Commit the corrections against the steps they belong to, update the Progress Checklist and this handover, and push `explore/dsh-host` after each commit.
6. Report to the coordinator for re-review. A Builder does not spawn reviewers.

Step 5 follows only after the re-reviews pass and the owner approves the live run.

## Entry Checks

Run these credential-free checks from the worktree before editing. They make no provider calls:

```bash
cd /srv/secure/repos/CURIO/.worktrees/pi-intelli-search/explore-dsh-host
git status --short --branch
git rev-parse --short HEAD
eval "$(fnm env)"   # needed in a non-interactive shell before fnm use
fnm use 24.19.0
node --version
npm ci
npm run build:all
npm run test:all
npm run check:plugins
```

Expected: clean `explore/dsh-host` tree; HEAD equal to `git log -1 --format=%h -- docs/plans/dsh-host` and to `origin/explore/dsh-host`; Node `v24.19.0`, successful builds/tests, and `plugin bundles match generator output`. If another agent has advanced the branch, read the new commits and reconcile the plan before changing files.

Check or recreate the isolated host using the plan, then run:

```bash
export DSH_HOME="$PWD/.tmp/dsh/home"
export DSH_AGENTS_HOME="$PWD/.tmp/dsh/agents"
export XDG_CONFIG_HOME="$PWD/.tmp/dsh/xdg"
export DSH_BIN="$PWD/.tmp/dsh/prefix/node_modules/.bin/dsh"
"$DSH_BIN" --version
```

Expected: `0.2.2-rc.1`. Do not use an operator dsh profile.

## Prohibitions

- No provider calls or credentials during entry or while applying review findings; scenario 18 is credential-free.
- No writes to `/tmp`, `~/.dsh`, `~/.pi`, `~/.claude`, `~/.codex` or `~/.agents`; keep scratch in the worktree's `.tmp/`.
- No tracked-file edits outside the step being executed, no generated-file hand edits, no commits outside the current step.
- Git authority (owner, 21 November 2026): merge newer `main` into `explore/dsh-host`, and push that branch to `origin` after each commit. Never rebase, force-push, switch branch, push or merge into `main`. No GitHub Release, npm publish or staging without the plan's explicit owner approval.
- No compatibility claim from the contributor's unreproduced credentialed runs.
- No catalogue YAML submission or claim that a `dsh-plugin` topic is an official requirement.
- No deletion of existing scratch or evidence without scoped owner approval.

## Progress and Evidence

Update the Progress Checklist in `PLAN.md` after each completed step with its commit and evidence path. Keep durable run evidence in the main checkout under `evidence/<UTC-date>-dsh-host/`; put independent review reports under `evidence/agents/<run>/reports/`. Inspect promoted artefacts for credentials and never cite `.tmp/`.
