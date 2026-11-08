# Branch Handover: `rcca/mcp-research-failures` Before the Provenance Fix

This note hands the branch to a fresh session. That session fixes one provenance defect on this
branch, then reviews with the owner how the change affects the changelog and README, then runs a
prose review. Read this file first, then [RCCA.md](RCCA.md) for the root cause and
[FOLLOW-UP.md](FOLLOW-UP.md) for how the follow-up items were built.

Written 2026-11-08 by the orchestrating session (Claude Code, Opus 5.5). It replaces the handover
written at `997c926`.

## State

- **Branch:** `rcca/mcp-research-failures`, worktree
  `/srv/secure/repos/CURIO/.worktrees/pi-intelli-search/rcca-mcp-research-failures`. Pushed to
  `origin` (GitHub `Curio-Data/pi-intelli-search`). **Not merged**: `main` is at `d2ec506`.
- **Tip:** the commit that adds this file, on top of `45e6ca5` and `9cf531b` (both described
  below).
- **Version:** both packages at 0.22.0, **unpublished and untagged**. Check with
  `git tag -l '*0.22*'` and `npm view @curio-data/mcp-intelli-search versions`.
- **`main` checkout:** the owner has an uncommitted edit to `AGENTS.md` § Repository Folders there.
  Do not touch it. This branch edits `AGENTS.md` only in the Source Structure map.

## What This Session Added

| Commit | Change |
|---|---|
| `9cf531b` | README Features bullets for the 0.22.0 capabilities (output budget retry, long pages with bounded collation, recoverable failures, code and text sources). Recipes 9 (Large-Context Collation) and 10 (Bounded Time and Spend, the 0.21.0 values), with e2e scenarios R9 and R10 in `test/e2e/10_config_recipes.sh`. The three new keys in the Settings example. A one-paragraph summary at the top of the CHANGELOG `pi-0.22.0` entry. |
| `45e6ca5` | Budget retries never exceed the model's output limit. `ModelClient.outputLimit()` is optional: native reads the registry entry's `maxTokens`, MCP the catalogue's `top_provider.max_completion_tokens`. `retryCeiling()` lowers only the retry ceiling, never the configured cap. A retry that grows the cap by less than a quarter (`MIN_RETRY_GROWTH`) is skipped. Exhaustion messages name the bound that prevented a larger attempt and give adapter-specific remedies. Token counts come before the advice and any adapter text comes last, because `failureDetail()` cuts a reason at 300 characters from the end. Also fixes the R10 `budgetRetried` jq check. |

Decisions the owner made in this session:

- The README undersold 0.22.0, so features were promoted to the Features list (2026-11-08).
- The output-limit cap (D4) was fixed on this branch, not deferred.
- The provenance defect below is fixed on this branch, in a fresh session.

## Next Work, in Order

### 1. Fix the Bold-URL Provenance Defect

`proseUrls()` in `src/core/provenance.ts:63` matches `https?:\/\/[^\s<>"`\]]+`, strips trailing
`[.,;:!?]+`, then trims an unbalanced `)` only while the string ends in `)`. Evidence containing
`**[Limit Increase Request Form](https://forms.gle/eX6pXvit1wBv77Yw5)**.` therefore yields
`https://forms.gle/eX6pXvit1wBv77Yw5)**`. The synthesis cites the clean URL, which is not in the
evidence set, so `finalizeCollation()` throws "Collation provenance validation failed". A
completed, charged research run is discarded as `collate-failed`. The same shape applies to `*`,
`_` and `__` emphasis, and to combinations such as `)**,` and `)*.`. The defect is also on
`main`, so it predates 0.22.0. It was confirmed on this branch at `45e6ca5` with the one-line
repro from the report.

The report came from the research-handoff study session (`study/research-handoff-runner`). Read
these in place, and do not copy or modify anything in that worktree:

- `/srv/secure/repos/CURIO/.worktrees/pi-intelli-search/research-handoff-runner/evidence/agents/20261108T201301Z-codemode-summary/reports/provenance-bold-url-defect.md`:
  the cause, a `node -e` repro, suggested regression cases and an untested fix direction.
- `/srv/secure/repos/CURIO/.worktrees/pi-intelli-search/research-handoff-runner/evidence/agents/20261108T152419Z-full-suite/reports/paid-machine-review.md`
  § F1: the original observation.

The fix must normalise the evidence side and the prose side identically. The report's regression
cases are `**[label](URL)**.`, `**[label](URL)**`, `*[label](URL)*,`, `_[label](URL)_`,
`__[label](URL)__;` and a bare `**URL**.`. Its control case is a URL with balanced parentheses,
such as `https://en.wikipedia.org/wiki/Foo_(bar)`, which must keep them. Whether `*` and `_` may be
stripped from a URL's end is a design decision, because both are legal URL characters. Tests for
the validator are in `test/provenance.test.ts`. `proseUrls()` is not exported, so test through the
exported validation path or export it deliberately. Run the mutation check: revert the fix and
confirm a regression test fails.

When the fix is committed, tell the reporting session the commit hash. It records the fix in
`docs/CODEMODE.md` on `study/research-handoff-runner`. Find its address with `ListAgents`; the
report arrived from `research-handoff-runner-e8`. If it is gone, tell the owner instead.

### 2. Judge the Documentation Impact With the Owner

Once the fix is complete, go through the CHANGELOG `pi-0.22.0` entry (a `Fixed` item is likely)
and the README with the owner, and decide together what changes. The owner expects the impact to
be small, but will decide after the fix. Remember the generated files: after any README or
CHANGELOG edit, run `npm run generate:toc`, `npm run generate:readmes` and
`npm run generate:changelog`. Update the test badge count in `README.md` to the new total.

### 3. Prose Review

Spawn a fresh Claude Code on Opus 5.5 through herdr as a Prose Reviewer (`curio-herdr` skill,
§ Prose Review in its `references/roster.md`). Its scope is all prose changed since `997c926`. Six
reviews ran in this session (`prose-r1` to `prose-r6`). The `prose-r6` fixes went in largely in
that reviewer's own wording, shortened to fit 300 characters, but they were not re-reviewed. The
owner deferred a seventh round to this step.

Keep these known constraints in the brief:

- **The 300-character cut.** `failureDetail()` keeps 299 characters and an ellipsis. Measure any
  new message wording at its worst case: six-digit caps and counts, and `extractionMaxTokens`.
- **The frozen default remedy.** `Raise <setting>, choose a model that reasons less for this stage,
  or re-run.` is pinned by `test/fixtures/native-contract/collate-failed.json`. Changing it means
  regenerating a frozen contract with `scripts/capture-native-contract.mts`, which needs the
  owner's decision. Its rare six-digit worst case is 302 characters, which loses `un.`. That was
  accepted rather than changing the contract.
- **Retained `prose-r6` notes, not applied.** NITs F6 to F10: README paragraph structure, the
  wording "would add under a quarter", no remedy on the retries-disabled reason, CHANGELOG bullet
  length, and adapter text that can contradict the remedy.

### 4. Release Gates and Decisions

These are unchanged from the earlier handover, and each is the owner's call:

- **Publish order.** The committed plugin bundles pin `@curio-data/mcp-intelli-search@0.22.0`,
  served from the repository marketplaces. Publish before, or together with, the merge.
- **Full live suite.** Run `./test/run-e2e-all.sh` on the final tip. Decide on scenarios 13 and 14
  (14 needs the dedicated Codex login) and 15.
- **Compatibility.** Add a 0.22.0 entry to `docs/COMPATIBILITY.md`.
- **Unfixed minors.** The list from the earlier handover: degraded rerun overwrites the good
  `meta.json`; rejected `collate-failed` synthesis not kept; native settings warning names the
  built-in default; skill cites `details.cachePath`; archived failure report names live `sources/`
  paths; `collate-failed` advice versus the trim notice; ≈14-minute worst case per degraded page.
  The text is at `997c926:test/rcca/HANDOVER.md`.

## Verification at `45e6ca5`

- **Deterministic (Observed):**
  - `npm run build:all`, and `npm run test:all` (884 native and 157 standalone, 1,041 in total,
    matching the badge).
  - `check:toc`, `check:readmes`, `check:changelog`, `check:plugins` and `test:smoke`.
  - The native-contract type check, and `npm audit --audit-level=low` (0 vulnerabilities).
- **Mutation checks (Observed):** reverting each new rule fails its test. The rules are the MCP
  wrapper passthrough, the growth rule, the limit-bound condition, both F3 conditions, the
  counts-before-remedy order and the retries-disabled guard.
- **Live (Observed):**
  - `01_main.sh` passes on the final `45e6ca5` build.
  - `10_config_recipes.sh` passes all eight scenarios, R9 and R10 included, on the D4 code before
    the last message-wording rounds. Those rounds change only failure text that the scenarios do
    not reach.
  - R10 proves the 150,000-character cap bound: a fetched page exceeded it, and the per-page input
    stayed within it (211,550 ≤ 211,701).
- **Host facts (Observed on `Pi` 1.5.0):**
  - The registry gives MiniMax M3 `maxTokens` 512,000, so the default 8,000, 16,000, 32,000
    schedule is unaffected.
  - `provider-composer.js:110` assigns 16,384 to a custom model defined without `maxTokens`.
  - 24 built-in OpenRouter entries sit at 32,768 (`prose-r5`).
- **Not run on the tip:** `test/run-e2e-all.sh`, `13_claude_code_plugin.sh`,
  `14_codex_plugin.sh` and `15_pi_floor.sh`.

## Where the Evidence Is

All paths are under `/srv/secure/repos/CURIO/pi-intelli-search/evidence/agents/` in the main
checkout (gitignored, preserved):

- `2026-11-08-feature-framing/`: this session's briefs and reports.
  - Prose reviews `prose-r1` to `prose-r6`, with `r2` to `r6` on the output-limit change.
  - `e2e-10-recipes-run2.log`: the run whose only failure was the jq check.
  - `e2e-10-recipes-d4.log`: all eight scenarios on D4.
  - `e2e-01-main-final.log`: the final build.
- `2026-11-06-rcca-mcp-research/`, `2026-11-08-branch-adversarial-review/` and
  `2026-11-08-review-round2/`: as described in the earlier handover, with `CLEANUP.md` in the
  first.

## Scratch Awaiting a Cleanup Decision

The worktree's `.tmp/` holds about 1.1 GiB. This session added the following, none of which is
cited and all of which is disposable:

- the six reviewers' empty scratch folders under `.tmp/agents/2026-11-08-feature-framing/`
- build, test and e2e logs whose retained copies are listed above

Earlier sessions' scratch is inventoried in `CLEANUP.md`. Nothing is deleted without the owner's
approval of a stated scope.

## Rules for the Next Session

- Do not merge, tag, publish or delete anything without the owner's explicit instruction at the
  time. Push only to `origin` of this repository.
- Native providers only; OpenRouter as an agent provider needs explicit instruction.
- `.e2e-auth/` holds a test login: never cite, copy or print it. Never copy the operator's
  credential files into a test profile.
- Live checks share one OpenRouter key: run them one at a time with gaps, and set `TMPDIR` under
  the tree's `.tmp/`. Do not rebuild `dist/` while a live run is loading it.
- Do not edit a script while bash is running it: bash reads scripts incrementally.
- `sd -F` does not match a multi-line literal and does not report it; use a Python replacement that
  asserts a single match.
- Commit messages carry no co-author attribution lines.
