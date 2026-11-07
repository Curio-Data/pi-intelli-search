# Single Repeat Findings

The one requested `rh-v7` end-to-end test completed on 7 November 2026 without an operational incident. Both direct research and Codemode research passed the machine and financial checks. Both answers failed the unchanged quality gate. The workflow worked as intended and produced a negative quality result; it did not establish a useful-answer saving or a general difference between the routes.

The [final inventory](../../../evidence/benchmarks/research-handoff/20261107T195837Z-rh-v7-once/inventory.json) and [assessed outcome](../../../evidence/benchmarks/research-handoff/20261107T195837Z-rh-v7-once/assessed-outcome.json) record the result under the frozen [Repeat Protocol](REPEAT-PROTOCOL.md). The [owner direction](../../../evidence/agents/20261107T195837Z-e2e-once/owner-direction.json) limits this execution to one matched pair. No extra pair or replacement was run.

## Execution

The baseline called `intelli_research` directly. The candidate used Codemode, the `Pi` interface that lets the model call tools through a JavaScript script, to invoke the same operation once and return its complete text. Both used the accepted `rh-v6` search completion and twelve captured page texts byte for byte, with identical research settings and live extraction and collation. No search or page fetch was repeated.

The query remained: "When running Pi Durable on Cloudflare, how do I enable outbound email with Cloudflare native services?" The corpus remains the captured snapshot, not a fresh check of current documentation. The original corpus review was reused explicitly because its sources, task and rubric were unchanged; the independent implementation review accepted that reuse and the new [corpus acceptance](../../../evidence/benchmarks/research-handoff/20261107T195837Z-rh-v7-once/corpus-acceptance.json) binds both rubric digests.

Both observer conversations passed independent review. Admission, corpus import and charge qualification succeeded. The baseline and candidate were collected consecutively, with a 33.2-second gap between baseline completion and candidate start. Independent answer grading followed both conversations, so it did not interrupt the matched collection.

Each paid run made two main-model requests, one assigned research invocation and no recovery calls. Every source extracted successfully; collation was nonempty and untruncated; the complete native return reached the main model exactly once. The candidate used the pinned host's documented newline envelope. The [observer review](../../../evidence/agents/20261107T195837Z-e2e-once/reports/observer-review.md) and [paid machine review](../../../evidence/agents/20261107T195837Z-e2e-once/reports/paid-machine-review.md) verified the retained wire payloads rather than relying only on machine verdicts.

## Quality

| Arm | Initial Independent Reviews | Final Verdict |
|---|---|---|
| Direct Research | Two Fails | Fail |
| Codemode | One Pass, One Fail | Fail After Adjudication |

Both direct-answer reviewers failed task usefulness for agent integration; one also failed usefulness for configuration and code. The answer did not supply sufficient steps for defining, installing and invoking the email tool through the running agent. Their [first](../../../evidence/agents/20261107T195837Z-e2e-once/reports/rh7-grade-u1.md) and [second](../../../evidence/agents/20261107T195837Z-e2e-once/reports/rh7-grade-u2.md) reports and locked grades remain unchanged.

The Codemode reviewers disagreed on whether its integration guidance supplied the required steps: the [first review](../../../evidence/agents/20261107T195837Z-e2e-once/reports/rh7-grade-n1.md) passed it and the [second](../../../evidence/agents/20261107T195837Z-e2e-once/reports/rh7-grade-n2.md) failed it. A fresh adjudicator first locked an isolated whole-answer grade, then read the disagreement and [upheld the failure](../../../evidence/agents/20261107T195837Z-e2e-once/reports/adjudication-n.md). The answer named `ToolRegistration` and registry installation but did not supply the required tool definition, parameter schema and binding access. The adjudicator revised other preliminary fidelity failures without changing the overall fail.

Adjudication was a planned quality-assessment step, not an operational incident or a replacement review. The negative adjudication is retained even though the evaluator's `adjudicated` flag is `false`: that flag becomes `true` only for an adjudication that resolves every criterion as passing. It does not mean this answer lacked adjudication. Both review locks passed format preflight without normalisation or correction before the final gates were written.

## Descriptive Measurements

This is one matched pair, not an estimate of a stable route effect. Main-model usage is subscription usage; the charges below cover downstream extraction and collation only.

| Metric | Direct Research | Codemode |
|---|---:|---:|
| Main Input Tokens | 5,213 | 7,531 |
| Main Output Tokens | 964 | 996 |
| Main Total Tokens | 6,177 | 8,527 |
| Downstream Total Tokens | 95,341 | 90,204 |
| Downstream Reported Charge, USD | 0.058653204 | 0.052721020 |
| Recovery Calls | 0 | 0 |

Codemode used 2,350 more main tokens in this pair. Its downstream usage and reported charge were lower. Serving providers varied: baseline collation used AtlasCloud and candidate collation used Minimax. The research outputs were live and differed in length. Neither their consumption differences nor the quality verdicts can be attributed to the invocation route from this single pair.

## Cleanliness and Settlement

The [incident record](../../../evidence/benchmarks/research-handoff/20261107T195837Z-rh-v7-once/incidents.json) records no configured retry, provider, reviewer or controller incident from observation through final offline reproduction. Each downstream call had one attempt; every reviewer produced a typed, locked grade without quota refusal or substitution. There was no unplanned pause, manual gate repair or owner intervention. Implementation development and its tests preceded that observation window.

The [settlement](../../../evidence/benchmarks/research-handoff/20261107T195837Z-rh-v7-once/settlement-receipt.json) closes the series with USD 0.113180584 in reported charges, including USD 0.00180636 for charge qualification, and zero unknown holds, active reservations or overrun. Including `rh-v5` and `rh-v6`, cumulative reported charges are USD 0.248450317 against the retained USD 10 ceiling. Main-model subscription usage is not priced in that amount.

Observer and paid analyses reproduced byte for byte into fresh outputs, recorded in the [reproduction verification](../../../evidence/agents/20261107T195837Z-e2e-once/reproduction-verification.json). The [evidence manifest](../../../evidence/benchmarks/research-handoff/20261107T195837Z-rh-v7-once/evidence-manifest.json) binds the scientific records and external authority, reviews and reproduction receipts. Worker transpiler caches remain on disk but are excluded from scientific identity.

## Study Position

This clean pair and the earlier interrupted `rh-v6` pair are separate observations. They are not pooled into a benefit claim. The historical `rh-v4` measured series used another setup and remains a separate result that did not establish savings with preserved usefulness.

The requested one-shot workflow test is complete. The larger measured comparison has not started, and the quality criterion has not been weakened to obtain a pass. [Pilot Resume](RESUME.md) is the current entrypoint.
