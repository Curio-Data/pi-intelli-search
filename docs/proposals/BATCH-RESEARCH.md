# Batch Research Feature Brief

Status: proposed feature, recorded 8 November 2026. The owner has decided to build it and judge its value from use rather than from a prior controlled study. On 17 November 2026 the owner opened the `explore/batch-research` branch to develop the design, and set nominal starting values for three of the four open limits; the size of the batch-wide extraction pool is to be set on the branch (see Starting Values). The owner reduced the super-collation to a single collation call over the per-entry summaries; exploration of the cache folders by the collation model is deferred (see Scope). Release is not yet assigned.

## Summary

Add a batch mode to `intelli_research`, so that an agent can submit several queries in one tool call. Agents already issue research calls in groups: on this host, 39% of `Pi` assistant messages that call `intelli_research` contain two to five calls. In batch mode the agent states whether the queries are independent or form a **semantic expansion**: several queries around one topic, whether rewordings of one need or a main query with the follow-ups the agent already knows it needs. Independent queries return separate reports. An expansion runs the normal pipeline per query, then a final collation call, the **super-collation**, merges the per-query summaries into one combined report. The local telemetry sidecar is extended so that each installation can measure its own use from local files.

## Evidence

A read-only survey of agent transcripts on `hanoi` (26 April to 8 November 2026) measured how agents call the research tools. Only `Pi` sessions held enough calls. Test sessions and development of this repository were excluded. A message below is one assistant message, which may carry several tool calls.

| Measure | Value |
|---|---|
| Messages calling `intelli_research` | 456, containing 728 calls |
| Messages issuing two or more research calls | 180 (39%), holding 62% of calls |
| Research messages following another in the same session within five minutes | 163 of 226 |
| Sampled batches that were semantic expansion | 20 of 30 |
| Sampled batches of independent questions | 10 of 30 |
| Pages fetched more than once within a batch | 14 of 776 (1.8%), across the 74 batches whose caches survive |

Since 16 July 2026 the native research tool declares `executionMode: "sequential"`, so `Pi` runs an agent's separate research calls one at a time even when they are issued together. A batch mode that runs its queries concurrently would shorten that wait; the gain was not measured.

Queries in a batch reach the same sites but almost never the same pages, so sharing fetches and extractions across a batch would save ≈2% of that work. The proposed benefit is in the main conversation: one reconciled report in place of several separate ones, with contradictions reconciled by the collation model before they reach the main model. The survey did not measure this benefit. The telemetry in this brief is how it will be judged.

The completed [_Codemode_ research handoff study](https://github.com/Curio-Data/pi-intelli-search/blob/archive/codemode-research-handoff/docs/CODEMODE.md) tested a single question on one host and main model. It found that a direct `intelli_research` call is already a single self-contained boundary, and that wrapping the call in a _Codemode_ script (the `Pi` JavaScript tool interface) added 526 input tokens to each conversation's first request and carried them again in the resumption request. The batch feature keeps the direct call and adds no wrapper.

The survey's labels come from one rater on a sample of 30 batches. Its report and data are kept as gitignored evidence in the main checkout (`evidence/agents/20261108T204300Z-research-batch-survey/`), because the data contains client query text.

## Interface

Extend the existing research operation rather than registering a new tool. A registered tool's declaration accompanies the model requests of every conversation, so a new tool would add a standing cost to conversations that never batch. Extending `researchSchema` adds only the new parameters' descriptions to the existing declaration.

| Parameter | Meaning |
|---|---|
| `queries` | Optional list of two or more entries. Each entry has a `query` and a `focusPrompt`, and may set `maxUrls` and `domains` |
| `batchMode` | `"expansion"` or `"independent"`, required with `queries` |

A top-level `maxUrls`, `domains` or `focusPrompt` applies to every entry that does not set its own. `query` becomes optional in the schema, so the single-query declaration changes even though single-query behaviour does not. Exactly one of `query` and `queries` must be given, and `batchMode` must accompany `queries`. These rules are validated at run time before any model call, because the strict tool schema cannot express them portably. A settings key caps the number of entries per batch. The exact parameter names are an implementation decision.

## Behaviour

**Independent Mode.** Run the existing five-stage pipeline once per entry and return one section per entry, each with its summary and report path, in a single tool result. A failed entry returns its failure in its own section without failing the batch.

**Concurrency.** Entries run concurrently inside the call, up to a batch concurrency setting. If extraction pools applied per entry, the peak number of concurrent extraction calls would be the batch concurrency multiplied by `extractionConcurrency`, and it would grow with every increase to either setting. This design instead draws every entry's extraction calls from one batch-wide pool, so the peak number of extraction calls in flight is a single setting, independent of batch size. Search and collation calls are not pooled: each running entry makes its own, so the peak number of model calls in flight is the pool size plus at most one call for each entry running at once. Fetches stay per entry, so a batch fetches up to the entries running at once multiplied by `fetchConcurrency` pages at a time, each bounded by the fetch timeout. They go to many different sites rather than to the model provider, and the survey found almost no page shared between entries, so neither pooling nor sharing them is proposed.

The binding constraints are the provider's request and spending limits, not the host's processor count. Model calls and fetches wait on the network. Page parsing with [_linkedom_](https://github.com/WebReflection/linkedom) and content extraction with [_Defuddle_](https://github.com/kepano/defuddle) run on the one _Node.js_ thread that runs the pipeline, so more processor cores do not speed them up unless that work moves to worker threads, which this feature does not propose. A default derived from the processor count would therefore vary between hosts without tracking the actual limit.

The existing `minRequestIntervalMs` throttle is a per-run limiter. In a batch it becomes one limiter shared by every entry: the setting exists for keys with tight rate limits, and a per-entry limiter would multiply the request rate by the number of entries running.

**Expansion Mode.** Run the pipeline per entry as in independent mode, writing each entry's report to the cache as today. Then run the super-collation:

1. The collation model receives every per-entry summary with its query and focus prompt, in one call.
2. It reconciles the summaries into one report: it merges agreeing findings, states contradictions with their sources, and marks gaps that no entry covered.
3. The tool returns the combined report, followed by the path to each per-entry report, so the main model can still open the underlying evidence.

The super-collation works from the summaries alone. On 17 November 2026 the owner removed the 8 November brief's further call, in which the collation model could request a bounded number of named extraction files; it may be added later if the exploration on the branch shows the summaries lack the detail needed to reconcile contradictions (see Exploration Questions) and the addition is practical. The single call uses the existing single-turn model contract (`ModelRequest` in `src/core/contracts.ts`), so neither adapter needs a new request shape.

The super-collation's evidence set is the union of the per-entry evidence: every source URL, and every URL inside those extractions, deduplicated by URL. Its output is validated against that set with the ordinary collation rules: every cited URL must be in the set, source identifiers refer to one batch-wide inventory renumbered across entries, and the output must not name cache files. The combined report ends with the batch-wide source inventory. If the super-collation fails or is rejected, the tool returns the per-entry sections as in independent mode, with the failure stated.

**Agent Guidance.** Update the native `promptGuidelines`, the Model Context Protocol (MCP) tool description in `packages/mcp/src/server.ts`, the native skill `skills/intelli-search/SKILL.md` and the shared source `guidance/research-guide.md`, then regenerate the plugin bundles, so that agents plan related queries at launch and submit them as an expansion batch. The guidance aims to bring foreseeable follow-ups into the batch. The survey did not measure how many of the 163 fast follow-ups were foreseeable. Follow-ups prompted by what a report revealed remain separate calls.

## Cache

Each entry keeps its own folder under `.search/`, with today's same-day rotation. An expansion batch adds a batch folder holding the combined report, the batch manifest (queries, mode and member folders) and its own telemetry record. The manifest records each member's folder as it stood when the batch finished, including any numbered sibling. A repeated batch on the same date rotates the batch folder by the same rule.

Cache suggestion runs once per batch, against the combined queries, and excludes the batch's own members; otherwise each member would surface its siblings as related searches. The index gains one entry for the batch. Its shape, for example a query field holding the joined queries or an added member list, is an implementer decision.

## Telemetry

Each completed or degraded research run writes a local `meta.json` sidecar whose schema is owned by `src/core/telemetry.ts`; per-run changes are additive and optional. Extend it so that batch use can be measured without reading agent transcripts:

| Addition | Where | Purpose |
|---|---|---|
| `batch.id`, `batch.mode`, `batch.size`, `batch.position` | Each per-entry sidecar | Group runs into batches |
| Fetched URL list | Each per-entry sidecar | Measure page overlap directly; the survey had to parse cached source files |
| Super-collation stage: input and output characters, contradictions and gaps reported, duration, outcome | Batch record | Judge whether the final step earns its cost |
| Batch outcome and per-entry outcomes | Batch record | Count partial failures |
| Batch duration, entries running at once and extraction pool size | Batch record | Compare batch time with separate calls and find where the pool stops shortening it |

The batch record is a separate record type with its own file name or a `kind` field and its own `schemaVersion`, so existing readers that treat every `meta.json` as one research run are unaffected. Extend `scripts/analyze-sessions.sh` to report batch frequency, mode, size, overlap and super-collation statistics. Telemetry remains local-only and is suppressed when `disableTelemetry` is set. Recording URLs adds browsing history to a local file that already records the query: state this in the `disableTelemetry` settings row and the Local Telemetry paragraph of the README, and define the fields in `docs/ARCHITECTURE.md`.

## Scope

The feature touches the shared core, so it applies to both packages and, under the repository's versioning scheme, bumps the minor version of `pi-intelli-search` and `mcp-intelli-search`. The MCP adapter registers the shared `researchSchema`, so it exposes the same parameters, and the generated plugin bundles carry the updated guidance.

Out of scope:

- _Codemode_ integration.
- Reuse of fetched pages across entries, given the measured 1.8% page overlap. It can be revisited if the new telemetry shows otherwise.
- Combining calls that an agent makes in separate turns.
- Extraction-file access for the super-collation, removed on 17 November 2026 (see Expansion Mode).
- Exploration of the batch's cache folders by the collation model through read-only tools in a multi-turn loop. The owner raised it on 17 November 2026 and deferred it from this branch. It would need a multi-turn, tool-calling request in both adapters, whose model clients are single-turn today, and a collation model that calls tools reliably.

## Acceptance

- Deterministic tests for both modes: schema and run-time parameter validation, per-entry isolation, partial failure, the batch concurrency cap, the batch-wide extraction pool bound, the single `minRequestIntervalMs` limiter shared across entries, super-collation provenance with source deduplication and renumbering, fallback when the super-collation fails, cache layout, manifest correctness after same-day rotation, cache suggestion excluding batch members, index entries, telemetry fields, and `analyze-sessions.sh` handling of batch records.
- Native contract fixtures updated for the changed schema, prompt guidelines and result shape.
- One live end-to-end scenario per mode in `test/e2e/`, proven runnable before commit, and an MCP scenario through the existing standalone path.
- README settings and telemetry documentation, skill guidance, regenerated package READMEs and plugin bundles, `CHANGELOG.md` entries for both packages and a regenerated `PI_CHANGELOG.md`.

## Dependencies and Open Decisions

- **Sequencing:** recorded on 8 November 2026, this feature depended on the 0.22.0 collation and provenance work on `rcca/mcp-research-failures`, including the fix for URLs inside bold Markdown, on which the super-collation's validation also depends. That work merged and was published as 0.22.0 on 9 November 2026, and later provenance and cache fixes are on `main` under `CHANGELOG.md` `Unreleased`. The feature starts from `main` and targets the next minor version of both packages.
- **Open on the Branch:** the size of the batch-wide extraction pool (see Starting Values), and the answers to the Exploration Questions, which fix the design.
- **Implementer Decisions:** parameter names, the batch result format, the batch folder naming, the location of an independent batch's batch record and the index entry shape.

## Starting Values

The owner set these nominal values on 17 November 2026. Each is a starting point to be tested on the branch and revised from the batch telemetry and the traced runs, not a measured optimum.

| Limit | Starting Value | Basis |
|---|---|---|
| Entries per batch | 10 | Surveyed messages held at most five research calls, and none of the 30 sampled batches held five. Twice the observed maximum, so that a practical limit such as the collation input budget is likely to be found on the branch before the cap constrains agents |
| Entries running at once | 4 | Matches the existing `fetchConcurrency` and `extractionConcurrency` defaults |
| Batch-wide extraction pool | To be set on the branch | Replaces the per-entry multiplication described under Concurrency. A value near today's per-run `extractionConcurrency` keeps a batch's peak load close to one research run; a larger value shortens the batch |
| `minRequestIntervalMs` | One limiter across the batch | A per-entry limiter would multiply the request rate for the keys the setting protects |

## Exploration Questions

The branch answers these before the design is fixed:

- How long a batch of each size takes against the same queries run as separate calls, and where the batch-wide pool stops shortening it.
- Whether the provider returns HTTP 429 (rate limited) or 402 (payment required, which [_OpenRouter_](https://openrouter.ai) returns at its in-flight spending limit) responses as the extraction pool grows, measured with the traced runner `test/run-e2e-parallel.sh`.
- How large the super-collation's input is for a batch of each size, against the collation input budget.
- Whether the per-entry summaries carry enough detail for the super-collation to reconcile contradictions, or whether access to the extraction files is needed.
