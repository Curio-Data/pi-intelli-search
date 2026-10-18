# Codemode Contract Status

Specification revision: `P0-2`. Status: accepted contract freeze after independent exact-revision review. This document records acceptance separately from the specification so a review can name an immutable contract commit without embedding its own hash in that commit.

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

The coordinator selected C03's capacity/configuration limits, C06's prespecified cancellation target, C08's timer precedence, C10's replacement gate, C11–C14's admission/pacing/fairness/catalogue ownership, C18's size bound and C21–C27's filesystem/journal/lock/reader/compatibility protocols. These are concrete specifications with future test obligations, not implemented proofs. Exact signatures are in [API.ts](API.ts) and native-only [NATIVE-API.ts](NATIVE-API.ts).

The earlier directory lock with manual-only crash release was blocked by review and is superseded. C25 now selects a pinned native kernel-lock primitive with automatic release on descriptor/process death and a permanent lockfile that is never replaced. [LOCK-EVIDENCE.md](LOCK-EVIDENCE.md) records source/primitive checks and remaining dependency/install/platform gates. Manual recovery concerns damaged allocation history, not ordinary crashed holders. No stale-age/PID fallback, history reset, policy cap or retention utility is introduced.

The first review blocked P0-1. The [final independent report](REVIEW.md) accepts P0-2 at `842c56fc539451c84b2cd8793a3265810a998058` and closes both blockers. [REVIEW-DISPOSITIONS.md](REVIEW-DISPOSITIONS.md) records amendments; [BUILDER-HANDOFF.md](BUILDER-HANDOFF.md) carries the binding non-network replay condition and later-stage notes. Acceptance covers specification only, not future implementation proofs.

## Acceptance Record

`SPECIFICATION-SHA256SUMS` hashes the candidate contract/native API/consumer/acceptance/method/corpus/checker bundle before acceptance. `acceptance.json` records the accepted revision, exact reviewed commit, native reviewer model/report hash, coordinator decision and unchanged specification-file hashes; `REVIEW.md` retains the final independent report. They are acceptance evidence, not runtime test reports. `npm run check:codemode-plan` runs `--require-accepted` plus the compile-only consumer and is wired into CI; every builder runs it at the accepted base. A pending candidate intentionally fails that strict accepted-state command while the plain diagnostic checker remains runnable. CI fetches history so the reviewed commit can be checked. Later corpus/method expansions use new versioned files rather than rewriting the frozen P0 bundle.

- Reviewed contract commit: `842c56fc539451c84b2cd8793a3265810a998058`.
- Bundle/report digests and full frozen-file list: canonical values in `acceptance.json`.
- Independent technical Reviewer: `claude-opus-5-5[1m]` through Claude Code; actual native provenance and 1M context variant verified.
- Coordinator acceptance: recorded by `openai-codex/gpt-6.1-sol` on 2026-10-18, with final report N1 binding on replay briefs.
- Accepted documentation commit for builder bases: `c198b19c5dcbd76c551964686b3eb272e5fbc927`. Builders require its subsequent matching type-seam descendant, not the bare pending-state review commit.

The current orchestrator is `openai-codex/gpt-6.1-sol`. The standing prose rule exempts work orchestrated by that prose-review model from a self-review; the independent technical reviewer must still inspect readability, source fidelity and scope. No self-review is counted as an independent pass.

## P0 Evidence and Limits

The prior source checkpoint is `129114f14c081c614b357b6fc90b4a056a49a308`. Its encrypted source archive, lockfile/prompt/settings hashes and observed host record were preserved before runtime changes. Current native and MCP runtime source remains that baseline. No live A0, pilot, feature implementation, package staging or publication is claimed.

The contract checker and compile-only consumer passed, including the new native transport type guards. Baseline build/test-all/native-contract types, generator drift and audit checks passed; the selected native lock's source/integrity, isolated audit and Linux descriptor/process-death primitive checks are recorded. The final independent review accepted the exact revision. The strict `npm run check:codemode-plan` gate passed with the accepted metadata, alongside the plain checker, type consumer, baseline build/test-all/native-contract types, generator drift and audit gates. No live end-to-end or paid study gate was run or claimed. Baseline regression success does not pass the future acceptance map. Runtime cancellation, complete replay through the actual bridge, native floor, packaging, protocol overlap, crash recovery and live suite remain P1–P8 gates.

## Next Stage

P0 is accepted. Before commissioning any builder, the coordinator first lands the matching central type/injection seams without pipeline implementation, then commissions library builders from that descendant carrying the accepted contract. Provide the exact accepted commit and relevant C/T clauses in each brief. P1/P2/P3 may then proceed in separate encrypted worktrees; shared pipeline/schema integration, paid drivers and release work remain coordinator-owned and sequential. Use the completed acceptance-record descendant and strict gate; do not commission builders from an old pending-state checkout.
