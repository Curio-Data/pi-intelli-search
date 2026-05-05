# pi-intelli-search

[![npm version](https://img.shields.io/npm/v/@curio-data/pi-intelli-search?color=blue)](https://www.npmjs.com/package/@curio-data/pi-intelli-search)
[![npm downloads](https://img.shields.io/npm/dt/@curio-data/pi-intelli-search?color=blue)](https://www.npmjs.com/package/@curio-data/pi-intelli-search)
[![pi compatible](https://img.shields.io/badge/pi-%E2%89%A50.69.0-blueviolet)](https://github.com/mariozechner/pi)
[![license](https://img.shields.io/badge/license-Apache--2.0-green)](./LICENSE)
[![tests](https://img.shields.io/badge/tests-104%20passing-brightgreen)]()
Intelligent web research for [`Pi`](https://github.com/mariozechner/pi): search, extract, collate, and cache grounded web context in one tool call.

A `Pi` extension that adds a 5-stage research pipeline (_Search_, _Fetch_, _Extract_, _Collate_, and _Cache Suggest_) designed for technical task completion. Per-page LLM extraction compresses raw pages to query-relevant content. It then deduplicates across sources into a concise summary with a persistent `.search/` cache.

<p align="center">
  <img src="docs/images/01.png" alt="PI-Intelli Search: a five-stage research pipeline diagram arranged in a clockwise cycle. The five labelled stages, each enclosed in a laurel-wreath medallion, are Search (top, depicted as a magnifying glass over an open book), Fetch (right, a hand retrieving a document from shelves), Extract (bottom-right, a distillation apparatus), Collate (bottom-left, stacked books and filing boxes), and Cache &amp; Suggest (left, a treasure chest with an envelope). Copper-coloured arrows connect the stages in sequence. The background is decorated with pen-and-ink botanical and scholarly motifs including quill pens, ink bottles, scrolls, globes, hourglasses, and open books." width="800" />
</p>

**Features:**
- 🔍 **Search:** [_Perplexity Sonar_](https://docs.perplexity.ai) via [OpenRouter](https://openrouter.ai) (one API key, no $50 minimum).
- 📄 **Extract:** Per-page LLM extraction compresses ≈50K to ≈3-5K chars.
- 🔗 **Collate:** Cross-source deduplication into a focused ≈5K summary.
- 💾 **Cache:** Persistent `.search/` cache for offline reuse and follow-up.
- 🎯 **Configurable:** Swap any pipeline stage to any model `Pi` supports.
- 💰 **Low cost:** Approximately $0.05 per research session with default settings.

## Why intelli-search?

Most coding agents handle web research with a simple two-step pattern: **fetch URL, then dump raw content into context**. [_Claude Code_](https://github.com/anthropics/claude-code)'s `WebFetch` tool, revealed in its open-sourced CLI, follows exactly this approach. It fetches a page, converts HTML to Markdown (via the Jina Reader API), and hands the full result to the model.

The problem is that a cleaned documentation page is still ≈50K characters. For the default 8 sources, that is ≈400K chars dumped into the agent's context window. The model must simultaneously hold your task, the codebase, and a wall of raw web content. Signal-to-noise drops fast.

**`intelli-search` takes a different approach: extract before you collate.**

Each page is compressed by a dedicated extraction model *before* entering the agent's context. A collation model then deduplicates across extractions. The agent receives a focused ≈5K summary instead of 400K of raw HTML.

<p align="center">
  <img src="docs/images/02.png" alt="PI-Intelli-Search pipeline comparison infographic contrasting two approaches: Per-Page Extraction versus Fetch-and-Dump. The top row, labelled Intelli Search, shows a five-stage pipeline: Query to Search (Perplexity Sonar), Fetch (Defuddle and Markdown), Extract (MiniMax M2.7, ≈3-5K characters per page), Collate (MiniMax M2.7, deduplicate and synthesise), and Agent Context (≈5K focused summary). The bottom row, labelled Other Agents, shows a simpler three-stage pipeline: URL, Fetch, Raw Content (≈50K characters times 8 pages), and Agent Context (≈400K characters). A footer banner summarises the key trade-offs: context ≈5K versus ≈400K, cost ≈$0.05 per session, deduplication cross-source, cache .search/. Rendered in a pen-and-ink botanical and scholarly illustration style with copper arrows and laurel-wreath medallions." width="800" />
</p>

| | Fetch-and-dump | intelli-search pipeline |
|---|---|---|
| Context cost | Approximately 400K chars raw | Approximately 5K chars focused |
| Noise | Nav, ads, sidebars included | Stripped by extraction |
| Deduplication | None. Overlapping sources waste tokens | Cross-source dedupe via collation |
| Cost per session | N/A (no processing) | Approximately $0.05 |
| Offline reuse | No | Cached in `.search/` |

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

On first load, the extension adds [Perplexity Sonar](https://docs.perplexity.ai) models to `~/.pi/agent/models.json` under the `openrouter` provider. This patch approach lets `Pi` discover Sonar through [OpenRouter](https://openrouter.ai). No separate Perplexity API account is needed.

## Tools

| Tool               | Description                                                              |
| ------------------ | ------------------------------------------------------------------------ |
| `intelli_search`   | Search via [Perplexity Sonar](https://docs.perplexity.ai). Returns summary with source URLs. |
| `intelli_extract`  | Per-page LLM extraction. Reduces ≈50K chars to ≈3-5K of relevant content. |
| `intelli_collate`  | Deduplicate and synthesise extractions into a summary. Writes cache. |
| `intelli_research` | Full pipeline: search, fetch, extract, collate, cache. One call. |

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

| Stage    | Default                    | Config key                |
| -------- | -------------------------- | ------------------------- |
| Search   | `openrouter/perplexity/sonar` | `intelliSearchModel`   |
| Extract  | `minimax/MiniMax-M2.7`     | `intelliExtractModel`     |
| Collate  | `minimax/MiniMax-M2.7`     | `intelliCollateModel`     |

### Why OpenRouter For Sonar?

[_Perplexity Sonar_](https://docs.perplexity.ai) is an excellent search-grounded model, but it is not in `Pi`'s built-in model list. Rather than requiring a separate Perplexity API account (which requires a **$50 minimum credit top-up**), the extension routes Sonar through [OpenRouter](https://openrouter.ai). OpenRouter is a unified pay-as-you-go API with no minimum spend. One API key gives you Sonar alongside thousands of other models. On first load, the extension patches `~/.pi/agent/models.json` to add Sonar under the `openrouter` provider so `Pi` can discover it. This approach has several benefits:

- **Avoids the Perplexity API $50 minimum.** OpenRouter has pay-as-you-go with no minimum spend.
- **One account, many models.** The same OpenRouter key covers Sonar and any other models you might want for extract or collate.
- **Is non-destructive.** The patch merges new models by ID. It never replaces existing OpenRouter models.
- **Is idempotent.** It is safe across extension reloads and updates.

### Swapping The Extract And Collate Model

MiniMax M2.7 is the default because it is cheap and effective for extraction and collation. However, you can use any model `Pi` supports. Override in `~/.pi/agent/settings.json` or `.pi/settings.json`:

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

Models known to work well for extraction and collation: MiniMax M2.7 (default), Qwen3.5-Flash (≈1M context, ≈$0.26/M output), DeepSeek V4 Flash (≈1M context, ≈$0.28/M output), Gemini 2.0 Flash Lite (≈1M context, ≈$0.30/M output), GPT-4.1 Nano (≈1M context, ≈$0.40/M output).

### Required API Keys

With default settings, you need two keys in `~/.pi/agent/auth.json`:

```json
{
  "openrouter": { "type": "api_key", "key": "sk-or-v1-..." },
  "minimax": { "type": "api_key", "key": "sk-api-..." }
}
```

- **OpenRouter:** Used by `intelli_search` ([Perplexity Sonar](https://docs.perplexity.ai)) and available as an extract or collate alternative.
- **MiniMax:** Used by `intelli_extract` and `intelli_collate` (MiniMax M2.7). **Only needed if you keep the defaults.** Override `intelliExtractModel` or `intelliCollateModel` to use a different provider.

Run `/login` in `Pi` to set up keys interactively, or edit the file directly.

## Pipeline

```
intelli_research(query)
  ├── Stage 1: Search  -> Perplexity Sonar (via OpenRouter, pi native auth)
  ├── Stage 2: Fetch   -> wreq-js + Defuddle, compared against raw Markdown
  ├── Stage 3: Extract -> configurable model, default: MiniMax M2.7 (parallel)
  ├── Stage 4: Collate -> configurable model, default: MiniMax M2.7 (dedupe + cache)
  └── Stage 5: Cache suggest -> LLM judge finds related previous searches (additive)
```

All model assignments are configurable. See [Model Configuration](#model-configuration).

Each page is dual-fetched (HTML to [Defuddle](https://github.com/kepano/defuddle) versus Markdown endpoint) and scored for quality. Per-page extraction compresses ≈50K chars to ≈3-5K of query-relevant content before collation, keeping the total context manageable (≈24-40K for 8 pages).

For sites with `llms-full.txt` ([Cloudflare](https://developers.cloudflare.com), [Next.js](https://nextjs.org), [Vite](https://vite.dev)), the raw file is downloaded to the cache for offline grep. No LLM processing is needed.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed design decisions.

## Cost

Per research session with the default 8 pages: **≈$0.05**

| Step                        | Calls            | Cost    |
| --------------------------- | ---------------- | ------- |
| Search (Sonar)              | 1                | ≈$0.02  |
| Fetch (Defuddle + Markdown) | 8 parallel pairs | $0.00   |
| Extract (M2.7)              | 8 parallel       | ≈$0.03  |
| Collate (M2.7)              | 1                | ≈$0.005 |
| Cache suggest (M2.7)        | 1                | ≈$0.0002 |

Costs scale with your chosen extract or collate model. MiniMax M2.7 is the default specifically for its low cost.

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

```
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
npm test             # Unit tests (104 tests)
npm run test:smoke   # Smoke test

# Test in pi
pi -e ./dist/index.js

# Install as package
pi install /path/to/pi-intelli-search
```

## Documentation

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
- **GLM 5.1:** Primary model for code generation and architecture.
- **Qwen 3.6 Plus:** Secondary model for review and documentation.
