# pi-intelli-search — Agent Guidelines

This is a **pi extension** that adds intelligent web research tools to the pi coding agent. It provides a 4-stage research pipeline (search → fetch → extract → collate) as a single tool call, plus individual tools for manual orchestration.

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
- **Test**: `node --import tsx --test test/*.test.ts` (70 tests)
- **Package manager**: npm
- **License**: Apache-2.0 (Copyright 2025 Ashraf Miah, Curio Data Pro Ltd)

## Key Dependencies

| Package | Role |
|---------|------|
| `wreq-js` | Browser-grade TLS/HTTP fingerprinting for page fetching |
| `defuddle` | HTML content extraction (strips nav, ads, sidebars → markdown) |
| `linkedom` | Lightweight DOM for Defuddle (no full browser) |
| `@mariozechner/pi-ai` | LLM calling via pi's auth system (`completeSimple`) |
| `@mariozechner/pi-coding-agent` | Extension API types (`ExtensionAPI`, `ExtensionContext`) |
| `@sinclair/typebox` | JSON Schema / parameter definitions for tool inputs |

All pi SDK packages are **peer dependencies** — provided by the hosting pi process, not bundled.

## Source Structure

```
src/
├── index.ts                  # Extension entry: registers tools, events, model setup
├── llm.ts                    # callLlm() — pi native auth + rate-limit detection
├── fetch.ts                  # Page fetching: Defuddle vs markdown comparison, llms-full.txt
├── prompts.ts                # System prompts for search, extraction, collation
├── providers.ts              # Custom model registration (Sonar) into models.json
├── settings.ts               # Settings loader with caching and invalidation
├── cache.ts                  # .search/ cache read/write and index management
├── types.ts                  # Shared TypeScript interfaces
├── util.ts                   # URL extraction, source type inference, helpers
└── tools/
    ├── intelli-research.ts   # Full 4-stage pipeline orchestrator
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
├── settings.test.ts
├── smoke.ts
└── util.test.ts
```

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full pipeline description, design decisions, and fetch strategy.

### Pipeline (intelli_research)

1. **Search** — Perplexity Sonar via OpenRouter returns a synthesised answer + source URLs
2. **Fetch** — Each page is fetched two ways in parallel (HTML→Defuddle and markdown variant), compared by quality score, best picked
3. **Extract** — MiniMax M2.7 per-page extraction (parallel), compressing ~50K → ~3-5K chars
4. **Collate** — MiniMax M2.7 deduplicates across extractions, produces summary + cache

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

## Development Commands

```bash
npm install              # Install deps
npm run build            # TypeScript → dist/ (tsc)
npm run dev              # Watch mode (tsc --watch)
npm test                 # Run all tests (70 tests)
npm run test:smoke       # Smoke test
```

**Testing in pi:**
```bash
pi -e ./dist/index.js    # Load extension for testing
pi install /path/to/pi-intelli-search   # Install as package
```

## Required API Keys

In `~/.pi/agent/auth.json`:
- **OpenRouter** (`openrouter`) — used by intelli_search (Perplexity Sonar)
- **MiniMax** (`minimax`) — used by intelli_extract and intelli_collate (MiniMax M2.7)

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
- 70 tests total across 7 test files + 1 smoke test

## Important Design Decisions

1. **Per-page extraction before collation** — 8 pages × 50K = 400K chars exceeds LLM context. Extracting per-page first compresses to ~32K total for comfortable synthesis.
2. **`completeSimple()` over `complete()`** — MiniMax M2.7 is a reasoning model; the simpler API correctly sends reasoning parameters.
3. **models.json merge over `registerProvider()`** — The latter replaces all models for a provider; the former adds non-destructively.
4. **Dual fetch (Defuddle + markdown)** — Some sites serve cleaner content via markdown endpoints. The quality score comparison picks the better version automatically.
5. **`focusPrompt` is critical** — Without it the extraction LLM works generically. The promptGuidelines instruct the agent to always provide it.

## Tool Naming

All tools use the `intelli_` prefix to avoid collisions with other pi extensions that may provide similar functionality (`web_search`, `web_research`, etc. are common names in the pi ecosystem).

| Tool | Purpose |
|------|---------|
| `intelli_search` | Quick web search via Perplexity Sonar |
| `intelli_extract` | Per-page LLM extraction from fetched content |
| `intelli_collate` | Deduplicate and cache extractions |
| `intelli_research` | Full 4-stage pipeline (search → fetch → extract → collate) |

## Compatibility

- **pi ≥ 0.67.68** — core functionality
- **pi ≥ 0.68.0** — custom working indicator, `after_provider_response` monitoring
- Optional features degrade gracefully on older versions
