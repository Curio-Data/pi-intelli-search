# Bounded Pilot Findings

This page records the closed `rh-v5` series. The later `rh-v6` outcome is in [Continuation Findings](CONTINUATION-FINDINGS.md); [Pilot Resume](RESUME.md) is the current entrypoint.

The `rh-v5` pilot closed at the corpus-review gate on 6 November 2026. Both subscription-main observer conversations passed independent review, but the single fresh capture lacked evidence required by the frozen task-usefulness rubric. No charge qualification or paid end-to-end conversation ran. The reported metered charge was USD 0.0057, with no unknown-charge holds, active reservations or overrun.

## Outcome and Authority

The [owner decision](../../../evidence/agents/20261105T173919Z-handoff-resume/owner-decision.json) authorised the bounded sequence under a USD 10 ceiling. [Pilot Protocol](PILOT-PROTOCOL.md), revision `rh-v5-pilot-1`, froze the larger matched profile, independent rubrics and stop rules before capture. The [final inventory](../../../evidence/benchmarks/research-handoff/20261105T173919Z-rh-v5-pilot/inventory.json) records every operation and unused slot:

| Operation | Outcome |
|---|---|
| Baseline Observer | Passed Machine Checks and Independent Review |
| Candidate Observer | Passed Machine Checks and Independent Review |
| Financial Admission | Accepted Against Refreshed Public Rates |
| Common Capture | Completed; All Six Selected Pages Readable |
| Corpus Review | Rejected |
| Charge Qualification | Not Run |
| Baseline Paid Pilot | Not Run |
| Candidate Paid Pilot | Not Run |
| Series Settlement | Closed |

The [settlement receipt](../../../evidence/benchmarks/research-handoff/20261105T173919Z-rh-v5-pilot/settlement-receipt.json) accounts for the capture charge and releases the unspent allowance within this series. It grants no authority to spend that allowance elsewhere or reopen this root. No recapture, replacement, fixed-response control or measured sprint ran.

## Implementation and Qualification

The experiment-only implementation is committed as `64914bf`. The [implementation acceptance](../../../evidence/agents/20261106T103008Z-pilot-implementation/implementation-acceptance.json) binds these identities:

```text
codeSha256:     4550b8f5bc5e2c549a35c7ff173d004f7249653507d75abc82b2985a24cd9a64
protocolSha256: cf341f9a5f3e6b30c5f06074a037be532c934552e249c2f74a19432bee9b98ca
```

The serial validation lane passed build, native and standalone tests, explicit handoff tests and types, native-contract types and generator checks with matching source identities [before](../../../evidence/agents/20261106T103008Z-pilot-implementation/source-accepted-before.json) and [after](../../../evidence/agents/20261106T103008Z-pilot-implementation/source-accepted-after.json). [Technical review](../../../evidence/agents/20261106T103008Z-pilot-implementation/reports/technical-final.md) and [prose review](../../../evidence/agents/20261106T103008Z-pilot-implementation/reports/prose-final.md) accepted the final bytes. The accepted protocol snapshot is [retained separately](../../../evidence/agents/20261106T103008Z-pilot-implementation/protocol-accepted.md).

The [credential-free actual-host cases](../../../evidence/benchmarks/research-handoff/20261106T103008Z-rh5-synthetic-accepted/series-outcome.json) exercised complete returns, evidence recovery, model and Codemode truncation, provider failure, main-request exhaustion, monetary refusal, unknown-charge holds and worker termination. The candidate's raised Codemode output limit preserved a long synthetic return that the host's default limit truncated. These checks establish handling of programmed cases on the pinned host, not live downstream reliability. Product source, package defaults and historical `rh-v4` protocol and findings remained unchanged.

## Observer Evidence

The [independent observer review](../../../evidence/agents/20261106T103008Z-pilot-implementation/reports/observer-review.md) checked retained transmitted requests and results, rather than relying only on the machine verdicts. Each arm made two logical main requests, one attempt per request, one assigned research invocation and no recovery calls. Both returned the complete synthetic research text once and retained readable reports. Main usage was subscription-billed:

| Arm | Main Input Tokens | Main Output Tokens | Main Total Tokens |
|---|---:|---:|---:|
| Baseline Observer | 3,151 | 168 | 3,319 |
| Candidate Observer | 4,246 | 196 | 4,442 |

These are observer measurements with synthetic downstream evidence, not a comparison of useful research or evidence of savings. The configured main model was `openai-codex/gpt-6.1-sol`; no chargeable extraction or collation provider was invoked.

The candidate's transmitted return contained the pinned serializer's extra separator newline between the header and complete research text. The independent check confirmed preservation on the wire; the machine check alone compares recorded tool-result text. The baseline request bodies used `zstd` compression and the candidate used identity encoding; both decoded payloads were retained. The review records these qualifications and the candidate's retained dispatched-prefix handling.

## Corpus Rejection

The [task](PILOT-PROTOCOL.md#task-and-routes) asks how to enable outbound email from _Pi Durable_ on [_Cloudflare_](https://www.cloudflare.com) using native services. The [fresh corpus reviewer](../../../evidence/agents/20261106T103008Z-pilot-implementation/reports/corpus-review.md) received only the frozen task/rubric and a [bounded bundle of captured page bytes](../../../evidence/benchmarks/research-handoff/20261105T173919Z-rh-v5-pilot/corpus-review/inputs.json). The reviewer did not read the earlier topic-validation answer, disclosure query, historical answers or grades. The coordinator verified that the bundle's page identities matched the retained capture, then recorded the [rejection](../../../evidence/benchmarks/research-handoff/20261105T173919Z-rh-v5-pilot/corpus-acceptance.json).

The capture contains six selected URLs but four distinct texts. Two HTML URLs and their `index.md` alternates duplicate the same page content. The sources establish the existence and maturity of the email service and the agent runtime, but the reviewer found that they do not supply the sending setup, sending-binding declaration or sending failure-mode evidence required by the task. Required details were linked from captured pages but not captured themselves. Agent integration also failed task usefulness because assembling the separate documented pieces would require inference and the missing configuration.

The protocol requires this result to stop preparation: an honest statement that information is absent cannot substitute for required instructions or an explicit applicable limitation. The rejection does not establish that the product cannot perform the task. It establishes that this selected corpus cannot support the frozen answer criteria.

The capture used the configured `openrouter/perplexity/sonar` model. Its successful completion reports a numeric charge and token usage in [capture events](../../../evidence/benchmarks/research-handoff/20261105T173919Z-rh-v5-pilot/capture/events.jsonl); no serving-provider identity is established by the retained completion. No real 16,000-token extraction or collation was attempted, so this series does not qualify those live limits or answer usefulness.

## Reproduction and Retention

The [observer analysis](../../../evidence/benchmarks/research-handoff/20261105T173919Z-rh-v5-pilot/analysis/observers/pilot-analysis.json) uses the observer corpus and `no-charges` mode. The [paid analysis](../../../evidence/benchmarks/research-handoff/20261105T173919Z-rh-v5-pilot/analysis/paid/pilot-analysis.json) uses the captured corpus and `known-charges` mode with an empty paid inventory. Both reproduced byte-for-byte into fresh outputs, as recorded in the [reproduction verification](../../../evidence/agents/20261106T103008Z-pilot-implementation/reproduction-verification.json). The final inventory separately names preparation outcomes and unused slots; a mixed observer/paid analysis is rejected.

Raw requests, results, captured pages, reviews and financial receipts remain under the designated series root or the linked implementation evidence directory. The [evidence manifest](../../../evidence/benchmarks/research-handoff/20261105T173919Z-rh-v5-pilot/evidence-manifest.json) binds the retained artefacts. Transpiler caches beneath each worker's `agent/tsx-*` directory are excluded from the scientific manifest and left in place. All historical evidence and current scratch remain; no cleanup was authorised.

## Interpretation and Next Proposal

The observer and stop machinery worked on these observations: it qualified both invocation routes and stopped an insufficient corpus before qualification or paid answers. The higher-token end-to-end methodology remains unobserved. This series establishes no stable failure rate, equivalence or comparative benefit.

The next proposed experiment is a separately costed source-selection pilot, not another unchanged capture. Define how HTML/Markdown aliases are canonicalised and whether a bounded, predeclared rule may follow links needed for setup, APIs and failure evidence. Decide whether domain guidance becomes an enforced filter, and account for the corpus reviewer's observation of possible date-dependent page rendering when specifying capture and replay. Freeze its source policy, operation counts and financial schedule before requesting a new owner decision. Keep the existing dual rubrics; do not relax them to make this corpus pass. Any subsequent fixed-response control or measured sprint requires its own accepted schedule and authority.
