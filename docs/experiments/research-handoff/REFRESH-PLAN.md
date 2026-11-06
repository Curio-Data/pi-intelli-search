# Research Handoff Refresh and Pilot Plan

Status: historical commissioning plan. The owner approved this profile and ceiling on 5 November 2026 in the [owner decision](../../../evidence/agents/20261105T173919Z-handoff-resume/owner-decision.json). The implementation and observer gates subsequently passed, but the single fresh corpus was rejected and the series closed before qualification or paid pilots. [Pilot Findings](PILOT-FINDINGS.md) records the result. Forward-looking text below preserves the original plan; it authorises no continuation. Start a new session with the current [Pilot Resume](RESUME.md).

## Baseline

On 5 November 2026, a fresh fetch of `origin/main` resolved to `d2ec50611ede2f5d46c062b7e568b13203015c22`, which is already the experiment's product baseline. The runtime source under `src/` is identical. The [baseline check](../../../evidence/agents/20261105T162901Z-handoff-refresh/reports/baseline-check.log) records these observations.

The reasoning-budget fixes on main are already present: extraction has an 8,000-token cap, exhaustion handling and truncation diagnostics. Collation still has a 4,000-token cap. A merge or cherry-pick would import no newer runtime fix. The refresh therefore needs matched experiment settings rather than a package update.

Keep the completed `rh-v4` sources, records, assessments, analysis and claim gate under their existing identities. [Findings](FINDINGS.md) remains its result. The [audit](../../../evidence/agents/20261105T144052Z-rh-v4-audit/reports/audit-summary.md) explains why another unchanged batch is not recommended.

## Offline Corrections

The current patch corrects declaration attribution for transmitted `additional_tools` messages and logical `toolsAdded` declarations. It also reads downstream cache-write fields, exposes the gap between the whole-request proxy estimate and the component sum, and retains provider-supplied itemised input usage separately from proxy estimates. Provider component counts are withheld where the parent counts do not reconcile. An unrecognised declaration shape withholds only its declaration count; reconciled instruction counts remain available.

The analysis now reports serving providers for final logical downstream completions, invocation behaviour separately from pipeline success, and event-derived pipeline outcomes alongside historical labels. Newly recorded research errors no longer default to `not-started`. The historical conformance predicate, paired population and positive-claim rule remain unchanged; the corrected re-analysis is a new output, not a replacement of the accepted result.

Deterministic tests cover both declaration shapes, nested schema fields, provider-count reconciliation, missing and invalid usage, known cache-write zeros, unknown routes and failed pipelines that used the assigned invocation pattern. The validation lane remains build, native and standalone tests, handoff tests and types, native-contract types, and applicable generator checks. No package live suite or security workstream is commissioned.

## Corrected Re-Analysis

The [corrected analysis](../../../evidence/agents/20261105T162901Z-handoff-refresh/analysis-corrected-final-1/summary.md) is a separately identified re-analysis of the retained `rh-v4` records. A second fresh output reproduced its three analysis artefacts byte-for-byte. The [verification](../../../evidence/agents/20261105T162901Z-handoff-refresh/reanalysis-verification-final.json) confirms that historical inputs, paired metrics, counts and the rejected claim gate remain unchanged.

The corrected view reconciles all 48 main-provider attempts, recognises known downstream cache-write zeros and exposes every final downstream completion's serving provider. Seven historical `not-started` labels remain in the records but are now accompanied by event-derived errors. All seven failed runs are separately recognised as making the prescribed initial research invocation. Later recovery reads and full-topology conformance have their own fields. Neither diagnostic correction makes those runs eligible under the frozen gate.

## Validation

The final deterministic lane passed with identical source identities [before](../../../evidence/agents/20261105T162901Z-handoff-refresh/source-final-before.json) and [after](../../../evidence/agents/20261105T162901Z-handoff-refresh/source-final-after.json) validation. Retained logs cover [build](../../../evidence/agents/20261105T162901Z-handoff-refresh/reports/final-build.log), [native and standalone tests](../../../evidence/agents/20261105T162901Z-handoff-refresh/reports/final-test-all.log), [handoff tests](../../../evidence/agents/20261105T162901Z-handoff-refresh/reports/final-test-handoff.log), [handoff types](../../../evidence/agents/20261105T162901Z-handoff-refresh/reports/final-typecheck-handoff.log), native-contract types and the table-of-contents, plugin, README and changelog generator checks in the same report directory. These checks use no live model inference. The [final technical and prose recheck](../../../evidence/agents/20261105T162901Z-handoff-refresh/reports/review-final.md), which continued the first reviewer's context, found no blocker to committing the offline patch or putting the USD 4.82 proposal to the owner. The later owner decision above raises the total ceiling without changing the operation counts; pilot implementation acceptance remains outstanding.

## Approved Pilot Profile

The target is invocation and recovery behaviour, not how well a language model copes with a small completion cap. In the retained batch, 11 of 20 collations truncated at 4,000 tokens and seven returned no visible text; none of the 120 extractions truncated at 8,000 tokens. The extraction increase therefore supplies additional matched headroom rather than addressing an observed extraction failure. Apply the same profile to both arms:

| Setting | `rh-v4` | Approved Pilot |
|---|---:|---:|
| Extraction Output Cap | 8,000 tokens | 16,000 tokens |
| Collation Output Cap | 4,000 tokens | 16,000 tokens |
| Per-Attempt Model Timeout | 120 seconds | 300 seconds |
| Extraction Concurrency | 2 | 2 |
| Source Cap | 6 | 6 |
| Main Logical-Request Limit | 4 | 4 |
| Downstream Attempt Limit | 3 | 3 |

Output caps include hidden reasoning. A larger allowance does not require the model to fill it and does not prove truncation is eliminated. The [current public catalogue](../../../evidence/agents/20261105T162901Z-handoff-refresh/reports/current-public-rates.json), fetched without inference, advertises `top_provider.max_completion_tokens: 512000` for [_MiniMax M3_](https://minimax.io). That does not establish every serving route's limit. Actual payloads and complete returned text must still be verified in the pilot.

Keep the prescribed host and models: `Pi` 1.5.0, subscription main `openai-codex/gpt-6.1-sol`, common search `openrouter/perplexity/sonar`, and extraction/collation `openrouter/minimax/minimax-m3`. Keep reasoning `low`. Leave serving-provider selection unchanged for these pilots and record it explicitly. Provider pinning would be an additional experimental change, not a remedy assumed to work.

These settings are not yet connected to a live pilot entrypoint. Freeze a new `PILOT-PROTOCOL.md` revision and costed schedule before any live gate, leaving `PROTOCOL.md` and the historical `rh-v4` configuration intact. Independent technical and prose review must accept the new protocol and implementation identity before diagnostics or preparation.

The pilot path must select its own phase, protocol path, approval scope, settings, stage guards, fixtures, run budgets, operation-count checks and settlement walk. The current live guard hard-codes the old caps, the current collector schedules twenty runs, and settlement traverses that schedule. Raising only the JSON settings is insufficient. Package defaults remain unchanged.

Retain the independent 30-minute worker ceiling. At three attempts per stage, the approved per-attempt timeout can permit more work than that ceiling allows; worker termination can therefore pre-empt remaining retries. Record such a stop as a failed, time-limited pilot, retain conservative financial holds if final accounting is unavailable, and do not extend the ceiling or replace the run automatically.

## Symmetric Recovery

Both arms must make exactly one research invocation. The baseline uses the direct tool; the candidate generates its own Codemode script and returns the complete research text once. Both receive an explicit instruction permitting a later evidence read only when the summary is insufficient. The candidate instruction must permit that later Codemode call without permitting a second research invocation.

Keep separate outcomes for the assigned initial invocation, additional recovery work, successful pipeline completion, readable evidence and final-answer quality. Recovery is observable work, not an observation to delete. A successful research response must pass the unchanged-return check even when later recovery calls occur. The current one-top-level-call return check needs a pilot-specific implementation; do not weaken the historical check used for `rh-v4` re-analysis. Reaching the four-request main limit before a settled final answer fails the pilot and is reported as a recovery-limit observation. It does not establish that either route is more efficient.

Before the paid pilots, use deterministic complete, truncated and failed-return fixtures to exercise both routes, recovery recording and budget refusal. One subscription-main observer conversation per arm is approved, baseline first, with synthetic downstream work and no chargeable research. Claim both run IDs under the designated pilot root against the same owner decision. If either fails review, stop before financial admission; an unused second slot is not a retry. These diagnostics qualify request observation and the revised instructions, not answer usefulness.

## Later Fixed-Response Control

This assignment excludes the later fixed-response control. Such a control requires its own owner decision and accepted schedule, with matched saved evidence and identical returned text for both arms. Reusing a pilot return would avoid another extraction/collation charge, but requires an explicit accepted input identity. A fixed response removes downstream variation; final answers can still vary. The two paid pilot conversations must not be mislabelled as that fixed-response comparison or as measured evidence of savings.

## End-to-End Pilot Schedule

Use one new series identity with a hard maximum of two paid end-to-end conversations: baseline first, candidate second. Wait for the baseline's machine checks, financial settlement and locked answer assessments to pass before starting the candidate. Keep at least 30 seconds between the runs. This is one diagnostic pair, not two pairs and not the twenty-conversation measured schedule. Stop after the first failed pilot; do not spend the second slot on a replacement. A baseline failure therefore ends the series without observing the candidate route.

Preparation permits one common search/page capture and one downstream charge-reporting qualification, followed by the two end-to-end conversations if their prerequisites pass. Every pilot replays the same fresh source bytes while extraction and collation remain live. The qualification remains a financial-channel check; the end-to-end pilots, not that extraction-only check, qualify full collation.

A fresh independent corpus reviewer must apply corpus acceptance before any arm result, without access to the earlier topic-validation answer or planning discussion. Reject a corpus missing the setup or failure information required by the task unless it contains an explicit applicable limitation. A link to an uncaptured setup page does not satisfy that requirement. Record duplicate texts and source applicability. No hand-selected replacement, automatic recapture or relaxed answerability rule is permitted. If the single capture fails, retain its cost and stop for a source-policy decision.

Before capture, freeze separate fidelity and task-usefulness rubrics in the new pilot protocol. The incoming coordinator must not open the topic-validation answer or its disclosure query before freezing them. The starting topics are the six criteria in [Execution Plan, Query and Adequacy](EXECUTION-PLAN.md#query-and-adequacy): supported mechanism and maturity, prerequisites/setup, configuration/code, agent integration, limitations/failure modes, and applicable evidence/report access. For task usefulness, an uncaptured required step is a failure, not an absence finding that passes by default. A source-documented limitation can support a useful negative answer. State these pass conditions for each topic before source selection; do not silently inherit the historical absence interpretations.

Both final answers receive those separate assessments. Review inputs exclude `rh-v4` answers and grades. Two reviewers must lock their initial judgements independently before comparison. An answer passes the gate only when each reviewer's locked grade passes both rubrics, or a reviewer meeting the same isolation rule resolves a disagreement as a pass through recorded source-cited adjudication under the frozen criteria. Unresolved disagreement or failure of either rubric fails the gate. Passing instrumentation alone does not release the candidate pilot or qualify the methodology for a savings-with-preserved-usefulness claim.

A pilot passes only when exactly one research invocation occurs, the prescribed inputs and settings match, request observation and usage are complete, every selected source is successfully extracted without truncation, collation returns nonempty untruncated text, the assigned research return is preserved, cited saved evidence is readable, financial records settle with known charges, and the answer meets the stated assessment criteria. Record recovery calls even when those conditions pass. Any failure stops progression; it does not justify raising the cap again during the same series.

Two passing pilots establish that these paths worked on two observations. They do not establish a stable failure rate, reproducibility, equivalence or savings. The measured sprint requires a separate frozen schedule, similarity criteria and owner decision.

## Approved Financial Ceiling

The [new owner decision](../../../evidence/agents/20261105T173919Z-handoff-resume/owner-decision.json) records the USD 10 ceiling, operation counts and designated fresh series root. It is a decision record, not a live-admission receipt. The incoming coordinator must bind it to the independently accepted code, new protocol, inputs and real series directory before dispatch. The previous experiment's receipt is not reusable. The live implementation must reject the historical scope, a changed root, an already claimed operation and any attempt to dispatch the twenty-run schedule under pilot authority.

The approved total ceiling is USD 10, not a spending target. The coordinator allocation below preserves the preparation limits and divides the remaining allowance equally between the two pilots. Before reported charges consume headroom, each USD 4.09 pilot ceiling can carry twelve full reservations active or held at once at the captured rates. This is not a twelve-attempt limit: settled charges replace reservations. The ceiling does not guarantee that every possible retry fits. These stage allocations are engineering selections within the owner's total allowance, not separately quoted owner amounts. No chargeable operation has been launched under it.

| Stage | Maximum Exposure |
|---|---:|
| One Common Capture with Existing Bounded Retries | USD 0.81 |
| One MiniMax M3 Charge Qualification, Up to Three Attempts | USD 1.01 |
| Baseline Pilot | USD 4.09 |
| Candidate Pilot | USD 4.09 |
| Total | USD 10.00 |

The MiniMax M3 reservation at a 16,000-token output cap is USD 0.3337728 per attempt: 1,048,576 input tokens at USD 0.0000003 each plus 16,000 output tokens at USD 0.0000012 each. Three qualification attempts require USD 1.0013184, so the previous USD 1.00 qualification envelope is slightly too small. Both extraction and collation use the same revised attempt reservation. Two concurrent attempts fit within each pilot's envelope, but accumulating unknown-charge holds can stop a run before all retries are used.

These are exposure limits, not expected charges or a guarantee that every retry path fits. Reserve before dispatch, settle reported charges, retain unknown holds, and stop on insufficient allowance or overrun. Refresh rates again at admission and reject a rate or catalogue change that exceeds the bound. Main-model consumption is subscription-billed and remains separately reported. No extra capture, pilot replacement or automatic sprint is included.

## Current Continuation Boundary

The approved sequence has stopped and settled. Retain the rejected corpus and unused slots; do not repeat the implementation or launch instructions above against the closed root. [Pilot Resume](RESUME.md) identifies permitted offline work. A new source-policy pilot requires its own costed schedule and owner decision.
