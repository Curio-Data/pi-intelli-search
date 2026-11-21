# DeepSeek Harness Phase 2 Handover

## Read First

1. Read the proposal's [Resume Here](../../proposals/dsh-host-support-proposal.md#resume-here) on this branch (`docs/proposals/dsh-host-support-proposal.md`), including its corrections and Owner Decisions D1 to D6. The main checkout's copy predates Phase 1 and has no Resume Here; do not use it as the governing text. Its Status line and Next Steps describe the state at the end of Phase 1; Steps 1 to 4 have since landed (see Current State), and finding C7 corrects them. Where they disagree with Current State, Current State governs.
2. Read the complete [Phase 2 plan](PLAN.md).
3. Read Phase 1 evidence at `/srv/secure/repos/CURIO/pi-intelli-search/evidence/agents/2026-11-18-next-activities/reports/dsh-explore.md`.
4. Read [REVIEW-2026-11-20.md](REVIEW-2026-11-20.md) and the two review reports it names.
5. Before release work, read `/srv/secure/repos/CURIO/pi-intelli-search/.plan/OPS.md` and `/srv/secure/repos/CURIO/pi-intelli-search/.plan/RELEASE-READINESS.md`.

## Current State

**Observed on 2026-11-21:** the implementation worktree is `/srv/secure/repos/CURIO/.worktrees/pi-intelli-search/explore-dsh-host`, branch `explore/dsh-host`. Its HEAD equals `origin/explore/dsh-host`; every commit is pushed. PLAN.md Steps 1 to 4 are committed (`b2d060b`, `78f34ec`, `4b98798`, `762afbc`; see its Progress Checklist), built by the herdr agent `dsh-phase2` on `zai/glm-5.3` (provenance from its session file; its report is the gitignored `/srv/secure/repos/CURIO/pi-intelli-search/evidence/agents/2026-11-19-dsh-phase2/reports/dsh-phase2.md`). `HANDOVER-TEST.md` records the plan's author and the handover tests, not the builder. Commit `0529c95` is the Phase 1 adapter spike. `test:all` gives 1014 native and 162 standalone tests, matching the README badge (1176). The branch last merged `main` at `0bccc6a`.

On 2026-11-20 an independent code review and a fresh Opus 5.5 prose review of Steps 1 to 4 completed. [REVIEW-2026-11-20.md](REVIEW-2026-11-20.md) lists every finding, the owner's instruction to apply all of them, and the owner's decisions of 21 November 2026 that govern them: a declared `engines.dsh` range tested on `rc.1` and `rc.5` (E1), and approved licence-note wording (E2). Nothing in it waits for the owner.

The tested host is dsh `0.2.2-rc.1`. On 2026-11-20 the registry's `latest` and `next` were both `0.2.2-rc.5`. A pinned scratch host remains under the worktree's `.tmp/dsh/`, but scratch is disposable and is not evidence; recreate it with the plan's recipe if needed. **Observed:** Node.js 24.19.0 is available through `fnm`; scenario 18 also needs `pnpm` on `PATH` (an isolated 12.21.0 was installed under worktree scratch for Step 2).

CI does not run on this branch: `.github/workflows/ci.yml` triggers on `main`, `plan/mcp-intelli-search` and `release/**` only. Local gates are the only check until a release branch exists, so do not wait for a CI result after pushing.

Still outside this branch and owned by the coordinator: the `.plan/OPS.md` and `.plan/RELEASE-READINESS.md` text that PLAN.md Step 3 assigns, recorded ready to apply in the Step 3 section of `/srv/secure/repos/CURIO/pi-intelli-search/evidence/agents/2026-11-19-dsh-phase2/reports/dsh-phase2.md`. Do not apply it from the fix session. Step 5 has not started. On 21 November 2026 the owner authorised taking its two credentials from the `api_key` entries `deepseek` and `openrouter` in `~/.pi/agent/auth.json`; the coordinator wrote them as `DEEPSEEK_API_KEY` and `OPENROUTER_API_KEY` to the worktree's gitignored, mode-600 `.env`. That is the source PLAN.md Step 5 names. It copies two values, not the file, and neither is an OAuth login. Do not print, copy or cite the file, and do not use it before Step 5. The spend lands on the same accounts the operator's `pi` agents use.

## Next Step

Apply the review findings in [REVIEW-2026-11-20.md](REVIEW-2026-11-20.md), as a new session:

1. Run the entry checks below. If `main` has moved, merge it into this branch first (merge, never rebase), then re-run them.
2. Read both review reports in full, then apply every finding, following E1 and E2 where they govern. Where a report still says a point needs the owner (C4's "owner to confirm", and the merge-before-release note in the prose report's Beyond the Stated Task), REVIEW-2026-11-20.md has settled it: E2 answers C4, and the MCP pin guard plus PLAN.md Step 7 govern the merge. No owner question remains.
3. Edit any hand-written file the findings need, including `test/`, `docs/`, `AGENTS.md`, the proposal and `PLAN.md`; then regenerate. Never hand-edit a generated file (`plugins/`, `pi.README.md`, `mcp.README.md`, `packages/mcp/README.md`, `PI_CHANGELOG.md`).
4. Run the gates listed under Gates for the Fix Session below, including scenario 18 on both hosts. Each run must pass, not skip.
5. Commit by owning step: a file belongs to the PLAN.md step whose Files list names it. A finding that touches files of two steps becomes one commit per step. Plan, handover and review records go in their own commit. Update the Progress Checklist and this handover in the last commit, and push `explore/dsh-host` after each commit.
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

Expected: clean `explore/dsh-host` tree; HEAD equal to `origin/explore/dsh-host`; Node `v24.19.0`, successful builds/tests, and `plugin bundles match generator output`. If another agent has advanced the branch, read the new commits and reconcile the plan before changing files.

Check or recreate the isolated host using the plan, then run:

```bash
export DSH_HOME="$PWD/.tmp/dsh/home"
export DSH_AGENTS_HOME="$PWD/.tmp/dsh/agents"
export XDG_CONFIG_HOME="$PWD/.tmp/dsh/xdg"
export DSH_BIN="$PWD/.tmp/dsh/prefix/node_modules/.bin/dsh"
"$DSH_BIN" --version
```

Expected: `0.2.2-rc.1`. Do not use an operator dsh profile.

## Second Host for E1

E1 needs scenario 18 on `0.2.2-rc.5` as well. Keep the `rc.1` host and install `rc.5` beside it, under its own prefix and caches:

```bash
mkdir -p .tmp/dsh/rc5/{prefix,npm-cache}
npm_config_cache="$PWD/.tmp/dsh/rc5/npm-cache" \
npm install --prefix "$PWD/.tmp/dsh/rc5/prefix" @deepseek-ai/dsh@0.2.2-rc.5
"$PWD/.tmp/dsh/rc5/prefix/node_modules/.bin/dsh" --version   # expect 0.2.2-rc.5
```

Scenario 18 builds its own isolated `HOME`, `DSH_HOME`, `DSH_AGENTS_HOME`, XDG and npm-cache root under `TMPDIR` (`test/e2e/18_dsh_plugin.sh`, its isolation block), so the caller supplies only `DSH_BIN`, pnpm on `PATH` and a `TMPDIR` under `.tmp/`. Run it once per host:

```bash
export PATH="$PWD/.tmp/dsh/pnpm/node_modules/.bin:$PATH"
mkdir -p .tmp/e2e-rc1 .tmp/e2e-rc5
TMPDIR="$PWD/.tmp/e2e-rc1" DSH_BIN="$PWD/.tmp/dsh/prefix/node_modules/.bin/dsh" ./test/e2e/18_dsh_plugin.sh
TMPDIR="$PWD/.tmp/e2e-rc5" DSH_BIN="$PWD/.tmp/dsh/rc5/prefix/node_modules/.bin/dsh" ./test/e2e/18_dsh_plugin.sh
```

Copy each run's log from `.e2e-logs/` to `/srv/secure/repos/CURIO/pi-intelli-search/evidence/<UTC-date>-dsh-host/scenario-18/rc.1/` and `.../rc.5/`, with its SHA-256 checksum and the dsh, Node and pnpm versions. Scenario 18 uses only an invented dummy key, but inspect the logs for credentials before promotion.

## Gates for the Fix Session

Run all of these from the worktree after the last edit, and record each exit status:

```bash
npm run build:all
npm run test:all
node_modules/.bin/tsc -p test/tsconfig.native-contract.json
npm run check:toc && npm run check:plugins && npm run check:readmes && npm run check:changelog
git ls-files -z '*.sh' | xargs -0 shellcheck
rg -n --hidden $'\u2014' -g '*.md' -g '!AGENTS.md' -g '!node_modules' .   # must print nothing
npm audit --audit-level=low
git diff --check main...HEAD
```

Then scenario 18 on both hosts, as above. Update the README badge if the test count changes (`AGENTS.md` Rule 9).

## Prohibitions

- No provider calls or credentials during entry or while applying review findings; scenario 18 is credential-free.
- No writes to `/tmp`, `~/.dsh`, `~/.pi`, `~/.claude`, `~/.codex` or `~/.agents`; keep scratch in the worktree's `.tmp/`.
- No generated-file hand edits. No commit that mixes steps (see Next Step 5). Do not start Step 5.
- Git authority (owner, 21 November 2026): merge newer `main` into `explore/dsh-host`, and push that branch to `origin` after each commit. Never rebase, force-push, switch branch, push or merge into `main`. No GitHub Release, npm publish or staging without the plan's explicit owner approval.
- No compatibility claim from the contributor's unreproduced credentialed runs.
- No catalogue YAML submission or claim that a `dsh-plugin` topic is an official requirement.
- No deletion of existing scratch or evidence without scoped owner approval.

## Progress and Evidence

Update the Progress Checklist in `PLAN.md` after each completed step with its commit and evidence path. Keep durable run evidence in the main checkout under `evidence/<UTC-date>-dsh-host/`; put independent review reports under `evidence/agents/<run>/reports/`. Inspect promoted artefacts for credentials and never cite `.tmp/`.
