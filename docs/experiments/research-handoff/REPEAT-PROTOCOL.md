# Single Research Handoff Repeat

Revision: `rh-v7-once-1`. The [owner direction](../../../evidence/agents/20261107T195837Z-e2e-once/owner-direction.json) asks for the end-to-end experiment to be run once to see whether it works as intended. This protocol defines one fresh matched pair under a new identity. It reuses the settled `rh-v6` corpus, keeps every `rh-v6` setting, prompt and rubric, and moves answer grading after collection of both arms. Every control, check and rule of [Pilot Continuation](PILOT-CONTINUATION.md), revision `rh-v6-pilot-1`, and of the [Pilot Protocol](PILOT-PROTOCOL.md) it builds on applies unchanged unless a section below replaces it. The `rh-v5` and `rh-v6` protocols, roots, claims and evidence stay closed and unchanged.

## Purpose and Authority

The `rh-v6` run passed its machine and financial checks but was interrupted by administrative work between arms, and its candidate answer failed review. This repeat tests whether the same comparison runs from observation to settlement without interruption. One pair establishes only what happened on that pair. It establishes no failure rate, equivalence or savings, and it authorises no further repeat or measured sprint.

All authority is bound to the owner-direction SHA-256 digest `c5c2bdcc49df17dd9a53711f7ed2660ef56b7d78c9dd4e6b4fc585b3f0b46f0c` and this series directory, resolved beneath the existing `research-handoff-runner` checkout:

```text
evidence/benchmarks/research-handoff/20261107T195837Z-rh-v7-once
```

The `rh7-` commands accept only an implementation acceptance with scope `research-handoff-single-repeat-rh-v7`, this revision, this root and this protocol's digest. They refuse the `rh-v5` and `rh-v6` roots, receipts from any other revision, a second root generation and any root that holds a settlement receipt. The `pilot-` and `rh6-` commands remain bound to their own series and cannot reach this root. Claims are permanent, precede dispatch and remain consumed after failure; unused slots grant nothing.

| Operation | Maximum Count |
|---|---:|
| Subscription-Main Observer Conversations | 2 |
| Corpus Import | 1 |
| Charge Qualification | 1 |
| Paid End-to-End Conversations | 2 |
| Common Capture, Recaptures, Replacement Conversations, Measured Sprint | 0 |

## Task, Routes and Profile

The task, parameters, resolved settings, source policy, route paragraphs and prompts are those of [Pilot Continuation](PILOT-CONTINUATION.md#task-routes-and-profile), byte for byte. The baseline makes one direct `intelli_research` call; the candidate makes one initial Codemode call, the `Pi` interface through which the model invokes tools from a JavaScript script. A deterministic test requires the `rh-v7` settings, parameters and rendered prompts to equal the `rh-v6` values.

## Corpus Reuse

The series makes no search and fetches no page. After financial admission, `rh7-import` verifies the retained `rh-v6` corpus and copies it byte for byte into `corpus-import/frozen-inputs.json`. It requires the source file's SHA-256 digest `78e9f94d23fac9f3fc9d08e4a75812c70409b8fe7c3baf13b20be92394c8160c`, the corpus digest `ca2ec8b0201a0680054fd34b586ededae915207e892923af6bf588a13269799b`, full frozen-input validation including re-derivation under the frozen source policy, twelve successfully captured pages, the `rh-v6` settings and parameters, and the `rh-v6` series' accepted capture, accepted corpus review and closed settlement. It reads no credential and claims its slot only after these checks pass.

The import outcome records the provenance of each check, a zero new search charge and the absence of network and credential use. The `rh-v6` search charge stays in the `rh-v6` settlement. A failed import ends preparation; no capture or recapture is available as a fallback, and `rh7-capture` is refused.

Before qualification, a coordinator corpus acceptance bound to this series records the imported corpus digest and cites the `rh-v6` corpus review and its digest. The corpus bytes and rubric are unchanged, so that review's acceptance of all twelve pages and six topics under both rubrics applies without a fresh corpus review.

## Frozen Assessment Criteria

These criteria are unchanged from `rh-v6`. Answer reviewers must be fresh and must not read the earlier topic-validation answer, its disclosure query, the coordinator's answer-shaped planning discussion, `rh-v4` answers and grades, the rejected `rh-v5` corpus review, or the `rh-v6` answers, grades and adjudication. Give reviewers bounded inputs: this rubric and task, the frozen captured sources, applicability metadata and, for answer assessment, the de-identified answer and its evidence-access record. Do not provide full conversation history, the raw search text or another reviewer's grades.

The four paragraphs that follow (the two rubric definitions, the topic table, the failure rules and the locked answer gate) are byte-identical copies of the corresponding paragraphs of [Pilot Continuation](PILOT-CONTINUATION.md#frozen-assessment-criteria), and a deterministic test checks each one.

Two rubrics apply independently. **Fidelity** asks whether the answer's claims and instructions are supported by the captured evidence, with correct names, scope, maturity and qualifications. **Task Usefulness** asks whether the answer supplies the information needed to carry out the task, or a source-documented applicable limitation that explains why it cannot be carried out. Each reviewer records pass or fail and source-cited reasons for every cell below. Silence, a missing page or an unsupported absence claim cannot pass either rubric as a documented limitation.

| Topic | Fidelity Pass Criterion | Task-Usefulness Pass Criterion |
|---|---|---|
| Supported Mechanism and Maturity | Every identified mechanism and maturity claim agrees with applicable captured sources; an absence claim has explicit source support | Identify the supported native route or routes relevant to the task and their maturity, or explain an explicit applicable limitation preventing a supported route |
| Prerequisites and Setup | Required accounts, permissions, resources and setup steps stated in the answer match the captured instructions without inventing missing steps | Supply the prerequisites and ordered setup needed before sending, or an explicit documented blocker. Required steps available only through an uncaptured link fail |
| Configuration and Code | Names, configuration fields, APIs and code agree with captured evidence; inference is identified rather than presented as documented instruction | Supply the configuration and code needed for the supported route, or a documented limitation explaining why no applicable configuration can work. Omitted required configuration fails |
| Agent Integration | Claims about how the running agent invokes the route are supported for the applicable setup; unrelated examples are not silently treated as integration instructions | Explain where and how the running agent invokes each route proposed by the answer, with the required integration steps, or a documented limitation preventing that integration |
| Limitations and Failure Modes | Preserve material restrictions and failure conditions from the captured sources without broadening them | Explain the restrictions and failure modes that affect successful use and the documented handling where required. Missing required failure evidence fails unless an explicit applicable limitation resolves the task |
| Applicability and Evidence Access | Claims cite captured sources applicable to the current setup, preserve material version/maturity and failure/truncation caveats, and identify the actual saved report | Provide usable source citations and a readable saved-report reference; make applicability and any material remaining limitation clear enough to decide whether the instructions can be used |

Fidelity also fails on any material unsupported claim or inference presented as documented instruction. Task usefulness fails on any missing required step even when the answer honestly says that the corpus lacks it. A source-supported negative answer can pass when the documented limitation resolves the task; ordinary absence of information cannot.

For each paid answer, two fresh reviewers independently lock their initial grades before either sees the other's judgement. Bind each locked review to the raw record, answer, corpus and rubric digests, reviewer identity and immutable review artefact. A reviewer's overall verdict passes only when every topic in both rubrics passes. Compare the reviewers' overall answer verdicts: if both fail, the gate fails even when they failed different topics. If one passes and one fails, progression remains blocked unless a fresh equally isolated reviewer records a source-cited adjudication of the whole answer, resolving every failed criterion as a pass under these unchanged criteria. Preserve both initial grades and any adjudication. Missing or unresolved grades fail the gate.

In this series the answer gate decides answer quality only. Candidate collection never waits for it, so "progression" in the paragraph above means the answer's quality verdict, not the right to collect the candidate.

Prepare answer-review bindings and ungraded templates for both answers with the credential-free `rh7-review-inputs` command after both paid conversations end, and check each assembled lock with `scripts/handoff-review-preflight.mjs` before `rh7-gate`. Record identity uses a digest of canonical, recursively key-sorted JSON, not a file-byte hash; answer identity uses its raw text. Corpus identity is the imported corpus `digest`, and rubric identity is this protocol's file digest. Give each reviewer a neutral answer label and digest bindings, not a route-bearing run name or the other review. This removes explicit labels but does not guarantee blinding: run-name digests can be matched to predictable names, and answer text can reveal the route. Reviewers must not derive assignments from digests or inspect the coordinator's mapping. The coordinator retains the mapping to the actual run and assembles the lock only after both independent grades are written. Grader briefs restate no criterion beyond this section, and each reviewer records the actual time of locking.

## Gate Sequence

1. Freeze this protocol and implement the repeat. Validate build, native deterministic tests, explicit handoff tests and types, and applicable generators. Run the credential-free `rh7-synthetic` actual-host cases.
2. Obtain independent technical review and fresh _Opus_ prose review, resolve blockers and record implementation acceptance bound to the code, this protocol, the owner direction, the designated root and the review digests.
3. `rh7-observe`: both subscription-main observer conversations, baseline then candidate, with synthetic downstream work. Independent review must accept both before admission.
4. `rh7-admit`: refresh the public model catalogue without inference and create financial admission.
5. `rh7-import`: the single corpus import, then the coordinator corpus acceptance described under Corpus Reuse.
6. `rh7-qualify`: one charge-reporting extraction of the first selected page, at most three attempts.
7. `rh7-run` for the baseline.
8. At least 30 seconds after the baseline worker ends, `rh7-run` for the candidate. It requires the retained baseline record with passed machine checks, a final budget receipt and known charges only, with no held, active, refused or overrun charge. The candidate claim records the baseline evidence it relied on. A failed, unreadable or financially unsafe baseline leaves the candidate unrun.
9. After the candidate ends, or after a baseline failure that leaves it unrun, prepare both review bundles, obtain both answers' locked grades and record `rh7-gate` for each collected answer. `rh7-gate` refuses to write any gate earlier.
10. `rh7-settle` closes the series once, on completion or after any earlier stop.

Financial, credential, input-integrity and execution-safety failures stop progression at the step where they occur. A stopped step is retained as it stands; no step is rerun, replaced or repaired in place.

## Financial Controls

| Operation | Maximum Exposure |
|---|---:|
| Corpus Import | USD 0 |
| Charge Qualification | USD 1.01 |
| Baseline Pilot | USD 4.09 |
| Candidate Pilot | USD 4.09 |
| Total | USD 9.19 |

The combined ceiling remains the owner's original approval of USD 10, held cumulatively across `rh-v5`, `rh-v6` and this series. The owner direction records the two closed settlements, reporting USD 0.0057 and USD 0.129569733, for a prior total of USD 0.135269733 with no unknown-charge holds and no active reservations. Every authority-bound `rh7-` command re-reads both settlements and requires their bytes, closure and charges to match the direction. The envelope and allocations are coordinator-selected ceilings within the owner's direction, not expected charges. The settlement receipt adds this series' liability to the prior total and records whether the cumulative liability stays within the combined ceiling.

The per-attempt reservations are unchanged: USD 0.134072 for _Perplexity Sonar_ and USD 0.3337728 for _MiniMax M3_ extraction or collation. Three M3 reservations fit qualification, and each pilot allowance holds twelve full M3 reservations at once (USD 4.0052736). The paid conversations replay the frozen search completion and make no Sonar call. The reservation, unknown-hold, overrun, interruption and settlement rules of [Pilot Protocol](PILOT-PROTOCOL.md#financial-controls) apply unchanged.

## Operational Cleanliness and Quality

The final assessed outcome records two separate results.

**Operational cleanliness** is true only when observation, admission, import, qualification, both paid conversations, grading, settlement and offline reproduction finish in the order above without an unplanned pause, manual receipt correction, orchestration failure or incident. The outcome lists every incident with its step, time, evidence path and effect, under these categories:

| Category | Examples |
|---|---|
| Configured Retry | A downstream attempt beyond the first for one call, from the `pipeline-attempt` events of the run journal |
| Provider Incident | Quota or rate-limit refusal, provider error, timeout, budget refusal |
| Reviewer Incident | Reviewer quota refusal or unavailability, a switch to another rostered reviewer before judgement, a malformed review |
| Controller Incident | Orchestration timeout, duplicate or lost agent, unplanned pause, manual receipt or gate correction, an owner question about routine format |

A configured retry or quota refusal counts as an incident even when the step then succeeds.

**Answer quality** is the gate verdict of each collected answer under the frozen criteria. The pair passes quality only when both answers pass. A clean workflow with a failed answer is a cleanly collected negative result, not a passing pair; an interrupted workflow with passing answers is not a clean run.

Every claimed step, failure and incident is retained and reported. A failure is never resolved by rerunning, replacing or editing an original artefact. A representational fix to a review, made before the gate, preserves the original and its content.

## Success and Reporting

The machine checks, reporting rules and inventory rules of [Pilot Continuation](PILOT-CONTINUATION.md#success-and-reporting) apply. The report states operational cleanliness and answer quality separately, identifies the corpus as imported from `rh-v6` rather than freshly captured, and gives the cumulative accounting from the settlement receipt.

Any further repeat or measured comparison requires a new owner direction and protocol. A fresh session that inherits this series inherits its code and method, not its authority or unused slots.
