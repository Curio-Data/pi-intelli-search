# Intelli Search

Intelligent web research through the `intelli-search` Model Context Protocol (MCP) server. Four tools: `{{TOOL_SEARCH}}`, `{{TOOL_EXTRACT}}`, `{{TOOL_COLLATE}}` and `{{TOOL_RESEARCH}}`. The examples below use the exact qualified names this host declares.

Use these tools for current web research when this skill is selected, rather than silently substituting host-native search. If the server or tools are unavailable, report the setup failure explicitly; using another search tool does not establish that this server worked.

Inference uses the configured provider account. The server runs one operation at a time with up to eight requests queued; excess submissions receive a busy error rather than waiting.

## When to Use Which Tool

Start with `{{TOOL_SEARCH}}` for a factual question, latest version, release date or brief lookup. A request for current information or sources alone does not require the research pipeline. Keep the scope of the question: do not add comparisons, pricing or release history unless requested.

If a search answer looks stale or its sources disagree on the current version, try one narrower `{{TOOL_SEARCH}}` targeting official sources before escalating to research. Report unresolved uncertainty rather than treating an older release as current.

Use `{{TOOL_RESEARCH}}` for multi-page comparisons or detailed analysis, or when a search answer leaves a specific evidence gap requiring multiple pages. Search does not fetch and extract each cited page; research adds those stages, collation and cache suggestions. That pipeline makes more provider calls and can take minutes. A longer source list alone is not a reason to choose it.

### Quick Factual Question

Use `{{TOOL_SEARCH}}` for a quick factual answer with sources but no deep analysis. The source list is capped at the top `defaultUrls` (default 10) entries; a search-grounded model can cite twenty or more. Read the summary; treat the source list as an index to follow up from, not as reading.

```
{{TOOL_SEARCH}}(query="TypeScript 5.8 release date")
```

### Deep Research for a Coding Task

Use `{{TOOL_RESEARCH}}` when the task needs the full pipeline. Set `maxUrls` to the smallest useful breadth, starting with `3` for targeted research. Always provide a `focusPrompt` to specify the content to retain. Without that guidance, the extraction model produces generic summaries. Translate the user's intent into a specific extraction focus.

#### Example: Learning a New Feature

```
User: "How do runes work in Svelte 5?"

{{TOOL_RESEARCH}}(
  query="Svelte 5 runes tutorial examples",
  maxUrls=3,
  focusPrompt="Extract the core rune concepts ($state, $derived, $effect), their syntax, and how they replace the old reactive declarations. Include migration patterns from Svelte 4."
)
```

#### Example: Infrastructure and Sysadmin Detail

```
User: "How do I set up podman rootless with systemd?"

{{TOOL_RESEARCH}}(
  query="podman rootless systemd unit configuration",
  maxUrls=3,
  focusPrompt="Extract the exact directory paths podman rootless uses for systemd units, the XDG_RUNTIME_DIR and DBUS_SESSION_BUS_ADDRESS setup, and the systemd --user enable commands. Include file paths."
)
```

#### Example: Debugging a Specific Problem

```
User: "Why is my Cloudflare Worker timing out on KV writes?"

{{TOOL_RESEARCH}}(
  query="Cloudflare Workers KV write timeout limits",
  maxUrls=3,
  focusPrompt="Extract KV write limits, timeout thresholds, storage limits, and any workarounds for bulk writes. Focus on hard numbers and error messages."
)
```

#### Example: Comparing Options

```
User: "Should I use Tailwind or Vanilla Extract for a new project?"

{{TOOL_RESEARCH}}(
  query="Tailwind CSS vs Vanilla Extract comparison 2026",
  maxUrls=6,
  focusPrompt="Extract pros/cons, bundle size benchmarks, DX tradeoffs, and migration costs. Note which claims come from official sources vs blog opinions."
)
```

#### Example: API Reference

An application programming interface (API) reference task needs exact signatures and options.

```
User: "How do I use the Defuddle npm package?"

{{TOOL_RESEARCH}}(
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

For a different focus per URL (for example, comparing alternatives side by side), orchestrate step by step instead of using `{{TOOL_RESEARCH}}`:

1. `{{TOOL_SEARCH}}(query)` to discover URLs.
2. Fetch the pages with a web-fetch tool if one is installed (the server does not provide one), or with available shell or Hypertext Transfer Protocol (HTTP) tools. Pass the actual page content to the next step; a URL alone is insufficient.
3. `{{TOOL_EXTRACT}}(url, title, content, query, focusPrompt)` to give each URL a different focus.
4. `{{TOOL_COLLATE}}(extractions, query)` to deduplicate and cache.

Example: researching "KV vs Durable Objects". Extract KV pages with `focusPrompt="Extract KV read/write patterns, consistency model, and latency characteristics"`. Extract Durable Objects pages with `focusPrompt="Extract the consistency guarantees, transaction API, and single-computer model"`.

When constructing a collation item from an extraction result, use the original `url` and `title`, `result.details.extraction` and `result.details.sourceType`, plus `status: "success"`. Copy `result.details.truncated` into the item's optional `truncated` field when present. If extraction fails, retain that source as a failed item with an empty `extraction`, an explicit `sourceType` such as `unknown`, `status: "failed"` and an optional bounded `error` string describing the failure. Failed items are listed for coverage but do not enter synthesis. Do not forward the entire extraction `details` object: its `currentness` field is not a collation input.

## Evidence and Provenance

The Source Assessment inventory is generated from successful, non-empty extractions, not the search model's citations. IDs such as `[S1]` identify those evidence entries; cross-links in the synthesis are not additional fetched pages. Read exact cache paths from the inventory rather than guessing numbered filenames. `Not cached` means no full-page file exists for that source. The checks establish reference consistency, not factual accuracy.

Manual `{{TOOL_COLLATE}}` treats its inputs as caller-supplied evidence. Supply one non-empty successful extraction per URL; the optional `searchSummary` is accepted for compatibility but does not enter synthesis. Provenance failures return an error before report writes and preserve any prior successful output. They are not automatically retried; a manual rerun repeats the paid stages.

## Using the Result

The `{{TOOL_RESEARCH}}` result already contains a concise deduplicated summary. Use it directly. Do not read cache files unless the summary is insufficient for the task.

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

For a budget-exhaustion diagnostic, review the matching extraction or collation token cap with the maintainer rather than retrying unchanged. The cap can include reasoning tokens, and lowering reasoning effort is not a guaranteed remedy. Standalone extraction returns `details.truncated`; carry it into manual collation. Pass `inferred: true` for a source listed under Inferred Assets or marked `(inferred from text, not a citation)` by `{{TOOL_SEARCH}}`. An `extraction-failed` result names the folder in `details.cachePath`, where every fetched page is saved under `sources/`, and its **Failed Sources** list gives each saved page's path and why its extraction failed; read the matching page, or pass it to `{{TOOL_EXTRACT}}`, instead of repeating the research. An all-fetch-failed result returns the search summary and up to ten failed URLs with their reasons. A `collate-failed` result names a cached report that lists the saved extractions, which can be read instead of repeating the research. Either failure outcome can instead state that a same-day successful report for the query was preserved and name its folder in `details.preservedCachePath`; this run's files were not saved. A preserved `extraction-failed` result lists up to ten failed pages with their reasons inline; a preserved `collate-failed` result gives the collation failure reason. A truncation warning on the synthesis means every budget attempt was truncated, or no completed attempt passed source validation; the warning names the cap of the response used. A failed cache judge does not invalidate completed research, and no related-search suggestions do not establish that no relevant cache exists.

### Inferred Assets

An `Inferred Assets` table, also in `details.inferredAssets`, lists references guessed from search text, such as `install.sh` or `manage.py`, rather than cited. Each row gives the original token, the normalised URL it was fetched as, the fetch result (page, code file, text file, or nothing fetched with a reason) and the saved `sources/` path. When a fetched file may answer the question, read it, and treat it as a guess, not a citation. Check the final URL before relying on the content: "redirected to a different host" means the content came from another hostname, which is not evidence of a different organisation, and an alternate is a different representation, not a redirect. "Code file" classifies the media type or extension, not the language. `{{TOOL_SEARCH}}` marks the same sources `(inferred from text, not a citation)`.

### Trimmed Collation Input

A **Collation input trimmed** notice means the synthesis did not see the full text of each listed extraction. Read each listed extraction file, at the path the notice gives, to recover the omitted text; re-running research does not recover it. A per-source trim names `collationSourceMaxTokens`; raising it sends more of one long page. A budget trim names `collationInputBudgetTokens`; raising it, or requesting fewer URLs, sends more overall. A source trimmed by both limits needs both raised: raising only the budget does not recover text removed by the per-source cap. Report the setting named on the notice's **Configuration** line to the maintainer rather than changing it.

## Follow Up from Cache

The tool result's `details.cachePath` identifies the cache entry's absolute path. The default is `.search/<date>-<slug>-<hash>/` below the selected workspace; `tuning.cacheDir` can change the cache root. {{CACHE_READ_HINT}} List the directory and select an exact filename; the examples below are paths, not commands.

| Need | File |
|------|------|
| Quick refresher on one source | `extractions/<exact-file>.md` |
| Full original page content | `sources/<exact-file>.md` |
| Collated overview | `report.md` |
| Per-stage outcomes | `meta.json` |
| Re-fetch a single URL fresh | Use an installed web-fetch tool or shell/HTTP tools; the server provides no standalone fetch tool |

## How It Works

The following stages execute inside the research tool.

`{{TOOL_RESEARCH}}` runs a 5-stage pipeline inside a single tool call:

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

{{SETUP}}

## Failure Modes

- **Startup Failures:** Absent path selections and unusable workspaces still fail before serving. Cache safety is checked when valid configuration becomes available: at startup for a loadable file, or on a tool call after file recovery. Correct the diagnostic and restart the host. `--check-config` remains strict and exits with status `1` for invalid configuration or workspace selections.
- **Configuration Errors** (`CONFIGURATION`, `WORKSPACE`): a tool call found incomplete setup. For a missing, unreadable or invalid selected file, repair the named file and call again; the server rereads it on each call until it loads. JSON syntax diagnostics give a location without echoing the file. After a successful load, configuration changes need a restart. Environment credentials are captured at startup and require a restart; a configured credential file is reread on each call. These preflight errors incur no inference charges.
- **Provider Errors** (`PROVIDER`): the provider rejected or broke the call. Check credentials or permissions for `401`/`403`, and account credits for ordinary `402` credit exhaustion. The adapter treats a `402` with a valid Retry-After header as transient budget pressure and retries it under the configured bounded policy, like rate limits (`429`) and server errors (`5xx`). If transient failures persist after those attempts, wait before a manual retry rather than changing credentials.
- **Invalid Arguments** (`INVALID_ARGUMENTS`): the call parameters failed validation. Correct the arguments; do not retry unchanged.
- **Operation Failures** (`OPERATION`): a stage failed after validation. Read the diagnostic before repeating paid work. For an exhausted output budget or a provenance failure, correct the cause rather than retrying unchanged. Report persistent failures with the stage and bounded diagnostic, without credentials.
- **Cancelled** (`CANCELLED`): the client cancelled the call. Do not retry automatically.
- **Degraded Research** (`no-links`, `fetch-failed`, `extraction-failed`, `collate-failed`): the result is still returned with what succeeded. Check the summary and decide whether a narrower query or a retry is warranted. For `extraction-failed`, read the saved page that matches the question from `sources/`; for `collate-failed`, read the saved extractions listed in the report. Do either before repeating the research.
- **Busy:** the eight-request queue is already full. Wait for an earlier call to finish before submitting another.
