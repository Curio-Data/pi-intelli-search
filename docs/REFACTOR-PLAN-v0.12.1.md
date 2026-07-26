# v0.12.1 Simplification Refactor Plan

Status: draft. Branch: `refactor/v0.12.1-simplification` (from `main` @ 5673adf).

## Scope and Constraints

- **No user-facing changes.** No tool schema, settings key, cache format, prompt,
  or public API changes. Every step is behaviour-preserving; observable deltas are
  limited to internal structure plus one unified `[TRUNCATED]` marker (LLM-facing
  text, not a user interface).
- **Version:** patch bump to `0.12.1` in `package.json` at release time only.
  Not on this branch until release prep, per the release policy.
- **Gates:** `npm run build` + `npm test` after every step. Full paced E2E suite
  before merge consideration. Adversarial review by a second model before completion.

## Phase 1: Characterization Tests (source unchanged)

Goal: close the coverage gaps identified in the test audit so every refactor step
has a deterministic tripwire. These tests are written against the **current** code
and must pass without any `src/` modification.

1. **Parametric settings round-trip** (`test/settings.test.ts` extension).
   Table-driven test: for each of the 21 nested `pi-intelli-search` keys, write a
   settings.json with only that key set to a non-default value and assert
   `loadSettings()` returns it. Repeat for the 19 flat `intelli*` mappings, and
   assert nested-wins precedence for each key that has both forms. This guards the
   `extractOverrides()` table refactor, the highest-risk change.
2. **Pipeline `extraction-failed` outcome** (`test/research-telemetry.test.ts`).
   Harness mock: search succeeds with links, fetch succeeds, every extraction LLM
   call throws. Assert `meta.json` has `outcome: "extraction-failed"` and the tool
   result contains the search summary.
3. **Cache-suggest judge-run path** (`test/research-telemetry.test.ts`).
   Pre-populate `.search/.index.json` with an older entry, let the judge mock
   return a match, assert `stages.cacheSuggest.ran === true`, `surfaced > 0`, and
   the final output contains the `Related cached searches` appendix.
4. **Version equality** (`test/index.test.ts`).
   Assert `CURRENT_VERSION` in `src/index.ts` equals `package.json` `version`.
   Today nothing prevents drift.

**Gate 1:** `npm run build && npm test` green, 257 + new tests passing, zero `src/`
changes (`git diff --stat main` shows only `test/` and this plan).

## Phase 2: Refactor Implementation

Ordered steps. Each step is one commit; `npm run build && npm test` must pass after
each. If a step turns red and the cause is not immediately obvious, revert the step
rather than debugging forward.

### Step 1: `settings.ts` Key Tables

Replace the 40 hand-written `if` statements in `extractOverrides()` with two
declarative tables (`NESTED_KEYS`, `FLAT_KEY_MAP`) and uniform loops. One
documented presence rule replacing the current truthiness/nullish mix, chosen to
be strictly behaviour-preserving: a value counts as present when it is `!= null`
and, for strings, non-empty. This reproduces today's semantics (model objects and
strings use truthiness, numbers and booleans use `!= null`) for every realistic
input. The Phase 1 parametric test uses non-default truthy values per key, so it
locks behaviour without freezing the incidental edge case (golden-master pitfall:
coarse capture freezes quirks; per-key subtests keep diagnostics precise: a failure
names the exact key).

### Step 2: `util.ts` Error/Log Helpers

Add `errMsg(err: unknown): string` and `logErr(context: string, msg: string)`.
Adopt at the ≈8 sites repeating `err instanceof Error ? err.message : String(err)`
and the hand-typed `[pi-intelli-search]` prefixes. Behaviour-preserving.

### Step 3: `cache.ts` `withLock` and `sourceFilename`

Add `withLock(dir, fn)` wrapping acquire/try/finally/release. Adopt at the 5
lock sites in `intelli-research.ts` and `intelli-collate.ts`. Extract the repeated
`` `${String(i + 1).padStart(2, "0")}-${domainSlug(url)}.md` `` into
`sourceFilename(i, url)`. Guarded by existing lock and concurrency tests.

**Invariant to preserve (documented in the helper docstring):** the index lock is
only ever acquired while holding the cache lock, never the reverse. This single
acquisition order is what makes the two-lock nesting deadlock-free; `withLock`
must not make it easy to invert.

### Step 4: Shared Tool Builders (new `src/tools/shared.ts`)

Extract, with new unit tests for each:

- `appendDomainFilter(query, domains)` from the duplicated `site:` logic in
  `intelli-search.ts` and `intelli-research.ts`.
- `buildExtractionMessage(content, query, focusPrompt, maxChars)` from
  `intelli-extract.ts` and `extractPage()`. Unify the three `[TRUNCATED]`
  marker variants to one constant. e2e/06 greps case-insensitively for
  `truncat|exceeded`, so all variants pass; the unified marker keeps "truncated".
- `buildCollationMessage(query, cachePath, searchSummary, extractions)` from
  `intelli-research.ts` and `intelli-collate.ts`.
- `formatCacheAppendix(cachePath, succeeded, failed)` from the two result
  appendix builders.

New file `test/shared.test.ts` asserts structure: query line, cache path line,
source blocks, file references, appendix sections. This converts two uncovered
areas into covered ones at the moment of extraction.

### Step 5: `providers.ts` Cleanup

Delete the local `resolveAgentDir()` duplicate; use `getAgentDir()` from
`util.ts`. Compute `MODELS_JSON_PATH` lazily inside `ensureCustomModels()` so a
`PI_CODING_AGENT_DIR` set after module load takes effect (matches how tests set
the env var). Guarded by `providers.test.ts`.

### Step 6: `index.ts` Dead Handlers and Version Source

- Remove the empty `tool_execution_start`/`tool_execution_end` handlers.
  **Same commit:** update `test/index.test.ts:74`, which asserts those
  subscriptions exist and therefore locks in the dead code.
- Single-source `CURRENT_VERSION` from `package.json` via
  `readVersionFromPackageJson()` (already in `telemetry.ts`; move to `util.ts`
  if sharing needs it). Guarded by the Phase 1 version-equality test.

### Step 7: `fetch.ts` Legibility

Destructure `Promise.allSettled` results into named variables, eliminating the
`results[0]`/`results[1]` indexing and the `markdownPage!` non-null assertions.
Guarded by `fetch.test.ts`.

### Step 8: `util.ts` `extractSourceUrls` `matchAll`

Convert the three `while ((match = re.exec(text)))` loops to
`for (const m of text.matchAll(re))`. Removes the shared `let match` variable and
the `match!.index` non-null assertion in the pass-3 closure. Guarded by the 20
existing `extractSourceUrls` tests.

### Step 9: `intelli-research.ts` Pipeline Split

Extract `executePipeline()` into stage functions taking a `PipelineCtx` object:
`runSearchStage`, `runFetchStage`, `runExtractStage`, `runCollateAndCacheStage`,
`runCacheSuggestStage`. Make the three degraded early-return paths (no-links,
fetch-failed, extraction-failed) structurally uniform via one
`degradedReturn(outcome, message)` helper. Largest structural change; done late
so Steps 2 to 4 have already shrunk the function. Guarded by
`research-telemetry.test.ts` plus the Phase 1 additions.

### Step 10: Type Tightening

Add `OnUpdate` and `PiTheme` minimal interfaces to `types.ts`. Replace the
scattered `any` in `renderResult`, `onUpdate`, and `theme` parameters across the
four tools. Compile-time only; `npm run build` is the gate.

### Deferred (explicitly out of scope)

- **Prettier/dprint adoption.** Formatting churn across the whole repo mixed into
  a behaviour-preserving refactor makes review harder and bisection noisier.
  Recommend a standalone follow-up PR that adds the config and reformats in one
  mechanical commit.
- **`telemetry.ts` generic `record()`.** The five `recordX()` wrappers are
  covered by direct tests and are clear; the generic collapse saves little.
  Revisit if a sixth stage appears.
- **Banner comment standardisation.** Leave existing `═══` banners; apply a
  consistent style only to new code.

## Phase 3: Verification

1. `npm run build` clean.
2. `npm test`: all unit tests pass (257 baseline + Phase 1 + Step 4 additions).
3. `npm run test:smoke`.
4. **E2E, paced.** Run the full suite via the sequential runner with an increased
   gap to respect the OpenRouter rate-limit bucket:

   ```bash
   E2E_GAP_SECONDS=30 ./test/run-e2e-all.sh
   ```

   Seven scenarios, live LLM calls, ≈20 to 30 minutes total. Never run scenario
   scripts in parallel or back-to-back: bursting depletes the rate-limit bucket
   and produces degraded or hung runs (documented in AGENTS.md). If a single
   scenario fails transiently, rerun that script alone after a 60 second pause.
   Minimum bar per AGENTS.md: `e2e/01_main.sh` passes; full suite passes before
   any release.

## Phase 4: Adversarial Review (herdr, GLM 5.2)

Independent review by a different model, per the model-diversity rule: the builder
is Claude, so the reviewer must not be. GLM 5.2 (`zai/glm-5.2`, 1M context) runs
in a separate herdr pane so the owner can watch and attach.

1. Write a review brief (`BRIEF-review-glm.md`, confirm gitignored or delete
   after) containing: the goal (behaviour-preserving refactor), this plan, the
   full diff (`git diff main...HEAD`), and an explicit READ-ONLY instruction
   (`pi` runs tools autonomously; its only permitted write is its own report
   file `review-v0.12.1-glm.md`).
2. Spawn in a new tab of this workspace (`w1N`), never with `--print`:

   ```bash
   P=$(herdr agent start review-glm --cwd /srv/secure/repos/CURIO/pi-intelli-search \
       --workspace w1N --no-focus -- \
       pi --provider zai --model glm-5.2 @BRIEF-review-glm.md \
       "Perform the adversarial review described in the brief." \
       | jq -r '.result.agent.pane_id')
   herdr pane move "$P" --new-tab --label "review-glm" --no-focus
   ```

   The `@file` and the message must be separate argv tokens.
3. Wait correctly: a fresh agent is briefly `idle` before starting, so wait for
   `working` first, then `idle`:

   ```bash
   herdr agent wait review-glm --status working --timeout 60000
   herdr agent wait review-glm --status idle --timeout 1800000
   ```

4. Adversarial focus areas for the brief: dropped or misspelled settings keys,
   changed lock ordering (cache lock vs index lock), altered prompt text, altered
   `[TRUNCATED]` semantics, extracted-helper behaviour drift vs the original
   inline code, test changes that weaken assertions.
5. Triage: verify every finding against the code before acting. Fix or rebut
   each with evidence. Reconcile to **zero unresolved HIGH** findings. Record
   reviewer model from the spawn argv (not self-report) in the final summary.

## Phase 5: Wrap-up

- Commits: one per phase, messages per repo convention (concise first line,
  bullet summary, no co-attribution, author `miah0x41`).
- `CHANGELOG.md`: per the changelog principles, internal refactors are omitted
  unless they affect compatibility. Candidate: no entry, or a single `### Changed`
  line "Internal simplification and test-coverage hardening; no behaviour change."
  Decide at release prep.
- `package.json` version stays `0.12.0` on this branch; the `0.12.1` bump happens
  only during release preparation with explicit user approval.
- No GitHub Release, no npm staging, without explicit user approval.

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| OpenRouter rate limits during E2E | Sequential runner, `E2E_GAP_SECONDS=30`, single-scenario rerun after 60s pause on transient failure |
| Test locks in dead code (`index.test.ts:74`) | Handler removal and test update in the same commit |
| Settings key dropped in table refactor | Phase 1 parametric round-trip test written before touching `settings.ts` |
| Unified TRUNCATED marker breaks E2E | e2e/06 greps case-insensitively for `truncat\|exceeded`; unified marker retains both stems |
| GLM reviewer stalls or context-blows | Checkpoint idiom: `herdr agent send` + `pane send-keys Enter` if idle with unsubmitted text; its window (1M) fits the whole repo |
| Scope creep into formatting/prettier | Explicitly deferred; separate PR |

## Verification of This Plan

Methodology checked against current external guidance via `intelli_research`
(cache: `.search/2026-07-26-behaviorpreserving-refactoring-best-practices-characterization-3010bf/`).
Findings and how the plan responds:

1. **Confirmed:** characterization tests before touching code; small steps with
   frequent commits; refactor commits kept separate from feature work; rerun the
   full suite after each step and inspect failures immediately; revert a red step
   rather than debugging forward. Phases 1 and 2 already encode all of these.
2. **Golden-master pitfall: freezing incidental behaviour.** Coarse capture locks
   in quirks. Response: the parametric settings test asserts per-key with
   non-default truthy values (per-key subtest names keep diagnostics precise),
   and Step 1's presence rule is specified to reproduce current semantics rather
   than "improve" them mid-refactor.
3. **Do not rely on broad snapshots alone.** Response: extracted helpers in Step 4
   get their own targeted unit tests at the moment of extraction, so coverage
   moves from incidental (inline code) to explicit (tested pure functions).
4. **Formal invariants complement tests.** Response: the lock-acquisition-order
   invariant is now documented explicitly in Step 3 as a property `withLock`
   must preserve, since no test can prove absence of deadlock.
5. **Keep mechanical formatting separate.** Response: prettier adoption is
   deferred to its own PR (refactor commits separate from non-refactor churn).
