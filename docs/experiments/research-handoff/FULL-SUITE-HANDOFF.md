# Full Study Suite Handover

## Completion Notice

This incoming assignment is fulfilled. The configurable `rh-v8` runner collected the owner-approved ten matched pairs with two concurrent pairs, retained the complete population, graded every answer and settled the series. Start with [Ten-Pair Study Findings](SUITE-FINDINGS.md) and [Research Handoff Resume](RESUME.md). The text below is the preserved pre-collection handover, not authority to repeat the suite.

## Original Handover

The owner has assigned the full research-handoff comparison suite to a fresh agent. This handover prepares that work; it does not launch another paid run. The completed `rh-v7` one-shot test demonstrated a clean end-to-end workflow, with both answers failing quality. [Pilot Resume](RESUME.md) and [Repeat Findings](REPEAT-FINDINGS.md) record that checkpoint.

The [latest owner direction](../../../evidence/agents/20261108T142141Z-suite-handoff/owner-direction.json) makes cache cleanliness the primary handover concern. The checkout-root `.search` is absent. Its old contents were archived intact, and deterministic checks verified isolation of new run workspaces. Historical output caches remain preserved outside those workspaces.

## Entry Checks

Continue in the existing `study/research-handoff-runner` worktree. Its dependencies and ignored scientific evidence are already provisioned. Do not replace them, recreate the worktree or clean ignored files. Start with these read-only checks from the checkout root:

```bash
set -eu
git status --short --branch
if [ -n "$(git status --porcelain)" ]; then
  printf 'Unexpected working-tree changes: inspect before proceeding.\n' >&2
  exit 1
fi
if [ -e .search ] || [ -L .search ]; then
  printf 'Root .search exists: preserve and isolate it before collection.\n' >&2
  exit 1
fi
printf 'Tracked tree is clean; root .search is absent.\n'
```

Run this check again after preparation and immediately before measured collection. A clean Git status alone is insufficient: `.search` is ignored. The current runner enforces per-run emptiness but does not enforce absence of the checkout-root cache. Add that absence check as a pre-dispatch refusal in the multi-pair driver, with tests for a directory, file and dangling symlink. Do not use `git clean`, recursive `.search` deletion or a cache reset to satisfy the check.

## Preserved Cache and Isolation

The old root cache held a historical topic-validation result, not an input to the clean repeat. It was moved to [root-search-archive](../../../evidence/agents/20261108T142141Z-suite-handoff/root-search-archive/) without deleting a file. The [relocation receipt](../../../evidence/agents/20261108T142141Z-suite-handoff/cache-relocation.json) records original and new paths, every file's size and digest, a byte-identical comparison and the absence of open files at inspection. Historical records that name the original root path retain their recording-time meaning; the relocation receipt supplies the current path. The original topic-validation disclosure and all settled evidence remain unchanged.

Do not recursively remove `.search` directories below `evidence/` or `.tmp/`. The former hold cited results, and the latter hold retained fixtures and scratch. Neither is an active cache for a fresh measured conversation. Keep the archive, old answers and prior grades out of measured inputs and grader bundles.

The verified runner isolation is:

- `createRunDirectory()` in `scripts/research-handoff/storage.ts` creates a new run directory, empty `workspace/` and empty `agent/`; it refuses an existing run identity.
- `runPilotWorker()` in `scripts/research-handoff/pilot.ts` rejects a nonempty workspace before writing settings or creating the model session. A new run starts without `.search`, including without an old `.index.json`.
- `createStudySession()` in `scripts/research-handoff/host.ts` uses the per-run workspace and agent directory, an in-memory session and settings, and disabled discovery of ancestor context, extensions, skills and templates. The wrapper resolves the frozen relative cache setting `.search` against that per-run workspace.
- The direct read tool and candidate's nested read are contained to that workspace. Deterministic actual-host checks reject absolute, parent-relative and symlink escapes and prove that ancestor instructions do not enter the model prompt.
- The measured session receives the fixed task and operation. The accepted raw source corpus lives outside its readable workspace and is supplied through the research adapter, not as an old answer or report. Each run creates its own new report and index.

The [workspace verification](../../../evidence/agents/20261108T142141Z-suite-handoff/workspace-verification.json) binds the accepted source identity, empty-directory checks, a deliberately pre-populated workspace refusal, the [targeted isolation tests](../../../evidence/agents/20261108T142141Z-suite-handoff/reports/cache-isolation-tests.log), and unchanged `rh-v6` and `rh-v7` evidence manifests. This establishes the runner's intended isolation, not a security boundary against a coordinator with repository access.

Do not run root-level `intelli_research` or `intelli_collate` while preparing the suite: they can recreate the active cache. State this restriction explicitly in builder and reviewer briefs so generic instructions to use web research cannot override it. Put any separate preparatory research in a distinct working directory and recheck the study checkout before dispatch. Preserve the same empty-workspace and read-containment checks when extending the runner to multiple pairs. A fresh local cache does not disable provider-side prompt caching; retain the existing settings and report cached usage separately.

## Incoming Assignment

The next task is the full study comparison, not another single-pair pilot and not the package's general `test/run-e2e-all.sh`. The current `rh7-` commands deliberately accept only their settled one-pair root. They are implementation references, not commands that can start the larger suite unchanged.

1. Read the accepted [Repeat Protocol](REPEAT-PROTOCOL.md), the [implementation acceptance](../../../evidence/agents/20261107T195837Z-e2e-once/implementation-acceptance.json), and the current results. Keep historical outcomes intact. Do not tune the task or prompts from the reviewed answers.
2. Freeze a new full-suite protocol and schedule before live collection. Record the number of matched pairs, balanced arm order, outcome and incident accounting, and the cumulative spending admission. The latest message does not specify a pair count. Choose and justify the schedule as a study-design decision; do not silently treat the older ten-pair `rh-v4` schedule or unused single-pair slots as the current schedule. Escalate material changes to the scientific question, comparison criteria or spending ceiling, not routine harness details.
3. Extend the repeat mechanics to that new schedule and series identity. Preserve the task, same captured page bytes, matched research settings, complete-return measurement, fresh per-run directories and sessions, and the unchanged dual rubric. Collect both arms of each pair before answer grading. Implement both permitted arm orders without turning the baseline-first pilot prerequisite into an accidental restriction on the full suite.
4. Account for the settled prior series within the retained USD 10 ceiling unless the owner changes it. The [latest settlement](../../../evidence/benchmarks/research-handoff/20261107T195837Z-rh-v7-once/settlement-receipt.json) records USD 0.248450317 cumulatively for `rh-v5`, `rh-v6` and `rh-v7`, leaving USD 9.751549683 before new liabilities. The older `rh-v4` envelope is separate. The single-pair allowances of USD 4.09 per arm and USD 1.01 for qualification cannot be reserved afresh for every pair within this headroom. Use a shared cumulative admission model with sequential reservations and release only on known settlement; retain conservative attempt bounds and unknown-charge holds. Do not reduce a reservation merely to fit the schedule or grant a new USD 10 allowance per pair. Admit the full schedule against its own bounded allocation; a higher ceiling is an owner decision.
5. Run the deterministic build, native/standalone tests, explicit handoff tests and types, review-preflight tests and applicable generators. Qualify changed execution paths with credential-free actual-host cases, then obtain independent technical and fresh Opus prose acceptance at the final source/protocol identities. Existing pilot results are not acceptance of an untested multi-pair driver.
6. Follow the new accepted sequence for observers, explicit corpus reuse, charge qualification and measured collection. Perform the root-cache check above and record every newly created workspace as empty before dispatch. Reject an existing run directory or cache rather than clearing it and calling it fresh.
7. Finish every scheduled result through independent grading, any prescribed adjudication, financial settlement and reproducible analysis. Retain failures and operational incidents. Do not replace an unfavourable answer or silently retry a failed conversation. Produce the full-population report rather than selecting successful pairs.

The corpus-reuse policy carries the same `rh-v6` frozen search and twelve page texts; it does not recapture current web content. Independent corpus acceptance may be reused only with explicit byte and rubric equivalence, as the clean repeat did. Keep quality and operational cleanliness separate. The pilot's failed answers do not justify relaxing the rubric.

## Code and Verification Map

| Area | Starting Paths |
|---|---|
| Frozen Definition and Cumulative Accounting | `scripts/research-handoff/pilot-repeat.ts`, `pilot-config.ts` |
| Authority and Permanent Claims | `scripts/research-handoff/pilot-authority.ts` |
| Observe, Import, Qualify, Run, Gate, Settle, Analyse | `scripts/research-handoff/pilot.ts` |
| CLI Dispatch and Worker Process | `scripts/research-handoff/cli.ts`, `runner.ts` |
| Fresh Session and Read Containment | `scripts/research-handoff/host.ts` |
| New Empty Directories and Source Identity | `scripts/research-handoff/storage.ts` |
| Main and Downstream Measurement | `recorder.ts`, `pilot-analysis.ts`, `pipeline-client.ts` in the same directory |
| Review Format Preflight | `scripts/handoff-review-preflight.mjs` |
| Repeat and Isolation Tests | `test/handoff-repeat.test.ts`, `handoff-host.test.ts`, `handoff-registration.test.ts` |

Run from the checkout root with an existing `TMPDIR` under `.tmp/`:

```bash
npm run build
npm run test:all
npm run test:handoff
npm run typecheck:handoff
node --import tsx --test test/pilot-review-preflight.test.mjs
node_modules/.bin/tsc -p test/tsconfig.native-contract.json
npm run check:toc
npm run check:readmes
npm run check:plugins
npm run check:changelog
```

These are deterministic validation lanes, not the measured comparison. The accepted pilot host is the retained `Pi` 1.5.0 installation; do not reinstall peers or switch models to address a harness problem. Live credential use stays through the explicit non-refreshing reference `/home/miah0x41/.pi/agent/auth.json`; never copy or print it. The worker requires sufficient remaining access-token lifetime before dispatch. Record observer subscription usage separately from chargeable extraction and collation.

Current-source edits deliberately change `sourceIdentity`; record a new acceptance after review instead of rebinding an old receipt. Historical analyses retain their accepted identities and existing reproduction receipts. No package integration, publication, main merge or unrelated cleanup is assigned.

## Fresh-Agent Prompt

> Read `docs/experiments/research-handoff/FULL-SUITE-HANDOFF.md` first, then `RESUME.md`. The clean one-shot test is complete; prepare and conduct the full direct-research/Codemode study suite under a new frozen multi-pair schedule. Start by verifying clean Git state and absence of the checkout-root `.search`. Every measured conversation must have a new empty workspace, agent directory and session, with no previous answer cache. Historical caches are retained evidence, not input or cleanup targets. Preserve the accepted task, source corpus and quality rubric. The current `rh7-` commands are bound to a settled one-pair root and need a newly accepted multi-pair driver before further collection. Resolve routine harness details without owner intervention; do not infer unlimited spending or a pair count from old receipts.
