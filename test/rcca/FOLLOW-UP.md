# RCCA Follow-Up: Handover for the Remaining Items

This file hands the remaining RCCA work to a fresh agent. Read it with
[RCCA.md](RCCA.md), which holds the root cause, findings F1 to F7 and the 0.22.0
corrective actions. The owner decided (2026-11-07) that these items are finished on
this branch, `rcca/mcp-research-failures`, before it merges, using the same method
as the 0.22.0 fix. A cold-start review of this handover
(`reports/rcca-coldstart.md` in the evidence run) found it ready once its fixes were
applied; they are applied here.

## Status at 2026-11-08

Items 1 to 5 are built, reviewed and merged into this branch (tracks A, C and B, then
fix rounds from the combined, prose and live reviews). The combined code review and
the prose review closed with no must-fix; accepted trade-offs are listed below. All
gates pass. Live verification ran under the evidence run's `verify-fu/` (plan and
expected results written before the runs, results appended): V0 to V4 pass, and V4
found the doubled-slash provenance defect, since fixed. V5 with `pi` passes for the
extraction-failed case and, after the trim notice was made actionable, for the trim
case. Three of the `pi` runs stalled in the agent loop and were killed; recorded as
unproven.

Still open, all for the owner:

- V5 with Claude Code needs a `CLAUDE_CODE_OAUTH_TOKEN` (`claude setup-token`, run
  outside an agent session).
- Push this branch, merge it into `main`, and approve the cleanup scope in the
  evidence run's `CLEANUP.md`.

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
failure-report shape. The owner's decisions of 2026-11-07 are recorded under each
item. Where an item still says "orchestrator's choice", decide it yourself, record
the choice here, and have the reviewers check it.

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

**Owner decision (2026-11-07).** Always keep every downloaded page, even when no
extraction succeeded, and make it visible in the final result: the report lists
each saved page's path and why its extraction failed, so the calling agent can
revisit it. The saved pages are also the starting point for a later extraction
retry, which then needs no refetch. This applies to the native extension and the
MCP server alike (shared core), in every host exposure mode.

Orchestrator's choice, with these defaults: a repeat replaces an earlier failure
report, as `collate-failed` does, but never a same-day successful report; runs where
some pages failed to fetch save the pages that did; `details.cachePath` names the
saved folder (MCP passes `details` through verbatim, `packages/mcp/src/server.ts`).

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

**Owner decision (2026-11-07):** orchestrator's choice. Freeze the shape seen
live: every attempt returns empty text with `finish_reason: length`. Freezing the
preserved-report variant too is optional.

### 3. Handle Guessed and File-Like References as Assets

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

**Owner decision (2026-11-07): do not filter file-like references out.** They
will always occur, and sometimes the script or file is the right download: a
`.py` file may hold the code that answers the question. Build a mechanism that
handles them as assets instead: keep each guessed reference, label it as inferred
from text (not a citation), record what fetching it returned (a page, a code or
text file, nothing), and show that in the result so the calling agent can follow
it up. This changes the scope above: the work is classifying and handling these
references, not rejecting more of them. Check the content-type gate in the fetch
stage (`test/rcca/rcca-fetch/gate.probe.test.ts`) admits plain-text and source
files. Query-or-fragment, placeholder-host and host:port handling stay the
orchestrator's choice, under the same test-row rule.

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

**Owner decision (2026-11-07).** Add a setting for the number of budget retries,
**default 2**, where 0 disables the retry. Each retry doubles the output cap
(8,000, then 16,000, then 32,000 tokens), up to the ceiling, and only failed calls
retry. The native loader validates `extractionMaxTokens` and `collationMaxTokens`
against the same range as MCP, warning on a bad value.

**Timeout gap (found 2026-11-07, must fix).** Every attempt uses the same
`llmTimeoutMs` (120,000 ms) whatever its cap. At the measured ≈95-104 tokens/s, a
16,000-token attempt needs ≈160 s, so a retry that needs its full budget times out
first. Scale each attempt's timeout with its cap, and test it.

Orchestrator's choice: whether the warning at the ceiling stops advising a higher
cap (`rcca-prose-r4.md`).

### 5. Size the Limits Against the Collation Model's Input Budget

Origin: owner, 2026-11-07. Extraction and collation use separate models, so size
them separately. The collation model works well up to ≈256,000 input tokens (its
context window is far larger). Every extraction feeds collation, so the binding
limit is the collation input: the search summary, the prompts, every extraction,
and room for the synthesis must fit in that budget. The concern is context
consumption, not cost. A permitted budget is a ceiling, not a target: most
extractions use a small part of their cap.

Observed in 76 saved runs (telemetry `meta.json`, 2026-06 to 2026-11, mostly
`maxUrls` 3 to 10): links returned median 3, max 10; visible extraction text per
page median ≈4,100 characters (≈1,000 tokens), 90th percentile ≈7,100 (≈1,800),
largest run mean ≈10,900 (≈2,700); total extraction text per run max ≈55,600
characters (≈14,000 tokens). Token counts assume ≈4 characters per token.

Working figures (**confirmed by the owner, 2026-11-07**): 256,000 minus
≈3,000 for prompts and search summary, minus 32,000 reserved for the synthesis
(the largest cap after two retries), leaves ≈221,000 tokens for extractions, plus
≈100 tokens of headers per source. Sources that fit:

| Extraction size per source | Sources that fit |
|---|---|
| Typical (≈1,000 tokens) | ≈195 |
| Heavy, 90th percentile (≈1,800) | ≈118 |
| Largest seen (≈2,700) | ≈78 |
| Every extraction fills an 8,000-token cap | ≈27 |
| Every extraction fills a 32,000-token cap after two retries | ≈6 |

Proposed design: enforce the budget when collation starts, from the extractions'
actual sizes, rather than sizing `maxUrls` for the worst case. When the total
exceeds the budget, trim the longest extractions or drop the lowest-ranked sources
(inferred guesses first), and report what was trimmed. Cap each extraction's
visible text separately from its output cap, so a retry's larger reasoning
allowance cannot let one page take the budget. Then raise `extractMaxChars`
(150,000 characters, ≈37,500 tokens per page today) for long documentation pages;
the owner suggested 400,000 characters as a starting point. Settings: the budget,
the per-extraction text cap and the page cut-off, all defaulted.

**Owner decision (2026-11-07): keep these numbers and handle overflow
gracefully.** The worst cases (≈27 sources at full caps, ≈6 if every extraction
was retried twice) are an acceptable balance. The protection is the overflow
handling, not smaller numbers: a run that suddenly gets 10 heavy results instead of
the median 3 must still complete, trim in a stated order, and tell the calling
agent what was trimmed and where the full extraction is saved. Tests must cover a
run under budget (nothing trimmed), a run just over, and a run where every
extraction fills its cap after retries.

## Out of Scope

**Search breadth** (owner decision, 2026-11-07). No saved run returned more than 10
links, so more sources would need more search breadth (`searchWebSearch.maxResults`,
several queries). That is a future research topic for a separate branch, not this
one.

## Decisions of the Second Session (2026-11-07)

Owner decisions:

- **D1, worst-case latency: accepted, with a cap.** Each attempt's timeout scales with
  its output cap (`llmTimeoutMs × attemptCap / configuredCap`) and is capped at
  `4 × llmTimeoutMs`. With the defaults that is 120 s, 240 s, then 480 s, so one
  page can take ≈14 minutes before it fails, plus any transport retries.
- **D2, agent-in-the-loop checks: yes.** After live verification, a fresh Claude Code
  session (through the plugin) and a fresh `pi` session each receive degraded
  results from items 1, 3 and 5 with an ordinary question. They pass only if the
  agent opens a saved page or fetches an inferred asset unprompted. A failure here
  is fixed in the result wording or the skill guidance, not waived.
- **D3: proceed with the three-track herdr plan below.**

Orchestrator choices, binding on every track:

- **Saved-file layout shared by items 1, 3 and 5.** Pages keep today's names:
  fetched pages in `sources/`, successful extractions in `extractions/`, with the
  existing numbering. Item 1 writes every fetched page to `sources/` even when its
  extraction failed; a failed extraction writes no file in `extractions/`, and the
  report lists the page's `sources/` path and the failure reason. Item 3 saves a
  fetched inferred asset in `sources/` like any page; its provenance (`inferred`)
  and fetch outcome live in the result and `report.md`, never in the filename.
  Item 5 never alters a saved file: trimming applies only to the text sent to the
  collation model, and the report names the untrimmed file in `extractions/`.
- **Verification without the live path.** The happy-path E2E scripts do not reach
  items 1, 3, 4 or 5. Each must also pass a forced live run with an expected result
  written before the run (§ Method to Repeat, step 6): every extraction failing
  under a tiny cap (item 1), budget retries counted at 0, 1 and 2 (item 4), a small
  collation budget against real pages (item 5), and a query citing raw source files
  (item 3).

**Model substitution (2026-11-07).** `deepseek/deepseek-flash` began returning
`402 Insufficient Balance` during the track work. From round 2 on,
`openai-codex/gpt-6-astra` replaced it: as track C's builder (`fu-c-build-astra`,
from round 3) and as the second reviewer on tracks A and B. Reports keep the
reviewer's model in their file names.

Orchestrator decisions taken during the build (2026-11-07), each settled through
the track reviews:

- **Item 1.** Failure reports are recognised only by a marker on line 1, which caller
  text cannot reach. The legacy heuristic for unmarked reports was removed: no
  published release wrote a failure report, so unmarked reports left by development
  builds are preserved like any existing report.
- **Item 3.** Queries, fragments and numeric ports are kept; non-numeric ports and
  bare `host:port` without a TLD are rejected. A redirect or alternate is disclosed
  whenever the hostname changes other than by a leading `www.`; there is no
  public-suffix reasoning, because two hand-written approximations both missed and
  invented site boundaries.
- **Item 4.** A synthesis that keeps returning truncated text uses every configured
  retry. Candidates are chosen completed first (latest attempt first), then truncated
  longest first, and the first that passes provenance validation wins; when none
  passes, the first-ranked candidate's error is reported.
- **Item 5.** `collationSourceMaxTokens` defaults to 32,000 tokens, the largest
  output after two retries, so the confirmed worst case of ≈6 cap-filled sources fits
  whole. The trim notice names which limit bound (per-source, total or both) and the
  matching setting. Every integer tuning key shares one range table, used by the
  native validator and the MCP schema.

## Execution Plan

The owner expects herdr agents to work in parallel where possible. The orchestrator
plans, spawns, integrates and verifies; builders write code and tests; reviewers
check each track. Load `curio-herdr` and read its `references/worktrees.md` before
creating any worktree: a fresh worktree has no gitignored files (`node_modules/`,
built `dist/`) and must be provisioned first.

Three tracks, each a builder in its own worktree branched from
`rcca/mcp-research-failures` (for example `rcca/fu-a-failures`), in its own herdr
workspace. Builder models come from the roster's Builder rows; each track's two
reviewers are on models other than its builder's.

| Track | Items | Main files | Builder | Reviewers |
|---|---|---|---|---|
| A | 1, then 2 | `research.ts` failure paths, `provenance.ts`, native contract fixtures | `zai/glm-5.3` | `kimi-coding/k3.1-pro`, `deepseek/deepseek-flash` |
| B | 3 | `util.ts`, `tlds.ts`, `annotations.ts`, the fetch content-type gate | `kimi-coding/k3.1-pro` | `zai/glm-5.3`, `deepseek/deepseek-flash` |
| C | 4, then 5 | `completeWithBudgetRetry()`, timeouts, `defaults.ts`, `settings.ts`, MCP `config.ts`, the collation budget | `deepseek/deepseek-flash` | `zai/glm-5.3`, `kimi-coding/k3.1-pro` |

Rules for the tracks:

- **Builders do not edit user-facing docs** (`README.md`, `CHANGELOG.md`, `docs/`,
  `guidance/`, `skills/`) or the generated files: all three tracks would conflict
  there. Each builder writes a docs-change note in its report instead.
- Tracks A and C both touch `research.ts`, in different functions. Merge A first,
  then rebase C onto it.
- Item 5 depends on item 4's retry count (the 32,000-token reserve), so they stay
  in one track, in that order.
- Item 1 also feeds item 5 (saved extractions are where trimmed text is kept);
  agree the saved-file layout between tracks A and C before either codes it.
- Run each track's deterministic tests in its own worktree. Do not run the full
  gates or any E2E script while tracks are active: they share the provider key and
  the machine (`worktrees.md` § Run gates sequentially).

Integration, done by the orchestrator on `rcca/mcp-research-failures`:

1. Merge each track after both of its reviewers report no must-fix.
2. Write the docs and changelog from the builders' notes, folded into the
   `[pi-0.22.0]` and `[mcp-0.22.0]` sections, then run one prose review over all of
   it.
3. Run one combined code review round over the integrated branch, which also covers
   the review coverage gap and the open review findings below.
4. Run the gates and live verification, one at a time (§ Method to Repeat, steps 6
   and 7).
5. Record every new worktree, branch, workspace and scratch folder in `CLEANUP.md`
   as it is created.

## Open Review Findings

Settled during the follow-up (track A reports `fu-a-build-r2.md` and `-r3.md`, and
the combined review `fu-combined-review-*-r1.md`):

- kimi-r3 N4: accepted. Failure reports are recognised only by a line-1 marker, and
  unmarked development-build reports are preserved like any existing report.
- deepseek-r2 M7: fixed. The marker is stripped from agent-visible text and kept in
  the saved report.
- deepseek-r2 M9: accepted, fail-closed. An unreadable prior report is preserved
  rather than replaced, with a test pinning the behaviour.
- deepseek-r2 M10: the 100 ms wait was replaced by an event-ordered test; the
  combined review (astra C3) found it did not guard the cache lock, and it is
  strengthened in round 6 of track B's builder.

## Accepted Trade-Offs at Review Close (2026-11-08)

The combined review (`fu-combined-review-glm-r3.md`, `fu-combined-review-astra-r4.md`)
and the prose review (`fu-prose-r4.md`) closed with no must-fix. Accepted as is:

- astra R4-1 (Low): a Markdown link whose label is an S-number but whose URL points at
  a different supplied source is accepted by URL. Treat it as a citation-grammar
  limitation; a reserved citation form would be a later change.
- astra R4-2 (Low): any positive reported reasoning count selects the wording
  "hidden reasoning consumed every budget".
- glm R2-3 (Nit): the mixed-script guard keeps Latin with Deseret to preserve an
  existing keep row; it is not a full UTS #39 restriction.
- prose O1 to O4, N9, N10 and R4-1 (optional): left unchanged.

## Method to Repeat

The 0.22.0 fix was built this way; repeat it.

1. **Build with tests first.** For 0.22.0 the orchestrator built alone; for the
   follow-up, builders do it in parallel tracks (§ Execution Plan) and the
   orchestrator (Claude Code, Opus 5.5) integrates. Every builder writes
   deterministic tests first and mutation-checks each one: revert the fix, confirm
   the test fails, restore. Two tests in round one could not fail and were caught
   only by review; reviewers must repeat the mutation check.
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
