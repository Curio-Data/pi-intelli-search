# DeepSeek Harness Phase 2 Handover

## Resume Here After 0.25.0

**The release is complete. Start new work from `main`.** On 22 November 2026 the three `@curio-data` packages (`pi-intelli-search`, `mcp-intelli-search` and `dsh-intelli-search`) were public at `0.25.0`. The MCP and native release tags point to `258b13b`. The owner published the verified dsh tarball separately and configured trusted staging for subsequent releases; there was no first `dsh-v0.25.0` GitHub Release. The integration merged into `main` at `c41da51`; [main CI passed](https://github.com/Curio-Data/pi-intelli-search/actions/runs/45066025636). The release branch and `investigate/pi-1.6.0-audit` were retained. The `explore/dsh-host` branch remains on `origin`; its separate worktree was retired with the owner's approval because development has moved to `main`. Do not recreate the old worktree or repeat the dsh first-publication bootstrap.

### Outcome: DeepSeek Harness README Unification Delivered

Implementation and verification are complete. The root `README.md` is the canonical source for complete dsh operator guidance, the package README generator derives an opt-in dsh view, and the plugin generator is the sole writer of the bundle README in registry and tarball modes. The independent dsh README template is retired. The MCP page includes the bundle installation command, and the compatibility record separates local, pre-bootstrap, public by-name and credentialed evidence.

The owner approved the complete implementation, bounded live gates and delivery to `main`, then deferred the release decision until after reviewing `main`. No version bump, tag, GitHub Release, npm staging or publication follows from this handover. [DeepSeek Harness README Unification Plan](README-UNIFICATION.md) remains the design and verification record; [Compatibility](../../COMPATIBILITY.md#readme-unification-candidate-verification-2026-11-23) records the reviewed candidate, deterministic and host evidence, all 19 suite scenarios and the remaining unverified surfaces. The integration and review evidence is retained locally under `evidence/agents/2026-11-23-dsh-readme-unification/`.

Until the next matching MCP and dsh release, the dsh package README's self-links and operational links continue to name `mcp-v0.25.0`, so they open the older published page where some candidate anchors do not exist. Tagged link checks remain a release-preparation requirement. Live Web UI behaviour, GitHub and npm rendering of the candidate, and exact registry commands for the candidate remain unverified. No native release is required solely for this work, and no cleanup is authorised. Confirm delivery with `git log --first-parent main` and main CI on the merge commit.

The completed review began with the reader entry points below. They record the sources as they stood at review time, not the target architecture:

| Reader's Entry Point | Source at Review Time | How It Was Checked |
|---|---|---|
| Repository front page and host installation section | [Root README](../../../README.md#deepseek-harness) | Opening, profile installation, credentials, verification and evidence limits |
| [dsh npm package](https://www.npmjs.com/package/@curio-data/dsh-intelli-search) and installed bundle | `scripts/templates/dsh/README.md` (since retired) | The plugin generator copied the template into `plugins/dsh/README.md`; the unification retired the template once generated coverage was equivalent |
| Engine package pages | Package-specific blocks in the root README | `npm run check:readmes` checked the generated native and MCP views, not the independent dsh template |

The review confirmed that the shipped dsh README ends its Evidence and Limits section by saying registry-pin installation has not been tested. That was true when packed. [Public installation by name](../../COMPATIBILITY.md#public-dsh-profile-installation-2026-11-22) subsequently passed on Linux with `dsh 0.2.2-rc.1`, including four tools, skill loading, removal and reinstallation. This check used an isolated profile named `tui`, created from the headless template, without paid inference. Credentialed search and research passed separately with a local bundle on rc.1, not through the public installation. Do not present those as one test. Editing Git does not update the published 0.25.0 tarball; shipping changed dsh bundle text requires matching new MCP and dsh versions, not a native release solely for that edit.

The [release sequence](RELEASE-025.md) and everything below record prior work, not outstanding release steps. The compatibility record travels with Git. On the original host, `evidence/2026-11-22-0250-registry/dsh/` holds the verified tarball and by-name receipts; `evidence/agents/2026-11-22-release025-qualified/` holds the live-suite evidence. These directories are gitignored and are not part of a fresh clone.

## Earlier Standalone Handover

**Historical record:** this section and everything below it record prior work, not outstanding release steps.

The earlier instruction to leave `explore/dsh-host` and its worktree intact was superseded by the owner's approval to retire that worktree after the integrated release. Its branch remains available on `origin`. The remaining historical instruction not to add this feature to the planned `0.25` release is also complete: 0.25.0 has shipped. [Installation and Promotion](INSTALLATION-AND-PROMOTION.md) separates what could be advertised then from the install instructions for a verified public release.

Step 6 local gates passed at `dfeb500`, including both fresh installs, the deterministic suite and scenario 18 on rc.1 and rc.5. Integrated code review passed; integrated prose review requested changes, including a release blocker. The registry launcher selects public MCP `0.24.0`, which rejects `--host dsh`. A version-exists check is not a capability check. Before release, resolve the reports in the main checkout at `evidence/agents/2026-11-22-dsh-integrated/reports/`, qualify a dsh-capable **published** MCP pin and verify the published bundle in a clean profile. Do not treat preview documentation edits as release acceptance. No Step 7 action has been taken.

## Earlier Review History

**Step 5 (22 November):** After owner approval, the credentialed local-bundle run passed on rc.1 with exactly the two searches and one three-page research call authorised. Do not repeat it. See `evidence/2026-11-22-dsh-host/verification-receipt.md` in the main checkout. The follow-up prose review of `0c93822` passed (main checkout `evidence/agents/2026-11-22-dsh-followup/reports/dsh-followup-prose.md`). The code review passed on `7d3f9fd`; the later hardening did not receive a separate code verdict. Step 5 passed independent code review and Opus prose re-review; see the main checkout's `evidence/agents/2026-11-22-dsh-step5/reports/`. The coordinator also applied the dsh-specific OPS and release-readiness updates. Resume at Step 6 for integrated verification. The full live suite, release preparation and publication are not authorised by this run.

**22 November follow-up:** Both reviews of `7d3f9fd` finished. The code review passed with three hardening suggestions; the prose review requested changes. Their reports are in the main checkout under `evidence/agents/2026-11-21-dsh-rereview/reports/`. The follow-up applies all ten prose findings and all three hardening suggestions (`ed8130a`, `c4c99a9`, `f3d568b` and this plan update). The deterministic suite passed, and scenario 18 again passed on both hosts. Logs and hashes: `evidence/2026-11-22-dsh-host/scenario-18/`. Review the follow-up diff from `7d3f9fd`, not the earlier correction diff. Step 5 still requires separate approval.

**Earlier round:** The review corrections are on `explore/dsh-host` in `abf4e3a` (bundle), `f7ceb86` (scenario 18), `19fea93` (changelog gate) and `4435194` (documentation). Compare against `d4cad7b` for the corrections. The coordinator assigned an independent code re-review and a fresh Claude Code Opus 5.5 prose re-review, including generated text. Resolve any findings before requesting owner approval for Step 5. The main-checkout `.plan/` edits remain the coordinator's responsibility.

Scenario 18 passed on Linux with dsh `0.2.2-rc.1` and `0.2.2-rc.5`, Node `v24.19.0` and pnpm `12.21.0`. The logs and SHA-256 checksums are in the main checkout under `evidence/2026-11-21-dsh-host/scenario-18/{rc.1,rc.5}/`. These runs used local bundles and dummy credential delivery, not a registry installation or credentialed research. Gate results are in `evidence/2026-11-21-dsh-host/review-fix-gates.txt` in the same checkout.

The sections below preserve the original fix-session brief and its entry baseline, not instructions to reapply the fixes.

## Read First

1. Read the proposal's [Resume Here](../../proposals/dsh-host-support-proposal.md#resume-here) on this branch (`docs/proposals/dsh-host-support-proposal.md`), including its corrections and Owner Decisions D1 to D6. The main checkout's copy predated Phase 1 when this instruction was written and now also carries Resume Here; use the current tracked text rather than this historical warning.
2. Read the complete [Phase 2 plan](PLAN.md).
3. Read Phase 1 evidence at `/srv/secure/repos/CURIO/pi-intelli-search/evidence/agents/2026-11-18-next-activities/reports/dsh-explore.md`.
4. Read [REVIEW-2026-11-20.md](REVIEW-2026-11-20.md) and the two review reports it names.
5. Before release work, read `/srv/secure/repos/CURIO/pi-intelli-search/.plan/OPS.md` and `/srv/secure/repos/CURIO/pi-intelli-search/.plan/RELEASE-READINESS.md`.

## State Before the Fix Session

**Observed on 2026-11-21:** the implementation worktree is `/srv/secure/repos/CURIO/.worktrees/pi-intelli-search/explore-dsh-host`, branch `explore/dsh-host`. Its HEAD equals `origin/explore/dsh-host`; every commit is pushed. PLAN.md Steps 1 to 4 are committed (`b2d060b`, `78f34ec`, `4b98798`, `762afbc`; see its Progress Checklist), built by the herdr agent `dsh-phase2` on `zai/glm-5.3` (provenance from its session file; its report is the gitignored `/srv/secure/repos/CURIO/pi-intelli-search/evidence/agents/2026-11-19-dsh-phase2/reports/dsh-phase2.md`). `HANDOVER-TEST.md` records the plan's author and the handover tests, not the builder. Commit `0529c95` is the Phase 1 adapter spike. `test:all` gives 1014 native and 162 standalone tests, matching the README badge (1176). The branch last merged `main` at `0bccc6a`.

On 2026-11-20 an independent code review and a fresh Opus 5.5 prose review of Steps 1 to 4 completed. [REVIEW-2026-11-20.md](REVIEW-2026-11-20.md) lists every finding, the owner's instruction to apply all of them, and the owner's decisions of 21 November 2026 that govern them: a declared `engines.dsh` range tested on `rc.1` and `rc.5` (E1), and approved licence-note wording (E2). Nothing in it waits for the owner.

The tested host is dsh `0.2.2-rc.1`. On 2026-11-20 the registry's `latest` and `next` were both `0.2.2-rc.5`. A pinned scratch host remains under the worktree's `.tmp/dsh/`, but scratch is disposable and is not evidence; recreate it with the plan's recipe if needed. **Observed:** Node.js 24.19.0 is available through `fnm`; scenario 18 also needs `pnpm` on `PATH` (an isolated 12.21.0 was installed under worktree scratch for Step 2).

CI does not run on this branch: `.github/workflows/ci.yml` runs on pushes to `main`, `plan/mcp-intelli-search` and `release/**`, and on pull requests to `main`; this session opens none. Local gates are the only check until a release branch exists, so do not wait for a CI result after pushing.

Still outside this branch and owned by the coordinator: the `.plan/OPS.md` and `.plan/RELEASE-READINESS.md` text that PLAN.md Step 3 assigns, recorded ready to apply in the Step 3 section of `/srv/secure/repos/CURIO/pi-intelli-search/evidence/agents/2026-11-19-dsh-phase2/reports/dsh-phase2.md`. Do not apply it from the fix session. Step 5 has not started. On 21 November 2026 the owner authorised taking its two credentials from the `api_key` entries `deepseek` and `openrouter` in `~/.pi/agent/auth.json`; the coordinator wrote them as `DEEPSEEK_API_KEY` and `OPENROUTER_API_KEY` to the worktree's gitignored, mode-600 `.env`. That is the source PLAN.md Step 5 names. It copies two values, not the file, and neither is an OAuth login. Do not print, copy or cite the file, and do not use it before Step 5. The spend lands on the same accounts the operator's `pi` agents use.

## Original Fix Assignment

Apply the review findings in [REVIEW-2026-11-20.md](REVIEW-2026-11-20.md), as a new session:

1. Run the entry checks below. If `main` has moved, merge it into this branch first (merge, never rebase), then re-run them.
2. Read both review reports in full, then apply every finding, following E1 and E2 where they govern. Where a report still says a point needs the owner (C4's "owner to confirm", and the merge-before-release note in the prose report's Beyond the Stated Task), REVIEW-2026-11-20.md has settled it: E2 answers C4, and the MCP pin guard plus PLAN.md Step 7 govern the merge. No owner question remains.
3. Edit any hand-written file the findings need, including `test/`, `docs/`, `AGENTS.md`, the proposal and `PLAN.md`; then regenerate. Never hand-edit a generated file (`plugins/`, `pi.README.md`, `mcp.README.md`, `packages/mcp/README.md`, `PI_CHANGELOG.md`, and the contents block inside `README.md`, which `npm run generate:toc` rewrites).
4. Run the gates listed under Gates for the Fix Session below, including scenario 18 on both hosts. Each run must pass, not skip.
5. Commit by owning step: a file belongs to the PLAN.md step whose Files list names it. A finding that touches files of two steps becomes one commit per step. Plan, proposal, handover and review records go in their own commit. Update the Progress Checklist and this handover in the last commit, and push `explore/dsh-host` after each commit.
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
- No generated-file hand edits. No commit that mixes steps (see [Original Fix Assignment](#original-fix-assignment), item 5). Do not start Step 5.
- Git authority (owner, 21 November 2026): merge newer `main` into `explore/dsh-host`, and push that branch to `origin` after each commit. Never rebase, force-push, switch branch, push or merge into `main`. No GitHub Release, npm publish or staging without the plan's explicit owner approval.
- No compatibility claim from the contributor's unreproduced credentialed runs.
- No catalogue YAML submission or claim that a `dsh-plugin` topic is an official requirement.
- No deletion of existing scratch or evidence without scoped owner approval.

## Progress and Evidence

Update the Progress Checklist in `PLAN.md` after each completed step with its commit and evidence path. Keep durable run evidence in the main checkout under `evidence/<UTC-date>-dsh-host/`; put independent review reports under `evidence/agents/<run>/reports/`. Inspect promoted artefacts for credentials and never cite `.tmp/`.
