# Research Handoff Paired Suite

Revision: `rh-v8-suite-2`. The [owner direction](../../../evidence/agents/20261108T152419Z-full-suite/owner-direction.json) asks for ten matched pairs, recorded durably and analysed. The [concurrency amendment](../../../evidence/agents/20261108T152419Z-full-suite/owner-concurrency-direction.json) authorises a reusable runner for "run X pairs" and approves this series as ten pairs with two pairs running at once. This protocol defines that runner and this series. It supersedes the unaccepted revision `rh-v8-suite-1`, which was never used for collection. It reuses the settled `rh-v6` corpus, keeps every `rh-v6` setting, prompt and rubric, and holds every new liability inside the original USD 10 ceiling shared with `rh-v5`, `rh-v6` and `rh-v7`. Every control, check and rule of [Single Research Handoff Repeat](REPEAT-PROTOCOL.md), revision `rh-v7-once-1`, and of the protocols it builds on applies unchanged unless a section below replaces it. The earlier protocols, roots, claims and evidence stay closed and unchanged.

## Purpose and Authority

The `rh-v7` pair showed that the workflow runs cleanly from observation to reproduction; both of its answers failed quality. This suite collects matched pairs so that answer quality and main-conversation usage can be compared across a population rather than one pair. Ten pairs support descriptive paired comparisons and exact sign and McNemar tests. They establish no equivalence margin, and a non-significant difference is not evidence of equality.

The base direction (SHA-256 `18edcb6fdf05bfd05266d7d9255da275165480c334a9062a64a20b422e839129`) grants the scope: ten pairs, twenty paid conversations, no replacements, the unchanged task, corpus and dual rubric, the USD 10 shared ceiling and the recorded prior charge, for this series directory:

```text
evidence/benchmarks/research-handoff/20261108T152419Z-rh-v8-suite
```

The amendment (SHA-256 `8e6e44400dd1363ced5b5d25cb218cbf27c0bb652f832060cf12a980652df235`) replaces only the base direction's serial schedule. It authorises collection of this ten-pair series only: not further studies, new credentials, prompt changes or budget increases. Both directions are coordinator transcriptions of the owner's messages; neither names a new numeric budget. The wave order, implementation and accounting below are coordinator choices that need independent acceptance before collection.

The `rh8-` commands accept only an implementation acceptance with this revision, a bound study plan and this protocol's digest. They refuse the `rh-v5`, `rh-v6` and `rh-v7` roots, receipts from any other revision, a second root generation and a root that holds a settlement receipt. The earlier command families cannot reach a suite root. Claims are permanent, precede dispatch and remain consumed after failure. Unclaimed slots carry no authority beyond their series.

| Operation | Maximum Count |
|---|---:|
| Subscription-Main Observer Conversations | 2 |
| Corpus Import | 1 |
| Charge Qualification | 1 |
| Paid End-to-End Conversations | Twice the plan's pair count (20 for this series) |
| Common Captures | 0 |
| Recaptures | 0 |
| Replacement Conversations | 0 |

## Study Plans

A study plan is an immutable JSON file that freezes one series: pair count, pairs run at once (`parallelPairs`), root, the deterministic schedule, the shared ceiling, the prior settlements, the reservations and the owner directions with their digests. `npm run study:handoff -- run-study --pairs N --parallel-pairs K --budget-usd X --root <dir> --owner-direction <file> [--owner-direction <amendment>] --out <file>` prepares it and refuses to overwrite a file or reuse a bound root. The plan grants nothing by itself. An implementation acceptance binds the plan's path and SHA-256, and every live command and every worker re-reads the plan, checks that digest and re-verifies it against its owner directions, so a new series needs a new owner direction and a new acceptance but no source edit.

Two authority forms exist. This series uses the base direction with its amendment, accepted only at the two recorded digests. A later series uses one owner direction with `schemaVersion: 1`, `recordType: "owner-direction-paired-suite"`, `approved: true` and `approvedBy: "owner"`. It names its scope (different from this series' scope), `matchedPairs`, `parallelPairs`, `combinedCeilingNanoUsd`, `priorReportedNanoUsd` with `priorSettlements`, `priorUnknownNanoUsd: 0`, `priorActiveNanoUsd: 0`, `designatedSeriesRoot`, `targetPrompt: "unchanged"`, `corpusAndRubric: "unchanged rh-v6 corpus and dual rubric"`, `measuredHost`, `mainModel` and `replacementConversations: 0`; every value must equal the plan's, and `rh8-plan-verify` reports any mismatch. Plan verification re-reads every listed prior settlement by bytes, requires the three historical settlements and the settlement of every other suite root in this checkout, and refuses while another suite root is bound but unsettled.

The bounds are explicit. `--pairs` is an integer from 1 to 99, the two-digit slot range. `--parallel-pairs` is an integer from 1 to the pair count and no more than the number of USD 4.09 reservations that fit the ceiling after prior charges at once; for this series that is two. `--budget-usd` is the shared cumulative ceiling, not a new allowance, and must equal the direction's. The plan records the worst case of every conversation at its full reservation (USD 81.8 for this series), which does not fit; the schedule is subject to the shared ceiling and the stop rules, not a promise that every worst case fits.

## Task, Routes and Profile

The task, parameters, resolved settings, source policy, route paragraphs and prompts are those of [Pilot Continuation](PILOT-CONTINUATION.md#task-routes-and-profile), byte for byte. The baseline makes one direct `intelli_research` call; the candidate makes one initial Codemode call, the `Pi` interface through which the model invokes tools from a JavaScript script. The main model is `openai-codex/gpt-6.1-sol` on subscription, on the retained `Pi` 1.5.0 host. A deterministic test requires the `rh-v8` settings, parameters and rendered prompts to equal the `rh-v6` values.

## Schedule

Each pair has slot names `pair-NN-baseline` and `pair-NN-candidate`. Odd pairs run the baseline first; even pairs run the candidate first. Pairs run in waves of `parallelPairs` consecutive pairs: a wave starts only after every pair of the previous wave has ended. Within a wave, each pair runs its two arms one after the other in its own new directories, and its second arm starts at least 30 seconds after its first arm ended. The two arms of a pair never overlap; arms of different pairs in the same wave do. For this series the waves are pairs 1 and 2, then 3 and 4, and so on, and the planned launch order is:

```text
wave 1: pair-01-baseline  pair-02-candidate  then  pair-01-candidate  pair-02-baseline
wave 2: pair-03-baseline  pair-04-candidate  then  pair-03-candidate  pair-04-baseline
...
wave 5: pair-09-baseline  pair-10-candidate  then  pair-09-candidate  pair-10-baseline
```

Second arms do not wait for each other: each follows its own pair's first arm, so the second arm of one pair can overlap the first arm of the other.

The alternation balances position within a pair: each arm runs first in five pairs. With two pairs per wave, the first arms of a wave are one baseline and one candidate, and so are the second arms, so both arms occupy each position in the collection order equally. That balances a steady drift across a wave, such as gradually rising provider load. It does not balance effects that vary irregularly over time, such as a short provider outage, which can fall on one arm. Running two pairs at once adds contention between them; the analysis records each conversation's actual start and end and which conversations overlapped. A fixed order is used rather than a random one so that the coordinator cannot choose an order after seeing results.

One controller runs the plan: `rh8-collect`. It holds an exclusive controller lock for the series, admits conversations from a pure planner over the retained claims, records and ledger, never from a caller's choice, and runs each in a new run directory, empty workspace, empty agent directory and new in-memory session. Before each reservation and claim it refuses if the checkout-root `.search` exists as a directory, file or symlink, including a dangling one, or if a credential has too little remaining lifetime; it never removes the cache. The controller repeats the cache check after the claim; a failure there, or any other failure between the claim and the worker's start, leaves the slot in flight, to be resolved with `rh8-interrupt`. A `pre-dispatch.json` receipt records the empty directories, the absent cache and the conversations already running. The claim records the slot, wave, pair, position, arm, plan digest, corpus acceptance and the ledger state after the reservation. Workers run in their own process groups, so a terminal interrupt reaches only the controller. A resumed controller first settles any reservation whose worker left a terminal record after the previous controller ended, then continues from the retained state.

The worker repeats the authority check without seams. It re-reads the acceptance and the plan, the owner directions, the prior settlements, the source and protocol identities and the preparation receipts. It requires its slot to be claimed, undispatched and reserved in the ledger at the full USD 4.09, no stop to have existed when its slot was reserved, every earlier wave to have ended and, for a second arm, its first arm to have ended safely at least 30 seconds earlier. "Existed" is decided by ledger order, not clock time: a stop counts only when the stopping slot's settlement row precedes this slot's reservation row, because the controller classifies a slot only after settling it. The controller also admits nothing while a running slot's record exists but its settlement has not been written. Only then does it write the dispatch witness and create the model session. A refusal inside the worker comes after the claim: the slot is consumed, its record shows the refusal and new admissions stop. During collection, keep the checkout free of other research activity that could create a checkout-root `.search`.

Answers are never graded during collection, and no outcome other than the stop rules below changes what is admitted next. A failed answer, failed machine check or unfavourable measurement is retained and the plan continues.

## Corpus Reuse

The corpus is reused exactly as in [Corpus Reuse](REPEAT-PROTOCOL.md#corpus-reuse) of the repeat protocol, imported by `rh8-import` into the series root. The import requires the source file digest `78e9f94d23fac9f3fc9d08e4a75812c70409b8fe7c3baf13b20be92394c8160c` and the corpus digest `ca2ec8b0201a0680054fd34b586ededae915207e892923af6bf588a13269799b`, makes no search, page fetch or model call and reads no credential. A failed import ends preparation; `rh8-capture` is refused.

Before qualification, a coordinator corpus acceptance bound to the series records the imported corpus digest and cites the `rh-v6` corpus review and its digest. The corpus bytes and rubric paragraphs are unchanged, so that review's acceptance of all twelve pages and six topics under both rubrics applies without a fresh corpus review. The acceptance records the source and current rubric digests.

## Frozen Assessment Criteria

These criteria are unchanged from `rh-v6`. Answer reviewers must be fresh and must not read the earlier topic-validation answer, its disclosure query, the coordinator's answer-shaped planning discussion, any earlier series' answers, grades or adjudications, or another answer of this suite. Give reviewers bounded inputs: this rubric and task, the frozen captured sources, applicability metadata and, for answer assessment, the de-identified answer and its evidence-access record. Do not provide full conversation history, the raw search text or another reviewer's grades.

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

The answer gate decides answer quality only. No conversation waits for a gate, so "progression" in the paragraph above means the answer's quality verdict, not the right to collect a later conversation.

After collection ends, `rh8-review-inputs` prepares one review bundle for every collected answer. Each answer receives a label `answer-NNN` from a random permutation, so the label carries neither the route nor the schedule position. A coordinator-only mapping links each label to its slot. Each answer is graded by two fresh reviewers who see only that answer's bundle, the corpus and this section. Reviewers of different answers may work at the same time. Each reviewer, initial or adjudicating, grades exactly one answer of the suite; `rh8-gate` refuses a lock that names a reviewer already recorded in another answer's gate, and the coordinator assembles and records the gates one at a time. Check each assembled lock with `scripts/handoff-review-preflight.mjs` before `rh8-gate`. Record identity uses a digest of canonical, recursively key-sorted JSON, not a file-byte hash; answer identity uses its raw text. Corpus identity is the imported corpus `digest`, and rubric identity is this protocol's file digest. Labels remove explicit route names but do not guarantee blinding: answer text can reveal the route. Reviewers must not derive assignments from digests or inspect the coordinator's mapping. Grader briefs restate no criterion beyond this section, and each reviewer records the actual time of locking.

## Gate Sequence

1. Freeze this protocol, prepare the study plan with `run-study` and implement the suite. Validate build, native deterministic tests, explicit handoff tests and types, the review-preflight tests and applicable generators. Run `rh8-synthetic` and the `stop`, `clean` and `serial` plans of `rh8-rehearse` on the actual host without credentials.
2. Obtain independent technical review and fresh _Opus_ prose review, resolve blockers and record implementation acceptance bound to the code, this protocol, the plan's path and digest (the plan binds both owner directions), the base direction and the review digests. Create the empty series root directory.
3. `rh8-observe`: both subscription-main observer conversations, baseline then candidate, with synthetic downstream work. Independent review must accept both before admission.
4. `rh8-admit`: refresh the public model catalogue without inference, create financial admission and write the shared ledger's genesis.
5. `rh8-import`, then the coordinator corpus acceptance described under Corpus Reuse.
6. `rh8-qualify`: one charge-reporting extraction of the first selected page, at most three attempts, with its USD 1.01 reserved in the ledger.
7. `rh8-collect`, rerun after each pause, until every planned conversation has a terminal record or the series has stopped. See Pause and Stop for each ending and its exit code. After `rh8-import`, `rh8-status` shows the state at any time without writing, including whether the series is `resumable`.
8. `rh8-review-inputs`, the locked grades of every collected answer and `rh8-gate` for each. Gates are refused while a controller holds the lock or before collection ends.
9. `rh8-settle` closes the series once.
10. `rh8-analyse` writes the full planned-population inventory and paired analysis; a second run into a new directory must reproduce both files byte for byte.

After a claim, or inside a stage, financial, credential, input-integrity and execution-safety failures stop new admissions at the step where they occur. A refusal before any claim is not a failure of the step; see Stop Rules. A stopped step is retained as it stands; no step is rerun, replaced or repaired in place. Resuming a paused controller is not a rerun of a step: it continues the same plan.

## Financial Controls

The combined ceiling remains the owner's original approval of USD 10, held cumulatively across `rh-v5`, `rh-v6`, `rh-v7` and this series. The three closed settlements report USD 0.0057, USD 0.129569733 and USD 0.113180584, a prior total of USD 0.248450317 with no unknown-charge holds and no active reservations. Every authority-bound `rh8-` command and every worker re-reads all three settlements and requires their bytes, closure and charges to match.

| Reservation | Amount |
|---|---:|
| Shared Headroom Before This Series | USD 9.751549683 |
| Charge Qualification | USD 1.01 |
| Each Admitted Paid Conversation | USD 4.09 |
| Each _MiniMax M3_ Attempt | USD 0.3337728 |
| Peak Concurrent Conversation Reservations (Two Pairs) | USD 8.18 |

These are the unchanged single-pair ceilings, not expected charges. The series keeps one append-only, hash-chained ledger, `ledger.jsonl`, in the existing programme-ledger format. Its genesis carries the USD 10 ceiling and the prior total as known. Qualification and each conversation reserve their full ceiling in the ledger before their claim. The ledger refuses any reservation for which known plus unknown plus active plus the new amount would exceed USD 10, and refuses any identity used before. Each append holds an exclusive lock directory and re-reads the chain inside it; within the controller, appends are also queued. A ledger lock left by a crash is never cleared automatically: every later ledger write fails until the coordinator inspects it, confirms no runner process remains and removes the empty `ledger.lock` directory by hand, recording that as a controller incident. No command removes it.

A reservation is released only by a terminal settlement from the stage's own final budget receipt: the known charge is released from the hold, and any unknown hold or remaining active reservation in the receipt stays held. A conversation without a valid receipt holds its full USD 4.09 as unknown. A reservation whose claim never followed is settled at zero by `rh8-settle`, because no worker can be dispatched without a claim; the ledger never reuses an identity, so that slot is lost to the series and a resume halts at it. When the next full reservation does not fit because admitted conversations hold the headroom, the controller waits for them to settle and retries at the same full amount. It records each wait under `controller-events/` as a concurrency degradation, which the analysis reports. When nothing is running and the full reservation still does not fit, the shared ceiling is exhausted: the run ends for an owner decision, because a higher ceiling is the owner's to grant. A reservation is never reduced to make it fit. Sustained concurrency at two pairs needs this series' known charges to stay at or below USD 1.571549683 at the last concurrent admission; the earlier series' conversations charged between USD 0.0398 and USD 0.0787 each. Each conversation holds twelve full M3 reservations (USD 4.0052736) and qualification holds three. The paid conversations replay the frozen search completion and make no _Perplexity Sonar_ call. `rh8-settle` reconciles every ledger settlement with its receipt and writes a settlement receipt with the cumulative liability against the combined ceiling.

## Stop Rules

New admissions stop permanently at the first claimed slot whose outcome makes continuation unsafe:

| Stop Condition | Evidence |
|---|---|
| Recorded interruption: no terminal record, full reservation held | `interruptions/<slot>.json` |
| Record unreadable, unanalysable or bound to another slot, phase, code, protocol or corpus | `analysable` check, record identity |
| Prescribed inputs or settings did not match | `inputs-and-settings-match` check |
| Final charges not known | Missing budget receipt, unknown hold, active reservation, refusal or overrun |
| Worker error, including a refusal inside the worker, or missing dispatch witness | `error` in the record, absent `dispatched` marker |
| Claims out of wave or pair order, an unscheduled claim, or a claim without a ledger reservation | Schedule integrity check |

Conversations already admitted when a stop occurs run to their end, and each settles from its own receipt under its own reservation; every result is retained. A refusal inside the worker is a worker error: it consumes the slot and holds its full reservation, because no receipt is written. A pair with one arm collected and the other never admitted is an incomplete pair of the planned population. Any other machine-check failure is an outcome, not a stop. A conversation that took a different route, truncated its return, failed collation or produced no settled answer is retained with known charges, and the plan continues.

A claimed slot without a terminal record that the current controller is not running is in flight: it may be a running worker or an interrupted one, and the runner cannot tell. It blocks admission, closure, grading and settlement until its record appears or the coordinator records an interruption with `rh8-interrupt` and a verified interruption receipt (`pilot-interruption-receipt` with `noActiveProcess: true` and retained inspection evidence). The interruption holds the slot's full reservation and stops new admissions. A controller lock left by a crash is released only by `rh8-interrupt` with a receipt whose `slot` is `controller-lock` and whose `lockOwnerSha256` names the lock's owner record; the lock is moved aside and retained. The absence of a running process rests on the coordinator's inspection recorded in the receipt. Unclaimed slots are never replaced.

## Pause and Stop

A controller run ends in one of five ways, and `rh8-collect` exits with a distinct code for each:

| Ending | Exit | Meaning | Next Step |
|---|---:|---|---|
| Complete | 0 | Every planned conversation has a terminal record | Grading |
| Stopped | 2 | A Stop Rules condition holds; no further admission is possible | Grading and settlement |
| Paused | 3 | Nothing blocks a rerun | Resolve the cause, rerun `rh8-collect` |
| Owner Decision | 4 | Nothing is running and the next full reservation does not fit the ceiling | Return to the owner |
| Blocked | 5 | A claimed slot has no terminal record and no running worker in this controller | Inspect, then `rh8-interrupt` |

A pause follows a refusal before any claim, which consumes nothing: a credential with too little remaining lifetime, an existing run directory or a checkout-root `.search`. It also follows a settlement error, which leaves only that slot's reservation active until the resume settles it from its receipt, and `SIGINT` or `SIGTERM`. In every case the controller stops admitting, lets admitted work drain and settle, and returns only after every worker it started has ended, so its lock is held throughout. `SIGINT` from a terminal reaches the controller but not the workers, which run in their own process groups. Under `npm run`, npm itself exits on the signal while the controller continues to drain; wait for the controller to print its ending before rerunning. `rh8-status` reports `resumable: true` when a rerun would continue.

`rh8-close` ends collection early, for example after a login expires and cannot be renewed. It takes the controller lock, so it cannot run while a controller does, and refuses while any slot is in flight.

## Operational Cleanliness and Quality

The incident categories and definitions of [Operational Cleanliness and Quality](REPEAT-PROTOCOL.md#operational-cleanliness-and-quality) apply. The analysis derives configured retries, failed downstream attempts, budget refusals, worker errors and conversations without a terminal record from each slot automatically. The coordinator records every other incident, including reviewer and controller incidents, in `incidents.json` at the series root. `incidents.json` has `schemaVersion: 1` and an `incidents` array; each incident records its `category` (`configured-retry`, `provider-incident`, `reviewer-incident` or `controller-incident`), `step`, `at` time, `evidencePath` and `effect`. The analysis calls the suite operationally clean only when every preparation receipt is accepted, both observers passed, every planned conversation ran and finished safely with no stop, interruption or closure, every answer has a valid gate, the settlement is closed with known charges only, and `incidents.json` is present, well formed and empty, as is the automatic list. Any missing or malformed item is listed as a blocker, never treated as clean. This covers observation through settlement; the offline reproduction is confirmed afterwards by the byte-for-byte comparison in Gate Sequence step 10.

Answer quality is the gate's `qualityPassed` field: the locked two-rubric answer gate together with the source-cited purpose review that [Pilot Protocol](PILOT-PROTOCOL.md) requires for any later Codemode call without a nested read. The gate's `passed` field also includes the machine checks and is not the quality verdict. Operational cleanliness and answer quality are reported separately, and a pair passes quality only when both answers pass.

## Analysis

`rh8-analyse` reads only retained evidence and the bound plan, and writes `suite-inventory.json` and `suite-analysis.json`. The inventory lists every planned slot, collected, in flight, interrupted or not run, with its wave, recorded interval, overlapping conversations, record digest, machine checks, stop classification, charges and gate. Missing usage is unknown, never zero. `rh8-runs-analyse` gives a per-conversation machine-check analysis of a record inventory for diagnosis; it is not part of the reported result.

The analysis has seven separate sections. **Machine** counts collected, not-run and passing conversations per arm and the failing checks. **Concurrency** gives the observed peak number of conversations running at once, each wave's span, per pair whether the arms overlapped and the gap between them, and the retained controller events: budget waits (concurrency degradations), ceiling exhaustion and settlement errors. **Quality** counts `qualityPassed` verdicts per arm and per pair, with the discordant pairs and an exact two-sided McNemar test. **Efficiency** reports, per metric, the baseline, candidate and candidate-minus-baseline distributions over pairs with both values known, the number of pairs with an unknown value, the signs of the differences and an exact two-sided sign test. **Incidents** lists the automatic and coordinator-recorded incidents and the cleanliness blockers. **Finance** gives the qualification and conversation charges and the settlement. **Subscription** sums the known subscription main-model tokens of the paid and observer conversations and lists each conversation whose usage is unknown; it is separate from the monetary settlement. Each pair is listed as collected, incomplete or not started.

The primary outcomes are declared now: paired answer quality, and the paired difference in main-conversation total tokens (input including cached input, plus output). Every other metric is secondary. No test is adjusted for multiplicity: each primary and secondary test is reported at its own exact p-value, computed from binomial probabilities, so it does not overflow at any allowed pair count. The primary population is every pair with both arms collected. A sensitivity population restricts to pairs whose two conversations passed machine checks; it is reported beside, never instead of, the primary population. The primary token metric is also reported separately for baseline-first and candidate-first pairs to show any order effect.

## Success and Reporting

The machine checks, reporting rules and inventory rules of [Pilot Continuation](PILOT-CONTINUATION.md#success-and-reporting) apply to each conversation. The report states operational cleanliness and answer quality separately, identifies the corpus as imported from `rh-v6`, gives the cumulative accounting from the settlement receipt, states the pairs run at once and the observed concurrency, and reports the full planned population, including failed, incomplete and not-run pairs. A favourable subset is never presented as the result.

Any further collection requires a new owner direction, a new plan and a new acceptance. A fresh session that inherits this series inherits its code and method, not its authority or unused slots.
