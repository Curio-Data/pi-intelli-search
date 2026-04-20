# pi-web-research

A Pi extension for web research: search, fetch, extract, collate, and cache — in one tool call.

## Tools

| Tool | Description |
|------|-------------|
| `web_search` | Search via Perplexity Sonar. Returns summary + source URLs. |
| `web_extract` | Per-page LLM extraction. Reduces ~50K chars → ~3-5K of relevant content. |
| `web_collate` | Deduplicate and synthesise extractions into a summary + cache. |
| `web_research` | Full pipeline: search → fetch → extract → collate → cache. One call. |

## Installation

```bash
pi install /path/to/pi-web-research
```

On first load, the extension adds Perplexity Sonar models to `~/.pi/agent/models.json` under the `openrouter` provider.

## Required API keys

In `~/.pi/agent/auth.json`:

```json
{
  "openrouter": { "type": "api_key", "key": "sk-or-v1-..." },
  "minimax":    { "type": "api_key", "key": "sk-api-..." }
}
```

- **OpenRouter** — used by `web_search` (Perplexity Sonar)
- **MiniMax** — used by `web_extract` and `web_collate` (MiniMax M2.7)

## Architecture

### Pipeline

```
web_research(query)
  ├── Stage 1: Search → Perplexity Sonar (via OpenRouter, pi native auth)
  ├── Stage 2: Fetch  → wreq-js + Defuddle, compared against raw markdown
  ├── Stage 3: Extract → MiniMax M2.7 per page (parallel, via native minimax provider)
  └── Stage 4: Collate → MiniMax M2.7 dedup + cache
```

No cross-tool invocation. `web_research` is self-contained.

### Fetch strategy: compare, don't guess

Each page is fetched two ways in parallel:

1. **HTML → Defuddle** — browser-grade TLS fingerprint, Defuddle content extraction
2. **Markdown endpoint** — `Accept: text/markdown` header, `<link rel="alternate">`, or `.md` suffix
3. **Compare quality** — score on code blocks, headings, tables vs. nav chrome noise. Pick the better one.

For sites that provide `llms-full.txt` (Cloudflare, Next.js, Vite, etc.), the raw file is downloaded to `sources/` alongside individual pages. No LLM processing — the agent can grep/search it for offline lookup.

### Why MiniMax direct instead of via OpenRouter

MiniMax M2.7 is a reasoning model. When called via OpenRouter's OpenAI-compatible endpoint, `complete()` doesn't send the required reasoning parameters, causing `400 Reasoning is mandatory`. The fix:

- Use `completeSimple()` with `reasoning: "low"` instead of `complete()`
- Route through the native `minimax` provider (Anthropic-messages API) which handles reasoning correctly

### Why extract before collate?

8 pages × ~50K = ~400K chars — too large for a single context. Per-page extraction compresses each to ~3-5K, so the collation model sees ~32K total — comfortable for synthesis.

### Custom model registration

Perplexity Sonar isn't in pi's built-in model list for OpenRouter. The extension writes it to `~/.pi/agent/models.json` on first load and refreshes the model registry. This is idempotent.

## Settings

Override defaults in `~/.pi/agent/settings.json`:

```jsonc
{
  "webResearchSearchModel":       { "provider": "openrouter", "model": "perplexity/sonar" },
  "webResearchExtractModel":      { "provider": "minimax", "model": "MiniMax-M2.7" },
  "webResearchCollateModel":      { "provider": "minimax", "model": "MiniMax-M2.7" },
  "webResearchMaxUrls":           8,
  "webResearchCacheDir":          ".search",
  "webResearchExtractMaxChars":   150000
}
```

## Cache structure

```
.search/
├── 2026-04-19-d1-worker-api/
│   ├── report.md                              # Collated summary + source index
│   ├── query.txt                              # Original search query
│   ├── extractions/                           # Per-page LLM extractions (~3-5K each)
│   │   ├── 01-developers-cloudflare-com.md    # M2.7 extraction: query-relevant only
│   │   └── 02-developers-cloudflare-com.md
│   └── sources/                               # Full content
│       ├── 01-developers-cloudflare-com.md    # Defuddle OR raw markdown (whichever scored higher)
│       ├── 02-developers-cloudflare-com.md
│       └── llms-full-developers-cloudflare-com.md   # Raw site-wide llms-full.txt (auto-dl)
└── .index.json                                # Index of all cached searches
```

The `sources/` directory contains the raw page content — either the winning Defuddle/markdown comparison, or the full `llms-full.txt` if the site provides one. The agent can read individual extractions for a quick refresher, or grep the llms-full.txt for offline search.

## Cost estimate

Per 8-page research session: **~$0.05**

| Step | Calls | Cost |
|------|-------|------|
| Search (Sonar) | 1 | ~$0.02 |
| Fetch (Defuddle + markdown) | 8 parallel pairs | $0.00 |
| Extract (M2.7) | 8 parallel | ~$0.03 |
| Collate (M2.7) | 1 | ~$0.005 |

## Development

```bash
cd pi-web-research
npm install
npm run build        # TypeScript → dist/

# Test in pi
pi -e ./dist/index.js

# Install as package
pi install /path/to/pi-web-research
```

## Dependencies

| Package | Why |
|---------|-----|
| `wreq-js` | Browser-grade TLS/HTTP fingerprinting (anti-bot) |
| `defuddle` | Content extraction (modern Readability replacement) |
| `linkedom` | Lightweight DOM for Defudder |
| `@sinclair/typebox` | Schema definitions for tool parameters |
