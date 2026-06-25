# Project Brief: v0.11.0 Telemetry and Effectiveness Analysis

## Context

`pi-intelli-search` is a `Pi` extension that adds an intelligent web research
pipeline (search, fetch, extract, collate, cache suggest) to the `Pi` coding
agent. The pipeline runs as a single tool call and writes its output to a
`.search/` cache for follow-up.

Until now, the extension had no durable record of _how_ it performed at runtime.
The session files that `Pi` writes to `~/.pi/agent/sessions/` record tool calls
and results, but nothing inside the extension captures per-research signals such
as:

- How many pages were fetched, and how many failed.
- Which fetch variant (HTML-to-Defuddle vs. Markdown) won the quality
  comparison.
- Whether Stage 1 search-retry (degraded 200 with zero links) fired.
- Whether the Stage 5 cache-suggest surfaced related prior searches, and
  whether the agent acted on them.
- Per-stage latency and, by extension, cost.

This brief captures the objectives for closing that gap in v0.11.0.

## Motivation

An ad-hoc evaluation of `~/.pi/agent/sessions/` (193 sessions, all projects)
produced the following headline numbers:

- **280** total `intelli_*` tool calls (`intelli_research` 171, `intelli_search`
  73, `intelli_extract` 36).
- The legacy `web_*` tools disappear from session logs after April 2026, while
  `intelli_*` usage is sustained month over month (14 in April, 94 in May, 54 in
  June). The extension displaced the built-in web tools once installed.
- **34 sessions** contain 2+ `intelli_research` calls, indicating iterative
  research workflows rather than one-shot lookups.
- **215 tool calls** reference a `.search/` path, evidence that the LLM manually
  re-reads cached research instead of paying for a new live search.
- The largest cache (`charity-tracker`) holds **107** entries.

Those numbers are _inferred_ from session logs by an external script. They
answer "was the extension used?" but not "did each stage of the pipeline
succeed?". Several sharper questions cannot be answered at all from current
telemetry:

- Cache-suggest hit/miss rate (Stage 5 always runs; nothing records whether its
  suggestions were acted upon).
- Per-stage success and failure counts (extraction failures, search-retry
  triggers, fetch fallbacks).
- Cost and token accounting per research call.
- Extraction-quality signal (which fetch variant won).

## Objectives

### Objective 1: Per-Research Telemetry Sidecar

Write a `meta.json` sidecar into each `.search/<slug>/` directory at the end of
an `intelli_research` run. The file records the signals that are currently
computed at runtime but discarded:

- `query` and `timestamp` (mirrors `query.txt`).
- `stages`: per-stage outcome with counts and latency:
  - `search`: provider/model, link count, whether search-retry fired, retry
    count.
  - `fetch`: pages fetched, succeeded, failed, and the Defuddle-vs-Markdown
    winner per page.
  - `extract`: pages extracted, failed, model used, total chars in/out.
  - `collate`: model used, summary char count.
  - `cacheSuggest`: number of related entries surfaced, the slugs it pointed
    to.
- `durationMs`: total wall-clock for the pipeline.
- `extensionVersion`: the `version` from `package.json`, so historical sidecars
  remain interpretable after schema changes.

The sidecar is additive: it must not gate, block, or alter the main pipeline
result. Failures writing it are caught and silently ignored, matching the
existing pattern for cache writes.

### Objective 2: Reproducible Analysis Script

Ship a script under `scripts/` that reproduces the session-log analysis used to
produce the headline numbers above. It parses `~/.pi/agent/sessions/` and emits:

- Total tool calls by name.
- `intelli_*` breakdown and per-project usage.
- Adoption over time (monthly), including the `web_*` vs. `intelli_*` migration
  curve.
- Follow-up research sessions (sessions with 2+ `intelli_research` calls).
- Cache re-reads (tool calls referencing a `.search/` path).
- Cache sizes per project (from `.search/.index.json`).
- Where `meta.json` sidecars exist, aggregate per-stage success rates from them.

The script must be deterministic, depend only on tools already documented in
`AGENTS.md` (`jq`, `rg`, `fd`), and require no API keys.

### Objective 3: Documentation

Update `CHANGELOG.md` and `README.md` to describe the new telemetry output and
point at the analysis script. The version in `package.json` is bumped to
`0.11.0` per [SemVer](https://semver.org/): a new feature (telemetry output)
lands.

## Non-Objectives

- No remote telemetry. Nothing leaves the host. The sidecar and the script read
  and write local files only.
- No change to pipeline behaviour, model defaults, settings keys, or the cache
  directory layout. The only addition is the `meta.json` file inside existing
  cache directories.
- No change to the staged-publish release policy. The agent does not create a
  _GitHub_ Release or trigger `npm` publication without explicit user approval.

## Success Criteria

- Every new `intelli_research` run writes a `meta.json` sidecar that the
  analysis script can aggregate.
- Running `scripts/analyze-sessions.sh` on a fresh checkout reproduces the
  headline numbers above (within the limits of session-log inference).
- `npm run build` and `npm test` pass.
- The unit-test suite gains at least one test asserting that a `meta.json`
  sidecar is written with the expected keys, following the filesystem-isolation
  pattern documented in `AGENTS.md`.

## Out of Scope for v0.11.0

- Token and cost accounting inside `meta.json`. The `completeSimple()` call does
  not surface usage in a shape the extension currently captures; adding it is a
  larger change deferred to a later release.
- Acting as a gate on cache-suggest suggestions. Recording whether the agent
  followed a suggestion requires correlating sessions across runs, which is out
  of scope here.
