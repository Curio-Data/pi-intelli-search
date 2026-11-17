# Batch Research Feature Brief

Status: proposed feature, recorded 8 November 2026. The owner has decided to build it and judge its value from use rather than from a prior controlled study. On 17 November 2026 the owner opened the `explore/batch-research` branch to develop the design, and set nominal starting values for the open limits (see Starting Values). The owner reduced the super-collation to a single collation call over the per-entry summaries; exploration of the cache folders by the collation model is deferred (see Scope). Release is not yet assigned.

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

**Why Agents Follow Up.** On 17 November 2026 a labelling of 30 of the 163 fast follow-ups (seeded sample, one rater, from the agent's reasoning between the two calls) recorded why the agent called again. In 15 the next call was the next step of a plan the agent already held, such as the next of a list of questions. In 11 the previous result fell short: 9 were thin, failed, stale or ambiguous, or left out part of a multi-part query, and in 2 the agent doubted or corrected a claim. One followed a new question that a finding opened, and 3 were prompted by the user or the agent's own code work. Evidence: `evidence/agents/2026-11-17-followup-reasons/`.

Batch mode bears on both main groups. Planned steps are foreseeable at launch, so an agent could submit them as one batch. A shortfall costs a further round of search, read and judge in the main conversation; an expansion batch can reduce that only if the combined report covers each part of the need and names its gaps, so that one targeted follow-up replaces several. Neither effect is measured; the effectiveness comparison in Phase 4 measures them.

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

**Agent Guidance.** Update the native `promptGuidelines`, the Model Context Protocol (MCP) tool description in `packages/mcp/src/server.ts`, the native skill `skills/intelli-search/SKILL.md` and the shared source `guidance/research-guide.md`, then regenerate the plugin bundles, so that agents plan related queries at launch and submit them as an expansion batch. The guidance aims to bring foreseeable follow-ups into the batch. The follow-up labelling found half of the sampled fast follow-ups were planned steps (see Why Agents Follow Up). Follow-ups prompted by what a report revealed remain separate calls.

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
- **Open on the Branch:** the answers to the Exploration Questions, which fix the design and may revise the Starting Values.
- **Implementer Decisions:** parameter names, the batch result format, the batch folder naming, the location of an independent batch's batch record and the index entry shape.

## Starting Values

The owner set these nominal values on 17 November 2026. Each is a starting point to be tested on the branch and revised from the batch telemetry and the traced runs, not a measured optimum.

| Limit | Starting Value | Basis |
|---|---|---|
| Entries per batch | 10 | Surveyed messages held at most five research calls, and none of the 30 sampled batches held five. Twice the observed maximum, so that a practical limit such as the collation input budget is likely to be found on the branch before the cap constrains agents |
| Entries running at once | 4 | Matches the existing `fetchConcurrency` and `extractionConcurrency` defaults |
| Batch-wide extraction pool | 8 | Twice today's per-run `extractionConcurrency`, so a batch is faster than one research run without the per-entry multiplication described under Concurrency; adjusted from the traced runs |
| `minRequestIntervalMs` | One limiter across the batch | A per-entry limiter would multiply the request rate for the keys the setting protects |

## Exploration Questions

The branch answers these before the design is fixed:

- How long a batch of each size takes against the same queries run as separate calls, and where the batch-wide pool stops shortening it.
- Whether the provider returns HTTP 429 (rate limited) or 402 (payment required, which [_OpenRouter_](https://openrouter.ai) returns at its in-flight spending limit) responses as the extraction pool grows, measured with the traced runner `test/run-e2e-parallel.sh`.
- How large the super-collation's input is for a batch of each size, against the collation input budget.
- Whether the per-entry summaries carry enough detail for the super-collation to reconcile contradictions, or whether access to the extraction files is needed.
- Whether batch mode reduces the research calls, turns and main-model tokens an agent spends to reach an answer of the same or better quality.

## Implementation Plan

Recorded on 17 November 2026 for the `explore/batch-research` branch. Each phase ends with `npm run build:all`, `npm run test:all` and a commit; phases 2 to 4 also run `./test/e2e/01_main.sh`, because they change the single-query path.

**Implementer decision recorded here.** Both modes write a batch folder, `.search/<date>-batch-<slug>-<hash>/`, holding the manifest and the batch record; only an expansion batch adds the combined `report.md`. This settles where an independent batch's record lives and keeps one layout for both modes.

### Phase 0: Super-Collation Spike

Before any pipeline change, a maintainer script under `scripts/` runs the proposed super-collation prompt over two to five existing `report.md` files that answer related queries, with the default collation model. It renumbers each report's `[S<n>]` identifiers into one batch-wide series, records input and output size against `collationInputBudgetTokens`, and saves the combined output for reading. The spike answers the third and fourth Exploration Questions early and fixes the prompt before it is wired in. It spends live quota and is run by hand, not by the test suite.

**Result (17 November 2026).** Three runs of `scripts/spike-super-collation.mjs` over four related reports of 3 November 2026, with MiniMax M3 (evidence: `evidence/agents/2026-11-17-batch-spike/`):

- **Provenance holds.** Every cited identifier was valid after renumbering (20 source rows became 14), and every URL in the prose came from the summaries supplied, so the existing `finalizeCollation()` rules would accept each output.
- **The input budget does not limit batch size.** Four summaries made ≈6,000 prompt tokens; ten would make ≈15,000 against the 221,000-token default `collationInputBudgetTokens`. This answers the third Exploration Question for the default settings.
- **Each call took 80 to 160 s.** The super-collation starts after the slowest entry finishes, so this time adds directly to an expansion batch's wall time.
- **The output is long.** It was 49% to 70% of the combined summaries' length, so the main conversation saves less text than a merged report suggests.
- **The prompt needs two fixes.** One run listed complementary detail as contradictions, and one referred to entries as "run 3" and "run 4", names the reader never sees. Phase 3 asks for contradictions only where sources disagree, and names entries by query.

**Timing Basis.** The comparison that matters is a batch of N queries against the same N queries as an agent issues them today, not against one query. On `Pi` the native tool declares `executionMode: "sequential"`, so the calls an agent issues together run one after another, and the baseline is the sum of their run times. The spike did not measure a batch. An estimate from the four original run times (42.7, 46.5, 57.4 and 93.1 s) gives:

| Path | Estimated Wall Time |
|---|---|
| Four separate calls, run one after another | ≈240 s, the sum |
| Independent batch, four entries at once | ≈93 s, the slowest entry |
| Expansion batch, the same plus one super-collation call | ≈173 to 253 s |

The estimate has three limits. The four reports were issued at 08:30, 08:51, 08:58 and 10:27 on 3 November 2026 as follow-ups, not as one batch, so their run times stand in for a batch's entries. It assumes entries run no slower when they share the batch-wide extraction pool. It omits the main model's time reading N results instead of one. Hosts that run an agent's parallel tool calls concurrently, as MCP clients may, have a baseline near the slowest entry rather than the sum; on those hosts the super-collation is added time, and its case rests on the main conversation rather than on wall time. The traced runs in Phase 4 measure the comparison directly.

### Phase 1: Shared Run Resources

No behaviour change for a single query.

- Add a counting semaphore to `src/core/util.ts`, next to `mapWithConcurrency` and `createRateLimiter`, with unit tests.
- Split `research()` in `src/core/operations/research.ts` so a caller can supply a shared extraction semaphore, a shared `minRequestIntervalMs` limiter and a flag that skips Stage 5. A single query creates its own, exactly as today.
- Return the accepted collation text, the extractions and the `SourceIdentity` to an internal caller alongside the existing `OperationResult`, so the batch code does not parse the rendered result.
- Extend `judgeCandidates()` and `formatIndexForJudge()` in `src/core/cache.ts` to exclude a set of slugs.

**Result (17 November 2026).** Done as listed, with one change: batch identity for telemetry moved to Phase 2, which adds the telemetry fields that carry it, so Phase 1 adds no unused parameter.

- `createSemaphore()` serves waiters first in, first out, releases its permit however the task settles, and drops a waiter whose signal aborts.
- `runResearchEntry()` runs the pipeline without model preflight and takes the shared pool, the shared limiter and the Stage 5 flag. `research()` preflights and then calls it with none of them. With a pool, an entry queues all its pages and the pool alone bounds the calls; each call takes its permit before the throttle, and an output-cap retry runs under the same permit.
- The synthesis (collation text, extractions, `SourceIdentity` and cache paths) is returned only for an entry that completed and committed its artefacts.
- `judgeCandidates()`, `formatIndexForJudge()` and `parseJudgeResponse()` take one slug or a set, and exclude before cutting the 20-entry window.
- `npm run build:all`, `npm run test:all` (935 native and 157 standalone tests) and `./test/e2e/01_main.sh` passed. New tests cover the semaphore, a set exclusion, and two entries sharing a pool of two with no preflight and no Stage 5.

### Phase 2: Independent Mode

- **Schema and validation.** Add `queries` and `batchMode` to `researchSchema` and make `query` optional. Validate exactly one of `query` and `queries`, `batchMode` with `queries`, two to `maxBatchEntries` entries, and top-level defaults before any model call, in the shared core; mirror the `maxUrls` check in `packages/mcp/src/runtime.ts`.
- **Settings.** Add `maxBatchEntries` (10), `batchConcurrency` (4) and `batchExtractionConcurrency` (8) to `TUNING_RANGES` and `tuningDefaults()` in `src/core/defaults.ts` and the native loader in `src/settings.ts`; the standalone configuration in `packages/mcp/src/config.ts` reads both from `src/core/defaults.ts`.
- **Orchestrator.** A new `src/core/operations/batch-research.ts` runs model preflight once, then the entries through `mapWithConcurrency(batchConcurrency)` with the shared semaphore and limiter. A failed entry becomes a failure section; cancellation aborts every entry.
- **Cache.** Write the batch folder and manifest after all entries settle, recording each member's folder as it stands after same-day rotation; rotate the batch folder with `rotateCacheArtefacts()`. Run cache suggestion once over the joined queries, excluding the members, and add one index entry for the batch.
- **Telemetry.** Pass batch identity into `runResearchEntry()` and add the per-entry `batch` fields and the fetched URL list in `src/core/telemetry.ts`, and a batch record type with its own `kind` and `schemaVersion`. Extend `scripts/analyze-sessions.sh`.
- **Adapters.** Dispatch on `queries` in `src/tools/intelli-research.ts` and `packages/mcp/src/server.ts`; map per-entry progress into the native renderer and MCP progress notifications. Update the native contract fixtures for the changed schema and result.

**Result (17 November 2026).** Independent mode works end to end in both adapters. `research()` validates its arguments and routes a batch to `researchBatch()` in `src/core/operations/batch-research.ts`, so neither adapter needed a dispatch of its own; the MCP runtime runs the same validation before any provider call and checks each entry's `domains`.

Implementer decisions taken in this phase:

- **Argument errors.** `ResearchArgumentError` carries every rule the schema cannot express: exactly one of `query` and `queries`, `batchMode` with `queries` only, two to `maxBatchEntries` entries, a nonempty query per entry, and a positive integer `maxUrls`. Repeated queries are also rejected, because two identical queries would share one cache folder. Until Phase 3, `batchMode: "expansion"` is rejected with an error naming `"independent"`.
- **Result format.** One line stating the counts, then one `# Query <n> of <N>: <query>` section per entry holding that entry's ordinary result text, separated by rules, then the batch folder path and the batch's related-searches appendix. The tool outcome is `completed` when any entry completed; `details.batch.outcome` is `completed`, `partial` or `failed`. An entry that throws becomes a failure section; the call throws only when every entry throws.
- **Batch folder.** `.search/<date>-batch-<words>-<hash>/`, with the words from the first query and the hash over the mode and every query in order, so a repeated batch rotates by the single-query rule. It holds `manifest.json` (each entry as run, its outcome and committed folder) and, unless `disableTelemetry` is set, `batch-meta.json` with `kind: "batch"` and its own `schemaVersion`. The record is not named `meta.json`, so existing readers never mistake it for a research run.
- **No index entry for an independent batch.** Its members are indexed as single queries already, and the batch folder has no report for a suggestion to point at. Phase 3 adds the index entry with the combined report.
- **URL list on batch entries only.** `stages.fetch.urls` is recorded for batch entries, where it measures overlap; single-query sidecars are unchanged.
- **Progress.** Each entry's progress message is prefixed `[<n>/<N>]`, and a `cache` event counts finished entries. Phase 4 may refine the native rendering.

`scripts/analyze-sessions.sh` gains section 10: batch counts by mode, outcome and size, batch time beside the slowest entry, entry outcomes, and page overlap from the entries' URL lists. `npm run build:all`, `npm run test:all` (953 native and 158 standalone tests) and `./test/e2e/01_main.sh` passed, and only `tools.json` changed among the native contract fixtures. One live two-entry batch through the standalone runtime completed both entries in 70 s, as long as its slower entry (evidence: `evidence/agents/2026-11-17-batch-phase2-live/`); it was not compared with separate calls.

### Phase 3: Expansion Mode

- Build the super-collation prompt from the Phase 0 spike in `src/core/prompts.ts`.
- Build one batch-wide `SourceIdentity` over the union of member extractions, deduplicated by URL, and rewrite each member summary's `[S<n>]` identifiers into it before the call.
- Call the collation model once under the shared retry, timeout and output-budget policy, then validate with `finalizeCollation()` against the batch identity. On failure or rejection, return the independent-mode sections with the failure stated, and save a rejected candidate as the single-query path does.
- Write the combined report and its batch-wide source inventory into the batch folder, and record the super-collation stage in the batch record.

**Result (17 November 2026).** Expansion mode works end to end. The merge lives in `src/core/operations/batch-merge.ts` and runs after every entry has settled, beside the batch's single cache-suggestion call.

- **Evidence and renumbering.** Each completed entry's summary is cut from its accepted collation, between the Summary heading and the generated inventory. Its identifiers index that entry's non-empty successful extractions, which is how `finalizeCollation()` numbered them. They are renumbered into one series in caller order, one identifier per URL. Only bracketed groups that match the citation grammar are rewritten, with ranges expanded, so a name such as "Amazon S3" is never changed; the spike's regex would have changed it.
- **Validation.** `finalizeCollation()` is split into `validateSynthesis()`, the unchanged provenance rules, and its single-folder rendering. The merge validates with the same rules against the union of the entries' extractions, so a cited identifier must exist and every prose URL must come from some entry's evidence. The batch renders its own inventory, one row per URL, naming the queries that fetched each page and the first entry's extraction and page files.
- **Model call.** `completeSynthesis()` in `research.ts` runs one collate-model call under the pipeline's retry, timeout and output-cap policy and tries the ranked candidates in turn, as the collation stage does.
- **Prompt.** `SUPER_COLLATION_SYSTEM_PROMPT` carries the spike's two fixes: a contradiction only where sources make incompatible claims, and queries named by their text or subject.
- **Result and cache.** On success the tool returns the merged summary, the batch-wide inventory and a Per-Query Reports list naming each query's `report.md`, instead of the per-query sections. The batch folder gains the merged `report.md` and the index gains one `Batch: <queries>` entry. The merge needs two completed entries. When it is skipped, fails or is rejected, the tool returns the independent-mode sections with the reason stated, rejected candidates are saved to `rejected-synthesis.json` in the batch folder, and any index entry for the batch folder is removed, because rotation has archived an earlier report.
- **Telemetry.** The batch record gains a `merge` object: model, outcome (`completed`, `rejected`, `failed` or `skipped`), entries merged, sources before and after deduplication, input and output characters, list items under the Contradictions and Gaps headings, duration, and truncation, retries and route where they apply.

`npm run build:all` and `npm run test:all` (961 native and 158 standalone tests) passed. Among the native contract fixtures only `prompts.json` changed, by the added prompt. One live three-query expansion batch merged on its first candidate in 66.5 s; the batch took 136.0 s, its slowest entry plus the merge. It reported one contradiction, a genuine disagreement between an estimated and an explicit end-of-life date, and referred to queries by subject (evidence: `evidence/agents/2026-11-17-batch-phase3-live/`).

### Phase 4: Guidance, Documentation and Live Evidence

- Update `promptGuidelines`, the MCP tool description, `skills/intelli-search/SKILL.md` and `guidance/research-guide.md`; run `npm run generate:plugins`.
- Document the settings, the batch folder and the telemetry fields (including the URL list) in `README.md` and `docs/ARCHITECTURE.md`; run `npm run generate:toc` and `npm run generate:readmes`.
- Add live scenarios `test/e2e/16_batch_independent.sh` and `17_batch_expansion.sh`, and a batch case in `11_mcp_stdio.sh`; prove each runnable and pass `shellcheck`.
- Answer the Exploration Questions with traced runs through `test/run-e2e-parallel.sh`: batches of 2, 5 and 10 entries against the same queries run separately, and extraction pools of 4, 8 and 16. Record the results under `evidence/` and revise the Starting Values.
- Measure effectiveness: run a fixed set of research tasks through the headless agent loop with batch mode available and unavailable, several times each. For each run record research calls, agent turns, main-model input tokens and wall time, and grade the final answer against a rubric written before the runs. Choose tasks that resemble the sampled follow-ups: multi-question plans and multi-part queries.
- Add `CHANGELOG.md` entries for both packages and run `npm run generate:changelog`. Release is outside this branch.
