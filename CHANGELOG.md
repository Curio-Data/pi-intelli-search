# Changelog

This changelog records notable changes to the native `Pi` extension and the standalone Model Context Protocol (MCP) server.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the repository's [two-package versioning scheme](https://github.com/Curio-Data/pi-intelli-search/blob/main/AGENTS.md#versioning-scheme-two-packages-one-core).

## [Unreleased]

Release dates record approval of the package release, not publication on `npm`. [Release Readiness](docs/RELEASE-READINESS.md) records staging and publication state.

## [pi-0.16.0] - 2026-10-07

### Fixed

- Completed collation uses only successful, non-empty extractions rather than treating search-only citations as fetched evidence. The Source Assessment inventory and cache references are generated from the run's actual evidence manifest. Unknown source IDs, prose URLs absent from the supplied evidence and model-generated numbered cache references fail before report writes or refresh rotation, preserving prior successful output.
- Empty research extractions count as failures. Manual collation requires non-empty evidence, rejects duplicate extraction URLs and labels its evidence as caller-supplied rather than server-fetched. Optional full pages appear as `Not cached` when absent, and follow-up hints no longer guess a first-page filename.

### Changed

- Reports contain one Source Assessment inventory with `S1`-style identifiers, replacing the separate Source Index and model-generated relevance and unique-contribution ratings. The inventory records evidence identity, extraction type and exact cache paths. The optional manual `searchSummary` input remains accepted but does not supply synthesis evidence. Input parameters, model defaults and the directory layout are unchanged; reference validation does not establish factual accuracy. Code examples and extracted cross-links remain content rather than additional fetched sources.
- Provenance validation failures return an actionable error rather than a completed report. They are not automatically retried; a manual rerun repeats the paid stages. Existing successful cache output is preserved.

## [mcp-0.16.0] - 2026-10-07

Core behaviour is shared with [pi-0.16.0] and recorded there.

### Changed

- The MCP server sends search-first routing and optional skill-loading guidance through its `instructions` field and tool descriptions. Factual questions, latest versions and release dates are directed to `intelli_search`; comparisons, detailed analysis and multi-page evidence gaps are directed to `intelli_research`. These instructions guide host models rather than enforce tool choice.
- The _Claude Code_ and _Codex_ plugin skills place tool selection before setup and give every research example an explicit `maxUrls` page budget. Native tool descriptions are unchanged.

## [pi-0.15.0] - 2026-10-07

### Fixed

- Routine fetch-comparison diagnostics no longer write over the `Pi` terminal interface. Native retry notices now use the research tool's stage progress instead of console output; aggregate fetch-variant winners remain in local telemetry. Native operation-error diagnostics still use the existing logger; this change does not intercept all extension console output.
- Cache files, locks, indexes and telemetry now resolve against the `Pi` session workspace when it differs from the process working directory. Paths shown in prompts, reports and results retain their configured form.
- Related-cache suggestions now use the configured cache directory in their report-reading instruction instead of always pointing to `.search/`.
- Documentation downloads stage under the configured cache root instead of the operating-system temporary directory, with cleanup after cancellation or cache-write failure. Optional staging failures no longer discard completed research.
- Permanent provider exceptions no longer retry as application timeouts. Late citations from failed attempts cannot contaminate successful search results. Cancellation propagates through research stages and cache-lock waits instead of returning a degraded success.
- Concurrent page fetches keep their error handling separate and restore dependency diagnostics after suppression ends.
- Related-cache suggestions resolve against the same recent-history window shown to the judge and include exact report paths.
- Cache references stay aligned when extraction fails or manual collation supplies reordered or optional full pages. A completed same-day repeat now attempts to archive prior artefacts to a numbered sibling folder (`<slug>.1`, then `.2` and so on) before writing the new set. Archive failure is logged and falls back to in-place replacement; interrupted rotation can leave a partial archive. A degraded repeat preserves the earlier successful report, extractions, sources and index entry, recording only the failed attempt in `meta.json`. The numbered siblings are a same-day safety net, not a versioned archive.
- Empty collation is rejected before writing a completed report, with an actionable output-budget diagnostic.
- Native model registration preserves malformed or unreadable `models.json` files, retains operator overrides and symlinks, and serialises atomic updates.

### Changed

- The native extension and standalone MCP server now share the research engine. The native tool interfaces and cache formats are preserved.
- The Sonar retirement advisory is removed. [_OpenRouter_](https://openrouter.ai) continues to serve `perplexity/sonar` after [_Perplexity_](https://docs.perplexity.ai)'s direct application programming interface (API) sunset date. The default search model is unchanged.

### Security

- Page extraction uses the patched [_Defuddle_](https://github.com/kepano/defuddle) release and a Mathematical Markup Language (MathML) converter that loads the patched Extensible Markup Language (XML) parser externally instead of embedding an older copy.

### Compatibility

- Compatibility verified through `Pi` 1.0.0, with 0.87.1, 0.99.0-0.99.2 and 1.0.0 reviewed. The unit suite and live end-to-end (E2E) pipeline pass on `Pi` 1.0.0 without compatibility changes.
- The minimum supported version remains `Pi` 0.81.1. Live load checks on 2026-10-04 exercised both model-call paths: the legacy provider on 0.81.1 and the registry facade on 0.86.0. See the [compatibility matrix](docs/COMPATIBILITY.md#native-pi-extension-curio-datapi-intelli-search) for evidence.
- Native release tags now use `pi-vX.Y.Z`; MCP tags use `mcp-vX.Y.Z`. Historical `vX.Y.Z` tags still identify native releases. The fixes prepared for the unreleased native 0.14.1 are included in this release.

## [mcp-0.15.0] - 2026-10-07

Core behaviour is shared with [pi-0.15.0] and recorded there. This is the stable promotion of the published [mcp-0.15.0-alpha.0]; it was staged through CI, approved by the maintainer and published on 2026-10-07, moving `latest` from the alpha to `0.15.0`.

### Fixed

- Every successful or degraded result includes its complete answer in `structuredContent.text` as well as text content, so hosts that prefer structured results receive the summary and cache suggestions.
- Cache-writing tools declare their destructive refresh behaviour to MCP hosts instead of claiming additive-only writes.
- An explicitly selected missing, unreadable or invalid configuration file no longer prevents MCP connection. Tool calls report the defect and retry loading the repaired file; absent launcher arguments and invalid workspaces remain startup failures.
- Configuration diagnostics distinguish file access and syntax errors, provide safe JavaScript Object Notation (JSON) locations, and never echo configuration contents. Direct callers can inspect `ConfigurationError.reason`.
- Host setup documents configuration recovery, secure credential entry, custom profile directories and verification through actual tool calls rather than connection alone.

## [mcp-0.15.0-alpha.0] - 2026-10-05

Core behaviour is shared with [pi-0.15.0] and recorded there. The initial alpha is published on `npm`; both the `alpha` and `latest` dist-tags resolve to this version.

### Added

- **Standalone Server:** `@curio-data/mcp-intelli-search` exposes the four `intelli_*` tools over standard input/output (`stdio`) without a `Pi` installation. It uses explicit JSON configuration, an assigned workspace and an OpenRouter adapter.
- **Host Plugins:** [_Claude Code_](https://code.claude.com/docs/en/plugins) and [_Codex_](https://developers.openai.com/codex/plugins) bundles install from this repository's marketplaces. The Claude Code plugin receives the OpenRouter key through a required sensitive option stored in the host's credential store.
- **Installation Guidance:** the [README](README.md#install) documents the three installation routes. The [compatibility matrix](docs/COMPATIBILITY.md#host-plugins) records tested host versions and verification limits; [finding F2](docs/plans/mcp-intelli-search/POST-PHASE-6.md#f2-claude-code-drops-the-text-summary-high-confirmed) records the missing model-visible summary on Claude Code 2.1.289.

---

**Two-Package Versioning:** From 0.15.0, this repository versions two packages that share the core engine in `src/core/`: `@curio-data/pi-intelli-search` (the native `Pi` extension) and `@curio-data/mcp-intelli-search` (the standalone MCP server). A change under `src/core/` bumps the minor version of both packages; a package-specific change bumps only that package's patch version. Release tags and changelog sections carry a package prefix: `pi-vX.Y.Z` and `[pi-X.Y.Z]` for the native extension, `mcp-vX.Y.Z` and `[mcp-X.Y.Z]` for the MCP server. Entries below this line cover the native package alone. Published releases use unprefixed `vX.Y.Z` tags; unpublished preparations are identified separately.

## [0.14.0] - 2026-09-22

### Added

- **Model Benchmark Harness:** `scripts/benchmark-models.sh` replays the identical research request through competing extract/collate models in isolated `Pi` environments and prints per-run telemetry. [Model Benchmarks](docs/BENCHMARKS.md) records the methodology and the five-run baseline (`gemini-3.8-flash`, `minimax-m3`, `minimax-m2.7`) behind this release's default change. Any model `Pi` supports can be benchmarked the same way.

### Changed

- **Default Models:** extract and collate now use `minimax/minimax-m3` instead of `minimax/minimax-m2.7` through provider `openrouter`. The change follows the [five-run baseline](docs/BENCHMARKS.md#findings): identical per-token pricing, an ≈1M context window and stronger collation evidence handling in that series.
- **Baseline Evidence Handling:** [_MiniMax_](https://minimax.io) M3 stated its ranking methodology and the absence of authoritative `npm` statistics in both reports (2/2), surfaced low-evidence entries and flagged [_Svelte_](https://svelte.dev) 5 compatibility warnings. The M2.7 report (0/1) and the two `gemini-3.8-flash` reports (0/2) did not state a methodology. The runs used one query with differing source corpora, so they do not isolate model effects.
- **Extraction Volume and Cost:** M3 produced ≈2× M2.7's per-page extraction characters in the baseline. The recorded default 10-page cost estimate rose from ≈$0.06 to ≈$0.09. Set `extractModel` and `collateModel` to `minimax/minimax-m2.7` through provider `openrouter` to retain the previous model.

### Fixed

- **System prompts now reach the model on `Pi` 0.86 and newer.** `Pi` 0.86 changed the `pi-ai` provider stream contract: a context passed directly to a provider no longer folds its `systemPrompt` field into the request, so on `Pi` 0.86 and 0.87 every stage (search, extract, collate, cache suggest) ran without its system prompt. Output quality degraded with no error. The large language model (LLM) transport now detects the `Pi` >= 0.86 model-registry facade and dispatches through it, which normalises the context before the provider sees it. `Pi` 0.81.1 through 0.85.x keep the previous direct-provider path unchanged. No settings change is required on either range.

### Compatibility

- Users whose model settings still match the 0.13.0 default are migrated to the new default automatically; configurations that differ from the old defaults are untouched. Migration is in-memory and never writes to `settings.json`.
- No other defaults change: `searchModel` retains provider `openrouter` and model `perplexity/sonar`. No settings change is required.

## [0.13.0] - 2026-09-07

### Added

- **Citation Annotation Harvesting:** `intelli_research` and `intelli_search` merge provider-supplied `url_citation` annotations with prose links before applying the source limit. A Sonar probe returned 20 annotations against 3 prose links; annotations can therefore expose additional sources, but do not establish a complete list of sources consulted. The caller waits up to two seconds for annotation parsing from a copy of the Hypertext Transfer Protocol (HTTP) response stream. Parsing failures do not fail the search. No configuration is required.
- **`searchWebSearch` setting (default: off).** Attaches OpenRouter's `openrouter:web_search` server tool to the search-stage call, giving an OpenRouter chat model with the required tool support access to live search without a search-native model. Requires `searchModel.provider` to be `openrouter`. Probe-validated pairing: `openai/gpt-5-nano` with `engine: "exa"` and `reasoning: "minimal"` at ≈$0.008 per search. See the README `searchWebSearch` reference for keys and engine restrictions.
- **`perplexity/sonar-pro-search` registered as a selectable search model.** OpenRouter-exclusive agentic model, usable as `searchModel` today via a settings-only change. Bills $18 per 1,000 requests on top of $3/$15 per 1M tokens (≈$0.05 per search).
- Telemetry records `stages.search.annotationsHarvested` (additive, optional field).

### Changed

- **Search prompt requires a trailing Sources section** and asks for six or more sources, raising the number of parseable links from models that answer in prose.
- **`defaultUrls` raised from 8 to 10 and `maxUrls` from 16 to 20.** Annotation harvesting adds recovered provider citation uniform resource locators (URLs) to the candidate list, so the defaults now acknowledge the wider source pool. Users who pinned either value keep theirs.
- **`intelli_search` caps its rendered source list at the top `defaultUrls` entries** (10 by default) instead of printing every cited source into the agent context.
- **The search model's own rendered Sources section no longer flows downstream.** The pipeline extracts URLs itself and renders its own canonical source list; the duplicated upstream section is stripped from the `intelli_search` summary and the collation input.
- **Recorded Page Count and Cost:** Research runs fetched closer to the URL cap in the recorded probes, moving the per-run estimate from ≈$0.05 toward ≈$0.06 (10 pages). Fewer degraded zero-link runs. Lower `defaultUrls` to hold earlier spend.

### Compatibility

- Model defaults are unchanged: `searchModel` retains provider `openrouter` and model `perplexity/sonar`, `searchWebSearch` remains off, and no settings migration is required. Annotation harvesting runs automatically when the provider supplies citations.
- At release, Perplexity had announced retirement of its Sonar Chat Completions API for 2026-09-27, with no OpenRouter statement on continued availability. Both supported alternatives (the web search tool and `sonar-pro-search`) are settings-only changes documented in the README. The later [pi-0.15.0] entry records removal of this advisory.

## [0.12.6] - Prepared 2026-09-01, Not Published

### Changed

- Maintenance update verified on `Pi` 0.84.4. This version was prepared but not published to `npm`; the version link points to its preparation commit. No user-visible behaviour change.

## [0.12.5] - 2026-08-24

### Changed

- Maintenance release moving the internal LLM transport from the deprecated `pi-ai/compat` entrypoint onto `Pi`'s stable provider API, ahead of upstream `Pi` deleting that entrypoint (verified on `Pi` 0.84.3). No user-visible behaviour change; model defaults, retry, and timeout semantics are unchanged.
- **`Pi` 0.81.1 is now the minimum supported version.** The extension uses the `modelRegistry.getProvider()` facade method from this baseline; on older versions it reports a clear error naming the required version. Downstream code embedding these tools must register custom providers through `Pi` (`models.json`, `pi.registerProvider`); models injected via `pi-ai`'s `registerFauxProvider` outside `Pi` are no longer consulted.

## [0.12.4] - 2026-08-15

### Fixed

- Pages with repeated schema.org `url` values and no `og:url` (for example, sites shipping both `Organization` and `WebSite` JSON-LD blocks) no longer print a full `TypeError: Invalid URL` stack trace to the terminal during fetch. [_Defuddle_](https://github.com/kepano/defuddle) joins the duplicate values into an invalid composite URL, catches the exception and logs a benign `console.warn`. Diagnostic suppression now covers that warning channel as well as the existing error channel. Extraction results were and remain unaffected. The upstream root fix is tracked in [#5](https://github.com/Curio-Data/pi-intelli-search/issues/5).

## [0.12.3] - 2026-08-14

### Changed

- Maintenance release keeping up with current `Pi` releases (verified on `Pi` 0.84.2). No user-visible behaviour change; no action required.

## [0.12.2] - 2026-08-08

### Changed

- Maintenance release keeping up with current `Pi` releases (verified on `Pi` 0.84.1). No user-visible behaviour change; no action required.

## [0.12.1] - 2026-07-26

### Changed

- Internal refactor reducing cyclomatic complexity by ≈27%. Test suite grew from 257 to 330. No user-visible behaviour change.

## [0.12.0] - 2026-07-24

### Changed

- **`Pi` 0.80.8 is now the minimum supported version.** The extension uses the supported `pi-ai` compatibility entrypoint, `CONFIG_DIR_NAME`, trusted project settings, registry authentication environment values, and async model-registry refresh semantics from this baseline.
- **Project settings now respect `Pi` trust.** Global settings always load. A project-local settings file is considered only after that project is trusted, and the settings cache is isolated by agent directory, project directory, trust state, and configuration-directory name.
- **Cache-writing tools execute sequentially in one `Pi` host.** Cross-process cache commits use staging directories and short locks so concurrent research runs cannot interleave artefacts or lose index entries.
- **`README` setup instructions updated for `Pi` 0.82.0.** Prerequisites now lead with `/login openrouter` (OAuth PKCE, no manual key) as the recommended path, with the `auth.json` edit kept as a fallback. The Verify Installation step notes that `/model` re-reads `models.json` on open before suggesting a restart.

### Fixed

- **Version migration now records the current release.** The extension version marker previously remained at 0.10.0 while package releases advanced.
- **Resolved provider authentication now forwards environment overrides to LLM calls.** Models configured with provider-scoped `env` values receive them consistently.
- **Search recovery now accepts protocol-less source domains.** A search response that cites `github.com/owner/repo` without `https://` continues through fetch and collation instead of being discarded as a no-links degradation.

## [0.11.3] - 2026-07-02

### Fixed

- **Bare URLs in degraded search responses are now extracted as source links.** When Perplexity Sonar synthesises a prose answer without markdown `[title](url)` links (common for how-to and design-pattern queries), the response previously yielded zero extractable URLs and the pipeline returned early with a "no links" message. `extractSourceUrls()` now performs a second pass that catches bare `https?://` URLs from bold markers, inline code, bullet lists, and plain prose, rescuing many searches that would otherwise degrade. Markdown links still take precedence so the structured format requested by the search prompt is always preferred when available.

### Changed

- **Telemetry search stage now records a `degraded` boolean field.** When `stages.search.degraded` is `true` the search returned text but zero extractable URLs. This makes the failure count unambiguous in telemetry aggregation; previously only the `outcome` field signalled it, and the dedicated field simplifies analysis scripts. The field defaults to `false` and is set to `true` by the orchestrator only on the no-links early-return path.

## [0.11.2] - 2026-06-29

### Fixed

- **Defuddle's internal error log no longer pollutes the terminal.** Pages with malformed CSS selectors (for example an unterminated attribute selector) made [_Defuddle_](https://github.com/kepano/defuddle) throw inside its own parsing loop. Defuddle caught the error, logged the full stack to `console.error` (`Defuddle Error processing document: ...`), and returned a degraded result instead of throwing, so the research pipeline kept working but the raw stack trace reached the user's terminal on every affected page. The fetch layer now suppresses that Defuddle-tagged diagnostic for the duration of the call and uses the DOM text fallback when it occurs. This handles the parsing failure without printing the dependency's stack trace.

## [0.11.1] - 2026-06-25

### Fixed

- **The published package failed to load outside the `Pi` host against current `pi-ai`.** `completeSimple` was imported from the `@earendil-works/pi-ai` main entry, which removed it in 0.80.0 (it moved to a `/compat` subpath). The extension worked inside `Pi` (the host aliases the import at runtime) but threw a `SyntaxError` under a plain `node` load, such as the install-fresh publish smoke test and any non-host loader. The import now resolves at runtime between the `/compat` subpath (0.80+) and the main entry (older versions), so it loads in any context and across host versions.

### Added

- **Install-fresh smoke test** (`test/run-e2e-publish-local.sh`) packs the working tree, installs it into a clean directory where peer dependencies resolve to their current latest, and imports it under plain `node`. This is the gate that catches peer-dependency runtime drift that `tsc`, `ty`, LSP, and unit tests cannot see (they resolve the pinned dev dependency, not the install-resolved one). Wired into CI on every push and pull request.

## [0.11.0] - 2026-06-25

### Added

- **Local-Only Telemetry Sidecar:** Each `intelli_research` run attempts a best-effort `meta.json` write into its `.search/<slug>/` cache directory recording per-stage outcomes: pages fetched and failed, fetch-variant winners (Defuddle versus Markdown), whether search-retry fired, cache-suggest hits, and per-stage latency. Degraded runs that exit early (no links, all fetches failed, all extractions failed) also attempt a sidecar, with an `outcome` field recording which path produced it, so degradation rates can be measured. The sidecar adds no network transmission or credential/account-identifier fields, but stores the full query and local result metadata, which can contain personal or confidential information. Ordinary research requests still go to external services. Writing is best-effort; cancellation and thrown failures do not all produce a sidecar. The schema is additive-only with an independent `schemaVersion`. Set `disableTelemetry: true` to suppress the sidecar entirely.
- **Session analysis script** at `scripts/analyze-sessions.sh` reproduces the effectiveness evaluation (tool-call counts, adoption over time, follow-up research, cache re-reads, cache sizes) from session logs, and aggregates `meta.json` sidecars into per-stage success rates and summed fetch-variant winner tallies.

## [0.10.2] - 2026-06-17

### Fixed

- **Page fetching now honours `Pi`'s global `httpProxy` setting.** The LLM stages already route through `Pi`'s managed HTTP clients (which apply the proxy automatically), but the page-fetching layer uses [_wreq-js_](https://github.com/sqdshguy/wreq-js) and bypassed those clients, so users behind a proxy got working LLM calls with silently broken page fetches. The fetch and `llms-full.txt` discovery stages now read the top-level `httpProxy` setting and route their requests through it.
- **`README` links to `Pi` pointed at the dead `mariozechner/pi` repository.** Updated to the current `earendil-works/pi` home after the 0.74.0 upstream move.
- **`NOTICE` third-party attribution referenced the old `@mariozechner/*` package scope.** Updated to the current `@earendil-works/*` scope for `pi-ai` and `pi-coding-agent`, and added the missing `@earendil-works/pi-tui` attribution.
- **The E2E publish test checked the wrong peer-dependency scope.** It verified that `@mariozechner/*` packages were not bundled, which passed vacuously since those packages were never dependencies. It now checks the current `@earendil-works/*` scope (including `pi-tui`) so the peer-dependency exclusion is actually validated.

### Changed

- **UI notifications and status indicators are now guarded with `ctx.hasUI`.** Previously the `session_start` and `after_provider_response` handlers called `ctx.ui.notify`/`setStatus` unconditionally, which is a no-op in non-interactive modes but produced unnecessary work in `pi -p` and `--mode json` runs. These calls now skip cleanly when no UI is attached. No behavioural change in interactive (`tui`/`rpc`) modes.
- **Internal retry documentation refreshed.** `callLlm()` continues to force `maxRetries: 0` and own its own full-jitter backoff. Since `Pi` 0.76.0 the software development kit (SDK) default is also `0`, so the forced zero is now defensive rather than a divergence; comments and the `README` compatibility section reflect this. No runtime change.

## [0.10.1] - 2026-06-04

### Fixed

- **Progress bar stage pills now include a space between the symbol and label.** The status line previously read `✓Search  ●Fetch  ○Extract` (symbols run together with labels). It now reads `✓ Search  ● Fetch  ○ Extract`, matching the spacing convention used by the `⚙️ Stage` prefix in the same output.

## [0.10.0] - 2026-06-03

### Added

- **Stage-based progress bar in `intelli_research` tool output.** A visual progress bar renders during streaming: overall completion bar, stage pills with ✓/●/○ markers, current stage message, and a per-page sub-progress bar during extraction. The LLM sees structured `⚙️ Stage X/5:` prefixed text via `onUpdate`.
- **`extractionConcurrency` setting (default 4).** Per-page extractions now run through a bounded worker pool so a wide result set no longer fires a burst of simultaneous extract-model calls that trip provider rate limits.
- **Research Retry and Timeout Policy:** large language model (LLM) calls within `intelli_research` retry transient failures (HTTP `429`, `5xx` and timeouts) with full-jitter exponential backoff that honours `Retry-After`. Each attempt has an application-level timeout. Standalone `intelli_search`, `intelli_extract` and `intelli_collate` calls retain one attempt and no application-level timeout. The research policy settings are: `llmTimeoutMs` (default `90000`), `llmRetryAttempts` (default `3`), `retryBaseDelayMs` (default `1500`), `retryMaxDelayMs` (default `20000`), `searchRetryAttempts` (default `2`), and an opt-in `minRequestIntervalMs` throttle (default `0`, off) that spaces concurrent extract calls for keys with tight rate limits.
- `@earendil-works/pi-tui` added to peer dependencies (required by `renderResult` for progress bar rendering).

### Changed

- `onUpdate` progress messages use structured `⚙️ Stage X/5: message` format instead of bare `⏳ Searching...` text. Backward compatible.
- **Perplexity Sonar cost metadata corrected** to $1/$1 per 1M tokens (was $2/$8), matching OpenRouter. Affects `Pi`'s `/model` cost estimates.

### Fixed

- **Research Failure Handling:** rate-limited search and collation calls now retry before failing; rate-limited extractions retry before being discarded. Application timeouts also cover stalled response streams, which the software development kit (SDK) request timeout did not cover. Search responses with no usable links are retried separately. Calls that exhaust their attempts still fail with a timeout or provider error.
- **Source URLs containing parentheses no longer truncated.** Wikipedia disambiguation links (`Foo_(disambiguation)`) and MSDN API references with version suffixes kept only the text up to the first `)`, producing malformed URLs that failed to fetch.
- **Extraction sub-progress bar advances per completion** instead of jumping to N/N at launch, so progress reflects real work done.
- **`llms-full.txt` discovery honours cancellation and has a tight timeout.** Probes now respond to Esc and use a 10s per-host budget to bound waiting on a slow documentation host; the pipeline still awaits supplementary download completion.
- **Reduced Cache-Name Collision Risk:** Two queries that reduced to the same five-word slug on the same day silently overwrote each other. Directory names now include a hash of the full query. The index also deduplicates by slug so re-running the same query refreshes its entry without accumulating duplicates.
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

- **npm scope migrated** from `@mariozechner` to `@earendil-works`: `pi-ai` and `pi-coding-agent` peer dependencies updated to 0.74.x. The `Pi` project moved from Mario Zechner's personal scope to an organisation scope. No API changes.

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

- **Extension comparison guide** (`docs/COMPARISON.md`): feature-by-feature breakdown of `intelli-search` against six other `Pi` search extensions across search, fetch, extraction, collation, caching, and cost.

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
- Fixed E2E test output verification. Grep check no longer fails when the model does not echo the tool name in its response. Cache artefact checks are the authoritative pass or fail.

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

[mcp-0.15.0]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/mcp-v0.15.0
[pi-0.16.0]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/pi-v0.16.0
[mcp-0.16.0]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/mcp-v0.16.0
[pi-0.15.0]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/pi-v0.15.0
[mcp-0.15.0-alpha.0]: https://www.npmjs.com/package/@curio-data/mcp-intelli-search/v/0.15.0-alpha.0
[0.14.0]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/v0.14.0
[0.13.0]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/v0.13.0
[0.12.6]: https://github.com/Curio-Data/pi-intelli-search/commit/992df7a2ed930abb562919257ba58b94f16c3aa2
[0.12.5]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/v0.12.5
[0.12.4]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/v0.12.4
[0.12.3]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/v0.12.3
[0.12.2]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/v0.12.2
[0.12.1]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/v0.12.1
[0.12.0]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/v0.12.0
[0.11.3]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/v0.11.3
[0.11.2]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/v0.11.2
[0.11.1]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/v0.11.1
[0.11.0]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/v0.11.0
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
