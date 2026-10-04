---
name: intelli-search
description: "Research the web for current information. Use when you need docs, APIs, best practices, library updates, or any question requiring up-to-date web sources. Provides search, per-page extraction, collation, and a persistent .search/ cache for follow-up."
---

# Intelli Search

Intelligent web research through the `intelli-search` Model Context Protocol (MCP) server. Four tools: `mcp__intelli_search__intelli_search`, `mcp__intelli_search__intelli_extract`, `mcp__intelli_search__intelli_collate` and `mcp__intelli_search__intelli_research`. The examples below use the exact qualified names this host declares.

Every call is billed to your own configured inference key. The server runs one operation at a time and queues up to eight further requests; later calls wait rather than fail.

## Setup (One Time)

The plugin launches the pinned `@curio-data/mcp-intelli-search` package through `npx`. The first start downloads the package, so it needs network access and can take half a minute; later starts reuse the `npx` cache. [Node.js](https://nodejs.org/) 22 or later must be on `PATH`.

Codex starts plugin MCP servers with a filtered environment: arbitrary parent variables are not inherited and plugin MCP configuration performs no placeholder expansion (verified on Codex CLI 0.144.5). The plugin therefore declares `env_vars` so Codex forwards three named variables from the environment you start `codex` with:

- `OPENROUTER_API_KEY`: your [OpenRouter](https://openrouter.ai) key. One key covers all three pipeline stages.
- `INTELLI_SEARCH_CONFIG`: absolute path of the configuration file.
- `INTELLI_SEARCH_WORKSPACE`: absolute path of the workspace; the research cache lands in its `.search/` subdirectory.

Export them before starting Codex, for example in your shell profile:

```bash
export OPENROUTER_API_KEY=sk-or-v1-...
export INTELLI_SEARCH_CONFIG="$HOME/.config/mcp-intelli-search/config.json"
export INTELLI_SEARCH_WORKSPACE="$HOME/.local/share/mcp-intelli-search/workspace"
```

For per-project caches, set `INTELLI_SEARCH_WORKSPACE` to the project directory before each `codex` launch (for example with `direnv`) instead of exporting a fixed path.

Then write the configuration file:

```bash
mkdir -p "$(dirname "$INTELLI_SEARCH_CONFIG")" "$INTELLI_SEARCH_WORKSPACE"
```

```json
{
  "providers": {
    "openrouter": {
      "apiKeyEnv": "OPENROUTER_API_KEY"
    }
  },
  "models": {
    "search": {
      "provider": "openrouter",
      "model": "perplexity/sonar"
    },
    "extract": {
      "provider": "openrouter",
      "model": "minimax/minimax-m3"
    },
    "collate": {
      "provider": "openrouter",
      "model": "minimax/minimax-m3"
    }
  }
}
```

These are explicit selections, not defaults you must keep. Any chat model on OpenRouter works for `extract` and `collate`; `search` needs `perplexity/sonar`, `perplexity/sonar-pro` or `perplexity/sonar-pro-search` (or an explicitly configured `searchWebSearch` block; see the package documentation).

If a variable is missing, the server exits on startup with `Explicit --config and --workspace are required` on standard error and the tools never appear; fix the environment and restart Codex. A config file that does not exist produces `Cannot read configuration: provide an explicit readable JSON file`.


## When to Use Which Tool

### Quick Factual Question: Use `mcp__intelli_search__intelli_search`

When you need a fast answer with sources but no deep analysis. The source list is capped at the top `defaultUrls` (default 10) entries; a search-grounded model can cite twenty or more. Read the summary; treat the source list as an index to follow up from, not as reading.

```
mcp__intelli_search__intelli_search(query="TypeScript 5.8 release date")
```

### Deep Research for a Coding Task: Use `mcp__intelli_search__intelli_research`

**Always provide a `focusPrompt`.** The extraction model needs to know what to extract. Without it, you get generic summaries. Translate the user's intent into a specific extraction focus.

#### Example: Learning a New Feature

```
User: "How do runes work in Svelte 5?"

mcp__intelli_search__intelli_research(
  query="Svelte 5 runes tutorial examples",
  focusPrompt="Extract the core rune concepts ($state, $derived, $effect), their syntax, and how they replace the old reactive declarations. Include migration patterns from Svelte 4."
)
```

#### Example: Infrastructure and Sysadmin Detail

```
User: "How do I set up podman rootless with systemd?"

mcp__intelli_search__intelli_research(
  query="podman rootless systemd unit configuration",
  focusPrompt="Extract the exact directory paths podman rootless uses for systemd units, the XDG_RUNTIME_DIR and DBUS_SESSION_BUS_ADDRESS setup, and the systemd --user enable commands. Include file paths."
)
```

#### Example: Debugging a Specific Problem

```
User: "Why is my Cloudflare Worker timing out on KV writes?"

mcp__intelli_search__intelli_research(
  query="Cloudflare Workers KV write timeout limits",
  focusPrompt="Extract KV write limits, timeout thresholds, storage limits, and any workarounds for bulk writes. Focus on hard numbers and error messages."
)
```

#### Example: Comparing Options

```
User: "Should I use Tailwind or Vanilla Extract for a new project?"

mcp__intelli_search__intelli_research(
  query="Tailwind CSS vs Vanilla Extract comparison 2026",
  focusPrompt="Extract pros/cons, bundle size benchmarks, DX tradeoffs, and migration costs. Note which claims come from official sources vs blog opinions."
)
```

#### Example: API Reference

```
User: "How do I use the Defuddle npm package?"

mcp__intelli_search__intelli_research(
  query="defuddle npm content extraction usage",
  focusPrompt="Extract the API: install command, function signatures, options object, and output format. Include working code examples."
)
```

### Other Parameters

- `maxUrls`: `3` for quick targeted research, `10` (default) for broad research, `16` for exhaustive research. The server configuration caps this at `maxUrls` (default 20). Requests above the cap are silently clamped.
- `domains`: Guide search toward given sources, for example `domains=["react.dev", "github.com"]`. This adds a `site:` filter and, with the web search tool enabled, an engine domain filter. It is guidance, not a hard boundary: returned URLs are not checked against a local allowlist before fetching.

### When Search Results Mix Source Types

The pipeline automatically adapts extraction to source type:

- **Official docs or API reference:** Preserves exact signatures, types, version annotations.
- **Blog posts or tutorials:** Captures practical patterns, gotchas, real-world examples.
- **Forums (Reddit, Discourse, StackOverflow):** Captures the problem, accepted solution, caveats. Discards tangents.

When collating, the model resolves conflicts using source priority: official docs take priority over API reference, which takes priority over tutorials, which take priority over blog posts, which take priority over forum threads. It flags contradictions explicitly.

### Complex Multi-Angle Research: Use Manual Orchestration

When you need **different focus per URL** (for example, comparing alternatives side by side), orchestrate step by step instead of using `mcp__intelli_search__intelli_research`:

1. `mcp__intelli_search__intelli_search(query)` to discover URLs.
2. Fetch the pages with a web-fetch tool if one is installed (the server does not provide one), or with available shell/HTTP tools. Pass the actual page content to the next step; a URL alone is insufficient.
3. `mcp__intelli_search__intelli_extract(url, title, content, query, focusPrompt)` to give each URL a different focus.
4. `mcp__intelli_search__intelli_collate(extractions, query)` to deduplicate and cache.

Example: researching "KV vs Durable Objects". Extract KV pages with `focusPrompt="Extract KV read/write patterns, consistency model, and latency characteristics"`. Extract Durable Objects pages with `focusPrompt="Extract the consistency guarantees, transaction API, and single-computer model"`.

When constructing a collation item from an extraction result, use the original `url` and `title`, `result.details.extraction` and `result.details.sourceType`, plus an explicit `status` such as `success`. Do not forward the entire extraction `details` object: its `currentness` field is not a collation input.

## Using the Result

**The `mcp__intelli_search__intelli_research` result already contains a concise deduplicated summary. Use it directly. Do not read cache files unless the summary is insufficient for the task.**

The result also includes a **📚 Related cached searches** section when semantically similar previous searches exist in the workspace cache. These are discovered by a model judge that compares the current query against the cache index. The related searches are:

- **Supplementary:** The live search always runs. Cached results are offered as additional context.
- **Useful when live results are incomplete:** You can read a previous `report.md` to cross-reference.
- **Helpful for the user:** If the live results seem wrong, you can point the user to previous research on the same topic.

Only reach into the cache when:

- The user asks about a specific source you need to re-examine.
- You need a complete code example that was truncated in the summary.
- Something in the summary seems contradictory and you need the original.
- The live results are insufficient and a related cached search may help.

## Follow Up from Cache

The cache lives at `.search/<date>-<slug>-<hash>/` below the configured workspace. The tool result includes the absolute path. Read those files with your shell or file-reading tools.

| Need | File |
|------|------|
| Quick refresher on one source | `extractions/01-*.md` |
| Full original page content | `sources/01-*.md` |
| Collated overview | `report.md` |
| Per-stage outcomes | `meta.json` |
| Re-fetch a single URL fresh | Use an installed web-fetch tool or shell/HTTP tools; the server provides no standalone fetch tool |

## How It Works

Reference material for the curious. The decision logic above is what matters in practice.

`mcp__intelli_search__intelli_research` runs a 5-stage pipeline inside a single tool call:

1. **Search:** a search-grounded model returns a synthesised answer plus every source it cited: prose links are merged with machine-readable `url_citation` annotations harvested from the response body, so sources the model consulted but did not link are still fetched.
2. **Fetch:** Each page is fetched and cleaned to Markdown (navigation, ads and sidebars stripped). A Markdown variant is fetched in parallel and the better version wins by quality score.
3. **Extract:** A configurable model pulls out only the content relevant to the query. A ≈50K-char page becomes ≈3-5K chars of focused extraction.
4. **Collate:** Another model call deduplicates across extractions and produces one concise summary. When sources conflict, official docs win.
5. **Cache suggest:** A model judge finds semantically related previous searches in `.search/` and surfaces them as a supplementary table.

You receive only the final summary plus brief stage progress. The full pipeline is hidden inside the tool so your context stays clean.

### Why Extract Before Collate?

Eight fetched pages multiplied by ≈50K chars each equals ≈400K chars. That exceeds a single model context window. Extracting per page first compresses each independently. The collation model then sees ≈32K chars total, which is comfortable for synthesis and deduplication.

This is also why `focusPrompt` matters. It tells the extraction model what to keep from each page. Without guidance, it extracts generically and the collation has less signal to work with.

## When Not to Search

- Writing or editing code already in the project.
- General programming concepts you are confident about.
- Refactoring or debugging with full context available.

## Failure Modes

- **Startup failures:** the server exits before serving and the tools never appear. Standard error carries a plain message: `Explicit --config and --workspace are required` (environment incomplete), `Cannot read configuration: provide an explicit readable JSON file`, or `workspace must be an explicit absolute directory` / `workspace must be an existing readable directory`. Follow the setup section; no inference was billed.
- **Configuration errors** (`CONFIGURATION`, `WORKSPACE`): a tool call found the setup incomplete or invalid (for example a missing credential or an unusable cache path). Fix the configuration and retry; no inference was billed.
- **Provider errors** (`PROVIDER`): the inference provider rejected or broke the call. Authentication and credit failures (401/402/403) mean the key needs attention; rate limits (429) and server errors (5xx) are transient, so wait and retry rather than editing the configuration.
- **Invalid arguments** (`INVALID_ARGUMENTS`): the call parameters failed validation. Correct the arguments; do not retry unchanged.
- **Operation failures** (`OPERATION`): a stage of the pipeline failed after validation. The message names the stage; retry once, then report if it persists.
- **Cancelled** (`CANCELLED`): the client cancelled the call. Do not retry automatically.
- **Degraded research** (`no-links`, `fetch-failed`, `extraction-failed`): the result is still returned with what succeeded. Check the summary and decide whether a narrower query or a retry is warranted.
- **Busy:** more than eight requests are already queued. Wait for an earlier call to finish.
