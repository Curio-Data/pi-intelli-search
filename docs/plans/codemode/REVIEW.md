# F7 Specification Delta R2 Review

Reviewer: `cm-f7-spec-review`, *Claude Code* running `claude-opus-5-5[1m]` (native provider), read-only. Date: 2026-10-23.

Reviewed commit: `1a7ce89f9033ab5c2d37ac0c5d66dd248e2f7e41` (specification revision `P0-3-F7`, amendment `F7-1`), parent `0f76a74061b8de1e7145165d62a99e23714fc767`, approved handover base `568cd52a970bd9de12363d6503ddda940a55e3d8`.

VERDICT: ACCEPT

## Verdict Summary

I accept the revision at `1a7ce89f9033ab5c2d37ac0c5d66dd248e2f7e41` for specification-only acceptance. Both blockers from the initial review (`review.md`, SHA-256 `7cf4674a1e8a281b535f96b711160bfad729c3d6e5eb666e0cff84612a3f5962`, preserved unchanged) are resolved in normative text and in the frozen declaration:

- B1 is resolved by the reviewer's option (b).
- B2 is resolved by an index-visible `indexed` notification plus an `unavailable` notification.

M1 and M2 are resolved. M3, M4, L1, L2, L3, L5 and L6 are addressed. M5 and L4 are partly addressed, with the residue openly disclosed. That residue does not block. Six low residual points remain (R1 to R6). None needs another revision before implementation; each can go into the implementation brief or the eventual acceptance notes.

This verdict does not accept M3 implementation, permit implementation before coordinator acceptance is recorded, or count as a full-suite pass. `test:all` is intentionally red at this commit, which is declared condition `F7-TYPE-LAG`.

## Integrity Checks (Observed)

- `git rev-parse HEAD` = `1a7ce89f9033ab5c2d37ac0c5d66dd248e2f7e41`. `git status --porcelain` was empty before and after the review.
- `candidate-r2.sha256` has SHA-256 `81c8c7fcad481a248482cd808c82de6a57f665dc92c31187a0a5f50c79591163`, matching `DELTA-R2.md`. All 15 file entries pass `sha256sum -c`.
- The manifest's file set equals `git diff --name-only 568cd52 1a7ce89` exactly, so the delta is complete against the approved handover.
- The README files do not appear because they are now byte-identical to `568cd52`.
- `git diff --stat 0f76a74 1a7ce89` touches 15 files, all documentation or specification files plus the checker. Nothing changes under `src/`, `packages/mcp/src/`, `test/fixtures/` or the corpus. `test/codemode-plan-revision.test.ts` is unchanged (`caa6b547…`).
- P0-2 history is unchanged: `history/P0-2/acceptance.json` `40aca10e…`, `REVIEW.md` `b70abc91…`, `SPECIFICATION-SHA256SUMS` `b0e154ba…`. The diagnostic checker re-verifies these against reviewed commit `842c56f`.
- `method-authority-F7-1.json` changes only the amendment digest, to `b053701f…`, which matches `METHOD-F7-1.md`. The base method and corpus manifest digests are unchanged.
- N1 is unchanged and still quoted verbatim in `F7-REPLAY.md`. The revised seam adds only notifications. It exposes no fetch, transport, tee or network capability.

## Commands Run (Observed)

Private `HOME`, `PI_CODING_AGENT_DIR`, `TMPDIR` and npm cache under `.tmp/agents/codemode-f7-spec-review/work/r2/env/`, with no credentials. Logs are in `work/r2/`.

| Command | Exit | Note |
|---|---|---|
| `node scripts/check-codemode-plan.mjs` | 0 | Diagnostic checker (`diag.log`) |
| `node scripts/check-codemode-plan.mjs --require-accepted` | 1 | Intentional strict rejection, `actual: 'pending'` and `expected: 'accepted'` (`strict.log`). Not a passing gate |
| `tsc -p docs/plans/codemode/tsconfig.json` | 0 | Specification consumer types |
| `tsc --noEmit -p test/tsconfig.native-contract.json` | 0 | Native-contract types |
| `node --import tsx --test test/codemode-plan-revision.test.ts` | 0 | 6 of 6 pass |
| `node --import tsx --test test/codemode-seams.test.ts` | 1 | Exactly one TS2344, at `test/fixtures/codemode-seams.typecheck.ts:26:3`. This is the declared `F7-TYPE-LAG` assertion, and there are no other errors |
| `tsc -p work/r2/probe/tsconfig.json` | 0 | Probe: the revised `NativeSuggestionReadView` compiles in transport-replay mode. `committed` is rejected as an excess property and `unavailable` is required (both checked with `@ts-expect-error`) |

I did not run full gates, installs, audit or any live command, as instructed. The coordinator's `gates-r2-exact/` logs show HEAD `1a7ce89` before and after, a clean status, and all 14 results matching their declared expectations. Native `test:all` reports 1256 tests: 1254 pass, 1 fail, 1 skipped. MCP reports 87 of 87 pass. These match `DELTA-R2.md`. I cite them as log content, not as my own reproduction.

## Disposition of Initial Findings

| Finding | Status | Evidence and Assessment |
|---|---|---|
| B1: Missing Submission Witness | Resolved | `F7-REPLAY.md` Block Identity: ownership binds by exact query uniqueness among simultaneously active report producers. Serial repeated research needs a frozen occurrence order with prior settlement. Overlapping identical research or collation queries invalidate the block. T30 (`ACCEPTANCE.md`) and the Acceptance Proofs section narrow "repeated identical calls" to model-request occurrences and serial repeated research. `METHOD-F7-1.md` matches. No invented start seam. The corpus has unique `workflowQueries` within every item, so the qualifying population is unaffected (Observed in my earlier review) |
| B2: Index Visibility and Failure | Resolved | `NATIVE-API.ts`: `indexed` is documented as firing only after `updateIndex` resolves `"updated"`. `unavailable` carries phase `allocation`, `commit`, `index` or `operation`. The text states immediate invalidation of dependent reads, host settled events for failures before any notification, and the block budget as backstop. Notification exceptions invalidate the block externally, are contained natively, poison later reads and never change a store outcome. This matches the source ordering (`src/core/research-result.ts:648-686`) |
| M1: Type Lag Disclosure | Resolved | Tracked `STATUS.md` and `BUILDER-HANDOFF.md` disclose the exact assertion, a red `test:all` and closure by the first implementation commit. `acceptance.json` carries `N1` and `F7-TYPE-LAG`. The strict checker now asserts both, plus `priorAcceptance` and `acceptanceScope: "specification-only"`. The equality test is unchanged |
| M2: Badge | Resolved | All four README files are byte-identical to `568cd52`, with the badge at `1336 passing` and no green full-suite claim (see R3) |
| M3: UTC-Date Grouping | Resolved | New Dependency Ownership paragraph: a date-dependent change or a midnight-crossing block invalidates when the frozen view cannot be verified. Keys and dates are never bound or changed, and rerun reasons are kept append-only. Schedules must avoid midnight crossings |
| M4: Populations | Resolved | `METHOD-F7-1.md`: each item's schedule is fixed in its run manifest before capture, schedules are never pooled into one estimator, and H1 is unchanged |
| M5: Readability | Partly resolved, accepted | The method introduction is split into sentences. The negative proofs are now one list item per invalidation group. Some slash compounds remain in the controller rules (for example, "baseline additions/removals/metadata changes"); in context each reads as "any of", so validity is unaffected |
| L1: Legacy Verification | Resolved | Rule 1 now distinguishes new-format marker, journal and file-hash verification from the accepted legacy verification |
| L2: Call Site | Resolved | Binding rule 1 names `src/core/research-result.ts` `suggestions()` and `formatIndexForJudge(index, "")`. Observed to match the source template |
| L3: Formatter Tension | Resolved | A benchmark-side segment builder must match both the unchanged production formatter and the actual `userMessage`, byte for byte |
| L4: Checker Coverage | Partly resolved, accepted | Strict assertions for prior acceptance and binding conditions are added. Consumer use of the seam and strict-positive tests are deferred to implementation and disclosed (see R5). The file-level guard is described accurately |
| L5: Nested Identity Capture | Resolved | `F7-REPLAY.md` requires snapshotting every nested controller function at factory capture and rejecting unknown or non-function members |
| L6: Handoff Mixing | Resolved | `BUILDER-HANDOFF.md` separates the pending-revision paragraph from the historical P0-2 paragraph |

The enclosing-budget point from my feasibility notes is also adopted: the wait budget must fit within the script budget, and expiry of any enclosing budget invalidates the block.

## Residual Points (Non-Blocking)

R1 to R4 are clarifications for the implementation brief. R5 and R6 note follow-on work and checks I could not make.

### R1 (Low). Commit Success Is No Longer a Separate Notification

The text says "Record successful commit separately from index visibility". The seam now has no `committed` notification.

**Inferred:** commit success can be derived from `indexed`, or from `unavailable` with `phase: "index"`, because index work follows only a successful commit. The implementation brief should state that derivation so that recording does not invent an extra hook.

### R2 (Low). The `operation` Phase Is Not Defined

The text routes failures before any notification through the host's settled tool-result or error event. It does not say when the native adapter itself fires `unavailable` with `phase: "operation"`.

**Recommended brief text:** the native adapter fires it once when an operation that has already been allocated settles without `indexed`, or with any other `unavailable` phase, for example on abort or a thrown error between `allocate` and `updateIndex`.

### R3 (Low). The Badge Understates Rather Than Overstates

At this commit 1341 tests pass (1254 native and 87 standalone), 1 fails and 1 is skipped. The badge shows `1336 passing`, the last fully green count. No overclaim results, and tracked `STATUS.md` discloses the red suite. Update the badge when the type lag closes.

### R4 (Low). `F7-TYPE-LAG` Stays "Required" Permanently

The acceptance record is immutable after acceptance, and the strict checker will keep requiring the condition with `status: "required"`. Closure therefore has to be evidenced elsewhere, in development notes and the integrated M3 review, without mutating `acceptance.json`. State that in the implementation brief.

### R5 (Low). New Strict Assertions Lack Focused Tests

`test/codemode-plan-revision.test.ts` does not exercise the new `bindingConditions`, `priorAcceptance` or `acceptanceScope` assertions. The coordinator's acceptance commit will exercise them for real when the strict gate runs. A mutation test that removes `F7-TYPE-LAG` from an otherwise accepted fixture should follow with the implementation.

### R6 (Not Investigated). Coordinator-Owned Evidence

These points depend on the coordinator's work, not on this revision:

- **Operation phase timing:** I did not check whether every allocated native failure path can fire `unavailable` with `phase: "operation"` before settlement. That is implementation evidence for the integrated M3 review.
- **Host settled events:** host tool-result and error events are named as the witness for failures before allocation. Showing that they are observable through the real Codemode bridge falls under T30 proof.

## Design Feasibility (Unchanged Assessment)

The feasibility conclusions of the initial review still hold:

- **Seam placement:** the per-operation `RunStore` places the seam.
- **Reference validation:** frozen candidate arrays support it.
- **Waits:** no model permit or lock is held during them, and publication-only dependencies cannot form a cycle.
- **Binding:** the message template has whole-field leaves, and judge responses carry indices.

The revised notifications fit the observed source order: `allocate` (`research-result.ts:791`), then `commit` (`:648`), then `updateIndex` (`:674`), then `suggestions()` (`:686`). All statements here are design assessments. No runtime behaviour of the seam exists to observe.

## Claim Basis and Limits

- Repository files at `1a7ce89` and installed `node_modules`, inspected on 2026-10-23. No web lookups were needed, because no new external library behaviour is relied upon.
- The six commands above are my own reproduction. Full-gate results are the coordinator's logs.
- Prose fidelity: the new text preserves the owner's scope wording on parallelism, exact text, clocks and identifiers, and corpus labels. It records the type lag as a failure, not a pass, and claims no implementation. The *Sol* prose self-review exception is the coordinator's and is not counted here.

STATUS: COMPLETE
