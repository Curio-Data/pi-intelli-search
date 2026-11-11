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

### Audience and Priorities

The documentation is written for a technically literate professional engineer or scientist who wants to reproduce the work and understand why it behaves as it does. Prose is judged on three properties, in this order: correctness (every claim matches the code and the recorded evidence), clarity (the reader can tell what is established, what is not, and why) and conciseness (nothing costs the reader time without helping them understand). Conciseness never overrides the first two: a sentence that explains a principle, or repeats a point for emphasis, stays when it helps the reader understand. The numbered rules below serve these properties: for example, expanding an acronym on first use makes the term clear and lets later text use the short form.

### Local Declaration

This subsection is the repository's local declaration under the house `professional-writing-guide` skill (§ Local Declaration in that skill), agreed with the owner on 2026-11-11. It satisfies the skill's request for a declaration: an agent applying the skill here uses it and does not ask the owner to declare the application, reader or correctness reference again. The numbered rules in this style guide take precedence over the skill's defaults; the recorded divergences below say where they differ.

| Application | Reader | History Needed | Correctness Reference |
|---|---|---|---|
| `README.md` and its generated package READMEs, `docs/ARCHITECTURE.md`, `docs/COMPONENTS.md` | The reader in Audience and Priorities, with no project context | No: the subject as it stands. `ARCHITECTURE.md` keeps design rationale, not history | The code and `package.json` at the documented version |
| `docs/COMPATIBILITY.md`, `docs/BENCHMARKS.md`, `docs/COMPARISON.md` | The same reader | Yes: dated verifications and evidence classes. Recorded results in `BENCHMARKS.md` are append-only; its harness description follows the current script | The recorded evidence (`evidence/`, cache sidecars, test output), with its date |
| `CHANGELOG.md` | A user deciding whether and how to upgrade | Yes, by definition | What each tagged release delivered, corrected in place (see Changelog Conventions) |
| `skills/intelli-search/SKILL.md`, `guidance/` | A coding agent choosing and calling the tools | No | The tool schemas and behaviour in `src/core/`, and the result text each adapter shows the model (`src/tools/`, `packages/mcp/src/`) |
| `AGENTS.md` | A maintainer or agent working on the repository | Only where a past decision still constrains current work | The code, scripts and the owner's recorded decisions |
| `scripts/README.md`, `test/fixtures/native-contract/README.md`, `docs/images/README.md` | A maintainer running scripts, updating fixtures or regenerating artwork | Current procedures; dated observations stay identified as history | The scripts, fixtures and files each guide describes, and the run evidence it cites |
| `docs/proposals/` | A maintainer deciding on or implementing a proposed change | Yes: decisions, open choices and their later disposition | The owner's recorded decisions; the code at HEAD for statements about existing behaviour |
| Working notes in `evidence/`, `.plan/` and `test/rcca/` | The maintainer returning after months on other work | Yes | The run's own outputs and logs |

Statements about the `Pi` host are checked against the installed host's source and type declarations at the stated version.

Recorded divergences from the skill:

- **Product names.** Rules 6 and 6a govern. A name that is also a package, library or command takes italic emphasis and a link on its first prose mention, the plain name thereafter, and the plain name in tables. The skill's rule of italics on every occurrence does not apply to those names.
- **Hedging adverbs.** Rule 8 governs the documentation in the first five rows of the table. Working notes may use "may" or "likely" where the evidence supports that degree of certainty, as the skill's working-note rules allow.
- **Approximation.** Rule 2 (`≈` before approximate numbers) is a sanctioned local rule.

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

For package documentation, the root `README.md` is the only README to edit by hand. Repository guides such as `scripts/README.md` and `test/fixtures/native-contract/README.md` are hand-edited sources. `PI_CHANGELOG.md` is also generated and must not be edited directly; see Changelog Conventions. `scripts/generate-package-readmes.mjs` derives each package's README from the root `README.md`: `packages/mcp/README.md` and the root previews `pi.README.md` and `mcp.README.md` are real generated files (never symlinks: npm drops a symlinked README and GitHub does not render one), committed and drift-checked in CI (`npm run check:readmes`), which also fails when a derived link does not resolve. The native package ships the root path itself, so its `prepublishOnly` hook writes the same derivation over the root README at publish time. Never edit `packages/mcp/README.md` or the root `*.README.md` previews directly. Tag package-specific sections with `<!-- packages:pi -->` or `<!-- packages:mcp -->` and `<!-- /packages -->`, repository-only sections with `<!-- packages:none -->`, and content only a package shows (its title and badges) with a hidden `<!-- packages:mcp hidden` ... `-->` block. Untagged content goes to both packages. The root `README.md` section `Development` documents the syntax. After any README edit run `npm run generate:toc` and `npm run generate:readmes`.

### 13. No Second-Person Address

Do not address the reader as "you" or "your". Write instructions in the imperative ("Run", "Set", "Confirm"), and name the role that acts where an action belongs to one kind of reader. Fixed terms that contain the word, such as "pay-as-you-go" and "bring your own key" (BYOK), are names rather than address and stay as written.

---

## Git Commit Messages

When creating commits:

- The first line must summarise succinctly what has occurred. When many things have happened, focus on the majority.
- Bullet points should be concise and summarise the changes.
- Avoid multiple "add" statements unless necessary. A single statement can cover multiple related items (for example, helper functions).
- Always check for changes before committing. Do not assume earlier edits still exist, as files are often manually edited.

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
│   ├── provenance.ts        # Evidence validation, Markdown fence and container tracking, source inventory
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
├── config-recipes.test.ts   # README Configuration Recipes: settings resolution read from README.md, page caps and extract input cap
├── core-boundary.test.ts     # Source/declaration audit and isolated runtime
├── core-cache.test.ts        # Independent-process cache writes and metadata
├── core-console.test.ts      # Concurrent diagnostic scopes and restoration
├── core-llm.test.ts          # Shared retry/timeout/cancellation policy
├── core-operations.test.ts   # Injected engine outcomes, staging and cancellation
├── dependency-security.test.ts # Executable extraction-path and conversion checks for advisories
├── e2e-helpers.test.ts       # E2E helper, acceptance-check and evidence-analyser regressions
├── native-model-client.test.ts # Native adapter state and policy delegation
├── workspace-paths.test.ts   # Workspace/display path separation
├── telemetry.test.ts
├── fetch.test.ts
├── index.test.ts
├── llm.test.ts
├── native-contract.test.ts
├── fixtures/native-contract/ # Frozen tool, prompt, result, cache and telemetry contracts
├── fixtures/pi-ai-retry-1.5.2.json     # Captured pi-ai retry classifier lists (parity gate)
├── fixtures/pi-changelog-parser-1.5.0.json # Captured Pi changelog parser regex and golden parse
├── helpers/native-contract.ts # Isolated native contract capture
├── helpers/core-context.ts   # Host-free deterministic operation context
├── probes/mcp-sdk.mjs         # Optional isolated SDK interface probe
├── probes/mcp-install.mjs     # Installed standalone operations and native fetch assets
├── tsconfig.native-contract.json # Type check for contract tests and generator
├── prompts.test.ts
├── provenance.test.ts        # Collation provenance validation and failure reports
├── post-0220-minors.test.ts  # Degraded-repeat attempts, rejected synthesis, archive rebasing, multiline emphasis, settings warning, skill cache and collation text, line-one marker
├── post-0220-review.test.ts  # List and quote emphasis, list-container fences, generated-inventory boundaries, trimmed-failure guidance
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
│   ├── 10_config_recipes.sh   # Zero configuration and the highest-risk recipes (R1, R5, R6, R8, R10), run concurrently
│   ├── 11_mcp_stdio.sh
│   ├── 12_plugin_bundles.sh
│   ├── 13_claude_code_plugin.sh
│   ├── 14_codex_plugin.sh
│   ├── 15_pi_floor.sh
│   ├── env.sh
│   ├── lib.sh
│   ├── trace-extension.mjs   # Harness-only Pi extension: extension and agent-loop call tracing
│   ├── trace-fetch.mjs       # Harness-only global fetch tracer (standalone MCP transport)
│   └── analyze-evidence.mjs  # Summarises a traced run without prompts, completions or credentials
├── run-e2e-all.sh            # Suite runner: one build, then all scripts in parallel (or sequential)
├── run-e2e-parallel.sh       # Traced evidence runner for scenarios 01 to 12 and 15
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
- **Retry and timeout are owned by `src/core/llm.ts`, not the SDK.** Native `callLlm()` passes `maxRetries: 0` to the provider stream and invokes the shared policy, which wraps each call in `withRetry()` (full-jitter exponential backoff, honours Retry-After, bounded by `llmRetryAttempts`/`retryBaseDelayMs`/`retryMaxDelayMs`). On the OpenRouter path the provider stream converts a failed HTTP request into `stopReason: "error"` with the diagnostic text in `errorMessage`, which the retry classifier inspects. The classifier mirrors the host's own retry list (pi-ai `utils/retry.js`, captured for 1.5.2 in `test/fixtures/pi-ai-retry-1.5.2.json` and held to a parity gate in `test/util.test.ts`), including its quota/billing fail-fast exclusions, with documented divergences: no host-side context-overflow pre-filter (so a delimited token count can still match the status group) and retained historical extras. The parity gate does not read the installed host: run `scripts/capture-retry-fixture.mjs --check <retry.js>` during every host-bump audit. The `onResponse` callback only observes (it captures a Retry-After header); it must never throw, because a throw propagates out of the stream and bypasses retry.
- **Per-call timeout via `callWithAbortTimeout()` (`src/core/util.ts`).** The SDK request timeout does not cover a stalled streaming body, so the shared model policy aborts the whole call with an `AbortController` after `llmTimeoutMs`, combined with the tool's signal so Esc still cancels. Actual timer expiry is retryable; permanent provider exceptions are not classified as timeouts. Cancellation also propagates through stage boundaries and cache-lock waits.
- **Routine fetch and retry notices must not write directly to the console.** Raw terminal writes bypass the `Pi` TUI renderer. The branch removes routine fetch-comparison output and routes native retries through `ModelRequest.onRetryNotice` into stage progress; when no callback is supplied, the native model client provides a no-op and native `callLlm()` uses a silent policy logger. The shared policy retains its logger fallback for other adapters; MCP research can send retry progress while catalogue preflight and one-shot calls use stderr. Telemetry records aggregate variant winners (`fetch.winners`), not per-page scores. Native operation error logging remains outside this targeted fix. The source audit covers direct console calls, not transitive logger calls. These fixes shipped in the previous stable generation.
- **Policy Scope.** Configured model retries and application timeouts apply inside `intelli_research`. The native standalone search, extract and collate operations retain one attempt and no application-level timeout for compatibility. The standalone MCP adapter must apply explicit policy defaults for all its model calls before exposing tools.
- **Application-level search retry.** Stage 1 retries up to `searchRetryAttempts` times when the search model returns a valid response with zero usable links (a degraded 200 that transport retry cannot catch).
- **Optional extract throttle.** `minRequestIntervalMs` (default 0, off) spaces concurrent extract calls via a per-run rate limiter for keys with tight rate limits.
- Provider-response monitoring via `after_provider_response` event surfaces a rate-limit status in the `Pi` footer even outside tool calls.
- **Caveat:** `pi -p` (used by the E2E scripts) drives `Pi`'s own agent-loop LLM calls (tool selection and final summary). Those go through `Pi`'s provider path and are **not** wrapped by `callLlm()`'s retry/timeout. A hung `pi` with no open network connection is agent-loop behaviour, not this extension.
- **Print-Mode Exit Codes Are Not Pipeline Verdicts.** Since `Pi` 1.2.0, `pi -p` exits `1` when the agent-loop summary is truncated at the output token limit, even after a completed research. The exit code never decides a scenario: the verdict is a fresh cache sidecar recording a completed outcome with successful fetch and nonempty collation (the shared predicate in `test/e2e/lib.sh`, mirrored in `11_mcp_stdio.sh`). The pinned floor host (`15_pi_floor.sh`) predates the truncation exit code and keeps its exit-`0` gate. Do not reintroduce an exit-`0` precondition in the other loops. Exit `124` is the harness's own `timeout`, not truncation: `e2e_run_pi` and the suite runner report it as `TIMED OUT`, and an attempt that times out after writing a completed sidecar is accepted with a timeout warning in the log.

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

Written to `.search/<date>-<slug>-<hash>/` with `report.md`, `query.txt`, `meta.json`, `extractions/`, `sources/`, and `.index.json`. A successful same-day repeat archives the previous run's artefact set to a numbered sibling folder (`<slug>.1`, then `.2`; `rotateCacheArtefacts()`, best-effort with a logged fallback to in-place replacement) before committing the new set; `llms-full-*` downloads stay with the live folder. A degraded repeat preserves a prior successful report, metadata, extractions, sources and index entry, recording the failed attempt separately under `attempts/attempt-*/meta.json` when telemetry is enabled. Rejected nonempty synthesis candidates are saved best-effort in `rejected-synthesis.json`, beside the failure report or in the separate attempt folder; they are diagnostics, never accepted evidence. Physical paths, including indexes and locks, resolve against `ctx.cwd` rather than the process directory. Prompts, report headers and results use a separate configured display path. `makeCachePath()` returns an absolute physical path; use `displayCachePath()` for native text. Absolute and parent-relative native cache settings remain supported.

Documentation downloads use unique directories below the configured cache root's `.staging/`. No download runs under a cache lock. Writers settle before cleanup in `finally`, including cancellation and cache-write failure. Optional staging setup and cleanup errors are logged without discarding the research result. Native absolute and parent-relative cache settings remain valid, so staging can lie outside the workspace; standalone containment checks are a separate adapter responsibility.

**Telemetry sidecar** (v0.11.0+). Each `intelli_research` run also writes a local-only `meta.json` into its cache directory (under `attempts/attempt-<id>/` when an earlier report is preserved), recording per-stage outcomes (pages fetched/failed, fetch-variant winners, links returned and annotations harvested, search-retry, cache-suggest hits, latency). The schema is owned by `src/core/telemetry.ts`, is additive-only, and carries an independent `schemaVersion` decoupled from `extensionVersion`. The write is atomic (temp file then `rename`) and fail-safe: failures are caught and logged, never surfacing to the pipeline result. Suppressed entirely when `disableTelemetry` is true. No network call is added; the word "telemetry" refers to local runtime signals, not remote reporting. The adapter injects package identity; the core never discovers its own package version. Native records retain their legacy shape, while non-native records add optional `packageName` and `adapter` fields. The bundled `scripts/analyze-sessions.sh` aggregates both record forms.

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
| **Deterministic integration** | Functions that read files, with temp-directory isolation | `index.test.ts`, `settings.test.ts`, `providers.test.ts`, `research.test.ts`, `config-recipes.test.ts` (reads `README.md`), `native-changelog.test.ts` (also reads git refs) | No |
| **E2E** | Full pipeline with real LLM calls in isolated `Pi` env | `e2e/01_main.sh`, `e2e/02_cap.sh`, `e2e/06_extract_limits.sh`, `e2e/05_collation_limits.sh`, `e2e/07_llms_full.sh`, `e2e/04_migration.sh`, `e2e/03_model_override.sh`, `e2e/08_websearch_tool.sh`, `e2e/09_sonar_pro_search.sh`, `e2e/10_config_recipes.sh`, `e2e/11_mcp_stdio.sh` (scenarios 01 to 15 are listed in Principle 4; `run-e2e-all.sh` runs them together) | Yes |
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

E2E tests run in isolated `PI_CODING_AGENT_DIR` environments and exercise the settings formats users actually write. The scenario scripts below run through the suite runner:

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
| `e2e/10_config_recipes.sh` | Runs five README Configuration Recipes concurrently, each in a fresh isolated agent dir + cwd with its settings block read from `README.md`, and asserts the effective behaviour from telemetry and the tool-call trace: with no `pi-intelli-search` settings, the default models, citation harvesting, the `.search/` cache and at most 10 pages when the call omits `maxUrls` (R1); non-default extract and collate models (R5, R6); per-project settings honoured by the real `Pi` host through pre-seeded trust.json (R8, the only live project-level-settings coverage); and the 0.21.0 caps on real pages (R10). Settings resolution for all ten recipes, and the page-count and extract-input caps, are covered deterministically by `test/config-recipes.test.ts` |
| `e2e/11_mcp_stdio.sh` | Builds the standalone package, registers it in an isolated profile's `mcp.json` (direct exposure, no native extension) and drives a real research through `Pi`'s native MCP client, asserting connection, workspace cache, `mcp` telemetry identity and completed outcome. Establishes that `--no-extensions` disconnects MCP servers and that `codemode` exposure hides direct tool calls |
| `e2e/12_plugin_bundles.sh` | Packs the standalone artefact, generates local-tarball plugin bundles (pre-publication evidence class), vendors the tarball, then exercises real host installation credential-free: Claude Code strict validation, marketplace add, install, `claude mcp list` connection and skill discovery; Codex marketplace add, catalogue-path assertion, install, installed-cache layout and prompt-input skill discovery. Skips with a notice when a host CLI is absent. Also asserts Claude Code key delivery with dummy values: the required sensitive key option withholds the server while unset and reaches the server process once set. Credentialed sessions live in `13_claude_code_plugin.sh` and `14_codex_plugin.sh` |
| `e2e/13_claude_code_plugin.sh` | Installs the local-tarball Claude Code plugin into an isolated `CLAUDE_CONFIG_DIR` and sets the key through the plugin option only. Fresh sessions evaluate factual lookup with skills disabled, automatic skill loading, explicit skill loading, and a detailed comparison. Prompts name the installed web research plugin, not either operation; only the explicit-loading case names the skill. Both search and research remain available. Checks distinguish skill discovery from successful invocation, verify operation choice and model-visible results, and require completed `mcp` research artefacts. Requires a maintainer-owned Claude Code credential held outside the repository, and asserts the operator's credentials are untouched. `E2E_KEEP_ARTIFACTS=1` retains traces; see `scripts/README.md` |
| `e2e/14_codex_plugin.sh` | Installs the local-tarball Codex plugin into a dedicated gitignored test profile (reset on every run because Codex caches plugins by version), pre-approves the plugin's tools and first calls search with no path or credential exports, asserting tool discovery and actionable missing-key guidance. It then stores the key through standard-input setup, unsets all formerly required variables and drives one real research through `codex exec --json`, asserting a completed `intelli_research` `mcp_tool_call` and a completed `mcp` cache sidecar in the selected working root. Requires a dedicated maintainer-owned Codex login, and asserts the recorded modification time of the operator's `auth.json` is unchanged |
| `e2e/15_pi_floor.sh` | Installs a host-isolated pinned `Pi` 0.86.0 host under `.tmp/pi-floor/` and runs real native research through the required registry facade (the extension's peer value imports still resolve from the repository tree; the only such import, `CONFIG_DIR_NAME`, is identical across the supported range). Requires a completed cache sidecar, non-empty search links and synthesis, and a positive `search.annotationsHarvested` count to guard fetch-tee citation recovery on the pre-0.99 host. Probes supported flags and omits unavailable flags such as `--no-session`; the agent loop uses `openrouter/minimax/minimax-m3` |
| `run-e2e-all.sh` | Builds both packages once, then starts every scenario script at once, each with its own `TMPDIR` and log, and prints each outcome with the tail of every failing log. `E2E_RUN_MODE=sequential` runs them one at a time with a gap (`E2E_GAP_SECONDS`, default 20) instead. The single build and `E2E_SKIP_BUILD=1` keep scenarios from rebuilding a bundle another is loading |
| `run-e2e-parallel.sh` | Traced evidence runner for scenarios 01 to 12 and 15. Gives each scenario an isolated `HOME`, records every extension and agent-loop model call, status, stop reason and retry, and snapshots the key's account state; `test/e2e/analyze-evidence.mjs <run-dir>` summarises a run. Requires `npm run build:all` first |

The scenarios write the nested `pi-intelli-search` format in `settings.json`, matching the recommended user configuration.

**Concurrency and spend:** the scenario scripts consume live provider quota. On 2026-11-09 a traced run of scenarios 01 to 12 and 15 (`test/run-e2e-parallel.sh`; scenarios 13 and 14 excluded) made three all-at-once passes and one paced sequential pass. No extension or agent-loop call ended in an error stop reason, and no `Retry-After` header or provider stream error was recorded (`evidence/agents/2026-11-09-post-release/`). The pipeline calls used OpenRouter and most agent-loop calls used `kimi-coding/k3`. The failures and slow runs came from agent argument errors, repeated research, slow successful calls, timeouts, semantic collation rejection and harness defects. On that evidence the owner made parallel the default on 2026-11-10. That traced evidence covers neither current loop default. On 2026-11-10 two untraced parallel runs of `run-e2e-all.sh` with scenarios 01 to 11 on the `qwen-token-plan` loop passed 14 of 15 scenarios each; scenario 14 failed in both because its guard refuses to start from a worktree. A post-merge run from the main checkout passed 15 of 15 (`evidence/agents/2026-11-10-recipe-checks/`). Those runs record pass or fail only, not rate-limit signals. The OpenRouter fallback loop, which shares the pipeline key, has not run under parallel load. Paid OpenRouter models have no documented plan-based request cap, but upstream providers can return 429 and an account can meet OpenRouter's 402 in-flight spending limit; where that happens, use `E2E_RUN_MODE=sequential`. Sequential mode serialises scenario scripts only: scenario 10 still runs its five recipes concurrently. The paired limit comparisons (`e2e/06_extract_limits.sh`, `e2e/05_collation_limits.sh`) use one official documentation source and a gap (`E2E_RUN_GAP_SECONDS`, default 30) between their two runs.

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

Do not consider a change complete until all required checks pass. Run all E2E scripts before any release via `./test/run-e2e-all.sh`, which builds once and runs them in parallel. To run scenarios by hand alongside one another, see `scripts/README.md` § Live E2E Runs.

### E2E Test Requirements

The E2E tests auto-detect `OPENROUTER_API_KEY` from `~/.pi/agent/auth.json`. Only an OpenRouter key is required: all three model roles route through OpenRouter.

```bash
OPENROUTER_API_KEY=sk-or-v1-... ./test/e2e/01_main.sh
```

`13_claude_code_plugin.sh` and `14_codex_plugin.sh` additionally require maintainer-owned Claude Code and Codex credentials held outside the repository; they cannot run without them. Never copy an operator's credential files (for example `~/.claude/.credentials.json` or `~/.codex/auth.json`) into a test profile: a copied refresh-token chain invalidates the operator's login.

The headless agent loop runs on `qwen-token-plan/qwen3.8-max` when the operator's `auth.json` holds an API key for that provider, and on `openrouter/google/gemini-3.8-flash` otherwise. `TEST_MODEL` overrides the choice in scenarios 01 to 11; `15_pi_floor.sh` always uses `openrouter/minimax/minimax-m3`, and scenarios 12 to 14 run no `Pi` agent loop. The benchmark ignores `TEST_MODEL`: only `BENCH_LOOP_MODEL` overrides its loop. `test/e2e/lib.sh`, which the scenarios and the benchmark share, copies a loop provider's login into a test profile only when its `type` is `api_key`. It refuses any other login, such as the OAuth logins of `kimi-coding` or `openai-codex`, because an OAuth refresh token rotates: a copy that refreshes signs the operator out, as happened on 2026-11-10.

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
- **Codemode Study Evidence.** The `research-handoff-runner` worktree held the raw evidence of the _Codemode_ research handoff study (≈1.5 GiB, with ≈1.3 GiB of scratch). The owner judged its results adequately recorded in `docs/CODEMODE.md` at the `archive/codemode-research-handoff` tag, and the worktree was deleted on 2026-11-09 with the owner's approval. The tag's copy predates the deletion; the current record, including the deletion and the 0.22.0 fix, is `docs/CODEMODE.md` on `study/codemode-research-handoff`. Before deletion, the `rh-v8` analysis, claims, gates, reviews, ledger, settlements, study plan, captured corpus, evidence manifest and three reports (two cited by `test/rcca/HANDOVER.md`) were copied to `evidence/2026-11-09-codemode-study-retained/` with SHA-256 checksums; the 298 retained files the manifest lists match its hashes. The recorded conversations, their run directories and the earlier series' evidence were not kept, so the study can no longer be re-analysed.
