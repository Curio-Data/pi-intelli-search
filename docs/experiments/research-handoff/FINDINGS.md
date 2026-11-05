# Research Handoff Findings

Status: no measured conversations have run, so this experiment establishes no token-saving, resumption, answer-quality or Codemode-benefit claim. On 5 November 2026 the owner approved the `rh-v4` question amendment, replacing the PostgreSQL stimulus with a neutral [_Cloudflare_](https://www.cloudflare.com) research task. The `rh-v4-r3` candidate passed deterministic and synthetic checks, and its technical reviewer accepted observer renewal, but its prose reviewer required one documentation-only correction round; `rh-v4-r4` carries those corrections. No Cloudflare experiment capture or measured conversation exists.

## Accepted RH-V3 Implementation and Observer Evidence

The accepted `rh-v3` implementation was commit `3e43070183b6c63623f02fd782b633cd0c552f2c`, with code identity `1c420c9027dac6b10b0294db1407cc8fff09eb562a922f312f9d4b39ef804e73` and protocol identity `0f252090b0c2910f33212af62f5b734716d670c6e73bde4b651be1e2bb94f530` (`rh-v3`).

The deterministic lane passed 663 native tests, 62 standalone tests, and 133 study tests, plus build, both relevant type projects, and all applicable generator checks. Fresh actual-host synthetic runs completed both routes, and offline `analysis.json` reproduction was byte-identical. Independent technical and prose reviews accepted the candidate.

Two subscription-main observer conversations completed under `openai-codex/gpt-6.1-sol`. Each arm used two logical requests and two observed server-sent-event (SSE) attempts, one assigned handoff, and one answer-producing resumption. Fixed inputs, usage coverage, route conformance, report readability, and unchanged native returns passed. The acceptance receipt is `20261104T203108Z-rh-v3-observer-diagnostic/diagnostic-result.json`; its sibling `diagnostic-acceptance.json` is the schedule authority, not the result receipt. These are observer facts, not measured savings or answer-adequacy evidence. Single-conversation usage totals are not reproduced here and do not support comparison.

## Corpus Outcomes

Two fresh common captures ran under the accepted source-selection path for [_PostgreSQL_](https://www.postgresql.org/docs/17/). Both were readable and [_Perplexity Sonar_](https://docs.perplexity.ai) reported numeric charges. Neither corpus satisfied the frozen topic and version requirements.

| Capture | Selected Sources | Preparation Decision |
|---|---|---|
| `20261104T203243Z-rh-v3-measured` | PostgreSQL 17 `NOTIFY`, `LISTEN`, and explicit locking | Rejected: no selected source defines `FOR UPDATE SKIP LOCKED`; external-side-effect coverage was also insufficient |
| `20261104T204211Z-rh-v3-measured-r2` | PostgreSQL 17 `LISTEN`; `current` `NOTIFY` and explicit locking | Rejected: `SKIP LOCKED` remained absent, and two sources were not pinned to PostgreSQL 17 |

The second capture was the only owner-approved recapture. The coordinator did not hand-select replacements, replay an inadequate corpus, or run further captures. Because corpus acceptance precedes every arm result, the ten measured pairs and the separate MiniMax M3 charge-reporting qualification did not run. Milestone M3 acceptance was complete for the `rh-v3` identity and requires renewal under `rh-v4`; the model-specific charge gate remains unrun.

The selection mechanism used unallowlisted Sonar discovery over `postgresql.org` with `maxUrls: 3`. In both captures it chose `explicit-locking.html` but not the PostgreSQL 17 `SELECT` reference page that defines `SKIP LOCKED`. The PostgreSQL query already named that construct, so another blind rewording or capture was not a reliable correction. External-side-effect evidence was also insufficient in both corpora. The preparation amendment needed to address source coverage and version pinning, not merely request another capture. Each `corpus-acceptance.json` is the scientific rejection decision; `capture/outcome.json` records only successful machine capture and Sonar charge reporting.

The `rh-v4` question amendment replaces the stimulus, its domains and its source cap rather than requesting another PostgreSQL capture. It does not establish adequate source coverage for the new task: fresh corpus acceptance decides that. Both rejected series remain retained history under their own identities and are not reused or regraded.

## Financial Close-Out

Fixed-envelope close-out produced local receipts without creating a replacement ledger.

| Series | Reported Charges | Unknown Holds | Active Reservations |
|---|---:|---:|---:|
| First capture | USD 0.00553 | USD 0 | USD 0 |
| Approved recapture | USD 0.00570 | USD 0 | USD 0 |
| Total | USD 0.01123 | USD 0 | USD 0 |

These are provider-reported charges from retained stage receipts, not predicted spend or a programme-wide financial reconciliation. Receipt fields are nano-USD. Each series released the unused part of its own accepted envelope, so the documents do not establish a remaining lifetime allowance or residual capture authority. The `rh-v4` question amendment grants no financial authority; a new narrow owner receipt with scope `continue-without-programme-ledger-rh-v4` is required before `admit`. The separate topic-validation call was outside the experiment envelope, and its provider charge is not established by its retained `meta.json`.

## Evidence Map

All raw evidence is retained in this worktree under `evidence/benchmarks/research-handoff/`:

- `20261104T201721Z-rh-v3-synthetic-r4/` and its `-offline/` sibling: accepted synthetic implementation proof and reproduction.
- `20261104T203108Z-rh-v3-observer-diagnostic/` and its `-offline/` sibling: accepted `rh-v3` main-provider observer evidence.
- `20261104T203243Z-rh-v3-measured/`: first capture, corpus rejection, and local close-out.
- `20261104T204211Z-rh-v3-measured-r2/`: approved recapture, corpus rejection, and local close-out.

Validation, technical reviews, prose reviews, and owner decisions are under `evidence/agents/20261104T192721Z-research-handoff-m4/`. Earlier M3 implementation and observer evidence remains under `evidence/agents/20261104T164114Z-research-handoff-m3/` and the corresponding benchmark directories. The `meta.coreCommit` value `d2ec506…` in frozen captures is the unchanged production-core baseline constant, not the accepted `rh-v3` implementation commit.

A new owner decision belongs in a narrow `owner-*.json` receipt under `evidence/agents/20261104T192721Z-research-handoff-m4/`, following the existing records' `schemaVersion`, `approvedAt`, `approvedBy`, narrow `scope`, verbatim owner exchange, and explicit limits. The `rh-v4` decision followed that convention in `owner-cloudflare-question-amendment.json`. `candidate-rh-v3-r4.json` supplies identities and pointers for the accepted `rh-v3` implementation; acceptance is bound by the technical/prose reviews, diagnostic result, and preparation receipts, all of which require renewal under `rh-v4`.

## Decision on Further Measurement

The owner has decided how further measurement proceeds: the [`rh-v4` question amendment](../../../evidence/agents/20261104T192721Z-research-handoff-m4/owner-cloudflare-question-amendment.json) takes the revised source/question route with a neutral Cloudflare task, two study domains and a source cap of six. The `rh-v4` receipt approves the question and preparation amendment only. Corrected candidate review and symmetric observer diagnostics come next. A new owner financial receipt and current-rate admission precede capture; fresh corpus acceptance and MiniMax M3 charge qualification follow capture and precede any measured conversation. No remaining allowance is inferred from the released envelopes.

The [topic-validation disclosure](../../../evidence/benchmarks/research-handoff/20261105T075350Z-topic-validation/planning-disclosure.json) preserves the answer-shaped planning call that preceded this decision and prohibits its reuse. Fresh corpus acceptance and answer grading require reviewers who have not read that answer, the coordinator's answer-shaped discussion or the disclosure's query field. The call was outside the experiment envelope. Its provider charge is not established by its retained `meta.json` and is not included in the settlement figures.
