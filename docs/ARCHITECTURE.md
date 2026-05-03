# Architecture

This document describes the internal architecture of `pi-intelli-search` — how the 5-stage pipeline works, why key decisions were made, and how each component fits together.

## Pipeline Overview

```
intelli_research(query)
  ├── Stage 1: Search  → Perplexity Sonar (via OpenRouter, pi native auth)
  ├── Stage 2: Fetch   → wreq-js + Defuddle, compared against raw markdown
  ├── Stage 3: Extract → configurable model, default: MiniMax M2.7 per page (parallel)
  ├── Stage 4: Collate → configurable model, default: MiniMax M2.7 dedup + cache
  └── Stage 5: Cache suggest → LLM judge finds related previous searches (additive)
```

No cross-tool invocation. `intelli_research` is self-contained — Pi extensions cannot call other tools from within `execute()`, so the orchestrator inlines all four stages.

### Why per-page extraction before collation?

This is the key design decision. Defuddle cleans HTML into clean markdown, but a cleaned documentation page is still ~50K characters. For 8 pages, that's ~400K chars — too large for a single LLM context.

Per-page extraction compresses each page independently to ~3-5K of query-relevant content. The collation model then sees ~32K total — comfortable for synthesis and deduplication. The optional `focusPrompt` parameter is most effective at this stage: "Extract only form validation patterns" applied to each page individually is far more targeted than asking a collation model to find those needles across 400K chars.

### Fetch strategy: compare, don't guess

Each page is fetched two ways in parallel:

1. **HTML → Defuddle** — browser-grade TLS fingerprint, Defuddle content extraction
2. **Markdown endpoint** — `Accept: text/markdown` header, `<link rel="alternate">`, or `.md` suffix
3. **Compare quality** — score on code blocks, headings, tables vs. nav chrome noise. Pick the better one.

For sites that provide `llms-full.txt` (Cloudflare, Next.js, Vite, etc.), the raw file is downloaded to `sources/` alongside individual pages. No LLM processing — the agent can grep/search it for offline lookup.

### Provider and model choices

All three pipeline stages (search, extract, collate) use independently configurable models. The defaults are:

- **Extract/Collate**: MiniMax M2.7 direct (not via OpenRouter). MiniMax M2.7 is a reasoning model. When called via OpenRouter's OpenAI-compatible endpoint, `complete()` doesn't send the required reasoning parameters, causing `400 Reasoning is mandatory`. The extension uses `completeSimple()` with `reasoning: "low"` through the native `minimax` provider, which handles reasoning parameters correctly. Override with `intelliExtractModel`/`intelliCollateModel` in settings to use any model pi supports.
- **Search**: Perplexity Sonar via OpenRouter. Sonar returns a synthesised answer with inline citations — better than a bare URL list because the agent gets immediate context plus source URLs for follow-up. Override with `intelliSearchModel` in settings.

### Custom model registration

Perplexity Sonar isn't in pi's built-in model list for OpenRouter. The extension writes it to `~/.pi/agent/models.json` on first load (merges by id, non-destructive) and refreshes the model registry. This is idempotent.

### Rate-limit monitoring

The extension monitors `after_provider_response` events to detect HTTP 429 (rate-limiting) and 5xx (server errors) from OpenRouter and MiniMax. Rate-limit status appears in the pi footer via `ctx.ui.setStatus()`, debounced to avoid flooding. The `callLlm()` helper also uses an `onResponse` callback to throw immediately on 429/5xx before the response stream is consumed, providing actionable retry guidance.

### Working indicator

During `intelli_research` execution, the extension sets a custom animated spinner (🔍 🌐 📄 ✨) via `ctx.ui.setWorkingIndicator()` (pi 0.69.0+). This is restored to the default on completion or error. On older pi versions, the call is silently skipped.

### Cache suggest (Stage 5)

After the main pipeline completes, a lightweight LLM judge (using the extract model for cost efficiency) compares the current query against up to 20 recent entries in `.search/.index.json`. It returns semantically related previous searches, which are formatted as a `📚 Related cached searches` table appended to the tool output.

This stage is purely additive — it never blocks or replaces the live pipeline. Failures are caught and silently ignored. Cost is minimal (~500 input tokens, ~$0.0002).

## Source Code Structure

```
src/
├── index.ts              # Extension entry: registers tools, events, model setup
├── llm.ts                # callLlm() — pi native auth + rate-limit detection
├── fetch.ts              # Page fetching: Defuddle vs markdown comparison, llms-full.txt
├── prompts.ts            # System prompts for search, extraction, collation
├── providers.ts          # Custom model registration (Sonar) into models.json
├── settings.ts           # Settings loader with caching and invalidation
├── cache.ts              # .search/ cache read/write and index management
├── types.ts              # Shared TypeScript interfaces
├── util.ts               # URL extraction, source type inference, helpers
└── tools/
    ├── intelli-research.ts   # Full pipeline orchestrator (5 stages)
    ├── intelli-search.ts     # Standalone search via Perplexity Sonar
    ├── intelli-extract.ts    # Standalone per-page LLM extraction
    └── intelli-collate.ts    # Standalone collation + cache write
```

## Cache Structure

```
.search/
├── 2026-04-19-d1-worker-api/
│   ├── report.md                              # Collated summary + source index
│   ├── query.txt                              # Original search query
│   ├── extractions/                           # Per-page LLM extractions (~3-5K each)
│   │   ├── 01-developers-cloudflare-com.md
│   │   └── 02-developers-cloudflare-com.md
│   └── sources/                               # Full content
│       ├── 01-developers-cloudflare-com.md    # Defuddle OR raw markdown (best score)
│       ├── 02-developers-cloudflare-com.md
│       └── llms-full-developers-cloudflare-com.md   # Raw llms-full.txt (auto-downloaded)
└── .index.json                                # Index of all cached searches
```

## Cost Estimate

Per 8-page research session with default models: **~$0.05**

| Step | Calls | Cost |
|------|-------|------|
| Search (Sonar) | 1 | ~$0.02 |
| Fetch (Defuddle + markdown) | 8 parallel pairs | $0.00 |
| Extract (M2.7) | 8 parallel | ~$0.03 |
| Collate (M2.7) | 1 | ~$0.005 |
| Cache suggest (M2.7) | 1 | ~$0.0002 |
