# pi-intelli-search - Agent Guidelines

This is a **`Pi` extension** that adds intelligent web research tools to the `Pi` coding agent. It provides a 5-stage research pipeline (search, fetch, extract, collate, and cache suggest) as a single tool call, plus individual tools for manual orchestration.

For current cross-host release work, start at [Release Readiness](docs/RELEASE-READINESS.md). The MCP alpha is published and the implementation branch is merged; the [implementation handoff](docs/plans/mcp-intelli-search/README.md) and [Post-Phase 6 Checkpoint](docs/plans/mcp-intelli-search/POST-PHASE-6.md) are historical evidence, not branch-switch instructions. The corrected candidate still requires the owner's explicit publication approval. Its strict configuration and experimental runtime entrypoint are documented in [the package guide](packages/mcp/README.md).

---

## Shell Tool Preferences

Always prefer these over Unix defaults. All are installed and available.

| Task | Tool | Notes |
|------|------|-------|
| Search text | `rg` | Over `grep`. Supports `--json`, `--type`, `--glob` |
| Find files | `fd` | Over `find`. Respects `.gitignore` |
| Find-and-replace | `sd` | Over `sed`. PCRE regex, no escaping pain |
| Code patterns | `sg` (ast-grep) | Structural search. Use instead of regex for function calls, imports, class definitions |
| JSON | `jq` | Query and transform |
| YAML/TOML | `yq` | Query and transform |
| Shell validation | `shellcheck` | Validate any shell script before committing or suggesting |
| Codebase analysis | `scc` | Before major refactors or size/complexity queries |
| Batch operations | `parallel` | Example: `fd -e py \| parallel ruff check` |
| Benchmarks | `hyperfine` | Use `--export-markdown` for results |
| GitHub | `gh` | Release creation, workflow monitoring, repo operations |

---

## Documentation Style Guide

The following style rules are applied consistently across all documentation files. Any changes to documentation must adhere to these rules.

### 1. Em-Dashes

Do not use em-dashes. This applies to **both** forms:

- The typographic em-dash `—` (Unicode U+2014).
- The double-hyphen `--` (often auto-substituted by editors).

Rephrase by replacing with a period, colon, semicolon, or sentence break. Inside tables specifically, replace `**Yes** — explanation` with `**Yes**: explanation` or split into two columns. CI enforces the typographic form (`.github/workflows/ci.yml` greps for U+2014 across all markdown files except this one). The double-hyphen form is harder to lint automatically because it overlaps with CLI flags and table separators, so reviewers must catch it in prose.

**Good:** "Each page is compressed by a dedicated extraction model. The agent context stays clean."
**Avoid:** "Each page is compressed by a dedicated extraction model -- the agent context stays clean."
**Avoid:** "Each page is compressed by a dedicated extraction model — the agent context stays clean."

### 2. Approximately Symbol

Replace `~` with "approximately" when used as an approximation qualifier before numbers (for example, `~50K` becomes `≈50K`, `~$0.05` becomes `≈$0.05`).

Do not change `~` in file paths (for example, `~/.pi/agent/` should remain as-is) or in code blocks where `~` has structural meaning.

### 3. Pi Agent Reference

When referring to `Pi` as the agent or platform, surround it with backticks: `` `Pi` ``. This applies to all documentation, README, skill guides, and architecture docs.

**Good:** "This is a `Pi` extension", "works with any model `Pi` supports"
**Avoid:** "This is a Pi extension", "works with any model Pi supports"

### 4. intelli-search Reference

When referring to `intelli-search` as the program, extension, or package name, surround it with backticks: `` `intelli-search` ``. This does not apply to tool names that already use backticks (for example, `intelli_search`, `intelli_research`).

**Good:** "The `intelli-search` extension", "Install `pi-intelli-search`"
**Avoid:** "The intelli-search extension"

### 5. Heading Capitalization

Markdown headings should use capital letters for the first letter of each word (Title Case). Articles, conjunctions, and prepositions of three letters or fewer are lowercased unless they are the first or last word. The rule applies to **all heading levels** including `####` and to **bold pseudo-headings** such as `**Option A: Use a Pi Built-In Provider**`.

Phrasal-verb particles (`Up`, `Out`, `In`) at the end of a heading are capitalised: `Follow Up`, `Sign In`. All-caps emphasis inside a heading (for example, `When NOT to Search`) is discouraged. Use bold in the body instead, or rephrase the heading.

**Good:** `## How It Works`, `### Why Extract Before Collate?`, `### Creating a Release`
**Avoid:** `## How it works`, `### Why extract before collate?`, `### Creating A Release`

### 6. Emphasis for Names

When stating a proper name such as a product, company, or framework, use italic emphasis (`_name_`). This applies to names like `_Claude Code_`, `_Perplexity Sonar_`, `_Aerospace_`, `_Defuddle_`, `_OpenRouter_`, and similar.

**Good:** "Most coding agents like _Claude Code_ handle web research by..."
**Avoid:** "Most coding agents like Claude Code handle web research by..."

### 6a. Tie-Breaker for Names That Are Also Packages

When a proper name is **also** a package, library, or CLI command, follow the convention that matches the surrounding context:

- **Code or install context (commands, file listings):** backticks. Example: `npm install defuddle`.
- **Prose narrative:** italic emphasis with a link on the **first** mention; thereafter use the plain capitalised name without emphasis. Example: "[_Defuddle_](https://github.com/kepano/defuddle) cleans HTML... Defuddle's quality score..."
- **Tables:** plain capitalised name. No backticks, no italics, no link. Tables are scan-optimised; emphasis adds noise.

This resolves ambiguity for names like Defuddle, MiniMax, OpenRouter, and Sonar that are simultaneously products and routable identifiers.

### 7. Links for Key Components

Add hyperlinks to key components, libraries, and services on their **first prose mention** in each document. Mentions inside tables do not count as the first mention because Rule 6a forbids links in tables; the link is added in the first prose paragraph that names the component instead. This applies to but is not limited to:

- [Defuddle](https://github.com/kepano/defuddle)
- [wreq-js](https://github.com/sqdshguy/wreq-js)
- [linkedom](https://github.com/WebReflection/linkedom)
- [OpenRouter](https://openrouter.ai)
- [Perplexity Sonar](https://docs.perplexity.ai)
- [MiniMax](https://minimax.io)

### 8. Assertive Voice

Documentation describes a working system, not a hopeful one. Avoid:

- **Hedging adverbs:** *typically*, *often*, *generally*, *somewhat*, *fairly*, *roughly*. If a number is approximate, use `≈` per Rule 2; do not also pad the prose with hedges.
- **Diplomatic disclaimers about competing tools:** "do excellent work", "also valuable", "complementary rather than competitive". State what other tools do; let the reader infer the comparison.
- **Apologetic parentheticals:** `(yet)`, `(for now)`, `(roughly)`. Either commit to the claim or remove it.
- **Editorial scare quotes:** for example, `so-called "AI"`. State the term plainly.

Prefer present-tense indicative. "The pipeline caches results." beats "The pipeline can cache results."

### 9. Numbers and Versions Are Single-Sourced

Test counts, version numbers, and stat references must appear in **one canonical location** and be referenced from elsewhere, not duplicated. When a number changes, only the canonical source needs editing.

- **Test count canonical:** `README.md` badge.
- **Version canonical:** `package.json` -> `version`, mirrored in `CHANGELOG.md`.
- `AGENTS.md` should describe **how** to run tests, not assert a count.

### 10. README Image Width

All images in `README.md` must use a consistent `width="800"` attribute. This applies to infographics, pipeline diagrams, and sponsor banners.

**Good:** `<img src="docs/images/example.png" alt="..." width="800" />`
**Avoid:** Widths other than 800, or omitting the width attribute.

**Note:** The `Pi` packages website does not support `.avif` images. Use `.png` or `.webp` for README images that will appear on the packages site.

### 11. Narrow JSON Blocks for Mobile Readability

When displaying JSON or JSONC configuration blocks in documentation, break nested objects and arrays onto separate lines. Keep each line under roughly 60 characters so the block is readable on narrow viewports (mobile, split-pane) without horizontal scroll.

Scalar key-value pairs (strings, numbers, booleans) can stay on one line. Objects and arrays start their content on a new line.

**Good (narrow):**
```jsonc
{
  "pi-intelli-search": {
    "searchModel": {
      "provider": "openrouter",
      "model": "perplexity/sonar"
    },
    "maxUrls": 8,
    "cacheDir": ".search",
    "fetchConcurrency": 4
  }
}
```

**Avoid (wide — causes horizontal scroll on mobile):**
```jsonc
{
  "pi-intelli-search": {
    "searchModel": { "provider": "openrouter", "model": "perplexity/sonar" },
    "maxUrls": 8,
    "cacheDir": ".search",
    "fetchConcurrency": 4
  }
}
```

The "Customise (Optional)" and "Model Configuration" sections in README.md use this format. All documentation examples should follow it.

### 12. One Hand-Edited README

The root `README.md` is the only README to edit by hand. `scripts/generate-package-readmes.mjs` derives each package's README from it: `packages/mcp/README.md` and the root previews `pi.README.md` and `mcp.README.md` are real generated files (never symlinks: npm drops a symlinked README and GitHub does not render one), committed and drift-checked in CI (`npm run check:readmes`), which also fails when a derived link does not resolve. The native package ships the root path itself, so its `prepublishOnly` hook writes the same derivation over the root README at publish time. Never edit `packages/mcp/README.md` or the root `*.README.md` previews directly. Tag package-specific sections with `<!-- packages:pi -->` or `<!-- packages:mcp -->` and `<!-- /packages -->`, repository-only sections with `<!-- packages:none -->`, and content only a package shows (its title and badges) with a hidden `<!-- packages:mcp hidden` ... `-->` block. Untagged content goes to both packages. The root `README.md` section `Development` documents the syntax. After any README edit run `npm run generate:toc` and `npm run generate:readmes`.

---

## Git Commit Messages

When creating commits:

- The first line must summarise succinctly what has occurred. When many things have happened, focus on the majority.
- Bullet points should be concise and summarise the changes.
- Avoid multiple "add" statements unless necessary. A single statement can cover multiple related items (for example, helper functions).
- Always check for changes before committing. Do not assume changes you made still exist, as files are often manually edited.

## Project Overview

- **Package name:** `@curio-data/pi-intelli-search`
- **Language:** TypeScript (ESM, strict mode).
- **Runtime:** Node.js (runs inside `Pi`'s extension host).
- **Build:** `tsc` to `dist/`.
- **Test:** `npm test` uses `scripts/run-tests.mjs` to run Node's test runner with private home, agent and scratch directories. Test count is shown by the badge in `README.md`.
- **Package manager:** `npm`.
- **License:** Apache-2.0 (Copyright 2026 Ashraf Miah, Curio Data Pro Ltd).

## Key Dependencies

| Package | Role |
|---------|------|
| [wreq-js](https://github.com/sqdshguy/wreq-js) | Browser-grade TLS/HTTP fingerprinting for page fetching |
| [defuddle](https://github.com/kepano/defuddle) | HTML content extraction (strips nav, ads, sidebars to Markdown) |
| [linkedom](https://github.com/WebReflection/linkedom) | Lightweight DOM for [defuddle](https://github.com/kepano/defuddle) (no full browser) |
| `@earendil-works/pi-ai` | LLM calling via `Pi`'s auth system (`Pi` >= 0.86: registry facade; older: provider `streamSimple()`; root entrypoint, not the deprecated `/compat` shim) |
| `@earendil-works/pi-coding-agent` | Extension API types (`ExtensionAPI`, `ExtensionContext`) |
| `typebox` | JSON Schema and parameter definitions for tool inputs |

All `Pi` SDK packages are **peer dependencies**. They are provided by the hosting `Pi` process and are not bundled.

## Source Structure

```
pi.README.md                  # Generated native package README preview; never edit by hand
mcp.README.md                 # Generated MCP package README preview; never edit by hand
src/
├── index.ts                  # Extension entry: registers tools, events, model setup
├── core/                     # Host-neutral execution and shared helpers
│   ├── operations/          # Search, extract, collate and five-stage research
│   ├── contracts.ts         # Context, model, result, progress and identity interfaces
│   ├── index.ts             # Host-neutral engine exports
│   ├── defaults.ts          # Shared tuning; no provider/model selection
│   ├── schemas.ts           # Canonical tool parameters
│   ├── llm.ts               # Single model retry/timeout policy
│   ├── paths.ts             # Physical roots and display policy
│   ├── cache.ts             # Artifacts, locks and index
│   ├── fetch.ts             # Dual page fetch and documentation downloads
│   ├── console.ts           # Async-scoped dependency diagnostic suppression
│   ├── annotations.ts       # Citation harvesting
│   ├── messages.ts          # Message and appendix builders
│   ├── prompts.ts           # System prompts
│   ├── progress.ts          # Host-neutral stage progress
│   ├── telemetry.ts         # Local sidecar with injected identity
│   ├── types.ts             # Shared data types
│   └── util.ts              # URL, concurrency and resilience helpers
├── native-operation-context.ts # Trusted native settings, paths and result/progress mapping
├── native-model-client.ts    # Per-operation model adapter delegating to callLlm()
├── native-identity.ts        # Native package identity from the installed manifest
├── agent-dir.ts              # Native agent-directory discovery, kept out of shared utilities
├── host-types.ts             # Native update callback, tool result and theme types
├── annotations.ts            # Forwarding export to core/annotations.ts
├── llm.ts                    # Native auth, dispatch and hooks; invokes core model policy once
├── fetch.ts                  # Forwarding export to core/fetch.ts
├── prompts.ts                # Forwarding export to core/prompts.ts
├── providers.ts              # Custom model registration (Perplexity models) into models.json
├── settings.ts               # Settings loader with caching and invalidation
├── cache.ts                  # Forwarding export to core/cache.ts
├── telemetry.ts             # Native compatibility facade; implementation in core/telemetry.ts
├── types.ts                  # Forwarding export to core/types.ts
├── util.ts                   # Core utility forwards plus native diagnostic prefix
└── tools/
    ├── intelli-research.ts   # Native research registration, progress mapping and renderer
    ├── intelli-search.ts     # Native search registration and wrapper
    ├── intelli-extract.ts    # Native extraction registration and wrapper
    ├── intelli-collate.ts    # Native collation registration and wrapper
    └── shared.ts             # Forwarding export to core/messages.ts

packages/
└── mcp/
    ├── package.json         # Standalone artifact and explicit runtime dependencies
    ├── src/                 # CLI, strict config, workspace, provider, runtime and protocol adapters
    ├── test/                # Config, CLI, console, provider, operation and protocol coverage
    ├── tsconfig.json        # Standalone source and test type check
    └── README.md            # Generated from the root README; never edit by hand

guidance/
├── research-guide.md        # Shared host-neutral guidance source (token template)
└── setup-*.md               # Per-host setup fragments rendered into plugin skills

plugins/
├── claude-code/             # Generated Claude Code bundle (manifest, .mcp.json, skill)
└── codex/                   # Generated Codex bundle (compatibility manifest, .mcp.json, skill)

.claude-plugin/marketplace.json   # Generated Claude Code repository marketplace
.agents/plugins/marketplace.json  # Generated Codex repository marketplace

skills/
└── intelli-search/
    └── SKILL.md              # Agent-facing skill guide

docs/
├── ARCHITECTURE.md           # Detailed pipeline and design decisions
├── BENCHMARKS.md             # Extract/collate model benchmark: methodology, harness, recorded results
├── COMPONENTS.md             # Third-party dependency attribution
└── plans/mcp-intelli-search/ # Cross-host research, checkpoints and implementation handoff

scripts/
├── analyze-sessions.sh       # Aggregate meta.json telemetry sidecars across sessions
├── benchmark-models.sh       # A/B benchmark harness for extract/collate models (live quota)
├── plot-downloads.mts       # Download chart generation (npm run chart)
├── README.md                # Script usage guide
├── build-mcp.mjs            # Audited standalone bundles and legal-file copies
├── generate-package-readmes.mjs # Package READMEs from the root README; --check is the drift gate
├── generate-toc.mjs         # README contents generator; --check is the drift gate
├── generate-plugin-bundles.mjs # Plugin/marketplace generator; --check is the drift gate
├── verify-mcp-install.mjs    # Production-only install and native-fetch verification
└── capture-native-contract.mts # Explicit compatibility-fixture regeneration

test/
├── annotations.test.ts
├── cache.test.ts
├── compat-guard.test.ts
├── core-boundary.test.ts     # Source/declaration audit and isolated runtime
├── core-cache.test.ts        # Independent-process cache writes and metadata
├── core-console.test.ts      # Concurrent diagnostic scopes and restoration
├── core-llm.test.ts          # Shared retry/timeout/cancellation policy
├── core-operations.test.ts   # Injected engine outcomes, staging and cancellation
├── native-model-client.test.ts # Native adapter state and policy delegation
├── workspace-paths.test.ts   # Workspace/display path separation
├── telemetry.test.ts
├── fetch.test.ts
├── index.test.ts
├── llm.test.ts
├── native-contract.test.ts
├── fixtures/native-contract/ # Frozen tool, prompt, result, cache and telemetry contracts
├── helpers/native-contract.ts # Isolated native contract capture
├── helpers/core-context.ts   # Host-free deterministic operation context
├── probes/mcp-sdk.mjs         # Optional isolated SDK interface probe
├── probes/mcp-install.mjs     # Installed standalone operations and native fetch assets
├── tsconfig.native-contract.json # Type check for contract tests and generator
├── prompts.test.ts
├── plugin-bundles.test.ts    # Generated plugin/marketplace shape, pins and drift gate
├── package-readmes.test.ts   # README block selection, link rewriting, drift gate and publish swap
├── providers.test.ts
├── research.test.ts
├── research-telemetry.test.ts
├── shared.test.ts
├── e2e/
│   ├── 01_main.sh
│   ├── 02_cap.sh
│   ├── 03_model_override.sh
│   ├── 04_migration.sh
│   ├── 05_collation_limits.sh
│   ├── 06_extract_limits.sh
│   ├── 07_llms_full.sh
│   ├── 08_websearch_tool.sh
│   ├── 09_sonar_pro_search.sh
│   ├── 10_config_recipes.sh
│   ├── 11_mcp_stdio.sh
│   ├── 12_plugin_bundles.sh
│   ├── 13_claude_code_plugin.sh
│   ├── 14_codex_plugin.sh
│   ├── env.sh
│   └── lib.sh
├── run-e2e-all.sh
├── run-e2e-publish.sh
├── run-e2e-publish-local.sh
├── settings.test.ts
├── smoke.ts
└── util.test.ts
```

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full pipeline description, design decisions, and fetch strategy.

### Pipeline (`intelli_research`)

1. **Search:** a search-grounded model (default [_Perplexity Sonar_](https://docs.perplexity.ai) via [OpenRouter](https://openrouter.ai)) returns a synthesised answer; prose links are merged with harvested `url_citation` annotations before the URL list is clamped. Alternatives: `perplexity/sonar-pro-search` (model swap) or any OpenRouter chat model plus the `searchWebSearch` server tool.
2. **Fetch:** Each page is fetched two ways in parallel (HTML to [Defuddle](https://github.com/kepano/defuddle) and Markdown variant). They are compared by quality score; the best is picked.
3. **Extract:** Configurable model (default: MiniMax M3) per-page extraction (bounded-parallel via `extractionConcurrency`, default 4), compressing ≈50K to ≈3-5K chars.
4. **Collate:** Configurable model (default: MiniMax M3) deduplicates across extractions, produces summary and cache.
5. **Cache suggest:** LLM judge (extract model) compares current query against `.search/.index.json` and appends related previous searches to the output. This is purely additive and never blocks or gates the main result.

The pipeline is self-contained in `src/core/operations/research.ts`. Former shared module paths (`fetch.ts`, `cache.ts`, `annotations.ts`, `prompts.ts`, `types.ts`, `util.ts`) forward to implementations under `src/core/`. Current `Pi` hosts expose `ctx.executeTool()` for nested tool calls, but this pipeline does not depend on that newer capability. Direct stage execution preserves the supported native baseline and the planned host-independent engine boundary.

### LLM Integration

- All four native tools construct a context through `src/native-operation-context.ts` and invoke shared operations from `src/core/operations/`. `createNativeModelClient()` delegates to `callLlm()` without adding retries or provider fallback. `callLlm()` invokes `runModelWithPolicy()` in `src/core/llm.ts` exactly once. The core owns no host context, settings discovery or credentials. Run `test/core-*.test.ts` for dependency boundaries, engine operations, policy and cache tests, plus `node_modules/.bin/tsc -p test/tsconfig.native-contract.json` for their type check.
- Dispatches by feature detection. On `Pi` >= 0.86 it calls `ctx.modelRegistry.streamSimple()` (the registry facade added in `Pi` 0.86.0), which normalises the context, resolves auth, and applies the `baseUrl` override internally. On `Pi` 0.81.1-0.85.x it calls `ctx.modelRegistry.getProvider(provider).streamSimple()` (root `@earendil-works/pi-ai` API) with auth resolved by `Pi` (`getApiKeyAndHeaders`) and the `baseUrl` override mirrored from `ModelRuntime.prepareRequest`. Critical contract: on `Pi` >= 0.86 a raw context passed straight to a provider silently drops `systemPrompt` (providers read the prompt from the transcript's system messages); never call `provider.streamSimple()` directly on those versions. Neither path uses the deprecated `pi-ai/compat` `completeSimple()` shim nor `ModelRegistry.complete()` (which drops the provider-neutral reasoning parameter). Both send `reasoning: "low"`, which MiniMax M3 and other reasoning models require; the search stage overrides it per call (`minimal` when the web search tool is enabled). `test/compat-guard.test.ts` enforces that no file imports `pi-ai/compat`. Models registered outside `Pi`'s registry (for example `pi-ai`'s `registerFauxProvider`) are not consulted.
- **Per-call payload patching and reasoning.** `callLlm()` accepts `payloadPatch` (forwarded as pi-ai's `onPayload`) and `reasoning` (default `"low"`). The search stage uses both to attach `openrouter:web_search`. A patch must return the payload untouched when it does not apply and never overwrite an existing `tools` array.
- **Annotation side channel.** When `annotations` is passed, `callLlm()` injects a wrapped `fetch` through `ProviderRequestOptions.fetch` that tees each response body and parses `url_citation` entries into the sink. Every attempt has a separate sink, preventing late reads from failed attempts from contaminating successful citations. `callLlm()` awaits successful background reads (bounded at 2s) before copying citations to the caller. Every failure in this path is swallowed by design. **Both hooks fail silently if upstream pi-ai changes them**: re-check `ProviderRequestOptions.fetch`, `onPayload` and the structural compatibility of the local `FetchFunction` alias in `src/annotations.ts` with the host fetch hook on every peer-dependency bump; `test/annotations.test.ts` covers the parser, not the injection point.
- Auth flows through `Pi`'s native system (`auth.json`, env vars, OAuth). No API key management happens in this code.
- **Retry and timeout are owned by `src/core/llm.ts`, not the SDK.** Native `callLlm()` passes `maxRetries: 0` to the provider stream and invokes the shared policy, which wraps each call in `withRetry()` (full-jitter exponential backoff, honours Retry-After, bounded by `llmRetryAttempts`/`retryBaseDelayMs`/`retryMaxDelayMs`). On the OpenRouter path a 429 does not arrive as a non-2xx status: the SDK throws after its retries and the stream resolves with `stopReason: "error"` and the status in `errorMessage`, which the retry classifier inspects. The `onResponse` callback only observes (it captures a Retry-After header); it must never throw, because a throw propagates out of the stream and bypasses retry.
- **Per-call timeout via `callWithAbortTimeout()` (`src/core/util.ts`).** The SDK request timeout does not cover a stalled streaming body, so the shared model policy aborts the whole call with an `AbortController` after `llmTimeoutMs`, combined with the tool's signal so Esc still cancels. Actual timer expiry is retryable; permanent provider exceptions are not classified as timeouts. Cancellation also propagates through stage boundaries and cache-lock waits.
- **Routine fetch and retry notices must not write directly to the console.** Raw terminal writes bypass the `Pi` TUI renderer. The branch removes routine fetch-comparison output and routes native retries through `ModelRequest.onRetryNotice` into stage progress; when no callback is supplied, the native model client provides a no-op and native `callLlm()` uses a silent policy logger. The shared policy retains its logger fallback for other adapters; MCP research can send retry progress while catalogue preflight and one-shot calls use stderr. Telemetry records aggregate variant winners (`fetch.winners`), not per-page scores. Native operation error logging remains outside this targeted fix. The source audit covers direct console calls, not transitive logger calls. The native patch preparation on `main` is unreleased; see [the current handoff](docs/plans/mcp-intelli-search/POST-PHASE-5.md) for the owner's release hold.
- **Policy Scope.** Configured model retries and application timeouts apply inside `intelli_research`. The native standalone search, extract and collate operations retain one attempt and no application-level timeout for compatibility. The standalone MCP adapter must apply explicit policy defaults for all its model calls before exposing tools.
- **Application-level search retry.** Stage 1 retries up to `searchRetryAttempts` times when the search model returns a valid response with zero usable links (a degraded 200 that transport retry cannot catch).
- **Optional extract throttle.** `minRequestIntervalMs` (default 0, off) spaces concurrent extract calls via a per-run rate limiter for keys with tight rate limits.
- Provider-response monitoring via `after_provider_response` event surfaces a rate-limit status in the `Pi` footer even outside tool calls.
- **Caveat:** `pi -p` (used by the E2E scripts) drives `Pi`'s own agent-loop LLM calls (tool selection and final summary). Those go through `Pi`'s provider path and are **not** wrapped by `callLlm()`'s retry/timeout. A hung `pi` with no open network connection is agent-loop behaviour, not this extension.

### Model Registration

The [_Perplexity_](https://docs.perplexity.ai) models (`perplexity/sonar`, `perplexity/sonar-pro`, `perplexity/sonar-pro-search`) are not in `Pi`'s built-in model list. The extension merges them into `~/.pi/agent/models.json` on first `session_start` (idempotent, non-destructive, adding only what is missing). Never use `registerProvider()` for [OpenRouter](https://openrouter.ai) because that would replace all OpenRouter models.

### Fetch Strategy

Each page gets dual-fetched:
1. HTML to [Defuddle](https://github.com/kepano/defuddle) (browser TLS fingerprint and content extraction).
2. Markdown variant (`Accept: text/Markdown` header, or `<link rel="alternate">` discovery).
3. Quality comparison (score on code blocks, headings, tables. Penalise nav chrome).

After extraction, every unique domain in the results is probed for `llms-full.txt` documentation files. Built-in mappings resolve non-standard paths for [Cloudflare](https://developers.cloudflare.com) (product-scoped), [Next.js](https://nextjs.org), and [Vite](https://vite.dev). All other domains use the standard `/llms-full.txt` convention. Discovered files are stored raw in `sources/`. Set `disableLlmsFullDiscovery: true` to opt out.

### Settings

Loaded from `~/.pi/agent/settings.json` and, only for trusted projects, `<project>/<CONFIG_DIR_NAME>/settings.json`. The nested `pi-intelli-search` namespace is preferred; flat `intelli*` prefixed keys are a deprecated fallback. Cached by agent directory, project directory, trust state, and configuration-directory name, then invalidated on `session_start`. Rate-limit resilience keys (`llmTimeoutMs`, `llmRetryAttempts`, `retryBaseDelayMs`, `retryMaxDelayMs`, `searchRetryAttempts`, `minRequestIntervalMs`) tune retry, timeout, and throttling. The `searchWebSearch` block (OpenRouter web search server tool, off by default, OpenRouter provider only) replaces the whole default object when set: there is no per-key merge, and an omitted `reasoning` falls back to `low`. See README for all settings keys and defaults (the canonical reference).

### Cache

Written to `.search/<date>-<slug>-<hash>/` with `report.md`, `query.txt`, `meta.json`, `extractions/`, `sources/`, and `.index.json`. A successful same-day repeat archives the previous run's artefact set to a numbered sibling folder (`<slug>.1`, then `.2`; `rotateCacheArtefacts()`, best-effort with a logged fallback to in-place replacement) before committing the new set; `llms-full-*` downloads stay with the live folder. A degraded repeat preserves a prior successful report, extractions, sources and index entry untouched and records only the failed attempt in `meta.json`. Physical paths, including indexes and locks, resolve against `ctx.cwd` rather than the process directory. Prompts, report headers and results use a separate configured display path. `makeCachePath()` returns an absolute physical path; use `displayCachePath()` for native text. Absolute and parent-relative native cache settings remain supported.

Documentation downloads use unique directories below the configured cache root's `.staging/`. No download runs under a cache lock. Writers settle before cleanup in `finally`, including cancellation and cache-write failure. Optional staging setup and cleanup errors are logged without discarding the research result. Native absolute and parent-relative cache settings remain valid, so staging can lie outside the workspace; standalone containment checks are a separate adapter responsibility.

**Telemetry sidecar** (v0.11.0+). Each `intelli_research` run also writes a local-only `meta.json` into its cache directory, recording per-stage outcomes (pages fetched/failed, fetch-variant winners, links returned and annotations harvested, search-retry, cache-suggest hits, latency). The schema is owned by `src/core/telemetry.ts`, is additive-only, and carries an independent `schemaVersion` decoupled from `extensionVersion`. The write is atomic (temp file then `rename`) and fail-safe: failures are caught and logged, never surfacing to the pipeline result. Suppressed entirely when `disableTelemetry` is true. No network call is added; the word "telemetry" refers to local runtime signals, not remote reporting. The adapter injects package identity; the core never discovers its own package version. Native records retain their legacy shape, while non-native records add optional `packageName` and `adapter` fields. The bundled `scripts/analyze-sessions.sh` aggregates both record forms.

**Cache suggest** (Stage 5) reads `.index.json` back after each research call. It feeds up to 20 recent entries to an LLM judge (using the extract model for cost efficiency) which returns semantically related previous searches. Results are formatted as a `📚 Related cached searches` table appended to the tool output. This is purely supplementary. The live search always runs, and the cache suggestions give the agent (and user) a pointer to prior research if live results are insufficient.

## Development Commands

```bash
npm install              # Install deps
npm run build            # TypeScript -> dist/ (tsc)
npm run dev              # Watch mode (tsc --watch)
npm test                 # Run native unit tests
npm run build:all        # Native build, standalone type check and bundles
npm run test:all         # Native and standalone deterministic tests
npm run test:mcp:install # Independent production install and native fetch probe
npm run generate:toc     # Regenerate README contents from headings
npm run check:toc        # Fail if README contents drift from the generator
npm run generate:plugins # Regenerate plugin bundles and marketplaces after a version change
npm run check:plugins    # Fail if committed plugin files drift from the generator
npm run generate:readmes # Regenerate packages/mcp/README.md and the root *.README.md previews
npm run check:readmes    # Fail if package READMEs drift from the root README
npm run restore:readme   # Restore the root README after a local publish or publish dry run
npm run test:smoke       # Smoke test (structural validation)
./test/e2e/01_main.sh        # End-to-end test (live LLM calls, isolated env)
scripts/benchmark-models.sh <model-id>...   # A/B benchmark extract/collate models (live quota, see docs/BENCHMARKS.md)
```

**Testing in `Pi`:**
```bash
pi -e ./dist/index.js    # Load extension for testing
pi install /path/to/pi-intelli-search   # Install as package
```

## Required API Keys

In `~/.pi/agent/auth.json`:
- **OpenRouter** (`openrouter`): A single key covers all three pipeline stages (search, extract, collate).

All three model roles (search, extract, collate) are configurable via `~/.pi/agent/settings.json`. Any model in `Pi`'s registry works. This includes built-in providers, [OpenRouter](https://openrouter.ai) models, or models from other extensions. See README "Model Configuration" section for details.

## Coding Conventions

- **ESM throughout:** `package.json` has `"type": "module"`. Imports use `.js` extension.
- **Strict TypeScript:** No `any` unless interfacing with untyped `Pi` internals (for example, `ctx.modelRegistry as { refresh?: () => void }`).
- **Extension API pattern:** Single `export default function(pi: ExtensionAPI)` in `index.ts`.
- **Tool definition pattern:** Each tool exports an object with `name`, `label`, `description`, `promptSnippet`, `promptGuidelines`, `parameters` (TypeBox schema), and `execute()`.
- **Error handling:** Extraction failures are caught per-page (do not fail the whole pipeline). Transient failures (429, 5xx, timeouts) are retried with full-jitter backoff honouring Retry-After; a failure that survives all attempts throws an actionable error.
- **`Pi` 0.81.1 baseline:** The extension uses the supported settings trust APIs, `CONFIG_DIR_NAME`, async model-registry refresh semantics, and `modelRegistry.getProvider()` from this version; it feature-detects the `Pi` >= 0.86 registry facade for LLM dispatch.
- **Standalone Boundary:** `packages/mcp/` bundles only the shared core and adapter source; every external runtime dependency belongs in its manifest. Keep `Pi` libraries out of the standalone runtime and MCP protocol libraries out of the native extension runtime. The protocol SDK (`@modelcontextprotocol/server`) belongs only to the standalone package. Shared tuning lives in `src/core/defaults.ts`; native model defaults remain in `src/settings.ts`. Preserve both tarball-install gates. The standalone cache link checks reject existing escapes but are not a sandbox against concurrent hostile filesystem mutation.
- **Self-Contained Pipeline:** `intelli_research` executes its stages directly rather than invoking registered host tools. Keep that design for baseline compatibility and host-independent reuse, even on hosts that provide `ctx.executeTool()`.
- **SPDX headers:** Source files include `// SPDX-License-Identifier: Apache-2.0` and copyright notices.

## Testing Conventions

### Test Structure

- Test files in `test/` mirror `src/` structure: `cache.test.ts`, `fetch.test.ts`, `settings.test.ts`, etc.
- Run with `node --import tsx --test` (Node.js built-in test runner).
- Test count is shown by the badge in `README.md`.
- `scripts/run-tests.mjs` isolates `HOME`, `PI_CODING_AGENT_DIR` and `TMPDIR` for `npm test`, standalone tests and structural smoke. Filesystem tests must also isolate their own mutable state; never hard-code the operator's agent directory.

### Test Categories

| Category | Purpose | Files | Network |
|---|---|---|---|
| **Structural/smoke** | Extension loads, tools register, events bind | `smoke.ts` | No |
| **Shared Engine** | Host boundary, injected operations, policy, concurrent cache writes and console scopes | `core-*.test.ts`, `native-model-client.test.ts`, `workspace-paths.test.ts` | No |
| **Unit (pure logic)** | Functions without filesystem or network deps | `annotations.test.ts`, `cache.test.ts`, `telemetry.test.ts`, `prompts.test.ts`, `util.test.ts` | No |
| **Deterministic integration** | Functions that read files, with temp-directory isolation | `index.test.ts`, `settings.test.ts`, `providers.test.ts`, `research.test.ts` | No |
| **E2E** | Full pipeline with real LLM calls in isolated Pi env | `e2e/01_main.sh`, `e2e/02_cap.sh`, `e2e/06_extract_limits.sh`, `e2e/05_collation_limits.sh`, `e2e/07_llms_full.sh`, `e2e/04_migration.sh`, `e2e/03_model_override.sh`, `e2e/08_websearch_tool.sh`, `e2e/09_sonar_pro_search.sh`, `e2e/10_config_recipes.sh`, `e2e/11_mcp_stdio.sh` (and `run-e2e-all.sh` to run them sequentially) | Yes |
| **Publish** | Validates the published npm package structure | `run-e2e-publish.sh` (registry install), `run-e2e-publish-local.sh` (local tarball install; CI gate for peer-dep drift) | Yes (npm only) |

### Principle 1: Tests Must Be Deterministic

No test may depend on the state of the host machine's `~/.pi/agent/` directory, environment variables from the developer's shell, or network availability (except E2E tests, which are isolated).

**Pattern for filesystem isolation:**

```typescript
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pi-intelli-test-"));
process.env.PI_CODING_AGENT_DIR = dir;  // isolate from ~/.pi/agent

// Write specific config files for the scenario
writeFileSync(join(dir, "auth.json"), JSON.stringify({ openrouter: { ... } }));
writeFileSync(join(dir, "models.json"), "{}");

// ... run test ...

// Restore env in finally block
delete process.env.PI_CODING_AGENT_DIR;
```

**Pattern for working-directory isolation (when code reads from `process.cwd()`):**

```typescript
const savedCwd = process.cwd();
const cwd = mkdtempSync(join(tmpdir(), "pi-intelli-cwd-"));
process.chdir(cwd);
// ... create .pi/settings.json, .search/.version.json, etc. ...
// ... run test ...
process.chdir(savedCwd);
```

### Principle 2: Every Scenario Needs a Test

Each user-facing behavior must have at least one deterministic test that asserts exact outcomes. Examples from this codebase:

| Scenario | Test location | Mechanism |
|---|---|---|
| Fresh install, no API key | `index.test.ts` | Temp dir, no auth.json → assert auth warning fires |
| API key present in auth.json | `index.test.ts` | Temp dir, write auth.json → assert no warning |
| Upgrade from old version with flat keys | `index.test.ts` | Temp CWD with `.search/.version.json` + flat keys → assert deprecation notice |
| Model typo in settings | `research.test.ts` | Mock modelRegistry returning null → assert missing models detected |
| Default migration on upgrade | `settings.test.ts` | User settings match old default → assert migrated to new default |
| Default migration with custom model | `settings.test.ts` | User customized extract model → assert NOT migrated |
| Nested settings namespace | `settings.test.ts` | Temp dir with `pi-intelli-search` key → assert values read |
| Flat key fallback | `settings.test.ts` | Temp dir with `intelli*` keys → assert values read as fallback |

### Principle 3: Fail Fast Before Cost

Configuration errors (model typos, missing keys) must be caught before LLM calls incur cost. The `intelli_research` pre-flight validation checks all three models exist in the registry before Stage 1 begins. This is tested in `research.test.ts` with a mocked model registry.

### Principle 4: E2E Tests Exercise Real Config Paths

E2E tests run in isolated `PI_CODING_AGENT_DIR` environments and exercise the settings formats users actually write. The scenario scripts below run through the sequential runner:

| Test | What it proves |
|---|---|
| `e2e/01_main.sh` | Default pipeline (Sonar + M3 via OpenRouter) works end-to-end with nested settings |
| `e2e/04_migration.sh` | Upgrade from 0.7.0 defaults auto-migrates to 0.8.0 OpenRouter defaults |
| `e2e/03_model_override.sh` | Model override in `pi-intelli-search` settings namespace is read and used |
| `e2e/02_cap.sh` | `defaultUrls` and `maxUrls` (cap) are enforced; agent requests above cap are silently clamped |
| `e2e/06_extract_limits.sh` | `extractMaxChars` and `extractionMaxTokens` are enforced; back-to-back comparison proves truncation |
| `e2e/05_collation_limits.sh` | `collationMaxTokens` is enforced; back-to-back comparison proves output clamping |
| `e2e/07_llms_full.sh` | Automatic llms-full.txt discovery works; probes candidate sites, verifies file lands in cache |
| `e2e/08_websearch_tool.sh` | Exercises the configured server-tool path with a chat model: verifies the selected model, non-empty links, completed pipeline, and cached sources. Annotation count is diagnostic, not a pass condition |
| `e2e/09_sonar_pro_search.sh` | Verifies registration and settings-based selection of `perplexity/sonar-pro-search` in a vanilla agent dir, then checks non-empty links, completed pipeline, and cached sources. Reports the annotation count |
| `e2e/10_config_recipes.sh` | Runs each README Configuration Recipe's settings block in a fresh isolated agent dir + cwd and asserts the effective behaviour from telemetry: zero-config defaults, partial blocks preserving unspecified defaults, extract/collate overrides, free-tier pacing keys, and per-project settings via pre-seeded trust.json (the only project-level-settings coverage) |
| `e2e/11_mcp_stdio.sh` | Builds the standalone package, registers it in an isolated profile's `mcp.json` (direct exposure, no native extension) and drives a real research through `Pi`'s native MCP client, asserting connection, workspace cache, `mcp` telemetry identity and completed outcome. Establishes that `--no-extensions` disconnects MCP servers and that `codemode` exposure hides direct tool calls |
| `e2e/12_plugin_bundles.sh` | Packs the standalone artifact, generates local-tarball plugin bundles (pre-publication evidence class), vendors the tarball, then exercises real host installation credential-free: Claude Code strict validation, marketplace add, install, `claude mcp list` connection and skill discovery; Codex marketplace add, catalog-path assertion, install, installed-cache layout and prompt-input skill discovery. Skips with a notice when a host CLI is absent. Also asserts Claude Code key delivery with dummy values: the required sensitive key option withholds the server while unset and reaches the server process once set. Credentialed sessions live in `13_claude_code_plugin.sh` and `14_codex_plugin.sh` |
| `e2e/13_claude_code_plugin.sh` | Installs the local-tarball Claude Code plugin into an isolated `CLAUDE_CONFIG_DIR`, sets the key through the plugin option only, and drives one real research through `claude -p`: asserts the session reports the server connected, the model calls `intelli_research` without a tool error, and the project cache carries a completed `mcp` sidecar. Authenticates with `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` (static, never stored or refreshed), never a copied credential file, and asserts the operator's credential file is untouched |
| `e2e/14_codex_plugin.sh` | Installs the local-tarball Codex plugin into a dedicated test profile (`.e2e-auth/codex`, reset to its `auth.json` on every run because Codex caches plugins by version), pre-approves the plugin's tools, exports the forwarded variables and drives one real research through `codex exec --json`: asserts a completed `intelli_research` `mcp_tool_call` and a completed `mcp` cache sidecar. Uses a separate ChatGPT login refreshed in place by one consumer at a time (exclusive lock), never a copy of `~/.codex`, and asserts the operator's `auth.json` is untouched |
| `run-e2e-all.sh` | Runs every scenario script one at a time with a spacing gap (`E2E_GAP_SECONDS`, default 20). Use this instead of launching scripts in parallel or back-to-back: bursting many calls at one key depletes the rate-limit bucket and produces degraded or hung runs. |

The scenarios write the nested `pi-intelli-search` format in `settings.json`, matching the recommended user configuration.

**Rate-limit caution:** the scenario scripts consume live provider quota. Run them through `run-e2e-all.sh` (or singly with gaps) on free or shared keys. The paired limit comparisons (`e2e/06_extract_limits.sh`, `e2e/05_collation_limits.sh`) use one official documentation source and an internal cooldown (`E2E_RUN_GAP_SECONDS`, default 30) between runs.

### Principle 5: E2E Scripts Must Be Proven Runnable

No E2E script may be committed without being executed at least once to completion. A script that has never run is not a test: it is a wish.

- **Before committing a new E2E script**, run it with a real API key and confirm it exits 0 with the expected verification checks passing.
- **`shellcheck` is mandatory.** Every shell script must pass `shellcheck` with zero findings. This catches unbound variables, quoting bugs, and syntax errors that `set -euo pipefail` alone will not catch until runtime.
- **`set -euo pipefail` is mandatory** at the top of every E2E script. The `-u` flag turns any reference to an undefined variable into a hard error. If a script references `$E2E_EXTENSION_PATH` or any other variable, it must define that variable before first use. No E2E script may depend on variables from the caller's environment (except `OPENROUTER_API_KEY` and, for host-session scenarios, `CLAUDE_CODE_OAUTH_TOKEN`, which are documented).

CI does not run E2E scripts (they require API keys and a live `pi` binary). The only gate is the developer running the script. If it is not run, it is not tested. If it is not tested, it rots.

### Must Run After Every Change

1. **Build:** `npm run build`
2. **Unit tests:** `npm test`
3. **End-to-end test:** `./test/e2e/01_main.sh` (set `TMPDIR` under the repository's `.tmp/` on encrypted hosts)
4. **Dependency security:** `npm audit --audit-level=low`; inspect distributed dependency code as well as lockfile entries when a dependency embeds another package

Do not consider a change complete until all required checks pass. Run all E2E scripts before any release via the sequential runner `./test/run-e2e-all.sh` (it paces calls so the rate-limit bucket does not deplete). Running them in parallel or back-to-back is the documented cause of degraded or hung runs.

### E2E Test Requirements

The E2E tests auto-detect `OPENROUTER_API_KEY` from `~/.pi/agent/auth.json`. Only an OpenRouter key is required: all three model roles route through OpenRouter.

```bash
OPENROUTER_API_KEY=sk-or-v1-... ./test/e2e/01_main.sh
```

`13_claude_code_plugin.sh` also needs `CLAUDE_CODE_OAUTH_TOKEN` in the gitignored `.env` (mode 600). Each value must be `NAME=VALUE` on one line: scenarios 13 and 14 parse `.env` with `test/e2e/env.sh` (never `source`), read only the keys they need before any output reaches `.e2e-logs/`, and refuse a malformed line or a group- or world-readable file. Create it once with `claude setup-token` in a separate terminal, never through an agent session, because the command prints the token. The token is static for a year and is never written to the isolated profile. `14_codex_plugin.sh` needs a dedicated Codex login, created once in a separate terminal with `CODEX_HOME="$PWD/.e2e-auth/codex" codex login --device-auth` (gitignored, mode 700). Never copy `~/.claude/.credentials.json` or `~/.codex/auth.json` into a test profile: a copied refresh-token chain invalidates the operator's login.

### E2E Publish Test

`./test/run-e2e-publish.sh` validates that the published `npm` package installs and registers correctly:

```bash
./test/run-e2e-publish.sh              # latest version
./test/run-e2e-publish.sh 0.7.0        # specific version
```

No API keys are needed.

## Important Design Decisions

1. **Per-page extraction before collation:** 8 pages multiplied by 50K equals 400K chars. This exceeds LLM context. Extracting per-page first compresses to ≈32K total for comfortable synthesis.
2. **`streamSimple()` over `complete()`:** Sends `reasoning: "low"`, which is required for reasoning models (MiniMax M3, DeepSeek, etc.) and is harmless for non-reasoning ones.
3. **models.json merge over `registerProvider()`:** The latter replaces all models for a provider. The former adds non-destructively.
4. **Dual fetch (Defuddle plus Markdown):** Some sites serve cleaner content via Markdown endpoints. The quality score comparison picks the better version automatically.
5. **`focusPrompt` is critical:** Without it the extraction LLM works generically. The `promptGuidelines` instruct the agent to always provide it.
6. **Cache suggest is additive, not a gate:** Stage 5 never blocks or replaces the live pipeline. It uses the cheap extract model as an LLM judge (≈500 input tokens, ≈$0.0002) to find related previous searches. Failures are caught and silently ignored.
7. **Default migration is match-based, not tracked:** When defaults change between versions, users whose model configs match the OLD default exactly get auto-migrated to the NEW default in-memory. Users who customized their config are left alone. Migration never writes to the user's `settings.json`. A notification explains what changed and how to make it permanent. This is tested in `test/settings.test.ts` under `migrateDefaults`.
8. **Rate-limit resilience is owned at the application layer:** `callLlm()` disables the SDK's retries (`maxRetries: 0`) and invokes the shared model policy's full-jitter backoff plus a hard `AbortController` timeout, because the SDK retries do not honour Retry-After, do not abort cleanly on Esc, and (critically) the SDK request timeout does not cover a stalled streaming body. Stage 1 additionally retries a degraded-200 search (valid response, zero links) that no transport-level check can catch. An opt-in `minRequestIntervalMs` throttle spaces the extract fan-out for tight-limit keys. The pure helpers (`withRetry`, `callWithAbortTimeout`, `isRetryableMessage`, `parseRetryAfterMs`, `createRateLimiter`) live in `util.ts` and are unit-tested in `test/util.test.ts`.

## Tool Naming

All tools use the `intelli_` prefix to avoid collisions with other `Pi` extensions that may provide similar functionality (`web_search`, `web_research`, and similar names are common in the `Pi` ecosystem).

| Tool | Purpose |
|------|---------|
| `intelli_search` | Quick web search returning a concise answer with source URLs |
| `intelli_extract` | Per-page query-relevant content extraction |
| `intelli_collate` | Deduplicate and cache extractions |
| `intelli_research` | Full 5-stage pipeline (search, fetch, extract, collate, cache suggest) |

## Release Policy

**The agent must never create a _GitHub_ Release or trigger `npm` publication without the user's explicit permission.**

Publishing is gated through `npm` staged publishing. CI submits the tarball; the user approves it on `npmjs.com` with 2FA before it goes live:
- **CI workflow** (`.github/workflows/ci.yml`): Runs on every push to `main` and every PR. Validates build, tests, generated-plugin drift, and `npm pack --dry-run`. Catches packaging problems before they reach a release.
- **Release workflow** (`.github/workflows/release.yml`): Runs only when a _GitHub_ Release is **published**. The tag selects exactly one package: `pi-vX.Y.Z` stages the native `@curio-data/pi-intelli-search` package and `mcp-vX.Y.Z` stages `@curio-data/mcp-intelli-search`; any other tag fails. The workflow verifies the tag version against the selected package's manifest, builds and tests both artifacts, and runs `npm stage publish` against the `@curio-data` scope. The dist-tag is derived from the version: stable releases stage to `latest`, while a prerelease such as `0.2.0-alpha.0` stages to its first prerelease identifier (`alpha`), because `npm stage publish` inherits `npm publish`'s guard that throws on a prerelease version without an explicit `--tag`. Authentication is via OIDC trusted publishing (no stored token); provenance is signed automatically (possible exception: the very first staged version of a brand-new package, where npm's visibility check has no package to inspect). The package is then **held in the staging queue** until a maintainer approves it on [npmjs.com](https://www.npmjs.com/package/@curio-data/pi-intelli-search) with 2FA. Until approval, the version does not appear on the public registry.

### Versioning Scheme (Two Packages, One Core)

Agreed with the owner on 2026-10-05. Both packages are pre-1.0 and version in lockstep on the minor number:

- **Minor (0.x.0) is the shared core generation.** Any change under `src/core/` bumps the minor version of **both** manifests, even if only one package ships immediately. Letting the minors drift destroys the signal that `pi-intelli-search@0.15.1` and `mcp-intelli-search@0.15.2` run the same core generation, which matters because the MCP package must honour the frozen native contracts.
- **Patch (0.0.x) is package-specific.** Changes outside `src/core/` (native adapter under `src/`, MCP adapter under `packages/mcp/`, plugins, docs) bump only the affected package's patch. Patches are independent between packages and reset to 0 on every core bump.
- **Prerelease is an orthogonal maturity marker.** A package carries `-alpha.N` while dev-marked and stages to the derived `alpha` dist-tag, off `latest` (the native package started this way at 0.3.1-alpha.1). Dropping the suffix is the promotion to normal; it is not a version change.
- **Native minor bumps still need a `DEFAULT_HISTORY` entry** in `src/settings.ts`, including bumps caused by core changes, and both workspaces need `npm install --package-lock-only`. The MCP package has no `DEFAULT_HISTORY`; its version changes never trigger native model migration.
- **Tags and changelog sections are prefixed per package:** `pi-vX.Y.Z` / `[pi-X.Y.Z]` for the native extension, `mcp-vX.Y.Z` / `[mcp-X.Y.Z]` for the MCP server. Native releases 0.14.0 and older use the unprefixed `vX.Y.Z` form; those tags and releases are historical and never re-released.
- **Release order within a coupled cycle: MCP first, native held.** The native package is not staged or released until the MCP package of the same core generation is confirmed installable from npmjs (the post-publication gate in the MCP checklist). Owner directive, 2026-10-05.

### Changelog Structure

One canonical `CHANGELOG.md` at the repository root covers both packages. The audiences overlap and core changes appear in both histories, so splitting the file would duplicate entries or force readers to open two files.

- Native sections are `## [pi-X.Y.Z]`, MCP sections `## [mcp-X.Y.Z]`; a horizontal rule and note below the newest entries separate the prefixed era from the historical unprefixed native entries.
- **Write core changes once, under the native section.** The matching MCP section carries a one-line pointer ("Core behaviour is shared with [pi-X.Y.Z] and recorded there") plus only its adapter-specific entries.

### Changelog Principles

Follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/): the changelog is for humans, not machines. Its purpose is to document **user-noticeable differences**, often spanning multiple commits, not to replace `git log`.

- **Group related changes.** One entry can cover many commits (for example, "Documentation restructured" covers SKILL.md reordering, README tightening, heading fixes, and assertive voice rewrites).
- **Omit internal changes.** CI tweaks, style guide additions, markdownlint fixes, dependency bumps, and internal refactors do not belong unless they affect compatibility.
- **Omit docs-only changes** that are not user-visible (for example, adding a rule to AGENTS.md).
- **Ask: would a user care about this?** If no, leave it out. The user can browse the repo if they want commit-level detail.

### Creating a Release

Releases are routinely missed because steps 3 and 4 below are skipped or done halfway. Follow every step. Do not assume.

1. **Verify CI is green.** Require a passing run for the exact release commit on `main` or a `release/` branch. Prepare an MCP candidate on a release branch so its unpublished catalog pin does not break installation from `main`; merge it after publication. The native release follows that merge and the MCP registry verification.
2. **Bump `version` in `package.json`** following [SemVer](https://semver.org/), then sync derived state before anything else: run `npm install --package-lock-only` so the `package-lock.json` root version matches, and add a `DEFAULT_HISTORY` entry for the new version in `src/settings.ts` (defaults unchanged is fine). Both drifts are silent: the lockfile drift was missed in v0.12.1, and a missing history entry disables default migration for upgrading users. Run `npm test` after the bump; the migration guard reads the live package version.
3. **Update `CHANGELOG.md` in two places.** Both are required:
   - **Top of file:** Add a new `## [pi-X.Y.Z] - YYYY-MM-DD` section above the previous entry. Use the standard sub-headings (`### Added`, `### Changed`, `### Fixed`, `### Compatibility`, `### Removed`, `### Security`) as needed. List user-visible changes only; internal refactors do not need entries unless they affect compatibility.
   - **Bottom of file:** Add a corresponding reference link `[pi-X.Y.Z]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/pi-vX.Y.Z` below the existing reference block. Without this entry the version heading at the top will not link to the GitHub release.
4. **Verify both CHANGELOG edits exist before committing.** Run:

   ```bash
   grep -n "^## \[pi-X.Y.Z\]" CHANGELOG.md   # must return one match
   grep -n "^\[pi-X.Y.Z\]:"  CHANGELOG.md   # must return one match
   ```

   Both must match. If either is missing, fix before continuing.
5. **Commit and push** the version bump and CHANGELOG together. Suggested commit subject: `Release pi-vX.Y.Z`. The native package's README is derived from the root `README.md` by the `prepublishOnly` hook during `npm stage publish`; confirm `npm run check:readmes` passes first. After any local `npm publish --dry-run`, run `npm run restore:readme`.
6. **Request explicit user approval** before creating the GitHub Release. The agent must not stage a publish without it (see `Release Policy` above). In a coupled release cycle the native release also waits for the MCP post-publication gate (see `Versioning Scheme`).
7. **On approval, create the GitHub Release** with tag `pi-vX.Y.Z`. The workflow then runs `npm stage publish`, which submits the tarball to the staging queue. The agent's responsibility ends here.
8. **User approves the staged package** on [npmjs.com](https://www.npmjs.com/package/@curio-data/pi-intelli-search) via the Staged Packages tab, providing 2FA. The agent must never attempt to approve a staged publish, even if given credentials.
9. **Verify publication.** After approval, check `https://www.npmjs.com/package/@curio-data/pi-intelli-search` shows the new version.

### Releasing the MCP Package

`@curio-data/mcp-intelli-search` has its own version, release tag prefix and staging queue. The native checklist above does not apply except where noted; in particular the MCP package has no `DEFAULT_HISTORY` and its version changes must never trigger native model migration.

1. **Verify CI is green** for the exact candidate on `main` or a `release/` branch and confirm the owner has explicitly approved this release. Keep unpublished catalog pins on a release branch until the corresponding MCP version is public. Approval of one package is not approval of the other.
2. **First release only: publish manually, do not tag.** npm cannot bind a trusted publisher to a package that does not exist, so the first `mcp-v*` version bypasses the CI staging flow: follow the bootstrap sequence under `npm Trusted Publisher` (manual `npm publish --access public --tag alpha`, then bind the trust). From the second release onward every step of this checklist applies, including the GitHub Release tag.
3. **Bump `version` in `packages/mcp/package.json`** following [SemVer](https://semver.org/), then run `npm install --package-lock-only` so the lockfile workspace version matches.
4. **Remove the not-published notices** from the root `README.md` (the `Publication Status` paragraph under `MCP Server`, the pending-publication sentence under `Two Packages, One Engine` and the pre-publication launchers) on the first public release only (the first dev-marked alpha keeps them), then run `npm run generate:readmes`. Never edit `packages/mcp/README.md` or the root `*.README.md` previews directly.
5. **Regenerate the plugin bundles** so the catalogs pin the new version: `npm run generate:plugins`, then confirm `npm run check:plugins` passes. Commit the regenerated catalogs with the version bump; they are what users install from.
6. **Run the full paced live suite** `./test/run-e2e-all.sh`, including `11_mcp_stdio.sh`, `12_plugin_bundles.sh`, `13_claude_code_plugin.sh` and `14_codex_plugin.sh`, before tagging.
7. **Update `CHANGELOG.md`** with a `## [mcp-X.Y.Z] - YYYY-MM-DD` section and a matching `[mcp-X.Y.Z]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/mcp-vX.Y.Z` reference link. Core changes are not repeated: one pointer line to the native `[pi-X.Y.Z]` section covers them (see `Changelog Structure`). Verify both edits with the grep checks from step 4 of the native checklist (adjusted for the `mcp-` prefix).
8. **Commit and push the release branch**, then create the _GitHub_ Release with tag `mcp-vX.Y.Z` only after explicit approval. The workflow stages the package; the user approves it on `npmjs.com` with 2FA. Merge to `main` only once the pinned version resolves publicly.
9. **Post-publication gate:** verify the registry-pin installation route that pre-publication tests could not exercise: install the Claude Code and Codex plugins from the committed catalogs into clean profiles and confirm the `npx` launcher downloads and starts the published version. Record this evidence separately from the local-tarball class in [the compatibility matrix](docs/COMPATIBILITY.md). Only after this gate passes is the native package of the same core generation released.

### Testing the Publish Pipeline

Before the first real release, validate the pipeline with a pre-release:
1. Bump version to a pre-release identifier (for example, `0.3.1-alpha.1`).
2. Create a _GitHub_ Release with the **Pre-release** checkbox checked.
3. The `published` event triggers the workflow (it fires for pre-releases too), exercising the full publish path. The workflow derives the dist-tag from the prerelease identifier (`alpha`), which is what allows a prerelease version past `npm stage publish`'s inherited guard.
4. `npm` will **not** set pre-release versions as `latest`, and the derived dist-tag keeps them off it doubly. Early adopters will not get it by default.
5. Verify the package appears on `npm`, then delete the pre-release tag if not needed.

A staged dist-tag is immutable once staged; changing it means rejecting the staged version and re-staging. Whether a staging-only trusted publisher may set a non-`latest` dist-tag at stage time is unverified until the first live run; watch the first `mcp-v*-alpha*` release for it.

### npm Trusted Publisher

The workflow authenticates to `npm` via OIDC; no stored token is used. Each package needs its own binding. The trusted publisher is configured on the `@curio-data/pi-intelli-search` package page on `npmjs.com` under **Settings → Trusted Publishers** with the following bindings:

- Organization: `Curio-Data`
- Repository: `pi-intelli-search`
- Workflow filename: `release.yml`
- Environment: (none)
- Allowed actions: `npm stage publish` only

`@curio-data/mcp-intelli-search` requires the same binding on its own package page before its first release; the native package's binding does not cover it. Creating that binding is a maintainer action on `npmjs.com`, not something the agent can perform or verify from the repository.

**Bootstrap: the first publish of a new package is manual (verified 2026-10-05).** npm does not allow configuring a trusted publisher for a package that does not exist on the registry; there is no org-scope or admin pre-configuration path. Entering the full scoped name (`@curio-data/mcp-intelli-search`) in the trust UI before the package exists fails for this reason. The confirmed sequence for `@curio-data/mcp-intelli-search`:

1. **Manual first publish** from a maintainer machine: `npm login` (interactive, 2FA; classic tokens fail on org-scoped packages and bypass-2FA granular tokens are unsupported for trust management), then in `packages/mcp/` run `npm publish --access public --tag alpha` for the dev-marked `0.15.0-alpha.0`. Publishing with `--tag alpha` keeps the first version off `latest`.
2. **Bind the trusted publisher** once the package page exists, either in the web UI (package Settings → Trusted Publishers) with the bindings listed above, or via CLI: `npm trust github @curio-data/mcp-intelli-search --file release.yml --repo Curio-Data/pi-intelli-search --allow-stage-publish` (npm CLI 11.15.0+). Use the full scoped name; validation of org, repo and workflow filename is case-sensitive (`Curio-Data`, not `curio-data`).
3. **All subsequent versions** go through the CI staged flow. The manual first publish is the only token/login publish the package ever needs.

Known symptoms of a misconfigured trust: a misleading `404 Not Found` or `ENEEDAUTH` at publish time, because npm does not validate the configuration when it is saved. Set the environment field only if the publish job itself declares `environment: <name>` (ours does not). Trust configurations cannot be edited; delete and recreate. New configurations created after 2026-09-03 default to `npm stage publish` and a package may hold up to ten; ours keeps stage-publish only.

`npm publish` is intentionally **not** in the allowed actions list, so even a workflow compromise cannot push directly to the public registry; every release passes through the staged-publish approval gate.

## Compatibility

- **`Pi` >= 0.81.1:** Core functionality, trusted project settings, `CONFIG_DIR_NAME`, provider-based `pi-ai` calls, and async model-registry refresh. `Pi` >= 0.86 dispatches LLM calls through the `ctx.modelRegistry.streamSimple()` facade (required on those versions: providers drop a `systemPrompt` handed to them directly); `Pi` 0.81.1-0.85.x use the direct provider path. Compatibility audited and verified through `Pi` 1.0.0 (2026-10-02; see CHANGELOG). The `fetch`/`onPayload` request hooks used by annotation harvesting and the web search tool are verified against pi-ai 1.0.0.
