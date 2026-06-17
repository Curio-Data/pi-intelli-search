# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.10.2] - 2026-06-17

### Fixed

- **Page fetching now honours `Pi`'s global `httpProxy` setting.** The LLM stages already route through `Pi`'s managed HTTP clients (which apply the proxy automatically), but the page-fetching layer uses [_wreq-js_](https://github.com/sqdshguy/wreq-js) and bypassed those clients, so users behind a proxy got working LLM calls with silently broken page fetches. The fetch and `llms-full.txt` discovery stages now read the top-level `httpProxy` setting and route their requests through it.
- **`README` links to `Pi` pointed at the dead `mariozechner/pi` repository.** Updated to the current `earendil-works/pi` home after the 0.74.0 upstream move.
- **`NOTICE` third-party attribution referenced the old `@mariozechner/*` package scope.** Updated to the current `@earendil-works/*` scope for `pi-ai` and `pi-coding-agent`, and added the missing `@earendil-works/pi-tui` attribution.
- **The E2E publish test checked the wrong peer-dependency scope.** It verified that `@mariozechner/*` packages were not bundled, which passed vacuously since those packages were never dependencies. It now checks the current `@earendil-works/*` scope (including `pi-tui`) so the peer-dependency exclusion is actually validated.

### Changed

- **UI notifications and status indicators are now guarded with `ctx.hasUI`.** Previously the `session_start` and `after_provider_response` handlers called `ctx.ui.notify`/`setStatus` unconditionally, which is a no-op in non-interactive modes but produced unnecessary work in `pi -p` and `--mode json` runs. These calls now skip cleanly when no UI is attached. No behavioural change in interactive (`tui`/`rpc`) modes.
- **Internal retry documentation refreshed.** `callLlm()` continues to force `maxRetries: 0` and own its own full-jitter backoff. Since `Pi` 0.76.0 the SDK default is also `0`, so the forced zero is now defensive rather than a divergence; comments and the `README` compatibility section reflect this. No runtime change.

## [0.10.1] - 2026-06-04

### Fixed

- **Progress bar stage pills now include a space between the symbol and label.** The status line previously read `✓Search  ●Fetch  ○Extract` (symbols run together with labels). It now reads `✓ Search  ● Fetch  ○ Extract`, matching the spacing convention used by the `⚙️ Stage` prefix in the same output.

## [0.10.0] - 2026-06-03

### Added

- **Stage-based progress bar in `intelli_research` tool output.** A visual progress bar renders during streaming: overall completion bar, stage pills with ✓/●/○ markers, current stage message, and a per-page sub-progress bar during extraction. The LLM sees structured `⚙️ Stage X/5:` prefixed text via `onUpdate`.
- **`extractionConcurrency` setting (default 4).** Per-page extractions now run through a bounded worker pool so a wide result set no longer fires a burst of simultaneous extract-model calls that trip provider rate limits.
- **Rate-limit resilience for every LLM call.** Search, extract, collate, and cache-suggest calls retry transient failures (HTTP 429, 5xx, timeouts) with full-jitter exponential backoff that honours `Retry-After`, and enforce a hard per-call timeout so a stalled provider connection cannot hang the pipeline. New settings tune this: `llmTimeoutMs` (default 90000), `llmRetryAttempts` (default 3), `retryBaseDelayMs` (default 1500), `retryMaxDelayMs` (default 20000), `searchRetryAttempts` (default 2), and an opt-in `minRequestIntervalMs` throttle (default 0, off) that spaces concurrent extract calls for keys with tight rate limits.
- `@earendil-works/pi-tui` added to peer dependencies (required by `renderResult` for progress bar rendering).

### Changed

- `onUpdate` progress messages use structured `⚙️ Stage X/5: message` format instead of bare `⏳ Searching...` text. Backward compatible.
- **Perplexity Sonar cost metadata corrected** to $1/$1 per 1M tokens (was $2/$8), matching OpenRouter. Affects `Pi`'s `/model` cost estimates.

### Fixed

- **Pipeline no longer hangs or hard-fails under provider rate limiting.** Previously a 429 on the search or collate stage aborted the run, a rate-limited extraction was silently dropped, and a stalled connection could hang for minutes with no output (the SDK request timeout does not cover a stalled response stream). Calls now back off and retry, a degraded search that returns no usable links is retried, and an unrecoverable call fails fast with a clear timeout or rate-limit message.
- **Source URLs containing parentheses no longer truncated.** Wikipedia disambiguation links (`Foo_(disambiguation)`) and MSDN API references with version suffixes kept only the text up to the first `)`, producing malformed URLs that failed to fetch.
- **Extraction sub-progress bar advances per completion** instead of jumping to N/N at launch, so progress reflects real work done.
- **`llms-full.txt` discovery honours cancellation and has a tight timeout.** Probes now respond to Esc and use a 10s per-host budget so a slow documentation host cannot stall the research result.
- **Cache directories no longer collide between different queries.** Two queries that reduced to the same five-word slug on the same day silently overwrote each other. Directory names now include a hash of the full query. The index also deduplicates by slug so re-running the same query refreshes its entry without accumulating duplicates.
- Search progress message no longer hardcodes "Perplexity Sonar"; uses the configured search model so the message is correct with a different search provider.

## [0.9.0] - 2026-05-25

### Security

- **Git history rewritten to normalise commit metadata.** All commit author and committer fields across the repository were collapsed to a single canonical identity (`miah0x41 <99686292+miah0x41@users.noreply.github.com>`) to remove stale personal addresses and unify the maintainer identity on the path to a stable `v1` release. Every commit SHA changed.
- **Tags v0.3.1 through v0.8.0 rebuilt against the rewritten history.** Each tag now points to the corresponding rewritten commit. Tree contents are byte-identical to the pre-rewrite commits (only metadata was changed), so source-at-tag still matches the contents published to `npm` for each version.
- **`npm` SLSA provenance attestations for v0.3.1 through v0.8.0 reference unreachable SHAs.** The attestations themselves remain valid as historical records and the published tarballs are unchanged. The `gitHead` recorded in each attestation points to a commit that is no longer reachable from any branch in this repository. From v0.9.0 onwards, attestations track the rewritten history.
- **Publishing migrated to OIDC trusted publishing with staged release.** The release workflow now authenticates to `npm` via short-lived GitHub Actions OIDC tokens; the long-lived `NPM_REPO` automation token has been removed. The trusted publisher on `npmjs.com` is configured to permit `npm stage publish` only, so every release lands in the staging queue and requires a maintainer approval with 2FA before it appears on the public registry. Direct `npm publish` from CI is no longer possible.

### Compatibility

- No runtime or API changes between v0.8.0 and v0.9.0. The release exists to document the history rewrite; the package contents differ only by the version bump, the new CHANGELOG entry, and the new README Provenance section.

## [0.8.0] - 2026-05-17

### Changed

- **Extract and collate models now default to OpenRouter.** A single OpenRouter key covers all three pipeline stages. The separate MiniMax API key is no longer needed. Users upgrading from 0.7.0 whose model config matches the old default are auto-migrated with a notification.
- **Settings now use a nested `pi-intelli-search` namespace.** Bare keys (e.g. `extractModel`) are preferred over flat `intelli*`-prefixed keys. Both formats still work; flat keys are deprecated and show a notification on every session start.
- **README Settings section restructured.** A new Settings Reference table maps each setting to its pipeline stage, explains what it does, and gives guidance on when to change it. Context window considerations for small-window models (e.g. 256K) and cost-vs-speed trade-offs are called out.

### Breaking

- **`maxUrls` split into `defaultUrls` and `maxUrls`.** The old `maxUrls` setting was always a fallback default, not a cap. It is now the hard cap (default 16). A new `defaultUrls` setting (default 8) provides the fallback when the agent does not pass `maxUrls` per call. Old settings containing `maxUrls` map automatically to the cap, matching what users always assumed it did. The pipeline now clamps agent requests with `Math.min(requested, maxUrls)`. The agent's SKILL.md heuristic (3/8/12) is now bounded by this setting.
- **`llmsFullSites` setting removed.** The manual domain→URL map has been replaced by automatic discovery: every fetched domain is probed at `https://domain/llms-full.txt`. If the file exists (HTTP 200), it is downloaded raw to the cache. A small built-in list handles sites with non-standard paths (Cloudflare, Next.js, Vite). No configuration is needed.

### Added

- **Auth warning on startup.** If no OpenRouter key is configured, a notification appears immediately rather than waiting for the first tool call to fail.
- **Model validation before pipeline runs.** Typos in model names (e.g. `minimax/M3.7`) are caught before any API cost is incurred.
- **Limit enforcement E2E tests.** Seven E2E test scripts now validate the full extension install experience. New tests cover: `defaultUrls` and `maxUrls` cap clamping, `extractMaxChars` and `extractionMaxTokens` enforcement (20× reduction proven), `collationMaxTokens` enforcement (9.5× reduction proven), model override via settings, and upgrade migration from 0.7.0.
- **Automatic llms-full.txt discovery.** Every domain in the search results is probed at `https://domain/llms-full.txt`. If the file exists it is downloaded raw to the cache for offline grep. A small built-in list handles sites with non-standard paths (Cloudflare `/product/llms-full.txt`, Next.js `/docs/llms-full.txt`, Vite). The manual `llmsFullSites` setting is removed. A new `disableLlmsFullDiscovery` setting (default `false`) lets users opt out when the bandwidth cost of probing multiple domains is unwanted.
- **Upgrade notification for `maxUrls` semantic change.** Users upgrading to 0.8.0 who had configured a custom `maxUrls` value see an in-product notification explaining it has become a hard cap (was a fallback default in 0.7.0). The `defaultUrls` setting is the new agent fallback.

### Fixed

- **Settings from both locations are now read correctly.** Project-local `.pi/settings.json` takes precedence over global `~/.pi/agent/settings.json` (project overrides global).
- **Version tracking survives directory changes.** Previously the version file was project-relative and could be missed when running `Pi` from different directories.
- **Settings cache now correctly invalidated after default migration.** On first upgrade, tools previously read unmigrated defaults from a stale cache (the migration notification fired, but the pipeline itself used the old models). The cache is now rebuilt after migration so the pipeline immediately uses the new defaults.
- **Rate-limit monitoring no longer goes dark after session replacement.** The `sessionActive` flag was never reset on `session_start`, so rate-limit status in the footer stopped updating after `/new` or `/fork`.
- **Version marker written after migration completes.** Previously the version file was persisted before migration ran. If migration failed mid-session, the user was permanently stranded on stale defaults with no recovery path.
- **Auth check tightened.** An empty `openrouter: {}` in `auth.json` no longer suppresses the missing-key warning.

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

[0.10.2]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/v0.10.2
[0.10.1]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/v0.10.1
[0.10.0]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/v0.10.0
[0.9.0]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/v0.9.0
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
