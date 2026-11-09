# pi-intelli-search - Agent Guidelines

This is a **`Pi` extension** that adds intelligent web research tools to the `Pi` coding agent. It provides a 5-stage research pipeline (search, fetch, extract, collate, and cache suggest) as a single tool call, plus individual tools for manual orchestration.

The strict generic configuration, zero-configuration [_Codex_](https://developers.openai.com/codex/plugins) mode and experimental runtime entrypoint are documented in [the package guide](packages/mcp/README.md).

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

Phrasal-verb particles (`Up`, `Out`, `In`) at the end of a heading are capitalised: `Follow Up`, `Sign In`. All-caps emphasis inside a heading (for example, `When NOT to Search`) is discouraged. Use bold in the body instead, or rephrase the heading. Do not use rhetorical questions as headings; state the topic.

**Good:** `## How It Works`, `### Extraction Before Collation`, `### Creating a Release`
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

The root `README.md` is the only README to edit by hand. `PI_CHANGELOG.md` is also generated and must not be edited directly; see Changelog Conventions. `scripts/generate-package-readmes.mjs` derives each package's README from the root `README.md`: `packages/mcp/README.md` and the root previews `pi.README.md` and `mcp.README.md` are real generated files (never symlinks: npm drops a symlinked README and GitHub does not render one), committed and drift-checked in CI (`npm run check:readmes`), which also fails when a derived link does not resolve. The native package ships the root path itself, so its `prepublishOnly` hook writes the same derivation over the root README at publish time. Never edit `packages/mcp/README.md` or the root `*.README.md` previews directly. Tag package-specific sections with `<!-- packages:pi -->` or `<!-- packages:mcp -->` and `<!-- /packages -->`, repository-only sections with `<!-- packages:none -->`, and content only a package shows (its title and badges) with a hidden `<!-- packages:mcp hidden` ... `-->` block. Untagged content goes to both packages. The root `README.md` section `Development` documents the syntax. After any README edit run `npm run generate:toc` and `npm run generate:readmes`.

---

## Git Commit Messages

When creating commits:

- The first line must summarise succinctly what has occurred. When many things have happened, focus on the majority.
- Bullet points should be concise and summarise the changes.
- Avoid multiple "add" statements unless necessary. A single statement can cover multiple related items (for example, helper functions).
- Always check for changes before committing. Do not assume changes you made still exist, as files are often manually edited.

## Versioning Scheme: Two Packages, One Core

This repository versions two packages that share the core engine in `src/core/`: `@curio-data/pi-intelli-search` (the native `Pi` extension) and `@curio-data/mcp-intelli-search` (the standalone MCP server). A change under `src/core/` bumps the minor version of both packages; a package-specific change bumps only that package's patch version. Release tags and changelog sections carry a package prefix: `pi-vX.Y.Z` and `[pi-X.Y.Z]` for the native extension, `mcp-vX.Y.Z` and `[mcp-X.Y.Z]` for the MCP server.

## Changelog Conventions

### Changelog Structure

One canonical `CHANGELOG.md` at the repository root covers both packages. The audiences overlap and core changes appear in both histories, so splitting the file would duplicate entries or force readers to open two files.

- Native sections are `## [pi-X.Y.Z]`, MCP sections `## [mcp-X.Y.Z]`; a horizontal rule and note below the newest entries separate the prefixed era from the historical unprefixed native entries.
- **`PI_CHANGELOG.md` is generated, never hand-edited.** `scripts/generate-native-changelog.mjs` derives it from `CHANGELOG.md` for `Pi` 1.5.0's Extension Updates feature (`package.json` `pi.changelogPath`): native sections only, headings rewritten to the parseable `## [X.Y.Z]` form, relative links pinned to release-tag URLs, with prereleases, the `Unreleased` section and sections explicitly marked `Not Published` excluded. CI and release gates run `npm run check:changelog`; the drift-checked artefact ships in the native tarball.
- **Write core changes once, under the native section.** The matching MCP section carries a one-line pointer ("Core behaviour is shared with [pi-X.Y.Z] and recorded there") plus only its adapter-specific entries.

### Changelog Principles

Follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/): the changelog is for humans, not machines. Its purpose is to document **user-noticeable differences**, often spanning multiple commits, not to replace `git log`.

- **Group related changes.** One entry can cover many commits (for example, "Documentation restructured" covers SKILL.md reordering, README tightening, heading fixes, and assertive voice rewrites).
- **Omit internal changes.** CI tweaks, style guide additions, markdownlint fixes, dependency bumps, and internal refactors do not belong unless they affect compatibility.
- **Omit docs-only changes** that are not user-visible (for example, adding a rule to AGENTS.md).
- **Ask: would a user care about this?** If no, leave it out. The user can browse the repo if they want commit-level detail.
- **Historical entries may be corrected for accuracy** (an over-strong claim softened, a wrong fact fixed), provided the correction does not change what the release delivered. Record the repository's convention as correction-in-place, distinct from the append-only rule for benchmark evidence in `docs/BENCHMARKS.md`.

## Project Overview

- **Package name:** `@curio-data/pi-intelli-search`
- **Language:** TypeScript (ESM, strict mode).
- **Runtime:** Node.js (runs inside `Pi`'s extension host).
- **Build:** `tsc` to `dist/`.
- **Test:** `npm test` uses `scripts/run-tests.mjs` to run Node's test runner with private home, agent and scratch directories. Test count is shown by the badge in `README.md`.
- **Package manager:** `npm`.
- **Licence:** Apache-2.0 (Copyright 2026 Ashraf Miah, Curio Data Pro Ltd).

## Key Dependencies

| Package | Role |
|---------|------|
| [wreq-js](https://github.com/sqdshguy/wreq-js) | Browser-grade TLS/HTTP fingerprinting for page fetching |
| [defuddle](https://github.com/kepano/defuddle) | HTML content extraction (strips nav, ads, sidebars to Markdown) |
| [linkedom](https://github.com/WebReflection/linkedom) | Lightweight DOM for [defuddle](https://github.com/kepano/defuddle) (no full browser) |
| `@earendil-works/pi-ai` | LLM calling via `Pi`'s auth system and the required `ctx.modelRegistry.streamSimple()` facade (`Pi` >= 0.86.0; no direct-provider fallback or `/compat` shim) |
| `@earendil-works/pi-coding-agent` | Extension API types (`ExtensionAPI`, `ExtensionContext`) |
| `typebox` | JSON Schema and parameter definitions for tool inputs |

All `Pi` SDK packages are **peer dependencies**. They are provided by the hosting `Pi` process and are not bundled.

## Source Structure

```
pi.README.md                  # Generated native package README preview; never edit by hand
PI_CHANGELOG.md               # Generated native package changelog for Pi 1.5.0 Extension Updates; never edit by hand
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
│   ├── collation-budget.ts  # Collation input budget, boundary-safe cuts and trim order
│   ├── output-budget.ts     # Budget-retry caps, timeouts and candidate ranking
│   ├── fetch.ts             # Dual page fetch and documentation downloads
│   ├── console.ts           # Async-scoped dependency diagnostic suppression
│   ├── annotations.ts       # Citation harvesting
│   ├── messages.ts          # Message and appendix builders
│   ├── provenance.ts        # Evidence validation and deterministic source inventory
│   ├── prompts.ts           # System prompts
│   ├── progress.ts          # Host-neutral stage progress
│   ├── telemetry.ts         # Local sidecar with injected identity
│   ├── tlds.ts              # Generated delegated TLD set for protocol-less domain guesses
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
    ├── package.json         # Standalone artefact and explicit runtime dependencies
    ├── src/                 # CLI, strict generic/Codex config, credentials, workspace, provider and protocol adapters
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
├── COMPARISON.md             # Search-comparison evidence page
├── COMPATIBILITY.md          # Host-version compatibility matrix and evidence classes
└── images/                   # README and gallery artwork plus generated chart SVGs

scripts/
├── analyze-sessions.sh       # Aggregate meta.json telemetry sidecars across sessions
├── benchmark-models.sh       # A/B benchmark harness for extract/collate models (live quota)
├── plot-downloads.mts       # Download chart generation (npm run chart)
├── README.md                # Script usage guide
├── run-tests.mjs            # Isolated unit-test runner for npm test and test:all
├── build-mcp.mjs            # Audited standalone bundles and legal-file copies
├── generate-package-readmes.mjs # Package READMEs from the root README; --check is the drift gate
├── generate-native-changelog.mjs # PI_CHANGELOG.md from CHANGELOG.md; --check is the drift gate
├── capture-retry-fixture.mjs  # Capture/audit the pi-ai retry classifier lists (--check at each host bump)
├── capture-changelog-fixture.mjs # Capture the Pi changelog parser behaviour into a test fixture
├── lib/markdown-links.mjs    # Shared fence-aware, inline-code-aware link mapping for generators
├── generate-toc.mjs         # README contents generator; --check is the drift gate
├── generate-tlds.mjs        # src/core/tlds.ts from a downloaded IANA list; --check is the drift gate
├── generate-plugin-bundles.mjs # Plugin/marketplace generator; --check is the drift gate
├── verify-mcp-install.mjs    # Production-only install and native-fetch verification
└── capture-native-contract.mts # Explicit compatibility-fixture regeneration

test/
├── annotations.test.ts
├── budget-candidates.test.ts # Budget-retry candidate ranking
├── budget-retry.test.ts      # Output-cap retries for extraction and collation
├── cache.test.ts
├── claude-routing.test.ts
├── collation-budget.test.ts  # Collation input budget, trim notice and delivered-text provenance
├── compat-guard.test.ts
├── core-boundary.test.ts     # Source/declaration audit and isolated runtime
├── core-cache.test.ts        # Independent-process cache writes and metadata
├── core-console.test.ts      # Concurrent diagnostic scopes and restoration
├── core-llm.test.ts          # Shared retry/timeout/cancellation policy
├── core-operations.test.ts   # Injected engine outcomes, staging and cancellation
├── dependency-security.test.ts # Executable extraction-path and conversion checks for advisories
├── e2e-helpers.test.ts       # E2E helper and acceptance-check regressions
├── native-model-client.test.ts # Native adapter state and policy delegation
├── workspace-paths.test.ts   # Workspace/display path separation
├── telemetry.test.ts
├── fetch.test.ts
├── index.test.ts
├── llm.test.ts
├── native-contract.test.ts
├── fixtures/native-contract/ # Frozen tool, prompt, result, cache and telemetry contracts
├── fixtures/pi-ai-retry-1.5.0.json     # Captured pi-ai retry classifier lists (parity gate)
├── fixtures/pi-changelog-parser-1.5.0.json # Captured Pi changelog parser regex and golden parse
├── helpers/native-contract.ts # Isolated native contract capture
├── helpers/core-context.ts   # Host-free deterministic operation context
├── probes/mcp-sdk.mjs         # Optional isolated SDK interface probe
├── probes/mcp-install.mjs     # Installed standalone operations and native fetch assets
├── tsconfig.native-contract.json # Type check for contract tests and generator
├── prompts.test.ts
├── provenance.test.ts        # Collation provenance validation and failure reports
├── plugin-bundles.test.ts    # Generated plugin/marketplace shape, pins and drift gate
├── package-readmes.test.ts   # README block selection, link rewriting, drift gate and publish swap
├── providers.test.ts
├── research.test.ts
├── renderer.test.ts
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
│   ├── 15_pi_floor.sh
│   ├── env.sh
│   ├── lib.sh                # Unit roots, attempt files, direct/agent invocation, verdict calls
│   ├── scenario-verdict.mjs  # Binds an attempt to its single research call and that call's cache entry
│   ├── direct-tool.mjs       # Exact registered-tool invocation through the host, no agent-loop model call
│   ├── direct-tool.d.mts     # Direct-driver declarations used by deterministic tests
│   ├── scenario-verdict.d.mts # Verdict-helper declarations used by deterministic tests
│   ├── parallel-runner.mjs   # Parallel lane: inputs, preparation, admission, summary
│   ├── parallel-manifest.mjs # The 25 expected units and their budgets
│   ├── parallel-artifacts.mjs # Frozen, hashed host and package installations
│   ├── parallel-supervisor.mjs # Process-group supervision and settlement receipts
│   ├── analyze-evidence.mjs  # Provider-response and trace analysis for a run
│   ├── trace-extension.mjs   # Native model-attempt tracer
│   └── trace-fetch.mjs       # Intercepted HTTP response tracer
├── run-e2e-all.sh            # Sequential live runner (all 15 scripts)
├── run-e2e-parallel.sh       # Parallel live runner (25 units from frozen tarballs)
├── parallel-runner.test.ts   # Supervisor, manifest, preparation and accounting fixtures
├── run-e2e-publish.sh
├── run-e2e-publish-local.sh
├── settings.test.ts
├── smoke.ts
├── util.test.ts
├── rcca/                     # Converted RCCA regressions (run by test:all); RCCA.md and FOLLOW-UP.md
└── native-changelog.test.ts # PI_CHANGELOG.md drift, parser-parity and packaging gates
```

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full pipeline description, design decisions, and fetch strategy.

### Pipeline (`intelli_research`)

1. **Search:** a search-grounded model (default [_Perplexity Sonar_](https://docs.perplexity.ai) via [OpenRouter](https://openrouter.ai)) returns a synthesised answer; prose links are merged with harvested `url_citation` annotations before the URL list is clamped. Alternatives: `perplexity/sonar-pro-search` (model swap) or any OpenRouter chat model plus the `searchWebSearch` server tool.
2. **Fetch:** Each page is fetched two ways in parallel (HTML to [Defuddle](https://github.com/kepano/defuddle) and Markdown variant). They are compared by quality score; the best is picked.
3. **Extract:** Configurable model (default: MiniMax M3) per-page extraction (bounded-parallel via `extractionConcurrency`, default 4), compressing ≈50K to ≈3-5K chars.
4. **Collate:** Configurable model (default: MiniMax M3) deduplicates across extractions, produces summary and cache.
5. **Cache suggest:** LLM judge (extract model) compares current query against `.search/.index.json` and appends related previous searches to the output. The judge is awaited under the configured timeout and retry policy, so it can add latency; it never replaces the live search.

The pipeline is self-contained in `src/core/operations/research.ts`. Former shared module paths (`fetch.ts`, `cache.ts`, `annotations.ts`, `prompts.ts`, `types.ts`, `util.ts`) forward to implementations under `src/core/`. Current `Pi` hosts expose `ctx.executeTool()` for nested tool calls, but this pipeline does not depend on that newer capability. Direct stage execution preserves the supported native baseline and the planned host-independent engine boundary.

### LLM Integration

- All four native tools construct a context through `src/native-operation-context.ts` and invoke shared operations from `src/core/operations/`. `createNativeModelClient()` delegates to `callLlm()` without adding retries or provider fallback. `callLlm()` invokes `runModelWithPolicy()` in `src/core/llm.ts` exactly once. The core owns no host context, settings discovery or credentials. Run `test/core-*.test.ts` for dependency boundaries, engine operations, policy and cache tests, plus `node_modules/.bin/tsc -p test/tsconfig.native-contract.json` for their type check.
- Native dispatch uses only `ctx.modelRegistry.streamSimple()`, required by the `Pi` >= 0.86.0 peer floor. The facade normalises the context, resolves auth and applies the `baseUrl` override internally. The legacy `getProvider()` transport and its manual auth/endpoint mirror are deleted; a host without the facade receives an actionable version error. A raw context passed straight to a provider drops `systemPrompt`, so never bypass the facade. The transport uses neither the deprecated `pi-ai/compat` `completeSimple()` shim nor `ModelRegistry.complete()`. It sends `reasoning: "low"` by default; the search stage overrides it per call (`minimal` when the web search tool is enabled). `test/compat-guard.test.ts` enforces that no file imports `pi-ai/compat`. Models registered outside `Pi`'s registry (for example `pi-ai`'s `registerFauxProvider`) are not consulted.
- **Per-call payload patching and reasoning.** `callLlm()` accepts `payloadPatch` (forwarded as pi-ai's `onPayload`) and `reasoning` (default `"low"`). The search stage uses both to attach `openrouter:web_search`. A patch must return the payload untouched when it does not apply and never overwrite an existing `tools` array.
- **Citation Channels:** When `annotations` is passed, `callLlm()` attaches `onProviderStreamEvent` and a wrapped `fetch` through `ProviderRequestOptions.fetch`. The stream option receives every parsed chat-completions chunk before normalisation on `pi-ai` >= 0.99.0; the fetch-tee wrapper remains the fallback for hosts whose `pi-ai` predates 0.99.0, which ignore that option. Both feed one sink, deduplicated by exact URL, per attempt. Late reads from failed attempts cannot contaminate successful citations. `callLlm()` awaits successful background reads (bounded at 2 seconds) before copying citations to the caller; clone and background-read failures are swallowed. Re-check `onProviderStreamEvent`, `ProviderRequestOptions.fetch`, `onPayload` and the local `FetchFunction` compatibility on each peer-dependency bump. `test/annotations.test.ts` covers parsing and chunk harvesting; `test/llm.test.ts` covers injection and shared-sink behaviour; `test/e2e/15_pi_floor.sh` guards live fallback recovery on the floor host.
- **Native Tool Metadata:** All four tools declare MCP-parity permission hints and `constrainedSampling: { type: "json_schema", strict: "prefer" }`. Search and extract are read-only; collate and research carry `destructiveHint: true` because they write and archive cache output. Hints do not enforce permissions. Unsupported models or schemas fall back to ordinary argument sampling. Missing-model research diagnostics list same-provider alternatives only when compatible catalogue methods are exposed; diagnostic lookup failures leave the original error intact.
- Auth flows through `Pi`'s native system (`auth.json`, env vars, OAuth). No API key management happens in this code.
- **Retry and timeout are owned by `src/core/llm.ts`, not the SDK.** Native `callLlm()` passes `maxRetries: 0` to the provider stream and invokes the shared policy, which wraps each call in `withRetry()` (full-jitter exponential backoff, honours Retry-After, bounded by `llmRetryAttempts`/`retryBaseDelayMs`/`retryMaxDelayMs`). On the OpenRouter path the provider stream converts a failed HTTP request into `stopReason: "error"` with the diagnostic text in `errorMessage`, which the retry classifier inspects. The classifier mirrors the host's own retry list (pi-ai `utils/retry.js`, captured for 1.5.0 in `test/fixtures/pi-ai-retry-1.5.0.json` and held to a parity gate in `test/util.test.ts`), including its quota/billing fail-fast exclusions, with documented divergences: no host-side context-overflow pre-filter (so a delimited token count can still match the status group) and retained historical extras. The parity gate does not read the installed host: run `scripts/capture-retry-fixture.mjs --check <retry.js>` during every host-bump audit. The `onResponse` callback only observes (it captures a Retry-After header); it must never throw, because a throw propagates out of the stream and bypasses retry.
- **Per-call timeout via `callWithAbortTimeout()` (`src/core/util.ts`).** The SDK request timeout does not cover a stalled streaming body, so the shared model policy aborts the whole call with an `AbortController` after `llmTimeoutMs`, combined with the tool's signal so Esc still cancels. Actual timer expiry is retryable; permanent provider exceptions are not classified as timeouts. Cancellation also propagates through stage boundaries and cache-lock waits.
- **Routine fetch and retry notices must not write directly to the console.** Raw terminal writes bypass the `Pi` TUI renderer. The branch removes routine fetch-comparison output and routes native retries through `ModelRequest.onRetryNotice` into stage progress; when no callback is supplied, the native model client provides a no-op and native `callLlm()` uses a silent policy logger. The shared policy retains its logger fallback for other adapters; MCP research can send retry progress while catalogue preflight and one-shot calls use stderr. Telemetry records aggregate variant winners (`fetch.winners`), not per-page scores. Native operation error logging remains outside this targeted fix. The source audit covers direct console calls, not transitive logger calls. These fixes shipped in the previous stable generation.
- **Policy Scope.** Configured model retries and application timeouts apply inside `intelli_research`. The native standalone search, extract and collate operations retain one attempt and no application-level timeout for compatibility. The standalone MCP adapter must apply explicit policy defaults for all its model calls before exposing tools.
- **Application-level search retry.** Stage 1 retries up to `searchRetryAttempts` times when the search model returns a valid response with zero usable links (a degraded 200 that transport retry cannot catch).
- **Optional extract throttle.** `minRequestIntervalMs` (default 0, off) spaces concurrent extract calls via a per-run rate limiter for keys with tight rate limits.
- Provider-response monitoring via `after_provider_response` event surfaces a rate-limit status in the `Pi` footer even outside tool calls.
- **Caveat:** `pi -p` (used by the E2E scripts) drives `Pi`'s own agent-loop LLM calls (tool selection and final summary). Those go through `Pi`'s provider path and are **not** wrapped by `callLlm()`'s retry/timeout. A hung `pi` with no open network connection is agent-loop behaviour, not this extension.
- **Print-Mode Exit Codes Are Not Pipeline Verdicts.** Since `Pi` 1.2.0, `pi -p` exits `1` when the agent-loop summary is truncated at the output token limit, even after a completed research. The exit code never decides a scenario. `test/e2e/scenario-verdict.mjs` decides each attempt from its own event stream: exactly one research call, the arguments the prompt names, and the cache entry that call returned, which must sit directly inside the unit's cache root and hold a fresh `meta.json` recording a completed outcome with successful fetch and nonempty collation. Several research calls or wrong arguments are an `oracle-fail` and are not retried. The pinned floor host (`15_pi_floor.sh`) predates the truncation exit code and keeps its exit-`0` gate. Do not reintroduce an exit-`0` precondition in the other scenarios.

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

**Cache suggest** (Stage 5) reads `.index.json` back after each research call. It feeds up to 20 recent entries to an LLM judge (using the extract model for cost efficiency) which returns semantically related previous searches. Results are formatted as a `📚 Related cached searches` table appended to the tool output. The judge is awaited under the model-call timeout and retry policy, so it can add latency; judge failure is logged without discarding completed research, and cancellation propagates. It never replaces the live search, and the cache suggestions give the agent (and user) a pointer to prior research if live results are insufficient.

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
npm run generate:changelog # Regenerate PI_CHANGELOG.md from CHANGELOG.md
npm run check:changelog  # Fail if the native changelog drifts from CHANGELOG.md
node scripts/capture-retry-fixture.mjs --check <retry.js>       # Host-bump audit: classifier drift vs installed pi-ai
node scripts/capture-changelog-fixture.mjs --check <changelog.js> # Host-bump audit: parser drift vs installed Pi
npm run restore:readme   # Restore the root README after a local publish or publish dry run
npm run test:smoke       # Smoke test (structural validation)
./test/e2e/01_main.sh        # End-to-end test (live LLM calls, isolated env)
./test/run-e2e-parallel.sh --dry-run       # List the 25 parallel units and budgets (no credentials, no writes)
./test/run-e2e-parallel.sh --prepare-only  # Install and hash the frozen runtimes from packed tarballs; no scenarios
./test/run-e2e-parallel.sh                 # Parallel live acceptance (live quota; see Live E2E Runners)
./test/run-e2e-all.sh                      # Sequential live suite, all 15 scripts (live quota)
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
- **`Pi` 0.86.0 Baseline:** Require `ctx.modelRegistry.streamSimple()` for every native model call. Retain trusted settings, `CONFIG_DIR_NAME` and async registry refresh; do not restore a direct-provider fallback. Keep fetch-tee citation recovery for pre-1.0 hosts alongside the newer stream hook.
- **Standalone Boundary:** `packages/mcp/` bundles only the shared core and adapter source; every external runtime dependency belongs in its manifest. Keep `Pi` libraries out of the standalone runtime and MCP protocol libraries out of the native extension runtime. The protocol SDK (`@modelcontextprotocol/server`) belongs only to the standalone package. Shared tuning lives in `src/core/defaults.ts`; native model defaults remain in `src/settings.ts`. Generic registration keeps explicit configuration and workspace paths. Codex mode alone supplies the current workspace, built-in model defaults and stable per-user paths; credentials may come from its named environment variable or a user-only `apiKeyFile`, never host credential discovery. Preserve both tarball-install gates. The standalone cache link checks reject existing escapes but are not a sandbox against concurrent hostile filesystem mutation.
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
| **Deterministic integration** | Functions that read files, with temp-directory isolation | `index.test.ts`, `settings.test.ts`, `providers.test.ts`, `research.test.ts`, `native-changelog.test.ts` (also reads git refs) | No |
| **E2E** | Full pipeline with real LLM calls in isolated Pi env | `e2e/01_main.sh`, `e2e/02_cap.sh`, `e2e/06_extract_limits.sh`, `e2e/05_collation_limits.sh`, `e2e/07_llms_full.sh`, `e2e/04_migration.sh`, `e2e/03_model_override.sh`, `e2e/08_websearch_tool.sh`, `e2e/09_sonar_pro_search.sh`, `e2e/10_config_recipes.sh`, `e2e/11_mcp_stdio.sh`, `e2e/15_pi_floor.sh`, run by `run-e2e-parallel.sh` (25 units) or `run-e2e-all.sh` (sequential) | Yes |
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

E2E tests run in isolated `PI_CODING_AGENT_DIR` environments and exercise the settings formats users actually write. Both live runners execute the scripts below; [Live E2E Runners](#live-e2e-runners) describes the two lanes and the evidence classes. Configuration scenarios 02 to 11 make their research call by direct invocation; 01 and 15 keep the natural-language prompt through the agent loop as routing evidence.

| Test | What it proves |
|---|---|
| `e2e/01_main.sh` | Default pipeline (Sonar + M3 via OpenRouter) works end-to-end with nested settings. Routing evidence: the agent loop chooses the call |
| `e2e/04_migration.sh` | Upgrade from 0.7.0 defaults migrates the version marker and the run's extract and collate models to the current `openrouter/minimax/minimax-m3` default, in a private workspace rather than the repository |
| `e2e/03_model_override.sh` | Model override in `pi-intelli-search` settings namespace is read and used: the run records the overridden extract and collate models and the custom cache directory |
| `e2e/02_cap.sh` | Two cases (`E2E_CAP_CASE=cap\|default`). Cap: a call requesting `maxUrls=12` is clamped to the configured cap of 3. Default: a call omitting `maxUrls` uses `defaultUrls=3`. Each case checks the call's exact arguments, the requested-page count and the extraction count |
| `e2e/06_extract_limits.sh` | Default and tight arms (`E2E_LIMIT_ARM=default\|tight`), each in its own workspace with a receipt naming its bound entry, then an offline `compare` step. The tight extraction must be smaller than the default one. The comparison records each arm's source hashes: the arms search independently and both caps change together, so it shows the tight settings reached the live pipeline, not which cap acted. A missing extraction is reported as unproven and fails |
| `e2e/05_collation_limits.sh` | Default and tight arms (`E2E_LIMIT_ARM=default\|tight`) and an offline `compare` step, as in 06. Each arm checks the collate model; the comparison requires the 200-token report to be smaller than the 4000-token report and records both arms' source hashes |
| `e2e/07_llms_full.sh` | Probes candidate sites for `llms-full.txt`, then researches the first live host in a private workspace. Passes only when the bound entry holds `sources/llms-full-<host>.md` larger than 500 bytes; otherwise it fails as unproven and names the `llms-full` files that were created, which distinguishes a redirect or another search host from a broken download |
| `e2e/08_websearch_tool.sh` | Exercises the configured server-tool path with a chat model: verifies the selected model, non-empty links, completed pipeline, and cached sources. Annotation count is diagnostic, not a pass condition |
| `e2e/09_sonar_pro_search.sh` | Verifies registration and settings-based selection of `perplexity/sonar-pro-search` in a vanilla agent dir, then checks non-empty links, completed pipeline, and cached sources. Reports the annotation count |
| `e2e/10_config_recipes.sh` | Eight recipe units (`E2E_RECIPE=r1\|r4\|r5\|r6\|r7\|r8\|r9\|r10`; recipes 2 and 3 are covered by 08 and 09). Each runs its README Configuration Recipe settings block in a fresh agent directory and workspace and asserts the effective behaviour from the bound telemetry sidecar: zero-config defaults, partial blocks preserving unspecified defaults, extract/collate overrides, the free-tier page default, and per-project settings through a pre-seeded `trust.json` (the only project-level-settings coverage). Pacing and retry values (R7), the collation input budget (R9) and the collation token cap (R10) are not recorded in telemetry; R10's input cap is reported as unexercised when no fetched page exceeds it |
| `e2e/11_mcp_stdio.sh` | Builds the standalone package, or uses a prepared server (`E2E_MCP_CLI`), registers it in an isolated profile's `mcp.json` (direct exposure, no native extension) and drives a real research through `Pi`'s native MCP client to the stdio server by direct invocation, asserting connection, workspace cache, `mcp` telemetry identity and completed outcome. Establishes that `--no-extensions` disconnects MCP servers and that `codemode` exposure hides direct tool calls |
| `e2e/12_plugin_bundles.sh` | Packs the standalone artefact (or uses `E2E_MCP_TARBALL` without building), generates local-tarball plugin bundles (pre-publication evidence class), vendors the tarball, then exercises real host installation credential-free: Claude Code strict validation, marketplace add, install, `claude mcp list` connection and skill discovery; Codex marketplace add, catalogue-path assertion, install, installed-cache layout and prompt-input skill discovery. Skips with a notice when a host CLI is absent. Also asserts Claude Code key delivery with dummy values: the required sensitive key option withholds the server while unset and reaches the server process once set. Credentialed sessions live in `13_claude_code_plugin.sh` and `14_codex_plugin.sh` |
| `e2e/13_claude_code_plugin.sh` | Installs the local-tarball Claude Code plugin into an isolated `CLAUDE_CONFIG_DIR` and sets the key through the plugin option only. Fresh sessions evaluate factual lookup with skills disabled, automatic skill loading, explicit skill loading, and a detailed comparison. Prompts name the installed web research plugin, not either operation; only the explicit-loading case names the skill. Both search and research remain available. Checks distinguish skill discovery from successful invocation, verify operation choice and model-visible results, and require completed `mcp` research artefacts. Requires a maintainer-owned Claude Code credential held outside the repository, and asserts the operator's credentials are untouched. `E2E_KEEP_ARTIFACTS=1` retains traces; see `scripts/README.md` |
| `e2e/14_codex_plugin.sh` | Installs the local-tarball Codex plugin into a dedicated gitignored test profile (reset on every run because Codex caches plugins by version), pre-approves the plugin's tools and first calls search with no path or credential exports, asserting tool discovery and actionable missing-key guidance. It then stores the key through standard-input setup, unsets all formerly required variables and drives one real research through `codex exec --json`, asserting a completed `intelli_research` `mcp_tool_call` and a completed `mcp` cache sidecar in the selected working root. Requires a dedicated maintainer-owned Codex login, and asserts the recorded modification time of the operator's `auth.json` is unchanged |
| `e2e/15_pi_floor.sh` | Installs a host-isolated pinned `Pi` 0.86.0 host under `.tmp/pi-floor/` (or uses a prepared `E2E_FLOOR_BIN` without modifying it) and runs real native research through the agent loop as routing evidence through the required registry facade (the extension's peer value imports still resolve from the repository tree; the only such import, `CONFIG_DIR_NAME`, is identical across the supported range). Requires a completed cache sidecar, non-empty search links and synthesis, and a positive `search.annotationsHarvested` count to guard fetch-tee citation recovery on the pre-0.99 host. Probes supported flags and omits unavailable flags such as `--no-session`; the agent loop uses `openrouter/minimax/minimax-m3` |
| `run-e2e-all.sh` | Runs all 15 scenario scripts one at a time from the checkout, with a gap between scripts (`E2E_GAP_SECONDS`, default 20) and a per-script deadline (`E2E_SCRIPT_TIMEOUT_SECONDS`, default 1200) |
| `run-e2e-parallel.sh` | Runs 25 units from frozen, hashed package installations at full concurrency; see [Live E2E Runners](#live-e2e-runners) |

The scenarios write the nested `pi-intelli-search` format in `settings.json`, matching the recommended user configuration.

**Provider quota:** the scenario scripts consume live provider quota. Standalone, the paired limit comparisons (`e2e/06_extract_limits.sh`, `e2e/05_collation_limits.sh`) run their arms one after the other with a gap (`E2E_RUN_GAP_SECONDS`, default 30); the parallel runner runs the arms as separate units. [Provider Signals](#provider-signals) records what concurrent runs have measured and how to respond to rate-limit signals.

### Live E2E Runners

Two runners execute the live scenarios. Both consume provider quota.

| Runner | Scope | Runtime Under Test | Credentials |
|---|---|---|---|
| `run-e2e-parallel.sh` | 25 units: 22 provider units, scenario 12 and two offline comparisons. Scenarios 13 and 14 are excluded | Frozen production installations from prepacked tarballs | `OPENROUTER_API_KEY`, or an `api_key` entry in `E2E_OPERATOR_AUTH_JSON`; no `.env` |
| `run-e2e-all.sh` | All 15 scripts, one at a time | The checkout's `dist/` and `packages/mcp/dist/` | `.env` keys, then `~/.pi/agent/auth.json` |

The sequential runner wraps each script in `timeout --kill-after` without `--foreground`, so an expired script's whole process group is stopped, and it forwards Ctrl-C to the running script's group. Use it for scenarios 13 and 14, and as the alternative when prepacked tarballs are not available.

#### Parallel Runner Inputs and Preparation

The parallel runner neither builds nor packs, so a rebuild in the checkout cannot change what the units load. It requires the native and MCP tarballs and their expected SHA-256 values. One way to produce them, from the `package.json` scripts, keeping the output in the gitignored `.tmp/`:

```bash
mkdir -p .tmp/e2e-artefacts
npm run build
npm pack --pack-destination .tmp/e2e-artefacts
npm pack --workspace @curio-data/mcp-intelli-search --pack-destination .tmp/e2e-artefacts
sha256sum .tmp/e2e-artefacts/*.tgz
```

The MCP pack runs that package's `prepack` build. The native pack does not run the publish-time README swap (`prepublishOnly`), which no scenario reads. Keep generated files out of non-ignored paths: the runner records the checkout's HEAD, status and diff hash, and refuses to start units if they change during preparation.

```bash
E2E_NATIVE_TARBALL=... E2E_NATIVE_SHA256=... \
E2E_MCP_TARBALL=... E2E_MCP_SHA256=... \
  ./test/run-e2e-parallel.sh --prepare-only
```

| Mode | Effect |
|---|---|
| `--dry-run` | Prints the 25 units and their deadlines. No credentials, files or network |
| `--prepare-only` | Builds and verifies the frozen runtimes; starts no scenario and calls no account API. Every unit is recorded as not started |
| no flag | Prepares, then runs all units |

Preparation installs three production-only trees: the current host (`Pi` 1.5.0, `E2E_CURRENT_VERSION`) with the native tarball, the standalone MCP package, and the floor host (0.86.0, `PI_FLOOR_VERSION`) with the native tarball against floor peers. It also copies the Node executable and the scenario scripts. Every file is hashed, the snapshot is made read-only, and the hashes are checked again before the first unit starts and after the last one settles; a mismatch fails the run. All units share these installations; no unit gets its own `node_modules`. The failure that prompted the parallel redesign was a build-output race (`prepack` deleting `packages/mcp/dist` while another scenario loaded it), not a dependency mutation, and frozen tarball inputs remove that race. Read-only modes guard against accidental writes by the same Unix user, not deliberate ones.

Runs are written to `.tmp/e2e-parallel/<run>/` (`E2E_RUN_ROOT`, `E2E_RUN_NAME`): `manifest.json`, `results.json`, `analysis.json`, `artefact-manifest.json` and `units/<id>/`. The folder is disposable scratch: promote what must be kept to `evidence/` before citing it.

#### Units and Evidence Classes

All eligible units start together; the two comparison units wait for their arms. `E2E_CONCURRENCY` is an optional operator cap, not a default. Every expected unit is required: a skip, such as scenario 12 on a host without `claude` or `codex`, is incomplete coverage rather than a pass.

| Units | Invocation | What the Result Means |
|---|---|---|
| 02 to 11 (including each scenario 10 recipe and each limit arm) | Direct | `test/e2e/direct-tool.mjs` builds the session `pi -p` builds (extensions, settings, project trust, the built-in MCP client, `session_start`) and calls the registered tool once with the oracle's exact arguments, through the host's tool pipeline. No agent-loop model is called, and an attempted call fails the unit. Scenario 11's call goes through `Pi`'s MCP client to the stdio server |
| 01, 15 | Agent loop | With only the research tool offered, the model chooses its arguments and whether to call it again. Wrong argument values or types, or several research calls, are an `oracle-fail`: a routing result, not a pipeline defect. Tool selection is not exercised in this lane |

Every provider unit sets `E2E_TOOL_ALLOWLIST` to its research tool. This prevents auxiliary shell work but narrows routing evidence to argument selection and call count. Standalone and sequential runs do not set the allowlist, so they retain the full tool set. The acceptance runs therefore differ in invocation mode, available tools and supervised logging, not just in code revision; do not infer a causal change in agent repetition from them alone.

The parallel runner sets `E2E_INVOCATION=direct` for units 02 to 11, so a host without the required API fails the unit and writes `invocation-fallback.json`. Run standalone, these scripts default to `auto`: direct where the host supports it, otherwise the agent loop, with the same report and a printed warning. Every verdict records its `invocation`. The parallel runner sets a budget of one research call per attempt; standalone and sequential runs set no budget unless `E2E_RESEARCH_CALL_BUDGET` is explicitly exported. Any call beyond the first is blocked before it executes, the attempt stops, and the verdict records `budgetBlocked`.

#### Isolation, Verdicts and Credentials

Each unit receives private home, temporary, XDG, npm-cache, agent, workspace, log and trace directories, and an environment built from an allowlist. Scenario 12 and the comparison units receive no provider key. Each attempt writes `units/<id>/traces/[<prefix>-]NNN-attempt-K.jsonl`, `.stderr`, `.display.txt` and `.verdict.json`, and an existing attempt file is never overwritten. The verdict reads only the cache entry that the unit's own call returned inside the unit's workspace, so another unit's research cannot satisfy it. It also records `callsObserved` and `budgetBlocked`. `E2E_LOG_FILE` names the same `units/<id>/scenario.log` captured by the supervisor, so direct logging does not create a `tee` descendant or divert the canonical log elsewhere.

Only `api_key` entries are copied into a test profile as the agent-loop credential; an OAuth entry is refused, because each profile that refreshes it forks the operator's refresh-token chain. The parallel lane's agent-loop model is `openrouter/google/gemini-3.8-flash`.

The parallel lane sets `PI_OFFLINE=1`, which disables `Pi`'s automatic network activity, including model catalogue refreshes; explicit model calls remain live. Standalone runs do not set it, so the two lanes are not identical host configurations, and an offline run does not establish that the loop model is in the host catalogue.

#### Process Settlement

Each unit runs as a detached process group with its output streamed to files. At a deadline or interruption the supervisor sends TERM, then KILL, and repeats the sweep for late descendants. A unit's result is published only after its group has been observed empty more than once. A unit whose leader exits 0 but whose descendants needed TERM or KILL is recorded as `descendants-terminated`, not passed. With `E2E_ACCOUNT_SNAPSHOTS=1`, key-wide account snapshots are taken before the run and after every unit has settled; they include any other traffic on the key. Process-group polling is not a sandbox: a process that deliberately daemonises, or a supervisor killed with KILL, escapes it. `--help` lists the per-unit deadlines, which derive from three attempts per unit.

#### Provider Signals

The concurrent runs measured so far have produced no rate-limit response:

- The 2026-11-09 investigation captured 763 model responses across three 13-way parallel passes and a sequential baseline, all HTTP 200.
- Acceptance runs `d93b35e`, `82987f0` and the authoritative `f57ced0` (25 units, 23 started together) each recorded no non-200 response, no `Retry-After` header and no 429, with two application retry notices each.

These counts are observed response records, not a complete request census, and they do not establish a concurrency limit. Within a unit, model calls retry transient failures with backoff that honours `Retry-After`, and quota or billing exhaustion fails fast (see LLM Integration). The runners do not throttle automatically: the parallel runner reports 429s, other non-200 statuses and `Retry-After` values per unit and in its summary. When a run records a 429, or a 402 that carries `Retry-After`, wait at least the recorded interval and rerun with a lower `E2E_CONCURRENCY`. A 402 without `Retry-After` is not a wait-and-retry case: per [_OpenRouter_'s limits documentation](https://openrouter.ai/docs/api_reference/limits), it means the key's credit cap, the balance or the request's estimated cost, which needs an account or request change.

#### Recorded Acceptance Runs

| Commit | Invocation | Result |
|---|---|---|
| `d93b35e` | All provider units through the agent loop | 25 of 25 units passed in ≈111 s |
| `82987f0` | Direct for 02 to 11; agent loop for 01 and 15 | 24 of 25 units passed in ≈118 s. `15_pi_floor` failed with `oracle-fail`: the floor host's agent made two research calls in one attempt, and the verdict does not choose between them |
| `f57ced0` | Direct for 02 to 11; agent loop for 01 and 15, with a one-research-call budget | 24 of 25 units passed in ≈98 s. The floor's second research start was blocked before execution and recorded as `budgetBlocked: 1` |

The `f57ced0` run is the authoritative acceptance record, not a full-suite pass: the 20 direct-invocation units, both comparisons, scenario 12 and 01 passed, and the floor host's routing evidence failed without a second paid research pipeline. Every unit has a nonempty `scenario.log`. A different diagnostic run, `c717ba6`, records the other strict-oracle mode: `maxUrls` arrived as the string `"1"`, so the argument-type check failed even though research completed. These are agent argument or call-count failures, not provider failures. The full run register is in `evidence/agents/2026-11-09-parallel-e2e-implementation/acceptance/README.md`, a host-local, gitignored folder in the main checkout. The latest results are in `acceptance-f57ced0/results.json`, and `SHA256SUMS` covers every retained file.

### Principle 5: E2E Scripts Must Be Proven Runnable

No E2E script may be committed without being executed at least once to completion. A script that has never run is not a test: it is a wish.

- **Before committing a new E2E script**, run it with a real API key and confirm it exits 0 with the expected verification checks passing.
- **`shellcheck` is mandatory.** Every shell script must pass `shellcheck` with zero findings. This catches unbound variables, quoting bugs, and syntax errors that `set -euo pipefail` alone will not catch until runtime.
- **`set -euo pipefail` is mandatory** at the top of every E2E script. The `-u` flag turns any reference to an undefined variable into a hard error. If a script references `$E2E_EXTENSION_PATH` or any other variable, it must define that variable before first use. No E2E script may depend on variables from the caller's environment (except documented credentials such as `OPENROUTER_API_KEY`).

CI does not run E2E scripts (they require API keys and a live `pi` binary). The only gate is the developer running the script. If it is not run, it is not tested. If it is not tested, it rots.

### Must Run After Every Change

1. **Build:** `npm run build`
2. **Unit tests:** `npm test`
3. **End-to-end test:** `./test/e2e/01_main.sh` (set `TMPDIR` under the repository's `.tmp/` on encrypted hosts)
4. **Dependency security:** `npm audit --audit-level=low`; inspect distributed dependency code as well as lockfile entries when a dependency embeds another package

Do not consider a change complete until all required checks pass. Run all E2E scripts before any release. The parallel runner covers 25 units from scenarios 01 to 12 and 15; scenarios 13 and 14 hold persistent host logins and run only through `./test/run-e2e-all.sh` or singly.

### E2E Test Requirements

Run singly or through `run-e2e-all.sh`, the E2E tests auto-detect `OPENROUTER_API_KEY` from `~/.pi/agent/auth.json` and read the named keys from `.env`. Only an OpenRouter key is required: all three model roles route through OpenRouter. The parallel runner reads no `.env` and does not search `~/.pi/agent/`: it requires `OPENROUTER_API_KEY`, or an `openrouter` entry of `type: api_key` in the file named by `E2E_OPERATOR_AUTH_JSON`.

```bash
OPENROUTER_API_KEY=sk-or-v1-... ./test/e2e/01_main.sh
```

`13_claude_code_plugin.sh` and `14_codex_plugin.sh` additionally require maintainer-owned Claude Code and Codex credentials held outside the repository; they cannot run without them. Never copy an operator's credential files (for example `~/.claude/.credentials.json` or `~/.codex/auth.json`) into a test profile: a copied refresh-token chain invalidates the operator's login.

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
6. **Cache suggest is supplementary, not a gate:** Stage 5 never replaces the live pipeline, but the pipeline awaits it under the configured timeout and retry policy, so it can add latency. It uses the cheap extract model as an LLM judge (≈500 input tokens, ≈$0.0002) to find related previous searches. Failures are logged without discarding completed research.
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

## Compatibility

- **`Pi` >= 0.86.0:** All native model calls use the `ctx.modelRegistry.streamSimple()` facade, with host context normalisation, authentication and endpoint overrides. There is no legacy provider transport. Citation recovery uses `onProviderStreamEvent` on `pi-ai` >= 0.99.0 and the fetch-tee fallback on older supported hosts, sharing one deduplicated per-attempt sink. The full paced live suite passed on merged commit `99fea6f` on 2026-10-08, including research on the floor host and `Pi` 1.1.0; [Compatibility](docs/COMPATIBILITY.md#current-candidate-verification) separates local-tarball and registry-pin evidence. A static interface audit and targeted native/MCP-client research checks are recorded for `Pi` 1.2.0 on 2026-10-13, separately from that full suite; see [`Pi` 1.2.0 Verification](docs/COMPATIBILITY.md#pi-120-verification-2026-10-13). A static audit, shipped-declaration type check and the full paced live suite are recorded for `Pi` 1.3.0 on 2026-10-16; see [`Pi` 1.3.0 Verification](docs/COMPATIBILITY.md#pi-130-verification-2026-10-16). A static interface audit, a type check against the shipped 1.5.0 declarations, the deterministic suite and targeted live native and MCP-client research are recorded for `Pi` 1.5.0 on 2026-11-03, together with the 0.21.0 classifier alignment and the generated `PI_CHANGELOG.md`; see [`Pi` 1.5.0 Verification](docs/COMPATIBILITY.md#pi-150-verification-2026-11-03). The peer floor and model defaults are unchanged. Final research rendering uses `durationMs` on `Pi` >= 1.1.0 when supplied and at least one second; older hosts omit the duration line.

## Repository Folders

This repository uses VFM. The global scratch, citation and informed-consent rules apply; the evidence conventions below are local to this project. This retention policy governs cleanup: older blanket no-deletion statements in planning material describe the default, not a prohibition on explicitly authorised consolidation.

| Folder | Holds | Default Retention |
|---|---|---|
| `evidence/` | Durable proof, timestamped and gitignored | Preserve historical records; do not overwrite them during ordinary development |
| `evidence/agents/<run>/` | Agent briefs and reports, written here directly | Preserve; only disposable work and logs belong in scratch |
| `.plan/` | Plan board and ledger | Preserve |

- **Evidence Consolidation and Cleanup.** At the user's explicit request, evidence may be consolidated, archived or deleted. Before proceeding, identify the affected material, what will remain, and the consequences for citations, manifests, reproducibility and recovery. Explain any reliance on backups and obtain approval for the defined scope. Perform only that cleanup and record the outcome in retained project documentation. Consolidation must not misrepresent historical results or imply that removed evidence remains available locally; identify affected references and inventories without silently rewriting historical hashes or verdicts.
- **Other Gitignored Folders.** The 2026-10-27 inventory identified `.search/` (registered research reports), `.e2e-logs/`, `.plan/` and `evidence/`. Preserve their contents by default; inclusion in that inventory is not cleanup approval. `.e2e-auth/` holds a test login: never cite, copy or print it.
- **Uncited Release Scratch.** The 2026-10-27 survey found tracked citations to `.tmp/release-*` staging. On 2026-11-09 the owner chose to remove those citations rather than promote the material; `docs/COMPATIBILITY.md` records the resulting evidence gap for 0.16.0 to 0.19.1. The removed review-report citations under `.tmp/agents/` pointed to folders that no longer existed. With the owner's approval, the uncited folders `.tmp/release-016`, `.tmp/release-017`, `.tmp/release-018`, `.tmp/release-019` and `.tmp/release-0191` were deleted the same day.
