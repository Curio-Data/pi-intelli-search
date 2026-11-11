# Batch Research Feature Brief

Status: proposed feature, recorded 8 November 2026. The owner has decided to build it and judge its value from use rather than from a prior controlled study. Implementation ownership, sequencing and release are not yet assigned.

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

Queries in a batch reach the same sites but almost never the same pages, so sharing fetches and extractions across a batch would save about 2% of that work. The proposed benefit is in the main conversation: one reconciled report in place of several separate ones, with contradictions reconciled by the collation model before they reach the main model. The survey did not measure this benefit. The telemetry in this brief is how it will be judged.

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

**Concurrency.** Entries run concurrently inside the call, up to a batch concurrency setting. Fetch and extraction pools apply per entry, so the peak number of concurrent extraction calls is the batch concurrency multiplied by `extractionConcurrency`. The existing `minRequestIntervalMs` throttle is a per-run limiter and does not space calls across entries unless it is made batch-wide.

**Expansion Mode.** Run the pipeline per entry as in independent mode, writing each entry's report to the cache as today. Then run the super-collation:

1. The collation model receives every per-entry summary, the queries and their focus prompts, and the list of each entry's extraction files.
2. It reconciles the summaries into one report: it merges agreeing findings, states contradictions with their sources, and marks gaps that no entry covered.
3. Where the summaries are insufficient or contradict each other, it may request a bounded number of named extraction files, which are supplied in one further call. It does not receive general file access.
4. The tool returns the combined report, followed by the path to each per-entry report, so the main model can still open the underlying evidence.

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
| Super-collation stage: input and output characters, extraction files requested, contradictions reported, duration, outcome | Batch record | Judge whether the final step earns its cost |
| Batch outcome and per-entry outcomes | Batch record | Count partial failures |

The batch record is a separate record type with its own file name or a `kind` field and its own `schemaVersion`, so existing readers that treat every `meta.json` as one research run are unaffected. Extend `scripts/analyze-sessions.sh` to report batch frequency, mode, size, overlap and super-collation statistics. Telemetry remains local-only and is suppressed when `disableTelemetry` is set. Recording URLs adds browsing history to a local file that already records the query: state this in the `disableTelemetry` settings row and the Local Telemetry paragraph of the README, and define the fields in `docs/ARCHITECTURE.md`.

## Scope

The feature touches the shared core, so it applies to both packages and, under the repository's versioning scheme, bumps the minor version of `pi-intelli-search` and `mcp-intelli-search`. The MCP adapter registers the shared `researchSchema`, so it exposes the same parameters, and the generated plugin bundles carry the updated guidance.

Out of scope:

- _Codemode_ integration.
- Reuse of fetched pages across entries, given the measured 1.8% page overlap. It can be revisited if the new telemetry shows otherwise.
- Combining calls that an agent makes in separate turns.

## Acceptance

- Deterministic tests for both modes: schema and run-time parameter validation, per-entry isolation, partial failure, the batch concurrency cap and throttle behaviour, super-collation provenance with source deduplication and renumbering, the extraction-request bound, fallback when the super-collation fails, cache layout, manifest correctness after same-day rotation, cache suggestion excluding batch members, index entries, telemetry fields, and `analyze-sessions.sh` handling of batch records.
- Native contract fixtures updated for the changed schema, prompt guidelines and result shape.
- One live end-to-end scenario per mode in `test/e2e/`, proven runnable before commit, and an MCP scenario through the existing standalone path.
- README settings and telemetry documentation, skill guidance, regenerated package READMEs and plugin bundles, `CHANGELOG.md` entries for both packages and a regenerated `PI_CHANGELOG.md`.

## Dependencies and Open Decisions

- **Sequencing:** recorded on 8 November 2026, this feature depended on the 0.22.0 collation and provenance work on `rcca/mcp-research-failures`, including the fix for URLs inside bold Markdown, on which the super-collation's validation also depends. That work merged and was published as 0.22.0 on 9 November 2026, and later provenance and cache fixes are on `main` under `CHANGELOG.md` `Unreleased`. The feature starts from `main` and targets the next minor version of both packages.
- **Owner Decisions:** the per-batch entry cap, the default batch concurrency, whether `minRequestIntervalMs` applies across a whole batch, and the extraction-request bound for super-collation.
- **Implementer Decisions:** parameter names, the batch result format, the batch folder naming and the index entry shape.
