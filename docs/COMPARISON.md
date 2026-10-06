# Comparison With Other Search Tools

This document compares `intelli-search` against other web search and fetch extensions in the `Pi` ecosystem, and against the built-in web tools of a host agent. Each tool takes a different approach to search, fetch, extraction, and persistence.

## Scope

This section covers the extension comparison. The [Host-Native Web Search](#host-native-web-search) section records its own scope.

Competitor capabilities and adoption figures are a May 2026 snapshot of seven extensions listed on `pi.dev/packages` or installed from _GitHub_. This is not a current ecosystem census. Monthly download counts (where available) are sourced from `pi.dev/packages` at that snapshot date. The `intelli-search` descriptions include repository features checked on 2026-10-05; token-price figures retain their recorded September 2026 basis. The [README Cost](../README.md#cost) section is canonical for the current default estimate.

Download counts do not reflect quality or suitability for any specific task. They are included only to show why these particular extensions were chosen for comparison: the six with the most community adoption, plus `intelli-search`.

Extensions not listed on `pi.dev/packages` or installed via `pi install git:` are not captured in download counts.

## Extensions Compared

Monthly downloads from `pi.dev/packages` as of May 2026. GitHub-only packages show no download count.

| Extension | Package | Downloads/mo | Maintainer |
| --- | --- | ---: | --- |
| **pi-web-access** | `pi-web-access` | 26,933 | nicopreme |
| **ollama-web-search** | `@ollama/pi-web-search` | 25,845 | Ollama |
| **rpiv-web-tools** | `@juicesharp/rpiv-web-tools` | 7,879 | juicesharp |
| **pi-smart-fetch** | `pi-smart-fetch` | 6,822 | Thinkscape |
| **pi-web-providers** | `pi-web-providers` | n/a (GitHub) | mavam |
| **pi-amplike** | `pi-amplike` | n/a (GitHub) | pasky |
| `intelli-search` | `@curio-data/pi-intelli-search` | n/a (new) | Curio Data Pro |

## Architecture Summary

| Capability | Snapshot Summary | Detail |
|---|---|---|
| Search | Provider choice, fallback chains and search-native models differ | [Search](#search) |
| Fetch | `intelli-search` compares cleaned HyperText Markup Language (HTML) and Markdown variants | [Fetch](#fetch) |
| Per-Page Extraction | `intelli-search` uses a focused large language model (LLM); `pi-web-access` has partial model processing | [Extraction](#extraction) |
| Cross-Source Collation | Only `intelli-search` has a dedicated collation stage among those compared | [Collation](#collation) |
| Persistent Research Cache | `intelli-search` stores reports, extractions and sources; other recorded caches are transient | [Caching](#caching) |
| Cost | Extension fees, provider charges and agent inference are distinct | [Cost](#cost) |

The old summary recorded ≈$0.05 per session as a historical estimate. It is not the current default estimate; use [README Cost](../README.md#cost). Choose based on workload, not download count.

## Search

How each extension discovers which URLs (uniform resource locators) to fetch. Provider access uses API (application programming interface) keys.

| Extension | Search Backend | Multiple Sources | API Keys Required |
| --- | --- | :---: | :---: |
| `intelli-search` | Perplexity Sonar via OpenRouter (default; any OpenRouter model via the `searchWebSearch` server tool) | Every cited source via annotation harvesting | 1 (OpenRouter) |
| **pi-web-providers** | 15+ providers (Exa, Perplexity, Gemini, Brave, Firecrawl, Linkup, etc.) | Configurable per-tool | 1 per provider used |
| **pi-web-access** | Exa → Perplexity → Gemini → Gemini Web (sequential fallback) | Tried in order | 1 per provider used |
| **ollama-web-search** | Ollama native web search | Single source | Ollama API key |
| **rpiv-web-tools** | Brave Search API | Single source | Brave API key |
| **pi-amplike** | Jina Search API | Single source | Optional (rate-limited without) |
| **pi-smart-fetch** | None (URL fetch only) | N/A | None |

### Search: Key Difference

`intelli-search` uses a single [_OpenRouter_](https://openrouter.ai) API key to access [_Perplexity Sonar_](https://docs.perplexity.ai) for search _and_ any model for extraction and collation. `pi-web-providers` and `pi-web-access` give more search backends, but each requires its own API key, account, and setup. `rpiv-web-tools` and `pi-amplike` also require separate provider accounts.

Perplexity Sonar is the default search model, and since v0.13.0 the `searchWebSearch` setting attaches OpenRouter's `openrouter:web_search` server tool to the search stage, equipping any OpenRouter chat model with URL-cited results through Exa, Parallel, Firecrawl, Perplexity, or the base model's native engine. The search stage is therefore not tied to any one model's continued availability: swapping it is a settings change that leaves the rest of the pipeline untouched. Search stages also merge every source the model cited (machine-readable `url_citation` annotations), not only the links written into the prose.

## Fetch

How each extension retrieves and processes HTML and other page content. TLS means Transport Layer Security, HTTP means Hypertext Transfer Protocol, and DOM means Document Object Model.

| Extension | Fetch Method | Content Cleaning | Dual-Fetch Comparison | Fallback |
| --- | --- | :---: | :---: | --- |
| `intelli-search` | wreq-js browser TLS + Defuddle + Markdown endpoint (parallel) | Defuddle (HTML) + sanitize (Markdown) | **Yes**: scores both, picks best | Defuddle-fallback (basic DOM text extraction) |
| **pi-web-providers** | Provider-dependent (Firecrawl, Linkup, etc.) | Provider-dependent | No | Provider-dependent |
| **pi-web-access** | HTTP fetch → Readability → Jina Reader → Gemini (fallback chain) | Readability + Jina + Gemini | No | Sequential fallback through chain |
| **pi-smart-fetch** | Browser TLS fingerprinting (chrome_145) + Defuddle | Defuddle | No | Alternate `<link>` discovery for thin content |
| **ollama-web-search** | Ollama web fetch API | Ollama server-side | No | None |
| **rpiv-web-tools** | Brave Search API (search-focused) | Provider-dependent | No | None |
| **pi-amplike** | Jina Reader API | Jina server-side | No | None |

### Fetch: Key Difference

`intelli-search` and `pi-smart-fetch` both use browser-grade TLS fingerprinting (via [_wreq-js_](https://github.com/sqdshguy/wreq-js)) and [_Defuddle_](https://github.com/kepano/defuddle) for HTML cleaning. `intelli-search` goes further by also fetching the Markdown variant (when available) and **comparing both for quality**.

**Why compare?** Server-rendered Markdown is not guaranteed to be clean. For example, fetching `https://developers.cloudflare.com/d1/` with `Accept: text/markdown` returns 3,696 chars of content that includes JavaScript Object Notation for Linked Data (JSON-LD) BreadcrumbList schema data, extra Schema.org markup, and community promotion links. Defuddle extraction of the same page strips these artifacts, producing 3,047 chars of cleaner content. The quality comparison catches this and picks the better version automatically.

## Extraction

What happens to page content after fetching, before it reaches the agent.

| Extension | Per-Page LLM Extraction | Targets Query Relevance | Handles Code Blocks |
| --- | :---: | :---: | :---: |
| `intelli-search` | **Yes**: configurable model, default MiniMax M3 via OpenRouter | **Yes**: guided by `focusPrompt` | **Yes**: preserved verbatim |
| **pi-web-providers** | No | No | No |
| **pi-web-access** | Partial (Gemini for blocked pages, video descriptions) | No | No |
| **pi-smart-fetch** | No | No | No |
| **ollama-web-search** | No | No | No |
| **rpiv-web-tools** | No | No | No |
| **pi-amplike** | No | No | No |

### Extraction: Key Difference

`intelli-search` is the only extension among those compared that uses an LLM to extract query-relevant content from each page before it enters the agent's context. This compresses ≈50K chars per page to ≈3-5K of focused content. The `focusPrompt` parameter lets the agent specify exactly what to look for across all pages.

[_MiniMax_](https://minimax.io) M3 (via [OpenRouter](https://openrouter.ai)) is the default extraction model. A single OpenRouter key covers all three pipeline stages. Any model `Pi` supports can be swapped in via `extractModel` in the `pi-intelli-search` settings namespace. Extraction quality scales independently from cost, from cheap flash models to full reasoning models.

**Trade-Off:** A weak extraction model may miss key details or introduce errors. The other extensions deliver full page content to the agent, which can be advantageous when the main LLM is better equipped to filter noise than a smaller, cheaper extraction model. If the main LLM is confused by non-relevant material, however, pre-extraction keeps the context clean and focused.

## Collation

What happens after individual pages are processed, to synthesise findings.

| Extension | Cross-Source Deduplication | Inconsistency Detection | Source Attribution |
| --- | :---: | :---: | :---: |
| `intelli-search` | **Yes**: LLM-powered | **Yes**: conflicting claims flagged | **Yes**: sources cited with type and currentness |
| **pi-web-providers** | No | No | No |
| **pi-web-access** | No | No | No |
| **pi-smart-fetch** | No | No | No |
| **ollama-web-search** | No | No | No |
| **rpiv-web-tools** | No | No | No |
| **pi-amplike** | No | No | No |

### Collation: Key Difference

`intelli-search` is the only extension among those compared with a collation stage. The collation LLM sees all per-page extractions and produces a single synthesised summary. It deduplicates overlapping information, flags conflicting claims from different sources, and preserves URLs for attribution. Without this, the agent has to do this work itself, consuming context and reasoning tokens for mechanical synthesis.

Like extraction, the collation model is configurable. Swap it via `collateModel` in the `pi-intelli-search` settings namespace to use any model `Pi` supports.

## Caching

What happens to results after the session ends.

| Extension | Persistent Cache | Cache Format | Offline Reuse | Cache Suggest |
| --- | :---: | --- | :---: | :---: |
| `intelli-search` | **Yes** | `.search/<date>-<slug>-<hash>/` with `report.md`, `query.txt`, `extractions/`, `sources/`, `.index.json` | **Yes**: full pages and extractions preserved | **Yes**: LLM judge finds related previous searches |
| **pi-web-providers** | In-memory only | N/A | No | No |
| **pi-web-access** | Per-session (GitHub repos, search results) | Filesystem + response IDs | No | No |
| **pi-smart-fetch** | No | N/A | No | No |
| **ollama-web-search** | No | N/A | No | No |
| **rpiv-web-tools** | No | N/A | No | No |
| **pi-amplike** | No | N/A | No | No |

### Caching: Key Difference

`intelli-search` is the only extension among those compared with a persistent, structured cache. Full pages and extractions are stored in `.search/` and indexed in `.index.json`. The cache suggest stage (Stage 5) surfaces related previous searches after the current live pipeline; it never skips that search. Manually reusing a cached report can avoid a subsequent API call. Preserved source data also allows comparisons across dates, subject to differences in fetched sources and content.

## Cost

The figures below retain the recorded September 2026 price basis for 10-page research runs. They are historical estimates, not refreshed provider quotes. Current default planning costs are single-sourced in [README Cost](../README.md#cost).

**Recorded `intelli-search` Token Rates:**

| Stage | Model | Input (per 1M tokens) | Output (per 1M tokens) | Search fee |
| --- | --- | --- | --- | --- |
| Search | Perplexity Sonar | $1.00 | $1.00 | $5.00 per 1K calls |
| Extract | MiniMax M3 (via OpenRouter) | $0.30 | $1.20 | |
| Collate | MiniMax M3 (via OpenRouter) | $0.30 | $1.20 | |
| Cache suggest | MiniMax M3 (via OpenRouter) | $0.30 | $1.20 | |

**Recorded Provider-Cost Breakdown:**

The original `intelli-search` row records ≈$0.007 for Sonar search, ≈$0.08 for M3 extract and collate (M3 × 11 calls), ≈$0.0002 for cache suggest, and a total of ≈$0.09. These figures exclude agent-loop inference and remain historical, not a second current estimate.

| Extension | Extension Charge | Provider Usage | Agent Inference | Research Total |
|---|---|---|---|---|
| `intelli-search` | No separate extension fee | Recorded pipeline estimate above | Excluded from pipeline estimate | Current estimate: [README Cost](../README.md#cost) |
| `pi-web-providers` | Not measured here | Depends on selected provider and tariff | Not measured here | Unknown |
| `pi-web-access` | Not measured here | Fallback-chain provider tariffs not established here | Not measured here | Unknown |
| `pi-smart-fetch` | Not measured here | Local fetch; no provider inference stage recorded | Not measured here | Unknown |
| `ollama-web-search` | Not measured here | Ollama service usage; tariff not established here | Not measured here | Unknown |
| `rpiv-web-tools` | Not measured here | Brave usage depends on account allowance and tariff | Not measured here | Unknown |
| `pi-amplike` | Not measured here | Recorded Jina free-tier or paid usage | Not measured here | Unknown |

### Cost: Key Difference

The pipeline estimate includes search, extraction, collation and cache suggestion, but excludes the host agent's inference and local compute. Absence of a dedicated extraction or collation stage does not establish a free research total. Provider tariffs, account allowances, output volume and model choices determine charges; manual reuse of cached reports can avoid a later research call.

## Host-Native Web Search

A host agent's built-in web tools are an alternative to `intelli-search`. One session compared `intelli_research` with the [_Claude Code_](https://code.claude.com/docs) `WebSearch` and `WebFetch` tools on a task about publishing plugins that run local Model Context Protocol (MCP) servers.

### Session Scope

The record is a single qualitative observation from 2026-10-06, not a benchmark. The same Claude Code model requested both routes and assessed their outputs; the `Pi` subprocess and research pipeline used their own model calls. The task was not repeated, and the assessment was not blinded. The [session evidence](evidence/2026-10-06-host-native-search.md) identifies the transcript, cached reports, call counts and source passages.

| Item | Recorded Value |
|---|---|
| Host Session | Claude Code session metadata: 2.1.290; installed command check: 2.1.291. Model: `claude-opus-5-5` |
| Research Route | Native `Pi` extension 0.14.0 from `npm`, run with `pi -p` from the Claude Code session. The MCP plugin route was not exercised |
| Pipeline Models | Defaults through OpenRouter: Perplexity Sonar search, MiniMax M3 extraction and collation |
| Task | Listing requirements for a plugin with a local MCP server in Anthropic's and OpenAI's directories |
| Calls | Two `intelli_research` calls, one per directory, each with `maxUrls` set to 6; three `WebSearch` and seven `WebFetch` calls |

These are tool-call counts, not equivalent units of work. Each `intelli_research` call includes search, page fetching, extraction and collation. The session does not establish a cost or latency advantage.

### Observations

| Aspect | `intelli_research` | Native `WebSearch` and `WebFetch` |
|---|---|---|
| Source Selection | Vendor documentation, a vendor blog and the official marketplace README; all 12 requested URLs fetched, including two variants of one submission page | Initial search results included blogs and aggregators; subsequent fetches targeted official documentation |
| Output | One synthesis per directory covering eligibility, folder layout, review rules and update procedures. The OpenAI result also included manifest field limits, a source assessment table and a suggestion to read the earlier cached search | Page-level results from targeted requests, including full documentation pages rather than only summaries |
| Additional Sources | OpenAI's migration guide, including local-server guidance and conditions requiring partner contact | The platform-support table and the publishing guide's distinction between the directory portal and `claude-plugins-official`; neither page was fetched by the pipeline |
| Unresolved Claims | The report cited a marketplace submission form from the captured official README. The publishing guide gave different guidance; the session did not establish whether the form remained valid | A secondary search result's marketplace launch date was not verified. That uncertainty is not evidence that the claim was false |

### Findings and Limits

In this session, `intelli_research` returned cross-source syntheses without further page-fetch requests from the host model. The built-in tools supplied additional official pages for checking the result, including the platform-support table and different marketplace submission guidance. The [captured passages](evidence/2026-10-06-host-native-search.md#submission-guidance) establish a discrepancy to investigate, not a confirmed stale-form error.

These observations apply to the native `Pi` route. In the separate Claude Code 2.1.289 verification, the MCP plugin delivered only the structured result to the model and omitted the summary text ([finding F2](plans/mcp-intelli-search/POST-PHASE-6.md#f2-claude-code-drops-the-text-summary-high-confirmed)). This session did not retest the plugin route on either of the newer recorded host versions.
