# Comparison With Other `Pi` Search Extensions

This document compares `intelli-search` against other web search and fetch extensions in the `Pi` ecosystem. Each tool takes a different approach to search, fetch, extraction, and persistence.

## Scope

This comparison covers May 2026. It examines the seven extensions listed on `pi.dev/packages` or installed from _GitHub_ that provide web search, web fetch, or content extraction tools for the `Pi` coding agent. Monthly download counts (where available) are sourced from `pi.dev/packages` and indicate community adoption at the time of comparison.

Download counts do not reflect quality or suitability for any specific task. They are included only to show why these particular extensions were chosen for comparison — the six with the most community adoption, plus `intelli-search`.

Extensions not listed on `pi.dev/packages` or installed via `pi install git:` are not captured in download counts.

## Extensions Compared

Monthly downloads from `pi.dev/packages` as of May 2026. GitHub-only packages show no download count.

| Extension | Package | Downloads/mo | Maintainer |
| --- | --- | ---: | --- |
| **pi-web-access** | `pi-web-access` | 26,933 | nicopreme |
| **ollama-web-search** | `@ollama/pi-web-search` | 25,845 | Ollama |
| **rpiv-web-tools** | `@juicesharp/rpiv-web-tools` | 7,879 | juicesharp |
| **pi-smart-fetch** | `pi-smart-fetch` | 6,822 | Thinkscape |
| **pi-web-providers** | `pi-web-providers` | — (GitHub) | mavam |
| **pi-amplike** | `pi-amplike` | — (GitHub) | pasky |
| **intelli-search** | `@curio-data/pi-intelli-search` | — (new) | Curio Data Pro |

## Search

How each extension discovers which URLs to fetch.

| Extension | Search Backend | Multiple Sources | API Keys Required |
| --- | --- | :---: | :---: |
| **intelli-search** | Perplexity Sonar via OpenRouter | Single high-quality source | 1 (OpenRouter) |
| **pi-web-providers** | 15+ providers (Exa, Perplexity, Gemini, Brave, Firecrawl, Linkup, etc.) | Configurable per-tool | 1 per provider used |
| **pi-web-access** | Exa → Perplexity → Gemini → Gemini Web (sequential fallback) | Tried in order | 1 per provider used |
| **ollama-web-search** | Ollama native web search | Single source | Ollama API key |
| **rpiv-web-tools** | Brave Search API | Single source | Brave API key |
| **pi-amplike** | Jina Search API | Single source | Optional (rate-limited without) |
| **pi-smart-fetch** | None (URL fetch only) | N/A | None |

### Search: Key Difference

`intelli-search` uses a single OpenRouter API key to access Perplexity Sonar for search _and_ any model for extraction and collation. `pi-web-providers` and `pi-web-access` give more search backends but each requires its own API key, account, and setup. `rpiv-web-tools` and `pi-amplike` also require separate provider accounts.

Perplexity Sonar is the default search model, but OpenRouter also exposes a `web_search` server tool that can equip any model with URL-cited search results (using Exa, Parallel, Firecrawl, or native provider engines). If a future model surpasses Sonar for grounded search, the architecture supports swapping it via `intelliSearchModel` in settings without changing the rest of the pipeline.

## Fetch

How each extension retrieves and processes page content.

| Extension | Fetch Method | Content Cleaning | Dual-Fetch Comparison | Fallback |
| --- | --- | :---: | :---: | --- |
| **intelli-search** | wreq-js browser TLS + Defuddle + Markdown endpoint (parallel) | Defuddle (HTML) + sanitize (Markdown) | **Yes** — scores both, picks best | Defuddle-fallback (basic DOM text extraction) |
| **pi-web-providers** | Provider-dependent (Firecrawl, Linkup, etc.) | Provider-dependent | No | Provider-dependent |
| **pi-web-access** | HTTP fetch → Readability → Jina Reader → Gemini (fallback chain) | Readability + Jina + Gemini | No | Sequential fallback through chain |
| **pi-smart-fetch** | Browser TLS fingerprinting (chrome_145) + Defuddle | Defuddle | No | Alternate `<link>` discovery for thin content |
| **ollama-web-search** | Ollama web fetch API | Ollama server-side | No | None |
| **rpiv-web-tools** | Brave Search API (search-focused) | Provider-dependent | No | None |
| **pi-amplike** | Jina Reader API | Jina server-side | No | None |

### Fetch: Key Difference

`intelli-search` and `pi-smart-fetch` both use browser-grade TLS fingerprinting and Defuddle for HTML cleaning. However, `intelli-search` goes further by also fetching the Markdown variant (when available) and **comparing both for quality**.

**Why compare?** Server-rendered Markdown is not guaranteed to be clean. For example, fetching `https://developers.cloudflare.com/d1/` with `Accept: text/markdown` returns 3,696 chars of content that includes JSON-LD BreadcrumbList schema data, extra Schema.org markup, and community promotion links. Defuddle extraction of the same page strips these artifacts, producing 3,047 chars of cleaner content. The quality comparison catches this and picks the better version automatically.

## Extraction

What happens to page content after fetching, before it reaches the agent.

| Extension | Per-Page LLM Extraction | Targets Query Relevance | Handles Code Blocks |
| --- | :---: | :---: | :---: |
| **intelli-search** | **Yes** — configurable model, default MiniMax M2.7 | **Yes** — guided by `focusPrompt` | **Yes** — preserved verbatim |
| **pi-web-providers** | No | No | No |
| **pi-web-access** | Partial (Gemini for blocked pages, video descriptions) | No | No |
| **pi-smart-fetch** | No | No | No |
| **ollama-web-search** | No | No | No |
| **rpiv-web-tools** | No | No | No |
| **pi-amplike** | No | No | No |

### Extraction: Key Difference

`intelli-search` is the only extension among those compared that uses an LLM to extract query-relevant content from each page before it enters the agent's context. This compresses ≈50K chars per page to ≈3-5K of focused content. The `focusPrompt` parameter lets the agent specify exactly what to look for across all pages.

MiniMax M2.7 is the default extraction model, but any model `Pi` supports can be swapped in via `intelliExtractModel` in settings — including models accessed through the same OpenRouter key used for search. This means the extraction quality can scale independently from cost, from cheap flash models to full reasoning models.

**Trade-off:** This approach is vulnerable to the extraction LLM's ability to identify relevant content. A weak extraction model may miss key details or introduce errors. The other extensions deliver full page content to the agent, which can be advantageous when the main LLM is better equipped to filter noise than a smaller, cheaper extraction model. If the main LLM is confused by non-relevant material, however, pre-extraction keeps the context clean and focused.

## Collation

What happens after individual pages are processed, to synthesise findings.

| Extension | Cross-Source Deduplication | Inconsistency Detection | Source Attribution |
| --- | :---: | :---: | :---: |
| **intelli-search** | **Yes** — LLM-powered | **Yes** — conflicting claims flagged | **Yes** — sources cited with type and currentness |
| **pi-web-providers** | No | No | No |
| **pi-web-access** | No | No | No |
| **pi-smart-fetch** | No | No | No |
| **ollama-web-search** | No | No | No |
| **rpiv-web-tools** | No | No | No |
| **pi-amplike** | No | No | No |

### Collation: Key Difference

`intelli-search` is the only extension among those compared with a collation stage. The collation LLM sees all per-page extractions and produces a single synthesised summary. It deduplicates overlapping information, flags conflicting claims from different sources, and preserves URLs for attribution. Without this, the agent has to do this work itself, consuming context and reasoning tokens for mechanical synthesis.

Like extraction, the collation model is configurable — swap it via `intelliCollateModel` in settings to use any model `Pi` supports.

## Caching

What happens to results after the session ends.

| Extension | Persistent Cache | Cache Format | Offline Reuse | Cache Suggest |
| --- | :---: | --- | :---: | :---: |
| **intelli-search** | **Yes** | `.search/<date>-<slug>/` with `report.md`, `query.txt`, `extractions/`, `sources/`, `.index.json` | **Yes** — full pages and extractions preserved | **Yes** — LLM judge finds related previous searches |
| **pi-web-providers** | In-memory only | N/A | No | No |
| **pi-web-access** | Per-session (GitHub repos, search results) | Filesystem + response IDs | No | No |
| **pi-smart-fetch** | No | N/A | No | No |
| **ollama-web-search** | No | N/A | No | No |
| **rpiv-web-tools** | No | N/A | No | No |
| **pi-amplike** | No | N/A | No | No |

### Caching: Key Difference

`intelli-search` is the only extension among those compared with a persistent, structured cache. Full pages and extractions are stored in `.search/` and indexed in `.index.json`. The cache suggest stage (Stage 5) automatically surfaces related previous searches, reducing redundant API calls over time. Because previous search data is preserved, new searches can be compared against cached results to identify changes, updates, or conflicting information across time. This makes follow-up research both faster and cheaper.

## Cost

Approximate cost per research session with 8 pages. Token rates sourced from provider pricing pages as of May 2026.

**`intelli-search` token rates used:**

| Stage | Model | Input (per 1M tokens) | Output (per 1M tokens) |
| --- | --- | --- | --- |
| Search | Perplexity Sonar | $2.00 | $8.00 |
| Extract | MiniMax M2.7 | $0.30 | $1.20 |
| Collate | MiniMax M2.7 | $0.30 | $1.20 |
| Cache suggest | MiniMax M2.7 | $0.30 | $1.20 |

**Per-session breakdown:**

| Extension | Search | Fetch | Extract + Collate | Cache Suggest | **Total** |
| --- | --- | --- | --- | --- | --- |
| **intelli-search** | ≈$0.02 (Sonar) | FREE | ≈$0.035 (M2.7 × 9 calls) | ≈$0.0002 | **≈$0.05** |
| **pi-web-providers** | Provider-dependent | Provider-dependent | Free (no LLM) | Free | **Varies** |
| **pi-web-access** | Free (fallback chain) | Free (Readability/Jina) | Free (no LLM extraction) | Free | **FREE** |
| **pi-smart-fetch** | N/A | Free | Free (no LLM) | Free | **FREE** |
| **ollama-web-search** | Free (local Ollama) | Free (local Ollama) | Free (no LLM) | Free | **FREE** |
| **rpiv-web-tools** | Free (Brave Search) | Free (Brave) | Free (no LLM) | Free | **FREE** |
| **pi-amplike** | Free tier / paid Jina | Free tier / paid Jina | Free (no LLM) | Free | **FREE — varies** |

### Cost: Key Difference

`intelli-search` has a cost because it does more work: LLM extraction, LLM collation, and LLM cache suggest. The ≈$0.05 per session is intentional — it buys targeted, deduplicated, cached results. Extensions without LLM processing are free but deliver raw content to the agent, which then spends its own reasoning tokens (and context) sorting through it. The persistent cache also reduces costs over time through reuse.

Costs scale with the chosen models. The figures above use the defaults (Sonar for search, MiniMax M2.7 for extraction and collation). Swapping to cheaper or more expensive models changes the per-session cost proportionally.

## Architecture Summary

```text
                   intelli-search     pi-web-       pi-web-      pi-smart-    ollama-      rpiv-        pi-
                                      providers     access       fetch        web-search   web-tools    amplike
                   ───────────────    ──────────    ────────     ─────────    ────────     ────────     ──────
Search             Sonar (1 key)      15+ providers  Fallback     None         Ollama       Brave        Jina
Fetch              Dual + compare     Provider-dep   Readability  TLS+Defuddle Ollama       Brave        Jina
LLM Extraction     ✓ per page         ✗              Partial      ✗            ✗            ✗            ✗
LLM Collation      ✓ dedupe+flag      ✗              ✗            ✗            ✗            ✗            ✗
Persistent Cache   ✓ .search/         In-memory      Per-session  ✗            ✗            ✗            ✗
Cache Suggest      ✓ LLM judge        ✗              ✗            ✗            ✗            ✗            ✗
Total API Keys     1 (OpenRouter)     1 per used     1+ per used  None         Ollama       Brave        0-1 (Jina)
Cost per session   ≈$0.05             Varies         FREE          FREE         FREE        FREE         FREE
```

`intelli-search` is not a general-purpose web search tool. It is purpose-built for deep, cached, LLM-processed research. The other extensions in the ecosystem serve different needs and are often complementary rather than competitive. This comparison is a snapshot — extension capabilities and download counts will change over time.
