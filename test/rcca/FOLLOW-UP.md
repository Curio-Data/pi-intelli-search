# RCCA Follow-Up: Handover for the Remaining Items

This file hands the remaining RCCA work to a fresh agent. Read it with
[RCCA.md](RCCA.md), which holds the root cause, findings F1 to F7 and the 0.22.0
corrective actions. The owner decided (2026-11-07) that these items are finished on
this branch, `rcca/mcp-research-failures`, before it merges, using the same method
as the 0.22.0 fix. A cold-start review of this handover
(`reports/rcca-coldstart.md` in the evidence run) found it ready once its fixes were
applied; they are applied here.

## State at Handover

- Branch `rcca/mcp-research-failures`, worktree
  `/srv/secure/repos/CURIO/.worktrees/pi-intelli-search/rcca-mcp-research-failures`,
  pushed to `origin`. Not merged into `main`.
- Commits: `9e04010` (RCCA probes and summary), `4eadcc3` (the 0.22.0 fix),
  review-fix rounds `10ee284`, `a7beac4`, `906fb53`, a prose fix `f3d98dd`, then
  this handover and its corrections.
- **Review coverage gap.** The last code reviews (`rcca-review-kimi-r3.md`,
  `rcca-review-deepseek-r2.md`) cover `a7beac4`. `906fb53` and `f3d98dd` had only
  the prose review (`rcca-prose-r4.md`). The first follow-up review round must also
  confirm, against `a7beac4..HEAD`: kimi-r3 N4, N5, N7, and deepseek-r2 M3 to M10,
  N1 (residual), N6 and N8.
- Both packages are at 0.22.0, **unpublished and untagged**. Fold the follow-up
  into the existing `[pi-0.22.0]` and `[mcp-0.22.0]` changelog sections rather than
  starting 0.23.0, unless 0.22.0 is published first. Check with
  `git tag -l '*0.22*'` and `npm view @curio-data/mcp-intelli-search versions`.
- Gates green on `f3d98dd`: `npm run build:all`, the drift checks, `npm run test:smoke`,
  `npm audit --audit-level=low`, `npm run test:all`. E2E `01_main.sh` and
  `11_mcp_stdio.sh` passed on `906fb53` (logs in the worktree's `.e2e-logs/`, which
  do not record a commit; the timing fits).
- The owner's uncommitted edit to `AGENTS.md` § Repository Folders sits on `main`.
  This branch changes only the Source Structure tree in `AGENTS.md`, so the two do
  not overlap. Do not touch the edit on `main`.

## Remaining Items

Each item names its origin in the review reports under
`/srv/secure/repos/CURIO/pi-intelli-search/evidence/agents/2026-11-06-rcca-mcp-research/reports/`.
Do item 1 before item 2, so the `collate-failed` fixture freezes the final
failure-report shape. Every item has open decisions: settle them with the owner
before coding, and record the answers in this file.

### 1. Keep Fetched Pages When Every Extraction Fails

Origin: kimi R5 (`rcca-review-kimi.md`, `-r2`, `-r3`). The `extraction-failed`
return in `src/core/operations/research.ts` (the `degradedReturn(p, "extraction-failed", …)`
call in `executePipeline()`) runs before any cache write, so the run leaves only
`meta.json`.

Approach: replace the early return with a path that writes a failure report and
the fetched pages through `writeCacheArtifacts()` with outcome `extraction-failed`.
That function already decides under the cache lock whether a same-day successful
report exists, preserves it and reports `details.preservedCachePath`; it already
skips the index for non-completed outcomes, and the caller skips llms-full and cache
suggest. `collationFailureReport()` in `src/core/provenance.ts` says "Collation
Failed" and lists saved extractions, so **generalise it; do not reuse it
unchanged**. `isCollationFailureReport()` must recognise both report kinds (the
marker `COLLATION_FAILED_MARKER` is module-private). Write the red test first in
`test/rcca/rcca-extract/probe.test.ts`, then cover preservation of a same-day
success, a repeat over an earlier failure report, telemetry disabled, and a mixed
fetch-failed plus extraction-failed run. Update
`test/fixtures/native-contract/extraction-failed.json` with `--write` and review the
diff. Record the change under `[pi-0.22.0]` with the MCP pointer.

**This reverses documented behaviour.** `README.md` (§ results, line ≈426, and
§ cache refresh, line ≈1183), `skills/intelli-search/SKILL.md` (≈143) and
`guidance/research-guide.md` (≈158) say an `extraction-failed` result saves no report
or pages, and that a repeat preserves an earlier failure report. Rewrite them, run
`generate:plugins`, `generate:readmes` and `generate:toc`, and get a prose review.

Decisions for the owner:

- (a) Does an `extraction-failed` repeat replace an earlier failure report, as
  `collate-failed` does, or preserve it, as today?
- (b) Do runs where some pages also failed to fetch save the pages that fetched?
- (c) Does `details.cachePath` become non-empty for this outcome? MCP passes
  `details` through verbatim (`packages/mcp/src/server.ts`).

### 2. Freeze a Native Contract Fixture for `collate-failed`

Origin: orchestrator residual. The outcome is covered by
`test/core-operations.test.ts` but has no frozen native contract. Add a scenario to
`SCENARIOS` in `test/helpers/native-contract.ts`, with its synthetic collate failure
beside the existing `extraction-failed` branch (the capture script and
`test/native-contract.test.ts` iterate that list). Add a row to the Coverage table in
`test/fixtures/native-contract/README.md`. Regenerate with
`node --import tsx scripts/capture-native-contract.mts --write`, run
`node_modules/.bin/tsc -p test/tsconfig.native-contract.json`, and check the result,
cache and telemetry shapes by hand before committing.

Decisions for the owner: which failure shape to freeze (both budgets empty with
`finish_reason: length`, a provider error, or a provenance rejection), and whether
to freeze the preserved-report variant too (needs a seeded prior report).

### 3. Narrow the Domain-Guess Trade-Offs

Origin: kimi R3, R4 (`rcca-review-kimi.md`), N2 (`rcca-review-kimi-r2.md`; r3 has
a different N2); deepseek M1, M2, N1, N6, N8 (`rcca-review-deepseek-r2.md`). Logic is
`plausibleDomainReference()` and the pass-3 boundary checks in `src/core/util.ts`,
with the sets in `src/core/tlds.ts`. Current behaviour:

- Accepted on purpose: `install.sh`, `manage.py/runserver`, `main.cc`, `libfoo.so`,
  `user.id`. These rank after citations (`inferred`). deepseek-r2 rates M1 and M2
  Medium and proposes extending `SOURCE_EXTENSION_LABELS`, not the TLD set.
- Skipped: hosts under non-Latin TLDs (`例子.中国`). The IANA list holds their
  `xn--` forms, so `node:url` `domainToASCII()` before the TLD lookup may admit them.
- Skipped: a root reference with a query or fragment (`example.com?q=1`); before
  `a7beac4` it became `https://example.com`.
- Survive: `http://gitea:3000` through the absolute-URL pass, and
  `git.example.com/user/repo.git` through pass 3.
- Not fixed, accepted in review: host:port references (deepseek N6),
  `example.com:abc` still accepted (N8), hosts next to non-ASCII letters or
  hyphenated words still dropped (N1 residual).

Write each case as its own test row in `test/util.test.ts` (today's cases are joined
into one prose string at ≈225-249) with an explicit keep or reject, and mirror the
important ones in `test/rcca/rcca-fetch/`, before changing a rule. Earlier rounds
swung between false negatives and false positives (`notion.so`, `bun.sh`,
`publico.pt` were lost once).

**Done when** every listed case has a test row, `notion.so`, `bun.sh`, `publico.pt/…`,
`detik.id` and `vue.js.org` each have a keep row that every change passes, and the cases still accepted
are listed in `RCCA.md` § Corrective Actions.

Decisions for the owner: which accepted cases to reject now; whether a root
reference keeps its query or fragment; whether placeholder hosts are rejected
(without blocking real single-label intranet hosts); whether host:port references
are kept.

### 4. Make the Budget Retry Configurable and Single-Source the Token Ceiling

Origin: orchestrator residual; deepseek-r2 N9. `completeWithBudgetRetry()` retries
once, at double the cap, up to `MAX_OUTPUT_TOKENS = 128_000` in `research.ts`.
The ceiling repeats in the `[16, 128_000]` ranges in `packages/mcp/src/config.ts`
and in prose in the `README.md` settings table and `docs/ARCHITECTURE.md`. Move it
to `src/core/defaults.ts` and import it in both code places. The clamp has no test
(N9: reverting it passes every test); add one where a cap of 100,000 retries at
128,000 and a cap of 128,000 issues no retry.

A retry setting, if added, needs `ResearchSettings` (`src/core/types.ts`),
`tuningDefaults()` (`src/core/defaults.ts`), `NESTED_KEYS` and `FLAT_KEY_MAP` in
`src/settings.ts`, the strict MCP config schema, the README settings table (the
canonical reference), `guidance/` and `skills/` if agents should know it, and tests
on both adapters. Zero must disable the retry.

Decisions for the owner: whether to add the setting at all, and its shape (a
boolean, or a multiplier where 0 disables); whether the native loader should
validate `extractionMaxTokens` and `collationMaxTokens` against the ceiling (today
it accepts any value, so a native cap above 128,000 never retries); whether the
warning at the ceiling should stop advising a higher cap (`rcca-prose-r4.md`).

## Open Review Findings

Not yet recorded as fixed or accepted. Settle each in the first review round:

- kimi-r3 N4: failure reports written before the marker existed read as successful.
  Harmless only while 0.22.0 is unpublished.
- deepseek-r2 M7: the raw HTML marker is visible to the calling agent.
- deepseek-r2 M9: an unreadable prior report is preserved.
- deepseek-r2 M10: a race test relies on a 100 ms wall-clock wait.

## Method to Repeat

The 0.22.0 fix was built this way; repeat it.

1. **Orchestrator builds.** Claude Code (Opus 5.5) in the worktree implements each
   item with deterministic tests first. Mutation-check every new test: revert the
   fix, confirm the test fails, restore. Two tests in round one could not fail and
   were caught only by review.
2. **Two independent reviewers through herdr**, on models other than the
   builder's, one tab each in the repository's herdr workspace. Load the
   `curio-herdr` skill and run its `roster-check` first. Spawn with
   `herdr agent start <name> --kind pi --pane <root> --timeout 120000 -- -a --provider <p> --model <m> @<brief> "<one-line message>"`.
   Do not repeat `pi` after `--`, and read back `.result.argv`. Used for 0.22.0:
   `kimi-coding/k3.1-pro`, `deepseek/deepseek-flash`, and
   `qwen-token-plan/qwen3.8-max` (quota exhausted until 2026-11-29). The roster's
   next Reviewer is `zai/glm-5.3`. Reviewers are READ-ONLY outside their scratch
   directory, reproduce findings with scripted probes, and must verify the external
   facts the change relies on with `intelli_search` or `intelli_research`.
3. **Briefs.** The evidence run's `briefs/` folder holds the round-one briefs.
   `renderers/render-review.sh` there generated them, including the follow-up form
   (Fixed / Partly fixed / Not fixed per finding; see its
   `rcca-review-deepseek` block). Copy it into `.tmp/`, adjust the run variables,
   and render new briefs into `briefs/` under new names.
4. **Prose review** of every user-facing prose change (README, CHANGELOG,
   `docs/`, `guidance/`, `skills/`): Claude Code on Opus 5.5, fresh context,
   spawned with
   `--kind claude -- --model 'claude-opus-5-5[1m]' --add-dir <evidence run> --dangerously-skip-permissions "<one-line pointer to the brief>"`,
   told to load `professional-writing-guide` and apply the Documentation Style Guide
   in `AGENTS.md`.
5. **Loop** until no reviewer reports a must-fix. Each round: one fix commit, then a
   follow-up brief asking each reviewer for Fixed / Partly fixed / Not fixed per
   finding against the new diff. Record accepted trade-offs in this file.
6. **Live verification** under the repository's `.tmp/` with `TMPDIR` set there:
   `test/e2e/01_main.sh`, `test/e2e/11_mcp_stdio.sh`, and targeted MCP runs with
   the harness in the evidence run's `verify-0.22.0/` folder. Copy `mcpcall.mjs`,
   the `cfg-*.json` files and the argument files `cflared.json` and `zulip.json`
   into `.tmp/`, run `npm run build:all` (the harness runs
   `packages/mcp/dist/cli.js`), then `node mcpcall.mjs <label> <cfg> <args>`. It
   reads the _OpenRouter_ key from `~/.pi/agent/auth.json` and writes `ws-<label>/`
   and `tmp/` beside itself, so never run it inside `evidence/`. Promote the results
   to a new `verify-*` folder in the evidence run, build its manifest without
   itself (`fd -t f -E SHA256SUMS | sort | xargs sha256sum > SHA256SUMS`), and scan
   it for key material (`rg -c 'sk-or-'` must find nothing).
7. **Gates** before each commit: `npm run build:all`, `npm run check:toc`,
   `check:readmes`, `check:plugins`, `check:changelog`, `npm run test:smoke`,
   `npm audit --audit-level=low`, `npm run test:all`. Regenerate first where an
   edit requires it: `generate:changelog` after `CHANGELOG.md`, `generate:plugins`
   after `guidance/` or `skills/`, `generate:toc` and `generate:readmes` after
   `README.md`. Update the README test badge.

Practical traps met in this run:

- The orchestrator shell is zsh: `set -- $var` does not word-split. Wrap loops that
  split strings in `bash -c`.
- herdr writes error JSON to stderr. Capture with `2>&1` before reading
  `.error.code`. On an `agent start` timeout the agent may still be running: check
  the pane, then register the name with `herdr agent rename <pane> <name>`.
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
