# pi-intelli-search

[![npm version](https://img.shields.io/npm/v/@curio-data/pi-intelli-search?color=blue)](https://www.npmjs.com/package/@curio-data/pi-intelli-search)
[![npm downloads](https://img.shields.io/npm/dt/@curio-data/pi-intelli-search?color=blue)](https://www.npmjs.com/package/@curio-data/pi-intelli-search)
[![pi compatible](https://img.shields.io/badge/pi-%E2%89%A50.69.0-blueviolet)](https://github.com/mariozechner/pi)
[![license](https://img.shields.io/badge/license-Apache--2.0-green)](./LICENSE)
![tests](https://img.shields.io/badge/tests-106%20passing-brightgreen)
Intelligent web research for [`Pi`](https://github.com/mariozechner/pi): search, extract, collate, and cache grounded web context in one tool call.

A `Pi` extension for deep web research. It searches via [Perplexity Sonar](https://docs.perplexity.ai), fetches pages through an intelligent dual-fetch comparison ([_Defuddle_](https://github.com/kepano/defuddle) versus Markdown endpoint), extracts query-relevant content per page with a dedicated LLM guided by a `focusPrompt`, then collates findings — deduplicating, flagging inconsistencies, and synthesising a concise summary. Everything is cached in `.search/` for offline reuse, with automatic cache suggest surfacing related previous searches on each query.

<p align="center">
  <img src="docs/images/01.png" alt="PI-Intelli Search: a five-stage research pipeline diagram arranged in a clockwise cycle. The five labelled stages, each enclosed in a laurel-wreath medallion, are Search (top, depicted as a magnifying glass over an open book), Fetch (right, a hand retrieving a document from shelves), Extract (bottom-right, a distillation apparatus), Collate (bottom-left, stacked books and filing boxes), and Cache &amp; Suggest (left, a treasure chest with an envelope). Copper-coloured arrows connect the stages in sequence. The background is decorated with pen-and-ink botanical and scholarly motifs including quill pens, ink bottles, scrolls, globes, hourglasses, and open books." width="800" />
</p>

**Features:**

- 🔍 **Search:** [_Perplexity Sonar_](https://docs.perplexity.ai) via [_OpenRouter_](https://openrouter.ai) — one API key, no $50 minimum.
- 🌐 **Fetch:** Dual-fetch each page (HTML → Defuddle versus Markdown endpoint), compare quality, pick the cleaner version.
- 📄 **Extract:** Per-page LLM extraction guided by `focusPrompt` — compresses ≈50K to ≈3-5K chars of query-relevant content.
- 🔗 **Collate:** Cross-source deduplication, inconsistency detection, and synthesis into a focused ≈5K summary.
- 💾 **Cache:** Persistent `.search/` cache with automatic cache suggest — related previous searches surfaced on each query.
- 🎯 **Configurable:** Swap any pipeline stage (search, extract, collate) to any model `Pi` supports.
- 💰 **Low cost:** Approximately $0.05 per research session with default settings.

## How It Compares

Other `Pi` search extensions do excellent work: `pi-web-access` (26K downloads/mo) fetches via _Readability_ and _Jina_, `pi-smart-fetch` uses browser-grade TLS with Defuddle, and `pi-web-providers` routes across 15+ search backends. All of them clean HTML into readable content.

`intelli-search` goes further in four specific areas:

**1. Dual-fetch quality comparison.** Every page is fetched twice in parallel — once through Defuddle (HTML cleaning) and once through a Markdown endpoint if available. They are scored on code blocks, headings, and tables versus nav chrome noise. The better version wins. Server-rendered Markdown is not always clean: `https://developers.cloudflare.com/d1/` returns 3,696 chars with JSON-LD breadcrumb noise when fetched as Markdown, versus 3,047 chars of cleaner content from Defuddle. The comparison catches this automatically.

**2. Per-page LLM extraction before collation.** Other extensions deliver full page content to the agent. That works when the main LLM can filter noise effectively. `intelli-search` uses a dedicated extraction model (configurable, default _MiniMax_ M2.7) to compress each page to ≈3-5K of query-relevant content _before_ it enters the agent's context. The `focusPrompt` parameter guides what to look for across all pages. This keeps the agent's context focused — but it depends on the extraction model's quality.

**3. LLM collation with deduplication.** After per-page extraction, a collation model synthesises findings across all sources. It removes redundant information, flags conflicting claims, and preserves source attribution. Without this, the agent spends reasoning tokens on mechanical synthesis.

**4. Persistent cache with cache suggest.** Full pages and extractions are stored in `.search/` and indexed. The cache suggest stage automatically finds related previous searches, so follow-up queries can compare new findings against cached data. Over time, this reduces API calls and cost.

Together, extraction and caching give the best of both worlds. The agent works from a concise ≈5K summary by default — saving context and tokens. But the full page content is preserved in the cache, accessible with native `Pi` tools like `read` or `grep` whenever deeper inspection is needed. No other `Pi` search extension offers both.

For a detailed comparison against six other `Pi` search extensions, see [docs/COMPARISON.md](docs/COMPARISON.md).

<p align="center">
  <img src="docs/images/02.png" alt="Pipeline comparison infographic" width="800" />
</p>

## Install

From `npm` (recommended):

```bash
pi install npm:@curio-data/pi-intelli-search
```

From _GitHub_:

```bash
pi install git:github.com/Curio-Data/pi-intelli-search
```

Local development:

```bash
pi install /path/to/pi-intelli-search
```

On first load, the extension adds [Perplexity Sonar](https://docs.perplexity.ai) models to `~/.pi/agent/models.json` under the `openrouter` provider. This patch approach lets `Pi` discover _Sonar_ through [OpenRouter](https://openrouter.ai). No separate Perplexity API account is needed.

## Tools

| Tool               | Description                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| `intelli_search`   | Search via [Perplexity Sonar](https://docs.perplexity.ai). Returns summary with source URLs.              |
| `intelli_extract`  | Per-page LLM extraction guided by `focusPrompt`. Reduces ≈50K chars to ≈3-5K of relevant content.         |
| `intelli_collate`  | Deduplicate and synthesise extractions into a summary. Writes cache.                                      |
| `intelli_research` | Full pipeline: search, fetch, extract, collate, cache. One call.                                          |

## Quick Start

### Quick Search

```text
intelli_search(query="TypeScript 5.8 release date")
```

### Deep Research

**Always provide a `focusPrompt`.** The extraction LLM works best with specific guidance.

```text
intelli_research(
  query="Svelte 5 runes tutorial examples",
  focusPrompt="Extract the core rune concepts ($state, $derived, $effect), their syntax, and how they replace the old reactive declarations. Include migration patterns from Svelte 4."
)
```

### Targeted Research With Domain Restriction

```text
intelli_research(
  query="Cloudflare Workers KV write timeout limits",
  focusPrompt="Extract KV write limits, timeout thresholds, storage limits, and any workarounds for bulk writes. Focus on hard numbers and error messages.",
  maxUrls=3,
  domains=["developers.cloudflare.com"]
)
```

### Comparing Options

```text
intelli_research(
  query="Tailwind CSS vs Vanilla Extract comparison 2026",
  focusPrompt="Extract pros/cons, bundle size benchmarks, DX tradeoffs, and migration costs. Note which claims come from official sources vs blog opinions."
)
```

## Model Configuration

All three pipeline stages use independently configurable models. Defaults are chosen for cost-efficiency, but **any model `Pi` can access works**. This includes built-in providers, [OpenRouter](https://openrouter.ai) models, or models from other extensions.

| Stage   | Default                       | Config key            |
| ------- | ----------------------------- | --------------------- |
| Search  | `openrouter/perplexity/sonar` | `intelliSearchModel`  |
| Extract | `minimax/MiniMax-M2.7`        | `intelliExtractModel` |
| Collate | `minimax/MiniMax-M2.7`        | `intelliCollateModel` |

### Why OpenRouter For _Sonar_?

[_Perplexity Sonar_](https://docs.perplexity.ai) is an excellent search-grounded model, but it is not in `Pi`'s built-in model list. Rather than requiring a separate Perplexity API account (which requires a **$50 minimum credit top-up**), the extension routes _Sonar_ through [OpenRouter](https://openrouter.ai). OpenRouter is a unified pay-as-you-go API with no minimum spend. One API key gives you _Sonar_ alongside thousands of other models. On first load, the extension patches `~/.pi/agent/models.json` to add _Sonar_ under the `openrouter` provider so `Pi` can discover it. This approach has several benefits:

- **Avoids the Perplexity API $50 minimum.** OpenRouter has pay-as-you-go with no minimum spend.
- **One account, many models.** The same OpenRouter key covers _Sonar_ and any other models you might want for extract or collate.
- **Is non-destructive.** The patch merges new models by ID. It never replaces existing OpenRouter models.
- **Is idempotent.** It is safe across extension reloads and updates.

### Swapping The Extract And Collate Model

_MiniMax_ M2.7 is the default because it is cheap and effective for extraction and collation. However, you can use any model `Pi` supports. Override in `~/.pi/agent/settings.json` or `.pi/settings.json`:

**Option A: Use A `Pi` Built-In Provider** (auth via `/login`):

```jsonc
{
  "intelliExtractModel": { "provider": "openai", "model": "gpt-4o-mini" },
  "intelliCollateModel": { "provider": "openai", "model": "gpt-4o-mini" }
}
```

**Option B: Use Another OpenRouter Model** (same key, no extra setup):

```jsonc
{
  "intelliExtractModel": { "provider": "openrouter", "model": "google/gemini-2.0-flash-001" },
  "intelliCollateModel": { "provider": "openrouter", "model": "google/gemini-2.0-flash-001" }
}
```

**Option C: Use A Model Provided By Another Extension** (for example, Z.Ai or local models):

```jsonc
{
  "intelliExtractModel": { "provider": "zai", "model": "glm-5.1" },
  "intelliCollateModel": { "provider": "zai", "model": "glm-5.1" }
}
```

The only requirement is that the model is registered in `Pi`'s model registry and has auth configured. Run `/login` to set up built-in providers, or follow the extension's own setup for extension-provided models.

### Model Selection Guidance

For extraction and collation, the ideal model has:

- **Low cost per token:** 8 extractions, 1 collation, and 1 cache suggest per default session.
- **Good instruction following:** Must adhere to extraction prompts precisely.
- **Sufficient context:** Cleaned pages can be ≈50K chars (truncated to `extractMaxChars`).

Models known to work well for extraction and collation: _MiniMax_ M2.7 (default), _Qwen_ 3.5-Flash (≈1M context, ≈$0.26/M output), _DeepSeek_ V4 Flash (≈1M context, ≈$0.28/M output), _Gemini_ 2.0 Flash Lite (≈1M context, ≈$0.30/M output), _GPT-4.1_ Nano (≈1M context, ≈$0.40/M output).

### Required API Keys

With default settings, you need two keys in `~/.pi/agent/auth.json`:

```json
{
  "openrouter": { "type": "api_key", "key": "sk-or-v1-..." },
  "minimax": { "type": "api_key", "key": "sk-api-..." }
}
```

- **OpenRouter:** Used by `intelli_search` ([Perplexity Sonar](https://docs.perplexity.ai)) and available as an extract or collate alternative.
- **_MiniMax_:** Used by `intelli_extract` and `intelli_collate` (MiniMax M2.7). **Only needed if you keep the defaults.** Override `intelliExtractModel` or `intelliCollateModel` to use a different provider.

Run `/login` in `Pi` to set up keys interactively, or edit the file directly.

## Pipeline

```text
intelli_research(query)
  ├── Stage 1: Search  -> Perplexity Sonar (via OpenRouter, pi native auth)
  ├── Stage 2: Fetch   -> wreq-js + Defuddle, compared against raw Markdown
  ├── Stage 3: Extract -> configurable model, default: MiniMax M2.7 (parallel)
  ├── Stage 4: Collate -> configurable model, default: MiniMax M2.7 (dedupe + cache)
  └── Stage 5: Cache suggest -> LLM judge finds related previous searches (additive)
```

All model assignments are configurable. See [Model Configuration](#model-configuration).

Each page is dual-fetched (HTML to [_Defuddle_](https://github.com/kepano/defuddle) versus Markdown endpoint) and scored for quality. Per-page extraction — guided by `focusPrompt` — compresses ≈50K chars to ≈3-5K of query-relevant content before collation, keeping the total context manageable (≈24-40K for 8 pages).

For sites with `llms-full.txt` ([Cloudflare](https://developers.cloudflare.com), [Next.js](https://nextjs.org), [Vite](https://vite.dev)), the raw file is downloaded to the cache for offline grep. No LLM processing is needed.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed design decisions.

## Cost

Per research session with the default 8 pages: **≈$0.05**

| Step                           | Calls            | Cost      |
| ------------------------------ | ---------------- | --------- |
| Search (_Sonar_)               | 1                | ≈$0.02    |
| Fetch (Defuddle + Markdown)    | 8 parallel pairs | $0.00     |
| Extract (_MiniMax_ M2.7)       | 8 parallel       | ≈$0.03    |
| Collate (_MiniMax_ M2.7)       | 1                | ≈$0.005   |
| Cache suggest (_MiniMax_ M2.7) | 1                | ≈$0.0002  |

Costs scale with your chosen extract or collate model. _MiniMax_ M2.7 is the default specifically for its low cost.

## Settings

Override defaults in `~/.pi/agent/settings.json` or `.pi/settings.json`:

```jsonc
{
  // Model assignments: see "Model Configuration" section for swap guidance
  "intelliSearchModel": {
    "provider": "openrouter",
    "model": "perplexity/sonar",
  },
  "intelliExtractModel": { "provider": "minimax", "model": "MiniMax-M2.7" },
  "intelliCollateModel": { "provider": "minimax", "model": "MiniMax-M2.7" },

  // Pipeline tuning
  "intelliMaxUrls": 8,
  "intelliCacheDir": ".search",
  "intelliExtractMaxChars": 150000,
  "intelliExtractionMaxTokens": 3000,
  "intelliCollationMaxTokens": 4000,
  "intelliFetchTimeoutMs": 20000,
  "intelliFetchConcurrency": 4,
  "intelliBrowserFingerprint": "chrome_145",
  "intelliLlmsFullSites": {},
}
```

`intelliBrowserFingerprint` controls the TLS fingerprint used by [wreq-js](https://github.com/sqdshguy/wreq-js) when fetching pages (defaults to Chrome 145). `intelliLlmsFullSites` is a map of domain to base URL for sites that provide `llms-full.txt` files (for example, `{"developers.cloudflare.com": "https://developers.cloudflare.com"}`). These files are downloaded raw to the cache without LLM processing.

## Cache Structure

```text
.search/
├── 2026-04-19-d1-worker-api/
│   ├── report.md               # Collated summary + source index
│   ├── query.txt               # Original search query
│   ├── extractions/            # Per-page LLM extractions (≈3-5K each)
│   │   ├── 01-developers-cloudflare-com.md
│   │   └── 02-developers-cloudflare-com.md
│   └── sources/                # Full page content
│       ├── 01-developers-cloudflare-com.md
│       ├── 02-developers-cloudflare-com.md
│       └── llms-full-developers-cloudflare-com.md
└── .index.json                 # Index of all cached searches
```

## Compatibility

- **`Pi` >= 0.69.0:** Core functionality (TypeBox 1.x, tools, model registration, settings, working indicator, `after_provider_response` monitoring).
- Gracefully degrades on older versions. Optional features are skipped.

## Development

```bash
npm install
npm run build        # TypeScript -> dist/
npm test             # Unit tests (106 tests)
npm run test:smoke   # Smoke test

# Test in pi
pi -e ./dist/index.js

# Install as package
pi install /path/to/pi-intelli-search
```

## Documentation

- [Comparison](docs/COMPARISON.md): How `intelli-search` compares to other `Pi` search extensions.
- [Changelog](docs/CHANGELOG.md): Release history.
- [Architecture](docs/ARCHITECTURE.md): Detailed design decisions and pipeline internals.
- [Components](docs/COMPONENTS.md): Third-party dependencies and license attribution.
- [Skill guide](skills/intelli-search/SKILL.md): Agent-facing usage instructions.
- [Contributor guide](AGENTS.md): Coding conventions and project structure.

## Sponsor

[![Curio Data Pro Ltd](docs/images/sponsor.png)](https://blog.curiodata.pro/)

This project recognises the support and resources provided by **[Curio Data Pro Ltd](https://blog.curiodata.pro/)**, a data consultancy serving engineering sectors including Rail, Naval Design, Aviation, and Offshore Energy. Curio Data Pro combines 20+ years of Chartered Engineer experience across _Aerospace_, _Defence_, _Rail_, and _Offshore Energy_ with data science and DevOps capabilities.

[Blog](https://blog.curiodata.pro/) | [LinkedIn](https://www.linkedin.com/company/curio-data-pro-ltd/)

## License

Copyright 2026 Ashraf Miah, Curio Data Pro Ltd.

Licensed under the [Apache License, Version 2.0](./LICENSE).

## Use of Text Generators

_Text Generators_ (for example, _Large Language Models_ or so-called "Artificial Intelligence" tools) have been used extensively in the development of this project.

- **`Pi` agent** (primary development environment).
- **_GLM_ 5.1:** Primary model for code generation and architecture.
- **_DeepSeek_ V4 Pro:** Research and data analysis.
- **_Qwen_ 3.6 Plus:** Secondary model for review and documentation.
