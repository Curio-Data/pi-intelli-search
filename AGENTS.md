# pi-intelli-search — Agent Guidelines

This is a **pi extension** that adds intelligent web research tools to the pi coding agent. It provides a 5-stage research pipeline (search → fetch → extract → collate → cache suggest) as a single tool call, plus individual tools for manual orchestration.

## Git Commit Messages

When creating commits:

- The first line must summarise succinctly what has occurred. When many things have happened, focus on the majority.
- Bullet points should be concise and summarise the changes.
- Avoid multiple "add" statements unless necessary. A single statement can cover multiple related items (e.g., helper functions).
- Always check for changes before committing — do not assume changes you made still exist, as files are often manually edited.

## Project Overview

- **Package name**: `pi-intelli-search`
- **Language**: TypeScript (ESM, strict mode)
- **Runtime**: Node.js (runs inside pi's extension host)
- **Build**: `tsc` → `dist/`
- **Test**: `node --import tsx --test test/*.test.ts` (104 tests)
- **Package manager**: npm
- **License**: Apache-2.0 (Copyright 2026 Ashraf Miah, Curio Data Pro Ltd)

## Key Dependencies

| Package | Role |
|---------|------|
| `wreq-js` | Browser-grade TLS/HTTP fingerprinting for page fetching |
| `defuddle` | HTML content extraction (strips nav, ads, sidebars → markdown) |
| `linkedom` | Lightweight DOM for Defuddle (no full browser) |
| `@mariozechner/pi-ai` | LLM calling via pi's auth system (`completeSimple`) |
| `@mariozechner/pi-coding-agent` | Extension API types (`ExtensionAPI`, `ExtensionContext`) |
| `typebox` | JSON Schema / parameter definitions for tool inputs |

All pi SDK packages are **peer dependencies** — provided by the hosting pi process, not bundled.

## Source Structure

```
src/
├── index.ts                  # Extension entry: registers tools, events, model setup
├── llm.ts                    # callLlm() — pi native auth + rate-limit detection
├── fetch.ts                  # Page fetching: Defuddle vs markdown comparison, llms-full.txt
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

### Pipeline (intelli_research)

1. **Search** — Perplexity Sonar via OpenRouter returns a synthesised answer + source URLs
2. **Fetch** — Each page is fetched two ways in parallel (HTML→Defuddle and markdown variant), compared by quality score, best picked
3. **Extract** — Configurable model (default: MiniMax M2.7) per-page extraction (parallel), compressing ~50K → ~3-5K chars
4. **Collate** — Configurable model (default: MiniMax M2.7) deduplicates across extractions, produces summary + cache
5. **Cache suggest** — LLM judge (extract model) compares current query against `.search/.index.json` and appends related previous searches to the output. Purely additive — never blocks or gates the main result.

The pipeline is self-contained — pi extensions cannot call other tools from `execute()`, so all stages are inlined in `intelli-research.ts`.

### LLM Integration

- Uses `completeSimple()` from `@mariozechner/pi-ai` (not `complete()`) because MiniMax M2.7 is a reasoning model and needs `reasoning: "low"` parameter
- Auth flows through pi's native system (`auth.json`, env vars, OAuth) — no API key management in this code
- The `onResponse` callback in `callLlm()` detects HTTP 429/5xx immediately before stream consumption
- Provider-response monitoring via `after_provider_response` event catches rate limits even outside tool calls

### Model Registration

Perplexity Sonar isn't in pi's built-in model list. The extension merges it into `~/.pi/agent/models.json` on first `session_start` (idempotent, non-destructive). Never uses `registerProvider()` for OpenRouter because that would replace all OpenRouter models.

### Fetch Strategy

Each page gets dual-fetched:
1. HTML → Defuddle (browser TLS fingerprint + content extraction)
2. Markdown variant (Accept: text/markdown header, or `<link rel="alternate">` discovery)
3. Quality comparison (score on code blocks, headings, tables; penalize nav chrome)

For known sites (Cloudflare, Next.js, Vite), `llms-full.txt` is downloaded raw to `sources/` — no LLM processing.

### Settings

Loaded from `~/.pi/agent/settings.json` and `.pi/settings.json` with `intelli*` prefixed keys. Cached in memory, invalidated on `session_start`. See README for all settings keys.

### Cache

Written to `.search/<date>-<slug>/` with `report.md`, `query.txt`, `extractions/`, `sources/`, and `.index.json`. The collation model sees cache paths so it can reference them in output.

**Cache suggest** (Stage 5) reads `.index.json` back after each research call. It feeds up to 20 recent entries to an LLM judge (using the extract model for cost efficiency) which returns semantically related previous searches. Results are formatted as a `📚 Related cached searches` table appended to the tool output. This is purely supplementary — the live search always runs, and the cache suggestions give the agent (and user) a pointer to prior research if live results are insufficient.

## Development Commands

```bash
npm install              # Install deps
npm run build            # TypeScript → dist/ (tsc)
npm run dev              # Watch mode (tsc --watch)
npm test                 # Run all unit tests (104 tests)
npm run test:smoke       # Smoke test (structural validation)
./test/run-e2e.sh        # End-to-end test (live LLM calls, isolated env)
```

**Testing in pi:**
```bash
pi -e ./dist/index.js    # Load extension for testing
pi install /path/to/pi-intelli-search   # Install as package
```

## Required API Keys

In `~/.pi/agent/auth.json`:
- **OpenRouter** (`openrouter`) — used by intelli_search (Perplexity Sonar)
- **MiniMax** (`minimax`) — used by intelli_extract and intelli_collate (MiniMax M2.7). **Only needed with default settings** — override `intelliExtractModel`/`intelliCollateModel` to use a different provider.

All three model roles (search, extract, collate) are configurable via `~/.pi/agent/settings.json`. Any model in pi's registry works — built-in providers, OpenRouter models, or models from other extensions. See README "Model Configuration" section for details.

## Coding Conventions

- **ESM throughout** — `package.json` has `"type": "module"`, imports use `.js` extension
- **Strict TypeScript** — no `any` unless interfacing with untyped pi internals (e.g. `ctx.modelRegistry as { refresh?: () => void }`)
- **Extension API pattern** — single `export default function(pi: ExtensionAPI)` in `index.ts`
- **Tool definition pattern** — each tool exports an object with `name`, `label`, `description`, `promptSnippet`, `promptGuidelines`, `parameters` (TypeBox schema), and `execute()`
- **Error handling** — extraction failures are caught per-page (don't fail the whole pipeline); rate limits throw actionable errors with retry guidance
- **Graceful degradation** — optional pi features (working indicator, model refresh) are feature-detected and silently skipped on older versions
- **No cross-tool calls** — pi extensions cannot invoke other tools from `execute()`, so `intelli_research` inlines all stages
- **SPDX headers** — source files include `// SPDX-License-Identifier: Apache-2.0` and copyright notices

## Testing Conventions

- Test files in `test/` mirror `src/` structure: `cache.test.ts`, `fetch.test.ts`, `settings.test.ts`, etc.
- Run with `node --import tsx --test` (Node.js built-in test runner)
- Tests are unit tests — no live API calls, no network access required
- 104 tests total across 7 test files + 1 smoke test

### Must run after every change

After **any** code change, run the full verification sequence in order:

1. **Build** — `npm run build` (catches type errors, broken imports)
2. **Unit tests** — `npm test` (catches logic regressions)
3. **End-to-end test** — `./test/run-e2e.sh` (exercises the full pipeline with real LLM calls)

The E2E test launches pi in an isolated environment (separate `PI_CODING_AGENT_DIR`, temp `auth.json`/`models.json`) and runs `intelli_research` against a live query. It verifies:
- Extension loads and registers tools
- Perplexity Sonar search returns results
- Pages are fetched and extracted (Defuddle + markdown)
- Cache artifacts are written (`.search/` with `report.md`, `query.txt`, `extractions/`, `sources/`)
- `.search/.index.json` is updated

**Required environment:** `OPENROUTER_API_KEY` (and optionally `MINIMAX_API_KEY`) in `.env`, env vars, or passed inline:
```bash
OPENROUTER_API_KEY=sk-or-v1-... ./test/run-e2e.sh
```

Do not consider a change complete until steps 1–3 pass. Run step 4 before any release.

### E2E publish test

`./test/run-e2e-publish.sh` validates that the published npm package installs correctly and is structurally sound. It:

1. Installs `@curio-data/pi-intelli-search` into a temp directory via `npm install`
2. Runs a smoke test against the **installed** `dist/index.js` (not the local source)
3. Verifies all 4 tools register, event subscriptions work, and `ensureCustomModels()` is idempotent

**Usage:**
```bash
./test/run-e2e-publish.sh              # uses the latest published version
./test/run-e2e-publish.sh 0.3.1        # test a specific version
```

No API keys needed — it's a structural test only, no LLM calls.

## Important Design Decisions

1. **Per-page extraction before collation** — 8 pages × 50K = 400K chars exceeds LLM context. Extracting per-page first compresses to ~32K total for comfortable synthesis.
2. **`completeSimple()` over `complete()`** — sends `reasoning: "low"` which is required for reasoning models (MiniMax M2.7, DeepSeek, etc.) and harmless for non-reasoning ones.
3. **models.json merge over `registerProvider()`** — The latter replaces all models for a provider; the former adds non-destructively.
4. **Dual fetch (Defuddle + markdown)** — Some sites serve cleaner content via markdown endpoints. The quality score comparison picks the better version automatically.
5. **`focusPrompt` is critical** — Without it the extraction LLM works generically. The promptGuidelines instruct the agent to always provide it.
6. **Cache suggest is additive, not a gate** — Stage 5 never blocks or replaces the live pipeline. It uses the cheap extract model as an LLM judge (~500 input tokens, ~$0.0002) to find related previous searches. Failures are caught and silently ignored.

## Tool Naming

All tools use the `intelli_` prefix to avoid collisions with other pi extensions that may provide similar functionality (`web_search`, `web_research`, etc. are common names in the pi ecosystem).

| Tool | Purpose |
|------|---------|
| `intelli_search` | Quick web search via Perplexity Sonar |
| `intelli_extract` | Per-page LLM extraction from fetched content |
| `intelli_collate` | Deduplicate and cache extractions |
| `intelli_research` | Full 5-stage pipeline (search → fetch → extract → collate → cache suggest) |

## Release Policy

**The agent must never create a GitHub Release or trigger npm publication without the user's explicit permission.**

Publishing is fully automated via GitHub Actions:
- **CI workflow** (`.github/workflows/ci.yml`) — runs on every push to `main` and every PR. Validates build, tests, and `npm pack --dry-run`. Catches packaging problems before they reach a release.
- **Release workflow** (`.github/workflows/release.yml`) — runs only when a GitHub Release is **published**. Builds, tests, and publishes to npm with provenance signing.

### Creating a release

1. Ensure all changes are merged to `main` and CI passes (green check).
2. Update `version` in `package.json` following [SemVer](https://semver.org/).
3. Update `docs/CHANGELOG.md` with the new version entry.
4. Commit, push, and ask the user for **explicit approval** before proceeding.
5. Once approved, create a GitHub Release (tag `vX.Y.Z`) — the workflow publishes automatically.

### Testing the publish pipeline

Before the first real release, validate the pipeline with a pre-release:
1. Bump version to a pre-release identifier (e.g., `0.3.1-alpha.1`)
2. Create a GitHub Release with the **Pre-release** checkbox checked
3. The `published` event triggers the workflow, exercising the full publish path
4. npm will **not** set pre-release versions as `latest` — early adopters won't get it by default
5. Verify the package appears on npm, then delete the pre-release tag if not needed

### npm secret

The workflow uses the `NPM_REPO` repository secret (npm access token). Ensure the `@curio-data` org exists on npm and the token has publish rights for `@curio-data/pi-intelli-search`.

## Compatibility

- **pi ≥ 0.69.0** — core functionality (TypeBox 1.x, working indicator, `after_provider_response` monitoring)
- Optional features degrade gracefully on older versions
