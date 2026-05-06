# pi-intelli-search - Agent Guidelines

This is a **`Pi` extension** that adds intelligent web research tools to the `Pi` coding agent. It provides a 5-stage research pipeline (search, fetch, extract, collate, and cache suggest) as a single tool call, plus individual tools for manual orchestration.

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

- **Test count canonical:** `README.md` badge and `Development` block.
- **Version canonical:** `package.json` -> `version`, mirrored in `docs/CHANGELOG.md`.
- `AGENTS.md` should describe **how** to run tests, not assert a count. If a count must be cited, link to the README.

---

## Git Commit Messages

When creating commits:

- The first line must summarise succinctly what has occurred. When many things have happened, focus on the majority.
- Bullet points should be concise and summarise the changes.
- Avoid multiple "add" statements unless necessary. A single statement can cover multiple related items (for example, helper functions).
- Always check for changes before committing. Do not assume changes you made still exist, as files are often manually edited.

## Project Overview

- **Package name:** `pi-intelli-search`
- **Language:** TypeScript (ESM, strict mode).
- **Runtime:** Node.js (runs inside `Pi`'s extension host).
- **Build:** `tsc` to `dist/`.
- **Test:** `node --import tsx --test test/*.test.ts`. Test count is shown by the badge in `README.md`.
- **Package manager:** `npm`.
- **License:** Apache-2.0 (Copyright 2026 Ashraf Miah, Curio Data Pro Ltd).

## Key Dependencies

| Package | Role |
|---------|------|
| [wreq-js](https://github.com/sqdshguy/wreq-js) | Browser-grade TLS/HTTP fingerprinting for page fetching |
| [defuddle](https://github.com/kepano/defuddle) | HTML content extraction (strips nav, ads, sidebars to Markdown) |
| [linkedom](https://github.com/WebReflection/linkedom) | Lightweight DOM for [defuddle](https://github.com/kepano/defuddle) (no full browser) |
| `@mariozechner/pi-ai` | LLM calling via `Pi`'s auth system (`completeSimple`) |
| `@mariozechner/pi-coding-agent` | Extension API types (`ExtensionAPI`, `ExtensionContext`) |
| `typebox` | JSON Schema and parameter definitions for tool inputs |

All `Pi` SDK packages are **peer dependencies**. They are provided by the hosting `Pi` process and are not bundled.

## Source Structure

```
src/
├── index.ts                  # Extension entry: registers tools, events, model setup
├── llm.ts                    # callLlm() - pi native auth + rate-limit detection
├── fetch.ts                  # Page fetching: Defuddle vs Markdown comparison, llms-full.txt
├── prompts.ts                # System prompts for search, extraction, collation, cache suggest
├── providers.ts              # Custom model registration (Sonar) into models.json
├── settings.ts               # Settings loader with caching and invalidation
├── cache.ts                  # .search/ cache read/write, index management, cache suggest helpers
├── types.ts                  # Shared TypeScript interfaces
├── util.ts                   # URL extraction, source type inference, helpers
└── tools/
    ├── intelli-research.ts   # Full pipeline orchestrator (5 stages)
    ├── intelli-search.ts     # Standalone search via Perplexity Sonar
    ├── intelli-extract.ts    # Standalone per-page LLM extraction
    └── intelli-collate.ts    # Standalone collation + cache write

skills/
└── intelli-search/
    └── SKILL.md              # Agent-facing skill guide

docs/
├── ARCHITECTURE.md           # Detailed pipeline and design decisions
└── COMPONENTS.md             # Third-party dependency attribution

test/
├── cache.test.ts
├── fetch.test.ts
├── index.test.ts
├── prompts.test.ts
├── providers.test.ts
├── run-e2e.sh
├── run-e2e-publish.sh
├── settings.test.ts
├── smoke.ts
└── util.test.ts
```

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full pipeline description, design decisions, and fetch strategy.

### Pipeline (`intelli_research`)

1. **Search:** [_Perplexity Sonar_](https://docs.perplexity.ai) via [OpenRouter](https://openrouter.ai) returns a synthesised answer with source URLs.
2. **Fetch:** Each page is fetched two ways in parallel (HTML to [Defuddle](https://github.com/kepano/defuddle) and Markdown variant). They are compared by quality score; the best is picked.
3. **Extract:** Configurable model (default: MiniMax M2.7) per-page extraction (parallel), compressing ≈50K to ≈3-5K chars.
4. **Collate:** Configurable model (default: MiniMax M2.7) deduplicates across extractions, produces summary and cache.
5. **Cache suggest:** LLM judge (extract model) compares current query against `.search/.index.json` and appends related previous searches to the output. This is purely additive and never blocks or gates the main result.

The pipeline is self-contained. `Pi` extensions cannot call other tools from `execute()`, so all stages are inlined in `intelli-research.ts`.

### LLM Integration

- Uses `completeSimple()` from `@mariozechner/pi-ai` (not `complete()`) because MiniMax M2.7 is a reasoning model and needs `reasoning: "low"` parameter.
- Auth flows through `Pi`'s native system (`auth.json`, env vars, OAuth). No API key management happens in this code.
- The `onResponse` callback in `callLlm()` detects HTTP 429 and 5xx immediately before stream consumption.
- Provider-response monitoring via `after_provider_response` event catches rate limits even outside tool calls.

### Model Registration

[_Perplexity Sonar_](https://docs.perplexity.ai) is not in `Pi`'s built-in model list. The extension merges it into `~/.pi/agent/models.json` on first `session_start` (idempotent, non-destructive). Never use `registerProvider()` for [OpenRouter](https://openrouter.ai) because that would replace all OpenRouter models.

### Fetch Strategy

Each page gets dual-fetched:
1. HTML to [Defuddle](https://github.com/kepano/defuddle) (browser TLS fingerprint and content extraction).
2. Markdown variant (`Accept: text/Markdown` header, or `<link rel="alternate">` discovery).
3. Quality comparison (score on code blocks, headings, tables. Penalise nav chrome).

For known sites ([Cloudflare](https://developers.cloudflare.com), [Next.js](https://nextjs.org), [Vite](https://vite.dev)), `llms-full.txt` is downloaded raw to `sources/`. No LLM processing is applied.

### Settings

Loaded from `~/.pi/agent/settings.json` and `.pi/settings.json` with `intelli*` prefixed keys. Cached in memory, invalidated on `session_start`. See README for all settings keys.

### Cache

Written to `.search/<date>-<slug>/` with `report.md`, `query.txt`, `extractions/`, `sources/`, and `.index.json`. The collation model sees cache paths so it can reference them in output.

**Cache suggest** (Stage 5) reads `.index.json` back after each research call. It feeds up to 20 recent entries to an LLM judge (using the extract model for cost efficiency) which returns semantically related previous searches. Results are formatted as a `📚 Related cached searches` table appended to the tool output. This is purely supplementary. The live search always runs, and the cache suggestions give the agent (and user) a pointer to prior research if live results are insufficient.

## Development Commands

```bash
npm install              # Install deps
npm run build            # TypeScript -> dist/ (tsc)
npm run dev              # Watch mode (tsc --watch)
npm test                 # Run all unit tests
npm run test:smoke       # Smoke test (structural validation)
./test/run-e2e.sh        # End-to-end test (live LLM calls, isolated env)
```

**Testing in `Pi`:**
```bash
pi -e ./dist/index.js    # Load extension for testing
pi install /path/to/pi-intelli-search   # Install as package
```

## Required API Keys

In `~/.pi/agent/auth.json`:
- **OpenRouter** (`openrouter`): Used by `intelli_search` ([Perplexity Sonar](https://docs.perplexity.ai)).
- **MiniMax** (`minimax`): Used by `intelli_extract` and `intelli_collate` (MiniMax M2.7). **Only needed with default settings.** Override `intelliExtractModel` or `intelliCollateModel` to use a different provider.

All three model roles (search, extract, collate) are configurable via `~/.pi/agent/settings.json`. Any model in `Pi`'s registry works. This includes built-in providers, [OpenRouter](https://openrouter.ai) models, or models from other extensions. See README "Model Configuration" section for details.

## Coding Conventions

- **ESM throughout:** `package.json` has `"type": "module"`. Imports use `.js` extension.
- **Strict TypeScript:** No `any` unless interfacing with untyped `Pi` internals (for example, `ctx.modelRegistry as { refresh?: () => void }`).
- **Extension API pattern:** Single `export default function(pi: ExtensionAPI)` in `index.ts`.
- **Tool definition pattern:** Each tool exports an object with `name`, `label`, `description`, `promptSnippet`, `promptGuidelines`, `parameters` (TypeBox schema), and `execute()`.
- **Error handling:** Extraction failures are caught per-page (do not fail the whole pipeline). Rate limits throw actionable errors with retry guidance.
- **Graceful degradation:** Optional `Pi` features (working indicator, model refresh) are feature-detected and silently skipped on older versions.
- **No cross-tool calls:** `Pi` extensions cannot invoke other tools from `execute()`. Therefore `intelli_research` inlines all stages.
- **SPDX headers:** Source files include `// SPDX-License-Identifier: Apache-2.0` and copyright notices.

## Testing Conventions

- Test files in `test/` mirror `src/` structure: `cache.test.ts`, `fetch.test.ts`, `settings.test.ts`, etc.
- Run with `node --import tsx --test` (Node.js built-in test runner).
- Tests are unit tests. No live API calls and no network access required.
- Tests are unit tests across 7 test files, plus 1 smoke test. The total count is shown by the badge in `README.md`.

### Must Run After Every Change

After **any** code change, run the full verification sequence in order:

1. **Build:** `npm run build` (catches type errors, broken imports).
2. **Unit tests:** `npm test` (catches logic regressions).
3. **End-to-end test:** `./test/run-e2e.sh` (exercises the full pipeline with real LLM calls).

The E2E test launches `Pi` in an isolated environment (separate `PI_CODING_AGENT_DIR`, temp `auth.json` and `models.json`) and runs `intelli_research` against a live query. It verifies:
- Extension loads and registers tools.
- [_Perplexity Sonar_](https://docs.perplexity.ai) search returns results.
- Pages are fetched and extracted ([Defuddle](https://github.com/kepano/defuddle) plus Markdown).
- Cache artifacts are written (`.search/` with `report.md`, `query.txt`, `extractions/`, `sources/`).
- `.search/.index.json` is updated.

**Required environment:** `OPENROUTER_API_KEY` (and optionally `MINIMAX_API_KEY`) in `.env`, env vars, or passed inline:
```bash
OPENROUTER_API_KEY=sk-or-v1-... ./test/run-e2e.sh
```

Do not consider a change complete until steps 1 through 3 pass. Run step 4 before any release.

### E2E Publish Test

`./test/run-e2e-publish.sh` validates that the published `npm` package installs correctly and is structurally sound. It:

1. Installs `@curio-data/pi-intelli-search` into a temp directory via `npm install`.
2. Runs a smoke test against the **installed** `dist/index.js` (not the local source).
3. Verifies all 4 tools register, event subscriptions work, and `ensureCustomModels()` is idempotent.

**Usage:**
```bash
./test/run-e2e-publish.sh              # uses the latest published version
./test/run-e2e-publish.sh 0.4.0        # test a specific version
```

No API keys are needed. This is a structural test only, with no LLM calls.

## Important Design Decisions

1. **Per-page extraction before collation:** 8 pages multiplied by 50K equals 400K chars. This exceeds LLM context. Extracting per-page first compresses to ≈32K total for comfortable synthesis.
2. **`completeSimple()` over `complete()`:** Sends `reasoning: "low"`, which is required for reasoning models (MiniMax M2.7, DeepSeek, etc.) and is harmless for non-reasoning ones.
3. **models.json merge over `registerProvider()`:** The latter replaces all models for a provider. The former adds non-destructively.
4. **Dual fetch (Defuddle plus Markdown):** Some sites serve cleaner content via Markdown endpoints. The quality score comparison picks the better version automatically.
5. **`focusPrompt` is critical:** Without it the extraction LLM works generically. The `promptGuidelines` instruct the agent to always provide it.
6. **Cache suggest is additive, not a gate:** Stage 5 never blocks or replaces the live pipeline. It uses the cheap extract model as an LLM judge (≈500 input tokens, ≈$0.0002) to find related previous searches. Failures are caught and silently ignored.

## Tool Naming

All tools use the `intelli_` prefix to avoid collisions with other `Pi` extensions that may provide similar functionality (`web_search`, `web_research`, and similar names are common in the `Pi` ecosystem).

| Tool | Purpose |
|------|---------|
| `intelli_search` | Quick web search via [Perplexity Sonar](https://docs.perplexity.ai) |
| `intelli_extract` | Per-page LLM extraction from fetched content |
| `intelli_collate` | Deduplicate and cache extractions |
| `intelli_research` | Full 5-stage pipeline (search, fetch, extract, collate, cache suggest) |

## Release Policy

**The agent must never create a _GitHub_ Release or trigger `npm` publication without the user's explicit permission.**

Publishing is fully automated via _GitHub_ Actions:
- **CI workflow** (`.github/workflows/ci.yml`): Runs on every push to `main` and every PR. Validates build, tests, and `npm pack --dry-run`. Catches packaging problems before they reach a release.
- **Release workflow** (`.github/workflows/release.yml`): Runs only when a _GitHub_ Release is **published**. Builds, tests, and publishes to `npm` with provenance signing.

### Changelog Principles

Follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/): the changelog is for humans, not machines. Its purpose is to document **user-noticeable differences**, often spanning multiple commits, not to replace `git log`.

- **Group related changes.** One entry can cover many commits (for example, "Documentation restructured" covers SKILL.md reordering, README tightening, heading fixes, and assertive voice rewrites).
- **Omit internal changes.** CI tweaks, style guide additions, markdownlint fixes, dependency bumps, and internal refactors do not belong unless they affect compatibility.
- **Omit docs-only changes** that are not user-visible (for example, adding a rule to AGENTS.md).
- **Ask: would a user care about this?** If no, leave it out. The user can browse the repo if they want commit-level detail.

### Creating a Release

Releases are routinely missed because steps 3 and 4 below are skipped or done halfway. Follow every step. Do not assume.

1. **Verify CI is green.** Confirm all changes are merged to `main` and the latest run is passing.
2. **Bump `version` in `package.json`** following [SemVer](https://semver.org/).
3. **Update `docs/CHANGELOG.md` in two places.** Both are required:
   - **Top of file:** Add a new `## [X.Y.Z] - YYYY-MM-DD` section above the previous entry. Use the standard sub-headings (`### Added`, `### Changed`, `### Fixed`, `### Compatibility`, `### Removed`, `### Security`) as needed. List user-visible changes only; internal refactors do not need entries unless they affect compatibility.
   - **Bottom of file:** Add a corresponding reference link `[X.Y.Z]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/vX.Y.Z` below the existing reference block. Without this entry the version heading at the top will not link to the GitHub release.
4. **Verify both CHANGELOG edits exist before committing.** Run:

   ```bash
   grep -n "^## \[X.Y.Z\]" docs/CHANGELOG.md   # must return one match
   grep -n "^\[X.Y.Z\]:"  docs/CHANGELOG.md   # must return one match
   ```

   Both must match. If either is missing, fix before continuing.
5. **Commit and push** the version bump and CHANGELOG together. Suggested commit subject: `Release vX.Y.Z`.
6. **Request explicit user approval** before creating the GitHub Release. The agent must not publish without it (see `Release Policy` above).
7. **On approval, create the GitHub Release** with tag `vX.Y.Z`. The workflow then publishes to `npm` automatically.
8. **Verify publication.** After the workflow finishes, check `https://www.npmjs.com/package/@curio-data/pi-intelli-search` shows the new version.

### Testing the Publish Pipeline

Before the first real release, validate the pipeline with a pre-release:
1. Bump version to a pre-release identifier (for example, `0.3.1-alpha.1`).
2. Create a _GitHub_ Release with the **Pre-release** checkbox checked.
3. The `published` event triggers the workflow, exercising the full publish path.
4. `npm` will **not** set pre-release versions as `latest`. Early adopters will not get it by default.
5. Verify the package appears on `npm`, then delete the pre-release tag if not needed.

### npm Secret

The workflow uses the `NPM_REPO` repository secret (`npm` access token). Ensure the `@curio-data` org exists on `npm` and the token has publish rights for `@curio-data/pi-intelli-search`.

## Compatibility

- **`Pi` >= 0.69.0:** Core functionality (TypeBox 1.x, working indicator, `after_provider_response` monitoring).
- Optional features degrade gracefully on older versions.
