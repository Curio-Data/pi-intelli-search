# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.0] - 2026-05-16

### Changed

- **Extract and collate models now default to OpenRouter.** A single OpenRouter key covers all three pipeline stages. The separate MiniMax API key is no longer needed. Users upgrading from 0.7.0 whose model config matches the old default are auto-migrated with a notification.
- **Settings now use a nested `pi-intelli-search` namespace.** Bare keys (e.g. `extractModel`) are preferred over flat `intelli*`-prefixed keys. Both formats still work; flat keys are deprecated and show a notification on upgrade.

### Added

- **Auth warning on startup.** If no OpenRouter key is configured, a notification appears immediately rather than waiting for the first tool call to fail.
- **Model validation before pipeline runs.** Typos in model names (e.g. `minimax/M3.7`) are caught before any API cost is incurred.
- **Additional E2E tests.** Tests now cover model override via settings, upgrade migration from 0.7.0, and custom cache directory configuration.

### Fixed

- **Settings from both locations are now read correctly.** Project-local `.pi/settings.json` takes precedence over global `~/.pi/agent/settings.json` (project overrides global).
- **Version tracking survives directory changes.** Previously the version file was project-relative and could be missed when running `Pi` from different directories.

## [0.7.0] - 2026-05-14

### Changed

- **npm scope migrated** from `@mariozechner` to `@earendil-works`: `pi-ai` and `pi-coding-agent` peer dependencies updated to 0.74.x. The `Pi` project moved from Mario Zechner's personal scope to an organization scope. No API changes.

### Fixed

- `loadSettings()` and `getAgentDir()` now respect `PI_CODING_AGENT_DIR`, allowing the extension to read settings from isolated environments (e.g. E2E tests, CI).

### Compatibility

- Minimum `Pi` version raised to 0.74.0 (previously 0.73.0). Earlier `Pi` releases bundle the deprecated `@mariozechner`-scoped packages and cannot resolve the new names.

## [0.6.0] - 2026-05-10

### Changed

- **Tool descriptions rewritten** to follow agent tool description best practices (Anthropic engineering guidance). Removed implementation details the agent cannot act on (Perplexity Sonar, Defuddle, LLM), replaced internal jargon with plain language, added cross-tool redirects so the agent picks the right tool, and clarified parameter descriptions.
- Added `domains` usage guideline to `intelli_research` promptGuidelines.

## [0.5.1] - 2026-05-06

### Fixed

- **Images broken on pi.dev/packages:** replaced `.avif` images with `.png` equivalents. The `Pi` packages website does not support `.avif`. Also updated `pi.image` in `package.json`.

## [0.5.0] - 2026-05-06

### Added

- **Extension comparison guide** (`docs/COMPARISON.md`): feature-by-feature breakdown of `intelli-search` against 7 other `Pi` search extensions across search, fetch, extraction, collation, caching, and cost.

### Changed

- **Documentation restructured:** SKILL.md reordered so decision logic precedes mechanism. README tightened with direct comparisons and consistent naming. All docs rewritten in assertive voice with hedged language removed.
- **Pipeline infographic updated:** replaced `02.png` with a more detailed `06.png` showing the full 7-stage pipeline.

## [0.4.1] - 2026-05-06

### Changed

- Bumped `devDependencies` to `@mariozechner/pi-ai` 0.73.0 and `@mariozechner/pi-coding-agent` 0.73.0 to stay aligned with the latest `Pi` release. No runtime impact: peer dependencies remain `*` and `Pi` 0.73.0 introduces no breaking changes to extension APIs used by `intelli-search`.

### Compatibility

- Verified against `Pi` 0.73.0: all 106 unit tests pass, E2E pipeline exercises the full search → fetch → extract → collate → cache flow in an isolated `Pi` environment.
- Upstream `Pi` 0.73.0 fixes that benefit `intelli-search`: MiniMax M2.7 model metadata correction ([pi-mono#4110](https://github.com/badlogic/pi-mono/pull/4110)), and safer `models.json` provider override merging ([pi-mono#3651](https://github.com/badlogic/pi-mono/issues/3651)).

## [0.4.0] - 2026-05-05

### Added

- Schema.org JSON stripping in `cleanBrokenMetadata`: removes `<script type="application/ld+json">` tags with invalid JSON before Defuddle processes the DOM. Prevents `JSON.parse` crashes on YouTube and similar pages.
- Defuddle fallback extraction: if Defuddle crashes (e.g. CSS pseudo-class errors), falls back to basic DOM text extraction instead of returning an empty page.
- 2 new unit tests for ld+json stripping and fallback extraction (test count now 106).

### Changed

- Documentation style rules applied across all docs: ≈ symbol replaces tilde, `Pi` and `intelli-search` backticked, headings in Title Case, emphasis on product names, links to key components.
- Documentation Style Guide section added to AGENTS.md.
- Updated recommended extraction/collation model list with researched 1M-context alternatives.
- Replaced `dedup` abbreviation with `dedupe` throughout docs.
- Removed CI badge from README.

### Fixed

- YouTube sources no longer crash with `JSON.parse` errors in Defuddle's `_extractSchemaOrgData`.

## [0.3.2] - 2026-05-04

### Added

- Pipeline banner image and comparison infographic (`docs/images/01.png`, `docs/images/02.png`).
- `pi.image` in package manifest for [pi.dev gallery](https://pi.dev/packages/@curio-data/pi-intelli-search) preview.
- Descriptive alt text for both README images (accessibility).
- Scannable Features list in README after intro paragraph.
- Markdownlint config (`.markdownlint.yaml`).

### Changed

- Replaced Mermaid flowchart in README with rendered comparison infographic (02.png).

## [0.3.1] - 2026-05-04

### Added

- CI workflow (`.github/workflows/ci.yml`): Validates build, tests, and `npm pack` on every push or PR to `main`.
- Release workflow (`.github/workflows/release.yml`): Publishes to `npm` on _GitHub_ Release with provenance signing.
- Release policy documented in AGENTS.md (explicit user permission required).
- E2E publish test (`test/run-e2e-publish.sh`): Installs from `npm` and validates the published package.
- CI status badge in README.

### Fixed

- `ensureCustomModels()` now creates `~/.pi/agent/` directory before writing `models.json` (fixes CI on fresh environments).
- `package-lock.json` drift corrected (version `0.1.0` to `0.3.0`, `@sinclair/typebox` to `typebox`).
- Release workflow uses correct `NPM_REPO` secret (was `NPM_TOKEN`).

## [0.3.0] - 2026-05-03

### Changed

- Updated copyright year to 2026 across all source files, NOTICE, README, and AGENTS.md.
- Documentation now reflects 5-stage pipeline (added Stage 5: cache suggest) throughout README, ARCHITECTURE.md, and AGENTS.md.
- `Pi` minimum version updated to >=0.69.0 across all docs and badges (was incorrectly stated as 0.67.68 or 0.68.0 in README).
- `typebox` dependency correctly named in COMPONENTS.md and NOTICE (was `@sinclair/typebox`, migrated in v0.2.0).
- Removed spurious `thinkingLevelMap` compatibility entry from AGENTS.md (not used in codebase).
- Test count corrected to 104 across README and AGENTS.md.
- Added `npm` downloads badge to README.
- Pipeline diagram and cost table in ARCHITECTURE.md now include Stage 5 (cache suggest).
- Model configurability now documented in ARCHITECTURE.md provider choices section.

## [0.2.0] - 2026-05-03

### Changed

- Updated `Pi` SDK dependencies to 0.72.1 (`@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent`).
- Migrated from `@sinclair/typebox` 0.34.x to `typebox` 1.x (required `Pi` >= 0.69.0 for the TypeBox migration).
- Minimum compatible `Pi` version raised to 0.69.0.

### Fixed

- Fixed `ERR_INVALID_URL` crash when [Defuddle](https://github.com/kepano/defuddle) encounters pages with relative metadata URLs (for example, _GitHub_ `<link rel="canonical" href="/owner/repo/releases">`). Relative `href` and `content` attributes in `<meta>`, `<link>`, and `<a>` tags are now resolved to absolute URLs against the page URL before Defuddle processes the DOM.
- Fixed E2E test output verification. Grep check no longer fails when the model does not echo the tool name in its response. Cache artifact checks are the authoritative pass or fail.

### Added

- 4 new unit tests for `cleanBrokenMetadata` covering relative URL resolution, literal undefined or null removal, and [Defuddle](https://github.com/kepano/defuddle) integration with _GitHub_ HTML.
- E2E test (`test/run-e2e.sh`) now documented in AGENTS.md as a required step after every change.
- `test/` source listing in AGENTS.md updated to include `run-e2e.sh`.

## [0.1.0] - 2026-04-26

### Added

- 4-stage research pipeline: search, fetch, extract, and collate.
- `intelli_search` tool: Web search via [Perplexity Sonar](https://docs.perplexity.ai) (OpenRouter).
- `intelli_extract` tool: Per-page LLM extraction with focus prompts.
- `intelli_collate` tool: Deduplication and synthesis into cached report.
- `intelli_research` tool: Full pipeline orchestrator (single call).
- Dual fetch strategy: [Defuddle](https://github.com/kepano/defuddle) (HTML to Markdown) versus raw Markdown endpoint, with quality scoring.
- Automatic `llms-full.txt` download for known documentation sites.
- Persistent `.search/` cache with index, extractions, sources, and collated reports.
- [Perplexity Sonar](https://docs.perplexity.ai) model registration into `~/.pi/agent/models.json`.
- Rate-limit monitoring via `after_provider_response` events with footer status.
- Custom working indicator (🔍 🌐 📄 ✨) during pipeline execution.
- Configurable settings via `~/.pi/agent/settings.json` and `.pi/settings.json`.
- Agent-facing skill guide (`skills/intelli-search/SKILL.md`).
- 70 unit tests across 7 test files.
- CI/CD via _GitHub_ Actions (publish to `npm` on release).

[0.8.0]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/v0.8.0
[0.7.0]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/v0.7.0
[0.6.0]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/v0.6.0
[0.5.1]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/v0.5.1
[0.5.0]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/v0.5.0
[0.4.1]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/v0.4.1
[0.4.0]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/v0.4.0
[0.3.2]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/v0.3.2
[0.3.1]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/v0.3.1
[0.3.0]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/v0.3.0
[0.2.0]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/v0.2.0
[0.1.0]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/v0.1.0
