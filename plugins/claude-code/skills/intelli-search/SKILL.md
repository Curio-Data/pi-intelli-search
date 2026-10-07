---
name: intelli-search
description: "Use intelli-search for current web research, documentation lookup, API verification, library comparisons and release information. Prefer its search or multi-page research tools to built-in web search when this skill is selected. Includes installation, configuration and troubleshooting. Report unavailable tools explicitly; never claim another search used this server."
---

# Intelli Search

Intelligent web research through the `intelli-search` Model Context Protocol (MCP) server. Four tools: `mcp__plugin_intelli-search_intelli_search__intelli_search`, `mcp__plugin_intelli-search_intelli_search__intelli_extract`, `mcp__plugin_intelli-search_intelli_search__intelli_collate` and `mcp__plugin_intelli-search_intelli_search__intelli_research`. The examples below use the exact qualified names this host declares.

Use these tools for current web research when this skill is selected, rather than silently substituting host-native search. If the server or tools are unavailable, report the setup failure explicitly; using another search tool does not establish that this server worked.

Inference uses the configured provider account. The server runs one operation at a time with up to eight requests queued; excess submissions receive a busy error rather than waiting.

## Setup (One Time)

The plugin launches the pinned `@curio-data/mcp-intelli-search` package through `npx`. The first start downloads the package, so it needs network access and can take half a minute; later starts reuse the `npx` cache. [Node.js](https://nodejs.org/) 22 or later must be on `PATH`.

The launcher supplies:

- `INTELLI_SEARCH_CONFIG=${CLAUDE_PLUGIN_DATA}/config.json` (the configuration file lives in the plugin data directory, which persists across plugin updates)
- `INTELLI_SEARCH_WORKSPACE=${CLAUDE_PROJECT_DIR}` (the opened project, whose default research cache is `.search/`)
- `OPENROUTER_API_KEY` from the plugin's required `openrouter_api_key` option, which _Claude Code_ keeps in its credential store

The plugin data directory is `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/data/intelli-search-curio-data-plugins/`. The host substitutes `${CLAUDE_PLUGIN_DATA}` in the loaded skill; that variable is not automatically exported in an ordinary shell. Run `/intelli-search:intelli-search` for the substituted view.

Steps:

1. Set the [OpenRouter](https://openrouter.ai) application programming interface (API) key in the plugin's required `openrouter_api_key` option. Installing does not ask for it: _Claude Code_ reports that the server needs configuration and does not start it until the option is set. One key covers all three pipeline stages. An exported `OPENROUTER_API_KEY` is not used: the plugin option always supplies the variable. Set the option either way:

   - **Session Setup:** run `/plugin`, select `intelli-search` in the Installed tab and choose Configure.
   - **Shell Setup:** pipe the value in, so the key never appears in a process list. Enter it hidden first, and clear the temporary variable afterwards:

     ```bash
     read -r -s -p 'OpenRouter API key: ' KEY
     printf '\n'
     printf '{"openrouter_api_key":"%s"}' "$KEY" \
       | claude plugin configure intelli-search@curio-data-plugins --values-stdin
     unset KEY
     ```

     `printf` here is the shell builtin, which starts no process; keep it rather than `jq --arg` or `echo` through another program. Do not use `claude plugin install --config openrouter_api_key=...`: it places the key on the command line. The command reports `Restart Claude Code to apply it`: sessions already open keep the options they loaded, so restart them.

   The shell route needs `claude plugin configure --values-stdin`, which the _Claude Code_ documentation lists from 2.1.285; the plugin is verified on 2.1.289.
2. Create the plugin data directory and write the configuration file. The data directory is the expanded form of `${CLAUDE_PLUGIN_DATA}`, which is not automatically exported in an ordinary shell:

   ```bash
   PLUGIN_DATA="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/data/intelli-search-curio-data-plugins"
   mkdir -p "$PLUGIN_DATA"
   ```

   Write the following JavaScript Object Notation (JSON) configuration to `$PLUGIN_DATA/config.json`:

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
3. Restart _Claude Code_ and verify with `claude mcp list`: the server `plugin:intelli-search:intelli_search` must show as connected. If it is absent, check the key option. Then request a quick search through the server and confirm a model-visible answer with sources; connection alone does not verify inference.

An explicitly selected missing or invalid `config.json` no longer prevents the server from connecting. Tool calls name the file defect without billing inference; repair the file and call again. The server rereads the file on each call until it loads, then keeps it until restart. Credentials are always captured at startup, so changing the key still requires a restart.

For a failed connection, inspect the host's MCP diagnostics. On Linux with Claude Code 2.1.289, logs were under `~/.cache/claude-cli-nodejs/<project>/mcp-logs-plugin-intelli-search-intelli-search/`. A cached startup failure from an older server may survive a repair: try `/mcp` reconnect and restart the session. The recorded failure cache expired after approximately 15 minutes; reconnect clearing that cache is not established.

Uninstalling the plugin removes the contents of its data directory, including `config.json`; keep a copy before uninstalling if reinstallation is planned. If _Claude Code_ reports that it could not clear the plugin's stored options, remove the `pluginSecrets` entry for `intelli-search@curio-data-plugins` from its credential store, and rotate the key if uninstalling to retire it.

### Authentication Failure

A `401` from an operation means the server received a key OpenRouter rejects. Replace the stored option in a session through `/plugin` → Installed → `intelli-search` → Configure, then reconnect the server with `/mcp`. If replacing it from a shell instead, restart the session: an open session keeps the options it loaded. Exporting a different `OPENROUTER_API_KEY` has no effect on this plugin.

### Workspace Expansion Failure

If standard error reports `workspace must be an explicit absolute directory` because the host left `CLAUDE_PROJECT_DIR` unexpanded, edit the installed plugin's `.mcp.json`, replace `INTELLI_SEARCH_WORKSPACE` with a literal absolute directory path, and restart the host.

Workspace expansion is recorded on _Claude Code_ v2.1.289 only; other versions are unverified. Host substitution does not export `CLAUDE_PROJECT_DIR` into the server process environment. See the [compatibility matrix](https://github.com/Curio-Data/pi-intelli-search/blob/main/docs/COMPATIBILITY.md#host-plugins) for the recorded check.


## When to Use Which Tool

### Quick Factual Question

Use `mcp__plugin_intelli-search_intelli_search__intelli_search` for a quick factual answer with sources but no deep analysis. The source list is capped at the top `defaultUrls` (default 10) entries; a search-grounded model can cite twenty or more. Read the summary; treat the source list as an index to follow up from, not as reading.

```
mcp__plugin_intelli-search_intelli_search__intelli_search(query="TypeScript 5.8 release date")
```

### Deep Research for a Coding Task

Use `mcp__plugin_intelli-search_intelli_search__intelli_research` for the full pipeline. Always provide a `focusPrompt` to specify the content to retain. Without that guidance, the extraction model produces generic summaries. Translate the user's intent into a specific extraction focus.

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

An application programming interface (API) reference task needs exact signatures and options.

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

For a different focus per URL (for example, comparing alternatives side by side), orchestrate step by step instead of using `mcp__plugin_intelli-search_intelli_search__intelli_research`:

1. `mcp__plugin_intelli-search_intelli_search__intelli_search(query)` to discover URLs.
2. Fetch the pages with a web-fetch tool if one is installed (the server does not provide one), or with available shell or Hypertext Transfer Protocol (HTTP) tools. Pass the actual page content to the next step; a URL alone is insufficient.
3. `mcp__plugin_intelli-search_intelli_search__intelli_extract(url, title, content, query, focusPrompt)` to give each URL a different focus.
4. `mcp__plugin_intelli-search_intelli_search__intelli_collate(extractions, query)` to deduplicate and cache.

Example: researching "KV vs Durable Objects". Extract KV pages with `focusPrompt="Extract KV read/write patterns, consistency model, and latency characteristics"`. Extract Durable Objects pages with `focusPrompt="Extract the consistency guarantees, transaction API, and single-computer model"`.

When constructing a collation item from an extraction result, use the original `url` and `title`, `result.details.extraction` and `result.details.sourceType`, plus an explicit `status` such as `success`. Do not forward the entire extraction `details` object: its `currentness` field is not a collation input.

## Using the Result

The `mcp__plugin_intelli-search_intelli_search__intelli_research` result already contains a concise deduplicated summary. Use it directly. Do not read cache files unless the summary is insufficient for the task.

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

The tool result's `details.cachePath` identifies the cache entry's absolute path. The default is `.search/<date>-<slug>-<hash>/` below the selected workspace; `tuning.cacheDir` can change the cache root. Use the `Read` tool, this host's file-reading capability. List the directory and select an exact filename; the examples below are paths, not commands.

| Need | File |
|------|------|
| Quick refresher on one source | `extractions/<exact-file>.md` |
| Full original page content | `sources/<exact-file>.md` |
| Collated overview | `report.md` |
| Per-stage outcomes | `meta.json` |
| Re-fetch a single URL fresh | Use an installed web-fetch tool or shell/HTTP tools; the server provides no standalone fetch tool |

## How It Works

The following stages execute inside the research tool.

`mcp__plugin_intelli-search_intelli_search__intelli_research` runs a 5-stage pipeline inside a single tool call:

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

## Failure Modes

- **Startup Failures:** Absent path selections and unusable workspaces still fail before serving. Cache safety is checked when valid configuration becomes available: at startup for a loadable file, or on a tool call after file recovery. Correct the diagnostic and restart the host. `--check-config` remains strict and exits with status `1` for invalid configuration or workspace selections.
- **Configuration Errors** (`CONFIGURATION`, `WORKSPACE`): a tool call found incomplete setup. For a missing, unreadable or invalid selected file, repair the named file and call again; the server rereads it on each call until it loads. JSON syntax diagnostics give a location without echoing the file. After a successful load, configuration changes need a restart. Missing credentials also require restart because the environment is captured at startup. These preflight errors incur no inference charges.
- **Provider Errors** (`PROVIDER`): the provider rejected or broke the call. Check credentials or permissions for `401`/`403`, and account credits for ordinary `402` credit exhaustion. The adapter treats a `402` with a valid Retry-After header as transient budget pressure and retries it under the configured bounded policy, like rate limits (`429`) and server errors (`5xx`). If transient failures persist after those attempts, wait before a manual retry rather than changing credentials.
- **Invalid Arguments** (`INVALID_ARGUMENTS`): the call parameters failed validation. Correct the arguments; do not retry unchanged.
- **Operation Failures** (`OPERATION`): a stage of the pipeline failed after validation. The message names the stage; retry once, then report if it persists.
- **Cancelled** (`CANCELLED`): the client cancelled the call. Do not retry automatically.
- **Degraded Research** (`no-links`, `fetch-failed`, `extraction-failed`): the result is still returned with what succeeded. Check the summary and decide whether a narrower query or a retry is warranted.
- **Busy:** the eight-request queue is already full. Wait for an earlier call to finish before submitting another.
