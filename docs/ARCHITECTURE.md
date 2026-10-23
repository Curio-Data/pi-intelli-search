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

Recovery is owned by `runModelWithPolicy()` in `src/core/llm.ts`, which `callLlm()` invokes once around native dispatch. Native streams receive `maxRetries: 0` so SDK retries do not compound with the shared policy. The policy's retry classifier mirrors `Pi` 1.3.0's own retry list (pi-ai `utils/retry.js`), covering transient provider load, gateway and wrapper wording, network and transport failures, premature stream endings and explicit retry guidance, while quota, budget and billing exhaustion fails fast without consuming the retry budget. Retries use full-jitter exponential backoff that honours any Retry-After hint, bounded by `llmRetryAttempts`, `retryBaseDelayMs`, and `retryMaxDelayMs`. On the [OpenRouter](https://openrouter.ai) path, the provider stream converts a failed HTTP request into `stopReason: "error"` with diagnostic text in `errorMessage`. The extension's classifier inspects that text rather than a raw HTTP response. SDK retries are disabled (`maxRetries: 0`); the shared policy owns reattempts. The `onResponse` callback only observes (it captures a Retry-After header) and never throws, because a throw would propagate out of the stream and bypass the retry loop.

A hard per-call timeout (`llmTimeoutMs`) is applied with an `AbortController` via `callWithAbortTimeout()`, combined with the tool signal so Esc still cancels. This is necessary because the SDK request timeout does not cover a stalled streaming body, which a provider can hold open after a 200 under load. Stage 1 additionally retries a degraded-200 search (a valid response with zero links) up to `searchRetryAttempts` times, and `minRequestIntervalMs` optionally spaces the starts of every actual model attempt in the runtime, including retries and standalone calls, for keys with tight rate limits. These configured retries and application timeouts apply inside `intelli_research`. Native standalone search, extract and collate retain one attempt without an application-level timeout. The pure helpers live in `src/core/util.ts` and are unit-tested. Only actual application timer expiry is classified as an application timeout; permanent provider exceptions are not retried as timeouts.

<a id="working-indicator-and-progress-bar"></a>
### Native Working Indicator and Progress Bar

During `intelli_research` execution, the extension sets a custom animated spinner (🔍 🌐 📄 ✨) via `ctx.ui.setWorkingIndicator()` (requires `Pi` 0.69.0+). This is restored to the default on completion or error.

In addition, the tool streams stage progress updates via `onUpdate()` and renders a progress bar in the tool output via `renderResult`. The progress bar shows overall completion, stage pills (✓/●/○), the current stage message, and a per-page sub-progress bar during extraction. The LLM receives structured `Stage X/5` prefixed text through `onUpdate` content. The `renderResult` function is a standard `Pi` tool API feature and requires no minimum version beyond what the extension already needs. Final results append an execution-duration line when `Pi` >= 1.1.0 supplies `durationMs` of at least 1,000 milliseconds in the render context. Older hosts omit that line.

### Collation Evidence

`src/core/provenance.ts` builds the Source Assessment inventory from the successful extraction set and the same `SourceIdentity` used for cache writes. The model receives source IDs, page metadata and extracted content as JavaScript Object Notation (JSON), and returns synthesis only. It does not generate source inventories, relevance ratings or cache-file paths. Source IDs in prose, including grouped references, must resolve to evidence entries. Prose URLs must occur in the supplied extraction content or identify an evidence page; fragments and trailing-slash differences are accepted, but different hosts, schemes or query parameters are not merged. Cross-links remain content, not additional fetched sources. Model-generated numbered cache references and source inventories are rejected. Fenced, indented and inline code examples are preserved as data; ordinary project filenames such as `report.md` are not treated as cache declarations. These are reference checks, not proof that every factual claim is correct or grounded.

Validation runs before any report file is published. A failed collation publishes no report, leaves earlier runs and the index untouched and raises an actionable error; a run directory already reserved for it remains as an incomplete run. Empty research extractions count as failures. Manual collation rejects an empty evidence set and duplicate extraction URLs, labels successful evidence as caller-supplied and marks absent full pages `Not cached`. Its optional `searchSummary` field remains accepted but does not enter synthesis. Native and MCP tools retain their input parameters; the `searchSummary` description now discloses that it is not synthesis evidence. The internal collation prompt and generated report prose intentionally change. Operation reports contain one Source Assessment inventory; the low-level report writer retains its legacy index only for callers that do not supply an inventory. `collate.summaryChars` continues to measure model synthesis, excluding the deterministic inventory.

### Cache Suggest (Stage 5)

After collation and publication, a lightweight LLM judge (using the extract model for cost efficiency) compares the current query against up to 20 candidates. Candidates are the newest verified run for each query and UTC date in `.intelli-v1/index.json`, merged with valid legacy `.index.json` entries; the current query's own date and query key is excluded. A new-format candidate is offered only after its report marker and file hashes verify. Legacy candidates keep their stored query and timestamp and are never rewritten. The judge returns semantically related previous searches, formatted as a `📚 Related cached searches` table with exact report paths appended to the tool output. Prompt generation and response parsing share one frozen candidate array. The stage also runs for degraded outcomes, unlike earlier releases, so a degraded run can make one extra model call. This is a compatibility mapping of the previous behaviour; it adds no relevance grouping or retention policy.

This stage is supplementary and never replaces the live search. The pipeline awaits the judge under configured timeout and retry policy, so it can add latency. Judge failure is logged without discarding completed research; cancellation still propagates. The recorded cost estimate is ≈500 input tokens, or ≈$0.0002.

## Dependency Boundary

The four registered native tools bind through `src/native-registered-tools.ts` to the session-scoped runtime in `src/native-operation-runtime.ts`, then invoke the core operations. The core receives resolved settings, a scoped model client, workspace paths, package identity, authoritative operation services (cancellation, clock, progress, attempt ledger, fetch client and run store) and diagnostics. It returns text, details and an explicit outcome, plus full operation data and numeric usage. Native wrappers preserve existing result payloads, registry diagnostics and rendering, and add the full data under `details.intelli`. Direct legacy helper exports retained for characterisation still use `src/native-operation-context.ts` and the earlier cache layout; they are not the registered execution path.

Model calls pass through `src/native-model-client.ts` to `callLlm()`. The native transport owns authentication, provider hooks and facade-only dispatch; `src/core/llm.ts` owns the single retry/timeout policy. Host settings discovery and model registration stay outside the core. Canonical schemas and shared helpers live in the core, with forwarding exports at former paths.

Research dependencies are injected per operation rather than changed through a shared engine harness. The complete engine has no host imports; native callback and rendering types remain in `src/host-types.ts`.

### Standalone Adapter

`packages/mcp/` supplies the separate `@curio-data/mcp-intelli-search` runtime. It uses the shared operations with explicit configuration, a canonical workspace, strict argument validation and a non-streaming OpenRouter transport. Shared tuning lives in `src/core/defaults.ts`; standalone model selections and environment-referenced credentials are mandatory. Catalogue preflight precedes paid work, and the shared retry policy applies once to every standalone model call. The standalone adapter sends reasoning effort and exclusion fields only when the catalogue advertises reasoning support; non-reasoning models receive neither.

The standalone bundle externalises its declared third-party dependencies and imports no `Pi` library. Its installation gate denies ancestor dependency resolution and exercises both native fetch paths. Existing cache links and traversal are rejected; these checks do not sandbox hostile concurrent filesystem mutation. Results use absolute workspace cache paths and host-neutral file-reading guidance. The [package guide](../packages/mcp/README.md) records exact interfaces and limits.

### Protocol Serving

The standalone package serves the four canonical tools as an MCP server over stdio through the official split server package (`@modelcontextprotocol/server`, lockfile-pinned). Tool names and input parameters mirror the native tools. The initialize response carries server `instructions` for routing and optional skill loading, and the tool descriptions carry the same guidance. Hosts that defer tool definitions receive server instructions before loading those definitions; the guidance does not enforce model choice. Operation admission defaults to two active and eight queued requests, configurable through the top-level `admission` object (1 to 16 active, 0 to 256 queued); a full queue returns a busy tool error, and a cancelled queued request settles without starting. Admission is separate from the runtime's model and fetch capacity, which parallel operations share. Stage progress maps to `notifications/progress` when the client supplies a token, and client cancellation aborts through the shared model policy. A startup guard diverts every non-protocol write away from standard output, so the stream carries protocol frames only; diagnostics use standard error. Closing standard input or receiving `SIGINT`/`SIGTERM` drains and aborts in-flight and queued work.

Successful and degraded results carry the same complete operation text in `content` and `structuredContent.text`. An explicitly selected defective configuration file leaves the protocol available with actionable tool errors and is reread on each call until it loads. Missing launcher arguments and invalid workspaces still fail before serving; loaded configuration and startup credentials remain fixed until restart.

### Host Plugins

Thin plugin bundles for [_Claude Code_](https://code.claude.com/docs/en/plugins) and [_Codex_](https://developers.openai.com/codex/plugins) live in `plugins/`, generated from one shared guidance source in `guidance/` by `scripts/generate-plugin-bundles.mjs`; repository marketplace catalogues live at `.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json`. Launchers pin the exact MCP package version through `npx` and contain no pipeline code or credentials; each host's credential and workspace forwarding follows its own environment rules, documented in the generated skills. `npm run check:plugins` is the bidirectional drift gate between the generator and the committed tree.

## Execution and Ownership

Each adapter runtime owns one execution coordinator: one per native `Pi` session generation, and one per MCP runtime. The coordinator captures validated `execution` settings when the runtime starts; a changed setting takes effect only in a replacement runtime. When a native session is replaced or reloaded, the old generation stops admissions, aborts and drains its work, and only then does the new coordinator start, so two generations never run work at the same time.

- **Operations:** every tool call takes an operation lease before preflight. The operation owns its page request chains, model attempts, timers, staging files and cache writers, and returns only after all of them settle, on completed, degraded, error and cancelled paths. No work continues after return. Research follows one order: admission, preflight, search, page phase, evidence freeze, collation, late drain, publication, suggestions, final accounting, settlement.
- **Model Attempts:** admission happens inside the single retry owner, immediately around each transport attempt. A queued attempt holds no permit and has no usage record; its timeout starts at dispatch; its permit is released before backoff and reacquired for a retry. All attempts, including late extraction, count towards `modelConcurrency`. Page extraction across every operation in the runtime may use at most `modelConcurrency` minus the one-slot critical reserve, so parallel research calls share those page slots rather than adding their own; search, collation and suggestion calls may use any free slot. Aggregate fetch permits are shared in the same way. When both classes wait, dispatch follows a repeating cycle of three critical opportunities to one page opportunity, round-robin between operations within each class. `minRequestIntervalMs` advances only when an attempt is actually dispatched.
- **Policies:** research applies the configured retry and application timeout. Native standalone search, extract and collate keep one attempt and no application timeout, but still pass admission and pacing. MCP applies its explicit configured policy to every model call.
- **Pages:** candidate URLs are filtered, deduplicated and clamped before page work, and receive stable `S1`, `S2`, … identifiers in that order. Every physical request chain (each fetch variant, alternate probe and documentation download) holds an aggregate fetch permit for its whole request, redirect, body and cancellation lifetime, and runs in its own child process. Bodies are read incrementally and rejected beyond the decoded byte limit. Accepted pages are spooled to private staging below `<cacheDir>/.staging/`, which releases their in-memory bodies. Streaming mode holds each page's slot through its extraction; barrier mode releases the slot after spooling, waits for the whole fetch stage and then reads staged files under the extraction limit.
- **Deadline:** with an enabled deadline, the evidence set freezes at the first of all pages finishing, the adaptive cutoff (once the minimum source count is met) or the ceiling. Freezing cancels queued and in-flight fetches but not extractions already started. Only extractions finished before the freeze enter collation; later successes are saved under `late/` as non-evidence. With the deadline disabled, the freeze waits for every page.
- **Cancellation:** abort from any state cancels and drains owned work. Runtime close cancels every operation and waits for settlement. The acceptance target is 5,000 milliseconds from abort to settlement; deterministic tests with scripted models and local pages settled every exercised phase within 17 milliseconds. Live provider cancellation latency and slow or unresponsive filesystems are not covered.

### Results and Accounting

All operations return their legacy `text`, `details` and `outcome`, plus full operation data and numeric usage; `error` and `aborted` outcomes carry final partial data. Native details keep their existing keys, add `intelli` with the full data and `execution` with the operation receipt. The MCP structured result is a compact projection that keeps the complete text and details and adds operation identity, report location, counts, elapsed time and usage completeness. Its added size is bounded at 8,192 encoded bytes over the legacy envelope; this is an output-size limit, not a measured token saving.

A per-operation attempt ledger records one terminal observation for every dispatched attempt, including errors, timeouts and aborts. Missing provider observations stay unknown rather than zero, and `costComplete` is true only when every dispatched attempt has a provider-reported cost. When a host cancels a call, settled usage may not reach the host: native and MCP receipts then record parent delivery as `unknown`. On native hosts without returned error receipts, an operational failure throws and its partial accounting stays local. Numeric host usage also requires zero placeholders for unobserved provider fields; full accounting preserves their missingness. Hosts that sum only numeric usage can display incomplete session totals after failures as well as cancellation. Neither those totals nor available parent delivery establish complete provider billing.

### Execution Limits

- **Memory:** content limits bound accepted bytes, not process memory. Qualification on *Linux* observed one near-limit 8 MiB page adding ≈140-200 MiB of resident memory and four such pages adding ≈508 MiB, from decoded strings, two full reads by the HTML variant and alternate probe, and repeated parsing. No heap cap is claimed. Parallel MCP operations multiply this.
- **Disk:** every accepted page stays in private staging until the run settles, so staging holds the whole fetched candidate set, up to three bytes per retained character for each page, in both page modes.
- **Child Processes:** each physical request chain starts a child process, adding start-up cost and ≈50-82 MiB peak resident memory per chain in the same qualification.
- **Trust:** the page child uses its own TLS stack with bundled roots plus `SSL_CERT_FILE` and `SSL_CERT_DIR`. `NODE_EXTRA_CA_CERTS` reaches the child's environment but does not affect page trust. Each child receives only an allow-listed environment captured at runtime start; the provider key variable is excluded.
- **Discovery:** documentation discovery has its own cancellation, combined with the operation signal, and is cancelled at finalisation. A download cut off there leaves no diagnostic.
- **Host Sequencing:** registered native `intelli_research` declares parallel execution, because the operation runtime owns its admission, publication and drain. Two research calls in one assistant turn therefore run at the same time and share the session's capacity; earlier releases declared research sequential. Registered `intelli_collate` still declares sequential execution. `Pi` runs a whole batch one call at a time when any call in it targets a sequential tool, so a turn that mixes research with collation (or with any other sequential tool) loses research parallelism. Nested calls made through `ctx.executeTool()` follow the same declarations: sequential nested calls wait for one another on one host queue, while nested research calls do not wait on it. An SDK host that configures the agent with sequential tool execution (`toolExecution: "sequential"`) serialises every batch and every nested call regardless of declarations. On the verified hosts this is an embedder field, not a stock CLI flag or settings key; issuing one research per turn is the user-facing way to keep research serial. Native `intelli_search` and `intelli_extract` keep the host default, which is parallel. Each native session accepts at most 64 active operations; further calls fail with a busy error. MCP admission runs whole operations in parallel within its configured bounds. These host rules were read from the installed `Pi` 1.1.0 and 1.3.0 sources; the 0.86.0 floor host has not been checked. Deterministic actual-host qualification now exercises direct batches as well as nested calls on both verified hosts. Direct batches prove actual allocation/model overlap, shared model/page/fetch bounds, mixed and embedder-wide serial controls, and a permanent dispatched failure alongside a successful sibling with honest partial accounting. These use in-process/loopback fixtures, not live-provider concurrency.

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
│   ├── cache.ts            # Legacy artifacts, locks and index
│   ├── research-result.ts  # Registered research pipeline and finalisation
│   ├── execution-*.ts      # Execution settings and capacity coordinator
│   ├── fetch-client.ts     # Bounded page fetch and documentation discovery
│   ├── page-*.ts           # Child-process transport, staging and deadline
│   ├── run-store.ts        # Run allocation, publication, index and accounting
│   ├── run-*.ts            # Formats, journal, lock and suggestion candidates
│   ├── telemetry.ts        # Injected identity and local sidecar
│   ├── annotations.ts      # Citation harvesting
│   ├── messages.ts         # Prompt messages and cache appendices
│   ├── provenance.ts       # Evidence validation and deterministic source inventory
│   ├── prompts.ts          # System prompts
│   ├── progress.ts         # Host-neutral pipeline progress
│   ├── types.ts            # Shared data types
│   └── util.ts             # Pure helpers and concurrency
├── native-registered-tools.ts  # Registered tool binding
├── native-operation-runtime.ts # Session-scoped runtime, receipts and generations
├── native-operation-context.ts # Legacy helper context and result/progress mapping
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

Registered research and collation write each run once, into a new directory in the `.intelli-v1` namespace below the configured cache root. [Cache and Recovery](CACHE.md) lists every file, the diagnostics and the operator procedures; this section explains the design.

```
.search/
├── .intelli-v1/
│   ├── namespace.json            # Namespace identity
│   ├── allocations.ndjson        # Append-only, checksum-chained journal
│   ├── writer.lock               # Permanent kernel-lock file
│   ├── index.json                # Secondary, rebuildable index
│   └── runs/<label>-<nonce>/     # One directory per admitted run
│       ├── reservation.json
│       ├── committed.json        # Report marker
│       ├── report.md, query.txt, run.json
│       ├── extractions/S1.md, sources/P1.md, late/S4.md
│       ├── accounting.json, accounting.committed.json
│       └── meta.json             # Optional telemetry
├── .staging/                     # Private page staging
├── .index.json                   # Legacy, read only
└── <date>-<slug>-<hash>/         # Legacy runs, read only
```

- **Allocation:** research allocates its run when the operation starts, before search; collation allocates after its input passes validation, before the model call. Under the writer lock, the run store validates the complete journal, namespace identity and the identity of every existing run directory, creates the new run directory with exclusive creation, appends one checksum-chained record with the next sequence number and syncs it, then writes `reservation.json` through a temporary file and rename and syncs the run and `runs/` directories. A crash after the journal sync leaves an allowed gap; sequences are never reused. The directory label is the UTC date plus up to five query words and carries no identity; a 32-character random nonce follows it, and up to 16 collisions are retried.
- **Publication:** all listed files are written and synced inside the owned directory, staged pages are streamed in, and `committed.json` is published last by an atomic rename. That rename is the commit point: before it, cancellation publishes nothing; after it, an abort cannot roll the report back. An existing marker is never replaced. Readers accept only runs whose marker agrees with the journal and reservation and whose files match their recorded lengths and SHA-256 digests. Accounting is appended afterwards with its own marker, is recorded at most once and never invalidates the report. The telemetry sidecar is written after both and is outside the marker inventory. The report's Source Assessment table names extraction and full-page files; research documentation downloads and manual collation's unpaired full pages are listed only in the verified `run.json`.
- **Lock:** `writer.lock` is a permanent regular file locked through the kernel by `fs-native-extensions` `tryLock`, polled every 25 milliseconds for up to 2,000 milliseconds. Process exit releases it, including `SIGKILL`. The file is never unlinked, renamed or truncated, and there is no stale-lock cleanup. No network or model call runs under it. Busy, unsupported or unloadable locking returns an unavailable-persistence diagnostic without discarding the answer.
- **Index:** `index.json` is secondary. A corrupt index is copied aside and rebuilt from verified runs on the next publication; readers rebuild candidates in memory without rewriting it. An oversized index is left untouched and withdraws new-format suggestions. A valid index that lacks a committed run is not corrupt, so that run stays unsuggested until an explicit rebuild. The source contains such a rebuild, `rebuildRunIndex()` in `src/core/run-store.ts`, which preserves the existing index and rewrites only secondary metadata under the writer lock; neither package exposes it as a command or supported export. The index never restores allocation numbering.
- **Useful Answers:** allocation, journal, marker or index failure never erases a computed answer. The result reports `Persistence unavailable` with the diagnostic, or a committed report with an index or accounting diagnostic. Degraded research publishes no report. When its allocation succeeded, the reserved directory keeps its reservation and optional telemetry, and the result reports persistence as `not-requested` without naming that directory; when allocation failed, the degraded result also carries `Persistence unavailable`. Cancelled and failed operations leave their reservation as an incomplete run.
- **Legacy Bridge:** directories and `.index.json` from earlier releases are read for suggestions only, using their stored query and timestamp. Unknown provenance stays unknown, and nothing in the legacy layout is rewritten, rotated or deleted. Old and new writers are isolated by namespace rather than by a shared lock.
- **Retention:** nothing deletes historical or incomplete runs, and index selection is not disk retention. The MCP whole-cache safety scan fails closed at 100,000 entries before inference rather than weakening the scan or deleting files. Journal growth is bounded by a 67,108,864-byte ceiling with no compaction. [Cache Qualification](CACHE-QUALIFICATION.md) records bounded physical growth, near-limit index behaviour, the scan boundary, old/new writer isolation and offline drills on the verified host. Long-term history and other storage remain unverified. Operators can direct new runs to a fresh namespace while preserving the old one, as described in [Cache and Recovery](CACHE.md#offline-archival); that is an explicit new namespace, not a repair, and no automatic reset or retention exists.

Direct legacy helper exports retain the earlier `<date>-<slug>-<hash>/` layout, same-day rotation to numbered siblings and `.index.json` writes for characterisation. The registered tools do not use them.

The persistence protocol is verified by deterministic tests and the mandatory live native research regression on *Linux* x86-64 with *Node.js* 24 on local encrypted btrfs. Other operating systems, network, overlay and remotely shared filesystems, slow storage, long-term growth and the operator recovery procedures are not verified. Path and link checks reject pre-existing escapes; they are not a sandbox against hostile concurrent filesystem mutation.

### Physical and Display Paths

Both cache-writing tools resolve physical paths against the absolute session workspace, including the namespace, lock and staging. Prompts, result details, appendices and report headers use a separate display path, preserving native relative paths such as `.search/.intelli-v1/runs/<run>/`. Absolute and parent-relative native cache settings remain supported.

Pages and documentation downloads stage in unique directories under the configured cache root's `.staging/`, not the operating-system temporary directory. Writers settle before cleanup, including cancellation and publication failure. Failed cleanup can leave a staging directory; there is no automatic sweep. Stop all processes using the cache before inspecting the logged path and removing an abandoned directory; removal does not affect committed runs but discards the working copies of an interrupted run. Native absolute and parent-relative cache settings can place staging outside the workspace; the standalone adapter separately validates workspace containment and rejects existing cache links.

### Telemetry Sidecar

Unless disabled, completed and documented degraded `intelli_research` paths attempt a best-effort `meta.json` write into the run directory, including no links found, all fetches failed and all extractions failed. The write follows publication, so the sidecar is not covered by the report marker. Degraded runs therefore leave telemetry in an unpublished run directory. No sidecar is written when allocation fails, after an observed cancellation or on thrown failures. The `outcome` field records which exit path produced the file, so the analysis script can measure degradation rates, not just success. The schema is owned by `src/core/telemetry.ts` and is additive-only: future versions add optional fields and never rename or remove existing ones.

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
