# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.0]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/v0.1.0
