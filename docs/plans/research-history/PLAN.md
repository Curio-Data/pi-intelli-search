# Research History Evaluation Plan

Status: deferred to a separate future branch by the owner on 2026-10-18. This document records context, alternatives and a test-first approach for a future agent. It does not select a new reuse policy, authorise implementation on the Codemode branch, or record completed tests.

## Scope

Evaluate how existing research reports are grouped, surfaced and used across the native `Pi` extension and the Model Context Protocol (MCP) adapter. These are shared research-history questions, not a difference between `Pi` and MCP. Keep them separate from the current concurrency, deadline and native Codemode implementation.

The owner requested that the questions, their context and the proposed no-paid-inference tests be preserved for later work. Earlier provisional acceptance of an index-policy bundle does not authorise implementing that redesign on the Codemode branch after this scope correction.

No future branch or worktree has been created by this plan. Candidate branch name: `feat/research-history`; check for conflicts and obtain the applicable implementation approval before creating it.

## Origin

The Codemode design needs concurrent, independently owned cache runs rather than unsafe replacement of a shared deterministic directory. That exposes two separate concerns:

1. Storage correctness: exclusive ownership, safe publication, verified report paths, lock/index consistency and compatibility with older writers/readers.
2. Research-history usefulness: which of several reports represents a query, which old reports should be suggested, and how older or differently focused reports remain discoverable.

Only the first concern belongs to the current branch. It must preserve existing supported suggestion behaviour through the storage transition rather than silently introduce a new ranking policy or reset history. Any necessary compatibility adapter must be justified and tested as compatibility, not used to introduce the deferred design.

The original conversation drifted from storage correctness into choosing history policy before representative tests. The owner moved those choices and tests here. Do not resume them as unresolved P0 gates for Codemode.

## Starting Behaviour

The source checkpoint for this observation is commit `129114f14c081c614b357b6fc90b4a056a49a308`. At that checkpoint, `src/core/cache.ts` defines:

- `updateIndex()`: remove an existing entry with the same stored slug, then append the updated entry with query and timestamp.
- `judgeCandidates()`: exclude the supplied current slug and select the final `MAX_JUDGE_ENTRIES` entries. This is not semantic query/focus grouping.
- `formatIndexForJudge()` and `parseJudgeResponse()`: use the same candidate array so a numbered response resolves to the report shown to the judge.

`src/core/operations/research.ts` owns the live pipeline and supplementary suggestions. Existing reports are pointers to prior evidence, not automatic substitutes for live search. Inspect the actual implementation and tests at the future branch's base; do not assume the Codemode storage transition leaves every internal representation unchanged.

## Questions and Alternatives

### Group Identity

Consider a repeated query such as `PostgreSQL hosting comparison`, with the same domain restriction but different focuses: pricing, then backup and recovery.

| Candidate | Benefit to Test | Risk to Test |
|---|---|---|
| Existing Slug-Based Behaviour | Preserves current expectations and supplies a control | Run-layout identity may not match the intended research identity |
| Exact Query and Canonical Domains; Focus as Metadata | Limits near-duplicate groups and leaves room for diverse history | A newer pricing report can hide a useful recovery report from suggestions |
| Exact Query, Canonical Domains and Focus | Keeps distinct research angles independently discoverable | Paraphrased focus text can fragment groups and fill candidate windows |

Preserve case-sensitive technical identifiers. Define domain equivalences explicitly. Do not assume semantic equivalence from a short display hash or automatically normalise distinct technical queries. Record the full original query, focus and filters as provenance even when a candidate grouping policy omits them from its key.

### Recency and Selection

The earlier proposal selected the newest successful report per group, used a configurable index cap of 500, suppressed the current group from the related-search judge and preserved every run directory. These are candidates for evaluation here, not current-branch implementation requirements. The entry bound is not disk retention, and the candidate window shown to the judge is a different limit from the stored index bound.

Define how admission time, completion time, freshness, failed runs and materially different focuses affect selection. Storage safety must prevent older-finishing writers from corrupting newer state; it does not by itself establish which report is most useful. Decide cross-namespace and legacy-filter treatment without inventing missing provenance.

### Previous-Report Navigation

A separate verified link to the previous successful same-group report can provide history without occupying a related-search judge slot. It is navigation, not an automatically generated comparison or permission to reuse a stale answer. Compare that option with no separate link and with other bounded presentation choices only if their additional scope is approved.

Define which group identity applies, what previous means under concurrency, and how date/focus labels prevent confusion. Never advertise missing, failed or uncommitted reports. The Codemode branch does not add this link.

### Reuse and Freshness

Keep discovery, optional follow-up reading and replacement of live work distinct. Evaluating suggestion policy does not authorise skipping live search or serving cached answers automatically. Any later reuse mechanism needs its own freshness, provenance, domain/filter compatibility and failure rules, plus explicit scope approval.

## No-Paid-Inference Evaluation

Begin with a local selector experiment over read-only copies of approved saved histories and deliberately constructed fixtures. Label synthetic inputs as synthetic. Missing representative real histories limit a usefulness claim; they do not prevent testing correctness.

1. Freeze inputs, expected invariants, candidate policies and evaluation questions before comparing outcomes. Keep originals untouched and private captures on the encrypted drive. Publish only approved sanitised fixtures.
2. Build deterministic cases for repeated identical searches; distinct and paraphrased focuses; case-sensitive queries; equivalent and different domain filters; failures; missing reports; corrupt/unsafe entries; legacy records with unknown filters; simultaneous runs; and older runs finishing last.
3. Apply each policy to identical inputs, preserving the same index/candidate/output budgets where possible. Record differences that are inherent to the policy rather than silently equalising them afterwards.
4. Compare selected report identities, materially different focuses retained, redundant slots, useful reports omitted, coverage at fixed bounds and previous-report visibility. Review examples without policy labels when assessing usefulness.
5. Verify prompt/response numbering against the identical selected candidate array. Use a recorded or stubbed judge to test this interface; that proves mapping, not live model relevance.
6. Measure local selector and scan cost across increasing histories. Distinguish index eviction from disk deletion, and create no automatic deletion utility as part of this evaluation.
7. Retain all outcomes and counterexamples. Synthetic expectations can prove a rule is implemented; they cannot prove real-world relevance or establish the best universal configuration.

No new search, extraction, collation or model-judge call is needed for these initial tests. Human inspection and deterministic replay are sufficient to expose selection trade-offs. If live judging or fresh histories become necessary, propose a separately authorised small tranche; do not inherit the Codemode OpenRouter allowance automatically.

## Choice and Delivery

After the offline comparison, present concrete candidate lists and failure examples, explain the trade-offs and recommend a methodology supported by those observations. Select the policy before implementation. If evidence supports different workload choices rather than one winner, state that limitation and justify any configuration surface instead of adding settings automatically.

Future deliverables:

- Versioned method and input manifest with source, fixture and policy hashes.
- Deterministic correctness tests and a reproducible local comparison command.
- Results and counterexamples, including limits on representativeness.
- Owner decision record covering grouping, selection, limits, suppression, previous-report navigation and any separately approved reuse behaviour.
- Implementation and migration/compatibility plan, with native/MCP parity and no unexplained history reset.

## Resume Instructions

Read this document, the future checkout's `AGENTS.md`, its current cache/index implementation and relevant tests. Reconcile the source checkpoint above with the actual branch base. Preserve the distinction between Codemode storage correctness and deferred history-policy improvement. Do not reopen completed Codemode evaluations, treat these alternatives as accepted designs, run the proposed evaluation in the Codemode branch, or spend model quota without the applicable approval.
