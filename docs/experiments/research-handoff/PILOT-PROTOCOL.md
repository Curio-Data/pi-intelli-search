# Bounded Research Handoff Pilot

Revision: `rh-v5-pilot-1`. The [owner decision](../../../evidence/agents/20261105T173919Z-handoff-resume/owner-decision.json) approves USD 10 for the bounded sequence below. Implementation acceptance and live admission are separate records bound to this protocol's digest. The historical [Protocol](PROTOCOL.md) remains the contract for `rh-v4`; its measured schedule and claim gate do not apply to this pilot.

## Purpose and Authority

The pilot tests whether direct research and research through `Pi`'s Codemode JavaScript tool interface can complete with matched larger output allowances, observable recovery and useful source-supported answers. It permits at most two subscription-main observer conversations with synthetic downstream work, one fresh common capture, one charge-reporting qualification and at most two paid end-to-end conversations, baseline first. A failed preparation or pilot stops progression. There are no replacements, recaptures, extra control conversations or measured sprint. Unused money does not authorise another operation.

All authority is bound to the owner-decision SHA-256 digest `e1c62950e919e69f6d94e1076b5f38b4643bd6cc11aa728bde7e487f9ebd8f79` and this real series directory:

```text
evidence/benchmarks/research-handoff/20261105T173919Z-rh-v5-pilot
```

Resolve that path beneath the existing `research-handoff-runner` checkout. Reject another root, historical approval scopes, duplicate operation claims and twenty-conversation schedules. Each claim is permanent, precedes dispatch and remains consumed after failure. Record later acceptances separately; do not modify the owner's `dispatchReady: false` recording-time state.

## Task and Routes

The query is unchanged:

> When running Pi Durable on Cloudflare, how do I enable outbound email with Cloudflare native services?

The focus is unchanged:

> Identify the current supported end-to-end setup, prerequisites, configuration, code, agent integration points, limitations, and failure modes needed to answer the question. Preserve exact names, APIs, and version or maturity information found in the sources. Distinguish documented instructions from inference.

The parameters object has exactly four keys, in this insertion order: `query`, `focusPrompt`, `domains`, `maxUrls`. `query` and `focusPrompt` contain the verbatim strings above; `domains` is `["developers.cloudflare.com", "pi.dev"]`; `maxUrls` is `6`. Neither prompt preselects an email mechanism, product or document. Both arms use the same research core and the search and page bytes from the single fresh capture; extraction and collation remain live. This is not a fixed-response control.

The paid prompt consists of the following paragraphs, separated by two newline characters, then `Research parameters:` and the exact parameters rendered with `JSON.stringify(params, null, 2)` as separate paragraphs:

1. `Research the following task using the provided research operation, then answer in at most 600 words with source citations and the saved report reference.`
2. Baseline: `Make one direct intelli_research call using the exact parameters below.` Candidate: `Make one initial Codemode call. Write your own script that awaits tools.intelli_research once using the exact parameters below and returns its complete text once, unchanged. Set the initial script's max_output_tokens option to 100000 and leave timeout_ms unset.`
3. Baseline: `Do not perform additional research calls. Use the returned summary directly; read saved evidence only if it is insufficient. Later evidence-only read calls are permitted but must not invoke research again. Preserve material failures and truncation caveats.` Candidate: `Do not perform additional research calls. Use the returned summary directly; read saved evidence only if it is insufficient. Later evidence-only Codemode calls are permitted but must not invoke research again. Preserve material failures and truncation caveats.`

No executable script is supplied to the live main model. The candidate activates the pinned host's Codemode with `mode: "only"`, `inlineBudget: 3000` and `models: false`; the baseline does not activate it. `inlineBudget` controls tool declarations, not returned research text. The initial script's `max_output_tokens: 100000` setting raises the limit on script output returned to the main model from its default of 10,000 estimated tokens before any live observation. This supplies headroom for the larger collation allowance without increasing model-generation caps. An initial script without exactly that option, or with `timeout_ms` or another option set, fails the pilot. Verify the option and complete return preservation independently. Output beyond this limit is elided and fails the return check; the host's hard limit of 16,777,216 output characters also remains in force. Both have workspace-contained read access, directly for the baseline and through Codemode for the candidate, and no shell or independent network tool. Their recovery policy is matched; the route-specific wording names only the capability available to each arm. Preserve the native declaration, schema, guidance, progress, complete return and saved references.

The initial research result must reach the main model completely and exactly once. Accept the pinned host's single returned text item or single console-output envelope, including its known newline wrapping. Reject projection, truncation, duplication and extra script-authored output. Apply the return check to the first research handoff even when later evidence calls occur. A failed research call is retained and fails the pilot; an explanatory final answer does not turn it into success.

The first top-level call must be the assigned research handoff; any earlier call fails initial-invocation conformance. Record recovery by position and purpose: every top-level tool call after the initial research handoff is additional work, including a Codemode call without a nested `read`. Record its nested calls, parameters and result separately without counting them as additional top-level recoveries. Evidence recovery is permitted only for saved evidence and never permits a second research invocation. A later Codemode call with no nested read remains recorded. Its evidence-only purpose requires a separate source-cited review, not an inference from call shape; without confirmed evidence-only purpose, the call fails the acceptance gate. Report initial invocation, recovery, full topology, pipeline outcome and answer quality separately. Preserve the historical one-handoff checks for historical records.

## Host and Complete Profile

Use `Pi` 1.5.0 from the retained path in `config.ts`. Verify loaded host and peer identities separately from the checkout's native-wrapper dependencies. Each conversation uses a fresh process, empty workspace, isolated resource loader and session. Do not change package defaults or install replacement peers to make an experiment check pass.

| Control | Value |
|---|---|
| Main Model | `openai-codex/gpt-6.1-sol` |
| Common Search | `openrouter/perplexity/sonar` |
| Extraction and Collation | `openrouter/minimax/minimax-m3` |
| Reasoning | `low` |
| Main Transport | Server-Sent Events (`sse`) |
| Main Logical Requests | At Most 4 |
| Main Attempts Per Logical Request | At Most 3 (`maxRetries: 2`) |
| Main Cache Retention | `none` |
| Session Retry and Automatic Compaction | Disabled |
| Worker Ceiling | 1,800,000 Milliseconds |

The host's main request builder does not emit a custom output cap. Retain its catalogue output limit and record any actual truncation. `cacheRetention: "none"` omits a prompt-cache key where supported; it does not establish that provider caching is disabled. No cache warming or serving-provider pinning is added.

The complete resolved research settings are frozen as follows. `httpProxy` is undefined and omitted by JavaScript Object Notation (JSON) serialisation.

```json
{
  "searchModel": {
    "provider": "openrouter",
    "model": "perplexity/sonar"
  },
  "extractModel": {
    "provider": "openrouter",
    "model": "minimax/minimax-m3"
  },
  "collateModel": {
    "provider": "openrouter",
    "model": "minimax/minimax-m3"
  },
  "searchWebSearch": {
    "enabled": false,
    "engine": "auto",
    "maxResults": 8,
    "reasoning": "minimal"
  },
  "defaultUrls": 6,
  "maxUrls": 6,
  "cacheDir": ".search",
  "extractMaxChars": 150000,
  "fetchTimeoutMs": 20000,
  "fetchConcurrency": 4,
  "extractionConcurrency": 2,
  "extractionMaxTokens": 16000,
  "collationMaxTokens": 16000,
  "browserFingerprint": "chrome_145",
  "disableLlmsFullDiscovery": true,
  "disableTelemetry": false,
  "llmTimeoutMs": 300000,
  "llmRetryAttempts": 3,
  "retryBaseDelayMs": 1500,
  "retryMaxDelayMs": 20000,
  "searchRetryAttempts": 2,
  "minRequestIntervalMs": 0
}
```

Search uses the existing 2,000-token cap. Extraction and collation each use a 16,000-token cap, including hidden reasoning. Verify intended limits on the dispatched payload, not just the settings file. At most three downstream attempts occur per model call; the two logical search attempts permit at most six search attempts during capture. Each pilot's fresh cache holds no earlier search, so the cache-suggest judge makes no model call. A judge call fails the pilot. The worker ceiling can pre-empt remaining 300-second attempts; retain that failure without extending or replacing the worker.

## Capture and Input Equality

The one capture uses fresh search, the package's unchanged citation merging and the six-source cap. Preserve raw search text, annotations, usage, all attempts, selected URL order, page text, titles, variant metadata and failed positions. Fetch selected pages once through the unchanged package fetch path. Do not hand-select replacements, follow uncaptured links as assessment evidence or introduce a live fallback during replay.

Bind the complete settings, search request, query, focus, domains, ordered pages and expected extraction messages before live delegation. Structured identities use recursively key-sorted JSON with array order preserved; text digests use raw UTF-8 bytes. Extraction identity includes the system prompt and the full user message after `extractMaxChars` truncation. Repeated identical messages form a multiset whose every occurrence must be consumed once. Latch any mismatch and refuse subsequent model work. Keep input equality separate from execution completeness and provider failure.

The common corpus stays outside model-readable workspaces. Each pilot receives its own fresh cache populated through the unchanged research operation. Captured search usage remains setup provenance with an explicit replay marker, not a new charge or downstream attempt.

## Frozen Assessment Criteria

These criteria are fixed before source selection. At the initial freeze on 6 November 2026, the coordinator had not opened the earlier topic-validation answer or its disclosure query. Corpus and answer reviewers must be fresh and must not read those materials, the coordinator's answer-shaped planning discussion, or `rh-v4` answers and grades. Give reviewers bounded inputs: this rubric and task, the frozen captured sources, applicability metadata and, for answer assessment, the de-identified answer and its evidence-access record. Do not provide full conversation history or another reviewer's grades.

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

Before qualification, every selected page must have been captured successfully. One fresh corpus reviewer must establish at least two readable selected pages, coverage of every required topic under both rubrics, and applicability to the currently documented setup. Record duplicate texts and each source's version or maturity label; justify unversioned applicability. Reject missing setup or failure evidence unless an explicit captured limitation makes that information inapplicable. A rejected single capture ends preparation.

For each paid answer, two fresh reviewers independently lock their initial grades before either sees the other's judgement. Bind each locked review to the raw record, answer, corpus and rubric digests, reviewer identity and immutable review artefact. A reviewer's overall verdict passes only when every topic in both rubrics passes. Compare the reviewers' overall answer verdicts: if both fail, the gate fails even when they failed different topics. If one passes and one fails, progression remains blocked unless a fresh equally isolated reviewer records a source-cited adjudication of the whole answer, resolving every failed criterion as a pass under these unchanged criteria. Preserve both initial grades and any adjudication. Missing or unresolved grades fail the gate.

Prepare review bindings and ungraded templates with the credential-free `pilot-review-inputs` command before briefing reviewers. Record identity uses a digest of canonical, recursively key-sorted JSON, not a file-byte hash; answer identity uses its raw text. Corpus identity is the capture's `digest`, and rubric identity is this protocol's file digest. Give each reviewer a neutral answer label and digest bindings, not a route-bearing run name or the other review. This removes explicit labels but does not guarantee blinding: run-name digests can be matched to predictable names, and answer text can reveal the route. Reviewers must not derive assignments from digests or inspect the coordinator's mapping. The coordinator retains the mapping to the actual run and assembles the lock only after both independent grades are written.

## Gate Sequence and Schedule

1. Freeze this protocol and implement the integrated pilot path. Validate build, native and standalone deterministic tests, explicit handoff tests and types, native-contract types and applicable generators with equal source identities before and after. Run fresh credential-free actual-host cases for complete, truncated and failed returns, recovery, monetary refusal and the worker ceiling. Use separate roots for preflight and synthetic commands.
2. Obtain independent technical review and fresh _Opus_ prose review. Resolve blockers and repeat affected checks on final bytes. The coordinator records implementation acceptance bound to the code, protocol, owner decision, designated root and review digests before any live conversation.
3. Claim and run at most two subscription-main observer conversations with synthetic downstream work, baseline then candidate. Each arm has one unique slot. Use the route and recovery paragraphs above, but replace the opening paragraph with `This is a synthetic observer qualification, not factual research. Make the required handoff once, then briefly acknowledge its returned summary and saved report reference. Do not answer the research question substantively.` Independently review request coverage, usage, assigned route and complete unchanged return. A baseline machine-check failure stops the sequence before the candidate diagnostic. Independent review follows the completed observer sequence and covers recovery purpose; rejection of either diagnostic stops before financial admission. The second slot is not a retry.
4. Refresh the public model catalogue without inference. Validate the bounds below and create financial admission against the accepted implementation, decision and designated root. No paid operation precedes this admission.
5. Claim the common capture once. Require a numeric reported charge on successful search, retain all failed-attempt liabilities, and obtain the corpus review above. A capture or review failure stops preparation.
6. Claim one charge qualification: extract the first readable selected page in the accepted frozen source order using the ordinary extraction prompt and the complete pilot profile, at most three attempts. Require the successful completion's reported charge and known final accounting. This checks the financial channel, not full collation or answer usefulness.
7. Accept and run the baseline pilot. Require all machine checks below, final financial accounting for the baseline run and both independently locked dual-rubric assessments before accepting the candidate. The baseline gate verifies its settled charges; do not run the series-closing `pilot-settle` command at this point. Keep at least 30 seconds between the baseline worker's end and candidate start.
8. Run the candidate only after that acceptance. Apply the same machine, financial and assessment checks. On completion of both pilot gates or any earlier stop, settle the claimed preparation and pilot identities once, closing the series to further live work. Retain unused slots, produce the inventories and findings, and stop.

## Financial Controls

| Operation | Maximum Exposure | Maximum Count |
|---|---:|---:|
| Common Capture | USD 0.81 | 1 |
| Charge Qualification | USD 1.01 | 1 |
| Baseline Pilot | USD 4.09 | 1 |
| Candidate Pilot | USD 4.09 | 1 |
| Total | USD 10.00 | |

These allocations are coordinator-selected ceilings inside the owner's approval, not expected charges. A pilot envelope holds twelve full M3 reservations at once; it does not cover every retry path. A refusal for insufficient allowance fails the pilot. Subscription-main usage is reported separately. The two observer slots admit no chargeable downstream calls.

The preliminary per-attempt [_Perplexity Sonar_](https://docs.perplexity.ai) reservation remains USD 0.134072: 127,072 input tokens at USD 0.000001, 2,000 output tokens at that rate and a USD 0.005 search fee. The preliminary [_MiniMax M3_](https://minimax.io) reservation is USD 0.3337728 for either extraction or collation: 1,048,576 input tokens at USD 0.0000003 plus 16,000 output tokens at USD 0.0000012. Six Sonar reservations fit the capture allowance; three M3 reservations total USD 1.0013184 and fit qualification. Refresh and retain the public rates at admission; reject a catalogue or rate change exceeding these bounds.

Reserve atomically before every actual downstream attempt. Replace a reservation with a numeric provider-reported charge only when available; otherwise retain an unknown-charge hold. Reported charges, holds and active reservations all consume allowance. Preserve overrun liabilities even when they exceed the bound, latch refusal or overrun, refuse later model work and stop progression. A missing final receipt after dispatch retains the conservative stage hold. Settlement refuses potentially active work. For an interrupted stage lacking a terminal record, a separate coordinator interruption receipt must bind inspection evidence and confirm that no relevant process remains active before conservative close-out, which holds the full stage ceiling and records no pipeline outcome. Errors with no returned text do not release uncertain charges. A low expected charge never substitutes for admission headroom.

## Success, Settlement and Reporting

A paid pilot passes machine checks only when it makes exactly one assigned research invocation as its first top-level call; no cache-suggest judge call occurs; all prescribed inputs and settings match; request observation and usage are complete; every selected source extracts successfully without truncation; collation is nonempty and untruncated; the complete initial return is preserved; cited saved evidence is readable; a settled final answer arrives within the main-request and worker bounds; and final accounting has known charges with no active reservations, unknown holds or overrun. Permitted evidence recovery does not itself fail those checks. Both independent answer rubrics must also pass before the pilot is accepted.

Retain full requests, results, raw provider usage and serving routes. Main input totals include cached input; do not substitute cache-subtracted SDK counts. Missing usage is unknown, not zero. Report token counts, charges, text sizes, retries, truncation, initial invocation, all recovery work, pipeline outcomes and evidence access separately. Component token estimates remain labelled proxies; provider item counts require reconciliation and do not add nested content twice.

Settlement traverses only the claimed preparation and pilot identities under this decision and closes the series to further live work. Preserve failed attempts, unfinished liabilities and not-run slots, with active reservations reported separately from unknown-charge holds. Offline analysis must reproduce from immutable raw records and separately joined assessments; it must not apply the historical twenty-run savings gate to the pilot. Use separate observer and paid inventories with their respective corpus and financial mode; reject duplicate rows, path escapes and mixed inventories. Deliver the observer and paid inventories, a final inventory naming preparation outcomes and unused slots, reproducible analysis for each collected group, and a short findings note under this new identity. Update the current [Checkpoint](CHECKPOINT.md) with what actually ran.

Two passing observations establish that the methodology worked on those observations only. They establish no stable failure rate, equivalence or comparative savings. Return any proposed fixed-response control or measured sprint to the owner with a separate schedule and decision.

## Credentials and Retention

Use only the explicit read-only credential reference `/home/miah0x41/.pi/agent/auth.json` through the non-refreshing credential store. Never print, copy or refresh it. OAuth access must have at least 35 minutes remaining before each worker; ask the operator to refresh through normal login when it does not. Recheck after assessment delays.

Preserve historical evidence and this pilot's failed preparations. New scratch belongs under the checkout's `.tmp/`; set an existing encrypted `TMPDIR` before every parent TypeScript-loader or package command. Do not delete scratch or evidence, change package defaults, publish, merge `main` or create another worktree under this assignment.
