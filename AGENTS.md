# pi-intelli-search - Agent Guidelines

This is a **`Pi` extension** that adds intelligent web research tools to the `Pi` coding agent. It provides a 5-stage research pipeline (search, fetch, extract, collate, and cache suggest) as a single tool call, plus individual tools for manual orchestration.

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
| `@earendil-works/pi-ai` | LLM calling via `Pi`'s auth system (`completeSimple`) |
| `@earendil-works/pi-coding-agent` | Extension API types (`ExtensionAPI`, `ExtensionContext`) |
| `typebox` | JSON Schema and parameter definitions for tool inputs |

All `Pi` SDK packages are **peer dependencies**. They are provided by the hosting `Pi` process and are not bundled.

## Source Structure

```
src/
├── index.ts                  # Extension entry: registers tools, events, model setup
├── llm.ts                    # callLlm() - pi native auth + retry/backoff + per-call timeout
├── fetch.ts                  # Page fetching: Defuddle vs Markdown comparison, llms-full.txt
├── prompts.ts                # System prompts for search, extraction, collation, cache suggest
├── providers.ts              # Custom model registration (Sonar) into models.json
├── settings.ts               # Settings loader with caching and invalidation
├── cache.ts                  # .search/ cache read/write, index management, cache suggest helpers
├── telemetry.ts             # Local-only meta.json sidecar: schema, builder, atomic write, version source
├── types.ts                  # Shared TypeScript interfaces
├── util.ts                   # URL extraction, inference, concurrency + retry/backoff/timeout/throttle helpers
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
├── telemetry.test.ts
├── fetch.test.ts
├── index.test.ts
├── prompts.test.ts
├── providers.test.ts
├── research.test.ts
├── run-e2e.sh
├── run-e2e-all.sh
├── run-e2e-cap.sh
├── run-e2e-collation-limits.sh
├── run-e2e-extract-limits.sh
├── run-e2e-llmsfull.sh
├── run-e2e-migration.sh
├── run-e2e-model-override.sh
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
3. **Extract:** Configurable model (default: MiniMax M2.7) per-page extraction (bounded-parallel via `extractionConcurrency`, default 4), compressing ≈50K to ≈3-5K chars.
4. **Collate:** Configurable model (default: MiniMax M2.7) deduplicates across extractions, produces summary and cache.
5. **Cache suggest:** LLM judge (extract model) compares current query against `.search/.index.json` and appends related previous searches to the output. This is purely additive and never blocks or gates the main result.

The pipeline is self-contained. `Pi` extensions cannot call other tools from `execute()`, so all stages are inlined in `intelli-research.ts`.

### LLM Integration

- Uses `completeSimple()` from `@earendil-works/pi-ai` (not `complete()`) because MiniMax M2.7 is a reasoning model and needs `reasoning: "low"` parameter.
- Auth flows through `Pi`'s native system (`auth.json`, env vars, OAuth). No API key management happens in this code.
- **Retry and timeout are owned by `callLlm()`, not the SDK.** It passes `maxRetries: 0` to `completeSimple()` so the SDK's own retries do not compound with ours, then wraps the call in `withRetry()` (full-jitter exponential backoff, honours Retry-After, bounded by `llmRetryAttempts`/`retryBaseDelayMs`/`retryMaxDelayMs`). On the OpenRouter path a 429 does not arrive as a non-2xx status: the SDK throws after its retries and `completeSimple()` resolves with `stopReason: "error"` and the status in `errorMessage`, which the retry classifier inspects. The `onResponse` callback only observes (it captures a Retry-After header); it must never throw, because a throw propagates out of `completeSimple()` and bypasses retry.
- **Per-call timeout via `callWithAbortTimeout()` (`util.ts`).** The SDK request timeout does not cover a stalled streaming body, so `callLlm()` aborts the whole call with an `AbortController` after `llmTimeoutMs`, combined with the tool's signal so Esc still cancels. A timeout surfaces as a retryable condition; if it survives all attempts, `callLlm()` throws a clear timeout error.
- **Application-level search retry.** Stage 1 retries up to `searchRetryAttempts` times when the search model returns a valid response with zero usable links (a degraded 200 that transport retry cannot catch).
- **Optional extract throttle.** `minRequestIntervalMs` (default 0, off) spaces concurrent extract calls via a per-run rate limiter for keys with tight rate limits.
- Provider-response monitoring via `after_provider_response` event surfaces a rate-limit status in the `Pi` footer even outside tool calls.
- **Caveat:** `pi -p` (used by the E2E scripts) drives `Pi`'s own agent-loop LLM calls (tool selection and final summary). Those go through `Pi`'s provider path and are **not** wrapped by `callLlm()`'s retry/timeout. A hung `pi` with no open network connection is agent-loop behaviour, not this extension.

### Model Registration

[_Perplexity Sonar_](https://docs.perplexity.ai) is not in `Pi`'s built-in model list. The extension merges it into `~/.pi/agent/models.json` on first `session_start` (idempotent, non-destructive). Never use `registerProvider()` for [OpenRouter](https://openrouter.ai) because that would replace all OpenRouter models.

### Fetch Strategy

Each page gets dual-fetched:
1. HTML to [Defuddle](https://github.com/kepano/defuddle) (browser TLS fingerprint and content extraction).
2. Markdown variant (`Accept: text/Markdown` header, or `<link rel="alternate">` discovery).
3. Quality comparison (score on code blocks, headings, tables. Penalise nav chrome).

After extraction, every unique domain in the results is probed for `llms-full.txt` documentation files. Built-in mappings resolve non-standard paths for [Cloudflare](https://developers.cloudflare.com) (product-scoped), [Next.js](https://nextjs.org), and [Vite](https://vite.dev). All other domains use the standard `/llms-full.txt` convention. Discovered files are stored raw in `sources/`. Set `disableLlmsFullDiscovery: true` to opt out.

### Settings

Loaded from `~/.pi/agent/settings.json` and `.pi/settings.json`. The nested `pi-intelli-search` namespace is preferred; flat `intelli*` prefixed keys are a deprecated fallback. Cached in memory, invalidated on `session_start`. Rate-limit resilience keys (`llmTimeoutMs`, `llmRetryAttempts`, `retryBaseDelayMs`, `retryMaxDelayMs`, `searchRetryAttempts`, `minRequestIntervalMs`) tune retry, timeout, and throttling. See README for all settings keys and defaults (the canonical reference).

### Cache

Written to `.search/<date>-<slug>/` with `report.md`, `query.txt`, `meta.json`, `extractions/`, `sources/`, and `.index.json`. The collation model sees cache paths so it can reference them in output.

**Telemetry sidecar** (v0.11.0+). Each `intelli_research` run also writes a local-only `meta.json` into its cache directory, recording per-stage outcomes (pages fetched/failed, fetch-variant winners, search-retry, cache-suggest hits, latency). The schema is owned by `src/telemetry.ts`, is additive-only, and carries an independent `schemaVersion` decoupled from `extensionVersion`. The write is atomic (temp file then `rename`) and fail-safe: failures are caught and logged, never surfacing to the pipeline result. Suppressed entirely when `disableTelemetry` is true. No network call is added; the word "telemetry" refers to local runtime signals, not remote reporting. The bundled `scripts/analyze-sessions.sh` aggregates these sidecars.

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
- **OpenRouter** (`openrouter`): A single key covers all three pipeline stages (search, extract, collate).

All three model roles (search, extract, collate) are configurable via `~/.pi/agent/settings.json`. Any model in `Pi`'s registry works. This includes built-in providers, [OpenRouter](https://openrouter.ai) models, or models from other extensions. See README "Model Configuration" section for details.

## Coding Conventions

- **ESM throughout:** `package.json` has `"type": "module"`. Imports use `.js` extension.
- **Strict TypeScript:** No `any` unless interfacing with untyped `Pi` internals (for example, `ctx.modelRegistry as { refresh?: () => void }`).
- **Extension API pattern:** Single `export default function(pi: ExtensionAPI)` in `index.ts`.
- **Tool definition pattern:** Each tool exports an object with `name`, `label`, `description`, `promptSnippet`, `promptGuidelines`, `parameters` (TypeBox schema), and `execute()`.
- **Error handling:** Extraction failures are caught per-page (do not fail the whole pipeline). Transient failures (429, 5xx, timeouts) are retried with full-jitter backoff honouring Retry-After; a failure that survives all attempts throws an actionable error.
- **Graceful degradation:** Optional `Pi` features (working indicator, model refresh) are feature-detected and silently skipped on older versions.
- **No cross-tool calls:** `Pi` extensions cannot invoke other tools from `execute()`. Therefore `intelli_research` inlines all stages.
- **SPDX headers:** Source files include `// SPDX-License-Identifier: Apache-2.0` and copyright notices.

## Testing Conventions

### Test Structure

- Test files in `test/` mirror `src/` structure: `cache.test.ts`, `fetch.test.ts`, `settings.test.ts`, etc.
- Run with `node --import tsx --test` (Node.js built-in test runner).
- Test count is shown by the badge in `README.md`.

### Test Categories

| Category | Purpose | Files | Network |
|---|---|---|---|
| **Structural/smoke** | Extension loads, tools register, events bind | `smoke.ts` | No |
| **Unit (pure logic)** | Functions without filesystem or network deps | `cache.test.ts`, `telemetry.test.ts`, `prompts.test.ts`, `util.test.ts` | No |
| **Deterministic integration** | Functions that read files, with temp-directory isolation | `index.test.ts`, `settings.test.ts`, `providers.test.ts`, `research.test.ts` | No |
| **E2E** | Full pipeline with real LLM calls in isolated Pi env | `run-e2e.sh`, `run-e2e-cap.sh`, `run-e2e-extract-limits.sh`, `run-e2e-collation-limits.sh`, `run-e2e-llmsfull.sh`, `run-e2e-migration.sh`, `run-e2e-model-override.sh` (and `run-e2e-all.sh` to run them sequentially) | Yes |
| **Publish** | Validates published npm package structure | `run-e2e-publish.sh` | Yes (npm only) |

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

E2E tests run in isolated `PI_CODING_AGENT_DIR` environments and exercise the settings formats users actually write. There are seven scenario scripts plus a sequential runner:

| Test | What it proves |
|---|---|
| `run-e2e.sh` | Default pipeline (Sonar + M2.7 via OpenRouter) works end-to-end with nested settings |
| `run-e2e-migration.sh` | Upgrade from 0.7.0 defaults auto-migrates to 0.8.0 OpenRouter defaults |
| `run-e2e-model-override.sh` | Model override in `pi-intelli-search` settings namespace is read and used |
| `run-e2e-cap.sh` | `defaultUrls` and `maxUrls` (cap) are enforced; agent requests above cap are silently clamped |
| `run-e2e-extract-limits.sh` | `extractMaxChars` and `extractionMaxTokens` are enforced; back-to-back comparison proves truncation |
| `run-e2e-collation-limits.sh` | `collationMaxTokens` is enforced; back-to-back comparison proves output clamping |
| `run-e2e-llmsfull.sh` | Automatic llms-full.txt discovery works; probes candidate sites, verifies file lands in cache |
| `run-e2e-all.sh` | Runs every scenario script one at a time with a spacing gap (`E2E_GAP_SECONDS`, default 20). Use this instead of launching scripts in parallel or back-to-back: bursting many calls at one key depletes the rate-limit bucket and produces degraded or hung runs. |

Both write the nested `pi-intelli-search` format in `settings.json`, matching the recommended user configuration.

**Rate-limit caution:** the scenario scripts each fire two or more full pipelines. Run them through `run-e2e-all.sh` (or singly with gaps) on free or shared keys. The fragile single-URL comparisons (`run-e2e-extract-limits.sh`, `run-e2e-collation-limits.sh`) use `maxUrls=2` for redundancy so one degraded call cannot zero the run.

### Principle 5: E2E Scripts Must Be Proven Runnable

No E2E script may be committed without being executed at least once to completion. A script that has never run is not a test: it is a wish.

- **Before committing a new E2E script**, run it with a real API key and confirm it exits 0 with the expected verification checks passing.
- **`shellcheck` is mandatory.** Every shell script must pass `shellcheck` with zero findings. This catches unbound variables, quoting bugs, and syntax errors that `set -euo pipefail` alone will not catch until runtime.
- **`set -euo pipefail` is mandatory** at the top of every E2E script. The `-u` flag turns any reference to an undefined variable into a hard error. If a script references `$E2E_EXTENSION_PATH` or any other variable, it must define that variable before first use. No E2E script may depend on variables from the caller's environment (except `OPENROUTER_API_KEY`, which is documented).

CI does not run E2E scripts (they require API keys and a live `pi` binary). The only gate is the developer running the script. If it is not run, it is not tested. If it is not tested, it rots.

### Must Run After Every Change

1. **Build:** `npm run build`
2. **Unit tests:** `npm test`
3. **End-to-end test:** `./test/run-e2e.sh`

Do not consider a change complete until all three pass. Run all E2E scripts before any release via the sequential runner `./test/run-e2e-all.sh` (it paces calls so the rate-limit bucket does not deplete). Running them in parallel or back-to-back is the documented cause of degraded or hung runs.

### E2E Test Requirements

The E2E tests auto-detect `OPENROUTER_API_KEY` from `~/.pi/agent/auth.json`. Only an OpenRouter key is required: all three model roles route through OpenRouter.

```bash
OPENROUTER_API_KEY=sk-or-v1-... ./test/run-e2e.sh
```

### E2E Publish Test

`./test/run-e2e-publish.sh` validates that the published `npm` package installs and registers correctly:

```bash
./test/run-e2e-publish.sh              # latest version
./test/run-e2e-publish.sh 0.7.0        # specific version
```

No API keys are needed.

## Important Design Decisions

1. **Per-page extraction before collation:** 8 pages multiplied by 50K equals 400K chars. This exceeds LLM context. Extracting per-page first compresses to ≈32K total for comfortable synthesis.
2. **`completeSimple()` over `complete()`:** Sends `reasoning: "low"`, which is required for reasoning models (MiniMax M2.7, DeepSeek, etc.) and is harmless for non-reasoning ones.
3. **models.json merge over `registerProvider()`:** The latter replaces all models for a provider. The former adds non-destructively.
4. **Dual fetch (Defuddle plus Markdown):** Some sites serve cleaner content via Markdown endpoints. The quality score comparison picks the better version automatically.
5. **`focusPrompt` is critical:** Without it the extraction LLM works generically. The `promptGuidelines` instruct the agent to always provide it.
6. **Cache suggest is additive, not a gate:** Stage 5 never blocks or replaces the live pipeline. It uses the cheap extract model as an LLM judge (≈500 input tokens, ≈$0.0002) to find related previous searches. Failures are caught and silently ignored.
7. **Default migration is match-based, not tracked:** When defaults change between versions, users whose model configs match the OLD default exactly get auto-migrated to the NEW default in-memory. Users who customized their config are left alone. Migration never writes to the user's `settings.json`. A notification explains what changed and how to make it permanent. This is tested in `test/settings.test.ts` under `migrateDefaults`.
8. **Rate-limit resilience is owned at the application layer:** `callLlm()` disables the SDK's retries (`maxRetries: 0`) and runs its own full-jitter backoff plus a hard `AbortController` timeout, because the SDK retries do not honour Retry-After, do not abort cleanly on Esc, and (critically) the SDK request timeout does not cover a stalled streaming body. Stage 1 additionally retries a degraded-200 search (valid response, zero links) that no transport-level check can catch. An opt-in `minRequestIntervalMs` throttle spaces the extract fan-out for tight-limit keys. The pure helpers (`withRetry`, `callWithAbortTimeout`, `isRetryableMessage`, `parseRetryAfterMs`, `createRateLimiter`) live in `util.ts` and are unit-tested in `test/util.test.ts`.

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
- **CI workflow** (`.github/workflows/ci.yml`): Runs on every push to `main` and every PR. Validates build, tests, and `npm pack --dry-run`. Catches packaging problems before they reach a release.
- **Release workflow** (`.github/workflows/release.yml`): Runs only when a _GitHub_ Release is **published**. Builds, tests, and runs `npm stage publish` against the `@curio-data` scope. Authentication is via OIDC trusted publishing (no stored token); provenance is signed automatically. The package is then **held in the staging queue** until a maintainer approves it on [npmjs.com](https://www.npmjs.com/package/@curio-data/pi-intelli-search) with 2FA. Until approval, the version does not appear on the public registry.

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
3. **Update `CHANGELOG.md` in two places.** Both are required:
   - **Top of file:** Add a new `## [X.Y.Z] - YYYY-MM-DD` section above the previous entry. Use the standard sub-headings (`### Added`, `### Changed`, `### Fixed`, `### Compatibility`, `### Removed`, `### Security`) as needed. List user-visible changes only; internal refactors do not need entries unless they affect compatibility.
   - **Bottom of file:** Add a corresponding reference link `[X.Y.Z]: https://github.com/Curio-Data/pi-intelli-search/releases/tag/vX.Y.Z` below the existing reference block. Without this entry the version heading at the top will not link to the GitHub release.
4. **Verify both CHANGELOG edits exist before committing.** Run:

   ```bash
   grep -n "^## \[X.Y.Z\]" CHANGELOG.md   # must return one match
   grep -n "^\[X.Y.Z\]:"  CHANGELOG.md   # must return one match
   ```

   Both must match. If either is missing, fix before continuing.
5. **Commit and push** the version bump and CHANGELOG together. Suggested commit subject: `Release vX.Y.Z`.
6. **Request explicit user approval** before creating the GitHub Release. The agent must not stage a publish without it (see `Release Policy` above).
7. **On approval, create the GitHub Release** with tag `vX.Y.Z`. The workflow then runs `npm stage publish`, which submits the tarball to the staging queue. The agent's responsibility ends here.
8. **User approves the staged package** on [npmjs.com](https://www.npmjs.com/package/@curio-data/pi-intelli-search) via the Staged Packages tab, providing 2FA. The agent must never attempt to approve a staged publish, even if given credentials.
9. **Verify publication.** After approval, check `https://www.npmjs.com/package/@curio-data/pi-intelli-search` shows the new version.

### Testing the Publish Pipeline

Before the first real release, validate the pipeline with a pre-release:
1. Bump version to a pre-release identifier (for example, `0.3.1-alpha.1`).
2. Create a _GitHub_ Release with the **Pre-release** checkbox checked.
3. The `published` event triggers the workflow, exercising the full publish path.
4. `npm` will **not** set pre-release versions as `latest`. Early adopters will not get it by default.
5. Verify the package appears on `npm`, then delete the pre-release tag if not needed.

### npm Trusted Publisher

The workflow authenticates to `npm` via OIDC; no stored token is used. The trusted publisher is configured on the `@curio-data/pi-intelli-search` package page on `npmjs.com` under **Settings → Trusted Publishers** with the following bindings:

- Organization: `Curio-Data`
- Repository: `pi-intelli-search`
- Workflow filename: `release.yml`
- Environment: (none)
- Allowed actions: `npm stage publish` only

`npm publish` is intentionally **not** in the allowed actions list, so even a workflow compromise cannot push directly to the public registry; every release passes through the staged-publish approval gate.

## Compatibility

- **`Pi` >= 0.74.0:** Core functionality (TypeBox 1.x, working indicator, `after_provider_response` monitoring).
- Optional features degrade gracefully on older versions.
.
