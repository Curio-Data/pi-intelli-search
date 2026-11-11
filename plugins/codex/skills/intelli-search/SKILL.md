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

- `maxUrls`: `3` for quick targeted research, `10` (default) for broad research, `16` for exhaustive research. Pass at least `1`; the tool schema declares `minimum: 1`. The server configuration caps this at `maxUrls` (default 20). Requests above the cap are silently clamped.
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

When constructing a collation item from an extraction result, use the original `url` and `title`, plus `status: "success"`. Set `extraction` to the text below the result's `### Extraction:` heading, without the extraction-limit warning that can end it (also `details.extraction`). Set `sourceType` from the first line of that text, checking in this order: a line containing `official doc` is `official docs`, `api reference` is `API reference`, `tutorial` is `tutorial`, `blog` is `blog post`, and `forum` or `stackoverflow` is `forum`, ignoring case; any other line is `unknown` (also `details.sourceType`). Set `truncated: true` when the result ends with the warning that extraction output reached `extractionMaxTokens` (also `details.truncated`). If extraction fails, retain that source as a failed item with an empty `extraction`, an explicit `sourceType` such as `unknown`, `status: "failed"` and an optional bounded `error` string describing the failure. Failed items are listed for coverage but do not enter synthesis. Do not forward the entire extraction `details` object: its `currentness` field is not a collation input.

## Evidence and Provenance

The Source Assessment inventory is generated from successful, non-empty extractions, not the search model's citations. IDs such as `[S1]` identify those evidence entries; cross-links in the synthesis are not additional fetched pages. Read exact cache paths from the inventory rather than guessing numbered filenames. `Not cached` means no full-page file exists for that source. The checks establish reference consistency, not factual accuracy.

Manual `mcp__intelli_search__intelli_collate` treats its inputs as caller-supplied evidence. Supply one non-empty successful extraction per URL; the optional `searchSummary` is accepted for compatibility but does not enter synthesis. Provenance failures return an error before report writes and preserve any prior successful output. They are not automatically retried; a manual rerun repeats the paid stages.

## Using the Result

The `mcp__intelli_search__intelli_research` result already contains a concise deduplicated summary. Use it directly. Do not read cache files unless the summary is insufficient for the task.

Before repeating a query whose report must be retained, copy the report elsewhere. A successful repeat on the same Coordinated Universal Time (UTC) date attempts to archive the previous run's artefacts to a numbered sibling folder (`<slug>.1`, then `.2` and so on) before writing fresh results. Archiving is best-effort: a failure is logged and the new run can replace the canonical files in place, leaving an incomplete archive. A degraded repeat preserves an earlier successful report and records the failed attempt in telemetry when enabled. An `extraction-failed` or `collate-failed` repeat replaces only an earlier failure report, archiving it first; the other degraded exits leave any report in place. The numbered siblings are a same-day safety measure, not a retention guarantee.

The result also includes a `📚 Related cached searches` section when semantically similar previous searches exist in the workspace cache. These are discovered by a model judge that compares the current query against the cache index. The related searches are:

- **Supplementary:** The live search always runs. Cached results are offered as additional context.
- **Cross-Reference:** Read a previous `report.md` when live results are incomplete.
- **Prior Evidence:** Point to earlier research on the same topic when the live result needs checking.

Only reach into the cache when:

- The user asks about a specific source that needs re-examination.
- A required code example was truncated in the summary.
- A claim in the summary needs checking against the original source.
- The live results are insufficient and a related cached search may help.

### Failed and Incomplete Sources

A completed result can still have missing evidence. Check the **Failed Sources** list and truncation warnings before treating the report as complete. Fetch failures and extraction failures are separate counts; a saved full-page link exists only when that page was cached. When a result says pages were saved under `sources/`, read the one that matches the question before re-running research.

A truncation warning means generation stopped at the stage's output cap, shown by finish reason `length` or reported usage at the cap; it does not prove exactly where text stopped. Without either signal, the absence of a warning does not establish completeness. Do not present a warned-about extraction or synthesis as complete evidence.

For a budget-exhaustion diagnostic, review the matching extraction or collation token cap with the maintainer rather than retrying unchanged. The cap can include reasoning tokens, and lowering reasoning effort is not a guaranteed remedy. A standalone extraction that reached its cap ends with an extraction-limit warning (also `details.truncated`); carry it into manual collation as `truncated: true`. Pass `inferred: true` for a source listed under Inferred Assets or marked `(inferred from text, not a citation)` by `mcp__intelli_search__intelli_search`. An `extraction-failed` result names the folder in its **Cache** line (also `details.cachePath`), where every fetched page is saved under `sources/`, and its **Failed Sources** list gives each saved page's path and why its extraction failed; read the matching page, or pass it to `mcp__intelli_search__intelli_extract`, instead of repeating the research. An all-fetch-failed result returns the search summary and up to ten failed URLs with their reasons. A `collate-failed` result names a cached report that lists the saved extractions, which can be read instead of repeating the research. Either failure outcome can instead state that a same-day successful report for the query was preserved and name its folder in the failure message (also `details.preservedCachePath`). This run's pages and extractions were not saved. Its outcome, when telemetry is enabled, and any synthesis rejected by source validation are saved in a separate `attempts/attempt-*` folder beneath the preserved report; a rejected synthesis is named in the result, is kept for diagnosis only and is not accepted evidence. A preserved `extraction-failed` result lists up to ten failed pages with their reasons inline; a preserved `collate-failed` result gives the collation failure reason. A truncation warning on the synthesis means every budget attempt was truncated, or no completed attempt passed source validation; the warning names the cap of the response used. A failed cache judge does not invalidate completed research, and no related-search suggestions do not establish that no relevant cache exists.

### Inferred Assets

An `Inferred Assets` table, also in `details.inferredAssets`, lists references guessed from search text, such as `install.sh` or `manage.py`, rather than cited. Each row gives the original token, the normalised URL it was fetched as, the fetch result (page, code file, text file, or nothing fetched with a reason) and the saved `sources/` path. When a fetched file may answer the question, read it, and treat it as a guess, not a citation. Check the final URL before relying on the content: "redirected to a different host" means the content came from another hostname, which is not evidence of a different organisation, and an alternate is a different representation, not a redirect. "Code file" classifies the media type or extension, not the language. `mcp__intelli_search__intelli_search` marks the same sources `(inferred from text, not a citation)`.

### Trimmed Collation Input

A **Collation input trimmed** notice means the synthesis did not see the full text of each listed extraction. Read each listed extraction file, at the path the notice gives, to recover the omitted text; re-running research does not recover it. A per-source trim names `collationSourceMaxTokens`; raising it sends more of one long page. A budget trim names `collationInputBudgetTokens`; raising it, or requesting fewer URLs, sends more overall. A source trimmed by both limits needs both raised: raising only the budget does not recover text removed by the per-source cap. Report the setting named on the notice's **Configuration** line to the maintainer rather than changing it.

## Follow Up from Cache

The result's **Cache** line, also `details.cachePath`, gives the cache entry's absolute path; a preserved report's path is in the failure message, also `details.preservedCachePath`. The default is `.search/<date>-<slug>-<hash>/` below the selected workspace; `tuning.cacheDir` can change the cache root. Read those files with available shell or file-reading tools. List the directory and select an exact filename; the examples below are paths, not commands.

| Need | File |
|------|------|
| Quick refresher on one source | `extractions/<exact-file>.md` |
| Full original page content | `sources/<exact-file>.md` |
| Collated overview | `report.md` |
| Per-stage outcomes for this folder's report | `meta.json` |
| Outcome of a failed repeat beside a preserved report | `attempts/attempt-<exact-folder>/meta.json` |
| Synthesis rejected by source validation (diagnosis only) | `rejected-synthesis.json`, or the path the result names |
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

The plugin launches the pinned `@curio-data/mcp-intelli-search` package through `npx` with `--host codex`. The first start downloads the package, so it needs network access and can take half a minute; later starts reuse the `npx` cache. [_Node.js_](https://nodejs.org/) 22 or later must be on `PATH`.

No path or credential exports are required. The server uses the [_Codex_](https://developers.openai.com/codex/plugins) working root as its workspace and writes research cache below it. Launch Codex from the project folder or use its `--cd` option. Without a configuration file, Codex mode selects `perplexity/sonar` for search and `minimax/minimax-m3` for extraction and collation. Its four tools start even when credentials are absent.

From the project folder in [_Bash_](https://www.gnu.org/software/bash/), store the [OpenRouter](https://openrouter.ai) application programming interface (API) key through the setup command. Enter it at a hidden prompt and pipe it through standard input. Do not put the key in process arguments, shell history or configuration JSON. Run the setup command below:

```bash
read -r -s -p 'OpenRouter API key: ' OPENROUTER_API_KEY
printf '\n'
printf '%s\n' "$OPENROUTER_API_KEY" | \
  npx -y --package @curio-data/mcp-intelli-search \
  mcp-intelli-search setup
unset OPENROUTER_API_KEY
```

Setup creates `${XDG_CONFIG_HOME:-$HOME/.config}/mcp-intelli-search/config.json` when absent and stores the key separately as `openrouter.key` with user-only permissions. Existing model and tuning selections are preserved. Setup adds a missing `apiKeyFile` selection and honours an existing custom credential path.

The next tool call reads a new or replacement key without a restart when the loaded configuration selects that path. Restart after changing loaded configuration. An `OPENROUTER_API_KEY` exported before _Codex_ launches remains an alternative and takes precedence over the file; the plugin forwards that variable and `XDG_CONFIG_HOME`. Confirm that setup prints `Setup complete.` before starting or using _Codex_. Codex mode ignores legacy `INTELLI_SEARCH_CONFIG` and `INTELLI_SEARCH_WORKSPACE` exports; explicit command-line selections remain available. A home or filesystem-root working directory produces an actionable `WORKSPACE` tool error instead of an accidental shared cache; restart _Codex_ from the project or with `--cd <project>`.

Edit the per-user `config.json` to override models or tuning. Custom models must pass catalogue validation for the required roles and be accessible to the configured account. Search requires a supported Sonar model or a tool-capable chat model with `searchWebSearch` enabled. This is the same explicit JSON format used by generic registration, with `providers.openrouter.apiKeyFile` set to the credential path. Configuration changes require a restart. See [Configuration](https://github.com/Curio-Data/pi-intelli-search/blob/main/packages/mcp/README.md#configuration) and [Tuning](https://github.com/Curio-Data/pi-intelli-search/blob/main/packages/mcp/README.md#tuning) in the standalone guide.

The `/mcp` status `Auth: Unsupported` is expected for this stdio server. It means that the OAuth authorization framework is not used; it does not describe the OpenRouter credential. The status `failed (0 tools)` means that startup or initialisation failed, not that the key is missing. A missing key instead produces an actionable `CONFIGURATION` tool result naming `mcp-intelli-search setup`.

### Verify Inference

Start _Codex_ normally and request a quick search with the exposed `intelli_search` tool. Confirm an actual MCP tool call and an answer with sources. `codex mcp list` only lists configuration and does not prove server startup or provider access. If these tools are unavailable, report that setup is incomplete; do not claim to have used this server while answering through built-in web search.

### Unattended Runs

Interactive sessions ask before each research tool call. Non-interactive `codex exec` cannot ask, so it cancels the call and reports `user cancelled MCP tool call`. To run the tools unattended, pre-approve them in `${CODEX_HOME:-$HOME/.codex}/config.toml`:

```toml
[plugins."intelli-search@curio-data-plugins".mcp_servers.intelli_search]
default_tools_approval_mode = "approve"
```

See the [compatibility matrix](https://github.com/Curio-Data/pi-intelli-search/blob/main/docs/COMPATIBILITY.md#host-plugins) for the host versions and evidence classes.


## Failure Modes

- **Startup Failures:** Absent path selections and unusable workspaces still fail before serving. Cache safety is checked when valid configuration becomes available: at startup for a loadable file, or on a tool call after file recovery. Correct the diagnostic and restart the host. `--check-config` remains strict and exits with status `1` for invalid configuration or workspace selections.
- **Configuration Errors** (`CONFIGURATION`, `WORKSPACE`): a tool call found incomplete setup. For a missing, unreadable or invalid selected file, repair the named file and call again; the server rereads it on each call until it loads. JSON syntax diagnostics give a location without echoing the file. After a successful load, configuration changes need a restart. Environment credentials are captured at startup and require a restart; a configured credential file is reread on each call. These preflight errors incur no inference charges.
- **Provider Errors** (`PROVIDER`): the provider rejected or broke the call. Check credentials or permissions for `401`/`403`, and account credits for ordinary `402` credit exhaustion. The adapter treats a `402` with a valid Retry-After header as transient budget pressure and retries it under the configured bounded policy, like rate limits (`429`) and server errors (`5xx`). If transient failures persist after those attempts, wait before a manual retry rather than changing credentials.
- **Invalid Arguments** (`INVALID_ARGUMENTS`): the call parameters failed validation. Correct the arguments; do not retry unchanged.
- **Operation Failures** (`OPERATION`): a stage failed after validation. Read the diagnostic before repeating paid work. For an exhausted output budget or a provenance failure, correct the cause rather than retrying unchanged. Report persistent failures with the stage and bounded diagnostic, without credentials.
- **Cancelled** (`CANCELLED`): the client cancelled the call. Do not retry automatically.
- **Degraded Research** (`no-links`, `fetch-failed`, `extraction-failed`, `collate-failed`): the result is still returned with what succeeded. Check the summary and decide whether a narrower query or a retry is warranted. For `extraction-failed`, read the saved page that matches the question from `sources/`; for `collate-failed`, read the saved extractions listed in the report. Do either before repeating the research.
- **Busy:** the eight-request queue is already full. Wait for an earlier call to finish before submitting another.
