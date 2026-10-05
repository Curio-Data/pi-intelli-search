---
name: intelli-search
description: "Research the web for current information. Use when you need docs, APIs, best practices, library updates, or any question requiring up-to-date web sources. Provides search, per-page extraction, collation, and a persistent .search/ cache for follow-up."
---

# Intelli Search

Intelligent web research through the `intelli-search` Model Context Protocol (MCP) server. Four tools: `mcp__plugin_intelli-search_intelli_search__intelli_search`, `mcp__plugin_intelli-search_intelli_search__intelli_extract`, `mcp__plugin_intelli-search_intelli_search__intelli_collate` and `mcp__plugin_intelli-search_intelli_search__intelli_research`. The examples below use the exact qualified names this host declares.

Inference uses the configured provider account. The server runs one operation at a time with up to eight requests queued; excess submissions receive a busy error rather than waiting.

## Setup (One Time)

The plugin launches the pinned `@curio-data/mcp-intelli-search` package through `npx`. The first start downloads the package, so it needs network access and can take half a minute; later starts reuse the `npx` cache. [Node.js](https://nodejs.org/) 22 or later must be on `PATH`.

The launcher supplies:

- `INTELLI_SEARCH_CONFIG=${CLAUDE_PLUGIN_DATA}/config.json` (the configuration file lives in the plugin data directory, which persists across plugin updates)
- `INTELLI_SEARCH_WORKSPACE=${CLAUDE_PROJECT_DIR}` (the project you opened, so the research cache lands in that project's `.search/`)
- `OPENROUTER_API_KEY` from the plugin's required `openrouter_api_key` option, which _Claude Code_ keeps in its credential store

The plugin data directory resolves to `~/.claude/plugins/data/intelli-search-curio-data-plugins/`; the skill body already shows you the substituted absolute path wherever `${CLAUDE_PLUGIN_DATA}` appears.

Steps:

1. Enter your [OpenRouter](https://openrouter.ai) key when _Claude Code_ asks for the plugin's options, or later through `/plugin` → `intelli-search` → configure. One key covers all three pipeline stages. The server does not start until the option is set. An exported `OPENROUTER_API_KEY` is not used: the plugin option always supplies the variable. To set the key from a shell without placing it on a command line, pipe it in:

   ```bash
   printf '{"openrouter_api_key":"%s"}' "$KEY" \
     | claude plugin configure intelli-search@curio-data-plugins --values-stdin
   ```

   A value saved this way reaches only sessions started afterwards: running sessions keep their loaded options, and `/mcp` reconnect does not reload them. Restart open sessions, or set the key through `/plugin` → `intelli-search` → configure, which applies it to the running session.
2. Create the plugin data directory and write the configuration file:

   ```bash
   mkdir -p "${CLAUDE_PLUGIN_DATA}"
   ```

   Write `${CLAUDE_PLUGIN_DATA}/config.json`:

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

   These are explicit selections, not defaults you must keep. Any chat model on OpenRouter works for `extract` and `collate`; `search` needs `perplexity/sonar`, `perplexity/sonar-pro` or `perplexity/sonar-pro-search` (or an explicitly configured `searchWebSearch` block; see [Configuration](https://github.com/Curio-Data/pi-intelli-search/blob/main/packages/mcp/README.md#configuration) and [Tuning](https://github.com/Curio-Data/pi-intelli-search/blob/main/packages/mcp/README.md#tuning) in the standalone guide).
3. Restart Claude Code and verify with `claude mcp list`: the server `plugin:intelli-search:intelli_search` must show as connected. If it is absent from the list, the key option is not set.

Uninstalling the plugin deletes its data directory, including `config.json`. Keep a copy if you plan to reinstall.

### Authentication Failure

A `401` from an operation means the server received a key OpenRouter rejects. Replace the stored option through `/plugin` → `intelli-search` → configure, then reconnect the server with `/mcp`. Exporting a different `OPENROUTER_API_KEY` has no effect on this plugin.

### Workspace Expansion Failure

If standard error reports `workspace must be an explicit absolute directory` because the host left `CLAUDE_PROJECT_DIR` unexpanded, edit the installed plugin's `.mcp.json`, replace `INTELLI_SEARCH_WORKSPACE` with a literal absolute directory path, and restart the host.

Workspace expansion is recorded on _Claude Code_ v2.1.289 only; other versions are unverified. Host substitution does not export `CLAUDE_PROJECT_DIR` into the server process environment. See the [compatibility matrix](https://github.com/Curio-Data/pi-intelli-search/blob/main/docs/COMPATIBILITY.md#host-plugins) for the recorded check.


## When to Use Which Tool

### Quick Factual Question

Use `mcp__plugin_intelli-search_intelli_search__intelli_search` when you need a fast answer with sources but no deep analysis. The source list is capped at the top `defaultUrls` (default 10) entries; a search-grounded model can cite twenty or more. Read the summary; treat the source list as an index to follow up from, not as reading.

```
mcp__plugin_intelli-search_intelli_search__intelli_search(query="TypeScript 5.8 release date")
```

### Deep Research for a Coding Task

Use `mcp__plugin_intelli-search_intelli_search__intelli_research` for the full pipeline. **Always provide a `focusPrompt`.** The extraction model needs to know what to extract. Without it, you get generic summaries. Translate the user's intent into a specific extraction focus.

#### Example: Learning a New Feature

```
User: "How do runes work in Svelte 5?"

mcp__plugin_intelli-search_intelli_search__intelli_research(
  query="Svelte 5 runes tutorial examples",
  focusPrompt="Extract the core rune concepts ($state, $derived, $effect), their syntax, and how they replace the old reactive declarations. Include migration patterns from Svelte 4."
)
```

#### Example: Infrastructure and Sysadmin Detail

```
User: "How do I set up podman rootless with systemd?"

mcp__plugin_intelli-search_intelli_search__intelli_research(
  query="podman rootless systemd unit configuration",
  focusPrompt="Extract the exact directory paths podman rootless uses for systemd units, the XDG_RUNTIME_DIR and DBUS_SESSION_BUS_ADDRESS setup, and the systemd --user enable commands. Include file paths."
)
```

#### Example: Debugging a Specific Problem

```
User: "Why is my Cloudflare Worker timing out on KV writes?"

mcp__plugin_intelli-search_intelli_search__intelli_research(
  query="Cloudflare Workers KV write timeout limits",
  focusPrompt="Extract KV write limits, timeout thresholds, storage limits, and any workarounds for bulk writes. Focus on hard numbers and error messages."
)
```

#### Example: Comparing Options

```
User: "Should I use Tailwind or Vanilla Extract for a new project?"

mcp__plugin_intelli-search_intelli_search__intelli_research(
  query="Tailwind CSS vs Vanilla Extract comparison 2026",
  focusPrompt="Extract pros/cons, bundle size benchmarks, DX tradeoffs, and migration costs. Note which claims come from official sources vs blog opinions."
)
```

#### Example: API Reference

```
User: "How do I use the Defuddle npm package?"

mcp__plugin_intelli-search_intelli_search__intelli_research(
  query="defuddle npm content extraction usage",
  focusPrompt="Extract the API: install command, function signatures, options object, and output format. Include working code examples."
)
```

### Other Parameters

- `maxUrls`: `3` for quick targeted research, `10` (default) for broad research, `16` for exhaustive research. The server configuration caps this at `maxUrls` (default 20). Requests above the cap are silently clamped.
- `domains`: Guide search toward given sources, for example `domains=["react.dev", "github.com"]`. This adds a `site:` filter and, with the web search tool enabled, an engine domain filter. It is guidance, not a hard boundary: returned URLs (uniform resource locators) are not checked against a local allowlist before fetching.

### When Search Results Mix Source Types

The pipeline automatically adapts extraction to source type:

- **Official Docs or API (Application Programming Interface) Reference:** Preserves exact signatures, types, version annotations.
- **Blog Posts or Tutorials:** Captures practical patterns, gotchas, real-world examples.
- **Forums (Reddit, Discourse, StackOverflow):** Captures the problem, accepted solution, caveats. Discards tangents.

The collation instruction tells the model to flag contradictions and prefer sources in this order:

1. Official documentation
2. API reference
3. Tutorials
4. Blog posts
5. Forum threads

The instruction also retains useful practical examples and forum fixes; source priority is an instruction, not a guarantee of model compliance.

### Complex Multi-Angle Research

When you need **different focus per URL** (for example, comparing alternatives side by side), orchestrate step by step instead of using `mcp__plugin_intelli-search_intelli_search__intelli_research`:

1. `mcp__plugin_intelli-search_intelli_search__intelli_search(query)` to discover URLs.
2. Fetch the pages with a web-fetch tool if one is installed (the server does not provide one), or with available shell or Hypertext Transfer Protocol (HTTP) tools. Pass the actual page content to the next step; a URL alone is insufficient.
3. `mcp__plugin_intelli-search_intelli_search__intelli_extract(url, title, content, query, focusPrompt)` to give each URL a different focus.
4. `mcp__plugin_intelli-search_intelli_search__intelli_collate(extractions, query)` to deduplicate and cache.

Example: researching "KV vs Durable Objects". Extract KV pages with `focusPrompt="Extract KV read/write patterns, consistency model, and latency characteristics"`. Extract Durable Objects pages with `focusPrompt="Extract the consistency guarantees, transaction API, and single-computer model"`.

When constructing a collation item from an extraction result, use the original `url` and `title`, `result.details.extraction` and `result.details.sourceType`, plus an explicit `status` such as `success`. Do not forward the entire extraction `details` object: its `currentness` field is not a collation input.

## Using the Result

**The `mcp__plugin_intelli-search_intelli_search__intelli_research` result already contains a concise deduplicated summary. Use it directly. Do not read cache files unless the summary is insufficient for the task.**

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

The cache lives at `.search/<date>-<slug>-<hash>/` below the configured workspace. The tool result includes the absolute path. Use the `Read` tool, this host's file-reading capability.

| Need | File |
|------|------|
| Quick refresher on one source | `extractions/01-*.md` |
| Full original page content | `sources/01-*.md` |
| Collated overview | `report.md` |
| Per-stage outcomes | `meta.json` |
| Re-fetch a single URL fresh | Use an installed web-fetch tool or shell/HTTP tools; the server provides no standalone fetch tool |

## How It Works

Reference material for the curious. The decision logic above is what matters in practice.

`mcp__plugin_intelli-search_intelli_search__intelli_research` runs a 5-stage pipeline inside a single tool call:

1. **Search:** a search-grounded model returns a synthesised answer plus every source it cited: prose links are merged with machine-readable `url_citation` annotations harvested from the response body. Harvested citations join the candidate URL list before page selection and the `maxUrls` cap; not every discovered source is fetched.
2. **Fetch:** Each page is fetched and cleaned to Markdown (navigation, ads and sidebars stripped). A Markdown variant is fetched in parallel and the better version wins by quality score.
3. **Extract:** A configurable model pulls out only the content relevant to the query. A ≈50K-char page becomes ≈3-5K chars of focused extraction.
4. **Collate:** Another model call deduplicates across extractions and produces one concise summary. The model is instructed to flag conflicts and use the source order above.
5. **Cache suggest:** A model judge finds semantically related previous searches in `.search/` and surfaces them as a supplementary table.

You receive only the final summary plus brief stage progress. The full pipeline is hidden inside the tool so your context stays clean.

### Why Extract Before Collate?

Per-page extraction bounds collation input and keeps context use and cost manageable across model choices. As an illustration, eight fetched pages multiplied by ≈50K chars each equals ≈400K chars; compressing each independently gives the collation model ≈32K chars total. Eight pages illustrates the design, not the ten-page default.

This is also why `focusPrompt` matters. It tells the extraction model what to keep from each page. Without guidance, it extracts generically and the collation has less signal to work with.

## When Not to Search

- Writing or editing code already in the project.
- General programming concepts you are confident about.
- Refactoring or debugging with full context available.

## Failure Modes

- **Startup Failures:** Follow the setup section, correct the named path selection and restart the host. The server exits before serving, so the tools never appear and no inference runs. Standard error names the problem: `Explicit --config and --workspace are required` (missing path selections), `Cannot read configuration: provide an explicit readable JSON file`, or `workspace must be an explicit absolute directory` / `workspace must be an existing readable directory`.
- **Configuration Errors** (`CONFIGURATION`, `WORKSPACE`): a tool call found the setup incomplete or invalid (for example a missing credential or an unusable cache path). Fix the configuration and retry; no inference was billed.
- **Provider Errors** (`PROVIDER`): the provider rejected or broke the call. Check credentials or permissions for `401`/`403`, and account credits for ordinary `402` credit exhaustion. The adapter treats a `402` with a valid Retry-After header as transient budget pressure and retries it under the configured bounded policy, like rate limits (`429`) and server errors (`5xx`). If transient failures persist after those attempts, wait before a manual retry rather than changing credentials.
- **Invalid Arguments** (`INVALID_ARGUMENTS`): the call parameters failed validation. Correct the arguments; do not retry unchanged.
- **Operation Failures** (`OPERATION`): a stage of the pipeline failed after validation. The message names the stage; retry once, then report if it persists.
- **Cancelled** (`CANCELLED`): the client cancelled the call. Do not retry automatically.
- **Degraded Research** (`no-links`, `fetch-failed`, `extraction-failed`): the result is still returned with what succeeded. Check the summary and decide whether a narrower query or a retry is warranted.
- **Busy:** the eight-request queue is already full. Wait for an earlier call to finish before submitting another.
