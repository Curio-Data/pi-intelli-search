# pi-intelli-search

[![npm version](https://img.shields.io/npm/v/pi-intelli-search?color=blue)](https://www.npmjs.com/package/pi-intelli-search)
[![pi compatible](https://img.shields.io/badge/pi-%E2%89%A50.67.68-blueviolet)](https://github.com/mariozechner/pi)
[![license](https://img.shields.io/badge/license-Apache--2.0-green)](./LICENSE)
[![tests](https://img.shields.io/badge/tests-70%20passing-brightgreen)]()

Intelligent web research for [Pi](https://github.com/mariozechner/pi): search, extract, collate, and cache grounded web context in one tool call.

A Pi extension that adds a 4-stage research pipeline — search → fetch → extract → collate — designed for technical task completion. Per-page LLM extraction compresses raw pages to query-relevant content, then deduplicates across sources into a concise summary with a persistent `.search/` cache.

## Install

From npm (recommended):

```bash
pi install npm:pi-intelli-search
```

From GitHub:

```bash
pi install git:github.com/<user>/pi-intelli-search
```

Local development:

```bash
pi install /path/to/pi-intelli-search
```

On first load, the extension adds Perplexity Sonar models to `~/.pi/agent/models.json` under the `openrouter` provider.

## Tools

| Tool               | Description                                                              |
| ------------------ | ------------------------------------------------------------------------ |
| `intelli_search`   | Search via Perplexity Sonar. Returns summary + source URLs.              |
| `intelli_extract`  | Per-page LLM extraction. Reduces ~50K chars → ~3-5K of relevant content. |
| `intelli_collate`  | Deduplicate and synthesise extractions into a summary + cache.           |
| `intelli_research` | Full pipeline: search → fetch → extract → collate → cache. One call.     |

## Quick Start

### Quick search

```text
intelli_search(query="TypeScript 5.8 release date")
```

### Deep research

**Always provide a `focusPrompt`** — the extraction LLM works best with specific guidance.

```text
intelli_research(
  query="Svelte 5 runes tutorial examples",
  focusPrompt="Extract the core rune concepts ($state, $derived, $effect), their syntax, and migration patterns."
)
```

### Targeted research with domain restriction

```text
intelli_research(
  query="Cloudflare Workers KV write timeout limits",
  focusPrompt="Extract KV write limits, timeout thresholds, and workarounds. Focus on hard numbers.",
  maxUrls=3,
  domains=["developers.cloudflare.com"]
)
```

### Comparing options

```text
intelli_research(
  query="Tailwind CSS vs Vanilla Extract comparison 2026",
  focusPrompt="Extract pros/cons, bundle size benchmarks, DX tradeoffs, and migration costs."
)
```

## Required API Keys

In `~/.pi/agent/auth.json`:

```json
{
  "openrouter": { "type": "api_key", "key": "sk-or-v1-..." },
  "minimax": { "type": "api_key", "key": "sk-api-..." }
}
```

- **OpenRouter** — used by `intelli_search` (Perplexity Sonar)
- **MiniMax** — used by `intelli_extract` and `intelli_collate` (MiniMax M2.7)

Run `/login` in pi to set up keys interactively, or edit the file directly.

## Pipeline

```
intelli_research(query)
  ├── Stage 1: Search  → Perplexity Sonar (via OpenRouter, pi native auth)
  ├── Stage 2: Fetch   → wreq-js + Defuddle, compared against raw markdown
  ├── Stage 3: Extract → MiniMax M2.7 per page (parallel)
  └── Stage 4: Collate → MiniMax M2.7 dedup + cache
```

Each page is dual-fetched (HTML → Defuddle vs markdown endpoint) and scored for quality. Per-page extraction compresses ~50K chars to ~3-5K of query-relevant content before collation, keeping the total context manageable (~32K for 8 pages).

For sites with `llms-full.txt` (Cloudflare, Next.js, Vite), the raw file is downloaded to the cache for offline grep — no LLM processing needed.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed design decisions.

## Cost

Per 8-page research session: **~$0.05**

| Step                        | Calls            | Cost    |
| --------------------------- | ---------------- | ------- |
| Search (Sonar)              | 1                | ~$0.02  |
| Fetch (Defuddle + markdown) | 8 parallel pairs | $0.00   |
| Extract (M2.7)              | 8 parallel       | ~$0.03  |
| Collate (M2.7)              | 1                | ~$0.005 |

## Settings

Override defaults in `~/.pi/agent/settings.json` or `.pi/settings.json`:

```jsonc
{
  "intelliSearchModel": {
    "provider": "openrouter",
    "model": "perplexity/sonar",
  },
  "intelliExtractModel": { "provider": "minimax", "model": "MiniMax-M2.7" },
  "intelliCollateModel": { "provider": "minimax", "model": "MiniMax-M2.7" },
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

## Cache Structure

```
.search/
├── 2026-04-19-d1-worker-api/
│   ├── report.md               # Collated summary + source index
│   ├── query.txt               # Original search query
│   ├── extractions/            # Per-page LLM extractions (~3-5K each)
│   │   ├── 01-developers-cloudflare-com.md
│   │   └── 02-developers-cloudflare-com.md
│   └── sources/                # Full page content
│       ├── 01-developers-cloudflare-com.md
│       ├── 02-developers-cloudflare-com.md
│       └── llms-full-developers-cloudflare-com.md
└── .index.json                 # Index of all cached searches
```

## Compatibility

- **pi ≥ 0.67.68** — core functionality (tools, model registration, settings)
- **pi ≥ 0.68.0** — custom working indicator, `after_provider_response` monitoring
- Gracefully degrades on older versions (optional features are skipped)

## Development

```bash
npm install
npm run build        # TypeScript → dist/
npm test             # Unit tests (70 tests)
npm run test:smoke   # Smoke test

# Test in pi
pi -e ./dist/index.js

# Install as package
pi install /path/to/pi-intelli-search
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — detailed design decisions and pipeline internals
- [Components](docs/COMPONENTS.md) — third-party dependencies and license attribution
- [Skill guide](skills/intelli-search/SKILL.md) — agent-facing usage instructions
- [Contributor guide](AGENTS.md) — coding conventions and project structure

## License

Copyright 2025 Ashraf Miah, Curio Data Pro Ltd.

Licensed under the [Apache License, Version 2.0](./LICENSE).
