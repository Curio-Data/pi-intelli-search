# Codemode Contract Status

Specification revision: `P0-1`. Status: candidate, independent exact-revision review pending. This document records acceptance separately from the specification so a review can name an immutable contract commit without embedding its own hash in that commit.

## Owner Decisions

| Decision | Current Disposition |
|---|---|
| Execution Defaults | Accepted unmeasured streaming defaults, C03. |
| MCP Output | Compact projection accepted; implementation/visibility budget tests remain C18. |
| Standalone Timeout | Direct native policy retained; supplied scripts use finite budgets, C15. |
| History Policy | Explicitly deferred, not a P0 blocker; [future plan](../research-history/PLAN.md), C26. |
| Legacy Compatibility | Minimal read-only compatibility retained, not a relevance redesign, C27. |
| Main | Subscription `Pi` `openai-codex/gpt-6.1-sol` for every arm, C31. |
| Judges | Subscription Opus 5.5 and fresh blinded Sol 6.1 sessions, C32. |
| Isolation | Pre-configured encrypted worktrees and supported overrides are sufficient, C31. |
| Paid Tranches | Approximately US$30 envelope discussed; exact executable tranches remain later approvals, C31. |
| Confirmatory Study / Ablation | Later D6/D7 decisions remain open at their named gates, C31/C32. |

## Engineering Selections

The coordinator selected C03's capacity/configuration limits, C06's prespecified cancellation target, C08's timer precedence, C10's replacement gate, C11–C14's admission/pacing/fairness/catalogue ownership, C18's size bound and C21–C27's filesystem/journal/lock/reader/compatibility protocols. These are concrete specifications with future test obligations, not implemented proofs. Exact signatures are in [API.ts](API.ts).

The no-eviction lock deliberately trades automatic crash recovery for race-safe ownership and useful non-persisted answers. Manual recovery must stop writers and preserve evidence. No library dependency, automatic stale removal, policy cap, retention utility or platform-support expansion is approved by this selection.

## Acceptance Record

- Reviewed contract commit: pending.
- Final contract content digest: pending.
- Independent technical Reviewer/provenance/report digest: pending.
- Coordinator acceptance: pending.
- Accepted documentation commit for builder bases: pending.

The current orchestrator is `openai-codex/gpt-6.1-sol`. The standing prose rule exempts work orchestrated by that prose-review model from a self-review; the independent technical reviewer must still inspect readability, source fidelity and scope. No self-review is counted as an independent pass.

## P0 Evidence and Limits

The prior source checkpoint is `129114f14c081c614b357b6fc90b4a056a49a308`. Its encrypted source archive, lockfile/prompt/settings hashes and observed host record were preserved before runtime changes. Current native and MCP runtime source remains that baseline. No live A0, pilot, feature implementation, package staging or publication is claimed.

P0 results will record the contract checker, compile-only consumer check, baseline build/tests/generators/audit, filesystem primitive probe and exact-revision review. Baseline regression success does not pass the future acceptance map. Runtime cancellation, complete replay through the actual bridge, native floor, packaging, protocol overlap, crash recovery and live suite remain P1–P8 gates.

## Next Stage

After P0 acceptance, the coordinator first lands the matching central type/injection seams without pipeline implementation, then commissions library builders from that descendant carrying the accepted contract. Provide the exact accepted commit and relevant C/T clauses in each brief. P1/P2/P3 may then proceed in separate encrypted worktrees; shared pipeline/schema integration, paid drivers and release work remain coordinator-owned and sequential. Do not commission builders from this pending candidate.
