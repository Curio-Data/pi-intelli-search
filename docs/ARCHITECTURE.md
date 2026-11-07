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

### Extraction Budgets and Partial Failures

`extractionMaxTokens` bounds each page's completion, including reasoning tokens on the configured reasoning-model transport. The current value is defined in the README [Settings Reference](../README.md#settings-reference) and the shared defaults. Recorded probes show route-dependent reasoning consumption; a larger cap reduces the observed empty-output failure without guaranteeing completion for every page or route. Page input is cut at `extractMaxChars` characters (default 400,000, ≈100,000 tokens), so a ten-page run over long pages can send ≈1M input tokens to the extract model.

Empty extraction output is rejected. Within research, the failure becomes a per-page failed result rather than aborting successful pages; standalone extraction throws. Nonempty output is retained with a possible-truncation warning when the provider reports finish reason `length` or a token count that reaches the cap in force for that call. The same check warns about synthesis reaching its cap. Without either signal, a response's completeness is not established.

Completed research writes fetched pages even when extraction failed, and the failed-source appendix links to a full-page file only when one exists. Fetch failures have no fetched copy. When every fetch fails, research exits before extraction and returns the search summary and up to ten failed URLs with their fetch errors. `pagesFailed` counts fetch failures; `extractionFailed` counts failed extraction calls. Manual collation accepts caller-supplied `truncated` and `error` fields but synthesises only successful, nonempty evidence.

### Output-Budget Retry

Within research, `completeWithBudgetRetry()` in `src/core/operations/research.ts` retries an output cap that runs out with the cap doubled. The schedule comes from `budgetCaps()` in `src/core/output-budget.ts`: the configured cap, then up to `outputBudgetRetries` doublings (default 2, so 8,000, 16,000 and 32,000 tokens), never above `MAX_OUTPUT_TOKENS` (128,000) in `src/core/defaults.ts`, the single ceiling that the settings ranges also use. A configured cap at the ceiling gets one attempt. A different serving route on a retry can also succeed at the original cap, but a larger cap is the change that addresses reasoning consumption.

An extraction is retried only when it stops at its cap without visible text; truncated nonempty extraction text is kept with its warning. A synthesis is retried when it stops at its cap with or without text, so every configured attempt runs while only truncated text is available. A completed attempt, or a non-budget failure after usable output was kept, stops further calls. Every usable response is kept. `rankBudgetedCompletions()` orders them with `completionTruncated()`: completed candidates first, latest attempt first, then truncated candidates, longest first. Collation validates them in that order and uses the first that passes provenance validation, so a shorter valid completed answer beats a longer truncated one; when none passes, the first-ranked candidate's error is reported. A truncation warning names the cap of the selected candidate.

`attemptTimeoutMs()` scales each attempt's timeout with its cap, `llmTimeoutMs × attemptCap / configuredCap`, capped at `MAX_TIMEOUT_MULTIPLE` (4) times `llmTimeoutMs`. With the defaults the attempts get 120, 240 and 480 seconds, so one page's budget attempts can take 14 minutes, and the shared transport policy (`llmRetryAttempts`) repeats a timed-out attempt, so a failing page can take ≈30 minutes or more. An extraction retry passes through the `minRequestIntervalMs` throttle. The shared transport policy does not repeat an exhausted budget at the same cap; its retries address transient failures and timer expiry. Standalone extraction and manual collation do not retry with a doubled cap.

### Failure Reports

When synthesis fails after at least one successful extraction, research returns the `collate-failed` outcome instead of an execution error. When every fetched page fails extraction, it returns `extraction-failed`. Both write a failure report through the same commit path, `writeCacheArtifacts()`, and the decision is made under the cache lock. With no successful report in the cache folder, which is keyed by query and UTC date, research writes the report, the telemetry sidecar and the run's saved files. A `collate-failed` run saves its extractions and pages, with a report that states the reason and lists the saved extractions. An `extraction-failed` run saves every fetched page under `sources/` and writes no extraction file; its report lists each saved page's path and extraction-failure reason under `## Failed Sources`, the one section name the tool result, the report and the inferred-assets table share, and the report also carries the search summary. Either commit archives and replaces an earlier failure report as on a successful repeat, removes any index entry for the folder, downloads no supplementary documentation and skips the cache-suggest judge.

When a successful report is already in place, including one a concurrent run committed meanwhile, it is preserved with any index entry: only the failed attempt's sidecar is recorded, this run's files are not saved, `details.cachePath` is empty and `details.preservedCachePath` names the folder. The preserved `extraction-failed` result still lists up to ten failed pages with their bounded reasons, inline, because no saved report exists to point at. A report that cannot be read is treated the same way.

A saved failure report opens with a generated marker line, `<!-- intelli-search:extraction-failed -->` or `<!-- intelli-search:collate-failed -->`, which `writeReportFile()` hoists above the `# <query>` title; the tool result strips it. `isCollationFailureReport()` in `src/core/provenance.ts` recognises a failure report only by that first line, which caller-controlled text cannot reach: every other report opens with its title, and a multiline query can only add lines after it. Marker lines in model synthesis are stripped, so a synthesis that mentions a failure is never mistaken for one. A report without a line-1 marker is never treated as a failure report. Failure reports written by earlier unpublished development builds of 0.22.0 carry no line-1 marker, so a repeat preserves them like any existing report and does not save that attempt's pages; nothing is ever displaced. No published release wrote such a report.

### Collation Input Budget

`planCollationBudget()` in `src/core/collation-budget.ts` decides what the collation model receives, in research and in manual collation, from the actual extraction lengths at ≈4 characters per token (`CHARS_PER_TOKEN`), with ≈100 tokens of header per source. It runs in three steps:

1. Cap each extraction at `collationSourceMaxTokens` (default 32,000), independent of the extraction's output cap, so a retry's larger reasoning allowance cannot let one page take the budget. Within research, the cap binds only when an extraction's largest retried cap (`extractionMaxTokens` doubled `outputBudgetRetries` times, 32,000 tokens with the defaults) exceeds it, or when a page's text runs above ≈4 characters per token. In manual `intelli_collate` it applies to whatever the caller supplies.
2. If the capped text plus headers still exceeds `collationInputBudgetTokens` (default 221,000: a 256,000-token context minus ≈3,000 for prompts and 32,000 for a synthesis at the largest retried cap), trim the longest extractions to a fair share of the budget, inferred references before cited sources, cutting at a paragraph, line, sentence or word boundary where one falls in the last fifth of the allowance.
3. Only when a fair share would keep fewer than 400 characters, leave whole sources out, lowest-ranked first and inferred references first; within a group the later source in the search order ranks lower.

Each trim records two independent flags, `sourceCap` and `budget`, so a source reduced by both limits is reported under both. `overBudget` measures the source-capped text plus headers before aggregate trimming. `formatCollationTrimNotice()` in `src/core/messages.ts` appends the **Collation input trimmed** notice to the synthesis, so it reaches both the result and `report.md`. It names each limit that bound and its setting, groups sources as trimmed to the per-source limit, trimmed by both limits, trimmed to a fair share of the input budget, or left out to fit it, and names every untrimmed `extractions/<file>`. The trim-order line appears only when the aggregate budget reduced or dropped a source, and the advice to raise a limit is replaced by a statement when that limit is already at its maximum. Saved files are never altered.

<a id="fetch-strategy-compare-dont-guess"></a>
### Fetch Variant Selection

Each page is fetched two ways in parallel:

1. **HTML to Defuddle:** Browser-grade Transport Layer Security (TLS) fingerprint plus Defuddle content extraction.
2. **Markdown endpoint:** `Accept: text/Markdown` header, `<link rel="alternate">`, or `.md` suffix.
3. **Compare quality:** Score on code blocks, headings, tables versus nav chrome noise. Pick the better one.

`processFetchedResponse()` in `src/core/fetch.ts` applies one case-insensitive media dispatch to direct, negotiated and alternate bodies. HTML (`text/html`, `application/xhtml+xml`, and bare `application/xhtml` as a compatibility input) takes the Defuddle path; `text/markdown` is kept as Markdown; any other `text/*` type and a fixed set of code media types (JSON, JavaScript, XML, YAML, TOML, shell, Python, C and others) are saved as raw text or code assets, classified `code` by media type or file extension and otherwise `text`. Binary types, including PDF and `application/octet-stream`, are rejected with `Unsupported content type`. An unsupported alternate falls back to usable HTML. A saved text asset records fetch winner `text` in telemetry.

Three URLs are kept distinct. `page.url` is the stable identity: the requested or guessed URL, which keys the cache files and provenance. `alternateUrl` names a discovered Markdown representation, and `finalUrl` the response URL after redirects, recorded only when it differs from the request beyond parser normalisation; saved sources carry a `> Final URL:` header when one applies. Selected HTML resolves its relative links against the actual response URL, the document base, while provenance retains `page.url`.

### Inferred Assets

The search stage also extracts protocol-less references from search prose (`plausibleDomainReference()` in `src/core/util.ts`, with the delegated top-level domain set in `src/core/tlds.ts`). A reference ending in a delegated top-level domain is kept, even one that looks like a filename (`install.sh`, `manage.py`, `README.md`): the owner decided that a guessed file may be the right download, so classification happens after fetching rather than by filtering. Such references carry `inferred` and the original token (`originalReference`), and `mergeCitations()` ranks them after prose links and harvested citations before the `maxUrls` clamp. The token becomes the host name. Internationalised names are converted with `domainToASCII()`, queries, fragments and numeric ports are preserved, and non-numeric ports and a bare `host:port` without a top-level domain are rejected.

`inferredAssetsSection()` in `src/core/provenance.ts` renders the `Inferred Assets` table in the result and in `report.md`, and `inferredAssetDetailsField()` in `research.ts` supplies `details.inferredAssets`. Each entry shows the original token, the normalised URL, the outcome (`page`, `code`, `text`, `unknown` or `nothing`, with a bounded `failureDetail()` reason), any alternate and final URL, and the saved `sources/` path. `redirectedToDifferentHost()` compares lowercased ASCII hostnames after removing one leading `www.`; any other hostname change is disclosed as "redirected to a different host". There is no public-suffix reasoning: a different hostname is not evidence of a different organisation. A committed failure points at the shared `Failed Sources` list; a preserved result, which saved nothing, carries the reason inline, shows "Not saved in this attempt" and omits `sourceFile`. A saved inferred asset uses the ordinary numbered `sources/` file; its provenance lives in the result and report, never in the filename.

For sites that provide `llms-full.txt` ([Cloudflare](https://developers.cloudflare.com), [Next.js](https://nextjs.org), [Vite](https://vite.dev), and others), the raw file is downloaded to `sources/` alongside individual pages. No large language model (LLM) processing is applied. The agent can grep or search it for offline lookup.

Dependency-specific console suppression uses async-local scopes and a single reference-counted dispatcher in `src/core/console.ts`. Console methods are patched only while a suppression region is active, then restored after the last region exits. Overlapping fetches cannot capture one another's diagnostic flags, and unrelated async work passes through. The fetch comparison emits no direct debug line; operation diagnostics use the injected logger. Native prefix formatting remains outside the core.

<a id="provider-and-model-choices"></a>
### Native Models and Authentication

All three model stages (search, extract, collate) use independently configurable models. The following defaults and authentication paths belong to the native `Pi` adapter:

- **Extract and Collate:** [_MiniMax_](https://minimax.io) M3 via [_OpenRouter_](https://openrouter.ai). Native model calls default to `reasoning: "low"`, with the configured `searchWebSearch.reasoning` override on search-tool calls. Authentication and dispatch use only the `ctx.modelRegistry.streamSimple()` facade on the `Pi` >= 0.86.0 floor. The facade normalises the context so the system prompt reaches the model, resolves host authentication and applies endpoint overrides. The legacy provider path and its manual authentication/`baseUrl` mirror are removed. A host without the facade receives an actionable version error rather than falling back to a direct provider call. Override `extractModel` or `collateModel` in the `pi-intelli-search` settings namespace to select another registered, authenticated text model with suitable context and capabilities.
- **Search:** a search-grounded model. The default is [_Perplexity Sonar_](https://docs.perplexity.ai) via [OpenRouter](https://openrouter.ai), which returns a synthesised answer with inline citations. This is better than a bare URL (uniform resource locator) list because the agent gets immediate context plus source URLs for follow-up. Two alternatives use the same account: `perplexity/sonar-pro-search` (a settings-only model swap), and the `searchWebSearch` setting, which attaches OpenRouter's `openrouter:web_search` server tool to an OpenRouter chat model with the required tool support through the provider's `onPayload` hook (distinct from the deprecated `:online` suffix and `plugins` configuration). Override `searchModel` in the `pi-intelli-search` settings namespace.

<a id="harvesting-citations-from-the-response-body"></a>
### Native Citation Harvesting

Search-grounded models attach machine-readable `url_citation` annotations to the assistant message, identifying cited sources. Recognised annotations can increase the candidate source set, but neither their presence nor harvesting establishes every source consulted. `Pi`'s chat-completions adapter reassembles only text, thinking, and tool-call blocks, so those annotations are absent from the normalised response returned to extension code.

Rather than fork the adapter, the extension uses two citation channels. On `pi-ai` >= 0.99.0, the `onProviderStreamEvent` option receives every parsed server-sent event (SSE) chunk from the chat-completions adapter before normalisation. `harvestChunkAnnotations()` extracts recognised citation entries from those chunks. A wrapped `fetch` through `ProviderRequestOptions.fetch` remains the fallback for hosts whose `pi-ai` predates 0.99.0 and ignores the stream option. Both channels remain attached and feed the same sink, deduplicating by exact URL.

The fetch wrapper tees each response body: the software development kit (SDK) consumes the original stream unchanged, while a clone is read in the background and parsed for citations from SSE or plain JavaScript Object Notation (JSON). `response.clone()` is called synchronously before the SDK can touch the body. Clone and background-read failures are swallowed so citation recovery does not gate search. Each retry attempt owns a separate sink, so late citations from a failed attempt cannot contaminate a successful response. `callLlm()` awaits successful background reads (bounded at 2 seconds) before copying citations to the caller. Harvesting remains best-effort, including when a provider emits no recognised annotations.

Merging is text-first: prose links (with their Markdown titles) come before annotation-only URLs, and exact URL duplicates are removed. The search prompt asks the model to end with a Sources section. The shared search operation extracts URLs from the full response, then removes the model-rendered Sources section before passing the summary downstream. The `intelli_search` result builder renders a canonical source list. Research uses the stripped search summary for degraded results, but completed collation receives only successful, non-empty extractions. Search-only claims and cache paths are excluded from the collation input. This is not a new pipeline stage: harvesting belongs to search. See `src/core/annotations.ts`.

<a id="custom-model-registration"></a>
### Native Model Registration

[_Perplexity Sonar_](https://docs.perplexity.ai) and its siblings are not in `Pi`'s built-in model list for [OpenRouter](https://openrouter.ai). The extension writes `perplexity/sonar`, `perplexity/sonar-pro`, and `perplexity/sonar-pro-search` to `~/.pi/agent/models.json` on first load (merging by id, non-destructive, adding only what is missing) and refreshes the model registry. This operation is idempotent. Invalid or unreadable existing files are preserved and reported rather than replaced. Valid merges retain existing overrides, follow valid operator-managed symlinks, and use a short lock and atomic replacement.

Registration remains unconditional across the supported host range. On `Pi` 1.2.0, OpenRouter catalogue personalisation filters the built-in chat catalogue to models available to the key and saves that list for offline use. `models.json` entries merge afterwards, so the extension's registrations remain available even when absent from the personalised list. Registration does not grant account access; the provider can still reject a call.

A conditional merge based on the personalised catalogue was rejected. An offline first run without a saved list cannot establish key-specific availability; host-version conditions would produce different registration files and expand the verification matrix; and entries deleted from `models.json` would no longer be restored consistently on the next load. The accepted trade-off is that the registrations supply static context, output-limit and token-price metadata instead of the key-specific values. Context and output limits affect request budgeting, not just display; token prices inform `Pi`'s cost estimates but omit Sonar's per-request search fee. Existing operator-defined entries are preserved. See the [`Pi` 1.2.0 verification](COMPATIBILITY.md#pi-120-verification-2026-10-13) for the audit basis.

<a id="rate-limit-resilience"></a>
### Native Rate-Limit Resilience

The extension monitors `after_provider_response` events to detect Hypertext Transfer Protocol (HTTP) `429` (rate-limiting) and 5xx (server errors) from [OpenRouter](https://openrouter.ai). Rate-limit status appears in the `Pi` footer via `ctx.ui.setStatus()`, debounced to avoid flooding.

Recovery is owned by `runModelWithPolicy()` in `src/core/llm.ts`, which `callLlm()` invokes once around native dispatch. Native streams receive `maxRetries: 0` so SDK retries do not compound with the shared policy. The policy's retry classifier mirrors the audited host's own retry list (pi-ai `utils/retry.js`, captured for 1.5.0), covering transient provider load, gateway and wrapper wording, network and transport failures, premature stream endings and explicit retry guidance, while account quota, credit-budget and billing exhaustion fail fast without consuming the retry budget. Completion-token exhaustion is a separate extraction diagnostic, not a transient transport failure. Retries use full-jitter exponential backoff that honours any Retry-After hint, bounded by `llmRetryAttempts`, `retryBaseDelayMs`, and `retryMaxDelayMs`. On the [OpenRouter](https://openrouter.ai) path, the provider stream converts a failed HTTP request into `stopReason: "error"` with diagnostic text in `errorMessage`. The extension's classifier inspects that text rather than a raw HTTP response. SDK retries are disabled (`maxRetries: 0`); the shared policy owns reattempts. The `onResponse` callback only observes (it captures a Retry-After header) and never throws, because a throw would propagate out of the stream and bypass the retry loop.

A hard per-call timeout (`llmTimeoutMs`) is applied with an `AbortController` via `callWithAbortTimeout()`, combined with the tool signal so Esc still cancels. This is necessary because the SDK request timeout does not cover a stalled streaming body, which a provider can hold open after a 200 under load. Stage 1 additionally retries a degraded-200 search (a valid response with zero links) up to `searchRetryAttempts` times, and `minRequestIntervalMs` optionally spaces the concurrent extract calls for keys with tight rate limits. These configured retries and application timeouts apply inside `intelli_research`. Native standalone search, extract and collate retain one attempt without an application-level timeout. The pure helpers live in `src/core/util.ts` and are unit-tested. Only actual application timer expiry is classified as an application timeout; permanent provider exceptions are not retried as timeouts.

<a id="working-indicator-and-progress-bar"></a>
### Native Working Indicator and Progress Bar

During `intelli_research` execution, the extension sets a custom animated spinner (🔍 🌐 📄 ✨) via `ctx.ui.setWorkingIndicator()` (requires `Pi` 0.69.0+). This is restored to the default on completion or error.

In addition, the tool streams stage progress updates via `onUpdate()` and renders a progress bar in the tool output via `renderResult`. The progress bar shows overall completion, stage pills (✓/●/○), the current stage message, and a per-page sub-progress bar during extraction. The LLM receives structured `Stage X/5` prefixed text through `onUpdate` content. The `renderResult` function is a standard `Pi` tool API feature and requires no minimum version beyond what the extension already needs. Final results append an execution-duration line when `Pi` >= 1.1.0 supplies `durationMs` of at least 1,000 milliseconds in the render context. Older hosts omit that line.

### Collation Evidence

`src/core/provenance.ts` builds the Source Assessment inventory from the successful extraction set and the same `SourceIdentity` used for cache writes. The model receives source IDs, page metadata and extracted content as JavaScript Object Notation (JSON), and returns synthesis only. An inferred source carries `inferredFromText: true` and its `finalUrl`, and the collation prompt instructs the model not to give such sources citation-equivalent authority. It does not generate source inventories, relevance ratings or cache-file paths. Source IDs in prose, including grouped references, must resolve to evidence entries. Prose URLs must occur in the supplied extraction content or identify an evidence page; fragments and trailing-slash differences are accepted, but different hosts, schemes or query parameters are not merged. Cross-links remain content, not additional fetched sources. Model-generated numbered cache references and source inventories are rejected. Fenced, indented and inline code examples are preserved as data; ordinary project filenames such as `report.md` are not treated as cache declarations. These are reference checks, not proof that every factual claim is correct or grounded.

Validation runs before rotation, downloads or cache writes. A failed collation preserves any prior report and index and raises an actionable error. Empty research extractions count as failures. Manual collation rejects an empty evidence set and duplicate extraction URLs, labels successful evidence as caller-supplied and marks absent full pages `Not cached`. Its optional `searchSummary` field remains accepted but does not enter synthesis. Native and MCP tools retain their input parameters; the `searchSummary` description now discloses that it is not synthesis evidence. The internal collation prompt and generated report prose intentionally change. Operation reports contain one Source Assessment inventory; the low-level report writer retains its legacy index only for callers that do not supply an inventory. `collate.summaryChars` continues to measure model synthesis, excluding the deterministic inventory.

### Cache Suggest (Stage 5)

After the main pipeline completes, a lightweight LLM judge (using the extract model for cost efficiency) compares the current query against up to 20 recent entries in `.search/.index.json`. It returns semantically related previous searches, which are formatted as a `📚 Related cached searches` table with exact report paths appended to the tool output. Prompt generation and response parsing share the same recent-history window.

This stage is supplementary and never replaces the live search. The pipeline awaits the judge under the configured timeout and retry policy, so it can add latency. Its output cap is 2,000 tokens; this is a completion budget, not an input-token estimate. Empty or unparseable output and thrown attempted calls set `stages.cacheSuggest.degraded` when telemetry is enabled. A parsed empty match list is a valid zero-match verdict. Judge failure is logged without discarding completed research; cancellation still propagates. See [Telemetry Sidecar](#telemetry-sidecar) for `ran` and `degraded` semantics and the README [Cost](../README.md#cost) section for the planning estimate.

## Dependency Boundary

Native tools construct an explicit operation context through `src/native-operation-context.ts`, then invoke `src/core/operations/`. The core receives resolved settings, model client, workspace paths, package identity, cancellation, progress and diagnostics. It returns text, details and an explicit completed or degraded outcome. Native wrappers preserve existing result payloads, registry diagnostics and rendering.

Model calls pass through `src/native-model-client.ts` to `callLlm()`. The native transport owns authentication, provider hooks and facade-only dispatch; `src/core/llm.ts` owns the single retry/timeout policy. Host settings discovery and model registration stay outside the core. Canonical schemas and shared helpers live in the core, with forwarding exports at former paths.

Research dependencies are injected per operation rather than changed through a shared engine harness. The complete engine has no host imports; native callback and rendering types remain in `src/host-types.ts`.

### Standalone Adapter

`packages/mcp/` supplies the separate `@curio-data/mcp-intelli-search` runtime. It uses the shared operations with explicit configuration, a canonical workspace, strict argument validation and a non-streaming OpenRouter transport. Shared tuning lives in `src/core/defaults.ts`; standalone model selections and environment-referenced credentials are mandatory. Catalogue preflight precedes paid work, and the shared retry policy applies once to every standalone model call. The standalone adapter sends reasoning effort and exclusion fields only when the catalogue advertises reasoning support; non-reasoning models receive neither.

The standalone bundle externalises its declared third-party dependencies and imports no `Pi` library. Its installation gate denies ancestor dependency resolution and exercises both native fetch paths. Existing cache links and traversal are rejected; these checks do not sandbox hostile concurrent filesystem mutation. Results use absolute workspace cache paths and host-neutral file-reading guidance. The [package guide](../packages/mcp/README.md) records exact interfaces and limits.

### Protocol Serving

The standalone package serves the four canonical tools as an MCP server over stdio through the official split server package (`@modelcontextprotocol/server`, lockfile-pinned). Tool names and input parameters mirror the native tools. The initialize response carries server `instructions` for routing and optional skill loading, and the tool descriptions carry the same guidance. Hosts that defer tool definitions receive server instructions before loading those definitions; the guidance does not enforce model choice. One operation runs at a time with a bounded queue; stage progress maps to `notifications/progress` when the client supplies a token, and client cancellation aborts through the shared model policy. A startup guard diverts every non-protocol write away from standard output, so the stream carries protocol frames only; diagnostics use standard error. Closing standard input or receiving `SIGINT`/`SIGTERM` drains and aborts in-flight and queued work.

Successful and degraded results carry the same complete operation text in `content` and `structuredContent.text`. An explicitly selected defective configuration file leaves the protocol available with actionable tool errors and is reread on each call until it loads. Missing launcher arguments and invalid workspaces still fail before serving; loaded configuration and startup credentials remain fixed until restart.

### Host Plugins

Thin plugin bundles for [_Claude Code_](https://code.claude.com/docs/en/plugins) and [_Codex_](https://developers.openai.com/codex/plugins) live in `plugins/`, generated from one shared guidance source in `guidance/` by `scripts/generate-plugin-bundles.mjs`; repository marketplace catalogues live at `.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json`. Launchers pin the exact MCP package version through `npx` and contain no pipeline code or credentials; each host's credential and workspace forwarding follows its own environment rules, documented in the generated skills. `npm run check:plugins` is the bidirectional drift gate between the generator and the committed tree.

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
│   ├── output-budget.ts    # Budget-retry caps, timeouts and candidate ranking
│   ├── collation-budget.ts # Collation input budget and trim order
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
│   └── sources/                               # Full pages and raw text or code assets
│       ├── 01-developers-cloudflare-com.md    # Defuddle OR raw Markdown (best score)
│       ├── 02-developers-cloudflare-com.md
│       └── llms-full-developers-cloudflare-com.md   # Raw llms-full.txt (auto-downloaded)
└── .index.json                                # Index of all cached searches
```

Each research run writes a cache entry named `<date>-<slug>-<hash>`. The `<hash>` is six hexadecimal characters from a Secure Hash Algorithm 1 (SHA-1) hash of the full query. It distinguishes queries sharing a readable stem and reduces collision risk; it does not guarantee unique names. The same query produces the same hash. Runs of that query on the same Coordinated Universal Time (UTC) date refresh the same directory; a different UTC date produces a different directory. A completed refresh attempts to archive the previous report, extractions, numbered sources and telemetry sidecar to a numbered sibling folder (`<slug>.1`, then `.2` and so on). Rotation moves files individually, not atomically: failure is logged and falls back to in-place replacement, and an interrupted rotation can leave a partial archive. Copy important reports elsewhere before repeating a query. Supplementary `llms-full-*` documentation stays with the live folder. A degraded refresh preserves a prior successful report and its artefact set untouched, recording only the failed attempt in `meta.json`. A `no-links` or `fetch-failed` refresh also preserves an earlier failure report; an `extraction-failed` or `collate-failed` refresh archives and replaces one (see [Failure Reports](#failure-reports)). Writers use a short cache lock and per-file atomic replacements; lockless readers are not promised whole-directory snapshot visibility.

### Physical and Display Paths

Both cache-writing tools resolve physical paths against the absolute session workspace, including the shared index and locks. `makeCachePath()` returns an absolute path. Prompts, result details, appendices and report headers use a separate display path, preserving native relative paths such as `.search/<slug>/`. Absolute and parent-relative native cache settings remain supported.

Documentation downloads stage in unique directories under the configured cache root's `.staging/`, not the operating-system temporary directory. Writers settle before unconditional cleanup, including cancellation and cache-write failure. Downloads occur outside cache locks. Optional staging setup or cleanup failure is logged and does not discard the completed research result. Failed cleanup can leave a staging directory; there is no automatic sweep. Stop all research processes using the cache before inspecting the logged path and removing an abandoned directory. Native absolute and parent-relative cache settings can place staging outside the workspace; the standalone adapter separately validates workspace containment and rejects existing cache links.

### Telemetry Sidecar

Unless disabled, completed and documented degraded `intelli_research` paths attempt a best-effort `meta.json` write, including no links found, all fetches failed and all extractions failed. Cancellation and thrown failures do not all produce a sidecar. The `outcome` field records which exit path produced the file, so the analysis script can measure degradation rates, not just success. The schema is owned by `src/core/telemetry.ts` and is additive-only: future versions add optional fields and never rename or remove existing ones.

Illustrative sidecar from an adapter version that supports the budget diagnostics below. Version and model strings are placeholders; the counts describe one completed run with partial extraction failure, possible truncation and an empty judge response.

```jsonc
{
  "schemaVersion": 1,
  "extensionVersion": "<emitting adapter version>",
  "query": "...",
  "timestamp": "2026-11-02T12:00:00.000Z",
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
      "succeeded": 7,
      "failed": 1,
      "totalInputCharsApprox": 200000,
      "totalOutputChars": 16000,
      "truncated": 1,
      "failureReasons": {
        "budgetExhausted": 1,
        "other": 0
      },
      "provider": "Novita"
    },
    "collate": {
      "model": "...",
      "summaryChars": 4000,
      "truncated": true,
      "provider": "Novita"
    },
    "cacheSuggest": {
      "ran": true,
      "surfaced": 0,
      "degraded": true,
      "slugs": [
      ]
    }
  }
}
```

`outcome` is one of `completed`, `no-links`, `fetch-failed`, `extraction-failed` or `collate-failed`. `schemaVersion` is decoupled from `extensionVersion` so consumers can branch on payload shape without parsing the product semver. `stages.extract.totalInputCharsApprox` is a lower bound: it sums the truncated page content fed to extraction and excludes the per-call wrapper text, so it understates real input; relative comparisons across runs remain valid. `stages.search.annotationsHarvested` counts `url_citation` entries recovered from the response body; it can include URLs already present in the text and URLs beyond the fetch limit, so it is not the number of extra pages fetched. A zero count does not distinguish a model that emits no annotations from a search that ran and cited nothing; historical records and runs that never reached the search stage omit the field entirely. Standalone `intelli_search` calls do not write this sidecar.

Budget diagnostics are optional members of `stages`. Their absence must be interpreted with the emitting version and the stages reached:

- `extract.truncated` counts successful extractions that stopped at their output cap: finish reason `length`, or a reported output-token count reaching the cap. The field is written only when the count is nonzero. It warns of possible incomplete text, not a verified cut-off; without either signal it cannot be triggered.
- `extract.budgetRetries` counts budget-retry attempts across all pages, so one page retried twice counts two. It is written only when nonzero.
- `extract.failureReasons` is written when at least one extraction failed. `budgetExhausted` counts failures identified by finish reason `length`, reported output reaching the cap, or an adapter's structured budget-exhaustion signal; `other` counts the remaining extraction failures. Fetch failures are recorded separately in `fetch.failed`.
- `collate.truncated` is written as `true` when the final synthesis stopped at its output cap, by finish reason or reported usage. An absent field does not prove completeness when neither signal is available.
- `collate.budgetRetried` is written as `true`, and `collate.budgetRetries` with the number of retry attempts, when synthesis was retried with a doubled output cap. `collate.error` carries a bounded failure reason on a `collate-failed` run.
- `collate.inputBudget` is written when the [collation input budget](#collation-input-budget) reduced anything: `budgetTokens`, `sources`, `trimmed`, `dropped`, `charsBefore` and `charsAfter`.
- `fetch.winners` can include `text` for a saved text or code asset, beside `defuddle`, `defuddle-fallback` and `markdown`.
- `extract.provider` records a route only when all available per-page route observations agree; unobserved routes are not evidence of agreement. It is omitted when no route is available or observed routes differ. `collate.provider` records the synthesis route when available. Native capture reads `provider` from stream events; standalone capture reads the completion's `provider` field. A standalone completion that throws before returning does not supply a route to the core. These fields do not identify a provider for every failed page.
- `cacheSuggest.degraded` is written as `true` when an attempted judge call returns empty or unparseable output, or throws. A thrown call can leave `ran: false` with `degraded: true`; a parsed empty match list is a valid zero-match verdict, not degradation. Older records omit this distinction.

These fields are additive. Records from versions before their introduction do not establish zero truncations, zero budget failures or a healthy judge.

The file is written atomically (temp file then `rename`) so a crash never leaves a partial `meta.json`, and a best-effort sweep cleans up any `.tmp` orphan left by a prior crashed write. The write is fail-safe: failures are caught and logged, never surfacing to the pipeline result or the agent.

The adapter supplies package identity; the core never discovers a manifest relative to its own module. `extensionVersion` retains the emitting adapter version. Native records keep their existing shape, while non-native records add optional `packageName` and `adapter` fields. This is local telemetry: the sidecar adds no network transmission or credential/account-identifier fields. It stores the full query and local result metadata, which can include personal or confidential information. Ordinary research still sends requests to configured external services. Set `disableTelemetry: true` to suppress the sidecar entirely. The bundled `scripts/analyze-sessions.sh` aggregates sidecars across projects to report per-stage success rates.

## Cost Estimate

The canonical, current cost estimate lives in the README [Cost](../README.md#cost) section so model and engine changes require one edit, not two; alternative search configurations are itemised in the README's [Choosing an Alternative Search Configuration](../README.md#choosing-an-alternative-search-configuration) table.
