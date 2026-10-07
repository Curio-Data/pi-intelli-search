# Architecture

This document describes the shared `intelli-search` engine and its two adapters. It explains how the 5-stage pipeline works, why key decisions were made, and how each component fits together.

## Engine and Adapters

- **Shared Engine:** `src/core/` owns the operations, cache formats, prompts and single model retry/timeout policy. Adapters supply resolved settings, model calls, workspace paths, identity, progress, cancellation and diagnostics.
- **Native `Pi` Adapter:** `src/index.ts`, `src/tools/` and the native context/model modules register tools through `Pi`'s application programming interface (API), discover trusted settings, and use its authentication and model registry.
- **Standalone MCP Adapter:** `packages/mcp/` supplies explicit configuration, environment-referenced credentials, an [_OpenRouter_](https://openrouter.ai) transport and Model Context Protocol (MCP) serving over standard input/output (stdio). It imports no `Pi` runtime libraries. Generated host plugins launch this adapter; they contain no pipeline code.

## Pipeline Overview

<p align="center">
  <img src="images/07B.png" alt="Vintage engraving-style infographic titled &quot;INTELLI_RESEARCH: The Five-Stage Pipeline,&quot; showing five sequentially linked numbered stages triggered by intelli_research(query): (1) Search: web discovery via Perplexity Sonar, OpenRouter/pi-native auth; (2) Fetch: dual fetch and quality comparison using wreq-js + Defuddle against raw markdown; (3) Extract: per-page parallel LLM extraction, MiniMax M2.7, the native model configuration at the illustration's creation; (4) Collate: deduplication and persistent cache via MiniMax M2.7 (the native configuration at creation), flags conflicts; (5) Cache Suggest: additive stage, LLM judge surfaces related prior searches. Stages are connected by bold arrows; each is illustrated with a period-appropriate vignette (armillary sphere, scrolls, alchemical still, filing cabinet, owl with documents)." width="800" />
</p>

No cross-tool invocation is used. `intelli_research` is self-contained, with the orchestrator executing its stages directly. Current `Pi` hosts support nested calls through `ctx.executeTool()`, but the pipeline does not depend on that newer capability. Direct stage execution preserves the supported native baseline and allows host-independent reuse. *The illustration shows the native pipeline with the model configuration at its creation, including [_MiniMax_](https://minimax.io) M2.7 and `Pi` authentication. It does not show the current defaults or standalone authentication; alternative search configurations use the same five-stage pipeline.*

<a id="why-per-page-extraction-before-collation"></a>
### Per-Page Extraction Before Collation

[_Defuddle_](https://github.com/kepano/defuddle) cleans Hypertext Markup Language (HTML) into clean Markdown, but a cleaned documentation page is still ≈50K characters. For 10 pages, that is ≈500K chars, far beyond what a collation call should carry. Per-page extraction reduces the material sent to collation, keeping context use and cost bounded across model choices.

Per-page extraction compresses each page independently to ≈3-5K characters of query-relevant content. The collation model then sees ≈40K total. This is comfortable for synthesis and deduplication. The optional `focusPrompt` parameter is most effective at this stage. "Extract only form validation patterns" applied to each page individually is far more targeted than asking a collation model to select that content from 500K chars.

<a id="fetch-strategy-compare-dont-guess"></a>
### Fetch Variant Selection

Each page is fetched two ways in parallel:

1. **HTML to Defuddle:** Browser-grade Transport Layer Security (TLS) fingerprint plus Defuddle content extraction.
2. **Markdown endpoint:** `Accept: text/Markdown` header, `<link rel="alternate">`, or `.md` suffix.
3. **Compare quality:** Score on code blocks, headings, tables versus nav chrome noise. Pick the better one.

For sites that provide `llms-full.txt` ([Cloudflare](https://developers.cloudflare.com), [Next.js](https://nextjs.org), [Vite](https://vite.dev), and others), the raw file is downloaded to `sources/` alongside individual pages. No large language model (LLM) processing is applied. The agent can grep or search it for offline lookup.

Dependency-specific console suppression uses async-local scopes and a single reference-counted dispatcher in `src/core/console.ts`. Console methods are patched only while a suppression region is active, then restored after the last region exits. Overlapping fetches cannot capture one another's diagnostic flags, and unrelated async work passes through. The fetch comparison emits no direct debug line; operation diagnostics use the injected logger. Native prefix formatting remains outside the core.

<a id="provider-and-model-choices"></a>
### Native Models and Authentication

All three model stages (search, extract, collate) use independently configurable models. The following defaults and authentication paths belong to the native `Pi` adapter:

- **Extract and Collate:** [_MiniMax_](https://minimax.io) M3 via [_OpenRouter_](https://openrouter.ai). Native model calls default to `reasoning: "low"`, with the configured `searchWebSearch.reasoning` override on search-tool calls. Authentication and dispatch use `Pi`'s system: on `Pi` >= 0.86 via the `ctx.modelRegistry.streamSimple()` facade (which normalises the context so the system prompt reaches the model), on older supported versions via the provider's `streamSimple()`. Override `extractModel` or `collateModel` in the `pi-intelli-search` settings namespace to select another registered, authenticated text model with suitable context and capabilities.
- **Search:** a search-grounded model. The default is [_Perplexity Sonar_](https://docs.perplexity.ai) via [OpenRouter](https://openrouter.ai), which returns a synthesised answer with inline citations. This is better than a bare URL (uniform resource locator) list because the agent gets immediate context plus source URLs for follow-up. Two alternatives use the same account: `perplexity/sonar-pro-search` (a settings-only model swap), and the `searchWebSearch` setting, which attaches OpenRouter's `openrouter:web_search` server tool to an OpenRouter chat model with the required tool support through the provider's `onPayload` hook (distinct from the deprecated `:online` suffix and `plugins` configuration). Override `searchModel` in the `pi-intelli-search` settings namespace.

<a id="harvesting-citations-from-the-response-body"></a>
### Native Citation Harvesting

Search-grounded models attach machine-readable `url_citation` annotations to the assistant message, identifying cited sources. Recognised annotations can increase the candidate source set, but neither their presence nor harvesting establishes every source consulted. `Pi`'s chat-completions adapter reassembles only text, thinking, and tool-call blocks, so those annotations are dropped before extension code sees the response.

Rather than fork the adapter, the extension passes a wrapped `fetch` through `ProviderRequestOptions.fetch`. The wrapper tees each response body: the software development kit (SDK) consumes the original stream unchanged, while a clone is read in the background and parsed for citations (both server-sent event (SSE) chunks and plain JavaScript Object Notation (JSON)). `response.clone()` is called synchronously before the SDK can touch the body. Every failure path in this side channel is swallowed by design: the pipeline must never depend on it. Each retry attempt owns a separate sink, so late citations from a failed attempt cannot contaminate a successful response. `callLlm()` awaits successful background reads (bounded at 2 seconds) before copying citations to the caller.

Merging is text-first: prose links (with their Markdown titles) come before annotation-only URLs, and exact URL duplicates are removed. The search prompt asks the model to end with a Sources section. The shared search operation extracts URLs from the full response, then removes the model-rendered Sources section before passing the summary downstream. The `intelli_search` result builder renders a canonical source list. Research uses the stripped search summary for degraded results, but completed collation receives only successful, non-empty extractions. Search-only claims and cache paths are excluded from the collation input. This is not a new pipeline stage: harvesting belongs to search. See `src/core/annotations.ts`.

<a id="custom-model-registration"></a>
### Native Model Registration

[_Perplexity Sonar_](https://docs.perplexity.ai) and its siblings are not in `Pi`'s built-in model list for [OpenRouter](https://openrouter.ai). The extension writes `perplexity/sonar`, `perplexity/sonar-pro`, and `perplexity/sonar-pro-search` to `~/.pi/agent/models.json` on first load (merging by id, non-destructive, adding only what is missing) and refreshes the model registry. This operation is idempotent. Invalid or unreadable existing files are preserved and reported rather than replaced. Valid merges retain existing overrides, follow valid operator-managed symlinks, and use a short lock and atomic replacement.

<a id="rate-limit-resilience"></a>
### Native Rate-Limit Resilience

The extension monitors `after_provider_response` events to detect Hypertext Transfer Protocol (HTTP) `429` (rate-limiting) and 5xx (server errors) from [OpenRouter](https://openrouter.ai). Rate-limit status appears in the `Pi` footer via `ctx.ui.setStatus()`, debounced to avoid flooding.

Recovery is owned by `runModelWithPolicy()` in `src/core/llm.ts`, which `callLlm()` invokes once around native dispatch. Native streams receive `maxRetries: 0` so SDK retries do not compound with the shared policy. The policy retries transient failures (429, 5xx, timeouts) with full-jitter exponential backoff that honours any Retry-After hint, bounded by `llmRetryAttempts`, `retryBaseDelayMs`, and `retryMaxDelayMs`. On the [OpenRouter](https://openrouter.ai) path a 429 does not arrive as a non-2xx status: the SDK throws after its retries and the stream resolves with `stopReason: "error"` carrying the status in `errorMessage`, which the retry classifier inspects. The `onResponse` callback only observes (it captures a Retry-After header) and never throws, because a throw would propagate out of the stream and bypass the retry loop.

A hard per-call timeout (`llmTimeoutMs`) is applied with an `AbortController` via `callWithAbortTimeout()`, combined with the tool signal so Esc still cancels. This is necessary because the SDK request timeout does not cover a stalled streaming body, which a provider can hold open after a 200 under load. Stage 1 additionally retries a degraded-200 search (a valid response with zero links) up to `searchRetryAttempts` times, and `minRequestIntervalMs` optionally spaces the concurrent extract calls for keys with tight rate limits. These configured retries and application timeouts apply inside `intelli_research`. Native standalone search, extract and collate retain one attempt without an application-level timeout. The pure helpers live in `src/core/util.ts` and are unit-tested. Only actual application timer expiry is classified as an application timeout; permanent provider exceptions are not retried as timeouts.

<a id="working-indicator-and-progress-bar"></a>
### Native Working Indicator and Progress Bar

During `intelli_research` execution, the extension sets a custom animated spinner (🔍 🌐 📄 ✨) via `ctx.ui.setWorkingIndicator()` (requires `Pi` 0.69.0+). This is restored to the default on completion or error.

In addition, the tool streams stage progress updates via `onUpdate()` and renders a progress bar in the tool output via `renderResult`. The progress bar shows overall completion, stage pills (✓/●/○), the current stage message, and a per-page sub-progress bar during extraction. The LLM receives structured `Stage X/5` prefixed text through `onUpdate` content. The `renderResult` function is a standard `Pi` tool API feature and requires no minimum version beyond what the extension already needs.

### Collation Evidence

`src/core/provenance.ts` builds the Source Assessment inventory from the successful extraction set and the same `SourceIdentity` used for cache writes. The model receives source IDs, page metadata and extracted content as JavaScript Object Notation (JSON), and returns synthesis only. It does not generate source inventories, relevance ratings or cache-file paths. Source IDs in prose, including grouped references, must resolve to evidence entries. Prose URLs must occur in the supplied extraction content or identify an evidence page; fragments and trailing-slash differences are accepted, but different hosts, schemes or query parameters are not merged. Cross-links remain content, not additional fetched sources. Model-generated numbered cache references and source inventories are rejected. Fenced, indented and inline code examples are preserved as data; ordinary project filenames such as `report.md` are not treated as cache declarations. These are reference checks, not proof that every factual claim is correct or grounded.

Validation runs before rotation, downloads or cache writes. A failed collation preserves any prior report and index and raises an actionable error. Empty research extractions count as failures. Manual collation rejects an empty evidence set and duplicate extraction URLs, labels successful evidence as caller-supplied and marks absent full pages `Not cached`. Its optional `searchSummary` field remains accepted but does not enter synthesis. Native and MCP tools retain their input parameters; the `searchSummary` description now discloses that it is not synthesis evidence. The internal collation prompt and generated report prose intentionally change. Operation reports contain one Source Assessment inventory; the low-level report writer retains its legacy index only for callers that do not supply an inventory. `collate.summaryChars` continues to measure model synthesis, excluding the deterministic inventory.

### Cache Suggest (Stage 5)

After the main pipeline completes, a lightweight LLM judge (using the extract model for cost efficiency) compares the current query against up to 20 recent entries in `.search/.index.json`. It returns semantically related previous searches, which are formatted as a `📚 Related cached searches` table with exact report paths appended to the tool output. Prompt generation and response parsing share the same recent-history window.

This stage is supplementary and never replaces the live search. The pipeline awaits the judge under configured timeout and retry policy, so it can add latency. Judge failure is logged without discarding completed research; cancellation still propagates. The recorded cost estimate is ≈500 input tokens, or ≈$0.0002.

## Dependency Boundary

Native tools construct an explicit operation context through `src/native-operation-context.ts`, then invoke `src/core/operations/`. The core receives resolved settings, model client, workspace paths, package identity, cancellation, progress and diagnostics. It returns text, details and an explicit completed or degraded outcome. Native wrappers preserve existing result payloads, registry diagnostics and rendering.

Model calls pass through `src/native-model-client.ts` to `callLlm()`. The native transport owns authentication, provider hooks and legacy/facade dispatch; `src/core/llm.ts` owns the single retry/timeout policy. Host settings discovery and model registration stay outside the core. Canonical schemas and shared helpers live in the core, with forwarding exports at former paths.

Research dependencies are injected per operation rather than changed through a shared engine harness. The complete engine has no host imports; native callback and rendering types remain in `src/host-types.ts`. [Phase 2 Results](plans/mcp-intelli-search/PHASE-2.md) records shared-engine verification and limits.

### Standalone Adapter

`packages/mcp/` supplies the separate `@curio-data/mcp-intelli-search` runtime. It uses the shared operations with explicit configuration, a canonical workspace, strict argument validation and a non-streaming OpenRouter transport. Shared tuning lives in `src/core/defaults.ts`; standalone model selections and environment-referenced credentials are mandatory. Catalogue preflight precedes paid work, and the shared retry policy applies once to every standalone model call. The standalone adapter sends reasoning effort and exclusion fields only when the catalogue advertises reasoning support; non-reasoning models receive neither.

The standalone bundle externalises its declared third-party dependencies and imports no `Pi` library. Its installation gate denies ancestor dependency resolution and exercises both native fetch paths. Existing cache links and traversal are rejected; these checks do not sandbox hostile concurrent filesystem mutation. Results use absolute workspace cache paths and host-neutral file-reading guidance. [Phase 3 Results](plans/mcp-intelli-search/PHASE-3.md) and the [package guide](../packages/mcp/README.md) record exact interfaces and limits.

### Protocol Serving

The standalone package serves the four canonical tools as an MCP server over stdio through the official split server package (`@modelcontextprotocol/server`, lockfile-pinned). Tool names and input parameters mirror the native tools. The initialize response carries server `instructions` for routing and optional skill loading, and the tool descriptions carry the same guidance. Hosts that defer tool definitions receive server instructions before loading those definitions; the guidance does not enforce model choice. One operation runs at a time with a bounded queue; stage progress maps to `notifications/progress` when the client supplies a token, and client cancellation aborts through the shared model policy. A startup guard diverts every non-protocol write away from standard output, so the stream carries protocol frames only; diagnostics use standard error. Closing standard input or receiving `SIGINT`/`SIGTERM` drains and aborts in-flight and queued work. [Phase 4 Results](plans/mcp-intelli-search/PHASE-4.md) records the protocol verification.

Successful and degraded results carry the same complete operation text in `content` and `structuredContent.text`. An explicitly selected defective configuration file leaves the protocol available with actionable tool errors and is reread on each call until it loads. Missing launcher arguments and invalid workspaces still fail before serving; loaded configuration and startup credentials remain fixed until restart.

### Host Plugins

Thin plugin bundles for [_Claude Code_](https://code.claude.com/docs/en/plugins) and [_Codex_](https://developers.openai.com/codex/plugins) live in `plugins/`, generated from one shared guidance source in `guidance/` by `scripts/generate-plugin-bundles.mjs`; repository marketplace catalogues live at `.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json`. Launchers pin the exact MCP package version through `npx` and contain no pipeline code or credentials; each host's credential and workspace forwarding follows its own environment rules, documented in the generated skills. `npm run check:plugins` is the bidirectional drift gate between the generator and the committed tree. [Phase 5 Results](plans/mcp-intelli-search/PHASE-5.md) records the empirical host findings that drove the launcher design.

## Source Code Structure

```
src/
├── index.ts              # Extension entry: registers tools, events, model setup
├── core/
│   ├── operations/         # Search, extract, collate and five-stage research
│   ├── contracts.ts        # Context, model, progress, result and identity contracts
│   ├── schemas.ts          # Canonical tool parameters
│   ├── defaults.ts         # Tuning shared by native and standalone adapters
│   ├── llm.ts              # Shared retry, timeout and cancellation policy
│   ├── paths.ts            # Physical workspace roots and display policy
│   ├── fetch.ts            # Dual fetch and documentation downloads
│   ├── console.ts          # Async-scoped dependency diagnostic suppression
│   ├── cache.ts            # Artifacts, locks and index
│   ├── telemetry.ts        # Injected identity and local sidecar
│   ├── annotations.ts      # Citation harvesting
│   ├── messages.ts         # Prompt messages and cache appendices
│   ├── provenance.ts       # Evidence validation and deterministic source inventory
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

packages/mcp/
├── src/                    # CLI, strict config, workspace, provider, runtime and protocol adapters
└── dist/                   # Generated self-contained executable and runtime bundles

guidance/                   # Shared host-neutral guidance source and per-host setup fragments
plugins/                    # Generated Claude Code and Codex bundles (manifests, launchers, skills)
```

## Cache Structure

```
.search/
├── 2026-04-19-d1-worker-api-3f7a2c/
│   ├── report.md                              # Synthesis + authoritative source inventory
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

Each research run writes a cache entry named `<date>-<slug>-<hash>`. The `<hash>` is six hexadecimal characters from a Secure Hash Algorithm 1 (SHA-1) hash of the full query. It distinguishes queries sharing a readable stem and reduces collision risk; it does not guarantee unique names. The same query produces the same hash. Runs of that query on the same Coordinated Universal Time (UTC) date refresh the same directory; a different UTC date produces a different directory. A completed refresh attempts to archive the previous report, extractions, numbered sources and telemetry sidecar to a numbered sibling folder (`<slug>.1`, then `.2` and so on). Rotation moves files individually, not atomically: failure is logged and falls back to in-place replacement, and an interrupted rotation can leave a partial archive. Copy important reports elsewhere before repeating a query. Supplementary `llms-full-*` documentation stays with the live folder. A degraded refresh preserves a prior successful report and its artefact set untouched, recording only the failed attempt in `meta.json`. Writers use a short cache lock and per-file atomic replacements; lockless readers are not promised whole-directory snapshot visibility.

### Physical and Display Paths

Both cache-writing tools resolve physical paths against the absolute session workspace, including the shared index and locks. `makeCachePath()` returns an absolute path. Prompts, result details, appendices and report headers use a separate display path, preserving native relative paths such as `.search/<slug>/`. Absolute and parent-relative native cache settings remain supported.

Documentation downloads stage in unique directories under the configured cache root's `.staging/`, not the operating-system temporary directory. Writers settle before unconditional cleanup, including cancellation and cache-write failure. Downloads occur outside cache locks. Optional staging setup or cleanup failure is logged and does not discard the completed research result. Failed cleanup can leave a staging directory; there is no automatic sweep. Stop all research processes using the cache before inspecting the logged path and removing an abandoned directory. Native absolute and parent-relative cache settings can place staging outside the workspace; the standalone adapter separately validates workspace containment and rejects existing cache links.

### Telemetry Sidecar

Unless disabled, completed and documented degraded `intelli_research` paths attempt a best-effort `meta.json` write, including no links found, all fetches failed and all extractions failed. Cancellation and thrown failures do not all produce a sidecar. The `outcome` field records which exit path produced the file, so the analysis script can measure degradation rates, not just success. The schema is owned by `src/core/telemetry.ts` and is additive-only: future versions add optional fields and never rename or remove existing ones.

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
    "fetch": {
      "requested": 10,
      "succeeded": 8,
      "failed": 2,
      "winners": {
        "defuddle": 6,
        "markdown": 2
      }
    },
    "extract": {
      "model": "...",
      "succeeded": 8,
      "failed": 0,
      "totalInputCharsApprox": 200000,
      "totalOutputChars": 16000
    },
    "collate": {
      "model": "...",
      "summaryChars": 4000
    },
    "cacheSuggest": {
      "ran": true,
      "surfaced": 2,
      "slugs": [
        "..."
      ]
    }
  }
}
```

`outcome` is one of `completed`, `no-links`, `fetch-failed`, or `extraction-failed`. `schemaVersion` is decoupled from `extensionVersion` so consumers can branch on payload shape without parsing the product semver. `stages.extract.totalInputCharsApprox` is a lower bound: it sums the truncated page content fed to extraction and excludes the per-call wrapper text, so it understates real input; relative comparisons across runs remain valid. `stages.search.annotationsHarvested` counts `url_citation` entries recovered from the response body; it can include URLs already present in the text and URLs beyond the fetch limit, so it is not the number of extra pages fetched. A zero count does not distinguish a model that emits no annotations from a search that ran and cited nothing; historical records and runs that never reached the search stage omit the field entirely. Standalone `intelli_search` calls do not write this sidecar.

The file is written atomically (temp file then `rename`) so a crash never leaves a partial `meta.json`, and a best-effort sweep cleans up any `.tmp` orphan left by a prior crashed write. The write is fail-safe: failures are caught and logged, never surfacing to the pipeline result or the agent.

The adapter supplies package identity; the core never discovers a manifest relative to its own module. `extensionVersion` retains the emitting adapter version. Native records keep their existing shape, while non-native records add optional `packageName` and `adapter` fields. This is local telemetry: the sidecar adds no network transmission or credential/account-identifier fields. It stores the full query and local result metadata, which can include personal or confidential information. Ordinary research still sends requests to configured external services. Set `disableTelemetry: true` to suppress the sidecar entirely. The bundled `scripts/analyze-sessions.sh` aggregates sidecars across projects to report per-stage success rates.

## Cost Estimate

The canonical, current cost estimate lives in the README [Cost](../README.md#cost) section so model and engine changes require one edit, not two; alternative search configurations are itemised in the README's [Choosing an Alternative Search Configuration](../README.md#choosing-an-alternative-search-configuration) table.
