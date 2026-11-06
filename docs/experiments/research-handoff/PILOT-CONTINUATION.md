# Bounded Research Handoff Pilot Continuation

Revision: `rh-v6-pilot-1`. The [owner direction](../../../evidence/agents/20261106T143614Z-pilot-completion/owner-direction.json) asks for the bounded pilot to be completed in this session. This protocol continues the closed `rh-v5` series under a new identity. It changes the source cap and the way the common corpus is selected; every other control, check and rubric of [Pilot Protocol](PILOT-PROTOCOL.md), revision `rh-v5-pilot-1`, applies unchanged unless a section below replaces it. The `rh-v5` protocol, root, claims and evidence stay closed and unchanged.

## Purpose and Authority

The `rh-v5` capture was rejected because its six selected sources held four distinct texts and omitted linked setup, configuration and failure evidence. This continuation tests whether a frozen, deterministic source policy produces a corpus that passes the unchanged dual rubrics, and then runs the matched baseline and candidate end-to-end pilot on it. The owner directed completion of the bounded pilot and a checked handover. The source cap, source policy, operation counts, envelope and allocations are coordinator-selected restrictions within that direction, recorded in the owner-direction file, not separately quoted owner decisions. The USD 10 combined ceiling is the ceiling the owner approved for `rh-v5`, retained cumulatively across both series; it is not a fresh grant. Two passing observations establish only that the methodology worked on those observations. They establish no failure rate, equivalence or savings, and they authorise no measured sprint.

All authority is bound to the owner-direction SHA-256 digest `eae365c85b39b6b6acf23e2627d3afbf4c8739311219708ed352160f94c38159` and this new series directory, resolved beneath the existing `research-handoff-runner` checkout:

```text
evidence/benchmarks/research-handoff/20261106T143614Z-rh-v6-pilot
```

The `rh6-` commands accept only an implementation acceptance with scope `research-handoff-pilot-completion-rh-v6`, this revision, this root and this protocol's digest. They refuse the `rh-v5` root, `rh-v5` and `rh-v4` receipts, a second root generation and any root that holds a settlement receipt. The `pilot-` commands remain bound to `rh-v5` and cannot reach this root. Claims are permanent, precede dispatch and remain consumed after failure; unused slots grant nothing.

| Operation | Maximum Count |
|---|---:|
| Subscription-Main Observer Conversations | 2 |
| Common Capture | 1 |
| Charge Qualification | 1 |
| Paid End-to-End Conversations | 2 |
| Replacement Conversations, Recaptures, Measured Sprint | 0 |

## Task, Routes and Profile

The query, focus, domains and route paragraphs of [Pilot Protocol](PILOT-PROTOCOL.md#task-and-routes) are unchanged, including the candidate's initial-script `max_output_tokens` setting of `100000`. The parameters object keeps its four keys in the same order; only `maxUrls` changes, from `6` to `12`:

```json
{
  "query": "When running Pi Durable on Cloudflare, how do I enable outbound email with Cloudflare native services?",
  "focusPrompt": "Identify the current supported end-to-end setup, prerequisites, configuration, code, agent integration points, limitations, and failure modes needed to answer the question. Preserve exact names, APIs, and version or maturity information found in the sources. Distinguish documented instructions from inference.",
  "domains": [
    "developers.cloudflare.com",
    "pi.dev"
  ],
  "maxUrls": 12
}
```

The host, main model, transport, request limits, worker ceiling and credential rules of [Pilot Protocol](PILOT-PROTOCOL.md#host-and-complete-profile) are unchanged. The complete resolved research settings are frozen as follows; only `maxUrls` differs from `rh-v5`:

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
  "maxUrls": 12,
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

Extraction and collation keep the 16,000-token caps, the 300-second per-call timeout, at most three downstream attempts per model call and an extraction concurrency of 2. With twelve selected pages, one paid pilot makes at most twelve extraction calls and one collation call.

## Source Selection Policy

The policy below is frozen before any capture. Code reads the same values from `RH6_SOURCE_POLICY` in `scripts/research-handoff/source-selection.ts`, and a deterministic test requires this block and that constant to be identical.

```json
{
  "id": "rh-v6-source-policy-2",
  "seedLimit": 6,
  "selectedLimit": 12,
  "maxDepth": 2,
  "maxFetches": 24,
  "maxCandidates": 400,
  "maxLinksPerPage": 200,
  "minTermScore": 1,
  "minPrefix": 5,
  "documentExtensions": ["htm", "html", "md"],
  "stopwords": [
    "a", "about", "all", "also", "an", "and", "any", "are",
    "as", "at", "be", "between", "by", "can", "do", "does",
    "each", "for", "from", "how", "i", "if", "in", "into",
    "is", "it", "its", "me", "my", "no", "not", "of", "on",
    "only", "or", "other", "our", "own", "same", "should",
    "so", "such", "than", "that", "the", "their", "them",
    "then", "these", "this", "to", "too", "very", "was", "we",
    "what", "when", "where", "which", "while", "who", "why",
    "will", "with", "would", "yes", "you", "your"
  ],
  "linkBase": "canonical-directory"
}
```

**Discovery.** One fresh search runs through the unchanged research operation with the frozen settings. The package's citation merging and twelve-source cap produce the discovery list, which is recorded unmodified with the raw search text, citations, usage and attempts. No provider citation is added, removed or rewritten.

**Canonical key.** Each URL receives an identity key used only for alias detection: `https` scheme, lower-case host without a trailing dot, any explicit non-default port, query and fragment removed, repeated slashes collapsed, a final `index.md`, `index.html` or `index.htm` removed, and a trailing slash added to an extensionless final segment. An HTML page and its `index.md` alternate therefore share one key. The key drops the query, so URLs that differ only in query share one key and only the first reached is fetched. The page actually fetched is the resolved URL, path and query exactly as written, with only its fragment removed; the policy never rewrites it.

**Seeds.** Discovery URLs are taken in order. A URL is rejected when it is invalid or uses a scheme other than `http` or `https`, when its host does not exactly equal one of the task's `domains` (subdomains and parent domains are rejected), when its final path segment has an extension outside `documentExtensions`, when its key repeats an earlier seed, or when `seedLimit` seeds are already admitted. Every decision is recorded. Seeds are fetched first, in discovery order.

**Followed links.** The links of each selected page below `maxDepth` are read from its captured content: *Markdown* inline links, autolinks and reference definitions, in document order, excluding images, fragment-only links and non-web schemes, and at most `maxLinksPerPage` per page. Links inside code blocks are included. Each link is resolved against the page's directory-form base (`linkBase: "canonical-directory"`): the requested URL with its fragment removed and, when its final path segment has no extension and no trailing slash, a trailing slash appended; the query is kept. A page requested as `…/email-service` or `…/email-service/index.md` therefore resolves `setup/` to `…/email-service/setup/`, and a root-relative link such as `/workers/` resolves against the host. A resolved link becomes a candidate only when its host is allowed, it is a document, its key is new and fewer than `maxCandidates` candidates exist. Its relevance score is the number of distinct task terms it matches. Task terms are the lower-case alphanumeric tokens of the frozen query and focus, excluding the stopwords and all-digit tokens. A link's tokens come from its anchor text and its decoded URL path. Two tokens match when they are equal, or when both have at least `minPrefix` characters and share their first `minPrefix` characters. A candidate below `minTermScore` is recorded and never fetched.

**Order and stopping.** After the seeds, the next fetch is the eligible candidate with the highest score, then one in the same first path segment as its parent, then the lowest depth, then the earliest discovered. Pages are fetched one at a time through the unchanged package fetch path and options. A successful, nonempty page whose content digest is new is selected and, below `maxDepth`, expanded. A fetch error, empty content or content identical to a selected page is recorded and not selected. Selection stops at `selectedLimit` selected pages, at `maxFetches` acquisitions or when no eligible candidate remains, and the stop reason is recorded. Every selected page is therefore a successful capture; fewer than two selected pages fails the capture.

The policy contains no product, mechanism or URL chosen for this task. Its relevance terms come only from the frozen query and focus.

## Capture, Derivation and Replay

The capture claims its slot once and runs inside the USD 0.81 allowance. It retains the raw discovery record, every policy fetch with its returned page, and a separate derived inventory (`sourceDerivation`) holding the policy and its digest, task terms, discovery decisions, the fetch log, all candidates with scores and statuses, ignored-link counts, the selected pages and the stop reason. The frozen corpus digest covers both records.

Frozen-input validation keeps every `rh-v5` check of the raw discovery list. For a derived corpus it also requires a registered frozen policy, aligns the frozen pages with the derived inventory rather than the discovery list, requires every selected page to be a successful capture and re-runs the policy from the recorded discovery list and fetch log. Any difference from the recorded derivation or pages rejects the corpus before admission or dispatch. A worker for this revision refuses a corpus without a derivation, and an `rh-v5` worker refuses a corpus with one.

During each pilot, the research core requests the recorded discovery list from the fixed-source fetch adapter, which checks it exactly and serves the derived selected pages. Both arms therefore replay the same raw search completion and the same selected page bytes, with live extraction and collation. Captured pages are never re-fetched, so page text that varies by rendering date cannot differ between arms. The fetch record names both the requested discovery list and the served page URLs. The core's reported URL count remains the discovery-list count.

## Frozen Assessment Criteria

These criteria are fixed before source selection. Corpus and answer reviewers must be fresh and must not read the earlier topic-validation answer, its disclosure query, the coordinator's answer-shaped planning discussion, `rh-v4` answers and grades, or the rejected `rh-v5` corpus review. Give reviewers bounded inputs: this rubric and task, the frozen captured sources, applicability metadata and, for answer assessment, the de-identified answer and its evidence-access record. Do not provide full conversation history, the raw search text or another reviewer's grades.

The five paragraphs that follow (the two rubric definitions, the topic table, the failure rules, corpus acceptance and the locked answer gate) are byte-identical copies of the corresponding paragraphs of [Pilot Protocol](PILOT-PROTOCOL.md#frozen-assessment-criteria), and a deterministic test checks each one. The surrounding paragraphs of this section are specific to `rh-v6`.

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

For a derived corpus, the corpus reviewer receives the selected page bytes and the derivation without page bodies, from `rh6-corpus-review-inputs`, so that each selected page's route from discovery can be checked. That bundle omits the raw search text; the answer-review bundle from `rh6-review-inputs` omits it too. Followed links are evidence only when their pages were selected and captured.

Prepare answer-review bindings and ungraded templates with the credential-free `rh6-review-inputs` command before briefing reviewers. Record identity uses a digest of canonical, recursively key-sorted JSON, not a file-byte hash; answer identity uses its raw text. Corpus identity is the capture's `digest`, and rubric identity is this protocol's file digest. Give each reviewer a neutral answer label and digest bindings, not a route-bearing run name or the other review. This removes explicit labels but does not guarantee blinding: run-name digests can be matched to predictable names, and answer text can reveal the route. Reviewers must not derive assignments from digests or inspect the coordinator's mapping. The coordinator retains the mapping to the actual run and assembles the lock only after both independent grades are written.

## Gate Sequence

1. Freeze this protocol and implement the continuation. Validate build, native and standalone deterministic tests, explicit handoff tests and types, native-contract types and applicable generators with equal source identities before and after. Run the credential-free `rh6-synthetic` actual-host cases on the derived synthetic corpus.
2. Obtain independent technical review and fresh _Opus_ prose review, resolve blockers and record implementation acceptance bound to the code, this protocol, the owner direction, the designated root and the review digests.
3. `rh6-observe`: both subscription-main observer conversations, baseline then candidate, with synthetic downstream work, as in `rh-v5` step 3. Independent review must accept both before admission.
4. `rh6-admit`: refresh the public model catalogue without inference and create financial admission.
5. `rh6-capture`: the single capture under the frozen source policy, then `rh6-corpus-review-inputs` and one fresh corpus review. A capture failure or corpus rejection ends preparation.
6. `rh6-qualify`: one charge-reporting extraction of the first selected page, at most three attempts.
7. `rh6-run` and `rh6-gate` for the baseline: all machine checks, known final charges and both locked dual-rubric assessments.
8. At least 30 seconds after the baseline worker ends, `rh6-run` and `rh6-gate` for the candidate with the same checks. On completion or any earlier stop, `rh6-settle` closes the series once.

## Financial Controls

| Operation | Maximum Exposure |
|---|---:|
| Common Capture | USD 0.81 |
| Charge Qualification | USD 1.01 |
| Baseline Pilot | USD 4.08715 |
| Candidate Pilot | USD 4.08715 |
| Total | USD 9.9943 |

The combined ceiling is the owner's original `rh-v5` approval of USD 10, held cumulatively across both series rather than granted again. The owner-direction file records it with the closed `rh-v5` settlement's reported USD 0.0057, no unknown-charge holds and no active reservations, which leaves the USD 9.9943 envelope. Verification reads that settlement and requires its values to match; it never writes to the `rh-v5` root. The envelope and allocations are coordinator-selected ceilings, not expected charges.

The per-attempt reservations are unchanged: USD 0.134072 for *Perplexity Sonar* and USD 0.3337728 for *MiniMax M3* extraction or collation. Six Sonar reservations fit the capture allowance and three M3 reservations fit qualification. Each pilot allowance holds twelve full M3 reservations at once (USD 4.0052736). A pilot whose providers report no charge holds each attempt at its reservation, so thirteen unreported calls exceed the allowance; the resulting refusal fails the pilot. Policy page fetches make no model call and carry no charge. The reservation, unknown-hold, overrun, interruption and settlement rules of [Pilot Protocol](PILOT-PROTOCOL.md#financial-controls) apply unchanged.

## Success and Reporting

The machine checks, answer gate, reporting rules and inventory rules of [Pilot Protocol](PILOT-PROTOCOL.md#success-settlement-and-reporting) apply, with every selected source of the derived inventory required to extract without truncation. Report the derivation separately from pipeline outcomes: discovery decisions, selected pages with depth and parent, rejected and failed fetches, and the stop reason.

Any larger or measured comparison requires a new owner decision and protocol. A fresh session that inherits a passing pilot inherits its code, policy and assessment method, not this series' authority or unused slots.
