# Architecture

This document describes the internal architecture of `pi-intelli-search`. It explains how the 5-stage pipeline works, why key decisions were made, and how each component fits together.

## Pipeline Overview

<p align="center">
  <img src="images/07B.png" alt="Vintage engraving-style infographic titled &quot;INTELLI_RESEARCH: The Five-Stage Pipeline,&quot; showing five sequentially linked numbered stages triggered by intelli_research(query): (1) Search: web discovery via Perplexity Sonar, OpenRouter/pi-native auth; (2) Fetch: dual fetch and quality comparison using wreq-js + Defuddle against raw markdown; (3) Extract: per-page parallel LLM extraction, default model MiniMax M2.7, configurable; (4) Collate: deduplication and persistent cache via MiniMax M2.7 (default, configurable), flags conflicts; (5) Cache Suggest: additive stage, LLM judge surfaces related prior searches. Stages are connected by bold arrows; each is illustrated with a period-appropriate vignette (armillary sphere, scrolls, alchemical still, filing cabinet, owl with documents)." width="800" />
</p>

No cross-tool invocation is used. `intelli_research` is self-contained, with the orchestrator executing its stages directly. Current `Pi` hosts support nested calls through `ctx.executeTool()`, but the pipeline does not depend on that newer capability. Direct stage execution preserves the supported native baseline and allows host-independent reuse. *The illustration above shows the default configuration; alternative search configurations use the same five-stage pipeline.*

### Why Per-Page Extraction Before Collation?

This is the key design decision. [Defuddle](https://github.com/kepano/defuddle) cleans HTML into clean Markdown, but a cleaned documentation page is still ≈50K characters. For 10 pages, that is ≈500K chars, far beyond what a collation call should carry. Per-page extraction reduces the material sent to collation, keeping context use and cost bounded across model choices.

Per-page extraction compresses each page independently to ≈3-5K of query-relevant content. The collation model then sees ≈40K total. This is comfortable for synthesis and deduplication. The optional `focusPrompt` parameter is most effective at this stage. "Extract only form validation patterns" applied to each page individually is far more targeted than asking a collation model to find those needles across 500K chars.

### Fetch Strategy: Compare, Don't Guess

Each page is fetched two ways in parallel:

1. **HTML to Defuddle:** Browser-grade TLS fingerprint plus Defuddle content extraction.
2. **Markdown endpoint:** `Accept: text/Markdown` header, `<link rel="alternate">`, or `.md` suffix.
3. **Compare quality:** Score on code blocks, headings, tables versus nav chrome noise. Pick the better one.

For sites that provide `llms-full.txt` ([Cloudflare](https://developers.cloudflare.com), [Next.js](https://nextjs.org), [Vite](https://vite.dev), and others), the raw file is downloaded to `sources/` alongside individual pages. No LLM processing is applied. The agent can grep or search it for offline lookup.

Dependency-specific console suppression uses async-local scopes and a single reference-counted dispatcher in `src/core/console.ts`. Console methods are patched only while a suppression region is active, then restored after the last region exits. Overlapping fetches cannot capture one another's diagnostic flags, and unrelated async work passes through. The fetch comparison emits no direct debug line; operation diagnostics use the injected logger. Native prefix formatting remains outside the core.

### Provider and Model Choices

All three pipeline stages (search, extract, collate) use independently configurable models. The defaults are:

- **Extract and Collate:** MiniMax M3 via [OpenRouter](https://openrouter.ai). MiniMax M3 is a reasoning model and requires a `reasoning` parameter. Every stage sends `reasoning: "low"` through `Pi`'s auth system: on `Pi` >= 0.86 via the `ctx.modelRegistry.streamSimple()` facade (which normalises the context so the system prompt reaches the model), on older versions via the provider's `streamSimple()`. Override `extractModel` or `collateModel` in the `pi-intelli-search` settings namespace to use any model `Pi` supports.
- **Search:** a search-grounded model. The default is [_Perplexity Sonar_](https://docs.perplexity.ai) via [OpenRouter](https://openrouter.ai), which returns a synthesised answer with inline citations. This is better than a bare URL list because the agent gets immediate context plus source URLs for follow-up. Two alternatives use the same account: `perplexity/sonar-pro-search` (a settings-only model swap), and the `searchWebSearch` setting, which attaches OpenRouter's `openrouter:web_search` server tool to any OpenRouter chat model through the provider's `onPayload` hook (distinct from the deprecated `:online` suffix and `plugins` configuration). Override `searchModel` in the `pi-intelli-search` settings namespace.

### Harvesting Citations from the Response Body

Search-grounded models attach machine-readable `url_citation` annotations to the assistant message, naming every source consulted. `Pi`'s chat-completions adapter reassembles only text, thinking, and tool-call blocks, so those annotations are dropped before extension code sees the response.

Rather than fork the adapter, the extension passes a wrapped `fetch` through `ProviderRequestOptions.fetch`. The wrapper tees each response body: the SDK consumes the original stream unchanged, while a clone is read in the background and parsed for citations (both SSE chunks and plain JSON). `response.clone()` is called synchronously before the SDK can touch the body. Every failure path in this side channel is swallowed by design: the pipeline must never depend on it. Each retry attempt owns a separate sink, so late citations from a failed attempt cannot contaminate a successful response. `callLlm()` awaits successful background reads (bounded at 2 seconds) before copying citations to the caller.

Merging is text-first: prose links (with their markdown titles) come before annotation-only URLs, and exact URL duplicates are removed. The search prompt asks the model to end with a Sources section so links reliably land in the text; the pipeline extracts URLs from the full text, then strips that rendered section before the summary flows downstream (collation input, `intelli_search` output), which renders its own canonical source list instead. This is not a new pipeline stage: harvesting belongs to search. See `src/core/annotations.ts`.

### Custom Model Registration

[_Perplexity Sonar_](https://docs.perplexity.ai) and its siblings are not in `Pi`'s built-in model list for [OpenRouter](https://openrouter.ai). The extension writes `perplexity/sonar`, `perplexity/sonar-pro`, and `perplexity/sonar-pro-search` to `~/.pi/agent/models.json` on first load (merging by id, non-destructive, adding only what is missing) and refreshes the model registry. This operation is idempotent.

### Rate-Limit Resilience

The extension monitors `after_provider_response` events to detect HTTP 429 (rate-limiting) and 5xx (server errors) from [OpenRouter](https://openrouter.ai). Rate-limit status appears in the `Pi` footer via `ctx.ui.setStatus()`, debounced to avoid flooding.

Recovery is owned by `runModelWithPolicy()` in `src/core/llm.ts`, which `callLlm()` invokes once around native dispatch. Native streams receive `maxRetries: 0` so software development kit (SDK) retries do not compound with the shared policy. The policy retries transient failures (429, 5xx, timeouts) with full-jitter exponential backoff that honours any Retry-After hint, bounded by `llmRetryAttempts`, `retryBaseDelayMs`, and `retryMaxDelayMs`. On the [OpenRouter](https://openrouter.ai) path a 429 does not arrive as a non-2xx status: the SDK throws after its retries and the stream resolves with `stopReason: "error"` carrying the status in `errorMessage`, which the retry classifier inspects. The `onResponse` callback only observes (it captures a Retry-After header) and never throws, because a throw would propagate out of the stream and bypass the retry loop.

A hard per-call timeout (`llmTimeoutMs`) is applied with an `AbortController` via `callWithAbortTimeout()`, combined with the tool signal so Esc still cancels. This is necessary because the SDK request timeout does not cover a stalled streaming body, which a provider can hold open after a 200 under load. Stage 1 additionally retries a degraded-200 search (a valid response with zero links) up to `searchRetryAttempts` times, and `minRequestIntervalMs` optionally spaces the concurrent extract calls for keys with tight rate limits. These configured retries and application timeouts apply inside `intelli_research`. Native standalone search, extract and collate retain one attempt without an application-level timeout. The pure helpers live in `src/core/util.ts` and are unit-tested. Only actual application timer expiry is classified as an application timeout; permanent provider exceptions are not retried as timeouts.

### Working Indicator and Progress Bar

During `intelli_research` execution, the extension sets a custom animated spinner (🔍 🌐 📄 ✨) via `ctx.ui.setWorkingIndicator()` (requires `Pi` 0.69.0+). This is restored to the default on completion or error.

In addition, the tool streams stage progress updates via `onUpdate()` and renders a progress bar in the tool output via `renderResult`. The progress bar shows overall completion, stage pills (✓/●/○), the current stage message, and a per-page sub-progress bar during extraction. The LLM receives structured `Stage X/5` prefixed text through `onUpdate` content. The `renderResult` function is a standard `Pi` tool API feature and requires no minimum version beyond what the extension already needs.

### Cache Suggest (Stage 5)

After the main pipeline completes, a lightweight LLM judge (using the extract model for cost efficiency) compares the current query against up to 20 recent entries in `.search/.index.json`. It returns semantically related previous searches, which are formatted as a `📚 Related cached searches` table appended to the tool output.

This stage is purely additive. It never blocks or replaces the live pipeline. Failures are caught and silently ignored. Cost is minimal (≈500 input tokens, or ≈$0.0002).

## Dependency Boundary

Native tools construct an explicit operation context through `src/native-operation-context.ts`, then invoke `src/core/operations/`. The core receives resolved settings, model client, workspace paths, package identity, cancellation, progress and diagnostics. It returns text, details and an explicit completed or degraded outcome. Native wrappers preserve existing result payloads, registry diagnostics and rendering.

Model calls pass through `src/native-model-client.ts` to `callLlm()`. The native transport owns authentication, provider hooks and legacy/facade dispatch; `src/core/llm.ts` owns the single retry/timeout policy. Host settings discovery and model registration stay outside the core. Canonical schemas and shared helpers live in the core, with forwarding exports at former paths.

Research dependencies are injected per operation rather than changed through a shared engine harness. The complete engine has no host imports; native callback and rendering types remain in `src/host-types.ts`. [Phase 2 Results](plans/mcp-intelli-search/PHASE-2.md) records verification and limits. The standalone package and server remain unimplemented.

## Source Code Structure

```
src/
├── index.ts              # Extension entry: registers tools, events, model setup
├── core/
│   ├── operations/         # Search, extract, collate and five-stage research
│   ├── contracts.ts        # Context, model, progress, result and identity contracts
│   ├── schemas.ts          # Canonical tool parameters
│   ├── llm.ts              # Shared retry, timeout and cancellation policy
│   ├── paths.ts            # Physical workspace roots and display policy
│   ├── fetch.ts            # Dual fetch and documentation downloads
│   ├── console.ts          # Async-scoped dependency diagnostic suppression
│   ├── cache.ts            # Artifacts, locks and index
│   ├── telemetry.ts        # Injected identity and local sidecar
│   ├── annotations.ts      # Citation harvesting
│   ├── messages.ts         # Prompt messages and cache appendices
│   ├── prompts.ts          # System prompts
│   ├── progress.ts         # Host-neutral pipeline progress
│   ├── types.ts            # Shared data types
│   └── util.ts             # Pure helpers and concurrency
├── native-operation-context.ts # Native context and result/progress mapping
├── native-model-client.ts  # Model adapter delegating to callLlm()
├── native-identity.ts      # Native manifest identity
├── agent-dir.ts            # Native host-directory discovery
├── host-types.ts           # Native callback, result and theme types
├── llm.ts                  # Native auth, dispatch and provider hooks
├── providers.ts            # Custom model registration
├── settings.ts             # Trusted host settings and migration
├── telemetry.ts            # Compatibility facade with native identity
├── cache.ts, fetch.ts, ... # Forwarding exports to shared helpers
└── tools/                  # Native registration, wrappers and rendering
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

### Physical and Display Paths

Both cache-writing tools resolve physical paths against the absolute session workspace, including the shared index and locks. `makeCachePath()` returns an absolute path. Prompts, result details, appendices and report headers use a separate display path, preserving native relative paths such as `.search/<slug>/`. Absolute and parent-relative native cache settings remain supported.

Documentation downloads stage in unique directories under the configured cache root's `.staging/`, not the operating-system temporary directory. Writers settle before unconditional cleanup, including cancellation and cache-write failure. Downloads occur outside cache locks. Optional staging setup or cleanup failure is logged and does not discard the completed research result. Failed cleanup can leave a staging directory; there is no automatic sweep. Stop all research processes using the cache before inspecting the logged path and removing an abandoned directory. Native absolute and parent-relative cache settings can place staging outside the workspace; standalone containment validation remains separate work.

### Telemetry Sidecar

Every `intelli_research` run writes a `meta.json` sidecar into its cache directory, including degraded runs that exit early (no links found, all fetches failed, all extractions failed). The `outcome` field records which exit path produced the file, so the analysis script can measure degradation rates, not just success. The schema is owned by `src/core/telemetry.ts` and is additive-only: future versions add optional fields and never rename or remove existing ones.

```jsonc
{
  "schemaVersion": 1,
  "extensionVersion": "0.13.0",
  "query": "...",
  "timestamp": "2026-06-25T12:00:00.000Z",
  "durationMs": 12345,
  "outcome": "completed",
  "stages": {
    "search": {
      "model": "...",
      "linksReturned": 10,
      "retryFired": false,
      "attempts": 1,
      "degraded": false,
      "annotationsHarvested": 20
    },
    "fetch": { "requested": 10, "succeeded": 8, "failed": 2, "winners": { "defuddle": 6, "markdown": 2 } },
    "extract": { "model": "...", "succeeded": 8, "failed": 0, "totalInputCharsApprox": 200000, "totalOutputChars": 16000 },
    "collate": { "model": "...", "summaryChars": 4000 },
    "cacheSuggest": { "ran": true, "surfaced": 2, "slugs": ["..."] }
  }
}
```

`outcome` is one of `completed`, `no-links`, `fetch-failed`, or `extraction-failed`. `schemaVersion` is decoupled from `extensionVersion` so consumers can branch on payload shape without parsing the product semver. `stages.extract.totalInputCharsApprox` is a lower bound: it sums the truncated page content fed to extraction and excludes the per-call wrapper text, so it understates real input; relative comparisons across runs remain valid. `stages.search.annotationsHarvested` counts `url_citation` entries recovered from the response body; it can include URLs already present in the text and URLs beyond the fetch limit, so it is not the number of extra pages fetched. A zero count does not prove no live search occurred: the field is absent on runs against models that emit no annotations. Standalone `intelli_search` calls do not write this sidecar.

The file is written atomically (temp file then `rename`) so a crash never leaves a partial `meta.json`, and a best-effort sweep cleans up any `.tmp` orphan left by a prior crashed write. The write is fail-safe: failures are caught and logged, never surfacing to the pipeline result or the agent.

The adapter supplies package identity; the core never discovers a manifest relative to its own module. `extensionVersion` retains the emitting adapter version. Native records keep their existing shape, while non-native records add optional `packageName` and `adapter` fields. This is strictly local telemetry. No network call is added, no data leaves the host, and no account or personal identity is recorded. Set `disableTelemetry: true` to suppress the sidecar entirely. The bundled `scripts/analyze-sessions.sh` aggregates sidecars across projects to report per-stage success rates.

## Cost Estimate

The canonical, current cost estimate lives in the README [Cost](../README.md#cost) section so model and engine changes require one edit, not two; alternative search configurations are itemised in the README's [Choosing an Alternative Search Configuration](../README.md#choosing-an-alternative-search-configuration) table.
