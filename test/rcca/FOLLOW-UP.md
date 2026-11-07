# RCCA Follow-Up: Handover for the Remaining Items

This file hands the remaining RCCA work to a fresh agent. Read it with
[RCCA.md](RCCA.md), which holds the root cause, findings F1 to F7 and the 0.22.0
corrective actions. The owner decided (2026-11-07) that these items are finished on
this branch, `rcca/mcp-research-failures`, before it merges, using the same method
as the 0.22.0 fix.

## State at Handover

- Branch `rcca/mcp-research-failures`, worktree
  `/srv/secure/repos/CURIO/.worktrees/pi-intelli-search/rcca-mcp-research-failures`,
  pushed to `origin`. Not merged into `main`.
- Commits: `9e04010` (RCCA probes and summary), `4eadcc3` (the 0.22.0 fix), then
  three review rounds `10ee284`, `a7beac4`, `906fb53`, `f3d98dd`.
- Both packages are at 0.22.0, **unpublished and untagged**. Fold the follow-up
  into the existing `[pi-0.22.0]` and `[mcp-0.22.0]` changelog sections rather than
  starting 0.23.0, unless 0.22.0 is published first. Check with
  `git tag -l '*0.22*'`.
- Gates green on `f3d98dd`: `npm run build:all`, the drift checks, `npm run test:smoke`,
  `npm audit --audit-level=low`, `npm run test:all`. E2E `01_main.sh` and
  `11_mcp_stdio.sh` passed on `906fb53`.
- The owner's uncommitted edit to `AGENTS.md` § Repository Folders sits on `main`.
  This branch changes only the Source Structure tree in `AGENTS.md`, so the two do
  not overlap. Do not touch the edit on `main`.

## Remaining Items

Each item names its origin in the review reports under
`/srv/secure/repos/CURIO/pi-intelli-search/evidence/agents/2026-11-06-rcca-mcp-research/reports/`.

### 1. Keep Fetched Pages When Every Extraction Fails

Origin: kimi R5 (`rcca-review-kimi.md`, `-r2`, `-r3`). The `extraction-failed`
return in `src/core/operations/research.ts` (the `degradedReturn(p, "extraction-failed", …)`
call) runs before any cache write, so a run whose pages all fetched but all failed
extraction leaves only `meta.json`. Save `sources/` and a failure report through the
same path `collate-failed` uses: `writeCacheArtifacts()` decides under the cache lock
whether a same-day successful report exists, and if so preserves it and reports
`details.preservedCachePath`. Reuse `collationFailureReport()` and
`COLLATION_FAILED_MARKER` in `src/core/provenance.ts`, or generalise them, so
`isCollationFailureReport()` still recognises every failure report. No index entry,
cache suggest or llms-full download on this outcome. Update the frozen fixture
`test/fixtures/native-contract/extraction-failed.json` and the RCCA test in
`test/rcca/rcca-extract/`.

### 2. Freeze a Native Contract Fixture for `collate-failed`

Origin: orchestrator residual. The outcome is covered by
`test/core-operations.test.ts` but has no frozen native contract. Add a scenario to
`scripts/capture-native-contract.mts` and `test/native-contract.test.ts`, regenerate
with `node --import tsx scripts/capture-native-contract.mts --write` (see
`test/fixtures/native-contract/README.md`), and check
the result, cache and telemetry shapes by hand before committing.

### 3. Narrow the Domain-Guess Trade-Offs

Origin: kimi R3, R4, N2; deepseek M1, M2 (`rcca-review-deepseek-r2.md`). Logic is
`plausibleDomainReference()` and the pass-3 boundary checks in `src/core/util.ts`,
with the sets in `src/core/tlds.ts`. Known residuals:

- Accepted on purpose: `install.sh`, `manage.py/runserver`, `main.cc`, `libfoo.so`,
  `user.id`. These rank after citations (`inferred`), which limits the harm.
- Skipped: hosts under non-Latin TLDs. The IANA list holds their `xn--` forms, so
  converting the candidate with `node:url` `domainToASCII()` before the TLD lookup
  may admit them.
- Dropped: query or fragment on a root reference (`example.com?q=1` becomes
  `https://example.com`). Pass 3 now skips these; decide whether to keep the full
  reference instead.
- Absolute placeholders survive the absolute-URL pass (`git.example.com/user/repo.git`,
  `http://gitea:3000`).

Every change here has swung false negatives against false positives in earlier
rounds (`notion.so`, `bun.sh`, `publico.pt` were lost once). Add each case to the
table-driven tests in `test/util.test.ts` and `test/rcca/rcca-fetch/` before
changing the rule, and record what is accepted as a trade-off.

### 4. Make the Budget Retry Configurable and Single-Source the Token Ceiling

Origin: orchestrator residual. `completeWithBudgetRetry()` retries once, at double
the cap, up to `MAX_OUTPUT_TOKENS = 128_000` in `research.ts`. That ceiling repeats
the `[16, 128_000]` ranges in `packages/mcp/src/config.ts`. Move the ceiling to
`src/core/defaults.ts` and import it in both places. If a retry setting is added,
it needs the native settings loader (`src/settings.ts`), the strict MCP config
schema, the README settings table (the canonical reference), and tests on both
adapters. Zero must disable the retry.

## Method to Repeat

The 0.22.0 fix was built this way; repeat it.

1. **Orchestrator builds.** Claude Code (Opus 5.5) in the worktree implements each
   item with deterministic tests first. Mutation-check every new test: revert the
   fix, confirm the test fails, restore. Two tests in round one could not fail and
   were caught only by review.
2. **Two independent reviewers through herdr**, on models other than the
   builder's, one tab each in the repository's herdr workspace. Load the
   `curio-herdr` skill and run its `roster-check` first. Used for 0.22.0:
   - `pi -a --provider kimi-coding --model k3.1-pro`
   - `pi -a --provider deepseek --model deepseek-flash`
   - `pi -a --provider qwen-token-plan --model qwen3.8-max` (quota exhausted until
     2026-11-29; deepseek-flash took over its follow-up)
   Brief each as argv at spawn (`"@<brief path>"`). Reviewers are READ-ONLY outside
   their scratch directory, reproduce findings with scripted probes, and must
   verify the external facts the change relies on with `intelli_search` or
   `intelli_research`. Use the briefs in the evidence run's `briefs/` folder as
   templates.
3. **Prose review** of every user-facing prose change (README, CHANGELOG,
   `docs/`, `guidance/`, `skills/`): Claude Code on Opus 5.5, fresh context,
   spawned through herdr with `--kind claude -- --model 'claude-opus-5-5[1m]'`,
   told to load `professional-writing-guide` and apply the Documentation Style Guide
   in `AGENTS.md`.
4. **Loop** until no reviewer reports a must-fix. Each round: one fix commit, then a
   follow-up brief asking each reviewer for Fixed / Partly fixed / Not fixed per
   finding against the new diff. Record accepted trade-offs in the report and here.
5. **Live verification** under the repository's `.tmp/` with `TMPDIR` set there:
   `test/e2e/01_main.sh`, `test/e2e/11_mcp_stdio.sh`, and targeted MCP runs with
   the harness in the evidence run's `verify-0.22.0/` folder
   (`mcpcall.mjs` and the `cfg-*.json` files).
   Promote the results to a new `verify-*` folder in the evidence run with a
   `SHA256SUMS` manifest, and scan it for key material (`rg -c 'sk-or-'` must find
   nothing).
6. **Gates** before each commit: `npm run build:all`, `npm run check:toc`,
   `check:readmes`, `check:plugins`, `check:changelog`, `npm run test:smoke`,
   `npm audit --audit-level=low`, `npm run test:all`. Update the README test badge
   and rerun `generate:readmes`.

Practical traps met in this run:

- The orchestrator shell is zsh: `set -- $var` does not word-split. Wrap loops that
  split strings in `bash -c`.
- herdr writes error JSON to stderr. Capture with `2>&1` before reading
  `.error.code`; on an `agent start` timeout check `agent get` before re-spawning.
- The report file is the authority, not the agent status.

## Briefs, Reports and Cleanup

Evidence for the run, including every brief and report, lives in
`/srv/secure/repos/CURIO/pi-intelli-search/evidence/agents/2026-11-06-rcca-mcp-research/`.
Write new briefs and reports there under new names (for example
`rcca-review-kimi-r4.md`).

Every scratch folder, worktree, herdr workspace and branch this RCCA created is
listed in `CLEANUP.md` in that evidence folder. **Add each new artefact to it as
you create it.** Nothing in it is deleted without the owner's approval of a stated
scope, after the branch merges.
