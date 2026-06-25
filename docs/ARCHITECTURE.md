# Architecture

This document describes the internal architecture of `pi-intelli-search`. It explains how the 5-stage pipeline works, why key decisions were made, and how each component fits together.

## Pipeline Overview

<p align="center">
  <img src="images/07B.png" alt="Vintage engraving-style infographic titled &quot;INTELLI_RESEARCH: The Five-Stage Pipeline,&quot; showing five sequentially linked numbered stages triggered by intelli_research(query): (1) Search: web discovery via Perplexity Sonar, OpenRouter/pi-native auth; (2) Fetch: dual fetch and quality comparison using wreq-js + Defuddle against raw markdown; (3) Extract: per-page parallel LLM extraction, default model MiniMax M2.7, configurable; (4) Collate: deduplication and persistent cache via MiniMax M2.7 (default, configurable), flags conflicts; (5) Cache Suggest: additive stage, LLM judge surfaces related prior searches. Stages are connected by bold arrows; each is illustrated with a period-appropriate vignette (armillary sphere, scrolls, alchemical still, filing cabinet, owl with documents)." width="800" />
</p>

No cross-tool invocation is used. `intelli_research` is self-contained. `Pi` extensions cannot call other tools from within `execute()`, so the orchestrator inlines all four stages.

### Why Per-Page Extraction Before Collation?

This is the key design decision. [Defuddle](https://github.com/kepano/defuddle) cleans HTML into clean Markdown, but a cleaned documentation page is still ≈50K characters. For 8 pages, that is ≈400K chars. This is too large for a single LLM context.

Per-page extraction compresses each page independently to ≈3-5K of query-relevant content. The collation model then sees ≈32K total. This is comfortable for synthesis and deduplication. The optional `focusPrompt` parameter is most effective at this stage. "Extract only form validation patterns" applied to each page individually is far more targeted than asking a collation model to find those needles across 400K chars.

### Fetch Strategy: Compare, Don't Guess

Each page is fetched two ways in parallel:

1. **HTML to Defuddle:** Browser-grade TLS fingerprint plus Defuddle content extraction.
2. **Markdown endpoint:** `Accept: text/Markdown` header, `<link rel="alternate">`, or `.md` suffix.
3. **Compare quality:** Score on code blocks, headings, tables versus nav chrome noise. Pick the better one.

For sites that provide `llms-full.txt` ([Cloudflare](https://developers.cloudflare.com), [Next.js](https://nextjs.org), [Vite](https://vite.dev), and others), the raw file is downloaded to `sources/` alongside individual pages. No LLM processing is applied. The agent can grep or search it for offline lookup.

### Provider and Model Choices

All three pipeline stages (search, extract, collate) use independently configurable models. The defaults are:

- **Extract and Collate:** MiniMax M2.7 via [OpenRouter](https://openrouter.ai). MiniMax M2.7 is a reasoning model and requires a `reasoning` parameter. The extension uses `completeSimple()` with `reasoning: "low"`, which sends the required parameter through OpenRouter's endpoint. Override `extractModel` or `collateModel` in the `pi-intelli-search` settings namespace to use any model `Pi` supports.
- **Search:** [_Perplexity Sonar_](https://docs.perplexity.ai) via [OpenRouter](https://openrouter.ai). _Sonar_ returns a synthesised answer with inline citations. This is better than a bare URL list because the agent gets immediate context plus source URLs for follow-up. Override `searchModel` in the `pi-intelli-search` settings namespace.

### Custom Model Registration

[Perplexity Sonar](https://docs.perplexity.ai) is not in `Pi`'s built-in model list for [OpenRouter](https://openrouter.ai). The extension writes it to `~/.pi/agent/models.json` on first load (merges by id, non-destructive) and refreshes the model registry. This operation is idempotent.

### Rate-Limit Resilience

The extension monitors `after_provider_response` events to detect HTTP 429 (rate-limiting) and 5xx (server errors) from [OpenRouter](https://openrouter.ai). Rate-limit status appears in the `Pi` footer via `ctx.ui.setStatus()`, debounced to avoid flooding.

Recovery is owned by `callLlm()`, not the underlying SDK. It passes `maxRetries: 0` to `completeSimple()` so SDK retries do not compound with ours, then retries transient failures (429, 5xx, timeouts) with full-jitter exponential backoff that honours any Retry-After hint, bounded by `llmRetryAttempts`, `retryBaseDelayMs`, and `retryMaxDelayMs`. On the [OpenRouter](https://openrouter.ai) path a 429 does not arrive as a non-2xx status: the SDK throws after its retries and `completeSimple()` resolves with `stopReason: "error"` carrying the status in `errorMessage`, which the retry classifier inspects. The `onResponse` callback only observes (it captures a Retry-After header) and never throws, because a throw would propagate out of `completeSimple()` and bypass the retry loop.

A hard per-call timeout (`llmTimeoutMs`) is applied with an `AbortController` via `callWithAbortTimeout()`, combined with the tool signal so Esc still cancels. This is necessary because the SDK request timeout does not cover a stalled streaming body, which a provider can hold open after a 200 under load. Stage 1 additionally retries a degraded-200 search (a valid response with zero links) up to `searchRetryAttempts` times, and `minRequestIntervalMs` optionally spaces the concurrent extract calls for keys with tight rate limits. The pure helpers live in `util.ts` and are unit-tested.

### Working Indicator and Progress Bar

During `intelli_research` execution, the extension sets a custom animated spinner (🔍 🌐 📄 ✨) via `ctx.ui.setWorkingIndicator()` (requires `Pi` 0.69.0+). This is restored to the default on completion or error. On older `Pi` versions, the call is silently skipped.

In addition, the tool streams stage progress updates via `onUpdate()` and renders a progress bar in the tool output via `renderResult`. The progress bar shows overall completion, stage pills (✓/●/○), the current stage message, and a per-page sub-progress bar during extraction. The LLM receives structured `Stage X/5` prefixed text through `onUpdate` content. The `renderResult` function is a standard `Pi` tool API feature and requires no minimum version beyond what the extension already needs.

### Cache Suggest (Stage 5)

After the main pipeline completes, a lightweight LLM judge (using the extract model for cost efficiency) compares the current query against up to 20 recent entries in `.search/.index.json`. It returns semantically related previous searches, which are formatted as a `📚 Related cached searches` table appended to the tool output.

This stage is purely additive. It never blocks or replaces the live pipeline. Failures are caught and silently ignored. Cost is minimal (≈500 input tokens, or ≈$0.0002).

## Source Code Structure

```
src/
├── index.ts              # Extension entry: registers tools, events, model setup
├── llm.ts                # callLlm() - pi native auth + retry/backoff + per-call timeout
├── fetch.ts              # Page fetching: Defuddle vs Markdown comparison, llms-full.txt
├── prompts.ts            # System prompts for search, extraction, collation
├── providers.ts          # Custom model registration (Sonar) into models.json
├── settings.ts           # Settings loader with caching and invalidation
├── cache.ts              # .search/ cache read/write and index management
├── types.ts              # Shared TypeScript interfaces
├── util.ts               # URL extraction, inference, concurrency + retry/backoff/timeout/throttle helpers
└── tools/
    ├── intelli-research.ts   # Full pipeline orchestrator (5 stages)
    ├── intelli-search.ts     # Standalone search via Perplexity Sonar
    ├── intelli-extract.ts    # Standalone per-page LLM extraction
    └── intelli-collate.ts    # Standalone collation + cache write
```

## Cache Structure

```
.search/
├── 2026-04-19-d1-worker-api-3f7a2c/
│   ├── report.md                              # Collated summary + source index
│   ├── query.txt                              # Original search query
│   ├── meta.json                              # Local-only telemetry sidecar (v0.11.0+)
│   ├── extractions/                           # Per-page LLM extractions (≈3-5K each)
│   │   ├── 01-developers-cloudflare-com.md
│   │   └── 02-developers-cloudflare-com.md
│   └── sources/                               # Full content
│       ├── 01-developers-cloudflare-com.md    # Defuddle OR raw Markdown (best score)
│       ├── 02-developers-cloudflare-com.md
│       └── llms-full-developers-cloudflare-com.md   # Raw llms-full.txt (auto-downloaded)
└── .index.json                                # Index of all cached searches
```

Each cached session lives in a directory named `<date>-<slug>-<hash>`. The `<hash>` is a short SHA-1 of the full query, appended so that distinct queries issued on the same day do not collide and overwrite each other. The same query always produces the same hash, so re-running it refreshes the same directory instead of accumulating duplicates.

### Telemetry Sidecar

Each `intelli_research` run writes a `meta.json` sidecar into its cache directory. The schema is owned by `src/telemetry.ts` and is additive-only: future versions add optional fields and never rename or remove existing ones.

```jsonc
{
  "schemaVersion": 1,
  "extensionVersion": "0.11.0",
  "query": "...",
  "timestamp": "2026-06-25T12:00:00.000Z",
  "durationMs": 12345,
  "stages": {
    "search": { "model": "...", "linksReturned": 5, "retryFired": false, "attempts": 1 },
    "fetch": { "requested": 5, "succeeded": 4, "failed": 1, "winners": { "defuddle": 3, "markdown": 1 } },
    "extract": { "model": "...", "succeeded": 4, "failed": 0, "totalInputChars": 200000, "totalOutputChars": 16000 },
    "collate": { "model": "...", "summaryChars": 4000 },
    "cacheSuggest": { "ran": true, "surfaced": 2, "slugs": ["..."] }
  }
}
```

`schemaVersion` is decoupled from `extensionVersion` so consumers can branch on payload shape without parsing the product semver. The file is written atomically (temp file then `rename`) so a crash never leaves a partial `meta.json`. The write is fail-safe: failures are caught and logged, never surfacing to the pipeline result or the agent.

This is strictly local telemetry. No network call is added, no data leaves the host, and no account or identity is recorded. Set `disableTelemetry: true` to suppress the sidecar entirely. The bundled `scripts/analyze-sessions.sh` aggregates sidecars across projects to report per-stage success rates.

## Cost Estimate

Per research session with the default 8 pages: **≈$0.05**

| Step | Calls | Cost |
|------|-------|------|
| Search (Sonar) | 1 | ≈$0.02 |
| Fetch (Defuddle + Markdown) | 8 (≤4 concurrent) pairs | $0.00 |
| Extract (M2.7) | 8 (≤4 concurrent) | ≈$0.03 |
| Collate (M2.7) | 1 | ≈$0.005 |
| Cache suggest (M2.7) | 1 | ≈$0.0002 |
