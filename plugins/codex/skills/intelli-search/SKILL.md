---
name: intelli-search
description: "Load before calling any intelli_search, intelli_research, intelli_extract or intelli_collate tool, including requests to use intelli search. Use for current web information, documentation and API verification. Start with intelli_search for quick facts, latest versions and release dates; reserve intelli_research for multi-page analysis and comparisons. Includes tool selection, focused extraction, cache use and setup. Report unavailable tools explicitly; never claim another search used this server."
---

# Intelli Search

Intelligent web research through the `intelli-search` Model Context Protocol (MCP) server. Four tools: `mcp__intelli_search__intelli_search`, `mcp__intelli_search__intelli_extract`, `mcp__intelli_search__intelli_collate` and `mcp__intelli_search__intelli_research`. The examples below use the exact qualified names this host declares.

Use these tools for current web research when this skill is selected, rather than silently substituting host-native search. If the server or tools are unavailable, report the setup failure explicitly; using another search tool does not establish that this server worked.

Inference uses the configured provider account. The server runs one operation at a time with up to eight requests queued; excess submissions receive a busy error rather than waiting.

## When to Use Which Tool

Start with `mcp__intelli_search__intelli_search` for a factual question, latest version, release date or brief lookup. A request for current information or sources alone does not require the research pipeline. Keep the scope of the question: do not add comparisons, pricing or release history unless requested.

If a search answer looks stale or its sources disagree on the current version, try one narrower `mcp__intelli_search__intelli_search` targeting official sources before escalating to research. Report unresolved uncertainty rather than treating an older release as current.

Use `mcp__intelli_search__intelli_research` for multi-page comparisons or detailed analysis, or when a search answer leaves a specific evidence gap requiring multiple pages. Search does not fetch and extract each cited page; research adds those stages, collation and cache suggestions. That pipeline makes more provider calls and can take minutes. A longer source list alone is not a reason to choose it.

### Quick Factual Question

Use `mcp__intelli_search__intelli_search` for a quick factual answer with sources but no deep analysis. The source list is capped at the top `defaultUrls` (default 10) entries; a search-grounded model can cite twenty or more. Read the summary; treat the source list as an index to follow up from, not as reading.

```
mcp__intelli_search__intelli_search(query="TypeScript 5.8 release date")
```

### Deep Research for a Coding Task

Use `mcp__intelli_search__intelli_research` when the task needs the full pipeline. Set `maxUrls` to the smallest useful breadth, starting with `3` for targeted research. Always provide a `focusPrompt` to specify the content to retain. Without that guidance, the extraction model produces generic summaries. Translate the user's intent into a specific extraction focus.

#### Example: Learning a New Feature

```
User: "How do runes work in Svelte 5?"

mcp__intelli_search__intelli_research(
  query="Svelte 5 runes tutorial examples",
  maxUrls=3,
  focusPrompt="Extract the core rune concepts ($state, $derived, $effect), their syntax, and how they replace the old reactive declarations. Include migration patterns from Svelte 4."
)
```

#### Example: Infrastructure and Sysadmin Detail

```
User: "How do I set up podman rootless with systemd?"

mcp__intelli_search__intelli_research(
  query="podman rootless systemd unit configuration",
  maxUrls=3,
  focusPrompt="Extract the exact directory paths podman rootless uses for systemd units, the XDG_RUNTIME_DIR and DBUS_SESSION_BUS_ADDRESS setup, and the systemd --user enable commands. Include file paths."
)
```

#### Example: Debugging a Specific Problem

```
User: "Why is my Cloudflare Worker timing out on KV writes?"

mcp__intelli_search__intelli_research(
  query="Cloudflare Workers KV write timeout limits",
  maxUrls=3,
  focusPrompt="Extract KV write limits, timeout thresholds, storage limits, and any workarounds for bulk writes. Focus on hard numbers and error messages."
)
```

#### Example: Comparing Options

```
User: "Should I use Tailwind or Vanilla Extract for a new project?"

mcp__intelli_search__intelli_research(
  query="Tailwind CSS vs Vanilla Extract comparison 2026",
  maxUrls=6,
  focusPrompt="Extract pros/cons, bundle size benchmarks, DX tradeoffs, and migration costs. Note which claims come from official sources vs blog opinions."
)
```

#### Example: API Reference

An application programming interface (API) reference task needs exact signatures and options.

```
User: "How do I use the Defuddle npm package?"

mcp__intelli_search__intelli_research(
  query="defuddle npm content extraction usage",
  maxUrls=3,
  focusPrompt="Extract the API: install command, function signatures, options object, and output format. Include working code examples."
)
```

### Other Parameters

- `maxUrls`: `3` for quick targeted research, `10` (default) for broad research, `16` for exhaustive research. The server configuration caps this at `maxUrls` (default 20). Requests above the cap are silently clamped.
- `domains`: Guide search toward given sources, for example `domains=["react.dev", "github.com"]`. This adds a `site:` filter and, with the web search tool enabled, an engine domain filter. It is guidance, not a hard boundary: returned URLs (uniform resource locators) are not checked against a local allowlist before fetching.

### When Search Results Mix Source Types

The pipeline automatically adapts extraction to source type:

- **Official Docs or API Reference:** Preserves exact signatures, types and version annotations.
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

For a different focus per URL (for example, comparing alternatives side by side), orchestrate step by step instead of using `mcp__intelli_search__intelli_research`:

1. `mcp__intelli_search__intelli_search(query)` to discover URLs.
2. Fetch the pages with a web-fetch tool if one is installed (the server does not provide one), or with available shell or Hypertext Transfer Protocol (HTTP) tools. Pass the actual page content to the next step; a URL alone is insufficient.
3. `mcp__intelli_search__intelli_extract(url, title, content, query, focusPrompt)` to give each URL a different focus.
4. `mcp__intelli_search__intelli_collate(extractions, query)` to deduplicate and cache.

Example: researching "KV vs Durable Objects". Extract KV pages with `focusPrompt="Extract KV read/write patterns, consistency model, and latency characteristics"`. Extract Durable Objects pages with `focusPrompt="Extract the consistency guarantees, transaction API, and single-computer model"`.

When constructing a collation item from an extraction result, use the original `url` and `title`, `result.details.extraction` and `result.details.sourceType`, plus an explicit `status` such as `success`. Do not forward the entire extraction `details` object: its `currentness` field is not a collation input.

## Evidence and Provenance

The Source Assessment inventory is generated from successful, non-empty extractions, not the search model's citations. IDs such as `[S1]` identify those evidence entries; cross-links in the synthesis are not additional fetched pages. Read exact cache paths from the inventory rather than guessing numbered filenames. `Not cached` means no full-page file exists for that source. The checks establish reference consistency, not factual accuracy.

Manual `mcp__intelli_search__intelli_collate` treats its inputs as caller-supplied evidence. Supply one non-empty successful extraction per URL; the optional `searchSummary` is accepted for compatibility but does not enter synthesis. Provenance failures return an error before report writes and preserve any prior successful output. They are not automatically retried; a manual rerun repeats the paid stages.

## Using the Result

The `mcp__intelli_search__intelli_research` result already contains a concise deduplicated summary. Use it directly. Do not read cache files unless the summary is insufficient for the task.

Before repeating a query whose report must be retained, copy the report elsewhere. A successful repeat on the same Coordinated Universal Time (UTC) date attempts to archive the previous run's artefacts to a numbered sibling folder (`<slug>.1`, then `.2` and so on) before writing fresh results. Archiving is best-effort: a failure is logged and the new run can replace the canonical files in place, leaving an incomplete archive. A degraded repeat preserves an earlier successful report and records the failed attempt in telemetry when enabled. The numbered siblings are a same-day safety measure, not a retention guarantee.

The result also includes a `📚 Related cached searches` section when semantically similar previous searches exist in the workspace cache. These are discovered by a model judge that compares the current query against the cache index. The related searches are:

- **Supplementary:** The live search always runs. Cached results are offered as additional context.
- **Cross-Reference:** Read a previous `report.md` when live results are incomplete.
- **Prior Evidence:** Point to earlier research on the same topic when the live result needs checking.

Only reach into the cache when:

- The user asks about a specific source that needs re-examination.
- A required code example was truncated in the summary.
- A claim in the summary needs checking against the original source.
- The live results are insufficient and a related cached search may help.

## Follow Up from Cache

The tool result's `details.cachePath` identifies the cache entry's absolute path. The default is `.search/<date>-<slug>-<hash>/` below the selected workspace; `tuning.cacheDir` can change the cache root. Read those files with available shell or file-reading tools. List the directory and select an exact filename; the examples below are paths, not commands.

| Need | File |
|------|------|
| Quick refresher on one source | `extractions/<exact-file>.md` |
| Full original page content | `sources/<exact-file>.md` |
| Collated overview | `report.md` |
| Per-stage outcomes | `meta.json` |
| Re-fetch a single URL fresh | Use an installed web-fetch tool or shell/HTTP tools; the server provides no standalone fetch tool |

## How It Works

The following stages execute inside the research tool.

`mcp__intelli_search__intelli_research` runs a 5-stage pipeline inside a single tool call:

1. **Search:** a search-grounded model returns a synthesised answer. Prose links are merged with provider-supplied citation URLs recovered from recognised `url_citation` annotations. Harvesting is best-effort, not a complete record of sources consulted. The merged candidates are selected under the `maxUrls` cap; not every discovered source is fetched.
2. **Fetch:** Each page is fetched and cleaned to Markdown (navigation, ads and sidebars stripped). A Markdown variant is fetched in parallel and the better version wins by quality score.
3. **Extract:** A configurable model pulls out only the content relevant to the query. A ≈50K-char page becomes ≈3-5K chars of focused extraction.
4. **Collate:** Another model call deduplicates across extractions and produces one concise summary. The model is instructed to flag conflicts and use the source order above.
5. **Cache Suggest:** A model judge looks for related previous searches in the configured cache index. The pipeline awaits the judge under the model-call timeout and retry policy; judge failure is logged without discarding completed research. Cancellation still propagates.

The agent receives the final summary, source/cache references and brief stage progress rather than the full fetched pages. Summary length depends on `collationMaxTokens` and model output; appendices add further text.

<a id="why-extract-before-collate"></a>
### Extraction Before Collation

Per-page extraction bounds collation input and keeps context use and cost manageable across model choices. As an illustration, eight fetched pages multiplied by ≈50K chars each equals ≈400K chars; compressing each independently gives the collation model ≈32K chars total. Eight pages illustrates the design, not the ten-page default.

This is also why `focusPrompt` matters. It tells the extraction model what to keep from each page. Without guidance, it extracts generically and the collation has less signal to work with.

## When Not to Search

- Writing or editing code already in the project.
- General programming concepts that need no current external evidence.
- Refactoring or debugging with full context available.

## Setup (One Time)

The plugin launches the pinned `@curio-data/mcp-intelli-search` package through `npx`. The first start downloads the package, so it needs network access and can take half a minute; later starts reuse the `npx` cache. [Node.js](https://nodejs.org/) 22 or later must be on `PATH`.

[_Codex_](https://developers.openai.com/codex/plugins) starts plugin MCP servers with a filtered environment: arbitrary parent variables are not inherited and plugin MCP configuration performs no placeholder expansion (verified on the command-line interface (CLI) version 0.144.5). The plugin therefore declares `env_vars` so Codex forwards three named variables from the shell that launches `codex`:

- `OPENROUTER_API_KEY`: the [OpenRouter](https://openrouter.ai) application programming interface (API) key. One key covers all three pipeline stages.
- `INTELLI_SEARCH_CONFIG`: absolute path of the configuration file.
- `INTELLI_SEARCH_WORKSPACE`: absolute path of the workspace; the default research cache is its `.search/` subdirectory.

Supply the key at launch from a secret manager, or enter it at a hidden [_Bash_](https://www.gnu.org/software/bash/) prompt. Do not store a literal key in a shell profile or command history:

```bash
read -r -s -p 'OpenRouter API key: ' OPENROUTER_API_KEY
printf '\n'
export OPENROUTER_API_KEY
export INTELLI_SEARCH_CONFIG="$HOME/.config/mcp-intelli-search/config.json"
export INTELLI_SEARCH_WORKSPACE="$PWD"
```

The snippet exports the launch directory as the workspace. For a stable per-project cache regardless of launch directory, set `INTELLI_SEARCH_WORKSPACE` to the project directory through `direnv` or another per-directory mechanism.

Create the parent directory and workspace, then save the following JavaScript Object Notation (JSON) configuration to `$INTELLI_SEARCH_CONFIG`:

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

These are explicit selections, not inherited defaults. Select OpenRouter models that pass catalogue validation for the required roles and are accessible to the configured account. Search requires `perplexity/sonar`, `perplexity/sonar-pro` or `perplexity/sonar-pro-search`, or a chat model with advertised tool support and an enabled `searchWebSearch` block. See [Configuration](https://github.com/Curio-Data/pi-intelli-search/blob/main/packages/mcp/README.md#configuration) and [Tuning](https://github.com/Curio-Data/pi-intelli-search/blob/main/packages/mcp/README.md#tuning) in the standalone guide.

If either path selection (`INTELLI_SEARCH_CONFIG` or `INTELLI_SEARCH_WORKSPACE`) is missing, the server exits on startup with `Explicit --config and --workspace are required` on standard error and the tools never appear. Supply both paths and restart _Codex_. A missing or invalid selected configuration file does not stop connection. Each tool call reports a `CONFIGURATION` error naming the file; repair it and call again. The server rereads it until it loads successfully, then keeps it until restart.

A missing `OPENROUTER_API_KEY` is different: credentials are validated when an operation runs, not at server startup. Export the key and restart the host so the server receives the updated environment. Host forwarding behaviour is recorded for Codex CLI 0.144.5 in the [compatibility matrix](https://github.com/Curio-Data/pi-intelli-search/blob/main/docs/COMPATIBILITY.md#host-plugins).

### Verify Inference

Start Codex from the configured shell and request a quick search with the exposed `intelli_search` tool. Confirm an actual MCP tool call and an answer with sources. `codex mcp list` only lists configuration and does not prove server startup or provider access. If these tools are unavailable, report that setup is incomplete; do not claim to have used this server while answering through built-in web search.

### Unattended Runs

Interactive sessions ask before each research tool call. Non-interactive `codex exec` cannot ask, so it cancels the call and reports `user cancelled MCP tool call`. To run the tools unattended, pre-approve them in `${CODEX_HOME:-$HOME/.codex}/config.toml`:

```toml
[plugins."intelli-search@curio-data-plugins".mcp_servers.intelli_search]
default_tools_approval_mode = "approve"
```

Recorded on Codex CLI 0.144.5.


## Failure Modes

- **Startup Failures:** Absent path selections and unusable workspaces still fail before serving. Cache safety is checked when valid configuration becomes available: at startup for a loadable file, or on a tool call after file recovery. Correct the diagnostic and restart the host. `--check-config` remains strict and exits with status `1` for invalid configuration or workspace selections.
- **Configuration Errors** (`CONFIGURATION`, `WORKSPACE`): a tool call found incomplete setup. For a missing, unreadable or invalid selected file, repair the named file and call again; the server rereads it on each call until it loads. JSON syntax diagnostics give a location without echoing the file. After a successful load, configuration changes need a restart. Missing credentials also require restart because the environment is captured at startup. These preflight errors incur no inference charges.
- **Provider Errors** (`PROVIDER`): the provider rejected or broke the call. Check credentials or permissions for `401`/`403`, and account credits for ordinary `402` credit exhaustion. The adapter treats a `402` with a valid Retry-After header as transient budget pressure and retries it under the configured bounded policy, like rate limits (`429`) and server errors (`5xx`). If transient failures persist after those attempts, wait before a manual retry rather than changing credentials.
- **Invalid Arguments** (`INVALID_ARGUMENTS`): the call parameters failed validation. Correct the arguments; do not retry unchanged.
- **Operation Failures** (`OPERATION`): a stage of the pipeline failed after validation. The message names the stage; retry once, then report if it persists.
- **Cancelled** (`CANCELLED`): the client cancelled the call. Do not retry automatically.
- **Degraded Research** (`no-links`, `fetch-failed`, `extraction-failed`): the result is still returned with what succeeded. Check the summary and decide whether a narrower query or a retry is warranted.
- **Busy:** the eight-request queue is already full. Wait for an earlier call to finish before submitting another.
