# Branch Handover: `rcca/mcp-research-failures` After Review

This note hands the reviewed branch to a fresh agent, which decides with the owner what happens
next. The RCCA work is complete and has been through two adversarial review rounds. What remains is
merging, releasing and cleanup, each the owner's decision. Read this file first, then
[RCCA.md](RCCA.md) for the root cause and [FOLLOW-UP.md](FOLLOW-UP.md) for how the follow-up items
were built.

Written 2026-11-08 by the orchestrating session (Claude Code, Opus 5.5).

## State

- **Branch:** `rcca/mcp-research-failures`, worktree
  `/srv/secure/repos/CURIO/.worktrees/pi-intelli-search/rcca-mcp-research-failures`. Pushed to
  `origin` (GitHub `Curio-Data/pi-intelli-search`). It is **not merged**: `main` is at `d2ec506`.
- **Tip:** the commit that adds this file, on top of `cdcbead` (the round-2 fixes) and `a32dee4`
  (the round-1 fixes).
- **Version:** both packages are at 0.22.0, **unpublished and untagged**. Check with
  `git tag -l '*0.22*'` and `npm view @curio-data/mcp-intelli-search versions`.
- **`main` checkout:** the owner has an uncommitted edit to `AGENTS.md` § Repository Folders there.
  This branch changes only the Source Structure map in `AGENTS.md`, so the two do not overlap. Do
  not touch the edit on `main`.

## Review History

| Round | Reviewers | Outcome | Fixed In |
|---|---|---|---|
| RCCA and follow-up reviews | Several, listed in [FOLLOW-UP.md](FOLLOW-UP.md) | Closed with no must-fix; accepted trade-offs recorded there | Up to `a8b7a3f` |
| Adversarial round 1 | `pi` on MiniMax M3.1 Flash, GLM 5.3 and K3.1 | Two MAJORs and one MINOR: provenance checked untrimmed text (K3-1); the budget ignored JSON escaping (K3-2); Markdown link labels became inferred hosts (F1) | `a32dee4` |
| Adversarial round 2 | `pi` on GLM 5.3 Flash (merge-ready) and DeepSeek Flash (merge-with-fixes) | One MAJOR (DS-F1): the per-source cut could split a link, which the round-1 provenance fix then rejected, ending research `collate-failed`. Also DS-F3 (no trim record on that failure), DS-F4 (`AGENTS.md` map) and two stale statements | `cdcbead` |
| Prose reviews | Claude Code on Opus 5.5, fresh context each time | `prose-r1`/`prose-r1b` on `a32dee4`; `prose-r2` on `cdcbead`, all fixes applied | `a32dee4`, `cdcbead` |

The round-2 fixes were not given a third adversarial round, by owner decision: checks, a prose
review and this handover instead.

## Verification at the Tip

- **Deterministic (Observed on `cdcbead`):** `npm run build:all`, `npm run test:all` (866 native
  plus 155 standalone, matching the README badge), `check:toc`, `check:readmes`, `check:changelog`,
  `check:plugins`, `test:smoke`, `npm audit --audit-level=low` and the native-contract type check
  all pass.
- **Mutation checks:** each round-2 behaviour (the per-source cut, the fair-share cut, the trim
  record on failure) fails its regression test when reverted.
- **Live, on the `cdcbead` code:** `01_main.sh` passes, and three trim-case runs at
  `collationSourceMaxTokens: 256` all complete with the trim notice and `inputBudget` telemetry.
  Evidence: `evidence/agents/2026-11-08-review-round2/live-r2fix/` in the main checkout.
- **Not run on the tip:** the full paced suite `test/run-e2e-all.sh`, `13_claude_code_plugin.sh`,
  `14_codex_plugin.sh` and `15_pi_floor.sh`. `AGENTS.md` requires the full suite before any
  release. Scenario 13 and the V1 to V5 live checks passed on earlier commits of this branch; see
  [FOLLOW-UP.md](FOLLOW-UP.md).

## Decisions for the Owner

1. **Merge and release order.** The committed plugin bundles and marketplaces pin
   `@curio-data/mcp-intelli-search@0.22.0`. The marketplaces are served from the repository, so
   once this branch is on `main` a plugin install fails until 0.22.0 is on npm. Publish before, or
   together with, the merge (round-2 DS-F2).
2. **Release gates.** Run `./test/run-e2e-all.sh` on the tip, decide whether to rerun scenarios 13
   and 14 (14 needs the dedicated Codex login inside the running tree), and add a 0.22.0 entry to
   `docs/COMPATIBILITY.md` (round-1 `adv-minimax` F4).
3. **Unfixed minors and notes.** Each is disclosed or low-harm; fix, accept or defer:
   - A degraded same-day rerun overwrites the good run's `meta.json` beside the preserved report
     (round-1 F3, round-2 GLM M2).
   - The rejected synthesis of a `collate-failed` run is not kept anywhere; only the error names
     the first rejected URL (from DS-F1).
   - The native settings warning names the built-in default when a valid global value is in force
     (round-1 K3-3, not rechecked).
   - Skill guidance cites `details.cachePath`, which the native host does not show the model
     (DS-F5).
   - An archived failure report names the live folder's `sources/` paths (DS-F9).
   - A `collate-failed` report advises a re-run while its trim notice says a re-run will not
     recover omitted text (`prose-r2` F10).
   - The default worst case for one degraded page is ≈14 minutes (DS-F7, a disclosed owner
     decision).
   - Notes: TLD `--check` fails on a version-only change; a hand-edited report with a blank first
     line is not recognised as a failure report.
4. **Cleanup.** Every worktree, branch, herdr workspace and scratch folder this work created is
   listed in `evidence/agents/2026-11-06-rcca-mcp-research/CLEANUP.md`. That includes the review
   worktrees `review-adv-*` and `review-r2-*`. Nothing is deleted without the owner's approval of a
   stated scope.

## Rules for the Next Agent

- Do not merge, tag, publish or delete anything without the owner's explicit instruction at the
  time. Push only to `origin` of this repository.
- Native providers only; OpenRouter as an agent provider needs explicit instruction.
- `.e2e-auth/` holds a test login: never cite, copy or print it. Never copy the operator's
  credential files into a test profile.
- Live checks share one OpenRouter key: run them one at a time, through `test/run-e2e-all.sh` or
  with gaps, and set `TMPDIR` under the tree's `.tmp/`.
- Commit messages carry no co-author attribution lines.

## Where the Evidence Is

All paths are under `/srv/secure/repos/CURIO/pi-intelli-search/evidence/agents/` in the main
checkout (gitignored, preserved):

- `2026-11-06-rcca-mcp-research/`: the RCCA and follow-up briefs, reports, live verification
  (`verify-fu/`, with `SHA256SUMS` and `SHA256SUMS-2026-11-08`) and `CLEANUP.md`.
- `2026-11-08-branch-adversarial-review/`: round 1 briefs, reports and `SYNTHESIS.md`.
- `2026-11-08-review-round2/`: round 2 briefs and reports, `SYNTHESIS.md`, the prose reviews and
  `live-r2fix/`.
