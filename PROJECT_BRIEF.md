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

### Objective 3: Documentation and User Communication

The telemetry sidecar writes a new file inside the user's project `.search/`
directory. A new file appearing under a cache directory is user-visible, and
users who read the cache or version-control it (even though `.search/` is
gitignored by default) will notice it. The documentation must therefore:

1. State plainly that the file is written, what it contains, and where.
2. Reassure users that nothing leaves the host (local-only, no remote
   telemetry).
3. Provide an opt-out setting so users who do not want the file can disable it.
4. Point operators at the analysis script that consumes it.

The version in `package.json` is bumped to `0.11.0` per
[SemVer](https://semver.org/): a new feature (telemetry output) lands.

#### Affected Documents

Every document that describes the cache layout, the pipeline stages, or
user-visible settings must be amended. The register below is the authoritative
list for v0.11.0; the release is not complete until each row is addressed.

| Document | Change |
|---|---|
| `CHANGELOG.md` | Add `## [0.11.0] - YYYY-MM-DD` with `### Added` (telemetry sidecar, analysis script) and `### Changed` (version bump). Add the `[0.11.0]:` reference link at the bottom. Per the changelog principles, frame the entry around what a user notices: a new file in their cache and a new opt-out setting. |
| `README.md` | Three edits. (1) **Cache Structure**: add `meta.json` to the directory tree with a one-line comment, and a short paragraph explaining contents and the opt-out. (2) **Settings Reference**: add the `disableTelemetry` row. (3) **Pipeline**: note that a telemetry sidecar is written at the end of the run. |
| `docs/ARCHITECTURE.md` | Update the **Cache Structure** section to document `meta.json` and add a short **Telemetry Sidecar** subsection describing the schema and the additive, fail-safe write. |
| `skills/intelli-search/SKILL.md` | The **How It Works** section lists what lands in the cache directory. Add `meta.json` to that list so the agent knows the file exists and can offer to read it. No prose expansion needed; the skill is agent-facing and should stay terse. |
| `AGENTS.md` | Two edits. (1) **Source Structure**: the `cache.ts` entry gains a `meta.json` mention. (2) **Architecture > Cache**: note that `meta.json` is written. This file is excluded from the CI em-dash grep, so it is the canonical place to describe implementation detail in prose. |
| `scripts/README.md` | Already documents section 9 (telemetry sidecars). Confirm the schema field names match the implemented `meta.json` keys once the code lands. |

`docs/COMPONENTS.md` (third-party attribution) and `docs/COMPARISON.md` need no
change: no new dependency is introduced, and local-only telemetry is not a
public differentiator worth marketing.

#### Opt-Out Setting

Add a `disableTelemetry` boolean setting (default `false`) to match the
existing `disableLlmsFullDiscovery` naming pattern. When `true`, no `meta.json`
is written and the analysis script's section 9 reports nothing for that
project. The setting loads through the existing `settings.ts` nested-namespace
loader and appears in the README **Settings Reference** table.

#### Privacy Framing

The word "telemetry" in the wider ecosystem often implies remote reporting.
This feature is strictly local: the `meta.json` file is written next to the
existing `report.md` and `query.txt` in `.search/<slug>/`, and the analysis
script reads files on the same host. No network call is added, no data leaves
the machine, and no account or identity is recorded.

Documentation must lead with this distinction. The README **Cache Structure**
paragraph and the `CHANGELOG.md` entry both open with "local-only" phrasing
before describing the contents. The `disableTelemetry` setting exists for users
who prefer no per-research metadata file at all, even locally.

#### Release Notes Skeleton

The `CHANGELOG.md` entry follows this shape (dates and final wording settled at
release time):

```markdown
## [0.11.0] - YYYY-MM-DD

### Added

- **Local-only telemetry sidecar.** Each `intelli_research` run now writes a
  `meta.json` file into its `.search/<slug>/` cache directory recording
  per-stage outcomes: pages fetched and failed, fetch-variant winners, whether
  search-retry fired, cache-suggest hits, and per-stage latency. Nothing leaves
  the host. Set `disableTelemetry: true` to opt out.
- **Session analysis script** at `scripts/analyze-sessions.sh` reproduces the
  effectiveness evaluation from session logs and the new sidecars.
```

## Non-Objectives

- No remote telemetry. Nothing leaves the host. The sidecar and the script read
  and write local files only. The word "telemetry" in the setting name refers
  to local runtime signals, not remote reporting.
- No change to pipeline behaviour, model defaults, or the cache directory
  layout. The only addition is the `meta.json` file inside existing cache
  directories, plus the `disableTelemetry` opt-out.
- No change to the staged-publish release policy. The agent does not create a
  _GitHub_ Release or trigger `npm` publication without explicit user approval.

## Success Criteria

- Every new `intelli_research` run writes a `meta.json` sidecar that the
  analysis script can aggregate.
- Setting `disableTelemetry: true` suppresses the sidecar, verified by a unit
  test.
- Running `scripts/analyze-sessions.sh` on a fresh checkout reproduces the
  headline numbers above (within the limits of session-log inference).
- Every row in the **Affected Documents** table is addressed.
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
