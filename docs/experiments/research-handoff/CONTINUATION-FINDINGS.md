# Pilot Continuation Findings

The `rh-v6` pilot is complete and settled. Both direct research and Codemode research completed with the same captured sources and settings, without extraction or collation truncation. The baseline answer received an adjudicated narrow pass; both independent reviewers failed the candidate answer. This is a completed experiment with a failed quality gate, not a successful pilot pair or evidence of Codemode benefit.

The [final inventory](../../../evidence/benchmarks/research-handoff/20261106T143614Z-rh-v6-pilot/inventory.json) records every stage. [Pilot Continuation](PILOT-CONTINUATION.md) is the frozen contract. The earlier [Pilot Findings](PILOT-FINDINGS.md) describe the separate, closed `rh-v5` series.

## Comparison

The baseline called `intelli_research` directly. The candidate used Codemode, the `Pi` JavaScript tool interface, with a model-written script to await the same operation and return its complete text once. Both replayed the same search completion and twelve distinct captured pages; extraction and collation remained live. The question concerned outbound email from _Pi Durable_ on [_Cloudflare_](https://www.cloudflare.com).

Both observers passed, the corpus passed independent review, and charge qualification succeeded. The paid runs each made two main-model requests, one assigned research handoff and no recovery calls. All selected sources extracted successfully, collation was nonempty and untruncated, and the complete research return reached the main model. The independent [baseline machine review](../../../evidence/agents/20261106T143614Z-pilot-completion/reports/baseline-machine-review.md) and [candidate machine review](../../../evidence/agents/20261107T191857Z-pilot-finish/reports/machine-review.md) checked the retained requests, results and accounting.

The baseline ran on 6 November 2026 and the candidate on 7 November. An administrative error interrupted the sequence between them. This pair is not the uninterrupted end-to-end run requested by the owner.

## Answer Quality

The two frozen rubrics assess source fidelity and task usefulness independently across six topics. Every cell must pass for an answer to pass.

| Arm | Initial Reviews | Final Quality Outcome |
|---|---|---|
| Baseline | One Fail, One Pass | Adjudicated Narrow Pass |
| Candidate | Two Fails | Fail; No Adjudication Permitted |

The baseline [adjudication](../../../evidence/agents/20261106T143614Z-pilot-completion/reports/adjudication-L.md) resolved the initial disagreement and revised the adjudicator's own preliminary failure. It is not reviewer consensus or a third independent passing vote. The final procedural review found this consistent with the frozen rule, which permits whole-answer adjudication after the two initial reviewers disagree.

Both candidate reviewers failed task usefulness for agent integration. They found that the answer did not supply sufficient steps for registering and invoking the email tool in the running agent. The [first review](../../../evidence/agents/20261107T191857Z-pilot-finish/reports/grade-Q1.md) also failed fidelity cells for prerequisites, integration and failure modes; the [second review](../../../evidence/agents/20261107T191857Z-pilot-finish/reports/grade-Q2.md) failed usefulness for failure modes. Both identified problems with the approval and replay guidance. The reviewers differed on whether other inaccuracies were material. Their [locked grades](../../../evidence/benchmarks/research-handoff/20261106T143614Z-rh-v6-pilot/reviews/answer-Q/assessment-lock.json) preserve those differences. The first report's opening count contradicts itself; its table and locked grade consistently record eight passing and four failing cells.

A requested review through the Qwen subscription was refused for exhausted quota before it produced a grade. A fresh Opus reviewer completed that assignment without reading the other grade. The [refusal](../../../evidence/agents/20261107T191857Z-pilot-finish/reports/grade-Q2-quota-refusal.txt) and [replacement reviewer provenance](../../../evidence/agents/20261107T191857Z-pilot-finish/reports/grade-Q2-opus-orchestration.log) are retained. No experiment conversation was replaced, and no further reviewer was commissioned to overturn the two failures.

## Administrative Interruption

The baseline adjudicator supplied `rationale` as a JSON object. The gate expected a string and recorded a type error in an immutable failure receipt. This was a harness error after a technically successful run, not a new answer-quality judgement.

On 7 November the [owner directed conversion and continuation](../../../evidence/agents/20261107T191857Z-pilot-finish/owner-direction.json). The correction serialised the entire object as a string; every other field and all grades remained unchanged. The [verification](../../../evidence/agents/20261107T191857Z-pilot-finish/correction-verification.json) binds the original and corrected records. The failed receipt remains at [pilot-baseline-gate-format-failure.json](../../../evidence/benchmarks/research-handoff/20261106T143614Z-rh-v6-pilot/pilot-baseline-gate-format-failure.json); the [supersession record](../../../evidence/agents/20261107T191857Z-pilot-finish/supersession-authorisation.json) explains why the corrected gate permitted continuation. The [independent review](../../../evidence/agents/20261107T191857Z-pilot-finish/reports/machine-review.md) accepted the conversion and the adjudication procedure.

This was an owner-authorised deviation from the frozen stop sequence. Corpus, prompts, rubric, settings and accepted source identity were unchanged, but the interruption and different execution dates remain limitations of the comparison.

## Descriptive Measurements

These values describe this interrupted pair, not route-caused effects. The [assessed outcome](../../../evidence/benchmarks/research-handoff/20261106T143614Z-rh-v6-pilot/assessed-outcome.json) joins quality verdicts to the machine analysis.

| Metric | Baseline | Candidate |
|---|---:|---:|
| Main Input Tokens | 5,627 | 7,735 |
| Main Output Tokens | 1,019 | 990 |
| Main Total Tokens | 6,646 | 8,725 |
| Downstream Total Tokens | 111,295 | 82,713 |
| Downstream Reported Charge, USD | 0.078734782 | 0.039821351 |
| Recovery Calls | 0 | 0 |

The candidate used 2,079 more main tokens in this pair. Its downstream consumption was lower, but live extraction outputs and serving providers differed. Baseline collation used Parasail; candidate collation used CoreWeave. The quality failure, single pair and interruption prevent a savings, equivalence or reliability conclusion.

## Settlement and Reproduction

The [settlement](../../../evidence/benchmarks/research-handoff/20261106T143614Z-rh-v6-pilot/settlement-receipt.json) closes `rh-v6` with USD 0.129569733 in reported charges and zero unknown holds, active reservations or overrun. The total includes USD 0.0110136 for capture and charge qualification in addition to the two paid arms. Including `rh-v5`, the cumulative reported amount is USD 0.135269733 against the retained USD 10 ceiling. Main-model subscription usage is reported separately and is not priced in that amount.

Separate observer and paid analyses reproduced byte for byte into fresh durable outputs; the [reproduction verification](../../../evidence/agents/20261107T191857Z-pilot-finish/reproduction-verification.json) records their paths and digests. The [evidence manifest](../../../evidence/benchmarks/research-handoff/20261106T143614Z-rh-v6-pilot/evidence-manifest.json) binds scientific artefacts and the external correction records. Worker transpiler caches are excluded from that manifest and retained on disk.

## Continuation

The owner directed clean repeats after completion of this run, with comparison quality unchanged. The subsequently requested single `rh-v7` repeat is complete; [Repeat Findings](REPEAT-FINDINGS.md) records its clean workflow and negative quality result. [Pilot Resume](RESUME.md) is the current entrypoint. All attempts remain retained rather than selecting a passing pair as representative evidence.
