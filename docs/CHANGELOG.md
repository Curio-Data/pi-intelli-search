# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-05-03

### Changed

- Updated pi SDK dependencies to 0.72.1 (`@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent`)
- Migrated from `@sinclair/typebox` 0.34.x to `typebox` 1.x (pi ≥ 0.69.0 TypeBox migration)
- Minimum compatible pi version raised to 0.69.0

### Fixed

- Fixed `ERR_INVALID_URL` crash when Defuddle encounters pages with relative metadata URLs (e.g. GitHub `<link rel="canonical" href="/owner/repo/releases">`). Relative `href` and `content` attributes in `<meta>`, `<link>`, and `<a>` tags are now resolved to absolute URLs against the page URL before Defuddle processes the DOM.
- Fixed E2E test output verification — grep check no longer fails when the model doesn't echo the tool name in its response; cache artifact checks are the authoritative pass/fail

### Added

- 4 new unit tests for `cleanBrokenMetadata` covering relative URL resolution, literal undefined/null removal, and Defuddle integration with GitHub HTML
- E2E test (`test/run-e2e.sh`) now documented in AGENTS.md as a required step after every change
- `test/` source listing in AGENTS.md updated to include `run-e2e.sh`

## [0.1.0] - 2026-04-26

### Added

- 4-stage research pipeline: search → fetch → extract → collate
- `intelli_search` tool — web search via Perplexity Sonar (OpenRouter)
- `intelli_extract` tool — per-page LLM extraction with focus prompts
- `intelli_collate` tool — deduplication and synthesis into cached report
- `intelli_research` tool — full pipeline orchestrator (single call)
- Dual fetch strategy: Defuddle (HTML→markdown) vs raw markdown endpoint, with quality scoring
- Automatic `llms-full.txt` download for known documentation sites
- Persistent `.search/` cache with index, extractions, sources, and collated reports
- Perplexity Sonar model registration into `~/.pi/agent/models.json`
- Rate-limit monitoring via `after_provider_response` events with footer status
- Custom working indicator (🔍 🌐 📄 ✨) during pipeline execution
- Configurable settings via `~/.pi/agent/settings.json` and `.pi/settings.json`
- Agent-facing skill guide (`skills/intelli-search/SKILL.md`)
- 70 unit tests across 7 test files
- CI/CD via GitHub Actions (publish to npm on release)

[0.2.0]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/v0.2.0
[0.1.0]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/v0.1.0
