# DeepSeek Harness Phase 2 Handover

## Read First

1. Read the proposal's [Resume Here](../../proposals/dsh-host-support-proposal.md#resume-here) on this branch (`docs/proposals/dsh-host-support-proposal.md`), including its corrections and Owner Decisions D1 to D6. The main checkout's copy predates Phase 1 and has no Resume Here; do not use it as the governing text.
2. Read the complete [Phase 2 plan](PLAN.md).
3. Read Phase 1 evidence at `/srv/secure/repos/CURIO/pi-intelli-search/evidence/agents/2026-11-18-next-activities/reports/dsh-explore.md`.
4. Before release work, read `/srv/secure/repos/CURIO/pi-intelli-search/.plan/OPS.md` and `/srv/secure/repos/CURIO/pi-intelli-search/.plan/RELEASE-READINESS.md`.

## Current State

**Observed on 2026-11-19:** the implementation worktree is `/srv/secure/repos/CURIO/.worktrees/pi-intelli-search/explore-dsh-host`, branch `explore/dsh-host`. Its HEAD is the commit that added this plan under `docs/plans/dsh-host/` (check with `git log -1 -- docs/plans/dsh-host`), pushed to `origin/explore/dsh-host`; that does not approve another push. Commit `0529c95` already implements and tests `--host dsh`. Commits `5f2160c` and `56d8392` record Phase 1 and all six owner decisions. No generated `plugins/dsh`, scenario 18 or dsh compatibility row exists yet.

The tested host is dsh `0.2.2-rc.1`; `next` was `0.2.2-rc.5` in Phase 1. A pinned scratch host remains under the worktree's `.tmp/` at planning time, but scratch is disposable and is not evidence. Recreate it with the plan's recipe if needed. **Observed:** Node.js 24.19.0 is available through `fnm`; `pnpm` is currently absent and must be supplied before `dsh plugin` operations.

## Next Step

Execute [PLAN.md](PLAN.md) Step 1: generate the complete bundle and its deterministic tests. Do not reimplement the adapter spike. Step 2's new E2E script must run successfully before commit; a skip does not qualify it.

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

Expected: clean `explore/dsh-host` tree, HEAD `56d8392`, Node `v24.19.0`, successful builds/tests, and `plugin bundles match generator output`. If another agent has advanced the branch, read the new commits and reconcile the plan before changing files.

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

- No provider calls or credentials during entry, Step 1 or Step 2.
- No writes to `/tmp`, `~/.dsh`, `~/.pi`, `~/.claude`, `~/.codex` or `~/.agents`; keep scratch in the worktree's `.tmp/`.
- No tracked-file edits outside the step being executed, no generated-file hand edits, no commits outside the current step.
- No branch switch, rebase, merge, push, GitHub Release, npm publish or staging without the plan's explicit owner approval.
- No compatibility claim from the contributor's unreproduced credentialed runs.
- No catalogue YAML submission or claim that a `dsh-plugin` topic is an official requirement.
- No deletion of existing scratch or evidence without scoped owner approval.

## Progress and Evidence

Update the Progress Checklist in `PLAN.md` after each completed step with its commit and evidence path. Keep durable run evidence in the main checkout under `evidence/<UTC-date>-dsh-host/`; put independent review reports under `evidence/agents/<run>/reports/`. Inspect promoted artefacts for credentials and never cite `.tmp/`.
